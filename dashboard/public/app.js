const API = '';

// --- Utilities ---

function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function statusBadge(status) {
  const map = {
    'clean': 'badge-green',
    'approved': 'badge-green',
    'merged': 'badge-purple',
    'closed': 'badge-red',
    'changes-requested': 'badge-yellow',
    'blocked': 'badge-red',
    'under-review': 'badge-blue',
    'pending': 'badge-gray',
    'skipped': 'badge-gray',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || 'pending'}</span>`;
}

function reviewDecisionBadge(decision) {
  if (!decision) return '<span class="badge badge-gray">none</span>';
  const map = {
    'APPROVED': 'badge-green',
    'CHANGES_REQUESTED': 'badge-yellow',
    'REVIEW_REQUIRED': 'badge-purple',
  };
  return `<span class="badge ${map[decision] || 'badge-gray'}">${decision.toLowerCase().replace(/_/g, ' ')}</span>`;
}

function mergeableBadge(mergeable) {
  if (!mergeable) return '-';
  if (mergeable === 'MERGEABLE') return '<span class="badge badge-green">mergeable</span>';
  if (mergeable === 'CONFLICTING') return '<span class="badge badge-red">conflicts</span>';
  return `<span class="badge badge-gray">${mergeable.toLowerCase()}</span>`;
}

function actionBadge(action) {
  if (!action) return '-';
  if (action.includes('REQUEST_CHANGES')) return `<span class="badge badge-yellow">REQUEST_CHANGES</span>`;
  if (action.includes('COMMENT')) return `<span class="badge badge-blue">COMMENT</span>`;
  if (action.includes('approved') || action.includes('clean')) return `<span class="badge badge-green">APPROVED</span>`;
  if (action.includes('BLOCKED')) return `<span class="badge badge-red">BLOCKED</span>`;
  return `<span class="badge badge-gray">${action}</span>`;
}

function waitingFor(pr) {
  if (pr.status === 'merged') return '<span style="color:var(--purple)">Merged</span>';
  if (pr.status === 'closed') return '<span style="color:var(--red)">Closed</span>';
  if (pr.is_running) return `<span class="running-indicator"><span class="running-dot"></span>Reviewing${pr.running_phase ? ' (Phase ' + pr.running_phase + ')' : ''}</span>`;
  if (pr.gh_is_draft) return '<span style="color:var(--text-muted)">Draft</span>';
  if (!pr.status || pr.status === 'pending') return '<span style="color:var(--purple)">Not reviewed</span>';
  if (pr.status === 'changes-requested') return 'Author response';
  if (pr.status === 'blocked') return 'CI / Conflicts';
  if (pr.status === 'clean') return '-';
  return '-';
}

function memberBadge(isMember) {
  if (isMember === 1) return '<span class="badge badge-member">member</span>';
  if (isMember === 0) return '<span class="badge badge-collaborator">collaborator</span>';
  return '<span class="badge badge-gray">?</span>';
}

function diffStat(additions, deletions, changedFiles) {
  if (!additions && !deletions) return '-';
  return `<span style="color:var(--green)">+${additions || 0}</span> <span style="color:var(--red)">-${deletions || 0}</span> <span style="color:var(--text-muted)">(${changedFiles || 0})</span>`;
}

function labelBadges(labels) {
  if (!labels) return '';
  return labels.split(', ').filter(Boolean).map(l =>
    `<span class="badge badge-gray" style="font-size:11px">${esc(l)}</span>`
  ).join(' ');
}

function ciBadge(pr) {
  if (!pr.ci_total) return '<span style="color:var(--text-muted)">-</span>';
  const pass = pr.ci_pass || 0;
  const fail = pr.ci_fail || 0;
  const pending = pr.ci_pending || 0;
  const total = pr.ci_total || 0;

  if (fail > 0) return `<span class="badge badge-red">${pass}/${total}</span>`;
  if (pending > 0) return `<span class="badge badge-yellow">${pass}/${total}</span>`;
  return `<span class="badge badge-green">${pass}/${total}</span>`;
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =============================================================
// Filter system — all state lives in URL query params
// =============================================================

const FILTER_KEYS = [
  'search', 'status', 'author', 'member', 'draft', 'mergeable',
  'review_decision', 'has_review', 'has_findings', 'ci_status',
  'merge_state', 'label', 'include_merged', 'sort', 'order',
];

const FILTER_LABELS = {
  search: 'Search',
  status: 'Status',
  author: 'Author',
  member: v => v === '1' ? 'Member' : 'Collaborator',
  draft: v => v === '1' ? 'Drafts' : 'Ready',
  mergeable: 'Merge',
  review_decision: 'GH Decision',
  has_review: v => v === '1' ? 'Reviewed' : 'Not reviewed',
  has_findings: v => v === '1' ? 'Has findings' : 'No findings',
  ci_status: v => `CI: ${v}`,
  merge_state: 'Merge state',
  include_merged: v => v === '1' ? 'Including merged' : '',
  label: 'Label',
  sort: 'Sort',
  order: 'Order',
};

function getFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const filters = {};
  for (const key of FILTER_KEYS) {
    const val = params.get(key);
    if (val !== null && val !== '') filters[key] = val;
  }
  return filters;
}

function setFiltersToUrl(filters) {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      params.set(key, val);
    }
  }
  const qs = params.toString();
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}

function getFiltersFromForm() {
  const filters = {};
  for (const key of FILTER_KEYS) {
    const el = document.getElementById(`f-${key}`);
    if (el && el.value) filters[key] = el.value;
  }
  return filters;
}

function setFormFromFilters(filters) {
  for (const key of FILTER_KEYS) {
    const el = document.getElementById(`f-${key}`);
    if (el) el.value = filters[key] || '';
  }
  // Highlight active filters
  for (const key of FILTER_KEYS) {
    const el = document.getElementById(`f-${key}`);
    if (el) {
      el.classList.toggle('active', !!filters[key] && key !== 'sort' && key !== 'order');
    }
  }
}

function buildQueryString(filters) {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      params.set(key, val);
    }
  }
  return params.toString();
}

function renderFilterSummary(filters) {
  const el = document.getElementById('filter-summary');
  if (!el) return;

  const activeTags = Object.entries(filters)
    .filter(([k, v]) => v && k !== 'sort' && k !== 'order')
    .map(([key, val]) => {
      const labelFn = FILTER_LABELS[key];
      const display = typeof labelFn === 'function' ? labelFn(val) : `${labelFn}: ${val}`;
      return `<span class="filter-tag">${display}<button onclick="removeFilter('${key}')">&times;</button></span>`;
    });

  if (activeTags.length === 0) {
    el.style.display = 'none';
  } else {
    el.style.display = 'flex';
    el.innerHTML = `<span>Filters:</span> ${activeTags.join('')}`;
  }
}

function removeFilter(key) {
  const filters = getFiltersFromUrl();
  delete filters[key];
  setFiltersToUrl(filters);
  setFormFromFilters(filters);
  renderFilterSummary(filters);
  fetchAndRender();
}

function clearFilters() {
  setFiltersToUrl({});
  setFormFromFilters({});
  renderFilterSummary({});
  fetchAndRender();
}

// =============================================================
// Dashboard page
// =============================================================

let _filterOptions = null;

async function loadFilterOptions() {
  try {
    const res = await fetch(`${API}/api/filters`);
    _filterOptions = await res.json();
    populateFilterDropdowns(_filterOptions);
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
}

function populateFilterDropdowns(opts) {
  // Authors
  const authorEl = document.getElementById('f-author');
  if (authorEl && opts.authors) {
    const current = authorEl.value;
    authorEl.innerHTML = '<option value="">All authors</option>' +
      opts.authors.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    authorEl.value = current;
  }

  // Statuses
  const statusEl = document.getElementById('f-status');
  if (statusEl && opts.statuses) {
    const current = statusEl.value;
    statusEl.innerHTML = '<option value="">All statuses</option>' +
      opts.statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    statusEl.value = current;
  }

  // Labels
  const labelEl = document.getElementById('f-label');
  if (labelEl && opts.labels) {
    const current = labelEl.value;
    labelEl.innerHTML = '<option value="">All labels</option>' +
      opts.labels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    labelEl.value = current;
  }

  // Merge states
  const mergeStateEl = document.getElementById('f-merge_state');
  if (mergeStateEl && opts.mergeStates) {
    const current = mergeStateEl.value;
    mergeStateEl.innerHTML = '<option value="">Merge state</option>' +
      opts.mergeStates.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    mergeStateEl.value = current;
  }
}

async function fetchAndRender() {
  const filters = getFiltersFromUrl();
  const qs = buildQueryString(filters);

  try {
    const [statsRes, prsRes] = await Promise.all([
      fetch(`${API}/api/stats`),
      fetch(`${API}/api/prs${qs ? '?' + qs : ''}`),
    ]);
    const stats = await statsRes.json();
    const prs = await prsRes.json();

    renderStats(stats);
    renderTable(prs);
    renderFilterSummary(filters);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

function renderStats(s) {
  const el = document.getElementById('stats-bar');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-card"><div class="stat-value">${s.total || 0}</div><div class="stat-label">Total PRs</div></div>
    <div class="stat-card purple"><div class="stat-value">${s.pending || 0}</div><div class="stat-label">Pending</div></div>
    <div class="stat-card purple"><div class="stat-value">${s.drafts || 0}</div><div class="stat-label">Drafts</div></div>
    <div class="stat-card blue"><div class="stat-value">${s.under_review || 0}</div><div class="stat-label">Reviewing</div></div>
    <div class="stat-card yellow"><div class="stat-value">${s.changes_requested || 0}</div><div class="stat-label">Changes Req'd</div></div>
    <div class="stat-card green"><div class="stat-value">${s.clean || 0}</div><div class="stat-label">Clean</div></div>
    <div class="stat-card red"><div class="stat-value">${s.blocked || 0}</div><div class="stat-label">Blocked</div></div>
    <div class="stat-card purple"><div class="stat-value">${s.merged || 0}</div><div class="stat-label">Merged</div></div>
  `;

  // Make stat cards clickable as quick filters
  el.querySelectorAll('.stat-card').forEach(card => {
    const label = card.querySelector('.stat-label')?.textContent?.toLowerCase();
    const statusMap = {
      'pending': 'pending',
      'drafts': '__draft',
      'reviewing': 'under-review',
      "changes req'd": 'changes-requested',
      'clean': 'clean',
      'blocked': 'blocked',
      'merged': '__merged',
    };
    const filterVal = statusMap[label];
    if (filterVal && label !== 'total prs') {
      card.style.cursor = 'pointer';
      card.onclick = () => {
        if (filterVal === '__draft') {
          setFiltersToUrl({ draft: '1' });
          setFormFromFilters({ draft: '1' });
        } else if (filterVal === '__merged') {
          setFiltersToUrl({ status: 'merged', include_merged: '1' });
          setFormFromFilters({ status: 'merged', include_merged: '1' });
        } else {
          setFiltersToUrl({ status: filterVal });
          setFormFromFilters({ status: filterVal });
        }
        fetchAndRender();
      };
    }
  });
}

function renderTable(prs) {
  const tableBody = document.getElementById('pr-table-body');
  const footer = document.getElementById('table-footer');
  if (!tableBody) return;

  if (prs.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="14" class="empty-state">No PRs match your filters</td></tr>`;
    if (footer) footer.textContent = '';
    return;
  }

  tableBody.innerHTML = prs.map(pr => `
    <tr${pr.gh_is_draft ? ' style="opacity:0.6"' : ''}>
      <td class="pr-number"><a href="/pr.html?pr=${pr.id}">#${pr.id}</a></td>
      <td class="pr-title" title="${esc(pr.title)}">${esc(pr.title) || '-'}${pr.gh_is_draft ? ' <span class="badge badge-purple" style="font-size:10px">draft</span>' : ''}</td>
      <td><a href="javascript:void(0)" onclick="applyFilter('author','${esc(pr.author)}')">${esc(pr.author) || '-'}</a></td>
      <td>${memberBadge(pr.is_member)}</td>
      <td>${statusBadge(pr.status)}</td>
      <td>${waitingFor(pr)}</td>
      <td>${diffStat(pr.additions, pr.deletions, pr.changed_files)}</td>
      <td style="text-align:center">${pr.latest_cycle || 0}</td>
      <td>${timeAgo(pr.last_review_date || pr.updated_at_gh)}</td>
      <td>${formatDuration(pr.cycle_duration)}</td>
      <td>
        <div class="findings">
          ${pr.findings_critical ? `<span class="f-crit">${pr.findings_critical}C</span>` : ''}
          ${pr.findings_major ? `<span class="f-major">${pr.findings_major}M</span>` : ''}
          ${pr.findings_minor ? `<span class="f-minor">${pr.findings_minor}m</span>` : ''}
          ${!pr.findings_critical && !pr.findings_major && !pr.findings_minor ? '-' : ''}
        </div>
      </td>
      <td>${ciBadge(pr)}</td>
      <td>${mergeableBadge(pr.mergeable)}</td>
      <td>
          ${pr.status === 'clean' ? `<button class="btn btn-sm btn-green" onclick="approvePr(${pr.id}, this)">Approve</button>` : ''}
          ${pr.status === 'approved' ? `<button class="btn btn-sm btn-danger" onclick="unapprovePr(${pr.id}, this)">Unapprove</button>` : ''}
          ${(pr.status === 'approved' || pr.review_decision === 'APPROVED') && !pr.is_running ? `<button class="btn btn-sm btn-purple" onclick="mergePr(${pr.id}, this)">Merge</button>` : ''}
          ${pr.is_running
            ? `<button class="btn btn-sm btn-danger" onclick="cancelReview(${pr.id})">Cancel</button>`
            : `<button class="btn btn-sm btn-primary" onclick="triggerReview(${pr.id})">
                ${pr.latest_cycle ? 'Re-review' : 'Review'}
              </button>`
          }
      </td>
    </tr>
  `).join('');

  if (footer) footer.textContent = `Showing ${prs.length} PR(s)`;
}

// Quick filter from clicking values in the table
function applyFilter(key, value) {
  const filters = getFiltersFromUrl();
  filters[key] = value;
  setFiltersToUrl(filters);
  setFormFromFilters(filters);
  fetchAndRender();
}

async function loadDashboard() {
  const statsEl = document.getElementById('stats-bar');
  if (!statsEl) return;

  // Load filter options (authors, labels, etc.)
  await loadFilterOptions();

  // Restore filters from URL, or apply defaults on first visit
  const urlFilters = getFiltersFromUrl();
  const hasFilters = Object.keys(urlFilters).length > 0;
  if (!hasFilters) {
    // Default: Ready only + CI Passed
    urlFilters.draft = '0';
    urlFilters.ci_status = 'pass';
    setFiltersToUrl(urlFilters);
  }
  setFormFromFilters(urlFilters);

  // Bind filter change events
  for (const key of FILTER_KEYS) {
    const el = document.getElementById(`f-${key}`);
    if (!el) continue;

    const eventType = el.tagName === 'INPUT' ? 'input' : 'change';
    let debounceTimer = null;

    el.addEventListener(eventType, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const delay = el.tagName === 'INPUT' ? 300 : 0;

      debounceTimer = setTimeout(() => {
        const filters = getFiltersFromForm();
        setFiltersToUrl(filters);
        renderFilterSummary(filters);
        fetchAndRender();
      }, delay);
    });
  }

  // Initial render
  await fetchAndRender();

  // Polling
  setInterval(async () => {
    const statusRes = await fetch(`${API}/api/status`);
    const status = await statusRes.json();
    const interval = status.running ? 3000 : 30000;

    if (!window._lastFetch || Date.now() - window._lastFetch > interval) {
      window._lastFetch = Date.now();
      await fetchAndRender();
    }
  }, 3000);
}

// =============================================================
// Actions
// =============================================================

async function cancelReview(prId) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Cancelling...';

  try {
    const res = await fetch(`${API}/api/trigger/cancel/review-${prId}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok || data.error === 'Job already finished') {
      btn.textContent = res.ok ? 'Cancelled' : 'Done';
      setTimeout(() => {
        if (typeof fetchAndRender === 'function') fetchAndRender();
        const container = document.getElementById('pr-detail');
        if (container) location.reload();
      }, 500);
    } else {
      alert(data.error || 'Failed to cancel');
      btn.disabled = false;
      btn.textContent = 'Cancel';
    }
  } catch (err) {
    alert('Failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}

async function triggerReview(prId, redirectToDetail) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const res = await fetch(`${API}/api/trigger/review/${prId}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      btn.textContent = 'Running...';
      // Refresh the table so it shows the running state
      if (typeof fetchAndRender === 'function' && !document.getElementById('pr-detail')) {
        setTimeout(() => fetchAndRender(), 1000);
      }
    } else {
      alert(data.error || 'Failed to start review');
      btn.disabled = false;
      btn.textContent = 'Review';
    }
  } catch (err) {
    alert('Failed to trigger review: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Review';
  }
}

async function triggerDiscover() {
  const btn = document.getElementById('btn-discover');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running...';
  }

  try {
    const res = await fetch(`${API}/api/trigger/discover`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to start discovery');
      if (btn) { btn.disabled = false; btn.textContent = 'Discover & Review'; }
    }
  } catch (err) {
    alert('Failed: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Discover & Review'; }
  }
}

async function approvePr(prId, btn) {
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    const res = await fetch(`${API}/api/trigger/approve/${prId}`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      const failures = [];
      if (data.checks) {
        if (data.checks.ci_passing === false) failures.push('CI not passing');
        if (data.checks.no_conflicts === false) failures.push('Merge conflicts');
        if (data.checks.status_clean === false) failures.push('PR not in clean status');
      }
      alert(failures.length > 0 ? `Approval blocked:\n- ${failures.join('\n- ')}` : (data.error || 'Approval failed'));
      btn.disabled = false;
      btn.textContent = 'Approve';
      return;
    }

    btn.textContent = 'Approved';
    btn.classList.add('btn-green');

    // Re-render detail page with fresh data
    const container = document.getElementById('pr-detail');
    if (container) {
      const freshRes = await fetch(`${API}/api/prs/${prId}`);
      if (freshRes.ok) {
        const freshPr = await freshRes.json();
        renderPrDetail(freshPr, container);
      }
    }
  } catch (err) {
    alert('Failed to approve: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Approve';
  }
}

async function mergePr(prId, btn) {
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    // 1. Fetch pre-flight checks
    const preflight = await fetch(`${API}/api/trigger/merge-preflight/${prId}`);
    const data = await preflight.json();

    // 2. Build confirmation dialog content
    const checksHtml = data.checks.map(c => {
      const icon = c.pass ? '<span style="color:var(--green)">PASS</span>' : '<span style="color:var(--red)">FAIL</span>';
      return `${icon}  ${c.name}${c.bucket && !c.pass ? ' (' + c.bucket + ')' : ''}`;
    }).join('\n');

    const summary = data.allPass
      ? `All ${data.checks.length} checks passing.`
      : `${data.failCount} of ${data.checks.length} checks failing.`;

    const confirmed = confirm(`Pre-merge checks for PR #${prId}:\n\n${checksHtml}\n\n${summary}\n\nProceed with squash merge?`);

    if (!confirmed) {
      btn.disabled = false;
      btn.textContent = 'Merge';
      return;
    }

    // 3. Execute merge
    btn.textContent = 'Merging...';
    const mergeRes = await fetch(`${API}/api/trigger/merge/${prId}`, { method: 'POST' });
    const mergeData = await mergeRes.json();

    if (mergeRes.ok) {
      btn.textContent = 'Merged';
      // Re-render
      const container = document.getElementById('pr-detail');
      if (container) {
        const freshRes = await fetch(`${API}/api/prs/${prId}`);
        if (freshRes.ok) {
          const freshPr = await freshRes.json();
          renderPrDetail(freshPr, container);
        }
      } else {
        await fetchAndRender();
      }
    } else {
      alert(mergeData.error || 'Merge failed');
      btn.disabled = false;
      btn.textContent = 'Merge';
    }
  } catch (err) {
    alert('Failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Merge';
  }
}

async function unapprovePr(prId, btn) {
  btn.disabled = true;
  btn.textContent = 'Unapproving...';

  try {
    const res = await fetch(`${API}/api/trigger/unapprove/${prId}`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Unapprove failed');
      btn.disabled = false;
      btn.textContent = 'Unapprove';
      return;
    }

    btn.textContent = 'Unapproved';

    const container = document.getElementById('pr-detail');
    if (container) {
      const freshRes = await fetch(`${API}/api/prs/${prId}`);
      if (freshRes.ok) {
        const freshPr = await freshRes.json();
        renderPrDetail(freshPr, container);
      }
    } else {
      await fetchAndRender();
    }
  } catch (err) {
    alert('Failed to unapprove: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Unapprove';
  }
}

async function syncPr(prId, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  btn.classList.add('syncing');

  try {
    const res = await fetch(`${API}/api/prs/${prId}/sync`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Sync failed');
    }
    btn.textContent = 'Done';

    // If on detail page, re-render it with fresh data
    const container = document.getElementById('pr-detail');
    if (container) {
      const pr = await res.json().catch(() => null);
      // Re-fetch full data since response was already consumed
      const freshRes = await fetch(`${API}/api/prs/${prId}`);
      if (freshRes.ok) {
        const freshPr = await freshRes.json();
        renderPrDetail(freshPr, container);
      }
    } else {
      await fetchAndRender();
    }
  } catch (err) {
    btn.textContent = 'Failed';
    console.error(`Sync PR #${prId} failed:`, err);
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = origText;
      btn.classList.remove('syncing');
    }, 2000);
  }
}

async function forceSync() {
  try {
    const res = await fetch(`${API}/api/sync`, { method: 'POST' });
    const data = await res.json();
    alert(`Synced ${data.synced} PR files + GitHub`);
    location.reload();
  } catch (err) {
    alert('Sync failed: ' + err.message);
  }
}

// =============================================================
// PR Detail Page
// =============================================================

let _liveLogInterval = null;
let _liveLogLinesSeen = 0;

async function loadPrDetail() {
  const container = document.getElementById('pr-detail');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const prId = params.get('pr');
  if (!prId) {
    container.innerHTML = '<div class="empty-state"><h3>No PR specified</h3><p>Add ?pr=123 to the URL</p></div>';
    return;
  }

  try {
    const res = await fetch(`${API}/api/prs/${prId}`);
    if (!res.ok) {
      container.innerHTML = `<div class="empty-state"><h3>PR #${prId} not found</h3><p>It may not have been synced yet. Try clicking Sync.</p></div>`;
      return;
    }

    const pr = await res.json();
    renderPrDetail(pr, container);

    // Check for active job and start live log polling
    checkAndStartLiveLog(prId);

    // Poll for PR status changes
    setInterval(async () => {
      const statusRes = await fetch(`${API}/api/status`);
      const status = await statusRes.json();
      if (status.running && status.pr === parseInt(prId)) {
        // Re-check live log if not already polling
        if (!_liveLogInterval) checkAndStartLiveLog(prId);
      }
    }, 5000);

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error loading PR</h3><p>${err.message}</p></div>`;
  }
}

async function checkAndStartLiveLog(prId) {
  try {
    const jobsRes = await fetch(`${API}/api/trigger/jobs`);
    const jobs = await jobsRes.json();
    const jobId = `review-${prId}`;
    if (jobs[jobId]) {
      startLiveLogPolling(jobId);
    }
  } catch {}
}

function startLiveLogPolling(jobId) {
  if (_liveLogInterval) return; // already polling

  _liveLogLinesSeen = 0;
  const startTime = Date.now();

  async function poll() {
    try {
      const res = await fetch(`${API}/api/trigger/log/${jobId}?after=${_liveLogLinesSeen}`);
      if (!res.ok) return;

      const data = await res.json();
      const section = document.getElementById('live-review-section');
      if (!section) return;

      // Show the section
      section.style.display = '';

      const content = document.getElementById('live-review-content');
      const statusEl = document.getElementById('live-review-status');
      const footerEl = document.getElementById('live-review-footer');

      if (data.lines.length > 0) {
        for (const line of data.lines) {
          const div = document.createElement('div');
          div.className = 'live-log-line' + (line.startsWith('[stderr]') || line.startsWith('[error]') ? ' live-log-error' : '');
          div.textContent = line;
          content.appendChild(div);
        }
        _liveLogLinesSeen = data.total;
        content.scrollTop = content.scrollHeight;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      footerEl.textContent = `${_liveLogLinesSeen} lines | ${formatDuration(elapsed)}`;

      if (data.done) {
        clearInterval(_liveLogInterval);
        _liveLogInterval = null;
        const success = data.exitCode === 0;
        statusEl.innerHTML = success
          ? '<span class="badge badge-green">Completed</span>'
          : `<span class="badge badge-red">Failed (exit ${data.exitCode})</span>`;
        footerEl.textContent += success ? ' | Review posted' : ' | Check logs for errors';

        // Refresh the whole detail page after a short delay
        setTimeout(async () => {
          const prId = new URLSearchParams(window.location.search).get('pr');
          const freshRes = await fetch(`${API}/api/prs/${prId}`);
          if (freshRes.ok) {
            const freshPr = await freshRes.json();
            const container = document.getElementById('pr-detail');
            if (container) renderPrDetail(freshPr, container);
          }
        }, 2000);
      }
    } catch (err) {
      console.error('Live log poll error:', err);
    }
  }

  poll();
  _liveLogInterval = setInterval(poll, 1500);
}

function renderPrDetail(pr, container) {
  const cyclesHtml = (pr.cycles || []).map(c => `
    <div class="cycle-card ${c.status || 'completed'}">
      <div class="cycle-header">
        <h3>Cycle ${c.cycle_number} <span class="badge badge-gray">${c.type || 'Fresh'}</span></h3>
        ${actionBadge(c.action_taken)}
      </div>
      <div class="cycle-details">
        <div><strong>Started:</strong> ${c.started_at || '-'}</div>
        <div><strong>Ended:</strong> ${c.ended_at || '-'}</div>
        <div><strong>Duration:</strong> ${formatDuration(c.duration_seconds)}</div>
        <div><strong>Commit:</strong> <code>${c.commit_sha ? c.commit_sha.slice(0, 7) : '-'}</code></div>
        <div><strong>Gates:</strong> ${esc(c.gates) || '-'}</div>
        <div><strong>Areas:</strong> ${esc(c.areas_changed) || '-'}</div>
      </div>
      ${c.summary ? `
        <div class="cycle-summary">
          <strong>Summary</strong>
          <p>${esc(c.summary)}</p>
        </div>
      ` : ''}
      <div style="margin-top:12px">
        <div class="findings" style="margin-bottom:8px">
          <span class="f-crit">${c.findings_critical || 0} critical</span>
          <span class="f-major">${c.findings_major || 0} major</span>
          <span class="f-minor">${c.findings_minor || 0} minor</span>
        </div>
        ${c.github_review_url ? `<a href="${c.github_review_url}" target="_blank" class="btn btn-sm">View on GitHub</a>` : ''}
      </div>
      ${c.coderabbit_dedup ? `<details style="margin-top:8px"><summary style="color:var(--text-muted);font-size:13px;cursor:pointer">CodeRabbit dedup</summary><p style="font-size:13px;color:var(--text-muted);margin-top:4px">${esc(c.coderabbit_dedup)}</p></details>` : ''}
      ${c.resolution_actions ? `<details style="margin-top:8px"><summary style="color:var(--text-muted);font-size:13px;cursor:pointer">Resolution actions</summary><p class="cycle-note">${esc(c.resolution_actions)}</p></details>` : ''}
    </div>
  `).join('');

  const isDraft = pr.gh_is_draft || pr.is_draft;
  const totalFindings = (pr.cycles || []).reduce((sum, c) => sum + (c.findings_critical || 0) + (c.findings_major || 0) + (c.findings_minor || 0), 0);

  container.innerHTML = `
    <a href="/" class="back-link">< Back to Dashboard</a>

    <div class="pr-header">
      <h2>#${pr.id} ${esc(pr.title) || 'Untitled'} ${isDraft ? '<span class="badge badge-purple">draft</span>' : ''}</h2>
      <div class="pr-meta">
        <div><strong>Author:</strong> ${esc(pr.author) || '-'} ${memberBadge(pr.is_member)}</div>
        <div><strong>Branch:</strong> ${esc(pr.branch)} -> ${esc(pr.base_branch)}</div>
        <div><strong>Created:</strong> ${pr.created_at ? new Date(pr.created_at).toLocaleString() : '-'}</div>
        <div><strong>Updated:</strong> ${pr.updated_at_gh ? timeAgo(pr.updated_at_gh) : '-'}</div>
        ${pr.url ? `<div><a href="${pr.url}" target="_blank">View on GitHub</a></div>` : ''}
      </div>

      <div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Status</div>
          <div style="font-size:14px;margin-top:4px">${statusBadge(pr.status)}</div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Checks</div>
          <div style="font-size:16px;margin-top:4px">${ciBadge(pr)}</div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Mergeable</div>
          <div style="font-size:14px;margin-top:4px">${mergeableBadge(pr.mergeable)}</div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Diff</div>
          <div style="font-size:14px;margin-top:4px">${diffStat(pr.additions, pr.deletions, pr.changed_files)}</div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Review Decision</div>
          <div style="font-size:14px;margin-top:4px">${reviewDecisionBadge(pr.review_decision)}</div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Merge State</div>
          <div style="font-size:14px;margin-top:4px"><span class="badge badge-gray">${pr.merge_state_status || '-'}</span></div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Review Cycles</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">${(pr.cycles || []).length}</div>
        </div>
        <div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Findings</div>
          <div style="font-size:14px;margin-top:4px">${totalFindings > 0 ? `<span style="color:var(--red)">${totalFindings}</span>` : '<span style="color:var(--green)">0</span>'}</div>
        </div>
        ${pr.labels ? `<div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Labels</div>
          <div style="font-size:13px;margin-top:4px">${labelBadges(pr.labels)}</div>
        </div>` : ''}
        ${pr.reviewers ? `<div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Reviewers</div>
          <div style="font-size:13px;margin-top:4px">${esc(pr.reviewers)}</div>
        </div>` : ''}
        ${pr.assignees ? `<div class="stat-card" style="padding:12px">
          <div style="font-size:12px;color:var(--text-muted)">Assignees</div>
          <div style="font-size:13px;margin-top:4px">${esc(pr.assignees)}</div>
        </div>` : ''}
      </div>

      <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
        <button class="btn" onclick="syncPr(${pr.id}, this)">Sync</button>
        ${pr.status === 'clean' && !pr.is_running
          ? `<button class="btn btn-green" onclick="approvePr(${pr.id}, this)">Approve</button>`
          : ''}
        ${pr.status === 'approved'
          ? `<button class="btn btn-danger" onclick="unapprovePr(${pr.id}, this)">Unapprove</button>`
          : ''}
        ${(pr.status === 'approved' || pr.review_decision === 'APPROVED') && !pr.is_running
          ? `<button class="btn btn-purple" onclick="mergePr(${pr.id}, this)">Merge</button>`
          : ''}
        ${pr.is_running
          ? `<button class="btn btn-danger" onclick="cancelReview(${pr.id})">Cancel Review</button>
             <span class="running-indicator"><span class="running-dot"></span>Reviewing${pr.running_phase ? ' (Phase ' + pr.running_phase + ')' : ''}...</span>`
          : `<button class="btn btn-primary" onclick="triggerReview(${pr.id}, false)">
              ${(pr.cycles || []).length > 0 ? 'Trigger Re-review' : 'Trigger Review'}
            </button>`
        }
      </div>
    </div>

    <div class="section" id="live-review-section" style="display:none">
      <div class="section-header">
        <h3>Live Review Output</h3>
        <span id="live-review-status" class="running-indicator"><span class="running-dot"></span> Running...</span>
      </div>
      <div class="live-log-content" id="live-review-content"></div>
      <div class="live-log-footer" id="live-review-footer">0 lines</div>
    </div>

    <div class="section">
      <div class="section-header">
        <h3>Checks</h3>
        ${pr.ci_total ? `<span class="badge badge-gray">${pr.ci_pass}/${pr.ci_total} passing</span>` : ''}
      </div>
      <div id="ci-checks-section">${pr.ci_total ? 'Loading...' : '<p style="color:var(--text-muted)">No checks data</p>'}</div>
    </div>

    <div class="section">
      <div class="section-header">
        <h3>Review Timeline</h3>
        <span class="badge badge-gray">${(pr.cycles || []).length} cycle(s)</span>
      </div>
      ${(pr.cycles || []).length > 0 ? `<div class="timeline">${cyclesHtml}</div>` : '<div class="empty-state">No reviews yet</div>'}
    </div>

    <div class="section">
      <div class="section-header">
        <h3>Tracking File</h3>
        <div>
          <button class="btn btn-sm tab-btn active" data-tab="rendered" onclick="switchTab('tracking', 'rendered', this)">Rendered</button>
          <button class="btn btn-sm tab-btn" data-tab="raw" onclick="switchTab('tracking', 'raw', this)">Raw</button>
        </div>
      </div>
      <div id="tracking-rendered" class="md-content">Loading...</div>
      <div id="tracking-raw" class="log-viewer" style="display:none">Loading...</div>
    </div>

    <div class="section">
      <div class="section-header">
        <h3>Logs</h3>
      </div>
      <div id="logs-section">Loading...</div>
    </div>
  `;

  loadCiChecks(pr.id);
  loadTrackingFile(pr.id);
  loadLogs(pr.id);
}

async function loadCiChecks(prId) {
  const section = document.getElementById('ci-checks-section');
  if (!section) return;

  try {
    const res = await fetch(`${API}/api/prs/${prId}/checks`);
    if (!res.ok) { section.innerHTML = '<p style="color:var(--text-muted)">No CI data</p>'; return; }

    const data = await res.json();
    if (!data.checks || data.checks.length === 0) {
      section.innerHTML = '<p style="color:var(--text-muted)">No CI checks found</p>';
      return;
    }

    // Sort: failures first, then pending, then pass
    const order = { fail: 0, pending: 1, queued: 1, skipping: 2, cancel: 2, pass: 3 };
    data.checks.sort((a, b) => (order[a.bucket] ?? 9) - (order[b.bucket] ?? 9));

    const bucketBadge = (b) => {
      const map = { pass: 'badge-green', fail: 'badge-red', pending: 'badge-yellow', queued: 'badge-yellow', skipping: 'badge-gray', cancel: 'badge-gray' };
      return `<span class="badge ${map[b] || 'badge-gray'}">${b}</span>`;
    };

    const duration = (start, end) => {
      if (!start || !end) return '-';
      const s = Math.round((new Date(end) - new Date(start)) / 1000);
      if (s < 60) return `${s}s`;
      return `${Math.floor(s / 60)}m ${s % 60}s`;
    };

    section.innerHTML = `
      <div class="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Workflow</th>
              <th>Duration</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            ${data.checks.map(c => `
              <tr>
                <td>${esc(c.name)}</td>
                <td>${bucketBadge(c.bucket)}</td>
                <td style="color:var(--text-muted)">${esc(c.workflow || '-')}</td>
                <td>${duration(c.startedAt, c.completedAt)}</td>
                <td>${c.link ? `<a href="${c.link}" target="_blank" class="btn btn-sm">Details</a>` : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    section.innerHTML = `<p style="color:var(--text-muted)">Error: ${err.message}</p>`;
  }
}

async function loadTrackingFile(prId) {
  try {
    const [htmlRes, rawRes] = await Promise.all([
      fetch(`${API}/api/prs/${prId}/tracking/html`),
      fetch(`${API}/api/prs/${prId}/tracking`),
    ]);

    const renderedEl = document.getElementById('tracking-rendered');
    const rawEl = document.getElementById('tracking-raw');

    if (htmlRes.ok) {
      renderedEl.innerHTML = await htmlRes.text();
    } else {
      renderedEl.innerHTML = '<p style="color:var(--text-muted)">No tracking file yet — this PR hasn\'t been reviewed.</p>';
    }

    if (rawRes.ok) {
      rawEl.textContent = await rawRes.text();
    } else {
      rawEl.textContent = 'No tracking file yet';
    }
  } catch (err) {
    console.error('Failed to load tracking file:', err);
  }
}

async function loadLogs(prId) {
  const section = document.getElementById('logs-section');
  try {
    const res = await fetch(`${API}/api/prs/${prId}/logs`);
    if (!res.ok) { section.innerHTML = '<p style="color:var(--text-muted)">No logs found</p>'; return; }

    const logs = await res.json();
    if (logs.length === 0) { section.innerHTML = '<p style="color:var(--text-muted)">No logs yet</p>'; return; }

    section.innerHTML = logs.map((log, i) => `
      <details style="margin-bottom:8px" ${i === logs.length - 1 ? 'open' : ''}>
        <summary style="cursor:pointer;padding:8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius)">${log.filename} (${(log.size / 1024).toFixed(1)} KB)</summary>
        <div class="log-viewer" id="log-${i}">Loading...</div>
      </details>
    `).join('');

    logs.forEach((log, i) => {
      const details = section.querySelectorAll('details')[i];
      details.addEventListener('toggle', async () => {
        const viewer = document.getElementById(`log-${i}`);
        if (details.open && viewer.textContent === 'Loading...') {
          try {
            const logRes = await fetch(`${API}/api/prs/${prId}/log/${i + 1}`);
            viewer.textContent = logRes.ok ? await logRes.text() : 'Failed to load log';
          } catch {
            viewer.textContent = 'Failed to load log';
          }
        }
      });
    });

  } catch (err) {
    section.innerHTML = `<p style="color:var(--text-muted)">Error: ${err.message}</p>`;
  }
}

function switchTab(section, tab, btn) {
  const rendered = document.getElementById(`${section}-rendered`);
  const raw = document.getElementById(`${section}-raw`);

  if (tab === 'rendered') {
    rendered.style.display = '';
    raw.style.display = 'none';
  } else {
    rendered.style.display = 'none';
    raw.style.display = '';
  }

  btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// =============================================================
// Init
// =============================================================

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadPrDetail();
});
