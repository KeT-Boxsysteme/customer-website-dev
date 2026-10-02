// Zustands-Schluessel fuer das Monitoring (Betreiber 30.09.: die Seite laeuft dauerhaft am Tablet
// und muss sich live aktualisieren). Das Monitoring fragt alle 5 s GET /monitoring/:id/live; aendert
// sich der Schluessel, laedt es neu. Kein DB-Zugriff dafuer (E-19: DB darf ruhen):
//  - Version je Box im Speicher, hochgezaehlt von jeder schreibenden Route (Werte, Done, Box-Aenderung)
//  - alle Warnungen, die sich OHNE Schreibvorgang aendern koennen: Kuehlschrank (live) und faellige
//    Wartungen (aus der Box-Zeile + Uhr). Frueher ein 15-Min-Zeitfenster -> Seite lud alle 15 Min neu
//    (Fund 01.10.). O2/H2O-Warnungen aendern sich nur durch Eingabe/Done -> Version, nicht hier.
//  - Start-Kennung des Servers (nach einem Neustart ist die Version wieder 0)
// Grenze: nur fuer einen Server-Prozess (Render: eine Instanz). Aenderungen direkt in der DB
// (z. B. KET) erreichen die Seite erst mit der naechsten Aenderung.
const { PPM_ALERT_KEYS } = require('./alerts');
const BOOT = Date.now().toString(36);

let versions = new Map();   // boxId -> Zaehler

function bump(boxId) {
  versions.set(boxId, (versions.get(boxId) || 0) + 1);
}

function version(boxId) {
  return versions.get(boxId) || 0;
}

// alerts = Warnungen der Box (services/alerts.buildAlerts); ppm-Warnungen zaehlen nicht (s. oben)
function stateKey(boxId, alerts) {
  const parts = (alerts || [])
    .filter(a => !PPM_ALERT_KEYS.includes(a.key))
    .map(a => a.key + '-' + a.severity + (a.phase ? '-' + a.phase : ''))   // phase: Kuehlschrank live/festgehalten
    .sort();
  return [BOOT, version(boxId), parts.join('+') || 'ok'].join('.');
}

function reset() {
  versions = new Map();
}

module.exports = { bump, version, stateKey, reset };
