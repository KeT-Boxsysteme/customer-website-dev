// Ampel-Status einer Box — eine Stelle fuer Monitoring-Seite und Dashboard (Betreiber 01.10.).
// Liest letzte manuelle Messung + Quittungen aus der DB und den Live-Wert des Fuehlers aus dem Speicher;
// die Regel selbst steht in services/alerts.js (reine Funktion).
const Measurement = require('../models/measurement');
const AlertAck = require('../models/alertAck');
const liveReadings = require('./liveReadings');
const { buildAlerts, overallStatus } = require('./alerts');

// Frischer Live-Wert des zugeordneten Fuehlers (E-21), sonst null
function liveFridge(box) {
  const v = liveReadings.get(box.id);
  if (!v || !v.fresh || !box.sensor_serial || v.serial !== box.sensor_serial) return null;
  return { temp: v.temp };
}

// Frischer Live-Wert des Box-Fuehlers (E-34, reine Info: keine Warnung), sonst null — fehlend statt falsch
function liveBoxTemp(box) {
  const v = liveReadings.get(box.id, Date.now(), 'box');
  if (!v || !v.fresh || !box.box_sensor_serial || v.serial !== box.box_sensor_serial) return null;
  return { temp: v.temp, ageSeconds: v.ageSeconds, fresh: true };
}

async function statusForBox(box) {
  const [latestMeasurement, acks] = await Promise.all([
    Measurement.findLatestByBox(box.id),
    AlertAck.latestAcks(box.id)
  ]);
  const fridgeLive = liveFridge(box);
  const alerts = buildAlerts({ box, latestMeasurement, acks, fridgeLive });
  return { latestMeasurement, acks, fridgeLive, alerts, statusColor: overallStatus(alerts) };
}

module.exports = { liveFridge, liveBoxTemp, statusForBox };
