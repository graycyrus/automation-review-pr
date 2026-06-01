## Update Tracking File

Write to `/Users/cyrus/Desktop/automation/review-pr/tinyhumansai-openhuman/PR-__PR_NUMBER__.md`:

```markdown
# PR #__PR_NUMBER__ — <title>

## Metadata
| Field | Value |
|-------|-------|
| Author | @<login> |
| Branch | <head> → <base> |
| Created | <YYYY-MM-DD> |
| URL | https://github.com/tinyhumansai/openhuman/pull/__PR_NUMBER__ |
| Status | <changes-requested \| clean \| blocked \| to-be-closed> |
| Last reviewed commit | <full sha> |
| Last review date | <ISO 8601 timestamp> |

## AI Summary
| Dimension | Rating | Detail |
|-----------|--------|--------|
| What it does | — | <2-3 sentences: plain English, what changes and why> |
| Breaking risk | Zero \| Low \| Medium \| High | <considers: public APIs, shared types, DB schemas, config formats, exports> |
| Security risk | Zero \| Low \| Medium \| High | <considers: OWASP items, secrets, auth, injection surfaces> |
| Bottom line | Safe \| Not safe | <one sentence: "Safe to merge" or "Not safe — [reason]"> |

## AI Quality
| Signal | Detected | Detail |
|--------|----------|--------|
| AI slop | Yes \| No | <if yes: which signals triggered — e.g., "excessive comments on obvious code, generic variable names, no tests for 500+ line feature"> |
| Structural signals | <list or "None"> | <over-abstraction, redundant comments, boilerplate, copy-paste patterns> |
| Content signals | <list or "None"> | <generic names, placeholder TODOs, dead code, uniform style> |
| Behavioral signals | <list or "None"> | <large PR no tests, scope mismatch, inconsistent style, shotgun changes> |

## UI Impact
| Dimension | Value |
|-----------|-------|
| Visual change | <what the user sees differently, or "None — no frontend changes"> |
| User flow | Unchanged \| Modified — <how> |
| Affected surfaces | <list of pages/components, or "N/A"> |
| Responsiveness | <checked / not applicable> |
| Accessibility | <checked / not applicable> |
| i18n | <checked / not applicable / missing keys listed> |
| Performance | <checked / not applicable / concerns listed> |
| Edge states | <checked / not applicable / missing states listed> |
| Risk | None \| Low \| Medium \| High |
| Recommendation | <approve as-is \| needs screenshot \| needs design review \| needs QA> |

## Review History

### Review <n> — <ISO 8601 timestamp>

#### Context
| Field | Value |
|-------|-------|
| Type | Fresh \| Continuation |
| Commit | <full sha> |
| Gates | CI <pass\|fail\|pending> \| Conflicts <pass\|fail> \| Feedback <pass\|fail> |
| Areas changed | <areas> |
| Linked issues | <#NNN, #NNN or "None"> |
| PR-Issue alignment | <details or "N/A"> |

#### Analysis
| Field | Value |
|-------|-------|
| Summary | <2-3 sentences: what changed, what the PR does, key modifications> |
| CodeRabbit dedup | <what was skipped, or "N/A"> |
| Resolution actions | <thread actions, or "None"> |
| Surrounding code checked | <modules + files read, or "None"> |
| Dependency audit | <findings or "N/A"> |
| Test coverage | <findings or "N/A"> |
| Impact scan | <findings or "N/A"> |

#### Findings
- [critical] <file:line> — <description>
- [major] <file:line> — <description>
- [minor] <file:line> — <description>

_(Write "None" if no findings)_

#### Outcome
| Field | Value |
|-------|-------|
| Action taken | <APPROVE \| REQUEST_CHANGES \| COMMENT — with brief reason> |
| GitHub review URL | <link or "N/A"> |
```

For continuation reviews, **append** a new "Review <n>" section — don't overwrite prior sections.

### Status logic
- 0 critical/major + all prior `graycyrus` changes resolved → `clean` → **move** to `/Users/cyrus/Desktop/automation/review-pr/to-be-approved/PR-__PR_NUMBER__.md`
- Any critical/major → `changes-requested` → keep in `tinyhumansai-openhuman/`
- BLOCKED (mismatch) → `blocked` → keep in `tinyhumansai-openhuman/`
- Low-value/junk PR → `to-be-closed` → **move** to `/Users/cyrus/Desktop/automation/review-pr/to-be-closed/PR-__PR_NUMBER__.md`

---
