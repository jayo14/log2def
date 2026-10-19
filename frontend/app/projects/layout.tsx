import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Report Projects',
  description: 'SIWES technical report projects on Log2Def.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
