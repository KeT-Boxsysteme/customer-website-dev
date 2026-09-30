// Hintergrund-Verbinder fuer die Temperaturfuehler der Firma. Laeuft EINMAL je Browser-Dokument;
// weil die App mit Turbo ohne Neuladen navigiert, bleibt er ueber Seitenwechsel am Leben und haelt
// die Bluetooth-Verbindungen offen (Betreiber 30.09.: Verbindung muss gehalten werden, kein 2. Tab).
// - Fuehlerliste: GET /monitoring/sensors (nur zugeordnete Fuehler der eigenen Firma)
// - Verbinden nur automatisch ueber bereits erlaubte Geraete (getDevices) — gekoppelt wird im Box Management
// - alle 5 s Lesebefehl B7; jeder Wert geht an POST /monitoring/:id/readings (Server: live + Verlauf im Takt)
// - Nur B7 (public/js/bluedan.js), nie Befehle, die den Logger veraendern.
(function () {
  if (window.SensorHub) return;
  const B = window.BlueDAN;
  const canConnect = !!(B && navigator.bluetooth);
  // automatisch (ohne Klick) nur mit getDevices; eine im Box Management gekoppelte Verbindung
  // wird aber auch ohne getDevices uebernommen und ueber Seitenwechsel gehalten (Turbo)
  const supported = !!(canConnect && navigator.bluetooth.getDevices);
  const conns = new Map();   // serial -> Verbindungszustand
  const TICK_MS = 5000;

  window.SensorHub = {
    supported,
    // Zustand fuer die Anzeige im Monitoring (nur auf diesem Geraet)
    state(serial) {
      const c = conns.get(serial);
      if (!c) return null;
      return { connected: !!(c.device.gatt.connected && c.tx), lastValueAt: c.lastValueAt, lastTemp: c.lastTemp, diag: { ...c.diag } };
    },
    refresh,
    // Box Management: frisch gekoppelten Fuehler UEBERNEHMEN statt trennen (Betreiber 30.09.:
    // die Kopplung aus dem Management muss ans Monitoring weitergereicht werden)
    takeOver(serial, device) {
      // Ausdrueckliches Koppeln in diesem Tab: Sperre uebernehmen, andere Tabs trennen ihre Verbindung
      if (window.SensorHub.claim) window.SensorHub.claim();
      const c = conns.get(serial);
      if (c && c.device === device) { connect(c); return; }
      if (c) stop(serial);
      adopt({ serial, url: null }, device);   // url kommt nach dem Speichern der Box ueber refresh
    }
  };
  if (!canConnect) return;

  const rememberedId = serial => {
    try { return localStorage.getItem('bluedan-device:' + serial); } catch (e) { return null; }
  };
  const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after ' + ms / 1000 + ' s')), ms));

  function scheduleRetry(c, ms) {
    if (c.stopped) return;
    clearTimeout(c.retry);
    c.retry = setTimeout(() => connect(c), ms);
  }

  async function connect(c) {
    if (c.stopped || c.connecting || (c.device.gatt.connected && c.tx)) return;
    c.connecting = true;
    c.diag.attempts++;
    clearTimeout(c.retry);
    try {
      await Promise.race([(async () => {
        const service = await (await c.device.gatt.connect()).getPrimaryService(B.SERVICE);
        if (c.rx) c.rx.removeEventListener('characteristicvaluechanged', c.onValue);
        c.rx = await service.getCharacteristic(B.RX_CHAR);
        c.tx = await service.getCharacteristic(B.TX_CHAR);
        c.rx.addEventListener('characteristicvaluechanged', c.onValue);
        await c.rx.startNotifications();
      })(), timeout(20000)]);
      c.diag.lastError = '';
      c.failStreak = 0;
      request(c);
    } catch (err) {
      c.tx = null;
      c.diag.lastError = (err && (err.name + ': ' + err.message)) || String(err);
      c.failStreak++;
      // IMMER trennen: bricht einen noch laufenden connect()-Versuch ab. Vorher lief er nach der
      // 20-s-Grenze weiter und kollidierte mit dem naechsten Versuch (Fund 01.10.: 23 Fehlversuche).
      try { c.device.gatt.disconnect(); } catch (e) { /* egal */ }
      // Nach 5 Fehlversuchen das Geraet frisch vom Browser holen statt am alten Objekt festzuhalten
      if (c.failStreak >= 5) { c.failStreak = 0; renew(c); return; }
      // Fuehler meldet sich nur selten — weiter versuchen statt aufgeben
      scheduleRetry(c, 10000);
    } finally {
      c.connecting = false;
    }
  }

  async function request(c) {
    if (!c.tx || !c.device.gatt.connected) return;
    try { await c.tx.writeValueWithResponse(B.buildOnlineRequest(c.serial)); }
    catch (err) { /* naechster Tick; Abbruch meldet gattserverdisconnected */ }
  }

  function post(c, temp) {
    if (!c.url) return;   // gekoppelt, Box aber noch nicht gespeichert
    fetch(c.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ serial: c.serial, temp,
        diag: { drops: c.diag.drops, attempts: c.diag.attempts, lastError: c.diag.lastError } })
    }).catch(() => { /* Netz weg: naechster Wert kommt in 5 s */ });
  }

  function adopt(sensor, device) {
    const c = {
      serial: sensor.serial, url: sensor.url, device, rx: null, tx: null, connecting: false,
      retry: null, stopped: false, lastValueAt: null, failStreak: 0,
      diag: { attempts: 0, drops: 0, lastError: '', adverts: 0, watch: 'not available' }
    };
    c.onValue = e => {
      const v = e.target.value;
      const temp = B.parseOnlineValue(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      if (temp === null) return;
      c.lastValueAt = Date.now();
      c.lastTemp = temp;
      post(c, temp);
    };
    device.addEventListener('gattserverdisconnected', () => {
      if (c.tx) c.diag.drops++;   // nur echte Abbrueche einer bestehenden Verbindung zaehlen
      c.tx = null;
      scheduleRetry(c, 2000);
    });
    if (device.watchAdvertisements) {
      device.addEventListener('advertisementreceived', () => {
        c.diag.adverts++;
        if (!device.gatt.connected) connect(c);
      });
      c.diag.watch = 'starting';
      device.watchAdvertisements()
        .then(() => { c.diag.watch = 'on'; })
        .catch(err => { c.diag.watch = 'failed (' + (err && err.message) + ')'; });
    }
    conns.set(sensor.serial, c);
    connect(c);
    return c;
  }

  // Geraet frisch ueber getDevices holen und neu anfangen (Zaehler bleiben erhalten)
  async function renew(c) {
    if (c.stopped || !supported) { scheduleRetry(c, 10000); return; }
    try {
      const devices = await navigator.bluetooth.getDevices();
      const id = rememberedId(c.serial);
      const fresh = devices.find(d => B.serialFromName(d.name) === c.serial || (id && d.id === id));
      if (!fresh) { scheduleRetry(c, 10000); return; }
      const diag = c.diag;
      stop(c.serial);
      const n = adopt({ serial: c.serial, url: c.url }, fresh);
      n.diag.attempts = diag.attempts; n.diag.drops = diag.drops; n.diag.renewals = (diag.renewals || 0) + 1;
    } catch (e) {
      scheduleRetry(c, 10000);
    }
  }

  function stop(serial) {
    const c = conns.get(serial);
    if (!c) return;
    c.stopped = true;
    clearTimeout(c.retry);
    if (c.device.gatt.connected) c.device.gatt.disconnect();
    conns.delete(serial);
  }

  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      let res = null;
      try { res = await fetch('/monitoring/sensors', { headers: { Accept: 'application/json' } }); }
      catch (e) { res = null; }
      const verdict = B.sensorListVerdict(res && { ok: res.ok, status: res.status, redirected: res.redirected,
        url: res.url, contentType: res.headers.get('content-type') });
      lastVerdict = verdict;
      // Nur eine echte Abmeldung trennt alles; eine Stoerung aendert nichts (Fund 01.10.)
      if (verdict === 'logged-out') { [...conns.keys()].forEach(stop); return; }
      if (verdict !== 'list') return;
      let list;
      try { list = await res.json(); } catch (e) { return; }
      const wanted = new Map(list.map(s => [s.serial, s]));
      [...conns.keys()].filter(serial => !wanted.has(serial)).forEach(stop);
      const devices = supported ? await navigator.bluetooth.getDevices() : [];
      devicesKnown = devices.length;
      wantedSerials = list.map(s => s.serial);
      for (const sensor of list) {
        const existing = conns.get(sensor.serial);
        if (existing) { existing.url = sensor.url; continue; }   // Fuehler kann die Box gewechselt haben
        const id = rememberedId(sensor.serial);
        const device = devices.find(d => B.serialFromName(d.name) === sensor.serial || (id && d.id === id));
        if (device) adopt(sensor, device);
      }
    } finally {
      refreshing = false;
    }
  }

  setInterval(() => conns.forEach(request), TICK_MS);

  // Beim Verlassen der Seite (F5, Tab zu, Deploy-Neuladen) SAUBER trennen. Gemessen 01.10.: nach einem
  // Neuladen hielt die Bluetooth-Hardware des PCs die alte Verbindung fest, der Fuehler blieb stumm,
  // bis Bluetooth aus/an geschaltet wurde. Turbo-Seitenwechsel loesen pagehide nicht aus.
  window.addEventListener('pagehide', () => {
    conns.forEach(c => { try { if (c.device.gatt.connected) c.device.gatt.disconnect(); } catch (e) { /* egal */ } });
  });

  // Zustandsmeldung an den Server (Messinstrument, 01.10.): alle 15 s, auch wenn keine Werte kommen —
  // sonst ist der Server genau im Fehlerfall blind. Nur Zaehler und Fehlertexte, keine Personendaten.
  let lastVerdict = 'none', devicesKnown = null, wantedSerials = [];
  function report() {
    const serials = new Set([...wantedSerials, ...conns.keys()]);
    if (!serials.size) return;
    const sensors = [...serials].map(serial => {
      const c = conns.get(serial);
      return c ? {
        serial, adopted: true, connected: !!(c.device.gatt.connected && c.tx),
        attempts: c.diag.attempts, drops: c.diag.drops, renewals: c.diag.renewals || 0,
        adverts: c.diag.adverts, watch: c.diag.watch, lastError: c.diag.lastError,
        lastValueAgeS: c.lastValueAt ? Math.round((Date.now() - c.lastValueAt) / 1000) : null
      } : { serial, adopted: false };
    });
    fetch('/monitoring/hub-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supported, role: owner ? 'owner' : 'waiting', devicesKnown, listVerdict: lastVerdict, sensors })
    }).catch(() => { /* Diagnose darf nie stoeren */ });
  }
  setInterval(report, 15000);

  // Der Fuehler nimmt nur EINE Verbindung an. Mehrere offene Tabs der Website stritten sich um ihn
  // (Fund 01.10.). Mit einer Browser-Sperre verbindet nur ein Tab; die anderen warten, bis er zu ist.
  let owner = !navigator.locks;   // ohne Web Locks wie bisher (jeder Tab)
  window.SensorHub.role = () => (owner ? 'owner' : 'waiting');
  // Nach jedem Seitenwechsel die Zuordnung abgleichen (z. B. Fuehler gerade im Box Management gekoppelt)
  document.addEventListener('turbo:load', () => { if (owner) refresh(); });

  const LOCK = 'glovebox-sensor-hub';
  // Sperre halten, solange der Tab offen ist. Wird sie genommen (anderer Tab koppelt gerade im Box
  // Management), trennt dieser Tab seine Fuehler und stellt sich wieder hinten an.
  function claim(steal) {
    navigator.locks.request(LOCK, steal ? { steal: true } : {}, () => {
      owner = true;
      refresh();
      return new Promise(() => {});   // nie aufloesen = Sperre behalten
    }).catch(() => {
      owner = false;
      [...conns.keys()].forEach(stop);
      claim(false);
    });
  }
  window.SensorHub.claim = () => { if (navigator.locks && !owner) claim(true); };
  if (navigator.locks) claim(false);
  else refresh();
})();
