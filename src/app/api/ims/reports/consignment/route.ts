import { GET as activityReport } from '@/app/api/ims/consignment/activity/route';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) { return activityReport(req); }
