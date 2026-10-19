'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { 
  ArrowRight, UploadCloud, FileText, Award, CheckCircle2, 
  HelpCircle, ShieldCheck, Download, Sparkles, BookOpen 
} from 'lucide-react';

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 border-b border-border/60 bg-gradient-to-b from-[#F7F6F0] to-[#FAF9F5]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
            Designed for LASUSTECH & Nigerian Universities
          </div>
          
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground font-serif leading-[1.15]">
            From logbook to <br className="hidden sm:inline" />
            <span className="text-emerald-800 italic">defence-ready</span>.
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Turn your real SIWES logbook entries, photos, and rough technical notes into a structured, editable, printable technical report — and prepare to defend it with confidence.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={user ? "/dashboard" : "/register"}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-emerald-800 text-white font-medium text-base hover:bg-emerald-900 shadow-sm transition-all hover:gap-3"
            >
              Create your report
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 rounded-lg border border-border bg-white text-foreground font-medium text-base hover:bg-muted/70 transition-colors"
            >
              See how it works
            </a>
          </div>

          <div className="mt-12 flex items-center justify-center gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" /> Grounded in your real work
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" /> A4 DOCX & PDF exports
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" /> Mock defence exam
            </span>
          </div>
        </div>
      </section>

      {/* 3-Step Process */}
      <section id="how-it-works" className="py-16 md:py-24 border-b border-border/60 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-xl mx-auto mb-16">
            <h2 className="text-xs font-mono uppercase tracking-widest text-emerald-800 font-semibold">Workflow</h2>
            <p className="mt-2 text-3xl font-bold font-serif text-foreground">Three clear steps to your defence</p>
            <p className="mt-3 text-muted-foreground text-sm">No fabricated work. No complex prompt engineering.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="p-6 rounded-xl border border-border/80 bg-[#FAF9F5]/50 flex flex-col items-start">
              <div className="w-10 h-10 rounded-lg bg-emerald-800/10 text-emerald-800 font-mono font-bold flex items-center justify-center text-sm mb-4">
                01
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Upload & Verify</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Upload scans, photos, PDF pages, or typed notes of your weekly entries. Review extracted text, correct handwriting discrepancies, and verify each milestone.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border/80 bg-[#FAF9F5]/50 flex flex-col items-start">
              <div className="w-10 h-10 rounded-lg bg-emerald-800/10 text-emerald-800 font-mono font-bold flex items-center justify-center text-sm mb-4">
                02
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Generate & Edit</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Log2Def organizes your verified entries into standard 5-chapter SIWES report sections (Preliminary pages, Intro, Profile, Activities, Challenges, Conclusion). Edit freely in the rich-text workspace.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border/80 bg-[#FAF9F5]/50 flex flex-col items-start">
              <div className="w-10 h-10 rounded-lg bg-emerald-800/10 text-emerald-800 font-mono font-bold flex items-center justify-center text-sm mb-4">
                03
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Export & Prepare</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Download verified A4 Word (DOCX) and PDF documents with standard 1.5-inch binding margins. Then drill through 15+ mock defence questions grounded in your actual report.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Deep Dive */}
      <section className="py-16 md:py-24 border-b border-border/60 bg-[#FAF9F5]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-xl mx-auto mb-16">
            <h2 className="text-xs font-mono uppercase tracking-widest text-emerald-800 font-semibold">Features</h2>
            <p className="mt-2 text-3xl font-bold font-serif text-foreground">Built for technical integrity</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl border border-border bg-white shadow-xs">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-md bg-emerald-50 text-emerald-800">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base text-foreground">Smart Document Extraction</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Accepts multi-page PDFs, high-res photos, DOCX notes, and typed text. Highlights low-confidence handwriting so you can correct pages yourself instead of trusting fake hallucinations.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-white shadow-xs">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-md bg-emerald-50 text-emerald-800">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base text-foreground">Institutional 5-Chapter Template</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Adheres to LASUSTECH and Nigerian ITF technical report structures: Cover page, Certification with supervisor sign-offs, Weekly Log tables, Technical Procedures, and Recommendations.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-white shadow-xs">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-md bg-emerald-50 text-emerald-800">
                  <Download className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base text-foreground">Real Academic Export (DOCX & PDF)</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Generates authentic Word documents with 1.5-inch left margins for binding, 1.5 line spacing, Times New Roman typography, and LibreOffice-rendered PDFs with matching pagination.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-white shadow-xs">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-md bg-emerald-50 text-emerald-800">
                  <Award className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base text-foreground">Grounded Defence Workspace</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Generates realistic oral defence questions categorized by tasks, tools, troubleshooting, and examiner cross-examination. Step through mock oral exams and track questions you need to review.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Honest FAQ */}
      <section className="py-16 md:py-24 bg-white border-b border-border/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-xs font-mono uppercase tracking-widest text-emerald-800 font-semibold">Honest Answers</h2>
            <p className="mt-2 text-3xl font-bold font-serif text-foreground">Frequently Asked Questions</p>
          </div>

          <div className="space-y-6">
            <div className="p-5 rounded-lg border border-border/70 bg-[#FAF9F5]/40">
              <h3 className="text-base font-semibold text-foreground mb-2">Does Log2Def fabricate work I didn't perform?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                No. Log2Def strictly requires your reviewed logbook entries and placement inputs as its factual foundation. It turns concise notes into coherent technical prose without inventing fake companies, fabricated tools, or false project outcomes.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-border/70 bg-[#FAF9F5]/40">
              <h3 className="text-base font-semibold text-foreground mb-2">Is Log2Def an official LASUSTECH software portal?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Log2Def is an independent academic productivity application built around LASUSTECH and Nigerian ITF technical guidelines. It does not replace your official departmental submission process. You must always review and verify your report with your supervisor.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-border/70 bg-[#FAF9F5]/40">
              <h3 className="text-base font-semibold text-foreground mb-2">Can I edit my chapters after they are generated?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Yes. Every single section has a full rich-text editor with autosave. When you edit a section, your changes are locked so subsequent regenerations of other sections will not clobber your custom text.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-border/70 bg-[#FAF9F5]/40">
              <h3 className="text-base font-semibold text-foreground mb-2">Can Log2Def run without an AI API key?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Yes. Log2Def includes a robust No-AI Development Mode that uses deterministic rule-based template generation. It structures your real placement details, weekly tables, and challenges into complete academic chapters without requiring an external API key.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer Banner */}
      <section className="py-16 bg-[#111827] text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-serif font-bold tracking-tight">Ready to compile your SIWES report?</h2>
          <p className="mt-3 text-gray-300 text-sm max-w-lg mx-auto">
            Get your handwritten logbook organized, generate your 5-chapter report, and practice your defence questions today.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              href={user ? "/dashboard" : "/register"}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-500 transition-colors shadow-sm"
            >
              Start Your Report Project
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-white border-t border-border text-center text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Log2Def. Built for Nigerian higher institutions.</p>
          <p className="text-[11px]">Academic integrity notice: Always review and verify all generated content before submission.</p>
        </div>
      </footer>
    </div>
  );
}
