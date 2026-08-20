'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const { db, FOTOS_DIR } = require('./db');
const { sembrar } = require('./seed');
const { semanaISO, hoyISO, periodoASemana, describirSemana, ultimasSemanas } = require('./fechas');

// ------------------------------------------------------------------ permisos

// Única definición de qué puede hacer cada rol. Los permisos que empiezan con
// 'mod_' abren un módulo del menú; el resto son funciones dentro de un módulo.
// El perfil da la base; en Configuración se puede otorgar o quitar cualquiera
// de estos a una persona en particular.
const PERMISOS = {
  operador: {
    etiqueta: 'Operador',
    descripcion: 'Llena y firma sus checklists',
    mod_checklists: true,
    llenar: true,
    firmar_operador: true,
  },
  team_leader: {
    etiqueta: 'Team Leader',
    descripcion: 'Llena, autoriza salidas y consulta Reportes',
    mod_checklists: true,
    llenar: true,
    firmar_operador: true,
    firmar_supervision: true,
    reportes: true,
  },
  admin: {
    etiqueta: 'Administrador',
    descripcion: 'Todo, incluida la Configuración',
    mod_checklists: true,
    mod_inventario: true,
    mod_ventas_fuera: true,
    mod_calidad: true,
    mod_odt: true,
    mod_configuracion: true,
    llenar: true,
    firmar_operador: true,
    firmar_supervision: true,
    reportes: true,
    comparativa: true,
    configuracion: true,
  },
};

// Catálogo de permisos que se pueden otorgar o quitar por persona, agrupados
// para que la pantalla de Configuración los presente con sentido.
const CATALOGO_PERMISOS = [
  {
    grupo: 'Módulos',
    ayuda: 'Qué aparece en el menú de esa persona.',
    permisos: [
      { clave: 'mod_checklists', etiqueta: 'Checklists' },
      { clave: 'mod_inventario', etiqueta: 'Inventario' },
      { clave: 'mod_ventas_fuera', etiqueta: 'Ventas por fuera' },
      { clave: 'mod_calidad', etiqueta: 'Calidad' },
      { clave: 'mod_odt', etiqueta: 'ODT de la semana' },
      { clave: 'mod_configuracion', etiqueta: 'Configuración', solo_admin: true },
    ],
  },
  {
    grupo: 'Dentro de Checklists',
    ayuda: 'Funciones del módulo de Checklists.',
    permisos: [
      { clave: 'llenar', etiqueta: 'Llenar checklists' },
      { clave: 'firmar_supervision', etiqueta: 'Autorizar salidas y cerrar Tránsito' },
      { clave: 'reportes', etiqueta: 'Reportes' },
      { clave: 'comparativa', etiqueta: 'Comparativa entre semanas' },
    ],
  },
];

const PERMISOS_VALIDOS = new Set(CATALOGO_PERMISOS.flatMap((g) => g.permisos.map((p) => p.clave)));

const ETIQUETA_DE_PERMISO = Object.fromEntries(
  CATALOGO_PERMISOS.flatMap((g) => g.permisos.map((p) => [p.clave, p.etiqueta]))
);

// Ver información de toda la operación obliga a tener PIN, venga del perfil o de
// un permiso individual.
const PERMISOS_SENSIBLES = ['reportes', 'comparativa', 'configuracion', 'mod_configuracion'];

// Se permiten letras además de dígitos: el equipo usa claves con significado
// (área + año + iniciales). Obligarlas a ser numéricas invalidaría las que ya
// están en uso. La pantalla de acceso deja teclear, no solo tocar el teclado.
const PIN_VALIDO = /^[A-Za-z0-9]{4,12}$/;

// 'configuracion' no está en el catálogo (no se otorga suelto: va con el módulo),
// pero sí se muestra en el resumen de accesos de cada persona.
ETIQUETA_DE_PERMISO.configuracion = 'Configuración';

// Los ajustes por persona se guardan como {permiso: true|false}, para poder
// tanto otorgar algo que el perfil no da como quitar algo que sí da.
function leerAjustes(crudo) {
  try {
    const datos = JSON.parse(crudo || '{}');
    // Formato viejo: arreglo de permisos otorgados. Se interpreta como todos en true.
    if (Array.isArray(datos)) {
      return Object.fromEntries(datos.filter((k) => PERMISOS_VALIDOS.has(k)).map((k) => [k, true]));
    }
    return Object.fromEntries(
      Object.entries(datos).filter(([k]) => PERMISOS_VALIDOS.has(k)).map(([k, v]) => [k, !!v])
    );
  } catch {
    return {};
  }
}

function permisosDe(rol, permisosExtra) {
  const base = PERMISOS[rol] || PERMISOS.operador;
  return { ...base, ...leerAjustes(permisosExtra) };
}

const exigePin = (rol, permisosExtra) => {
  const p = permisosDe(rol, permisosExtra);
  return PERMISOS_SENSIBLES.some((clave) => p[clave]);
};

// -------------------------------------------------------------- módulos

// El menú de la tablet. Agregar un módulo nuevo es agregar un renglón aquí:
// aparece solo en el menú y su acceso queda controlado por 'permiso'.
// 'disponible: false' lo muestra como Próximamente, sin dejar entrar.
const MODULOS = [
  {
    clave: 'checklists',
    nombre: 'Checklists',
    descripcion: 'Inspección de unidades, montacargas, tránsito e insumos',
    permiso: 'mod_checklists',
    disponible: true,
    icono: 'checklist',
  },
  {
    clave: 'inventario',
    nombre: 'Inventario',
    descripcion: 'Existencias, entradas y salidas de almacén',
    permiso: 'mod_inventario',
    disponible: false,
    icono: 'cajas',
  },
  {
    clave: 'ventas_fuera',
    nombre: 'Ventas por fuera',
    descripcion: 'Entregas locales de INKO y TERMIKO',
    permiso: 'mod_ventas_fuera',
    disponible: false,
    icono: 'camion',
  },
  {
    clave: 'calidad',
    nombre: 'Calidad',
    descripcion: 'Muestreo, pruebas e incidencias',
    permiso: 'mod_calidad',
    disponible: false,
    icono: 'calidad',
  },
  {
    clave: 'odt',
    nombre: 'ODT de la semana',
    descripcion: 'Órdenes de trabajo y programación',
    permiso: 'mod_odt',
    disponible: false,
    icono: 'orden',
  },
  {
    clave: 'configuracion',
    nombre: 'Configuración',
    descripcion: 'Personas, unidades y checklists del sistema',
    permiso: 'mod_configuracion',
    disponible: true,
    icono: 'ajustes',
    restringido: true,
    // Siempre vuelve a pedir identidad, aunque ya haya alguien con sesión
    // abierta. Desde aquí se dan de alta personas y se otorgan permisos: no
    // basta con que la tablet traiga una sesión, hay que comprobar quién entra.
    reautenticar: true,
  },
];

// La segunda firma del checklist de montacargas (en papel, "Firma del
// Coordinador") es una autorización de supervisión. Como el perfil de
// coordinador ya no existe, la firma la levanta el Team Leader o el
// Administrador. La clave guardada sigue siendo 'coordinador' para no romper
// las firmas ya capturadas ni la columna firma_coordinador de plantillas.
const PERMISO_DE_FIRMA = {
  operador: 'firmar_operador',
  coordinador: 'firmar_supervision',
};

// Los permisos efectivos se calculan al entrar y viajan en la sesión, así que
// aquí solo se consultan.
const puede = (usuario, permiso) => !!(usuario && usuario.permisos && usuario.permisos[permiso]);

const PUERTO = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

sembrar();

// ---------------------------------------------------------------- utilidades

// Columnas de captura por tipo de plantilla. 'items' guarda una sola respuesta
// por ítem; 'matriz' y 'grid_semanal' guardan una por día/columna.
const COLUMNAS = {
  items: [{ clave: '-', etiqueta: '' }],
  matriz: [
    { clave: 'inicio', etiqueta: 'Inicio semana' },
    { clave: 'L', etiqueta: 'Lunes' },
    { clave: 'M', etiqueta: 'Martes' },
    { clave: 'X', etiqueta: 'Miércoles' },
    { clave: 'quedan', etiqueta: '¿Cuántas quedan?' },
    { clave: 'J', etiqueta: 'Jueves' },
    { clave: 'V', etiqueta: 'Viernes' },
    { clave: 'cierre', etiqueta: 'Cierre semana' },
  ],
  grid_semanal: [
    { clave: 'L', etiqueta: 'Lun' },
    { clave: 'M', etiqueta: 'Mar' },
    { clave: 'X', etiqueta: 'Mié' },
    { clave: 'J', etiqueta: 'Jue' },
    { clave: 'V', etiqueta: 'Vie' },
  ],
};

function periodoActual(frecuencia) {
  return frecuencia === 'diario' ? hoyISO() : semanaISO();
}

// Los ítems traen marcadores {psi} / {aceite} que se rellenan con los atributos
// de la unidad. Así ISUZU dice "95 psi" y PARTNER "30 psi" con el mismo ítem.
function interpolar(texto, atributos) {
  return texto.replace(/\{(\w+)\}/g, (coincidencia, llave) => {
    const valor = atributos[llave];
    return valor === undefined || valor === null ? '' : String(valor);
  }).replace(/\s{2,}/g, ' ').trim();
}

// -------------------------------------------------------------- sesiones

// Sesiones en memoria. Esto NO es una frontera de seguridad real: la app está
// pensada para la red local del almacén. Si algún día se expone a internet,
// hay que sustituir esto por autenticación con contraseñas hasheadas.
const sesiones = new Map();
const DURACION_SESION = 12 * 60 * 60 * 1000;

function crearSesion(usuario) {
  const token = crypto.randomBytes(24).toString('hex');
  sesiones.set(token, { usuario, expira: Date.now() + DURACION_SESION });
  return token;
}

function leerSesion(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesiones.delete(token); return null; }
  return s.usuario;
}

// Devuelve el usuario si tiene el permiso; si no, responde el error y devuelve
// null para que el manejador corte. Todas las rutas pasan por aquí, así que no
// hay forma de olvidar un chequeo comparando strings de rol a mano.
function exigir(req, res, permiso) {
  const usuario = leerSesion(req);
  if (!usuario) {
    json(res, 401, { error: 'Sesión expirada' });
    return null;
  }
  if (permiso && !puede(usuario, permiso)) {
    json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
    return null;
  }
  return usuario;
}

// ------------------------------------------------------------------ consultas

// Una sección puede depender de un dato de cabecera: en Tránsito, la
// preparación que se revisa cambia según sea Cita en CEDIS o Venta por fuera.
function seccionAplica(seccion, datos) {
  if (!seccion.condicion) return true;
  try {
    const { campo, valor } = JSON.parse(seccion.condicion);
    return (datos || {})[campo] === valor;
  } catch {
    return true;
  }
}

function plantillaCompleta(clave, activoId, datos = null) {
  const plantilla = db.prepare('SELECT * FROM plantillas WHERE clave = ? AND activo = 1').get(clave);
  if (!plantilla) return null;

  let activo = null;
  let atributos = {};
  if (activoId) {
    activo = db.prepare('SELECT * FROM activos WHERE id = ?').get(Number(activoId));
    if (activo) atributos = JSON.parse(activo.atributos);
  }

  const secciones = db
    .prepare('SELECT * FROM secciones WHERE plantilla_id = ? AND activo = 1 ORDER BY orden')
    .all(plantilla.id);
  const traerItems = db.prepare('SELECT * FROM items WHERE seccion_id = ? AND activo = 1 ORDER BY orden');

  for (const seccion of secciones) {
    seccion.items = traerItems
      .all(seccion.id)
      .filter((item) => {
        if (!item.solo_activos) return true;
        if (!activo) return false;
        return JSON.parse(item.solo_activos).includes(activo.clave);
      })
      .map((item) => ({
        id: item.id,
        texto: interpolar(item.texto, atributos),
        tipo_respuesta: item.tipo_respuesta,
        meta: JSON.parse(item.meta),
      }));
  }

  return {
    ...plantilla,
    campos: JSON.parse(plantilla.campos || '[]'),
    columnas: COLUMNAS[plantilla.tipo_captura],
    secciones: secciones
      .filter((s) => s.items.length > 0)
      .filter((s) => datos === null || seccionAplica(s, datos)),
    activo,
  };
}

// --- checklists por etapas ---

const ETAPAS = {
  borrador: { siguiente: 'en_ruta', etiqueta: 'Preparando salida' },
  en_ruta: { siguiente: 'cerrado', etiqueta: 'En ruta' },
  cerrado: { siguiente: null, etiqueta: 'Concluido' },
};

// Qué secciones tocan según el estado. Una plantilla sin etapas muestra todo
// siempre; una por etapas revela el regreso solo cuando la unidad ya salió.
const etapaDelEstado = (estado) => (estado === 'borrador' ? 'salida' : 'regreso');

// Los campos de opciones guardan una clave ('cita_cedis'); en pantalla debe
// verse su etiqueta ('Cita en CEDIS').
function describirDatos(campos, datos) {
  return campos
    .map((c) => {
      const valor = (datos || {})[c.clave];
      if (!valor) return null;
      if (!c.opciones) return valor;
      return (c.opciones.find((o) => o.valor === valor) || {}).etiqueta || valor;
    })
    .filter(Boolean)
    .join(' · ');
}

const consultaEtapaItem = db.prepare(`
  SELECT s.etapa FROM items i JOIN secciones s ON s.id = i.seccion_id WHERE i.id = ?
`);
const etapaDelItem = (itemId) => (consultaEtapaItem.get(itemId) || {}).etapa || 'salida';

// Comprueba lo que exige una etapa concreta: ítems contestados, problemas
// explicados y con foto, y documentos adjuntos.
function faltantesDeEtapa(llenadoId, plantilla, etapa, datos = {}) {
  const filtroEtapa = plantilla.por_etapas ? 'AND s.etapa = ?' : '';
  const args = plantilla.por_etapas ? [plantilla.id, etapa] : [plantilla.id];

  const items = db.prepare(`
    SELECT i.id, i.texto, i.tipo_respuesta, s.condicion
    FROM items i JOIN secciones s ON s.id = i.seccion_id
    WHERE s.plantilla_id = ? ${filtroEtapa} AND i.activo = 1 AND s.activo = 1
    ORDER BY s.orden, i.orden
  `).all(...args).filter((i) => seccionAplica(i, datos));

  const respuestas = new Map(
    db.prepare('SELECT item_id, valor, observacion FROM respuestas WHERE llenado_id = ?')
      .all(llenadoId).map((r) => [r.item_id, r])
  );
  const conFoto = new Set(
    db.prepare('SELECT DISTINCT item_id FROM fotos WHERE llenado_id = ? AND item_id IS NOT NULL')
      .all(llenadoId).map((f) => f.item_id)
  );

  const faltas = [];
  for (const item of items) {
    if (item.tipo_respuesta === 'documento') {
      if (!conFoto.has(item.id)) faltas.push({ tipo: 'documento', texto: item.texto });
      continue;
    }
    const r = respuestas.get(item.id);
    if (!r || r.valor === null || r.valor === '') continue; // sin contestar no bloquea
    if (r.valor === 'problema' || r.valor === 'no') {
      if (!r.observacion || !r.observacion.trim()) faltas.push({ tipo: 'observacion', texto: item.texto });
      else if (plantilla.foto_obligatoria && item.tipo_respuesta === 'ok_problema' && !conFoto.has(item.id)) {
        faltas.push({ tipo: 'foto', texto: item.texto });
      }
    }
  }
  return faltas;
}

function mensajeDeFaltantes(faltas) {
  const porTipo = {
    documento: 'Falta adjuntar',
    observacion: 'Falta describir el problema en',
    foto: 'Falta la foto de evidencia en',
  };
  const grupos = ['documento', 'observacion', 'foto']
    .map((t) => {
      const lista = faltas.filter((f) => f.tipo === t);
      if (!lista.length) return null;
      return `${porTipo[t]}: ${lista.map((f) => `«${f.texto}»`).join(', ')}`;
    })
    .filter(Boolean);
  return grupos.join('. ') + '.';
}

function fotosDe(llenadoId) {
  return db.prepare(`
    SELECT f.id, f.item_id, f.columna, f.archivo, f.bytes, f.subida_en, u.nombre AS subida_por
    FROM fotos f LEFT JOIN usuarios u ON u.id = f.subida_por
    WHERE f.llenado_id = ? ORDER BY f.id
  `).all(llenadoId);
}

function llenadoConDatos(id) {
  const llenado = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!llenado) return null;
  llenado.datos = JSON.parse(llenado.datos || '{}');
  const quien = db.prepare('SELECT nombre FROM usuarios WHERE id = ?');
  llenado.autorizo = llenado.autorizado_por ? (quien.get(llenado.autorizado_por) || {}).nombre : null;
  llenado.cerro = llenado.cerrado_por ? (quien.get(llenado.cerrado_por) || {}).nombre : null;
  llenado.respuestas = db.prepare('SELECT item_id, columna, valor, observacion FROM respuestas WHERE llenado_id = ?').all(id);
  llenado.firmas = db.prepare('SELECT rol, nombre, imagen, firmado_en FROM firmas WHERE llenado_id = ?').all(id);
  llenado.fotos = fotosDe(id);
  return llenado;
}

function obtenerOCrearLlenado({ plantillaId, activoId, periodo, usuarioId, referencia = null, datos = {} }) {
  const existente = db
    .prepare(`SELECT * FROM llenados
              WHERE plantilla_id = ? AND COALESCE(activo_id, 0) = ? AND periodo = ?
                AND COALESCE(referencia, '') = ?`)
    .get(plantillaId, activoId || 0, periodo, referencia || '');
  if (existente) return llenadoConDatos(existente.id);

  const { lastInsertRowid } = db
    .prepare(`INSERT INTO llenados (plantilla_id, activo_id, usuario_id, periodo, semana,
                                    referencia, datos, creado_en)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(plantillaId, activoId || null, usuarioId, periodo, periodoASemana(periodo),
      referencia, JSON.stringify(datos || {}), new Date().toISOString());
  return llenadoConDatos(Number(lastInsertRowid));
}

// -------------------------------------------------------------------- ruteo

const rutas = [];
const ruta = (metodo, patron, manejador) =>
  rutas.push({ metodo, patron: new RegExp(`^${patron}$`), manejador });

ruta('POST', '/api/entrar', (req, res, _p, cuerpo) => {
  const fila = db
    .prepare('SELECT id, nombre, rol, pin, permisos_extra FROM usuarios WHERE id = ? AND activo = 1')
    .get(Number(cuerpo.usuario_id));
  if (!fila) return json(res, 404, { error: 'Usuario no encontrado' });
  if (fila.pin && fila.pin !== String(cuerpo.pin || '')) {
    return json(res, 401, { error: 'PIN incorrecto' });
  }

  const permisos = permisosDe(fila.rol, fila.permisos_extra);
  const usuario = {
    id: fila.id,
    nombre: fila.nombre,
    rol: fila.rol,
    etiqueta_rol: permisos.etiqueta,
    permisos,
  };
  json(res, 200, { token: crearSesion(usuario), usuario });
});

ruta('GET', '/api/inicio', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;

  const plantillas = db.prepare('SELECT * FROM plantillas WHERE activo = 1 ORDER BY orden').all();
  const activos = db.prepare('SELECT id, clave, nombre, tipo FROM activos WHERE activo = 1').all();
  const esViernes = new Date().getDay() === 5;

  const tarjetas = [];
  for (const p of plantillas) {
    const periodo = periodoActual(p.frecuencia);
    const campos = JSON.parse(p.campos || '[]');
    const disponible = p.frecuencia !== 'viernes' || esViernes;

    // Plantillas con datos de cabecera (Tránsito): puede haber varias al día,
    // pero en esta lista ocupan UNA tarjeta con su cuenta. El detalle vive
    // dentro de su propia pantalla, para no inundar la portada de checklists.
    if (campos.length) {
      const conteo = db.prepare(`
        SELECT
          SUM(CASE WHEN estado <> 'cerrado' THEN 1 ELSE 0 END) AS abiertos,
          SUM(CASE WHEN estado = 'cerrado'  THEN 1 ELSE 0 END) AS cerrados
        FROM llenados WHERE plantilla_id = ? AND periodo = ?
      `).get(p.id, periodo);

      tarjetas.push({
        plantilla_clave: p.clave,
        plantilla_nombre: p.nombre,
        descripcion: p.descripcion,
        frecuencia: p.frecuencia,
        periodo,
        estado: 'multiple',
        multiple: true,
        en_proceso: conteo.abiertos || 0,
        concluidos: conteo.cerrados || 0,
        disponible,
      });
      continue;
    }

    const unidades = p.aplica_a ? activos.filter((a) => a.tipo === p.aplica_a) : [null];
    for (const unidad of unidades) {
      const llenado = db
        .prepare(`SELECT id, estado FROM llenados
                  WHERE plantilla_id = ? AND COALESCE(activo_id, 0) = ? AND periodo = ?`)
        .get(p.id, unidad ? unidad.id : 0, periodo);
      tarjetas.push({
        plantilla_clave: p.clave,
        plantilla_nombre: p.nombre,
        descripcion: p.descripcion,
        frecuencia: p.frecuencia,
        activo_id: unidad ? unidad.id : null,
        activo_nombre: unidad ? unidad.nombre : null,
        periodo,
        estado: llenado ? llenado.estado : 'pendiente',
        llenado_id: llenado ? llenado.id : null,
        disponible,
      });
    }
  }
  json(res, 200, { usuario, tarjetas });
});

// El menú es público: es solo navegación, y la tablet vive en el almacén. La
// identificación ocurre al entrar a un módulo, no antes.
// El menú se arma con lo que esa persona puede abrir. Ya no es público: la
// identidad se comprueba antes del menú, así que cada quien ve solo lo suyo.
ruta('GET', '/api/modulos', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  json(res, 200, MODULOS
    .filter((m) => puede(usuario, m.permiso))
    .map(({ permiso, ...visible }) => visible));
});

// Lista de personas para la pantalla de acceso. Si se pide para un módulo, solo
// devuelve a quienes pueden entrar: así nadie escribe su PIN para que luego le
// digan que no tiene acceso.
ruta('GET', '/api/usuarios', (req, res) => {
  const url = new URL(req.url, 'http://x');
  const modulo = MODULOS.find((m) => m.clave === url.searchParams.get('modulo'));

  const personas = db
    .prepare('SELECT id, nombre, rol, pin, permisos_extra FROM usuarios WHERE activo = 1 ORDER BY nombre')
    .all()
    .filter((u) => !modulo || permisosDe(u.rol, u.permisos_extra)[modulo.permiso])
    // En un módulo que exige comprobar identidad, quien no tenga PIN no puede
    // ser comprobado: sin secreto no hay verificación posible.
    .filter((u) => !modulo || !modulo.reautenticar || u.pin !== null)
    .map((u) => {
      const permisos = permisosDe(u.rol, u.permisos_extra);
      return {
        id: u.id,
        nombre: u.nombre,
        rol: u.rol,
        etiqueta_rol: permisos.etiqueta,
        requiere_pin: u.pin !== null,
      };
    });

  json(res, 200, personas);
});

ruta('GET', '/api/plantillas/([\\w-]+)', (req, res, p) => {
  if (!exigir(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const plantilla = plantillaCompleta(p[1], url.searchParams.get('activo_id'));
  if (!plantilla) return json(res, 404, { error: 'Plantilla no encontrada' });
  json(res, 200, plantilla);
});

// Los llenados del periodo actual de una plantilla con cabecera. Es lo que ve la
// pantalla propia de Tránsito: los envíos en proceso arriba y los ya concluidos
// abajo, para consulta.
ruta('GET', '/api/plantillas/([\\w-]+)/llenados', (req, res, p) => {
  if (!exigir(req, res, 'llenar')) return;

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE clave = ? AND activo = 1').get(p[1]);
  if (!plantilla) return json(res, 404, { error: 'Plantilla no encontrada' });

  const campos = JSON.parse(plantilla.campos || '[]');
  const periodo = periodoActual(plantilla.frecuencia);

  const llenados = db.prepare(`
    SELECT l.id, l.estado, l.referencia, l.datos, l.salida_en, l.cerrado_en, l.creado_en,
           u.nombre AS quien
    FROM llenados l JOIN usuarios u ON u.id = l.usuario_id
    WHERE l.plantilla_id = ? AND l.periodo = ?
    ORDER BY l.creado_en
  `).all(plantilla.id, periodo).map((l) => {
    const datos = JSON.parse(l.datos || '{}');
    return { ...l, datos, resumen: describirDatos(campos, datos) || 'Sin datos de cabecera' };
  });

  json(res, 200, {
    plantilla: {
      clave: plantilla.clave,
      nombre: plantilla.nombre,
      descripcion: plantilla.descripcion,
      campos,
    },
    periodo,
    abiertos: llenados.filter((l) => l.estado !== 'cerrado'),
    cerrados: llenados.filter((l) => l.estado === 'cerrado'),
  });
});

ruta('POST', '/api/llenados', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE clave = ?').get(cuerpo.plantilla_clave);
  if (!plantilla) return json(res, 404, { error: 'Plantilla no encontrada' });

  // Los campos de cabecera se capturan antes que nada. Uno de ellos actúa como
  // referencia y es lo que permite tener varios checklists el mismo día.
  const campos = JSON.parse(plantilla.campos || '[]');
  const datos = {};
  let referencia = null;

  for (const campo of campos) {
    const valor = String((cuerpo.datos || {})[campo.clave] ?? '').trim();
    if (campo.requerido && !valor) {
      return json(res, 400, { error: `Captura «${campo.etiqueta}» antes de comenzar.` });
    }
    if (campo.opciones && valor && !campo.opciones.some((o) => o.valor === valor)) {
      return json(res, 400, { error: `«${campo.etiqueta}» no tiene ese valor.` });
    }
    datos[campo.clave] = valor;
    if (campo.referencia) referencia = valor;
  }

  const periodo = cuerpo.periodo || periodoActual(plantilla.frecuencia);
  const yaExiste = referencia && db
    .prepare(`SELECT id, estado FROM llenados WHERE plantilla_id = ? AND periodo = ? AND referencia = ?`)
    .get(plantilla.id, periodo, referencia);
  if (yaExiste && cuerpo.crear_nuevo) {
    return json(res, 409, {
      error: `Ya existe un checklist de hoy con esa referencia (${referencia}).`,
      llenado_id: yaExiste.id,
    });
  }

  json(res, 200, obtenerOCrearLlenado({
    plantillaId: plantilla.id,
    activoId: cuerpo.activo_id ? Number(cuerpo.activo_id) : null,
    periodo,
    usuarioId: usuario.id,
    referencia,
    datos,
  }));
});

// Abre un llenado existente por su id, para continuar capturándolo. Hace falta
// porque una plantilla con varios llenados al día (Tránsito) ya no se puede
// identificar solo por plantilla + periodo.
ruta('GET', '/api/llenados/(\\d+)/abrir', (req, res, p) => {
  if (!exigir(req, res, 'llenar')) return;
  const llenado = llenadoConDatos(Number(p[1]));
  if (!llenado) return json(res, 404, { error: 'Ese checklist no existe' });

  const plantilla = db.prepare('SELECT clave FROM plantillas WHERE id = ?').get(llenado.plantilla_id);
  json(res, 200, {
    llenado,
    plantilla: plantillaCompleta(plantilla.clave, llenado.activo_id, llenado.datos),
  });
});

ruta('PUT', '/api/llenados/(\\d+)/respuestas', (req, res, p, cuerpo) => {
  if (!exigir(req, res)) return;
  const llenado = db.prepare('SELECT estado FROM llenados WHERE id = ?').get(Number(p[1]));
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  if (llenado.estado === 'cerrado') return json(res, 409, { error: 'Este checklist ya fue cerrado' });

  // Con la salida ya autorizada, la inspección previa queda congelada: cambiarla
  // después equivaldría a reescribir el estado en que salió la unidad.
  if (llenado.estado === 'en_ruta') {
    const deSalida = (cuerpo.respuestas || []).some((r) => etapaDelItem(Number(r.item_id)) === 'salida');
    if (deSalida) {
      return json(res, 409, {
        error: 'La salida ya fue autorizada: la inspección previa no se puede modificar.',
      });
    }
  }

  const guardar = db.prepare(`
    INSERT INTO respuestas (llenado_id, item_id, columna, valor, observacion)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (llenado_id, item_id, columna)
    DO UPDATE SET valor = excluded.valor, observacion = excluded.observacion
  `);
  for (const r of cuerpo.respuestas || []) {
    guardar.run(Number(p[1]), Number(r.item_id), r.columna || '-', r.valor ?? null, r.observacion ?? null);
  }
  json(res, 200, { ok: true });
});

// Completa o corrige los datos de cabecera. Hace falta cuando se agrega un campo
// nuevo a una plantilla y hay checklists abiertos que aún no lo tienen: sin esto
// quedarían atorados sin poder mostrar su sección correspondiente.
ruta('PUT', '/api/llenados/(\\d+)/datos', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'llenar')) return;
  const id = Number(p[1]);

  const llenado = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  if (llenado.estado !== 'borrador') {
    return json(res, 409, { error: 'Los datos de cabecera solo se pueden capturar antes de autorizar la salida.' });
  }

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(llenado.plantilla_id);
  const campos = JSON.parse(plantilla.campos || '[]');
  const previos = JSON.parse(llenado.datos || '{}');
  const datos = {};
  let referencia = llenado.referencia;

  for (const campo of campos) {
    const valor = String((cuerpo.datos || {})[campo.clave] ?? previos[campo.clave] ?? '').trim();
    if (campo.requerido && !valor) {
      return json(res, 400, { error: `Captura «${campo.etiqueta}».` });
    }
    if (campo.opciones && valor && !campo.opciones.some((o) => o.valor === valor)) {
      return json(res, 400, { error: `«${campo.etiqueta}» no tiene ese valor.` });
    }
    datos[campo.clave] = valor;
    if (campo.referencia) referencia = valor;
  }

  try {
    db.prepare('UPDATE llenados SET datos = ?, referencia = ? WHERE id = ?')
      .run(JSON.stringify(datos), referencia, id);
  } catch {
    return json(res, 409, { error: 'Ya existe otro checklist de hoy con esa referencia.' });
  }
  json(res, 200, { ok: true });
});

ruta('PUT', '/api/llenados/(\\d+)/notas', (req, res, p, cuerpo) => {
  if (!exigir(req, res)) return;
  db.prepare('UPDATE llenados SET notas = ? WHERE id = ? AND estado = \'borrador\'').run(cuerpo.notas ?? null, Number(p[1]));
  json(res, 200, { ok: true });
});

ruta('POST', '/api/llenados/(\\d+)/firma', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;

  // Sin esto, cualquiera con sesión podría levantar la firma de supervisión
  // mandando otro rol en la petición. La firma es un control, no una etiqueta.
  const permisoNecesario = PERMISO_DE_FIRMA[cuerpo.rol];
  if (!permisoNecesario) return json(res, 400, { error: 'Tipo de firma desconocido' });
  if (!puede(usuario, permisoNecesario)) {
    return json(res, 403, {
      error: cuerpo.rol === 'coordinador'
        ? 'Solo un Team Leader o el Administrador puede levantar la firma de autorización.'
        : 'Tu perfil no puede firmar aquí.',
    });
  }

  if (!cuerpo.imagen || !String(cuerpo.imagen).startsWith('data:image/')) {
    return json(res, 400, { error: 'Firma inválida' });
  }
  db.prepare(`
    INSERT INTO firmas (llenado_id, rol, usuario_id, nombre, imagen, firmado_en)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (llenado_id, rol)
    DO UPDATE SET usuario_id = excluded.usuario_id, nombre = excluded.nombre,
                  imagen = excluded.imagen, firmado_en = excluded.firmado_en
  `).run(Number(p[1]), cuerpo.rol, usuario.id, cuerpo.nombre || usuario.nombre, cuerpo.imagen, new Date().toISOString());
  json(res, 200, { ok: true });
});

// --- evidencia fotográfica ---

// Las hojas de entrega llegan de dos formas: fotografiadas con la tablet o
// escaneadas en PDF desde la multifuncional. Se aceptan ambas.
const EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const LIMITE_FOTO = 6 * 1024 * 1024;

ruta('POST', '/api/llenados/(\\d+)/fotos', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;

  const llenadoId = Number(p[1]);
  const llenado = db.prepare(`
    SELECT l.estado, p.por_etapas FROM llenados l
    JOIN plantillas p ON p.id = l.plantilla_id WHERE l.id = ?
  `).get(llenadoId);
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  if (llenado.estado === 'cerrado') return json(res, 409, { error: 'Este checklist ya fue cerrado' });

  // Cada archivo pertenece a su etapa: la hoja de recepción no puede cargarse
  // antes de salir, ni la de autorización cambiarse una vez en ruta.
  if (llenado.por_etapas && cuerpo.item_id) {
    const etapaItem = etapaDelItem(Number(cuerpo.item_id));
    const etapaEnCurso = llenado.estado === 'borrador' ? 'salida' : 'regreso';
    if (etapaItem !== etapaEnCurso) {
      return json(res, 409, {
        error: etapaItem === 'regreso'
          ? 'Ese documento se carga al regresar, cuando la salida ya fue autorizada.'
          : 'La salida ya fue autorizada: los documentos previos no se modifican.',
      });
    }
  }

  const partes = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/
    .exec(cuerpo.imagen || '');
  if (!partes) return json(res, 400, { error: 'El archivo no es una imagen ni un PDF' });

  const binario = Buffer.from(partes[2], 'base64');
  if (binario.length === 0) return json(res, 400, { error: 'La imagen llegó vacía' });
  if (binario.length > LIMITE_FOTO) return json(res, 413, { error: 'La foto pesa demasiado' });

  // Nombre aleatorio: nunca se usa el que trae el dispositivo, así no hay forma
  // de que un nombre malicioso escriba fuera de datos/fotos.
  const archivo = `${crypto.randomBytes(16).toString('hex')}.${EXTENSION[partes[1]]}`;
  fs.writeFileSync(path.join(FOTOS_DIR, archivo), binario);

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO fotos (llenado_id, item_id, columna, archivo, bytes, subida_por, subida_en)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    llenadoId,
    cuerpo.item_id ? Number(cuerpo.item_id) : null,
    cuerpo.columna || '-',
    archivo, binario.length, usuario.id, new Date().toISOString()
  );

  json(res, 200, {
    id: Number(lastInsertRowid),
    archivo,
    item_id: cuerpo.item_id ? Number(cuerpo.item_id) : null,
    columna: cuerpo.columna || '-',
    bytes: binario.length,
    subida_por: usuario.nombre,
  });
});

ruta('DELETE', '/api/fotos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res)) return;

  const foto = db.prepare(`
    SELECT f.id, f.archivo, l.estado FROM fotos f
    JOIN llenados l ON l.id = f.llenado_id WHERE f.id = ?
  `).get(Number(p[1]));
  if (!foto) return json(res, 404, { error: 'Foto no encontrada' });
  if (foto.estado === 'cerrado') return json(res, 409, { error: 'El checklist ya fue cerrado' });

  db.prepare('DELETE FROM fotos WHERE id = ?').run(foto.id);
  fs.rm(path.join(FOTOS_DIR, foto.archivo), { force: true }, () => {});
  json(res, 200, { ok: true });
});

// El nombre se valida contra el patrón que genera la subida, así que aquí no
// puede colarse ni una ruta relativa ni una extensión inesperada.
ruta('GET', '/api/fotos/([a-f0-9]{32}\\.(?:jpg|png|webp|pdf))', (req, res, p) => {
  if (!exigir(req, res)) return;
  const archivo = path.join(FOTOS_DIR, p[1]);
  fs.readFile(archivo, (err, contenido) => {
    if (err) return json(res, 404, { error: 'Foto no encontrada' });
    res.writeHead(200, {
      'Content-Type': TIPOS_MIME['.' + p[1].split('.').pop()] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(contenido);
  });
});

// Autoriza la salida de la unidad. Cierra la etapa de salida pero NO el
// proceso: el checklist queda 'en_ruta' hasta que la unidad regrese.
ruta('POST', '/api/llenados/(\\d+)/autorizar-salida', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const id = Number(p[1]);

  const llenado = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(llenado.plantilla_id);

  if (!plantilla.por_etapas) return json(res, 400, { error: 'Este checklist no se llena por etapas.' });

  // Quien prepara el envío no autoriza su propia salida.
  if (plantilla.requiere_supervision && !puede(usuario, 'firmar_supervision')) {
    return json(res, 403, { error: 'Solo un Team Leader o el Administrador puede autorizar la salida.' });
  }

  if (llenado.estado !== 'borrador') {
    return json(res, 409, { error: 'La salida de este envío ya fue autorizada.' });
  }

  const faltas = faltantesDeEtapa(id, plantilla, 'salida', JSON.parse(llenado.datos || '{}'));
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas) });

  db.prepare("UPDATE llenados SET estado = 'en_ruta', salida_en = ?, autorizado_por = ? WHERE id = ?")
    .run(new Date().toISOString(), usuario.id, id);
  json(res, 200, { ok: true, estado: 'en_ruta' });
});

ruta('POST', '/api/llenados/(\\d+)/cerrar', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const id = Number(p[1]);

  const llenado = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  if (llenado.estado === 'cerrado') return json(res, 409, { error: 'Este checklist ya fue cerrado.' });

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(llenado.plantilla_id);

  if (plantilla.requiere_supervision && !puede(usuario, 'firmar_supervision')) {
    return json(res, 403, { error: 'Solo un Team Leader o el Administrador puede dar por concluido el proceso.' });
  }

  // En un checklist por etapas no se puede cerrar sin haber salido: primero se
  // autoriza la salida, y solo al regresar se concluye el proceso.
  if (plantilla.por_etapas && llenado.estado === 'borrador') {
    return json(res, 400, {
      error: 'Primero autoriza la salida. El proceso se cierra cuando la unidad regresa.',
    });
  }

  // Se revisa la etapa que toca; en una plantilla sin etapas, todo.
  const datosLlenado = JSON.parse(llenado.datos || '{}');
  const etapas = plantilla.por_etapas ? ['salida', 'regreso'] : [null];
  const faltas = etapas.flatMap((e) => faltantesDeEtapa(id, plantilla, e, datosLlenado));
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas) });

  const firmas = db.prepare('SELECT rol FROM firmas WHERE llenado_id = ?').all(id).map((f) => f.rol);
  if (plantilla.firma_operador && !firmas.includes('operador')) {
    return json(res, 400, { error: 'Falta la firma del operador.' });
  }
  if (plantilla.firma_coordinador && !firmas.includes('coordinador')) {
    return json(res, 400, { error: 'Falta la firma de autorización del Team Leader.' });
  }

  db.prepare("UPDATE llenados SET estado = 'cerrado', cerrado_en = ?, cerrado_por = ? WHERE id = ?")
    .run(new Date().toISOString(), usuario.id, id);
  json(res, 200, { ok: true, estado: 'cerrado' });
});

ruta('GET', '/api/reportes/problemas', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  json(res, 200, db.prepare(`
    SELECT l.id AS llenado_id, l.periodo, l.estado, l.cerrado_en,
           p.nombre AS plantilla, a.nombre AS unidad, u.nombre AS reporto,
           s.titulo AS seccion, i.texto AS item, r.observacion,
           (SELECT GROUP_CONCAT(f.archivo, '|') FROM fotos f
            WHERE f.llenado_id = r.llenado_id AND f.item_id = r.item_id
              AND f.columna = r.columna) AS fotos
    FROM respuestas r
    JOIN llenados l  ON l.id = r.llenado_id
    JOIN items i     ON i.id = r.item_id
    JOIN secciones s ON s.id = i.seccion_id
    JOIN plantillas p ON p.id = l.plantilla_id
    JOIN usuarios u  ON u.id = l.usuario_id
    LEFT JOIN activos a ON a.id = l.activo_id
    WHERE r.valor IN ('problema', 'no')
    ORDER BY l.creado_en DESC, s.orden, i.orden
    LIMIT 300
  `).all());
});

ruta('GET', '/api/reportes/historial', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  json(res, 200, db.prepare(`
    SELECT l.id, l.periodo, l.estado, l.creado_en, l.cerrado_en,
           p.nombre AS plantilla, p.clave AS plantilla_clave,
           a.nombre AS unidad, u.nombre AS elaboro,
           (SELECT COUNT(*) FROM respuestas r WHERE r.llenado_id = l.id AND r.valor IN ('problema', 'no')) AS problemas
    FROM llenados l
    JOIN plantillas p ON p.id = l.plantilla_id
    JOIN usuarios u   ON u.id = l.usuario_id
    LEFT JOIN activos a ON a.id = l.activo_id
    ORDER BY l.creado_en DESC
    LIMIT 200
  `).all());
});

ruta('GET', '/api/llenados/(\\d+)/detalle', (req, res, p) => {
  if (!exigir(req, res, 'reportes')) return;
  const llenado = db.prepare(`
    SELECT l.*, p.clave AS plantilla_clave, p.nombre AS plantilla_nombre,
           p.tipo_captura, a.nombre AS unidad, u.nombre AS elaboro
    FROM llenados l
    JOIN plantillas p ON p.id = l.plantilla_id
    JOIN usuarios u   ON u.id = l.usuario_id
    LEFT JOIN activos a ON a.id = l.activo_id
    WHERE l.id = ?
  `).get(Number(p[1]));
  if (!llenado) return json(res, 404, { error: 'No encontrado' });

  llenado.plantilla = plantillaCompleta(llenado.plantilla_clave, llenado.activo_id);
  llenado.respuestas = db.prepare('SELECT item_id, columna, valor, observacion FROM respuestas WHERE llenado_id = ?').all(llenado.id);
  llenado.firmas = db.prepare('SELECT rol, nombre, imagen, firmado_en FROM firmas WHERE llenado_id = ?').all(llenado.id);
  llenado.fotos = fotosDe(llenado.id);
  json(res, 200, llenado);
});

// --- comparativa entre semanas ---

// Semanas que tienen algo capturado, de la más reciente a la más antigua.
ruta('GET', '/api/reportes/periodos', (req, res) => {
  if (!exigir(req, res, 'comparativa')) return;
  const semanas = db
    .prepare('SELECT DISTINCT semana FROM llenados WHERE semana IS NOT NULL ORDER BY semana DESC')
    .all()
    .map((s) => ({ clave: s.semana, etiqueta: describirSemana(s.semana) }));
  json(res, 200, { semanas, actual: semanaISO() });
});

ruta('GET', '/api/reportes/comparativa', (req, res) => {
  if (!exigir(req, res, 'comparativa')) return;

  const url = new URL(req.url, 'http://x');
  const semanas = (url.searchParams.get('semanas') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-W\d{2}$/.test(s));

  if (semanas.length < 2) {
    return json(res, 400, { error: 'Elige al menos dos semanas para comparar.' });
  }
  if (semanas.length > 12) {
    return json(res, 400, { error: 'Se pueden comparar hasta 12 semanas a la vez.' });
  }

  // SQLite no acepta un arreglo como parámetro: hay que generar un hueco por
  // semana. Los valores ya pasaron el filtro del formato, así que no hay
  // manera de inyectar nada por aquí.
  const huecos = semanas.map(() => '?').join(',');

  const resumen = db.prepare(`
    SELECT l.semana,
           COUNT(DISTINCT l.id) AS llenados,
           SUM(CASE WHEN l.estado = 'cerrado' THEN 1 ELSE 0 END) AS cerrados,
           (SELECT COUNT(*) FROM respuestas r
             JOIN llenados l2 ON l2.id = r.llenado_id
             WHERE l2.semana = l.semana AND r.valor IN ('problema', 'no')) AS problemas,
           (SELECT COUNT(*) FROM fotos f
             JOIN llenados l3 ON l3.id = f.llenado_id
             WHERE l3.semana = l.semana) AS fotos
    FROM llenados l
    WHERE l.semana IN (${huecos})
    GROUP BY l.semana
  `).all(...semanas);

  const porUnidad = db.prepare(`
    SELECT l.semana, p.nombre AS plantilla, COALESCE(a.nombre, '—') AS unidad,
           COUNT(*) AS problemas
    FROM respuestas r
    JOIN llenados l   ON l.id = r.llenado_id
    JOIN plantillas p ON p.id = l.plantilla_id
    LEFT JOIN activos a ON a.id = l.activo_id
    WHERE r.valor IN ('problema', 'no') AND l.semana IN (${huecos})
    GROUP BY l.semana, p.id, a.id
  `).all(...semanas);

  // Lo más accionable del reporte: qué falló en más de una de las semanas
  // elegidas. Un ítem que reaparece semana tras semana no se está atendiendo.
  const recurrentes = db.prepare(`
    SELECT i.texto AS item, s.titulo AS seccion, p.nombre AS plantilla,
           COALESCE(a.nombre, '—') AS unidad,
           COUNT(DISTINCT l.semana) AS veces,
           GROUP_CONCAT(DISTINCT l.semana) AS semanas,
           MAX(r.observacion) AS ultima_observacion
    FROM respuestas r
    JOIN llenados l   ON l.id = r.llenado_id
    JOIN items i      ON i.id = r.item_id
    JOIN secciones s  ON s.id = i.seccion_id
    JOIN plantillas p ON p.id = l.plantilla_id
    LEFT JOIN activos a ON a.id = l.activo_id
    WHERE r.valor IN ('problema', 'no') AND l.semana IN (${huecos})
    GROUP BY i.id, COALESCE(a.id, 0)
    HAVING COUNT(DISTINCT l.semana) > 1
    ORDER BY veces DESC, i.texto
  `).all(...semanas);

  // Insumos: el cierre de cada semana por material, para ver el consumo.
  const insumos = db.prepare(`
    SELECT l.semana, i.texto AS material, i.meta, r.valor AS cierre
    FROM respuestas r
    JOIN llenados l   ON l.id = r.llenado_id
    JOIN items i      ON i.id = r.item_id
    JOIN plantillas p ON p.id = l.plantilla_id
    WHERE p.clave = 'cajas' AND r.columna = 'cierre'
      AND r.valor IS NOT NULL AND TRIM(r.valor) <> ''
      AND l.semana IN (${huecos})
  `).all(...semanas);

  // Checklists semanales que en alguna de las semanas nunca se abrieron.
  const esperados = [];
  const plantillasSemanales = db
    .prepare("SELECT * FROM plantillas WHERE activo = 1 AND frecuencia IN ('semanal', 'viernes')")
    .all();
  const activos = db.prepare('SELECT id, nombre, tipo FROM activos WHERE activo = 1').all();
  const hayLlenado = db.prepare(
    'SELECT estado FROM llenados WHERE plantilla_id = ? AND COALESCE(activo_id, 0) = ? AND semana = ?'
  );

  for (const semana of semanas) {
    for (const p of plantillasSemanales) {
      const unidades = p.aplica_a ? activos.filter((a) => a.tipo === p.aplica_a) : [null];
      for (const unidad of unidades) {
        const l = hayLlenado.get(p.id, unidad ? unidad.id : 0, semana);
        esperados.push({
          semana,
          plantilla: p.nombre,
          unidad: unidad ? unidad.nombre : '—',
          estado: l ? l.estado : 'sin hacer',
        });
      }
    }
  }

  json(res, 200, {
    semanas: semanas.map((s) => ({ clave: s, etiqueta: describirSemana(s) })),
    resumen,
    porUnidad,
    recurrentes: recurrentes.map((r) => ({ ...r, semanas: String(r.semanas).split(',').sort() })),
    insumos: insumos.map((i) => ({ ...i, tipo: JSON.parse(i.meta).tipo || '' })),
    esperados,
  });
});

ruta('GET', '/api/exportar.csv', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  const url = new URL(req.url, 'http://x');
  const clave = url.searchParams.get('plantilla');

  const filas = db.prepare(`
    SELECT l.periodo, p.nombre AS plantilla, COALESCE(a.nombre, '') AS unidad,
           u.nombre AS elaboro, l.estado, s.titulo AS seccion, i.texto AS item,
           r.columna, COALESCE(r.valor, '') AS valor, COALESCE(r.observacion, '') AS observacion,
           (SELECT COUNT(*) FROM fotos f
            WHERE f.llenado_id = l.id AND f.item_id = r.item_id AND f.columna = r.columna) AS fotos,
           COALESCE(l.cerrado_en, '') AS cerrado_en
    FROM llenados l
    JOIN plantillas p ON p.id = l.plantilla_id
    JOIN usuarios u   ON u.id = l.usuario_id
    LEFT JOIN activos a ON a.id = l.activo_id
    LEFT JOIN respuestas r ON r.llenado_id = l.id
    LEFT JOIN items i     ON i.id = r.item_id
    LEFT JOIN secciones s ON s.id = i.seccion_id
    WHERE (? IS NULL OR p.clave = ?)
    ORDER BY l.creado_en DESC, s.orden, i.orden, r.columna
  `).all(clave, clave);

  const encabezados = ['Periodo', 'Checklist', 'Unidad', 'Elaboró', 'Estado', 'Sección', 'Ítem', 'Columna', 'Valor', 'Observación', 'Fotos', 'Cerrado en'];
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [encabezados.join(',')]
    .concat(filas.map((f) => Object.values(f).map(escapar).join(',')))
    .join('\r\n');

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="checklists-${hoyISO()}.csv"`,
  });
  res.end('﻿' + csv); // BOM para que Excel respete los acentos
});

// --- administración de catálogos (usuarios y unidades) ---

ruta('GET', '/api/admin/catalogos', (req, res) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  json(res, 200, {
    usuarios: db.prepare(`
      SELECT u.id, u.nombre, u.rol, (u.pin IS NOT NULL) AS tiene_pin, u.activo,
             u.permisos_extra,
             (SELECT COUNT(*) FROM llenados l WHERE l.usuario_id = u.id) AS llenados,
             (SELECT COUNT(*) FROM firmas f WHERE f.usuario_id = u.id) AS firmas
      FROM usuarios u ORDER BY u.activo DESC, u.nombre
    `).all().map((u) => {
      const extra = leerAjustes(u.permisos_extra);
      const efectivos = permisosDe(u.rol, u.permisos_extra);
      const base = PERMISOS[u.rol] || {};
      return {
        ...u,
        permisos_extra: extra,
        permisos: efectivos,
        // Lo que la persona realmente puede ver, con su origen. Sin esto la tabla
        // solo mostraba lo otorgado a mano y un Administrador parecía no tener
        // acceso a nada, cuando su perfil ya se lo da todo.
        accesos: PERMISOS_SENSIBLES
          .filter((clave) => efectivos[clave])
          .map((clave) => ({
            clave,
            etiqueta: ETIQUETA_DE_PERMISO[clave] || clave,
            origen: base[clave] ? 'perfil' : 'otorgado',
          })),
      };
    }),
    catalogo_permisos: CATALOGO_PERMISOS,
    activos: db.prepare('SELECT id, clave, nombre, tipo, atributos, activo FROM activos ORDER BY tipo, nombre').all(),
    roles: Object.entries(PERMISOS).map(([clave, p]) => ({
      clave,
      etiqueta: p.etiqueta,
      descripcion: p.descripcion,
      exige_pin: exigePin(clave, '[]'),
      permisos: p,
    })),
  });
});

ruta('POST', '/api/admin/usuarios', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  if (!cuerpo.nombre || !cuerpo.rol) return json(res, 400, { error: 'Falta nombre o rol' });
  if (!PERMISOS[cuerpo.rol]) return json(res, 400, { error: 'Ese perfil no existe' });

  const extra = normalizarExtras(cuerpo.permisos_extra);
  const pin = String(cuerpo.pin || '').trim();
  if (exigePin(cuerpo.rol, extra) && !PIN_VALIDO.test(pin)) {
    return json(res, 400, {
      error: 'Quien ve Reportes, Comparativa o Configuración necesita un PIN de 4 a 12 caracteres (letras o números).',
    });
  }

  db.prepare('INSERT INTO usuarios (nombre, rol, pin, permisos_extra) VALUES (?, ?, ?, ?)')
    .run(cuerpo.nombre.trim(), cuerpo.rol, pin || null, extra);
  json(res, 200, { ok: true });
});

// Solo se aceptan permisos del catálogo. Cualquier otra clave se descarta.
function normalizarExtras(ajustes) {
  if (Array.isArray(ajustes)) {
    return JSON.stringify(Object.fromEntries(
      ajustes.filter((k) => PERMISOS_VALIDOS.has(k)).map((k) => [k, true])
    ));
  }
  const limpio = {};
  for (const [clave, valor] of Object.entries(ajustes || {})) {
    if (PERMISOS_VALIDOS.has(clave)) limpio[clave] = !!valor;
  }
  return JSON.stringify(limpio);
}

// Editar una persona. El PIN se trata aparte porque nunca viaja al navegador:
//   pin ausente  -> se queda como está
//   pin null     -> se quita
//   pin '1234'   -> se reemplaza
ruta('PUT', '/api/admin/usuarios/(\\d+)', (req, res, p, cuerpo) => {
  const editor = exigir(req, res, 'configuracion');
  if (!editor) return;

  const id = Number(p[1]);
  const persona = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!persona) return json(res, 404, { error: 'Esa persona no existe' });

  const nombre = String(cuerpo.nombre ?? persona.nombre).trim();
  const rol = cuerpo.rol ?? persona.rol;
  const activo = cuerpo.activo === undefined ? persona.activo : (cuerpo.activo ? 1 : 0);

  if (!nombre) return json(res, 400, { error: 'El nombre no puede quedar vacío' });
  if (!PERMISOS[rol]) return json(res, 400, { error: 'Ese perfil no existe' });

  // Si se deja sin administradores activos, nadie podría volver a entrar a
  // Configuración — ni siquiera para deshacerlo. Se bloquea antes de guardar.
  if (persona.rol === 'admin' && persona.activo && !(rol === 'admin' && activo)) {
    const otros = db
      .prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?")
      .get(id).n;
    if (otros === 0) {
      return json(res, 400, {
        error: 'Es el único Administrador activo. Nombra a otro Administrador antes de cambiar este perfil o darlo de baja.',
      });
    }
  }

  const extra = cuerpo.permisos_extra === undefined
    ? (persona.permisos_extra || '[]')
    : normalizarExtras(cuerpo.permisos_extra);

  let pin = persona.pin;
  if (cuerpo.pin === null) pin = null;
  else if (typeof cuerpo.pin === 'string' && cuerpo.pin.trim() !== '') {
    pin = cuerpo.pin.trim();
    if (!PIN_VALIDO.test(pin)) return json(res, 400, { error: 'El PIN debe ser de 4 a 12 caracteres, letras o números, sin espacios' });
  }

  if (exigePin(rol, extra) && !pin) {
    return json(res, 400, {
      error: 'Quien ve Reportes, Comparativa o Configuración necesita PIN. Captura uno para poder guardar.',
    });
  }

  db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, pin = ?, activo = ?, permisos_extra = ? WHERE id = ?')
    .run(nombre, rol, pin, activo, extra, id);

  // Si la persona quedó inactiva o le cambiaron los accesos, sus sesiones
  // abiertas conservarían los permisos viejos hasta caducar. Se cierran ya.
  if (rol !== persona.rol || extra !== (persona.permisos_extra || '[]') || !activo) {
    for (const [token, sesion] of sesiones) {
      if (sesion.usuario.id === id) sesiones.delete(token);
    }
  }

  json(res, 200, { ok: true });
});

// Activar, retirar o exigir foto en un checklist. Antes esto solo se podía
// hacer corriendo comandos a mano contra la base.
ruta('GET', '/api/admin/plantillas', (req, res) => {
  if (!exigir(req, res, 'configuracion')) return;
  json(res, 200, db.prepare(`
    SELECT p.id, p.clave, p.nombre, p.descripcion, p.frecuencia, p.aplica_a,
           p.foto_obligatoria, p.activo, p.orden,
           (SELECT COUNT(*) FROM secciones s JOIN items i ON i.seccion_id = s.id
             WHERE s.plantilla_id = p.id AND i.activo = 1) AS items,
           (SELECT COUNT(*) FROM llenados l WHERE l.plantilla_id = p.id) AS llenados
    FROM plantillas p ORDER BY p.activo DESC, p.orden
  `).all());
});

ruta('PUT', '/api/admin/plantillas/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(Number(p[1]));
  if (!plantilla) return json(res, 404, { error: 'Ese checklist no existe' });

  const activo = cuerpo.activo === undefined ? plantilla.activo : (cuerpo.activo ? 1 : 0);
  const foto = cuerpo.foto_obligatoria === undefined
    ? plantilla.foto_obligatoria
    : (cuerpo.foto_obligatoria ? 1 : 0);

  db.prepare('UPDATE plantillas SET activo = ?, foto_obligatoria = ? WHERE id = ?')
    .run(activo, foto, plantilla.id);
  json(res, 200, { ok: true });
});

// Guarda de golpe todos los cambios hechos en la matriz de permisos. Se valida
// el resultado FINAL de cada persona, no cambio por cambio: así se puede quitar
// un módulo y dar otro en la misma tanda sin que el intermedio parezca inválido.
ruta('PUT', '/api/admin/permisos', (req, res, _p, cuerpo) => {
  const editor = exigir(req, res, 'configuracion');
  if (!editor) return;

  const cambios = Array.isArray(cuerpo.cambios) ? cuerpo.cambios : [];
  if (!cambios.length) return json(res, 200, { ok: true, guardados: 0 });

  // Se agrupan por persona y se calcula cómo quedaría cada una.
  const porPersona = new Map();
  for (const c of cambios) {
    const id = Number(c.usuario_id);
    if (!PERMISOS_VALIDOS.has(c.clave)) {
      return json(res, 400, { error: `El permiso «${c.clave}» no existe.` });
    }
    const persona = porPersona.get(id) || db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!persona) return json(res, 404, { error: 'Una de las personas ya no existe. Recarga la pantalla.' });
    if (!persona.ajustes) persona.ajustes = leerAjustes(persona.permisos_extra);
    if (c.heredar || c.valor === null) delete persona.ajustes[c.clave];
    else persona.ajustes[c.clave] = !!c.valor;
    porPersona.set(id, persona);
  }

  // Validación sobre el resultado final de cada persona.
  for (const [id, persona] of porPersona) {
    const efectivos = permisosDe(persona.rol, JSON.stringify(persona.ajustes));

    if (!Object.keys(efectivos).some((k) => k.startsWith('mod_') && efectivos[k])) {
      return json(res, 400, {
        error: `${persona.nombre} se quedaría sin ningún módulo: no podría entrar a nada.`,
      });
    }
    if (PERMISOS_SENSIBLES.some((k) => efectivos[k]) && !persona.pin) {
      return json(res, 400, {
        error: `${persona.nombre} necesita un PIN antes de darle Reportes, Comparativa o Configuración.`,
      });
    }
    if (persona.rol === 'admin' && persona.activo && !efectivos.configuracion) {
      const otros = db.prepare(`
        SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?
      `).get(id).n;
      if (otros === 0) {
        return json(res, 400, { error: `${persona.nombre} es el único Administrador activo: no puede quedarse sin Configuración.` });
      }
    }
  }

  const guardar = db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const [id, persona] of porPersona) guardar.run(JSON.stringify(persona.ajustes), id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    return json(res, 500, { error: 'No se pudieron guardar los cambios.' });
  }

  // Quien cambió de permisos vuelve a entrar, para no seguir con los viejos.
  for (const [token, sesion] of sesiones) {
    if (porPersona.has(sesion.usuario.id)) sesiones.delete(token);
  }

  json(res, 200, { ok: true, guardados: cambios.length, personas: porPersona.size });
});

// Otorga o quita un permiso concreto a una persona. Guarda un ajuste explícito
// (true/false) sobre lo que da su perfil; `heredar` lo borra y la persona vuelve
// a lo que su perfil determine.
ruta('PUT', '/api/admin/usuarios/(\\d+)/permiso', (req, res, p, cuerpo) => {
  const editor = exigir(req, res, 'configuracion');
  if (!editor) return;

  const id = Number(p[1]);
  const persona = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!persona) return json(res, 404, { error: 'Esa persona no existe' });
  if (!PERMISOS_VALIDOS.has(cuerpo.clave)) return json(res, 400, { error: 'Ese permiso no existe' });

  const ajustes = leerAjustes(persona.permisos_extra);
  if (cuerpo.valor === null || cuerpo.heredar) delete ajustes[cuerpo.clave];
  else ajustes[cuerpo.clave] = !!cuerpo.valor;

  const efectivos = permisosDe(persona.rol, JSON.stringify(ajustes));

  // Nadie puede quedarse sin ver nada: sin un solo módulo, esa persona entra y
  // se topa con un menú vacío.
  if (!Object.keys(efectivos).some((k) => k.startsWith('mod_') && efectivos[k])) {
    return json(res, 400, { error: 'Debe quedarle al menos un módulo; si no, no podrá entrar a nada.' });
  }

  // Y no se puede dejar la plataforma sin quien administre.
  if (persona.rol === 'admin' && persona.activo && !efectivos.configuracion) {
    const otros = db.prepare(`
      SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?
    `).get(id).n;
    if (otros === 0) {
      return json(res, 400, { error: 'Es el único Administrador activo: no puede quedarse sin Configuración.' });
    }
  }

  if (PERMISOS_SENSIBLES.some((k) => efectivos[k]) && !persona.pin) {
    return json(res, 400, {
      error: `Para darle «${ETIQUETA_DE_PERMISO[cuerpo.clave] || cuerpo.clave}» primero asígnale un PIN.`,
    });
  }

  db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?').run(JSON.stringify(ajustes), id);
  for (const [token, sesion] of sesiones) {
    if (sesion.usuario.id === id) sesiones.delete(token);
  }
  json(res, 200, { ok: true, permisos: efectivos, ajustes });
});

ruta('POST', '/api/admin/activos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  if (!cuerpo.clave || !cuerpo.nombre || !cuerpo.tipo) return json(res, 400, { error: 'Faltan datos' });
  try {
    db.prepare('INSERT INTO activos (clave, nombre, tipo, atributos) VALUES (?, ?, ?, ?)')
      .run(cuerpo.clave.trim(), cuerpo.nombre.trim(), cuerpo.tipo, JSON.stringify(cuerpo.atributos || {}));
  } catch {
    return json(res, 409, { error: 'Ya existe una unidad con esa clave' });
  }
  json(res, 200, { ok: true });
});

ruta('PUT', '/api/admin/activos/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  db.prepare('UPDATE activos SET nombre = ?, atributos = ?, activo = ? WHERE id = ?')
    .run(cuerpo.nombre, JSON.stringify(cuerpo.atributos || {}), cuerpo.activo ? 1 : 0, Number(p[1]));
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ servidor

function json(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(cuerpo);
}

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

function servirEstatico(req, res) {
  const url = new URL(req.url, 'http://x');
  let relativo = decodeURIComponent(url.pathname);
  if (relativo === '/') relativo = '/index.html';

  const destino = path.join(PUBLIC_DIR, relativo);
  // path.join normaliza '..'; si el resultado se sale de public/, es un intento
  // de leer archivos fuera de la carpeta pública.
  if (destino !== PUBLIC_DIR && !destino.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  fs.readFile(destino, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }

    const extension = path.extname(destino);
    // La app se actualiza seguido y las tablets guardan agresivamente en caché.
    // Sin esto, un dispositivo puede quedarse con un app.js viejo hablando con
    // un servidor nuevo: la pantalla carga pero nada funciona. 'no-cache' no
    // desactiva la caché, obliga a revalidar contra el servidor en cada carga.
    const volatil = ['.html', '.js', '.css', '.webmanifest'].includes(extension);
    res.writeHead(200, {
      'Content-Type': TIPOS_MIME[extension] || 'application/octet-stream',
      'Cache-Control': volatil ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(contenido);
  });
}

const servidor = http.createServer((req, res) => {
  const ruta_ = new URL(req.url, 'http://x').pathname;

  if (!ruta_.startsWith('/api/')) return servirEstatico(req, res);

  const coincidencia = rutas
    .map((r) => ({ r, m: ruta_.match(r.patron) }))
    .find(({ r, m }) => m && r.metodo === req.method);

  if (!coincidencia) return json(res, 404, { error: 'Ruta no encontrada' });

  if (req.method === 'GET') {
    try {
      return coincidencia.r.manejador(req, res, coincidencia.m);
    } catch (err) {
      console.error(err);
      return json(res, 500, { error: 'Error interno' });
    }
  }

  let crudo = '';
  req.on('data', (trozo) => {
    crudo += trozo;
    if (crudo.length > 8e6) req.destroy(); // tope: las firmas son data-URL y pesan
  });
  req.on('end', () => {
    let cuerpo = {};
    try {
      cuerpo = crudo ? JSON.parse(crudo) : {};
    } catch {
      return json(res, 400, { error: 'JSON inválido' });
    }
    try {
      coincidencia.r.manejador(req, res, coincidencia.m, cuerpo);
    } catch (err) {
      console.error(err);
      json(res, 500, { error: 'Error interno' });
    }
  });
});

// Las direcciones 169.254.x son de enlaces sin conexión real y las de VPN no
// sirven para que la tablet entre; mostrarlas todas solo confunde a la hora de
// escribir la dirección en el navegador.
function ipsLocales() {
  const RANGOS_LAN = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];
  return Object.values(os.networkInterfaces())
    .flatMap((lista, _i) => (lista || []).map((d) => ({ ...d, interfaz: '' })))
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .filter((ip) => RANGOS_LAN.some((r) => r.test(ip)))
    .sort((a, b) => (a.startsWith('192.168.') ? -1 : 1) - (b.startsWith('192.168.') ? -1 : 1));
}

servidor.listen(PUERTO, () => {
  const ips = ipsLocales();
  console.log('\n  ════════════════════════════════════════════════════');
  console.log('   SISTEMA DIGITAL INKO');
  console.log('  ════════════════════════════════════════════════════\n');
  console.log(`   En esta computadora:   http://localhost:${PUERTO}`);
  if (ips.length === 0) {
    console.log('\n   Sin red detectada. Conecta la computadora al wifi del almacén.');
  } else {
    console.log('\n   Desde tablet o desde otra computadora, en el mismo wifi:');
    for (const ip of ips) console.log(`      http://${ip}:${PUERTO}`);
    console.log('\n   Si otro dispositivo no abre esa dirección, casi siempre es el');
    console.log('   Firewall de Windows. Revisa "Acceso desde otros equipos" en LEEME.md.');
  }
  console.log('\n   Para detener: Ctrl + C\n');
});
