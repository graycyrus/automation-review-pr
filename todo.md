# TODO

## PR Detail Page Actions

### Approve Button
- [ ] Add "Approve" button on detail page
- [ ] Pre-flight checks before approving (CI passing, no conflicts, no unresolved findings)
- [ ] Show check results in a confirmation dialog before proceeding
- [ ] Post `APPROVE` review via `gh api repos/tinyhumansai/openhuman/pulls/<N>/reviews`
- [ ] Log the action with timestamp
- [ ] Update tracking file status to `clean` and move to `to-be-approved/`
- [ ] Show live output of the approval process

### Merge Button
- [ ] Add "Merge" button on detail page
- [ ] Pre-flight checks before merging (CI passing, mergeable, approved, no conflicts)
- [ ] Show check results in a confirmation dialog — block if any fail
- [ ] Merge via `gh pr merge <N> --repo tinyhumansai/openhuman --squash` (or `--merge`)
- [ ] Log the action with timestamp
- [ ] Show live output of the merge process
- [ ] Update PR status in DB after merge

### Refresh Button
- [ ] Add "Refresh" button on detail page
- [ ] Re-fetches PR data from GitHub API (metadata + CI checks + merge status)
- [ ] Re-syncs tracking file from disk
- [ ] Re-renders the page with fresh data
- [ ] Shows a brief loading indicator while refreshing
