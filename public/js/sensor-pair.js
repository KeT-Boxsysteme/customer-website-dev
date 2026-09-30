// Knopf "Connect temperature sensor": sucht einen blueDAN-Fuehler per Web Bluetooth, fragt zur
// Bestaetigung einmal die Temperatur ab (Befehl B7) und haengt ihn an die Box.
// Container: [data-sensor-pair] im Box-Formular; schreibt ins versteckte Feld sensorSerial.
(function () {
  const B = window.BlueDAN;

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }

  // Einmal verbinden, einen Messwert holen, wieder trennen (wirft bei Verbindungsfehler)
  async function readOnce(device, serial) {
    try {
      const service = await (await device.gatt.connect()).getPrimaryService(B.SERVICE);
      const rx = await service.getCharacteristic(B.RX_CHAR);
      const tx = await service.getCharacteristic(B.TX_CHAR);
      const reading = new Promise(resolve => {
        rx.addEventListener('characteristicvaluechanged', e => {
          const v = e.target.value;
          const temp = B.parseOnlineValue(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
          if (temp !== null) resolve(temp);
        });
      });
      await rx.startNotifications();
      await tx.writeValueWithResponse(B.buildOnlineRequest(serial));
      return await withTimeout(reading, 5000);
    } finally {
      if (device.gatt.connected) device.gatt.disconnect();
    }
  }

  // Seriennummer kommt aus dem Namen im Auswahlfenster — dafuer braucht es keine Verbindung.
  // Der Kontrollwert ist nur Bestaetigung: bis zu 3 Versuche, weil sich der Fuehler nur selten
  // meldet und ein Verbindungsaufbau dann scheitern kann (gemessen: Pausen bis 60 s).
  async function pick(status) {
    if (!navigator.bluetooth) throw new Error('Bluetooth is not available in this browser. Please use Chrome or Edge.');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BD ' }], optionalServices: [B.SERVICE]
    });
    const serial = B.serialFromName(device.name);
    if (!serial) throw new Error('Unknown sensor: ' + device.name);
    // Geraete-Kennung merken: das Monitoring findet den Fuehler darueber per getDevices wieder,
    // auch wenn der Browser dort keinen Namen liefert (nur Komfort — Speicher darf fehlen)
    try { localStorage.setItem('bluedan-device:' + serial, device.id); } catch (e) { /* egal */ }
    // Haelt der Hintergrund-Verbinder den Fuehler schon, dessen Wert nehmen und die Verbindung
    // NICHT anfassen — ein eigener Test wuerde sie danach trennen.
    const held = window.SensorHub && window.SensorHub.state(serial);
    if (held && held.connected) {
      return { serial, name: device.name, temp: held.lastTemp === undefined ? null : held.lastTemp };
    }
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      status('Sensor ' + serial + ' selected – getting a test reading (attempt ' + attempt + ' of 3) …');
      try {
        const temp = await readOnce(device, serial);
        if (temp !== null) return { serial, name: device.name, temp };
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) console.warn('Sensor test reading failed:', lastError);
    return { serial, name: device.name, temp: null };
  }

  // Kontrollwert beim Verbinden — kein gespeicherter Messwert
  function testReading(result) {
    return result.temp !== null
      ? ' (test reading ' + result.temp.toFixed(1) + ' °C)'
      : ' (no test reading possible right now – the sensor is still assigned)';
  }

  document.querySelectorAll('[data-sensor-pair]').forEach(box => {
    const statusEl = box.querySelector('[data-sensor-status]');
    const connectBtn = box.querySelector('[data-sensor-connect]');
    const removeBtn = box.querySelector('[data-sensor-remove]');
    const input = box.querySelector('input[name="sensorSerial"]');
    const status = text => { statusEl.textContent = text; };

    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      // Der Fuehler meldet sich nur selten (gemessen: Pausen bis 60 s) — Wartezeit ansagen
      status('Searching for sensors – it can take up to one minute until the sensor appears in the list …');
      try {
        const result = await pick(status);
        input.value = result.serial;
        connectBtn.textContent = connectBtn.dataset.labelSet;
        status('Sensor ' + result.serial + ' found' + testReading(result) + '. Save the box to connect it.');
        if (removeBtn) removeBtn.hidden = false;
      } catch (err) {
        // Abbruch im Auswahlfenster ist kein Fehler
        status(err && err.name === 'NotFoundError' ? 'No sensor selected.' : 'Error: ' + err.message);
      } finally {
        connectBtn.disabled = false;
      }
    });

    if (removeBtn) removeBtn.addEventListener('click', () => {
      input.value = '';
      connectBtn.textContent = connectBtn.dataset.labelEmpty;
      removeBtn.hidden = true;
      status('No sensor connected. Save the box to apply.');
    });
  });
})();
