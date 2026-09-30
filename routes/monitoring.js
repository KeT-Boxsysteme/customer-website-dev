const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const AlertAck = require('../models/alertAck');
const SensorReading = require('../models/sensorReading');
const liveReadings = require('../services/liveReadings');
const { storeWindowSeconds, validateReading } = require('../services/sensor');
const { normalizeSerial } = require('../public/js/bluedan');
const User = require('../models/user');
const emailService = require('../services/email');
const { buildAlerts, overallStatus } = require('../services/alerts');
const { authorize, PERMISSIONS } = require('../middleware/authorize');

// Expliziter Rollen-Guard analog zu routes/diagrams.js (admin, controller, user, box_user)
router.use(authorize(...PERMISSIONS.monitoring));

// Kürzel → User-Datensatz (E-Mail, ID) innerhalb der Firma auflösen
async function findUserByAbbreviation(username, companyId) {
  const { getPool, sql } = require('../config/database');
  const db = await getPool();
  const result = await db.request()
    .input('username', sql.NVarChar(4), username)
    .input('companyId', sql.Int, companyId)
    .query('SELECT id, email FROM users WHERE username = @username AND company_id = @companyId AND is_active = 1');
  return result.recordset[0] || null;
}

// GET /monitoring – Box-Auswahl (Kacheldesign)
router.get('/', async (req, res) => {
  try {
    const boxes = await Box.findAllByCompany(req.session.user.companyId);
    res.render('monitoring/index', { title: 'Monitoring', currentPage: 'monitoring', boxes });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load boxes.');
    res.redirect('/dashboard');
  }
});

// GET /monitoring/sensors – Fuehler der eigenen Firma fuer den Hintergrund-Verbinder (sensor-hub.js).
// Muss vor /:id stehen.
router.get('/sensors', async (req, res) => {
  try {
    const boxes = await Box.findAllByCompany(req.session.user.companyId);
    res.json(boxes
      .filter(b => b.has_fridge && b.sensor_serial)
      .map(b => ({ boxId: b.id, serial: b.sensor_serial, storeMinutes: b.sensor_store_minutes || 1,
                   url: `/monitoring/${b.id}/readings` })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load sensors.' });
  }
});

// GET /monitoring/:id – Box-Detail mit Werteeingabe
router.get('/:id', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).render('errors/404');

    // Unabhaengige Queries parallel statt nacheinander (spart 2 DB-Roundtrips)
    const [usernames, latestMeasurement, acks] = await Promise.all([
      User.getUsernamesByCompany(req.session.user.companyId),
      Measurement.findLatestByBox(box.id),
      AlertAck.latestAcks(box.id)
    ]);

    // Ampel-Status aus der Alert-Engine (Wartungszyklen + ppm-Werte + Acks)
    const alerts = buildAlerts({ box, latestMeasurement, acks });
    const statusColor = overallStatus(alerts);

    res.render('monitoring/detail', {
      title: `Monitoring: ${box.box_alias}`,
      currentPage: 'monitoring',
      box,
      usernames,
      latestMeasurement,
      alerts,
      statusColor
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load box.');
    res.redirect('/monitoring');
  }
});

// POST /monitoring/:id/submit – Werte speichern
router.post('/:id/submit', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const { username, o2Value, h2oValue, fridgeTemp, pressureValue } = req.body;
    if (!username) {
      req.flash('error', 'Please select your user abbreviation before submitting.');
      return res.redirect(`/monitoring/${req.params.id}`);
    }

    // User-ID anhand des Kürzels ermitteln
    const abbrevUser = await findUserByAbbreviation(username, req.session.user.companyId);
    const userId = abbrevUser?.id || req.session.user.id;

    await Measurement.create({ boxId: box.id, userId, o2Value, h2oValue, fridgeTemp, pressureValue });

    req.flash('success', 'Values submitted successfully.');
    res.redirect(`/monitoring/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not submit values.');
    res.redirect(`/monitoring/${req.params.id}`);
  }
});

// POST /monitoring/:id/resolve/:field – Wartungsbestätigung
router.post('/:id/resolve/:field', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const allowedFields = ['last_h2o_cleaning', 'last_charcoal_done', 'last_sieve_done',
                           'last_solvent_test', 'last_oil_done', 'last_lmf_replacement'];
    if (!allowedFields.includes(req.params.field)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    await Box.updateMaintenanceDate(box.id, req.params.field);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not resolve alert.' });
  }
});

// POST /monitoring/:id/ack/:key – ppm-Warnung als erledigt bestätigen
router.post('/:id/ack/:key', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const allowedKeys = ['o2_high', 'o2_elevated', 'h2o_high', 'h2o_elevated'];
    if (!allowedKeys.includes(req.params.key)) {
      return res.status(400).json({ error: 'Invalid alert key' });
    }

    await AlertAck.insertAck(box.id, req.params.key, req.session.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not acknowledge alert.' });
  }
});

// POST /monitoring/:id/readings – Live-Wert vom Temperaturfuehler ({serial, temp}) in den Verlauf.
// Alle Monitoring-Rollen (E-16). Der Server wacht ueber den Speichertakt der Box (E-19).
router.post('/:id/readings', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const serial = normalizeSerial(req.body.serial);
    if (!box.sensor_serial || serial !== box.sensor_serial) {
      return res.status(409).json({ error: 'This sensor is not assigned to the box.' });
    }
    const temp = validateReading(req.body.temp);
    if (temp === null) return res.status(400).json({ error: 'Implausible temperature.' });

    // Jeder Wert ist sofort live (Speicher); die DB wird nur im Takt der Box gefragt
    liveReadings.record(box.id, serial, temp);
    const stored = liveReadings.dueForHistory(box.id, box.sensor_store_minutes)
      ? await SensorReading.createIfDue(box.id, serial, temp, storeWindowSeconds(box.sensor_store_minutes))
      : false;
    res.json({ stored });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not store the reading.' });
  }
});

// GET /monitoring/:id/live – aktueller Live-Wert der Box aus dem Speicher (kein DB-Zugriff ausser Box-Check)
router.get('/:id/live', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).json({ error: 'Box not found' });
    const v = liveReadings.get(box.id);
    // Nur Werte des aktuell zugeordneten Fuehlers zaehlen
    if (!v || !box.sensor_serial || v.serial !== box.sensor_serial) {
      return res.json({ serial: box.sensor_serial || null, temp: null, fresh: false });
    }
    res.json(v);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the live value.' });
  }
});

// POST /monitoring/:id/message – Kontaktnachricht an KeT
// Absender-E-Mail wird aus dem ausgewählten Kürzel aufgelöst (Konzept Zeile 137)
router.post('/:id/message', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).render('errors/404');

    const { message, username } = req.body;
    if (!message || !message.trim()) {
      req.flash('error', 'Message cannot be empty.');
      return res.redirect(`/monitoring/${req.params.id}`);
    }
    if (!username) {
      req.flash('error', 'Please select your user abbreviation before sending a message.');
      return res.redirect(`/monitoring/${req.params.id}`);
    }

    const abbrevUser = await findUserByAbbreviation(username, req.session.user.companyId);
    if (!abbrevUser) {
      req.flash('error', 'Unknown user abbreviation. Please select a valid one.');
      return res.redirect(`/monitoring/${req.params.id}`);
    }

    await emailService.sendContactMessage(box.project_number, abbrevUser.email, message);
    req.flash('success', 'Your message has been sent to KeT.');
    res.redirect(`/monitoring/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not send message.');
    res.redirect(`/monitoring/${req.params.id}`);
  }
});

module.exports = router;
