// Regel: was beim Speichern des Box-Formulars mit dem Temperaturfuehler der Box passiert
// (Vault: Entscheidungen E-16/E-17). Reine Funktion; den Schreibvorgang macht Box.setSensor.
const { normalizeSerial } = require('../public/js/bluedan');

// raw = Wert des Formularfelds sensorSerial (undefined = Feld nicht gesendet)
function decideSensorUpdate({ hasFridge, raw }) {
  // Ohne Kuehlschrank kein Fuehler — Kuehlschrank und Fuehler gehoeren zusammen
  if (!hasFridge) return { action: 'clear' };
  // Fehlendes Feld heisst nicht "entfernen"
  if (raw === undefined) return { action: 'keep' };
  if (String(raw).trim() === '') return { action: 'clear' };
  const serial = normalizeSerial(String(raw));
  return serial ? { action: 'set', serial } : { action: 'error' };
}

module.exports = { decideSensorUpdate };
