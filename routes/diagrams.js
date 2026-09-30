const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const SensorReading = require('../models/sensorReading');
const { buildCharts } = require('../services/diagramData');
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

// GET /diagrams/:id?months=6
router.get('/:id', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    if (![6, 9, 12].includes(months)) return res.redirect(`/diagrams/${req.params.id}?months=6`);

    // Box-Check und Messwerte parallel; Messwerte werden nur ausgegeben, wenn die Box zur Firma gehoert
    const boxId = parseInt(req.params.id);
    const [box, measurements] = await Promise.all([
      Box.findById(boxId, req.session.user.companyId),
      Measurement.findByBox(boxId, months)
    ]);
    if (!box) return res.status(404).render('errors/404');

    // Fuehler-Verlauf erst nach dem Box-Check (Werte nur fuer Boxen der eigenen Firma)
    const sensorHours = box.has_fridge ? await SensorReading.hourlyByBox(boxId, months) : [];
    const charts = buildCharts({ box, measurements, sensorHours });

    res.render('diagrams/detail', {
      title: `Diagrams: ${box.box_alias}`,
      currentPage: 'diagrams',
      box,
      measurements,
      months,
      charts,
      // fuer das Inline-Skript: JSON ohne "</script>"-Ausbruch
      chartsJson: JSON.stringify(charts).replace(/</g, '\\u003c')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load diagram data.');
    res.redirect('/diagrams');
  }
});

module.exports = router;
