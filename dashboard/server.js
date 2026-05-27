const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const sync = require('./sync');
const { migrate } = require('./migrate');
const githubSync = require('./github-sync');

const PORT = process.env.PORT || 3847;
const API_KEY = process.env.API_KEY;
const app = express();

// Load .env from parent dir
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [`http://localhost:${PORT}`],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Auth middleware for mutation endpoints
function requireAuth(req, res, next) {
  const key = process.env.API_KEY;
  if (!key) return next(); // No key configured = open (dev mode)
  const header = req.headers['authorization']?.replace('Bearer ', '');
  if (header === key) return next();
  res.status(401).json({ error: 'Unauthorized — set API key via Authorization header' });
}

// Rate limiting for trigger endpoints
const triggerLimits = {};
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  if (!triggerLimits[ip]) triggerLimits[ip] = [];
  triggerLimits[ip] = triggerLimits[ip].filter(t => now - t < 15 * 60 * 1000);
  if (triggerLimits[ip].length >= 200) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }
  triggerLimits[ip].push(now);
  next();
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API routes — read-only endpoints open, mutations require auth
app.use('/api', require('./routes/api'));
app.use('/api/trigger', requireAuth, rateLimit, require('./routes/trigger'));
app.use('/api/cron', requireAuth, require('./routes/cron'));

// SPA fallback — serve index.html for unmatched routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize
function start() {
  // Clear stale status.json from previous session
  const statusFile = path.join(__dirname, '..', 'status.json');
  try { fs.writeFileSync(statusFile, JSON.stringify({ running: false })); } catch {}

  // Ensure DB is initialized
  db.getDb();

  // Run initial migration (seeds from existing files)
  console.log('[server] Running initial migration...');
  migrate();

  // Start file watchers
  sync.startWatching();

  // Start GitHub sync (fetches all open PRs on startup + every 5 min)
  githubSync.startPeriodicSync();

  app.listen(PORT, () => {
    console.log(`[server] PR Review Dashboard running at http://localhost:${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Shutting down...');
  githubSync.stopPeriodicSync();
  sync.stopWatching();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  githubSync.stopPeriodicSync();
  sync.stopWatching();
  db.close();
  process.exit(0);
});

start();
