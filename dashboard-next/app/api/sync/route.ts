import { NextResponse } from 'next/server';
import path from 'path';
import { db, githubSync, parser } from '@/lib/server-deps';

export const dynamic = 'force-dynamic';

const BASE_DIR = path.resolve(process.cwd(), '..');
const TRACKING_DIR = path.join(BASE_DIR, 'tinyhumansai-openhuman');
const APPROVED_DIR = path.join(BASE_DIR, 'to-be-approved');
const FULLY_APPROVED_DIR = path.join(BASE_DIR, 'approved');

export async function POST() {
  try {
    const trackingPrs = parser.scanTrackingDir(TRACKING_DIR, 'tinyhumansai-openhuman');
    const approvedPrs = parser.scanTrackingDir(APPROVED_DIR, 'to-be-approved');
    const fullyApprovedPrs = parser.scanTrackingDir(FULLY_APPROVED_DIR, 'approved');
    const allPrs = [...trackingPrs, ...approvedPrs, ...fullyApprovedPrs];

    for (const { pr, cycles } of allPrs) {
      if (!pr.id) continue;
      db.upsertPr({
        id: pr.id,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base_branch: pr.base_branch,
        url: pr.url,
        created_at: pr.created_at,
        status: pr.status,
        is_member: null,
        last_reviewed_commit: pr.last_reviewed_commit,
        last_review_date: pr.last_review_date,
        tracking_file_path: pr.tracking_file_path,
        location: pr.location,
      });
      if (cycles.length > 0) db.replaceCyclesForPr(pr.id, cycles);
    }

    githubSync.fetchAllOpenPrs();
    return NextResponse.json({ synced: allPrs.length, github: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
