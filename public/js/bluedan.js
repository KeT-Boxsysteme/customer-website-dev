// blueDAN-Fuehlerprotokoll (ESYS BlueCube, Dienst 0x2220): reine Funktionen, im Browser als
// window.BlueDAN und in Jest per require nutzbar. Protokoll am 2026-09-30 aus der blueDAN-Android-App
// gelesen und am Fuehler "BD PT100 740B3B" gemessen (Vault: Offene Punkte, Bluetooth-Fuehler).
// Befehl = [3 Byte Seriennummer][1 Byte Befehl][2 Byte CRC, big endian].
// NUR B7 (Online-Messwert) wird hier gebaut. B0 (Messung starten) loescht den Logger-Speicher,
// BE schreibt ins EEPROM — beide bewusst nicht vorhanden.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlueDAN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SERVICE = 0x2220;
  const RX_CHAR = 0x2221; // Read + Notify: Antworten des Fuehlers
  const TX_CHAR = 0x2222; // Write: Befehle an den Fuehler
  const CMD_ONLINE_VALUE = 0xB7;

  // Seriennummer = letzte 6 Hex-Zeichen des Geraetenamens ("BD PT100 740B3B" -> "740B3B")
  function serialFromName(name) {
    const m = /(?:^|\s)([0-9A-Fa-f]{6})$/.exec(String(name || '').trim());
    return m ? m[1].toUpperCase() : null;
  }

  // CRC-16, Polynom 0x1021, Startwert 0 (wie CRC.calc in der App)
  function crc16(bytes) {
    let crc = 0;
    for (const b of bytes) {
      for (let i = 7; i >= 0; i--) {
        const bit = (b >> i) & 1;
        const top = (crc >> 15) & 1;
        crc = (crc << 1) & 0xFFFF;
        if (bit ^ top) crc ^= 0x1021;
      }
    }
    return crc;
  }

  function buildOnlineRequest(serialHex) {
    if (!/^[0-9A-Fa-f]{6}$/.test(serialHex || '')) throw new Error('Invalid sensor serial: ' + serialHex);
    const body = [0, 2, 4].map(i => parseInt(serialHex.substr(i, 2), 16)).concat(CMD_ONLINE_VALUE);
    const crc = crc16(body);
    return Uint8Array.from(body.concat([crc >> 8, crc & 0xFF]));
  }

  // Antwort "$MWO;26.8<TAB>°C<LF>" -> 26.8; alles andere -> null (fehlend statt falsch)
  function parseOnlineValue(bytes) {
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    const m = /^\$MWO;\s*(-?\d+(?:\.\d+)?)/.exec(text);
    return m ? parseFloat(m[1]) : null;
  }

  return { SERVICE, RX_CHAR, TX_CHAR, serialFromName, crc16, buildOnlineRequest, parseOnlineValue };
});
