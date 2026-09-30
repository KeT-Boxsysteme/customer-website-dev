// Monitoring live halten (Betreiber 30.09.: die Seite laeuft dauerhaft am Tablet an der Box).
// Fragt alle 5 s GET /monitoring/:id/live. Aendert sich der Zustands-Schluessel (Ampel, Werte von
// einem anderen Geraet, Done, Box-Aenderung, faellige Wartung), laedt die Seite neu (services/boxState.js).
// Mit Fuehler zusaetzlich: Live-Temperatur in "Fridge Temp". Die Bluetooth-Verbindung haelt der
// Hintergrund-Verbinder (sensor-hub.js); diese Seite liest den Wert nur vom Server.
// Feld gesperrt, solange ein frischer Live-Wert da ist (E-19); sonst leer und frei (fehlend statt falsch).
// Kein Knopf (Betreiber 30.09.): gekoppelt wird nur im Box Management.
(function () {
  const root = document.querySelector('[data-monitoring-live]');
  if (!root) return;
  const url = root.dataset.liveUrl;
  const POLL_MS = 5000;

  // Fuehler-Anzeige (nur bei Boxen mit zugeordnetem Fuehler)
  const box = document.querySelector('[data-live-sensor]');
  const field = box && document.getElementById('fridgeTemp');
  const serial = box && box.dataset.serial;
  const statusEl = box && box.querySelector('[data-live-status]');
  let wasLive = false;

  function setLive(on) {
    if (!box || !field) return;
    field.readOnly = on;
    field.classList.toggle('is-live', on);
    box.classList.toggle('is-live', on);
    if (!on && wasLive) field.value = '';   // kein alter Wert, der wie ein aktueller aussieht
    wasLive = on;
  }

  // Kurze Infozeile unter dem Feld; die Erklaerung steht im Tooltip (title)
  function show(text, detail) {
    if (!box) return;
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

  // Neu laden nur, wenn niemand gerade etwas eintippt oder die Warnliste offen hat.
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
  function checkState(key) {
    if (!key || key === root.dataset.stateKey || busy()) return;
    clearInterval(timer);
    if (window.Turbo) window.Turbo.visit(location.href, { action: 'replace' });
    else location.reload();
  }

  let timer = null;
  async function poll() {
    if (!document.body.contains(root)) { clearInterval(timer); return; }   // Seite verlassen (Turbo)
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const v = await res.json();
      if (v.fresh && v.temp !== null) {
        if (field) field.value = Number(v.temp).toFixed(1);
        setLive(true);
        show('Live · ' + (v.ageSeconds <= 1 ? 'just now' : v.ageSeconds + ' s ago'), 'live value');
      } else if (box) {
        setLive(false);
        show(...localHint());
      }
      checkState(v.stateKey);
    } catch (err) {
      setLive(false);
      show('Live value not reachable', err.message);
    }
  }

  timer = setInterval(poll, POLL_MS);
  poll();
})();
