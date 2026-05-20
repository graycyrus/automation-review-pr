import { NextResponse } from 'next/server';
import { getGhUser } from '@/lib/github-assign';

export const dynamic = 'force-dynamic';

// Returns the gh CLI's authenticated user. The UI uses `login` to highlight
// PRs assigned to "you" without a hardcoded username.
export async function GET() {
  const me = getGhUser();
  return NextResponse.json(me);
}
