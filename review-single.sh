#!/bin/bash
# Review a single PR — single-phase with conditional prompt assembly
# Usage: ./review-single.sh <PR_NUMBER>

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: ./review-single.sh <PR_NUMBER>"
    exit 1
fi

PR="$1"
SCRIPT_DIR="/Users/cyrus/Desktop/automation/review-pr"
REPO_DIR="/Users/cyrus/Desktop/Code/tinyhuman/openhuman.ai/openhuman"
PARTS_DIR="${SCRIPT_DIR}/prompt-parts"
STATUS_FILE="${SCRIPT_DIR}/status.json"

export PATH="/Users/cyrus/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"

# Load .env
if [ -f "${SCRIPT_DIR}/.env" ]; then
    set -a; source "${SCRIPT_DIR}/.env"; set +a
fi

REVIEW_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
START_EPOCH=$(date +%s)

# Write status on failure
cleanup_status() {
    local exit_code=$?
    REVIEW_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    if [ ${exit_code} -ne 0 ]; then
        echo "{\"pr\":${PR},\"running\":false,\"failed\":true,\"started\":\"${REVIEW_START}\",\"ended\":\"${REVIEW_END}\"}" > "${STATUS_FILE}"
    fi
}
trap cleanup_status EXIT

echo "============================================="
echo "  PR Review — #${PR}"
echo "============================================="
echo "REVIEW_STARTED=${REVIEW_START}"
echo ""

# Git: pull latest (skip if called from cron or dashboard trigger)
if [ -z "${CRON_MODE:-}" ] && [ -z "${DASHBOARD_MODE:-}" ]; then
    echo "[Git] Pulling latest changes..."
    cd "${SCRIPT_DIR}"
    git stash --quiet 2>/dev/null || true
    git pull --rebase origin main || echo "[Git] Pull failed, continuing anyway"
    git stash pop --quiet 2>/dev/null || true
    echo ""
fi

# === Bash pre-computation: determine which prompt sections to include ===
PRECHECK_START=$(date +%s)
echo "--- Pre-check: Analyzing PR #${PR} ---"

# Fetch PR metadata
echo "[Pre-check] Fetching PR metadata..."
PR_META=$(gh pr view "${PR}" --repo tinyhumansai/openhuman --json title,author,headRefName,baseRefName,state,isDraft,body,labels,reviewDecision 2>/dev/null || echo "{}")
PR_TITLE=$(echo "${PR_META}" | jq -r '.title // "unknown"' 2>/dev/null || echo "unknown")
PR_AUTHOR=$(echo "${PR_META}" | jq -r '.author.login // "unknown"' 2>/dev/null || echo "unknown")
PR_BRANCH=$(echo "${PR_META}" | jq -r '.headRefName // "?"' 2>/dev/null || echo "?")
PR_BASE=$(echo "${PR_META}" | jq -r '.baseRefName // "main"' 2>/dev/null || echo "main")
PR_STATE=$(echo "${PR_META}" | jq -r '.state // "unknown"' 2>/dev/null || echo "unknown")
PR_DRAFT=$(echo "${PR_META}" | jq -r '.isDraft // false' 2>/dev/null || echo "false")
PR_BODY=$(echo "${PR_META}" | jq -r '.body // ""' 2>/dev/null || echo "")
PR_LABELS=$(echo "${PR_META}" | jq -r '[.labels[]?.name] | join(", ") // ""' 2>/dev/null || echo "")
PR_DECISION=$(echo "${PR_META}" | jq -r '.reviewDecision // "NONE"' 2>/dev/null || echo "NONE")

echo "  Title: ${PR_TITLE}"
echo "  Author: ${PR_AUTHOR}"
echo "  Branch: ${PR_BRANCH} -> ${PR_BASE}"
echo "  State: ${PR_STATE} | Draft: ${PR_DRAFT}"
echo "  Labels: ${PR_LABELS:-none}"
echo "  Review decision: ${PR_DECISION}"
echo ""

# Fetch diff stat
echo "[Pre-check] Fetching diff stat..."
DIFF_STAT=$(gh pr diff "${PR}" --repo tinyhumansai/openhuman --stat 2>/dev/null || echo "")
DIFF_SUMMARY=$(echo "${DIFF_STAT}" | tail -1)
FILE_COUNT=$(echo "${DIFF_STAT}" | grep -c '|' || echo "0")
echo "  ${FILE_COUNT} files changed — ${DIFF_SUMMARY}"
echo ""

# Check if this is a continuation review
IS_CONTINUATION="false"
if [ -f "${SCRIPT_DIR}/tinyhumansai-openhuman/PR-${PR}.md" ]; then
    IS_CONTINUATION="true"
    LAST_COMMIT=$(grep -m1 'Last reviewed commit' "${SCRIPT_DIR}/tinyhumansai-openhuman/PR-${PR}.md" | sed 's/.*: *//' || echo "unknown")
    CYCLE_COUNT=$(grep -c '### Review ' "${SCRIPT_DIR}/tinyhumansai-openhuman/PR-${PR}.md" || echo "0")
    echo "[Pre-check] Continuation review (${CYCLE_COUNT} prior cycles, last commit: ${LAST_COMMIT})"
elif [ -f "${SCRIPT_DIR}/to-be-approved/PR-${PR}.md" ]; then
    IS_CONTINUATION="true"
    echo "[Pre-check] Continuation review (PR was in to-be-approved/)"
else
    echo "[Pre-check] Fresh review (no prior tracking file)"
fi

# Check for linked issues
HAS_LINKED_ISSUES="false"
if echo "${PR_BODY}" | grep -qiE 'closes?\s*#|fixe?s?\s*#|resolves?\s*#|refs?\s*#'; then
    HAS_LINKED_ISSUES="true"
    LINKED_ISSUES=$(echo "${PR_BODY}" | grep -oiE '(closes?|fixe?s?|resolves?|refs?)\s*#[0-9]+' | head -5 || echo "")
    echo "[Pre-check] Linked issues: ${LINKED_ISSUES}"
else
    echo "[Pre-check] No linked issues found"
fi

# Check for dependency file changes
HAS_DEP_CHANGES="false"
if echo "${DIFF_STAT}" | grep -qE 'Cargo\.(toml|lock)|package\.json|pnpm-lock'; then
    HAS_DEP_CHANGES="true"
    DEP_FILES=$(echo "${DIFF_STAT}" | grep -oE '(Cargo\.(toml|lock)|package\.json|pnpm-lock\S+)' | tr '\n' ', ' || echo "")
    echo "[Pre-check] Dependency changes: ${DEP_FILES}"
else
    echo "[Pre-check] No dependency changes"
fi

# Check for logic file changes (not just config/docs/tests)
HAS_LOGIC_CHANGES="false"
if echo "${DIFF_STAT}" | grep -E '\.(rs|ts|tsx)\s' | grep -qvE '\.test\.|\.d\.ts|\.config\.'; then
    HAS_LOGIC_CHANGES="true"
    LOGIC_FILE_COUNT=$(echo "${DIFF_STAT}" | grep -E '\.(rs|ts|tsx)\s' | grep -cvE '\.test\.|\.d\.ts|\.config\.' || echo "0")
    echo "[Pre-check] Logic file changes: ${LOGIC_FILE_COUNT} files"
else
    echo "[Pre-check] No logic file changes (config/docs/tests only)"
fi

# Check for CodeRabbit review
HAS_CODERABBIT="false"
CR_CHECK=$(gh api "repos/tinyhumansai/openhuman/pulls/${PR}/reviews" --jq '[.[].user.login] | map(select(. == "coderabbitai[bot]")) | length' 2>/dev/null || echo "0")
if [ "${CR_CHECK}" -gt 0 ] 2>/dev/null; then
    HAS_CODERABBIT="true"
    echo "[Pre-check] CodeRabbit has reviewed (${CR_CHECK} review(s))"
else
    echo "[Pre-check] No CodeRabbit review"
fi

PRECHECK_END=$(date +%s)
PRECHECK_DURATION=$((PRECHECK_END - PRECHECK_START))
echo ""
echo "--- Pre-check summary (${PRECHECK_DURATION}s) ---"
echo "  Continuation:  ${IS_CONTINUATION}"
echo "  Linked issues: ${HAS_LINKED_ISSUES}"
echo "  Dep changes:   ${HAS_DEP_CHANGES}"
echo "  Logic changes: ${HAS_LOGIC_CHANGES}"
echo "  CodeRabbit:    ${HAS_CODERABBIT}"
echo ""

# === Assemble prompt from modular parts ===
echo "--- Assembling prompt ---"
PROMPT=""
SECTIONS_INCLUDED="header, core-steps"

# Always included
PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/header.md")"$'\n\n'
PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/core-steps.md")"$'\n\n'

# Conditional: linked issues
if [ "${HAS_LINKED_ISSUES}" = "true" ]; then
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/linked-issues.md")"$'\n\n'
    SECTIONS_INCLUDED+=", linked-issues"
fi

# Conditional: continuation review
if [ "${IS_CONTINUATION}" = "true" ]; then
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/continuation.md")"$'\n\n'
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/smart-re-review.md")"$'\n\n'
    SECTIONS_INCLUDED+=", continuation, smart-re-review"
fi

# Conditional: CodeRabbit dedup
if [ "${HAS_CODERABBIT}" = "true" ]; then
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/coderabbit-dedup.md")"$'\n\n'
    SECTIONS_INCLUDED+=", coderabbit-dedup"
fi

# Conditional: dependency audit
if [ "${HAS_DEP_CHANGES}" = "true" ]; then
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/dep-audit.md")"$'\n\n'
    SECTIONS_INCLUDED+=", dep-audit"
fi

# Conditional: test coverage + impact scan
if [ "${HAS_LOGIC_CHANGES}" = "true" ]; then
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/test-coverage.md")"$'\n\n'
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/impact-scan.md")"$'\n\n'
    SECTIONS_INCLUDED+=", test-coverage, impact-scan"
fi

# Always included
PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/review-post.md")"$'\n\n'
PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/tracking-update.md")"$'\n\n'

# Reviewer identity — injected after base rules, before footer (overrides take precedence)
REVIEWER_IDENTITY="${SCRIPT_DIR}/reviewers/${REVIEWER:-cyrus}.md"
if [ -f "${REVIEWER_IDENTITY}" ]; then
    PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${REVIEWER_IDENTITY}")"$'\n\n'
    SECTIONS_INCLUDED+=", reviewer-identity"
fi

PROMPT+="$(sed "s/__PR_NUMBER__/${PR}/g" "${PARTS_DIR}/footer.md")"
SECTIONS_INCLUDED+=", review-post, tracking-update, footer"

PROMPT_LINES=$(echo "${PROMPT}" | wc -l | tr -d ' ')
PROMPT_WORDS=$(echo "${PROMPT}" | wc -w | tr -d ' ')
echo "  Sections: ${SECTIONS_INCLUDED}"
echo "  Prompt size: ${PROMPT_LINES} lines, ${PROMPT_WORDS} words"
echo ""

echo "{\"pr\":${PR},\"running\":true,\"started\":\"${REVIEW_START}\"}" > "${STATUS_FILE}"

# Single Claude invocation
CLAUDE_START=$(date +%s)
echo "--- Claude review started at $(date -u +"%Y-%m-%dT%H:%M:%SZ") ---"
claude -p "${PROMPT}" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"
CLAUDE_END=$(date +%s)
CLAUDE_DURATION=$((CLAUDE_END - CLAUDE_START))
echo ""
echo "--- Claude review finished (${CLAUDE_DURATION}s) ---"

REVIEW_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOTAL_DURATION=$((CLAUDE_END - START_EPOCH))
echo "{\"pr\":${PR},\"running\":false,\"started\":\"${REVIEW_START}\",\"ended\":\"${REVIEW_END}\"}" > "${STATUS_FILE}"
echo ""
echo "--- Timing ---"
echo "  Pre-checks: ${PRECHECK_DURATION}s"
echo "  Claude review: ${CLAUDE_DURATION}s"
echo "  Total: ${TOTAL_DURATION}s"
echo ""
echo "REVIEW_ENDED=${REVIEW_END}"

# Git: commit, pull, push (skip if called from cron)
if [ -z "${CRON_MODE:-}" ]; then
    echo ""
    echo "[Git] Committing and pushing review outputs..."
    cd "${SCRIPT_DIR}"
    git add tinyhumansai-openhuman/ to-be-approved/ approved/ to-be-closed/ already-merged/ 2>/dev/null || true
    git commit -m "Review PR #${PR}" || echo "Nothing to commit"
    git stash --quiet 2>/dev/null || true
    git pull --rebase origin main || echo "[Git] Pull failed, continuing anyway"
    git stash pop --quiet 2>/dev/null || true
    git push origin main || echo "[Git] Push failed"
fi

echo ""
echo "=== Done ==="
