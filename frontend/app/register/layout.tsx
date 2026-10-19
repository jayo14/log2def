import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create Account',
  description:
    'Join Log2Def to transform your industrial training logbook photos into academic technical reports and prepare for your oral defense.',
  alternates: {
    canonical: '/register',
  },
  openGraph: {
    title: 'Create an Account on Log2Def — SIWES Report Platform',
    description:
      'Turn handwritten logbook pages into structured technical reports conforming to institutional guidelines.',
    url: '/register',
  },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
