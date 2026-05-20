import { NextResponse } from 'next/server';
import { db, sync } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = db.getStats();
  const liveStatus = sync.getLiveStatus();
  return NextResponse.json({ ...stats, liveStatus });
}
