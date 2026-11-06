'use strict';

const vista = document.getElementById('vista');
const barra = document.getElementById('barra');
const reposo = document.getElementById('reposo');
const navegacion = document.getElementById('navegacion');
const titulo = document.getElementById('titulo');
const subtitulo = document.getElementById('subtitulo');
const sobretitulo = document.getElementById('sobretitulo');
const riel = document.getElementById('riel');

const estado = {
  token: sessionStorage.getItem('token'),
  usuario: JSON.parse(sessionStorage.getItem('usuario') || 'null'),
  // Si se está probando «como» alguien: { nombre, puesto, desde }. Ver modo de pruebas.
  prueba: JSON.parse(sessionStorage.getItem('prueba') || 'null'),
  identificadoEn: Number(sessionStorage.getItem('identificadoEn') || 0),
  modulos: null,      // catálogo del menú, se pide una vez
  llenado: null,      // llenado abierto en la vista de captura
  plantilla: null,
  respuestas: new Map(), // "itemId|columna" -> { valor, observacion }
  fotos: new Map(),      // "itemId|columna" -> [ { id, archivo } ]
  recepcion: null,       // recepción de Calidad abierta, con sus lotes
  catalogos_calidad: null, // materiales, proveedores y colores; se piden una vez
};

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const llave = (itemId, columna) => `${itemId}|${columna || '-'}`;

// Mientras la plataforma está hablando con el servidor se enciende una cinta
// delgada arriba de todo. En una tablet sobre wifi, medio segundo sin señal de
// vida se siente como que no funcionó: la gente vuelve a tocar el botón y
// termina capturando dos veces lo mismo.
let llamadasEnVuelo = 0;
function moverCintaDeEspera(delta) {
  llamadasEnVuelo = Math.max(0, llamadasEnVuelo + delta);
  const cinta = document.getElementById('cinta-espera');
  if (cinta) cinta.classList.toggle('activa', llamadasEnVuelo > 0);
}

// En la bodega el wifi se cae a ratos. Una consulta que se pierde no se da por
// perdida: se vuelve a pedir, porque pedir dos veces lo mismo no cambia nada.
// Lo que escribe —guardar, firmar, autorizar— nunca se repite solo: podría
// aplicarse dos veces y eso sí cambia las cosas.
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Un error sin respuesta del servidor no es un error de la plataforma: es que
// no se pudo llegar a ella. Se dice con todas sus letras y se dice qué hacer,
// porque quien está en el almacén no tiene cómo adivinarlo.
const SIN_PLATAFORMA = 'No se puede hablar con la plataforma. '
  + 'La computadora donde vive está apagada, dormida o fuera del wifi del almacén. '
  + 'Lo que ya se guardó está a salvo; en cuanto vuelva, esta pantalla sigue sola.';

function avisarSinPlataforma(hay) {
  document.body.classList.toggle('sin-plataforma', hay);
  let tira = document.getElementById('tira-sin-plataforma');
  if (!hay) { if (tira) tira.remove(); return; }
  if (tira) return;
  tira = document.createElement('div');
  tira.id = 'tira-sin-plataforma';
  tira.innerHTML = '<b>Sin conexión con la plataforma.</b> '
    + 'La computadora del almacén está apagada o fuera del wifi. Reintentando…';
  document.body.appendChild(tira);
}

async function api(metodo, ruta, cuerpo) {
  moverCintaDeEspera(1);
  try {
    const reintentos = metodo === 'GET' ? 2 : 0;
    for (let intento = 0; ; intento += 1) {
      try {
        const datos = await pedir(metodo, ruta, cuerpo);
        avisarSinPlataforma(false);
        return datos;
      } catch (err) {
        // Solo se reintenta cuando ni siquiera hubo respuesta: si el servidor
        // contestó «no se puede», contestar otra vez diría lo mismo.
        if (err.estado) throw err;
        if (intento >= reintentos) {
          avisarSinPlataforma(true);
          const caido = new Error(SIN_PLATAFORMA);
          caido.sinPlataforma = true;
          throw caido;
        }
        await esperar(600 * (intento + 1));
      }
    }
  } finally {
    moverCintaDeEspera(-1);
  }
}

// SI ESTA PANTALLA SE QUEDÓ ATRÁS.
//
// Una tablet puede pasar días con la pantalla abierta sin recargar: se queda
// con la versión que cargó el día que la prendieron, y entonces «no sirve» algo
// que ya se arregló. No se recarga sola —a media captura sería peor—: se avisa
// y se recarga cuando quien está usándola diga.
let versionCargada = null;

function avisarVersionNueva() {
  if (document.getElementById('tira-version')) return;
  const tira = document.createElement('div');
  tira.id = 'tira-version';
  tira.innerHTML = '<span><b>Hay una versión nueva de la plataforma.</b> '
    + 'Esta pantalla lleva abierta desde antes.</span>'
    + '<button class="btn" id="tomar-version">Actualizar ahora</button>';
  document.body.appendChild(tira);
  document.getElementById('tomar-version').addEventListener('click', () => location.reload());
}

// Cada medio minuto se toca la puerta: si no contestaba, para saber que ya
// volvió; y si contesta, para enterarse de si salió una versión nueva.
setInterval(async () => {
  let d;
  try {
    const res = await fetch('/api/salud', { cache: 'no-store' });
    if (!res.ok) return;
    d = await res.json();
  } catch { return; /* sigue sin estar */ }

  if (document.body.classList.contains('sin-plataforma')) {
    avisarSinPlataforma(false);
    if (estado.token) { reintentarFotosPendientes(); enrutar(); }
  }

  if (!d.version) return;
  if (versionCargada === null) versionCargada = d.version;
  else if (d.version !== versionCargada) avisarVersionNueva();
}, 30000);

window.addEventListener('online', () => {
  if (document.body.classList.contains('sin-plataforma') && estado.token) enrutar();
});

async function pedir(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const datos = await res.json().catch(() => ({}));

  // El servidor dice en cada respuesta si vino de la copia de pruebas. Si no
  // coincide con lo que la pantalla cree —alguien apagó el modo mientras se
  // probaba—, se pregunta quién se es ahora y se vuelve al menú.
  const dePrueba = res.headers.get('X-Inko-Prueba');
  if (dePrueba !== null && estado.token && (dePrueba === '1') !== !!estado.prueba
      && ruta !== '/api/yo' && !ruta.startsWith('/api/pruebas') && ruta !== '/api/entrar') {
    resincronizarPrueba();
  }

  // Un 401 al entrar significa "PIN incorrecto", no "sesión expirada": hay que
  // dejar el mensaje en la pantalla del teclado en vez de sacar a la persona.
  if (res.status === 401 && ruta !== '/api/entrar') {
    cerrarSesion();
    throw new Error('Tu sesión expiró. Vuelve a entrar.');
  }

  if (!res.ok) {
    // El cuerpo viaja con el error: hay respuestas que además de explicar traen
    // con qué seguir —«ya existe una ODT de esa semana, ¿la reemplazo?»— y sin
    // esto habría que repetir la llamada solo para enterarse.
    const error = new Error(datos.error || 'Ocurrió un error');
    error.estado = res.status;
    error.datos = datos;
    throw error;
  }
  return datos;
}

// ====================================================== evidencia fotográfica

// Las imágenes van protegidas por sesión, así que no se pueden poner directo en
// el src: hay que pedirlas con el token y convertirlas en un blob local.
const cacheImagenes = new Map();

// Una miniatura que no se pudo bajar NO es una foto borrada: la foto está
// guardada en el servidor y lo único que falló fue traerla. Antes se quedaba en
// blanco y parecía que se habían borrado las demás; ahora se reintenta sola y,
// si aun así no llega, se queda marcada para volver a intentarlo con un toque.
async function cargarImagen(elemento, archivo, intento = 0) {
  const marco = elemento.closest('.mini');
  try {
    if (!cacheImagenes.has(archivo)) {
      const res = await fetch(`/api/fotos/${archivo}`, { headers: { Authorization: `Bearer ${estado.token}` } });
      if (!res.ok) throw new Error('no disponible');
      cacheImagenes.set(archivo, URL.createObjectURL(await res.blob()));
    }
    elemento.src = cacheImagenes.get(archivo);
    if (marco) marco.classList.remove('sin-cargar');
  } catch {
    if (intento < 2) {
      await esperar(700 * (intento + 1));
      return cargarImagen(elemento, archivo, intento + 1);
    }
    elemento.alt = 'Toca para volver a cargarla';
    if (marco) marco.classList.add('sin-cargar');
  }
  return undefined;
}

// Un toque en la miniatura que no cargó la vuelve a pedir.
document.addEventListener('click', (e) => {
  const marco = e.target.closest('.mini.sin-cargar');
  if (!marco) return;
  const img = marco.querySelector('img[data-archivo]');
  if (!img) return;
  img.removeAttribute('src');
  marco.classList.remove('sin-cargar');
  cargarImagen(img, img.dataset.archivo);
});

function cargarImagenesPendientes(raiz = vista) {
  raiz.querySelectorAll('img[data-archivo]:not([src])').forEach((img) => {
    cargarImagen(img, img.dataset.archivo);
  });
}

// Cualquier imagen protegida que aparezca en la pantalla se carga sola, sin que
// cada vista tenga que acordarse de pedirlo.
new MutationObserver((cambios) => {
  for (const c of cambios) {
    for (const n of c.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches && n.matches('img[data-archivo]:not([src])')) cargarImagen(n, n.dataset.archivo);
      else if (n.querySelectorAll) cargarImagenesPendientes(n);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// --- la foto de cada producto, donde se use ---
//
// Se piden una vez y se guardan; cada renglón que nombra un producto la busca
// por lo que tenga a la mano: su id, su SKU, su nombre o su modelo.
async function cargarFotosProductos() {
  if (estado.fotos_productos || !estado.token) return;
  try {
    const lista = await api('GET', '/api/productos/fotos');
    const f = { id: new Map(), sku: new Map(), nombre: new Map(), modelo: new Map() };
    for (const p of lista) {
      f.id.set(p.id, p.imagen);
      if (p.sku) f.sku.set(p.sku, p.imagen);
      if (p.nombre) f.nombre.set(p.nombre.toLowerCase(), p.imagen);
      if (p.modelo && !f.modelo.has(p.modelo.toLowerCase())) f.modelo.set(p.modelo.toLowerCase(), p.imagen);
    }
    estado.fotos_productos = f;
  } catch { estado.fotos_productos = null; }
}

function fotoProducto({ id, sku, nombre, modelo } = {}) {
  const f = estado.fotos_productos;
  if (!f) return '';
  const archivo = (id && f.id.get(id)) || (sku && f.sku.get(sku))
    || (nombre && f.nombre.get(String(nombre).toLowerCase())) || (modelo && f.modelo.get(String(modelo).toLowerCase()));
  return archivo ? `<img class="imagen-renglon" data-archivo="${esc(archivo)}" alt="">` : '';
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

// LO QUE NO SE PUDO SUBIR TODAVÍA.
//
// Una foto tomada con la señal caída no se pierde ni se borra de la pantalla:
// se queda aquí, visible y marcada «por subir», y se reintenta sola. Vive
// aparte de estado.fotos —que se rehace cada vez que se pinta el checklist—
// para que repintar la pantalla no se la lleve.
const fotosPorSubir = new Map();

const llavePorSubir = (itemId, columna) =>
  `${(estado.llenado || {}).id || 0}|${llave(itemId || 0, columna)}`;

const porSubirDe = (itemId, columna) => fotosPorSubir.get(llavePorSubir(itemId, columna)) || [];

function anotarPorSubir(itemId, columna, pendiente) {
  const k = llavePorSubir(itemId, columna);
  if (!fotosPorSubir.has(k)) fotosPorSubir.set(k, []);
  fotosPorSubir.get(k).push(pendiente);
}

function quitarPorSubir(itemId, columna, pendiente) {
  const k = llavePorSubir(itemId, columna);
  const lista = (fotosPorSubir.get(k) || []).filter((x) => x !== pendiente);
  if (lista.length) fotosPorSubir.set(k, lista);
  else fotosPorSubir.delete(k);
}

function tiraFotos(itemId, columna, { obligatoria = false, soloLectura = false, oculta = false } = {}) {
  const lista = fotosDe(itemId, columna);
  const pendientes = soloLectura ? [] : porSubirDe(itemId, columna);
  const falta = obligatoria && lista.length === 0 && pendientes.length === 0;
  return `
    <div class="evidencia ${falta ? 'falta' : ''}" data-item="${itemId || ''}" data-columna="${esc(columna)}"
         data-obligatoria="${obligatoria ? 1 : 0}" ${oculta && lista.length === 0 && !pendientes.length ? 'hidden' : ''}>
      <div class="miniaturas">
        ${lista.map((f) => `
          <figure class="mini">
            <img data-archivo="${esc(f.archivo)}" alt="Evidencia">
            ${soloLectura ? '' : `<button class="quitar" data-quitar="${f.id}" title="Quitar foto">×</button>`}
          </figure>`).join('')}
        ${pendientes.map((p, i) => `
          <figure class="mini por-subir" title="Tomada, falta subirla">
            <img src="${p.contenido}" alt="Foto por subir">
            <button class="quitar" data-quitar-pendiente="${i}" title="Descartar esta foto">×</button>
          </figure>`).join('')}
      </div>
      ${soloLectura ? (lista.length ? '' : '<span class="nota-foto">Sin evidencia</span>') : `
        <button class="btn-camara" type="button">
          <span aria-hidden="true">📷</span> ${lista.length + pendientes.length ? 'Otra foto' : 'Agregar foto'}
        </button>
        ${pendientes.length ? `
          <span class="nota-foto por-subir">
            ${pendientes.length} por subir · se reintenta solo
            <button class="btn" data-reintentar-subida>Reintentar ahora</button>
          </span>` : ''}
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

// Un solo <input type="file"> reutilizado por todas las tiras.
//
// SIN 'capture': con ese atributo la tablet abría la cámara y nada más, y no
// había manera de subir una foto que ya estaba en el carrete —la que se tomó
// hace rato en otra parte de la bodega, o la que mandó alguien más—. Sin él,
// el iPad ofrece las tres: Fototeca, Tomar foto y Elegir archivo.
const selectorFotos = document.createElement('input');
selectorFotos.setAttribute('type', 'file');
selectorFotos.setAttribute('accept', 'image/*');
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
// Sube una foto ya comprimida. Devuelve false si no se pudo —sin señal, el
// servidor apagado—, para que quien la mandó decida si la guarda para después.
async function subirUna(itemId, columna, contenido) {
  const guardado = await api('POST', `/api/llenados/${estado.llenado.id}/fotos`, {
    item_id: itemId || null,
    columna,
    imagen: contenido,
  });
  const k = llave(guardado.item_id || 0, guardado.columna);
  if (!estado.fotos.has(k)) estado.fotos.set(k, []);
  estado.fotos.get(k).push(guardado);
  // La miniatura ya está en la mano: se guarda con el nombre que le dio el
  // servidor y no hay que volver a bajarla. En la bodega eso es la diferencia
  // entre verla y no verla.
  cacheImagenes.set(guardado.archivo, contenido);
  return guardado;
}

async function subirArchivos(caja, archivos, { ladoMaximo, calidad }) {
  const boton = caja.querySelector('.btn-camara');
  const textoOriginal = boton ? boton.innerHTML : '';
  if (boton) { boton.disabled = true; boton.textContent = 'Subiendo…'; }
  const itemId = caja.dataset.item ? Number(caja.dataset.item) : null;
  const columna = caja.dataset.columna;
  let quedaronPendientes = 0;

  for (const archivo of archivos) {
    let contenido;
    try {
      contenido = archivo.type === 'application/pdf'
        ? await leerComoDataURL(archivo)
        : await comprimirImagen(archivo, ladoMaximo, calidad);
    } catch (err) {
      mostrarMensaje(`No se pudo leer «${archivo.name}»: ${err.message}`, 'error');
      continue;
    }

    try {
      await subirUna(itemId, columna, contenido);
    } catch (err) {
      // Si el servidor contestó que no —la etapa ya se cerró, el archivo no es
      // una imagen—, guardarla para después no serviría de nada.
      if (err.estado) {
        mostrarMensaje(`No se pudo subir «${archivo.name}»: ${err.message}`, 'error');
        continue;
      }
      anotarPorSubir(itemId, columna, { nombre: archivo.name, contenido });
      quedaronPendientes += 1;
    }
  }

  if (boton) { boton.disabled = false; boton.innerHTML = textoOriginal; }
  refrescarTira(caja);
  if (quedaronPendientes) {
    mostrarMensaje(`${quedaronPendientes} foto(s) quedaron guardadas en la tablet: se suben solas en cuanto vuelva la señal.`, 'error');
    programarReintentoDeFotos();
  }
}

// Reintento de lo que quedó pendiente. Se vuelve a intentar solo, cada vez más
// espaciado, hasta que entre; y entra también en cuanto la tablet avisa que
// volvió la red.
let reintentoProgramado = null;
let esperaReintento = 5000;

function programarReintentoDeFotos() {
  if (reintentoProgramado || !fotosPorSubir.size) return;
  reintentoProgramado = setTimeout(async () => {
    reintentoProgramado = null;
    const subio = await reintentarFotosPendientes();
    esperaReintento = subio ? 5000 : Math.min(esperaReintento * 2, 60000);
    programarReintentoDeFotos();
  }, esperaReintento);
}

async function reintentarFotosPendientes() {
  if (!estado.llenado) return false;
  let alguna = false;
  for (const [k, lista] of [...fotosPorSubir]) {
    const [llenadoId, resto] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    if (Number(llenadoId) !== estado.llenado.id) continue;
    const [itemTexto, columna] = resto.split('|');
    const itemId = Number(itemTexto) || null;
    for (const pendiente of [...lista]) {
      try {
        await subirUna(itemId, columna, pendiente.contenido);
        quitarPorSubir(itemId, columna, pendiente);
        alguna = true;
      } catch (err) {
        if (err.estado) quitarPorSubir(itemId, columna, pendiente);
        else break; // sigue sin haber señal: no tiene caso insistir con las demás
      }
    }
  }
  if (alguna) {
    vista.querySelectorAll('.evidencia').forEach((caja) => refrescarTira(caja));
    mostrarMensaje('Ya se subieron las fotos que estaban esperando señal.', 'exito');
  }
  return alguna;
}

// En cuanto la tablet recupera la red, se intenta de inmediato.
window.addEventListener('online', () => { esperaReintento = 2000; programarReintentoDeFotos(); });

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

// ------------------------------------------------------- modo de pruebas
//
// Mientras se prueba «como» alguien, la pantalla es la de esa persona —su menú,
// sus botones, sus avisos— y una cinta arriba lo recuerda todo el tiempo, con la
// salida a la mano. El servidor decide sobre qué base trabaja; aquí solo se
// cambia a quién se le pinta la pantalla.
function fijarPrueba(usuario, prueba) {
  estado.usuario = usuario;
  estado.prueba = prueba || null;
  estado.modulos = null;
  estado.catalogos_almacen = null;
  estado.catalogos_calidad = null;
  sessionStorage.setItem('usuario', JSON.stringify(usuario));
  if (prueba) sessionStorage.setItem('prueba', JSON.stringify(prueba));
  else sessionStorage.removeItem('prueba');
  pintarCintaPrueba();
}

let resincronizando = false;
async function resincronizarPrueba() {
  if (resincronizando) return;
  resincronizando = true;
  try {
    const r = await api('GET', '/api/yo');
    fijarPrueba(r.usuario, r.prueba);
    mostrarMensaje(r.prueba ? 'Estás en el modo de pruebas.' : 'El modo de pruebas se apagó: regresaste a tu sesión.', 'aviso');
    location.hash = '#/menu';
  } catch { /* si la sesión se fue, api() ya lo resolvió */ }
  resincronizando = false;
}

async function salirDePrueba() {
  const r = await api('POST', '/api/pruebas/salir');
  fijarPrueba(r.usuario, null);
  location.hash = '#/pruebas';
}

function pintarCintaPrueba() {
  let cinta = document.getElementById('cinta-prueba');
  if (!cinta) {
    cinta = document.createElement('div');
    cinta.id = 'cinta-prueba';
    cinta.className = 'cinta-prueba';
    barra.insertAdjacentElement('afterend', cinta);
    cinta.addEventListener('click', (e) => {
      if (e.target.closest('[data-cambiar-prueba]')) location.hash = '#/pruebas';
      if (e.target.closest('[data-salir-prueba]')) salirDePrueba().catch((err) => mostrarMensaje(err.message, 'error'));
    });
  }
  const p = estado.prueba;
  cinta.hidden = !p || document.body.classList.contains('en-reposo');
  if (!p) return;
  cinta.innerHTML = `
    <span class="marca-prueba">Modo de pruebas</span>
    <span class="texto">Estás usando el sistema como <b>${esc(p.nombre)}</b> · ${esc(p.puesto || '')}.
      Nada de lo que hagas toca la operación real.</span>
    <button class="btn" data-cambiar-prueba>Cambiar</button>
    <button class="btn" data-salir-prueba>Salir de la prueba</button>`;
}

function cerrarSesion(volverAlReposo = false) {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('usuario');
  sessionStorage.removeItem('prueba');
  estado.prueba = null;
  pintarCintaPrueba();
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
  riel.hidden = true;
  document.body.classList.remove('con-riel');
  pintarCintaPrueba();
}

function despertar() {
  if (!document.body.classList.contains('en-reposo')) return;
  document.body.classList.remove('en-reposo');
  reposo.hidden = true;
  barra.hidden = false;
  vista.hidden = false;
  pintarCintaPrueba();
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

// La cabecera azul de cada pantalla. En la portada crece para que las cifras del
// día se monten encima de ella (así lo mostraba el estilo «Riel azul»).
function encabezado(texto, sub, sobre) {
  titulo.textContent = texto;
  subtitulo.textContent = sub || '';
  sobretitulo.textContent = sobre || '';
  barra.classList.toggle('grande', (location.hash || '') === '#/menu');
}

// El Administrador puede todo, igual que en el servidor: si aquí se preguntara
// solo por la lista de permisos, los botones de una acción recién agregada no le
// aparecerían hasta que alguien se acordara de otorgársela.
const permiso = (nombre) => !!(estado.usuario
  && (estado.usuario.rol === 'admin'
    || (estado.usuario.permisos && estado.usuario.permisos[nombre])));

// Los atajos a Reportes y Comparativa salieron de esta barra: los reportes ya
// no cuelgan de Checklists ni de Calidad, viven en su propio módulo. Dejarlos
// aquí sería una segunda puerta al mismo sitio, y la barra de una tablet no da
// para dos. Aprobaciones sí se queda: es trabajo dentro de Calidad, no consulta.
function pintarNavegacion() {
  pintarCintaPrueba();
  const hash = location.hash || '';
  const enMenu = hash === '#/menu';
  // Quien entra a atender un pendiente desde Notificaciones se queda dentro del
  // módulo: la bandeja se pierde de vista y volver a ella eran dos toques por el
  // menú. Este botón aparece solo mientras se viene de ahí, y desaparece al
  // regresar. Lleva la cuenta para saber cuánto falta sin tener que ir a verlo.
  const volverAvisos = estado.usuario && estado.desde_avisos && !hash.startsWith('#/notificaciones');
  navegacion.innerHTML = `
    ${volverAvisos
      ? `<button class="btn primario" data-ir="#/notificaciones">← Avisos (${estado.desde_avisos})</button>` : ''}
    ${estado.usuario && enModuloCalidad()
      ? '<button class="btn" data-ir="#/calidad/pendientes">Aprobaciones</button>' : ''}`;
  void enMenu;
  pintarRiel();
}

// ------------------------------------------------------------------- riel
//
// La columna de la izquierda: el logo, Inicio, Avisos con su cuenta, los módulos
// de quien entró y, hasta abajo, Salir. Siempre a la vista, para que cambiar de
// módulo sea un toque y no un regreso al menú.
const ETIQUETA_RIEL = {
  produccion: 'Producción', calidad: 'Calidad', transito: 'Tránsito',
  logistica: 'Logística', ventas_fuera: 'Ventas', almacen: 'Almacén', incidencias: 'Incidencias',
  reportes: 'Reportes', configuracion: 'Ajustes',
};

// En qué módulo se está, según la dirección.
const ZONAS_RIEL = [
  [/^#\/menu/, 'inicio'],
  [/^#\/notificaciones/, 'notificaciones'],
  [/^#\/(envios\/transito|envio\/)/, 'transito'],
  [/^#\/(checklists|llenar|envios|detalle)/, 'logistica'],
  [/^#\/(calidad|recepcion)/, 'calidad'],
  [/^#\/almacen/, 'almacen'],
  [/^#\/produccion/, 'produccion'],
  [/^#\/logistica/, 'logistica'],
  [/^#\/ventas-fuera/, 'ventas_fuera'],
  [/^#\/incidencias/, 'incidencias'],
  [/^#\/(reportes|comparativa)/, 'reportes'],
  [/^#\/(config|pruebas)/, 'configuracion'],
];

let pidiendoModulos = null;
function pintarRiel() {
  const hayRiel = !!estado.usuario && !document.body.classList.contains('en-reposo')
    && !(location.hash || '').startsWith('#/acceso');
  riel.hidden = !hayRiel;
  document.body.classList.toggle('con-riel', hayRiel);
  if (!hayRiel) return;
  if (!estado.modulos) {
    if (!pidiendoModulos) {
      pidiendoModulos = api('GET', '/api/modulos')
        .then((m) => { estado.modulos = m; pintarRiel(); })
        .catch(() => {})
        .finally(() => { pidiendoModulos = null; });
    }
    return;
  }
  const hash = location.hash || '';
  const zona = (ZONAS_RIEL.find(([re]) => re.test(hash)) || [])[1];
  const avisos = estado.modulos.find((m) => m.clave === 'notificaciones');
  const modulos = estado.modulos.filter((m) => m.disponible && m.clave !== 'notificaciones');
  const boton = (clave, etiqueta, icono, extra = '') => `
    <button class="${zona === clave ? 'si' : ''}" data-riel="${clave}" title="${esc(etiqueta)}"
            ${zona === clave ? 'aria-current="page"' : ''}>
      ${extra}${simbolo(icono)}<span>${esc(etiqueta)}</span>
    </button>`;
  riel.innerHTML = `
    <img class="logo-riel" src="marca/inko-blanco.png" alt="INKO">
    ${boton('inicio', 'Inicio', 'inicio')}
    ${avisos ? boton('notificaciones', 'Avisos', 'campana',
      avisos.pendientes ? `<i class="cuenta-riel">${avisos.pendientes > 99 ? '99+' : avisos.pendientes}</i>` : '') : ''}
    <span class="separador-riel"></span>
    ${modulos.map((m) => boton(m.clave, ETIQUETA_RIEL[m.clave] || m.nombre, m.icono)).join('')}
    <span class="relleno-riel"></span>
    <button data-riel-salir title="Salir">${simbolo('salir')}<span>Salir</span></button>`;
}

riel.addEventListener('click', (e) => {
  if (e.target.closest('[data-riel-salir]')) return cerrarSesion();
  const b = e.target.closest('[data-riel]');
  if (!b) return;
  if (b.dataset.riel === 'inicio') location.hash = '#/menu';
  else abrirModulo(b.dataset.riel);
});

const RUTAS_CALIDAD = /^#\/(calidad|recepcion)/;
const enModuloCalidad = () => RUTAS_CALIDAD.test(location.hash || '');

navegacion.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) location.hash = ir.dataset.ir;
  if (e.target.closest('[data-salir]')) cerrarSesion();
});

// Migajas que solo navegan: el destino va en el atributo y se conectan una vez
// para toda la aplicación. Cada pantalla que las pinta se ahorra su propio
// conectado, que era la parte fácil de olvidar al mover un reporte de sitio.
vista.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir-hash]');
  if (ir) location.hash = ir.dataset.irHash;
});

// --- enlaces entre módulos ---
//
// Cuando un documento habla de otro —la salida de su orden de venta directa,
// el traspaso de su ODT, el envío de Tránsito de su cita—, el folio se puede
// tocar y lleva al otro. Si quien mira no tiene acceso al otro módulo, se ve el
// texto sin enlace: no se le manda a una pantalla de «sin acceso».
function puedeAbrir(hash) {
  const r = RUTAS.find(([patron]) => patron.test(hash));
  return !!r && (!r[2] || [].concat(r[2]).some((k) => permiso(k)));
}
const liga = (hash, texto) => (puedeAbrir(hash)
  ? `<a class="liga-doc" href="${hash}">${esc(texto)}</a>`
  : `<span class="liga-doc sin-acceso">${esc(texto)}</span>`);

// La tira «Conectado con» que va arriba de un documento.
const tiraConexiones = (ligas) => {
  const hay = ligas.filter(Boolean);
  return hay.length ? `<div class="tira-conexiones"><span>Conectado con</span>${hay.join('')}</div>` : '';
};

const ESTADO_TRANSITO = {
  borrador: 'en captura', en_ruta: 'en ruta', cerrado: 'cerrado',
};
const textoTransito = (l) => (l.revision === 'por_autorizar' ? 'por autorizar salida'
  : l.revision === 'por_aprobar' ? 'por aprobar cierre' : ESTADO_TRANSITO[l.estado] || l.estado);

const migajaReportes = (nombre) => `
  <div class="migaja">
    <button data-ir-hash="#/menu">← Menú</button><span>/</span>
    <button data-ir-hash="#/reportes">Reportes</button><span>/</span><span>${esc(nombre)}</span>
  </div>`;

// =============================================================== vista: menú

// Íconos dibujados a mano en trazo simple, en línea con la geometría del
// logotipo. Nada de librerías externas: la tablet trabaja sin internet.
const ICONOS = {
  checklist: '<path d="M9 5h10M9 12h10M9 19h10"/><path d="M3.5 5.5 5 7l2.5-2.5"/><path d="M3.5 12.5 5 14l2.5-2.5"/><path d="M3.5 19.5 5 21l2.5-2.5"/>',
  cajas: '<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v7"/>',
  camion: '<path d="M2 6.5h11v9H2zM13 9.5h4.5L21 13v2.5h-8z"/><circle cx="6.5" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>',
  calidad: '<path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9v-5z"/><path d="M9 12.2l2.2 2.2 4-4.3"/>',
  orden: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5"/><path d="M9 12.5h7M9 16.5h5"/>',
  produccion: '<path d="M3 20.5h18"/><path d="M4.5 20.5V10l5 3V10l5 3V7.5l4.5 2.5v10.5"/>',
  transito: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18h5.3a4.5 4.5 0 0 0 0-9H10"/>',
  campana: '<path d="M12 3.2a5.6 5.6 0 0 0-5.6 5.6c0 5-2 6.4-2 6.4h15.2s-2-1.4-2-6.4A5.6 5.6 0 0 0 12 3.2z"/><path d="M10.3 18.6a2 2 0 0 0 3.4 0"/>',
  alerta: '<path d="M12 3.8 21 19.5H3z"/><path d="M12 9.6v4.6M12 16.9v.2"/>',
  grafica: '<path d="M4 4v16h16"/><path d="M8 16.5v-4M12 16.5V7.5M16 16.5v-6.5M20 16.5v-9"/>',
  inicio: '<path d="M4 11.2 12 4.5l8 6.7V20H4z"/><path d="M9.5 20v-5.5h5V20"/>',
  salir: '<path d="M14 4.5H6.5v15H14"/><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  volante: '<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="2.6"/><path d="M12 3.7v5.7M4.3 14.2l5.3-1.5M19.7 14.2l-5.3-1.5"/>',
  gasolina: '<path d="M5.5 20.5V5.2a1.7 1.7 0 0 1 1.7-1.7h4.1a1.7 1.7 0 0 1 1.7 1.7v15.3z"/><path d="M5.5 10.8h7.5"/><path d="M13 7.5h2.6l2.4 3v7.6a1.6 1.6 0 0 1-3.2 0V13h-1.8"/>',
  llave: '<path d="M14.5 3.5a5.2 5.2 0 0 0-4.6 7.6L3.5 17.5v3h3l6.4-6.4a5.2 5.2 0 1 0 1.6-10.6z"/><circle cx="16.2" cy="7.8" r="1.2"/>',
  carpeta: '<path d="M3.5 7.5h5.2l2 2.3h9.8v9.7H3.5z"/><path d="M3.5 7.5V5.2h4.6l1.6 2.3"/>',
  ajustes: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.6M12 18.6v2.6M4.5 4.5l1.9 1.9M17.6 17.6l1.9 1.9M2.8 12h2.6M18.6 12h2.6M4.5 19.5l1.9-1.9M17.6 6.4l1.9-1.9"/>',
};

const simbolo = (clave) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[clave] || ICONOS.checklist}</svg>`;

async function vistaMenu() {
  const u = estado.usuario || {};
  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  encabezado(`${saludo}, ${(u.nombre || '').split(' ')[0]}`,
    `${u.etiqueta_rol || ''}${u.etiqueta_rol ? ' · ' : ''}esto es lo que se mueve hoy`, hoy);

  // La cuenta de avisos se refresca cada vez que se vuelve aquí.
  const [modulos, r] = await Promise.all([
    api('GET', '/api/modulos'),
    api('GET', '/api/inicio/resumen').catch(() => ({ cifras: [], modulos: [] })),
  ]);
  estado.modulos = modulos;
  pintarRiel();
  const resumen = Object.fromEntries((r.modulos || []).map((m) => [m.clave, m]));

  vista.innerHTML = `
    ${r.cifras.length ? `
      <div class="cifras-inicio">
        ${r.cifras.map((c) => `
          <button class="cifra-inicio ${c.alerta ? 'alerta' : ''}" data-ir-hash="${esc(c.destino)}">
            <small>${esc(c.etiqueta)}</small>
            <b>${esc(c.valor)}</b>
            ${c.avance !== undefined ? `<span class="barra-mini"><i style="width:${Number(c.avance) || 0}%"></i></span>` : ''}
            <span class="${c.aviso_detalle ? 'detalle-alerta' : ''}">${esc(c.detalle || '')}</span>
          </button>`).join('')}
      </div>` : ''}

    <h2 class="titulo-seccion">Tus módulos</h2>
    <div class="rejilla-modulos">
      ${modulos.filter((m) => m.clave !== 'notificaciones').map((m) => {
        const info = resumen[m.clave] || {};
        const chips = !m.disponible ? [{ texto: 'Próximamente', tono: '' }]
          : m.restringido && !(info.chips || []).length ? [{ texto: 'Administrador', tono: 'azul' }]
            : (info.chips || []);
        return `
          <button class="modulo ${m.disponible ? '' : 'proximamente'}" data-modulo="${esc(m.clave)}" ${m.disponible ? '' : 'disabled'}>
            <span class="cabeza-modulo">${simbolo(m.icono)}<b>${esc(m.nombre)}</b></span>
            <span class="linea-modulo">${esc(info.linea || m.descripcion)}</span>
            ${chips.length ? `<span class="chips-modulo">${chips.map((c) => `<span class="etiqueta ${esc(c.tono || '')}">${esc(c.texto)}</span>`).join('')}</span>` : ''}
          </button>`;
      }).join('')}
    </div>`;

  vista.querySelectorAll('[data-modulo]').forEach((boton) => {
    boton.addEventListener('click', () => abrirModulo(boton.dataset.modulo));
  });
}

// Tránsito no estrenó pantalla: es la de envíos que ya funcionaba, ahora
// colgada del menú en vez de escondida dentro de Checklists.
const DESTINO_MODULO = {
  checklists: '#/checklists',
  logistica: '#/logistica',
  bahia: '#/bahia',
  calidad: '#/calidad',
  // Tránsito se mudó adentro de Logística; su dirección sigue sirviendo.
  transito: '#/envios/transito',
  almacen: '#/almacen',
  notificaciones: '#/notificaciones',
  produccion: '#/produccion',
  ventas_fuera: '#/ventas-fuera',
  incidencias: '#/incidencias',
  reportes: '#/reportes',
  configuracion: '#/config',
};

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
  location.hash = (m && m.destino) || DESTINO_MODULO[clave] || '#/menu';
}

// ============================================================= vista: acceso

async function vistaAcceso(claveModulo) {
  // Sin módulo es la puerta de entrada del sistema. Con módulo es una segunda
  // comprobación de la misma persona, que hoy solo pide Configuración.
  let modulo = null;
  if (claveModulo) {
    if (!estado.modulos) estado.modulos = await api('GET', '/api/modulos');
    modulo = estado.modulos.find((m) => m.clave === claveModulo);
    if (!modulo) return void (location.hash = '#/menu');
  }

  // El servidor decide el modo, no la pantalla: mientras quede alguien activo
  // sin clave se sigue entrando por nombre, para no dejarlo fuera del sistema.
  const { modo, personas } = await api('GET',
    claveModulo ? `/api/acceso?modulo=${encodeURIComponent(claveModulo)}` : '/api/acceso');

  const porClave = modo === 'clave';
  const reautentica = !!(modulo && modulo.reautenticar);
  encabezado(modulo ? modulo.nombre : 'Sistema Digital INKO',
    porClave
      ? (reautentica ? 'Confirma tu clave' : 'Ingresa tu clave')
      : '¿Quién eres?');

  // Aviso de un solo uso, para explicar por qué se cerró la sesión.
  const avisoPrevio = sessionStorage.getItem('avisoAlEntrar');
  sessionStorage.removeItem('avisoAlEntrar');

  const cabecera = `
    ${avisoPrevio ? `<div class="aviso info">${esc(avisoPrevio)}</div>` : ''}
    ${modulo ? `<div class="migaja">
      <button data-volver>← Menú</button><span>/</span><span>${esc(modulo.nombre)}</span>
    </div>` : ''}
    ${reautentica ? `
      <div class="aviso info">
        <b>${esc(modulo.nombre)} pide confirmar tu identidad.</b><br>
        Llevas rato dentro del sistema y la tablet pudo cambiar de manos, así que
        aquí se vuelve a capturar la clave: desde esta sección se dan de alta
        personas y se otorgan permisos.
      </div>` : ''}`;

  // Con el ingreso por clave la pantalla no enseña a nadie. Quien llega escribe
  // su clave y el sistema deduce quién es: ya no hay lista de la que enterarse
  // de quién trabaja aquí, ni nombre ajeno que tocar por descuido.
  if (porClave) {
    vista.innerHTML = `${cabecera}<div id="zona-clave"></div>`;
    vista.querySelector('[data-volver]')?.addEventListener('click', () => { location.hash = '#/menu'; });
    panelClave(document.getElementById('zona-clave'), {
      titulo: reautentica ? 'Confirma tu clave' : 'Ingresa tu clave',
      ayuda: 'Toca los números o escribe tu clave si lleva letras',
      alEntrar: (clave) => entrar({ pin: clave }, claveModulo),
    });
    return;
  }

  // Modo por nombre. Es transitorio: desaparece en cuanto el Administrador
  // termine de asignar clave a todo el personal activo.
  vista.innerHTML = `
    ${cabecera}
    ${personas.length === 0 ? `
      <div class="panel"><div class="vacio">
        ${modulo ? `Nadie puede entrar a ${esc(modulo.nombre)} todavía.` : 'No hay personas dadas de alta.'}<br>
        ${reautentica
          ? 'Esta sección exige clave, y ninguna persona con ese acceso tiene una asignada.'
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
              ${u.requiere_pin ? '<span class="llave" title="Pide clave">🔒</span>' : ''}
            </button>`).join('')}
        </div>
      </div>`}
    <div id="zona-clave"></div>`;

  vista.querySelector('[data-volver]')?.addEventListener('click', () => { location.hash = '#/menu'; });

  vista.querySelectorAll('[data-usuario]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const id = Number(boton.dataset.usuario);
      // En un módulo que reautentica siempre se pasa por la clave, sin atajos.
      if (boton.dataset.pin === '1' || reautentica) {
        panelClave(document.getElementById('zona-clave'), {
          titulo: 'Clave de acceso',
          quien: boton.dataset.nombre,
          ayuda: 'Toca los números o escribe tu clave si lleva letras',
          alEntrar: (clave) => entrar({ usuario_id: id, pin: clave }, claveModulo),
        });
      } else {
        entrar({ usuario_id: id, pin: '' }, claveModulo);
      }
    });
  });
}

// El módulo viaja al servidor para que compruebe el permiso ANTES de dejar
// entrar: sin lista filtrada en pantalla, es el único punto donde se puede
// distinguir «tu clave está mal» de «tu clave está bien, pero esto no te toca».
async function entrar(credenciales, claveModulo) {
  const datos = await api('POST', '/api/entrar', { ...credenciales, modulo: claveModulo || undefined });
  guardarSesion(datos);
  estado.modulos = null; // el menú se rearma con los permisos de quien entró
  location.hash = claveModulo ? (DESTINO_MODULO[claveModulo] || '#/menu') : '#/menu';
}

// Teclado en pantalla: en una tablet de almacén, con guantes, es más fiable que
// el teclado del sistema. Sirve igual cuando la clave dice quién eres que
// cuando solo confirma un nombre ya elegido.
function panelClave(zona, { titulo, quien, ayuda, alEntrar }) {
  let clave = '';

  // El acceso quedó trabado a los cuatro intentos. En vez de repetir «clave
  // incorrecta» hasta que alguien llegue con una computadora, la pantalla
  // explica qué pasó y ofrece la liberación aquí mismo: el Administrador o
  // Hector escriben su propia clave y se abre al instante.
  const dibujarBloqueo = (bloqueo, error) => {
    const desde = bloqueo.desde
      ? new Date(bloqueo.desde).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
      : null;
    zona.innerHTML = `
      <div class="panel peligroso">
        <h2>Acceso bloqueado</h2>
        <div class="pin-zona">
          ${error ? `<div class="aviso error">${esc(error)}</div>` : ''}
          <div class="explica" style="text-align:left">
            <ul class="lista-breve">
              <li>${bloqueo.tipo === 'persona'
                ? `Se bloqueó la clave de <b>${esc(bloqueo.quien || '')}</b>, y sigue bloqueada en cualquier tablet.`
                : 'Se bloqueó <b>esta tablet</b>. Desde otra se puede entrar normal.'}</li>
              <li>${esc(bloqueo.motivo || '')}${desde ? ` · desde el ${esc(desde)}` : ''}</li>
              <li><b>Se libera aquí mismo:</b> el Administrador o Hector escriben su clave abajo.
                Queda anotado quién liberó.</li>
            </ul>
          </div>
          <input id="clave-libera" class="pin-campo" type="password" inputmode="text"
                 autocomplete="off" autocapitalize="off" spellcheck="false"
                 maxlength="12" aria-label="Clave de quien libera">
          <span class="nota-foto">La clave de quien libera, no la que se bloqueó</span>
          <div class="fila-botones" style="justify-content:center">
            <button class="btn primario grande" id="btn-liberar">Liberar el acceso</button>
          </div>
        </div>
      </div>`;

    const campo = zona.querySelector('#clave-libera');
    const liberar = async () => {
      try {
        const r = await api('POST', '/api/acceso/liberar', {
          clave: campo.value,
          usuario_id: bloqueo.tipo === 'persona' ? bloqueo.usuario_id : undefined,
        });
        clave = '';
        dibujar(null, null, r.mensaje);
      } catch (err) {
        campo.value = '';
        dibujarBloqueo(bloqueo, err.message);
      }
    };
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') liberar(); });
    zona.querySelector('#btn-liberar').addEventListener('click', liberar);
    if (!ES_TACTIL) campo.focus();
  };

  // El campo y el teclado en pantalla trabajan sobre el mismo valor: se puede
  // tocar los números o escribir directo. Las claves con letras solo se pueden
  // capturar tecleando, así que el campo tiene que estar siempre disponible.
  const dibujar = (error, bloqueo, hecho) => {
    if (bloqueo) return dibujarBloqueo(bloqueo, error);
    zona.innerHTML = `
      <div class="panel">
        <h2>${esc(titulo)}</h2>
        <div class="pin-zona">
          ${error ? `<div class="aviso error">${esc(error)}</div>` : ''}
          ${hecho ? `<div class="aviso exito">${esc(hecho)}</div>` : ''}
          ${quien ? `<span class="quien">${esc(quien)}</span>` : ''}
          <input id="campo-clave" class="pin-campo" type="password" inputmode="text"
                 autocomplete="off" autocapitalize="off" spellcheck="false"
                 maxlength="12" value="${esc(clave)}" aria-label="${esc(titulo)}">
          <span class="nota-foto">${esc(ayuda)}</span>
          <div class="teclado">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-tecla="${n}">${n}</button>`).join('')}
            <button class="tenue" data-tecla="borrar">Borrar</button>
            <button data-tecla="0">0</button>
            <button class="tenue" data-tecla="entrar">Entrar</button>
          </div>
        </div>
      </div>`;

    const campo = zona.querySelector('#campo-clave');
    campo.addEventListener('input', () => { clave = campo.value; });
    // En la tablet, al abrirse el teclado la página se reacomoda y el campo se
    // va de la vista. Se vuelve a centrar un momento después, ya con el teclado
    // arriba, para no tener que buscarlo otra vez.
    campo.addEventListener('focus', () => {
      setTimeout(() => campo.scrollIntoView({ block: 'center' }), 300);
    });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') intentar(); });

    const intentar = async () => {
      try {
        await alEntrar(clave);
      } catch (err) {
        clave = '';
        // Un bloqueo cambia toda la pantalla; una clave equivocada no. En ese
        // caso solo se escribe el aviso y se vacía el campo, sin volver a
        // pintar: en la tablet, repintar cierra el teclado y manda la pantalla
        // al principio, y hay que empezar de nuevo a buscar dónde se escribía.
        const bloqueo = err.datos && err.datos.bloqueo;
        if (bloqueo) return dibujar(err.message, bloqueo);
        const aviso = zona.querySelector('.aviso.error');
        if (aviso) aviso.textContent = err.message;
        else zona.querySelector('.pin-zona').insertAdjacentHTML('afterbegin',
          `<div class="aviso error">${esc(err.message)}</div>`);
        campo.value = '';
        campo.focus();
      }
    };

    zona.querySelectorAll('[data-tecla]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.tecla;
        if (t === 'borrar') { clave = clave.slice(0, -1); campo.value = clave; return campo.focus(); }
        if (t === 'entrar') return intentar();
        if (clave.length >= 12) return;
        clave += t;
        campo.value = clave;
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

const ESTADO_VISUAL_TARJETA = {
  pendiente: ['', 'Pendiente'],
  borrador: ['ambar', 'En proceso'],
  en_ruta: ['azul', 'En ruta'],
  cerrado: ['verde', 'Completado'],
};

// Las tarjetas de checklist se pintan en dos lugares: en Checklists y dentro de
// Logística, que es donde vive la unidad completa. Es la misma tarjeta y el
// mismo camino al llenarla; lo único que cambia es desde dónde se entró.
function rejillaTarjetas(tarjetas) {
  return `<div class="rejilla-tareas">${tarjetas.map((t, i) => {
    const [color, texto] = (t.estado !== 'pendiente' && ETIQUETA_REVISION[t.revision])
      || ESTADO_VISUAL_TARJETA[t.estado] || ['', ''];
    return `
      <button class="tarea ${t.estado} ${t.activo_imagen ? 'con-imagen' : ''}" ${t.disponible ? '' : 'disabled'} data-tarjeta="${i}">
        ${t.activo_imagen ? `<img class="imagen-tarjeta" data-archivo="${esc(t.activo_imagen)}" alt="${esc(t.activo_nombre || '')}">` : ''}
        <span class="etiqueta ${color}">${texto}</span>
        <b>${esc(t.plantilla_nombre)}${t.activo_nombre ? ` · ${esc(t.activo_nombre)}` : ''}</b>
        <span class="meta">${esc(t.descripcion || '')}</span>
        <span class="meta">${ETIQUETA_FRECUENCIA[t.frecuencia]} · ${esc(t.periodo)}${
          !t.disponible ? ' · disponible el viernes'
            : t.fuera_de_dia ? ' · <b>fuera de su día</b>: lo abres como Administrador' : ''}</span>
      </button>`;
  }).join('')}</div>`;
}

// Al llenar un checklist se recuerda de dónde se venía, para que al cerrarlo
// regrese ahí y no a otra pantalla.
function conectarTarjetas(tarjetas, regreso = '#/logistica/checklists') {
  cargarImagenesPendientes();
  vista.querySelectorAll('[data-tarjeta]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const t = tarjetas[Number(boton.dataset.tarjeta)];
      estado.regresoChecklist = regreso;
      location.hash = `#/llenar/${t.plantilla_clave}${t.activo_id ? `/${t.activo_id}` : ''}`;
    });
  });
}

// La portada de Checklists ya no existe: su pantalla es la de Logística. La
// dirección vieja sigue viva porque hay tablets con ella abierta y avisos que
// apuntan ahí; lleva a donde ahora viven los checklists.
function vistaChecklists() {
  location.replace(`${location.pathname}#/logistica/checklists`);
}

// ==================================================== vista: lista de envíos

// Un envío sale y regresa; una colecta se carga. Mismo camino, otras palabras.
// Cada tipo de salida se nombra como lo que es. Son las mismas etapas —antes de
// salir y al regresar— pero llamarle «envío» a una custodia confunde a quien lo
// llena y a quien lo lee después.
const SALIDA_DE_UNIDAD = {
  antes: 'Antes de salir', despues: 'Al regresar', documento: 'la evidencia de regreso',
  registrada: 'Registrada al salir', seCompleta: 'Se completa al regresar',
  paso: 'salida', Paso: 'Salida',
};
// Todo lo que vale un campo de cabecera que admite varios: el principal y los
// demás. En el formato vehicular, «tipo» y «tipos_extra».
const propositos = (datos, campo = 'tipo') => {
  const d = datos || {};
  return [d[campo], ...String(d[`${campo}s_extra`] || '').split(',')]
    .map((x) => String(x || '').trim()).filter(Boolean);
};

const PALABRAS_TRANSITO = {
  cedis: {
    ...SALIDA_DE_UNIDAD,
    nombre: 'Envío a CEDIS', este: 'este envío', documento: 'la hoja de recepción',
  },
  ventas_directas: {
    ...SALIDA_DE_UNIDAD, nombre: 'Envío de ventas directas', este: 'este envío',
  },
  custodia: { ...SALIDA_DE_UNIDAD, nombre: 'Custodia', este: 'esta custodia' },
  traspaso: {
    ...SALIDA_DE_UNIDAD, nombre: 'Traspaso entre bodegas', este: 'este traspaso',
    documento: 'la evidencia de la carga',
  },
  encargo: { ...SALIDA_DE_UNIDAD, nombre: 'Encargo', este: 'este encargo' },
  // Se queda para lo capturado antes de que el formato se abriera a los cuatro
  // tipos: un «envío» viejo es un envío a CEDIS.
  envio: {
    ...SALIDA_DE_UNIDAD, nombre: 'Envío', este: 'este envío',
    documento: 'la hoja de recepción',
  },
  colecta: {
    nombre: 'Colecta', este: 'esta colecta', paso: 'carga', Paso: 'Carga',
    antes: 'Antes de cargar', despues: 'Después de cargar', documento: 'la evidencia de carga recolectada',
    registrada: 'Registrada antes de cargar', seCompleta: 'Se completa después de cargar',
  },
};
const palabrasTransito = (datos) => {
  let d = datos;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  return PALABRAS_TRANSITO[(d || {}).tipo] || PALABRAS_TRANSITO.cedis;
};

// En qué punto va, dicho para la tarjeta: [color, texto].
function etiquetaTransito(l) {
  const p = palabrasTransito(l.datos);
  if (l.estado === 'cerrado') return ['verde', 'Concluido'];
  if (l.revision === 'modificacion') return ['roja', 'Por corregir'];
  if (l.estado === 'borrador') return l.revision === 'por_autorizar' ? ['azul', `${p.Paso} por autorizar`] : ['ambar', 'Preparando'];
  return l.revision === 'por_aprobar' ? ['azul', 'Cierre por aprobar'] : ['azul', `${p.Paso} autorizada`];
}

async function vistaEnvios(plantillaClave) {
  const { plantilla, abiertos, cerrados, periodo } = await api('GET', `/api/plantillas/${plantillaClave}/llenados`);
  encabezado(plantilla.nombre, `${esc(plantilla.descripcion || '')} · ${periodo}`);

  const tarjetaEnvio = (l) => {
    const p = palabrasTransito(l.datos);
    const [color, texto] = etiquetaTransito(l);
    const hora = (iso) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const detalle = l.estado === 'cerrado' && l.cerrado_en ? `Cierre aprobado ${hora(l.cerrado_en)}`
      : l.revision === 'modificacion' ? 'Lo regresaron para corregir'
        : l.revision === 'por_autorizar' ? `Esperando autorización de ${p.paso}`
          : l.revision === 'por_aprobar' ? 'Esperando aprobación de cierre'
            : l.estado === 'en_ruta' ? `${p.Paso} autorizada${l.salida_en ? ` ${hora(l.salida_en)}` : ''} · falta ${p.documento}`
              : `Aún no se envía a autorización de ${p.paso}`;
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
      <button data-ir-hash="#/logistica">Logística</button><span>/</span><span>Salidas de unidad</span>
    </div>
    <div id="mensajes"></div>

    <div class="fila-botones" style="margin-bottom:18px">
      <button class="btn primario grande" id="nuevo-envio">+ Nueva salida de unidad</button>
    </div>

    <div id="traspasos-transito"></div>

    <section class="panel">
      <h2>En proceso ${abiertos.length ? `<span class="etiqueta ambar">${abiertos.length}</span>` : ''}</h2>
      ${abiertos.length
        ? `<div class="rejilla-tareas" style="padding:18px">${abiertos.map(tarjetaEnvio).join('')}</div>`
        : '<div class="vacio">No hay salidas abiertas. Toca «Nueva salida de unidad» para comenzar.</div>'}
    </section>

    ${cerrados.length ? `
      <section class="panel">
        <h2>Concluidos hoy <span class="etiqueta verde">${cerrados.length}</span></h2>
        <div class="rejilla-tareas" style="padding:18px">${cerrados.map(tarjetaEnvio).join('')}</div>
      </section>` : ''}`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  document.getElementById('nuevo-envio').addEventListener('click', () => {
    abrirCabecera({ plantilla_clave: plantilla.clave, plantilla_nombre: plantilla.nombre, campos: plantilla.campos });
  });
  vista.querySelectorAll('[data-envio]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/envio/${b.dataset.envio}`; });
  });

  pintarTraspasosDeTransito();
}

// Los traspasos que esperan a Tránsito. El documento es de Almacén; aquí solo se
// asoma el paso que les toca —avisar que el material ya va cargado, con foto—
// para que no tengan que ir a buscarlo a un módulo que no es suyo.
async function pintarTraspasosDeTransito() {
  const destino = document.getElementById('traspasos-transito');
  if (!destino) return;
  let traspasos = [];
  try { ({ traspasos } = await api('GET', '/api/transito/traspasos')); }
  catch { return; }
  if (!traspasos.length) return;

  const porCargar = traspasos.filter((t) => t.estado === 'aprobado');
  destino.innerHTML = `
    <section class="panel">
      <h2>Traspasos entre bodegas
        ${porCargar.length ? `<span class="etiqueta ambar">${porCargar.length} por cargar</span>` : ''}
      </h2>
      <p class="explica">
        Material que Almacén ya aprobó mover de una bodega a otra. Cuando esté
        cargado en el camión, ábrelo, sube la foto de la carga y avisa.
      </p>
      <div class="rejilla-tareas" style="padding:18px">
        ${traspasos.map((t) => `
          <button class="tarea ${t.estado === 'aprobado' ? 'por_autorizar' : 'borrador'}"
                  data-ir-hash="#/almacen/traspaso/${t.id}">
            <span class="etiqueta ${t.estado === 'aprobado' ? 'ambar' : 'azul'}">
              ${t.estado === 'aprobado' ? 'Por cargar' : 'En camino'}</span>
            <b>${esc(t.folio)} · ${esc(t.origen_clave)} → ${esc(t.destino_clave || '—')}</b>
            <span class="meta">${t.productos} producto(s) · ${numero(t.unidades)} unidades</span>
            <span class="meta">${t.odt_semana ? `ODT ${esc(t.odt_semana)} · ` : ''}aprobó ${esc(t.aprobo || '—')}${
              t.fotos ? ` · ${t.fotos} foto(s)` : ' · sin foto'}</span>
          </button>`).join('')}
      </div>
    </section>`;
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
          <div class="campo" data-campo-cabecera="${esc(c.clave)}" ${c.segun ? 'hidden' : ''}>
            <label for="c-${esc(c.clave)}">${esc(c.etiqueta)}${c.requerido ? '' : ' (opcional)'}</label>
            ${c.multi
              ? `<div class="marcas-cabecera" id="c-${esc(c.clave)}" data-multi>
                   ${c.opciones.map((o) => `
                     <button type="button" class="marca" data-valor="${esc(o.valor)}" aria-pressed="false">
                       ${esc(o.etiqueta)}</button>`).join('')}
                 </div>`
              : c.opciones
              ? `<select id="c-${esc(c.clave)}">
                   <option value="">Elige una opción…</option>
                   ${c.opciones.map((o) => `<option value="${esc(o.valor)}">${esc(o.etiqueta)}</option>`).join('')}
                 </select>`
              : `<input id="c-${esc(c.clave)}" autocomplete="off" ${(c.sugerencias || []).length ? `list="sug-${esc(c.clave)}"` : ''}>
                 ${(c.sugerencias || []).length ? `<datalist id="sug-${esc(c.clave)}">
                   ${c.sugerencias.map((o) => `<option value="${esc(o.valor)}">${esc(o.etiqueta)}</option>`).join('')}</datalist>
                   <small style="color:var(--tinta-suave)">Si es un envío de la ODT, escógelo de la lista: queda ligado a lo que armó Producción.</small>` : ''}`}
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

  // Un campo que depende de otro —el número y el CEDIS dependen de si es envío o
  // colecta— aparece hasta que ese otro se contesta, y su etiqueta se ajusta.
  const etiquetaCampo = (c, valores) => (c.etiquetas && c.etiquetas[valores[c.segun]]) || c.etiqueta;

  // Lo marcado en un campo de varios, en el orden en que está en pantalla.
  const marcadas = (clave) => [...capa.querySelectorAll(`#c-${clave} .marca[aria-pressed="true"]`)]
    .map((b) => b.dataset.valor);
  const valorDe = (clave) => {
    const campo = tarjeta.campos.find((x) => x.clave === clave);
    if (campo && campo.multi) return marcadas(clave).join(',');
    const control = capa.querySelector(`#c-${clave}`);
    return control ? control.value.trim() : '';
  };

  const ajustarDependientes = () => {
    for (const c of tarjeta.campos.filter((x) => x.segun)) {
      const principal = valorDe(c.segun);
      // Todo lo que la unidad va a hacer: lo principal y lo que se haya marcado
      // como «algo más». Un campo se pide si le toca a cualquiera de ellos.
      const todos = [principal, ...valorDe(`${c.segun}s_extra`).split(',')]
        .map((x) => x.trim()).filter(Boolean);
      const caja = capa.querySelector(`[data-campo-cabecera="${c.clave}"]`);
      // 'solo' acota a qué valores aplica el campo: la unidad y el operador no
      // se piden en una colecta, donde no sale ninguna unidad nuestra.
      caja.hidden = !principal || (c.solo && !todos.some((v) => c.solo.includes(v)));
      caja.querySelector('label').textContent = etiquetaCampo(c, { [c.segun]: principal });
    }
    // Lo principal no se marca además como «algo más».
    for (const c of tarjeta.campos.filter((x) => x.multi)) {
      const principal = valorDe(c.segun);
      capa.querySelectorAll(`#c-${c.clave} .marca`).forEach((b) => {
        const esElPrincipal = b.dataset.valor === principal;
        b.disabled = esElPrincipal;
        b.title = esElPrincipal ? 'Ya es a lo que sale la unidad' : '';
        if (esElPrincipal) b.setAttribute('aria-pressed', 'false');
      });
    }
  };
  capa.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', ajustarDependientes));
  capa.querySelectorAll('.marcas-cabecera .marca').forEach((b) => b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    ajustarDependientes();
  }));

  // Escoger una cita de la ODT llena también su CEDIS.
  for (const c of tarjeta.campos.filter((x) => (x.sugerencias || []).length)) {
    capa.querySelector(`#c-${c.clave}`).addEventListener('change', (e) => {
      const s = c.sugerencias.find((o) => o.valor === e.target.value.replace(/\D/g, ''));
      const cedis = capa.querySelector('#c-lugar_entrega');
      if (s && cedis && [...cedis.options].some((o) => o.value === s.cedis)) cedis.value = s.cedis;
    });
  }

  capa.querySelector('[data-comenzar]').addEventListener('click', async () => {
    const datos = {};
    for (const c of tarjeta.campos) datos[c.clave] = valorDe(c.clave);
    // Un campo que no aplica a este tipo —el CEDIS en una custodia— no se pide
    // ni se manda: antes trababa el alta con un «Falta CEDIS» que no tenía
    // dónde contestarse, porque el campo ni se enseña.
    const aplica = (c) => !c.solo
      || [datos[c.segun], ...String(datos[`${c.segun}s_extra`] || '').split(',')]
        .map((x) => String(x || '').trim()).filter(Boolean)
        .some((v) => c.solo.includes(v));
    for (const c of tarjeta.campos.filter((x) => !aplica(x))) datos[c.clave] = '';
    const primerCampo = tarjeta.campos.filter(aplica).find((c) => c.requerido && !datos[c.clave]);
    if (primerCampo) {
      capa.querySelector('#error-cabecera').innerHTML = avisoError(`Falta «${etiquetaCampo(primerCampo, datos)}».`);
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

  capa.querySelector('select, input').focus();
}

// ============================================================= vista: llenar

// Abre un checklist ya iniciado por su id. Necesario en Tránsito, donde puede
// haber varios el mismo día y no basta con plantilla + periodo.
async function vistaEnvio(llenadoId) {
  const { llenado, plantilla } = await api('GET', `/api/llenados/${llenadoId}/abrir`);
  pintarLlenado(plantilla, llenado);
  pintarPropositosDeLaSalida(plantilla, llenado);
  pintarTraspasosDeLaSalida(llenado);
  pintarRutaDeLaSalida(llenado);
}

// QUÉ VA A HACER ESTA SALIDA.
//
// Se dice al abrir el formato, pero una salida cambia mientras se prepara: ya
// que la unidad va al CEDIS, que aproveche y traiga el traspaso. Se marca aquí
// y el formato agrega en el acto las preguntas y los datos de lo nuevo, en vez
// de abrir otro formato para la misma unidad y el mismo viaje.
function pintarPropositosDeLaSalida(plantilla, llenado) {
  const campo = (plantilla.campos || []).find((c) => c.multi);
  if (!campo) return;
  const datos = llenado.datos || {};
  const principal = datos[campo.segun];
  if (!principal || (campo.solo && !campo.solo.includes(principal))) return;

  const marcados = String(datos[campo.clave] || '').split(',').map((x) => x.trim()).filter(Boolean);
  // Mientras espera autorización o ya salió, lo que iba a hacer ya no se toca:
  // se autorizó eso y no otra cosa.
  const sePuede = llenado.estado === 'borrador' && llenado.revision !== 'por_autorizar';
  const etiquetaDe = (v) => ((campo.opciones.find((o) => o.valor === v) || {}).etiqueta || v);

  const zona = document.getElementById('mensajes');
  if (!zona) return;
  document.getElementById('propositos-de-la-salida')?.remove();

  zona.insertAdjacentHTML('afterend', `
    <section class="panel" id="propositos-de-la-salida">
      <h2>Qué va a hacer esta salida
        <span class="etiqueta azul">${esc(etiquetaDe(principal))}</span>
        ${marcados.map((v) => `<span class="etiqueta verde">${esc(etiquetaDe(v))}</span>`).join('')}
      </h2>
      ${sePuede ? `
        <p class="explica">
          Un viaje puede hacer varias cosas. Marca lo demás y el formato agrega sus
          preguntas y sus datos; desmarca y se quitan. Lo que ya se contestó no se borra.
        </p>
        <div class="marcas-cabecera" style="padding:0 18px 18px">
          ${campo.opciones.filter((o) => o.valor !== principal).map((o) => `
            <button type="button" class="marca" data-proposito="${esc(o.valor)}"
                    aria-pressed="${marcados.includes(o.valor)}">${esc(o.etiqueta)}</button>`).join('')}
        </div>`
    : '<p class="explica">Ya se mandó a autorizar: esto se autoriza tal como está.</p>'}
    </section>`);

  if (!sePuede) return;
  document.querySelectorAll('[data-proposito]').forEach((b) => b.addEventListener('click', async () => {
    const valor = b.dataset.proposito;
    const agrega = b.getAttribute('aria-pressed') !== 'true';
    const nuevos = agrega ? [...marcados, valor] : marcados.filter((x) => x !== valor);
    const cambio = { [campo.clave]: nuevos.join(',') };

    // Agregar un propósito puede traer datos nuevos —un traspaso pide de qué
    // bodega—. Se piden aquí mismo: mandar el cambio y que el servidor conteste
    // «falta la bodega» dejaría a quien lo llena sin dónde contestar.
    const comoQueda = { ...datos, ...cambio };
    const faltan = (plantilla.campos || []).filter((c) => c.requerido && !c.multi
      && !comoQueda[c.clave]
      && c.solo && propositos(comoQueda, c.segun).some((v) => c.solo.includes(v)));
    if (faltan.length) {
      const puestos = await pedirDatosDeCabecera(faltan, etiquetaDe(valor));
      if (!puestos) return;
      Object.assign(cambio, puestos);
    }

    try {
      await api('PUT', `/api/llenados/${llenado.id}/datos`, { datos: cambio });
      mostrarMensaje(agrega
        ? `Se agregó «${etiquetaDe(valor)}» a esta salida.`
        : `Se quitó «${etiquetaDe(valor)}» de esta salida.`, 'exito');
      vistaEnvio(llenado.id);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
}

// Los datos que trae consigo un propósito nuevo. Devuelve lo capturado, o null
// si se arrepintió.
function pedirDatosDeCabecera(campos, loQueSeAgrega) {
  return new Promise((resolver) => {
    const capa = document.createElement('div');
    capa.className = 'modal';
    capa.innerHTML = `
      <div class="caja-modal" role="dialog" aria-label="Datos que faltan">
        <h2>Para agregar ${esc(loQueSeAgrega)}</h2>
        <div class="cuerpo-modal">
          <div id="error-extra"></div>
          <p class="explica" style="padding:0 0 14px">
            Eso trae ${campos.length === 1 ? 'un dato' : 'unos datos'} que todavía no están en el formato.
          </p>
          ${campos.map((c) => `
            <div class="campo">
              <label for="x-${esc(c.clave)}">${esc(c.etiqueta)}</label>
              ${c.opciones
    ? `<select id="x-${esc(c.clave)}">
                     <option value="">Elige una opción…</option>
                     ${c.opciones.map((o) => `<option value="${esc(o.valor)}">${esc(o.etiqueta)}</option>`).join('')}
                   </select>`
    : `<input id="x-${esc(c.clave)}" autocomplete="off">`}
              ${c.ayuda ? `<small style="color:var(--tinta-suave)">${esc(c.ayuda)}</small>` : ''}
            </div>`).join('')}
        </div>
        <div class="pie-modal">
          <button class="btn" data-cancelar>Cancelar</button>
          <button class="btn primario" data-guardar>Agregar</button>
        </div>
      </div>`;
    document.body.appendChild(capa);

    const cerrar = (valor) => { capa.remove(); resolver(valor); };
    capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(null); });
    capa.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));
    capa.querySelector('[data-guardar]').addEventListener('click', () => {
      const puestos = {};
      for (const c of campos) puestos[c.clave] = capa.querySelector(`#x-${c.clave}`).value.trim();
      const falta = campos.find((c) => !puestos[c.clave]);
      if (falta) {
        capa.querySelector('#error-extra').innerHTML = avisoError(`Falta «${falta.etiqueta}».`);
        return;
      }
      cerrar(puestos);
    });
  });
}

// Qué va a entregar esta salida, en qué orden.
//
// Aquí NO se planea nada. Quien llena el formato está en el patio revisando la
// unidad; la ruta se arma en Logística → Ruta para entrega, y ahí se dice qué
// salida la lleva. Este panel solo aparece cuando esta salida ya tiene una ruta
// asignada, y es para leerla: qué paradas van y cómo van.
async function pintarRutaDeLaSalida(llenado) {
  const dia = (llenado.creado_en || new Date().toISOString()).slice(0, 10);
  let d;
  try { d = await api('GET', `/api/logistica/rutas?fecha=${dia}`); } catch { return; }

  const suya = d.rutas.find((r) => r.llenado_id === llenado.id);
  if (!suya) return;
  const zona = document.getElementById('mensajes');
  if (!zona) return;
  // La pantalla se pide, tarda y se pinta: dos toques seguidos la pintan dos
  // veces. El panel de la ruta se reemplaza, no se apila.
  document.getElementById('ruta-de-la-salida')?.remove();

  zona.insertAdjacentHTML('afterend', `
    <section class="panel" id="ruta-de-la-salida">
      <h2>Esta salida lleva la ruta ${esc(suya.folio)}
        <span class="etiqueta ${suya.pendientes ? 'ambar' : 'verde'}">${suya.paradas.length} parada(s)</span>
      </h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">#</th><th>Qué es</th><th>A dónde</th><th>Cómo va</th></tr></thead>
        <tbody>${suya.paradas.map((p, i) => `
          <tr>
            <td class="fila-titulo">${LETRA_PARADA(i)}</td>
            <td><span class="etiqueta ${CLASE_PARADA[p.tipo] || ''}">${esc(p.tipo_etiqueta)}</span></td>
            <td>${esc(p.etiqueta)}${p.direccion ? `<br><small style="color:var(--tinta-suave)">${esc(p.direccion)}</small>` : ''}</td>
            <td>${p.estado === 'entregada' ? '<span class="etiqueta verde">Entregada</span>'
    : p.estado === 'no_entregada' ? '<span class="etiqueta roja">No se entregó</span>'
      : '<span class="etiqueta">Pendiente</span>'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="fila-botones" style="padding:0 18px 18px">
        <button class="btn" data-ir-hash="#/logistica/rutas">Abrir la ruta para marcar entregas</button>
      </div>
    </section>`);
}

// Lo que amarra una salida por traspaso con las solicitudes de Almacén: las que
// están esperando en la bodega de la que se va a traer el material. No se
// duplica nada —el traspaso sigue siendo un documento de Almacén— pero quien
// sale ve desde aquí qué va a recoger y puede abrirlo para avisar que ya va
// cargado. Si no tiene ese permiso, el panel no aparece.
async function pintarTraspasosDeLaSalida(llenado) {
  const datos = llenado.datos || {};
  if (!propositos(datos).includes('traspaso')) return;

  let traspasos = [];
  try { ({ traspasos } = await api('GET', '/api/transito/traspasos')); } catch { return; }
  const suyos = traspasos.filter((t) => !datos.bodega_origen || t.origen_clave === datos.bodega_origen);

  const zona = document.getElementById('mensajes');
  if (!zona) return;
  zona.insertAdjacentHTML('afterend', `
    <section class="panel">
      <h2>Traspasos que esperan en ${esc(datos.bodega_origen || 'esa bodega')}
        <span class="etiqueta ${suyos.some((t) => t.estado === 'aprobado') ? 'ambar' : 'azul'}">${suyos.length}</span></h2>
      <p class="explica">
        Solicitudes de traspaso que Almacén ya aprobó y están en esa bodega. Ábrelas
        para subir la foto de la carga y avisar que el material ya va en la unidad.
      </p>
      ${suyos.length ? `
        <div class="rejilla-tareas" style="padding:18px">
          ${suyos.map((t) => `
            <button class="tarea ${t.estado === 'aprobado' ? 'por_autorizar' : 'borrador'}"
                    data-ir-hash="#/almacen/traspaso/${t.id}">
              <span class="etiqueta ${t.estado === 'aprobado' ? 'ambar' : 'azul'}">
                ${t.estado === 'aprobado' ? 'Por cargar' : 'En camino'}</span>
              <b>${esc(t.folio)} · ${esc(t.origen_clave)} → ${esc(t.destino_clave || '—')}</b>
              <span class="meta">${t.productos} producto(s) · ${numero(t.unidades)} unidades</span>
              <span class="meta">${t.odt_semana ? `ODT ${esc(t.odt_semana)} · ` : ''}aprobó ${esc(t.aprobo || '—')}</span>
            </button>`).join('')}
        </div>`
    : '<div class="vacio">No hay traspasos aprobados esperando en esa bodega.</div>'}
    </section>`);
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

// Las unidades dicen «Comentarios adicionales»; los demás checklists conservan
// «Observaciones adicionales».
const etiquetaNotas = (plantilla) => (plantilla && plantilla.aplica_a === 'vehiculo'
  ? 'Comentarios adicionales' : 'Observaciones adicionales');

const ETIQUETA_REVISION = {
  por_aprobar: ['azul', 'Enviado · por aprobar'],
  modificacion: ['roja', 'Modificación solicitada'],
  aprobado: ['verde', 'Aprobado'],
};

function avisoRevision(llenado) {
  if (llenado.revision === 'modificacion' && llenado.modificacion) {
    return `<div class="aviso error"><span><b>Te pidieron corregir este checklist.</b>
      <small>${esc(llenado.modificacion.nombre || 'Un Team Leader')}: «${esc(llenado.modificacion.nota || '')}».
      Corrige lo que indica, vuelve a firmar y envíalo.</small></span></div>`;
  }
  if (llenado.estado === 'cerrado' && llenado.revision === 'por_aprobar') {
    return '<div class="aviso info">Enviado. Está esperando que un Team Leader lo apruebe; hasta entonces no entra a Reportes.</div>';
  }
  return '';
}

function pintarRevisiones(revisiones) {
  if (!revisiones || !revisiones.length) return '';
  const texto = {
    enviado: 'Enviado', enviado_salida: 'Enviado a autorización', salida_autorizada: 'Autorizó la salida o la carga',
    aprobado: 'Aprobado', modificacion: 'Pidió modificación',
  };
  return `
    <section class="panel">
      <h2>Revisión</h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Paso</th><th>Quién</th><th>Cuándo</th><th>Nota</th></tr></thead>
        <tbody>${revisiones.map((v) => `
          <tr class="${v.accion === 'modificacion' ? 'vigencia-vencida' : ''}">
            <td class="fila-titulo">${esc(texto[v.accion] || v.accion)}</td>
            <td>${esc(v.nombre || '—')}</td>
            <td>${esc(new Date(v.en).toLocaleString('es-MX'))}</td>
            <td style="text-align:left">${esc(v.nota || '—')}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>`;
}

// Un envío de Tránsito que es una cita de la ODT dice arriba cómo va su armado.
async function ligarEnvioConODT(plantilla, llenado) {
  if (plantilla.clave !== 'transito' || (llenado.datos || {}).tipo !== 'envio' || !llenado.datos.numero_envio) return;
  try {
    const { envio } = await api('GET', `/api/transito/envio-odt?numero=${encodeURIComponent(llenado.datos.numero_envio)}`);
    const donde = vista.querySelector('#mensajes');
    if (!envio || !donde || document.querySelector('.tira-conexiones[data-odt]')) return;
    donde.insertAdjacentHTML('afterend', `
      <div class="tira-conexiones" data-odt>
        <span>Conectado con</span>
        ${liga(`#/produccion/odt/${envio.odt_id}`, `ODT ${describirSemanaCorta(envio.semana)} · ${envio.etiqueta || ''} ${envio.cedis}`)}
        <span class="dato-conexion">${numero(envio.armado)} de ${numero(envio.total)} armadas ${insigniaSituacion(envio.situacion)}</span>
      </div>`);
  } catch { /* sin ODT no pasa nada */ }
}

function pintarLlenado(plantilla, llenado) {
  setTimeout(() => ligarEnvioConODT(plantilla, llenado), 0);
  estado.plantilla = plantilla;
  estado.llenado = llenado;
  estado.respuestas = new Map(
    llenado.respuestas.map((r) => [llave(r.item_id, r.columna), { valor: r.valor, observacion: r.observacion }])
  );
  indexarFotos(llenado.fotos);

  const cerrado = llenado.estado === 'cerrado';
  const enRuta = llenado.estado === 'en_ruta';
  const porEtapas = !!plantilla.por_etapas;
  // Enviado y esperando a que un Team Leader lo revise: nadie lo modifica.
  const esperando = porEtapas && (llenado.revision === 'por_autorizar' || llenado.revision === 'por_aprobar');

  // Los campos de opciones guardan una clave; aquí se muestra su etiqueta.
  const cabecera = plantilla.campos
    .map((c) => {
      const valor = llenado.datos[c.clave];
      if (!valor) return null;
      const etiquetaDe = (v) => (c.opciones ? (c.opciones.find((o) => o.valor === v) || {}).etiqueta || v : v);
      // Un campo de varios se lee como lo que es: «CEDIS + ventas directas».
      if (c.multi) return valor.split(',').map((v) => etiquetaDe(v.trim())).filter(Boolean).join(' + ');
      return etiquetaDe(valor);
    })
    .filter(Boolean)
    .join(' · ');

  encabezado(
    plantilla.nombre + (plantilla.activo ? ` · ${plantilla.activo.nombre}` : '') + (cabecera ? ` · ${cabecera}` : ''),
    `${porEtapas ? etiquetaTransito(llenado)[1] : (ETIQUETA_ESTADO[llenado.estado] || llenado.estado)} · ${llenado.periodo} · ${estado.usuario.nombre}`
  );

  // Solo la etapa que toca está activa:
  //  · antes de salir, el regreso se ve pero no se puede llenar;
  //  · ya en ruta, la inspección previa queda congelada — es el estado en que la
  //    unidad salió y reescribirlo sería falsearlo.
  const etapaActiva = enRuta ? 'regreso' : 'salida';
  const estadoSeccion = (seccion) => {
    if (cerrado) return 'cerrada';
    if (esperando) return 'en_revision';
    if (!porEtapas || seccion.etapa === etapaActiva) return 'activa';
    return seccion.etapa === 'salida' ? 'registrada' : 'despues';
  };
  estado.etapaActiva = porEtapas ? etapaActiva : null;

  // Un checklist abierto antes de que la plantilla ganara un campo nuevo se
  // queda sin ese dato. En vez de dejarlo atorado, se pide completarlo.
  // Un campo que no aplica a este tipo —el CEDIS en una custodia— no falta.
  // Lo que la unidad va a hacer en este viaje: lo principal y lo demás. Si va
  // al CEDIS y además trae un traspaso, se piden los datos de los dos.
  const campoAplica = (c) => !c.solo || propositos(llenado.datos, c.segun).some((v) => c.solo.includes(v));
  const faltanDatos = plantilla.campos.filter((c) => c.requerido && campoAplica(c) && !llenado.datos[c.clave]);
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
    // Un campo de varios no se repara aquí: se marca en el panel «Qué va a
    // hacer esta salida», dentro del formato, y lo que no se manda se queda
    // como estaba.
    const deReparar = plantilla.campos.filter((c) => campoAplica(c) && !c.multi);
    document.getElementById('completar').innerHTML = deReparar.map((c) => `
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
      for (const c of deReparar) {
        datos[c.clave] = document.getElementById(`d-${c.clave}`).value.trim();
      }
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

  // El formato se firma ANTES de mandarlo a autorizar: lo que un Team Leader
  // autoriza es lo que alguien declaró haber revisado, y eso tiene nombre y
  // firma. Por eso el recuadro está desde la etapa de salida y no solo al
  // concluir —antes se pedía la firma en el envío sin enseñar dónde firmar—.
  const tocaFirmar = true;
  const soloLectura = cerrado || esperando;

  // En un checklist supervisado sin etapas, quien lo llena prepara pero no
  // cierra. Tránsito tiene sus propios pasos: ver botonesTransito().
  const puedeCerrar = !plantilla.requiere_supervision || permiso('firmar_supervision');

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-lista>← ${plantilla.campos.length ? esc(plantilla.nombre) : etiquetaDeRegreso()}</button>
      ${cabecera ? `<span>/</span><span>${esc(cabecera)}</span>` : `<span>/</span><span>${esc(plantilla.nombre)}</span>`}
    </div>
    <div id="mensajes"></div>
    ${plantilla.activo && plantilla.activo.imagen ? `
      <div class="ficha-unidad">
        <img data-archivo="${esc(plantilla.activo.imagen)}" alt="${esc(plantilla.activo.nombre)}">
        <span><b>${esc(plantilla.activo.nombre)}</b><small>${esc(plantilla.activo.clave || '')}</small></span>
      </div>` : ''}
    ${porEtapas ? avisoTransito(llenado) : `
      ${cerrado ? `<div class="aviso exito"><span>Proceso concluido. Solo puedes consultarlo.</span>
        ${permiso('reabrir_cerrados') ? '<button class="btn" id="reabrir-checklist">Reabrir para corregir</button>' : ''}
      </div>` : ''}
      ${avisoRevision(llenado)}`}
    ${cuerpo}
    <div class="panel">
      <h2>${etiquetaNotas(plantilla)}</h2>
      <div style="padding:16px">
        <textarea class="obs" id="notas" rows="3" ${soloLectura ? 'disabled' : ''}
          placeholder="Cualquier detalle que no encaje en los ítems de arriba">${esc(llenado.notas || '')}</textarea>
        ${tiraFotos(null, '-', { soloLectura })}
      </div>
    </div>
    ${porEtapas ? pintarRevisiones(llenado.revisiones) : ''}
    ${tocaFirmar ? pintarFirmas(plantilla, llenado, soloLectura) : ''}
    <div class="pie">
      <span class="resumen" id="resumen"></span>
      <span class="guardado" id="guardado">Guardado</span>
      ${porEtapas ? botonesTransito(llenado)
        : cerrado
          ? '<button class="btn" data-ir-lista>Volver</button>'
          : !puedeCerrar
            ? `<span class="nota-mando">El cierre lo hace un Team Leader</span>
               <button class="btn" data-ir-lista>Volver</button>`
            : '<button class="btn primario" id="cerrar-checklist">Cerrar y enviar</button>'}
    </div>`;

  vista.querySelectorAll('[data-ir-lista]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = listaDeRegreso(); });
  });

  // Reabrir uno ya cerrado: vuelve a captura con el motivo escrito, se le quitan
  // las firmas y tiene que volver a aprobarse. Queda anotado en el resguardo.
  document.getElementById('reabrir-checklist')?.addEventListener('click', async () => {
    const nota = prompt('¿Por qué lo reabres? Queda registrado y lo lee quien lo llenó.');
    if (!nota || nota.trim().length < 5) return;
    try {
      const r = await api('POST', `/api/llenados/${llenado.id}/reabrir`, { nota: nota.trim() });
      mostrarMensaje(r.mensaje, 'exito');
      setTimeout(() => enrutar(), 900);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  if (!cerrado) {
    conectarFirmas(plantilla);
    document.getElementById('notas').addEventListener('input', (e) => guardarNotas(e.target.value));
    document.getElementById('cerrar-checklist')?.addEventListener('click', cerrarChecklist);
    if (porEtapas) conectarAccionesTransito(llenado);
  }
  cargarImagenesPendientes();
  actualizarResumen();
}

// Una plantilla con cabecera vive dentro de su propia pantalla; el resto
// regresa a la portada de checklists.
const listaDeRegreso = () => (estado.plantilla && estado.plantilla.campos && estado.plantilla.campos.length
  ? `#/envios/${estado.plantilla.clave}`
  : estado.regresoChecklist || '#/logistica/checklists');

// Cómo se llama el lugar del que se vino, para que la migaja no diga «Checklists»
// cuando se entró desde Logística.
const etiquetaDeRegreso = () => (estado.regresoChecklist === '#/checklists' ? 'Checklists' : 'Logística');

// --- Tránsito: avisos y botones de cada paso ---

function avisoTransito(l) {
  const p = palabrasTransito(l.datos);
  if (l.estado === 'cerrado') {
    return `<div class="aviso exito"><span>Concluido y aprobado. Solo puedes consultarlo.
      ${l.autorizo ? `<br><small>${p.Paso} autorizada por ${esc(l.autorizo)}${l.cerro ? ` · cierre aprobado por ${esc(l.cerro)}` : ''}</small>` : ''}</span>
      ${permiso('reabrir_cerrados') ? '<button class="btn" id="reabrir-checklist">Reabrir para corregir</button>' : ''}
    </div>`;
  }
  if (l.revision === 'modificacion') {
    const m = l.modificacion || {};
    return `<div class="aviso error"><span><b>Regresaron ${p.este} para corregir.</b>
      <small>${esc(m.nombre || 'Un Team Leader')}: «${esc(m.nota || '')}». Corrige lo que indica y vuelve a enviarlo${
        l.estado === 'en_ruta' ? '; la firma se quitó, hay que firmar otra vez' : ''}.</small></span></div>`;
  }
  if (l.revision === 'por_autorizar') {
    return `<div class="aviso info"><b>Enviado a autorización de ${p.paso}.</b> Un Team Leader o el
      Administrador lo revisa; mientras tanto no se modifica.</div>`;
  }
  if (l.revision === 'por_aprobar') {
    return `<div class="aviso info"><b>Enviado a aprobación de cierre.</b> Cuando un Team Leader lo
      apruebe pasa a Reportes; mientras tanto no se modifica.</div>`;
  }
  if (l.estado === 'en_ruta') {
    return `<div class="aviso info"><b>${p.Paso} autorizada${l.autorizo ? ` por ${esc(l.autorizo)}` : ''}.</b>
      Lo de antes quedó registrado y no se modifica. Carga ${p.documento}, firma y toca
      <b>Enviar a aprobación de cierre</b>.</div>`;
  }
  return `<div class="aviso info">Completa todos los puntos y carga los documentos. Después toca
    <b>Enviar a autorización de ${p.paso}</b>: un Team Leader lo revisa y lo autoriza.</div>`;
}

function botonesTransito(l) {
  const p = palabrasTransito(l.datos);
  const esAdmin = estado.usuario.rol === 'admin';
  const suyo = l.usuario_id === estado.usuario.id;
  const volver = '<button class="btn" data-ir-lista>Volver</button>';
  const revisor = (permisoPaso) => permiso(permisoPaso) && (esAdmin || !suyo);
  const espera = (permisoPaso, texto) => `<span class="nota-mando">${
    permiso(permisoPaso) && suyo ? 'Lo llenaste tú: lo revisa otro Team Leader' : texto}</span>${volver}`;

  if (l.estado === 'cerrado') return volver;
  if (l.estado === 'borrador') {
    if (l.revision === 'por_autorizar') {
      return revisor('transito_autorizar')
        ? `${volver}<button class="btn" data-transito="regresar">Regresar para corregir</button>
           <button class="btn primario" data-transito="autorizar-salida">Autorizar ${p.paso}</button>`
        : espera('transito_autorizar', `Esperando autorización de ${p.paso}`);
    }
    return `${volver}
      ${permiso('llenar') ? `<button class="btn primario" data-transito="enviar-salida">Enviar a autorización de ${p.paso}</button>` : ''}
      ${esAdmin ? `<button class="btn" data-transito="autorizar-salida">Autorizar ${p.paso} directo</button>` : ''}`;
  }
  if (l.revision === 'por_aprobar') {
    return revisor('transito_aprobar_cierre')
      ? `${volver}<button class="btn" data-transito="regresar">Regresar para corregir</button>
         <button class="btn primario" data-transito="cerrar">Aprobar cierre</button>`
      : espera('transito_aprobar_cierre', 'Esperando aprobación de cierre');
  }
  return `${volver}
    ${permiso('llenar') ? '<button class="btn primario" data-transito="enviar-cierre">Enviar a aprobación de cierre</button>' : ''}
    ${esAdmin ? '<button class="btn" data-transito="cerrar">Aprobar cierre directo</button>' : ''}`;
}

function conectarAccionesTransito(l) {
  const p = palabrasTransito(l.datos);
  const exito = {
    'enviar-salida': `Enviado a autorización de ${p.paso}. Al Team Leader le llega en Notificaciones.`,
    'autorizar-salida': `${p.Paso} autorizada. A Tránsito le llega el aviso para completar el cierre.`,
    'enviar-cierre': 'Enviado a aprobación de cierre. Al Team Leader le llega en Notificaciones.',
    cerrar: 'Cierre aprobado: ya está en Reportes.',
    regresar: 'Regresado con tu nota. A Tránsito le llega el aviso para corregirlo.',
  };
  vista.querySelectorAll('[data-transito]').forEach((b) => b.addEventListener('click', async () => {
    const accion = b.dataset.transito;
    let cuerpo = {};
    if (accion === 'regresar') {
      const nota = prompt('¿Qué hay que corregir? Lo va a leer quien lo llenó.');
      if (!nota || !nota.trim()) return;
      cuerpo = { nota: nota.trim() };
    }
    await descargarPendientes();
    b.disabled = true;
    try {
      await api('POST', `/api/llenados/${l.id}/${accion === 'regresar' ? 'regresar-transito' : accion}`, cuerpo);
      mostrarMensaje(exito[accion], 'exito');
      setTimeout(() => { location.hash = listaDeRegreso(); }, 1100);
    } catch (err) {
      mostrarMensaje(err.message, 'error');
      b.disabled = false;
    }
  }));
}


// --- captura tipo 'items': un renglón por ítem, dos botones grandes ---

// Cuándo se carga un documento, con las palabras del envío o de la colecta abierta.
function momentoDe(clave) {
  const p = palabrasTransito(estado.llenado && estado.llenado.datos);
  return { antes: { etiqueta: p.antes, clase: 'ambar' }, despues: { etiqueta: p.despues, clase: 'azul' } }[clave];
}

// Un ítem de documento no se contesta, se adjunta: en vez de Bien/Problema
// muestra sus archivos y el botón para cargar.
function pintarDocumento(item, soloLectura) {
  const archivos = fotosDe(item.id, '-');
  const momento = momentoDe(item.meta.momento);
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

function selloSeccion(situacion) {
  const p = palabrasTransito(estado.llenado && estado.llenado.datos);
  return {
    registrada: `<span class="etiqueta verde">${p.registrada}</span>`,
    despues: `<span class="etiqueta azul">${p.seCompleta}</span>`,
    en_revision: '<span class="etiqueta ambar">En revisión</span>',
  }[situacion] || '';
}

// Misma cuenta que hace el servidor, para que el operador vea el resultado en
// cuanto captura la fecha y no tenga que esperar a un reporte.
function describirVigencia(fechaISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaISO || ''))) return { estado: 'sin_dato', texto: 'Sin capturar' };
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const hoy = new Date();
  const dias = Math.round(
    (Date.UTC(anio, mes - 1, dia) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000
  );
  if (dias < 0) return { estado: 'vencida', dias, texto: `Vencida hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}` };
  if (dias === 0) return { estado: 'vence_hoy', dias, texto: 'Vence hoy' };
  if (dias <= 30) return { estado: 'por_vencer', dias, texto: `Le quedan ${dias} día${dias === 1 ? '' : 's'}` };
  return { estado: 'vigente', dias, texto: `Le quedan ${dias} días` };
}

const CLASE_VIGENCIA = {
  vencida: 'roja', vence_hoy: 'roja', por_vencer: 'ambar', vigente: 'verde', sin_dato: '',
};

// Ítem de fecha: en vez de Bien/Problema se captura una fecha, y al lado se
// muestra cuánto le queda de vigencia.
function pintarFecha(item, congelada) {
  const r = estado.respuestas.get(llave(item.id, '-')) || {};
  const v = describirVigencia(r.valor);
  return `
    <div class="item fecha ${v.estado}" data-item="${item.id}">
      <span class="texto">
        <b>${esc(item.texto)}</b>
        ${item.meta.ayuda ? `<small>${esc(item.meta.ayuda)}</small>` : ''}
      </span>
      <span class="captura-fecha">
        <label>${esc(item.meta.etiqueta || 'Vence el')}</label>
        <input type="date" data-fecha value="${esc(r.valor || '')}" ${congelada ? 'disabled' : ''}>
      </span>
      <span class="estado-vigencia etiqueta ${CLASE_VIGENCIA[v.estado]}">${v.texto}</span>
    </div>`;
}

// El dinero que trae la unidad: el monto y, siempre, la foto del efectivo.
function pintarDinero(item, congelada) {
  const r = estado.respuestas.get(llave(item.id, '-')) || {};
  const tieneMonto = r.valor !== undefined && r.valor !== null && r.valor !== '';
  return `
    <div class="item dinero ${tieneMonto ? '' : 'pendiente'}" data-item="${item.id}">
      <span class="texto">
        <b>${esc(item.texto)}</b>
        ${item.meta.ayuda ? `<small>${esc(item.meta.ayuda)}</small>` : ''}
      </span>
      <span class="captura-dinero">
        <label>Monto en pesos</label>
        <span class="moneda"><span>$</span><input type="number" inputmode="decimal" min="0" step="0.01"
          data-dinero value="${esc(r.valor ?? '')}" ${congelada ? 'disabled' : ''}></span>
      </span>
      ${tiraFotos(item.id, '-', { obligatoria: true, soloLectura: congelada })}
    </div>`;
}

// El kilometraje del tablero, con su foto. Es el mismo trato que el dinero —un
// número que hay que poder comprobar—, y de aquí sale el rendimiento de la
// unidad en Logística.
function pintarMedidor(item, congelada) {
  const r = estado.respuestas.get(llave(item.id, '-')) || {};
  const tiene = r.valor !== undefined && r.valor !== null && r.valor !== '';
  const unidad = item.meta.unidad || 'km';
  return `
    <div class="item medidor ${tiene ? '' : 'pendiente'}" data-item="${item.id}">
      <span class="texto">
        <b>${esc(item.texto)}</b>
        ${item.meta.ayuda ? `<small>${esc(item.meta.ayuda)}</small>` : ''}
      </span>
      <span class="captura-medidor">
        <label>Lectura</label>
        <span class="lectura"><input type="number" inputmode="numeric" min="0" step="1"
          data-medidor value="${esc(r.valor ?? '')}" ${congelada ? 'disabled' : ''}><span>${esc(unidad)}</span></span>
      </span>
      ${tiraFotos(item.id, '-', { obligatoria: true, soloLectura: congelada })}
    </div>`;
}

// Lo que se escribe a mano —placas, chofer, proveedor— y la hora de arribo.
function pintarTextoLibre(item, congelada) {
  const r = estado.respuestas.get(llave(item.id, '-')) || {};
  const esHora = item.tipo_respuesta === 'hora';
  return `
    <div class="item libre ${r.valor ? '' : 'pendiente'}" data-item="${item.id}">
      <span class="texto">
        <b>${esc(item.texto)}</b>
        ${item.meta.ayuda ? `<small>${esc(item.meta.ayuda)}</small>` : ''}
      </span>
      <span class="captura-libre">
        <input type="${esHora ? 'time' : 'text'}" data-libre maxlength="120" autocomplete="off"
               value="${esc(r.valor || '')}" ${congelada ? 'disabled' : ''}
               ${esHora ? '' : 'placeholder="Escribe aquí"'} aria-label="${esc(item.texto)}">
      </span>
    </div>`;
}

// El nivel del tanque, como lo pide el formato en papel: cuatro posiciones,
// las mismas que trae la aguja. Un número de litros sería más preciso y más
// falso: nadie mide litros mirando el tablero.
const NIVELES_TANQUE = [['1/4', '¼'], ['1/2', '½'], ['3/4', '¾'], ['lleno', 'Lleno']];

function pintarNivel(item, congelada) {
  const r = estado.respuestas.get(llave(item.id, '-')) || {};
  return `
    <div class="item" data-item="${item.id}">
      <span class="texto">${esc(item.texto)}</span>
      <span class="opciones niveles">
        ${NIVELES_TANQUE.map(([valor, texto]) => `
          <button class="opcion nivel" data-valor="${valor}"
                  aria-pressed="${r.valor === valor}" ${congelada ? 'disabled' : ''}>${texto}</button>`).join('')}
      </span>
    </div>`;
}

function pintarItems(plantilla, soloLectura, estadoSeccion = () => 'activa') {
  return plantilla.secciones.map((seccion) => {
    const situacion = soloLectura ? 'cerrada' : estadoSeccion(seccion);
    const congelada = situacion !== 'activa';
    return `
    <section class="panel ${congelada && !soloLectura ? 'congelada' : ''}">
      <h2>${esc(seccion.titulo)} ${selloSeccion(situacion)}</h2>
      ${seccion.items.map((item) => {
        if (item.tipo_respuesta === 'documento') return pintarDocumento(item, congelada);
        if (item.tipo_respuesta === 'fecha') return pintarFecha(item, congelada);
        if (item.tipo_respuesta === 'dinero') return pintarDinero(item, congelada);
        if (item.tipo_respuesta === 'medidor') return pintarMedidor(item, congelada);
        if (item.tipo_respuesta === 'nivel') return pintarNivel(item, congelada);
        if (item.tipo_respuesta === 'texto' || item.tipo_respuesta === 'hora') return pintarTextoLibre(item, congelada);
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
  // Calidad reusa las clases de estilo de la captura de checklists pero tiene su
  // propia lógica y sus propias rutas. Sin esta frontera, un toque en un lote
  // mandaría además una respuesta al checklist que estuviera abierto.
  const enCalidad = (e) => !!e.target.closest('.captura-calidad');

  vista.addEventListener('click', (e) => {
    if (enCalidad(e)) return;
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
      if (obs) {
        obs.hidden = !esProblema;
        obs.classList.toggle('requerida', esProblema && !obs.value.trim());
        if (esProblema) obs.focus();
      }

      // La tira de evidencia aparece junto con el problema. Solo es obligatoria
      // en ítems de condición física (los que ofrecen "Problema"); en los de
      // tarea ("Sí/No") un No es un pendiente, no algo que se pueda fotografiar.
      const tira = fila.querySelector('.evidencia');
      if (tira && fila.querySelector('.opcion.mala')) {
        const esCondicion = fila.querySelector('.opcion.mala').dataset.valor === 'problema';
        refrescarTira(tira, {
          obligatoria: esProblema && esCondicion && !!estado.plantilla.foto_obligatoria,
          oculta: !esProblema,
        });
      }

      marcar(itemId, '-', { valor: nuevoValor });
      return;
    }

    const reintentar = e.target.closest('[data-reintentar-subida]');
    if (reintentar) {
      reintentar.disabled = true;
      reintentar.textContent = 'Subiendo…';
      reintentarFotosPendientes().then((subio) => {
        if (!subio) mostrarMensaje('Sigue sin haber señal. Las fotos esperan guardadas; no se pierden.', 'error');
        vista.querySelectorAll('.evidencia').forEach((c) => refrescarTira(c));
      });
      return;
    }

    const quitarPendiente = e.target.closest('[data-quitar-pendiente]');
    if (quitarPendiente) {
      const caja = quitarPendiente.closest('.evidencia');
      const itemId = caja.dataset.item ? Number(caja.dataset.item) : null;
      const lista = porSubirDe(itemId, caja.dataset.columna);
      const cual = lista[Number(quitarPendiente.dataset.quitarPendiente)];
      if (cual && confirm('¿Descartar esa foto? Todavía no se ha subido: se pierde.')) {
        quitarPorSubir(itemId, caja.dataset.columna, cual);
        refrescarTira(caja);
      }
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
    if (enCalidad(e)) return;
    const obs = e.target.closest('.item .obs');
    if (obs) {
      const fila = obs.closest('.item');
      obs.classList.toggle('requerida', fila.classList.contains('marcado-problema') && !obs.value.trim());
      marcar(Number(fila.dataset.item), '-', { observacion: obs.value });
      return;
    }

    const campoFecha = e.target.closest('.item.fecha [data-fecha]');
    if (campoFecha) {
      const fila = campoFecha.closest('.item');
      const v = describirVigencia(campoFecha.value);
      fila.className = `item fecha ${v.estado}`;
      const etiqueta = fila.querySelector('.estado-vigencia');
      etiqueta.textContent = v.texto;
      etiqueta.className = `estado-vigencia etiqueta ${CLASE_VIGENCIA[v.estado]}`;
      marcar(Number(fila.dataset.item), '-', { valor: campoFecha.value || null });
      return;
    }

    const campoLibre = e.target.closest('.item.libre [data-libre]');
    if (campoLibre) {
      const fila = campoLibre.closest('.item');
      const valor = campoLibre.value.trim() === '' ? null : campoLibre.value;
      fila.classList.toggle('pendiente', valor === null);
      marcar(Number(fila.dataset.item), '-', { valor });
      return;
    }

    const campoDinero = e.target.closest('.item.dinero [data-dinero]');
    if (campoDinero) {
      const fila = campoDinero.closest('.item');
      const valor = campoDinero.value === '' ? null : campoDinero.value;
      fila.classList.toggle('pendiente', valor === null);
      if (valor !== null) limpiarMarcaFalta(fila);
      marcar(Number(fila.dataset.item), '-', { valor });
      return;
    }

    const campoMedidor = e.target.closest('.item.medidor [data-medidor]');
    if (campoMedidor) {
      const fila = campoMedidor.closest('.item');
      const valor = campoMedidor.value === '' ? null : campoMedidor.value;
      fila.classList.toggle('pendiente', valor === null);
      if (valor !== null) limpiarMarcaFalta(fila);
      marcar(Number(fila.dataset.item), '-', { valor });
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

// Contestar una pregunta señalada le quita la marca: así se ve avanzar.
function limpiarMarcaFalta(fila) {
  if (!fila) return;
  fila.classList.remove('falta');
  faltantesDelCierre = faltantesDelCierre.filter((f) => f.item_id !== Number(fila.dataset.item));
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
  const fechasVencidas = todos.filter((i) => {
    if (i.tipo_respuesta !== 'fecha') return false;
    const r = estado.respuestas.get(llave(i.id, '-')) || {};
    return describirVigencia(r.valor).estado === 'vencida';
  }).length;
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
  if (fechasVencidas) {
    partes.push(`<b style="color:var(--alerta)">${fechasVencidas} vigencia${fechasVencidas > 1 ? 's' : ''} vencida${fechasVencidas > 1 ? 's' : ''}</b>`);
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
    const resultado = await api('POST', `/api/llenados/${estado.llenado.id}/cerrar`);
    mostrarMensaje(resultado.revision === 'por_aprobar'
      ? 'Checklist enviado. Un Team Leader lo revisa y lo aprueba.'
      : 'Checklist cerrado y aprobado.', 'exito');
    setTimeout(() => { location.hash = listaDeRegreso(); }, 900);
  } catch (err) {
    const faltantes = (err.datos && err.datos.faltantes) || [];
    if (faltantes.length) señalarFaltantes(faltantes);
    else mostrarMensaje(err.message, 'error');
    boton.disabled = false;
  }
}

// Lo que falta, señalado donde está. Antes el error era un párrafo largo arriba
// de la pantalla y había que ir a buscar la pregunta entre sesenta renglones;
// ahora se marcan todas, se cuenta cuántas son y el botón lleva a la siguiente.
let faltantesDelCierre = [];

function señalarFaltantes(faltantes) {
  faltantesDelCierre = faltantes;
  vista.querySelectorAll('.item.falta, tr.falta').forEach((n) => n.classList.remove('falta'));
  for (const f of faltantes) {
    const fila = vista.querySelector(`.item[data-item="${f.item_id}"], tr[data-item="${f.item_id}"]`);
    if (fila) fila.classList.add('falta');
  }
  const zona = document.getElementById('mensajes');
  if (zona) {
    zona.innerHTML = `
      <div class="aviso error">
        <b>Falta contestar ${faltantes.length} ${faltantes.length === 1 ? 'pregunta' : 'preguntas'}.</b>
        El checklist no se cierra a medias.
        <button class="btn" id="ir-a-faltante">Ir a la primera</button>
      </div>`;
    const boton = document.getElementById('ir-a-faltante');
    if (boton) boton.addEventListener('click', () => irAFaltante());
  }
  irAFaltante();
}

let indiceFaltante = 0;

function irAFaltante() {
  if (!faltantesDelCierre.length) return;
  const f = faltantesDelCierre[indiceFaltante % faltantesDelCierre.length];
  indiceFaltante += 1;
  const fila = vista.querySelector(`.item[data-item="${f.item_id}"], tr[data-item="${f.item_id}"]`);
  if (!fila) return;
  // Si la pregunta está en una sección cerrada, se abre antes de ir a ella.
  const detalle = fila.closest('details');
  if (detalle) detalle.open = true;
  fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  fila.classList.add('falta-ahora');
  setTimeout(() => fila.classList.remove('falta-ahora'), 1800);
  const campo = fila.querySelector('textarea, input, button.opcion');
  if (campo && !campo.disabled) campo.focus({ preventScroll: true });
  const boton = document.getElementById('ir-a-faltante');
  if (boton && faltantesDelCierre.length > 1) {
    boton.textContent = `Ir a la siguiente (${(indiceFaltante % faltantesDelCierre.length) + 1} de ${faltantesDelCierre.length})`;
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

  // En los checklists por etapas —Tránsito— la firma del operador es requisito
  // para mandarlo a autorizar, así que la pantalla lo dice desde antes en vez
  // de dejar que lo reclame el envío.
  const antesDeAutorizar = !!plantilla.por_etapas && llenado.estado === 'borrador'
    && llenado.revision !== 'por_autorizar';

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
        <h2>${etiqueta}${antesDeAutorizar && rol === 'operador'
    ? ' <span class="etiqueta ambar">Falta para mandarlo a autorizar</span>' : ''}</h2>
        ${antesDeAutorizar && rol === 'operador' ? `
          <p class="explica">
            Firma aquí con el dedo antes de mandarlo a autorización: lo que el Team Leader
            autoriza es lo que tú declaras haber revisado.
          </p>` : ''}
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
        // Calidad firma sus recepciones con el mismo lienzo; lo único que
        // cambia es a dónde se manda, y eso viaja en el propio recuadro.
        await api('POST', caja.dataset.url || `/api/llenados/${estado.llenado.id}/firma`, {
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

// ============================================================ vista: reportes

// El módulo de Reportes no calcula nada: reúne. Cada renglón lo define el
// servidor en REPORTES, y aquí solo se decide con qué ícono se ve.
const ICONO_REPORTE = {
  checklists: 'checklist',
  comparativa: 'grafica',
  calidad: 'calidad',
  produccion: 'produccion',
  almacen: 'cajas',
  ventas_fuera: 'camion',
  incidencias: 'alerta',
  transito: 'transito',
};

// Dos maneras de mirar la misma operación, y conviene no mezclarlas: una dice
// cómo está hoy, la otra si vamos mejorando.
const GRUPO_PERIODO = {
  hoy: ['Cómo va la operación',
    'Una foto de ahora mismo: lo que está por vencer, lo detectado y lo capturado.'],
  tiempo: ['A lo largo del tiempo',
    'Varias semanas juntas, para ver hacia dónde va y no solo el dato de hoy.'],
};

async function vistaIndiceReportes() {
  encabezado('Reportes', 'Todos los módulos, en un solo lugar');
  const reportes = await api('GET', '/api/reportes/indice');

  const seccion = (periodo) => {
    const lista = reportes.filter((r) => r.periodo === periodo);
    if (!lista.length) return '';
    const [titulo, ayuda] = GRUPO_PERIODO[periodo];
    return `
      <section class="panel">
        <h2>${titulo}</h2>
        <p class="explica">${ayuda}</p>
        <div class="rejilla-modulos" style="padding:0 18px 18px">
          ${lista.map((r) => `
            <button class="modulo ${r.disponible ? '' : 'proximamente'}"
                    data-reporte="${esc(r.destino || '')}" ${r.disponible ? '' : 'disabled'}>
              ${r.disponible ? '' : '<span class="marca-esquina">Próximamente</span>'}
              <span class="simbolo">${simbolo(ICONO_REPORTE[r.clave] || 'grafica')}</span>
              <b>${esc(r.nombre)}</b>
              <span>${esc(r.descripcion)}</span>
            </button>`).join('')}
        </div>
      </section>`;
  };

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span><span>Reportes</span>
    </div>
    ${reportes.length
      ? seccion('hoy') + seccion('tiempo')
      : `<div class="panel"><div class="vacio">
          Entras al módulo, pero todavía no tienes ningún reporte otorgado.<br>
          Cada reporte se da por separado, en Configuración → Permisos → Reportes.
        </div></div>`}`;

  vista.querySelectorAll('[data-reporte]').forEach((b) => {
    b.addEventListener('click', () => { if (b.dataset.reporte) location.hash = b.dataset.reporte; });
  });
}

// Los filtros del reporte de checklists. Viven en `estado` y no en la dirección
// para que volver de un detalle no los pierda.
estado.filtroReporte = estado.filtroReporte || { desde: '', hasta: '', unidad: '', plantilla: '', problemas: false };

function consultaDeFiltros() {
  const f = estado.filtroReporte;
  const partes = [];
  if (f.desde) partes.push(`desde=${f.desde}`);
  if (f.hasta) partes.push(`hasta=${f.hasta}`);
  if (f.unidad) partes.push(`unidad=${f.unidad}`);
  if (f.plantilla) partes.push(`plantilla=${f.plantilla}`);
  if (f.problemas) partes.push('problemas=1');
  return partes.length ? `?${partes.join('&')}` : '';
}

async function vistaReportes() {
  encabezado('Reportes de Checklists', 'Vigencias, problemas e historial');
  const q = consultaDeFiltros();
  const [problemas, historial, vigencias, dinero, filtros] = await Promise.all([
    api('GET', `/api/reportes/problemas${q}`),
    api('GET', `/api/reportes/historial${q}`),
    api('GET', '/api/reportes/vigencias'),
    api('GET', '/api/reportes/dinero'),
    api('GET', '/api/reportes/filtros'),
  ]);

  const porVencer = vigencias.filter((v) => ['vencida', 'vence_hoy', 'por_vencer'].includes(v.estado)).length;
  const f = estado.filtroReporte;
  const hayFiltro = !!(f.desde || f.hasta || f.unidad || f.plantilla || f.problemas);

  vista.innerHTML = `
    ${migajaReportes('Checklists')}

    <div class="filtros">
      <label>Llenados del <input type="date" id="fr-desde" value="${esc(f.desde)}"></label>
      <label>al <input type="date" id="fr-hasta" value="${esc(f.hasta)}"></label>
      <label>Unidad
        <select id="fr-unidad">
          <option value="">Todas</option>
          ${filtros.unidades.map((u) => `
            <option value="${u.id}" ${String(u.id) === String(f.unidad) ? 'selected' : ''}>${esc(u.nombre)} (${u.llenados})</option>`).join('')}
        </select>
      </label>
      <label>Checklist
        <select id="fr-plantilla">
          <option value="">Todos</option>
          ${filtros.plantillas.map((p) => `
            <option value="${p.id}" ${String(p.id) === String(f.plantilla) ? 'selected' : ''}>${esc(p.nombre)} (${p.llenados})</option>`).join('')}
        </select>
      </label>
      <label class="casilla-texto" style="margin:0">
        <input type="checkbox" id="fr-problemas" ${f.problemas ? 'checked' : ''}> Solo con problemas
      </label>
      <button class="btn" id="fr-aplicar">Ver</button>
      ${hayFiltro ? '<button class="btn" id="fr-limpiar">Quitar filtros</button>' : ''}
    </div>
    ${hayFiltro ? `
      <p class="explica" style="padding:0 0 8px">
        Con filtro: ${historial.length} checklist(s) y ${problemas.length} problema(s).
        Las vigencias y el dinero se muestran completos: son el último dato de cada unidad.
      </p>` : ''}
    ${vigencias.length ? `
    <div class="panel">
      <h2>Vigencias ${porVencer ? `<span class="etiqueta roja">${porVencer} por atender</span>` : '<span class="etiqueta verde">al corriente</span>'}</h2>
      <p class="explica">
        Última fecha capturada de cada unidad. Se ordena por urgencia: primero lo
        vencido, luego lo que está por vencer.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Concepto</th><th>Unidad</th><th>Vence</th>
          <th>Situación</th><th>Días</th><th>Última captura</th>
        </tr></thead>
        <tbody>${vigencias.map((v) => `
          <tr class="${v.estado === 'vencida' ? 'vigencia-vencida' : ''}">
            <td class="fila-titulo">${esc(v.concepto)}</td>
            <td>${esc(v.unidad)}</td>
            <td>${v.fecha ? esc(v.fecha) : '—'}</td>
            <td><span class="etiqueta ${CLASE_VIGENCIA[v.estado]}">${esc(v.texto)}</span></td>
            <td>${v.dias === null ? '—' : v.dias}</td>
            <td>${v.capturo ? `${esc(v.capturo)}<br><small style="color:var(--tinta-suave)">${esc(v.capturado_en || '')}</small>` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : ''}

    ${dinero.length ? `
    <div class="panel">
      <h2>Dinero en las unidades</h2>
      <p class="explica">Lo que traía cada unidad al llenarse el checklist, con la foto del efectivo. Solo checklists aprobados.</p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Unidad</th><th>Periodo</th><th>Monto</th><th>Capturó</th><th>Foto</th></tr></thead>
        <tbody>${dinero.map((m) => `
          <tr>
            <td class="fila-titulo">${esc(m.unidad)}</td>
            <td>${esc(m.periodo)}</td>
            <td><b>${Number(m.monto).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</b></td>
            <td>${esc(m.capturo)}</td>
            <td><div class="miniaturas">${(m.fotos ? m.fotos.split('|') : [])
              .map((a) => `<figure class="mini"><img data-archivo="${esc(a)}" alt="Efectivo"></figure>`).join('')
              || '<span class="nota-foto">—</span>'}</div></td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

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
            <td><span class="etiqueta ${(ETIQUETA_REVISION[h.revision] || ['ambar'])[0]}">${esc((ETIQUETA_REVISION[h.revision] || ['', 'Borrador'])[1])}</span>${
              h.modificaciones ? `<br><small title="${esc(h.ultima_modificacion || '')}">${h.modificaciones} modificación(es) pedida(s)</small>` : ''}</td>
            <td>${h.problemas ? `<span class="etiqueta roja">${h.problemas}</span>` : '—'}</td>
            <td><button class="btn" data-ver="${esc(h.plantilla_clave)}" data-id="${h.id}">Ver</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="fila-botones">
      <a class="btn" id="descargar" href="#">Descargar todo en Excel (CSV)</a>
    </div>`;

  document.getElementById('descargar').addEventListener('click', (e) => {
    e.preventDefault();
    descargarCSV('/api/exportar.csv', `checklists-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  const aplicar = document.getElementById('fr-aplicar');
  if (aplicar) {
    aplicar.addEventListener('click', () => {
      estado.filtroReporte = {
        desde: document.getElementById('fr-desde').value,
        hasta: document.getElementById('fr-hasta').value,
        unidad: document.getElementById('fr-unidad').value,
        plantilla: document.getElementById('fr-plantilla').value,
        problemas: document.getElementById('fr-problemas').checked,
      };
      vistaReportes();
    });
  }
  const limpiar = document.getElementById('fr-limpiar');
  if (limpiar) {
    limpiar.addEventListener('click', () => {
      estado.filtroReporte = { desde: '', hasta: '', unidad: '', plantilla: '', problemas: false };
      vistaReportes();
    });
  }

  vista.querySelectorAll('[data-ver]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/detalle/${b.dataset.id}`; });
  });
  cargarImagenesPendientes();
}

// Revisar un checklist enviado. Se llega desde Notificaciones, donde al Team
// Leader le aparece lo que espera su aprobación. Se ve igual que en Reportes, con
// dos salidas: aprobarlo, o pedir modificación diciendo qué hay que corregir.
async function vistaRevisarChecklist(id) {
  const d = await api('GET', `/api/llenados/${id}/revision`);
  estado.plantilla = d.plantilla;
  estado.llenado = d;
  estado.respuestas = new Map(
    d.respuestas.map((r) => [llave(r.item_id, r.columna), { valor: r.valor, observacion: r.observacion }])
  );
  indexarFotos(d.fotos);
  encabezado(`Revisar · ${d.plantilla_nombre}${d.unidad ? ` · ${d.unidad}` : ''}`, `${d.periodo} · Lo llenó ${d.elaboro}`);

  const cuerpo = d.plantilla
    ? { items: pintarItems, matriz: pintarMatriz, grid_semanal: pintarGrid }[d.tipo_captura](d.plantilla, true)
    : '<div class="panel"><div class="vacio">Este checklist ya no está en uso.</div></div>';
  const [color, texto] = ETIQUETA_REVISION[d.revision] || ['', d.revision || ''];

  vista.innerHTML = `
    <div class="migaja"><button data-ir-hash="#/notificaciones">← Notificaciones</button></div>
    <div id="mensajes"></div>
    <div class="aviso ${d.puede_resolver ? 'info' : ''}" style="cursor:default">
      <span><b>${esc(d.plantilla_nombre)}${d.unidad ? ` · ${esc(d.unidad)}` : ''}</b>
        <span class="etiqueta ${color}">${esc(texto)}</span>
        <small>Lo llenó ${esc(d.elaboro)}.${d.revision === 'aprobado' ? ' Ya está en Reportes.'
          : d.revision === 'modificacion' ? ' Está en corrección con quien lo llenó.'
            : ' Hasta que se apruebe, no entra a Reportes.'}</small></span>
    </div>
    ${cuerpo}
    ${d.notas ? `<div class="panel"><h2>${etiquetaNotas(d.plantilla)}</h2><div style="padding:16px">${esc(d.notas)}</div></div>` : ''}
    ${d.plantilla ? pintarFirmas(d.plantilla, d, true) : ''}
    ${pintarRevisiones(d.revisiones)}
    ${d.puede_resolver ? `
      <section class="panel">
        <h2>Tu decisión</h2>
        <div style="padding:0 18px 18px">
          <textarea class="obs" id="nota-revision" rows="3"
            placeholder="Si pides modificación, escribe qué hay que corregir. Si lo apruebas, la nota es opcional."></textarea>
          <div class="fila-botones" style="margin-top:12px">
            <button class="btn primario grande" id="aprobar-checklist">Aprobar</button>
            <button class="btn peligro" id="pedir-modificacion">Pedir modificación</button>
          </div>
        </div>
      </section>` : ''}`;
  cargarImagenesPendientes();

  const nota = () => (document.getElementById('nota-revision') || {}).value || '';
  const accion = async (boton, ruta, cuerpoPeticion, exito) => {
    boton.disabled = true;
    try {
      await api('POST', `/api/llenados/${id}/${ruta}`, cuerpoPeticion);
      mostrarMensaje(exito, 'exito');
      setTimeout(() => { location.hash = '#/notificaciones'; }, 1000);
    } catch (err) { mostrarMensaje(err.message, 'error'); boton.disabled = false; }
  };
  const aprobar = document.getElementById('aprobar-checklist');
  if (aprobar) {
    aprobar.addEventListener('click', () => accion(aprobar, 'aprobar', { nota: nota() }, 'Checklist aprobado. Ya entra a Reportes.'));
  }
  const modificar = document.getElementById('pedir-modificacion');
  if (modificar) {
    modificar.addEventListener('click', () => {
      if (nota().trim().length < 5) return mostrarMensaje('Escribe qué hay que corregir antes de pedir la modificación.', 'error');
      return accion(modificar, 'modificacion', { nota: nota() }, 'Modificación pedida. Se le regresó a quien lo llenó.');
    });
  }
}

async function vistaDetalle(id, volverA = '#/reportes/checklists') {
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
    ${d.notas ? `<div class="panel"><h2>${etiquetaNotas(d.plantilla)}</h2><div style="padding:16px">${esc(d.notas)}</div></div>` : ''}
    ${pintarRevisiones(d.revisiones)}
    ${pintarFirmas(d.plantilla, d, true)}
    <div class="pie"><span class="resumen"></span><button class="btn" id="volver">Volver a reportes</button></div>`;
  document.getElementById('volver').addEventListener('click', () => { location.hash = volverA; });
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
    vista.innerHTML = `
      ${migajaReportes('Comparativa entre semanas')}
      <div class="panel"><div class="vacio">
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
    ${migajaReportes('Comparativa entre semanas')}
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
// Limpieza: tirar lo que se capturó para probar, mientras el sistema se
// construye. No es una papelera de la operación —no hay «deshacer»— así que
// cada borrado se confirma en dos toques y se dice antes qué se lleva consigo.
async function configLimpieza(destino) {
  const { grupos, inventario, anios_resguardo: anios } = await api('GET', '/api/config/limpieza');
  const total = grupos.filter((g) => !g.peligroso).reduce((s, g) => s + g.cuantos, 0);
  // Los grupos vacíos no merecen un panel cada uno: se nombran en un renglón al
  // final. Veinte paneles que dicen «nada capturado» esconden los tres que sí
  // tienen algo.
  const conAlgo = grupos.filter((g) => g.cuantos);
  const vacios = grupos.filter((g) => !g.cuantos);

  destino.innerHTML = `
    <p class="explica" style="padding-left:0">
      Aquí se tira lo que se capturó <b>para probar</b>. Lo ya cerrado está
      <b>resguardado ${anios || 6} años</b> y no se puede borrar. <b>Esto no se deshace.</b>
    </p>
    <details class="plegable" style="margin-left:0">
      <summary>Qué se borra, qué no, y qué pasa con el inventario</summary>
      <div class="explica" style="padding-left:0">
        <ul class="lista-breve">
          <li><b>Se borran documentos:</b> checklists, recepciones, entradas, salidas,
            traspasos, devoluciones, conteos y ODT.</li>
          <li><b>No se toca la configuración:</b> personas, permisos, unidades,
            plantillas, materiales, productos ni bodegas.</li>
          <li><b>El inventario se corrige solo:</b> borrar un documento borra sus
            movimientos, y la existencia es la suma de los movimientos. No hay que
            capturar ningún ajuste que compense.</li>
          <li><b>Lo cerrado está resguardado ${anios || 6} años</b> para auditorías: lo que
            movió inventario, un checklist cerrado, una recepción aprobada, una venta
            terminada. En una copia de pruebas sí se borra: ahí nada es real.
            Lo guardado y el paquete del auditor están en <b>Configuración → Resguardo</b>.</li>
          <li>Si quieres una red antes de tirar algo, corre <code>node respaldar.js</code>.</li>
        </ul>
      </div>
    </details>

    <div class="cifras-almacen">
      <div class="cifra"><b>${total}</b><span>documento(s) de prueba</span></div>
      <div class="cifra"><b>${numero(inventario)}</b><span>unidades en existencia</span></div>
    </div>

    ${conAlgo.map((g) => `
      <section class="panel ${g.peligroso ? 'peligroso' : ''}">
        <h2>${esc(g.etiqueta)}
          <span class="etiqueta ${g.cuantos ? (g.peligroso ? 'roja' : 'azul') : ''}">${g.cuantos}</span>
          <span class="etiqueta">${esc(g.modulo)}</span>
        </h2>
        <p class="explica">${esc(g.ayuda)}${g.resguardados
          ? ` <b>${g.resguardados} de ${g.cuantos} están resguardados</b> para auditorías y no se pueden borrar.` : ''}</p>
        ${g.cuantos ? `
          <div class="desliza"><table class="captura">
            <thead><tr><th class="fila-titulo">Qué es</th><th>Detalle</th><th>Cuándo</th><th></th></tr></thead>
            <tbody>${g.filas.map((f) => `
              <tr>
                <td class="fila-titulo">${esc(f.titulo)}</td>
                <td><small>${esc(f.detalle || '—')}</small></td>
                <td><small>${esc((f.cuando || '').slice(0, 10))}</small></td>
                <td>${f.impedimento
                  ? `<small style="color:var(--tinta-suave)">${esc(f.impedimento)}</small>`
                  : `<button class="btn" data-borrar="${g.clave}" data-id="${f.id}"
                       data-que="${esc(f.titulo)}">Borrar</button>`}</td>
              </tr>`).join('')}
            </tbody></table></div>
          <div class="fila-botones" style="padding:14px 18px 18px">
            <button class="btn ${g.peligroso ? 'peligro' : ''}" data-borrar-todo="${g.clave}"
                    data-que="${esc(g.etiqueta.toLowerCase())}">
              Borrar ${g.peligroso ? 'la carga inicial' : `los ${g.cuantos}`}
            </button>
          </div>`
          : '<div class="vacio">Nada capturado.</div>'}
      </section>`).join('')}

    ${vacios.length ? `
      <section class="panel">
        <h2>Sin nada que borrar <span class="etiqueta">${vacios.length} grupo(s)</span></h2>
        <p class="explica">
          Estos no tienen ningún documento capturado, así que no se enseñan completos:
          ${vacios.map((g) => esc(g.etiqueta)).join(' · ')}.
        </p>
      </section>` : ''}`;

  // Confirmar en dos toques, en el mismo botón. Un diálogo del navegador se
  // acepta por reflejo; que el botón cambie de texto y de color obliga a leer
  // qué se va a borrar antes del segundo toque.
  const confirmarYHacer = (boton, texto, accion) => {
    if (boton.dataset.armado !== 'si') {
      const original = boton.textContent;
      boton.dataset.armado = 'si';
      boton.classList.add('peligro');
      boton.textContent = texto;
      const cancelar = setTimeout(() => {
        boton.dataset.armado = '';
        boton.classList.remove('peligro');
        boton.textContent = original;
      }, 5000);
      boton.dataset.cancelar = String(cancelar);
      return;
    }
    clearTimeout(Number(boton.dataset.cancelar));
    boton.disabled = true;
    accion();
  };

  destino.querySelectorAll('[data-borrar]').forEach((b) => {
    b.addEventListener('click', () => confirmarYHacer(b, '¿Seguro? Toca otra vez', async () => {
      try {
        await api('DELETE', `/api/config/limpieza/${b.dataset.borrar}/${b.dataset.id}`);
        mostrarMensaje(`Se borró ${b.dataset.que}.`, 'exito');
        setTimeout(() => enrutar(), 700);
      } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; b.dataset.armado = ''; }
    }));
  });

  destino.querySelectorAll('[data-borrar-todo]').forEach((b) => {
    b.addEventListener('click', () => confirmarYHacer(b, `¿Borrar TODO ${b.dataset.que}? Toca otra vez`, async () => {
      try {
        const { borrados, quedaron } = await api(
          'POST', `/api/config/limpieza/${b.dataset.borrarTodo}/borrar-todo`);
        mostrarMensaje(
          `Se borraron ${borrados}.${quedaron.length
            ? ` Quedaron ${quedaron.length}: ${quedaron.map((q) => `${q.titulo} (${q.porque})`).join(' · ')}`
            : ''}`,
          quedaron.length ? 'aviso' : 'exito');
        setTimeout(() => enrutar(), quedaron.length ? 2500 : 700);
      } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; b.dataset.armado = ''; }
    }));
  });
}

const PESTANAS_CONFIG = [
  { clave: 'personas', etiqueta: 'Personas', pintar: configPersonas },
  { clave: 'puestos', etiqueta: 'Puestos', pintar: configPuestos },
  { clave: 'permisos', etiqueta: 'Permisos', pintar: configPermisos },
  { clave: 'unidades', etiqueta: 'Unidades', pintar: configUnidades },
  { clave: 'checklists', etiqueta: 'Checklists', pintar: configChecklists },
  { clave: 'transito', etiqueta: 'Tránsito', pintar: configTransito },
  { clave: 'materiales', etiqueta: 'Materiales', pintar: configMateriales },
  { clave: 'accesos', etiqueta: 'Claves y accesos', pintar: pintarAccesos },
  { clave: 'resguardo', etiqueta: 'Resguardo', pintar: pintarResguardo },
  { clave: 'pruebas', etiqueta: 'Modo de pruebas', pintar: (d) => pintarPruebas(d) },
  // Va al final y aparte: es la única pestaña que destruye en vez de configurar.
  { clave: 'limpieza', etiqueta: 'Limpieza', pintar: configLimpieza },
];

// Permisos en tres pasos: módulo → puesto → persona. Lo que trae un puesto es
// la base de todos los que lo ocupan; una persona puede tener ajustes encima
// (algo que se le dio o se le quitó a ella sola). Por eso el tercer paso empieza
// en «Todo el puesto»: se decide primero para el puesto y, si hace falta, luego
// para una persona en particular.
const MODULO_PERMISOS_ELEGIDO = 'config.permisos.modulo';
const PUESTO_PERMISOS_ELEGIDO = 'config.permisos.puesto';
const PERSONA_PERMISOS_ELEGIDA = 'config.permisos.persona';

async function configPermisos(destino) {
  const { usuarios, roles: puestos, catalogo_permisos: catalogo } = await api('GET', '/api/admin/catalogos');
  const activos = usuarios.filter((u) => u.activo);
  const vigentes = puestos.filter((x) => x.activo);

  // Lo elegido sobrevive al guardado: la pantalla se repinta entera y sin esto
  // habría que volver a escoger después de cada cambio.
  const grupo = catalogo.find((g) => g.modulo === sessionStorage.getItem(MODULO_PERMISOS_ELEGIDO)) || catalogo[0];
  sessionStorage.setItem(MODULO_PERMISOS_ELEGIDO, grupo.modulo);
  const puesto = vigentes.find((x) => x.clave === sessionStorage.getItem(PUESTO_PERMISOS_ELEGIDO))
    || vigentes.find((x) => !x.es_admin) || vigentes[0];
  sessionStorage.setItem(PUESTO_PERMISOS_ELEGIDO, puesto.clave);
  const delPuesto = activos.filter((u) => u.rol === puesto.clave);
  const persona = delPuesto.find((u) => String(u.id) === sessionStorage.getItem(PERSONA_PERMISOS_ELEGIDA)) || null;
  if (!persona) sessionStorage.removeItem(PERSONA_PERMISOS_ELEGIDA);

  const esAdmin = puesto.es_admin;
  // Un ajuste cuenta solo si difiere de lo que trae su puesto.
  const tieneAjustes = (u) => Object.entries(u.permisos_extra || {}).some(([k, v]) => !!puesto.permisos[k] !== !!v);
  const cuantosPuesto = (x) => grupo.permisos.filter((c) => x.es_admin || x.permisos[c.clave]).length;
  const cuantosPersona = (u) => grupo.permisos.filter((c) => u.rol === 'admin' || u.permisos[c.clave]).length;
  const total = grupo.permisos.length;

  // Un renglón por permiso. Si se está en «Todo el puesto», se enciende con lo
  // que trae el puesto; si se escogió a alguien, con lo que esa persona puede de
  // verdad y dice de dónde le viene.
  const renglon = (c) => {
    const delPuestoSi = esAdmin || !!puesto.permisos[c.clave];
    let efectivo = delPuestoSi;
    let nota = '';
    let ajustado = false;
    if (persona && !esAdmin) {
      efectivo = !!persona.permisos[c.clave];
      ajustado = Object.prototype.hasOwnProperty.call(persona.permisos_extra, c.clave)
        && persona.permisos_extra[c.clave] !== delPuestoSi;
      nota = ajustado
        ? (efectivo ? 'Se le dio a esta persona aparte de su puesto.' : 'Se le quitó a esta persona aunque su puesto lo trae.')
        : (delPuestoSi ? 'Viene con su puesto.' : '');
    }
    const bloqueado = esAdmin || !!c.solo_admin;
    return `
      <button class="renglon-permiso ${ajustado ? 'ajustado' : ''}" data-permiso="${esc(c.clave)}"
              aria-pressed="${efectivo}" ${bloqueado ? 'disabled' : ''}>
        <span class="casilla" aria-hidden="true">✓</span>
        <span class="texto">
          <b>${esc(c.etiqueta)}</b>
          <small>
            ${c.acceso ? 'Hace aparecer el módulo en el menú. ' : ''}
            ${c.comparte ? `Se comparte con ${esc(c.comparte)}: es el mismo interruptor. ` : ''}
            ${c.solo_admin ? 'Solo del Administrador. ' : ''}
            ${esAdmin ? 'Por el cargo de Administrador.' : nota}
          </small>
        </span>
      </button>`;
  };

  destino.innerHTML = `
    <div class="panel">
      <div class="pasos-permisos">
        <div class="campo">
          <label for="modulo-permisos">1 · Módulo</label>
          <select id="modulo-permisos">
            ${catalogo.map((g) => `
              <option value="${esc(g.modulo)}" ${g.modulo === grupo.modulo ? 'selected' : ''}>${esc(g.grupo)}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="puesto-permisos">2 · Puesto</label>
          <select id="puesto-permisos">
            ${vigentes.map((x) => `
              <option value="${esc(x.clave)}" ${x.clave === puesto.clave ? 'selected' : ''}>
                ${esc(x.etiqueta)} · ${x.personas} persona(s) · ${cuantosPuesto(x)} de ${total}
              </option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="persona-permisos">3 · Persona</label>
          <select id="persona-permisos" ${esAdmin || !delPuesto.length ? 'disabled' : ''}>
            <option value="">Todo el puesto</option>
            ${delPuesto.map((u) => `
              <option value="${u.id}" ${persona && u.id === persona.id ? 'selected' : ''}>
                ${esc(u.nombre)} · ${cuantosPersona(u)} de ${total}${tieneAjustes(u) ? ' · con ajustes' : ''}
              </option>`).join('')}
          </select>
        </div>
      </div>
      <p class="explica" style="padding-top:0">${esc(grupo.ayuda || '')}</p>
    </div>

    <div class="panel">
      <h2>${persona
        ? `Lo que ${esc(persona.nombre)} puede hacer en ${esc(grupo.grupo)}`
        : `Lo que trae el puesto ${esc(puesto.etiqueta)} en ${esc(grupo.grupo)}`}
        <span class="etiqueta azul">${persona ? cuantosPersona(persona) : cuantosPuesto(puesto)} de ${total}</span></h2>
      <p class="explica">
        ${esAdmin
          ? 'El Administrador puede todo por su cargo: aquí no hay nada que marcar ni que quitar.'
          : persona
            ? `Esto cambia <b>solo a ${esc(persona.nombre)}</b>. El fondo azul es un ajuste suyo respecto a su puesto.
               Nada se aplica hasta <b>Guardar cambios</b>.`
            : `Esto cambia a <b>todas las personas del puesto</b> (${delPuesto.length}). A quien se le haya dado o quitado
               algo aparte lo conserva. Nada se aplica hasta <b>Guardar cambios</b>.`}
      </p>
      <div class="lista-permisos">${grupo.permisos.map(renglon).join('')}</div>
      ${persona && tieneAjustes(persona) ? `
        <div class="pie">
          <span class="resumen">${esc(persona.nombre)} tiene ajustes guardados.</span>
          <button class="btn" data-restablecer>Dejarle solo lo de su puesto, en todos los módulos</button>
        </div>` : ''}
    </div>

    <div class="pie barra-guardar" id="barra-permisos" hidden>
      <span class="resumen"></span>
      <button class="btn" id="descartar-permisos">Descartar</button>
      <button class="btn primario" id="guardar-permisos">Guardar cambios</button>
    </div>`;

  const pendientesPermisos = new Map();
  const confirmarCambio = () => !pendientesPermisos.size
    || confirm('Hay cambios sin guardar. ¿Descartarlos?');

  const alCambiar = (id, llave, valorActual, limpiar) => {
    document.getElementById(id).addEventListener('change', (e) => {
      if (!confirmarCambio()) { e.target.value = valorActual; return; }
      if (e.target.value) sessionStorage.setItem(llave, e.target.value);
      else sessionStorage.removeItem(llave);
      if (limpiar) sessionStorage.removeItem(PERSONA_PERMISOS_ELEGIDA);
      recargarConfig();
    });
  };
  alCambiar('modulo-permisos', MODULO_PERMISOS_ELEGIDO, grupo.modulo);
  alCambiar('puesto-permisos', PUESTO_PERMISOS_ELEGIDO, puesto.clave, true);
  alCambiar('persona-permisos', PERSONA_PERMISOS_ELEGIDA, persona ? String(persona.id) : '');

  const refrescarBarra = () => {
    const barraG = document.getElementById('barra-permisos');
    const n = pendientesPermisos.size;
    barraG.hidden = n === 0;
    if (n) {
      barraG.querySelector('.resumen').textContent = `${n === 1 ? '1 cambio sin guardar' : `${n} cambios sin guardar`}`
        + (persona ? ` · solo ${persona.nombre}` : ` · todo el puesto ${puesto.etiqueta}`);
    }
  };

  // Los cambios NO se guardan al tocar: se acumulan y se aplican con el botón.
  destino.querySelectorAll('.renglon-permiso[data-permiso]:not([disabled])').forEach((b) => {
    b.addEventListener('click', () => {
      const clave = b.dataset.permiso;
      const nuevo = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(nuevo));
      const original = pendientesPermisos.get(clave);
      if (original && original.valorOriginal === nuevo) {
        pendientesPermisos.delete(clave);
        b.classList.remove('pendiente-guardar');
      } else {
        b.classList.add('pendiente-guardar');
        if (!original) pendientesPermisos.set(clave, { valor: nuevo, valorOriginal: !nuevo });
        else original.valor = nuevo;
      }
      refrescarBarra();
    });
  });

  const restablecer = destino.querySelector('[data-restablecer]');
  if (restablecer) {
    restablecer.addEventListener('click', async () => {
      if (!confirm(`¿Quitarle a ${persona.nombre} todos sus ajustes y dejarle solo lo que trae su puesto?`)) return;
      try {
        await api('PUT', `/api/admin/usuarios/${persona.id}`, { permisos_extra: {} });
        await recargarConfig();
        mostrarMensaje('Listo: ahora tiene exactamente lo de su puesto.', 'exito');
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }

  document.getElementById('guardar-permisos').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const cambios = [...pendientesPermisos.entries()].map(([clave, { valor }]) => ({ clave, valor }));

    // Cambiarse los permisos a uno mismo cierra la propia sesión. Sin avisar,
    // parecería que la plataforma se cayó justo al guardar.
    const meAfectaAMi = persona ? persona.id === estado.usuario.id : estado.usuario.rol === puesto.clave;
    if (meAfectaAMi && !confirm(
      'Estás cambiando tus propios permisos.\n\nAl guardarlos se cerrará tu sesión y tendrás que volver a entrar.\n\n¿Guardar de todos modos?'
    )) return;

    boton.disabled = true;
    try {
      if (meAfectaAMi) sessionStorage.setItem('avisoAlEntrar', 'Tus permisos cambiaron. Vuelve a entrar para que apliquen.');
      if (persona) {
        const r = await api('PUT', '/api/admin/permisos', {
          cambios: cambios.map((c) => ({ ...c, usuario_id: persona.id })),
        });
        pendientesPermisos.clear();
        await recargarConfig();
        mostrarMensaje(`Permisos de ${persona.nombre} guardados: ${r.guardados} cambio(s).`, 'exito');
      } else {
        const r = await api('PUT', `/api/admin/puestos/${puesto.clave}/permisos`, { cambios });
        pendientesPermisos.clear();
        await recargarConfig();
        mostrarMensaje(`Puesto ${puesto.etiqueta} guardado: ${r.guardados} cambio(s), aplica a ${r.personas} persona(s).`, 'exito');
      }
    } catch (err) {
      boton.disabled = false;
      mostrarMensaje(err.message, 'error');
    }
  });

  document.getElementById('descartar-permisos').addEventListener('click', async () => {
    pendientesPermisos.clear();
    await recargarConfig();
  });

  refrescarBarra();
}

// --- pestaña: puestos ---
//
// El organigrama va a cambiar conforme crezca la empresa: aquí se crean puestos
// nuevos, se renombran y se retiran. Lo que cada puesto puede hacer se decide en
// Permisos, módulo por módulo.
async function configPuestos(destino) {
  const { roles: puestos } = await api('GET', '/api/admin/catalogos');
  const vigentes = puestos.filter((x) => x.activo);
  const retirados = puestos.filter((x) => !x.activo);

  const tarjeta = (x) => `
    <div class="tarjeta-puesto ${x.activo ? '' : 'retirado'}">
      <div class="cabeza">
        <b>${esc(x.etiqueta)}</b>
        <span class="etiqueta ${x.personas ? 'azul' : ''}">${x.personas} persona(s)</span>
        ${x.activo ? '' : '<span class="etiqueta">Retirado</span>'}
      </div>
      <small>${esc(x.descripcion || (x.es_admin ? 'Todo, incluida la Configuración.' : 'Sin descripción.'))}</small>
      ${x.es_admin ? '<small class="nota">Puede todo por el cargo; no se edita.</small>' : `
        <div class="fila-botones">
          <button class="btn" data-permisos-puesto="${esc(x.clave)}">Ver sus permisos</button>
          <button class="btn" data-editar-puesto="${esc(x.clave)}">Renombrar</button>
          ${x.activo
            ? `<button class="btn" data-retirar-puesto="${esc(x.clave)}" ${x.personas ? 'disabled title="Tiene personas activas"' : ''}>Retirar</button>`
            : `<button class="btn" data-reactivar-puesto="${esc(x.clave)}">Reactivar</button>`}
          ${!x.personas && !x.personas_baja
            ? `<button class="btn peligro" data-borrar-puesto="${esc(x.clave)}">Borrar</button>` : ''}
        </div>`}
    </div>`;

  destino.innerHTML = `
    <div class="panel">
      <h2>${vigentes.length} puesto(s)</h2>
      <p class="explica">
        Cada persona ocupa un puesto y trae lo que ese puesto puede hacer; encima se le puede dar o quitar
        algo a ella sola. Lo que trae cada puesto se ajusta en <b>Permisos</b>, módulo por módulo.
      </p>
      <div class="rejilla-puestos">${vigentes.map(tarjeta).join('')}</div>
      ${retirados.length ? `
        <h3 class="subtitulo-panel">Retirados</h3>
        <div class="rejilla-puestos">${retirados.map(tarjeta).join('')}</div>` : ''}
    </div>

    <div class="panel">
      <h2>Crear un puesto</h2>
      <div class="bloque-form" style="padding-top:12px">
        <div class="rejilla-campos">
          <div class="campo"><label for="pu-nombre">Nombre del puesto</label>
            <input id="pu-nombre" maxlength="40" placeholder="Ej. Jefe de turno"></div>
          <div class="campo"><label for="pu-copia">Nace copiando</label>
            <select id="pu-copia">
              ${vigentes.map((x) => `<option value="${esc(x.clave)}" ${x.clave === 'operador' ? 'selected' : ''}>${esc(x.etiqueta)}</option>`).join('')}
            </select></div>
          <div class="campo" style="grid-column:1/-1"><label for="pu-desc">Qué hace (una línea)</label>
            <input id="pu-desc" maxlength="120" placeholder="Ej. Coordina un turno de armado y aprueba sus salidas"></div>
        </div>
        <small class="nota-campo" id="pu-nota"></small>
        <button class="btn primario" id="crear-puesto">Crear puesto</button>
      </div>
    </div>`;

  const nota = document.getElementById('pu-nota');
  const copia = document.getElementById('pu-copia');
  const explicarCopia = () => {
    nota.textContent = copia.value === 'admin'
      ? 'Copia todo lo que el Administrador puede repartir. Lo que es solo suyo (Configuración, aprobación final de Calidad, autorizar incidencias) no se copia. Después ajústalo en Permisos.'
      : 'Nace con exactamente lo que trae ese puesto. Después ajústalo en Permisos, módulo por módulo.';
  };
  copia.addEventListener('change', explicarCopia);
  explicarCopia();

  document.getElementById('crear-puesto').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/admin/puestos', {
        etiqueta: document.getElementById('pu-nombre').value,
        descripcion: document.getElementById('pu-desc').value,
        copiar_de: copia.value,
      });
      sessionStorage.setItem(PUESTO_PERMISOS_ELEGIDO, r.clave);
      sessionStorage.removeItem(PERSONA_PERMISOS_ELEGIDA);
      mostrarMensaje('Puesto creado. Ahora ajusta lo que puede hacer, módulo por módulo.', 'exito');
      location.hash = '#/config/permisos';
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  destino.querySelectorAll('[data-permisos-puesto]').forEach((b) => b.addEventListener('click', () => {
    sessionStorage.setItem(PUESTO_PERMISOS_ELEGIDO, b.dataset.permisosPuesto);
    sessionStorage.removeItem(PERSONA_PERMISOS_ELEGIDA);
    location.hash = '#/config/permisos';
  }));
  destino.querySelectorAll('[data-editar-puesto]').forEach((b) => b.addEventListener('click', async () => {
    const x = puestos.find((y) => y.clave === b.dataset.editarPuesto);
    const etiqueta = prompt('Nombre del puesto', x.etiqueta);
    if (etiqueta === null) return;
    const descripcion = prompt('Qué hace (una línea)', x.descripcion || '');
    if (descripcion === null) return;
    try { await api('PUT', `/api/admin/puestos/${x.clave}`, { etiqueta, descripcion }); recargarConfig(); }
    catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
  const cambiarActivo = (sel, activo, pregunta) => destino.querySelectorAll(sel).forEach((b) => b.addEventListener('click', async () => {
    const clave = b.getAttribute(sel.slice(1, -1));
    if (pregunta && !confirm(pregunta)) return;
    try { await api('PUT', `/api/admin/puestos/${clave}`, { activo }); recargarConfig(); }
    catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
  cambiarActivo('[data-retirar-puesto]', false, '¿Retirar este puesto? Ya no se podrá asignar a nadie; se puede reactivar.');
  cambiarActivo('[data-reactivar-puesto]', true);
  destino.querySelectorAll('[data-borrar-puesto]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Borrar este puesto? Nadie lo ha ocupado nunca, así que no se pierde historial.')) return;
    try { await api('DELETE', `/api/admin/puestos/${b.dataset.borrarPuesto}`); recargarConfig(); }
    catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
}

// --- la imagen de una unidad o de un material ---
//
// Se sube desde Configuración y se enseña donde se usa. Un solo selector de
// archivos para las dos pestañas: sabe a qué renglón va por lo que se le dice
// al abrirlo.
const selectorImagenCatalogo = document.createElement('input');
selectorImagenCatalogo.setAttribute('type', 'file');
selectorImagenCatalogo.setAttribute('accept', 'image/*');
selectorImagenCatalogo.hidden = true;
document.body.appendChild(selectorImagenCatalogo);
let destinoImagenCatalogo = null;

selectorImagenCatalogo.addEventListener('change', async () => {
  const archivo = selectorImagenCatalogo.files[0];
  selectorImagenCatalogo.value = '';
  if (!archivo || !destinoImagenCatalogo) return;
  try {
    await api('POST', `/api/admin/${destinoImagenCatalogo.tabla}/${destinoImagenCatalogo.id}/imagen`, {
      imagen: await comprimirImagen(archivo, 1200, 0.85),
    });
    mostrarMensaje('Imagen guardada.', 'exito');
    estado.fotos_productos = null;
    recargarConfig();
  } catch (err) { mostrarMensaje(err.message, 'error'); }
});

function celdaImagenCatalogo(tabla, fila) {
  return `
    <td class="celda-imagen">
      ${fila.imagen
        ? `<img class="imagen-catalogo" data-archivo="${esc(fila.imagen)}" alt="Imagen de ${esc(fila.nombre || fila.modelo)}">`
        : '<span class="sin-imagen">Sin imagen</span>'}
      <div class="fila-botones">
        <button class="btn" data-subir-imagen="${tabla}|${fila.id}">${fila.imagen ? 'Cambiar' : 'Subir'}</button>
        ${fila.imagen ? `<button class="btn peligro" data-quitar-imagen="${tabla}|${fila.id}" title="Quitar imagen">×</button>` : ''}
      </div>
    </td>`;
}

function conectarImagenesCatalogo(destino) {
  destino.querySelectorAll('[data-subir-imagen]').forEach((b) => {
    b.addEventListener('click', () => {
      const [tabla, id] = b.dataset.subirImagen.split('|');
      destinoImagenCatalogo = { tabla, id };
      selectorImagenCatalogo.click();
    });
  });
  destino.querySelectorAll('[data-quitar-imagen]').forEach((b) => {
    b.addEventListener('click', async () => {
      const [tabla, id] = b.dataset.quitarImagen.split('|');
      if (!confirm('¿Quitar la imagen?')) return;
      try { await api('DELETE', `/api/admin/${tabla}/${id}/imagen`); estado.fotos_productos = null; recargarConfig(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
  cargarImagenesPendientes(destino);
}

// --- Configuración no se despliega sola ---
//
// Cada pestaña pintaba de golpe su tabla completa y su formulario de alta
// abierto: dieciséis personas con todos sus accesos, los veinte grupos de
// Limpieza con cada documento, la bitácora entera. Para encontrar algo había
// que recorrer la pantalla, y lo que de verdad importa —cuántos hay, qué está
// pendiente— quedaba enterrado.
//
// Ahora lo que se ve es el resumen, y el detalle se pide: cada lista larga y
// cada formulario de alta nacen plegados detrás de un botón que dice qué tienen
// dentro. Lo corto se queda a la vista, porque esconder tres renglones es
// hacerle perder un clic a alguien.
//
// Se aplica SOBRE lo que la pestaña ya pintó, no dentro de cada una. Así una
// pestaña nueva nace igual de ordenada sin que nadie se acuerde de hacerlo, y
// las que se repintan solas al guardar se vuelven a plegar sin tocarlas.
const LARGO_PLEGABLE = 6;
let plegandoConfig = false;
// Lo que el Administrador dejó abierto, para devolvérselo cuando la pestaña se
// repinte al guardar.
const plegablesAbiertos = new Set();

function plegarConfig(zona) {
  if (!zona || plegandoConfig) return;
  plegandoConfig = true;
  const vistos = new Map();
  try {
    // Los paneles y también lo que la pestaña pinta suelto, fuera de ellos.
    for (const panel of [zona, ...zona.querySelectorAll('.panel')]) {
      for (const bloque of [...panel.children]) {
        if (bloque.dataset.plegado) continue;
        const esTabla = bloque.classList.contains('desliza') && bloque.querySelector('table');
        const esForm = bloque.classList.contains('bloque-form') || bloque.classList.contains('editor-nuevo');
        const esLista = bloque.classList.contains('grupo-catalogo');
        // Una explicación larga tampoco tiene que estar encima todo el tiempo:
        // el título del panel ya dice de qué es, y el porqué se lee una vez.
        const esNota = bloque.classList.contains('explica')
          && bloque.textContent.trim().length > 220;
        if (!esTabla && !esForm && !esLista && !esNota) continue;

        const filas = esTabla ? bloque.querySelectorAll('tbody tr').length : 0;
        // Una tabla corta se lee de un vistazo: plegarla solo estorba.
        if (esTabla && filas <= LARGO_PLEGABLE) { bloque.dataset.plegado = 'corta'; continue; }

        const h3 = bloque.querySelector('h3');
        const cuantos = esLista ? bloque.querySelectorAll('.ficha').length : 0;
        const titulo = esForm ? `+ ${h3 ? h3.textContent : 'Agregar'}`
          : esNota ? 'Cómo funciona esto'
            : esLista ? `${h3 ? h3.textContent : 'Lista'} · ${cuantos}`
              : `Ver la lista · ${filas} ${filas === 1 ? 'renglón' : 'renglones'}`;

        const caja = document.createElement('details');
        caja.className = `plegable ${esForm ? 'de-alta' : esNota ? 'de-nota' : esLista ? 'de-catalogo' : 'de-lista'}`;
        // La llave dice qué bloque es sin depender de dónde quedó ni de cuántos
        // renglones tenga: el nombre del panel —sin sus contadores, que cambian
        // al guardar— y qué clase de bloque es. Con ella, lo que estaba abierto
        // sigue abierto después de guardar.
        const h2 = panel.querySelector('h2');
        let panelTitulo = '';
        if (h2) {
          const copia = h2.cloneNode(true);
          copia.querySelectorAll('.etiqueta').forEach((x) => x.remove());
          panelTitulo = copia.textContent.trim();
        }
        const nombreBloque = h3 ? h3.textContent.trim() : '';
        const claveBloque = esForm ? `alta:${nombreBloque}`
          : esNota ? 'nota'
            : esLista ? `lista:${nombreBloque}` : 'tabla';
        const llave = `${panelTitulo}|${claveBloque}`;
        vistos.set(llave, (vistos.get(llave) || 0) + 1);
        caja.dataset.llave = vistos.get(llave) > 1 ? `${llave}#${vistos.get(llave)}` : llave;
        if (plegablesAbiertos.has(caja.dataset.llave)) caja.open = true;
        caja.addEventListener('toggle', () => {
          if (caja.open) plegablesAbiertos.add(caja.dataset.llave);
          else plegablesAbiertos.delete(caja.dataset.llave);
        });
        const cabeza = document.createElement('summary');
        cabeza.textContent = titulo;
        caja.appendChild(cabeza);
        bloque.parentNode.insertBefore(caja, bloque);
        caja.appendChild(bloque);
        bloque.dataset.plegado = 'si';
      }
    }
  } finally {
    plegandoConfig = false;
  }
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

  // Las pestañas se repintan solas después de guardar y no todas pasan por
  // aquí, así que en vez de llamar al plegado en cada una se vigila la zona: lo
  // que aparezca se pliega. Volver a plegar lo ya plegado no hace nada, así que
  // no hay forma de que esto se persiga a sí mismo.
  new MutationObserver(() => plegarConfig(destino))
    .observe(destino, { childList: true, subtree: true });

  try {
    await pestana.pintar(destino);
  } catch (err) {
    destino.innerHTML = avisoError(err.message);
  }
  plegarConfig(destino);
}

// Al guardar algo, la pestaña se vuelve a pintar entera. Sin esto la pantalla
// saltaba al principio y los bloques que estaban abiertos se cerraban: en la
// tablet había que volver a bajar, volver a abrir el bloque y volver a sacar el
// teclado para corregir el renglón de al lado. Se recuerda dónde estaba y qué
// tenía abierto, y se devuelve ahí.
const recargarConfig = async () => {
  const altura = window.scrollY;
  await vistaConfig((location.hash.match(/^#\/config\/([\w-]+)$/) || [])[1]);
  window.scrollTo({ top: altura });
};

// --- pestaña: modo de pruebas ---
//
// Prenderlo saca una copia de la base; desde ahí se entra «como» cualquier puesto
// o persona para probar lo que ve y lo que puede hacer. Apagarlo tira la copia.
async function pintarPruebas(destino) {
  const e = await api('GET', '/api/pruebas');
  const puedeProbar = e.puede;
  const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  destino.innerHTML = `
    <div class="panel ${e.activo ? 'peligroso' : ''}">
      <h2>Modo de pruebas <span class="etiqueta ${e.activo ? 'ambar' : ''}">${e.activo ? 'Prendido' : 'Apagado'}</span></h2>
      <div class="explica">
        <ul class="lista-breve">
          <li><b>Entras como cualquier puesto o persona</b> y ves exactamente su menú, sus botones y sus avisos.</li>
          <li><b>Sin reglas de día:</b> los checklists de viernes se abren cualquier día.</li>
          <li><b>Nada cuenta:</b> todo se captura en una copia aparte; el inventario, los reportes y los avisos reales no se enteran.</li>
          <li><b>Al apagarlo se tira la copia completa.</b> No hay que ir a Limpieza.</li>
        </ul>
        ${e.activo ? `<small>Lo prendió ${esc(e.por || '—')} · copia sacada el ${esc(cuando(e.copia_en || e.desde))}<br>
          Lo que se capture de verdad después de esa hora no aparece en la copia: usa «Actualizar la copia».</small>` : ''}
      </div>
      ${puedeProbar ? `
        <div class="fila-botones" style="padding:0 18px 18px">
          ${e.activo ? `
            <button class="btn" id="reiniciar-pruebas">Actualizar la copia</button>
            <button class="btn peligro" id="apagar-pruebas">Apagar y tirar la copia</button>`
            : '<button class="btn primario" id="prender-pruebas">Prender el modo de pruebas</button>'}
        </div>` : ''}
    </div>

    ${e.probando ? `
      <div class="aviso pendientes" style="cursor:default">
        <span><b>Ahora mismo estás probando como ${esc(e.probando.nombre)}</b>
          <small>${esc(e.probando.puesto || '')}</small></span>
        <button class="btn" id="salir-prueba-aqui">Salir de la prueba</button>
      </div>` : ''}

    ${e.activo && puedeProbar ? `
      <div class="panel">
        <h2>Entrar como…</h2>
        <p class="explica">Escoge un puesto para entrar como la primera persona que lo ocupa, o toca a alguien en particular.
          Si el puesto no tiene a nadie, se crea una persona de prueba dentro de la copia.</p>
        <div class="rejilla-puestos">
          ${e.puestos.map((x) => `
            <div class="tarjeta-puesto">
              <div class="cabeza"><b>${esc(x.etiqueta)}</b>
                <span class="etiqueta">${x.personas.length} persona(s)</span></div>
              <div class="fila-botones">
                <button class="btn primario" data-probar-puesto="${esc(x.clave)}">Entrar como ${esc(x.etiqueta)}</button>
              </div>
              ${x.personas.length > 1 ? `
                <div class="personas-prueba">
                  ${x.personas.map((u) => `<button class="chip-filtro" data-probar-persona="${u.id}">${esc(u.nombre)}</button>`).join('')}
                </div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}`;

  const hacer = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; }
    });
  };
  const repintar = () => pintarPruebas(destino);
  hacer('prender-pruebas', async () => { await api('POST', '/api/pruebas/prender'); mostrarMensaje('Modo de pruebas prendido: ya hay una copia para probar.', 'exito'); repintar(); });
  hacer('reiniciar-pruebas', async () => {
    if (!confirm('¿Sacar una copia nueva? Lo que se haya capturado probando se pierde y la copia queda igual a la operación de este momento.')) return repintar();
    await api('POST', '/api/pruebas/reiniciar');
    if (estado.prueba) fijarPrueba((await api('GET', '/api/yo')).usuario, null);
    mostrarMensaje('Copia actualizada.', 'exito'); repintar();
  });
  hacer('apagar-pruebas', async () => {
    if (!confirm('¿Apagar el modo de pruebas? Todo lo que se capturó probando se tira, y quien esté probando regresa a su sesión.')) return repintar();
    await api('POST', '/api/pruebas/apagar');
    if (estado.prueba) fijarPrueba((await api('GET', '/api/yo')).usuario, null);
    mostrarMensaje('Modo de pruebas apagado. La copia se tiró.', 'exito'); repintar();
  });
  hacer('salir-prueba-aqui', async () => { await salirDePrueba(); repintar(); });

  const entrarComo = async (cuerpo) => {
    const r = await api('POST', '/api/pruebas/entrar', cuerpo);
    fijarPrueba(r.usuario, r.prueba);
    location.hash = '#/menu';
  };
  destino.querySelectorAll('[data-probar-puesto]').forEach((b) => b.addEventListener('click', () =>
    entrarComo({ puesto: b.dataset.probarPuesto }).catch((err) => mostrarMensaje(err.message, 'error'))));
  destino.querySelectorAll('[data-probar-persona]').forEach((b) => b.addEventListener('click', () =>
    entrarComo({ usuario_id: Number(b.dataset.probarPersona) }).catch((err) => mostrarMensaje(err.message, 'error'))));
}

// Fuera de Configuración: desde la cinta, para cambiar de persona sin salir de la prueba.
async function vistaPruebas() {
  encabezado('Modo de pruebas', 'Entrar como otro puesto o persona');
  vista.innerHTML = `
    <div class="migaja"><button data-ir-hash="#/menu">← Menú</button><span>/</span><span>Modo de pruebas</span></div>
    <div id="mensajes"></div><div id="contenido-pruebas"></div>`;
  await pintarPruebas(document.getElementById('contenido-pruebas'));
}

// --- pestaña: personas ---

async function configPersonas(destino) {
  const { usuarios, roles, acceso } = await api('GET', '/api/admin/catalogos');
  const etiquetaRol = Object.fromEntries(roles.map((r) => [r.clave, r.etiqueta]));
  const activas = usuarios.filter((u) => u.activo);
  const bajas = usuarios.filter((u) => !u.activo);

  destino.innerHTML = `
    ${acceso.modo === 'clave' ? `
      <div class="aviso info">
        <b>Al sistema se entra escribiendo la clave.</b><br>
        La pantalla de ingreso ya no muestra nombres: cada quien se identifica
        con la suya, y por eso ninguna clave puede repetirse.
      </div>` : `
      <div class="aviso info">
        <b>El ingreso por clave todavía no se activa.</b><br>
        Falta asignarle clave a ${acceso.faltan.length} persona(s):
        ${acceso.faltan.map((n) => esc(n)).join(' · ')}.
        Mientras tanto se sigue entrando por nombre, para no dejarlas fuera del
        sistema. En cuanto todas tengan clave, la pantalla de ingreso cambia sola.
      </div>`}
    <div class="panel">
      <h2>${activas.length} persona(s) activa(s)${bajas.length ? ` · ${bajas.length} de baja` : ''}</h2>
      <p class="explica">
        La columna de accesos dice <b>cuántos</b> tiene cada quien y enseña solo los
        que se le dieron <b>a ella en particular</b> (★). Los demás vienen con su
        puesto y se ven completos en <b>Permisos</b>, que es donde se reparten.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Nombre</th><th>Puesto</th><th>A qué tiene acceso</th><th>Clave</th>
          <th>Historial</th><th>Estado</th><th>Editar</th>
        </tr></thead>
        <tbody>${usuarios.map((u) => `
          <tr class="${u.activo ? '' : 'inactiva'}">
              <td class="fila-titulo">${esc(u.nombre)}</td>
              <td>${esc(etiquetaRol[u.rol] || u.rol)}</td>
              <td>${u.accesos.length ? `
                <span title="${esc(u.accesos.map((a) => a.etiqueta).join(' · '))}">${u.accesos.length} acceso(s)</span>
                ${u.accesos.filter((a) => a.origen === 'otorgado').map((a) => `
                  <span class="etiqueta azul" title="Otorgado a esta persona">${esc(a.etiqueta)} ★</span>`).join(' ')}`
                : '<span style="color:var(--tinta-suave)">solo su módulo</span>'}</td>
              <td>${u.tiene_pin
                ? 'Sí'
                : (u.activo ? '<span class="etiqueta ambar">Falta</span>' : '—')}</td>
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
          <div class="campo"><label for="n-rol">Puesto</label>
            <select id="n-rol">
              ${roles.filter((r) => r.activo).map((r) => `<option value="${esc(r.clave)}">${esc(r.etiqueta)}</option>`).join('')}
            </select></div>
          <div class="campo"><label for="n-pin">Clave</label>
            <input id="n-pin" maxlength="12" autocomplete="off" placeholder="4 a 12 letras o números">
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
    notaPin.textContent = acceso.modo === 'clave'
      ? 'Con ella entra al sistema, así que no puede repetirse.'
      : (r && r.exige_pin
        ? 'Obligatoria para este puesto.'
        : 'Sin clave entra tocando su nombre, hasta que se active el ingreso por clave.');
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
      editarPersona(usuarios.find((u) => u.id === Number(boton.dataset.editar)), roles, acceso);
    });
  });
}

// --- pestaña: unidades ---

// Los tipos ya no están escritos aquí: viven en la base para que se puedan
// agregar (patines, motos, carros de arrendamiento) sin tocar el código.
let ETIQUETA_TIPO = {};

// Un dato extra de un teléfono: cómo se llama y cuánto vale. Devuelve
// {clave, valor} o null si se arrepintió.
function pedirDatoExtra(deQuien, clavesUsadas) {
  return new Promise((resolver) => {
    const capa = document.createElement('div');
    capa.className = 'modal';
    capa.innerHTML = `
      <div class="caja-modal" role="dialog" aria-label="Dato extra del teléfono">
        <h2>Un dato más de ${esc(deQuien || 'este teléfono')}</h2>
        <div class="cuerpo-modal">
          <div id="error-extra-tel"></div>
          <div class="campo"><label for="ex-clave">Cómo se llama el dato</label>
            <input id="ex-clave" list="ex-claves" placeholder="Ej. Número de inventario" autocomplete="off">
            <datalist id="ex-claves">
              ${clavesUsadas.map((x) => `<option value="${esc(x)}"></option>`).join('')}
            </datalist></div>
          <div class="campo"><label for="ex-valor">Qué dice</label>
            <input id="ex-valor" placeholder="Ej. INV-0423" autocomplete="off"></div>
        </div>
        <div class="pie-modal">
          <button class="btn" data-cancelar>Cancelar</button>
          <button class="btn primario" data-guardar>Agregar</button>
        </div>
      </div>`;
    document.body.appendChild(capa);
    const cerrar = (v) => { capa.remove(); resolver(v); };
    capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(null); });
    capa.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));
    capa.querySelector('[data-guardar]').addEventListener('click', () => {
      const clave = capa.querySelector('#ex-clave').value.trim();
      if (!clave) {
        capa.querySelector('#error-extra-tel').innerHTML = avisoError('Escribe cómo se llama el dato.');
        return;
      }
      cerrar({ clave, valor: capa.querySelector('#ex-valor').value.trim() });
    });
    capa.querySelector('#ex-clave').focus();
  });
}

async function configUnidades(destino) {
  const [{ activos }, logistica] = await Promise.all([
    api('GET', '/api/admin/catalogos'),
    api('GET', '/api/admin/logistica'),
  ]);
  const tipos = logistica.tipos;
  ETIQUETA_TIPO = Object.fromEntries(tipos.map((t) => [t.clave, t.etiqueta]));

  destino.innerHTML = `
    <div class="panel">
      <h2>${activos.length} unidad(es)</h2>
      <p class="explica">
        La imagen de cada unidad aparece en su checklist, para que quien lo llena
        sepa de un vistazo qué unidad está revisando.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Nombre</th><th>Imagen</th><th>Clave</th><th>Tipo</th><th>Parámetros del checklist</th></tr></thead>
        <tbody>${activos.map((a) => {
          const attr = Object.entries(JSON.parse(a.atributos)).filter(([, v]) => v);
          return `<tr class="${a.activo ? '' : 'inactiva'}">
            <td class="fila-titulo">${esc(a.nombre)}</td>
            ${celdaImagenCatalogo('activos', a)}
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
            <select id="a-tipo">${tipos.filter((t) => t.activo).map((t) => `
              <option value="${esc(t.clave)}">${esc(t.etiqueta)}</option>`).join('')}</select></div>
          <div class="campo"><label for="a-psi">Presión de llantas (psi)</label><input id="a-psi" inputmode="numeric" placeholder="Ej. 95"></div>
          <div class="campo"><label for="a-aceite">Grado de aceite</label><input id="a-aceite" placeholder="Ej. (15W40)"></div>
        </div>
        <button class="btn primario" id="agregar-activo">Agregar unidad</button>
      </div>
    </div>`;

  destino.insertAdjacentHTML('beforeend', `
    <div class="panel">
      <h2>Tipos de unidad</h2>
      <p class="explica">
        Cada tipo tiene su propio checklist y dice si la unidad lleva kilometraje
        y si carga combustible: un patín no tiene odómetro ni tanque, y por eso
        no se le pide ninguno de los dos.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Tipo</th><th>Unidades</th><th>Su checklist</th>
          <th>Kilometraje</th><th>Combustible</th><th>En uso</th></tr></thead>
        <tbody>${tipos.map((t) => `
          <tr class="${t.activo ? '' : 'inactiva'}">
            <td class="fila-titulo">${esc(t.etiqueta)}<br><small style="color:var(--tinta-suave)">${esc(t.clave)}</small></td>
            <td>${t.unidades}</td>
            <td>${t.checklist ? esc(t.checklist) : '<span style="color:var(--tinta-suave)">sin checklist</span>'}</td>
            <td><input type="checkbox" data-tipo-km="${esc(t.clave)}" ${t.lleva_kilometraje ? 'checked' : ''}></td>
            <td><input type="checkbox" data-tipo-comb="${esc(t.clave)}" ${t.lleva_combustible ? 'checked' : ''}></td>
            <td><input type="checkbox" data-tipo-activo="${esc(t.clave)}" ${t.activo ? 'checked' : ''}></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="bloque-form">
        <h3>Agregar un tipo de unidad</h3>
        <div class="rejilla-campos">
          <div class="campo"><label for="t-etiqueta">Nombre</label><input id="t-etiqueta" placeholder="Ej. Remolque"></div>
          <div class="campo"><label for="t-plural">En plural</label><input id="t-plural" placeholder="Ej. Remolques"></div>
          <div class="campo"><label for="t-clave">Clave corta</label><input id="t-clave" placeholder="Ej. remolque"></div>
        </div>
        <label class="casilla-texto"><input type="checkbox" id="t-km" checked> Lleva kilometraje</label>
        <label class="casilla-texto"><input type="checkbox" id="t-comb" checked> Carga combustible</label>
        <small class="nota-campo">Después hay que crearle su checklist en la pestaña de Checklists.</small>
        <button class="btn primario" id="agregar-tipo">Agregar tipo</button>
      </div>
    </div>

    <div class="panel">
      <h2>Listas de Logística</h2>
      <p class="explica">
        Lo que se escoge al anotar una carga de gasolina, un servicio o un papel
        de la unidad. Se edita aquí para que nadie lo escriba a mano cada vez.
      </p>
      ${logistica.catalogos.map((c) => `
        <div class="grupo-catalogo">
          <h3>${esc(c.etiqueta)}</h3>
          <div class="fichas-catalogo">
            ${c.valores.map((v) => `
              <span class="ficha ${v.activo ? '' : 'retirada'}">
                ${esc(v.valor)}
                <button class="quitar" data-cat-activo="${v.id}" data-valor="${v.activo ? '1' : '0'}"
                        title="${v.activo ? 'Retirar de la lista' : 'Volver a usar'}">${v.activo ? '×' : '+'}</button>
              </span>`).join('')}
          </div>
          <div class="agrega-catalogo">
            <input data-cat-nuevo="${esc(c.tipo)}" placeholder="Agregar a ${esc(c.etiqueta.toLowerCase())}">
            <button class="btn" data-cat-agregar="${esc(c.tipo)}">Agregar</button>
          </div>
        </div>`).join('')}
    </div>

    <div class="panel">
      <h2>De dónde salen las rutas</h2>
      <p class="explica">
        La dirección del almacén. Es el punto de partida del recorrido cuando la ruta de
        entrega se abre en el mapa: de aquí a la A, de la A a la B, y así.
      </p>
      <div class="bloque-form">
        <div class="campo"><label for="dir-almacen">Dirección del almacén</label>
          <input id="dir-almacen" value="${esc(logistica.direccion_almacen || '')}"
                 placeholder="Calle y número, colonia, ciudad"></div>
        <button class="btn" id="guardar-dir-almacen">Guardar la dirección</button>
      </div>
    </div>

    <div class="panel">
      <h2>Teléfonos corporativos
        <span class="etiqueta azul">${(logistica.telefonos || []).filter((t) => t.activo).length} en uso</span></h2>
      <p class="explica">
        Los celulares de la empresa que se asignan a quien sale con una unidad. Se escogen
        al llenar el <b>Formato de asignación e inspección vehicular</b> —ahí se leen por su
        <b>alias y su número</b>—, y así queda dicho qué equipo se llevó quién. Uno que ya
        salió en un formato no se borra: se retira.
        <br><br>
        El <b>alias</b> es como se le dice al equipo en el almacén: «Reparto 1», «El de la
        camioneta». Cuatro Samsung A15 no se distinguen entre sí; por su alias, sí. En
        <b>Datos extra</b> se le agrega a cada teléfono lo que haga falta y no tenga columna
        —número de inventario, plan contratado, cuándo se renueva—, sin tener que cambiarle
        la forma a la tabla.
      </p>
      <datalist id="lista-telefonias">
        ${(logistica.telefonias || []).map((x) => `<option value="${esc(x)}"></option>`).join('')}
      </datalist>
      <datalist id="lista-cuentas-padre">
        ${(logistica.cuentas_padre || []).map((x) => `<option value="${esc(x)}"></option>`).join('')}
      </datalist>
      <datalist id="lista-claves-extra">
        ${(logistica.claves_extra || []).map((x) => `<option value="${esc(x)}"></option>`).join('')}
      </datalist>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Equipo</th><th>Alias</th><th>Marca</th><th>Modelo</th><th>Número</th>
          <th>Telefonía</th><th>Cuenta padre</th><th>IMEI o serie</th><th>Notas</th>
          <th>Datos extra</th><th>En uso</th><th></th></tr></thead>
        <tbody>${(logistica.telefonos || []).map((t) => `
          <tr class="${t.activo ? '' : 'inactiva'}">
            <td class="fila-titulo">
              ${t.imagen
    ? `<img class="imagen-catalogo" data-archivo="${esc(t.imagen)}" alt="${esc(t.equipo || '')}">`
    : '<span class="sin-imagen">Sin imagen</span>'}
              <span class="fila-botones">
                <button class="btn" data-subir-imagen="telefonos|${t.id}">${t.imagen ? 'Cambiar' : 'Subir'}</button>
                ${t.imagen ? `<button class="btn peligro" data-quitar-imagen="telefonos|${t.id}" title="Quitar imagen">×</button>` : ''}
              </span>
            </td>
            <td><input class="obs" data-tel="${t.id}" data-campo="alias"
                value="${esc(t.alias || '')}" placeholder="Ej. Reparto 1" aria-label="Alias"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="marca"
                value="${esc(t.marca || t.equipo || '')}" aria-label="Marca"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="modelo" value="${esc(t.modelo || '')}"
                aria-label="Modelo"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="numero" value="${esc(t.numero || '')}"
                inputmode="tel" aria-label="Número"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="telefonia" list="lista-telefonias"
                value="${esc(t.telefonia || '')}" aria-label="Telefonía"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="cuenta_padre" list="lista-cuentas-padre"
                value="${esc(t.cuenta_padre || '')}" aria-label="Cuenta padre"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="imei" value="${esc(t.imei || '')}"
                aria-label="IMEI o serie"></td>
            <td><input class="obs" data-tel="${t.id}" data-campo="notas" value="${esc(t.notas || '')}"
                aria-label="Notas"></td>
            <td class="datos-extra">
              ${(t.extras || []).map((x, i) => `
                <span class="dato-extra"><b>${esc(x.clave)}:</b> ${esc(x.valor) || '—'}
                  <button class="quitar-extra" data-quitar-extra="${t.id}|${i}"
                          title="Quitar este dato">×</button></span>`).join('')}
              <button class="btn" data-agregar-extra="${t.id}">+ Dato</button>
            </td>
            <td><button class="casilla" data-tel-activo="${t.id}" data-valor="${t.activo ? '1' : '0'}"
                        aria-pressed="${!!t.activo}" title="Se puede escoger al salir">✓</button></td>
            <td><button class="btn peligro" data-tel-borrar="${t.id}"
                        data-equipo="${esc([t.marca, t.modelo].filter(Boolean).join(' ') || t.equipo || '')}">Borrar</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="bloque-form">
        <h3>Agregar un teléfono corporativo</h3>
        <div class="rejilla-campos">
          <div class="campo"><label for="tel-alias">Alias</label>
            <input id="tel-alias" placeholder="Ej. Reparto 1">
            <small class="nota-campo">Con este nombre se pide y se escoge al salir.</small></div>
          <div class="campo"><label for="tel-marca">Marca</label>
            <input id="tel-marca" placeholder="Ej. Samsung"></div>
          <div class="campo"><label for="tel-modelo">Modelo</label>
            <input id="tel-modelo" placeholder="Ej. A15"></div>
          <div class="campo"><label for="tel-numero">Número</label>
            <input id="tel-numero" inputmode="tel" placeholder="Ej. 55 1234 5678"></div>
          <div class="campo"><label for="tel-telefonia">Telefonía</label>
            <input id="tel-telefonia" list="lista-telefonias" placeholder="Ej. Telcel"></div>
          <div class="campo"><label for="tel-cuenta">Cuenta padre</label>
            <input id="tel-cuenta" list="lista-cuentas-padre" placeholder="De qué cuenta cuelga la línea"></div>
          <div class="campo"><label for="tel-imei">IMEI o serie</label><input id="tel-imei"></div>
          <div class="campo"><label for="tel-notas">Notas</label>
            <input id="tel-notas" placeholder="Ej. con funda y cargador"></div>
        </div>
        <button class="btn primario" id="agregar-telefono">Agregar teléfono</button>
        <small class="nota-campo">La imagen del equipo se sube después, en su renglón.</small>
      </div>
    </div>`);

  conectarImagenesCatalogo(destino);

  // --- teléfonos corporativos ---
  const guardarTelefono = async (id, cambios) => {
    try { await api('PUT', `/api/admin/telefonos/${id}`, cambios); }
    catch (err) { mostrarMensaje(err.message, 'error'); }
  };
  destino.querySelectorAll('[data-tel]').forEach((campo) => {
    campo.addEventListener('change', () => guardarTelefono(campo.dataset.tel,
      { [campo.dataset.campo]: campo.value.trim() }));
  });
  // Los datos extra de un teléfono. Se mandan completos —la lista entera— para
  // que el servidor no tenga que adivinar qué se agregó y qué se quitó.
  const telefonoDe = (id) => (logistica.telefonos || []).find((t) => t.id === Number(id));

  destino.querySelectorAll('[data-agregar-extra]').forEach((b) => {
    b.addEventListener('click', async () => {
      const t = telefonoDe(b.dataset.agregarExtra);
      if (!t) return;
      const dato = await pedirDatoExtra(t.alias || t.equipo, logistica.claves_extra || []);
      if (!dato) return;
      await guardarTelefono(t.id, { extras: [...(t.extras || []), dato] });
      recargarConfig();
    });
  });

  destino.querySelectorAll('[data-quitar-extra]').forEach((b) => {
    b.addEventListener('click', async () => {
      const [id, i] = b.dataset.quitarExtra.split('|');
      const t = telefonoDe(id);
      if (!t) return;
      const cual = (t.extras || [])[Number(i)];
      if (!cual || !confirm(`¿Quitar «${cual.clave}» de este teléfono?`)) return;
      await guardarTelefono(t.id, { extras: (t.extras || []).filter((_, k) => k !== Number(i)) });
      recargarConfig();
    });
  });

  destino.querySelectorAll('[data-tel-activo]').forEach((b) => {
    b.addEventListener('click', async () => {
      await guardarTelefono(b.dataset.telActivo, { activo: b.dataset.valor !== '1' });
      recargarConfig();
    });
  });
  destino.querySelectorAll('[data-tel-borrar]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm(`¿Borrar ${b.dataset.equipo}? Solo se puede si nunca se asignó.`)) return;
      try {
        await api('DELETE', `/api/admin/telefonos/${b.dataset.telBorrar}`);
        recargarConfig();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
  document.getElementById('agregar-telefono').addEventListener('click', async () => {
    const v = (id) => document.getElementById(id).value.trim();
    try {
      const r = await api('POST', '/api/admin/telefonos', {
        alias: v('tel-alias'),
        marca: v('tel-marca'), modelo: v('tel-modelo'), numero: v('tel-numero'),
        telefonia: v('tel-telefonia'), cuenta_padre: v('tel-cuenta'),
        imei: v('tel-imei'), notas: v('tel-notas'),
      });
      mostrarMensaje(r.mensaje, 'exito');
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  document.getElementById('guardar-dir-almacen').addEventListener('click', async () => {
    try {
      const r = await api('PUT', '/api/admin/direccion-almacen', {
        direccion: document.getElementById('dir-almacen').value,
      });
      mostrarMensaje(r.mensaje, 'exito');
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

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

  document.getElementById('agregar-tipo').addEventListener('click', async () => {
    try {
      await api('POST', '/api/admin/logistica/tipos', {
        etiqueta: valor('t-etiqueta'),
        plural: valor('t-plural'),
        clave: valor('t-clave') || valor('t-etiqueta'),
        lleva_kilometraje: document.getElementById('t-km').checked,
        lleva_combustible: document.getElementById('t-comb').checked,
      });
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  const guardarTipo = async (clave, cambios) => {
    try {
      await api('PUT', `/api/admin/logistica/tipos/${clave}`, cambios);
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  };
  destino.querySelectorAll('[data-tipo-km]').forEach((c) => c.addEventListener('change',
    () => guardarTipo(c.dataset.tipoKm, { lleva_kilometraje: c.checked })));
  destino.querySelectorAll('[data-tipo-comb]').forEach((c) => c.addEventListener('change',
    () => guardarTipo(c.dataset.tipoComb, { lleva_combustible: c.checked })));
  destino.querySelectorAll('[data-tipo-activo]').forEach((c) => c.addEventListener('change',
    () => guardarTipo(c.dataset.tipoActivo, { activo: c.checked })));

  destino.querySelectorAll('[data-cat-agregar]').forEach((b) => b.addEventListener('click', async () => {
    const tipo = b.dataset.catAgregar;
    const campo = destino.querySelector(`[data-cat-nuevo="${tipo}"]`);
    if (!campo.value.trim()) return;
    try {
      await api('POST', '/api/admin/logistica/catalogos', { tipo, valor: campo.value });
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
  destino.querySelectorAll('[data-cat-activo]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('PUT', `/api/admin/logistica/catalogos/${b.dataset.catActivo}`,
        { activo: b.dataset.valor !== '1' });
      recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
}

// --- pestaña: checklists ---

// Editor de preguntas. Nada se aplica mientras se edita: se ajusta todo lo que
// haga falta —redacción, tipos, orden, preguntas y áreas nuevas, retiros— y hasta
// abajo «Guardar cambios» lo aplica de una vez. Es la misma regla de la pantalla
// de Permisos: así la tablet nunca muestra un checklist a medio editar mientras
// el Administrador todavía está decidiendo.
//
// Cambiar la redacción corrige la pregunta también en lo ya capturado —es la
// misma—; retirar no borra: deja de salir en la tablet, pero lo contestado sigue
// en Reportes. El tipo de respuesta solo se cambia mientras nadie la haya
// contestado.
async function vistaEditorChecklist(id) {
  const d = await api('GET', `/api/admin/plantillas/${id}/estructura`);
  encabezado('Editar preguntas', d.plantilla.nombre);

  // Copia de trabajo. Lo nuevo lleva una llave temporal hasta que se guarda.
  let temporal = 0;
  const secciones = d.secciones.map((sec) => ({
    llave: `s${sec.id}`, id: sec.id, titulo: sec.titulo, etapa: sec.etapa,
    // Una condición de grupo —«todas las salidas de unidad»— se guarda con su
    // lista; en el editor se reconoce por el valor reservado de su grupo.
    condicion: sec.condicion
      ? (sec.condicion.en
        ? (d.condiciones.find((c) => c.en && c.campo === sec.condicion.campo) || {}).valor || ''
        : sec.condicion.valor)
      : '',
    items: sec.items.map((it) => ({
      llave: `i${it.id}`, id: it.id, texto: it.texto, tipo_respuesta: it.tipo_respuesta,
      obligatoria: !!it.meta.obligatoria, respuestas: it.respuestas, solo_activos: it.solo_activos,
    })),
  }));
  const retiradas = { secciones: [], items: [] };
  const foto = (lista) => JSON.stringify(lista.map((s) => [s.id, s.titulo, s.condicion, s.items.map((i) => [i.id, i.texto, i.tipo_respuesta, i.obligatoria])]));
  const original = foto(secciones);
  const cuantosCambios = () => {
    if (foto(secciones) === original && !retiradas.secciones.length && !retiradas.items.length) return 0;
    const antes = new Map(d.secciones.flatMap((s) => s.items).map((i) => [i.id, i]));
    let n = retiradas.secciones.length + retiradas.items.length;
    secciones.forEach((s, si) => {
      const previa = d.secciones.find((x) => x.id === s.id);
      if (!s.id || (previa && (previa.titulo !== s.titulo || d.secciones.indexOf(previa) !== si
        || (previa.condicion ? previa.condicion.valor : '') !== s.condicion))) n++;
      s.items.forEach((it, ii) => {
        const a = it.id && antes.get(it.id);
        if (!a) { n++; return; }
        const posAntes = (previa ? previa.items : []).findIndex((x) => x.id === it.id);
        if (a.texto !== it.texto || a.tipo_respuesta !== it.tipo_respuesta
          || !!a.meta.obligatoria !== it.obligatoria || posAntes !== ii) n++;
      });
    });
    return Math.max(n, 1);
  };

  // En Tránsito cada área es del envío, de la colecta o de ambos; eso decide
  // también cómo se llama su etapa.
  const etapaDelArea = (sec) => {
    if (!sec.condicion) return sec.etapa === 'regreso' ? 'Después de autorizar' : 'Antes de autorizar';
    const p = palabrasTransito({ tipo: sec.condicion });
    return sec.etapa === 'regreso' ? p.despues : p.antes;
  };
  const opcionesCondicion = (actual) => `<option value="">Todos</option>${d.condiciones
    .map((c) => `<option value="${esc(c.valor)}" ${c.valor === actual ? 'selected' : ''}>${esc(c.etiqueta)}</option>`).join('')}`;

  const opcionesTipo = (actual) => Object.entries(d.tipos)
    .map(([k, v]) => `<option value="${k}" ${k === actual ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const seccionDe = (llave) => secciones.find((s) => s.llave === llave);
  const itemDe = (llave) => {
    for (const s of secciones) {
      const it = s.items.find((x) => x.llave === llave);
      if (it) return [s, it];
    }
    return [null, null];
  };
  const intercambiar = (lista, i, hacia) => {
    const j = hacia === 'arriba' ? i - 1 : i + 1;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
  };

  // Salir con cambios sin guardar se pregunta: perderlos por tocar la migaja es
  // exactamente el accidente que el botón de guardar vino a evitar.
  window.onbeforeunload = () => (cuantosCambios() ? true : undefined);

  const actualizarBarra = () => {
    const n = cuantosCambios();
    const barra = document.getElementById('barra-guardar');
    if (!barra) return;
    barra.classList.toggle('pendiente', n > 0);
    document.getElementById('estado-cambios').textContent = n
      ? `${n} cambio(s) sin guardar`
      : 'Sin cambios pendientes';
    document.getElementById('guardar-editor').disabled = n === 0;
    document.getElementById('descartar-editor').disabled = n === 0;
  };

  const pintar = () => {
    const mensajes = document.getElementById('mensajes');
    const avisoPrevio = mensajes ? mensajes.innerHTML : '';
    vista.innerHTML = `
      <div class="migaja">
        <button data-ir-hash="#/menu">← Menú</button><span>/</span>
        <button data-ir-hash="#/config/checklists">Configuración · Checklists</button><span>/</span>
        <span>${esc(d.plantilla.nombre)}</span>
      </div>
      <div id="mensajes">${avisoPrevio}</div>
      <p class="explica" style="padding-left:0">
        <b>Nada se aplica mientras editas.</b> Ajusta lo que haga falta y, al terminar,
        toca <b>Guardar cambios</b> hasta abajo. <b>Cambiar la redacción</b> corrige la
        pregunta también en lo ya capturado. <b>Retirar</b> no borra: deja de salir en la
        tablet, pero lo contestado sigue en Reportes. El <b>tipo de respuesta</b> solo se
        cambia si nadie la ha contestado.
        ${d.plantilla.aplica_a === 'vehiculo' ? 'Textos como <code>{psi}</code> o <code>{aceite}</code> se sustituyen por el dato de cada unidad.' : ''}
        ${d.condiciones.length ? 'Cada área dice a qué aplica: un área de <b>Envío</b> no sale en una colecta, y al revés; <b>Todos</b> sale en ambos.' : ''}
      </p>
      ${secciones.map((sec, si) => `
        <section class="panel editor-seccion ${sec.id ? '' : 'nueva'}">
          <div class="editor-cabeza">
            <input class="obs editor-titulo" data-titulo-seccion="${sec.llave}" value="${esc(sec.titulo)}" aria-label="Nombre del área">
            ${sec.id ? '' : '<span class="etiqueta ambar">Nueva</span>'}
            ${d.plantilla.por_etapas ? `<span class="etiqueta azul">${etapaDelArea(sec)}</span>` : ''}
            ${d.condiciones.length ? `<label class="editor-oblig">Aplica a
              <select data-condicion-seccion="${sec.llave}">${opcionesCondicion(sec.condicion)}</select></label>` : ''}
            <span class="editor-acciones">
              <button class="btn" data-mover-seccion="${sec.llave}" data-hacia="arriba" ${si === 0 ? 'disabled' : ''} title="Subir área">↑</button>
              <button class="btn" data-mover-seccion="${sec.llave}" data-hacia="abajo" ${si === secciones.length - 1 ? 'disabled' : ''} title="Bajar área">↓</button>
              <button class="btn" data-retirar-seccion="${sec.llave}">Retirar área</button>
            </span>
          </div>
          <div class="editor-items">
            ${sec.items.map((it, ii) => `
              <div class="editor-item ${it.id ? '' : 'nuevo'}">
                <span class="editor-num">${ii + 1}</span>
                <input class="obs" data-texto-item="${it.llave}" value="${esc(it.texto)}" aria-label="Pregunta">
                <select data-tipo-item="${it.llave}" ${it.respuestas ? 'disabled title="Ya tiene respuestas: el tipo no se cambia"' : ''}>${opcionesTipo(it.tipo_respuesta)}</select>
                ${it.tipo_respuesta === 'fecha' ? `
                  <label class="editor-oblig"><input type="checkbox" data-oblig-item="${it.llave}" ${it.obligatoria ? 'checked' : ''}> Obligatoria</label>` : ''}
                <span class="editor-acciones">
                  <button class="btn" data-mover-item="${it.llave}" data-hacia="arriba" ${ii === 0 ? 'disabled' : ''} title="Subir">↑</button>
                  <button class="btn" data-mover-item="${it.llave}" data-hacia="abajo" ${ii === sec.items.length - 1 ? 'disabled' : ''} title="Bajar">↓</button>
                  <button class="btn" data-retirar-item="${it.llave}">Retirar</button>
                </span>
                ${it.id ? '' : '<small class="editor-nota">Pregunta nueva: se crea al guardar.</small>'}
                ${it.solo_activos ? `<small class="editor-nota">Solo para: ${esc(JSON.parse(it.solo_activos).join(', '))}</small>` : ''}
                ${it.respuestas ? `<small class="editor-nota">${it.respuestas} respuesta(s) capturada(s)</small>` : ''}
              </div>`).join('') || '<div class="vacio">Esta área no tiene preguntas.</div>'}
            <div class="editor-nuevo">
              <input class="obs" data-nuevo-texto="${sec.llave}" placeholder="Nueva pregunta o punto…">
              <select data-nuevo-tipo="${sec.llave}">${opcionesTipo('ok_problema')}</select>
              <button class="btn" data-agregar-item="${sec.llave}">+ Agregar</button>
            </div>
          </div>
        </section>`).join('')}
      <section class="panel">
        <h2>Nueva área</h2>
        <div class="editor-nuevo" style="padding:0 18px 18px">
          <input class="obs" id="nueva-seccion" placeholder="Por ejemplo: 7. Accesorios">
          ${d.plantilla.por_etapas ? '<select id="nueva-etapa"><option value="salida">Antes de autorizar (salida o carga)</option><option value="regreso">Después de autorizar (cierre)</option></select>' : ''}
          ${d.condiciones.length ? `<select id="nueva-condicion">${opcionesCondicion('')}</select>` : ''}
          <button class="btn" id="agregar-seccion">+ Agregar área</button>
        </div>
      </section>
      <div class="barra-guardar" id="barra-guardar">
        <span id="estado-cambios"></span>
        <button class="btn" id="descartar-editor">Descartar cambios</button>
        <button class="btn primario grande" id="guardar-editor">Guardar cambios</button>
      </div>`;
    enganchar();
    actualizarBarra();
  };

  const cada = (sel, evento, fn) => vista.querySelectorAll(sel).forEach((el) => el.addEventListener(evento, () => fn(el)));

  const enganchar = () => {
    vista.querySelectorAll('.migaja [data-ir-hash]').forEach((b) => b.addEventListener('click', (e) => {
      if (cuantosCambios() && !confirm('Tienes cambios sin guardar. ¿Salir sin guardarlos?')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      window.onbeforeunload = null;
    }));

    // Escribir no redibuja la pantalla —se perdería el cursor—; solo actualiza
    // la copia de trabajo y la barra de guardar.
    cada('[data-titulo-seccion]', 'input', (c) => { seccionDe(c.dataset.tituloSeccion).titulo = c.value; actualizarBarra(); });
    cada('[data-texto-item]', 'input', (c) => { itemDe(c.dataset.textoItem)[1].texto = c.value; actualizarBarra(); });
    cada('[data-tipo-item]', 'change', (c) => {
      const it = itemDe(c.dataset.tipoItem)[1];
      it.tipo_respuesta = c.value;
      if (c.value !== 'fecha') it.obligatoria = false;
      pintar();
    });
    cada('[data-oblig-item]', 'change', (c) => { itemDe(c.dataset.obligItem)[1].obligatoria = c.checked; actualizarBarra(); });
    cada('[data-condicion-seccion]', 'change', (c) => { seccionDe(c.dataset.condicionSeccion).condicion = c.value; pintar(); });
    cada('[data-mover-item]', 'click', (b) => {
      const [sec, it] = itemDe(b.dataset.moverItem);
      intercambiar(sec.items, sec.items.indexOf(it), b.dataset.hacia);
      pintar();
    });
    cada('[data-mover-seccion]', 'click', (b) => {
      const sec = seccionDe(b.dataset.moverSeccion);
      intercambiar(secciones, secciones.indexOf(sec), b.dataset.hacia);
      pintar();
    });
    cada('[data-retirar-item]', 'click', (b) => {
      const [sec, it] = itemDe(b.dataset.retirarItem);
      if (it.respuestas && !confirm('Esta pregunta ya tiene respuestas. Al guardar deja de salir en la tablet; lo contestado se conserva en Reportes. ¿Retirarla?')) return;
      sec.items.splice(sec.items.indexOf(it), 1);
      if (it.id) retiradas.items.push(it.id);
      pintar();
    });
    cada('[data-retirar-seccion]', 'click', (b) => {
      const sec = seccionDe(b.dataset.retirarSeccion);
      if (sec.items.length && !confirm('¿Retirar esta área con todas sus preguntas? Lo ya contestado se conserva en Reportes.')) return;
      secciones.splice(secciones.indexOf(sec), 1);
      if (sec.id) retiradas.secciones.push(sec.id);
      pintar();
    });
    cada('[data-agregar-item]', 'click', (b) => {
      const llave = b.dataset.agregarItem;
      const texto = vista.querySelector(`[data-nuevo-texto="${llave}"]`).value.trim();
      if (!texto) return mostrarMensaje('Escribe la pregunta antes de agregarla.', 'error');
      temporal += 1;
      seccionDe(llave).items.push({
        llave: `n${temporal}`, id: null, texto, respuestas: 0, solo_activos: null, obligatoria: false,
        tipo_respuesta: vista.querySelector(`[data-nuevo-tipo="${llave}"]`).value,
      });
      return pintar();
    });
    document.getElementById('agregar-seccion').addEventListener('click', () => {
      const titulo = document.getElementById('nueva-seccion').value.trim();
      if (!titulo) return mostrarMensaje('Escribe el nombre del área antes de agregarla.', 'error');
      const etapa = document.getElementById('nueva-etapa');
      temporal += 1;
      const condicion = document.getElementById('nueva-condicion');
      secciones.push({
        llave: `ns${temporal}`, id: null, titulo, etapa: etapa ? etapa.value : 'salida',
        condicion: condicion ? condicion.value : '', items: [],
      });
      return pintar();
    });

    document.getElementById('descartar-editor').addEventListener('click', () => {
      if (!confirm('¿Descartar todos los cambios sin guardar?')) return;
      window.onbeforeunload = null;
      vistaEditorChecklist(id);
    });

    document.getElementById('guardar-editor').addEventListener('click', async (e) => {
      const boton = e.currentTarget;
      boton.disabled = true;
      try {
        const r = await api('POST', `/api/admin/plantillas/${id}/estructura`, {
          secciones: secciones.map((sec) => ({
            id: sec.id, titulo: sec.titulo, etapa: sec.etapa,
            condicion: sec.condicion
              ? { campo: d.condiciones.find((c) => c.valor === sec.condicion).campo, valor: sec.condicion }
              : null,
            items: sec.items.map((it) => ({
              id: it.id, texto: it.texto, tipo_respuesta: it.tipo_respuesta, obligatoria: it.obligatoria,
            })),
          })),
          retiradas,
        });
        window.onbeforeunload = null;
        const partes = [
          r.preguntas_nuevas ? `${r.preguntas_nuevas} pregunta(s) nueva(s)` : '',
          r.secciones_nuevas ? `${r.secciones_nuevas} área(s) nueva(s)` : '',
          r.retiradas ? `${r.retiradas} retiro(s)` : '',
        ].filter(Boolean).join(', ');
        await vistaEditorChecklist(id);
        mostrarMensaje(`Cambios guardados${partes ? `: ${partes}` : ''}. La tablet ya muestra la versión nueva.`, 'exito');
      } catch (err) {
        mostrarMensaje(err.message, 'error');
        boton.disabled = false;
      }
    });
  };

  pintar();
}

async function configChecklists(destino) {
  const [plantillas, logistica] = await Promise.all([
    api('GET', '/api/admin/plantillas'),
    api('GET', '/api/admin/logistica'),
  ]);
  const tipos = logistica.tipos.filter((t) => t.activo);

  destino.innerHTML = `
    <div class="panel">
      <h2>Checklists del sistema</h2>
      <p class="explica">
        Retirar un checklist lo saca de la tablet y de los pendientes, pero
        conserva todo lo ya capturado en Reportes. Un checklist de unidad solo
        aparece para llenarse cuando hay unidades de ese tipo dadas de alta.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Checklist</th><th>Se le llena a</th><th>Frecuencia</th><th>Ítems</th>
          <th>Llenados</th><th>Exige foto</th><th>En uso</th>
        </tr></thead>
        <tbody>${plantillas.map((p) => `
          <tr class="${p.activo ? '' : 'inactiva'}">
            <td class="fila-titulo">${esc(p.nombre)}<br>
              <small style="color:var(--tinta-suave)">${esc(p.descripcion || '')}</small>
              ${p.tipo_captura === 'items' && permiso('config_editar_checklists')
                ? `<br><button class="btn" style="margin-top:6px" data-ir-hash="#/config-editor/${p.id}">Editar preguntas</button>` : ''}</td>
            <td>${p.aplica_a
              ? `${esc(p.etiqueta_tipo || p.aplica_a)}${p.unidades
                ? ` · ${p.unidades} unidad(es)`
                : ' · <b>sin unidades</b>'}`
              : '<span style="color:var(--tinta-suave)">no es de una unidad</span>'}</td>
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

      <div class="bloque-form">
        <h3>Agregar un checklist</h3>
        <p class="explica" style="padding:0 0 12px">
          Desde cero o copiando uno que se parezca —una moto se revisa casi como
          otra moto—. Copiarlo trae sus áreas y sus preguntas, no lo capturado;
          después se ajusta en el editor.
        </p>
        <div class="rejilla-campos">
          <div class="campo"><label for="nc-nombre">Nombre</label>
            <input id="nc-nombre" placeholder="Ej. Inspección de Remolque"></div>
          <div class="campo"><label for="nc-copiar">Copiar de</label>
            <select id="nc-copiar">
              <option value="">Desde cero (sin preguntas)</option>
              ${plantillas.filter((p) => p.tipo_captura === 'items').map((p) => `
                <option value="${p.id}">${esc(p.nombre)} (${p.items} preguntas)</option>`).join('')}
            </select></div>
          <div class="campo"><label for="nc-aplica">Se le llena a</label>
            <select id="nc-aplica">
              <option value="">No es de una unidad</option>
              ${tipos.map((t) => `<option value="${esc(t.clave)}">${esc(t.etiqueta)}</option>`).join('')}
            </select></div>
          <div class="campo"><label for="nc-frecuencia">Cada cuándo</label>
            <select id="nc-frecuencia">
              <option value="semanal">Semanal</option>
              <option value="viernes">Solo viernes</option>
              <option value="diario">Diario</option>
            </select></div>
          <div class="campo"><label for="nc-descripcion">Descripción</label>
            <input id="nc-descripcion" placeholder="Una línea: qué se revisa"></div>
        </div>
        <label class="casilla-texto"><input type="checkbox" id="nc-firma" checked> Lo firma quien lo llena</label>
        <label class="casilla-texto"><input type="checkbox" id="nc-firma-tl"> Lo firma además un Team Leader</label>
        <label class="casilla-texto"><input type="checkbox" id="nc-foto" checked> Exige foto al marcar un problema</label>
        <button class="btn primario" id="crear-checklist">Crear checklist</button>
      </div>
    </div>`;

  document.getElementById('crear-checklist').addEventListener('click', async () => {
    const v = (id) => document.getElementById(id).value.trim();
    try {
      const r = await api('POST', '/api/admin/plantillas', {
        nombre: v('nc-nombre'),
        descripcion: v('nc-descripcion'),
        copiar_de: v('nc-copiar') || null,
        aplica_a: v('nc-aplica') || null,
        frecuencia: v('nc-frecuencia'),
        firma_operador: document.getElementById('nc-firma').checked,
        firma_coordinador: document.getElementById('nc-firma-tl').checked,
        foto_obligatoria: document.getElementById('nc-foto').checked,
      });
      mostrarMensaje(r.mensaje, 'exito');
      // Se abre su editor: un checklist nuevo casi siempre necesita ajustes.
      if (permiso('config_editar_checklists')) location.hash = `#/config-editor/${r.id}`;
      else recargarConfig();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

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

// --- pestaña: tránsito ---

// La lista de CEDIS del desplegable, y la puerta a las preguntas y permisos de
// Tránsito. Mismo patrón que el editor: nada se aplica hasta «Guardar cambios».
async function configTransito(destino) {
  const d = await api('GET', '/api/admin/transito');
  let temporal = 0;
  const lista = d.cedis.map((c) => ({
    llave: `c${c.id}`, id: c.id, nombre: c.nombre, direccion: c.direccion || '',
    activo: !!c.activo, usos: c.usos,
  }));
  const foto = () => JSON.stringify(lista.map((c) => [c.id, c.nombre.trim(), c.direccion.trim(), c.activo]));
  const original = foto();
  const hayCambios = () => foto() !== original;
  window.onbeforeunload = () => (hayCambios() ? true : undefined);

  const actualizarBarra = () => {
    const pendiente = hayCambios();
    document.getElementById('barra-guardar').classList.toggle('pendiente', pendiente);
    document.getElementById('estado-cambios').textContent = pendiente ? 'Hay cambios sin guardar' : 'Sin cambios pendientes';
    document.getElementById('guardar-cedis').disabled = !pendiente;
    document.getElementById('descartar-cedis').disabled = !pendiente;
  };

  const pintar = () => {
    destino.innerHTML = `
      <div class="panel">
        <h2>CEDIS <span class="etiqueta azul">${lista.filter((c) => c.activo).length} en la lista</span></h2>
        <p class="explica">
          Es la lista desplegable que sale al abrir un envío o una colecta. <b>Quitar de la
          lista</b> no borra nada: lo ya capturado conserva su CEDIS. <b>Renombrar</b> cambia
          solo lo que se capture de aquí en adelante. La <b>dirección</b> se escribe una vez
          y con ella se abre en el mapa cada parada de ese CEDIS en la ruta de entrega.
        </p>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">CEDIS</th><th>Dirección</th><th>En la lista</th><th>Capturados</th></tr></thead>
          <tbody>${lista.map((c) => `
            <tr class="${c.activo ? '' : 'inactiva'}">
              <td class="fila-titulo"><input class="obs" data-nombre-cedis="${c.llave}" value="${esc(c.nombre)}" aria-label="Nombre del CEDIS"></td>
              <td><input class="obs" data-dir-cedis="${c.llave}" value="${esc(c.direccion)}" placeholder="Calle y número, colonia, ciudad" aria-label="Dirección del CEDIS"></td>
              <td><button class="casilla" data-activo-cedis="${c.llave}" aria-pressed="${c.activo}" title="Mostrar en la lista">✓</button></td>
              <td>${c.id ? c.usos : '<span class="etiqueta ambar">Nuevo</span>'}</td>
            </tr>`).join('')}
          </tbody></table></div>
        <div class="editor-nuevo" style="padding:0 18px 18px">
          <input class="obs" id="nuevo-cedis" placeholder="Nombre del CEDIS nuevo">
          <button class="btn" id="agregar-cedis">+ Agregar CEDIS</button>
        </div>
      </div>
      <div class="panel">
        <h2>Preguntas y permisos</h2>
        <p class="explica">
          Las preguntas de envío y de colecta se editan igual que las de las unidades.
          Quién captura, quién autoriza la salida o la carga y quién aprueba el cierre se
          reparte en <b>Permisos → Tránsito</b>.
        </p>
        <div class="fila-botones" style="padding:0 18px 18px">
          ${d.plantilla_id && permiso('config_editar_checklists')
            ? `<button class="btn" data-ir-hash="#/config-editor/${d.plantilla_id}">Editar preguntas de Tránsito</button>` : ''}
          <button class="btn" data-ir-hash="#/config/permisos">Ir a Permisos</button>
        </div>
      </div>
      <div class="barra-guardar" id="barra-guardar">
        <span id="estado-cambios"></span>
        <button class="btn" id="descartar-cedis">Descartar cambios</button>
        <button class="btn primario grande" id="guardar-cedis">Guardar cambios</button>
      </div>`;

    const deLlave = (llave) => lista.find((c) => c.llave === llave);
    destino.querySelectorAll('[data-nombre-cedis]').forEach((i) => i.addEventListener('input', () => {
      deLlave(i.dataset.nombreCedis).nombre = i.value;
      actualizarBarra();
    }));
    destino.querySelectorAll('[data-dir-cedis]').forEach((i) => i.addEventListener('input', () => {
      deLlave(i.dataset.dirCedis).direccion = i.value;
      actualizarBarra();
    }));
    destino.querySelectorAll('[data-activo-cedis]').forEach((b) => b.addEventListener('click', () => {
      const c = deLlave(b.dataset.activoCedis);
      c.activo = !c.activo;
      pintar();
    }));
    document.getElementById('agregar-cedis').addEventListener('click', () => {
      const nombre = document.getElementById('nuevo-cedis').value.trim();
      if (!nombre) return mostrarMensaje('Escribe el nombre del CEDIS antes de agregarlo.', 'error');
      temporal += 1;
      lista.push({ llave: `n${temporal}`, id: null, nombre, direccion: '', activo: true, usos: 0 });
      return pintar();
    });
    document.getElementById('descartar-cedis').addEventListener('click', () => {
      if (!confirm('¿Descartar los cambios sin guardar?')) return;
      window.onbeforeunload = null;
      recargarConfig();
    });
    document.getElementById('guardar-cedis').addEventListener('click', async (e) => {
      const boton = e.currentTarget;
      boton.disabled = true;
      try {
        await api('POST', '/api/admin/transito/cedis', {
          cedis: lista.map(({ id, nombre, direccion, activo }) => ({ id, nombre, direccion, activo })),
        });
        window.onbeforeunload = null;
        await recargarConfig();
        mostrarMensaje('Lista de CEDIS guardada. La tablet ya la muestra.', 'exito');
      } catch (err) {
        mostrarMensaje(err.message, 'error');
        boton.disabled = false;
      }
    });
    actualizarBarra();
  };

  pintar();
}

// Editor de una persona. Se abre encima de la tabla para que en tablet no haya
// que pelear con campos diminutos dentro de una celda.

// --- pestaña: materiales (catálogo de Calidad) ---

// Es la hoja MATERIALES del Excel, que estaba protegida con contraseña. Aquí se
// edita sin riesgo: las cuentas del muestreo no viven en estas celdas.

const COLUMNAS_MATERIAL = [
  ['color_impresion', 'Color impr.'],
  ['marca_termino', 'Marca término'],
  ['tipo_centro', 'Tipo centro'],
  ['gap', 'GAP'],
  ['cant_x_rollo', 'Etiquetas/rollo'],
  ['diam_referencia', 'Diám. ref.'],
  ['centro_referencia', 'Centro ref.'],
];

// Un solo catálogo, por familia de producto. Un rollo 80x70 es el mismo producto
// para Calidad (que lo muestrea contra su modelo) y para Almacén (que lo mueve),
// así que no se enseñan por módulo sino por lo que son. En Rollos y Etiquetas cada
// modelo de muestreo agrupa sus productos: arriba su especificación y su imagen,
// abajo las variantes (colores, presentaciones) con la suya.
const FAMILIAS_MATERIAL = [
  { clave: 'rollos', etiqueta: 'Rollos de papel', tipos: ['Rollos Térmicos', 'Rollos Papel'], muestreo: true },
  { clave: 'etiquetas', etiqueta: 'Etiquetas térmicas', tipos: ['Etiquetas Térmicas', 'Etiquetas Compatibles Brother'], muestreo: true },
  { clave: 'portarollos', etiqueta: 'Portarollos', tipos: ['Portarollos'] },
  { clave: 'empaque', etiqueta: 'Material de empaque', tipos: ['Cajas', 'Material Empaque'] },
  // La producción especial no es un tipo de material: es cualquier producto
  // marcado como especial, venga de donde venga. Por eso no trae 'tipos'.
  { clave: 'especial', etiqueta: 'Producción especial', especial: true },
  { clave: 'proveedores', etiqueta: 'Proveedores' },
  { clave: 'fondos', etiqueta: 'Colores de fondo' },
];

async function configMateriales(destino) {
  const { materiales, proveedores, fondos, productos = [], subagrupadores = [], tipos_material: tiposMaterial = [] } =
    await api('GET', '/api/admin/materiales');

  // Un tipo que no esté en ninguna familia (uno nuevo del Excel) no se pierde:
  // cae en «Otros».
  const conocidos = new Set(FAMILIAS_MATERIAL.flatMap((f) => f.tipos || []));
  const otros = [...new Set(productos.filter((p) => !p.especial)
    .map((p) => p.tipo_material).filter((t) => !conocidos.has(t)))];
  const familias = [...FAMILIAS_MATERIAL];
  if (otros.length) familias.splice(4, 0, { clave: 'otros', etiqueta: 'Otros', tipos: otros });

  // Un producto marcado como especial sale de su familia de siempre y se va a
  // su partida: es justo lo que se pidió, que no ensucie el catálogo diario.
  const productosDe = (f) => (f.especial
    ? productos.filter((p) => p.especial)
    : productos.filter((p) => !p.especial && (f.tipos || []).includes(p.tipo_material)));
  const materialesDe = (f) => materiales.filter((m) => (m.familia || 'etiquetas') === f.clave);
  const cuantos = (f) => (f.clave === 'proveedores' ? proveedores.filter((x) => x.activo).length
    : f.clave === 'fondos' ? fondos.filter((x) => x.activo).length : productosDe(f).length);

  const guardada = sessionStorage.getItem('config.materiales.familia');
  const familia = familias.find((f) => f.clave === guardada) || familias[0];
  const tipoGuardado = sessionStorage.getItem(`config.materiales.tipo.${familia.clave}`) || '';

  const listaSimple = (titulo, tipo, filas, ayuda) => `
    <div class="panel">
      <h2>${titulo} <span class="etiqueta azul">${filas.filter((f) => f.activo).length}</span></h2>
      <p class="explica">${ayuda}</p>
      <div class="selector-semanas">
        ${filas.map((f) => `
          <label class="chip">
            <input type="checkbox" data-catalogo="${f.id}" ${f.activo ? 'checked' : ''}>
            ${esc(f.valor)}
          </label>`).join('')}
      </div>
      <div class="bloque-form">
        <div class="campos-linea">
          <div class="campo" style="flex:1"><label for="nuevo-${tipo}">Agregar</label>
            <input id="nuevo-${tipo}" placeholder="Nombre nuevo"></div>
          <button class="btn" data-agregar-catalogo="${tipo}">Agregar</button>
        </div>
      </div>
    </div>`;

  // La imagen, en bloque (no en celda): subir, cambiar, quitar.
  const bloqueImagen = (tabla, fila, heredada) => `
    <div class="imagen-producto">
      ${fila.imagen
        ? `<img class="imagen-catalogo" data-archivo="${esc(fila.imagen)}" alt="">`
        : heredada
          ? `<img class="imagen-catalogo heredada" data-archivo="${esc(heredada)}" alt="" title="Usa la imagen de su modelo">`
          : '<span class="sin-imagen">Sin imagen</span>'}
      <span class="fila-botones">
        <button class="btn" data-subir-imagen="${tabla}|${fila.id}">${fila.imagen ? 'Cambiar' : 'Subir'}</button>
        ${fila.imagen ? `<button class="btn peligro" data-quitar-imagen="${tabla}|${fila.id}" title="Quitar imagen">×</button>` : ''}
      </span>
    </div>`;

  const filaProducto = (p, heredada, conOrden = false) => `
    <div class="fila-producto ${p.activo ? '' : 'inactiva'}" data-tipo="${esc(p.tipo_material)}"
         data-texto="${esc(`${p.nombre} ${p.modelo || ''} ${p.sku} ${p.subagrupador || ''} ${p.descripcion || ''}`.toLowerCase())}">
      ${bloqueImagen('almacen_productos', p, heredada)}
      <span class="que"><b>${esc(p.nombre)}</b>
        <small>${esc(p.modelo || '')}${p.modelo ? ' · ' : ''}${esc(p.sku)}${p.stock_minimo ? ` · mínimo ${numero(p.stock_minimo)}` : ''}</small>
        ${p.descripcion ? `<small class="descripcion-rollo">${esc(p.descripcion)}</small>` : ''}</span>
      ${p.activo ? '' : '<span class="etiqueta">Retirado</span>'}
      <span class="etiqueta">${esc(p.tipo_material)}</span>
      ${conOrden ? `
        <span class="fila-botones">
          <button class="btn" data-mover-producto="${p.id}|arriba" title="Subir">↑</button>
          <button class="btn" data-mover-producto="${p.id}|abajo" title="Bajar">↓</button>
        </span>` : ''}
      <button class="btn" data-editar-producto="${p.id}">Editar</button>
    </div>`;

  const resumenEspec = (m) => COLUMNAS_MATERIAL.filter(([c]) => m[c])
    .slice(0, 3).map(([c, e]) => `${e}: ${m[c]}`).join(' · ');

  // --- producción especial: por partida, movible y con su descripción ---
  const cuerpoEspecial = () => {
    const suyos = productosDe(familia);
    const partidas = [...new Set(suyos.map((p) => p.subagrupador || 'Sin partida'))].sort();
    return `
      <div class="panel">
        <h2>Producción especial <span class="etiqueta azul" id="cuenta-familia">${suyos.length}</span></h2>
        <p class="explica">
          Rollos que se le piden al proveedor con algo distinto —el fondo de otro color, una
          impresión, otra medida— y que llegan a almacén como cualquier material: <b>se dan de
          alta aquí y desde ese momento tienen entradas, salidas, traspasos y conteos</b> como
          todos. Lo único que cambia es que viven en su propia partida y no se mezclan con el
          catálogo de todos los días.
        </p>
        <div class="filtro-lista"><input type="search" id="buscar-familia"
          placeholder="Buscar producto, partida, SKU o descripción…" autocomplete="off"></div>

        <div class="grupos-material">
          ${partidas.length ? partidas.map((partida) => `
            <section class="grupo-material abierto" data-grupo data-texto="${esc(partida.toLowerCase())}">
              <header>
                <span class="que"><b>${esc(partida)}</b>
                  <small>${suyos.filter((p) => (p.subagrupador || 'Sin partida') === partida).length} producto(s)</small></span>
              </header>
              ${suyos.filter((p) => (p.subagrupador || 'Sin partida') === partida)
    .map((p) => filaProducto(p, (materiales.find((m) => m.id === p.material_id) || {}).imagen, true)).join('')}
            </section>`).join('')
    : '<div class="vacio">Todavía no hay ninguna producción especial. Se agrega aquí abajo.</div>'}
        </div>
        <div class="vacio" id="sin-coincidencias" hidden>Nada coincide con el filtro.</div>

        <div class="bloque-form">
          <h3>Agregar una producción especial</h3>
          <div class="campo-par">
            <div class="campo"><label for="pe-nombre">Nombre del producto</label>
              <input id="pe-nombre" placeholder='Ej. 80x70 "GRACIAS" Verde'></div>
            <div class="campo"><label for="pe-partida">Partida</label>
              <input id="pe-partida" list="partidas-especiales" placeholder="Ej. 80x70 GRACIAS">
              <datalist id="partidas-especiales">
                ${subagrupadores.map((x) => `<option value="${esc(x.nombre)}"></option>`).join('')}
              </datalist></div>
          </div>
          <div class="campo-par">
            <div class="campo"><label for="pe-tipo">Tipo de material</label>
              <select id="pe-tipo">${tiposMaterial.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
            <div class="campo"><label for="pe-minimo">Stock mínimo</label>
              <input id="pe-minimo" inputmode="numeric" value="0"></div>
          </div>
          <div class="campo"><label for="pe-desc">Descripción del rollo</label>
            <input id="pe-desc" placeholder="Fondo, impresión, medida: qué tiene de especial"></div>
          <div class="campo"><label for="pe-material">Modelo de muestreo (opcional)</label>
            <select id="pe-material">
              <option value="">No se muestrea</option>
              ${materiales.map((m) => `<option value="${m.id}">${esc(m.modelo)}</option>`).join('')}
            </select></div>
          <div class="fila-botones" style="padding:12px 0 0">
            <button class="btn primario" id="agregar-especial">Agregar producción especial</button>
          </div>
          <small class="nota-campo">El SKU se genera solo. Después se le captura su entrada en Almacén, como a cualquier producto.</small>
        </div>
      </div>`;
  };

  let cuerpo;
  if (familia.especial) {
    cuerpo = cuerpoEspecial();
  } else if (familia.clave === 'proveedores') {
    cuerpo = listaSimple('Proveedores', 'proveedor', proveedores, 'Los que aparecen al abrir una recepción nueva en Calidad.');
  } else if (familia.clave === 'fondos') {
    cuerpo = listaSimple('Colores de fondo', 'fondo', fondos, 'Los que se pueden elegir al agregar un lote en Calidad.');
  } else {
    const suyos = productosDe(familia);
    const tipos = familia.tipos.filter((t) => suyos.some((p) => p.tipo_material === t));
    const grupos = familia.muestreo
      ? [
        ...materialesDe(familia).map((m) => ({ material: m, productos: suyos.filter((p) => p.material_id === m.id) })),
        { material: null, productos: suyos.filter((p) => !p.material_id || !materiales.some((m) => m.id === p.material_id && (m.familia || 'etiquetas') === familia.clave)) },
      ].filter((g) => g.material || g.productos.length)
      : [{ material: null, productos: suyos }];

    cuerpo = `
      <div class="panel">
        <h2>${esc(familia.etiqueta)} <span class="etiqueta azul" id="cuenta-familia">${suyos.length}</span></h2>
        <p class="explica">
          ${familia.muestreo
            ? 'Cada <b>modelo</b> es lo que Calidad muestrea —su especificación y su imagen salen en la hoja de muestreo—; debajo, los <b>productos</b> de Almacén que se muestrean contra él. Un producto sin imagen propia usa la de su modelo.'
            : 'Los productos de Almacén de esta familia. Su imagen aparece en Almacén y, las cajas, al armar una orden de venta directa.'}
        </p>
        ${tipos.length > 1 ? `
          <div class="chips-filtro" style="padding:12px 20px 0">
            <button class="chip-filtro" aria-pressed="${!tipoGuardado}" data-tipo-fam="">Todos · ${suyos.length}</button>
            ${tipos.map((t) => `
              <button class="chip-filtro" aria-pressed="${tipoGuardado === t}" data-tipo-fam="${esc(t)}">
                ${esc(t)} · ${suyos.filter((p) => p.tipo_material === t).length}</button>`).join('')}
          </div>` : ''}
        <div class="filtro-lista"><input type="search" id="buscar-familia"
          placeholder="${familia.muestreo ? 'Buscar modelo, producto o SKU…' : 'Buscar producto, modelo o SKU…'}" autocomplete="off"></div>

        <div class="grupos-material">
          ${grupos.map((g) => g.material ? `
            <section class="grupo-material ${g.material.activo ? '' : 'inactiva'}" data-grupo
                     data-texto="${esc(g.material.modelo.toLowerCase())}">
              <header>
                ${bloqueImagen('materiales', g.material)}
                <span class="que"><b>${esc(g.material.modelo)}</b>
                  <small>${esc(resumenEspec(g.material) || 'Sin especificación capturada')}</small></span>
                <span class="etiqueta ${g.material.activo ? 'verde' : ''}">${g.material.activo ? 'Se muestrea' : 'Retirado'}</span>
                <button class="btn" data-espec="${g.material.id}">Especificación</button>
                ${g.productos.length ? `<button class="btn ver-productos" data-abrir>${g.productos.length} producto(s) <span class="flecha-grupo">▾</span></button>` : ''}
              </header>
              ${g.productos.map((p) => filaProducto(p, g.material.imagen)).join('')
                || '<p class="sin-productos">Ningún producto de Almacén se muestrea contra este modelo.</p>'}
            </section>` : `
            <section class="grupo-material" data-grupo data-texto="">
              ${familia.muestreo ? `<header><span class="que"><b>Sin modelo de muestreo</b>
                <small>Productos que Calidad no muestrea</small></span>
                <button class="btn ver-productos" data-abrir>${g.productos.length} producto(s) <span class="flecha-grupo">▾</span></button></header>` : ''}
              ${g.productos.map((p) => filaProducto(p)).join('')}
            </section>`).join('')}
        </div>
        <div class="vacio" id="sin-coincidencias" hidden>Nada coincide con el filtro.</div>

        ${familia.muestreo ? `
          <div class="bloque-form">
            <h3>Agregar un modelo de muestreo a ${esc(familia.etiqueta)}</h3>
            <div class="campos-linea">
              <div class="campo" style="flex:1"><label for="m-modelo">Modelo</label>
                <input id="m-modelo" placeholder="${familia.clave === 'rollos' ? 'Ej. 57X50' : 'Ej. 45X25'}"></div>
              <button class="btn primario" id="agregar-material">Agregar</button>
            </div>
            <small class="nota-campo">Después, en su botón «Especificación», se captura lo demás.</small>
          </div>` : ''}
      </div>`;
  }

  destino.innerHTML = `
    <div class="chips-filtro" role="tablist">
      ${familias.map((f) => `
        <button class="chip-filtro" role="tab" aria-pressed="${f.clave === familia.clave}" data-familia="${f.clave}">
          ${esc(f.etiqueta)} · ${cuantos(f)}</button>`).join('')}
    </div>
    ${cuerpo}`;

  conectarImagenesCatalogo(destino);

  destino.querySelectorAll('[data-familia]').forEach((b) => b.addEventListener('click', () => {
    sessionStorage.setItem('config.materiales.familia', b.dataset.familia);
    configMateriales(destino).catch((err) => mostrarMensaje(err.message, 'error'));
  }));

  // Filtro: por tipo y por texto a la vez. Un grupo se esconde si no le queda
  // ningún producto visible y su modelo tampoco coincide con lo buscado.
  let tipoActual = tipoGuardado;
  const buscador = document.getElementById('buscar-familia');
  // En Rollos y Etiquetas cada modelo aparece cerrado —solo su encabezado y
  // cuántos productos tiene— y se abre al tocarlo o al buscar. En las demás
  // familias no hay modelos: la lista va abierta.
  const abiertos = new Set();
  destino.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => {
    const g = b.closest('[data-grupo]');
    const i = [...destino.querySelectorAll('[data-grupo]')].indexOf(g);
    if (abiertos.has(i)) abiertos.delete(i); else abiertos.add(i);
    filtrar();
  }));
  const filtrar = () => {
    const texto = ((buscador && buscador.value) || '').trim().toLowerCase();
    let visibles = 0;
    destino.querySelectorAll('[data-grupo]').forEach((g, i) => {
      const modeloCoincide = !!texto && (g.dataset.texto || '').includes(texto);
      const abierto = !familia.muestreo || !!texto || abiertos.has(i);
      g.classList.toggle('abierto', abierto);
      let enGrupo = 0;
      g.querySelectorAll('.fila-producto').forEach((f) => {
        const ok = (!tipoActual || f.dataset.tipo === tipoActual)
          && (!texto || modeloCoincide || f.dataset.texto.includes(texto));
        f.hidden = !ok || !abierto;
        if (ok) enGrupo += 1;
      });
      visibles += enGrupo;
      const sinProductos = !g.querySelector('.fila-producto');
      g.hidden = !(enGrupo || (modeloCoincide) || (sinProductos && !texto && !tipoActual && g.dataset.texto));
    });
    const cuenta = document.getElementById('cuenta-familia');
    if (cuenta) cuenta.textContent = visibles;
    const vacio = document.getElementById('sin-coincidencias');
    if (vacio) vacio.hidden = !!destino.querySelector('[data-grupo]:not([hidden])');
  };
  if (buscador) buscador.addEventListener('input', filtrar);
  destino.querySelectorAll('[data-tipo-fam]').forEach((b) => b.addEventListener('click', () => {
    tipoActual = b.dataset.tipoFam;
    sessionStorage.setItem(`config.materiales.tipo.${familia.clave}`, tipoActual);
    destino.querySelectorAll('[data-tipo-fam]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    filtrar();
  }));
  filtrar();

  // La especificación de un modelo, en una ventana con un solo botón de guardar.
  destino.querySelectorAll('[data-espec]').forEach((b) => b.addEventListener('click', () => {
    const mat = materiales.find((x) => x.id === Number(b.dataset.espec));
    const capa = document.createElement('div');
    capa.className = 'modal';
    capa.innerHTML = `
      <div class="caja-modal" role="dialog" aria-label="Especificación">
        <h2>Especificación · ${esc(mat.modelo)}</h2>
        <div class="cuerpo-modal">
          <div id="error-modal"></div>
          <p class="explica" style="padding:0 0 12px">Lo que se llena solo en la hoja de muestreo de Calidad.</p>
          <div class="rejilla-campos">
            ${COLUMNAS_MATERIAL.map(([c, e]) => `
              <div class="campo"><label for="esp-${c}">${e}</label><input id="esp-${c}" value="${esc(mat[c] || '')}"></div>`).join('')}
          </div>
          <label class="casilla-texto"><input type="checkbox" id="esp-activo" ${mat.activo ? 'checked' : ''}>
            Se muestrea (desmarcado, deja de salir en la tablet sin borrar los muestreos que ya lo mencionan)</label>
        </div>
        <div class="pie-modal">
          <button class="btn peligro" data-borrar style="margin-right:auto">Borrar modelo</button>
          <button class="btn" data-cerrar>Cancelar</button>
          <button class="btn primario" data-guardar>Guardar cambios</button>
        </div>
      </div>`;
    document.body.appendChild(capa);
    const cerrar = () => capa.remove();
    capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
    capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
    capa.querySelector('[data-borrar]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar el modelo ${mat.modelo}? Sus productos se quedan en Almacén, sin modelo de muestreo.`)) return;
      try {
        await api('DELETE', `/api/admin/materiales/${mat.id}`);
        cerrar();
        mostrarMensaje(`Modelo ${mat.modelo} borrado.`, 'exito');
        configMateriales(destino);
      } catch (err) { capa.querySelector('#error-modal').innerHTML = avisoError(err.message); }
    });
    capa.querySelector('[data-guardar]').addEventListener('click', async () => {
      const datos = { activo: capa.querySelector('#esp-activo').checked };
      for (const [c] of COLUMNAS_MATERIAL) datos[c] = capa.querySelector(`#esp-${c}`).value;
      try {
        await api('PUT', `/api/admin/materiales/${mat.id}`, datos);
        cerrar();
        mostrarMensaje(`Especificación de ${mat.modelo} guardada.`, 'exito');
        configMateriales(destino);
      } catch (err) { capa.querySelector('#error-modal').innerHTML = avisoError(err.message); }
    });
  }));

  destino.querySelectorAll('[data-editar-producto]').forEach((b) => b.addEventListener('click', () => {
    const pr = productos.find((x) => x.id === Number(b.dataset.editarProducto));
    const capa = document.createElement('div');
    capa.className = 'modal';
    capa.innerHTML = `
      <div class="caja-modal" role="dialog" aria-label="Producto">
        <h2>${esc(pr.nombre)}</h2>
        <div class="cuerpo-modal">
          <div id="error-modal"></div>
          <p class="explica" style="padding:0 0 12px">${esc(pr.tipo_material)} · modelo ${esc(pr.modelo || '—')} · ${esc(pr.sku)}</p>
          <div class="campo"><label for="pr-nombre">Nombre</label><input id="pr-nombre" value="${esc(pr.nombre)}"></div>
          <div class="campo"><label for="pr-minimo">Stock mínimo</label><input id="pr-minimo" inputmode="numeric" value="${esc(pr.stock_minimo || 0)}"></div>
          <label class="casilla-texto"><input type="checkbox" id="pr-especial" ${pr.especial ? 'checked' : ''}>
            Es producción especial (sale del catálogo de siempre y se va a su partida)</label>
          <div class="campo"><label for="pr-partida">Partida</label>
            <input id="pr-partida" list="partidas-modal" value="${esc(pr.subagrupador || '')}"
                   placeholder="Ej. 80x70 GRACIAS">
            <datalist id="partidas-modal">
              ${subagrupadores.map((x) => `<option value="${esc(x.nombre)}"></option>`).join('')}
            </datalist></div>
          <div class="campo"><label for="pr-desc">Descripción del rollo</label>
            <input id="pr-desc" value="${esc(pr.descripcion || '')}"
                   placeholder="Fondo, impresión, medida: qué tiene de especial"></div>
          <label class="casilla-texto"><input type="checkbox" id="pr-activo" ${pr.activo ? 'checked' : ''}>
            En uso (desmarcado deja de ofrecerse en Almacén y en las órdenes; su historia se queda)</label>
          <small class="nota-campo">El modelo y el SKU no se cambian aquí: con ellos se traduce la ODT.</small>
        </div>
        <div class="pie-modal">
          <button class="btn peligro" data-borrar style="margin-right:auto">Borrar producto</button>
          <button class="btn" data-cerrar>Cancelar</button>
          <button class="btn primario" data-guardar>Guardar cambios</button>
        </div>
      </div>`;
    document.body.appendChild(capa);
    const cerrar = () => capa.remove();
    const error = (m) => { capa.querySelector('#error-modal').innerHTML = avisoError(m); };
    capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
    capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
    capa.querySelector('[data-borrar]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar ${pr.nombre}? Solo se puede si nunca se ha usado.`)) return;
      try {
        await api('DELETE', `/api/admin/productos/${pr.id}`);
        cerrar();
        estado.catalogos_almacen = null;
        mostrarMensaje(`${pr.nombre} borrado.`, 'exito');
        configMateriales(destino);
      } catch (err) { error(err.message); }
    });
    capa.querySelector('[data-guardar]').addEventListener('click', async () => {
      try {
        await api('PUT', `/api/admin/productos/${pr.id}`, {
          nombre: capa.querySelector('#pr-nombre').value,
          stock_minimo: capa.querySelector('#pr-minimo').value,
          activo: capa.querySelector('#pr-activo').checked,
          especial: capa.querySelector('#pr-especial').checked,
          subagrupador: capa.querySelector('#pr-partida').value,
          descripcion: capa.querySelector('#pr-desc').value,
        });
        cerrar();
        estado.catalogos_almacen = null;
        mostrarMensaje('Producto guardado.', 'exito');
        configMateriales(destino);
      } catch (err) { error(err.message); }
    });
  }));

  destino.querySelectorAll('[data-mover-producto]').forEach((b) => b.addEventListener('click', async () => {
    const [id, hacia] = b.dataset.moverProducto.split('|');
    try {
      await api('POST', `/api/admin/productos/${id}/mover`, { hacia });
      estado.catalogos_almacen = null;
      configMateriales(destino);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));

  const agregarEspecial = document.getElementById('agregar-especial');
  if (agregarEspecial) agregarEspecial.addEventListener('click', async () => {
    const v = (id) => document.getElementById(id).value;
    try {
      const r = await api('POST', '/api/admin/productos', {
        nombre: v('pe-nombre'),
        subagrupador: v('pe-partida'),
        tipo_material: v('pe-tipo'),
        descripcion: v('pe-desc'),
        stock_minimo: v('pe-minimo'),
        material_id: v('pe-material') || null,
        especial: true,
      });
      estado.catalogos_almacen = null;
      mostrarMensaje(r.mensaje, 'exito');
      configMateriales(destino);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  const agregar = document.getElementById('agregar-material');
  if (agregar) agregar.addEventListener('click', async () => {
    const modelo = document.getElementById('m-modelo').value.trim();
    if (!modelo) return mostrarMensaje('Escribe el modelo.', 'error');
    try {
      await api('POST', '/api/admin/materiales', { modelo, familia: familia.clave });
      mostrarMensaje(`Modelo ${modelo} agregado. Captura su especificación.`, 'exito');
      configMateriales(destino);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  destino.querySelectorAll('[data-agregar-catalogo]').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const tipo = boton.dataset.agregarCatalogo;
      const campo = document.getElementById(`nuevo-${tipo}`);
      if (!campo.value.trim()) return mostrarMensaje('Escribe el nombre.', 'error');
      try {
        await api('POST', '/api/admin/catalogo-calidad', { tipo, valor: campo.value.trim() });
        configMateriales(destino);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });

  destino.querySelectorAll('[data-catalogo]').forEach((casilla) => {
    casilla.addEventListener('change', async () => {
      try {
        await api('PUT', `/api/admin/catalogo-calidad/${casilla.dataset.catalogo}`, { activo: casilla.checked });
      } catch (err) { mostrarMensaje(err.message, 'error'); casilla.checked = !casilla.checked; }
    });
  });
}

function editarPersona(persona, roles, acceso) {
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
          <label for="e-rol">Puesto</label>
          <select id="e-rol">
            ${roles.filter((r) => r.activo || r.clave === persona.rol).map((r) => `<option value="${esc(r.clave)}" ${r.clave === persona.rol ? 'selected' : ''}>
              ${esc(r.etiqueta)}${r.descripcion ? ` — ${esc(r.descripcion)}` : ''}</option>`).join('')}
          </select>
          <small id="e-nota-rol" style="color:var(--tinta-suave)"></small>
        </div>

        <div class="campo">
          <label for="e-pin">Clave</label>
          <input id="e-pin" maxlength="12" autocomplete="off"
                 placeholder="${persona.tiene_pin ? 'Tiene clave. Escribe una nueva para cambiarla' : 'Sin clave. Escribe una para asignársela'}">
          <small style="color:var(--tinta-suave)">
            Déjala vacía para no tocarla. De 4 a 12 letras o números, sin espacios.
            Nadie más puede tener la misma.
          </small>
          ${persona.tiene_pin && acceso.modo !== 'clave' ? `
            <label class="casilla-texto">
              <input type="checkbox" id="e-quitar-pin"> Quitar la clave (entrará solo tocando su nombre)
            </label>` : ''}
          ${persona.tiene_pin && acceso.modo === 'clave' ? `
            <small style="color:var(--tinta-suave)">
              No se puede quitar: es con lo que entra al sistema. Para que deje de
              entrar, dale de baja abajo.
            </small>` : ''}
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
              ? `Desmárcalo cuando alguien deje la empresa. No se borra: conserva sus ${persona.llenados} llenado(s) y ${persona.firmas} firma(s), y su clave deja de servir para entrar.`
              : 'Desmárcalo cuando alguien deje la empresa. Su clave dejará de servir para entrar.'}
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
    notaRol.textContent = r && r.exige_pin ? 'Ve información de toda la operación: necesita clave.' : '';
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
// ============================================================ vista: calidad

// Muestreo del material que llega de proveedor. Viene de MUESTREO_GUIADO.xlsx:
// una recepción por remisión y un renglón por lote.
//
// La captura de Calidad comparte clases de estilo con la de los checklists pero
// no su lógica, así que todo cuelga de un contenedor con clase
// 'captura-calidad'. conectarCaptura() se sale al verlo, y aquí se conectan los
// manejadores propios. Sin esa frontera, un toque en un lote mandaría respuestas
// al checklist que estuviera abierto.

const ETIQUETA_RECEPCION = {
  borrador: ['ambar', 'En captura'],
  cancelada: ['roja', 'Anulada'],
  cerrado: ['azul', 'Sin visto bueno'],
  aprobado: ['verde', 'Aprobada'],
};

// toISOString() da la fecha en UTC: a las 7 de la tarde en México ya sería el
// día siguiente. Se corre el desfase para que el valor por omisión sea hoy.
const hoyLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const fechaCorta = (iso) => (iso || '').split('-').reverse().join('/');

async function catalogosCalidad() {
  if (!estado.catalogos_calidad) estado.catalogos_calidad = await api('GET', '/api/calidad/catalogos');
  return estado.catalogos_calidad;
}

async function vistaCalidad() {
  encabezado('Calidad', 'Muestreo, re-ingreso de retiros y bajas por daño');
  const { recepciones, pendientes } = await api('GET', '/api/calidad/recepciones');
  // Lo que Calidad hace además de muestrear: re-ingresar los retiros que llegan
  // a bodega y pedir la baja del material que se dañó estando guardado.
  const reingresos = ['reingresos_capturar', 'reingresos_aprobar'].some(permiso)
    ? await api('GET', '/api/almacen/reingresos') : null;
  const salidas = ['calidad_salida_pedir', 'calidad_salida_aprobar'].some(permiso)
    ? await api('GET', '/api/almacen/salidas-calidad') : null;
  // Lo que regresó de una venta directa y está esperando revisión.
  const devoluciones = await api('GET', '/api/calidad/devoluciones')
    .then((d) => ({ porRevisar: d.devoluciones.filter((x) => x.estado === 'en_calidad').length }))
    .catch(() => null);

  const abiertas = recepciones.filter((r) => r.estado === 'borrador');
  const sinVistoBueno = recepciones.filter((r) => r.estado === 'cerrado');
  const aprobadas = recepciones.filter((r) => r.estado === 'aprobado');

  const tarjeta = (r) => {
    // Lo que viene de una entrada de almacén aprobada es «pendiente de revisar».
    const [color, texto] = r.estado === 'borrador' && r.entrada_id
      ? ['ambar', 'Pendiente de revisar'] : (ETIQUETA_RECEPCION[r.estado] || ['', r.estado]);
    return `
      <button class="tarea ${r.estado}" data-recepcion="${r.id}">
        <span class="etiqueta ${color}">${texto}</span>
        <b>Remisión ${esc(r.remision)}</b>
        <span class="meta">${esc(r.proveedor)} · llegó ${fechaCorta(r.fecha_llegada)}</span>
        <span class="meta">${r.lotes} lote(s)${r.sin_muestreo ? ` · ${r.sin_muestreo} sin muestreo` : ''}${r.rechazados ? ` · ${r.rechazados} rechazado(s)` : ''} · ${esc(r.capturo)}</span>
      </button>`;
  };

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-menu>← Menú</button><span>/</span><span>Calidad</span>
    </div>
    <div id="mensajes"></div>

    ${pendientes ? `
      <button class="aviso pendientes" data-ir-pendientes>
        <span class="cuenta">${pendientes}</span>
        <span><b>Pendiente(s) de aprobación.</b>
          <small>Recepciones sin visto bueno o rechazos sin decidir.</small></span>
        <span class="flecha" aria-hidden="true">›</span>
      </button>` : ''}

    ${permiso('calidad_capturar') ? `
      <div class="fila-botones" style="margin-bottom:18px">
        <button class="btn primario grande" id="nueva-recepcion">+ Nueva recepción</button>
      </div>` : ''}

    ${reingresos || salidas ? `
      <div class="rejilla-tareas">
        <button class="tarea" data-ir-hash="#/calidad/devoluciones">
          <b>Devolución de ventas directas${devoluciones && devoluciones.porRevisar
            ? ` <span class="etiqueta ambar">${devoluciones.porRevisar}</span>` : ''}</b>
          <span class="meta">
            Material que devolvió un cliente. Se revisa aquí antes de que Almacén
            pida su entrada: solo lo que llegó bien vuelve al inventario.
          </span>
        </button>
        ${reingresos ? `
          <button class="tarea" data-ir-hash="#/calidad/reingresos">
            <b>Re-ingresos de retiro${(() => {
              const n = reingresos.retiros.length
                + reingresos.reingresos.filter((g) => ['borrador', 'por_autorizar'].includes(g.estado)).length;
              return n ? ` <span class="etiqueta ambar">${n}</span>` : '';
            })()}</b>
            <span class="meta">
              ${reingresos.retiros.length} retiro(s) pendiente(s) de recibir. Lo que llega a
              bodega se re-ingresa aquí: cuántas cajas y qué trae cada una.
            </span>
          </button>` : ''}
        ${salidas ? `
          <button class="tarea" data-ir-hash="#/calidad/salidas">
            <b>Salidas por calidad${(() => {
              const n = salidas.salidas.filter((x) => ['borrador', 'por_autorizar'].includes(x.estado)).length;
              return n ? ` <span class="etiqueta ambar">${n}</span>` : '';
            })()}</b>
            <span class="meta">
              Material que se dañó estando en bodega. Se explica qué pasó, se sube la
              evidencia y otra persona aprueba la baja.
            </span>
          </button>` : ''}
      </div>` : ''}

    <section class="panel">
      <h2>Pendientes de revisar ${abiertas.length ? `<span class="etiqueta ambar">${abiertas.length}</span>` : ''}</h2>
      ${abiertas.length
        ? `<div class="rejilla-tareas" style="padding:18px">${abiertas.map(tarjeta).join('')}</div>`
        : '<div class="vacio">No hay nada pendiente de revisar.</div>'}
    </section>

    ${sinVistoBueno.length ? `
      <section class="panel">
        <h2>Esperando visto bueno <span class="etiqueta azul">${sinVistoBueno.length}</span></h2>
        <div class="rejilla-tareas" style="padding:18px">${sinVistoBueno.map(tarjeta).join('')}</div>
      </section>` : ''}

    ${aprobadas.length ? `
      <section class="panel">
        <h2>Aprobadas <span class="etiqueta verde">${aprobadas.length}</span></h2>
        <div class="rejilla-tareas" style="padding:18px">${aprobadas.map(tarjeta).join('')}</div>
      </section>` : ''}`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  const irPendientes = vista.querySelector('[data-ir-pendientes]');
  if (irPendientes) irPendientes.addEventListener('click', () => { location.hash = '#/calidad/pendientes'; });
  const nueva = document.getElementById('nueva-recepcion');
  if (nueva) nueva.addEventListener('click', abrirNuevaRecepcion);
  vista.querySelectorAll('[data-recepcion]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/recepcion/${b.dataset.recepcion}`; });
  });
}

// Remisión, proveedor y fecha se piden ANTES de capturar lotes: son lo que
// identifica al camión, igual que el número de envío en Tránsito.
async function abrirNuevaRecepcion() {
  const { proveedores } = await catalogosCalidad();

  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Nueva recepción">
      <h2>Nueva recepción</h2>
      <div class="cuerpo-modal">
        <div id="error-recepcion"></div>
        <div class="campo">
          <label for="r-proveedor">Proveedor</label>
          <select id="r-proveedor">
            <option value="">Elige uno…</option>
            ${proveedores.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="r-remision"># Remisión</label>
          <input id="r-remision" autocomplete="off" placeholder="Ej. 4821">
        </div>
        <div class="campo">
          <label for="r-fecha">Fecha de llegada</label>
          <input id="r-fecha" type="date" value="${hoyLocal()}">
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-comenzar>Comenzar muestreo</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const cerrar = () => { capa.remove(); document.removeEventListener('keydown', alPresionar); };
  const alPresionar = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', alPresionar);
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  capa.querySelector('[data-comenzar]').addEventListener('click', async () => {
    const cuerpo = {
      proveedor: capa.querySelector('#r-proveedor').value,
      remision: capa.querySelector('#r-remision').value.trim(),
      fecha_llegada: capa.querySelector('#r-fecha').value,
    };
    if (!cuerpo.proveedor || !cuerpo.remision || !cuerpo.fecha_llegada) {
      capa.querySelector('#error-recepcion').innerHTML = avisoError('Falta proveedor, remisión o fecha.');
      return;
    }
    try {
      const { id } = await api('POST', '/api/calidad/recepciones', cuerpo);
      cerrar();
      location.hash = `#/recepcion/${id}`;
    } catch (err) {
      capa.querySelector('#error-recepcion').innerHTML = avisoError(err.message);
    }
  });

  capa.querySelector('#r-proveedor').focus();
}

// --- re-ingreso de los retiros que llegan a bodega ---
//
// Un retiro de plataforma llega a la bodega por partes. Calidad escoge a qué
// retiro pendiente de recibir se le asigna lo que llegó, dice cuántas cajas
// trae la entrega y detalla caja por caja qué producto y cuánto verificó
// dentro. Eso es lo que entra al inventario cuando otra persona lo aprueba: no
// lo que decía el retiro, sino lo que se contó al abrir las cajas.

async function vistaCalidadReingresos() {
  encabezado('Re-ingresos de retiro', 'Lo que llega de Mercado Libre Full y Amazon FBA');
  const { reingresos, retiros } = await api('GET', '/api/almacen/reingresos');

  const abiertos = reingresos.filter((g) => g.estado === 'borrador');
  const esperando = reingresos.filter((g) => g.estado === 'por_autorizar');
  const cerrados = reingresos.filter((g) => ['aplicado', 'cancelado'].includes(g.estado));

  const tarjeta = (g) => `
    <button class="tarea ${g.estado === 'por_autorizar' ? 'por_autorizar' : g.estado}" data-reingreso="${g.id}">
      ${g.estado === 'borrador' && g.correccion_nota
        ? '<span class="etiqueta roja">Por corregir</span>' : insigniaDocumento(g.estado)}
      <b>${esc(g.folio)} · retiro ${esc(g.retiro_folio)}</b>
      <span class="meta">${esc(g.plataforma)} → ${esc(g.bodega)} · ${fechaCorta(g.fecha)}</span>
      <span class="meta">${g.cajas} caja(s) · ${numero(g.unidades)} unidad(es) · recibió ${esc(g.capturo)}</span>
    </button>`;

  const bloque = (titulo, lista, color) => (lista.length ? `
    <section class="panel">
      <h2>${titulo} <span class="etiqueta ${color}">${lista.length}</span></h2>
      <div class="rejilla-tareas" style="padding:18px">${lista.map(tarjeta).join('')}</div>
    </section>` : '');

  vista.innerHTML = `
    ${migajaModulo('Calidad', '#/calidad', 'Re-ingresos de retiro')}
    <div id="mensajes"></div>
    <p class="explica" style="padding-left:0">
      Al llegar el material de un retiro se levanta aquí su re-ingreso. Solo entra
      al inventario lo que se verificó caja por caja, y solo cuando otra persona
      con permiso lo aprueba.
    </p>

    <section class="panel">
      <h2>Retiros pendientes de recibir <span class="etiqueta ${retiros.length ? 'ambar' : 'verde'}">${retiros.length}</span></h2>
      ${retiros.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Retiro</th><th>Plataforma</th><th>Bodega</th>
            <th>Pedido</th><th>Recibido</th><th>Falta</th><th>En proceso</th>
            ${permiso('reingresos_capturar') ? '<th></th>' : ''}</tr></thead>
          <tbody>${retiros.map((r) => `
            <tr>
              <td class="fila-titulo">${esc(r.folio)}<br><small style="color:var(--tinta-suave)">${fechaCorta(r.fecha)}</small></td>
              <td>${esc(r.plataforma)}</td>
              <td>${esc(r.bodega)}</td>
              <td>${numero(r.pedido)}</td>
              <td>${numero(r.recibido)}</td>
              <td><b class="${r.por_recibir ? 'fuera-odt' : ''}">${numero(r.por_recibir)}</b></td>
              <td>${r.abiertos ? `<span class="etiqueta azul">${r.abiertos}</span>` : '—'}</td>
              ${permiso('reingresos_capturar')
                ? `<td><button class="btn primario" data-recibir="${r.id}">Llegó material</button></td>` : ''}
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">No hay retiros esperando material.</div>'}
    </section>

    ${bloque('En captura', abiertos, 'ambar')}
    ${bloque('Esperando aprobación', esperando, 'azul')}
    ${bloque('Cerrados', cerrados, 'verde')}`;

  vista.querySelectorAll('[data-reingreso]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/calidad/reingreso/${b.dataset.reingreso}`; });
  });
  vista.querySelectorAll('[data-recibir]').forEach((b) => {
    b.addEventListener('click', () => abrirNuevoReingreso(retiros.find((r) => r.id === Number(b.dataset.recibir))));
  });
}

// Cuántas cajas llegaron se pregunta ANTES de detallarlas: es el número contra
// el que se coteja el detalle, y cambiarlo a media captura sería cambiar la
// pregunta después de contestarla.
async function abrirNuevoReingreso(retiro) {
  if (!retiro) return;
  const cat = await catalogosAlmacen();

  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Re-ingreso de retiro">
      <h2>Llegó material del retiro ${esc(retiro.folio)}</h2>
      <div class="cuerpo-modal">
        <div id="error-reingreso"></div>
        <p class="explica" style="padding-left:0">
          ${esc(retiro.plataforma)} · faltan ${numero(retiro.por_recibir)} de ${numero(retiro.pedido)} unidad(es).
        </p>
        <div class="campo">
          <label for="g-bodega">¿A qué bodega llegó?</label>
          <select id="g-bodega">
            ${cat.bodegas.map((b) => `
              <option value="${b.id}"${b.id === retiro.bodega_id ? ' selected' : ''}>${esc(b.nombre)} (${esc(b.clave)})</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="g-cajas">¿Cuántas cajas se reciben en esta entrega?</label>
          <input type="number" id="g-cajas" min="1" step="1" value="1">
        </div>
        <div class="campo">
          <label for="g-fecha">Fecha de llegada</label>
          <input type="date" id="g-fecha" value="${hoyLocal()}">
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-crear-reingreso>Empezar el detalle</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  capa.querySelector('[data-crear-reingreso]').addEventListener('click', async () => {
    const boton = capa.querySelector('[data-crear-reingreso]');
    boton.disabled = true;
    try {
      const { reingreso } = await api('POST', '/api/almacen/reingresos', {
        entrada_id: retiro.id,
        bodega_id: Number(capa.querySelector('#g-bodega').value),
        cajas: Number(capa.querySelector('#g-cajas').value),
        fecha: capa.querySelector('#g-fecha').value,
      });
      cerrar();
      location.hash = `#/calidad/reingreso/${reingreso.id}`;
    } catch (err) {
      capa.querySelector('#error-reingreso').innerHTML = avisoError(err.message);
      boton.disabled = false;
    }
  });
}

async function vistaCalidadReingreso(id) {
  const { reingreso: g, faltantes } = await api('GET', `/api/almacen/reingresos/${id}`);
  estado.reingreso = g;
  const cat = await catalogosAlmacen();
  const editable = g.estado === 'borrador' && permiso('reingresos_capturar');
  const suyo = g.usuario_id === estado.usuario.id;
  const esAdmin = estado.usuario.rol === 'admin';

  encabezado(`Re-ingreso ${g.folio}`,
    `Retiro ${g.retiro_folio} · ${g.plataforma} · llega a ${g.bodega} · ${fechaCorta(g.fecha)}`);
  const conexionesReingreso = tiraConexiones([liga(`#/almacen/retiro/${g.entrada_id}`, `Retiro ${g.retiro_folio}`)]);

  const banda = g.estado === 'borrador' && g.correccion_nota
    ? `<div class="aviso error"><span><b>Regresado para corregir.</b>
        <small>${esc(g.pidio_correccion || 'Alguien con permiso')}: «${esc(g.correccion_nota)}».</small></span></div>`
    : g.estado === 'por_autorizar'
      ? '<div class="aviso">Enviado. El material entra al inventario cuando otra persona con permiso lo apruebe.</div>'
      : g.estado === 'aplicado'
        ? `<div class="aviso exito">Aprobado${g.aprobo ? ` por ${esc(g.aprobo)}` : ''}: ${numero(g.unidades)} unidad(es) entraron a ${esc(g.bodega)}.</div>`
        : g.estado === 'cancelado' ? '<div class="aviso error">Re-ingreso cancelado.</div>' : '';

  const botones = [];
  if (editable) botones.push('<button class="btn primario grande" data-gaccion="enviar">Enviar a aprobación</button>');
  if (g.estado === 'por_autorizar' && permiso('reingresos_aprobar')) {
    botones.push(esAdmin || !suyo
      ? '<button class="btn primario grande" data-gaccion="aprobar">Aprobar y sumar al inventario</button>'
      : '<span class="nota-mando">Tú lo recibiste: lo aprueba otra persona</span>');
  }
  if (['por_autorizar', 'aplicado'].includes(g.estado) && permiso('reingresos_aprobar')) {
    botones.push(`<button class="btn" data-gaccion="corregir">${
      g.estado === 'aplicado' ? 'Pedir corrección (sale del inventario)' : 'Regresar para corregir'}</button>`);
  }
  if (g.estado !== 'cancelado' && (permiso('reingresos_aprobar') || editable)) {
    botones.push('<button class="btn peligro" data-gaccion="cancelar">Cancelar el re-ingreso</button>');
  }

  // Un renglón por caja. El número de caja se repite cuando una caja trae dos
  // productos, que pasa y hay que poder anotarlo.
  vista.innerHTML = `
    ${migajaModulo('Calidad', '#/calidad', 'Re-ingresos de retiro', '#/calidad/reingresos', g.folio)}
    <div id="mensajes"></div>
    ${conexionesReingreso}
    ${banda}

    <section class="panel">
      <h2>Detalle de las cajas ${insigniaDocumento(g.estado)}
        <span class="etiqueta ${g.cajas_detalladas === g.cajas ? 'verde' : 'ambar'}">${g.cajas_detalladas} de ${g.cajas}</span></h2>
      <p class="explica">
        Llegaron <b>${g.cajas}</b> caja(s). Abre cada una y anota qué productos trae y
        cuánto verificaste de cada uno —una caja puede traer varios productos—: eso es
        lo que va a entrar al inventario.
      </p>
      <datalist id="lista-productos-reingreso">
        ${cat.productos.map((x) => `<option value="${esc(x.nombre)}">${esc(x.sku)}</option>`).join('')}
      </datalist>
      <div class="cajas-reingreso">
        ${Array.from({ length: Math.max(g.cajas, ...g.cajas_detalle.map((c) => c.numero), 0) }, (_, i) => i + 1).map((n) => {
          const dentro = g.cajas_detalle.filter((c) => c.numero === n);
          const sobra = n > g.cajas;
          return `
            <article class="caja-reingreso ${dentro.length ? '' : 'vacia'} ${sobra ? 'sobra' : ''}">
              <header>
                <b>Caja ${n}</b>
                ${sobra ? '<span class="etiqueta roja">Dijiste que eran menos cajas</span>'
                  : dentro.length ? `<span class="etiqueta verde">${dentro.length} producto(s) · ${numero(dentro.reduce((t, c) => t + c.cantidad, 0))} pzas</span>`
                    : '<span class="etiqueta ambar">Sin detallar</span>'}
              </header>
              ${dentro.length ? `
                <table class="captura">
                  <thead><tr><th class="fila-titulo">Producto</th><th>Verificado</th>
                    <th>Pedía el retiro</th><th>Observación</th>${editable ? '<th></th>' : ''}</tr></thead>
                  <tbody>${dentro.map((c) => `
                    <tr>
                      <td class="fila-titulo">${fotoProducto({ id: c.producto_id, sku: c.sku })}${esc(c.producto)}<br><small style="color:var(--tinta-suave)">${esc(c.sku)}</small>
                        ${c.en_el_retiro ? '' : ' <span class="etiqueta ambar">No venía en el retiro</span>'}</td>
                      <td>${editable
                        ? `<input type="number" min="0" step="1" value="${c.cantidad || ''}" data-caja-cantidad="${c.id}">`
                        : `<b>${numero(c.cantidad)}</b>`}</td>
                      <td>${numero(c.pedido)}${c.ya_recibido ? ` <small>(ya ${numero(c.ya_recibido)})</small>` : ''}</td>
                      <td>${editable
                        ? `<input type="text" value="${esc(c.observacion || '')}" data-caja-observacion="${c.id}" placeholder="Opcional">`
                        : esc(c.observacion || '—')}</td>
                      ${editable ? `<td><button class="btn peligro" data-quitar-caja="${c.id}" title="Quitar">×</button></td>` : ''}
                    </tr>`).join('')}
                  </tbody>
                </table>` : ''}
              ${editable && !sobra ? `
                <div class="agregar-renglon" data-agregar-en-caja="${n}">
                  <input type="search" list="lista-productos-reingreso" data-caja-producto
                         placeholder="${dentro.length ? 'Otro producto dentro de esta caja…' : 'Producto que trae la caja…'}">
                  <input type="number" min="0" step="1" data-caja-cantidad-nueva placeholder="Cantidad verificada">
                  <button class="btn primario" data-agregar-producto-caja>Agregar a la caja ${n}</button>
                </div>` : ''}
            </article>`;
        }).join('')}
      </div>
      ${editable ? `
        <div class="fila-botones" style="padding:0 18px 12px">
          <button class="btn" id="otra-caja">+ Llegó una caja más</button>
        </div>` : ''}

      <div class="pie"><span class="resumen">
        ${g.productos.length} producto(s) · ${numero(g.unidades)} unidad(es) en total.
      </span></div>
    </section>

    ${g.productos.length ? `
      <section class="panel">
        <h2>Lo que va a entrar al inventario</h2>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Producto</th><th>Cajas</th><th>Unidades</th>
            <th>Pedía el retiro</th><th>De más</th></tr></thead>
          <tbody>${g.productos.map((f) => `
            <tr>
              <td class="fila-titulo">${fotoProducto({ id: f.producto_id, sku: f.sku, nombre: f.producto })}${esc(f.producto)}</td>
              <td>${f.cajas}</td>
              <td><b>${numero(f.cantidad)}</b></td>
              <td>${numero(f.pedido)}${f.ya_recibido ? ` <small>(ya ${numero(f.ya_recibido)})</small>` : ''}</td>
              <td>${f.de_mas ? `<span class="etiqueta ambar">+${numero(f.de_mas)}</span>` : '—'}</td>
            </tr>`).join('')}
          </tbody></table></div>
      </section>` : ''}

    ${botones.length ? `
      <div class="acciones-almacen">
        ${faltantes.length && editable
          ? `<div class="aviso">Falta antes de poder enviarlo:<br><small>${esc(faltantes.join(' '))}</small></div>` : ''}
        <div class="fila-botones">${botones.join('')}</div>
      </div>` : ''}
    ${historialCorrecciones(g.correcciones)}`;

  conectarReingreso(g, cat);
}

let temporizadorCaja = null;

function conectarReingreso(g, cat) {
  const guardar = (id, cambios) => {
    clearTimeout(temporizadorCaja);
    temporizadorCaja = setTimeout(async () => {
      try { await api('PUT', `/api/almacen/reingreso-cajas/${id}`, cambios); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    }, 500);
  };

  vista.querySelectorAll('[data-caja-cantidad]').forEach((c) => {
    c.addEventListener('input', () => guardar(c.dataset.cajaCantidad, { cantidad: c.value }));
    c.addEventListener('change', () => setTimeout(() => enrutar(), 600));
  });
  // Agregar un producto a una caja concreta: cada caja tiene su propio renglón.
  vista.querySelectorAll('[data-agregar-en-caja]').forEach((zona) => {
    const alta = async () => {
      const texto = zona.querySelector('[data-caja-producto]').value.trim().toLowerCase();
      const producto = cat.productos.find((x) => x.nombre.toLowerCase() === texto)
        || cat.productos.find((x) => x.sku.toLowerCase() === texto);
      if (!producto) return mostrarMensaje('Ese producto no está en el catálogo. Escoge uno de la lista.', 'error');
      try {
        await api('POST', `/api/almacen/reingresos/${g.id}/cajas`, {
          numero: Number(zona.dataset.agregarEnCaja),
          producto_id: producto.id,
          cantidad: zona.querySelector('[data-caja-cantidad-nueva]').value,
        });
        enrutar();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    };
    zona.querySelector('[data-agregar-producto-caja]').addEventListener('click', alta);
    zona.querySelector('[data-caja-cantidad-nueva]').addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
  });
  const otraCaja = document.getElementById('otra-caja');
  if (otraCaja) {
    otraCaja.addEventListener('click', async () => {
      try { await api('PUT', `/api/almacen/reingresos/${g.id}`, { cajas: g.cajas + 1 }); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }
  vista.querySelectorAll('[data-caja-observacion]').forEach((c) => {
    c.addEventListener('input', () => guardar(c.dataset.cajaObservacion, { observacion: c.value }));
  });
  vista.querySelectorAll('[data-quitar-caja]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('DELETE', `/api/almacen/reingreso-cajas/${b.dataset.quitarCaja}`); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });


  vista.querySelectorAll('[data-gaccion]').forEach((b) => {
    b.addEventListener('click', async () => {
      const accion = b.dataset.gaccion;
      let cuerpo;
      if (accion === 'cancelar') {
        const motivo = prompt('¿Por qué se cancela el re-ingreso? Queda registrado.');
        if (!motivo || !motivo.trim()) return;
        cuerpo = { motivo: motivo.trim() };
      }
      if (accion === 'corregir') {
        const aviso = g.estado === 'aplicado' ? ' Lo que sumó al inventario se quita hasta que se vuelva a aprobar.' : '';
        const nota = prompt(`¿Qué hay que corregir? Lo va a leer quien lo recibió.${aviso}`);
        if (!nota || !nota.trim()) return;
        cuerpo = { nota: nota.trim() };
      }
      b.disabled = true;
      try {
        const r = await api('POST', `/api/almacen/reingresos/${g.id}/${accion}`, cuerpo);
        if (accion === 'cancelar') { location.hash = '#/calidad/reingresos'; return; }
        mostrarMensaje(r.mensaje || 'Listo.', 'exito');
        setTimeout(() => enrutar(), 900);
      } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; }
    });
  });
}

// --- captura de una recepción ---

async function vistaRecepcion(id) {
  const { recepcion, exige_autorizacion: exigeAutorizacion } = await api('GET', `/api/calidad/recepciones/${id}`);
  const { materiales, fondos, medidas_centro: medidas } = await catalogosCalidad();

  estado.recepcion = recepcion;
  estado.exige_autorizacion = exigeAutorizacion;
  const soloLectura = recepcion.estado !== 'borrador';

  encabezado(`Remisión ${recepcion.remision}`, `${recepcion.proveedor} · llegó ${fechaCorta(recepcion.fecha_llegada)}`);

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-menu>← Menú</button><span>/</span>
      <button data-ir-calidad>Calidad</button><span>/</span><span>Remisión ${esc(recepcion.remision)}</span>
    </div>
    <div id="mensajes"></div>
    ${tiraConexiones([recepcion.entrada_id && liga(`#/almacen/entrada/${recepcion.entrada_id}`, 'Su entrada en Almacén')])}

    <div class="captura-calidad">
      ${soloLectura ? bandaDeAprobacion(recepcion) : ''}

      <section class="panel">
        <h2>Lotes de esta remisión ${recepcion.lotes.length ? `<span class="etiqueta azul">${recepcion.lotes.length}</span>` : ''}</h2>
        <div id="lista-lotes" style="padding:18px">
          ${recepcion.lotes.length
            ? recepcion.lotes.map((l) => pintarLote(l, recepcion.fotos, soloLectura, medidas, fondos)).join('')
            : ((recepcion.sin_muestreo || []).length
              ? '<div class="vacio">Nada de esta entrada requiere muestreo: confirma abajo cuánto llegó bien.</div>'
              : '<div class="vacio">Todavía no hay lotes. Agrega el primer modelo que bajó del camión.</div>')}
        </div>
        ${soloLectura ? '' : `
          <div class="bloque-form">
            <h3>Agregar un lote</h3>
            <div class="rejilla-campos">
              <div class="campo">
                <label for="l-modelo">Modelo</label>
                <select id="l-modelo">
                  <option value="">Elige uno…</option>
                  ${materiales.map((m) => `<option value="${m.id}">${esc(m.modelo)}</option>`).join('')}
                </select>
              </div>
              <div class="campo">
                <label for="l-fondo">Fondo (color)</label>
                <select id="l-fondo">
                  <option value="">Elige uno…</option>
                  ${fondos.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
                </select>
              </div>
            </div>
            <button class="btn primario" id="agregar-lote">Agregar lote</button>
          </div>`}
      </section>

      ${pintarSinMuestreo(recepcion, soloLectura)}

      <section class="panel">
        <h2>Observaciones / comentarios</h2>
        <div style="padding:18px">
          <textarea class="obs" id="notas-recepcion" style="display:block;width:100%;min-height:90px"
            placeholder="Lo que valga la pena dejar anotado de esta remisión"
            ${soloLectura ? 'readonly' : ''}>${esc(recepcion.notas || '')}</textarea>
          <p class="explica" style="padding:10px 0 0">
            Recuerda generar las pruebas de impresión y adjuntarlas como evidencia en su lote.
          </p>
        </div>
      </section>

      <div id="firmas-calidad">${pintarFirmasCalidad(recepcion, soloLectura, exigeAutorizacion)}</div>
    </div>

    ${soloLectura ? '' : `
      <div class="pie">
        <span class="resumen" id="resumen-calidad"></span>
        <span class="guardado" id="guardado-calidad">Guardado</span>
        <button class="btn primario grande" style="width:auto" id="cerrar-recepcion">Cerrar recepción</button>
      </div>`}`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  vista.querySelector('[data-ir-calidad]').addEventListener('click', () => { location.hash = '#/calidad'; });
  cargarImagenesPendientes();
  conectarFirmas();
  conectarAprobacionRecepcion(recepcion.id);
  if (!soloLectura) conectarCalidad();
  if (!soloLectura) conectarSinMuestreo();
  actualizarResumenCalidad();
}

// Los dos botones del Administrador sobre una recepción cerrada. Van aparte de
// conectarCalidad() porque esa solo se engancha mientras la recepción se captura,
// y estos aparecen justo cuando ya no.
function conectarAprobacionRecepcion(id) {
  const visto = document.getElementById('aprobar-recepcion');
  if (visto) {
    visto.addEventListener('click', async () => {
      visto.disabled = true;
      try {
        await api('POST', `/api/calidad/recepciones/${id}/aprobar`);
        vistaRecepcion(id);
      } catch (err) { mostrarMensaje(err.message, 'error'); visto.disabled = false; }
    });
  }

  const reabrir = document.getElementById('reabrir-recepcion');
  if (reabrir) {
    reabrir.addEventListener('click', async () => {
      const motivo = prompt('Reabrir la devuelve a captura para poder corregirla. ¿Por qué? Queda registrado.');
      if (!motivo || !motivo.trim()) return;
      reabrir.disabled = true;
      try {
        await api('POST', `/api/calidad/recepciones/${id}/reabrir`, { motivo });
        vistaRecepcion(id);
      } catch (err) { mostrarMensaje(err.message, 'error'); reabrir.disabled = false; }
    });
  }
}

// Qué se ve arriba de una recepción que ya no se toca: si está esperando el
// visto bueno del Administrador o si ya lo tiene, y —solo para él— los botones
// para darlo o para devolverla a captura.
function bandaDeAprobacion(recepcion) {
  const puedeAprobar = permiso('calidad_aprobar');
  const historial = (recepcion.reversiones || []).map((v) => `
    <br><small>Reabierta por ${esc(v.nombre || '—')} el ${new Date(v.ocurrido_en).toLocaleDateString('es-MX')}: ${esc(v.motivo)}</small>`).join('');

  const acciones = puedeAprobar ? `
    <div class="fila-botones" style="margin-top:12px">
      ${recepcion.estado === 'cerrado' ? '<button class="btn primario" id="aprobar-recepcion">Dar visto bueno</button>' : ''}
      <button class="btn peligro" id="reabrir-recepcion">Reabrir para corregir</button>
    </div>` : '';

  if (recepcion.estado === 'aprobado') {
    return `<div class="aviso exito">
      <b>Aprobada por ${esc(recepcion.aprobo || '—')}</b> el ${new Date(recepcion.aprobado_en).toLocaleString('es-MX')}.
      Cerrada por ${esc(recepcion.cerro || recepcion.capturo)}.${historial}${acciones}
    </div>`;
  }
  return `<div class="aviso info">
    <b>Cerrada, esperando el visto bueno del Administrador.</b>
    La cerró ${esc(recepcion.cerro || recepcion.capturo)} el ${new Date(recepcion.cerrado_en).toLocaleString('es-MX')}.
    Ya no se modifica.${historial}${acciones}
  </div>`;
}

// Un lote: lo que se escribe, lo que el sistema contesta, la especificación
// contra la que se compara y el veredicto. Es el renglón de la hoja de papel
// abierto en vertical para que quepa en una tablet.
function pintarLote(lote, fotos, soloLectura, medidas, fondos) {
  const spec = [
    ['Color de impresión', lote.color_impresion],
    ['Marca de término', lote.marca_termino],
    ['Tipo de centro', lote.tipo_centro],
    ['GAP', lote.gap],
    ['Etiquetas por rollo', lote.cant_x_rollo],
    ['Diámetro de referencia', lote.diam_referencia],
    ['Centro de referencia', lote.centro_referencia],
  ].filter(([, v]) => v);

  const marcado = (campo, valor) => (lote[campo] === valor ? 'true' : 'false');

  return `
    <article class="lote ${lote.resultado || ''}" data-lote="${lote.id}">
      <header>
        ${lote.imagen_material ? `<img class="imagen-lote" data-archivo="${esc(lote.imagen_material)}" alt="${esc(lote.modelo)}">` : ''}
        <b>${esc(lote.modelo)}</b>
        ${lote.fondo ? `<span class="etiqueta">${esc(lote.fondo)}</span>` : ''}
        ${lote.resultado
          ? `<span class="etiqueta ${lote.resultado === 'aprobado' ? 'verde' : 'roja'}">
               ${lote.resultado === 'aprobado' ? 'Aprobado' : 'Rechazado'}</span>`
          : '<span class="etiqueta ambar">Sin revisar</span>'}
        ${soloLectura ? '' : `<button class="quitar" data-quitar-lote="${lote.id}" title="Quitar lote">×</button>`}
      </header>

      <div class="cuerpo">
        <div>
          <p class="rotulo-bloque">1 · ¿Cuánto llegó?</p>
          <div class="campos-linea">
            <div class="campo"><label>Cajas</label>
              <input inputmode="numeric" data-campo="cant_cajas" value="${lote.cant_cajas ?? ''}" ${soloLectura ? 'readonly' : ''}></div>
            <div class="campo"><label>Rollos por caja</label>
              <input inputmode="numeric" data-campo="rollos_x_caja" value="${lote.rollos_x_caja ?? ''}" ${soloLectura ? 'readonly' : ''}></div>
            <div class="campo"><label>o total de rollos</label>
              <input inputmode="numeric" data-campo="cant_rollos" value="${lote.cant_rollos ?? ''}" ${soloLectura ? 'readonly' : ''}></div>
          </div>
        </div>

        <div class="muestra">
          <span class="dato"><span class="rotulo">Total en lote</span><b data-total>${lote.total_lote ?? '—'}</b></span>
          <span class="dato destacado"><span class="rotulo">¡Revisar!</span><b data-muestra>${lote.muestra || '—'}</b></span>
          <span class="pie-muestra">rollos a inspeccionar de este lote</span>
        </div>

        ${spec.length ? `
          <div>
            <p class="rotulo-bloque">2 · Debe tener — compáralo contra el producto</p>
            <div class="spec">
              ${spec.map(([k, v]) => `<span class="etiqueta"><i>${esc(k)}:</i> ${esc(v)}</span>`).join('')}
            </div>
          </div>` : ''}

        <div>
          <p class="rotulo-bloque">3 · Lo que revisas</p>
          <div class="campos-linea">
            <div class="campo"><label>Diámetro (lo mides)</label>
              <input data-campo="diametro" maxlength="20" value="${esc(lote.diametro || '')}" ${soloLectura ? 'readonly' : ''}></div>
            <div class="campo"><label>Medida del centro</label>
              <select data-campo="medida_centro" ${soloLectura ? 'disabled' : ''}>
                <option value="">Elige…</option>
                ${medidas.map((m) => `<option value="${esc(m)}" ${lote.medida_centro === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
              </select></div>
          </div>
        </div>

        <div>
          <p class="rotulo-bloque">4 · Resultado</p>
          <div class="campos-linea">
            <div class="grupo-opciones">
              <span class="rotulo-opciones">¿Impresión nítida?</span>
              <div class="opciones">
                <button class="opcion buena" data-campo="nitida" data-valor="si" aria-pressed="${marcado('nitida', 'si')}" ${soloLectura ? 'disabled' : ''}>Sí</button>
                <button class="opcion mala" data-campo="nitida" data-valor="no" aria-pressed="${marcado('nitida', 'no')}" ${soloLectura ? 'disabled' : ''}>No</button>
              </div>
            </div>
            <div class="grupo-opciones">
              <span class="rotulo-opciones">Veredicto del lote</span>
              <div class="opciones">
                <button class="opcion buena" data-campo="resultado" data-valor="aprobado" aria-pressed="${marcado('resultado', 'aprobado')}" ${soloLectura ? 'disabled' : ''}>Aprobado</button>
                <button class="opcion mala" data-campo="resultado" data-valor="rechazado" aria-pressed="${marcado('resultado', 'rechazado')}" ${soloLectura ? 'disabled' : ''}>Rechazado</button>
              </div>
            </div>
          </div>
        </div>

        <div class="zona-rechazo" ${lote.resultado === 'rechazado' || (lote.observacion || '').trim() || fotos.some((f) => f.lote_id === lote.id) ? '' : 'hidden'}>
          <textarea class="obs ${lote.resultado === 'rechazado' && !(lote.observacion || '').trim() ? 'requerida' : ''}"
            data-campo="observacion" style="display:block;width:100%"
            placeholder="¿Qué tiene mal? Descríbelo para el proveedor"
            ${soloLectura ? 'readonly' : ''}>${esc(lote.observacion || '')}</textarea>
          ${tiraFotosLote(lote, fotos, soloLectura)}
        </div>

        ${lote.disposicion ? `
          <div class="aviso exito" style="margin:0">
            <b>Aprobado: ${esc(lote.etiqueta_disposicion || '')}</b> — por ${esc(lote.aprobo || '—')}.
            ${lote.disposicion_nota ? `<br>${esc(lote.disposicion_nota)}` : ''}
          </div>`
        : lote.propuesta ? `
          <div class="aviso info" style="margin:0">
            <b>Propuesta: ${esc(lote.etiqueta_propuesta || '')}</b> — de ${esc(lote.propuso || '—')}.
            Falta la aprobación del Administrador.
            ${lote.propuesta_nota ? `<br>${esc(lote.propuesta_nota)}` : ''}
          </div>` : ''}
      </div>
    </article>`;
}

function tiraFotosLote(lote, fotos, soloLectura) {
  const lista = fotos.filter((f) => f.lote_id === lote.id);
  const falta = lote.resultado === 'rechazado' && lista.length === 0;
  return `
    <div class="evidencia ${falta ? 'falta' : ''}" data-fotos-lote="${lote.id}">
      <div class="miniaturas">
        ${lista.map((f) => `
          <figure class="mini">
            <img data-archivo="${esc(f.archivo)}" alt="Evidencia del defecto">
            ${soloLectura ? '' : `<button class="quitar" data-quitar-foto="${f.id}" title="Quitar foto">×</button>`}
          </figure>`).join('')}
      </div>
      ${soloLectura
        ? (lista.length ? '' : '<span class="nota-foto">Sin evidencia</span>')
        : `<button class="btn-camara" type="button" data-camara-lote="${lote.id}">
             <span aria-hidden="true">📷</span> ${lista.length ? 'Otra foto' : 'Tomar foto'}
           </button>
           ${falta ? '<span class="nota-foto obligatoria">Foto obligatoria</span>' : ''}`}
    </div>`;
}

// La firma de autorización solo se pide cuando hay algún lote rechazado: un
// camión que llegó bien no tiene por qué esperar a que haya un Team Leader
// disponible.
function pintarFirmasCalidad(recepcion, soloLectura, exigeAutorizacion) {
  const roles = [['calidad', 'Firma de quien hizo el muestreo', 'calidad_capturar']];
  if (exigeAutorizacion || recepcion.firmas.some((f) => f.rol === 'autorizacion')) {
    roles.push(['autorizacion', 'Firma de autorización (Team Leader)', 'calidad_autorizar']);
  }

  return roles.map(([rol, etiqueta, permisoFirma]) => {
    const firma = recepcion.firmas.find((f) => f.rol === rol);

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

    if (!permiso(permisoFirma)) {
      return `
        <section class="panel">
          <h2>${etiqueta}</h2>
          <div class="vacio">Pendiente. La levanta un Team Leader o el Administrador desde su sesión.</div>
        </section>`;
    }

    return `
      <section class="panel">
        <h2>${etiqueta}</h2>
        <div class="firma-caja" data-firma="${rol}" data-url="/api/calidad/recepciones/${recepcion.id}/firma">
          <canvas></canvas>
          <div class="acciones">
            <input class="obs" style="flex:1;min-height:auto" placeholder="Nombre de quien firma"
                   value="${rol === 'calidad' ? esc(estado.usuario.nombre) : ''}">
            <button class="btn" data-limpiar>Borrar</button>
            <button class="btn primario" data-guardar-firma>Guardar firma</button>
          </div>
        </div>
      </section>`;
  }).join('');
}

// El recuadro de la firma de autorización solo existe si hay algún lote
// rechazado. Al marcar el primero hay que dibujarlo, o quien captura toparía con
// «falta la firma del Team Leader» sin tener dónde levantarla.
function actualizarFirmasCalidad() {
  const zona = document.getElementById('firmas-calidad');
  if (!zona) return;
  const hayRechazo = estado.recepcion.lotes.some((l) => l.resultado === 'rechazado');
  if (hayRechazo === estado.exige_autorizacion) return;

  estado.exige_autorizacion = hayRechazo;
  zona.innerHTML = pintarFirmasCalidad(estado.recepcion, false, hayRechazo);
  conectarFirmas();
}

// --- guardado automático de los lotes ---

const pendientesLote = new Map();
let temporizadorLote = null;

function marcarLote(loteId, cambios) {
  pendientesLote.set(loteId, { ...(pendientesLote.get(loteId) || {}), ...cambios });
  clearTimeout(temporizadorLote);
  temporizadorLote = setTimeout(descargarLotes, 600);
}

async function descargarLotes() {
  clearTimeout(temporizadorLote);
  const tanda = [...pendientesLote.entries()];
  pendientesLote.clear();

  for (const [id, cambios] of tanda) {
    try {
      const r = await api('PUT', `/api/calidad/lotes/${id}`, cambios);
      const caja = vista.querySelector(`[data-lote="${id}"]`);
      if (caja) {
        caja.querySelector('[data-total]').textContent = r.total_lote ?? '—';
        caja.querySelector('[data-muestra]').textContent = r.muestra || '—';
      }
      const aviso = document.getElementById('guardado-calidad');
      if (aviso) {
        aviso.classList.add('visible');
        setTimeout(() => aviso.classList.remove('visible'), 1200);
      }
    } catch (err) {
      mostrarMensaje(err.message, 'error');
    }
  }
  actualizarResumenCalidad();
}

// Qué le falta a la recepción para poder cerrarse. Se calcula en la tablet para
// que el pie diga la verdad sin ir al servidor en cada toque; el servidor
// vuelve a comprobarlo al cerrar, que es lo que de verdad manda.
// Lo que llegó en la entrada y no se muestrea (cajas, empaque, portarollos):
// Calidad confirma cuánto llegó bien. Eso es lo que suma al inventario.
function pintarSinMuestreo(recepcion, soloLectura) {
  const lista = recepcion.sin_muestreo || [];
  if (!lista.length) return '';
  return `
    <section class="panel">
      <h2>Material sin muestreo <span class="etiqueta azul">${lista.length}</span></h2>
      <p class="explica">
        Esto no se muestrea, pero Calidad confirma que llegó bien. Anota cuánto llegó en buen
        estado; si es menos de lo que decía la entrada, explica qué pasó. Solo lo que llegó bien
        suma al inventario.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Producto</th><th>Decía la entrada</th>
          <th style="min-width:110px">Llegó bien</th><th style="min-width:220px">Observación</th></tr></thead>
        <tbody>${lista.map((sm) => `
          <tr data-sin-muestreo="${sm.id}">
            <td class="fila-titulo">${fotoProducto({ id: sm.producto_id, sku: sm.sku })}${esc(sm.producto)}<br><small style="color:var(--tinta-suave)">${esc(sm.sku)}${sm.tipo_material ? ` · ${esc(sm.tipo_material)}` : ''}</small></td>
            <td>${numero(sm.cantidad)}</td>
            <td>${soloLectura
              ? (sm.cantidad_buena === null ? '—' : `<b>${numero(sm.cantidad_buena)}</b>`)
              : `<input type="number" min="0" max="${sm.cantidad}" step="1" value="${sm.cantidad_buena ?? ''}" data-sm-buena="${sm.id}">`}</td>
            <td>${soloLectura
              ? esc(sm.observacion || '—')
              : `<input type="text" value="${esc(sm.observacion || '')}" data-sm-obs="${sm.id}" placeholder="Obligatoria si llegó menos">`}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>`;
}

let temporizadorSinMuestreo = null;

function conectarSinMuestreo() {
  const guardar = (id) => {
    clearTimeout(temporizadorSinMuestreo);
    temporizadorSinMuestreo = setTimeout(async () => {
      const buena = vista.querySelector(`[data-sm-buena="${id}"]`);
      const obs = vista.querySelector(`[data-sm-obs="${id}"]`);
      try {
        const { renglon } = await api('PUT', `/api/calidad/sin-muestreo/${id}`, {
          cantidad_buena: buena.value, observacion: obs.value,
        });
        const lista = estado.recepcion.sin_muestreo || [];
        const i = lista.findIndex((x) => x.id === renglon.id);
        if (i >= 0) lista[i] = { ...lista[i], ...renglon };
        actualizarResumenCalidad();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    }, 450);
  };
  vista.querySelectorAll('[data-sm-buena], [data-sm-obs]').forEach((campo) => {
    campo.addEventListener('input', () => guardar(campo.dataset.smBuena || campo.dataset.smObs));
  });
}

function actualizarResumenCalidad() {
  const zona = document.getElementById('resumen-calidad');
  if (!zona || !estado.recepcion) return;

  const lotes = estado.recepcion.lotes;
  const sinMuestreo = estado.recepcion.sin_muestreo || [];
  if (!lotes.length && !sinMuestreo.length) { zona.textContent = 'Agrega al menos un lote.'; return; }

  const completos = lotes.filter((l) => l.total_lote && l.diametro && l.medida_centro && l.nitida && l.resultado);
  const rechazados = lotes.filter((l) => l.resultado === 'rechazado');
  const faltanEvidencia = rechazados.filter(
    (l) => !(l.observacion || '').trim() || !estado.recepcion.fotos.some((f) => f.lote_id === l.id)
  );

  const partes = lotes.length ? [`${completos.length} de ${lotes.length} lote(s) listo(s)`] : [];
  if (sinMuestreo.length) {
    const confirmados = sinMuestreo.filter((x) => x.cantidad_buena !== null && x.cantidad_buena !== undefined && x.cantidad_buena !== '');
    partes.push(`${confirmados.length} de ${sinMuestreo.length} producto(s) sin muestreo confirmado(s)`);
  }
  if (rechazados.length) partes.push(`${rechazados.length} rechazado(s)`);
  if (faltanEvidencia.length) partes.push(`${faltanEvidencia.length} sin observación o foto`);
  zona.textContent = partes.join(' · ');
}

// --- captura: manejadores propios del módulo ---

// Selector de fotos aparte del de los checklists. El de allá sube a
// /api/llenados/…; compartirlo obligaría a que uno supiera del otro.
const selectorFotosCalidad = document.createElement('input');
selectorFotosCalidad.setAttribute('type', 'file');
selectorFotosCalidad.setAttribute('accept', 'image/*');
selectorFotosCalidad.setAttribute('capture', 'environment');
selectorFotosCalidad.setAttribute('multiple', '');
selectorFotosCalidad.hidden = true;
document.body.appendChild(selectorFotosCalidad);

let loteDestino = null;

selectorFotosCalidad.addEventListener('change', async () => {
  const archivos = [...selectorFotosCalidad.files];
  selectorFotosCalidad.value = '';
  if (!archivos.length || !loteDestino) return;

  const caja = vista.querySelector(`[data-fotos-lote="${loteDestino}"]`);
  const boton = caja && caja.querySelector('.btn-camara');
  if (boton) { boton.disabled = true; boton.textContent = 'Subiendo…'; }

  for (const archivo of archivos) {
    try {
      const guardado = await api('POST', `/api/calidad/lotes/${loteDestino}/fotos`, {
        imagen: await comprimirImagen(archivo, 1600, 0.82),
      });
      estado.recepcion.fotos.push(guardado);
    } catch (err) {
      mostrarMensaje(`No se pudo subir «${archivo.name}»: ${err.message}`, 'error');
    }
  }
  refrescarLote(loteDestino);
});

// Vuelve a dibujar un lote con lo que la tablet ya tiene en memoria. Se usa tras
// subir o quitar una foto, para no recargar toda la recepción por una miniatura.
function refrescarLote(loteId) {
  const lote = estado.recepcion.lotes.find((l) => l.id === Number(loteId));
  const caja = vista.querySelector(`[data-lote="${loteId}"]`);
  if (!lote || !caja) return;

  const { medidas_centro: medidas, fondos } = estado.catalogos_calidad;
  const envoltorio = document.createElement('div');
  envoltorio.innerHTML = pintarLote(lote, estado.recepcion.fotos, false, medidas, fondos);
  caja.replaceWith(envoltorio.firstElementChild);
  cargarImagenesPendientes();
  actualizarResumenCalidad();
}

let temporizadorNotasCalidad = null;

function conectarCalidad() {
  const zona = vista.querySelector('.captura-calidad');

  const agregar = document.getElementById('agregar-lote');
  if (agregar) {
    agregar.addEventListener('click', async () => {
      const materialId = document.getElementById('l-modelo').value;
      if (!materialId) return mostrarMensaje('Elige el modelo que llegó.', 'error');
      try {
        await descargarLotes();
        await api('POST', `/api/calidad/recepciones/${estado.recepcion.id}/lotes`, {
          material_id: Number(materialId),
          fondo: document.getElementById('l-fondo').value || null,
        });
        vistaRecepcion(estado.recepcion.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }

  zona.addEventListener('click', async (e) => {
    const opcion = e.target.closest('.opcion');
    if (opcion) {
      const caja = opcion.closest('[data-lote]');
      const lote = estado.recepcion.lotes.find((l) => l.id === Number(caja.dataset.lote));
      const campo = opcion.dataset.campo;
      const yaEstaba = opcion.getAttribute('aria-pressed') === 'true';
      const valor = yaEstaba ? null : opcion.dataset.valor;

      opcion.closest('.opciones').querySelectorAll('.opcion').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      if (valor) opcion.setAttribute('aria-pressed', 'true');
      lote[campo] = valor;

      if (campo === 'resultado') {
        // Un rechazo abre la zona de evidencia y la deja marcada como pendiente:
        // es justo lo que en papel se perdía cuando solo se tachaba la casilla.
        caja.classList.remove('aprobado', 'rechazado');
        if (valor) caja.classList.add(valor);
        const zonaRechazo = caja.querySelector('.zona-rechazo');
        const obs = zonaRechazo.querySelector('.obs');
        zonaRechazo.hidden = valor !== 'rechazado' && !obs.value.trim();
        obs.classList.toggle('requerida', valor === 'rechazado' && !obs.value.trim());
        const tira = zonaRechazo.querySelector('.evidencia');
        const sinFoto = !estado.recepcion.fotos.some((f) => f.lote_id === lote.id);
        tira.classList.toggle('falta', valor === 'rechazado' && sinFoto);
        const etiqueta = caja.querySelector('header .etiqueta:last-of-type');
        if (etiqueta) {
          etiqueta.className = `etiqueta ${valor === 'aprobado' ? 'verde' : valor === 'rechazado' ? 'roja' : 'ambar'}`;
          etiqueta.textContent = valor === 'aprobado' ? 'Aprobado' : valor === 'rechazado' ? 'Rechazado' : 'Sin revisar';
        }
        if (valor === 'rechazado') obs.focus();
        actualizarFirmasCalidad();
      }

      marcarLote(lote.id, { [campo]: valor });
      actualizarResumenCalidad();
      return;
    }

    const camara = e.target.closest('[data-camara-lote]');
    if (camara) {
      loteDestino = camara.dataset.camaraLote;
      selectorFotosCalidad.click();
      return;
    }

    const quitarFoto = e.target.closest('[data-quitar-foto]');
    if (quitarFoto) {
      const id = Number(quitarFoto.dataset.quitarFoto);
      const loteId = quitarFoto.closest('[data-lote]').dataset.lote;
      try {
        await api('DELETE', `/api/calidad/fotos/${id}`);
        estado.recepcion.fotos = estado.recepcion.fotos.filter((f) => f.id !== id);
        refrescarLote(loteId);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
      return;
    }

    const quitarLote = e.target.closest('[data-quitar-lote]');
    if (quitarLote) {
      const caja = quitarLote.closest('[data-lote]');
      const lote = estado.recepcion.lotes.find((l) => l.id === Number(caja.dataset.lote));
      if (!confirm(`¿Quitar el lote «${lote.modelo}» de esta recepción?`)) return;
      try {
        await api('DELETE', `/api/calidad/lotes/${lote.id}`);
        vistaRecepcion(estado.recepcion.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
      return;
    }

    const miniatura = e.target.closest('.mini img');
    if (miniatura && miniatura.src) ampliarFoto(miniatura.src);
  });

  zona.addEventListener('input', (e) => {
    const campo = e.target.closest('[data-campo]');
    if (campo) {
      const caja = campo.closest('[data-lote]');
      const lote = estado.recepcion.lotes.find((l) => l.id === Number(caja.dataset.lote));
      lote[campo.dataset.campo] = campo.value;
      if (campo.dataset.campo === 'observacion') {
        campo.classList.toggle('requerida', lote.resultado === 'rechazado' && !campo.value.trim());
      }
      marcarLote(lote.id, { [campo.dataset.campo]: campo.value });
      return;
    }

    const notas = e.target.closest('#notas-recepcion');
    if (notas) {
      clearTimeout(temporizadorNotasCalidad);
      temporizadorNotasCalidad = setTimeout(() => {
        api('PUT', `/api/calidad/recepciones/${estado.recepcion.id}`, { notas: notas.value })
          .catch((err) => mostrarMensaje(err.message, 'error'));
      }, 800);
    }
  });

  // Los <select> no disparan 'input' en todos los navegadores de tablet.
  zona.addEventListener('change', (e) => {
    const campo = e.target.closest('select[data-campo]');
    if (!campo) return;
    const caja = campo.closest('[data-lote]');
    const lote = estado.recepcion.lotes.find((l) => l.id === Number(caja.dataset.lote));
    lote[campo.dataset.campo] = campo.value;
    marcarLote(lote.id, { [campo.dataset.campo]: campo.value });
    actualizarResumenCalidad();
  });

  const cerrar = document.getElementById('cerrar-recepcion');
  if (cerrar) {
    cerrar.addEventListener('click', async () => {
      await descargarLotes();
      cerrar.disabled = true;
      try {
        await api('POST', `/api/calidad/recepciones/${estado.recepcion.id}/cerrar`);
        mostrarMensaje('Recepción cerrada.', 'exito');
        setTimeout(() => { location.hash = '#/calidad'; }, 900);
      } catch (err) {
        mostrarMensaje(err.message, 'error');
        cerrar.disabled = false;
      }
    });
  }
}

// ------------------------------------------- calidad: lo que espera aprobación

// Un rechazo pasa por tres momentos: alguien propone qué hacer, el Administrador
// aprueba —pudiendo cambiar la salida— y con eso cierra. Aquí viven los tres,
// más las recepciones que esperan su visto bueno.
async function vistaCalidadPendientes() {
  encabezado('Aprobaciones', 'Lo que espera al Administrador');
  const datos = await api('GET', '/api/calidad/pendientes');

  const puedeProponer = permiso('calidad_proponer');
  const puedeAprobar = permiso('calidad_aprobar');

  const selectorDisposicion = (id, valor) => `
    <select data-disposicion="${id}">
      <option value="">Elige…</option>
      ${datos.disposiciones.map((d) => `
        <option value="${esc(d.clave)}" ${d.clave === valor ? 'selected' : ''}>${esc(d.etiqueta)}</option>`).join('')}
    </select>`;

  const tarjetaLote = (l) => `
    <article class="lote rechazado" data-pendiente="${l.id}">
      <header>
        <b>${esc(l.modelo)}</b>
        ${l.fondo ? `<span class="etiqueta">${esc(l.fondo)}</span>` : ''}
        <span class="etiqueta roja">Rechazado</span>
      </header>
      <div class="cuerpo">
        <p class="meta">Remisión ${esc(l.remision)} · ${esc(l.proveedor)} · llegó ${fechaCorta(l.fecha_llegada)}
          · lote de ${l.total_lote ?? '—'} rollos, se revisaron ${l.muestra ?? '—'}</p>
        ${l.observacion ? `<p><b>Motivo:</b> ${esc(l.observacion)}</p>` : ''}
        ${l.fotos.length ? `<div class="miniaturas">${l.fotos.map((f) => `
          <figure class="mini"><img data-archivo="${esc(f.archivo)}" alt="Evidencia"></figure>`).join('')}</div>` : ''}

        ${l.propuesta ? `
          <div class="aviso info" style="margin:0">
            <b>Propuesta: ${esc(l.etiqueta_propuesta)}</b> — de ${esc(l.propuso || '—')}
            ${l.propuesta_nota ? `<br>${esc(l.propuesta_nota)}` : ''}
          </div>` : ''}

        ${l.momento === 'cerrado' ? `
          <div class="aviso exito" style="margin:0">
            <b>Aprobado: ${esc(l.etiqueta_disposicion)}</b> — por ${esc(l.aprobo || '—')}
            el ${new Date(l.aprobado_en).toLocaleDateString('es-MX')}.
            ${l.etiqueta_propuesta && l.disposicion !== l.propuesta
              ? '<br>El Administrador aprobó una salida distinta de la propuesta.' : ''}
            ${l.disposicion_nota ? `<br>${esc(l.disposicion_nota)}` : ''}
          </div>
          ${puedeAprobar ? `
            <div class="fila-botones">
              <button class="btn peligro" data-reabrir-lote="${l.id}">Reabrir</button>
            </div>` : ''}` : ''}

        ${l.momento === 'por_proponer' && puedeProponer ? `
          <div class="campos-linea">
            <div class="campo" style="flex:1;min-width:220px">
              <label>¿Qué propones hacer con este lote?</label>
              ${selectorDisposicion(l.id, null)}
            </div>
            <div class="campo" style="flex:2;min-width:220px">
              <label>Nota (opcional)</label>
              <input data-nota="${l.id}" placeholder="Lo hablado con el proveedor, folio, etc.">
            </div>
            <button class="btn primario" data-proponer="${l.id}">Proponer</button>
          </div>` : ''}
        ${l.momento === 'por_proponer' && !puedeProponer
          ? '<p class="explica" style="padding:0">Falta que un Team Leader proponga qué hacer.</p>' : ''}

        ${l.momento === 'por_aprobar' && puedeAprobar ? `
          <div class="campos-linea">
            <div class="campo" style="flex:1;min-width:220px">
              <label>Aprobar como</label>
              ${selectorDisposicion(l.id, l.propuesta)}
            </div>
            <div class="campo" style="flex:2;min-width:220px">
              <label>Nota (opcional)</label>
              <input data-nota="${l.id}" placeholder="Tu instrucción o el acuerdo final">
            </div>
            <button class="btn primario" data-aprobar-lote="${l.id}">Aprobar y cerrar</button>
            <button class="btn" data-devolver="${l.id}">Devolver</button>
          </div>
          <p class="explica" style="padding:0">
            Puedes aprobar una salida distinta de la propuesta: la tuya es la que queda.
          </p>` : ''}
        ${l.momento === 'por_aprobar' && !puedeAprobar
          ? '<p class="explica" style="padding:0">Esperando la aprobación del Administrador.</p>' : ''}
      </div>
    </article>`;

  const tarjetaRecepcion = (r) => `
    <article class="lote" data-recepcion-pendiente="${r.id}">
      <header>
        <b>Remisión ${esc(r.remision)}</b>
        <span class="etiqueta">${esc(r.proveedor)}</span>
        ${r.rechazados ? `<span class="etiqueta roja">${r.rechazados} rechazado(s)</span>` : '<span class="etiqueta verde">Todo aprobado</span>'}
      </header>
      <div class="cuerpo">
        <p class="meta">Llegó ${fechaCorta(r.fecha_llegada)} · ${r.lotes} lote(s) · capturó ${esc(r.capturo)}
          · cerrada por ${esc(r.cerro || r.capturo)} el ${new Date(r.cerrado_en).toLocaleString('es-MX')}</p>
        <div class="fila-botones">
          <button class="btn" data-ver-recepcion="${r.id}">Ver el muestreo</button>
          ${puedeAprobar ? `
            <button class="btn primario" data-aprobar-recepcion="${r.id}">Dar visto bueno</button>
            <button class="btn peligro" data-reabrir-recepcion="${r.id}">Reabrir</button>` : ''}
        </div>
        ${puedeAprobar ? '' : '<p class="explica" style="padding:0">Esperando el visto bueno del Administrador.</p>'}
      </div>
    </article>`;

  const seccion = (titulo, color, lista, vacio, pintar) => `
    <section class="panel">
      <h2>${titulo} ${lista.length ? `<span class="etiqueta ${color}">${lista.length}</span>` : ''}</h2>
      <div style="padding:18px">
        ${lista.length ? lista.map(pintar).join('') : `<div class="vacio">${vacio}</div>`}
      </div>
    </section>`;

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-menu>← Menú</button><span>/</span>
      <button data-ir-calidad>Calidad</button><span>/</span><span>Aprobaciones</span>
    </div>
    <div id="mensajes"></div>
    <p class="explica" style="padding:0 0 16px">
      El Team Leader propone qué hacer con un lote rechazado y el Administrador aprueba.
      Al aprobar puede elegir otra salida: la última palabra es suya.
    </p>
    ${seccion('Recepciones sin visto bueno', 'ambar', datos.recepciones,
      'Todas las recepciones cerradas tienen visto bueno.', tarjetaRecepcion)}
    ${seccion('Rechazos por proponer', 'roja', datos.por_proponer,
      'Nada esperando propuesta.', tarjetaLote)}
    ${seccion('Rechazos por aprobar', 'ambar', datos.por_aprobar,
      'Nada esperando tu aprobación.', tarjetaLote)}
    ${seccion('Rechazos cerrados', 'verde', datos.cerrados,
      'Todavía no se ha cerrado ningún rechazo.', tarjetaLote)}`;

  vista.querySelector('[data-ir-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
  vista.querySelector('[data-ir-calidad]').addEventListener('click', () => { location.hash = '#/calidad'; });
  cargarImagenesPendientes();

  const dato = (attr, id) => {
    const campo = vista.querySelector(`[data-${attr}="${id}"]`);
    return campo ? campo.value.trim() : '';
  };

  // Cada acción es la misma mecánica: pedir, avisar si falla y repintar. Se
  // repinta entero en vez de parchar la tarjeta porque una aprobación mueve el
  // lote de una sección a otra.
  const accion = (attr, construir) => {
    vista.querySelectorAll(`[data-${attr}]`).forEach((boton) => {
      boton.addEventListener('click', async () => {
        const id = boton.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())];
        const peticion = construir(id, boton);
        if (!peticion) return;
        boton.disabled = true;
        try {
          await api('POST', peticion.ruta, peticion.cuerpo);
          vistaCalidadPendientes();
        } catch (err) {
          mostrarMensaje(err.message, 'error');
          boton.disabled = false;
        }
      });
    });
  };

  accion('proponer', (id) => {
    const disposicion = dato('disposicion', id);
    if (!disposicion) { mostrarMensaje('Elige qué propones hacer con el lote.', 'error'); return null; }
    return { ruta: `/api/calidad/lotes/${id}/propuesta`, cuerpo: { disposicion, nota: dato('nota', id) } };
  });

  accion('aprobar-lote', (id) => {
    const disposicion = dato('disposicion', id);
    if (!disposicion) { mostrarMensaje('Elige con qué salida lo apruebas.', 'error'); return null; }
    return { ruta: `/api/calidad/lotes/${id}/aprobar`, cuerpo: { disposicion, nota: dato('nota', id) } };
  });

  accion('devolver', (id) => {
    const motivo = prompt('¿Por qué devuelves la propuesta? Queda registrado.');
    if (!motivo || !motivo.trim()) return null;
    return { ruta: `/api/calidad/lotes/${id}/devolver`, cuerpo: { motivo } };
  });

  accion('reabrir-lote', (id) => {
    const motivo = prompt('¿Por qué reabres este lote ya cerrado? Queda registrado.');
    if (!motivo || !motivo.trim()) return null;
    return { ruta: `/api/calidad/lotes/${id}/reabrir`, cuerpo: { motivo } };
  });

  accion('aprobar-recepcion', (id) => ({ ruta: `/api/calidad/recepciones/${id}/aprobar` }));

  accion('reabrir-recepcion', (id) => {
    const motivo = prompt('Reabrir la devuelve a captura para poder corregirla. ¿Por qué? Queda registrado.');
    if (!motivo || !motivo.trim()) return null;
    return { ruta: `/api/calidad/recepciones/${id}/reabrir`, cuerpo: { motivo } };
  });

  vista.querySelectorAll('[data-ver-recepcion]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/recepcion/${b.dataset.verRecepcion}`; });
  });
}

// -------------------------------------------------- calidad: reportes

async function vistaCalidadReportes() {
  encabezado('Reportes de Calidad', 'Muestreo de material recibido');
  const { lotes, resumen, proveedores, etiquetas_disposicion: etiquetas } = await api('GET', '/api/calidad/reportes');

  const porcentaje = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  vista.innerHTML = `
    ${migajaReportes('Calidad')}
    <div id="mensajes"></div>

    <section class="panel">
      <h2>Resumen</h2>
      <div class="indicadores">
        <div class="indicador"><span class="rotulo">Lotes revisados</span><b>${resumen.lotes}</b>
          <span class="pie-ind">${resumen.rollos.toLocaleString('es-MX')} rollos recibidos</span></div>
        <div class="indicador"><span class="rotulo">Rollos inspeccionados</span><b>${resumen.revisados.toLocaleString('es-MX')}</b>
          <span class="pie-ind">raíz cuadrada de cada lote</span></div>
        <div class="indicador"><span class="rotulo">Lotes rechazados</span><b>${resumen.rechazados}</b>
          <span class="pie-ind">${porcentaje(resumen.rechazados, resumen.lotes)} de lo revisado</span></div>
        <div class="indicador"><span class="rotulo">Sin resolver</span><b>${resumen.sin_resolver}</b>
          <span class="pie-ind">esperando decisión o confirmación</span></div>
      </div>
    </section>

    <section class="panel">
      <h2>Por proveedor</h2>
      ${proveedores.length ? `<div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Proveedor</th><th>Lotes</th><th>Rechazados</th><th>Índice</th><th>Rollos</th></tr></thead>
        <tbody>${proveedores.map((p) => `
          <tr>
            <th class="fila-titulo">${esc(p.proveedor)}</th>
            <td>${p.lotes}</td>
            <td class="${p.rechazados ? 'con-problema' : ''}">${p.rechazados}</td>
            <td>${porcentaje(p.rechazados, p.lotes)}</td>
            <td>${p.rollos.toLocaleString('es-MX')}</td>
          </tr>`).join('')}
        </tbody></table></div>`
        : '<div class="vacio">Todavía no hay muestreos capturados.</div>'}
    </section>

    <section class="panel">
      <h2>Detalle por lote</h2>
      ${lotes.length ? `<div class="desliza"><table class="captura">
        <thead><tr>
          <th class="fila-titulo">Modelo</th><th>Fondo</th><th>Proveedor</th><th>Remisión</th>
          <th>Llegada</th><th>Lote</th><th>Revisados</th><th>Diámetro</th><th>Centro</th>
          <th>Nítida</th><th>Resultado</th><th>Disposición</th>
        </tr></thead>
        <tbody>${lotes.map((l) => `
          <tr>
            <th class="fila-titulo">${esc(l.modelo)}</th>
            <td>${esc(l.fondo || '—')}</td>
            <td>${esc(l.proveedor)}</td>
            <td>${esc(l.remision)}</td>
            <td>${fechaCorta(l.fecha_llegada)}</td>
            <td>${l.total_lote ?? '—'}</td>
            <td>${l.muestra ?? '—'}</td>
            <td>${esc(l.diametro || '—')}${l.diam_referencia ? `<br><small style="color:var(--tinta-suave)">ref. ${esc(l.diam_referencia)}</small>` : ''}</td>
            <td>${esc(l.medida_centro || '—')}</td>
            <td>${l.nitida === 'si' ? 'Sí' : l.nitida === 'no' ? 'No' : '—'}</td>
            <td class="${l.resultado === 'rechazado' ? 'con-problema' : ''}">${
              l.resultado === 'aprobado' ? 'Aprobado' : l.resultado === 'rechazado' ? 'Rechazado' : '—'}</td>
            <td>${l.disposicion ? esc(etiquetas[l.disposicion]) : (l.resultado === 'rechazado' ? 'Pendiente' : '—')}</td>
          </tr>`).join('')}
        </tbody></table></div>`
        : '<div class="vacio">Sin datos todavía.</div>'}
      <div class="bloque-form">
        <button class="btn" id="exportar-calidad">Descargar todo en Excel (CSV)</button>
      </div>
    </section>`;

  document.getElementById('exportar-calidad').addEventListener('click', () => descargarCSV('/api/calidad/exportar.csv', 'calidad-muestreo.csv'));
}

// La exportación va protegida por sesión, así que no basta con un enlace: hay
// que pedirla con el token y entregar el archivo desde un blob local.
async function descargarCSV(ruta, nombre) {
  try {
    const res = await fetch(ruta, { headers: { Authorization: `Bearer ${estado.token}` } });
    if (!res.ok) throw new Error('No se pudo generar el archivo');
    const url = URL.createObjectURL(await res.blob());
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    mostrarMensaje(err.message, 'error');
  }
}



// ========================================================== notificaciones

// La bandeja no guarda nada: pregunta al servidor qué está esperando una
// decisión de quien la abre. Por eso nunca queda un aviso de algo ya resuelto,
// que era el defecto de llevar los pendientes en una libreta aparte.

// «hace 3 días» dice más que una fecha cuando lo que importa es cuánto lleva
// esperando. La fecha exacta se queda en el title, para quien la necesite.
function haceCuanto(iso) {
  if (!iso) return '';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'desde ayer';
  return `hace ${dias} días`;
}

// «2 en Calidad», no «1 en Calidad · 1 en Calidad». Dos tipos de pendiente del
// mismo módulo son dos viajes al mismo lugar, así que se cuentan juntos.
function resumirPorModulo(grupos) {
  const porModulo = new Map();
  for (const g of grupos) porModulo.set(g.modulo, (porModulo.get(g.modulo) || 0) + g.asuntos.length);
  return [...porModulo].map(([modulo, n]) => `${n} en ${modulo}`).join(' · ');
}

// La bandeja se ordena por módulo y, dentro de cada módulo, por tipo de tarea:
// no es lo mismo tener quince cosas por aprobar que quince por capturar, y con
// todo revuelto en una sola lista había que leerla entera para saber qué tocaba.
// Los botones de arriba filtran por módulo.
function agruparAvisos(grupos, tipos) {
  const modulos = [];
  for (const g of grupos) {
    let m = modulos.find((x) => x.modulo === g.modulo);
    if (!m) { m = { modulo: g.modulo, total: 0, tipos: [] }; modulos.push(m); }
    m.total += g.asuntos.length;
    const clave = g.tipo || 'aprobar';
    let t = m.tipos.find((x) => x.clave === clave);
    if (!t) {
      t = {
        clave,
        etiqueta: (tipos.find((x) => x.clave === clave) || {}).etiqueta || 'Pendientes',
        corta: (tipos.find((x) => x.clave === clave) || {}).corta,
        orden: Math.max(0, tipos.findIndex((x) => x.clave === clave)),
        grupos: [],
      };
      m.tipos.push(t);
    }
    t.grupos.push(g);
  }
  for (const m of modulos) m.tipos.sort((a, b) => a.orden - b.orden);
  return modulos.sort((a, b) => b.total - a.total);
}

async function vistaNotificaciones(parte, dias) {
  const enAtendidas = parte === 'atendidas';
  // Al llegar aquí ya no se viene «de los avisos»: se está en ellos.
  estado.desde_avisos = 0;
  encabezado('Notificaciones', enAtendidas ? 'Lo que ya resolviste' : 'Lo que está esperando algo de ti');

  // Las dos pestañas van arriba y cada una dice cuántos trae: se piden las dos
  // listas a la vez para poder poner los dos números.
  const cuantos = dias || 30;
  const [pend, aten] = await Promise.all([
    api('GET', '/api/notificaciones'),
    api('GET', `/api/notificaciones/atendidas?dias=${cuantos}`),
  ]);
  const actual = enAtendidas ? aten : pend;
  const tipos = (actual.tipos || []).map((t) => (enAtendidas
    ? { ...t, etiqueta: t.atendido || t.etiqueta, corta: t.corta_atendido || t.corta } : t));
  const modulos = agruparAvisos(actual.grupos, tipos);
  const periodo = { 7: 'la última semana', 30: 'el último mes', 90: 'los últimos 3 meses' }[cuantos] || `${cuantos} días`;
  const urgentes = pend.grupos.reduce((n, g) => n + g.asuntos.filter((a) => a.urgente).length, 0);

  const fila = (g, a) => enAtendidas ? `
    <button class="fila-aviso" data-ir="${esc(a.destino)}">
      <span class="marca-fila hecho"></span>
      <span class="que"><b>${esc(a.titulo)}</b><small>${esc(a.detalle || '')}</small></span>
      <span class="cuando" title="${esc(a.en || '')}">${esc(haceCuanto(a.en))}</span>
    </button>` : `
    <button class="fila-aviso" data-ir="${esc(a.destino || g.destino)}" data-aviso>
      <span class="marca-fila ${a.urgente ? 'urgente' : ''}"></span>
      <span class="que"><b>${esc(a.titulo)}</b><small>${esc(a.detalle || '')}</small></span>
      ${a.urgente ? '<span class="etiqueta roja">Urgente</span>' : ''}
      <span class="cuando" title="${esc(a.desde || '')}">${esc(haceCuanto(a.desde))}</span>
    </button>`;

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span><span>Notificaciones</span>
    </div>
    <div id="mensajes"></div>

    <div class="pestanas-avisos" role="tablist">
      <button role="tab" aria-selected="${!enAtendidas}" data-ir-hash="#/notificaciones">
        Por atender <span class="cuenta">${pend.total}</span>
        ${urgentes ? `<small>${urgentes} urgente(s)</small>` : ''}
      </button>
      <button role="tab" aria-selected="${enAtendidas}" data-ir-hash="#/notificaciones/atendidas">
        Atendidas <span class="cuenta">${aten.total}</span>
        <small>${esc(periodo)}</small>
      </button>
    </div>

    ${enAtendidas ? `
      <div class="chips-filtro">
        ${[[7, 'Última semana'], [30, 'Último mes'], [90, 'Últimos 3 meses']].map(([n, texto]) => `
          <button class="chip-filtro" aria-pressed="${n === cuantos}" data-dias="${n}">${texto}</button>`).join('')}
      </div>` : ''}

    ${modulos.length > 1 ? `
      <div class="chips-filtro">
        <button class="chip-filtro" aria-pressed="true" data-filtro-modulo="">Todos · ${actual.total}</button>
        ${modulos.map((m) => `
          <button class="chip-filtro" aria-pressed="false" data-filtro-modulo="${esc(m.modulo)}">${esc(m.modulo)} · ${m.total}</button>`).join('')}
      </div>` : ''}

    ${modulos.map((m) => `
      <section class="bloque-avisos" data-modulo="${esc(m.modulo)}">
        <h2>${esc(m.modulo)} <span class="etiqueta ${enAtendidas ? 'verde' : 'azul'}">${m.total}</span></h2>
        ${m.tipos.map((t) => t.grupos.map((g) => `
          <div class="grupo-avisos">
            <p class="rotulo-grupo" title="${esc(g.ayuda || '')}">
              <span class="tipo tipo-${esc(t.clave)}" title="${esc(t.etiqueta)}">${esc(t.corta || t.etiqueta)}</span>
              <span>${esc(g.etiqueta)}</span>
              ${g.personal && !enAtendidas ? '<span class="etiqueta verde">Solo para ti</span>' : ''}
            </p>
            ${g.asuntos.map((a) => fila(g, a)).join('')}
          </div>`).join('')).join('')}
      </section>`).join('')}

    ${actual.total ? '' : `
      <section class="panel">
        <div class="vacio">
          ${enAtendidas
            ? `No hay nada que hayas resuelto en ${esc(periodo)}.`
            : pend.puede_aprobar
              ? 'Nada espera por ti. Cuando alguien te mande algo o te regresen un documento, aparece aquí.'
              : 'Tu puesto no aprueba nada por ahora. Cuando te den un permiso de aprobación, lo que espere por ti aparece aquí.'}
        </div>
      </section>`}`;

  // Al entrar a atender uno se recuerda cuántos quedaban: la barra de arriba
  // enseña el camino de regreso mientras se esté fuera de la bandeja.
  vista.querySelectorAll('[data-ir]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.hasAttribute('data-aviso')) estado.desde_avisos = pend.total;
      location.hash = b.dataset.ir;
    });
  });
  vista.querySelectorAll('[data-dias]').forEach((b) => {
    b.addEventListener('click', () => vistaNotificaciones('atendidas', Number(b.dataset.dias)));
  });
  const filtros = [...vista.querySelectorAll('[data-filtro-modulo]')];
  for (const boton of filtros) {
    boton.addEventListener('click', () => {
      const cual = boton.dataset.filtroModulo;
      for (const otro of filtros) otro.setAttribute('aria-pressed', String(otro === boton));
      vista.querySelectorAll('.bloque-avisos[data-modulo]').forEach((zona) => {
        zona.hidden = !!cual && zona.dataset.modulo !== cual;
      });
    });
  }
}

// ================================================================== almacén

// El módulo trabaja siempre sobre el mismo catálogo, así que se pide una vez y
// se guarda: en la tablet, volver a bajar 121 productos en cada pantalla se
// nota.
async function catalogosAlmacen() {
  if (!estado.catalogos_almacen) estado.catalogos_almacen = await api('GET', '/api/almacen/catalogos');
  return estado.catalogos_almacen;
}

const numero = (n) => Number(n || 0).toLocaleString('es-MX');

const CLASE_EXISTENCIA = {
  sin_stock: 'roja', critico: 'roja', bajo: 'ambar', ok: 'verde',
};
const TEXTO_EXISTENCIA = {
  sin_stock: 'Sin stock', critico: 'Crítico', bajo: 'Bajo', ok: 'OK',
};

const ETIQUETA_DOCUMENTO = {
  borrador: ['ambar', 'En captura'],
  en_calidad: ['azul', 'En Calidad'],
  por_autorizar: ['azul', 'Por aprobar'],
  pendiente_recibir: ['azul', 'Pendiente de recibir'],
  recibido: ['verde', 'Recibido'],
  aplicada: ['verde', 'Aplicada'],
  aplicado: ['verde', 'Aplicado'],
  cancelada: ['roja', 'Cancelada'],
  cancelado: ['roja', 'Cancelado'],
};

const insigniaDocumento = (estadoDoc) => {
  const [color, texto] = ETIQUETA_DOCUMENTO[estadoDoc] || ['', estadoDoc];
  return `<span class="etiqueta ${color}">${esc(texto)}</span>`;
};

// Migaja del módulo. Con `hoja` la sección se vuelve un enlace y la hoja queda
// como el último escalón: es la manera de volver a la lista desde el documento
// que se está capturando sin pasar por el menú.
const migajaModulo = (modulo, inicio, seccion, destinoSeccion, hoja) => `
  <div class="migaja">
    <button data-ir-hash="#/menu">← Menú</button><span>/</span>
    ${seccion ? `<button data-ir-hash="${inicio}">${esc(modulo)}</button>` : `<span>${esc(modulo)}</span>`}
    ${seccion ? `<span>/</span>${destinoSeccion
      ? `<button data-ir-hash="${destinoSeccion}">${esc(seccion)}</button>`
      : `<span>${esc(seccion)}</span>`}` : ''}
    ${hoja ? `<span>/</span><span>${esc(hoja)}</span>` : ''}
  </div>`;

const migajaAlmacen = (seccion, destinoSeccion, hoja) =>
  migajaModulo('Almacén', '#/almacen', seccion, destinoSeccion, hoja);

// --- portada del módulo ---

async function vistaAlmacen() {
  encabezado('Almacén', 'Existencias, movimientos, traspasos y conteos');
  const t = await api('GET', '/api/almacen/tablero');

  const pendientes = Object.values(t.pendientes).reduce((s, n) => s + n, 0);
  const lineaPendientes = [
    [t.pendientes.entradas_en_calidad, 'entrada(s) esperando a Calidad'],
    [t.pendientes.entradas_por_autorizar, 'entrada(s) por aprobar'],
    [t.pendientes.retiros_por_recibir, 'retiro(s) pendiente(s) de recibir'],
    [t.pendientes.reingresos_por_aprobar, 're-ingreso(s) de retiro por aprobar'],
    [t.pendientes.salidas_calidad_por_aprobar, 'salida(s) por calidad por aprobar'],
    [t.pendientes.salidas_por_autorizar, 'salida(s) por aprobar'],
    [t.pendientes.traspasos_por_aprobar, 'traspaso(s) por aprobar'],
    [t.pendientes.traspasos_en_transito, 'traspaso(s) con Tránsito'],
    [t.pendientes.traspasos_por_confirmar, 'traspaso(s) por confirmar al llegar'],
    [t.pendientes.devoluciones_por_autorizar, 'devolución(es) por aprobar'],
    [t.pendientes.conteos_por_contar, 'conteo(s) por contar'],
    [t.pendientes.conteos_por_autorizar, 'conteo(s) por aprobar'],
    [t.pendientes.por_corregir, 'documento(s) regresado(s) a corregir'],
  ].filter(([n]) => n).map(([n, texto]) => `${n} ${texto}`).join(' · ');

  // La portada es un índice, no un informe. Antes traía las tablas de material
  // por reponer y de existencia por tipo desplegadas de entrada: quien abría
  // Almacén para capturar una salida tenía que pasar por encima de 300 renglones
  // que no venía a ver. Esas tablas ahora viven dentro de Inventario, que es
  // donde uno va cuando lo que quiere es justamente mirar existencias.
  const accesos = [
    ['#/almacen/entradas', 'Entradas', 'Material que llega de un proveedor. Pasa por Calidad antes de sumar.',
      t.pendientes.entradas_por_autorizar],
    ['#/almacen/retiros', 'Retiros', 'Lo que se pidió de Mercado Libre Full o Amazon FBA. Calidad lo re-ingresa al llegar.',
      t.pendientes.retiros_por_recibir + t.pendientes.reingresos_por_aprobar],
    ['#/almacen/salidas', 'Salidas', 'Envíos de ventas por la ODT de la semana o por fuera de ella.',
      t.pendientes.salidas_por_autorizar],
    ['#/almacen/traspasos', 'Traspasos', 'Material que cambia de bodega. Casi siempre lo pide la ODT.',
      t.pendientes.traspasos_por_aprobar + t.pendientes.traspasos_por_confirmar],
    ['#/almacen/devoluciones', 'Devoluciones', 'Material rechazado por el CEDIS o por el cliente.'],
    ['#/almacen/conteos', 'Conteos', 'Conteo semanal por bodega y el ajuste que sale de él.'],
    ['#/almacen/inventario', 'Inventario', 'Existencias, lo que hay que reponer y el resumen por tipo.'],
    ...(permiso('almacen_carga_inicial')
      ? [['#/almacen/carga-inicial', 'Existencia inicial', 'El punto de partida del inventario: se carga desde Excel.']] : []),
  ];

  vista.innerHTML = `
    ${migajaAlmacen()}
    <div id="mensajes"></div>

    ${pendientes ? `
      <div class="aviso pendientes" style="cursor:default">
        <span class="cuenta">${pendientes}</span>
        <span><b>Pendiente(s) de atención.</b>
          <small>${esc(lineaPendientes)}</small></span>
      </div>` : ''}

    <div class="cifras-almacen">
      <div class="cifra"><b>${numero(t.inventario.unidades)}</b><span>unidades en existencia</span></div>
      ${t.inventario.por_bodega.map((b) => `
        <div class="cifra"><b>${numero(b.unidades)}</b><span>en ${esc(b.nombre)}</span></div>`).join('')}
      <div class="cifra ${t.inventario.sin_stock ? 'alerta' : ''}">
        <b>${t.inventario.sin_stock}</b><span>sin stock</span></div>
      <div class="cifra ${t.inventario.criticos ? 'alerta' : ''}">
        <b>${t.inventario.criticos}</b><span>bajo el mínimo</span></div>
      <div class="cifra"><b>${t.movimientos.semana}</b><span>movimientos esta semana</span></div>
    </div>

    <div class="rejilla-tareas">
      ${accesos.map(([destino, titulo, texto, cuenta]) => `
        <button class="tarea" data-ir-hash="${destino}">
          <b>${esc(titulo)}${cuenta ? ` <span class="etiqueta ambar">${cuenta}</span>` : ''}</b>
          <span class="meta">${esc(texto)}</span>
        </button>`).join('')}
    </div>`;
}

// --- inventario ---

// Inventario tiene tres maneras de mirar lo mismo, y se entra a una a la vez.
// Antes «lo que hay que reponer» y «existencia por tipo» estaban desplegadas en
// la portada de Almacén, donde estorbaban a quien venía a capturar. Aquí sí se
// vienen a ver, y cada una es una pestaña porque son tres preguntas distintas:
// cuánto hay de cada cosa, qué se está acabando, y cómo se reparte por familia.
const PARTES_INVENTARIO = [
  { clave: 'existencias', etiqueta: 'Existencias' },
  { clave: 'reponer', etiqueta: 'Hay que reponer' },
  { clave: 'tipos', etiqueta: 'Por tipo de material' },
];

async function vistaAlmacenInventario(parte) {
  const actual = PARTES_INVENTARIO.find((p) => p.clave === parte) || PARTES_INVENTARIO[0];
  encabezado('Inventario', actual.etiqueta);
  const { bodegas, productos } = await api('GET', '/api/almacen/inventario');

  vista.innerHTML = `
    ${migajaAlmacen('Inventario')}
    <div id="mensajes"></div>
    <div class="pestanas" role="tablist">
      ${PARTES_INVENTARIO.map((p) => `
        <button role="tab" aria-selected="${p.clave === actual.clave}"
                data-parte="${p.clave}">${p.etiqueta}</button>`).join('')}
    </div>
    <div id="parte-inventario"></div>`;

  vista.querySelectorAll('[data-parte]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/almacen/inventario/${b.dataset.parte}`; });
  });

  const destino = document.getElementById('parte-inventario');
  if (actual.clave === 'existencias') pintarExistencias(destino, bodegas, productos);
  if (actual.clave === 'reponer') pintarReponer(destino, bodegas, productos);
  if (actual.clave === 'tipos') pintarPorTipo(destino, bodegas, productos);
}

function pintarExistencias(destino, bodegas, productos) {
  const tipos = [...new Set(productos.map((p) => p.tipo_material).filter(Boolean))].sort();
  const partidas = [...new Set(productos.filter((p) => p.especial).map((p) => p.subagrupador).filter(Boolean))].sort();

  destino.innerHTML = `
    <p class="explica" style="padding-left:0">
      Nadie captura aquí. Cada número es la suma de los movimientos de ese producto
      en esa bodega, y se puede rastrear renglón por renglón:
      <b>toca cualquier producto</b> para ver su consolidado, qué movimientos tuvo
      y en qué periodo.
    </p>
    <section class="panel">
      <h2>Existencias <span class="etiqueta azul">${productos.length} productos</span></h2>
      <div class="filtros-almacen">
        <input type="search" id="buscar-producto" placeholder="Buscar por nombre, SKU o modelo…">
        <select id="filtro-tipo">
          <option value="">Todos los tipos</option>
          ${tipos.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
          ${partidas.length ? `<optgroup label="Producción especial">
            <option value="especial:">Toda la producción especial</option>
            ${partidas.map((x) => `<option value="especial:${esc(x)}">${esc(x)}</option>`).join('')}
          </optgroup>` : ''}
        </select>
        <select id="filtro-estado">
          <option value="">Toda situación</option>
          <option value="alerta">Solo lo que hay que reponer</option>
          <option value="sin_stock">Sin stock</option>
          <option value="critico">Bajo el mínimo</option>
        </select>
        ${permiso('almacen_reportes') ? '<button class="btn" id="exportar-inventario">Descargar CSV</button>' : ''}
      </div>
      <div class="desliza"><table class="captura" id="tabla-inventario">
        <thead><tr>
          <th class="fila-titulo">Producto</th><th>SKU</th><th>Modelo</th><th>Tipo</th>
          ${bodegas.map((b) => `<th>${esc(b.nombre)}<br><small>${esc(b.clave)}</small></th>`).join('')}
          <th>Total</th><th>Mínimo</th><th>Situación</th><th>Muestreo</th>
        </tr></thead>
        <tbody>${productos.map((p) => `
          <tr data-busca="${esc(`${p.nombre} ${p.sku} ${p.modelo || ''} ${p.subagrupador || ''}`.toLowerCase())}"
              data-tipo="${esc(p.tipo_material || '')}" data-estado="${p.estado}"
              data-especial="${p.especial ? esc(p.subagrupador || '') : ''}"
              class="clicable ${p.especial ? 'es-especial' : ''}" data-producto="${p.id}">
            <td class="fila-titulo">${p.imagen ? `<img class="imagen-renglon" data-archivo="${esc(p.imagen)}" alt="">` : ''}${esc(p.nombre)}
              ${p.especial ? `<br><small class="descripcion-rollo">Producción especial · ${esc(p.subagrupador || 'sin partida')}${
  p.descripcion ? ` · ${esc(p.descripcion)}` : ''}</small>` : ''}</td>
            <td><small>${esc(p.sku)}</small></td>
            <td>${esc(p.modelo || '—')}</td>
            <td><small>${esc(p.tipo_material || '—')}</small></td>
            ${bodegas.map((b) => `<td>${numero(p.bodegas[b.clave])}</td>`).join('')}
            <td><b>${numero(p.total)}</b></td>
            <td>${p.stock_minimo ? numero(p.stock_minimo) : '—'}</td>
            <td><span class="etiqueta ${CLASE_EXISTENCIA[p.estado]}">${TEXTO_EXISTENCIA[p.estado]}</span></td>
            <td>${p.requiere_muestreo
              ? `<small title="Se muestrea contra «${esc(p.modelo_calidad || '')}»">Sí</small>`
              : '<small style="color:var(--tinta-suave)">No</small>'}</td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="pie"><span class="resumen" id="resumen-inventario"></span></div>
    </section>`;

  const filas = [...destino.querySelectorAll('#tabla-inventario tbody tr')];
  const buscar = document.getElementById('buscar-producto');
  const porTipo = document.getElementById('filtro-tipo');
  const porEstado = document.getElementById('filtro-estado');

  const filtrar = () => {
    const texto = buscar.value.trim().toLowerCase();
    let visibles = 0;
    for (const fila of filas) {
      const estadoFila = fila.dataset.estado;
      // El filtro de tipo trae también las partidas de producción especial:
      // «especial:» es toda, «especial:<partida>» es una sola.
      const tipoPedido = porTipo.value;
      const esFiltroEspecial = tipoPedido.startsWith('especial:');
      const partidaPedida = esFiltroEspecial ? tipoPedido.slice(9) : '';
      const pasa = (!texto || fila.dataset.busca.includes(texto))
        && (!tipoPedido
          || (esFiltroEspecial
            ? (fila.classList.contains('es-especial')
              && (!partidaPedida || fila.dataset.especial === partidaPedida))
            : fila.dataset.tipo === tipoPedido))
        && (!porEstado.value
          || (porEstado.value === 'alerta' ? estadoFila !== 'ok' : estadoFila === porEstado.value));
      fila.style.display = pasa ? '' : 'none';
      if (pasa) visibles++;
    }
    document.getElementById('resumen-inventario').textContent =
      `${visibles} de ${filas.length} productos a la vista.`;
  };
  [buscar, porTipo, porEstado].forEach((c) => c.addEventListener('input', filtrar));
  filtrar();

  const exportar = document.getElementById('exportar-inventario');
  if (exportar) exportar.addEventListener('click', () => descargarCSV('/api/almacen/exportar.csv'));

  for (const fila of filas) {
    fila.addEventListener('click', () => { location.hash = `#/almacen/producto/${fila.dataset.producto}`; });
  }
  cargarImagenesPendientes(destino);
}

// --- el consolidado de un producto ---
//
// Se llega tocando un producto en Inventario. El total del inventario dice
// cuánto hay; esto dice además de dónde salió: qué movimientos tuvo, de qué
// documento vino cada uno y cómo cambió en el periodo que se quiera mirar. Es
// la pantalla a la que uno va cuando un número no cuadra.

const ATAJOS_PERIODO = [
  ['Últimas 4 semanas', 27],
  ['Últimos 3 meses', 89],
  ['Este año', null],
];

async function vistaAlmacenProducto(id, desde, hasta) {
  const consulta = desde && hasta ? `?desde=${desde}&hasta=${hasta}` : '';
  const d = await api('GET', `/api/almacen/productos/${id}${consulta}`);
  const pr = d.producto;
  encabezado(pr.nombre, `${pr.sku}${pr.modelo ? ` · ${pr.modelo}` : ''} · ${pr.tipo_material || 'sin tipo'}`);

  const cambio = d.total - d.total_al_inicio;
  const irA = (dd, hh) => `#/almacen/producto/${id}/${dd}/${hh}`;
  const hoy = hoyLocal();

  vista.innerHTML = `
    ${migajaAlmacen('Inventario', '#/almacen/inventario', pr.nombre)}
    <div id="mensajes"></div>
    ${pr.imagen ? `
      <div class="ficha-unidad">
        <img data-archivo="${esc(pr.imagen)}" alt="${esc(pr.nombre)}">
        <span><b>${esc(pr.nombre)}</b><small>Imagen del material ${esc(pr.modelo_calidad || '')}</small></span>
      </div>` : ''}

    <div class="cifras-almacen">
      <div class="cifra"><b>${numero(d.total)}</b><span>${esc(pr.unidad)} en existencia</span></div>
      ${d.bodegas.map((b) => `
        <div class="cifra"><b>${numero(b.existencia)}</b><span>en ${esc(b.nombre)}</span></div>`).join('')}
      <div class="cifra ${d.estado !== 'ok' ? 'alerta' : ''}">
        <b>${TEXTO_EXISTENCIA[d.estado]}</b>
        <span>${pr.stock_minimo ? `mínimo ${numero(pr.stock_minimo)}` : 'sin mínimo'}</span></div>
      <div class="cifra"><b>${cambio > 0 ? '+' : ''}${numero(cambio)}</b><span>en el periodo</span></div>
    </div>

    <section class="panel">
      <h2>El periodo que se mira</h2>
      <div class="rango-fechas">
        <label>Desde <input type="date" id="pr-desde" value="${d.desde}" max="${hoy}"></label>
        <label>Hasta <input type="date" id="pr-hasta" value="${d.hasta}" max="${hoy}"></label>
        <button class="btn primario" id="pr-ver">Ver</button>
        ${ATAJOS_PERIODO.map(([texto, dias], i) => `
          <button class="btn" data-atajo="${i}">${texto}</button>`).join('')}
      </div>
      <p class="explica">
        Empezó el periodo con ${numero(d.total_al_inicio)} ${esc(pr.unidad)} y hoy hay
        ${numero(d.total)}. ${pr.requiere_muestreo
          ? `Este producto se muestrea en Calidad contra «${esc(pr.modelo_calidad || '')}».`
          : 'Este producto no se muestrea: Calidad confirma cuánto llegó bien.'}
      </p>
    </section>

    <section class="panel">
      <h2>Movimientos que tuvo <span class="etiqueta azul">${d.por_tipo.length} tipo(s)</span></h2>
      ${d.por_tipo.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Tipo de movimiento</th><th>Veces</th>
            <th>${esc(pr.unidad.charAt(0).toUpperCase() + pr.unidad.slice(1))}</th><th>Efecto en la existencia</th></tr></thead>
          <tbody>${d.por_tipo.map((t) => `
            <tr>
              <td class="fila-titulo">${esc(t.etiqueta)}</td>
              <td>${t.movimientos}</td>
              <td><b>${numero(t.unidades)}</b></td>
              <td>${t.neto === 0
                ? '<small style="color:var(--tinta-suave)">no cambia el total</small>'
                : `<span class="delta ${t.neto > 0 ? 'buena' : 'mala'}">${t.neto > 0 ? '+' : ''}${numero(t.neto)}</span>`}</td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">Ningún movimiento en este periodo.</div>'}
    </section>

    <section class="panel">
      <h2>Renglón por renglón <span class="etiqueta azul">${d.movimientos.length}</span></h2>
      ${d.movimientos.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Fecha</th><th>Tipo</th><th>Cantidad</th>
            <th>De</th><th>A</th><th>Documento</th><th>Quién</th><th>Nota</th></tr></thead>
          <tbody>${d.movimientos.map((m) => `
            <tr>
              <td class="fila-titulo">${fechaCorta(m.fecha)}</td>
              <td>${esc(m.origen_tipo === 'carga_inicial' ? 'Carga inicial' : (TIPO_MOVIMIENTO[m.tipo] || m.tipo))}</td>
              <td><b class="${m.neto < 0 ? 'fuera-odt' : ''}">${m.neto > 0 ? '+' : ''}${numero(m.neto || m.unidades)}</b></td>
              <td>${esc(m.origen || '—')}</td>
              <td>${esc(m.destino || '—')}</td>
              <td>${enlaceMovimiento(m)}</td>
              <td>${esc(m.quien || '—')}</td>
              <td style="text-align:left"><small>${esc(m.notas || '')}</small></td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">Sin movimientos en el periodo.</div>'}
      <div class="pie"><span class="resumen">
        Un traspaso sale de una bodega y entra en otra: no cambia el total.
      </span></div>
    </section>`;

  cargarImagenesPendientes();
  const desdeCampo = document.getElementById('pr-desde');
  const hastaCampo = document.getElementById('pr-hasta');
  document.getElementById('pr-ver').addEventListener('click', () => {
    location.hash = irA(desdeCampo.value, hastaCampo.value);
  });
  vista.querySelectorAll('[data-atajo]').forEach((b) => {
    b.addEventListener('click', () => {
      const [, dias] = ATAJOS_PERIODO[Number(b.dataset.atajo)];
      const fin = new Date();
      const inicio = dias === null ? new Date(fin.getFullYear(), 0, 1) : new Date(fin.getTime() - dias * 86400000);
      const iso = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      location.hash = irA(iso(inicio), iso(fin));
    });
  });
}

const TIPO_MOVIMIENTO = {
  entrada: 'Entrada', retiro: 'Re-ingreso de retiro', salida: 'Salida',
  devolucion: 'Devolución', traspaso: 'Traspaso', ajuste: 'Ajuste por conteo',
};

// De qué documento salió el movimiento. Es el enlace que permite ir del número
// al papel que lo produjo, que es justo lo que el Excel no podía dar.
function enlaceMovimiento(m) {
  const destinos = {
    entrada: (x) => `#/almacen/entrada/${x}`,
    salida: (x) => `#/almacen/salida/${x}`,
    devolucion: (x) => `#/almacen/devolucion/${x}`,
    conteo: (x) => `#/almacen/conteo/${x}`,
    reingreso: (x) => `#/calidad/reingreso/${x}`,
  };
  const aDonde = destinos[m.origen_tipo];
  const texto = esc(m.referencia || m.origen_tipo || '—');
  if (!aDonde || !m.origen_id) return `<small>${texto}</small>`;
  return `<button class="btn" data-ir-hash="${aDonde(m.origen_id)}">${texto}</button>`;
}

// Lo que se está acabando, del más apurado al menos. Sin stock primero, porque
// eso ya detuvo algo; después lo que va bajo su mínimo, que todavía da tiempo.
function pintarReponer(destino, bodegas, productos) {
  const alertas = productos
    .filter((p) => p.estado === 'sin_stock' || p.estado === 'critico')
    .sort((a, b) => a.total - b.total);

  if (!alertas.length) {
    destino.innerHTML = `
      <section class="panel">
        <h2>Nada que reponer</h2>
        <div class="vacio">
          Ningún producto está sin stock ni por debajo de su mínimo. Los mínimos se
          ajustan en el catálogo de productos.
        </div>
      </section>`;
    return;
  }

  const sinStock = alertas.filter((p) => p.estado === 'sin_stock').length;
  destino.innerHTML = `
    <section class="panel">
      <h2>Hay que reponer <span class="etiqueta roja">${alertas.length}</span></h2>
      <p class="explica">
        ${sinStock ? `${sinStock} producto(s) sin nada de existencia y ` : ''}${alertas.length - sinStock}
        por debajo de su mínimo. Del más apurado al menos.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Producto</th><th>Modelo</th><th>Tipo</th>
          ${bodegas.map((b) => `<th>${esc(b.clave)}</th>`).join('')}
          <th>Total</th><th>Mínimo</th><th>Falta</th><th>Situación</th></tr></thead>
        <tbody>${alertas.map((a) => `
          <tr>
            <td class="fila-titulo">${esc(a.nombre)}</td>
            <td>${esc(a.modelo || '—')}</td>
            <td><small>${esc(a.tipo_material || '—')}</small></td>
            ${bodegas.map((b) => `<td>${numero(a.bodegas[b.clave])}</td>`).join('')}
            <td><b>${numero(a.total)}</b></td>
            <td>${a.stock_minimo ? numero(a.stock_minimo) : '—'}</td>
            <td>${a.stock_minimo ? `<b>${numero(Math.max(0, a.stock_minimo - a.total))}</b>` : '—'}</td>
            <td><span class="etiqueta ${CLASE_EXISTENCIA[a.estado]}">${TEXTO_EXISTENCIA[a.estado]}</span></td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="pie">
        <span class="resumen">La columna «Falta» es cuánto hay que meter para volver al mínimo.</span>
      </div>
    </section>`;
}

// El resumen por familia de material: sirve para ver de un vistazo dónde está
// concentrado el inventario y qué familia trae problemas.
function pintarPorTipo(destino, bodegas, productos) {
  const porTipo = new Map();
  for (const p of productos) {
    const tipo = p.tipo_material || 'Sin clasificar';
    if (!porTipo.has(tipo)) porTipo.set(tipo, { tipo, bodegas: {}, total: 0, productos: 0, alerta: 0 });
    const t = porTipo.get(tipo);
    for (const b of bodegas) t.bodegas[b.clave] = (t.bodegas[b.clave] || 0) + p.bodegas[b.clave];
    t.total += p.total;
    t.productos++;
    if (p.estado === 'sin_stock' || p.estado === 'critico') t.alerta++;
  }
  const filas = [...porTipo.values()].sort((a, b) => b.total - a.total);
  const total = filas.reduce((s, f) => s + f.total, 0);

  destino.innerHTML = `
    <section class="panel">
      <h2>Existencia por tipo de material <span class="etiqueta azul">${filas.length} tipos</span></h2>
      <p class="explica">Cada familia de producto, con lo que tiene en cada bodega y cuánto pesa en el total.</p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Tipo</th>
          ${bodegas.map((b) => `<th>${esc(b.nombre)}</th>`).join('')}
          <th>Total</th><th>Del total</th><th>Productos</th><th>En alerta</th></tr></thead>
        <tbody>${filas.map((f) => `
          <tr>
            <td class="fila-titulo">${esc(f.tipo)}</td>
            ${bodegas.map((b) => `<td>${numero(f.bodegas[b.clave])}</td>`).join('')}
            <td><b>${numero(f.total)}</b></td>
            <td>${total ? `${Math.round((f.total / total) * 100)}%` : '—'}</td>
            <td>${f.productos}</td>
            <td>${f.alerta ? `<span class="etiqueta roja">${f.alerta}</span>` : '—'}</td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="pie"><span class="resumen">${numero(total)} unidades en total.</span></div>
    </section>`;
}

// La descarga va con el token de sesión, así que no puede ser un enlace directo:
// se pide con fetch y se entrega como archivo local, igual que las fotos.
async function descargarCSV(ruta) {
  const res = await fetch(ruta, { headers: { Authorization: `Bearer ${estado.token}` } });
  if (!res.ok) return mostrarMensaje('No se pudo generar el archivo.', 'error');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'inventario.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// --- documentos de almacén: entradas, salidas y devoluciones ---
//
// Los tres son la misma hoja: una cabecera que dice de dónde a dónde va el
// material y una lista de producto + cantidad. Lo que cambia entre ellos es qué
// se pide en la cabecera y qué hace falta para aplicarlos, así que eso —y solo
// eso— vive en DOCUMENTOS. La pantalla es una sola.

// 'api' es la puerta del documento (el detalle y sus acciones); 'apiLista' la de
// su lista, que puede ser otra cuando dos documentos comparten tabla. Un retiro
// y una entrada son la misma tabla con distinta fuente, y una salida por calidad
// es una salida con otro motivo: por eso 'claveRespuesta' dice cómo viene el
// documento en la respuesta y 'claveFoto' a qué ruta suben sus fotos.
const DOCUMENTOS = {
  entrada: {
    clave: 'entrada',
    modulo: 'Almacén',
    inicio: '#/almacen',
    plural: 'Entradas',
    singular: 'Entrada',
    lista: '#/almacen/entradas',
    detalle: (id) => `#/almacen/entrada/${id}`,
    api: '/api/almacen/entradas',
    apiLista: '/api/almacen/entradas?fuente=proveedor',
    apiRenglon: (id) => `/api/almacen/entrada-renglones/${id}`,
    sub: 'Material que llega de un proveedor',
  },
  retiro: {
    clave: 'retiro',
    modulo: 'Almacén',
    inicio: '#/almacen',
    plural: 'Retiros',
    singular: 'Retiro',
    lista: '#/almacen/retiros',
    detalle: (id) => `#/almacen/retiro/${id}`,
    api: '/api/almacen/entradas',
    apiLista: '/api/almacen/entradas?fuente=retiro',
    apiRenglon: (id) => `/api/almacen/entrada-renglones/${id}`,
    claveRespuesta: 'entrada',
    coleccion: 'entradas',
    sub: 'Lo que se pidió de Mercado Libre Full o Amazon FBA',
  },
  salida: {
    clave: 'salida',
    modulo: 'Almacén',
    inicio: '#/almacen',
    plural: 'Salidas',
    singular: 'Salida',
    lista: '#/almacen/salidas',
    detalle: (id) => `#/almacen/salida/${id}`,
    api: '/api/almacen/salidas',
    apiRenglon: (id) => `/api/almacen/salida-renglones/${id}`,
    sub: 'Envíos de ventas por la ODT o por fuera',
  },
  salida_calidad: {
    clave: 'salida_calidad',
    modulo: 'Calidad',
    inicio: '#/calidad',
    plural: 'Salidas por calidad',
    singular: 'Salida por calidad',
    lista: '#/calidad/salidas',
    detalle: (id) => `#/calidad/salida/${id}`,
    api: '/api/almacen/salidas',
    apiLista: '/api/almacen/salidas-calidad',
    apiAlta: '/api/almacen/salidas-calidad',
    apiRenglon: (id) => `/api/almacen/salida-renglones/${id}`,
    claveRespuesta: 'salida',
    coleccion: 'salidas',
    claveFoto: 'salida',
    sub: 'Material que se dañó estando en bodega',
  },
  devolucion: {
    clave: 'devolucion',
    modulo: 'Almacén',
    inicio: '#/almacen',
    plural: 'Devoluciones',
    singular: 'Devolución',
    lista: '#/almacen/devoluciones',
    detalle: (id) => `#/almacen/devolucion/${id}`,
    api: '/api/almacen/devoluciones',
    apiRenglon: (id) => `/api/almacen/devolucion-renglones/${id}`,
    sub: 'Material rechazado por el CEDIS o por el cliente',
  },
};

const claveDocumento = (tipo) => DOCUMENTOS[tipo].claveRespuesta || tipo;
const CLAVE_COLECCION = { entrada: 'entradas', salida: 'salidas', devolucion: 'devoluciones' };

// Cada documento con sus tres permisos: quien lo captura, quien lo aprueba y
// quien puede pedir que se corrija. Se reparten en Configuración → Permisos.
const PERMISOS_DOCUMENTO = {
  entrada: { capturar: 'entradas_capturar', aprobar: 'entradas_aprobar', corregir: 'entradas_corregir' },
  // Un retiro no se aprueba: se deja pendiente de recibir y se cierra cuando
  // llegó todo. Quien lo cierra es quien antes aprobaba las entradas.
  retiro: { capturar: 'retiros_capturar', aprobar: 'retiros_cerrar', corregir: 'retiros_cerrar' },
  salida: { capturar: 'salidas_capturar', aprobar: 'salidas_aprobar', corregir: 'salidas_corregir' },
  salida_calidad: { capturar: 'calidad_salida_pedir', aprobar: 'calidad_salida_aprobar', corregir: 'calidad_salida_aprobar' },
  devolucion: { capturar: 'devoluciones_capturar', aprobar: 'devoluciones_aprobar', corregir: 'devoluciones_corregir' },
};

// Lo que pidió corregir alguien, del más reciente al más antiguo.
function historialCorrecciones(correcciones) {
  if (!correcciones || !correcciones.length) return '';
  const ETAPA = {
    por_autorizar: 'Esperando aprobación', en_calidad: 'En Calidad', aplicada: 'Ya aplicada', aplicado: 'Ya aplicado',
  };
  return `
    <section class="panel">
      <h2>Correcciones pedidas <span class="etiqueta ambar">${correcciones.length}</span></h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Cuándo</th><th>Quién</th><th>Estaba</th><th>Nota</th></tr></thead>
        <tbody>${correcciones.map((c) => `
          <tr>
            <td class="fila-titulo">${esc(new Date(c.en).toLocaleString('es-MX'))}</td>
            <td>${esc(c.quien || '—')}</td>
            <td>${esc(ETAPA[c.estado_anterior] || c.estado_anterior)}</td>
            <td style="text-align:left">${esc(c.nota)}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>`;
}

async function vistaAlmacenLista(tipo) {
  const doc = DOCUMENTOS[tipo];
  encabezado(doc.plural, doc.sub);
  const datos = await api('GET', doc.apiLista || doc.api);
  const filas = datos[doc.coleccion || CLAVE_COLECCION[tipo]];

  const abiertos = filas.filter((f) => f.estado === 'borrador');
  const esperando = filas.filter((f) => ['en_calidad', 'por_autorizar', 'pendiente_recibir'].includes(f.estado));
  const cerrados = filas.filter((f) => ['aplicada', 'cancelada', 'recibido'].includes(f.estado));

  const detalleDe = (f) => {
    if (tipo === 'entrada') return `${esc(f.proveedor)} → ${esc(f.bodega)}`;
    if (tipo === 'retiro') {
      return `${esc(f.plataforma)} → ${esc(f.bodega)}`
        + (f.recibido !== undefined && f.estado !== 'borrador'
          ? ` · ${numero(f.recibido)} de ${numero(f.unidades)} recibidas`
          + (f.reingresos ? ` en ${f.reingresos} entrega(s)` : '') : '');
    }
    if (tipo === 'salida_calidad') return `${esc(f.bodega)} · ${esc((f.notas || '').slice(0, 60))}`;
    if (tipo === 'salida') {
      const motivo = (MOTIVOS_SALIDA_TEXTO[f.motivo] || f.motivo);
      return `${esc(f.bodega)} → ${esc(f.bodega_destino || f.destino || motivo)}`;
    }
    return `${esc(f.quien || 'Sin anotar')} → ${esc(f.bodega)}`;
  };

  const tarjeta = (f) => `
    <button class="tarea ${f.estado}" data-abrir="${f.id}">
      ${f.estado === 'borrador' && f.correccion_nota ? '<span class="etiqueta roja">Por corregir</span>' : insigniaDocumento(f.estado)}
      <b>${esc(f.folio)}</b>
      <span class="meta">${detalleDe(f)} · ${fechaCorta(f.fecha)}</span>
      <span class="meta">${numero(f.unidades)} unidad(es) · capturó ${esc(f.capturo)}</span>
    </button>`;

  const bloque = (titulo, lista, color) => (lista.length ? `
    <section class="panel">
      <h2>${titulo} <span class="etiqueta ${color}">${lista.length}</span></h2>
      <div class="rejilla-tareas" style="padding:18px">${lista.map(tarjeta).join('')}</div>
    </section>` : '');

  const ESPERANDO = {
    entrada: 'Esperando a Calidad o autorización',
    retiro: 'Pendientes de recibir',
    salida_calidad: 'Esperando aprobación',
  };

  vista.innerHTML = `
    ${migajaModulo(doc.modulo, doc.inicio, doc.plural)}
    <div id="mensajes"></div>
    ${tipo === 'retiro' ? `
      <p class="explica" style="padding-left:0">
        Aquí se carga lo que se pidió en la plataforma. El retiro no mueve el
        inventario: queda pendiente de recibir, y lo que entra es cada re-ingreso
        que Calidad levanta cuando el material llega a la bodega.
      </p>` : ''}
    ${tipo === 'salida_calidad' ? `
      <p class="explica" style="padding-left:0">
        Material que ya estaba guardado y se dañó. Se explica qué pasó, se sube la
        evidencia y sale del inventario cuando quien tiene el permiso lo aprueba.
      </p>` : ''}
    ${permiso(PERMISOS_DOCUMENTO[tipo].capturar) ? `
      <div class="fila-botones" style="margin-bottom:18px">
        <button class="btn primario grande" id="nuevo-documento">+ ${
          tipo === 'retiro' ? 'Nuevo retiro' : `Nueva ${doc.singular.toLowerCase()}`}</button>
      </div>` : ''}
    ${abiertos.length ? bloque('En captura', abiertos, 'ambar')
      : '<section class="panel"><h2>En captura</h2><div class="vacio">No hay nada en captura.</div></section>'}
    ${bloque(ESPERANDO[tipo] || 'Esperando autorización', esperando, 'azul')}
    ${bloque(tipo === 'retiro' ? 'Recibidos y cerrados' : 'Cerradas', cerrados, 'verde')}`;

  vista.querySelectorAll('[data-abrir]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = doc.detalle(b.dataset.abrir); });
  });
  const nuevo = document.getElementById('nuevo-documento');
  if (nuevo) nuevo.addEventListener('click', () => abrirNuevoDocumento(tipo));
}

const MOTIVOS_SALIDA_TEXTO = {
  odt: 'Envío de ventas por la ODT',
  ventas_fuera: 'Envío de ventas directas',
  traspaso: 'Traspaso',
  calidad: 'Salida de material por calidad',
  otro: 'Otro motivo (de antes)',
};

// La cabecera se pide ANTES de capturar productos, igual que la remisión en
// Calidad: es lo que identifica el documento y no se cambia a media captura.
async function abrirNuevoDocumento(tipo) {
  const doc = DOCUMENTOS[tipo];
  const cat = await catalogosAlmacen();
  const opcionesBodega = cat.bodegas.map((b) => `<option value="${b.id}">${esc(b.nombre)} (${esc(b.clave)})</option>`).join('');

  // El CEDIS se escoge de la lista que el Administrador edita en Configuración →
  // Tránsito. Es la misma para el envío por la ODT y para la devolución: hablan
  // de los mismos lugares, y dos listas separadas acabarían no coincidiendo.
  const opcionesCedis = (cat.cedis || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  const campos = {
    entrada: `
      <div class="campo">
        <label for="d-proveedor">Proveedor</label>
        <select id="d-proveedor">
          ${cat.proveedores.filter((x) => !cat.plataformas.includes(x))
            .map((x) => `<option>${esc(x)}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="d-bodega">Bodega a la que llega</label>
        <select id="d-bodega">${opcionesBodega}</select>
      </div>
      <div class="campo">
        <label for="d-folio">Remisión <small>(opcional: si lo dejas vacío se numera solo)</small></label>
        <input type="text" id="d-folio" placeholder="Ej. 4471">
      </div>`,
    retiro: `
      <div class="campo">
        <label for="d-plataforma">¿De qué plataforma es el retiro?</label>
        <select id="d-plataforma">${cat.plataformas.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
      </div>
      <div class="campo">
        <label for="d-bodega">Bodega a la que va a llegar</label>
        <select id="d-bodega">${opcionesBodega}</select>
      </div>
      <div class="campo">
        <label for="d-folio">Folio del retiro en la plataforma <small>(opcional)</small></label>
        <input type="text" id="d-folio" placeholder="Ej. 4471">
      </div>`,
    salida: `
      <div class="campo">
        <label for="d-motivo">¿Qué tipo de salida es?</label>
        <select id="d-motivo">
          ${cat.motivos_salida.map((m) => `<option value="${m.clave}">${esc(m.etiqueta)}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="d-bodega">Bodega de la que sale</label>
        <select id="d-bodega">${opcionesBodega}</select>
      </div>
      <div class="campo" id="caja-cedis">
        <label for="d-cedis">¿A qué CEDIS va?</label>
        <select id="d-cedis">${opcionesCedis || '<option value="">No hay CEDIS en la lista</option>'}</select>
      </div>
      <div class="campo" id="caja-vxf" hidden>
        <label for="d-vxf">¿De qué orden de armado sale? <small>(Ventas directas)</small></label>
        <select id="d-vxf">
          ${(cat.ordenes_vxf || []).length
            ? cat.ordenes_vxf.map((o) => `<option value="${o.id}">${esc(o.folio)} · ${esc(o.cliente)}</option>`).join('')
            : '<option value="">No hay órdenes de armado abiertas</option>'}
        </select>
        <small class="nota-foto">El cliente y los productos se toman de la orden.</small>
      </div>`,
    salida_calidad: `
      <div class="campo">
        <label for="d-bodega">¿En qué bodega se hace la salida?</label>
        <select id="d-bodega">${opcionesBodega}</select>
      </div>
      <p class="explica" style="padding:0">
        El porqué y la foto se piden después, producto por producto: no todos los
        rollos salen por lo mismo.
      </p>`,
    devolucion: `
      <div class="campo">
        <label for="d-rechazo">¿Quién lo rechazó?</label>
        <select id="d-rechazo">
          ${cat.origenes_rechazo.map((o) => `<option value="${o.clave}">${esc(o.etiqueta)}</option>`).join('')}
        </select>
      </div>
      <div class="campo" id="caja-cedis-dev">
        <label for="d-cedis-dev">¿Qué CEDIS?</label>
        <select id="d-cedis-dev">${opcionesCedis || '<option value="">No hay CEDIS en la lista</option>'}</select>
      </div>
      <div class="campo" id="caja-cliente" hidden>
        <label for="d-quien">¿Qué cliente?</label>
        <input type="text" id="d-quien" placeholder="Nombre del cliente">
      </div>
      <div class="campo">
        <label for="d-bodega">Bodega a la que regresa</label>
        <select id="d-bodega">${opcionesBodega}</select>
      </div>
      <div class="campo">
        <label for="d-motivo-rechazo">¿Por qué lo rechazaron?</label>
        <textarea id="d-motivo-rechazo" rows="3" placeholder="Lo que dijo quien lo rechazó, con sus palabras."></textarea>
      </div>`,
  }[tipo];

  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Nueva ${esc(doc.singular)}">
      <h2>Nueva ${esc(doc.singular.toLowerCase())}</h2>
      <div class="cuerpo-modal">
        <div id="error-documento"></div>
        ${campos}
        <div class="campo">
          <label for="d-fecha">Fecha</label>
          <input type="date" id="d-fecha" value="${hoyLocal()}">
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-crear>Crear</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  // Los campos que solo aplican a una manera de capturar se esconden en vez de
  // pedirse siempre: preguntar el cliente de un envío que va a un CEDIS es una
  // pregunta sin respuesta, y en papel se quedaba en blanco.
  const motivo = capa.querySelector('#d-motivo');
  if (motivo) {
    motivo.addEventListener('change', () => {
      capa.querySelector('#caja-cedis').hidden = motivo.value !== 'odt';
      capa.querySelector('#caja-vxf').hidden = motivo.value !== 'ventas_fuera';
    });
  }
  const rechazo = capa.querySelector('#d-rechazo');
  if (rechazo) {
    rechazo.addEventListener('change', () => {
      capa.querySelector('#caja-cedis-dev').hidden = rechazo.value !== 'cedis';
      capa.querySelector('#caja-cliente').hidden = rechazo.value === 'cedis';
    });
  }

  capa.querySelector('[data-crear]').addEventListener('click', async () => {
    const valor = (sel) => (capa.querySelector(sel) || {}).value;
    const cuerpo = { fecha: valor('#d-fecha'), bodega_id: Number(valor('#d-bodega')) };
    if (tipo === 'entrada') {
      cuerpo.fuente = 'proveedor';
      cuerpo.proveedor = valor('#d-proveedor');
      cuerpo.folio = valor('#d-folio');
    } else if (tipo === 'retiro') {
      cuerpo.fuente = 'retiro';
      cuerpo.plataforma = valor('#d-plataforma');
      cuerpo.folio = valor('#d-folio');
    } else if (tipo === 'salida') {
      cuerpo.motivo = valor('#d-motivo');
      if (cuerpo.motivo === 'odt') cuerpo.destino = valor('#d-cedis');
      else cuerpo.vxf_id = Number(valor('#d-vxf')) || null;
    } else if (tipo === 'salida_calidad') {
      // Solo bodega y fecha: el motivo va en cada producto.
    } else {
      cuerpo.rechazo_de = valor('#d-rechazo');
      cuerpo.quien = cuerpo.rechazo_de === 'cedis' ? valor('#d-cedis-dev') : valor('#d-quien');
      cuerpo.motivo = valor('#d-motivo-rechazo');
    }

    const boton = capa.querySelector('[data-crear]');
    boton.disabled = true;
    try {
      const doc2 = DOCUMENTOS[tipo];
      const creado = await api('POST', doc2.apiAlta || doc2.api, cuerpo);
      cerrar();
      location.hash = doc2.detalle(creado[claveDocumento(tipo)].id);
    } catch (err) {
      capa.querySelector('#error-documento').innerHTML = avisoError(err.message);
      boton.disabled = false;
    }
  });
}

// --- captura de un documento ---

async function vistaAlmacenDocumento(tipo, id) {
  const doc = DOCUMENTOS[tipo];
  const respuesta = await api('GET', `${doc.api}/${id}`);
  const d = respuesta[claveDocumento(tipo)];
  estado.documento_almacen = { tipo, doc, d, faltantes: respuesta.faltantes || [],
    razones: respuesta.razones_autorizacion || [] };

  encabezado(`${doc.singular} ${d.folio}`, cabeceraDocumento(tipo, d));
  const editable = d.estado === 'borrador' && permiso(PERMISOS_DOCUMENTO[tipo].capturar);
  const cat = await catalogosAlmacen();

  vista.innerHTML = `
    ${migajaModulo(doc.modulo, doc.inicio, doc.plural, doc.lista, `${doc.singular} ${d.folio}`)}
    <div id="mensajes"></div>
    ${tiraConexiones([
      d.vxf && liga(`#/ventas-fuera/orden/${d.vxf.id}`, `Orden ${d.vxf.folio} · ${d.vxf.cliente}`),
      d.odt_id && d.odt_semana && liga(`#/produccion/odt/${d.odt_id}`, `ODT ${describirSemanaCorta(d.odt_semana)}`),
      d.recepcion_id && liga(`#/recepcion/${d.recepcion_id}`, `Calidad · remisión ${d.remision || d.folio}`),
      ...(d.reingresos || []).map((g) => liga(`#/calidad/reingreso/${g.id}`, `Re-ingreso ${g.folio}`)),
    ])}
    ${bandaDocumento(tipo, d, respuesta)}
    ${panelCabecera(tipo, d, editable, cat)}

    <section class="panel captura-almacen">
      <h2>Productos ${insigniaDocumento(d.estado)}</h2>
      ${d.renglones.length ? `
        <div class="desliza"><table class="captura" id="tabla-renglones">
          <thead><tr>
            <th class="fila-titulo">Producto</th><th>Modelo</th>
            ${columnasExtra(tipo).map((c) => `<th>${esc(c)}</th>`).join('')}
            <th style="min-width:120px">Cantidad</th>
            ${editable ? '<th></th>' : ''}
          </tr></thead>
          <tbody>${d.renglones.map((r) => filaRenglon(tipo, r, editable)).join('')}</tbody>
        </table></div>`
        : '<div class="vacio">Todavía no hay productos en este documento.</div>'}

      ${editable ? `
        <div class="agregar-renglon">
          <input type="search" id="buscar-agregar" list="lista-productos"
                 placeholder="Escribe el nombre, SKU o modelo del producto…">
          <datalist id="lista-productos">
            ${cat.productos.map((p) => `
              <option value="${esc(p.nombre)}">${esc(p.sku)} · ${esc(p.modelo || '')}</option>`).join('')}
          </datalist>
          <input type="number" id="cantidad-agregar" min="0" step="1" placeholder="Cantidad">
          <button class="btn primario" id="agregar-renglon">Agregar</button>
        </div>` : ''}

      <div class="pie">
        <span class="resumen">
          ${d.renglones.length} producto(s) ·
          ${numero(d.renglones.reduce((s, r) => s + (r.cantidad || 0), 0))} unidad(es) en total.
        </span>
      </div>
    </section>

    ${tipo === 'devolucion' && d.de_venta ? panelRevisionCalidad(d) : ''}
    ${tipo === 'devolucion' ? zonaEvidencia(tipo, d, editable) : ''}
    ${tipo === 'salida_calidad' && (d.fotos || []).length ? zonaEvidencia(tipo, d, false) : ''}
    ${tipo === 'retiro' ? panelReingresos(d) : ''}
    ${accionesDocumento(tipo, d, respuesta)}`;

  conectarDocumentoAlmacen();
  cargarImagenesPendientes();
}

function cabeceraDocumento(tipo, d) {
  if (tipo === 'entrada') return `Proveedor ${d.proveedor} · llega a ${d.bodega} · ${fechaCorta(d.fecha)}`;
  if (tipo === 'retiro') {
    return `Retiro de ${d.plataforma} · llega a ${d.bodega} · ${fechaCorta(d.fecha)}`
      + (d.reingresos && d.reingresos.length ? ` · ${d.reingresos.filter((g) => g.estado === 'aplicado').length} entrega(s) recibida(s)` : '');
  }
  if (tipo === 'salida_calidad') return `Baja por calidad · sale de ${d.bodega} · ${fechaCorta(d.fecha)}`;
  if (tipo === 'salida' && d.vxf) {
    return `Venta por fuera · orden ${d.vxf.folio} · ${d.vxf.cliente} · sale de ${d.bodega} · ${fechaCorta(d.fecha)}`;
  }
  if (tipo === 'salida') {
    const motivo = MOTIVOS_SALIDA_TEXTO[d.motivo] || d.motivo;
    return `${motivo} · sale de ${d.bodega}${d.bodega_destino ? ` hacia ${d.bodega_destino}` : d.destino ? ` para ${d.destino}` : ''} · ${fechaCorta(d.fecha)}`;
  }
  return `${d.etiqueta_rechazo}${d.quien ? ` — ${d.quien}` : ''} · regresa a ${d.bodega} · ${fechaCorta(d.fecha)}`;
}

// Lo que identifica al documento se pide al crearlo, pero mientras siga en
// captura se puede corregir: un CEDIS mal escogido o un motivo a medias no
// deberían obligar a cancelar el documento y levantar otro, que es lo que hacía
// falta antes. Un solo botón de guardar, como en el editor de checklists.
function panelCabecera(tipo, d, editable, cat) {
  // Quien aprueba una devolución tiene que leer por qué no la aceptaron: es
  // lo que decide. Antes solo se veía mientras estaba en captura.
  if (!editable && tipo === 'devolucion') {
    return `
      <section class="panel">
        <h2>Por qué lo devolvieron</h2>
        <div style="padding:0 18px 18px">
          <p style="margin:0 0 6px"><b>${esc(d.etiqueta_rechazo || '')}${d.quien ? ` — ${esc(d.quien)}` : ''}</b></p>
          <p class="motivo-destacado">${d.motivo ? esc(d.motivo) : '<span style="color:var(--tinta-suave)">No se escribió motivo.</span>'}</p>
        </div>
      </section>`;
  }
  if (!editable) return '';
  const cedis = (cat.cedis || []);
  const opcion = (valor, actual) => `<option value="${esc(valor)}"${valor === actual ? ' selected' : ''}>${esc(valor)}</option>`;

  const campos = {
    salida: d.motivo === 'odt'
      ? `<div class="campo"><label for="c-destino">¿A qué CEDIS va?</label>
           <select id="c-destino" data-cabecera="destino">
             <option value="">Escoge uno…</option>${cedis.map((c) => opcion(c, d.destino)).join('')}
           </select>
           ${d.destino && !cedis.includes(d.destino)
             ? `<small class="nota-foto">Traía «${esc(d.destino)}», que ya no está en la lista.</small>` : ''}
         </div>`
      : `<div class="campo"><label for="c-vxf">¿De qué orden de armado sale?</label>
           <select id="c-vxf" data-cabecera="vxf_id">
             <option value="">Escoge una…</option>
             ${(cat.ordenes_vxf || []).map((o) => `<option value="${o.id}" ${o.id === d.vxf_id ? 'selected' : ''}>${esc(o.folio)} · ${esc(o.cliente)}</option>`).join('')}
           </select></div>`,
    devolucion: `
      ${d.rechazo_de === 'cedis'
        ? `<div class="campo"><label for="c-quien">¿Qué CEDIS lo rechazó?</label>
             <select id="c-quien" data-cabecera="quien">
               <option value="">Escoge uno…</option>${cedis.map((c) => opcion(c, d.quien)).join('')}
             </select>
             ${d.quien && !cedis.includes(d.quien)
               ? `<small class="nota-foto">Traía «${esc(d.quien)}», que ya no está en la lista.</small>` : ''}
           </div>`
        : `<div class="campo"><label for="c-quien">¿Qué cliente lo rechazó?</label>
             <input type="text" id="c-quien" data-cabecera="quien" value="${esc(d.quien || '')}"></div>`}
      <div class="campo"><label for="c-motivo">¿Por qué lo rechazaron?</label>
        <textarea id="c-motivo" rows="2" data-cabecera="motivo">${esc(d.motivo || '')}</textarea></div>`,
  }[tipo];
  if (!campos) return '';

  return `
    <section class="panel">
      <h2>Datos del documento</h2>
      <div style="padding:0 18px 18px">
        ${campos}
        <div class="fila-botones">
          <button class="btn primario" data-guardar-cabecera>Guardar cambios</button>
        </div>
      </div>
    </section>`;
}

// Las entregas que Calidad ya recibió contra este retiro. Es lo que explica por
// qué el retiro sigue abierto o por qué entró menos de lo que se pidió.
function panelReingresos(d) {
  const lista = d.reingresos || [];
  if (!lista.length) {
    return `
      <section class="panel">
        <h2>Entregas recibidas</h2>
        <div class="vacio">
          Todavía no llega nada. Cuando el material llegue a la bodega, Calidad
          levanta el re-ingreso con las cajas que trae cada entrega.
        </div>
      </section>`;
  }
  return `
    <section class="panel">
      <h2>Entregas recibidas <span class="etiqueta azul">${lista.length}</span></h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Re-ingreso</th><th>Fecha</th><th>Cajas</th><th>Unidades</th>
          <th>Bodega</th><th>Recibió</th><th>Aprobó</th><th>Estado</th><th></th></tr></thead>
        <tbody>${lista.map((g) => `
          <tr>
            <td class="fila-titulo">${esc(g.folio)}</td>
            <td>${fechaCorta(g.fecha)}</td>
            <td>${g.cajas_detalladas} de ${g.cajas}</td>
            <td><b>${numero(g.unidades)}</b></td>
            <td>${esc(g.bodega)}</td>
            <td>${esc(g.capturo)}</td>
            <td>${esc(g.aprobo || '—')}</td>
            <td>${insigniaDocumento(g.estado)}</td>
            <td><button class="btn" data-ir-hash="#/calidad/reingreso/${g.id}">Abrir</button></td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>`;
}

const columnasExtra = (tipo) => ({
  entrada: ['Muestreo', 'Resultado de Calidad', 'Entra al inventario'],
  retiro: ['Recibido', 'Por recibir'],
  salida: ['En bodega', 'Pide la ODT', 'Pendiente'],
  salida_calidad: ['En bodega', 'Por qué sale', 'Foto'],
  devolucion: [],
}[tipo]);

function filaRenglon(tipo, r, editable) {
  const extra = {
    entrada: () => `
      <td>${r.requiere_muestreo ? 'Sí' : '<small style="color:var(--tinta-suave)">No: Calidad confirma</small>'}</td>
      <td>${r.resultado
        ? `<span class="etiqueta ${r.resultado === 'aprobado' ? 'verde' : 'roja'}">${r.resultado === 'aprobado' ? 'Aprobado' : 'Rechazado'}</span>
           ${r.etiqueta_disposicion ? `<br><small>${esc(r.etiqueta_disposicion)}</small>` : ''}`
        : (r.requiere_muestreo ? '<small style="color:var(--tinta-suave)">Sin revisar</small>'
          : (r.cantidad_buena === null || r.cantidad_buena === undefined
            ? '<small style="color:var(--tinta-suave)">Sin confirmar</small>'
            : `<span class="etiqueta ${r.cantidad_buena === r.cantidad ? 'verde' : 'ambar'}">${numero(r.cantidad_buena)} de ${numero(r.cantidad)} llegaron bien</span>`))}</td>
      <td>${r.cantidad_aplicada === null || r.cantidad_aplicada === undefined
        ? '<small style="color:var(--tinta-suave)">—</small>'
        : `<b>${numero(r.cantidad_aplicada)}</b>`}</td>`,
    retiro: () => `
      <td>${numero(r.recibido || 0)}</td>
      <td>${r.por_recibir
        ? `<b class="fuera-odt">${numero(r.por_recibir)}</b>`
        : '<span class="etiqueta verde">Llegó todo</span>'}</td>`,
    salida: () => `
      <td>${numero(r.existencia)}</td>
      <td>${r.odt_pide === null ? '—' : numero(r.odt_pide)}</td>
      <td>${r.odt_pendiente === null ? '—'
        : `<b class="${r.cantidad > r.odt_pendiente ? 'fuera-odt' : ''}">${numero(r.odt_pendiente)}</b>`}</td>`,
    salida_calidad: () => `
      <td>${numero(r.existencia)}</td>
      <td style="min-width:240px">${editable
        ? `<textarea rows="2" data-motivo-renglon="${r.id}" class="${(r.motivo || '').trim() ? '' : 'falta-dato'}"
             placeholder="Ej. Se mojó con la lluvia del jueves">${esc(r.motivo || '')}</textarea>`
        : `<span style="text-align:left;display:block">${esc(r.motivo || '—')}</span>`}</td>
      <td class="celda-foto-renglon">
        <div class="miniaturas">
          ${(r.fotos || []).map((f) => `
            <figure class="mini">
              <img data-archivo="${esc(f.archivo)}" alt="Foto de ${esc(r.producto)}">
              ${editable ? `<button class="quitar" data-quitar-foto="${f.id}" title="Quitar foto">×</button>` : ''}
            </figure>`).join('')}
        </div>
        ${editable
          ? `<button class="btn-camara" type="button" data-camara-renglon="${r.id}">
               <span aria-hidden="true">📷</span> ${(r.fotos || []).length ? 'Otra' : 'Foto'}</button>`
          : ((r.fotos || []).length ? '' : '<span class="etiqueta roja">Sin foto</span>')}
      </td>`,
    devolucion: () => '',
  }[tipo]();

  const imagen = ((estado.catalogos_almacen || {}).productos || []).find((x) => x.id === r.producto_id);
  return `
    <tr data-renglon="${r.id}">
      <td class="fila-titulo">${imagen && imagen.imagen ? `<img class="imagen-renglon" data-archivo="${esc(imagen.imagen)}" alt="">` : fotoProducto({ id: r.producto_id, sku: r.sku })}${esc(r.producto)}<br><small style="color:var(--tinta-suave)">${esc(r.sku)}</small></td>
      <td>${esc(r.modelo || '—')}</td>
      ${extra}
      <td>${editable
        ? `<input type="number" min="0" step="1" value="${r.cantidad || ''}" data-cantidad="${r.id}">`
        : `<b>${numero(r.cantidad)}</b>`}</td>
      ${editable ? `<td><button class="btn peligro" data-quitar-renglon="${r.id}" title="Quitar">×</button></td>` : ''}
    </tr>`;
}

// La banda de arriba dice en una línea qué está esperando el documento. Es lo
// primero que se lee al abrirlo y evita tener que deducirlo de los botones.
function bandaDocumento(tipo, d, respuesta) {
  const razones = respuesta.razones_autorizacion || [];
  if (d.estado === 'borrador' && d.correccion_nota) {
    const ultima = (d.correcciones || [])[0] || {};
    return `<div class="aviso error"><span><b>Regresado para corregir.</b>
      <small>${esc(ultima.quien || 'Alguien con permiso')}: «${esc(d.correccion_nota)}». Corrige y vuelve a enviarlo a aprobación.</small></span></div>`;
  }
  if (d.estado === 'en_calidad') {
    const listo = d.estado_calidad === 'aprobado';
    return `<div class="aviso ${listo ? 'exito' : ''}">
      ${listo
        ? 'Calidad ya dio el visto bueno. En cuanto se decida el destino de lo rechazado, la entrada suma sola.'
        : `Aprobada${d.autorizo ? ` por ${esc(d.autorizo)}` : ''}. Está en Calidad como <b>pendiente de revisar</b> (recepción ${esc(d.remision || d.folio)}); suma al inventario cuando Calidad dé el visto bueno.`}
      ${(respuesta.faltantes || []).length ? `<br><small>${esc(respuesta.faltantes.join(' '))}</small>` : ''}
    </div>`;
  }
  if (d.estado === 'pendiente_recibir') {
    const falta = (d.renglones || []).filter((r) => r.por_recibir > 0);
    return `<div class="aviso">
      <b>Pendiente de recibir.</b>
      <small>Calidad levanta un re-ingreso por cada entrega que llegue a la bodega. ${
        falta.length
          ? `Faltan ${numero(falta.reduce((n, r) => n + r.por_recibir, 0))} unidad(es) de ${falta.length} producto(s).`
          : 'Ya llegó todo lo que se pidió: se puede cerrar.'}</small>
    </div>`;
  }
  if (d.estado === 'recibido') {
    return `<div class="aviso exito">Retiro cerrado${d.cerro ? ` por ${esc(d.cerro)}` : ''}${
      d.completo ? ': llegó todo lo que se pidió' : ' sin haber llegado todo'}.</div>`;
  }
  if (d.estado === 'por_autorizar') {
    return `<div class="aviso">
      Enviado. Esperando la aprobación de otra persona; hasta entonces no toca el inventario.
      ${tipo === 'salida' && razones.length ? `<br><small><b>${d.motivo === 'ventas_fuera' ? 'No coincide con su orden de armado' : 'Fuera de lo que pide la ODT'}:</b> ${esc(razones.join(' '))}</small>` : ''}
      ${tipo === 'salida_calidad' ? '<br><small>Quien apruebe va a leer el motivo y ver la evidencia.</small>' : ''}
    </div>`;
  }
  if (d.estado === 'aplicada') {
    return `<div class="aviso exito">Aplicada al inventario${d.autorizo ? ` · aprobó ${esc(d.autorizo)}` : ''}.</div>`;
  }
  if (d.estado === 'cancelada') return '<div class="aviso error">Documento cancelado.</div>';
  if (tipo === 'salida' && razones.length) {
    return `<div class="aviso">
      ${d.motivo === 'ventas_fuera' ? 'Esta salida no coincide con su orden de armado' : 'Esta salida va fuera de lo que pide la ODT'}. Se puede enviar, y quien la apruebe lo verá:
      <br><small>${esc(razones.join(' '))}</small>
    </div>`;
  }
  return '';
}

function zonaEvidencia(tipo, d, editable) {
  const porQue = tipo === 'salida_calidad'
    ? `Sin foto del material dañado, dar de baja existencia queda en la palabra de
       una persona. Es la misma regla que Calidad aplica a un lote rechazado.`
    : `Una devolución sin foto no sirve para reclamar después. Es la misma regla
       que Calidad aplica a un lote rechazado.`;
  return `
    <section class="panel">
      <h2>Evidencia ${d.fotos.length ? `<span class="etiqueta verde">${d.fotos.length}</span>` : '<span class="etiqueta roja">obligatoria</span>'}</h2>
      <p class="explica">${porQue}</p>
      <div class="evidencia ${d.fotos.length ? '' : 'falta'}" style="padding:0 18px 18px" data-fotos-documento>
        <div class="miniaturas">
          ${d.fotos.map((f) => `
            <figure class="mini">
              <img data-archivo="${esc(f.archivo)}" alt="Evidencia del documento">
              ${editable ? `<button class="quitar" data-quitar-foto="${f.id}" title="Quitar foto">×</button>` : ''}
            </figure>`).join('')}
        </div>
        ${editable
          ? `<button class="btn-camara" type="button" data-camara-documento>
               <span aria-hidden="true">📷</span> ${d.fotos.length ? 'Otra foto' : 'Tomar foto'}
             </button>`
          : (d.fotos.length ? '' : '<span class="nota-foto">Sin evidencia</span>')}
      </div>
    </section>`;
}

// Lo que Calidad encontró en lo que regresó de una venta. Se enseña en Almacén
// para que quien pide la entrada vea de dónde salen las cantidades.
function panelRevisionCalidad(d) {
  return `
    <section class="panel">
      <h2>Lo que revisó Calidad
        ${d.revisado_en ? `<span class="etiqueta verde">${d.unidades_buenas} pieza(s) buenas</span>`
          : '<span class="etiqueta ambar">en revisión</span>'}</h2>
      <div style="padding:0 18px 18px">
        <p style="margin:0 0 10px">
          ${d.orden ? `Regresó de la venta <b>${esc(d.orden.folio)}</b> · ${esc(d.orden.cliente)}<br>` : ''}
          ${d.revisado_en ? `Revisó <b>${esc(d.reviso || '—')}</b>` : 'Calidad todavía la está revisando.'}
          ${d.motivo ? `<br><small style="color:var(--tinta-suave)">${esc(d.motivo)}</small>` : ''}
        </p>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Producto</th><th>Regresó</th><th>Llegó bien</th><th>No entra</th><th>Qué tiene</th></tr></thead>
          <tbody>${d.renglones.map((r) => {
            const mala = (r.cantidad || 0) - (r.cantidad_buena || 0);
            return `
              <tr>
                <td class="fila-titulo">${fotoProducto({ id: r.producto_id, sku: r.sku })}${esc(r.producto)}</td>
                <td>${numero(r.cantidad)}</td>
                <td><b>${r.cantidad_buena === null || r.cantidad_buena === undefined ? '—' : numero(r.cantidad_buena)}</b></td>
                <td>${mala ? `<span class="etiqueta roja">${numero(mala)}</span>` : '—'}</td>
                <td style="text-align:left">${esc(r.observacion || '—')}</td>
              </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </section>`;
}

function accionesDocumento(tipo, d, respuesta) {
  const botones = [];
  const faltantes = respuesta.faltantes || [];
  const permisos = PERMISOS_DOCUMENTO[tipo];
  const esAdmin = estado.usuario.rol === 'admin';
  const suyo = d.usuario_id === estado.usuario.id;

  if (d.estado === 'borrador' && permiso(permisos.capturar)) {
    botones.push(tipo === 'retiro'
      ? '<button class="btn primario grande" data-accion="solicitar">Dejar pendiente de recibir</button>'
      : '<button class="btn primario grande" data-accion="enviar">Enviar a aprobación</button>');
  }
  // Calidad pide la entrada al terminar su revisión, así que Almacén solo
  // aprueba. El botón se queda para las devoluciones que se quedaron en el paso
  // intermedio de antes.
  if (d.estado === 'revisada' && permiso(permisos.capturar)) {
    botones.push('<button class="btn primario grande" data-accion="enviar">Pedir la entrada al inventario</button>');
  }
  // El retiro no se aprueba: se cierra cuando llegó todo, o antes si ya no va a
  // llegar —y entonces hay que escribir por qué—.
  if (tipo === 'retiro' && d.estado === 'pendiente_recibir' && permiso(permisos.aprobar)) {
    botones.push(`<button class="btn ${d.completo ? 'primario grande' : ''}" data-accion="cerrar">${
      d.completo ? 'Cerrar el retiro: llegó todo' : 'Cerrar sin que llegue todo'}</button>`);
  }
  if (tipo === 'retiro' && ['pendiente_recibir', 'recibido'].includes(d.estado) && permiso(permisos.aprobar)) {
    botones.push('<button class="btn" data-accion="reabrir">Reabrir</button>');
  }
  if (d.estado === 'por_autorizar' && permiso(permisos.aprobar)) {
    botones.push(esAdmin || !suyo
      ? `<button class="btn primario grande" data-accion="aprobar">${
        tipo === 'entrada' ? 'Aprobar y pasar a Calidad' : 'Aprobar y aplicar al inventario'}</button>`
      : '<span class="nota-mando">Lo capturaste tú: lo aprueba otra persona</span>');
  }
  if (tipo === 'retiro') {
    if (d.estado !== 'cancelada' && permiso(permisos.aprobar)) {
      botones.push('<button class="btn peligro" data-accion="cancelar">Cancelar el retiro</button>');
    }
    return `
      ${botones.length ? `
        <div class="acciones-almacen">
          ${faltantes.length && d.estado === 'borrador'
            ? `<div class="aviso">Falta antes de dejarlo pendiente:<br><small>${esc(faltantes.join(' '))}</small></div>` : ''}
          <div class="fila-botones">${botones.join('')}</div>
        </div>` : ''}
      ${historialCorrecciones(d.correcciones)}`;
  }
  if (d.estado === 'en_calidad' && permiso(permisos.aprobar) && d.estado_calidad === 'aprobado') {
    botones.push('<button class="btn primario grande" data-accion="aplicar">Aplicar al inventario</button>');
  }
  if (['por_autorizar', 'en_calidad', 'aplicada'].includes(d.estado) && permiso(permisos.corregir)) {
    botones.push(`<button class="btn" data-accion="corregir">${
      d.estado === 'aplicada' ? 'Pedir corrección (sale del inventario)' : 'Regresar para corregir'}</button>`);
  }
  if (d.estado !== 'cancelada' && permiso(permisos.aprobar)) {
    botones.push('<button class="btn peligro" data-accion="cancelar">Cancelar documento</button>');
  }

  return `
    ${botones.length ? `
      <div class="acciones-almacen">
        ${faltantes.length && d.estado === 'borrador'
          ? `<div class="aviso">Falta antes de poder enviarlo:<br><small>${esc(faltantes.join(' '))}</small></div>`
          : ''}
        <div class="fila-botones">${botones.join('')}</div>
      </div>` : ''}
    ${historialCorrecciones(d.correcciones)}`;
}

let temporizadorRenglon = null;

function conectarDocumentoAlmacen() {
  const { tipo, doc, d } = estado.documento_almacen;

  vista.querySelectorAll('[data-cantidad]').forEach((campo) => {
    campo.addEventListener('input', () => {
      clearTimeout(temporizadorRenglon);
      temporizadorRenglon = setTimeout(async () => {
        try {
          await api('PUT', doc.apiRenglon(campo.dataset.cantidad), { cantidad: campo.value });
        } catch (err) { mostrarMensaje(err.message, 'error'); }
      }, 500);
    });
    // Al salir del campo se recarga: las columnas calculadas —lo pendiente de
    // la ODT, lo que entra al inventario— dependen de este número.
    campo.addEventListener('change', () => setTimeout(() => enrutar(), 600));
  });

  vista.querySelectorAll('[data-quitar-renglon]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api('DELETE', doc.apiRenglon(b.dataset.quitarRenglon));
        enrutar();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });

  const agregar = document.getElementById('agregar-renglon');
  if (agregar) {
    const nombre = document.getElementById('buscar-agregar');
    const cantidad = document.getElementById('cantidad-agregar');
    const alta = async () => {
      const cat = await catalogosAlmacen();
      const texto = nombre.value.trim().toLowerCase();
      const producto = cat.productos.find((p) => p.nombre.toLowerCase() === texto)
        || cat.productos.find((p) => p.sku.toLowerCase() === texto)
        || cat.productos.find((p) => (p.modelo || '').toLowerCase() === texto);
      if (!producto) return mostrarMensaje('Ese producto no está en el catálogo. Escoge uno de la lista.', 'error');
      try {
        await api('POST', `${doc.api}/${d.id}/renglones`, {
          producto_id: producto.id, cantidad: cantidad.value,
        });
        nombre.value = ''; cantidad.value = '';
        enrutar();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    };
    agregar.addEventListener('click', alta);
    cantidad.addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
  }

  vista.querySelectorAll('[data-accion]').forEach((b) => {
    b.addEventListener('click', () => accionDocumento(b.dataset.accion, b));
  });

  const guardar = vista.querySelector('[data-guardar-cabecera]');
  if (guardar) {
    guardar.addEventListener('click', async () => {
      const cuerpo = {};
      vista.querySelectorAll('[data-cabecera]').forEach((c) => { cuerpo[c.dataset.cabecera] = c.value; });
      guardar.disabled = true;
      try {
        await api('PUT', `${tipo === 'salida_calidad' ? '/api/almacen/salidas-calidad' : doc.api}/${d.id}`, cuerpo);
        mostrarMensaje('Datos guardados.', 'exito');
        setTimeout(() => enrutar(), 600);
      } catch (err) { mostrarMensaje(err.message, 'error'); guardar.disabled = false; }
    });
  }

  const camara = vista.querySelector('[data-camara-documento]');
  if (camara) {
    camara.addEventListener('click', () => {
      documentoDestinoFoto = { tipo: doc.claveFoto || tipo, id: d.id };
      selectorFotosAlmacen.click();
    });
  }
  // La foto de un producto en la salida por calidad sube a su renglón.
  vista.querySelectorAll('[data-camara-renglon]').forEach((b) => {
    b.addEventListener('click', () => {
      documentoDestinoFoto = { tipo: 'salida_renglon', id: Number(b.dataset.camaraRenglon) };
      selectorFotosAlmacen.click();
    });
  });
  vista.querySelectorAll('[data-motivo-renglon]').forEach((campo) => {
    campo.addEventListener('input', () => {
      campo.classList.toggle('falta-dato', !campo.value.trim());
      clearTimeout(temporizadorRenglon);
      temporizadorRenglon = setTimeout(async () => {
        try { await api('PUT', doc.apiRenglon(campo.dataset.motivoRenglon), { motivo: campo.value }); }
        catch (err) { mostrarMensaje(err.message, 'error'); }
      }, 500);
    });
  });
  vista.querySelectorAll('[data-quitar-foto]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('DELETE', `/api/almacen/fotos/${b.dataset.quitarFoto}`); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
}

const RUTA_ACCION = {
  entrada: { enviar: 'enviar', aprobar: 'aprobar', aplicar: 'aplicar', corregir: 'corregir', cancelar: 'cancelar' },
  retiro: { solicitar: 'solicitar', cerrar: 'cerrar-retiro', reabrir: 'reabrir-retiro', cancelar: 'cancelar' },
  salida: { enviar: 'enviar', aprobar: 'aprobar', corregir: 'corregir', cancelar: 'cancelar' },
  salida_calidad: { enviar: 'enviar', aprobar: 'aprobar', corregir: 'corregir', cancelar: 'cancelar' },
  devolucion: { enviar: 'enviar', aprobar: 'aprobar', corregir: 'corregir', cancelar: 'cancelar' },
};

async function accionDocumento(accion, boton) {
  const { tipo, doc, d } = estado.documento_almacen;
  let cuerpo;

  if (accion === 'cancelar') {
    const motivo = prompt('¿Por qué se cancela? Queda registrado.');
    if (!motivo || !motivo.trim()) return;
    cuerpo = { motivo: motivo.trim() };
  }
  if (accion === 'corregir') {
    const aviso = d.estado === 'aplicada' ? ' Lo que movió en el inventario se quita hasta que se vuelva a aprobar.' : '';
    const nota = prompt(`¿Qué hay que corregir? Lo va a leer quien lo capturó.${aviso}`);
    if (!nota || !nota.trim()) return;
    cuerpo = { nota: nota.trim() };
  }
  // Cerrar un retiro al que le falta material es decir «lo que falta ya no va a
  // llegar». Eso queda por escrito.
  if (accion === 'cerrar' && !d.completo) {
    const nota = prompt('Falta material por recibir. ¿Por qué se cierra así? Queda registrado.');
    if (!nota || !nota.trim()) return;
    cuerpo = { nota: nota.trim() };
  }

  boton.disabled = true;
  try {
    const r = await api('POST', `${doc.api}/${d.id}/${RUTA_ACCION[tipo][accion]}`, cuerpo);
    if (accion === 'cancelar') { location.hash = doc.lista; return; }
    mostrarMensaje(r.mensaje || 'Listo.', 'exito');
    setTimeout(() => enrutar(), 800);
  } catch (err) {
    mostrarMensaje(err.message, 'error');
    boton.disabled = false;
  }
}

// Selector de fotos propio del módulo, por la misma razón que Calidad tiene el
// suyo: cada uno sube a su ruta y compartirlo obligaría a que uno supiera del otro.
const selectorFotosAlmacen = document.createElement('input');
selectorFotosAlmacen.setAttribute('type', 'file');
selectorFotosAlmacen.setAttribute('accept', 'image/*');
selectorFotosAlmacen.setAttribute('capture', 'environment');
selectorFotosAlmacen.setAttribute('multiple', '');
selectorFotosAlmacen.hidden = true;
document.body.appendChild(selectorFotosAlmacen);

let documentoDestinoFoto = null;

selectorFotosAlmacen.addEventListener('change', async () => {
  const archivos = [...selectorFotosAlmacen.files];
  selectorFotosAlmacen.value = '';
  if (!archivos.length || !documentoDestinoFoto) return;

  const boton = vista.querySelector('[data-camara-documento]');
  if (boton) { boton.disabled = true; boton.textContent = 'Subiendo…'; }

  for (const archivo of archivos) {
    try {
      await api('POST', `/api/almacen/${documentoDestinoFoto.tipo}/${documentoDestinoFoto.id}/fotos`, {
        imagen: await comprimirImagen(archivo, 1600, 0.82),
      });
    } catch (err) {
      mostrarMensaje(`No se pudo subir «${archivo.name}»: ${err.message}`, 'error');
    }
  }
  enrutar();
});

// --- conteos semanales ---

async function vistaAlmacenConteos() {
  encabezado('Conteos', 'Conteo de inventario por bodega y por partidas');
  const { conteos, semana, contandose } = await api('GET', '/api/almacen/conteos');
  const cat = await catalogosAlmacen();
  estado.conteos_abiertos = contandose || {};

  const abiertos = conteos.filter((c) => c.estado === 'borrador');
  const porAutorizar = conteos.filter((c) => c.estado === 'por_autorizar');
  const cerrados = conteos.filter((c) => ['aplicado', 'cancelado'].includes(c.estado));

  const tarjeta = (c) => `
    <button class="tarea ${c.estado}" data-conteo="${c.id}">
      ${c.estado === 'borrador' && c.correccion_nota ? '<span class="etiqueta roja">Reconteo</span>' : insigniaDocumento(c.estado)}
      <b>${esc(c.bodega)} · ${esc(c.semana)}</b>
      <span class="meta">${c.contados} de ${c.productos} producto(s) contados · ${fechaCorta(c.fecha)}</span>
      <span class="meta">Abrió ${esc(c.capturo)}${c.autorizo ? ` · autorizó ${esc(c.autorizo)}` : ''}</span>
    </button>`;

  const bloque = (titulo, lista, color) => (lista.length ? `
    <section class="panel">
      <h2>${titulo} <span class="etiqueta ${color}">${lista.length}</span></h2>
      <div class="rejilla-tareas" style="padding:18px">${lista.map(tarjeta).join('')}</div>
    </section>` : '');

  vista.innerHTML = `
    ${migajaAlmacen('Conteos')}
    <div id="mensajes"></div>
    <p class="explica" style="padding-left:0">
      Quien cuenta anota lo físico y nada más. La diferencia contra lo que dice el
      sistema la calcula la plataforma, y el ajuste lo aprueba otra persona.
    </p>
    ${permiso('conteos_abrir') ? `
      <div class="fila-botones" style="margin-bottom:18px">
        <button class="btn primario grande" id="mandar-a-contar">+ Mandar a contar</button>
        <span class="resumen" style="align-self:center">Semana en curso: ${esc(semana)}</span>
      </div>` : ''}
    ${abiertos.length ? bloque('En conteo', abiertos, 'ambar')
      : '<section class="panel"><h2>En conteo</h2><div class="vacio">No hay conteos abiertos.</div></section>'}
    ${bloque('Esperando aprobación del ajuste', porAutorizar, 'azul')}
    ${bloque('Cerrados', cerrados, 'verde')}`;

  vista.querySelectorAll('[data-conteo]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/almacen/conteo/${b.dataset.conteo}`; });
  });
  const mandar = document.getElementById('mandar-a-contar');
  if (mandar) mandar.addEventListener('click', () => abrirMandarAContar(semana));
}

// Mandar a contar: la bodega, la semana y qué partidas. Se puede contar todo o
// un puñado, y lo que ya está en otro conteo abierto aparece marcado y no se
// puede escoger: dos personas contando lo mismo producen dos ajustes que se
// pisan. Antes esto era un botón por bodega que sembraba el catálogo entero.
async function abrirMandarAContar(semana) {
  const cat = await catalogosAlmacen();
  const ocupados = estado.conteos_abiertos || {};
  const tipos = [...new Set(cat.productos.map((x) => x.tipo_material).filter(Boolean))].sort();

  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal ancha" role="dialog" aria-label="Mandar a contar">
      <h2>Mandar a contar</h2>
      <div class="cuerpo-modal">
        <div id="error-conteo"></div>
        <div class="campo">
          <label for="k-bodega">¿Qué bodega se cuenta?</label>
          <select id="k-bodega">
            ${cat.bodegas.map((b) => `<option value="${b.id}">${esc(b.nombre)} (${esc(b.clave)})</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="k-semana">Semana</label>
          <input type="text" id="k-semana" value="${esc(semana)}" placeholder="2026-W38">
        </div>
        <div class="campo">
          <label>¿Qué partidas?</label>
          <div class="filtros-almacen" style="padding:0">
            <input type="search" id="k-buscar" placeholder="Buscar producto…">
            <select id="k-tipo">
              <option value="">Todos los tipos</option>
              ${tipos.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
            </select>
            <button class="btn" id="k-todas" type="button">Marcar las visibles</button>
            <button class="btn" id="k-ninguna" type="button">Desmarcar todas</button>
          </div>
          <div class="lista-partidas" id="k-lista">
            ${cat.productos.map((x) => `
              <label class="partida" data-busca="${esc(`${x.nombre} ${x.sku} ${x.modelo || ''}`.toLowerCase())}"
                     data-tipo="${esc(x.tipo_material || '')}" data-producto="${x.id}">
                <input type="checkbox" value="${x.id}">
                <span>${esc(x.nombre)}<small>${esc(x.sku)}${x.modelo ? ` · ${esc(x.modelo)}` : ''}</small></span>
                <span class="ocupado" hidden>Ya se está contando</span>
              </label>`).join('')}
          </div>
          <small class="nota-foto" id="k-cuenta"></small>
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-abrir-conteo>Mandar a contar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  const bodega = capa.querySelector('#k-bodega');
  const buscar = capa.querySelector('#k-buscar');
  const porTipo = capa.querySelector('#k-tipo');
  const partidas = [...capa.querySelectorAll('.partida')];
  const cuenta = capa.querySelector('#k-cuenta');

  // Lo que ya se está contando en la bodega escogida se marca y se bloquea.
  const marcarOcupados = () => {
    const enConteo = new Set(ocupados[bodega.value] || []);
    for (const fila of partidas) {
      const ocupado = enConteo.has(Number(fila.dataset.producto));
      const casilla = fila.querySelector('input');
      casilla.disabled = ocupado;
      if (ocupado) casilla.checked = false;
      fila.classList.toggle('bloqueada', ocupado);
      fila.querySelector('.ocupado').hidden = !ocupado;
    }
    actualizar();
  };
  const filtrar = () => {
    const texto = buscar.value.trim().toLowerCase();
    for (const fila of partidas) {
      const pasa = (!texto || fila.dataset.busca.includes(texto))
        && (!porTipo.value || fila.dataset.tipo === porTipo.value);
      fila.hidden = !pasa;
    }
  };
  const actualizar = () => {
    const n = partidas.filter((f) => f.querySelector('input').checked).length;
    const libres = partidas.filter((f) => !f.querySelector('input').disabled).length;
    cuenta.textContent = n
      ? `${n} partida(s) escogidas de ${libres} disponibles.`
      : `Sin escoger ninguna se cuentan las ${libres} partidas disponibles de la bodega.`;
  };

  bodega.addEventListener('change', marcarOcupados);
  [buscar, porTipo].forEach((c) => c.addEventListener('input', filtrar));
  capa.querySelector('#k-lista').addEventListener('change', actualizar);
  capa.querySelector('#k-todas').addEventListener('click', () => {
    for (const fila of partidas) {
      const casilla = fila.querySelector('input');
      if (!fila.hidden && !casilla.disabled) casilla.checked = true;
    }
    actualizar();
  });
  capa.querySelector('#k-ninguna').addEventListener('click', () => {
    for (const fila of partidas) fila.querySelector('input').checked = false;
    actualizar();
  });
  marcarOcupados();

  capa.querySelector('[data-abrir-conteo]').addEventListener('click', async () => {
    const boton = capa.querySelector('[data-abrir-conteo]');
    const escogidas = partidas.filter((f) => f.querySelector('input').checked)
      .map((f) => Number(f.dataset.producto));
    boton.disabled = true;
    try {
      const { conteo } = await api('POST', '/api/almacen/conteos', {
        bodega_id: Number(bodega.value),
        semana: capa.querySelector('#k-semana').value.trim(),
        productos: escogidas,
      });
      cerrar();
      location.hash = `#/almacen/conteo/${conteo.id}`;
    } catch (err) {
      capa.querySelector('#error-conteo').innerHTML = avisoError(err.message);
      boton.disabled = false;
    }
  });
}

async function vistaAlmacenConteo(id) {
  const { conteo, faltantes } = await api('GET', `/api/almacen/conteos/${id}`);
  estado.conteo_almacen = conteo;

  encabezado(`Conteo · ${conteo.bodega}`, `${conteo.semana} · abrió ${conteo.capturo}`
    + (conteo.parcial ? ` · ${conteo.renglones.length} de ${conteo.total_productos} partidas` : ' · bodega completa'));
  const editable = conteo.estado === 'borrador' && permiso('conteos_contar');
  const loConte = conteo.cerrado_por === estado.usuario.id
    || conteo.renglones.some((r) => r.contado_por === estado.usuario.id);

  vista.innerHTML = `
    ${migajaAlmacen('Conteos', '#/almacen/conteos', `${conteo.bodega} · ${conteo.semana}`)}
    <div id="mensajes"></div>

    ${conteo.estado === 'borrador' && conteo.correccion_nota ? `
      <div class="aviso error"><span><b>Pidieron reconteo.</b>
        <small>${esc(((conteo.correcciones || [])[0] || {}).quien || 'Alguien con permiso')}: «${esc(conteo.correccion_nota)}».
        Los productos marcados «Recontar» son los que traían diferencia.</small></span>
      </div>` : ''}
    ${conteo.estado === 'por_autorizar' ? `
      <div class="aviso">
        Conteo enviado${conteo.cerro ? ` por ${esc(conteo.cerro)}` : ''}. Falta que otra persona apruebe el ajuste
        para que el inventario se corrija.
      </div>` : ''}
    ${conteo.estado === 'aplicado' ? `
      <div class="aviso exito">
        Ajuste aplicado${conteo.autorizo ? ` · aprobó ${esc(conteo.autorizo)}` : ''}.
      </div>` : ''}

    <section class="panel">
      <h2>Conteo físico ${insigniaDocumento(conteo.estado)}</h2>
      <p class="explica">
        Anota lo que hay en el piso. Deja 0 en lo que no encuentres: un renglón en
        blanco no es lo mismo que un producto agotado.
        <b>Lo que descuadre pide el detalle de cajas y una foto:</b> cuántas cajas
        hay y de cuántas piezas cada una, y que la suma dé exactamente lo contado.
        ${conteo.estado === 'borrador' ? '' : ' Lo teórico quedó congelado al cerrar el conteo.'}
      </p>
      <div class="filtros-almacen">
        <input type="search" id="buscar-conteo" placeholder="Buscar producto…">
        <select id="filtro-conteo">
          <option value="">Todos</option>
          <option value="pendiente">Sin contar</option>
          <option value="diferencia">Con diferencia</option>
        </select>
      </div>
      <div class="desliza"><table class="captura" id="tabla-conteo">
        <thead><tr>
          <th class="fila-titulo">Producto</th><th>Modelo</th><th>Sistema</th>
          <th style="min-width:110px">Contado</th><th>Diferencia</th>
          <th style="min-width:200px">Cajas y foto</th>
          <th style="min-width:220px">Observación</th>
        </tr></thead>
        <tbody>${conteo.renglones.map((r) => filaConteo(r, editable)).join('')}</tbody>
      </table></div>
      <div class="pie"><span class="resumen" id="resumen-conteo"></span></div>
    </section>

    <div class="acciones-almacen">
      ${faltantes.length && editable
        ? `<div class="aviso">Falta antes de poder cerrarlo:<br><small>${esc(faltantes.join(' '))}</small></div>` : ''}
      <div class="fila-botones">
        ${editable ? '<button class="btn primario grande" data-conteo-accion="enviar">Enviar a aprobación</button>' : ''}
        ${conteo.estado === 'por_autorizar' && permiso('conteos_aprobar')
          ? (!loConte || permiso('conteos_aprobar_propios')
            ? '<button class="btn primario grande" data-conteo-accion="aprobar">Aprobar el ajuste</button>'
            : '<span class="nota-mando">Contaste o enviaste este conteo: lo aprueba otra persona</span>') : ''}
        ${['por_autorizar', 'aplicado'].includes(conteo.estado) && permiso('conteos_reconteo')
          ? '<button class="btn" data-conteo-accion="reconteo">Pedir reconteo</button>' : ''}
        ${conteo.estado !== 'cancelado' && permiso('conteos_aprobar')
          ? '<button class="btn peligro" data-conteo-accion="cancelar">Cancelar el conteo</button>' : ''}
      </div>
    </div>
    ${historialCorrecciones(conteo.correcciones)}`;

  conectarConteo();
  actualizarResumenConteo();
}

// Lo que se anotó de cajas, en una línea: «9 caja(s) de 50 + 1 de 42 = 492».
function resumenCajas(r) {
  if (!r.cajas || !r.cajas.length) return '';
  return r.cajas.map((c) => `${c.cajas}×${c.piezas_por_caja}`).join(' + ')
    + ` = ${numero(r.piezas_en_cajas)}`;
}

function celdaCajas(r, editable) {
  const hay = r.cajas && r.cajas.length;
  const fotos = (r.fotos || []).length;
  const cuadra = r.cajas_cuadran;
  if (!r.exige_cajas && !hay) {
    return `<td class="celda-cajas">${editable && r.contado
      ? '<button class="btn" data-cajas="' + r.id + '">Detallar</button>'
      : '<small style="color:var(--tinta-suave)">—</small>'}</td>`;
  }
  return `
    <td class="celda-cajas">
      ${hay ? `<small class="${cuadra ? '' : 'fuera-odt'}">${esc(resumenCajas(r))}${cuadra ? '' : ' ✗'}</small><br>` : ''}
      ${r.exige_cajas && !hay ? '<span class="etiqueta roja">Falta el detalle</span><br>' : ''}
      ${r.exige_cajas
        ? (fotos ? `<small>${fotos} foto(s)</small>` : '<span class="etiqueta roja">Falta la foto</span>')
        : (fotos ? `<small>${fotos} foto(s)</small>` : '')}
      ${editable ? `<br><button class="btn" data-cajas="${r.id}">${hay ? 'Cambiar' : 'Detallar'}</button>` : ''}
    </td>`;
}

function filaConteo(r, editable) {
  const dif = r.diferencia;
  return `
    <tr data-conteo-renglon="${r.id}"
        data-busca="${esc(`${r.producto} ${r.sku} ${r.modelo || ''}`.toLowerCase())}"
        data-pendiente="${r.contado === null ? '1' : '0'}"
        data-diferencia="${dif ? '1' : '0'}">
      <td class="fila-titulo">${fotoProducto({ id: r.producto_id, sku: r.sku })}${esc(r.producto)}<br><small style="color:var(--tinta-suave)">${esc(r.sku)}</small>${
        r.recontar ? ' <span class="etiqueta ambar">Recontar</span>' : ''}</td>
      <td>${esc(r.modelo || '—')}</td>
      <td>${numero(r.teorico)}</td>
      <td>${editable
        ? `<input type="number" min="0" step="1" value="${r.contado === null ? '' : r.contado}" data-contado="${r.id}">`
        : (r.contado === null ? '—' : `<b>${numero(r.contado)}</b>`)}</td>
      <td class="celda-diferencia">${dif === null ? '—'
        : `<span class="delta ${dif === 0 ? 'neutra' : 'mala'}">${dif > 0 ? '+' : ''}${numero(dif)}</span>`}</td>
      ${celdaCajas(r, editable)}
      <td>${editable
        ? `<input type="text" value="${esc(r.observacion || '')}" data-observacion="${r.id}"
                  placeholder="${r.exige_explicacion ? 'Obligatoria: explica la diferencia' : 'Opcional'}"
                  class="${r.exige_explicacion && !r.observacion ? 'falta-dato' : ''}">`
        : esc(r.observacion || '—')}</td>
    </tr>`;
}

let temporizadorConteo = null;

function conectarConteo() {
  const guardar = (id, cambios) => {
    clearTimeout(temporizadorConteo);
    temporizadorConteo = setTimeout(async () => {
      try {
        const r = await api('PUT', `/api/almacen/conteo-renglones/${id}`, cambios);
        refrescarFilaConteo(r.renglon, r.resumen);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    }, 450);
  };

  vista.querySelectorAll('[data-contado]').forEach((campo) => {
    campo.addEventListener('input', () => guardar(campo.dataset.contado, {
      contado: campo.value,
      observacion: vista.querySelector(`[data-observacion="${campo.dataset.contado}"]`)?.value || '',
    }));
  });
  vista.querySelectorAll('[data-observacion]').forEach((campo) => {
    campo.addEventListener('input', () => guardar(campo.dataset.observacion, {
      contado: vista.querySelector(`[data-contado="${campo.dataset.observacion}"]`)?.value ?? '',
      observacion: campo.value,
    }));
  });

  const filas = [...vista.querySelectorAll('#tabla-conteo tbody tr')];
  const buscar = document.getElementById('buscar-conteo');
  const filtro = document.getElementById('filtro-conteo');
  const filtrar = () => {
    const texto = buscar.value.trim().toLowerCase();
    for (const f of filas) {
      const pasa = (!texto || f.dataset.busca.includes(texto))
        && (!filtro.value
          || (filtro.value === 'pendiente' ? f.dataset.pendiente === '1' : f.dataset.diferencia === '1'));
      f.style.display = pasa ? '' : 'none';
    }
  };
  [buscar, filtro].forEach((c) => c.addEventListener('input', filtrar));

  vista.querySelectorAll('[data-conteo-accion]').forEach((b) => {
    b.addEventListener('click', () => accionConteo(b.dataset.conteoAccion, b));
  });
  vista.querySelectorAll('[data-cajas]').forEach((b) => {
    b.addEventListener('click', () => abrirDetalleCajas(Number(b.dataset.cajas)));
  });
}

// El detalle de cajas de un producto descuadrado: «9 cajas de 50 y 6 de 43». Va
// en su propia ventana y no en la tabla porque son varios renglones por
// producto, y en una tablet la tabla ya va apretada. La suma se enseña al
// momento: si no da lo contado, el conteo no se puede enviar.
async function abrirDetalleCajas(renglonId) {
  const conteo = estado.conteo_almacen;
  const r = conteo.renglones.find((x) => x.id === renglonId);
  if (!r) return;
  let filas = (r.cajas || []).map((c) => ({ cajas: c.cajas, piezas_por_caja: c.piezas_por_caja }));
  if (!filas.length) filas = [{ cajas: '', piezas_por_caja: '' }];

  const capa = document.createElement('div');
  capa.className = 'modal';
  document.body.appendChild(capa);

  const pintar = () => {
    const suma = filas.reduce((n, f) => n + (Number(f.cajas) || 0) * (Number(f.piezas_por_caja) || 0), 0);
    const cuadra = suma === r.contado;
    capa.innerHTML = `
      <div class="caja-modal" role="dialog" aria-label="Detalle de cajas">
        <h2>${esc(r.producto)}</h2>
        <div class="cuerpo-modal">
          <p class="explica" style="padding-left:0">
            Contaste <b>${numero(r.contado)}</b> y el sistema dice ${numero(r.teorico)}
            (${r.diferencia > 0 ? '+' : ''}${numero(r.diferencia)}). Anota cómo llegaste
            a ese número: cuántas cajas hay y de cuántas piezas cada una.
          </p>
          <div id="cajas-filas">
            ${filas.map((f, i) => `
              <div class="fila-caja">
                <input type="number" min="0" step="1" data-caja-cant="${i}" value="${f.cajas}" placeholder="Cajas">
                <span>caja(s) de</span>
                <input type="number" min="0" step="1" data-caja-piezas="${i}" value="${f.piezas_por_caja}" placeholder="Piezas">
                <span>piezas</span>
                <button class="btn peligro" data-quitar-caja="${i}" title="Quitar">×</button>
              </div>`).join('')}
          </div>
          <div class="fila-botones">
            <button class="btn" data-agregar-caja>+ Otro tamaño de caja</button>
          </div>
          <div class="aviso ${cuadra ? 'exito' : 'error'}" style="margin-top:12px">
            El detalle suma <b>${numero(suma)}</b> y contaste <b>${numero(r.contado)}</b>.
            ${cuadra ? 'Cuadra.' : 'Tiene que dar exactamente lo contado.'}
          </div>

          <h3 style="margin:18px 0 6px">Foto del material contado</h3>
          <div class="evidencia ${(r.fotos || []).length ? '' : 'falta'}">
            <div class="miniaturas">
              ${(r.fotos || []).map((f) => `
                <figure class="mini">
                  <img data-archivo="${esc(f.archivo)}" alt="Foto del conteo">
                  <button class="quitar" data-quitar-foto-caja="${f.id}" title="Quitar foto">×</button>
                </figure>`).join('')}
            </div>
            <button class="btn-camara" type="button" data-camara-caja>
              <span aria-hidden="true">📷</span> ${(r.fotos || []).length ? 'Otra foto' : 'Tomar foto'}
            </button>
          </div>
        </div>
        <div class="pie-modal">
          <button class="btn" data-cerrar-cajas>Cerrar</button>
          <button class="btn primario" data-guardar-cajas>Guardar detalle</button>
        </div>
      </div>`;
    cargarImagenesPendientes(capa);
    conectar();
  };

  const refrescar = async () => {
    const datos = await api('GET', `/api/almacen/conteos/${conteo.id}`);
    estado.conteo_almacen = datos.conteo;
    const nuevo = datos.conteo.renglones.find((x) => x.id === renglonId);
    if (nuevo) r.fotos = nuevo.fotos;
    pintar();
  };

  const selector = document.createElement('input');
  selector.setAttribute('type', 'file');
  selector.setAttribute('accept', 'image/*');
  selector.setAttribute('capture', 'environment');
  selector.hidden = true;
  capa.appendChild(selector);
  selector.addEventListener('change', async () => {
    const archivo = selector.files[0];
    selector.value = '';
    if (!archivo) return;
    const boton = capa.querySelector('[data-camara-caja]');
    if (boton) { boton.disabled = true; boton.textContent = 'Subiendo…'; }
    try {
      await api('POST', `/api/almacen/conteo_renglon/${renglonId}/fotos`, {
        imagen: await comprimirImagen(archivo, 1600, 0.82),
      });
      await refrescar();
    } catch (err) { mostrarMensaje(err.message, 'error'); pintar(); }
  });

  function conectar() {
    capa.querySelectorAll('[data-caja-cant]').forEach((c) => {
      c.addEventListener('input', () => { filas[Number(c.dataset.cajaCant)].cajas = c.value; actualizarSuma(); });
    });
    capa.querySelectorAll('[data-caja-piezas]').forEach((c) => {
      c.addEventListener('input', () => { filas[Number(c.dataset.cajaPiezas)].piezas_por_caja = c.value; actualizarSuma(); });
    });
    capa.querySelectorAll('[data-quitar-caja]').forEach((b) => {
      b.addEventListener('click', () => { filas.splice(Number(b.dataset.quitarCaja), 1); if (!filas.length) filas = [{ cajas: '', piezas_por_caja: '' }]; pintar(); });
    });
    capa.querySelector('[data-agregar-caja]').addEventListener('click', () => {
      filas.push({ cajas: '', piezas_por_caja: '' }); pintar();
    });
    capa.querySelector('[data-cerrar-cajas]').addEventListener('click', () => { capa.remove(); enrutar(); });
    capa.querySelector('[data-camara-caja]').addEventListener('click', () => selector.click());
    capa.querySelectorAll('[data-quitar-foto-caja]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await api('DELETE', `/api/almacen/fotos/${b.dataset.quitarFotoCaja}`); await refrescar(); }
        catch (err) { mostrarMensaje(err.message, 'error'); }
      });
    });
    capa.querySelector('[data-guardar-cajas]').addEventListener('click', async () => {
      const boton = capa.querySelector('[data-guardar-cajas]');
      boton.disabled = true;
      try {
        await api('PUT', `/api/almacen/conteo-renglones/${renglonId}`, {
          contado: r.contado,
          observacion: r.observacion || '',
          cajas: filas.filter((f) => Number(f.cajas) > 0 && Number(f.piezas_por_caja) > 0)
            .map((f) => ({ cajas: Number(f.cajas), piezas_por_caja: Number(f.piezas_por_caja) })),
        });
        capa.remove();
        enrutar();
      } catch (err) { mostrarMensaje(err.message, 'error'); boton.disabled = false; }
    });
  }

  // La suma se recalcula al teclear sin repintar: repintar quitaría el foco.
  function actualizarSuma() {
    const suma = filas.reduce((n, f) => n + (Number(f.cajas) || 0) * (Number(f.piezas_por_caja) || 0), 0);
    const aviso = capa.querySelector('.aviso');
    if (!aviso) return;
    const cuadra = suma === r.contado;
    aviso.className = `aviso ${cuadra ? 'exito' : 'error'}`;
    aviso.innerHTML = `El detalle suma <b>${numero(suma)}</b> y contaste <b>${numero(r.contado)}</b>. `
      + (cuadra ? 'Cuadra.' : 'Tiene que dar exactamente lo contado.');
  }

  pintar();
}

// Se repinta solo la fila tocada: la hoja tiene 121 renglones y volver a
// dibujarla entera en cada tecla haría perder el foco del campo.
function refrescarFilaConteo(renglon, resumen) {
  // El renglón guardado se actualiza para que la ventana de cajas abra con lo
  // último que se tecleó, y no con lo que había al pintar la pantalla.
  const c = estado.conteo_almacen;
  if (c) {
    const i = c.renglones.findIndex((x) => x.id === renglon.id);
    if (i >= 0) c.renglones[i] = renglon;
  }

  const fila = vista.querySelector(`[data-conteo-renglon="${renglon.id}"]`);
  if (fila) {
    const celda = fila.querySelector('.celda-diferencia');
    const dif = renglon.diferencia;
    celda.innerHTML = dif === null ? '—'
      : `<span class="delta ${dif === 0 ? 'neutra' : 'mala'}">${dif > 0 ? '+' : ''}${numero(dif)}</span>`;
    fila.dataset.pendiente = renglon.contado === null ? '1' : '0';
    fila.dataset.diferencia = dif ? '1' : '0';
    const obs = fila.querySelector('[data-observacion]');
    if (obs) obs.classList.toggle('falta-dato', !!renglon.exige_explicacion && !obs.value.trim());

    // Al cambiar lo contado cambia si hace falta el detalle de cajas: esa celda
    // se vuelve a dibujar, o quien cuenta no se enteraría de que ya se le pide.
    const cajas = fila.querySelector('.celda-cajas');
    if (cajas) {
      cajas.outerHTML = celdaCajas(renglon, true);
      const boton = fila.querySelector('[data-cajas]');
      if (boton) boton.addEventListener('click', () => abrirDetalleCajas(renglon.id));
    }
  }
  actualizarResumenConteo(resumen);
}

function actualizarResumenConteo(resumen) {
  const zona = document.getElementById('resumen-conteo');
  if (!zona) return;
  const c = estado.conteo_almacen;
  const r = resumen || {
    contados: c.contados, total: c.renglones.length,
    con_diferencia: c.con_diferencia, unidades_diferencia: c.unidades_diferencia,
  };
  zona.textContent = `${r.contados} de ${r.total} contados · ${r.con_diferencia} con diferencia · `
    + `${r.unidades_diferencia > 0 ? '+' : ''}${numero(r.unidades_diferencia)} unidades de descuadre.`;
}

async function accionConteo(accion, boton) {
  const c = estado.conteo_almacen;
  let cuerpo;
  if (accion === 'cancelar') {
    const motivo = prompt('¿Por qué se cancela el conteo? Queda registrado.');
    if (!motivo || !motivo.trim()) return;
    cuerpo = { motivo: motivo.trim() };
  }
  if (accion === 'reconteo') {
    const aviso = c.estado === 'aplicado' ? ' El ajuste que ya se aplicó se quita del inventario.' : '';
    const nota = prompt(`¿Qué hay que recontar y por qué?${aviso}`);
    if (!nota || !nota.trim()) return;
    cuerpo = { nota: nota.trim() };
  }
  boton.disabled = true;
  try {
    const r = await api('POST', `/api/almacen/conteos/${c.id}/${accion}`, cuerpo);
    if (accion === 'cancelar') { location.hash = '#/almacen/conteos'; return; }
    mostrarMensaje(r.mensaje || 'Listo.', 'exito');
    setTimeout(() => enrutar(), 900);
  } catch (err) {
    mostrarMensaje(err.message, 'error');
    boton.disabled = false;
  }
}

// --- ODT de la semana ---

const CLASE_EVALUACION = { alcanza: 'verde', traspasar: 'ambar', comprar: 'roja' };
const TEXTO_EVALUACION = { alcanza: 'Alcanza', traspasar: 'Traspasar', comprar: 'Comprar' };

// --- traspasos entre bodegas ---
//
// El material que cambia de bodega. La mayoría llega ya llena desde la ODT de
// Producción, que descubrió que en la bodega de armado no alcanzaba; aquí solo
// se confirma que el viaje se hizo. El detalle de cada uno se abre con la misma
// pantalla de las salidas, porque por debajo es el mismo documento.

// --- el camino de un traspaso ---
//
// Cuatro pasos, cada uno de alguien distinto. La pantalla enseña el camino
// completo siempre —dónde va, qué falta y quién hizo cada cosa— porque quien
// abre un traspaso normalmente lo abre para saber por qué no ha llegado.

const PASOS_TRASPASO = [
  { estado: 'solicitado', etiqueta: 'Solicitado', quien: 'Producción o Almacén' },
  { estado: 'aprobado', etiqueta: 'Aprobado', quien: 'Team Leader de Almacén' },
  { estado: 'cargado', etiqueta: 'Cargado', quien: 'Tránsito' },
  { estado: 'aplicada', etiqueta: 'Confirmado', quien: 'Team Leader, al llegar' },
];

const ETIQUETA_TRASPASO = {
  borrador: ['ambar', 'En captura'],
  solicitado: ['ambar', 'Por aprobar'],
  aprobado: ['azul', 'Con Tránsito'],
  cargado: ['azul', 'En camino'],
  aplicada: ['verde', 'Confirmado'],
  cancelada: ['roja', 'Cancelado'],
};

const insigniaTraspaso = (estado) => {
  const [color, texto] = ETIQUETA_TRASPASO[estado] || ['', estado];
  return `<span class="etiqueta ${color}">${esc(texto)}</span>`;
};

// La barra de pasos: dónde va el traspaso y qué falta. Se pinta completa aunque
// falten pasos, para que se vea el camino y no solo el escalón de hoy.
function caminoTraspaso(t) {
  const hechos = {
    solicitado: t.creado_en, aprobado: t.aprobado_en,
    cargado: t.cargado_en, aplicada: t.confirmado_en,
  };
  const quienes = { solicitado: t.capturo, aprobado: t.aprobo, cargado: t.cargo, aplicada: t.confirmo };
  const indiceActual = PASOS_TRASPASO.findIndex((p) => p.estado === t.estado);

  return `
    <ol class="camino">
      ${PASOS_TRASPASO.map((p, i) => {
        const hecho = !!hechos[p.estado];
        const enCurso = !hecho && i === indiceActual + 1;
        return `
          <li class="${hecho ? 'hecho' : enCurso ? 'en-curso' : ''}">
            <b>${hecho ? '✓ ' : ''}${esc(p.etiqueta)}</b>
            <span class="meta">${hecho
              ? `${esc(quienes[p.estado] || '')} · ${esc((hechos[p.estado] || '').slice(0, 10))}`
              : esc(p.quien)}</span>
          </li>`;
      }).join('')}
    </ol>`;
}

async function vistaAlmacenTraspaso(id) {
  const { salida: t, faltantes } = await api('GET', `/api/almacen/salidas/${id}`);
  encabezado('Traspaso', `${t.folio} · ${t.bodega_clave} → ${t.bodega_destino_clave || '—'}`);
  const fotos = t.fotos || [];

  // Cada paso con su propio permiso: son los que se reparten en Configuración → Permisos.
  const puedeAprobar = permiso('traspasos_aprobar');
  const puedeTransito = permiso('traspasos_cargar');
  const puedeConfirmar = permiso('traspasos_confirmar');
  const puedeRegresar = permiso('traspasos_regresar');
  const unidades = t.renglones.reduce((s, r) => s + r.cantidad, 0);

  vista.innerHTML = `
    ${permiso('mod_almacen') ? migajaAlmacen('Traspasos', '#/almacen/traspasos', t.folio) : `
      <div class="migaja">
        <button data-ir-hash="#/menu">← Menú</button><span>/</span>
        ${permiso('mod_transito') ? '<button data-ir-hash="#/envios/transito">Tránsito</button><span>/</span>' : ''}
        <span>${esc(t.folio)}</span>
      </div>`}
    <div id="mensajes"></div>

    ${tiraConexiones([t.odt_id && t.odt_semana && liga(`#/produccion/odt/${t.odt_id}`, `ODT ${describirSemanaCorta(t.odt_semana)}`)])}
    <section class="panel">
      <h2>${esc(t.folio)} ${insigniaTraspaso(t.estado)}</h2>
      <p class="explica">
        ${t.odt_semana
          ? `Lo pidió la ODT de ${esc(describirSemanaCorta(t.odt_semana))}: falta material para armar en ${esc(t.bodega_destino || '')}.`
          : 'Traspaso capturado a mano.'}
      </p>
      ${caminoTraspaso(t)}
      <div class="pie">
        <span class="resumen">
          ${t.renglones.length} producto(s) · ${numero(unidades)} unidades ·
          sale de <b>${esc(t.bodega)}</b> y entra a <b>${esc(t.bodega_destino || '—')}</b>${
            t.estado === 'cargado' ? ' · <b>va en camino desde ' + esc((t.cargado_en || '').slice(0, 10)) + '</b>' : ''}
        </span>
      </div>
    </section>

    ${t.estado === 'cargado' ? `
      <div class="aviso">
        <span><b>El material va en camino.</b>
          <small>Hasta que un Team Leader confirme que llegó, el inventario no cambia:
            estas ${numero(unidades)} unidades se siguen viendo en ${esc(t.bodega)}.</small></span>
      </div>` : ''}

    ${t.estado === 'aplicada' ? `
      <div class="aviso exito" style="cursor:default">
        <span><b>Confirmado el ${esc((t.confirmado_en || '').slice(0, 10))}.</b>
          <small>Salieron ${numero(unidades)} unidades de ${esc(t.bodega)} y entraron a ${esc(t.bodega_destino || '')}.</small></span>
      </div>` : ''}

    <section class="panel">
      <h2>Qué se traspasa</h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Producto</th><th>Modelo</th>
          <th>Cantidad</th><th>Hay hoy en ${esc(t.bodega_clave)}</th></tr></thead>
        <tbody>${t.renglones.map((r) => `
          <tr>
            <td class="fila-titulo">${fotoProducto({ id: r.producto_id, sku: r.sku, nombre: r.producto })}${esc(r.producto)}</td>
            <td>${esc(r.modelo || '—')}</td>
            <td><b>${numero(r.cantidad)}</b></td>
            <td class="${r.cantidad > r.existencia && t.estado !== 'aplicada' ? 'alerta' : ''}">${numero(r.existencia)}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>

    <section class="panel">
      <h2>Foto de la carga ${fotos.length
        ? `<span class="etiqueta verde">${fotos.length}</span>`
        : '<span class="etiqueta ambar">falta</span>'}</h2>
      <p class="explica">
        Es lo único que queda de que el material efectivamente subió al camión.
        Sin ella, «cargado» es la palabra de una sola persona sobre material que
        todavía no llega a ningún lado.
      </p>
      <div class="tira-fotos" id="fotos-traspaso">
        ${fotos.map((f) => `
          <figure><img data-archivo="${esc(f.archivo)}" alt="Carga del traspaso"></figure>`).join('')}
      </div>
      ${t.estado === 'aprobado' && puedeTransito ? `
        <div class="fila-botones" style="padding:0 18px 18px">
          <input type="file" id="foto-carga" accept="image/*" capture="environment"
                 style="position:absolute;width:1px;height:1px;opacity:0">
          <button class="btn" id="tomar-foto">+ Agregar foto de la carga</button>
        </div>` : ''}
    </section>

    ${faltantes && faltantes.length && t.estado !== 'aplicada' && t.estado !== 'cancelada' ? `
      <div class="aviso error">
        <span><b>No se puede seguir:</b> <small>${esc(faltantes.join(' '))}</small></span>
      </div>` : ''}

    <div class="fila-botones" style="margin-bottom:24px">
      ${(t.estado === 'solicitado' || t.estado === 'borrador') && puedeAprobar
        ? '<button class="btn primario grande" id="aprobar">Aprobar el traspaso</button>' : ''}
      ${t.estado === 'aprobado' && puedeTransito
        ? '<button class="btn primario grande" id="cargado">El material ya va cargado</button>' : ''}
      ${t.estado === 'cargado' && puedeConfirmar
        ? '<button class="btn primario grande" id="confirmar">Llegó: confirmar el traspaso</button>' : ''}
      ${(t.estado === 'aprobado' || t.estado === 'cargado') && puedeRegresar
        ? '<button class="btn" id="regresar">Regresar un paso</button>' : ''}
    </div>`;

  cargarImagenesPendientes();

  const accion = async (ruta, cuerpo, exito) => {
    try {
      await api('POST', `/api/almacen/traspasos/${id}/${ruta}`, cuerpo);
      mostrarMensaje(exito, 'exito');
      setTimeout(() => enrutar(), 900);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  };

  const boton = (bid, fn) => {
    const b = document.getElementById(bid);
    if (b) b.addEventListener('click', () => { b.disabled = true; fn().finally(() => { b.disabled = false; }); });
  };

  boton('aprobar', () => accion('aprobar', {}, 'Traspaso aprobado. Ahora le toca a Tránsito.'));
  boton('cargado', () => accion('cargado', {}, 'Avisado: el material va cargado.'));
  boton('confirmar', () => accion('confirmar', {},
    'Traspaso confirmado. El inventario ya cambió en las dos bodegas.'));
  boton('regresar', async () => {
    const motivo = prompt('¿Por qué lo regresas un paso?');
    if (!motivo || !motivo.trim()) return;
    await accion('regresar', { motivo: motivo.trim() }, 'Traspaso regresado un paso.');
  });

  const tomar = document.getElementById('tomar-foto');
  const entradaFoto = document.getElementById('foto-carga');
  if (tomar && entradaFoto) {
    tomar.addEventListener('click', () => entradaFoto.click());
    entradaFoto.addEventListener('change', async () => {
      const archivo = entradaFoto.files && entradaFoto.files[0];
      if (!archivo) return;
      tomar.disabled = true;
      try {
        const imagen = await new Promise((listo, falla) => {
          const l = new FileReader();
          l.onload = () => listo(l.result);
          l.onerror = () => falla(new Error('No se pudo leer la foto.'));
          l.readAsDataURL(archivo);
        });
        await api('POST', `/api/almacen/salida/${id}/fotos`, { imagen });
        mostrarMensaje('Foto guardada.', 'exito');
        setTimeout(() => enrutar(), 700);
      } catch (err) { mostrarMensaje(err.message, 'error'); tomar.disabled = false; }
    });
  }
}

async function vistaAlmacenTraspasos() {
  encabezado('Traspasos', 'Material que cambia de bodega');
  const { traspasos, bodegas, bodega_armado: armado } = await api('GET', '/api/almacen/traspasos');

  const porAprobar = traspasos.filter((t) => t.estado === 'solicitado' || t.estado === 'borrador');
  const enCamino = traspasos.filter((t) => t.estado === 'aprobado' || t.estado === 'cargado');
  const porConfirmar = traspasos.filter((t) => t.estado === 'cargado');
  const porMover = [...porAprobar, ...porConfirmar];
  const puedeCapturar = permiso('traspasos_capturar');

  vista.innerHTML = `
    ${migajaAlmacen('Traspasos')}
    <div id="mensajes"></div>

    <p class="explica" style="padding-left:0">
      Un traspaso no saca material de la empresa: lo cambia de lugar. Pasa por
      cuatro manos antes de mover el inventario: lo <b>pide</b> Producción desde la
      ODT, lo <b>aprueba</b> un Team Leader de Almacén, <b>Tránsito</b> avisa con foto
      que el material va cargado, y al llegar un Team Leader lo <b>confirma</b>.
      Hasta ese último paso no cambia ninguna existencia.
    </p>

    ${porMover.length ? `
      <div class="aviso pendientes" style="cursor:default">
        <span class="cuenta">${porMover.length}</span>
        <span><b>Traspaso(s) esperando por Almacén.</b>
          <small>${porAprobar.length ? `${porAprobar.length} por aprobar` : ''}${
            porAprobar.length && porConfirmar.length ? ' · ' : ''}${
            porConfirmar.length ? `${porConfirmar.length} ya llegaron y falta confirmarlos` : ''}${
            enCamino.length ? ` · ${enCamino.length} en manos de Tránsito` : ''}.</small></span>
      </div>` : ''}

    ${puedeCapturar ? `
      <section class="panel">
        <h2>Capturar un traspaso a mano</h2>
        <p class="explica">
          Solo para lo que no pidió la ODT. Si el traspaso es para armar la orden
          de la semana, pídelo desde Producción: así queda amarrado a la ODT y no
          necesita que otra persona lo firme.
        </p>
        <div class="fila-campos" style="padding:0 18px 18px">
          <label>Sale de
            <select id="traspaso-origen">
              ${bodegas.map((b) => `<option value="${b.id}">${esc(b.nombre)} (${esc(b.clave)})</option>`).join('')}
            </select>
          </label>
          <label>Llega a
            <select id="traspaso-destino">
              ${bodegas.map((b) => `
                <option value="${b.id}" ${b.id === armado.id ? 'selected' : ''}>${esc(b.nombre)} (${esc(b.clave)})</option>`).join('')}
            </select>
          </label>
          <label>Fecha <input type="date" id="traspaso-fecha" value="${new Date().toISOString().slice(0, 10)}"></label>
          <button class="btn primario" id="crear-traspaso">Abrir traspaso</button>
        </div>
      </section>` : ''}

    <section class="panel">
      <h2>Traspasos <span class="etiqueta azul">${traspasos.length}</span></h2>
      ${traspasos.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr>
            <th class="fila-titulo">Folio</th><th>Fecha</th><th>De</th><th>A</th>
            <th>Productos</th><th>Unidades</th><th>Por</th><th>Situación</th><th></th>
          </tr></thead>
          <tbody>${traspasos.map((t) => `
            <tr>
              <td class="fila-titulo">${esc(t.folio)}
                ${t.odt_semana ? `<br><small>ODT ${esc(t.odt_semana)}</small>` : '<br><small>a mano</small>'}</td>
              <td>${esc(t.fecha)}</td>
              <td>${esc(t.bodega_clave)}</td>
              <td>${esc(t.bodega_destino_clave || '—')}</td>
              <td>${t.productos}</td>
              <td><b>${numero(t.unidades)}</b></td>
              <td><small>${esc(t.capturo)}</small></td>
              <td>${insigniaTraspaso(t.estado)}</td>
              <td><button class="btn" data-ir-hash="#/almacen/traspaso/${t.id}">Abrir</button></td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">Todavía no hay traspasos. Los que pida la ODT aparecerán aquí.</div>'}
    </section>`;

  const crear = document.getElementById('crear-traspaso');
  if (crear) {
    crear.addEventListener('click', async () => {
      crear.disabled = true;
      try {
        const { traspaso } = await api('POST', '/api/almacen/traspasos', {
          bodega_id: Number(document.getElementById('traspaso-origen').value),
          bodega_destino_id: Number(document.getElementById('traspaso-destino').value),
          fecha: document.getElementById('traspaso-fecha').value,
        });
        location.hash = `#/almacen/traspaso/${traspaso.id}`;
      } catch (err) { mostrarMensaje(err.message, 'error'); crear.disabled = false; }
    });
  }
}

// ============================================================== incidencias
//
// La hoja de papel, tal cual: todos los nombres, y al lado de cada quien lo que
// se le anotó y cuándo. Se pinta completa —también quien no tiene nada— porque
// así es la hoja y porque un nombre limpio es información, no un hueco.
//
// Un operador entra y ve solo la suya. Eso es a propósito: lo que se anota ahí
// le afecta el bono, y enterarse a fin de mes no le deja margen para corregir.

const ETIQUETA_INCIDENCIA = {
  por_autorizar: ['ambar', 'Por autorizar'],
  autorizada: ['roja', 'Autorizada'],
  rechazada: ['', 'Rechazada'],
  cancelada: ['', 'Retirada'],
};

const insigniaIncidencia = (estado) => {
  const [color, texto] = ETIQUETA_INCIDENCIA[estado] || ['', estado];
  return `<span class="etiqueta ${color}">${esc(texto)}</span>`;
};

const nombreDelMes = (mes) => {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [a, m] = String(mes).split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
};

async function vistaIncidencias(mes) {
  const d = await api('GET', '/api/incidencias' + (mes ? `?mes=${encodeURIComponent(mes)}` : ''));
  encabezado('Incidencias', nombreDelMes(d.mes));

  const conAlgo = d.hoja.filter((p) => p.incidencias.length);
  const autorizadas = d.hoja.reduce((n, p) => n + p.incidencias.filter((i) => i.estado === 'autorizada').length, 0);
  const porAutorizar = d.hoja.reduce((n, p) => n + p.incidencias.filter((i) => i.estado === 'por_autorizar').length, 0);
  const meses = [...new Set([d.mes, ...d.meses])].sort().reverse();

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span><span>Incidencias</span>
    </div>
    <div id="mensajes"></div>

    <p class="explica" style="padding-left:0">
      ${d.ve_todas
        ? `La hoja del personal. Un Team Leader levanta la incidencia y el Administrador
           la autoriza: <b>sin esa autorización no cuenta</b> para el corte del mes.
           La que levanta el Administrador queda firme y no se modifica.`
        : `Lo que se te ha anotado este mes. Si algo no te cuadra, háblalo con tu
           Team Leader: solo cuenta lo que el Administrador haya autorizado.`}
    </p>

    <div class="filtros-almacen">
      <label>Mes
        <select id="mes-incidencias">
          ${meses.map((m) => `<option value="${esc(m)}" ${m === d.mes ? 'selected' : ''}>${esc(nombreDelMes(m))}</option>`).join('')}
        </select>
      </label>
      ${d.puede_levantar ? '<button class="btn primario" id="nueva-incidencia">+ Levantar una incidencia</button>' : ''}
      ${permiso('incidencias_reportes') ? '<button class="btn" id="bajar-corte">Descargar el corte del mes</button>' : ''}
    </div>

    ${d.ve_todas ? `
      <div class="cifras-almacen">
        <div class="cifra ${autorizadas ? 'alerta' : ''}"><b>${autorizadas}</b><span>autorizada(s) este mes</span></div>
        <div class="cifra ${porAutorizar ? 'alerta' : ''}"><b>${porAutorizar}</b><span>esperando tu autorización</span></div>
        <div class="cifra"><b>${conAlgo.length}</b><span>persona(s) con algo anotado</span></div>
        <div class="cifra"><b>${d.hoja.length - conAlgo.length}</b><span>sin nada</span></div>
      </div>` : ''}

    <section class="panel">
      <h2>${d.ve_todas ? 'Hoja del personal' : 'Lo tuyo'}
        <span class="etiqueta azul">${d.hoja.length} ${d.hoja.length === 1 ? 'persona' : 'personas'}</span></h2>
      <div class="hoja-incidencias">
        ${d.hoja.map((p) => `
          <div class="renglon-persona ${p.incidencias.length ? '' : 'limpio'}">
            <div class="quien">
              <b>${esc(p.nombre)}</b>
              <small>${esc(p.puesto || p.rol || '')}</small>
            </div>
            <div class="anotado">
              ${p.incidencias.length
                ? p.incidencias.map((i) => `
                  <div class="anotacion ${i.estado}">
                    <div class="cabeza">
                      <span class="fecha">${esc(i.fecha)}</span>
                      ${insigniaIncidencia(i.estado)}
                      ${i.firme && i.estado === 'autorizada' ? '<span class="etiqueta" title="Levantada por el Administrador: no se modifica">firme</span>' : ''}
                    </div>
                    <p>${esc(i.situacion)}</p>
                    <small>La levantó ${esc(i.levanto)}${
                      i.resolvio ? ` · ${i.estado === 'cancelada' ? 'la retiró' : i.estado === 'rechazada' ? 'la rechazó' : 'la autorizó'} ${esc(i.resolvio)}` : ''}${
                      i.nota_resolucion ? ` — «${esc(i.nota_resolucion)}»` : ''}</small>
                    ${i.estado === 'por_autorizar' && d.puede_autorizar ? `
                      <div class="fila-botones">
                        <button class="btn primario" data-autorizar="${i.id}">Autorizar</button>
                        <button class="btn" data-rechazar="${i.id}">Rechazar</button>
                      </div>` : ''}
                    ${i.estado === 'por_autorizar' && !d.puede_autorizar && d.puede_levantar ? `
                      <div class="fila-botones">
                        <button class="btn" data-retirar="${i.id}">Retirarla</button>
                      </div>` : ''}
                  </div>`).join('')
                : '<span class="sin-nada">Sin nada anotado este mes.</span>'}
            </div>
          </div>`).join('')}
      </div>
      ${d.ve_todas ? `
        <div class="pie"><span class="resumen">
          Para el corte del mes solo cuentan las <b>autorizadas</b>. Lo que espera
          autorización, lo rechazado y lo retirado se ve aquí pero no suma.
        </span></div>` : ''}
    </section>`;

  document.getElementById('mes-incidencias').addEventListener('change', (e) => {
    location.hash = `#/incidencias/${e.target.value}`;
  });

  const bajar = document.getElementById('bajar-corte');
  if (bajar) bajar.addEventListener('click', () => descargarCSV(`/api/incidencias/corte.csv?mes=${d.mes}`));

  const nueva = document.getElementById('nueva-incidencia');
  if (nueva) nueva.addEventListener('click', () => abrirIncidencia(d.personas, d.puede_autorizar));

  const accion = async (id, ruta, cuerpo, exito) => {
    try {
      await api('POST', `/api/incidencias/${id}/${ruta}`, cuerpo);
      mostrarMensaje(exito, 'exito');
      setTimeout(() => enrutar(), 800);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  };

  vista.querySelectorAll('[data-autorizar]').forEach((b) => b.addEventListener('click', () => {
    b.disabled = true;
    accion(b.dataset.autorizar, 'autorizar', {}, 'Incidencia autorizada. Ya cuenta para el corte del mes.');
  }));
  vista.querySelectorAll('[data-rechazar]').forEach((b) => b.addEventListener('click', () => {
    const nota = prompt('¿Por qué la rechazas? Quien la levantó tiene que saberlo.');
    if (!nota || !nota.trim()) return;
    b.disabled = true;
    accion(b.dataset.rechazar, 'rechazar', { nota: nota.trim() }, 'Incidencia rechazada.');
  }));
  vista.querySelectorAll('[data-retirar]').forEach((b) => b.addEventListener('click', () => {
    const motivo = prompt('¿Por qué la retiras?');
    if (!motivo || !motivo.trim()) return;
    b.disabled = true;
    accion(b.dataset.retirar, 'cancelar', { motivo: motivo.trim() }, 'Incidencia retirada.');
  }));
}

// Levantar una incidencia. Se avisa desde el principio si va a quedar firme o si
// va a esperar autorización: cambia lo que uno escribe saberlo antes.
function abrirIncidencia(personas, quedaFirme) {
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Levantar una incidencia">
      <h2>Levantar una incidencia</h2>
      <div class="cuerpo-modal">
        <div id="error-incidencia"></div>
        <p class="explica" style="padding:0 0 14px">
          ${quedaFirme
            ? 'Queda <b>firme</b> en cuanto la guardes: la levantas tú, no la modifica nadie.'
            : 'Queda <b>esperando la autorización del Administrador</b>. Hasta que él la autorice no cuenta para el corte del mes.'}
        </p>
        <div class="campo">
          <label for="i-persona">¿A quién?</label>
          <select id="i-persona">
            <option value="">Elige a la persona…</option>
            ${personas.map((p) => `<option value="${p.id}">${esc(p.nombre)} — ${esc(
              (p.rol || '').replace('team_leader', 'Team Leader').replace('operador', 'Operador'))}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label for="i-fecha">¿Cuándo fue?</label>
          <input type="date" id="i-fecha" value="${new Date().toISOString().slice(0, 10)}"
                 max="${new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="campo">
          <label for="i-situacion">¿Qué pasó?</label>
          <textarea id="i-situacion" rows="4"
            placeholder="Qué proceso no se cumplió y en qué consistió. Con el detalle suficiente para entenderlo dentro de un mes, cuando se revise el corte."></textarea>
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" id="i-cancelar">Cancelar</button>
        <button class="btn primario" id="i-guardar">Levantar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);

  const cerrar = () => capa.remove();
  capa.querySelector('#i-cancelar').addEventListener('click', cerrar);
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });

  capa.querySelector('#i-guardar').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const error = capa.querySelector('#error-incidencia');
    boton.disabled = true;
    try {
      await api('POST', '/api/incidencias', {
        usuario_id: Number(capa.querySelector('#i-persona').value),
        fecha: capa.querySelector('#i-fecha').value,
        situacion: capa.querySelector('#i-situacion').value,
      });
      cerrar();
      mostrarMensaje(quedaFirme ? 'Incidencia levantada y firme.' : 'Incidencia levantada. Espera la autorización del Administrador.', 'exito');
      setTimeout(() => enrutar(), 800);
    } catch (err) {
      error.innerHTML = avisoError(err.message);
      boton.disabled = false;
    }
  });
}

// ========================================================= entregas x fuera
//
// La orden de armado de una venta directa, de punta a punta: quien vende la
// levanta, Almacén la arma y anota sus cajas, quien vende carga la guía o la
// nota de remisión, y el encargado la cierra. Cada paso le llega en
// Notificaciones a quien le toca.

const ETIQUETA_VXF = {
  borrador: ['ambar', 'En captura'],
  por_armar: ['azul', 'Por armar'],
  armada: ['azul', 'Armada: falta la guía o nota'],
  documentada: ['azul', 'Por cerrar'],
  terminada: ['verde', 'Terminada'],
  cancelada: ['roja', 'Cancelada'],
};
const insigniaVxf = (e) => {
  const [color, texto] = ETIQUETA_VXF[e] || ['', e];
  return `<span class="etiqueta ${color}">${esc(texto)}</span>`;
};
const migajaVxf = (hoja) => migajaModulo('Ventas directas', '#/ventas-fuera', hoja ? 'Órdenes' : null, hoja ? '#/ventas-fuera' : null, hoja);

// El cliente se escoge de la cartera escribiendo unas letras. Si lo que se
// escribe no está, se avisa que se va a agregar: así nadie da de alta un
// cliente sin darse cuenta.
const campoCliente = (id, valor, clientes) => `
  <input id="${id}" list="${id}-lista" value="${esc(valor)}" placeholder="Escribe para buscar en la cartera…" autocomplete="off">
  <datalist id="${id}-lista">${(clientes || []).map((c) => `<option value="${esc(c.nombre)}">${esc(c.razon_social || '')}</option>`).join('')}</datalist>
  <small class="nota-campo" id="${id}-nota">${(clientes || []).length} cliente(s) en la cartera.</small>`;

function conectarCampoCliente(raiz, id, clientes) {
  const campo = raiz.querySelector(`#${id}`);
  const nota = raiz.querySelector(`#${id}-nota`);
  if (!campo || !nota) return;
  const nombres = new Set((clientes || []).map((c) => c.nombre.toLowerCase()));
  const revisar = () => {
    const v = campo.value.trim().replace(/\s+/g, ' ').toLowerCase();
    nota.classList.toggle('nota-nuevo', !!v && !nombres.has(v));
    nota.textContent = !v ? `${nombres.size} cliente(s) en la cartera.`
      : nombres.has(v) ? 'Cliente de la cartera.' : 'Cliente nuevo: se agregará a la cartera al guardar.';
  };
  campo.addEventListener('input', revisar);
  revisar();
}

async function catalogoVxf() {
  if (!estado.catalogo_vxf) estado.catalogo_vxf = await api('GET', '/api/vxf/catalogo');
  return estado.catalogo_vxf;
}

async function vistaVxf() {
  encabezado('Ventas directas', 'Órdenes de armado de ventas directas');
  const { ordenes, solo_mias: soloMias } = await api('GET', '/api/vxf/ordenes');

  const tarjeta = (o) => `
    <button class="tarea ${o.estado === 'terminada' ? 'aplicada' : o.correccion_nota ? 'por_autorizar' : 'borrador'}" data-ir-hash="#/ventas-fuera/orden/${o.id}">
      ${o.correccion_nota ? '<span class="etiqueta roja">Regresada</span>' : insigniaVxf(o.estado)}
      <b>${esc(o.folio)} · ${esc(o.cliente)}</b>
      <span class="meta">${numero(o.unidades)} pieza(s) · ${o.entrega === 'guia' ? 'con guía' : 'con nota de remisión'}${o.cajas ? ` · ${o.cajas} caja(s)` : ''}</span>
      <span class="meta">Pidió ${esc(o.solicitante)} · ${fechaCorta(o.fecha_solicitud)}</span>
    </button>`;
  const bloque = (titulo, lista, color, vacio) => (lista.length || vacio ? `
    <section class="panel">
      <h2>${titulo} ${lista.length ? `<span class="etiqueta ${color}">${lista.length}</span>` : ''}</h2>
      ${lista.length ? `<div class="rejilla-tareas" style="padding:18px">${lista.map(tarjeta).join('')}</div>`
        : `<div class="vacio">${vacio}</div>`}
    </section>` : '');
  const de = (...estados) => ordenes.filter((o) => estados.includes(o.estado));

  vista.innerHTML = `
    ${migajaVxf()}
    <div id="mensajes"></div>
    <p class="explica" style="padding-left:0">
      ${soloMias ? 'Tus órdenes de armado. ' : ''}Quien vende la levanta y la manda a armar;
      Almacén la arma y anota cada caja con su modelo y su peso; quien vende carga la guía
      o la nota de remisión, y el encargado la cierra.
    </p>
    ${permiso('ventas_fuera_capturar') || permiso('ventas_fuera_clientes') ? `
      <div class="fila-botones" style="margin-bottom:18px">
        ${permiso('ventas_fuera_capturar') ? '<button class="btn primario" id="nueva-vxf">+ Nueva orden de armado</button>' : ''}
        ${permiso('ventas_fuera_clientes') ? '<button class="btn" data-ir-hash="#/ventas-fuera/clientes">Cartera de clientes</button>' : ''}
      </div>` : ''}
    ${bloque('En captura', de('borrador'), 'ambar')}
    ${bloque('Por armar', de('por_armar'), 'azul', 'No hay órdenes esperando armarse.')}
    ${bloque('Armadas: falta la guía o la nota', de('armada'), 'azul')}
    ${bloque('Por cerrar', de('documentada'), 'azul')}
    ${bloque('Terminadas', de('terminada').slice(0, 30), 'verde')}`;

  const nueva = document.getElementById('nueva-vxf');
  if (nueva) nueva.addEventListener('click', abrirNuevaVxf);
}

async function abrirNuevaVxf() {
  const cat = await catalogoVxf();
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Nueva orden de armado">
      <h2>Nueva orden de armado</h2>
      <div class="cuerpo-modal">
        <div id="error-vxf"></div>
        <div class="campo"><label>Quién la solicita</label><input value="${esc(estado.usuario.nombre)}" disabled></div>
        <div class="campo"><label for="v-fecha">Fecha de la solicitud</label><input type="date" id="v-fecha" value="${hoyLocal()}"></div>
        <div class="campo"><label for="v-cliente">Cliente al que se entrega</label>
          ${campoCliente('v-cliente', '', cat.clientes)}</div>
        <div class="campo"><label>¿Cómo se entrega?</label>
          <div class="fila-botones">
            ${cat.entregas.map((e, i) => `
              <label class="chip"><input type="radio" name="v-entrega" value="${e.clave}" ${i === 0 ? 'checked' : ''}> ${esc(e.etiqueta)}</label>`).join('')}
          </div>
        </div>
        <div class="campo"><label>¿Cómo se cobra?</label>
          <div class="fila-botones">
            ${(cat.cobros || []).map((c, i) => `
              <label class="chip"><input type="radio" name="v-cobro" value="${c.clave}" ${i === 0 ? 'checked' : ''}> ${esc(c.etiqueta)}</label>`).join('')}
          </div>
        </div>
        <div class="campo" id="v-campo-monto" hidden>
          <label for="v-monto">¿Cuánto se le cobra al cliente?</label>
          <input id="v-monto" inputmode="decimal" placeholder="Ej. 1850.00">
          <small class="nota-campo">Es lo que quien entregue tiene que traer de regreso.</small>
        </div>
        <p class="explica" style="padding:0">Los productos y las cantidades vendidas se agregan en la siguiente pantalla.</p>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-crear>Crear la orden</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  capa.querySelector('[data-crear]').addEventListener('click', async () => {
    try {
      const { orden, cliente_nuevo: nuevo } = await api('POST', '/api/vxf/ordenes', {
        cliente: capa.querySelector('#v-cliente').value,
        fecha: capa.querySelector('#v-fecha').value,
        entrega: (capa.querySelector('input[name="v-entrega"]:checked') || {}).value,
        cobro: (capa.querySelector('input[name="v-cobro"]:checked') || {}).value,
        monto_cobrar: capa.querySelector('#v-monto').value,
      });
      cerrar();
      if (nuevo) estado.catalogo_vxf = null;
      location.hash = `#/ventas-fuera/orden/${orden.id}`;
      if (nuevo) setTimeout(() => mostrarMensaje(`«${orden.cliente}» se agregó a la cartera de clientes.`, 'exito'), 600);
    } catch (err) { capa.querySelector('#error-vxf').innerHTML = avisoError(err.message); }
  });
  capa.querySelectorAll('input[name="v-cobro"]').forEach((r) => r.addEventListener('change', () => {
    capa.querySelector('#v-campo-monto').hidden = r.value !== 'por_cobrar' || !r.checked;
  }));
  conectarCampoCliente(capa, 'v-cliente', cat.clientes);
  capa.querySelector('#v-cliente').focus();
}

// --- la existencia inicial ---
//
// Tres pasos en una pantalla: descargar la plantilla (ya con los productos y una
// columna por bodega), subir el archivo lleno y revisar lo que se va a cargar,
// y aplicarlo. Nada toca el inventario hasta el último botón.
async function vistaCargaInicial() {
  encabezado('Existencia inicial', 'El punto de partida del inventario');
  let archivo = null;
  let nombreArchivo = '';

  vista.innerHTML = `
    ${migajaAlmacen('Existencia inicial')}
    <div id="mensajes"></div>
    <div class="panel">
      <h2>1 · La plantilla</h2>
      <p class="explica">Un renglón por producto (SKU, producto, modelo, tipo) y <b>una columna por bodega</b> con lo que
        hay hoy. Viene con todos los productos del catálogo y la existencia actual; llénala en Excel y guárdala.
        También sirve cualquier Excel tuyo con una columna «SKU», «Producto» o «Modelo» y una columna por bodega.</p>
      <div class="fila-botones" style="padding:12px 20px 18px">
        <button class="btn" id="bajar-plantilla">Descargar plantilla</button>
      </div>
    </div>
    <div class="panel">
      <h2>2 · Sube el archivo y revisa</h2>
      <div class="fila-botones" style="padding:16px 20px 6px">
        <input type="file" id="archivo-carga" accept=".xlsx,.csv" hidden>
        <button class="btn primario" id="escoger-carga">Escoger archivo (.xlsx o .csv)</button>
        <span id="nombre-carga" class="nota-campo"></span>
      </div>
      <div id="revision-carga"></div>
    </div>`;

  document.getElementById('bajar-plantilla').addEventListener('click', () => descargarCSV('/api/almacen/carga-inicial/plantilla'));
  const input = document.getElementById('archivo-carga');
  document.getElementById('escoger-carga').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    archivo = await leerComoDataURL(f);
    nombreArchivo = f.name;
    document.getElementById('nombre-carga').textContent = f.name;
    revisar();
  });

  async function revisar() {
    const zona = document.getElementById('revision-carga');
    zona.innerHTML = '<div class="vacio">Revisando…</div>';
    try {
      const r = await api('POST', '/api/almacen/carga-inicial/revisar', { archivo, nombre: nombreArchivo });
      const hoy = hoyLocal();
      zona.innerHTML = `
        <div class="cifras-almacen" style="padding:0 20px">
          <div class="cifra"><b>${numero(r.productos)}</b><span>productos con existencia</span></div>
          ${r.totales.filter((b) => b.en_archivo).map((b) => `
            <div class="cifra"><b>${numero(b.unidades)}</b><span>en ${esc(b.nombre)} · ${b.productos} producto(s)</span></div>`).join('')}
        </div>
        ${r.totales.some((b) => !b.en_archivo) ? `<p class="explica">Sin columna en el archivo (se quedan en ceros):
          ${r.totales.filter((b) => !b.en_archivo).map((b) => esc(b.nombre)).join(', ')}.</p>` : ''}
        ${r.sin_catalogo.length ? `<div class="aviso error" style="margin:12px 20px 0"><span><b>${r.sin_catalogo.length} renglón(es) no están en el catálogo y no se cargan.</b>
          <small>${esc(r.sin_catalogo.slice(0, 12).join(' · '))}${r.sin_catalogo.length > 12 ? ' …' : ''}</small></span></div>` : ''}
        ${r.malos.length ? `<div class="aviso error" style="margin:12px 20px 0"><span><b>Hay cantidades que no son números.</b>
          <small>${esc(r.malos.slice(0, 8).join(' · '))}</small></span></div>` : ''}
        ${r.negativos ? `<p class="explica">${r.negativos} producto(s) traen existencia negativa: se cargan tal cual.</p>` : ''}
        ${r.previa ? `<div class="aviso pendientes" style="margin:12px 20px 0;cursor:default"><span><b>Ya hay una existencia inicial cargada</b>
          <small>${numero(r.previa.unidades)} unidades al ${esc(fechaCorta(r.previa.fecha))}. Aplicar esta la <b>reemplaza completa</b>.
          ${r.otros_movimientos ? `Ojo: ya hay ${numero(r.otros_movimientos)} movimiento(s) capturados después; se quedan, encima de la carga nueva.` : ''}</small></span></div>` : ''}
        <div class="bloque-form">
          <h3>3 · Aplicar</h3>
          <div class="rejilla-campos">
            <div class="campo"><label for="fecha-carga">La existencia es al día</label><input type="date" id="fecha-carga" value="${hoy}" max="${hoy}"></div>
            <div class="campo"><label for="nota-carga">Nota (opcional)</label><input id="nota-carga" placeholder="Ej. Conteo físico del 18 de septiembre"></div>
          </div>
          ${r.previa ? '<label class="casilla-texto"><input type="checkbox" id="reemplazar-carga"> Sí, reemplazar la existencia inicial anterior</label>' : ''}
          <button class="btn primario" id="aplicar-carga" ${r.malos.length || !r.productos ? 'disabled' : ''}>Aplicar la existencia inicial</button>
        </div>`;
      document.getElementById('aplicar-carga').addEventListener('click', async (e) => {
        const reemplazar = !!(document.getElementById('reemplazar-carga') || {}).checked;
        if (r.previa && !reemplazar) return mostrarMensaje('Marca la casilla para reemplazar la carga anterior.', 'error');
        if (!confirm(`¿Aplicar la existencia inicial? ${numero(r.productos)} producto(s).`)) return;
        e.currentTarget.disabled = true;
        try {
          const hecho = await api('POST', '/api/almacen/carga-inicial/aplicar', {
            archivo, nombre: nombreArchivo, reemplazar,
            fecha: document.getElementById('fecha-carga').value,
            nota: document.getElementById('nota-carga').value,
          });
          estado.catalogos_almacen = null;
          zona.innerHTML = `<div class="aviso exito" style="margin:12px 20px 18px"><span><b>Existencia inicial aplicada.</b>
            <small>${numero(hecho.movimientos)} movimiento(s) · ${hecho.totales.filter((b) => b.en_archivo)
              .map((b) => `${numero(b.unidades)} en ${esc(b.nombre)}`).join(' · ')}.</small></span>
            <button class="btn" data-ir-hash="#/almacen/inventario">Ver el inventario</button></div>`;
        } catch (err) { mostrarMensaje(err.message, 'error'); e.currentTarget.disabled = false; }
      });
    } catch (err) {
      zona.innerHTML = avisoError(err.message);
    }
  }
}

// --- la cartera de clientes ---
async function vistaVxfClientes() {
  encabezado('Cartera de clientes', 'A quién se le envían las entregas por fuera');
  const { clientes } = await api('GET', '/api/vxf/clientes');
  const porRevisar = clientes.filter((c) => !c.revisado);
  const activos = clientes.filter((c) => c.activo);
  const filtro = sessionStorage.getItem('vxf.clientes.filtro') || (porRevisar.length ? 'revisar' : 'activos');
  const ORIGEN = { excel: 'Excel', manual: 'a mano', orden: 'desde una orden' };

  vista.innerHTML = `
    ${migajaModulo('Ventas directas', '#/ventas-fuera', 'Cartera de clientes')}
    <div id="mensajes"></div>

    <div class="panel">
      <h2>${activos.length} cliente(s) en la cartera</h2>
      <div class="chips-filtro" style="padding:12px 20px 0">
        ${[['revisar', `Por revisar · ${porRevisar.length}`], ['activos', `Activos · ${activos.length}`],
          ['retirados', `Retirados · ${clientes.length - activos.length}`], ['todos', `Todos · ${clientes.length}`]]
          .map(([k, t]) => `<button class="chip-filtro" aria-pressed="${k === filtro}" data-filtro-cli="${k}">${t}</button>`).join('')}
      </div>
      <div class="filtro-lista"><input type="search" id="buscar-cliente" placeholder="Buscar cliente…" autocomplete="off"></div>
      <div class="lista-clientes">
        ${clientes.map((c) => `
          <div class="fila-cliente ${c.activo ? '' : 'inactiva'}" data-cli="${c.id}" data-estado="${!c.revisado ? 'revisar' : ''} ${c.activo ? 'activos' : 'retirados'}"
               data-texto="${esc(`${c.nombre} ${c.razon_social || ''}`.toLowerCase())}">
            <span class="que"><b>${esc(c.nombre)}</b>
              <small>${c.direccion ? `📍 ${esc(c.direccion)} · ` : ''}${c.razon_social ? `${esc(c.razon_social)} · ` : ''}${c.ordenes ? `${c.ordenes} orden(es) · última ${fechaCorta(c.ultima)}` : 'sin órdenes'}
                · ${esc(ORIGEN[c.origen] || c.origen)}${c.origen === 'orden' && c.creo ? ` (${esc(c.creo)})` : ''}</small></span>
            ${!c.revisado ? '<span class="etiqueta ambar">Por revisar</span>' : ''}
            ${!c.activo ? '<span class="etiqueta">Retirado</span>' : ''}
            ${!c.revisado ? `<button class="btn" data-bueno="${c.id}">Está bien</button>` : ''}
            <button class="btn" data-editar-cli="${c.id}">Editar</button>
          </div>`).join('')}
      </div>
      <div class="vacio" id="sin-clientes" hidden>Nada coincide.</div>
    </div>

    <div class="panel">
      <h2>Agregar clientes</h2>
      <div class="dos-columnas">
        <div class="bloque-form">
          <h3>Cargar desde Excel</h3>
          <p class="explica" style="padding:0 0 10px">El archivo de clientes que exportas (columnas <b>Nombre</b>, Apellido,
            Razón Social…). Solo agrega los que no están: puedes volver a cargar el archivo completo cuando crezca.</p>
          <input type="file" id="archivo-clientes" accept=".xlsx" hidden>
          <button class="btn primario" id="cargar-clientes">Escoger archivo .xlsx</button>
        </div>
        <div class="bloque-form">
          <h3>Uno a mano</h3>
          <div class="campo"><label for="nc-nombre">Nombre</label><input id="nc-nombre" placeholder="Ej. Papelería del Centro"></div>
          <div class="campo"><label for="nc-razon">Razón social (opcional)</label><input id="nc-razon"></div>
          <button class="btn" id="agregar-cliente">Agregar</button>
        </div>
      </div>
    </div>`;

  let actual = filtro;
  const buscar = document.getElementById('buscar-cliente');
  const filtrar = () => {
    const t = buscar.value.trim().toLowerCase();
    let n = 0;
    vista.querySelectorAll('[data-cli]').forEach((f) => {
      const ok = (actual === 'todos' || f.dataset.estado.includes(actual)) && (!t || f.dataset.texto.includes(t));
      f.hidden = !ok;
      if (ok) n += 1;
    });
    document.getElementById('sin-clientes').hidden = n > 0;
  };
  buscar.addEventListener('input', filtrar);
  vista.querySelectorAll('[data-filtro-cli]').forEach((b) => b.addEventListener('click', () => {
    actual = b.dataset.filtroCli;
    sessionStorage.setItem('vxf.clientes.filtro', actual);
    vista.querySelectorAll('[data-filtro-cli]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    filtrar();
  }));
  filtrar();

  const archivo = document.getElementById('archivo-clientes');
  document.getElementById('cargar-clientes').addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    const f = archivo.files[0];
    archivo.value = '';
    if (!f) return;
    try {
      const r = await api('POST', '/api/vxf/clientes/importar', { archivo: await leerComoDataURL(f) });
      estado.catalogo_vxf = null;
      await vistaVxfClientes();
      mostrarMensaje(`Se agregaron ${r.nuevos} cliente(s). ${r.ya_estaban} ya estaban${r.repetidos_en_archivo ? `, ${r.repetidos_en_archivo} venían repetidos en el archivo` : ''}.`, 'exito');
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  document.getElementById('agregar-cliente').addEventListener('click', async () => {
    try {
      await api('POST', '/api/vxf/clientes', {
        nombre: document.getElementById('nc-nombre').value, razon_social: document.getElementById('nc-razon').value,
      });
      estado.catalogo_vxf = null;
      await vistaVxfClientes();
      mostrarMensaje('Cliente agregado.', 'exito');
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });

  vista.querySelectorAll('[data-bueno]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('PUT', `/api/vxf/clientes/${b.dataset.bueno}`, {}); await vistaVxfClientes(); }
    catch (err) { mostrarMensaje(err.message, 'error'); }
  }));

  vista.querySelectorAll('[data-editar-cli]').forEach((b) => b.addEventListener('click', () => {
    const c = clientes.find((x) => x.id === Number(b.dataset.editarCli));
    const otros = clientes.filter((x) => x.id !== c.id && x.activo);
    const capa = document.createElement('div');
    capa.className = 'modal';
    capa.innerHTML = `
      <div class="caja-modal" role="dialog" aria-label="Editar cliente">
        <h2>${esc(c.nombre)}</h2>
        <div class="cuerpo-modal">
          <div id="error-modal"></div>
          <div class="campo"><label for="ec-nombre">Nombre</label><input id="ec-nombre" value="${esc(c.nombre)}"></div>
          <div class="campo"><label for="ec-razon">Razón social</label><input id="ec-razon" value="${esc(c.razon_social || '')}"></div>
          <div class="campo"><label for="ec-direccion">Dirección de entrega</label>
            <input id="ec-direccion" value="${esc(c.direccion || '')}" placeholder="Calle y número, colonia, ciudad">
            <small class="nota-campo">La traen solas sus paradas en la ruta de entrega, y con ella se abre el mapa.</small></div>
          <label class="casilla-texto"><input type="checkbox" id="ec-activo" ${c.activo ? 'checked' : ''}> En la cartera (desmarcado deja de salir al levantar una orden)</label>
          <div class="campo" style="margin-top:14px"><label for="ec-unir">¿Es el mismo que otro? Unir con…</label>
            <input id="ec-unir" list="ec-unir-lista" placeholder="Escribe el cliente con el que se une" autocomplete="off">
            <datalist id="ec-unir-lista">${otros.map((x) => `<option value="${esc(x.nombre)}">`).join('')}</datalist>
            <small class="nota-campo">Sus ${c.ordenes} orden(es) pasan a ese cliente y este desaparece.</small></div>
        </div>
        <div class="pie-modal">
          <button class="btn" data-cerrar>Cancelar</button>
          <button class="btn primario" data-guardar>Guardar cambios</button>
        </div>
      </div>`;
    document.body.appendChild(capa);
    const cerrar = () => capa.remove();
    capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
    capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
    capa.querySelector('[data-guardar]').addEventListener('click', async () => {
      const error = (m) => { capa.querySelector('#error-modal').innerHTML = avisoError(m); };
      try {
        const unirCon = capa.querySelector('#ec-unir').value.trim().toLowerCase();
        if (unirCon) {
          const destino = otros.find((x) => x.nombre.toLowerCase() === unirCon);
          if (!destino) return error('Escoge de la lista el cliente con el que se une.');
          if (!confirm(`¿Unir «${c.nombre}» con «${destino.nombre}»? Sus órdenes pasan a «${destino.nombre}».`)) return;
          await api('POST', `/api/vxf/clientes/${c.id}/unir`, { con: destino.id });
        } else {
          await api('PUT', `/api/vxf/clientes/${c.id}`, {
            nombre: capa.querySelector('#ec-nombre').value,
            razon_social: capa.querySelector('#ec-razon').value,
            direccion: capa.querySelector('#ec-direccion').value,
            activo: capa.querySelector('#ec-activo').checked,
          });
        }
        cerrar();
        estado.catalogo_vxf = null;
        await vistaVxfClientes();
        mostrarMensaje('Cliente guardado.', 'exito');
      } catch (err) { error(err.message); }
    });
  }));
}

// El camino de la orden, paso por paso, con quién y cuándo.
function caminoVxf(o) {
  const pasos = [
    ['Levantada', o.solicitante, o.enviado_en || o.creado_en],
    ['Armada', o.armo, o.armado_en],
    [o.entrega === 'guia' ? 'Guía cargada' : 'Nota de remisión cargada', o.documento_quien, o.documentado_en],
    // Una venta por cobrar tiene dos pasos más: el dinero de regreso y quién lo
    // confirmó. Una venta ya pagada no los tiene y no los enseña.
    ...(o.cobro === 'por_cobrar' ? [
      ['Dinero cobrado', o.cobro_entrego, o.cobro_entregado_en],
      ['Cobro confirmado', o.cobro_confirmo, o.cobro_confirmado_en],
    ] : []),
    ['Terminada', o.cerro, o.cerrado_en],
  ];
  return `
    <ol class="camino">
      ${pasos.map(([texto, quien, cuando]) => `
        <li class="${cuando ? 'hecho' : ''}">
          <b>${esc(texto)}</b>
          <small>${cuando ? `${esc(quien || '—')} · ${esc(new Date(cuando).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}` : 'pendiente'}</small>
        </li>`).join('')}
    </ol>`;
}

// El dinero de una venta por cobrar. Dos pasos y dos personas: quien entregó
// anota lo que recibió con su evidencia, y un Team Leader confirma que llegó
// completo. Hasta entonces la orden no se cierra.
function panelCobro(o, cat) {
  const puedeAnotar = permiso('ventas_fuera_cobrar') && !o.cobro_confirmado_en;
  const puedeConfirmar = permiso('ventas_fuera_autorizar') && o.cobro_entregado_en && !o.cobro_confirmado_en;
  const faltante = o.monto_cobrar && o.cobro_recibido !== null && o.cobro_recibido !== undefined
    ? Math.round((o.monto_cobrar - o.cobro_recibido) * 100) / 100 : null;

  return `
    <section class="panel">
      <h2>El cobro
        ${o.cobro_confirmado_en ? '<span class="etiqueta verde">confirmado</span>'
          : o.cobro_entregado_en ? '<span class="etiqueta ambar">esperando confirmación</span>'
          : '<span class="etiqueta roja">falta cobrar</span>'}</h2>
      <div style="padding:0 18px 18px">
        <p style="margin:0 0 12px">
          Se le cobra al cliente <b>${pesos(o.monto_cobrar)}</b>${o.cobro_entregado_en ? `
            · trajeron <b>${pesos(o.cobro_recibido)}</b>${o.cobro_forma ? ` en ${esc(o.cobro_forma.toLowerCase())}` : ''}
            · lo entregó ${esc(o.cobro_entrego || '—')}` : ''}
          ${faltante ? `<br><span class="etiqueta roja">faltan ${pesos(faltante)}</span>` : ''}
          ${o.cobro_nota ? `<br><small style="color:var(--tinta-suave)">${esc(o.cobro_nota)}</small>` : ''}
          ${o.cobro_confirmado_en ? `<br><small style="color:var(--tinta-suave)">Confirmado por ${esc(o.cobro_confirmo || '—')}</small>` : ''}
        </p>

        ${o.evidencia_cobro.length ? `
          <div class="miniaturas">${o.evidencia_cobro.map((f) => (/\.pdf$/i.test(f.archivo)
            ? `<button class="miniatura pdf" data-ver-archivo="${esc(f.archivo)}">PDF</button>`
            : `<img class="miniatura" data-archivo="${esc(f.archivo)}" data-ver-archivo="${esc(f.archivo)}" alt="">`)).join('')}</div>` : ''}

        ${puedeAnotar && !o.cobro_entregado_en ? `
          <div class="rejilla-campos" style="margin-top:12px">
            <div class="campo"><label for="co-recibido">¿Cuánto te dieron?</label>
              <input id="co-recibido" inputmode="decimal" value="${o.monto_cobrar ?? ''}"></div>
            <div class="campo"><label for="co-forma">¿Cómo te pagaron?</label>
              <select id="co-forma">${(cat.formas_cobro || []).map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></div>
            <div class="campo"><label for="co-nota">Nota</label>
              <input id="co-nota" placeholder="Si trajiste menos, di por qué"></div>
          </div>
          <div class="fila-botones">
            <label class="btn" for="co-foto">Subir la foto del dinero</label>
            <input type="file" id="co-foto" accept="image/*,application/pdf" hidden>
            <button class="btn primario" id="co-guardar">Anotar el dinero</button>
          </div>` : ''}

        ${puedeConfirmar ? `
          <div class="fila-botones" style="margin-top:12px">
            <button class="btn primario" id="co-confirmar">Confirmar que llegó completo</button>
            <button class="btn" id="co-regresar">Regresarlo a quien entregó</button>
          </div>` : ''}
      </div>
    </section>`;
}

function conectarCobro(o) {
  const foto = document.getElementById('co-foto');
  if (foto) {
    foto.addEventListener('change', async () => {
      const f = foto.files[0];
      if (!f) return;
      try {
        await api('POST', `/api/almacen/vxf_cobro/${o.id}/fotos`, { imagen: await leerComoDataURL(f) });
        mostrarMensaje('Evidencia guardada.', 'exito');
        vistaVxfOrden(o.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }
  const guardar = document.getElementById('co-guardar');
  if (guardar) {
    guardar.addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/vxf/ordenes/${o.id}/cobro`, {
          recibido: document.getElementById('co-recibido').value,
          forma: document.getElementById('co-forma').value,
          nota: document.getElementById('co-nota').value,
        });
        mostrarMensaje(r.mensaje, 'exito');
        vistaVxfOrden(o.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }
  const confirmar = document.getElementById('co-confirmar');
  if (confirmar) {
    confirmar.addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/vxf/ordenes/${o.id}/cobro-confirmar`, {});
        mostrarMensaje(r.mensaje, 'exito');
        vistaVxfOrden(o.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }
  const regresar = document.getElementById('co-regresar');
  if (regresar) {
    regresar.addEventListener('click', async () => {
      const nota = prompt('¿Qué hay que corregir del cobro?');
      if (!nota) return;
      try {
        const r = await api('POST', `/api/vxf/ordenes/${o.id}/cobro-regresar`, { nota });
        mostrarMensaje(r.mensaje, 'exito');
        vistaVxfOrden(o.id);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }
  vista.querySelectorAll('[data-ver-archivo]').forEach((b) => b.addEventListener('click', () => {
    abrirArchivoProtegido(b.dataset.verArchivo);
  }));
}

async function vistaVxfOrden(id) {
  const [{ orden: o, faltantes }, cat] = await Promise.all([api('GET', `/api/vxf/ordenes/${id}`), catalogoVxf()]);
  estado.orden_vxf = o;
  encabezado(`Orden ${o.folio}`, `${o.cliente} · ${o.etiqueta_entrega} · pidió ${o.solicitante}`);

  const enCaptura = o.estado === 'borrador' && permiso('ventas_fuera_capturar');
  const armando = o.estado === 'por_armar' && permiso('ventas_fuera_armar');
  const documentando = o.estado === 'armada' && permiso('ventas_fuera_capturar');
  const encargado = permiso('ventas_fuera_autorizar');
  const nombreDoc = o.entrega === 'guia' ? 'la guía de paquetería' : 'la nota de remisión';

  const botones = [];
  if (enCaptura) botones.push('<button class="btn primario grande" data-vaccion="enviar">Mandar a armar</button>');
  if (armando) botones.push('<button class="btn primario grande" data-vaccion="armada">Dar por armada</button>');
  if (documentando) botones.push(`<button class="btn primario grande" data-vaccion="documentada">Mandar al encargado</button>`);
  if (o.estado === 'documentada' && encargado) botones.push('<button class="btn primario grande" data-vaccion="terminar">Cerrar como terminada</button>');
  // Se arma hoy y puede irse mañana: con la fecha puesta, la orden aparece sola
  // entre lo que se puede subir a la ruta de ese día.
  if (['armada', 'documentada'].includes(o.estado) && (armando || documentando || encargado)) {
    botones.push(`<label class="campo" style="margin:0">
      <span style="font-size:13px; color:var(--tinta-suave)">Sale del almacén</span>
      <input type="date" id="vxf-fecha-salida" value="${esc(o.fecha_salida || '')}">
    </label>`);
  }
  if (['por_armar', 'armada', 'documentada'].includes(o.estado) && encargado) botones.push('<button class="btn" data-vaccion="regresar">Regresar un paso</button>');
  // Una orden ya terminada se reabre con motivo: vuelve al paso anterior para
  // corregirla y volver a cerrarla.
  if (o.estado === 'terminada' && permiso('reabrir_cerrados')) {
    botones.push('<button class="btn" data-vaccion="reabrir">Reabrir para corregir</button>');
  }
  if (!['terminada', 'cancelada'].includes(o.estado) && (encargado || enCaptura)) {
    botones.push('<button class="btn peligro" data-vaccion="cancelar">Cancelar la orden</button>');
  }

  const opcionesCaja = (sel) => cat.cajas.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  const difs = o.diferencias.filter((f) => f.diferencia);

  vista.innerHTML = `
    ${migajaVxf(o.folio)}
    <div id="mensajes"></div>
    ${o.correccion_nota ? `<div class="aviso error"><span><b>La regresaron.</b>
      <small>${esc(o.pidio_correccion || 'El encargado')}: «${esc(o.correccion_nota)}»</small></span></div>` : ''}
    <section class="panel">
      <h2>Orden ${esc(o.folio)} ${insigniaVxf(o.estado)}</h2>
      <div style="padding:0 18px 18px">
        ${caminoVxf(o)}
        ${enCaptura ? `
          <div class="rejilla-campos">
            <div class="campo"><label for="c-cliente">Cliente</label>${campoCliente('c-cliente', o.cliente, cat.clientes)}</div>
            <div class="campo"><label for="c-fecha">Fecha de la solicitud</label><input type="date" id="c-fecha" value="${esc(o.fecha_solicitud)}"></div>
            <div class="campo"><label for="c-entrega">¿Cómo se entrega?</label>
              <select id="c-entrega">${cat.entregas.map((e) => `<option value="${e.clave}" ${e.clave === o.entrega ? 'selected' : ''}>${esc(e.etiqueta)}</option>`).join('')}</select></div>
            <div class="campo"><label for="c-cobro">¿Cómo se cobra?</label>
              <select id="c-cobro">${(cat.cobros || []).map((c) => `
                <option value="${c.clave}" ${c.clave === o.cobro ? 'selected' : ''}>${esc(c.etiqueta)}</option>`).join('')}</select></div>
            <div class="campo" id="campo-monto" ${o.cobro === 'por_cobrar' ? '' : 'hidden'}>
              <label for="c-monto">¿Cuánto se le cobra al cliente?</label>
              <input id="c-monto" inputmode="decimal" value="${o.monto_cobrar ?? ''}" placeholder="Ej. 1850.00">
              <small class="nota-campo">Es lo que quien entregue tiene que traer de regreso.</small>
            </div>
          </div>
          <button class="btn" id="guardar-cabecera-vxf">Guardar cambios</button>`
          : `<p style="margin:0">Pidió <b>${esc(o.solicitante)}</b> el ${fechaCorta(o.fecha_solicitud)} · entrega a <b>${esc(o.cliente)}</b> · ${esc(o.etiqueta_entrega)}</p>`}
      </div>
    </section>

    <section class="panel">
      <h2>Lo que se vendió <span class="etiqueta azul">${o.renglones.length}</span></h2>
      ${o.renglones.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Producto</th><th>Modelo</th><th>Cantidad</th>${enCaptura ? '<th></th>' : ''}</tr></thead>
          <tbody>${o.renglones.map((r) => `
            <tr>
              <td class="fila-titulo">${fotoProducto({ id: r.producto_id, sku: r.sku })}${esc(r.producto)}<br><small style="color:var(--tinta-suave)">${esc(r.sku)}</small></td>
              <td>${esc(r.modelo || '—')}</td>
              <td>${enCaptura ? `<input type="number" min="0" step="1" value="${r.cantidad}" data-vxf-cantidad="${r.id}">` : `<b>${numero(r.cantidad)}</b> <small>${esc(r.unidad)}</small>`}</td>
              ${enCaptura ? `<td><button class="btn peligro" data-vxf-quitar="${r.id}">×</button></td>` : ''}
            </tr>`).join('')}
          </tbody></table></div>` : '<div class="vacio">Todavía no hay productos.</div>'}
      ${enCaptura ? `
        <div class="agregar-renglon">
          <input type="search" id="vxf-producto" list="vxf-productos" placeholder="Producto vendido…">
          <datalist id="vxf-productos">${cat.productos.map((x) => `<option value="${esc(x.nombre)}">${esc(x.sku)}</option>`).join('')}</datalist>
          <input type="number" id="vxf-cantidad" min="1" step="1" placeholder="Cantidad">
          <button class="btn primario" id="vxf-agregar">Agregar</button>
        </div>` : ''}
    </section>

    ${armando || o.cajas.length ? `
      <section class="panel">
        <h2>Cajas que se usaron ${o.cajas.length ? `<span class="etiqueta azul">${o.cajas.length} · ${o.peso_total} kg</span>` : ''}</h2>
        ${armando ? `
          <p class="explica">Una línea por caja: qué modelo de caja y cuánto pesa ya armada.</p>
          <div id="cajas-vxf" style="padding:0 18px">
            ${(o.cajas.length ? o.cajas : [{ producto_id: null, peso_kg: '' }]).map((c, i) => `
              <div class="fila-caja" data-fila-caja>
                <b style="min-width:64px">Caja ${i + 1}</b>
                <select data-caja-modelo><option value="">Modelo de caja…</option>${opcionesCaja(c.producto_id)}</select>
                <input type="number" min="0" step="0.01" data-caja-peso value="${c.peso_kg ?? ''}" placeholder="Peso">
                <span>kg</span>
                <button class="btn peligro" data-quitar-fila-caja title="Quitar">×</button>
              </div>`).join('')}
          </div>
          <div class="fila-botones" style="padding:6px 18px 18px">
            <button class="btn" id="otra-caja-vxf">+ Otra caja</button>
            <button class="btn primario" id="guardar-cajas-vxf">Guardar las cajas</button>
          </div>`
          : `<div class="desliza"><table class="captura">
              <thead><tr><th class="fila-titulo">Caja</th><th>Modelo</th><th>Peso</th></tr></thead>
              <tbody>${o.cajas.map((c, i) => `<tr><td class="fila-titulo">Caja ${i + 1}</td><td>${esc(c.modelo_caja || '—')}</td><td><b>${c.peso_kg ?? '—'}</b> kg</td></tr>`).join('')}</tbody>
            </table></div>`}
      </section>` : ''}

    ${o.cobro === 'por_cobrar' && ['documentada', 'terminada'].includes(o.estado) ? panelCobro(o, cat) : ''}

    ${['armada', 'documentada', 'terminada'].includes(o.estado) ? `
      <section class="panel">
        <h2>${o.entrega === 'guia' ? 'Guía de paquetería' : 'Nota de remisión'}
          ${o.documentos.length ? `<span class="etiqueta verde">${o.documentos.length}</span>` : '<span class="etiqueta roja">falta</span>'}</h2>
        <div class="evidencia ${o.documentos.length ? '' : 'falta'}" style="padding:0 18px 18px">
          <div class="miniaturas">
            ${o.documentos.map((f) => (/\.pdf$/i.test(f.archivo)
              ? `<figure class="mini"><button class="btn" data-abrir-pdf="${esc(f.archivo)}">📄 PDF</button>
                   ${documentando ? `<button class="quitar" data-quitar-doc="${f.id}" title="Quitar">×</button>` : ''}</figure>`
              : `<figure class="mini"><img data-archivo="${esc(f.archivo)}" alt="Documento">
                   ${documentando ? `<button class="quitar" data-quitar-doc="${f.id}" title="Quitar">×</button>` : ''}</figure>`)).join('')}
          </div>
          ${documentando ? `<button class="btn-camara" type="button" id="subir-doc-vxf"><span aria-hidden="true">📎</span> Cargar ${nombreDoc}</button>` : ''}
        </div>
      </section>` : ''}

    ${o.salidas.length || ['armada', 'documentada', 'terminada'].includes(o.estado) ? `
      <section class="panel">
        <h2>Lo que salió de Almacén
          ${o.salidas.length ? '' : '<span class="etiqueta ambar">sin salida</span>'}
          ${difs.length ? `<span class="etiqueta roja">${difs.length} no coinciden</span>` : o.salidas.length ? '<span class="etiqueta verde">coincide</span>' : ''}</h2>
        <p class="explica">Cada salida de venta directa se amarra a su orden. Aquí se compara lo vendido contra lo que ya salió aprobado.</p>
        ${o.salidas.length ? `<p style="padding:0 18px">${o.salidas.map((x) => `${liga(`#/almacen/salida/${x.id}`, x.folio)} ${insigniaDocumento(x.estado)}`).join(' · ')}</p>` : ''}
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Producto</th><th>Se vendió</th><th>Salió</th><th>Diferencia</th></tr></thead>
          <tbody>${o.diferencias.map((f) => `
            <tr><td class="fila-titulo">${esc(f.producto || '—')}</td><td>${numero(f.pedido)}</td><td>${numero(f.salio)}</td>
              <td>${f.diferencia ? `<span class="delta mala">${f.diferencia > 0 ? '+' : ''}${numero(f.diferencia)}</span>` : '—'}</td></tr>`).join('')}
          </tbody></table></div>
      </section>` : ''}

    ${botones.length ? `
      <div class="acciones-almacen">
        ${faltantes.length ? `<div class="aviso">Falta:<br><small>${esc(faltantes.join(' '))}</small></div>` : ''}
        <div class="fila-botones">${botones.join('')}</div>
      </div>` : ''}
    ${historialCorrecciones(o.correcciones)}`;

  conectarVxf(o, cat);
  cargarImagenesPendientes();
}

let temporizadorVxf = null;

function conectarVxf(o, cat) {
  if (document.getElementById('c-cliente')) conectarCampoCliente(vista, 'c-cliente', cat.clientes);
  const selCobro = document.getElementById('c-cobro');
  if (selCobro) {
    selCobro.addEventListener('change', () => {
      document.getElementById('campo-monto').hidden = selCobro.value !== 'por_cobrar';
    });
  }
  conectarCobro(o);

  const guardarCab = document.getElementById('guardar-cabecera-vxf');
  if (guardarCab) {
    guardarCab.addEventListener('click', async () => {
      try {
        const cobro = document.getElementById('c-cobro');
        await api('PUT', `/api/vxf/ordenes/${o.id}`, {
          cliente: document.getElementById('c-cliente').value,
          fecha: document.getElementById('c-fecha').value,
          entrega: document.getElementById('c-entrega').value,
          ...(cobro ? { cobro: cobro.value, monto_cobrar: document.getElementById('c-monto').value } : {}),
        });
        mostrarMensaje('Datos guardados.', 'exito');
        setTimeout(() => enrutar(), 500);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }

  const agregar = document.getElementById('vxf-agregar');
  if (agregar) {
    const alta = async () => {
      const texto = document.getElementById('vxf-producto').value.trim().toLowerCase();
      const producto = cat.productos.find((x) => x.nombre.toLowerCase() === texto) || cat.productos.find((x) => x.sku.toLowerCase() === texto);
      if (!producto) return mostrarMensaje('Ese producto no está en el catálogo. Escoge uno de la lista.', 'error');
      try {
        await api('POST', `/api/vxf/ordenes/${o.id}/renglones`, { producto_id: producto.id, cantidad: document.getElementById('vxf-cantidad').value });
        enrutar();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    };
    agregar.addEventListener('click', alta);
    document.getElementById('vxf-cantidad').addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
  }
  vista.querySelectorAll('[data-vxf-cantidad]').forEach((c) => {
    c.addEventListener('input', () => {
      clearTimeout(temporizadorVxf);
      temporizadorVxf = setTimeout(async () => {
        try { await api('PUT', `/api/vxf/renglones/${c.dataset.vxfCantidad}`, { cantidad: c.value }); }
        catch (err) { mostrarMensaje(err.message, 'error'); }
      }, 500);
    });
  });
  vista.querySelectorAll('[data-vxf-quitar]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('DELETE', `/api/vxf/renglones/${b.dataset.vxfQuitar}`); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });

  // Cajas: se editan todas juntas y se guardan con un botón.
  const zonaCajas = document.getElementById('cajas-vxf');
  if (zonaCajas) {
    const renumerar = () => zonaCajas.querySelectorAll('[data-fila-caja] b').forEach((b, i) => { b.textContent = `Caja ${i + 1}`; });
    const conectarFila = (fila) => fila.querySelector('[data-quitar-fila-caja]').addEventListener('click', () => { fila.remove(); renumerar(); });
    zonaCajas.querySelectorAll('[data-fila-caja]').forEach(conectarFila);
    document.getElementById('otra-caja-vxf').addEventListener('click', () => {
      const ultima = zonaCajas.querySelector('[data-fila-caja]:last-child');
      const nueva = document.createElement('div');
      nueva.className = 'fila-caja';
      nueva.setAttribute('data-fila-caja', '');
      nueva.innerHTML = `<b style="min-width:64px"></b>
        <select data-caja-modelo><option value="">Modelo de caja…</option>
          ${cat.cajas.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select>
        <input type="number" min="0" step="0.01" data-caja-peso placeholder="Peso"><span>kg</span>
        <button class="btn peligro" data-quitar-fila-caja title="Quitar">×</button>`;
      // La caja nueva suele ser del mismo modelo que la anterior.
      if (ultima) nueva.querySelector('[data-caja-modelo]').value = ultima.querySelector('[data-caja-modelo]').value;
      zonaCajas.appendChild(nueva);
      conectarFila(nueva);
      renumerar();
    });
    document.getElementById('guardar-cajas-vxf').addEventListener('click', async () => {
      const cajas = [...zonaCajas.querySelectorAll('[data-fila-caja]')].map((f) => ({
        producto_id: Number(f.querySelector('[data-caja-modelo]').value) || null,
        peso_kg: f.querySelector('[data-caja-peso]').value,
      }));
      try {
        await api('PUT', `/api/vxf/ordenes/${o.id}/cajas`, { cajas });
        mostrarMensaje('Cajas guardadas.', 'exito');
        setTimeout(() => enrutar(), 500);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }

  // La guía o la nota: foto o PDF.
  const subir = document.getElementById('subir-doc-vxf');
  if (subir) {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = 'image/*,application/pdf';
    entrada.multiple = true;
    entrada.hidden = true;
    vista.appendChild(entrada);
    subir.addEventListener('click', () => entrada.click());
    entrada.addEventListener('change', async () => {
      const archivos = [...entrada.files];
      subir.disabled = true;
      subir.textContent = 'Subiendo…';
      for (const archivo of archivos) {
        try {
          const contenido = archivo.type === 'application/pdf' ? await leerComoDataURL(archivo) : await comprimirImagen(archivo, 2200, 0.88);
          await api('POST', `/api/almacen/vxf/${o.id}/fotos`, { imagen: contenido });
        } catch (err) { mostrarMensaje(`No se pudo subir «${archivo.name}»: ${err.message}`, 'error'); }
      }
      enrutar();
    });
  }
  vista.querySelectorAll('[data-abrir-pdf]').forEach((b) => b.addEventListener('click', () => abrirPDF(b.dataset.abrirPdf)));
  vista.querySelectorAll('[data-quitar-doc]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('DELETE', `/api/almacen/fotos/${b.dataset.quitarDoc}`); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });

  const campoSalida = document.getElementById('vxf-fecha-salida');
  if (campoSalida) {
    campoSalida.addEventListener('change', async () => {
      try {
        const r = await api('PUT', `/api/vxf/ordenes/${o.id}/fecha-salida`, { fecha: campoSalida.value });
        mostrarMensaje(r.mensaje, 'exito');
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }

  vista.querySelectorAll('[data-vaccion]').forEach((b) => {
    b.addEventListener('click', async () => {
      const accion = b.dataset.vaccion;
      let cuerpo;
      if (accion === 'cancelar') {
        const motivo = prompt('¿Por qué se cancela la orden? Queda registrado.');
        if (!motivo || !motivo.trim()) return;
        cuerpo = { motivo: motivo.trim() };
      }
      if (accion === 'regresar' || accion === 'reabrir') {
        const nota = prompt(accion === 'reabrir'
          ? '¿Por qué la reabres? Queda registrado y la orden vuelve al paso anterior.'
          : '¿Qué hay que corregir? Regresa un paso y lo lee quien lo tenía.');
        if (!nota || !nota.trim()) return;
        cuerpo = { nota: nota.trim() };
      }
      b.disabled = true;
      try {
        const r = await api('POST', `/api/vxf/ordenes/${o.id}/${accion}`, cuerpo);
        if (accion === 'cancelar') { location.hash = '#/ventas-fuera'; return; }
        mostrarMensaje(r.mensaje || 'Listo.', 'exito');
        setTimeout(() => enrutar(), 800);
      } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; }
    });
  });
}

// ============================================================== producción
//
// La ODT de la semana: lo que producción va a armar. Vive aquí y no en Almacén
// porque es una decisión de producción; Almacén solo surte contra ella y mueve
// los traspasos que de ella salen.

function migajaProduccion(seccion) {
  return `<div class="migaja">
    <button data-ir-hash="#/menu">← Menú</button><span>/</span>
    ${seccion ? '<button data-ir-hash="#/produccion">Producción</button>' : '<span>Producción</span>'}
    ${seccion ? `<span>/</span><span>${esc(seccion)}</span>` : ''}
  </div>`;
}

async function vistaProduccion() {
  encabezado('Producción', 'La ODT de la semana y si el material alcanza');
  const { ordenes, bodega_armado: armado, semana } = await api('GET', '/api/produccion/odt');
  const deEstaSemana = ordenes.find((o) => o.semana === semana);

  vista.innerHTML = `
    ${migajaProduccion()}
    <div id="mensajes"></div>

    <div class="rejilla-tareas">
      <button class="tarea" data-ir-hash="#/produccion/odt">
        <b>ODT de la semana${deEstaSemana
          ? (deEstaSemana.publicada_en ? ` <span class="etiqueta azul">${deEstaSemana.avance}%</span>` : ' <span class="etiqueta ambar">en preparación</span>')
          : ' <span class="etiqueta ambar">sin cargar</span>'}</b>
        <span class="meta">Lo que se va a armar, cuánto va en cada envío, el avance y si alcanza el material en ${esc(armado.nombre)}.</span>
      </button>
    </div>

    <section class="panel">
      <h2>Órdenes cargadas <span class="etiqueta azul">${ordenes.length}</span></h2>
      <p class="explica">El material se arma en ${esc(armado.nombre)} (${esc(armado.clave)}), que es la bodega marcada para eso en el catálogo.</p>
      ${ordenes.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Semana</th><th>Partidas</th><th>Situación</th><th>Avance</th><th></th></tr></thead>
          <tbody>${ordenes.map((o) => `
            <tr>
              <td class="fila-titulo">${esc(describirSemanaCorta(o.semana))}</td>
              <td>${o.renglones}</td>
              <td>${o.estado !== 'abierta' ? '<span class="etiqueta verde">Cerrada</span>'
                : o.publicada_en ? '<span class="etiqueta azul">Publicada</span>' : '<span class="etiqueta ambar">En preparación</span>'}</td>
              <td>${o.publicada_en ? `${barraAvance(o.avance)} <small>${numero(o.armado)} de ${numero(o.total)}</small>` : '—'}</td>
              <td><button class="btn" data-ir-hash="#/produccion/odt/${o.id}">Abrir</button></td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">Todavía no se ha cargado ninguna ODT.</div>'}
    </section>`;
}

// La semana en el formato corto que ya usa el resto de la plataforma.
const describirSemanaCorta = (s) => (typeof s === 'string' ? s.replace('-W', ' · semana ') : s);

// --- cargar la ODT desde su archivo de Excel ---
//
// La semana no se pregunta: sale del periodo que trae el archivo. Escribirla
// aparte solo daba lugar a cargar la ODT del 27 de agosto sobre otra semana.

function cajaCargarODT(odt) {
  return `
    <div class="cargar-odt">
      <input type="file" id="archivo-odt" accept=".xlsx,.xlsm"
             style="position:absolute;width:1px;height:1px;opacity:0">
      <button class="btn primario grande" id="elegir-odt">
        ${odt ? 'Cargar otro archivo' : 'Cargar la ODT desde Excel'}
      </button>
      <span class="resumen">
        ${odt
          ? 'Vuelve a leer el archivo y reemplaza los renglones de esta semana.'
          : 'Escoge el archivo de la ODT tal como te llega. La semana, las citas y las cantidades salen de ahí.'}
      </span>
      <div id="avance-odt"></div>
    </div>`;
}

function engancharCargaODT() {
  const entrada = document.getElementById('archivo-odt');
  const boton = document.getElementById('elegir-odt');
  const avance = document.getElementById('avance-odt');
  if (!entrada || !boton) return;

  boton.addEventListener('click', () => entrada.click());

  entrada.addEventListener('change', async () => {
    const archivo = entrada.files && entrada.files[0];
    if (!archivo) return;
    if (!/\.(xlsx|xlsm)$/i.test(archivo.name)) {
      return mostrarMensaje('El archivo tiene que ser .xlsx o .xlsm, el que te llega de la ODT.', 'error');
    }

    boton.disabled = true;
    avance.innerHTML = `<div class="vacio">Leyendo ${esc(archivo.name)}…</div>`;

    try {
      const base64 = await new Promise((listo, falla) => {
        const lector = new FileReader();
        lector.onload = () => listo(String(lector.result).split(',')[1]);
        lector.onerror = () => falla(new Error('No se pudo leer el archivo.'));
        lector.readAsDataURL(archivo);
      });

      await enviarODT(base64, archivo.name, false);
    } catch (err) {
      avance.innerHTML = '';
      mostrarMensaje(err.message, 'error');
      boton.disabled = false;
    }
    entrada.value = '';
  });
}

// Se separa del manejador para poder repetir el envío con `reemplazar` cuando ya
// existe la ODT de esa semana, sin volver a leer el archivo del disco.
async function enviarODT(base64, nombre, reemplazar) {
  const avance = document.getElementById('avance-odt');
  const boton = document.getElementById('elegir-odt');
  try {
    const r = await api('POST', '/api/produccion/odt/importar',
      { archivo: base64, nombre, reemplazar });
    avance.innerHTML = resumenDeCarga(r.resumen, r.reemplazada);
    mostrarMensaje(
      `${r.reemplazada ? 'ODT reemplazada' : 'ODT cargada'}: ${r.resumen.publicaciones} publicación(es) y ${r.resumen.citas} cita(s).`,
      'exito');
    setTimeout(() => { location.hash = `#/produccion/odt/${r.odt.id}`; enrutar(); }, 2500);
  } catch (err) {
    // Si ya había ODT de esa semana, se ofrece reemplazarla en vez de dejar a
    // alguien con el archivo en la mano y sin saber qué hacer.
    if (err.datos && err.datos.puede_reemplazar) {
      avance.innerHTML = `
        <div class="aviso">
          <span><b>${esc(err.message)}</b>
            <small>Puedes reemplazar sus renglones y citas por los de este archivo.</small></span>
        </div>
        <div class="fila-botones" style="margin-top:10px">
          <button class="btn peligro" id="reemplazar-odt">Sí, reemplazarla</button>
          <button class="btn" id="cancelar-odt">Cancelar</button>
        </div>`;
      document.getElementById('reemplazar-odt').addEventListener('click', () => {
        avance.innerHTML = '<div class="vacio">Reemplazando…</div>';
        enviarODT(base64, nombre, true);
      });
      document.getElementById('cancelar-odt').addEventListener('click', () => {
        avance.innerHTML = '';
        if (boton) boton.disabled = false;
      });
      return;
    }
    throw err;
  }
}

// Lo que se leyó, antes de irse a la ODT. Dos listas de problemas distintas: lo
// que el archivo trae mal cuadrado y lo que el catálogo no supo traducir.
function resumenDeCarga(r, reemplazada) {
  return `
    <div class="aviso exito" style="cursor:default">
      <span><b>${reemplazada ? 'Reemplazada' : 'Cargada'}: ${esc(r.periodo)}</b>
        <small>${esc(describirSemanaCorta(r.semana))} · hoja «${esc(r.hoja)}» ·
          ${r.publicaciones} publicación(es) · ${r.citas} cita(s)</small></span>
    </div>
    <div class="desliza"><table class="captura">
      <thead><tr><th class="fila-titulo">Cuenta</th><th>Publicaciones</th>
        <th>Rollos</th><th>Citas</th></tr></thead>
      <tbody>${r.cuentas.map((c) => `
        <tr>
          <td class="fila-titulo">${esc(c.cuenta)}</td>
          <td>${c.publicaciones}</td>
          <td><b>${numero(c.rollos)}</b></td>
          <td>${c.citas}</td>
        </tr>`).join('')}
      </tbody></table></div>
    ${r.problemas_archivo.length ? `
      <div class="aviso error" style="margin-top:10px">
        <span><b>El archivo trae ${r.problemas_archivo.length} renglón(es) que no cuadran.</b>
          <small>${esc(r.problemas_archivo.slice(0, 5).join(' '))}
          ${r.problemas_archivo.length > 5 ? `…y ${r.problemas_archivo.length - 5} más.` : ''}</small></span>
      </div>` : ''}
    ${r.problemas_catalogo.length ? `
      <div class="aviso" style="margin-top:10px">
        <span><b>${r.problemas_catalogo.length} código(s) que el catálogo no pudo traducir a material.</b>
          <small>${esc(r.problemas_catalogo.slice(0, 5).join(' '))}
          ${r.problemas_catalogo.length > 5 ? `…y ${r.problemas_catalogo.length - 5} más.` : ''}
          Esos renglones no entran en la evaluación hasta que se den de alta.</small></span>
      </div>` : ''}`;
}

// Una barra de avance con su porcentaje.
const barraAvance = (pct) => `
  <span class="barra-avance" title="${pct}%"><span style="width:${Math.min(100, pct)}%"></span></span>
  <b>${pct}%</b>`;

const SITUACION_ENVIO = {
  completo: ['verde', 'Listo'],
  atrasado: ['roja', 'Atrasado'],
  en_tiempo: ['azul', 'En tiempo'],
};
const insigniaSituacion = (sit) => {
  const [c, t] = SITUACION_ENVIO[sit] || ['', sit];
  return `<span class="etiqueta ${c}">${t}</span>`;
};
const nombreEnvio = (e) => `${e.etiqueta || e.fecha || 'Sin fecha'} · ${e.cedis}${e.folio ? ` · ${e.folio}` : ''}`;

// La ODT tiene varias maneras de mirarse, una por pestaña: el avance para quien
// lo sigue, las partidas para quien arma, el reparto para quien la prepara, las
// modificaciones pedidas y el material. La pestaña va en la dirección para que
// al anotar algo y repintar no se regrese a la primera.
async function vistaProduccionODT(id, parte) {
  const datos = id
    ? await api('GET', `/api/produccion/odt/${id}`)
    : await api('GET', '/api/produccion/odt?semana=' + encodeURIComponent(
        (await api('GET', '/api/produccion/odt')).semana));

  const { odt } = datos;
  encabezado('ODT de la semana', odt ? describirSemanaCorta(odt.semana) : 'Sin cargar');

  if (!odt) {
    const semana = datos.semana;
    vista.innerHTML = `
      ${migajaProduccion('ODT de la semana')}
      <div id="mensajes"></div>
      <section class="panel">
        <h2>${datos.sin_publicar ? 'La ODT de esta semana todavía no se publica' : `Sin ODT para ${esc(describirSemanaCorta(semana))}`}</h2>
        <div class="vacio">
          ${datos.sin_publicar
            ? 'Quien la carga la está repartiendo por envío. En cuanto la publique, aquí aparece completa.'
            : `Todavía no se carga la orden de trabajo de esta semana.${permiso('produccion_odt_cargar') ? '' : ' Pídesela a quien la carga.'}`}
        </div>
        ${permiso('produccion_odt_cargar') ? cajaCargarODT() : ''}
      </section>`;
    if (permiso('produccion_odt_cargar')) engancharCargaODT();
    return;
  }

  const t = datos.tablero;
  const publicada = !!odt.publicada_en;
  const preparando = !publicada && datos.puede_publicar;
  const pendientesMod = datos.modificaciones.filter((m) => m.estado === 'por_aprobar').length;
  const pestanas = [
    permiso('produccion_avance') && publicada ? ['avance', 'Avance'] : null,
    ['partidas', 'Partidas por envío'],
    preparando ? ['reparto', `Reparto${t.sin_repartir ? ` (${t.sin_repartir} por cuadrar)` : ''}`] : null,
    publicada ? ['modificaciones', `Modificaciones${pendientesMod ? ` (${pendientesMod})` : ''}`] : null,
    ['material', 'Material'],
  ].filter(Boolean);
  const actual = (pestanas.find(([k]) => k === parte) || pestanas.find(([k]) => k === (preparando ? 'reparto' : 'x')) || pestanas[0])[0];
  estado.odt_produccion = { odt, t, datos };

  vista.innerHTML = `
    ${migajaProduccion('ODT de la semana')}
    <div id="mensajes"></div>
    ${publicada
      ? `<div class="aviso exito" style="cursor:default"><span><b>Publicada.</b>
          <small>Nadie la cambia: si a una partida no le alcanza, se pide una modificación y otra persona la aprueba.</small></span></div>`
      : `<div class="aviso"><span><b>En preparación: solo la ve quien la carga.</b>
          <small>Reparte cada partida entre sus envíos y publícala. Hasta entonces producción no la ve.
          ${t.sin_repartir ? `Faltan ${t.sin_repartir} partida(s) por cuadrar.` : 'Ya cuadra: se puede publicar.'}</small></span></div>`}
    <div class="cifras-almacen">
      <div class="cifra"><b>${numero(t.semana.total)}</b><span>piezas a armar en la semana</span></div>
      <div class="cifra"><b>${t.semana.pct}%</b><span>${numero(t.semana.armado)} armadas</span></div>
      <div class="cifra"><b>${t.envios.length}</b><span>envíos</span></div>
      <div class="cifra ${t.envios.some((e) => e.situacion === 'atrasado' && e.total) ? 'alerta' : ''}">
        <b>${t.envios.filter((e) => e.situacion === 'atrasado' && e.total).length}</b><span>envíos atrasados</span></div>
    </div>
    <div class="pestanas" role="tablist">
      ${pestanas.map(([k, texto]) => `<button role="tab" aria-selected="${k === actual}" data-ir-hash="#/produccion/odt/${odt.id}/${k}">${esc(texto)}</button>`).join('')}
    </div>
    <div id="parte-odt"></div>`;

  const destino = document.getElementById('parte-odt');
  if (actual === 'avance') pintarAvanceODT(destino, t);
  if (actual === 'partidas') await pintarPartidasODT(destino, odt, t, publicada);
  if (actual === 'reparto') pintarRepartoODT(destino, odt, t);
  if (actual === 'modificaciones') pintarModificacionesODT(destino, datos.modificaciones, t);
  if (actual === 'material') pintarMaterialODT(destino, datos, preparando);
}

// --- avance: la semana, cada día, cada envío y cada persona ---
function pintarAvanceODT(destino, t) {
  destino.innerHTML = `
    <section class="panel">
      <h2>La semana</h2>
      <div style="padding:0 18px 18px">${barraAvance(t.semana.pct)} · ${numero(t.semana.armado)} de ${numero(t.semana.total)} piezas armadas</div>
    </section>
    <section class="panel">
      <h2>Por día <span class="etiqueta azul">${t.dias.length}</span></h2>
      <p class="explica">Lo que tiene que estar listo cada día: lo de los envíos que tienen cita ese día.</p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Día</th><th>Envíos</th><th>Debe estar listo</th><th>Armado</th><th>Avance</th><th>Situación</th></tr></thead>
        <tbody>${t.dias.map((d) => `
          <tr><td class="fila-titulo">${esc(d.fecha === 'sin fecha' ? 'Sin fecha' : fechaCorta(d.fecha))}</td><td>${d.envios}</td>
            <td>${numero(d.total)}</td><td>${numero(d.armado)}</td><td>${barraAvance(d.pct)}</td><td>${insigniaSituacion(d.situacion)}</td></tr>`).join('')}
        </tbody></table></div>
    </section>
    <section class="panel">
      <h2>Por envío <span class="etiqueta azul">${t.envios.length}</span></h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Envío</th><th>Fecha</th><th>Cuenta</th><th>Piezas</th><th>Armado</th><th>Avance</th><th>Situación</th><th>Tránsito</th></tr></thead>
        <tbody>${t.envios.map((e) => `
          <tr><td class="fila-titulo">${esc(e.etiqueta || '—')}<br><small>${esc(e.cedis)}${e.folio ? ` · ${esc(e.folio)}` : ''}</small></td>
            <td>${esc(e.fecha ? fechaCorta(e.fecha) : '—')}</td><td><small>${esc(e.cuenta || '—')}</small></td>
            <td>${numero(e.total)}</td><td>${numero(e.armado)}</td><td>${barraAvance(e.pct)}</td><td>${insigniaSituacion(e.situacion)}</td>
            <td>${e.transito ? liga(`#/envio/${e.transito.id}`, textoTransito(e.transito)) : '<small>sin abrir</small>'}</td></tr>`).join('')}
        </tbody></table></div>
    </section>
    <section class="panel">
      <h2>Por persona <span class="etiqueta azul">${t.personas.length}</span></h2>
      ${t.personas.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Persona</th><th>Armado</th><th>Del total</th><th>Registros</th><th>Primero</th><th>Último</th></tr></thead>
          <tbody>${t.personas.map((x) => `
            <tr><td class="fila-titulo">${esc(x.nombre)}</td><td><b>${numero(x.armado)}</b></td>
              <td>${t.semana.total ? Math.round((x.armado / t.semana.total) * 100) : 0}%</td><td>${x.registros}</td>
              <td><small>${esc(horaCorta(x.primero))}</small></td><td><small>${esc(horaCorta(x.ultimo))}</small></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="vacio">Nadie ha anotado nada todavía.</div>'}
    </section>`;
}

// --- partidas: la ODT completa, envío por envío ---
async function pintarPartidasODT(destino, odt, t, publicada) {
  const puedeArmar = publicada && odt.estado === 'abierta' && permiso('produccion_armar');
  const puedePedir = publicada && odt.estado === 'abierta' && permiso('produccion_modificacion_pedir');
  const avances = publicada ? (await api('GET', `/api/produccion/odt/${odt.id}/avances`)).avances : [];
  const hoy = new Date().toLocaleDateString('es-MX');
  const mios = avances.filter((a) => a.usuario_id === estado.usuario.id && new Date(a.en).toLocaleDateString('es-MX') === hoy);

  destino.innerHTML = `
    <div class="filtros-almacen">
      <input type="search" id="buscar-partida" placeholder="Buscar código o publicación…">
      <select id="filtro-partida">
        <option value="">Todas</option>
        <option value="pendiente">Solo lo que falta</option>
        <option value="listo">Solo lo terminado</option>
      </select>
    </div>
    ${t.envios.map((e) => {
      const filas = t.renglones.map((r) => ({ r, x: r.envios.find((y) => y.cita_id === e.id) })).filter(({ x }) => x && x.cantidad);
      if (!filas.length) return '';
      return `
        <section class="panel" data-envio="${e.id}">
          <h2>${esc(nombreEnvio(e))} ${insigniaSituacion(e.situacion)}
            <span class="etiqueta azul">${e.pct}%</span></h2>
          <p class="explica">${e.fecha ? `Cita el ${fechaCorta(e.fecha)}` : 'Sin fecha'} · ${esc(e.cuenta || '')} ·
            ${numero(e.armado)} de ${numero(e.total)} piezas armadas.</p>
          <div class="desliza"><table class="captura">
            <thead><tr><th class="fila-titulo">Código</th><th>Publicación</th><th>Piezas</th><th>Armadas</th><th>Faltan</th>
              ${puedeArmar || puedePedir ? '<th></th>' : ''}</tr></thead>
            <tbody>${filas.map(({ r, x }) => `
              <tr data-partida data-busca="${esc(`${r.codigo} ${r.publicacion || ''} ${r.modelo || ''}`.toLowerCase())}"
                  data-falta="${x.cantidad - x.armado}">
                <td class="fila-titulo">${fotoProducto({ modelo: r.modelo })}${esc(r.codigo)}${r.modificacion_pendiente ? ' <span class="etiqueta ambar">cambio pedido</span>' : ''}</td>
                <td style="text-align:left"><small>${esc(r.publicacion || r.producto || '—')}</small></td>
                <td>${numero(x.cantidad)}</td>
                <td>${numero(x.armado)}</td>
                <td>${x.cantidad - x.armado ? `<b>${numero(x.cantidad - x.armado)}</b>` : '<span class="etiqueta verde">Listo</span>'}</td>
                ${puedeArmar || puedePedir ? `<td class="acciones-partida">
                  ${puedeArmar && x.cantidad > x.armado ? `<button class="btn primario" data-anotar="${r.id}|${e.id}">Anoté armado</button>` : ''}
                  ${puedePedir && !r.modificacion_pendiente ? `<button class="btn" data-pedir-cambio="${r.id}">Pedir cambio</button>` : ''}
                </td>` : ''}
              </tr>`).join('')}
            </tbody></table></div>
        </section>`;
    }).join('')}
    ${t.renglones.some((r) => !r.envios.some((x) => x.cantidad)) ? `
      <section class="panel"><h2>Sin repartir</h2>
        <div class="vacio">${t.renglones.filter((r) => !r.envios.some((x) => x.cantidad)).map((r) => esc(r.codigo)).join(', ')}</div>
      </section>` : ''}
    ${publicada ? `
      <section class="panel">
        <h2>Lo que anotaste hoy <span class="etiqueta azul">${mios.length}</span></h2>
        ${mios.length ? `
          <div class="desliza"><table class="captura">
            <thead><tr><th class="fila-titulo">Hora</th><th>Código</th><th>Envío</th><th>Cantidad</th><th></th></tr></thead>
            <tbody>${mios.map((a) => `
              <tr><td class="fila-titulo">${esc(horaCorta(a.en))}</td><td>${esc(a.codigo)}</td><td><small>${esc(a.envio || '')}</small></td>
                <td><b>${numero(a.cantidad)}</b></td><td><button class="btn peligro" data-quitar-avance="${a.id}" title="Me equivoqué">×</button></td></tr>`).join('')}
            </tbody></table></div>` : '<div class="vacio">Nada todavía. Lo que anotes por error se puede quitar el mismo día.</div>'}
      </section>` : ''}`;

  const filas = [...destino.querySelectorAll('[data-partida]')];
  const buscar = destino.querySelector('#buscar-partida');
  const filtro = destino.querySelector('#filtro-partida');
  const filtrar = () => {
    const texto = buscar.value.trim().toLowerCase();
    for (const f of filas) {
      const falta = Number(f.dataset.falta);
      f.hidden = !((!texto || f.dataset.busca.includes(texto))
        && (!filtro.value || (filtro.value === 'pendiente' ? falta > 0 : falta === 0)));
    }
  };
  [buscar, filtro].forEach((c) => c.addEventListener('input', filtrar));

  destino.querySelectorAll('[data-anotar]').forEach((b) => {
    b.addEventListener('click', () => {
      const [renglonId, citaId] = b.dataset.anotar.split('|').map(Number);
      abrirAnotarArmado(odt, t, renglonId, citaId);
    });
  });
  destino.querySelectorAll('[data-pedir-cambio]').forEach((b) => {
    b.addEventListener('click', () => abrirPedirCambio(odt, t, Number(b.dataset.pedirCambio)));
  });
  destino.querySelectorAll('[data-quitar-avance]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('¿Quitar este registro?')) return;
      try { await api('DELETE', `/api/produccion/avances/${b.dataset.quitarAvance}`); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
}

function abrirAnotarArmado(odt, t, renglonId, citaId) {
  const r = t.renglones.find((x) => x.id === renglonId);
  const x = r.envios.find((y) => y.cita_id === citaId);
  const e = t.envios.find((y) => y.id === citaId);
  const falta = x.cantidad - x.armado;
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Anotar lo armado">
      <h2>${esc(r.codigo)}</h2>
      <div class="cuerpo-modal">
        <div id="error-anotar"></div>
        <p class="explica" style="padding:0"><small>${esc(r.publicacion || '')}</small><br>
          Envío <b>${esc(nombreEnvio(e))}</b>: faltan <b>${numero(falta)}</b> de ${numero(x.cantidad)}.</p>
        <div class="campo"><label for="an-cantidad">¿Cuántas armaste?</label>
          <input type="number" id="an-cantidad" min="1" max="${falta}" step="1" value="${falta}"></div>
        <div class="campo"><label for="an-nota">Nota <small>(opcional)</small></label><input id="an-nota"></div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-guardar>Anotar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (ev) => { if (ev.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  const campo = capa.querySelector('#an-cantidad');
  campo.select();
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    try {
      const res = await api('POST', '/api/produccion/avances', {
        renglon_id: renglonId, cita_id: citaId, cantidad: Number(campo.value), nota: capa.querySelector('#an-nota').value,
      });
      cerrar();
      mostrarMensaje(res.mensaje || 'Anotado.', 'exito');
      enrutar();
    } catch (err) { capa.querySelector('#error-anotar').innerHTML = avisoError(err.message); }
  });
}

function abrirPedirCambio(odt, t, renglonId) {
  const r = t.renglones.find((x) => x.id === renglonId);
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Pedir una modificación">
      <h2>Pedir cambio a ${esc(r.codigo)}</h2>
      <div class="cuerpo-modal">
        <div id="error-cambio"></div>
        <p class="explica" style="padding:0">Escribe cuánto debe quedar en cada envío. No puede quedar menos de
          lo que ya se armó. La ODT cambia cuando otra persona lo apruebe.</p>
        <table class="captura">
          <thead><tr><th class="fila-titulo">Envío</th><th>Hoy</th><th>Ya armado</th><th>Debe quedar</th></tr></thead>
          <tbody>${r.envios.map((x) => {
            const e = t.envios.find((y) => y.id === x.cita_id);
            return `<tr><td class="fila-titulo"><small>${esc(nombreEnvio(e))}</small></td><td>${numero(x.cantidad)}</td>
              <td>${numero(x.armado)}</td><td><input type="number" min="${x.armado}" step="1" value="${x.cantidad}" data-cambio-cita="${x.cita_id}"></td></tr>`;
          }).join('')}</tbody>
        </table>
        <div class="campo" style="margin-top:12px"><label for="cb-motivo">¿Por qué?</label>
          <textarea id="cb-motivo" rows="3" placeholder="Ej. No alcanza el material: solo hay 40 rollos."></textarea></div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cancelar>Cancelar</button>
        <button class="btn primario" data-guardar>Mandar a aprobación</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (ev) => { if (ev.target === capa) cerrar(); });
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    try {
      const res = await api('POST', '/api/produccion/modificaciones', {
        renglon_id: renglonId,
        motivo: capa.querySelector('#cb-motivo').value,
        cambios: [...capa.querySelectorAll('[data-cambio-cita]')].map((c) => ({ cita_id: Number(c.dataset.cambioCita), despues: Number(c.value) })),
      });
      cerrar();
      mostrarMensaje(res.mensaje, 'exito');
      enrutar();
    } catch (err) { capa.querySelector('#error-cambio').innerHTML = avisoError(err.message); }
  });
}

// --- reparto: cuánto de cada partida va en cada envío (antes de publicar) ---
function pintarRepartoODT(destino, odt, t) {
  const cuentas = [...new Set(t.renglones.map((r) => r.cuenta || ''))];
  destino.innerHTML = `
    <p class="explica" style="padding-left:0">
      Cada partida se reparte entre los envíos de su cuenta. Donde la cuenta tiene un solo
      envío ya se repartió sola. El total de cada renglón tiene que dar lo que pide la partida.
    </p>
    ${cuentas.map((cuenta) => {
      const renglones = t.renglones.filter((r) => (r.cuenta || '') === cuenta);
      const envios = renglones[0] ? renglones[0].envios.map((x) => t.envios.find((e) => e.id === x.cita_id)) : [];
      return `
        <section class="panel">
          <h2>${esc(cuenta || 'Sin cuenta')} <span class="etiqueta azul">${renglones.length} partidas · ${envios.length} envío(s)</span></h2>
          <div class="desliza"><table class="captura tabla-reparto">
            <thead><tr><th class="fila-titulo">Código</th><th>Pide</th>
              ${envios.map((e) => `<th>${esc(e.etiqueta || e.fecha || '—')}<br><small>${esc(e.cedis)}</small></th>`).join('')}
              <th>Repartido</th></tr></thead>
            <tbody>${renglones.map((r) => `
              <tr data-reparto-renglon="${r.id}" data-pide="${r.pedidos}">
                <td class="fila-titulo">${esc(r.codigo)}<br><small style="color:var(--tinta-suave)">${esc((r.publicacion || '').slice(0, 40))}</small></td>
                <td><b>${numero(r.pedidos)}</b></td>
                ${r.envios.map((x) => `<td><input type="number" min="0" step="1" value="${x.cantidad || ''}" data-reparto-cita="${x.cita_id}"></td>`).join('')}
                <td class="celda-repartido">${r.repartido === r.pedidos ? '<span class="etiqueta verde">✓</span>' : `<span class="etiqueta roja">${numero(r.repartido)}</span>`}</td>
              </tr>`).join('')}
            </tbody></table></div>
        </section>`;
    }).join('')}
    <div class="acciones-almacen">
      <div class="fila-botones">
        <button class="btn" id="guardar-reparto">Guardar el reparto</button>
        <button class="btn primario grande" id="publicar-odt" ${t.reparto_completo ? '' : 'disabled'}>Publicar la ODT</button>
      </div>
    </div>`;

  // El total de cada renglón se recalcula al teclear.
  destino.querySelectorAll('[data-reparto-renglon]').forEach((fila) => {
    fila.addEventListener('input', () => {
      const suma = [...fila.querySelectorAll('[data-reparto-cita]')].reduce((n, c) => n + (Number(c.value) || 0), 0);
      const pide = Number(fila.dataset.pide);
      fila.querySelector('.celda-repartido').innerHTML = suma === pide
        ? '<span class="etiqueta verde">✓</span>' : `<span class="etiqueta roja">${numero(suma)}</span>`;
      document.getElementById('publicar-odt').disabled = true;
    });
  });
  const guardar = async () => {
    const reparto = [];
    destino.querySelectorAll('[data-reparto-renglon]').forEach((fila) => {
      fila.querySelectorAll('[data-reparto-cita]').forEach((c) => reparto.push({
        renglon_id: Number(fila.dataset.repartoRenglon), cita_id: Number(c.dataset.repartoCita), cantidad: Number(c.value) || 0,
      }));
    });
    return api('PUT', `/api/produccion/odt/${odt.id}/reparto`, { reparto });
  };
  document.getElementById('guardar-reparto').addEventListener('click', async () => {
    try { const r = await guardar(); mostrarMensaje(r.mensaje, r.tablero.reparto_completo ? 'exito' : 'error'); setTimeout(() => enrutar(), 900); }
    catch (err) { mostrarMensaje(err.message, 'error'); }
  });
  document.getElementById('publicar-odt').addEventListener('click', async () => {
    if (!confirm('Al publicarla la ve todo producción y ya no se cambia sin una modificación aprobada. ¿Publicar?')) return;
    try {
      await guardar();
      const r = await api('POST', `/api/produccion/odt/${odt.id}/publicar`);
      mostrarMensaje(r.mensaje, 'exito');
      setTimeout(() => { location.hash = `#/produccion/odt/${odt.id}/partidas`; }, 900);
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  });
}

// --- modificaciones pedidas ---
function pintarModificacionesODT(destino, modificaciones, t) {
  const ETQ = { por_aprobar: ['ambar', 'Por aprobar'], aprobada: ['verde', 'Aprobada'], rechazada: ['roja', 'Rechazada'], cancelada: ['', 'Cancelada'] };
  destino.innerHTML = modificaciones.length ? `
    <section class="panel">
      <h2>Modificaciones <span class="etiqueta azul">${modificaciones.length}</span></h2>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Partida</th><th>Cambio</th><th>Por qué</th><th>Pidió</th><th>Situación</th><th>Resolvió</th><th></th></tr></thead>
        <tbody>${modificaciones.map((m) => `
          <tr>
            <td class="fila-titulo">${esc(m.codigo)}</td>
            <td><b>${numero(m.pedidos_antes)} → ${numero(m.pedidos_despues)}</b><br><small>${m.cambios.map((c) => {
              const e = t.envios.find((y) => y.id === c.cita_id);
              return `${esc(e ? (e.etiqueta || e.fecha) : '—')}: ${c.antes} → ${c.despues}`;
            }).join(' · ')}</small></td>
            <td style="text-align:left"><small>${esc(m.motivo)}</small></td>
            <td>${esc(m.pidio)}<br><small>${esc(horaCorta(m.creado_en))}</small></td>
            <td><span class="etiqueta ${ETQ[m.estado][0]}">${ETQ[m.estado][1]}</span></td>
            <td>${esc(m.resolvio || '—')}${m.nota_resolucion ? `<br><small>«${esc(m.nota_resolucion)}»</small>` : ''}</td>
            <td>${m.estado === 'por_aprobar' ? `
              ${permiso('produccion_modificacion_aprobar') && (m.usuario_id !== estado.usuario.id || estado.usuario.rol === 'admin') ? `
                <button class="btn primario" data-mod="${m.id}|aprobar">Aprobar</button>
                <button class="btn" data-mod="${m.id}|rechazar">Rechazar</button>` : ''}
              ${m.usuario_id === estado.usuario.id ? `<button class="btn peligro" data-mod="${m.id}|cancelar">Cancelar</button>` : ''}` : ''}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>` : `<section class="panel"><h2>Sin modificaciones</h2>
      <div class="vacio">Si a una partida no le alcanza el material, se pide el cambio desde «Partidas por envío».</div></section>`;

  destino.querySelectorAll('[data-mod]').forEach((b) => {
    b.addEventListener('click', async () => {
      const [id, accion] = b.dataset.mod.split('|');
      let cuerpo;
      if (accion === 'rechazar') {
        const nota = prompt('¿Por qué se rechaza? Lo va a leer quien la pidió.');
        if (!nota || !nota.trim()) return;
        cuerpo = { nota: nota.trim() };
      }
      b.disabled = true;
      try {
        const r = await api('POST', `/api/produccion/modificaciones/${id}/${accion}`, cuerpo);
        mostrarMensaje(r.mensaje, 'exito');
        setTimeout(() => enrutar(), 900);
      } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; }
    });
  });
}

// --- material: si alcanza y los traspasos (lo que ya existía) ---
function pintarMaterialODT(destino, datos, preparando) {
  const { odt, evaluacion: e, bodegas, bodega_armado: armado } = datos;
  const traspasos = datos.traspasos || [];
  const editable = odt.estado === 'abierta' && permiso('produccion_capturar');
  const porTraspasar = e.renglones.filter((r) => r.traspaso_sugerido > 0);
  const yaPedido = traspasos.reduce((n, x) => n + x.unidades, 0);

  destino.innerHTML = `
    ${odt.problemas.length ? `
      <div class="aviso error">
        Hay renglones que no se pudieron traducir a material:
        <br><small>${esc(odt.problemas.slice(0, 8).join(' '))}${odt.problemas.length > 8 ? ` …y ${odt.problemas.length - 8} más.` : ''}</small>
      </div>` : ''}
    ${preparando ? `
      <section class="panel">
        <h2>Archivo de la ODT</h2>
        ${cajaCargarODT(odt)}
        <div class="pie"><span class="resumen">${odt.renglones.length} publicación(es) · ${numero(odt.total_unidades)} unidades de material${
          odt.archivo ? ` · de <b>${esc(odt.archivo)}</b>` : ''}.</span></div>
      </section>` : ''}
    <section class="panel">
      <h2>¿Alcanza el material?
        <span class="etiqueta verde">${e.renglones.filter((r) => r.estado === 'alcanza').length} alcanzan</span>
        <span class="etiqueta ambar">${e.renglones.filter((r) => r.estado === 'traspasar').length} traspasar</span>
        <span class="etiqueta roja">${e.renglones.filter((r) => r.estado === 'comprar').length} comprar</span>
      </h2>
      <p class="explica">Contra la existencia de ${esc(armado.nombre)} (${esc(armado.clave)}), donde se arma.</p>
      ${e.renglones.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Producto</th><th>Modelo</th><th>Pide la ODT</th>
            ${bodegas.map((b) => `<th>${esc(b.clave)}</th>`).join('')}
            <th>Total</th><th>Falta en ${esc(armado.clave)}</th><th>Traspasar</th><th>Desde</th><th>Comprar</th><th>Situación</th></tr></thead>
          <tbody>${e.renglones.map((r) => `
            <tr>
              <td class="fila-titulo">${fotoProducto({ id: r.producto_id, nombre: r.nombre, modelo: r.modelo })}${esc(r.nombre)}</td><td>${esc(r.modelo || '—')}</td><td><b>${numero(r.requerido)}</b></td>
              ${bodegas.map((b) => `<td>${numero(r.bodegas[b.clave])}</td>`).join('')}
              <td>${numero(r.total)}</td>
              <td>${r.falta_en_produccion ? `<b>${numero(r.falta_en_produccion)}</b>` : '—'}</td>
              <td>${r.traspaso_sugerido ? `<b>${numero(r.traspaso_sugerido)}</b>` : '—'}</td>
              <td>${r.fuentes.length ? r.fuentes.map((f) => `${esc(f.clave)} (${numero(f.cantidad)})`).join(', ') : '—'}</td>
              <td>${r.comprar ? `<b>${numero(r.comprar)}</b>` : '—'}</td>
              <td><span class="etiqueta ${CLASE_EVALUACION[r.estado]}">${TEXTO_EVALUACION[r.estado]}</span></td>
            </tr>`).join('')}
          </tbody></table></div>` : '<div class="vacio">Sin partidas.</div>'}
    </section>
    <section class="panel">
      <h2>Traspasos para armar esta ODT ${traspasos.length ? `<span class="etiqueta azul">${traspasos.length}</span>` : ''}</h2>
      ${traspasos.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Folio</th><th>De</th><th>A</th><th>Unidades</th><th>Situación</th></tr></thead>
          <tbody>${traspasos.map((x) => `
            <tr><td class="fila-titulo">${liga(`#/almacen/traspaso/${x.id}`, x.folio)}</td><td>${esc(x.origen)}</td><td>${esc(x.destino || '—')}</td>
              <td><b>${numero(x.unidades)}</b></td><td>${insigniaDocumento(x.estado)}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
      <div class="fila-botones" style="padding:${traspasos.length ? '14px' : '0'} 18px 18px">
        ${porTraspasar.length && editable && permiso('produccion_traspaso_pedir') ? `
          <button class="btn primario" id="pedir-traspaso">Pedir traspaso de ${porTraspasar.length} producto(s)</button>` : ''}
        ${permiso('mod_almacen') ? '<button class="btn" data-ir-hash="#/almacen/traspasos">Ver traspasos en Almacén</button>' : ''}
        <span class="resumen" style="align-self:center">
          ${porTraspasar.length
            ? `Faltan ${numero(porTraspasar.reduce((n, r) => n + r.traspaso_sugerido, 0))} unidades en ${esc(armado.clave)}${yaPedido ? `, ya pediste ${numero(yaPedido)}` : ''}.`
            : 'No falta nada que se pueda traspasar.'}
        </span>
      </div>
    </section>`;

  if (preparando) engancharCargaODT();
  const pedir = document.getElementById('pedir-traspaso');
  if (pedir) {
    pedir.addEventListener('click', async () => {
      pedir.disabled = true;
      try {
        const { creados } = await api('POST', `/api/produccion/odt/${odt.id}/traspaso`);
        mostrarMensaje(`Se pidió ${creados.length} traspaso(s). Almacén los aplica cuando el material se mueva.`, 'exito');
        setTimeout(() => enrutar(), 1000);
      } catch (err) { mostrarMensaje(err.message, 'error'); pedir.disabled = false; }
    });
  }
}

// --- reporte de almacén ---

// --- reporte de Incidencias: el corte del mes ---
//
// Es el que se descarga para afectar los bonos, así que la pantalla lo pone
// primero y completo. Los meses de atrás van al lado porque un número suelto no
// dice si alguien tuvo un mal mes o trae lo mismo desde hace medio año.

async function vistaIncidenciasReportes(mes) {
  const r = await api('GET', '/api/incidencias/reportes' + (mes ? `?mes=${encodeURIComponent(mes)}` : ''));
  encabezado('Reportes de Incidencias', nombreDelMes(r.mes));

  const conAlgo = r.corte.filter((f) => f.autorizadas > 0);
  const total = r.corte.reduce((n, f) => n + f.autorizadas, 0);
  const fuera = r.descartadas.reduce((n, d) => n + d.n, 0);
  const meses = [...new Set([r.mes, ...r.disponibles])].sort().reverse();

  vista.innerHTML = `
    ${migajaReportes('Incidencias')}
    <div id="mensajes"></div>

    <div class="filtros-almacen">
      <label>Mes del corte
        <select id="mes-reporte">
          ${meses.map((m) => `<option value="${esc(m)}" ${m === r.mes ? 'selected' : ''}>${esc(nombreDelMes(m))}</option>`).join('')}
        </select>
      </label>
      <button class="btn primario" id="bajar-corte">Descargar el corte</button>
    </div>

    <div class="cifras-almacen">
      <div class="cifra ${total ? 'alerta' : ''}"><b>${total}</b><span>incidencia(s) autorizada(s)</span></div>
      <div class="cifra"><b>${conAlgo.length}</b><span>persona(s) afectada(s)</span></div>
      <div class="cifra"><b>${r.corte.length - conAlgo.length}</b><span>sin nada en el mes</span></div>
      <div class="cifra"><b>${fuera}</b><span>quedaron fuera del corte</span></div>
    </div>

    <section class="panel">
      <h2>Corte de ${esc(nombreDelMes(r.mes))} <span class="etiqueta ${total ? 'roja' : 'verde'}">${total}</span></h2>
      <p class="explica">
        Esto es lo que se descarga. <b>Solo cuenta lo autorizado</b>: lo que espera
        autorización, lo rechazado y lo retirado no aparece aquí.
      </p>
      ${conAlgo.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Persona</th><th>Puesto</th>
            <th>Autorizadas</th><th>Detalle</th></tr></thead>
          <tbody>${conAlgo.map((f) => `
            <tr>
              <td class="fila-titulo">${esc(f.nombre)}</td>
              <td><small>${esc(f.puesto || f.rol)}</small></td>
              <td><b>${f.autorizadas}</b></td>
              <td>${(f.detalle || '').split(' ||| ').map((d) => `<div><small>${esc(d)}</small></div>`).join('')}</td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">Nadie tiene incidencias autorizadas este mes.</div>'}
      ${fuera ? `
        <div class="pie"><span class="resumen">
          Quedaron fuera del corte: ${esc(r.descartadas.map((d) => `${d.n} ${
            { por_autorizar: 'esperando autorización', rechazada: 'rechazada(s)', cancelada: 'retirada(s)' }[d.estado] || d.estado
          }`).join(' · '))}.
        </span></div>` : ''}
    </section>

    <section class="panel">
      <h2>Los últimos seis meses</h2>
      <p class="explica">
        La misma cuenta, mes con mes. Sirve para ver quién trae un problema que se
        repite y quién solo tuvo un mal mes.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Persona</th>
          ${r.meses.map((m) => `<th${m === r.mes ? ' class="fila-titulo"' : ''}>${esc(nombreDelMes(m).split(' de ')[0])}</th>`).join('')}
          <th>Total</th></tr></thead>
        <tbody>${r.historial.map((p) => `
          <tr>
            <td class="fila-titulo">${esc(p.nombre)}<br>
              <small style="color:var(--tinta-suave)">${esc(p.puesto || p.rol)}</small></td>
            ${r.meses.map((m) => `<td class="${p.meses[m] && m === r.mes ? 'alerta' : ''}">${p.meses[m] || '—'}</td>`).join('')}
            <td><b>${p.total || '—'}</b></td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="pie"><span class="resumen">La columna resaltada es el mes que estás cortando.</span></div>
    </section>`;

  document.getElementById('mes-reporte').addEventListener('change', (e) => {
    location.hash = `#/reportes/incidencias/${e.target.value}`;
  });
  document.getElementById('bajar-corte').addEventListener('click',
    () => descargarCSV(`/api/incidencias/corte.csv?mes=${r.mes}`));
}

// El reporte de Almacén: un periodo, agrupado por día, semana o mes, y una
// pestaña por pregunta. Se pide una sola vez al servidor; cambiar de pestaña no
// vuelve a consultar.
const PESTANAS_REPORTE_ALMACEN = [
  ['resumen', 'Resumen'],
  ['material', 'Material que sale'],
  ['cajas', 'Cajas de empaque'],
  ['documentos', 'Entradas, salidas y devoluciones'],
  ['retiros', 'Retiros y re-ingresos'],
  ['bajas', 'Bajas por calidad'],
  ['conteos', 'Conteos y ajustes'],
  ['correcciones', 'Correcciones'],
  ['reponer', 'Hay que reponer'],
];

async function vistaAlmacenReportes() {
  encabezado('Reportes de Almacén', 'Movimientos, material, retiros, bajas, conteos y correcciones');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = new Date();
  const haceDias = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return iso(d); };
  const atajos = {
    semanas4: ['Últimas 4 semanas', () => [haceDias(27), iso(hoy), 'semana']],
    mes: ['Este mes', () => [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy), 'dia']],
    meses3: ['Últimos 3 meses', () => [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1)), iso(hoy), 'mes']],
    anio: ['Este año', () => [iso(new Date(hoy.getFullYear(), 0, 1)), iso(hoy), 'mes']],
  };
  let filtros = null;
  try { filtros = JSON.parse(sessionStorage.getItem('filtrosReporteAlmacen') || 'null'); } catch { filtros = null; }
  if (!filtros || !filtros.desde) filtros = { desde: haceDias(27), hasta: iso(hoy), agrupar: 'semana', pestana: 'resumen' };
  const material = { tipo: '', texto: '' };

  vista.innerHTML = `
    ${migajaReportes('Almacén')}
    <div id="mensajes"></div>
    <section class="panel">
      <h2>Periodo</h2>
      <div class="rango-fechas">
        <label>Desde <input type="date" id="ra-desde" value="${esc(filtros.desde)}"></label>
        <label>Hasta <input type="date" id="ra-hasta" value="${esc(filtros.hasta)}"></label>
        <label>Agrupar por
          <select id="ra-agrupar">
            ${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([v, t]) =>
              `<option value="${v}" ${filtros.agrupar === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
        ${Object.entries(atajos).map(([k, [texto]]) => `<button class="btn" data-ra-atajo="${k}">${texto}</button>`).join('')}
      </div>
    </section>
    <div class="pestanas" role="tablist">
      ${PESTANAS_REPORTE_ALMACEN.map(([clave, texto]) => `
        <button role="tab" data-ra-pestana="${clave}" aria-selected="${filtros.pestana === clave}">${texto}</button>`).join('')}
    </div>
    <div id="ra-resultado"><div class="vacio">Cargando…</div></div>`;

  const destino = document.getElementById('ra-resultado');
  const campos = { desde: document.getElementById('ra-desde'), hasta: document.getElementById('ra-hasta'), agrupar: document.getElementById('ra-agrupar') };
  let datos = null;

  const pintar = () => {
    if (!datos) return;
    destino.innerHTML = PINTAR_REPORTE_ALMACEN[filtros.pestana](datos, material);
    const tipo = document.getElementById('ra-tipo');
    const texto = document.getElementById('ra-texto');
    if (tipo) tipo.addEventListener('change', () => { material.tipo = tipo.value; pintar(); });
    if (texto) {
      texto.addEventListener('change', () => { material.texto = texto.value; pintar(); });
    }
    const csv = document.getElementById('exportar-reporte');
    if (csv) csv.addEventListener('click', () => descargarCSV('/api/almacen/exportar.csv'));
  };
  const cargar = async () => {
    filtros.desde = campos.desde.value;
    filtros.hasta = campos.hasta.value;
    filtros.agrupar = campos.agrupar.value;
    try { sessionStorage.setItem('filtrosReporteAlmacen', JSON.stringify(filtros)); } catch { /* sin almacenamiento */ }
    destino.innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      datos = await api('GET', `/api/almacen/reportes?desde=${filtros.desde}&hasta=${filtros.hasta}&agrupar=${filtros.agrupar}`);
      pintar();
    } catch (err) {
      datos = null;
      destino.innerHTML = `<div class="panel"><div class="vacio">${esc(err.message)}</div></div>`;
    }
  };

  Object.values(campos).forEach((c) => c.addEventListener('change', cargar));
  vista.querySelectorAll('[data-ra-atajo]').forEach((b) => b.addEventListener('click', () => {
    const [d, h, agrupar] = atajos[b.dataset.raAtajo][1]();
    campos.desde.value = d;
    campos.hasta.value = h;
    campos.agrupar.value = agrupar;
    cargar();
  }));
  vista.querySelectorAll('[data-ra-pestana]').forEach((b) => b.addEventListener('click', () => {
    filtros.pestana = b.dataset.raPestana;
    vista.querySelectorAll('[data-ra-pestana]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    try { sessionStorage.setItem('filtrosReporteAlmacen', JSON.stringify(filtros)); } catch { /* sin almacenamiento */ }
    pintar();
  }));
  cargar();
}

const tablaReporte = (encabezados, filas, vacio) => (filas.length ? `
  <div class="desliza"><table class="captura">
    <thead><tr>${encabezados.map((h, i) => `<th${i === 0 ? ' class="fila-titulo"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${filas.join('')}</tbody>
  </table></div>` : `<div class="vacio">${vacio}</div>`);

const enlaceDocumento = (tipo, id, folio) => `<button class="btn" data-ir-hash="#/almacen/${tipo}/${id}">${esc(folio)}</button>`;

const TIPO_DOCUMENTO_TEXTO = { entrada: 'Entrada', salida: 'Salida', devolucion: 'Devolución', conteo: 'Conteo' };

const PINTAR_REPORTE_ALMACEN = {
  resumen: (r) => `
    <div class="cifras-almacen">
      <div class="cifra"><b>${numero(r.resumen.entradas)}</b><span>unidades entraron de proveedor</span></div>
      <div class="cifra"><b>${numero(r.resumen.retiros)}</b><span>unidades de retiros</span></div>
      <div class="cifra"><b>${numero(r.resumen.salidas)}</b><span>unidades salieron</span></div>
      <div class="cifra"><b>${numero(r.resumen.devoluciones)}</b><span>unidades devueltas</span></div>
      <div class="cifra"><b>${numero(r.resumen.traspasos)}</b><span>unidades traspasadas</span></div>
      <div class="cifra ${r.resumen.ajustes_bajan ? 'alerta' : ''}"><b>+${numero(r.resumen.ajustes_suben)} / −${numero(r.resumen.ajustes_bajan)}</b><span>ajustes por conteo</span></div>
      <div class="cifra ${r.resumen.correcciones ? 'alerta' : ''}"><b>${r.resumen.correcciones}</b><span>correcciones pedidas</span></div>
      <div class="cifra"><b>${r.resumen.exactitud === null ? '—' : `${r.resumen.exactitud}%`}</b><span>exactitud de los conteos</span></div>
      <div class="cifra"><b>${duracion(r.resumen.retiro_promedio_min)}</b><span>promedio para cerrar un retiro</span></div>
      <div class="cifra"><b>${duracion(r.resumen.retiro_espera_min)}</b><span>promedio esperando a la plataforma</span></div>
      <div class="cifra"><b>${r.resumen.reingresos}</b>
        <span>re-ingresos aprobados · ${numero(r.resumen.reingresos_cajas)} cajas</span></div>
      <div class="cifra ${r.resumen.salidas_calidad ? 'alerta' : ''}"><b>${numero(r.resumen.salidas_calidad_unidades)}</b>
        <span>unidades de baja por calidad</span></div>
      <div class="cifra ${r.resumen.descuadres > r.resumen.descuadres_con_cajas ? 'alerta' : ''}">
        <b>${r.resumen.descuadres_con_cajas} de ${r.resumen.descuadres}</b>
        <span>descuadres con detalle de cajas</span></div>
      <div class="cifra"><b>${numero(r.resumen.unidades_inventario)}</b><span>unidades en existencia hoy</span></div>
    </div>
    <section class="panel">
      <h2>Movimientos por ${r.agrupar === 'dia' ? 'día' : r.agrupar}</h2>
      <p class="explica">Unidades que movió cada tipo de documento ya aprobado. La carga inicial no cuenta.</p>
      ${tablaReporte(['Periodo', 'Entradas', 'Retiros', 'Salidas', 'Devoluciones', 'Traspasos', 'Ajustes +', 'Ajustes −'],
        r.por_periodo.map((f) => `
          <tr><td class="fila-titulo">${esc(f.etiqueta)}</td>
            <td>${numero(f.entradas)}</td><td>${numero(f.retiros)}</td><td>${numero(f.salidas)}</td>
            <td>${numero(f.devoluciones)}</td><td>${numero(f.traspasos)}</td>
            <td>${numero(f.ajustes_suben)}</td><td class="${f.ajustes_bajan ? 'alerta' : ''}">${numero(f.ajustes_bajan)}</td></tr>`),
        'Sin periodos.')}
    </section>`,

  material: (r, filtro) => {
    const tipos = [...new Set(r.piezas.map((x) => x.tipo_material).filter(Boolean))].sort();
    const texto = (filtro.texto || '').trim().toLowerCase();
    const lista = r.piezas.filter((x) => (!filtro.tipo || x.tipo_material === filtro.tipo)
      && (!texto || `${x.producto} ${x.sku} ${x.modelo || ''}`.toLowerCase().includes(texto)));
    return `
      <section class="panel">
        <h2>Piezas que salen de cada material <span class="etiqueta azul">${lista.length}</span></h2>
        <p class="explica">Salidas aprobadas, por ${r.agrupar === 'dia' ? 'día' : r.agrupar}. De más a menos.</p>
        <div class="filtros-almacen">
          <select id="ra-tipo"><option value="">Todos los tipos</option>
            ${tipos.map((t) => `<option value="${esc(t)}" ${filtro.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <input type="search" id="ra-texto" placeholder="Buscar producto…" value="${esc(filtro.texto || '')}">
        </div>
        ${tablaReporte(['Producto', 'Modelo', 'Tipo', 'Se cuenta en', 'Total', ...r.periodos.map((pe) => esc(pe.etiqueta))],
          lista.map((x) => `
            <tr><td class="fila-titulo">${esc(x.producto)}<br><small style="color:var(--tinta-suave)">${esc(x.sku)}</small></td>
              <td>${esc(x.modelo || '—')}</td><td><small>${esc(x.tipo_material || '—')}</small></td>
              <td><small>${esc(x.unidad || 'piezas')}</small></td>
              <td><b>${numero(x.total)}</b></td>
              ${r.periodos.map((pe) => `<td>${x.periodos[pe.clave] ? numero(x.periodos[pe.clave]) : '—'}</td>`).join('')}</tr>`),
          'No salió material en el periodo.')}
      </section>`;
  },

  cajas: (r) => `
    <section class="panel">
      <h2>Cajas de empaque por modelo</h2>
      <p class="explica">Todas las cajas del catálogo: cuántas salieron en cada ${r.agrupar === 'dia' ? 'día' : r.agrupar}, cuántas entraron y cuántas hay hoy.</p>
      ${tablaReporte(['Caja', 'Modelo', 'Hay hoy', 'Entraron', 'Salieron', ...r.periodos.map((pe) => esc(pe.etiqueta))],
        r.cajas.map((c) => `
          <tr><td class="fila-titulo">${esc(c.nombre)}<br><small style="color:var(--tinta-suave)">${esc(c.sku)}</small></td>
            <td>${esc(c.modelo || '—')}</td><td>${numero(c.existencia)}</td>
            <td>${numero(c.entran)}</td><td><b>${numero(c.salen)}</b></td>
            ${r.periodos.map((pe) => `<td>${c.periodos[pe.clave] ? numero(c.periodos[pe.clave]) : '—'}</td>`).join('')}</tr>`),
        'No hay cajas en el catálogo.')}
    </section>`,

  documentos: (r) => `
    <section class="panel">
      <h2>Entradas y retiros <span class="etiqueta azul">${r.entradas.length}</span></h2>
      ${tablaReporte(['Folio', 'Fecha', 'De', 'Estado', 'Llegó', 'Sumó', 'Capturó', 'Aprobó', 'Correcciones'],
        r.entradas.map((e) => `
          <tr><td class="fila-titulo">${enlaceDocumento('entrada', e.id, e.folio)}<br><small>${e.fuente === 'retiro' ? 'Retiro' : 'Proveedor'}</small></td>
            <td>${fechaCorta(e.fecha)}</td><td>${esc(e.quien || '—')}</td><td>${insigniaDocumento(e.estado)}</td>
            <td>${numero(e.unidades)}</td><td>${e.estado === 'aplicada' ? numero(e.unidades_aplicadas) : '—'}</td>
            <td>${esc(e.capturo)}</td><td>${esc(e.aprobo || '—')}</td>
            <td class="${e.correcciones ? 'alerta' : ''}">${e.correcciones}</td></tr>`),
        'No hubo entradas en el periodo.')}
    </section>
    <section class="panel">
      <h2>Salidas <span class="etiqueta azul">${r.salidas.length}</span></h2>
      ${tablaReporte(['Folio', 'Fecha', 'Motivo', 'Bodega', 'Estado', 'Unidades', 'Capturó', 'Aprobó', 'Correcciones'],
        r.salidas.map((x) => `
          <tr><td class="fila-titulo">${enlaceDocumento('salida', x.id, x.folio)}</td>
            <td>${fechaCorta(x.fecha)}</td>
            <td>${esc(x.destino || x.motivo_texto)}${x.fuera_odt ? '<br><span class="etiqueta ambar">Fuera de la ODT</span>' : ''}</td>
            <td>${esc(x.bodega)}</td><td>${insigniaDocumento(x.estado)}</td><td>${numero(x.unidades)}</td>
            <td>${esc(x.capturo)}</td><td>${esc(x.aprobo || '—')}</td>
            <td class="${x.correcciones ? 'alerta' : ''}">${x.correcciones}</td></tr>`),
        'No hubo salidas en el periodo.')}
    </section>
    <section class="panel">
      <h2>Devoluciones <span class="etiqueta azul">${r.devoluciones.length}</span></h2>
      ${tablaReporte(['Folio', 'Fecha', 'Rechazó', 'Motivo', 'Estado', 'Unidades', 'Capturó', 'Aprobó', 'Correcciones'],
        r.devoluciones.map((d) => `
          <tr><td class="fila-titulo">${enlaceDocumento('devolucion', d.id, d.folio)}</td>
            <td>${fechaCorta(d.fecha)}</td><td>${esc(d.quien || (d.rechazo_de === 'cedis' ? 'CEDIS' : 'Cliente'))}</td>
            <td style="text-align:left"><small>${esc(d.motivo || '—')}</small></td>
            <td>${insigniaDocumento(d.estado)}</td><td>${numero(d.unidades)}</td>
            <td>${esc(d.capturo)}</td><td>${esc(d.aprobo || '—')}</td>
            <td class="${d.correcciones ? 'alerta' : ''}">${d.correcciones}</td></tr>`),
        'No hubo devoluciones en el periodo.')}
    </section>`,

  retiros: (r) => `
    <section class="panel">
      <h2>Tiempo para cerrar un retiro, por plataforma</h2>
      <p class="explica">
        Desde que se carga el retiro hasta que se cierra —en días, que es como
        tardan— y en qué tramo se detiene: esperando a la plataforma, o esperando
        la aprobación del re-ingreso. «Recibido» contra «pedido» dice cuánto de lo
        que se pidió llegó de verdad.
      </p>
      ${tablaReporte(['Plataforma', 'Retiros', 'Cerrados', 'Pedido', 'Recibido', 'Promedio total', 'Esperando a la plataforma', 'Aprobación'],
        r.plataformas.map((x) => `
          <tr><td class="fila-titulo">${esc(x.plataforma)}</td><td>${x.retiros}</td><td>${x.cerrados}</td>
            <td>${numero(x.pedido)}</td>
            <td><b class="${x.recibido < x.pedido ? 'alerta' : ''}">${numero(x.recibido)}</b></td>
            <td><b>${duracion(x.promedio_total)}</b></td><td>${duracion(x.promedio_esperando)}</td>
            <td>${duracion(x.promedio_aprobacion)}</td></tr>`),
        'No hubo retiros en el periodo.')}
    </section>
    <section class="panel">
      <h2>Cada retiro <span class="etiqueta azul">${r.retiros.length}</span></h2>
      ${tablaReporte(['Folio', 'Plataforma', 'Fecha', 'Estado', 'Pedido', 'Recibido', 'Entregas', 'Cajas',
        'Captura → pendiente', 'Esperando', 'Aprobación', 'Total', 'Cerró'],
        r.retiros.map((x) => `
          <tr><td class="fila-titulo"><button class="btn" data-ir-hash="#/almacen/retiro/${x.id}">${esc(x.folio)}</button></td>
            <td>${esc(x.plataforma || '—')}</td><td>${fechaCorta(x.fecha)}</td><td>${insigniaDocumento(x.estado)}</td>
            <td>${numero(x.pedido)}</td>
            <td><b class="${x.recibido < x.pedido ? 'alerta' : ''}">${numero(x.recibido)}</b></td>
            <td>${x.entregas}</td><td>${x.cajas}</td>
            <td>${duracion(x.min_a_solicitud)}</td><td>${duracion(x.min_esperando)}</td>
            <td>${duracion(x.min_aprobacion)}</td><td><b>${duracion(x.min_total)}</b></td>
            <td>${esc(x.cerro || '—')}</td></tr>`),
        'No hubo retiros en el periodo.')}
    </section>
    <section class="panel">
      <h2>Re-ingresos que levantó Calidad <span class="etiqueta azul">${r.reingresos.length}</span></h2>
      <p class="explica">
        Cada entrega que llegó a bodega: cuántas cajas traía, cuánto se verificó
        dentro y cuánto tardó en aprobarse. Solo lo aprobado entró al inventario.
      </p>
      ${tablaReporte(['Folio', 'Retiro', 'Fecha', 'Estado', 'Cajas', 'Renglones', 'Unidades', 'Bodega', 'Recibió', 'Aprobó', 'Aprobación', 'Correcciones'],
        r.reingresos.map((g) => `
          <tr><td class="fila-titulo"><button class="btn" data-ir-hash="#/calidad/reingreso/${g.id}">${esc(g.folio)}</button></td>
            <td>${esc(g.retiro_folio)}</td><td>${fechaCorta(g.fecha)}</td><td>${insigniaDocumento(g.estado)}</td>
            <td>${g.cajas}</td><td>${g.renglones}</td><td><b>${numero(g.unidades)}</b></td>
            <td>${esc(g.bodega)}</td><td>${esc(g.recibio)}</td><td>${esc(g.aprobo || '—')}</td>
            <td>${duracion(g.min_aprobacion)}</td>
            <td class="${g.correcciones ? 'alerta' : ''}">${g.correcciones}</td></tr>`),
        'Calidad no levantó re-ingresos en el periodo.')}
    </section>`,

  bajas: (r) => `
    <section class="panel">
      <h2>Bajas por calidad <span class="etiqueta ${r.salidas_calidad.length ? 'ambar' : 'verde'}">${r.salidas_calidad.length}</span></h2>
      <p class="explica">
        Material que ya estaba en bodega y se dio de baja por daño. No salió
        vendido: se perdió, así que se mira aparte de las salidas de venta. Cada
        una con el motivo que escribió Calidad y si quedó la evidencia.
      </p>
      ${tablaReporte(['Folio', 'Fecha', 'Estado', 'Bodega', 'Unidades', 'Evidencia', 'Motivo', 'Pidió', 'Aprobó', 'Aprobación'],
        r.salidas_calidad.map((x) => `
          <tr><td class="fila-titulo"><button class="btn" data-ir-hash="#/calidad/salida/${x.id}">${esc(x.folio)}</button></td>
            <td>${fechaCorta(x.fecha)}</td><td>${insigniaDocumento(x.estado)}</td><td>${esc(x.bodega)}</td>
            <td><b>${numero(x.unidades)}</b></td>
            <td>${x.fotos ? `${x.fotos} foto(s)` : '<span class="etiqueta roja">sin foto</span>'}</td>
            <td style="text-align:left"><small>${esc(x.notas || '—')}</small></td>
            <td>${esc(x.pidio)}</td><td>${esc(x.aprobo || '—')}</td><td>${duracion(x.min_aprobacion)}</td></tr>`),
        'No hubo bajas por calidad en el periodo.')}
    </section>`,

  conteos: (r) => `
    <section class="panel">
      <h2>Conteos <span class="etiqueta azul">${r.conteos.length}</span></h2>
      <p class="explica">Exactitud = productos que cuadraron contra lo que decía el sistema. Reconteos = veces que se pidió volver a contar.</p>
      ${tablaReporte(['Semana', 'Bodega', 'Estado', 'Productos', 'Cuadraron', 'Exactitud', 'Unidades de descuadre', 'Reconteos', 'Envió', 'Aprobó'],
        r.conteos.map((c) => `
          <tr><td class="fila-titulo"><button class="btn" data-ir-hash="#/almacen/conteo/${c.id}">${esc(c.semana)}</button></td>
            <td>${esc(c.bodega)}</td><td>${insigniaDocumento(c.estado)}</td><td>${c.productos}</td>
            <td>${c.exactitud === null ? '—' : c.cuadrados}</td><td><b>${c.exactitud === null ? '—' : `${c.exactitud}%`}</b></td>
            <td>${c.exactitud === null ? '—' : numero(c.unidades_descuadre)}</td>
            <td class="${c.reconteos ? 'alerta' : ''}">${c.reconteos}</td>
            <td>${esc(c.envio || '—')}</td><td>${esc(c.aprobo || '—')}</td></tr>`),
        'No hubo conteos en el periodo.')}
    </section>
    <section class="panel">
      <h2>Cómo se contó lo que descuadró <span class="etiqueta azul">${r.detalle_cajas.length}</span></h2>
      <p class="explica">
        Cada producto con diferencia, con el detalle de cajas que anotó quien contó
        —«9 cajas de 50 + 1 de 42»— y su foto. Si la suma no cuadra con lo contado,
        aquí se ve. Los conteos de antes de esta regla aparecen sin detalle.
      </p>
      ${tablaReporte(['Producto', 'Semana', 'Bodega', 'Sistema', 'Contado', 'Diferencia', 'Se cuenta en',
        'Detalle de cajas', 'Cajas', 'Cuadra', 'Foto', 'Contó', 'Explicación'],
        r.detalle_cajas.map((f) => `
          <tr><td class="fila-titulo">${esc(f.producto)}<br><small style="color:var(--tinta-suave)">${esc(f.sku)}</small></td>
            <td><button class="btn" data-ir-hash="#/almacen/conteo/${f.conteo_id}">${esc(f.semana)}</button></td>
            <td>${esc(f.bodega)}</td><td>${numero(f.teorico)}</td><td><b>${numero(f.contado)}</b></td>
            <td><span class="delta ${f.diferencia === 0 ? 'neutra' : 'mala'}">${f.diferencia > 0 ? '+' : ''}${numero(f.diferencia)}</span></td>
            <td><small>${esc(f.unidad)}</small></td>
            <td style="text-align:left"><small>${esc(f.cajas_texto || '—')}</small></td>
            <td>${f.total_cajas || '—'}</td>
            <td>${!f.cajas.length ? '—' : (f.piezas_en_cajas === f.contado
              ? '<span class="etiqueta verde">Sí</span>'
              : `<span class="etiqueta roja">suma ${numero(f.piezas_en_cajas)}</span>`)}</td>
            <td>${f.fotos ? `${f.fotos}` : '—'}</td>
            <td>${esc(f.conto || '—')}</td>
            <td style="text-align:left"><small>${esc(f.observacion || '—')}</small></td></tr>`),
        'Ningún producto descuadró en el periodo.')}
    </section>
    <section class="panel">
      <h2>Ajustes de inventario <span class="etiqueta azul">${r.ajustes.length}</span></h2>
      <p class="explica">Cada producto que un conteo aprobado corrigió: cuánto subió o bajó y la explicación que se escribió.</p>
      ${tablaReporte(['Producto', 'Fecha', 'Bodega', 'Ajuste', 'Referencia', 'Explicación', 'Aprobó'],
        r.ajustes.map((a) => `
          <tr><td class="fila-titulo">${esc(a.producto)}<br><small style="color:var(--tinta-suave)">${esc(a.sku)}</small></td>
            <td>${fechaCorta(a.fecha)}</td><td>${esc(a.bodega || '—')}</td>
            <td><span class="delta ${a.cantidad < 0 ? 'mala' : 'buena'}">${a.cantidad > 0 ? '+' : ''}${numero(a.cantidad)}</span></td>
            <td><small>${esc(a.referencia || '—')}</small></td><td style="text-align:left"><small>${esc(a.notas || '—')}</small></td>
            <td>${esc(a.quien || '—')}</td></tr>`),
        'No hubo ajustes en el periodo.')}
    </section>`,

  correcciones: (r) => `
    <section class="panel">
      <h2>Correcciones pedidas <span class="etiqueta ${r.correcciones.length ? 'ambar' : 'verde'}">${r.correcciones.length}</span></h2>
      <p class="explica">Cada vez que alguien regresó un documento a corregir o pidió reconteo, con su nota y en qué etapa estaba.</p>
      ${tablaReporte(['Cuándo', 'Documento', 'Estaba', 'Nota', 'Quién'],
        r.correcciones.map((c) => `
          <tr><td class="fila-titulo">${esc(new Date(c.en).toLocaleString('es-MX'))}</td>
            <td>${TIPO_DOCUMENTO_TEXTO[c.documento_tipo] || c.documento_tipo}<br>${enlaceDocumento(c.documento_tipo, c.documento_id, c.folio || c.documento_id)}</td>
            <td>${insigniaDocumento(c.estado_anterior)}</td>
            <td style="text-align:left">${esc(c.nota)}</td><td>${esc(c.quien || '—')}</td></tr>`),
        'No se pidieron correcciones en el periodo.')}
    </section>`,

  reponer: (r) => `
    <section class="panel">
      <h2>Material que hay que reponer <span class="etiqueta ${r.alertas.length ? 'roja' : 'verde'}">${r.alertas.length}</span></h2>
      ${tablaReporte(['Producto', 'Modelo', 'Tipo', 'Total', 'Mínimo', 'Situación'],
        r.alertas.map((a) => `
          <tr><td class="fila-titulo">${esc(a.nombre)}</td><td>${esc(a.modelo || '—')}</td>
            <td><small>${esc(a.tipo_material || '—')}</small></td><td><b>${numero(a.total)}</b></td>
            <td>${numero(a.stock_minimo)}</td>
            <td><span class="etiqueta ${CLASE_EXISTENCIA[a.estado]}">${TEXTO_EXISTENCIA[a.estado]}</span></td></tr>`),
        'Todo el catálogo está por encima de su mínimo.')}
      <div class="fila-botones" style="padding:0 18px 18px">
        <button class="btn" id="exportar-reporte">Descargar el inventario en CSV</button>
      </div>
    </section>`,
};

// ================================================= reportes: producción y VxF
//
// Los dos por rango de fechas, con los mismos atajos que el de Almacén. El de
// Producción mira a las personas y a los envíos; el de Ventas directas, el
// tiempo de cada paso de la orden y lo que no cuadró contra Almacén.

function rangoReporte(clave, alCambiar) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = new Date();
  const hace = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return iso(d); };
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(clave) || 'null'); } catch { r = null; }
  if (!r || !r.desde) r = { desde: hace(27), hasta: iso(hoy) };
  const atajos = [
    ['Últimas 4 semanas', () => [hace(27), iso(hoy)]],
    ['Este mes', () => [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)]],
    ['Últimos 3 meses', () => [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1)), iso(hoy)]],
    ['Este año', () => [iso(new Date(hoy.getFullYear(), 0, 1)), iso(hoy)]],
  ];
  const html = `
    <section class="panel">
      <h2>Periodo</h2>
      <div class="rango-fechas">
        <label>Desde <input type="date" id="rr-desde" value="${r.desde}"></label>
        <label>Hasta <input type="date" id="rr-hasta" value="${r.hasta}"></label>
        <button class="btn primario" id="rr-ver">Ver</button>
        ${atajos.map(([t], i) => `<button class="btn" data-rr-atajo="${i}">${t}</button>`).join('')}
      </div>
    </section>`;
  const conectar = () => {
    const fijar = (desde, hasta) => {
      try { sessionStorage.setItem(clave, JSON.stringify({ desde, hasta })); } catch { /* sin almacenamiento */ }
      alCambiar();
    };
    document.getElementById('rr-ver').addEventListener('click', () => fijar(document.getElementById('rr-desde').value, document.getElementById('rr-hasta').value));
    vista.querySelectorAll('[data-rr-atajo]').forEach((b) => b.addEventListener('click', () => fijar(...atajos[Number(b.dataset.rrAtajo)][1]())));
  };
  return { rango: r, html, conectar };
}

async function vistaProduccionReportes() {
  encabezado('Reportes de Producción', 'Avance, cumplimiento por envío y métricas de cada persona');
  const { rango, html, conectar } = rangoReporte('filtrosReporteProduccion', () => vistaProduccionReportes());
  const r = await api('GET', `/api/produccion/reportes?desde=${rango.desde}&hasta=${rango.hasta}`);
  const envios = r.odts.flatMap((o) => o.envios.filter((e) => e.total).map((e) => ({ ...e, semana: o.semana })));

  vista.innerHTML = `
    ${migajaReportes('Producción')}
    <div id="mensajes"></div>
    ${html}
    <div class="cifras-almacen">
      <div class="cifra"><b>${numero(r.resumen.armado)}</b><span>piezas armadas</span></div>
      <div class="cifra"><b>${r.resumen.personas}</b><span>personas que armaron</span></div>
      <div class="cifra"><b>${r.resumen.envios_a_tiempo} de ${r.resumen.envios}</b><span>envíos listos a tiempo</span></div>
      <div class="cifra ${r.resumen.envios_tarde + r.resumen.envios_atrasados ? 'alerta' : ''}"><b>${r.resumen.envios_tarde + r.resumen.envios_atrasados}</b><span>tarde o atrasados</span></div>
      <div class="cifra"><b>${r.resumen.modificaciones}</b><span>modificaciones pedidas</span></div>
    </div>

    <section class="panel">
      <h2>Por persona <span class="etiqueta azul">${r.personas.length}</span></h2>
      <p class="explica">
        Lo que anotó cada quien. «Por hora» es aproximado: cuenta del primer al último
        registro de cada día que trabajó. Sirve para comparar, no para cronometrar.
      </p>
      ${tablaReporte(['Persona', 'Piezas', 'Días', 'Promedio por día', 'Por hora', 'Registros', ...r.dias.map((d) => fechaCorta(d).slice(0, 5))],
        r.personas.map((x) => `
          <tr><td class="fila-titulo">${esc(x.quien)}</td><td><b>${numero(x.armado)}</b></td><td>${x.dias}</td>
            <td>${numero(x.promedio_dia)}</td><td>${x.por_hora}</td><td>${x.registros}</td>
            ${r.dias.map((d) => `<td>${x.por_dia[d] ? numero(x.por_dia[d]) : '—'}</td>`).join('')}</tr>`),
        'Nadie anotó armado en el periodo.')}
    </section>

    <section class="panel">
      <h2>Cada ODT <span class="etiqueta azul">${r.odts.length}</span></h2>
      ${tablaReporte(['Semana', 'Piezas', 'Armadas', 'Avance', 'Envíos', 'Modificaciones'],
        r.odts.map((o) => `
          <tr><td class="fila-titulo"><button class="btn" data-ir-hash="#/produccion/odt/${o.id}">${esc(describirSemanaCorta(o.semana))}</button></td>
            <td>${numero(o.total)}</td><td>${numero(o.armado)}</td><td>${barraAvance(o.pct)}</td>
            <td>${o.envios.filter((e) => e.total).length}</td><td>${o.modificaciones}</td></tr>`),
        'No hubo ODT publicadas en el periodo.')}
    </section>

    <section class="panel">
      <h2>Cumplimiento por envío <span class="etiqueta azul">${envios.length}</span></h2>
      <p class="explica">Cuándo quedó completo cada envío contra el día de su cita.</p>
      ${tablaReporte(['Envío', 'Cita', 'Cuenta', 'Piezas', 'Avance', 'Quedó completo', 'Resultado'],
        envios.map((e) => `
          <tr><td class="fila-titulo">${esc(e.etiqueta || '—')}<br><small>${esc(e.cedis)}${e.folio ? ` · ${esc(e.folio)}` : ''}</small></td>
            <td>${esc(e.fecha ? fechaCorta(e.fecha) : '—')}</td><td><small>${esc(e.cuenta || '—')}</small></td>
            <td>${numero(e.total)}</td><td>${barraAvance(e.pct)}</td>
            <td>${e.completo_en ? esc(horaCorta(e.completo_en)) : '—'}</td>
            <td>${e.a_tiempo === true ? '<span class="etiqueta verde">A tiempo</span>'
              : e.a_tiempo === false ? '<span class="etiqueta roja">Tarde</span>' : insigniaSituacion(e.situacion)}</td></tr>`),
        'Sin envíos en el periodo.')}
    </section>

    <section class="panel">
      <h2>Modificaciones <span class="etiqueta azul">${r.modificaciones.length}</span></h2>
      ${tablaReporte(['Semana', 'Partida', 'Cambio', 'Por qué', 'Pidió', 'Situación', 'Resolvió'],
        r.modificaciones.map((m) => `
          <tr><td class="fila-titulo">${esc(describirSemanaCorta(m.semana))}</td><td>${esc(m.codigo)}</td>
            <td>${numero(m.pedidos_antes)} → ${numero(m.pedidos_despues)}</td><td style="text-align:left"><small>${esc(m.motivo)}</small></td>
            <td>${esc(m.pidio)}</td><td>${esc(m.estado)}</td><td>${esc(m.resolvio || '—')}</td></tr>`),
        'No se pidieron modificaciones en el periodo.')}
    </section>`;
  conectar();
}

async function vistaVxfReportes() {
  encabezado('Reportes de Ventas directas', 'Órdenes, tiempos de cada paso, cajas y diferencias');
  const { rango, html, conectar } = rangoReporte('filtrosReporteVxf', () => vistaVxfReportes());
  const r = await api('GET', `/api/vxf/reportes?desde=${rango.desde}&hasta=${rango.hasta}`);

  vista.innerHTML = `
    ${migajaReportes('Ventas directas')}
    <div id="mensajes"></div>
    ${html}
    <div class="cifras-almacen">
      <div class="cifra"><b>${r.resumen.ordenes}</b><span>órdenes (${r.resumen.terminadas} terminadas)</span></div>
      <div class="cifra"><b>${r.resumen.cajas}</b><span>cajas · ${r.resumen.peso} kg</span></div>
      <div class="cifra"><b>${duracion(r.resumen.promedio_armado)}</b><span>promedio para armar</span></div>
      <div class="cifra"><b>${duracion(r.resumen.promedio_guia)}</b><span>promedio para la guía</span></div>
      <div class="cifra"><b>${duracion(r.resumen.promedio_total)}</b><span>promedio de punta a punta</span></div>
      <div class="cifra ${r.resumen.con_diferencias ? 'alerta' : ''}"><b>${r.resumen.con_diferencias}</b><span>con diferencias contra Almacén</span></div>
      <div class="cifra ${r.resumen.sin_salida ? 'alerta' : ''}"><b>${r.resumen.sin_salida}</b><span>armadas sin salida de Almacén</span></div>
    </div>

    <section class="panel">
      <h2>Cada orden <span class="etiqueta azul">${r.ordenes.length}</span></h2>
      ${tablaReporte(['Folio', 'Cliente', 'Fecha', 'Situación', 'Piezas', 'Cajas', 'Peso', 'Armado', 'Guía o nota', 'Cierre', 'Total', 'Salidas', 'Diferencias'],
        r.ordenes.map((o) => `
          <tr><td class="fila-titulo"><button class="btn" data-ir-hash="#/ventas-fuera/orden/${o.id}">${esc(o.folio)}</button></td>
            <td>${esc(o.cliente)}</td><td>${fechaCorta(o.fecha_solicitud)}</td><td>${insigniaVxf(o.estado)}</td>
            <td>${numero(o.unidades)}</td><td>${o.cajas}</td><td>${o.peso_total} kg</td>
            <td>${duracion(o.min_armado)}</td><td>${duracion(o.min_guia)}</td><td>${duracion(o.min_cierre)}</td><td><b>${duracion(o.min_total)}</b></td>
            <td><small>${esc(o.salidas.join(', ') || '—')}</small></td>
            <td>${o.diferencias.length ? `<span class="etiqueta roja">${o.diferencias.map((d) => `${esc(d.producto)} ${d.diferencia > 0 ? '+' : ''}${d.diferencia}`).join(' · ')}</span>` : '—'}</td></tr>`),
        'No hubo órdenes en el periodo.')}
    </section>

    <section class="panel">
      <h2>Cajas por modelo</h2>
      ${tablaReporte(['Modelo de caja', 'Cajas', 'Peso total'],
        r.cajas.map((c) => `<tr><td class="fila-titulo">${esc(c.modelo || 'Sin modelo')}</td><td><b>${numero(c.cajas)}</b></td><td>${Math.round(c.peso * 100) / 100} kg</td></tr>`),
        'Sin cajas en el periodo.')}
    </section>

    <section class="panel">
      <h2>Por cliente</h2>
      ${tablaReporte(['Cliente', 'Órdenes', 'Piezas'],
        r.clientes.map((c) => `<tr><td class="fila-titulo">${esc(c.cliente)}</td><td>${c.ordenes}</td><td>${numero(c.unidades)}</td></tr>`),
        'Sin clientes en el periodo.')}
    </section>`;
  conectar();
}

// ================================================== vista: reportes de Tránsito

// Minutos dichos como se dicen: «45 min», «3 h 10 min».
// Un tiempo de cierre se dice en la unidad en la que uno lo piensa: minutos
// dentro de la hora, horas dentro del día, y días a partir de ahí. Un retiro que
// tardó dos semanas en llegar no se entiende escrito en 20 160 minutos, y una
// aprobación que tardó 12 minutos tampoco se entiende en días.
const duracion = (min) => {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  }
  const dias = Math.floor(min / (60 * 24));
  const horas = Math.round((min % (60 * 24)) / 60);
  return `${dias} día${dias === 1 ? '' : 's'}${horas ? ` ${horas} h` : ''}`;
};
const horaCorta = (iso) => (iso
  ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—');

// Los envíos como lo que son: entregas. Por omisión, el mes en curso.
async function vistaTransitoReportes() {
  encabezado('Reportes de Tránsito', 'Envíos, colectas, tiempos en ruta y traspasos');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = new Date();
  const atajos = {
    hoy: ['Hoy', () => [iso(hoy), iso(hoy)]],
    semana: ['Esta semana', () => {
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      return [iso(lunes), iso(hoy)];
    }],
    mes: ['Este mes', () => [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)]],
    pasado: ['Mes pasado', () => [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
      iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0))]],
  };
  let rango = null;
  try { rango = JSON.parse(sessionStorage.getItem('rangoTransito') || 'null'); } catch { rango = null; }
  if (!Array.isArray(rango) || rango.length !== 2) rango = atajos.mes[1]();

  vista.innerHTML = `
    ${migajaReportes('Tránsito')}
    <div id="mensajes"></div>
    <section class="panel">
      <h2>Periodo</h2>
      <div class="rango-fechas">
        <label>Desde <input type="date" id="rango-desde" value="${esc(rango[0])}"></label>
        <label>Hasta <input type="date" id="rango-hasta" value="${esc(rango[1])}"></label>
        ${Object.entries(atajos).map(([k, [texto]]) => `<button class="btn" data-atajo="${k}">${texto}</button>`).join('')}
      </div>
    </section>
    <div id="resultado"><div class="vacio">Cargando…</div></div>`;

  const desde = document.getElementById('rango-desde');
  const hasta = document.getElementById('rango-hasta');
  const destino = document.getElementById('resultado');

  const cargar = async () => {
    if (!desde.value || !hasta.value) return;
    try { sessionStorage.setItem('rangoTransito', JSON.stringify([desde.value, hasta.value])); } catch { /* sin almacenamiento */ }
    destino.innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      const r = await api('GET', `/api/transito/reportes?desde=${desde.value}&hasta=${hasta.value}`);
      destino.innerHTML = pintarReporteTransito(r);
    } catch (err) {
      destino.innerHTML = `<div class="panel"><div class="vacio">${esc(err.message)}</div></div>`;
    }
  };
  desde.addEventListener('change', cargar);
  hasta.addEventListener('change', cargar);
  vista.querySelectorAll('[data-atajo]').forEach((b) => b.addEventListener('click', () => {
    [desde.value, hasta.value] = atajos[b.dataset.atajo][1]();
    cargar();
  }));
  destino.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ver-envio]');
    if (b) location.hash = `#/reportes/transito/envio/${b.dataset.verEnvio}`;
  });
  cargar();
}

function pintarReporteTransito(r) {
  const { resumen } = r;
  const puedeAbrirTraspaso = ['mod_almacen', 'traspasos_aprobar', 'traspasos_cargar', 'traspasos_confirmar'].some((k) => permiso(k));
  const tipo = (t) => `<span class="etiqueta ${t === 'colecta' ? 'azul' : 'verde'}">${t === 'colecta' ? 'Colecta' : 'Envío'}</span>`;

  if (!resumen.total && !resumen.traspasos) {
    return `<div class="panel"><div class="vacio">
      No hay envíos ni colectas con el cierre aprobado entre el ${esc(r.desde)} y el ${esc(r.hasta)}.
    </div></div>`;
  }

  return `
    <div class="cifras-almacen">
      <div class="cifra"><b>${resumen.total}</b><span>concluidos y aprobados</span></div>
      <div class="cifra"><b>${resumen.envios}</b><span>envíos</span></div>
      <div class="cifra"><b>${resumen.colectas}</b><span>colectas</span></div>
      <div class="cifra"><b>${duracion(resumen.promedio_min)}</b><span>promedio en ruta</span></div>
      <div class="cifra ${resumen.correcciones ? 'alerta' : ''}"><b>${resumen.correcciones}</b><span>veces regresados a corregir</span></div>
      <div class="cifra"><b>${resumen.traspasos}</b><span>traspasos cargados</span></div>
    </div>

    <section class="panel">
      <h2>Envíos y colectas <span class="etiqueta azul">${resumen.total}</span></h2>
      <p class="explica">
        Solo los que ya tienen el cierre aprobado; lo que sigue en proceso está en la portada de
        Tránsito y en Notificaciones. El tiempo en ruta va de la salida o carga autorizada a que
        se envió a aprobación de cierre.
      </p>
      ${r.envios.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr>
            <th class="fila-titulo">Número</th><th>Tipo</th><th>Fecha</th><th>CEDIS</th>
            <th>Llenó</th><th>Autorizó</th><th>Salió / cargó</th><th>Aprobó cierre</th>
            <th>Tiempo en ruta</th><th>Transporte</th><th>Hojas</th><th>Correcciones</th><th></th>
          </tr></thead>
          <tbody>${r.envios.map((e) => `
            <tr>
              <td class="fila-titulo"><b>${esc(e.numero || '—')}</b></td>
              <td>${tipo(e.tipo)}</td>
              <td>${esc(e.fecha)}</td>
              <td>${esc(e.lugar)}</td>
              <td>${esc(e.preparo)}</td>
              <td>${esc(e.autorizo || '—')}</td>
              <td>${horaCorta(e.salida_en)}</td>
              <td>${e.aprobo ? `${esc(e.aprobo)}<br><small>${horaCorta(e.cerrado_en)}</small>` : '—'}</td>
              <td><b>${duracion(e.minutos_en_ruta)}</b></td>
              <td style="text-align:left">${e.transporte
                ? `${esc(e.transporte.proveedor || '—')} · ${esc(e.transporte.placas || '—')}<br>
                   <small>${esc(e.transporte.chofer || '—')} · arribo ${esc(e.transporte.hora_arribo || '—')}${
                     e.transporte.unidad_adecuada === 'no' ? ' · <b style="color:var(--alerta)">unidad no adecuada</b>' : ''}</small>`
                : '—'}</td>
              <td><small>antes ${e.hojas_salida} · al final ${e.hojas_regreso}</small></td>
              <td class="${e.correcciones ? 'alerta' : ''}">${e.correcciones}</td>
              <td><button class="btn" data-ver-envio="${e.id}">Ver</button></td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">No hubo envíos ni colectas aprobados en el periodo.</div>'}
    </section>

    ${r.por_lugar.length ? `
      <section class="panel">
        <h2>Por CEDIS</h2>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">CEDIS</th><th>Total</th><th>Envíos</th><th>Colectas</th><th>Promedio en ruta</th></tr></thead>
          <tbody>${r.por_lugar.map((l) => `
            <tr>
              <td class="fila-titulo">${esc(l.lugar)}</td>
              <td><b>${l.total}</b></td><td>${l.envios}</td><td>${l.colectas}</td><td>${duracion(l.promedio_min)}</td>
            </tr>`).join('')}
          </tbody></table></div>
      </section>` : ''}

    ${r.por_dia.length ? `
      <section class="panel">
        <h2>Por día</h2>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Día</th><th>Total</th><th>Envíos</th><th>Colectas</th></tr></thead>
          <tbody>${r.por_dia.map((d) => `
            <tr>
              <td class="fila-titulo">${esc(d.fecha)}</td>
              <td><b>${d.total}</b></td><td>${d.envios}</td><td>${d.colectas}</td>
            </tr>`).join('')}
          </tbody></table></div>
      </section>` : ''}

    <section class="panel">
      <h2>Traspasos que movió Tránsito <span class="etiqueta azul">${r.traspasos.length}</span></h2>
      <p class="explica">Los que se cargaron en el periodo, hayan llegado o no. El tiempo en camino va de la carga a la confirmación.</p>
      ${r.traspasos.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr>
            <th class="fila-titulo">Folio</th><th>Bodegas</th><th>Unidades</th><th>Cargó</th>
            <th>Fotos</th><th>Estado</th><th>Confirmó</th><th>Tiempo en camino</th>
          </tr></thead>
          <tbody>${r.traspasos.map((t) => `
            <tr>
              <td class="fila-titulo">${puedeAbrirTraspaso
                ? `<button class="btn" data-ir-hash="#/almacen/traspaso/${t.id}">${esc(t.folio)}</button>`
                : `<b>${esc(t.folio)}</b>`}</td>
              <td>${esc(t.origen)} → ${esc(t.destino || '—')}</td>
              <td>${numero(t.unidades)}</td>
              <td>${esc(t.cargo || '—')}<br><small>${horaCorta(t.cargado_en)}</small></td>
              <td>${t.fotos}</td>
              <td>${insigniaTraspaso(t.estado)}</td>
              <td>${t.confirmo ? `${esc(t.confirmo)}<br><small>${horaCorta(t.confirmado_en)}</small>` : '—'}</td>
              <td><b>${duracion(t.minutos_en_camino)}</b></td>
            </tr>`).join('')}
          </tbody></table></div>`
        : '<div class="vacio">Tránsito no cargó traspasos en el periodo.</div>'}
    </section>`;
}

// ============================================================= LOGÍSTICA
//
// Una unidad no es solo su checklist: es su kilometraje, su gasolina, sus
// papeles y lo que se le ha hecho. La portada son las fichas de todas; dentro de
// cada una está su historia completa, y el desempeño compara entre ellas.

const migajaLogistica = (seccion, destinoSeccion, hoja) =>
  migajaModulo('Logística', '#/logistica', seccion, destinoSeccion, hoja);

const pesos = (n) => (n === null || n === undefined ? '—'
  : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const ETIQUETA_VIGENCIA = {
  vencida: 'roja', vence_hoy: 'roja', por_vencer: 'ambar', vigente: 'verde', sin_dato: '',
};

function selectDe(lista, valor, extra = '') {
  return `<option value=""></option>${lista.map((v) => `
    <option value="${esc(v)}" ${v === valor ? 'selected' : ''}>${esc(v)}</option>`).join('')}${extra}`;
}

// La tarjeta de una unidad: foto, nombre y lo que hay que saber de un vistazo.
// Vive aparte porque la usa la pantalla de Unidades, no la portada: la portada
// es un índice —adónde ir—, no la lista de toda la flota.
function tarjetaUnidad(u) {
  const papeles = u.papeles.vencidos ? `<span class="etiqueta roja">${u.papeles.vencidos} papel(es) vencido(s)</span>`
    : u.papeles.por_vencer ? `<span class="etiqueta ambar">${u.papeles.por_vencer} por vencer</span>`
    : u.papeles.total ? '<span class="etiqueta verde">papeles al día</span>' : '';
  const servicio = u.proximo_servicio
    ? `<span class="etiqueta ${u.proximo_servicio.urge ? 'roja' : ''}">servicio ${esc(u.proximo_servicio.texto)}</span>` : '';
  return `
    <button class="tarjeta-unidad ${u.activo ? '' : 'retirada'}" data-ir-hash="#/logistica/unidad/${u.id}">
      <span class="foto">${u.imagen
        ? `<img data-archivo="${esc(u.imagen)}" alt="">`
        : simbolo('volante')}</span>
      <span class="cuerpo">
        <b>${esc(u.nombre)}${u.activo ? '' : ' · retirada'}</b>
        <span class="meta">${esc(u.etiqueta_tipo)}${u.lleva_kilometraje && u.kilometraje !== null
          ? ` · ${numero(u.kilometraje)} km` : ''}${u.rendimiento ? ` · ${u.rendimiento} km/L` : ''}</span>
        <span class="etiquetas">${papeles}${servicio}</span>
      </span>
    </button>`;
}

async function vistaLogistica() {
  encabezado('Logística', 'Las unidades: checklist, gasolina, papeles y desempeño');
  const d = await api('GET', '/api/logistica');
  estado.logistica = d;

  vista.innerHTML = `
    ${migajaLogistica()}
    <div id="mensajes"></div>

    <div class="cifras-almacen">
      <div class="cifra"><b>${d.cifras.unidades}</b><span>unidades en uso</span></div>
      <div class="cifra ${d.cifras.papeles_vencidos ? 'alerta' : ''}">
        <b>${d.cifras.papeles_vencidos}</b><span>papeles vencidos</span></div>
      <div class="cifra ${d.cifras.papeles_por_vencer ? 'alerta' : ''}">
        <b>${d.cifras.papeles_por_vencer}</b><span>papeles por vencer</span></div>
      <div class="cifra ${d.cifras.servicios_por_hacer ? 'alerta' : ''}">
        <b>${d.cifras.servicios_por_hacer}</b><span>servicios que ya tocan</span></div>
      <div class="cifra"><b>${pesos(d.cifras.gasto_mes)}</b><span>gasolina este mes</span></div>
    </div>

    <div class="rejilla-tareas">
      <button class="tarea" data-ir-hash="#/logistica/unidades">
        <b>Unidades${d.cifras.unidades ? ` <span class="etiqueta">${d.cifras.unidades}</span>` : ''}</b>
        <span class="meta">La ficha de cada una: kilometraje, papeles, gasolina y servicios.</span>
      </button>
      ${d.puede.salidas ? `
        <button class="tarea" data-ir-hash="#/envios/transito">
          <b>Salidas de unidad${d.cifras.salidas_abiertas
    ? ` <span class="etiqueta ambar">${d.cifras.salidas_abiertas} abierta(s)</span>` : ''}</b>
          <span class="meta">El formato de asignación e inspección: antes de que salga y al regresar.</span>
        </button>` : ''}
      ${d.puede.rutas ? `
        <button class="tarea" data-ir-hash="#/logistica/rutas">
          <b>Ruta para entrega${d.cifras.paradas_hoy
    ? ` <span class="etiqueta ambar">${d.cifras.paradas_hoy} parada(s) hoy</span>` : ''}</b>
          <span class="meta">En qué orden se entrega hoy: CEDIS, clientes y paquetería.</span>
        </button>` : ''}
      ${d.puede.checklists ? `
        <button class="tarea" data-ir-hash="#/logistica/checklists">
          <b>Checklists de las unidades</b>
          <span class="meta">Llenar la inspección que le toca a cada unidad esta semana.</span>
        </button>` : ''}
      <button class="tarea" data-ir-hash="#/logistica/cargas">
        <b>Cargas de gasolina</b>
        <span class="meta">Anotar una carga y ver todas, con litros, lo pagado y su rendimiento.</span>
      </button>
      <button class="tarea" data-ir-hash="#/logistica/servicios">
        <b>Servicios y mantenimientos</b>
        <span class="meta">Anotar lo que se hizo, programar el próximo y ver lo que ya viene.</span>
      </button>
      ${d.puede.reportes ? `
        <button class="tarea" data-ir-hash="#/logistica/desempeno">
          <b>Desempeño</b><span class="meta">Rendimiento, costo por kilómetro, gasto por mes y papeles.</span>
        </button>` : ''}
    </div>`;

}

// --- las unidades, en su propia pantalla ---
//
// La portada de Logística es un índice y no la flota entera: quien entra a
// anotar una carga no viene a mirar doce fichas. Aquí sí se vienen a ver, y por
// eso aquí están el filtro por tipo y la búsqueda.

async function vistaLogisticaUnidades(tipoPedido) {
  encabezado('Unidades', 'La ficha de cada una');
  // Siempre se vuelve a pedir: si acabas de anotar una carga, el kilometraje de
  // la ficha tiene que estar al día.
  const d = await api('GET', '/api/logistica');
  estado.logistica = d;

  const tipo = tipoPedido || 'todas';
  const busqueda = (estado.busquedaUnidades || '').trim().toLowerCase();
  const conUnidades = d.tipos.filter((t) => d.unidades.some((u) => u.tipo === t.clave));

  const visibles = d.unidades
    .filter((u) => tipo === 'todas' || u.tipo === tipo)
    .filter((u) => !busqueda || `${u.nombre} ${u.clave} ${u.etiqueta_tipo}`.toLowerCase().includes(busqueda));

  const porTipo = new Map();
  for (const u of visibles) {
    if (!porTipo.has(u.tipo)) porTipo.set(u.tipo, []);
    porTipo.get(u.tipo).push(u);
  }

  vista.innerHTML = `
    ${migajaLogistica('Unidades')}
    <div id="mensajes"></div>

    <div class="filtros">
      <div class="chips-filtro">
        <button class="chip-filtro" aria-pressed="${tipo === 'todas'}" data-tipo="todas">
          Todas · ${d.unidades.length}</button>
        ${conUnidades.map((t) => `
          <button class="chip-filtro" aria-pressed="${tipo === t.clave}" data-tipo="${esc(t.clave)}">
            ${esc(t.plural || t.etiqueta)} · ${d.unidades.filter((u) => u.tipo === t.clave).length}
          </button>`).join('')}
      </div>
      <input id="busca-unidad" placeholder="Buscar por nombre o clave" value="${esc(estado.busquedaUnidades || '')}">
    </div>

    ${visibles.length ? [...porTipo.entries()].map(([clave, lista]) => {
      const t = d.tipos.find((x) => x.clave === clave);
      return `
        <section class="panel">
          <h2>${esc((t && (t.plural || t.etiqueta)) || clave)} <small>${lista.length}</small></h2>
          <div class="rejilla-unidades">${lista.map(tarjetaUnidad).join('')}</div>
        </section>`;
    }).join('') : `
      <div class="vacio">${d.unidades.length
        ? 'Ninguna unidad coincide con lo que buscas.'
        : 'Todavía no hay unidades. Se dan de alta en Configuración → Unidades.'}</div>`}`;

  vista.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.tipo === 'todas' ? '#/logistica/unidades' : `#/logistica/unidades/${b.dataset.tipo}`;
  }));
  const busca = document.getElementById('busca-unidad');
  busca.addEventListener('input', () => {
    estado.busquedaUnidades = busca.value;
    const pos = busca.selectionStart;
    vistaLogisticaUnidades(tipoPedido).then(() => {
      const otra = document.getElementById('busca-unidad');
      if (otra) { otra.focus(); otra.setSelectionRange(pos, pos); }
    });
  });
  cargarImagenesPendientes();
}

// --- los checklists de las unidades, dentro de Logística ---
//
// Es la misma pantalla de Checklists, pero aquí: la unidad es de Logística, y
// su inspección es parte de ella. Se agrupan por tipo, igual que las fichas, y
// al cerrar una el camino regresa aquí.

async function vistaLogisticaChecklists() {
  encabezado('Checklists de las unidades', 'La inspección que le toca a cada unidad');
  const [inicio, log] = await Promise.all([
    api('GET', '/api/inicio'),
    // Solo los nombres y tipos: a esta pantalla entra quien llena checklists,
    // que no necesariamente ve el resto de Logística.
    api('GET', '/api/logistica/unidades'),
  ]);

  // Las de unidad son las que apuntan a una unidad; las que no —insumos, avisos—
  // se quedan en el módulo de Checklists, que no es de Logística.
  const deUnidad = inicio.tarjetas.filter((t) => t.activo_id);
  const tipoDe = new Map(log.unidades.map((u) => [u.id, u]));
  const grupos = new Map();
  deUnidad.forEach((t, i) => {
    const u = tipoDe.get(t.activo_id) || {};
    const clave = u.tipo || 'otros';
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push({ ...t, indice: i });
  });

  const pendientes = deUnidad.filter((t) => t.estado === 'pendiente' && t.disponible).length;
  const enProceso = deUnidad.filter((t) => t.estado === 'borrador').length;
  // Un checklist de unidad sin unidades no tiene tarjeta: no hay a qué
  // llenárselo. Se enseña aparte para que no parezca que no se creó.
  const sinUnidades = (log.plantillas || []).filter((p) => !p.unidades);

  vista.innerHTML = `
    ${migajaLogistica('Checklists')}
    <div id="mensajes"></div>

    ${inicio.modo_pruebas && inicio.modo_pruebas.activo ? `
      <div class="aviso pendientes" style="cursor:default">
        <span><b>En pruebas no hay reglas de día.</b>
          <small>Los checklists de viernes se abren cualquier día. Lo que llenes aquí no cuenta.</small></span>
      </div>` : ''}

    <div class="cifras-almacen">
      <div class="cifra"><b>${deUnidad.length}</b><span>checklists de unidad</span></div>
      <div class="cifra ${pendientes ? 'alerta' : ''}"><b>${pendientes}</b><span>sin empezar</span></div>
      <div class="cifra"><b>${enProceso}</b><span>en proceso</span></div>
    </div>

    ${deUnidad.length ? [...grupos.entries()].map(([clave, lista]) => {
      const t = log.tipos.find((x) => x.clave === clave);
      return `
        <section class="panel">
          <h2>${esc((t && (t.plural || t.etiqueta)) || 'Otras unidades')} <small>${lista.length}</small></h2>
          ${rejillaTarjetas(lista)}
        </section>`;
    }).join('') : `
      <div class="vacio">
        Todavía no hay unidades con checklist. Se dan de alta en Configuración → Unidades.
      </div>`}

    ${sinUnidades.length ? `
      <section class="panel">
        <h2>Checklists que esperan unidades <small>${sinUnidades.length}</small></h2>
        <p class="explica">
          Estos checklists ya existen, pero no hay ninguna unidad de su tipo dada
          de alta, así que todavía no hay a qué llenárselos. Las unidades se
          agregan en Configuración → Unidades.
        </p>
        <table class="tabla">
          <thead><tr><th>Checklist</th><th>Se le llena a</th><th>Cada cuándo</th></tr></thead>
          <tbody>${sinUnidades.map((p) => {
            const t = log.tipos.find((x) => x.clave === p.aplica_a);
            return `
              <tr>
                <td class="fila-titulo">${esc(p.nombre)}</td>
                <td>${esc((t && t.plural) || (t && t.etiqueta) || p.aplica_a)}</td>
                <td>${esc(ETIQUETA_FRECUENCIA[p.frecuencia] || p.frecuencia)}</td>
              </tr>`;
          }).join('')}</tbody>
        </table>
        ${permiso('configuracion')
          ? '<div class="acciones"><button class="btn" data-ir-hash="#/config">Ir a Configuración → Unidades</button></div>'
          : ''}
      </section>` : ''}`;

  // Cada sección se pintó con su propia rejilla, así que el índice de una
  // tarjeta es el de su grupo: se conecta sección por sección.
  const todas = [...grupos.values()];
  vista.querySelectorAll('section.panel').forEach((seccion, i) => {
    const lista = todas[i] || [];
    seccion.querySelectorAll('[data-tarjeta]').forEach((boton) => {
      boton.addEventListener('click', () => {
        const t = lista[Number(boton.dataset.tarjeta)];
        if (!t) return;
        estado.regresoChecklist = '#/logistica/checklists';
        location.hash = `#/llenar/${t.plantilla_clave}${t.activo_id ? `/${t.activo_id}` : ''}`;
      });
    });
  });
  cargarImagenesPendientes();
}

// ============================ lo que regresa de una venta directa ============
//
// Lo levanta Calidad, no Almacén: es quien ve en qué estado volvió el material.
// Calidad dice por qué lo regresan y cuánto de cada producto llegó bien; de ahí
// pasa a Almacén, que pide la entrada, y otra persona la aprueba. Solo entonces
// se mueve el inventario, y solo con lo bueno.

async function vistaCalidadDevoluciones() {
  encabezado('Devolución de ventas directas', 'Material que devolvió un cliente');
  const d = await api('GET', '/api/calidad/devoluciones');

  const abiertas = d.devoluciones.filter((x) => x.estado === 'en_calidad');
  const pasaron = d.devoluciones.filter((x) => x.estado !== 'en_calidad');

  const tabla = (filas, vacio) => (filas.length ? `
    <div class="desliza"><table class="captura">
      <thead><tr><th class="fila-titulo">Folio</th><th>Venta</th><th>Cliente</th><th>Productos</th>
        <th>Fecha</th><th>Cómo va</th></tr></thead>
      <tbody>${filas.map((x) => `
        <tr>
          <td class="fila-titulo"><button class="btn" data-ir-hash="#/calidad/devolucion/${x.id}">${esc(x.folio)}</button></td>
          <td>${esc(x.orden_folio || '—')}</td>
          <td>${esc(x.quien || '—')}</td>
          <td>${x.productos}</td>
          <td>${esc(x.fecha)}</td>
          <td>${x.estado === 'en_calidad' ? '<span class="etiqueta ambar">por revisar</span>'
            : ['revisada', 'por_autorizar'].includes(x.estado) ? '<span class="etiqueta azul">con Almacén</span>'
            : x.estado === 'aplicada' ? '<span class="etiqueta verde">ya entró</span>'
            : `<span class="etiqueta">${esc(x.estado)}</span>`}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : `<div class="vacio">${vacio}</div>`);

  vista.innerHTML = `
    ${migajaModulo('Calidad', '#/calidad', 'Devolución de ventas directas')}
    <div id="mensajes"></div>
    ${d.puede_capturar ? `
      <div class="acciones"><button class="btn primario" id="nueva-dev">Levantar una devolución</button></div>` : ''}
    <section class="panel">
      <h2>Por revisar <span class="etiqueta ambar">${abiertas.length}</span></h2>
      ${tabla(abiertas, 'No hay material de ventas esperando revisión.')}
    </section>
    <section class="panel">
      <h2>Ya revisadas</h2>
      ${tabla(pasaron, 'Todavía no has revisado ninguna.')}
    </section>`;

  const nueva = document.getElementById('nueva-dev');
  if (nueva) nueva.addEventListener('click', () => modalDevolucionVenta(d));
}

function modalDevolucionVenta(d) {
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Devolución de una venta directa">
      <h2>Devolución de una venta directa</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>
        <div class="campo"><label for="dv-orden">¿De qué venta regresa?</label>
          <select id="dv-orden">${d.ordenes.map((o) => `
            <option value="${o.id}">${esc(o.folio)} · ${esc(o.cliente)}</option>`).join('')}</select></div>
        <div class="campo-par">
          <div class="campo"><label for="dv-bodega">¿A qué bodega llegó?</label>
            <select id="dv-bodega">${d.bodegas.map((b) => `
              <option value="${b.id}">${esc(b.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="dv-fecha">Fecha</label>
            <input type="date" id="dv-fecha" value="${hoyLocal()}"></div>
        </div>
        <div class="campo"><label for="dv-motivo">¿Por qué lo regresan?</label>
          <textarea id="dv-motivo" rows="2" placeholder="Llegó con la caja mojada, el cliente pidió otro modelo…"></textarea>
          <small class="nota-campo">Es lo que va a leer quien lo revise en un mes.</small>
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cerrar>Cancelar</button>
        <button class="btn primario" data-guardar>Levantarla</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/calidad/devoluciones', {
        vxf_id: Number(capa.querySelector('#dv-orden').value),
        bodega_id: Number(capa.querySelector('#dv-bodega').value),
        fecha: capa.querySelector('#dv-fecha').value,
        motivo: capa.querySelector('#dv-motivo').value,
      });
      cerrar();
      location.hash = `#/calidad/devolucion/${r.devolucion.id}`;
    } catch (err) { capa.querySelector('#error-modal').innerHTML = avisoError(err.message); }
  });
}

async function vistaCalidadDevolucion(id) {
  const { devolucion: d } = await api('GET', `/api/almacen/devoluciones/${id}`);
  encabezado(`Devolución ${d.folio}`, `${d.quien || ''}${d.orden ? ` · venta ${d.orden.folio}` : ''}`);
  const editable = d.estado === 'en_calidad' && permiso('calidad_capturar');

  vista.innerHTML = `
    ${migajaModulo('Calidad', '#/calidad', 'Devolución de ventas directas', '#/calidad/devoluciones', d.folio)}
    <div id="mensajes"></div>
    ${tiraConexiones([
      d.orden && liga(`#/ventas-fuera/orden/${d.orden.id}`, `Venta ${d.orden.folio} · ${d.orden.cliente}`),
      !editable && liga(`#/almacen/devolucion/${d.id}`, `Devolución ${d.folio} en Almacén`),
    ])}

    <section class="panel">
      <h2>Por qué lo regresan</h2>
      <div style="padding:0 18px 18px">
        <p style="margin:0">${esc(d.motivo || '—')}</p>
        <small style="color:var(--tinta-suave)">La levantó ${esc(d.capturo)} · llegó a ${esc(d.bodega)} el ${esc(d.fecha)}</small>
      </div>
    </section>

    <section class="panel">
      <h2>Qué regresó y cómo llegó</h2>
      <p class="explica">
        De cada producto: cuánto regresó y cuánto de eso llegó bien. Lo que no
        llegó bien no entra al inventario, y hay que decir qué tiene.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Producto</th><th>Regresó</th><th>Llegó bien</th><th>Qué tiene lo demás</th></tr></thead>
        <tbody>${d.renglones.map((r) => `
          <tr data-renglon="${r.id}">
            <td class="fila-titulo">${fotoProducto({ id: r.producto_id, sku: r.sku })}${esc(r.producto)}
              <br><small style="color:var(--tinta-suave)">${esc(r.sku)}</small></td>
            <td><input type="number" min="0" step="1" data-dev-cantidad value="${r.cantidad ?? 0}" ${editable ? '' : 'disabled'}></td>
            <td><input type="number" min="0" step="1" data-dev-buena value="${r.cantidad_buena ?? ''}" ${editable ? '' : 'disabled'}></td>
            <td><input data-dev-obs value="${esc(r.observacion || '')}" placeholder="Mojado, roto, modelo equivocado…" ${editable ? '' : 'disabled'}></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="pie"><span class="resumen">
        ${d.unidades} pieza(s) regresaron · <b>${d.unidades_buenas}</b> llegaron bien.
      </span></div>
    </section>

    ${zonaEvidencia('devolucion', d, editable)}

    ${editable ? `
      <div class="acciones">
        <button class="btn primario grande" id="dev-revisada">
          Terminar y pedir la entrada al inventario</button>
      </div>`
      : `<div class="aviso info"><span>
          ${d.revisado_en ? `Revisada por <b>${esc(d.reviso || '—')}</b>. ` : ''}
          ${d.estado === 'por_autorizar' ? 'La entrada ya está pedida: falta que Almacén la apruebe.'
            : d.estado === 'revisada' ? 'Falta pedir su entrada al inventario.'
            : d.estado === 'aplicada' ? 'Ya entró al inventario.' : ''}
        </span></div>`}`;

  if (editable) {
    const guardar = async (fila) => {
      try {
        await api('PUT', `/api/calidad/devolucion-renglones/${fila.dataset.renglon}`, {
          cantidad: fila.querySelector('[data-dev-cantidad]').value,
          cantidad_buena: fila.querySelector('[data-dev-buena]').value,
          observacion: fila.querySelector('[data-dev-obs]').value,
        });
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    };
    vista.querySelectorAll('[data-renglon]').forEach((fila) => {
      fila.querySelectorAll('input').forEach((campo) => campo.addEventListener('change', () => guardar(fila)));
    });
    document.getElementById('dev-revisada').addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/calidad/devoluciones/${d.id}/revisada`, {});
        mostrarMensaje(r.mensaje, 'exito');
        setTimeout(() => { location.hash = '#/calidad/devoluciones'; }, 900);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  }
  // La evidencia usa el mismo selector de fotos de Almacén: es el mismo
  // documento, visto desde Calidad.
  const camara = vista.querySelector('[data-camara-documento]');
  if (camara) {
    camara.addEventListener('click', () => {
      documentoDestinoFoto = { tipo: 'devolucion', id: d.id };
      selectorFotosAlmacen.click();
    });
  }
  vista.querySelectorAll('[data-quitar-foto]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('DELETE', `/api/almacen/fotos/${b.dataset.quitarFoto}`); enrutar(); }
      catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
  cargarImagenesPendientes();
}

// --- la ventana para anotar una carga de gasolina ---

function modalCarga(d, unidadId = null, alGuardar = null) {
  const unidades = d.unidades.filter((u) => u.activo && u.lleva_combustible);
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Carga de gasolina">
      <h2>Carga de gasolina</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>
        <div class="campo">
          <label for="ca-unidad">Unidad</label>
          <select id="ca-unidad">${unidades.map((u) => `
            <option value="${u.id}" ${u.id === unidadId ? 'selected' : ''}>${esc(u.nombre)}${
              u.kilometraje !== null ? ` · ${numero(u.kilometraje)} km` : ''}</option>`).join('')}</select>
        </div>
        <div class="campo-par">
          <div class="campo"><label for="ca-fecha">Fecha</label>
            <input type="date" id="ca-fecha" value="${esc(d.hoy)}" max="${esc(d.hoy)}"></div>
          <div class="campo"><label for="ca-km">Kilometraje</label>
            <input id="ca-km" inputmode="numeric" placeholder="del tablero"></div>
        </div>
        <div class="campo-par">
          <div class="campo"><label for="ca-litros">Litros</label>
            <input id="ca-litros" inputmode="decimal" placeholder="38.5"></div>
          <div class="campo"><label for="ca-costo">Lo que se pagó</label>
            <input id="ca-costo" inputmode="decimal" placeholder="950.00"></div>
        </div>
        <label class="casilla-texto"><input type="checkbox" id="ca-lleno" checked>
          Se llenó el tanque (si no, el rendimiento de esta carga no se cuenta)</label>
        <div class="campo-par">
          <div class="campo"><label for="ca-estacion">Gasolinera</label>
            <select id="ca-estacion">${selectDe(d.catalogos.estaciones)}</select></div>
          <div class="campo"><label for="ca-pago">Cómo se pagó</label>
            <select id="ca-pago">${selectDe(d.catalogos.formas_pago)}</select></div>
        </div>
        <div class="campo-par">
          <div class="campo"><label for="ca-ubicacion">Ubicación</label>
            <input id="ca-ubicacion" placeholder="Ej. Av. Central y Norte 45">
            <small class="nota-campo">Cuál de todas: «Pemex» hay en cada esquina.</small></div>
        </div>
        <div class="campo"><label for="ca-notas">Notas</label><input id="ca-notas"></div>
        <div class="campo">
          <label for="ca-ticket">Foto del ticket</label>
          <input type="file" id="ca-ticket" accept="image/*,application/pdf">
          <small class="nota-campo">Se puede cargar después, desde la unidad.</small>
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cerrar>Cancelar</button>
        <button class="btn primario" data-guardar>Guardar carga</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  const error = (m) => { capa.querySelector('#error-modal').innerHTML = avisoError(m); };
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);

  let forzar = false;
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    const cuerpo = {
      activo_id: Number(capa.querySelector('#ca-unidad').value),
      fecha: capa.querySelector('#ca-fecha').value,
      kilometraje: capa.querySelector('#ca-km').value,
      litros: capa.querySelector('#ca-litros').value,
      costo: capa.querySelector('#ca-costo').value,
      tanque_lleno: capa.querySelector('#ca-lleno').checked,
      estacion: capa.querySelector('#ca-estacion').value,
      ubicacion: capa.querySelector('#ca-ubicacion').value,
      forma_pago: capa.querySelector('#ca-pago').value,
      notas: capa.querySelector('#ca-notas').value,
      forzar,
    };
    try {
      const r = await api('POST', '/api/logistica/cargas', cuerpo);
      const archivo = capa.querySelector('#ca-ticket').files[0];
      if (archivo) {
        await api('POST', `/api/logistica/cargas/${r.id}/ticket`, { imagen: await leerComoDataURL(archivo) });
      }
      cerrar();
      mostrarMensaje('Carga anotada.', 'exito');
      if (alGuardar) alGuardar(); else vistaLogistica();
    } catch (err) {
      if (err.datos && err.datos.confirmar) forzar = true;
      error(err.message);
    }
  });
}

// --- la ventana para anotar un servicio ---

function modalServicio(d, unidadId = null, alGuardar = null) {
  const unidades = d.unidades.filter((u) => u.activo);
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Servicio">
      <h2>Servicio o mantenimiento</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>
        <div class="campo">
          <label for="se-unidad">Unidad</label>
          <select id="se-unidad">${unidades.map((u) => `
            <option value="${u.id}" ${u.id === unidadId ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>
        </div>
        <div class="campo-par">
          <div class="campo"><label for="se-tipo">Qué es</label>
            <select id="se-tipo">${selectDe(d.catalogos.tipos_servicio)}</select></div>
          <div class="campo"><label for="se-estado">Ya se hizo o está programado</label>
            <select id="se-estado">
              <option value="hecho">Ya se hizo</option>
              <option value="programado">Programado</option>
            </select></div>
        </div>
        <div class="campo-par">
          <div class="campo"><label for="se-fecha">Fecha</label>
            <input type="date" id="se-fecha" value="${esc(d.hoy)}"></div>
          <div class="campo"><label for="se-km">Kilometraje</label>
            <input id="se-km" inputmode="numeric"></div>
        </div>
        <div class="campo-par">
          <div class="campo"><label for="se-taller">Taller</label><input id="se-taller"></div>
          <div class="campo"><label for="se-costo">Costo</label><input id="se-costo" inputmode="decimal"></div>
        </div>
        <div class="campo"><label for="se-desc">Qué se le hizo</label>
          <textarea id="se-desc" rows="2" placeholder="Cambio de aceite y filtros, revisión de frenos…"></textarea></div>
        <h3 class="sub-modal">El próximo</h3>
        <div class="campo-par">
          <div class="campo"><label for="se-prox-km">A los kilómetros</label>
            <input id="se-prox-km" inputmode="numeric" placeholder="85000"></div>
          <div class="campo"><label for="se-prox-fecha">O en la fecha</label>
            <input type="date" id="se-prox-fecha"></div>
        </div>
        <small class="nota-campo">La plataforma avisa en Notificaciones cuando falten 500 km o 7 días.</small>
        <div class="campo">
          <label for="se-archivo">Factura o nota del taller</label>
          <input type="file" id="se-archivo" accept="image/*,application/pdf">
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cerrar>Cancelar</button>
        <button class="btn primario" data-guardar>Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  const error = (m) => { capa.querySelector('#error-modal').innerHTML = avisoError(m); };
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/logistica/servicios', {
        activo_id: Number(capa.querySelector('#se-unidad').value),
        tipo: capa.querySelector('#se-tipo').value,
        estado: capa.querySelector('#se-estado').value,
        fecha: capa.querySelector('#se-fecha').value,
        kilometraje: capa.querySelector('#se-km').value,
        taller: capa.querySelector('#se-taller').value,
        costo: capa.querySelector('#se-costo').value,
        descripcion: capa.querySelector('#se-desc').value,
        proximo_km: capa.querySelector('#se-prox-km').value,
        proxima_fecha: capa.querySelector('#se-prox-fecha').value,
      });
      const archivo = capa.querySelector('#se-archivo').files[0];
      if (archivo) {
        await api('POST', `/api/logistica/servicios/${r.id}/archivo`, { imagen: await leerComoDataURL(archivo) });
      }
      cerrar();
      mostrarMensaje('Servicio anotado.', 'exito');
      if (alGuardar) alGuardar(); else vistaLogistica();
    } catch (err) { error(err.message); }
  });
}

// --- la ventana para cargar un papel de la unidad ---

function modalDocumento(d, unidadId, alGuardar) {
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Documento de la unidad">
      <h2>Cargar un papel de la unidad</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>
        <div class="campo"><label for="do-tipo">Qué documento es</label>
          <select id="do-tipo">${selectDe(d.catalogos.tipos_documento)}</select></div>
        <div class="campo-par">
          <div class="campo"><label for="do-vence">Vence</label><input type="date" id="do-vence"></div>
          <div class="campo"><label for="do-nombre">Nombre o folio</label><input id="do-nombre"></div>
        </div>
        <div class="campo"><label for="do-archivo">Archivo (foto o PDF)</label>
          <input type="file" id="do-archivo" accept="image/*,application/pdf"></div>
        <div class="campo"><label for="do-notas">Notas</label><input id="do-notas"></div>
        <small class="nota-campo">Si tiene vencimiento, la plataforma avisa antes de que se venza.</small>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cerrar>Cancelar</button>
        <button class="btn primario" data-guardar>Cargar documento</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  const error = (m) => { capa.querySelector('#error-modal').innerHTML = avisoError(m); };
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    const archivo = capa.querySelector('#do-archivo').files[0];
    if (!archivo) return error('Escoge el archivo del documento.');
    try {
      await api('POST', '/api/logistica/documentos', {
        activo_id: unidadId,
        tipo: capa.querySelector('#do-tipo').value,
        vence: capa.querySelector('#do-vence').value,
        nombre: capa.querySelector('#do-nombre').value,
        notas: capa.querySelector('#do-notas').value,
        archivo: await leerComoDataURL(archivo),
      });
      cerrar();
      mostrarMensaje('Documento cargado.', 'exito');
      if (alGuardar) alGuardar();
    } catch (err) { error(err.message); }
  });
}

// --- la ficha de una unidad ---

const PARTES_UNIDAD = [
  { clave: 'papeles', etiqueta: 'Papeles' },
  { clave: 'gasolina', etiqueta: 'Gasolina' },
  { clave: 'servicios', etiqueta: 'Servicios' },
  { clave: 'checklists', etiqueta: 'Checklists' },
];

async function vistaLogisticaUnidad(id, parte) {
  const d = await api('GET', `/api/logistica/unidades/${id}`);
  const u = d.unidad;
  const actual = PARTES_UNIDAD.find((p) => p.clave === parte) || PARTES_UNIDAD[0];
  encabezado(u.nombre, `${u.etiqueta_tipo}${u.kilometraje !== null ? ` · ${numero(u.kilometraje)} km` : ''}`);

  const papeles = () => (d.vigencias.length ? `
    <table class="tabla">
      <thead><tr><th>Documento</th><th>Vence</th><th>Cómo va</th><th>De dónde sale</th></tr></thead>
      <tbody>${d.vigencias.map((v) => `
        <tr>
          <td class="fila-titulo">${esc(v.concepto)}</td>
          <td>${esc(v.vence || '—')}</td>
          <td><span class="etiqueta ${ETIQUETA_VIGENCIA[v.estado] || ''}">${esc(v.texto)}</span></td>
          <td>${v.origen === 'documento' ? 'su documento cargado' : 'el checklist'}${
            v.quien ? ` · ${esc(v.quien)}` : ''}</td>
        </tr>`).join('')}</tbody>
    </table>
    ${d.documentos.length ? `
      <h3 class="sub-panel">Archivos cargados</h3>
      <table class="tabla">
        <thead><tr><th>Documento</th><th>Vence</th><th>Lo subió</th><th></th></tr></thead>
        <tbody>${d.documentos.map((x) => `
          <tr>
            <td class="fila-titulo">${esc(x.tipo)}${x.nombre ? ` · ${esc(x.nombre)}` : ''}</td>
            <td>${esc(x.vence || '—')}</td>
            <td>${esc(x.subio || '—')}</td>
            <td><button class="btn" data-ver-archivo="${esc(x.archivo)}">Ver</button>${
              d.puede.corregir ? `<button class="btn peligro" data-quitar-doc="${x.id}">Quitar</button>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table>` : ''}`
    : '<div class="vacio">Esta unidad todavía no tiene papeles capturados.</div>');

  const gasolina = () => (!u.lleva_combustible
    ? '<div class="vacio">Este tipo de unidad no carga combustible.</div>'
    : (d.cargas.length ? `
      <table class="tabla">
        <thead><tr><th>Fecha</th><th>Litros</th><th>Costo</th><th>$/L</th><th>Kilometraje</th>
          <th>Km recorridos</th><th>Rendimiento</th><th>Ticket</th></tr></thead>
        <tbody>${d.cargas.map((c) => `
          <tr>
            <td class="fila-titulo">${esc(c.fecha)}${c.tanque_lleno ? '' : ' <span class="etiqueta">parcial</span>'}</td>
            <td>${c.litros}</td>
            <td>${pesos(c.costo)}</td>
            <td>${pesos(c.precio_litro)}</td>
            <td>${c.kilometraje ? numero(c.kilometraje) : '—'}</td>
            <td>${c.kilometros ? numero(c.kilometros) : '—'}</td>
            <td><b>${c.rendimiento ? `${c.rendimiento} km/L` : '—'}</b></td>
            <td>${c.ticket ? `<button class="btn" data-ver-archivo="${esc(c.ticket)}">Ver</button>`
              : (d.puede.cargas ? `<button class="btn" data-subir-ticket="${c.id}">Subir</button>` : '—')}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="vacio">Sin cargas anotadas.</div>'));

  const servicios = () => (d.servicios.length ? `
    <table class="tabla">
      <thead><tr><th>Qué</th><th>Fecha</th><th>Kilometraje</th><th>Taller</th><th>Costo</th>
        <th>El próximo</th><th></th></tr></thead>
      <tbody>${d.servicios.map((x) => `
        <tr>
          <td class="fila-titulo">${esc(x.tipo)}${x.estado === 'programado' ? ' <span class="etiqueta ambar">programado</span>' : ''}
            ${x.descripcion ? `<br><small style="color:var(--tinta-suave)">${esc(x.descripcion)}</small>` : ''}</td>
          <td>${esc(x.fecha || '—')}</td>
          <td>${x.kilometraje ? numero(x.kilometraje) : '—'}</td>
          <td>${esc(x.taller || '—')}</td>
          <td>${pesos(x.costo)}</td>
          <td>${[x.proximo_km ? `${numero(x.proximo_km)} km` : '', x.proxima_fecha || '']
            .filter(Boolean).join(' o ') || '—'}</td>
          <td>${x.archivo ? `<button class="btn" data-ver-archivo="${esc(x.archivo)}">Ver</button>` : ''}
            ${x.estado === 'programado' && d.puede.servicios
              ? `<button class="btn" data-cumplido="${x.id}">Ya se hizo</button>` : ''}</td>
        </tr>`).join('')}</tbody>
    </table>` : '<div class="vacio">Sin servicios anotados.</div>');

  const checklists = () => (d.checklists.length ? `
    <table class="tabla">
      <thead><tr><th>Checklist</th><th>Periodo</th><th>Lo llenó</th><th>Problemas</th><th>Cómo va</th></tr></thead>
      <tbody>${d.checklists.map((c) => `
        <tr>
          <td class="fila-titulo">${esc(c.checklist)}</td>
          <td>${esc(c.periodo)}</td>
          <td>${esc(c.lleno)}</td>
          <td>${c.problemas ? `<span class="etiqueta ambar">${c.problemas}</span>` : '—'}</td>
          <td>${c.estado === 'cerrado'
            ? (c.revision === 'aprobado' ? '<span class="etiqueta verde">aprobado</span>'
              : '<span class="etiqueta ambar">esperando revisión</span>')
            : '<span class="etiqueta">en captura</span>'}
            <button class="btn" data-ir-hash="#/detalle/${c.id}">Ver</button></td>
        </tr>`).join('')}</tbody>
    </table>` : '<div class="vacio">Esta unidad todavía no tiene checklists.</div>');

  vista.innerHTML = `
    ${migajaLogistica(u.nombre)}
    <div id="mensajes"></div>

    <div class="cifras-almacen">
      ${u.lleva_kilometraje ? `
        <div class="cifra"><b>${u.kilometraje !== null ? numero(u.kilometraje) : '—'}</b>
          <span>kilómetros${u.kilometraje_en ? ` · al ${u.kilometraje_en}` : ''}</span></div>` : ''}
      ${u.lleva_combustible ? `
        <div class="cifra"><b>${u.rendimiento ? `${u.rendimiento}` : '—'}</b><span>km por litro</span></div>` : ''}
      <div class="cifra ${u.papeles.vencidos ? 'alerta' : ''}">
        <b>${u.papeles.vencidos}</b><span>papeles vencidos</span></div>
      <div class="cifra ${u.proximo_servicio && u.proximo_servicio.urge ? 'alerta' : ''}">
        <b>${u.proximo_servicio ? '1' : '0'}</b>
        <span>${u.proximo_servicio ? `servicio ${esc(u.proximo_servicio.texto)}` : 'sin servicio programado'}</span></div>
    </div>

    <div class="acciones">
      ${d.puede.cargas && u.lleva_combustible ? '<button class="btn" id="u-carga">Anotar carga de gasolina</button>' : ''}
      ${d.puede.servicios ? '<button class="btn" id="u-servicio">Anotar servicio</button>' : ''}
      ${d.puede.documentos ? '<button class="btn" id="u-documento">Cargar un papel</button>' : ''}
      <button class="btn" data-ir-hash="#/logistica/checklists">Checklists de las unidades</button>
    </div>

    <div class="pestanas" role="tablist">
      ${PARTES_UNIDAD.map((p) => `
        <button role="tab" aria-selected="${p.clave === actual.clave}" data-parte="${p.clave}">${p.etiqueta}</button>`).join('')}
    </div>

    <section class="panel">
      ${actual.clave === 'papeles' ? papeles()
        : actual.clave === 'gasolina' ? gasolina()
        : actual.clave === 'servicios' ? servicios() : checklists()}
    </section>`;

  vista.querySelectorAll('[data-parte]').forEach((b) => b.addEventListener('click', () => {
    location.hash = `#/logistica/unidad/${id}/${b.dataset.parte}`;
  }));
  const recargar = () => vistaLogisticaUnidad(id, actual.clave);
  const cat = { unidades: [{ ...u, activo: true }], catalogos: d.catalogos, hoy: d.hoy, puede: d.puede };
  const bCarga = document.getElementById('u-carga');
  if (bCarga) bCarga.addEventListener('click', () => modalCarga(cat, Number(id), recargar));
  const bServicio = document.getElementById('u-servicio');
  if (bServicio) bServicio.addEventListener('click', () => modalServicio(cat, Number(id), recargar));
  const bDoc = document.getElementById('u-documento');
  if (bDoc) bDoc.addEventListener('click', () => modalDocumento(cat, Number(id), recargar));

  vista.querySelectorAll('[data-ver-archivo]').forEach((b) => b.addEventListener('click', () => {
    abrirArchivoProtegido(b.dataset.verArchivo);
  }));
  vista.querySelectorAll('[data-quitar-doc]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Quitar este documento de la lista? El archivo se conserva.')) return;
    try {
      await api('DELETE', `/api/logistica/documentos/${b.dataset.quitarDoc}`);
      recargar();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
  vista.querySelectorAll('[data-cumplido]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('POST', `/api/logistica/servicios/${b.dataset.cumplido}/cumplido`, {});
      mostrarMensaje('Servicio marcado como hecho.', 'exito');
      recargar();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
  vista.querySelectorAll('[data-subir-ticket]').forEach((b) => b.addEventListener('click', () => {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = 'image/*,application/pdf';
    entrada.addEventListener('change', async () => {
      const f = entrada.files[0];
      if (!f) return;
      try {
        await api('POST', `/api/logistica/cargas/${b.dataset.subirTicket}/ticket`, { imagen: await leerComoDataURL(f) });
        mostrarMensaje('Ticket guardado.', 'exito');
        recargar();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
    entrada.click();
  }));
}

// Los archivos van protegidos por sesión: se piden con el token y se abren en
// una pestaña nueva como blob local.
async function abrirArchivoProtegido(archivo) {
  try {
    const res = await fetch(`/api/fotos/${archivo}`, { headers: { Authorization: `Bearer ${estado.token}` } });
    if (!res.ok) throw new Error('No se pudo abrir el archivo.');
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) { mostrarMensaje(err.message, 'error'); }
}

// --- todas las cargas y todos los servicios ---

// Las cargas de gasolina viven todas aquí: anotar una y ver las que ya están,
// con lo que hace falta para rastrear un consumo raro —dónde se cargó, quién la
// anotó y su ticket—. Antes la de anotar colgaba de la portada y la lista de
// otro lado: dos puertas a lo mismo.
async function vistaLogisticaCargas() {
  encabezado('Cargas de gasolina', 'Litros, costo, rendimiento y dónde se cargó');
  const unidadFiltro = estado.filtroCargasUnidad || '';
  const [d, lista] = await Promise.all([
    api('GET', '/api/logistica'),
    api('GET', `/api/logistica/cargas${unidadFiltro ? `?unidad=${unidadFiltro}` : ''}`),
  ]);
  const unidad = (id) => (d.unidades.find((u) => u.id === id) || {}).nombre || '—';
  const conCargas = d.unidades.filter((u) => u.activo);
  const litros = lista.cargas.reduce((n, c) => n + (c.litros || 0), 0);
  const gasto = lista.cargas.reduce((n, c) => n + (c.costo || 0), 0);

  vista.innerHTML = `
    ${migajaLogistica('Cargas de gasolina')}
    <div id="mensajes"></div>

    <div class="filtros">
      <label>Unidad
        <select id="fc-unidad">
          <option value="">Todas</option>
          ${conCargas.map((u) => `
            <option value="${u.id}" ${String(u.id) === String(unidadFiltro) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
        </select>
      </label>
      ${d.puede.cargas ? '<button class="btn primario" id="nueva-carga">+ Anotar una carga</button>' : ''}
    </div>

    <div class="cifras-almacen">
      <div class="cifra"><b>${lista.cargas.length}</b><span>carga(s)</span></div>
      <div class="cifra"><b>${Math.round(litros * 10) / 10}</b><span>litros</span></div>
      <div class="cifra"><b>${pesos(gasto)}</b><span>en total</span></div>
    </div>

    <section class="panel">
      <h2>${unidadFiltro ? esc(unidad(Number(unidadFiltro))) : 'Todas las unidades'}</h2>
      ${lista.cargas.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Fecha</th><th>Unidad</th><th>Litros</th><th>Pagado</th>
            <th>Kilometraje</th><th>Rendimiento</th><th>Gasolinera</th><th>Cómo se pagó</th>
            <th>Lo anotó</th><th>Ticket</th></tr></thead>
          <tbody>${lista.cargas.map((c) => `
            <tr>
              <td class="fila-titulo">${esc(c.fecha)}<br><small style="color:var(--tinta-suave)">${esc(c.folio)}</small></td>
              <td><button class="btn" data-ir-hash="#/logistica/unidad/${c.activo_id}/gasolina">${esc(unidad(c.activo_id))}</button></td>
              <td>${c.litros}${c.tanque_lleno ? '' : '<br><small style="color:var(--tinta-suave)">tanque parcial</small>'}</td>
              <td>${pesos(c.costo)}${c.precio_litro ? `<br><small style="color:var(--tinta-suave)">${pesos(c.precio_litro)}/L</small>` : ''}</td>
              <td>${c.kilometraje ? numero(c.kilometraje) : '—'}</td>
              <td>${c.rendimiento ? `${c.rendimiento} km/L` : '<small style="color:var(--tinta-suave)">—</small>'}</td>
              <td>${esc(c.estacion || '—')}${c.ubicacion ? `<br><small style="color:var(--tinta-suave)">${esc(c.ubicacion)}</small>` : ''}</td>
              <td><small>${esc(c.forma_pago || '—')}</small></td>
              <td><small>${esc(c.quien || '—')}</small></td>
              <td>${c.ticket
    ? `<button class="btn" data-ver-ticket="${esc(c.ticket)}">Ver</button>`
    : '<small style="color:var(--tinta-suave)">sin ticket</small>'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        <p class="explica">
          El <b>rendimiento</b> solo se calcula entre dos cargas de tanque lleno: de una
          carga parcial no se sabe cuánto quedaba en el tanque.
        </p>`
    : '<div class="vacio">Todavía no hay cargas anotadas de esta unidad.</div>'}
    </section>`;

  document.getElementById('fc-unidad').addEventListener('change', (e) => {
    estado.filtroCargasUnidad = e.target.value;
    vistaLogisticaCargas();
  });
  const b = document.getElementById('nueva-carga');
  if (b) {
    b.addEventListener('click', () => modalCarga(d, Number(unidadFiltro) || null, vistaLogisticaCargas));
  }
  vista.querySelectorAll('[data-ver-ticket]').forEach((x) => {
    x.addEventListener('click', () => abrirArchivoProtegido(x.dataset.verTicket));
  });
}

// Todo lo de servicios en una pantalla: lo que ya se le hizo a cada unidad, lo
// que está programado y el botón para anotar uno nuevo. Con filtro por unidad,
// que es como se pregunta en el piso: «¿a la ISUZU qué le toca?».
async function vistaLogisticaServicios() {
  encabezado('Servicios y mantenimientos', 'Lo hecho, lo programado y lo que ya toca');
  const unidadFiltro = estado.filtroServiciosUnidad || '';
  const [d, lista] = await Promise.all([
    api('GET', '/api/logistica'),
    api('GET', '/api/logistica/servicios'),
  ]);
  const suyos = lista.servicios.filter((x) => !unidadFiltro || String(x.activo_id) === String(unidadFiltro));
  const programados = suyos.filter((x) => x.estado === 'programado');
  const hechos = suyos.filter((x) => x.estado !== 'programado');
  const gasto = hechos.reduce((n, x) => n + (x.costo || 0), 0);

  const tabla = (filas, conAccion) => `
    <div class="desliza"><table class="captura">
      <thead><tr><th class="fila-titulo">Unidad</th><th>Qué se hizo</th><th>Fecha</th>
        <th>Kilometraje</th><th>Taller</th><th>Costo</th><th>El próximo</th>
        ${conAccion ? '<th></th>' : '<th>Factura</th>'}</tr></thead>
      <tbody>${filas.map((x) => `
        <tr>
          <td class="fila-titulo">${esc(x.unidad)}<br><small style="color:var(--tinta-suave)">${esc(x.folio)}</small></td>
          <td>${esc(x.tipo)}${x.descripcion ? `<br><small style="color:var(--tinta-suave)">${esc(x.descripcion)}</small>` : ''}</td>
          <td>${esc(x.fecha || x.proxima_fecha || '—')}</td>
          <td>${x.kilometraje ? numero(x.kilometraje) : '—'}</td>
          <td><small>${esc(x.taller || '—')}</small></td>
          <td>${pesos(x.costo)}</td>
          <td>${[x.proximo_km ? `${numero(x.proximo_km)} km` : '', x.proxima_fecha || ''].filter(Boolean).join(' o ') || '—'}</td>
          ${conAccion
    ? `<td>${d.puede.servicios ? `<button class="btn" data-cumplido="${x.id}">Ya se hizo</button>` : ''}</td>`
    : `<td>${x.archivo
      ? `<button class="btn" data-ver-factura="${esc(x.archivo)}">Ver</button>`
      : '<small style="color:var(--tinta-suave)">sin factura</small>'}</td>`}
        </tr>`).join('')}</tbody>
    </table></div>`;

  vista.innerHTML = `
    ${migajaLogistica('Servicios')}
    <div id="mensajes"></div>

    <div class="filtros">
      <label>Unidad
        <select id="fs-unidad">
          <option value="">Todas</option>
          ${d.unidades.filter((u) => u.activo).map((u) => `
            <option value="${u.id}" ${String(u.id) === String(unidadFiltro) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
        </select>
      </label>
      ${d.puede.servicios ? '<button class="btn primario" id="nuevo-servicio">+ Anotar un servicio</button>' : ''}
    </div>

    <div class="cifras-almacen">
      <div class="cifra"><b>${hechos.length}</b><span>servicio(s) hechos</span></div>
      <div class="cifra ${programados.length ? 'alerta' : ''}">
        <b>${programados.length}</b><span>programados</span></div>
      <div class="cifra"><b>${pesos(gasto)}</b><span>gastado</span></div>
    </div>

    <section class="panel ${programados.length ? 'peligroso' : ''}">
      <h2>Programados <span class="etiqueta ${programados.length ? 'ambar' : 'verde'}">${programados.length}</span></h2>
      <p class="explica">
        Lo que ya tiene fecha o kilometraje puesto. La plataforma avisa en Notificaciones
        cuando falten 500 km o 7 días; al hacerlo, se marca aquí con <b>Ya se hizo</b>.
      </p>
      ${programados.length ? tabla(programados, true) : '<div class="vacio">Nada programado.</div>'}
    </section>

    <section class="panel">
      <h2>Lo que ya se hizo <span class="etiqueta azul">${hechos.length}</span></h2>
      ${hechos.length ? tabla(hechos, false) : '<div class="vacio">Todavía no hay servicios anotados.</div>'}
    </section>`;

  document.getElementById('fs-unidad').addEventListener('change', (e) => {
    estado.filtroServiciosUnidad = e.target.value;
    vistaLogisticaServicios();
  });
  const nuevo = document.getElementById('nuevo-servicio');
  if (nuevo) {
    nuevo.addEventListener('click', () => modalServicio(d, Number(unidadFiltro) || null, vistaLogisticaServicios));
  }
  vista.querySelectorAll('[data-cumplido]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('POST', `/api/logistica/servicios/${b.dataset.cumplido}/cumplido`, {});
      mostrarMensaje('Servicio marcado como hecho.', 'exito');
      vistaLogisticaServicios();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  }));
  vista.querySelectorAll('[data-ver-factura]').forEach((b) => {
    b.addEventListener('click', () => abrirArchivoProtegido(b.dataset.verFactura));
  });
}

// ============================================================ ruta de entrega
//
// El recorrido del día, en orden. Arriba lo que ya está planeado; abajo, lo que
// está listo para subir: las órdenes de venta directa que salen ese día y las
// citas de la ODT. Se arma el día anterior o en el momento.

const CLASE_PARADA = { cedis: 'azul', cliente: 'verde', paqueteria: 'ambar', otro: '' };

// Las paradas se nombran con letras —A, B, C— porque así se dicen en el patio:
// «de la B te sigues a la C». Pasada la Z se numera: A2, B2…
const LETRA_PARADA = (i) => (i < 26
  ? String.fromCharCode(65 + i)
  : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`);

// EL RECORRIDO EN EL MAPA.
//
// La plataforma dibuja el trazo con sus propios medios —se ve igual sin
// internet, que es la regla— y el mapa de verdad se abre en un toque, en la
// aplicación de mapas del teléfono, con el almacén como punto de partida y las
// paradas como escalas en el orden planeado. Ahí es donde hay calles, tráfico y
// navegación de voz; la plataforma no las copia a medias.
const dirMaps = (t) => encodeURIComponent(String(t).trim());

// Google Maps acepta nueve escalas en un enlace. Con más paradas se abre el
// recorrido hasta la novena y la pantalla lo dice, para que nadie crea que la
// ruta se recortó.
const TOPE_ESCALAS = 9;

function mapaDeLaRuta(paradas, partida) {
  const conDir = paradas.filter((p) => p.direccion);
  if (!conDir.length) return null;
  const escalas = conDir.slice(0, -1).slice(0, TOPE_ESCALAS).map((p) => dirMaps(p.direccion));
  return {
    url: 'https://www.google.com/maps/dir/?api=1&travelmode=driving'
      + (partida ? `&origin=${dirMaps(partida)}` : '')
      + `&destination=${dirMaps(conDir[conDir.length - 1].direccion)}`
      + (escalas.length ? `&waypoints=${escalas.join('%7C')}` : ''),
    con: conDir.length,
    sin: paradas.length - conDir.length,
    recortadas: Math.max(0, conDir.length - 1 - TOPE_ESCALAS),
  };
}

const unaEnMaps = (dir) => `https://www.google.com/maps/search/?api=1&query=${dirMaps(dir)}`;

// El trazo, dibujado por la plataforma. Se redibuja solo cada vez que se sube,
// se mueve o se marca una parada.
function tiraDeRuta(r, partida) {
  const mapa = mapaDeLaRuta(r.paradas, partida);
  const punto = (clase, letra, titulo, pie, extra) => `
    <div class="punto-ruta ${clase}">
      <span class="pin-ruta">${esc(letra)}</span>
      <b>${esc(titulo)}</b>
      <small>${pie ? esc(pie) : '<i>sin dirección</i>'}</small>
      ${extra || ''}
    </div>`;

  return `
    <div class="tira-ruta" role="list" aria-label="Trazo del recorrido">
      ${partida ? punto('partida', '⌂', 'Almacén', partida) : punto('partida sin-dir', '⌂', 'Almacén', '')}
      ${r.paradas.map((p, i) => `
        <span class="flecha-ruta" aria-hidden="true">→</span>
        ${punto(`${CLASE_PARADA[p.tipo] || ''} ${p.estado}`, LETRA_PARADA(i), p.etiqueta, p.direccion,
    `<span class="etiqueta ${CLASE_PARADA[p.tipo] || ''}">${esc(p.tipo_etiqueta)}</span>`)}`).join('')}
    </div>
    <div class="fila-botones" style="padding:0 18px 14px">
      ${mapa ? `<a class="btn primario" href="${mapa.url}" target="_blank" rel="noopener">
        Ver el recorrido en el mapa</a>` : ''}
      <span class="explica" style="padding:0">
        ${!r.paradas.length ? 'Súbele paradas y el trazo se dibuja aquí.'
    : mapa ? `${mapa.con} de ${r.paradas.length} parada(s) con dirección.
            ${mapa.sin ? `A ${mapa.sin} le falta: ponla con el botón «Dirección» de su renglón, o de una vez en la ficha del cliente.` : ''}
            ${mapa.recortadas ? `El mapa abre las primeras ${TOPE_ESCALAS + 1}; las otras ${mapa.recortadas} se abren una por una.` : ''}`
      : 'Ninguna parada tiene dirección todavía: el trazo se ve, pero el mapa no puede abrirse.'}
      </span>
    </div>`;
}

async function vistaLogisticaRutas(fechaPedida) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaPedida || '') ? fechaPedida
    : (estado.fechaRuta || new Date().toISOString().slice(0, 10));
  estado.fechaRuta = fecha;
  encabezado('Ruta para entrega', 'En qué orden se entrega, y qué lleva cada parada');
  const d = await api('GET', `/api/logistica/rutas?fecha=${fecha}`);

  const parada = (r, p, i, total) => `
    <tr class="${p.estado === 'no_entregada' ? 'vigencia-vencida' : ''}">
      <td class="fila-titulo">${LETRA_PARADA(i)}</td>
      <td><span class="etiqueta ${CLASE_PARADA[p.tipo] || ''}">${esc(p.tipo_etiqueta)}</span></td>
      <td>${esc(p.etiqueta)}${p.detalle ? `<br><small style="color:var(--tinta-suave)">${esc(p.detalle)}</small>` : ''}
        ${p.direccion ? `<br><small>📍 <a href="${unaEnMaps(p.direccion)}" target="_blank" rel="noopener">${esc(p.direccion)}</a>${
  p.direccion_propia ? ' <span class="etiqueta">solo hoy</span>' : ''}</small>`
    : '<br><small style="color:var(--tinta-suave)"><i>sin dirección</i></small>'}
        ${p.nota ? `<br><small style="color:var(--tinta-suave)">«${esc(p.nota)}»</small>` : ''}</td>
      <td>${p.estado === 'entregada' ? '<span class="etiqueta verde">Entregada</span>'
    : p.estado === 'no_entregada' ? '<span class="etiqueta roja">No se entregó</span>'
      : '<span class="etiqueta">Pendiente</span>'}
        ${p.marco ? `<br><small style="color:var(--tinta-suave)">${esc(p.marco)}</small>` : ''}</td>
      <td class="fila-botones">
        ${d.puede.planear && r.estado !== 'cerrada' ? `
          ${p.estado === 'pendiente' ? `
            <button class="btn" data-entregada="${p.id}">Entregada</button>
            <button class="btn" data-fallo="${p.id}">No se entregó</button>` : `
            <button class="btn" data-pendiente="${p.id}">Deshacer</button>`}
          <button class="btn" data-mover-parada="${p.id}|arriba" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
          <button class="btn" data-mover-parada="${p.id}|abajo" ${i === total - 1 ? 'disabled' : ''} title="Bajar">↓</button>
          <button class="btn" data-direccion-parada="${p.id}">Dirección</button>
          <button class="btn peligro" data-quitar-parada="${p.id}">Quitar</button>` : ''}
      </td>
    </tr>`;

  const tarjetaRuta = (r) => `
    <section class="panel ${r.estado === 'cerrada' ? '' : 'peligroso'}">
      <h2>${esc(r.folio)}
        <span class="etiqueta ${r.estado === 'cerrada' ? 'verde' : r.estado === 'en_ruta' ? 'azul' : 'ambar'}">
          ${r.estado === 'en_ruta' ? 'En ruta' : r.estado === 'cerrada' ? 'Cerrada' : 'Planeada'}</span>
        <span class="etiqueta">${r.paradas.length} parada(s)</span>
        ${r.pendientes ? `<span class="etiqueta ambar">${r.pendientes} por entregar</span>` : ''}
      </h2>
      <div class="filtros" style="margin:0 18px 12px">
        <label>Unidad
          <select data-unidad-ruta="${r.id}" ${d.puede.planear ? '' : 'disabled'}>
            <option value="">Sin asignar</option>
            ${d.unidades.map((u) => `
              <option value="${u.id}" ${u.id === r.activo_id ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Salida de unidad
          <select data-salida-ruta="${r.id}" ${d.puede.planear ? '' : 'disabled'}>
            <option value="">Sin enganchar</option>
            ${(d.salidas || []).map((s) => `
              <option value="${s.id}" ${s.id === r.llenado_id ? 'selected' : ''}>${
  esc([s.referencia || `Formato ${s.id}`, s.unidad, s.operador].filter(Boolean).join(' · '))}</option>`).join('')}
          </select>
        </label>
        ${d.puede.planear ? `
          ${r.estado === 'planeada' ? `<button class="btn" data-estado-ruta="${r.id}|en_ruta">Salió a ruta</button>` : ''}
          ${r.estado === 'en_ruta' ? `<button class="btn primario" data-estado-ruta="${r.id}|cerrada">Cerrar la ruta</button>` : ''}
          ${r.estado !== 'cerrada' ? `<button class="btn peligro" data-estado-ruta="${r.id}|cancelada">Cancelar</button>` : ''}` : ''}
        ${r.salida_referencia ? `<span class="etiqueta azul">Salida ${esc(r.salida_referencia)}</span>` : ''}
      </div>
      ${tiraDeRuta(r, d.partida)}
      ${r.paradas.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">#</th><th>Qué es</th><th>A dónde</th><th>Cómo va</th><th></th></tr></thead>
          <tbody>${r.paradas.map((p, i) => parada(r, p, i, r.paradas.length)).join('')}</tbody>
        </table></div>`
    : '<div class="vacio">Sin paradas todavía. Súbele lo que se va a entregar, de la lista de abajo.</div>'}
      ${d.puede.planear && r.estado !== 'cerrada' ? `
        <div class="bloque-form">
          <h3>Agregar una parada a mano</h3>
          <div class="campo-par">
            <div class="campo"><label for="pa-tipo-${r.id}">Qué es</label>
              <select id="pa-tipo-${r.id}">${d.tipos.map((t) => `
                <option value="${esc(t.clave)}">${esc(t.etiqueta)}</option>`).join('')}</select></div>
            <div class="campo"><label for="pa-etiqueta-${r.id}">A dónde</label>
              <input id="pa-etiqueta-${r.id}" placeholder="Nombre del cliente, sucursal, paquetería…"></div>
          </div>
          <div class="campo-par">
            <div class="campo"><label for="pa-direccion-${r.id}">Dirección</label>
              <input id="pa-direccion-${r.id}" placeholder="Calle y número, colonia, ciudad"></div>
            <div class="campo"><label for="pa-detalle-${r.id}">Detalle</label>
              <input id="pa-detalle-${r.id}" placeholder="Horario, con quién, alguna referencia"></div>
          </div>
          <button class="btn" data-agregar-parada="${r.id}">Agregar parada</button>
        </div>` : ''}
    </section>`;

  const candidatos = (r) => `
    <section class="panel">
      <h2>Listo para subir a la ruta
        <span class="etiqueta azul">${d.candidatos.ventas.length + d.candidatos.citas.length}</span></h2>
      <p class="explica">
        Las <b>órdenes de venta directa</b> ya armadas —con su fecha de salida, o sin ella— y
        las <b>citas de la ODT</b> cercanas. Al subir una, la plataforma ya sabe si va a
        paquetería o a entrega directa, y a qué CEDIS. La ruta se arma aquí y arriba se dice
        <b>qué salida de unidad la lleva</b>: el formato de asignación no se usa para planear,
        solo enseña la ruta que ya le tocó.
      </p>
      ${d.candidatos.ventas.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Orden</th><th>Cliente</th><th>Cómo se entrega</th>
            <th>Unidades</th><th>Sale del almacén</th><th></th></tr></thead>
          <tbody>${d.candidatos.ventas.map((o) => `
            <tr>
              <td class="fila-titulo">${esc(o.folio)}</td>
              <td>${esc(o.cliente || '—')}</td>
              <td><span class="etiqueta ${o.entrega === 'guia' ? 'ambar' : 'verde'}">${
  o.entrega === 'guia' ? 'Paquetería' : 'Entrega directa'}</span></td>
              <td>${numero(o.unidades)}</td>
              <td>${esc(o.fecha_salida || '—')}</td>
              <td>${r ? `<button class="btn" data-subir-venta="${r.id}|${o.id}">Subir a ${esc(r.folio)}</button>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="vacio">Ninguna orden de venta directa lista.</div>'}
      ${d.candidatos.citas.length ? `
        <h3 class="sub-modal" style="padding:0 18px">Citas de la ODT</h3>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Envío</th><th>CEDIS</th><th>Fecha</th><th>Cuenta</th><th></th></tr></thead>
          <tbody>${d.candidatos.citas.map((c) => `
            <tr>
              <td class="fila-titulo">${esc(c.folio || c.etiqueta || 'Cita')}</td>
              <td>${esc(c.cedis)}</td>
              <td>${esc(c.fecha || '—')}</td>
              <td><small>${esc(c.cuenta || '—')}</small></td>
              <td>${r ? `<button class="btn" data-subir-cita="${r.id}|${c.id}">Subir a ${esc(r.folio)}</button>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${!r ? '<p class="explica">Crea la ruta del día para poder subirle estas entregas.</p>' : ''}
    </section>`;

  const laDelDia = d.rutas.find((r) => r.estado !== 'cerrada') || d.rutas[0] || null;

  vista.innerHTML = `
    ${migajaLogistica('Ruta para entrega')}
    <div id="mensajes"></div>

    <div class="filtros">
      <label>Día <input type="date" id="ru-fecha" value="${esc(fecha)}"></label>
      ${d.puede.planear ? '<button class="btn primario" id="nueva-ruta">+ Crear la ruta de este día</button>' : ''}
    </div>

    ${d.rutas.length ? d.rutas.map(tarjetaRuta).join('')
    : '<div class="panel"><div class="vacio">No hay ruta para este día todavía.</div></div>'}

    ${candidatos(laDelDia)}

    ${d.proximas.length ? `
      <section class="panel">
        <h2>Rutas de otros días <span class="etiqueta azul">${d.proximas.length}</span></h2>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Día</th><th>Ruta</th><th>Paradas</th><th></th></tr></thead>
          <tbody>${d.proximas.map((r) => `
            <tr>
              <td class="fila-titulo">${esc(r.fecha)}</td>
              <td>${esc(r.folio)}</td>
              <td>${r.paradas}</td>
              <td><button class="btn" data-ver-dia="${esc(r.fecha)}">Ver ese día</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}`;

  const recargar = () => vistaLogisticaRutas(estado.fechaRuta);

  document.getElementById('ru-fecha').addEventListener('change', (e) => {
    estado.fechaRuta = e.target.value;
    recargar();
  });
  vista.querySelectorAll('[data-ver-dia]').forEach((b) => b.addEventListener('click', () => {
    estado.fechaRuta = b.dataset.verDia;
    recargar();
  }));

  const hacer = async (metodo, ruta, cuerpo, aviso) => {
    try {
      await api(metodo, ruta, cuerpo);
      if (aviso) mostrarMensaje(aviso, 'exito');
      await recargar();
    } catch (err) { mostrarMensaje(err.message, 'error'); }
  };

  const nueva = document.getElementById('nueva-ruta');
  if (nueva) {
    nueva.addEventListener('click', () => hacer('POST', '/api/logistica/rutas',
      { fecha: estado.fechaRuta }, 'Ruta creada.'));
  }
  vista.querySelectorAll('[data-subir-venta]').forEach((b) => b.addEventListener('click', () => {
    const [rutaId, vxfId] = b.dataset.subirVenta.split('|');
    hacer('POST', `/api/logistica/rutas/${rutaId}/paradas`, { vxf_id: Number(vxfId) }, 'Subida a la ruta.');
  }));
  vista.querySelectorAll('[data-subir-cita]').forEach((b) => b.addEventListener('click', () => {
    const [rutaId, citaId] = b.dataset.subirCita.split('|');
    hacer('POST', `/api/logistica/rutas/${rutaId}/paradas`, { cita_id: Number(citaId) }, 'Subida a la ruta.');
  }));
  vista.querySelectorAll('[data-agregar-parada]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.agregarParada;
    hacer('POST', `/api/logistica/rutas/${id}/paradas`, {
      tipo: document.getElementById(`pa-tipo-${id}`).value,
      etiqueta: document.getElementById(`pa-etiqueta-${id}`).value,
      direccion: document.getElementById(`pa-direccion-${id}`).value,
      detalle: document.getElementById(`pa-detalle-${id}`).value,
    }, 'Parada agregada.');
  }));
  vista.querySelectorAll('[data-mover-parada]').forEach((b) => b.addEventListener('click', () => {
    const [id, hacia] = b.dataset.moverParada.split('|');
    hacer('PUT', `/api/logistica/paradas/${id}`, { hacia });
  }));
  vista.querySelectorAll('[data-entregada]').forEach((b) => b.addEventListener('click', () => {
    hacer('PUT', `/api/logistica/paradas/${b.dataset.entregada}`, { estado: 'entregada' }, 'Parada entregada.');
  }));
  vista.querySelectorAll('[data-pendiente]').forEach((b) => b.addEventListener('click', () => {
    hacer('PUT', `/api/logistica/paradas/${b.dataset.pendiente}`, { estado: 'pendiente' });
  }));
  vista.querySelectorAll('[data-fallo]').forEach((b) => b.addEventListener('click', () => {
    const nota = prompt('¿Por qué no se entregó? Queda anotado en la ruta.');
    if (!nota || !nota.trim()) return;
    hacer('PUT', `/api/logistica/paradas/${b.dataset.fallo}`, { estado: 'no_entregada', nota: nota.trim() });
  }));
  vista.querySelectorAll('[data-quitar-parada]').forEach((b) => b.addEventListener('click', () => {
    hacer('DELETE', `/api/logistica/paradas/${b.dataset.quitarParada}`, undefined, 'Parada quitada.');
  }));
  // La dirección de esa vez. Vaciarla devuelve la de la ficha del cliente.
  vista.querySelectorAll('[data-direccion-parada]').forEach((b) => b.addEventListener('click', () => {
    const p = (d.rutas.flatMap((r) => r.paradas)).find((x) => x.id === Number(b.dataset.direccionParada));
    const dir = prompt('¿A dónde se entrega? Así se abre en el mapa.\n'
      + 'Déjalo vacío para usar la dirección de la ficha del cliente o del CEDIS.',
    (p && p.direccion_propia ? p.direccion : '') || '');
    if (dir === null) return;
    hacer('PUT', `/api/logistica/paradas/${b.dataset.direccionParada}`, { direccion: dir },
      dir.trim() ? 'Dirección puesta.' : 'Se quitó la dirección de esa parada.');
  }));
  vista.querySelectorAll('[data-unidad-ruta]').forEach((sel) => sel.addEventListener('change', () => {
    hacer('PUT', `/api/logistica/rutas/${sel.dataset.unidadRuta}`, { activo_id: sel.value || null });
  }));
  // Qué formato de salida lleva esta ruta. Se dice aquí, no dentro del formato.
  vista.querySelectorAll('[data-salida-ruta]').forEach((sel) => sel.addEventListener('change', () => {
    hacer('PUT', `/api/logistica/rutas/${sel.dataset.salidaRuta}`, { llenado_id: sel.value || null },
      sel.value ? 'Esa salida lleva la ruta.' : 'La ruta se quedó sin salida.');
  }));
  vista.querySelectorAll('[data-estado-ruta]').forEach((b) => b.addEventListener('click', () => {
    const [id, estadoNuevo] = b.dataset.estadoRuta.split('|');
    if (estadoNuevo === 'cancelada' && !confirm('¿Cancelar esta ruta? Sus paradas se van con ella.')) return;
    hacer('PUT', `/api/logistica/rutas/${id}`, { estado: estadoNuevo });
  }));
}

// --- desempeño: el reporte del módulo ---

async function vistaLogisticaDesempeno() {
  encabezado('Desempeño de las unidades', 'Rendimiento, costo por kilómetro, servicios y papeles');
  const desde = estado.logisticaDesde || '';
  const hasta = estado.logisticaHasta || '';
  const d = await api('GET', `/api/logistica/desempeno${desde || hasta
    ? `?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}` : ''}`);

  const conGasto = d.unidades.filter((u) => u.cargas || u.servicios);
  vista.innerHTML = `
    ${migajaLogistica('Desempeño')}
    <div id="mensajes"></div>

    <div class="filtros">
      <label>Del <input type="date" id="de-desde" value="${esc(d.desde)}"></label>
      <label>al <input type="date" id="de-hasta" value="${esc(d.hasta)}"></label>
      <button class="btn" id="de-aplicar">Ver</button>
    </div>

    <div class="cifras-almacen">
      <div class="cifra"><b>${pesos(d.resumen.costo)}</b><span>gasolina en el periodo</span></div>
      <div class="cifra"><b>${numero(Math.round(d.resumen.litros))}</b><span>litros</span></div>
      <div class="cifra"><b>${numero(d.resumen.kilometros)}</b><span>kilómetros recorridos</span></div>
      <div class="cifra"><b>${pesos(d.resumen.costo_servicios)}</b><span>servicios</span></div>
      <div class="cifra ${d.resumen.papeles_vencidos ? 'alerta' : ''}">
        <b>${d.resumen.papeles_vencidos}</b><span>papeles vencidos</span></div>
    </div>

    <section class="panel">
      <h2>Por unidad</h2>
      ${conGasto.length ? `
        <table class="tabla">
          <thead><tr><th>Unidad</th><th>Cargas</th><th>Litros</th><th>Gasolina</th><th>$/L</th>
            <th>Km</th><th>Rendimiento</th><th>Costo por km</th><th>Servicios</th><th>Papeles</th></tr></thead>
          <tbody>${conGasto.map((u) => {
            const vencidos = u.papeles.filter((v) => v.estado === 'vencida').length;
            const porVencer = u.papeles.filter((v) => v.estado === 'por_vencer' || v.estado === 'vence_hoy').length;
            return `
            <tr>
              <td class="fila-titulo"><button class="btn" data-ir-hash="#/logistica/unidad/${u.id}">${esc(u.nombre)}</button>
                <br><small style="color:var(--tinta-suave)">${esc(u.etiqueta_tipo)}</small></td>
              <td>${u.cargas}</td>
              <td>${u.litros}</td>
              <td>${pesos(u.costo)}</td>
              <td>${pesos(u.precio_litro)}</td>
              <td>${numero(u.kilometros)}</td>
              <td><b>${u.rendimiento ? `${u.rendimiento} km/L` : '—'}</b></td>
              <td>${pesos(u.costo_km)}</td>
              <td>${u.servicios ? `${u.servicios} · ${pesos(u.costo_servicios)}` : '—'}</td>
              <td>${vencidos ? `<span class="etiqueta roja">${vencidos} vencido(s)</span>`
                : porVencer ? `<span class="etiqueta ambar">${porVencer} por vencer</span>`
                : '<span class="etiqueta verde">al día</span>'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<div class="vacio">No hay cargas ni servicios en el periodo.</div>'}
    </section>

    ${d.meses.length ? `
      <section class="panel">
        <h2>Gasto de gasolina por mes</h2>
        <table class="tabla">
          <thead><tr><th>Mes</th><th>Cargas</th><th>Litros</th><th>Costo</th><th>Precio por litro</th></tr></thead>
          <tbody>${d.meses.map((m) => `
            <tr>
              <td class="fila-titulo">${esc(m.mes)}</td>
              <td>${m.cargas}</td>
              <td>${m.litros}</td>
              <td>${pesos(m.costo)}</td>
              <td>${pesos(m.litros ? Math.round((m.costo / m.litros) * 100) / 100 : null)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </section>` : ''}`;

  document.getElementById('de-aplicar').addEventListener('click', () => {
    estado.logisticaDesde = document.getElementById('de-desde').value;
    estado.logisticaHasta = document.getElementById('de-hasta').value;
    vistaLogisticaDesempeno();
  });
}

// ====================================================== claves y accesos

// La misma pantalla se abre de dos maneras: como pestaña de Configuración —el
// Administrador— y suelta en #/accesos, para quien solo tiene el permiso de
// liberar y no entra al resto de Configuración. El contenido es el mismo; lo
// único que cambia es el marco.
async function vistaAccesos() {
  encabezado('Claves y accesos', 'Quién está bloqueado, y quién entró');
  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span><span>Claves y accesos</span>
    </div>
    <div id="mensajes"></div>
    <div id="zona-accesos"><div class="vacio">Cargando…</div></div>`;
  const zona = document.getElementById('zona-accesos');
  try { await pintarAccesos(zona); } catch (err) { zona.innerHTML = avisoError(err.message); }
}

const recargarAccesos = () => (location.hash.startsWith('#/config') ? recargarConfig() : vistaAccesos());

const ETIQUETA_ACCESO = {
  entrada: 'Entró', fallo: 'Intento fallido', bloqueo: 'Se bloqueó',
  liberacion: 'Liberado', rechazo: 'Entrada rechazada',
  liberacion_rechazada: 'Quiso liberar sin permiso',
};
const CLASE_ACCESO = {
  entrada: 'verde', fallo: 'ambar', bloqueo: 'roja',
  liberacion: 'azul', rechazo: 'roja', liberacion_rechazada: 'roja',
};

async function pintarAccesos(destino) {
  const d = await api('GET', '/api/accesos');
  const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const personasBloqueadas = d.personas.filter((p) => p.bloqueado_en);
  const tabletsBloqueadas = d.dispositivos.filter((x) => x.bloqueado_en);
  const trabados = personasBloqueadas.length + tabletsBloqueadas.length;

  destino.innerHTML = `
    <div class="panel ${trabados ? 'peligroso' : ''}">
      <h2>Bloqueados ahora
        <span class="etiqueta ${trabados ? 'roja' : 'verde'}">${trabados || 'ninguno'}</span></h2>
      <p class="explica">
        A los <b>${d.intentos_max} intentos fallidos</b> el acceso se traba y no se destraba
        con el tiempo: lo libera quien tenga este permiso. Más rápido que entrar aquí es
        escribir tu clave en la misma pantalla donde quedó trabada.
      </p>
      ${trabados ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Qué</th><th>Por qué</th><th>Desde</th><th></th></tr></thead>
          <tbody>
            ${personasBloqueadas.map((p) => `
              <tr>
                <td class="fila-titulo">${esc(p.nombre)}<br><small style="color:var(--tinta-suave)">${esc(p.puesto || '')}</small></td>
                <td>${esc(p.bloqueado_motivo || '—')}${p.bloqueo_por ? `<br><small style="color:var(--tinta-suave)">la bloqueó ${esc(p.bloqueo_por)}</small>` : ''}</td>
                <td>${esc(cuando(p.bloqueado_en))}</td>
                <td><button class="btn" data-liberar-persona="${p.id}" data-nombre="${esc(p.nombre)}">Liberar</button></td>
              </tr>`).join('')}
            ${tabletsBloqueadas.map((x) => `
              <tr>
                <td class="fila-titulo">Tablet ${esc(x.dispositivo)}</td>
                <td>${esc(x.motivo || '—')}</td>
                <td>${esc(cuando(x.bloqueado_en))}</td>
                <td><button class="btn" data-liberar-tablet="${esc(x.dispositivo)}">Liberar</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="vacio">Nadie está bloqueado. Todas las claves funcionan.</div>'}
    </div>

    <div class="panel">
      <h2>Claves del personal</h2>
      <p class="explica">
        <b>Bloquear a mano</b> es para cuando alguien se va o su clave anda rodando: deja de
        entrar al instante y se le cierra la sesión. Pide el motivo, para que quien lo
        encuentre después sepa por qué.
      </p>
      <div class="desliza"><table class="captura">
        <thead><tr><th class="fila-titulo">Persona</th><th>Puesto</th><th>Clave</th><th>Intentos fallidos</th><th></th></tr></thead>
        <tbody>${d.personas.map((p) => `
          <tr class="${p.bloqueado_en ? 'vigencia-vencida' : ''}">
            <td class="fila-titulo">${esc(p.nombre)}</td>
            <td>${esc(p.puesto || '')}</td>
            <td>${p.tiene_clave ? '<span class="etiqueta verde">tiene</span>' : '<span class="etiqueta ambar">sin clave</span>'}</td>
            <td>${p.bloqueado_en ? '<span class="etiqueta roja">bloqueada</span>' : (p.fallos || 0)}</td>
            <td>${p.bloqueado_en
              ? `<button class="btn" data-liberar-persona="${p.id}" data-nombre="${esc(p.nombre)}">Liberar</button>`
              : `<button class="btn" data-bloquear="${p.id}" data-nombre="${esc(p.nombre)}">Bloquear</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>

    <div class="panel">
      <h2>Últimos movimientos</h2>
      <p class="explica">
        Lo que pasó en la puerta del sistema. Se guarda completo para auditorías;
        el reporte entero está en <b>Reportes → Accesos y bloqueos</b>.
      </p>
      ${d.bitacora.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Cuándo</th><th>Qué pasó</th><th>Quién</th><th>Dónde</th><th>Nota</th></tr></thead>
          <tbody>${d.bitacora.map((b) => `
            <tr>
              <td class="fila-titulo">${esc(cuando(b.en))}</td>
              <td><span class="etiqueta ${CLASE_ACCESO[b.accion] || ''}">${esc(ETIQUETA_ACCESO[b.accion] || b.accion)}</span></td>
              <td>${esc(b.quien || '—')}${b.por ? `<br><small style="color:var(--tinta-suave)">por ${esc(b.por)}</small>` : ''}</td>
              <td>${esc(b.dispositivo || '—')}</td>
              <td>${esc(b.nota || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="vacio">Todavía no hay movimientos.</div>'}
    </div>`;

  destino.querySelectorAll('[data-liberar-persona]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/accesos/personas/${b.dataset.liberarPersona}/liberar`, {});
        mostrarMensaje(r.mensaje, 'exito');
        await recargarAccesos();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });

  destino.querySelectorAll('[data-liberar-tablet]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/accesos/dispositivos/liberar', { dispositivo: b.dataset.liberarTablet });
        mostrarMensaje(r.mensaje, 'exito');
        await recargarAccesos();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });

  destino.querySelectorAll('[data-bloquear]').forEach((b) => {
    b.addEventListener('click', () => modalBloquearClave(Number(b.dataset.bloquear), b.dataset.nombre));
  });
}

function modalBloquearClave(id, nombre) {
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Bloquear una clave">
      <h2>Bloquear la clave de ${esc(nombre)}</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>
        <p class="explica" style="padding:0">
          Deja de entrar en cuanto se guarde, y si está dentro se le cierra la sesión.
          Se le puede liberar después desde aquí o desde la pantalla de acceso.
        </p>
        <div class="campo">
          <label for="bl-motivo">Por qué se bloquea</label>
          <input id="bl-motivo" placeholder="Se fue de la empresa, su clave anda rodando…">
        </div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cerrar>Cancelar</button>
        <button class="btn peligro" data-guardar>Bloquear la clave</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    try {
      const r = await api('POST', `/api/accesos/personas/${id}/bloquear`,
        { motivo: capa.querySelector('#bl-motivo').value });
      cerrar();
      mostrarMensaje(r.mensaje, 'exito');
      await recargarAccesos();
    } catch (err) { capa.querySelector('#error-modal').innerHTML = avisoError(err.message); }
  });
  if (!ES_TACTIL) capa.querySelector('#bl-motivo').focus();
}

// --- el reporte ---

estado.filtroAccesos = estado.filtroAccesos || { desde: '', hasta: '', persona: '', accion: '' };

async function vistaReporteAccesos() {
  encabezado('Accesos y bloqueos', 'Quién entró, qué falló y quién liberó');
  const f = estado.filtroAccesos;
  const partes = [];
  for (const k of ['desde', 'hasta', 'persona', 'accion']) if (f[k]) partes.push(`${k}=${encodeURIComponent(f[k])}`);
  const d = await api('GET', `/api/reportes/accesos${partes.length ? `?${partes.join('&')}` : ''}`);
  const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const hayFiltro = partes.length > 0;
  const cuantos = (clave) => (d.resumen.find((x) => x.accion === clave) || {}).cuantos || 0;

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span>
      <button data-ir-hash="#/reportes">Reportes</button><span>/</span><span>Accesos y bloqueos</span>
    </div>

    <div class="filtros">
      <label>Del <input type="date" id="fa-desde" value="${esc(f.desde)}"></label>
      <label>al <input type="date" id="fa-hasta" value="${esc(f.hasta)}"></label>
      <label>Persona
        <select id="fa-persona">
          <option value="">Todas</option>
          ${d.filtros.personas.map((p) => `
            <option value="${p.id}" ${String(p.id) === String(f.persona) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
        </select>
      </label>
      <label>Qué pasó
        <select id="fa-accion">
          <option value="">Todo</option>
          ${d.filtros.acciones.map((x) => `
            <option value="${x.clave}" ${x.clave === f.accion ? 'selected' : ''}>${esc(x.etiqueta)}</option>`).join('')}
        </select>
      </label>
      <button class="btn" id="fa-aplicar">Ver</button>
      ${hayFiltro ? '<button class="btn" id="fa-limpiar">Quitar filtros</button>' : ''}
    </div>

    <div class="cifras-inicio" style="margin:0 0 22px">
      <div class="cifra-inicio"><small>Entradas al sistema</small><b>${cuantos('entrada')}</b></div>
      <div class="cifra-inicio ${cuantos('fallo') ? 'alerta' : ''}"><small>Intentos fallidos</small><b>${cuantos('fallo')}</b></div>
      <div class="cifra-inicio ${cuantos('bloqueo') ? 'alerta' : ''}"><small>Bloqueos</small><b>${cuantos('bloqueo')}</b></div>
      <div class="cifra-inicio"><small>Liberaciones</small><b>${cuantos('liberacion')}</b></div>
    </div>

    <div class="panel">
      <h2>Por persona</h2>
      ${d.por_persona.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Persona</th><th>Entradas</th><th>Fallidos</th><th>Bloqueos</th><th>Última entrada</th></tr></thead>
          <tbody>${d.por_persona.map((x) => `
            <tr>
              <td class="fila-titulo">${esc(x.quien)}</td>
              <td>${x.entradas || 0}</td>
              <td>${x.fallos || 0}</td>
              <td>${x.bloqueos || 0}</td>
              <td>${esc(cuando(x.ultima_entrada))}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="vacio">No hay movimientos con ese filtro.</div>'}
    </div>

    <div class="panel">
      <h2>Movimiento por movimiento <span class="etiqueta azul">${d.renglones.length}</span></h2>
      <p class="explica">Los más recientes primero. La bitácora completa se resguarda para auditorías.</p>
      ${d.renglones.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Cuándo</th><th>Qué pasó</th><th>Quién</th><th>Dónde</th><th>Nota</th></tr></thead>
          <tbody>${d.renglones.map((b) => `
            <tr>
              <td class="fila-titulo">${esc(cuando(b.en))}</td>
              <td><span class="etiqueta ${CLASE_ACCESO[b.accion] || ''}">${esc(ETIQUETA_ACCESO[b.accion] || b.accion)}</span></td>
              <td>${esc(b.quien || '—')}${b.por ? `<br><small style="color:var(--tinta-suave)">por ${esc(b.por)}</small>` : ''}</td>
              <td>${esc(b.dispositivo || '—')}</td>
              <td>${esc(b.nota || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="vacio">Nada que mostrar.</div>'}
    </div>`;

  document.getElementById('fa-aplicar').addEventListener('click', () => {
    estado.filtroAccesos = {
      desde: document.getElementById('fa-desde').value,
      hasta: document.getElementById('fa-hasta').value,
      persona: document.getElementById('fa-persona').value,
      accion: document.getElementById('fa-accion').value,
    };
    vistaReporteAccesos();
  });
  const limpiar = document.getElementById('fa-limpiar');
  if (limpiar) {
    limpiar.addEventListener('click', () => {
      estado.filtroAccesos = { desde: '', hasta: '', persona: '', accion: '' };
      vistaReporteAccesos();
    });
  }
}

// ======================================================== bahía digital
//
// Los papeles, todos en un lugar. La portada es un índice: los de las unidades
// y los del personal son listas largas y cada una tiene su pantalla.

const migajaBahia = (donde) => `
  <div class="migaja">
    <button data-ir-hash="#/menu">← Menú</button><span>/</span>
    ${donde ? `<button data-ir-hash="#/bahia">Bahía digital</button><span>/</span><span>${esc(donde)}</span>`
      : '<span>Bahía digital</span>'}
  </div>`;

async function vistaBahia() {
  encabezado('Bahía digital', 'Los papeles de las unidades y del personal');
  const d = await api('GET', '/api/bahia');
  estado.bahia = d;

  const porVencer = (lista) => lista.reduce((n, x) => n + x.por_vencer, 0);
  const faltantes = (lista) => lista.reduce((n, x) => n + x.sin_cargar.length, 0);
  const papeles = (lista) => lista.reduce((n, x) => n + x.papeles.length, 0);

  vista.innerHTML = `
    ${migajaBahia()}
    <div id="mensajes"></div>

    <div class="cifras-almacen">
      <div class="cifra"><b>${papeles(d.unidades) + papeles(d.personas)}</b><span>papeles cargados</span></div>
      <div class="cifra ${porVencer(d.unidades) + porVencer(d.personas) ? 'alerta' : ''}">
        <b>${porVencer(d.unidades) + porVencer(d.personas)}</b><span>vencidos o por vencer</span></div>
      <div class="cifra"><b>${faltantes(d.unidades) + faltantes(d.personas)}</b><span>sin cargar</span></div>
    </div>

    <div class="rejilla-tareas">
      ${d.puede.unidades ? `
        <button class="tarea" data-ir-hash="#/bahia/unidades">
          <b>Papeles de las unidades <span class="etiqueta">${d.unidades.length}</span></b>
          <span class="meta">Tarjeta, póliza, verificación, afiliaciones y contratos, con su vencimiento.</span>
          ${porVencer(d.unidades) ? `<span class="etiqueta roja">${porVencer(d.unidades)} por atender</span>` : ''}
        </button>` : ''}
      <button class="tarea" data-ir-hash="#/bahia/personal">
        <b>${d.puede.personal || d.puede.emergencia ? 'Papeles del personal' : 'Mis papeles'}
          <span class="etiqueta">${d.personas.length}</span></b>
        <span class="meta">${d.puede.personal
          ? 'INE, domicilio, licencia, IMSS, contrato, exámenes y cursos, y la ficha de emergencia.'
          : d.puede.emergencia
            ? 'La ficha de emergencia de cada quien: tipo de sangre, a quién hablarle y su clínica.'
            : 'Los tuyos: los puedes ver y cargar. Los de los demás no se ven aquí.'}</span>
        ${porVencer(d.personas) ? `<span class="etiqueta roja">${porVencer(d.personas)} por atender</span>` : ''}
      </button>
      ${permiso('bahia_reportes') ? `
        <button class="tarea" data-ir-hash="#/reportes/bahia">
          <b>Reporte de papeles</b>
          <span class="meta">Todo junto: lo que vence, lo que falta y quién lo cargó.</span>
        </button>` : ''}
    </div>

    <p class="explica" style="padding-left:0">
      Un papel <b>se retira</b>, no se borra: el que estaba vigente el año pasado sigue
      siendo la prueba de que lo estaba, y eso es lo que pide una auditoría.
      Los papeles del personal son datos personales: los ve el Administrador y cada
      quien los suyos.
    </p>`;
}

// Un panel de papeles, igual para una unidad que para una persona.
// La ficha de emergencia de una persona: lo que alguien tiene que poder leer en
// treinta segundos si pasa algo. Se guarda con un solo botón.
function panelFichaEmergencia(d, persona) {
  const f = persona.ficha || {};
  const puedeEditar = persona.id === d.yo || d.puede.personal_editar;
  const campo = (id, etiqueta, valor, extra = '') => `
    <div class="campo"><label for="fi-${id}-${persona.id}">${etiqueta}</label>
      <input id="fi-${id}-${persona.id}" value="${esc(valor || '')}" ${puedeEditar ? '' : 'disabled'} ${extra}></div>`;
  // Plegada: de cada persona se lee el renglón que importa —sangre, a quién
  // hablarle, qué clínica— y el formulario completo solo se abre al tocarla.
  // Con dieciséis personas, dieciséis formularios abiertos no se leen.
  const resumen = [
    f.tipo_sangre || 'sin tipo de sangre',
    f.contacto1_nombre ? `${f.contacto1_nombre}${f.contacto1_telefono ? ` · ${f.contacto1_telefono}` : ''}` : 'sin contacto',
    f.clinica || null,
  ].filter(Boolean).join(' · ');

  return `
    <details class="panel-ficha" data-ficha="${persona.id}" ${
  persona.id === d.yo && !persona.ficha_completa ? 'open' : ''}>
      <summary>
        <b>Ficha de emergencia</b>
        <span class="etiqueta ${persona.ficha_completa ? 'verde' : 'ambar'}">${persona.ficha_completa
          ? 'completa' : 'le falta lo básico'}</span>
        <span class="resumen-ficha">${esc(resumen)}</span>
      </summary>
      <div class="campo-par">
        <div class="campo">
          <label for="fi-sangre-${persona.id}">Tipo de sangre</label>
          <select id="fi-sangre-${persona.id}" ${puedeEditar ? '' : 'disabled'}>
            <option value="">Sin capturar</option>
            ${d.catalogos.tipos_sangre.map((t) => `
              <option value="${esc(t)}" ${t === f.tipo_sangre ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </div>
        ${campo('alergias', 'Alergias o padecimientos', f.alergias)}
      </div>
      <div class="campo-par">
        ${campo('clinica', 'Clínica que le toca', f.clinica)}
        ${campo('nss', 'Número de seguridad social', f.nss)}
      </div>
      <div class="campo-par">
        ${campo('c1nombre', 'Contacto de emergencia', f.contacto1_nombre)}
        ${campo('c1tel', 'Su teléfono', f.contacto1_telefono, 'inputmode="tel"')}
      </div>
      <div class="campo-par">
        ${campo('c1par', 'Qué es suyo (parentesco)', f.contacto1_parentesco)}
        ${campo('c2nombre', 'Segundo contacto', f.contacto2_nombre)}
      </div>
      <div class="campo-par">
        ${campo('c2tel', 'Su teléfono', f.contacto2_telefono, 'inputmode="tel"')}
        ${campo('c2par', 'Qué es suyo (parentesco)', f.contacto2_parentesco)}
      </div>
      ${campo('notas', 'Algo más que haya que saber', f.notas)}
      ${puedeEditar ? `
        <div class="fila-botones" style="padding:12px 0 0">
          <button class="btn primario" data-guardar-ficha="${persona.id}">Guardar la ficha</button>
          ${f.actualizado_en ? `<small style="color:var(--tinta-suave)">Última vez: ${
  esc(new Date(f.actualizado_en).toLocaleDateString('es-MX'))}${f.actualizo ? ` · ${esc(f.actualizo)}` : ''}</small>` : ''}
        </div>` : ''}
    </details>`;
}

function panelPapeles(d, ambito, ficha, puedeCargar) {
  const tipos = ambito === 'unidad' ? d.catalogos.tipos_unidad : d.catalogos.tipos_persona;
  const alerta = ficha.por_vencer;
  return `
    <section class="panel ${alerta ? 'peligroso' : ''}">
      <h2>${esc(ficha.nombre)}
        ${ambito === 'unidad' ? `<span class="etiqueta">${esc(ficha.etiqueta_tipo || '')}</span>`
          : `<span class="etiqueta">${esc(ficha.puesto || '')}</span>`}
        ${ambito === 'persona' && !ficha.ve_papeles
          ? '<span class="etiqueta">solo su ficha</span>'
          : `<span class="etiqueta ${alerta ? 'roja' : (ficha.papeles.length ? 'verde' : 'ambar')}">${alerta
            ? `${alerta} por atender`
            : ficha.papeles.length ? `${ficha.papeles.length} al día` : 'sin papeles'}</span>`}
      </h2>
      ${ambito === 'persona' && ficha.ficha ? `<div style="padding:0 18px">${panelFichaEmergencia(d, ficha)}</div>` : ''}
      ${!ficha.ve_papeles && ambito === 'persona' ? '' : ficha.papeles.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Documento</th><th>Nombre o folio</th><th>Vence</th>
            <th>Situación</th><th>Cargó</th><th></th></tr></thead>
          <tbody>${ficha.papeles.map((p) => `
            <tr class="${p.estado === 'vencida' ? 'vigencia-vencida' : ''}">
              <td class="fila-titulo">${esc(p.tipo)}</td>
              <td>${esc(p.nombre || '—')}${p.notas ? `<br><small style="color:var(--tinta-suave)">${esc(p.notas)}</small>` : ''}</td>
              <td>${esc(p.vence || '—')}</td>
              <td><span class="etiqueta ${CLASE_VIGENCIA[p.estado] || ''}">${esc(p.texto || 'sin fecha')}</span></td>
              <td><small>${esc(p.subio || '—')}<br>${esc((p.subido_en || '').slice(0, 10))}</small></td>
              <td class="fila-botones">
                <button class="btn" data-ver="${esc(p.archivo)}">Ver</button>
                ${d.puede.retirar ? `<button class="btn" data-retirar="${p.id}"
                  data-que="${esc(p.tipo)}">Retirar</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="vacio">Todavía no tiene papeles cargados.</div>'}
      ${ficha.sin_cargar.length ? `
        <p class="explica">Sin cargar (${ficha.sin_cargar.length}):
          ${ficha.sin_cargar.slice(0, 6).map((t) => esc(t)).join(' · ')}${
  ficha.sin_cargar.length > 6 ? ` y ${ficha.sin_cargar.length - 6} más` : ''}</p>` : ''}
      ${puedeCargar ? `
        <div class="fila-botones" style="padding:0 18px 18px">
          <button class="btn primario" data-cargar="${ficha.id}" data-ambito="${ambito}"
                  data-nombre="${esc(ficha.nombre)}">Cargar un papel</button>
        </div>` : ''}
      ${tipos.length ? '' : '<p class="explica">La lista de documentos está vacía: se edita en Configuración → Listas.</p>'}
    </section>`;
}

function conectarPapeles(d, recargar) {
  vista.querySelectorAll('[data-ver]').forEach((b) => {
    b.addEventListener('click', () => abrirArchivoProtegido(b.dataset.ver));
  });

  vista.querySelectorAll('[data-guardar-ficha]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.guardarFicha;
      const v = (campo) => (document.getElementById(`fi-${campo}-${id}`) || {}).value || '';
      b.disabled = true;
      try {
        const r = await api('PUT', `/api/bahia/fichas/${id}`, {
          tipo_sangre: v('sangre'),
          alergias: v('alergias'),
          clinica: v('clinica'),
          nss: v('nss'),
          contacto1_nombre: v('c1nombre'),
          contacto1_telefono: v('c1tel'),
          contacto1_parentesco: v('c1par'),
          contacto2_nombre: v('c2nombre'),
          contacto2_telefono: v('c2tel'),
          contacto2_parentesco: v('c2par'),
          notas: v('notas'),
        });
        mostrarMensaje(r.mensaje, 'exito');
        await recargar();
      } catch (err) { mostrarMensaje(err.message, 'error'); b.disabled = false; }
    });
  });
  vista.querySelectorAll('[data-cargar]').forEach((b) => {
    b.addEventListener('click', () => modalPapel(d, b.dataset.ambito, Number(b.dataset.cargar),
      b.dataset.nombre, recargar));
  });
  vista.querySelectorAll('[data-retirar]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (b.dataset.armado !== 'si') {
        b.dataset.armado = 'si';
        b.classList.add('peligro');
        b.textContent = '¿Retirar?';
        setTimeout(() => { b.dataset.armado = ''; b.classList.remove('peligro'); b.textContent = 'Retirar'; }, 5000);
        return;
      }
      try {
        const r = await api('DELETE', `/api/bahia/documentos/${b.dataset.retirar}`);
        mostrarMensaje(r.mensaje, 'exito');
        await recargar();
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
}

async function vistaBahiaUnidades() {
  encabezado('Papeles de las unidades', 'Lo que tiene cada unidad y lo que le vence');
  const d = await api('GET', '/api/bahia');
  if (!d.puede.unidades) {
    vista.innerHTML = migajaBahia('Unidades') + avisoError('No tienes acceso a los papeles de las unidades.');
    return;
  }
  const busca = (estado.buscaBahia || '').trim().toLowerCase();
  const visibles = d.unidades.filter((u) => !busca
    || `${u.nombre} ${u.clave} ${u.etiqueta_tipo}`.toLowerCase().includes(busca));

  vista.innerHTML = `
    ${migajaBahia('Unidades')}
    <div id="mensajes"></div>
    <div class="filtros">
      <label>Buscar <input id="bh-busca" value="${esc(estado.buscaBahia || '')}" placeholder="Nombre o clave"></label>
      <button class="btn" id="bh-ver">Ver</button>
    </div>
    ${visibles.length ? visibles.map((u) => panelPapeles(d, 'unidad', u, d.puede.unidades_cargar)).join('')
      : '<div class="panel"><div class="vacio">Ninguna unidad con ese nombre.</div></div>'}`;

  document.getElementById('bh-ver').addEventListener('click', () => {
    estado.buscaBahia = document.getElementById('bh-busca').value;
    vistaBahiaUnidades();
  });
  document.getElementById('bh-busca').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      estado.buscaBahia = e.target.value;
      vistaBahiaUnidades();
    }
  });
  conectarPapeles(d, vistaBahiaUnidades);
}

async function vistaBahiaPersonal() {
  const d = await api('GET', '/api/bahia');
  const deTodos = d.puede.personal || d.puede.emergencia;
  encabezado(deTodos ? 'Papeles del personal' : 'Mis papeles',
    d.puede.personal ? 'Lo que tiene cada persona, su ficha y lo que le vence'
      : d.puede.emergencia ? 'La ficha de emergencia de cada persona'
        : 'Los tuyos: cárgalos y mantenlos al día');

  const busca = (estado.buscaBahiaGente || '').trim().toLowerCase();
  const visibles = d.personas.filter((p) => !busca || p.nombre.toLowerCase().includes(busca));

  vista.innerHTML = `
    ${migajaBahia(deTodos ? 'Personal' : 'Mis papeles')}
    <div id="mensajes"></div>
    ${deTodos ? `
      <div class="filtros">
        <label>Buscar <input id="bh-busca" value="${esc(estado.buscaBahiaGente || '')}" placeholder="Nombre"></label>
        <button class="btn" id="bh-ver">Ver</button>
      </div>` : ''}
    ${visibles.length
      ? visibles.map((p) => panelPapeles(d, 'persona', p,
        p.id === d.yo ? true : (d.puede.personal_cargar && p.ve_papeles))).join('')
      : '<div class="panel"><div class="vacio">Nadie con ese nombre.</div></div>'}`;

  const ver = document.getElementById('bh-ver');
  if (ver) {
    ver.addEventListener('click', () => {
      estado.buscaBahiaGente = document.getElementById('bh-busca').value;
      vistaBahiaPersonal();
    });
    document.getElementById('bh-busca').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        estado.buscaBahiaGente = e.target.value;
        vistaBahiaPersonal();
      }
    });
  }
  conectarPapeles(d, vistaBahiaPersonal);
}

function modalPapel(d, ambito, id, nombre, alGuardar) {
  const tipos = ambito === 'unidad' ? d.catalogos.tipos_unidad : d.catalogos.tipos_persona;
  const capa = document.createElement('div');
  capa.className = 'modal';
  capa.innerHTML = `
    <div class="caja-modal" role="dialog" aria-label="Cargar un papel">
      <h2>Cargar un papel · ${esc(nombre)}</h2>
      <div class="cuerpo-modal">
        <div id="error-modal"></div>
        <div class="campo"><label for="pa-tipo">Qué documento es</label>
          <select id="pa-tipo">${tipos.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
        <div class="campo-par">
          <div class="campo"><label for="pa-vence">Vence</label><input type="date" id="pa-vence"></div>
          <div class="campo"><label for="pa-nombre">Nombre o folio</label><input id="pa-nombre"></div>
        </div>
        <small class="nota-campo">Si no vence, deja la fecha vacía: la plataforma solo avisa de lo que tiene fecha.</small>
        <div class="campo"><label for="pa-archivo">Archivo (foto o PDF)</label>
          <input type="file" id="pa-archivo" accept="image/*,application/pdf"></div>
        <div class="campo"><label for="pa-notas">Notas</label><input id="pa-notas"></div>
      </div>
      <div class="pie-modal">
        <button class="btn" data-cerrar>Cancelar</button>
        <button class="btn primario" data-guardar>Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-guardar]').addEventListener('click', async () => {
    const error = (m) => { capa.querySelector('#error-modal').innerHTML = avisoError(m); };
    try {
      const archivo = capa.querySelector('#pa-archivo').files[0];
      if (!archivo) return error('Falta el archivo del papel.');
      const r = await api('POST', '/api/bahia/documentos', {
        ambito,
        activo_id: ambito === 'unidad' ? id : undefined,
        usuario_id: ambito === 'persona' ? id : undefined,
        tipo: capa.querySelector('#pa-tipo').value,
        nombre: capa.querySelector('#pa-nombre').value,
        vence: capa.querySelector('#pa-vence').value,
        notas: capa.querySelector('#pa-notas').value,
        archivo: await leerComoDataURL(archivo),
      });
      cerrar();
      mostrarMensaje(r.mensaje, 'exito');
      if (alGuardar) await alGuardar();
    } catch (err) { error(err.message); }
  });
}

// --- el reporte ---

estado.filtroBahia = estado.filtroBahia || { de: '', situacion: '' };

async function vistaReporteBahia() {
  encabezado('Bahía digital', 'Papeles al día, por vencer y sin cargar');
  const f = estado.filtroBahia;
  const partes = [];
  if (f.de) partes.push(`de=${encodeURIComponent(f.de)}`);
  if (f.situacion) partes.push(`situacion=${f.situacion}`);
  const d = await api('GET', `/api/reportes/bahia${partes.length ? `?${partes.join('&')}` : ''}`);

  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span>
      <button data-ir-hash="#/reportes">Reportes</button><span>/</span><span>Bahía digital</span>
    </div>

    <div class="filtros">
      <label>De
        <select id="rb-de">
          <option value="">Todo</option>
          <option value="Unidad" ${f.de === 'Unidad' ? 'selected' : ''}>Unidades</option>
          <option value="Personal" ${f.de === 'Personal' ? 'selected' : ''}>Personal</option>
        </select>
      </label>
      <label>Situación
        <select id="rb-situacion">
          <option value="">Los papeles cargados</option>
          <option value="por_vencer" ${f.situacion === 'por_vencer' ? 'selected' : ''}>Vencidos o por vencer</option>
          <option value="sin_cargar" ${f.situacion === 'sin_cargar' ? 'selected' : ''}>Sin cargar</option>
        </select>
      </label>
      <button class="btn" id="rb-ver">Ver</button>
    </div>

    <div class="cifras-almacen">
      <div class="cifra"><b>${d.resumen.total}</b><span>papeles cargados</span></div>
      <div class="cifra"><b>${d.resumen.al_dia}</b><span>al día</span></div>
      <div class="cifra ${d.resumen.por_vencer ? 'alerta' : ''}">
        <b>${d.resumen.por_vencer}</b><span>vencidos o por vencer</span></div>
      <div class="cifra"><b>${d.resumen.sin_cargar}</b><span>sin cargar</span></div>
    </div>

    ${d.fichas && d.fichas.length ? `
      <div class="panel">
        <h2>Fichas de emergencia
          <span class="etiqueta ${d.fichas.filter((f) => !f.completa).length ? 'ambar' : 'verde'}">${
  d.fichas.filter((f) => f.completa).length} de ${d.fichas.length} completas</span></h2>
        <p class="explica">Tipo de sangre, a quién hablarle y a qué clínica le toca ir. Esta es la hoja
          que conviene tener impresa.</p>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Persona</th><th>Sangre</th><th>Alergias</th>
            <th>Contacto</th><th>Teléfono</th><th>Clínica</th></tr></thead>
          <tbody>${d.fichas.map((f) => `
            <tr class="${f.completa ? '' : 'vigencia-vencida'}">
              <td class="fila-titulo">${esc(f.nombre)}<br><small style="color:var(--tinta-suave)">${esc(f.puesto || '')}</small></td>
              <td>${esc(f.tipo_sangre || '—')}</td>
              <td>${esc(f.alergias || '—')}</td>
              <td>${esc(f.contacto1_nombre || '—')}${f.contacto1_parentesco ? `<br><small style="color:var(--tinta-suave)">${esc(f.contacto1_parentesco)}</small>` : ''}</td>
              <td>${esc(f.contacto1_telefono || '—')}</td>
              <td>${esc(f.clinica || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}

    <div class="panel">
      <h2>Papel por papel <span class="etiqueta azul">${d.renglones.length}</span></h2>
      <p class="explica">Primero lo vencido y luego lo que está por vencer.
        Los ${d.resumen.sin_cargar} papeles que faltan por cargar se ven escogiendo «Sin cargar».</p>
      ${d.renglones.length ? `
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">De quién</th><th>Qué</th><th>Documento</th>
            <th>Vence</th><th>Situación</th><th>Cargó</th></tr></thead>
          <tbody>${d.renglones.map((r) => `
            <tr class="${r.estado === 'vencida' ? 'vigencia-vencida' : ''}">
              <td class="fila-titulo">${esc(r.quien)}</td>
              <td>${esc(r.de)}</td>
              <td>${esc(r.tipo)}</td>
              <td>${esc(r.vence || '—')}</td>
              <td><span class="etiqueta ${r.estado === 'sin_cargar' ? 'ambar' : (CLASE_VIGENCIA[r.estado] || '')}">${esc(r.texto)}</span></td>
              <td><small>${esc(r.subio || '—')}</small></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="vacio">Nada con ese filtro.</div>'}
    </div>`;

  document.getElementById('rb-ver').addEventListener('click', () => {
    estado.filtroBahia = {
      de: document.getElementById('rb-de').value,
      situacion: document.getElementById('rb-situacion').value,
    };
    vistaReporteBahia();
  });
}

// ====================================================== resguardo de 6 años

async function vistaResguardo() {
  encabezado('Resguardo de auditoría', 'Qué hay guardado y el paquete de cada año');
  vista.innerHTML = `
    <div class="migaja">
      <button data-ir-hash="#/menu">← Menú</button><span>/</span><span>Resguardo</span>
    </div>
    <div id="mensajes"></div>
    <div id="zona-resguardo"><div class="vacio">Cargando…</div></div>`;
  const zona = document.getElementById('zona-resguardo');
  try { await pintarResguardo(zona); } catch (err) { zona.innerHTML = avisoError(err.message); }
}

const recargarResguardo = () => (location.hash.startsWith('#/config') ? recargarConfig() : vistaResguardo());

async function pintarResguardo(destino) {
  const d = await api('GET', '/api/resguardo');
  const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const peso = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  destino.innerHTML = `
    <p class="explica" style="padding-left:0">
      Todo lo que se cierra en la plataforma se guarda <b>${d.anios_resguardo} años</b>: mientras
      no cumpla ese tiempo, Limpieza no lo puede borrar y la pantalla dice hasta cuándo está
      resguardado. <b>Resguardar no es congelar:</b> un documento cerrado se puede reabrir y
      corregir con su motivo, y la reapertura queda anotada aquí mismo. Aquí se ve año por año qué hay, y se arma el <b>paquete</b> que se le entrega
      a un auditor: las listas de los documentos, los movimientos de inventario y las fotos de
      evidencia, en una carpeta, sin tener que darle acceso al sistema.
    </p>
    ${d.en_prueba ? `
      <div class="aviso info">
        <b>Estás en una copia de pruebas.</b> Aquí se puede ver, pero el paquete se arma sobre la
        operación de verdad: sal de la prueba para armarlo.
      </div>` : ''}
    <p class="explica" style="padding-left:0">
      Las carpetas se guardan en <code>${esc(d.carpeta)}</code>.
    </p>

    ${d.anios.length ? d.anios.map((a) => `
      <section class="panel">
        <h2>${esc(a.anio)}
          <span class="etiqueta azul">${a.total} documento(s)</span>
          <span class="etiqueta ${a.cumplido ? '' : 'ambar'}">${a.cumplido
            ? `ya cumplió los ${d.anios_resguardo} años`
            : `se guarda hasta el ${esc(a.hasta)}`}</span>
        </h2>
        <div class="desliza"><table class="captura">
          <thead><tr><th class="fila-titulo">Qué</th><th>Cuántos</th></tr></thead>
          <tbody>${a.tipos.map((t) => `
            <tr><td class="fila-titulo">${esc(t.etiqueta)}</td><td>${t.cuantos}</td></tr>`).join('')}
          </tbody>
        </table></div>
        ${a.reaperturas.length ? `
          <div class="explica">
            <b>Se reabrió o se corrigió ${a.reaperturas.length} vez(ces)</b>, y cada una dice por qué:
            <div class="desliza"><table class="captura">
              <thead><tr><th class="fila-titulo">Cuándo</th><th>Módulo</th><th>Documento</th>
                <th>Qué pasó</th><th>Motivo</th><th>Quién</th></tr></thead>
              <tbody>${a.reaperturas.map((r) => `
                <tr>
                  <td class="fila-titulo">${esc((r.en || '').slice(0, 10))}</td>
                  <td>${esc(r.de)}</td>
                  <td>${esc(r.documento)}</td>
                  <td>${esc(r.que)}</td>
                  <td>${esc(r.nota || '—')}</td>
                  <td>${esc(r.quien || '—')}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          </div>` : ''}
        ${a.paquetes.length ? `
          <div class="explica">
            <b>Paquetes armados</b>
            ${a.paquetes.map((q) => `
              <div class="paquete-armado">
                <span><b>${esc(q.etiqueta)}</b> · ${esc(cuando(q.armado_en))} ·
                  ${q.archivos.length} archivo(s) · ${q.fotos} foto(s) · ${esc(peso(q.bytes))}</span>
                <span class="fila-botones">
                  ${q.archivos.map((f) => `
                    <button class="btn" data-bajar="${esc(f.nombre)}" data-anio="${esc(q.clave)}">${esc(f.nombre)}</button>`).join('')}
                </span>
              </div>`).join('')}
          </div>` : ''}
        <div class="fila-botones" style="padding:0 18px 18px; align-items:flex-end">
          <label class="campo" style="margin:0; min-width:260px">
            <span style="font-size:13px; color:var(--tinta-suave)">Qué empacar</span>
            <select data-periodo-de="${esc(a.anio)}">
              ${d.grupos_periodo.map((g) => {
    const suyos = a.periodos.filter((x) => x.grupo === g.clave);
    if (!suyos.length) return '';
    const opciones = suyos.map((x) => `
      <option value="${esc(x.clave)}">${esc(x.etiqueta)} · ${x.cuantos} documento(s)${
  a.paquetes.some((q) => q.clave === x.clave) ? ' · ya armado' : ''}</option>`).join('');
    return g.clave === 'anio' ? opciones : `<optgroup label="${esc(g.etiqueta)}">${opciones}</optgroup>`;
  }).join('')}
            </select>
          </label>
          <button class="btn primario" data-armar="${esc(a.anio)}" ${d.en_prueba ? 'disabled' : ''}>
            Armar el paquete</button>
        </div>
      </section>`).join('')
      : '<div class="panel"><div class="vacio">Todavía no hay nada cerrado que resguardar.</div></div>'}`;

  destino.querySelectorAll('[data-armar]').forEach((b) => {
    b.addEventListener('click', async () => {
      const selector = destino.querySelector(`[data-periodo-de="${b.dataset.armar}"]`);
      const cual = selector ? selector.value : b.dataset.armar;
      b.disabled = true;
      b.textContent = 'Armando…';
      try {
        const r = await api('POST', `/api/resguardo/${encodeURIComponent(cual)}`);
        mostrarMensaje(r.mensaje, 'exito');
        await recargarResguardo();
      } catch (err) {
        mostrarMensaje(err.message, 'error');
        await recargarResguardo();
      }
    });
  });

  destino.querySelectorAll('[data-bajar]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/resguardo/${b.dataset.anio}/archivo/${b.dataset.bajar}`,
          { headers: { Authorization: `Bearer ${estado.token}` } });
        if (!res.ok) throw new Error('Ese archivo ya no está.');
        const url = URL.createObjectURL(await res.blob());
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = b.dataset.bajar;
        enlace.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (err) { mostrarMensaje(err.message, 'error'); }
    });
  });
}

const RUTAS = [
  [/^#\/menu$/, vistaMenu],
  [/^#\/resguardo$/, vistaResguardo, 'config_resguardo'],
  [/^#\/bahia$/, vistaBahia, 'mod_bahia'],
  [/^#\/bahia\/unidades$/, vistaBahiaUnidades, 'mod_bahia'],
  [/^#\/bahia\/personal$/, vistaBahiaPersonal, 'mod_bahia'],
  [/^#\/reportes\/bahia$/, vistaReporteBahia, 'bahia_reportes'],
  // Liberar claves no cuelga de Configuración: quien solo tiene ese permiso
  // entra aquí sin que se le abra todo lo demás.
  [/^#\/accesos$/, vistaAccesos, 'claves_liberar'],
  [/^#\/reportes\/accesos$/, vistaReporteAccesos, 'accesos_reportes'],
  [/^#\/acceso$/, vistaAcceso, null, false],
  [/^#\/acceso\/([\w-]+)$/, vistaAcceso, null, false],
  // Dirección vieja: lleva a los checklists dentro de Logística.
  [/^#\/checklists$/, vistaChecklists, 'llenar'],
  [/^#\/llenar\/([\w-]+)(?:\/(\d+))?$/, vistaLlenar, 'llenar'],
  [/^#\/envios\/([\w-]+)$/, vistaEnvios, 'llenar'],
  [/^#\/envio\/(\d+)$/, vistaEnvio, 'llenar'],
  [/^#\/reportes$/, vistaIndiceReportes, 'mod_reportes'],
  [/^#\/reportes\/checklists$/, vistaReportes, 'reportes'],
  [/^#\/reportes\/comparativa$/, vistaComparativa, 'comparativa'],
  [/^#\/reportes\/calidad$/, vistaCalidadReportes, 'calidad_reportes'],
  [/^#\/detalle\/(\d+)$/, vistaDetalle, 'reportes'],
  [/^#\/checklists\/revisar\/(\d+)$/, vistaRevisarChecklist, 'checklists_aprobar'],
  [/^#\/config-editor\/(\d+)$/, vistaEditorChecklist, 'config_editar_checklists'],
  [/^#\/calidad$/, vistaCalidad, 'mod_calidad'],
  [/^#\/calidad\/pendientes$/, vistaCalidadPendientes, 'mod_calidad'],
  [/^#\/calidad\/devoluciones$/, vistaCalidadDevoluciones, 'mod_calidad'],
  [/^#\/calidad\/devolucion\/(\d+)$/, vistaCalidadDevolucion, 'mod_calidad'],
  // Direcciones viejas de cuando los reportes colgaban de su módulo. Se
  // conservan porque hay tablets con la pantalla abierta y bookmarks hechos.
  [/^#\/calidad\/reportes$/, vistaCalidadReportes, 'calidad_reportes'],
  [/^#\/comparativa$/, vistaComparativa, 'comparativa'],
  [/^#\/recepcion\/(\d+)$/, vistaRecepcion, 'mod_calidad'],
  // Calidad re-ingresa los retiros que llegan y pide la baja del material
  // dañado. Quien solo tiene esos permisos entra sin tener todo Calidad.
  [/^#\/calidad\/reingresos$/, vistaCalidadReingresos,
    ['mod_calidad', 'reingresos_capturar', 'reingresos_aprobar']],
  [/^#\/calidad\/reingreso\/(\d+)$/, vistaCalidadReingreso,
    ['mod_calidad', 'reingresos_capturar', 'reingresos_aprobar']],
  [/^#\/calidad\/salidas$/, () => vistaAlmacenLista('salida_calidad'),
    ['mod_calidad', 'calidad_salida_pedir', 'calidad_salida_aprobar']],
  [/^#\/calidad\/salida\/(\d+)$/, (id) => vistaAlmacenDocumento('salida_calidad', id),
    ['mod_calidad', 'calidad_salida_pedir', 'calidad_salida_aprobar']],

  // Almacén. La lista y el detalle de entradas, salidas y devoluciones son la
  // misma pantalla con distinto tipo: ver DOCUMENTOS.
  [/^#\/notificaciones$/, vistaNotificaciones, 'mod_notificaciones'],
  [/^#\/pruebas$/, vistaPruebas],
  [/^#\/notificaciones\/atendidas$/, () => vistaNotificaciones('atendidas'), 'mod_notificaciones'],
  [/^#\/almacen$/, vistaAlmacen, 'mod_almacen'],
  [/^#\/almacen\/inventario(?:\/([\w-]+))?$/, vistaAlmacenInventario, 'mod_almacen'],
  [/^#\/almacen\/carga-inicial$/, vistaCargaInicial, 'almacen_carga_inicial'],
  [/^#\/almacen\/traspasos$/, vistaAlmacenTraspasos, 'mod_almacen'],
  // El traspaso lo abre también quien tiene un paso de él sin entrar a Almacén:
  // Tránsito para cargarlo, un Team Leader para confirmar que llegó.
  [/^#\/almacen\/traspaso\/(\d+)$/, vistaAlmacenTraspaso,
    ['mod_almacen', 'traspasos_aprobar', 'traspasos_cargar', 'traspasos_confirmar']],
  [/^#\/almacen\/entradas$/, () => vistaAlmacenLista('entrada'), 'mod_almacen'],
  [/^#\/almacen\/entrada\/(\d+)$/, (id) => vistaAlmacenDocumento('entrada', id), 'mod_almacen'],
  // Los retiros son su propio apartado: el camino de uno no se parece al de una
  // entrada de proveedor, aunque por debajo compartan tabla.
  [/^#\/almacen\/retiros$/, () => vistaAlmacenLista('retiro'), 'mod_almacen'],
  [/^#\/almacen\/retiro\/(\d+)$/, (id) => vistaAlmacenDocumento('retiro', id), 'mod_almacen'],
  // El consolidado de un producto, con su periodo en la dirección para poder
  // compartir el enlace ya filtrado.
  [/^#\/almacen\/producto\/(\d+)(?:\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2}))?$/, vistaAlmacenProducto, 'mod_almacen'],
  [/^#\/almacen\/salidas$/, () => vistaAlmacenLista('salida'), 'mod_almacen'],
  [/^#\/almacen\/salida\/(\d+)$/, (id) => vistaAlmacenDocumento('salida', id), 'mod_almacen'],
  [/^#\/almacen\/devoluciones$/, () => vistaAlmacenLista('devolucion'), 'mod_almacen'],
  [/^#\/almacen\/devolucion\/(\d+)$/, (id) => vistaAlmacenDocumento('devolucion', id), 'mod_almacen'],
  [/^#\/almacen\/conteos$/, vistaAlmacenConteos, 'mod_almacen'],
  [/^#\/almacen\/conteo\/(\d+)$/, vistaAlmacenConteo, 'mod_almacen'],
  [/^#\/ventas-fuera$/, vistaVxf, ['mod_ventas_fuera', 'ventas_fuera_capturar', 'ventas_fuera_armar', 'ventas_fuera_autorizar']],
  [/^#\/ventas-fuera\/clientes$/, vistaVxfClientes, 'ventas_fuera_clientes'],
  [/^#\/ventas-fuera\/orden\/(\d+)$/, vistaVxfOrden, ['mod_ventas_fuera', 'ventas_fuera_capturar', 'ventas_fuera_armar', 'ventas_fuera_autorizar']],
  [/^#\/incidencias$/, () => vistaIncidencias(null), 'mod_incidencias'],
  [/^#\/incidencias\/(\d{4}-\d{2})$/, vistaIncidencias, 'mod_incidencias'],
  [/^#\/logistica$/, vistaLogistica, 'mod_logistica'],
  [/^#\/logistica\/unidad\/(\d+)(?:\/([\w-]+))?$/, vistaLogisticaUnidad, 'mod_logistica'],
  // Quien solo llena checklists entra aquí sin tener todo Logística.
  [/^#\/logistica\/unidades(?:\/([\w-]+))?$/, vistaLogisticaUnidades, 'mod_logistica'],
  [/^#\/logistica\/checklists$/, vistaLogisticaChecklists, ['mod_logistica', 'llenar']],
  [/^#\/logistica\/cargas$/, vistaLogisticaCargas, 'mod_logistica'],
  [/^#\/logistica\/servicios$/, vistaLogisticaServicios, 'mod_logistica'],
  [/^#\/logistica\/rutas(?:\/(\d{4}-\d{2}-\d{2}))?$/, vistaLogisticaRutas, 'mod_logistica'],
  [/^#\/logistica\/desempeno$/, vistaLogisticaDesempeno, 'logistica_reportes'],
  [/^#\/produccion$/, vistaProduccion, 'mod_produccion'],
  [/^#\/produccion\/odt$/, () => vistaProduccionODT(null), 'mod_produccion'],
  [/^#\/produccion\/odt\/(\d+)(?:\/([\w-]+))?$/, vistaProduccionODT, 'mod_produccion'],
  [/^#\/reportes\/almacen$/, vistaAlmacenReportes, 'almacen_reportes'],
  [/^#\/reportes\/transito$/, vistaTransitoReportes, 'transito_reportes'],
  [/^#\/reportes\/produccion$/, vistaProduccionReportes, 'produccion_reportes'],
  [/^#\/reportes\/ventas-fuera$/, vistaVxfReportes, 'ventas_fuera_reportes'],
  [/^#\/reportes\/transito\/envio\/(\d+)$/, (id) => vistaDetalle(id, '#/reportes/transito'), 'transito_reportes'],
  [/^#\/reportes\/incidencias$/, () => vistaIncidenciasReportes(null), 'incidencias_reportes'],
  [/^#\/reportes\/incidencias\/(\d{4}-\d{2})$/, vistaIncidenciasReportes, 'incidencias_reportes'],
  [/^#\/config(?:\/([\w-]+))?$/, vistaConfig, 'configuracion'],
];

// Rutas que solo se alcanzan comprobando identidad. Al abandonarlas se cierra la
// sesión: si no, el administrador dejaría la tablet con su sesión abierta y el
// siguiente entraría a Checklists como él sin capturar ningún PIN.
const RUTAS_REAUTENTICADAS = /^#\/config/;
let hashAnterior = '';
// La última pantalla que se terminó de pintar. Sirve para distinguir «me fui a
// otro lado» de «esto se repintó solo»: en el primer caso se empieza arriba, en
// el segundo se vuelve a donde estaba.
let pantallaPintada = '';

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

  if (coincidencia.permisoRuta && ![].concat(coincidencia.permisoRuta).some((k) => permiso(k))) {
    encabezado('Sin acceso', (estado.usuario && estado.usuario.etiqueta_rol) || '');
    vista.innerHTML = avisoError('Tu perfil no tiene acceso a esta sección.')
      + '<button class="btn primario" data-al-menu>Volver al menú</button>';
    vista.querySelector('[data-al-menu]').addEventListener('click', () => { location.hash = '#/menu'; });
    return;
  }

  // Antes se vaciaba la pantalla y se ponía «Cargando…». Eso encoge la página,
  // la manda al principio y parpadea: en la tablet, cada vez que se guardaba
  // algo había que volver a bajar hasta donde se estaba trabajando. Ahora se
  // queda lo que hay —la cinta de arriba dice que está cargando— y se cambia
  // cuando el contenido nuevo ya está listo.
  //
  // Si es la misma pantalla —se repintó sola al guardar— se vuelve a donde
  // estaba; si es otra, se empieza desde arriba, que es lo natural.
  const mismaPantalla = hash === pantallaPintada;
  const altura = window.scrollY;
  moverCintaDeEspera(1);
  try {
    await cargarFotosProductos();
    await coincidencia.fn(...coincidencia.m.slice(1));
  } catch (err) {
    vista.innerHTML = avisoError(err.message);
  } finally {
    moverCintaDeEspera(-1);
  }
  window.scrollTo({ top: mismaPantalla ? altura : 0 });
  pantallaPintada = hash;
  pintarNavegacion();
}

window.addEventListener('hashchange', enrutar);
window.addEventListener('beforeunload', descargarPendientes);
window.addEventListener('beforeunload', descargarLotes);
conectarCaptura();
dormir();
