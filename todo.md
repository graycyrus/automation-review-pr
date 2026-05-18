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

## Smart Re-review & Comment Resolution

- [x] On re-trigger (or new review cycle), detect older review comments from all reviewers/bots
- [x] Check if the PR author has pushed new commits since those comments
- [x] Check if the author replied to or addressed specific comments
- [x] For each inline comment: determine if the requested change was fulfilled in subsequent commits
- [x] If fulfilled → reply acknowledging the fix and resolve the comment thread
- [x] If `REQUEST_CHANGES` review exists and all requested changes are addressed → post a new review dismissing/closing the previous request
- [x] If author made a generic comment (not addressing specifics) → evaluate whether the concern was still resolved via code changes
- [x] Log all resolution actions in the tracking file review history

## Individual PR Sync Button

- [ ] Add "Sync" button on each PR card/row in the dashboard list view
- [ ] On click, re-fetch that single PR's data from GitHub API (metadata, CI, merge status, comments)
- [ ] Re-parse the tracking `.md` file from disk
- [ ] Upsert into DB and re-render just that PR's row/card
- [ ] Show loading indicator on the individual PR during sync

## Make Repo Public / Open Source Ready

- [ ] Parameterise all hardcoded values (repo name, org, reviewer identity, paths, port)
  - Move to a single `config.json` or `.env` file at the root
  - `REPO` (`tinyhumansai/openhuman`), `ORG` (`tinyhumansai`), `REVIEWER` (`graycyrus`)
  - `SCRIPT_DIR`, `REPO_DIR` in bash scripts → read from env/config
  - Dashboard `PORT` (already env-based)
- [ ] Remove all hardcoded absolute paths (`/Users/cyrus/...`) from bash scripts and prompts
  - Use `$(dirname "$0")` or `$SCRIPT_DIR` relative paths everywhere
- [ ] Separate review data from code — tracking files, logs, DB should live outside the repo or be gitignored
  - Add `.gitignore` for: `logs/`, `already-merged/`, `tinyhumansai-openhuman/`, `to-be-approved/`, `dashboard/data/`, `status.json`, `node_modules/`, `.env`
  - Review data (tracking files, logs) can go to a separate private repo or a configurable data dir
- [ ] Remove any secrets, tokens, or org-specific data from committed files
- [ ] Add setup instructions to README (clone, configure, run)
- [ ] Add a `setup.sh` script that creates dirs, copies `.env.example`, installs deps
- [ ] Add `.env.example` with all required config vars
- [ ] Add LICENSE file (MIT or similar)
- [ ] Review all prompt files — parameterise repo/org references with `__REPO__`, `__ORG__` placeholders

## PR Change Summary in Review Cycle

- [x] During each review cycle, generate a summarized description of the PR's changes
- [x] Store the summary in the `review_cycles` table (new `summary` column)
- [x] Also persist the summary in the tracking `.md` file under each review cycle entry
- [x] Display the summary on the PR detail page for each review cycle
- [x] Summary should cover: what files changed, what the PR does, key modifications
