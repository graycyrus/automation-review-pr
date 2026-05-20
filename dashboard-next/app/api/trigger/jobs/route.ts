import { NextResponse } from 'next/server';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jobs: Record<string, any> = {};
  for (const [id, job] of triggerJobs.activeJobs as Map<string, any>) {
    jobs[id] = {
      pid: job.pid,
      pr: job.pr,
      type: job.type,
      startedAt: job.startedAt,
      endedAt: job.endedAt || null,
      done: job.done,
      exitCode: job.exitCode,
      lineCount: job.logLines.length,
    };
  }
  return NextResponse.json(jobs);
}
