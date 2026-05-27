# Merge Criteria (EXTREMELY STRICT)

Merging is the highest-stakes action. If ANY check fails, DO NOT MERGE.

**ALL must be true:**
1. APPROVED by you this cycle (not stale from previous commit)
2. CI 100% green — `gh pr checks <N> --repo tinyhumansai/openhuman`
3. No merge conflicts — `gh pr view <N> --repo tinyhumansai/openhuman --json mergeable --jq '.mergeable'` = MERGEABLE
4. No unresolved threads
5. 30-min cooldown since approval
6. No dismissed reviews
7. AI summary says safe (no "High" risk or "not safe to merge")
8. HEAD matches approved commit — `gh pr view <N> --repo tinyhumansai/openhuman --json commits --jq '.commits[-1].oid'`
9. Not a draft, PR still open

**If ALL pass**: `gh pr merge <N> --repo tinyhumansai/openhuman --squash`
**If ANYTHING is off**: DO NOT MERGE. Log why, move on. Next cycle picks it up.
