const express = require('express');
const router = express.Router();
const Box = require('../models/box');
const { authorize, ROLES } = require('../middleware/authorize');

const canManageBoxes = authorize(ROLES.ADMIN, ROLES.CONTROLLER);

// GET /boxes
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
    await Box.create({ companyId: req.session.user.companyId, ...req.body });
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
    await Box.update(parseInt(req.params.id), req.session.user.companyId, req.body);
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
    req.flash('success', 'Box deleted.');
    res.redirect('/boxes');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not delete box.');
    res.redirect('/boxes');
  }
});

module.exports = router;
