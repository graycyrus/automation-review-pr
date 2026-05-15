#!/bin/bash
# Review a single PR — runs Phase A (intelligence) then Phase B (review + post)
# Usage: ./review-single.sh <PR_NUMBER>

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: ./review-single.sh <PR_NUMBER>"
    exit 1
fi

PR="$1"
SCRIPT_DIR="/Users/cyrus/Desktop/automation/review-pr"
REPO_DIR="/Users/cyrus/Desktop/Code/tinyhuman/openhuman.ai/openhuman"
INTEL_PROMPT="${SCRIPT_DIR}/phase-a-intelligence-prompt.md"
REVIEW_PROMPT="${SCRIPT_DIR}/phase-b-review-prompt.md"

export PATH="/Users/cyrus/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"

echo "=== Reviewing PR #${PR} ==="
echo ""

echo "[Phase A] Gathering intelligence..."
claude -p "$(sed "s/__PR_NUMBER__/${PR}/g" "${INTEL_PROMPT}")" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"

echo ""
echo "[Phase B] Deep review + posting..."
claude -p "$(sed "s/__PR_NUMBER__/${PR}/g" "${REVIEW_PROMPT}")" \
    --allowedTools "Bash,Read,Write" \
    --add-dir "${REPO_DIR}"

echo ""
echo "=== Done ==="
