/**
 * Chart data for /diagrams (services/diagramData.js) – pure function, no DB.
 * Fund 2026-10-01: the box with the sensor had 320 stored sensor values but the diagrams only read
 * manual entries (1 value) on a fixed 0–20 ppm axis → no visible temperature curve.
 */
const { buildCharts, resolveRange, RANGES } = require('../services/diagramData');

const box = (o = {}) => ({ has_o2_sensor: 1, has_h2o_sensor: 1, has_fridge: 1, fridge_temp: -30, ...o });
const t = iso => new Date(iso).getTime();

describe('buildCharts – temperature from the sensor history', () => {
  const sensorHours = [
    { bucket: '2026-09-30T18:00:00Z', avg_temp: 24.9, min_temp: 24.5, max_temp: 25.3 },
    { bucket: '2026-09-30T19:00:00Z', avg_temp: -29.8, min_temp: -30.4, max_temp: -29.1 }
  ];

  test('sensor hours become avg / min / max series with real timestamps', () => {
    const c = buildCharts({ box: box(), measurements: [], sensorHours });
    expect(c.temp.avg).toEqual([{ x: t('2026-09-30T18:00:00Z'), y: 24.9 }, { x: t('2026-09-30T19:00:00Z'), y: -29.8 }]);
    expect(c.temp.min[1]).toEqual({ x: t('2026-09-30T19:00:00Z'), y: -30.4 });
    expect(c.temp.max[0]).toEqual({ x: t('2026-09-30T18:00:00Z'), y: 25.3 });
    expect(c.temp.hasData).toBe(true);
  });

  test('target and the 3 / 5 °C limits come from the box (same limits as the traffic light)', () => {
    const c = buildCharts({ box: box(), measurements: [], sensorHours });
    expect(c.temp.target).toBe(-30);
    expect(c.temp.limits).toEqual({ yellow: 3, red: 5 });
  });

  test('manual fridge entries are shown as separate points, oldest first', () => {
    const measurements = [
      { measured_at: '2026-09-02T10:00:00Z', fridge_temp: -28, o2_value: null, h2o_value: null },
      { measured_at: '2026-09-01T10:00:00Z', fridge_temp: null, o2_value: 1, h2o_value: 2 }
    ];
    const c = buildCharts({ box: box(), measurements, sensorHours: [] });
    expect(c.temp.manual).toEqual([{ x: t('2026-09-02T10:00:00Z'), y: -28 }]);
    expect(c.temp.hasData).toBe(true);
  });

  test('no fridge -> no temperature chart', () => {
    expect(buildCharts({ box: box({ has_fridge: 0 }), measurements: [], sensorHours }).temp).toBeNull();
  });

  test('fridge without any value -> chart present but marked empty (shows a hint, not a blank canvas)', () => {
    const c = buildCharts({ box: box(), measurements: [], sensorHours: [] });
    expect(c.temp.hasData).toBe(false);
  });
});

describe('buildCharts – ppm values', () => {
  const measurements = [
    { measured_at: '2026-06-20T10:00:00Z', o2_value: 1.2, h2o_value: null, fridge_temp: null },
    { measured_at: '2026-05-01T08:00:00Z', o2_value: 2, h2o_value: 1.1, fridge_temp: null }
  ];

  test('O2 / H2O as time series, oldest first, empty values left out (not drawn as 0)', () => {
    const c = buildCharts({ box: box(), measurements, sensorHours: [] });
    expect(c.ppm.o2).toEqual([{ x: t('2026-05-01T08:00:00Z'), y: 2 }, { x: t('2026-06-20T10:00:00Z'), y: 1.2 }]);
    expect(c.ppm.h2o).toEqual([{ x: t('2026-05-01T08:00:00Z'), y: 1.1 }]);
    expect(c.ppm.hasData).toBe(true);
  });

  test('only the sensors the box has; none -> no ppm chart', () => {
    expect(buildCharts({ box: box({ has_h2o_sensor: 0 }), measurements, sensorHours: [] }).ppm.h2o).toBeNull();
    expect(buildCharts({ box: box({ has_o2_sensor: 0, has_h2o_sensor: 0 }), measurements, sensorHours: [] }).ppm).toBeNull();
  });
});

describe('buildCharts – gaps and key figures', () => {
  const hour = h => ({ bucket: new Date(Date.UTC(2026, 8, 30, h)).toISOString(), avg_temp: -30 + h, min_temp: -31 + h, max_temp: -29 + h });

  test('a gap longer than 3 steps breaks the line (no line drawn over missing data)', () => {
    const c = buildCharts({ box: box(), measurements: [], sensorHours: [hour(0), hour(1), hour(6)], bucketMinutes: 60 });
    expect(c.temp.avg.map(p => p.y)).toEqual([-30, -29, null, -24]);
    expect(c.temp.min.map(p => p.y)).toEqual([-31, -30, null, -25]);
  });

  test('key figures: last value, min, max and share of steps outside ±3 °C', () => {
    const c = buildCharts({ box: box(), measurements: [], sensorHours: [hour(0), hour(1), hour(4), hour(5)], bucketMinutes: 60 });
    expect(c.temp.stats).toEqual({ last: -25, min: -31, max: -24, outsidePct: 50 });
  });

  test('no sensor values -> no key figures', () => {
    expect(buildCharts({ box: box(), measurements: [], sensorHours: [] }).temp.stats).toBeNull();
  });
});

describe('resolveRange', () => {
  const NOW = new Date('2026-10-01T12:00:00Z');

  test('all offered ranges, in order', () => {
    expect(RANGES.map(r => r.key)).toEqual(['24h', '7d', '30d', '6m', '9m', '12m']);
  });

  test('explicit range -> start and step size', () => {
    const r = resolveRange({ range: '7d' }, box({ sensor_serial: '740B3B' }), NOW);
    expect(r.key).toBe('7d');
    expect(r.bucketMinutes).toBe(30);
    expect(r.since.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  test('months ranges go back calendar months', () => {
    expect(resolveRange({ range: '6m' }, box(), NOW).since.toISOString()).toBe('2026-04-01T12:00:00.000Z');
  });

  test('old ?months=12 maps to 12m; default depends on the sensor; unknown -> null', () => {
    expect(resolveRange({ months: '12' }, box(), NOW).key).toBe('12m');
    expect(resolveRange({}, box({ sensor_serial: '740B3B' }), NOW).key).toBe('7d');
    expect(resolveRange({}, box({ sensor_serial: null }), NOW).key).toBe('6m');
    expect(resolveRange({ months: 'abc' }, box({ sensor_serial: null }), NOW).key).toBe('6m');
    expect(resolveRange({ range: '5y' }, box(), NOW)).toBeNull();
  });
});
