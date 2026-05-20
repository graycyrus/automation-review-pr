import { execSync } from 'child_process';

const REPO = 'tinyhumansai/openhuman';

// Cache the authenticated gh CLI login. It only changes when the user
// re-auths, which doesn't happen mid-session, so a process-lifetime cache
// is fine.
let _ghLogin: string | null = null;
let _ghName: string | null = null;

export function getGhUser(): { login: string | null; name: string | null } {
  if (_ghLogin) return { login: _ghLogin, name: _ghName };
  try {
    const out = execSync(`gh api user`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const me = JSON.parse(out);
    _ghLogin = me.login || null;
    _ghName = me.name || me.login || null;
  } catch (err: any) {
    console.warn(`[assign] gh api user failed: ${err.message}`);
  }
  return { login: _ghLogin, name: _ghName };
}

// Best-effort assignee add. Uses whatever account `gh` is logged in as, so
// the person actually pressing the button gets the assignment. If the call
// fails (already assigned, API down, rate-limited, etc.) the caller
// proceeds anyway — assignment shouldn't block the workflow.
export function assignReviewer(prId: number): { assigned: boolean; assignee?: string; error?: string } {
  const { login } = getGhUser();
  if (!login) {
    return { assigned: false, error: 'gh CLI not authenticated' };
  }
  try {
    execSync(`gh pr edit ${prId} --repo ${REPO} --add-assignee ${login}`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { assigned: true, assignee: login };
  } catch (err: any) {
    const msg = (err.stderr || err.message || '').toString().trim();
    console.warn(`[assign] Could not assign ${login} to PR #${prId}: ${msg}`);
    return { assigned: false, assignee: login, error: msg };
  }
}
