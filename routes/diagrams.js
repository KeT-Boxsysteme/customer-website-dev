const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const SensorReading = require('../models/sensorReading');
const { buildCharts, resolveRange, RANGES } = require('../services/diagramData');
const { authorize, PERMISSIONS } = require('../middleware/authorize');
const { liveFridge, liveBoxTemp } = require('../services/boxStatus');

// Daten EINES Diagramms (Seite und Live-Abfrage teilen sich das): Messwerte, Kuehlschrank- und Box-Verlauf, Live-Werte.
async function loadCharts(box, range) {
  const [measurements, sensorHours, boxHours] = await Promise.all([
    Measurement.findByBox(box.id, range.since),
    box.has_fridge ? SensorReading.historyByBox(box.id, range.since, range.bucketMinutes) : [],
    box.box_sensor_serial ? SensorReading.historyByBox(box.id, range.since, range.bucketMinutes, 'box') : []
  ]);
  const charts = buildCharts({ box, measurements, sensorHours, boxHours, bucketMinutes: range.bucketMinutes,
                               live: { fridge: liveFridge(box), box: liveBoxTemp(box) } });
  const window = { from: range.since.getTime(), to: Date.now(), step: range.bucketMinutes };
  return { measurements, charts, window };
}

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

    const { measurements, charts, window } = await loadCharts(box, range);

    res.render('diagrams/detail', {
      title: `Diagrams: ${box.box_alias}`,
      currentPage: 'diagrams',
      box,
      measurements,
      range,
      ranges: RANGES,
      charts,
      // fuer das Inline-Skript: JSON ohne "</script>"-Ausbruch
      chartsJson: JSON.stringify({ ...charts, window }).replace(/</g, '\\u003c')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load diagram data.');
    res.redirect('/diagrams');
  }
});

// GET /diagrams/:id/data?range=… – frische Diagrammdaten als JSON (Betreiber 28.10.: Diagramme live);
// public/js/diagram-chart.js fragt alle 30 s. Gleiche Firmenpruefung wie die Seite.
router.get('/:id/data', async (req, res) => {
  try {
    const box = await Box.findById(parseInt(req.params.id), req.session.user.companyId);
    if (!box) return res.status(404).json({ error: 'Box not found' });
    const range = resolveRange(req.query, box);
    if (!range) return res.status(400).json({ error: 'Unknown range' });
    const { charts, window } = await loadCharts(box, range);
    res.json({ charts, window });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load diagram data.' });
  }
});

module.exports = router;
