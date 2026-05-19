## STEP 1: PR metadata + diff

```bash
gh pr view __PR_NUMBER__ --repo tinyhumansai/openhuman
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman --stat
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman
```

Extract: title, summary, test plan, linked issues, labels, author, files changed, commit count.

Note red flags: no linked issue on a feature, no test plan, title doesn't match changes, >500 line diff without justification, unrelated changes bundled.

Read the entire diff carefully. Then quickly assess:

**PR quality gate** — before doing a full review, determine:
1. **Is this a real contribution?** Random/AI-generated/low-effort PRs with no clear purpose, copy-pasted boilerplate, or changes that don't make sense → flag as `[critical]` "PR appears low-quality/AI-generated — no clear value" and post REQUEST_CHANGES immediately. Don't waste time on a full review.
2. **What value does this add?** Bug fix, feature, refactor, docs, tests — note the value category. If the PR makes changes with no clear benefit or introduces unnecessary complexity, flag it.
3. **Cross-cutting impact** — quickly check: does this PR change exported functions, shared types, state shapes, RPC methods, or event bus events? If yes, grep for callers/importers to verify nothing breaks. Flag unhandled breakage as `[critical]`.

If the PR passes the quality gate, proceed with the full review below.

---

## STEP 2: Classify changes

Categorize files into areas and build a targeted checklist:

| Area | Patterns | Key checks |
|------|----------|------------|
| **Rust core** | `src/openhuman/**` | Module layout, controller registry, RpcOutcome, debug logging, no `.unwrap()` |
| **Frontend** | `app/src/**/*.{ts,tsx}` | No dynamic imports, config via `config.ts`, Redux state, `isTauri()` guard |
| **Tauri shell** | `app/src-tauri/**` | Thin host, no JS injection in CEF webviews |
| **Tests** | `*.test.*`, `tests/**` | Co-located, behavior over implementation, no real network |
| **Config** | `.env*`, `config.ts`, `types.rs` | VITE_* via config.ts, TOML Config struct |

---

## STEP 3: Review the code

For each file in the diff:
1. Check against the area-specific checklist above
2. Check known issues from CLAUDE.md (unwrap, PII in logs, dynamic imports, missing logging, etc.)
3. Look for logic bugs, missing error handling, security issues, breaking changes
4. Note deviations from patterns in sibling code (if you need context on patterns, read 1 sibling file)

### Severity levels
- `**[critical]**` — Security, data loss, crashes, broken core functionality
- `**[major]**` — Logic bugs, missing error handling, broken patterns, missing tests
- `**[minor]**` — Style, naming, minor optimization, docs

---
