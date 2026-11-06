'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProjectStore } from '@/lib/store';

function GuidedIntakeRedirect() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params?.id || '');

  useEffect(() => {
    if (projectId) {
      try {
        useProjectStore.getState().setActiveProject({ id: projectId } as any);
      } catch {
        // ignore
      }
    }
    router.replace('/dashboard?step=5#step-5');
  }, [projectId, router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      <p className="mt-4 text-sm font-medium text-slate-700">Opening organisation questions in mobile interface…</p>
      <a href="/dashboard?step=5#step-5" className="mt-3 text-xs text-emerald-800 underline">
        Click here if not redirected automatically
      </a>
    </div>
  );
}

export default function GuidedIntakePage() {
  return (
    <Suspense fallback={null}>
      <GuidedIntakeRedirect />
    </Suspense>
  );
}
