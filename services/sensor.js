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

module.exports = { STORE_MINUTES, decideSensorUpdate, storeWindowSeconds, validateReading };
