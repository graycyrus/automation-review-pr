# PR Discovery — tinyhumansai/openhuman

List all open PRs eligible for review. Output ONLY a JSON array of PR numbers, nothing else.

## Steps

1. List open non-draft PRs:
```bash
gh pr list --repo tinyhumansai/openhuman --state open --json number,title,author,isDraft
```

2. Filter out draft PRs.

3. For each remaining PR, check if it's already in `to-be-approved/`:
```bash
ls /Users/cyrus/Desktop/automation/review-pr/to-be-approved/
```
If `PR-<N>.md` exists there, skip it.

4. For each remaining PR, check if there are new commits since last review:
```bash
LATEST_COMMIT=$(gh pr view <N> --repo tinyhumansai/openhuman --json commits --jq '.commits[-1].oid')
```
Read `/Users/cyrus/Desktop/automation/review-pr/tinyhumansai-openhuman/PR-<N>.md` if it exists. If `Last reviewed commit` matches `LATEST_COMMIT`, skip it (no new changes).

5. For each remaining PR, run gate checks (from 02-gate-check.md):

### Gate A: CI status
```bash
gh pr checks <N> --repo tinyhumansai/openhuman
```
**Blockers** (skip this PR):
- CI failures caused by PR changes (type errors, lint, test failures, build failures in touched files)

**Not blockers** (note but keep PR eligible):
- Flaky tests unrelated to the PR
- CI infrastructure issues (runner timeouts, network errors)
- Pre-existing failures on `main` that also fail on this PR

If blocked, post:
```bash
gh pr comment <N> --repo tinyhumansai/openhuman --body "@<author> CI is failing on changes in this PR — please fix before review."
```

### Gate B: Merge conflicts
```bash
gh pr view <N> --repo tinyhumansai/openhuman --json mergeable,mergeStateStatus
```
If `mergeable: CONFLICTING`, skip and post:
```bash
gh pr comment <N> --repo tinyhumansai/openhuman --body "@<author> this PR has merge conflicts with main — please rebase/resolve before review."
```

### Gate C: Unresolved review feedback
```bash
gh api repos/tinyhumansai/openhuman/pulls/<N>/reviews
gh api repos/tinyhumansai/openhuman/pulls/<N>/comments
```
Look for:
- Reviews with state `CHANGES_REQUESTED` that haven't been addressed
- Inline comment threads with no author response

If unresolved feedback from human reviewers (not bots), skip and post:
```bash
gh pr comment <N> --repo tinyhumansai/openhuman --body "@<author> unresolved review feedback from <reviewer(s)> — please address before we review."
```

## Output

After all filtering, output ONLY a valid JSON array of eligible PR numbers. Example:
```
[1704, 1706, 1710]
```

If no PRs are eligible, output:
```
[]
```

**IMPORTANT**: Output ONLY the JSON array. No explanations, no markdown, no other text.
