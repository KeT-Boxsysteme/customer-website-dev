require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const boxRoutes = require('./routes/boxes');
const monitoringRoutes = require('./routes/monitoring');
const diagramRoutes = require('./routes/diagrams');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('trust proxy', 1); // Render / reverse proxy: HTTPS cookies funktionieren korrekt

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard/index', { currentPage: 'dashboard' });
});

app.use('/auth', authRoutes);
app.use('/users', requireAuth, userRoutes);
app.use('/boxes', requireAuth, boxRoutes);
app.use('/monitoring', requireAuth, monitoringRoutes);
app.use('/diagrams', requireAuth, diagramRoutes);

app.use((req, res) => {
  res.status(404).render('errors/404');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('errors/500', { message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Glovebox-Monitoring running on port ${PORT}`);
});
