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

  // Kurze Infozeile unter dem Feld; die Erklaerung steht im Tooltip (title)
  function show(text, detail) {
    statusEl.textContent = text;
    box.title = 'Sensor ' + serial + (detail ? ' – ' + detail : '');
  }

  // Was dieses Geraet selbst gerade tut (nur wenn es den Fuehler verbindet)
  function localHint() {
    const hub = window.SensorHub;
    const s = hub && hub.state(serial);
    if (!s) return ['No live value', 'the device at the box must have this app open and the sensor paired'];
    if (!s.connected) {
      return ['Connecting … (' + s.diag.attempts + ')', s.diag.lastError || 'connecting to the sensor'];
    }
    return ['Waiting for value …', 'connected, waiting for the first value'];
  }

  // Aendert sich die Ampelstufe der Temperatur (E-21), die Seite neu laden, damit Ampel und
  // Warnliste stimmen — aber nicht, solange jemand gerade Werte eintippt oder die Warnliste offen hat.
  // Alle Formulare der Seite (auch die Nachricht an KeT); Auswahllisten gegen ihre Vorauswahl
  function initial(el) {
    if (el.tagName !== 'SELECT') return el.defaultValue;
    const opt = Array.from(el.options).find(o => o.defaultSelected) || el.options[0];
    return opt ? opt.value : '';
  }
  function busy() {
    const fields = Array.from(document.querySelectorAll('form input, form textarea, form select'))
      .filter(el => el !== field && el.type !== 'hidden');
    const typed = fields.some(el => el.value !== initial(el));
    const modal = document.getElementById('alertModal');
    return typed || fields.includes(document.activeElement) || (modal && modal.style.display !== 'none');
  }
  function checkAlert(level) {
    if ((level || '') === (box.dataset.fridgeAlert || '') || busy()) return;
    clearInterval(timer);
    if (window.Turbo) window.Turbo.visit(location.href, { action: 'replace' });
    else location.reload();
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
        show('Live · ' + (v.ageSeconds <= 1 ? 'just now' : v.ageSeconds + ' s ago'), 'live value');
        checkAlert(v.fridgeAlert);
      } else {
        setLive(false);
        show(...localHint());
        checkAlert(null);
      }
    } catch (err) {
      setLive(false);
      show('Live value not reachable', err.message);
    }
  }

  timer = setInterval(poll, POLL_MS);
  poll();
})();
