// Live-Werte der Temperaturfuehler im Arbeitsspeicher des Servers (nicht alle 5 s in die DB).
// Der Verbinder im Browser (public/js/sensor-hub.js) meldet jeden Wert; das Monitoring liest von hier.
// In die DB geht nur der Verlauf, im Takt der Box (E-19) — dueForHistory entscheidet, ob die DB
// ueberhaupt gefragt wird; SensorReading.createIfDue bleibt der atomare Riegel dahinter.
// Neustart des Servers = Live-Werte weg, bis der naechste Wert kommt (5 s) — gewollt.
const { storeWindowSeconds } = require('./sensor');

const FRESH_SECONDS = 20;   // aelter = kein Live-Wert mehr (fehlend statt falsch)

let values = new Map();      // Schluessel (Box + Art) -> { serial, temp, at, hub }
let lastStored = new Map();  // Schluessel (Box + Art) -> Zeitpunkt des letzten Verlaufs-Versuchs

// Zwei Fuehler je Box (E-34): Kuehlschrank (Vorgabe) und Boxtemperatur ('box') ueberschreiben sich nicht
const slot = (boxId, kind = 'fridge') => (kind === 'fridge' ? String(boxId) : boxId + ':' + kind);

// hub = gepruefte Zaehler des sendenden Verbinders (services/sensor.sanitizeHubDiag) oder null
function record(boxId, serial, temp, now = Date.now(), hub = null, kind = 'fridge') {
  values.set(slot(boxId, kind), { serial, temp, at: now, hub });
}

// Zustandsmeldungen der Verbinder (je Firma + Benutzer die letzte), nur im Speicher, 2 Min. gueltig
let reports = new Map();   // companyId:userId -> { report, at }
const REPORT_TTL_MS = 2 * 60 * 1000;

function recordReport(companyId, userId, report, now = Date.now()) {
  reports.set(companyId + ':' + userId, { companyId, report, at: now });
}

// Meldungen der eigenen Firma, die diesen Fuehler erwaehnen: { ...report ohne sensors, sensor, ageSeconds }
function reportsFor(companyId, serial, now = Date.now()) {
  const out = [];
  for (const [key, r] of reports) {
    if (now - r.at > REPORT_TTL_MS) { reports.delete(key); continue; }
    if (r.companyId !== companyId) continue;
    const sensor = r.report.sensors.find(s => s.serial === serial);
    if (!sensor) continue;
    const { sensors, ...rest } = r.report;
    out.push({ ...rest, sensor, ageSeconds: Math.round((now - r.at) / 1000) });
  }
  return out;
}

function hubDiag(boxId, kind = 'fridge') {
  const v = values.get(slot(boxId, kind));
  return v ? v.hub : null;
}

function get(boxId, now = Date.now(), kind = 'fridge') {
  const v = values.get(slot(boxId, kind));
  if (!v) return null;
  const ageSeconds = Math.max(0, Math.round((now - v.at) / 1000));
  return { serial: v.serial, temp: v.temp, ageSeconds, fresh: ageSeconds <= FRESH_SECONDS };
}

function dueForHistory(boxId, storeMinutes, now = Date.now(), kind = 'fridge') {
  const key = slot(boxId, kind);
  const last = lastStored.get(key);
  if (last !== undefined && now - last < storeWindowSeconds(storeMinutes) * 1000) return false;
  lastStored.set(key, now);
  return true;
}

function reset() {
  values = new Map();
  lastStored = new Map();
  reports = new Map();
}

module.exports = { FRESH_SECONDS, record, get, hubDiag, recordReport, reportsFor, dueForHistory, reset };
