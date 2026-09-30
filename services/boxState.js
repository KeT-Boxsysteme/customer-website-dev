// Zustands-Schluessel fuer das Monitoring (Betreiber 30.09.: die Seite laeuft dauerhaft am Tablet
// und muss sich live aktualisieren). Das Monitoring fragt alle 5 s GET /monitoring/:id/live; aendert
// sich der Schluessel, laedt es neu. Kein DB-Zugriff dafuer (E-19: DB darf ruhen):
//  - Version je Box im Speicher, hochgezaehlt von jeder schreibenden Route (Werte, Done, Box-Aenderung)
//  - Stufe der Kuehlschrank-Warnung (live aus dem Speicher)
//  - Zeitfenster von 15 Min. fuer zeitabhaengige Wartungshinweise (werden faellig, ohne dass jemand schreibt)
//  - Start-Kennung des Servers (nach einem Neustart ist die Version wieder 0)
// Grenze: nur fuer einen Server-Prozess (Render: eine Instanz). Aenderungen direkt in der DB
// (z. B. KET) erreichen die Seite erst mit dem naechsten Zeitfenster.
const BOOT = Date.now().toString(36);
const WINDOW_MS = 15 * 60 * 1000;

let versions = new Map();   // boxId -> Zaehler

function bump(boxId) {
  versions.set(boxId, (versions.get(boxId) || 0) + 1);
}

function version(boxId) {
  return versions.get(boxId) || 0;
}

// fridge = Kuehlschrank-Alert aus services/alerts.fridgeAlert (oder null)
function stateKey(boxId, fridge, now = Date.now()) {
  const f = fridge ? fridge.key + '-' + fridge.severity : 'ok';
  return [BOOT, version(boxId), Math.floor(now / WINDOW_MS), f].join('.');
}

function reset() {
  versions = new Map();
}

module.exports = { bump, version, stateKey, reset };
