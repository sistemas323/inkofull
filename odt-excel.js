'use strict';

// Lee una ODT de INKO desde su archivo de Excel.
//
// El formato, tal como llega (ODT 27 AGO-03 SEPT 2026):
//
//   fila 2   Periodo, en letra: «Jueves 27 Agosto a Jueves 03 Septiembre 2026»
//   filas 3-5 Las CITAS de entrega, una por celda combinada, con esta forma:
//            «Viernes 28 Ago #72625023 CEDIS: MXCD14». Las que van entre
//            asteriscos venían resaltadas en el archivo.
//   fila 4   El nombre de la cuenta: «MERCADO LIBRE INKO (C35V6-S35)»
//   fila 6   Los encabezados: ID · Tipo · Modelo · Código · Modelo ·
//            Cantidad x Armar · Terminado · Pendiente · Unidades x Publicacion ·
//            Total Rollos
//   fila 7+  Un renglón por publicación.
//
// Y todo eso DOS VECES, lado a lado: un bloque por cuenta de Mercado Libre
// (INKO y TERMIKO). Por eso no se leen columnas fijas: se busca dónde dice
// «Código» y de ahí se arma cada bloque. Si la semana que viene el archivo trae
// tres cuentas, o alguien mueve una columna, sigue leyéndose igual.

const { abrir, numeroDeColumna } = require('./xlsx');

const MESES = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const letras = (n) => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
};
const esNumero = (v) => v !== undefined && /^-?\d+(\.\d+)?$/.test(String(v).trim());

// «Jueves 27 Agosto a Jueves 03 Septiembre 2026» → { dia, mes, anio }
function leerPeriodo(txt) {
  if (!txt) return null;
  const anio = (String(txt).match(/(20\d{2})/) || [])[1];
  const m = String(txt).match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)/);
  if (!anio || !m) return null;
  const mes = MESES[sinAcentos(m[2])];
  if (!mes) return null;
  return { dia: +m[1], mes, anio: +anio, texto: String(txt).trim() };
}

// «**Viernes 28 Ago #73880087** CEDIS: DANHOS»
function leerCita(txt, anioBase, mesBase) {
  const crudo = String(txt).trim();
  const destacada = /^\*\*|\*\*/.test(crudo);
  const limpio = crudo.replace(/\*\*/g, '').trim();

  const cedis = (limpio.match(/CEDIS\s*:\s*(.+?)\s*$/i) || [])[1];
  if (!cedis) return null;

  const folio = (limpio.match(/#\s*(\d+)/) || [])[1] || null;
  const f = limpio.match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)/);
  let fecha = null;
  let etiqueta = limpio.replace(/#\s*\d+/, '').replace(/CEDIS\s*:.*$/i, '').trim();

  if (f) {
    const mes = MESES[sinAcentos(f[2])];
    if (mes) {
      // El periodo puede cruzar de diciembre a enero: si el mes de la cita
      // quedó muy por detrás del mes en que arranca la semana, es del año
      // siguiente. Sin esto, una cita del 2 de enero se guardaría un año antes.
      const anio = mes < mesBase - 6 ? anioBase + 1 : anioBase;
      fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(+f[1]).padStart(2, '0')}`;
    }
  }
  return { fecha, etiqueta, folio, cedis: cedis.trim(), destacada, texto: limpio };
}

// Busca un encabezado por nombre dentro del rango de columnas de un bloque.
function columnaDe(hoja, fila, desde, hasta, nombres) {
  for (let c = desde; c <= hasta; c++) {
    const v = hoja.valor(letras(c), fila);
    if (v === undefined) continue;
    const t = sinAcentos(String(v));
    if (nombres.some((n) => t === n || t.startsWith(n))) return c;
  }
  return null;
}

function interpretar(hoja) {
  // 1. La fila de encabezados es la que tiene «Código». Puede haber una por
  //    bloque, pero están todas en la misma fila.
  let filaEncabezado = null;
  const columnasCodigo = [];
  for (let fila = 1; fila <= Math.min(hoja.maxFila, 40) && !filaEncabezado; fila++) {
    const encontradas = [];
    for (let c = 1; c <= 80; c++) {
      const v = hoja.valor(letras(c), fila);
      if (v !== undefined && sinAcentos(String(v)) === 'codigo') encontradas.push(c);
    }
    if (encontradas.length) { filaEncabezado = fila; columnasCodigo.push(...encontradas); }
  }
  if (!filaEncabezado) {
    throw new Error('No encuentro la columna «Código» en la hoja. ¿Es el archivo de la ODT?');
  }

  // 2. Cada bloque va desde su «ID» —o desde el «Código» si no lo trae— hasta
  //    donde empieza el siguiente.
  const bloques = columnasCodigo.map((colCodigo, i) => {
    let inicio = colCodigo;
    for (let c = colCodigo; c >= Math.max(1, colCodigo - 6); c--) {
      const v = hoja.valor(letras(c), filaEncabezado);
      if (v !== undefined && sinAcentos(String(v)) === 'id') { inicio = c; break; }
    }
    const fin = i + 1 < columnasCodigo.length ? columnasCodigo[i + 1] - 2 : inicio + 30;
    return { inicio, fin, colCodigo };
  });

  // 3. El periodo: la primera celda de arriba que traiga día, mes y año.
  let periodo = null;
  for (let fila = 1; fila < filaEncabezado && !periodo; fila++) {
    for (let c = 1; c <= 80 && !periodo; c++) {
      const v = hoja.valor(letras(c), fila);
      if (v && /20\d{2}/.test(String(v)) && /\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]+/.test(String(v))) {
        periodo = leerPeriodo(v);
      }
    }
  }
  if (!periodo) throw new Error('No encuentro el periodo de la ODT (algo como «Jueves 27 Agosto … 2026»).');

  const problemas = [];
  const cuentas = [];
  const vistas = new Set();

  for (const b of bloques) {
    const colCant = columnaDe(hoja, filaEncabezado, b.inicio, b.fin, ['cantidad x armar', 'cantidad']);
    const colTerm = columnaDe(hoja, filaEncabezado, b.inicio, b.fin, ['terminado']);
    const colUnid = columnaDe(hoja, filaEncabezado, b.inicio, b.fin, ['unidades x publicacion', 'unidades']);
    const colTotal = columnaDe(hoja, filaEncabezado, b.inicio, b.fin, ['total rollos', 'total']);
    const colTipo = columnaDe(hoja, filaEncabezado, b.inicio, b.fin, ['tipo']);

    // «Cantidad x Armar» abarca varias columnas combinadas y solo una trae el
    // número; se suman todas las del grupo, hasta donde empieza «Terminado».
    const cantDesde = colCant || b.colCodigo + 1;
    const cantHasta = (colTerm ? colTerm - 1 : (colUnid ? colUnid - 1 : cantDesde));

    // 4. El nombre de la cuenta y las citas viven arriba, dentro del bloque.
    let cuenta = null;
    const citas = [];
    for (let fila = 1; fila < filaEncabezado; fila++) {
      for (let c = b.inicio; c <= b.fin; c++) {
        const v = hoja.valor(letras(c), fila);
        if (v === undefined) continue;
        const t = String(v).trim();
        if (/CEDIS\s*:/i.test(t)) {
          const cita = leerCita(t, periodo.anio, periodo.mes);
          if (cita && !citas.some((x) => x.texto === cita.texto)) citas.push(cita);
        } else if (!cuenta && /mercado libre|amazon|cuenta/i.test(t)) {
          cuenta = t;
        }
      }
    }

    // 5. Los renglones.
    const renglones = [];
    for (let fila = filaEncabezado + 1; fila <= hoja.maxFila; fila++) {
      const codigo = hoja.valor(letras(b.colCodigo), fila);
      if (!codigo) continue;
      const limpio = String(codigo).trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,}$/.test(limpio)) continue;

      let cantidad = 0;
      for (let c = cantDesde; c <= cantHasta; c++) {
        const v = hoja.valor(letras(c), fila);
        if (esNumero(v)) cantidad += Number(v);
      }

      const unidades = colUnid ? hoja.valor(letras(colUnid), fila) : undefined;
      const total = colTotal ? hoja.valor(letras(colTotal), fila) : undefined;

      // El archivo trae la multiplicación hecha. Se comprueba en vez de
      // confiar: si no cuadra, algo se capturó mal y hay que decirlo antes de
      // que se convierta en material pedido de más o de menos.
      if (esNumero(unidades) && esNumero(total) && cantidad * Number(unidades) !== Number(total)) {
        problemas.push(`${limpio}: el archivo dice ${total} rollos, pero ${cantidad} × ${unidades} da ${cantidad * Number(unidades)}.`);
      }

      const clave = `${cuenta || ''}|${limpio}`;
      if (vistas.has(clave)) {
        problemas.push(`${limpio}: viene dos veces en ${cuenta || 'la misma cuenta'}; se sumaron las cantidades.`);
        const previo = renglones.find((r) => r.codigo === limpio);
        if (previo) { previo.pedidos += cantidad; continue; }
      }
      vistas.add(clave);

      renglones.push({
        codigo: limpio,
        pedidos: cantidad,
        tipo: colTipo ? hoja.valor(letras(colTipo), fila) || null : null,
        unidades_archivo: esNumero(unidades) ? Number(unidades) : null,
        total_archivo: esNumero(total) ? Number(total) : null,
      });
    }

    if (renglones.length) cuentas.push({ cuenta: cuenta || `Bloque ${cuentas.length + 1}`, citas, renglones });
  }

  if (!cuentas.length) throw new Error('La hoja no trae ningún renglón con código de publicación.');
  return { periodo, cuentas, problemas };
}

/** Lee el archivo y devuelve la ODT lista para guardar. */
function leerODT(buffer) {
  const hojas = abrir(buffer);
  // La hoja que se llame ODT; si no, la primera que tenga «Código».
  const preferida = hojas.find((h) => sinAcentos(h.nombre) === 'odt');
  const candidatas = preferida ? [preferida, ...hojas] : hojas;
  let ultimoError = null;
  for (const hoja of candidatas) {
    try { return { hoja: hoja.nombre, ...interpretar(hoja) }; }
    catch (err) { ultimoError = err; }
  }
  throw ultimoError || new Error('No pude leer la ODT del archivo.');
}

module.exports = { leerODT, leerCita, leerPeriodo };
