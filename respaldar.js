'use strict';

// Copia fechada de los datos en respaldos/. Se puede correr con la plataforma
// encendida: VACUUM INTO produce una copia consistente aunque alguien esté
// capturando en ese momento, cosa que copiar el archivo a mano no garantiza.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = __dirname;
const ORIGEN = path.join(RAIZ, 'datos');
const fecha = new Date().toISOString().slice(0, 10);
const destino = path.join(RAIZ, 'respaldos', `datos-${fecha}`);

if (!fs.existsSync(path.join(ORIGEN, 'checklists.db'))) {
  console.error('\n  No encuentro datos/checklists.db. ¿Estás en la carpeta de la plataforma?\n');
  process.exit(1);
}

fs.mkdirSync(path.join(destino, 'fotos'), { recursive: true });

const copiaBD = path.join(destino, 'checklists.db');
if (fs.existsSync(copiaBD)) fs.rmSync(copiaBD);

const db = new DatabaseSync(path.join(ORIGEN, 'checklists.db'));
db.exec(`VACUUM INTO '${copiaBD.replace(/'/g, "''")}'`);

let fotos = 0;
for (const archivo of fs.readdirSync(path.join(ORIGEN, 'fotos'))) {
  fs.copyFileSync(path.join(ORIGEN, 'fotos', archivo), path.join(destino, 'fotos', archivo));
  fotos++;
}

const copia = new DatabaseSync(copiaBD);
const cuenta = (tabla) => copia.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;

console.log(`\n  Respaldo guardado en: respaldos/datos-${fecha}\n`);
console.log(`     personas:  ${cuenta('usuarios')}`);
console.log(`     llenados:  ${cuenta('llenados')}`);
console.log(`     firmas:    ${cuenta('firmas')}`);
console.log(`     fotos:     ${fotos}`);
console.log(`\n  Para restaurar: apaga la plataforma y copia esta carpeta sobre 'datos'.\n`);
