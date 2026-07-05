require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const compression = require('compression');
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
// EJS-Templates in Produktion cachen (sonst wird jede View pro Request neu kompiliert)
if (process.env.NODE_ENV === 'production') app.set('view cache', true);

app.use(compression()); // gzip fuer HTML/CSS/JS (CSS ~85% kleiner, spuerbar auf Render)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
// Statische Assets mit Browser-Cache: CSS/JS 1 Tag (aendert sich bei Deploys),
// Bilder/Fonts 7 Tage; ETag sorgt fuer 304 statt Volltransfer
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders(res, filePath) {
    if (/\.(png|jpe?g|webp|woff2?|ttf|otf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

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

// Terms & Conditions – publicly accessible (linked from registration)
app.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms & Conditions' });
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

// Server nur starten, wenn die Datei direkt ausgeführt wird (nicht bei Tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Glovebox-Monitoring running on port ${PORT}`);
  });
}

module.exports = app;
