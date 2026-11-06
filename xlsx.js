'use strict';

// Lector de archivos .xlsx sin dependencias.
//
// Un .xlsx es un ZIP con XML adentro. Node no trae lector de ZIP, pero sí trae
// zlib, y las entradas de un ZIP van comprimidas con deflate crudo: con eso
// alcanza. Son unas cuantas decenas de renglones y evita meterle a la
// plataforma su primera dependencia externa, que era de las reglas de la casa.
//
// No pretende leer todo el formato: lee celdas con valor —texto compartido,
// texto en línea y números— que es lo que trae una ODT. No interpreta fórmulas
// (usa el último valor calculado que Excel dejó guardado), ni formatos, ni
// colores.

const zlib = require('node:zlib');

// --- ZIP ---

function leerZip(buffer) {
  // El directorio central vive al final, después de un comentario de largo
  // variable, así que se busca su firma hacia atrás.
  let fin = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65558; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no parece un .xlsx (no encuentro el índice del ZIP).');

  const cuantas = buffer.readUInt16LE(fin + 10);
  let p = buffer.readUInt32LE(fin + 16);
  const entradas = new Map();

  for (let n = 0; n < cuantas; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buffer.readUInt16LE(p + 10);
    const comprimido = buffer.readUInt32LE(p + 20);
    const largoNombre = buffer.readUInt16LE(p + 28);
    const largoExtra = buffer.readUInt16LE(p + 30);
    const largoComentario = buffer.readUInt16LE(p + 32);
    const offset = buffer.readUInt32LE(p + 42);
    const nombre = buffer.toString('utf8', p + 46, p + 46 + largoNombre);
    entradas.set(nombre, { metodo, comprimido, offset });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return { buffer, entradas };
}

function sacar(zip, nombre) {
  const e = zip.entradas.get(nombre);
  if (!e) return null;
  const b = zip.buffer;
  if (b.readUInt32LE(e.offset) !== 0x04034b50) return null;
  // El encabezado local repite el nombre y los extras, con largos propios: los
  // del directorio central no siempre coinciden.
  const inicio = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
  const datos = b.subarray(inicio, inicio + e.comprimido);
  if (e.metodo === 0) return datos;
  if (e.metodo === 8) return zlib.inflateRawSync(datos);
  throw new Error(`El .xlsx viene comprimido de una forma que no sé leer (método ${e.metodo}).`);
}

// --- XML ---

const DESESCAPAR = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => DESESCAPAR[e]);

// Cada <si> puede venir partido en varios <t> por cambios de formato a media
// palabra; se pegan todos para recuperar el texto como se ve en pantalla.
function leerCadenas(xml) {
  if (!xml) return [];
  const fuera = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = '';
    for (const m of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
    fuera.push(texto(t));
  }
  return fuera;
}

const COLUMNA = /^([A-Z]+)(\d+)$/;
const numeroDeColumna = (letras) =>
  [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);

// Las celdas vacías vienen auto-cerradas (<c r="B2" s="1"/>). Si el patrón no
// las contempla, la expresión se come la siguiente celda con valor y todas las
// columnas quedan corridas un lugar — que es justo el error que hace que una
// ODT se lea con los datos en la columna equivocada.
const CELDA = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function leerHoja(xml, cadenas) {
  const celdas = new Map();
  let maxFila = 0;
  for (const m of xml.matchAll(CELDA)) {
    const ref = m[1];
    const attrs = m[2] || '';
    const cuerpo = m[3] || '';
    let valor;

    if (/t="s"/.test(attrs)) {
      const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
      if (v) valor = cadenas[+v[1]];
    } else if (/t="inlineStr"/.test(attrs)) {
      let t = '';
      for (const x of cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += x[1];
      valor = texto(t);
    } else {
      const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
      // t="str" es el resultado de una fórmula: texto, no número.
      if (v) valor = /t="str"/.test(attrs) ? texto(v[1]) : v[1];
    }

    if (valor === undefined || valor === '') continue;
    celdas.set(ref, String(valor).trim());
    const p = ref.match(COLUMNA);
    if (p && +p[2] > maxFila) maxFila = +p[2];
  }

  // Las celdas combinadas guardan el valor solo en la esquina superior
  // izquierda; se copia al resto para que buscar por columna encuentre el
  // encabezado aunque abarque varias.
  const combinadas = [];
  const bloque = xml.match(/<mergeCells[\s\S]*?<\/mergeCells>/);
  if (bloque) {
    for (const m of bloque[0].matchAll(/ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      combinadas.push([m[1], m[2]]);
    }
  }

  return { celdas, combinadas, maxFila };
}

/**
 * Abre un .xlsx y devuelve sus hojas ya leídas.
 * Cada hoja trae `valor(columna, fila)`, con las columnas por letra.
 */
function abrir(buffer) {
  const zip = leerZip(buffer);
  const libro = sacar(zip, 'xl/workbook.xml');
  if (!libro) throw new Error('El archivo no trae hoja de cálculo adentro.');
  const libroXml = libro.toString('utf8');
  const cadenas = leerCadenas((sacar(zip, 'xl/sharedStrings.xml') || '').toString('utf8'));

  // El nombre de cada hoja vive en workbook.xml y el archivo que le toca, en
  // sus relaciones: hay que cruzarlos por r:id, no por orden.
  const relaciones = new Map();
  const rels = sacar(zip, 'xl/_rels/workbook.xml.rels');
  if (rels) {
    for (const m of rels.toString('utf8').matchAll(/<Relationship([^>]*)\/>/g)) {
      const id = (m[1].match(/Id="([^"]+)"/) || [])[1];
      const destino = (m[1].match(/Target="([^"]+)"/) || [])[1];
      if (id && destino) relaciones.set(id, destino.replace(/^\/?(xl\/)?/, ''));
    }
  }

  const hojas = [];
  for (const m of libroXml.matchAll(/<sheet([^>]*)\/>/g)) {
    const nombre = texto((m[1].match(/name="([^"]*)"/) || [])[1] || '');
    const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
    const archivo = relaciones.get(rid);
    const datos = archivo && sacar(zip, 'xl/' + archivo);
    if (!datos) continue;

    const hoja = leerHoja(datos.toString('utf8'), cadenas);
    const valor = (col, fila) => {
      const directo = hoja.celdas.get(`${col}${fila}`);
      if (directo !== undefined) return directo;
      // ¿Cae dentro de una combinada? Entonces vale lo de su esquina.
      const c = numeroDeColumna(col);
      for (const [desde, hasta] of hoja.combinadas) {
        const a = desde.match(COLUMNA); const b = hasta.match(COLUMNA);
        if (!a || !b) continue;
        if (fila >= +a[2] && fila <= +b[2]
          && c >= numeroDeColumna(a[1]) && c <= numeroDeColumna(b[1])) {
          return hoja.celdas.get(desde);
        }
      }
      return undefined;
    };
    hojas.push({ nombre, valor, celdas: hoja.celdas, maxFila: hoja.maxFila });
  }

  if (!hojas.length) throw new Error('El archivo no trae ninguna hoja legible.');
  return hojas;
}

module.exports = { abrir, numeroDeColumna };
