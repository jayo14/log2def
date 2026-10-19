import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Manage your SIWES logbook entries, generate technical report chapters, and rehearse your oral defense.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
