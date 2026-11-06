'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const zlib = require('node:zlib');

const { DatabaseSync } = require('node:sqlite');
const { db, dbReal, contexto, prepararBase, sentencia, DATA_DIR, FOTOS_DIR } = require('./db');
const { leerODT } = require('./odt-excel');
const xlsx = require('./xlsx');
const { sembrar } = require('./seed');
const { semanaISO, hoyISO, periodoASemana, describirSemana, ultimasSemanas,
        describirVigencia } = require('./fechas');

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
    // Tránsito salió de Checklists y es módulo aparte, pero lo sigue capturando
    // la misma gente: sin esto, el operador perdería el checklist de envíos.
    mod_transito: true,
    mod_notificaciones: true,
    // Incidencias no viene con ningún puesto: la ve y la llena solo a quien el
    // Administrador se la dé (lo pidió así el 18-sep-2026).
    llenar: true,
    firmar_operador: true,
    // Almacén NO viene en el perfil de Operador a propósito. Quién entra y
    // quién captura ahí se reparte persona por persona desde Configuración, y
    // eso ya estaba decidido antes de que el módulo existiera. Meterlo en el
    // perfil borraría esa decisión: los ajustes guardados dejarían de verse como
    // ajustes y todos capturarían por omisión.
  },
  team_leader: {
    etiqueta: 'Team Leader',
    descripcion: 'Llena, autoriza salidas y consulta Reportes',
    mod_checklists: true,
    // Calidad viene incluida porque un lote rechazado no cierra sin la firma de
    // un Team Leader. Sin acceso al módulo, la firma no tendría quién la levante.
    mod_calidad: true,
    mod_transito: true,
    mod_produccion: true,
    mod_almacen: true,
    mod_ventas_fuera: true,
    mod_notificaciones: true,
    mod_reportes: true,
    llenar: true,
    firmar_operador: true,
    firmar_supervision: true,
    reportes: true,
    calidad_capturar: true,
    calidad_autorizar: true,
    calidad_proponer: true,
    calidad_reportes: true,
    // Módulos aún por construir. Los permisos ya existen para poder repartirlos
    // desde hoy; cuando el módulo se construya, la regla ya está puesta.
    produccion_capturar: true,
    produccion_reportes: true,
    almacen_movimientos: true,
    almacen_autorizar: true,
    almacen_reportes: true,
    ventas_fuera_capturar: true,
    ventas_fuera_autorizar: true,
    ventas_fuera_reportes: true,
    notificaciones_enviar: true,
  },
  // Quien vende por fuera: levanta sus órdenes de armado y les carga la guía o
  // la nota de remisión. No entra a nada más salvo lo que se le asigne aparte
  // en Configuración → Permisos. Es un puesto nuevo, no un cambio a los otros.
  ventas_fuera: {
    etiqueta: 'Ventas directas',
    descripcion: 'Sus órdenes de armado y las guías o notas de remisión',
    mod_ventas_fuera: true,
    mod_notificaciones: true,
    ventas_fuera_capturar: true,
  },
  admin: {
    etiqueta: 'Administrador',
    descripcion: 'Todo, incluida la Configuración',
    mod_checklists: true,
    mod_produccion: true,
    mod_calidad: true,
    mod_transito: true,
    mod_ventas_fuera: true,
    mod_almacen: true,
    mod_notificaciones: true,
    mod_incidencias: true,
    mod_reportes: true,
    mod_configuracion: true,
    llenar: true,
    firmar_operador: true,
    firmar_supervision: true,
    reportes: true,
    comparativa: true,
    configuracion: true,
    calidad_capturar: true,
    calidad_autorizar: true,
    calidad_reportes: true,
    produccion_capturar: true,
    produccion_reportes: true,
    almacen_movimientos: true,
    almacen_autorizar: true,
    almacen_reportes: true,
    ventas_fuera_capturar: true,
    ventas_fuera_autorizar: true,
    ventas_fuera_reportes: true,
    notificaciones_enviar: true,
    incidencias_levantar: true,
    incidencias_reportes: true,
    // El Administrador aprueba, no propone. Si tuviera las dos cosas podría
    // proponer y aprobarse a sí mismo, y la cadena de dos personas se caería.
    calidad_aprobar: true,
  },
};

// Catálogo de permisos que se pueden otorgar o quitar por persona, agrupado
// **por módulo**: la pantalla de Configuración muestra un módulo a la vez y
// dentro de él todo lo que se puede hacer, para repartirlo persona por persona.
//
// El primer permiso de cada módulo (`acceso: true`) es el que lo hace aparecer
// en el menú. Los demás son acciones dentro de él. Un mismo permiso puede
// aparecer en dos módulos cuando de verdad los gobierna a los dos: Tránsito
// salió de Checklists pero se captura y se firma con las mismas funciones, y
// `comparte` lo dice en la pantalla para que nadie crea que son dos interruptores.
//
// Los permisos de reportes viven todos en el módulo Reportes, que es donde se
// consultan. Un módulo se ocupa de capturar; mirar hacia atrás es otra cosa, y
// hay quien hace una sin la otra.
const CATALOGO_PERMISOS = [
  {
    modulo: 'checklists',
    grupo: 'Checklists',
    ayuda: 'Inspección de unidades, montacargas e insumos.',
    permisos: [
      { clave: 'mod_checklists', etiqueta: 'Entrar a Checklists', acceso: true },
      { clave: 'llenar', etiqueta: 'Llenar checklists', comparte: 'Tránsito' },
      { clave: 'firmar_operador', etiqueta: 'Firmar como quien inspecciona', comparte: 'Tránsito' },
      { clave: 'firmar_supervision', etiqueta: 'Firmar la supervisión' },
      { clave: 'checklists_aprobar', etiqueta: 'Aprobar o pedir modificación de un checklist' },
    ],
  },
  {
    modulo: 'produccion',
    grupo: 'Producción',
    ayuda: 'La ODT de la semana: se carga, se reparte por envío y se publica. Ya publicada, la ve todo producción y nadie la cambia: solo se pide una modificación y otra persona la aprueba. Cada quien anota lo que arma, y de ahí salen el avance y las métricas.',
    permisos: [
      { clave: 'mod_produccion', etiqueta: 'Entrar a Producción y ver la ODT publicada', acceso: true },
      { clave: 'produccion_capturar', etiqueta: 'Capturar en Producción' },
      { clave: 'produccion_odt_cargar', etiqueta: 'Cargar la ODT, repartirla por envío y publicarla' },
      { clave: 'produccion_armar', etiqueta: 'Anotar lo que armé' },
      { clave: 'produccion_modificacion_pedir', etiqueta: 'Pedir una modificación a una partida de la ODT' },
      { clave: 'produccion_modificacion_aprobar', etiqueta: 'Aprobar o rechazar una modificación a la ODT' },
      { clave: 'produccion_avance', etiqueta: 'Ver el avance: semana, día, envío y por persona' },
      { clave: 'produccion_traspaso_pedir', etiqueta: 'Pedir traspasos desde la ODT' },
    ],
  },
  {
    modulo: 'calidad',
    grupo: 'Calidad',
    ayuda: 'Muestreo del material que llega de proveedor, el re-ingreso de los retiros que llegan a bodega y la salida del material que se dañó estando guardado. Lo que Calidad da por bueno es lo que entra al inventario.',
    permisos: [
      { clave: 'mod_calidad', etiqueta: 'Entrar a Calidad', acceso: true },
      { clave: 'calidad_capturar', etiqueta: 'Capturar muestreos' },
      { clave: 'calidad_autorizar', etiqueta: 'Firmar la autorización de un rechazo' },
      { clave: 'calidad_proponer', etiqueta: 'Proponer qué hacer con un rechazo' },
      { clave: 'reingresos_capturar', etiqueta: 'Re-ingresos de retiro: llenarlos (cajas y productos que llegaron) y enviarlos a aprobación' },
      { clave: 'reingresos_aprobar', etiqueta: 'Re-ingresos: aprobar (suma al inventario) o cancelar', comparte: 'Almacén' },
      { clave: 'calidad_salida_pedir', etiqueta: 'Salidas por calidad: llenarlas (producto, motivo y foto) y enviarlas a aprobación' },
      { clave: 'calidad_salida_aprobar', etiqueta: 'Salidas por calidad: aprobar (mueve el inventario)', comparte: 'Almacén' },
      { clave: 'calidad_aprobar', etiqueta: 'Aprobación final', solo_admin: true },
    ],
  },
  {
    modulo: 'transito',
    grupo: 'Tránsito',
    ayuda: 'Envíos a CEDIS y colectas. Quien lo llena lo envía a autorización; un Team Leader autoriza la salida o la carga; al final se carga la hoja de recepción o la evidencia de carga y un Team Leader aprueba el cierre. Recibir los avisos de Tránsito va con poder entrar y capturar.',
    permisos: [
      { clave: 'mod_transito', etiqueta: 'Entrar a Tránsito', acceso: true },
      { clave: 'llenar', etiqueta: 'Capturar envíos y colectas, y enviarlos a autorización', comparte: 'Checklists' },
      { clave: 'firmar_operador', etiqueta: 'Firmar como quien los llena', comparte: 'Checklists' },
      { clave: 'transito_autorizar', etiqueta: 'Autorizar la salida de un envío o la carga de una colecta (o regresarlo)' },
      { clave: 'transito_aprobar_cierre', etiqueta: 'Aprobar el cierre de un envío o colecta (o regresarlo)' },
      { clave: 'traspasos_cargar', etiqueta: 'Avisar que un traspaso va cargado (con foto)', comparte: 'Almacén' },
      { clave: 'transito_reportes', etiqueta: 'Consultar el reporte de Tránsito', comparte: 'Reportes' },
    ],
  },
  {
    modulo: 'ventas_fuera',
    grupo: 'Ventas directas',
    ayuda: 'Órdenes de venta directa. Quien vende la levanta; Almacén la arma y anota cada caja con su modelo y su peso; quien vende carga la guía o la nota de remisión; el encargado la cierra. El puesto «Ventas directas» solo trae esto.',
    permisos: [
      { clave: 'mod_ventas_fuera', etiqueta: 'Entrar a Ventas directas', acceso: true },
      { clave: 'ventas_fuera_capturar', etiqueta: 'Levantar órdenes de armado y cargarles la guía o nota de remisión' },
      { clave: 'ventas_fuera_armar', etiqueta: 'Armar: anotar las cajas, su modelo y su peso' },
      { clave: 'ventas_fuera_autorizar', etiqueta: 'Cerrar una orden como terminada, o regresarla' },
      { clave: 'ventas_fuera_cobrar', etiqueta: 'Entregar y anotar el dinero cobrado, con su evidencia' },
      { clave: 'ventas_fuera_clientes', etiqueta: 'Cartera de clientes: cargarla desde Excel, corregir, unir y retirar clientes' },
    ],
  },
  {
    modulo: 'logistica',
    grupo: 'Logística',
    ayuda: 'Las unidades de la empresa: camionetas, carros utilitarios, carros de arrendamiento, motos, montacargas y patines. Aquí viven su checklist, sus cargas de gasolina, sus papeles con vencimiento y sus servicios. El rendimiento y el costo por kilómetro salen solos de las cargas, y los papeles por vencer avisan en Notificaciones.',
    permisos: [
      { clave: 'mod_logistica', etiqueta: 'Entrar a Logística y ver las unidades', acceso: true },
      { clave: 'logistica_cargas', etiqueta: 'Anotar cargas de gasolina' },
      { clave: 'logistica_corregir', etiqueta: 'Corregir o borrar una carga, un servicio o un documento' },
      { clave: 'logistica_servicios', etiqueta: 'Anotar servicios y mantenimientos, y programar el próximo' },
      { clave: 'logistica_rutas', etiqueta: 'Planear la ruta de entrega y marcar sus paradas' },
      { clave: 'logistica_documentos', etiqueta: 'Cargar y quitar los papeles de una unidad' },
    ],
  },
  {
    modulo: 'almacen',
    grupo: 'Almacén',
    ayuda: 'Existencias, entradas de proveedor, retiros de plataforma, salidas, traspasos, devoluciones y conteos. Cada documento tiene quien lo captura, quien lo aprueba y quien puede pedir que se corrija: son permisos aparte a propósito. Ningún movimiento toca el inventario sin la aprobación de otra persona.',
    permisos: [
      { clave: 'mod_almacen', etiqueta: 'Entrar a Almacén', acceso: true },
      { clave: 'entradas_capturar', etiqueta: 'Entradas: capturar y enviar a aprobación' },
      { clave: 'entradas_aprobar', etiqueta: 'Entradas: aprobar (pasan a Calidad) o cancelar' },
      { clave: 'entradas_corregir', etiqueta: 'Entradas: pedir corrección, aunque ya estén aplicadas' },
      { clave: 'retiros_capturar', etiqueta: 'Retiros: cargar un retiro de plataforma y dejarlo pendiente de recibir' },
      { clave: 'retiros_cerrar', etiqueta: 'Retiros: cerrar, reabrir o cancelar un retiro' },
      { clave: 'reingresos_aprobar', etiqueta: 'Re-ingresos de retiro: aprobar (suma al inventario) o cancelar', comparte: 'Calidad' },
      { clave: 'calidad_salida_aprobar', etiqueta: 'Salidas por calidad: aprobar (mueve el inventario)', comparte: 'Calidad' },
      { clave: 'salidas_capturar', etiqueta: 'Salidas: capturar y enviar a aprobación' },
      { clave: 'salidas_aprobar', etiqueta: 'Salidas: aprobar (mueve el inventario) o cancelar' },
      { clave: 'salidas_corregir', etiqueta: 'Salidas: pedir corrección, aunque ya estén aplicadas' },
      { clave: 'devoluciones_capturar', etiqueta: 'Devoluciones: capturar y enviar a aprobación' },
      { clave: 'devoluciones_aprobar', etiqueta: 'Devoluciones: aprobar (mueve el inventario) o cancelar' },
      { clave: 'devoluciones_corregir', etiqueta: 'Devoluciones: pedir corrección, aunque ya estén aplicadas' },
      { clave: 'conteos_abrir', etiqueta: 'Conteos: mandar a contar una bodega' },
      { clave: 'conteos_contar', etiqueta: 'Conteos: contar, llenar y enviar a aprobación' },
      { clave: 'conteos_aprobar', etiqueta: 'Conteos: aprobar el ajuste o cancelar' },
      { clave: 'conteos_aprobar_propios', etiqueta: 'Conteos: aprobar un conteo que yo mismo conté o envié' },
      { clave: 'conteos_reconteo', etiqueta: 'Conteos: pedir reconteo, aunque ya estén aprobados' },
      { clave: 'traspasos_capturar', etiqueta: 'Traspasos: capturar uno a mano' },
      { clave: 'traspasos_aprobar', etiqueta: 'Traspasos: aprobar uno solicitado' },
      { clave: 'traspasos_confirmar', etiqueta: 'Traspasos: confirmar la llegada (mueve el inventario)' },
      { clave: 'traspasos_regresar', etiqueta: 'Traspasos: regresar un paso' },
      { clave: 'almacen_carga_inicial', etiqueta: 'Cargar la existencia inicial desde Excel (reemplaza la anterior)' },
    ],
  },
  {
    modulo: 'bahia',
    grupo: 'Bahía digital',
    ayuda: 'Los papeles. Nadie trae este módulo en su puesto: entrar deja ver y cargar los propios, y los de las unidades o los de todo el personal se otorgan aparte. Los papeles del personal son datos personales: ese permiso exige clave.',
    permisos: [
      { clave: 'mod_bahia', etiqueta: 'Entrar: ver y cargar sus propios papeles y su ficha', acceso: true },
      { clave: 'bahia_unidades_ver', etiqueta: 'Unidades: ver sus papeles', comparte: 'Logística' },
      { clave: 'bahia_unidades_cargar', etiqueta: 'Unidades: cargar un papel' },
      { clave: 'bahia_unidades_editar', etiqueta: 'Unidades: corregir los datos de un papel (tipo, vencimiento, notas)' },
      { clave: 'bahia_personal_ver', etiqueta: 'Personal: ver los papeles de todos' },
      { clave: 'bahia_personal_cargar', etiqueta: 'Personal: cargarle un papel a alguien' },
      { clave: 'bahia_personal_editar', etiqueta: 'Personal: corregir los datos de un papel y la ficha de alguien' },
      { clave: 'bahia_emergencia', etiqueta: 'Ficha de emergencia de todos: tipo de sangre, contactos y clínica (sin ver sus papeles)' },
      { clave: 'bahia_retirar', etiqueta: 'Retirar un papel cargado, de lo que ya pueda ver' },
    ],
  },
  {
    modulo: 'notificaciones',
    grupo: 'Notificaciones',
    ayuda: 'La bandeja de lo que espera una decisión tuya. Lo que cada quien ve ahí no se otorga aquí: sale del permiso que hace falta para atender cada pendiente. Publicar avisos al personal está por construir.',
    permisos: [
      { clave: 'mod_notificaciones', etiqueta: 'Entrar a Notificaciones', acceso: true },
      { clave: 'notificaciones_enviar', etiqueta: 'Publicar un aviso al personal (por construir)' },
    ],
  },
  {
    modulo: 'incidencias',
    grupo: 'Incidencias',
    ayuda: 'La hoja de incidencias del personal. No viene con ningún puesto: solo la ve quien tenga «Entrar», y solo la llena quien tenga «Levantar». El Administrador la autoriza; sin esa autorización no cuenta para el bono.',
    permisos: [
      { clave: 'mod_incidencias', etiqueta: 'Entrar a Incidencias y ver las propias', acceso: true },
      { clave: 'incidencias_levantar', etiqueta: 'Levantar una incidencia a alguien' },
      { clave: 'incidencias_ver_todas', etiqueta: 'Ver la hoja completa del personal' },
      { clave: 'incidencias_autorizar', etiqueta: 'Autorizar o rechazar una incidencia', solo_admin: true },
    ],
  },
  {
    modulo: 'reportes',
    grupo: 'Reportes',
    ayuda: 'Aquí se juntan los reportes de todos los módulos. Cada uno se otorga aparte: entrar al módulo no da acceso a todo lo que hay dentro.',
    permisos: [
      { clave: 'mod_reportes', etiqueta: 'Entrar a Reportes', acceso: true },
      { clave: 'reportes', etiqueta: 'Reportes de Checklists' },
      { clave: 'comparativa', etiqueta: 'Comparativa entre semanas' },
      { clave: 'calidad_reportes', etiqueta: 'Reportes de Calidad' },
      { clave: 'produccion_reportes', etiqueta: 'Reportes de Producción' },
      { clave: 'ventas_fuera_reportes', etiqueta: 'Reportes de Ventas directas' },
      { clave: 'almacen_reportes', etiqueta: 'Reportes de Almacén' },
      { clave: 'logistica_reportes', etiqueta: 'Reportes de Logística: gasolina, rendimiento y servicios' },
      { clave: 'incidencias_reportes', etiqueta: 'Reportes de Incidencias' },
      { clave: 'transito_reportes', etiqueta: 'Reportes de Tránsito' },
      { clave: 'accesos_reportes', etiqueta: 'Reporte de accesos: quién entró, qué se bloqueó y quién liberó' },
      { clave: 'bahia_reportes', etiqueta: 'Reporte de la Bahía digital: papeles al día, por vencer y sin cargar' },
    ],
  },
  {
    modulo: 'configuracion',
    grupo: 'Configuración',
    ayuda: 'Personas, puestos, permisos, catálogos y el modo de pruebas. Solo el Administrador.',
    permisos: [
      { clave: 'mod_configuracion', etiqueta: 'Entrar a Configuración', acceso: true, solo_admin: true },
      { clave: 'config_limpieza', etiqueta: 'Borrar documentos de prueba', solo_admin: true },
      { clave: 'config_modo_pruebas', etiqueta: 'Modo de pruebas: prenderlo y usar el sistema como cualquier puesto', solo_admin: true },
      { clave: 'config_editar_checklists', etiqueta: 'Editar las preguntas y áreas de los checklists', solo_admin: true },
      { clave: 'config_transito', etiqueta: 'Editar la lista de CEDIS de Tránsito', solo_admin: true },
      // Este NO es solo_admin a propósito: liberar una clave bloqueada no puede
      // depender de que esté el Administrador, o el almacén se queda sin quien
      // capture. Se otorga a quien se decida, y abre su propia pantalla sin
      // abrir el resto de Configuración.
      { clave: 'claves_liberar', etiqueta: 'Liberar o bloquear claves de acceso' },
      { clave: 'config_resguardo', etiqueta: 'Resguardo de auditoría: ver lo guardado y armar el paquete del año', solo_admin: true },
      // Reabrir no es borrar: el documento vuelve a quedar editable y la
      // reapertura queda anotada con su motivo. Por eso se puede otorgar.
      { clave: 'reabrir_cerrados', etiqueta: 'Reabrir un documento ya cerrado: checklist aprobado, venta directa terminada' },
    ],
  },
];

const PERMISOS_VALIDOS = new Set(CATALOGO_PERMISOS.flatMap((g) => g.permisos.map((p) => p.clave)));

// Permisos que no se pueden otorgar a mano: van atados al perfil de
// Administrador y punto. La aprobación final de Calidad está aquí porque
// otorgarla a alguien más sería, justamente, dejar de ser la última aprobación.
const SOLO_ADMIN = new Set(
  CATALOGO_PERMISOS.flatMap((g) => g.permisos.filter((p) => p.solo_admin).map((p) => p.clave))
);

// Inventario pasó a llamarse Almacén y ODT de la semana salió del menú. Los
// permisos que el Administrador ya había repartido a mano llevan el nombre
// viejo; se renombran una sola vez para no perder ese trabajo. Sin esto, quien
// tenía Inventario otorgado se quedaría sin Almacén sin que nadie lo decidiera.
function renombrarPermisosViejos() {
  const cambios = { mod_inventario: 'mod_almacen' };
  const retirados = new Set(['mod_odt', 'mod_solicitudes', 'solicitudes_crear',
    'solicitudes_autorizar', 'incidencias_cerrar',
    // La Bahía nació con dos permisos que al día siguiente se partieron por
    // acción (ver, cargar, corregir). Duraron horas y nadie llegó a tenerlos.
    'bahia_unidades', 'bahia_personal']);

  for (const u of db.prepare('SELECT id, permisos_extra FROM usuarios').all()) {
    let datos;
    try { datos = JSON.parse(u.permisos_extra || '{}'); } catch { continue; }
    if (Array.isArray(datos)) datos = Object.fromEntries(datos.map((k) => [k, true]));

    let tocado = false;
    for (const [viejo, nuevo] of Object.entries(cambios)) {
      if (viejo in datos) {
        if (!(nuevo in datos)) datos[nuevo] = datos[viejo];
        delete datos[viejo];
        tocado = true;
      }
    }
    for (const clave of retirados) {
      if (clave in datos) { delete datos[clave]; tocado = true; }
    }
    if (tocado) {
      db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?')
        .run(JSON.stringify(datos), u.id);
    }
  }
}

renombrarPermisosViejos();

// Un permiso que se parte en varios no le quita ni le da poder a nadie.
//
// Cuando una acción que vivía dentro de un permiso más grande pasa a tener el
// suyo, quien podía hacerla tiene que seguir pudiendo: si no, el sistema
// amanece con gente que ayer aprobaba traspasos y hoy no, sin que nadie lo haya
// decidido. Así que cada permiso nuevo hereda de su padre — en el perfil y en
// los ajustes que el Administrador ya había repartido a mano.
//
// A partir de ahí son independientes: él los mueve uno por uno desde
// Configuración → Permisos, que es justamente para lo que se partieron.
//
// Esta tabla es la memoria de qué salió de dónde. Un renglón nuevo aquí cada vez
// que una acción se separe de otra.
const PERMISOS_DERIVADOS = {
  // De 'produccion_capturar' salieron los dos actos de la ODT.
  produccion_odt_cargar: 'produccion_capturar',
  produccion_traspaso_pedir: 'produccion_capturar',
  // De 'almacen_autorizar' salieron los dos momentos del traspaso.
  traspasos_aprobar: 'almacen_autorizar',
  traspasos_confirmar: 'almacen_autorizar',
  // Almacén se partió por actividad: capturar, aprobar y pedir corrección de
  // cada documento. Quien capturaba sigue capturando; quien autorizaba aprueba y
  // puede pedir correcciones y reconteos. De ahí en adelante se reparten aparte.
  entradas_capturar: 'almacen_movimientos',
  salidas_capturar: 'almacen_movimientos',
  devoluciones_capturar: 'almacen_movimientos',
  conteos_abrir: 'almacen_movimientos',
  conteos_contar: 'almacen_movimientos',
  traspasos_capturar: 'almacen_movimientos',
  entradas_aprobar: 'almacen_autorizar',
  entradas_corregir: 'almacen_autorizar',
  salidas_aprobar: 'almacen_autorizar',
  salidas_corregir: 'almacen_autorizar',
  devoluciones_aprobar: 'almacen_autorizar',
  devoluciones_corregir: 'almacen_autorizar',
  conteos_aprobar: 'almacen_autorizar',
  conteos_reconteo: 'almacen_autorizar',
  traspasos_regresar: 'almacen_autorizar',
  // Avisar que un traspaso va cargado bastaba con poder entrar a Tránsito.
  traspasos_cargar: 'mod_transito',
  // Borrar pruebas bastaba con poder entrar a Configuración.
  config_limpieza: 'mod_configuracion',
  // Prender el modo de pruebas bastaba con poder entrar a Configuración.
  config_modo_pruebas: 'mod_configuracion',
  // Aprobar un checklist lo hereda quien ya firmaba la supervisión: es el mismo
  // Team Leader que antes autorizaba con su firma.
  checklists_aprobar: 'firmar_supervision',
  // Editar preguntas bastaba con poder entrar a Configuración.
  config_editar_checklists: 'mod_configuracion',
  // Planear la ruta del día la hace quien lleva Logística.
  logistica_rutas: 'mod_logistica',
  // Quien podía levantar una incidencia tenía la hoja enfrente, así que la ve
  // entera. Autorizar no se hereda de nada: es del Administrador y punto.
  incidencias_ver_todas: 'incidencias_levantar',
  // Los envíos se consultaban en el Historial de Checklists: quien veía esos
  // reportes sigue viendo los de Tránsito, ahora en su propio reporte.
  transito_reportes: 'reportes',
  // Autorizar la salida y aprobar el cierre de Tránsito colgaban de la firma de
  // supervisión, compartida con Checklists. Quien la tenía los conserva.
  transito_autorizar: 'firmar_supervision',
  transito_aprobar_cierre: 'firmar_supervision',
  // Editar CEDIS bastaba con poder entrar a Configuración.
  config_transito: 'mod_configuracion',
  // Las claves y la bitácora de accesos eran cosa de quien entraba a
  // Configuración. Quien la tenía las conserva; a Hector se le da aparte.
  claves_liberar: 'mod_configuracion',
  accesos_reportes: 'mod_configuracion',
  config_resguardo: 'mod_configuracion',
  reabrir_cerrados: 'mod_configuracion',
  // Los papeles de las unidades ya los cargaba alguien en Logística: en la
  // Bahía son los mismos papeles, así que quien los cargaba los sigue viendo,
  // cargando y corrigiendo. Lo del personal no se hereda de nada: nace cerrado.
  bahia_unidades_ver: 'logistica_documentos',
  bahia_unidades_cargar: 'logistica_documentos',
  bahia_unidades_editar: 'logistica_documentos',
  bahia_retirar: 'logistica_corregir',
  // Producción se partió al publicar la ODT: quien capturaba ahí anota lo que
  // arma, pide modificaciones y ve el avance; quien cargaba la ODT aprueba las
  // modificaciones. De ahí en adelante se reparten aparte.
  produccion_armar: 'produccion_capturar',
  produccion_modificacion_pedir: 'produccion_capturar',
  produccion_avance: 'produccion_capturar',
  produccion_modificacion_aprobar: 'produccion_odt_cargar',
  // Armar lo hace Almacén, no quien vende: se hereda de quien cerraba esas
  // entregas (los Team Leaders), y el puesto «Ventas directas» no lo trae.
  ventas_fuera_armar: 'ventas_fuera_autorizar',
  // La cartera la cuida quien cerraba las órdenes (el encargado).
  ventas_fuera_clientes: 'ventas_fuera_autorizar',
  // Quien entrega el paquete y trae el dinero es quien ya lleva material a la
  // calle: el que carga los traspasos. Se puede cambiar persona por persona.
  ventas_fuera_cobrar: 'traspasos_cargar',
  // Los retiros salieron de las entradas: eran el mismo documento con otra
  // fuente. Quien capturaba entradas carga retiros; quien las aprobaba los
  // cierra. Un retiro ya no suma por sí mismo —lo que suma es el re-ingreso que
  // levanta Calidad—, así que la aprobación que movía inventario se mudó ahí.
  retiros_capturar: 'entradas_capturar',
  retiros_cerrar: 'entradas_aprobar',
  reingresos_aprobar: 'entradas_aprobar',
  // Pedir el re-ingreso es trabajo de quien captura en Calidad, igual que el
  // muestreo: es la misma persona recibiendo el mismo camión.
  reingresos_capturar: 'calidad_capturar',
  calidad_salida_pedir: 'calidad_capturar',
  // Una salida por calidad es una salida: la aprueba quien aprueba salidas.
  calidad_salida_aprobar: 'salidas_aprobar',
};

function derivarPermisosNuevos() {
  // En los perfiles: si el perfil traía al padre, trae al hijo.
  for (const perfil of Object.values(PERMISOS)) {
    for (const [hijo, padre] of Object.entries(PERMISOS_DERIVADOS)) {
      if (perfil[padre] && !(hijo in perfil)) perfil[hijo] = true;
    }
  }

  // En los ajustes de cada persona: lo mismo, respetando un «no» explícito. Si
  // el Administrador le había QUITADO el padre a alguien, el hijo también nace
  // quitado; nadie recupera por la puerta de atrás algo que ya se le había ido.
  for (const u of db.prepare('SELECT id, permisos_extra FROM usuarios').all()) {
    let datos;
    try { datos = JSON.parse(u.permisos_extra || '{}'); } catch { continue; }
    if (Array.isArray(datos)) datos = Object.fromEntries(datos.map((k) => [k, true]));

    let tocado = false;
    for (const [hijo, padre] of Object.entries(PERMISOS_DERIVADOS)) {
      if (padre in datos && !(hijo in datos)) { datos[hijo] = datos[padre]; tocado = true; }
    }
    if (tocado) {
      db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?')
        .run(JSON.stringify(datos), u.id);
    }
  }
}

derivarPermisosNuevos();

// Un permiso compartido aparece en dos módulos con etiquetas distintas. Para el
// resumen de cada persona vale la primera: la del módulo donde nació.
const ETIQUETA_DE_PERMISO = {};
for (const grupo of CATALOGO_PERMISOS) {
  for (const p of grupo.permisos) {
    if (!(p.clave in ETIQUETA_DE_PERMISO)) ETIQUETA_DE_PERMISO[p.clave] = p.etiqueta;
  }
}

// Ver información de toda la operación obliga a tener clave, venga del perfil o
// de un permiso individual.
// Los cuatro que trae el formato en papel. Se guardan como fracción para que un
// reporte pueda sumarlos o compararlos, y se leen como la aguja.
const NIVELES_TANQUE = [
  { valor: '1/4', etiqueta: '¼' },
  { valor: '1/2', etiqueta: '½' },
  { valor: '3/4', etiqueta: '¾' },
  { valor: 'lleno', etiqueta: 'Lleno' },
];

const PERMISOS_SENSIBLES = [
  'reportes', 'comparativa', 'configuracion', 'mod_configuracion', 'claves_liberar',
  // Los papeles del personal son su INE, su domicilio, su contrato; su ficha
  // trae su tipo de sangre. Son datos personales: quien pueda verlos de todos
  // tiene que tener clave.
  'bahia_personal_ver', 'bahia_emergencia', 'bahia_reportes',
  'calidad_reportes', 'calidad_aprobar',
  'produccion_reportes', 'almacen_reportes', 'ventas_fuera_reportes',
  'incidencias_reportes', 'transito_reportes', 'logistica_reportes',
];

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
  const p = puestoDe(rol) || puestoDe('operador') || { etiqueta: rol, permisos: {} };
  return { ...p.permisos, etiqueta: p.etiqueta, descripcion: p.descripcion, ...leerAjustes(permisosExtra) };
}

// ------------------------------------------------------------------ puestos
//
// Un puesto es la base de permisos de quien lo ocupa; los ajustes por persona
// van encima. Los puestos nacieron de PERMISOS (arriba) y desde entonces viven
// en la tabla `puestos`: el Administrador crea puestos nuevos, les cambia lo que
// traen por módulo y los retira, sin tocar código.
//
// El de Administrador es especial: puede TODO por el cargo (ver `puede`), así que
// su lista no se edita ni se usa para decidir nada.
const PUESTO_ADMIN = 'admin';

function leerPuesto(f) {
  if (!f) return null;
  let permisos = {};
  try { permisos = JSON.parse(f.permisos || '{}'); } catch { /* queda vacío */ }
  return { ...f, permisos };
}

const puestoDe = (clave) => leerPuesto(db.prepare('SELECT * FROM puestos WHERE clave = ?').get(clave));
const listaPuestos = () => db.prepare('SELECT * FROM puestos ORDER BY activo DESC, orden, etiqueta').all().map(leerPuesto);

// Lo que trae un puesto, escrito completo: todos los permisos del catálogo con su
// sí o su no. Guardarlo completo es lo que deja reconocer, más adelante, cuál
// permiso es nuevo.
function permisosCompletos(mapa) {
  const out = {};
  for (const k of PERMISOS_VALIDOS) out[k] = !!mapa[k];
  // Los que no se reparten sueltos pero sí van con un puesto (p. ej. Configuración).
  for (const [k, v] of Object.entries(mapa)) if (!(k in out) && typeof v === 'boolean') out[k] = v;
  return out;
}

function sembrarPuestos() {
  const hay = db.prepare('SELECT COUNT(*) AS n FROM puestos').get().n;
  if (hay) return;
  const orden = { operador: 1, team_leader: 2, ventas_fuera: 3, admin: 99 };
  const insertar = db.prepare(`
    INSERT INTO puestos (clave, etiqueta, descripcion, permisos, orden, creado_en)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const [clave, p] of Object.entries(PERMISOS)) {
    const { etiqueta, descripcion, ...resto } = p;
    insertar.run(clave, etiqueta, descripcion || null, JSON.stringify(permisosCompletos(resto)),
      orden[clave] ?? 50, new Date().toISOString());
  }
}

// La misma regla de PERMISOS_DERIVADOS, ahora sobre los puestos guardados: un
// permiso que el puesto nunca había visto hereda lo que traía su padre.
function derivarEnPuestos() {
  const guardar = db.prepare('UPDATE puestos SET permisos = ? WHERE clave = ?');
  for (const p of listaPuestos()) {
    let tocado = false;
    for (const [hijo, padre] of Object.entries(PERMISOS_DERIVADOS)) {
      if (!(hijo in p.permisos) && padre in p.permisos) { p.permisos[hijo] = p.permisos[padre]; tocado = true; }
    }
    if (tocado) guardar.run(JSON.stringify(p.permisos), p.clave);
  }
}

// La clave interna de un puesto nuevo sale de su nombre: «Jefe de turno» →
// jefe_de_turno. Nunca se muestra; solo tiene que ser única y no cambiar.
function claveDePuesto(nombre) {
  const baseClave = String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'puesto';
  let clave = baseClave;
  for (let i = 2; puestoDe(clave); i += 1) clave = `${baseClave}_${i}`;
  return clave;
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
    // Checklists dejó de ser un módulo del menú (2-oct-2026, decisión de
    // Ronaldo): las inspecciones son de las unidades, y las unidades viven en
    // Logística. Verlas en dos lugares era tener dos puertas a lo mismo.
    //
    // El renglón se queda —`oculto`— porque el módulo sigue existiendo por
    // dentro: su permiso, su pantalla de acceso y sus direcciones viejas. Lo
    // único que cambia es que ya no se ofrece por su cuenta.
    clave: 'checklists',
    nombre: 'Checklists',
    descripcion: 'Inspección de unidades, montacargas e insumos',
    permiso: 'mod_checklists',
    disponible: true,
    oculto: true,
    icono: 'checklist',
  },
  {
    clave: 'produccion',
    nombre: 'Producción',
    descripcion: 'La ODT de la semana y si el material alcanza',
    permiso: 'mod_produccion',
    disponible: true,
    icono: 'produccion',
  },
  {
    clave: 'calidad',
    nombre: 'Calidad',
    descripcion: 'Muestreo, re-ingreso de retiros y bajas por daño',
    permiso: 'mod_calidad',
    disponible: true,
    icono: 'calidad',
  },
  {
    // Tránsito dejó de ser un módulo del menú (23-oct-2026, decisión de
    // Ronaldo): lo que hace es sacar unidades, y las unidades viven en
    // Logística. El renglón se queda —`oculto`— porque el módulo sigue
    // existiendo por dentro: su permiso, sus pantallas y sus direcciones.
    clave: 'transito',
    nombre: 'Tránsito',
    descripcion: 'Salidas de unidad: el formato de asignación e inspección',
    permiso: 'mod_transito',
    disponible: true,
    oculto: true,
    icono: 'transito',
  },
  {
    // Las unidades tenían su checklist y nada más. Logística es donde la unidad
    // completa vive: su checklist, su gasolina, sus papeles y cómo se comporta.
    clave: 'logistica',
    nombre: 'Logística',
    descripcion: 'Unidades: checklists, gasolina, papeles y desempeño',
    permiso: 'mod_logistica',
    disponible: true,
    icono: 'volante',
  },
  {
    // La Bahía digital: los papeles. Nace cerrada —solo el Administrador— y de
    // ahí se reparte: quién ve los de las unidades, quién los de todo el
    // personal, y cada quien los suyos.
    clave: 'bahia',
    nombre: 'Bahía digital',
    descripcion: 'Los papeles de las unidades y del personal, con sus vencimientos',
    permiso: 'mod_bahia',
    disponible: true,
    icono: 'carpeta',
    restringido: true,
  },
  {
    clave: 'ventas_fuera',
    nombre: 'Ventas directas',
    descripcion: 'Órdenes de venta directa, sus cajas y sus guías',
    permiso: 'mod_ventas_fuera',
    disponible: true,
    icono: 'camion',
  },
  {
    clave: 'almacen',
    nombre: 'Almacén',
    descripcion: 'Existencias, entradas, retiros, salidas y conteos',
    permiso: 'mod_almacen',
    disponible: true,
    icono: 'cajas',
  },
  {
    clave: 'notificaciones',
    nombre: 'Notificaciones',
    descripcion: 'Lo que está esperando tu aprobación',
    permiso: 'mod_notificaciones',
    disponible: true,
    icono: 'campana',
  },
  {
    clave: 'incidencias',
    nombre: 'Incidencias',
    descripcion: 'La hoja del personal: qué se anotó y a quién',
    permiso: 'mod_incidencias',
    disponible: true,
    icono: 'alerta',
  },
  {
    // Los reportes ya no cuelgan de cada módulo: se juntan aquí. Quien revisa
    // la operación entra a un solo lugar en vez de recorrer módulo por módulo,
    // y las comparativas —que miran varias semanas a la vez— tienen dónde vivir.
    clave: 'reportes',
    nombre: 'Reportes',
    descripcion: 'Todos los reportes y las comparativas, en un solo lugar',
    permiso: 'mod_reportes',
    disponible: true,
    icono: 'grafica',
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

// Lo que ofrece el módulo de Reportes. Cada renglón es un reporte de algún
// módulo, con el permiso que hay que tener para verlo. Agregar el reporte de un
// módulo nuevo es un renglón aquí, igual que agregar un módulo es uno en
// MODULOS: nadie tiene que acordarse de tocar la pantalla.
//
// 'periodo' distingue las dos maneras de mirar: una foto de cómo está la
// operación hoy, o la comparación de varias semanas para ver hacia dónde va.
const REPORTES = [
  {
    clave: 'checklists',
    nombre: 'Checklists',
    descripcion: 'Vigencias por vencer, problemas detectados e historial de lo capturado',
    modulo: 'Checklists',
    permiso: 'reportes',
    periodo: 'hoy',
    destino: '#/reportes/checklists',
    disponible: true,
  },
  {
    clave: 'comparativa',
    nombre: 'Comparativa entre semanas',
    descripcion: 'Varias semanas lado a lado: qué unidad mejora y cuál se repite',
    modulo: 'Checklists',
    permiso: 'comparativa',
    periodo: 'tiempo',
    destino: '#/reportes/comparativa',
    disponible: true,
  },
  {
    clave: 'logistica',
    nombre: 'Logística',
    descripcion: 'Gasolina y rendimiento por unidad, costo por kilómetro, servicios y papeles por vencer',
    modulo: 'Logística',
    permiso: 'logistica_reportes',
    periodo: 'tiempo',
    destino: '#/logistica/desempeno',
    disponible: true,
  },
  {
    clave: 'calidad',
    nombre: 'Calidad',
    descripcion: 'Muestreos, lotes rechazados y en qué terminó cada uno',
    modulo: 'Calidad',
    permiso: 'calidad_reportes',
    periodo: 'hoy',
    destino: '#/reportes/calidad',
    disponible: true,
  },
  {
    clave: 'produccion',
    nombre: 'Producción',
    descripcion: 'Avance de cada ODT, cumplimiento por envío y métricas de cada persona',
    modulo: 'Producción',
    permiso: 'produccion_reportes',
    periodo: 'tiempo',
    destino: '#/reportes/produccion',
    disponible: true,
  },
  {
    clave: 'almacen',
    nombre: 'Almacén',
    descripcion: 'Existencias, movimientos semana a semana y exactitud de los conteos',
    modulo: 'Almacén',
    permiso: 'almacen_reportes',
    periodo: 'tiempo',
    destino: '#/reportes/almacen',
    disponible: true,
  },
  {
    clave: 'transito',
    nombre: 'Tránsito',
    descripcion: 'Envíos por día y lugar de entrega, tiempo en ruta, quién autorizó y los traspasos movidos',
    modulo: 'Tránsito',
    permiso: 'transito_reportes',
    periodo: 'tiempo',
    destino: '#/reportes/transito',
    disponible: true,
  },
  {
    clave: 'ventas_fuera',
    nombre: 'Ventas directas',
    descripcion: 'Órdenes por cliente, tiempos de cada paso, cajas y peso, y diferencias contra lo que salió',
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_reportes',
    periodo: 'tiempo',
    destino: '#/reportes/ventas-fuera',
    disponible: true,
  },
  {
    clave: 'bahia',
    nombre: 'Bahía digital',
    descripcion: 'Papeles de unidades y de personal: los que vencen, los que faltan y quién los cargó',
    modulo: 'Bahía digital',
    permiso: 'bahia_reportes',
    periodo: 'hoy',
    destino: '#/reportes/bahia',
    disponible: true,
  },
  {
    clave: 'resguardo',
    nombre: 'Resguardo de auditoría',
    descripcion: `Qué hay guardado año por año, hasta cuándo se resguarda y el paquete para entregarle al auditor`,
    modulo: 'Configuración',
    permiso: 'config_resguardo',
    periodo: 'tiempo',
    destino: '#/resguardo',
    disponible: true,
  },
  {
    clave: 'accesos',
    nombre: 'Accesos y bloqueos',
    descripcion: 'Quién entró y cuándo, los intentos fallidos, las claves bloqueadas y quién las liberó',
    modulo: 'Configuración',
    permiso: 'accesos_reportes',
    periodo: 'tiempo',
    destino: '#/reportes/accesos',
    disponible: true,
  },
  {
    clave: 'incidencias',
    nombre: 'Incidencias',
    descripcion: 'El corte del mes que afecta los bonos, y quién se repite mes con mes',
    modulo: 'Incidencias',
    permiso: 'incidencias_reportes',
    periodo: 'tiempo',
    destino: '#/reportes/incidencias',
    disponible: true,
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
// El Administrador puede TODO. No se le reparte permiso por permiso: los tiene
// por el cargo. Así, cada acción nueva que se agregue al sistema le queda
// disponible desde el primer día, sin que haya que acordarse de otorgársela —que
// era la manera más fácil de que él mismo se quedara fuera de su propio sistema.
const puede = (usuario, permiso) => !!(usuario
  && (usuario.rol === 'admin' || (usuario.permisos && usuario.permisos[permiso])));

const PUERTO = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

sembrar();
sembrarPuestos();
derivarEnPuestos();

// ============================================================ modo de pruebas
//
// Se prende desde Configuración → Modo de pruebas. Al prenderlo se saca una
// COPIA de la base real (datos/pruebas/) y desde ese momento quien tenga el
// permiso puede entrar al sistema «como» cualquier puesto o persona: su menú,
// sus botones, sus avisos. Todo lo que haga en ese rato cae en la copia:
//
//   · las reglas de día se suspenden (checklists de viernes, quitar lo anotado);
//   · nada de lo capturado toca el inventario, los reportes ni los avisos reales;
//   · al apagarlo, la copia se tira completa. No hay que ir a Limpieza.
//
// La gente que sigue trabajando de verdad no se entera: su sesión no está en
// prueba y sigue hablando con la base real.
const CARPETA_PRUEBAS = path.join(DATA_DIR, 'pruebas');
const ARCHIVO_PRUEBAS = path.join(CARPETA_PRUEBAS, 'checklists.db');
const FOTOS_PRUEBAS = path.join(CARPETA_PRUEBAS, 'fotos');
let basePruebas = null;

function ajusteReal(clave) {
  return dbReal.prepare(`
    SELECT a.valor, a.cambiado_en, u.nombre AS cambiado_por
      FROM ajustes_sistema a LEFT JOIN usuarios u ON u.id = a.cambiado_por
     WHERE a.clave = ?`).get(clave);
}

function guardarAjusteReal(clave, valor, usuarioId) {
  dbReal.prepare(`
    INSERT INTO ajustes_sistema (clave, valor, cambiado_por, cambiado_en)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor,
      cambiado_por = excluded.cambiado_por, cambiado_en = excluded.cambiado_en
  `).run(clave, valor, usuarioId, new Date().toISOString());
}

// Se lee SIEMPRE de la base real: el interruptor es de la operación, no de la
// copia. (La clave conserva su nombre viejo de cuando vivía en Checklists.)
function modoPruebas() {
  const f = ajusteReal('modo_pruebas_checklists');
  const copia = ajusteReal('modo_pruebas_copia');
  return {
    activo: !!(f && f.valor === '1'),
    desde: f ? f.cambiado_en : null,
    por: f ? f.cambiado_por : null,
    copia_en: copia ? copia.cambiado_en : null,
  };
}

// ¿Esta petición va sobre la copia de pruebas?
const enPrueba = () => {
  const c = contexto.getStore();
  return !!(c && c.prueba);
};

// Deja una base al día: la usa la copia al abrirse, por si la plataforma se
// actualizó mientras estaba prendida.
function alistarBase() {
  prepararBase();
  sembrar();
  renombrarPermisosViejos();
  derivarPermisosNuevos();
  sembrarPuestos();
  derivarEnPuestos();
}

function copiarBaseReal(usuarioId) {
  if (basePruebas) { try { basePruebas.close(); } catch { /* ya cerrada */ } basePruebas = null; }
  fs.rmSync(CARPETA_PRUEBAS, { recursive: true, force: true });
  fs.mkdirSync(FOTOS_PRUEBAS, { recursive: true });
  const destino = ARCHIVO_PRUEBAS.split(path.sep).join('/').replace(/'/g, "''");
  dbReal.exec(`VACUUM INTO '${destino}'`);
  guardarAjusteReal('modo_pruebas_copia', '1', usuarioId || null);
}

function abrirBasePruebas() {
  if (basePruebas) return basePruebas;
  if (!fs.existsSync(ARCHIVO_PRUEBAS)) copiarBaseReal(null);
  fs.mkdirSync(FOTOS_PRUEBAS, { recursive: true });
  basePruebas = new DatabaseSync(ARCHIVO_PRUEBAS);
  basePruebas.exec('PRAGMA journal_mode = WAL');
  basePruebas.exec('PRAGMA foreign_keys = ON');
  contexto.run({ db: basePruebas, fotos: FOTOS_PRUEBAS }, alistarBase);
  return basePruebas;
}

// Quien estaba probando regresa a su sesión real.
function sacarATodosDePrueba() {
  for (const sesion of sesiones.values()) delete sesion.prueba;
}

function tirarBasePruebas() {
  sacarATodosDePrueba();
  if (basePruebas) { try { basePruebas.close(); } catch { /* ya cerrada */ } basePruebas = null; }
  fs.rmSync(CARPETA_PRUEBAS, { recursive: true, force: true });
}

if (modoPruebas().activo) abrirBasePruebas();

// Dónde van las fotos: en prueba, a la carpeta de la copia. Así borrar un
// documento de prueba nunca borra la foto de un documento real.
const carpetaFotos = () => {
  const c = contexto.getStore();
  return (c && c.fotos) || FOTOS_DIR;
};

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

const esViernesHoy = () => new Date().getDay() === 5;

// Un checklist de viernes no se abre otro día. Estaba solo como bandera para
// atenuar la tarjeta en pantalla, pero eso no impide nada a quien llame la API
// directamente o llegue con una dirección guardada.
//
// El Administrador sí lo abre cualquier día: puede hacer todo, y es quien prueba
// y corrige los checklists. Esperar al viernes para probar un cambio de un martes
// era perder la semana. Para los demás la regla sigue igual.
function fueraDeSuDia(plantilla, usuario) {
  if (usuario && usuario.rol === 'admin') return false;
  // En la copia de pruebas no hay reglas de día.
  if (enPrueba()) return false;
  return plantilla.frecuencia === 'viernes' && !esViernesHoy();
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

function sesionDe(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const s = sesiones.get(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesiones.delete(token); return null; }
  return s;
}

// Quien está probando es, para todo el sistema, la persona como la que entró.
function leerSesion(req) {
  const s = sesionDe(req);
  if (!s) return null;
  if (enPrueba() && s.prueba) return s.prueba.usuario;
  return s.usuario;
}

// Cierra las sesiones de ciertas personas para que vuelvan a entrar con sus
// permisos nuevos. En la copia de pruebas no se toca a nadie de verdad.
function cerrarSesionesDe(esDeEllas) {
  if (enPrueba()) return;
  for (const [token, sesion] of sesiones) {
    if (esDeEllas(sesion.usuario.id)) sesiones.delete(token);
  }
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
// preparación que se revisa cambia según sea Cita en CEDIS o Venta directa.
// Un área puede aplicar a un solo valor de la cabecera ({campo, valor}) o a
// varios ({campo, en: [...]}). Lo segundo nació con el formato vehicular: la
// inspección de la unidad es la misma salga a donde salga, y repetirla cuatro
// veces habría sido cuatro lugares donde corregir la misma pregunta.
// Todo lo que vale un campo de cabecera: el principal y los demás, cuando el
// campo admite varios. En el formato vehicular, «tipo» dice a qué sale la
// unidad y «tipos_extra» qué más hace en el mismo viaje; para decidir qué se
// pregunta, los seis cuentan igual.
function valoresDeCampo(datos, campo) {
  const d = datos || {};
  const extra = String(d[`${campo}s_extra`] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return [String(d[campo] ?? '').trim(), ...extra].filter(Boolean);
}

function seccionAplica(seccion, datos) {
  if (!seccion.condicion) return true;
  try {
    const c = JSON.parse(seccion.condicion);
    // Si la unidad hace tres cosas, se preguntan las tres: las áreas de CEDIS y
    // las de ventas directas caben en el mismo formato.
    const valores = valoresDeCampo(datos, c.campo);
    return Array.isArray(c.en)
      ? valores.some((v) => c.en.includes(v))
      : valores.includes(c.valor);
  } catch {
    return true;
  }
}

// Un campo de cabecera se pregunta si aplica a CUALQUIERA de los propósitos: si
// la unidad va al CEDIS y además trae un traspaso, se piden el CEDIS y la
// bodega de origen.
const campoAplicaA = (campo, datos) => !campo.solo
  || valoresDeCampo(datos, campo.segun).some((v) => campo.solo.includes(v));

// Qué está mal en lo que llegó para un campo, si algo. Un campo de varios
// valores se revisa uno por uno, y no admite repetir el propósito principal:
// «CEDIS y además CEDIS» no quiere decir nada.
function valorMaloDelCampo(campo, valor, datos) {
  if (!valor || !campo.opciones) return null;
  const piezas = campo.multi
    ? valor.split(',').map((x) => x.trim()).filter(Boolean)
    : [valor];
  for (const pieza of piezas) {
    if (!campo.opciones.some((o) => o.valor === pieza)) {
      return `«${campo.etiqueta}» no tiene ese valor.`;
    }
  }
  if (campo.multi) {
    const principal = String((datos || {})[campo.segun] ?? '').trim();
    if (piezas.includes(principal)) {
      const etiqueta = (campo.opciones.find((o) => o.valor === principal) || {}).etiqueta || principal;
      return `«${etiqueta}» ya es a lo que sale la unidad: no hace falta marcarlo otra vez.`;
    }
    if (new Set(piezas).size !== piezas.length) {
      return `No repitas lo mismo en «${campo.etiqueta}».`;
    }
  }
  return null;
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
    campos: camposDe(plantilla),
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

// Los campos de cabecera de una plantilla. Un campo con catálogo no trae sus
// opciones escritas: salen de la lista vigente (los CEDIS de Tránsito los edita
// el Administrador), así que se completan al momento de pedirlos.
function camposDe(plantilla) {
  return JSON.parse(plantilla.campos || '[]').map((c) => {
    if (c.catalogo === 'cedis') {
      return {
        ...c,
        opciones: db.prepare('SELECT nombre FROM transito_cedis WHERE activo = 1 ORDER BY orden, id').all()
          .map((f) => ({ valor: f.nombre, etiqueta: f.nombre })),
      };
    }
    // La unidad que sale. Se guarda su clave, que es la que no cambia, y de ahí
    // el formato queda amarrado a su ficha de Logística.
    if (c.catalogo === 'unidades') {
      return {
        ...c,
        opciones: db.prepare('SELECT clave, nombre FROM activos WHERE activo = 1 ORDER BY nombre').all()
          .map((a) => ({ valor: a.clave, etiqueta: a.nombre })),
      };
    }
    // De qué bodega se trae el material en un traspaso. Se guarda la clave
    // (B1, B2), que es la que no cambia aunque la bodega se renombre.
    if (c.catalogo === 'bodegas') {
      return {
        ...c,
        opciones: bodegasActivas().map((b) => ({ valor: b.clave, etiqueta: `${b.nombre} (${b.clave})` })),
      };
    }
    if (c.catalogo === 'telefonos') {
      return {
        ...c,
        opciones: db.prepare(`
          SELECT equipo, alias, marca, modelo, numero, telefonia FROM telefonos_corporativos
           WHERE activo = 1 ORDER BY orden, alias, marca, modelo
        `).all().map((t) => {
          const nombre = [t.marca, t.modelo].filter(Boolean).join(' ') || t.equipo;
          // Se escoge por el alias y el número: así se pide el equipo en el
          // patio. La marca y el modelo quedan para el que no tiene alias
          // todavía —los que se dieron de alta antes de que existiera—.
          return {
            valor: t.numero || nombre,
            etiqueta: t.alias
              ? [t.alias, t.numero].filter(Boolean).join(' · ')
              : [nombre, t.numero, t.telefonia].filter(Boolean).join(' · '),
          };
        }),
      };
    }
    // El número de envío de Tránsito es el folio de la cita en la ODT: se
    // sugieren las citas cercanas para que se escoja en vez de teclearlo, y con
    // eso el envío queda amarrado a lo que Producción armó para él.
    if (c.clave === 'numero_envio') return { ...c, sugerencias: citasCercanas() };
    return c;
  });
}

// --------------------------------------------- Tránsito ↔ Producción
//
// No hay columna que los una: el lazo es el número. El «número de envío» que
// Tránsito anota es el mismo folio que trae la cita en la ODT (#73880887). Se
// comparan solo los dígitos, para que «#7388 0087» y «73880087» sean el mismo.
const soloDigitos = (x) => String(x || '').replace(/\D/g, '');

function citasCercanas() {
  const desde = hoyISO(new Date(Date.now() - 7 * 864e5));
  const hasta = hoyISO(new Date(Date.now() + 14 * 864e5));
  return db.prepare(`
    SELECT c.folio, c.cedis, c.fecha, c.etiqueta
      FROM almacen_odt_citas c JOIN almacen_odt o ON o.id = c.odt_id
     WHERE c.folio IS NOT NULL AND c.fecha BETWEEN ? AND ?
     ORDER BY c.fecha, c.orden
  `).all(desde, hasta).map((c) => ({
    valor: soloDigitos(c.folio), cedis: c.cedis,
    etiqueta: `${c.etiqueta || c.fecha} · ${c.cedis}`,
  }));
}

// Los envíos de Tránsito por número: {dígitos → llenado}. Si hay varios con el
// mismo número (uno se canceló y se volvió a abrir), manda el más reciente.
function enviosTransitoPorNumero() {
  const mapa = new Map();
  for (const l of db.prepare(`
    SELECT l.id, l.estado, l.revision, l.referencia, l.creado_en
      FROM llenados l JOIN plantillas p ON p.id = l.plantilla_id
     WHERE p.clave = 'transito' AND l.referencia IS NOT NULL
     ORDER BY l.id
  `).all()) {
    const d = soloDigitos(l.referencia);
    if (d.length >= 4) mapa.set(d, l);
  }
  return mapa;
}

// La cita de la ODT que corresponde a un número de envío, con su avance.
function envioDeODT(numero) {
  const d = soloDigitos(numero);
  if (d.length < 4) return null;
  const cita = db.prepare(`
    SELECT c.id, c.odt_id, c.folio FROM almacen_odt_citas c JOIN almacen_odt o ON o.id = c.odt_id
     ORDER BY o.semana DESC, c.id DESC
  `).all().find((c) => soloDigitos(c.folio) === d);
  if (!cita) return null;
  const odt = db.prepare('SELECT id, semana, publicada_en FROM almacen_odt WHERE id = ?').get(cita.odt_id);
  const envio = tableroODT(cita.odt_id).envios.find((e) => e.id === cita.id);
  return envio && { ...envio, odt_id: odt.id, semana: odt.semana, publicada: !!odt.publicada_en };
}


// A qué puede condicionarse un área: a las respuestas fijas de la cabecera
// (en Tránsito, envío o colecta). Un catálogo editable no cuenta.
function condicionesDe(plantilla) {
  return camposDe(plantilla)
    // Un campo de varios valores no es una condición: lo que condiciona al área
    // es a qué sale la unidad, y los demás propósitos se suman solos.
    .filter((c) => c.opciones && !c.catalogo && !c.multi)
    .flatMap((c) => [
      // Los grupos van primero: «todas las salidas de unidad» antes que cada
      // tipo suelto, porque es lo que se escoge más seguido.
      ...(c.grupos || []).map((g) => ({ campo: c.clave, valor: g.valor, etiqueta: g.etiqueta, en: g.en })),
      ...c.opciones.map((o) => ({ campo: c.clave, valor: o.valor, etiqueta: o.etiqueta })),
    ]);
}

// Lo que está esperando que alguien lo revise no se toca: el Team Leader tiene
// que estar viendo exactamente lo que le mandaron. Se modifica cuando lo regresa.
function bloqueoPorRevision(llenadoId) {
  const l = db.prepare('SELECT estado, revision FROM llenados WHERE id = ?').get(llenadoId);
  if (!l) return null;
  if (l.revision === 'por_autorizar') return 'Está enviado a autorización: no se modifica hasta que lo autoricen o lo regresen.';
  if (l.revision === 'por_aprobar' && l.estado !== 'cerrado') {
    return 'Está enviado a aprobación de cierre: no se modifica hasta que lo aprueben o lo regresen.';
  }
  return null;
}

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

// Se prepara en cada llamada, no una vez al arrancar: una consulta preparada
// queda amarrada a la base en la que nació, y en modo de pruebas la base cambia.
const etapaDelItem = (itemId) => (db.prepare(`
  SELECT s.etapa FROM items i JOIN secciones s ON s.id = i.seccion_id WHERE i.id = ?
`).get(itemId) || {}).etapa || 'salida';

// Comprueba lo que exige una etapa concreta: ítems contestados, problemas
// explicados y con foto, y documentos adjuntos.
function faltantesDeEtapa(llenadoId, plantilla, etapa, datos = {}) {
  const filtroEtapa = plantilla.por_etapas ? 'AND s.etapa = ?' : '';
  const args = plantilla.por_etapas ? [plantilla.id, etapa] : [plantilla.id];

  const items = db.prepare(`
    SELECT i.id, i.texto, i.tipo_respuesta, i.meta, s.condicion
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
      if (!conFoto.has(item.id)) faltas.push({ tipo: 'documento', texto: item.texto, item_id: item.id });
      continue;
    }
    const r = respuestas.get(item.id);
    let meta = {};
    try { meta = JSON.parse(item.meta || '{}'); } catch { meta = {}; }
    // El dinero de la unidad se captura siempre, y siempre con la foto del efectivo.
    if (item.tipo_respuesta === 'dinero') {
      const monto = r && r.valor !== null && r.valor !== '' ? Number(r.valor) : NaN;
      if (!Number.isFinite(monto) || monto < 0) faltas.push({ tipo: 'dinero', texto: item.texto, item_id: item.id });
      else if (!conFoto.has(item.id)) faltas.push({ tipo: 'foto', texto: item.texto, item_id: item.id });
      continue;
    }
    // El kilometraje —o el horómetro— se anota con su foto del tablero: es de
    // donde sale el rendimiento de la unidad, y un número sin foto no se audita.
    if (item.tipo_respuesta === 'medidor') {
      const lectura = r && r.valor !== null && r.valor !== '' ? Number(r.valor) : NaN;
      if (!Number.isFinite(lectura) || lectura < 0) faltas.push({ tipo: 'medidor', texto: item.texto, item_id: item.id });
      else if (!conFoto.has(item.id)) faltas.push({ tipo: 'foto', texto: item.texto, item_id: item.id });
      continue;
    }
    // Un vencimiento obligatorio —tarjeta, póliza, fumigación— no se deja vacío.
    if (item.tipo_respuesta === 'fecha' && meta.obligatoria && (!r || !r.valor)) {
      faltas.push({ tipo: 'fecha', texto: item.texto, item_id: item.id });
      continue;
    }
    // Lo que se escribe —proveedor, placas, chofer— y la hora de arribo no se dejan vacíos.
    // El nivel del tanque tiene que ser uno de los cuatro de la aguja: media
    // frase escrita a mano no se puede comparar entre la salida y el regreso.
    if (item.tipo_respuesta === 'nivel') {
      if (!r || !NIVELES_TANQUE.some((n) => n.valor === r.valor)) {
        faltas.push({ tipo: 'nivel', texto: item.texto, item_id: item.id });
      }
      continue;
    }
    if (item.tipo_respuesta === 'texto' || item.tipo_respuesta === 'hora') {
      const v = r && r.valor ? String(r.valor).trim() : '';
      if (!v || (item.tipo_respuesta === 'hora' && !/^\d{2}:\d{2}$/.test(v))) {
        faltas.push({ tipo: item.tipo_respuesta, texto: item.texto, item_id: item.id });
      }
      continue;
    }
    // Nada se cierra con preguntas en blanco. Antes esto solo se exigía en
    // Tránsito y en el resto una pregunta sin contestar pasaba de largo: un
    // checklist aprobado podía tener la mitad sin revisar, y el reporte lo
    // contaba como bueno. Lo pidió Ronaldo el 1-oct-2026 y es lo correcto: una
    // revisión a medias no es una revisión.
    if (!r || r.valor === null || r.valor === '') {
      faltas.push({ tipo: 'sin_contestar', texto: item.texto, item_id: item.id });
      continue;
    }
    if (r.valor === 'problema' || r.valor === 'no') {
      if (!r.observacion || !r.observacion.trim()) faltas.push({ tipo: 'observacion', texto: item.texto, item_id: item.id });
      else if (plantilla.foto_obligatoria && item.tipo_respuesta === 'ok_problema' && !conFoto.has(item.id)) {
        faltas.push({ tipo: 'foto', texto: item.texto, item_id: item.id });
      }
    }
  }
  return faltas;
}

function mensajeDeFaltantes(faltas) {
  const porTipo = {
    sin_contestar: 'Falta contestar',
    texto: 'Falta capturar',
    hora: 'Falta la hora en',
    documento: 'Falta adjuntar',
    fecha: 'Falta la fecha de vencimiento de',
    dinero: 'Falta capturar el monto de',
    medidor: 'Falta la lectura de',
    nivel: 'Falta el nivel del tanque en',
    observacion: 'Falta describir el problema en',
    foto: 'Falta la foto de evidencia en',
  };
  const grupos = ['sin_contestar', 'texto', 'hora', 'documento', 'fecha', 'dinero', 'medidor', 'nivel', 'observacion', 'foto']
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

// ------------------------------------------------------------ acceso por clave

// La clave dejó de ser un candado sobre un nombre ya elegido en pantalla: ahora
// ES la identidad. De ahí las dos reglas que siguen: nadie puede repetir clave,
// y quien no tenga una no podría entrar de ninguna manera.
const limpiarClave = (v) => String(v ?? '').trim();

const personasSinClave = () => db
  .prepare('SELECT nombre FROM usuarios WHERE activo = 1 AND pin IS NULL ORDER BY nombre')
  .all().map((u) => u.nombre);

// El modo de ingreso se decide solo. Mientras quede una persona activa sin
// clave, la pantalla sigue pidiendo el nombre: cambiar antes la dejaría fuera
// del sistema sin manera de entrar a pedir ayuda.
const accesoPorClave = () => personasSinClave().length === 0;

// La comparación no distingue mayúsculas: con guantes, sobre una tablet,
// «pd2026av» y «PD2026AV» son la misma intención. Por eso la unicidad se exige
// igual —incluidas las personas de baja, que pueden reactivarse—, o dos
// personas distintas acabarían compartiendo identidad.
const usuarioPorClave = (clave) => db
  .prepare(`SELECT id, nombre, rol, pin, permisos_extra FROM usuarios
            WHERE activo = 1 AND pin IS NOT NULL AND LOWER(pin) = LOWER(?)`)
  .get(limpiarClave(clave));

const claveOcupada = (clave, exceptoId = 0) => !!db
  .prepare('SELECT id FROM usuarios WHERE pin IS NOT NULL AND LOWER(pin) = LOWER(?) AND id <> ?')
  .get(limpiarClave(clave), exceptoId);

// Sin lista de nombres en pantalla, la clave es lo único que habría que
// adivinar. A los cuatro intentos fallidos se traba el acceso, y el bloqueo NO
// se levanta solo con el tiempo: lo levanta el Administrador o Hector
// escribiendo su propia clave en la misma pantalla donde quedó trabada, para
// que nadie se quede varado esperando a que alguien llegue a una computadora.
//
// Qué se traba depende de si se sabe de quién fue el intento:
//
//   · La PERSONA, cuando sí se sabe. Pasa cuando la pantalla pide el nombre
//     antes de la clave, y cuando el Administrador bloquea a alguien a mano
//     —se fue, o su clave anda rodando—. Ese bloqueo la sigue a cualquier
//     tablet, porque es de ella y no del aparato.
//   · El APARATO, cuando no se sabe. Con la clave como identidad, una clave
//     equivocada no apunta a nadie: no hay a quién bloquear. Trabar la tablet
//     es lo único que corta el tanteo a ciegas, y se libera igual.
//
// Nada de esto defiende de un ataque serio —la tablet vive en la red del
// almacén— pero sí de que alguien se siente a probar claves.
const INTENTOS_MAX = 4;

const dispositivoDe = (req) => req.socket.remoteAddress || 'desconocido';

// Cada intento, cada bloqueo y cada liberación quedan escritos. Es el registro
// que una auditoría pide cuando pregunta quién tocó el sistema y cuándo:
// después no se puede reconstruir, así que se guarda aunque nadie lo mire.
function anotarAcceso(accion, { dispositivo = null, usuarioId = null, porId = null, nota = null } = {}) {
  db.prepare(`
    INSERT INTO accesos_bitacora (en, accion, dispositivo, usuario_id, por_id, nota)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(new Date().toISOString(), accion, dispositivo, usuarioId, porId, nota);
}

const fichaDispositivo = (d) => db
  .prepare('SELECT * FROM accesos_dispositivos WHERE dispositivo = ?').get(d);

function bloqueoDeDispositivo(dispositivo) {
  const f = fichaDispositivo(dispositivo);
  if (!f || !f.bloqueado_en) return null;
  return {
    tipo: 'dispositivo',
    dispositivo,
    desde: f.bloqueado_en,
    motivo: f.motivo || `${INTENTOS_MAX} intentos fallidos`,
  };
}

function bloqueoDePersona(id) {
  const u = db.prepare(`
    SELECT u.id, u.nombre, u.bloqueado_en, u.bloqueado_motivo, q.nombre AS bloqueo_por
      FROM usuarios u LEFT JOIN usuarios q ON q.id = u.bloqueado_por WHERE u.id = ?
  `).get(id);
  if (!u || !u.bloqueado_en) return null;
  return {
    tipo: 'persona',
    usuario_id: u.id,
    quien: u.nombre,
    desde: u.bloqueado_en,
    motivo: u.bloqueado_motivo || `${INTENTOS_MAX} intentos fallidos`,
    por: u.bloqueo_por || null,
  };
}

// Un intento fallido. Devuelve qué quedó trabado y cuántos intentos faltan, que
// es justo lo que la pantalla tiene que decir: avisar antes del último intento
// evita el bloqueo que nadie vio venir.
function anotarFallo(dispositivo, persona) {
  const ahora = new Date().toISOString();

  if (persona) {
    const fallos = (persona.fallos || 0) + 1;
    const traba = fallos >= INTENTOS_MAX;
    db.prepare(`
      UPDATE usuarios
         SET fallos = ?,
             bloqueado_en = CASE WHEN ? THEN COALESCE(bloqueado_en, ?) ELSE bloqueado_en END,
             bloqueado_motivo = CASE WHEN ? THEN COALESCE(bloqueado_motivo, ?) ELSE bloqueado_motivo END
       WHERE id = ?
    `).run(fallos, traba ? 1 : 0, ahora, traba ? 1 : 0,
      `${INTENTOS_MAX} intentos fallidos`, persona.id);
    anotarAcceso(traba ? 'bloqueo' : 'fallo',
      { dispositivo, usuarioId: persona.id, nota: `intento ${fallos} de ${INTENTOS_MAX}` });
    return {
      bloqueo: traba ? bloqueoDePersona(persona.id) : null,
      restantes: Math.max(0, INTENTOS_MAX - fallos),
    };
  }

  const anterior = fichaDispositivo(dispositivo);
  const fallos = ((anterior && anterior.fallos) || 0) + 1;
  const traba = fallos >= INTENTOS_MAX;
  db.prepare(`
    INSERT INTO accesos_dispositivos (dispositivo, fallos, ultimo_en, bloqueado_en, motivo)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (dispositivo) DO UPDATE
       SET fallos = excluded.fallos, ultimo_en = excluded.ultimo_en,
           bloqueado_en = COALESCE(accesos_dispositivos.bloqueado_en, excluded.bloqueado_en),
           motivo = COALESCE(accesos_dispositivos.motivo, excluded.motivo)
  `).run(dispositivo, fallos, ahora, traba ? ahora : null,
    traba ? `${INTENTOS_MAX} intentos fallidos` : null);
  anotarAcceso(traba ? 'bloqueo' : 'fallo',
    { dispositivo, nota: `intento ${fallos} de ${INTENTOS_MAX}` });
  return {
    bloqueo: traba ? bloqueoDeDispositivo(dispositivo) : null,
    restantes: Math.max(0, INTENTOS_MAX - fallos),
  };
}

// Entrar bien borra la cuenta: los cuatro intentos son seguidos, no de por vida.
function limpiarFallos(dispositivo, usuarioId) {
  if (usuarioId) db.prepare('UPDATE usuarios SET fallos = 0 WHERE id = ?').run(usuarioId);
  db.prepare('UPDATE accesos_dispositivos SET fallos = 0 WHERE dispositivo = ?').run(dispositivo);
}

function liberarPersona(id, porId, nota) {
  db.prepare(`
    UPDATE usuarios SET fallos = 0, bloqueado_en = NULL, bloqueado_motivo = NULL, bloqueado_por = NULL
     WHERE id = ?
  `).run(id);
  anotarAcceso('liberacion', { usuarioId: id, porId, nota });
}

function liberarDispositivo(dispositivo, porId, nota) {
  db.prepare(`
    UPDATE accesos_dispositivos SET fallos = 0, bloqueado_en = NULL, motivo = NULL
     WHERE dispositivo = ?
  `).run(dispositivo);
  anotarAcceso('liberacion', { dispositivo, porId, nota });
}

function bloquearPersona(id, porId, motivo) {
  db.prepare(`
    UPDATE usuarios SET bloqueado_en = ?, bloqueado_motivo = ?, bloqueado_por = ? WHERE id = ?
  `).run(new Date().toISOString(), motivo, porId, id);
  anotarAcceso('bloqueo', { usuarioId: id, porId, nota: motivo });
}

// El campo de liberar vive en la pantalla de acceso, sin sesión: es otra puerta
// y hay que tratarla como tal. Una clave que no puede liberar cuesta un minuto
// de espera, para que no sirva de banco de pruebas de claves.
const ESPERA_LIBERAR = 60 * 1000;
const esperasLiberar = new Map();

function segundosDeEspera(dispositivo) {
  const hasta = esperasLiberar.get(dispositivo);
  if (!hasta) return 0;
  if (Date.now() >= hasta) { esperasLiberar.delete(dispositivo); return 0; }
  return Math.ceil((hasta - Date.now()) / 1000);
}

// Cómo se cuenta un intento fallido y qué contesta la pantalla. El 423 dice
// «esto está trabado» y lleva el bloqueo dentro, para que la pantalla pueda
// ofrecer la liberación en vez de repetir «clave incorrecta» para siempre.
const avisoDeFallo = (res, resultado) => (resultado.bloqueo
  ? json(res, 423, {
    error: resultado.bloqueo.tipo === 'persona'
      ? `La clave de ${resultado.bloqueo.quien} quedó bloqueada por ${INTENTOS_MAX} intentos fallidos.`
      : `Esta tablet quedó bloqueada por ${INTENTOS_MAX} intentos fallidos.`,
    bloqueo: resultado.bloqueo,
  })
  : json(res, 401, {
    error: resultado.restantes === 1
      ? 'Clave incorrecta. Te queda 1 intento antes de que se bloquee el acceso.'
      : `Clave incorrecta. Te quedan ${resultado.restantes} intentos.`,
    restantes: resultado.restantes,
  }));

// QUÉ VERSIÓN ESTÁ CORRIENDO.
//
// Una tablet puede quedarse días con la pantalla abierta: no recarga nada, y se
// queda con la versión que cargó el día que la prendieron. Eso explica por qué
// a veces «no sirve algo que ya arreglamos». La versión es la fecha del archivo
// más nuevo de la plataforma; con ella la tablet puede darse cuenta sola de que
// se quedó atrás.
const VERSION_PLATAFORMA = (() => {
  const archivos = ['server.js', 'db.js', 'public/app.js', 'public/riel.css', 'public/index.html'];
  let ultima = 0;
  for (const a of archivos) {
    try { ultima = Math.max(ultima, fs.statSync(path.join(__dirname, a)).mtimeMs); } catch { /* no está */ }
  }
  return String(Math.round(ultima));
})();

// ¿Está de pie la plataforma? Sin sesión y sin datos: es lo único que necesita
// saber una tablet que se quedó sin conexión para enterarse de que ya volvió.
// Dice además qué versión corre, para que la tablet sepa si se quedó atrás.
ruta('GET', '/api/salud', (req, res) => {
  json(res, 200, { ok: true, ahora: new Date().toISOString(), version: VERSION_PLATAFORMA });
});

ruta('POST', '/api/entrar', (req, res, _p, cuerpo) => {
  const dispositivo = dispositivoDe(req);

  const modulo = MODULOS.find((m) => m.clave === cuerpo.modulo);
  let fila;

  if (accesoPorClave()) {
    // La tablet trabada se revisa antes de mirar la clave: mientras esté
    // trabada, la clave correcta tampoco abre.
    const trabada = bloqueoDeDispositivo(dispositivo);
    if (trabada) {
      return json(res, 423, {
        error: `Esta tablet está bloqueada por ${INTENTOS_MAX} intentos fallidos.`,
        bloqueo: trabada,
      });
    }
    fila = usuarioPorClave(cuerpo.pin);
    // Un solo mensaje para clave inexistente o equivocada: decir cuál de las dos
    // es sería ir contando qué claves existen.
    if (!fila) return avisoDeFallo(res, anotarFallo(dispositivo, null));
  } else {
    fila = db
      .prepare('SELECT id, nombre, rol, pin, permisos_extra, fallos FROM usuarios WHERE id = ? AND activo = 1')
      .get(Number(cuerpo.usuario_id));
    if (!fila) return json(res, 404, { error: 'Usuario no encontrado' });
    if (fila.pin && limpiarClave(fila.pin).toLowerCase() !== limpiarClave(cuerpo.pin).toLowerCase()) {
      // Aquí sí se sabe de quién fue el intento, así que lo que se cuenta —y lo
      // que se traba— es la persona.
      return avisoDeFallo(res, anotarFallo(dispositivo, fila));
    }
  }

  // La clave era la correcta. Si esa clave está bloqueada no entra: el bloqueo
  // es de la persona y la sigue a cualquier tablet.
  const trabado = bloqueoDePersona(fila.id);
  if (trabado) {
    anotarAcceso('rechazo', { dispositivo, usuarioId: fila.id, nota: 'clave bloqueada' });
    return json(res, 423, {
      error: `Tu clave está bloqueada: ${trabado.motivo}.`,
      bloqueo: trabado,
    });
  }

  const permisos = permisosDe(fila.rol, fila.permisos_extra);

  // Antes la lista de nombres ya venía filtrada y nadie podía escoger un módulo
  // que no le tocaba. Con la clave sola hay que decirlo aquí, y decirlo claro:
  // la clave estaba bien, lo que falta es el acceso.
  if (modulo && fila.rol !== 'admin' && !permisos[modulo.permiso]) {
    return json(res, 403, { error: `Tu clave es correcta, pero no tienes acceso a ${modulo.nombre}.` });
  }

  limpiarFallos(dispositivo, fila.id);
  anotarAcceso('entrada', {
    dispositivo, usuarioId: fila.id, nota: modulo ? modulo.nombre : null,
  });
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
  const activos = db.prepare('SELECT id, clave, nombre, tipo, imagen FROM activos WHERE activo = 1').all();
  const esViernes = esViernesHoy();
  const probando = enPrueba();

  const tarjetas = [];
  for (const p of plantillas) {
    const periodo = periodoActual(p.frecuencia);
    const campos = JSON.parse(p.campos || '[]');
    const soloViernes = p.frecuencia === 'viernes' && !esViernes;
    const disponible = !soloViernes || usuario.rol === 'admin' || probando;

    // Las plantillas con datos de cabecera son las de Tránsito, y Tránsito ya es
    // un módulo aparte con su propia pantalla. Aquí ya no aparecen: tenerlas en
    // los dos lados solo haría dudar de cuál es la buena.
    if (campos.length) continue;

    const unidades = p.aplica_a ? activos.filter((a) => a.tipo === p.aplica_a) : [null];
    for (const unidad of unidades) {
      const llenado = db
        .prepare(`SELECT id, estado, revision FROM llenados
                  WHERE plantilla_id = ? AND COALESCE(activo_id, 0) = ? AND periodo = ?`)
        .get(p.id, unidad ? unidad.id : 0, periodo);
      tarjetas.push({
        // Abierto hoy solo porque quien lo ve es el Administrador.
        fuera_de_dia: soloViernes,
        plantilla_clave: p.clave,
        plantilla_nombre: p.nombre,
        descripcion: p.descripcion,
        frecuencia: p.frecuencia,
        activo_id: unidad ? unidad.id : null,
        activo_nombre: unidad ? unidad.nombre : null,
        activo_imagen: unidad ? unidad.imagen : null,
        periodo,
        estado: llenado ? llenado.estado : 'pendiente',
        llenado_id: llenado ? llenado.id : null,
        revision: llenado ? llenado.revision : null,
        disponible,
      });
    }
  }
  json(res, 200, { usuario, modo_pruebas: { activo: probando }, tarjetas });
});

// El menú es público: es solo navegación, y la tablet vive en el almacén. La
// identificación ocurre al entrar a un módulo, no antes.
// El menú se arma con lo que esa persona puede abrir. Ya no es público: la
// identidad se comprueba antes del menú, así que cada quien ve solo lo suyo.
ruta('GET', '/api/modulos', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;

  // Notificaciones viaja con su cuenta de pendientes para que el menú pueda
  // avisar sin que haya que entrar a mirar. Es el único módulo que la trae:
  // avisar es justo lo que hace.
  const pendientes = puede(usuario, 'mod_notificaciones') ? cuantosPendientes(usuario) : 0;

  // Quien llena checklists pero no entra a todo Logística ve el módulo igual:
  // le abre directo en sus checklists, que es lo suyo. Así mover Checklists
  // adentro de Logística no dejó a nadie sin su trabajo del día.
  const soloChecklists = !puede(usuario, 'mod_logistica') && puede(usuario, 'llenar');
  // Lo mismo con Tránsito, que también se mudó adentro: quien solo saca
  // unidades entra a Logística y cae directo en sus salidas.
  const soloTransito = !puede(usuario, 'mod_logistica') && puede(usuario, 'mod_transito');

  json(res, 200, MODULOS
    .filter((m) => !m.oculto)
    .filter((m) => puede(usuario, m.permiso)
      || (m.clave === 'logistica' && (soloChecklists || soloTransito)))
    .map(({ permiso, oculto, ...visible }) => {
      if (visible.clave === 'notificaciones') return { ...visible, pendientes };
      if (visible.clave === 'logistica' && soloTransito && !soloChecklists) {
        return {
          ...visible,
          descripcion: 'Salidas de unidad: el formato de asignación e inspección',
          destino: '#/envios/transito',
        };
      }
      if (visible.clave === 'logistica' && soloChecklists) {
        return {
          ...visible,
          descripcion: 'Los checklists de cada unidad',
          destino: '#/logistica/checklists',
        };
      }
      return visible;
    }));
});

// La portada: el saludo con las cifras del día y, por cada módulo, en qué va.
// Todo sale de lo que ya existe —los pendientes de Notificaciones y el tablero
// de la ODT—; aquí solo se resume para que al entrar se vea de un vistazo.
ruta('GET', '/api/inicio/resumen', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const grupos = puede(usuario, 'mod_notificaciones') ? pendientesDe(usuario) : [];
  const porModulo = {};
  let total = 0;
  let urgentes = 0;
  for (const g of grupos) {
    const m = MODULOS.find((x) => x.nombre === g.modulo) || { clave: 'otro' };
    const r = porModulo[m.clave] || (porModulo[m.clave] = { total: 0, urgentes: 0 });
    r.total += g.asuntos.length;
    r.urgentes += g.asuntos.filter((a) => a.urgente).length;
    total += g.asuntos.length;
    urgentes += g.asuntos.filter((a) => a.urgente).length;
  }

  const cifras = [];
  if (puede(usuario, 'mod_notificaciones')) {
    cifras.push({ clave: 'avisos', etiqueta: 'Por atender', valor: String(total),
      detalle: urgentes ? `${urgentes} urgente(s)` : 'nada urgente', alerta: urgentes > 0, destino: '#/notificaciones' });
  }

  const extra = {};
  if (puede(usuario, 'mod_produccion')) {
    const odt = db.prepare('SELECT * FROM almacen_odt ORDER BY semana DESC, id DESC').all()
      .find((o) => veODT(usuario, o));
    if (odt) {
      const t = tableroODT(odt.id);
      const hoy = hoyISO();
      const deHoy = t.envios.filter((e) => e.fecha === hoy);
      const atrasados = t.envios.filter((e) => e.situacion === 'atrasado').length;
      cifras.push({ clave: 'odt', etiqueta: 'ODT de la semana', valor: `${t.semana.pct}%`, avance: t.semana.pct,
        detalle: `${t.semana.armado.toLocaleString('es-MX')} de ${t.semana.total.toLocaleString('es-MX')} piezas`,
        destino: `#/produccion/odt/${odt.id}/avance` });
      cifras.push({ clave: 'envios', etiqueta: 'Envíos de hoy', valor: String(deHoy.length),
        detalle: atrasados ? `${atrasados} atrasado(s) en la semana` : 'ninguno atrasado', aviso_detalle: atrasados > 0,
        destino: `#/produccion/odt/${odt.id}/avance` });
      extra.produccion = [
        { texto: `${t.semana.pct}% armado`, tono: 'azul' },
        ...(atrasados ? [{ texto: `${atrasados} envío(s) atrasado(s)`, tono: 'ambar' }] : []),
      ];
      extra.produccion_linea = `ODT ${describirSemana(odt.semana)}${odt.publicada_en ? '' : ' · sin publicar'}`;
    }
  }
  if (puede(usuario, 'mod_ventas_fuera')) {
    const n = db.prepare("SELECT COUNT(*) AS n FROM vxf_ordenes WHERE estado = 'por_armar'").get().n;
    cifras.push({ clave: 'vxf', etiqueta: 'x Fuera por armar', valor: String(n), detalle: 'órdenes de armado', destino: '#/ventas-fuera' });
  }

  const modulos = MODULOS.filter((m) => m.disponible && puede(usuario, m.permiso) && m.clave !== 'notificaciones')
    .map((m) => {
      const p = porModulo[m.clave];
      const chips = [...(extra[m.clave] || [])];
      if (p && p.total) chips.push({ texto: `${p.total} por atender`, tono: p.urgentes ? 'roja' : 'azul' });
      if (!chips.length && ['checklists', 'calidad', 'transito', 'almacen', 'ventas_fuera', 'produccion', 'incidencias'].includes(m.clave)) {
        chips.push({ texto: 'Al día', tono: 'verde' });
      }
      return { clave: m.clave, linea: extra[`${m.clave}_linea`] || null, chips };
    });

  json(res, 200, { cifras: cifras.slice(0, 4), modulos, avisos: total });
});

// El índice del módulo de Reportes, armado con lo que esa persona puede ver. Un
// reporte que no le toca no aparece: enseñarlo apagado solo informa de que
// existe algo que no puede abrir.
ruta('GET', '/api/reportes/indice', (req, res) => {
  const usuario = exigir(req, res, 'mod_reportes');
  if (!usuario) return;
  json(res, 200, REPORTES
    .filter((r) => puede(usuario, r.permiso))
    .map(({ permiso, ...visible }) => visible));
});

// Lo que la pantalla de ingreso necesita saber antes de dibujarse: si ya se
// entra con la clave sola, o si todavía hay que elegir un nombre de la lista.
// Con la clave sola no se devuelve una sola persona: la pantalla ya no tiene
// por qué saber quién trabaja aquí.
ruta('GET', '/api/acceso', (req, res) => {
  const url = new URL(req.url, 'http://x');
  const modulo = MODULOS.find((m) => m.clave === url.searchParams.get('modulo'));

  if (accesoPorClave()) return json(res, 200, { modo: 'clave', personas: [] });

  // Modo lista (transitorio). Si se pide para un módulo, solo devuelve a
  // quienes pueden entrar: así nadie escribe su clave para que luego le digan
  // que no tiene acceso.
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

  json(res, 200, { modo: 'lista', personas });
});

// Liberar desde la propia pantalla de acceso, sin sesión: quien libera escribe
// su clave ahí mismo. Es el punto del asunto —que nadie se quede varado— y por
// eso no exige entrar primero a ninguna parte.
ruta('POST', '/api/acceso/liberar', (req, res, _p, cuerpo) => {
  const dispositivo = dispositivoDe(req);
  const espera = segundosDeEspera(dispositivo);
  if (espera) {
    return json(res, 429, { error: `Espera ${espera} segundo(s) antes de volver a intentar.` });
  }

  const fila = usuarioPorClave(cuerpo.clave);
  const quien = fila
    ? { id: fila.id, nombre: fila.nombre, rol: fila.rol, permisos: permisosDe(fila.rol, fila.permisos_extra) }
    : null;

  if (!quien || !puede(quien, 'claves_liberar')) {
    esperasLiberar.set(dispositivo, Date.now() + ESPERA_LIBERAR);
    anotarAcceso('liberacion_rechazada', { dispositivo, nota: 'clave sin permiso para liberar' });
    return json(res, 403, {
      error: 'Esa clave no puede liberar accesos. Llama al Administrador o a Hector.',
    });
  }

  // Quien tiene su propia clave bloqueada no se libera a sí mismo: si pudiera,
  // el bloqueo no serviría de nada para él.
  if (bloqueoDePersona(quien.id)) {
    return json(res, 423, { error: 'Tu propia clave está bloqueada. Te la libera el Administrador.' });
  }

  const hechos = [];
  if (bloqueoDeDispositivo(dispositivo)) {
    liberarDispositivo(dispositivo, quien.id, 'liberada desde la pantalla de acceso');
    hechos.push('esta tablet');
  }
  const aQuien = Number(cuerpo.usuario_id) || 0;
  if (aQuien && bloqueoDePersona(aQuien)) {
    const persona = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(aQuien);
    liberarPersona(aQuien, quien.id, 'liberada desde la pantalla de acceso');
    hechos.push(`la clave de ${(persona && persona.nombre) || 'esa persona'}`);
  }

  if (!hechos.length) return json(res, 409, { error: 'Aquí ya no hay nada bloqueado.' });
  json(res, 200, {
    mensaje: `${quien.nombre} liberó ${hechos.join(' y ')}. Vuelve a escribir tu clave.`,
    libero: quien.nombre,
  });
});

// La pantalla de claves y accesos. No cuelga de Configuración: quien solo tiene
// el permiso de liberar entra aquí sin que se le abra todo lo demás.
ruta('GET', '/api/accesos', (req, res) => {
  const usuario = exigir(req, res, 'claves_liberar');
  if (!usuario) return;

  json(res, 200, {
    intentos_max: INTENTOS_MAX,
    personas: db.prepare(`
      SELECT u.id, u.nombre, u.rol, u.activo, u.fallos, u.bloqueado_en, u.bloqueado_motivo,
             q.nombre AS bloqueo_por, (u.pin IS NOT NULL) AS tiene_clave
        FROM usuarios u LEFT JOIN usuarios q ON q.id = u.bloqueado_por
       WHERE u.activo = 1 ORDER BY u.bloqueado_en IS NULL, u.nombre
    `).all().map((u) => ({ ...u, puesto: permisosDe(u.rol, '[]').etiqueta })),
    dispositivos: db.prepare(`
      SELECT dispositivo, fallos, ultimo_en, bloqueado_en, motivo
        FROM accesos_dispositivos
       WHERE bloqueado_en IS NOT NULL OR fallos > 0
       ORDER BY bloqueado_en IS NULL, ultimo_en DESC
    `).all(),
    bitacora: db.prepare(`
      SELECT b.id, b.en, b.accion, b.dispositivo, b.nota,
             u.nombre AS quien, q.nombre AS por
        FROM accesos_bitacora b
        LEFT JOIN usuarios u ON u.id = b.usuario_id
        LEFT JOIN usuarios q ON q.id = b.por_id
       ORDER BY b.id DESC LIMIT 60
    `).all(),
  });
});

ruta('POST', '/api/accesos/personas/(\\d+)/(bloquear|liberar)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'claves_liberar');
  if (!usuario) return;

  const id = Number(p[1]);
  const persona = db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').get(id);
  if (!persona) return json(res, 404, { error: 'Esa persona ya no existe.' });

  if (p[2] === 'liberar') {
    if (!bloqueoDePersona(id)) return json(res, 409, { error: `La clave de ${persona.nombre} no está bloqueada.` });
    liberarPersona(id, usuario.id, String(cuerpo.nota || '').trim() || null);
    return json(res, 200, { mensaje: `Listo: ${persona.nombre} ya puede entrar.` });
  }

  // Bloquear a mano es para cuando alguien se va o su clave anda rodando. Pide
  // el motivo: un bloqueo sin explicación es un misterio para el que lo
  // encuentre después.
  const motivo = String(cuerpo.motivo || '').trim();
  if (motivo.length < 5) return json(res, 400, { error: 'Escribe por qué se bloquea (al menos 5 letras).' });
  if (id === usuario.id) return json(res, 400, { error: 'No te bloquees a ti mismo: nadie más podría liberarte.' });
  if (bloqueoDePersona(id)) return json(res, 409, { error: `La clave de ${persona.nombre} ya estaba bloqueada.` });

  bloquearPersona(id, usuario.id, motivo);
  cerrarSesionesDe((x) => x === id);
  json(res, 200, { mensaje: `La clave de ${persona.nombre} quedó bloqueada.` });
});

ruta('POST', '/api/accesos/dispositivos/liberar', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'claves_liberar');
  if (!usuario) return;

  const cual = String(cuerpo.dispositivo || '').trim();
  if (!cual || !bloqueoDeDispositivo(cual)) return json(res, 409, { error: 'Esa tablet no está bloqueada.' });
  liberarDispositivo(cual, usuario.id, String(cuerpo.nota || '').trim() || null);
  json(res, 200, { mensaje: 'Esa tablet ya puede volver a intentar.' });
});

ruta('GET', '/api/reportes/accesos', (req, res) => {
  const usuario = exigir(req, res, 'accesos_reportes');
  if (!usuario) return;

  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const desde = fecha(url.searchParams.get('desde'));
  const hasta = fecha(url.searchParams.get('hasta'));
  const persona = /^\d+$/.test(url.searchParams.get('persona') || '') ? Number(url.searchParams.get('persona')) : null;
  const accion = ['entrada', 'fallo', 'bloqueo', 'liberacion'].includes(url.searchParams.get('accion'))
    ? url.searchParams.get('accion') : null;

  const partes = [];
  const valores = [];
  if (desde) { partes.push('DATE(b.en) >= ?'); valores.push(desde); }
  if (hasta) { partes.push('DATE(b.en) <= ?'); valores.push(hasta); }
  if (persona) { partes.push('(b.usuario_id = ? OR b.por_id = ?)'); valores.push(persona, persona); }
  if (accion) { partes.push('b.accion = ?'); valores.push(accion); }
  const donde = partes.length ? `WHERE ${partes.join(' AND ')}` : '';

  json(res, 200, {
    filtros: {
      desde, hasta, persona, accion,
      personas: db.prepare('SELECT id, nombre FROM usuarios ORDER BY nombre').all(),
      acciones: [
        { clave: 'entrada', etiqueta: 'Entradas al sistema' },
        { clave: 'fallo', etiqueta: 'Intentos fallidos' },
        { clave: 'bloqueo', etiqueta: 'Bloqueos' },
        { clave: 'liberacion', etiqueta: 'Liberaciones' },
      ],
    },
    resumen: db.prepare(`
      SELECT b.accion, COUNT(*) AS cuantos FROM accesos_bitacora b ${donde}
       GROUP BY b.accion ORDER BY cuantos DESC
    `).all(...valores),
    por_persona: db.prepare(`
      SELECT COALESCE(u.nombre, '— sin identificar —') AS quien,
             SUM(b.accion = 'entrada') AS entradas,
             SUM(b.accion = 'fallo') AS fallos,
             SUM(b.accion = 'bloqueo') AS bloqueos,
             MAX(CASE WHEN b.accion = 'entrada' THEN b.en END) AS ultima_entrada
        FROM accesos_bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id ${donde}
       GROUP BY b.usuario_id ORDER BY entradas DESC, quien
    `).all(...valores),
    renglones: db.prepare(`
      SELECT b.id, b.en, b.accion, b.dispositivo, b.nota,
             u.nombre AS quien, q.nombre AS por
        FROM accesos_bitacora b
        LEFT JOIN usuarios u ON u.id = b.usuario_id
        LEFT JOIN usuarios q ON q.id = b.por_id
        ${donde}
       ORDER BY b.id DESC LIMIT 400
    `).all(...valores),
  });
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

  const campos = camposDe(plantilla);
  const periodo = periodoActual(plantilla.frecuencia);

  const llenados = db.prepare(`
    SELECT l.id, l.estado, l.revision, l.referencia, l.datos, l.salida_en, l.cerrado_en, l.creado_en,
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
  if (fueraDeSuDia(plantilla, usuario)) {
    return json(res, 409, { error: `«${plantilla.nombre}» solo se llena los viernes.` });
  }

  // Los campos de cabecera se capturan antes que nada. Uno de ellos actúa como
  // referencia y es lo que permite tener varios checklists el mismo día.
  const campos = camposDe(plantilla);
  const datos = {};
  let referencia = null;

  for (const campo of campos) {
    const valor = String((cuerpo.datos || {})[campo.clave] ?? '').trim();
    // Un campo puede aplicar solo a algunos tipos: la unidad y el operador no
    // se piden en una colecta, donde no sale ninguna unidad nuestra.
    if (!campoAplicaA(campo, cuerpo.datos)) { datos[campo.clave] = ''; continue; }
    if (campo.requerido && !valor) {
      return json(res, 400, { error: `Captura «${campo.etiqueta}» antes de comenzar.` });
    }
    const malo = valorMaloDelCampo(campo, valor, cuerpo.datos);
    if (malo) return json(res, 400, { error: malo });
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

  json(res, 200, conRevision(obtenerOCrearLlenado({
    plantillaId: plantilla.id,
    activoId: cuerpo.activo_id ? Number(cuerpo.activo_id) : null,
    periodo,
    usuarioId: usuario.id,
    referencia,
    datos,
  })));
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
    llenado: { ...conRevision(llenado), revisiones: revisionesDe(llenado.id) },
    plantilla: plantillaCompleta(plantilla.clave, llenado.activo_id, llenado.datos),
  });
});

ruta('PUT', '/api/llenados/(\\d+)/respuestas', (req, res, p, cuerpo) => {
  if (!exigir(req, res)) return;
  const llenado = db.prepare('SELECT estado FROM llenados WHERE id = ?').get(Number(p[1]));
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  if (llenado.estado === 'cerrado') return json(res, 409, { error: 'Este checklist ya fue cerrado' });
  const bloqueo = bloqueoPorRevision(Number(p[1]));
  if (bloqueo) return json(res, 409, { error: bloqueo });

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
  const bloqueoDatos = bloqueoPorRevision(id);
  if (bloqueoDatos) return json(res, 409, { error: bloqueoDatos });

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(llenado.plantilla_id);
  const campos = camposDe(plantilla);
  const previos = JSON.parse(llenado.datos || '{}');
  const datos = {};
  let referencia = llenado.referencia;

  const comoQueda = { ...previos, ...(cuerpo.datos || {}) };
  for (const campo of campos) {
    const valor = String((cuerpo.datos || {})[campo.clave] ?? previos[campo.clave] ?? '').trim();
    // Lo que no aplica a lo que la unidad va a hacer no se pide: antes esta
    // pantalla exigía la unidad hasta en una colecta, donde no se pregunta.
    if (!campoAplicaA(campo, comoQueda)) { datos[campo.clave] = ''; continue; }
    if (campo.requerido && !valor) {
      return json(res, 400, { error: `Captura «${campo.etiqueta}».` });
    }
    const malo = valorMaloDelCampo(campo, valor, comoQueda);
    if (malo) return json(res, 400, { error: malo });
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
  const bloqueo = bloqueoPorRevision(Number(p[1]));
  if (bloqueo) return json(res, 409, { error: bloqueo });
  // En Tránsito las observaciones siguen abiertas en ruta: pasa algo en la entrega.
  db.prepare("UPDATE llenados SET notas = ? WHERE id = ? AND estado <> 'cerrado'").run(cuerpo.notas ?? null, Number(p[1]));
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
  const bloqueoFirma = bloqueoPorRevision(Number(p[1]));
  if (bloqueoFirma) return json(res, 409, { error: bloqueoFirma });

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

// Decodifica el data: URL que manda la tablet y lo deja escrito en datos/fotos/.
// Lo usan los checklists y Calidad: misma carpeta, mismas validaciones y mismo
// nombre aleatorio; lo único que cambia es en qué tabla se anota después.
function guardarArchivoSubido(datos) {
  const partes = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/
    .exec(datos || '');
  if (!partes) return { codigo: 400, error: 'El archivo no es una imagen ni un PDF' };

  const binario = Buffer.from(partes[2], 'base64');
  if (binario.length === 0) return { codigo: 400, error: 'La imagen llegó vacía' };
  if (binario.length > LIMITE_FOTO) return { codigo: 413, error: 'La foto pesa demasiado' };

  // Nombre aleatorio: nunca se usa el que trae el dispositivo, así no hay forma
  // de que un nombre malicioso escriba fuera de datos/fotos.
  const archivo = `${crypto.randomBytes(16).toString('hex')}.${EXTENSION[partes[1]]}`;
  fs.writeFileSync(path.join(carpetaFotos(), archivo), binario);
  return { archivo, bytes: binario.length };
}

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
  const bloqueoFoto = bloqueoPorRevision(llenadoId);
  if (bloqueoFoto) return json(res, 409, { error: bloqueoFoto });

  // Cada archivo pertenece a su etapa: la hoja de recepción no puede cargarse
  // antes de salir, ni la de autorización cambiarse una vez en ruta.
  if (llenado.por_etapas && cuerpo.item_id) {
    const etapaItem = etapaDelItem(Number(cuerpo.item_id));
    const etapaEnCurso = llenado.estado === 'borrador' ? 'salida' : 'regreso';
    if (etapaItem !== etapaEnCurso) {
      return json(res, 409, {
        error: etapaItem === 'regreso'
          ? 'Ese documento se carga al final, cuando ya se autorizó la salida o la carga.'
          : 'Ya se autorizó la salida o la carga: los documentos previos no se modifican.',
      });
    }
  }

  const guardado = guardarArchivoSubido(cuerpo.imagen);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO fotos (llenado_id, item_id, columna, archivo, bytes, subida_por, subida_en)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    llenadoId,
    cuerpo.item_id ? Number(cuerpo.item_id) : null,
    cuerpo.columna || '-',
    guardado.archivo, guardado.bytes, usuario.id, new Date().toISOString()
  );

  json(res, 200, {
    id: Number(lastInsertRowid),
    archivo: guardado.archivo,
    item_id: cuerpo.item_id ? Number(cuerpo.item_id) : null,
    columna: cuerpo.columna || '-',
    bytes: guardado.bytes,
    subida_por: usuario.nombre,
  });
});

ruta('DELETE', '/api/fotos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res)) return;

  const foto = db.prepare(`
    SELECT f.id, f.archivo, f.llenado_id, l.estado FROM fotos f
    JOIN llenados l ON l.id = f.llenado_id WHERE f.id = ?
  `).get(Number(p[1]));
  if (!foto) return json(res, 404, { error: 'Foto no encontrada' });
  if (foto.estado === 'cerrado') return json(res, 409, { error: 'El checklist ya fue cerrado' });
  const bloqueo = bloqueoPorRevision(foto.llenado_id);
  if (bloqueo) return json(res, 409, { error: bloqueo });

  db.prepare('DELETE FROM fotos WHERE id = ?').run(foto.id);
  fs.rm(path.join(carpetaFotos(), foto.archivo), { force: true }, () => {});
  json(res, 200, { ok: true });
});

// El nombre se valida contra el patrón que genera la subida, así que aquí no
// puede colarse ni una ruta relativa ni una extensión inesperada.
ruta('GET', '/api/fotos/([a-f0-9]{32}\\.(?:jpg|png|webp|pdf))', (req, res, p) => {
  if (!exigir(req, res)) return;
  // En prueba se busca primero en la copia; si no está ahí, es una foto que ya
  // existía en la base real al sacar la copia.
  const enCopia = path.join(carpetaFotos(), p[1]);
  const archivo = fs.existsSync(enCopia) ? enCopia : path.join(FOTOS_DIR, p[1]);
  fs.readFile(archivo, (err, contenido) => {
    if (err) return json(res, 404, { error: 'Foto no encontrada' });
    res.writeHead(200, {
      'Content-Type': TIPOS_MIME['.' + p[1].split('.').pop()] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(contenido);
  });
});

// --- Tránsito: el camino de un envío o una colecta ---
//
//   borrador               Quien lo llena captura la primera etapa y sus documentos.
//     └ enviar-salida      Lo manda a autorización  → revision 'por_autorizar'.
//   (por_autorizar)        Un Team Leader autoriza la salida (envío) o la carga
//     └ autorizar-salida   (colecta) → estado 'en_ruta'. O lo regresa con nota.
//   en_ruta                Se carga la hoja de recepción o la evidencia y se firma.
//     └ enviar-cierre      Lo manda a aprobación de cierre → revision 'por_aprobar'.
//   (por_aprobar)          Un Team Leader aprueba el cierre → 'cerrado' y
//     └ cerrar             'aprobado': hasta aquí entra a Reportes. O lo regresa.
//
// Regresar deja revision 'modificacion' con la nota; se corrige y se vuelve a
// enviar. Quien lo llenó no autoriza ni aprueba lo suyo. El Administrador puede
// todo: autoriza o aprueba aunque no se lo hayan enviado, y aunque sea suyo.

function transitoDe(res, id) {
  const llenado = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!llenado) { json(res, 404, { error: 'Llenado no encontrado' }); return null; }
  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(llenado.plantilla_id);
  if (!plantilla.por_etapas) { json(res, 400, { error: 'Este checklist no se llena por etapas.' }); return null; }
  return { llenado, plantilla, datos: JSON.parse(llenado.datos || '{}') };
}

const tieneFirma = (llenadoId, rol) => !!db.prepare('SELECT 1 FROM firmas WHERE llenado_id = ? AND rol = ?').get(llenadoId, rol);

ruta('POST', '/api/llenados/(\\d+)/enviar-salida', (req, res, p) => {
  const usuario = exigir(req, res, 'llenar');
  if (!usuario) return;
  const t = transitoDe(res, Number(p[1]));
  if (!t) return;
  const { llenado, plantilla, datos } = t;

  if (llenado.estado !== 'borrador') return json(res, 409, { error: 'Ya se autorizó; lo que sigue es el cierre.' });
  if (llenado.revision === 'por_autorizar') return json(res, 409, { error: 'Ya está enviado a autorización.' });
  const faltas = faltantesDeEtapa(llenado.id, plantilla, 'salida', datos);
  // Los faltantes viajan con su pregunta, igual que en los demás checklists:
  // así la pantalla lleva a la que falta en vez de solo nombrarla.
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas), faltantes: faltas });
  // Quien lo llenó firma antes de mandarlo: lo que se autoriza es lo que
  // alguien declaró haber revisado, y eso tiene nombre y firma.
  if (plantilla.firma_operador && !tieneFirma(llenado.id, 'operador')) {
    return json(res, 400, { error: 'Falta tu firma. Fírmalo antes de mandarlo a autorización.' });
  }

  db.prepare("UPDATE llenados SET revision = 'por_autorizar' WHERE id = ?").run(llenado.id);
  anotarRevision(llenado.id, 'enviado_salida', usuario.id, null);
  json(res, 200, { ok: true, revision: 'por_autorizar' });
});

ruta('POST', '/api/llenados/(\\d+)/autorizar-salida', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const t = transitoDe(res, Number(p[1]));
  if (!t) return;
  const { llenado, plantilla, datos } = t;
  const esAdmin = usuario.rol === 'admin';

  if (!puede(usuario, 'transito_autorizar')) {
    return json(res, 403, {
      error: 'Autorizar una salida va por persona: pídele al Administrador que te lo asigne en Permisos.',
    });
  }
  if (llenado.estado !== 'borrador') return json(res, 409, { error: 'Ya fue autorizado.' });
  if (!esAdmin && llenado.revision !== 'por_autorizar') {
    return json(res, 409, { error: 'Todavía no se envía a autorización.' });
  }
  if (!esAdmin && llenado.usuario_id === usuario.id) {
    return json(res, 409, { error: 'Tú lo llenaste: lo autoriza otro Team Leader o el Administrador.' });
  }
  const faltas = faltantesDeEtapa(llenado.id, plantilla, 'salida', datos);
  // Los faltantes viajan con su pregunta, igual que en los demás checklists:
  // así la pantalla lleva a la que falta en vez de solo nombrarla.
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas), faltantes: faltas });

  db.prepare("UPDATE llenados SET estado = 'en_ruta', salida_en = ?, autorizado_por = ?, revision = NULL WHERE id = ?")
    .run(new Date().toISOString(), usuario.id, llenado.id);
  anotarRevision(llenado.id, 'salida_autorizada', usuario.id,
    esAdmin && llenado.revision !== 'por_autorizar' ? 'Autorizado directo por el Administrador' : null);
  json(res, 200, { ok: true, estado: 'en_ruta' });
});

ruta('POST', '/api/llenados/(\\d+)/enviar-cierre', (req, res, p) => {
  const usuario = exigir(req, res, 'llenar');
  if (!usuario) return;
  const t = transitoDe(res, Number(p[1]));
  if (!t) return;
  const { llenado, plantilla, datos } = t;

  if (llenado.estado === 'borrador') {
    return json(res, 400, { error: 'Primero se autoriza la salida o la carga; el cierre va después.' });
  }
  if (llenado.estado === 'cerrado') return json(res, 409, { error: 'Ya está cerrado.' });
  if (llenado.revision === 'por_aprobar') return json(res, 409, { error: 'Ya está enviado a aprobación de cierre.' });
  const faltas = faltantesDeEtapa(llenado.id, plantilla, 'regreso', datos);
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas), faltantes: faltas });
  if (plantilla.firma_operador && !tieneFirma(llenado.id, 'operador')) {
    return json(res, 400, { error: 'Falta la firma de quien lo llena.' });
  }

  db.prepare("UPDATE llenados SET revision = 'por_aprobar', regreso_en = ? WHERE id = ?")
    .run(new Date().toISOString(), llenado.id);
  anotarRevision(llenado.id, 'enviado', usuario.id, null);
  json(res, 200, { ok: true, revision: 'por_aprobar' });
});

ruta('POST', '/api/llenados/(\\d+)/regresar-transito', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const t = transitoDe(res, Number(p[1]));
  if (!t) return;
  const { llenado } = t;

  const paso = llenado.revision === 'por_autorizar' && llenado.estado === 'borrador' ? 'autorizacion'
    : llenado.revision === 'por_aprobar' && llenado.estado === 'en_ruta' ? 'cierre' : null;
  if (!paso) return json(res, 409, { error: 'No está esperando revisión.' });
  if (!puede(usuario, paso === 'autorizacion' ? 'transito_autorizar' : 'transito_aprobar_cierre')) {
    return json(res, 403, { error: 'Tu perfil no puede revisar este paso.' });
  }
  if (usuario.rol !== 'admin' && llenado.usuario_id === usuario.id) {
    return json(res, 409, { error: 'Tú lo llenaste: lo revisa otro Team Leader o el Administrador.' });
  }
  const nota = String(cuerpo.nota || '').trim();
  if (nota.length < 5) return json(res, 400, { error: 'Escribe qué hay que corregir: lo va a leer quien lo llenó.' });

  db.exec('BEGIN');
  try {
    if (paso === 'cierre') {
      // Firmó lo que mandó; al corregir firma otra vez lo que de verdad manda.
      db.prepare("UPDATE llenados SET revision = 'modificacion', regreso_en = NULL WHERE id = ?").run(llenado.id);
      db.prepare('DELETE FROM firmas WHERE llenado_id = ?').run(llenado.id);
    } else {
      db.prepare("UPDATE llenados SET revision = 'modificacion' WHERE id = ?").run(llenado.id);
    }
    anotarRevision(llenado.id, 'modificacion', usuario.id, nota);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true, revision: 'modificacion' });
});

// Aprobar el cierre. Lo llama /cerrar cuando el checklist va por etapas.
// El kilometraje que se anotó en el checklist pasa a la línea de tiempo de la
// unidad: es el mismo número que usan el rendimiento y el próximo servicio, y
// tenerlo en un solo lugar evita que cada pantalla lo busque por su cuenta.
function guardarLecturasDelChecklist(llenadoId, llenado, usuarioId) {
  if (!llenado.activo_id) return;
  const lecturas = db.prepare(`
    SELECT r.valor, i.meta
      FROM respuestas r JOIN items i ON i.id = r.item_id
     WHERE r.llenado_id = ? AND i.tipo_respuesta = 'medidor'
  `).all(llenadoId);
  for (const l of lecturas) {
    const km = Math.trunc(Number(l.valor));
    if (!Number.isFinite(km) || km <= 0) continue;
    let meta = {};
    try { meta = JSON.parse(l.meta || '{}'); } catch { meta = {}; }
    if ((meta.unidad || 'km') !== 'km') continue; // el horómetro no es kilometraje
    const yaEsta = db.prepare(
      "SELECT 1 FROM logistica_lecturas WHERE origen_tipo = 'checklist' AND origen_id = ?"
    ).get(llenadoId);
    if (yaEsta) continue;
    db.prepare(`
      INSERT INTO logistica_lecturas (activo_id, fecha, kilometros, origen_tipo, origen_id, usuario_id, creado_en)
      VALUES (?, ?, ?, 'checklist', ?, ?, ?)
    `).run(llenado.activo_id, (llenado.cerrado_en || new Date().toISOString()).slice(0, 10),
      km, llenadoId, usuarioId, new Date().toISOString());
  }
}

function cerrarTransito(res, usuario, llenado, plantilla) {
  if (!puede(usuario, 'transito_aprobar_cierre')) {
    return json(res, 403, { error: 'Aprobar el cierre lo hace un Team Leader o el Administrador.' });
  }
  const esAdmin = usuario.rol === 'admin';
  if (llenado.estado === 'borrador') {
    return json(res, 400, { error: 'Primero se autoriza la salida o la carga; el cierre se aprueba después.' });
  }
  if (!esAdmin && llenado.revision !== 'por_aprobar') {
    return json(res, 409, { error: 'Todavía no se envía a aprobación de cierre.' });
  }
  if (!esAdmin && llenado.usuario_id === usuario.id) {
    return json(res, 409, { error: 'Tú lo llenaste: el cierre lo aprueba otro Team Leader o el Administrador.' });
  }
  const datos = JSON.parse(llenado.datos || '{}');
  const faltas = ['salida', 'regreso'].flatMap((e) => faltantesDeEtapa(llenado.id, plantilla, e, datos));
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas) });
  if (plantilla.firma_operador && !tieneFirma(llenado.id, 'operador')) {
    return json(res, 400, { error: 'Falta la firma de quien lo llena.' });
  }

  const ahora = new Date().toISOString();
  db.prepare(`
    UPDATE llenados SET estado = 'cerrado', cerrado_en = ?, cerrado_por = ?, revision = 'aprobado',
           aprobado_por = ?, aprobado_en = ?, regreso_en = COALESCE(regreso_en, ?)
     WHERE id = ?
  `).run(ahora, usuario.id, usuario.id, ahora, ahora, llenado.id);
  anotarRevision(llenado.id, 'aprobado', usuario.id,
    esAdmin && llenado.revision !== 'por_aprobar' ? 'Cerrado directo por el Administrador' : null);
  guardarLecturasDelChecklist(llenado.id, llenado, usuario.id);
  return json(res, 200, { ok: true, estado: 'cerrado', revision: 'aprobado' });
}

ruta('POST', '/api/llenados/(\\d+)/cerrar', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const id = Number(p[1]);

  const llenado = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!llenado) return json(res, 404, { error: 'Llenado no encontrado' });
  if (llenado.estado === 'cerrado') return json(res, 409, { error: 'Este checklist ya fue cerrado.' });

  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(llenado.plantilla_id);

  if (plantilla.por_etapas) return cerrarTransito(res, usuario, llenado, plantilla);

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
  // Los faltantes viajan con el id de su pregunta: la pantalla lleva a la
  // primera en vez de dejar a alguien buscándola entre sesenta renglones.
  if (faltas.length) return json(res, 400, { error: mensajeDeFaltantes(faltas), faltantes: faltas });

  const firmas = db.prepare('SELECT rol FROM firmas WHERE llenado_id = ?').all(id).map((f) => f.rol);
  if (plantilla.firma_operador && !firmas.includes('operador')) {
    return json(res, 400, { error: 'Falta la firma del operador.' });
  }
  if (plantilla.firma_coordinador && !firmas.includes('coordinador')) {
    return json(res, 400, { error: 'Falta la firma de autorización del Team Leader.' });
  }

  // Cerrar es ENVIAR a aprobación. Lo aprueba un Team Leader distinto de quien lo
  // llenó, o el Administrador. Lo que llena el Administrador queda aprobado
  // directo —puede hacer todo—, y Tránsito ya trae su propio paso de supervisión
  // (autorizar la salida y cerrar el regreso), así que tampoco espera.
  const ahora = new Date().toISOString();
  const directo = usuario.rol === 'admin' || !!plantilla.requiere_supervision
    || JSON.parse(plantilla.campos || '[]').length > 0;
  db.prepare(`
    UPDATE llenados SET estado = 'cerrado', cerrado_en = ?, cerrado_por = ?,
           revision = ?, aprobado_por = ?, aprobado_en = ?
     WHERE id = ?
  `).run(ahora, usuario.id, directo ? 'aprobado' : 'por_aprobar',
    directo ? usuario.id : null, directo ? ahora : null, id);
  anotarRevision(id, 'enviado', usuario.id, null);
  if (directo) anotarRevision(id, 'aprobado', usuario.id, usuario.rol === 'admin' ? 'Llenado por el Administrador' : null);
  guardarLecturasDelChecklist(id, llenado, usuario.id);
  json(res, 200, { ok: true, estado: 'cerrado', revision: directo ? 'aprobado' : 'por_aprobar' });
});

// --- aprobación de checklists ---

const anotarRevision = (llenadoId, accion, usuarioId, nota) => db.prepare(
  'INSERT INTO llenado_revisiones (llenado_id, accion, usuario_id, nota, en) VALUES (?, ?, ?, ?, ?)'
).run(llenadoId, accion, usuarioId, nota, new Date().toISOString());

const revisionesDe = (llenadoId) => db.prepare(`
  SELECT v.accion, v.nota, v.en, u.nombre
    FROM llenado_revisiones v LEFT JOIN usuarios u ON u.id = v.usuario_id
   WHERE v.llenado_id = ? ORDER BY v.id
`).all(llenadoId);

// Agrega al llenado en qué punto de la revisión va y, si le pidieron corregir,
// quién y qué: es lo que el operador tiene que leer al abrirlo.
function conRevision(llenado) {
  if (!llenado || !llenado.id) return llenado;
  const fila = db.prepare('SELECT revision FROM llenados WHERE id = ?').get(llenado.id) || {};
  const modificacion = fila.revision === 'modificacion' ? db.prepare(`
    SELECT v.nota, v.en, u.nombre FROM llenado_revisiones v LEFT JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.llenado_id = ? AND v.accion IN ('modificacion', 'reapertura')
     ORDER BY v.id DESC LIMIT 1
  `).get(llenado.id) : null;
  return { ...llenado, revision: fila.revision || null, modificacion: modificacion || null };
}

function llenadoPorRevisar(res, id, usuario) {
  const l = db.prepare('SELECT * FROM llenados WHERE id = ?').get(id);
  if (!l) { json(res, 404, { error: 'Ese checklist no existe.' }); return null; }
  if (l.estado !== 'cerrado' || l.revision !== 'por_aprobar') {
    json(res, 409, {
      error: l.revision === 'aprobado' ? 'Ese checklist ya está aprobado.'
        : l.revision === 'modificacion' ? 'Ese checklist está en corrección; espera a que lo reenvíen.'
          : 'Ese checklist todavía no se envía.',
    });
    return null;
  }
  // Quien lo llenó no lo aprueba. El Administrador sí puede: puede todo.
  if (usuario.rol !== 'admin' && l.usuario_id === usuario.id) {
    json(res, 409, { error: 'Tú llenaste este checklist. Lo aprueba otro Team Leader o el Administrador.' });
    return null;
  }
  return l;
}

ruta('GET', '/api/llenados/(\\d+)/revision', (req, res, p) => {
  const usuario = exigir(req, res, 'checklists_aprobar');
  if (!usuario) return;
  const llenado = db.prepare(`
    SELECT l.*, p.clave AS plantilla_clave, p.nombre AS plantilla_nombre,
           p.tipo_captura, a.nombre AS unidad, u.nombre AS elaboro
      FROM llenados l
      JOIN plantillas p ON p.id = l.plantilla_id
      JOIN usuarios u   ON u.id = l.usuario_id
      LEFT JOIN activos a ON a.id = l.activo_id
     WHERE l.id = ?
  `).get(Number(p[1]));
  if (!llenado) return json(res, 404, { error: 'Ese checklist no existe.' });

  // Con sus datos: un envío muestra sus secciones, no también las de la colecta.
  llenado.plantilla = plantillaCompleta(llenado.plantilla_clave, llenado.activo_id, JSON.parse(llenado.datos || '{}'));
  llenado.respuestas = db.prepare('SELECT item_id, columna, valor, observacion FROM respuestas WHERE llenado_id = ?').all(llenado.id);
  llenado.firmas = db.prepare('SELECT rol, nombre, imagen, firmado_en FROM firmas WHERE llenado_id = ?').all(llenado.id);
  llenado.fotos = fotosDe(llenado.id);
  llenado.revisiones = revisionesDe(llenado.id);
  llenado.puede_resolver = llenado.estado === 'cerrado' && llenado.revision === 'por_aprobar'
    && (usuario.rol === 'admin' || llenado.usuario_id !== usuario.id);
  json(res, 200, llenado);
});

ruta('POST', '/api/llenados/(\\d+)/aprobar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'checklists_aprobar');
  if (!usuario) return;
  const l = llenadoPorRevisar(res, Number(p[1]), usuario);
  if (!l) return;
  const ahora = new Date().toISOString();
  db.prepare("UPDATE llenados SET revision = 'aprobado', aprobado_por = ?, aprobado_en = ? WHERE id = ?")
    .run(usuario.id, ahora, l.id);
  anotarRevision(l.id, 'aprobado', usuario.id, String(cuerpo.nota || '').trim() || null);
  json(res, 200, { ok: true, revision: 'aprobado' });
});

// Reabrir uno que ya está aprobado. Es el caso que no cubría «pedir
// corrección»: ahí el checklist todavía esperaba una decisión, y aquí la
// decisión ya se tomó. Vuelve a captura con su motivo escrito, se le quitan las
// firmas —firmaron otra versión— y tiene que volver a pasar por aprobación.
// La reapertura queda anotada: el resguardo no congela la operación, la cuenta.
ruta('POST', '/api/llenados/(\\d+)/reabrir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'reabrir_cerrados');
  if (!usuario) return;
  const l = db.prepare('SELECT * FROM llenados WHERE id = ?').get(Number(p[1]));
  if (!l) return json(res, 404, { error: 'Ese checklist no existe.' });
  if (l.estado !== 'cerrado') return json(res, 409, { error: 'Ese checklist no está cerrado.' });

  const nota = String(cuerpo.nota || '').trim();
  if (nota.length < 5) {
    return json(res, 400, { error: 'Escribe por qué lo reabres: queda registrado y lo lee quien lo llenó.' });
  }

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE llenados SET estado = 'borrador', revision = 'modificacion', cerrado_en = NULL,
             cerrado_por = NULL, aprobado_por = NULL, aprobado_en = NULL
       WHERE id = ?
    `).run(l.id);
    db.prepare('DELETE FROM firmas WHERE llenado_id = ?').run(l.id);
    anotarRevision(l.id, 'reapertura', usuario.id, nota);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    ok: true,
    mensaje: 'Checklist reabierto. Vuelve a captura con tu nota y tiene que firmarse y aprobarse otra vez.',
  });
});

ruta('POST', '/api/llenados/(\\d+)/modificacion', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'checklists_aprobar');
  if (!usuario) return;
  const l = llenadoPorRevisar(res, Number(p[1]), usuario);
  if (!l) return;
  const nota = String(cuerpo.nota || '').trim();
  if (nota.length < 5) return json(res, 400, { error: 'Escribe qué hay que corregir: quien lo llenó lo va a leer.' });

  db.exec('BEGIN');
  try {
    // Se reabre para que lo corrija quien lo llenó. Su firma se quita: firmó otra
    // versión, y al reenviarlo tiene que firmar lo que de verdad manda.
    db.prepare(`
      UPDATE llenados SET estado = 'borrador', revision = 'modificacion', cerrado_en = NULL, cerrado_por = NULL
       WHERE id = ?
    `).run(l.id);
    db.prepare('DELETE FROM firmas WHERE llenado_id = ?').run(l.id);
    anotarRevision(l.id, 'modificacion', usuario.id, nota);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true, revision: 'modificacion' });
});

// El dinero que traía cada unidad, con su foto. Solo checklists aprobados.
ruta('GET', '/api/reportes/dinero', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  json(res, 200, db.prepare(`
    SELECT l.id AS llenado_id, l.periodo, l.cerrado_en, COALESCE(a.nombre, '—') AS unidad,
           u.nombre AS capturo, r.valor AS monto,
           (SELECT GROUP_CONCAT(f.archivo, '|') FROM fotos f
             WHERE f.llenado_id = l.id AND f.item_id = r.item_id) AS fotos
      FROM respuestas r
      JOIN items i    ON i.id = r.item_id
      JOIN llenados l ON l.id = r.llenado_id
      JOIN usuarios u ON u.id = l.usuario_id
      LEFT JOIN activos a ON a.id = l.activo_id
     WHERE i.tipo_respuesta = 'dinero' AND l.revision = 'aprobado'
       AND r.valor IS NOT NULL AND TRIM(r.valor) <> ''
     ORDER BY l.creado_en DESC
     LIMIT 200
  `).all());
});

// Los filtros del reporte: desde / hasta por fecha de llenado, una unidad, y si
// solo interesa lo que salió con problema. Van en el servidor y no en la
// pantalla porque el reporte trae los últimos renglones nada más: filtrar
// después de cortar dejaba fuera justo lo que se buscaba.
function filtrosDeReporte(req) {
  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const n = (v) => (/^\d+$/.test(v || '') ? Number(v) : null);
  return {
    desde: fecha(url.searchParams.get('desde')),
    hasta: fecha(url.searchParams.get('hasta')),
    unidad: n(url.searchParams.get('unidad')),
    plantilla: n(url.searchParams.get('plantilla')),
    conProblemas: url.searchParams.get('problemas') === '1',
  };
}

// El trozo de SQL y sus valores, para pegarlo en cada consulta del reporte.
function dondeDeReporte(f, alias = 'l') {
  const partes = [];
  const valores = [];
  if (f.desde) { partes.push(`DATE(${alias}.creado_en) >= ?`); valores.push(f.desde); }
  if (f.hasta) { partes.push(`DATE(${alias}.creado_en) <= ?`); valores.push(f.hasta); }
  if (f.unidad) { partes.push(`${alias}.activo_id = ?`); valores.push(f.unidad); }
  if (f.plantilla) { partes.push(`${alias}.plantilla_id = ?`); valores.push(f.plantilla); }
  return { sql: partes.length ? ` AND ${partes.join(' AND ')}` : '', valores };
}

ruta('GET', '/api/reportes/problemas', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  const f = filtrosDeReporte(req);
  const d = dondeDeReporte(f);
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
    WHERE r.valor IN ('problema', 'no') AND l.revision = 'aprobado'${d.sql}
    ORDER BY l.creado_en DESC, s.orden, i.orden
    LIMIT 300
  `).all(...d.valores));
});

ruta('GET', '/api/reportes/historial', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  const f = filtrosDeReporte(req);
  const d = dondeDeReporte(f);
  json(res, 200, db.prepare(`
    SELECT l.id, l.periodo, l.estado, l.revision, l.creado_en, l.cerrado_en, l.aprobado_en,
           p.nombre AS plantilla, p.clave AS plantilla_clave,
           a.nombre AS unidad, u.nombre AS elaboro, ap.nombre AS aprobo,
           (SELECT COUNT(*) FROM respuestas r WHERE r.llenado_id = l.id AND r.valor IN ('problema', 'no')) AS problemas,
           (SELECT COUNT(*) FROM llenado_revisiones v WHERE v.llenado_id = l.id AND v.accion = 'modificacion') AS modificaciones,
           (SELECT v.nota FROM llenado_revisiones v WHERE v.llenado_id = l.id AND v.accion = 'modificacion'
             ORDER BY v.id DESC LIMIT 1) AS ultima_modificacion
    FROM llenados l
    JOIN plantillas p ON p.id = l.plantilla_id
    JOIN usuarios u   ON u.id = l.usuario_id
    LEFT JOIN usuarios ap ON ap.id = l.aprobado_por
    LEFT JOIN activos a ON a.id = l.activo_id
    -- Entra lo aprobado, y también lo que está en corrección: pedir modificación
    -- es parte de la historia del checklist y tiene que verse.
    WHERE l.revision IN ('aprobado', 'modificacion')${d.sql}
      ${f.conProblemas ? "AND (SELECT COUNT(*) FROM respuestas r2 WHERE r2.llenado_id = l.id AND r2.valor IN ('problema', 'no')) > 0" : ''}
    ORDER BY l.creado_en DESC
    LIMIT 200
  `).all(...d.valores));
});

// Con qué se puede filtrar: las unidades y los checklists que de verdad tienen
// algo capturado. Así la pantalla no ofrece filtros que no devuelven nada.
ruta('GET', '/api/reportes/filtros', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;
  json(res, 200, {
    unidades: db.prepare(`
      SELECT a.id, a.nombre, a.tipo, COUNT(l.id) AS llenados
        FROM activos a JOIN llenados l ON l.activo_id = a.id
       GROUP BY a.id ORDER BY a.nombre
    `).all(),
    plantillas: db.prepare(`
      SELECT p.id, p.nombre, COUNT(l.id) AS llenados
        FROM plantillas p JOIN llenados l ON l.plantilla_id = p.id
       GROUP BY p.id ORDER BY p.orden
    `).all(),
    rango: db.prepare('SELECT MIN(DATE(creado_en)) AS desde, MAX(DATE(creado_en)) AS hasta FROM llenados').get(),
  });
});

ruta('GET', '/api/llenados/(\\d+)/detalle', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  // Un envío se consulta también desde el reporte de Tránsito, que se otorga
  // aparte del de Checklists.
  if (!puede(usuario, 'reportes') && !puede(usuario, 'transito_reportes')) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
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
  if (!puede(usuario, 'reportes') && llenado.plantilla_clave !== 'transito') {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }

  // Con sus datos: un envío muestra sus secciones, no también las de la colecta.
  llenado.plantilla = plantillaCompleta(llenado.plantilla_clave, llenado.activo_id, JSON.parse(llenado.datos || '{}'));
  llenado.respuestas = db.prepare('SELECT item_id, columna, valor, observacion FROM respuestas WHERE llenado_id = ?').all(llenado.id);
  llenado.firmas = db.prepare('SELECT rol, nombre, imagen, firmado_en FROM firmas WHERE llenado_id = ?').all(llenado.id);
  llenado.fotos = fotosDe(llenado.id);
  llenado.revisiones = revisionesDe(llenado.id);
  json(res, 200, llenado);
});

// Vigencias: el último valor capturado de cada ítem de fecha marcado como
// vigencia, por unidad. Interesa el más reciente, no el historial: lo que importa
// es si HOY la afiliación sigue al corriente.
ruta('GET', '/api/reportes/vigencias', (req, res) => {
  if (!exigir(req, res, 'reportes')) return;

  const filas = db.prepare(`
    SELECT i.texto AS concepto, i.meta,
           COALESCE(a.nombre, '—') AS unidad, a.id AS activo_id,
           r.valor AS fecha, l.periodo, l.creado_en, u.nombre AS capturo
    FROM respuestas r
    JOIN items i      ON i.id = r.item_id
    JOIN llenados l   ON l.id = r.llenado_id
    JOIN usuarios u   ON u.id = l.usuario_id
    LEFT JOIN activos a ON a.id = l.activo_id
    WHERE i.tipo_respuesta = 'fecha' AND r.valor IS NOT NULL AND TRIM(r.valor) <> ''
      AND l.revision = 'aprobado'
    ORDER BY l.creado_en DESC
  `).all();

  // Solo el último por concepto + unidad.
  const ultimos = new Map();
  for (const f of filas) {
    const llave = `${f.concepto}|${f.activo_id || 0}`;
    if (!ultimos.has(llave)) ultimos.set(llave, f);
  }

  // Unidades que aún no lo tienen capturado: no aparecerían en la consulta de
  // arriba, y justo esas son las que hay que perseguir.
  const conceptos = db.prepare(`
    SELECT DISTINCT i.texto AS concepto, i.meta, p.aplica_a
    FROM items i
    JOIN secciones s  ON s.id = i.seccion_id
    JOIN plantillas p ON p.id = s.plantilla_id
    WHERE i.tipo_respuesta = 'fecha' AND i.activo = 1 AND s.activo = 1 AND p.activo = 1
  `).all();
  const activos = db.prepare('SELECT id, nombre, tipo FROM activos WHERE activo = 1').all();

  const vigencias = [];
  for (const c of conceptos) {
    const meta = JSON.parse(c.meta || '{}');
    const unidades = c.aplica_a ? activos.filter((x) => x.tipo === c.aplica_a) : [null];
    for (const unidad of unidades) {
      const registro = ultimos.get(`${c.concepto}|${unidad ? unidad.id : 0}`);
      vigencias.push({
        concepto: c.concepto,
        etiqueta: meta.etiqueta || 'Vigencia',
        unidad: unidad ? unidad.nombre : '—',
        fecha: registro ? registro.fecha : null,
        capturo: registro ? registro.capturo : null,
        capturado_en: registro ? registro.periodo : null,
        ...describirVigencia(registro ? registro.fecha : null),
      });
    }
  }

  const orden = { vencida: 0, vence_hoy: 1, por_vencer: 2, sin_dato: 3, vigente: 4 };
  vigencias.sort((x, y) => (orden[x.estado] - orden[y.estado]) || ((x.dias ?? 9e9) - (y.dias ?? 9e9)));
  json(res, 200, vigencias);
});

// --- comparativa entre semanas ---

// Semanas que tienen algo capturado, de la más reciente a la más antigua.
ruta('GET', '/api/reportes/periodos', (req, res) => {
  if (!exigir(req, res, 'comparativa')) return;
  const semanas = db
    .prepare("SELECT DISTINCT semana FROM llenados WHERE semana IS NOT NULL AND revision = 'aprobado' ORDER BY semana DESC")
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
             WHERE l2.semana = l.semana AND l2.revision = 'aprobado' AND r.valor IN ('problema', 'no')) AS problemas,
           (SELECT COUNT(*) FROM fotos f
             JOIN llenados l3 ON l3.id = f.llenado_id
             WHERE l3.semana = l.semana AND l3.revision = 'aprobado') AS fotos
    FROM llenados l
    WHERE l.semana IN (${huecos}) AND l.revision = 'aprobado'
    GROUP BY l.semana
  `).all(...semanas);

  const porUnidad = db.prepare(`
    SELECT l.semana, p.nombre AS plantilla, COALESCE(a.nombre, '—') AS unidad,
           COUNT(*) AS problemas
    FROM respuestas r
    JOIN llenados l   ON l.id = r.llenado_id
    JOIN plantillas p ON p.id = l.plantilla_id
    LEFT JOIN activos a ON a.id = l.activo_id
    WHERE r.valor IN ('problema', 'no') AND l.semana IN (${huecos}) AND l.revision = 'aprobado'
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
    WHERE r.valor IN ('problema', 'no') AND l.semana IN (${huecos}) AND l.revision = 'aprobado'
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
    WHERE p.clave = 'cajas' AND r.columna = 'cierre' AND l.revision = 'aprobado'
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
    `SELECT CASE WHEN revision = 'aprobado' THEN 'cerrado'
                 WHEN revision = 'por_aprobar' THEN 'por aprobar'
                 WHEN revision = 'modificacion' THEN 'en corrección'
                 ELSE estado END AS estado
       FROM llenados WHERE plantilla_id = ? AND COALESCE(activo_id, 0) = ? AND semana = ?`
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
    WHERE (? IS NULL OR p.clave = ?) AND l.revision = 'aprobado'
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

// ------------------------------------------------------------------ calidad

// Tamaño de muestra: raíz cuadrada del lote redondeada hacia arriba. Es la
// misma regla que traía el Excel — ROUNDUP(SQRT(n)) —, pero calculada aquí para
// que nadie pueda escribir a mano un número más chico encima de la fórmula.
const tamanoMuestra = (total) => (total > 0 ? Math.ceil(Math.sqrt(total)) : 0);

// Las tres opciones del menú desplegable de la hoja de papel.
const MEDIDAS_CENTRO = ['1/2 PULGADA', '1 PULGADA', '1.5 PULGADAS'];

// Qué se hace con un lote rechazado.
const DISPOSICIONES = [
  { clave: 'devuelto', etiqueta: 'Devuelto al proveedor' },
  { clave: 'concesion', etiqueta: 'Aceptado con concesión' },
  { clave: 'reclamo', etiqueta: 'Reclamo / nota de crédito' },
  { clave: 'reproceso', etiqueta: 'Reproceso o selección' },
];
const ETIQUETA_DISPOSICION = Object.fromEntries(DISPOSICIONES.map((d) => [d.clave, d.etiqueta]));

// Las dos firmas de la hoja. 'calidad' es quien la llenó — el renglón "Elaboró"
// del papel. 'autorizacion' es la que decía "Firma Coordinador"; como ese perfil
// ya no existe, hoy la levanta un Team Leader.
const FIRMAS_CALIDAD = {
  calidad: 'calidad_capturar',
  autorizacion: 'calidad_autorizar',
};

function recepcionCompleta(id) {
  const recepcion = db.prepare(`
    SELECT r.*, u.nombre AS capturo, c.nombre AS cerro, a.nombre AS aprobo
    FROM recepciones r
    JOIN usuarios u ON u.id = r.usuario_id
    LEFT JOIN usuarios c ON c.id = r.cerrado_por
    LEFT JOIN usuarios a ON a.id = r.aprobado_por
    WHERE r.id = ?
  `).get(id);
  if (!recepcion) return null;

  recepcion.lotes = db.prepare(`
    SELECT l.*, m.modelo, m.imagen AS imagen_material, m.color_impresion, m.marca_termino, m.tipo_centro,
           m.gap, m.cant_x_rollo, m.diam_referencia, m.centro_referencia,
           d.nombre AS propuso, f.nombre AS aprobo
    FROM lotes l
    JOIN materiales m ON m.id = l.material_id
    LEFT JOIN usuarios d ON d.id = l.propuesto_por
    LEFT JOIN usuarios f ON f.id = l.aprobado_por
    WHERE l.recepcion_id = ? ORDER BY l.orden, l.id
  `).all(id).map((l) => ({
    ...l,
    etiqueta_propuesta: l.propuesta ? ETIQUETA_DISPOSICION[l.propuesta] : null,
    etiqueta_disposicion: l.disposicion ? ETIQUETA_DISPOSICION[l.disposicion] : null,
  }));

  // Lo que llegó en la entrada y no se muestrea: Calidad confirma cuánto llegó bien.
  recepcion.sin_muestreo = db.prepare(`
    SELECT s.*, p.nombre AS producto, p.sku, p.modelo, p.tipo_material
      FROM recepcion_sin_muestreo s JOIN almacen_productos p ON p.id = s.producto_id
     WHERE s.recepcion_id = ? ORDER BY s.orden, s.id
  `).all(id);
  recepcion.reversiones = historialDe('recepcion_reabierta', id);
  recepcion.firmas = db
    .prepare('SELECT rol, nombre, imagen, firmado_en FROM firmas_calidad WHERE recepcion_id = ?')
    .all(id);
  recepcion.fotos = db
    .prepare('SELECT id, lote_id, archivo FROM fotos_calidad WHERE recepcion_id = ? ORDER BY id')
    .all(id);
  return recepcion;
}

// Lo que impide cerrar una recepción. Se devuelve la lista completa y no el
// primer tropiezo: quien captura prefiere ver todo lo que le falta de una vez.
function faltantesDeRecepcion(recepcion) {
  const faltas = [];
  const sinMuestreo = recepcion.sin_muestreo || [];
  if (!recepcion.lotes.length && !sinMuestreo.length) faltas.push('Agrega al menos un lote.');
  for (const sm of sinMuestreo) {
    if (sm.cantidad_buena === null || sm.cantidad_buena === undefined) {
      faltas.push(`«${sm.producto}»: falta anotar cuánto llegó bien.`);
    } else if (sm.cantidad_buena < sm.cantidad && !(sm.observacion || '').trim()) {
      faltas.push(`«${sm.producto}»: llegó bien menos de lo que decía la entrada; explica qué pasó.`);
    }
  }

  for (const l of recepcion.lotes) {
    const cual = `«${l.modelo}${l.fondo ? ' ' + l.fondo : ''}»`;
    if (!l.total_lote) { faltas.push(`${cual}: falta anotar cuánto llegó.`); continue; }
    if (!(l.diametro || '').trim()) faltas.push(`${cual}: falta el diámetro medido.`);
    if (!l.medida_centro) faltas.push(`${cual}: falta la medida del centro.`);
    if (!l.nitida) faltas.push(`${cual}: falta contestar si la impresión es nítida.`);
    if (!l.resultado) faltas.push(`${cual}: falta el resultado.`);

    // Un rechazo sin motivo escrito ni foto no le sirve a nadie después: es
    // exactamente lo que se perdía en papel cuando solo se tachaba la casilla.
    if (l.resultado === 'rechazado') {
      if (!(l.observacion || '').trim()) faltas.push(`${cual}: un lote rechazado necesita observación escrita.`);
      if (!recepcion.fotos.some((f) => f.lote_id === l.id)) faltas.push(`${cual}: un lote rechazado necesita foto del defecto.`);
    }
  }
  return faltas;
}

const hayRechazo = (recepcion) => recepcion.lotes.some((l) => l.resultado === 'rechazado');

// La recepción tiene que estar abierta para modificarse. Devuelve null y
// contesta el error si no lo está, igual que hace exigir() con los permisos.
function recepcionAbierta(res, id) {
  const recepcion = db.prepare('SELECT * FROM recepciones WHERE id = ?').get(id);
  if (!recepcion) { json(res, 404, { error: 'Recepción no encontrada' }); return null; }
  if (recepcion.estado !== 'borrador') { json(res, 409, { error: 'Esta recepción ya fue cerrada.' }); return null; }
  return recepcion;
}

ruta('GET', '/api/calidad/catalogos', (req, res) => {
  if (!exigir(req, res, 'mod_calidad')) return;
  const lista = (tipo) => db
    .prepare('SELECT valor FROM catalogo_calidad WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
    .all(tipo).map((f) => f.valor);

  json(res, 200, {
    materiales: db.prepare(`
      SELECT id, modelo, imagen, color_impresion, marca_termino, tipo_centro, gap,
             cant_x_rollo, colores, diam_referencia, centro_referencia
      FROM materiales WHERE activo = 1 ORDER BY orden, modelo
    `).all(),
    proveedores: lista('proveedor'),
    fondos: lista('fondo'),
    medidas_centro: MEDIDAS_CENTRO,
    disposiciones: DISPOSICIONES,
  });
});

ruta('GET', '/api/calidad/recepciones', (req, res) => {
  if (!exigir(req, res, 'mod_calidad')) return;
  json(res, 200, {
    recepciones: db.prepare(`
      SELECT r.id, r.remision, r.proveedor, r.fecha_llegada, r.estado, r.creado_en,
             u.nombre AS capturo,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id) AS lotes,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id AND l.resultado = 'rechazado') AS rechazados,
             (SELECT COUNT(*) FROM recepcion_sin_muestreo s WHERE s.recepcion_id = r.id) AS sin_muestreo,
             r.entrada_id
      FROM recepciones r
      JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.estado <> 'cancelada'
      ORDER BY r.estado = 'cerrado', r.fecha_llegada DESC, r.id DESC
      LIMIT 60
    `).all(),
    // Lo que espera al Administrador: recepciones sin visto bueno y rechazos sin
    // aprobar. Va aquí para que el aviso salga en la portada del módulo sin
    // pedir la lista completa.
    pendientes: db.prepare(`
      SELECT (SELECT COUNT(*) FROM recepciones WHERE estado = 'cerrado')
           + (SELECT COUNT(*) FROM lotes l
              JOIN recepciones r ON r.id = l.recepcion_id
              WHERE l.resultado = 'rechazado' AND r.estado NOT IN ('borrador', 'cancelada') AND l.aprobado_en IS NULL) AS n
    `).get().n,
  });
});

ruta('POST', '/api/calidad/recepciones', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_capturar');
  if (!usuario) return;

  const remision = String(cuerpo.remision || '').trim();
  const proveedor = String(cuerpo.proveedor || '').trim();
  const fecha = String(cuerpo.fecha_llegada || '').trim();
  if (!remision || !proveedor || !fecha) return json(res, 400, { error: 'Falta remisión, proveedor o fecha de llegada.' });

  try {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO recepciones (remision, proveedor, fecha_llegada, usuario_id, creado_en)
      VALUES (?, ?, ?, ?, ?)
    `).run(remision, proveedor, fecha, usuario.id, new Date().toISOString());
    json(res, 200, { id: Number(lastInsertRowid) });
  } catch {
    // El UNIQUE de (proveedor, remisión) evita capturar dos veces el mismo
    // camión, que en papel pasaba cuando alguien retomaba una hoja a medias.
    const previa = db.prepare('SELECT id FROM recepciones WHERE proveedor = ? AND remision = ?').get(proveedor, remision);
    json(res, 409, { error: `Ya existe una recepción con la remisión ${remision} de ${proveedor}.`, id: previa && previa.id });
  }
});

ruta('GET', '/api/calidad/recepciones/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'mod_calidad')) return;
  const recepcion = recepcionCompleta(Number(p[1]));
  if (!recepcion) return json(res, 404, { error: 'Recepción no encontrada' });
  json(res, 200, { recepcion, faltantes: faltantesDeRecepcion(recepcion), exige_autorizacion: hayRechazo(recepcion) });
});

ruta('PUT', '/api/calidad/recepciones/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'calidad_capturar')) return;
  const recepcion = recepcionAbierta(res, Number(p[1]));
  if (!recepcion) return;

  db.prepare('UPDATE recepciones SET remision = ?, proveedor = ?, fecha_llegada = ?, notas = ? WHERE id = ?').run(
    String(cuerpo.remision ?? recepcion.remision).trim(),
    String(cuerpo.proveedor ?? recepcion.proveedor).trim(),
    String(cuerpo.fecha_llegada ?? recepcion.fecha_llegada).trim(),
    cuerpo.notas ?? recepcion.notas,
    recepcion.id
  );
  json(res, 200, { ok: true });
});

ruta('POST', '/api/calidad/recepciones/(\\d+)/lotes', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'calidad_capturar')) return;
  const recepcion = recepcionAbierta(res, Number(p[1]));
  if (!recepcion) return;

  const material = db.prepare('SELECT id FROM materiales WHERE id = ? AND activo = 1').get(Number(cuerpo.material_id));
  if (!material) return json(res, 400, { error: 'Ese modelo no está en el catálogo.' });

  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM lotes WHERE recepcion_id = ?').get(recepcion.id).n + 1;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO lotes (recepcion_id, material_id, fondo, orden) VALUES (?, ?, ?, ?)'
  ).run(recepcion.id, material.id, cuerpo.fondo || null, orden);
  json(res, 200, { id: Number(lastInsertRowid) });
});

// Campos que la tablet puede escribir en un lote. Fuera de esta lista no entra
// nada: el total y la muestra los calcula el servidor, y la disposición de un
// rechazo tiene su propia ruta con su propio permiso.
const CAMPOS_LOTE = ['fondo', 'diametro', 'medida_centro', 'nitida', 'resultado', 'observacion'];
const CANTIDADES_LOTE = ['cant_cajas', 'rollos_x_caja', 'cant_rollos'];

ruta('PUT', '/api/calidad/lotes/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'calidad_capturar')) return;

  const lote = db.prepare('SELECT l.*, r.estado FROM lotes l JOIN recepciones r ON r.id = l.recepcion_id WHERE l.id = ?').get(Number(p[1]));
  if (!lote) return json(res, 404, { error: 'Lote no encontrado' });
  if (lote.estado !== 'borrador') return json(res, 409, { error: 'Esta recepción ya fue cerrada.' });

  if (cuerpo.medida_centro && !MEDIDAS_CENTRO.includes(cuerpo.medida_centro)) {
    return json(res, 400, { error: 'Medida de centro desconocida' });
  }
  if (cuerpo.resultado && !['aprobado', 'rechazado'].includes(cuerpo.resultado)) {
    return json(res, 400, { error: 'Resultado desconocido' });
  }
  if (cuerpo.nitida && !['si', 'no'].includes(cuerpo.nitida)) {
    return json(res, 400, { error: 'Respuesta desconocida' });
  }

  const valores = { ...lote };
  for (const campo of CAMPOS_LOTE) {
    if (campo in cuerpo) valores[campo] = cuerpo[campo] === '' ? null : cuerpo[campo];
  }
  for (const campo of CANTIDADES_LOTE) {
    if (campo in cuerpo) {
      const n = Number(cuerpo[campo]);
      valores[campo] = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }

  // Misma cuenta que la hoja: si se anotó el total de rollos manda ese; si no,
  // cajas por rollos por caja.
  const total = valores.cant_rollos || (valores.cant_cajas || 0) * (valores.rollos_x_caja || 0);
  valores.total_lote = total > 0 ? total : null;
  valores.muestra = tamanoMuestra(total);

  if (valores.resultado !== 'rechazado' && lote.resultado === 'rechazado') {
    db.prepare(`
      UPDATE lotes SET propuesta = NULL, propuesta_nota = NULL, propuesto_por = NULL,
                       propuesto_en = NULL, disposicion = NULL, disposicion_nota = NULL,
                       aprobado_por = NULL, aprobado_en = NULL
      WHERE id = ?
    `).run(lote.id);
  }

  db.prepare(`
    UPDATE lotes SET fondo = ?, cant_cajas = ?, rollos_x_caja = ?, cant_rollos = ?,
                     total_lote = ?, muestra = ?, diametro = ?, medida_centro = ?,
                     nitida = ?, resultado = ?, observacion = ?
    WHERE id = ?
  `).run(
    valores.fondo, valores.cant_cajas, valores.rollos_x_caja, valores.cant_rollos,
    valores.total_lote, valores.muestra, valores.diametro, valores.medida_centro,
    valores.nitida, valores.resultado, valores.observacion, lote.id
  );
  json(res, 200, { ok: true, total_lote: valores.total_lote, muestra: valores.muestra });
});

ruta('DELETE', '/api/calidad/lotes/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'calidad_capturar')) return;
  const lote = db.prepare('SELECT l.id, r.estado FROM lotes l JOIN recepciones r ON r.id = l.recepcion_id WHERE l.id = ?').get(Number(p[1]));
  if (!lote) return json(res, 404, { error: 'Lote no encontrado' });
  if (lote.estado !== 'borrador') return json(res, 409, { error: 'Esta recepción ya fue cerrada.' });

  for (const f of db.prepare('SELECT archivo FROM fotos_calidad WHERE lote_id = ?').all(lote.id)) {
    fs.rm(path.join(carpetaFotos(), f.archivo), { force: true }, () => {});
  }
  db.prepare('DELETE FROM lotes WHERE id = ?').run(lote.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/calidad/recepciones/(\\d+)/firma', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;

  const permisoNecesario = FIRMAS_CALIDAD[cuerpo.rol];
  if (!permisoNecesario) return json(res, 400, { error: 'Tipo de firma desconocido' });
  if (!puede(usuario, permisoNecesario)) {
    return json(res, 403, {
      error: cuerpo.rol === 'autorizacion'
        ? 'Solo un Team Leader o el Administrador puede levantar la firma de autorización.'
        : 'Tu perfil no puede firmar aquí.',
    });
  }
  if (!recepcionAbierta(res, Number(p[1]))) return;
  if (!cuerpo.imagen || !String(cuerpo.imagen).startsWith('data:image/')) {
    return json(res, 400, { error: 'Firma inválida' });
  }

  db.prepare(`
    INSERT INTO firmas_calidad (recepcion_id, rol, usuario_id, nombre, imagen, firmado_en)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (recepcion_id, rol)
    DO UPDATE SET usuario_id = excluded.usuario_id, nombre = excluded.nombre,
                  imagen = excluded.imagen, firmado_en = excluded.firmado_en
  `).run(Number(p[1]), cuerpo.rol, usuario.id, cuerpo.nombre || usuario.nombre, cuerpo.imagen, new Date().toISOString());
  json(res, 200, { ok: true });
});

ruta('POST', '/api/calidad/lotes/(\\d+)/fotos', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_capturar');
  if (!usuario) return;

  const lote = db.prepare('SELECT l.id, l.recepcion_id, r.estado FROM lotes l JOIN recepciones r ON r.id = l.recepcion_id WHERE l.id = ?').get(Number(p[1]));
  if (!lote) return json(res, 404, { error: 'Lote no encontrado' });
  if (lote.estado !== 'borrador') return json(res, 409, { error: 'Esta recepción ya fue cerrada.' });

  const guardado = guardarArchivoSubido(cuerpo.imagen);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO fotos_calidad (recepcion_id, lote_id, archivo, bytes, subida_por, subida_en)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lote.recepcion_id, lote.id, guardado.archivo, guardado.bytes, usuario.id, new Date().toISOString());

  json(res, 200, { id: Number(lastInsertRowid), archivo: guardado.archivo, lote_id: lote.id, bytes: guardado.bytes });
});

ruta('DELETE', '/api/calidad/fotos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'calidad_capturar')) return;
  const foto = db.prepare(`
    SELECT f.id, f.archivo, r.estado FROM fotos_calidad f
    JOIN recepciones r ON r.id = f.recepcion_id WHERE f.id = ?
  `).get(Number(p[1]));
  if (!foto) return json(res, 404, { error: 'Foto no encontrada' });
  if (foto.estado !== 'borrador') return json(res, 409, { error: 'Esta recepción ya fue cerrada.' });

  db.prepare('DELETE FROM fotos_calidad WHERE id = ?').run(foto.id);
  fs.rm(path.join(carpetaFotos(), foto.archivo), { force: true }, () => {});
  json(res, 200, { ok: true });
});

ruta('POST', '/api/calidad/recepciones/(\\d+)/cerrar', (req, res, p) => {
  const usuario = exigir(req, res, 'calidad_capturar');
  if (!usuario) return;
  const id = Number(p[1]);

  const recepcion = recepcionCompleta(id);
  if (!recepcion) return json(res, 404, { error: 'Recepción no encontrada' });
  if (recepcion.estado !== 'borrador') return json(res, 409, { error: 'Esta recepción ya fue cerrada.' });

  const faltas = faltantesDeRecepcion(recepcion);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });

  const firmas = recepcion.firmas.map((f) => f.rol);
  if (!firmas.includes('calidad')) return json(res, 400, { error: 'Falta la firma de quien hizo el muestreo.' });

  // La firma de autorización se exige solo cuando hay algún lote rechazado. Un
  // camión que llegó bien no tiene por qué esperar a que haya un Team Leader
  // disponible; uno con material defectuoso, sí: ahí empieza una reclamación.
  if (hayRechazo(recepcion) && !firmas.includes('autorizacion')) {
    return json(res, 400, { error: 'Hay lotes rechazados: falta la firma de autorización del Team Leader.' });
  }

  db.prepare("UPDATE recepciones SET estado = 'cerrado', cerrado_en = ?, cerrado_por = ? WHERE id = ?")
    .run(new Date().toISOString(), usuario.id, id);
  json(res, 200, { ok: true, estado: 'cerrado' });
});

// --- lo que espera al Administrador ---

// Un lote rechazado pasa por tres momentos: alguien cercano al material PROPONE
// qué hacer con él, el Administrador APRUEBA —pudiendo cambiar la salida— y con
// eso queda cerrado. La última palabra es siempre del Administrador.
const momentoDelLote = (l) => (l.aprobado_en ? 'cerrado' : l.propuesta ? 'por_aprobar' : 'por_proponer');

function lotesRechazados() {
  return db.prepare(`
    SELECT l.id, l.fondo, l.total_lote, l.muestra, l.observacion,
           l.propuesta, l.propuesta_nota, l.propuesto_en,
           l.disposicion, l.disposicion_nota, l.aprobado_en,
           m.modelo, r.id AS recepcion_id, r.remision, r.proveedor, r.fecha_llegada,
           pr.nombre AS propuso, ap.nombre AS aprobo
    FROM lotes l
    JOIN recepciones r ON r.id = l.recepcion_id
    JOIN materiales m ON m.id = l.material_id
    LEFT JOIN usuarios pr ON pr.id = l.propuesto_por
    LEFT JOIN usuarios ap ON ap.id = l.aprobado_por
    WHERE l.resultado = 'rechazado' AND r.estado NOT IN ('borrador', 'cancelada')
    ORDER BY l.aprobado_en IS NOT NULL, r.fecha_llegada DESC, l.id DESC
    LIMIT 200
  `).all().map((f) => ({
    ...f,
    momento: momentoDelLote(f),
    etiqueta_propuesta: f.propuesta ? ETIQUETA_DISPOSICION[f.propuesta] : null,
    etiqueta_disposicion: f.disposicion ? ETIQUETA_DISPOSICION[f.disposicion] : null,
    fotos: db.prepare('SELECT id, archivo FROM fotos_calidad WHERE lote_id = ?').all(f.id),
  }));
}

const historialDe = (tipo, id) => db.prepare(`
  SELECT v.motivo, v.ocurrido_en, u.nombre FROM reversiones_calidad v
  LEFT JOIN usuarios u ON u.id = v.usuario_id
  WHERE v.tipo = ? AND v.referencia_id = ? ORDER BY v.id DESC
`).all(tipo, id);

const anotarReversion = sentencia(`
  INSERT INTO reversiones_calidad (tipo, referencia_id, motivo, usuario_id, ocurrido_en)
  VALUES (?, ?, ?, ?, ?)
`);

// Confirmar lo que no se muestrea: cuánto llegó bien. Si llegó menos, se explica.
ruta('PUT', '/api/calidad/sin-muestreo/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'calidad_capturar')) return;
  const sm = db.prepare('SELECT * FROM recepcion_sin_muestreo WHERE id = ?').get(Number(p[1]));
  if (!sm) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!recepcionAbierta(res, sm.recepcion_id)) return;

  const valor = cuerpo.cantidad_buena === null || cuerpo.cantidad_buena === '' || cuerpo.cantidad_buena === undefined
    ? null : Math.trunc(Number(cuerpo.cantidad_buena));
  if (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > sm.cantidad)) {
    return json(res, 400, { error: `Anota entre 0 y ${sm.cantidad}: es lo que decía la entrada.` });
  }
  db.prepare('UPDATE recepcion_sin_muestreo SET cantidad_buena = ?, observacion = ? WHERE id = ?')
    .run(valor, String(cuerpo.observacion ?? sm.observacion ?? '').trim() || null, sm.id);
  json(res, 200, { renglon: db.prepare('SELECT * FROM recepcion_sin_muestreo WHERE id = ?').get(sm.id) });
});

// Lo que regresó de ventas directas y está en Calidad o ya revisado.
ruta('GET', '/api/calidad/devoluciones', (req, res) => {
  const usuario = exigir(req, res, 'mod_calidad');
  if (!usuario) return;
  json(res, 200, {
    devoluciones: db.prepare(`
      SELECT d.id, d.folio, d.fecha, d.estado, d.quien, d.motivo, d.creado_en,
             o.folio AS orden_folio, u.nombre AS capturo, b.nombre AS bodega,
             (SELECT COUNT(*) FROM almacen_devolucion_renglones r WHERE r.devolucion_id = d.id) AS productos
        FROM almacen_devoluciones d
        LEFT JOIN vxf_ordenes o ON o.id = d.vxf_id
        JOIN usuarios u ON u.id = d.usuario_id
        JOIN almacen_bodegas b ON b.id = d.bodega_id
       WHERE d.origen = 'venta_directa' ORDER BY d.id DESC LIMIT 60
    `).all(),
    // Las ventas que ya salieron: de una de ellas regresa el material.
    ordenes: db.prepare(`
      SELECT id, folio, cliente, fecha_solicitud FROM vxf_ordenes
       WHERE estado NOT IN ('borrador', 'cancelada') ORDER BY id DESC LIMIT 200
    `).all(),
    bodegas: bodegasActivas(),
    puede_capturar: puede(usuario, 'calidad_capturar'),
  });
});

ruta('GET', '/api/calidad/pendientes', (req, res) => {
  if (!exigir(req, res, 'mod_calidad')) return;
  const lotes = lotesRechazados();

  json(res, 200, {
    disposiciones: DISPOSICIONES,
    // Recepciones cerradas por almacén que todavía esperan el visto bueno.
    recepciones: db.prepare(`
      SELECT r.id, r.remision, r.proveedor, r.fecha_llegada, r.cerrado_en,
             u.nombre AS capturo, c.nombre AS cerro,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id) AS lotes,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id AND l.resultado = 'rechazado') AS rechazados
      FROM recepciones r
      JOIN usuarios u ON u.id = r.usuario_id
      LEFT JOIN usuarios c ON c.id = r.cerrado_por
      WHERE r.estado = 'cerrado'
      ORDER BY r.cerrado_en
    `).all(),
    por_proponer: lotes.filter((l) => l.momento === 'por_proponer'),
    por_aprobar: lotes.filter((l) => l.momento === 'por_aprobar'),
    cerrados: lotes.filter((l) => l.momento === 'cerrado'),
  });
});

// Trae el lote y comprueba que su recepción ya esté cerrada. Mientras siga en
// captura no hay nada que proponer: los datos todavía pueden cambiar.
function loteRechazadoCerrado(res, id) {
  const lote = db.prepare(`
    SELECT l.*, r.estado FROM lotes l JOIN recepciones r ON r.id = l.recepcion_id WHERE l.id = ?
  `).get(id);
  if (!lote) { json(res, 404, { error: 'Lote no encontrado' }); return null; }
  if (lote.resultado !== 'rechazado') { json(res, 400, { error: 'Ese lote no fue rechazado.' }); return null; }
  if (lote.estado === 'borrador') { json(res, 409, { error: 'La recepción todavía está en captura.' }); return null; }
  if (lote.estado === 'cancelada') { json(res, 409, { error: 'Esa recepción se anuló: su entrada se regresó a corregir.' }); return null; }
  return lote;
}

ruta('POST', '/api/calidad/lotes/(\\d+)/propuesta', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_proponer');
  if (!usuario) return;

  const lote = loteRechazadoCerrado(res, Number(p[1]));
  if (!lote) return;
  if (lote.aprobado_en) return json(res, 409, { error: 'Ese lote ya fue aprobado; su decisión no se cambia.' });
  if (!ETIQUETA_DISPOSICION[cuerpo.disposicion]) return json(res, 400, { error: 'Disposición desconocida' });

  db.prepare(`
    UPDATE lotes SET propuesta = ?, propuesta_nota = ?, propuesto_por = ?, propuesto_en = ?
    WHERE id = ?
  `).run(cuerpo.disposicion, (cuerpo.nota || '').trim() || null, usuario.id, new Date().toISOString(), lote.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/calidad/lotes/(\\d+)/aprobar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_aprobar');
  if (!usuario) return;

  const lote = loteRechazadoCerrado(res, Number(p[1]));
  if (!lote) return;
  if (!lote.propuesta) return json(res, 400, { error: 'Todavía nadie ha propuesto qué hacer con ese lote.' });
  if (lote.aprobado_en) return json(res, 409, { error: 'Ese lote ya está cerrado.' });

  // Quien propone no aprueba su propia propuesta. Con los perfiles de hoy no
  // puede pasar —el Administrador no propone—, pero si algún día alguien tuviera
  // los dos permisos, la cadena de dos personas dejaría de existir en silencio.
  if (lote.propuesto_por === usuario.id) {
    return json(res, 403, { error: 'La propuesta la aprueba otra persona, no quien la hizo.' });
  }

  // El Administrador puede aprobar otra salida distinta de la propuesta: es la
  // última palabra, no un visto bueno de trámite. La propuesta original se
  // conserva para que se vea que hubo un cambio de criterio y de quién vino.
  const decision = cuerpo.disposicion || lote.propuesta;
  if (!ETIQUETA_DISPOSICION[decision]) return json(res, 400, { error: 'Disposición desconocida' });

  db.prepare(`
    UPDATE lotes SET disposicion = ?, disposicion_nota = ?, aprobado_por = ?, aprobado_en = ?
    WHERE id = ?
  `).run(decision, (cuerpo.nota || '').trim() || null, usuario.id, new Date().toISOString(), lote.id);

  // Si este era el último lote que le faltaba a una entrada de almacén para
  // saber cuánto material se queda, la entrada se aplica sola. Ver
  // aplicarEntradaDeRecepcion, en el módulo de Almacén.
  const folio = aplicarEntradaDeRecepcion(lote.recepcion_id, usuario.id);
  json(res, 200, {
    ok: true, disposicion: decision, cambiada: decision !== lote.propuesta,
    entrada_aplicada: folio,
  });
});

// El Administrador puede no estar de acuerdo y regresar la propuesta en vez de
// aprobarla. El lote vuelve a quedar esperando que alguien proponga.
ruta('POST', '/api/calidad/lotes/(\\d+)/devolver', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_aprobar');
  if (!usuario) return;

  const lote = loteRechazadoCerrado(res, Number(p[1]));
  if (!lote) return;
  if (!lote.propuesta) return json(res, 400, { error: 'No hay ninguna propuesta que devolver.' });
  if (lote.aprobado_en) return json(res, 409, { error: 'Ese lote ya está cerrado.' });

  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué la devuelves, para que sepan qué corregir.' });

  db.prepare('UPDATE lotes SET propuesta = NULL, propuesta_nota = NULL, propuesto_por = NULL, propuesto_en = NULL WHERE id = ?')
    .run(lote.id);
  anotarReversion.run('propuesta_devuelta', lote.id, motivo, usuario.id, new Date().toISOString());
  json(res, 200, { ok: true });
});

// El Administrador puede deshacer un lote ya cerrado. Vuelve a quedar esperando
// aprobación, con la propuesta original intacta, para decidir otra cosa.
ruta('POST', '/api/calidad/lotes/(\\d+)/reabrir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_aprobar');
  if (!usuario) return;

  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(Number(p[1]));
  if (!lote) return json(res, 404, { error: 'Lote no encontrado' });
  if (!lote.aprobado_en) return json(res, 409, { error: 'Ese lote todavía no estaba cerrado.' });

  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué lo reabres. Queda registrado.' });

  db.prepare('UPDATE lotes SET disposicion = NULL, disposicion_nota = NULL, aprobado_por = NULL, aprobado_en = NULL WHERE id = ?')
    .run(lote.id);
  anotarReversion.run('lote_reabierto', lote.id, motivo, usuario.id, new Date().toISOString());
  json(res, 200, { ok: true });
});

// --- el visto bueno de la recepción completa ---

// Cerrar una recepción es trabajo de almacén: quiere decir «terminé de
// capturar». Darla por buena es otra cosa, y es del Administrador.
ruta('POST', '/api/calidad/recepciones/(\\d+)/aprobar', (req, res, p) => {
  const usuario = exigir(req, res, 'calidad_aprobar');
  if (!usuario) return;

  const recepcion = db.prepare('SELECT * FROM recepciones WHERE id = ?').get(Number(p[1]));
  if (!recepcion) return json(res, 404, { error: 'Recepción no encontrada' });
  if (recepcion.estado === 'borrador') return json(res, 409, { error: 'Esa recepción sigue en captura.' });
  if (recepcion.estado === 'aprobado') return json(res, 409, { error: 'Esa recepción ya tiene tu visto bueno.' });

  db.prepare("UPDATE recepciones SET estado = 'aprobado', aprobado_por = ?, aprobado_en = ? WHERE id = ?")
    .run(usuario.id, new Date().toISOString(), recepcion.id);

  // El visto bueno de Calidad es lo que hace que el material cuente como
  // existencia. Si esta recepción la abrió una entrada de almacén, aquí es donde
  // esa entrada suma al inventario, sin que nadie tenga que ir a rematarla.
  const folio = aplicarEntradaDeRecepcion(recepcion.id, usuario.id);
  json(res, 200, {
    ok: true, estado: 'aprobado',
    entrada_aplicada: folio,
    mensaje: folio ? `La entrada de almacén ${folio} ya sumó al inventario.` : null,
  });
});

// Devuelve una recepción a captura, esté cerrada o ya aprobada. Es la manera de
// corregir un dato mal capturado sin inventar un segundo registro del mismo
// camión, que es justo lo que pasaba en papel: se hacía otra hoja.
ruta('POST', '/api/calidad/recepciones/(\\d+)/reabrir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_aprobar');
  if (!usuario) return;

  const recepcion = db.prepare('SELECT * FROM recepciones WHERE id = ?').get(Number(p[1]));
  if (!recepcion) return json(res, 404, { error: 'Recepción no encontrada' });
  if (recepcion.estado === 'borrador') return json(res, 409, { error: 'Esa recepción ya está abierta.' });
  if (recepcion.estado === 'cancelada') {
    return json(res, 409, { error: 'Esa recepción se anuló porque su entrada se regresó a corregir. La nueva llega cuando se vuelva a aprobar.' });
  }

  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué la reabres. Queda registrado.' });

  // Un lote cuyo destino ya se aprobó no se toca: esa decisión se tomó entre dos
  // y no se deshace de rebote al corregir una fecha. Si hay que deshacerla,
  // existe «reabrir» sobre ese lote en particular.
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE recepciones SET estado = 'borrador', cerrado_en = NULL, cerrado_por = NULL, aprobado_por = NULL, aprobado_en = NULL WHERE id = ?")
      .run(recepcion.id);
    anotarReversion.run('recepcion_reabierta', recepcion.id, motivo, usuario.id, new Date().toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true, estado: 'borrador' });
});

// --- reportes de calidad ---

ruta('GET', '/api/calidad/reportes', (req, res) => {
  if (!exigir(req, res, 'calidad_reportes')) return;
  const desde = new URL(req.url, 'http://x').searchParams.get('desde') || '0000-01-01';

  const lotes = db.prepare(`
    SELECT l.id, l.fondo, l.total_lote, l.muestra, l.diametro, l.medida_centro,
           l.nitida, l.resultado, l.observacion, l.disposicion, l.aprobado_en,
           m.modelo, m.diam_referencia, m.centro_referencia,
           r.id AS recepcion_id, r.remision, r.proveedor, r.fecha_llegada, r.estado
    FROM lotes l
    JOIN recepciones r ON r.id = l.recepcion_id
    JOIN materiales m ON m.id = l.material_id
    WHERE r.estado <> 'cancelada' AND r.fecha_llegada >= ?
    ORDER BY r.fecha_llegada DESC, l.id DESC
    LIMIT 400
  `).all(desde);

  const revisados = lotes.filter((l) => l.resultado);
  const rechazados = revisados.filter((l) => l.resultado === 'rechazado');

  // Índice de rechazo por proveedor: la pregunta que la hoja de papel no podía
  // contestar sin volver a leer todas las hojas del archivero.
  const porProveedor = {};
  for (const l of revisados) {
    const p = (porProveedor[l.proveedor] ||= { proveedor: l.proveedor, lotes: 0, rechazados: 0, rollos: 0 });
    p.lotes++;
    p.rollos += l.total_lote || 0;
    if (l.resultado === 'rechazado') p.rechazados++;
  }

  json(res, 200, {
    lotes,
    resumen: {
      lotes: revisados.length,
      rechazados: rechazados.length,
      rollos: revisados.reduce((n, l) => n + (l.total_lote || 0), 0),
      revisados: revisados.reduce((n, l) => n + (l.muestra || 0), 0),
      sin_resolver: rechazados.filter((l) => !l.aprobado_en).length,
    },
    proveedores: Object.values(porProveedor).sort((a, b) => b.rechazados - a.rechazados || b.lotes - a.lotes),
    etiquetas_disposicion: ETIQUETA_DISPOSICION,
  });
});

ruta('GET', '/api/calidad/exportar.csv', (req, res) => {
  if (!exigir(req, res, 'calidad_reportes')) return;

  const filas = db.prepare(`
    SELECT r.fecha_llegada, r.remision, r.proveedor, r.estado, m.modelo, l.fondo,
           l.cant_cajas, l.rollos_x_caja, l.total_lote, l.muestra, l.diametro,
           l.medida_centro, l.nitida, l.resultado, l.observacion,
           l.propuesta, l.disposicion, l.disposicion_nota, l.aprobado_en,
           u.nombre AS capturo
    FROM lotes l
    JOIN recepciones r ON r.id = l.recepcion_id
    JOIN materiales m ON m.id = l.material_id
    JOIN usuarios u ON u.id = r.usuario_id
    ORDER BY r.fecha_llegada DESC, l.id
  `).all();

  const encabezados = [
    'Fecha de llegada', 'Remisión', 'Proveedor', 'Estado', 'Modelo', 'Fondo',
    'Cajas', 'Rollos por caja', 'Total en lote', 'Cuántos revisar', 'Diámetro',
    'Medida centro', '¿Nítida?', 'Resultado', 'Observación', 'Propuesta',
    'Disposición aprobada', 'Nota de la aprobación', 'Aprobado', 'Capturó',
  ];
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [encabezados.map(celda).join(',')]
    .concat(filas.map((f) => [
      f.fecha_llegada, f.remision, f.proveedor, f.estado, f.modelo, f.fondo,
      f.cant_cajas, f.rollos_x_caja, f.total_lote, f.muestra, f.diametro,
      f.medida_centro, f.nitida, f.resultado, f.observacion,
      f.propuesta ? ETIQUETA_DISPOSICION[f.propuesta] : '',
      f.disposicion ? ETIQUETA_DISPOSICION[f.disposicion] : '',
      f.disposicion_nota, f.aprobado_en, f.capturo,
    ].map(celda).join(',')))
    .join('\r\n');

  // El BOM es lo que hace que Excel abra los acentos bien al dar doble clic.
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="calidad-muestreo.csv"',
  });
  res.end('﻿' + csv);
});

// --- administración de catálogos (usuarios y unidades) ---

ruta('GET', '/api/admin/catalogos', (req, res) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  json(res, 200, {
    // Estado del ingreso: mientras alguien activo no tenga clave, la pantalla
    // de entrada sigue mostrando nombres. Configuración es donde se ve por qué.
    acceso: { modo: accesoPorClave() ? 'clave' : 'lista', faltan: personasSinClave() },
    usuarios: db.prepare(`
      SELECT u.id, u.nombre, u.rol, (u.pin IS NOT NULL) AS tiene_pin, u.activo,
             u.permisos_extra,
             (SELECT COUNT(*) FROM llenados l WHERE l.usuario_id = u.id) AS llenados,
             (SELECT COUNT(*) FROM firmas f WHERE f.usuario_id = u.id) AS firmas
      FROM usuarios u ORDER BY u.activo DESC, u.nombre
    `).all().map((u) => {
      const extra = leerAjustes(u.permisos_extra);
      const efectivos = permisosDe(u.rol, u.permisos_extra);
      const base = (puestoDe(u.rol) || { permisos: {} }).permisos;
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
    activos: db.prepare('SELECT id, clave, nombre, tipo, atributos, activo, imagen FROM activos ORDER BY tipo, nombre').all(),
    // Los puestos (se siguen llamando `roles` aquí porque así los conoce la
    // pantalla de Personas). Cada uno dice cuántas personas lo ocupan.
    roles: listaPuestos().map((p) => ({
      clave: p.clave,
      etiqueta: p.etiqueta,
      descripcion: p.descripcion,
      activo: !!p.activo,
      es_admin: p.clave === PUESTO_ADMIN,
      exige_pin: exigePin(p.clave, '[]'),
      permisos: p.permisos,
      personas: db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol = ? AND activo = 1').get(p.clave).n,
      personas_baja: db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol = ? AND activo = 0').get(p.clave).n,
    })),
  });
});

// --- puestos: crear, renombrar, retirar y cambiar lo que traen ---

// Un puesto nuevo nace copiando otro —incluso el de Administrador—, y de ahí se
// le ajusta módulo por módulo. Copiar al Administrador copia todo lo que se
// puede repartir; lo que es solo del Administrador (Configuración, la
// aprobación final de Calidad, autorizar incidencias) no se copia nunca: ser
// Administrador es el cargo, no una lista de casillas.
ruta('POST', '/api/admin/puestos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  const etiqueta = String(cuerpo.etiqueta || '').trim();
  if (etiqueta.length < 3) return json(res, 400, { error: 'Escribe el nombre del puesto.' });
  if (db.prepare('SELECT 1 FROM puestos WHERE LOWER(etiqueta) = LOWER(?)').get(etiqueta)) {
    return json(res, 400, { error: 'Ya existe un puesto con ese nombre.' });
  }
  const origen = puestoDe(cuerpo.copiar_de || 'operador');
  if (!origen) return json(res, 400, { error: 'El puesto del que se copia no existe.' });

  let permisos;
  if (origen.clave === PUESTO_ADMIN) {
    permisos = {};
    for (const k of PERMISOS_VALIDOS) permisos[k] = !SOLO_ADMIN.has(k);
  } else {
    permisos = permisosCompletos(origen.permisos);
  }
  for (const k of SOLO_ADMIN) permisos[k] = false;
  delete permisos.configuracion;

  const clave = claveDePuesto(etiqueta);
  const orden = db.prepare("SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM puestos WHERE clave <> 'admin'").get().n;
  db.prepare(`
    INSERT INTO puestos (clave, etiqueta, descripcion, permisos, orden, creado_por, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(clave, etiqueta, String(cuerpo.descripcion || '').trim() || null,
    JSON.stringify(permisos), orden, usuario.id, new Date().toISOString());
  json(res, 200, { ok: true, clave });
});

ruta('PUT', '/api/admin/puestos/([\\w]+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  const puesto = puestoDe(p[1]);
  if (!puesto) return json(res, 404, { error: 'Ese puesto no existe.' });
  if (puesto.clave === PUESTO_ADMIN) return json(res, 400, { error: 'El puesto de Administrador no se cambia.' });

  const etiqueta = cuerpo.etiqueta === undefined ? puesto.etiqueta : String(cuerpo.etiqueta).trim();
  if (etiqueta.length < 3) return json(res, 400, { error: 'Escribe el nombre del puesto.' });
  if (db.prepare('SELECT 1 FROM puestos WHERE LOWER(etiqueta) = LOWER(?) AND clave <> ?').get(etiqueta, puesto.clave)) {
    return json(res, 400, { error: 'Ya existe otro puesto con ese nombre.' });
  }
  const descripcion = cuerpo.descripcion === undefined ? puesto.descripcion : (String(cuerpo.descripcion).trim() || null);
  const activo = cuerpo.activo === undefined ? puesto.activo : (cuerpo.activo ? 1 : 0);
  if (!activo) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol = ? AND activo = 1').get(puesto.clave).n;
    if (n) return json(res, 400, { error: `No se puede retirar: ${n} persona(s) activa(s) lo ocupan. Cámbialas de puesto primero.` });
  }
  db.prepare('UPDATE puestos SET etiqueta = ?, descripcion = ?, activo = ? WHERE clave = ?')
    .run(etiqueta, descripcion, activo, puesto.clave);
  json(res, 200, { ok: true });
});

// Borrar solo se puede si nadie lo ha ocupado nunca; si ya tuvo gente, se retira
// (queda en el historial de esas personas).
ruta('DELETE', '/api/admin/puestos/([\\w]+)', (req, res, p) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  const puesto = puestoDe(p[1]);
  if (!puesto) return json(res, 404, { error: 'Ese puesto no existe.' });
  if (puesto.clave === PUESTO_ADMIN) return json(res, 400, { error: 'El puesto de Administrador no se borra.' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol = ?').get(puesto.clave).n;
  if (n) return json(res, 400, { error: `Lo ocupa(n) ${n} persona(s), aunque sea de baja. Retíralo en vez de borrarlo.` });
  db.prepare('DELETE FROM puestos WHERE clave = ?').run(puesto.clave);
  json(res, 200, { ok: true });
});

// Cambiar lo que trae un puesto le cambia la base a TODAS las personas que lo
// ocupan. Los ajustes de cada persona siguen encima: a quien se le dio algo
// aparte lo conserva, y a quien se le quitó sigue sin tenerlo.
ruta('PUT', '/api/admin/puestos/([\\w]+)/permisos', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  const puesto = puestoDe(p[1]);
  if (!puesto) return json(res, 404, { error: 'Ese puesto no existe.' });
  if (puesto.clave === PUESTO_ADMIN) {
    return json(res, 400, { error: 'El Administrador puede todo por su cargo: su puesto no se ajusta.' });
  }
  const cambios = Array.isArray(cuerpo.cambios) ? cuerpo.cambios : [];
  const nuevos = { ...puesto.permisos };
  for (const c of cambios) {
    if (!PERMISOS_VALIDOS.has(c.clave)) return json(res, 400, { error: `El permiso «${c.clave}» no existe.` });
    if (SOLO_ADMIN.has(c.clave) && c.valor) {
      return json(res, 400, { error: `«${ETIQUETA_DE_PERMISO[c.clave]}» es solo del Administrador: no va con ningún otro puesto.` });
    }
    nuevos[c.clave] = !!c.valor;
  }

  // Cada persona del puesto tiene que quedar con al menos un módulo y, si ahora
  // ve información sensible, con clave.
  const personas = db.prepare('SELECT * FROM usuarios WHERE rol = ? AND activo = 1').all(puesto.clave);
  const baseNueva = { ...nuevos, etiqueta: puesto.etiqueta };
  for (const persona of personas) {
    const efectivos = { ...baseNueva, ...leerAjustes(persona.permisos_extra) };
    if (!Object.keys(efectivos).some((k) => k.startsWith('mod_') && efectivos[k])) {
      return json(res, 400, { error: `${persona.nombre} se quedaría sin ningún módulo: no podría entrar a nada.` });
    }
    if (PERMISOS_SENSIBLES.some((k) => efectivos[k]) && !persona.pin) {
      return json(res, 400, { error: `${persona.nombre} necesita clave antes de que su puesto vea Reportes o Configuración.` });
    }
  }
  if (!personas.length && !Object.keys(nuevos).some((k) => k.startsWith('mod_') && nuevos[k])) {
    return json(res, 400, { error: 'El puesto tiene que traer al menos un módulo.' });
  }

  db.prepare('UPDATE puestos SET permisos = ? WHERE clave = ?').run(JSON.stringify(nuevos), puesto.clave);
  // Quien lo ocupa vuelve a entrar, para no seguir con los permisos viejos.
  const ids = new Set(personas.map((x) => x.id));
  cerrarSesionesDe((id) => ids.has(id));
  json(res, 200, { ok: true, guardados: cambios.length, personas: personas.length });
});

ruta('POST', '/api/admin/usuarios', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  if (!cuerpo.nombre || !cuerpo.rol) return json(res, 400, { error: 'Falta nombre o puesto' });
  const puestoNuevo = puestoDe(cuerpo.rol);
  if (!puestoNuevo || !puestoNuevo.activo) return json(res, 400, { error: 'Ese puesto no existe o está retirado' });

  const extra = normalizarExtras(cuerpo.permisos_extra);
  const pin = String(cuerpo.pin || '').trim();
  if (exigePin(cuerpo.rol, extra) && !PIN_VALIDO.test(pin)) {
    return json(res, 400, {
      error: 'Quien ve Reportes, Comparativa, Configuración o los reportes de Calidad necesita una clave de 4 a 12 caracteres (letras o números).',
    });
  }
  if (accesoPorClave() && !PIN_VALIDO.test(pin)) {
    return json(res, 400, {
      error: 'Al sistema se entra con la clave, así que toda persona nueva necesita una de 4 a 12 caracteres (letras o números).',
    });
  }
  if (pin && claveOcupada(pin)) {
    return json(res, 400, {
      error: 'Esa clave ya es de otra persona. La clave dice quién entra, así que no puede repetirse.',
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
    // Los permisos atados al perfil de Administrador se ignoran aquí: la ficha
    // de una persona no es sitio para colarse uno.
    if (PERMISOS_VALIDOS.has(clave) && !SOLO_ADMIN.has(clave)) limpio[clave] = !!valor;
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
  const puestoNuevo = puestoDe(rol);
  if (!puestoNuevo || (!puestoNuevo.activo && rol !== persona.rol)) {
    return json(res, 400, { error: 'Ese puesto no existe o está retirado' });
  }

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
    if (!PIN_VALIDO.test(pin)) return json(res, 400, { error: 'La clave debe ser de 4 a 12 caracteres, letras o números, sin espacios' });
    if (claveOcupada(pin, id)) {
      return json(res, 400, {
        error: 'Esa clave ya es de otra persona. La clave dice quién entra, así que no puede repetirse.',
      });
    }
  }

  if (exigePin(rol, extra) && !pin) {
    return json(res, 400, {
      error: 'Quien ve Reportes, Comparativa, Configuración o los reportes de Calidad necesita clave. Captura una para poder guardar.',
    });
  }

  // Quitarle la clave a alguien activo, ya con el ingreso por clave andando,
  // equivale a dejarlo fuera del sistema sin decírselo. Se bloquea aquí.
  if (!pin && activo && accesoPorClave()) {
    return json(res, 400, {
      error: 'Al sistema se entra con la clave. Si le quitas la suya no podría entrar: asígnale otra o dale de baja.',
    });
  }

  db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, pin = ?, activo = ?, permisos_extra = ? WHERE id = ?')
    .run(nombre, rol, pin, activo, extra, id);

  // Si la persona quedó inactiva o le cambiaron los accesos, sus sesiones
  // abiertas conservarían los permisos viejos hasta caducar. Se cierran ya.
  if (rol !== persona.rol || extra !== (persona.permisos_extra || '[]') || !activo) {
    cerrarSesionesDe((uid) => uid === id);
  }

  json(res, 200, { ok: true });
});

// Activar, retirar o exigir foto en un checklist. Antes esto solo se podía
// hacer corriendo comandos a mano contra la base.
ruta('GET', '/api/admin/plantillas', (req, res) => {
  if (!exigir(req, res, 'configuracion')) return;
  json(res, 200, db.prepare(`
    SELECT p.id, p.clave, p.nombre, p.descripcion, p.frecuencia, p.aplica_a,
           p.foto_obligatoria, p.activo, p.orden, p.tipo_captura,
           p.firma_operador, p.firma_coordinador,
           (SELECT COUNT(*) FROM secciones s JOIN items i ON i.seccion_id = s.id
             WHERE s.plantilla_id = p.id AND i.activo = 1) AS items,
           (SELECT COUNT(*) FROM llenados l WHERE l.plantilla_id = p.id) AS llenados,
           (SELECT etiqueta FROM activo_tipos t WHERE t.clave = p.aplica_a) AS etiqueta_tipo,
           (SELECT COUNT(*) FROM activos a WHERE a.tipo = p.aplica_a AND a.activo = 1) AS unidades
    FROM plantillas p ORDER BY p.activo DESC, p.orden
  `).all());
});

// --- crear un checklist nuevo ---
//
// Desde cero o copiando uno que se parezca. Copiar es lo normal: una moto se
// revisa casi como otra moto, y lo que cambia se ajusta después en el editor.
// Lo pidió Ronaldo el 2-oct-2026, cuando empezaron a entrar tipos de unidad
// nuevos: hasta entonces un checklist nuevo había que escribirlo en el código.
ruta('POST', '/api/admin/plantillas', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;

  const nombre = String(cuerpo.nombre || '').trim();
  if (nombre.length < 4) return json(res, 400, { error: 'Ponle nombre al checklist.' });

  // La clave es con la que el sistema lo nombra por dentro y en la dirección.
  const base = String(cuerpo.clave || nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!base) return json(res, 400, { error: 'El nombre necesita al menos una letra o un número.' });
  let clave = base;
  for (let i = 2; db.prepare('SELECT 1 FROM plantillas WHERE clave = ?').get(clave); i += 1) {
    clave = `${base}-${i}`;
  }

  const FRECUENCIAS = ['diario', 'semanal', 'viernes'];
  const copia = cuerpo.copiar_de
    ? db.prepare('SELECT * FROM plantillas WHERE id = ?').get(Number(cuerpo.copiar_de))
    : null;
  if (cuerpo.copiar_de && !copia) return json(res, 404, { error: 'El checklist que quieres copiar ya no existe.' });

  const aplicaA = String(cuerpo.aplica_a || '').trim() || null;
  if (aplicaA && !db.prepare('SELECT 1 FROM activo_tipos WHERE clave = ?').get(aplicaA)) {
    return json(res, 400, { error: 'Ese tipo de unidad no existe.' });
  }
  const frecuencia = FRECUENCIAS.includes(cuerpo.frecuencia) ? cuerpo.frecuencia
    : (copia ? copia.frecuencia : 'semanal');

  let id;
  db.exec('BEGIN');
  try {
    const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM plantillas').get().n;
    id = Number(db.prepare(`
      INSERT INTO plantillas (clave, nombre, descripcion, tipo_captura, frecuencia, aplica_a,
                              firma_operador, firma_coordinador, foto_obligatoria, orden, activo,
                              campos, por_etapas, requiere_supervision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(clave, nombre, String(cuerpo.descripcion || '').trim() || (copia ? copia.descripcion : null),
      copia ? copia.tipo_captura : 'items', frecuencia, aplicaA,
      cuerpo.firma_operador === undefined ? (copia ? copia.firma_operador : 1) : (cuerpo.firma_operador ? 1 : 0),
      cuerpo.firma_coordinador === undefined ? (copia ? copia.firma_coordinador : 0) : (cuerpo.firma_coordinador ? 1 : 0),
      cuerpo.foto_obligatoria === undefined ? (copia ? copia.foto_obligatoria : 1) : (cuerpo.foto_obligatoria ? 1 : 0),
      orden, copia ? copia.campos : '[]', copia ? copia.por_etapas : 0,
      copia ? copia.requiere_supervision : 0).lastInsertRowid);

    // Copiar es copiar la hoja entera: sus áreas y sus preguntas, con su orden.
    // Lo que NO se copia es lo capturado: el checklist nuevo nace en blanco.
    if (copia) {
      const secciones = db.prepare('SELECT * FROM secciones WHERE plantilla_id = ? ORDER BY orden').all(copia.id);
      const altaSeccion = db.prepare(
        'INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const altaItem = db.prepare(`
        INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta, activo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of secciones) {
        const nueva = Number(altaSeccion.run(id, s.orden, s.titulo, s.etapa, s.condicion, s.activo).lastInsertRowid);
        for (const it of db.prepare('SELECT * FROM items WHERE seccion_id = ? ORDER BY orden').all(s.id)) {
          // Los ítems de una sola unidad no se copian a un checklist de otro
          // tipo: «solo para el ISUZU» no significa nada en una moto.
          const soloActivos = aplicaA && aplicaA !== copia.aplica_a ? null : it.solo_activos;
          altaItem.run(nueva, it.orden, it.texto, it.tipo_respuesta, soloActivos, it.meta, it.activo);
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  json(res, 201, {
    id,
    clave,
    copiado: copia ? copia.nombre : null,
    mensaje: copia
      ? `Checklist creado copiando «${copia.nombre}». Ajusta sus preguntas antes de usarlo.`
      : 'Checklist creado, todavía sin preguntas. Agrégalas en el editor.',
  });
});

// ====================================================================
// LOGÍSTICA
// ====================================================================
//
// Las unidades son de la empresa, no de un módulo: la misma camioneta tiene su
// checklist en Checklists, su gasolina aquí y sus papeles en la Bahía digital.
// Logística es la ficha de cada una y lo que se mide de ella:
//
//   · kilometraje — una sola línea de tiempo, venga del checklist o de una carga;
//   · gasolina    — litros, costo y kilometraje de cada carga, con su ticket;
//   · servicios   — lo que se le hizo y cuándo toca el próximo;
//   · papeles     — tarjeta, póliza, verificación, ACME, ANTRA, fumigación.
//
// El rendimiento NO se captura: se calcula con los kilómetros entre dos cargas
// de tanque lleno y los litros de la segunda. Es la única cuenta honesta —con
// media carga el número no significa nada— y por eso cada carga dice si se llenó.

const TIPOS_SERVICIO = () => catalogoLogistica('tipo_servicio');
const catalogoLogistica = (tipo) => db
  .prepare('SELECT valor FROM logistica_catalogos WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
  .all(tipo).map((f) => f.valor);

const tiposDeUnidad = () => db
  .prepare('SELECT * FROM activo_tipos WHERE activo = 1 ORDER BY orden, etiqueta')
  .all();

const tipoDeUnidad = (clave) => db.prepare('SELECT * FROM activo_tipos WHERE clave = ?').get(clave)
  || { clave, etiqueta: clave, lleva_kilometraje: 1, lleva_combustible: 1 };

// El último kilometraje conocido de una unidad, de donde haya salido.
function kilometrajeDe(activoId) {
  return db.prepare(`
    SELECT kilometros, fecha, origen_tipo FROM logistica_lecturas
     WHERE activo_id = ? ORDER BY kilometros DESC, fecha DESC LIMIT 1
  `).get(activoId) || null;
}

// Las cargas de una unidad, cada una con los kilómetros recorridos desde la
// anterior y su rendimiento. Se calcula aquí y no en la pantalla porque también
// lo usan el reporte y los avisos.
function cargasDe(activoId, limite = 200) {
  const filas = db.prepare(`
    SELECT c.*, u.nombre AS quien, a.nombre AS unidad
      FROM logistica_cargas c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      JOIN activos a ON a.id = c.activo_id
     WHERE c.activo_id = ? ORDER BY c.fecha, c.id
  `).all(activoId);

  let previa = null;
  const conCuenta = filas.map((c) => {
    const kms = previa && c.kilometraje && previa.kilometraje ? c.kilometraje - previa.kilometraje : null;
    // El rendimiento solo cuenta si las dos cargas fueron de tanque lleno: de
    // una carga parcial no se sabe cuánto quedaba en el tanque.
    const sirve = kms !== null && kms > 0 && c.tanque_lleno && previa.tanque_lleno;
    const fila = {
      ...c,
      tanque_lleno: !!c.tanque_lleno,
      precio_litro: c.litros ? Math.round((c.costo / c.litros) * 100) / 100 : null,
      kilometros: kms,
      rendimiento: sirve ? Math.round((kms / c.litros) * 100) / 100 : null,
      costo_km: sirve ? Math.round((c.costo / kms) * 100) / 100 : null,
    };
    previa = c;
    return fila;
  });
  return conCuenta.reverse().slice(0, limite);
}

const serviciosDe = (activoId) => db.prepare(`
  SELECT s.*, u.nombre AS quien FROM logistica_servicios s
    LEFT JOIN usuarios u ON u.id = s.usuario_id
   WHERE s.activo_id = ? ORDER BY COALESCE(s.fecha, s.proxima_fecha) DESC, s.id DESC
`).all(activoId);

const documentosDe = (activoId) => db.prepare(`
  SELECT d.*, u.nombre AS subio FROM logistica_documentos d
    LEFT JOIN usuarios u ON u.id = d.subido_por
   WHERE d.ambito = 'unidad' AND d.activo_id = ? AND d.activo = 1
   ORDER BY d.vence IS NULL, d.vence, d.tipo
`).all(activoId).map((d) => ({ ...d, ...describirVigencia(d.vence) }));

// Los papeles de una unidad vistos de un solo lado: lo que diga su documento
// cargado y, si no hay documento, la fecha que se capturó en el checklist. Dos
// fuentes para lo mismo, y manda la más reciente.
function vigenciasDeUnidad(activoId) {
  const porConcepto = new Map();
  const poner = (concepto, fecha, origen, capturado, quien) => {
    if (!fecha) return;
    const previo = porConcepto.get(concepto);
    if (previo && (previo.capturado || '') >= (capturado || '')) return;
    porConcepto.set(concepto, { concepto, vence: fecha, origen, capturado, quien, ...describirVigencia(fecha) });
  };

  for (const d of db.prepare(`
    SELECT d.tipo, d.vence, d.subido_en, u.nombre AS quien FROM logistica_documentos d
      LEFT JOIN usuarios u ON u.id = d.subido_por
     WHERE d.ambito = 'unidad' AND d.activo_id = ? AND d.activo = 1 AND d.vence IS NOT NULL
  `).all(activoId)) poner(d.tipo, d.vence, 'documento', d.subido_en, d.quien);

  for (const r of db.prepare(`
    SELECT i.texto, i.meta, r.valor, l.creado_en, u.nombre AS quien
      FROM respuestas r
      JOIN items i ON i.id = r.item_id
      JOIN llenados l ON l.id = r.llenado_id
      JOIN usuarios u ON u.id = l.usuario_id
     WHERE i.tipo_respuesta = 'fecha' AND l.activo_id = ? AND l.revision = 'aprobado'
       AND r.valor IS NOT NULL AND TRIM(r.valor) <> ''
     ORDER BY l.creado_en
  `).all(activoId)) {
    let meta = {};
    try { meta = JSON.parse(r.meta || '{}'); } catch { meta = {}; }
    poner(meta.etiqueta || r.texto, r.valor, 'checklist', r.creado_en, r.quien);
  }

  const orden = { vencida: 0, vence_hoy: 1, por_vencer: 2, vigente: 3, sin_dato: 4 };
  return [...porConcepto.values()].sort((a, b) => (orden[a.estado] - orden[b.estado]) || ((a.dias ?? 9e9) - (b.dias ?? 9e9)));
}

// Lo que le toca a una unidad: el servicio programado más cercano, por fecha o
// por kilometraje. Con el kilometraje de hoy se sabe cuánto le falta.
function proximoServicio(activoId) {
  const km = kilometrajeDe(activoId);
  const filas = db.prepare(`
    SELECT * FROM logistica_servicios
     WHERE activo_id = ? AND (proximo_km IS NOT NULL OR proxima_fecha IS NOT NULL)
       AND estado <> 'cumplido'
     ORDER BY COALESCE(proxima_fecha, '9999'), proximo_km
  `).all(activoId);
  if (!filas.length) return null;
  const s = filas[0];
  const faltanKm = s.proximo_km && km ? s.proximo_km - km.kilometros : null;
  const porFecha = s.proxima_fecha ? describirVigencia(s.proxima_fecha) : null;
  return {
    id: s.id,
    tipo: s.tipo,
    proximo_km: s.proximo_km,
    proxima_fecha: s.proxima_fecha,
    faltan_km: faltanKm,
    dias: porFecha ? porFecha.dias : null,
    // Toca cuando ya se pasó la fecha o quedan 500 km o menos.
    urge: (faltanKm !== null && faltanKm <= 500) || (porFecha && porFecha.dias !== null && porFecha.dias <= 7),
    texto: [
      s.proximo_km ? `a los ${numeroMX(s.proximo_km)} km${faltanKm !== null ? ` (faltan ${numeroMX(faltanKm)})` : ''}` : '',
      s.proxima_fecha ? `el ${s.proxima_fecha}${porFecha ? ` · ${porFecha.texto.toLowerCase()}` : ''}` : '',
    ].filter(Boolean).join(' o '),
  };
}

const numeroMX = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-MX'));

// La ficha corta de cada unidad: lo que se ve en la portada de Logística.
function fichaDeUnidad(a) {
  const tipo = tipoDeUnidad(a.tipo);
  const km = kilometrajeDe(a.id);
  const cargas = tipo.lleva_combustible ? cargasDe(a.id, 6) : [];
  const conRendimiento = cargas.filter((c) => c.rendimiento);
  const vigencias = vigenciasDeUnidad(a.id);
  const ultimo = db.prepare(`
    SELECT l.id, l.periodo, l.estado, l.revision, l.creado_en, p.nombre AS checklist, p.clave AS plantilla_clave,
           (SELECT COUNT(*) FROM respuestas r WHERE r.llenado_id = l.id AND r.valor IN ('problema', 'no')) AS problemas
      FROM llenados l JOIN plantillas p ON p.id = l.plantilla_id
     WHERE l.activo_id = ? ORDER BY l.creado_en DESC LIMIT 1
  `).get(a.id);
  return {
    id: a.id,
    clave: a.clave,
    nombre: a.nombre,
    tipo: a.tipo,
    etiqueta_tipo: tipo.etiqueta,
    imagen: a.imagen || null,
    activo: !!a.activo,
    lleva_kilometraje: !!tipo.lleva_kilometraje,
    lleva_combustible: !!tipo.lleva_combustible,
    kilometraje: km ? km.kilometros : null,
    kilometraje_en: km ? km.fecha : null,
    ultima_carga: cargas[0] || null,
    rendimiento: conRendimiento.length
      ? Math.round((conRendimiento.reduce((n, c) => n + c.rendimiento, 0) / conRendimiento.length) * 100) / 100
      : null,
    proximo_servicio: proximoServicio(a.id),
    papeles: { total: vigencias.length, vencidos: vigencias.filter((v) => v.estado === 'vencida').length,
      por_vencer: vigencias.filter((v) => v.estado === 'por_vencer' || v.estado === 'vence_hoy').length },
    ultimo_checklist: ultimo || null,
  };
}

ruta('GET', '/api/logistica', (req, res) => {
  const usuario = exigir(req, res, 'mod_logistica');
  if (!usuario) return;
  const unidades = db.prepare('SELECT * FROM activos ORDER BY activo DESC, tipo, nombre').all()
    .map(fichaDeUnidad);
  const mes = new Date().toISOString().slice(0, 7);
  json(res, 200, {
    tipos: tiposDeUnidad(),
    unidades,
    puede: {
      cargas: puede(usuario, 'logistica_cargas'),
      servicios: puede(usuario, 'logistica_servicios'),
      documentos: puede(usuario, 'logistica_documentos'),
      corregir: puede(usuario, 'logistica_corregir'),
      reportes: puede(usuario, 'logistica_reportes'),
      checklists: puede(usuario, 'llenar'),
      // Las salidas de unidad son lo que era Tránsito: entra quien capture o
      // quien tenga el módulo, que ahora vive aquí dentro.
      salidas: puede(usuario, 'mod_transito') || puede(usuario, 'llenar'),
      rutas: puede(usuario, 'logistica_rutas'),
    },
    cifras: {
      unidades: unidades.filter((u) => u.activo).length,
      papeles_vencidos: unidades.reduce((n, u) => n + u.papeles.vencidos, 0),
      papeles_por_vencer: unidades.reduce((n, u) => n + u.papeles.por_vencer, 0),
      servicios_por_hacer: unidades.filter((u) => u.proximo_servicio && u.proximo_servicio.urge).length,
      gasto_mes: db.prepare("SELECT COALESCE(SUM(costo), 0) AS n FROM logistica_cargas WHERE SUBSTR(fecha, 1, 7) = ?")
        .get(mes).n,
      litros_mes: db.prepare("SELECT COALESCE(SUM(litros), 0) AS n FROM logistica_cargas WHERE SUBSTR(fecha, 1, 7) = ?")
        .get(mes).n,
      salidas_abiertas: db.prepare(`
        SELECT COUNT(*) AS n FROM llenados l JOIN plantillas p ON p.id = l.plantilla_id
         WHERE p.clave = 'transito' AND l.estado <> 'cerrado'
      `).get().n,
      paradas_hoy: db.prepare(`
        SELECT COUNT(*) AS n FROM ruta_paradas p JOIN rutas_entrega r ON r.id = p.ruta_id
         WHERE r.fecha = ? AND r.estado <> 'cancelada' AND p.estado = 'pendiente'
      `).get(hoyISO()).n,
    },
    catalogos: {
      estaciones: catalogoLogistica('estacion'),
      formas_pago: catalogoLogistica('forma_pago'),
      tipos_servicio: catalogoLogistica('tipo_servicio'),
      tipos_documento: catalogoLogistica('documento_unidad'),
    },
    hoy: hoyISO(),
  });
});

// Los nombres y tipos de las unidades, para cualquiera con sesión. Lo pide la
// pantalla de checklists de Logística, a la que entra quien llena —y que no
// tiene por qué ver el gasto de gasolina ni los papeles de toda la flota.
ruta('GET', '/api/logistica/unidades', (req, res) => {
  if (!exigir(req, res)) return;
  json(res, 200, {
    tipos: tiposDeUnidad().map((t) => ({ clave: t.clave, etiqueta: t.etiqueta, plural: t.plural, orden: t.orden })),
    unidades: db.prepare('SELECT id, clave, nombre, tipo FROM activos WHERE activo = 1 ORDER BY tipo, nombre')
      .all().map((a) => ({ ...a, etiqueta_tipo: tipoDeUnidad(a.tipo).etiqueta })),
    // Los checklists de unidad que existen y cuántas unidades tienen. Un
    // checklist sin unidades no sale en la pantalla de llenado —no hay a qué
    // llenárselo—, y antes eso parecía que el checklist no se había creado.
    plantillas: db.prepare(`
      SELECT p.id, p.clave, p.nombre, p.aplica_a, p.frecuencia,
             (SELECT COUNT(*) FROM activos a WHERE a.tipo = p.aplica_a AND a.activo = 1) AS unidades
        FROM plantillas p WHERE p.activo = 1 AND p.aplica_a IS NOT NULL ORDER BY p.orden
    `).all(),
  });
});

ruta('GET', '/api/logistica/unidades/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'mod_logistica');
  if (!usuario) return;
  const a = db.prepare('SELECT * FROM activos WHERE id = ?').get(Number(p[1]));
  if (!a) return json(res, 404, { error: 'Esa unidad no existe.' });
  json(res, 200, {
    unidad: { ...fichaDeUnidad(a), atributos: JSON.parse(a.atributos || '{}') },
    cargas: cargasDe(a.id),
    servicios: serviciosDe(a.id),
    documentos: documentosDe(a.id),
    vigencias: vigenciasDeUnidad(a.id),
    lecturas: db.prepare(`
      SELECT l.*, u.nombre AS quien FROM logistica_lecturas l
        LEFT JOIN usuarios u ON u.id = l.usuario_id
       WHERE l.activo_id = ? ORDER BY l.fecha DESC, l.id DESC LIMIT 30
    `).all(a.id),
    checklists: db.prepare(`
      SELECT l.id, l.periodo, l.estado, l.revision, l.creado_en, p.nombre AS checklist, p.clave AS plantilla_clave,
             u.nombre AS lleno,
             (SELECT COUNT(*) FROM respuestas r WHERE r.llenado_id = l.id AND r.valor IN ('problema', 'no')) AS problemas
        FROM llenados l JOIN plantillas p ON p.id = l.plantilla_id JOIN usuarios u ON u.id = l.usuario_id
       WHERE l.activo_id = ? ORDER BY l.creado_en DESC LIMIT 20
    `).all(a.id),
    catalogos: {
      estaciones: catalogoLogistica('estacion'),
      formas_pago: catalogoLogistica('forma_pago'),
      tipos_servicio: catalogoLogistica('tipo_servicio'),
      tipos_documento: catalogoLogistica('documento_unidad'),
    },
    puede: {
      cargas: puede(usuario, 'logistica_cargas'),
      servicios: puede(usuario, 'logistica_servicios'),
      documentos: puede(usuario, 'logistica_documentos'),
      corregir: puede(usuario, 'logistica_corregir'),
    },
    hoy: hoyISO(),
  });
});

// --- cargas de gasolina ---

function unidadParaLogistica(res, id) {
  const a = db.prepare('SELECT * FROM activos WHERE id = ? AND activo = 1').get(Number(id || 0));
  if (!a) { json(res, 400, { error: 'Escoge la unidad.' }); return null; }
  return a;
}

ruta('GET', '/api/logistica/cargas', (req, res) => {
  if (!exigir(req, res, 'mod_logistica')) return;
  const url = new URL(req.url, 'http://x');
  const unidad = Number(url.searchParams.get('unidad') || 0);
  const todas = db.prepare('SELECT id FROM activos ORDER BY nombre').all()
    .filter((a) => !unidad || a.id === unidad)
    .flatMap((a) => cargasDe(a.id, 50));
  todas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id);
  json(res, 200, { cargas: todas.slice(0, 200) });
});

ruta('POST', '/api/logistica/cargas', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_cargas');
  if (!usuario) return;
  const a = unidadParaLogistica(res, cuerpo.activo_id);
  if (!a) return;

  const litros = Number(String(cuerpo.litros ?? '').replace(',', '.'));
  const costo = Number(String(cuerpo.costo ?? '').replace(',', '.'));
  if (!Number.isFinite(litros) || litros <= 0) return json(res, 400, { error: 'Anota cuántos litros se cargaron.' });
  if (!Number.isFinite(costo) || costo <= 0) return json(res, 400, { error: 'Anota cuánto se pagó.' });
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || '') ? cuerpo.fecha : hoyISO();
  if (fecha > hoyISO()) return json(res, 400, { error: 'La carga no puede tener fecha futura.' });

  const tipo = tipoDeUnidad(a.tipo);
  const km = cuerpo.kilometraje === '' || cuerpo.kilometraje === null || cuerpo.kilometraje === undefined
    ? null : Math.trunc(Number(cuerpo.kilometraje));
  if (tipo.lleva_kilometraje && (!Number.isFinite(km) || km <= 0)) {
    return json(res, 400, { error: 'Anota el kilometraje al cargar: sin él no se puede saber el rendimiento.' });
  }
  // Un kilometraje menor al último conocido casi siempre es un dedazo, y
  // ensucia el rendimiento de las dos cargas. Se avisa en vez de aceptarlo.
  const ultimo = km ? kilometrajeDe(a.id) : null;
  if (ultimo && km < ultimo.kilometros && !cuerpo.forzar) {
    return json(res, 409, {
      error: `El último kilometraje de ${a.nombre} es ${numeroMX(ultimo.kilometros)} km y estás anotando ${numeroMX(km)}.`
        + ' Revísalo; si de verdad es así, vuelve a guardar para confirmar.',
      confirmar: true,
    });
  }

  const ahora = new Date().toISOString();
  let id;
  db.exec('BEGIN');
  try {
    id = Number(db.prepare(`
      INSERT INTO logistica_cargas (folio, activo_id, fecha, litros, costo, kilometraje, tanque_lleno,
                                    estacion, ubicacion, forma_pago, ticket, usuario_id, notas, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(siguienteFolio('GAS', 'logistica_cargas'), a.id, fecha,
      Math.round(litros * 1000) / 1000, Math.round(costo * 100) / 100, km,
      cuerpo.tanque_lleno === false ? 0 : 1,
      String(cuerpo.estacion || '').trim() || null,
      String(cuerpo.ubicacion || '').trim() || null,
      String(cuerpo.forma_pago || '').trim() || null,
      null, usuario.id, String(cuerpo.notas || '').trim() || null, ahora).lastInsertRowid);
    if (km) {
      db.prepare(`
        INSERT INTO logistica_lecturas (activo_id, fecha, kilometros, origen_tipo, origen_id, usuario_id, creado_en)
        VALUES (?, ?, ?, 'carga', ?, ?, ?)
      `).run(a.id, fecha, km, id, usuario.id, ahora);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 201, { carga: cargasDe(a.id, 1)[0], id });
});

// El ticket de la carga. Va aparte porque la foto se toma después de guardar,
// con el papel en la mano.
ruta('POST', '/api/logistica/cargas/(\\d+)/ticket', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_cargas');
  if (!usuario) return;
  const c = db.prepare('SELECT * FROM logistica_cargas WHERE id = ?').get(Number(p[1]));
  if (!c) return json(res, 404, { error: 'Esa carga no existe.' });
  const guardado = guardarArchivoSubido(cuerpo.imagen);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });
  if (c.ticket) fs.rm(path.join(carpetaFotos(), c.ticket), { force: true }, () => {});
  db.prepare('UPDATE logistica_cargas SET ticket = ? WHERE id = ?').run(guardado.archivo, c.id);
  json(res, 200, { archivo: guardado.archivo });
});

ruta('PUT', '/api/logistica/cargas/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_corregir');
  if (!usuario) return;
  const c = db.prepare('SELECT * FROM logistica_cargas WHERE id = ?').get(Number(p[1]));
  if (!c) return json(res, 404, { error: 'Esa carga no existe.' });
  const litros = cuerpo.litros === undefined ? c.litros : Number(String(cuerpo.litros).replace(',', '.'));
  const costo = cuerpo.costo === undefined ? c.costo : Number(String(cuerpo.costo).replace(',', '.'));
  if (!(litros > 0) || !(costo > 0)) return json(res, 400, { error: 'Los litros y el costo tienen que ser mayores que cero.' });
  const km = cuerpo.kilometraje === undefined ? c.kilometraje
    : (cuerpo.kilometraje === '' || cuerpo.kilometraje === null ? null : Math.trunc(Number(cuerpo.kilometraje)));
  db.prepare(`
    UPDATE logistica_cargas SET fecha = ?, litros = ?, costo = ?, kilometraje = ?, tanque_lleno = ?,
           estacion = ?, forma_pago = ?, notas = ? WHERE id = ?
  `).run(cuerpo.fecha || c.fecha, Math.round(litros * 1000) / 1000, Math.round(costo * 100) / 100, km,
    cuerpo.tanque_lleno === undefined ? c.tanque_lleno : (cuerpo.tanque_lleno ? 1 : 0),
    cuerpo.estacion === undefined ? c.estacion : String(cuerpo.estacion || '').trim() || null,
    cuerpo.forma_pago === undefined ? c.forma_pago : String(cuerpo.forma_pago || '').trim() || null,
    cuerpo.notas === undefined ? c.notas : String(cuerpo.notas || '').trim() || null, c.id);
  db.prepare("UPDATE logistica_lecturas SET kilometros = ?, fecha = ? WHERE origen_tipo = 'carga' AND origen_id = ?")
    .run(km, cuerpo.fecha || c.fecha, c.id);
  json(res, 200, { ok: true });
});

ruta('DELETE', '/api/logistica/cargas/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'logistica_corregir');
  if (!usuario) return;
  const c = db.prepare('SELECT * FROM logistica_cargas WHERE id = ?').get(Number(p[1]));
  if (!c) return json(res, 404, { error: 'Esa carga no existe.' });
  if (c.ticket) fs.rm(path.join(carpetaFotos(), c.ticket), { force: true }, () => {});
  db.prepare("DELETE FROM logistica_lecturas WHERE origen_tipo = 'carga' AND origen_id = ?").run(c.id);
  db.prepare('DELETE FROM logistica_cargas WHERE id = ?').run(c.id);
  json(res, 200, { ok: true });
});

// --- servicios y mantenimiento ---

ruta('GET', '/api/logistica/servicios', (req, res) => {
  if (!exigir(req, res, 'mod_logistica')) return;
  json(res, 200, {
    servicios: db.prepare(`
      SELECT s.*, a.nombre AS unidad, u.nombre AS quien FROM logistica_servicios s
        JOIN activos a ON a.id = s.activo_id
        LEFT JOIN usuarios u ON u.id = s.usuario_id
       ORDER BY COALESCE(s.fecha, s.proxima_fecha) DESC, s.id DESC LIMIT 200
    `).all(),
    tipos: TIPOS_SERVICIO(),
    talleres: catalogoLogistica('taller'),
  });
});

ruta('POST', '/api/logistica/servicios', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_servicios');
  if (!usuario) return;
  const a = unidadParaLogistica(res, cuerpo.activo_id);
  if (!a) return;
  const tipo = String(cuerpo.tipo || '').trim();
  if (!tipo) return json(res, 400, { error: 'Di qué se le hizo o qué se le va a hacer.' });
  const programado = cuerpo.estado === 'programado';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || '') ? cuerpo.fecha : (programado ? null : hoyISO());
  const proximaFecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.proxima_fecha || '') ? cuerpo.proxima_fecha : null;
  const proximoKm = cuerpo.proximo_km ? Math.trunc(Number(cuerpo.proximo_km)) : null;
  if (programado && !proximaFecha && !proximoKm) {
    return json(res, 400, { error: 'Un servicio programado necesita su fecha o su kilometraje.' });
  }
  const descripcion = String(cuerpo.descripcion || '').trim();
  if (!programado && descripcion.length < 5) {
    return json(res, 400, { error: 'Escribe qué se le hizo: lo va a leer quien revise la unidad en un año.' });
  }

  const id = Number(db.prepare(`
    INSERT INTO logistica_servicios (folio, activo_id, tipo, estado, fecha, kilometraje, taller, costo,
                                     descripcion, proximo_km, proxima_fecha, usuario_id, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('SER', 'logistica_servicios'), a.id, tipo, programado ? 'programado' : 'hecho',
    fecha, cuerpo.kilometraje ? Math.trunc(Number(cuerpo.kilometraje)) : null,
    String(cuerpo.taller || '').trim() || null,
    cuerpo.costo ? Math.round(Number(String(cuerpo.costo).replace(',', '.')) * 100) / 100 : null,
    descripcion || null, proximoKm, proximaFecha, usuario.id, new Date().toISOString()).lastInsertRowid);
  json(res, 201, { id });
});

ruta('POST', '/api/logistica/servicios/(\\d+)/archivo', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_servicios');
  if (!usuario) return;
  const s2 = db.prepare('SELECT * FROM logistica_servicios WHERE id = ?').get(Number(p[1]));
  if (!s2) return json(res, 404, { error: 'Ese servicio no existe.' });
  const guardado = guardarArchivoSubido(cuerpo.imagen);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });
  if (s2.archivo) fs.rm(path.join(carpetaFotos(), s2.archivo), { force: true }, () => {});
  db.prepare('UPDATE logistica_servicios SET archivo = ? WHERE id = ?').run(guardado.archivo, s2.id);
  json(res, 200, { archivo: guardado.archivo });
});

// Dar por hecho un servicio que estaba programado, sin perder que estaba previsto.
ruta('POST', '/api/logistica/servicios/(\\d+)/cumplido', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_servicios');
  if (!usuario) return;
  const s2 = db.prepare('SELECT * FROM logistica_servicios WHERE id = ?').get(Number(p[1]));
  if (!s2) return json(res, 404, { error: 'Ese servicio no existe.' });
  db.prepare(`
    UPDATE logistica_servicios SET estado = 'hecho', fecha = ?, kilometraje = COALESCE(?, kilometraje),
           costo = COALESCE(?, costo), descripcion = COALESCE(?, descripcion),
           taller = COALESCE(?, taller), proximo_km = NULL, proxima_fecha = NULL
     WHERE id = ?
  `).run(cuerpo.fecha || hoyISO(),
    cuerpo.kilometraje ? Math.trunc(Number(cuerpo.kilometraje)) : null,
    cuerpo.costo ? Math.round(Number(String(cuerpo.costo).replace(',', '.')) * 100) / 100 : null,
    String(cuerpo.descripcion || '').trim() || null,
    String(cuerpo.taller || '').trim() || null, s2.id);
  json(res, 200, { ok: true });
});

ruta('DELETE', '/api/logistica/servicios/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'logistica_corregir');
  if (!usuario) return;
  const s2 = db.prepare('SELECT * FROM logistica_servicios WHERE id = ?').get(Number(p[1]));
  if (!s2) return json(res, 404, { error: 'Ese servicio no existe.' });
  if (s2.archivo) fs.rm(path.join(carpetaFotos(), s2.archivo), { force: true }, () => {});
  db.prepare('DELETE FROM logistica_servicios WHERE id = ?').run(s2.id);
  json(res, 200, { ok: true });
});

// --- los papeles de la unidad ---

ruta('POST', '/api/logistica/documentos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_documentos');
  if (!usuario) return;
  const a = unidadParaLogistica(res, cuerpo.activo_id);
  if (!a) return;
  const tipo = String(cuerpo.tipo || '').trim();
  if (!tipo) return json(res, 400, { error: 'Di qué documento es.' });
  const vence = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.vence || '') ? cuerpo.vence : null;
  const guardado = guardarArchivoSubido(cuerpo.archivo);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });

  const id = Number(db.prepare(`
    INSERT INTO logistica_documentos (ambito, activo_id, tipo, nombre, vence, archivo, bytes, notas, subido_por, subido_en)
    VALUES ('unidad', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(a.id, tipo, String(cuerpo.nombre || '').trim() || null, vence, guardado.archivo, guardado.bytes,
    String(cuerpo.notas || '').trim() || null, usuario.id, new Date().toISOString()).lastInsertRowid);
  json(res, 201, { id });
});

ruta('PUT', '/api/logistica/documentos/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_documentos');
  if (!usuario) return;
  const d = db.prepare('SELECT * FROM logistica_documentos WHERE id = ?').get(Number(p[1]));
  if (!d) return json(res, 404, { error: 'Ese documento no existe.' });
  const vence = cuerpo.vence === undefined ? d.vence
    : (/^\d{4}-\d{2}-\d{2}$/.test(cuerpo.vence || '') ? cuerpo.vence : null);
  db.prepare('UPDATE logistica_documentos SET tipo = ?, nombre = ?, vence = ?, notas = ? WHERE id = ?').run(
    String(cuerpo.tipo || d.tipo).trim(),
    cuerpo.nombre === undefined ? d.nombre : String(cuerpo.nombre || '').trim() || null,
    vence,
    cuerpo.notas === undefined ? d.notas : String(cuerpo.notas || '').trim() || null, d.id);
  json(res, 200, { ok: true });
});

ruta('DELETE', '/api/logistica/documentos/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'logistica_corregir');
  if (!usuario) return;
  const d = db.prepare('SELECT * FROM logistica_documentos WHERE id = ?').get(Number(p[1]));
  if (!d) return json(res, 404, { error: 'Ese documento no existe.' });
  // El archivo se queda en disco hasta que se retira el renglón: un papel
  // vencido sigue siendo el papel que estaba vigente el año pasado.
  db.prepare('UPDATE logistica_documentos SET activo = 0 WHERE id = ?').run(d.id);
  json(res, 200, { ok: true });
});

// =============================================================== bahía digital
//
// Los papeles, todos en un lugar: los de las unidades y los del personal. Viven
// en la misma tabla que ya guardaba los de las unidades (logistica_documentos,
// con 'ambito' diciendo de qué son) a propósito: un papel es un papel, y tener
// dos tablas obligaría a buscar un documento en dos lados.
//
// Quién ve qué, como lo pidió Ronaldo: los del personal solo el Administrador
// —y quien él decida—, y cada quien los propios.

const papelesDe = (ambito, id) => db.prepare(`
  SELECT d.id, d.tipo, d.nombre, d.vence, d.archivo, d.bytes, d.notas, d.subido_en,
         u.nombre AS subio
    FROM logistica_documentos d LEFT JOIN usuarios u ON u.id = d.subido_por
   WHERE d.ambito = ? AND d.activo = 1
     AND ${ambito === 'unidad' ? 'd.activo_id' : 'd.usuario_id'} = ?
   ORDER BY d.tipo, d.subido_en DESC
`).all(ambito, id).map((d) => ({ ...d, ...describirVigencia(d.vence) }));

const PORVENCER = ['vencida', 'vence_hoy', 'por_vencer'];
const cuantosPorVencer = (papeles) => papeles.filter((p) => PORVENCER.includes(p.estado)).length;

// Lo que todavía no se ha cargado de alguien: los tipos de la lista que no
// tiene ninguno. No es un regaño —no todos aplican a todos— pero es lo que
// alguien necesita ver para saber qué pedirle.
const sinCargar = (tipos, papeles) => tipos.filter((t) => !papeles.some((p) => p.tipo === t));

// Los datos de emergencia de una persona. Siempre devuelve algo, aunque esté
// vacía: la pantalla pinta los campos igual y se llenan ahí mismo.
const SANGRE = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

const fichaDeEmergencia = (usuarioId) => db.prepare(`
  SELECT f.*, u.nombre AS actualizo FROM bahia_fichas f
    LEFT JOIN usuarios u ON u.id = f.actualizado_por WHERE f.usuario_id = ?
`).get(usuarioId) || { usuario_id: usuarioId };

// ¿Tiene lo mínimo para servir en una urgencia? Es lo que la pantalla marca en
// ámbar: una ficha a medias no se descubre el día que hace falta.
const fichaCompleta = (f) => !!(f && f.tipo_sangre && f.contacto1_nombre && f.contacto1_telefono);

function fichaDePersona(u, tipos, { papeles: conPapeles = true, emergencia = true } = {}) {
  const papeles = conPapeles ? papelesDe('persona', u.id) : [];
  const ficha = emergencia ? fichaDeEmergencia(u.id) : null;
  return {
    id: u.id,
    nombre: u.nombre,
    puesto: permisosDe(u.rol, '[]').etiqueta,
    activo: !!u.activo,
    ve_papeles: conPapeles,
    papeles,
    por_vencer: cuantosPorVencer(papeles),
    sin_cargar: conPapeles ? sinCargar(tipos, papeles) : [],
    ficha,
    ficha_completa: emergencia ? fichaCompleta(ficha) : null,
  };
}

ruta('GET', '/api/bahia', (req, res) => {
  const usuario = exigir(req, res, 'mod_bahia');
  if (!usuario) return;

  const verUnidades = puede(usuario, 'bahia_unidades_ver');
  const verPersonal = puede(usuario, 'bahia_personal_ver');
  // Ver la ficha de emergencia de todos no obliga a ver sus papeles: son dos
  // cosas distintas y se otorgan aparte. De poco sirve un tipo de sangre que
  // solo puede consultar quien también puede leer el contrato de la gente.
  const verEmergencia = verPersonal || puede(usuario, 'bahia_emergencia');
  const tiposPersona = catalogoLogistica('documento_persona');

  const unidades = verUnidades
    ? db.prepare('SELECT id, nombre, clave, tipo FROM activos WHERE activo = 1 ORDER BY nombre')
      .all().map((a) => {
        const papeles = papelesDe('unidad', a.id);
        return {
          ...a,
          etiqueta_tipo: (tipoDeUnidad(a.tipo) || {}).etiqueta || a.tipo,
          papeles,
          por_vencer: cuantosPorVencer(papeles),
          sin_cargar: sinCargar(catalogoLogistica('documento_unidad'), papeles),
        };
      })
    : [];

  const gente = (verPersonal || verEmergencia)
    ? db.prepare('SELECT id, nombre, rol, activo FROM usuarios WHERE activo = 1 ORDER BY nombre').all()
    : db.prepare('SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?').all(usuario.id);

  json(res, 200, {
    puede: {
      unidades: verUnidades,
      unidades_cargar: puede(usuario, 'bahia_unidades_cargar'),
      unidades_editar: puede(usuario, 'bahia_unidades_editar'),
      personal: verPersonal,
      personal_cargar: puede(usuario, 'bahia_personal_cargar'),
      personal_editar: puede(usuario, 'bahia_personal_editar'),
      emergencia: verEmergencia,
      retirar: puede(usuario, 'bahia_retirar'),
    },
    yo: usuario.id,
    catalogos: {
      tipos_unidad: catalogoLogistica('documento_unidad'),
      tipos_persona: tiposPersona,
      tipos_sangre: SANGRE,
    },
    unidades,
    personas: gente.map((u) => fichaDePersona(u, tiposPersona, {
      papeles: verPersonal || u.id === usuario.id,
      emergencia: verEmergencia || u.id === usuario.id,
    })),
    hoy: hoyISO(),
  });
});

// La ficha de emergencia se guarda de un botonazo: es una sola pantalla de
// datos y partirla en seis guardados sería peor.
ruta('PUT', '/api/bahia/fichas/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'mod_bahia');
  if (!usuario) return;

  const id = Number(p[1]);
  if (id !== usuario.id && !puede(usuario, 'bahia_personal_editar')) {
    return json(res, 403, { error: 'Solo puedes cambiar tu propia ficha.' });
  }
  const quien = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(id);
  if (!quien) return json(res, 404, { error: 'Esa persona no existe.' });

  const texto = (v, largo = 80) => String(v || '').trim().slice(0, largo) || null;
  const sangre = SANGRE.includes(String(cuerpo.tipo_sangre || '').trim())
    ? String(cuerpo.tipo_sangre).trim() : null;
  const telefono = (v) => {
    const t = String(v || '').replace(/[^0-9+() -]/g, '').trim();
    return t ? t.slice(0, 20) : null;
  };

  db.prepare(`
    INSERT INTO bahia_fichas (usuario_id, tipo_sangre, alergias, nss, clinica,
      contacto1_nombre, contacto1_parentesco, contacto1_telefono,
      contacto2_nombre, contacto2_parentesco, contacto2_telefono, notas,
      actualizado_por, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (usuario_id) DO UPDATE SET
      tipo_sangre = excluded.tipo_sangre, alergias = excluded.alergias,
      nss = excluded.nss, clinica = excluded.clinica,
      contacto1_nombre = excluded.contacto1_nombre,
      contacto1_parentesco = excluded.contacto1_parentesco,
      contacto1_telefono = excluded.contacto1_telefono,
      contacto2_nombre = excluded.contacto2_nombre,
      contacto2_parentesco = excluded.contacto2_parentesco,
      contacto2_telefono = excluded.contacto2_telefono,
      notas = excluded.notas,
      actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en
  `).run(id, sangre, texto(cuerpo.alergias, 200), texto(cuerpo.nss, 20), texto(cuerpo.clinica, 120),
    texto(cuerpo.contacto1_nombre), texto(cuerpo.contacto1_parentesco, 40), telefono(cuerpo.contacto1_telefono),
    texto(cuerpo.contacto2_nombre), texto(cuerpo.contacto2_parentesco, 40), telefono(cuerpo.contacto2_telefono),
    texto(cuerpo.notas, 300), usuario.id, new Date().toISOString());

  const ficha = fichaDeEmergencia(id);
  json(res, 200, {
    ficha,
    mensaje: fichaCompleta(ficha)
      ? 'Ficha guardada.'
      : 'Ficha guardada. Le falta el tipo de sangre o un contacto de emergencia con teléfono.',
  });
});

// Cargar un papel. De una unidad o de una persona: el ámbito decide el permiso,
// y los papeles de los demás no los sube cualquiera.
ruta('POST', '/api/bahia/documentos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'mod_bahia');
  if (!usuario) return;

  const ambito = cuerpo.ambito === 'persona' ? 'persona' : 'unidad';
  let activoId = null;
  let usuarioId = null;

  if (ambito === 'unidad') {
    if (!puede(usuario, 'bahia_unidades_cargar')) {
      return json(res, 403, { error: 'No tienes permiso de cargar papeles de las unidades.' });
    }
    const a = unidadParaLogistica(res, cuerpo.activo_id);
    if (!a) return;
    activoId = a.id;
  } else {
    usuarioId = Number(cuerpo.usuario_id) || usuario.id;
    // Los propios sí; los de alguien más, solo con el permiso del personal.
    if (usuarioId !== usuario.id && !puede(usuario, 'bahia_personal_cargar')) {
      return json(res, 403, { error: 'Solo puedes cargar tus propios papeles.' });
    }
    const quien = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(usuarioId);
    if (!quien) return json(res, 404, { error: 'Esa persona no existe.' });
  }

  const tipo = String(cuerpo.tipo || '').trim();
  if (!tipo) return json(res, 400, { error: 'Di qué documento es.' });
  const vence = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.vence || '') ? cuerpo.vence : null;
  const guardado = guardarArchivoSubido(cuerpo.archivo);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });

  const id = Number(db.prepare(`
    INSERT INTO logistica_documentos
      (ambito, activo_id, usuario_id, tipo, nombre, vence, archivo, bytes, notas, subido_por, subido_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ambito, activoId, usuarioId, tipo, String(cuerpo.nombre || '').trim() || null, vence,
    guardado.archivo, guardado.bytes, String(cuerpo.notas || '').trim() || null,
    usuario.id, new Date().toISOString()).lastInsertRowid);
  json(res, 201, { id, mensaje: 'Papel cargado.' });
});

// Un papel que esta persona puede tocar. 'que' dice para qué: verlo, corregirlo
// o retirarlo piden permisos distintos, y los propios siempre se pueden.
const papelDeLaBahia = (req, res, id, usuario, que = 'ver') => {
  const d = db.prepare('SELECT * FROM logistica_documentos WHERE id = ? AND activo = 1').get(id);
  if (!d) { json(res, 404, { error: 'Ese papel ya no está.' }); return null; }
  const propio = d.ambito === 'persona' && d.usuario_id === usuario.id;
  const permiso = d.ambito === 'unidad'
    ? (que === 'editar' ? 'bahia_unidades_editar' : 'bahia_unidades_ver')
    : (que === 'editar' ? 'bahia_personal_editar' : 'bahia_personal_ver');
  if (!propio && !puede(usuario, permiso)) {
    json(res, 403, {
      error: que === 'editar' ? 'No tienes permiso de corregir ese papel.' : 'Ese papel no te toca.',
    });
    return null;
  }
  return d;
};

ruta('PUT', '/api/bahia/documentos/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'mod_bahia');
  if (!usuario) return;
  const d = papelDeLaBahia(req, res, Number(p[1]), usuario, 'editar');
  if (!d) return;

  const vence = cuerpo.vence === undefined ? d.vence
    : (/^\d{4}-\d{2}-\d{2}$/.test(cuerpo.vence || '') ? cuerpo.vence : null);
  db.prepare('UPDATE logistica_documentos SET tipo = ?, nombre = ?, vence = ?, notas = ? WHERE id = ?').run(
    String(cuerpo.tipo || d.tipo).trim(),
    cuerpo.nombre === undefined ? d.nombre : String(cuerpo.nombre || '').trim() || null,
    vence,
    cuerpo.notas === undefined ? d.notas : String(cuerpo.notas || '').trim() || null, d.id);
  json(res, 200, { mensaje: 'Papel actualizado.' });
});

// Retirar no borra el archivo: un papel vencido sigue siendo el papel que
// estaba vigente el año pasado, y eso es justo lo que una auditoría pide.
ruta('DELETE', '/api/bahia/documentos/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'bahia_retirar');
  if (!usuario) return;
  const d = papelDeLaBahia(req, res, Number(p[1]), usuario);
  if (!d) return;
  db.prepare('UPDATE logistica_documentos SET activo = 0 WHERE id = ?').run(d.id);
  json(res, 200, { mensaje: 'Papel retirado. El archivo se queda guardado.' });
});

ruta('GET', '/api/reportes/bahia', (req, res) => {
  const usuario = exigir(req, res, 'bahia_reportes');
  if (!usuario) return;

  const tiposPersona = catalogoLogistica('documento_persona');
  const tiposUnidad = catalogoLogistica('documento_unidad');
  const renglones = [];

  for (const a of db.prepare('SELECT id, nombre FROM activos WHERE activo = 1 ORDER BY nombre').all()) {
    const papeles = papelesDe('unidad', a.id);
    for (const p of papeles) {
      renglones.push({ de: 'Unidad', quien: a.nombre, tipo: p.tipo, vence: p.vence, estado: p.estado, texto: p.texto, dias: p.dias, subio: p.subio });
    }
    for (const t of sinCargar(tiposUnidad, papeles)) {
      renglones.push({ de: 'Unidad', quien: a.nombre, tipo: t, vence: null, estado: 'sin_cargar', texto: 'sin cargar', dias: null, subio: null });
    }
  }
  for (const u of db.prepare('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre').all()) {
    const papeles = papelesDe('persona', u.id);
    for (const p of papeles) {
      renglones.push({ de: 'Personal', quien: u.nombre, tipo: p.tipo, vence: p.vence, estado: p.estado, texto: p.texto, dias: p.dias, subio: p.subio });
    }
    for (const t of sinCargar(tiposPersona, papeles)) {
      renglones.push({ de: 'Personal', quien: u.nombre, tipo: t, vence: null, estado: 'sin_cargar', texto: 'sin cargar', dias: null, subio: null });
    }
  }

  const url = new URL(req.url, 'http://x');
  const de = ['Unidad', 'Personal'].includes(url.searchParams.get('de')) ? url.searchParams.get('de') : null;
  const solo = url.searchParams.get('situacion');
  // Sin filtro se enseñan los papeles que SÍ están cargados: los que faltan son
  // cientos —cada tipo por cada persona— y taparían lo que importa. El total
  // sigue arriba, y se ven escogiendo «Sin cargar».
  const filtrados = renglones
    .filter((r) => !de || r.de === de)
    .filter((r) => (solo === 'sin_cargar' ? r.estado === 'sin_cargar'
      : solo === 'por_vencer' ? PORVENCER.includes(r.estado)
        : r.estado !== 'sin_cargar'));

  // Las fichas de emergencia van en el mismo reporte: es la hoja que alguien
  // querría tener impresa el día que pasa algo.
  const fichas = puede(usuario, 'bahia_emergencia') || puede(usuario, 'bahia_personal_ver')
    ? db.prepare('SELECT id, nombre, rol FROM usuarios WHERE activo = 1 ORDER BY nombre').all()
      .map((u) => ({
        id: u.id,
        nombre: u.nombre,
        puesto: permisosDe(u.rol, '[]').etiqueta,
        ...fichaDeEmergencia(u.id),
        completa: fichaCompleta(fichaDeEmergencia(u.id)),
      }))
    : [];

  json(res, 200, {
    fichas,
    filtros: { de, situacion: solo },
    resumen: {
      total: renglones.filter((r) => r.estado !== 'sin_cargar').length,
      por_vencer: renglones.filter((r) => PORVENCER.includes(r.estado)).length,
      sin_cargar: renglones.filter((r) => r.estado === 'sin_cargar').length,
      al_dia: renglones.filter((r) => r.estado === 'vigente').length,
    },
    renglones: filtrados.sort((a, b) => {
      const orden = { vencida: 0, vence_hoy: 1, por_vencer: 2, sin_cargar: 3, vigente: 4, sin_fecha: 5 };
      return (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || a.quien.localeCompare(b.quien);
    }),
  });
});

// ============================================================ ruta de entrega
//
// Una salida no lleva una sola cosa a un solo lugar: la unidad va primero al
// CEDIS, luego deja dos pedidos a clientes y de regreso pasa a paquetería. La
// ruta es ese recorrido, en orden, con lo que se entrega en cada parada.
//
// Se planea antes —el día anterior o en el momento— escogiendo de lo que ya
// está listo: las citas de la ODT de la semana y las órdenes de venta directa
// que tengan fecha de salida ese día. Cuando la unidad sale, la ruta se amarra
// a su formato de salida, y cada parada se marca conforme se entrega.

const TIPOS_PARADA = {
  cedis: 'CEDIS',
  cliente: 'Entrega directa a cliente',
  paqueteria: 'Paquetería',
  otro: 'Otra parada',
};

const paradasDeRuta = (rutaId) => db.prepare(`
  SELECT p.*, o.folio AS vxf_folio, o.cliente AS vxf_cliente, o.estado AS vxf_estado,
         o.entrega AS vxf_entrega, u.nombre AS marco,
         COALESCE(cl.direccion, ce.direccion) AS direccion_heredada
    FROM ruta_paradas p
    LEFT JOIN vxf_ordenes o ON o.id = p.vxf_id
    LEFT JOIN vxf_clientes cl ON cl.id = o.cliente_id
    LEFT JOIN almacen_odt_citas ci ON ci.id = p.cita_id
    LEFT JOIN transito_cedis ce ON ce.nombre = ci.cedis
    LEFT JOIN usuarios u ON u.id = p.marcada_por
   WHERE p.ruta_id = ? ORDER BY p.orden, p.id
`).all(rutaId).map((p) => ({
  ...p,
  tipo_etiqueta: TIPOS_PARADA[p.tipo] || p.tipo,
  // La de la parada manda; si no tiene, la de la ficha del cliente o del CEDIS.
  // Así, capturar hoy la dirección de un cliente llena también las paradas que
  // ya estaban planeadas.
  direccion: p.direccion || p.direccion_heredada || null,
  direccion_propia: !!p.direccion,
}));

function rutaCompleta(id) {
  const r = db.prepare(`
    SELECT r.*, a.nombre AS unidad, u.nombre AS planeo,
           l.referencia AS salida_referencia, l.estado AS salida_estado
      FROM rutas_entrega r
      LEFT JOIN activos a ON a.id = r.activo_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      LEFT JOIN llenados l ON l.id = r.llenado_id
     WHERE r.id = ?
  `).get(id);
  if (!r) return null;
  const paradas = paradasDeRuta(r.id);
  return {
    ...r,
    paradas,
    entregadas: paradas.filter((p) => p.estado === 'entregada').length,
    pendientes: paradas.filter((p) => p.estado === 'pendiente').length,
  };
}

// Lo que se puede subir a la ruta de un día: las citas de la ODT de esa semana
// y las órdenes de venta directa ya armadas. Las que tienen fecha de salida se
// ofrecen el día que les toca; las que no la tienen se ofrecen siempre, para
// que nada se quede olvidado por no haberle puesto fecha.
function candidatosDeRuta(fecha) {
  const yaEn = new Set(db.prepare(`
    SELECT p.vxf_id AS id FROM ruta_paradas p JOIN rutas_entrega r ON r.id = p.ruta_id
     WHERE p.vxf_id IS NOT NULL AND r.estado <> 'cancelada'
  `).all().map((x) => x.id));
  const citasEn = new Set(db.prepare(`
    SELECT p.cita_id AS id FROM ruta_paradas p JOIN rutas_entrega r ON r.id = p.ruta_id
     WHERE p.cita_id IS NOT NULL AND r.estado <> 'cancelada'
  `).all().map((x) => x.id));

  const ventas = db.prepare(`
    SELECT o.id, o.folio, o.cliente, o.entrega, o.estado, o.fecha_salida,
           (SELECT COALESCE(SUM(r.cantidad), 0) FROM vxf_renglones r WHERE r.orden_id = o.id) AS unidades
      FROM vxf_ordenes o
     WHERE o.estado IN ('armada', 'documentada')
     ORDER BY COALESCE(o.fecha_salida, '9999'), o.id
  `).all()
    .filter((o) => !yaEn.has(o.id))
    .filter((o) => !o.fecha_salida || o.fecha_salida <= fecha);

  const citas = db.prepare(`
    SELECT c.id, c.folio, c.cedis, c.fecha, c.etiqueta, c.cuenta, o.semana
      FROM almacen_odt_citas c JOIN almacen_odt o ON o.id = c.odt_id
     WHERE c.fecha IS NOT NULL AND c.fecha BETWEEN ? AND ?
     ORDER BY c.fecha, c.orden
  `).all(hoyISO(new Date(Date.parse(`${fecha}T00:00:00Z`) - 3 * 864e5)),
    hoyISO(new Date(Date.parse(`${fecha}T00:00:00Z`) + 10 * 864e5)))
    .filter((c) => !citasEn.has(c.id));

  return { ventas, citas };
}

// Los formatos de salida de unidad de un día que todavía pueden llevar una
// ruta: los que no se han concluido.
function salidasDelDia(fecha) {
  const plantilla = db.prepare("SELECT id FROM plantillas WHERE clave = 'transito'").get();
  if (!plantilla) return [];
  return db.prepare(`
    SELECT l.id, l.referencia, l.estado, l.datos, u.nombre AS preparo
      FROM llenados l JOIN usuarios u ON u.id = l.usuario_id
     WHERE l.plantilla_id = ? AND l.periodo = ? AND l.estado <> 'cerrado'
     ORDER BY l.id
  `).all(plantilla.id, fecha).map((l) => {
    const datos = JSON.parse(l.datos || '{}');
    return {
      id: l.id,
      referencia: l.referencia,
      unidad: datos.unidad || null,
      operador: datos.operador || null,
      tipo: datos.tipo || null,
      preparo: l.preparo,
    };
  });
}

ruta('GET', '/api/logistica/rutas', (req, res) => {
  const usuario = exigir(req, res, 'mod_logistica');
  if (!usuario) return;
  const url = new URL(req.url, 'http://x');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('fecha') || '')
    ? url.searchParams.get('fecha') : hoyISO();

  json(res, 200, {
    fecha,
    // El punto de partida: el almacén. Se captura una vez en Configuración y es
    // la primera parada cuando el recorrido se abre en el mapa del teléfono.
    partida: (ajusteReal('direccion_almacen') || {}).valor || null,
    puede: { planear: puede(usuario, 'logistica_rutas') },
    tipos: Object.entries(TIPOS_PARADA).map(([clave, etiqueta]) => ({ clave, etiqueta })),
    unidades: db.prepare('SELECT id, nombre FROM activos WHERE activo = 1 ORDER BY nombre').all(),
    // Las salidas de unidad de ese día, para decir cuál lleva la ruta. La ruta
    // se planea aquí, no dentro del formato: quien llena el formato está en el
    // patio revisando la unidad, no planeando el recorrido.
    salidas: salidasDelDia(fecha),
    rutas: db.prepare("SELECT id FROM rutas_entrega WHERE fecha = ? AND estado <> 'cancelada' ORDER BY id")
      .all(fecha).map((r) => rutaCompleta(r.id)),
    // Para no perder de vista lo que viene: las rutas ya planeadas de otros días.
    proximas: db.prepare(`
      SELECT r.id, r.folio, r.fecha, r.estado,
             (SELECT COUNT(*) FROM ruta_paradas p WHERE p.ruta_id = r.id) AS paradas
        FROM rutas_entrega r
       WHERE r.fecha > ? AND r.estado = 'planeada' ORDER BY r.fecha LIMIT 10
    `).all(fecha),
    candidatos: candidatosDeRuta(fecha),
  });
});

ruta('POST', '/api/logistica/rutas', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_rutas');
  if (!usuario) return;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || '') ? cuerpo.fecha : hoyISO();
  const id = Number(db.prepare(`
    INSERT INTO rutas_entrega (folio, fecha, activo_id, notas, usuario_id, creado_en)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('RUT', 'rutas_entrega'), fecha, Number(cuerpo.activo_id) || null,
    String(cuerpo.notas || '').trim() || null, usuario.id, new Date().toISOString()).lastInsertRowid);
  json(res, 201, { ruta: rutaCompleta(id), mensaje: 'Ruta creada. Súbele lo que se va a entregar.' });
});

ruta('PUT', '/api/logistica/rutas/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_rutas');
  if (!usuario) return;
  const r = db.prepare('SELECT * FROM rutas_entrega WHERE id = ?').get(Number(p[1]));
  if (!r) return json(res, 404, { error: 'Esa ruta no existe.' });

  const estado = ['planeada', 'en_ruta', 'cerrada', 'cancelada'].includes(cuerpo.estado)
    ? cuerpo.estado : r.estado;
  if (estado === 'cerrada' && paradasDeRuta(r.id).some((x) => x.estado === 'pendiente')) {
    return json(res, 409, { error: 'Quedan paradas sin marcar. Dilas entregadas o no entregadas antes de cerrar.' });
  }
  db.prepare(`
    UPDATE rutas_entrega SET estado = ?, activo_id = ?, llenado_id = ?, notas = ?, cerrado_en = ?
     WHERE id = ?
  `).run(estado,
    cuerpo.activo_id === undefined ? r.activo_id : (Number(cuerpo.activo_id) || null),
    cuerpo.llenado_id === undefined ? r.llenado_id : (Number(cuerpo.llenado_id) || null),
    cuerpo.notas === undefined ? r.notas : (String(cuerpo.notas || '').trim() || null),
    estado === 'cerrada' ? new Date().toISOString() : r.cerrado_en, r.id);
  json(res, 200, { ruta: rutaCompleta(r.id) });
});

ruta('POST', '/api/logistica/rutas/(\\d+)/paradas', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_rutas');
  if (!usuario) return;
  const r = db.prepare('SELECT * FROM rutas_entrega WHERE id = ?').get(Number(p[1]));
  if (!r) return json(res, 404, { error: 'Esa ruta no existe.' });
  if (r.estado === 'cerrada') return json(res, 409, { error: 'Esa ruta ya se cerró.' });

  let { tipo } = cuerpo;
  let etiqueta = String(cuerpo.etiqueta || '').trim();
  let detalle = String(cuerpo.detalle || '').trim() || null;
  const vxfId = Number(cuerpo.vxf_id) || null;
  const citaId = Number(cuerpo.cita_id) || null;

  if (vxfId) {
    const o = db.prepare('SELECT * FROM vxf_ordenes WHERE id = ?').get(vxfId);
    if (!o) return json(res, 404, { error: 'Esa orden no existe.' });
    // La forma de entrega ya lo dice: con guía va a paquetería, con nota de
    // remisión se entrega al cliente.
    tipo = tipo || (o.entrega === 'guia' ? 'paqueteria' : 'cliente');
    etiqueta = etiqueta || `${o.folio} · ${o.cliente || 'sin cliente'}`;
    detalle = detalle || (o.entrega === 'guia' ? 'Con guía de paquetería' : 'Con nota de remisión');
  } else if (citaId) {
    const c = db.prepare('SELECT * FROM almacen_odt_citas WHERE id = ?').get(citaId);
    if (!c) return json(res, 404, { error: 'Esa cita no existe.' });
    tipo = 'cedis';
    etiqueta = etiqueta || `${c.folio || c.etiqueta || 'Cita'} · ${c.cedis}`;
    detalle = detalle || [c.cuenta, c.fecha].filter(Boolean).join(' · ') || null;
  }

  if (!TIPOS_PARADA[tipo]) return json(res, 400, { error: 'Di qué clase de parada es.' });
  if (etiqueta.length < 2) return json(res, 400, { error: 'Escribe a dónde va esa parada.' });

  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM ruta_paradas WHERE ruta_id = ?')
    .get(r.id).n + 1;
  db.prepare(`
    INSERT INTO ruta_paradas (ruta_id, orden, tipo, vxf_id, cita_id, etiqueta, detalle, direccion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(r.id, orden, tipo, vxfId, citaId, etiqueta, detalle,
    String(cuerpo.direccion || '').trim() || null);
  json(res, 201, { ruta: rutaCompleta(r.id) });
});

ruta('PUT', '/api/logistica/paradas/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'logistica_rutas');
  if (!usuario) return;
  const parada = db.prepare('SELECT * FROM ruta_paradas WHERE id = ?').get(Number(p[1]));
  if (!parada) return json(res, 404, { error: 'Esa parada ya no está.' });

  // Subir o bajar: se intercambia con el vecino, como en cualquier lista.
  if (cuerpo.hacia) {
    const hermanas = db.prepare('SELECT id, orden FROM ruta_paradas WHERE ruta_id = ? ORDER BY orden, id')
      .all(parada.ruta_id);
    const i = hermanas.findIndex((x) => x.id === parada.id);
    const j = cuerpo.hacia === 'abajo' ? i + 1 : i - 1;
    if (j < 0 || j >= hermanas.length) {
      return json(res, 409, { error: cuerpo.hacia === 'abajo' ? 'Ya es la última.' : 'Ya es la primera.' });
    }
    const mover = db.prepare('UPDATE ruta_paradas SET orden = ? WHERE id = ?');
    hermanas.forEach((h, k) => mover.run(k, h.id));
    mover.run(j, hermanas[i].id);
    mover.run(i, hermanas[j].id);
    return json(res, 200, { ruta: rutaCompleta(parada.ruta_id) });
  }

  // La dirección de esa vez. Se corrige sola, sin tocar el estado ni la ficha
  // del cliente: vaciarla deja que vuelva a mandar la de la ficha.
  if (cuerpo.direccion !== undefined && cuerpo.estado === undefined) {
    db.prepare('UPDATE ruta_paradas SET direccion = ? WHERE id = ?')
      .run(String(cuerpo.direccion || '').trim() || null, parada.id);
    return json(res, 200, { ruta: rutaCompleta(parada.ruta_id) });
  }

  const estado = ['pendiente', 'entregada', 'no_entregada'].includes(cuerpo.estado)
    ? cuerpo.estado : parada.estado;
  const nota = cuerpo.nota === undefined ? parada.nota : (String(cuerpo.nota || '').trim() || null);
  if (estado === 'no_entregada' && !nota) {
    return json(res, 400, { error: 'Si no se entregó, escribe por qué.' });
  }
  db.prepare(`
    UPDATE ruta_paradas SET estado = ?, nota = ?, marcada_por = ?, marcada_en = ? WHERE id = ?
  `).run(estado, nota, estado === 'pendiente' ? null : usuario.id,
    estado === 'pendiente' ? null : new Date().toISOString(), parada.id);
  json(res, 200, { ruta: rutaCompleta(parada.ruta_id) });
});

ruta('DELETE', '/api/logistica/paradas/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'logistica_rutas');
  if (!usuario) return;
  const parada = db.prepare('SELECT * FROM ruta_paradas WHERE id = ?').get(Number(p[1]));
  if (!parada) return json(res, 404, { error: 'Esa parada ya no está.' });
  db.prepare('DELETE FROM ruta_paradas WHERE id = ?').run(parada.id);
  json(res, 200, { ruta: rutaCompleta(parada.ruta_id) });
});

// Cuándo sale del almacén una orden de venta directa. Se arma hoy y puede irse
// mañana: con la fecha puesta, la orden aparece sola entre lo que se puede
// subir a la ruta de ese día.
ruta('PUT', '/api/vxf/ordenes/(\\d+)/fecha-salida', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_armar');
  if (!usuario) return;
  const o = db.prepare('SELECT * FROM vxf_ordenes WHERE id = ?').get(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || '') ? cuerpo.fecha : null;
  db.prepare('UPDATE vxf_ordenes SET fecha_salida = ? WHERE id = ?').run(fecha, o.id);
  json(res, 200, {
    fecha_salida: fecha,
    mensaje: fecha ? `Sale del almacén el ${fecha}.` : 'Se quitó la fecha de salida.',
  });
});

// --- desempeño: el reporte de Logística ---

ruta('GET', '/api/logistica/desempeno', (req, res) => {
  const usuario = exigir(req, res, 'logistica_reportes');
  if (!usuario) return;
  const url = new URL(req.url, 'http://x');
  const hoy = hoyISO();
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('desde') || '')
    ? url.searchParams.get('desde')
    : hoyISO(new Date(Date.now() - 90 * 24 * 3600 * 1000));
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('hasta') || '')
    ? url.searchParams.get('hasta') : hoy;

  const unidades = db.prepare('SELECT * FROM activos WHERE activo = 1 ORDER BY tipo, nombre').all();
  const porUnidad = unidades.map((a) => {
    const cargas = cargasDe(a.id).filter((c) => c.fecha >= desde && c.fecha <= hasta);
    const conRendimiento = cargas.filter((c) => c.rendimiento);
    const litros = cargas.reduce((n, c) => n + c.litros, 0);
    const costo = cargas.reduce((n, c) => n + c.costo, 0);
    const kms = cargas.reduce((n, c) => n + (c.kilometros || 0), 0);
    const servicios = serviciosDe(a.id).filter((x) => x.estado === 'hecho' && x.fecha >= desde && x.fecha <= hasta);
    return {
      id: a.id,
      nombre: a.nombre,
      tipo: a.tipo,
      etiqueta_tipo: tipoDeUnidad(a.tipo).etiqueta,
      cargas: cargas.length,
      litros: Math.round(litros * 100) / 100,
      costo: Math.round(costo * 100) / 100,
      kilometros: kms,
      rendimiento: conRendimiento.length
        ? Math.round((conRendimiento.reduce((n, c) => n + c.rendimiento, 0) / conRendimiento.length) * 100) / 100
        : null,
      costo_km: kms ? Math.round((costo / kms) * 100) / 100 : null,
      precio_litro: litros ? Math.round((costo / litros) * 100) / 100 : null,
      servicios: servicios.length,
      costo_servicios: Math.round(servicios.reduce((n, x) => n + (x.costo || 0), 0) * 100) / 100,
      kilometraje: (kilometrajeDe(a.id) || {}).kilometros || null,
      proximo_servicio: proximoServicio(a.id),
      papeles: vigenciasDeUnidad(a.id),
    };
  });

  const meses = db.prepare(`
    SELECT SUBSTR(fecha, 1, 7) AS mes, COUNT(*) AS cargas,
           ROUND(SUM(litros), 2) AS litros, ROUND(SUM(costo), 2) AS costo
      FROM logistica_cargas WHERE fecha >= ? AND fecha <= ?
     GROUP BY mes ORDER BY mes
  `).all(desde, hasta);

  json(res, 200, {
    desde, hasta,
    unidades: porUnidad,
    meses,
    resumen: {
      litros: Math.round(porUnidad.reduce((n, u) => n + u.litros, 0) * 100) / 100,
      costo: Math.round(porUnidad.reduce((n, u) => n + u.costo, 0) * 100) / 100,
      kilometros: porUnidad.reduce((n, u) => n + u.kilometros, 0),
      costo_servicios: Math.round(porUnidad.reduce((n, u) => n + u.costo_servicios, 0) * 100) / 100,
      papeles_vencidos: porUnidad.reduce((n, u) => n + u.papeles.filter((v) => v.estado === 'vencida').length, 0),
    },
  });
});

// --- catálogos de Logística, en Configuración ---

ruta('GET', '/api/admin/logistica', (req, res) => {
  if (!exigir(req, res, 'configuracion')) return;
  json(res, 200, {
    tipos: db.prepare('SELECT * FROM activo_tipos ORDER BY orden, etiqueta').all().map((t) => ({
      ...t,
      activo: !!t.activo,
      lleva_kilometraje: !!t.lleva_kilometraje,
      lleva_combustible: !!t.lleva_combustible,
      unidades: db.prepare('SELECT COUNT(*) AS n FROM activos WHERE tipo = ?').get(t.clave).n,
      checklist: (db.prepare('SELECT nombre FROM plantillas WHERE aplica_a = ? AND activo = 1').get(t.clave) || {}).nombre || null,
    })),
    telefonos: db.prepare('SELECT * FROM telefonos_corporativos ORDER BY orden, alias, marca, modelo').all()
      .map((t) => ({ ...t, activo: !!t.activo, extras: extrasDe(t.extras) })),
    // Los nombres de dato extra que ya se usaron, para no acabar con «Plan»,
    // «plan» y «Plan contratado» queriendo decir lo mismo.
    claves_extra: [...new Set(db.prepare('SELECT extras FROM telefonos_corporativos').all()
      .flatMap((t) => extrasDe(t.extras).map((x) => x.clave)))].sort(),
    direccion_almacen: (ajusteReal('direccion_almacen') || {}).valor || '',
    // Lo ya escrito se ofrece para no acabar con «Telcel», «TELCEL» y «telcel».
    telefonias: db.prepare(`
      SELECT DISTINCT telefonia FROM telefonos_corporativos
       WHERE telefonia IS NOT NULL AND telefonia <> '' ORDER BY telefonia
    `).all().map((x) => x.telefonia),
    cuentas_padre: db.prepare(`
      SELECT DISTINCT cuenta_padre FROM telefonos_corporativos
       WHERE cuenta_padre IS NOT NULL AND cuenta_padre <> '' ORDER BY cuenta_padre
    `).all().map((x) => x.cuenta_padre),
    catalogos: ['estacion', 'forma_pago', 'tipo_servicio', 'taller', 'documento_unidad',
      'documento_persona'].map((tipo) => ({
      tipo,
      etiqueta: {
        estacion: 'Gasolineras', forma_pago: 'Formas de pago de la gasolina',
        tipo_servicio: 'Tipos de servicio', taller: 'Talleres',
        documento_unidad: 'Documentos de unidad',
        documento_persona: 'Documentos del personal (Bahía digital)',
      }[tipo],
      valores: db.prepare('SELECT id, valor, activo FROM logistica_catalogos WHERE tipo = ? ORDER BY orden, valor')
        .all(tipo).map((v) => ({ ...v, activo: !!v.activo })),
    })),
  });
});

// Los celulares de la empresa. Se dan de alta aquí y se escogen al llenar el
// formato de salida: así queda dicho qué equipo se llevó quién, que es lo que
// se reclama si no regresa.
const textoTelefono = (v) => String(v || '').trim() || null;

// De dónde salen las rutas. Una sola dirección, la del almacén: es el punto de
// partida cuando el recorrido se abre en el mapa.
ruta('PUT', '/api/admin/direccion-almacen', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'configuracion');
  if (!usuario) return;
  guardarAjusteReal('direccion_almacen', String(cuerpo.direccion || '').trim(), usuario.id);
  json(res, 200, { mensaje: 'Dirección del almacén guardada.' });
});

// Los datos extra de un teléfono: [{clave, valor}] en el orden que se
// escribieron. Se revisan al guardar porque son lo único de la plataforma que
// escribe quien la usa y no el programa.
const TOPE_EXTRAS = 20;

function extrasLimpios(lista) {
  if (!Array.isArray(lista)) return { error: 'Los datos extra llegaron mal.' };
  const limpios = [];
  const vistas = new Set();
  for (const x of lista.slice(0, TOPE_EXTRAS)) {
    const clave = String((x || {}).clave || '').trim().slice(0, 40);
    const valor = String((x || {}).valor || '').trim().slice(0, 200);
    if (!clave) continue;
    if (vistas.has(clave.toLowerCase())) {
      return { error: `«${clave}» está dos veces: cada dato se llama distinto.` };
    }
    vistas.add(clave.toLowerCase());
    limpios.push({ clave, valor });
  }
  return { extras: limpios };
}

const extrasDe = (texto) => {
  try {
    const x = JSON.parse(texto || '[]');
    return Array.isArray(x) ? x : [];
  } catch { return []; }
};

ruta('POST', '/api/admin/telefonos', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const marca = String(cuerpo.marca || cuerpo.equipo || '').trim();
  if (marca.length < 2) return json(res, 400, { error: 'Escribe al menos la marca del equipo.' });
  const modelo = textoTelefono(cuerpo.modelo);
  const equipo = [marca, modelo].filter(Boolean).join(' ');
  const alias = textoTelefono(cuerpo.alias);
  // Dos equipos con el mismo alias no distinguirían nada, que es justo para lo
  // que sirve el alias.
  const yaLlamado = alias && db.prepare(
    'SELECT alias FROM telefonos_corporativos WHERE alias = ? COLLATE NOCASE').get(alias);
  if (yaLlamado) {
    return json(res, 409, { error: `Ya hay un teléfono que se llama «${yaLlamado.alias}».` });
  }
  const { extras, error } = extrasLimpios(cuerpo.extras || []);
  if (error) return json(res, 400, { error });

  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM telefonos_corporativos').get().n + 1;
  const id = Number(db.prepare(`
    INSERT INTO telefonos_corporativos
      (equipo, alias, marca, modelo, numero, telefonia, cuenta_padre, imei, notas, extras, orden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(equipo, alias, marca, modelo, textoTelefono(cuerpo.numero), textoTelefono(cuerpo.telefonia),
    textoTelefono(cuerpo.cuenta_padre), textoTelefono(cuerpo.imei), textoTelefono(cuerpo.notas),
    JSON.stringify(extras), orden).lastInsertRowid);
  json(res, 201, { id, mensaje: `${alias || equipo} dado de alta.` });
});

ruta('PUT', '/api/admin/telefonos/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const t = db.prepare('SELECT * FROM telefonos_corporativos WHERE id = ?').get(Number(p[1]));
  if (!t) return json(res, 404, { error: 'Ese teléfono no existe.' });
  const texto = (v, previo) => (v === undefined ? previo : String(v || '').trim() || null);

  const marca = texto(cuerpo.marca, t.marca);
  const modelo = texto(cuerpo.modelo, t.modelo);
  // El nombre que se lee en la lista del formato se arma solo: marca y modelo.
  const equipo = [marca, modelo].filter(Boolean).join(' ') || String(cuerpo.equipo || t.equipo || '').trim();
  const alias = texto(cuerpo.alias, t.alias);
  const otroIgual = alias && db.prepare(
    'SELECT alias FROM telefonos_corporativos WHERE alias = ? COLLATE NOCASE AND id <> ?')
    .get(alias, t.id);
  if (otroIgual) {
    return json(res, 409, { error: `Ya hay otro teléfono que se llama «${otroIgual.alias}».` });
  }

  let extras = t.extras;
  if (cuerpo.extras !== undefined) {
    const limpio = extrasLimpios(cuerpo.extras);
    if (limpio.error) return json(res, 400, { error: limpio.error });
    extras = JSON.stringify(limpio.extras);
  }

  db.prepare(`
    UPDATE telefonos_corporativos
       SET equipo = ?, alias = ?, marca = ?, modelo = ?, numero = ?, telefonia = ?, cuenta_padre = ?,
           imei = ?, notas = ?, extras = ?, activo = ?
     WHERE id = ?
  `).run(equipo, alias, marca, modelo, texto(cuerpo.numero, t.numero),
    texto(cuerpo.telefonia, t.telefonia), texto(cuerpo.cuenta_padre, t.cuenta_padre),
    texto(cuerpo.imei, t.imei), texto(cuerpo.notas, t.notas), extras,
    cuerpo.activo === undefined ? t.activo : (cuerpo.activo ? 1 : 0), t.id);
  json(res, 200, { ok: true });
});

// Un teléfono que ya salió en un formato no se borra: se retira. Lo que se
// capturó conserva el equipo que se llevaron ese día.
ruta('DELETE', '/api/admin/telefonos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'configuracion')) return;
  const t = db.prepare('SELECT * FROM telefonos_corporativos WHERE id = ?').get(Number(p[1]));
  if (!t) return json(res, 404, { error: 'Ese teléfono no existe.' });
  const nombre = [t.marca, t.modelo].filter(Boolean).join(' ') || t.equipo;
  const comoSeLlama = t.alias || nombre;
  const usos = db.prepare(`
    SELECT COUNT(*) AS n FROM llenados
     WHERE datos LIKE ? OR datos LIKE ?
  `).get(`%"telefono":"${t.numero}"%`, `%"telefono":"${nombre}"%`).n;
  if (usos) {
    return json(res, 409, {
      error: `${comoSeLlama} ya se asignó en ${usos} formato(s): no se borra para no perder esa historia. Retíralo: desmarca «En uso».`,
    });
  }
  if (t.imagen) fs.rm(path.join(carpetaFotos(), t.imagen), { force: true }, () => {});
  db.prepare('DELETE FROM telefonos_corporativos WHERE id = ?').run(t.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/logistica/tipos', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const clave = String(cuerpo.clave || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const etiqueta = String(cuerpo.etiqueta || '').trim();
  if (clave.length < 3 || etiqueta.length < 3) {
    return json(res, 400, { error: 'El tipo necesita una clave y un nombre de al menos 3 letras.' });
  }
  if (db.prepare('SELECT 1 FROM activo_tipos WHERE clave = ?').get(clave)) {
    return json(res, 409, { error: `Ya existe un tipo de unidad con la clave ${clave}.` });
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM activo_tipos').get().n;
  db.prepare(`
    INSERT INTO activo_tipos (clave, etiqueta, plural, orden, lleva_kilometraje, lleva_combustible)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(clave, etiqueta, String(cuerpo.plural || etiqueta).trim(), orden,
    cuerpo.lleva_kilometraje ? 1 : 0, cuerpo.lleva_combustible ? 1 : 0);
  json(res, 201, { ok: true, clave });
});

ruta('PUT', '/api/admin/logistica/tipos/([a-z0-9_]+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const t = db.prepare('SELECT * FROM activo_tipos WHERE clave = ?').get(p[1]);
  if (!t) return json(res, 404, { error: 'Ese tipo de unidad no existe.' });
  const enUso = db.prepare('SELECT COUNT(*) AS n FROM activos WHERE tipo = ? AND activo = 1').get(t.clave).n;
  if (cuerpo.activo === false && enUso) {
    return json(res, 409, { error: `${t.etiqueta} tiene ${enUso} unidad(es) en uso. Retíralas antes de retirar el tipo.` });
  }
  db.prepare(`
    UPDATE activo_tipos SET etiqueta = ?, plural = ?, lleva_kilometraje = ?, lleva_combustible = ?, activo = ?
     WHERE clave = ?
  `).run(String(cuerpo.etiqueta || t.etiqueta).trim(), String(cuerpo.plural ?? t.plural ?? '').trim() || null,
    cuerpo.lleva_kilometraje === undefined ? t.lleva_kilometraje : (cuerpo.lleva_kilometraje ? 1 : 0),
    cuerpo.lleva_combustible === undefined ? t.lleva_combustible : (cuerpo.lleva_combustible ? 1 : 0),
    cuerpo.activo === undefined ? t.activo : (cuerpo.activo ? 1 : 0), t.clave);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/logistica/catalogos', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const tipo = String(cuerpo.tipo || '').trim();
  const valor = String(cuerpo.valor || '').trim();
  if (!tipo || !valor) return json(res, 400, { error: 'Falta el valor.' });
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM logistica_catalogos WHERE tipo = ?').get(tipo).n;
  try {
    db.prepare('INSERT INTO logistica_catalogos (tipo, valor, orden) VALUES (?, ?, ?)').run(tipo, valor, orden);
  } catch {
    return json(res, 409, { error: `«${valor}» ya está en la lista.` });
  }
  json(res, 201, { ok: true });
});

ruta('PUT', '/api/admin/logistica/catalogos/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const v = db.prepare('SELECT * FROM logistica_catalogos WHERE id = ?').get(Number(p[1]));
  if (!v) return json(res, 404, { error: 'Ese valor no existe.' });
  db.prepare('UPDATE logistica_catalogos SET valor = ?, activo = ? WHERE id = ?').run(
    String(cuerpo.valor || v.valor).trim(),
    cuerpo.activo === undefined ? v.activo : (cuerpo.activo ? 1 : 0), v.id);
  json(res, 200, { ok: true });
});

// --- modo de pruebas: prenderlo, apagarlo y entrar como alguien ---

// Lo que viaja en la sesión de quien entra: igual que al entrar con su clave.
function usuarioDeFila(fila) {
  const permisos = permisosDe(fila.rol, fila.permisos_extra);
  return { id: fila.id, nombre: fila.nombre, rol: fila.rol, etiqueta_rol: permisos.etiqueta, permisos };
}

const resumenPrueba = (prueba) => prueba && ({
  nombre: prueba.usuario.nombre,
  puesto: prueba.usuario.etiqueta_rol,
  desde: prueba.desde,
});

// El estado del modo y, para quien puede probar, a quién puede «ser».
ruta('GET', '/api/pruebas', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const sesion = sesionDe(req);
  const m = modoPruebas();
  const datos = { ...m, puede: puede(usuario, 'config_modo_pruebas'), probando: resumenPrueba(sesion.prueba) };
  if (datos.puede && m.activo) {
    contexto.run({ db: abrirBasePruebas(), fotos: FOTOS_PRUEBAS }, () => {
      datos.puestos = listaPuestos().filter((x) => x.activo).map((x) => ({
        clave: x.clave,
        etiqueta: x.etiqueta,
        personas: db.prepare('SELECT id, nombre FROM usuarios WHERE rol = ? AND activo = 1 ORDER BY nombre').all(x.clave),
      }));
    });
  }
  json(res, 200, datos);
});

ruta('POST', '/api/pruebas/prender', (req, res) => {
  const usuario = exigir(req, res, 'config_modo_pruebas');
  if (!usuario) return;
  if (!modoPruebas().activo) {
    copiarBaseReal(usuario.id);
    guardarAjusteReal('modo_pruebas_checklists', '1', usuario.id);
    abrirBasePruebas();
  }
  json(res, 200, modoPruebas());
});

// Apagar tira la copia completa: todo lo que se capturó probando desaparece.
ruta('POST', '/api/pruebas/apagar', (req, res) => {
  const usuario = exigir(req, res, 'config_modo_pruebas');
  if (!usuario) return;
  guardarAjusteReal('modo_pruebas_checklists', '0', usuario.id);
  tirarBasePruebas();
  json(res, 200, modoPruebas());
});

// Volver a empezar con una copia fresca de la operación de hoy.
ruta('POST', '/api/pruebas/reiniciar', (req, res) => {
  const usuario = exigir(req, res, 'config_modo_pruebas');
  if (!usuario) return;
  if (!modoPruebas().activo) return json(res, 409, { error: 'El modo de pruebas está apagado.' });
  sacarATodosDePrueba();
  copiarBaseReal(usuario.id);
  abrirBasePruebas();
  json(res, 200, modoPruebas());
});

// Entrar como alguien: una persona de la copia, o un puesto. Si el puesto no
// tiene a nadie, se crea en la copia una persona de prueba para ocuparlo.
ruta('POST', '/api/pruebas/entrar', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'config_modo_pruebas');
  if (!usuario) return;
  if (!modoPruebas().activo) return json(res, 409, { error: 'Primero prende el modo de pruebas.' });
  const sesion = sesionDe(req);
  let resultado = null;
  let error = null;
  contexto.run({ db: abrirBasePruebas(), fotos: FOTOS_PRUEBAS, prueba: true }, () => {
    let fila = null;
    if (cuerpo.usuario_id) {
      fila = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(Number(cuerpo.usuario_id));
      if (!fila) { error = 'Esa persona no está activa.'; return; }
    } else {
      const puesto = puestoDe(cuerpo.puesto);
      if (!puesto || !puesto.activo) { error = 'Ese puesto no existe.'; return; }
      fila = db.prepare('SELECT * FROM usuarios WHERE rol = ? AND activo = 1 ORDER BY id LIMIT 1').get(puesto.clave);
      if (!fila) {
        const id = db.prepare('INSERT INTO usuarios (nombre, rol, pin, permisos_extra) VALUES (?, ?, NULL, ?)')
          .run(`Prueba · ${puesto.etiqueta}`, puesto.clave, '{}').lastInsertRowid;
        fila = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id));
      }
    }
    resultado = usuarioDeFila(fila);
  });
  if (error) return json(res, 400, { error });
  sesion.prueba = { usuario: resultado, desde: new Date().toISOString() };
  json(res, 200, { usuario: resultado, prueba: resumenPrueba(sesion.prueba) });
});

ruta('POST', '/api/pruebas/salir', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const sesion = sesionDe(req);
  delete sesion.prueba;
  json(res, 200, { usuario: sesion.usuario, prueba: null });
});

// Quién soy ahora: la pantalla lo pregunta cuando nota que cambió el modo.
ruta('GET', '/api/yo', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const sesion = sesionDe(req);
  json(res, 200, { usuario, prueba: enPrueba() ? resumenPrueba(sesion.prueba) : null });
});

// --- Tránsito: la lista de CEDIS ---
//
// Mismo patrón que el editor de preguntas: la pantalla manda la lista completa
// como debe quedar y se aplica toda o nada. Nunca se borra un CEDIS: se retira
// de la lista y los envíos ya capturados lo conservan.

ruta('GET', '/api/admin/transito', (req, res) => {
  if (!exigir(req, res, 'config_transito')) return;
  const plantilla = db.prepare("SELECT id FROM plantillas WHERE clave = 'transito'").get();
  const usos = new Map();
  if (plantilla) {
    for (const l of db.prepare('SELECT datos FROM llenados WHERE plantilla_id = ?').all(plantilla.id)) {
      const lugar = String(JSON.parse(l.datos || '{}').lugar_entrega || '').trim().toUpperCase();
      usos.set(lugar, (usos.get(lugar) || 0) + 1);
    }
  }
  json(res, 200, {
    plantilla_id: plantilla ? plantilla.id : null,
    cedis: db.prepare('SELECT id, nombre, direccion, orden, activo FROM transito_cedis ORDER BY orden, id').all()
      .map((c) => ({ ...c, usos: usos.get(c.nombre.toUpperCase()) || 0 })),
  });
});

ruta('POST', '/api/admin/transito/cedis', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'config_transito')) return;
  const lista = (Array.isArray(cuerpo.cedis) ? cuerpo.cedis : [])
    .map((c) => ({
      id: Number(c.id) || null,
      nombre: String(c.nombre || '').trim().replace(/\s+/g, ' '),
      direccion: String(c.direccion || '').trim() || null,
      activo: !!c.activo,
    }));
  const existentes = new Set(db.prepare('SELECT id FROM transito_cedis').all().map((f) => f.id));

  const errores = [];
  const vistos = new Set();
  lista.forEach((c, i) => {
    if (!c.nombre) errores.push(`El CEDIS del renglón ${i + 1} no tiene nombre.`);
    else if (vistos.has(c.nombre.toUpperCase())) errores.push(`«${c.nombre}» está repetido.`);
    vistos.add(c.nombre.toUpperCase());
    if (c.id && !existentes.has(c.id)) errores.push(`«${c.nombre}» ya no existe. Recarga la pantalla.`);
  });
  if (!lista.some((c) => c.activo)) errores.push('Deja al menos un CEDIS en la lista: sin ninguno no se puede abrir un envío ni una colecta.');
  if (errores.length) return json(res, 400, { error: errores[0], errores });

  db.exec('BEGIN');
  try {
    // Primero un nombre provisional: así se pueden intercambiar dos nombres sin
    // chocar con la regla de que no se repitan.
    const provisional = db.prepare("UPDATE transito_cedis SET nombre = '~' || id WHERE id = ?");
    lista.filter((c) => c.id).forEach((c) => provisional.run(c.id));
    const cambiar = db.prepare('UPDATE transito_cedis SET nombre = ?, direccion = ?, orden = ?, activo = ? WHERE id = ?');
    const crear = db.prepare('INSERT INTO transito_cedis (nombre, direccion, orden, activo) VALUES (?, ?, ?, ?)');
    lista.forEach((c, i) => {
      if (c.id) cambiar.run(c.nombre, c.direccion, i, c.activo ? 1 : 0, c.id);
      else crear.run(c.nombre, c.direccion, i, c.activo ? 1 : 0);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true });
});

// --- editor de preguntas ---
//
// Cambiar la redacción corrige el texto también en lo ya capturado: es la misma
// pregunta. Retirar no borra: la pregunta o el área dejan de salir en la tablet,
// pero lo contestado sigue en Reportes. El tipo de respuesta solo se cambia
// mientras nadie la haya contestado, porque cambiarlo después dejaría respuestas
// viejas que ya no significan nada.

const TIPOS_EDITABLES = {
  ok_problema: 'Bien / Problema',
  revisado: 'Sí / No',
  fecha: 'Fecha de vencimiento',
  dinero: 'Monto con foto',
  // El kilometraje del tablero o el horómetro del montacargas: una lectura con
  // su foto. Alimenta el desempeño de la unidad en Logística.
  medidor: 'Lectura con foto (kilometraje)',
  // El tanque, como lo pide el formato vehicular: un cuarto, medio, tres cuartos
  // o lleno. No es un número porque nadie mide litros con la aguja.
  nivel: 'Nivel de tanque (¼, ½, ¾, lleno)',
  // Las hojas que se adjuntan en Tránsito (autorización, recepción). Sin este
  // tipo, el editor no podía guardar nada del checklist de Tránsito.
  documento: 'Documento adjunto',
  // Lo que se escribe a mano (placas, chofer, proveedor) y una hora (arribo del
  // transporte). Nacieron con las colectas de Tránsito.
  texto: 'Texto (se escribe)',
  hora: 'Hora',
};
const AYUDA_FECHA = 'Captura la fecha en que vence. La plataforma calcula los días que le quedan o los que lleva vencida.';

function metaPara(tipo, previa = {}, cambios = {}) {
  const meta = { ...previa };
  if (tipo === 'medidor') {
    meta.unidad = meta.unidad || 'km';
    meta.obligatoria = true;
    meta.ayuda = meta.ayuda || 'Anota los kilómetros del tablero y toma la foto del odómetro.';
  }
  if (tipo === 'medidor') {
    meta.unidad = meta.unidad || 'km';
    meta.obligatoria = true;
    meta.ayuda = meta.ayuda || 'Anota los kilómetros del tablero y toma la foto del odómetro.';
  }
  if (tipo === 'fecha') {
    meta.vigencia = true;
    if (!meta.etiqueta) meta.etiqueta = 'Vence el';
    if (!meta.ayuda) meta.ayuda = AYUDA_FECHA;
  }
  if (tipo === 'dinero') {
    meta.obligatoria = true;
    if (!meta.ayuda) meta.ayuda = 'Captura cuánto dinero trae la unidad y toma la foto del efectivo.';
  }
  if (cambios.obligatoria !== undefined && tipo !== 'dinero') meta.obligatoria = !!cambios.obligatoria;
  return meta;
}

function plantillaEditable(res, id) {
  const plantilla = db.prepare('SELECT * FROM plantillas WHERE id = ?').get(id);
  if (!plantilla) { json(res, 404, { error: 'Ese checklist no existe.' }); return null; }
  if (plantilla.tipo_captura !== 'items') {
    json(res, 409, { error: 'Este checklist es una tabla de conteo; sus renglones no se editan desde aquí.' });
    return null;
  }
  return plantilla;
}

// Reordena dejando los activos numerados 0..n y luego intercambia con el vecino.
// Numerar primero evita que dos renglones con el mismo orden no se muevan.
function moverFila(tabla, columnaGrupo, fila, hacia) {
  const hermanos = db.prepare(`SELECT id FROM ${tabla} WHERE ${columnaGrupo} = ? AND activo = 1 ORDER BY orden, id`)
    .all(fila[columnaGrupo]).map((f) => f.id);
  const renumerar = db.prepare(`UPDATE ${tabla} SET orden = ? WHERE id = ?`);
  hermanos.forEach((id, i) => renumerar.run(i, id));
  const i = hermanos.indexOf(fila.id);
  const j = hacia === 'arriba' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= hermanos.length) return;
  renumerar.run(j, hermanos[i]);
  renumerar.run(i, hermanos[j]);
}

ruta('GET', '/api/admin/plantillas/(\\d+)/estructura', (req, res, p) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const plantilla = plantillaEditable(res, Number(p[1]));
  if (!plantilla) return;
  const secciones = db.prepare('SELECT id, titulo, etapa, orden, condicion FROM secciones WHERE plantilla_id = ? AND activo = 1 ORDER BY orden, id')
    .all(plantilla.id);
  const traerItems = db.prepare(`
    SELECT i.id, i.texto, i.tipo_respuesta, i.meta, i.solo_activos, i.orden,
           (SELECT COUNT(*) FROM respuestas r WHERE r.item_id = i.id) AS respuestas
      FROM items i WHERE i.seccion_id = ? AND i.activo = 1 ORDER BY i.orden, i.id`);
  json(res, 200, {
    plantilla: { id: plantilla.id, clave: plantilla.clave, nombre: plantilla.nombre,
      por_etapas: plantilla.por_etapas, aplica_a: plantilla.aplica_a },
    tipos: TIPOS_EDITABLES,
    // A qué puede aplicar un área (en Tránsito: Envío o Colecta).
    condiciones: condicionesDe(plantilla),
    secciones: secciones.map((sec) => ({
      ...sec,
      condicion: sec.condicion ? JSON.parse(sec.condicion) : null,
      items: traerItems.all(sec.id).map((it) => ({ ...it, meta: JSON.parse(it.meta || '{}') })),
    })),
  });
});

ruta('POST', '/api/admin/plantillas/(\\d+)/secciones', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const plantilla = plantillaEditable(res, Number(p[1]));
  if (!plantilla) return;
  const titulo = String(cuerpo.titulo || '').trim();
  if (!titulo) return json(res, 400, { error: 'Escribe el nombre del área.' });
  const etapa = plantilla.por_etapas && cuerpo.etapa === 'regreso' ? 'regreso' : 'salida';
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM secciones WHERE plantilla_id = ?').get(plantilla.id).n;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo) VALUES (?, ?, ?, ?, NULL, 1)'
  ).run(plantilla.id, orden, titulo, etapa);
  json(res, 201, { id: Number(lastInsertRowid) });
});

const seccionDe = (res, id) => {
  const sec = db.prepare('SELECT * FROM secciones WHERE id = ? AND activo = 1').get(id);
  if (!sec) { json(res, 404, { error: 'Esa área no existe o ya se retiró.' }); return null; }
  return plantillaEditable(res, sec.plantilla_id) ? sec : null;
};
const itemDe = (res, id) => {
  const it = db.prepare('SELECT i.*, s.plantilla_id FROM items i JOIN secciones s ON s.id = i.seccion_id WHERE i.id = ? AND i.activo = 1').get(id);
  if (!it) { json(res, 404, { error: 'Esa pregunta no existe o ya se retiró.' }); return null; }
  return plantillaEditable(res, it.plantilla_id) ? it : null;
};

ruta('PUT', '/api/admin/secciones/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const sec = seccionDe(res, Number(p[1]));
  if (!sec) return;
  const titulo = String(cuerpo.titulo || '').trim();
  if (!titulo) return json(res, 400, { error: 'El área necesita un nombre.' });
  db.prepare('UPDATE secciones SET titulo = ? WHERE id = ?').run(titulo, sec.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/secciones/(\\d+)/retirar', (req, res, p) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const sec = seccionDe(res, Number(p[1]));
  if (!sec) return;
  db.prepare('UPDATE secciones SET activo = 0 WHERE id = ?').run(sec.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/secciones/(\\d+)/mover', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const sec = seccionDe(res, Number(p[1]));
  if (!sec) return;
  moverFila('secciones', 'plantilla_id', sec, cuerpo.hacia);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/secciones/(\\d+)/items', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const sec = seccionDe(res, Number(p[1]));
  if (!sec) return;
  const texto = String(cuerpo.texto || '').trim();
  if (!texto) return json(res, 400, { error: 'Escribe la pregunta.' });
  const tipo = cuerpo.tipo_respuesta || 'ok_problema';
  if (!TIPOS_EDITABLES[tipo]) return json(res, 400, { error: 'Ese tipo de respuesta no existe.' });
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM items WHERE seccion_id = ?').get(sec.id).n;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta, activo)
    VALUES (?, ?, ?, ?, NULL, ?, 1)
  `).run(sec.id, orden, texto, tipo, JSON.stringify(metaPara(tipo, {}, cuerpo)));
  json(res, 201, { id: Number(lastInsertRowid) });
});

ruta('PUT', '/api/admin/items/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const it = itemDe(res, Number(p[1]));
  if (!it) return;

  const texto = cuerpo.texto === undefined ? it.texto : String(cuerpo.texto).trim();
  if (!texto) return json(res, 400, { error: 'La pregunta no puede quedar vacía.' });

  let tipo = it.tipo_respuesta;
  if (cuerpo.tipo_respuesta !== undefined && cuerpo.tipo_respuesta !== it.tipo_respuesta) {
    if (!TIPOS_EDITABLES[cuerpo.tipo_respuesta]) return json(res, 400, { error: 'Ese tipo de respuesta no existe.' });
    const contestada = db.prepare('SELECT COUNT(*) AS n FROM respuestas WHERE item_id = ?').get(it.id).n;
    if (contestada) {
      return json(res, 409, {
        error: `Esta pregunta ya tiene ${contestada} respuesta(s): su tipo no se cambia. Retírala y agrega una nueva con el tipo que necesitas.`,
      });
    }
    tipo = cuerpo.tipo_respuesta;
  }
  const meta = metaPara(tipo, JSON.parse(it.meta || '{}'), cuerpo);
  db.prepare('UPDATE items SET texto = ?, tipo_respuesta = ?, meta = ? WHERE id = ?')
    .run(texto, tipo, JSON.stringify(meta), it.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/items/(\\d+)/retirar', (req, res, p) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const it = itemDe(res, Number(p[1]));
  if (!it) return;
  db.prepare('UPDATE items SET activo = 0 WHERE id = ?').run(it.id);
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/items/(\\d+)/mover', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const it = itemDe(res, Number(p[1]));
  if (!it) return;
  moverFila('items', 'seccion_id', it, cuerpo.hacia);
  json(res, 200, { ok: true });
});

// Guardar de una vez todo lo que se cambió en el editor. La pantalla ya no guarda
// campo por campo: el Administrador ajusta, revisa y toca «Guardar cambios».
// Llega la estructura completa como debe quedar —áreas y preguntas en su orden,
// más lo que se retiró— y se aplica toda o nada: si una pregunta no se puede
// cambiar, no queda la mitad del checklist editada en la tablet.
ruta('POST', '/api/admin/plantillas/(\\d+)/estructura', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'config_editar_checklists')) return;
  const plantilla = plantillaEditable(res, Number(p[1]));
  if (!plantilla) return;

  const secciones = Array.isArray(cuerpo.secciones) ? cuerpo.secciones : [];
  const retiradas = cuerpo.retiradas || {};
  const filasSecciones = db.prepare('SELECT id, etapa, condicion FROM secciones WHERE plantilla_id = ? AND activo = 1')
    .all(plantilla.id);
  const seccionesVivas = new Map(filasSecciones.map((f) => [f.id, f.etapa]));
  const condicionVigente = new Map(filasSecciones.map((f) => [f.id, f.condicion]));
  const condiciones = condicionesDe(plantilla);
  const itemsVivos = new Map(db.prepare(`
    SELECT i.id, i.texto, i.tipo_respuesta, i.meta,
           (SELECT COUNT(*) FROM respuestas r WHERE r.item_id = i.id) AS respuestas
      FROM items i JOIN secciones s ON s.id = i.seccion_id
     WHERE s.plantilla_id = ? AND i.activo = 1 AND s.activo = 1
  `).all(plantilla.id).map((f) => [f.id, f]));

  // Todo se revisa antes de tocar nada.
  const errores = [];
  if (!secciones.length) errores.push('El checklist tiene que quedar con al menos un área.');
  secciones.forEach((sec, si) => {
    const nombre = String(sec.titulo || '').trim();
    if (!nombre) errores.push(`El área ${si + 1} no tiene nombre.`);
    if (sec.id && !seccionesVivas.has(Number(sec.id))) errores.push(`El área «${nombre}» ya no existe. Recarga la pantalla.`);
    if (sec.condicion && !condiciones.some((c) => c.campo === sec.condicion.campo && c.valor === sec.condicion.valor)) {
      errores.push(`El área «${nombre}» dice aplicar a algo que este checklist no tiene.`);
    }
    for (const it of sec.items || []) {
      const texto = String(it.texto || '').trim();
      if (!texto) errores.push(`Hay una pregunta vacía en «${nombre || `el área ${si + 1}`}».`);
      if (!TIPOS_EDITABLES[it.tipo_respuesta]) errores.push(`«${texto}»: ese tipo de respuesta no existe.`);
      if (it.id) {
        const actual = itemsVivos.get(Number(it.id));
        if (!actual) errores.push(`«${texto}» ya no existe. Recarga la pantalla.`);
        else if (actual.tipo_respuesta !== it.tipo_respuesta && actual.respuestas) {
          errores.push(`«${texto}» ya tiene ${actual.respuestas} respuesta(s): su tipo no se cambia. Retírala y agrega una nueva.`);
        }
      }
    }
  });
  if (errores.length) return json(res, 400, { error: errores[0], errores });

  const resumen = { secciones_nuevas: 0, preguntas_nuevas: 0, retiradas: 0 };
  db.exec('BEGIN');
  try {
    const cambiarSeccion = db.prepare('UPDATE secciones SET titulo = ?, orden = ?, condicion = ? WHERE id = ?');
    const crearSeccion = db.prepare('INSERT INTO secciones (plantilla_id, orden, titulo, etapa, condicion, activo) VALUES (?, ?, ?, ?, ?, 1)');
    // Si no la mandan, se queda la que tenía: guardar desde una pantalla vieja no
    // borra de qué tipo de envío es cada área.
    // Una condición de grupo se guarda con su lista, no con el nombre del
    // grupo: si mañana cambian los tipos, lo guardado sigue diciendo a qué
    // aplica. El editor la reconoce por su valor reservado (empieza con *).
    const condiciones = condicionesDe(plantilla);
    const condicionPara = (sec, id) => {
      if (sec.condicion === undefined) return id ? condicionVigente.get(id) : null;
      if (!sec.condicion) return null;
      const grupo = condiciones.find((c) => c.valor === sec.condicion.valor && c.en);
      return JSON.stringify(grupo
        ? { campo: grupo.campo, en: grupo.en }
        : { campo: sec.condicion.campo, valor: sec.condicion.valor });
    };
    const cambiarItem = db.prepare('UPDATE items SET seccion_id = ?, orden = ?, texto = ?, tipo_respuesta = ?, meta = ? WHERE id = ?');
    const crearItem = db.prepare('INSERT INTO items (seccion_id, orden, texto, tipo_respuesta, solo_activos, meta, activo) VALUES (?, ?, ?, ?, NULL, ?, 1)');

    secciones.forEach((sec, si) => {
      const titulo = String(sec.titulo).trim();
      let seccionId = Number(sec.id) || null;
      let etapa;
      if (seccionId) {
        cambiarSeccion.run(titulo, si, condicionPara(sec, seccionId), seccionId);
        etapa = seccionesVivas.get(seccionId);
      } else {
        etapa = plantilla.por_etapas && sec.etapa === 'regreso' ? 'regreso' : 'salida';
        seccionId = Number(crearSeccion.run(plantilla.id, si, titulo, etapa, condicionPara(sec, null)).lastInsertRowid);
        resumen.secciones_nuevas++;
      }
      // En Tránsito un documento se carga antes de salir o al regresar; lo dice
      // el área donde quedó, así que no se pregunta aparte.
      const conMomento = (tipo, meta) => {
        if (tipo === 'documento' && plantilla.por_etapas) meta.momento = etapa === 'regreso' ? 'despues' : 'antes';
        return meta;
      };
      (sec.items || []).forEach((it, ii) => {
        const texto = String(it.texto).trim();
        if (it.id) {
          const actual = itemsVivos.get(Number(it.id));
          const meta = conMomento(it.tipo_respuesta,
            metaPara(it.tipo_respuesta, JSON.parse(actual.meta || '{}'), { obligatoria: it.obligatoria }));
          cambiarItem.run(seccionId, ii, texto, it.tipo_respuesta, JSON.stringify(meta), actual.id);
        } else {
          crearItem.run(seccionId, ii, texto, it.tipo_respuesta,
            JSON.stringify(conMomento(it.tipo_respuesta, metaPara(it.tipo_respuesta, {}, { obligatoria: it.obligatoria }))));
          resumen.preguntas_nuevas++;
        }
      });
    });

    const retirarItem = db.prepare('UPDATE items SET activo = 0 WHERE id = ?');
    for (const itemId of retiradas.items || []) {
      if (itemsVivos.has(Number(itemId))) { retirarItem.run(Number(itemId)); resumen.retiradas++; }
    }
    const retirarSeccion = db.prepare('UPDATE secciones SET activo = 0 WHERE id = ?');
    for (const seccionId of retiradas.secciones || []) {
      if (seccionesVivas.has(Number(seccionId))) { retirarSeccion.run(Number(seccionId)); resumen.retiradas++; }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true, ...resumen });
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
        error: `${persona.nombre} necesita clave antes de darle Reportes, Comparativa, Configuración o los reportes de Calidad.`,
      });
    }
    const atado = [...SOLO_ADMIN].find((k) => persona.ajustes[k] && persona.rol !== 'admin');
    if (atado) {
      return json(res, 400, {
        error: `«${ETIQUETA_DE_PERMISO[atado]}» va con el perfil de Administrador y no se otorga suelto. `
          + `Si ${persona.nombre} debe tenerlo, cámbiale el perfil.`,
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
  cerrarSesionesDe((id) => porPersona.has(id));

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

  // Hay permisos que son del perfil de Administrador y no se prestan. La
  // aprobación final de Calidad es uno: otorgarla a alguien más sería dejar de
  // ser la última aprobación.
  if (SOLO_ADMIN.has(cuerpo.clave) && ajustes[cuerpo.clave] && persona.rol !== 'admin') {
    return json(res, 400, {
      error: `«${ETIQUETA_DE_PERMISO[cuerpo.clave]}» va con el perfil de Administrador y no se otorga suelto.`,
    });
  }

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
      error: `Para darle «${ETIQUETA_DE_PERMISO[cuerpo.clave] || cuerpo.clave}» primero asígnale una clave.`,
    });
  }

  db.prepare('UPDATE usuarios SET permisos_extra = ? WHERE id = ?').run(JSON.stringify(ajustes), id);
  cerrarSesionesDe((uid) => uid === id);
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


// La imagen de una unidad o de un material. Una sola por renglón: subir otra
// reemplaza la anterior y el archivo viejo se borra, para que no se acumulen
// fotos que ya nadie ve.
const TABLAS_CON_IMAGEN = {
  activos: 'activos',
  materiales: 'materiales',
  almacen_productos: 'almacen_productos',
  telefonos: 'telefonos_corporativos',
};

ruta('POST', '/api/admin/(activos|materiales|almacen_productos|telefonos)/(\\d+)/imagen', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const tabla = TABLAS_CON_IMAGEN[p[1]];
  const fila = db.prepare(`SELECT id, imagen FROM ${tabla} WHERE id = ?`).get(Number(p[2]));
  if (!fila) return json(res, 404, { error: 'No encontrado' });
  const guardado = guardarArchivoSubido(cuerpo.imagen);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });
  if (guardado.archivo.endsWith('.pdf')) {
    fs.rm(path.join(carpetaFotos(), guardado.archivo), { force: true }, () => {});
    return json(res, 400, { error: 'Tiene que ser una imagen, no un PDF.' });
  }
  db.prepare(`UPDATE ${tabla} SET imagen = ? WHERE id = ?`).run(guardado.archivo, fila.id);
  if (fila.imagen) fs.rm(path.join(carpetaFotos(), fila.imagen), { force: true }, () => {});
  json(res, 200, { imagen: guardado.archivo });
});

ruta('DELETE', '/api/admin/(activos|materiales|almacen_productos|telefonos)/(\\d+)/imagen', (req, res, p) => {
  if (!exigir(req, res, 'configuracion')) return;
  const tabla = TABLAS_CON_IMAGEN[p[1]];
  const fila = db.prepare(`SELECT id, imagen FROM ${tabla} WHERE id = ?`).get(Number(p[2]));
  if (!fila) return json(res, 404, { error: 'No encontrado' });
  db.prepare(`UPDATE ${tabla} SET imagen = NULL WHERE id = ?`).run(fila.id);
  if (fila.imagen) fs.rm(path.join(carpetaFotos(), fila.imagen), { force: true }, () => {});
  json(res, 200, { ok: true });
});

// --- catálogo de Calidad: materiales, proveedores y colores de fondo ---

// Es lo que en el Excel era la hoja MATERIALES, protegida con contraseña de
// administrador. Aquí vive en la misma pestaña que las unidades y se edita sin
// riesgo de pisar una fórmula.

const CAMPOS_MATERIAL = [
  'color_impresion', 'marca_termino', 'tipo_centro', 'gap',
  'cant_x_rollo', 'colores', 'diam_referencia', 'centro_referencia',
];

const TIPOS_CATALOGO = { proveedor: 'proveedor', fondo: 'fondo' };

ruta('GET', '/api/admin/materiales', (req, res) => {
  if (!exigir(req, res, 'configuracion')) return;
  json(res, 200, {
    materiales: db.prepare(`
      SELECT m.*, (SELECT COUNT(*) FROM almacen_productos p WHERE p.material_id = m.id) AS productos
        FROM materiales m ORDER BY m.orden, m.modelo`).all(),
    proveedores: db.prepare("SELECT id, valor, activo FROM catalogo_calidad WHERE tipo = 'proveedor' ORDER BY orden, valor").all(),
    fondos: db.prepare("SELECT id, valor, activo FROM catalogo_calidad WHERE tipo = 'fondo' ORDER BY orden, valor").all(),
    // Todos los productos: son los mismos que Calidad muestrea (por su modelo de
    // muestreo, `material_id`) y que Almacén mueve. Se enseñan por familia.
    productos: db.prepare(`
      SELECT id, sku, nombre, modelo, tipo_material, stock_minimo, activo, imagen, material_id,
             especial, subagrupador, descripcion, orden
        FROM almacen_productos ORDER BY tipo_material, orden, nombre`).all(),
    // Las partidas de producción especial que ya existen, para no volver a
    // escribirlas y para que no acaben tres formas distintas de lo mismo.
    subagrupadores: db.prepare(`
      SELECT subagrupador AS nombre, COUNT(*) AS productos
        FROM almacen_productos
       WHERE especial = 1 AND subagrupador IS NOT NULL AND subagrupador <> ''
       GROUP BY subagrupador ORDER BY subagrupador`).all(),
    tipos_material: db.prepare(`
      SELECT DISTINCT tipo_material FROM almacen_productos
       WHERE tipo_material IS NOT NULL AND tipo_material <> '' ORDER BY tipo_material`)
      .all().map((t) => t.tipo_material),
  });
});

ruta('POST', '/api/admin/materiales', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const modelo = String(cuerpo.modelo || '').trim();
  if (!modelo) return json(res, 400, { error: 'Falta el modelo' });

  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM materiales').get().n + 1;
  try {
    db.prepare(`
      INSERT INTO materiales (modelo, color_impresion, marca_termino, tipo_centro, gap,
                              cant_x_rollo, colores, diam_referencia, centro_referencia, orden, familia)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(modelo, ...CAMPOS_MATERIAL.map((c) => String(cuerpo[c] || '').trim()), orden,
      cuerpo.familia === 'rollos' ? 'rollos' : 'etiquetas');
  } catch {
    return json(res, 409, { error: 'Ya existe un material con ese modelo' });
  }
  json(res, 200, { ok: true });
});

ruta('PUT', '/api/admin/materiales/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const material = db.prepare('SELECT * FROM materiales WHERE id = ?').get(Number(p[1]));
  if (!material) return json(res, 404, { error: 'Material no encontrado' });

  // El modelo no se renombra desde aquí: los lotes ya capturados apuntan a este
  // renglón, y cambiarle el nombre reescribiría la historia de esos muestreos.
  // Para retirar un modelo se desmarca 'activo' y deja de aparecer en la tablet.
  db.prepare(`
    UPDATE materiales SET color_impresion = ?, marca_termino = ?, tipo_centro = ?,
                          gap = ?, cant_x_rollo = ?, colores = ?,
                          diam_referencia = ?, centro_referencia = ?, activo = ?
    WHERE id = ?
  `).run(
    ...CAMPOS_MATERIAL.map((c) => (c in cuerpo ? String(cuerpo[c] || '').trim() : material[c])),
    cuerpo.activo ? 1 : 0,
    material.id
  );
  json(res, 200, { ok: true });
});

// Las fotos de los productos, para que cada pantalla que nombra un producto
// —Almacén, Producción, Calidad, Ventas directas— enseñe la suya. Solo viajan
// los nombres de archivo; la foto se pide aparte, con la sesión.
ruta('GET', '/api/productos/fotos', (req, res) => {
  if (!exigir(req, res)) return;
  json(res, 200, db.prepare(`
    SELECT p.id, p.sku, p.nombre, p.modelo, COALESCE(p.imagen, m.imagen) AS imagen
      FROM almacen_productos p LEFT JOIN materiales m ON m.id = p.material_id
     WHERE COALESCE(p.imagen, m.imagen) IS NOT NULL
  `).all());
});

// --- borrar o retirar: modelos de muestreo y productos ---
//
// Se BORRA solo lo que nunca se usó. Lo que ya tiene historia —muestreos en
// Calidad, movimientos de inventario, órdenes— no se borra: se RETIRA, deja de
// ofrecerse y la historia sigue leyéndose igual. Borrarlo dejaría documentos
// apuntando a nada.
const USOS_DE_PRODUCTO = [
  ['almacen_movimientos', 'movimiento(s) de inventario'],
  ['almacen_entrada_renglones', 'entrada(s)'],
  ['almacen_salida_renglones', 'salida(s)'],
  ['almacen_devolucion_renglones', 'devolución(es)'],
  ['almacen_conteo_renglones', 'conteo(s)'],
  ['recepcion_sin_muestreo', 'recepción(es) de Calidad'],
  ['almacen_reingreso_cajas', 're-ingreso(s)'],
  ['vxf_renglones', 'orden(es) de venta directa'],
  ['vxf_cajas', 'caja(s) de venta directa'],
];

function usosDeProducto(p) {
  const usos = USOS_DE_PRODUCTO
    .map(([tabla, que]) => [db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE producto_id = ?`).get(p.id).n, que])
    .filter(([n]) => n > 0)
    .map(([n, que]) => `${n} ${que}`);
  // Las publicaciones de la ODT buscan el producto por su modelo: si es el único
  // con ese modelo, borrarlo dejaría esas publicaciones sin traducir a material.
  const mismos = db.prepare('SELECT COUNT(*) AS n FROM almacen_productos WHERE modelo = ? AND id <> ?').get(p.modelo, p.id).n;
  if (!mismos) {
    const pubs = db.prepare('SELECT COUNT(*) AS n FROM almacen_publicaciones WHERE modelo = ? AND activo = 1').get(p.modelo).n;
    if (pubs) usos.push(`${pubs} publicación(es) del catálogo de la ODT`);
  }
  return usos;
}

ruta('DELETE', '/api/admin/materiales/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'configuracion')) return;
  const m = db.prepare('SELECT * FROM materiales WHERE id = ?').get(Number(p[1]));
  if (!m) return json(res, 404, { error: 'Ese modelo no existe.' });
  const lotes = db.prepare('SELECT COUNT(*) AS n FROM lotes WHERE material_id = ?').get(m.id).n;
  if (lotes) {
    return json(res, 409, {
      error: `${m.modelo} ya tiene ${lotes} lote(s) muestreado(s) en Calidad: no se borra para no perder esa historia. Retíralo: en «Especificación», desmarca «Se muestrea».`,
    });
  }
  db.exec('BEGIN');
  try {
    // Sus productos se quedan; solo dejan de muestrearse contra él.
    db.prepare('UPDATE almacen_productos SET material_id = NULL WHERE material_id = ?').run(m.id);
    db.prepare('DELETE FROM materiales WHERE id = ?').run(m.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    return json(res, 500, { error: 'No se pudo borrar.' });
  }
  if (m.imagen) fs.rm(path.join(carpetaFotos(), m.imagen), { force: true }, () => {});
  json(res, 200, { ok: true });
});

// Corregir un producto: nombre, stock mínimo y si sigue en uso. El modelo y el
// SKU no se tocan aquí: con ellos se traduce la ODT y se identifica en todo.
// El SKU se genera solo, con el mismo formato que trajo la carga inicial. Nadie
// lo teclea: un SKU repetido o con un espacio de más rompe el cotejo contra el
// Excel, y no hay nada que decidir ahí.
function siguienteSKU() {
  const n = db.prepare(`
    SELECT COALESCE(MAX(CAST(substr(sku, 4) AS INTEGER)), 0) AS n
      FROM almacen_productos WHERE sku LIKE 'SKU%'
  `).get().n;
  return `SKU${String(n + 1).padStart(6, '0')}`;
}

// Alta de un producto a mano. Existe por la producción especial: cuando llega
// una del proveedor hay que poder darla de alta y cargarla al inventario el
// mismo día, sin esperar a que alguien reconstruya el Excel del catálogo.
ruta('POST', '/api/admin/productos', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;

  const nombre = String(cuerpo.nombre || '').trim();
  if (nombre.length < 3) return json(res, 400, { error: 'Escribe el nombre del producto.' });
  const especial = cuerpo.especial === undefined ? 1 : (cuerpo.especial ? 1 : 0);
  const subagrupador = String(cuerpo.subagrupador || '').trim() || null;
  if (especial && !subagrupador) {
    return json(res, 400, { error: 'Di bajo qué partida va: es lo que la separa del catálogo de siempre.' });
  }
  const tipo = String(cuerpo.tipo_material || '').trim();
  if (!tipo) return json(res, 400, { error: 'Di de qué tipo es: de ahí sale en qué se cuenta.' });

  const material = Number(cuerpo.material_id) || null;
  if (material && !db.prepare('SELECT 1 FROM materiales WHERE id = ?').get(material)) {
    return json(res, 400, { error: 'Ese modelo de muestreo no existe.' });
  }

  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM almacen_productos').get().n + 1;
  let id;
  try {
    id = Number(db.prepare(`
      INSERT INTO almacen_productos
        (sku, modelo, tipo_material, nombre, stock_minimo, material_id, orden, activo,
         especial, subagrupador, descripcion)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(siguienteSKU(), String(cuerpo.modelo || '').trim() || null, tipo, nombre,
      Math.max(0, Math.round(Number(cuerpo.stock_minimo) || 0)), material, orden,
      especial, subagrupador, String(cuerpo.descripcion || '').trim() || null).lastInsertRowid);
  } catch {
    return json(res, 409, { error: 'Ya hay un producto con ese nombre.' });
  }
  json(res, 201, {
    id,
    mensaje: `${nombre} dado de alta. Ya se le puede capturar una entrada.`,
  });
});

ruta('PUT', '/api/admin/productos/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const pr = db.prepare('SELECT * FROM almacen_productos WHERE id = ?').get(Number(p[1]));
  if (!pr) return json(res, 404, { error: 'Ese producto no existe.' });
  const nombre = cuerpo.nombre === undefined ? pr.nombre : String(cuerpo.nombre).trim();
  if (nombre.length < 2) return json(res, 400, { error: 'Escribe el nombre del producto.' });
  const minimo = cuerpo.stock_minimo === undefined ? pr.stock_minimo : Math.max(0, Math.round(Number(cuerpo.stock_minimo) || 0));
  const activo = cuerpo.activo === undefined ? pr.activo : (cuerpo.activo ? 1 : 0);

  // Pasar un producto a producción especial —o sacarlo— no toca su historia: es
  // el mismo producto, con sus mismos movimientos, agrupado en otro lado.
  const especial = cuerpo.especial === undefined ? pr.especial : (cuerpo.especial ? 1 : 0);
  const subagrupador = cuerpo.subagrupador === undefined ? pr.subagrupador
    : (String(cuerpo.subagrupador || '').trim() || null);
  if (especial && !subagrupador) {
    return json(res, 400, { error: 'Di bajo qué partida va.' });
  }
  const descripcion = cuerpo.descripcion === undefined ? pr.descripcion
    : (String(cuerpo.descripcion || '').trim() || null);

  try {
    db.prepare(`
      UPDATE almacen_productos
         SET nombre = ?, stock_minimo = ?, activo = ?, especial = ?, subagrupador = ?, descripcion = ?
       WHERE id = ?
    `).run(nombre, minimo, activo, especial, especial ? subagrupador : null, descripcion, pr.id);
  } catch {
    return json(res, 409, { error: 'Ya hay un producto con ese nombre.' });
  }
  json(res, 200, { ok: true });
});

// Subir o bajar un producto dentro de su partida. Se intercambia el orden con el
// vecino: así el renglón se mueve donde se ve, y no hay que renumerar todo.
ruta('POST', '/api/admin/productos/(\\d+)/mover', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const pr = db.prepare('SELECT * FROM almacen_productos WHERE id = ?').get(Number(p[1]));
  if (!pr) return json(res, 404, { error: 'Ese producto no existe.' });
  const arriba = cuerpo.hacia !== 'abajo';

  const hermanos = db.prepare(`
    SELECT id, orden FROM almacen_productos
     WHERE especial = ? AND COALESCE(subagrupador, '') = COALESCE(?, '')
       AND (? = 1 OR tipo_material = ?)
     ORDER BY orden, nombre
  `).all(pr.especial, pr.subagrupador, pr.especial ? 1 : 0, pr.tipo_material);

  const i = hermanos.findIndex((x) => x.id === pr.id);
  const j = arriba ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= hermanos.length) {
    return json(res, 409, { error: arriba ? 'Ya es el primero.' : 'Ya es el último.' });
  }

  // Si dos vecinos tienen el mismo 'orden' —pasa con lo que vino de la carga
  // inicial— intercambiarlo no movería nada: se renumera la partida primero.
  if (hermanos[i].orden === hermanos[j].orden) {
    const renumerar = db.prepare('UPDATE almacen_productos SET orden = ? WHERE id = ?');
    hermanos.forEach((h, k) => { renumerar.run(k, h.id); h.orden = k; });
  }
  const cambiar = db.prepare('UPDATE almacen_productos SET orden = ? WHERE id = ?');
  cambiar.run(hermanos[j].orden, hermanos[i].id);
  cambiar.run(hermanos[i].orden, hermanos[j].id);
  json(res, 200, { ok: true });
});

ruta('DELETE', '/api/admin/productos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'configuracion')) return;
  const pr = db.prepare('SELECT * FROM almacen_productos WHERE id = ?').get(Number(p[1]));
  if (!pr) return json(res, 404, { error: 'Ese producto no existe.' });
  const usos = usosDeProducto(pr);
  if (usos.length) {
    return json(res, 409, {
      error: `${pr.nombre} ya se usó (${usos.join(', ')}): no se borra para no perder esa historia. Retíralo: desmarca «En uso».`,
    });
  }
  db.prepare('DELETE FROM almacen_productos WHERE id = ?').run(pr.id);
  if (pr.imagen) fs.rm(path.join(carpetaFotos(), pr.imagen), { force: true }, () => {});
  json(res, 200, { ok: true });
});

ruta('POST', '/api/admin/catalogo-calidad', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  const tipo = TIPOS_CATALOGO[cuerpo.tipo];
  const valor = String(cuerpo.valor || '').trim();
  if (!tipo || !valor) return json(res, 400, { error: 'Falta el tipo o el valor' });

  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) AS n FROM catalogo_calidad WHERE tipo = ?').get(tipo).n + 1;
  try {
    db.prepare('INSERT INTO catalogo_calidad (tipo, valor, orden) VALUES (?, ?, ?)').run(tipo, valor, orden);
  } catch {
    return json(res, 409, { error: `«${valor}» ya está en la lista` });
  }
  json(res, 200, { ok: true });
});

ruta('PUT', '/api/admin/catalogo-calidad/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'configuracion')) return;
  db.prepare('UPDATE catalogo_calidad SET activo = ? WHERE id = ?').run(cuerpo.activo ? 1 : 0, Number(p[1]));
  json(res, 200, { ok: true });
});



// ------------------------------------------------------------ incidencias
//
// La hoja de papel, tal cual: los nombres de todos los operadores y Team
// Leaders, y al lado de cada quien la situación y la fecha en que fue.
//
// Lo que el papel no podía hacer y aquí sí:
//
//   · Se sabe QUIÉN anotó. En la hoja solo quedaba la letra.
//   · Un Team Leader levanta, pero no cuenta hasta que el Administrador
//     autoriza. En papel eso era una conversación aparte que no dejaba rastro.
//   · La que levanta el Administrador nace autorizada y firme: no la modifica
//     nadie, ni él mismo.
//   · Una vez autorizada, ninguna se toca. El renglón queda como quedó.
//
// Esto termina afectando el bono del mes, así que cada renglón tiene que poder
// responder «quién lo anotó, quién lo autorizó y cuándo» sin depender de la
// memoria de nadie.

const ESTADOS_INCIDENCIA = {
  por_autorizar: 'Por autorizar',
  autorizada: 'Autorizada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

const incidenciaCompleta = (id) => db.prepare(`
  SELECT i.*, u.nombre AS persona, u.rol AS persona_rol,
         l.nombre AS levanto, r.nombre AS resolvio
    FROM incidencias i
    JOIN usuarios u ON u.id = i.usuario_id
    JOIN usuarios l ON l.id = i.levantada_por
    LEFT JOIN usuarios r ON r.id = i.resuelta_por
   WHERE i.id = ?
`).get(id);

// La hoja: todas las personas activas, cada una con lo suyo. Se devuelve
// completa —también quien no tiene nada— porque así es la hoja de papel y
// porque un nombre sin incidencias es información, no un hueco.
function hojaDeIncidencias(usuario, desde, hasta) {
  const verTodas = puede(usuario, 'incidencias_ver_todas');

  // La hoja trae operadores y Team Leaders, como el papel. El Administrador no
  // sale: a él no se le levanta una incidencia, él las autoriza.
  const personas = db.prepare(`
    SELECT id, nombre, rol, (SELECT etiqueta FROM puestos WHERE clave = usuarios.rol) AS puesto FROM usuarios
     WHERE activo = 1 AND rol <> 'admin' ${verTodas ? '' : 'AND id = ?'}
     ORDER BY nombre
  `).all(...(verTodas ? [] : [usuario.id]));

  const filas = db.prepare(`
    SELECT i.*, l.nombre AS levanto, r.nombre AS resolvio
      FROM incidencias i
      JOIN usuarios l ON l.id = i.levantada_por
      LEFT JOIN usuarios r ON r.id = i.resuelta_por
     WHERE i.fecha >= ? AND i.fecha <= ? ${verTodas ? '' : 'AND i.usuario_id = ?'}
     ORDER BY i.fecha DESC, i.id DESC
  `).all(...(verTodas ? [desde, hasta] : [desde, hasta, usuario.id]));

  const porPersona = new Map(personas.map((p) => [p.id, { ...p, incidencias: [] }]));
  for (const f of filas) {
    const p = porPersona.get(f.usuario_id);
    // Quien ya no está activo no sale en la hoja, pero su incidencia no se borra.
    if (p) p.incidencias.push(f);
  }

  return [...porPersona.values()];
}

const primerDiaDelMes = (mes) => `${mes}-01`;
const ultimoDiaDelMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const mesActual = () => hoyISO().slice(0, 7);

ruta('GET', '/api/incidencias', (req, res) => {
  const usuario = exigir(req, res, 'mod_incidencias');
  if (!usuario) return;

  const url = new URL(req.url, 'http://x');
  const mes = /^\d{4}-\d{2}$/.test(url.searchParams.get('mes') || '') ? url.searchParams.get('mes') : mesActual();

  json(res, 200, {
    mes,
    hoja: hojaDeIncidencias(usuario, primerDiaDelMes(mes), ultimoDiaDelMes(mes)),
    ve_todas: puede(usuario, 'incidencias_ver_todas'),
    puede_levantar: puede(usuario, 'incidencias_levantar'),
    puede_autorizar: puede(usuario, 'incidencias_autorizar'),
    estados: ESTADOS_INCIDENCIA,
    // A quién se le puede levantar: operadores y Team Leaders, como en la hoja.
    personas: puede(usuario, 'incidencias_levantar')
      ? db.prepare("SELECT id, nombre, rol, (SELECT etiqueta FROM puestos WHERE clave = usuarios.rol) AS puesto FROM usuarios WHERE activo = 1 AND rol <> 'admin' ORDER BY nombre").all()
      : [],
    // Los meses que ya tienen algo anotado, para poder ir hacia atrás.
    meses: db.prepare(`
      SELECT DISTINCT substr(fecha, 1, 7) AS mes FROM incidencias ORDER BY mes DESC LIMIT 24
    `).all().map((f) => f.mes),
  });
});

ruta('POST', '/api/incidencias', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'incidencias_levantar');
  if (!usuario) return;

  const persona = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE id = ? AND activo = 1')
    .get(Number(cuerpo.usuario_id || 0));
  if (!persona) return json(res, 400, { error: 'Escoge a quién se le levanta la incidencia.' });
  if (persona.rol === 'admin') {
    return json(res, 409, { error: 'Al Administrador no se le levanta una incidencia desde aquí.' });
  }
  if (persona.id === usuario.id) {
    return json(res, 409, { error: 'No puedes levantarte una incidencia a ti mismo.' });
  }

  const situacion = String(cuerpo.situacion || '').trim();
  if (situacion.length < 10) {
    return json(res, 400, { error: 'Escribe la situación: qué pasó, con suficiente detalle para entenderlo en un mes.' });
  }
  const fecha = String(cuerpo.fecha || hoyISO()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, 400, { error: 'La fecha va como 2026-08-31.' });
  if (fecha > hoyISO()) return json(res, 400, { error: 'No se puede anotar una incidencia con fecha futura.' });

  // La del Administrador nace autorizada y firme; la de un Team Leader espera.
  const esAdmin = usuario.rol === 'admin';
  const ahora = new Date().toISOString();
  const id = Number(db.prepare(`
    INSERT INTO incidencias (usuario_id, fecha, situacion, estado, levantada_por, levantada_en,
                             resuelta_por, resuelta_en, firme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(persona.id, fecha, situacion, esAdmin ? 'autorizada' : 'por_autorizar',
    usuario.id, ahora, esAdmin ? usuario.id : null, esAdmin ? ahora : null, esAdmin ? 1 : 0).lastInsertRowid);

  json(res, 201, { incidencia: incidenciaCompleta(id) });
});

// Trae la incidencia comprobando que todavía se pueda tocar.
function incidenciaEditable(res, id, usuario) {
  const i = incidenciaCompleta(id);
  if (!i) { json(res, 404, { error: 'Incidencia no encontrada' }); return null; }
  if (i.firme) {
    json(res, 409, { error: 'Esa incidencia la levantó el Administrador: no se modifica.' });
    return null;
  }
  if (i.estado !== 'por_autorizar') {
    json(res, 409, { error: `Esa incidencia ya está ${ESTADOS_INCIDENCIA[i.estado].toLowerCase()}; el renglón queda como quedó.` });
    return null;
  }
  if (i.levantada_por !== usuario.id && usuario.rol !== 'admin') {
    json(res, 403, { error: 'Solo quien la levantó puede corregirla, o el Administrador.' });
    return null;
  }
  return i;
}

// Corregir lo que se escribió, mientras nadie la haya autorizado.
ruta('PUT', '/api/incidencias/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'incidencias_levantar');
  if (!usuario) return;
  const i = incidenciaEditable(res, Number(p[1]), usuario);
  if (!i) return;

  const situacion = String(cuerpo.situacion ?? i.situacion).trim();
  if (situacion.length < 10) return json(res, 400, { error: 'La situación quedó demasiado corta.' });
  const fecha = String(cuerpo.fecha ?? i.fecha).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoyISO()) {
    return json(res, 400, { error: 'Revisa la fecha.' });
  }

  db.prepare('UPDATE incidencias SET situacion = ?, fecha = ? WHERE id = ?').run(situacion, fecha, i.id);
  json(res, 200, { incidencia: incidenciaCompleta(i.id) });
});

// Retirarla antes de que se autorice. No se borra: queda el rastro de que se
// levantó y se echó para atrás, que es distinto de que nunca haya existido.
ruta('POST', '/api/incidencias/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'incidencias_levantar');
  if (!usuario) return;
  const i = incidenciaEditable(res, Number(p[1]), usuario);
  if (!i) return;

  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Anota por qué la retiras.' });

  db.prepare(`
    UPDATE incidencias SET estado = 'cancelada', resuelta_por = ?, resuelta_en = ?, nota_resolucion = ?
     WHERE id = ?
  `).run(usuario.id, new Date().toISOString(), motivo, i.id);
  json(res, 200, { incidencia: incidenciaCompleta(i.id) });
});

// La autorización del Administrador: sin ella la incidencia no cuenta para el
// corte del mes. Es el único paso que él no delega.
ruta('POST', '/api/incidencias/(\\d+)/(autorizar|rechazar)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'incidencias_autorizar');
  if (!usuario) return;

  const i = incidenciaCompleta(Number(p[1]));
  if (!i) return json(res, 404, { error: 'Incidencia no encontrada' });
  if (i.estado !== 'por_autorizar') {
    return json(res, 409, { error: `Esa incidencia ya está ${ESTADOS_INCIDENCIA[i.estado].toLowerCase()}.` });
  }

  const rechaza = p[2] === 'rechazar';
  const nota = String(cuerpo.nota || '').trim();
  if (rechaza && !nota) return json(res, 400, { error: 'Anota por qué la rechazas: quien la levantó tiene que saberlo.' });

  db.prepare(`
    UPDATE incidencias
       SET estado = ?, resuelta_por = ?, resuelta_en = ?, nota_resolucion = ?, firme = 1
     WHERE id = ?
  `).run(rechaza ? 'rechazada' : 'autorizada', usuario.id, new Date().toISOString(), nota || null, i.id);

  json(res, 200, { incidencia: incidenciaCompleta(i.id) });
});

// El corte del mes: lo que se descarga para afectar los bonos. Solo cuenta lo
// AUTORIZADO — lo que espera autorización, lo rechazado y lo cancelado aparece
// en la pantalla pero no en este número, que es el que tiene consecuencia.
function corteDelMes(mes) {
  const desde = primerDiaDelMes(mes);
  const hasta = ultimoDiaDelMes(mes);
  return db.prepare(`
    SELECT u.id, u.nombre, u.rol, (SELECT etiqueta FROM puestos WHERE clave = u.rol) AS puesto,
           COUNT(i.id) AS autorizadas,
           GROUP_CONCAT(i.fecha || ' · ' || i.situacion, ' ||| ') AS detalle
      FROM usuarios u
      LEFT JOIN incidencias i
        ON i.usuario_id = u.id AND i.estado = 'autorizada'
       AND i.fecha >= ? AND i.fecha <= ?
     WHERE u.activo = 1 AND u.rol <> 'admin'
     GROUP BY u.id
     ORDER BY autorizadas DESC, u.nombre
  `).all(desde, hasta);
}

ruta('GET', '/api/incidencias/corte', (req, res) => {
  const usuario = exigir(req, res, 'incidencias_reportes');
  if (!usuario) return;
  const url = new URL(req.url, 'http://x');
  const mes = /^\d{4}-\d{2}$/.test(url.searchParams.get('mes') || '') ? url.searchParams.get('mes') : mesActual();
  json(res, 200, { mes, corte: corteDelMes(mes) });
});

ruta('GET', '/api/incidencias/corte.csv', (req, res) => {
  const usuario = exigir(req, res, 'incidencias_reportes');
  if (!usuario) return;
  const url = new URL(req.url, 'http://x');
  const mes = /^\d{4}-\d{2}$/.test(url.searchParams.get('mes') || '') ? url.searchParams.get('mes') : mesActual();

  const filas = [['Persona', 'Perfil', 'Incidencias autorizadas', 'Detalle']];
  for (const f of corteDelMes(mes)) {
    filas.push([f.nombre, f.puesto || f.rol, f.autorizadas, (f.detalle || '').split(' ||| ').join(' / ')]);
  }
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="incidencias-${mes}.csv"`,
  });
  // El BOM es para que Excel lo abra con los acentos derechos al primer intento.
  res.end('﻿' + csv);
});

// --- reporte de Incidencias ---
//
// El corte del mes es lo que se descarga para afectar los bonos, así que este
// reporte gira alrededor de él: el mes que se está cortando y los meses de atrás
// al lado, para ver quién se repite. Un número suelto no dice si alguien tuvo un
// mal mes o trae un problema desde hace medio año.

ruta('GET', '/api/incidencias/reportes', (req, res) => {
  const usuario = exigir(req, res, 'incidencias_reportes');
  if (!usuario) return;

  const url = new URL(req.url, 'http://x');
  const mes = /^\d{4}-\d{2}$/.test(url.searchParams.get('mes') || '') ? url.searchParams.get('mes') : mesActual();

  // Los seis meses que terminan en el que se está viendo.
  const meses = [];
  const [anio, m] = mes.split('-').map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(anio, m - 1 - i, 1));
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  const personas = db.prepare(
    "SELECT id, nombre, rol FROM usuarios WHERE activo = 1 AND rol <> 'admin' ORDER BY nombre"
  ).all();

  // Solo lo AUTORIZADO: es lo único que tiene consecuencia.
  const porMes = db.prepare(`
    SELECT usuario_id, substr(fecha, 1, 7) AS mes, COUNT(*) AS n
      FROM incidencias
     WHERE estado = 'autorizada' AND substr(fecha, 1, 7) >= ? AND substr(fecha, 1, 7) <= ?
     GROUP BY usuario_id, mes
  `).all(meses[0], meses[meses.length - 1]);

  const cuenta = new Map(porMes.map((f) => [`${f.usuario_id}|${f.mes}`, f.n]));

  const historial = personas.map((p) => {
    const fila = { ...p, meses: {}, total: 0 };
    for (const x of meses) {
      const n = cuenta.get(`${p.id}|${x}`) || 0;
      fila.meses[x] = n;
      fila.total += n;
    }
    return fila;
  }).sort((a, b) => b.meses[mes] - a.meses[mes] || b.total - a.total || a.nombre.localeCompare(b.nombre));

  // Lo que quedó fuera del corte y por qué: sirve para saber si se está
  // levantando mucho que después no procede.
  const descartadas = db.prepare(`
    SELECT estado, COUNT(*) AS n FROM incidencias
     WHERE substr(fecha, 1, 7) = ? AND estado <> 'autorizada'
     GROUP BY estado
  `).all(mes);

  json(res, 200, {
    mes,
    meses,
    corte: corteDelMes(mes),
    historial,
    descartadas,
    // Los meses que ya tienen algo, para poder moverse hacia atrás.
    disponibles: db.prepare(
      'SELECT DISTINCT substr(fecha, 1, 7) AS mes FROM incidencias ORDER BY mes DESC LIMIT 24'
    ).all().map((f) => f.mes),
  });
});

// ---------------------------------------------------- resguardo de auditoría
//
// Seis años. Es lo que Ronaldo pidió para poder contestarle a una auditoría sin
// depender de que nadie se acuerde, y tiene dos partes:
//
//   · EL CANDADO. Un documento cerrado —uno que movió inventario, un checklist
//     cerrado, una recepción aprobada, una venta terminada— no se puede borrar
//     desde Limpieza hasta que cumpla seis años. Limpieza es una herramienta de
//     obra para tirar lo que se capturó probando; sin candado, un día de
//     limpieza se lleva la prueba de algo que hay que poder demostrar.
//
//   · EL PAQUETE. Un año se puede empacar: las listas de todos sus documentos,
//     sus movimientos de inventario y las fotos de evidencia, en una carpeta que
//     se le entrega al auditor sin tener que darle acceso al sistema.
//
// En una copia de pruebas el candado no aplica —ahí nada es real— y el paquete
// no se arma: se arma sobre la operación de verdad.
const ANIOS_RESGUARDO = 6;

// Dónde vive cada documento, qué fecha cuenta y en qué estado se considera
// cerrado. Las claves son las mismas de Limpieza, para que el candado y lo que
// se puede borrar hablen siempre del mismo documento. Sin 'cerrados', todo lo
// de la tabla cuenta: una carga de gasolina o un papel no tienen estados, son
// hechos desde que se capturan.
//
// La ODT no está aquí a propósito: es un plan de producción que se reemplaza
// cuando cambia, no un registro contable.
//
// 'reabierto' es el trozo de SQL que reconoce un documento que YA estuvo
// cerrado aunque ahora esté otra vez en captura. Sin eso, reabrir sería la
// puerta de atrás para borrar algo resguardado: se reabre y se borra. El
// documento sigue resguardado toda su vida; lo que cambia es que se puede
// corregir, y la corrección queda anotada.
const corregidoDesde = (tipo, tabla, estados) => `EXISTS (
  SELECT 1 FROM almacen_correcciones c
   WHERE c.documento_tipo = '${tipo}' AND c.documento_id = ${tabla}.id
     AND c.estado_anterior IN (${estados.map((e) => `'${e}'`).join(', ')}))`;

const RESGUARDO_POR_TIPO = {
  llenado: {
    tabla: 'llenados', fecha: 'COALESCE(cerrado_en, creado_en)', cerrados: ['cerrado'],
    que: 'checklist cerrado',
    reabierto: `EXISTS (SELECT 1 FROM llenado_revisiones v
                         WHERE v.llenado_id = llenados.id AND v.accion = 'reapertura')`,
  },
  recepcion: {
    tabla: 'recepciones', fecha: 'creado_en', cerrados: ['aprobado', 'cerrado'],
    que: 'recepción de Calidad',
    reabierto: `EXISTS (SELECT 1 FROM reversiones_calidad r
                         WHERE r.tipo = 'recepcion_reabierta' AND r.referencia_id = recepciones.id)`,
  },
  entrada: {
    tabla: 'almacen_entradas', fecha: 'creado_en', cerrados: ['aplicada'], que: 'entrada aplicada',
    reabierto: corregidoDesde('entrada', 'almacen_entradas', ['aplicada']),
  },
  retiro: {
    tabla: 'almacen_entradas', fecha: 'creado_en', cerrados: ['aplicada'], que: 'retiro aplicado',
    reabierto: corregidoDesde('entrada', 'almacen_entradas', ['aplicada']),
  },
  reingreso: {
    tabla: 'almacen_reingresos', fecha: 'creado_en', cerrados: ['aplicado'], que: 're-ingreso aplicado',
    reabierto: corregidoDesde('reingreso', 'almacen_reingresos', ['aplicado']),
  },
  salida: {
    tabla: 'almacen_salidas', fecha: 'creado_en', cerrados: ['aplicada'], que: 'salida aplicada',
    reabierto: corregidoDesde('salida', 'almacen_salidas', ['aplicada']),
  },
  traspaso: {
    tabla: 'almacen_salidas', fecha: 'creado_en', cerrados: ['aplicada'], que: 'traspaso aplicado',
    reabierto: corregidoDesde('salida', 'almacen_salidas', ['aplicada']),
  },
  salida_calidad: {
    tabla: 'almacen_salidas', fecha: 'creado_en', cerrados: ['aplicada'], que: 'baja por calidad',
    reabierto: corregidoDesde('salida', 'almacen_salidas', ['aplicada']),
  },
  devolucion: {
    tabla: 'almacen_devoluciones', fecha: 'creado_en', cerrados: ['aplicada'], que: 'devolución aplicada',
    reabierto: corregidoDesde('devolucion', 'almacen_devoluciones', ['aplicada']),
  },
  conteo: {
    tabla: 'almacen_conteos', fecha: 'creado_en', cerrados: ['aplicado'], que: 'conteo aplicado',
    reabierto: corregidoDesde('conteo', 'almacen_conteos', ['aplicado']),
  },
  vxf: {
    tabla: 'vxf_ordenes', fecha: 'creado_en', cerrados: ['terminada'], que: 'venta directa terminada',
    reabierto: corregidoDesde('vxf', 'vxf_ordenes', ['terminada']),
  },
  incidencia: { tabla: 'incidencias', fecha: 'fecha', cerrados: ['autorizada'], que: 'incidencia autorizada' },
  carga_inicial: {
    tabla: 'almacen_movimientos', fecha: 'creado_en', que: 'existencia inicial',
    donde: "origen_tipo = 'carga_inicial'",
  },
  logistica_cargas: { tabla: 'logistica_cargas', fecha: 'creado_en', que: 'carga de gasolina' },
  logistica_servicios: { tabla: 'logistica_servicios', fecha: 'creado_en', que: 'servicio de unidad' },
  logistica_documentos: {
    tabla: 'logistica_documentos', fecha: 'subido_en', que: 'papel de unidad',
    donde: "ambito = 'unidad'",
  },
  bahia_personal: {
    tabla: 'logistica_documentos', fecha: 'subido_en', que: 'papel del personal',
    donde: "ambito = 'persona'",
  },
  accesos_bitacora: { tabla: 'accesos_bitacora', fecha: 'en', que: 'movimiento de acceso' },
};

// Hasta cuándo hay que guardar algo con esa fecha.
function finDeResguardo(cuando) {
  const d = new Date(cuando);
  if (!cuando || Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + ANIOS_RESGUARDO);
  return d.toISOString().slice(0, 10);
}

// La fecha a partir de la cual algo todavía está resguardado: hoy menos seis
// años. Lo anterior ya cumplió y se puede tirar.
function limiteDeResguardo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - ANIOS_RESGUARDO);
  return d.toISOString().slice(0, 10);
}

// Qué documentos de una tabla cuentan para el resguardo: los que están en un
// estado cerrado, más el filtro propio del tipo si lo tiene.
function dondeResguardo(r) {
  const partes = [];
  const valores = [];
  if (r.cerrados) {
    const cerrado = `estado IN (${r.cerrados.map(() => '?').join(', ')})`;
    valores.push(...r.cerrados);
    // Cerrado ahora, o cerrado alguna vez y reabierto después.
    partes.push(r.reabierto ? `(${cerrado} OR ${r.reabierto})` : cerrado);
  }
  if (r.donde) partes.push(r.donde);
  return { partes, valores };
}

// Qué documentos de un tipo cuentan como registro, sin mirar la fecha: los
// cerrados. Es lo que se empaca para una auditoría.
function idsQueCuentan(clave) {
  const r = RESGUARDO_POR_TIPO[clave];
  if (!r) return new Set();
  const { partes, valores } = dondeResguardo(r);
  return new Set(db.prepare(`
    SELECT id FROM ${r.tabla} ${partes.length ? `WHERE ${partes.join(' AND ')}` : ''}
  `).all(...valores).map((f) => f.id));
}

// Los documentos de un tipo que todavía están resguardados, con la fecha hasta
// la que lo están. Una sola consulta por tipo: el candado se pinta en la lista
// completa de Limpieza sin preguntar fila por fila.
function resguardadosDe(clave) {
  const r = RESGUARDO_POR_TIPO[clave];
  if (!r || enPrueba()) return null;
  const { partes, valores } = dondeResguardo(r);
  const filas = db.prepare(`
    SELECT id, ${r.fecha} AS cuando FROM ${r.tabla}
     WHERE ${[...partes, `${r.fecha} > ?`].join(' AND ')}
  `).all(...valores, limiteDeResguardo());
  return new Map(filas.map((f) => [f.id, finDeResguardo(f.cuando)]));
}

const mensajeDeResguardo = (hasta, que) => `Resguardado para auditorías hasta el ${hasta}`
  + `: un ${que} se guarda ${ANIOS_RESGUARDO} años. Sí se puede reabrir y corregir.`;

// Por qué no se puede borrar una fila: lo que el propio tipo diga, y si no, el
// candado de los seis años.
function porQueNoSeBorra(tipo, fila, resguardados) {
  const propio = tipo.impedimento ? tipo.impedimento(fila) : null;
  if (propio) return propio;
  const hasta = resguardados && resguardados.get(fila.id);
  return hasta ? mensajeDeResguardo(hasta, RESGUARDO_POR_TIPO[tipo.clave].que) : null;
}

// --- el paquete de un periodo ---
//
// El resguardo se guarda seis años completo, pero el paquete que se entrega no
// siempre es de un año entero: una auditoría pide un mes, el contador un
// bimestre, el cierre fiscal el año. Así que un paquete es un RANGO DE FECHAS
// con nombre, y su carpeta se llama como ese rango:
//
//   2026        el año       2026-03     marzo
//   2026-B2     bimestre 2   2026-C1     cuatrimestre 1    2026-S2   semestre 2
//
// Cada uno vive en su propia carpeta, así que pueden coexistir el del año y el
// de cada mes sin pisarse.
const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const GRUPOS_PERIODO = [
  { clave: 'mes', etiqueta: 'Mes', letra: '', largo: 1 },
  { clave: 'bimestre', etiqueta: 'Bimestre', letra: 'B', largo: 2 },
  { clave: 'cuatrimestre', etiqueta: 'Cuatrimestre', letra: 'C', largo: 4 },
  { clave: 'semestre', etiqueta: 'Semestre', letra: 'S', largo: 6 },
];

const dosDigitos = (n) => String(n).padStart(2, '0');
// El último día de un mes (1-12), sin pelearse con los de 28, 30 y 31.
const finDeMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);

// De la clave de una carpeta a su rango y su nombre. Es la única traducción:
// la dirección, la carpeta y la pantalla hablan de lo mismo.
function periodoDeClave(clave) {
  const texto = String(clave || '');
  if (!/^\d{4}(-(0[1-9]|1[0-2]|[BCS][1-6]))?$/.test(texto)) return null;
  const anio = Number(texto.slice(0, 4));
  const resto = texto.slice(5);

  if (!resto) {
    return {
      clave: texto, grupo: 'anio', etiqueta: `Año ${anio}`,
      desde: `${anio}-01-01`, hasta: `${anio}-12-31`, anio,
    };
  }
  if (/^\d{2}$/.test(resto)) {
    const mes = Number(resto);
    return {
      clave: texto, grupo: 'mes', etiqueta: `${MESES_ES[mes - 1]} ${anio}`,
      desde: `${anio}-${dosDigitos(mes)}-01`, hasta: finDeMes(anio, mes), anio,
    };
  }
  const grupo = GRUPOS_PERIODO.find((g) => g.letra === resto[0]);
  const n = Number(resto.slice(1));
  if (!grupo || !n || n > 12 / grupo.largo) return null;
  const primero = (n - 1) * grupo.largo + 1;
  const ultimo = primero + grupo.largo - 1;
  return {
    clave: texto,
    grupo: grupo.clave,
    etiqueta: `${grupo.etiqueta} ${n} de ${anio} · ${MESES_ES[primero - 1]} a ${MESES_ES[ultimo - 1]}`,
    desde: `${anio}-${dosDigitos(primero)}-01`,
    hasta: finDeMes(anio, ultimo),
    anio,
  };
}

// Todos los periodos de un año que tienen algo que empacar, con su cuenta. Sale
// de los conteos por mes: un bimestre es la suma de sus dos meses.
function periodosDelAnio(anio, porMes) {
  const cuenta = (desde, hasta) => {
    let n = 0;
    for (let m = desde; m <= hasta; m += 1) n += porMes.get(`${anio}-${dosDigitos(m)}`) || 0;
    return n;
  };
  const lista = [];
  for (let m = 1; m <= 12; m += 1) {
    const n = cuenta(m, m);
    if (n) lista.push({ ...periodoDeClave(`${anio}-${dosDigitos(m)}`), cuantos: n });
  }
  for (const g of GRUPOS_PERIODO.filter((x) => x.largo > 1)) {
    for (let i = 1; i <= 12 / g.largo; i += 1) {
      const n = cuenta((i - 1) * g.largo + 1, i * g.largo);
      if (n) lista.push({ ...periodoDeClave(`${anio}-${g.letra}${i}`), cuantos: n });
    }
  }
  return lista;
}

const carpetaResguardos = () => path.join(DATA_DIR, 'resguardos');
const carpetaDelAnio = (clave) => path.join(carpetaResguardos(), String(clave));

// Punto y coma y BOM: así Excel en español abre el archivo en columnas de una
// vez, sin el asistente de importación.
const aCSV = (titulos, filas) => `\uFEFF${[titulos, ...filas]
  .map((f) => f.map((v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`).join(';'))
  .join('\r\n')}`;

const enElPeriodo = (p) => (valor) => {
  const dia = String(valor || '').slice(0, 10);
  return !!dia && dia >= p.desde && dia <= p.hasta;
};

// Todo lo que se reabrió o se regresó a corregir, de donde venga. Es la otra
// mitad del resguardo: guardar seis años no sirve de nada si no se puede
// explicar por qué un documento cerrado cambió después.
function reaperturasDelAnio(p) {
  const como = [p.desde, p.hasta];
  return [
    ...db.prepare(`
      SELECT v.en, 'Checklists' AS de,
             COALESCE(p.nombre, 'Checklist') || ' · ' || COALESCE(l.referencia, l.periodo, l.id) AS documento,
             CASE WHEN v.accion = 'reapertura' THEN 'Reabierto ya aprobado' ELSE 'Regresado a corregir' END AS que,
             v.nota, u.nombre AS quien
        FROM llenado_revisiones v JOIN llenados l ON l.id = v.llenado_id
        LEFT JOIN plantillas p ON p.id = l.plantilla_id
        LEFT JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.accion IN ('modificacion', 'reapertura')
         AND substr(v.en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT c.en, 'Almacén y Ventas directas' AS de,
             c.documento_tipo || ' ' || COALESCE(c.folio, c.documento_id) AS documento,
             'Estaba en «' || c.estado_anterior || '»' AS que,
             c.nota, u.nombre AS quien
        FROM almacen_correcciones c LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE substr(c.en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT r.ocurrido_en AS en, 'Calidad' AS de,
             r.tipo || ' ' || r.referencia_id AS documento,
             'Deshecho por Calidad' AS que, r.motivo AS nota, u.nombre AS quien
        FROM reversiones_calidad r LEFT JOIN usuarios u ON u.id = r.usuario_id
       WHERE substr(r.ocurrido_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
  ].sort((a, b) => String(b.en || '').localeCompare(String(a.en || '')));
}

function anioDelPaquete(clave) {
  const carpeta = carpetaDelAnio(clave);
  if (!fs.existsSync(carpeta)) return null;
  const archivos = fs.readdirSync(carpeta, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const st = fs.statSync(path.join(carpeta, e.name));
      return { nombre: e.name, bytes: st.size };
    });
  const fotos = fs.existsSync(path.join(carpeta, 'fotos'))
    ? fs.readdirSync(path.join(carpeta, 'fotos'))
    : [];
  const bytesFotos = fotos.reduce((n, f) => n + fs.statSync(path.join(carpeta, 'fotos', f)).size, 0);
  const periodo = periodoDeClave(clave);
  return {
    clave: String(clave),
    etiqueta: periodo ? periodo.etiqueta : String(clave),
    grupo: periodo ? periodo.grupo : 'anio',
    armado_en: fs.statSync(carpeta).mtime.toISOString(),
    archivos,
    fotos: fotos.length,
    bytes: archivos.reduce((n, a) => n + a.bytes, 0) + bytesFotos,
  };
}

// Un número estable por carpeta: 2026 → 20260000, marzo 2026 → 20260103,
// bimestre 2 → 20260202. Sirve para poder borrarla desde Limpieza, que solo
// sabe de ids numéricos.
function idDePaquete(clave) {
  const p = periodoDeClave(clave);
  if (!p) return 0;
  const grupos = ['anio', 'mes', 'bimestre', 'cuatrimestre', 'semestre'];
  const resto = String(clave).slice(5);
  const cual = p.grupo === 'anio' ? 0 : Number(resto.replace(/^[BCS]/, ''));
  return p.anio * 10000 + grupos.indexOf(p.grupo) * 100 + cual;
}

// Los paquetes que ya existen en disco, de un año o de todos.
function paquetesArmados(anio = null) {
  if (!fs.existsSync(carpetaResguardos())) return [];
  return fs.readdirSync(carpetaResguardos(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && periodoDeClave(e.name))
    .filter((e) => !anio || e.name.slice(0, 4) === String(anio))
    .map((e) => anioDelPaquete(e.name))
    .filter(Boolean)
    .sort((a, b) => a.clave.localeCompare(b.clave));
}

// Las fotos de evidencia de un año, de donde vengan. Se filtran por la fecha en
// que se subieron: una foto subida en 2026 es evidencia del trabajo de 2026.
function evidenciaDelAnio(p) {
  const como = [p.desde, p.hasta];
  return [
    ...db.prepare(`
      SELECT f.archivo, f.bytes, f.subida_en, 'Checklist ' || COALESCE(p.nombre, l.plantilla_id) AS documento
        FROM fotos f JOIN llenados l ON l.id = f.llenado_id
        LEFT JOIN plantillas p ON p.id = l.plantilla_id
       WHERE substr(f.subida_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT f.archivo, f.bytes, f.subida_en, 'Recepción ' || COALESCE(r.remision, '') AS documento
        FROM fotos_calidad f LEFT JOIN recepciones r ON r.id = f.recepcion_id
       WHERE substr(f.subida_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT archivo, bytes, subida_en, documento_tipo || ' ' || documento_id AS documento
        FROM almacen_fotos WHERE substr(subida_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT d.archivo, d.bytes, d.subido_en AS subida_en,
             'Papel: ' || d.tipo || COALESCE(' · ' || a.nombre, '') AS documento
        FROM logistica_documentos d LEFT JOIN activos a ON a.id = d.activo_id
       WHERE substr(d.subido_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT c.ticket AS archivo, NULL AS bytes, c.creado_en AS subida_en,
             'Ticket de gasolina ' || c.folio AS documento
        FROM logistica_cargas c
       WHERE c.ticket IS NOT NULL AND substr(c.creado_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
    ...db.prepare(`
      SELECT s.archivo, NULL AS bytes, s.creado_en AS subida_en,
             'Factura de servicio ' || s.folio AS documento
        FROM logistica_servicios s
       WHERE s.archivo IS NOT NULL AND substr(s.creado_en, 1, 10) BETWEEN ? AND ?
    `).all(...como),
  ];
}

function armarPaqueteDelAnio(periodo, usuario) {
  const anio = periodo.anio;
  const carpeta = carpetaDelAnio(periodo.clave);
  fs.rmSync(carpeta, { recursive: true, force: true });
  fs.mkdirSync(path.join(carpeta, 'fotos'), { recursive: true });

  // Las listas de documentos salen del mismo catálogo que usa Limpieza: lo que
  // la plataforma sabe listar es lo que se empaca, y así un documento nuevo
  // entra al resguardo sin que haya que escribir su consulta otra vez.
  const hechos = [];
  for (const tipo of TIPOS_LIMPIABLES) {
    if (!RESGUARDO_POR_TIPO[tipo.clave]) continue;
    // Solo lo cerrado, que es lo que el resguardo cuenta: un borrador o algo
    // cancelado no es un registro, y meterlo aquí haría que la carpeta no
    // cuadrara con los números de la pantalla.
    const cuentan = idsQueCuentan(tipo.clave);
    const filas = tipo.listar()
      .filter((f) => cuentan.has(f.id) && enElPeriodo(periodo)(f.cuando));
    if (!filas.length) continue;
    fs.writeFileSync(path.join(carpeta, `${tipo.clave}.csv`),
      aCSV(['Qué es', 'Detalle', 'Cuándo'], filas.map((f) => [f.titulo, f.detalle, f.cuando])), 'utf8');
    hechos.push({ que: tipo.etiqueta, cuantos: filas.length, archivo: `${tipo.clave}.csv` });
  }

  const movimientos = db.prepare(`
    SELECT m.fecha, m.semana, m.tipo, p.nombre AS producto, m.cantidad,
           bo.clave AS de, bd.clave AS a, m.referencia, m.origen_tipo, m.origen_id,
           u.nombre AS quien, m.notas
      FROM almacen_movimientos m
      LEFT JOIN almacen_productos p ON p.id = m.producto_id
      LEFT JOIN almacen_bodegas bo ON bo.id = m.bodega_origen_id
      LEFT JOIN almacen_bodegas bd ON bd.id = m.bodega_destino_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE substr(m.fecha, 1, 10) BETWEEN ? AND ? ORDER BY m.fecha, m.id
  `).all(periodo.desde, periodo.hasta);
  if (movimientos.length) {
    fs.writeFileSync(path.join(carpeta, 'movimientos-de-inventario.csv'),
      aCSV(['Fecha', 'Semana', 'Tipo', 'Producto', 'Cantidad', 'De', 'A', 'Referencia',
        'Documento', 'Número', 'Quién', 'Notas'],
      movimientos.map((m) => [m.fecha, m.semana, m.tipo, m.producto, m.cantidad, m.de, m.a,
        m.referencia, m.origen_tipo, m.origen_id, m.quien, m.notas])), 'utf8');
    hechos.push({ que: 'Movimientos de inventario', cuantos: movimientos.length, archivo: 'movimientos-de-inventario.csv' });
  }

  // La evidencia se copia, no se mueve: el sistema sigue necesitando sus fotos.
  const evidencia = evidenciaDelAnio(periodo);
  let copiadas = 0;
  for (const f of evidencia) {
    const origen = fs.existsSync(path.join(carpetaFotos(), f.archivo))
      ? path.join(carpetaFotos(), f.archivo) : path.join(FOTOS_DIR, f.archivo);
    try { fs.copyFileSync(origen, path.join(carpeta, 'fotos', f.archivo)); copiadas += 1; }
    catch { /* el archivo ya no estaba en disco; se anota igual en el índice */ }
  }
  if (evidencia.length) {
    fs.writeFileSync(path.join(carpeta, 'fotos.csv'),
      aCSV(['Archivo', 'De qué documento', 'Subida'],
        evidencia.map((f) => [f.archivo, f.documento, f.subida_en])), 'utf8');
    hechos.push({ que: 'Evidencia fotográfica', cuantos: copiadas, archivo: 'fotos/' });
  }

  const reaperturas = reaperturasDelAnio(periodo);
  if (reaperturas.length) {
    fs.writeFileSync(path.join(carpeta, 'reaperturas-y-correcciones.csv'),
      aCSV(['Cuándo', 'Módulo', 'Documento', 'Qué pasó', 'Motivo', 'Quién'],
        reaperturas.map((r) => [r.en, r.de, r.documento, r.que, r.nota, r.quien])), 'utf8');
    hechos.push({
      que: 'Reaperturas y correcciones', cuantos: reaperturas.length,
      archivo: 'reaperturas-y-correcciones.csv',
    });
  }

  const hasta = `31 de diciembre de ${Number(anio) + ANIOS_RESGUARDO}`;
  fs.writeFileSync(path.join(carpeta, 'LEEME.txt'), [
    `RESGUARDO ${periodo.etiqueta} · Sistema Digital INKO`,
    '',
    `Del ${periodo.desde} al ${periodo.hasta}.`,
    `Armado el ${new Date().toLocaleString('es-MX')} por ${usuario.nombre}.`,
    `Guardar hasta: ${hasta} (${ANIOS_RESGUARDO} años).`,
    '',
    'Qué trae esta carpeta:',
    ...hechos.map((h) => `  · ${h.archivo} — ${h.que}: ${h.cuantos}`),
    '',
    'Los archivos .csv se abren con Excel. La carpeta fotos tiene la evidencia',
    'que se subió desde la tablet; el archivo fotos.csv dice de qué documento es',
    'cada una.',
    '',
    'Solo viene lo que quedó cerrado: lo que movió inventario, los checklists',
    'cerrados, las recepciones aprobadas y las ventas terminadas. Los borradores',
    'y lo cancelado no son registros y no se empacan.',
    '',
    'Esta carpeta es una copia. Borrarla no borra nada del sistema.',
    '',
  ].join('\r\n'), 'utf8');

  return { hechos, paquete: anioDelPaquete(anio) };
}

ruta('GET', '/api/resguardo', (req, res) => {
  const usuario = exigir(req, res, 'config_resguardo');
  if (!usuario) return;

  // Mes a mes, cuántos documentos cerrados hay de cada tipo. De ahí sale todo
  // lo demás: un bimestre es la suma de sus dos meses y el año la de los doce,
  // así que la base de datos se consulta una vez por tipo y no una por periodo.
  const porMes = new Map();
  const porAnio = new Map();
  for (const [clave, r] of Object.entries(RESGUARDO_POR_TIPO)) {
    const tipo = TIPOS_LIMPIABLES.find((t) => t.clave === clave);
    const { partes, valores } = dondeResguardo(r);
    const filas = db.prepare(`
      SELECT substr(${r.fecha}, 1, 7) AS mes, COUNT(*) AS cuantos FROM ${r.tabla}
      ${partes.length ? `WHERE ${partes.join(' AND ')}` : ''} GROUP BY mes
    `).all(...valores);
    for (const f of filas) {
      if (!/^\d{4}-\d{2}$/.test(f.mes || '')) continue;
      const anio = f.mes.slice(0, 4);
      porMes.set(f.mes, (porMes.get(f.mes) || 0) + f.cuantos);
      if (!porAnio.has(anio)) porAnio.set(anio, new Map());
      const tipos = porAnio.get(anio);
      const previo = tipos.get(clave);
      tipos.set(clave, {
        etiqueta: (tipo && tipo.etiqueta) || clave,
        cuantos: (previo ? previo.cuantos : 0) + f.cuantos,
      });
    }
  }

  const hoy = hoyISO();
  const anios = [...porAnio.keys()].sort((a, b) => b.localeCompare(a)).map((anio) => {
    const tipos = [...porAnio.get(anio).entries()]
      .map(([clave, x]) => ({ clave, ...x }))
      .sort((x, y) => y.cuantos - x.cuantos);
    const total = tipos.reduce((n, t) => n + t.cuantos, 0);
    const hasta = `${Number(anio) + ANIOS_RESGUARDO}-12-31`;
    const delAnio = periodoDeClave(anio);
    return {
      anio,
      total,
      tipos,
      hasta,
      cumplido: hasta < hoy,
      // El año primero, y debajo los periodos que tienen algo que empacar.
      periodos: [{ ...delAnio, cuantos: total }, ...periodosDelAnio(Number(anio), porMes)],
      paquetes: paquetesArmados(anio),
      reaperturas: reaperturasDelAnio(delAnio).slice(0, 30),
    };
  });

  json(res, 200, {
    anios_resguardo: ANIOS_RESGUARDO,
    en_prueba: enPrueba(),
    carpeta: carpetaResguardos(),
    grupos_periodo: [
      { clave: 'anio', etiqueta: 'Año completo' },
      ...GRUPOS_PERIODO.map((g) => ({ clave: g.clave, etiqueta: g.etiqueta })),
    ],
    anios,
  });
});

ruta('POST', '/api/resguardo/([0-9A-Za-z\\-]{4,8})', (req, res, p) => {
  const usuario = exigir(req, res, 'config_resguardo');
  if (!usuario) return;
  if (enPrueba()) {
    return json(res, 409, {
      error: 'El paquete se arma sobre la operación de verdad, no sobre una copia de pruebas. Sal de la prueba y vuelve a intentar.',
    });
  }

  const periodo = periodoDeClave(p[1]);
  if (!periodo) return json(res, 404, { error: 'Ese periodo no existe.' });

  const r = armarPaqueteDelAnio(periodo, usuario);
  if (!r.hechos.length) {
    fs.rmSync(carpetaDelAnio(periodo.clave), { recursive: true, force: true });
    return json(res, 409, { error: `No hay nada cerrado en ${periodo.etiqueta} que empacar.` });
  }
  json(res, 200, {
    mensaje: `Paquete de ${periodo.etiqueta} armado: ${r.hechos.length} archivo(s) en su carpeta.`,
    periodo,
    ...r,
  });
});

ruta('GET', '/api/resguardo/([0-9A-Za-z\\-]{4,8})/archivo/([\\w.\\-]+)', (req, res, p) => {
  if (!exigir(req, res, 'config_resguardo')) return;
  const archivo = path.join(carpetaDelAnio(p[1]), p[2]);
  // El nombre viene del listado que arma la plataforma; de todos modos se
  // comprueba que lo pedido quede dentro de la carpeta del año.
  if (!archivo.startsWith(carpetaDelAnio(p[1]) + path.sep)) {
    return json(res, 400, { error: 'Ruta no válida' });
  }
  fs.readFile(archivo, (err, contenido) => {
    if (err) return json(res, 404, { error: 'Ese archivo ya no está.' });
    res.writeHead(200, {
      'Content-Type': archivo.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${p[2]}"`,
    });
    res.end(contenido);
  });
});

// ------------------------------------------------------------- limpieza
//
// Mientras el sistema se construye, hace falta poder tirar lo que se capturó
// para probar. No es una papelera de la operación: es una herramienta de obra,
// solo del Administrador y solo para los DOCUMENTOS que alguien capturó.
//
// Lo que NUNCA se borra desde aquí: personas, permisos, unidades, plantillas de
// checklist, materiales, productos, publicaciones y bodegas. Eso es la
// configuración del sistema, no una prueba; se administra en su propia pestaña.
//
// Borrar un documento borra también sus movimientos. Como la existencia es la
// suma de los movimientos, el inventario se corrige solo: no hace falta
// «deshacer» nada ni capturar un ajuste que compense.

// Borrar una entrada o un retiro es lo mismo salvo por lo que arrastra, así que
// la parte común vive aquí y no duplicada en los dos renglones del catálogo.
function borrarEntradaDeAlmacen(id) {
  const e = db.prepare('SELECT recepcion_id FROM almacen_entradas WHERE id = ?').get(id);
  borrarFotosDocumento('entrada', id);
  borrarMovimientos.run('entrada', id);
  db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'entrada' AND documento_id = ?").run(id);
  db.prepare('DELETE FROM almacen_entradas WHERE id = ?').run(id);
  // Las recepciones que abrió esta entrada —la vigente y las anuladas por
  // correcciones— se van con ella: sin la entrada no tienen de qué ser.
  const recepciones = db.prepare('SELECT id FROM recepciones WHERE entrada_id = ? OR id = ?')
    .all(id, (e && e.recepcion_id) || 0);
  for (const r of recepciones) {
    borrarFotosDe('SELECT archivo FROM fotos_calidad WHERE recepcion_id = ?', r.id);
    db.prepare('DELETE FROM recepciones WHERE id = ?').run(r.id);
  }
}

function borrarReingreso(id) {
  borrarFotosDocumento('reingreso', id);
  borrarMovimientos.run('reingreso', id);
  db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'reingreso' AND documento_id = ?").run(id);
  // El detalle de cajas se va en cascada con el re-ingreso.
  db.prepare('DELETE FROM almacen_reingresos WHERE id = ?').run(id);
}

const TIPOS_LIMPIABLES = [
  {
    clave: 'vxf',
    modulo: 'Ventas directas',
    etiqueta: 'Órdenes de venta directa',
    ayuda: 'Las órdenes de armado con sus cajas y sus guías o notas de remisión. Las salidas de Almacén que salieron de ellas se quedan, sin orden.',
    listar: () => db.prepare(`
      SELECT o.id, o.folio AS titulo, o.cliente || ' · ' || o.estado AS detalle, o.creado_en AS cuando
        FROM vxf_ordenes o ORDER BY o.id DESC
    `).all(),
    borrar: (id) => {
      borrarFotosDocumento('vxf', id);
      borrarFotosDocumento('vxf_cobro', id);
      db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'vxf' AND documento_id = ?").run(id);
      db.prepare('UPDATE almacen_salidas SET vxf_id = NULL WHERE vxf_id = ?').run(id);
      db.prepare('DELETE FROM vxf_ordenes WHERE id = ?').run(id);
    },
  },
  {
    clave: 'vxf_clientes',
    modulo: 'Ventas directas',
    etiqueta: 'Clientes dados de alta desde una orden',
    ayuda: 'Los que quien vende escribió al levantar una orden y que ya no tienen ninguna orden. La cartera cargada desde Excel o a mano no aparece aquí.',
    listar: () => db.prepare(`
      SELECT c.id, c.nombre AS titulo, 'desde una orden' AS detalle, c.creado_en AS cuando
        FROM vxf_clientes c
       WHERE c.origen = 'orden' AND NOT EXISTS (SELECT 1 FROM vxf_ordenes o WHERE o.cliente_id = c.id)
       ORDER BY c.id DESC
    `).all(),
    borrar: (id) => { db.prepare('DELETE FROM vxf_clientes WHERE id = ?').run(id); },
  },
  {
    clave: 'llenado',
    modulo: 'Checklists y Tránsito',
    etiqueta: 'Checklists llenados',
    ayuda: 'Cada checklist capturado, con sus respuestas, firmas y fotos.',
    listar: () => db.prepare(`
      SELECT l.id, COALESCE(p.nombre, 'Checklist') AS titulo,
             COALESCE(l.referencia, u.nombre, '') AS detalle,
             COALESCE(l.salida_en, l.creado_en) AS cuando
        FROM llenados l
        LEFT JOIN plantillas p ON p.id = l.plantilla_id
        LEFT JOIN usuarios u ON u.id = l.usuario_id
       ORDER BY l.id DESC
    `).all(),
    borrar: (id) => {
      borrarFotosDe('SELECT archivo FROM fotos WHERE llenado_id = ?', id);
      db.prepare('DELETE FROM llenados WHERE id = ?').run(id);
    },
  },
  {
    clave: 'recepcion',
    modulo: 'Calidad',
    etiqueta: 'Recepciones de Calidad',
    ayuda: 'El muestreo de material recibido, con sus lotes, firmas y fotos.',
    listar: () => db.prepare(`
      SELECT r.id, 'Remisión ' || r.remision AS titulo,
             r.proveedor || ' · ' || r.estado AS detalle, r.creado_en AS cuando,
             (SELECT COUNT(*) FROM almacen_entradas e WHERE e.recepcion_id = r.id)
               + (r.entrada_id IS NOT NULL) AS atado
        FROM recepciones r ORDER BY r.id DESC
    `).all(),
    // Una recepción que nació de una entrada de almacén no se borra sola: la
    // entrada quedaría apuntando a una recepción que ya no existe. Se borra la
    // entrada y la recepción se va con ella.
    impedimento: (f) => (f.atado
      ? 'La abrió una entrada de almacén. Borra esa entrada y esta se va con ella.'
      : null),
    borrar: (id) => {
      borrarFotosDe('SELECT archivo FROM fotos_calidad WHERE recepcion_id = ?', id);
      db.prepare('DELETE FROM recepciones WHERE id = ?').run(id);
    },
  },
  {
    clave: 'entrada',
    modulo: 'Almacén',
    etiqueta: 'Entradas de proveedor',
    ayuda: 'Material que llegó de un proveedor, con la recepción de Calidad que abrió.',
    listar: () => db.prepare(`
      SELECT e.id, e.folio AS titulo,
             COALESCE(e.proveedor, '') || ' · ' || e.estado AS detalle,
             e.creado_en AS cuando, e.recepcion_id
        FROM almacen_entradas e WHERE e.fuente = 'proveedor' ORDER BY e.id DESC
    `).all(),
    borrar: (id) => borrarEntradaDeAlmacen(id),
  },
  {
    clave: 'retiro',
    modulo: 'Almacén',
    etiqueta: 'Retiros de plataforma',
    ayuda: 'Lo que se pidió de Mercado Libre Full o Amazon FBA, con los re-ingresos que Calidad levantó contra él.',
    listar: () => db.prepare(`
      SELECT e.id, e.folio AS titulo,
             COALESCE(e.plataforma, '') || ' · ' || e.estado AS detalle,
             e.creado_en AS cuando,
             (SELECT COUNT(*) FROM almacen_reingresos g WHERE g.entrada_id = e.id) AS reingresos
        FROM almacen_entradas e WHERE e.fuente = 'retiro' ORDER BY e.id DESC
    `).all(),
    // Borrar el retiro se lleva sus re-ingresos: sin retiro no tienen de qué ser,
    // y el material que sumaron sale del inventario con sus movimientos.
    borrar: (id) => {
      for (const g of db.prepare('SELECT id FROM almacen_reingresos WHERE entrada_id = ?').all(id)) {
        borrarReingreso(g.id);
      }
      borrarEntradaDeAlmacen(id);
    },
  },
  {
    clave: 'reingreso',
    modulo: 'Calidad',
    etiqueta: 'Re-ingresos de retiro',
    ayuda: 'Las entregas que Calidad recibió contra un retiro, caja por caja.',
    listar: () => db.prepare(`
      SELECT g.id, g.folio AS titulo,
             e.folio || ' · ' || g.estado AS detalle, g.creado_en AS cuando
        FROM almacen_reingresos g JOIN almacen_entradas e ON e.id = g.entrada_id
       ORDER BY g.id DESC
    `).all(),
    borrar: (id) => borrarReingreso(id),
  },
  {
    clave: 'salida',
    modulo: 'Almacén',
    etiqueta: 'Salidas',
    ayuda: 'Lo que salió como envío de ventas, por la ODT o por fuera de ella.',
    listar: () => db.prepare(`
      SELECT s.id, s.folio AS titulo, s.motivo || ' · ' || s.estado AS detalle, s.creado_en AS cuando
        FROM almacen_salidas s WHERE s.motivo NOT IN ('traspaso', 'calidad') ORDER BY s.id DESC
    `).all(),
    borrar: (id) => {
      borrarMovimientos.run('salida', id);
      db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'salida' AND documento_id = ?").run(id);
      db.prepare('DELETE FROM almacen_salidas WHERE id = ?').run(id);
    },
  },
  {
    clave: 'traspaso',
    modulo: 'Almacén',
    etiqueta: 'Traspasos',
    ayuda: 'Material movido entre bodegas.',
    listar: () => db.prepare(`
      SELECT s.id, s.folio AS titulo,
             COALESCE(o.semana, 'a mano') || ' · ' || s.estado AS detalle, s.creado_en AS cuando
        FROM almacen_salidas s LEFT JOIN almacen_odt o ON o.id = s.odt_id
       WHERE s.motivo = 'traspaso' ORDER BY s.id DESC
    `).all(),
    borrar: (id) => {
      borrarMovimientos.run('salida', id);
      db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'salida' AND documento_id = ?").run(id);
      db.prepare('DELETE FROM almacen_salidas WHERE id = ?').run(id);
    },
  },
  {
    clave: 'salida_calidad',
    modulo: 'Calidad',
    etiqueta: 'Salidas por calidad',
    ayuda: 'Material dado de baja por daño, con su evidencia.',
    listar: () => db.prepare(`
      SELECT s.id, s.folio AS titulo,
             b.nombre || ' · ' || s.estado AS detalle, s.creado_en AS cuando
        FROM almacen_salidas s LEFT JOIN almacen_bodegas b ON b.id = s.bodega_id
       WHERE s.motivo = 'calidad' ORDER BY s.id DESC
    `).all(),
    borrar: (id) => {
      for (const r of db.prepare('SELECT id FROM almacen_salida_renglones WHERE salida_id = ?').all(id)) {
        borrarFotosDocumento('salida_renglon', r.id);
      }
      borrarFotosDocumento('salida', id);
      borrarMovimientos.run('salida', id);
      db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'salida' AND documento_id = ?").run(id);
      db.prepare('DELETE FROM almacen_salidas WHERE id = ?').run(id);
    },
  },
  {
    clave: 'devolucion',
    modulo: 'Almacén',
    etiqueta: 'Devoluciones',
    ayuda: 'Material que regresó del CEDIS o del cliente, con sus fotos.',
    listar: () => db.prepare(`
      SELECT d.id, d.folio AS titulo, d.rechazo_de || ' · ' || d.estado AS detalle, d.creado_en AS cuando
        FROM almacen_devoluciones d ORDER BY d.id DESC
    `).all(),
    borrar: (id) => {
      borrarFotosDocumento('devolucion', id);
      borrarMovimientos.run('devolucion', id);
      db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'devolucion' AND documento_id = ?").run(id);
      db.prepare('DELETE FROM almacen_devoluciones WHERE id = ?').run(id);
    },
  },
  {
    clave: 'conteo',
    modulo: 'Almacén',
    etiqueta: 'Conteos',
    ayuda: 'El conteo semanal por bodega y el ajuste de inventario que salió de él.',
    listar: () => db.prepare(`
      SELECT c.id, c.semana AS titulo, b.nombre || ' · ' || c.estado AS detalle, c.creado_en AS cuando
        FROM almacen_conteos c LEFT JOIN almacen_bodegas b ON b.id = c.bodega_id
       ORDER BY c.id DESC
    `).all(),
    borrar: (id) => {
      // Las fotos de los productos descuadrados cuelgan del renglón, no del
      // conteo: hay que ir por ellas antes de que el renglón desaparezca.
      for (const r of db.prepare('SELECT id FROM almacen_conteo_renglones WHERE conteo_id = ?').all(id)) {
        borrarFotosDocumento('conteo_renglon', r.id);
      }
      borrarFotosDocumento('conteo', id);
      borrarMovimientos.run('conteo', id);
      db.prepare("DELETE FROM almacen_correcciones WHERE documento_tipo = 'conteo' AND documento_id = ?").run(id);
      // El detalle de cajas y los renglones se van en cascada con el conteo.
      db.prepare('DELETE FROM almacen_conteos WHERE id = ?').run(id);
    },
  },
  {
    clave: 'odt',
    modulo: 'Producción',
    etiqueta: 'ODT cargadas',
    ayuda: 'Las órdenes de trabajo semanales con sus partidas, su reparto por envío, lo que se anotó como armado y sus modificaciones.',
    listar: () => db.prepare(`
      SELECT o.id, o.semana AS titulo,
             (SELECT COUNT(*) FROM almacen_odt_renglones r WHERE r.odt_id = o.id) || ' publicación(es)' AS detalle,
             o.creado_en AS cuando,
             (SELECT COUNT(*) FROM almacen_salidas s WHERE s.odt_id = o.id) AS atado
        FROM almacen_odt o ORDER BY o.id DESC
    `).all(),
    // Si hay salidas o traspasos colgando de la ODT, se dice en vez de
    // desamarrarlos por lo bajo: quedarían huérfanos sin que nadie lo pidiera.
    impedimento: (f) => (f.atado
      ? `Tiene ${f.atado} salida(s) o traspaso(s) colgando. Bórralos primero.`
      : null),
    borrar: (id) => { db.prepare('DELETE FROM almacen_odt WHERE id = ?').run(id); },
  },
  {
    clave: 'incidencia',
    modulo: 'Incidencias',
    etiqueta: 'Incidencias levantadas',
    ayuda: 'Lo anotado en la hoja del personal, con su autorización.',
    listar: () => db.prepare(`
      SELECT i.id, u.nombre AS titulo,
             i.fecha || ' · ' || i.estado AS detalle, i.levantada_en AS cuando
        FROM incidencias i JOIN usuarios u ON u.id = i.usuario_id
       ORDER BY i.id DESC
    `).all(),
    borrar: (id) => { db.prepare('DELETE FROM incidencias WHERE id = ?').run(id); },
  },
  {
    clave: 'carga_inicial',
    modulo: 'Almacén',
    etiqueta: 'Carga inicial de existencias',
    ayuda: 'El inventario de arranque que se trajo del Excel. Borrarlo deja el inventario en ceros: no es una prueba, es el punto de partida de todo lo demás.',
    peligroso: true,
    listar: () => db.prepare(`
      SELECT MIN(id) AS id, 'Existencia inicial' AS titulo,
             COUNT(*) || ' movimiento(s) · ' || SUM(cantidad) || ' unidades' AS detalle,
             MIN(creado_en) AS cuando
        FROM almacen_movimientos WHERE origen_tipo = 'carga_inicial'
       HAVING COUNT(*) > 0
    `).all(),
    borrar: () => {
      db.prepare("DELETE FROM almacen_movimientos WHERE origen_tipo = 'carga_inicial'").run();
    },
  },
];

// Lo de Logística: las cargas con su ticket, los servicios y los papeles.
TIPOS_LIMPIABLES.push(
  {
    clave: 'logistica_cargas',
    modulo: 'Logística',
    etiqueta: 'Cargas de gasolina',
    ayuda: 'Las cargas con su ticket y la lectura de kilometraje que dejaron. El rendimiento se vuelve a calcular con las que queden.',
    listar: () => db.prepare(`
      SELECT c.id, c.folio AS titulo, a.nombre || ' · ' || c.fecha || ' · ' || c.litros || ' L' AS detalle,
             c.creado_en AS cuando
        FROM logistica_cargas c JOIN activos a ON a.id = c.activo_id ORDER BY c.id DESC
    `).all(),
    borrar: (id) => {
      borrarFotosDe('SELECT ticket AS archivo FROM logistica_cargas WHERE id = ? AND ticket IS NOT NULL', id);
      db.prepare("DELETE FROM logistica_lecturas WHERE origen_tipo = 'carga' AND origen_id = ?").run(id);
      db.prepare('DELETE FROM logistica_cargas WHERE id = ?').run(id);
    },
  },
  {
    clave: 'logistica_servicios',
    modulo: 'Logística',
    etiqueta: 'Servicios y mantenimientos',
    ayuda: 'Lo que se le hizo a cada unidad y los servicios programados, con su factura.',
    listar: () => db.prepare(`
      SELECT s.id, s.folio AS titulo, a.nombre || ' · ' || s.tipo AS detalle, s.creado_en AS cuando
        FROM logistica_servicios s JOIN activos a ON a.id = s.activo_id ORDER BY s.id DESC
    `).all(),
    borrar: (id) => {
      borrarFotosDe('SELECT archivo FROM logistica_servicios WHERE id = ? AND archivo IS NOT NULL', id);
      db.prepare('DELETE FROM logistica_servicios WHERE id = ?').run(id);
    },
  },
  {
    clave: 'logistica_documentos',
    modulo: 'Logística',
    etiqueta: 'Papeles de las unidades',
    ayuda: 'Los documentos cargados a una unidad, con su archivo. Borrarlos quita también el archivo del disco.',
    listar: () => db.prepare(`
      SELECT d.id, d.tipo AS titulo, a.nombre || COALESCE(' · vence ' || d.vence, '') AS detalle, d.subido_en AS cuando
        FROM logistica_documentos d JOIN activos a ON a.id = d.activo_id
       WHERE d.ambito = 'unidad' ORDER BY d.id DESC
    `).all(),
    borrar: (id) => {
      borrarFotosDe('SELECT archivo FROM logistica_documentos WHERE id = ?', id);
      db.prepare('DELETE FROM logistica_documentos WHERE id = ?').run(id);
    },
  },
);

TIPOS_LIMPIABLES.push({
  clave: 'rutas_entrega',
  modulo: 'Logística',
  etiqueta: 'Rutas de entrega',
  ayuda: 'El recorrido planeado de cada día, con sus paradas. Borrar una ruta no toca las órdenes ni las citas: solo deshace el plan.',
  listar: () => db.prepare(`
    SELECT r.id, r.folio || ' · ' || r.fecha AS titulo,
           (SELECT COUNT(*) FROM ruta_paradas p WHERE p.ruta_id = r.id) || ' parada(s) · ' || r.estado AS detalle,
           r.creado_en AS cuando
      FROM rutas_entrega r ORDER BY r.id DESC
  `).all(),
  borrar: (id) => { db.prepare('DELETE FROM rutas_entrega WHERE id = ?').run(id); },
});

TIPOS_LIMPIABLES.push({
  clave: 'bahia_personal',
  modulo: 'Bahía digital',
  etiqueta: 'Papeles del personal',
  ayuda: 'Los documentos cargados a una persona, con su archivo. Son datos personales: borrarlos quita también el archivo del disco.',
  listar: () => db.prepare(`
    SELECT d.id, d.tipo AS titulo, u.nombre || COALESCE(' · vence ' || d.vence, '') AS detalle,
           d.subido_en AS cuando
      FROM logistica_documentos d LEFT JOIN usuarios u ON u.id = d.usuario_id
     WHERE d.ambito = 'persona' ORDER BY d.id DESC
  `).all(),
  borrar: (id) => {
    borrarFotosDe('SELECT archivo FROM logistica_documentos WHERE id = ?', id);
    db.prepare('DELETE FROM logistica_documentos WHERE id = ?').run(id);
  },
});

TIPOS_LIMPIABLES.push({
  clave: 'resguardos',
  modulo: 'Configuración',
  etiqueta: 'Paquetes de resguardo armados',
  ayuda: 'Las carpetas que se armaron para una auditoría. Son copias: borrarlas no borra ningún documento del sistema, y el paquete se puede volver a armar.',
  // La dirección para borrar solo acepta números, así que cada carpeta tiene un
  // id armado con su propio nombre: año + qué clase de periodo + cuál.
  listar: () => paquetesArmados().map((p) => ({
    id: idDePaquete(p.clave),
    titulo: `Paquete ${p.etiqueta}`,
    detalle: `${p.archivos.length} archivo(s) · ${p.fotos} foto(s) · ${Math.round(p.bytes / 1024)} KB`,
    cuando: p.armado_en,
  })),
  borrar: (id) => {
    const p = paquetesArmados().find((x) => idDePaquete(x.clave) === Number(id));
    if (p) fs.rmSync(carpetaDelAnio(p.clave), { recursive: true, force: true });
  },
});

TIPOS_LIMPIABLES.push({
  clave: 'accesos_bitacora',
  modulo: 'Configuración',
  etiqueta: 'Bitácora de accesos',
  ayuda: 'Quién entró, qué falló y qué se liberó. Es registro de auditoría: en la operación de verdad está resguardado y no se borra; en una copia de pruebas sí.',
  peligroso: true,
  listar: () => db.prepare(`
    SELECT b.id, b.accion || ' · ' || COALESCE(u.nombre, b.dispositivo, '—') AS titulo,
           COALESCE(b.nota, '') AS detalle, b.en AS cuando
      FROM accesos_bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
     ORDER BY b.id DESC LIMIT 500
  `).all(),
  borrar: (id) => { db.prepare('DELETE FROM accesos_bitacora WHERE id = ?').run(id); },
});

const borrarMovimientos = sentencia(
  'DELETE FROM almacen_movimientos WHERE origen_tipo = ? AND origen_id = ?'
);

// Las filas de foto se van solas por CASCADE, pero el archivo en disco no: hay
// que quitarlo antes de perder el nombre.
function borrarFotosDe(consulta, id) {
  for (const f of db.prepare(consulta).all(...[].concat(id))) {
    try { fs.rmSync(path.join(carpetaFotos(), f.archivo)); } catch { /* ya no estaba */ }
  }
}

// Las fotos de un documento de Almacén: el archivo del disco Y su renglón.
//
// Antes se borraba solo el archivo. El renglón se quedaba apuntando a un
// documento que ya no existía, y como las fotos se guardan por tipo + número de
// documento, el siguiente documento que estrenaba ese número heredaba las fotos
// del borrado: salía una imagen rota y, peor, la plataforma daba por cumplida
// una evidencia que nadie había subido. Lo encontró una prueba el 2-oct-2026.
function borrarFotosDocumento(tipo, id) {
  borrarFotosDe('SELECT archivo FROM almacen_fotos WHERE documento_tipo = ? AND documento_id = ?', [tipo, id]);
  db.prepare('DELETE FROM almacen_fotos WHERE documento_tipo = ? AND documento_id = ?').run(tipo, id);
}

const tipoLimpiable = (clave) => TIPOS_LIMPIABLES.find((t) => t.clave === clave);

ruta('GET', '/api/config/limpieza', (req, res) => {
  if (!exigir(req, res, 'config_limpieza')) return;
  json(res, 200, {
    anios_resguardo: ANIOS_RESGUARDO,
    grupos: TIPOS_LIMPIABLES.map((t) => {
      const resguardados = resguardadosDe(t.clave);
      const filas = t.listar().map((f) => ({
        ...f, impedimento: porQueNoSeBorra(t, f, resguardados),
      }));
      return {
        clave: t.clave, modulo: t.modulo, etiqueta: t.etiqueta, ayuda: t.ayuda,
        peligroso: !!t.peligroso, cuantos: filas.length,
        resguardados: filas.filter((f) => f.impedimento).length,
        filas,
      };
    }),
    inventario: db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN bodega_destino_id IS NOT NULL THEN cantidad ELSE -cantidad END), 0) AS n
        FROM almacen_movimientos
    `).get().n,
  });
});

ruta('DELETE', '/api/config/limpieza/([a-z_]+)/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'config_limpieza');
  if (!usuario) return;

  const tipo = tipoLimpiable(p[1]);
  if (!tipo) return json(res, 404, { error: 'Ese tipo no se puede limpiar.' });

  const id = Number(p[2]);
  const fila = tipo.listar().find((f) => f.id === id);
  if (!fila) return json(res, 404, { error: 'Ya no existe.' });
  const impedimento = porQueNoSeBorra(tipo, fila, resguardadosDe(tipo.clave));
  if (impedimento) return json(res, 409, { error: impedimento });

  db.exec('BEGIN');
  try { tipo.borrar(id); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }

  json(res, 200, { borrados: 1 });
});

// Borrar todo un grupo de una vez. Se van los que se puedan; los que tengan algo
// colgando se reportan en vez de forzarlos, para que quede claro qué quedó y por
// qué —un «se borraron 8 de 10» sin explicación no le sirve a nadie.
ruta('POST', '/api/config/limpieza/([a-z_]+)/borrar-todo', (req, res, p) => {
  const usuario = exigir(req, res, 'config_limpieza');
  if (!usuario) return;

  const tipo = tipoLimpiable(p[1]);
  if (!tipo) return json(res, 404, { error: 'Ese tipo no se puede limpiar.' });

  const filas = tipo.listar();
  const resguardados = resguardadosDe(tipo.clave);
  let borrados = 0;
  const quedaron = [];

  db.exec('BEGIN');
  try {
    for (const f of filas) {
      const impedimento = porQueNoSeBorra(tipo, f, resguardados);
      if (impedimento) { quedaron.push({ titulo: f.titulo, porque: impedimento }); continue; }
      tipo.borrar(f.id);
      borrados++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  json(res, 200, { borrados, quedaron });
});

// ----------------------------------------------------------- notificaciones

// Los envíos de Tránsito en un estado, con lo que hace falta para decidir si
// ya están esperando a alguien.
function enviosDeTransito(estado, revision) {
  const plantilla = db.prepare("SELECT * FROM plantillas WHERE clave = 'transito' AND activo = 1").get();
  if (!plantilla) return [];
  return db.prepare(`
    SELECT l.id, l.periodo, l.referencia, l.datos, l.creado_en, l.salida_en, l.revision, l.usuario_id,
           u.nombre AS preparo, au.nombre AS autorizo,
           (SELECT MAX(v.en) FROM llenado_revisiones v WHERE v.llenado_id = l.id) AS ultimo_paso,
           (SELECT v.nota FROM llenado_revisiones v WHERE v.llenado_id = l.id AND v.accion = 'modificacion'
             ORDER BY v.id DESC LIMIT 1) AS nota,
           (SELECT q.nombre FROM llenado_revisiones v JOIN usuarios q ON q.id = v.usuario_id
             WHERE v.llenado_id = l.id AND v.accion = 'modificacion' ORDER BY v.id DESC LIMIT 1) AS regreso
      FROM llenados l
      JOIN usuarios u ON u.id = l.usuario_id
      LEFT JOIN usuarios au ON au.id = l.autorizado_por
     WHERE l.plantilla_id = ? AND l.estado = ? AND COALESCE(l.revision, '') = ?
     ORDER BY l.creado_en
  `).all(plantilla.id, estado, revision).map((l) => ({ ...l, datos: JSON.parse(l.datos || '{}'), plantilla }));
}

const esColecta = (l) => l.datos.tipo === 'colecta';

const NOMBRE_SALIDA = {
  cedis: 'Envío a CEDIS',
  ventas_directas: 'Envío de ventas directas',
  custodia: 'Custodia',
  encargo: 'Encargo',
  traspaso: 'Traspaso entre bodegas',
  colecta: 'Colecta',
  envio: 'Envío',
};

// A dónde va, dicho con lo que haya: el CEDIS de la cita o el destino escrito.
const aDondeVa = (l) => l.datos.lugar_entrega || l.datos.destino || null;

// Todo lo que la unidad va a hacer en este viaje, no solo lo principal.
const propositosDe = (l) => [l.datos.tipo, ...String(l.datos.tipos_extra || '').split(',')]
  .map((x) => String(x || '').trim()).filter(Boolean);

const tituloEnvio = (l) => [
  propositosDe(l).map((t) => NOMBRE_SALIDA[t] || t).join(' + ') || 'Salida de unidad',
  l.referencia || l.id,
  aDondeVa(l),
].filter(Boolean).join(' · ');

// Con qué unidad y quién la lleva: es lo primero que pregunta quien autoriza.
const conQuienSale = (l) => [l.datos.unidad, l.datos.operador].filter(Boolean).join(' · ');
const noEsSuyo = (usuario) => (l) => !!usuario && (usuario.rol === 'admin' || l.usuario_id !== usuario.id);

function traspasosEnEstado(estado) {
  return db.prepare(`
    SELECT s.id, s.folio, s.aprobado_en, s.cargado_en,
           bo.clave AS origen, bd.clave AS destino, ap.nombre AS aprobo, cg.nombre AS cargo,
           (SELECT COUNT(*) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS productos,
           (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades
      FROM almacen_salidas s
      JOIN almacen_bodegas bo ON bo.id = s.bodega_id
      LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
      LEFT JOIN usuarios ap ON ap.id = s.aprobado_por
      LEFT JOIN usuarios cg ON cg.id = s.cargado_por
     WHERE s.motivo = 'traspaso' AND s.estado = ?
     ORDER BY COALESCE(s.cargado_en, s.aprobado_en), s.id
  `).all(estado);
}

// Lo que está esperando una decisión de alguien. No es una bandeja de mensajes
// que haya que marcar como leídos: es la operación misma, preguntada al momento.
// Un aviso guardado como registro aparte se desincroniza —queda el aviso de algo
// ya aprobado, o falta el de algo que nadie mandó—; esto no puede pasar porque
// aquí no se guarda nada, se consulta el estado de verdad.
//
// Cada renglón declara QUÉ permiso hace falta para atenderlo, así que cada quien
// ve solo lo que le toca resolver: al Administrador le aparecen las aprobaciones
// de Calidad, y a nadie más.
//
// Agregar el pendiente de otro módulo es un renglón aquí, igual que agregar un
// módulo es uno en MODULOS. La pantalla no se toca.
//
// 'destino' es dónde se resuelve, que NO es aquí: Notificaciones avisa, el módulo
// decide. Duplicar el botón de aprobar en dos pantallas sería tener dos puertas
// para la misma cosa.
//
// 'tipo' es qué clase de tarea es, y sirve para agrupar la bandeja: no es lo
// mismo tener veinte cosas por aprobar que veinte por capturar. 'personal'
// marca los pendientes que son de una persona en concreto —lo que te
// regresaron a corregir— y no de todo el que tenga el permiso.
const TIPOS_PENDIENTE = [
  // `corta` es la palabra que va junto a cada grupo en la bandeja: una sola, para
  // que se lea de un vistazo qué toca hacer.
  { clave: 'aprobar', etiqueta: 'Esperan una aprobación tuya', atendido: 'Lo que aprobaste', corta: 'Aprobar', corta_atendido: 'Aprobado' },
  { clave: 'capturar', etiqueta: 'Esperan que tú los llenes o los corrijas', atendido: 'Lo que llenaste, corregiste o cerraste', corta: 'Llenar', corta_atendido: 'Hecho' },
  { clave: 'revisar', etiqueta: 'Esperan que los revises', atendido: 'Lo que revisaste', corta: 'Revisar', corta_atendido: 'Revisado' },
  { clave: 'vigilar', etiqueta: 'Para tenerlos vigilados', atendido: 'Lo que vigilaste', corta: 'Vigilar', corta_atendido: 'Visto' },
];

const PENDIENTES = [
  {
    clave: 'bahia_papeles_personal',
    tipo: 'vigilar',
    modulo: 'Bahía digital',
    permiso: 'bahia_personal_ver',
    etiqueta: 'Papel del personal vencido o por vencer',
    ayuda: 'Una licencia, un examen médico o un curso que se vence. Vencidos primero.',
    destino: '#/bahia/personal',
    consultar: () => db.prepare('SELECT id, nombre FROM usuarios WHERE activo = 1').all()
      .flatMap((u) => papelesDe('persona', u.id)
        .filter((p) => PORVENCER.includes(p.estado))
        .map((p) => ({
          id: p.id,
          titulo: `${u.nombre} · ${p.tipo}`,
          detalle: `${p.texto} · vence ${p.vence}`,
          desde: p.subido_en,
          urgente: p.estado !== 'por_vencer',
          destino: '#/bahia/personal',
        }))),
  },
  {
    clave: 'bahia_mis_papeles',
    tipo: 'capturar',
    personal: true,
    modulo: 'Bahía digital',
    permiso: 'mod_bahia',
    etiqueta: 'Un papel tuyo que se vence',
    ayuda: 'Es tuyo: renuévalo y carga el nuevo en la Bahía digital.',
    destino: '#/bahia/personal',
    consultar: (usuario) => papelesDe('persona', usuario.id)
      .filter((p) => PORVENCER.includes(p.estado))
      .map((p) => ({
        id: p.id,
        titulo: `Tu ${p.tipo}`,
        detalle: `${p.texto} · vence ${p.vence}`,
        desde: p.subido_en,
        urgente: p.estado !== 'por_vencer',
        destino: '#/bahia/personal',
      })),
  },
  {
    clave: 'resguardo_por_armar',
    tipo: 'vigilar',
    modulo: 'Configuración',
    permiso: 'config_resguardo',
    etiqueta: 'Años cerrados sin su paquete de auditoría',
    ayuda: 'El año ya terminó y no se le ha armado el paquete. Armarlo deja en una carpeta las listas, los movimientos y las fotos de ese año, listas para entregar.',
    destino: '#/resguardo',
    consultar: () => {
      const anioAhora = Number(hoyISO().slice(0, 4));
      const anios = new Set();
      for (const [, r] of Object.entries(RESGUARDO_POR_TIPO)) {
        const { partes, valores } = dondeResguardo(r);
        for (const f of db.prepare(`
          SELECT DISTINCT substr(${r.fecha}, 1, 4) AS anio FROM ${r.tabla}
          ${partes.length ? `WHERE ${partes.join(' AND ')}` : ''}
        `).all(...valores)) {
          const n = Number(f.anio);
          if (n && n < anioAhora && n >= anioAhora - 3) anios.add(f.anio);
        }
      }
      return [...anios].sort().filter((a) => !paquetesArmados(a).length).map((a) => ({
        id: Number(a),
        titulo: `${a} · sin paquete de resguardo`,
        detalle: `Se guarda hasta el 31-12-${Number(a) + ANIOS_RESGUARDO}`,
        desde: `${a}-12-31`,
        urgente: false,
        destino: '#/resguardo',
      }));
    },
  },
  {
    clave: 'clave_bloqueada',
    tipo: 'aprobar',
    modulo: 'Configuración',
    permiso: 'claves_liberar',
    etiqueta: 'Accesos bloqueados por intentos fallidos',
    ayuda: 'Alguien no puede entrar. Se libera aquí o, más rápido, escribiendo tu clave en la misma pantalla donde quedó trabada.',
    destino: '#/accesos',
    urgente: true,
    consultar: () => [
      ...db.prepare(`
        SELECT u.id, u.nombre, u.bloqueado_en, u.bloqueado_motivo, q.nombre AS por
          FROM usuarios u LEFT JOIN usuarios q ON q.id = u.bloqueado_por
         WHERE u.bloqueado_en IS NOT NULL AND u.activo = 1 ORDER BY u.bloqueado_en
      `).all().map((u) => ({
        id: u.id,
        titulo: `${u.nombre} · clave bloqueada`,
        detalle: `${u.bloqueado_motivo || 'intentos fallidos'}${u.por ? ` · la bloqueó ${u.por}` : ''}`,
        desde: u.bloqueado_en,
        urgente: true,
        destino: '#/accesos',
      })),
      ...db.prepare(`
        SELECT dispositivo, bloqueado_en, motivo FROM accesos_dispositivos
         WHERE bloqueado_en IS NOT NULL ORDER BY bloqueado_en
      `).all().map((d, i) => ({
        id: 100000 + i,
        titulo: `Tablet ${d.dispositivo} · bloqueada`,
        detalle: d.motivo || 'intentos fallidos',
        desde: d.bloqueado_en,
        urgente: true,
        destino: '#/accesos',
      })),
    ],
  },
  {
    clave: 'calidad_visto_bueno',
    tipo: 'aprobar',
    modulo: 'Calidad',
    permiso: 'calidad_aprobar',
    etiqueta: 'Recepción sin visto bueno',
    ayuda: 'Almacén terminó de capturarla y el muestreo ya está firmado. Falta tu aprobación para darla por buena.',
    destino: '#/calidad/pendientes',
    consultar: () => db.prepare(`
      SELECT r.id, r.remision, r.proveedor, r.cerrado_en AS desde,
             c.nombre AS quien,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id) AS lotes,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id AND l.resultado = 'rechazado') AS rechazados
        FROM recepciones r
        LEFT JOIN usuarios c ON c.id = r.cerrado_por
       WHERE r.estado = 'cerrado'
       ORDER BY r.cerrado_en
    `).all().map((f) => ({
      id: f.id,
      titulo: `Remisión ${f.remision}`,
      detalle: `${f.proveedor} · ${f.lotes} lote(s)`
        + (f.rechazados ? ` · ${f.rechazados} rechazado(s)` : '')
        + (f.quien ? ` · cerró ${f.quien}` : ''),
      desde: f.desde,
      urgente: f.rechazados > 0,
    })),
  },
  {
    clave: 'calidad_rechazo',
    tipo: 'aprobar',
    modulo: 'Calidad',
    permiso: 'calidad_aprobar',
    etiqueta: 'Rechazo esperando tu decisión',
    ayuda: 'Un Team Leader ya propuso qué hacer con el material rechazado. La última palabra es tuya, y puedes cambiar la salida.',
    destino: '#/calidad/pendientes',
    consultar: () => db.prepare(`
      SELECT l.id, l.propuesta, l.propuesto_en AS desde, l.total_lote,
             m.modelo, r.remision, r.proveedor, pr.nombre AS quien
        FROM lotes l
        JOIN recepciones r ON r.id = l.recepcion_id
        JOIN materiales m ON m.id = l.material_id
        LEFT JOIN usuarios pr ON pr.id = l.propuesto_por
       WHERE l.resultado = 'rechazado' AND r.estado NOT IN ('borrador', 'cancelada')
         AND l.propuesta IS NOT NULL AND l.aprobado_en IS NULL
       ORDER BY l.propuesto_en
    `).all().map((f) => ({
      id: f.id,
      titulo: `${f.modelo} — remisión ${f.remision}`,
      detalle: `${f.proveedor} · ${f.total_lote || 0} pza(s) · propone ${ETIQUETA_DISPOSICION[f.propuesta] || f.propuesta}`
        + (f.quien ? ` (${f.quien})` : ''),
      desde: f.desde,
      urgente: true,
    })),
  },
  {
    clave: 'incidencia_por_autorizar',
    tipo: 'aprobar',
    modulo: 'Incidencias',
    permiso: 'incidencias_autorizar',
    etiqueta: 'Incidencia esperando tu autorización',
    ayuda: 'Un Team Leader la levantó. Hasta que la autorices no cuenta para el corte del mes.',
    destino: '#/incidencias',
    consultar: () => db.prepare(`
      SELECT i.id, i.fecha AS desde, i.situacion,
             u.nombre AS persona, l.nombre AS levanto
        FROM incidencias i
        JOIN usuarios u ON u.id = i.usuario_id
        JOIN usuarios l ON l.id = i.levantada_por
       WHERE i.estado = 'por_autorizar'
       ORDER BY i.fecha
    `).all().map((f) => ({
      id: f.id,
      titulo: f.persona,
      detalle: `${f.situacion.slice(0, 90)}${f.situacion.length > 90 ? '…' : ''} · la levantó ${f.levanto}`,
      desde: f.desde,
      urgente: false,
    })),
  },
  {
    clave: 'modo_pruebas_checklists',
    tipo: 'vigilar',
    modulo: 'Configuración',
    permiso: 'config_modo_pruebas',
    etiqueta: 'Modo de pruebas prendido',
    ayuda: 'Hay una copia de pruebas abierta. Lo que se capture en ella no cuenta; al apagarlo se descarta completa.',
    destino: '#/config/pruebas',
    consultar: () => {
      const m = modoPruebas();
      return m.activo ? [{
        id: 1, titulo: 'La copia de pruebas sigue abierta',
        detalle: `Lo prendió ${m.por || '—'}. Apágalo al terminar de probar.`, desde: m.desde, urgente: false,
      }] : [];
    },
  },
  {
    clave: 'checklist_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Checklists',
    permiso: 'checklists_aprobar',
    etiqueta: 'Checklist esperando tu aprobación',
    ayuda: 'Lo llenó y lo firmó alguien del equipo. Revísalo y apruébalo, o pide que lo corrija. Hasta que se apruebe no entra a Reportes.',
    destino: '#/notificaciones',
    // Quien lo llenó no lo aprueba: a él no le aparece. Al Administrador sí,
    // porque puede todo.
    consultar: (usuario) => db.prepare(`
      SELECT l.id, l.periodo, l.cerrado_en, p.nombre AS plantilla, a.nombre AS unidad, u.nombre AS lleno,
             (SELECT COUNT(*) FROM respuestas r WHERE r.llenado_id = l.id AND r.valor IN ('problema', 'no')) AS problemas,
             (SELECT COUNT(*) FROM llenado_revisiones v WHERE v.llenado_id = l.id AND v.accion = 'modificacion') AS vueltas
        FROM llenados l
        JOIN plantillas p ON p.id = l.plantilla_id
        JOIN usuarios u ON u.id = l.usuario_id
        LEFT JOIN activos a ON a.id = l.activo_id
       WHERE l.estado = 'cerrado' AND l.revision = 'por_aprobar' AND p.por_etapas = 0
         AND (? = 'admin' OR l.usuario_id <> ?)
       ORDER BY l.cerrado_en
    `).all(usuario ? usuario.rol : '', usuario ? usuario.id : 0).map((f) => ({
      id: f.id,
      titulo: `${f.plantilla}${f.unidad ? ` · ${f.unidad}` : ''}`,
      detalle: `${f.periodo} · lo llenó ${f.lleno} · ${f.problemas} problema(s)${f.vueltas ? ` · reenviado tras ${f.vueltas} corrección(es)` : ''}`,
      desde: f.cerrado_en,
      urgente: f.problemas > 0,
      destino: `#/checklists/revisar/${f.id}`,
    })),
  },
  {
    clave: 'checklist_modificacion',
    tipo: 'capturar',
    personal: true,
    modulo: 'Checklists',
    permiso: 'llenar',
    etiqueta: 'Checklist que te pidieron corregir',
    ayuda: 'Un Team Leader pidió modificación. Ábrelo, corrige lo que indica, vuelve a firmar y envíalo.',
    destino: '#/checklists',
    consultar: (usuario) => (usuario ? db.prepare(`
      SELECT l.id, l.periodo, p.nombre AS plantilla, a.nombre AS unidad,
             v.nota, v.en, q.nombre AS pidio
        FROM llenados l
        JOIN plantillas p ON p.id = l.plantilla_id
        LEFT JOIN activos a ON a.id = l.activo_id
        JOIN llenado_revisiones v ON v.id = (SELECT MAX(id) FROM llenado_revisiones
                                             WHERE llenado_id = l.id AND accion = 'modificacion')
        LEFT JOIN usuarios q ON q.id = v.usuario_id
       WHERE l.revision = 'modificacion' AND l.usuario_id = ? AND p.por_etapas = 0
       ORDER BY v.en
    `).all(usuario.id).map((f) => ({
      id: f.id,
      titulo: `${f.plantilla}${f.unidad ? ` · ${f.unidad}` : ''}`,
      detalle: `${f.periodo} · ${f.pidio || 'Un Team Leader'}: «${f.nota}»`,
      desde: f.en,
      urgente: true,
      destino: `#/envio/${f.id}`,
    })) : []),
  },
  // Tránsito. Un envío o una colecta esperan dos veces a un Team Leader
  // —autorizar la salida o la carga, y aprobar el cierre— y dos veces a Tránsito:
  // cuando ya está autorizado y cuando se lo regresan. Un traspaso espera a que
  // Tránsito lo cargue y a que alguien confirme que llegó.
  {
    clave: 'transito_por_autorizar',
    tipo: 'aprobar',
    modulo: 'Tránsito',
    permiso: 'transito_autorizar',
    etiqueta: 'Salida de unidad esperando tu autorización',
    ayuda: 'El Formato de Asignación e Inspección Vehicular ya se llenó, trae sus documentos y está firmado. Ábrelo, revísalo y autoriza la salida —o la carga, si es colecta—, o regrésalo con una nota de qué corregir. Hasta que lo autorices, la unidad no sale.',
    destino: '#/envios/transito',
    // Quien lo llenó no lo autoriza: a él no le aparece. Al Administrador sí.
    consultar: (usuario) => enviosDeTransito('borrador', 'por_autorizar').filter(noEsSuyo(usuario)).map((l) => ({
      id: l.id,
      titulo: tituloEnvio(l),
      // Quién la lleva y con qué unidad, que es lo que se pregunta al autorizar.
      detalle: [conQuienSale(l), `lo llenó ${l.preparo}`, l.periodo].filter(Boolean).join(' · '),
      desde: l.ultimo_paso || l.creado_en,
      urgente: l.periodo < hoyISO(),
      // Lleva directo al formato, no a la lista: se abre, se revisa y se autoriza.
      destino: `#/envio/${l.id}`,
    })),
  },
  {
    clave: 'transito_cierre_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Tránsito',
    permiso: 'transito_aprobar_cierre',
    etiqueta: 'Cierre esperando tu aprobación',
    ayuda: 'Ya se cargó la hoja de recepción (envío) o la evidencia de carga recolectada (colecta), y quien lo llenó firmó. Aprueba el cierre para que pase a Reportes, o regrésalo.',
    destino: '#/envios/transito',
    consultar: (usuario) => enviosDeTransito('en_ruta', 'por_aprobar').filter(noEsSuyo(usuario)).map((l) => ({
      id: l.id,
      titulo: tituloEnvio(l),
      detalle: `${l.periodo} · lo llenó ${l.preparo}${l.autorizo ? ` · autorizó ${l.autorizo}` : ''}`,
      desde: l.ultimo_paso || l.salida_en,
      urgente: l.periodo < hoyISO(),
      destino: `#/envio/${l.id}`,
    })),
  },
  {
    clave: 'transito_autorizado',
    tipo: 'capturar',
    modulo: 'Tránsito',
    permiso: 'mod_transito',
    etiqueta: 'Autorizado: falta completar el cierre',
    ayuda: 'Un Team Leader autorizó la salida del envío o la carga de la colecta. Carga la hoja de recepción o la evidencia de carga recolectada, firma y envíalo a aprobación de cierre.',
    destino: '#/envios/transito',
    // A todo Tránsito: cualquiera que capture ahí puede completar el regreso.
    consultar: (usuario) => (usuario && puede(usuario, 'llenar') ? enviosDeTransito('en_ruta', '').map((l) => ({
      id: l.id,
      titulo: tituloEnvio(l),
      detalle: `${esColecta(l) ? 'Carga' : 'Salida'} autorizada${l.autorizo ? ` por ${l.autorizo}` : ''} · falta `
        + (esColecta(l) ? 'la evidencia de carga recolectada' : 'la hoja de recepción'),
      desde: l.salida_en,
      urgente: l.periodo < hoyISO(),
      destino: `#/envio/${l.id}`,
    })) : []),
  },
  {
    clave: 'transito_correccion',
    tipo: 'capturar',
    modulo: 'Tránsito',
    permiso: 'mod_transito',
    etiqueta: 'Envío o colecta regresado para corregir',
    ayuda: 'Un Team Leader lo regresó con una nota. Ábrelo, corrige lo que indica y vuelve a enviarlo.',
    destino: '#/envios/transito',
    consultar: (usuario) => (usuario && puede(usuario, 'llenar')
      ? [...enviosDeTransito('borrador', 'modificacion'), ...enviosDeTransito('en_ruta', 'modificacion')].map((l) => ({
        id: l.id,
        titulo: tituloEnvio(l),
        detalle: `${l.regreso || 'Un Team Leader'}: «${l.nota || ''}»`,
        desde: l.ultimo_paso,
        urgente: true,
        destino: `#/envio/${l.id}`,
      }))
      : []),
  },
  {
    clave: 'traspaso_por_cargar',
    tipo: 'capturar',
    modulo: 'Tránsito',
    permiso: 'traspasos_cargar',
    etiqueta: 'Traspaso esperando que lo carguen',
    ayuda: 'Almacén ya lo aprobó. Cuando el material esté en el camión, sube la foto de la carga y avisa que va cargado.',
    destino: '#/envios/transito',
    consultar: () => traspasosEnEstado('aprobado').map((t) => ({
      id: t.id,
      titulo: `${t.folio} · ${t.origen} → ${t.destino || '—'}`,
      detalle: `${t.productos} producto(s) · ${t.unidades} unidades${t.aprobo ? ` · aprobó ${t.aprobo}` : ''}`,
      desde: t.aprobado_en,
      urgente: false,
      destino: `#/almacen/traspaso/${t.id}`,
    })),
  },
  {
    clave: 'traspaso_por_confirmar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'traspasos_confirmar',
    etiqueta: 'Traspaso en camino por confirmar',
    ayuda: 'Tránsito ya lo cargó. Cuando llegue a la bodega destino, confírmalo: hasta entonces el inventario no cambia en ninguna de las dos bodegas.',
    destino: '#/almacen/traspasos',
    consultar: () => traspasosEnEstado('cargado').map((t) => ({
      id: t.id,
      titulo: `${t.folio} · ${t.origen} → ${t.destino || '—'}`,
      detalle: `${t.productos} producto(s) · ${t.unidades} unidades${t.cargo ? ` · lo cargó ${t.cargo}` : ''}`,
      desde: t.cargado_en,
      // Más de un día en camino ya no es normal.
      urgente: !!t.cargado_en && Date.now() - Date.parse(t.cargado_en) > 24 * 3600 * 1000,
      destino: `#/almacen/traspaso/${t.id}`,
    })),
  },
  // Almacén. Cada documento espera a quien lo aprueba —y no le aparece a quien
  // lo capturó—, y lo regresado a corregir espera a quien lo captura.
  {
    clave: 'traspaso_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'traspasos_aprobar',
    etiqueta: 'Traspaso esperando tu aprobación',
    ayuda: 'Producción o Almacén pidió mover material entre bodegas. Al aprobarlo pasa a Tránsito para cargarlo.',
    destino: '#/almacen/traspasos',
    consultar: (usuario) => db.prepare(`
      SELECT s.id, s.folio, s.creado_en, s.usuario_id, bo.clave AS origen, bd.clave AS destino,
             u.nombre AS capturo, o.semana AS odt_semana,
             (SELECT COUNT(*) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS productos,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades
        FROM almacen_salidas s
        JOIN almacen_bodegas bo ON bo.id = s.bodega_id
        LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
        JOIN usuarios u ON u.id = s.usuario_id
        LEFT JOIN almacen_odt o ON o.id = s.odt_id
       WHERE s.motivo = 'traspaso' AND s.estado IN ('borrador', 'solicitado')
       ORDER BY s.creado_en
    `).all().filter(noEsSuyo(usuario)).map((t) => ({
      id: t.id,
      titulo: `${t.folio} · ${t.origen} → ${t.destino || '—'}`,
      detalle: `${t.productos} producto(s) · ${t.unidades} unidades · ${t.odt_semana ? 'lo pidió la ODT' : `capturó ${t.capturo}`}`,
      desde: t.creado_en,
      urgente: false,
      destino: `#/almacen/traspaso/${t.id}`,
    })),
  },
  {
    clave: 'almacen_entrada_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'entradas_aprobar',
    etiqueta: 'Entrada esperando tu aprobación',
    ayuda: 'Revisa lo capturado. Al aprobarla pasa a Calidad como pendiente de revisar; si algo está mal, regrésala a corregir.',
    destino: '#/almacen/entradas',
    consultar: (usuario) => db.prepare(`
      SELECT e.id, e.folio, e.fuente, COALESCE(e.proveedor, e.plataforma) AS quien, e.enviado_en, e.usuario_id,
             u.nombre AS capturo,
             (SELECT COUNT(*) FROM almacen_entrada_renglones r WHERE r.entrada_id = e.id) AS productos,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_entrada_renglones r WHERE r.entrada_id = e.id) AS unidades
        FROM almacen_entradas e JOIN usuarios u ON u.id = e.usuario_id
       WHERE e.estado = 'por_autorizar' ORDER BY e.enviado_en
    `).all().filter(noEsSuyo(usuario)).map((f) => ({
      id: f.id,
      titulo: `${f.fuente === 'retiro' ? 'Retiro' : 'Entrada'} ${f.folio} · ${f.quien}`,
      detalle: `${f.productos} producto(s) · ${f.unidades} unidades · capturó ${f.capturo}`,
      desde: f.enviado_en,
      urgente: false,
      destino: `#/almacen/entrada/${f.id}`,
    })),
  },
  {
    clave: 'almacen_salida_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'salidas_aprobar',
    etiqueta: 'Salida esperando tu aprobación',
    ayuda: 'El material no sale del inventario hasta que la apruebes. En rojo las que se salen de lo que pide la ODT.',
    destino: '#/almacen/salidas',
    consultar: (usuario) => db.prepare(`
      SELECT s.id, s.usuario_id FROM almacen_salidas s
       WHERE s.estado = 'por_autorizar' AND s.motivo <> 'traspaso' ORDER BY s.enviado_en
    `).all().filter(noEsSuyo(usuario)).map((f) => {
      const sal = salidaCompleta(f.id);
      const fuera = razonesDeAutorizacion(sal).length > 0;
      const porFuera = sal.motivo === 'ventas_fuera';
      const unidades = sal.renglones.reduce((n, r) => n + r.cantidad, 0);
      return {
        id: sal.id,
        titulo: `Salida ${sal.folio} · ${sal.destino || ETIQUETA_MOTIVO[sal.motivo] || sal.motivo}`,
        detalle: `${sal.renglones.length} producto(s) · ${unidades} unidades · capturó ${sal.capturo}`
          + (porFuera && sal.vxf ? ` · orden ${sal.vxf.folio}` : '')
          + (fuera ? (porFuera ? ' · no coincide con su orden de armado' : ' · fuera de lo que pide la ODT') : ''),
        desde: sal.enviado_en,
        urgente: fuera,
        destino: `#/almacen/salida/${sal.id}`,
      };
    }),
  },
  {
    clave: 'almacen_devolucion_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'devoluciones_aprobar',
    etiqueta: 'Devolución esperando tu aprobación',
    ayuda: 'El material vuelve al inventario cuando la apruebes. Revisa la foto y el motivo.',
    destino: '#/almacen/devoluciones',
    consultar: (usuario) => db.prepare(`
      SELECT d.id, d.folio, d.quien, d.rechazo_de, d.motivo, d.enviado_en, d.usuario_id, u.nombre AS capturo,
             d.origen = 'venta_directa' AS de_venta, rv.nombre AS reviso,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_devolucion_renglones r WHERE r.devolucion_id = d.id) AS unidades,
             (SELECT COALESCE(SUM(r.cantidad_buena), 0) FROM almacen_devolucion_renglones r WHERE r.devolucion_id = d.id) AS buenas
        FROM almacen_devoluciones d JOIN usuarios u ON u.id = d.usuario_id
        LEFT JOIN usuarios rv ON rv.id = d.revisado_por
       WHERE d.estado = 'por_autorizar' ORDER BY d.enviado_en
    `).all().filter(noEsSuyo(usuario)).map((f) => ({
      id: f.id,
      titulo: `Devolución ${f.folio} · ${f.quien || (f.rechazo_de === 'cedis' ? 'CEDIS' : 'cliente')}`,
      // El motivo va aquí y no dentro del documento: quien aprueba decide con
      // esto, y hacerlo abrir la devolución para leer por qué la rechazaron era
      // pedirle que decidiera a ciegas o que diera un viaje de más.
      detalle: `${f.de_venta ? `${f.buenas} pieza(s) buenas de ${f.unidades}` : `${f.unidades} unidades`}`
        + ` · ${f.de_venta ? 'Devolución de venta directa, ya revisada por Calidad'
          : f.rechazo_de === 'cedis' ? 'Rechazo del CEDIS' : 'Rechazo del cliente'}`
        + ` · «${(f.motivo || 'sin motivo escrito').slice(0, 120)}${(f.motivo || '').length > 120 ? '…' : ''}»`
        + ` · ${f.de_venta ? `revisó ${f.reviso || '—'}` : `capturó ${f.capturo}`}`,
      desde: f.enviado_en,
      urgente: false,
      destino: `#/almacen/devolucion/${f.id}`,
    })),
  },
  {
    clave: 'almacen_conteo_por_contar',
    tipo: 'capturar',
    modulo: 'Almacén',
    permiso: 'conteos_contar',
    etiqueta: 'Conteo por contar',
    ayuda: 'Se mandó a contar una bodega. Anota lo que hay en el piso y envíalo a aprobación. Si pidieron reconteo, los productos a revisar vienen marcados.',
    destino: '#/almacen/conteos',
    consultar: () => db.prepare(`
      SELECT c.id, c.semana, c.creado_en, c.correccion_nota, c.correccion_en, b.nombre AS bodega,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id AND r.contado IS NOT NULL) AS contados,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id) AS productos,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id AND r.recontar = 1) AS recontar
        FROM almacen_conteos c JOIN almacen_bodegas b ON b.id = c.bodega_id
       WHERE c.estado = 'borrador' ORDER BY c.creado_en
    `).all().map((f) => ({
      id: f.id,
      titulo: `${f.correccion_nota ? 'Reconteo' : 'Conteo'} de ${f.bodega} · ${f.semana}`,
      detalle: f.correccion_nota
        ? `${f.recontar} producto(s) por recontar · «${f.correccion_nota}»`
        : `${f.contados} de ${f.productos} producto(s) contados`,
      desde: f.correccion_en || f.creado_en,
      urgente: !!f.correccion_nota,
      destino: `#/almacen/conteo/${f.id}`,
    })),
  },
  {
    clave: 'almacen_conteo_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'conteos_aprobar',
    etiqueta: 'Ajuste de conteo esperando tu aprobación',
    ayuda: 'El conteo ya se envió. Al aprobarlo se corrige el inventario; si algo no cuadra, pide reconteo.',
    destino: '#/almacen/conteos',
    consultar: (usuario) => (usuario ? db.prepare(`
      SELECT c.id, c.semana, c.cerrado_en, c.cerrado_por, b.nombre AS bodega, ce.nombre AS cerro,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id AND r.contado <> r.teorico) AS con_diferencia,
             EXISTS (SELECT 1 FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id AND r.contado_por = ?) AS lo_conto
        FROM almacen_conteos c
        JOIN almacen_bodegas b ON b.id = c.bodega_id
        LEFT JOIN usuarios ce ON ce.id = c.cerrado_por
       WHERE c.estado = 'por_autorizar' ORDER BY c.cerrado_en
    `).all(usuario.id)
      .filter((f) => puede(usuario, 'conteos_aprobar_propios') || (f.cerrado_por !== usuario.id && !f.lo_conto))
      .map((f) => ({
        id: f.id,
        titulo: `Conteo de ${f.bodega} · ${f.semana}`,
        detalle: `${f.con_diferencia} producto(s) con diferencia · lo envió ${f.cerro || '—'}`,
        desde: f.cerrado_en,
        urgente: f.con_diferencia > 0,
        destino: `#/almacen/conteo/${f.id}`,
      })) : []),
  },
  {
    clave: 'almacen_por_corregir',
    tipo: 'capturar',
    modulo: 'Almacén',
    permiso: 'mod_almacen',
    etiqueta: 'Documento regresado para corregir',
    ayuda: 'Alguien con permiso pidió corregirlo. Ábrelo, corrige lo que dice la nota y vuelve a enviarlo a aprobación.',
    destino: '#/almacen',
    consultar: (usuario) => (usuario ? [
      ['entrada', 'almacen_entradas', 'entradas_capturar', 'Entrada', "AND d.fuente = 'proveedor'", (id) => `#/almacen/entrada/${id}`],
      // Un retiro del camino nuevo no se regresa a corregir —se reabre—, pero los
      // que quedaron con nota del camino anterior tienen que seguir apareciendo.
      ['retiro', 'almacen_entradas', 'retiros_capturar', 'Retiro', "AND d.fuente = 'retiro'", (id) => `#/almacen/retiro/${id}`],
      ['salida', 'almacen_salidas', 'salidas_capturar', 'Salida', "AND d.motivo NOT IN ('traspaso', 'calidad')", (id) => `#/almacen/salida/${id}`],
      ['salida', 'almacen_salidas', 'calidad_salida_pedir', 'Salida por calidad', "AND d.motivo = 'calidad'", (id) => `#/calidad/salida/${id}`],
      ['devolucion', 'almacen_devoluciones', 'devoluciones_capturar', 'Devolución', '', (id) => `#/almacen/devolucion/${id}`],
      ['reingreso', 'almacen_reingresos', 'reingresos_capturar', 'Re-ingreso', '', (id) => `#/calidad/reingreso/${id}`],
    ].filter(([, , permisoCaptura]) => puede(usuario, permisoCaptura))
      .flatMap(([tipo, tabla, , nombre, extra, aDonde]) => db.prepare(`
      SELECT d.id, d.folio, d.correccion_nota, d.correccion_en, q.nombre AS pidio
        FROM ${tabla} d LEFT JOIN usuarios q ON q.id = d.correccion_por
       WHERE d.estado = 'borrador' AND d.correccion_nota IS NOT NULL ${extra}
       ORDER BY d.correccion_en
    `).all().map((f) => ({
      id: `${tipo}-${f.id}`,
      titulo: `${nombre} ${f.folio}`,
      detalle: `${f.pidio || 'Alguien'}: «${f.correccion_nota}»`,
      desde: f.correccion_en,
      urgente: true,
      destino: aDonde(f.id),
    }))) : []),
  },
  {
    clave: 'retiro_por_recibir',
    tipo: 'revisar',
    modulo: 'Calidad',
    permiso: 'reingresos_capturar',
    etiqueta: 'Retiro pendiente de recibir',
    ayuda: 'Almacén cargó un retiro de plataforma. Cuando el material llegue a la bodega, levanta el re-ingreso: cuántas cajas llegaron y qué trae cada una.',
    destino: '#/calidad/reingresos',
    consultar: () => retirosPendientes().map((r) => ({
      id: r.id,
      titulo: `Retiro ${r.folio} · ${r.plataforma}`,
      detalle: `${r.por_recibir} de ${r.pedido} unidad(es) por recibir en ${r.bodega}`
        + (r.abiertos ? ` · ${r.abiertos} re-ingreso(s) en proceso` : ''),
      desde: r.enviado_en,
      // Un retiro que lleva más de una semana esperando ya no es normal: o llegó
      // y nadie lo registró, o la plataforma no lo mandó.
      urgente: !!r.enviado_en && Date.now() - Date.parse(r.enviado_en) > 7 * 24 * 3600 * 1000,
      destino: '#/calidad/reingresos',
    })),
  },
  {
    clave: 'almacen_reingreso_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'reingresos_aprobar',
    etiqueta: 'Re-ingreso de retiro esperando tu aprobación',
    ayuda: 'Calidad recibió el material de un retiro y detalló caja por caja lo que verificó. Al aprobarlo, eso entra al inventario.',
    destino: '#/calidad/reingresos',
    consultar: (usuario) => db.prepare(`
      SELECT g.id, g.folio, g.cajas, g.enviado_en, g.usuario_id, b.nombre AS bodega,
             u.nombre AS capturo, e.folio AS retiro_folio, e.plataforma,
             (SELECT COALESCE(SUM(c.cantidad), 0) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS unidades
        FROM almacen_reingresos g
        JOIN almacen_bodegas b ON b.id = g.bodega_id
        JOIN usuarios u ON u.id = g.usuario_id
        JOIN almacen_entradas e ON e.id = g.entrada_id
       WHERE g.estado = 'por_autorizar' ORDER BY g.enviado_en
    `).all().filter(noEsSuyo(usuario)).map((f) => ({
      id: f.id,
      titulo: `Re-ingreso ${f.folio} · retiro ${f.retiro_folio}`,
      detalle: `${f.cajas} caja(s) · ${f.unidades} unidades a ${f.bodega} · recibió ${f.capturo}`,
      desde: f.enviado_en,
      urgente: false,
      destino: `#/calidad/reingreso/${f.id}`,
    })),
  },
  {
    clave: 'calidad_salida_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Almacén',
    permiso: 'calidad_salida_aprobar',
    etiqueta: 'Salida por calidad esperando tu aprobación',
    ayuda: 'Calidad encontró material dañado en bodega y pide darlo de baja. Lee el motivo y mira la evidencia: al aprobarla, sale del inventario.',
    destino: '#/calidad/salidas',
    consultar: (usuario) => db.prepare(`
      SELECT s.id, s.folio, s.notas, s.enviado_en, s.usuario_id, b.nombre AS bodega, u.nombre AS capturo,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades,
             (SELECT COUNT(*) FROM almacen_fotos f WHERE f.documento_tipo = 'salida' AND f.documento_id = s.id) AS fotos
        FROM almacen_salidas s
        JOIN almacen_bodegas b ON b.id = s.bodega_id
        JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.motivo = 'calidad' AND s.estado = 'por_autorizar' ORDER BY s.enviado_en
    `).all().filter(noEsSuyo(usuario)).map((f) => ({
      id: f.id,
      titulo: `Salida por calidad ${f.folio} · ${f.bodega}`,
      detalle: `${f.unidades} unidades · ${motivosDeSalida(f.id)} · pidió ${f.capturo}`,
      desde: f.enviado_en,
      urgente: true,
      destino: `#/calidad/salida/${f.id}`,
    })),
  },
  // Producción: la ODT por publicar, las modificaciones y los envíos atrasados.
  {
    clave: 'produccion_odt_por_publicar',
    tipo: 'capturar',
    modulo: 'Producción',
    permiso: 'produccion_odt_cargar',
    etiqueta: 'ODT cargada sin publicar',
    ayuda: 'Ya se cargó el Excel. Reparte cada partida por envío y publícala: hasta entonces producción no la ve.',
    destino: '#/produccion',
    consultar: () => db.prepare(`
      SELECT o.id, o.semana, o.importado_en, o.creado_en FROM almacen_odt o
       WHERE o.publicada_en IS NULL AND o.estado = 'abierta' AND o.semana >= ?
       ORDER BY o.semana
    `).all(semanaISO()).map((o) => {
      const t = tableroODT(o.id);
      return {
        id: o.id,
        titulo: `ODT ${describirSemana(o.semana)}`,
        detalle: t.reparto_completo ? 'Ya está repartida: falta publicarla.' : `${t.sin_repartir} partida(s) por repartir entre los envíos`,
        desde: o.importado_en || o.creado_en,
        urgente: o.semana === semanaISO(),
        destino: `#/produccion/odt/${o.id}`,
      };
    }),
  },
  {
    clave: 'produccion_modificacion_por_aprobar',
    tipo: 'aprobar',
    modulo: 'Producción',
    permiso: 'produccion_modificacion_aprobar',
    etiqueta: 'Modificación a la ODT esperando tu aprobación',
    ayuda: 'Producción pidió cambiar una partida de la ODT publicada. Al aprobarla, la ODT cambia; si no procede, recházala con una nota.',
    destino: '#/produccion',
    consultar: (usuario) => db.prepare(`
      SELECT m.id, m.odt_id, m.usuario_id, m.motivo, m.creado_en, m.pedidos_antes, m.pedidos_despues,
             r.codigo, u.nombre AS pidio
        FROM produccion_modificaciones m
        JOIN almacen_odt_renglones r ON r.id = m.renglon_id
        JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.estado = 'por_aprobar' ORDER BY m.creado_en
    `).all().filter(noEsSuyo(usuario)).map((m) => ({
      id: m.id,
      titulo: `Partida ${m.codigo}: de ${m.pedidos_antes} a ${m.pedidos_despues}`,
      detalle: `«${m.motivo}» · pidió ${m.pidio}`,
      desde: m.creado_en,
      urgente: true,
      destino: `#/produccion/odt/${m.odt_id}`,
    })),
  },
  {
    clave: 'produccion_modificacion_resuelta',
    tipo: 'vigilar',
    personal: true,
    modulo: 'Producción',
    permiso: 'produccion_modificacion_pedir',
    etiqueta: 'Tu modificación a la ODT ya se resolvió',
    ayuda: 'Lo que pediste cambiar en la ODT ya se aprobó o se rechazó. Se queda aquí dos días.',
    destino: '#/produccion',
    consultar: (usuario) => (usuario ? db.prepare(`
      SELECT m.id, m.odt_id, m.estado, m.resuelto_en, m.nota_resolucion, r.codigo, q.nombre AS resolvio
        FROM produccion_modificaciones m
        JOIN almacen_odt_renglones r ON r.id = m.renglon_id
        LEFT JOIN usuarios q ON q.id = m.resuelto_por
       WHERE m.usuario_id = ? AND m.estado IN ('aprobada', 'rechazada') AND m.resuelto_en >= ?
       ORDER BY m.resuelto_en DESC
    `).all(usuario.id, new Date(Date.now() - 2 * 86400000).toISOString()).map((m) => ({
      id: m.id,
      titulo: `Partida ${m.codigo}: ${m.estado === 'aprobada' ? 'aprobada' : 'rechazada'}`,
      detalle: `${m.resolvio || 'Alguien'}${m.nota_resolucion ? `: «${m.nota_resolucion}»` : ''}`,
      desde: m.resuelto_en,
      urgente: m.estado === 'rechazada',
      destino: `#/produccion/odt/${m.odt_id}`,
    })) : []),
  },
  {
    clave: 'produccion_envio_atrasado',
    tipo: 'vigilar',
    modulo: 'Producción',
    permiso: 'produccion_avance',
    etiqueta: 'Envío que ya debía estar listo',
    ayuda: 'Llegó el día de su cita y todavía falta armar. Mira el avance por envío.',
    destino: '#/produccion',
    consultar: () => db.prepare(`
      SELECT o.id FROM almacen_odt o WHERE o.publicada_en IS NOT NULL AND o.estado = 'abierta'
    `).all().flatMap((o) => tableroODT(o.id).envios.filter((e) => e.situacion === 'atrasado' && e.total).map((e) => ({
      id: e.id,
      titulo: `${e.etiqueta || e.fecha} · ${e.cedis}${e.folio ? ` · ${e.folio}` : ''}`,
      detalle: `${e.armado} de ${e.total} armadas (${e.pct}%)`,
      desde: e.fecha,
      urgente: true,
      destino: `#/produccion/odt/${o.id}`,
    }))),
  },
  // Ventas directas: cada paso de la orden espera a alguien distinto.
  {
    clave: 'vxf_clientes_nuevos',
    tipo: 'revisar',
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_clientes',
    etiqueta: 'Cliente nuevo dado de alta desde una orden',
    ayuda: 'Quien vende escribió un cliente que no estaba en la cartera. Revisa que esté bien escrito y que no sea uno que ya existía con otro nombre.',
    destino: '#/ventas-fuera/clientes',
    consultar: () => db.prepare(`
      SELECT c.id, c.nombre, c.creado_en, u.nombre AS creo
        FROM vxf_clientes c LEFT JOIN usuarios u ON u.id = c.creado_por
       WHERE c.revisado = 0 ORDER BY c.creado_en
    `).all().map((c) => ({
      id: c.id, titulo: c.nombre, detalle: `lo dio de alta ${c.creo || '—'} al levantar una orden`,
      desde: c.creado_en, urgente: false, destino: '#/ventas-fuera/clientes',
    })),
  },
  {
    clave: 'vxf_por_armar',
    tipo: 'capturar',
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_armar',
    etiqueta: 'Orden de venta directa por armar',
    ayuda: 'Quien vende por fuera mandó una orden. Ármala y anota cada caja: su modelo y su peso.',
    destino: '#/ventas-fuera',
    consultar: () => db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.entrega, o.enviado_en, o.correccion_nota, o.correccion_en, s.nombre AS solicitante,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM vxf_renglones r WHERE r.orden_id = o.id) AS unidades
        FROM vxf_ordenes o JOIN usuarios s ON s.id = o.solicitante_id
       WHERE o.estado = 'por_armar' ORDER BY o.enviado_en
    `).all().map((o) => ({
      id: o.id,
      titulo: `${o.folio} · ${o.cliente}`,
      detalle: o.correccion_nota
        ? `La regresaron: «${o.correccion_nota}»`
        : `${o.unidades} pieza(s) · ${o.entrega === 'guia' ? 'con guía' : 'con nota de remisión'} · pidió ${o.solicitante}`,
      desde: o.correccion_en || o.enviado_en,
      urgente: !!o.correccion_nota,
      destino: `#/ventas-fuera/orden/${o.id}`,
    })),
  },
  {
    clave: 'vxf_por_documentar',
    tipo: 'capturar',
    personal: true,
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_capturar',
    etiqueta: 'Tu orden ya está armada: falta la guía o la nota',
    ayuda: 'Almacén armó tu orden y anotó sus cajas y su peso. Haz la guía o la nota de remisión y cárgala a la misma orden.',
    destino: '#/ventas-fuera',
    consultar: (usuario) => (usuario ? db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.entrega, o.armado_en, o.correccion_nota, o.correccion_en,
             (SELECT COUNT(*) FROM vxf_cajas c WHERE c.orden_id = o.id) AS cajas,
             (SELECT COALESCE(SUM(c.peso_kg), 0) FROM vxf_cajas c WHERE c.orden_id = o.id) AS peso
        FROM vxf_ordenes o
       WHERE o.estado = 'armada' AND (o.solicitante_id = ? OR ? = 'admin') ORDER BY o.armado_en
    `).all(usuario.id, usuario.rol).map((o) => ({
      id: o.id,
      titulo: `${o.folio} · ${o.cliente}`,
      detalle: o.correccion_nota ? `La regresaron: «${o.correccion_nota}»`
        : `${o.cajas} caja(s) · ${Math.round(o.peso * 100) / 100} kg · ${o.entrega === 'guia' ? 'falta la guía' : 'falta la nota de remisión'}`,
      desde: o.correccion_en || o.armado_en,
      urgente: !!o.correccion_nota,
      destino: `#/ventas-fuera/orden/${o.id}`,
    })) : []),
  },
  {
    clave: 'vxf_regresada',
    tipo: 'capturar',
    personal: true,
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_capturar',
    etiqueta: 'Tu orden te la regresaron para corregir',
    ayuda: 'El encargado la regresó con una nota. Corrígela y vuelve a mandarla a armar.',
    destino: '#/ventas-fuera',
    consultar: (usuario) => (usuario ? db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.correccion_nota, o.correccion_en, q.nombre AS pidio
        FROM vxf_ordenes o LEFT JOIN usuarios q ON q.id = o.correccion_por
       WHERE o.estado = 'borrador' AND o.correccion_nota IS NOT NULL AND o.solicitante_id = ?
    `).all(usuario.id).map((o) => ({
      id: o.id, titulo: `${o.folio} · ${o.cliente}`,
      detalle: `${o.pidio || 'El encargado'}: «${o.correccion_nota}»`,
      desde: o.correccion_en, urgente: true, destino: `#/ventas-fuera/orden/${o.id}`,
    })) : []),
  },
  {
    clave: 'vxf_por_cerrar',
    tipo: 'aprobar',
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_autorizar',
    etiqueta: 'Orden de venta directa por cerrar',
    ayuda: 'Ya tiene su guía o su nota de remisión. Revísala y ciérrala como terminada, o regrésala con una nota.',
    destino: '#/ventas-fuera',
    consultar: () => db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.documentado_en, d.nombre AS documento_quien
        FROM vxf_ordenes o LEFT JOIN usuarios d ON d.id = o.documentado_por
       WHERE o.estado = 'documentada' ORDER BY o.documentado_en
    `).all().map((o) => {
      const dif = diferenciasDeOrdenVxf(o.id).filter((f) => f.diferencia);
      return {
        id: o.id,
        titulo: `${o.folio} · ${o.cliente}`,
        detalle: `Cargó ${o.documento_quien || '—'}`
          + (dif.length ? ` · ${dif.length} producto(s) no coinciden con lo que salió de Almacén` : ''),
        desde: o.documentado_en,
        urgente: dif.length > 0,
        destino: `#/ventas-fuera/orden/${o.id}`,
      };
    }),
  },
  {
    clave: 'calidad_por_revisar',
    tipo: 'revisar',
    modulo: 'Calidad',
    permiso: 'calidad_capturar',
    etiqueta: 'Entrada pendiente de revisar',
    ayuda: 'Almacén aprobó una entrada. Muestrea lo que lo requiere, confirma cuánto llegó bien de lo demás y cierra la recepción.',
    destino: '#/calidad',
    consultar: () => db.prepare(`
      SELECT r.id, r.remision, r.proveedor, r.creado_en,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id) AS lotes,
             (SELECT COUNT(*) FROM recepcion_sin_muestreo s WHERE s.recepcion_id = r.id) AS sin_muestreo
        FROM recepciones r
       WHERE r.estado = 'borrador' AND r.entrada_id IS NOT NULL
       ORDER BY r.creado_en
    `).all().map((f) => ({
      id: f.id,
      titulo: `Remisión ${f.remision} · ${f.proveedor}`,
      detalle: [f.lotes ? `${f.lotes} lote(s) para muestreo` : '', f.sin_muestreo ? `${f.sin_muestreo} producto(s) por confirmar` : '']
        .filter(Boolean).join(' · '),
      desde: f.creado_en,
      urgente: false,
      destino: `#/recepcion/${f.id}`,
    })),
  },
  {
    clave: 'devolucion_vd_por_revisar',
    tipo: 'revisar',
    modulo: 'Calidad',
    permiso: 'calidad_capturar',
    etiqueta: 'Devolución de venta directa por revisar',
    ayuda: 'Regresó material de un cliente. Anota cuánto de cada producto llegó bien y qué tiene lo demás, y pídele la entrada a Almacén: solo lo bueno vuelve al inventario.',
    destino: '#/calidad/devoluciones',
    consultar: () => db.prepare(`
      SELECT d.id, d.folio, d.quien, d.motivo, d.creado_en, o.folio AS orden
        FROM almacen_devoluciones d LEFT JOIN vxf_ordenes o ON o.id = d.vxf_id
       WHERE d.origen = 'venta_directa' AND d.estado = 'en_calidad'
       ORDER BY d.creado_en
    `).all().map((d) => ({
      id: d.id,
      titulo: `${d.folio} · ${d.quien || '—'}`,
      detalle: `${d.orden ? `De la venta ${d.orden} · ` : ''}${d.motivo || ''}`,
      desde: d.creado_en,
      urgente: false,
      destino: `#/calidad/devolucion/${d.id}`,
    })),
  },
  {
    clave: 'vxf_cobro_por_anotar',
    tipo: 'capturar',
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_cobrar',
    etiqueta: 'Venta por cobrar: falta anotar el dinero',
    ayuda: 'La venta salió a cobrarse al entregar. Al regresar, anota cuánto te dieron, cómo te pagaron y sube la foto del dinero o del comprobante.',
    destino: '#/ventas-fuera',
    consultar: () => db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.monto_cobrar, o.documentado_en, o.cobro_nota
        FROM vxf_ordenes o
       WHERE o.cobro = 'por_cobrar' AND o.cobro_entregado_en IS NULL
         AND o.estado IN ('documentada', 'terminada')
       ORDER BY o.documentado_en
    `).all().map((o) => ({
      id: o.id,
      titulo: `${o.folio} · ${o.cliente}`,
      detalle: `Hay que cobrar ${pesosMX(o.monto_cobrar)}${o.cobro_nota ? ` · ${o.cobro_nota}` : ''}`,
      desde: o.documentado_en,
      urgente: !!o.cobro_nota,
      destino: `#/ventas-fuera/orden/${o.id}`,
    })),
  },
  {
    clave: 'vxf_cobro_por_confirmar',
    tipo: 'aprobar',
    modulo: 'Ventas directas',
    permiso: 'ventas_fuera_autorizar',
    etiqueta: 'Dinero cobrado esperando tu confirmación',
    ayuda: 'Quien entregó ya anotó el dinero y subió su evidencia. Confirma que llegó completo: hasta entonces la orden no se cierra.',
    destino: '#/ventas-fuera',
    consultar: () => db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.monto_cobrar, o.cobro_recibido, o.cobro_forma,
             o.cobro_entregado_en, u.nombre AS entrego
        FROM vxf_ordenes o LEFT JOIN usuarios u ON u.id = o.cobro_entregado_por
       WHERE o.cobro = 'por_cobrar' AND o.cobro_entregado_en IS NOT NULL AND o.cobro_confirmado_en IS NULL
       ORDER BY o.cobro_entregado_en
    `).all().map((o) => ({
      id: o.id,
      titulo: `${o.folio} · ${o.cliente}`,
      detalle: `${o.entrego || '—'} trajo ${pesosMX(o.cobro_recibido)} de ${pesosMX(o.monto_cobrar)}`
        + `${o.cobro_forma ? ` · ${o.cobro_forma.toLowerCase()}` : ''}`,
      desde: o.cobro_entregado_en,
      urgente: (o.cobro_recibido || 0) < (o.monto_cobrar || 0),
      destino: `#/ventas-fuera/orden/${o.id}`,
    })),
  },
  {
    clave: 'logistica_papeles',
    tipo: 'vigilar',
    modulo: 'Logística',
    permiso: 'mod_logistica',
    etiqueta: 'Papel de una unidad vencido o por vencer',
    ayuda: 'La tarjeta, la póliza, la verificación, la afiliación o la fumigación de una unidad. Vencidas primero: con eso no debería salir a la calle.',
    destino: '#/logistica',
    consultar: () => db.prepare('SELECT id, nombre FROM activos WHERE activo = 1').all()
      .flatMap((a) => vigenciasDeUnidad(a.id)
        .filter((v) => ['vencida', 'vence_hoy', 'por_vencer'].includes(v.estado))
        .map((v) => ({
          id: a.id,
          titulo: `${a.nombre} · ${v.concepto}`,
          detalle: `${v.texto} · vence ${v.vence} · lo dice ${v.origen === 'documento' ? 'su documento' : 'su checklist'}`,
          desde: v.capturado || null,
          urgente: v.estado === 'vencida' || v.estado === 'vence_hoy',
          destino: `#/logistica/unidad/${a.id}`,
        }))),
  },
  {
    clave: 'ruta_por_planear',
    tipo: 'capturar',
    modulo: 'Logística',
    permiso: 'logistica_rutas',
    etiqueta: 'Entregas de hoy sin ruta',
    ayuda: 'Órdenes armadas o citas de la ODT que salen hoy y todavía no están en ninguna ruta. Súbelas a la ruta del día para que el equipo sepa en qué orden va.',
    destino: '#/logistica/rutas',
    consultar: () => {
      const hoy = hoyISO();
      const c = candidatosDeRuta(hoy);
      const suyas = c.ventas.filter((o) => o.fecha_salida === hoy);
      const citas = c.citas.filter((x) => x.fecha === hoy);
      return [...suyas.map((o) => ({
        id: o.id,
        titulo: `${o.folio} · ${o.cliente || 'sin cliente'}`,
        detalle: `${o.entrega === 'guia' ? 'Va a paquetería' : 'Entrega directa'} · sale hoy del almacén`,
        desde: null,
        urgente: true,
        destino: '#/logistica/rutas',
      })), ...citas.map((x) => ({
        id: 900000 + x.id,
        titulo: `${x.folio || x.etiqueta || 'Cita'} · ${x.cedis}`,
        detalle: 'Cita de la ODT para hoy, sin ruta',
        desde: null,
        urgente: true,
        destino: '#/logistica/rutas',
      }))];
    },
  },
  {
    clave: 'logistica_servicio',
    tipo: 'vigilar',
    modulo: 'Logística',
    permiso: 'logistica_servicios',
    etiqueta: 'Servicio de una unidad que ya toca',
    ayuda: 'Un servicio programado al que ya le llegó su fecha, o al que le faltan 500 km o menos.',
    destino: '#/logistica',
    consultar: () => db.prepare('SELECT id, nombre FROM activos WHERE activo = 1').all()
      .map((a) => ({ a, s: proximoServicio(a.id) }))
      .filter(({ s }) => s && s.urge)
      .map(({ a, s }) => ({
        id: s.id,
        titulo: `${a.nombre} · ${s.tipo}`,
        detalle: `Toca ${s.texto}`,
        desde: null,
        urgente: (s.faltan_km !== null && s.faltan_km <= 0) || (s.dias !== null && s.dias <= 0),
        destino: `#/logistica/unidad/${a.id}`,
      })),
  },
];

// Los pendientes que le tocan a una persona, agrupados por tipo. Se salta la
// consulta de lo que no puede atender: no tiene caso pagar el SELECT de algo
// que no se le va a mostrar.
function pendientesDe(usuario) {
  const grupos = [];
  for (const p of PENDIENTES) {
    if (!puede(usuario, p.permiso)) continue;
    const asuntos = p.consultar(usuario);
    if (!asuntos.length) continue;
    grupos.push({
      clave: p.clave, modulo: p.modulo, etiqueta: p.etiqueta,
      tipo: p.tipo || 'aprobar', personal: !!p.personal,
      permiso: p.permiso, etiqueta_permiso: ETIQUETA_DE_PERMISO[p.permiso] || p.permiso,
      ayuda: p.ayuda, destino: p.destino, asuntos,
    });
  }
  return grupos;
}

// --- lo que ya atendiste ---
//
// La bandeja enseña lo que falta; en cuanto resuelves algo desaparece de ella, y
// eso deja sin camino de regreso a lo que acabas de aprobar. Esto es la misma
// operación preguntada al revés: no hay un registro de avisos atendidos, se
// busca el nombre de quien pregunta en la columna de quien aprobó, cerró o pidió
// la corrección. Por eso nunca dice que atendiste algo que no atendiste.
const ATENDIDOS = [
  {
    clave: 'claves_liberadas', modulo: 'Configuración', tipo: 'aprobar',
    etiqueta: 'Accesos que liberaste', permiso: 'claves_liberar',
    consultar: (u, desde) => db.prepare(`
      SELECT b.id, b.en, b.dispositivo, b.nota, p.nombre AS quien
        FROM accesos_bitacora b LEFT JOIN usuarios p ON p.id = b.usuario_id
       WHERE b.accion = 'liberacion' AND b.por_id = ? AND b.en >= ?
       ORDER BY b.en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id,
      titulo: f.quien ? `${f.quien} · clave liberada` : `Tablet ${f.dispositivo} · liberada`,
      detalle: f.nota || 'volvió a quedar disponible',
      en: f.en, destino: '#/accesos',
    })),
  },
  {
    clave: 'entradas_aprobadas', modulo: 'Almacén', tipo: 'aprobar',
    etiqueta: 'Entradas que aprobaste', permiso: 'entradas_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT e.id, e.folio, e.estado, e.aprobado_en AS en, COALESCE(e.proveedor, e.plataforma) AS quien,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_entrada_renglones r WHERE r.entrada_id = e.id) AS unidades
        FROM almacen_entradas e
       WHERE e.aprobado_por = ? AND e.aprobado_en >= ? ORDER BY e.aprobado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Entrada ${f.folio} · ${f.quien}`,
      detalle: `${f.unidades} unidades · ${f.estado === 'aplicada' ? 'ya sumó al inventario' : 'en Calidad'}`,
      en: f.en, destino: `#/almacen/entrada/${f.id}`,
    })),
  },
  {
    clave: 'salidas_aprobadas', modulo: 'Almacén', tipo: 'aprobar',
    etiqueta: 'Salidas que aprobaste', permiso: 'salidas_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT s.id, s.folio, s.motivo, s.destino, s.estado, s.aplicado_en AS en,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades
        FROM almacen_salidas s
       WHERE s.autorizo_id = ? AND s.motivo NOT IN ('traspaso', 'calidad') AND s.aplicado_en >= ?
       ORDER BY s.aplicado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Salida ${f.folio} · ${f.destino || ETIQUETA_MOTIVO[f.motivo] || f.motivo}`,
      detalle: `${f.unidades} unidades · ${f.estado === 'aplicada' ? 'aplicada' : f.estado}`,
      en: f.en, destino: `#/almacen/salida/${f.id}`,
    })),
  },
  {
    clave: 'devoluciones_aprobadas', modulo: 'Almacén', tipo: 'aprobar',
    etiqueta: 'Devoluciones que aprobaste', permiso: 'devoluciones_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT d.id, d.folio, d.quien, d.estado, d.aplicado_en AS en,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_devolucion_renglones r WHERE r.devolucion_id = d.id) AS unidades
        FROM almacen_devoluciones d
       WHERE d.autorizo_id = ? AND d.aplicado_en >= ? ORDER BY d.aplicado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Devolución ${f.folio} · ${f.quien || '—'}`,
      detalle: `${f.unidades} unidades de vuelta en el inventario`,
      en: f.en, destino: `#/almacen/devolucion/${f.id}`,
    })),
  },
  {
    clave: 'conteos_aprobados', modulo: 'Almacén', tipo: 'aprobar',
    etiqueta: 'Ajustes de conteo que aprobaste', permiso: 'conteos_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT c.id, c.semana, c.autorizado_en AS en, b.nombre AS bodega,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id AND r.contado <> r.teorico) AS con_diferencia
        FROM almacen_conteos c JOIN almacen_bodegas b ON b.id = c.bodega_id
       WHERE c.autorizo_id = ? AND c.autorizado_en >= ? ORDER BY c.autorizado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Conteo de ${f.bodega} · ${f.semana}`,
      detalle: `${f.con_diferencia} producto(s) ajustados`,
      en: f.en, destino: `#/almacen/conteo/${f.id}`,
    })),
  },
  {
    clave: 'retiros_cerrados', modulo: 'Almacén', tipo: 'capturar',
    etiqueta: 'Retiros que cerraste', permiso: 'retiros_cerrar',
    consultar: (u, desde) => db.prepare(`
      SELECT e.id, e.folio, e.plataforma, e.cerrado_en AS en,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_entrada_renglones r WHERE r.entrada_id = e.id) AS unidades
        FROM almacen_entradas e
       WHERE e.fuente = 'retiro' AND e.cerrado_por = ? AND e.cerrado_en >= ?
       ORDER BY e.cerrado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Retiro ${f.folio} · ${f.plataforma}`,
      detalle: `${f.unidades} unidad(es) pedidas`,
      en: f.en, destino: `#/almacen/retiro/${f.id}`,
    })),
  },
  {
    clave: 'traspasos_movidos', modulo: 'Almacén', tipo: 'aprobar',
    etiqueta: 'Traspasos que aprobaste o confirmaste', permiso: 'traspasos_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT s.id, s.folio, s.estado, COALESCE(s.confirmado_en, s.aprobado_en) AS en,
             bo.clave AS origen, bd.clave AS destino
        FROM almacen_salidas s
        JOIN almacen_bodegas bo ON bo.id = s.bodega_id
        LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
       WHERE s.motivo = 'traspaso' AND (s.aprobado_por = ? OR s.confirmado_por = ?)
         AND COALESCE(s.confirmado_en, s.aprobado_en) >= ?
       ORDER BY COALESCE(s.confirmado_en, s.aprobado_en) DESC LIMIT 40
    `).all(u.id, u.id, desde).map((f) => ({
      id: f.id, titulo: `${f.folio} · ${f.origen} → ${f.destino || '—'}`,
      detalle: f.estado === 'aplicada' ? 'llegó y se confirmó' : `en ${f.estado}`,
      en: f.en, destino: `#/almacen/traspaso/${f.id}`,
    })),
  },
  {
    clave: 'reingresos_aprobados', modulo: 'Calidad', tipo: 'aprobar',
    etiqueta: 'Re-ingresos que aprobaste', permiso: 'reingresos_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT g.id, g.folio, g.cajas, g.aprobado_en AS en, e.folio AS retiro_folio,
             (SELECT COALESCE(SUM(c.cantidad), 0) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS unidades
        FROM almacen_reingresos g JOIN almacen_entradas e ON e.id = g.entrada_id
       WHERE g.aprobado_por = ? AND g.aprobado_en >= ? ORDER BY g.aprobado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Re-ingreso ${f.folio} · retiro ${f.retiro_folio}`,
      detalle: `${f.cajas} caja(s) · ${f.unidades} unidades al inventario`,
      en: f.en, destino: `#/calidad/reingreso/${f.id}`,
    })),
  },
  {
    clave: 'salidas_calidad_aprobadas', modulo: 'Calidad', tipo: 'aprobar',
    etiqueta: 'Salidas por calidad que aprobaste', permiso: 'calidad_salida_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT s.id, s.folio, s.notas, s.aplicado_en AS en, b.nombre AS bodega,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades
        FROM almacen_salidas s JOIN almacen_bodegas b ON b.id = s.bodega_id
       WHERE s.motivo = 'calidad' AND s.autorizo_id = ? AND s.aplicado_en >= ?
       ORDER BY s.aplicado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Salida por calidad ${f.folio} · ${f.bodega}`,
      detalle: `${f.unidades} unidades · ${motivosDeSalida(f.id)}`,
      en: f.en, destino: `#/calidad/salida/${f.id}`,
    })),
  },
  {
    clave: 'recepciones_visto_bueno', modulo: 'Calidad', tipo: 'aprobar',
    etiqueta: 'Recepciones a las que diste el visto bueno', permiso: 'calidad_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT r.id, r.remision, r.proveedor, r.aprobado_en AS en,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id) AS lotes
        FROM recepciones r WHERE r.aprobado_por = ? AND r.aprobado_en >= ?
       ORDER BY r.aprobado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Remisión ${f.remision} · ${f.proveedor}`,
      detalle: `${f.lotes} lote(s)`,
      en: f.en, destino: `#/recepcion/${f.id}`,
    })),
  },
  {
    clave: 'recepciones_cerradas', modulo: 'Calidad', tipo: 'revisar',
    etiqueta: 'Recepciones que cerraste', permiso: 'calidad_capturar',
    consultar: (u, desde) => db.prepare(`
      SELECT r.id, r.remision, r.proveedor, r.estado, r.cerrado_en AS en,
             (SELECT COUNT(*) FROM lotes l WHERE l.recepcion_id = r.id AND l.resultado = 'rechazado') AS rechazados
        FROM recepciones r WHERE r.cerrado_por = ? AND r.cerrado_en >= ?
       ORDER BY r.cerrado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Remisión ${f.remision} · ${f.proveedor}`,
      detalle: `${f.estado === 'aprobado' ? 'con visto bueno' : 'esperando visto bueno'}`
        + (f.rechazados ? ` · ${f.rechazados} rechazado(s)` : ''),
      en: f.en, destino: `#/recepcion/${f.id}`,
    })),
  },
  {
    clave: 'correcciones_pedidas', modulo: 'Almacén', tipo: 'capturar',
    etiqueta: 'Correcciones y reconteos que pediste', permiso: 'mod_almacen',
    consultar: (u, desde) => db.prepare(`
      SELECT c.documento_tipo, c.documento_id, c.folio, c.nota, c.en
        FROM almacen_correcciones c WHERE c.usuario_id = ? AND c.en >= ?
       ORDER BY c.en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: `${f.documento_tipo}-${f.documento_id}`,
      titulo: `${f.documento_tipo === 'conteo' ? 'Conteo' : f.documento_tipo === 'reingreso' ? 'Re-ingreso'
        : f.documento_tipo.charAt(0).toUpperCase() + f.documento_tipo.slice(1)} ${f.folio || f.documento_id}`,
      detalle: `«${f.nota}»`,
      en: f.en,
      destino: f.documento_tipo === 'reingreso'
        ? `#/calidad/reingreso/${f.documento_id}`
        : `#/almacen/${f.documento_tipo}/${f.documento_id}`,
    })),
  },
  {
    clave: 'checklists_revisados', modulo: 'Checklists', tipo: 'aprobar',
    etiqueta: 'Checklists y envíos que revisaste', permiso: 'firmar_supervision',
    consultar: (u, desde) => db.prepare(`
      SELECT v.accion, v.nota, v.en, l.id, l.periodo, p.nombre AS plantilla, p.clave AS plantilla_clave,
             a.nombre AS unidad, l.referencia
        FROM llenado_revisiones v
        JOIN llenados l ON l.id = v.llenado_id
        JOIN plantillas p ON p.id = l.plantilla_id
        LEFT JOIN activos a ON a.id = l.activo_id
       WHERE v.usuario_id = ? AND v.en >= ?
         AND v.accion IN ('aprobado', 'modificacion', 'salida_autorizada')
       ORDER BY v.en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: `${f.id}-${f.en}`,
      titulo: `${f.plantilla}${f.unidad ? ` · ${f.unidad}` : ''}${f.referencia ? ` · ${f.referencia}` : ''}`,
      detalle: `${f.periodo} · ${{ aprobado: 'lo aprobaste', modificacion: 'pediste corrección',
        salida_autorizada: 'autorizaste la salida' }[f.accion]}${f.nota ? ` · «${f.nota}»` : ''}`,
      en: f.en,
      destino: f.plantilla_clave === 'transito' ? `#/envio/${f.id}` : `#/checklists/revisar/${f.id}`,
    })),
  },
  {
    clave: 'modificaciones_resueltas', modulo: 'Producción', tipo: 'aprobar',
    etiqueta: 'Modificaciones a la ODT que resolviste', permiso: 'produccion_modificacion_aprobar',
    consultar: (u, desde) => db.prepare(`
      SELECT m.id, m.odt_id, m.estado, m.resuelto_en AS en, m.pedidos_antes, m.pedidos_despues, r.codigo
        FROM produccion_modificaciones m JOIN almacen_odt_renglones r ON r.id = m.renglon_id
       WHERE m.resuelto_por = ? AND m.estado IN ('aprobada', 'rechazada') AND m.resuelto_en >= ?
       ORDER BY m.resuelto_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `Partida ${f.codigo}: de ${f.pedidos_antes} a ${f.pedidos_despues}`,
      detalle: f.estado === 'aprobada' ? 'la aprobaste' : 'la rechazaste',
      en: f.en, destino: `#/produccion/odt/${f.odt_id}`,
    })),
  },
  {
    clave: 'vxf_armadas', modulo: 'Ventas directas', tipo: 'capturar',
    etiqueta: 'Órdenes de venta directa que armaste', permiso: 'ventas_fuera_armar',
    consultar: (u, desde) => db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.armado_en AS en FROM vxf_ordenes o
       WHERE o.armado_por = ? AND o.armado_en >= ? ORDER BY o.armado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `${f.folio} · ${f.cliente}`, detalle: 'la armaste', en: f.en, destino: `#/ventas-fuera/orden/${f.id}`,
    })),
  },
  {
    clave: 'vxf_cerradas', modulo: 'Ventas directas', tipo: 'aprobar',
    etiqueta: 'Órdenes de venta directa que cerraste', permiso: 'ventas_fuera_autorizar',
    consultar: (u, desde) => db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.cerrado_en AS en FROM vxf_ordenes o
       WHERE o.cerrado_por = ? AND o.cerrado_en >= ? ORDER BY o.cerrado_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: `${f.folio} · ${f.cliente}`, detalle: 'la cerraste como terminada', en: f.en, destino: `#/ventas-fuera/orden/${f.id}`,
    })),
  },
  {
    clave: 'incidencias_resueltas', modulo: 'Incidencias', tipo: 'aprobar',
    etiqueta: 'Incidencias que resolviste', permiso: 'incidencias_autorizar',
    consultar: (u, desde) => db.prepare(`
      SELECT i.id, i.estado, i.resuelta_en AS en, i.situacion, us.nombre AS persona
        FROM incidencias i JOIN usuarios us ON us.id = i.usuario_id
       WHERE i.resuelta_por = ? AND i.resuelta_en >= ? ORDER BY i.resuelta_en DESC LIMIT 40
    `).all(u.id, desde).map((f) => ({
      id: f.id, titulo: f.persona,
      detalle: `${f.estado === 'autorizada' ? 'autorizada' : 'rechazada'} · ${f.situacion.slice(0, 90)}`,
      en: f.en, destino: '#/incidencias',
    })),
  },
];

function atendidosDe(usuario, dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const grupos = [];
  for (const a of ATENDIDOS) {
    if (!puede(usuario, a.permiso)) continue;
    const asuntos = a.consultar(usuario, desde).filter((x) => x.en);
    if (!asuntos.length) continue;
    grupos.push({ clave: a.clave, modulo: a.modulo, tipo: a.tipo, etiqueta: a.etiqueta, asuntos });
  }
  return grupos;
}

const cuantosPendientes = (usuario) =>
  pendientesDe(usuario).reduce((n, g) => n + g.asuntos.length, 0);

ruta('GET', '/api/notificaciones', (req, res) => {
  const usuario = exigir(req, res, 'mod_notificaciones');
  if (!usuario) return;
  const grupos = pendientesDe(usuario);
  json(res, 200, {
    grupos,
    total: grupos.reduce((n, g) => n + g.asuntos.length, 0),
    tipos: TIPOS_PENDIENTE,
    // Para saber si el vacío es «no hay nada» o «esto no te toca a ti».
    puede_aprobar: PENDIENTES.some((p) => puede(usuario, p.permiso)),
  });
});

// Lo que esta persona ya atendió, para poder volver a abrirlo. Por omisión el
// último mes: más atrás es historia y eso se consulta en Reportes.
ruta('GET', '/api/notificaciones/atendidas', (req, res) => {
  const usuario = exigir(req, res, 'mod_notificaciones');
  if (!usuario) return;
  const url = new URL(req.url, 'http://x');
  const dias = Math.min(Math.max(Number(url.searchParams.get('dias') || 30) || 30, 1), 365);
  const grupos = atendidosDe(usuario, dias);
  json(res, 200, {
    grupos,
    dias,
    total: grupos.reduce((n, g) => n + g.asuntos.length, 0),
    tipos: TIPOS_PENDIENTE,
  });
});
// ------------------------------------------------------- entregas x fuera
//
// La orden de armado de una venta directa. Antes llegaba por fuera del
// sistema; ahora se levanta aquí, desde el puesto de ventas directas:
//
//   borrador     Quien vende la llena: cliente, guía o remisión, productos.
//   por_armar    La mandó. Le llega a quien arma.                (ventas_fuera_armar)
//   armada       Almacén la armó y anotó cada caja: modelo y peso.
//                Le llega a quien vende para hacer la guía.   (ventas_fuera_capturar)
//   documentada  Quien vende cargó la guía o la nota de remisión.
//                Le llega al encargado.                        (ventas_fuera_autorizar)
//   terminada    El encargado la cerró.
//
// En cualquier paso después de mandarla, el encargado la puede regresar con una
// nota al paso anterior que toque. El inventario no se mueve aquí: lo mueve la
// salida de Almacén, que se amarra a esta orden y se coteja contra ella.

// Cuánto se le va a cobrar al cliente. Se guarda en pesos con dos decimales.
const montoDeCobro = (v) => {
  const n = Number(String(v ?? '').replace(/[, $]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

// Cómo sale una venta: ya pagada, o a cobrar cuando se entregue.
const COBROS_VXF = [
  { clave: 'pagada', etiqueta: 'Ya está pagada' },
  { clave: 'por_cobrar', etiqueta: 'Se cobra al entregar' },
];
const FORMAS_COBRO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque'];

const ENTREGAS_VXF = [
  { clave: 'guia', etiqueta: 'Paquete con guía de paquetería' },
  { clave: 'remision', etiqueta: 'Con nota de remisión' },
];

function ordenVxf(id) {
  const o = db.prepare(`
    SELECT o.*, s.nombre AS solicitante, a.nombre AS armo, d.nombre AS documento_quien,
           c.nombre AS cerro, q.nombre AS pidio_correccion
      FROM vxf_ordenes o
      JOIN usuarios s ON s.id = o.solicitante_id
      LEFT JOIN usuarios a ON a.id = o.armado_por
      LEFT JOIN usuarios d ON d.id = o.documentado_por
      LEFT JOIN usuarios c ON c.id = o.cerrado_por
      LEFT JOIN usuarios q ON q.id = o.correccion_por
     WHERE o.id = ?
  `).get(id);
  if (!o) return null;
  o.etiqueta_entrega = (ENTREGAS_VXF.find((e) => e.clave === o.entrega) || {}).etiqueta || o.entrega;
  o.renglones = db.prepare(`
    SELECT r.*, p.sku, p.nombre AS producto, p.modelo, p.tipo_material
      FROM vxf_renglones r JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.orden_id = ? ORDER BY r.orden, r.id
  `).all(id).map((r) => ({ ...r, unidad: unidadDe(r.tipo_material) }));
  o.cajas = db.prepare(`
    SELECT c.*, p.nombre AS modelo_caja, p.sku
      FROM vxf_cajas c LEFT JOIN almacen_productos p ON p.id = c.producto_id
     WHERE c.orden_id = ? ORDER BY c.orden, c.id
  `).all(id);
  o.peso_total = Math.round(o.cajas.reduce((n, c) => n + (c.peso_kg || 0), 0) * 100) / 100;
  o.documentos = fotosDeDocumento('vxf', id);
  o.etiqueta_cobro = (COBROS_VXF.find((c) => c.clave === o.cobro) || {}).etiqueta || 'Ya está pagada';
  o.evidencia_cobro = fotosDeDocumento('vxf_cobro', id);
  o.cobro_entrego = nombreDe(o.cobro_entregado_por);
  o.cobro_confirmo = nombreDe(o.cobro_confirmado_por);
  o.falta_cobro = faltaDelCobro(o);
  o.correcciones = correccionesDe('vxf', id);
  // Las salidas de Almacén que salieron de esta orden, y si cuadran con ella.
  o.salidas = db.prepare(`
    SELECT s.id, s.folio, s.estado, s.fecha,
           (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_salida_renglones x WHERE x.salida_id = s.id) AS unidades
      FROM almacen_salidas s WHERE s.vxf_id = ? AND s.estado <> 'cancelada' ORDER BY s.id
  `).all(id);
  o.diferencias = diferenciasDeOrdenVxf(id);
  return o;
}

// Lo pedido en la orden contra todo lo que ya salió aprobado de ella.
function diferenciasDeOrdenVxf(ordenId) {
  const salio = new Map(db.prepare(`
    SELECT r.producto_id, SUM(r.cantidad) AS n
      FROM almacen_salida_renglones r JOIN almacen_salidas s ON s.id = r.salida_id
     WHERE s.vxf_id = ? AND s.estado = 'aplicada' GROUP BY r.producto_id
  `).all(ordenId).map((f) => [f.producto_id, f.n]));
  const filas = db.prepare(`
    SELECT r.producto_id, SUM(r.cantidad) AS pedido, p.nombre AS producto
      FROM vxf_renglones r JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.orden_id = ? GROUP BY r.producto_id
  `).all(ordenId).map((f) => ({ ...f, salio: salio.get(f.producto_id) || 0 }));
  for (const [productoId, n] of salio) {
    if (!filas.some((f) => f.producto_id === productoId)) {
      const pr = db.prepare('SELECT nombre FROM almacen_productos WHERE id = ?').get(productoId) || {};
      filas.push({ producto_id: productoId, producto: pr.nombre, pedido: 0, salio: n });
    }
  }
  return filas.map((f) => ({ ...f, diferencia: f.salio - f.pedido }));
}

function faltantesDeVxf(o, paso) {
  const faltas = [];
  if (paso === 'enviar') {
    if (!(o.cliente || '').trim()) faltas.push('Anota a qué cliente se entrega.');
    if (!o.renglones.length) faltas.push('Agrega al menos un producto vendido.');
    for (const r of o.renglones) if (!r.cantidad) faltas.push(`«${r.producto}»: falta la cantidad.`);
  }
  if (paso === 'armar') {
    if (!o.cajas.length) faltas.push('Anota las cajas que se usaron.');
    o.cajas.forEach((c, i) => {
      if (!c.producto_id) faltas.push(`Caja ${i + 1}: falta el modelo de caja.`);
      if (!(c.peso_kg > 0)) faltas.push(`Caja ${i + 1}: falta el peso.`);
    });
  }
  if (paso === 'documentar' && !o.documentos.length) {
    faltas.push(o.entrega === 'guia' ? 'Carga la guía de paquetería.' : 'Carga la nota de remisión.');
  }
  return faltas;
}

const accesoVxf = (usuario) => ['mod_ventas_fuera', 'ventas_fuera_capturar', 'ventas_fuera_armar', 'ventas_fuera_autorizar']
  .some((k) => puede(usuario, k));

ruta('GET', '/api/vxf/ordenes', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  if (!accesoVxf(usuario)) return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  const todas = ['ventas_fuera_armar', 'ventas_fuera_autorizar'].some((k) => puede(usuario, k));
  json(res, 200, {
    solo_mias: !todas,
    ordenes: db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.entrega, o.estado, o.fecha_solicitud, o.enviado_en,
             o.armado_en, o.documentado_en, o.cerrado_en, o.correccion_nota,
             s.nombre AS solicitante, a.nombre AS armo,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM vxf_renglones r WHERE r.orden_id = o.id) AS unidades,
             (SELECT COUNT(*) FROM vxf_cajas c WHERE c.orden_id = o.id) AS cajas
        FROM vxf_ordenes o
        JOIN usuarios s ON s.id = o.solicitante_id
        LEFT JOIN usuarios a ON a.id = o.armado_por
       ${todas ? '' : 'WHERE o.solicitante_id = ?'}
       ORDER BY o.id DESC LIMIT 300
    `).all(...(todas ? [] : [usuario.id])),
    entregas: ENTREGAS_VXF,
    hoy: hoyISO(),
  });
});

// Quien vende por fuera no entra a Almacén, así que el catálogo de productos y
// de cajas le llega por aquí.
ruta('GET', '/api/vxf/catalogo', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  if (!accesoVxf(usuario)) return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  const productos = productosActivos().map((x) => ({
    id: x.id, sku: x.sku, nombre: x.nombre, modelo: x.modelo, tipo_material: x.tipo_material,
    unidad: unidadDe(x.tipo_material), imagen: x.imagen || null,
  }));
  json(res, 200, {
    productos, cajas: productos.filter((x) => x.tipo_material === 'Cajas'), entregas: ENTREGAS_VXF,
    cobros: COBROS_VXF, formas_cobro: FORMAS_COBRO, hoy: hoyISO(),
    clientes: db.prepare('SELECT id, nombre, razon_social FROM vxf_clientes WHERE activo = 1 ORDER BY nombre').all(),
  });
});

// ------------------------------------------------ cartera de clientes
//
// Quien vende escoge al cliente de la cartera. Si no está, lo escribe y queda
// dado de alta en ese momento —«por revisar»— para que el encargado de la
// cartera lo vea y, si hace falta, lo corrija o lo una con uno que ya existía.
const limpiarNombreCliente = (x) => String(x || '').trim().replace(/\s+/g, ' ');

function clienteParaOrden(cuerpo, usuario) {
  if (cuerpo.cliente_id) {
    const c = db.prepare('SELECT * FROM vxf_clientes WHERE id = ?').get(Number(cuerpo.cliente_id));
    if (c) return { cliente: c, nuevo: false };
  }
  const nombre = limpiarNombreCliente(cuerpo.cliente);
  if (!nombre) return null;
  const existe = db.prepare('SELECT * FROM vxf_clientes WHERE nombre = ?').get(nombre);
  if (existe) return { cliente: existe, nuevo: false };
  const id = db.prepare(`
    INSERT INTO vxf_clientes (nombre, origen, revisado, creado_por, creado_en) VALUES (?, 'orden', 0, ?, ?)
  `).run(nombre, usuario.id, new Date().toISOString()).lastInsertRowid;
  return { cliente: db.prepare('SELECT * FROM vxf_clientes WHERE id = ?').get(Number(id)), nuevo: true };
}

ruta('GET', '/api/vxf/clientes', (req, res) => {
  if (!exigir(req, res, 'ventas_fuera_clientes')) return;
  json(res, 200, {
    clientes: db.prepare(`
      SELECT c.*, u.nombre AS creo,
             (SELECT COUNT(*) FROM vxf_ordenes o WHERE o.cliente_id = c.id) AS ordenes,
             (SELECT MAX(o.fecha_solicitud) FROM vxf_ordenes o WHERE o.cliente_id = c.id) AS ultima
        FROM vxf_clientes c LEFT JOIN usuarios u ON u.id = c.creado_por
       ORDER BY c.nombre`).all(),
  });
});

ruta('POST', '/api/vxf/clientes', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_clientes');
  if (!usuario) return;
  const nombre = limpiarNombreCliente(cuerpo.nombre);
  if (nombre.length < 2) return json(res, 400, { error: 'Escribe el nombre del cliente.' });
  if (db.prepare('SELECT 1 FROM vxf_clientes WHERE nombre = ?').get(nombre)) {
    return json(res, 409, { error: 'Ese cliente ya está en la cartera.' });
  }
  db.prepare(`INSERT INTO vxf_clientes (nombre, razon_social, origen, creado_por, creado_en) VALUES (?, ?, 'manual', ?, ?)`)
    .run(nombre, limpiarNombreCliente(cuerpo.razon_social) || null, usuario.id, new Date().toISOString());
  json(res, 200, { ok: true });
});

// Corregir un cliente corrige también el nombre en sus órdenes: es el mismo
// cliente, mal escrito. Guardarlo lo da por revisado.
ruta('PUT', '/api/vxf/clientes/(\\d+)', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'ventas_fuera_clientes')) return;
  const c = db.prepare('SELECT * FROM vxf_clientes WHERE id = ?').get(Number(p[1]));
  if (!c) return json(res, 404, { error: 'Ese cliente no existe.' });
  const nombre = cuerpo.nombre === undefined ? c.nombre : limpiarNombreCliente(cuerpo.nombre);
  if (nombre.length < 2) return json(res, 400, { error: 'Escribe el nombre del cliente.' });
  if (db.prepare('SELECT 1 FROM vxf_clientes WHERE nombre = ? AND id <> ?').get(nombre, c.id)) {
    return json(res, 409, { error: 'Ya hay otro cliente con ese nombre. Si son el mismo, úsalo en «Unir con…».' });
  }
  const razon = cuerpo.razon_social === undefined ? c.razon_social : (limpiarNombreCliente(cuerpo.razon_social) || null);
  const activo = cuerpo.activo === undefined ? c.activo : (cuerpo.activo ? 1 : 0);
  // Se escribe una vez y la traen solas todas las paradas de ese cliente.
  const direccion = cuerpo.direccion === undefined ? c.direccion
    : (String(cuerpo.direccion || '').trim() || null);
  db.prepare(`
    UPDATE vxf_clientes SET nombre = ?, razon_social = ?, direccion = ?, activo = ?, revisado = 1
     WHERE id = ?
  `).run(nombre, razon, direccion, activo, c.id);
  if (nombre !== c.nombre) db.prepare('UPDATE vxf_ordenes SET cliente = ? WHERE cliente_id = ?').run(nombre, c.id);
  json(res, 200, { ok: true });
});

// Dos clientes que son el mismo (uno se dio de alta con otra escritura): sus
// órdenes pasan al que se queda y el otro desaparece.
ruta('POST', '/api/vxf/clientes/(\\d+)/unir', (req, res, p, cuerpo) => {
  if (!exigir(req, res, 'ventas_fuera_clientes')) return;
  const sale = db.prepare('SELECT * FROM vxf_clientes WHERE id = ?').get(Number(p[1]));
  const queda = db.prepare('SELECT * FROM vxf_clientes WHERE id = ?').get(Number(cuerpo.con));
  if (!sale || !queda || sale.id === queda.id) return json(res, 400, { error: 'Escoge el cliente con el que se une.' });
  db.prepare('UPDATE vxf_ordenes SET cliente_id = ?, cliente = ? WHERE cliente_id = ?').run(queda.id, queda.nombre, sale.id);
  db.prepare('DELETE FROM vxf_clientes WHERE id = ?').run(sale.id);
  json(res, 200, { ok: true });
});

// La carga desde Excel: el archivo que se exporta de la plataforma de ventas
// (Nombre · Apellido · … · Razón Social …). Las columnas se buscan por su
// encabezado, no por su lugar. Solo agrega: lo que ya estaba no se toca, así que
// se puede volver a cargar el archivo completo cada vez que crezca.
ruta('POST', '/api/vxf/clientes/importar', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_clientes');
  if (!usuario) return;
  const binario = Buffer.from(String(cuerpo.archivo || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!binario.length) return json(res, 400, { error: 'No llegó el archivo.' });
  if (binario.length > 8 * 1024 * 1024) return json(res, 413, { error: 'El archivo pesa demasiado.' });
  let hoja;
  try { [hoja] = xlsx.abrir(binario); } catch (err) { return json(res, 400, { error: err.message }); }

  const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  let filaEnc = 0;
  const col = {};
  for (let f = 1; f <= Math.min(10, hoja.maxFila) && !filaEnc; f += 1) {
    for (let c = 1; c <= 40; c += 1) {
      let letras = ''; let n = c;
      while (n > 0) { letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras; n = Math.floor((n - 1) / 26); }
      const t = normal(hoja.valor(letras, f));
      if (t === 'nombre' || t === 'cliente' || t === 'nombrecliente') { col.nombre = letras; filaEnc = f; }
      if (t === 'apellido' || t === 'apellidos') col.apellido = letras;
      if (t === 'razonsocial') col.razon = letras;
    }
  }
  if (!filaEnc) return json(res, 400, { error: 'No encontré la columna «Nombre» en las primeras filas del archivo.' });

  const vacio = (v) => !v || /^[-–—.\s]*$/.test(v);
  const resumen = { nuevos: 0, ya_estaban: 0, repetidos_en_archivo: 0, sin_nombre: 0 };
  const vistos = new Set();
  const insertar = db.prepare(`
    INSERT INTO vxf_clientes (nombre, razon_social, origen, creado_por, creado_en) VALUES (?, ?, 'excel', ?, ?)`);
  db.exec('BEGIN');
  try {
    for (let f = filaEnc + 1; f <= hoja.maxFila; f += 1) {
      const partes = [hoja.valor(col.nombre, f), col.apellido && hoja.valor(col.apellido, f)].filter((v) => !vacio(v));
      const nombre = limpiarNombreCliente(partes.join(' '));
      if (!nombre) { resumen.sin_nombre += 1; continue; }
      const llave = nombre.toLowerCase();
      if (vistos.has(llave)) { resumen.repetidos_en_archivo += 1; continue; }
      vistos.add(llave);
      if (db.prepare('SELECT 1 FROM vxf_clientes WHERE nombre = ?').get(nombre)) { resumen.ya_estaban += 1; continue; }
      const razon = col.razon && hoja.valor(col.razon, f);
      insertar.run(nombre, vacio(razon) ? null : limpiarNombreCliente(razon), usuario.id, new Date().toISOString());
      resumen.nuevos += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    return json(res, 500, { error: 'No se pudo cargar la cartera.' });
  }
  json(res, 200, resumen);
});

ruta('POST', '/api/vxf/ordenes', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_capturar');
  if (!usuario) return;
  const entrega = ENTREGAS_VXF.some((e) => e.clave === cuerpo.entrega) ? cuerpo.entrega : null;
  if (!entrega) return json(res, 400, { error: 'Di si va con guía de paquetería o con nota de remisión.' });
  const elegido = clienteParaOrden(cuerpo, usuario);
  if (!elegido) return json(res, 400, { error: 'Escoge o escribe a qué cliente se entrega.' });

  const id = Number(db.prepare(`
    INSERT INTO vxf_ordenes (folio, solicitante_id, fecha_solicitud, cliente, cliente_id, entrega, notas,
                             cobro, monto_cobrar, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('VD', 'vxf_ordenes'), usuario.id, cuerpo.fecha || hoyISO(), elegido.cliente.nombre,
    elegido.cliente.id, entrega, String(cuerpo.notas || '').trim() || null,
    cuerpo.cobro === 'por_cobrar' ? 'por_cobrar' : 'pagada',
    cuerpo.cobro === 'por_cobrar' ? montoDeCobro(cuerpo.monto_cobrar) : null,
    new Date().toISOString()).lastInsertRowid);
  json(res, 201, { orden: ordenVxf(id), cliente_nuevo: elegido.nuevo });
});

ruta('GET', '/api/vxf/ordenes/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  if (!accesoVxf(usuario)) return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  const o = ordenVxf(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  // Quien solo vende no abre las órdenes de otro vendedor.
  if (!['ventas_fuera_armar', 'ventas_fuera_autorizar'].some((k) => puede(usuario, k)) && o.solicitante_id !== usuario.id) {
    return json(res, 403, { error: 'Esta orden es de otra persona.' });
  }
  const paso = { borrador: 'enviar', por_armar: 'armar', armada: 'documentar' }[o.estado];
  json(res, 200, { orden: o, faltantes: paso ? faltantesDeVxf(o, paso) : [], entregas: ENTREGAS_VXF });
});

// La orden solo se toca en el paso que le toca a cada quien.
function vxfEnPaso(req, res, id, estado, permiso) {
  if (!exigir(req, res, permiso)) return null;
  const o = db.prepare('SELECT * FROM vxf_ordenes WHERE id = ?').get(id);
  if (!o) { json(res, 404, { error: 'Orden no encontrada' }); return null; }
  if (o.estado !== estado) {
    json(res, 409, { error: 'Esta orden ya pasó de ese paso.' });
    return null;
  }
  return o;
}

ruta('PUT', '/api/vxf/ordenes/(\\d+)', (req, res, p, cuerpo) => {
  const o = vxfEnPaso(req, res, Number(p[1]), 'borrador', 'ventas_fuera_capturar');
  if (!o) return;
  const entrega = ENTREGAS_VXF.some((e) => e.clave === cuerpo.entrega) ? cuerpo.entrega : o.entrega;
  const elegido = (cuerpo.cliente !== undefined || cuerpo.cliente_id) ? clienteParaOrden(cuerpo, leerSesion(req)) : null;
  if (elegido) db.prepare('UPDATE vxf_ordenes SET cliente_id = ? WHERE id = ?').run(elegido.cliente.id, o.id);
  const cobro = cuerpo.cobro === undefined ? o.cobro : (cuerpo.cobro === 'por_cobrar' ? 'por_cobrar' : 'pagada');
  db.prepare(`
    UPDATE vxf_ordenes SET cliente = ?, entrega = ?, fecha_solicitud = ?, notas = ?, cobro = ?, monto_cobrar = ?
     WHERE id = ?
  `).run(
    elegido ? elegido.cliente.nombre : o.cliente, entrega, cuerpo.fecha || o.fecha_solicitud,
    String(cuerpo.notas ?? o.notas ?? '').trim() || null, cobro,
    cobro === 'por_cobrar'
      ? (cuerpo.monto_cobrar === undefined ? o.monto_cobrar : montoDeCobro(cuerpo.monto_cobrar))
      : null,
    o.id);
  json(res, 200, { orden: ordenVxf(o.id) });
});

ruta('POST', '/api/vxf/ordenes/(\\d+)/renglones', (req, res, p, cuerpo) => {
  const o = vxfEnPaso(req, res, Number(p[1]), 'borrador', 'ventas_fuera_capturar');
  if (!o) return;
  const productoId = Number(cuerpo.producto_id || 0);
  if (!db.prepare('SELECT id FROM almacen_productos WHERE id = ? AND activo = 1').get(productoId)) {
    return json(res, 400, { error: 'Escoge un producto del catálogo.' });
  }
  if (db.prepare('SELECT id FROM vxf_renglones WHERE orden_id = ? AND producto_id = ?').get(o.id, productoId)) {
    return json(res, 409, { error: 'Ese producto ya está en la orden. Cámbiale la cantidad.' });
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM vxf_renglones WHERE orden_id = ?').get(o.id).n;
  db.prepare('INSERT INTO vxf_renglones (orden_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?)')
    .run(o.id, productoId, Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))), orden);
  json(res, 201, { orden: ordenVxf(o.id) });
});

ruta('PUT', '/api/vxf/renglones/(\\d+)', (req, res, p, cuerpo) => {
  const r = db.prepare('SELECT * FROM vxf_renglones WHERE id = ?').get(Number(p[1]));
  if (!r) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!vxfEnPaso(req, res, r.orden_id, 'borrador', 'ventas_fuera_capturar')) return;
  db.prepare('UPDATE vxf_renglones SET cantidad = ? WHERE id = ?').run(Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))), r.id);
  json(res, 200, { orden: ordenVxf(r.orden_id) });
});

ruta('DELETE', '/api/vxf/renglones/(\\d+)', (req, res, p) => {
  const r = db.prepare('SELECT * FROM vxf_renglones WHERE id = ?').get(Number(p[1]));
  if (!r) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!vxfEnPaso(req, res, r.orden_id, 'borrador', 'ventas_fuera_capturar')) return;
  db.prepare('DELETE FROM vxf_renglones WHERE id = ?').run(r.id);
  json(res, 200, { orden: ordenVxf(r.orden_id) });
});

// Las cajas se anotan todas de una vez: cuántas, modelo y peso de cada una.
ruta('PUT', '/api/vxf/ordenes/(\\d+)/cajas', (req, res, p, cuerpo) => {
  const o = vxfEnPaso(req, res, Number(p[1]), 'por_armar', 'ventas_fuera_armar');
  if (!o) return;
  const cajas = Array.isArray(cuerpo.cajas) ? cuerpo.cajas : [];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM vxf_cajas WHERE orden_id = ?').run(o.id);
    const alta = db.prepare('INSERT INTO vxf_cajas (orden_id, producto_id, peso_kg, orden) VALUES (?, ?, ?, ?)');
    cajas.forEach((c, i) => {
      const productoId = Number((c || {}).producto_id || 0) || null;
      const peso = Number(String((c || {}).peso_kg ?? '').replace(',', '.'));
      alta.run(o.id, productoId, Number.isFinite(peso) && peso > 0 ? Math.round(peso * 1000) / 1000 : null, i);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { orden: ordenVxf(o.id) });
});

// Avanzar un paso: enviar (quien vende) → armada (quien arma) → documentada
// (quien vende) → terminada (el encargado).
const PASOS_VXF = {
  enviar: { desde: 'borrador', hacia: 'por_armar', permiso: 'ventas_fuera_capturar',
    columnas: 'enviado_en = ?', mensaje: 'Orden mandada a armar. Le llega a quien arma.' },
  armada: { desde: 'por_armar', hacia: 'armada', permiso: 'ventas_fuera_armar', paso: 'armar',
    columnas: 'armado_en = ?, armado_por = ?', mensaje: 'Orden armada. Le llega a quien vende para hacer la guía o la nota.' },
  documentada: { desde: 'armada', hacia: 'documentada', permiso: 'ventas_fuera_capturar', paso: 'documentar',
    columnas: 'documentado_en = ?, documentado_por = ?', mensaje: 'Guía o nota cargada. Le llega al encargado para cerrarla.' },
  terminar: { desde: 'documentada', hacia: 'terminada', permiso: 'ventas_fuera_autorizar',
    columnas: 'cerrado_en = ?, cerrado_por = ?', mensaje: 'Orden terminada.' },
};

// Lo que le falta a una orden por cobrar para poder cerrarse. Una venta a cobrar
// no termina cuando sale el paquete: termina cuando el dinero regresó y alguien
// más confirmó que llegó completo.
function faltaDelCobro(o) {
  if (o.cobro !== 'por_cobrar') return null;
  if (!o.cobro_entregado_en) {
    return `Esta venta es por cobrar (${pesosMX(o.monto_cobrar)}). Quien entregó tiene que anotar el dinero que recibió, con su evidencia.`;
  }
  if (!o.cobro_confirmado_en) {
    return 'El dinero ya se anotó, pero falta que un Team Leader confirme que llegó completo.';
  }
  return null;
}

const pesosMX = (n) => (n === null || n === undefined
  ? '—'
  : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

ruta('POST', '/api/vxf/ordenes/(\\d+)/(enviar|armada|documentada|terminar)', (req, res, p) => {
  const paso = PASOS_VXF[p[2]];
  const base = vxfEnPaso(req, res, Number(p[1]), paso.desde, paso.permiso);
  if (!base) return;
  const usuario = exigir(req, res, paso.permiso);
  const o = ordenVxf(base.id);
  const faltas = faltantesDeVxf(o, paso.paso || (p[2] === 'enviar' ? 'enviar' : null));
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });
  if (p[2] === 'terminar') {
    const falta = faltaDelCobro(o);
    if (falta) return json(res, 409, { error: falta });
  }

  const ahora = new Date().toISOString();
  const valores = paso.columnas.includes('_por') ? [ahora, usuario.id] : [ahora];
  db.prepare(`
    UPDATE vxf_ordenes SET estado = ?, ${paso.columnas},
           correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
     WHERE id = ?
  `).run(paso.hacia, ...valores, o.id);
  json(res, 200, { orden: ordenVxf(o.id), mensaje: paso.mensaje });
});

// --- el dinero de una venta por cobrar ---
//
// Dos pasos y dos personas, como todo lo que tiene consecuencia en esta
// plataforma: quien entregó anota lo que recibió y sube la evidencia; un Team
// Leader confirma que llegó completo. Hasta entonces la orden no se cierra.

ruta('POST', '/api/vxf/ordenes/(\\d+)/cobro', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_cobrar');
  if (!usuario) return;
  const o = ordenVxf(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  if (o.cobro !== 'por_cobrar') return json(res, 409, { error: 'Esta venta no es por cobrar.' });
  if (!['documentada', 'terminada'].includes(o.estado)) {
    return json(res, 409, { error: 'El dinero se anota cuando la orden ya salió con su guía o su nota.' });
  }
  if (o.cobro_confirmado_en) return json(res, 409, { error: 'Ese cobro ya lo confirmó un Team Leader.' });

  const recibido = montoDeCobro(cuerpo.recibido);
  if (recibido === null) return json(res, 400, { error: 'Anota cuánto dinero te entregaron.' });
  const forma = String(cuerpo.forma || '').trim();
  if (!FORMAS_COBRO.includes(forma)) return json(res, 400, { error: 'Di cómo te pagaron.' });
  const nota = String(cuerpo.nota || '').trim();
  // Si volvió con menos de lo que se iba a cobrar, hay que decir por qué: es el
  // renglón que alguien va a tener que explicar a fin de mes.
  if (o.monto_cobrar && recibido < o.monto_cobrar && nota.length < 5) {
    return json(res, 400, {
      error: `Se iban a cobrar ${pesosMX(o.monto_cobrar)} y traes ${pesosMX(recibido)}. Escribe qué pasó.`,
    });
  }
  if (!fotosDeDocumento('vxf_cobro', o.id).length) {
    return json(res, 400, { error: 'Sube la foto del dinero o del comprobante de la transferencia.' });
  }

  db.prepare(`
    UPDATE vxf_ordenes SET cobro_recibido = ?, cobro_forma = ?, cobro_nota = ?,
           cobro_entregado_por = ?, cobro_entregado_en = ?
     WHERE id = ?
  `).run(recibido, forma, nota || null, usuario.id, new Date().toISOString(), o.id);
  json(res, 200, {
    orden: ordenVxf(o.id),
    mensaje: 'Dinero anotado. Falta que un Team Leader confirme que llegó completo.',
  });
});

ruta('POST', '/api/vxf/ordenes/(\\d+)/cobro-confirmar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_autorizar');
  if (!usuario) return;
  const o = ordenVxf(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  if (o.cobro !== 'por_cobrar') return json(res, 409, { error: 'Esta venta no es por cobrar.' });
  if (!o.cobro_entregado_en) return json(res, 409, { error: 'Todavía nadie ha anotado el dinero.' });
  if (o.cobro_confirmado_en) return json(res, 409, { error: 'Ese cobro ya está confirmado.' });
  // Quien entregó no confirma su propio dinero: es la misma regla de dos
  // personas que ya rige las entradas, las salidas y los conteos.
  if (usuario.rol !== 'admin' && o.cobro_entregado_por === usuario.id) {
    return json(res, 409, { error: 'Tú entregaste y anotaste este dinero. Lo confirma otra persona.' });
  }

  db.prepare('UPDATE vxf_ordenes SET cobro_confirmado_por = ?, cobro_confirmado_en = ?, cobro_nota = COALESCE(?, cobro_nota) WHERE id = ?')
    .run(usuario.id, new Date().toISOString(), String(cuerpo.nota || '').trim() || null, o.id);
  json(res, 200, { orden: ordenVxf(o.id), mensaje: 'Cobro confirmado. La orden ya se puede cerrar.' });
});

// Devolver el cobro a quien entregó: cuando lo anotado no cuadra con lo que hay.
ruta('POST', '/api/vxf/ordenes/(\\d+)/cobro-regresar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_autorizar');
  if (!usuario) return;
  const o = ordenVxf(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  if (!o.cobro_entregado_en || o.cobro_confirmado_en) {
    return json(res, 409, { error: 'Ese cobro no está esperando confirmación.' });
  }
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;
  db.prepare(`
    UPDATE vxf_ordenes SET cobro_entregado_en = NULL, cobro_entregado_por = NULL,
           cobro_nota = ? WHERE id = ?
  `).run(`Regresado por ${usuario.nombre}: ${nota}`, o.id);
  json(res, 200, { orden: ordenVxf(o.id), mensaje: 'Cobro regresado a quien entregó.' });
});

// Regresar un paso con nota: al que armó si las cajas están mal, a quien vende
// si falta la guía o la orden trae algo mal.
const REGRESO_VXF = { por_armar: 'borrador', armada: 'por_armar', documentada: 'armada' };

ruta('POST', '/api/vxf/ordenes/(\\d+)/regresar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'ventas_fuera_autorizar');
  if (!usuario) return;
  const o = db.prepare('SELECT * FROM vxf_ordenes WHERE id = ?').get(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  const hacia = REGRESO_VXF[o.estado];
  if (!hacia) return json(res, 409, { error: 'Esta orden no se puede regresar desde donde está.' });
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;
  db.prepare(`
    UPDATE vxf_ordenes SET estado = ?, correccion_nota = ?, correccion_por = ?, correccion_en = ? WHERE id = ?
  `).run(hacia, nota, usuario.id, new Date().toISOString(), o.id);
  anotarCorreccion('vxf', o.id, o.folio, o.estado, nota, usuario.id);
  json(res, 200, { orden: ordenVxf(o.id), mensaje: 'Orden regresada un paso, con tu nota.' });
});

// Una orden terminada se puede reabrir: vuelve al paso anterior —documentada—
// con el motivo escrito, y de ahí se corrige y se vuelve a terminar. El cobro
// se queda como estaba; al terminarla otra vez se vuelve a exigir completo.
ruta('POST', '/api/vxf/ordenes/(\\d+)/reabrir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'reabrir_cerrados');
  if (!usuario) return;
  const o = db.prepare('SELECT * FROM vxf_ordenes WHERE id = ?').get(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  if (o.estado !== 'terminada') return json(res, 409, { error: 'Esa orden no está terminada.' });
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;

  db.prepare(`
    UPDATE vxf_ordenes SET estado = 'documentada', cerrado_en = NULL, cerrado_por = NULL,
           correccion_nota = ?, correccion_por = ?, correccion_en = ? WHERE id = ?
  `).run(nota, usuario.id, new Date().toISOString(), o.id);
  anotarCorreccion('vxf', o.id, o.folio, o.estado, nota, usuario.id);
  json(res, 200, {
    orden: ordenVxf(o.id),
    mensaje: 'Orden reabierta con tu nota. Se corrige y se vuelve a cerrar.',
  });
});

ruta('POST', '/api/vxf/ordenes/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const o = db.prepare('SELECT * FROM vxf_ordenes WHERE id = ?').get(Number(p[1]));
  if (!o) return json(res, 404, { error: 'Orden no encontrada' });
  // La cancela quien la levantó mientras no se mande, o el encargado siempre.
  const suyaEnBorrador = o.estado === 'borrador' && o.solicitante_id === usuario.id;
  if (!puede(usuario, 'ventas_fuera_autorizar') && !suyaEnBorrador) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  if (['terminada', 'cancelada'].includes(o.estado)) return json(res, 409, { error: 'Esta orden ya está cerrada.' });
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué la cancelas. Queda registrado.' });
  db.prepare("UPDATE vxf_ordenes SET estado = 'cancelada', notas = ? WHERE id = ?")
    .run(`${o.notas ? o.notas + ' · ' : ''}Cancelada: ${motivo}`, o.id);
  json(res, 200, { ok: true });
});


// El reporte de Ventas directas: cada orden con el tiempo de cada paso, las
// cajas y el peso, y lo que no coincidió contra lo que salió de Almacén.
// Lo que se cobró y lo que falta por cobrar, para el reporte y la portada.
const resumenCobros = (desde, hasta) => db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN cobro = 'por_cobrar' THEN 1 ELSE 0 END), 0) AS ordenes,
    COALESCE(SUM(CASE WHEN cobro = 'por_cobrar' THEN monto_cobrar ELSE 0 END), 0) AS a_cobrar,
    COALESCE(SUM(CASE WHEN cobro = 'por_cobrar' THEN cobro_recibido ELSE 0 END), 0) AS cobrado,
    COALESCE(SUM(CASE WHEN cobro = 'por_cobrar' AND cobro_confirmado_en IS NULL THEN 1 ELSE 0 END), 0) AS sin_confirmar
  FROM vxf_ordenes
 WHERE estado <> 'cancelada' AND fecha_solicitud >= ? AND fecha_solicitud <= ?
`).get(desde, hasta);

ruta('GET', '/api/vxf/reportes', (req, res) => {
  if (!exigir(req, res, 'ventas_fuera_reportes')) return;
  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const hasta = fecha(url.searchParams.get('hasta')) || hoyISO();
  const hace28 = new Date();
  hace28.setDate(hace28.getDate() - 27);
  const desde = fecha(url.searchParams.get('desde')) || hoyISO(hace28);
  const minutos = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);
  const promedio = (l) => (l.length ? Math.round(l.reduce((n, v) => n + v, 0) / l.length) : null);

  const ordenes = db.prepare(`
    SELECT o.id FROM vxf_ordenes o WHERE o.fecha_solicitud BETWEEN ? AND ? AND o.estado <> 'cancelada'
     ORDER BY o.fecha_solicitud DESC, o.id DESC
  `).all(desde, hasta).map((f) => {
    const o = ordenVxf(f.id);
    return {
      id: o.id, folio: o.folio, cliente: o.cliente, entrega: o.entrega, estado: o.estado,
      fecha_solicitud: o.fecha_solicitud, solicitante: o.solicitante, armo: o.armo, cerro: o.cerro,
      unidades: o.renglones.reduce((n, r) => n + r.cantidad, 0),
      cajas: o.cajas.length, peso_total: o.peso_total,
      min_armado: minutos(o.enviado_en, o.armado_en),
      min_guia: minutos(o.armado_en, o.documentado_en),
      min_cierre: minutos(o.documentado_en, o.cerrado_en),
      min_total: minutos(o.enviado_en, o.cerrado_en),
      diferencias: o.diferencias.filter((d) => d.diferencia),
      salidas: o.salidas.map((x) => x.folio),
      cobro: o.cobro,
      monto_cobrar: o.monto_cobrar,
      cobro_recibido: o.cobro_recibido,
      cobro_forma: o.cobro_forma,
      cobro_confirmado_en: o.cobro_confirmado_en,
      cobro_entrego: o.cobro_entrego,
    };
  });

  const cajasPorModelo = new Map();
  for (const f of db.prepare(`
    SELECT p.nombre AS modelo, COUNT(*) AS cajas, COALESCE(SUM(c.peso_kg), 0) AS peso
      FROM vxf_cajas c JOIN vxf_ordenes o ON o.id = c.orden_id
      LEFT JOIN almacen_productos p ON p.id = c.producto_id
     WHERE o.fecha_solicitud BETWEEN ? AND ? AND o.estado <> 'cancelada'
     GROUP BY c.producto_id ORDER BY cajas DESC
  `).all(desde, hasta)) cajasPorModelo.set(f.modelo || 'Sin modelo', f);

  json(res, 200, {
    desde, hasta,
    resumen: {
      ordenes: ordenes.length,
      terminadas: ordenes.filter((o) => o.estado === 'terminada').length,
      abiertas: ordenes.filter((o) => o.estado !== 'terminada').length,
      cajas: ordenes.reduce((n, o) => n + o.cajas, 0),
      peso: Math.round(ordenes.reduce((n, o) => n + o.peso_total, 0) * 100) / 100,
      con_diferencias: ordenes.filter((o) => o.diferencias.length).length,
      sin_salida: ordenes.filter((o) => ['armada', 'documentada', 'terminada'].includes(o.estado) && !o.salidas.length).length,
      promedio_armado: promedio(ordenes.map((o) => o.min_armado).filter((v) => v !== null)),
      promedio_guia: promedio(ordenes.map((o) => o.min_guia).filter((v) => v !== null)),
      promedio_total: promedio(ordenes.map((o) => o.min_total).filter((v) => v !== null)),
      cobros: resumenCobros(desde, hasta),
    },
    ordenes,
    cajas: [...cajasPorModelo.values()],
    clientes: [...ordenes.reduce((m, o) => {
      const f = m.get(o.cliente) || { cliente: o.cliente, ordenes: 0, unidades: 0 };
      f.ordenes++; f.unidades += o.unidades; m.set(o.cliente, f); return m;
    }, new Map()).values()].sort((a, b) => b.ordenes - a.ordenes),
  });
});

// ------------------------------------------------------------------ almacén

// El módulo entero descansa en una sola idea: la existencia de un producto en
// una bodega es la suma de sus movimientos. No hay ninguna tabla de existencias
// que alguien pueda editar. En el Excel, INVENTARIO era una hoja de fórmulas
// SUMIF sobre rangos fijos ($C$6:$C$2005): al llegar al renglón 2000 empezaba a
// perder movimientos en silencio, y cualquiera podía escribir un número encima
// de una fórmula. Aquí se recalcula al momento de pedirlo y no hay dónde pisar.

const PLATAFORMAS_RETIRO = ['Mercado Libre Full', 'Amazon FBA'];

// El traspaso NO está aquí a propósito. Mover material entre bodegas es otra
// cosa que sacarlo de la empresa: no se surte contra nada, no sale del
// inventario —cambia de lugar dentro de él— y casi siempre nace de la ODT.
// Tiene su propia puerta en Almacén; dejarlo también aquí serían dos.
// Los dos tipos de salida que existen: todo lo que sale, sale vendido. Uno va
// dentro de la ODT de la semana y el otro por fuera de ella; no hay un tercero,
// y ya no hay «otro motivo» — era el cajón donde terminaba lo que nadie quería
// explicar.
const MOTIVOS_SALIDA = [
  { clave: 'odt', etiqueta: 'Envío de ventas por la ODT' },
  { clave: 'ventas_fuera', etiqueta: 'Envío de ventas directas' },
];

// Motivos que existen en la base pero no se escogen desde la lista de Almacén:
// el traspaso tiene su propia pantalla, la salida por calidad nace en Calidad, y
// 'otro' quedó de antes y se conserva solo para poder nombrar lo ya capturado.
const MOTIVOS_APARTE = [
  { clave: 'traspaso', etiqueta: 'Traspaso entre bodegas' },
  { clave: 'calidad', etiqueta: 'Salida de material por calidad' },
  { clave: 'otro', etiqueta: 'Otro motivo (de antes)' },
];

const ETIQUETA_MOTIVO = Object.fromEntries(
  [...MOTIVOS_SALIDA, ...MOTIVOS_APARTE].map((m) => [m.clave, m.etiqueta])
);

// Cada motivo de salida tiene sus dos permisos. Un traspaso no lo captura quien
// captura salidas, y una salida por calidad no la aprueba quien aprueba envíos:
// son documentos distintos aunque por debajo sean la misma tabla.
const PERMISOS_SALIDA = {
  traspaso: { capturar: 'traspasos_capturar', aprobar: 'traspasos_aprobar', corregir: 'traspasos_regresar' },
  calidad: { capturar: 'calidad_salida_pedir', aprobar: 'calidad_salida_aprobar', corregir: 'calidad_salida_aprobar' },
  venta: { capturar: 'salidas_capturar', aprobar: 'salidas_aprobar', corregir: 'salidas_corregir' },
};

const permisoSalida = (motivo, accion) =>
  (PERMISOS_SALIDA[motivo] || PERMISOS_SALIDA.venta)[accion];

// La lista de CEDIS es una sola para todo el sistema: la que el Administrador
// edita en Configuración → Tránsito. Un envío por la ODT y una devolución del
// CEDIS hablan de los mismos lugares, y tener dos listas era garantizar que un
// día dejaran de coincidir.
const cedisActivos = () => db
  .prepare('SELECT nombre FROM transito_cedis WHERE activo = 1 ORDER BY orden, id')
  .all().map((f) => f.nombre);

// Sigue siendo un motivo válido en la base —los traspasos son salidas con
// bodega destino— pero se captura por su propia pantalla, no escogiéndolo de la
// lista de arriba.
const MOTIVO_TRASPASO = 'traspaso';

const ORIGENES_RECHAZO = [
  { clave: 'cedis', etiqueta: 'Rechazo del CEDIS' },
  { clave: 'cliente', etiqueta: 'Rechazo del cliente' },
];

// Cuánto puede desviarse un conteo de lo teórico antes de exigir explicación.
// Debajo de esto un descuadre es merma normal; encima, alguien tiene que
// escribir qué pasó. En papel no había ningún umbral: se corregía y ya.
const TOLERANCIA_CONTEO = 0.02;

// --- existencias ---

// Las dos mitades del libro mayor: lo que suma en destino y lo que resta en
// origen. Todo cálculo de existencia sale de aquí, así que el signo se decide
// en un solo lugar y no en cada consulta.
const MOVIMIENTOS_CON_SIGNO = `
  SELECT producto_id, bodega_destino_id AS bodega_id,  cantidad AS delta, fecha
    FROM almacen_movimientos WHERE bodega_destino_id IS NOT NULL
  UNION ALL
  SELECT producto_id, bodega_origen_id  AS bodega_id, -cantidad AS delta, fecha
    FROM almacen_movimientos WHERE bodega_origen_id IS NOT NULL
`;

// Existencia por producto y bodega. 'hasta' permite preguntar cómo estaba el
// inventario en una fecha, que es lo que necesita un conteo para congelar
// contra qué se contó.
function existenciasPorBodega({ hasta = null } = {}) {
  const filtro = hasta ? 'WHERE fecha <= ?' : '';
  const filas = db.prepare(`
    SELECT producto_id, bodega_id, SUM(delta) AS existencia
      FROM (${MOVIMIENTOS_CON_SIGNO}) ${filtro}
     GROUP BY producto_id, bodega_id
  `).all(...(hasta ? [hasta] : []));

  const mapa = new Map();
  for (const f of filas) {
    if (!mapa.has(f.producto_id)) mapa.set(f.producto_id, new Map());
    mapa.get(f.producto_id).set(f.bodega_id, f.existencia);
  }
  return mapa;
}

// La existencia de un producto en una bodega, sola. Es la que consulta una
// salida para no dejar sacar más de lo que hay.
function existenciaDe(productoId, bodegaId, { hasta = null } = {}) {
  const filtro = hasta ? 'AND fecha <= ?' : '';
  const fila = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) AS n
      FROM (${MOVIMIENTOS_CON_SIGNO})
     WHERE producto_id = ? AND bodega_id = ? ${filtro}
  `).get(productoId, bodegaId, ...(hasta ? [hasta] : []));
  return fila.n;
}

const bodegasActivas = () => db
  .prepare('SELECT id, clave, nombre, arma_odt FROM almacen_bodegas WHERE activo = 1 ORDER BY orden, clave')
  .all();

// ------------------------------------------------ existencia inicial
//
// El punto de partida del inventario: lo que hay en cada bodega el día que se
// empieza a llevar en la plataforma. Se carga desde un Excel (o un CSV) con un
// renglón por producto y una columna por bodega —la plantilla se descarga de
// aquí mismo—. Primero se revisa y se enseña qué se va a cargar; luego se aplica.
// Si ya había una carga inicial, aplicarla la REEMPLAZA completa: la existencia
// es la suma de los movimientos, y dos cargas iniciales la duplicarían.
const normalTexto = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function leerTablaSubida(cuerpo) {
  const binario = Buffer.from(String(cuerpo.archivo || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!binario.length) throw new Error('No llegó el archivo.');
  if (binario.length > 8 * 1024 * 1024) throw new Error('El archivo pesa demasiado.');
  // Un .xlsx es un ZIP: empieza con «PK». Todo lo demás se lee como CSV.
  if (binario[0] === 0x50 && binario[1] === 0x4b) {
    const [hoja] = xlsx.abrir(binario);
    const filas = [];
    for (let f = 1; f <= hoja.maxFila; f += 1) {
      const fila = [];
      for (let c = 1; c <= 40; c += 1) {
        let letras = ''; let n = c;
        while (n > 0) { letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras; n = Math.floor((n - 1) / 26); }
        fila.push(hoja.valor(letras, f) ?? '');
      }
      filas.push(fila);
    }
    return filas;
  }
  let texto = binario.toString('utf8');
  if (texto.includes('\uFFFD')) texto = binario.toString('latin1');
  texto = texto.replace(/^\uFEFF/, '');
  const primera = texto.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].sort((x, y) => primera.split(y).length - primera.split(x).length)[0];
  const filas = [];
  let fila = []; let celda = ''; let comillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i += 1; } else if (ch === '"') comillas = false; else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; } else if (ch === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; } else if (ch !== '\r') celda += ch;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

function revisarCargaInicial(cuerpo) {
  const filas = leerTablaSubida(cuerpo);
  const bodegas = bodegasActivas();
  let enc = -1;
  const col = { bodegas: new Map() };
  for (let f = 0; f < Math.min(15, filas.length) && enc < 0; f += 1) {
    const cabeza = filas[f].map(normalTexto);
    const sku = cabeza.findIndex((t) => t === 'sku' || t === 'clave' || t === 'codigo');
    const nombre = cabeza.findIndex((t) => t === 'producto' || t === 'nombre' || t === 'descripcion');
    const modelo = cabeza.findIndex((t) => t === 'modelo');
    if (sku < 0 && nombre < 0 && modelo < 0) continue;
    enc = f; col.sku = sku; col.nombre = nombre; col.modelo = modelo;
    cabeza.forEach((t, i) => {
      if (!t) return;
      const b = bodegas.find((x) => t === normalTexto(x.clave) || t.startsWith(normalTexto(x.clave))
        || t.includes(normalTexto(x.nombre)));
      if (b && ![sku, nombre, modelo].includes(i)) col.bodegas.set(i, b);
    });
  }
  if (enc < 0) throw new Error('No encontré la fila de encabezados: el archivo necesita una columna «SKU», «Producto» o «Modelo».');
  if (!col.bodegas.size) {
    throw new Error(`No encontré columnas de bodega. Pon una columna por bodega con su clave o su nombre: ${bodegas.map((b) => `${b.clave} ${b.nombre}`).join(', ')}.`);
  }

  const productos = db.prepare('SELECT id, sku, nombre, modelo FROM almacen_productos').all();
  const porSku = new Map(productos.map((p) => [normalTexto(p.sku), p]));
  const porNombre = new Map(productos.map((p) => [normalTexto(p.nombre), p]));
  const porModelo = new Map();
  for (const p of productos) {
    const k = normalTexto(p.modelo);
    porModelo.set(k, porModelo.has(k) ? null : p); // un modelo repetido no identifica a nadie
  }
  const numeroDe = (v) => {
    const t = String(v ?? '').replace(/[,\s]/g, '');
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  };

  const cantidades = new Map(); // producto_id -> Map(bodega_id -> cantidad)
  const sinCatalogo = [];
  const malos = [];
  let renglones = 0;
  for (let f = enc + 1; f < filas.length; f += 1) {
    const fila = filas[f];
    const t = (i) => (i >= 0 ? String(fila[i] ?? '').trim() : '');
    if (!fila.some((c) => String(c ?? '').trim())) continue;
    const p = (col.sku >= 0 && porSku.get(normalTexto(t(col.sku))))
      || (col.nombre >= 0 && porNombre.get(normalTexto(t(col.nombre))))
      || (col.modelo >= 0 && porModelo.get(normalTexto(t(col.modelo))));
    const algo = [...col.bodegas.keys()].some((i) => numeroDe(fila[i]));
    if (!p) { if (algo) sinCatalogo.push(`Fila ${f + 1}: ${t(col.sku) || t(col.nombre) || t(col.modelo)}`); continue; }
    renglones += 1;
    for (const [i, b] of col.bodegas) {
      const n = numeroDe(fila[i]);
      if (Number.isNaN(n)) { malos.push(`Fila ${f + 1}, ${b.clave}: «${fila[i]}» no es un número`); continue; }
      if (!n) continue;
      if (!cantidades.has(p.id)) cantidades.set(p.id, new Map());
      const m = cantidades.get(p.id);
      m.set(b.id, (m.get(b.id) || 0) + n);
    }
  }

  const totales = bodegas.map((b) => ({
    id: b.id, clave: b.clave, nombre: b.nombre, en_archivo: [...col.bodegas.values()].some((x) => x.id === b.id),
    unidades: [...cantidades.values()].reduce((s, m) => s + (m.get(b.id) || 0), 0),
    productos: [...cantidades.values()].filter((m) => m.get(b.id)).length,
  }));
  const previa = db.prepare(`
    SELECT COUNT(*) AS movimientos, COALESCE(SUM(cantidad), 0) AS unidades, MIN(fecha) AS fecha
      FROM almacen_movimientos WHERE origen_tipo = 'carga_inicial'`).get();
  const otros = db.prepare("SELECT COUNT(*) AS n FROM almacen_movimientos WHERE COALESCE(origen_tipo, '') <> 'carga_inicial'").get().n;
  const negativos = [...cantidades.entries()].filter(([, m]) => [...m.values()].some((n) => n < 0)).length;
  return {
    cantidades, renglones, sin_catalogo: sinCatalogo, malos, totales, negativos,
    previa: previa.movimientos ? previa : null, otros_movimientos: otros,
  };
}

const resumenCarga = (r) => ({
  renglones: r.renglones, productos: r.cantidades.size, totales: r.totales, sin_catalogo: r.sin_catalogo,
  malos: r.malos, negativos: r.negativos, previa: r.previa, otros_movimientos: r.otros_movimientos,
});

ruta('GET', '/api/almacen/carga-inicial/plantilla', (req, res) => {
  if (!exigir(req, res, 'almacen_carga_inicial')) return;
  const bodegas = bodegasActivas();
  const existencias = existenciasPorBodega();
  const filas = [['SKU', 'Producto', 'Modelo', 'Tipo', ...bodegas.map((b) => `${b.clave} ${b.nombre}`)]];
  for (const p of db.prepare('SELECT * FROM almacen_productos WHERE activo = 1 ORDER BY tipo_material, orden, nombre').all()) {
    const m = existencias.get(p.id) || new Map();
    filas.push([p.sku, p.nombre, p.modelo || '', p.tipo_material, ...bodegas.map((b) => m.get(b.id) || 0)]);
  }
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="existencia-inicial-${hoyISO()}.csv"`,
  });
  res.end('\uFEFF' + csv);
});

ruta('POST', '/api/almacen/carga-inicial/revisar', (req, res, _p, cuerpo) => {
  if (!exigir(req, res, 'almacen_carga_inicial')) return;
  try { json(res, 200, resumenCarga(revisarCargaInicial(cuerpo))); }
  catch (err) { json(res, 400, { error: err.message }); }
});

ruta('POST', '/api/almacen/carga-inicial/aplicar', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'almacen_carga_inicial');
  if (!usuario) return;
  let r;
  try { r = revisarCargaInicial(cuerpo); } catch (err) { return json(res, 400, { error: err.message }); }
  if (r.malos.length) return json(res, 400, { error: `Hay cantidades que no son números: ${r.malos.slice(0, 3).join(' · ')}` });
  if (!r.cantidades.size) return json(res, 400, { error: 'El archivo no trae ninguna cantidad.' });
  if (r.previa && !cuerpo.reemplazar) {
    return json(res, 409, { error: 'Ya hay una existencia inicial cargada. Confirma que la quieres reemplazar.' });
  }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || '') ? cuerpo.fecha : hoyISO();
  if (fecha > hoyISO()) return json(res, 400, { error: 'La fecha de la existencia no puede ser futura.' });
  const semana = semanaISO(new Date(`${fecha}T12:00:00`));
  const nota = String(cuerpo.nota || '').trim() || `Existencia inicial al ${fecha}, cargada por ${usuario.nombre}.`;
  const ahora = new Date().toISOString();
  const insertar = db.prepare(`
    INSERT INTO almacen_movimientos
      (fecha, semana, tipo, producto_id, bodega_origen_id, bodega_destino_id,
       cantidad, referencia, origen_tipo, usuario_id, notas, creado_en)
    VALUES (?, ?, 'ajuste', ?, ?, ?, ?, 'CARGA INICIAL', 'carga_inicial', ?, ?, ?)`);
  let movimientos = 0;
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM almacen_movimientos WHERE origen_tipo = 'carga_inicial'").run();
    for (const [productoId, porBodega] of r.cantidades) {
      for (const [bodegaId, n] of porBodega) {
        // Una existencia negativa se carga tal cual: es un dato del que hay que
        // enterarse, no uno que convenga redondear a cero.
        const sube = n > 0;
        insertar.run(fecha, semana, productoId, sube ? null : bodegaId, sube ? bodegaId : null,
          Math.abs(n), usuario.id, nota, ahora);
        movimientos += 1;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    return json(res, 500, { error: 'No se pudo aplicar la carga.' });
  }
  json(res, 200, { ok: true, movimientos, ...resumenCarga(r), previa: null });
});

// La imagen de un producto: la suya si la tiene (el empaque); si no, la del
// material de Calidad contra el que se muestrea.
const productosActivos = () => db.prepare(`
  SELECT p.*, m.modelo AS modelo_calidad, COALESCE(p.imagen, m.imagen) AS imagen
    FROM almacen_productos p
    LEFT JOIN materiales m ON m.id = p.material_id
   WHERE p.activo = 1 ORDER BY p.orden, p.nombre
`).all();

// En qué se cuenta cada familia de producto. Un reporte que dice «4 500» sin
// decir de qué obliga a adivinar si son rollos, cajas o piezas, y en INKO las
// tres cosas se mueven el mismo día. Sale del tipo de material porque es lo que
// el catálogo ya distingue: los rollos y las etiquetas se venden y se cuentan por
// rollo, las cajas por caja, y el resto por pieza.
const UNIDAD_POR_TIPO = {
  'Cajas': 'cajas',
  'Rollos Térmicos': 'rollos',
  'Rollos Papel': 'rollos',
  'Etiquetas Térmicas': 'rollos',
  'Etiquetas Compatibles Brother': 'rollos',
  'Portarollos': 'piezas',
  'Material Empaque': 'piezas',
};
const unidadDe = (tipoMaterial) => UNIDAD_POR_TIPO[tipoMaterial] || 'piezas';

// El semáforo de la columna M de INVENTARIO, con la misma regla del Excel:
// bajo es estar dentro del 20% por encima del mínimo. Se calcula aquí y no en
// la pantalla para que el reporte y el tablero digan exactamente lo mismo.
function estadoDeExistencia(total, minimo) {
  if (total <= 0) return 'sin_stock';
  if (minimo > 0 && total < minimo) return 'critico';
  if (minimo > 0 && total < minimo * 1.2) return 'bajo';
  return 'ok';
}

// La hoja INVENTARIO completa: un renglón por producto con su existencia en
// cada bodega, el total y el semáforo.
function inventario() {
  const bodegas = bodegasActivas();
  const saldos = existenciasPorBodega();
  return productosActivos().map((p) => {
    const porBodega = saldos.get(p.id) || new Map();
    const detalle = {};
    let total = 0;
    for (const b of bodegas) {
      const n = porBodega.get(b.id) || 0;
      detalle[b.clave] = n;
      total += n;
    }
    return {
      id: p.id,
      sku: p.sku,
      modelo: p.modelo,
      tipo_material: p.tipo_material,
      unidad: unidadDe(p.tipo_material),
      nombre: p.nombre,
      especial: !!p.especial,
      subagrupador: p.subagrupador || null,
      descripcion: p.descripcion || null,
      stock_minimo: p.stock_minimo,
      requiere_muestreo: p.material_id ? 1 : 0,
      modelo_calidad: p.modelo_calidad,
      imagen: p.imagen || null,
      bodegas: detalle,
      total,
      estado: estadoDeExistencia(total, p.stock_minimo),
    };
  });
}

// --- la ODT de la semana ---

// Cuántas unidades de cada producto pide una ODT. En el Excel esto eran dos
// saltos encadenados —código → modelo → producto— con INDEX/MATCH sobre rangos
// fijos; aquí es una consulta, y lo que no empata se reporta en vez de aparecer
// como «⚠ Código no encontrado» en una celda que nadie lee.
function requeridoPorODT(odtId) {
  const filas = db.prepare(`
    SELECT r.id, r.codigo, r.pedidos, r.cuenta, r.tipo, pu.modelo, pu.unidades, pu.nombre AS publicacion,
           p.id AS producto_id, p.nombre AS producto
      FROM almacen_odt_renglones r
      LEFT JOIN almacen_publicaciones pu ON pu.codigo = r.codigo AND pu.activo = 1
      LEFT JOIN almacen_productos p ON p.modelo = pu.modelo AND p.activo = 1
     WHERE r.odt_id = ?
     ORDER BY r.orden, r.id
  `).all(odtId);

  const porProducto = new Map();
  const problemas = [];
  for (const f of filas) {
    if (!f.modelo) { problemas.push(`${f.codigo}: no está en el catálogo de publicaciones.`); continue; }
    if (!f.producto_id) { problemas.push(`${f.codigo}: el modelo «${f.modelo}» no tiene producto en el catálogo.`); continue; }
    const unidades = (f.pedidos || 0) * (f.unidades || 0);
    porProducto.set(f.producto_id, (porProducto.get(f.producto_id) || 0) + unidades);
  }
  return { renglones: filas, porProducto, problemas };
}

// La bodega donde se arma la ODT. Es del catálogo, no de cada ODT: en INKO se
// arma siempre en San Luis (B1), y preguntarlo cada semana solo abre la puerta a
// que un día se conteste mal y la evaluación salga contra la bodega equivocada.
function bodegaDeArmado() {
  const bodegas = bodegasActivas();
  return bodegas.find((b) => b.arma_odt) || bodegas[0];
}

// La hoja EVALUACION ODT: lo que pide la orden contra lo que hay, y qué hacer
// con la diferencia. Traspasar si el material existe en la otra bodega,
// comprar si no alcanza en ninguna.
function evaluarODT(odt) {
  const bodegas = bodegasActivas();
  const produccion = bodegaDeArmado();
  const { porProducto, problemas } = requeridoPorODT(odt.id);
  const saldos = existenciasPorBodega();
  const productos = productosActivos();

  const renglones = [];
  for (const p of productos) {
    const requerido = porProducto.get(p.id) || 0;
    if (!requerido) continue;
    const porBodega = saldos.get(p.id) || new Map();
    const enProduccion = porBodega.get(produccion.id) || 0;
    let total = 0;
    const detalle = {};
    for (const b of bodegas) {
      const n = porBodega.get(b.id) || 0;
      detalle[b.clave] = n;
      total += n;
    }
    const faltaEnProduccion = Math.max(0, requerido - enProduccion);
    const enOtras = total - enProduccion;
    const traspaso = Math.min(faltaEnProduccion, Math.max(0, enOtras));
    const comprar = Math.max(0, requerido - total);

    // De dónde traerlo. Decir «faltan 500» sin decir de qué bodega obliga a ir a
    // buscarlo a otra pantalla; el traspaso necesita origen, así que se resuelve
    // aquí. Se toma primero de la bodega que más tenga, para no dejar dos
    // bodegas a medias cuando una sola alcanzaba.
    const fuentes = [];
    let porCubrir = traspaso;
    const otras = bodegas
      .filter((b) => b.id !== produccion.id)
      .map((b) => ({ bodega: b, hay: porBodega.get(b.id) || 0 }))
      .filter((x) => x.hay > 0)
      .sort((a, b) => b.hay - a.hay);
    for (const { bodega, hay } of otras) {
      if (porCubrir <= 0) break;
      const toma = Math.min(porCubrir, hay);
      fuentes.push({ bodega_id: bodega.id, clave: bodega.clave, nombre: bodega.nombre, cantidad: toma });
      porCubrir -= toma;
    }

    renglones.push({
      producto_id: p.id, sku: p.sku, modelo: p.modelo, nombre: p.nombre,
      requerido, bodegas: detalle, total, en_produccion: enProduccion,
      falta_en_produccion: faltaEnProduccion, traspaso_sugerido: traspaso,
      fuentes, comprar,
      estado: comprar > 0 ? 'comprar' : faltaEnProduccion > 0 ? 'traspasar' : 'alcanza',
    });
  }
  renglones.sort((a, b) => b.comprar - a.comprar || b.traspaso_sugerido - a.traspaso_sugerido || a.nombre.localeCompare(b.nombre));
  return { bodega_produccion: produccion, renglones, problemas };
}

const odtDeSemana = (semana) => db
  .prepare('SELECT * FROM almacen_odt WHERE semana = ?').get(semana);

// --- escritura en el libro mayor ---

// El único lugar del sistema que inserta movimientos. Todo documento que se
// aplica pasa por aquí, y por eso todo movimiento sabe de qué documento vino:
// sin ese rastro, un inventario descuadrado no se puede auditar hacia atrás.
const insertarMovimiento = sentencia(`
  INSERT INTO almacen_movimientos
    (fecha, semana, tipo, producto_id, bodega_origen_id, bodega_destino_id,
     cantidad, referencia, origen_tipo, origen_id, usuario_id, notas, creado_en)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function anotarMovimiento({ fecha, tipo, productoId, origen = null, destino = null,
                            cantidad, referencia = null, origenTipo, origenId,
                            usuarioId = null, notas = null }) {
  if (!cantidad) return;
  insertarMovimiento.run(fecha, semanaISO(new Date(`${fecha}T12:00:00`)), tipo,
    productoId, origen, destino, Math.abs(cantidad), referencia,
    origenTipo, origenId, usuarioId, notas, new Date().toISOString());
}

// Deshacer un documento aplicado no borra sus movimientos: los quita del libro
// solo cuando el documento entero se cancela, y siempre en bloque, para que no
// pueda quedar un documento aplicado a medias.
const borrarMovimientosDe = sentencia(
  'DELETE FROM almacen_movimientos WHERE origen_tipo = ? AND origen_id = ?'
);

// Folio corrido por año y por tipo de documento. En papel los folios se
// llevaban en un talonario y se repetían cuando había dos talonarios abiertos.
function siguienteFolio(prefijo, tabla, columna = 'folio') {
  const anio = new Date().getFullYear();
  const inicio = `${prefijo}-${anio}-`;
  const ultimo = db.prepare(
    `SELECT ${columna} AS folio FROM ${tabla} WHERE ${columna} LIKE ? ORDER BY ${columna} DESC LIMIT 1`
  ).get(`${inicio}%`);
  const n = ultimo ? Number(ultimo.folio.slice(inicio.length)) + 1 : 1;
  return `${inicio}${String(n).padStart(4, '0')}`;
}

// Quien captura no autoriza. Es la misma regla que Calidad aplica al cierre de
// un lote rechazado, y la razón es idéntica: una decisión que mueve existencias
// no puede quedar en manos de una sola persona.
// --- correcciones de almacén ---
//
// Pedir corrección regresa el documento a captura con una nota. Si ya había
// movido el inventario, lo que movió se quita: el documento vuelve a pasar por
// aprobación y hasta entonces no cuenta. Todo queda en almacen_correcciones.

const anotarCorreccion = (tipo, id, folio, estadoAnterior, nota, usuarioId) => db.prepare(`
  INSERT INTO almacen_correcciones (documento_tipo, documento_id, folio, estado_anterior, nota, usuario_id, en)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(tipo, id, folio, estadoAnterior, nota, usuarioId, new Date().toISOString());

const correccionesDe = (tipo, id) => db.prepare(`
  SELECT c.estado_anterior, c.nota, c.en, u.nombre AS quien
    FROM almacen_correcciones c LEFT JOIN usuarios u ON u.id = c.usuario_id
   WHERE c.documento_tipo = ? AND c.documento_id = ? ORDER BY c.id DESC
`).all(tipo, id);

function notaDeCorreccion(res, cuerpo) {
  const nota = String((cuerpo || {}).nota || '').trim();
  if (nota.length < 5) {
    json(res, 400, { error: 'Escribe qué hay que corregir: lo va a leer quien lo capturó.' });
    return null;
  }
  return nota;
}

// Quitar los movimientos de un documento no puede dejar existencia negativa:
// si lo que sumó ya se usó, eso se corrige con un conteo, no borrando el pasado.
function quedariaNegativo(origenTipo, origenId) {
  const cambio = new Map();
  const sumar = (k, n) => cambio.set(k, (cambio.get(k) || 0) + n);
  for (const m of db.prepare(`
    SELECT producto_id, bodega_origen_id, bodega_destino_id, cantidad
      FROM almacen_movimientos WHERE origen_tipo = ? AND origen_id = ?
  `).all(origenTipo, origenId)) {
    const n = Math.abs(m.cantidad);
    if (m.bodega_destino_id) sumar(`${m.producto_id}|${m.bodega_destino_id}`, -n);
    if (m.bodega_origen_id) sumar(`${m.producto_id}|${m.bodega_origen_id}`, n);
  }
  for (const [k, n] of cambio) {
    if (n >= 0) continue;
    const [productoId, bodegaId] = k.split('|').map(Number);
    const hay = existenciaDe(productoId, bodegaId);
    if (hay + n < 0) {
      const prod = db.prepare('SELECT nombre FROM almacen_productos WHERE id = ?').get(productoId) || {};
      const bod = db.prepare('SELECT nombre FROM almacen_bodegas WHERE id = ?').get(bodegaId) || {};
      return `No se puede: «${prod.nombre}» quedaría en ${hay + n} en ${bod.nombre}. Ese material ya se movió; corrige la diferencia con un conteo.`;
    }
  }
  return null;
}

function segundaPersona(res, usuario, capturoId, quePasa) {
  if (usuario.rol === 'admin') return true;
  if (usuario.id === capturoId) {
    json(res, 409, { error: `Tú capturaste este documento. ${quePasa} le toca a otra persona.` });
    return false;
  }
  return true;
}

const nombreDe = (id) => (id
  ? (db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id) || {}).nombre || null
  : null);

// --- catálogos y consulta ---

ruta('GET', '/api/almacen/catalogos', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  json(res, 200, {
    bodegas: bodegasActivas(),
    productos: productosActivos().map((p) => ({
      id: p.id, sku: p.sku, modelo: p.modelo, nombre: p.nombre,
      tipo_material: p.tipo_material, unidad: unidadDe(p.tipo_material),
      stock_minimo: p.stock_minimo,
      especial: !!p.especial,
      subagrupador: p.subagrupador || null,
      descripcion: p.descripcion || null,
      requiere_muestreo: p.material_id ? 1 : 0,
      imagen: p.imagen || null,
    })),
    tipos: [...new Set(productosActivos().map((p) => p.tipo_material).filter(Boolean))],
    plataformas: PLATAFORMAS_RETIRO,
    proveedores: db.prepare(
      "SELECT valor FROM catalogo_calidad WHERE tipo = 'proveedor' AND activo = 1 ORDER BY orden, valor"
    ).all().map((f) => f.valor),
    motivos_salida: MOTIVOS_SALIDA,
    origenes_rechazo: ORIGENES_RECHAZO,
    cedis: cedisActivos(),
    plataformas_retiro: PLATAFORMAS_RETIRO,
    // Las órdenes de armado vivas: de estas sale una venta directa.
    ordenes_vxf: db.prepare(`
      SELECT o.id, o.folio, o.cliente, o.estado, o.fecha_solicitud
        FROM vxf_ordenes o WHERE o.estado NOT IN ('borrador', 'cancelada')
       ORDER BY o.id DESC LIMIT 200
    `).all(),
    semana: semanaISO(),
    hoy: hoyISO(),
  });
});

ruta('GET', '/api/almacen/inventario', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  json(res, 200, { bodegas: bodegasActivas(), productos: inventario() });
});

// El DASHBOARD del Excel, con una diferencia: los conteos de aquí salen del
// libro mayor y no de COUNTIF sobre rangos que se quedaban cortos.
ruta('GET', '/api/almacen/tablero', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;

  const bodegas = bodegasActivas();
  const filas = inventario();
  const hoy = hoyISO();
  const semana = semanaISO();

  const porTipo = new Map();
  for (const f of filas) {
    const tipo = f.tipo_material || 'Sin clasificar';
    if (!porTipo.has(tipo)) porTipo.set(tipo, { tipo, bodegas: {}, total: 0, productos: 0, alerta: 0 });
    const t = porTipo.get(tipo);
    for (const b of bodegas) t.bodegas[b.clave] = (t.bodegas[b.clave] || 0) + f.bodegas[b.clave];
    t.total += f.total;
    t.productos++;
    if (f.estado === 'sin_stock' || f.estado === 'critico') t.alerta++;
  }

  const cuenta = (sql, ...args) => db.prepare(sql).get(...args).n;

  json(res, 200, {
    semana,
    inventario: {
      unidades: filas.reduce((s, f) => s + f.total, 0),
      productos: filas.length,
      sin_stock: filas.filter((f) => f.estado === 'sin_stock').length,
      criticos: filas.filter((f) => f.estado === 'critico').length,
      bajos: filas.filter((f) => f.estado === 'bajo').length,
      por_bodega: bodegas.map((b) => ({
        ...b, unidades: filas.reduce((s, f) => s + f.bodegas[b.clave], 0),
      })),
    },
    movimientos: {
      hoy: cuenta('SELECT COUNT(*) AS n FROM almacen_movimientos WHERE fecha = ?', hoy),
      semana: cuenta('SELECT COUNT(*) AS n FROM almacen_movimientos WHERE semana = ?', semana),
    },
    pendientes: {
      entradas_en_calidad: cuenta("SELECT COUNT(*) AS n FROM almacen_entradas WHERE estado = 'en_calidad'"),
      entradas_por_autorizar: cuenta("SELECT COUNT(*) AS n FROM almacen_entradas WHERE estado = 'por_autorizar'"),
      salidas_por_autorizar: cuenta("SELECT COUNT(*) AS n FROM almacen_salidas WHERE estado = 'por_autorizar' AND motivo NOT IN ('traspaso', 'calidad')"),
      salidas_calidad_por_aprobar: cuenta("SELECT COUNT(*) AS n FROM almacen_salidas WHERE estado = 'por_autorizar' AND motivo = 'calidad'"),
      retiros_por_recibir: cuenta("SELECT COUNT(*) AS n FROM almacen_entradas WHERE fuente = 'retiro' AND estado = 'pendiente_recibir'"),
      reingresos_por_aprobar: cuenta("SELECT COUNT(*) AS n FROM almacen_reingresos WHERE estado = 'por_autorizar'"),
      traspasos_por_aprobar: cuenta("SELECT COUNT(*) AS n FROM almacen_salidas WHERE motivo = 'traspaso' AND estado IN ('borrador', 'solicitado')"),
      traspasos_en_transito: cuenta("SELECT COUNT(*) AS n FROM almacen_salidas WHERE motivo = 'traspaso' AND estado = 'aprobado'"),
      traspasos_por_confirmar: cuenta("SELECT COUNT(*) AS n FROM almacen_salidas WHERE motivo = 'traspaso' AND estado = 'cargado'"),
      devoluciones_por_autorizar: cuenta("SELECT COUNT(*) AS n FROM almacen_devoluciones WHERE estado = 'por_autorizar'"),
      conteos_por_autorizar: cuenta("SELECT COUNT(*) AS n FROM almacen_conteos WHERE estado = 'por_autorizar'"),
      conteos_por_contar: cuenta("SELECT COUNT(*) AS n FROM almacen_conteos WHERE estado = 'borrador'"),
      por_corregir: cuenta(`SELECT
          (SELECT COUNT(*) FROM almacen_entradas WHERE estado = 'borrador' AND correccion_nota IS NOT NULL)
        + (SELECT COUNT(*) FROM almacen_salidas WHERE estado = 'borrador' AND correccion_nota IS NOT NULL)
        + (SELECT COUNT(*) FROM almacen_devoluciones WHERE estado = 'borrador' AND correccion_nota IS NOT NULL) AS n`),
    },
    por_tipo: [...porTipo.values()].sort((a, b) => b.total - a.total),
    alertas: filas.filter((f) => f.estado === 'sin_stock' || f.estado === 'critico')
      .sort((a, b) => a.total - b.total).slice(0, 20),
  });
});

// El consolidado de un producto. Se abre tocándolo en Inventario y contesta las
// tres preguntas que se hacen frente a un número que no cuadra: cuánto hay y
// dónde, qué le pasó en el periodo que se quiera mirar, y de qué documento salió
// cada movimiento. El total del inventario no dice nada de eso; este sí.
ruta('GET', '/api/almacen/productos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const producto = db.prepare(`
    SELECT pr.*, m.modelo AS modelo_calidad, COALESCE(pr.imagen, m.imagen) AS imagen
      FROM almacen_productos pr LEFT JOIN materiales m ON m.id = pr.material_id
     WHERE pr.id = ?
  `).get(Number(p[1]));
  if (!producto) return json(res, 404, { error: 'Producto no encontrado' });

  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const hasta = fecha(url.searchParams.get('hasta')) || hoyISO();
  const hace90 = new Date();
  hace90.setDate(hace90.getDate() - 89);
  const desde = fecha(url.searchParams.get('desde')) || hoyISO(hace90);
  if (desde > hasta) return json(res, 400, { error: 'La fecha inicial queda después de la final.' });

  const bodegas = bodegasActivas();
  const saldos = existenciasPorBodega().get(producto.id) || new Map();
  const alInicio = existenciasPorBodega({ hasta: desde }).get(producto.id) || new Map();

  const movimientos = db.prepare(`
    SELECT m.id, m.fecha, m.tipo, m.cantidad, m.referencia, m.notas, m.origen_tipo, m.origen_id,
           m.bodega_origen_id, m.bodega_destino_id,
           bo.clave AS origen, bd.clave AS destino, u.nombre AS quien
      FROM almacen_movimientos m
      LEFT JOIN almacen_bodegas bo ON bo.id = m.bodega_origen_id
      LEFT JOIN almacen_bodegas bd ON bd.id = m.bodega_destino_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.producto_id = ? AND m.fecha BETWEEN ? AND ?
     ORDER BY m.fecha DESC, m.id DESC LIMIT 500
  `).all(producto.id, desde, hasta).map((m) => {
    const n = Math.abs(m.cantidad);
    const signo = m.bodega_destino_id && !m.bodega_origen_id ? 1
      : m.bodega_origen_id && !m.bodega_destino_id ? -1 : 0;
    return { ...m, unidades: n, neto: signo * n };
  });

  // Los tipos de movimiento que tuvo, cada uno con cuántas veces y cuántas
  // unidades. Un traspaso no cambia el total —cambia de bodega—, y por eso su
  // neto es cero: decirlo así evita la lectura de que «entraron y salieron».
  const TIPOS = {
    entrada: 'Entrada de proveedor', retiro: 'Re-ingreso de retiro', salida: 'Salida',
    devolucion: 'Devolución', traspaso: 'Traspaso entre bodegas', ajuste: 'Ajuste por conteo',
    carga_inicial: 'Carga inicial',
  };
  const porTipo = new Map();
  for (const m of movimientos) {
    const clave = m.origen_tipo === 'carga_inicial' ? 'carga_inicial' : m.tipo;
    if (!porTipo.has(clave)) {
      porTipo.set(clave, { tipo: clave, etiqueta: TIPOS[clave] || clave, movimientos: 0, unidades: 0, neto: 0 });
    }
    const f = porTipo.get(clave);
    f.movimientos++;
    f.unidades += m.unidades;
    f.neto += m.neto;
  }

  const total = bodegas.reduce((n, b) => n + (saldos.get(b.id) || 0), 0);
  json(res, 200, {
    desde,
    hasta,
    producto: {
      id: producto.id, sku: producto.sku, modelo: producto.modelo, nombre: producto.nombre,
      tipo_material: producto.tipo_material, stock_minimo: producto.stock_minimo,
      unidad: unidadDe(producto.tipo_material),
      requiere_muestreo: producto.material_id ? 1 : 0, modelo_calidad: producto.modelo_calidad,
      imagen: producto.imagen || null,
    },
    bodegas: bodegas.map((b) => ({
      ...b,
      existencia: saldos.get(b.id) || 0,
      al_inicio: alInicio.get(b.id) || 0,
    })),
    total,
    total_al_inicio: bodegas.reduce((n, b) => n + (alInicio.get(b.id) || 0), 0),
    estado: estadoDeExistencia(total, producto.stock_minimo),
    por_tipo: [...porTipo.values()].sort((a, b) => b.unidades - a.unidades),
    movimientos,
  });
});

// El libro mayor tal cual, para poder rastrear de dónde salió una existencia.
ruta('GET', '/api/almacen/movimientos', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const url = new URL(req.url, 'http://x');
  const productoId = Number(url.searchParams.get('producto') || 0);
  const limite = Math.min(Number(url.searchParams.get('limite') || 200), 1000);

  const filas = db.prepare(`
    SELECT m.*, p.nombre AS producto, p.sku,
           bo.clave AS origen, bd.clave AS destino, u.nombre AS capturo
      FROM almacen_movimientos m
      JOIN almacen_productos p ON p.id = m.producto_id
      LEFT JOIN almacen_bodegas bo ON bo.id = m.bodega_origen_id
      LEFT JOIN almacen_bodegas bd ON bd.id = m.bodega_destino_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
     ${productoId ? 'WHERE m.producto_id = ?' : ''}
     ORDER BY m.fecha DESC, m.id DESC LIMIT ?
  `).all(...(productoId ? [productoId, limite] : [limite]));
  json(res, 200, { movimientos: filas });
});

// --- entradas: proveedor y retiros de plataforma ---
//
// Una entrada no suma existencia por sí sola. Al enviarla abre una recepción en
// Calidad y se queda esperando: lo que entra al inventario es lo que Calidad dio
// por bueno, no lo que se bajó del camión. Ese era el hueco del Excel — el
// almacenista capturaba la entrada y el material contaba como disponible antes
// de que nadie lo revisara.

// Un retiro de plataforma ya no es una entrada más. Se carga lo que se pidió en
// Mercado Libre Full o en Amazon FBA y queda «pendiente de recibir»: no mueve
// inventario, solo dice que viene material. Lo que entra al inventario es cada
// re-ingreso que Calidad levanta cuando el material llega —y pueden ser varios,
// porque un retiro llega por partes—. Cuando llegó todo, el retiro se cierra.
const esRetiro = (entrada) => entrada.fuente === 'retiro';

// Una entrada de proveedor y un retiro son el mismo papel con dos caminos, así
// que también son dos permisos: quien carga retiros no necesariamente captura
// entradas, y al revés.
const capturaDe = (fuente) => (fuente === 'retiro' ? 'retiros_capturar' : 'entradas_capturar');
const cierreDe = (fuente) => (fuente === 'retiro' ? 'retiros_cerrar' : 'entradas_aprobar');

// Cuánto se ha recibido de un retiro, por producto: la suma de los re-ingresos
// ya aprobados. Es contra esto que se sabe si el retiro llegó completo.
function recibidoDeRetiro(entradaId) {
  const filas = db.prepare(`
    SELECT c.producto_id, COALESCE(SUM(c.cantidad), 0) AS n
      FROM almacen_reingreso_cajas c
      JOIN almacen_reingresos r ON r.id = c.reingreso_id
     WHERE r.entrada_id = ? AND r.estado = 'aplicado'
     GROUP BY c.producto_id
  `).all(entradaId);
  return new Map(filas.map((f) => [f.producto_id, f.n]));
}

function entradaCompleta(id) {
  const entrada = db.prepare(`
    SELECT e.*, b.clave AS bodega_clave, b.nombre AS bodega, u.nombre AS capturo,
           r.estado AS estado_calidad, r.remision, r.cerrado_en AS calidad_cerrada_en
      FROM almacen_entradas e
      JOIN almacen_bodegas b ON b.id = e.bodega_id
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN recepciones r ON r.id = e.recepcion_id
     WHERE e.id = ?
  `).get(id);
  if (!entrada) return null;
  const aprobo = entrada.aprobado_por ? db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(entrada.aprobado_por) : null;

  entrada.renglones = db.prepare(`
    SELECT r.*, p.sku, p.nombre AS producto, p.modelo, p.material_id,
           l.resultado, l.total_lote, l.muestra, l.disposicion, l.aprobado_en AS disposicion_en,
           l.observacion,
           (SELECT sm.cantidad_buena FROM recepcion_sin_muestreo sm
             WHERE sm.entrada_renglon_id = r.id
               AND sm.recepcion_id = (SELECT e2.recepcion_id FROM almacen_entradas e2 WHERE e2.id = r.entrada_id)) AS cantidad_buena
      FROM almacen_entrada_renglones r
      JOIN almacen_productos p ON p.id = r.producto_id
      LEFT JOIN lotes l ON l.id = r.lote_id
     WHERE r.entrada_id = ? ORDER BY r.orden, r.id
  `).all(id).map((r) => ({
    ...r,
    requiere_muestreo: r.material_id ? 1 : 0,
    etiqueta_disposicion: r.disposicion ? ETIQUETA_DISPOSICION[r.disposicion] : null,
  }));
  entrada.autorizo = aprobo ? aprobo.nombre : null;
  entrada.correcciones = correccionesDe('entrada', id);

  // Lo que ya llegó de un retiro y lo que sigue pendiente. En una entrada de
  // proveedor no aplica: esa entra de una vez, con el visto bueno de Calidad.
  if (esRetiro(entrada)) {
    const recibido = recibidoDeRetiro(id);
    entrada.renglones = entrada.renglones.map((r) => ({
      ...r,
      recibido: recibido.get(r.producto_id) || 0,
      por_recibir: Math.max(0, r.cantidad - (recibido.get(r.producto_id) || 0)),
    }));
    entrada.reingresos = db.prepare(`
      SELECT g.id, g.folio, g.fecha, g.estado, g.cajas, g.enviado_en, g.aplicado_en,
             b.nombre AS bodega, u.nombre AS capturo, ap.nombre AS aprobo,
             (SELECT COUNT(DISTINCT c.numero) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS cajas_detalladas,
             (SELECT COALESCE(SUM(c.cantidad), 0) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS unidades
        FROM almacen_reingresos g
        JOIN almacen_bodegas b ON b.id = g.bodega_id
        JOIN usuarios u ON u.id = g.usuario_id
        LEFT JOIN usuarios ap ON ap.id = g.aprobado_por
       WHERE g.entrada_id = ? ORDER BY g.id
    `).all(id);
    entrada.completo = entrada.renglones.length > 0 && entrada.renglones.every((r) => r.por_recibir === 0);
    entrada.cerro = nombreDe(entrada.cerrado_por);
  }
  return entrada;
}

// Cuánto de un renglón entra de verdad al inventario. Un lote aprobado entra
// completo; uno rechazado no entra, salvo que el Administrador lo haya aceptado
// con concesión — que es precisamente lo que significa esa disposición.
function cantidadQueEntra(renglon) {
  // Lo que no se muestrea entra en la cantidad que Calidad confirmó que llegó bien.
  if (!renglon.material_id) return renglon.cantidad_buena ?? 0;
  if (renglon.resultado === 'aprobado') return renglon.cantidad;
  if (renglon.resultado === 'rechazado' && renglon.disposicion === 'concesion') return renglon.cantidad;
  return 0;
}

// Lo que impide aplicar una entrada que ya volvió de Calidad. Un lote rechazado
// sin destino decidido deja la entrada en pausa: hasta que no se sepa si se
// devuelve, se reprocesa o se acepta con concesión, no se puede saber cuánto
// entra al almacén.
function faltantesDeEntrada(entrada) {
  const faltas = [];
  for (const r of entrada.renglones) {
    if (!r.material_id) {
      if (r.cantidad_buena === null || r.cantidad_buena === undefined) {
        faltas.push(`«${r.producto}»: Calidad todavía no confirma cuánto llegó bien.`);
      }
      continue;
    }
    if (!r.resultado) faltas.push(`«${r.producto}»: Calidad todavía no lo revisó.`);
    else if (r.resultado === 'rechazado' && !r.disposicion_en) {
      faltas.push(`«${r.producto}»: fue rechazado y su destino sigue sin aprobarse en Calidad.`);
    }
  }
  return faltas;
}

// Aplica la entrada al libro mayor. Es idempotente por el estado: una entrada
// ya aplicada no vuelve a sumar aunque Calidad se reabra y se apruebe de nuevo.
function aplicarEntrada(entrada, usuarioId) {
  if (entrada.estado === 'aplicada') return { ok: true, yaEstaba: true };
  const faltas = faltantesDeEntrada(entrada);
  if (faltas.length) return { ok: false, faltas };

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const r of entrada.renglones) {
      const cantidad = cantidadQueEntra(r);
      db.prepare('UPDATE almacen_entrada_renglones SET cantidad_aplicada = ? WHERE id = ?')
        .run(cantidad, r.id);
      anotarMovimiento({
        fecha: entrada.fecha,
        tipo: entrada.fuente === 'retiro' ? 'retiro' : 'entrada',
        productoId: r.producto_id,
        destino: entrada.bodega_id,
        cantidad,
        referencia: entrada.folio,
        origenTipo: 'entrada',
        origenId: entrada.id,
        usuarioId,
        notas: r.resultado === 'rechazado' && cantidad
          ? 'Lote rechazado por Calidad, aceptado con concesión.'
          : null,
      });
    }
    db.prepare("UPDATE almacen_entradas SET estado = 'aplicada', aplicado_en = ? WHERE id = ?")
      .run(ahora, entrada.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

// El enganche con Calidad. Cuando una recepción recibe el visto bueno del
// Administrador —o cuando se aprueba el destino del último lote rechazado— la
// entrada de almacén que la abrió se aplica sola. Nadie tiene que acordarse de
// volver a Almacén a rematar el trámite: era exactamente el paso que se perdía
// entre las dos hojas del Excel.
function aplicarEntradaDeRecepcion(recepcionId, usuarioId) {
  const fila = db.prepare(
    "SELECT id FROM almacen_entradas WHERE recepcion_id = ? AND estado = 'en_calidad'"
  ).get(recepcionId);
  if (!fila) return null;

  const recepcion = db.prepare('SELECT estado FROM recepciones WHERE id = ?').get(recepcionId);
  if (!recepcion || recepcion.estado !== 'aprobado') return null;

  const entrada = entradaCompleta(fila.id);
  const resultado = aplicarEntrada(entrada, usuarioId);
  return resultado.ok ? entrada.folio : null;
}

// Las entradas de proveedor y los retiros se piden por separado: son dos
// apartados distintos en la pantalla porque son dos caminos distintos.
ruta('GET', '/api/almacen/entradas', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const url = new URL(req.url, 'http://x');
  const estado = url.searchParams.get('estado');
  const fuente = ['proveedor', 'retiro'].includes(url.searchParams.get('fuente'))
    ? url.searchParams.get('fuente') : null;
  const filas = db.prepare(`
    SELECT e.id, e.folio, e.fuente, e.proveedor, e.plataforma, e.fecha, e.estado, e.correccion_nota,
           e.recepcion_id, b.nombre AS bodega, u.nombre AS capturo,
           r.estado AS estado_calidad,
           (SELECT COUNT(*) FROM almacen_entrada_renglones x WHERE x.entrada_id = e.id) AS renglones,
           (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_entrada_renglones x WHERE x.entrada_id = e.id) AS unidades
      FROM almacen_entradas e
      JOIN almacen_bodegas b ON b.id = e.bodega_id
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN recepciones r ON r.id = e.recepcion_id
     ${[estado ? 'e.estado = ?' : '', fuente ? 'e.fuente = ?' : ''].filter(Boolean).length
       ? 'WHERE ' + [estado ? 'e.estado = ?' : '', fuente ? 'e.fuente = ?' : ''].filter(Boolean).join(' AND ') : ''}
     ORDER BY e.fecha DESC, e.id DESC LIMIT 200
  `).all(...[estado, fuente].filter(Boolean));

  // De un retiro interesa cuánto falta por recibir: es lo que lo mantiene abierto.
  if (fuente === 'retiro') {
    for (const f of filas) {
      const recibido = recibidoDeRetiro(f.id);
      f.recibido = [...recibido.values()].reduce((n, v) => n + v, 0);
      f.reingresos = db.prepare(
        "SELECT COUNT(*) AS n FROM almacen_reingresos WHERE entrada_id = ? AND estado <> 'cancelado'"
      ).get(f.id).n;
    }
  }
  json(res, 200, { entradas: filas });
});

ruta('POST', '/api/almacen/entradas', (req, res, _p, cuerpo) => {
  const fuente = cuerpo.fuente === 'retiro' ? 'retiro' : 'proveedor';
  const usuario = exigir(req, res, capturaDe(fuente));
  if (!usuario) return;

  const bodegaId = Number(cuerpo.bodega_id || 0);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega a la que llega el material.' });
  }
  const quien = String(cuerpo[fuente === 'retiro' ? 'plataforma' : 'proveedor'] || '').trim();
  if (!quien) {
    return json(res, 400, {
      error: fuente === 'retiro' ? 'Escoge de qué plataforma es el retiro.' : 'Escoge el proveedor.',
    });
  }
  if (fuente === 'retiro' && !PLATAFORMAS_RETIRO.includes(quien)) {
    return json(res, 400, { error: 'Esa plataforma no está en el catálogo.' });
  }

  const folio = String(cuerpo.folio || '').trim() || siguienteFolio(fuente === 'retiro' ? 'RET' : 'ENT', 'almacen_entradas');
  if (db.prepare('SELECT id FROM almacen_entradas WHERE fuente = ? AND folio = ?').get(fuente, folio)) {
    return json(res, 409, { error: `Ya existe una entrada con el folio ${folio}.` });
  }

  const id = Number(db.prepare(`
    INSERT INTO almacen_entradas (folio, fuente, proveedor, plataforma, bodega_id, fecha,
                                  usuario_id, notas, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(folio, fuente,
    fuente === 'proveedor' ? quien : null,
    fuente === 'retiro' ? quien : null,
    bodegaId, cuerpo.fecha || hoyISO(), usuario.id,
    String(cuerpo.notas || '').trim() || null, new Date().toISOString()).lastInsertRowid);

  json(res, 201, { entrada: entradaCompleta(id) });
});

ruta('GET', '/api/almacen/entradas/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const entrada = entradaCompleta(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Entrada no encontrada' });
  json(res, 200, { entrada, faltantes: faltantesDeEntrada(entrada) });
});

// Una entrada solo se toca mientras está en borrador. En cuanto salió a Calidad
// deja de ser un papel del almacén y pasa a ser el documento contra el que se
// muestrea; cambiarle una cantidad ahí sería cambiar lo que se está revisando.
function entradaEnBorrador(res, id) {
  const entrada = db.prepare('SELECT * FROM almacen_entradas WHERE id = ?').get(id);
  if (!entrada) { json(res, 404, { error: 'Entrada no encontrada' }); return null; }
  if (entrada.estado !== 'borrador') {
    json(res, 409, {
      error: esRetiro(entrada)
        ? 'Este retiro ya se dejó pendiente de recibir. Para cambiarlo hay que reabrirlo.'
        : 'Esta entrada ya se envió. Si hay que cambiarla, pide que la regresen a corregir.',
    });
    return null;
  }
  return entrada;
}

// El permiso depende de si es entrada de proveedor o retiro, y eso solo se sabe
// leyendo el documento. Por eso aquí se busca primero y se exige después.
function entradaParaCapturar(req, res, id) {
  const fila = db.prepare('SELECT fuente FROM almacen_entradas WHERE id = ?').get(id);
  if (!fila) { json(res, 404, { error: 'Entrada no encontrada' }); return null; }
  if (!exigir(req, res, capturaDe(fila.fuente))) return null;
  return entradaEnBorrador(res, id);
}

ruta('PUT', '/api/almacen/entradas/(\\d+)', (req, res, p, cuerpo) => {
  const entrada = entradaParaCapturar(req, res, Number(p[1]));
  if (!entrada) return;

  db.prepare('UPDATE almacen_entradas SET fecha = ?, bodega_id = ?, notas = ? WHERE id = ?').run(
    cuerpo.fecha || entrada.fecha,
    Number(cuerpo.bodega_id || entrada.bodega_id),
    String(cuerpo.notas ?? entrada.notas ?? '').trim() || null,
    entrada.id
  );
  json(res, 200, { entrada: entradaCompleta(entrada.id) });
});

ruta('POST', '/api/almacen/entradas/(\\d+)/renglones', (req, res, p, cuerpo) => {
  const entrada = entradaParaCapturar(req, res, Number(p[1]));
  if (!entrada) return;

  const productoId = Number(cuerpo.producto_id || 0);
  const producto = db.prepare('SELECT id FROM almacen_productos WHERE id = ? AND activo = 1').get(productoId);
  if (!producto) return json(res, 400, { error: 'Escoge un producto del catálogo.' });
  if (db.prepare('SELECT id FROM almacen_entrada_renglones WHERE entrada_id = ? AND producto_id = ?')
        .get(entrada.id, productoId)) {
    return json(res, 409, { error: 'Ese producto ya está en la entrada. Cámbiale la cantidad al renglón que ya existe.' });
  }
  const cantidad = Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0)));
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM almacen_entrada_renglones WHERE entrada_id = ?')
    .get(entrada.id).n;

  db.prepare('INSERT INTO almacen_entrada_renglones (entrada_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?)')
    .run(entrada.id, productoId, cantidad, orden);
  json(res, 201, { entrada: entradaCompleta(entrada.id) });
});

ruta('PUT', '/api/almacen/entrada-renglones/(\\d+)', (req, res, p, cuerpo) => {
  const renglon = db.prepare('SELECT * FROM almacen_entrada_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!entradaParaCapturar(req, res, renglon.entrada_id)) return;

  db.prepare('UPDATE almacen_entrada_renglones SET cantidad = ? WHERE id = ?')
    .run(Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))), renglon.id);
  json(res, 200, { entrada: entradaCompleta(renglon.entrada_id) });
});

ruta('DELETE', '/api/almacen/entrada-renglones/(\\d+)', (req, res, p) => {
  const renglon = db.prepare('SELECT * FROM almacen_entrada_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!entradaParaCapturar(req, res, renglon.entrada_id)) return;

  db.prepare('DELETE FROM almacen_entrada_renglones WHERE id = ?').run(renglon.id);
  json(res, 200, { entrada: entradaCompleta(renglon.entrada_id) });
});

// El camino de una entrada:
//
//   borrador      Se captura.                       (entradas_capturar)
//   por_autorizar Enviada; espera aprobación.       (entradas_aprobar, otra persona)
//   en_calidad    Aprobada: en Calidad como «pendiente de revisar». TODO pasa:
//                 lo que tiene especificación se muestrea y lo que no, Calidad
//                 confirma cuánto llegó bien.
//   aplicada      Calidad dio el visto bueno y sumó al inventario.
//
// En cualquier punto después de enviarla, quien tenga entradas_corregir la
// regresa a captura con una nota; si ya había sumado, lo que sumó sale.

// Lo que impide dar por capturado cualquiera de los dos: productos con cantidad.
function faltantesDeCaptura(entrada) {
  if (!entrada.renglones.length) return 'Agrega al menos un producto.';
  const sinCantidad = entrada.renglones.filter((r) => !r.cantidad);
  return sinCantidad.length
    ? `Falta anotar cuánto ${esRetiro(entrada) ? 'se pidió' : 'llegó'} de: ${sinCantidad.map((r) => `«${r.producto}»`).join(', ')}.`
    : null;
}

// El camino de un retiro:
//
//   borrador           Se carga lo que se pidió en la plataforma.  (retiros_capturar)
//   pendiente_recibir  Esperando que llegue. Calidad le levanta un
//                      re-ingreso por cada entrega que llega.
//   recibido           Llegó todo —se cierra solo— o alguien lo cerró. (retiros_cerrar)
//
// El retiro nunca mueve inventario: lo mueve el re-ingreso aprobado.

ruta('POST', '/api/almacen/entradas/(\\d+)/solicitar', (req, res, p) => {
  const base = entradaParaCapturar(req, res, Number(p[1]));
  if (!base) return;
  if (!esRetiro(base)) {
    return json(res, 409, { error: 'Solo un retiro de plataforma queda pendiente de recibir. Una entrada de proveedor se envía a aprobación.' });
  }
  const entrada = entradaCompleta(base.id);
  const falta = faltantesDeCaptura(entrada);
  if (falta) return json(res, 400, { error: falta });

  db.prepare(`
    UPDATE almacen_entradas SET estado = 'pendiente_recibir', enviado_en = ?,
           correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
     WHERE id = ?
  `).run(new Date().toISOString(), entrada.id);
  json(res, 200, {
    entrada: entradaCompleta(entrada.id),
    mensaje: 'Retiro pendiente de recibir. Calidad le levanta un re-ingreso por cada entrega que llegue a la bodega.',
  });
});

ruta('POST', '/api/almacen/entradas/(\\d+)/reabrir-retiro', (req, res, p) => {
  const usuario = exigir(req, res, 'retiros_cerrar');
  if (!usuario) return;
  const entrada = db.prepare('SELECT * FROM almacen_entradas WHERE id = ?').get(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Retiro no encontrado' });
  if (!esRetiro(entrada)) return json(res, 409, { error: 'Esto no es un retiro.' });
  if (!['pendiente_recibir', 'recibido'].includes(entrada.estado)) {
    return json(res, 409, { error: 'Este retiro no está pendiente de recibir ni cerrado.' });
  }
  const abierto = db.prepare(
    "SELECT COUNT(*) AS n FROM almacen_reingresos WHERE entrada_id = ? AND estado IN ('borrador', 'por_autorizar')"
  ).get(entrada.id).n;
  if (abierto) {
    return json(res, 409, { error: 'Calidad tiene un re-ingreso abierto contra este retiro. Que lo cancelen o lo terminen primero.' });
  }
  const aplicado = db.prepare(
    "SELECT COUNT(*) AS n FROM almacen_reingresos WHERE entrada_id = ? AND estado = 'aplicado'"
  ).get(entrada.id).n;
  if (aplicado && entrada.estado === 'pendiente_recibir') {
    return json(res, 409, { error: 'Ya entró material contra este retiro. Corrige el re-ingreso que esté mal, no el retiro.' });
  }

  db.prepare(`
    UPDATE almacen_entradas SET estado = ?, cerrado_en = NULL, cerrado_por = NULL WHERE id = ?
  `).run(aplicado ? 'pendiente_recibir' : 'borrador', entrada.id);
  json(res, 200, {
    entrada: entradaCompleta(entrada.id),
    mensaje: aplicado
      ? 'Retiro reabierto: vuelve a estar pendiente de recibir.'
      : 'Retiro reabierto para corregir lo que se pidió.',
  });
});

ruta('POST', '/api/almacen/entradas/(\\d+)/cerrar-retiro', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'retiros_cerrar');
  if (!usuario) return;
  const entrada = entradaCompleta(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Retiro no encontrado' });
  if (!esRetiro(entrada)) return json(res, 409, { error: 'Esto no es un retiro.' });
  if (entrada.estado !== 'pendiente_recibir') {
    return json(res, 409, { error: 'Solo se cierra un retiro que está pendiente de recibir.' });
  }
  // Cerrar un retiro incompleto es decir «lo que falta ya no va a llegar», y eso
  // no se firma en silencio: queda por escrito quién lo dijo y por qué.
  const nota = String((cuerpo || {}).nota || '').trim();
  if (!entrada.completo && nota.length < 5) {
    const falta = entrada.renglones.filter((r) => r.por_recibir > 0).length;
    return json(res, 400, {
      error: `Faltan ${falta} producto(s) por recibir. Escribe por qué se cierra así: queda registrado.`,
    });
  }

  db.prepare("UPDATE almacen_entradas SET estado = 'recibido', cerrado_en = ?, cerrado_por = ?, notas = ? WHERE id = ?")
    .run(new Date().toISOString(), usuario.id,
      nota ? `${entrada.notas ? entrada.notas + ' · ' : ''}Cerrado: ${nota}` : entrada.notas, entrada.id);
  json(res, 200, { entrada: entradaCompleta(entrada.id), mensaje: 'Retiro cerrado.' });
});

// Cierra solo el retiro que ya recibió todo lo que pidió. Se llama al aprobar un
// re-ingreso: nadie tiene que acordarse de venir a rematarlo.
function cerrarRetiroSiLlegoTodo(entradaId, usuarioId) {
  const entrada = entradaCompleta(entradaId);
  if (!entrada || !esRetiro(entrada) || entrada.estado !== 'pendiente_recibir' || !entrada.completo) return false;
  db.prepare("UPDATE almacen_entradas SET estado = 'recibido', cerrado_en = ?, cerrado_por = ? WHERE id = ?")
    .run(new Date().toISOString(), usuarioId, entradaId);
  return true;
}

ruta('POST', '/api/almacen/entradas/(\\d+)/enviar', (req, res, p) => {
  const base = entradaParaCapturar(req, res, Number(p[1]));
  if (!base) return;
  if (esRetiro(base)) {
    return json(res, 409, { error: 'Un retiro no se envía a aprobación: se deja pendiente de recibir y Calidad levanta el re-ingreso cuando llega.' });
  }

  const entrada = entradaCompleta(base.id);
  if (!entrada.renglones.length) return json(res, 400, { error: 'Agrega al menos un producto a la entrada.' });
  const sinCantidad = entrada.renglones.filter((r) => !r.cantidad);
  if (sinCantidad.length) {
    return json(res, 400, {
      error: `Falta anotar cuánto llegó de: ${sinCantidad.map((r) => `«${r.producto}»`).join(', ')}.`,
    });
  }
  db.prepare(`
    UPDATE almacen_entradas SET estado = 'por_autorizar', enviado_en = ?,
           correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
     WHERE id = ?
  `).run(new Date().toISOString(), entrada.id);
  json(res, 200, {
    entrada: entradaCompleta(entrada.id),
    mensaje: 'Entrada enviada a aprobación. Al aprobarla pasa a Calidad, y suma al inventario cuando Calidad dé el visto bueno.',
  });
});

ruta('POST', '/api/almacen/entradas/(\\d+)/aprobar', (req, res, p) => {
  const usuario = exigir(req, res, 'entradas_aprobar');
  if (!usuario) return;
  const entrada = entradaCompleta(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Entrada no encontrada' });
  if (esRetiro(entrada)) return json(res, 409, { error: 'Un retiro entra al inventario por su re-ingreso de Calidad, no por aquí.' });
  if (entrada.estado !== 'por_autorizar') return json(res, 409, { error: 'Esta entrada no está esperando aprobación.' });
  if (!segundaPersona(res, usuario, entrada.usuario_id, 'Aprobarla')) return;

  const ahora = new Date().toISOString();
  const quien = entrada.fuente === 'retiro' ? entrada.plataforma : entrada.proveedor;
  db.exec('BEGIN');
  try {
    const recepcionId = Number(db.prepare(`
      INSERT INTO recepciones (remision, proveedor, fecha_llegada, usuario_id, estado, notas, creado_en, entrada_id)
      VALUES (?, ?, ?, ?, 'borrador', ?, ?, ?)
    `).run(entrada.folio, quien, entrada.fecha, entrada.usuario_id,
      `Abierta desde la entrada de almacén ${entrada.folio}, aprobada por ${usuario.nombre}.`,
      ahora, entrada.id).lastInsertRowid);

    const insertLote = db.prepare(`
      INSERT INTO lotes (recepcion_id, material_id, cant_rollos, total_lote, muestra, orden) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertSinMuestreo = db.prepare(`
      INSERT INTO recepcion_sin_muestreo (recepcion_id, entrada_renglon_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?, ?)
    `);
    const ligar = db.prepare('UPDATE almacen_entrada_renglones SET lote_id = ?, cantidad_aplicada = NULL WHERE id = ?');
    entrada.renglones.forEach((r, i) => {
      if (r.material_id) {
        const loteId = Number(insertLote.run(recepcionId, r.material_id, r.cantidad, r.cantidad,
          tamanoMuestra(r.cantidad), i).lastInsertRowid);
        ligar.run(loteId, r.id);
      } else {
        insertSinMuestreo.run(recepcionId, r.id, r.producto_id, r.cantidad, i);
        ligar.run(null, r.id);
      }
    });
    db.prepare("UPDATE almacen_entradas SET estado = 'en_calidad', recepcion_id = ?, aprobado_por = ?, aprobado_en = ? WHERE id = ?")
      .run(recepcionId, usuario.id, ahora, entrada.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (/UNIQUE/i.test(String(err.message))) {
      return json(res, 409, { error: `Ya hay en Calidad una recepción ${entrada.folio} de ${quien}. Revisa el folio de la entrada.` });
    }
    throw err;
  }
  json(res, 200, {
    entrada: entradaCompleta(entrada.id),
    mensaje: 'Entrada aprobada. Ya aparece en Calidad como pendiente de revisar; suma al inventario cuando Calidad dé el visto bueno.',
  });
});

// Rematar a mano una entrada que ya volvió aprobada de Calidad. Lo normal es que
// se aplique sola con el visto bueno; esto es para cuando hay que empujarla.
ruta('POST', '/api/almacen/entradas/(\\d+)/aplicar', (req, res, p) => {
  const usuario = exigir(req, res, 'entradas_aprobar');
  if (!usuario) return;
  const entrada = entradaCompleta(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Entrada no encontrada' });
  if (entrada.estado !== 'en_calidad') return json(res, 409, { error: 'Solo se aplica a mano una entrada que ya está en Calidad.' });
  if (entrada.estado_calidad !== 'aprobado') {
    return json(res, 409, { error: 'Calidad todavía no da el visto bueno de esta recepción.' });
  }
  const resultado = aplicarEntrada(entrada, usuario.id);
  if (!resultado.ok) return json(res, 400, { error: resultado.faltas.join(' ') });
  json(res, 200, { entrada: entradaCompleta(entrada.id), mensaje: 'Entrada aplicada. El inventario ya la refleja.' });
});

// La revisión de Calidad de una entrada que se regresa queda anulada: se conserva
// para la historia, pero ya no se trabaja. Al volver a aprobarse se abre otra.
function anularRecepcionDeEntrada(entrada) {
  if (!entrada.recepcion_id) return;
  db.prepare(`
    UPDATE recepciones SET estado = 'cancelada', remision = remision || ' · anulada ' || id
     WHERE id = ? AND estado <> 'cancelada'
  `).run(entrada.recepcion_id);
}

ruta('POST', '/api/almacen/entradas/(\\d+)/corregir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'entradas_corregir');
  if (!usuario) return;
  const entrada = entradaCompleta(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Entrada no encontrada' });
  if (!['por_autorizar', 'en_calidad', 'aplicada'].includes(entrada.estado)) {
    return json(res, 409, { error: 'Solo se pide corregir una entrada que ya se envió.' });
  }
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;
  if (entrada.estado === 'aplicada') {
    const negativo = quedariaNegativo('entrada', entrada.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('entrada', entrada.id);
    anularRecepcionDeEntrada(entrada);
    db.prepare('UPDATE almacen_entrada_renglones SET lote_id = NULL, cantidad_aplicada = NULL WHERE entrada_id = ?').run(entrada.id);
    db.prepare(`
      UPDATE almacen_entradas SET estado = 'borrador', recepcion_id = NULL, enviado_en = NULL,
             aprobado_por = NULL, aprobado_en = NULL, aplicado_en = NULL,
             correccion_nota = ?, correccion_por = ?, correccion_en = ?
       WHERE id = ?
    `).run(nota, usuario.id, ahora, entrada.id);
    anotarCorreccion('entrada', entrada.id, entrada.folio, entrada.estado, nota, usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    entrada: entradaCompleta(entrada.id),
    mensaje: entrada.estado === 'aplicada'
      ? 'Regresada a captura. Lo que había sumado ya salió del inventario; al corregirla vuelve a pasar por aprobación y por Calidad.'
      : 'Regresada a captura para corregir.',
  });
});

ruta('POST', '/api/almacen/entradas/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'entradas_aprobar');
  if (!usuario) return;
  const entrada = db.prepare('SELECT * FROM almacen_entradas WHERE id = ?').get(Number(p[1]));
  if (!entrada) return json(res, 404, { error: 'Entrada no encontrada' });
  if (entrada.estado === 'cancelada') return json(res, 409, { error: 'Ya estaba cancelada.' });
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué la cancelas. Queda registrado.' });
  if (entrada.estado === 'aplicada') {
    const negativo = quedariaNegativo('entrada', entrada.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('entrada', entrada.id);
    anularRecepcionDeEntrada(entrada);
    db.prepare("UPDATE almacen_entradas SET estado = 'cancelada', notas = ? WHERE id = ?")
      .run(`${entrada.notas ? entrada.notas + ' · ' : ''}Cancelada: ${motivo}`, entrada.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true });
});

// --- el re-ingreso de un retiro ---
//
// Cuando el material de un retiro llega a la bodega, Calidad levanta la
// solicitud de re-ingreso: escoge a qué retiro pendiente de recibir se le asigna
// lo que llegó, dice cuántas cajas trae esta entrega y detalla caja por caja qué
// producto y cuánto verificó dentro. Eso —y no lo que decía el retiro— es lo que
// suma al inventario, y solo cuando otra persona con permiso lo aprueba.
//
// Un retiro puede recibir varios re-ingresos: casi nunca llega todo junto.

function reingresoCompleto(id) {
  const g = db.prepare(`
    SELECT g.*, b.nombre AS bodega, b.clave AS bodega_clave, u.nombre AS capturo,
           ap.nombre AS aprobo, e.folio AS retiro_folio, e.plataforma, e.fuente,
           e.estado AS retiro_estado, q.nombre AS pidio_correccion
      FROM almacen_reingresos g
      JOIN almacen_bodegas b ON b.id = g.bodega_id
      JOIN usuarios u ON u.id = g.usuario_id
      LEFT JOIN usuarios ap ON ap.id = g.aprobado_por
      LEFT JOIN usuarios q ON q.id = g.correccion_por
      JOIN almacen_entradas e ON e.id = g.entrada_id
     WHERE g.id = ?
  `).get(id);
  if (!g) return null;

  const pedido = new Map(db.prepare(
    'SELECT producto_id, cantidad FROM almacen_entrada_renglones WHERE entrada_id = ?'
  ).all(g.entrada_id).map((r) => [r.producto_id, r.cantidad]));
  // Lo ya recibido en OTROS re-ingresos: contra eso se mide si esta entrega se
  // pasa de lo que el retiro pidió.
  const recibido = new Map();
  for (const f of db.prepare(`
    SELECT c.producto_id, COALESCE(SUM(c.cantidad), 0) AS n
      FROM almacen_reingreso_cajas c JOIN almacen_reingresos r ON r.id = c.reingreso_id
     WHERE r.entrada_id = ? AND r.estado = 'aplicado' AND r.id <> ?
     GROUP BY c.producto_id
  `).all(g.entrada_id, g.id)) recibido.set(f.producto_id, f.n);

  g.cajas_detalle = db.prepare(`
    SELECT c.*, p.sku, p.nombre AS producto, p.modelo, p.tipo_material
      FROM almacen_reingreso_cajas c JOIN almacen_productos p ON p.id = c.producto_id
     WHERE c.reingreso_id = ? ORDER BY c.numero, c.orden, c.id
  `).all(id).map((c) => ({
    ...c,
    en_el_retiro: pedido.has(c.producto_id),
    pedido: pedido.get(c.producto_id) || 0,
    ya_recibido: recibido.get(c.producto_id) || 0,
  }));

  // El resumen por producto es lo que de verdad va a entrar al inventario.
  const porProducto = new Map();
  for (const c of g.cajas_detalle) {
    if (!porProducto.has(c.producto_id)) {
      porProducto.set(c.producto_id, {
        producto_id: c.producto_id, sku: c.sku, producto: c.producto, modelo: c.modelo,
        cantidad: 0, cajas: 0, pedido: c.pedido, ya_recibido: c.ya_recibido, en_el_retiro: c.en_el_retiro,
      });
    }
    const f = porProducto.get(c.producto_id);
    f.cantidad += c.cantidad;
    f.cajas += 1;
  }
  g.productos = [...porProducto.values()].map((f) => ({
    ...f,
    de_mas: Math.max(0, f.cantidad + f.ya_recibido - f.pedido),
  }));
  g.unidades = g.productos.reduce((n, f) => n + f.cantidad, 0);
  g.cajas_detalladas = new Set(g.cajas_detalle.map((c) => c.numero)).size;
  g.fotos = fotosDeDocumento('reingreso', id);
  g.correcciones = correccionesDe('reingreso', id);
  return g;
}

function faltantesDeReingreso(g) {
  const faltas = [];
  if (!g.cajas) faltas.push('Anota cuántas cajas se reciben en esta entrega.');
  if (!g.cajas_detalle.length) faltas.push('Detalla qué trae cada caja: producto y cantidad verificada.');
  for (let n = 1; n <= g.cajas; n++) {
    if (!g.cajas_detalle.some((c) => c.numero === n)) faltas.push(`Falta el detalle de la caja ${n}.`);
  }
  const sobran = g.cajas_detalle.filter((c) => c.numero > g.cajas).map((c) => c.numero);
  if (sobran.length) {
    faltas.push(`Hay detalle de la caja ${[...new Set(sobran)].join(', ')} y dijiste que llegaron ${g.cajas}.`);
  }
  for (const c of g.cajas_detalle) {
    if (!c.cantidad) faltas.push(`Caja ${c.numero}: falta la cantidad verificada de «${c.producto}».`);
  }
  // Recibir más de lo que se pidió no se bloquea —la plataforma a veces manda
  // de más— pero tiene que quedar explicado.
  for (const f of g.productos) {
    if (f.de_mas && !g.cajas_detalle.some((c) => c.producto_id === f.producto_id && (c.observacion || '').trim())) {
      faltas.push(`«${f.producto}»: llegan ${f.de_mas} más de lo que pedía el retiro; explícalo en la caja.`);
    }
    if (!f.en_el_retiro && !g.cajas_detalle.some((c) => c.producto_id === f.producto_id && (c.observacion || '').trim())) {
      faltas.push(`«${f.producto}» no venía en el retiro; explícalo en la caja.`);
    }
  }
  return faltas;
}

// Quién puede ver la lista: Calidad, que los levanta, y Almacén, que los aprueba.
const ACCESO_REINGRESO = ['mod_almacen', 'mod_calidad', 'reingresos_capturar', 'reingresos_aprobar'];

ruta('GET', '/api/almacen/reingresos', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  if (!ACCESO_REINGRESO.some((k) => puede(usuario, k))) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  const url = new URL(req.url, 'http://x');
  const estado = url.searchParams.get('estado');
  json(res, 200, {
    reingresos: db.prepare(`
      SELECT g.id, g.folio, g.fecha, g.estado, g.cajas, g.enviado_en, g.aplicado_en, g.correccion_nota,
             b.nombre AS bodega, u.nombre AS capturo, ap.nombre AS aprobo,
             e.folio AS retiro_folio, e.plataforma,
             (SELECT COALESCE(SUM(c.cantidad), 0) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS unidades
        FROM almacen_reingresos g
        JOIN almacen_bodegas b ON b.id = g.bodega_id
        JOIN usuarios u ON u.id = g.usuario_id
        LEFT JOIN usuarios ap ON ap.id = g.aprobado_por
        JOIN almacen_entradas e ON e.id = g.entrada_id
       ${estado ? 'WHERE g.estado = ?' : ''}
       ORDER BY g.fecha DESC, g.id DESC LIMIT 200
    `).all(...(estado ? [estado] : [])),
    // Los retiros que esperan material: es lo primero que se escoge al levantar
    // un re-ingreso, así que va en la misma respuesta.
    retiros: retirosPendientes(),
  });
});

// Los retiros pendientes de recibir, con lo que falta de cada producto.
function retirosPendientes() {
  return db.prepare(`
    SELECT e.id, e.folio, e.plataforma, e.fecha, e.enviado_en, e.bodega_id,
           b.nombre AS bodega, u.nombre AS capturo
      FROM almacen_entradas e
      JOIN almacen_bodegas b ON b.id = e.bodega_id
      JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.fuente = 'retiro' AND e.estado = 'pendiente_recibir'
     ORDER BY e.enviado_en, e.id
  `).all().map((e) => {
    const recibido = recibidoDeRetiro(e.id);
    const renglones = db.prepare(`
      SELECT r.producto_id, r.cantidad, p.sku, p.nombre AS producto, p.modelo
        FROM almacen_entrada_renglones r JOIN almacen_productos p ON p.id = r.producto_id
       WHERE r.entrada_id = ? ORDER BY r.orden, r.id
    `).all(e.id).map((r) => ({
      ...r,
      recibido: recibido.get(r.producto_id) || 0,
      por_recibir: Math.max(0, r.cantidad - (recibido.get(r.producto_id) || 0)),
    }));
    return {
      ...e,
      renglones,
      pedido: renglones.reduce((n, r) => n + r.cantidad, 0),
      recibido: renglones.reduce((n, r) => n + r.recibido, 0),
      por_recibir: renglones.reduce((n, r) => n + r.por_recibir, 0),
      abiertos: db.prepare(
        "SELECT COUNT(*) AS n FROM almacen_reingresos WHERE entrada_id = ? AND estado IN ('borrador', 'por_autorizar')"
      ).get(e.id).n,
    };
  });
}

ruta('POST', '/api/almacen/reingresos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'reingresos_capturar');
  if (!usuario) return;

  const retiro = db.prepare('SELECT * FROM almacen_entradas WHERE id = ?').get(Number(cuerpo.entrada_id || 0));
  if (!retiro || retiro.fuente !== 'retiro') return json(res, 400, { error: 'Escoge el retiro al que se le asigna lo que llegó.' });
  if (retiro.estado !== 'pendiente_recibir') {
    return json(res, 409, { error: `El retiro ${retiro.folio} no está pendiente de recibir.` });
  }
  const bodegaId = Number(cuerpo.bodega_id || retiro.bodega_id);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega a la que llegó el material.' });
  }
  const cajas = Math.max(0, Math.trunc(Number(cuerpo.cajas || 0)));

  const id = Number(db.prepare(`
    INSERT INTO almacen_reingresos (folio, entrada_id, bodega_id, fecha, cajas, usuario_id, notas, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('REI', 'almacen_reingresos'), retiro.id, bodegaId,
    cuerpo.fecha || hoyISO(), cajas, usuario.id,
    String(cuerpo.notas || '').trim() || null, new Date().toISOString()).lastInsertRowid);

  json(res, 201, { reingreso: reingresoCompleto(id) });
});

ruta('GET', '/api/almacen/reingresos/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  if (!ACCESO_REINGRESO.some((k) => puede(usuario, k))) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  const g = reingresoCompleto(Number(p[1]));
  if (!g) return json(res, 404, { error: 'Re-ingreso no encontrado' });
  json(res, 200, { reingreso: g, faltantes: faltantesDeReingreso(g) });
});

function reingresoEnBorrador(req, res, id) {
  if (!exigir(req, res, 'reingresos_capturar')) return null;
  const g = db.prepare('SELECT * FROM almacen_reingresos WHERE id = ?').get(id);
  if (!g) { json(res, 404, { error: 'Re-ingreso no encontrado' }); return null; }
  if (g.estado !== 'borrador') {
    json(res, 409, { error: 'Este re-ingreso ya se envió a aprobación. Si hay que cambiarlo, pide que lo regresen.' });
    return null;
  }
  return g;
}

ruta('PUT', '/api/almacen/reingresos/(\\d+)', (req, res, p, cuerpo) => {
  const g = reingresoEnBorrador(req, res, Number(p[1]));
  if (!g) return;
  const bodegaId = Number(cuerpo.bodega_id || g.bodega_id);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega a la que llegó el material.' });
  }
  db.prepare('UPDATE almacen_reingresos SET fecha = ?, cajas = ?, bodega_id = ?, notas = ? WHERE id = ?').run(
    cuerpo.fecha || g.fecha,
    cuerpo.cajas === undefined ? g.cajas : Math.max(0, Math.trunc(Number(cuerpo.cajas || 0))),
    bodegaId,
    String(cuerpo.notas ?? g.notas ?? '').trim() || null,
    g.id
  );
  json(res, 200, { reingreso: reingresoCompleto(g.id) });
});

ruta('POST', '/api/almacen/reingresos/(\\d+)/cajas', (req, res, p, cuerpo) => {
  const g = reingresoEnBorrador(req, res, Number(p[1]));
  if (!g) return;
  const productoId = Number(cuerpo.producto_id || 0);
  if (!db.prepare('SELECT id FROM almacen_productos WHERE id = ? AND activo = 1').get(productoId)) {
    return json(res, 400, { error: 'Escoge un producto del catálogo.' });
  }
  const numero = Math.max(1, Math.trunc(Number(cuerpo.numero || 1)));
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM almacen_reingreso_cajas WHERE reingreso_id = ?')
    .get(g.id).n;
  db.prepare(`
    INSERT INTO almacen_reingreso_cajas (reingreso_id, numero, producto_id, cantidad, observacion, orden)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(g.id, numero, productoId, Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))),
    String(cuerpo.observacion || '').trim() || null, orden);
  json(res, 201, { reingreso: reingresoCompleto(g.id) });
});

ruta('PUT', '/api/almacen/reingreso-cajas/(\\d+)', (req, res, p, cuerpo) => {
  const caja = db.prepare('SELECT * FROM almacen_reingreso_cajas WHERE id = ?').get(Number(p[1]));
  if (!caja) return json(res, 404, { error: 'Caja no encontrada' });
  if (!reingresoEnBorrador(req, res, caja.reingreso_id)) return;
  db.prepare('UPDATE almacen_reingreso_cajas SET numero = ?, cantidad = ?, observacion = ? WHERE id = ?').run(
    cuerpo.numero === undefined ? caja.numero : Math.max(1, Math.trunc(Number(cuerpo.numero || 1))),
    cuerpo.cantidad === undefined ? caja.cantidad : Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))),
    String(cuerpo.observacion ?? caja.observacion ?? '').trim() || null,
    caja.id
  );
  json(res, 200, { reingreso: reingresoCompleto(caja.reingreso_id) });
});

ruta('DELETE', '/api/almacen/reingreso-cajas/(\\d+)', (req, res, p) => {
  const caja = db.prepare('SELECT * FROM almacen_reingreso_cajas WHERE id = ?').get(Number(p[1]));
  if (!caja) return json(res, 404, { error: 'Caja no encontrada' });
  if (!reingresoEnBorrador(req, res, caja.reingreso_id)) return;
  db.prepare('DELETE FROM almacen_reingreso_cajas WHERE id = ?').run(caja.id);
  json(res, 200, { reingreso: reingresoCompleto(caja.reingreso_id) });
});

ruta('POST', '/api/almacen/reingresos/(\\d+)/enviar', (req, res, p) => {
  const base = reingresoEnBorrador(req, res, Number(p[1]));
  if (!base) return;
  const g = reingresoCompleto(base.id);
  const faltas = faltantesDeReingreso(g);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });

  db.prepare(`
    UPDATE almacen_reingresos SET estado = 'por_autorizar', enviado_en = ?,
           correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
     WHERE id = ?
  `).run(new Date().toISOString(), g.id);
  json(res, 200, {
    reingreso: reingresoCompleto(g.id),
    mensaje: 'Re-ingreso enviado a aprobación. El material entra al inventario cuando otra persona lo apruebe.',
  });
});

ruta('POST', '/api/almacen/reingresos/(\\d+)/aprobar', (req, res, p) => {
  const usuario = exigir(req, res, 'reingresos_aprobar');
  if (!usuario) return;
  const g = reingresoCompleto(Number(p[1]));
  if (!g) return json(res, 404, { error: 'Re-ingreso no encontrado' });
  if (g.estado !== 'por_autorizar') return json(res, 409, { error: 'Este re-ingreso no está esperando aprobación.' });
  if (!segundaPersona(res, usuario, g.usuario_id, 'Aprobarlo')) return;
  const faltas = faltantesDeReingreso(g);
  if (faltas.length) return json(res, 409, { error: faltas.join(' ') });

  const ahora = new Date().toISOString();
  let cerrado = false;
  db.exec('BEGIN');
  try {
    for (const f of g.productos) {
      anotarMovimiento({
        fecha: g.fecha, tipo: 'retiro', productoId: f.producto_id,
        destino: g.bodega_id, cantidad: f.cantidad,
        referencia: `${g.folio} · ${g.retiro_folio}`,
        origenTipo: 'reingreso', origenId: g.id, usuarioId: usuario.id,
        notas: `Re-ingreso del retiro ${g.retiro_folio} (${g.plataforma}) · ${f.cajas} caja(s)`,
      });
    }
    db.prepare(`
      UPDATE almacen_reingresos SET estado = 'aplicado', aprobado_por = ?, aprobado_en = ?, aplicado_en = ?
       WHERE id = ?
    `).run(usuario.id, ahora, ahora, g.id);
    cerrado = cerrarRetiroSiLlegoTodo(g.entrada_id, usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    reingreso: reingresoCompleto(g.id),
    mensaje: `Re-ingreso aprobado: ${g.unidades} unidad(es) entraron a ${g.bodega}.`
      + (cerrado ? ` El retiro ${g.retiro_folio} llegó completo y quedó cerrado.` : ''),
  });
});

ruta('POST', '/api/almacen/reingresos/(\\d+)/corregir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'reingresos_aprobar');
  if (!usuario) return;
  const g = db.prepare('SELECT * FROM almacen_reingresos WHERE id = ?').get(Number(p[1]));
  if (!g) return json(res, 404, { error: 'Re-ingreso no encontrado' });
  if (!['por_autorizar', 'aplicado'].includes(g.estado)) {
    return json(res, 409, { error: 'Solo se pide corregir un re-ingreso que ya se envió.' });
  }
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;
  if (g.estado === 'aplicado') {
    const negativo = quedariaNegativo('reingreso', g.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('reingreso', g.id);
    db.prepare(`
      UPDATE almacen_reingresos SET estado = 'borrador', aprobado_por = NULL, aprobado_en = NULL,
             aplicado_en = NULL, enviado_en = NULL,
             correccion_nota = ?, correccion_por = ?, correccion_en = ?
       WHERE id = ?
    `).run(nota, usuario.id, ahora, g.id);
    // Si el retiro se había cerrado por este re-ingreso, vuelve a esperar material.
    db.prepare("UPDATE almacen_entradas SET estado = 'pendiente_recibir', cerrado_en = NULL, cerrado_por = NULL WHERE id = ? AND estado = 'recibido'")
      .run(g.entrada_id);
    anotarCorreccion('reingreso', g.id, g.folio, g.estado, nota, usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    reingreso: reingresoCompleto(g.id),
    mensaje: g.estado === 'aplicado'
      ? 'Regresado a Calidad. Lo que había sumado salió del inventario; al corregirlo vuelve a pasar por aprobación.'
      : 'Regresado a Calidad para corregir.',
  });
});

ruta('POST', '/api/almacen/reingresos/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const g = db.prepare('SELECT * FROM almacen_reingresos WHERE id = ?').get(Number(p[1]));
  if (!g) return json(res, 404, { error: 'Re-ingreso no encontrado' });
  // Lo cancela quien lo aprueba o quien lo levantó mientras siga en captura.
  const suyoEnCaptura = g.estado === 'borrador' && puede(usuario, 'reingresos_capturar');
  if (!puede(usuario, 'reingresos_aprobar') && !suyoEnCaptura) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  if (g.estado === 'cancelado') return json(res, 409, { error: 'Ya estaba cancelado.' });
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué lo cancelas. Queda registrado.' });
  if (g.estado === 'aplicado') {
    const negativo = quedariaNegativo('reingreso', g.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('reingreso', g.id);
    db.prepare("UPDATE almacen_reingresos SET estado = 'cancelado', notas = ? WHERE id = ?")
      .run(`${g.notas ? g.notas + ' · ' : ''}Cancelado: ${motivo}`, g.id);
    db.prepare("UPDATE almacen_entradas SET estado = 'pendiente_recibir', cerrado_en = NULL, cerrado_por = NULL WHERE id = ? AND estado = 'recibido'")
      .run(g.entrada_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true });
});

// --- la ODT de la semana ---
//
// La ODT es contra lo que se coteja lo que sale. En el Excel vivía en una hoja
// que se pegaba cada semana encima de la anterior: no quedaba constancia de lo
// que se había pedido la semana pasada ni de cuánto de eso se surtió.

function odtCompleta(id) {
  const odt = db.prepare(`
    SELECT o.*, b.nombre AS bodega, b.clave AS bodega_clave, u.nombre AS capturo
      FROM almacen_odt o
      LEFT JOIN almacen_bodegas b ON b.id = o.bodega_id
      LEFT JOIN usuarios u ON u.id = o.usuario_id
     WHERE o.id = ?
  `).get(id);
  if (!odt) return null;
  const { renglones, problemas } = requeridoPorODT(odt.id);
  odt.renglones = renglones;
  odt.problemas = problemas;
  odt.citas = db.prepare(
    'SELECT * FROM almacen_odt_citas WHERE odt_id = ? ORDER BY orden, id'
  ).all(odt.id);
  odt.total_unidades = renglones.reduce((s, r) => s + (r.pedidos || 0) * (r.unidades || 0), 0);
  return odt;
}

// Cuánto de la ODT ya se surtió, por producto. Sin esto, dos salidas seguidas
// del mismo material contra la misma orden pasarían las dos como «dentro de lo
// pedido» y saldría el doble.
function surtidoDeODT(odtId) {
  const filas = db.prepare(`
    SELECT r.producto_id, SUM(r.cantidad) AS n
      FROM almacen_salida_renglones r
      JOIN almacen_salidas s ON s.id = r.salida_id
     WHERE s.odt_id = ? AND s.estado = 'aplicada' AND s.motivo <> 'traspaso'
     GROUP BY r.producto_id
  `).all(odtId);
  return new Map(filas.map((f) => [f.producto_id, f.n]));
}

// ------------------------------------------------------------- producción
//
// La ODT de la semana vive aquí, no en Almacén. Es lo que producción va a armar;
// Almacén solo surte contra ella. Cargarla es un acto de producción y por eso
// pide 'produccion_capturar'; consultarla la puede ver cualquiera que entre al
// módulo, porque de ella salen los traspasos que Almacén tendrá que mover.

// La ODT sin publicar solo la ve quien la carga: todavía se está repartiendo y
// cualquier número puede cambiar. Publicada, la ve todo producción.
const veODT = (usuario, odt) => !!odt && (!!odt.publicada_en || puede(usuario, 'produccion_odt_cargar'));

function datosDeODT(odt, usuario) {
  if (!odt.publicada_en && !db.prepare('SELECT 1 FROM produccion_reparto WHERE odt_id = ? LIMIT 1').get(odt.id)) {
    repartirLoEvidente(odt.id);
  }
  const completa = odtCompleta(odt.id);
  return {
    odt: completa,
    evaluacion: evaluarODT(completa),
    surtido: [...surtidoDeODT(odt.id)],
    traspasos: traspasosDeODT(odt.id),
    tablero: tableroODT(odt.id),
    modificaciones: modificacionesDeODT(odt.id),
    puede_publicar: puede(usuario, 'produccion_odt_cargar'),
    bodega_armado: bodegaDeArmado(),
    bodegas: bodegasActivas(),
    semana: semanaISO(),
  };
}

ruta('GET', '/api/produccion/odt', (req, res) => {
  const usuario = exigir(req, res, 'mod_produccion');
  if (!usuario) return;
  const url = new URL(req.url, 'http://x');
  const semana = url.searchParams.get('semana');
  if (semana) {
    const odt = odtDeSemana(semana);
    if (!odt) {
      return json(res, 200, { odt: null, bodega_armado: bodegaDeArmado(), bodegas: bodegasActivas(), semana: semanaISO() });
    }
    if (!veODT(usuario, odt)) {
      return json(res, 200, { odt: null, sin_publicar: true, bodega_armado: bodegaDeArmado(), bodegas: bodegasActivas(), semana: semanaISO() });
    }
    return json(res, 200, datosDeODT(odt, usuario));
  }
  const cargador = puede(usuario, 'produccion_odt_cargar');
  json(res, 200, {
    bodega_armado: bodegaDeArmado(),
    bodegas: bodegasActivas(),
    semana: semanaISO(),
    ordenes: db.prepare(`
      SELECT o.id, o.semana, o.estado, o.publicada_en,
             (SELECT COUNT(*) FROM almacen_odt_renglones r WHERE r.odt_id = o.id) AS renglones
        FROM almacen_odt o
       ${cargador ? '' : 'WHERE o.publicada_en IS NOT NULL'}
       ORDER BY o.semana DESC LIMIT 60
    `).all().map((o) => {
      const t = tableroODT(o.id);
      return { ...o, avance: t.semana.pct, armado: t.semana.armado, total: t.semana.total };
    }),
  });
});

ruta('POST', '/api/produccion/odt', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'produccion_capturar');
  if (!usuario) return;

  const semana = String(cuerpo.semana || semanaISO()).trim();
  if (!/^\d{4}-W\d{2}$/.test(semana)) return json(res, 400, { error: 'La semana va como 2026-W35.' });
  if (odtDeSemana(semana)) return json(res, 409, { error: `Ya hay una ODT cargada para ${describirSemana(semana)}.` });

  // La bodega de armado ya no se pregunta: la dice el catálogo. Se guarda en la
  // ODT como constancia de contra cuál se evaluó ese día.
  const id = Number(db.prepare(
    'INSERT INTO almacen_odt (semana, bodega_id, usuario_id, creado_en) VALUES (?, ?, ?, ?)'
  ).run(semana, bodegaDeArmado().id, usuario.id, new Date().toISOString()).lastInsertRowid);
  json(res, 201, { odt: odtCompleta(id) });
});

ruta('GET', '/api/produccion/odt/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'mod_produccion');
  if (!usuario) return;
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(Number(p[1]));
  if (!odt) return json(res, 404, { error: 'ODT no encontrada' });
  if (!veODT(usuario, odt)) return json(res, 403, { error: 'Esta ODT todavía no se publica.' });
  json(res, 200, datosDeODT(odt, usuario));
});

// La carga de la ODT es un pegue de muchos renglones a la vez: se copia del
// reporte de la plataforma. Se reemplaza entera en lugar de ir renglón por
// renglón porque así es como llega, y así se evita que quede mezclada media
// orden vieja con media nueva.
ruta('PUT', '/api/produccion/odt/(\\d+)/renglones', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'produccion_capturar');
  if (!usuario) return;
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(Number(p[1]));
  if (!odt) return json(res, 404, { error: 'ODT no encontrada' });
  if (odt.estado !== 'abierta') return json(res, 409, { error: 'Esa ODT ya está cerrada.' });
  if (odt.publicada_en) return json(res, 409, { error: 'La ODT ya está publicada: se cambia con una modificación aprobada.' });

  const renglones = Array.isArray(cuerpo.renglones) ? cuerpo.renglones : [];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM almacen_odt_renglones WHERE odt_id = ?').run(odt.id);
    const insert = db.prepare(
      'INSERT INTO almacen_odt_renglones (odt_id, codigo, pedidos, orden) VALUES (?, ?, ?, ?)'
    );
    renglones.forEach((r, i) => {
      const codigo = String(r.codigo || '').trim().toUpperCase();
      if (!codigo) return;
      insert.run(odt.id, codigo, Math.max(0, Math.trunc(Number(r.pedidos || 0))), i);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const actual = odtCompleta(odt.id);
  json(res, 200, { odt: actual, evaluacion: evaluarODT(actual) });
});

ruta('POST', '/api/produccion/odt/(\\d+)/cerrar', (req, res, p) => {
  const usuario = exigir(req, res, 'produccion_capturar');
  if (!usuario) return;
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(Number(p[1]));
  if (!odt) return json(res, 404, { error: 'ODT no encontrada' });
  db.prepare("UPDATE almacen_odt SET estado = ?, cerrado_en = ? WHERE id = ?")
    .run(odt.estado === 'abierta' ? 'cerrada' : 'abierta',
      odt.estado === 'abierta' ? new Date().toISOString() : null, odt.id);
  json(res, 200, { odt: odtCompleta(odt.id) });
});

// --- cargar la ODT desde el Excel ---
//
// La ODT llega cada semana como archivo: el periodo, las citas de entrega en
// CEDIS y, por cada cuenta de Mercado Libre, qué publicaciones se arman y
// cuántas. Antes esto se pegaba a mano como texto; pegar 102 renglones a mano
// es exactamente donde se cuela un dígito de más.
//
// La semana NO se pregunta: sale del periodo que trae el archivo. Escribirla
// aparte permitía cargar la ODT del 27 de agosto sobre la semana equivocada.

const LIMITE_ODT = 8 * 1024 * 1024;

ruta('POST', '/api/produccion/odt/importar', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'produccion_capturar');
  if (!usuario) return;

  const base64 = String(cuerpo.archivo || '').replace(/^data:[^,]*,/, '');
  if (!base64) return json(res, 400, { error: 'No llegó el archivo.' });
  const binario = Buffer.from(base64, 'base64');
  if (!binario.length) return json(res, 400, { error: 'El archivo llegó vacío.' });
  if (binario.length > LIMITE_ODT) return json(res, 413, { error: 'El archivo pesa demasiado.' });

  let leido;
  try {
    leido = leerODT(binario);
  } catch (err) {
    // El error del lector explica qué faltó; se pasa tal cual porque está
    // escrito para que lo entienda quien cargó el archivo, no para el registro.
    return json(res, 400, { error: err.message });
  }

  const inicio = leido.periodo;
  const semana = semanaISO(new Date(inicio.anio, inicio.mes - 1, inicio.dia));

  const previa = odtDeSemana(semana);
  // Ya publicada, la ODT no se reemplaza con otro archivo: producción ya está
  // armando contra ella. Lo que cambie va como modificación aprobada.
  if (previa && previa.publicada_en) {
    return json(res, 409, {
      error: `La ODT de ${describirSemana(semana)} ya está publicada. Para cambiarla, pide una modificación a la partida.`,
    });
  }
  if (previa && !cuerpo.reemplazar) {
    return json(res, 409, {
      error: `Ya hay una ODT cargada para ${describirSemana(semana)}.`,
      semana,
      odt_id: previa.id,
      // La pantalla usa esto para ofrecer reemplazarla en vez de dejar a
      // alguien atorado sin saber qué hacer con el archivo que ya trae.
      puede_reemplazar: previa.estado === 'abierta',
    });
  }
  if (previa && previa.estado !== 'abierta') {
    return json(res, 409, { error: `La ODT de ${describirSemana(semana)} ya está cerrada; no se reemplaza.` });
  }

  const renglones = [];
  const citas = [];
  for (const c of leido.cuentas) {
    for (const r of c.renglones) renglones.push({ ...r, cuenta: c.cuenta });
    for (const x of c.citas) citas.push({ ...x, cuenta: c.cuenta });
  }
  // Primero por fecha, que es como se surten; las que no traen fecha, al final.
  citas.sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));

  const ahora = new Date().toISOString();
  const archivo = String(cuerpo.nombre || '').trim().slice(0, 200) || null;
  let odtId = previa ? previa.id : null;

  db.exec('BEGIN');
  try {
    if (previa) {
      db.prepare('DELETE FROM almacen_odt_renglones WHERE odt_id = ?').run(previa.id);
      db.prepare('DELETE FROM almacen_odt_citas WHERE odt_id = ?').run(previa.id);
      db.prepare(`
        UPDATE almacen_odt SET periodo = ?, archivo = ?, importado_en = ?, usuario_id = ?
         WHERE id = ?
      `).run(inicio.texto, archivo, ahora, usuario.id, previa.id);
    } else {
      odtId = Number(db.prepare(`
        INSERT INTO almacen_odt (semana, bodega_id, usuario_id, creado_en, periodo, archivo, importado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(semana, bodegaDeArmado().id, usuario.id, ahora, inicio.texto, archivo, ahora).lastInsertRowid);
    }

    const insR = db.prepare(`
      INSERT INTO almacen_odt_renglones (odt_id, codigo, pedidos, orden, cuenta, tipo)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    renglones.forEach((r, i) => insR.run(odtId, r.codigo, Math.max(0, Math.trunc(r.pedidos || 0)), i, r.cuenta, r.tipo));

    const insC = db.prepare(`
      INSERT INTO almacen_odt_citas (odt_id, cuenta, fecha, etiqueta, folio, cedis, destacada, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    citas.forEach((c, i) => insC.run(odtId, c.cuenta, c.fecha, c.etiqueta, c.folio, c.cedis, c.destacada ? 1 : 0, i));

    repartirLoEvidente(odtId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const odt = odtCompleta(odtId);
  json(res, previa ? 200 : 201, {
    odt,
    evaluacion: evaluarODT(odt),
    reemplazada: !!previa,
    resumen: {
      archivo,
      hoja: leido.hoja,
      periodo: inicio.texto,
      semana,
      cuentas: leido.cuentas.map((c) => ({
        cuenta: c.cuenta,
        publicaciones: c.renglones.length,
        rollos: c.renglones.reduce((s, r) => s + (r.total_archivo || 0), 0),
        citas: c.citas.length,
      })),
      citas: citas.length,
      publicaciones: renglones.length,
      // Lo que el archivo traía mal cuadrado, más lo que el catálogo no supo
      // traducir: son dos revisiones distintas y las dos importan.
      problemas_archivo: leido.problemas,
      problemas_catalogo: odt.problemas,
    },
  });
});

// --- el reparto, la publicación y el avance de la ODT ---
//
// El Excel trae las citas de entrega pero no cuánto de cada partida va en cada
// una. Lo reparte quien carga la ODT; lo que es evidente —una cuenta con un solo
// envío— se reparte solo al importar. Ya repartida, se PUBLICA: desde ahí la ve
// todo producción y nadie la cambia. Contra ese reparto se mide el avance por
// envío y por día.

// Lo que es evidente: si la cuenta de una partida tiene un solo envío, todo va ahí.
function repartirLoEvidente(odtId) {
  const citas = db.prepare('SELECT id, cuenta FROM almacen_odt_citas WHERE odt_id = ?').all(odtId);
  const alta = db.prepare(`
    INSERT INTO produccion_reparto (odt_id, renglon_id, cita_id, cantidad) VALUES (?, ?, ?, ?)
    ON CONFLICT (renglon_id, cita_id) DO NOTHING
  `);
  for (const r of db.prepare('SELECT id, cuenta, pedidos FROM almacen_odt_renglones WHERE odt_id = ?').all(odtId)) {
    const suyas = citas.filter((c) => (c.cuenta || '') === (r.cuenta || ''));
    const opciones = suyas.length ? suyas : citas;
    if (opciones.length === 1 && r.pedidos > 0) alta.run(odtId, r.id, opciones[0].id, r.pedidos);
  }
}

// Las citas a las que puede ir una partida: las de su misma cuenta. Si el
// archivo no dice cuenta, cualquiera de la ODT.
function citasDeRenglon(renglon, citas) {
  const suyas = citas.filter((c) => (c.cuenta || '') === (renglon.cuenta || ''));
  return suyas.length ? suyas : citas;
}

// El tablero de la ODT: cuánto pide cada partida en cada envío, cuánto se armó,
// y el avance de la semana, de cada día y de cada envío.
// Cómo va el armado del envío de la ODT que lleva un número de Tránsito.
ruta('GET', '/api/transito/envio-odt', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const numero = new URL(req.url, 'http://x').searchParams.get('numero');
  json(res, 200, { envio: envioDeODT(numero) });
});

function tableroODT(odtId) {
  const hoy = hoyISO();
  const citas = db.prepare('SELECT * FROM almacen_odt_citas WHERE odt_id = ? ORDER BY fecha, orden, id').all(odtId);
  const reparto = new Map();
  for (const f of db.prepare('SELECT renglon_id, cita_id, cantidad FROM produccion_reparto WHERE odt_id = ?').all(odtId)) {
    reparto.set(`${f.renglon_id}|${f.cita_id}`, f.cantidad);
  }
  const armado = new Map();
  for (const f of db.prepare(`
    SELECT renglon_id, cita_id, SUM(cantidad) AS n FROM produccion_avances WHERE odt_id = ? GROUP BY renglon_id, cita_id
  `).all(odtId)) armado.set(`${f.renglon_id}|${f.cita_id}`, f.n);

  const pendientesMod = new Set(db.prepare(
    "SELECT renglon_id FROM produccion_modificaciones WHERE odt_id = ? AND estado = 'por_aprobar'"
  ).all(odtId).map((f) => f.renglon_id));

  const renglones = requeridoPorODT(odtId).renglones.map((r) => {
    const opciones = citasDeRenglon(r, citas);
    const porEnvio = opciones.map((c) => ({
      cita_id: c.id,
      cantidad: reparto.get(`${r.id}|${c.id}`) || 0,
      armado: armado.get(`${r.id}|${c.id}`) || 0,
    }));
    const repartido = porEnvio.reduce((n, x) => n + x.cantidad, 0);
    const hecho = porEnvio.reduce((n, x) => n + x.armado, 0);
    return {
      id: r.id, codigo: r.codigo, publicacion: r.publicacion, modelo: r.modelo, producto: r.producto,
      cuenta: r.cuenta, tipo: r.tipo, pedidos: r.pedidos, unidades_publicacion: r.unidades,
      envios: porEnvio, repartido, armado: hecho, pendiente: Math.max(0, r.pedidos - hecho),
      reparto_completo: repartido === r.pedidos,
      modificacion_pendiente: pendientesMod.has(r.id),
    };
  });

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const deTransito = enviosTransitoPorNumero();
  const envios = citas.map((c) => {
    const total = renglones.reduce((n, r) => n + ((r.envios.find((x) => x.cita_id === c.id) || {}).cantidad || 0), 0);
    const hecho = renglones.reduce((n, r) => n + ((r.envios.find((x) => x.cita_id === c.id) || {}).armado || 0), 0);
    const completo = total > 0 && hecho >= total;
    return {
      ...c, total, armado: hecho, pct: pct(hecho, total),
      // El checklist de Tránsito que lleva este envío, si ya se abrió.
      transito: deTransito.get(soloDigitos(c.folio)) || null,
      // Atrasado: su día ya llegó y no está completo.
      situacion: completo ? 'completo' : (c.fecha && c.fecha <= hoy ? 'atrasado' : 'en_tiempo'),
    };
  });

  // Por día: lo que hay que tener listo cada día es lo de los envíos de ese día.
  const dias = [...new Set(envios.map((e) => e.fecha || 'sin fecha'))].map((fecha) => {
    const suyos = envios.filter((e) => (e.fecha || 'sin fecha') === fecha);
    const total = suyos.reduce((n, e) => n + e.total, 0);
    const hecho = suyos.reduce((n, e) => n + e.armado, 0);
    return { fecha, envios: suyos.length, total, armado: hecho, pct: pct(hecho, total),
      situacion: total && hecho >= total ? 'completo' : (fecha !== 'sin fecha' && fecha <= hoy ? 'atrasado' : 'en_tiempo') };
  });

  const personas = db.prepare(`
    SELECT u.id, u.nombre, SUM(a.cantidad) AS armado, COUNT(*) AS registros,
           MIN(a.en) AS primero, MAX(a.en) AS ultimo
      FROM produccion_avances a JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.odt_id = ? GROUP BY u.id ORDER BY armado DESC
  `).all(odtId);

  const total = renglones.reduce((n, r) => n + r.pedidos, 0);
  const hecho = renglones.reduce((n, r) => n + r.armado, 0);
  return {
    renglones,
    envios,
    dias,
    personas,
    semana: { total, armado: hecho, pct: pct(hecho, total) },
    reparto_completo: renglones.every((r) => r.pedidos === 0 || r.reparto_completo),
    sin_repartir: renglones.filter((r) => r.pedidos > 0 && !r.reparto_completo).length,
  };
}

const modificacionesDeODT = (odtId) => db.prepare(`
  SELECT m.*, u.nombre AS pidio, q.nombre AS resolvio, r.codigo
    FROM produccion_modificaciones m
    JOIN usuarios u ON u.id = m.usuario_id
    LEFT JOIN usuarios q ON q.id = m.resuelto_por
    JOIN almacen_odt_renglones r ON r.id = m.renglon_id
   WHERE m.odt_id = ? ORDER BY m.id DESC
`).all(odtId).map((m) => ({ ...m, cambios: JSON.parse(m.cambios || '[]') }));

function odtParaRepartir(req, res, id) {
  if (!exigir(req, res, 'produccion_odt_cargar')) return null;
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(id);
  if (!odt) { json(res, 404, { error: 'ODT no encontrada' }); return null; }
  if (odt.publicada_en) { json(res, 409, { error: 'La ODT ya está publicada: se cambia con una modificación aprobada.' }); return null; }
  return odt;
}

// El reparto llega completo —toda la matriz partida × envío— y reemplaza al anterior.
ruta('PUT', '/api/produccion/odt/(\\d+)/reparto', (req, res, p, cuerpo) => {
  const odt = odtParaRepartir(req, res, Number(p[1]));
  if (!odt) return;
  const citas = new Set(db.prepare('SELECT id FROM almacen_odt_citas WHERE odt_id = ?').all(odt.id).map((c) => c.id));
  const renglones = new Set(db.prepare('SELECT id FROM almacen_odt_renglones WHERE odt_id = ?').all(odt.id).map((r) => r.id));
  const filas = Array.isArray(cuerpo.reparto) ? cuerpo.reparto : [];
  db.exec('BEGIN');
  try {
    const alta = db.prepare(`
      INSERT INTO produccion_reparto (odt_id, renglon_id, cita_id, cantidad) VALUES (?, ?, ?, ?)
      ON CONFLICT (renglon_id, cita_id) DO UPDATE SET cantidad = excluded.cantidad
    `);
    for (const f of filas) {
      const renglon = Number(f.renglon_id);
      const cita = Number(f.cita_id);
      if (!renglones.has(renglon) || !citas.has(cita)) continue;
      alta.run(odt.id, renglon, cita, Math.max(0, Math.trunc(Number(f.cantidad || 0))));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const t = tableroODT(odt.id);
  json(res, 200, { tablero: t, mensaje: t.reparto_completo
    ? 'Reparto guardado: ya cuadra. Puedes publicar la ODT.'
    : `Reparto guardado. Faltan ${t.sin_repartir} partida(s) por cuadrar.` });
});

ruta('POST', '/api/produccion/odt/(\\d+)/publicar', (req, res, p) => {
  const odt = odtParaRepartir(req, res, Number(p[1]));
  if (!odt) return;
  const usuario = exigir(req, res, 'produccion_odt_cargar');
  const t = tableroODT(odt.id);
  if (!t.renglones.length) return json(res, 400, { error: 'La ODT no tiene partidas.' });
  if (!t.reparto_completo) {
    const malas = t.renglones.filter((r) => r.pedidos > 0 && !r.reparto_completo).slice(0, 4)
      .map((r) => `${r.codigo} (pide ${r.pedidos}, repartidas ${r.repartido})`);
    return json(res, 400, { error: `Falta repartir por envío ${t.sin_repartir} partida(s): ${malas.join(', ')}${t.sin_repartir > 4 ? '…' : ''}.` });
  }
  db.prepare('UPDATE almacen_odt SET publicada_en = ?, publicada_por = ? WHERE id = ?')
    .run(new Date().toISOString(), usuario.id, odt.id);
  json(res, 200, { mensaje: 'ODT publicada. Ya la ve todo producción y empieza a contar el avance.' });
});

// Regresarla a preparación solo mientras nadie haya armado nada contra ella.
ruta('POST', '/api/produccion/odt/(\\d+)/despublicar', (req, res, p) => {
  if (!exigir(req, res, 'produccion_odt_cargar')) return;
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(Number(p[1]));
  if (!odt) return json(res, 404, { error: 'ODT no encontrada' });
  if (!odt.publicada_en) return json(res, 409, { error: 'La ODT no está publicada.' });
  if (db.prepare('SELECT 1 FROM produccion_avances WHERE odt_id = ? LIMIT 1').get(odt.id)) {
    return json(res, 409, { error: 'Ya se armó algo contra esta ODT: ya no se despublica. Pide una modificación.' });
  }
  db.prepare('UPDATE almacen_odt SET publicada_en = NULL, publicada_por = NULL WHERE id = ?').run(odt.id);
  json(res, 200, { mensaje: 'ODT de regreso en preparación. Nadie más la ve hasta que se vuelva a publicar.' });
});

// Anotar lo que se armó. Nunca más de lo que falta de esa partida en ese envío.
ruta('POST', '/api/produccion/avances', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'produccion_armar');
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_odt_renglones WHERE id = ?').get(Number(cuerpo.renglon_id || 0));
  if (!renglon) return json(res, 404, { error: 'Partida no encontrada' });
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(renglon.odt_id);
  if (!odt.publicada_en) return json(res, 409, { error: 'La ODT todavía no se publica.' });
  if (odt.estado !== 'abierta') return json(res, 409, { error: 'Esa ODT ya está cerrada.' });
  const citaId = Number(cuerpo.cita_id || 0);
  const cantidad = Math.trunc(Number(cuerpo.cantidad || 0));
  if (cantidad <= 0) return json(res, 400, { error: 'Anota cuántas armaste.' });

  const t = tableroODT(odt.id);
  const envio = (t.renglones.find((r) => r.id === renglon.id) || { envios: [] }).envios.find((e) => e.cita_id === citaId);
  if (!envio || !envio.cantidad) return json(res, 400, { error: 'Esa partida no va en ese envío.' });
  const falta = envio.cantidad - envio.armado;
  if (cantidad > falta) {
    return json(res, 400, { error: `De esa partida para ese envío solo faltan ${falta}.` });
  }
  db.prepare(`
    INSERT INTO produccion_avances (odt_id, renglon_id, cita_id, cantidad, usuario_id, en, nota)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(odt.id, renglon.id, citaId, cantidad, usuario.id, new Date().toISOString(),
    String(cuerpo.nota || '').trim() || null);
  json(res, 201, { tablero: tableroODT(odt.id), mensaje: `Anotado: ${cantidad} armada(s).` });
});

// Lo que uno mismo anotó por error se quita el mismo día. Después, o si lo anotó
// otra persona, solo quien aprueba modificaciones.
ruta('DELETE', '/api/produccion/avances/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const a = db.prepare('SELECT * FROM produccion_avances WHERE id = ?').get(Number(p[1]));
  if (!a) return json(res, 404, { error: 'Registro no encontrado' });
  const suyoDeHoy = a.usuario_id === usuario.id && (hoyISO(new Date(a.en)) === hoyISO() || enPrueba());
  if (!suyoDeHoy && !puede(usuario, 'produccion_modificacion_aprobar')) {
    return json(res, 403, { error: 'Solo quien lo anotó, el mismo día, o quien aprueba modificaciones lo puede quitar.' });
  }
  db.prepare('DELETE FROM produccion_avances WHERE id = ?').run(a.id);
  json(res, 200, { tablero: tableroODT(a.odt_id) });
});

ruta('GET', '/api/produccion/odt/(\\d+)/avances', (req, res, p) => {
  const usuario = exigir(req, res, 'mod_produccion');
  if (!usuario) return;
  json(res, 200, {
    avances: db.prepare(`
      SELECT a.id, a.renglon_id, a.cita_id, a.cantidad, a.en, a.nota, a.usuario_id, u.nombre AS quien,
             r.codigo, c.etiqueta AS envio, c.folio
        FROM produccion_avances a
        JOIN usuarios u ON u.id = a.usuario_id
        JOIN almacen_odt_renglones r ON r.id = a.renglon_id
        JOIN almacen_odt_citas c ON c.id = a.cita_id
       WHERE a.odt_id = ? ORDER BY a.en DESC LIMIT 300
    `).all(Number(p[1])),
  });
});

// --- modificaciones a la ODT publicada ---
//
// La ODT publicada no se edita. Si a producción no le alcanza el material para
// una partida, pide una modificación: cuánto queda en cada envío y por qué. Otra
// persona la aprueba y solo entonces cambia la ODT. Nunca por debajo de lo ya
// armado: eso ya existe.

function validarCambios(renglon, cambios, tablero) {
  const r = tablero.renglones.find((x) => x.id === renglon.id);
  if (!r) return { error: 'Partida no encontrada.' };
  const finales = r.envios.map((e) => {
    const c = cambios.find((x) => Number(x.cita_id) === e.cita_id);
    const despues = c ? Math.max(0, Math.trunc(Number(c.despues || 0))) : e.cantidad;
    return { cita_id: e.cita_id, antes: e.cantidad, despues, armado: e.armado };
  });
  const bajo = finales.find((f) => f.despues < f.armado);
  if (bajo) return { error: `Un envío quedaría en ${bajo.despues} y ya se armaron ${bajo.armado}.` };
  const cambiados = finales.filter((f) => f.despues !== f.antes);
  if (!cambiados.length) return { error: 'No cambiaste ninguna cantidad.' };
  return { cambios: cambiados, total: finales.reduce((n, f) => n + f.despues, 0) };
}

ruta('POST', '/api/produccion/modificaciones', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'produccion_modificacion_pedir');
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_odt_renglones WHERE id = ?').get(Number(cuerpo.renglon_id || 0));
  if (!renglon) return json(res, 404, { error: 'Partida no encontrada' });
  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(renglon.odt_id);
  if (!odt.publicada_en) return json(res, 409, { error: 'La ODT todavía no se publica: quien la carga todavía puede cambiarla.' });
  if (odt.estado !== 'abierta') return json(res, 409, { error: 'Esa ODT ya está cerrada.' });
  if (db.prepare("SELECT 1 FROM produccion_modificaciones WHERE renglon_id = ? AND estado = 'por_aprobar'").get(renglon.id)) {
    return json(res, 409, { error: 'Esa partida ya tiene una modificación esperando aprobación.' });
  }
  const motivo = String(cuerpo.motivo || '').trim();
  if (motivo.length < 5) return json(res, 400, { error: 'Explica por qué hay que cambiarla: lo va a leer quien apruebe.' });

  const v = validarCambios(renglon, Array.isArray(cuerpo.cambios) ? cuerpo.cambios : [], tableroODT(odt.id));
  if (v.error) return json(res, 400, { error: v.error });
  db.prepare(`
    INSERT INTO produccion_modificaciones (odt_id, renglon_id, cambios, pedidos_antes, pedidos_despues, motivo, usuario_id, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(odt.id, renglon.id, JSON.stringify(v.cambios.map(({ cita_id, antes, despues }) => ({ cita_id, antes, despues }))),
    renglon.pedidos, v.total, motivo, usuario.id, new Date().toISOString());
  json(res, 201, { mensaje: 'Modificación enviada a aprobación. La ODT cambia cuando otra persona la apruebe.' });
});

ruta('POST', '/api/produccion/modificaciones/(\\d+)/(aprobar|rechazar|cancelar)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const m = db.prepare('SELECT * FROM produccion_modificaciones WHERE id = ?').get(Number(p[1]));
  if (!m) return json(res, 404, { error: 'Modificación no encontrada' });
  if (m.estado !== 'por_aprobar') return json(res, 409, { error: 'Esa modificación ya se resolvió.' });
  const ahora = new Date().toISOString();

  if (p[2] === 'cancelar') {
    if (m.usuario_id !== usuario.id && usuario.rol !== 'admin') {
      return json(res, 403, { error: 'Solo quien la pidió la puede cancelar.' });
    }
    db.prepare("UPDATE produccion_modificaciones SET estado = 'cancelada', resuelto_por = ?, resuelto_en = ? WHERE id = ?")
      .run(usuario.id, ahora, m.id);
    return json(res, 200, { mensaje: 'Modificación cancelada.' });
  }

  if (!puede(usuario, 'produccion_modificacion_aprobar')) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  if (!segundaPersona(res, usuario, m.usuario_id, p[2] === 'aprobar' ? 'Aprobarla' : 'Rechazarla')) return;

  if (p[2] === 'rechazar') {
    const nota = notaDeCorreccion(res, cuerpo);
    if (nota === null) return;
    db.prepare("UPDATE produccion_modificaciones SET estado = 'rechazada', resuelto_por = ?, resuelto_en = ?, nota_resolucion = ? WHERE id = ?")
      .run(usuario.id, ahora, nota, m.id);
    return json(res, 200, { mensaje: 'Modificación rechazada. La ODT sigue como estaba.' });
  }

  // Se vuelve a validar: entre que se pidió y se aprueba pudieron armar más.
  const renglon = db.prepare('SELECT * FROM almacen_odt_renglones WHERE id = ?').get(m.renglon_id);
  const pedidos = JSON.parse(m.cambios);
  const v = validarCambios(renglon, pedidos, tableroODT(m.odt_id));
  if (v.error) return json(res, 409, { error: `Ya no se puede aplicar: ${v.error}` });

  db.exec('BEGIN');
  try {
    const alta = db.prepare(`
      INSERT INTO produccion_reparto (odt_id, renglon_id, cita_id, cantidad) VALUES (?, ?, ?, ?)
      ON CONFLICT (renglon_id, cita_id) DO UPDATE SET cantidad = excluded.cantidad
    `);
    for (const c of v.cambios) alta.run(m.odt_id, m.renglon_id, c.cita_id, c.despues);
    db.prepare('UPDATE almacen_odt_renglones SET pedidos = ? WHERE id = ?').run(v.total, m.renglon_id);
    db.prepare("UPDATE produccion_modificaciones SET estado = 'aprobada', resuelto_por = ?, resuelto_en = ?, nota_resolucion = ? WHERE id = ?")
      .run(usuario.id, ahora, String((cuerpo || {}).nota || '').trim() || null, m.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { mensaje: `Modificación aprobada: la partida ${renglon.codigo} queda en ${v.total}.` });
});

// --- reporte de Producción ---
//
// Por rango de fechas: cuánto armó cada quien y a qué ritmo, cómo va cada ODT,
// si cada envío quedó listo antes de su día, y las modificaciones que se
// pidieron. Todo sale de lo que cada quien anotó.
ruta('GET', '/api/produccion/reportes', (req, res) => {
  if (!exigir(req, res, 'produccion_reportes')) return;
  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const hasta = fecha(url.searchParams.get('hasta')) || hoyISO();
  const hace28 = new Date();
  hace28.setDate(hace28.getDate() - 27);
  const desde = fecha(url.searchParams.get('desde')) || hoyISO(hace28);
  if (desde > hasta) return json(res, 400, { error: 'La fecha inicial queda después de la final.' });

  // La fecha del registro en hora de México: se anota en UTC.
  const avances = db.prepare(`
    SELECT a.*, u.nombre AS quien, o.semana
      FROM produccion_avances a JOIN usuarios u ON u.id = a.usuario_id JOIN almacen_odt o ON o.id = a.odt_id
     ORDER BY a.en
  `).all().map((a) => ({ ...a, dia: hoyISO(new Date(a.en)) }))
    .filter((a) => a.dia >= desde && a.dia <= hasta);

  const dias = [...new Set(avances.map((a) => a.dia))].sort();
  const porPersona = new Map();
  for (const a of avances) {
    if (!porPersona.has(a.usuario_id)) porPersona.set(a.usuario_id, { usuario_id: a.usuario_id, quien: a.quien, armado: 0, registros: 0, dias: new Set(), por_dia: {}, horas: 0 });
    const f = porPersona.get(a.usuario_id);
    f.armado += a.cantidad;
    f.registros++;
    f.dias.add(a.dia);
    f.por_dia[a.dia] = (f.por_dia[a.dia] || 0) + a.cantidad;
  }
  // Horas trabajadas aproximadas: del primer al último registro de cada día.
  for (const f of porPersona.values()) {
    for (const d of f.dias) {
      const suyos = avances.filter((a) => a.usuario_id === f.usuario_id && a.dia === d);
      const horas = (Date.parse(suyos[suyos.length - 1].en) - Date.parse(suyos[0].en)) / 3600000;
      f.horas += Math.max(horas, 0.5);
    }
  }
  const personas = [...porPersona.values()].map((f) => ({
    usuario_id: f.usuario_id, quien: f.quien, armado: f.armado, registros: f.registros,
    dias: f.dias.size, por_dia: f.por_dia,
    promedio_dia: Math.round(f.armado / Math.max(1, f.dias.size)),
    por_hora: Math.round((f.armado / Math.max(0.5, f.horas)) * 10) / 10,
  })).sort((a, b) => b.armado - a.armado);

  // Las ODT de las semanas del rango, con su avance y el cumplimiento por envío.
  const semanas = new Set();
  for (let d = new Date(`${desde}T12:00:00`); hoyISO(d) <= hasta; d.setDate(d.getDate() + 1)) semanas.add(semanaISO(d));
  const odts = db.prepare('SELECT * FROM almacen_odt WHERE publicada_en IS NOT NULL ORDER BY semana').all()
    .filter((o) => semanas.has(o.semana)).map((o) => {
      const t = tableroODT(o.id);
      return {
        id: o.id, semana: o.semana, estado: o.estado, publicada_en: o.publicada_en, ...t.semana,
        envios: t.envios.map((e) => {
          // Cuándo quedó completo: el registro que lo terminó de llenar.
          let acumulado = 0;
          let completo_en = null;
          for (const a of db.prepare('SELECT cantidad, en FROM produccion_avances WHERE cita_id = ? ORDER BY en').all(e.id)) {
            acumulado += a.cantidad;
            if (!completo_en && e.total && acumulado >= e.total) completo_en = a.en;
          }
          const aTiempo = completo_en && e.fecha ? hoyISO(new Date(completo_en)) <= e.fecha : null;
          return { id: e.id, etiqueta: e.etiqueta, fecha: e.fecha, folio: e.folio, cedis: e.cedis, cuenta: e.cuenta,
            total: e.total, armado: e.armado, pct: e.pct, completo_en, a_tiempo: aTiempo, situacion: e.situacion };
        }),
        modificaciones: db.prepare("SELECT COUNT(*) AS n FROM produccion_modificaciones WHERE odt_id = ? AND estado = 'aprobada'").get(o.id).n,
      };
    });

  const modificaciones = db.prepare(`
    SELECT m.*, u.nombre AS pidio, q.nombre AS resolvio, r.codigo, o.semana
      FROM produccion_modificaciones m
      JOIN usuarios u ON u.id = m.usuario_id
      LEFT JOIN usuarios q ON q.id = m.resuelto_por
      JOIN almacen_odt_renglones r ON r.id = m.renglon_id
      JOIN almacen_odt o ON o.id = m.odt_id
     WHERE substr(m.creado_en, 1, 10) BETWEEN ? AND ?
     ORDER BY m.id DESC
  `).all(desde, hasta);

  const envios = odts.flatMap((o) => o.envios.filter((e) => e.total));
  json(res, 200, {
    desde, hasta, dias,
    resumen: {
      armado: avances.reduce((n, a) => n + a.cantidad, 0),
      personas: personas.length,
      odts: odts.length,
      envios: envios.length,
      envios_a_tiempo: envios.filter((e) => e.a_tiempo === true).length,
      envios_tarde: envios.filter((e) => e.a_tiempo === false).length,
      envios_atrasados: envios.filter((e) => e.situacion === 'atrasado').length,
      modificaciones: modificaciones.length,
    },
    personas,
    odts,
    modificaciones,
  });
});

// --- el traspaso que sale de la ODT ---

const traspasosDeODT = (odtId) => db.prepare(`
  SELECT s.id, s.folio, s.estado, s.fecha, s.aplicado_en,
         bo.clave AS origen, bd.clave AS destino,
         (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades
    FROM almacen_salidas s
    JOIN almacen_bodegas bo ON bo.id = s.bodega_id
    LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
   WHERE s.motivo = 'traspaso' AND s.odt_id = ? AND s.estado <> 'cancelada'
   ORDER BY s.id
`).all(odtId);

// Convierte el faltante de la evaluación en traspasos de verdad. Es el punto
// donde producción deja de mirar un número y le pide a Almacén que mueva el
// material: un documento por bodega de origen, porque cada uno es un viaje
// distinto y se aplica por separado.
//
// Nace en borrador, no aplicado. Que la ODT diga que falta material no mueve
// nada por sí solo: alguien de Almacén tiene que confirmar que el traspaso se
// hizo. Lo que la ODT sí aporta es la justificación, así que este traspaso no
// pide segunda firma —la orden de la semana es el respaldo—; un traspaso
// capturado a mano, sin ODT detrás, sí la pide.
ruta('POST', '/api/produccion/odt/(\\d+)/traspaso', (req, res, p) => {
  const usuario = exigir(req, res, 'produccion_traspaso_pedir');
  if (!usuario) return;

  const odt = db.prepare('SELECT * FROM almacen_odt WHERE id = ?').get(Number(p[1]));
  if (!odt) return json(res, 404, { error: 'ODT no encontrada' });
  if (odt.estado !== 'abierta') return json(res, 409, { error: 'Esa ODT ya está cerrada.' });

  const destino = bodegaDeArmado();
  const { renglones } = evaluarODT(odt);

  // Lo que ya se pidió en un traspaso vivo de esta ODT no se vuelve a pedir:
  // tocar el botón dos veces no puede duplicar el movimiento.
  const yaPedido = new Map();
  for (const f of db.prepare(`
    SELECT r.producto_id, SUM(r.cantidad) AS n
      FROM almacen_salida_renglones r
      JOIN almacen_salidas s ON s.id = r.salida_id
     WHERE s.motivo = 'traspaso' AND s.odt_id = ? AND s.estado <> 'cancelada'
     GROUP BY r.producto_id
  `).all(odt.id)) yaPedido.set(f.producto_id, f.n);

  // Un documento por bodega de origen.
  const porOrigen = new Map();
  for (const r of renglones) {
    let pendiente = r.traspaso_sugerido - (yaPedido.get(r.producto_id) || 0);
    if (pendiente <= 0) continue;
    for (const f of r.fuentes) {
      if (pendiente <= 0) break;
      const toma = Math.min(pendiente, f.cantidad);
      if (!porOrigen.has(f.bodega_id)) porOrigen.set(f.bodega_id, []);
      porOrigen.get(f.bodega_id).push({ producto_id: r.producto_id, cantidad: toma });
      pendiente -= toma;
    }
  }

  if (!porOrigen.size) {
    return json(res, 409, {
      error: `No hay nada que traspasar: lo que falta en ${destino.nombre} tampoco está en las otras bodegas, o ya lo pediste.`,
    });
  }

  const creados = [];
  db.exec('BEGIN');
  try {
    for (const [origenId, lista] of porOrigen) {
      const id = Number(db.prepare(`
        INSERT INTO almacen_salidas (folio, motivo, odt_id, bodega_id, bodega_destino_id,
                                     fecha, usuario_id, notas, creado_en, estado)
        VALUES (?, 'traspaso', ?, ?, ?, ?, ?, ?, ?, 'solicitado')
      `).run(siguienteFolio('TRA', 'almacen_salidas'), odt.id, origenId, destino.id,
        hoyISO(), usuario.id,
        `Traspaso pedido por la ODT de ${describirSemana(odt.semana)}: falta material para armar en ${destino.nombre}.`,
        new Date().toISOString()).lastInsertRowid);

      const insert = db.prepare(
        'INSERT INTO almacen_salida_renglones (salida_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?)'
      );
      lista.forEach((r, i) => insert.run(id, r.producto_id, r.cantidad, i));
      creados.push(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  json(res, 201, { traspasos: traspasosDeODT(odt.id), creados });
});

// --- salidas ---
//
// Todo lo que sale dice a cuenta de qué sale. Lo que cuadra con la ODT de la
// semana lo aplica quien lo surte; lo que se pasa de lo pedido, lo que va a un
// envío de ventas directas y lo que sale «por otro motivo» necesitan la
// autorización de una segunda persona, porque no hay ningún documento contra el
// cual comprobarlo.

function salidaCompleta(id) {
  const salida = db.prepare(`
    SELECT s.*, b.nombre AS bodega, b.clave AS bodega_clave,
           bd.nombre AS bodega_destino, bd.clave AS bodega_destino_clave,
           u.nombre AS capturo, a.nombre AS autorizo, o.semana AS odt_semana,
           ap.nombre AS aprobo, cg.nombre AS cargo, cf.nombre AS confirmo
      FROM almacen_salidas s
      JOIN almacen_bodegas b ON b.id = s.bodega_id
      LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
      JOIN usuarios u ON u.id = s.usuario_id
      LEFT JOIN usuarios a ON a.id = s.autorizo_id
      LEFT JOIN usuarios ap ON ap.id = s.aprobado_por
      LEFT JOIN usuarios cg ON cg.id = s.cargado_por
      LEFT JOIN usuarios cf ON cf.id = s.confirmado_por
      LEFT JOIN almacen_odt o ON o.id = s.odt_id
     WHERE s.id = ?
  `).get(id);
  if (!salida) return null;

  const surtido = salida.odt_id ? surtidoDeODT(salida.odt_id) : new Map();
  const requerido = salida.odt_id ? requeridoPorODT(salida.odt_id).porProducto : new Map();

  // La foto de cada producto de una salida por calidad cuelga de su renglón.
  const fotosRenglon = new Map();
  for (const f of db.prepare(`
    SELECT f.id, f.documento_id, f.archivo FROM almacen_fotos f
      JOIN almacen_salida_renglones r ON r.id = f.documento_id
     WHERE f.documento_tipo = 'salida_renglon' AND r.salida_id = ? ORDER BY f.id
  `).all(id)) {
    if (!fotosRenglon.has(f.documento_id)) fotosRenglon.set(f.documento_id, []);
    fotosRenglon.get(f.documento_id).push(f);
  }

  salida.renglones = db.prepare(`
    SELECT r.*, p.sku, p.nombre AS producto, p.modelo
      FROM almacen_salida_renglones r
      JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.salida_id = ? ORDER BY r.orden, r.id
  `).all(id).map((r) => {
    const pide = requerido.get(r.producto_id) || 0;
    // Lo ya surtido incluye esta salida si está aplicada; se descuenta para que
    // el renglón muestre contra qué se comparó y no un pendiente al revés.
    const yaSurtido = (surtido.get(r.producto_id) || 0) - (salida.estado === 'aplicada' ? r.cantidad : 0);
    return {
      ...r,
      fotos: fotosRenglon.get(r.id) || [],
      existencia: existenciaDe(r.producto_id, salida.bodega_id),
      odt_pide: salida.odt_id ? pide : null,
      odt_pendiente: salida.odt_id ? Math.max(0, pide - yaSurtido) : null,
    };
  });
  salida.correcciones = correccionesDe('salida', id);
  salida.fotos = fotosDeDocumento('salida', id);
  salida.etiqueta_motivo = ETIQUETA_MOTIVO[salida.motivo] || salida.motivo;
  if (salida.vxf_id) {
    salida.vxf = db.prepare('SELECT id, folio, cliente, estado FROM vxf_ordenes WHERE id = ?').get(salida.vxf_id) || null;
  }
  return salida;
}

// Lo que no coincide entre una salida por fuera y su orden de armado. Se mide
// contra todo lo que ya salió de esa orden —esta salida incluida—, para que dos
// salidas de la misma orden no pasen cada una como «dentro de lo pedido».
function diferenciasContraVxf(salida) {
  const orden = db.prepare('SELECT folio FROM vxf_ordenes WHERE id = ?').get(salida.vxf_id);
  if (!orden) return ['La orden de armado ya no existe.'];
  const pedido = new Map(db.prepare(`
    SELECT r.producto_id, SUM(r.cantidad) AS n, p.nombre
      FROM vxf_renglones r JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.orden_id = ? GROUP BY r.producto_id
  `).all(salida.vxf_id).map((f) => [f.producto_id, f]));
  const saleOtras = new Map(db.prepare(`
    SELECT r.producto_id, SUM(r.cantidad) AS n
      FROM almacen_salida_renglones r JOIN almacen_salidas s ON s.id = r.salida_id
     WHERE s.vxf_id = ? AND s.id <> ? AND s.estado IN ('por_autorizar', 'aplicada')
     GROUP BY r.producto_id
  `).all(salida.vxf_id, salida.id).map((f) => [f.producto_id, f.n]));

  const razones = [];
  const vistos = new Set();
  for (const r of salida.renglones) {
    vistos.add(r.producto_id);
    const pide = pedido.get(r.producto_id);
    const total = r.cantidad + (saleOtras.get(r.producto_id) || 0);
    if (!pide) razones.push(`«${r.producto}» no viene en la orden ${orden.folio}.`);
    else if (total !== pide.n) {
      razones.push(`«${r.producto}»: la orden ${orden.folio} pide ${pide.n} y ${total > pide.n ? 'salen' : 'solo salen'} ${total}.`);
    }
  }
  for (const [productoId, f] of pedido) {
    if (!vistos.has(productoId) && !(saleOtras.get(productoId))) {
      razones.push(`«${f.nombre}» viene en la orden ${orden.folio} y no sale.`);
    }
  }
  return razones;
}

// Por qué esta salida necesita una segunda firma. Devuelve la lista de razones;
// vacía quiere decir que quien la captura puede aplicarla solo.
function razonesDeAutorizacion(salida) {
  // Un traspaso que nació de la ODT ya trae su justificación: la orden de la
  // semana dice, con números, que en la bodega de armado no alcanza. Ese se
  // aplica solo. El capturado a mano no tiene nada detrás que lo explique, y
  // mover material entre bodegas sin respaldo es justo como se pierde de vista.
  if (salida.motivo === 'traspaso') {
    return salida.odt_id ? [] : ['Es un traspaso capturado a mano: no hay ODT que lo justifique.'];
  }
  // Una venta directa se coteja contra su orden de armado: lo que se pidió
  // contra lo que sale. Lo que no coincida se le enseña a quien aprueba.
  if (salida.motivo === 'ventas_fuera') {
    if (!salida.vxf_id) return ['Es un envío de ventas directas sin orden de armado.'];
    return diferenciasContraVxf(salida);
  }
  if (salida.motivo === 'calidad') {
    return ['Es material que Calidad da por dañado: sale del inventario sin haberse vendido.'];
  }
  if (salida.motivo === 'otro') {
    return ['Sale por un motivo que no es la ODT ni un envío de ventas.'];
  }
  const razones = [];
  for (const r of salida.renglones) {
    if (r.odt_pide === 0) {
      razones.push(`«${r.producto}» no lo pide la ODT de esta semana.`);
    } else if (r.cantidad > r.odt_pendiente) {
      razones.push(`«${r.producto}»: se sacan ${r.cantidad} y la ODT solo tiene ${r.odt_pendiente} pendientes.`);
    }
  }
  return razones;
}

function faltantesDeSalida(salida) {
  const faltas = [];
  if (!salida.renglones.length) faltas.push('Agrega al menos un producto.');
  if (salida.motivo === 'odt' && !salida.odt_id) faltas.push('Escoge contra qué ODT sale el material.');
  // Un envío por la ODT va a un CEDIS, y el CEDIS se escoge de la lista que el
  // Administrador edita en Configuración. Escribirlo a mano era como acabábamos
  // con «Tepotzotlan», «Tepotzotlán» y «TEPOTZO» contando por separado.
  if (salida.motivo === 'odt' && !cedisActivos().includes((salida.destino || '').trim())) {
    faltas.push('Escoge de la lista el CEDIS al que va el envío.');
  }
  // Cada producto dice por qué sale y trae su foto: no todos los rollos salen
  // por lo mismo, así que un solo motivo para todo el documento no servía.
  if (salida.motivo === 'calidad') {
    for (const r of salida.renglones) {
      if (!(r.motivo || '').trim()) faltas.push(`«${r.producto}»: escribe por qué sale.`);
      if (!(r.fotos || []).length) faltas.push(`«${r.producto}»: falta su foto.`);
    }
  }
  if (salida.motivo === 'traspaso' && !salida.bodega_destino_id) faltas.push('Escoge la bodega destino del traspaso.');
  if (salida.motivo === 'traspaso' && salida.bodega_destino_id === salida.bodega_id) {
    faltas.push('El traspaso tiene que ir a una bodega distinta de la de origen.');
  }
  if (salida.motivo === 'ventas_fuera' && !salida.vxf_id) {
    faltas.push('Escoge la orden de armado de Ventas directas de la que sale este material.');
  }
  for (const r of salida.renglones) {
    if (!r.cantidad) faltas.push(`«${r.producto}»: falta la cantidad.`);
    else if (r.cantidad > r.existencia) {
      faltas.push(`«${r.producto}»: se quieren sacar ${r.cantidad} y en ${salida.bodega} hay ${r.existencia}.`);
    }
  }
  return faltas;
}

function aplicarSalida(salida, usuarioId) {
  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const r of salida.renglones) {
      anotarMovimiento({
        fecha: salida.fecha,
        tipo: salida.motivo === 'traspaso' ? 'traspaso' : 'salida',
        productoId: r.producto_id,
        origen: salida.bodega_id,
        destino: salida.motivo === 'traspaso' ? salida.bodega_destino_id : null,
        cantidad: r.cantidad,
        referencia: salida.folio,
        origenTipo: 'salida',
        origenId: salida.id,
        usuarioId,
        notas: salida.destino,
      });
    }
    db.prepare("UPDATE almacen_salidas SET estado = 'aplicada', aplicado_en = ?, autorizo_id = COALESCE(autorizo_id, ?) WHERE id = ?")
      .run(ahora, salida.estado === 'por_autorizar' ? usuarioId : null, salida.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// La lista de Almacén trae las salidas de venta. El traspaso tiene su pantalla y
// la salida por calidad se ve en Calidad, que es donde nace.
ruta('GET', '/api/almacen/salidas', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const url = new URL(req.url, 'http://x');
  const estado = url.searchParams.get('estado');
  json(res, 200, {
    salidas: db.prepare(`
      SELECT s.id, s.folio, s.motivo, s.destino, s.fecha, s.estado, s.correccion_nota,
             b.nombre AS bodega, bd.nombre AS bodega_destino, u.nombre AS capturo,
             o.semana AS odt_semana,
             (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_salida_renglones x WHERE x.salida_id = s.id) AS unidades
        FROM almacen_salidas s
        JOIN almacen_bodegas b ON b.id = s.bodega_id
        LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
        JOIN usuarios u ON u.id = s.usuario_id
        LEFT JOIN almacen_odt o ON o.id = s.odt_id
       WHERE s.motivo NOT IN ('traspaso', 'calidad') ${estado ? 'AND s.estado = ?' : ''}
       ORDER BY s.fecha DESC, s.id DESC LIMIT 200
    `).all(...(estado ? [estado] : [])),
  });
});

ruta('POST', '/api/almacen/salidas', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'salidas_capturar');
  if (!usuario) return;

  const motivo = String(cuerpo.motivo || '').trim();
  if (!MOTIVOS_SALIDA.some((m) => m.clave === motivo)) {
    return json(res, 400, { error: 'Escoge a cuenta de qué sale el material.' });
  }
  const bodegaId = Number(cuerpo.bodega_id || 0);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega de la que sale el material.' });
  }

  // Una salida contra ODT se amarra sola a la orden de la semana en curso: es
  // la única que puede estar surtiéndose, y pedirla a mano solo daba lugar a
  // que se cargara contra la semana equivocada.
  let odtId = null;
  if (motivo === 'odt') {
    const odt = odtDeSemana(String(cuerpo.semana || semanaISO()));
    if (!odt) return json(res, 400, { error: 'No hay ODT cargada para esta semana. Cárgala primero.' });
    odtId = odt.id;
  }
  let vxf = null;
  if (motivo === 'ventas_fuera') {
    vxf = db.prepare("SELECT * FROM vxf_ordenes WHERE id = ? AND estado NOT IN ('borrador', 'cancelada')")
      .get(Number(cuerpo.vxf_id || 0));
    if (!vxf) return json(res, 400, { error: 'Escoge la orden de armado de Ventas directas de la que sale.' });
    cuerpo.destino = vxf.cliente;
  }

  const id = Number(db.prepare(`
    INSERT INTO almacen_salidas (folio, motivo, odt_id, destino, bodega_id, bodega_destino_id,
                                 fecha, usuario_id, notas, creado_en, vxf_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('SAL', 'almacen_salidas'), motivo, odtId,
    String(cuerpo.destino || '').trim() || null, bodegaId,
    motivo === 'traspaso' ? Number(cuerpo.bodega_destino_id || 0) || null : null,
    cuerpo.fecha || hoyISO(), usuario.id,
    String(cuerpo.notas || '').trim() || null, new Date().toISOString(), vxf ? vxf.id : null).lastInsertRowid);

  // Los productos de la orden se proponen de entrada: lo normal es que salga
  // exactamente lo que se vendió. Si algo cambia, se corrige renglón por renglón
  // y la diferencia queda a la vista de quien aprueba.
  if (vxf) {
    const alta = db.prepare('INSERT INTO almacen_salida_renglones (salida_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?)');
    db.prepare('SELECT producto_id, cantidad FROM vxf_renglones WHERE orden_id = ? ORDER BY orden, id')
      .all(vxf.id).forEach((r, i) => alta.run(id, r.producto_id, r.cantidad, i));
  }

  json(res, 201, { salida: salidaCompleta(id) });
});

ruta('GET', '/api/almacen/salidas/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const salida = salidaCompleta(Number(p[1]));
  // Un traspaso tiene pasos que no son de Almacén: Tránsito lo carga y un Team
  // Leader confirma que llegó. Quien tiene uno de esos pasos abre el traspaso
  // aunque no entre a Almacén; si no, el aviso lo mandaría a «Sin acceso».
  const tienePaso = salida && salida.motivo === 'traspaso'
    && ['traspasos_aprobar', 'traspasos_cargar', 'traspasos_confirmar'].some((k) => puede(usuario, k));
  // Una salida por calidad la abre Calidad, que la pide, aunque no entre a Almacén.
  const esDeCalidad = salida && salida.motivo === 'calidad'
    && ['mod_calidad', 'calidad_salida_pedir', 'calidad_salida_aprobar'].some((k) => puede(usuario, k));
  if (!puede(usuario, 'mod_almacen') && !tienePaso && !esDeCalidad) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  if (!salida) return json(res, 404, { error: 'Salida no encontrada' });
  salida.fotos = fotosDeDocumento('salida', salida.id);
  json(res, 200, {
    salida,
    faltantes: faltantesDeSalida(salida),
    razones_autorizacion: razonesDeAutorizacion(salida),
  });
});

// Editar los renglones y aplicarlos son dos permisos de estado distintos: los
// renglones solo se tocan en captura, porque quien autoriza tiene que estar
// viendo exactamente lo que se le mandó a autorizar.
function salidaEditable(res, id, usuario) {
  const salida = db.prepare('SELECT * FROM almacen_salidas WHERE id = ?').get(id);
  if (!salida) { json(res, 404, { error: 'Salida no encontrada' }); return null; }
  if (usuario && !puede(usuario, permisoSalida(salida.motivo, 'capturar'))) {
    json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
    return null;
  }
  if (salida.estado !== 'borrador') {
    json(res, 409, { error: 'Esta salida ya salió de captura; para cambiarla hay que cancelarla y levantar otra.' });
    return null;
  }
  return salida;
}

function salidaEnBorrador(res, id) {
  const salida = db.prepare('SELECT * FROM almacen_salidas WHERE id = ?').get(id);
  if (!salida) { json(res, 404, { error: 'Salida no encontrada' }); return null; }
  if (salida.estado === 'aplicada') { json(res, 409, { error: 'Esta salida ya se aplicó al inventario.' }); return null; }
  // Un traspaso no se aplica de un botonazo: pasa por aprobación, Tránsito y
  // confirmación de llegada. Dejarlo entrar por aquí se saltaría los tres pasos.
  if (salida.motivo === 'traspaso') {
    json(res, 409, { error: 'Un traspaso se aprueba, se carga en Tránsito y se confirma al llegar. No se aplica directo.' });
    return null;
  }
  if (salida.estado === 'cancelada') { json(res, 409, { error: 'Esta salida está cancelada.' }); return null; }
  return salida;
}

// La cabecera de una salida mientras siga en captura: a dónde va y la fecha. El
// motivo no se cambia —es lo que decide el camino del documento—; si se escogió
// mal, se cancela y se levanta otra.
ruta('PUT', '/api/almacen/salidas/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const salida = salidaEditable(res, Number(p[1]), usuario);
  if (!salida) return;
  if (salida.motivo === 'traspaso') {
    return json(res, 409, { error: 'Un traspaso se cambia desde Traspasos.' });
  }
  let destino = String(cuerpo.destino ?? salida.destino ?? '').trim() || null;
  let vxfId = salida.vxf_id;
  if (salida.motivo === 'ventas_fuera' && cuerpo.vxf_id !== undefined) {
    const vxf = db.prepare("SELECT * FROM vxf_ordenes WHERE id = ? AND estado NOT IN ('borrador', 'cancelada')")
      .get(Number(cuerpo.vxf_id || 0));
    if (!vxf) return json(res, 400, { error: 'Escoge la orden de armado de Ventas directas de la que sale.' });
    vxfId = vxf.id;
    destino = vxf.cliente;
  }
  db.prepare('UPDATE almacen_salidas SET destino = ?, fecha = ?, notas = ?, vxf_id = ? WHERE id = ?').run(
    destino,
    cuerpo.fecha || salida.fecha,
    String(cuerpo.notas ?? salida.notas ?? '').trim() || null,
    vxfId,
    salida.id
  );
  json(res, 200, { salida: salidaCompleta(salida.id) });
});

ruta('POST', '/api/almacen/salidas/(\\d+)/renglones', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const salida = salidaEditable(res, Number(p[1]), usuario);
  if (!salida) return;

  const productoId = Number(cuerpo.producto_id || 0);
  if (!db.prepare('SELECT id FROM almacen_productos WHERE id = ? AND activo = 1').get(productoId)) {
    return json(res, 400, { error: 'Escoge un producto del catálogo.' });
  }
  if (db.prepare('SELECT id FROM almacen_salida_renglones WHERE salida_id = ? AND producto_id = ?')
        .get(salida.id, productoId)) {
    return json(res, 409, { error: 'Ese producto ya está en la salida.' });
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM almacen_salida_renglones WHERE salida_id = ?')
    .get(salida.id).n;
  db.prepare('INSERT INTO almacen_salida_renglones (salida_id, producto_id, cantidad, motivo, orden) VALUES (?, ?, ?, ?, ?)')
    .run(salida.id, productoId, Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))),
      String(cuerpo.motivo || '').trim() || null, orden);
  json(res, 201, { salida: salidaCompleta(salida.id) });
});

ruta('PUT', '/api/almacen/salida-renglones/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_salida_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!salidaEditable(res, renglon.salida_id, usuario)) return;
  db.prepare('UPDATE almacen_salida_renglones SET cantidad = ?, motivo = ? WHERE id = ?').run(
    cuerpo.cantidad === undefined ? renglon.cantidad : Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))),
    cuerpo.motivo === undefined ? renglon.motivo : (String(cuerpo.motivo || '').trim() || null),
    renglon.id
  );
  json(res, 200, { salida: salidaCompleta(renglon.salida_id) });
});

ruta('DELETE', '/api/almacen/salida-renglones/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_salida_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!salidaEditable(res, renglon.salida_id, usuario)) return;
  for (const f of db.prepare("SELECT archivo FROM almacen_fotos WHERE documento_tipo = 'salida_renglon' AND documento_id = ?").all(renglon.id)) {
    fs.rm(path.join(carpetaFotos(), f.archivo), { force: true }, () => {});
  }
  db.prepare("DELETE FROM almacen_fotos WHERE documento_tipo = 'salida_renglon' AND documento_id = ?").run(renglon.id);
  db.prepare('DELETE FROM almacen_salida_renglones WHERE id = ?').run(renglon.id);
  json(res, 200, { salida: salidaCompleta(renglon.salida_id) });
});

// Aplicar la salida. Si cuadra con la ODT, sale en el momento. Si no, no se
// bloquea: se queda esperando a que alguien más la autorice, y las razones por
// las que hace falta esa firma quedan escritas.
// El camino de una salida: se captura, se envía, y otra persona la aprueba. Solo
// al aprobarse sale del inventario, vaya o no dentro de lo que pide la ODT; lo
// que se sale de la ODT se le enseña a quien aprueba, no se deja pasar solo.

// El permiso depende del motivo, y el motivo está en el documento: se lee
// primero y se exige después.
function motivoDeSalida(res, id) {
  const fila = db.prepare('SELECT motivo FROM almacen_salidas WHERE id = ?').get(id);
  if (!fila) { json(res, 404, { error: 'Salida no encontrada' }); return null; }
  return fila.motivo;
}

ruta('POST', '/api/almacen/salidas/(\\d+)/enviar', (req, res, p) => {
  const motivo = motivoDeSalida(res, Number(p[1]));
  if (motivo === null) return;
  const usuario = exigir(req, res, permisoSalida(motivo, 'capturar'));
  if (!usuario) return;
  const base = salidaEnBorrador(res, Number(p[1]));
  if (!base) return;
  if (base.estado !== 'borrador') return json(res, 409, { error: 'Esta salida ya se envió a aprobación.' });

  const salida = salidaCompleta(base.id);
  const faltas = faltantesDeSalida(salida);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });

  db.prepare(`
    UPDATE almacen_salidas SET estado = 'por_autorizar', enviado_en = ?,
           correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
     WHERE id = ?
  `).run(new Date().toISOString(), salida.id);
  const razones = razonesDeAutorizacion(salida);
  json(res, 200, {
    salida: salidaCompleta(salida.id),
    razones_autorizacion: razones,
    mensaje: `Salida enviada a aprobación. El material sale del inventario cuando otra persona la apruebe.${
      razones.length ? ' Va fuera de lo que pide la ODT: quien apruebe lo verá.' : ''}`,
  });
});

ruta('POST', '/api/almacen/salidas/(\\d+)/aprobar', (req, res, p) => {
  const motivo = motivoDeSalida(res, Number(p[1]));
  if (motivo === null) return;
  const usuario = exigir(req, res, permisoSalida(motivo, 'aprobar'));
  if (!usuario) return;
  const salida = salidaCompleta(Number(p[1]));
  if (!salida) return json(res, 404, { error: 'Salida no encontrada' });
  if (salida.motivo === 'traspaso') return json(res, 409, { error: 'Un traspaso se aprueba desde Traspasos.' });
  if (salida.estado !== 'por_autorizar') return json(res, 409, { error: 'Esta salida no está esperando aprobación.' });
  if (!segundaPersona(res, usuario, salida.usuario_id, 'Aprobarla')) return;

  // Se vuelve a revisar la existencia: entre que se envió y que se aprueba pudo
  // salir material de la misma bodega.
  const faltas = faltantesDeSalida(salida);
  if (faltas.length) return json(res, 409, { error: faltas.join(' ') });

  aplicarSalida(salida, usuario.id);
  json(res, 200, { salida: salidaCompleta(salida.id), mensaje: 'Salida aprobada. El inventario ya la refleja.' });
});

ruta('POST', '/api/almacen/salidas/(\\d+)/corregir', (req, res, p, cuerpo) => {
  const motivo = motivoDeSalida(res, Number(p[1]));
  if (motivo === null) return;
  const usuario = exigir(req, res, permisoSalida(motivo, 'corregir'));
  if (!usuario) return;
  const salida = db.prepare('SELECT * FROM almacen_salidas WHERE id = ?').get(Number(p[1]));
  if (!salida) return json(res, 404, { error: 'Salida no encontrada' });
  if (salida.motivo === 'traspaso') return json(res, 409, { error: 'Un traspaso se regresa desde Traspasos.' });
  if (!['por_autorizar', 'aplicada'].includes(salida.estado)) {
    return json(res, 409, { error: 'Solo se pide corregir una salida que ya se envió.' });
  }
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    // Lo que salió regresa a la bodega mientras se corrige.
    borrarMovimientosDe.run('salida', salida.id);
    db.prepare(`
      UPDATE almacen_salidas SET estado = 'borrador', autorizo_id = NULL, aplicado_en = NULL, enviado_en = NULL,
             correccion_nota = ?, correccion_por = ?, correccion_en = ?
       WHERE id = ?
    `).run(nota, usuario.id, ahora, salida.id);
    anotarCorreccion('salida', salida.id, salida.folio, salida.estado, nota, usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    salida: salidaCompleta(salida.id),
    mensaje: salida.estado === 'aplicada'
      ? 'Regresada a captura. El material volvió a la bodega hasta que se corrija y se apruebe otra vez.'
      : 'Regresada a captura para corregir.',
  });
});

ruta('POST', '/api/almacen/salidas/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const salida = db.prepare('SELECT * FROM almacen_salidas WHERE id = ?').get(Number(p[1]));
  if (!salida) return json(res, 404, { error: 'Salida no encontrada' });
  if (!puede(usuario, permisoSalida(salida.motivo, 'aprobar'))) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  if (salida.estado === 'cancelada') return json(res, 409, { error: 'Ya estaba cancelada.' });
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué la cancelas. Queda registrado.' });

  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('salida', salida.id);
    db.prepare("UPDATE almacen_salidas SET estado = 'cancelada', notas = ? WHERE id = ?")
      .run(`${salida.notas ? salida.notas + ' · ' : ''}Cancelada: ${motivo}`, salida.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true });
});

// --- la salida de material por calidad ---

// Los motivos de una salida por calidad, en una línea: «Rollo 80x70: se mojó ·
// Caja RM90: golpeada». Es lo que lee quien aprueba en su aviso.
function motivosDeSalida(salidaId) {
  const filas = db.prepare(`
    SELECT p.nombre, r.cantidad, r.motivo FROM almacen_salida_renglones r
      JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.salida_id = ? ORDER BY r.orden, r.id
  `).all(salidaId);
  const texto = filas.map((f) => `${f.nombre} (${f.cantidad}): ${f.motivo || 'sin motivo'}`).join(' · ');
  return texto.length > 220 ? `${texto.slice(0, 220)}…` : texto;
}
//
// Material que ya estaba guardado y se dañó: se mojó, se golpeó, se le venció el
// adhesivo. Calidad pide su salida, explica qué pasó y sube la evidencia; el
// material sale del inventario cuando quien tiene el permiso lo aprueba. Por
// debajo es una salida más —misma tabla, mismo libro mayor— porque el inventario
// no entiende de quién pidió el movimiento, solo de movimientos.

ruta('GET', '/api/almacen/salidas-calidad', (req, res) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  if (!['mod_calidad', 'mod_almacen', 'calidad_salida_pedir', 'calidad_salida_aprobar']
    .some((k) => puede(usuario, k))) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  json(res, 200, {
    salidas: db.prepare(`
      SELECT s.id, s.folio, s.fecha, s.estado, s.notas, s.correccion_nota, s.enviado_en, s.aplicado_en,
             b.nombre AS bodega, u.nombre AS capturo, a.nombre AS autorizo,
             (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_salida_renglones x WHERE x.salida_id = s.id) AS unidades,
             (SELECT COUNT(*) FROM almacen_fotos f WHERE f.documento_tipo = 'salida' AND f.documento_id = s.id) AS fotos
        FROM almacen_salidas s
        JOIN almacen_bodegas b ON b.id = s.bodega_id
        JOIN usuarios u ON u.id = s.usuario_id
        LEFT JOIN usuarios a ON a.id = s.autorizo_id
       WHERE s.motivo = 'calidad'
       ORDER BY s.fecha DESC, s.id DESC LIMIT 200
    `).all().map((f) => ({ ...f, motivos: motivosDeSalida(f.id) })),
    bodegas: bodegasActivas(),
  });
});

ruta('POST', '/api/almacen/salidas-calidad', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_salida_pedir');
  if (!usuario) return;
  const bodegaId = Number(cuerpo.bodega_id || 0);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega donde está el material.' });
  }
  // Primero solo la bodega y la fecha. El porqué va después, producto por
  // producto, junto con su foto.
  const porQue = String(cuerpo.notas || '').trim();

  const id = Number(db.prepare(`
    INSERT INTO almacen_salidas (folio, motivo, destino, bodega_id, fecha, usuario_id, notas, creado_en)
    VALUES (?, 'calidad', ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('SCA', 'almacen_salidas'), 'Baja por calidad', bodegaId,
    cuerpo.fecha || hoyISO(), usuario.id, porQue || null, new Date().toISOString()).lastInsertRowid);

  json(res, 201, { salida: salidaCompleta(id) });
});

// El por qué se puede afinar mientras siga en captura: es lo único editable de
// la cabecera, porque es lo que sustenta la salida.
ruta('PUT', '/api/almacen/salidas-calidad/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_salida_pedir');
  if (!usuario) return;
  const salida = salidaEditable(res, Number(p[1]), null);
  if (!salida) return;
  if (salida.motivo !== 'calidad') return json(res, 409, { error: 'Esta no es una salida por calidad.' });
  db.prepare('UPDATE almacen_salidas SET notas = ?, fecha = ? WHERE id = ?')
    .run(String(cuerpo.notas ?? salida.notas ?? '').trim() || null, cuerpo.fecha || salida.fecha, salida.id);
  json(res, 200, { salida: salidaCompleta(salida.id) });
});

// --- evidencia de los documentos de almacén ---

// Quien captura un documento es quien sube y quita su evidencia.
const PERMISO_FOTO = {
  vxf_cobro: 'ventas_fuera_cobrar',
  entrada: 'entradas_capturar',
  salida: 'salidas_capturar',
  devolucion: 'devoluciones_capturar',
  conteo: 'conteos_contar',
  // La foto de un producto descuadrado en el conteo: es del renglón, no del
  // conteo entero, para poder decir en Reportes de qué producto es.
  conteo_renglon: 'conteos_contar',
  reingreso: 'reingresos_capturar',
  // La foto de cada producto de una salida por calidad.
  salida_renglon: 'calidad_salida_pedir',
  // La guía de paquetería o la nota de remisión de una orden de venta directa.
  vxf: 'ventas_fuera_capturar',
};

const fotosDeDocumento = (tipo, id) => db
  .prepare('SELECT id, archivo, subida_en FROM almacen_fotos WHERE documento_tipo = ? AND documento_id = ? ORDER BY id')
  .all(tipo, id);

ruta('POST', '/api/almacen/(devolucion|conteo_renglon|conteo|entrada|salida_renglon|salida|reingreso|vxf|vxf_cobro)/(\\d+)/fotos', (req, res, p, cuerpo) => {
  // La foto de la carga de un traspaso la sube Tránsito, que no captura
  // movimientos de almacén. Para todo lo demás sigue pidiendo el permiso de
  // siempre: es la única excepción, y es porque el paso es suyo.
  const doc = p[1] === 'salida' ? db.prepare('SELECT motivo FROM almacen_salidas WHERE id = ?').get(Number(p[2])) : null;
  const usuario = exigir(req, res, doc
    ? (doc.motivo === 'traspaso' ? 'traspasos_cargar' : permisoSalida(doc.motivo, 'capturar'))
    : PERMISO_FOTO[p[1]]);
  if (!usuario) return;

  // La foto de un producto descuadrado es parte del conteo: una vez enviado, ni
  // se agrega ni se quita, igual que no se cambia el número contado.
  if (p[1] === 'vxf') {
    const orden = db.prepare('SELECT estado FROM vxf_ordenes WHERE id = ?').get(Number(p[2]));
    if (!orden) return json(res, 404, { error: 'Orden no encontrada' });
    if (orden.estado !== 'armada') {
      return json(res, 409, { error: 'La guía o la nota se carga cuando la orden ya está armada.' });
    }
  }
  // La evidencia del dinero: solo mientras el cobro no esté confirmado.
  if (p[1] === 'vxf_cobro') {
    const orden = db.prepare('SELECT estado, cobro, cobro_confirmado_en FROM vxf_ordenes WHERE id = ?').get(Number(p[2]));
    if (!orden) return json(res, 404, { error: 'Orden no encontrada' });
    if (orden.cobro !== 'por_cobrar') return json(res, 409, { error: 'Esta venta no es por cobrar.' });
    if (orden.cobro_confirmado_en) return json(res, 409, { error: 'Ese cobro ya está confirmado.' });
  }
  if (p[1] === 'salida_renglon') {
    const dueno = db.prepare(`
      SELECT s.estado FROM almacen_salida_renglones r JOIN almacen_salidas s ON s.id = r.salida_id WHERE r.id = ?
    `).get(Number(p[2]));
    if (!dueno) return json(res, 404, { error: 'Renglón no encontrado' });
    if (dueno.estado !== 'borrador') return json(res, 409, { error: 'Esta salida ya se envió a aprobación.' });
  }
  if (p[1] === 'conteo_renglon') {
    const dueno = db.prepare(`
      SELECT c.estado FROM almacen_conteo_renglones r JOIN almacen_conteos c ON c.id = r.conteo_id
       WHERE r.id = ?
    `).get(Number(p[2]));
    if (!dueno) return json(res, 404, { error: 'Renglón no encontrado' });
    if (dueno.estado !== 'borrador') return json(res, 409, { error: 'Este conteo ya se envió a aprobación.' });
  }

  const guardado = guardarArchivoSubido(cuerpo.imagen);
  if (guardado.error) return json(res, guardado.codigo, { error: guardado.error });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO almacen_fotos (documento_tipo, documento_id, archivo, bytes, subida_por, subida_en)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(p[1], Number(p[2]), guardado.archivo, guardado.bytes, usuario.id, new Date().toISOString());

  json(res, 200, { id: Number(lastInsertRowid), archivo: guardado.archivo, bytes: guardado.bytes });
});

ruta('DELETE', '/api/almacen/fotos/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res);
  if (!usuario) return;
  const foto = db.prepare('SELECT * FROM almacen_fotos WHERE id = ?').get(Number(p[1]));
  if (!foto) return json(res, 404, { error: 'Foto no encontrada' });
  const motivoFoto = foto.documento_tipo === 'salida'
    ? (db.prepare('SELECT motivo FROM almacen_salidas WHERE id = ?').get(foto.documento_id) || {}).motivo
    : null;
  const permisoNecesario = motivoFoto
    ? (motivoFoto === 'traspaso' ? 'traspasos_cargar' : permisoSalida(motivoFoto, 'capturar'))
    : PERMISO_FOTO[foto.documento_tipo];
  if (!puede(usuario, permisoNecesario)) {
    return json(res, 403, { error: 'Tu perfil no tiene acceso a esta sección.' });
  }
  db.prepare('DELETE FROM almacen_fotos WHERE id = ?').run(foto.id);
  fs.rm(path.join(carpetaFotos(), foto.archivo), { force: true }, () => {});
  json(res, 200, { ok: true });
});

// --- traspasos entre bodegas ---
//
// Un traspaso no saca material de la empresa: lo cambia de lugar. Resta en la
// bodega de origen y suma en la de destino, en un solo renglón del libro mayor,
// igual que en el Excel. Por debajo es una salida con bodega destino —el motor
// de movimientos ya sabía hacerlo— pero se captura y se consulta aparte, porque
// para quien lo vive es otra tarea: no está surtiendo un pedido, está acarreando.
//
// La mayoría nace en Producción: la ODT de la semana descubre que en la bodega
// de armado no alcanza el material y pide el traspaso. Esos llegan aquí ya
// llenos, en borrador, esperando a que Almacén confirme que el viaje se hizo.

ruta('GET', '/api/almacen/traspasos', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const url = new URL(req.url, 'http://x');
  const estado = url.searchParams.get('estado');
  json(res, 200, {
    bodegas: bodegasActivas(),
    bodega_armado: bodegaDeArmado(),
    traspasos: db.prepare(`
      SELECT s.id, s.folio, s.fecha, s.estado, s.notas,
             b.nombre AS bodega, b.clave AS bodega_clave,
             bd.nombre AS bodega_destino, bd.clave AS bodega_destino_clave,
             u.nombre AS capturo, a.nombre AS autorizo, o.semana AS odt_semana,
             (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_salida_renglones x WHERE x.salida_id = s.id) AS unidades,
             (SELECT COUNT(*) FROM almacen_salida_renglones x WHERE x.salida_id = s.id) AS productos
        FROM almacen_salidas s
        JOIN almacen_bodegas b ON b.id = s.bodega_id
        LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
        JOIN usuarios u ON u.id = s.usuario_id
        LEFT JOIN usuarios a ON a.id = s.autorizo_id
        LEFT JOIN almacen_odt o ON o.id = s.odt_id
       WHERE s.motivo = 'traspaso' ${estado ? 'AND s.estado = ?' : ''}
       ORDER BY s.fecha DESC, s.id DESC LIMIT 200
    `).all(...(estado ? [estado] : [])),
  });
});

// Un traspaso capturado a mano: el que no viene de la ODT. Nace vacío y se le
// van agregando renglones, igual que a una salida.
ruta('POST', '/api/almacen/traspasos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'traspasos_capturar');
  if (!usuario) return;

  const bodegas = bodegasActivas();
  const origenId = Number(cuerpo.bodega_id || 0);
  const destinoId = Number(cuerpo.bodega_destino_id || 0);
  if (!bodegas.some((b) => b.id === origenId)) {
    return json(res, 400, { error: 'Escoge la bodega de la que sale el material.' });
  }
  if (!bodegas.some((b) => b.id === destinoId)) {
    return json(res, 400, { error: 'Escoge la bodega a la que llega el material.' });
  }
  if (origenId === destinoId) {
    return json(res, 400, { error: 'El traspaso tiene que ir a una bodega distinta de la de origen.' });
  }

  const id = Number(db.prepare(`
    INSERT INTO almacen_salidas (folio, motivo, bodega_id, bodega_destino_id,
                                 fecha, usuario_id, notas, creado_en)
    VALUES (?, 'traspaso', ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('TRA', 'almacen_salidas'), origenId, destinoId,
    cuerpo.fecha || hoyISO(), usuario.id,
    String(cuerpo.notas || '').trim() || null, new Date().toISOString()).lastInsertRowid);

  json(res, 201, { traspaso: salidaCompleta(id) });
});

// --- el camino de un traspaso ---
//
// Un traspaso no se aplica de un botonazo. Entre que producción descubre que
// falta material y que el inventario cambia, hay gente y hay un camión:
//
//   solicitado  Producción lo pidió desde la ODT, o Almacén lo capturó a mano.
//   aprobado    Un Team Leader de Almacén dijo que sí. Pasa a Tránsito.
//   cargado     Tránsito avisó que el material ya va en el camión, con foto.
//   aplicada    Llegó, y un Team Leader lo confirmó. HASTA AQUÍ se mueve el
//               inventario: sale de la bodega de origen y entra a la destino.
//
// El inventario se mueve al final, no al aprobar ni al cargar. Es lo que pidió
// Ronaldo y es lo prudente: mientras el material va en camino nadie firmó que
// llegó, y un traspaso que se aplicara al salir dejaría existencia sumada en una
// bodega donde todavía no hay nada. La contra —que el material en tránsito se
// siga viendo disponible en la bodega de origen— queda anotada en el documento,
// que dice a partir de cuándo va en camino.

const PASOS_TRASPASO = [
  { estado: 'solicitado', etiqueta: 'Solicitado', ayuda: 'Esperando que un Team Leader de Almacén lo apruebe.' },
  { estado: 'aprobado', etiqueta: 'Aprobado', ayuda: 'En manos de Tránsito: falta que avisen que el material va cargado.' },
  { estado: 'cargado', etiqueta: 'Cargado', ayuda: 'Va en camino. Al llegar, un Team Leader confirma la recepción.' },
  { estado: 'aplicada', etiqueta: 'Confirmado', ayuda: 'Llegó y el inventario ya cambió en las dos bodegas.' },
];

const esTraspaso = (s) => s && s.motivo === 'traspaso';

// Devuelve el traspaso comprobando que exista, que sea traspaso y que esté en el
// estado que el paso espera. Todos los pasos empiezan igual.
function traspasoEn(res, id, estadosValidos) {
  const t = salidaCompleta(id);
  if (!t) { json(res, 404, { error: 'Traspaso no encontrado' }); return null; }
  if (!esTraspaso(t)) { json(res, 400, { error: 'Ese documento no es un traspaso.' }); return null; }
  if (t.estado === 'cancelada') { json(res, 409, { error: 'Ese traspaso está cancelado.' }); return null; }
  if (!estadosValidos.includes(t.estado)) {
    const paso = PASOS_TRASPASO.find((p) => p.estado === t.estado);
    json(res, 409, { error: `Este traspaso está «${paso ? paso.etiqueta : t.estado}»; no es el paso que sigue.` });
    return null;
  }
  return t;
}

// 1. APROBAR — un Team Leader de Almacén.
ruta('POST', '/api/almacen/traspasos/(\\d+)/aprobar', (req, res, p) => {
  const usuario = exigir(req, res, 'traspasos_aprobar');
  if (!usuario) return;

  const t = traspasoEn(res, Number(p[1]), ['borrador', 'solicitado']);
  if (!t) return;

  // Quien lo pidió no lo aprueba. Es la misma regla que Calidad aplica al
  // cierre de un rechazo: una decisión con consecuencia se reparte entre dos.
  if (usuario.rol !== 'admin' && t.usuario_id === usuario.id) {
    return json(res, 409, { error: 'Quien pidió el traspaso no puede aprobarlo. Que lo revise otro Team Leader o el Administrador.' });
  }
  if (!t.renglones.length) return json(res, 409, { error: 'El traspaso no tiene productos.' });
  if (!t.bodega_destino_id) return json(res, 409, { error: 'Falta la bodega destino.' });

  const faltas = faltantesDeSalida(t);
  if (faltas.length) return json(res, 409, { error: faltas[0], faltantes: faltas });

  db.prepare("UPDATE almacen_salidas SET estado = 'aprobado', aprobado_por = ?, aprobado_en = ? WHERE id = ?")
    .run(usuario.id, new Date().toISOString(), t.id);
  json(res, 200, { traspaso: salidaCompleta(t.id) });
});

// 2. CARGADO — Tránsito, con foto obligatoria.
//
// La foto no es un adorno: es lo único que queda de que el material
// efectivamente subió al camión. Sin ella, «cargado» es la palabra de una
// persona sobre material que todavía no llega a ningún lado.
ruta('POST', '/api/almacen/traspasos/(\\d+)/cargado', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'traspasos_cargar');
  if (!usuario) return;

  const t = traspasoEn(res, Number(p[1]), ['aprobado']);
  if (!t) return;

  if (!fotosDeDocumento('salida', t.id).length) {
    return json(res, 409, { error: 'Sube la foto de la carga antes de avisar que va cargado.' });
  }

  db.prepare("UPDATE almacen_salidas SET estado = 'cargado', cargado_por = ?, cargado_en = ?, notas = COALESCE(?, notas) WHERE id = ?")
    .run(usuario.id, new Date().toISOString(),
      String(cuerpo.notas || '').trim() || null, t.id);
  json(res, 200, { traspaso: salidaCompleta(t.id) });
});

// 3. CONFIRMAR — un Team Leader, al llegar. Aquí y solo aquí cambia el inventario.
ruta('POST', '/api/almacen/traspasos/(\\d+)/confirmar', (req, res, p) => {
  const usuario = exigir(req, res, 'traspasos_confirmar');
  if (!usuario) return;

  const t = traspasoEn(res, Number(p[1]), ['cargado']);
  if (!t) return;

  // Se vuelve a revisar la existencia: entre que se aprobó y que llegó pudieron
  // salir cosas de la bodega de origen, y el traspaso dejaría el saldo negativo.
  const faltas = faltantesDeSalida(t);
  if (faltas.length) return json(res, 409, { error: faltas[0], faltantes: faltas });

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const r of t.renglones) {
      anotarMovimiento({
        fecha: t.fecha,
        tipo: 'traspaso',
        productoId: r.producto_id,
        origen: t.bodega_id,
        destino: t.bodega_destino_id,
        cantidad: r.cantidad,
        referencia: t.folio,
        origenTipo: 'salida',
        origenId: t.id,
        usuarioId: usuario.id,
      });
    }
    db.prepare(`
      UPDATE almacen_salidas
         SET estado = 'aplicada', aplicado_en = ?, confirmado_por = ?, confirmado_en = ?
       WHERE id = ?
    `).run(ahora, usuario.id, ahora, t.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const listo = salidaCompleta(t.id);
  json(res, 200, {
    traspaso: listo,
    // Los dos movimientos, dichos como se viven: cuánto salió y cuánto entró.
    movimientos: listo.renglones.map((r) => ({
      producto: r.producto,
      salio_de: t.bodega, entro_a: t.bodega_destino, cantidad: r.cantidad,
    })),
  });
});

// Devolver un traspaso al paso anterior cuando algo salió mal en el camino.
// No se «desaplica»: un traspaso ya confirmado movió inventario y eso se
// corrige con un conteo, no borrando el paso.
ruta('POST', '/api/almacen/traspasos/(\\d+)/regresar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'traspasos_regresar');
  if (!usuario) return;

  const t = traspasoEn(res, Number(p[1]), ['aprobado', 'cargado']);
  if (!t) return;
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Anota por qué lo regresas.' });

  const previo = t.estado === 'cargado' ? 'aprobado' : 'solicitado';
  db.prepare(`
    UPDATE almacen_salidas
       SET estado = ?, notas = COALESCE(notas || ' · ', '') || ?,
           cargado_por = CASE WHEN ? = 'aprobado' THEN NULL ELSE cargado_por END,
           cargado_en  = CASE WHEN ? = 'aprobado' THEN NULL ELSE cargado_en END,
           aprobado_por = CASE WHEN ? = 'solicitado' THEN NULL ELSE aprobado_por END,
           aprobado_en  = CASE WHEN ? = 'solicitado' THEN NULL ELSE aprobado_en END
     WHERE id = ?
  `).run(previo, `Regresado por ${usuario.nombre}: ${motivo}`, previo, previo, previo, previo, t.id);

  json(res, 200, { traspaso: salidaCompleta(t.id) });
});

// Lo que Tránsito tiene que mover: aprobados esperando carga, y los que ya van
// en camino. Es la puerta de Tránsito al traspaso; el documento sigue siendo de
// Almacén, aquí solo se ve el paso que les toca.
ruta('GET', '/api/transito/traspasos', (req, res) => {
  if (!exigir(req, res, 'traspasos_cargar')) return;
  json(res, 200, {
    traspasos: db.prepare(`
      SELECT s.id, s.folio, s.fecha, s.estado, s.aprobado_en, s.cargado_en,
             bo.nombre AS origen, bo.clave AS origen_clave,
             bd.nombre AS destino, bd.clave AS destino_clave,
             a.nombre AS aprobo, o.semana AS odt_semana,
             (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades,
             (SELECT COUNT(*) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS productos,
             (SELECT COUNT(*) FROM almacen_fotos f WHERE f.documento_tipo = 'salida' AND f.documento_id = s.id) AS fotos
        FROM almacen_salidas s
        JOIN almacen_bodegas bo ON bo.id = s.bodega_id
        LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
        LEFT JOIN usuarios a ON a.id = s.aprobado_por
        LEFT JOIN almacen_odt o ON o.id = s.odt_id
       WHERE s.motivo = 'traspaso' AND s.estado IN ('aprobado', 'cargado')
       ORDER BY s.aprobado_en, s.id
    `).all(),
  });
});

// El reporte de Tránsito: envíos y colectas con el cierre ya aprobado. Lo que
// sigue en proceso vive en la portada de Tránsito y en Notificaciones; aquí entra
// al final, como en Checklists. Va por rango de fechas —por omisión el mes en
// curso—.
ruta('GET', '/api/transito/reportes', (req, res) => {
  if (!exigir(req, res, 'transito_reportes')) return;
  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const hasta = fecha(url.searchParams.get('hasta')) || hoyISO();
  const desde = fecha(url.searchParams.get('desde')) || `${hasta.slice(0, 8)}01`;
  if (desde > hasta) return json(res, 400, { error: 'La fecha inicial queda después de la final.' });

  const plantilla = db.prepare("SELECT id FROM plantillas WHERE clave = 'transito'").get();
  const minutosEntre = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);
  const promedio = (lista) => (lista.length ? Math.round(lista.reduce((n, x) => n + x, 0) / lista.length) : null);
  const hojas = (etapa) => `(SELECT COUNT(*) FROM fotos f JOIN items i ON i.id = f.item_id
      JOIN secciones sc ON sc.id = i.seccion_id
     WHERE f.llenado_id = l.id AND i.tipo_respuesta = 'documento' AND sc.etapa = '${etapa}')`;

  // Los datos del transporte de cada colecta, por la clave de su pregunta: así
  // siguen leyéndose aunque el Administrador cambie la redacción.
  const transporte = new Map();
  if (plantilla) {
    for (const f of db.prepare(`
      SELECT r.llenado_id, json_extract(i.meta, '$.clave') AS clave, r.valor
        FROM respuestas r
        JOIN items i ON i.id = r.item_id
        JOIN secciones sc ON sc.id = i.seccion_id
       WHERE sc.plantilla_id = ? AND json_extract(i.meta, '$.clave') IS NOT NULL
    `).all(plantilla.id)) {
      if (!transporte.has(f.llenado_id)) transporte.set(f.llenado_id, {});
      transporte.get(f.llenado_id)[f.clave] = f.valor;
    }
  }

  const envios = !plantilla ? [] : db.prepare(`
    SELECT l.id, l.periodo AS fecha, l.referencia AS numero, l.datos, l.salida_en, l.regreso_en, l.cerrado_en,
           u.nombre AS preparo, au.nombre AS autorizo, ap.nombre AS aprobo,
           ${hojas('salida')} AS hojas_salida,
           ${hojas('regreso')} AS hojas_regreso,
           (SELECT COUNT(*) FROM llenado_revisiones v WHERE v.llenado_id = l.id AND v.accion = 'modificacion') AS correcciones
      FROM llenados l
      JOIN usuarios u ON u.id = l.usuario_id
      LEFT JOIN usuarios au ON au.id = l.autorizado_por
      LEFT JOIN usuarios ap ON ap.id = COALESCE(l.aprobado_por, l.cerrado_por)
     WHERE l.plantilla_id = ? AND l.estado = 'cerrado' AND l.revision = 'aprobado'
       AND l.periodo BETWEEN ? AND ?
     ORDER BY l.periodo DESC, l.cerrado_en DESC
  `).all(plantilla.id, desde, hasta).map(({ datos, ...l }) => {
    const d = JSON.parse(datos || '{}');
    const colecta = d.tipo === 'colecta';
    const t = transporte.get(l.id) || {};
    return {
      ...l,
      tipo: colecta ? 'colecta' : 'envio',
      lugar: String(d.lugar_entrega || '').trim().replace(/\s+/g, ' ') || 'Sin CEDIS',
      minutos_en_ruta: minutosEntre(l.salida_en, l.regreso_en || l.cerrado_en),
      transporte: colecta ? {
        proveedor: t.proveedor || null, hora_arribo: t.hora_arribo || null, placas: t.placas || null,
        chofer: t.chofer || null, unidad_adecuada: t.unidad_adecuada || null,
      } : null,
    };
  });

  // El mismo CEDIS escrito con otras mayúsculas es el mismo lugar.
  const lugares = new Map();
  const dias = new Map();
  for (const e of envios) {
    const clave = e.lugar.toUpperCase();
    if (!lugares.has(clave)) lugares.set(clave, { lugar: e.lugar, total: 0, envios: 0, colectas: 0, tiempos: [] });
    const g = lugares.get(clave);
    g.total++;
    g[e.tipo === 'colecta' ? 'colectas' : 'envios']++;
    if (e.minutos_en_ruta !== null) g.tiempos.push(e.minutos_en_ruta);

    if (!dias.has(e.fecha)) dias.set(e.fecha, { fecha: e.fecha, total: 0, envios: 0, colectas: 0 });
    const dia = dias.get(e.fecha);
    dia.total++;
    dia[e.tipo === 'colecta' ? 'colectas' : 'envios']++;
  }
  const porLugar = [...lugares.values()]
    .map(({ tiempos, ...g }) => ({ ...g, promedio_min: promedio(tiempos) }))
    .sort((a, b) => b.total - a.total || a.lugar.localeCompare(b.lugar));

  // Los traspasos que Tránsito cargó en el periodo, hayan llegado o no.
  const traspasos = db.prepare(`
    SELECT s.id, s.folio, s.estado, s.cargado_en, s.confirmado_en,
           bo.clave AS origen, bd.clave AS destino, cg.nombre AS cargo, cf.nombre AS confirmo,
           (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades,
           (SELECT COUNT(*) FROM almacen_fotos f WHERE f.documento_tipo = 'salida' AND f.documento_id = s.id) AS fotos
      FROM almacen_salidas s
      JOIN almacen_bodegas bo ON bo.id = s.bodega_id
      LEFT JOIN almacen_bodegas bd ON bd.id = s.bodega_destino_id
      LEFT JOIN usuarios cg ON cg.id = s.cargado_por
      LEFT JOIN usuarios cf ON cf.id = s.confirmado_por
     WHERE s.motivo = 'traspaso' AND s.cargado_en IS NOT NULL
       AND substr(s.cargado_en, 1, 10) BETWEEN ? AND ?
     ORDER BY s.cargado_en DESC
  `).all(desde, hasta).map((t) => ({ ...t, minutos_en_camino: minutosEntre(t.cargado_en, t.confirmado_en) }));

  json(res, 200, {
    desde,
    hasta,
    resumen: {
      total: envios.length,
      envios: envios.filter((e) => e.tipo === 'envio').length,
      colectas: envios.filter((e) => e.tipo === 'colecta').length,
      promedio_min: promedio(envios.map((e) => e.minutos_en_ruta).filter((m) => m !== null)),
      correcciones: envios.reduce((n, e) => n + e.correcciones, 0),
      lugares: porLugar.length,
      traspasos: traspasos.length,
    },
    por_lugar: porLugar,
    por_dia: [...dias.values()],
    envios,
    traspasos,
  });
});

// --- devoluciones ---
//
// Material que ya había salido y regresa porque el CEDIS o el cliente lo
// rechazó. Vuelve al inventario, pero nunca por la palabra de una sola persona:
// necesita motivo escrito, foto y la autorización de alguien distinto de quien
// la capturó. Es la misma exigencia que Calidad pone sobre un lote rechazado.

function devolucionCompleta(id) {
  const dev = db.prepare(`
    SELECT d.*, b.nombre AS bodega, b.clave AS bodega_clave, u.nombre AS capturo,
           a.nombre AS autorizo, s.folio AS salida_folio
      FROM almacen_devoluciones d
      JOIN almacen_bodegas b ON b.id = d.bodega_id
      JOIN usuarios u ON u.id = d.usuario_id
      LEFT JOIN usuarios a ON a.id = d.autorizo_id
      LEFT JOIN almacen_salidas s ON s.id = d.salida_id
     WHERE d.id = ?
  `).get(id);
  if (!dev) return null;
  dev.renglones = db.prepare(`
    SELECT r.*, p.sku, p.nombre AS producto, p.modelo
      FROM almacen_devolucion_renglones r
      JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.devolucion_id = ? ORDER BY r.orden, r.id
  `).all(id);
  dev.fotos = fotosDeDocumento('devolucion', id);
  dev.etiqueta_rechazo = (ORIGENES_RECHAZO.find((o) => o.clave === dev.rechazo_de) || {}).etiqueta;
  dev.correcciones = correccionesDe('devolucion', id);
  dev.de_venta = dev.origen === 'venta_directa';
  dev.reviso = nombreDe(dev.revisado_por);
  dev.orden = dev.vxf_id
    ? db.prepare('SELECT id, folio, cliente FROM vxf_ordenes WHERE id = ?').get(dev.vxf_id) : null;
  // Lo que de verdad va a entrar al inventario: lo que Calidad dio por bueno.
  // En una devolución de almacén —sin paso de Calidad— es lo que se capturó.
  dev.unidades_buenas = dev.renglones.reduce((n, r) => n + (dev.de_venta ? (r.cantidad_buena || 0) : r.cantidad), 0);
  dev.unidades = dev.renglones.reduce((n, r) => n + r.cantidad, 0);
  return dev;
}

// Lo que le falta a la revisión de Calidad: cuánto de cada producto llegó bien,
// y la explicación de lo que no.
function faltantesDeRevision(dev) {
  const faltas = [];
  if (!dev.renglones.length) faltas.push('Agrega al menos un producto de los que regresaron.');
  if (!(dev.motivo || '').trim()) faltas.push('Escribe por qué lo regresan: es lo que se va a leer después.');
  if (!dev.fotos.length) faltas.push('Falta la foto del material que regresó.');
  for (const r of dev.renglones) {
    if (!r.cantidad) { faltas.push(`«${r.producto}»: falta cuánto regresó.`); continue; }
    if (r.cantidad_buena === null || r.cantidad_buena === undefined) {
      faltas.push(`«${r.producto}»: falta decir cuánto llegó bien.`);
    } else if (r.cantidad_buena < r.cantidad && !(r.observacion || '').trim()) {
      faltas.push(`«${r.producto}»: llegó bien menos de lo que regresó; explica qué tiene lo demás.`);
    }
  }
  return faltas;
}

function faltantesDeDevolucion(dev) {
  const faltas = [];
  if (dev.de_venta) {
    const deCalidad = faltantesDeRevision(dev);
    if (deCalidad.length) return deCalidad;
    if (!dev.revisado_en) faltas.push('Calidad todavía no termina de revisar lo que regresó.');
    if (!dev.unidades_buenas) faltas.push('Calidad no dio por bueno nada: no hay qué meter al inventario.');
    return faltas;
  }
  if (!dev.renglones.length) faltas.push('Agrega al menos un producto.');
  if (!(dev.motivo || '').trim()) faltas.push('Escribe por qué lo rechazaron. Sin eso la devolución no sirve para reclamar después.');
  if (!(dev.quien || '').trim()) faltas.push(`Anota qué ${dev.rechazo_de === 'cedis' ? 'CEDIS' : 'cliente'} lo rechazó.`);
  else if (dev.rechazo_de === 'cedis' && !cedisActivos().includes(dev.quien.trim())) {
    faltas.push('Escoge de la lista el CEDIS que lo rechazó.');
  }
  if (!dev.fotos.length) faltas.push('Falta la foto del material devuelto.');
  for (const r of dev.renglones) if (!r.cantidad) faltas.push(`«${r.producto}»: falta la cantidad.`);
  return faltas;
}

ruta('GET', '/api/almacen/devoluciones', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const url = new URL(req.url, 'http://x');
  const estado = url.searchParams.get('estado');
  json(res, 200, {
    devoluciones: db.prepare(`
      SELECT d.id, d.folio, d.rechazo_de, d.quien, d.fecha, d.estado, d.motivo, d.correccion_nota,
             b.nombre AS bodega, u.nombre AS capturo, a.nombre AS autorizo,
             (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_devolucion_renglones x WHERE x.devolucion_id = d.id) AS unidades
        FROM almacen_devoluciones d
        JOIN almacen_bodegas b ON b.id = d.bodega_id
        JOIN usuarios u ON u.id = d.usuario_id
        LEFT JOIN usuarios a ON a.id = d.autorizo_id
       ${estado ? 'WHERE d.estado = ?' : ''}
       ORDER BY d.fecha DESC, d.id DESC LIMIT 200
    `).all(...(estado ? [estado] : [])),
  });
});

// Lo que regresa de una venta directa lo levanta CALIDAD, no Almacén: es quien
// ve en qué estado volvió el material. Tiene que escribir por qué lo regresan.
ruta('POST', '/api/calidad/devoluciones', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_capturar');
  if (!usuario) return;

  const orden = db.prepare("SELECT * FROM vxf_ordenes WHERE id = ? AND estado NOT IN ('borrador', 'cancelada')")
    .get(Number(cuerpo.vxf_id || 0));
  if (!orden) return json(res, 400, { error: 'Escoge la orden de venta directa de la que regresa el material.' });
  const bodegaId = Number(cuerpo.bodega_id || 0);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega a la que regresa el material.' });
  }
  const motivo = String(cuerpo.motivo || '').trim();
  if (motivo.length < 5) {
    return json(res, 400, { error: 'Escribe por qué lo regresan: es lo que va a leer quien lo revise en un mes.' });
  }

  const id = Number(db.prepare(`
    INSERT INTO almacen_devoluciones (folio, rechazo_de, quien, bodega_id, fecha, motivo, usuario_id,
                                      creado_en, estado, origen, vxf_id)
    VALUES (?, 'cliente', ?, ?, ?, ?, ?, ?, 'en_calidad', 'venta_directa', ?)
  `).run(siguienteFolio('DEV', 'almacen_devoluciones'), orden.cliente, bodegaId,
    cuerpo.fecha || hoyISO(), motivo, usuario.id, new Date().toISOString(), orden.id).lastInsertRowid);

  // Lo que se vendió se propone de entrada: casi siempre regresa parte de eso.
  const alta = db.prepare(
    'INSERT INTO almacen_devolucion_renglones (devolucion_id, producto_id, cantidad, orden) VALUES (?, ?, 0, ?)'
  );
  db.prepare('SELECT producto_id FROM vxf_renglones WHERE orden_id = ? ORDER BY orden, id')
    .all(orden.id).forEach((r, i) => alta.run(id, r.producto_id, i));

  json(res, 201, { devolucion: devolucionCompleta(id) });
});

// Calidad anota cuánto de cada producto llegó bien y qué tiene lo demás.
ruta('PUT', '/api/calidad/devolucion-renglones/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'calidad_capturar');
  if (!usuario) return;
  const r = db.prepare('SELECT * FROM almacen_devolucion_renglones WHERE id = ?').get(Number(p[1]));
  if (!r) return json(res, 404, { error: 'Renglón no encontrado' });
  const dev = db.prepare('SELECT * FROM almacen_devoluciones WHERE id = ?').get(r.devolucion_id);
  if (dev.estado !== 'en_calidad') return json(res, 409, { error: 'Esta devolución ya salió de Calidad.' });

  const cantidad = cuerpo.cantidad === undefined ? r.cantidad : Math.max(0, Math.trunc(Number(cuerpo.cantidad) || 0));
  const buena = cuerpo.cantidad_buena === undefined || cuerpo.cantidad_buena === null || cuerpo.cantidad_buena === ''
    ? r.cantidad_buena : Math.max(0, Math.trunc(Number(cuerpo.cantidad_buena) || 0));
  if (buena !== null && buena > cantidad) {
    return json(res, 400, { error: `No puede llegar bien más de lo que regresó (${cantidad}).` });
  }
  db.prepare('UPDATE almacen_devolucion_renglones SET cantidad = ?, cantidad_buena = ?, observacion = ? WHERE id = ?')
    .run(cantidad, buena, String(cuerpo.observacion ?? r.observacion ?? '').trim() || null, r.id);
  json(res, 200, { devolucion: devolucionCompleta(dev.id) });
});

// Calidad termina la revisión Y pide la entrada al inventario en el mismo paso:
// quien revisó es quien sabe cuánto va a entrar, y hacer que Almacén repitiera
// esa petición no agregaba ninguna revisión, solo un paso. Almacén aprueba, que
// es donde el inventario se mueve.
ruta('POST', '/api/calidad/devoluciones/(\\d+)/revisada', (req, res, p) => {
  const usuario = exigir(req, res, 'calidad_capturar');
  if (!usuario) return;
  const dev = devolucionCompleta(Number(p[1]));
  if (!dev) return json(res, 404, { error: 'Devolución no encontrada' });
  if (dev.estado !== 'en_calidad') return json(res, 409, { error: 'Esta devolución ya salió de Calidad.' });
  const faltas = faltantesDeRevision(dev);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });
  if (!dev.unidades_buenas) {
    return json(res, 400, { error: 'No diste nada por bueno: no hay qué pedirle al inventario. Revisa las cantidades.' });
  }

  const ahora = new Date().toISOString();
  db.prepare(`
    UPDATE almacen_devoluciones SET estado = 'por_autorizar', revisado_por = ?, revisado_en = ?, enviado_en = ?
     WHERE id = ?
  `).run(usuario.id, ahora, ahora, dev.id);
  json(res, 200, {
    devolucion: devolucionCompleta(dev.id),
    mensaje: `Revisión terminada: ${dev.unidades_buenas} pieza(s) buenas. Almacén la aprueba y ahí entra al inventario.`,
  });
});

ruta('POST', '/api/almacen/devoluciones', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'devoluciones_capturar');
  if (!usuario) return;

  const rechazoDe = String(cuerpo.rechazo_de || '').trim();
  if (!ORIGENES_RECHAZO.some((o) => o.clave === rechazoDe)) {
    return json(res, 400, { error: 'Di si el rechazo fue del CEDIS o del cliente.' });
  }
  const bodegaId = Number(cuerpo.bodega_id || 0);
  if (!bodegasActivas().some((b) => b.id === bodegaId)) {
    return json(res, 400, { error: 'Escoge la bodega a la que regresa el material.' });
  }

  const id = Number(db.prepare(`
    INSERT INTO almacen_devoluciones (folio, rechazo_de, quien, salida_id, bodega_id, fecha,
                                      motivo, usuario_id, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(siguienteFolio('DEV', 'almacen_devoluciones'), rechazoDe,
    String(cuerpo.quien || '').trim() || null,
    Number(cuerpo.salida_id || 0) || null, bodegaId, cuerpo.fecha || hoyISO(),
    String(cuerpo.motivo || '').trim() || null, usuario.id,
    new Date().toISOString()).lastInsertRowid);

  json(res, 201, { devolucion: devolucionCompleta(id) });
});

ruta('GET', '/api/almacen/devoluciones/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const dev = devolucionCompleta(Number(p[1]));
  if (!dev) return json(res, 404, { error: 'Devolución no encontrada' });
  json(res, 200, { devolucion: dev, faltantes: faltantesDeDevolucion(dev) });
});

function devolucionEditable(res, id) {
  const dev = db.prepare('SELECT * FROM almacen_devoluciones WHERE id = ?').get(id);
  if (!dev) { json(res, 404, { error: 'Devolución no encontrada' }); return null; }
  if (dev.estado !== 'borrador') {
    json(res, 409, { error: 'Esta devolución ya salió de captura; para cambiarla hay que cancelarla y levantar otra.' });
    return null;
  }
  return dev;
}

function devolucionAbierta(res, id) {
  const dev = db.prepare('SELECT * FROM almacen_devoluciones WHERE id = ?').get(id);
  if (!dev) { json(res, 404, { error: 'Devolución no encontrada' }); return null; }
  if (dev.estado === 'aplicada') { json(res, 409, { error: 'Esta devolución ya se aplicó al inventario.' }); return null; }
  if (dev.estado === 'cancelada') { json(res, 409, { error: 'Esta devolución está cancelada.' }); return null; }
  return dev;
}

ruta('PUT', '/api/almacen/devoluciones/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'devoluciones_capturar');
  if (!usuario) return;
  const dev = devolucionEditable(res, Number(p[1]));
  if (!dev) return;
  db.prepare('UPDATE almacen_devoluciones SET quien = ?, motivo = ?, fecha = ?, salida_id = ? WHERE id = ?').run(
    String(cuerpo.quien ?? dev.quien ?? '').trim() || null,
    String(cuerpo.motivo ?? dev.motivo ?? '').trim() || null,
    cuerpo.fecha || dev.fecha,
    Number(cuerpo.salida_id ?? dev.salida_id ?? 0) || null,
    dev.id
  );
  json(res, 200, { devolucion: devolucionCompleta(dev.id) });
});

ruta('POST', '/api/almacen/devoluciones/(\\d+)/renglones', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'devoluciones_capturar');
  if (!usuario) return;
  const dev = devolucionEditable(res, Number(p[1]));
  if (!dev) return;

  const productoId = Number(cuerpo.producto_id || 0);
  if (!db.prepare('SELECT id FROM almacen_productos WHERE id = ? AND activo = 1').get(productoId)) {
    return json(res, 400, { error: 'Escoge un producto del catálogo.' });
  }
  if (db.prepare('SELECT id FROM almacen_devolucion_renglones WHERE devolucion_id = ? AND producto_id = ?')
        .get(dev.id, productoId)) {
    return json(res, 409, { error: 'Ese producto ya está en la devolución.' });
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM almacen_devolucion_renglones WHERE devolucion_id = ?')
    .get(dev.id).n;
  db.prepare('INSERT INTO almacen_devolucion_renglones (devolucion_id, producto_id, cantidad, orden) VALUES (?, ?, ?, ?)')
    .run(dev.id, productoId, Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))), orden);
  json(res, 201, { devolucion: devolucionCompleta(dev.id) });
});

ruta('PUT', '/api/almacen/devolucion-renglones/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'devoluciones_capturar');
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_devolucion_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!devolucionEditable(res, renglon.devolucion_id)) return;
  db.prepare('UPDATE almacen_devolucion_renglones SET cantidad = ? WHERE id = ?')
    .run(Math.max(0, Math.trunc(Number(cuerpo.cantidad || 0))), renglon.id);
  json(res, 200, { devolucion: devolucionCompleta(renglon.devolucion_id) });
});

ruta('DELETE', '/api/almacen/devolucion-renglones/(\\d+)', (req, res, p) => {
  const usuario = exigir(req, res, 'devoluciones_capturar');
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_devolucion_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  if (!devolucionEditable(res, renglon.devolucion_id)) return;
  db.prepare('DELETE FROM almacen_devolucion_renglones WHERE id = ?').run(renglon.id);
  json(res, 200, { devolucion: devolucionCompleta(renglon.devolucion_id) });
});

// El camino de una devolución: se captura con su foto, se envía, y otra persona
// la aprueba. Solo al aprobarse vuelve el material al inventario.

ruta('POST', '/api/almacen/devoluciones/(\\d+)/enviar', (req, res, p) => {
  const usuario = exigir(req, res, 'devoluciones_capturar');
  if (!usuario) return;
  const base = devolucionAbierta(res, Number(p[1]));
  if (!base) return;
  if (base.origen === 'venta_directa' && base.estado === 'en_calidad') {
    return json(res, 409, { error: 'Calidad todavía está revisando lo que regresó.' });
  }
  if (!['borrador', 'revisada'].includes(base.estado)) {
    return json(res, 409, { error: 'Esta devolución ya se envió a aprobación.' });
  }

  const dev = devolucionCompleta(base.id);
  const faltas = faltantesDeDevolucion(dev);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });

  db.prepare(`
    UPDATE almacen_devoluciones SET estado = 'por_autorizar', enviado_en = ?,
           correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
     WHERE id = ?
  `).run(new Date().toISOString(), dev.id);
  json(res, 200, {
    devolucion: devolucionCompleta(dev.id),
    mensaje: 'Devolución enviada a aprobación. El material vuelve al inventario cuando otra persona la apruebe.',
  });
});

ruta('POST', '/api/almacen/devoluciones/(\\d+)/aprobar', (req, res, p) => {
  const usuario = exigir(req, res, 'devoluciones_aprobar');
  if (!usuario) return;

  const dev = devolucionCompleta(Number(p[1]));
  if (!dev) return json(res, 404, { error: 'Devolución no encontrada' });
  if (dev.estado !== 'por_autorizar') return json(res, 409, { error: 'Esta devolución no está esperando aprobación.' });
  if (!segundaPersona(res, usuario, dev.usuario_id, 'Aprobarla')) return;

  const faltas = faltantesDeDevolucion(dev);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const r of dev.renglones) {
      // De una venta directa entra SOLO lo que Calidad dio por bueno. Lo dañado
      // se queda fuera del inventario: por eso pasó por Calidad.
      const cantidad = dev.de_venta ? (r.cantidad_buena || 0) : r.cantidad;
      if (!cantidad) continue;
      anotarMovimiento({
        fecha: dev.fecha, tipo: 'devolucion', productoId: r.producto_id,
        destino: dev.bodega_id, cantidad,
        referencia: dev.folio, origenTipo: 'devolucion', origenId: dev.id,
        usuarioId: usuario.id,
        notas: `${dev.etiqueta_rechazo}${dev.quien ? ' — ' + dev.quien : ''}`
          + (dev.orden ? ` · venta ${dev.orden.folio}` : '')
          + (dev.de_venta && r.cantidad_buena < r.cantidad ? ` · ${r.cantidad - r.cantidad_buena} no entró` : ''),
      });
    }
    db.prepare("UPDATE almacen_devoluciones SET estado = 'aplicada', autorizo_id = ?, aplicado_en = ? WHERE id = ?")
      .run(usuario.id, ahora, dev.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { devolucion: devolucionCompleta(dev.id), mensaje: 'Devolución aprobada. El material ya está en el inventario.' });
});

ruta('POST', '/api/almacen/devoluciones/(\\d+)/corregir', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'devoluciones_corregir');
  if (!usuario) return;
  const dev = db.prepare('SELECT * FROM almacen_devoluciones WHERE id = ?').get(Number(p[1]));
  if (!dev) return json(res, 404, { error: 'Devolución no encontrada' });
  if (!['por_autorizar', 'aplicada'].includes(dev.estado)) {
    return json(res, 409, { error: 'Solo se pide corregir una devolución que ya se envió.' });
  }
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;
  if (dev.estado === 'aplicada') {
    const negativo = quedariaNegativo('devolucion', dev.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('devolucion', dev.id);
    db.prepare(`
      UPDATE almacen_devoluciones SET estado = 'borrador', autorizo_id = NULL, aplicado_en = NULL, enviado_en = NULL,
             correccion_nota = ?, correccion_por = ?, correccion_en = ?
       WHERE id = ?
    `).run(nota, usuario.id, ahora, dev.id);
    anotarCorreccion('devolucion', dev.id, dev.folio, dev.estado, nota, usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    devolucion: devolucionCompleta(dev.id),
    mensaje: dev.estado === 'aplicada'
      ? 'Regresada a captura. Lo que había vuelto al inventario salió hasta que se corrija y se apruebe otra vez.'
      : 'Regresada a captura para corregir.',
  });
});

ruta('POST', '/api/almacen/devoluciones/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'devoluciones_aprobar');
  if (!usuario) return;
  const dev = db.prepare('SELECT * FROM almacen_devoluciones WHERE id = ?').get(Number(p[1]));
  if (!dev) return json(res, 404, { error: 'Devolución no encontrada' });
  if (dev.estado === 'cancelada') return json(res, 409, { error: 'Ya estaba cancelada.' });
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué la cancelas. Queda registrado.' });
  if (dev.estado === 'aplicada') {
    const negativo = quedariaNegativo('devolucion', dev.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('devolucion', dev.id);
    db.prepare("UPDATE almacen_devoluciones SET estado = 'cancelada', motivo = ? WHERE id = ?")
      .run(`${dev.motivo ? dev.motivo + ' · ' : ''}Cancelada: ${motivo}`, dev.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true });
});

// --- conteos semanales ---
//
// Quien cuenta anota lo físico y nada más. La diferencia contra lo teórico la
// saca el servidor, y el ajuste que la corrige lo autoriza otra persona. En el
// Excel el conteo se pegaba encima del inventario y el descuadre desaparecía
// sin dejar rastro: no se podía saber cuánto se había perdido ni dónde.

function conteoCompleto(id) {
  const conteo = db.prepare(`
    SELECT c.*, b.nombre AS bodega, b.clave AS bodega_clave,
           u.nombre AS capturo, a.nombre AS autorizo, ce.nombre AS cerro
      FROM almacen_conteos c
      JOIN almacen_bodegas b ON b.id = c.bodega_id
      JOIN usuarios u ON u.id = c.usuario_id
      LEFT JOIN usuarios a ON a.id = c.autorizo_id
      LEFT JOIN usuarios ce ON ce.id = c.cerrado_por
     WHERE c.id = ?
  `).get(id);
  if (!conteo) return null;

  const abierto = conteo.estado === 'borrador';
  const saldos = existenciasPorBodega();

  // El detalle de cajas y la foto de cada renglón, en una consulta por conteo y
  // no una por producto: la hoja llega a 121 renglones.
  const cajasPorRenglon = new Map();
  for (const c of db.prepare(`
    SELECT c.* FROM almacen_conteo_cajas c
      JOIN almacen_conteo_renglones r ON r.id = c.renglon_id
     WHERE r.conteo_id = ? ORDER BY c.orden, c.id
  `).all(id)) {
    if (!cajasPorRenglon.has(c.renglon_id)) cajasPorRenglon.set(c.renglon_id, []);
    cajasPorRenglon.get(c.renglon_id).push(c);
  }
  const fotosPorRenglon = new Map();
  for (const f of db.prepare(`
    SELECT f.id, f.documento_id, f.archivo, f.subida_en FROM almacen_fotos f
      JOIN almacen_conteo_renglones r ON r.id = f.documento_id
     WHERE f.documento_tipo = 'conteo_renglon' AND r.conteo_id = ? ORDER BY f.id
  `).all(id)) {
    if (!fotosPorRenglon.has(f.documento_id)) fotosPorRenglon.set(f.documento_id, []);
    fotosPorRenglon.get(f.documento_id).push(f);
  }

  conteo.renglones = db.prepare(`
    SELECT r.*, p.sku, p.nombre AS producto, p.modelo, p.tipo_material
      FROM almacen_conteo_renglones r
      JOIN almacen_productos p ON p.id = r.producto_id
     WHERE r.conteo_id = ? ORDER BY p.orden, p.nombre
  `).all(id).map((r) => {
    // Mientras el conteo está abierto, el teórico se muestra al momento; al
    // cerrarlo se congela. Si no, un movimiento capturado después movería la
    // diferencia y nadie sabría contra qué número se contó.
    const teorico = abierto ? ((saldos.get(r.producto_id) || new Map()).get(conteo.bodega_id) || 0) : r.teorico;
    const diferencia = r.contado === null ? null : r.contado - teorico;
    const cajas = cajasPorRenglon.get(r.id) || [];
    const piezasEnCajas = cajas.reduce((n, c) => n + c.cajas * c.piezas_por_caja, 0);
    return {
      ...r,
      teorico,
      diferencia,
      cajas,
      fotos: fotosPorRenglon.get(r.id) || [],
      piezas_en_cajas: piezasEnCajas,
      // Un descuadre obliga a decir cómo se llegó al número: cuántas cajas de
      // cuántas piezas. La suma tiene que dar exactamente lo contado; si no da,
      // lo que hay es una estimación, no un conteo.
      exige_cajas: diferencia !== null && diferencia !== 0 && r.contado > 0,
      cajas_cuadran: piezasEnCajas === r.contado,
      // Un descuadre chico es merma; uno grande necesita explicación. El umbral
      // se mide contra el teórico, no en unidades, porque 50 rollos de menos en
      // 200 es un problema y en 40 000 es redondeo.
      exige_explicacion: diferencia !== null && diferencia !== 0
        && Math.abs(diferencia) > Math.max(1, Math.abs(teorico) * TOLERANCIA_CONTEO),
    };
  });

  conteo.contados = conteo.renglones.filter((r) => r.contado !== null).length;
  conteo.total_productos = db.prepare('SELECT COUNT(*) AS n FROM almacen_productos WHERE activo = 1').get().n;
  conteo.parcial = conteo.renglones.length < conteo.total_productos;
  conteo.con_diferencia = conteo.renglones.filter((r) => r.diferencia).length;
  conteo.unidades_diferencia = conteo.renglones.reduce((s, r) => s + (r.diferencia || 0), 0);
  conteo.fotos = fotosDeDocumento('conteo', id);
  conteo.correcciones = correccionesDe('conteo', id);
  return conteo;
}

function faltantesDeConteo(conteo) {
  const faltas = [];
  const sinContar = conteo.renglones.filter((r) => r.contado === null);
  if (sinContar.length) {
    faltas.push(`Faltan ${sinContar.length} producto(s) por contar. Anota 0 en los que no haya existencia.`);
  }
  for (const r of conteo.renglones) {
    if (r.exige_explicacion && !(r.observacion || '').trim()) {
      faltas.push(`«${r.producto}»: la diferencia de ${r.diferencia > 0 ? '+' : ''}${r.diferencia} necesita explicación escrita.`);
    }
    if (!r.exige_cajas) continue;
    if (!r.cajas.length) {
      faltas.push(`«${r.producto}»: descuadró; detalla cuántas cajas hay y de cuántas piezas cada una.`);
    } else if (!r.cajas_cuadran) {
      faltas.push(`«${r.producto}»: el detalle de cajas suma ${r.piezas_en_cajas} y contaste ${r.contado}.`);
    }
    if (!r.fotos.length) faltas.push(`«${r.producto}»: descuadró; falta la foto del material contado.`);
  }
  return faltas;
}

ruta('GET', '/api/almacen/conteos', (req, res) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const url = new URL(req.url, 'http://x');
  const estado = url.searchParams.get('estado');
  json(res, 200, {
    conteos: db.prepare(`
      SELECT c.id, c.semana, c.fecha, c.estado, c.correccion_nota, b.nombre AS bodega,
             u.nombre AS capturo, a.nombre AS autorizo,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id AND r.contado IS NOT NULL) AS contados,
             (SELECT COUNT(*) FROM almacen_conteo_renglones r WHERE r.conteo_id = c.id) AS productos
        FROM almacen_conteos c
        JOIN almacen_bodegas b ON b.id = c.bodega_id
        JOIN usuarios u ON u.id = c.usuario_id
        LEFT JOIN usuarios a ON a.id = c.autorizo_id
       ${estado ? 'WHERE c.estado = ?' : ''}
       ORDER BY c.semana DESC, c.id DESC LIMIT 100
    `).all(...(estado ? [estado] : [])),
    semana: semanaISO(),
    // Qué productos ya están en un conteo abierto de cada bodega. La pantalla
    // los marca en la lista de partidas en vez de dejar que se escojan y
    // rebotar con un error: quien manda a contar necesita ver qué está libre.
    contandose: db.prepare(`
      SELECT c.bodega_id, r.producto_id
        FROM almacen_conteo_renglones r JOIN almacen_conteos c ON c.id = r.conteo_id
       WHERE c.estado IN ('borrador', 'por_autorizar')
    `).all().reduce((mapa, f) => {
      (mapa[f.bodega_id] = mapa[f.bodega_id] || []).push(f.producto_id);
      return mapa;
    }, {}),
  });
});

// Abrir el conteo siembra un renglón por cada producto que se mandó a contar.
// Puede ser la bodega entera o solo unas partidas: contar 121 productos se lleva
// un turno completo, y muchas veces lo que se quiere revisar son diez. Quien
// tiene el permiso escoge; lo que no se escogió no aparece en la hoja, para que
// nadie tenga que adivinar si lo dejó pendiente o no le tocaba.
ruta('POST', '/api/almacen/conteos', (req, res, _p, cuerpo) => {
  const usuario = exigir(req, res, 'conteos_abrir');
  if (!usuario) return;

  const bodegaId = Number(cuerpo.bodega_id || 0);
  const bodega = bodegasActivas().find((b) => b.id === bodegaId);
  if (!bodega) return json(res, 400, { error: 'Escoge la bodega que se va a contar.' });

  const semana = String(cuerpo.semana || semanaISO()).trim();
  if (!/^\d{4}-W\d{2}$/.test(semana)) return json(res, 400, { error: 'La semana va como 2026-W35.' });

  // Qué partidas se cuentan. Sin lista, la bodega entera.
  const activos = productosActivos();
  const pedidos = Array.isArray(cuerpo.productos) ? cuerpo.productos.map(Number).filter(Boolean) : [];
  const productos = pedidos.length
    ? activos.filter((pr) => pedidos.includes(pr.id))
    : activos;
  if (!productos.length) return json(res, 400, { error: 'Escoge al menos un producto para contar.' });
  if (pedidos.length && productos.length < pedidos.length) {
    return json(res, 400, { error: 'Alguno de los productos escogidos ya no está en el catálogo.' });
  }

  // Un producto no puede estar en dos conteos abiertos de la misma bodega: dos
  // personas contarían lo mismo y los dos ajustes se pisarían.
  const yaEnConteo = db.prepare(`
    SELECT p.nombre FROM almacen_conteo_renglones r
      JOIN almacen_conteos c ON c.id = r.conteo_id
      JOIN almacen_productos p ON p.id = r.producto_id
     WHERE c.bodega_id = ? AND c.estado IN ('borrador', 'por_autorizar')
       AND r.producto_id IN (${productos.map(() => '?').join(',')})
     ORDER BY p.nombre
  `).all(bodegaId, ...productos.map((pr) => pr.id)).map((f) => f.nombre);
  if (yaEnConteo.length) {
    return json(res, 409, {
      error: `Ya hay un conteo abierto de ${bodega.nombre} con ${yaEnConteo.length} de estos productos`
        + ` (${yaEnConteo.slice(0, 3).map((n) => `«${n}»`).join(', ')}${yaEnConteo.length > 3 ? '…' : ''}).`
        + ' Termínalo o quítalos de la selección.',
    });
  }

  let id;
  db.exec('BEGIN');
  try {
    id = Number(db.prepare(
      'INSERT INTO almacen_conteos (semana, bodega_id, fecha, usuario_id, notas, creado_en) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(semana, bodegaId, cuerpo.fecha || hoyISO(), usuario.id,
      productos.length < activos.length ? `Conteo de ${productos.length} partida(s) escogidas.` : null,
      new Date().toISOString()).lastInsertRowid);

    const insert = db.prepare('INSERT INTO almacen_conteo_renglones (conteo_id, producto_id) VALUES (?, ?)');
    for (const pr of productos) insert.run(id, pr.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 201, { conteo: conteoCompleto(id) });
});

ruta('GET', '/api/almacen/conteos/(\\d+)', (req, res, p) => {
  if (!exigir(req, res, 'mod_almacen')) return;
  const conteo = conteoCompleto(Number(p[1]));
  if (!conteo) return json(res, 404, { error: 'Conteo no encontrado' });
  json(res, 200, { conteo, faltantes: faltantesDeConteo(conteo) });
});

// Cualquiera con permiso de contar llena el conteo abierto; cada renglón guarda
// quién lo contó. Eso es lo que impide que quien contó apruebe su propio ajuste.
ruta('PUT', '/api/almacen/conteo-renglones/(\\d+)', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'conteos_contar');
  if (!usuario) return;
  const renglon = db.prepare('SELECT * FROM almacen_conteo_renglones WHERE id = ?').get(Number(p[1]));
  if (!renglon) return json(res, 404, { error: 'Renglón no encontrado' });
  const conteo = db.prepare('SELECT * FROM almacen_conteos WHERE id = ?').get(renglon.conteo_id);
  if (conteo.estado !== 'borrador') return json(res, 409, { error: 'Este conteo ya se envió a aprobación.' });

  const contado = cuerpo.contado === null || cuerpo.contado === ''
    ? null : Math.max(0, Math.trunc(Number(cuerpo.contado)));
  const cambioElNumero = contado !== renglon.contado;
  db.prepare(`
    UPDATE almacen_conteo_renglones
       SET contado = ?, observacion = ?,
           contado_por = CASE WHEN ? THEN ? ELSE contado_por END,
           recontar = CASE WHEN ? THEN 0 ELSE recontar END
     WHERE id = ?
  `).run(contado, String(cuerpo.observacion ?? renglon.observacion ?? '').trim() || null,
    cambioElNumero ? 1 : 0, usuario.id, cambioElNumero ? 1 : 0, renglon.id);

  // El detalle de cajas llega completo y reemplaza al anterior: son dos o tres
  // renglones y llevarlos uno por uno pediría un id por caja para nada.
  if (Array.isArray(cuerpo.cajas)) {
    db.prepare('DELETE FROM almacen_conteo_cajas WHERE renglon_id = ?').run(renglon.id);
    const alta = db.prepare(
      'INSERT INTO almacen_conteo_cajas (renglon_id, cajas, piezas_por_caja, orden) VALUES (?, ?, ?, ?)'
    );
    cuerpo.cajas.forEach((c, i) => {
      const cajas = Math.max(0, Math.trunc(Number((c || {}).cajas || 0)));
      const piezas = Math.max(0, Math.trunc(Number((c || {}).piezas_por_caja || 0)));
      if (cajas && piezas) alta.run(renglon.id, cajas, piezas, i);
    });
  }

  const actual = conteoCompleto(conteo.id);
  json(res, 200, { renglon: actual.renglones.find((r) => r.id === renglon.id), resumen: {
    contados: actual.contados, con_diferencia: actual.con_diferencia,
    unidades_diferencia: actual.unidades_diferencia, total: actual.renglones.length,
  } });
});

// Enviar el conteo congela lo teórico y lo manda a aprobación.
ruta('POST', '/api/almacen/conteos/(\\d+)/enviar', (req, res, p) => {
  const usuario = exigir(req, res, 'conteos_contar');
  if (!usuario) return;
  const base = db.prepare('SELECT * FROM almacen_conteos WHERE id = ?').get(Number(p[1]));
  if (!base) return json(res, 404, { error: 'Conteo no encontrado' });
  if (base.estado !== 'borrador') return json(res, 409, { error: 'Este conteo ya se envió a aprobación.' });

  const conteo = conteoCompleto(base.id);
  const faltas = faltantesDeConteo(conteo);
  if (faltas.length) return json(res, 400, { error: faltas.join(' ') });

  db.exec('BEGIN');
  try {
    const congelar = db.prepare('UPDATE almacen_conteo_renglones SET teorico = ? WHERE id = ?');
    for (const r of conteo.renglones) congelar.run(r.teorico, r.id);
    db.prepare(`
      UPDATE almacen_conteos SET estado = 'por_autorizar', cerrado_en = ?, cerrado_por = ?,
             correccion_nota = NULL, correccion_por = NULL, correccion_en = NULL
       WHERE id = ?
    `).run(new Date().toISOString(), usuario.id, conteo.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const actual = conteoCompleto(conteo.id);
  json(res, 200, {
    conteo: actual,
    mensaje: actual.con_diferencia
      ? `Conteo enviado con ${actual.con_diferencia} producto(s) descuadrados. Falta que otra persona apruebe el ajuste.`
      : 'Conteo enviado y cuadrado. Falta que otra persona lo apruebe.',
  });
});

// Aprobar el ajuste: aquí, y solo aquí, el conteo toca el inventario. Quien lo
// envió o contó alguno de sus renglones no lo aprueba, salvo que tenga además el
// permiso de aprobar sus propios conteos (decisión de Ronaldo: se asigna aparte).
// No hereda de ningún permiso anterior: nadie lo tiene hasta que se le da.
ruta('POST', '/api/almacen/conteos/(\\d+)/aprobar', (req, res, p) => {
  const usuario = exigir(req, res, 'conteos_aprobar');
  if (!usuario) return;

  const conteo = conteoCompleto(Number(p[1]));
  if (!conteo) return json(res, 404, { error: 'Conteo no encontrado' });
  if (conteo.estado !== 'por_autorizar') return json(res, 409, { error: 'Ese conteo no está esperando aprobación.' });
  if (!puede(usuario, 'conteos_aprobar_propios')
      && (conteo.cerrado_por === usuario.id || conteo.renglones.some((r) => r.contado_por === usuario.id))) {
    return json(res, 409, {
      error: 'Tú contaste o enviaste este conteo. Aprobar el ajuste le toca a otra persona, salvo que tengas el permiso de aprobar tus propios conteos.',
    });
  }

  const referencia = `CONTEO ${conteo.semana} ${conteo.bodega_clave}`;
  const ahora = new Date().toISOString();
  let ajustados = 0;

  db.exec('BEGIN');
  try {
    for (const r of conteo.renglones) {
      if (!r.diferencia) continue;
      anotarMovimiento({
        fecha: conteo.fecha, tipo: 'ajuste', productoId: r.producto_id,
        origen: r.diferencia < 0 ? conteo.bodega_id : null,
        destino: r.diferencia > 0 ? conteo.bodega_id : null,
        cantidad: r.diferencia,
        referencia, origenTipo: 'conteo', origenId: conteo.id,
        usuarioId: usuario.id,
        notas: r.observacion || `Ajuste por conteo: teórico ${r.teorico}, contado ${r.contado}.`,
      });
      ajustados++;
    }
    db.prepare("UPDATE almacen_conteos SET estado = 'aplicado', autorizo_id = ?, autorizado_en = ? WHERE id = ?")
      .run(usuario.id, ahora, conteo.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  json(res, 200, {
    conteo: conteoCompleto(conteo.id),
    mensaje: ajustados
      ? `Ajuste aprobado: ${ajustados} producto(s) corregidos en el inventario.`
      : 'Conteo aprobado. No hubo nada que corregir.',
  });
});

// Pedir reconteo: el conteo vuelve a abrirse con una nota. Los renglones que
// traían diferencia quedan marcados para recontarse; lo teórico se descongela.
// Si el ajuste ya se había aplicado, se quita del inventario.
ruta('POST', '/api/almacen/conteos/(\\d+)/reconteo', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'conteos_reconteo');
  if (!usuario) return;
  const conteo = conteoCompleto(Number(p[1]));
  if (!conteo) return json(res, 404, { error: 'Conteo no encontrado' });
  if (!['por_autorizar', 'aplicado'].includes(conteo.estado)) {
    return json(res, 409, { error: 'Solo se pide reconteo de un conteo ya enviado.' });
  }
  const nota = notaDeCorreccion(res, cuerpo);
  if (nota === null) return;
  if (conteo.estado === 'aplicado') {
    const negativo = quedariaNegativo('conteo', conteo.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const marcar = db.prepare('UPDATE almacen_conteo_renglones SET recontar = ? WHERE id = ?');
    for (const r of conteo.renglones) marcar.run(r.diferencia ? 1 : 0, r.id);
    db.prepare('UPDATE almacen_conteo_renglones SET teorico = NULL WHERE conteo_id = ?').run(conteo.id);
    borrarMovimientosDe.run('conteo', conteo.id);
    db.prepare(`
      UPDATE almacen_conteos SET estado = 'borrador', cerrado_en = NULL, cerrado_por = NULL,
             autorizo_id = NULL, autorizado_en = NULL,
             correccion_nota = ?, correccion_por = ?, correccion_en = ?
       WHERE id = ?
    `).run(nota, usuario.id, ahora, conteo.id);
    anotarCorreccion('conteo', conteo.id, `${conteo.semana} ${conteo.bodega_clave}`, conteo.estado, nota, usuario.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, {
    conteo: conteoCompleto(conteo.id),
    mensaje: conteo.estado === 'aplicado'
      ? 'Reconteo pedido. El ajuste que se había aplicado salió del inventario; al recontar se vuelve a aprobar.'
      : 'Reconteo pedido. Los productos con diferencia quedaron marcados para recontarse.',
  });
});

ruta('POST', '/api/almacen/conteos/(\\d+)/cancelar', (req, res, p, cuerpo) => {
  const usuario = exigir(req, res, 'conteos_aprobar');
  if (!usuario) return;
  const conteo = db.prepare('SELECT * FROM almacen_conteos WHERE id = ?').get(Number(p[1]));
  if (!conteo) return json(res, 404, { error: 'Conteo no encontrado' });
  if (conteo.estado === 'cancelado') return json(res, 409, { error: 'Ya estaba cancelado.' });
  const motivo = String(cuerpo.motivo || '').trim();
  if (!motivo) return json(res, 400, { error: 'Escribe por qué lo cancelas. Queda registrado.' });
  if (conteo.estado === 'aplicado') {
    const negativo = quedariaNegativo('conteo', conteo.id);
    if (negativo) return json(res, 409, { error: negativo });
  }

  db.exec('BEGIN');
  try {
    borrarMovimientosDe.run('conteo', conteo.id);
    db.prepare("UPDATE almacen_conteos SET estado = 'cancelado', notas = ? WHERE id = ?")
      .run(`${conteo.notas ? conteo.notas + ' · ' : ''}Cancelado: ${motivo}`, conteo.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  json(res, 200, { ok: true });
});

// --- reportes de almacén ---

// El reporte de Almacén. Todo por rango de fechas y agrupado por día, semana o
// mes: cuánto entra y sale, qué material sale y cuántas cajas de empaque se
// usan por modelo, cuánto tardan los retiros en cerrarse, las correcciones, los
// conteos y los ajustes que produjeron. La carga inicial no cuenta como
// movimiento: es el punto de partida, no algo que pasó en el periodo.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

ruta('GET', '/api/almacen/reportes', (req, res) => {
  if (!exigir(req, res, 'almacen_reportes')) return;
  const url = new URL(req.url, 'http://x');
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const hasta = fecha(url.searchParams.get('hasta')) || hoyISO();
  const hace28 = new Date();
  hace28.setDate(hace28.getDate() - 27);
  const desde = fecha(url.searchParams.get('desde')) || hoyISO(hace28);
  const agrupar = ['dia', 'semana', 'mes'].includes(url.searchParams.get('agrupar')) ? url.searchParams.get('agrupar') : 'semana';
  if (desde > hasta) return json(res, 400, { error: 'La fecha inicial queda después de la final.' });

  const periodoDe = (f) => (agrupar === 'dia' ? f : agrupar === 'mes' ? f.slice(0, 7) : periodoASemana(f));
  const etiquetaDe = (clave) => {
    if (agrupar === 'dia') return clave.split('-').reverse().slice(0, 2).join('/');
    if (agrupar === 'mes') return `${MESES_CORTOS[Number(clave.slice(5, 7)) - 1]} ${clave.slice(0, 4)}`;
    return describirSemana(clave).replace(/^Semana /, 'Sem ');
  };
  const periodos = [];
  const vistos = new Set();
  const [anio, mes, dia] = desde.split('-').map(Number);
  for (let d = new Date(anio, mes - 1, dia); hoyISO(d) <= hasta; d.setDate(d.getDate() + 1)) {
    const clave = periodoDe(hoyISO(d));
    if (!vistos.has(clave)) { vistos.add(clave); periodos.push({ clave, etiqueta: etiquetaDe(clave) }); }
    if (periodos.length > 400) break;
  }
  if (agrupar === 'dia' && periodos.length > 62) {
    return json(res, 400, { error: 'Por día se ven máximo dos meses. Acorta el rango o agrupa por semana.' });
  }

  const minutosEntre = (x, y) => (x && y ? Math.max(0, Math.round((Date.parse(y) - Date.parse(x)) / 60000)) : null);
  const promedio = (lista) => (lista.length ? Math.round(lista.reduce((n, v) => n + v, 0) / lista.length) : null);

  // Los movimientos del periodo, con su signo: suma lo que llega a una bodega
  // sin salir de otra, resta lo que sale sin llegar a otra; un traspaso no cambia
  // el total.
  const movimientos = db.prepare(`
    SELECT m.fecha, m.tipo, m.producto_id, m.cantidad, m.bodega_origen_id, m.bodega_destino_id,
           m.referencia, m.notas, m.origen_tipo, m.origen_id, m.creado_en,
           p.sku, p.nombre AS producto, p.modelo, p.tipo_material,
           bo.clave AS origen, bd.clave AS destino, u.nombre AS quien
      FROM almacen_movimientos m
      JOIN almacen_productos p ON p.id = m.producto_id
      LEFT JOIN almacen_bodegas bo ON bo.id = m.bodega_origen_id
      LEFT JOIN almacen_bodegas bd ON bd.id = m.bodega_destino_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.fecha BETWEEN ? AND ? AND COALESCE(m.origen_tipo, '') <> 'carga_inicial'
     ORDER BY m.fecha, m.id
  `).all(desde, hasta).map((m) => {
    const n = Math.abs(m.cantidad);
    const signo = m.bodega_destino_id && !m.bodega_origen_id ? 1 : m.bodega_origen_id && !m.bodega_destino_id ? -1 : 0;
    return { ...m, unidades: n, neto: signo * n, periodo: periodoDe(m.fecha) };
  });

  const vacio = () => ({ entradas: 0, retiros: 0, salidas: 0, devoluciones: 0, traspasos: 0, ajustes_suben: 0, ajustes_bajan: 0 });
  const porPeriodo = new Map(periodos.map((pe) => [pe.clave, { ...pe, ...vacio() }]));
  const COLUMNA = { entrada: 'entradas', retiro: 'retiros', salida: 'salidas', devolucion: 'devoluciones', traspaso: 'traspasos' };
  for (const m of movimientos) {
    const fila = porPeriodo.get(m.periodo);
    if (!fila) continue;
    if (m.tipo === 'ajuste') fila[m.neto >= 0 ? 'ajustes_suben' : 'ajustes_bajan'] += m.unidades;
    else if (COLUMNA[m.tipo]) fila[COLUMNA[m.tipo]] += m.unidades;
  }

  // Cuántas piezas salen de cada material, periodo por periodo.
  const salenPorProducto = new Map();
  for (const m of movimientos.filter((x) => x.tipo === 'salida')) {
    if (!salenPorProducto.has(m.producto_id)) {
      salenPorProducto.set(m.producto_id, {
        producto_id: m.producto_id, sku: m.sku, producto: m.producto, modelo: m.modelo,
        tipo_material: m.tipo_material, unidad: unidadDe(m.tipo_material), total: 0, periodos: {},
      });
    }
    const f = salenPorProducto.get(m.producto_id);
    f.total += m.unidades;
    f.periodos[m.periodo] = (f.periodos[m.periodo] || 0) + m.unidades;
  }
  const piezas = [...salenPorProducto.values()].sort((x, y) => y.total - x.total);

  // Cajas de empaque por modelo: todas las del catálogo, aunque no se hayan movido.
  const cajas = db.prepare("SELECT id, sku, nombre, modelo FROM almacen_productos WHERE tipo_material = 'Cajas' ORDER BY orden, nombre")
    .all().map((c) => {
      const suyos = movimientos.filter((m) => m.producto_id === c.id);
      const periodosCaja = {};
      for (const m of suyos.filter((x) => x.tipo === 'salida')) {
        periodosCaja[m.periodo] = (periodosCaja[m.periodo] || 0) + m.unidades;
      }
      return {
        ...c,
        salen: suyos.filter((m) => m.tipo === 'salida').reduce((n, m) => n + m.unidades, 0),
        entran: suyos.filter((m) => m.tipo === 'entrada' || m.tipo === 'retiro' || m.tipo === 'devolucion')
          .reduce((n, m) => n + m.unidades, 0),
        existencia: existenciasPorBodega().get(c.id)
          ? [...existenciasPorBodega().get(c.id).values()].reduce((n, v) => n + v, 0) : 0,
        periodos: periodosCaja,
      };
    });

  const correccionesDeDoc = (tipo) => `(SELECT COUNT(*) FROM almacen_correcciones c WHERE c.documento_tipo = '${tipo}' AND c.documento_id = d.id)`;

  const entradas = db.prepare(`
    SELECT d.id, d.folio, d.fuente, COALESCE(d.proveedor, d.plataforma) AS quien, d.fecha, d.estado,
           d.creado_en, d.enviado_en, d.aprobado_en, d.aplicado_en,
           u.nombre AS capturo, ap.nombre AS aprobo, r.estado AS estado_calidad, r.aprobado_en AS calidad_aprobada_en,
           (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_entrada_renglones x WHERE x.entrada_id = d.id) AS unidades,
           (SELECT COALESCE(SUM(x.cantidad_aplicada), 0) FROM almacen_entrada_renglones x WHERE x.entrada_id = d.id) AS unidades_aplicadas,
           ${correccionesDeDoc('entrada')} AS correcciones
      FROM almacen_entradas d
      JOIN usuarios u ON u.id = d.usuario_id
      LEFT JOIN usuarios ap ON ap.id = d.aprobado_por
      LEFT JOIN recepciones r ON r.id = d.recepcion_id
     WHERE d.fecha BETWEEN ? AND ?
     ORDER BY d.fecha DESC, d.id DESC
  `).all(desde, hasta);

  const salidas = db.prepare(`
    SELECT d.id, d.folio, d.motivo, d.destino, d.fecha, d.estado, d.enviado_en, d.aplicado_en,
           u.nombre AS capturo, a.nombre AS aprobo, b.clave AS bodega,
           (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_salida_renglones x WHERE x.salida_id = d.id) AS unidades,
           ${correccionesDeDoc('salida')} AS correcciones
      FROM almacen_salidas d
      JOIN usuarios u ON u.id = d.usuario_id
      LEFT JOIN usuarios a ON a.id = d.autorizo_id
      JOIN almacen_bodegas b ON b.id = d.bodega_id
     WHERE d.motivo <> 'traspaso' AND d.fecha BETWEEN ? AND ?
     ORDER BY d.fecha DESC, d.id DESC
  `).all(desde, hasta).map((f) => {
    const completa = ['por_autorizar', 'aplicada'].includes(f.estado) ? salidaCompleta(f.id) : null;
    return {
      ...f,
      motivo_texto: ETIQUETA_MOTIVO[f.motivo] || f.motivo,
      fuera_odt: completa ? razonesDeAutorizacion(completa).length > 0 : false,
    };
  });

  const devoluciones = db.prepare(`
    SELECT d.id, d.folio, d.rechazo_de, d.quien, d.motivo, d.fecha, d.estado, d.enviado_en, d.aplicado_en,
           u.nombre AS capturo, a.nombre AS aprobo,
           (SELECT COALESCE(SUM(x.cantidad), 0) FROM almacen_devolucion_renglones x WHERE x.devolucion_id = d.id) AS unidades,
           ${correccionesDeDoc('devolucion')} AS correcciones
      FROM almacen_devoluciones d
      JOIN usuarios u ON u.id = d.usuario_id
      LEFT JOIN usuarios a ON a.id = d.autorizo_id
     WHERE d.fecha BETWEEN ? AND ?
     ORDER BY d.fecha DESC, d.id DESC
  `).all(desde, hasta);

  // El re-ingreso de cada retiro: lo que Calidad recibió caja por caja y lo que
  // de verdad entró al inventario.
  const reingresos = db.prepare(`
    SELECT g.id, g.folio, g.fecha, g.estado, g.cajas, g.creado_en, g.enviado_en, g.aprobado_en,
           b.nombre AS bodega, u.nombre AS recibio, ap.nombre AS aprobo,
           e.id AS retiro_id, e.folio AS retiro_folio, e.plataforma,
           (SELECT COUNT(*) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS renglones,
           (SELECT COALESCE(SUM(c.cantidad), 0) FROM almacen_reingreso_cajas c WHERE c.reingreso_id = g.id) AS unidades,
           (SELECT COUNT(*) FROM almacen_correcciones x WHERE x.documento_tipo = 'reingreso' AND x.documento_id = g.id) AS correcciones
      FROM almacen_reingresos g
      JOIN almacen_bodegas b ON b.id = g.bodega_id
      JOIN usuarios u ON u.id = g.usuario_id
      LEFT JOIN usuarios ap ON ap.id = g.aprobado_por
      JOIN almacen_entradas e ON e.id = g.entrada_id
     WHERE g.fecha BETWEEN ? AND ?
     ORDER BY g.fecha DESC, g.id DESC
  `).all(desde, hasta).map((g) => ({
    ...g,
    min_aprobacion: minutosEntre(g.enviado_en, g.aprobado_en),
  }));

  // Retiros de plataforma: cuánto tardan de que se cargan a que se cierran, y en
  // qué tramo se detienen. Ya no pasan por muestreo: lo que los cierra es que
  // llegue todo el material y se aprueben sus re-ingresos.
  const retiros = db.prepare(`
    SELECT e.id, e.folio, e.plataforma, e.fecha, e.estado, e.creado_en, e.enviado_en, e.cerrado_en,
           u.nombre AS capturo, ce.nombre AS cerro,
           (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_entrada_renglones r WHERE r.entrada_id = e.id) AS pedido,
           (SELECT COUNT(*) FROM almacen_correcciones x WHERE x.documento_tipo = 'entrada' AND x.documento_id = e.id) AS correcciones
      FROM almacen_entradas e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN usuarios ce ON ce.id = e.cerrado_por
     WHERE e.fuente = 'retiro' AND e.fecha BETWEEN ? AND ?
     ORDER BY e.fecha DESC, e.id DESC
  `).all(desde, hasta).map((e) => {
    const suyos = reingresos.filter((g) => g.retiro_id === e.id && g.estado === 'aplicado');
    const primero = suyos.map((g) => g.enviado_en).filter(Boolean).sort()[0] || null;
    return {
      id: e.id, folio: e.folio, plataforma: e.plataforma, fecha: e.fecha, estado: e.estado,
      capturo: e.capturo, cerro: e.cerro, pedido: e.pedido, correcciones: e.correcciones,
      entregas: suyos.length,
      recibido: suyos.reduce((n, g) => n + g.unidades, 0),
      cajas: suyos.reduce((n, g) => n + g.cajas, 0),
      // Los tres tramos del camino: capturarlo, esperar a que la plataforma lo
      // mande, y que se apruebe lo que llegó.
      min_a_solicitud: minutosEntre(e.creado_en, e.enviado_en),
      min_esperando: minutosEntre(e.enviado_en, primero),
      min_aprobacion: promedio(suyos.map((g) => g.min_aprobacion).filter((v) => v !== null)),
      min_total: minutosEntre(e.creado_en, e.cerrado_en),
    };
  });
  const plataformas = [...new Set(retiros.map((r) => r.plataforma))].map((plataforma) => {
    const suyos = retiros.filter((r) => r.plataforma === plataforma);
    const cerrados = suyos.filter((r) => r.min_total !== null);
    return {
      plataforma,
      retiros: suyos.length,
      cerrados: cerrados.length,
      pedido: suyos.reduce((n, r) => n + r.pedido, 0),
      recibido: suyos.reduce((n, r) => n + r.recibido, 0),
      promedio_total: promedio(cerrados.map((r) => r.min_total)),
      promedio_esperando: promedio(suyos.map((r) => r.min_esperando).filter((v) => v !== null)),
      promedio_aprobacion: promedio(suyos.map((r) => r.min_aprobacion).filter((v) => v !== null)),
    };
  });

  // Las salidas que pidió Calidad por material dañado. Van aparte de las de
  // venta: no salieron vendidas, se perdieron, y eso se mira de otra manera.
  const salidasCalidad = db.prepare(`
    SELECT s.id, s.folio, s.fecha, s.estado, s.notas, s.enviado_en, s.aplicado_en,
           b.nombre AS bodega, u.nombre AS pidio, a.nombre AS aprobo,
           (SELECT COALESCE(SUM(r.cantidad), 0) FROM almacen_salida_renglones r WHERE r.salida_id = s.id) AS unidades,
           (SELECT COUNT(*) FROM almacen_fotos f
             WHERE (f.documento_tipo = 'salida' AND f.documento_id = s.id)
                OR (f.documento_tipo = 'salida_renglon'
                    AND f.documento_id IN (SELECT r.id FROM almacen_salida_renglones r WHERE r.salida_id = s.id))) AS fotos
      FROM almacen_salidas s
      JOIN almacen_bodegas b ON b.id = s.bodega_id
      JOIN usuarios u ON u.id = s.usuario_id
      LEFT JOIN usuarios a ON a.id = s.autorizo_id
     WHERE s.motivo = 'calidad' AND s.fecha BETWEEN ? AND ?
     ORDER BY s.fecha DESC, s.id DESC
  `).all(desde, hasta).map((f) => ({
    ...f,
    min_aprobacion: minutosEntre(f.enviado_en, f.aplicado_en),
    // Producto por producto, con su motivo: es lo que se mira en una baja.
    productos: db.prepare(`
      SELECT p.nombre AS producto, p.sku, r.cantidad, r.motivo,
             (SELECT COUNT(*) FROM almacen_fotos x WHERE x.documento_tipo = 'salida_renglon' AND x.documento_id = r.id) AS fotos
        FROM almacen_salida_renglones r JOIN almacen_productos p ON p.id = r.producto_id
       WHERE r.salida_id = ? ORDER BY r.orden, r.id
    `).all(f.id),
  }));

  const correcciones = db.prepare(`
    SELECT c.documento_tipo, c.documento_id, c.folio, c.estado_anterior, c.nota, c.en, u.nombre AS quien
      FROM almacen_correcciones c LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE substr(c.en, 1, 10) BETWEEN ? AND ?
     ORDER BY c.en DESC
  `).all(desde, hasta);

  const conteos = db.prepare(`
    SELECT c.id, c.semana, c.fecha, c.estado, b.nombre AS bodega, ce.nombre AS envio, a.nombre AS aprobo,
           COUNT(r.id) AS productos,
           SUM(CASE WHEN r.teorico IS NOT NULL AND r.contado = r.teorico THEN 1 ELSE 0 END) AS cuadrados,
           SUM(CASE WHEN r.teorico IS NOT NULL THEN ABS(COALESCE(r.contado, 0) - r.teorico) ELSE 0 END) AS unidades_descuadre,
           (SELECT COUNT(*) FROM almacen_correcciones x WHERE x.documento_tipo = 'conteo' AND x.documento_id = c.id) AS reconteos
      FROM almacen_conteos c
      JOIN almacen_bodegas b ON b.id = c.bodega_id
      LEFT JOIN usuarios ce ON ce.id = c.cerrado_por
      LEFT JOIN usuarios a ON a.id = c.autorizo_id
      LEFT JOIN almacen_conteo_renglones r ON r.conteo_id = c.id
     WHERE c.fecha BETWEEN ? AND ?
     GROUP BY c.id ORDER BY c.semana DESC, b.nombre
  `).all(desde, hasta).map((c) => ({
    ...c,
    exactitud: ['por_autorizar', 'aplicado'].includes(c.estado) && c.productos
      ? Math.round((c.cuadrados / c.productos) * 100) : null,
  }));

  // Cómo se llegó al número en cada producto que descuadró: cuántas cajas de
  // cuántas piezas, y si quedó la foto. Es la prueba de que el conteo se hizo
  // caja por caja y no de memoria.
  const detalleCajas = db.prepare(`
    SELECT c.id AS conteo_id, c.semana, c.fecha, b.nombre AS bodega, p.nombre AS producto, p.sku,
           p.tipo_material, r.id AS renglon_id, r.contado, r.teorico, r.observacion,
           q.nombre AS conto,
           (SELECT COUNT(*) FROM almacen_fotos f
             WHERE f.documento_tipo = 'conteo_renglon' AND f.documento_id = r.id) AS fotos
      FROM almacen_conteo_renglones r
      JOIN almacen_conteos c ON c.id = r.conteo_id
      JOIN almacen_bodegas b ON b.id = c.bodega_id
      JOIN almacen_productos p ON p.id = r.producto_id
      LEFT JOIN usuarios q ON q.id = r.contado_por
     WHERE c.fecha BETWEEN ? AND ? AND r.teorico IS NOT NULL AND r.contado IS NOT NULL
       AND r.contado <> r.teorico
     ORDER BY c.fecha DESC, p.nombre
  `).all(desde, hasta).map((f) => {
    const cajas = db.prepare(
      'SELECT cajas, piezas_por_caja FROM almacen_conteo_cajas WHERE renglon_id = ? ORDER BY orden, id'
    ).all(f.renglon_id);
    return {
      ...f,
      unidad: unidadDe(f.tipo_material),
      diferencia: f.contado - f.teorico,
      cajas,
      cajas_texto: cajas.map((c) => `${c.cajas} caja(s) de ${c.piezas_por_caja}`).join(' + ') || null,
      piezas_en_cajas: cajas.reduce((n, c) => n + c.cajas * c.piezas_por_caja, 0),
      total_cajas: cajas.reduce((n, c) => n + c.cajas, 0),
    };
  });

  const ajustes = movimientos.filter((m) => m.tipo === 'ajuste').map((m) => ({
    fecha: m.fecha, producto: m.producto, sku: m.sku, bodega: m.destino || m.origen,
    cantidad: m.neto, unidad: unidadDe(m.tipo_material),
    referencia: m.referencia, notas: m.notas, quien: m.quien,
  }));

  const suma = (lista, campo) => lista.reduce((n, x) => n + (x[campo] || 0), 0);
  const filas = inventario();
  json(res, 200, {
    desde,
    hasta,
    agrupar,
    periodos,
    resumen: {
      entradas: movimientos.filter((m) => m.tipo === 'entrada').reduce((n, m) => n + m.unidades, 0),
      retiros: movimientos.filter((m) => m.tipo === 'retiro').reduce((n, m) => n + m.unidades, 0),
      salidas: movimientos.filter((m) => m.tipo === 'salida').reduce((n, m) => n + m.unidades, 0),
      devoluciones: movimientos.filter((m) => m.tipo === 'devolucion').reduce((n, m) => n + m.unidades, 0),
      traspasos: movimientos.filter((m) => m.tipo === 'traspaso').reduce((n, m) => n + m.unidades, 0),
      ajustes_suben: ajustes.filter((x) => x.cantidad > 0).reduce((n, x) => n + x.cantidad, 0),
      ajustes_bajan: -ajustes.filter((x) => x.cantidad < 0).reduce((n, x) => n + x.cantidad, 0),
      documentos: entradas.length + salidas.length + devoluciones.length,
      correcciones: correcciones.length,
      conteos: conteos.length,
      exactitud: promedio(conteos.map((c) => c.exactitud).filter((v) => v !== null)),
      retiro_promedio_min: promedio(retiros.map((r) => r.min_total).filter((v) => v !== null)),
      retiro_espera_min: promedio(retiros.map((r) => r.min_esperando).filter((v) => v !== null)),
      retiros_cerrados: retiros.filter((r) => r.min_total !== null).length,
      retiros_abiertos: retiros.filter((r) => r.estado === 'pendiente_recibir').length,
      reingresos: reingresos.filter((g) => g.estado === 'aplicado').length,
      reingresos_unidades: reingresos.filter((g) => g.estado === 'aplicado').reduce((n, g) => n + g.unidades, 0),
      reingresos_cajas: reingresos.filter((g) => g.estado === 'aplicado').reduce((n, g) => n + g.cajas, 0),
      salidas_calidad: salidasCalidad.filter((f) => f.estado === 'aplicada').length,
      salidas_calidad_unidades: salidasCalidad.filter((f) => f.estado === 'aplicada').reduce((n, f) => n + f.unidades, 0),
      descuadres_con_cajas: detalleCajas.filter((f) => f.cajas.length).length,
      descuadres: detalleCajas.length,
      cajas_salen: suma(cajas, 'salen'),
      unidades_inventario: filas.reduce((n, f) => n + f.total, 0),
    },
    por_periodo: [...porPeriodo.values()],
    piezas,
    cajas,
    entradas,
    salidas,
    devoluciones,
    retiros,
    plataformas,
    reingresos,
    salidas_calidad: salidasCalidad,
    correcciones,
    conteos,
    detalle_cajas: detalleCajas,
    ajustes,
    alertas: filas.filter((f) => f.estado !== 'ok').sort((x, y) => x.total - y.total),
  });
});

ruta('GET', '/api/almacen/exportar.csv', (req, res) => {
  if (!exigir(req, res, 'almacen_reportes')) return;
  const bodegas = bodegasActivas();
  const encabezado = ['SKU', 'Modelo', 'Tipo material', 'Producto', 'Se cuenta en',
    ...bodegas.map((b) => `${b.nombre} (${b.clave})`), 'Total', 'Mínimo', 'Estado'];

  const ETIQUETA_ESTADO = {
    sin_stock: 'SIN STOCK', critico: 'CRÍTICO', bajo: 'BAJO', ok: 'OK',
  };
  const filas = inventario().map((f) => [
    f.sku, f.modelo, f.tipo_material, f.nombre, f.unidad,
    ...bodegas.map((b) => f.bodegas[b.clave]),
    f.total, f.stock_minimo, ETIQUETA_ESTADO[f.estado],
  ]);

  const csv = [encabezado, ...filas]
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="inventario-${hoyISO()}.csv"`,
  });
  res.end('﻿' + csv);
});
// ------------------------------------------------------------------ servidor

function json(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  // La pantalla compara esto con lo que cree: si el modo de pruebas se apagó
  // mientras alguien probaba, se da cuenta y lo regresa a su sesión real.
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'X-Inko-Prueba': enPrueba() ? '1' : '0' });
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

  // La pantalla pesa casi 800 KB entre el código y los estilos. Mandarla
  // completa en cada carga se sentía en la tablet —segundos de espera sobre el
  // wifi del almacén— así que ahora se hacen dos cosas que no cambian nada de lo
  // que se ve:
  //
  //   · Se manda COMPRIMIDA cuando el navegador dice que la entiende. El código
  //     baja de 700 KB a poco más de cien.
  //   · Se le pone una HUELLA (etag) con la fecha y el tamaño del archivo. Si la
  //     tablet ya tiene esa misma versión, el servidor contesta «no cambió» en
  //     unos bytes y el navegador usa la suya.
  //
  // Se conserva 'no-cache' a propósito: obliga a preguntar siempre, así que una
  // tablet nunca se queda con un app.js viejo hablando con un servidor nuevo.
  // Lo que se ahorra es el envío, no la pregunta.
  fs.stat(destino, (errStat, ficha) => {
    if (errStat || !ficha.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }

    const extension = path.extname(destino);
    const volatil = ['.html', '.js', '.css', '.webmanifest'].includes(extension);
    const huella = `W/"${ficha.size.toString(16)}-${ficha.mtimeMs.toString(16)}"`;
    const cabeceras = {
      'Content-Type': TIPOS_MIME[extension] || 'application/octet-stream',
      'Cache-Control': volatil ? 'no-cache' : 'public, max-age=86400',
      ETag: huella,
      'Last-Modified': ficha.mtime.toUTCString(),
    };

    if (req.headers['if-none-match'] === huella) {
      res.writeHead(304, cabeceras);
      res.end();
      return;
    }

    fs.readFile(destino, (err, contenido) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No encontrado');
        return;
      }

      const sePuedeComprimir = ['.html', '.js', '.css', '.webmanifest', '.json', '.svg', '.txt', '.md']
        .includes(extension);
      const aceptaGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (sePuedeComprimir && aceptaGzip && contenido.length > 1024) {
        zlib.gzip(contenido, (errZip, comprimido) => {
          if (errZip) {
            res.writeHead(200, cabeceras);
            res.end(contenido);
            return;
          }
          res.writeHead(200, { ...cabeceras, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
          res.end(comprimido);
        });
        return;
      }

      res.writeHead(200, cabeceras);
      res.end(contenido);
    });
  });
}

const servidor = http.createServer((req, res) => {
  const ruta_ = new URL(req.url, 'http://x').pathname;

  if (!ruta_.startsWith('/api/')) return servirEstatico(req, res);

  const coincidencia = rutas
    .map((r) => ({ r, m: ruta_.match(r.patron) }))
    .find(({ r, m }) => m && r.metodo === req.method);

  if (!coincidencia) return json(res, 404, { error: 'Ruta no encontrada' });

  // Quien entró «como» alguien en el modo de pruebas trabaja sobre la copia. Lo
  // que administra el propio modo (/api/pruebas) va siempre sobre la real.
  const sesion = sesionDe(req);
  const sobreCopia = sesion && sesion.prueba && modoPruebas().activo && !ruta_.startsWith('/api/pruebas');
  const correr = (fn) => (sobreCopia
    ? contexto.run({ db: abrirBasePruebas(), fotos: FOTOS_PRUEBAS, prueba: true }, fn)
    : fn());

  if (req.method === 'GET') {
    try {
      return correr(() => coincidencia.r.manejador(req, res, coincidencia.m));
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
      correr(() => coincidencia.r.manejador(req, res, coincidencia.m, cuerpo));
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

// --- bitácora de arranques y caídas ---
//
// La plataforma se estuvo cayendo sin dejar rastro. Aquí se anota, en
// datos/servidor.log, cada arranque y cada motivo de salida: un error del
// programa, que alguien cerró la ventana o que Windows la terminó. Con eso se
// sabe qué pasó en vez de adivinar.
const BITACORA = path.join(DATA_DIR, 'servidor.log');
const anotarBitacora = (texto) => {
  try { fs.appendFileSync(BITACORA, `${new Date().toLocaleString('es-MX')} · ${texto}
`); } catch { /* sin bitácora no se detiene nada */ }
};
process.on('uncaughtException', (err) => {
  anotarBitacora(`ERROR que detuvo la plataforma: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  anotarBitacora(`Error sin atender (la plataforma sigue): ${err && err.stack ? err.stack : err}`);
});
for (const senal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(senal, () => {
    anotarBitacora(`Se detuvo por ${senal === 'SIGHUP' ? 'cierre de la ventana' : senal === 'SIGINT' ? 'Ctrl+C' : `la señal ${senal}`}`);
    process.exit(0);
  });
}
process.on('exit', (codigo) => anotarBitacora(`Salió con código ${codigo}`));

// Si ya hay una plataforma abierta en este puerto no se insiste: se avisa y se
// sale con el código 2, que el arranque entiende como «ya estaba abierta».
servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`
   La plataforma ya está abierta en el puerto ${PUERTO}. No hace falta abrirla otra vez.
`);
    anotarBitacora(`No arrancó: el puerto ${PUERTO} ya estaba ocupado (ya había una abierta)`);
    process.exit(2);
  }
  throw err;
});

servidor.listen(PUERTO, () => {
  anotarBitacora(`Arrancó en el puerto ${PUERTO} (proceso ${process.pid})`);
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
