const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { authorize, ROLES } = require('../middleware/authorize');
const emailService = require('../services/email');
const Company = require('../models/company');

const adminOnly = authorize(ROLES.ADMIN);

// GET /users
router.get('/', adminOnly, async (req, res) => {
  try {
    const users = await User.findAllByCompany(req.session.user.companyId);
    res.render('users/index', { title: 'User Management', currentPage: 'users', users });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load users.');
    res.redirect('/dashboard');
  }
});

// GET /users/create
router.get('/create', adminOnly, (req, res) => {
  res.render('users/form', { title: 'Create User', currentPage: 'users', editUser: null });
});

// POST /users
router.post('/', adminOnly, async (req, res) => {
  try {
    const { firstname, lastname, email, username, department, departmentOther, role, password } = req.body;
    // Serverseitige Pflichtfeld-Pruefung (Konzept Z. 57: Name, E-Mail, Kuerzel max. 4, Passwort, Rechtegruppe)
    if ([firstname, lastname, email, username, role, password].some(v => !v || !String(v).trim()) || username.trim().length > 4) {
      req.flash('error', 'Please fill in all required fields (username max. 4 characters).');
      return res.redirect('/users/create');
    }
    // Department ist optional (Konzept Z. 57): leer -> NULL (Spalte ist nullable)
    const finalDepartment = (department === 'other' ? departmentOther : department) || null;

    await User.create({
      companyId: req.session.user.companyId,
      firstname, lastname,
      email: email.trim().toLowerCase(),
      username: username.toUpperCase(),
      department: finalDepartment,
      role,
      password
    });

    const company = await Company.findById(req.session.user.companyId);
    await emailService.sendUserCreatedEmail(email, company ? company.name : '').catch(console.error);

    req.flash('success', 'User created successfully.');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create user.');
    res.redirect('/users/create');
  }
});

// GET /users/:id/edit
router.get('/:id/edit', adminOnly, async (req, res) => {
  try {
    const editUser = await User.findById(parseInt(req.params.id));
    if (!editUser || editUser.company_id !== req.session.user.companyId) {
      return res.status(404).render('errors/404');
    }
    res.render('users/form', { title: 'Edit User', currentPage: 'users', editUser });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load user.');
    res.redirect('/users');
  }
});

// PUT /users/:id
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.session.user.id) {
      req.flash('error', 'You cannot edit your own account here.');
      return res.redirect('/users');
    }
    const { firstname, lastname, email, username, department, departmentOther, role } = req.body;
    // Serverseitige Pflichtfeld-Pruefung analog zum Anlegen
    if ([firstname, lastname, email, username, role].some(v => !v || !String(v).trim()) || username.trim().length > 4) {
      req.flash('error', 'Please fill in all required fields (username max. 4 characters).');
      return res.redirect('/users/' + userId + '/edit');
    }
    // Department ist optional: leer -> NULL (Spalte ist nullable)
    const finalDepartment = (department === 'other' ? departmentOther : department) || null;
    await User.update(userId, { firstname, lastname, email: email.trim().toLowerCase(), username: username.toUpperCase(), department: finalDepartment, role });
    req.flash('success', 'User updated successfully.');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update user.');
    res.redirect('/users');
  }
});

// DELETE /users/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/users');
    }
    await User.softDelete(userId);
    req.flash('success', 'User deleted.');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not delete user.');
    res.redirect('/users');
  }
});

module.exports = router;
