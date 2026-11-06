'use strict';

// Carga inicial: transcribe los checklists en papel a la base de datos.
// Es idempotente — vuelve a correrlo cuantas veces quieras; solo inserta lo que falta.
// Los tres checklists de vehículo (ISUZU / NP300 / PARTNER) eran 95% idénticos en
// papel, así que aquí son UNA plantilla; lo que cambiaba entre ellos (presión de
// llantas, grado de aceite, ítems exclusivos del ISUZU) se resuelve con los
// atributos del activo y el campo solo_activos de cada ítem.

const { db } = require('./db');
const { sembrarAlmacen } = require('./seed-almacen');
const TRANSITO = require('./transito-estructura');

const OK = 'ok_problema';   // Satisfactorio / Con problema
const REV = 'revisado';     // Revisado sí / no
const NUM = 'conteo';       // Cantidad numérica
const DOC = 'documento';    // Exige adjuntar uno o más archivos
const FECHA = 'fecha';      // Se captura una fecha; con meta.vigencia calcula días restantes
const TEXTO = 'texto';      // Se escribe a mano
const MED = 'medidor';      // Una lectura con su foto: kilometraje, horómetro

// Los papeles y el kilometraje que lleva cualquier carro. Se repiten tal cual en
// los tres checklists de carro, así que viven aquí una sola vez.
const PAPELES_CARRO = [
  ['Tarjeta de circulación', FECHA, null,
    { vigencia: true, obligatoria: true, etiqueta: 'Vence la tarjeta de circulación',
      ayuda: 'Captura la fecha en que vence. La plataforma calcula los días que le quedan.' }],
  ['Póliza de seguro', FECHA, null,
    { vigencia: true, obligatoria: true, etiqueta: 'Vence la póliza',
      ayuda: 'Captura la fecha en que vence. La plataforma calcula los días que le quedan.' }],
  ['Verificación vehicular', FECHA, null,
    { vigencia: true, obligatoria: true, etiqueta: 'Vence la verificación',
      ayuda: 'Captura la fecha en que vence. La plataforma calcula los días que le quedan.' }],
  ['¿Unidad afiliada a ACME?', FECHA, null,
    { vigencia: true, etiqueta: 'Vigencia de ACME',
      ayuda: 'Captura la fecha en que vence la afiliación. Si no está afiliada, déjalo vacío.' }],
  ['Kilometraje al momento de la revisión', MED, null,
    { unidad: 'km', obligatoria: true,
      ayuda: 'Anota los kilómetros del tablero y toma la foto del odómetro.' }],
];

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
          ['¿Unidad se encuentra afiliada a ANTRA todavía?', FECHA, null,
            { vigencia: true, etiqueta: 'Vigencia de la afiliación',
              ayuda: 'Captura la fecha en que vence. La plataforma calcula los días que le quedan o los que lleva vencida.' }],
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
    descripcion: TRANSITO.DESCRIPCION,
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
    campos: TRANSITO.CAMPOS,
    secciones: [
      {
        titulo: 'Chequeo citas',
        condicion: TRANSITO.ENVIO,
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
        condicion: TRANSITO.ENVIO,
        items: [
          ['Hojas de autorización de ingreso', DOC, null,
            { momento: 'antes', ayuda: 'Una por cada punto de entrega. Sin ellas no se autoriza la salida.' }],
        ],
      },
      {
        titulo: 'Al regresar · Documentos',
        etapa: 'regreso',
        condicion: TRANSITO.ENVIO,
        items: [
          ['Hojas de recepción de entrega', DOC, null,
            { momento: 'despues', ayuda: 'Una por cada entrega concluida, firmada por quien recibió.' }],
        ],
      },
      ...TRANSITO.SECCIONES_COLECTA,
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

  // --- las unidades que se sumaron el 1-oct-2026: carros utilitarios, carros de
  // arrendamiento, motos y patines. Son checklists propios y no uno solo con
  // todo adentro: a un patín no se le revisa el aceite, y a una moto no se le
  // pregunta por la caja de herramientas de una camioneta.
  {
    clave: 'utilitario',
    nombre: 'Inspección de Carro Utilitario',
    descripcion: 'Revisión del carro de uso interno y de vueltas cortas',
    tipo_captura: 'items',
    frecuencia: 'viernes',
    aplica_a: 'utilitario',
    firma_operador: 1,
    firma_coordinador: 0,
    foto_obligatoria: 1,
    secciones: [
      {
        titulo: '1. Antes de arrancar',
        items: [
          ['Llantas: presión correcta y sin desgaste irregular', OK],
          ['Llanta de refacción, gato y llave de cruz a bordo', OK],
          ['Luces, direccionales y luces de freno', OK],
          ['Claxon y limpiaparabrisas', OK],
          ['Espejos y cristales sin grietas', OK],
          ['Frenos responden sin ruido ni esponjosidad', OK],
        ],
      },
      {
        titulo: '2. Motor y fluidos',
        items: [
          ['Nivel de aceite del motor', OK],
          ['Anticongelante y agua del limpiaparabrisas', OK],
          ['Líquido de frenos', OK],
          ['Sin fugas debajo de la unidad', OK],
          ['Batería y cables en buen estado', OK],
        ],
      },
      {
        titulo: '3. Interior y seguridad',
        items: [
          ['Cinturones de seguridad funcionan', OK],
          ['Extintor vigente y a la mano', OK],
          ['Botiquín de primeros auxilios', OK],
          ['Triángulos o conos reflejantes', OK],
          ['Interior limpio y sin objetos sueltos', OK],
        ],
      },
      { titulo: '4. Documentación y kilometraje', items: PAPELES_CARRO },
    ],
  },

  {
    clave: 'arrendamiento',
    nombre: 'Inspección de Carro de Arrendamiento',
    descripcion: 'Revisión de unidades arrendadas: su estado y su contrato',
    tipo_captura: 'items',
    frecuencia: 'viernes',
    aplica_a: 'arrendamiento',
    firma_operador: 1,
    firma_coordinador: 1,
    foto_obligatoria: 1,
    secciones: [
      {
        titulo: '1. Antes de arrancar',
        items: [
          ['Llantas: presión correcta y sin desgaste irregular', OK],
          ['Llanta de refacción, gato y llave de cruz a bordo', OK],
          ['Luces, direccionales y luces de freno', OK],
          ['Claxon y limpiaparabrisas', OK],
          ['Espejos y cristales sin grietas', OK],
          ['Frenos responden sin ruido ni esponjosidad', OK],
          ['Nivel de aceite y sin fugas debajo de la unidad', OK],
        ],
      },
      {
        titulo: '2. Estado de la unidad arrendada',
        items: [
          ['Carrocería sin golpes nuevos (los de antes ya están anotados en el contrato)', OK],
          ['Interior sin daños ni faltantes', OK],
          ['Limpieza general: así se tiene que entregar', OK],
          ['Herramienta y accesorios que entregó el arrendador', OK],
        ],
      },
      {
        titulo: '3. Contrato',
        items: [
          ['Número de contrato', TEXTO, null, { ayuda: 'Como lo trae el contrato del arrendador.' }],
          ['Vigencia del contrato', FECHA, null,
            { vigencia: true, obligatoria: true, etiqueta: 'Vence el contrato',
              ayuda: 'Captura la fecha en que termina el arrendamiento.' }],
          ['¿El kilometraje va dentro de lo que permite el contrato?', OK],
        ],
      },
      { titulo: '4. Documentación y kilometraje', items: PAPELES_CARRO },
    ],
  },

  {
    clave: 'moto',
    nombre: 'Inspección de Moto',
    descripcion: 'Revisión de motos de entrega y de mensajería',
    tipo_captura: 'items',
    frecuencia: 'viernes',
    aplica_a: 'moto',
    firma_operador: 1,
    firma_coordinador: 0,
    foto_obligatoria: 1,
    secciones: [
      {
        titulo: '1. Antes de arrancar',
        items: [
          ['Llantas: presión y dibujo suficiente', OK],
          ['Freno delantero y freno trasero', OK],
          ['Cadena o banda: tensión y lubricación', OK],
          ['Luces, direccionales y luz de freno', OK],
          ['Claxon y espejos', OK],
          ['Nivel de aceite', OK],
          ['Sin fugas de gasolina ni de aceite', OK],
          ['Suspensión y manubrio sin juego', OK],
        ],
      },
      {
        titulo: '2. Equipo del operador',
        items: [
          ['Casco en buen estado y bien ajustado', OK],
          ['Chaleco reflejante', OK],
          ['Guantes y rodilleras (si se usan)', OK],
          ['Caja o maletero cierra bien y sin daños', OK],
          ['Red o cuerdas para sujetar la carga', OK],
        ],
      },
      { titulo: '3. Documentación y kilometraje', items: PAPELES_CARRO },
    ],
  },

  {
    clave: 'patin',
    nombre: 'Inspección de Patín Hidráulico',
    descripcion: 'Revisión de los patines de bodega',
    tipo_captura: 'items',
    frecuencia: 'semanal',
    aplica_a: 'patin',
    firma_operador: 1,
    firma_coordinador: 0,
    foto_obligatoria: 1,
    secciones: [
      {
        titulo: '1. Estructura y ruedas',
        items: [
          ['Horquillas sin dobleces, grietas ni soldaduras abiertas', OK],
          ['Ruedas y rodillos giran libres y sin desgaste excesivo', OK],
          ['Chasis y timón sin golpes que estorben', OK],
          ['Calcomanía de capacidad legible', OK],
        ],
      },
      {
        titulo: '2. Sistema hidráulico',
        items: [
          ['Sube la carga sin brincos y la sostiene', OK],
          ['Baja de manera controlada, sin caída libre', OK],
          ['Sin fuga de aceite en el pistón ni goteo en el piso', OK],
          ['Palanca de subir / neutral / bajar funciona en las tres posiciones', OK],
        ],
      },
      {
        titulo: '3. Seguridad y limpieza',
        items: [
          ['Freno de estacionamiento detiene el patín (si lo tiene)', OK],
          ['Sin tornillos, chavetas ni seguros faltantes', OK],
          ['Limpio y sin material encima al guardarlo', OK],
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
  // Después de Calidad, siempre: los productos de Almacén se enganchan a los
  // materiales por su modelo, y si los materiales no existen todavía todos
  // quedarían sin muestreo.
  sembrarAlmacen();

  return nuevas;
}

// Esta carga solo CREA los checklists que faltan. Antes, además, en cada arranque
// realineaba con esta lista los checklists que ya existían —campos, secciones e
// ítems, emparejando los ítems por su posición—. Desde que el Administrador edita
// las preguntas en Configuración eso ya no se puede: reordenar en el editor hacía
// que un arranque reescribiera el texto de la pregunta equivocada, y un área
// renombrada volvía a crearse con su nombre viejo. Ahora la base manda sobre los
// checklists existentes, y un cambio de estructura hecho por el sistema va como
// migración de una sola vez en db.js (ver 'transito-envio-colecta').

module.exports = { sembrar };

if (require.main === module) {
  const n = sembrar();
  console.log(`Carga inicial lista. Plantillas nuevas: ${n}`);
}
