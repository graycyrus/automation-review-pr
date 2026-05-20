import { NextResponse } from 'next/server';
import path from 'path';
import { triggerJobs } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const CRON_SCRIPT = path.join(triggerJobs.BASE_DIR, 'cron-pr-review.sh');

export async function POST() {
  if (triggerJobs.activeJobs.has('discover')) {
    return NextResponse.json({ error: 'Discovery is already running' }, { status: 409 });
  }

  const logFile = path.join(triggerJobs.LOGS_DIR, `review-${triggerJobs.timestamp()}.log`);
  const job = triggerJobs.startJob({
    jobId: 'discover',
    command: 'bash',
    args: [CRON_SCRIPT],
    logFile,
    type: 'discover',
    pr: null,
    onClose: (code: number) => console.log(`[trigger] Discovery finished with code ${code}`),
  });

  if (!job) {
    return NextResponse.json({ error: 'Job already running' }, { status: 409 });
  }

  return NextResponse.json({ jobId: 'discover', pid: job.pid, logFile, message: 'Discovery started' });
}
