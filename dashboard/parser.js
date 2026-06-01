const fs = require('fs');
const path = require('path');

/**
 * Parse a markdown table into key-value pairs.
 * Handles: | Field | Value | rows, skipping header separators.
 */
function parseTable(text) {
  const rows = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|(?:\s*(.+?)\s*\|)?/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    // Skip header separator rows and header row itself
    if (key.match(/^[-:]+$/) || key === 'Field' || key === 'Dimension' || key === 'Signal') continue;
    rows[key] = m[3] ? { value: val, detail: m[3].trim() } : val;
  }
  return rows;
}

/**
 * Extract a named ## section from markdown content.
 * Returns the text between ## <name> and the next ## heading (or EOF).
 */
function extractSection(content, sectionName) {
  const regex = new RegExp(`^## ${escapeRegex(sectionName)}\\s*$`, 'im');
  const match = regex.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;
  const nextSection = content.slice(start).search(/^## /m);
  return nextSection === -1 ? content.slice(start).trim() : content.slice(start, start + nextSection).trim();
}

/**
 * Parse a PR tracking .md file into a structured object.
 * Supports both the new table-based format and the legacy bold-field format.
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
    // AI Summary fields
    ai_summary: null,
    ai_summary_what: null,
    ai_summary_breaking_risk: null,
    ai_summary_security_risk: null,
    ai_summary_bottom_line: null,
    // AI Quality fields
    ai_slop_detected: null,
    ai_slop_structural: null,
    ai_slop_content: null,
    ai_slop_behavioral: null,
    // UI Impact fields
    ui_visual_change: null,
    ui_user_flow: null,
    ui_affected_surfaces: null,
    ui_risk: null,
    ui_recommendation: null,
  };

  const cycles = [];

  // Extract PR number and title from first heading
  const titleMatch = content.match(/^# PR #(\d+)\s*[—–-]\s*(.+)$/m);
  if (titleMatch) {
    pr.id = parseInt(titleMatch[1], 10);
    pr.title = titleMatch[2].trim();
  }

  // --- Try new table-based Metadata section first ---
  const metadataSection = extractSection(content, 'Metadata');
  if (metadataSection) {
    const meta = parseTable(metadataSection);
    pr.author = (meta['Author'] || '').replace(/^@/, '') || null;
    const branchVal = meta['Branch'] || '';
    const branchParts = branchVal.split('→').map(s => s.trim());
    pr.branch = branchParts[0] || null;
    pr.base_branch = branchParts[1] || 'main';
    pr.created_at = meta['Created'] || null;
    pr.url = meta['URL'] || null;
    pr.status = meta['Status'] || null;
    pr.last_reviewed_commit = meta['Last reviewed commit'] || null;
    pr.last_review_date = meta['Last review date'] || null;
  } else {
    // Legacy bold-field format
    const fieldPatterns = {
      author: /\*\*Author\*\*:\s*@?([\w.-]+)/,
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
  }

  // --- Parse AI Summary section ---
  const aiSection = extractSection(content, 'AI Summary');
  if (aiSection) {
    const aiTable = parseTable(aiSection);
    if (aiTable['What it does']) {
      // New table format (3-column: Dimension | Rating | Detail)
      const what = aiTable['What it does'];
      pr.ai_summary_what = typeof what === 'object' ? what.detail : what;
      const breaking = aiTable['Breaking risk'];
      pr.ai_summary_breaking_risk = typeof breaking === 'object' ? breaking.value : (breaking || null);
      const security = aiTable['Security risk'];
      pr.ai_summary_security_risk = typeof security === 'object' ? security.value : (security || null);
      const bottom = aiTable['Bottom line'];
      pr.ai_summary_bottom_line = typeof bottom === 'object' ? `${bottom.value} — ${bottom.detail}` : (bottom || null);
    }
    // Build combined ai_summary for backward compat
    const parts = [];
    if (pr.ai_summary_what) parts.push(`**What it does**: ${pr.ai_summary_what}`);
    if (pr.ai_summary_breaking_risk) parts.push(`**Breaking risk**: ${pr.ai_summary_breaking_risk}`);
    if (pr.ai_summary_security_risk) parts.push(`**Security risk**: ${pr.ai_summary_security_risk}`);
    if (pr.ai_summary_bottom_line) parts.push(`**Bottom line**: ${pr.ai_summary_bottom_line}`);
    if (parts.length > 0) {
      pr.ai_summary = parts.join('\n');
    } else {
      // Legacy free-text format
      pr.ai_summary = aiSection;
    }

    // Legacy: extract individual fields from bold-field format
    if (!pr.ai_summary_what) {
      const whatMatch = aiSection.match(/\*\*What it does\*\*:\s*(.+)/);
      if (whatMatch) pr.ai_summary_what = whatMatch[1].trim();
    }
    if (!pr.ai_summary_breaking_risk) {
      const breakMatch = aiSection.match(/\*\*Breaking risk\*\*:\s*(\w+)/);
      if (breakMatch) pr.ai_summary_breaking_risk = breakMatch[1].trim();
    }
    if (!pr.ai_summary_security_risk) {
      const secMatch = aiSection.match(/\*\*Security risk\*\*:\s*(\w+)/);
      if (secMatch) pr.ai_summary_security_risk = secMatch[1].trim();
    }
    if (!pr.ai_summary_bottom_line) {
      const bottomMatch = aiSection.match(/\*\*Bottom line\*\*:\s*(.+)/);
      if (bottomMatch) pr.ai_summary_bottom_line = bottomMatch[1].trim();
    }
  }

  // --- Parse AI Quality section ---
  const aiQualitySection = extractSection(content, 'AI Quality');
  if (aiQualitySection) {
    const aq = parseTable(aiQualitySection);
    const slop = aq['AI slop'];
    pr.ai_slop_detected = slop ? (typeof slop === 'object' ? slop.value : slop) : null;
    const structural = aq['Structural signals'];
    pr.ai_slop_structural = structural ? (typeof structural === 'object' ? structural.detail : structural) : null;
    const contentSig = aq['Content signals'];
    pr.ai_slop_content = contentSig ? (typeof contentSig === 'object' ? contentSig.detail : contentSig) : null;
    const behavioral = aq['Behavioral signals'];
    pr.ai_slop_behavioral = behavioral ? (typeof behavioral === 'object' ? behavioral.detail : behavioral) : null;
  }

  // --- Parse UI Impact section ---
  const uiSection = extractSection(content, 'UI Impact');
  if (uiSection) {
    const ui = parseTable(uiSection);
    pr.ui_visual_change = ui['Visual change'] || null;
    pr.ui_user_flow = ui['User flow'] || null;
    pr.ui_affected_surfaces = ui['Affected surfaces'] || null;
    pr.ui_risk = ui['Risk'] || null;
    pr.ui_recommendation = ui['Recommendation'] || null;

    // Legacy bold-field format fallback
    if (!pr.ui_visual_change) {
      const vizMatch = uiSection.match(/\*\*Visual change\*\*:\s*(.+)/);
      if (vizMatch) pr.ui_visual_change = vizMatch[1].trim();
    }
    if (!pr.ui_user_flow) {
      const flowMatch = uiSection.match(/\*\*User flow\*\*:\s*(.+)/);
      if (flowMatch) pr.ui_user_flow = flowMatch[1].trim();
    }
    if (!pr.ui_affected_surfaces) {
      const surfMatch = uiSection.match(/\*\*Affected surfaces\*\*:\s*(.+)/);
      if (surfMatch) pr.ui_affected_surfaces = surfMatch[1].trim();
    }
    if (!pr.ui_risk) {
      const riskMatch = uiSection.match(/\*\*Risk\*\*:\s*(.+)/);
      if (riskMatch) pr.ui_risk = riskMatch[1].trim();
    }
    if (!pr.ui_recommendation) {
      const recMatch = uiSection.match(/\*\*Recommendation\*\*:\s*(.+)/);
      if (recMatch) pr.ui_recommendation = recMatch[1].trim();
    }
    // Plain text fallback (e.g., "N/A — no frontend production code changed")
    if (!pr.ui_visual_change && !uiSection.includes('|') && !uiSection.includes('**')) {
      pr.ui_visual_change = uiSection.split('\n')[0].trim();
    }
  }

  // --- Parse review cycles ---
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
  // Try new table-based format first
  const contextSection = block.match(/#### Context\n([\s\S]*?)(?=\n####|$)/);
  const analysisSection = block.match(/#### Analysis\n([\s\S]*?)(?=\n####|$)/);
  const outcomeSection = block.match(/#### Outcome\n([\s\S]*?)(?=\n####|$)/);

  let cycle;

  if (contextSection && analysisSection && outcomeSection) {
    const ctx = parseTable(contextSection[1]);
    const analysis = parseTable(analysisSection[1]);
    const outcome = parseTable(outcomeSection[1]);

    cycle = {
      cycle_number: cycleNumber,
      type: ctx['Type'] || 'Fresh',
      status: 'completed',
      started_at: timestamp,
      ended_at: timestamp,
      duration_seconds: null,
      commit_sha: ctx['Commit'] || null,
      summary: analysis['Summary'] || null,
      gates: ctx['Gates'] || null,
      areas_changed: ctx['Areas changed'] || null,
      linked_issues: ctx['Linked issues'] || null,
      pr_issue_alignment: ctx['PR-Issue alignment'] || null,
      findings_critical: 0,
      findings_major: 0,
      findings_minor: 0,
      action_taken: outcome['Action taken'] || null,
      github_review_url: outcome['GitHub review URL'] || null,
      coderabbit_dedup: analysis['CodeRabbit dedup'] || null,
      resolution_actions: analysis['Resolution actions'] || null,
      dependency_audit: analysis['Dependency audit'] || null,
      test_coverage: analysis['Test coverage'] || null,
      impact_scan: analysis['Impact scan'] || null,
      log_file_path: null,
      reviewer: 'graycyrus',
    };
  } else {
    // Legacy bold-field format
    cycle = {
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
      linked_issues: extractField(block, 'Linked issues'),
      pr_issue_alignment: extractMarkdownField(block, 'PR-Issue alignment'),
      findings_critical: 0,
      findings_major: 0,
      findings_minor: 0,
      action_taken: extractField(block, 'Action taken'),
      github_review_url: extractField(block, 'GitHub review URL'),
      coderabbit_dedup: extractField(block, 'CodeRabbit dedup'),
      resolution_actions: extractMarkdownField(block, 'Resolution actions'),
      dependency_audit: extractField(block, 'Dependency audit'),
      test_coverage: extractMarkdownField(block, 'Test coverage'),
      impact_scan: extractMarkdownField(block, 'Impact scan'),
      log_file_path: null,
      reviewer: 'graycyrus',
    };
  }

  // Count findings by severity (works for both formats)
  const findingsMatch = block.match(/#### Findings\n([\s\S]*?)(?=\n####|$)/) ||
                        block.match(/\*\*Findings\*\*:\s*\n([\s\S]*?)(?=\n\*\*|$)/);
  if (findingsMatch) {
    const findingsText = findingsMatch[1];
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
