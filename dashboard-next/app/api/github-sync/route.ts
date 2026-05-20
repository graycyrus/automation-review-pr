import { NextResponse } from 'next/server';
import { githubSync } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    githubSync.fetchAllOpenPrs();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
