// Monitoring: Live-Temperatur vom Fuehler der Box in "Fridge Temp" (E-16/E-19).
// - Anzeige alle 5 s per Befehl B7; das Feld ist gesperrt, solange der Fuehler verbunden ist,
//   und wird erst bei Verbindungsverlust geleert und freigegeben.
// - In den Verlauf geht ein Wert im Takt der Box (data-store-minutes); der Server wacht zusaetzlich.
// - Nur Lesebefehl B7 (public/js/bluedan.js), nie Befehle, die den Logger veraendern.
// - KEIN Knopf (Betreiber 30.09.): gekoppelt wird nur im Box Management; hier nur automatisch
//   ueber getDevices (Chrome-Schalter, Vault: Bluetooth-Fuehler).
(function () {
  const B = window.BlueDAN;
  const box = document.querySelector('[data-live-sensor]');
  const field = document.getElementById('fridgeTemp');
  if (!box || !field || !B) return;

  const serial = box.dataset.serial;
  const url = box.dataset.url;
  const storeMs = (parseInt(box.dataset.storeMinutes, 10) || 1) * 60 * 1000;
  const statusEl = box.querySelector('[data-live-status]');
  const DISPLAY_MS = 5000;

  let device = null, tx = null, rx = null, ticker = null, lastValueAt = null, lastStoredAt = 0, reconnectTimer = null;
  const status = t => { statusEl.textContent = t; };

  function setLive(on) {
    field.readOnly = on;
    field.classList.toggle('is-live', on);
    box.classList.toggle('is-live', on);
    if (!on) field.value = '';   // kein alter Wert, der wie ein aktueller aussieht
  }

  function ageText() {
    if (!lastValueAt) return 'waiting for first value …';
    const s = Math.round((Date.now() - lastValueAt) / 1000);
    return s <= 1 ? 'just now' : s + ' s ago';
  }

  async function store(temp) {
    if (Date.now() - lastStoredAt < storeMs) return;
    lastStoredAt = Date.now();   // auch bei Fehlschlag erst im naechsten Takt erneut
    try {
      await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial, temp })
      });
    } catch (err) {
      console.warn('Storing the sensor reading failed:', err);
    }
  }

  function onValue(e) {
    const v = e.target.value;
    const temp = B.parseOnlineValue(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (temp === null) return;
    lastValueAt = Date.now();
    field.value = temp.toFixed(1);
    store(temp);
  }

  async function request() {
    status('Live · Sensor ' + serial + ' · ' + ageText());
    try { await tx.writeValueWithResponse(B.buildOnlineRequest(serial)); }
    catch (err) { /* naechster Tick versucht es erneut; Verbindungsverlust meldet gattserverdisconnected */ }
  }

  async function connectGatt() {
    const service = await (await device.gatt.connect()).getPrimaryService(B.SERVICE);
    if (rx) rx.removeEventListener('characteristicvaluechanged', onValue);   // kein doppelter Empfang nach Reconnect
    rx = await service.getCharacteristic(B.RX_CHAR);
    tx = await service.getCharacteristic(B.TX_CHAR);
    rx.addEventListener('characteristicvaluechanged', onValue);
    await rx.startNotifications();
    setLive(true);
    clearInterval(ticker);
    ticker = setInterval(request, DISPLAY_MS);
    request();
  }

  // Verbindung verloren: Feld frei, dann alle 10 s neu versuchen (Fuehler meldet sich nur selten)
  function onDisconnected() {
    clearInterval(ticker);
    setLive(false);
    lastValueAt = null;
    status('Sensor ' + serial + ' – connection lost, reconnecting …');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(tryReconnect, 10000);
  }

  // Messwerte zur Diagnose, sichtbar im Status solange keine Verbindung steht
  const diag = { attempts: 0, lastError: '', watch: 'not available', adverts: 0 };
  const diagText = () => ' [attempts ' + diag.attempts + ', signals seen ' + diag.adverts +
    ', listening: ' + diag.watch + (diag.lastError ? ', last error: ' + diag.lastError : '') + ']';

  let connecting = false;
  async function tryReconnect() {
    if (connecting || (device && device.gatt.connected)) return;
    connecting = true;
    clearTimeout(reconnectTimer);
    diag.attempts++;
    try {
      // Haengt der Verbindungsaufbau, gilt er nach 20 s als gescheitert (sonst bliebe alles stehen)
      await Promise.race([connectGatt(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 20 s')), 20000))]);
    } catch (err) {
      diag.lastError = (err && (err.name + ': ' + err.message)) || String(err);
      if (device && device.gatt.connected) device.gatt.disconnect();
      // Fuehler meldet sich nur selten — weiter versuchen statt aufgeben
      status('Sensor ' + serial + ' – waiting for the sensor to respond …' + diagText());
      reconnectTimer = setTimeout(tryReconnect, 10000);
    }
    finally { connecting = false; }
  }

  function adopt(d) {
    device = d;
    try { localStorage.setItem('bluedan-device:' + serial, d.id); } catch (e) { /* egal */ }
    device.addEventListener('gattserverdisconnected', onDisconnected);
    // Fuehler meldet sich nur selten: wenn der Browser es kann, genau beim naechsten Signal verbinden
    if (device.watchAdvertisements) {
      device.addEventListener('advertisementreceived', () => { diag.adverts++; if (!device.gatt.connected) tryReconnect(); });
      diag.watch = 'starting';
      device.watchAdvertisements()
        .then(() => { diag.watch = 'on'; })
        .catch(err => { diag.watch = 'failed (' + (err && err.message) + ')'; });
    }
  }

  function rememberedId() {
    try { return localStorage.getItem('bluedan-device:' + serial); } catch (e) { return null; }
  }

  // Bereits erlaubten Fuehler ohne Klick wiederfinden (falls der Browser getDevices anbietet)
  // Der Knopf fuegt keinen Fuehler hinzu (das geht nur im Box Management), er startet die Live-Verbindung.
  // Ohne getDevices verlangt der Browser dafuer einen Klick je Besuch — das sagen wir offen.
  async function autoConnect() {
    const idle = 'Sensor ' + serial + ' – no live reading';
    if (!navigator.bluetooth) { status(idle + ': Bluetooth is not available in this browser (use Chrome or Edge).'); return; }
    if (!navigator.bluetooth.getDevices) { status(idle + ': this browser is not set up for automatic sensor connection.'); return; }
    try {
      const id = rememberedId();
      const known = (await navigator.bluetooth.getDevices())
        .find(d => B.serialFromName(d.name) === serial || (id && d.id === id));
      if (!known) { status(idle + ': pair the sensor once in Box Management on this device.'); return; }
      adopt(known);
      status('Sensor ' + serial + ' – connecting …');
      await tryReconnect();
    } catch (err) {
      status(idle + ': ' + err.message);
    }
  }

  autoConnect();
})();
