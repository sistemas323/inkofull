'use strict';

// La estructura de Tránsito desde que distingue envíos de colectas.
//
// Un ENVÍO sale de INKO a entregar en un CEDIS: chequeo de citas y hojas de
// autorización antes de salir, hoja de recepción al regresar. Una COLECTA es al
// revés: un transportista viene a recoger la carga, y lo que se revisa es él
// —proveedor, hora de arribo, unidad, placas, chofer e identificación— más la
// hoja de autorización de colecta antes de cargar y la evidencia de la carga ya
// recolectada al final.
//
// La usan la carga inicial (seed.js), para una base nueva, y la migración de
// db.js, para la base que ya existía: una sola definición para las dos.

const DESCRIPCION = 'Envíos a CEDIS y colectas · un checklist por movimiento';

// Primero se dice qué es; hasta entonces no aparecen el número ni el CEDIS, y la
// etiqueta del número cambia según la respuesta. Los CEDIS no van escritos aquí:
// salen de la lista que mantiene el Administrador (tabla transito_cedis).
const CAMPOS = [
  { clave: 'tipo', etiqueta: '¿Es envío o colecta?', requerido: 1,
    opciones: [{ valor: 'envio', etiqueta: 'Envío' }, { valor: 'colecta', etiqueta: 'Colecta' }] },
  { clave: 'numero_envio', etiqueta: 'Número de envío', requerido: 1, referencia: 1, segun: 'tipo',
    etiquetas: { envio: 'Número de envío', colecta: 'Número de colecta' },
    ayuda: 'Identifica este checklist. No se repite el mismo número el mismo día.' },
  { clave: 'lugar_entrega', etiqueta: 'CEDIS', requerido: 1, segun: 'tipo', catalogo: 'cedis',
    ayuda: 'La lista la mantiene el Administrador en Configuración → Tránsito.' },
];

const ENVIO = { campo: 'tipo', valor: 'envio' };
const COLECTA = { campo: 'tipo', valor: 'colecta' };

// Las secciones que ya existían son del envío.
const SECCIONES_DE_ENVIO = ['Chequeo citas', 'Antes de salir · Documentos', 'Al regresar · Documentos'];

// meta.clave marca los datos del transporte para poder leerlos en el reporte
// aunque el Administrador cambie la redacción de la pregunta.
const SECCIONES_COLECTA = [
  {
    titulo: 'Datos del transporte',
    etapa: 'salida',
    condicion: COLECTA,
    items: [
      ['Proveedor de transporte', 'texto', null, { clave: 'proveedor' }],
      ['Hora de arribo del transporte', 'hora', null, { clave: 'hora_arribo' }],
      ['Unidad adecuada para la carga', 'revisado', null, { clave: 'unidad_adecuada' }],
      ['Placas de la unidad', 'texto', null, { clave: 'placas' }],
      ['Nombre del chofer', 'texto', null, { clave: 'chofer' }],
      ['Identificación del chofer', 'documento', null,
        { momento: 'antes', clave: 'id_chofer', ayuda: 'Foto de la identificación oficial del chofer.' }],
    ],
  },
  {
    titulo: 'Antes de cargar · Documentos',
    etapa: 'salida',
    condicion: COLECTA,
    items: [
      ['Hoja de autorización de colecta', 'documento', null,
        { momento: 'antes', ayuda: 'Sin ella no se autoriza la carga.' }],
    ],
  },
  {
    titulo: 'Después de cargar · Evidencia',
    etapa: 'regreso',
    condicion: COLECTA,
    items: [
      ['Evidencia de carga recolectada', 'documento', null,
        { momento: 'despues', ayuda: 'Fotos de la carga ya arriba de la unidad del transportista.' }],
    ],
  },
];

const CEDIS_INICIALES = ['DANHOS', 'MXCD14', 'MEX 3'];

module.exports = { DESCRIPCION, CAMPOS, ENVIO, COLECTA, SECCIONES_DE_ENVIO, SECCIONES_COLECTA, CEDIS_INICIALES };
