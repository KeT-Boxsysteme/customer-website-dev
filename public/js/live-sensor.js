// Monitoring live halten (Betreiber 30.09.: die Seite laeuft dauerhaft am Tablet an der Box).
// Fragt alle 5 s GET /monitoring/:id/live. Aendert sich der Zustands-Schluessel (Ampel, Werte von
// einem anderen Geraet, Done, Box-Aenderung, faellige Wartung), aktualisiert sich die Seite per
// Turbo-Morphing (ohne Neuladen, services/boxState.js).
// Mit Fuehler zusaetzlich: Live-Temperatur in "Fridge Temp". Die Bluetooth-Verbindung haelt der
// Hintergrund-Verbinder (sensor-hub.js); diese Seite liest den Wert nur vom Server.
// Feld gesperrt, solange ein frischer Live-Wert da ist (E-19); sonst leer und frei (fehlend statt falsch).
//
// Fund 01.10.: Beim Morphen ersetzt Turbo Elemente und fuehrt dieses Skript NICHT erneut aus. Deshalb
// (1) alle Elemente bei JEDER Abfrage neu suchen (nie beim Start merken) und (2) die Schleife vor dem
// Aktualisieren nicht anhalten. Eine Schleife fuer die ganze Seite (window.__monitoringLive).
(function () {
  const POLL_MS = 5000;
  if (window.__monitoringLive) clearInterval(window.__monitoringLive.timer);   // Skript erneut geladen
  const state = window.__monitoringLive = { timer: null, wasLive: false, refreshing: false };

  const el = () => {
    const root = document.querySelector('[data-monitoring-live]');
    const box = document.querySelector('[data-live-sensor]');
    return {
      root, box,
      field: box && document.getElementById('fridgeTemp'),
      serial: box && box.dataset.serial,
      statusEl: box && box.querySelector('[data-live-status]')
    };
  };

  function setLive(e, on) {
    if (!e.box || !e.field) return;
    e.field.readOnly = on;
    e.field.classList.toggle('is-live', on);
    e.box.classList.toggle('is-live', on);
    if (!on && state.wasLive) e.field.value = '';   // kein alter Wert, der wie ein aktueller aussieht
    state.wasLive = on;
  }

  // Kurze Infozeile unter dem Feld; die Erklaerung steht im Tooltip (title)
  function show(e, text, detail) {
    if (!e.box || !e.statusEl) return;
    e.statusEl.textContent = text;
    e.box.title = 'Sensor ' + e.serial + (detail ? ' – ' + detail : '');
  }

  // Was dieses Geraet selbst gerade tut (nur wenn es den Fuehler verbindet)
  function localHint(serial) {
    const hub = window.SensorHub;
    const s = hub && hub.state(serial);
    if (hub && hub.supported === false && !(s && s.connected)) {
      return ['Automatic reconnect not set up', 'Automatic reconnect is not set up in this browser: in Chrome enable chrome://flags/#enable-experimental-web-platform-features and #enable-web-bluetooth-new-permissions-backend, restart Chrome, then pair the sensor once.'];
    }
    if (hub && hub.role && hub.role() === 'waiting') {
      return ['Connected in another tab', 'another open tab of this app holds the sensor connection (only one tab can connect)'];
    }
    if (!s) return ['No live value', 'the device at the box must have this app open and the sensor paired'];
    if (!s.connected) {
      return ['Connecting … (' + s.diag.attempts + ')', s.diag.lastError || 'connecting to the sensor'];
    }
    return ['Waiting for value …', 'connected, waiting for the first value'];
  }

  // Aktualisieren nur, wenn niemand gerade etwas eintippt oder die Warnliste offen hat.
  // Alle Formulare der Seite (auch die Nachricht an KeT); Auswahllisten gegen ihre Vorauswahl
  function initial(x) {
    if (x.tagName !== 'SELECT') return x.defaultValue;
    const opt = Array.from(x.options).find(o => o.defaultSelected) || x.options[0];
    return opt ? opt.value : '';
  }
  function busy(e) {
    const fields = Array.from(document.querySelectorAll('form input, form textarea, form select'))
      .filter(x => x !== e.field && x.type !== 'hidden');
    const typed = fields.some(x => x.value !== initial(x));
    const modal = document.getElementById('alertModal');
    return typed || fields.includes(document.activeElement) || (modal && modal.style.display !== 'none');
  }
  function checkState(e, key) {
    if (!key || key === e.root.dataset.stateKey || state.refreshing || busy(e)) return;
    state.refreshing = true;   // Schleife laeuft weiter; nach dem Morphen sofort erneut abfragen
    if (window.Turbo) window.Turbo.visit(location.href, { action: 'replace' });
    else location.reload();
  }

  async function poll() {
    const e = el();
    if (!e.root) { clearInterval(state.timer); state.timer = null; return; }   // Seite verlassen (Turbo)
    try {
      const res = await fetch(e.root.dataset.liveUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const v = await res.json();
      const now = el();   // waehrend der Abfrage kann die Seite gemorpht worden sein
      if (!now.root) return;
      if (v.fresh && v.temp !== null) {
        if (now.field) now.field.value = Number(v.temp).toFixed(1);
        setLive(now, true);
        show(now, 'Live · ' + (v.ageSeconds <= 1 ? 'just now' : v.ageSeconds + ' s ago'), 'live value');
      } else if (now.box) {
        setLive(now, false);
        show(now, ...localHint(now.serial));
      }
      checkState(now, v.stateKey);
    } catch (err) {
      const now = el();
      setLive(now, false);
      show(now, 'Live value not reachable', err.message);
    }
  }

  // Nach jedem Morphen/Rendern sofort den Live-Wert eintragen (sonst steht bis zu 5 s der Platzhalter da)
  if (!window.__monitoringLiveHooked) {
    window.__monitoringLiveHooked = true;
    const after = () => {
      if (!window.__monitoringLive) return;
      window.__monitoringLive.refreshing = false;
      window.__monitoringLive.wasLive = false;
      if (document.querySelector('[data-monitoring-live]')) {
        if (!window.__monitoringLive.timer) window.__monitoringLive.timer = setInterval(window.__monitoringLive.poll, POLL_MS);
        window.__monitoringLive.poll();
      }
    };
    document.addEventListener('turbo:morph', after);
    document.addEventListener('turbo:render', after);
  }

  state.poll = poll;
  state.timer = setInterval(poll, POLL_MS);
  poll();
})();
