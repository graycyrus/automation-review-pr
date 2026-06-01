## Pre-post Checklist (verify before calling `gh api`)

- [ ] You are posting exactly ONE review — not two, not zero
- [ ] The `body` field is non-empty and contains substantive review text
- [ ] The `body` does NOT contain file paths like `@/tmp/...` — it contains the actual review text
- [ ] The `commit_id` is a valid 40-character hex SHA
- [ ] The `event` type matches CI status (no APPROVE when CI is failing/pending)
- [ ] Inline comment line numbers are within diff hunks
- [ ] You did NOT already post a review in this session

If any check fails, fix it before posting. If you cannot produce a substantive body, do NOT post — just update the tracking file.

## Final Output

Print exactly one line:
```
PR #__PR_NUMBER__: <fresh|continuation>, <N critical, N major, N minor>, <N threads resolved, N still open> → <REQUEST_CHANGES|COMMENT previous changes addressed|moved to to-be-approved|no issues|coderabbit covered all|BLOCKED>
```
