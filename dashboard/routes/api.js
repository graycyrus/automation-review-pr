const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const db = require('../db');
const sync = require('../sync');
const githubSync = require('../github-sync');
const triggerRouter = require('./trigger');
const { scanTrackingDir, scanLogsDir } = require('../parser');

const router = express.Router();

const BASE_DIR = path.resolve(__dirname, '../..');
const TRACKING_DIR = path.join(BASE_DIR, 'tinyhumansai-openhuman');
const APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

// GET /api/stats
router.get('/stats', (req, res) => {
  const stats = db.getStats();
  const liveStatus = sync.getLiveStatus();
  res.json({ ...stats, liveStatus });
});

// GET /api/prs?status=pending&author=oxoxDev&member=1&draft=0&mergeable=MERGEABLE&...
router.get('/prs', (req, res) => {
  const filters = {
    status: req.query.status || undefined,
    author: req.query.author || undefined,
    member: req.query.member,
    draft: req.query.draft,
    mergeable: req.query.mergeable || undefined,
    review_decision: req.query.review_decision || undefined,
    label: req.query.label || undefined,
    has_review: req.query.has_review,
    has_findings: req.query.has_findings,
    merge_state: req.query.merge_state || undefined,
    is_open: req.query.is_open,
    assignee: req.query.assignee || undefined,
    reviewer: req.query.reviewer || undefined,
    search: req.query.search || undefined,
    min_additions: req.query.min_additions || undefined,
    max_additions: req.query.max_additions || undefined,
    min_deletions: req.query.min_deletions || undefined,
    max_deletions: req.query.max_deletions || undefined,
    created_after: req.query.created_after || undefined,
    created_before: req.query.created_before || undefined,
    ci_status: req.query.ci_status || undefined,
    include_merged: req.query.include_merged === '1' || undefined,
    sort: req.query.sort || undefined,
    order: req.query.order || undefined,
  };

  const prs = db.queryPrs(filters);
  const liveStatus = sync.getLiveStatus();
  const activeJobs = triggerRouter.activeJobs;

  const enriched = prs.map(pr => {
    // Check trigger jobs first (supports multiple concurrent reviews)
    const job = activeJobs.get(`review-${pr.id}`);
    const jobRunning = job && !job.done;
    // Fall back to status.json for reviews started from terminal
    const statusRunning = liveStatus && liveStatus.running && liveStatus.pr === pr.id;

    return {
      ...pr,
      is_running: jobRunning || statusRunning,
      running_phase: jobRunning ? (liveStatus?.pr === pr.id ? liveStatus.phase : 'A') : (statusRunning ? liveStatus.phase : null),
    };
  });

  res.json(enriched);
});

// GET /api/filters — distinct values for filter dropdowns
router.get('/filters', (req, res) => {
  const options = db.getFilterOptions();
  res.json(options);
});

// GET /api/prs/:id
router.get('/prs/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pr = db.getPrByIdFull(id);
  if (!pr) return res.status(404).json({ error: 'PR not found' });

  const cycles = db.getCyclesByPr(id);
  const liveStatus = sync.getLiveStatus();
  const job = triggerRouter.activeJobs.get(`review-${id}`);
  const jobRunning = job && !job.done;
  const statusRunning = liveStatus && liveStatus.running && liveStatus.pr === id;

  res.json({
    ...pr,
    cycles,
    is_running: jobRunning || statusRunning,
    running_phase: jobRunning ? (liveStatus?.pr === id ? liveStatus.phase : 'A') : (statusRunning ? liveStatus.phase : null),
  });
});

// GET /api/prs/:id/checks — parsed CI checks
router.get('/prs/:id/checks', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pr = db.getPrByIdFull(id);
  if (!pr) return res.status(404).json({ error: 'PR not found' });

  let checks = [];
  if (pr.ci_checks) {
    try { checks = JSON.parse(pr.ci_checks); } catch {}
  }

  res.json({
    total: pr.ci_total || 0,
    pass: pr.ci_pass || 0,
    fail: pr.ci_fail || 0,
    pending: pr.ci_pending || 0,
    checks,
  });
});

// GET /api/prs/:id/tracking — raw markdown
router.get('/prs/:id/tracking', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pr = db.getPrById(id);
  if (!pr) return res.status(404).json({ error: 'PR not found' });

  const filePath = pr.tracking_file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Tracking file not found' });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  res.type('text/plain').send(content);
});

// GET /api/prs/:id/tracking/html — rendered markdown
router.get('/prs/:id/tracking/html', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pr = db.getPrById(id);
  if (!pr) return res.status(404).json({ error: 'PR not found' });

  const filePath = pr.tracking_file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Tracking file not found' });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const html = marked(content);
  res.type('text/html').send(html);
});

// GET /api/prs/:id/log/:cycle — raw log for a review cycle
router.get('/prs/:id/log/:cycle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cycleNum = parseInt(req.params.cycle, 10);

  const cycles = db.getCyclesByPr(id);
  const cycle = cycles.find(c => c.cycle_number === cycleNum);

  if (!cycle || !cycle.log_file_path || !fs.existsSync(cycle.log_file_path)) {
    // Try to find a matching log file by PR number
    const logPattern = new RegExp(`review-PR-${id}.*\\.log$`);
    const logFiles = fs.existsSync(LOGS_DIR)
      ? fs.readdirSync(LOGS_DIR).filter(f => logPattern.test(f)).sort()
      : [];

    if (logFiles.length > 0 && logFiles[cycleNum - 1]) {
      const content = fs.readFileSync(path.join(LOGS_DIR, logFiles[cycleNum - 1]), 'utf-8');
      return res.type('text/plain').send(content);
    }

    return res.status(404).json({ error: 'Log not found' });
  }

  const content = fs.readFileSync(cycle.log_file_path, 'utf-8');
  res.type('text/plain').send(content);
});

// GET /api/prs/:id/logs — list all log files for a PR
router.get('/prs/:id/logs', (req, res) => {
  const id = parseInt(req.params.id, 10);

  const logPattern = new RegExp(`review-PR-${id}.*\\.log$`);
  const logFiles = fs.existsSync(LOGS_DIR)
    ? fs.readdirSync(LOGS_DIR).filter(f => logPattern.test(f)).sort()
    : [];

  const logs = logFiles.map(f => ({
    filename: f,
    path: path.join(LOGS_DIR, f),
    size: fs.statSync(path.join(LOGS_DIR, f)).size,
  }));

  res.json(logs);
});

// GET /api/cron-runs
router.get('/cron-runs', (req, res) => {
  const runs = db.getAllCronRuns();
  res.json(runs);
});

// GET /api/status — live review status
router.get('/status', (req, res) => {
  const liveStatus = sync.getLiveStatus();
  res.json(liveStatus || { running: false });
});

// POST /api/sync — force re-sync from files
router.post('/sync', (req, res) => {
  try {
    const trackingPrs = scanTrackingDir(TRACKING_DIR, 'tinyhumansai-openhuman');
    const approvedPrs = scanTrackingDir(APPROVED_DIR, 'to-be-approved');
    const allPrs = [...trackingPrs, ...approvedPrs];

    for (const { pr, cycles } of allPrs) {
      if (!pr.id) continue;
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
        tracking_file_path: pr.tracking_file_path,
        location: pr.location,
      });
      if (cycles.length > 0) {
        db.replaceCyclesForPr(pr.id, cycles);
      }
    }

    // Also refresh from GitHub
    githubSync.fetchAllOpenPrs();

    res.json({ synced: allPrs.length, github: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github-sync — force GitHub re-fetch
router.post('/github-sync', (req, res) => {
  try {
    githubSync.fetchAllOpenPrs();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
