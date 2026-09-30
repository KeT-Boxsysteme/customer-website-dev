// Daten fuer die Diagramme einer Box (/diagrams/:id) — reine Funktion, kein DB-Zugriff.
// Temperatur: Fuehler-Verlauf (stuendlich Mittel/Min/Max) + manuelle Eintraege + Soll mit den Grenzen
// der Ampel (eine Quelle: services/alerts.js). ppm: O2/H2O aus den manuellen Messwerten.
// Punkte als { x: Zeitstempel in ms, y: Wert }; leere Werte werden weggelassen, nicht als 0 gezeichnet.
const { FRIDGE_YELLOW_DELTA, FRIDGE_RED_DELTA } = require('./alerts');

// Zeitraeume (Betreiber 01.10.): kurz fuer den Fuehler, lang wie im Lastenheft (6/9/12 Monate).
// step = Schrittweite des Fuehler-Verlaufs in Minuten (ca. 300-1500 Punkte je Diagramm).
const RANGES = [
  { key: '24h', label: '24 h',     hours: 24,   step: 5 },
  { key: '7d',  label: '7 days',   hours: 168,  step: 30 },
  { key: '30d', label: '30 days',  hours: 720,  step: 120 },
  { key: '6m',  label: '6 months', months: 6,   step: 360 },
  { key: '9m',  label: '9 months', months: 9,   step: 360 },
  { key: '12m', label: '1 year',   months: 12,  step: 720 }
];
const LEGACY_MONTHS = { 6: '6m', 9: '9m', 12: '12m' };   // alte Links ?months=

// Zeitraum aus der Anfrage: { key, label, since, bucketMinutes } oder null (unbekannt -> Umleitung).
// Ohne Angabe: 7 Tage bei Boxen mit Fuehler, sonst 6 Monate.
function resolveRange(query, box, now = new Date()) {
  let key = query.range;
  if (!key && query.months !== undefined) {
    key = LEGACY_MONTHS[parseInt(query.months, 10)] || (Number.isNaN(parseInt(query.months, 10)) ? undefined : 'invalid');
  }
  if (!key) key = box.sensor_serial ? '7d' : '6m';
  const r = RANGES.find(x => x.key === key);
  if (!r) return null;
  const since = new Date(now.getTime());
  if (r.months) since.setUTCMonth(since.getUTCMonth() - r.months);
  else since.setTime(now.getTime() - r.hours * 3600 * 1000);
  return { key: r.key, label: r.label, since, bucketMinutes: r.step };
}

// Luecke laenger als 3 Schritte -> Punkt ohne Wert einfuegen, damit keine Linie ueber fehlende Daten laeuft
function breakGaps(points, bucketMinutes) {
  if (!bucketMinutes) return points;
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && p.x - prev.x > 3 * bucketMinutes * 60000) out.push({ x: prev.x + bucketMinutes * 60000, y: null });
    out.push(p);
  }
  return out;
}

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

function series(rows, timeKey, valueKey) {
  return rows
    .map(r => ({ x: new Date(r[timeKey]).getTime(), y: num(r[valueKey]) }))
    .filter(p => p.y !== null && !Number.isNaN(p.y) && !Number.isNaN(p.x))
    .sort((a, b) => a.x - b.x);
}

// Kennzahlen des Fuehler-Verlaufs: letzter Wert, Min, Max, Anteil der Schritte ausserhalb ±gelb
function stats(avg, min, max, target) {
  if (!avg.length) return null;
  const outside = target === null ? 0 : avg.filter(p => Math.abs(p.y - target) >= FRIDGE_YELLOW_DELTA).length;
  return {
    last: avg[avg.length - 1].y,
    min: Math.min(...min.map(p => p.y)),
    max: Math.max(...max.map(p => p.y)),
    outsidePct: Math.round((outside / avg.length) * 100)
  };
}

function buildCharts({ box, measurements = [], sensorHours = [], bucketMinutes = null }) {
  let temp = null;
  if (box.has_fridge) {
    const avg = series(sensorHours, 'bucket', 'avg_temp');
    const min = series(sensorHours, 'bucket', 'min_temp');
    const max = series(sensorHours, 'bucket', 'max_temp');
    const manual = series(measurements, 'measured_at', 'fridge_temp');
    const target = num(box.fridge_temp);
    temp = {
      avg: breakGaps(avg, bucketMinutes),
      min: breakGaps(min, bucketMinutes),
      max: breakGaps(max, bucketMinutes),
      manual,
      target,
      limits: { yellow: FRIDGE_YELLOW_DELTA, red: FRIDGE_RED_DELTA },
      stats: stats(avg, min, max, target),
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

module.exports = { buildCharts, resolveRange, RANGES };
