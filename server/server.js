require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// TEMPORARY debug route — see server/routes/debug.js for how to disable it.
// Protected by DEBUG_KEY; harmless to leave mounted, but remove once done.
app.use('/api/debug', require('./routes/debug'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/influencers', require('./routes/influencers'));
app.use('/api/brands', require('./routes/brands'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/search', require('./routes/search'));
app.use('/api/admin', require('./routes/admin'));

// Global error handler — logs the full error server-side always, and
// optionally includes the message (never the stack) in the JSON
// response when DEBUG_MODE=true, so you can see it directly in the
// browser Network tab without digging through Vercel logs.
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  console.error(err.stack);

  const debugOn = process.env.DEBUG_MODE === 'true';
  res.status(err.status || 500).json({
    error: debugOn ? err.message : 'Something went wrong on the server',
    ...(debugOn ? { stack: err.stack } : {}),
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
