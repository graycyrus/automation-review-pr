import { NextRequest, NextResponse } from 'next/server';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const after = parseInt(req.nextUrl.searchParams.get('after') || '0', 10);

  const job = triggerJobs.activeJobs.get(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const lines = job.logLines.slice(after);
  return NextResponse.json({
    jobId,
    done: job.done,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt || null,
    total: job.logLines.length,
    after,
    lines,
  });
}
