'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { periodoASemana } = require('./fechas');

// Normalmente los datos viven en datos/, junto a la plataforma. INKO_DATOS
// apunta a otra carpeta: sirve para levantar una copia de pruebas —para enseñar
// el sistema, para ensayar un módulo nuevo— sin tocar la operación de verdad.
// Sin esta variable, probar y trabajar comparten la misma base.
const DATA_DIR = process.env.INKO_DATOS
  ? path.resolve(process.env.INKO_DATOS)
  : path.join(__dirname, 'datos');
const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(FOTOS_DIR, { recursive: true });

const { AsyncLocalStorage } = require('node:async_hooks');

// La base de la operación de verdad.
const real = new DatabaseSync(path.join(DATA_DIR, 'checklists.db'));
real.exec('PRAGMA journal_mode = WAL');
real.exec('PRAGMA foreign_keys = ON');

// MODO DE PRUEBAS. Mientras está prendido existe una segunda base —una copia de
// la real— y quien entra «a probar» trabaja sobre ella sin saberlo: cada
// petición suya corre dentro de un `contexto` que apunta a la copia. Todo el
// sistema habla con `db`, que no es una base sino un intermediario: pregunta en
// qué contexto va la petición y le pasa la llamada a la base que toca. Así
// ninguna pantalla ni ninguna regla necesita saber que existe el modo de pruebas,
// y lo que se prueba nunca toca el inventario ni los reportes reales.
const contexto = new AsyncLocalStorage();
const baseActual = () => {
  const c = contexto.getStore();
  return (c && c.db) || real;
};
const db = new Proxy({}, {
  get(_o, llave) {
    const base = baseActual();
    const valor = base[llave];
    return typeof valor === 'function' ? valor.bind(base) : valor;
  },
});

// Todo lo que sigue deja una base al día: tablas, columnas y migraciones. Corre
// sobre la real al arrancar y sobre la copia de pruebas cuando se abre, para que
// la copia nunca se quede atrás de una versión nueva de la plataforma.
function prepararBase() {

db.exec(`
-- El rol no lleva CHECK a propósito: los roles válidos y lo que puede hacer cada
-- uno se definen en un solo lugar (PERMISOS, en server.js). Duplicar la lista
-- aquí obligaría a reconstruir la tabla cada vez que cambie un permiso.
CREATE TABLE IF NOT EXISTS usuarios (
  id      INTEGER PRIMARY KEY,
  nombre  TEXT    NOT NULL,
  rol     TEXT    NOT NULL,
  pin     TEXT,
  activo  INTEGER NOT NULL DEFAULT 1
);

-- Unidades inspeccionables: camionetas, montacargas. Los datos que varían entre
-- una y otra (presión de llantas, grado de aceite) viven en 'atributos' y se
-- interpolan en el texto de los ítems, para no duplicar plantillas por unidad.
CREATE TABLE IF NOT EXISTS activos (
  id         INTEGER PRIMARY KEY,
  clave      TEXT    NOT NULL UNIQUE,
  nombre     TEXT    NOT NULL,
  tipo       TEXT    NOT NULL,
  atributos  TEXT    NOT NULL DEFAULT '{}',
  activo     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plantillas (
  id            INTEGER PRIMARY KEY,
  clave         TEXT    NOT NULL UNIQUE,
  nombre        TEXT    NOT NULL,
  descripcion   TEXT,
  tipo_captura  TEXT    NOT NULL CHECK (tipo_captura IN ('items', 'matriz', 'grid_semanal')),
  frecuencia    TEXT    NOT NULL CHECK (frecuencia IN ('diario', 'semanal', 'viernes')),
  aplica_a      TEXT,
  firma_operador     INTEGER NOT NULL DEFAULT 0,
  firma_coordinador  INTEGER NOT NULL DEFAULT 0,
  orden         INTEGER NOT NULL DEFAULT 0,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS secciones (
  id            INTEGER PRIMARY KEY,
  plantilla_id  INTEGER NOT NULL REFERENCES plantillas(id) ON DELETE CASCADE,
  orden         INTEGER NOT NULL,
  titulo        TEXT    NOT NULL,
  -- En los checklists por etapas dice de qué momento es la sección:
  -- 'salida' antes de que la unidad se vaya, 'regreso' cuando vuelve.
  etapa         TEXT    NOT NULL DEFAULT 'salida',
  -- Condición opcional para mostrar la sección, según un dato de cabecera:
  -- {"campo":"tipo","valor":"cita_cedis"}. Nula = aplica siempre.
  condicion     TEXT,
  -- Permite retirar una sección de circulación sin borrarla, igual que con las
  -- plantillas: deja de pedirse pero se conserva transcrita.
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY,
  seccion_id      INTEGER NOT NULL REFERENCES secciones(id) ON DELETE CASCADE,
  orden           INTEGER NOT NULL,
  texto           TEXT    NOT NULL,
  -- ok_problema | revisado | conteo | documento. Sin CHECK a propósito: la lista
  -- válida vive en el código, para no reconstruir la tabla cada vez que crece.
  tipo_respuesta  TEXT    NOT NULL,
  solo_activos    TEXT,
  meta            TEXT    NOT NULL DEFAULT '{}',
  activo          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS llenados (
  id            INTEGER PRIMARY KEY,
  plantilla_id  INTEGER NOT NULL REFERENCES plantillas(id),
  activo_id     INTEGER REFERENCES activos(id),
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  periodo       TEXT    NOT NULL,
  -- Semana ISO derivada del periodo. Los checklists diarios guardan una fecha y
  -- los semanales una semana; esta columna los pone en el mismo terreno para
  -- poder comparar semana contra semana sin recalcular nada en cada consulta.
  semana        TEXT,
  -- borrador | en_ruta | cerrado. 'en_ruta' es el estado intermedio de los
  -- checklists por etapas: la salida ya fue autorizada pero el proceso sigue
  -- abierto hasta que la unidad regresa. Sin CHECK: la lista vive en el código.
  estado        TEXT    NOT NULL DEFAULT 'borrador',
  salida_en     TEXT,
  autorizado_por INTEGER REFERENCES usuarios(id),
  cerrado_por    INTEGER REFERENCES usuarios(id),
  -- Identificador que distingue varios llenados del mismo día y plantilla.
  -- En Tránsito es el número de envío: puede haber varias entregas por jornada.
  referencia    TEXT,
  -- Datos de cabecera capturados antes de la inspección (número de envío,
  -- lugar de entrega). Van en JSON para que cada plantilla defina los suyos.
  datos         TEXT    NOT NULL DEFAULT '{}',
  notas         TEXT,
  creado_en     TEXT    NOT NULL,
  cerrado_en    TEXT
);

-- Un llenado por plantilla + unidad + periodo + referencia. Los COALESCE están
-- porque en SQLite los NULL no colisionan en un UNIQUE normal. La referencia
-- permite varios llenados el mismo día: en Tránsito, uno por número de envío.
-- Las plantillas sin referencia siguen teniendo uno solo por periodo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_llenado_unico
  ON llenados (plantilla_id, COALESCE(activo_id, 0), periodo, COALESCE(referencia, ''));

CREATE TABLE IF NOT EXISTS respuestas (
  id           INTEGER PRIMARY KEY,
  llenado_id   INTEGER NOT NULL REFERENCES llenados(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES items(id),
  columna      TEXT    NOT NULL DEFAULT '-',
  valor        TEXT,
  observacion  TEXT,
  UNIQUE (llenado_id, item_id, columna)
);

CREATE TABLE IF NOT EXISTS firmas (
  id          INTEGER PRIMARY KEY,
  llenado_id  INTEGER NOT NULL REFERENCES llenados(id) ON DELETE CASCADE,
  rol         TEXT    NOT NULL,
  usuario_id  INTEGER REFERENCES usuarios(id),
  nombre      TEXT    NOT NULL,
  imagen      TEXT    NOT NULL,
  firmado_en  TEXT    NOT NULL,
  UNIQUE (llenado_id, rol)
);

-- Evidencia fotográfica. El archivo vive en datos/fotos/ y aquí solo se guarda
-- su nombre: una foto de tablet pesa megabytes y meterlas dentro del .db haría
-- que OneDrive resincronizara la base completa con cada captura.
-- item_id NULL = evidencia general del llenado, no de un ítem concreto.
CREATE TABLE IF NOT EXISTS fotos (
  id          INTEGER PRIMARY KEY,
  llenado_id  INTEGER NOT NULL REFERENCES llenados(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES items(id),
  columna     TEXT    NOT NULL DEFAULT '-',
  archivo     TEXT    NOT NULL UNIQUE,
  bytes       INTEGER NOT NULL,
  subida_por  INTEGER REFERENCES usuarios(id),
  subida_en   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resp_llenado ON respuestas (llenado_id);
CREATE INDEX IF NOT EXISTS idx_llenado_periodo ON llenados (periodo);
CREATE INDEX IF NOT EXISTS idx_fotos_llenado ON fotos (llenado_id);
`);

// Migraciones para bases que ya existían antes de que se agregara una columna.
function agregarColumna(tabla, columna, definicion, alAgregar) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  if (columnas.includes(columna)) return;
  db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  if (alAgregar) alAgregar();
}

agregarColumna('llenados', 'referencia', 'TEXT');
agregarColumna('llenados', 'salida_en', 'TEXT');
agregarColumna('llenados', 'datos', "TEXT NOT NULL DEFAULT '{}'");
agregarColumna('secciones', 'etapa', "TEXT NOT NULL DEFAULT 'salida'");
agregarColumna('secciones', 'condicion', 'TEXT');
agregarColumna('secciones', 'activo', 'INTEGER NOT NULL DEFAULT 1');

// Checklists cuya salida y cierre no los decide quien los llena, sino un mando.
agregarColumna('plantillas', 'requiere_supervision', 'INTEGER NOT NULL DEFAULT 0');
// Queda registrado QUIÉN autorizó y quién cerró: la autorización es un control,
// y un control sin responsable identificado no sirve de nada.
agregarColumna('llenados', 'autorizado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('llenados', 'cerrado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('plantillas', 'campos', "TEXT NOT NULL DEFAULT '[]'");
agregarColumna('plantillas', 'por_etapas', 'INTEGER NOT NULL DEFAULT 0');

// El índice viejo no incluía la referencia, así que impedía tener dos envíos el
// mismo día. Se reemplaza por el que sí la contempla.
(function reconstruirIndiceDeLlenados() {
  const indice = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_llenado_unico'")
    .get();
  if (!indice || indice.sql.includes('referencia')) return;
  db.exec('DROP INDEX idx_llenado_unico');
  db.exec(`CREATE UNIQUE INDEX idx_llenado_unico
    ON llenados (plantilla_id, COALESCE(activo_id, 0), periodo, COALESCE(referencia, ''))`);
  console.log('  Índice de llenados actualizado: ahora admite varios envíos por día.');
})();

// El CHECK original de estado solo aceptaba borrador/cerrado y SQLite no permite
// modificarlo. Se reconstruye la tabla sin él, conservando los id para que
// respuestas, firmas y fotos sigan apuntando a su llenado.
(function liberarEstadosDeLlenado() {
  const definicion = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llenados'").get();
  if (!definicion || !definicion.sql.includes('CHECK')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE llenados_nuevo (
        id            INTEGER PRIMARY KEY,
        plantilla_id  INTEGER NOT NULL REFERENCES plantillas(id),
        activo_id     INTEGER REFERENCES activos(id),
        usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
        periodo       TEXT    NOT NULL,
        semana        TEXT,
        estado        TEXT    NOT NULL DEFAULT 'borrador',
        salida_en     TEXT,
  autorizado_por INTEGER REFERENCES usuarios(id),
  cerrado_por    INTEGER REFERENCES usuarios(id),
        referencia    TEXT,
        datos         TEXT    NOT NULL DEFAULT '{}',
        notas         TEXT,
        creado_en     TEXT    NOT NULL,
        cerrado_en    TEXT
      );
      INSERT INTO llenados_nuevo (id, plantilla_id, activo_id, usuario_id, periodo, semana,
                                  estado, salida_en, autorizado_por, cerrado_por,
                                  referencia, datos, notas, creado_en, cerrado_en)
        SELECT id, plantilla_id, activo_id, usuario_id, periodo, semana,
               estado, salida_en, autorizado_por, cerrado_por,
               referencia, datos, notas, creado_en, cerrado_en FROM llenados;
      DROP TABLE llenados;
      ALTER TABLE llenados_nuevo RENAME TO llenados;
      CREATE UNIQUE INDEX idx_llenado_unico
        ON llenados (plantilla_id, COALESCE(activo_id, 0), periodo, COALESCE(referencia, ''));
      CREATE INDEX idx_llenado_periodo ON llenados (periodo);
      CREATE INDEX idx_llenado_semana ON llenados (semana);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');
})();

agregarColumna('llenados', 'semana', 'TEXT', () => {
  const backfill = db.prepare('UPDATE llenados SET semana = ? WHERE id = ?');
  for (const l of db.prepare('SELECT id, periodo FROM llenados').all()) {
    backfill.run(periodoASemana(l.periodo), l.id);
  }
});

db.exec('CREATE INDEX IF NOT EXISTS idx_llenado_semana ON llenados (semana)');

// Bases creadas antes de que existiera el rol de Team Leader traen un CHECK que
// solo aceptaba operador/coordinador/admin. SQLite no permite modificar un CHECK,
// así que hay que reconstruir la tabla. Los id se conservan, de modo que las
// referencias desde llenados, firmas y fotos siguen siendo válidas.
function liberarRolesDeUsuario() {
  const definicion = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'").get();
  if (!definicion || !definicion.sql.includes('CHECK')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE usuarios_nuevo (
        id      INTEGER PRIMARY KEY,
        nombre  TEXT    NOT NULL,
        rol     TEXT    NOT NULL,
        pin     TEXT,
        activo  INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO usuarios_nuevo (id, nombre, rol, pin, activo)
        SELECT id, nombre, rol, pin, activo FROM usuarios;
      DROP TABLE usuarios;
      ALTER TABLE usuarios_nuevo RENAME TO usuarios;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');
}
liberarRolesDeUsuario();

// Igual que con los roles: el CHECK original de items solo aceptaba tres tipos de
// respuesta y SQLite no permite modificar un CHECK. Se reconstruye la tabla sin
// él y la validación vive en el código, en un solo lugar. Los id se conservan,
// así que respuestas y fotos siguen apuntando a donde deben.
function liberarTiposDeItem() {
  const definicion = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'").get();
  if (!definicion || !definicion.sql.includes('CHECK')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE items_nuevo (
        id              INTEGER PRIMARY KEY,
        seccion_id      INTEGER NOT NULL REFERENCES secciones(id) ON DELETE CASCADE,
        orden           INTEGER NOT NULL,
        texto           TEXT    NOT NULL,
        tipo_respuesta  TEXT    NOT NULL,
        solo_activos    TEXT,
        meta            TEXT    NOT NULL DEFAULT '{}',
        activo          INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO items_nuevo (id, seccion_id, orden, texto, tipo_respuesta, solo_activos, meta, activo)
        SELECT id, seccion_id, orden, texto, tipo_respuesta, solo_activos, meta, activo FROM items;
      DROP TABLE items;
      ALTER TABLE items_nuevo RENAME TO items;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');
}
liberarTiposDeItem();

// La organización solo tiene tres perfiles: operador, team leader y administrador.
// Estos son los nombres que usaron versiones anteriores.
//   lider_logistica -> team_leader   (mismo puesto, nombre nuevo)
//   coordinador     -> operador      (el perfil desapareció)
// El coordinador baja a operador a propósito: subirlo a team leader le daría
// acceso a Reportes sin que nadie lo haya decidido. Si alguno debe ser team
// leader, se cambia a mano en Configuración.
// Permisos otorgados a una persona en particular, además de los que ya trae su
// perfil. Existe porque hay accesos que corresponden a un puesto y no a un
// perfil: la Comparativa la ve quien lleva Planeación Logística, no los cuatro
// Team Leaders. Guardar esto aquí evita inventar un perfil por cada excepción.
agregarColumna('usuarios', 'permisos_extra', "TEXT NOT NULL DEFAULT '[]'");

// El bloqueo de una clave. 'fallos' cuenta los intentos seguidos y se pone en
// cero en cuanto alguien entra bien; 'bloqueado_en' es lo que impide entrar, y
// solo lo quita quien tenga permiso de liberar. Van como columnas y no como
// tabla aparte porque son un estado de la persona, uno por persona, y así no
// hay manera de que una clave quede bloqueada en dos lados a la vez.
agregarColumna('usuarios', 'fallos', 'INTEGER NOT NULL DEFAULT 0');
agregarColumna('usuarios', 'bloqueado_en', 'TEXT');
agregarColumna('usuarios', 'bloqueado_motivo', 'TEXT');
agregarColumna('usuarios', 'bloqueado_por', 'INTEGER REFERENCES usuarios(id)');

const RENOMBRES_DE_ROL = { lider_logistica: 'team_leader', coordinador: 'operador' };
for (const [viejo, nuevo] of Object.entries(RENOMBRES_DE_ROL)) {
  const afectados = db.prepare('SELECT nombre FROM usuarios WHERE rol = ?').all(viejo);
  if (afectados.length === 0) continue;
  db.prepare('UPDATE usuarios SET rol = ? WHERE rol = ?').run(nuevo, viejo);
  console.log(`  Perfil «${viejo}» ya no existe. Reasignados a «${nuevo}»: ${afectados.map((u) => u.nombre).join(', ')}`);
}

agregarColumna('plantillas', 'foto_obligatoria', 'INTEGER NOT NULL DEFAULT 0', () => {
  // Los checklists de condición física (unidades, montacargas) exigen foto cuando
  // se marca un problema. Los de tareas (Tránsito, Avisos) no: ahí un "No" es una
  // actividad pendiente, no un desperfecto que se pueda fotografiar.
  db.exec("UPDATE plantillas SET foto_obligatoria = 1 WHERE clave IN ('unidad', 'montacargas')");
});

// ------------------------------------------------------------------ calidad

// Muestreo de material que llega de proveedor. Viene de MUESTREO_GUIADO.xlsx.
// No reusa plantillas/items: aquello es una lista de preguntas iguales para
// todos, y esto es un renglón de datos por lote con su propia aritmética.
db.exec(`
-- La hoja MATERIALES del Excel: la especificación contra la que se compara el
-- producto físico. Antes vivía en una hoja protegida con contraseña; aquí se
-- edita desde Configuración sin tocar fórmulas.
CREATE TABLE IF NOT EXISTS materiales (
  id                INTEGER PRIMARY KEY,
  modelo            TEXT    NOT NULL UNIQUE,
  color_impresion   TEXT,
  marca_termino     TEXT,
  tipo_centro       TEXT,
  gap               TEXT,
  cant_x_rollo      TEXT,
  colores           TEXT,
  diam_referencia   TEXT,
  centro_referencia TEXT,
  orden             INTEGER NOT NULL DEFAULT 0,
  activo            INTEGER NOT NULL DEFAULT 1
);

-- Proveedores y colores de fondo. Son dos listas de una sola columna; meterlas
-- en la misma tabla con un 'tipo' evita escribir el mismo alta/baja dos veces.
CREATE TABLE IF NOT EXISTS catalogo_calidad (
  id     INTEGER PRIMARY KEY,
  tipo   TEXT    NOT NULL,
  valor  TEXT    NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tipo, valor)
);

-- Una recepción es una remisión: lo que bajó de un camión. Adentro van los
-- lotes, uno por modelo. En papel esto era un renglón suelto por lote y la
-- remisión se repetía a mano en cada uno.
CREATE TABLE IF NOT EXISTS recepciones (
  id            INTEGER PRIMARY KEY,
  remision      TEXT    NOT NULL,
  proveedor     TEXT    NOT NULL,
  fecha_llegada TEXT    NOT NULL,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  -- borrador | cerrado | aprobado
  estado        TEXT    NOT NULL DEFAULT 'borrador',
  notas         TEXT,
  creado_en     TEXT    NOT NULL,
  cerrado_en    TEXT,
  cerrado_por   INTEGER REFERENCES usuarios(id),
  -- Visto bueno del Administrador. Cerrar una recepción es trabajo de almacén;
  -- darla por buena es la última aprobación, y esa siempre es del Administrador.
  aprobado_por  INTEGER REFERENCES usuarios(id),
  aprobado_en   TEXT,
  UNIQUE (proveedor, remision)
);

CREATE TABLE IF NOT EXISTS lotes (
  id            INTEGER PRIMARY KEY,
  recepcion_id  INTEGER NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  material_id   INTEGER NOT NULL REFERENCES materiales(id),
  fondo         TEXT,
  -- Lo que llegó: cajas x rollos por caja, o el total de rollos directo.
  cant_cajas    INTEGER,
  rollos_x_caja INTEGER,
  cant_rollos   INTEGER,
  -- Calculados por el servidor y congelados al cerrar. En el Excel eran dos
  -- fórmulas que cualquiera podía sobrescribir con un número a mano.
  total_lote    INTEGER,
  muestra       INTEGER,
  -- Lo que se revisa y el veredicto, tal como en la hoja de papel.
  diametro      TEXT,
  medida_centro TEXT,
  nitida        TEXT,
  resultado     TEXT,
  observacion   TEXT,
  -- Seguimiento del lote rechazado, en dos tiempos. El Team Leader, que está
  -- cerca del material, PROPONE qué debería hacerse; el Administrador APRUEBA, y
  -- al aprobar puede cambiar la salida: la última palabra es suya, no un visto
  -- bueno de trámite. Lo aprobado queda en 'disposicion', que es la decisión
  -- firme; la propuesta se conserva aunque el Administrador decida otra cosa.
  propuesta        TEXT,
  propuesta_nota   TEXT,
  propuesto_por    INTEGER REFERENCES usuarios(id),
  propuesto_en     TEXT,
  disposicion      TEXT,
  disposicion_nota TEXT,
  aprobado_por     INTEGER REFERENCES usuarios(id),
  aprobado_en      TEXT,
  orden         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS firmas_calidad (
  id           INTEGER PRIMARY KEY,
  recepcion_id INTEGER NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  rol          TEXT    NOT NULL,
  usuario_id   INTEGER REFERENCES usuarios(id),
  nombre       TEXT    NOT NULL,
  imagen       TEXT    NOT NULL,
  firmado_en   TEXT    NOT NULL,
  UNIQUE (recepcion_id, rol)
);

-- Misma decisión que en 'fotos': el archivo vive en datos/fotos/ y aquí solo su
-- nombre. lote_id NULL = evidencia de toda la recepción (las pruebas de
-- impresión que la hoja de papel pedía adjuntar siempre).
CREATE TABLE IF NOT EXISTS fotos_calidad (
  id           INTEGER PRIMARY KEY,
  recepcion_id INTEGER NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  lote_id      INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
  archivo      TEXT    NOT NULL UNIQUE,
  bytes        INTEGER NOT NULL,
  subida_por   INTEGER REFERENCES usuarios(id),
  subida_en    TEXT    NOT NULL
);

-- Lo que el Administrador deshace. Reabrir algo ya cerrado es su privilegio,
-- pero no puede ser invisible: sin registro de quién y por qué, el cierre de una
-- recepción dejaría de significar nada.
CREATE TABLE IF NOT EXISTS reversiones_calidad (
  id            INTEGER PRIMARY KEY,
  tipo          TEXT    NOT NULL,
  referencia_id INTEGER NOT NULL,
  motivo        TEXT    NOT NULL,
  usuario_id    INTEGER REFERENCES usuarios(id),
  ocurrido_en   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lotes_recepcion ON lotes (recepcion_id);
CREATE INDEX IF NOT EXISTS idx_lotes_resultado ON lotes (resultado);
CREATE INDEX IF NOT EXISTS idx_recepciones_fecha ON recepciones (fecha_llegada);
CREATE INDEX IF NOT EXISTS idx_fotos_calidad_lote ON fotos_calidad (lote_id);
`);

// La primera versión de Calidad cerraba el rechazo al revés: el Administrador
// registraba la disposición y un Team Leader la confirmaba, con lo que la última
// palabra quedaba en el Team Leader. Ahora el Team Leader propone y el
// Administrador aprueba. Los nombres de columna se acomodan a eso.
function renombrarColumna(tabla, viejo, nuevo) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  if (!columnas.includes(viejo) || columnas.includes(nuevo)) return;
  db.exec(`ALTER TABLE ${tabla} RENAME COLUMN ${viejo} TO ${nuevo}`);
}

renombrarColumna('lotes', 'dispuesto_por', 'propuesto_por');
renombrarColumna('lotes', 'dispuesto_en', 'propuesto_en');
renombrarColumna('lotes', 'confirmado_por', 'aprobado_por');
renombrarColumna('lotes', 'confirmado_en', 'aprobado_en');

agregarColumna('lotes', 'propuesta', 'TEXT');
agregarColumna('lotes', 'propuesta_nota', 'TEXT');

// Los lotes decididos con el flujo anterior traen una disposición registrada sin
// haber pasado por una propuesta. Se reinterpretan: lo que se había registrado
// pasa a ser la propuesta, y solo sigue contando como decisión firme lo que
// además ya estaba confirmado. Así nada queda aprobado por una sola persona.
db.exec(`
  UPDATE lotes SET propuesta = disposicion, propuesta_nota = disposicion_nota
   WHERE disposicion IS NOT NULL AND propuesta IS NULL;
  UPDATE lotes SET disposicion = NULL, disposicion_nota = NULL
   WHERE aprobado_en IS NULL AND disposicion IS NOT NULL;
`);
agregarColumna('recepciones', 'aprobado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('recepciones', 'aprobado_en', 'TEXT');


// ------------------------------------------------------------------ almacén
//
// El libro `GESTION_ALMACEN_INKO.xlsm` traía siete hojas que se calculaban entre
// sí a fuerza de SUMIF. Aquí solo se guarda lo que alguien capturó; INVENTARIO,
// EVALUACIÓN ODT y DASHBOARD no son tablas: se calculan al momento de pedirlos.
// Esa es la diferencia de fondo con el Excel, donde el inventario era una hoja
// que podía quedar desfasada o sobrescrita por un pegue.
//
// La regla que gobierna todo el módulo: la existencia de un producto en una
// bodega es la suma de sus movimientos, y nada más. No hay una columna
// `existencia` que alguien pueda corregir a mano. Para cambiar una existencia
// hay que registrar un movimiento, y todo movimiento nace de un documento con
// folio y responsable.
db.exec(`
-- Las bodegas de INKO. En el Excel eran dos columnas fijas repetidas en cada
-- hoja; abrir una tercera obligaba a rehacer todas las fórmulas. Aquí es un alta.
CREATE TABLE IF NOT EXISTS almacen_bodegas (
  id     INTEGER PRIMARY KEY,
  clave  TEXT    NOT NULL UNIQUE,
  nombre TEXT    NOT NULL UNIQUE,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

-- La hoja CATALOGO: la lista maestra de productos. 'material_id' es el enganche
-- con el catálogo de Calidad: si el producto tiene material, lo que entra de él
-- pasa por muestreo antes de contar como existencia. Si no lo tiene —cajas,
-- poliolefina, despachadores—, no hay nada que muestrear y entra directo.
CREATE TABLE IF NOT EXISTS almacen_productos (
  id            INTEGER PRIMARY KEY,
  sku           TEXT    NOT NULL UNIQUE,
  modelo        TEXT,
  tipo_material TEXT,
  nombre        TEXT    NOT NULL UNIQUE,
  stock_minimo  INTEGER NOT NULL DEFAULT 0,
  material_id   INTEGER REFERENCES materiales(id),
  orden         INTEGER NOT NULL DEFAULT 0,
  activo        INTEGER NOT NULL DEFAULT 1
);

-- La hoja SKU X MODELO: cada publicación de Mercado Libre o Amazon con cuántas
-- unidades del producto lleva. Es lo que convierte «35 pedidos» en «700 rollos».
CREATE TABLE IF NOT EXISTS almacen_publicaciones (
  id       INTEGER PRIMARY KEY,
  codigo   TEXT    NOT NULL UNIQUE,
  modelo   TEXT    NOT NULL,
  nombre   TEXT,
  unidades INTEGER NOT NULL DEFAULT 1,
  activo   INTEGER NOT NULL DEFAULT 1
);

-- El libro mayor. Un renglón por producto que se movió. Nadie escribe aquí a
-- mano: cada movimiento lo genera un documento al aplicarse, y guarda de cuál
-- vino en (origen_tipo, origen_id) para poder rastrearlo al derecho y al revés.
--
-- Signo: la cantidad siempre es positiva y el signo lo dan las bodegas. Suma en
-- destino, resta en origen. Un traspaso trae las dos y es un solo renglón, igual
-- que en el Excel. Un ajuste que baja existencia se registra como origen sin
-- destino; uno que la sube, como destino sin origen.
CREATE TABLE IF NOT EXISTS almacen_movimientos (
  id                INTEGER PRIMARY KEY,
  fecha             TEXT    NOT NULL,
  semana            TEXT,
  -- entrada | salida | devolucion | traspaso | ajuste | retiro
  tipo              TEXT    NOT NULL,
  producto_id       INTEGER NOT NULL REFERENCES almacen_productos(id),
  bodega_origen_id  INTEGER REFERENCES almacen_bodegas(id),
  bodega_destino_id INTEGER REFERENCES almacen_bodegas(id),
  cantidad          INTEGER NOT NULL,
  referencia        TEXT,
  origen_tipo       TEXT,
  origen_id         INTEGER,
  usuario_id        INTEGER REFERENCES usuarios(id),
  notas             TEXT,
  creado_en         TEXT    NOT NULL
);

-- ENTRADAS. Cubre las dos maneras en que llega material: de un proveedor y de un
-- retiro de plataforma (Mercado Libre Full, Amazon FBA). Es un solo documento
-- porque el camino es el mismo — se recibe, Calidad muestrea, se aprueba, suma —
-- y partirlo en dos pantallas sería repetir el mismo formulario con otro título.
--
-- 'recepcion_id' es la recepción que este documento abrió en Calidad. La entrada
-- no suma nada mientras esa recepción no tenga el visto bueno del Administrador.
CREATE TABLE IF NOT EXISTS almacen_entradas (
  id           INTEGER PRIMARY KEY,
  folio        TEXT    NOT NULL,
  -- proveedor | retiro
  fuente       TEXT    NOT NULL DEFAULT 'proveedor',
  proveedor    TEXT,
  plataforma   TEXT,
  bodega_id    INTEGER NOT NULL REFERENCES almacen_bodegas(id),
  fecha        TEXT    NOT NULL,
  -- borrador | en_calidad | aplicada | cancelada
  estado       TEXT    NOT NULL DEFAULT 'borrador',
  recepcion_id INTEGER REFERENCES recepciones(id),
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
  notas        TEXT,
  creado_en    TEXT    NOT NULL,
  enviado_en   TEXT,
  aplicado_en  TEXT,
  UNIQUE (fuente, folio)
);

-- Un renglón por producto que traía la entrega. 'lote_id' es el lote que este
-- renglón abrió en Calidad; 'cantidad_aplicada' es lo que de verdad terminó
-- sumando, que puede ser menos de lo que llegó si Calidad rechazó parte.
CREATE TABLE IF NOT EXISTS almacen_entrada_renglones (
  id                INTEGER PRIMARY KEY,
  entrada_id        INTEGER NOT NULL REFERENCES almacen_entradas(id) ON DELETE CASCADE,
  producto_id       INTEGER NOT NULL REFERENCES almacen_productos(id),
  cantidad          INTEGER NOT NULL DEFAULT 0,
  lote_id           INTEGER REFERENCES lotes(id),
  cantidad_aplicada INTEGER,
  orden             INTEGER NOT NULL DEFAULT 0
);

-- ODT DE LA SEMANA. Se carga el código de publicación y cuántos pedidos hay; las
-- unidades las multiplica el servidor contra el catálogo de publicaciones. En el
-- Excel esto era un INDEX/MATCH que se rompía al insertar filas.
CREATE TABLE IF NOT EXISTS almacen_odt (
  id         INTEGER PRIMARY KEY,
  semana     TEXT    NOT NULL UNIQUE,
  bodega_id  INTEGER REFERENCES almacen_bodegas(id),
  -- abierta | cerrada
  estado     TEXT    NOT NULL DEFAULT 'abierta',
  usuario_id INTEGER REFERENCES usuarios(id),
  notas      TEXT,
  creado_en  TEXT    NOT NULL,
  cerrado_en TEXT
);

CREATE TABLE IF NOT EXISTS almacen_odt_renglones (
  id      INTEGER PRIMARY KEY,
  odt_id  INTEGER NOT NULL REFERENCES almacen_odt(id) ON DELETE CASCADE,
  codigo  TEXT    NOT NULL,
  pedidos INTEGER NOT NULL DEFAULT 0,
  orden   INTEGER NOT NULL DEFAULT 0
);

-- SALIDAS. Todo lo que sale tiene contra qué cotejarse: la ODT de la semana o un
-- envío de ventas por fuera. El Excel tenía «Salida» y «Venta» como dos tipos
-- sueltos que no se comparaban contra nada; aquí el motivo obliga a decir a
-- cuenta de qué sale el material. El traspaso entre bodegas también es una
-- salida, con bodega destino: así hay un solo lugar donde se saca material.
CREATE TABLE IF NOT EXISTS almacen_salidas (
  id                INTEGER PRIMARY KEY,
  folio             TEXT    NOT NULL UNIQUE,
  -- odt | ventas_fuera | traspaso | otro
  motivo            TEXT    NOT NULL,
  odt_id            INTEGER REFERENCES almacen_odt(id),
  destino           TEXT,
  bodega_id         INTEGER NOT NULL REFERENCES almacen_bodegas(id),
  bodega_destino_id INTEGER REFERENCES almacen_bodegas(id),
  fecha             TEXT    NOT NULL,
  -- borrador | aplicada | cancelada
  estado            TEXT    NOT NULL DEFAULT 'borrador',
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  autorizo_id       INTEGER REFERENCES usuarios(id),
  notas             TEXT,
  creado_en         TEXT    NOT NULL,
  aplicado_en       TEXT
);

CREATE TABLE IF NOT EXISTS almacen_salida_renglones (
  id          INTEGER PRIMARY KEY,
  salida_id   INTEGER NOT NULL REFERENCES almacen_salidas(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES almacen_productos(id),
  cantidad    INTEGER NOT NULL DEFAULT 0,
  orden       INTEGER NOT NULL DEFAULT 0
);

-- DEVOLUCIONES. Material que ya había salido y regresa porque el CEDIS o el
-- cliente lo rechazó. Suma de vuelta a la bodega, pero solo después de que
-- alguien distinto de quien la capturó la revise: material rechazado en la
-- entrega no vuelve al inventario por la palabra de una sola persona.
CREATE TABLE IF NOT EXISTS almacen_devoluciones (
  id          INTEGER PRIMARY KEY,
  folio       TEXT    NOT NULL UNIQUE,
  -- cedis | cliente
  rechazo_de  TEXT    NOT NULL,
  quien       TEXT,
  salida_id   INTEGER REFERENCES almacen_salidas(id),
  bodega_id   INTEGER NOT NULL REFERENCES almacen_bodegas(id),
  fecha       TEXT    NOT NULL,
  motivo      TEXT,
  -- borrador | aplicada | cancelada
  estado      TEXT    NOT NULL DEFAULT 'borrador',
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  autorizo_id INTEGER REFERENCES usuarios(id),
  creado_en   TEXT    NOT NULL,
  aplicado_en TEXT
);

CREATE TABLE IF NOT EXISTS almacen_devolucion_renglones (
  id            INTEGER PRIMARY KEY,
  devolucion_id INTEGER NOT NULL REFERENCES almacen_devoluciones(id) ON DELETE CASCADE,
  producto_id   INTEGER NOT NULL REFERENCES almacen_productos(id),
  cantidad      INTEGER NOT NULL DEFAULT 0,
  orden         INTEGER NOT NULL DEFAULT 0
);

-- CONTEOS SEMANALES. Quien cuenta anota lo físico; el sistema calcula la
-- diferencia contra lo teórico y la deja pendiente. El ajuste lo autoriza otra
-- persona. En el Excel la carga semanal reemplazaba el inventario de un pegue,
-- sin que quedara constancia de cuánto se había movido el número ni por qué.
CREATE TABLE IF NOT EXISTS almacen_conteos (
  id            INTEGER PRIMARY KEY,
  semana        TEXT    NOT NULL,
  bodega_id     INTEGER NOT NULL REFERENCES almacen_bodegas(id),
  fecha         TEXT    NOT NULL,
  -- borrador | por_autorizar | aplicado | cancelado
  estado        TEXT    NOT NULL DEFAULT 'borrador',
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  cerrado_en    TEXT,
  autorizo_id   INTEGER REFERENCES usuarios(id),
  autorizado_en TEXT,
  notas         TEXT,
  creado_en     TEXT    NOT NULL,
  UNIQUE (semana, bodega_id)
);

-- 'teorico' se congela al cerrar el conteo: es lo que el sistema decía en ese
-- momento. Sin congelarlo, un movimiento capturado después cambiaría la
-- diferencia y nadie sabría contra qué se contó.
CREATE TABLE IF NOT EXISTS almacen_conteo_renglones (
  id          INTEGER PRIMARY KEY,
  conteo_id   INTEGER NOT NULL REFERENCES almacen_conteos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES almacen_productos(id),
  contado     INTEGER,
  teorico     INTEGER,
  observacion TEXT,
  UNIQUE (conteo_id, producto_id)
);

-- Evidencia de los documentos de almacén. Misma decisión que en 'fotos' y
-- 'fotos_calidad': el archivo vive en datos/fotos/ y aquí solo su nombre. Una
-- devolución no se autoriza sin foto — material que vuelve del CEDIS o de un
-- cliente y se reintegra al inventario sin nada que lo respalde es exactamente
-- el renglón que después nadie puede explicar.
CREATE TABLE IF NOT EXISTS almacen_fotos (
  id             INTEGER PRIMARY KEY,
  documento_tipo TEXT    NOT NULL,
  documento_id   INTEGER NOT NULL,
  archivo        TEXT    NOT NULL UNIQUE,
  bytes          INTEGER NOT NULL,
  subida_por     INTEGER REFERENCES usuarios(id),
  subida_en      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alm_fotos ON almacen_fotos (documento_tipo, documento_id);
CREATE INDEX IF NOT EXISTS idx_alm_mov_producto ON almacen_movimientos (producto_id);
CREATE INDEX IF NOT EXISTS idx_alm_mov_fecha    ON almacen_movimientos (fecha);
CREATE INDEX IF NOT EXISTS idx_alm_mov_origen   ON almacen_movimientos (origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS idx_alm_ent_estado   ON almacen_entradas (estado);
CREATE INDEX IF NOT EXISTS idx_alm_sal_estado   ON almacen_salidas (estado);
CREATE INDEX IF NOT EXISTS idx_alm_cont_estado  ON almacen_conteos (estado);

-- INCIDENCIAS. La hoja de papel que hoy trae los nombres de todos los operadores
-- y Team Leaders: cuando alguien comete una incidencia se anota, a un lado de su
-- nombre, la situacion y la fecha en que fue.
--
-- Quien la levanta y a quien se le levanta son personas distintas y las dos
-- quedan guardadas: en el papel eso se perdia, porque la letra no dice quien
-- escribio. Y como esto termina afectando el bono del mes, importa poder
-- responder «quien anoto esto y quien lo autorizo».
--
-- Un Team Leader la levanta y queda 'por_autorizar' hasta que el Administrador
-- diga que si. La que levanta el Administrador nace 'autorizada' y firme: no la
-- modifica nadie, ni el mismo. Una vez autorizada, ninguna se toca.
CREATE TABLE IF NOT EXISTS incidencias (
  id             INTEGER PRIMARY KEY,
  -- A quien se le levanta.
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
  fecha          TEXT    NOT NULL,
  situacion      TEXT    NOT NULL,
  -- por_autorizar | autorizada | rechazada | cancelada
  estado         TEXT    NOT NULL DEFAULT 'por_autorizar',
  levantada_por  INTEGER NOT NULL REFERENCES usuarios(id),
  levantada_en   TEXT    NOT NULL,
  resuelta_por   INTEGER REFERENCES usuarios(id),
  resuelta_en    TEXT,
  nota_resolucion TEXT,
  -- 1 cuando la levanto el Administrador: no se modifica ni se cancela.
  firme          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_incidencias_persona ON incidencias (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS idx_incidencias_estado  ON incidencias (estado);

-- Las CITAS de entrega en CEDIS que trae la ODT. Cada una es un día, un CEDIS y
-- un folio de cita; el material de la semana se arma para cumplirlas. Vienen del
-- archivo de Excel, donde se capturan como texto («Viernes 28 Ago #73880087
-- CEDIS: DANHOS») y aquí quedan como datos con los que sí se puede contar.
CREATE TABLE IF NOT EXISTS almacen_odt_citas (
  id        INTEGER PRIMARY KEY,
  odt_id    INTEGER NOT NULL REFERENCES almacen_odt(id) ON DELETE CASCADE,
  cuenta    TEXT,
  fecha     TEXT,
  etiqueta  TEXT,
  folio     TEXT,
  cedis     TEXT    NOT NULL,
  destacada INTEGER NOT NULL DEFAULT 0,
  orden     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_alm_odt_citas ON almacen_odt_citas (odt_id);

-- Interruptores del sistema que decide el Administrador. Hoy guarda uno solo, el
-- modo de pruebas de Checklists, pero es una tabla y no una columna suelta para
-- que el siguiente interruptor sea un renglón. Guarda quién lo movió y cuándo:
-- un modo de pruebas que alguien dejó prendido es justo lo que hay que poder
-- rastrear.
CREATE TABLE IF NOT EXISTS ajustes_sistema (
  clave        TEXT PRIMARY KEY,
  valor        TEXT,
  cambiado_por INTEGER REFERENCES usuarios(id),
  cambiado_en  TEXT
);
`);

// Un traspaso no se aplica de un botonazo: pasa por Almacen (lo aprueba un Team
// Leader), por Transito (avisa que el material ya va cargado, con foto) y otra
// vez por Almacen (un Team Leader confirma que llego). Cada paso deja quien y
// cuando, porque cuando un traspaso se pierde en el camino lo primero que se
// pregunta es en que eslabon se quedo.
agregarColumna('almacen_salidas', 'aprobado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_salidas', 'aprobado_en', 'TEXT');
agregarColumna('almacen_salidas', 'cargado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_salidas', 'cargado_en', 'TEXT');
agregarColumna('almacen_salidas', 'confirmado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_salidas', 'confirmado_en', 'TEXT');

// La ODT llega en un Excel con dos bloques, uno por cuenta de Mercado Libre. El
// mismo código puede aparecer en las dos, así que el renglón guarda de cuál vino.
agregarColumna('almacen_odt_renglones', 'cuenta', 'TEXT');
agregarColumna('almacen_odt_renglones', 'tipo', 'TEXT');

// Constancia de de dónde salió la ODT: el periodo tal como venía escrito en el
// archivo y el nombre del archivo que se cargó.
agregarColumna('almacen_odt', 'periodo', 'TEXT');
agregarColumna('almacen_odt', 'archivo', 'TEXT');
agregarColumna('almacen_odt', 'importado_en', 'TEXT');

// --- aprobación de checklists ---
//
// Un checklist que llena un operador no llega directo a Reportes: primero lo
// revisa un Team Leader, que lo aprueba o pide modificación. 'revision' dice en
// qué punto va: por_aprobar | modificacion | aprobado. Lo que ya estaba cerrado
// antes de que existiera la aprobación se toma por aprobado: se capturó y firmó
// con las reglas de entonces, y quitarlo de Reportes borraría la historia.
agregarColumna('llenados', 'revision', 'TEXT', () => {
  db.prepare("UPDATE llenados SET revision = 'aprobado' WHERE estado = 'cerrado'").run();
});
agregarColumna('llenados', 'aprobado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('llenados', 'aprobado_en', 'TEXT');

// Cada vuelta de la revisión queda anotada —enviado, modificación pedida con su
// motivo, aprobado—, porque en Reportes importa saber que un checklist tuvo que
// corregirse, aunque al final se haya aprobado.
db.exec(`
CREATE TABLE IF NOT EXISTS llenado_revisiones (
  id         INTEGER PRIMARY KEY,
  llenado_id INTEGER NOT NULL REFERENCES llenados(id) ON DELETE CASCADE,
  -- enviado | aprobado | modificacion
  accion     TEXT    NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  nota       TEXT,
  en         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llenado_revisiones ON llenado_revisiones (llenado_id);
`);

// Cambios de datos que se hacen UNA sola vez. Quedan marcados en ajustes_sistema
// para no repetirse en cada arranque. Si la base todavía no tiene lo que la
// migración toca —una instalación nueva antes de sembrar—, no se marca y se
// intenta en el siguiente arranque.
function migracionUnaVez(clave, aplica, hacer) {
  const marca = `migracion:${clave}`;
  if (db.prepare('SELECT 1 FROM ajustes_sistema WHERE clave = ?').get(marca)) return;
  if (!aplica()) return;
  db.exec('BEGIN');
  try {
    hacer();
    db.prepare("INSERT INTO ajustes_sistema (clave, valor, cambiado_en) VALUES (?, '1', ?)")
      .run(marca, new Date().toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
const hayPlantilla = (clave) => () => !!db.prepare('SELECT 1 FROM plantillas WHERE clave = ?').get(clave);

// Montacargas: el operador firma y lo envía, como los demás. La firma del
// coordinador la reemplaza la aprobación del Team Leader.
migracionUnaVez('montacargas-sin-coordinador', hayPlantilla('montacargas'), () => {
  db.prepare("UPDATE plantillas SET firma_coordinador = 0 WHERE clave = 'montacargas'").run();
});

// Documentación por unidad: tarjeta de circulación, póliza y fumigación dejan
// de ser «bien / problema» y piden su fecha de vencimiento; el dinero pide el
// monto y la foto. Los ítems viejos se retiran sin borrarse: lo ya capturado
// con ellos sigue en Reportes. Los nuevos toman el lugar de los viejos.
migracionUnaVez('unidad-documentacion-vencimientos', hayPlantilla('unidad'), () => {
  const plantilla = db.prepare("SELECT id FROM plantillas WHERE clave = 'unidad'").get();
  const ayudaFecha = 'Captura la fecha en que vence. La plataforma calcula los días que le quedan o los que lleva vencida.';
  const cambios = [
    { viejo: 'Tarjeta de circulación vigente', texto: 'Tarjeta de circulación', tipo: 'fecha',
      meta: { vigencia: true, obligatoria: true, etiqueta: 'Vence la tarjeta de circulación', ayuda: ayudaFecha } },
    { viejo: 'Póliza de seguro', texto: 'Póliza de seguro', tipo: 'fecha',
      meta: { vigencia: true, obligatoria: true, etiqueta: 'Vence la póliza', ayuda: ayudaFecha } },
    { viejo: 'Dinero', texto: 'Dinero en la unidad', tipo: 'dinero',
      meta: { obligatoria: true, ayuda: 'Captura cuánto dinero trae la unidad y toma la foto del efectivo.' } },
    { viejo: 'Fumigación de la unidad', texto: 'Fumigación de la unidad', tipo: 'fecha',
      meta: { vigencia: true, obligatoria: true, etiqueta: 'Vence la fumigación', ayuda: ayudaFecha } },
  ];
  const buscar = db.prepare(`
    SELECT i.* FROM items i JOIN secciones s ON s.id = i.seccion_id
     WHERE s.plantilla_id = ? AND i.texto = ? AND i.activo = 1`);
  const retirar = db.prepare('UPDATE items SET activo = 0 WHERE id = ?');
  const crear = db.prepare(`
    INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta, activo)
    VALUES (?, ?, ?, ?, NULL, ?, 1)`);
  for (const c of cambios) {
    const viejo = buscar.get(plantilla.id, c.viejo);
    if (!viejo) continue;
    retirar.run(viejo.id);
    crear.run(viejo.seccion_id, viejo.orden, c.texto, c.tipo, JSON.stringify(c.meta));
  }
});

// Insumos y Cajas deja de ser checklist: el material de empaque se lleva como
// inventario normal de Almacén. El checklist se retira —lo capturado sigue en
// Reportes— y se dan de alta en el catálogo los materiales que no estaban.
migracionUnaVez('insumos-a-almacen', hayPlantilla('cajas'), () => {
  db.prepare("UPDATE plantillas SET activo = 0 WHERE clave = 'cajas'").run();
  const existe = db.prepare('SELECT 1 FROM almacen_productos WHERE LOWER(nombre) = LOWER(?)');
  const ultimoSku = () => {
    const f = db.prepare("SELECT sku FROM almacen_productos WHERE sku LIKE 'SKU%' ORDER BY sku DESC LIMIT 1").get();
    return f ? Number(f.sku.slice(3)) : 0;
  };
  const orden = () => (db.prepare('SELECT COALESCE(MAX(orden), 0) AS n FROM almacen_productos').get().n + 1);
  const alta = db.prepare(`
    INSERT INTO almacen_productos (sku, modelo, tipo_material, nombre, stock_minimo, orden, activo)
    VALUES (?, NULL, ?, ?, 0, ?, 1)`);
  for (const [nombre, tipo] of [
    ['Caja Proveedor 80x70', 'Cajas'],
    ['Cintas Termiko', 'Material Empaque'],
    ['Repuestos de Cutter', 'Material Empaque'],
  ]) {
    if (existe.get(nombre)) continue;
    alta.run(`SKU${String(ultimoSku() + 1).padStart(6, '0')}`, tipo, nombre, orden());
  }
});

// La bodega donde se arma la ODT es un dato del catálogo, no una pregunta que se
// repita cada semana: en INKO siempre se arma en San Luis (B1). Si algún día se
// arma en otra, se cambia esta bandera y toda la evaluación de la ODT se muda
// con ella —qué falta, cuánto traspasar y desde dónde— sin tocar una pantalla.
agregarColumna('almacen_bodegas', 'arma_odt', 'INTEGER NOT NULL DEFAULT 0', () => {
  db.prepare("UPDATE almacen_bodegas SET arma_odt = 1 WHERE clave = 'B1'").run();
});

// TRÁNSITO: ENVÍOS Y COLECTAS.
//
// Cuándo se mandó a aprobación de cierre: es el fin real del recorrido. El
// tiempo en ruta se mide de la salida autorizada a este momento, no a cuando el
// Team Leader tuvo tiempo de aprobar.
agregarColumna('llenados', 'regreso_en', 'TEXT');

// La lista de CEDIS del desplegable. Es catálogo, no documento: el Administrador
// la edita en Configuración → Tránsito y nunca se borra un renglón, se retira.
db.exec(`
CREATE TABLE IF NOT EXISTS transito_cedis (
  id     INTEGER PRIMARY KEY,
  nombre TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);
`);
if (!db.prepare('SELECT 1 FROM transito_cedis LIMIT 1').get()) {
  const altaCedis = db.prepare('INSERT INTO transito_cedis (nombre, orden) VALUES (?, ?)');
  require('./transito-estructura').CEDIS_INICIALES.forEach((nombre, i) => altaCedis.run(nombre, i));
}

// La base que ya existía: cabecera nueva (envío o colecta, número, CEDIS), las
// secciones de siempre quedan como del envío y se agregan las de la colecta. Lo
// ya capturado era todo envío. Idempotente: en una base nueva la carga inicial
// ya trae esta misma estructura y aquí no se duplica nada.
migracionUnaVez('transito-envio-colecta', hayPlantilla('transito'), () => {
  const T = require('./transito-estructura');
  const plantilla = db.prepare("SELECT id FROM plantillas WHERE clave = 'transito'").get();
  db.prepare('UPDATE plantillas SET campos = ?, descripcion = ? WHERE id = ?')
    .run(JSON.stringify(T.CAMPOS), T.DESCRIPCION, plantilla.id);

  const condicion = db.prepare('UPDATE secciones SET condicion = ? WHERE plantilla_id = ? AND titulo = ?');
  for (const titulo of T.SECCIONES_DE_ENVIO) condicion.run(JSON.stringify(T.ENVIO), plantilla.id, titulo);

  const existe = db.prepare('SELECT 1 FROM secciones WHERE plantilla_id = ? AND titulo = ?');
  const siguiente = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM secciones WHERE plantilla_id = ?');
  const altaSeccion = db.prepare('INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo) VALUES (?, ?, ?, ?, ?, 1)');
  const altaItem = db.prepare('INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta) VALUES (?, ?, ?, ?, NULL, ?)');
  for (const s of T.SECCIONES_COLECTA) {
    if (existe.get(plantilla.id, s.titulo)) continue;
    const seccionId = Number(altaSeccion.run(plantilla.id, siguiente.get(plantilla.id).n, s.titulo, s.etapa,
      JSON.stringify(s.condicion)).lastInsertRowid);
    s.items.forEach(([texto, tipo, , meta], i) => altaItem.run(seccionId, i, texto, tipo, JSON.stringify(meta || {})));
  }

  const guardarDatos = db.prepare('UPDATE llenados SET datos = ? WHERE id = ?');
  for (const l of db.prepare('SELECT id, datos FROM llenados WHERE plantilla_id = ?').all(plantilla.id)) {
    const datos = JSON.parse(l.datos || '{}');
    if (!datos.tipo) guardarDatos.run(JSON.stringify({ tipo: 'envio', ...datos }), l.id);
  }
});

// ALMACÉN: APROBACIONES Y CORRECCIONES.
//
// Ningún documento toca el inventario sin que otra persona lo apruebe, y quien
// tenga el permiso puede pedir que se corrija —aunque ya se haya aplicado—. Cada
// documento guarda quién lo aprobó y cuándo, y la última corrección pedida
// mientras siga en captura.
for (const tabla of ['almacen_entradas', 'almacen_salidas', 'almacen_devoluciones', 'almacen_conteos']) {
  agregarColumna(tabla, 'correccion_nota', 'TEXT');
  agregarColumna(tabla, 'correccion_por', 'INTEGER REFERENCES usuarios(id)');
  agregarColumna(tabla, 'correccion_en', 'TEXT');
}
agregarColumna('almacen_entradas', 'aprobado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_entradas', 'aprobado_en', 'TEXT');
agregarColumna('almacen_salidas', 'enviado_en', 'TEXT');
agregarColumna('almacen_devoluciones', 'enviado_en', 'TEXT');
agregarColumna('almacen_conteos', 'cerrado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_conteo_renglones', 'contado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_conteo_renglones', 'recontar', 'INTEGER NOT NULL DEFAULT 0');

// Una recepción que abrió una entrada de almacén. Si la entrada se regresa a
// corregir, esa recepción queda 'cancelada' (anulada) y al volver a aprobarse
// se abre otra: así lo revisado antes no se pierde ni se mezcla con lo nuevo.
agregarColumna('recepciones', 'entrada_id', 'INTEGER');

db.exec(`
-- El historial de correcciones de Almacén: quién pidió corregir qué, en qué
-- estado estaba y por qué. Es lo que dice cuántas veces se rehizo un documento.
CREATE TABLE IF NOT EXISTS almacen_correcciones (
  id              INTEGER PRIMARY KEY,
  documento_tipo  TEXT    NOT NULL,
  documento_id    INTEGER NOT NULL,
  folio           TEXT,
  estado_anterior TEXT    NOT NULL,
  nota            TEXT    NOT NULL,
  usuario_id      INTEGER REFERENCES usuarios(id),
  en              TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alm_correcciones ON almacen_correcciones (documento_tipo, documento_id);

-- Lo que llega en una entrada y Calidad no muestrea (cajas, empaque,
-- portarollos). Calidad confirma cuánto llegó bien; eso es lo que suma.
CREATE TABLE IF NOT EXISTS recepcion_sin_muestreo (
  id                 INTEGER PRIMARY KEY,
  recepcion_id       INTEGER NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  entrada_renglon_id INTEGER,
  producto_id        INTEGER NOT NULL REFERENCES almacen_productos(id),
  cantidad           INTEGER NOT NULL,
  cantidad_buena     INTEGER,
  observacion        TEXT,
  orden              INTEGER NOT NULL DEFAULT 0
);
`);

// RETIROS APARTE DE LAS ENTRADAS.
//
// Un retiro de plataforma dejó de ser una entrada más. Se carga aquí lo que se
// pidió en Mercado Libre Full o en Amazon FBA y queda «pendiente de recibir»:
// no mueve inventario, solo avisa que viene material. Lo que sí entra es cada
// re-ingreso que Calidad levanta cuando el material llega a la bodega, y esos
// pueden ser varios por retiro —llega por partes—. Cuando llegó todo, el retiro
// se cierra solo.
agregarColumna('almacen_entradas', 'cerrado_en', 'TEXT');
agregarColumna('almacen_entradas', 'cerrado_por', 'INTEGER REFERENCES usuarios(id)');

db.exec(`
-- RE-INGRESO DE UN RETIRO. Lo levanta Calidad cuando el material del retiro
-- llega a la bodega: cuántas cajas se reciben en esta entrega y qué trae cada
-- una. Solo suma al inventario cuando otra persona con permiso lo aprueba.
CREATE TABLE IF NOT EXISTS almacen_reingresos (
  id              INTEGER PRIMARY KEY,
  folio           TEXT    NOT NULL UNIQUE,
  entrada_id      INTEGER NOT NULL REFERENCES almacen_entradas(id),
  bodega_id       INTEGER NOT NULL REFERENCES almacen_bodegas(id),
  fecha           TEXT    NOT NULL,
  -- Cuántas cajas dice quien recibe que llegaron. El detalle tiene que cuadrar
  -- con este número: si dice 6 cajas y detalla 5, algo se quedó sin revisar.
  cajas           INTEGER NOT NULL DEFAULT 0,
  -- borrador | por_autorizar | aplicado | cancelado
  estado          TEXT    NOT NULL DEFAULT 'borrador',
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  aprobado_por    INTEGER REFERENCES usuarios(id),
  notas           TEXT,
  creado_en       TEXT    NOT NULL,
  enviado_en      TEXT,
  aprobado_en     TEXT,
  aplicado_en     TEXT,
  correccion_nota TEXT,
  correccion_por  INTEGER REFERENCES usuarios(id),
  correccion_en   TEXT
);
CREATE INDEX IF NOT EXISTS idx_reingresos_retiro ON almacen_reingresos (entrada_id);

-- El detalle caja por caja: qué producto trae y cuánto se verificó dentro. Es
-- lo que suma al inventario, no lo que decía el retiro.
CREATE TABLE IF NOT EXISTS almacen_reingreso_cajas (
  id           INTEGER PRIMARY KEY,
  reingreso_id INTEGER NOT NULL REFERENCES almacen_reingresos(id) ON DELETE CASCADE,
  numero       INTEGER NOT NULL DEFAULT 1,
  producto_id  INTEGER NOT NULL REFERENCES almacen_productos(id),
  cantidad     INTEGER NOT NULL DEFAULT 0,
  observacion  TEXT,
  orden        INTEGER NOT NULL DEFAULT 0
);
`);

// EL DETALLE DE CAJAS DE UN CONTEO.
//
// Cuando un producto descuadra, quien cuenta tiene que decir cómo llegó a ese
// número: «9 cajas de 50 y 6 cajas de 43». La suma tiene que dar exactamente lo
// contado; si no da, no es un conteo, es una estimación. Va en su propia tabla
// —y no como texto libre— justamente para poder sumarla y compararla.
db.exec(`
CREATE TABLE IF NOT EXISTS almacen_conteo_cajas (
  id               INTEGER PRIMARY KEY,
  renglon_id       INTEGER NOT NULL REFERENCES almacen_conteo_renglones(id) ON DELETE CASCADE,
  cajas            INTEGER NOT NULL DEFAULT 0,
  piezas_por_caja  INTEGER NOT NULL DEFAULT 0,
  orden            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conteo_cajas ON almacen_conteo_cajas (renglon_id);
`);

// CONTEOS PARCIALES: se cuentan las partidas que se escojan, no siempre todas.
//
// El UNIQUE (semana, bodega) venía de cuando un conteo era, por definición, la
// bodega entera una vez por semana. Ahora se puede mandar a contar un puñado de
// productos hoy y otro puñado mañana, así que ese candado impedía justo lo que
// se pidió. Se reconstruye la tabla sin él; los id se conservan para que los
// renglones, las correcciones y los movimientos sigan apuntando a su conteo.
(function permitirVariosConteosPorSemana() {
  const definicion = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'almacen_conteos'")
    .get();
  if (!definicion || !/UNIQUE\s*\(\s*semana/i.test(definicion.sql)) return;

  const columnas = db.prepare('PRAGMA table_info(almacen_conteos)').all().map((c) => c.name);
  const lista = columnas.join(', ');

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE almacen_conteos_nuevo (
        id              INTEGER PRIMARY KEY,
        semana          TEXT    NOT NULL,
        bodega_id       INTEGER NOT NULL REFERENCES almacen_bodegas(id),
        fecha           TEXT    NOT NULL,
        estado          TEXT    NOT NULL DEFAULT 'borrador',
        usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
        cerrado_en      TEXT,
        cerrado_por     INTEGER REFERENCES usuarios(id),
        autorizo_id     INTEGER REFERENCES usuarios(id),
        autorizado_en   TEXT,
        notas           TEXT,
        creado_en       TEXT    NOT NULL,
        correccion_nota TEXT,
        correccion_por  INTEGER REFERENCES usuarios(id),
        correccion_en   TEXT
      );
    `);
    db.exec(`INSERT INTO almacen_conteos_nuevo (${lista}) SELECT ${lista} FROM almacen_conteos`);
    db.exec('DROP TABLE almacen_conteos');
    db.exec('ALTER TABLE almacen_conteos_nuevo RENAME TO almacen_conteos');
    db.exec('COMMIT');
    console.log('  Conteos: ahora se puede contar por partidas, varias veces en la misma semana.');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');
})();

// LA IMAGEN DE UNA UNIDAD Y DE UN MATERIAL.
//
// Se carga en Configuración y aparece donde se usa: la unidad en su checklist,
// el material en el muestreo de Calidad y en Almacén. Es el nombre del archivo
// en datos/fotos, igual que cualquier otra foto del sistema.
agregarColumna('activos', 'imagen', 'TEXT');
agregarColumna('materiales', 'imagen', 'TEXT');

// PRODUCCIÓN ESPECIAL.
//
// Un rollo que se le pide al proveedor con algo distinto —el fondo de otro
// color, una impresión, una medida que no es la de siempre— y que llega a
// almacén como cualquier otro material: se da de alta y se mueve igual. Lo que
// cambia es que no es catálogo de todos los días, y mezclarlo con lo que sí se
// vende siempre ensucia el inventario, los conteos y la lista de reposición.
//
// Por eso no es un producto aparte ni otra tabla: es el mismo producto con tres
// datos más. Sigue siendo un «Rollo Térmico» para Calidad —se muestrea contra su
// mismo modelo— y para el inventario, pero se agrupa y se lee aparte.
//
//   especial      · que sí, que es producción especial
//   subagrupador  · bajo qué partida va («80x70 GRACIAS», «Cliente X»)
//   descripcion   · qué tiene de especial ese rollo: fondo, impresión, medida
agregarColumna('almacen_productos', 'especial', 'INTEGER NOT NULL DEFAULT 0');
agregarColumna('almacen_productos', 'subagrupador', 'TEXT');
agregarColumna('almacen_productos', 'descripcion', 'TEXT');

// Los «80x70 GRACIAS» son el ejemplo que dio Ronaldo: están en el catálogo como
// Rollos Térmicos y no se venden de diario. Se pasan a su partida con su
// descripción; si algún día vuelven a ser de catálogo, se desmarcan en
// Configuración y regresan.
migracionUnaVez('gracias-a-produccion-especial',
  () => !!db.prepare("SELECT 1 FROM almacen_productos WHERE nombre LIKE '%GRACIAS%'").get(),
  () => {
    for (const p of db.prepare("SELECT id, nombre FROM almacen_productos WHERE nombre LIKE '%GRACIAS%'").all()) {
      const color = (p.nombre.match(/(Verde|Rojo|Azul|Morado|Rosa|Amarillo|Naranja|Blanco)/i) || [])[1];
      db.prepare(`
        UPDATE almacen_productos SET especial = 1, subagrupador = ?, descripcion = ?
         WHERE id = ?
      `).run('80x70 GRACIAS', color ? `Rollo 80x70 con impresión «GRACIAS», fondo ${color.toLowerCase()}.` : null, p.id);
    }
  });

// EL MOTIVO DE CADA PRODUCTO EN UNA SALIDA POR CALIDAD.
//
// No todos los rollos salen por lo mismo: uno se mojó, otro se golpeó, otro trae
// el adhesivo vencido. Por eso el porqué y su foto van en cada renglón, no una
// sola vez para todo el documento.
agregarColumna('almacen_salida_renglones', 'motivo', 'TEXT');

// PRODUCCIÓN: LA ODT PUBLICADA, SU REPARTO POR ENVÍO Y EL AVANCE.
//
// La ODT se carga, se reparte por envío y se PUBLICA. Hasta publicarse solo la
// ve quien la carga; ya publicada, la ve todo producción y nadie la cambia: lo
// único que la mueve es una modificación pedida y aprobada por otra persona.
agregarColumna('almacen_odt', 'publicada_en', 'TEXT');
agregarColumna('almacen_odt', 'publicada_por', 'INTEGER REFERENCES usuarios(id)');

db.exec(`
-- Cuánto de cada partida va en cada envío (cita). El Excel trae las citas pero
-- no el reparto: lo pone quien carga la ODT. Es contra lo que se mide el avance
-- por envío y por día.
CREATE TABLE IF NOT EXISTS produccion_reparto (
  id         INTEGER PRIMARY KEY,
  odt_id     INTEGER NOT NULL REFERENCES almacen_odt(id) ON DELETE CASCADE,
  renglon_id INTEGER NOT NULL REFERENCES almacen_odt_renglones(id) ON DELETE CASCADE,
  cita_id    INTEGER NOT NULL REFERENCES almacen_odt_citas(id) ON DELETE CASCADE,
  cantidad   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (renglon_id, cita_id)
);

-- Lo que cada quien arma: «armé 20 de esta partida para este envío», con su
-- nombre y la hora. De aquí salen el avance y las métricas por persona.
CREATE TABLE IF NOT EXISTS produccion_avances (
  id         INTEGER PRIMARY KEY,
  odt_id     INTEGER NOT NULL REFERENCES almacen_odt(id) ON DELETE CASCADE,
  renglon_id INTEGER NOT NULL REFERENCES almacen_odt_renglones(id) ON DELETE CASCADE,
  cita_id    INTEGER NOT NULL REFERENCES almacen_odt_citas(id) ON DELETE CASCADE,
  cantidad   INTEGER NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  en         TEXT    NOT NULL,
  nota       TEXT
);
CREATE INDEX IF NOT EXISTS idx_prod_avances ON produccion_avances (odt_id, renglon_id, cita_id);

-- Una modificación a una partida de la ODT publicada: qué cambia en cada envío,
-- por qué, quién la pidió y quién la aprobó. La ODT solo cambia al aprobarse.
CREATE TABLE IF NOT EXISTS produccion_modificaciones (
  id              INTEGER PRIMARY KEY,
  odt_id          INTEGER NOT NULL REFERENCES almacen_odt(id) ON DELETE CASCADE,
  renglon_id      INTEGER NOT NULL REFERENCES almacen_odt_renglones(id) ON DELETE CASCADE,
  -- [{ cita_id, antes, despues }]
  cambios         TEXT    NOT NULL,
  pedidos_antes   INTEGER NOT NULL,
  pedidos_despues INTEGER NOT NULL,
  motivo          TEXT    NOT NULL,
  -- por_aprobar | aprobada | rechazada | cancelada
  estado          TEXT    NOT NULL DEFAULT 'por_aprobar',
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en       TEXT    NOT NULL,
  resuelto_por    INTEGER REFERENCES usuarios(id),
  resuelto_en     TEXT,
  nota_resolucion TEXT
);
`);

// ENTREGAS X FUERA: LA ORDEN DE ARMADO DE UNA VENTA POR FUERA.
//
// La levanta quien vende por fuera, dentro de la plataforma: quién la pide,
// cuándo, a qué cliente, si va con guía de paquetería o con nota de remisión, y
// qué productos y cuántos. Almacén la arma y anota las cajas —modelo y peso de
// cada una—; quien vende carga la guía o la nota, y el encargado la cierra.
db.exec(`
CREATE TABLE IF NOT EXISTS vxf_ordenes (
  id               INTEGER PRIMARY KEY,
  folio            TEXT    NOT NULL UNIQUE,
  solicitante_id   INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_solicitud  TEXT    NOT NULL,
  cliente          TEXT    NOT NULL,
  -- guia | remision
  entrega          TEXT    NOT NULL,
  notas            TEXT,
  -- borrador | por_armar | armada | documentada | terminada | cancelada
  estado           TEXT    NOT NULL DEFAULT 'borrador',
  creado_en        TEXT    NOT NULL,
  enviado_en       TEXT,
  armado_por       INTEGER REFERENCES usuarios(id),
  armado_en        TEXT,
  documentado_por  INTEGER REFERENCES usuarios(id),
  documentado_en   TEXT,
  cerrado_por      INTEGER REFERENCES usuarios(id),
  cerrado_en       TEXT,
  correccion_nota  TEXT,
  correccion_por   INTEGER REFERENCES usuarios(id),
  correccion_en    TEXT
);

CREATE TABLE IF NOT EXISTS vxf_renglones (
  id          INTEGER PRIMARY KEY,
  orden_id    INTEGER NOT NULL REFERENCES vxf_ordenes(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES almacen_productos(id),
  cantidad    INTEGER NOT NULL DEFAULT 0,
  orden       INTEGER NOT NULL DEFAULT 0
);

-- Una fila por caja que se usó al armar: qué modelo de caja y cuánto pesa.
CREATE TABLE IF NOT EXISTS vxf_cajas (
  id          INTEGER PRIMARY KEY,
  orden_id    INTEGER NOT NULL REFERENCES vxf_ordenes(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES almacen_productos(id),
  peso_kg     REAL,
  orden       INTEGER NOT NULL DEFAULT 0
);
`);

// La salida de venta por fuera dice de qué orden de armado sale. Es contra esa
// orden que se ven las diferencias entre lo que se vendió y lo que salió.
agregarColumna('almacen_salidas', 'vxf_id', 'INTEGER REFERENCES vxf_ordenes(id)');

// El empaque (cajas, material de empaque, portarollos) no pasa por Calidad, así
// que no tiene «material» del que tomar la imagen: la lleva el producto mismo.
agregarColumna('almacen_productos', 'imagen', 'TEXT');

// A qué familia pertenece un modelo de muestreo (rollos o etiquetas). Un material
// y sus productos son lo mismo visto desde dos módulos; Configuración los enseña
// juntos, por familia. Al agregar la columna se deduce de sus productos; el que
// no tiene ninguno (p. ej. 63X22 JOYERIA) es etiqueta, que es lo que son casi todos.
agregarColumna('materiales', 'familia', 'TEXT', () => {
  db.exec(`
    UPDATE materiales SET familia = COALESCE((
      SELECT CASE WHEN p.tipo_material LIKE 'Rollos%' THEN 'rollos' ELSE 'etiquetas' END
        FROM almacen_productos p WHERE p.material_id = materiales.id LIMIT 1), 'etiquetas')`);
});

// CARTERA DE CLIENTES de Entregas x Fuera. La orden guarda el nombre tal como
// se escogió (su historia no cambia si luego se corrige la cartera) y además a
// qué cliente apunta. `revisado = 0` es un cliente que quien vende dio de alta
// desde una orden y que el encargado de la cartera todavía no ha visto.
db.exec(`
CREATE TABLE IF NOT EXISTS vxf_clientes (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  razon_social  TEXT,
  activo        INTEGER NOT NULL DEFAULT 1,
  origen        TEXT NOT NULL DEFAULT 'manual',
  revisado      INTEGER NOT NULL DEFAULT 1,
  creado_por    INTEGER REFERENCES usuarios(id),
  creado_en     TEXT
);
`);
agregarColumna('vxf_ordenes', 'cliente_id', 'INTEGER REFERENCES vxf_clientes(id)');

// Las órdenes levantadas antes de la cartera: cada nombre distinto se vuelve un
// cliente y la orden queda apuntándole.
migracionUnaVez('vxf-clientes-de-ordenes', () => true, () => {
  for (const o of db.prepare('SELECT id, cliente FROM vxf_ordenes WHERE cliente_id IS NULL').all()) {
    const nombre = String(o.cliente || '').trim().replace(/\s+/g, ' ');
    if (!nombre) continue;
    db.prepare(`INSERT OR IGNORE INTO vxf_clientes (nombre, origen, revisado, creado_en) VALUES (?, 'orden', 0, ?)`)
      .run(nombre, new Date().toISOString());
    const c = db.prepare('SELECT id FROM vxf_clientes WHERE nombre = ?').get(nombre);
    db.prepare('UPDATE vxf_ordenes SET cliente_id = ? WHERE id = ?').run(c.id, o.id);
  }
});

// LOGÍSTICA. Las unidades dejaron de ser solo «vehículo» y «montacargas»: hay
// patines, motos, carros utilitarios y carros de arrendamiento, y cada tipo se
// revisa distinto. El tipo vive en su propia tabla para que el Administrador lo
// edite, y para que cada tipo diga si lleva kilometraje y si carga combustible
// —un patín no tiene odómetro ni tanque—.
db.exec(`
CREATE TABLE IF NOT EXISTS activo_tipos (
  clave              TEXT PRIMARY KEY,
  etiqueta           TEXT NOT NULL,
  plural             TEXT,
  orden              INTEGER NOT NULL DEFAULT 0,
  activo             INTEGER NOT NULL DEFAULT 1,
  lleva_kilometraje  INTEGER NOT NULL DEFAULT 0,
  lleva_combustible  INTEGER NOT NULL DEFAULT 0
);
`);

for (const [clave, etiqueta, plural, orden, km, comb] of [
  ['vehiculo', 'Camioneta de reparto', 'Camionetas de reparto', 0, 1, 1],
  ['utilitario', 'Carro utilitario', 'Carros utilitarios', 1, 1, 1],
  ['arrendamiento', 'Carro de arrendamiento', 'Carros de arrendamiento', 2, 1, 1],
  ['moto', 'Moto', 'Motos', 3, 1, 1],
  ['montacargas', 'Montacargas', 'Montacargas', 4, 0, 1],
  ['patin', 'Patín hidráulico', 'Patines hidráulicos', 5, 0, 0],
]) {
  db.prepare(`
    INSERT INTO activo_tipos (clave, etiqueta, plural, orden, lleva_kilometraje, lleva_combustible)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (clave) DO NOTHING
  `).run(clave, etiqueta, plural, orden, km, comb);
}

// Cada carga de gasolina con su ticket. El kilometraje de la carga es lo que
// permite saber el rendimiento: los kilómetros entre esta carga y la anterior,
// divididos entre los litros. Por eso se pregunta si se llenó el tanque: con
// media carga la cuenta no significa nada y la plataforma no la usa.
db.exec(`
CREATE TABLE IF NOT EXISTS logistica_cargas (
  id            INTEGER PRIMARY KEY,
  folio         TEXT    NOT NULL UNIQUE,
  activo_id     INTEGER NOT NULL REFERENCES activos(id),
  fecha         TEXT    NOT NULL,
  litros        REAL    NOT NULL,
  costo         REAL    NOT NULL,
  kilometraje   INTEGER,
  tanque_lleno  INTEGER NOT NULL DEFAULT 1,
  estacion      TEXT,
  forma_pago    TEXT,
  ticket        TEXT,
  usuario_id    INTEGER REFERENCES usuarios(id),
  notas         TEXT,
  creado_en     TEXT
);

CREATE TABLE IF NOT EXISTS logistica_servicios (
  id            INTEGER PRIMARY KEY,
  folio         TEXT    NOT NULL UNIQUE,
  activo_id     INTEGER NOT NULL REFERENCES activos(id),
  tipo          TEXT    NOT NULL,
  estado        TEXT    NOT NULL DEFAULT 'hecho',
  fecha         TEXT,
  kilometraje   INTEGER,
  taller        TEXT,
  costo         REAL,
  descripcion   TEXT,
  proximo_km    INTEGER,
  proxima_fecha TEXT,
  archivo       TEXT,
  usuario_id    INTEGER REFERENCES usuarios(id),
  creado_en     TEXT
);

-- Las lecturas del odómetro, de donde vengan: del checklist al cerrarlo, de una
-- carga de gasolina o anotadas a mano. Una sola línea de tiempo por unidad.
CREATE TABLE IF NOT EXISTS logistica_lecturas (
  id          INTEGER PRIMARY KEY,
  activo_id   INTEGER NOT NULL REFERENCES activos(id),
  fecha       TEXT    NOT NULL,
  kilometros  INTEGER NOT NULL,
  origen_tipo TEXT    NOT NULL,
  origen_id   INTEGER,
  usuario_id  INTEGER REFERENCES usuarios(id),
  creado_en   TEXT
);

-- Los papeles. La columna ambito ya distingue unidad y persona: la del
-- personal (la Bahía digital) usa la misma tabla, con usuario_id en lugar de
-- activo_id, para que no haya dos lugares donde buscar un documento.
CREATE TABLE IF NOT EXISTS logistica_documentos (
  id          INTEGER PRIMARY KEY,
  ambito      TEXT    NOT NULL DEFAULT 'unidad',
  activo_id   INTEGER REFERENCES activos(id),
  usuario_id  INTEGER REFERENCES usuarios(id),
  tipo        TEXT    NOT NULL,
  nombre      TEXT,
  vence       TEXT,
  archivo     TEXT    NOT NULL,
  bytes       INTEGER,
  notas       TEXT,
  subido_por  INTEGER REFERENCES usuarios(id),
  subido_en   TEXT,
  activo      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS logistica_catalogos (
  id      INTEGER PRIMARY KEY,
  tipo    TEXT    NOT NULL,
  valor   TEXT    NOT NULL,
  orden   INTEGER NOT NULL DEFAULT 0,
  activo  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tipo, valor)
);

-- Lo que se traba cuando no se sabe de quién fue el intento fallido. Con la
-- clave como identidad, una clave equivocada no apunta a nadie: no hay a quién
-- bloquear, así que se traba el aparato desde donde se tecleó.
CREATE TABLE IF NOT EXISTS accesos_dispositivos (
  id           INTEGER PRIMARY KEY,
  dispositivo  TEXT    NOT NULL UNIQUE,
  fallos       INTEGER NOT NULL DEFAULT 0,
  ultimo_en    TEXT,
  bloqueado_en TEXT,
  motivo       TEXT
);

-- Quién entró, quién falló, qué se bloqueó y quién lo liberó. Es el registro
-- que una auditoría pide cuando pregunta quién tocó el sistema y cuándo, así
-- que se guarda aunque nadie lo mire: después no se puede reconstruir.
CREATE TABLE IF NOT EXISTS accesos_bitacora (
  id          INTEGER PRIMARY KEY,
  en          TEXT    NOT NULL,
  accion      TEXT    NOT NULL,
  dispositivo TEXT,
  usuario_id  INTEGER REFERENCES usuarios(id),
  por_id      INTEGER REFERENCES usuarios(id),
  nota        TEXT
);

CREATE INDEX IF NOT EXISTS idx_accesos_bitacora_en ON accesos_bitacora (en);

-- LA RUTA DE ENTREGA.
--
-- Una salida no lleva una sola cosa a un solo lugar: la unidad va primero al
-- CEDIS, luego deja dos pedidos a clientes y de regreso pasa a paquetería. Eso
-- es una ruta, y es lo que faltaba: la plataforma sabía qué se arma y qué sale,
-- pero no en qué orden se va a entregar ni qué día.
--
-- Se planea antes —el día anterior, o en el momento— y se le va asignando lo
-- que ya está listo. Cuando sale la unidad, la ruta se amarra a su formato de
-- salida y cada parada se va marcando conforme se entrega.
CREATE TABLE IF NOT EXISTS rutas_entrega (
  id          INTEGER PRIMARY KEY,
  folio       TEXT    NOT NULL UNIQUE,
  fecha       TEXT    NOT NULL,
  -- planeada | en_ruta | cerrada | cancelada
  estado      TEXT    NOT NULL DEFAULT 'planeada',
  activo_id   INTEGER REFERENCES activos(id),
  llenado_id  INTEGER REFERENCES llenados(id),
  notas       TEXT,
  usuario_id  INTEGER REFERENCES usuarios(id),
  creado_en   TEXT    NOT NULL,
  cerrado_en  TEXT
);

-- Cada parada de la ruta, en el orden en que se va a hacer. Una parada puede
-- ser una cita de la ODT (al CEDIS), una orden de venta directa (al cliente o a
-- paquetería) o algo escrito a mano; por eso apunta a un documento cuando lo
-- hay y guarda su etiqueta para leerse sola.
CREATE TABLE IF NOT EXISTS ruta_paradas (
  id         INTEGER PRIMARY KEY,
  ruta_id    INTEGER NOT NULL REFERENCES rutas_entrega(id) ON DELETE CASCADE,
  orden      INTEGER NOT NULL DEFAULT 0,
  -- cedis | cliente | paqueteria | otro
  tipo       TEXT    NOT NULL,
  vxf_id     INTEGER REFERENCES vxf_ordenes(id),
  cita_id    INTEGER REFERENCES almacen_odt_citas(id),
  etiqueta   TEXT    NOT NULL,
  detalle    TEXT,
  -- pendiente | entregada | no_entregada
  estado     TEXT    NOT NULL DEFAULT 'pendiente',
  nota       TEXT,
  marcada_por INTEGER REFERENCES usuarios(id),
  marcada_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_ruta_paradas ON ruta_paradas (ruta_id, orden);

-- Los celulares de la empresa que se asignan a quien sale con una unidad. Van
-- en su propia tabla y no en la lista de catálogos porque un teléfono no es un
-- nombre: es un equipo con su número y su IMEI, y eso es lo que se reclama si
-- no regresa.
CREATE TABLE IF NOT EXISTS telefonos_corporativos (
  id      INTEGER PRIMARY KEY,
  equipo  TEXT    NOT NULL,
  numero  TEXT,
  imei    TEXT,
  notas   TEXT,
  orden   INTEGER NOT NULL DEFAULT 0,
  activo  INTEGER NOT NULL DEFAULT 1
);

-- La ficha de cada persona en la Bahía digital. No son papeles: son los datos
-- que alguien necesita leer en treinta segundos si pasa algo —tipo de sangre,
-- a quién hablarle, a qué clínica le toca ir—. Van en campos y no dentro de un
-- PDF porque en una urgencia nadie va a abrir un archivo a buscarlos.
CREATE TABLE IF NOT EXISTS bahia_fichas (
  usuario_id           INTEGER PRIMARY KEY REFERENCES usuarios(id),
  tipo_sangre          TEXT,
  alergias             TEXT,
  nss                  TEXT,
  clinica              TEXT,
  contacto1_nombre     TEXT,
  contacto1_parentesco TEXT,
  contacto1_telefono   TEXT,
  contacto2_nombre     TEXT,
  contacto2_parentesco TEXT,
  contacto2_telefono   TEXT,
  notas                TEXT,
  actualizado_por      INTEGER REFERENCES usuarios(id),
  actualizado_en       TEXT
);
`);

// Dónde se cargó. La gasolinera dice la marca; la ubicación, cuál de todas:
// «Pemex» hay en cada esquina, y rastrear un consumo raro necesita saber en
// cuál se cargó.
agregarColumna('logistica_cargas', 'ubicacion', 'TEXT');

// Cuándo sale del almacén una orden de venta directa. Se arma hoy y puede irse
// mañana o en tres días; con la fecha puesta, la orden aparece sola entre lo
// que se puede subir a la ruta de ese día.
agregarColumna('vxf_ordenes', 'fecha_salida', 'TEXT');

// A DÓNDE SE ENTREGA.
//
// Una ruta sin direcciones es una lista de nombres: dice el orden, no cómo
// llegar. La dirección se escribe UNA vez —en el cliente, en el CEDIS— y cada
// parada que los nombre la trae sola, incluso las que ya estaban en una ruta.
// La de la parada es para esa vez: «hoy entrega en la otra sucursal».
agregarColumna('vxf_clientes', 'direccion', 'TEXT');
agregarColumna('transito_cedis', 'direccion', 'TEXT');
agregarColumna('ruta_paradas', 'direccion', 'TEXT');

// La ficha completa de un teléfono corporativo. Nació con el equipo, el número
// y el IMEI; falta lo que hace falta para reclamarlo y para pagarlo: de qué
// cuenta cuelga la línea, con qué compañía, y cómo es el aparato.
agregarColumna('telefonos_corporativos', 'marca', 'TEXT');
agregarColumna('telefonos_corporativos', 'modelo', 'TEXT');
agregarColumna('telefonos_corporativos', 'telefonia', 'TEXT');
agregarColumna('telefonos_corporativos', 'cuenta_padre', 'TEXT');
agregarColumna('telefonos_corporativos', 'imagen', 'TEXT');

// CÓMO SE LE DICE A CADA TELÉFONO.
//
// «Samsung A15» no distingue nada cuando hay cuatro iguales. En el almacén cada
// equipo tiene su nombre —«Reparto 1», «El de Hector»— y por ese nombre se pide
// y se entrega. El alias es ese nombre, y es lo que se lee al escoger teléfono
// al salir con una unidad.
agregarColumna('telefonos_corporativos', 'alias', 'TEXT');

// Y lo que no cabe en los campos que hay. Cada teléfono puede llevar los datos
// extra que haga falta —número de inventario, plan contratado, con qué funda
// salió, cuándo se renueva— sin que haya que agregarle una columna a la tabla
// cada vez. Se guardan como [{clave, valor}], en el orden en que se escriben.
agregarColumna('telefonos_corporativos', 'extras', 'TEXT');

// Lo que se había capturado como «equipo» era la marca y el modelo juntos: se
// pasa a marca para no perderlo, y de ahí se separa a mano si hace falta.
migracionUnaVez('telefonos-marca-y-modelo', () => true, () => {
  db.exec(`
    UPDATE telefonos_corporativos
       SET marca = equipo
     WHERE (marca IS NULL OR marca = '') AND equipo IS NOT NULL
  `);
});

for (const [tipo, valores] of Object.entries({
  estacion: ['Pemex', 'BP', 'Mobil', 'Oxxo Gas', 'Shell'],
  forma_pago: ['Efectivo', 'Tarjeta de la empresa', 'Vale de gasolina'],
  tipo_servicio: ['Servicio preventivo', 'Reparación', 'Llantas', 'Afinación', 'Verificación', 'Otro'],
  documento_unidad: ['Tarjeta de circulación', 'Póliza de seguro', 'Verificación vehicular',
    'Afiliación ACME', 'Afiliación ANTRA', 'Fumigación', 'Contrato de arrendamiento',
    'Factura de la unidad', 'Otro'],
  // Los papeles del personal, para la Bahía digital. Es una lista que el
  // Administrador edita en Configuración, igual que la de las unidades: cada
  // empresa pide los suyos.
  documento_persona: ['INE', 'CURP', 'RFC', 'Comprobante de domicilio',
    'Acta de nacimiento', 'Licencia de conducir', 'Alta en el IMSS',
    'Contrato de trabajo', 'Examen médico', 'Curso o certificación',
    'Carta de no antecedentes', 'Comprobante de estudios', 'Otro'],
})) {
  valores.forEach((valor, i) => {
    db.prepare(`
      INSERT INTO logistica_catalogos (tipo, valor, orden) VALUES (?, ?, ?)
      ON CONFLICT (tipo, valor) DO NOTHING
    `).run(tipo, valor, i);
  });
}

// Liberar una clave bloqueada no puede depender de que esté el Administrador:
// si la única persona que puede hacerlo no contesta, el almacén se queda sin
// quien capture. Ronaldo pidió que también pudiera Hector (Chief of Warehouse),
// y va a la persona y no al puesto: el puesto es una plantilla de lo que hace
// un COW, y esto es un encargo de confianza para alguien en concreto.
migracionUnaVez('claves-liberar-a-hector',
  () => !!db.prepare("SELECT 1 FROM usuarios WHERE rol = 'chief_of_warehouse_cow'").get(),
  () => {
    for (const u of db.prepare("SELECT id, permisos_extra FROM usuarios WHERE rol = 'chief_of_warehouse_cow'").all()) {
      let extra;
      try { extra = JSON.parse(u.permisos_extra || '{}'); } catch { extra = {}; }
      if (Array.isArray(extra)) extra = Object.fromEntries(extra.map((k) => [k, true]));
      extra.claves_liberar = true;
      db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?').run(JSON.stringify(extra), u.id);
    }
  });

// FORMATO DE ASIGNACIÓN E INSPECCIÓN VEHICULAR.
//
// El «Checklist Tránsito» se llamaba así porque nació para los envíos a CEDIS,
// pero el formato que Ronaldo trabajó (23-oct-2026) es más ancho: se llena
// ANTES de que salga cualquier unidad de carga, diga a qué va. Lo que cambia
// entre un envío a CEDIS, uno de ventas directas, una custodia o un encargo es
// solo eso —para qué sale—; la inspección de la unidad es la misma.
//
// No se rehízo nada: el motor de Tránsito ya trabajaba por etapas (salida y
// regreso), ya cambiaba sus áreas según un dato de la cabecera, ya pedía
// documentos antes y después, ya recogía firmas y ya pasaba por autorización de
// salida y aprobación de cierre. Esto le agrega la unidad, el teléfono que se
// lleva, los doce puntos de inspección y el registro de salida y regreso.
//
// La colecta se queda como quinto tipo: ahí no sale ninguna unidad nuestra
// —viene un transportista por la carga— así que no se le pide inspección.
migracionUnaVez('formato-asignacion-inspeccion-vehicular',
  () => !!db.prepare("SELECT 1 FROM plantillas WHERE clave = 'transito'").get(),
  () => {
    const plantilla = db.prepare("SELECT * FROM plantillas WHERE clave = 'transito'").get();
    const SALIDAS = ['cedis', 'ventas_directas', 'custodia', 'encargo'];

    db.prepare(`
      UPDATE plantillas SET nombre = ?, descripcion = ?, foto_obligatoria = 1, campos = ?
       WHERE id = ?
    `).run(
      'Formato de Asignación e Inspección Vehicular',
      'Se llena antes de que salga la unidad y se cierra cuando regresa',
      JSON.stringify([
        {
          clave: 'tipo',
          etiqueta: '¿Para qué sale la unidad?',
          requerido: 1,
          opciones: [
            { valor: 'cedis', etiqueta: 'Envío a CEDIS' },
            { valor: 'ventas_directas', etiqueta: 'Envío de ventas directas' },
            { valor: 'custodia', etiqueta: 'Custodia' },
            { valor: 'encargo', etiqueta: 'Encargo' },
            { valor: 'colecta', etiqueta: 'Colecta (viene un transportista por la carga)' },
          ],
          // Un área puede aplicar a un solo tipo o a todos los que sacan una
          // unidad. Sin esto, la inspección habría que repetirla cuatro veces.
          grupos: [{ valor: '*salidas', etiqueta: 'Todas las salidas de unidad', en: SALIDAS }],
        },
        {
          clave: 'unidad',
          etiqueta: 'Unidad',
          requerido: 1,
          catalogo: 'unidades',
          segun: 'tipo',
          solo: SALIDAS,
          ayuda: 'La que sale. El kilometraje que se capture queda en su ficha de Logística.',
        },
        {
          clave: 'operador',
          etiqueta: 'Operador',
          requerido: 1,
          segun: 'tipo',
          solo: SALIDAS,
          ayuda: 'Quien maneja la unidad. Es quien firma al salir.',
        },
        {
          clave: 'telefono',
          etiqueta: 'Teléfono corporativo',
          catalogo: 'telefonos',
          segun: 'tipo',
          solo: SALIDAS,
          ayuda: 'El equipo que se lleva. La lista se edita en Configuración → Unidades.',
        },
        {
          clave: 'numero_envio',
          etiqueta: 'Número de envío',
          requerido: 1,
          referencia: 1,
          segun: 'tipo',
          etiquetas: {
            cedis: 'Número de envío',
            ventas_directas: 'Número de orden o salida',
            custodia: 'Número de custodia',
            encargo: 'Número de encargo',
            colecta: 'Número de colecta',
          },
          ayuda: 'Identifica este formato. No se repite el mismo número el mismo día.',
        },
        {
          clave: 'lugar_entrega',
          etiqueta: 'CEDIS',
          requerido: 1,
          segun: 'tipo',
          solo: ['cedis'],
          catalogo: 'cedis',
          ayuda: 'La lista la mantiene el Administrador en Configuración → Tránsito.',
        },
        {
          clave: 'destino',
          etiqueta: 'Destino programado',
          segun: 'tipo',
          solo: ['ventas_directas', 'custodia', 'encargo'],
          ayuda: 'Ciudad o ruta.',
        },
      ]),
      plantilla.id,
    );

    // Lo que ya está capturado como «envío» es un envío a CEDIS.
    db.prepare(`
      UPDATE secciones SET condicion = ?
       WHERE plantilla_id = ? AND condicion = ?
    `).run('{"campo":"tipo","valor":"cedis"}', plantilla.id, '{"campo":"tipo","valor":"envio"}');
    for (const l of db.prepare('SELECT id, datos FROM llenados WHERE plantilla_id = ?').all(plantilla.id)) {
      let datos;
      try { datos = JSON.parse(l.datos || '{}'); } catch { continue; }
      if (datos.tipo !== 'envio') continue;
      datos.tipo = 'cedis';
      db.prepare('UPDATE llenados SET datos = ? WHERE id = ?').run(JSON.stringify(datos), l.id);
    }

    // Las áreas nuevas van primero: lo de la unidad se revisa antes que lo del
    // encargo. Las que ya existían se recorren.
    db.prepare('UPDATE secciones SET orden = orden + 20 WHERE plantilla_id = ?').run(plantilla.id);

    const condicionSalidas = JSON.stringify({ campo: 'tipo', en: SALIDAS });
    const crearSeccion = db.prepare(`
      INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const crearItem = db.prepare(`
      INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, meta, activo)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const area = (orden, titulo, etapa, items) => {
      const id = Number(crearSeccion.run(plantilla.id, orden, titulo, etapa, condicionSalidas).lastInsertRowid);
      items.forEach(([texto, tipo, meta], i) => crearItem.run(id, i, texto, tipo, JSON.stringify(meta || {})));
    };

    area(0, 'Inspección de la unidad', 'salida', [
      ['Carrocería y pintura', 'ok_problema'],
      ['Cristales y espejos', 'ok_problema'],
      ['Luces (altas y bajas)', 'ok_problema'],
      ['Llantas y refacción', 'ok_problema'],
      ['Herramientas de la unidad, gato, birlo y llaves de llantas', 'ok_problema'],
      ['Revisión rápida: birlo cargado', 'ok_problema'],
      ['Niveles de líquidos y anticongelante', 'ok_problema'],
      ['Tarjeta de circulación a bordo', 'ok_problema'],
      ['Duplicado de llaves', 'ok_problema'],
      ['Pantalla del celular', 'ok_problema'],
      ['Cargador y cable', 'ok_problema'],
    ]);

    area(1, 'Registro de salida', 'salida', [
      ['Kilometraje al salir', 'medidor', { unidad: 'km' }],
      ['Hora de salida', 'hora'],
      ['Nivel de combustible al salir', 'nivel'],
      ['Fondo de caja chica', 'dinero'],
      ['Evidencia fotográfica de puntos críticos', 'documento', {
        momento: 'antes',
        ayuda: 'Herramientas y gato, niveles de líquidos y birlo cargado. Al menos tres fotos.',
      }],
      ['Observaciones o daños al salir', 'texto'],
    ]);

    area(2, 'Cierre al regresar', 'regreso', [
      ['Kilometraje al regresar', 'medidor', { unidad: 'km' }],
      ['Hora de regreso', 'hora'],
      ['Nivel de combustible al regresar', 'nivel'],
      ['Evidencia fotográfica al regresar', 'documento', {
        momento: 'despues',
        ayuda: 'Cómo regresó la unidad: carrocería, interior y lo que se haya reportado.',
      }],
      ['Nuevos percances o daños', 'texto'],
    ]);
  });

// Un traspaso entre bodegas también saca una unidad a la calle, así que también
// se inspecciona. Lo que tiene de propio es de dónde se trae el material: se
// escoge la bodega, y con eso el formato enseña las solicitudes de traspaso que
// están esperando ahí.
migracionUnaVez('salida-traspaso-entre-bodegas',
  () => !!db.prepare("SELECT 1 FROM plantillas WHERE clave = 'transito'").get(),
  () => {
    const plantilla = db.prepare("SELECT * FROM plantillas WHERE clave = 'transito'").get();
    let campos;
    try { campos = JSON.parse(plantilla.campos || '[]'); } catch { return; }

    const tipo = campos.find((c) => c.clave === 'tipo');
    if (!tipo || tipo.opciones.some((o) => o.valor === 'traspaso')) return;

    // Va antes de la colecta: las cuatro primeras y esta sacan una unidad; la
    // colecta es la única donde no sale ninguna.
    const colecta = tipo.opciones.findIndex((o) => o.valor === 'colecta');
    tipo.opciones.splice(colecta < 0 ? tipo.opciones.length : colecta, 0,
      { valor: 'traspaso', etiqueta: 'Traspaso de material entre bodegas' });

    const SALIDAS = ['cedis', 'ventas_directas', 'custodia', 'encargo', 'traspaso'];
    tipo.grupos = [{ valor: '*salidas', etiqueta: 'Todas las salidas de unidad', en: SALIDAS }];

    for (const c of campos) {
      if (Array.isArray(c.solo) && c.solo.includes('encargo') && !c.solo.includes('traspaso')) {
        c.solo = [...c.solo, 'traspaso'];
      }
      if (c.clave === 'numero_envio') c.etiquetas = { ...c.etiquetas, traspaso: 'Número de traspaso' };
    }

    // El destino no se pregunta: lo dice el traspaso, que ya trae su bodega.
    const destino = campos.find((c) => c.clave === 'destino');
    if (destino) destino.solo = destino.solo.filter((x) => x !== 'traspaso');

    campos.push({
      clave: 'bodega_origen',
      etiqueta: 'Bodega de la que se trae el material',
      requerido: 1,
      catalogo: 'bodegas',
      segun: 'tipo',
      solo: ['traspaso'],
      ayuda: 'El formato enseña las solicitudes de traspaso que esperan ahí.',
    });

    db.prepare('UPDATE plantillas SET campos = ? WHERE id = ?')
      .run(JSON.stringify(campos), plantilla.id);

    // Las áreas que aplican «a todas las salidas» tienen que incluir la nueva.
    for (const s of db.prepare('SELECT id, condicion FROM secciones WHERE plantilla_id = ?').all(plantilla.id)) {
      if (!s.condicion) continue;
      let c;
      try { c = JSON.parse(s.condicion); } catch { continue; }
      if (!Array.isArray(c.en) || c.en.includes('traspaso')) continue;
      c.en = [...c.en, 'traspaso'];
      db.prepare('UPDATE secciones SET condicion = ? WHERE id = ?').run(JSON.stringify(c), s.id);
    }
  });

// UNA SALIDA, VARIAS COSAS.
//
// La unidad sale una vez y hace tres: deja el envío en el CEDIS, entrega dos
// pedidos de ventas directas y de regreso trae material de la otra bodega. Era
// un formato por cada cosa —la misma unidad inspeccionada tres veces, tres
// autorizaciones, tres kilometrajes— o era un solo formato que mentía sobre lo
// que la unidad iba a hacer. Ahora el formato dice todo lo que va a hacer: un
// propósito principal y los demás. Cada uno trae consigo sus preguntas y sus
// datos. Lo pidió Ronaldo el 26-oct-2026.
migracionUnaVez('salida-con-varios-propositos',
  () => !!db.prepare("SELECT 1 FROM plantillas WHERE clave = 'transito'").get(),
  () => {
    const plantilla = db.prepare("SELECT * FROM plantillas WHERE clave = 'transito'").get();
    let campos;
    try { campos = JSON.parse(plantilla.campos || '[]'); } catch { return; }
    if (campos.some((c) => c.clave === 'tipos_extra')) return;

    const tipo = campos.find((c) => c.clave === 'tipo');
    if (!tipo) return;
    const SALIDAS = ['cedis', 'ventas_directas', 'custodia', 'encargo', 'traspaso'];

    // Va justo después del propósito principal: se escoge uno y enseguida se
    // dice qué más. Una colecta no lleva nada más —no sale ninguna unidad
    // nuestra—, por eso depende de 'tipo' y solo aplica a las salidas.
    campos.splice(campos.indexOf(tipo) + 1, 0, {
      clave: 'tipos_extra',
      etiqueta: '¿Algo más en la misma salida?',
      multi: 1,
      segun: 'tipo',
      solo: SALIDAS,
      opciones: tipo.opciones.filter((o) => SALIDAS.includes(o.valor)),
      ayuda: 'Marca todo lo que va a hacer la unidad en este viaje. Cada cosa agrega sus preguntas y sus datos al mismo formato.',
    });

    db.prepare('UPDATE plantillas SET campos = ? WHERE id = ?')
      .run(JSON.stringify(campos), plantilla.id);
  });

// El envío de la ODT y su CEDIS también se escogen en una custodia: la unidad
// va acompañando ese mismo envío, así que tiene que decir cuál es y a qué
// almacén va. Lo pidió Ronaldo el 26-oct-2026.
migracionUnaVez('custodia-escoge-envio-de-la-odt',
  () => !!db.prepare("SELECT 1 FROM plantillas WHERE clave = 'transito'").get(),
  () => {
    const plantilla = db.prepare("SELECT * FROM plantillas WHERE clave = 'transito'").get();
    let campos;
    try { campos = JSON.parse(plantilla.campos || '[]'); } catch { return; }

    const lugar = campos.find((c) => c.clave === 'lugar_entrega');
    if (!lugar || (lugar.solo || []).includes('custodia')) return;
    lugar.solo = [...(lugar.solo || []), 'custodia'];
    lugar.etiqueta = 'CEDIS o almacén destino';
    lugar.ayuda = 'El de la cita de la ODT. Al escoger el número de envío se llena solo.';

    const numero = campos.find((c) => c.clave === 'numero_envio');
    if (numero) {
      numero.etiquetas = { ...numero.etiquetas, custodia: 'Número de envío de la ODT' };
      numero.ayuda = 'Si es un envío de la ODT, escógelo de la lista: queda ligado a lo que armó Producción y llena su CEDIS.';
    }

    // El destino escrito a mano deja de pedirse en custodia: lo dice la cita.
    const destino = campos.find((c) => c.clave === 'destino');
    if (destino) destino.solo = (destino.solo || []).filter((x) => x !== 'custodia');

    db.prepare('UPDATE plantillas SET campos = ? WHERE id = ?')
      .run(JSON.stringify(campos), plantilla.id);
  });

// La inspección de la unidad dejó repetidas cuatro preguntas del chequeo de
// citas: la gasolina, el dinero y las dos del teléfono ya se revisan arriba,
// con su foto y su nivel. Se retiran —no se borran— para que un envío a CEDIS
// no pregunte dos veces lo mismo.
migracionUnaVez('chequeo-citas-sin-repetidas',
  () => !!db.prepare("SELECT 1 FROM plantillas WHERE clave = 'transito'").get(),
  () => {
    const repetidas = [
      'Revisar funcionamiento teléfonos tránsito',
      'Realizar carga teléfonos tránsito',
      'Revisar que la unidad cuente con gasolina',
      'Revisar que la unidad cuente con dinero',
    ];
    const seccion = db.prepare(`
      SELECT s.id FROM secciones s JOIN plantillas p ON p.id = s.plantilla_id
       WHERE p.clave = 'transito' AND s.titulo = 'Chequeo citas'
    `).get();
    if (!seccion) return;
    for (const texto of repetidas) {
      db.prepare('UPDATE items SET activo = 0 WHERE seccion_id = ? AND texto = ?').run(seccion.id, texto);
    }
    db.prepare("UPDATE secciones SET titulo = 'Lo del envío a CEDIS' WHERE id = ?").run(seccion.id);
  });

// Autorizar la salida de una unidad deja de venir con el puesto: lo pidió
// Ronaldo el 26-oct-2026 —«solo personas asignadas podrán autorizar»—. Para que
// nadie se quede sin poder hacer su trabajo de un día para otro, quien lo tenía
// por su puesto lo conserva A SU NOMBRE; de ahí el Administrador lo reparte o
// lo quita persona por persona en Configuración → Permisos.
migracionUnaVez('autorizar-salida-por-persona', () => true, () => {
  const puestos = db.prepare('SELECT clave, permisos FROM puestos').all()
    .map((p) => { try { return { ...p, j: JSON.parse(p.permisos || '{}') }; } catch { return null; } })
    .filter((p) => p && p.j.transito_autorizar && p.clave !== 'admin');
  if (!puestos.length) return;

  for (const u of db.prepare('SELECT id, rol, permisos_extra FROM usuarios WHERE activo = 1').all()) {
    if (!puestos.some((p) => p.clave === u.rol)) continue;
    let extra;
    try { extra = JSON.parse(u.permisos_extra || '{}'); } catch { extra = {}; }
    if (Array.isArray(extra)) extra = Object.fromEntries(extra.map((k) => [k, true]));
    if (extra.transito_autorizar === undefined) extra.transito_autorizar = true;
    db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?').run(JSON.stringify(extra), u.id);
  }
  // Se marca en «no» explícito y no se borra: borrarlo lo devolvería al puesto
  // la próxima vez que arranque, porque autorizar la salida se deriva de firmar
  // la supervisión. Un «no» escrito gana sobre la herencia.
  for (const p of puestos) {
    p.j.transito_autorizar = false;
    db.prepare('UPDATE puestos SET permisos = ? WHERE clave = ?').run(JSON.stringify(p.j), p.clave);
  }
});

// El checklist de unidad nació con la afiliación a ANTRA, la tarjeta, la póliza
// y la fumigación. Faltaban la verificación, la afiliación a ACME y el
// kilometraje —que es, además, de donde sale el rendimiento de la unidad—. Van
// como migración y no en la carga inicial porque el checklist ya existe y el
// Administrador ya edita sus preguntas.
migracionUnaVez('unidad-verificacion-acme-kilometraje',
  () => !!db.prepare("SELECT 1 FROM plantillas WHERE clave = 'unidad'").get(),
  () => {
    const plantilla = db.prepare("SELECT id FROM plantillas WHERE clave = 'unidad'").get();
    const seccion = db.prepare(`
      SELECT id FROM secciones WHERE plantilla_id = ? AND titulo LIKE '%Documentación%'
       ORDER BY orden DESC LIMIT 1
    `).get(plantilla.id)
      || db.prepare('SELECT id FROM secciones WHERE plantilla_id = ? ORDER BY orden DESC LIMIT 1').get(plantilla.id);
    let orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM items WHERE seccion_id = ?')
      .get(seccion.id).n;
    const alta = db.prepare(`
      INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, meta) VALUES (?, ?, ?, ?, ?)
    `);
    const nuevos = [
      ['Verificación vehicular', 'fecha', {
        vigencia: true, obligatoria: true, etiqueta: 'Vence la verificación',
        ayuda: 'Captura la fecha en que vence. La plataforma calcula los días que le quedan o los que lleva vencida.',
      }],
      ['¿Unidad afiliada a ACME?', 'fecha', {
        vigencia: true, etiqueta: 'Vigencia de ACME',
        ayuda: 'Captura la fecha en que vence la afiliación. Si no está afiliada, déjalo vacío.',
      }],
      ['Kilometraje al momento de la revisión', 'medidor', {
        unidad: 'km', obligatoria: true,
        ayuda: 'Anota los kilómetros del tablero y toma la foto del odómetro.',
      }],
    ];
    for (const [texto, tipo, meta] of nuevos) {
      if (db.prepare('SELECT 1 FROM items WHERE seccion_id = ? AND texto = ?').get(seccion.id, texto)) continue;
      alta.run(seccion.id, orden, texto, tipo, JSON.stringify(meta));
      orden += 1;
    }
  });

// VENTAS DIRECTAS. Se llamaban «Entregas x Fuera» / «ventas por fuera»: eran las
// ventas que salen por fuera de la ODT. El nombre describía de dónde NO salían
// en vez de lo que son, así que el 2-oct-2026 Ronaldo las nombró por lo que son:
// una venta directa a un cliente. Por dentro las tablas siguen siendo `vxf_*`
// —renombrarlas no cambiaría nada para quien usa la plataforma y sí rompería lo
// capturado—; lo que cambia es cómo se llaman en pantalla y sus folios.
migracionUnaVez('vxf-folios-a-venta-directa', () => true, () => {
  for (const o of db.prepare("SELECT id, folio FROM vxf_ordenes WHERE folio LIKE 'VXF-%'").all()) {
    db.prepare('UPDATE vxf_ordenes SET folio = ? WHERE id = ?').run(o.folio.replace(/^VXF-/, 'VD-'), o.id);
  }
  db.prepare("UPDATE puestos SET etiqueta = 'Ventas directas' WHERE clave = 'ventas_fuera' AND etiqueta = 'Ventas por fuera'").run();
  db.prepare("UPDATE usuarios SET nombre = 'Ventas directas' WHERE nombre = 'Ventas por fuera'").run();
});

// EL COBRO DE UNA VENTA DIRECTA. Hay ventas que salen ya pagadas y otras que se
// cobran al entregar. Las segundas no terminan cuando sale el paquete: terminan
// cuando el dinero regresa, y por eso tienen dos pasos más —quien entrega anota
// lo que recibió con su evidencia, y un Team Leader confirma que llegó completo—.
agregarColumna('vxf_ordenes', 'cobro', "TEXT NOT NULL DEFAULT 'pagada'");
agregarColumna('vxf_ordenes', 'monto_cobrar', 'REAL');
agregarColumna('vxf_ordenes', 'cobro_recibido', 'REAL');
agregarColumna('vxf_ordenes', 'cobro_forma', 'TEXT');
agregarColumna('vxf_ordenes', 'cobro_nota', 'TEXT');
agregarColumna('vxf_ordenes', 'cobro_entregado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('vxf_ordenes', 'cobro_entregado_en', 'TEXT');
agregarColumna('vxf_ordenes', 'cobro_confirmado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('vxf_ordenes', 'cobro_confirmado_en', 'TEXT');

// LO QUE REGRESA DE UNA VENTA DIRECTA. Antes una devolución la capturaba Almacén
// y al aprobarla entraba al inventario. Para lo que regresa de un cliente eso no
// basta —nadie había visto en qué estado volvió—, así que desde el 2-oct-2026
// pasa primero por Calidad: Calidad la levanta diciendo por qué la regresan y
// revisa pieza por pieza cuánto llegó bien; después Almacén pide la entrada y
// otra persona la aprueba. Solo entonces se mueve el inventario, y solo con lo
// que llegó bien.
agregarColumna('almacen_devoluciones', 'vxf_id', 'INTEGER REFERENCES vxf_ordenes(id)');
agregarColumna('almacen_devoluciones', 'origen', "TEXT NOT NULL DEFAULT 'almacen'");
agregarColumna('almacen_devoluciones', 'revisado_por', 'INTEGER REFERENCES usuarios(id)');
agregarColumna('almacen_devoluciones', 'revisado_en', 'TEXT');
agregarColumna('almacen_devolucion_renglones', 'cantidad_buena', 'INTEGER');
agregarColumna('almacen_devolucion_renglones', 'observacion', 'TEXT');

// Las fotos que quedaron apuntando a documentos que ya no existen. Venían de
// limpiezas viejas que borraban el archivo pero no el renglón; el siguiente
// documento que estrenaba ese número las heredaba. Se van de una vez, y el
// borrado corregido ya no deja más (ver borrarFotosDocumento en server.js).
db.exec(`
DELETE FROM almacen_fotos WHERE
  (documento_tipo IN ('entrada', 'retiro') AND documento_id NOT IN (SELECT id FROM almacen_entradas))
  OR (documento_tipo IN ('salida', 'salida_calidad') AND documento_id NOT IN (SELECT id FROM almacen_salidas))
  OR (documento_tipo = 'devolucion' AND documento_id NOT IN (SELECT id FROM almacen_devoluciones))
  OR (documento_tipo = 'conteo' AND documento_id NOT IN (SELECT id FROM almacen_conteos))
  OR (documento_tipo = 'reingreso' AND documento_id NOT IN (SELECT id FROM almacen_reingresos))
  OR (documento_tipo IN ('vxf', 'vxf_cobro') AND documento_id NOT IN (SELECT id FROM vxf_ordenes))
  OR (documento_tipo = 'conteo_renglon' AND documento_id NOT IN (SELECT id FROM almacen_conteo_renglones))
  OR (documento_tipo = 'salida_renglon' AND documento_id NOT IN (SELECT id FROM almacen_salida_renglones));
`);

// PUESTOS. Antes eran tres perfiles escritos en el código; ahora viven aquí para
// que el Administrador los cree y los ajuste conforme cambie el organigrama.
// `permisos` guarda {permiso: true|false} con TODOS los que existían cuando se
// guardó: así, si mañana un permiso se parte en dos, se sabe que el hijo es nuevo
// y hereda lo que el puesto tenía en el padre.
db.exec(`
CREATE TABLE IF NOT EXISTS puestos (
  clave        TEXT PRIMARY KEY,
  etiqueta     TEXT NOT NULL,
  descripcion  TEXT,
  permisos     TEXT NOT NULL DEFAULT '{}',
  orden        INTEGER NOT NULL DEFAULT 0,
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_por   INTEGER REFERENCES usuarios(id),
  creado_en    TEXT
);
`);

}

prepararBase();

// Una sentencia que se prepara en el momento de usarse, no al arrancar.
//
// `db.prepare(...)` guardado en una constante de arriba del archivo queda atado
// a la base REAL para siempre: se preparó cuando todavía no había contexto. Una
// sentencia así, usada dentro del modo de pruebas, escribe en la base de verdad
// —fue exactamente lo que pasó con los movimientos de inventario—. Con esto la
// sentencia pregunta por su base cada vez, igual que todo lo demás.
const sentencia = (sql) => ({
  run: (...valores) => db.prepare(sql).run(...valores),
  get: (...valores) => db.prepare(sql).get(...valores),
  all: (...valores) => db.prepare(sql).all(...valores),
});

module.exports = { db, dbReal: real, contexto, prepararBase, sentencia, DATA_DIR, FOTOS_DIR };
