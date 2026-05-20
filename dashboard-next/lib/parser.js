const fs = require('fs');
const path = require('path');

/**
 * Parse a PR tracking .md file into a structured object.
 * Handles the format used in tinyhumansai-openhuman/ and to-be-approved/.
 */
function parseTrackingFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const pr = {
    id: null,
    title: null,
    author: null,
    branch: null,
    base_branch: 'main',
    url: null,
    created_at: null,
    status: null,
    last_reviewed_commit: null,
    last_review_date: null,
    tracking_file_path: filePath,
  };

  const cycles = [];

  // Extract PR number and title from first heading
  const titleMatch = content.match(/^# PR #(\d+)\s*[—–-]\s*(.+)$/m);
  if (titleMatch) {
    pr.id = parseInt(titleMatch[1], 10);
    pr.title = titleMatch[2].trim();
  }

  // Extract metadata fields
  const fieldPatterns = {
    author: /\*\*Author\*\*:\s*@?(.+)/,
    branch: /\*\*Branch\*\*:\s*(.+?)(?:\s*→\s*(.+))?$/,
    created_at: /\*\*Created\*\*:\s*(.+)/,
    url: /\*\*URL\*\*:\s*(.+)/,
    status: /\*\*Status\*\*:\s*(.+)/,
    last_reviewed_commit: /\*\*Last reviewed commit\*\*:\s*(.+)/,
    last_review_date: /\*\*Last review date\*\*:\s*(.+)/,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    for (const [field, pattern] of Object.entries(fieldPatterns)) {
      const m = trimmed.match(pattern);
      if (m) {
        if (field === 'branch') {
          pr.branch = m[1].trim();
          if (m[2]) pr.base_branch = m[2].trim();
        } else {
          pr[field] = m[1].trim();
        }
      }
    }
  }

  // Parse review cycles
  const cycleRegex = /^### Review (\d+)\s*[—–-]\s*(.+)$/gm;
  let match;
  const cyclePositions = [];

  while ((match = cycleRegex.exec(content)) !== null) {
    cyclePositions.push({
      number: parseInt(match[1], 10),
      timestamp: match[2].trim(),
      start: match.index,
    });
  }

  for (let i = 0; i < cyclePositions.length; i++) {
    const start = cyclePositions[i].start;
    const end = i + 1 < cyclePositions.length ? cyclePositions[i + 1].start : content.length;
    const block = content.slice(start, end);

    const cycle = parseCycleBlock(block, cyclePositions[i].number, cyclePositions[i].timestamp);
    cycles.push(cycle);
  }

  return { pr, cycles };
}

function parseCycleBlock(block, cycleNumber, timestamp) {
  const cycle = {
    cycle_number: cycleNumber,
    type: extractField(block, 'Type') || 'Fresh',
    status: 'completed',
    started_at: timestamp,
    ended_at: timestamp,
    duration_seconds: null,
    commit_sha: extractField(block, 'Commit'),
    summary: extractMarkdownField(block, 'Summary'),
    gates: extractField(block, 'Gates'),
    areas_changed: extractField(block, 'Areas changed'),
    findings_critical: 0,
    findings_major: 0,
    findings_minor: 0,
    action_taken: extractField(block, 'Action taken'),
    github_review_url: extractField(block, 'GitHub review URL'),
    coderabbit_dedup: extractField(block, 'CodeRabbit dedup'),
    resolution_actions: extractMarkdownField(block, 'Resolution actions'),
    log_file_path: null,
    reviewer: 'graycyrus',
  };

  // Count findings by severity
  const findingsSection = block.match(/\*\*Findings\*\*:\s*\n([\s\S]*?)(?=\n\*\*|$)/);
  if (findingsSection) {
    const findingsText = findingsSection[1];
    cycle.findings_critical = (findingsText.match(/\[critical\]/g) || []).length;
    cycle.findings_major = (findingsText.match(/\[major\]/g) || []).length;
    cycle.findings_minor = (findingsText.match(/\[minor\]/g) || []).length;
  }

  return cycle;
}

function extractField(block, fieldName) {
  const pattern = new RegExp(`\\*\\*${escapeRegex(fieldName)}\\*\\*:\\s*(.+)`, 'i');
  const m = block.match(pattern);
  return m ? m[1].trim() : null;
}

function extractMarkdownField(block, fieldName) {
  const pattern = new RegExp(`^\\*\\*${escapeRegex(fieldName)}\\*\\*:\\s*(.*)$`, 'im');
  const m = block.match(pattern);
  if (!m) return null;

  const afterField = block.slice(m.index + m[0].length);
  const nextField = afterField.search(/\n\*\*[^*\n]+?\*\*:/);
  const continuation = nextField === -1 ? afterField : afterField.slice(0, nextField);
  const value = [m[1], continuation]
    .join('\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

  return value || null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a cron log file to extract run metadata.
 */
function parseCronLog(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  const run = {
    started_at: null,
    ended_at: null,
    duration_seconds: null,
    prs_discovered: null,
    prs_reviewed: null,
    prs_skipped: null,
    prs_failed: null,
    log_file_path: filePath,
  };

  // Try to parse CRON_META line (new format after script modifications)
  const metaMatch = content.match(/CRON_META:\s*started=(\S+)\s+ended=(\S+)\s+discovered=(\d+)\s+reviewed=(\d+)\s+failed=(\d+)/);
  if (metaMatch) {
    run.started_at = metaMatch[1];
    run.ended_at = metaMatch[2];
    run.prs_discovered = parseInt(metaMatch[3], 10);
    run.prs_reviewed = parseInt(metaMatch[4], 10);
    run.prs_failed = parseInt(metaMatch[5], 10);
    run.prs_skipped = run.prs_discovered - run.prs_reviewed;

    const start = new Date(run.started_at);
    const end = new Date(run.ended_at);
    if (!isNaN(start) && !isNaN(end)) {
      run.duration_seconds = Math.round((end - start) / 1000);
    }
    return run;
  }

  // Fallback: parse old format
  const timestampMatch = filePath.match(/review-(\d{4}-\d{2}-\d{2}-\d{4})\.log/);
  if (timestampMatch) {
    const ts = timestampMatch[1];
    const dateStr = ts.replace(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/, '$1T$2:$3:00Z');
    run.started_at = dateStr;
  }

  const discoveredMatch = content.match(/Discovered:\s*(\d+)/);
  if (discoveredMatch) run.prs_discovered = parseInt(discoveredMatch[1], 10);

  const succeededMatch = content.match(/Succeeded:\s*(\d+)/);
  if (succeededMatch) run.prs_reviewed = parseInt(succeededMatch[1], 10);

  const failedMatch = content.match(/Failed:\s*(\d+)/);
  if (failedMatch) run.prs_failed = parseInt(failedMatch[1], 10);

  if (run.prs_discovered != null && run.prs_reviewed != null) {
    run.prs_skipped = run.prs_discovered - run.prs_reviewed - (run.prs_failed || 0);
  }

  return run;
}

/**
 * Scan a directory for PR tracking .md files and parse them all.
 */
function scanTrackingDir(dirPath, location) {
  if (!fs.existsSync(dirPath)) return [];

  const files = fs.readdirSync(dirPath).filter(f => f.match(/^PR-\d+\.md$/));
  const results = [];

  for (const file of files) {
    try {
      const parsed = parseTrackingFile(path.join(dirPath, file));
      parsed.pr.location = location;
      results.push(parsed);
    } catch (err) {
      console.error(`[parser] Failed to parse ${file}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Scan logs directory for cron run logs.
 */
function scanLogsDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  const files = fs.readdirSync(dirPath).filter(f => f.match(/^review-\d{4}-\d{2}-\d{2}-\d{4}\.log$/));
  const results = [];

  for (const file of files) {
    try {
      results.push(parseCronLog(path.join(dirPath, file)));
    } catch (err) {
      console.error(`[parser] Failed to parse log ${file}: ${err.message}`);
    }
  }

  return results;
}

module.exports = {
  parseTrackingFile,
  parseCronLog,
  scanTrackingDir,
  scanLogsDir,
};
