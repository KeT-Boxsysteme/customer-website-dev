const { hasAdminRights } = require('../services/access');

const ROLES = {
  ADMIN: 'admin',
  CONTROLLER: 'controller',
  USER: 'user',
  BOX_USER: 'box_user',
  SERVICE: 'service'   // interner KeT-Benutzer je Einrichtung (7.10): gleiche Rechte wie admin
};

// Welche Seiten welche Rollen sehen dürfen (service darf alles, was admin darf — siehe authorize)
const PERMISSIONS = {
  users:      [ROLES.ADMIN],
  boxes:      [ROLES.ADMIN, ROLES.CONTROLLER],
  monitoring: [ROLES.ADMIN, ROLES.CONTROLLER, ROLES.USER, ROLES.BOX_USER],
  diagrams:   [ROLES.ADMIN, ROLES.CONTROLLER, ROLES.USER, ROLES.BOX_USER]
};

function allowed(role, roles) {
  return roles.includes(role) || (roles.includes(ROLES.ADMIN) && hasAdminRights(role));
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/auth/login');
    }
    if (!allowed(req.session.user.role, roles)) {
      return res.status(403).render('errors/403');
    }
    next();
  };
}

module.exports = { authorize, allowed, ROLES, PERMISSIONS };
