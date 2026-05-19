## Post Review to GitHub

### Get latest commit
```bash
gh pr view __PR_NUMBER__ --repo tinyhumansai/openhuman --json commits --jq '.commits[-1].oid'
```

### Review structure
1. **Walkthrough** — 2-3 sentence summary, value assessment (what this adds to the app), and overall verdict
2. **Change summary table** — file, change type, description
3. **Inline comments** — severity tag + what's wrong + suggested fix

### Post as a single PR review
```bash
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/reviews \
  -X POST --input - <<'EOF'
{
  "commit_id": "<latest commit SHA from above>",
  "event": "<REQUEST_CHANGES or COMMENT>",
  "body": "<walkthrough + change summary table>",
  "comments": [
    {"path": "file.ts", "line": 42, "side": "RIGHT", "body": "**[major]** description\n\nSuggestion: ..."}
  ]
}
EOF
```

Use `line` (not `position`) with `side: "RIGHT"`. Line must be within a diff hunk — if not, include in review body instead.

### Don't post if
- PR is perfect — note "LGTM" in tracking only
- All findings duplicate CodeRabbit — note in tracking only
- Continuation where prior `graycyrus` changes resolved + no new critical/major — post `COMMENT` noting changes addressed, move to `to-be-approved/`

### Tone
Natural, specific, not robotic. "This will crash when X is null" not "consider handling edge cases." Give credit where due.

---
