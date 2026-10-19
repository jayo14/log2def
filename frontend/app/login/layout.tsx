import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description:
    'Sign in to Log2Def to continue editing your SIWES logbook entries, generate technical report chapters, and rehearse your oral defense.',
  alternates: {
    canonical: '/login',
  },
  openGraph: {
    title: 'Sign In to Log2Def — SIWES Technical Report Platform',
    description:
      'Access your industrial training logbook drafts and defense presentation materials.',
    url: '/login',
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
