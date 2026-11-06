'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Squad redirects the customer here after payment via the `callback_url`
 * set at checkout initialization (`{FRONTEND_URL}/dashboard/payment-callback`).
 *
 * Squad appends its callback params (e.g. ?reference=..., ?error=...). This
 * page forwards them to /dashboard where the existing `handleSquadCallback`
   effect verifies the transaction and unlocks the report.
 */
function PaymentCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const reference =
      searchParams.get('reference') ||
      searchParams.get('transaction_ref') ||
      searchParams.get('transaction_reference') ||
      searchParams.get('transactionRef');
    const orderRef = searchParams.get('order_ref') || '';
    const type = searchParams.get('type') || '';
    const error = searchParams.get('error') || '';

    if (error) {
      router.replace('/dashboard');
      return;
    }

    const params = new URLSearchParams();
    if (reference) params.set('transaction_ref', reference);
    if (orderRef) params.set('order_ref', orderRef);
    if (type) params.set('type', type);
    params.set('status', 'paid');

    router.replace(`/dashboard?${params.toString()}`);
  }, [router, searchParams]);

  return null;
}

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={null}>
      <PaymentCallbackContent />
    </Suspense>
  );
}
