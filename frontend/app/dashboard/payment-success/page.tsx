'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Squad's server-side callback (/squad/callback) redirects the customer here
 * on success: {FRONTEND_URL}/dashboard/payment-success?order_ref=&transaction_ref=&type=.
 *
 * Forwards the verification params to /dashboard where `handleSquadCallback`
 * verifies the transaction and unlocks the report.
 */
function PaymentSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const transactionRef =
      searchParams.get('transaction_ref') ||
      searchParams.get('transaction_reference') ||
      searchParams.get('transactionRef') ||
      searchParams.get('reference');
    const orderRef = searchParams.get('order_ref') || '';
    const type = searchParams.get('type') || '';
    const error = searchParams.get('error') || '';

    if (error) {
      router.replace('/dashboard');
      return;
    }

    const params = new URLSearchParams();
    if (transactionRef) params.set('transaction_ref', transactionRef);
    if (orderRef) params.set('order_ref', orderRef);
    if (type) params.set('type', type);
    params.set('status', 'paid');

    router.replace(`/dashboard?${params.toString()}`);
  }, [router, searchParams]);

  return null;
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={null}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
