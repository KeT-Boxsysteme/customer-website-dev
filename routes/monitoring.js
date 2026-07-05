const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const AlertAck = require('../models/alertAck');
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

// GET /monitoring/:id – Box-Detail mit Werteeingabe
router.get('/:id', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).render('errors/404');

    const usernames = await User.getUsernamesByCompany(req.session.user.companyId);
    const latestMeasurement = await Measurement.findLatestByBox(box.id);
    const acks = await AlertAck.latestAcks(box.id);

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

    const { username, o2Value, h2oValue, fridgeTemp } = req.body;
    if (!username) {
      req.flash('error', 'Please select your user abbreviation before submitting.');
      return res.redirect(`/monitoring/${req.params.id}`);
    }

    // User-ID anhand des Kürzels ermitteln
    const abbrevUser = await findUserByAbbreviation(username, req.session.user.companyId);
    const userId = abbrevUser?.id || req.session.user.id;

    await Measurement.create({ boxId: box.id, userId, o2Value, h2oValue, fridgeTemp });

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

    const allowedFields = ['last_h2o_cleaning', 'last_charcoal_done', 'last_sieve_done', 'last_solvent_test', 'last_oil_done'];
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
