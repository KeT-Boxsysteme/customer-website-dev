/**
 * Alert engine for the monitoring traffic-light system (Konzept.txt lines 108–137).
 *
 * buildAlerts() is a PURE function: no DB access, no clock access (the caller
 * passes `now`), so it can be unit-tested without any infrastructure.
 *
 * Interpretation decisions (documented per Konzept):
 *  - H2O sensor cleaning (Konzept line 125): the concept asks for a cleaning
 *    reminder "every 2,000 operating hours". Since a glovebox runs 24/7 there
 *    is no separate operating-hours counter — operating hours are simply the
 *    wall-clock hours elapsed since the last cleaning (box.last_h2o_cleaning).
 *    2000 h ≈ 83.3 days.
 *  - NULL baseline: if a maintenance date field is NULL (e.g. legacy rows),
 *    we fall back to box.created_at — the box cannot have needed maintenance
 *    before it existed in the system. If created_at is also missing we use
 *    `now`, which starts the cycle fresh instead of firing a spurious alert.
 *  - solvent_filter_type is matched with includes() so that legacy rows that
 *    stored both values (old checkbox UI) keep working; the form now uses
 *    exclusive radio buttons ("charcoal" or "molecular_sieve").
 *  - ppm alerts: >= 10 ppm is red ("must be purged/regenerated"), else
 *    >= 5 ppm is yellow. A ppm alert is suppressed when an acknowledgement
 *    for its key exists with acked_at >= the measurement's measured_at
 *    (i.e. the user pressed "Done" AFTER this value was recorded; a newer
 *    measurement re-raises the alert).
 *  - Sorting (Konzept line 118): red alerts are prioritized and always
 *    listed first; order is otherwise stable.
 */

const HOURS_MS = 60 * 60 * 1000;
const H2O_CLEANING_INTERVAL_HOURS = 2000;
const SOLVENT_TEST_INTERVAL_MONTHS = 6;
const OIL_CHANGE_INTERVAL_MONTHS = 6;

const PPM_YELLOW_THRESHOLD = 5;
const PPM_RED_THRESHOLD = 10;

/** Baseline date for a maintenance field: field value, else box.created_at, else now. */
function baselineDate(fieldValue, box, now) {
  if (fieldValue) return new Date(fieldValue);
  if (box.created_at) return new Date(box.created_at);
  return now;
}

function hoursSince(date, now) {
  return (now.getTime() - date.getTime()) / HOURS_MS;
}

/** Full calendar months elapsed between `date` and `now`. */
function monthsSince(date, now) {
  let months = (now.getFullYear() - date.getFullYear()) * 12
             + (now.getMonth() - date.getMonth());
  if (now.getDate() < date.getDate()) months -= 1;
  return months;
}

/** True if an ack exists for `key` that is at least as new as the measurement. */
function isAcked(acks, key, measuredAt) {
  return (acks || []).some(a =>
    a.alert_key === key &&
    a.acked_at &&
    new Date(a.acked_at).getTime() >= new Date(measuredAt).getTime()
  );
}

/**
 * Build the list of active alerts for a box.
 *
 * @param {object} opts
 * @param {object} opts.box                 boxes row
 * @param {object|null} opts.latestMeasurement  latest measurements row or null
 * @param {Array}  [opts.acks]              rows {alert_key, acked_at} (latest ack per key)
 * @param {Date}   [opts.now]               injected clock for testability
 * @returns {Array<{key:string, severity:'yellow'|'red', message:string,
 *                  action:'resolve-date'|'ack', field?:string}>}
 *          Red alerts first (Konzept line 118).
 */
function buildAlerts({ box, latestMeasurement, acks = [], now = new Date() }) {
  const red = [];
  const yellow = [];

  // --- ppm alerts (red has priority; an acked alert is fully suppressed) ---
  if (latestMeasurement) {
    const measuredAt = latestMeasurement.measured_at;
    const checks = [
      { value: latestMeasurement.o2_value, label: 'O2', prefix: 'o2' },
      { value: latestMeasurement.h2o_value, label: 'H2O', prefix: 'h2o' }
    ];
    for (const c of checks) {
      if (c.value === null || c.value === undefined) continue;
      const val = Number(c.value);
      if (val >= PPM_RED_THRESHOLD) {
        const key = `${c.prefix}_high`;
        if (!isAcked(acks, key, measuredAt)) {
          red.push({
            key,
            severity: 'red',
            message: `Elevated ${c.label} level (${val} ppm) — the box must be purged/regenerated`,
            action: 'ack'
          });
        }
      } else if (val >= PPM_YELLOW_THRESHOLD) {
        const key = `${c.prefix}_elevated`;
        if (!isAcked(acks, key, measuredAt)) {
          yellow.push({
            key,
            severity: 'yellow',
            message: `Elevated ${c.label} level (${val} ppm)`,
            action: 'ack'
          });
        }
      }
    }
  }

  // --- H2O sensor cleaning: every 2000 operating hours (box runs 24/7,
  //     so operating hours == hours since last_h2o_cleaning) ---
  if (box.has_h2o_sensor) {
    const since = baselineDate(box.last_h2o_cleaning, box, now);
    if (hoursSince(since, now) >= H2O_CLEANING_INTERVAL_HOURS) {
      yellow.push({
        key: 'h2o_sensor_cleaning',
        severity: 'yellow',
        message: 'Clean the H2O sensor',
        action: 'resolve-date',
        field: 'last_h2o_cleaning'
      });
    }
  }

  // --- Activated charcoal replacement (customer-defined cycle in months) ---
  if (box.has_solvent_filter &&
      String(box.solvent_filter_type || '').includes('charcoal') &&
      box.charcoal_cycle_months) {
    const since = baselineDate(box.last_charcoal_done, box, now);
    if (monthsSince(since, now) >= box.charcoal_cycle_months) {
      yellow.push({
        key: 'charcoal_replace',
        severity: 'yellow',
        message: 'Replace the activated charcoal',
        action: 'resolve-date',
        field: 'last_charcoal_done'
      });
    }
  }

  // --- Molecular sieve regeneration (customer-defined cycle in months) ---
  if (box.has_solvent_filter &&
      String(box.solvent_filter_type || '').includes('molecular_sieve') &&
      box.molecular_sieve_cycle_months) {
    const since = baselineDate(box.last_sieve_done, box, now);
    if (monthsSince(since, now) >= box.molecular_sieve_cycle_months) {
      yellow.push({
        key: 'sieve_regenerate',
        severity: 'yellow',
        message: 'Regenerate the molecular sieve',
        action: 'resolve-date',
        field: 'last_sieve_done'
      });
    }
  }

  // --- Solvent sensor test: every 6 months ---
  if (box.has_solvent_sensor) {
    const since = baselineDate(box.last_solvent_test, box, now);
    if (monthsSince(since, now) >= SOLVENT_TEST_INTERVAL_MONTHS) {
      yellow.push({
        key: 'solvent_sensor_test',
        severity: 'yellow',
        message: 'Test the solvent sensor',
        action: 'resolve-date',
        field: 'last_solvent_test'
      });
    }
  }

  // --- Vacuum pump oil change: every 6 months (only if the box has an oil pump) ---
  if (box.has_oil_pump) {
    const since = baselineDate(box.last_oil_done, box, now);
    if (monthsSince(since, now) >= OIL_CHANGE_INTERVAL_MONTHS) {
      yellow.push({
        key: 'oil_change',
        severity: 'yellow',
        message: 'Change the vacuum pump oil',
        action: 'resolve-date',
        field: 'last_oil_done'
      });
    }
  }

  // Red first (Konzept line 118: critical alerts are prioritized and shown first).
  return [...red, ...yellow];
}

/** Overall traffic-light status: any red → red, else any yellow → yellow, else green. */
function overallStatus(alerts) {
  if (alerts.some(a => a.severity === 'red')) return 'red';
  if (alerts.some(a => a.severity === 'yellow')) return 'yellow';
  return 'green';
}

module.exports = { buildAlerts, overallStatus };
