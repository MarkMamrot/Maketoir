'use client';

import { useEffect } from 'react';
import { legacyDashboardDestination } from '@/lib/navigation/imsAutomationNavigation';

export default function DashboardRedirectPage() {
  useEffect(() => {
    window.location.replace(legacyDashboardDestination(window.location.hash, window.location.search));
  }, []);
  return <p role="status">Opening IMS...</p>;
}
