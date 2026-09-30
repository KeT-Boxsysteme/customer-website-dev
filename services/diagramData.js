// Daten fuer die Diagramme einer Box (/diagrams/:id) — reine Funktion, kein DB-Zugriff.
// Temperatur: Fuehler-Verlauf (stuendlich Mittel/Min/Max) + manuelle Eintraege + Soll mit den Grenzen
// der Ampel (eine Quelle: services/alerts.js). ppm: O2/H2O aus den manuellen Messwerten.
// Punkte als { x: Zeitstempel in ms, y: Wert }; leere Werte werden weggelassen, nicht als 0 gezeichnet.
const { FRIDGE_YELLOW_DELTA, FRIDGE_RED_DELTA } = require('./alerts');

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

function series(rows, timeKey, valueKey) {
  return rows
    .map(r => ({ x: new Date(r[timeKey]).getTime(), y: num(r[valueKey]) }))
    .filter(p => p.y !== null && !Number.isNaN(p.y) && !Number.isNaN(p.x))
    .sort((a, b) => a.x - b.x);
}

function buildCharts({ box, measurements = [], sensorHours = [] }) {
  let temp = null;
  if (box.has_fridge) {
    const avg = series(sensorHours, 'bucket', 'avg_temp');
    const manual = series(measurements, 'measured_at', 'fridge_temp');
    temp = {
      avg,
      min: series(sensorHours, 'bucket', 'min_temp'),
      max: series(sensorHours, 'bucket', 'max_temp'),
      manual,
      target: num(box.fridge_temp),
      limits: { yellow: FRIDGE_YELLOW_DELTA, red: FRIDGE_RED_DELTA },
      hasData: avg.length > 0 || manual.length > 0
    };
  }

  let ppm = null;
  if (box.has_o2_sensor || box.has_h2o_sensor) {
    const o2 = box.has_o2_sensor ? series(measurements, 'measured_at', 'o2_value') : null;
    const h2o = box.has_h2o_sensor ? series(measurements, 'measured_at', 'h2o_value') : null;
    ppm = { o2, h2o, hasData: (o2 || []).length > 0 || (h2o || []).length > 0 };
  }

  return { temp, ppm };
}

module.exports = { buildCharts };
