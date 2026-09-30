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

async function statusForBox(box) {
  const [latestMeasurement, acks] = await Promise.all([
    Measurement.findLatestByBox(box.id),
    AlertAck.latestAcks(box.id)
  ]);
  const fridgeLive = liveFridge(box);
  const alerts = buildAlerts({ box, latestMeasurement, acks, fridgeLive });
  return { latestMeasurement, acks, fridgeLive, alerts, statusColor: overallStatus(alerts) };
}

module.exports = { liveFridge, statusForBox };
