const ROLES = {
  ADMIN: 'admin',
  CONTROLLER: 'controller',
  USER: 'user',
  BOX_USER: 'box_user'
};

// Welche Seiten welche Rollen sehen dürfen
const PERMISSIONS = {
  users:      [ROLES.ADMIN],
  boxes:      [ROLES.ADMIN, ROLES.CONTROLLER],
  monitoring: [ROLES.ADMIN, ROLES.CONTROLLER, ROLES.USER, ROLES.BOX_USER],
  diagrams:   [ROLES.ADMIN, ROLES.CONTROLLER, ROLES.USER, ROLES.BOX_USER]
};

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('errors/403');
    }
    next();
  };
}

module.exports = { authorize, ROLES, PERMISSIONS };
