// Monitoring: Live-Temperatur der Box in "Fridge Temp". Die Bluetooth-Verbindung haelt der
// Hintergrund-Verbinder (sensor-hub.js); diese Seite liest den Wert nur vom Server (GET /:id/live).
// Dadurch steht der Wert sofort beim Oeffnen da — auf jedem Geraet, auch ohne Bluetooth.
// Feld gesperrt, solange ein frischer Live-Wert da ist (E-19); sonst leer und frei (fehlend statt falsch).
// Kein Knopf (Betreiber 30.09.): gekoppelt wird nur im Box Management.
(function () {
  const box = document.querySelector('[data-live-sensor]');
  const field = document.getElementById('fridgeTemp');
  if (!box || !field) return;

  const serial = box.dataset.serial;
  const url = box.dataset.liveUrl;
  const statusEl = box.querySelector('[data-live-status]');
  const POLL_MS = 5000;
  let wasLive = false;

  function setLive(on) {
    field.readOnly = on;
    field.classList.toggle('is-live', on);
    box.classList.toggle('is-live', on);
    if (!on && wasLive) field.value = '';   // kein alter Wert, der wie ein aktueller aussieht
    wasLive = on;
  }

  // Was dieses Geraet selbst gerade tut (nur wenn es den Fuehler verbindet)
  function localHint() {
    const hub = window.SensorHub;
    const s = hub && hub.state(serial);
    if (!s) return ' – no live value. The device at the box must have this app open and the sensor paired.';
    if (!s.connected) {
      return ' – connecting to the sensor (attempt ' + s.diag.attempts + ') …' +
        (s.diag.lastError ? ' [' + s.diag.lastError + ']' : '');
    }
    return ' – connected, waiting for the first value …';
  }

  let timer = null;
  async function poll() {
    if (!document.body.contains(box)) { clearInterval(timer); return; }   // Seite verlassen (Turbo)
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const v = await res.json();
      if (v.fresh && v.temp !== null) {
        field.value = Number(v.temp).toFixed(1);
        setLive(true);
        statusEl.textContent = 'Live · Sensor ' + serial + ' · ' + (v.ageSeconds <= 1 ? 'just now' : v.ageSeconds + ' s ago');
      } else {
        setLive(false);
        statusEl.textContent = 'Sensor ' + serial + localHint();
      }
    } catch (err) {
      setLive(false);
      statusEl.textContent = 'Sensor ' + serial + ' – live value not reachable (' + err.message + ')';
    }
  }

  timer = setInterval(poll, POLL_MS);
  poll();
})();
