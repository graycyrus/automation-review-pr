#!/bin/bash
# Automated PR Reviewer — discovers eligible PRs, reviews them via review-single.sh
# Cron: 0 * * * * /Users/cyrus/Desktop/automation/review-pr/cron-pr-review.sh

set -euo pipefail

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${REPO_DIR:-/Users/cyrus/Desktop/Code/tinyhuman/openhuman.ai/openhuman}"
LOG_DIR="${SCRIPT_DIR}/logs"
DISCOVER_PROMPT="${SCRIPT_DIR}/discover-prompt.md"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M")
LOG_FILE="${LOG_DIR}/review-${TIMESTAMP}.log"
CRON_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Ensure PATH includes required tools (cron has minimal PATH)
export PATH="/Users/cyrus/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"
export HOME="/Users/cyrus"
export CRON_MODE=1

# Load .env
if [ -f "${SCRIPT_DIR}/.env" ]; then
    set -a; source "${SCRIPT_DIR}/.env"; set +a
fi

mkdir -p "${LOG_DIR}"
mkdir -p "${SCRIPT_DIR}/to-be-approved"
mkdir -p "${SCRIPT_DIR}/tinyhumansai-openhuman"

log() { echo "[$(date +"%H:%M:%S")] $*" | tee -a "${LOG_FILE}"; }

log "=== PR Review Cron — ${TIMESTAMP} ==="

for cmd in claude gh; do
    if ! command -v "$cmd" &>/dev/null; then
        log "ERROR: ${cmd} not found"
        exit 1
    fi
done

# Get authenticated GitHub username
GH_USER=$(gh api user --jq '.login' 2>/dev/null || echo "")
if [ -z "${GH_USER}" ]; then
    log "ERROR: Could not determine GitHub username — is gh authenticated?"
    exit 1
fi
log "Authenticated as: ${GH_USER}"

# ─── Pre-check: Skip if no open PRs (avoids LLM call) ───
OPEN_COUNT=$(gh pr list --repo tinyhumansai/openhuman --state open --json number --jq length 2>/dev/null || echo "0")
if [ "${OPEN_COUNT}" = "0" ]; then
    log "No open PRs found. Done."
    exit 0
fi
log "Found ${OPEN_COUNT} open PR(s) — proceeding with discovery"

# ─── Phase 1: Discover eligible PRs (pure bash — zero LLM cost) ───
log "Phase 1: Discovering eligible PRs..."

# Get all open non-draft PRs with review-requested info for prioritization
ALL_PRS_JSON=$(gh pr list --repo tinyhumansai/openhuman --state open --json number,isDraft,author,reviewRequests --jq '[.[] | select(.isDraft == false)]' 2>/dev/null || echo "[]")
if [ "${ALL_PRS_JSON}" = "[]" ] || [ -z "${ALL_PRS_JSON}" ]; then
    log "No open non-draft PRs found. Done."
    exit 0
fi

# Split into priority (tagged as reviewer) and rest
PRIORITY_PRS=$(echo "${ALL_PRS_JSON}" | jq -r '[.[] | select(.reviewRequests[]?.login == "'"${GH_USER}"'")] | .[].number' 2>/dev/null || echo "")
OTHER_PRS=$(echo "${ALL_PRS_JSON}" | jq -r '[.[] | select(([.reviewRequests[]?.login] | index("'"${GH_USER}"'")) == null)] | .[].number' 2>/dev/null || echo "")

PRIORITY_COUNT=$(echo "${PRIORITY_PRS}" | grep -c '[0-9]' 2>/dev/null || echo "0")
if [ "${PRIORITY_COUNT}" -gt 0 ]; then
    log "Priority PRs (reviewer-tagged): $(echo ${PRIORITY_PRS} | tr '\n' ' ')"
fi

# Combine: priority first, then rest
ALL_PRS=$(printf "%s\n%s" "${PRIORITY_PRS}" "${OTHER_PRS}" | grep '[0-9]' || echo "")
if [ -z "${ALL_PRS}" ]; then
    log "No open non-draft PRs found. Done."
    exit 0
fi

PRS=()
for PR_NUM in ${ALL_PRS}; do
    # Skip own PRs
    PR_AUTHOR_CHECK=$(gh pr view "${PR_NUM}" --repo tinyhumansai/openhuman --json author --jq '.author.login' 2>/dev/null || echo "")
    if [ "${PR_AUTHOR_CHECK}" = "${GH_USER}" ]; then
        continue
    fi

    # Skip if already in approved/to-be-approved/already-merged
    if [ -f "${SCRIPT_DIR}/approved/PR-${PR_NUM}.md" ] || \
       [ -f "${SCRIPT_DIR}/to-be-approved/PR-${PR_NUM}.md" ] || \
       [ -f "${SCRIPT_DIR}/already-merged/PR-${PR_NUM}.md" ]; then
        continue
    fi

    # Skip if already approved on GitHub by a non-bot
    HUMAN_APPROVALS=$(gh api "repos/tinyhumansai/openhuman/pulls/${PR_NUM}/reviews" --jq '[.[] | select(.state == "APPROVED" and (.user.login | test("\\[bot\\]$") | not))] | length' 2>/dev/null || echo "0")
    if [ "${HUMAN_APPROVALS}" -gt 0 ] 2>/dev/null; then
        continue
    fi

    # Skip if no new commits since last review
    if [ -f "${SCRIPT_DIR}/tinyhumansai-openhuman/PR-${PR_NUM}.md" ]; then
        LATEST=$(gh pr view "${PR_NUM}" --repo tinyhumansai/openhuman --json commits --jq '.commits[-1].oid' 2>/dev/null || echo "")
        LAST_REVIEWED=$(grep -m1 'Last reviewed commit' "${SCRIPT_DIR}/tinyhumansai-openhuman/PR-${PR_NUM}.md" 2>/dev/null | sed 's/.*: *//' || echo "")
        if [ -n "${LATEST}" ] && [ "${LATEST}" = "${LAST_REVIEWED}" ]; then
            continue
        fi
    fi

    PRS+=("${PR_NUM}")
done

if [ "${#PRS[@]}" -eq 0 ]; then
    log "No eligible PRs found. Done."
    exit 0
fi
log "Found ${#PRS[@]} eligible PR(s): ${PRS[*]}"

# Limit reviews per cycle (remaining PRs picked up next cycle)
MAX_REVIEWS=${MAX_REVIEWS:-5}
if [ "${#PRS[@]}" -gt "${MAX_REVIEWS}" ]; then
    log "Capping to ${MAX_REVIEWS} reviews this cycle (${#PRS[@]} eligible, rest next cycle)"
    PRS=("${PRS[@]:0:${MAX_REVIEWS}}")
fi

# ─── Git: pull latest before reviews ───
log "Git: Pulling latest changes..."
cd "${SCRIPT_DIR}"
git stash --quiet 2>/dev/null || true
git pull --rebase origin main || log "Git: Pull failed, continuing anyway"
git stash pop --quiet 2>/dev/null || true

# ─── Phase 2: Review PRs in parallel via review-single.sh ───
log "Phase 2: Launching reviews in parallel..."

REVIEW_PIDS=()
for PR in "${PRS[@]}"; do
    REVIEW_LOG="${LOG_DIR}/review-PR-${PR}-${TIMESTAMP}.log"
    log "  Starting review of PR #${PR}"

    bash "${SCRIPT_DIR}/review-single.sh" "${PR}" >"${REVIEW_LOG}" 2>&1 &
    REVIEW_PIDS+=($!)
done

# Wait for all reviews
FAILED=0
for i in "${!REVIEW_PIDS[@]}"; do
    PID=${REVIEW_PIDS[$i]}
    PR=${PRS[$i]}
    EXIT_CODE=0
    wait "${PID}" || EXIT_CODE=$?
    REVIEW_LOG="${LOG_DIR}/review-PR-${PR}-${TIMESTAMP}.log"
    if [ "${EXIT_CODE}" -eq 0 ]; then
        log "  PR #${PR}: review completed"
    elif [ "${EXIT_CODE}" -eq 2 ]; then
        log "  PR #${PR}: RATE LIMITED — stopping all reviews"
        FAILED=$((FAILED + 1))
        RATE_LIMITED=true
    else
        log "  PR #${PR}: review FAILED (exit ${EXIT_CODE})"
        FAILED=$((FAILED + 1))
    fi
done

# Check if any review hit rate limit — abort remaining phases
if [ "${RATE_LIMITED:-false}" = "true" ]; then
    log ""
    log "=== RATE LIMITED — skipping judge and git phases ==="
    log "Cron will retry next cycle."
    CRON_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    log "CRON_META: started=${CRON_START} ended=${CRON_END} discovered=${#PRS[@]} reviewed=0 failed=${FAILED}"
    exit 0
fi

# ─── Summary ───
log ""
log "=== Summary ==="
log "Discovered: ${#PRS[@]} PR(s)"
log "Succeeded: $((${#PRS[@]} - FAILED))"
log "Failed: ${FAILED}"
log ""

for PR in "${PRS[@]}"; do
    REVIEW_LOG="${LOG_DIR}/review-PR-${PR}-${TIMESTAMP}.log"
    if [ -f "${REVIEW_LOG}" ]; then
        SUMMARY=$(grep -E "^PR #${PR}:" "${REVIEW_LOG}" 2>/dev/null | tail -1)
        if [ -n "${SUMMARY}" ]; then
            log "  ${SUMMARY}"
        fi
    fi
done

# ─── Phase 3: Batch judge every 25 reviews ───
REVIEWED_COUNT=$((${#PRS[@]} - FAILED))
COUNTER_FILE="${SCRIPT_DIR}/.review-counter"
COUNTER_LOCK="/tmp/review-counter.lock"
# Atomic counter update with lock
(
    mkdir "${COUNTER_LOCK}" 2>/dev/null || sleep 1 && mkdir "${COUNTER_LOCK}" 2>/dev/null || true
    PREV_COUNT=0
    if [ -f "${COUNTER_FILE}" ]; then
        PREV_COUNT=$(cat "${COUNTER_FILE}" 2>/dev/null || echo "0")
    fi
    NEW_COUNT=$((PREV_COUNT + REVIEWED_COUNT))
    echo "${NEW_COUNT}" > "${COUNTER_FILE}.tmp" && mv "${COUNTER_FILE}.tmp" "${COUNTER_FILE}"
    rmdir "${COUNTER_LOCK}" 2>/dev/null || true
)
PREV_COUNT=$(($(cat "${COUNTER_FILE}" 2>/dev/null || echo "0") - REVIEWED_COUNT))
NEW_COUNT=$(cat "${COUNTER_FILE}" 2>/dev/null || echo "0")
log "Review counter: ${PREV_COUNT} + ${REVIEWED_COUNT} = ${NEW_COUNT} (triggers batch judge at 25)"

BATCH_JUDGE_THRESHOLD=${BATCH_JUDGE_THRESHOLD:-25}
if [ "${NEW_COUNT}" -ge "${BATCH_JUDGE_THRESHOLD}" ]; then
    log "=== Batch Judge triggered (${NEW_COUNT} reviews since last judge) ==="

    # Collect all PRs reviewed since last batch judge
    BATCH_PR_LIST=$(find "${LOG_DIR}" -name "judge-PR-*.md" -newer "${COUNTER_FILE}.last" 2>/dev/null | grep -oE 'PR-[0-9]+' | grep -oE '[0-9]+' | sort -u | tr '\n' ' ')
    if [ -z "${BATCH_PR_LIST}" ]; then
        # Fallback: use recent tracking files
        BATCH_PR_LIST=$(find "${SCRIPT_DIR}/tinyhumansai-openhuman" "${SCRIPT_DIR}/to-be-approved" "${SCRIPT_DIR}/approved" -name "PR-*.md" -mtime -7 2>/dev/null | grep -oE 'PR-[0-9]+' | grep -oE '[0-9]+' | sort -rn | head -25 | tr '\n' ' ')
    fi

    if [ -n "${BATCH_PR_LIST}" ]; then
        BATCH_JUDGE_PROMPT="You are a batch quality judge for automated PR reviewer ${GH_USER} on tinyhumansai/openhuman. ${NEW_COUNT} reviews have been posted since the last batch audit. Judge them ALL.

For each PR in: ${BATCH_PR_LIST}

Fetch the review and PR metadata:
\`\`\`bash
gh api repos/tinyhumansai/openhuman/pulls/<N>/reviews --jq '.[] | select(.user.login == \"${GH_USER}\") | {state: .state, body: .body}'
gh pr view <N> --repo tinyhumansai/openhuman --json title,additions,deletions,changedFiles
gh pr checks <N> --repo tinyhumansai/openhuman --json name,bucket --jq '[.[] | select(.bucket != \"pass\" and .bucket != \"skipping\")] | length'
\`\`\`

Score each: Accuracy (0-10), Depth (0-10), Tone (0-10), Decision correct?
Flag: hallucinations, system prompt leaks (cooldowns, tracking files, merge timers, internal paths), emoji, approving over human CHANGES_REQUESTED, approving with failing/cancelled CI, rubber-stamp re-reviews.

Find PATTERNS across multiple reviews (not one-offs).

Read the reviewer identity:
\`\`\`bash
cat ${SCRIPT_DIR}/reviewers/cyrus.md
\`\`\`

If patterns found (3+ reviews), update cyrus.md. NEVER remove/weaken security rules — write proposals to logs/ instead.

Write report to: ${LOG_DIR}/batch-judge-${TIMESTAMP}.md
Write improvement signals to: ${LOG_DIR}/improvement-history.md (append)"

        BATCH_LOG="${LOG_DIR}/batch-judge-${TIMESTAMP}.log"
        BATCH_START=$(date +%s)
        claude -p "${BATCH_JUDGE_PROMPT}" \
            --model "${MODEL_JUDGE:-haiku}" \
            --max-budget-usd 0.25 \
            --allowedTools "Bash,Read,Write" \
            >"${BATCH_LOG}" 2>&1 || log "  Batch judge failed"
        BATCH_END=$(date +%s)
        log "  Batch judge completed in $((BATCH_END - BATCH_START))s"

        # Reset counter
        echo "0" > "${COUNTER_FILE}"
        touch "${COUNTER_FILE}.last"
        log "  Counter reset to 0"
    else
        log "  No PRs found for batch judge — skipping"
    fi
fi

# ─── Phase 4: Aggregate per-PR judge findings + self-improve ───
if [ "${REVIEWED_COUNT}" -gt 0 ]; then
    log "Phase 4: Aggregating per-PR judge findings..."
    JUDGE_PROMPT="${SCRIPT_DIR}/judge-prompt.md"
    if [ -f "${JUDGE_PROMPT}" ]; then
        PR_LIST=$(printf "%s " "${PRS[@]}")
        JUDGE_INPUT=$(cat "${JUDGE_PROMPT}" | sed "s/__PR_LIST__/${PR_LIST}/g" | sed "s/__PR_COUNT__/${REVIEWED_COUNT}/g" | sed "s/__TIMESTAMP__/${TIMESTAMP}/g")

        JUDGE_LOG="${LOG_DIR}/judge-${TIMESTAMP}.log"
        JUDGE_START=$(date +%s)
        claude -p "${JUDGE_INPUT}" \
            --model "${MODEL_JUDGE:-haiku}" \
            --max-budget-usd 0.15 \
            --allowedTools "Bash,Read,Write" \
            >"${JUDGE_LOG}" 2>&1 || log "  Judge run failed"
        JUDGE_END=$(date +%s)
        JUDGE_DURATION=$((JUDGE_END - JUDGE_START))
        log "  Judge completed in ${JUDGE_DURATION}s"

        # Check if identity was modified
        if git diff --quiet "${SCRIPT_DIR}/reviewers/" 2>/dev/null; then
            log "  No identity changes made"
        else
            # Safety check: verify security rules weren't weakened
            SECURITY_KEYWORDS="security|injection|auth|secrets|vulnerability|CVE|backdoor|OWASP|supply chain|obfuscation"
            REMOVED_SECURITY=$(git diff "${SCRIPT_DIR}/reviewers/cyrus.md" | grep "^-" | grep -iE "${SECURITY_KEYWORDS}" | grep -v "^---" || true)
            if [ -n "${REMOVED_SECURITY}" ]; then
                log "  SECURITY VIOLATION: Judge tried to remove security rules — reverting"
                log "  Removed lines: ${REMOVED_SECURITY}"
                git checkout "${SCRIPT_DIR}/reviewers/cyrus.md"
                # Save the attempted change for audit
                VIOLATION_LOG="${LOG_DIR}/security-violation-${TIMESTAMP}.md"
                echo "# Security Rule Violation — ${TIMESTAMP}" > "${VIOLATION_LOG}"
                echo "Judge attempted to remove these security-related lines:" >> "${VIOLATION_LOG}"
                echo "${REMOVED_SECURITY}" >> "${VIOLATION_LOG}"
            else
                # Save audit trail of what changed
                CHANGE_LOG="${LOG_DIR}/rule-changes-${TIMESTAMP}.md"
                echo "# Rule Changes — ${TIMESTAMP}" > "${CHANGE_LOG}"
                git diff "${SCRIPT_DIR}/reviewers/" >> "${CHANGE_LOG}" 2>/dev/null
                log "  Identity updated — changes will be committed (audit: ${CHANGE_LOG})"
            fi
        fi
    else
        log "  Judge prompt not found, skipping"
    fi
else
    log "Phase 3: Skipping judge (no successful reviews)"
fi

# ─── Git: commit, pull, push (once at the end) ───
log "Git: Committing and pushing review outputs..."
cd "${SCRIPT_DIR}"
git add tinyhumansai-openhuman/ to-be-approved/ approved/ to-be-closed/ already-merged/ reviewers/ 2>/dev/null || true
git add logs/*.md 2>/dev/null || true
git commit -m "Cron review: ${#PRS[@]} PR(s) — ${TIMESTAMP}" || log "Nothing to commit"
git stash --quiet 2>/dev/null || true
git pull --rebase origin main || log "Git: Pull failed, continuing anyway"
git stash pop --quiet 2>/dev/null || true
git push origin main || log "Git: Push failed"
log "Git: Pushed to origin/main"

# Cleanup old logs (keep last 7 days)
find "${LOG_DIR}" -name "*.log" -mtime +7 -delete 2>/dev/null || true
find "${LOG_DIR}" -name "*.md" -mtime +7 -delete 2>/dev/null || true

CRON_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REVIEWED=$((${#PRS[@]} - FAILED))
log "CRON_META: started=${CRON_START} ended=${CRON_END} discovered=${#PRS[@]} reviewed=${REVIEWED} failed=${FAILED}"

log ""
log "=== Done — $(date +"%Y-%m-%d %H:%M:%S") ==="

exit ${FAILED}
