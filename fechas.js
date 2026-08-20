'use strict';

// Semana ISO: la semana 1 es la que contiene el primer jueves del año, y empieza
// en lunes. Es el criterio que ya usaban los checklists en papel ("Semana: __").
function semanaISO(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const diaSemana = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - diaSemana);
  const inicioAnio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((t - inicioAnio) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

function hoyISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Los checklists semanales guardan '2026-W34' y los diarios '2026-08-20'. Para
// comparar semana contra semana hay que llevar todo al mismo terreno.
function periodoASemana(periodo) {
  if (/^\d{4}-W\d{2}$/.test(periodo)) return periodo;
  const [anio, mes, dia] = periodo.split('-').map(Number);
  return semanaISO(new Date(anio, mes - 1, dia));
}

// '2026-W34' -> 'Semana 34 (17–23 ago 2026)'. El lunes de esa semana se obtiene
// retrocediendo desde el jueves, que por definición siempre cae dentro de ella.
function describirSemana(clave) {
  const [anio, semana] = clave.split('-W').map(Number);
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const lunesSemana1 = new Date(cuatroEnero);
  lunesSemana1.setUTCDate(cuatroEnero.getUTCDate() - ((cuatroEnero.getUTCDay() || 7) - 1));
  const lunes = new Date(lunesSemana1);
  lunes.setUTCDate(lunesSemana1.getUTCDate() + (semana - 1) * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mismoMes = lunes.getUTCMonth() === domingo.getUTCMonth();
  const rango = mismoMes
    ? `${lunes.getUTCDate()}–${domingo.getUTCDate()} ${MESES[domingo.getUTCMonth()]}`
    : `${lunes.getUTCDate()} ${MESES[lunes.getUTCMonth()]} – ${domingo.getUTCDate()} ${MESES[domingo.getUTCMonth()]}`;
  return `Semana ${semana} (${rango} ${domingo.getUTCFullYear()})`;
}

// Las N semanas ISO hacia atrás desde hoy, de la más antigua a la más reciente.
function ultimasSemanas(n, desde = new Date()) {
  const lista = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(desde);
    d.setDate(desde.getDate() - i * 7);
    lista.push(semanaISO(d));
  }
  return lista;
}

module.exports = { semanaISO, hoyISO, periodoASemana, describirSemana, ultimasSemanas };
