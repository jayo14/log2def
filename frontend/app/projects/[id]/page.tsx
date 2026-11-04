'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useProjectStore } from '@/lib/store';

function ProjectRedirectContent() {
  const params = useParams();
  const projectId = params?.id ? Number(params.id) : null;
  const router = useRouter();
  const { fetchActiveProject } = useProjectStore();

  useEffect(() => {
    if (projectId) {
      fetchActiveProject(projectId)
        .catch(() => null)
        .finally(() => {
          router.replace('/dashboard#home');
        });
    } else {
      router.replace('/dashboard#home');
    }
  }, [projectId, router, fetchActiveProject]);

  return (
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
        Opening your report...
      </p>
    </div>
  );
}

export default function ProjectRedirect() {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100dvh',
        background: 'var(--paper, #f8f6f1)',
      }}
    >
      <Suspense
        fallback={
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Manrope', system-ui, sans-serif", fontSize: '14px', color: '#5f6761' }}>
              Loading...
            </p>
          </div>
        }
      >
        <ProjectRedirectContent />
      </Suspense>
    </div>
  );
}
