'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Squad's server-side callback (/squad/callback) redirects the customer here
 * on failure: {FRONTEND_URL}/dashboard/payment-failed?order_ref=&error=.
 *
 * Forwards the error to /dashboard where `handleSquadCallback` shows the
 * "payment not completed" toast.
 */
export default function PaymentFailedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams.get('error') || '';
    const orderRef = searchParams.get('order_ref') || '';

    const params = new URLSearchParams();
    if (error) params.set('error', error);
    if (orderRef) params.set('order_ref', orderRef);

    router.replace(`/dashboard?${params.toString()}`);
  }, [router, searchParams]);

  return null;
}
