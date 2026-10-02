const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const { authorize, ROLES } = require('../middleware/authorize');
const { decideSensorUpdate, sensorConflict, STORE_MINUTES } = require('../services/sensor');
const boxState = require('../services/boxState');

const canManageBoxes = authorize(ROLES.ADMIN, ROLES.CONTROLLER);

// Erlaubte LMF-Tauschintervalle: viertel-, halb- und jaehrlich
const LMF_REPLACEMENT_MONTHS = [3, 6, 12];

// -------------------------------------------------------------------------
// Formular-Parsing + serverseitige Validierung (Create UND Update).
// Bedingte Felder sind nur Pflicht, wenn der zugehoerige Schalter aktiv ist;
// ist er inaktiv, werden die Werte ignoriert (null gespeichert).
// -------------------------------------------------------------------------
function parseBoxForm(body) {
  const errors = [];

  const hasDualFilter     = body.filterSystem === 'dual';
  const hasSolventFilter  = body.hasSolventFilter === '1';
  const hasSolventSensor  = body.hasSolventSensor === '1';
  const hasO2Sensor       = body.hasO2Sensor === '1';
  const hasH2oSensor      = body.hasH2oSensor === '1';
  const hasPressureSensor = body.hasPressureSensor === '1';
  const hasFridge         = body.hasFridge === '1';
  const hasOilPump        = body.hasOilPump === '1';

  // Pflichtfelder
  if (!body.manufacturer) errors.push('Manufacturer is required.');
  if (!body.projectNumber || !body.projectNumber.trim()) errors.push('Project number is required.');
  const buildYear = parseInt(body.buildYear, 10);
  if (!Number.isInteger(buildYear)) errors.push('Build year is required.');
  if (!body.boxType || !body.boxType.trim()) errors.push('Box type is required.');
  if (!body.boxAlias || !body.boxAlias.trim()) errors.push('Box name / alias is required.');
  if (body.filterSystem !== 'single' && body.filterSystem !== 'dual') {
    errors.push('Please choose single- or dual-filter system.');
  }
  if (body.usageType !== 'underpressure' && body.usageType !== 'overpressure') {
    errors.push('Please choose the box usage.');
  }

  // Handschuh-Ports: 2/4/6/8 oder eigene Anzahl ("custom")
  const glovePorts = body.glovePorts === 'custom'
    ? parseInt(body.glovePortsCustom, 10)
    : parseInt(body.glovePorts, 10);
  if (!Number.isInteger(glovePorts) || glovePorts < 1 || glovePorts > 99) {
    errors.push('Please enter a valid number of glove ports.');
  }

  // Loesungsmittelfilter: Typ ist Pflicht; nur das zum Typ passende
  // Zyklus-Feld ist Pflicht, das andere wird optional mitgespeichert.
  let solventFilterType = null, charcoalCycleMonths = null, molecularSieveCycleMonths = null;
  let lmfReplacementMonths = null;
  if (hasSolventFilter) {
    if (body.solventFilterType === 'charcoal' || body.solventFilterType === 'molecular_sieve') {
      solventFilterType = body.solventFilterType;
    } else {
      errors.push('Please choose a solvent filter type.');
    }
    const charcoal = parseInt(body.charcoalCycleMonths, 10);
    const sieve    = parseInt(body.molecularSieveCycleMonths, 10);
    charcoalCycleMonths       = Number.isInteger(charcoal) && charcoal > 0 ? charcoal : null;
    molecularSieveCycleMonths = Number.isInteger(sieve) && sieve > 0 ? sieve : null;
    if (solventFilterType === 'charcoal' && charcoalCycleMonths === null) {
      errors.push('Carbon replacement cycle (months) is required.');
    }
    if (solventFilterType === 'molecular_sieve' && molecularSieveCycleMonths === null) {
      errors.push('Sieve regeneration cycle (months) is required.');
    }
    // LMF-Tauscherinnerung: feste Auswahl statt Freitext (Quartal/Halbjahr/Jahr)
    const lmf = parseInt(body.lmfReplacementMonths, 10);
    if (LMF_REPLACEMENT_MONTHS.includes(lmf)) {
      lmfReplacementMonths = lmf;
    } else {
      errors.push('Please choose when to be reminded to replace the solvent filter.');
    }
  }

  // Sensoren: Kalibrierjahr Pflicht, wenn Sensor vorhanden
  const parseYear = (value, label) => {
    const year = (value || '').toString().trim();
    if (!/^\d{4}$/.test(year)) {
      errors.push(label + ': calibration year (4 digits) is required.');
      return null;
    }
    return year;
  };
  const solventSensorCalibrated = hasSolventSensor ? parseYear(body.solventSensorCalibrated, 'Solvent sensor') : null;
  const o2SensorCalibrated      = hasO2Sensor ? parseYear(body.o2SensorCalibrated, 'O2 sensor') : null;
  const h2oSensorCalibrated     = hasH2oSensor ? parseYear(body.h2oSensorCalibrated, 'H2O sensor') : null;

  // Kuehlschrank: Temperatur Pflicht, wenn vorhanden
  let fridgeTemp = null;
  if (hasFridge) {
    fridgeTemp = parseInt(body.fridgeTemp, 10);
    if (!Number.isInteger(fridgeTemp)) {
      errors.push('Refrigerator temperature is required.');
      fridgeTemp = null;
    }
  }

  // Oelpumpe: letzter Oelwechsel Pflicht, wenn vorhanden
  let lastOilChange = null;
  if (hasOilPump) {
    lastOilChange = body.lastOilChange || null;
    if (!lastOilChange) errors.push('Last oil change date is required.');
  }

  // "Wann zuletzt gereinigt" nur relevant/Pflicht, wenn H2O-Sensor vorhanden (Konzept)
  let lastCleaned = null;
  if (hasH2oSensor) {
    lastCleaned = body.lastCleaned || null;
    if (!lastCleaned) errors.push('Last cleaned date is required.');
  }

  const data = {
    manufacturer: body.manufacturer,
    projectNumber: (body.projectNumber || '').trim(),
    boxType: (body.boxType || '').trim(),
    boxAlias: (body.boxAlias || '').trim(),
    hasDualFilter,
    hasSolventFilter,
    solventFilterType,
    charcoalCycleMonths,
    molecularSieveCycleMonths,
    lmfReplacementMonths,
    hasSolventSensor,
    solventSensorCalibrated,
    hasO2Sensor,
    o2SensorCalibrated,
    hasH2oSensor,
    h2oSensorCalibrated,
    hasPressureSensor,
    lastCleaned,
    hasFridge,
    fridgeTemp,
    hasOilPump,
    lastOilChange,
    glovePorts: Number.isInteger(glovePorts) ? glovePorts : null,
    usageType: body.usageType,
    buildYear: Number.isInteger(buildYear) ? buildYear : null,
    additionalNotes: body.additionalNotes || null
  };

  return { data, errors };
}

// Baut aus dem Request-Body ein editBox-artiges Objekt (DB-Spaltennamen),
// damit das Formular nach einem Validierungsfehler befuellt neu rendert.
function toFormValues(body, id) {
  const toDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  };
  return {
    id: id || null,
    manufacturer: body.manufacturer || '',
    project_number: body.projectNumber || '',
    build_year: body.buildYear || '',
    box_type: body.boxType || '',
    box_alias: body.boxAlias || '',
    filter_system: body.filterSystem || null,
    has_solvent_filter: body.hasSolventFilter === '1',
    solvent_filter_type: body.solventFilterType || null,
    charcoal_cycle_months: body.charcoalCycleMonths || '',
    molecular_sieve_cycle_months: body.molecularSieveCycleMonths || '',
    lmf_replacement_months: body.lmfReplacementMonths || '',
    has_solvent_sensor: body.hasSolventSensor === '1',
    solvent_sensor_calibrated: body.solventSensorCalibrated || '',
    has_o2_sensor: body.hasO2Sensor === '1',
    o2_sensor_calibrated: body.o2SensorCalibrated || '',
    has_h2o_sensor: body.hasH2oSensor === '1',
    h2o_sensor_calibrated: body.h2oSensorCalibrated || '',
    has_pressure_sensor: body.hasPressureSensor === '1',
    last_cleaned: toDate(body.lastCleaned),
    has_fridge: body.hasFridge === '1',
    fridge_temp: body.fridgeTemp || '',
    sensor_serial: body.sensorSerial || '',
    sensor_store_minutes: body.sensorStoreMinutes || '',
    box_sensor_serial: body.boxSensorSerial || '',
    box_sensor_store_minutes: body.boxSensorStoreMinutes || '',
    has_oil_pump: body.hasOilPump === '1',
    last_oil_change: toDate(body.lastOilChange),
    glove_ports: body.glovePorts === 'custom' ? (body.glovePortsCustom || '') : (body.glovePorts || ''),
    usage_type: body.usageType || null,
    additional_notes: body.additionalNotes || ''
  };
}

// GET /boxes
// Waehlbare Speichertakte fuer das Formular — eine Liste, definiert in services/sensor.js (E-19)
router.use((req, res, next) => { res.locals.storeMinutesOptions = STORE_MINUTES; next(); });

// Beide Fuehler aus dem Formular lesen (E-16/E-17/E-34): Kuehlschrank nur mit Kuehlschrank, Box-Fuehler immer.
// Fehlertexte landen in errors; ein Fuehler kann nicht beides zugleich sein.
function decideSensors(body, hasFridge, errors) {
  const fridge = decideSensorUpdate({ hasFridge, raw: body.sensorSerial, rawMinutes: body.sensorStoreMinutes });
  const box = decideSensorUpdate({ hasFridge: true, raw: body.boxSensorSerial, rawMinutes: body.boxSensorStoreMinutes });
  if (fridge.action === 'error') errors.push('Invalid temperature sensor.');
  if (box.action === 'error') errors.push('Invalid box temperature sensor.');
  if (sensorConflict(fridge, box)) errors.push('One sensor cannot be the fridge sensor and the box temperature sensor at the same time.');
  return { fridge, box };
}

// Temperaturfuehler nach dem Speichern der Box anwenden (E-16/E-17); meldet, welche Box ihn verlor.
// kind 'box' = Box-Fuehler (E-34); ohne kind der Kuehlschrank-Fuehler.
async function applySensor(req, boxId, sensor, kind) {
  if (sensor.action === 'keep') return;
  const args = [boxId, req.session.user.companyId,
    sensor.action === 'set' ? sensor.serial : null,
    sensor.action === 'set' ? sensor.storeMinutes : null];
  if (kind) args.push(kind);
  const { movedFrom } = await Box.setSensor(...args);
  if (movedFrom.length) {
    req.flash('success', `Temperature sensor ${sensor.serial} was moved here from: ${movedFrom.join(', ')}.`);
  }
}

router.get('/', canManageBoxes, async (req, res) => {
  try {
    const boxes = await Box.findAllByCompany(req.session.user.companyId);
    res.render('boxes/index', { title: 'Box Management', currentPage: 'boxes', boxes });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load boxes.');
    res.redirect('/dashboard');
  }
});

// GET /boxes/create
router.get('/create', canManageBoxes, (req, res) => {
  res.render('boxes/form', { title: 'Add Box', currentPage: 'boxes', editBox: null });
});

// POST /boxes
router.post('/', canManageBoxes, async (req, res) => {
  try {
    const { data, errors } = parseBoxForm(req.body);
    const sensors = decideSensors(req.body, data.hasFridge, errors);
    if (errors.length) {
      // Fehlermeldung direkt in res.locals legen, damit sie beim Re-Render
      // sofort sichtbar ist (req.flash wuerde erst beim naechsten Request greifen)
      res.locals.error = [errors.join(' ')];
      return res.status(400).render('boxes/form', {
        title: 'Add Box', currentPage: 'boxes',
        editBox: toFormValues(req.body, null)
      });
    }
    const newId = await Box.create({ companyId: req.session.user.companyId, ...data });
    await applySensor(req, newId, sensors.fridge);
    await applySensor(req, newId, sensors.box, 'box');
    req.flash('success', 'Box added successfully.');
    res.redirect('/boxes');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add box.');
    res.redirect('/boxes/create');
  }
});

// GET /boxes/:id/edit
router.get('/:id/edit', canManageBoxes, async (req, res) => {
  try {
    const editBox = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!editBox) return res.status(404).render('errors/404');
    res.render('boxes/form', { title: 'Edit Box', currentPage: 'boxes', editBox });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load box.');
    res.redirect('/boxes');
  }
});

// PUT /boxes/:id
router.put('/:id', canManageBoxes, async (req, res) => {
  try {
    const boxId = parseInt(req.params.id);
    const { data, errors } = parseBoxForm(req.body);
    const sensors = decideSensors(req.body, data.hasFridge, errors);
    if (errors.length) {
      res.locals.error = [errors.join(' ')];
      return res.status(400).render('boxes/form', {
        title: 'Edit Box', currentPage: 'boxes',
        editBox: toFormValues(req.body, boxId)
      });
    }
    await Box.update(boxId, req.session.user.companyId, data);
    await applySensor(req, boxId, sensors.fridge);
    await applySensor(req, boxId, sensors.box, 'box');
    boxState.bump(boxId);   // offene Monitoring-Seiten dieser Box laden neu
    req.flash('success', 'Box updated successfully.');
    res.redirect('/boxes');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update box.');
    res.redirect('/boxes');
  }
});

// DELETE /boxes/:id
router.delete('/:id', canManageBoxes, async (req, res) => {
  try {
    await Box.softDelete(parseInt(req.params.id), req.session.user.companyId);
    boxState.bump(parseInt(req.params.id));
    req.flash('success', 'Box deleted.');
    res.redirect('/boxes');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not delete box.');
    res.redirect('/boxes');
  }
});

module.exports = router;
