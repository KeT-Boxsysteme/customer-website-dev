// Regeln rund um den Temperaturfuehler einer Box (Vault: Entscheidungen E-16/E-17/E-19).
// Reine Funktionen; geschrieben wird in Box.setSensor und SensorReading.createIfDue.
const { normalizeSerial } = require('../public/js/bluedan');

// Waehlbare Speichertakte in Minuten (E-19), Vorgabe 1
const STORE_MINUTES = [1, 5, 10, 15, 30, 60];
const DEFAULT_STORE_MINUTES = 1;

// Plausible Temperaturen in °C (Tiefkuehler bis Raum/Hand); alles andere ist ein Messfehler
const MIN_TEMP = -100;
const MAX_TEMP = 150;

// raw = Formularfeld sensorSerial (undefined = nicht gesendet), rawMinutes = sensorStoreMinutes
function decideSensorUpdate({ hasFridge, raw, rawMinutes }) {
  // Ohne Kuehlschrank kein Fuehler — Kuehlschrank und Fuehler gehoeren zusammen
  if (!hasFridge) return { action: 'clear' };
  // Fehlendes Feld heisst nicht "entfernen"
  if (raw === undefined) return { action: 'keep' };
  if (String(raw).trim() === '') return { action: 'clear' };
  const serial = normalizeSerial(String(raw));
  if (!serial) return { action: 'error' };

  let storeMinutes = DEFAULT_STORE_MINUTES;
  if (rawMinutes !== undefined && String(rawMinutes).trim() !== '') {
    storeMinutes = Number(rawMinutes);
    if (!STORE_MINUTES.includes(storeMinutes)) return { action: 'error' };
  }
  return { action: 'set', serial, storeMinutes };
}

// Zweiter Fuehler je Box (E-34): Boxtemperatur, reine Info. Welche Rolle hat dieser Fuehler an dieser Box?
// 'fridge' (nur mit Kuehlschrank), 'box' (immer erlaubt) oder null (gehoert nicht zu dieser Box).
function sensorKindFor(box, serial) {
  if (!serial) return null;
  if (box.has_fridge && box.sensor_serial && serial === box.sensor_serial) return 'fridge';
  if (box.box_sensor_serial && serial === box.box_sensor_serial) return 'box';
  return null;
}

// Ein Fuehler kann nicht zugleich Kuehlschrank- und Box-Fuehler derselben Box sein (fridge/box = decideSensorUpdate)
function sensorConflict(fridge, box) {
  return fridge.action === 'set' && box.action === 'set' && fridge.serial === box.serial;
}

// Sperrfenster nach einem gespeicherten Wert: Takt minus 5 s Toleranz (Browser tickt alle 5 s).
// Unbekannte Werte fallen auf den Vorgabetakt — nie auf ein groesseres Fenster.
function storeWindowSeconds(minutes) {
  const m = STORE_MINUTES.includes(minutes) ? minutes : DEFAULT_STORE_MINUTES;
  return m * 60 - 5;
}

// Messwert pruefen und auf 0,1 °C runden; unplausibel oder fehlend -> null
function validateReading(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_TEMP || n > MAX_TEMP) return null;
  return Math.round(n * 10) / 10;
}

// Zaehler, die der Verbinder im Browser mit jedem Wert mitschickt (Messinstrument, 01.10.):
// drops = Verbindungsabbrueche, attempts = Verbindungsversuche, lastError = letzte Fehlermeldung.
// Positivliste; alles andere wird verworfen. Kein Objekt -> null.
function sanitizeHubDiag(diag) {
  if (!diag || typeof diag !== 'object') return null;
  const count = v => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null);
  return {
    drops: count(diag.drops),
    attempts: count(diag.attempts),
    lastError: typeof diag.lastError === 'string' ? diag.lastError.slice(0, 120) : null
  };
}

// Zustandsmeldung des Verbinders (alle 15 s, auch ohne Werte) — Positivliste, Texte gekuerzt,
// hoechstens 10 Fuehler. Dient nur der Diagnose (Betreiber 01.10.: Verbindung unzuverlaessig).
function sanitizeHubReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || !Array.isArray(r.sensors)) return null;
  const count = v => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null);
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
  const bool = v => (typeof v === 'boolean' ? v : null);
  const sensors = (Array.isArray(r.sensors) ? r.sensors : []).slice(0, 10).map(s => ({
    serial: s && typeof s.serial === 'string' ? normalizeSerial(s.serial) : null,
    adopted: bool(s && s.adopted),
    connected: bool(s && s.connected),
    attempts: count(s && s.attempts),
    drops: count(s && s.drops),
    renewals: count(s && s.renewals),
    adverts: count(s && s.adverts),
    watch: text(s && s.watch, 60),
    lastError: text(s && s.lastError, 120),
    lastValueAgeS: count(s && s.lastValueAgeS)
  }));
  return {
    supported: bool(r.supported),
    role: text(r.role, 20),
    devicesKnown: count(r.devicesKnown),
    listVerdict: text(r.listVerdict, 20),
    sensors
  };
}

module.exports = { STORE_MINUTES, decideSensorUpdate, sensorKindFor, sensorConflict, storeWindowSeconds, validateReading, sanitizeHubDiag,
                   sanitizeHubReport };
