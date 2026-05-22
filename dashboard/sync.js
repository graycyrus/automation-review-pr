const fs = require('fs');
const path = require('path');
const db = require('./db');
const { parseTrackingFile, parseCronLog } = require('./parser');

const BASE_DIR = path.resolve(__dirname, '..');
const TRACKING_DIR = path.join(BASE_DIR, 'tinyhumansai-openhuman');
const APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');
const FULLY_APPROVED_DIR = path.join(BASE_DIR, 'approved');
const TO_BE_CLOSED_DIR = path.join(BASE_DIR, 'to-be-closed');
const MERGED_DIR = path.join(BASE_DIR, 'already-merged');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');

const DEBOUNCE_MS = 500;
const debounceTimers = new Map();

function debounced(key, fn) {
  if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    fn();
  }, DEBOUNCE_MS));
}

function syncFile(filePath, location) {
  if (!filePath.match(/PR-\d+\.md$/)) return;

  try {
    const { pr, cycles } = parseTrackingFile(filePath);
    if (!pr.id) return;

    pr.location = location;

    db.upsertPr({
      id: pr.id,
      title: pr.title,
      author: pr.author,
      branch: pr.branch,
      base_branch: pr.base_branch,
      url: pr.url,
      created_at: pr.created_at,
      status: pr.status,
      is_member: null,
      last_reviewed_commit: pr.last_reviewed_commit,
      last_review_date: pr.last_review_date,
      tracking_file_path: filePath,
      location,
    });

    if (cycles.length > 0) {
      db.replaceCyclesForPr(pr.id, cycles);
    }

    console.log(`[sync] Updated PR #${pr.id} from ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[sync] Error parsing ${filePath}: ${err.message}`);
  }
}

function watchDir(dirPath, location) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const watcher = fs.watch(dirPath, (eventType, filename) => {
    if (!filename || !filename.match(/^PR-\d+\.md$/)) return;
    const fullPath = path.join(dirPath, filename);
    debounced(fullPath, () => {
      if (fs.existsSync(fullPath)) {
        syncFile(fullPath, location);
      }
    });
  });

  return watcher;
}

let _liveStatus = null;

function watchStatusFile() {
  if (!fs.existsSync(path.dirname(STATUS_FILE))) return null;

  // Read initial status
  readStatusFile();

  try {
    const watcher = fs.watch(path.dirname(STATUS_FILE), (eventType, filename) => {
      if (filename === 'status.json') {
        debounced(STATUS_FILE, readStatusFile);
      }
    });
    return watcher;
  } catch {
    return null;
  }
}

function readStatusFile() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      _liveStatus = JSON.parse(raw);
    } else {
      _liveStatus = null;
    }
  } catch {
    _liveStatus = null;
  }
}

function getLiveStatus() {
  return _liveStatus;
}

let watchers = [];

function startWatching() {
  console.log('[sync] Starting file watchers...');
  watchers.push(watchDir(TRACKING_DIR, 'tinyhumansai-openhuman'));
  watchers.push(watchDir(APPROVED_DIR, 'to-be-approved'));
  watchers.push(watchDir(FULLY_APPROVED_DIR, 'approved'));
  watchers.push(watchDir(TO_BE_CLOSED_DIR, 'to-be-closed'));
  // Don't watch already-merged — these are archived and shouldn't be in the DB
  watchers.push(watchStatusFile());
  console.log('[sync] Watching: tinyhumansai-openhuman/, to-be-approved/, already-merged/, status.json');
}

function stopWatching() {
  for (const w of watchers) {
    if (w) w.close();
  }
  watchers = [];
}

module.exports = {
  syncFile,
  startWatching,
  stopWatching,
  getLiveStatus,
};
