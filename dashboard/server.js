const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const sync = require('./sync');
const { migrate } = require('./migrate');
const githubSync = require('./github-sync');

const PORT = process.env.PORT || 3847;
const app = express();

app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', require('./routes/api'));
app.use('/api/trigger', require('./routes/trigger'));

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
