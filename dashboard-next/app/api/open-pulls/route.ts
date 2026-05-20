import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

const REPO = 'tinyhumansai/openhuman';

// Returns the set of currently-open PR numbers using the authenticated gh
// CLI (5000 req/hr) instead of hitting the public api.github.com from the
// browser (60 req/hr per IP) which we'd burn through within minutes.
// Server-side cache keeps load down further.
let _cache: { ids: number[]; at: number } | null = null;
const TTL_MS = 60 * 1000;

export async function GET() {
  const now = Date.now();
  if (_cache && now - _cache.at < TTL_MS) {
    return NextResponse.json({ ids: _cache.ids, cached: true });
  }
  try {
    const out = execSync(
      `gh pr list --repo ${REPO} --state open --limit 500 --json number --jq '[.[].number]'`,
      { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const ids: number[] = JSON.parse(out);
    _cache = { ids, at: now };
    return NextResponse.json({ ids, cached: false });
  } catch (err: any) {
    const msg = (err.stderr || err.message || '').toString();
    if (_cache) {
      // Surface stale list rather than empty so the UI doesn't blank out.
      return NextResponse.json({ ids: _cache.ids, cached: true, error: msg }, { status: 200 });
    }
    return NextResponse.json({ ids: [], error: msg }, { status: 500 });
  }
}
