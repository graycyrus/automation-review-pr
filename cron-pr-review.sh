#!/bin/bash
# Automated PR Reviewer — multi-phase parallel reviews via claude CLI
# Mirrors the full 13-step interactive review workflow:
#   Phase 1: Discover eligible PRs (gates, filtering)
#   Phase A: Intelligence gathering per PR (classify, read surrounding code, CodeRabbit dedup, dep/test/impact)
#   Phase B: Deep review + post per PR (uses Phase A context)
#
# Cron: 0 * * * * /Users/cyrus/Desktop/automation/review-pr/cron-pr-review.sh

set -euo pipefail

# Paths
SCRIPT_DIR="/Users/cyrus/Desktop/automation/review-pr"
REPO_DIR="/Users/cyrus/Desktop/Code/tinyhuman/openhuman.ai/openhuman"
LOG_DIR="${SCRIPT_DIR}/logs"
DISCOVER_PROMPT="${SCRIPT_DIR}/discover-prompt.md"
INTEL_PROMPT="${SCRIPT_DIR}/phase-a-intelligence-prompt.md"
REVIEW_PROMPT="${SCRIPT_DIR}/phase-b-review-prompt.md"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M")
LOG_FILE="${LOG_DIR}/review-${TIMESTAMP}.log"

# Ensure PATH includes required tools (cron has minimal PATH)
export PATH="/Users/cyrus/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"
export HOME="/Users/cyrus"

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

# ─── Phase 1: Discover eligible PRs ───
log "Phase 1: Discovering eligible PRs..."

PR_JSON=$(claude -p "$(cat "${DISCOVER_PROMPT}")" \
    --allowedTools "Bash,Read" \
    --add-dir "${REPO_DIR}" \
    2>/dev/null)

PR_NUMBERS=$(echo "${PR_JSON}" | grep -oE '\[[ 0-9,]*\]' | head -1)

if [ -z "${PR_NUMBERS}" ] || [ "${PR_NUMBERS}" = "[]" ]; then
    log "No eligible PRs found. Done."
    exit 0
fi

PRS=()
while IFS= read -r pr; do
    [ -n "$pr" ] && PRS+=("$pr")
done < <(echo "${PR_NUMBERS}" | tr -d '[]' | tr ',' '\n' | tr -d ' ' | grep -v '^$')
log "Found ${#PRS[@]} eligible PR(s): ${PRS[*]}"

# ─── Phase A: Intelligence gathering (parallel across PRs) ───
log "Phase A: Gathering intelligence for all PRs in parallel..."

INTEL_PIDS=()
for PR in "${PRS[@]}"; do
    INTEL_LOG="${LOG_DIR}/intel-PR-${PR}-${TIMESTAMP}.log"
    PROMPT=$(sed "s/__PR_NUMBER__/${PR}/g" "${INTEL_PROMPT}")

    log "  Starting intelligence for PR #${PR}"

    claude -p "${PROMPT}" \
        --allowedTools "Bash,Read,Write" \
        --add-dir "${REPO_DIR}" \
        >"${INTEL_LOG}" 2>&1 &

    INTEL_PIDS+=($!)
done

# Wait for all intelligence phases
INTEL_FAILED=()
for i in "${!INTEL_PIDS[@]}"; do
    PID=${INTEL_PIDS[$i]}
    PR=${PRS[$i]}
    if wait "${PID}"; then
        log "  PR #${PR}: intelligence gathered"
    else
        log "  PR #${PR}: intelligence FAILED"
        INTEL_FAILED+=("${PR}")
    fi
done

# Remove failed PRs from review list
REVIEW_PRS=()
for PR in "${PRS[@]}"; do
    FAILED=false
    for F in "${INTEL_FAILED[@]+"${INTEL_FAILED[@]}"}"; do
        if [ "${F}" = "${PR}" ]; then FAILED=true; break; fi
    done
    # Also check context file was actually created
    if [ "${FAILED}" = false ] && [ -f "${SCRIPT_DIR}/tinyhumansai-openhuman/.context-PR-${PR}.md" ]; then
        REVIEW_PRS+=("${PR}")
    else
        log "  PR #${PR}: skipping review (no context file)"
    fi
done

if [ ${#REVIEW_PRS[@]} -eq 0 ]; then
    log "No PRs with successful intelligence. Done."
    exit 0
fi

# ─── Phase B: Deep review + post (parallel across PRs) ───
log "Phase B: Launching deep reviews for ${#REVIEW_PRS[@]} PR(s) in parallel..."

REVIEW_PIDS=()
for PR in "${REVIEW_PRS[@]}"; do
    REVIEW_LOG="${LOG_DIR}/review-PR-${PR}-${TIMESTAMP}.log"
    PROMPT=$(sed "s/__PR_NUMBER__/${PR}/g" "${REVIEW_PROMPT}")

    log "  Starting review of PR #${PR}"

    claude -p "${PROMPT}" \
        --allowedTools "Bash,Read,Write" \
        --add-dir "${REPO_DIR}" \
        >"${REVIEW_LOG}" 2>&1 &

    REVIEW_PIDS+=($!)
done

# Wait for all reviews
FAILED=0
for i in "${!REVIEW_PIDS[@]}"; do
    PID=${REVIEW_PIDS[$i]}
    PR=${REVIEW_PRS[$i]}
    if wait "${PID}"; then
        log "  PR #${PR}: review completed"
    else
        log "  PR #${PR}: review FAILED"
        FAILED=$((FAILED + 1))
    fi
done

# ─── Phase 3: Summary ───
log ""
log "=== Summary ==="
log "Discovered: ${#PRS[@]} PR(s)"
log "Intel gathered: ${#REVIEW_PRS[@]}"
log "Intel failed: ${#INTEL_FAILED[@]}"
log "Review failed: ${FAILED}"
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

for PR in "${INTEL_FAILED[@]+"${INTEL_FAILED[@]}"}"; do
    log "  PR #${PR}: skipped (intelligence failed)"
done

log ""
log "=== Done — $(date +"%Y-%m-%d %H:%M:%S") ==="

# Cleanup old logs (keep last 7 days)
find "${LOG_DIR}" -name "*.log" -mtime +7 -delete 2>/dev/null || true

exit ${FAILED}
