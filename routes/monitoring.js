const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const User = require('../models/user');
const emailService = require('../services/email');

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

    // Ampel-Status berechnen
    let statusColor = 'green';
    if (latestMeasurement) {
      const o2 = latestMeasurement.o2_value;
      const h2o = latestMeasurement.h2o_value;
      if ((o2 !== null && o2 >= 10) || (h2o !== null && h2o >= 10)) statusColor = 'red';
      else if ((o2 !== null && o2 >= 5) || (h2o !== null && h2o >= 5)) statusColor = 'yellow';
    }

    res.render('monitoring/detail', {
      title: `Monitoring – ${box.box_alias}`,
      currentPage: 'monitoring',
      box,
      usernames,
      latestMeasurement,
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
    const pool = require('../config/database');
    const { getPool, sql } = require('../config/database');
    const db = await getPool();
    const userResult = await db.request()
      .input('username', sql.NVarChar(4), username)
      .input('companyId', sql.Int, req.session.user.companyId)
      .query('SELECT id FROM users WHERE username = @username AND company_id = @companyId');
    const userId = userResult.recordset[0]?.id || req.session.user.id;

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

// POST /monitoring/:id/message – Kontaktnachricht an KeT
router.post('/:id/message', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).render('errors/404');

    const { message } = req.body;
    if (!message || !message.trim()) {
      req.flash('error', 'Message cannot be empty.');
      return res.redirect(`/monitoring/${req.params.id}`);
    }

    await emailService.sendContactMessage(box.project_number, req.session.user.email, message);
    req.flash('success', 'Your message has been sent to KeT.');
    res.redirect(`/monitoring/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not send message.');
    res.redirect(`/monitoring/${req.params.id}`);
  }
});

module.exports = router;
