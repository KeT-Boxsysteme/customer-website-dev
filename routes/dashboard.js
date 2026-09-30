const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const { statusForBox } = require('../services/boxStatus');

const LABEL = { green: 'All systems normal', yellow: 'Attention required', red: 'Critical' };

// GET /dashboard – Willkommen + Status aller Boxen der Firma (Betreiber 01.10.).
// Gleiche Ampel-Regel wie das Monitoring (services/boxStatus). Faellt die DB aus, oeffnet das
// Dashboard trotzdem — mit Hinweis statt Kacheln (kein falsches Gruen).
router.get('/', async (req, res) => {
  let boxes = [];
  let statusError = false;
  try {
    const list = await Box.findAllByCompany(req.session.user.companyId);
    boxes = await Promise.all(list.map(async box => {
      const s = await statusForBox(box);
      return {
        id: box.id,
        alias: box.box_alias,
        projectNumber: box.project_number,
        status: s.statusColor,
        statusLabel: LABEL[s.statusColor],
        alertCount: s.alerts.length,
        topAlert: s.alerts[0] ? s.alerts[0].message : null,
        hasSensor: !!(box.has_fridge && box.sensor_serial),
        liveTemp: s.fridgeLive ? s.fridgeLive.temp : null,
        target: box.has_fridge ? box.fridge_temp : null
      };
    }));
  } catch (err) {
    console.error('[Dashboard]', err.message);
    statusError = true;
    boxes = [];
  }
  res.render('dashboard/index', { currentPage: 'dashboard', boxes, statusError });
});

module.exports = router;
