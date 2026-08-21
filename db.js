'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { periodoASemana } = require('./fechas');

const DATA_DIR = path.join(__dirname, 'datos');
const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(FOTOS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'checklists.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

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

module.exports = { db, DATA_DIR, FOTOS_DIR };
