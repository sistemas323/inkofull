'use strict';

// Carga inicial: transcribe los checklists en papel a la base de datos.
// Es idempotente — vuelve a correrlo cuantas veces quieras; solo inserta lo que falta.
// Los tres checklists de vehículo (ISUZU / NP300 / PARTNER) eran 95% idénticos en
// papel, así que aquí son UNA plantilla; lo que cambiaba entre ellos (presión de
// llantas, grado de aceite, ítems exclusivos del ISUZU) se resuelve con los
// atributos del activo y el campo solo_activos de cada ítem.

const { db } = require('./db');

const OK = 'ok_problema';   // Satisfactorio / Con problema
const REV = 'revisado';     // Revisado sí / no
const NUM = 'conteo';       // Cantidad numérica
const DOC = 'documento';    // Exige adjuntar uno o más archivos

const PLANTILLAS = [
  {
    clave: 'unidad',
    nombre: 'Inspección de Unidad',
    descripcion: 'Revisión de camionetas de reparto — solo los viernes',
    tipo_captura: 'items',
    frecuencia: 'viernes',
    aplica_a: 'vehiculo',
    firma_operador: 1,
    firma_coordinador: 0,
    foto_obligatoria: 1,
    secciones: [
      {
        titulo: '1. Herramientas y equipo a bordo',
        items: [
          ['Llave de cruz o dados (para birlos de las llantas)', OK],
          ['Gato hidráulico o mecánico en buen estado', OK],
          ['Juego básico de herramientas (destornilladores, pinzas, llaves)', OK],
          ['Linterna de mano con baterías cargadas', OK],
          ['Refacciones básicas: fusibles, focos, cinta aislante, cinchos', OK],
          ['Extintor vigente (revisar presión)', OK],
          ['Botiquín de primeros auxilios', OK],
          ['Triángulos reflejantes y/o conos de seguridad', OK],
          ['Cables pasa corriente', OK],
          ['Llanta de refacción con presión adecuada', OK],
        ],
      },
      {
        titulo: '2. Revisión exterior',
        items: [
          ['Carrocería y chasis sin golpes o piezas flojas', OK],
          ['Llantas: presión correcta, desgaste uniforme, sin objetos incrustados', OK],
          ['Espejos y cristales limpios y sin grietas', OK],
          ['Luces delanteras, traseras, direccionales y de freno', OK],
          ['Claxon operativo', OK],
          ['Presión de llantas {psi} psi', OK],
          ['Llanta de refacción en buen estado', OK],
          ['Lavado y limpieza de la unidad', OK],
        ],
      },
      {
        titulo: '3. Revisión interior',
        items: [
          ['Tablero sin testigos encendidos', OK],
          ['Indicadores funcionando (combustible, temperatura, aceite)', OK],
          ['Cinturones de seguridad completos y sin daños', OK],
          ['Elevadores de ventanas operativos', OK],
          ['Radio/comunicación funcionando', OK],
          ['Frenos en buen estado', OK],
          ['Palanca de freno de mano activada', OK],
          ['Limpieza de la unidad', OK],
          ['Palancas freno de escape', OK, ['ISUZU']],
        ],
      },
      {
        titulo: '4. Revisión de motor y fluidos',
        items: [
          ['Nivel de combustible suficiente', OK],
          ['Aceite de motor {aceite} en nivel correcto y sin fugas', OK],
          ['Refrigerante adecuado en depósito y radiador', OK],
          ['Líquido de frenos en nivel', OK],
          ['Líquido de dirección hidráulica (si aplica)', OK],
          ['Líquido de limpiaparabrisas lleno', OK],
          ['Correas sin desgaste ni fisuras', OK],
          ['Batería limpia, sin sulfatación y bien sujeta', OK],
          ['Inspección visual de fugas debajo de la cabina y exterior; transmisión, ejes, etc.', OK],
          ['Bandas no flojas', OK],
          ['Drenador purgador de combustible', OK, ['ISUZU']],
          ['Depósito hydro booster', OK, ['ISUZU']],
        ],
      },
      {
        titulo: '5. Revisión de seguridad en la carga',
        items: [
          ['Anclajes y amarres firmes', OK],
          ['Lonas o redes sin roturas', OK],
          ['Peso de carga dentro del límite', OK],
          ['Puertas y cerraduras de caja/batea seguras', OK],
          ['Tuercas completas y bien apretadas', OK],
          ['Hojas de muelle sin fracturas', OK],
        ],
      },
      {
        titulo: '6. Documentación y extras',
        items: [
          ['Tarjeta de circulación vigente', OK],
          ['Póliza de seguro', OK],
          ['Dinero', OK],
          ['Fumigación de la unidad', OK],
        ],
      },
    ],
  },

  {
    clave: 'montacargas',
    nombre: 'Inspección de Montacargas',
    descripcion: 'Revisión de montacargas — solo los viernes',
    tipo_captura: 'items',
    frecuencia: 'viernes',
    aplica_a: 'montacargas',
    firma_operador: 1,
    firma_coordinador: 1,
    foto_obligatoria: 1,
    // En papel eran 27 ítems en una sola lista corrida. Agrupados en cuatro
    // bloques para que en tablet no sea un scroll infinito; los ítems son los mismos.
    secciones: [
      {
        titulo: '1. Chasis y estructura',
        items: [
          ['Llantas están infladas o sin desgaste o daño excesivo. Tuercas están bien apretadas.', OK],
          ['Horquillas y mástil no están doblados, gastados, o resquebrados. Límites de contención superiores están bien.', OK],
          ['Ampliación del respaldo de la carga está en su lugar y no está doblado, roto o suelto.', OK],
          ['Guarda de Protección Superior está en su lugar y no está doblada, rota o suelta.', OK],
          ['Accesorios (si está equipado) operan bien y no están dañados.', OK],
          ['Carrocería del Montacargas está sin golpes, grasa o aceite en exceso.', OK],
        ],
      },
      {
        titulo: '2. Motor y fluidos',
        items: [
          ['Aceite del motor está lleno y sin fugas.', OK],
          ['Aceite hidráulico está lleno y sin fugas.', OK],
          ['Radiador está lleno y sin fugas.', OK],
          ['Nivel del combustible está bien y sin fugas.', OK],
          ['Conexiones de la batería están apretadas.', OK],
          ['Transmisión: nivel de aceite, fugas, fuerza de avance', OK],
          ['Mangueras se encuentran bien apretadas y sin fugas', OK],
        ],
      },
      {
        titulo: '3. Seguridad y señalización',
        items: [
          ['Calcomanías de Advertencia y manuales del operador se ven y se leen con facilidad.', OK],
          ['Cinturón de seguridad o sujetadores están accesibles y sin daños, aceitosos o sucios.', OK],
          ['Motor funciona suave y silencioso, sin fugas o chispas del tubo de escape (mofle).', OK],
          ['Bocina (claxon) funciona.', OK],
          ['Señal de dirección (si está equipado) funciona con facilidad.', OK],
          ['Luces (delanteras, traseras, y de advertencia) funcionan y están apuntadas correctamente.', OK],
          ['Indicadores e instrumentación están funcionando (si está equipado).', OK],
          ['Alarma de retroceso (si está equipado) funciona.', OK],
        ],
      },
      {
        titulo: '4. Operación y controles',
        items: [
          ['Levantamiento y descenso funcionan sin dificultad y sin desvío excesivo.', OK],
          ['Inclinación funciona sin dificultad, desvío excesivo.', OK],
          ['Palancas de control no están flojas, desarmadas o rotas.', OK],
          ['Dirección es fácil y responde sin juego excesivo.', OK],
          ['Frenos trabajan y funcionan sin dificultad y sin restricción. Sin fugas de líquido.', OK],
          ['Freno de Mano detiene al montacargas en una inclinación.', OK],
        ],
      },
    ],
  },

  {
    clave: 'transito',
    nombre: 'Checklist Tránsito',
    descripcion: 'Entregas directas en CEDIS · un checklist por envío',
    tipo_captura: 'items',
    frecuencia: 'diario',
    aplica_a: null,
    firma_operador: 1,
    firma_coordinador: 0,
    // Se llena en dos momentos: se autoriza la salida y el proceso queda
    // abierto hasta que la unidad regresa y se carga la hoja de recepción.
    por_etapas: 1,
    // Quien llena el checklist no autoriza su propia salida ni cierra el
    // proceso: eso lo hace un Team Leader o el Administrador.
    requiere_supervision: 1,
    // Datos que se capturan ANTES de la inspección. El número de envío es
    // además la referencia que distingue un checklist de otro el mismo día.
    campos: [
      { clave: 'numero_envio', etiqueta: 'Número de envío', requerido: 1, referencia: 1,
        ayuda: 'Identifica este checklist. Puede haber varios envíos el mismo día.' },
      { clave: 'lugar_entrega', etiqueta: 'Lugar de entrega', requerido: 1,
        ayuda: 'CEDIS o destino de la entrega.' },
    ],
    secciones: [
      {
        titulo: 'Chequeo citas',
        items: [
          ['Revisar funcionamiento teléfonos tránsito', REV],
          ['Realizar carga teléfonos tránsito', REV],
          ['Revisar horario e indicarlo a equipo', REV],
          ['Impresión de citas a entregar (2 juegos)', REV],
          ['Guardar citas a entregar en las unidades', REV],
          ['Revisión de uniformes para entrega (chaleco, botas de seguridad, playera, pantalón)', REV],
          ['Revisar que la unidad cuente con gasolina', REV],
          ['Revisar que la unidad cuente con dinero', REV],
          ['Licencia vigente de miembros del equipo', REV],
          ['Documentación completa (fumigación, pagos IMSS, seguro, etc.)', REV],
        ],
      },
      {
        titulo: 'Ventas x fuera',
        // Tránsito es solo para entregas directas en CEDIS. Estos nueve ítems se
        // conservan transcritos y desactivados: son la base del módulo «Ventas
        // por fuera» cuando toque construirlo.
        activo: 0,
        items: [
          ['Revisar con TERMIKO si hay entrega de venta por fuera', REV],
          ['Pedir datos completos de entrega TERMIKO', REV],
          ['Revisar con INKO si hay entrega de venta por fuera', REV],
          ['Pedir datos completos de entrega INKO', REV],
          ['Elaboración de notas de remisión o venta como aplique', REV],
          ['Creación de ruta de entrega', REV],
          ['Revisión de uniformes para entrega (chaleco, botas de seguridad, playera, pantalón)', REV],
          ['Revisar que la unidad cuente con gasolina', REV],
          ['Licencia vigente de miembros del equipo', REV],
        ],
      },
      // Los documentos de la entrega ocurren en dos momentos distintos del día,
      // por eso van en secciones separadas: el operador ve de un vistazo qué le
      // toca antes de salir y qué al volver.
      {
        titulo: 'Antes de salir · Documentos',
        etapa: 'salida',
        items: [
          ['Hojas de autorización de ingreso', DOC, null,
            { momento: 'antes', ayuda: 'Una por cada punto de entrega. Sin ellas no se autoriza la salida.' }],
        ],
      },
      {
        titulo: 'Al regresar · Documentos',
        etapa: 'regreso',
        items: [
          ['Hojas de recepción de entrega', DOC, null,
            { momento: 'despues', ayuda: 'Una por cada entrega concluida, firmada por quien recibió.' }],
        ],
      },
    ],
  },

  {
    clave: 'cajas',
    nombre: 'Insumos y Cajas',
    descripcion: 'Conteo semanal de material de empaque',
    tipo_captura: 'matriz',
    frecuencia: 'semanal',
    aplica_a: null,
    firma_operador: 1,
    firma_coordinador: 0,
    secciones: [
      {
        titulo: 'Conteo de insumos',
        items: [
          ['RM27', NUM, null, { tipo: 'Caja' }],
          ['RM28', NUM, null, { tipo: 'Caja' }],
          ['RM30', NUM, null, { tipo: 'Caja' }],
          ['RM51', NUM, null, { tipo: 'Caja' }],
          ['RM68', NUM, null, { tipo: 'Caja' }],
          ['RM85', NUM, null, { tipo: 'Caja' }],
          ['RM88', NUM, null, { tipo: 'Caja' }],
          ['RM90', NUM, null, { tipo: 'Caja' }],
          ['RM202', NUM, null, { tipo: 'Caja' }],
          ['MASTER', NUM, null, { tipo: 'Caja' }],
          ['Proveedor 57x60', NUM, null, { tipo: 'Caja' }],
          ['Proveedor 80x70', NUM, null, { tipo: 'Caja' }],
          ['Proveedor 80x80', NUM, null, { tipo: 'Caja' }],
          ['Proveedor 57x40', NUM, null, { tipo: 'Caja' }],
          ['Cintas Transparentes', NUM, null, { tipo: 'Cinta' }],
          ['Cintas Canela', NUM, null, { tipo: 'Cinta' }],
          ['Cintas INKO', NUM, null, { tipo: 'Cinta' }],
          ['Cintas Termiko', NUM, null, { tipo: 'Cinta' }],
          ['Playo Grande', NUM, null, { tipo: 'Playo' }],
          ['Playo Chico', NUM, null, { tipo: 'Playo' }],
          ['Playo Negro', NUM, null, { tipo: 'Playo' }],
          ['SOBRE', NUM, null, { tipo: 'Sobres' }],
          ['Cutter', NUM, null, { tipo: 'Empaque' }],
          ['Despachadores', NUM, null, { tipo: 'Empaque' }],
          ['Repuestos Cutter', NUM, null, { tipo: 'Empaque' }],
          ['Poliolefina', NUM, null, { tipo: 'Empaque' }],
        ],
      },
    ],
  },

  {
    clave: 'avisos',
    nombre: 'Avisos Semanales',
    descripcion: 'Seguimiento semanal por área — se marca día por día',
    tipo_captura: 'grid_semanal',
    frecuencia: 'semanal',
    aplica_a: null,
    firma_operador: 0,
    firma_coordinador: 1,
    // Retirado de la operación a petición del equipo. Se conserva transcrito y
    // desactivado: no aparece en la tablet ni en los reportes, pero volver a
    // usarlo es cambiar este 0 por un 1 (o el comando que está en el LEEME).
    activo: 0,
    secciones: [
      {
        titulo: 'Calidad',
        items: [
          ['Entrega de hoja muestreo junto con pruebas', REV],
          ['Reporte de algún incidente en muestreo', REV],
        ],
      },
      {
        titulo: 'Tránsito',
        items: [
          ['Revisar reporte unidades con checklist', REV],
          ['Reporte de alguna observación en unidades', REV],
          ['Revisar reporte montacargas con checklist', REV],
          ['Reporte de alguna observación en montacargas', REV],
          ['Revisó horario semanal con coordinador logística', REV],
          ['Aviso equipo ventas Termiko para entregas locales siguiente semana', REV],
          ['Aviso operadores Box Lunch a comedor', REV],
          ['Envío e impresión horario siguiente semana', REV],
        ],
      },
      {
        titulo: 'Planeación Logística',
        items: [
          ['Asignación y aprobación de etiquetas ML (INKO)', REV],
          ['Asignación y aprobación de etiquetas ML (TERMIKO)', REV],
          ['Descarga de etiquetas ML (TERMIKO - INKO)', REV],
          ['Impresión Orden de trabajo (3 juegos)', REV],
        ],
      },
      {
        titulo: 'Insumos Bodega',
        items: [
          ['Revisión corte cajas con checklist', REV],
          ['Elaboración de pedidos de cajas', REV],
        ],
      },
      {
        titulo: 'Almacén',
        items: [
          ['Impresión de etiquetas ML (TERMIKO, INKO y AMZ)', REV],
          ['Revisar desglose de entradas de material', REV],
          ['Revisar desglose de salidas de material', REV],
          ['Revisar desglose de devoluciones de material', REV],
        ],
      },
    ],
  },
];

const ACTIVOS = [
  { clave: 'ISUZU',   nombre: 'ISUZU',   tipo: 'vehiculo',    atributos: { psi: '95', aceite: '(15W40)' } },
  { clave: 'NP300',   nombre: 'NP300',   tipo: 'vehiculo',    atributos: { psi: '__', aceite: '' } },
  { clave: 'PARTNER', nombre: 'PARTNER', tipo: 'vehiculo',    atributos: { psi: '30', aceite: '(15W40)' } },
  { clave: 'MC-01',   nombre: 'Montacargas 1', tipo: 'montacargas', atributos: { marca: '', modelo: '', cedis: '' } },
];

const USUARIOS = [
  { nombre: 'Administrador', rol: 'admin', pin: '1234' },
];

// --------------------------------------------------------------- calidad

// La hoja MATERIALES de MUESTREO_GUIADO.xlsx, transcrita renglón por renglón.
// Orden de las columnas: modelo, color de impresión, marca de término, tipo de
// centro, GAP, etiquetas por rollo, colores disponibles, diámetro de
// referencia, centro de referencia. Vacío = el Excel tampoco lo traía.
const MATERIALES = [
  ['80X70', 'NEGRO', 'SI', 'PANAL', 'N/A', '55 m', 'Blanco, verde, azul, rosa, naranja, amarillo, morado', '', '1" ext / 1/2" int'],
  ['80X80', 'NEGRO', 'SI', 'PANAL', 'N/A', '70 m', 'Blanco', '', '1" ext / 1/2" int'],
  ['80X50', 'NEGRO', 'SI', 'PANAL', 'N/A', '20 m', 'Blanco', '50 mm', '1" ext / 1/2" int'],
  ['57X30 ROLLO', 'NEGRO', 'SI', 'POPOTE', 'N/A', '12 m', 'Blanco, rosa, azul, amarillo', '', '1/2"'],
  ['57X40 ROLLO', 'NEGRO', 'SI', 'POPOTE', 'N/A', '20 m', 'Blanco, morado, verde, rosa, amarillo, azul, naranja', '', '1/2"'],
  ['57X45', 'NEGRO', 'SI', 'POPOTE', 'N/A', '27 m', 'Blanco', '', '1/2"'],
  ['57X60', 'NEGRO', 'SI', 'PANAL', 'N/A', '40 m', 'Blanco', '', '1" ext / 1/2" int'],
  ['51X25', 'NEGRO', 'NA', 'CARTON', '3', '1000', 'Blanco, verde, amarillo, naranja, plateado', '78-80 mm', '1"'],
  ['57X30 CONTINUA', 'NEGRO', 'NA', 'POPOTE', 'N/A', '6 m', 'Blanco, azul', '30 mm', '1/2"'],
  ['57X40 BASCULA', 'NEGRO', 'NA', 'CARTON', '3', '1000', 'Blanco', '95-100 mm', '1.5"'],
  ['63X22 JOYERIA', 'NEGRO', 'NA', 'CARTON', '3', '1000', 'Blanco', '85-95 mm', '1"'],
  ['22X16', 'NEGRO', 'NA', 'CARTON', '3', '2000', 'Blanco', '52-55 mm', '1"'],
  ['38X25', 'NEGRO', 'NA', 'CARTON', '3', '1000', 'Blanco, naranja, amarillo, rojo, verde', '78-80 mm', '1"'],
  ['40X30 MINI', 'NEGRO', 'NA', 'CARTON', '3', '200', 'Blanco', '48-50 mm', '1"'],
  ['40X30', 'NEGRO', 'NA', 'CARTON', '3', '800', 'Blanco', '68-70 mm', '1"'],
  ['4X1', 'NEGRO', 'NA', 'CARTON', '3', '2500', 'Blanco, amarillo', '110 mm', '1"'],
  ['4X2', 'NEGRO', 'NA', 'CARTON', '3', '1500', 'Blanco, amarillo', '128 mm', '1"'],
  ['4X3', 'NEGRO', 'NA', 'CARTON', '3', '1000', 'Blanco, amarillo', '120 mm', '1"'],
  ['4X4', 'NEGRO', 'NA', 'CARTON', '3', '500', 'Blanco, amarillo', '103 mm', '1"'],
  ['4X6', 'NEGRO', 'NA', 'CARTON', '3', '200', 'Blanco, azul, verde, amarillo, rosa, naranja, rojo', '78 mm', '1"'],
  ['4X8', 'NEGRO', 'NA', 'CARTON', '3', '200', 'Blanco', '90 mm', '1"'],
  ['51 CIRCULO', 'NEGRO', 'NA', 'CARTON', 'N/A', '750', 'Blanco, amarillo, verde, azul, rojo, morado, azul reflex, rosa, naranja', '88-90 mm', '1"'],
  ['62 BROTHER DK2205', 'NEGRO', 'NA', 'CARTON', 'N/A', '30.5 m', 'Blanco, amarillo, verde, azul, rojo', '', '1"'],
  ['29 BROTHER DK2210', 'NEGRO', 'NA', 'CARTON', 'N/A', '30.5 m', 'Blanco', '', '1"'],
  ['17X54 BROTHER DK1204', 'NEGRO', 'NA', 'CARTON', '5', '400', 'Blanco', '', '1"'],
  ['29X90 BROTHER DK1201', 'NEGRO', 'NA', 'CARTON', '6', '400', 'Blanco', '', '1"'],
  ['3X2 (76X51)', 'NEGRO', 'NA', 'CARTON', '3', '250', 'Blanco', '65 mm', '1"'],
  ['3X1 (76X25)', 'NEGRO', 'NA', 'CARTON', '3', '1000', 'Blanco', '', '1"'],
];

// Columnas PROVEEDORES y COLORES FONDO de la misma hoja.
const PROVEEDORES = ['PROYECTO X', 'CREAFLEX', 'PAPER & ROLL', 'GARIN', 'BAO BROTHER', 'COSMOTAG'];
const FONDOS = ['BLANCO', 'VERDE', 'AZUL', 'ROSA', 'NARANJA', 'AMARILLO', 'LILA', 'ROJO', 'PLATEADO', 'AZUL REFLEX', 'NATURAL'];

// Idempotente igual que el resto: solo inserta lo que falta, así que quien ya
// dio de alta un material nuevo desde Configuración no lo ve duplicarse.
function sembrarCalidad() {
  const existeMaterial = db.prepare('SELECT id FROM materiales WHERE modelo = ?');
  const insertMaterial = db.prepare(`
    INSERT INTO materiales (modelo, color_impresion, marca_termino, tipo_centro, gap,
                            cant_x_rollo, colores, diam_referencia, centro_referencia, orden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  MATERIALES.forEach((m, i) => {
    if (!existeMaterial.get(m[0])) insertMaterial.run(...m, i);
  });

  const insertCatalogo = db.prepare(
    'INSERT OR IGNORE INTO catalogo_calidad (tipo, valor, orden) VALUES (?, ?, ?)'
  );
  PROVEEDORES.forEach((v, i) => insertCatalogo.run('proveedor', v, i));
  FONDOS.forEach((v, i) => insertCatalogo.run('fondo', v, i));
}

function sembrar() {
  const insertActivo = db.prepare(
    'INSERT INTO activos (clave, nombre, tipo, atributos) VALUES (?, ?, ?, ?)'
  );
  const existeActivo = db.prepare('SELECT id FROM activos WHERE clave = ?');
  for (const a of ACTIVOS) {
    if (!existeActivo.get(a.clave)) {
      insertActivo.run(a.clave, a.nombre, a.tipo, JSON.stringify(a.atributos));
    }
  }

  const insertUsuario = db.prepare('INSERT INTO usuarios (nombre, rol, pin) VALUES (?, ?, ?)');
  const existeUsuario = db.prepare('SELECT id FROM usuarios WHERE nombre = ?');
  for (const u of USUARIOS) {
    if (!existeUsuario.get(u.nombre)) insertUsuario.run(u.nombre, u.rol, u.pin);
  }

  const existePlantilla = db.prepare('SELECT id FROM plantillas WHERE clave = ?');
  const insertPlantilla = db.prepare(`
    INSERT INTO plantillas (clave, nombre, descripcion, tipo_captura, frecuencia,
                            aplica_a, firma_operador, firma_coordinador, foto_obligatoria,
                            orden, activo, campos, por_etapas, requiere_supervision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSeccion = db.prepare(
    'INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertItem = db.prepare(`
    INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let nuevas = 0;
  PLANTILLAS.forEach((p, iP) => {
    if (existePlantilla.get(p.clave)) return;
    const plantillaId = Number(insertPlantilla.run(
      p.clave, p.nombre, p.descripcion, p.tipo_captura, p.frecuencia,
      p.aplica_a, p.firma_operador, p.firma_coordinador, p.foto_obligatoria || 0,
      iP, p.activo === 0 ? 0 : 1, JSON.stringify(p.campos || []), p.por_etapas || 0,
      p.requiere_supervision || 0
    ).lastInsertRowid);
    p.secciones.forEach((s, iS) => {
      const seccionId = Number(insertSeccion.run(plantillaId, iS, s.titulo, s.etapa || 'salida',
        s.condicion ? JSON.stringify(s.condicion) : null, s.activo === 0 ? 0 : 1).lastInsertRowid);
      s.items.forEach(([texto, tipo, soloActivos, meta], iI) => {
        insertItem.run(
          seccionId, iI, texto, tipo,
          soloActivos ? JSON.stringify(soloActivos) : null,
          JSON.stringify(meta || {})
        );
      });
    });
    nuevas++;
  });

  sembrarCalidad();

  completarSecciones();
  sincronizarEstructura();
  return nuevas;
}

// Alinea con esta definición los atributos ESTRUCTURALES de las plantillas que
// ya existían: los campos de cabecera, si se llena por etapas y a qué etapa
// pertenece cada sección. Son cosas que no se editan desde Configuración, así
// que sincronizarlas no pisa ninguna decisión del administrador —a diferencia
// de 'activo' o 'foto_obligatoria', que sí se tocan ahí y aquí no se rozan.
function sincronizarEstructura() {
  const buscarPlantilla = db.prepare(
    'SELECT id, campos, por_etapas, descripcion, frecuencia, requiere_supervision FROM plantillas WHERE clave = ?');
  const actualizarPlantilla = db.prepare(
    'UPDATE plantillas SET campos = ?, por_etapas = ?, descripcion = ?, frecuencia = ?, requiere_supervision = ? WHERE id = ?');
  const buscarSeccion = db.prepare('SELECT id, etapa, condicion, activo FROM secciones WHERE plantilla_id = ? AND titulo = ?');
  const actualizarSeccion = db.prepare('UPDATE secciones SET etapa = ?, condicion = ?, activo = ? WHERE id = ?');
  const buscarItem = db.prepare('SELECT id, texto, meta FROM items WHERE seccion_id = ? AND orden = ?');
  const actualizarItem = db.prepare('UPDATE items SET texto = ?, meta = ? WHERE id = ?');

  for (const p of PLANTILLAS) {
    const fila = buscarPlantilla.get(p.clave);
    if (!fila) continue;

    const campos = JSON.stringify(p.campos || []);
    const porEtapas = p.por_etapas || 0;
    const supervision = p.requiere_supervision || 0;
    if (fila.campos !== campos || fila.por_etapas !== porEtapas || fila.descripcion !== p.descripcion
        || fila.frecuencia !== p.frecuencia || fila.requiere_supervision !== supervision) {
      actualizarPlantilla.run(campos, porEtapas, p.descripcion, p.frecuencia, supervision, fila.id);
      console.log(`  Estructura actualizada en «${p.nombre}» (frecuencia: ${p.frecuencia}`
        + `${supervision ? ', salida supervisada' : ''}).`);
    }

    for (const s of p.secciones) {
      const etapa = s.etapa || 'salida';
      const condicion = s.condicion ? JSON.stringify(s.condicion) : null;
      const seccion = buscarSeccion.get(fila.id, s.titulo);
      if (!seccion) continue;

      const activa = s.activo === 0 ? 0 : 1;
      if (seccion.etapa !== etapa || seccion.condicion !== condicion || seccion.activo !== activa) {
        actualizarSeccion.run(etapa, condicion, activa, seccion.id);
        console.log(`  «${s.titulo}» ${activa ? 'actualizada' : 'RETIRADA de circulación'} (etapa ${etapa}).`);
      }

      // El texto de los ítems también vive aquí: nada más lo edita, así que esta
      // definición es la fuente de verdad y renombrar un ítem no pierde su historial.
      s.items.forEach(([texto, , , meta], i) => {
        const item = buscarItem.get(seccion.id, i);
        const metaJSON = JSON.stringify(meta || {});
        if (item && (item.texto !== texto || item.meta !== metaJSON)) {
          actualizarItem.run(texto, metaJSON, item.id);
          console.log(`  Ítem actualizado: «${texto}»`);
        }
      });
    }
  }
}

// La carga inicial salta las plantillas que ya existen, así que un checklist en
// uso nunca recibiría secciones nuevas. Esto las agrega sin tocar lo capturado:
// compara por título e inserta solo lo que falta.
function completarSecciones() {
  const buscarPlantilla = db.prepare('SELECT id FROM plantillas WHERE clave = ?');
  const buscarSeccion = db.prepare('SELECT id FROM secciones WHERE plantilla_id = ? AND titulo = ?');
  const ultimoOrden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM secciones WHERE plantilla_id = ?');
  const insertSeccion = db.prepare('INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo) VALUES (?, ?, ?, ?, ?, ?)');
  const insertItem = db.prepare(`
    INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let agregadas = 0;
  for (const p of PLANTILLAS) {
    const plantilla = buscarPlantilla.get(p.clave);
    if (!plantilla) continue;

    for (const s of p.secciones) {
      if (buscarSeccion.get(plantilla.id, s.titulo)) continue;

      const orden = ultimoOrden.get(plantilla.id).n + 1;
      const seccionId = Number(insertSeccion.run(plantilla.id, orden, s.titulo, s.etapa || 'salida',
        s.condicion ? JSON.stringify(s.condicion) : null, s.activo === 0 ? 0 : 1).lastInsertRowid);
      s.items.forEach(([texto, tipo, soloActivos, meta], i) => {
        insertItem.run(seccionId, i, texto, tipo,
          soloActivos ? JSON.stringify(soloActivos) : null, JSON.stringify(meta || {}));
      });
      console.log(`  Sección nueva en «${p.nombre}»: ${s.titulo}`);
      agregadas++;
    }
  }
  return agregadas;
}

module.exports = { sembrar };

if (require.main === module) {
  const n = sembrar();
  console.log(`Carga inicial lista. Plantillas nuevas: ${n}`);
}
