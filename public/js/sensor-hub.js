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
      request(c);
    } catch (err) {
      c.tx = null;
      c.diag.lastError = (err && (err.name + ': ' + err.message)) || String(err);
      if (c.device.gatt.connected) c.device.gatt.disconnect();
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
      body: JSON.stringify({ serial: c.serial, temp })
    }).catch(() => { /* Netz weg: naechster Wert kommt in 5 s */ });
  }

  function adopt(sensor, device) {
    const c = {
      serial: sensor.serial, url: sensor.url, device, rx: null, tx: null, connecting: false,
      retry: null, stopped: false, lastValueAt: null,
      diag: { attempts: 0, lastError: '', adverts: 0, watch: 'not available' }
    };
    c.onValue = e => {
      const v = e.target.value;
      const temp = B.parseOnlineValue(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      if (temp === null) return;
      c.lastValueAt = Date.now();
      c.lastTemp = temp;
      post(c, temp);
    };
    device.addEventListener('gattserverdisconnected', () => { c.tx = null; scheduleRetry(c, 2000); });
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
      let list;
      try {
        const res = await fetch('/monitoring/sensors', { headers: { Accept: 'application/json' } });
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error('no list');
        list = await res.json();
      } catch (e) {
        // abgemeldet oder keine Rechte: alles trennen
        [...conns.keys()].forEach(stop);
        return;
      }
      const wanted = new Map(list.map(s => [s.serial, s]));
      [...conns.keys()].filter(serial => !wanted.has(serial)).forEach(stop);
      const devices = supported ? await navigator.bluetooth.getDevices() : [];
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
  // Nach jedem Seitenwechsel die Zuordnung abgleichen (z. B. Fuehler gerade im Box Management gekoppelt)
  document.addEventListener('turbo:load', refresh);
  refresh();
})();
