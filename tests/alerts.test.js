/**
 * Unit tests for the pure alert engine (services/alerts.js).
 * No DB, no network – buildAlerts is a pure function with an injected clock.
 */
const { buildAlerts, overallStatus } = require('../services/alerts');

// Fixed reference clock for all tests
const NOW = new Date('2026-07-05T12:00:00Z');

function hoursAgo(h) {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000);
}

function monthsAgo(m) {
  const d = new Date(NOW.getTime());
  d.setMonth(d.getMonth() - m);
  return d;
}

/** A box with no features enabled and all maintenance freshly done. */
function makeBox(overrides = {}) {
  return {
    id: 1,
    created_at: hoursAgo(1),
    has_h2o_sensor: false,
    has_o2_sensor: false,
    has_solvent_filter: false,
    solvent_filter_type: null,
    charcoal_cycle_months: null,
    molecular_sieve_cycle_months: null,
    has_solvent_sensor: false,
    has_oil_pump: false,
    last_h2o_cleaning: hoursAgo(1),
    last_charcoal_done: hoursAgo(1),
    last_sieve_done: hoursAgo(1),
    last_solvent_test: hoursAgo(1),
    last_oil_done: hoursAgo(1),
    ...overrides
  };
}

function makeMeasurement(overrides = {}) {
  return {
    id: 99,
    box_id: 1,
    o2_value: null,
    h2o_value: null,
    fridge_temp: null,
    measured_at: hoursAgo(1),
    ...overrides
  };
}

describe('buildAlerts – ppm thresholds (5 / 10 ppm)', () => {
  test('values below 5 ppm produce no alerts (green)', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: makeMeasurement({ o2_value: 4.99, h2o_value: 4.99 }),
      now: NOW
    });
    expect(alerts).toHaveLength(0);
    expect(overallStatus(alerts)).toBe('green');
  });

  test('o2 exactly 5 ppm -> yellow o2_elevated with ack action', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: makeMeasurement({ o2_value: 5 }),
      now: NOW
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: 'o2_elevated',
      severity: 'yellow',
      action: 'ack'
    });
    expect(alerts[0].message).toContain('O2');
    expect(alerts[0].message).toContain('5 ppm');
    expect(overallStatus(alerts)).toBe('yellow');
  });

  test('h2o exactly 10 ppm -> red h2o_high with purge/regenerate message', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: makeMeasurement({ h2o_value: 10 }),
      now: NOW
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: 'h2o_high',
      severity: 'red',
      action: 'ack'
    });
    expect(alerts[0].message).toContain('purged/regenerated');
    expect(overallStatus(alerts)).toBe('red');
  });

  test('value >= 10 produces only the red alert, not an additional yellow one', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: makeMeasurement({ o2_value: 12 }),
      now: NOW
    });
    expect(alerts.map(a => a.key)).toEqual(['o2_high']);
  });

  test('null measurement values are ignored', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: makeMeasurement({ o2_value: null, h2o_value: null }),
      now: NOW
    });
    expect(alerts).toHaveLength(0);
  });

  test('no measurement at all -> no ppm alerts', () => {
    const alerts = buildAlerts({ box: makeBox(), latestMeasurement: null, now: NOW });
    expect(alerts).toHaveLength(0);
  });
});

describe('buildAlerts – ack suppression', () => {
  const measurement = makeMeasurement({ o2_value: 15, measured_at: hoursAgo(2) });

  test('ack at/after measured_at suppresses the ppm alert', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: measurement,
      acks: [{ alert_key: 'o2_high', acked_at: hoursAgo(1) }],
      now: NOW
    });
    expect(alerts).toHaveLength(0);
    expect(overallStatus(alerts)).toBe('green');
  });

  test('ack older than measured_at does NOT suppress (newer value re-raises)', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: measurement,
      acks: [{ alert_key: 'o2_high', acked_at: hoursAgo(3) }],
      now: NOW
    });
    expect(alerts.map(a => a.key)).toEqual(['o2_high']);
  });

  test('ack for a different key does not suppress', () => {
    const alerts = buildAlerts({
      box: makeBox(),
      latestMeasurement: measurement,
      acks: [{ alert_key: 'h2o_high', acked_at: hoursAgo(1) }],
      now: NOW
    });
    expect(alerts.map(a => a.key)).toEqual(['o2_high']);
  });
});

describe('buildAlerts – H2O sensor cleaning (2000 operating hours, box runs 24/7)', () => {
  test('exactly 2000h since last cleaning -> yellow resolve-date alert', () => {
    const alerts = buildAlerts({
      box: makeBox({ has_h2o_sensor: true, last_h2o_cleaning: hoursAgo(2000) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: 'h2o_sensor_cleaning',
      severity: 'yellow',
      message: 'Clean the H2O sensor',
      action: 'resolve-date',
      field: 'last_h2o_cleaning'
    });
  });

  test('1999h since last cleaning -> no alert', () => {
    const alerts = buildAlerts({
      box: makeBox({ has_h2o_sensor: true, last_h2o_cleaning: hoursAgo(1999) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(alerts).toHaveLength(0);
  });

  test('NULL last_h2o_cleaning falls back to box.created_at', () => {
    const overdue = buildAlerts({
      box: makeBox({ has_h2o_sensor: true, last_h2o_cleaning: null, created_at: hoursAgo(2500) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(overdue.map(a => a.key)).toEqual(['h2o_sensor_cleaning']);

    const fresh = buildAlerts({
      box: makeBox({ has_h2o_sensor: true, last_h2o_cleaning: null, created_at: hoursAgo(10) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(fresh).toHaveLength(0);
  });
});

describe('buildAlerts – cycle-month maintenance', () => {
  test('charcoal due after configured cycle months', () => {
    const alerts = buildAlerts({
      box: makeBox({
        has_solvent_filter: true,
        solvent_filter_type: 'charcoal',
        charcoal_cycle_months: 3,
        last_charcoal_done: monthsAgo(3)
      }),
      latestMeasurement: null,
      now: NOW
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: 'charcoal_replace',
      severity: 'yellow',
      message: 'Replace the activated charcoal',
      action: 'resolve-date',
      field: 'last_charcoal_done'
    });
  });

  test('charcoal not yet due within the cycle', () => {
    const alerts = buildAlerts({
      box: makeBox({
        has_solvent_filter: true,
        solvent_filter_type: 'charcoal',
        charcoal_cycle_months: 3,
        last_charcoal_done: monthsAgo(2)
      }),
      latestMeasurement: null,
      now: NOW
    });
    expect(alerts).toHaveLength(0);
  });

  test('charcoal alert requires filter type charcoal', () => {
    const alerts = buildAlerts({
      box: makeBox({
        has_solvent_filter: true,
        solvent_filter_type: 'molecular_sieve',
        charcoal_cycle_months: 3,
        last_charcoal_done: monthsAgo(12)
      }),
      latestMeasurement: null,
      now: NOW
    });
    expect(alerts.find(a => a.key === 'charcoal_replace')).toBeUndefined();
  });

  test('molecular sieve due after configured cycle months', () => {
    const alerts = buildAlerts({
      box: makeBox({
        has_solvent_filter: true,
        solvent_filter_type: 'molecular_sieve',
        molecular_sieve_cycle_months: 6,
        last_sieve_done: monthsAgo(7)
      }),
      latestMeasurement: null,
      now: NOW
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: 'sieve_regenerate',
      message: 'Regenerate the molecular sieve',
      field: 'last_sieve_done'
    });
  });

  test('solvent sensor test due every 6 months (only if sensor present)', () => {
    const due = buildAlerts({
      box: makeBox({ has_solvent_sensor: true, last_solvent_test: monthsAgo(6) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(due.map(a => a.key)).toEqual(['solvent_sensor_test']);

    const noSensor = buildAlerts({
      box: makeBox({ has_solvent_sensor: false, last_solvent_test: monthsAgo(12) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(noSensor).toHaveLength(0);
  });

  test('oil change due every 6 months (only if oil pump present)', () => {
    const due = buildAlerts({
      box: makeBox({ has_oil_pump: true, last_oil_done: monthsAgo(6) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      key: 'oil_change',
      message: 'Change the vacuum pump oil',
      field: 'last_oil_done'
    });

    const notYet = buildAlerts({
      box: makeBox({ has_oil_pump: true, last_oil_done: monthsAgo(5) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(notYet).toHaveLength(0);

    const noPump = buildAlerts({
      box: makeBox({ has_oil_pump: false, last_oil_done: monthsAgo(12) }),
      latestMeasurement: null,
      now: NOW
    });
    expect(noPump).toHaveLength(0);
  });
});

describe('buildAlerts – sorting and overall status', () => {
  test('red alerts are always listed before yellow ones', () => {
    const alerts = buildAlerts({
      box: makeBox({ has_oil_pump: true, last_oil_done: monthsAgo(7) }),
      latestMeasurement: makeMeasurement({ o2_value: 6, h2o_value: 11 }),
      now: NOW
    });
    expect(alerts.map(a => a.severity)).toEqual(['red', 'yellow', 'yellow']);
    expect(alerts[0].key).toBe('h2o_high');
    expect(overallStatus(alerts)).toBe('red');
  });

  test('overall status precedence: red > yellow > green', () => {
    expect(overallStatus([])).toBe('green');
    expect(overallStatus([{ severity: 'yellow' }])).toBe('yellow');
    expect(overallStatus([{ severity: 'yellow' }, { severity: 'red' }])).toBe('red');
  });

  test('resolving the red alert lets the box fall back to yellow (Konzept line 118)', () => {
    const box = makeBox({ has_oil_pump: true, last_oil_done: monthsAgo(7) });
    const measurement = makeMeasurement({ o2_value: 11, measured_at: hoursAgo(2) });

    const before = buildAlerts({ box, latestMeasurement: measurement, now: NOW });
    expect(overallStatus(before)).toBe('red');

    const after = buildAlerts({
      box,
      latestMeasurement: measurement,
      acks: [{ alert_key: 'o2_high', acked_at: hoursAgo(1) }],
      now: NOW
    });
    expect(overallStatus(after)).toBe('yellow');
    expect(after.map(a => a.key)).toEqual(['oil_change']);
  });
});
