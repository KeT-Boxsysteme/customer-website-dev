const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const { statusForBox, liveFridge, liveBoxTemp } = require('../services/boxStatus');
const boxState = require('../services/boxState');
const { buildAlerts } = require('../services/alerts');

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
        stateKey: boxState.stateKey(box.id, s.alerts),
        hasBoxSensor: !!box.box_sensor_serial,
        boxTemp: (liveBoxTemp(box) || {}).temp ?? null,
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

// GET /dashboard/live – Kacheln live halten (Betreiber 01.10.): je Box Live-Temperatur + Zustands-Schluessel.
// Eine DB-Abfrage (Box-Zeilen), keine Messwerte: wie GET /monitoring/:id/live (services/boxState.js).
// Aendert sich ein Schluessel, laedt das Dashboard per Turbo-Morphing neu (public/js/dashboard-live.js).
router.get('/live', async (req, res) => {
  try {
    const list = await Box.findAllByCompany(req.session.user.companyId);
    const boxes = list.map(box => {
      const fridgeLive = liveFridge(box);
      const alerts = buildAlerts({ box, latestMeasurement: null, acks: [], fridgeLive });
      const bt = liveBoxTemp(box);
      return { id: box.id, temp: fridgeLive ? fridgeLive.temp : null, boxTemp: bt ? bt.temp : null,
               stateKey: boxState.stateKey(box.id, alerts) };
    });
    res.json({ boxes });
  } catch (err) {
    console.error('[Dashboard live]', err.message);
    res.status(503).json({ error: 'Box status could not be loaded.' });
  }
});

module.exports = router;
