/**
 * Unit tests for the blueDAN sensor protocol (public/js/bluedan.js).
 * Fixtures are real bytes measured against sensor "BD PT100 740B3B" on 2026-09-30:
 * request 74 0B 3B B7 76 26 was answered with "$MWO;26.8\t°C\n"; the same request with
 * checksum F2 E6 (CRC start value 0xFFFF) was NOT answered.
 */
const {
  serialFromName, crc16, buildOnlineRequest, parseOnlineValue
} = require('../public/js/bluedan');

const hex = s => Uint8Array.from(s.split(' ').map(h => parseInt(h, 16)));

describe('serialFromName', () => {
  test('takes the 6-digit hex serial from the advertised device name', () => {
    expect(serialFromName('BD PT100 740B3B')).toBe('740B3B');
  });

  test('returns null for names without a serial (no guessing)', () => {
    expect(serialFromName('BD PT100')).toBeNull();
    expect(serialFromName('')).toBeNull();
    expect(serialFromName(undefined)).toBeNull();
    expect(serialFromName('BD PT100 74XB3B')).toBeNull();
  });
});

describe('buildOnlineRequest (command B7)', () => {
  test('builds exactly the request the sensor answered', () => {
    expect(Array.from(buildOnlineRequest('740B3B'))).toEqual(Array.from(hex('74 0B 3B B7 76 26')));
  });

  test('does not produce the checksum variant the sensor ignored', () => {
    expect(Array.from(buildOnlineRequest('740B3B'))).not.toEqual(Array.from(hex('74 0B 3B B7 F2 E6')));
  });

  test('refuses an invalid serial instead of sending garbage', () => {
    expect(() => buildOnlineRequest('74XB3B')).toThrow();
    expect(() => buildOnlineRequest('740B3')).toThrow();
  });
});

describe('crc16', () => {
  test('CRC-16 poly 0x1021, start 0 over serial + command', () => {
    expect(crc16(hex('74 0B 3B B7'))).toBe(0x7626);
  });
});

describe('parseOnlineValue', () => {
  test('reads the temperature from a real sensor answer', () => {
    expect(parseOnlineValue(hex('24 4D 57 4F 3B 32 36 2E 38 09 F8 43 0A'))).toBe(26.8);
    expect(parseOnlineValue(hex('24 4D 57 4F 3B 32 33 2E 36 09 F8 43 0A'))).toBe(23.6);
  });

  test('handles negative fridge/freezer temperatures', () => {
    const bytes = Uint8Array.from([...'$MWO;-18.5\t'].map(c => c.charCodeAt(0)).concat([0xF8, 0x43, 0x0A]));
    expect(parseOnlineValue(bytes)).toBe(-18.5);
  });

  test('returns null for anything that is not an online value (missing beats wrong)', () => {
    expect(parseOnlineValue(hex('24 41 42 43 3B 32 36 2E 38 0A'))).toBeNull(); // $ABC;26.8
    expect(parseOnlineValue(hex('24 4D 57 4F 3B 0A'))).toBeNull();             // $MWO; without number
    expect(parseOnlineValue(new Uint8Array(0))).toBeNull();
  });
});

describe('sensorListVerdict – when may the background hub drop all sensors? (Fund 01.10.)', () => {
  const { sensorListVerdict } = require('../public/js/bluedan');
  const json = 'application/json; charset=utf-8';

  test('a proper list -> use it', () => {
    expect(sensorListVerdict({ ok: true, status: 200, contentType: json, url: 'https://x/monitoring/sensors' })).toBe('list');
  });

  test('really logged out (redirected to the login page) or no rights -> drop', () => {
    expect(sensorListVerdict({ ok: true, status: 200, redirected: true, contentType: 'text/html', url: 'https://x/auth/login' })).toBe('logged-out');
    expect(sensorListVerdict({ ok: false, status: 401, contentType: json, url: 'https://x/monitoring/sensors' })).toBe('logged-out');
    expect(sensorListVerdict({ ok: false, status: 403, contentType: 'text/html', url: 'https://x/monitoring/sensors' })).toBe('logged-out');
  });

  test('disturbance (server error, network, odd answer) -> no statement, keep the connections', () => {
    expect(sensorListVerdict({ ok: false, status: 500, contentType: json, url: 'https://x/monitoring/sensors' })).toBe('unknown');
    expect(sensorListVerdict({ ok: false, status: 502, contentType: 'text/html', url: 'https://x/monitoring/sensors' })).toBe('unknown');
    expect(sensorListVerdict(null)).toBe('unknown');   // fetch threw (network gone)
    expect(sensorListVerdict({ ok: true, status: 200, contentType: 'text/html', url: 'https://x/monitoring/sensors' })).toBe('unknown');
  });
});
