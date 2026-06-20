const express = require('express');
const cors = require('cors');
const { CORS_ALLOWED_ORIGINS } = require('./config/constants');
const screenshotsRouter = require('./routes/screenshots');
const trackingRouter = require('./routes/tracking');
const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const dashboardAuthRouter = require('./routes/dashboardAuth');
const userPeriodSummaryRouter = require('./routes/userPeriodSummary');

const app = express();
const allowedOrigins = CORS_ALLOWED_ORIGINS
  ? CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/tracking', trackingRouter);
app.use('/api/users', usersRouter);
app.use('/api/screenshots', screenshotsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/dashboard-auth', dashboardAuthRouter);
app.use('/api/auth', authRouter);
app.use('/api/user-period-summary', userPeriodSummaryRouter);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Monitask backend is running',
    environment: process.env.NODE_ENV || 'development',
  });
});

module.exports = app;
