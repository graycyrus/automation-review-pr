# Plan: Optimize Token Usage + Model Migration

## Status

- **Phase 1**: DONE — haiku routing, budget caps, identity compression, no-op skip
- **Phase 2**: DONE — model routing (simple→haiku, complex→sonnet), .env config
- **Phase 3**: TODO — API wrapper + Gemini Flash (recommended next step)
- **Phase 4**: TODO — structural optimizations (diff pre-fetch, incremental diffs)

**Current cost: ~$25-40/month** (down from ~$252/month)

---

## Phase 1: Quick Wins — DONE

- Haiku for discover + judge calls (`--model haiku`)
- Budget caps: $0.10 discover, $0.15 judge, $0.50 per review
- Compressed `cyrus.md` from 1,526 → 504 words (67% reduction)
- Extracted merge criteria to `merge-criteria.md` (only injected when relevant)
- Pre-discovery skip when 0 open PRs
- .env loading in cron script

## Phase 2: Model Routing — DONE

- Simple PRs (no logic changes) → haiku
- Medium/complex PRs → sonnet
- Configurable via `.env`: `MODEL_DISCOVER`, `MODEL_REVIEW_SIMPLE`, `MODEL_REVIEW_COMPLEX`, `MODEL_JUDGE`

---

## Phase 3: Gemini 2.5 Flash Integration (RECOMMENDED NEXT)

Target: $25-40 → ~$8-15/month.

### Why Gemini Flash

| Option | Pricing (input/output per MTok) | Tool use | Code review quality | Verdict |
|--------|-------------------------------|----------|-------------------|---------|
| Claude Sonnet | $3 / $15 | Excellent | Excellent | Current — expensive |
| Claude Haiku | $0.25 / $1.25 | Good | Good for simple | Already using |
| **Gemini 2.5 Flash** | **$0.15 / $0.60** | **Good** | **Good** | **Best cost/quality** |
| GPT-4.1-mini | $0.40 / $1.60 | Good | Good | 3x more than Gemini |
| DeepSeek V3 | $0.07 / $0.14 | Unreliable | Decent | Tool use too janky for unattended cron |
| Qwen 3 | $0.10 / $0.30 | Basic | Decent | Weak tool use |
| Local LLMs (70B) | Free (electricity) | Bad | Poor on large diffs | NOT recommended |

### Why NOT local LLMs

- Tool use is unreliable — hallucinated/malformed tool calls break the unattended cron
- Code review quality drops hard on 500+ line diffs — summarizes instead of analyzing
- Can't follow complex multi-step prompts (identity + overrides + CI gating + tracking)
- `claude -p` CLI only works with Anthropic — would need full tool-use loop rebuild
- Electricity + GPU cost ≈ cloud cost for comparable quality
- Missed bugs cost more than $40/month

### Implementation plan

1. **Build `llm-wrapper.js`** — thin Node.js script that implements a tool-use loop:
   - Takes: prompt, model, provider (anthropic/google), tool definitions
   - Runs the tool-use loop: model requests tool → wrapper executes locally → sends result back
   - Tools: Bash (shell exec), Read (file read), Write (file write)
   - Logs token usage per call for cost tracking

2. **Add Anthropic API direct calls** with prompt caching:
   - Mark static prompt sections (header, core-steps, identity) with `cache_control`
   - All 25 parallel reviews hit the same cache → 90% discount on cached input tokens
   - This alone could cut the Sonnet review cost by ~80%

3. **Add Google AI (Gemini) support**:
   - Use `@google/generative-ai` SDK
   - Map tool definitions to Gemini's function calling format
   - Route simple PRs to Gemini Flash, complex to Sonnet

4. **Update `review-single.sh`** to call `llm-wrapper.js` instead of `claude -p`:
   ```bash
   node "${SCRIPT_DIR}/llm-wrapper.js" \
     --model "${REVIEW_MODEL}" \
     --provider "${REVIEW_PROVIDER}" \
     --prompt "${PROMPT}" \
     --tools "Bash,Read,Write" \
     --repo-dir "${REPO_DIR}" \
     --max-budget 0.50
   ```

5. **Update `.env`**:
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   GOOGLE_AI_API_KEY=AI...
   MODEL_REVIEW_SIMPLE=gemini-2.5-flash
   MODEL_REVIEW_COMPLEX=claude-sonnet-4-6
   PROVIDER_REVIEW_SIMPLE=google
   PROVIDER_REVIEW_COMPLEX=anthropic
   ```

### Estimated effort: 1-2 days

### Cost projection with Gemini Flash

| Call type | Count/month (hourly) | Model | Cost/month |
|-----------|---------------------|-------|-----------|
| Discover | 720 | Haiku | ~$1 |
| Simple reviews (~60%) | 10,800 | Gemini Flash | ~$5 |
| Complex reviews (~40%) | 7,200 | Sonnet + cache | ~$8 |
| Judge | 720 | Haiku | ~$1 |
| **Total** | | | **~$15** |

---

## Phase 4: Structural Optimizations (Lower Priority)

Target: ~$15 → ~$8-10/month. Only worth it if Phase 3 isn't enough.

### 4a. Pre-fetch diffs in bash, inject into prompt

Currently the LLM runs `gh pr diff` as a tool call — the full diff becomes context tokens. Instead:
- Fetch diff in the bash pre-check (already partially done with `--stat`)
- For large PRs (>1000 lines), inject only changed hunks relevant to logic files
- Skip test file diffs unless the PR is test-only

### 4b. Incremental diffs for continuation reviews

For PRs reviewed before, compute `git diff <last-reviewed-commit>..HEAD` and only inject the new changes. Currently re-reads the entire diff every cycle.

### 4c. Batch judge runs

Run the judge every 4th cron cycle instead of every cycle. Reviews don't change that fast — judging 4x worth of reviews at once is more token-efficient.

### 4d. Smart cron frequency

Instead of fixed hourly, check GitHub webhook events or poll `gh pr list` timestamps. Only run the full cron when PRs have actually changed since last run.

---

## Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Phase 1+2 implemented | Quick wins, 85% cost reduction |
| 2026-05-27 | Local LLMs rejected | Tool use too unreliable, quality too low for unattended reviews |
| 2026-05-27 | Gemini Flash recommended for Phase 3 | Best cost/quality for code review, reliable tool use, 20x cheaper than Sonnet |
| 2026-05-27 | DeepSeek rejected for reviews | Tool use unreliable in loops, OK for one-shot but not for unattended cron |
