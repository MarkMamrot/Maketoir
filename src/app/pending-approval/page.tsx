'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ApplicationStatus {
  status: 'pending_review' | 'approved' | 'rejected';
  businessName: string;
  reviewReason: string | null;
  createdAt: string;
}

export default function PendingApprovalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState<ApplicationStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/business-applications')
      .then(async res => {
        if (res.status === 401) { router.push('/login'); return null; }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        if (!data.success || !data.application) { router.push('/new-business'); return; }
        setApplication({
          status: data.application.status,
          businessName: data.application.business_name,
          reviewReason: data.application.review_reason,
          createdAt: data.application.created_at,
        });
        setLoading(false);
      })
      .catch(() => setError('Could not load your application status.'));
  }, [router]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">Loading…</main>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200 text-center">
        <h1 className="text-2xl font-extrabold text-blue-600 mb-1">Solvantis</h1>

        {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

        {application?.status === 'pending_review' && (
          <>
            <p className="text-lg font-bold mt-4">Application submitted</p>
            <p className="text-sm text-gray-600 mt-2">
              Thanks — our team is reviewing your application for <strong>{application.businessName}</strong>.
              We&apos;ll email you as soon as it&apos;s approved and your workspace is ready.
            </p>
          </>
        )}

        {application?.status === 'rejected' && (
          <>
            <p className="text-lg font-bold mt-4 text-red-600">Application not approved</p>
            {application.reviewReason && (
              <p className="text-sm text-gray-600 mt-2">{application.reviewReason}</p>
            )}
            <a href="/new-business" className="inline-block mt-4 text-blue-600 hover:underline font-bold text-sm">
              Update and resubmit your application
            </a>
          </>
        )}

        {application?.status === 'approved' && (
          <>
            <p className="text-lg font-bold mt-4 text-green-600">Application approved</p>
            <p className="text-sm text-gray-600 mt-2">Your workspace is ready.</p>
            <a href="/login" className="inline-block mt-4 text-blue-600 hover:underline font-bold text-sm">Sign in</a>
          </>
        )}
      </div>
    </main>
  );
}
