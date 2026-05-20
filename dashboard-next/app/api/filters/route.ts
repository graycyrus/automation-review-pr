import { NextResponse } from 'next/server';
import { db } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(db.getFilterOptions());
}
