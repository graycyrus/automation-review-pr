## Post Review to GitHub

### Get latest commit
```bash
gh pr view __PR_NUMBER__ --repo tinyhumansai/openhuman --json commits --jq '.commits[-1].oid'
```

### Review structure
1. **Inline comments** — severity tag + what's wrong + suggested fix

### Post as a single PR review
```bash
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/reviews \
  -X POST --input - <<'EOF'
{
  "commit_id": "<latest commit SHA from above>",
  "event": "<APPROVE or REQUEST_CHANGES or COMMENT — per reviewer identity rules>",
  "body": "<walkthrough + change summary table>",
  "comments": [
    {"path": "file.ts", "line": 42, "side": "RIGHT", "body": "**[major]** description\n\nSuggestion: ..."}
  ]
}
EOF
```

Use `line` (not `position`) with `side: "RIGHT"`. Line must be within a diff hunk — if not, include in review body instead.

### Don't post if
- All findings duplicate CodeRabbit — note in tracking only
- Continuation where prior `graycyrus` changes resolved + no new critical/major — post `COMMENT` noting changes addressed

*(If reviewer identity grants approval authority, a perfect PR should be APPROVED, not silently skipped.)*

### Tone
Natural, specific, not robotic. "This will crash when X is null" not "consider handling edge cases." Give credit where due.

---
