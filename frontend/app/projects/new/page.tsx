'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewProjectRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard?tab=reports&action=new');
  }, [router]);

  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100dvh',
        background: 'var(--paper, #f8f6f1)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            border: '3px solid #066b4d',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 14px',
          }}
        />
        <p
          style={{
            fontFamily: "'Manrope', system-ui, sans-serif",
            fontSize: '14px',
            color: '#5f6761',
            fontWeight: 600,
          }}
        >
          Starting new report setup...
        </p>
      </div>
    </div>
  );
}
