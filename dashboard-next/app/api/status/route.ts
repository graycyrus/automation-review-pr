import { NextResponse } from 'next/server';
import { sync } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(sync.getLiveStatus() || { running: false });
}
