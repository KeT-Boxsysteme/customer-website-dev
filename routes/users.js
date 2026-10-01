const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { authorize, ROLES } = require('../middleware/authorize');
const emailService = require('../services/email');
const Company = require('../models/company');
const { canAssignRole, canManageUser } = require('../services/access');
const { passwordProblem } = require('../services/passwordPolicy');

const adminOnly = authorize(ROLES.ADMIN);   // service hat dieselben Rechte (middleware/authorize.js)

// Ziel-Benutzer laden und pruefen: eigene Einrichtung (sonst 404), service nur durch service aenderbar (7.13)
async function loadManageable(req, res) {
  const target = await User.findById(parseInt(req.params.id));
  if (!target || target.company_id !== req.session.user.companyId) {
    res.status(404).render('errors/404');
    return null;
  }
  if (!canManageUser(req.session.user.role, target)) {
    res.status(403).render('errors/403');
    return null;
  }
  return target;
}

// GET /users
router.get('/', adminOnly, async (req, res) => {
  try {
    const [users, company] = await Promise.all([
      User.findAllByCompany(req.session.user.companyId),
      Company.findById(req.session.user.companyId)
    ]);
    res.render('users/index', {
      title: 'User Management', currentPage: 'users', users,
      accessCode: company ? company.access_code : null,   // 7.3: der admin sieht die Nutz-Nummer
      canManage: u => canManageUser(req.session.user.role, u)
    });
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
    if (!canAssignRole(req.session.user.role, role)) {
      req.flash('error', 'Please choose a valid role.');
      return res.redirect('/users/create');
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) {
      req.flash('error', pwProblem);
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
    // 7.3: die Mail an neue Benutzer enthaelt die Nutz-Nummer der Einrichtung
    await emailService.sendUserCreatedEmail(email, company ? company.name : '', company ? company.access_code : null)
      .catch(console.error);

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
    const editUser = await loadManageable(req, res);
    if (!editUser) return;
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
    if (!(await loadManageable(req, res))) return;
    const { firstname, lastname, email, username, department, departmentOther, role } = req.body;
    // Serverseitige Pflichtfeld-Pruefung analog zum Anlegen
    if ([firstname, lastname, email, username, role].some(v => !v || !String(v).trim()) || username.trim().length > 4) {
      req.flash('error', 'Please fill in all required fields (username max. 4 characters).');
      return res.redirect('/users/' + userId + '/edit');
    }
    if (!canAssignRole(req.session.user.role, role)) {
      req.flash('error', 'Please choose a valid role.');
      return res.redirect('/users/' + userId + '/edit');
    }
    // Department ist optional: leer -> NULL (Spalte ist nullable)
    const finalDepartment = (department === 'other' ? departmentOther : department) || null;
    await User.update(userId, req.session.user.companyId, {
      firstname, lastname, email: email.trim().toLowerCase(), username: username.toUpperCase(), department: finalDepartment, role
    });
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
    if (!(await loadManageable(req, res))) return;
    await User.softDelete(userId, req.session.user.companyId);
    req.flash('success', 'User deleted.');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not delete user.');
    res.redirect('/users');
  }
});

module.exports = router;
