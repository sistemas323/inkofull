'use strict';

const vista = document.getElementById('vista');
const barra = document.getElementById('barra');
const reposo = document.getElementById('reposo');
const navegacion = document.getElementById('navegacion');
const titulo = document.getElementById('titulo');
const subtitulo = document.getElementById('subtitulo');

const estado = {
  token: sessionStorage.getItem('token'),
  usuario: JSON.parse(sessionStorage.getItem('usuario') || 'null'),
  identificadoEn: Number(sessionStorage.getItem('identificadoEn') || 0),
  modulos: null,      // catálogo del menú, se pide una vez
  llenado: null,      // llenado abierto en la vista de captura
  plantilla: null,
  respuestas: new Map(), // "itemId|columna" -> { valor, observacion }
  fotos: new Map(),      // "itemId|columna" -> [ { id, archivo } ]
};

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const llave = (itemId, columna) => `${itemId}|${columna || '-'}`;

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const datos = await res.json().catch(() => ({}));

  // Un 401 al entrar significa "PIN incorrecto", no "sesión expirada": hay que
  // dejar el mensaje en la pantalla del teclado en vez de sacar a la persona.
  if (res.status === 401 && ruta !== '/api/entrar') {
    cerrarSesion();
    throw new Error('Tu sesión expiró. Vuelve a entrar.');
  }

  if (!res.ok) throw new Error(datos.error || 'Ocurrió un error');
  return datos;
}

// ====================================================== evidencia fotográfica

// Las imágenes van protegidas por sesión, así que no se pueden poner directo en
// el src: hay que pedirlas con el token y convertirlas en un blob local.
const cacheImagenes = new Map();

async function cargarImagen(elemento, archivo) {
  try {
    if (!cacheImagenes.has(archivo)) {
      const res = await fetch(`/api/fotos/${archivo}`, { headers: { Authorization: `Bearer ${estado.token}` } });
      if (!res.ok) throw new Error('no disponible');
      cacheImagenes.set(archivo, URL.createObjectURL(await res.blob()));
    }
    elemento.src = cacheImagenes.get(archivo);
  } catch {
    elemento.alt = 'No se pudo cargar la foto';
  }
}

function cargarImagenesPendientes(raiz = vista) {
  raiz.querySelectorAll('img[data-archivo]:not([src])').forEach((img) => {
    cargarImagen(img, img.dataset.archivo);
  });
}

// Una foto de tablet pesa varios MB y no aporta nada a esa resolución. Se
// redimensiona en el navegador antes de subirla: la captura es instantánea
// incluso con wifi lento y el disco no se llena.
async function comprimirImagen(archivo, ladoMaximo = 1600, calidad = 0.82) {
  const mapa = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  const escala = Math.min(1, ladoMaximo / Math.max(mapa.width, mapa.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(mapa.width * escala);
  lienzo.height = Math.round(mapa.height * escala);
  lienzo.getContext('2d').drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
  mapa.close();
  return lienzo.toDataURL('image/jpeg', calidad);
}

function indexarFotos(lista) {
  estado.fotos = new Map();
  for (const f of lista || []) {
    const k = llave(f.item_id || 0, f.columna);
    if (!estado.fotos.has(k)) estado.fotos.set(k, []);
    estado.fotos.get(k).push(f);
  }
}

const fotosDe = (itemId, columna) => estado.fotos.get(llave(itemId || 0, columna)) || [];

function tiraFotos(itemId, columna, { obligatoria = false, soloLectura = false, oculta = false } = {}) {
  const lista = fotosDe(itemId, columna);
  const falta = obligatoria && lista.length === 0;
  return `
    <div class="evidencia ${falta ? 'falta' : ''}" data-item="${itemId || ''}" data-columna="${esc(columna)}"
         data-obligatoria="${obligatoria ? 1 : 0}" ${oculta && lista.length === 0 ? 'hidden' : ''}>
      <div class="miniaturas">
        ${lista.map((f) => `
          <figure class="mini">
            <img data-archivo="${esc(f.archivo)}" alt="Evidencia">
            ${soloLectura ? '' : `<button class="quitar" data-quitar="${f.id}" title="Quitar foto">×</button>`}
          </figure>`).join('')}
      </div>
      ${soloLectura ? (lista.length ? '' : '<span class="nota-foto">Sin evidencia</span>') : `
        <button class="btn-camara" type="button">
          <span aria-hidden="true">📷</span> ${lista.length ? 'Otra foto' : 'Tomar foto'}
        </button>
        ${falta ? '<span class="nota-foto obligatoria">Foto obligatoria</span>' : ''}`}
    </div>`;
}

// Vuelve a dibujar una tira tras subir o quitar una foto. Sin opciones conserva
// el carácter obligatorio que ya tenía; con ellas lo redefine (al marcar o
// desmarcar un problema). Una tira con fotos nunca se oculta, para que nadie
// deje una foto olvidada fuera de vista.
const esPDF = (archivo) => /\.pdf$/i.test(archivo);

// Tira de documentos. A diferencia de la evidencia fotográfica, aquí sí se
// permite elegir un archivo ya existente —una hoja escaneada en PDF desde la
// multifuncional es tan válida como una foto tomada con la tablet.
function tiraArchivos(itemId, soloLectura = false) {
  const lista = fotosDe(itemId, '-');
  return `
    <div class="evidencia documentos" data-item="${itemId}" data-columna="-" data-documento="1">
      <div class="miniaturas">
        ${lista.map((f) => `
          <figure class="mini">
            ${esPDF(f.archivo)
              ? `<a class="pdf" data-abrir="${esc(f.archivo)}" title="Abrir PDF"><span>PDF</span></a>`
              : `<img data-archivo="${esc(f.archivo)}" alt="Documento">`}
            ${soloLectura ? '' : `<button class="quitar" data-quitar="${f.id}" title="Quitar">×</button>`}
          </figure>`).join('')}
      </div>
      ${soloLectura
        ? (lista.length ? '' : '<span class="nota-foto">Sin documento</span>')
        : `<button class="btn-camara" type="button" data-cargar-doc>
             <span aria-hidden="true">📎</span> ${lista.length ? 'Agregar otro' : 'Cargar documento'}
           </button>
           <span class="nota-foto">Foto o PDF</span>`}
    </div>`;
}

function refrescarTira(caja, opciones = {}) {
  if (caja.dataset.documento === '1') {
    const nueva = document.createElement('div');
    nueva.innerHTML = tiraArchivos(Number(caja.dataset.item));
    const reemplazo = nueva.firstElementChild;
    caja.replaceWith(reemplazo);
    cargarImagenesPendientes(reemplazo);
    actualizarEstadoDocumento(reemplazo.closest('.documento'));
    return;
  }
  refrescarTiraFoto(caja, opciones);
}

// Refleja en el renglón si el documento ya está cargado o sigue pendiente.
function actualizarEstadoDocumento(fila) {
  if (!fila) return;
  const n = fotosDe(Number(fila.dataset.item), '-').length;
  fila.classList.toggle('pendiente', n === 0);
  const estado = fila.querySelector('.estado-doc');
  if (estado) {
    estado.innerHTML = n
      ? `<span class="etiqueta verde">${n} archivo(s)</span>`
      : '<span class="etiqueta roja">Pendiente</span>';
  }
  actualizarResumen();
}

function refrescarTiraFoto(caja, opciones = {}) {
  const itemId = caja.dataset.item ? Number(caja.dataset.item) : null;
  const columna = caja.dataset.columna;
  const nueva = document.createElement('div');
  nueva.innerHTML = tiraFotos(itemId, columna, {
    obligatoria: opciones.obligatoria ?? caja.dataset.obligatoria === '1',
    oculta: opciones.oculta ?? caja.hidden,
  });
  const reemplazo = nueva.firstElementChild;
  caja.replaceWith(reemplazo);
  cargarImagenesPendientes(reemplazo);
}

// Un solo <input type="file"> reutilizado por todas las tiras. En tablet, el
// atributo capture hace que abra la cámara en vez del explorador de archivos.
// Ojo: 'capture' se pone con setAttribute, no como propiedad. En navegadores de
// escritorio la propiedad no existe y asignarla no llega al HTML, con lo que la
// tablet abriría el explorador de archivos en vez de la cámara.
const selectorFotos = document.createElement('input');
selectorFotos.setAttribute('type', 'file');
selectorFotos.setAttribute('accept', 'image/*');
selectorFotos.setAttribute('capture', 'environment');
selectorFotos.setAttribute('multiple', '');
selectorFotos.hidden = true;
document.body.appendChild(selectorFotos);

// Selector aparte para documentos: SIN 'capture', para que además de la cámara
// deje elegir un PDF ya escaneado o una foto de la galería.
const selectorDocs = document.createElement('input');
selectorDocs.setAttribute('type', 'file');
selectorDocs.setAttribute('accept', 'image/*,application/pdf');
selectorDocs.setAttribute('multiple', '');
selectorDocs.hidden = true;
document.body.appendChild(selectorDocs);

let cajaDestino = null;

const leerComoDataURL = (archivo) => new Promise((resolver, rechazar) => {
  const lector = new FileReader();
  lector.onload = () => resolver(lector.result);
  lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
  lector.readAsDataURL(archivo);
});

// Un documento se sube con más resolución que una foto de evidencia: en una hoja
// de recepción hay que poder leer la firma y los datos escritos a mano.
async function subirArchivos(caja, archivos, { ladoMaximo, calidad }) {
  const boton = caja.querySelector('.btn-camara');
  const textoOriginal = boton ? boton.innerHTML : '';
  if (boton) { boton.disabled = true; boton.textContent = 'Subiendo…'; }

  for (const archivo of archivos) {
    try {
      const contenido = archivo.type === 'application/pdf'
        ? await leerComoDataURL(archivo)
        : await comprimirImagen(archivo, ladoMaximo, calidad);

      const guardado = await api('POST', `/api/llenados/${estado.llenado.id}/fotos`, {
        item_id: caja.dataset.item || null,
        columna: caja.dataset.columna,
        imagen: contenido,
      });
      const k = llave(guardado.item_id || 0, guardado.columna);
      if (!estado.fotos.has(k)) estado.fotos.set(k, []);
      estado.fotos.get(k).push(guardado);
    } catch (err) {
      mostrarMensaje(`No se pudo subir «${archivo.name}»: ${err.message}`, 'error');
    }
  }

  if (boton) { boton.disabled = false; boton.innerHTML = textoOriginal; }
  refrescarTira(caja);
}

selectorFotos.addEventListener('change', async () => {
  const archivos = [...selectorFotos.files];
  selectorFotos.value = '';
  if (!archivos.length || !cajaDestino) return;
  await subirArchivos(cajaDestino, archivos, { ladoMaximo: 1600, calidad: 0.82 });
});

selectorDocs.addEventListener('change', async () => {
  const archivos = [...selectorDocs.files];
  selectorDocs.value = '';
  if (!archivos.length || !cajaDestino) return;
  await subirArchivos(cajaDestino, archivos, { ladoMaximo: 2200, calidad: 0.88 });
});

// Los PDF van protegidos por sesión igual que las fotos, así que hay que
// pedirlos con el token y abrirlos desde un blob local.
async function abrirPDF(archivo) {
  try {
    const res = await fetch(`/api/fotos/${archivo}`, { headers: { Authorization: `Bearer ${estado.token}` } });
    if (!res.ok) throw new Error('No se pudo abrir');
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    mostrarMensaje(`No se pudo abrir el documento: ${err.message}`, 'error');
  }
}

function ampliarFoto(src) {
  const capa = document.createElement('div');
  capa.className = 'visor';
  capa.innerHTML = `<img src="${src}" alt="Evidencia ampliada"><button class="btn" type="button">Cerrar</button>`;
  const cerrar = () => { capa.remove(); document.removeEventListener('keydown', alPresionar); };
  const alPresionar = (e) => { if (e.key === 'Escape') cerrar(); };
  capa.addEventListener('click', cerrar);
  document.addEventListener('keydown', alPresionar);
  document.body.appendChild(capa);
}

// La identidad vive en sessionStorage, no en localStorage: si alguien cierra la
// pestaña o se reinicia la tablet, el siguiente que llegue empieza de cero en
// vez de heredar la sesión del anterior.
function guardarSesion(datos) {
  estado.token = datos.token;
  estado.usuario = datos.usuario;
  estado.identificadoEn = Date.now();
  sessionStorage.setItem('token', datos.token);
  sessionStorage.setItem('usuario', JSON.stringify(datos.usuario));
  sessionStorage.setItem('identificadoEn', String(estado.identificadoEn));
}

function cerrarSesion(volverAlReposo = false) {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('usuario');
  sessionStorage.removeItem('identificadoEn');
  estado.token = null;
  estado.usuario = null;
  estado.identificadoEn = 0;
  estado.modulos = null;
  estado.llenado = null;
  // Sin sesión no hay menú que mostrar: se vuelve a preguntar quién entra.
  if (volverAlReposo) dormir();
  else location.hash = '#/acceso';
}

// ------------------------------------------------------- pantalla de reposo

let temporizadorReposo = null;
const ESPERA_REPOSO = 6 * 60 * 1000;

// El regreso automático al reposo protege a una tablet compartida: evita que el
// siguiente en tomarla capture a nombre de quien la usó antes. En una
// computadora con mouse no aplica —es de una sola persona— y ahí interrumpir a
// alguien que lleva siete minutos leyendo un reporte solo estorba.
const ES_TACTIL = window.matchMedia('(pointer: coarse)').matches;

function dormir() {
  clearTimeout(temporizadorReposo);
  document.body.classList.add('en-reposo');
  reposo.hidden = false;
  barra.hidden = true;
  vista.hidden = true;
}

function despertar() {
  if (!document.body.classList.contains('en-reposo')) return;
  document.body.classList.remove('en-reposo');
  reposo.hidden = true;
  barra.hidden = false;
  vista.hidden = false;
  if (!location.hash || location.hash === '#/') {
    // La identidad va antes del menú: así cada quien ve solo sus módulos.
    location.hash = estado.token ? '#/menu' : '#/acceso';
  }
  else enrutar();
  reiniciarInactividad();
}

function reiniciarInactividad() {
  clearTimeout(temporizadorReposo);
  if (!ES_TACTIL) return;
  if (document.body.classList.contains('en-reposo')) return;
  temporizadorReposo = setTimeout(async () => {
    await descargarPendientes();
    cerrarSesion(true);
  }, ESPERA_REPOSO);
}

// En computadora se toca con el mouse, no con el dedo: el texto lo dice.
document.getElementById('pista-reposo').textContent = ES_TACTIL
  ? 'Toca la pantalla para comenzar'
  : 'Haz clic para comenzar';

reposo.addEventListener('pointerdown', despertar);
reposo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') despertar(); });
['pointerdown', 'keydown', 'wheel'].forEach((evento) => {
  document.addEventListener(evento, reiniciarInactividad, { passive: true });
});

function avisoError(mensaje) {
  return `<div class="aviso error">${esc(mensaje)}</div>`;
}

function encabezado(texto, sub) {
  titulo.firstChild.textContent = texto;
  subtitulo.textContent = sub || '';
}

const permiso = (nombre) => !!(estado.usuario && estado.usuario.permisos && estado.usuario.permisos[nombre]);

function pintarNavegacion() {
  const enMenu = (location.hash || '') === '#/menu';
  navegacion.innerHTML = `
    ${enMenu ? '' : '<button class="btn" data-ir="#/menu">Menú</button>'}
    ${estado.usuario && permiso('reportes') && enModuloChecklists()
      ? '<button class="btn" data-ir="#/reportes">Reportes</button>' : ''}
    ${estado.usuario && permiso('comparativa') && enModuloChecklists()
      ? '<button class="btn" data-ir="#/comparativa">Comparativa</button>' : ''}
    ${estado.usuario ? '<button class="btn" data-salir>Salir</button>' : ''}`;
}

const RUTAS_CHECKLISTS = /^#\/(checklists|llenar|envio|envios|reportes|comparativa|detalle)/;
const enModuloChecklists = () => RUTAS_CHECKLISTS.test(location.hash || '');

navegacion.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) location.hash = ir.dataset.ir;
  if (e.target.closest('[data-salir]')) cerrarSesion();
});

// =============================================================== vista: menú

// Íconos dibujados a mano en trazo simple, en línea con la geometría del
// logotipo. Nada de librerías externas: la tablet trabaja sin internet.
const ICONOS = {
  checklist: '<path d="M9 5h10M9 12h10M9 19h10"/><path d="M3.5 5.5 5 7l2.5-2.5"/><path d="M3.5 12.5 5 14l2.5-2.5"/><path d="M3.5 19.5 5 21l2.5-2.5"/>',
  cajas: '<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v7"/>',
  camion: '<path d="M2 6.5h11v9H2zM13 9.5h4.5L21 13v2.5h-8z"/><circle cx="6.5" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>',
  calidad: '<path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9v-5z"/><path d="M9 12.2l2.2 2.2 4-4.3"/>',
  orden: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5"/><path d="M9 12.5h7M9 16.5h5"/>',
  ajustes: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.6M12 18.6v2.6M4.5 4.5l1.9 1.9M17.6 17.6l1.9 1.9M2.8 12h2.6M18.6 12h2.6M4.5 19.5l1.9-1.9M17.6 6.4l1.9-1.9"/>',
};

const simbolo = (clave) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[clave] || ICONOS.checklist}</svg>`;

async function vistaMenu() {
  encabezado('Sistema Digital', estado.usuario ? `Sesión de ${estado.usuario.nombre}` : 'Selecciona un módulo');
  if (!estado.modulos) estado.modulos = await api('GET', '/api/modulos');

  vista.innerHTML = `
    <div class="rejilla-modulos">
      ${estado.modulos.map((m) => `
        <button class="modulo ${m.disponible ? '' : 'proximamente'}"
                data-modulo="${esc(m.clave)}" ${m.disponible ? '' : 'disabled'}>
          ${m.disponible
            ? (m.restringido ? '<span class="marca-esquina candado">Administrador</span>' : '')
            : '<span class="marca-esquina">Próximamente</span>'}
          <span class="simbolo">${simbolo(m.icono)}</span>
          <b>${esc(m.nombre)}</b>
          <span>${esc(m.descripcion)}</span>
        </button>`).join('')}
    </div>`;

  vista.querySelectorAll('[data-modulo]').forEach((boton) => {
    boton.addEventListener('click', () => abrirModulo(boton.dataset.modulo));
  });
}

const DESTINO_MODULO = { checklists: '#/checklists', configuracion: '#/config' };

// Cuánto vale una identificación reciente antes de volver a pedirla en las
// secciones marcadas como sensibles.
const VIGENCIA_IDENTIDAD = 3 * 60 * 1000;

// La identidad ya se comprobó al entrar, así que un módulo se abre directo. La
// excepción es Configuración: si la persona lleva rato dentro, se le vuelve a
// pedir el PIN — no por desconfianza, sino porque la tablet pudo cambiar de manos.
function abrirModulo(clave) {
  const m = estado.modulos.find((x) => x.clave === clave);
  if (!m || !m.disponible) return;

  const recienIdentificado = Date.now() - (estado.identificadoEn || 0) < VIGENCIA_IDENTIDAD;
  if (m.reautenticar && !recienIdentificado) {
    return void (location.hash = `#/acceso/${clave}`);
  }
  location.hash = DESTINO_MODULO[clave] || '#/menu';
}

// ============================================================= vista: acceso

async function vistaAcceso(claveModulo) {
  // Sin módulo es la puerta de entrada del sistema: se elige quién eres y a
  // partir de ahí el menú muestra solo lo que esa persona puede abrir.
  let modulo = null;
  if (claveModulo) {
    if (!estado.modulos) estado.modulos = await api('GET', '/api/modulos');
    modulo = estado.modulos.find((m) => m.clave === claveModulo);
    if (!modulo) return void (location.hash = '#/menu');
  }

  encabezado(modulo ? modulo.nombre : 'Sistema Digital INKO', '¿Quién eres?');
  const personas = await api('GET',
    modulo ? `/api/usuarios?modulo=${encodeURIComponent(claveModulo)}` : '/api/usuarios');

  const reautentica = !!(modulo && modulo.reautenticar);

  vista.innerHTML = `
    ${modulo ? `<div class="migaja">
      <button data-volver>← Menú</button><span>/</span><span>${esc(modulo.nombre)}</span>
    </div>` : ''}
    ${reautentica ? `
      <div class="aviso info">
        <b>${esc(modulo.nombre)} pide confirmar tu identidad.</b><br>
        Llevas rato dentro del sistema y la tablet pudo cambiar de manos, así que
        aquí se vuelve a capturar el PIN: desde esta sección se dan de alta
        personas y se otorgan permisos.
      </div>` : ''}
    ${personas.length === 0 ? `
      <div class="panel"><div class="vacio">
        ${modulo ? `Nadie puede entrar a ${esc(modulo.nombre)} todavía.` : 'No hay personas dadas de alta.'}<br>
        ${reautentica
          ? 'Esta sección exige PIN, y ninguna persona con ese acceso tiene uno asignado.'
          : 'Pídele al Administrador que te dé de alta.'}
      </div></div>` : `
      <div class="panel">
        <h2>${reautentica ? 'Confirma quién eres' : 'Selecciona tu nombre'}</h2>
        <div class="rejilla-usuarios">
          ${personas.map((u) => `
            <button class="tarjeta-usuario" data-usuario="${u.id}" data-pin="${u.requiere_pin ? 1 : 0}"
                    data-nombre="${esc(u.nombre)}">
              <span class="inicial">${esc(u.nombre.trim()[0] || '?')}</span>
              <span><b>${esc(u.nombre)}</b><small>${esc(u.etiqueta_rol)}</small></span>
              ${u.requiere_pin ? '<span class="llave" title="Pide PIN">🔒</span>' : ''}
            </button>`).join('')}
        </div>
      </div>`}
    <div id="zona-pin"></div>`;

  vista.querySelector('[data-volver]')?.addEventListener('click', () => { location.hash = '#/menu'; });

  vista.querySelectorAll('[data-usuario]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const id = Number(boton.dataset.usuario);
      // En un módulo que reautentica siempre se pasa por el PIN, sin atajos.
      if (boton.dataset.pin === '1' || reautentica) {
        pedirPin(id, boton.dataset.nombre, claveModulo);
      } else {
        entrarComo(id, '', claveModulo);
      }
    });
  });
}

async function entrarComo(usuarioId, pin, claveModulo) {
  const datos = await api('POST', '/api/entrar', { usuario_id: usuarioId, pin });
  guardarSesion(datos);
  estado.modulos = null; // el menú se rearma con los permisos de quien entró
  location.hash = claveModulo ? (DESTINO_MODULO[claveModulo] || '#/menu') : '#/menu';
}

// Teclado numérico en pantalla: en una tablet de almacén, con guantes, es más
// fiable que el teclado del sistema.
function pedirPin(usuarioId, nombre, claveModulo) {
  const zona = document.getElementById('zona-pin');
  let pin = '';

  // El campo y el teclado en pantalla trabajan sobre el mismo valor: se puede
  // tocar los números o escribir directo. Los PIN con letras solo se pueden
  // capturar tecleando, así que el campo tiene que estar siempre disponible.
  const dibujar = (error) => {
    zona.innerHTML = `
      <div class="panel">
        <h2>PIN de acceso</h2>
        <div class="pin-zona">
          ${error ? `<div class="aviso error">${esc(error)}</div>` : ''}
          <span class="quien">${esc(nombre)}</span>
          <input id="campo-pin" class="pin-campo" type="password" inputmode="text"
                 autocomplete="off" autocapitalize="off" spellcheck="false"
                 maxlength="12" value="${esc(pin)}" aria-label="PIN de ${esc(nombre)}">
          <span class="nota-foto">Toca los números o escribe tu PIN si lleva letras</span>
          <div class="teclado">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-tecla="${n}">${n}</button>`).join('')}
            <button class="tenue" data-tecla="borrar">Borrar</button>
            <button data-tecla="0">0</button>
            <button class="tenue" data-tecla="entrar">Entrar</button>
          </div>
        </div>
      </div>`;

    const campo = zona.querySelector('#campo-pin');
    campo.addEventListener('input', () => { pin = campo.value; });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') intentar(); });

    const intentar = async () => {
      try {
        await entrarComo(usuarioId, pin, claveModulo);
      } catch (err) {
        pin = '';
        dibujar(err.message);
      }
    };

    zona.querySelectorAll('[data-tecla]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.tecla;
        if (t === 'borrar') { pin = pin.slice(0, -1); campo.value = pin; return campo.focus(); }
        if (t === 'entrar') return intentar();
        if (pin.length >= 12) return;
        pin += t;
        campo.value = pin;
        campo.focus();
      });
    });

    if (!ES_TACTIL) campo.focus();
  };

  dibujar();
  zona.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================== vista: inicio

const ETIQUETA_FRECUENCIA = { diario: 'Diario', semanal: 'Semanal', viernes: 'Solo viernes' };

async function vistaChecklists() {
  encabezado('Checklists', `${estado.usuario.nombre} · ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`);
  const { tarjetas } = await api('GET', '/api/inicio');

  const estadoVisual = {
    pendiente: ['', 'Pendiente'],
    borrador: ['ambar', 'En proceso'],
    en_ruta: ['azul', 'En ruta'],
    cerrado: ['verde', 'Completado'],
  };

  // Aviso arriba con los procesos abiertos, en vez de una tarjeta por cada uno.
  const pendientes = tarjetas.filter((t) => t.multiple && t.en_proceso > 0);
  const totalAbiertos = pendientes.reduce((n, t) => n + t.en_proceso, 0);

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-menu>← Menú</button><span>/</span><span>Checklists</span>
    </div>
    ${totalAbiertos ? `
      <button class="aviso pendientes" data-ir-pendientes="${esc(pendientes[0].plantilla_clave)}">
        <span class="cuenta">${totalAbiertos}</span>
        <span>
          <b>${totalAbiertos === 1 ? 'Hay 1 envío en proceso' : `Hay ${totalAbiertos} envíos en proceso`}</b><br>
          <small>${pendientes.map((t) => esc(t.plantilla_nombre)).join(' · ')} — toca para continuar</small>
        </span>
        <span class="flecha" aria-hidden="true">›</span>
      </button>` : ''}
    <div class="rejilla-tareas">${tarjetas.map((t, i) => {
    const [color, texto] = estadoVisual[t.estado] || ['', ''];
    return `
      <button class="tarea ${t.estado}" ${t.disponible ? '' : 'disabled'} data-tarjeta="${i}">
        ${t.multiple
          ? `<span class="etiqueta ${t.en_proceso ? 'ambar' : ''}">${t.en_proceso
              ? `${t.en_proceso} en proceso` : 'Iniciar envío'}</span>`
          : `<span class="etiqueta ${color}">${texto}</span>`}
        <b>${esc(t.plantilla_nombre)}${t.activo_nombre ? ` · ${esc(t.activo_nombre)}` : ''}</b>
        <span class="meta">${esc(t.descripcion || '')}</span>
        <span class="meta">${t.multiple
          ? `${ETIQUETA_FRECUENCIA[t.frecuencia]}${t.concluidos ? ` · ${t.concluidos} concluido(s) hoy` : ''}`
          : `${ETIQUETA_FRECUENCIA[t.frecuencia]} · ${esc(t.periodo)}${t.disponible ? '' : ' · disponible el viernes'}`}</span>
      </button>`;
  }).join('')}</div>`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  vista.querySelector('[data-ir-pendientes]')?.addEventListener('click', (e) => {
    location.hash = `#/envios/${e.currentTarget.dataset.irPendientes}`;
  });

  vista.querySelectorAll('[data-tarjeta]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const t = tarjetas[Number(boton.dataset.tarjeta)];
      if (t.multiple) return void (location.hash = `#/envios/${t.plantilla_clave}`);
      location.hash = `#/llenar/${t.plantilla_clave}${t.activo_id ? `/${t.activo_id}` : ''}`;
    });
  });
}

// ==================================================== vista: lista de envíos

const ETIQUETA_ENVIO = {
  borrador: ['ambar', 'Preparando salida'],
  en_ruta: ['azul', 'En ruta'],
  cerrado: ['verde', 'Concluido'],
};

async function vistaEnvios(plantillaClave) {
  const { plantilla, abiertos, cerrados, periodo } = await api('GET', `/api/plantillas/${plantillaClave}/llenados`);
  encabezado(plantilla.nombre, `${esc(plantilla.descripcion || '')} · ${periodo}`);

  const tarjetaEnvio = (l) => {
    const [color, texto] = ETIQUETA_ENVIO[l.estado] || ['', l.estado];
    const detalle = l.estado === 'en_ruta' && l.salida_en
      ? `Salió ${new Date(l.salida_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · falta la hoja de recepción`
      : l.estado === 'cerrado' && l.cerrado_en
        ? `Cerrado ${new Date(l.cerrado_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
        : 'Aún no se autoriza la salida';
    return `
      <button class="tarea ${l.estado}" data-envio="${l.id}">
        <span class="etiqueta ${color}">${texto}</span>
        <b>${esc(l.resumen)}</b>
        <span class="meta">${detalle}</span>
        <span class="meta">${esc(l.quien)}</span>
      </button>`;
  };

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-menu>← Menú</button><span>/</span>
      <button data-ir-lista>Checklists</button><span>/</span><span>${esc(plantilla.nombre)}</span>
    </div>
    <div id="mensajes"></div>

    <div class="fila-botones" style="margin-bottom:18px">
      <button class="btn primario grande" id="nuevo-envio">+ Nuevo envío</button>
    </div>

    <section class="panel">
      <h2>En proceso ${abiertos.length ? `<span class="etiqueta ambar">${abiertos.length}</span>` : ''}</h2>
      ${abiertos.length
        ? `<div class="rejilla-tareas" style="padding:18px">${abiertos.map(tarjetaEnvio).join('')}</div>`
        : '<div class="vacio">No hay envíos abiertos. Toca «Nuevo envío» para comenzar.</div>'}
    </section>

    ${cerrados.length ? `
      <section class="panel">
        <h2>Concluidos hoy <span class="etiqueta verde">${cerrados.length}</span></h2>
        <div class="rejilla-tareas" style="padding:18px">${cerrados.map(tarjetaEnvio).join('')}</div>
      </section>` : ''}`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  vista.querySelector('[data-ir-lista]').addEventListener('click', () => { location.hash = '#/checklists'; });
  document.getElementById('nuevo-envio').addEventListener('click', () => {
    abrirCabecera({ plantilla_clave: plantilla.clave, plantilla_nombre: plantilla.nombre, campos: plantilla.campos });
  });
  vista.querySelectorAll('[data-envio]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/envio/${b.dataset.envio}`; });
  });
}

// Los datos de cabecera se piden ANTES de la inspección: el número de envío es
// lo que distingue un checklist de otro, así que no puede capturarse al final.
function abrirCabecera(tarjeta) {
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Datos del envío">
      <h2>Nuevo · ${esc(tarjeta.plantilla_nombre)}</h2>
      <div class="cuerpo-modal">
        <div id="error-cabecera"></div>
        <p class="explica" style="padding:0 0 14px">
          Captura estos datos antes de comenzar la inspección.
        </p>
        ${tarjeta.campos.map((c) => `
          <div class="campo">
            <label for="c-${esc(c.clave)}">${esc(c.etiqueta)}${c.requerido ? '' : ' (opcional)'}</label>
            ${c.opciones
              ? `<select id="c-${esc(c.clave)}">
                   <option value="">Elige una opción…</option>
                   ${c.opciones.map((o) => `<option value="${esc(o.valor)}">${esc(o.etiqueta)}</option>`).join('')}
                 </select>`
              : `<input id="c-${esc(c.clave)}" autocomplete="off">`}
            ${c.ayuda ? `<small style="color:var(--tinta-suave)">${esc(c.ayuda)}</small>` : ''}
          </div>`).join('')}
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-comenzar>Comenzar inspección</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const cerrar = () => { capa.remove(); document.removeEventListener('keydown', alPresionar); };
  const alPresionar = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', alPresionar);
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  capa.querySelector('[data-comenzar]').addEventListener('click', async () => {
    const datos = {};
    for (const c of tarjeta.campos) datos[c.clave] = capa.querySelector(`#c-${c.clave}`).value.trim();
    const primerCampo = tarjeta.campos.find((c) => c.requerido && !datos[c.clave]);
    if (primerCampo) {
      capa.querySelector('#error-cabecera').innerHTML = avisoError(`Falta «${primerCampo.etiqueta}».`);
      return capa.querySelector(`#c-${primerCampo.clave}`).focus();
    }
    try {
      const llenado = await api('POST', '/api/llenados', {
        plantilla_clave: tarjeta.plantilla_clave,
        datos,
        crear_nuevo: true,
      });
      cerrar();
      location.hash = `#/envio/${llenado.id}`;
    } catch (err) {
      capa.querySelector('#error-cabecera').innerHTML = avisoError(err.message);
    }
  });

  capa.querySelector('input').focus();
}

// ============================================================= vista: llenar

// Abre un checklist ya iniciado por su id. Necesario en Tránsito, donde puede
// haber varios el mismo día y no basta con plantilla + periodo.
async function vistaEnvio(llenadoId) {
  const { llenado, plantilla } = await api('GET', `/api/llenados/${llenadoId}/abrir`);
  pintarLlenado(plantilla, llenado);
}

async function vistaLlenar(plantillaClave, activoId) {
  const plantilla = await api('GET', `/api/plantillas/${plantillaClave}${activoId ? `?activo_id=${activoId}` : ''}`);
  const llenado = await api('POST', '/api/llenados', {
    plantilla_clave: plantillaClave,
    activo_id: activoId || null,
  });
  pintarLlenado(plantilla, llenado);
}

const ETIQUETA_ESTADO = {
  borrador: 'Borrador',
  en_ruta: 'En ruta — falta el regreso',
  cerrado: 'Concluido',
};

function pintarLlenado(plantilla, llenado) {
  estado.plantilla = plantilla;
  estado.llenado = llenado;
  estado.respuestas = new Map(
    llenado.respuestas.map((r) => [llave(r.item_id, r.columna), { valor: r.valor, observacion: r.observacion }])
  );
  indexarFotos(llenado.fotos);

  const cerrado = llenado.estado === 'cerrado';
  const enRuta = llenado.estado === 'en_ruta';
  const porEtapas = !!plantilla.por_etapas;

  // Los campos de opciones guardan una clave; aquí se muestra su etiqueta.
  const cabecera = plantilla.campos
    .map((c) => {
      const valor = llenado.datos[c.clave];
      if (!valor) return null;
      return c.opciones ? (c.opciones.find((o) => o.valor === valor) || {}).etiqueta || valor : valor;
    })
    .filter(Boolean)
    .join(' · ');

  encabezado(
    plantilla.nombre + (plantilla.activo ? ` · ${plantilla.activo.nombre}` : '') + (cabecera ? ` · ${cabecera}` : ''),
    `${ETIQUETA_ESTADO[llenado.estado] || llenado.estado} · ${llenado.periodo} · ${estado.usuario.nombre}`
  );

  // Solo la etapa que toca está activa:
  //  · antes de salir, el regreso se ve pero no se puede llenar;
  //  · ya en ruta, la inspección previa queda congelada — es el estado en que la
  //    unidad salió y reescribirlo sería falsearlo.
  const etapaActiva = enRuta ? 'regreso' : 'salida';
  const estadoSeccion = (seccion) => {
    if (cerrado) return 'cerrada';
    if (!porEtapas || seccion.etapa === etapaActiva) return 'activa';
    return seccion.etapa === 'salida' ? 'registrada' : 'despues';
  };
  estado.etapaActiva = porEtapas ? etapaActiva : null;

  // Un checklist abierto antes de que la plantilla ganara un campo nuevo se
  // queda sin ese dato. En vez de dejarlo atorado, se pide completarlo.
  const faltanDatos = plantilla.campos.filter((c) => c.requerido && !llenado.datos[c.clave]);
  if (faltanDatos.length && llenado.estado === 'borrador') {
    encabezado(plantilla.nombre, 'Faltan datos de cabecera');
    vista.innerHTML = `
      <div class="migaja"><button data-ir-lista>← Checklists</button></div>
      <div class="aviso info">
        Este checklist se abrió antes de que se agregara
        ${faltanDatos.length === 1 ? 'un dato' : 'unos datos'} al formato.
        Complétalo${faltanDatos.length === 1 ? '' : 's'} para continuar.
      </div>
      <div class="panel"><div class="cuerpo-modal" id="completar"></div>
        <div class="pie-modal"><button class="btn primario" id="guardar-datos">Guardar y continuar</button></div>
      </div>`;
    document.getElementById('completar').innerHTML = plantilla.campos.map((c) => `
      <div class="campo">
        <label for="d-${esc(c.clave)}">${esc(c.etiqueta)}</label>
        ${c.opciones
          ? `<select id="d-${esc(c.clave)}">
               <option value="">Elige una opción…</option>
               ${c.opciones.map((o) => `<option value="${esc(o.valor)}" ${llenado.datos[c.clave] === o.valor ? 'selected' : ''}>${esc(o.etiqueta)}</option>`).join('')}
             </select>`
          : `<input id="d-${esc(c.clave)}" value="${esc(llenado.datos[c.clave] || '')}">`}
        ${c.ayuda ? `<small style="color:var(--tinta-suave)">${esc(c.ayuda)}</small>` : ''}
      </div>`).join('') + '<div id="mensajes"></div>';

    vista.querySelector('[data-ir-lista]').addEventListener('click', () => { location.hash = listaDeRegreso(); });
    document.getElementById('guardar-datos').addEventListener('click', async () => {
      const datos = {};
      for (const c of plantilla.campos) datos[c.clave] = document.getElementById(`d-${c.clave}`).value.trim();
      try {
        await api('PUT', `/api/llenados/${llenado.id}/datos`, { datos });
        vistaEnvio(llenado.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
    return;
  }

  const cuerpo = plantilla.tipo_captura === 'items'
    ? pintarItems(plantilla, cerrado, estadoSeccion)
    : { matriz: pintarMatriz, grid_semanal: pintarGrid }[plantilla.tipo_captura](plantilla, cerrado);

  // Las firmas se levantan al concluir el proceso, no al autorizar la salida.
  const tocaFirmar = !porEtapas || enRuta || cerrado;

  // En un checklist supervisado, quien lo llena prepara pero no autoriza ni
  // cierra: eso lo hace un Team Leader o el Administrador.
  const puedeCerrar = !plantilla.requiere_supervision || permiso('firmar_supervision');

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-lista>← ${plantilla.campos.length ? esc(plantilla.nombre) : 'Checklists'}</button>
      ${cabecera ? `<span>/</span><span>${esc(cabecera)}</span>` : `<span>/</span><span>${esc(plantilla.nombre)}</span>`}
    </div>
    <div id="mensajes"></div>
    ${cerrado ? `<div class="aviso exito">Proceso concluido. Solo puedes consultarlo.
      ${llenado.autorizo ? `<br><small>Salida autorizada por ${esc(llenado.autorizo)}` : ''}
      ${llenado.cerro ? ` · cerrado por ${esc(llenado.cerro)}</small>` : llenado.autorizo ? '</small>' : ''}
    </div>` : ''}
    ${enRuta ? `<div class="aviso info">
        <b>La unidad ya salió${llenado.autorizo ? `, autorizada por ${esc(llenado.autorizo)}` : ''}.</b>
        La inspección previa quedó registrada y no se modifica. Al regresar, carga
        la hoja de recepción${puedeCerrar ? ' y cierra el proceso.' : '; un Team Leader cierra el proceso.'}
      </div>` : ''}
    ${porEtapas && !cerrado && !enRuta ? `<div class="aviso info">
        Completa la inspección previa y carga las hojas de autorización.
        ${puedeCerrar
          ? 'Con eso se autoriza la salida; el proceso queda abierto hasta el regreso.'
          : '<b>Cuando esté listo, un Team Leader o el Administrador autoriza la salida.</b>'}
      </div>` : ''}
    ${cuerpo}
    <div class="panel">
      <h2>Observaciones adicionales</h2>
      <div style="padding:16px">
        <textarea class="obs" id="notas" rows="3" ${cerrado ? 'disabled' : ''}
          placeholder="Cualquier detalle que no encaje en los ítems de arriba">${esc(llenado.notas || '')}</textarea>
        ${tiraFotos(null, '-', { soloLectura: cerrado })}
      </div>
    </div>
    ${tocaFirmar ? pintarFirmas(plantilla, llenado, cerrado) : ''}
    <div class="pie">
      <span class="resumen" id="resumen"></span>
      <span class="guardado" id="guardado">Guardado</span>
      ${cerrado
        ? '<button class="btn" data-ir-lista>Volver</button>'
        : !puedeCerrar
          ? `<span class="nota-mando">${porEtapas && !enRuta
              ? 'La salida la autoriza un Team Leader'
              : 'El cierre lo hace un Team Leader'}</span>
             <button class="btn" data-ir-lista>Volver</button>`
          : porEtapas && !enRuta
            ? '<button class="btn primario" id="autorizar-salida">Autorizar salida</button>'
            : '<button class="btn primario" id="cerrar-checklist">Cerrar y enviar</button>'}
    </div>`;

  vista.querySelectorAll('[data-ir-lista]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = listaDeRegreso(); });
  });

  if (!cerrado) {
    conectarFirmas(plantilla);
    document.getElementById('notas').addEventListener('input', (e) => guardarNotas(e.target.value));
    document.getElementById('cerrar-checklist')?.addEventListener('click', cerrarChecklist);
    document.getElementById('autorizar-salida')?.addEventListener('click', autorizarSalida);
  }
  cargarImagenesPendientes();
  actualizarResumen();
}

// Una plantilla con cabecera vive dentro de su propia pantalla; el resto
// regresa a la portada de checklists.
const listaDeRegreso = () => (estado.plantilla && estado.plantilla.campos && estado.plantilla.campos.length
  ? `#/envios/${estado.plantilla.clave}`
  : '#/checklists');

async function autorizarSalida() {
  await descargarPendientes();
  const boton = document.getElementById('autorizar-salida');
  boton.disabled = true;
  try {
    await api('POST', `/api/llenados/${estado.llenado.id}/autorizar-salida`);
    mostrarMensaje('Salida autorizada. El proceso queda abierto hasta el regreso.', 'exito');
    setTimeout(() => { location.hash = listaDeRegreso(); }, 1200);
  } catch (err) {
    mostrarMensaje(err.message, 'error');
    boton.disabled = false;
  }
}

// --- captura tipo 'items': un renglón por ítem, dos botones grandes ---

const MOMENTO = {
  antes: { etiqueta: 'Antes de salir', clase: 'ambar' },
  despues: { etiqueta: 'Al concluir la entrega', clase: 'azul' },
};

// Un ítem de documento no se contesta, se adjunta: en vez de Bien/Problema
// muestra sus archivos y el botón para cargar.
function pintarDocumento(item, soloLectura) {
  const archivos = fotosDe(item.id, '-');
  const momento = MOMENTO[item.meta.momento];
  return `
    <div class="item documento ${archivos.length ? '' : 'pendiente'}" data-item="${item.id}">
      <span class="texto">
        <b>${esc(item.texto)}</b>
        ${momento ? `<span class="etiqueta ${momento.clase}">${momento.etiqueta}</span>` : ''}
        ${item.meta.ayuda ? `<small>${esc(item.meta.ayuda)}</small>` : ''}
      </span>
      <span class="estado-doc">
        ${archivos.length
          ? `<span class="etiqueta verde">${archivos.length} archivo(s)</span>`
          : '<span class="etiqueta roja">Pendiente</span>'}
      </span>
      ${tiraArchivos(item.id, soloLectura)}
    </div>`;
}

const ETIQUETA_ETAPA = { salida: 'Antes de salir', regreso: 'Al regresar' };

const SELLO_SECCION = {
  registrada: '<span class="etiqueta verde">Registrada al salir</span>',
  despues: '<span class="etiqueta azul">Se completa al regresar</span>',
};

function pintarItems(plantilla, soloLectura, estadoSeccion = () => 'activa') {
  return plantilla.secciones.map((seccion) => {
    const situacion = soloLectura ? 'cerrada' : estadoSeccion(seccion);
    const congelada = situacion !== 'activa';
    return `
    <section class="panel ${congelada && !soloLectura ? 'congelada' : ''}">
      <h2>${esc(seccion.titulo)} ${SELLO_SECCION[situacion] || ''}</h2>
      ${seccion.items.map((item) => {
        if (item.tipo_respuesta === 'documento') return pintarDocumento(item, congelada);
        const r = estado.respuestas.get(llave(item.id, '-')) || {};
        const esProblema = r.valor === 'problema' || r.valor === 'no';
        const [bueno, malo] = item.tipo_respuesta === 'revisado'
          ? [['si', 'Sí'], ['no', 'No']]
          : [['ok', 'Bien'], ['problema', 'Problema']];
        return `
          <div class="item ${esProblema ? 'marcado-problema' : ''}" data-item="${item.id}">
            <span class="texto">${esc(item.texto)}</span>
            <span class="opciones">
              <button class="opcion buena" data-valor="${bueno[0]}"
                      aria-pressed="${r.valor === bueno[0]}" ${congelada ? 'disabled' : ''}>${bueno[1]}</button>
              <button class="opcion mala" data-valor="${malo[0]}"
                      aria-pressed="${r.valor === malo[0]}" ${congelada ? 'disabled' : ''}>${malo[1]}</button>
            </span>
            <textarea class="obs ${esProblema && !r.observacion ? 'requerida' : ''}" rows="1"
                      ${esProblema ? '' : 'hidden'} ${congelada ? 'disabled' : ''}
                      placeholder="¿Qué se encontró? (obligatorio)">${esc(r.observacion || '')}</textarea>
            ${tiraFotos(item.id, '-', {
              obligatoria: esProblema && plantilla.foto_obligatoria && item.tipo_respuesta === 'ok_problema',
              soloLectura: congelada,
              oculta: !esProblema,
            })}
          </div>`;
      }).join('')}
    </section>`;
  }).join('');
}

// --- captura tipo 'matriz': conteo numérico por día (checklist de Cajas) ---

function pintarMatriz(plantilla, soloLectura) {
  const columnas = plantilla.columnas;
  return plantilla.secciones.map((seccion) => `
    <section class="panel">
      <h2>${esc(seccion.titulo)}</h2>
      <div class="desliza">
        <table class="captura">
          <thead>
            <tr>
              <th class="fila-titulo">Modelo</th>
              <th>Tipo</th>
              ${columnas.map((c) => `<th>${esc(c.etiqueta)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${seccion.items.map((item) => `
              <tr data-item="${item.id}">
                <td class="fila-titulo">${esc(item.texto)}</td>
                <td>${esc(item.meta.tipo || '')}</td>
                ${columnas.map((c) => {
                  const r = estado.respuestas.get(llave(item.id, c.clave)) || {};
                  return `<td><input type="number" inputmode="numeric" step="1"
                            data-columna="${c.clave}" value="${esc(r.valor ?? '')}"
                            ${soloLectura ? 'disabled' : ''}></td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`).join('');
}

// --- captura tipo 'grid_semanal': casillas L-V por actividad (Avisos) ---

function pintarGrid(plantilla, soloLectura) {
  const columnas = plantilla.columnas;
  return `
    <section class="panel">
      <div class="desliza">
        <table class="captura">
          <thead>
            <tr>
              <th class="fila-titulo">Actividad</th>
              ${columnas.map((c) => `<th>${esc(c.etiqueta)}</th>`).join('')}
              <th style="min-width:200px">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            ${plantilla.secciones.map((seccion) => `
              <tr class="grupo"><td colspan="${columnas.length + 2}">${esc(seccion.titulo)}</td></tr>
              ${seccion.items.map((item) => `
                <tr data-item="${item.id}">
                  <td class="fila-titulo">${esc(item.texto)}</td>
                  ${columnas.map((c) => {
                    const r = estado.respuestas.get(llave(item.id, c.clave)) || {};
                    return `<td><button class="casilla" data-columna="${c.clave}"
                              aria-pressed="${r.valor === 'si'}" ${soloLectura ? 'disabled' : ''}>✓</button></td>`;
                  }).join('')}
                  <td>
                    <input type="text" data-columna="obs-general"
                        value="${esc((estado.respuestas.get(llave(item.id, 'obs-general')) || {}).observacion || '')}"
                        ${soloLectura ? 'disabled' : ''} style="text-align:left">
                    ${tiraFotos(item.id, 'obs-general', { soloLectura })}
                  </td>
                </tr>`).join('')}
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

// --- guardado automático ---

let temporizador = null;
const pendientes = new Map();

function marcar(itemId, columna, cambios) {
  const k = llave(itemId, columna);
  const actual = estado.respuestas.get(k) || { valor: null, observacion: null };
  const nuevo = { ...actual, ...cambios };
  estado.respuestas.set(k, nuevo);
  pendientes.set(k, { item_id: itemId, columna: columna || '-', ...nuevo });

  clearTimeout(temporizador);
  temporizador = setTimeout(descargarPendientes, 500);
  actualizarResumen();
}

async function descargarPendientes() {
  if (!pendientes.size || !estado.llenado) return;
  const lote = [...pendientes.values()];
  pendientes.clear();
  try {
    await api('PUT', `/api/llenados/${estado.llenado.id}/respuestas`, { respuestas: lote });
    const señal = document.getElementById('guardado');
    if (señal) {
      señal.classList.add('visible');
      setTimeout(() => señal.classList.remove('visible'), 1200);
    }
  } catch (err) {
    lote.forEach((r) => pendientes.set(llave(r.item_id, r.columna), r)); // reintenta en el próximo cambio
    mostrarMensaje(err.message, 'error');
  }
}

let temporizadorNotas = null;
function guardarNotas(texto) {
  clearTimeout(temporizadorNotas);
  temporizadorNotas = setTimeout(() => {
    api('PUT', `/api/llenados/${estado.llenado.id}/notas`, { notas: texto }).catch(() => {});
  }, 700);
}

// Se conecta UNA sola vez al arrancar, por delegación sobre #vista. Si se
// reconectara en cada vista, los listeners se acumularían y cada toque contaría
// varias veces. En modo consulta los controles van deshabilitados, así que no
// disparan eventos.
function conectarCaptura() {
  vista.addEventListener('click', (e) => {
    const opcion = e.target.closest('.opcion');
    if (opcion) {
      const fila = opcion.closest('.item');
      const itemId = Number(fila.dataset.item);
      const valor = opcion.dataset.valor;
      const yaEstaba = opcion.getAttribute('aria-pressed') === 'true';
      const nuevoValor = yaEstaba ? null : valor;

      fila.querySelectorAll('.opcion').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      if (nuevoValor) opcion.setAttribute('aria-pressed', 'true');

      const esProblema = nuevoValor === 'problema' || nuevoValor === 'no';
      const obs = fila.querySelector('.obs');
      fila.classList.toggle('marcado-problema', esProblema);
      obs.hidden = !esProblema;
      obs.classList.toggle('requerida', esProblema && !obs.value.trim());
      if (esProblema) obs.focus();

      // La tira de evidencia aparece junto con el problema. Solo es obligatoria
      // en ítems de condición física (los que ofrecen "Problema"); en los de
      // tarea ("Sí/No") un No es un pendiente, no algo que se pueda fotografiar.
      const tira = fila.querySelector('.evidencia');
      if (tira) {
        const esCondicion = fila.querySelector('.opcion.mala').dataset.valor === 'problema';
        refrescarTira(tira, {
          obligatoria: esProblema && esCondicion && !!estado.plantilla.foto_obligatoria,
          oculta: !esProblema,
        });
      }

      marcar(itemId, '-', { valor: nuevoValor });
      return;
    }

    const camara = e.target.closest('.btn-camara');
    if (camara) {
      cajaDestino = camara.closest('.evidencia');
      // Los documentos abren el selector de archivos; la evidencia, la cámara.
      (camara.hasAttribute('data-cargar-doc') ? selectorDocs : selectorFotos).click();
      return;
    }

    const pdf = e.target.closest('[data-abrir]');
    if (pdf) {
      abrirPDF(pdf.dataset.abrir);
      return;
    }

    const quitar = e.target.closest('[data-quitar]');
    if (quitar) {
      const caja = quitar.closest('.evidencia');
      const id = Number(quitar.dataset.quitar);
      api('DELETE', `/api/fotos/${id}`)
        .then(() => {
          for (const [k, lista] of estado.fotos) {
            estado.fotos.set(k, lista.filter((f) => f.id !== id));
          }
          refrescarTira(caja);
        })
        .catch((err) => mostrarMensaje(err.message, 'error'));
      return;
    }

    const miniatura = e.target.closest('.mini img');
    if (miniatura && miniatura.src) {
      ampliarFoto(miniatura.src);
    }

    // Solo las casillas de captura (las del grid semanal, que llevan columna).
    // La matriz de permisos usa la misma clase pero con data-permiso, y sin este
    // filtro un clic ahí disparaba además este manejador y mandaba respuestas
    // basura al checklist que estuviera abierto.
    const casilla = e.target.closest('.casilla[data-columna]');
    if (casilla) {
      const encendida = casilla.getAttribute('aria-pressed') === 'true';
      casilla.setAttribute('aria-pressed', String(!encendida));
      marcar(Number(casilla.closest('tr').dataset.item), casilla.dataset.columna, { valor: encendida ? null : 'si' });
    }
  });

  vista.addEventListener('input', (e) => {
    const obs = e.target.closest('.item .obs');
    if (obs) {
      const fila = obs.closest('.item');
      obs.classList.toggle('requerida', fila.classList.contains('marcado-problema') && !obs.value.trim());
      marcar(Number(fila.dataset.item), '-', { observacion: obs.value });
      return;
    }

    const celda = e.target.closest('td [data-columna]');
    if (celda) {
      const itemId = Number(celda.closest('tr').dataset.item);
      if (celda.dataset.columna === 'obs-general') {
        marcar(itemId, 'obs-general', { observacion: celda.value });
      } else {
        marcar(itemId, celda.dataset.columna, { valor: celda.value === '' ? null : celda.value });
      }
    }
  });
}

function actualizarResumen() {
  const zona = document.getElementById('resumen');
  if (!zona || !estado.plantilla) return;

  // En un checklist por etapas el pie habla de la etapa en curso: pedir los dos
  // documentos antes de salir confundiría, porque el de regreso aún no toca.
  const secciones = estado.etapaActiva
    ? estado.plantilla.secciones.filter((s) => s.etapa === estado.etapaActiva)
    : estado.plantilla.secciones;

  // Los ítems de documento no se contestan, se adjuntan: cuentan como resueltos
  // cuando ya tienen archivo, no cuando tienen valor.
  const todos = secciones.flatMap((s) => s.items);
  const documentos = todos.filter((i) => i.tipo_respuesta === 'documento');
  const documentosListos = documentos.filter((i) => fotosDe(i.id, '-').length > 0).length;

  const columnas = estado.plantilla.columnas.length;
  // Se cuentan solo las respuestas de los ítems visibles en esta etapa.
  const idsEtapa = new Set(todos.map((i) => i.id));
  const respuestasEtapa = [...estado.respuestas.entries()]
    .filter(([k]) => idsEtapa.has(Number(k.split('|')[0])))
    .map(([, r]) => r);

  const respondidos = respuestasEtapa.filter((r) => r.valor !== null && r.valor !== undefined && r.valor !== '').length;
  const problemas = respuestasEtapa.filter((r) => r.valor === 'problema' || r.valor === 'no').length;

  const contestables = todos.length - documentos.length;
  const meta = estado.plantilla.tipo_captura === 'items' ? contestables : contestables * columnas;

  // Una etapa puede no tener ítems que contestar —el regreso solo pide un
  // documento—; en ese caso el contador sobra.
  const partes = meta > 0 ? [`${respondidos} de ${meta} capturados`] : [];
  if (documentos.length) {
    const faltan = documentos.length - documentosListos;
    partes.push(faltan
      ? `<b style="color:var(--alerta)">falta${faltan > 1 ? 'n' : ''} ${faltan} documento${faltan > 1 ? 's' : ''}</b>`
      : `<b style="color:var(--ok)">documentos completos</b>`);
  }
  if (problemas) partes.push(`<b style="color:var(--alerta)">${problemas} con problema</b>`);
  zona.innerHTML = partes.join(' · ');
}

function mostrarMensaje(texto, tipo) {
  const zona = document.getElementById('mensajes');
  if (!zona) return;
  zona.innerHTML = `<div class="aviso ${tipo}">${esc(texto)}</div>`;
  zona.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (tipo === 'exito') setTimeout(() => { zona.innerHTML = ''; }, 4000);
}

async function cerrarChecklist() {
  await descargarPendientes();
  const boton = document.getElementById('cerrar-checklist');
  boton.disabled = true;
  try {
    await api('POST', `/api/llenados/${estado.llenado.id}/cerrar`);
    mostrarMensaje('Checklist cerrado y enviado.', 'exito');
    setTimeout(() => { location.hash = listaDeRegreso(); }, 900);
  } catch (err) {
    mostrarMensaje(err.message, 'error');
    boton.disabled = false;
  }
}

// --- firmas ---

function pintarFirmas(plantilla, llenado, soloLectura) {
  // La clave 'coordinador' se conserva en la base por compatibilidad, pero en
  // pantalla es la firma de autorización que levanta el Team Leader.
  const roles = [];
  if (plantilla.firma_operador) roles.push(['operador', 'Firma del operador', 'firmar_operador']);
  if (plantilla.firma_coordinador) roles.push(['coordinador', 'Firma de autorización (Team Leader)', 'firmar_supervision']);
  if (!roles.length) return '';

  return roles.map(([rol, etiqueta, permisoFirma]) => {
    const firma = llenado.firmas.find((f) => f.rol === rol);

    // Sin permiso no se muestra el recuadro para firmar: el operador captura y
    // cierra su parte, y el Team Leader autoriza después desde su sesión.
    if (!firma && !soloLectura && !permiso(permisoFirma)) {
      return `
        <section class="panel">
          <h2>${etiqueta}</h2>
          <div class="vacio">Pendiente. La levanta un Team Leader o el Administrador desde su sesión.</div>
        </section>`;
    }

    if (firma || soloLectura) {
      return `
        <section class="panel">
          <h2>${etiqueta}</h2>
          ${firma ? `<div class="firma-lista"><figure>
              <img src="${esc(firma.imagen)}" alt="Firma de ${esc(firma.nombre)}">
              <figcaption>${esc(firma.nombre)} · ${new Date(firma.firmado_en).toLocaleString('es-MX')}</figcaption>
            </figure></div>`
            : '<div class="vacio">Sin firmar</div>'}
        </section>`;
    }
    return `
      <section class="panel">
        <h2>${etiqueta}</h2>
        <div class="firma-caja" data-firma="${rol}">
          <canvas></canvas>
          <div class="acciones">
            <input class="obs" style="flex:1;min-height:auto" placeholder="Nombre de quien firma"
                   value="${rol === 'operador' ? esc(estado.usuario.nombre) : ''}">
            <button class="btn" data-limpiar>Borrar</button>
            <button class="btn primario" data-guardar-firma>Guardar firma</button>
          </div>
        </div>
      </section>`;
  }).join('');
}

function conectarFirmas() {
  vista.querySelectorAll('[data-firma]').forEach((caja) => {
    const lienzo = caja.querySelector('canvas');
    const ctx = lienzo.getContext('2d');
    let dibujando = false;
    let hayTrazo = false;

    // El canvas se escala al ancho real del dispositivo para que la firma no
    // salga pixeleada en pantallas de alta densidad.
    const ajustar = () => {
      const escala = window.devicePixelRatio || 1;
      const caja_ = lienzo.getBoundingClientRect();
      lienzo.width = caja_.width * escala;
      lienzo.height = caja_.height * escala;
      ctx.scale(escala, escala);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#16202e';
    };
    ajustar();

    const punto = (e) => {
      const r = lienzo.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    lienzo.addEventListener('pointerdown', (e) => {
      dibujando = true;
      hayTrazo = true;
      lienzo.setPointerCapture(e.pointerId);
      ctx.beginPath();
      ctx.moveTo(...punto(e));
    });
    lienzo.addEventListener('pointermove', (e) => {
      if (!dibujando) return;
      e.preventDefault();
      ctx.lineTo(...punto(e));
      ctx.stroke();
    });
    lienzo.addEventListener('pointerup', () => { dibujando = false; });
    lienzo.addEventListener('pointerleave', () => { dibujando = false; });

    caja.querySelector('[data-limpiar]').addEventListener('click', () => {
      ctx.clearRect(0, 0, lienzo.width, lienzo.height);
      hayTrazo = false;
    });

    caja.querySelector('[data-guardar-firma]').addEventListener('click', async () => {
      const nombre = caja.querySelector('input').value.trim();
      if (!hayTrazo) return mostrarMensaje('Dibuja la firma antes de guardarla.', 'error');
      if (!nombre) return mostrarMensaje('Escribe el nombre de quien firma.', 'error');
      try {
        await api('POST', `/api/llenados/${estado.llenado.id}/firma`, {
          rol: caja.dataset.firma,
          nombre,
          imagen: lienzo.toDataURL('image/png'),
        });
        mostrarMensaje('Firma guardada.', 'exito');
        caja.innerHTML = '<div class="firma-lista"><figure>'
          + `<img src="${lienzo.toDataURL('image/png')}" alt="Firma">`
          + `<figcaption>${esc(nombre)} · ahora</figcaption></figure></div>`;
      } catch (err) {
        mostrarMensaje(err.message, 'error');
      }
    });
  });
}

// =========================================================== vista: reportes

async function vistaReportes() {
  encabezado('Reportes', 'Historial y problemas detectados');
  const [problemas, historial] = await Promise.all([
    api('GET', '/api/reportes/problemas'),
    api('GET', '/api/reportes/historial'),
  ]);

  vista.innerHTML = `
    <div class="panel">
      <h2>Problemas detectados</h2>
      ${problemas.length === 0 ? '<div class="vacio">Sin problemas reportados.</div>' : `
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Ítem</th><th>Checklist</th><th>Unidad</th>
          <th>Periodo</th><th>Reportó</th><th style="min-width:220px">Observación</th><th>Evidencia</th>
        </tr></thead>
        <tbody>${problemas.map((p) => `
          <tr>
            <td class="fila-titulo">${esc(p.item)}<br><small style="color:var(--tinta-suave)">${esc(p.seccion)}</small></td>
            <td>${esc(p.plantilla)}</td>
            <td>${esc(p.unidad || '—')}</td>
            <td>${esc(p.periodo)}</td>
            <td>${esc(p.reporto)}</td>
            <td style="text-align:left">${esc(p.observacion || '—')}</td>
            <td><div class="miniaturas">${(p.fotos ? p.fotos.split('|') : [])
              .map((a) => `<figure class="mini"><img data-archivo="${esc(a)}" alt="Evidencia"></figure>`).join('')
              || '<span class="nota-foto">—</span>'}</div></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="panel">
      <h2>Historial de llenados</h2>
      ${historial.length === 0 ? '<div class="vacio">Todavía no hay checklists llenados.</div>' : `
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Checklist</th><th>Unidad</th><th>Periodo</th>
          <th>Elaboró</th><th>Estado</th><th>Problemas</th><th></th>
        </tr></thead>
        <tbody>${historial.map((h) => `
          <tr>
            <td class="fila-titulo">${esc(h.plantilla)}</td>
            <td>${esc(h.unidad || '—')}</td>
            <td>${esc(h.periodo)}</td>
            <td>${esc(h.elaboro)}</td>
            <td><span class="etiqueta ${h.estado === 'cerrado' ? 'verde' : 'ambar'}">${h.estado === 'cerrado' ? 'Cerrado' : 'Borrador'}</span></td>
            <td>${h.problemas ? `<span class="etiqueta roja">${h.problemas}</span>` : '—'}</td>
            <td><button class="btn" data-ver="${esc(h.plantilla_clave)}" data-id="${h.id}">Ver</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="fila-botones">
      <a class="btn" id="descargar" href="#">Descargar todo en Excel (CSV)</a>
    </div>`;

  // La descarga necesita el token; fetch + blob en lugar de un enlace directo.
  document.getElementById('descargar').addEventListener('click', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/exportar.csv', { headers: { Authorization: `Bearer ${estado.token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `checklists-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  });

  vista.querySelectorAll('[data-ver]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/detalle/${b.dataset.id}`; });
  });
  cargarImagenesPendientes();
}

async function vistaDetalle(id) {
  const d = await api('GET', `/api/llenados/${id}/detalle`);
  estado.plantilla = d.plantilla;
  estado.llenado = d;
  estado.respuestas = new Map(
    d.respuestas.map((r) => [llave(r.item_id, r.columna), { valor: r.valor, observacion: r.observacion }])
  );
  indexarFotos(d.fotos);

  encabezado(`${d.plantilla_nombre}${d.unidad ? ` · ${d.unidad}` : ''}`, `${d.periodo} · Elaboró ${d.elaboro}`);

  const cuerpo = { items: pintarItems, matriz: pintarMatriz, grid_semanal: pintarGrid }[d.tipo_captura](d.plantilla, true);
  vista.innerHTML = `
    ${cuerpo}
    ${d.notas ? `<div class="panel"><h2>Observaciones adicionales</h2><div style="padding:16px">${esc(d.notas)}</div></div>` : ''}
    ${pintarFirmas(d.plantilla, d, true)}
    <div class="pie"><span class="resumen"></span><button class="btn" id="volver">Volver a reportes</button></div>`;
  document.getElementById('volver').addEventListener('click', () => { location.hash = '#/reportes'; });
  cargarImagenesPendientes();
}

// ========================================================= vista: comparativa

// Un delta solo se puede calcular contra algo. Cuando una de las dos semanas no
// tiene el dato, se muestra un guion en vez de inventar un 0 que parecería una
// mejora ("bajó de 3 a 0") cuando en realidad nadie llenó el checklist.
function delta(anterior, actual, { menosEsMejor = true } = {}) {
  if (anterior == null || actual == null) return '<span class="delta neutra">—</span>';
  const d = actual - anterior;
  if (d === 0) return '<span class="delta neutra">sin cambio</span>';
  const mejora = menosEsMejor ? d < 0 : d > 0;
  return `<span class="delta ${mejora ? 'buena' : 'mala'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}</span>`;
}

async function vistaComparativa() {
  encabezado('Comparativa entre semanas', estado.usuario.etiqueta_rol || '');

  const { semanas } = await api('GET', '/api/reportes/periodos');
  if (semanas.length < 2) {
    vista.innerHTML = `<div class="panel"><div class="vacio">
      Todavía no hay suficientes semanas capturadas para comparar.<br>
      Se necesitan al menos dos semanas con checklists llenados.
    </div></div>`;
    return;
  }

  // Por omisión, las cuatro más recientes: suficiente para ver una tendencia sin
  // que la tabla se vuelva ilegible en pantalla de tablet.
  const guardadas = JSON.parse(sessionStorage.getItem('semanasComparadas') || 'null');
  const validas = (guardadas || []).filter((s) => semanas.some((x) => x.clave === s));
  const elegidas = validas.length >= 2 ? validas : semanas.slice(0, 4).map((s) => s.clave).reverse();

  vista.innerHTML = `
    <div class="panel">
      <h2>Semanas a comparar</h2>
      <div class="selector-semanas">
        ${semanas.map((s) => `
          <label class="chip">
            <input type="checkbox" value="${esc(s.clave)}" ${elegidas.includes(s.clave) ? 'checked' : ''}>
            <span>${esc(s.etiqueta)}</span>
          </label>`).join('')}
      </div>
    </div>
    <div id="resultado"><div class="vacio">Cargando…</div></div>`;

  const casillas = [...vista.querySelectorAll('.selector-semanas input')];
  const cargar = async () => {
    const sel = casillas.filter((c) => c.checked).map((c) => c.value).sort();
    sessionStorage.setItem('semanasComparadas', JSON.stringify(sel));
    const destino = document.getElementById('resultado');

    if (sel.length < 2) {
      destino.innerHTML = '<div class="aviso error">Elige al menos dos semanas.</div>';
      return;
    }
    destino.innerHTML = '<div class="vacio">Calculando…</div>';
    try {
      destino.innerHTML = pintarComparativa(await api('GET', `/api/reportes/comparativa?semanas=${sel.join(',')}`));
    } catch (err) {
      destino.innerHTML = avisoError(err.message);
    }
  };

  casillas.forEach((c) => c.addEventListener('change', cargar));
  cargar();
}

function pintarComparativa(d) {
  const claves = d.semanas.map((s) => s.clave);
  const primera = claves[0];
  const ultima = claves[claves.length - 1];
  const corta = (clave) => 'S' + clave.split('-W')[1];

  const resumenPor = Object.fromEntries(d.resumen.map((r) => [r.semana, r]));
  const dato = (clave, campo) => (resumenPor[clave] ? resumenPor[clave][campo] : null);

  // --- pivote: filas de checklist/unidad × columnas de semana ---
  const filas = new Map();
  for (const p of d.porUnidad) {
    const k = `${p.plantilla}||${p.unidad}`;
    if (!filas.has(k)) filas.set(k, { plantilla: p.plantilla, unidad: p.unidad, valores: {} });
    filas.get(k).valores[p.semana] = p.problemas;
  }

  const insumosPor = new Map();
  for (const i of d.insumos) {
    if (!insumosPor.has(i.material)) insumosPor.set(i.material, { material: i.material, tipo: i.tipo, valores: {} });
    insumosPor.get(i.material).valores[i.semana] = Number(i.cierre);
  }

  const faltantes = d.esperados.filter((e) => e.estado === 'sin hacer');
  const maxProblemas = Math.max(1, ...claves.map((c) => dato(c, 'problemas') || 0));

  const tarjeta = (titulo, campo, opciones) => `
    <div class="indicador">
      <span class="rotulo">${titulo}</span>
      <b>${dato(ultima, campo) ?? 0}</b>
      <span class="pie-ind">${corta(primera)}: ${dato(primera, campo) ?? 0} → ${corta(ultima)}: ${dato(ultima, campo) ?? 0}
        ${delta(dato(primera, campo), dato(ultima, campo), opciones)}</span>
    </div>`;

  return `
    <div class="panel">
      <h2>Resumen · ${esc(d.semanas[0].etiqueta)} vs ${esc(d.semanas[d.semanas.length - 1].etiqueta)}</h2>
      <div class="indicadores">
        ${tarjeta('Problemas detectados', 'problemas', { menosEsMejor: true })}
        ${tarjeta('Checklists cerrados', 'cerrados', { menosEsMejor: false })}
        ${tarjeta('Fotos de evidencia', 'fotos', { menosEsMejor: false })}
      </div>
      <div class="tendencia">
        ${claves.map((c) => {
          const n = dato(c, 'problemas') || 0;
          return `<div class="barra-col" title="${esc(describirCorto(d, c))}: ${n} problema(s)">
              <span class="valor">${n}</span>
              <div class="barra" style="height:${Math.round((n / maxProblemas) * 100)}%"></div>
              <span class="eje">${corta(c)}</span>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="panel">
      <h2>Problemas por checklist y unidad</h2>
      ${filas.size === 0 ? '<div class="vacio">Ninguna de las semanas elegidas registró problemas.</div>' : `
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Checklist / Unidad</th>
          ${claves.map((c) => `<th>${corta(c)}</th>`).join('')}
          <th>${corta(primera)} → ${corta(ultima)}</th>
        </tr></thead>
        <tbody>${[...filas.values()].map((f) => `
          <tr>
            <td class="fila-titulo">${esc(f.plantilla)}<br><small style="color:var(--tinta-suave)">${esc(f.unidad)}</small></td>
            ${claves.map((c) => `<td class="${f.valores[c] ? 'con-problema' : ''}">${f.valores[c] ?? 0}</td>`).join('')}
            <td>${delta(f.valores[primera] ?? 0, f.valores[ultima] ?? 0)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="panel">
      <h2>Problemas recurrentes</h2>
      ${d.recurrentes.length === 0
        ? '<div class="vacio">Ningún ítem falló en más de una de las semanas elegidas.</div>'
        : `<p class="explica">Ítems que volvieron a fallar en varias de las semanas comparadas. Son los que no se están atendiendo.</p>
        <div class="desliza"><table class="captura">
          <thead><tr>
            <th class="fila-titulo">Ítem</th><th>Unidad</th><th>Semanas</th>
            <th>Cuáles</th><th style="min-width:200px">Última observación</th>
          </tr></thead>
          <tbody>${d.recurrentes.map((r) => `
            <tr>
              <td class="fila-titulo">${esc(r.item)}<br><small style="color:var(--tinta-suave)">${esc(r.plantilla)} · ${esc(r.seccion)}</small></td>
              <td>${esc(r.unidad)}</td>
              <td><span class="etiqueta roja">${r.veces}×</span></td>
              <td>${r.semanas.map(corta).join(', ')}</td>
              <td style="text-align:left">${esc(r.ultima_observacion || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
    </div>

    <div class="panel">
      <h2>Insumos · cierre de semana</h2>
      ${insumosPor.size === 0 ? '<div class="vacio">No hay cierres de semana capturados en el checklist de Cajas.</div>' : `
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Material</th><th>Tipo</th>
          ${claves.map((c) => `<th>${corta(c)}</th>`).join('')}
          <th>${corta(primera)} → ${corta(ultima)}</th>
        </tr></thead>
        <tbody>${[...insumosPor.values()].map((m) => `
          <tr>
            <td class="fila-titulo">${esc(m.material)}</td>
            <td>${esc(m.tipo)}</td>
            ${claves.map((c) => `<td>${m.valores[c] ?? '—'}</td>`).join('')}
            <td>${delta(m.valores[primera], m.valores[ultima], { menosEsMejor: false })}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="panel">
      <h2>Checklists semanales sin hacer</h2>
      ${faltantes.length === 0
        ? '<div class="vacio">Todos los checklists semanales se abrieron en las semanas comparadas.</div>'
        : `<div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Checklist</th><th>Unidad</th><th>Semana</th></tr></thead>
          <tbody>${faltantes.map((f) => `
            <tr><td class="fila-titulo">${esc(f.plantilla)}</td><td>${esc(f.unidad)}</td>
                <td><span class="etiqueta roja">${corta(f.semana)}</span></td></tr>`).join('')}
          </tbody>
        </table></div>`}
    </div>`;
}

const describirCorto = (d, clave) => (d.semanas.find((s) => s.clave === clave) || {}).etiqueta || clave;

// ======================================================= vista: configuración

// Antes eran dos tablas larguísimas una tras otra. Ahora cada cosa vive en su
// pestaña y la dirección la recuerda (#/config/unidades), así que se puede
// volver directo a una sección.
const PESTANAS_CONFIG = [
  { clave: 'personas', etiqueta: 'Personas', pintar: configPersonas },
  { clave: 'permisos', etiqueta: 'Permisos', pintar: configPermisos },
  { clave: 'unidades', etiqueta: 'Unidades', pintar: configUnidades },
  { clave: 'checklists', etiqueta: 'Checklists', pintar: configChecklists },
];

// Matriz persona × permiso. Cada casilla es el permiso efectivo: si difiere de
// lo que da el perfil, se marca para que se vea que es un ajuste manual.
async function configPermisos(destino) {
  const { usuarios, roles, catalogo_permisos: catalogo } = await api('GET', '/api/admin/catalogos');
  const basePerfil = Object.fromEntries(roles.map((r) => [r.clave, r.permisos || {}]));
  const activos = usuarios.filter((u) => u.activo);

  const columnas = catalogo.flatMap((g) => g.permisos);

  destino.innerHTML = `
    <div class="panel">
      <h2>Permisos por persona</h2>
      <p class="explica">
        Marca o desmarca lo que quieras. El fondo azul indica un ajuste manual —
        algo que le diste o le quitaste respecto a lo que trae su perfil.
        <b>Restablecer</b> lo devuelve a su perfil.
      </p>
      <div class="desliza"><table class="captura matriz-permisos">
        <thead>
          <tr>
            <th class="fila-titulo" rowspan="2">Persona</th>
            ${catalogo.map((g) => `<th colspan="${g.permisos.length}">${esc(g.grupo)}</th>`).join('')}
            <th rowspan="2"></th>
          </tr>
          <tr>${columnas.map((c) => `<th class="vertical"><span>${esc(c.etiqueta)}</span></th>`).join('')}</tr>
        </thead>
        <tbody>
          ${activos.map((u) => `
            <tr data-persona="${u.id}">
              <td class="fila-titulo">${esc(u.nombre)}<br>
                <small style="color:var(--tinta-suave)">${esc((roles.find((r) => r.clave === u.rol) || {}).etiqueta || u.rol)}</small>
              </td>
              ${columnas.map((c) => {
                const efectivo = !!u.permisos[c.clave];
                const delPerfil = !!(basePerfil[u.rol] || {})[c.clave];
                const ajustado = Object.prototype.hasOwnProperty.call(u.permisos_extra, c.clave)
                  && u.permisos_extra[c.clave] !== delPerfil;
                return `<td class="${ajustado ? 'ajustado' : ''}">
                  <button class="casilla" data-permiso="${esc(c.clave)}"
                          aria-pressed="${efectivo}"
                          title="${esc(c.etiqueta)}${ajustado ? ' — ajuste manual' : ''}">✓</button>
                </td>`;
              }).join('')}
              <td>
                ${Object.keys(u.permisos_extra).length
                  ? '<button class="btn" data-restablecer style="padding:7px 12px;font-size:13.5px">Restablecer</button>'
                  : '<span style="color:var(--tinta-suave)">—</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  const guardar = async (fila, cuerpo) => {
    try {
      await api('PUT', `/api/admin/usuarios/${fila.dataset.persona}/permiso`, cuerpo);
      await recargarConfig();
    } catch (err) {
      mostrarMensaje(err.message, 'error');
      await recargarConfig();
    }
  };

  destino.querySelectorAll('.casilla[data-permiso]').forEach((b) => {
    b.addEventListener('click', () => {
      const fila = b.closest('[data-persona]');
      guardar(fila, { clave: b.dataset.permiso, valor: b.getAttribute('aria-pressed') !== 'true' });
    });
  });

  destino.querySelectorAll('[data-restablecer]').forEach((b) => {
    b.addEventListener('click', async () => {
      const fila = b.closest('[data-persona]');
      try {
        await api('PUT', `/api/admin/usuarios/${fila.dataset.persona}`, { permisos_extra: {} });
        await recargarConfig();
        mostrarMensaje('Permisos devueltos a los de su perfil.', 'exito');
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
}

async function vistaConfig(pestanaPedida) {
  const pestana = PESTANAS_CONFIG.find((p) => p.clave === pestanaPedida) || PESTANAS_CONFIG[0];
  encabezado('Configuración', `${pestana.etiqueta} · ${estado.usuario.nombre}`);

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-menu>← Menú</button><span>/</span><span>Configuración</span>
    </div>
    <div id="mensajes"></div>
    <div class="pestanas" role="tablist">
      ${PESTANAS_CONFIG.map((p) => `
        <button role="tab" aria-selected="${p.clave === pestana.clave}"
                data-pestana="${p.clave}">${p.etiqueta}</button>`).join('')}
    </div>
    <div id="contenido-config"><div class="vacio">Cargando…</div></div>`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  vista.querySelectorAll('[data-pestana]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/config/${b.dataset.pestana}`; });
  });

  const destino = document.getElementById('contenido-config');
  try {
    await pestana.pintar(destino);
  } catch (err) {
    destino.innerHTML = avisoError(err.message);
  }
}

const recargarConfig = () => vistaConfig(
  (location.hash.match(/^#\/config\/([\w-]+)$/) || [])[1]
);

// --- pestaña: personas ---

async function configPersonas(destino) {
  const { usuarios, roles } = await api('GET', '/api/admin/catalogos');
  const etiquetaRol = Object.fromEntries(roles.map((r) => [r.clave, r.etiqueta]));
  const activas = usuarios.filter((u) => u.activo);
  const bajas = usuarios.filter((u) => !u.activo);

  destino.innerHTML = `
    <div class="panel">
      <h2>${activas.length} persona(s) activa(s)${bajas.length ? ` · ${bajas.length} de baja` : ''}</h2>
      <p class="explica">
        La columna de accesos muestra lo que cada quien puede ver de verdad.
        Las marcadas con <b>★</b> se otorgaron a esa persona en particular;
        las demás vienen incluidas en su perfil.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Nombre</th><th>Perfil</th><th>A qué tiene acceso</th><th>PIN</th>
          <th>Historial</th><th>Estado</th><th>Editar</th>
        </tr></thead>
        <tbody>${usuarios.map((u) => `
          <tr class="${u.activo ? '' : 'inactiva'}">
              <td class="fila-titulo">${esc(u.nombre)}</td>
              <td>${esc(etiquetaRol[u.rol] || u.rol)}</td>
              <td>${u.accesos.length
                ? u.accesos.map((a) => `<span class="etiqueta ${a.origen === 'otorgado' ? 'azul' : ''}"
                    title="${a.origen === 'otorgado' ? 'Otorgado a esta persona' : 'Incluido en su perfil'}"
                    >${esc(a.etiqueta)}${a.origen === 'otorgado' ? ' ★' : ''}</span>`).join(' ')
                : '<span style="color:var(--tinta-suave)">solo su módulo</span>'}</td>
              <td>${u.tiene_pin ? 'Sí' : '—'}</td>
              <td>${u.llenados || u.firmas ? `${u.llenados} llenado(s) · ${u.firmas} firma(s)` : '—'}</td>
              <td>${u.activo ? 'Activo' : '<span class="etiqueta">Baja</span>'}</td>
              <td><button class="icono" data-editar="${u.id}" title="Editar a ${esc(u.nombre)}"
                          aria-label="Editar a ${esc(u.nombre)}">✎</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>

      <div class="bloque-form">
        <h3>Agregar una persona</h3>
        <div class="rejilla-campos">
          <div class="campo"><label for="n-nombre">Nombre</label><input id="n-nombre" placeholder="Ej. Juan Pérez"></div>
          <div class="campo"><label for="n-rol">Perfil</label>
            <select id="n-rol">
              ${roles.map((r) => `<option value="${esc(r.clave)}">${esc(r.etiqueta)}</option>`).join('')}
            </select></div>
          <div class="campo"><label for="n-pin">PIN</label>
            <input id="n-pin" inputmode="numeric" maxlength="8" placeholder="4 a 8 dígitos">
            <small id="nota-pin" style="color:var(--tinta-suave)"></small></div>
        </div>
        <button class="btn primario" id="agregar-usuario">Agregar persona</button>
      </div>
    </div>`;

  const valor = (id) => document.getElementById(id).value.trim();
  const selectorRol = document.getElementById('n-rol');
  const notaPin = document.getElementById('nota-pin');
  const avisarPin = () => {
    const r = roles.find((x) => x.clave === selectorRol.value);
    notaPin.textContent = r && r.exige_pin
      ? 'Obligatorio para este perfil.'
      : 'Opcional. Sin PIN entra tocando su nombre.';
  };
  selectorRol.addEventListener('change', avisarPin);
  avisarPin();

  document.getElementById('agregar-usuario').addEventListener('click', async () => {
    try {
      await api('POST', '/api/admin/usuarios', { nombre: valor('n-nombre'), rol: valor('n-rol'), pin: valor('n-pin') || null });
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  destino.querySelectorAll('[data-editar]').forEach((boton) => {
    boton.addEventListener('click', () => {
      editarPersona(usuarios.find((u) => u.id === Number(boton.dataset.editar)), roles);
    });
  });
}

// --- pestaña: unidades ---

const ETIQUETA_TIPO = { vehiculo: 'Vehículo', montacargas: 'Montacargas' };

async function configUnidades(destino) {
  const { activos } = await api('GET', '/api/admin/catalogos');

  destino.innerHTML = `
    <div class="panel">
      <h2>${activos.length} unidad(es)</h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Nombre</th><th>Clave</th><th>Tipo</th><th>Parámetros del checklist</th></tr></thead>
        <tbody>${activos.map((a) => {
          const attr = Object.entries(JSON.parse(a.atributos)).filter(([, v]) => v);
          return `<tr class="${a.activo ? '' : 'inactiva'}">
            <td class="fila-titulo">${esc(a.nombre)}</td>
            <td>${esc(a.clave)}</td>
            <td>${esc(ETIQUETA_TIPO[a.tipo] || a.tipo)}</td>
            <td style="text-align:left">${attr.length
              ? attr.map(([k, v]) => `<span class="etiqueta">${esc(k)}: ${esc(v)}</span>`).join(' ')
              : '<span style="color:var(--tinta-suave)">sin capturar</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>

      <div class="bloque-form">
        <h3>Agregar una unidad</h3>
        <p class="explica" style="padding:0 0 12px">
          Los parámetros se insertan en el texto de los ítems del checklist:
          la presión aparece como «Presión de llantas 95 psi» para esa unidad.
        </p>
        <div class="rejilla-campos">
          <div class="campo"><label for="a-nombre">Nombre</label><input id="a-nombre" placeholder="Ej. NP300 #2"></div>
          <div class="campo"><label for="a-clave">Clave corta</label><input id="a-clave" placeholder="Ej. NP300-2"></div>
          <div class="campo"><label for="a-tipo">Tipo</label>
            <select id="a-tipo"><option value="vehiculo">Vehículo</option><option value="montacargas">Montacargas</option></select></div>
          <div class="campo"><label for="a-psi">Presión de llantas (psi)</label><input id="a-psi" inputmode="numeric" placeholder="Ej. 95"></div>
          <div class="campo"><label for="a-aceite">Grado de aceite</label><input id="a-aceite" placeholder="Ej. (15W40)"></div>
        </div>
        <button class="btn primario" id="agregar-activo">Agregar unidad</button>
      </div>
    </div>`;

  const valor = (id) => document.getElementById(id).value.trim();
  document.getElementById('agregar-activo').addEventListener('click', async () => {
    try {
      await api('POST', '/api/admin/activos', {
        nombre: valor('a-nombre'), clave: valor('a-clave'), tipo: valor('a-tipo'),
        atributos: { psi: valor('a-psi'), aceite: valor('a-aceite') },
      });
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });
}

// --- pestaña: checklists ---

async function configChecklists(destino) {
  const plantillas = await api('GET', '/api/admin/plantillas');

  destino.innerHTML = `
    <div class="panel">
      <h2>Checklists del sistema</h2>
      <p class="explica">
        Retirar un checklist lo saca de la tablet y de los pendientes, pero
        conserva todo lo ya capturado en Reportes.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Checklist</th><th>Frecuencia</th><th>Ítems</th>
          <th>Llenados</th><th>Exige foto</th><th>En uso</th>
        </tr></thead>
        <tbody>${plantillas.map((p) => `
          <tr class="${p.activo ? '' : 'inactiva'}">
            <td class="fila-titulo">${esc(p.nombre)}<br>
              <small style="color:var(--tinta-suave)">${esc(p.descripcion || '')}</small></td>
            <td>${esc(ETIQUETA_FRECUENCIA[p.frecuencia] || p.frecuencia)}</td>
            <td>${p.items}</td>
            <td>${p.llenados}</td>
            <td><button class="casilla" data-foto="${p.id}" aria-pressed="${!!p.foto_obligatoria}"
                        title="Exigir foto al marcar un problema">✓</button></td>
            <td><button class="casilla" data-activo="${p.id}" aria-pressed="${!!p.activo}"
                        title="Mostrar en la tablet">✓</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  const cambiar = async (id, cambios) => {
    try {
      await api('PUT', `/api/admin/plantillas/${id}`, cambios);
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  };

  destino.querySelectorAll('[data-foto]').forEach((b) => {
    b.addEventListener('click', () => cambiar(b.dataset.foto, { foto_obligatoria: b.getAttribute('aria-pressed') !== 'true' }));
  });
  destino.querySelectorAll('[data-activo]').forEach((b) => {
    b.addEventListener('click', () => cambiar(b.dataset.activo, { activo: b.getAttribute('aria-pressed') !== 'true' }));
  });
}

// Editor de una persona. Se abre encima de la tabla para que en tablet no haya
// que pelear con campos diminutos dentro de una celda.
function editarPersona(persona, roles) {
  const tieneHistorial = persona.llenados > 0 || persona.firmas > 0;

  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Editar persona">
      <h2>Editar a ${esc(persona.nombre)}</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>

        <div class="campo">
          <label for="e-nombre">Nombre</label>
          <input id="e-nombre" value="${esc(persona.nombre)}">
        </div>

        <div class="campo">
          <label for="e-rol">Perfil</label>
          <select id="e-rol">
            ${roles.map((r) => `<option value="${esc(r.clave)}" ${r.clave === persona.rol ? 'selected' : ''}>
              ${esc(r.etiqueta)} — ${esc(r.descripcion)}</option>`).join('')}
          </select>
          <small id="e-nota-rol" style="color:var(--tinta-suave)"></small>
        </div>

        <div class="campo">
          <label for="e-pin">PIN</label>
          <input id="e-pin" inputmode="numeric" maxlength="8"
                 placeholder="${persona.tiene_pin ? 'Tiene PIN. Escribe uno nuevo para cambiarlo' : 'Sin PIN. Escribe uno para asignarlo'}">
          <small style="color:var(--tinta-suave)">Déjalo vacío para no tocarlo.</small>
          ${persona.tiene_pin ? `
            <label class="casilla-texto">
              <input type="checkbox" id="e-quitar-pin"> Quitar el PIN (entrará solo tocando su nombre)
            </label>` : ''}
        </div>

        <div class="campo">
          <label>Permisos</label>
          <small style="color:var(--tinta-suave)">
            Se otorgan y se quitan en la pestaña <b>Permisos</b>, donde se ven
            todas las personas juntas.
          </small>
        </div>

        <div class="campo">
          <label class="casilla-texto">
            <input type="checkbox" id="e-activo" ${persona.activo ? 'checked' : ''}>
            Activo — puede entrar a la plataforma
          </label>
          <small style="color:var(--tinta-suave)">
            ${tieneHistorial
              ? `Desmárcalo cuando alguien deje la empresa. No se borra: conserva sus ${persona.llenados} llenado(s) y ${persona.firmas} firma(s), y deja de aparecer en la pantalla de ingreso.`
              : 'Desmárcalo cuando alguien deje la empresa. Dejará de aparecer en la pantalla de ingreso.'}
          </small>
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" id="e-cancelar">Cancelar</button>
        <button class="btn primario" id="e-guardar">Guardar cambios</button>
      </div>
    </div>`;

  document.body.appendChild(capa);

  const cerrar = () => { capa.remove(); document.removeEventListener('keydown', alPresionar); };
  const alPresionar = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', alPresionar);
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('#e-cancelar').addEventListener('click', cerrar);

  const selectorRol = capa.querySelector('#e-rol');
  const notaRol = capa.querySelector('#e-nota-rol');

  const avisar = () => {
    const r = roles.find((x) => x.clave === selectorRol.value);
    notaRol.textContent = r && r.exige_pin ? 'Ve información de toda la operación: necesita PIN.' : '';
  };
  selectorRol.addEventListener('change', avisar);
  avisar();

  capa.querySelector('#e-guardar').addEventListener('click', async () => {
    const quitarPin = capa.querySelector('#e-quitar-pin');
    const pinNuevo = capa.querySelector('#e-pin').value.trim();

    const cambios = {
      nombre: capa.querySelector('#e-nombre').value.trim(),
      rol: selectorRol.value,
      activo: capa.querySelector('#e-activo').checked,
    };
    if (quitarPin && quitarPin.checked) cambios.pin = null;
    else if (pinNuevo) cambios.pin = pinNuevo;

    try {
      await api('PUT', `/api/admin/usuarios/${persona.id}`, cambios);
      cerrar();
      await recargarConfig();
      mostrarMensaje(`Datos de ${cambios.nombre} actualizados.`, 'exito');
    } catch (err) {
      capa.querySelector('#error-modal').innerHTML = avisoError(err.message);
    }
  });

  capa.querySelector('#e-nombre').focus();
}

// ================================================================== ruteo

// El tercer elemento es el permiso que exige la ruta. El servidor vuelve a
// comprobarlo en cada llamada: esto solo evita mostrar una pantalla que de todos
// modos no cargaría.
// [patrón, vista, permiso, ¿necesita sesión?]
// El menú y la pantalla de acceso son públicas: son navegación, y la tablet
// vive dentro del almacén. Todo lo que muestra datos exige identificarse, y el
// servidor vuelve a comprobar el permiso en cada llamada.
const RUTAS = [
  [/^#\/menu$/, vistaMenu],
  [/^#\/acceso$/, vistaAcceso, null, false],
  [/^#\/acceso\/([\w-]+)$/, vistaAcceso, null, false],
  [/^#\/checklists$/, vistaChecklists, 'llenar'],
  [/^#\/llenar\/([\w-]+)(?:\/(\d+))?$/, vistaLlenar, 'llenar'],
  [/^#\/envios\/([\w-]+)$/, vistaEnvios, 'llenar'],
  [/^#\/envio\/(\d+)$/, vistaEnvio, 'llenar'],
  [/^#\/reportes$/, vistaReportes, 'reportes'],
  [/^#\/comparativa$/, vistaComparativa, 'comparativa'],
  [/^#\/detalle\/(\d+)$/, vistaDetalle, 'reportes'],
  [/^#\/config(?:\/([\w-]+))?$/, vistaConfig, 'configuracion'],
];

// Rutas que solo se alcanzan comprobando identidad. Al abandonarlas se cierra la
// sesión: si no, el administrador dejaría la tablet con su sesión abierta y el
// siguiente entraría a Checklists como él sin capturar ningún PIN.
const RUTAS_REAUTENTICADAS = /^#\/config/;
let hashAnterior = '';

async function enrutar() {
  const hash = location.hash || '#/';

  // Antes se cerraba la sesión al salir de Configuración, porque el menú era
  // público y quedaba una sesión de administrador suelta. Ahora la identidad se
  // pide al entrar al sistema, así que cerrarla aquí solo expulsaría al
  // administrador a media faena. Lo que protege la tablet desatendida es el
  // regreso automático al reposo y el botón Salir.
  hashAnterior = hash;

  if (hash === '#/' || hash === '') return dormir();

  pintarNavegacion();

  const coincidencia = RUTAS
    .map(([patron, fn, permisoRuta, exigeSesion = true]) => ({ fn, permisoRuta, exigeSesion, m: hash.match(patron) }))
    .find((r) => r.m);
  if (!coincidencia) return void (location.hash = estado.token ? '#/menu' : '#/acceso');

  if (coincidencia.exigeSesion && !estado.token) return void (location.hash = '#/acceso');

  if (coincidencia.permisoRuta && !permiso(coincidencia.permisoRuta)) {
    encabezado('Sin acceso', (estado.usuario && estado.usuario.etiqueta_rol) || '');
    vista.innerHTML = avisoError('Tu perfil no tiene acceso a esta sección.')
      + '<button class="btn primario" data-al-menu>Volver al menú</button>';
    vista.querySelector('[data-al-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
    return;
  }

  vista.innerHTML = '<div class="vacio">Cargando…</div>';
  try {
    await coincidencia.fn(...coincidencia.m.slice(1));
  } catch (err) {
    vista.innerHTML = avisoError(err.message);
  }
  pintarNavegacion();
}

window.addEventListener('hashchange', enrutar);
window.addEventListener('beforeunload', descargarPendientes);
conectarCaptura();
dormir();
