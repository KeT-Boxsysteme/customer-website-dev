// Knopf "Connect temperature sensor": sucht einen blueDAN-Fuehler per Web Bluetooth, fragt zur
// Bestaetigung einmal die Temperatur ab (Befehl B7) und haengt ihn an die Box.
// Container: [data-sensor-pair] mit data-mode="form" (schreibt ins versteckte Feld sensorSerial)
// oder data-mode="api" + data-url (POST an /monitoring/:id/sensor, danach Neuladen).
(function () {
  const B = window.BlueDAN;

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }

  // Einmal verbinden, einen Messwert holen, wieder trennen
  async function pick(status) {
    if (!navigator.bluetooth) throw new Error('Bluetooth is not available in this browser. Please use Chrome or Edge.');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BD ' }], optionalServices: [B.SERVICE]
    });
    const serial = B.serialFromName(device.name);
    if (!serial) throw new Error('Unknown sensor: ' + device.name);
    status('Connecting to ' + device.name + ' …');
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
      const temp = await withTimeout(reading, 5000);
      return { serial, name: device.name, temp };
    } finally {
      if (device.gatt.connected) device.gatt.disconnect();
    }
  }

  // Kontrollwert beim Verbinden — kein gespeicherter Messwert
  function testReading(result) {
    return result.temp !== null
      ? ' (test reading ' + result.temp.toFixed(1) + ' °C)'
      : ' (no test reading received – please check the sensor)';
  }

  async function post(url, serial) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serial })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not save the temperature sensor.');
    return body;
  }

  document.querySelectorAll('[data-sensor-pair]').forEach(box => {
    const statusEl = box.querySelector('[data-sensor-status]');
    const connectBtn = box.querySelector('[data-sensor-connect]');
    const removeBtn = box.querySelector('[data-sensor-remove]');
    const input = box.querySelector('input[name="sensorSerial"]');
    const mode = box.dataset.mode;
    const status = text => { statusEl.textContent = text; };

    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      // Der Fuehler meldet sich nur alle paar Sekunden (gemessen: bis 13 s) — Wartezeit ansagen
      status('Searching for sensors – it can take up to 20 seconds until the sensor appears in the list …');
      try {
        const result = await pick(status);
        if (mode === 'form') {
          input.value = result.serial;
          status('Sensor ' + result.serial + ' found' + testReading(result) + '. Save the box to connect it.');
          if (removeBtn) removeBtn.hidden = false;
        } else {
          const saved = await post(box.dataset.url, result.serial);
          status('Sensor ' + result.serial + ' connected to this box' + testReading(result) + '.' +
            (saved.movedFrom && saved.movedFrom.length ? ' Moved here from: ' + saved.movedFrom.join(', ') + '.' : ''));
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (err) {
        // Abbruch im Auswahlfenster ist kein Fehler
        status(err && err.name === 'NotFoundError' ? 'No sensor selected.' : 'Error: ' + err.message);
      } finally {
        connectBtn.disabled = false;
      }
    });

    if (removeBtn) removeBtn.addEventListener('click', async () => {
      if (mode === 'form') {
        input.value = '';
        removeBtn.hidden = true;
        status('No sensor connected. Save the box to apply.');
        return;
      }
      removeBtn.disabled = true;
      try {
        await post(box.dataset.url, '');
        window.location.reload();
      } catch (err) {
        status('Error: ' + err.message);
        removeBtn.disabled = false;
      }
    });
  });
})();
