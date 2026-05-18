# Phase A: Intelligence Gathering — PR #__PR_NUMBER__

You are gathering deep context for a PR review on `tinyhumansai/openhuman`. Your job is to collect ALL intelligence and output it to a context file. You do NOT post any review — that happens in the next phase.

---

## STEP 1: Read PR Description + Metadata (from 03-read-pr-details.md)

```bash
gh pr view __PR_NUMBER__ --repo tinyhumansai/openhuman
```

Extract and note:
1. **Title** — does it follow conventional commit format? (`feat:`, `fix:`, `refactor:`, etc.)
2. **Summary** — what does the PR claim to do?
3. **Test plan** — what verification was performed?
4. **Linked issues** — `Closes #N`, `Fixes #N`, or referenced issues
5. **Labels** — any priority, area, or type labels
6. **Author** — who wrote it, are they a regular contributor?
7. **Files changed** — `gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman --stat`
8. **Commit count** — single focused commit or sprawling history?

### Red flags to note
- No linked issue (acceptable for small fixes, suspicious for features)
- No test plan section
- Title doesn't match the actual changes
- Very large diff (>500 lines) without clear justification
- Multiple unrelated changes bundled together

---

## STEP 2: Read Linked Issue(s) (from 04-read-linked-issue.md)

From the PR description, extract issue references:
- `Closes #N`
- `Fixes #N`
- `Resolves #N`
- `Related to #N`
- Issue URLs in the body

For each linked issue:
```bash
gh issue view <issue-number> --repo tinyhumansai/openhuman
```

Extract:
1. **What needs to be done** — the core requirement
2. **Acceptance criteria** — explicit "done when..." conditions
3. **Edge cases mentioned** — anything the issue calls out as tricky
4. **Scope boundaries** — what's explicitly out of scope

These become the verification checklist — every acceptance criterion should be met by the PR.

### No linked issue
- Small bug fixes / typo fixes / dependency bumps — acceptable, skip this step
- Features or significant changes — flag: "No linked issue. Consider creating one for tracking."

---

## STEP 3: Verify PR Description Matches Issue (from 05-review-code-changes.md)

**Skip if no linked issue.**

### Three-way verification

Cross-check three things:
1. **Issue** — what was asked for (acceptance criteria)
2. **PR description** — what the PR claims to do
3. **Actual code changes** — what was actually implemented

### Check for mismatches

**PR overclaims:**
- PR description says it does X, but the code doesn't actually implement X
- PR says "Closes #N" but doesn't address all acceptance criteria

**PR underclaims:**
- Code changes include things not mentioned in the PR description
- Unrelated changes bundled in (scope creep)

**Scope drift:**
- PR solves a different problem than the issue describes
- PR takes a fundamentally different approach than what was discussed in the issue

### Blocking conditions
Flag as BLOCKING if:
- The PR claims to close an issue but clearly doesn't meet its acceptance criteria
- The code changes contradict the PR description

Document any mismatches found.

---

## STEP 4: Determine review type

Check if tracking file exists:
```bash
cat /Users/cyrus/Desktop/automation/review-pr/tinyhumansai-openhuman/PR-__PR_NUMBER__.md 2>/dev/null
```

- **File does not exist** → **Fresh review**
- **File exists** → **Continuation review** — note prior findings, last reviewed commit, what was flagged before

For continuation: get latest commit and compare with `Last reviewed commit` from tracking file.

---

## STEP 5: Gather all review feedback for smart re-review

On continuation reviews, collect all prior GitHub feedback so Phase B can decide what was fixed, what remains open, and which threads the reviewer account can resolve. On fresh reviews, still run this check in case a local tracking file was moved or missing.

### Fetch prior reviews and inline threads

```bash
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/reviews
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/comments
gh api graphql -f query='
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewDecision
      commits(last: 20) { nodes { commit { oid committedDate messageHeadline } } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          isOutdated
          comments(first: 20) {
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
              url
              path
              line
              originalLine
              commit { oid }
              originalCommit { oid }
            }
          }
        }
      }
    }
  }
}' -F owner=tinyhumansai -F repo=openhuman -F number=__PR_NUMBER__
```

### What to extract

For each unresolved review thread/comment from any reviewer or bot:
- Thread ID, comment database ID, URL, file, line, created time, and commit/original commit
- Author login, reviewer type if obvious (`graycyrus`, human reviewer, CodeRabbit/bot, PR author)
- The exact concern, severity if present, and requested fix or suggestion
- Whether the author replied, and a short summary of replies
- Whether new commits were pushed after the comment timestamp
- Whether the thread is outdated
- Which later commits or changed files are likely relevant

For prior `REQUEST_CHANGES` reviews from any reviewer:
- Review URL/ID, created time, body summary, and commit SHA if available
- Whether all associated unresolved threads appear addressed by later commits

Do not mark anything resolved in Phase A. Only gather facts. Clearly separate:
- `graycyrus` threads/reviews we can reply to or resolve
- Other human reviewer threads we can evaluate but must not resolve
- Bot/CodeRabbit threads we should dedup against but must not resolve

---

## STEP 6: Get the full diff

```bash
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman
```

Read the entire diff carefully. Note every file changed.

---

## STEP 7: Classify Changes + Build Project Checklist (from 05a-classify-and-checklist.md)

Look at the PR diff and categorize files:

| Area | File patterns | CLAUDE.md rules to check |
|------|--------------|-------------------------|
| **Rust core** | `src/openhuman/**`, `src/core/**` | Module layout, controller registry, RpcOutcome, debug logging |
| **Frontend** | `app/src/**/*.{ts,tsx}` | No dynamic imports, config via `config.ts`, Redux for state, isTauri() guard |
| **Tauri shell** | `app/src-tauri/**` | Thin host only, no JS injection in CEF webviews, plugin JS audit |
| **Event bus** | `src/core/event_bus/**` | Typed pub/sub, singleton API, convention naming |
| **CEF/webviews** | `app/src-tauri/src/webview_accounts/**` | Zero injected JS, CDP-only, no init scripts |
| **Config** | `.env*`, `config.ts`, `types.rs`, `load.rs` | VITE_* via config.ts, TOML Config struct |
| **Tests** | `*.test.{ts,tsx}`, `tests/**` | Co-locate, behavior over implementation, no real network |
| **CI/workflows** | `.github/**` | Coverage gate ≥80% on changed lines |

Build targeted checklist per area. Examples:

If **Rust core** files changed:
- [ ] New functionality in dedicated subdirectory (`openhuman/<domain>/mod.rs`)
- [ ] No standalone `*.rs` at `src/openhuman/` root
- [ ] Controller-only exposure (no domain branches in `cli.rs`/`jsonrpc.rs`)
- [ ] Light `mod.rs` (exports only, logic in `ops.rs`/`store.rs`/`types.rs`)
- [ ] Debug logging with grep-friendly prefixes
- [ ] No secrets/PII in logs

If **Frontend** files changed:
- [ ] No dynamic imports (`import()`, `React.lazy`, `await import()`)
- [ ] Config read from `config.ts`, not `import.meta.env` directly
- [ ] State in Redux, not ad-hoc localStorage
- [ ] Tauri access via `isTauri()` or try/catch `invoke()`, not `window.__TAURI__`

---

## STEP 8: Read Surrounding Code (from 05b-context-read.md — CRITICAL)

For each modified module, read 1–2 **sibling files that are NOT in the diff**. This is what makes our review better than CodeRabbit.

### How to pick files
1. Look at the PR diff — which modules/directories are modified?
2. For each modified module, read 1–2 sibling files NOT in the diff
3. Prioritize files that:
   - Are in the same directory as modified files
   - Export types/functions used by the modified code
   - Follow the same pattern the PR should follow (e.g., another controller's `schemas.rs` if the PR adds a new controller)

### What to note
- **Naming conventions** — how are functions, types, files named in this module?
- **Error handling patterns** — how do sibling files handle errors?
- **Import patterns** — what do other files in this module import and from where?
- **Test patterns** — if there are tests nearby, how are they structured?
- **Logging patterns** — what log format/prefixes does this module use?

---

## STEP 9: CodeRabbit Dedup (from 05c-dedup-coderabbit.md)

```bash
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/reviews
gh api repos/tinyhumansai/openhuman/pulls/__PR_NUMBER__/comments
```

Filter for `coderabbitai[bot]`. For each finding:
- File + line + issue description
- Whether it was actionable or nitpick
- Whether the author already addressed it

Example output:
```
CodeRabbit already flagged:
- app/src/components/Foo.tsx:42 — missing null check on `user.name` (actionable, not yet addressed)
- src/openhuman/cron/ops.rs:18 — unused import (nitpick, already fixed in latest push)
- app/src/store/aiSlice.ts:95 — consider using optional chaining (nitpick)
```

If no CodeRabbit review yet, note "No CodeRabbit review yet — do full review."

---

## STEP 10: Dependency Audit (from 05d-dep-audit.md — conditional)

**Only if `Cargo.toml`, `package.json`, `Cargo.lock`, or `pnpm-lock.yaml` changed.**

### New Rust dependencies
```bash
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman | grep -A2 '^\+.*\[dependencies'
```
For each new crate:
- Is it actively maintained? (check crates.io for last publish date)
- License compatible? (MIT/Apache-2.0 preferred)
- Does it pull in a large dependency tree?

### New JS dependencies
```bash
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman | grep '^\+.*"dependencies\|^\+.*"devDependencies'
```
For each new package:
- Weekly downloads on npm (proxy for maintenance)
- License compatible?
- Is it a devDependency or production dependency? (should it be?)

If none changed, write "N/A — no dependency changes."

---

## STEP 11: Test Coverage (from 05e-test-coverage.md — conditional)

**Only if logic changed (not just config/docs/formatting).**

### New logic without tests
For each new function, component, or module added:
- Is there a corresponding test file?
- Does the test cover the happy path at minimum?
- Are edge cases from the issue's acceptance criteria tested?

### Modified logic without updated tests
For each modified function/component:
- Do existing tests still pass with the changes?
- If behavior changed, were the tests updated to match?
- Are there tests that assert on the old behavior that will now be wrong?

### Coverage gate reminder
PRs must meet **≥ 80% coverage on changed lines** (enforced by CI). If the PR adds significant logic without tests, it will likely fail the coverage gate.

```bash
gh pr diff __PR_NUMBER__ --repo tinyhumansai/openhuman --stat | grep -E '\.test\.(ts|tsx)|tests/'
```

If no test files appear in a PR with significant logic changes, flag it.
If no logic changed, write "N/A — no logic changes."

---

## STEP 12: Impact Scan (from 05f-impact-scan.md — conditional)

**Only if exported functions/types, shared state, services, RPC methods, or event bus events changed.**

### Changed function signatures
For each exported function whose signature changed:
```bash
grep -rn "functionName" app/src/ src/ --include='*.ts' --include='*.tsx' --include='*.rs'
```
- Do all callers pass the new arguments?
- Were default values added to maintain backward compatibility?
- Are there callers in test files that need updating?

### Changed/removed exports
For each removed or renamed export:
```bash
grep -rn "import.*OldName" app/src/ --include='*.ts' --include='*.tsx'
```
- Are all importers updated?

### Changed Redux state shape
If a Redux slice's state shape changed:
- Is the `persist` whitelist updated?
- Is there a migration for existing persisted state?
- Are all selectors and consumers updated?

### Changed RPC methods
If RPC method names or schemas changed:
- Is the frontend `coreRpcClient` usage updated?
- Are JSON-RPC E2E tests updated?

If no exports/signatures changed, write "N/A — no signature changes."

---

## OUTPUT

Write ALL findings to:
```
/Users/cyrus/Desktop/automation/review-pr/tinyhumansai-openhuman/.context-PR-__PR_NUMBER__.md
```

Use this exact format:

```markdown
# Intelligence Context — PR #__PR_NUMBER__

## PR Metadata
- **Title**: <title>
- **Author**: @<login>
- **Branch**: <head> → <base>
- **URL**: https://github.com/tinyhumansai/openhuman/pull/__PR_NUMBER__
- **Review type**: Fresh | Continuation
- **Latest commit**: <sha>
- **Commit count**: <N>
- **Diff size**: <N files, +X -Y lines>

## PR Description
<full PR description>

## Red Flags
<any red flags from step 1, or "None">

## Linked Issues + Acceptance Criteria
<issue numbers + extracted acceptance criteria, or "None">

## PR-Issue Alignment (three-way verification)
<does PR match issue? overclaims? underclaims? scope drift? BLOCKING mismatches?>

## Prior Review Context (continuation only)
<prior findings, what was flagged, what was addressed since last review>

## Review Feedback + Resolution Candidates
<all unresolved prior threads/reviews/comments from graycyrus, humans, and bots; author replies; commits pushed after comments; likely fixed/still-open status candidates; and which threads are actionable by graycyrus; or "None">

## Changed Files
<list of all files with change type>

## Classification + Checklist
### Areas detected: <list>
<full checklist per area with specific rules>

## Surrounding Code Patterns
### <module/directory 1>
**Files read**: <list of sibling files read>
- **Naming**: <pattern observed>
- **Error handling**: <pattern observed>
- **Imports**: <pattern observed>
- **Logging**: <pattern observed>
- **Tests**: <pattern observed>
### <module/directory 2>
...

## CodeRabbit Dedup
<bullet list of what CodeRabbit already flagged with file:line:issue, or "No CodeRabbit review yet">

## Dependency Audit
<findings per new dep, or "N/A — no dependency changes">

## Test Coverage
<findings per new/modified logic, or "N/A — no logic changes">

## Impact Scan
<findings per changed export/signature, or "N/A — no signature changes">

## Full Diff
<include the COMPLETE diff here for the reviewer>
```

**IMPORTANT**: Be thorough and precise. This context file is the ONLY input the reviewer will have. Everything you miss here will be missed in the review. Follow each step from the workflow docs exactly.
