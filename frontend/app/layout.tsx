import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Navbar } from "@/components/Navbar";
import { GlobalToast } from "@/components/ui/toast";
import { PWAManager } from "@/components/pwa-manager";
import { ServerWarmupIndicator } from "@/components/server-warmup-indicator";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://log2def.com";

export const viewport: Viewport = {
  themeColor: "#10b981",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Log2Def — SIWES Logbook to Defence Technical Report Generator",
    template: "%s | Log2Def",
  },
  description:
    "Transform daily SIWES logbook photos into academic technical reports matching institutional guidelines. Rehearse oral defence with mock quizzes, presentation slides, and speech scripts.",
  keywords: [
    "SIWES report",
    "SIWES logbook to report",
    "industrial training report",
    "technical report generator",
    "LASUSTECH SIWES",
    "ITF technical report",
    "SIWES defence rehearsal",
    "engineering technical report",
  ],
  authors: [{ name: "Log2Def Team" }],
  creator: "Log2Def",
  publisher: "Log2Def",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.json",
  applicationName: "Log2Def",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Log2Def",
  },
  openGraph: {
    title: "Log2Def — SIWES Logbook to Defence Technical Report Generator",
    description:
      "Transform daily SIWES logbook photos into academic technical reports matching institutional guidelines. Rehearse defence with mock questions, slides, and scripts.",
    url: appUrl,
    siteName: "Log2Def",
    locale: "en_NG",
    type: "website",
    images: [
      {
        url: "/icons/icon-512.png",
        width: 512,
        height: 512,
        alt: "Log2Def Logo — SIWES Technical Report Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Log2Def — SIWES Logbook to Defence Technical Report Generator",
    description:
      "Transform handwritten SIWES logbooks into academic reports and practice your oral defence.",
    images: ["/icons/icon-512.png"],
    creator: "@log2def",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

const jsonLdData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${appUrl}/#app`,
      name: "Log2Def",
      url: appUrl,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web, Android, iOS, Windows, macOS, Linux",
      description:
        "AI-powered academic platform converting SIWES industrial training logbook photos into formatted technical reports conforming to institutional guidelines and preparing students for oral defense.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "NGN",
      },
      featureList: [
        "Multi-photo logbook OCR extraction",
        "Automated institutional SIWES 5-chapter generation",
        "A4 1.5-inch binding margin layout with Roman/Arabic numbering",
        "In-editor chapter version history and instant reversion",
        "Direct academic browser printing and Word/PDF export",
        "Defence rehearsal mock quizzes with answer guidance",
        "Presentation slides generation with fullscreen projection",
        "Timed oral rehearsal stopwatch and presentation scripts",
      ],
    },
    {
      "@type": "Organization",
      "@id": `${appUrl}/#organization`,
      name: "Log2Def",
      url: appUrl,
      logo: `${appUrl}/logo.svg`,
      sameAs: [],
    },
    {
      "@type": "FAQPage",
      "@id": `${appUrl}/#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: "Does Log2Def fabricate work I didn't perform?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. It needs your reviewed logbook entries and placement details as its factual base, and turns concise notes into clear technical prose without inventing companies, tools or project outcomes.",
          },
        },
        {
          "@type": "Question",
          name: "Is Log2Def an official LASUSTECH portal?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. It is an independent productivity app built around LASUSTECH and Nigerian ITF guidelines. It does not replace your departmental submission process, so always review your report with your supervisor.",
          },
        },
        {
          "@type": "Question",
          name: "Can I edit my chapters after they are generated?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Every section has a rich-text editor with autosave. Once you edit a section it is locked, so regenerating other sections never overwrites it.",
          },
        },
        {
          "@type": "Question",
          name: "Can Log2Def run without an AI API key?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. A rule-based mode structures your placement details, weekly tables and challenges into full chapters with no external API key.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdData) }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Manrope:wght@400;500;600;700&family=Caveat:wght@500&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#FAF9F5] text-[#191919] selection:bg-emerald-100 selection:text-emerald-900">
        <AuthProvider>
          <Suspense fallback={null}>
            <PWAManager />
            <Navbar />
          </Suspense>
          <main className="flex-1 flex flex-col">{children}</main>
          <GlobalToast />
          <ServerWarmupIndicator />
        </AuthProvider>
      </body>
    </html>
  );
}
