## Post Review to GitHub

### Get latest commit
```bash
gh pr view __PR_NUMBER__ --repo tinyhumansai/openhuman --json commits --jq '.commits[-1].oid'
```

### Review structure
1. **Inline comments** — severity tag + what's wrong + suggested fix

### Post as a single PR review

**CRITICAL RULES — read all before posting:**

1. **Never post an empty review.** The `body` field MUST contain substantive review text. If you have nothing to say, do NOT post a review at all. An empty-body review pollutes the PR timeline.

2. **Never use temp files.** Do NOT write the review body to a file and use `@/path/to/file` or `-f body=@file`. That posts the literal path string as the review body. Always inline the JSON via heredoc stdin.

3. **Post exactly ONE review per invocation.** Do not post multiple review events for the same PR in a single run. If you have inline comments AND a summary, combine them into one `gh api` call. Never split them into separate calls.

4. **Never post a review with only inline comments and no body.** GitHub will show an empty comment. Always include a body summarizing the review, even if brief.

5. **Verify before posting.** Before running the `gh api` command, check:
   - Is the body non-empty and substantive? (not just whitespace or a file path)
   - Is the commit_id a valid 40-char SHA?
   - Is the event type correct per CI status and reviewer rules?
   - Are all inline comment line numbers within diff hunks?

```bash
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/reviews \
  -X POST --input - <<'EOF'
{
  "commit_id": "<latest commit SHA from above>",
  "event": "<APPROVE or REQUEST_CHANGES or COMMENT — per reviewer identity rules>",
  "body": "<walkthrough + change summary table — escape double quotes and newlines for JSON>",
  "comments": [
    {"path": "file.ts", "line": 42, "side": "RIGHT", "body": "**[major]** description\n\nSuggestion: ..."}
  ]
}
EOF
```

Use `line` (not `position`) with `side: "RIGHT"`. Line must be within a diff hunk — if not, include in review body instead.

If the body contains characters that break JSON (double quotes, backslashes, newlines), escape them properly in the JSON string. Do NOT work around this by writing to a file.

### Don't post if
- All findings duplicate CodeRabbit — note in tracking only
- Continuation where prior `graycyrus` changes resolved + no new critical/major — post `COMMENT` noting changes addressed
- You already posted a review in this invocation — never double-post

*(If reviewer identity grants approval authority, a perfect PR should be APPROVED, not silently skipped.)*

### Tone
Natural, specific, not robotic. "This will crash when X is null" not "consider handling edge cases." Give credit where due.

---
