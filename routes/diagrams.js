const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const SensorReading = require('../models/sensorReading');
const { buildCharts, resolveRange, RANGES } = require('../services/diagramData');
const { authorize, PERMISSIONS } = require('../middleware/authorize');

// All diagram pages require one of the roles allowed for "diagrams"
// (admin, controller, user, box_user – see middleware/authorize.js)
router.use(authorize(...PERMISSIONS.diagrams));

// GET /diagrams – Box-Auswahl (Kacheldesign)
router.get('/', async (req, res) => {
  try {
    const boxes = await Box.findAllByCompany(req.session.user.companyId);
    res.render('diagrams/index', { title: 'Diagrams', currentPage: 'diagrams', boxes });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load boxes.');
    res.redirect('/dashboard');
  }
});

// GET /diagrams/:id?range=24h|7d|30d|6m|9m|12m  (alte Links ?months=6|9|12 gelten weiter)
router.get('/:id', async (req, res) => {
  try {
    // Erst die Box (Firmen-Check und Vorauswahl des Zeitraums haengen an ihr), dann die Werte
    const boxId = parseInt(req.params.id);
    const box = await Box.findById(boxId, req.session.user.companyId);
    if (!box) return res.status(404).render('errors/404');
    const range = resolveRange(req.query, box);
    if (!range) return res.redirect(`/diagrams/${boxId}`);

    const [measurements, sensorHours] = await Promise.all([
      Measurement.findByBox(boxId, range.since),
      box.has_fridge ? SensorReading.historyByBox(boxId, range.since, range.bucketMinutes) : []
    ]);
    const charts = buildCharts({ box, measurements, sensorHours, bucketMinutes: range.bucketMinutes });

    res.render('diagrams/detail', {
      title: `Diagrams: ${box.box_alias}`,
      currentPage: 'diagrams',
      box,
      measurements,
      range,
      ranges: RANGES,
      charts,
      // fuer das Inline-Skript: JSON ohne "</script>"-Ausbruch
      chartsJson: JSON.stringify({ ...charts, window: { from: range.since.getTime(), to: Date.now(), step: range.bucketMinutes } }).replace(/</g, '\\u003c')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load diagram data.');
    res.redirect('/diagrams');
  }
});

module.exports = router;
