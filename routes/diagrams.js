const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const Measurement = require('../models/measurement');
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

    const chartLabels = measurements.map(m => new Date(m.measured_at).toLocaleDateString('en-GB')).reverse();
    const o2Data    = measurements.map(m => m.o2_value).reverse();
    const h2oData   = measurements.map(m => m.h2o_value).reverse();
    const fridgeData = measurements.map(m => m.fridge_temp).reverse();

    res.render('diagrams/detail', {
      title: `Diagrams: ${box.box_alias}`,
      currentPage: 'diagrams',
      box,
      measurements,
      months,
      chartLabels: JSON.stringify(chartLabels),
      o2Data:      JSON.stringify(o2Data),
      h2oData:     JSON.stringify(h2oData),
      fridgeData:  JSON.stringify(fridgeData)
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load diagram data.');
    res.redirect('/diagrams');
  }
});

module.exports = router;
