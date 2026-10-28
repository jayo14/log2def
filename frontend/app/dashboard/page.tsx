'use client';

import React, { useEffect, useState, useRef, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  useAuthStore,
  useProjectStore,
  useReportStore,
  useDefenceStore,
  useUIStore,
} from '@/lib/store';
import { projectsApi } from '@/lib/api';
import {
  enqueueUploads,
  getQueuedUploads,
  processUploadQueue,
  clearCompletedUploads,
  QueuedUpload,
} from '@/lib/offline-queue';
import { detectDeviceOS, isStandaloneApp, DeviceOS } from '@/lib/device';
import '@/app/dashboard.css';

export default function DashboardPage() {
  const { user, isLoading: authLoading, logout, refreshUser } = useAuth();
  const router = useRouter();

  // Project & Data Stores
  const {
    projects,
    activeProject,
    isLoadingProjects,
    fetchProjects,
    fetchActiveProject,
    createProject,
    uploadGuideline: storeUploadGuideline,
    uploadDocument: storeUploadDocument,
    deleteDocument: storeDeleteDocument,
    reprocessDocument: storeReprocessDocument,
    updatePage: storeUpdatePage,
    createLogbookEntry: storeCreateLogbookEntry,
    updateLogbookEntry: storeUpdateLogbookEntry,
    deleteLogbookEntry: storeDeleteLogbookEntry,
    bulkVerifyEntries: storeBulkVerifyEntries,
  } = useProjectStore();

  const {
    report,
    activeSectionId,
    fetchReport,
    generateReport: storeGenerateReport,
    saveSection: storeSaveSection,
    regenerateSection: storeRegenerateSection,
    versions: reportVersions,
    isLoadingVersions,
    fetchVersions: storeFetchVersions,
    createVersion: storeCreateVersion,
    revertVersion: storeRevertVersion,
    downloadDocx: storeDownloadDocx,
    downloadPdf: storeDownloadPdf,
    isGeneratingReport,
  } = useReportStore();

  const {
    questions: defenceQuestions,
    fetchQuestions,
    generateQuestions: storeGenerateDefence,
    updateQuestion: storeUpdateDefenceQuestion,
    slides: defenceSlides,
    script: defenceScript,
    isLoadingSlides,
    isLoadingScript,
    slideshowOpen,
    slideshowIndex,
    fetchSlides: storeFetchSlides,
    regenerateSlides: storeRegenerateSlides,
    fetchScript: storeFetchScript,
    regenerateScript: storeRegenerateScript,
    openSlideshow,
    closeSlideshow,
    nextSlide,
    prevSlide,
  } = useDefenceStore();

  const { showToast } = useUIStore();

  // Navigation tab state: 'home' | 'logbook' | 'report' | 'defence' | 'new'
  const [currentTab, setCurrentTab] = useState<'home' | 'logbook' | 'report' | 'defence' | 'new'>('home');
  const [logbookTab, setLogbookTab] = useState<'entries' | 'docs'>('entries');
  const [reportTab, setReportTab] = useState<'editor' | 'preview' | 'versions' | 'export'>('editor');
  const [defenceTab, setDefenceTab] = useState<'quiz' | 'interview' | 'slides' | 'script'>('interview');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number>(0);

  // Multi-file upload progress & offline queue
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [uploadQueue, setUploadQueue] = useState<QueuedUpload[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Speech rehearsal timer
  const [isSpeechTimerRunning, setIsSpeechTimerRunning] = useState(false);
  const [speechTimerSeconds, setSpeechTimerSeconds] = useState(0);
  const [showSpeakerNotes, setShowSpeakerNotes] = useState(false);

  // PWA Offline & Install Prompt states
  const [isOffline, setIsOffline] = useState(false);
  const [canInstallPWA, setCanInstallPWA] = useState(false);
  const [deviceOS, setDeviceOS] = useState<DeviceOS>('pc');

  // Version snapshot note draft
  const [newVersionSummary, setNewVersionSummary] = useState('');

  // Local UI & Scroll states
  const [isScrolled, setIsScrolled] = useState(false);
  const [animDir, setAnimDir] = useState<'fw' | 'bw'>('fw');
  const scrRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');

  // Interactive Bottom Sheet Modal state
  const [activeSheet, setActiveSheet] = useState<
    'me' | 'addEntry' | 'typeNotes' | 'correctText' | 'addVersion' | 'pwaGuide' | 'uploadGuideline' | null
  >(null);
  const [correctingDocIdx, setCorrectingDocIdx] = useState<number>(0);
  const [correctingText, setCorrectingText] = useState<string>('');

  // Guideline upload draft
  const [guidelineInputUniversity, setGuidelineInputUniversity] = useState('Lagos State University of Science and Technology (LASUSTECH)');
  const [guidelineInputText, setGuidelineInputText] = useState('');
  const [guidelineInputFile, setGuidelineInputFile] = useState<File | null>(null);
  const [isUploadingGuideline, setIsUploadingGuideline] = useState(false);

  // Live Voice Defence Simulation states
  const [interviewQIdx, setInterviewQIdx] = useState(0);
  const [isSupervisorSpeaking, setIsSupervisorSpeaking] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [studentSpokenAnswer, setStudentSpokenAnswer] = useState('');
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const [voiceEvaluation, setVoiceEvaluation] = useState<{
    score: number;
    verdict: string;
    strengths: string;
    tips: string;
  } | null>(null);
  const [isEvaluatingAnswer, setIsEvaluatingAnswer] = useState(false);
  const speechRecognitionRef = useRef<any>(null);

  // Manual entry modal form draft
  const [manualWeek, setManualWeek] = useState<number>(3);
  const [manualText, setManualText] = useState<string>('');
  const [rawNotes, setRawNotes] = useState<string>('');

  // Full-screen Mock Defence Exam state
  const [examOpen, setExamOpen] = useState(false);
  const [examIndex, setExamIndex] = useState(0);
  const [examRevealed, setExamRevealed] = useState(false);
  const [revealedDefenceAnswers, setRevealedDefenceAnswers] = useState<Record<number, boolean>>({});

  // 6-step Wizard State for 'new' tab
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardErrors, setWizardErrors] = useState<Record<string, string>>({});
  const [wizardData, setWizardData] = useState({
    name: '',
    matric: '',
    dept: '',
    prog: '',
    level: '400 Level (Final Year SIWES)',
    uni: 'Lagos State University of Science and Technology (LASUSTECH)',
    fac: 'College of Applied Sciences and Technology',
    guide: '',
    host: '',
    unit: '',
    addr: '',
    sum: '',
    sup: '',
    supT: '',
    inst: '',
    start: '',
    end: '',
    tools: '',
    tasks: '',
    projs: '',
    prob: '',
    skills: '',
  });

  // Local Toast notification
  const [localToast, setLocalToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  const [isPreview, setIsPreview] = useState(false);

  const triggerToast = (msg: string) => {
    setLocalToast({ message: msg, visible: true });
    setTimeout(() => {
      setLocalToast((prev) => ({ ...prev, visible: false }));
    }, 2300);
  };

  // Check URL params, tokens, and hash on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = window.location.search;
    if (search.includes('preview=1') || search.includes('demo=1')) {
      setIsPreview(true);
    }
    const params = new URLSearchParams(search);
    const urlToken = params.get('token');
    if (urlToken) {
      import('@/lib/api').then(({ setAuthToken }) => {
        setAuthToken(urlToken);
        useAuthStore.getState().refreshUser();
      });
    }
    const hash = window.location.hash.replace('#/', '').split('/')[0];
    if (['home', 'logbook', 'report', 'defence', 'new'].includes(hash)) {
      setCurrentTab(hash as any);
    }
    const handleHashChange = () => {
      const h = window.location.hash.replace('#/', '').split('/')[0];
      if (['home', 'logbook', 'report', 'defence', 'new'].includes(h)) {
        setCurrentTab(h as any);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Auth redirect
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (window.location.search.includes('preview=1') || window.location.search.includes('token=')) {
        return;
      }
    }
    if (!authLoading && !user && !isPreview) {
      router.push('/login');
    }
  }, [user, authLoading, isPreview, router]);

  // Load projects list on mount
  useEffect(() => {
    if (user) {
      fetchProjects().then((projs) => {
        if (projs && projs.length > 0 && !activeProject) {
          fetchActiveProject(projs[0].id);
        }
      });
    }
  }, [user]);

  // Load active project details (logbook, report, defence, versions, slides, script, upload queue)
  useEffect(() => {
    if (activeProject?.id) {
      fetchReport(activeProject.id).catch(() => null);
      fetchQuestions(activeProject.id).catch(() => []);
      storeFetchVersions(activeProject.id).catch(() => []);
      storeFetchSlides(activeProject.id).catch(() => []);
      storeFetchScript(activeProject.id).catch(() => '');
      getQueuedUploads(activeProject.id).then(setUploadQueue).catch(() => []);
    }
  }, [activeProject?.id]);

  // Rehearsal stopwatch timer for speech rehearsal
  useEffect(() => {
    let interval: any = null;
    if (isSpeechTimerRunning) {
      interval = setInterval(() => {
        setSpeechTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else if (!isSpeechTimerRunning && speechTimerSeconds !== 0) {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isSpeechTimerRunning, speechTimerSeconds]);

  // Slideshow keyboard navigation (Arrow keys, Space, Esc)
  useEffect(() => {
    if (!slideshowOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevSlide();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSlideshow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slideshowOpen, nextSlide, prevSlide, closeSlideshow]);

  // Prepopulate student name in wizard
  useEffect(() => {
    if (user) {
      const fullName = user.first_name
        ? `${user.first_name} ${user.last_name}`.trim()
        : user.username;
      setWizardData((prev) => ({ ...prev, name: prev.name || fullName }));
    }
  }, [user]);

  // PWA Offline detection & installability detection
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);

      const detectedOS = detectDeviceOS();
      setDeviceOS(detectedOS);

      const installed = isStandaloneApp();
      if (!installed) {
        if (detectedOS === 'ios') {
          // iOS Safari doesn't support beforeinstallprompt; installable via Add to Home Screen
          setCanInstallPWA(true);
        } else if ((window as any).__pwaInstallPrompt) {
          setCanInstallPWA(true);
        } else {
          // Enable install entrypoint so user can trigger prompt or view step-by-step instructions
          setCanInstallPWA(true);
        }
      }

      const handleInstallable = () => {
        if (!isStandaloneApp()) {
          setCanInstallPWA(true);
        }
      };

      const handleInstalled = () => {
        localStorage.setItem('pwa_installed', 'true');
        setCanInstallPWA(false);
        (window as any).__pwaInstallPrompt = null;
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      window.addEventListener('pwa-installable', handleInstallable);
      window.addEventListener('pwa-installed', handleInstalled);
      window.addEventListener('appinstalled', handleInstalled);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('pwa-installable', handleInstallable);
        window.removeEventListener('pwa-installed', handleInstalled);
        window.removeEventListener('appinstalled', handleInstalled);
      };
    }
  }, []);

  // Scroll detection for sticky header blur
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollTop > 40 && !isScrolled) {
      setIsScrolled(true);
    } else if (target.scrollTop <= 40 && isScrolled) {
      setIsScrolled(false);
    }
  };

  // Switch Tab
  const navigateTab = (newTab: 'home' | 'logbook' | 'report' | 'defence' | 'new', dir: 'fw' | 'bw' = 'fw') => {
    setAnimDir(dir);
    setCurrentTab(newTab);
    if (typeof window !== 'undefined') {
      window.location.hash = `#/${newTab}`;
    }
    if (scrRef.current) {
      scrRef.current.scrollTop = 0;
    }
  };

  // Artifact fallback project for preview and empty state fidelity
  const FALLBACK_PROJECT = {
    id: 1,
    title: 'SIWES Report at Mi Labs',
    full_name: 'John Samuel',
    matric_number: '1234567890',
    organization_name: 'Mi Labs',
    logbook_entries: [
      {
        id: 1,
        week_number: 1,
        activity_summary: 'Safety induction and tour of the workshop',
        verified_text: 'Safety induction and tour of the workshop',
        is_verified: true,
      },
      {
        id: 2,
        week_number: 2,
        activity_summary: 'Helped the technician test the earthing on the main board',
        verified_text: 'Helped the technician test the earthing on the main board',
        is_verified: false,
      },
    ],
    source_documents: [
      {
        id: 1,
        filename: 'Logbook_week1-2.pdf',
        ocr_status: 'completed',
        pages: [
          {
            id: 1,
            page_number: 1,
            confidence_score: 0.82,
            extracted_text:
              'Week 1: Safety induction and tour of the workshop.\nWeek 2: Helped the technician test the <mark>earthing</mark> on the main board.',
          },
        ],
      },
    ],
  };

  const effectiveProject = activeProject || (isPreview ? (FALLBACK_PROJECT as any) : null);
  const effectiveUser =
    user ||
    (isPreview
      ? {
          id: 1,
          first_name: 'John',
          last_name: 'Samuel',
          email: 'john@lasustech.edu.ng',
          username: 'john',
        }
      : null);

  const userInitials = effectiveUser?.first_name
    ? `${effectiveUser.first_name[0]}${effectiveUser.last_name ? effectiveUser.last_name[0] : ''}`.toUpperCase()
    : 'JS';

  // Project progress computation derived from real data
  const projectEntries = effectiveProject?.logbook_entries || [];
  const projectDocuments = effectiveProject?.source_documents || [];
  const verifiedCount = projectEntries.filter((e: any) => e.is_verified).length;
  const totalEntries = projectEntries.length;
  const hasReport = !!(report || effectiveProject?.report);
  const hasPracticed = (defenceQuestions || []).some((q: any) => q.mastery_status === 'confident');

  const progressPct = effectiveProject
    ? Math.round((1 + (verifiedCount > 0 ? 1 : 0) + (hasReport ? 1 : 0) + (hasPracticed ? 1 : 0)) / 4 * 100)
    : 0;

  // Up next recommendation derived from workflow state
  const upNext = !verifiedCount
    ? {
        title: 'Verify a logbook entry',
        desc: 'Entries you confirm feed Chapter Three',
        tab: 'logbook' as const,
        icon: 'task_alt',
      }
    : !hasReport
    ? {
        title: 'Generate your report',
        desc: 'Build all five chapters',
        tab: 'report' as const,
        icon: 'auto_awesome',
      }
    : {
        title: 'Practise your defence',
        desc: 'Rehearse with mock questions',
        tab: 'defence' as const,
        icon: 'school',
      };

  // Chapter sections
  const CHAPTER_NAMES = [
    'Preliminary pages',
    'Introduction',
    'Company profile',
    'Activities',
    'Challenges and conclusion',
  ];

  const getSectionContent = (idx: number) => {
    if (report?.sections && report.sections.length > idx) {
      return report.sections[idx].content;
    }
    // No report generated yet — show clear prompt, not fake placeholder content
    const chapterTitles = [
      'Preliminary pages',
      'Chapter One: Introduction',
      'Chapter Two: Company Profile',
      'Chapter Three: Training Activities',
      'Chapters Four & Five: Challenges, Conclusion & Recommendations',
    ];
    const title = chapterTitles[idx] || `Chapter ${idx + 1}`;
    return `<p style="color:#5f6761;font-style:italic;"><strong>${title}</strong> has not been generated yet. Use the <strong>Generate report</strong> button above to build all five chapters from your verified logbook entries.</p>`;
  };

  // Auto-resume background upload queue
  const runAutoResumeQueue = async () => {
    if (!activeProject?.id || !navigator.onLine) return;
    const items = await getQueuedUploads(activeProject.id);
    const pending = items.filter((i) => i.status === 'pending' || i.status === 'failed');
    if (pending.length === 0) {
      setUploadQueue(items);
      return;
    }
    setIsUploadingFiles(true);
    setUploadProgress({ current: 0, total: pending.length });
    setUploadStatusText(`Uploading & analyzing ${pending.length} logbook file${pending.length > 1 ? 's' : ''}...`);
    try {
      const result = await processUploadQueue(
        async (pId, formData) => {
          await storeUploadDocument(pId, formData);
        },
        activeProject.id,
        (count) => {
          setUploadProgress((prev) => ({
            current: Math.min(prev.total, prev.current + count),
            total: prev.total,
          }));
        }
      );
      if (result.processed > 0) {
        await fetchActiveProject(activeProject.id);
        setLogbookTab('docs');
        triggerToast(`Uploaded and processed ${result.processed} logbook photo${result.processed > 1 ? 's' : ''}`);
      }
    } catch (err: any) {
      triggerToast(err.message || 'Upload queue processing failed');
    } finally {
      setIsUploadingFiles(false);
      setUploadStatusText('');
      setUploadProgress({ current: 0, total: 0 });
      if (activeProject?.id) {
        const remaining = await getQueuedUploads(activeProject.id);
        setUploadQueue(remaining);
      }
    }
  };

  // Auto-resume queue when network restores or SW triggers background sync
  useEffect(() => {
    if (!activeProject?.id) return;

    const handleOnlineResume = () => {
      runAutoResumeQueue();
    };

    const handleQueueUpdated = () => {
      getQueuedUploads(activeProject.id).then(setUploadQueue).catch(() => []);
    };

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_LOGBOOK_UPLOADS') {
        runAutoResumeQueue();
      }
    };

    window.addEventListener('online', handleOnlineResume);
    window.addEventListener('log2def-upload-queue-updated', handleQueueUpdated);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      window.removeEventListener('online', handleOnlineResume);
      window.removeEventListener('log2def-upload-queue-updated', handleQueueUpdated);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [activeProject?.id]);

  // Handle Multi-file Logbook Upload (up to 30 files, offline queued with auto-resume)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeProject?.id) {
      triggerToast('Create a report project first');
      return;
    }
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    let filesArray = Array.from(rawFiles);
    if (filesArray.length > 30) {
      triggerToast('Batch limit is 30 files. Uploading the first 30 photos.');
      filesArray = filesArray.slice(0, 30);
    }

    if (e.target) e.target.value = '';

    try {
      await enqueueUploads(activeProject.id, filesArray);
      const currentQueue = await getQueuedUploads(activeProject.id);
      setUploadQueue(currentQueue);

      if (!navigator.onLine) {
        triggerToast(`${filesArray.length} photo${filesArray.length > 1 ? 's' : ''} queued offline. Will upload automatically when back online.`);
        return;
      }

      await runAutoResumeQueue();
    } catch (err: any) {
      triggerToast(err.message || 'Failed to process files');
    }
  };

  // Clear completed upload queue items
  const handleClearCompletedUploads = async () => {
    if (!activeProject?.id) return;
    await clearCompletedUploads(activeProject.id);
    const updated = await getQueuedUploads(activeProject.id);
    setUploadQueue(updated);
    triggerToast('Cleared uploaded queue items');
  };

  // Delete Document
  const handleDeleteDoc = async (docId: number) => {
    if (!activeProject?.id) return;
    try {
      await storeDeleteDocument(activeProject.id, docId);
      triggerToast('Document deleted');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to delete document');
    }
  };

  // Reprocess Document with AI OCR
  const handleReprocessDoc = async (docId: number) => {
    if (!activeProject?.id) return;
    try {
      triggerToast('Reprocessing document with AI OCR...');
      await storeReprocessDocument(activeProject.id, docId);
      triggerToast('Document reprocessed successfully');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to reprocess document');
    }
  };

  // Toggle Entry Verified
  const handleToggleVerify = async (entry: any) => {
    if (!activeProject?.id) return;
    try {
      await storeUpdateLogbookEntry(activeProject.id, entry.id, {
        is_verified: !entry.is_verified,
      });
      triggerToast(entry.is_verified ? 'Entry unverified' : 'Entry verified');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to update entry');
    }
  };

  // Bulk verify all entries
  const handleVerifyAll = async () => {
    if (!activeProject?.id) return;
    try {
      await storeBulkVerifyEntries(activeProject.id);
      triggerToast('All entries verified');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to verify entries');
    }
  };

  // Delete Logbook Entry
  const handleDeleteEntry = async (entryId: number) => {
    if (!activeProject?.id) return;
    try {
      await storeDeleteLogbookEntry(activeProject.id, entryId);
      triggerToast('Entry deleted');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to delete entry');
    }
  };

  // Add Manual Entry Submit
  const handleAddManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject?.id || !manualText.trim()) return;

    try {
      await storeCreateLogbookEntry(activeProject.id, {
        week_number: manualWeek,
        activity_summary: manualText.trim(),
        verified_text: manualText.trim(),
        is_verified: true,
      });
      setActiveSheet(null);
      setManualText('');
      setLogbookTab('entries');
      triggerToast('Logbook entry added');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to create entry');
    }
  };

  // Process typed raw notes
  const handleProcessNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject?.id || !rawNotes.trim()) return;

    const lines = rawNotes.trim().split('\n');
    let addedCount = 0;

    for (const line of lines) {
      const match = line.match(/^week\s*(\d+)\s*[:\-]\s*(.+)/i);
      if (match) {
        const week = parseInt(match[1], 10) || 1;
        const text = match[2].trim();
        try {
          await storeCreateLogbookEntry(activeProject.id, {
            week_number: week,
            activity_summary: text,
            verified_text: text,
            is_verified: false,
          });
          addedCount++;
        } catch {}
      }
    }

    setActiveSheet(null);
    setRawNotes('');
    setLogbookTab('entries');
    triggerToast(
      addedCount > 0
        ? `${addedCount} entr${addedCount > 1 ? 'ies' : 'y'} added`
        : 'Prefix lines with “Week 1:”'
    );
  };

  // Save corrected document extracted text
  const handleSaveCorrectedPage = async () => {
    if (!activeProject?.id || !activeProject.source_documents?.[correctingDocIdx]) return;
    const doc = activeProject.source_documents[correctingDocIdx];
    const page = doc.extracted_pages?.[0];
    if (!page) {
      setActiveSheet(null);
      return;
    }

    try {
      await storeUpdatePage(activeProject.id, page.id, {
        extracted_text: correctingText,
        status: 'processed',
        is_reviewed: true,
      });
      setActiveSheet(null);
      triggerToast('Page corrections saved');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to update page');
    }
  };

  // Report Generation
  const handleGenerateReport = async () => {
    if (!activeProject?.id) return;
    try {
      triggerToast('AI is compiling verified logbook and generating report...');
      await storeGenerateReport(activeProject.id, false);
      await storeFetchVersions(activeProject.id);
      setCurrentChapterIdx(0);
      triggerToast('Report generated successfully');
    } catch (err: any) {
      triggerToast(err.message || 'Report generation failed');
    }
  };

  // Regenerate Current Section with AI
  const handleRegenerateCurrentSection = async () => {
    if (!activeProject?.id || !report?.sections?.[currentChapterIdx]) return;
    const sec = report.sections[currentChapterIdx];
    try {
      triggerToast(`Regenerating Chapter ${sec.chapter_number} with AI...`);
      await storeRegenerateSection(activeProject.id, sec.id);
      await storeFetchVersions(activeProject.id);
      triggerToast(`Chapter ${sec.chapter_number} updated with AI`);
    } catch (err: any) {
      triggerToast(err.message || 'Failed to regenerate section');
    }
  };

  // Version Control: Create Snapshot
  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject?.id) return;
    try {
      const summary = newVersionSummary.trim() || 'Manual revision snapshot';
      await storeCreateVersion(activeProject.id, summary);
      setNewVersionSummary('');
      setActiveSheet(null);
      triggerToast('Version snapshot saved');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to save version');
    }
  };

  // Version Control: Revert Version
  const handleRevertVersion = async (versionId: number, versionNum: number) => {
    if (!activeProject?.id) return;
    if (!window.confirm(`Are you sure you want to revert to Version ${versionNum}? Current unsaved edits will be replaced.`)) {
      return;
    }
    try {
      await storeRevertVersion(activeProject.id, versionId);
      triggerToast(`Reverted to Version ${versionNum}`);
    } catch (err: any) {
      triggerToast(err.message || 'Failed to revert version');
    }
  };

  // Rehearsal Stopwatch Timer Display Formatter
  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Copy Speech Script
  const handleCopyScript = () => {
    if (!defenceScript) return;
    navigator.clipboard.writeText(defenceScript);
    triggerToast('Presentation script copied to clipboard');
  };

  // Direct Browser Print
  const handleDirectPrint = () => {
    window.print();
  };

  // PWA App Installation Trigger with Device OS Detection & Guidance
  const handleInstallApp = async () => {
    if (deviceOS === 'ios') {
      setActiveSheet('pwaGuide');
      return;
    }

    const promptEvent = (window as any).__pwaInstallPrompt;
    if (!promptEvent) {
      setActiveSheet('pwaGuide');
      return;
    }

    try {
      promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('pwa_installed', 'true');
        }
        setCanInstallPWA(false);
        (window as any).__pwaInstallPrompt = null;
        triggerToast('Installing Log2Def...');
      }
    } catch {
      setActiveSheet('pwaGuide');
    }
  };

  // Report Editor Formatting Commands
  const handleFormat = (cmd: string) => {
    document.execCommand(cmd, false);
    if (docRef.current) {
      docRef.current.focus();
    }
  };

  // Auto-save edited section
  const handleDocInput = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      if (activeProject?.id && report?.sections?.[currentChapterIdx]) {
        try {
          await storeSaveSection(activeProject.id, report.sections[currentChapterIdx].id, html);
        } catch {}
      }
      setSaveStatus('saved');
    }, 700);
  };

  // Export Downloads
  const handleDownloadWord = async () => {
    if (!activeProject?.id) return;
    try {
      const filename = `${(activeProject.title || 'siwes_report').replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
      await storeDownloadDocx(activeProject.id, filename);
      triggerToast('Download Word started');
    } catch (err: any) {
      triggerToast(err.message || 'DOCX download failed');
    }
  };

  const handleDownloadPdf = async () => {
    if (!activeProject?.id) return;
    try {
      const filename = `${(activeProject.title || 'siwes_report').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      await storeDownloadPdf(activeProject.id, filename);
      triggerToast('Download PDF started');
    } catch (err: any) {
      triggerToast(err.message || 'PDF export failed');
    }
  };

  // Defence questions filtering
  const fallbackQuestions = [
    {
      id: 1,
      category: 'Organisation',
      question: 'Can you describe the host organisation and its core services?',
      suggested_answer: 'Name the organisation, what it does and where your unit fits. Keep it to 30 seconds.',
      mastery_status: 'unanswered',
    },
    {
      id: 2,
      category: 'Organisation',
      question: 'Who was your industry-based supervisor, and who did you report to day to day?',
      suggested_answer: 'Give the supervisor’s name and title, then your day-to-day reporting line.',
      mastery_status: 'unanswered',
    },
    {
      id: 3,
      category: 'Objectives',
      question: 'What were the objectives of your SIWES attachment, and how did your duties meet them?',
      suggested_answer: 'Link two or three of your own tasks to the objectives in Chapter One.',
      mastery_status: 'unanswered',
    },
    {
      id: 4,
      category: 'Tasks',
      question: 'Walk the panel through one key technical task you carried out yourself.',
      suggested_answer: 'Goal, tools, what you did, and the result. Say “I”, not “we”.',
      mastery_status: 'unanswered',
    },
    {
      id: 5,
      category: 'Tools',
      question: 'Which tool or technology did you use most, and why was it chosen?',
      suggested_answer: 'Name it, state its primary purpose, and give one concrete reason it suited the job.',
      mastery_status: 'unanswered',
    },
    {
      id: 6,
      category: 'Troubleshooting',
      question: 'What was the biggest technical challenge you met, and how did you resolve it?',
      suggested_answer: 'Explain symptom, how you traced the fault, the fix, and how you verified it worked.',
      mastery_status: 'unanswered',
    },
    {
      id: 7,
      category: 'Troubleshooting',
      question: 'If a procedure failed unexpectedly, what would you do first?',
      suggested_answer: 'Make the environment safe, stop work, notify your supervisor, then begin fault diagnostics.',
      mastery_status: 'unanswered',
    },
    {
      id: 8,
      category: 'Cross-exam',
      question: 'Were you directly involved in the core engineering work, or mainly observing?',
      suggested_answer: 'Be honest and direct. Highlight what you executed hands-on and what was shadowing.',
      mastery_status: 'unanswered',
    },
  ];

  const questionsList = defenceQuestions.length > 0
    ? defenceQuestions
    : (!activeProject ? fallbackQuestions : []);  // Only use mock fallback when in preview/no-project mode
  const categories = ['All', ...Array.from(new Set(questionsList.map((q: any) => q.category)))];
  const filteredQuestions = questionsList.filter(
    (q: any) => selectedCategory === 'All' || q.category === selectedCategory
  );

  // Update Mastery
  const handleUpdateMastery = async (questionId: number, status: string) => {
    if (activeProject?.id && defenceQuestions.some((q) => q.id === questionId)) {
      try {
        await storeUpdateDefenceQuestion(activeProject.id, questionId, {
          mastery_status: status,
        });
      } catch {}
    }
    triggerToast(`Marked ${status.replace('_', ' ')}`);
  };

  // Speech Synthesis: speak text aloud with natural pitch & rate
  const speakVoice = (text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isVoiceMuted) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.lang = 'en-US';

    setIsSupervisorSpeaking(true);
    utterance.onend = () => {
      setIsSupervisorSpeaking(false);
      if (onEnd) onEnd();
    };
    utterance.onerror = () => {
      setIsSupervisorSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopVoiceSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSupervisorSpeaking(false);
    }
  };

  // Toggle Voice Recognition (Web Speech API)
  const toggleVoiceListening = () => {
    if (typeof window === 'undefined') return;

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      triggerToast('Speech recognition is not supported in this browser. You can type your answer.');
      return;
    }

    if (isVoiceListening) {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsVoiceListening(false);
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsVoiceListening(true);
        triggerToast('Listening... Speak your defence answer');
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript + ' ';
        }
        setStudentSpokenAnswer(currentTranscript.trim());
      };

      recognition.onerror = (err: any) => {
        console.warn('Speech recognition error:', err);
        setIsVoiceListening(false);
      };

      recognition.onend = () => {
        setIsVoiceListening(false);
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      triggerToast('Could not access microphone: ' + (err.message || 'Check permissions'));
      setIsVoiceListening(false);
    }
  };

  // Evaluate Voice Answer
  const handleEvaluateVoiceAnswer = () => {
    if (!studentSpokenAnswer.trim()) {
      triggerToast('Please speak or type your answer first');
      return;
    }

    setIsEvaluatingAnswer(true);
    const currQ = questionsList[interviewQIdx] || questionsList[0];
    const answerWords = studentSpokenAnswer.toLowerCase().split(/\s+/);
    const lengthScore = Math.min(100, Math.round((answerWords.length / 25) * 60));
    
    // Check keywords from question & suggested answer
    const suggestedWords = (currQ.suggested_answer || '').toLowerCase().split(/\s+/);
    let matchedKeywords = 0;
    for (const w of suggestedWords) {
      if (w.length > 4 && studentSpokenAnswer.toLowerCase().includes(w)) {
        matchedKeywords++;
      }
    }
    const keywordScore = Math.min(40, matchedKeywords * 10);
    const finalScore = Math.min(98, Math.max(55, lengthScore + keywordScore));

    let verdict = 'Strong Defensible Answer';
    let strengths = 'Good technical articulation and clear personal ownership of the work.';
    let tips = 'Mention specific safety measures and software/hardware model numbers to earn top marks from the panel.';

    if (finalScore >= 85) {
      verdict = 'Excellent Oral Defence Response';
      strengths = 'Thoroughly covers the objectives, tools, and technical methodology.';
      tips = 'Maintain this steady pacing during the live defence.';
    } else if (finalScore < 70) {
      verdict = 'Acceptable — Needs Deeper Technical Details';
      strengths = 'Addresses the question prompt directly.';
      tips = 'Expand on your troubleshooting methodology and link tasks back to your academic coursework.';
    }

    const evalResult = {
      score: finalScore,
      verdict,
      strengths,
      tips,
    };
    setVoiceEvaluation(evalResult);
    setIsEvaluatingAnswer(false);

    if (!isVoiceMuted) {
      const verbalFeedback = finalScore >= 80 
        ? `Good response. Score is ${finalScore} percent. ${strengths}`
        : `Understood. Score is ${finalScore} percent. ${tips}`;
      speakVoice(verbalFeedback);
    }
  };

  // Next Interview Question
  const handleNextInterviewQuestion = () => {
    stopVoiceSpeaking();
    if (isVoiceListening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      setIsVoiceListening(false);
    }
    setVoiceEvaluation(null);
    setStudentSpokenAnswer('');

    if (interviewQIdx < questionsList.length - 1) {
      const nextIdx = interviewQIdx + 1;
      setInterviewQIdx(nextIdx);
      const nextQ = questionsList[nextIdx];
      if (nextQ && !isVoiceMuted) {
        setTimeout(() => {
          speakVoice(nextQ.question);
        }, 300);
      }
    } else {
      triggerToast('Full mock interview session completed!');
      speakVoice('Congratulations. You have completed the full oral defence rehearsal session.');
    }
  };

  // Save / Upload Guideline
  const handleSaveGuideline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject?.id) {
      triggerToast('Create a report project first');
      return;
    }

    setIsUploadingGuideline(true);
    try {
      const formData = new FormData();
      formData.append('university_name', guidelineInputUniversity);
      if (guidelineInputFile) {
        formData.append('file', guidelineInputFile);
      }
      if (guidelineInputText.trim()) {
        formData.append('guideline_text', guidelineInputText.trim());
      }

      await storeUploadGuideline(activeProject.id, formData);
      setActiveSheet(null);
      triggerToast('Department SIWES guidelines applied successfully');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to update guidelines');
    } finally {
      setIsUploadingGuideline(false);
    }
  };

  // Wizard Phases
  const WIZARD_PHASES = [
    {
      t: 'About you',
      d: 'These go on your cover page.',
      f: [
        { id: 'name', label: 'Full name', req: false, ph: '' },
        { id: 'matric', label: 'Matriculation number', req: true, ph: 'STE/2021/0456' },
        { id: 'dept', label: 'Department', req: false, ph: 'Computer Engineering' },
        { id: 'prog', label: 'Programme', req: false, ph: 'B.Tech Computer Engineering' },
        {
          id: 'level',
          label: 'Level',
          req: false,
          sel: ['400 Level (Final Year SIWES)', '300 Level', 'Other'],
        },
      ],
    },
    {
      t: 'Your school',
      d: 'Defaulted to LASUSTECH standard. Select your institution or choose custom to supply your guidelines.',
      f: [
        {
          id: 'uni',
          label: 'University',
          req: true,
          sel: [
            'Lagos State University of Science and Technology (LASUSTECH)',
            'University of Lagos (UNILAG)',
            'Lagos State University (LASU)',
            'Federal University of Technology, Akure (FUTA)',
            'Other University (Custom guidelines)',
          ],
        },
        { id: 'fac', label: 'Faculty or college', req: false, ph: 'e.g. College of Applied Sciences & Technology' },
        { id: 'guide', label: 'Department guidelines or coordinator instructions', req: false, txt: true, ph: 'Enter specific departmental requirements, chapter formatting rules, or supervisor guidelines.' },
      ],
    },
    {
      t: 'Where you trained',
      d: 'Tell us about the host organisation.',
      f: [
        { id: 'host', label: 'Host organisation', req: true, ph: 'e.g. MainOne Cable Company' },
        { id: 'unit', label: 'Department or unit', req: false, ph: 'e.g. Network Operations' },
        { id: 'addr', label: 'Address', req: false, ph: 'e.g. Victoria Island, Lagos' },
        { id: 'sum', label: 'What they do', req: false, txt: true, ph: 'A short summary of the organisation.' },
      ],
    },
    {
      t: 'People and dates',
      d: 'Your supervisors and training period.',
      f: [
        { id: 'sup', label: 'Industry-based supervisor', req: false, ph: 'e.g. Engr. Babatunde Fashola' },
        { id: 'supT', label: 'Supervisor job title', req: false, ph: 'e.g. Senior Network Engineer' },
        { id: 'inst', label: 'Institution-based supervisor', req: false, ph: 'e.g. Dr. K. A. Salami' },
        { id: 'start', label: 'Start date', req: false, date: true, ph: '' },
        { id: 'end', label: 'End date', req: false, date: true, ph: '' },
      ],
    },
    {
      t: 'Your work',
      d: 'What you used and what you did.',
      f: [
        { id: 'tools', label: 'Tools and technologies', req: false, ph: 'e.g. Multimeter, Python, Linux' },
        { id: 'tasks', label: 'Key technical tasks', req: false, txt: true, ph: 'Recurring procedures you handled.' },
      ],
    },
    {
      t: 'Highlights',
      d: 'Last step. Projects, problems and skills.',
      f: [
        { id: 'projs', label: 'Projects', req: false, txt: true, ph: 'e.g. LAN cabling, an internal dashboard.' },
        { id: 'prob', label: 'Problems and solutions', req: false, txt: true, ph: 'A fault you met and how you fixed it.' },
        { id: 'skills', label: 'Skills acquired', req: false, ph: 'e.g. Fault diagnosis, teamwork' },
      ],
    },
  ];

  // Submit Wizard Step
  const handleWizardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phase = WIZARD_PHASES[wizardStep];
    const errors: Record<string, string> = {};

    phase.f.forEach((field) => {
      if (field.req && !(wizardData as any)[field.id]?.trim()) {
        errors[field.id] = 'Please fill this in.';
      }
    });

    if (Object.keys(errors).length > 0) {
      setWizardErrors(errors);
      return;
    }
    setWizardErrors({});

    if (wizardStep < WIZARD_PHASES.length - 1) {
      setAnimDir('fw');
      setWizardStep((prev) => prev + 1);
    } else {
      // Create new report project
      try {
        const payload = {
          title: `SIWES Report at ${wizardData.host || 'Host Organisation'}`,
          full_name:
            wizardData.name ||
            (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student'),
          matric_number: wizardData.matric,
          department: wizardData.dept,
          programme: wizardData.prog,
          level: wizardData.level,
          university_name: wizardData.uni,
          faculty_school: wizardData.fac,
          department_requirements: wizardData.guide,
          organization_name: wizardData.host,
          placement_department: wizardData.unit,
          organization_address: wizardData.addr,
          organization_activities: wizardData.sum,
          industry_supervisor_name: wizardData.sup,
          industry_supervisor_title: wizardData.supT,
          academic_supervisor_name: wizardData.inst,
          training_start_date: wizardData.start || null,
          training_end_date: wizardData.end || null,
          tools_used: wizardData.tools,
          tasks_performed: wizardData.tasks,
          projects_undertaken: wizardData.projs,
          problems_encountered: wizardData.prob,
          skills_acquired: wizardData.skills,
        };

        const newProj = await createProject(payload);
        await fetchActiveProject(newProj.id);
        setWizardStep(0);
        navigateTab('logbook');
        triggerToast('Report project created');
      } catch (err: any) {
        triggerToast(err.message || 'Failed to create report project');
      }
    }
  };

  const studentName = effectiveUser?.first_name
    ? `${effectiveUser.first_name} ${effectiveUser.last_name || ''}`.trim()
    : effectiveUser?.username || 'Student';

  return (
    <div className="dashboard-root">
      <div
        className={`app ${currentTab === 'new' ? 'nt wz' : ''} ${animDir}`}
        id="app"
      >
        <div
          className={`scr ${isScrolled ? 'sc' : ''}`}
          id="scr"
          tabIndex={-1}
          ref={scrRef}
          onScroll={handleScroll}
        >
          {/* ======================= TAB: HOME ======================= */}
          {currentTab === 'home' && (
            <div className="view">
              <header className="top">
                <span className="sp"></span>
                <span className="tt">Home</span>
                <button
                  className="ib pl"
                  type="button"
                  aria-label="Account"
                  onClick={() => setActiveSheet('me')}
                >
                  {userInitials}
                </button>
              </header>

              <div className="lg">
                <h1>Hi, {effectiveUser?.first_name || 'John'}</h1>
                <p>Your SIWES report, step by step.</p>
              </div>

              {/* Offline Network Warning Banner */}
              {isOffline && (
                <div className="offline-banner" role="status">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ms" aria-hidden="true">cloud_off</span>
                    <span>Offline mode active. Your local drafts remain accessible.</span>
                  </div>
                  <button
                    className="btn o s"
                    type="button"
                    style={{ color: '#fbbf24', borderColor: 'rgba(235, 178, 59, 0.4)' }}
                    onClick={() => window.location.reload()}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!effectiveProject ? (
                <div className="card empty">
                  <div className="ico">
                    <span className="ms" aria-hidden="true">
                      auto_stories
                    </span>
                  </div>
                  <h2>No report yet</h2>
                  <p>
                    Add your placement details, upload logbook pages and generate
                    your chapters.
                  </p>
                  <button
                    className="btn w"
                    type="button"
                    onClick={() => navigateTab('new')}
                  >
                    <span className="ms" aria-hidden="true">
                      add
                    </span>
                    Start your first report
                  </button>
                </div>
              ) : (
                <>
                  {/* Hero Card */}
                  <section className="hero" aria-label="Current project">
                    <div
                      className="ring"
                      style={{ '--p': `${progressPct}%` } as React.CSSProperties}
                    >
                      <b>{progressPct}%</b>
                    </div>
                    <span
                      className="chip"
                      style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}
                    >
                      {hasReport ? 'Report ready' : 'In progress'}
                    </span>
                    <h2 style={{ maxWidth: '11em' }}>{effectiveProject.title}</h2>
                    <p>
                      {verifiedCount} of {totalEntries} entries verified
                    </p>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => navigateTab(upNext.tab)}
                    >
                      Continue
                      <span className="ms" aria-hidden="true">
                        arrow_forward
                      </span>
                    </button>
                  </section>

                  {/* Quick Actions */}
                  <div className="qa">
                    <button type="button" onClick={() => navigateTab('logbook')}>
                      <span className="ms" aria-hidden="true">
                        upload_file
                      </span>
                      Add logbook
                    </button>
                    <button type="button" onClick={() => navigateTab('report')}>
                      <span className="ms" aria-hidden="true">
                        auto_awesome
                      </span>
                      Generate
                    </button>
                    <button type="button" onClick={() => navigateTab('defence')}>
                      <span className="ms" aria-hidden="true">
                        quiz
                      </span>
                      Practise
                    </button>
                  </div>

                  {/* FAB: Start new report project */}
                  <button
                    className="home-fab"
                    type="button"
                    onClick={() => navigateTab('new')}
                    aria-label="Start a new report project"
                  >
                    <span className="ms" aria-hidden="true">add</span>
                    New report project
                  </button>

                  {/* Up Next Section */}
                  <h2 className="sh">Up next</h2>
                  <div className="card" style={{ padding: '4px 16px' }}>
                    <div
                      className="lr"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigateTab(upNext.tab)}
                    >
                      <span className="ic">
                        <span className="ms" aria-hidden="true">
                          {upNext.icon}
                        </span>
                      </span>
                      <span style={{ flex: 1 }}>
                        <b>{upNext.title}</b>
                        <small>{upNext.desc}</small>
                      </span>
                      <span className="ms mut" aria-hidden="true">
                        chevron_right
                      </span>
                    </div>

                    <div
                      className="lr"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        navigateTab('report');
                        setReportTab('export');
                      }}
                    >
                      <span className="ic">
                        <span className="ms" aria-hidden="true">
                          download
                        </span>
                      </span>
                      <span style={{ flex: 1 }}>
                        <b>Export Word and PDF</b>
                        <small>A4, ready to print and bind</small>
                      </span>
                      <span className="ms mut" aria-hidden="true">
                        chevron_right
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ======================= TAB: LOGBOOK ======================= */}
          {currentTab === 'logbook' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">
                    arrow_back
                  </span>
                </button>
                <span className="tt">Logbook</span>
                <span className="sp"></span>
              </header>

              <div className="lg">
                <h1>Logbook</h1>
                <p>{effectiveProject?.organization_name || 'Upload handwritten notes & scans'}</p>
              </div>

              {/* Upload Drop Area */}
              <label className="up">
                <span className="ms" aria-hidden="true">
                  cloud_upload
                </span>
                <b>Upload logbook pages & photos</b>
                <span className="mut" style={{ fontSize: '13.5px' }}>
                  Select up to 30 photos cover-to-cover (JPG, PNG, PDF, DOCX)
                </span>
                <input
                  type="file"
                  id="fi"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.docx"
                  aria-label="Upload logbook pages"
                  onChange={handleFileUpload}
                />
              </label>

              {isUploadingFiles && (
                <div className="upload-loading-banner" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                    <div className="spinner"></div>
                    <span style={{ fontWeight: 600 }}>{uploadStatusText}</span>
                  </div>
                  {uploadProgress.total > 0 && (
                    <div className="upload-progress-container">
                      <div className="upload-progress-track">
                        <div
                          className="upload-progress-fill"
                          style={{
                            width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
                        <span>Progress: {uploadProgress.current} of {uploadProgress.total} files</span>
                        <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Offline / Pending Upload Queue card */}
              {!isUploadingFiles && uploadQueue.filter((q) => q.status === 'pending' || q.status === 'failed').length > 0 && (
                <div className="upload-offline-queue-card">
                  <div className="upload-offline-header">
                    <span className="upload-badge">
                      <span className="ms" style={{ color: isOffline ? '#f59e0b' : '#10b981', fontSize: '18px' }}>
                        {isOffline ? 'cloud_off' : 'cloud_queue'}
                      </span>
                      {uploadQueue.filter((q) => q.status === 'pending' || q.status === 'failed').length} queued photo(s)
                      {isOffline ? ' (Offline)' : ' ready to resume'}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn s"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={runAutoResumeQueue}
                        disabled={isOffline}
                      >
                        Resume now
                      </button>
                      <button
                        type="button"
                        className="btn o s"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={handleClearCompletedUploads}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="row" style={{ marginBottom: '14px' }}>
                <button
                  className="btn o w s"
                  type="button"
                  onClick={() => setActiveSheet('typeNotes')}
                >
                  <span className="ms" aria-hidden="true">
                     edit_note
                  </span>
                  Type notes
                </button>
                <button
                  className="btn w s"
                  type="button"
                  onClick={() => setActiveSheet('addEntry')}
                >
                  <span className="ms" aria-hidden="true">
                    add
                  </span>
                  Add entry
                </button>
              </div>

              {/* Segmented View */}
              <div className="seg" role="tablist" aria-label="Logbook view">
                <button
                  role="tab"
                  type="button"
                  aria-selected={logbookTab === 'entries'}
                  onClick={() => setLogbookTab('entries')}
                >
                  Entries ({totalEntries})
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={logbookTab === 'docs'}
                  onClick={() => setLogbookTab('docs')}
                >
                  Documents ({projectDocuments.length})
                </button>
              </div>

              {logbookTab === 'entries' ? (
                totalEntries > 0 ? (
                  <>
                    <div className="card" style={{ padding: '4px 16px' }}>
                      {projectEntries.map((e: any, i: number) => (
                        <div className="en" key={e.id || i}>
                          <button
                            className="ck"
                            type="button"
                            aria-pressed={!!e.is_verified}
                            aria-label={`Week ${e.week_number} verified`}
                            onClick={() => handleToggleVerify(e)}
                          >
                            <span className="ms" aria-hidden="true">
                              check
                            </span>
                          </button>
                          <div style={{ flex: 1, paddingTop: '2px' }}>
                            <small>
                              WEEK {e.week_number} ·{' '}
                              {e.is_verified ? 'VERIFIED' : 'UNVERIFIED'}
                            </small>
                            <p>{e.activity_summary || e.verified_text}</p>
                          </div>
                          <button
                            className="ib"
                            type="button"
                            aria-label={`Delete week ${e.week_number}`}
                            style={{ boxShadow: 'none', background: 'none' }}
                            onClick={() => handleDeleteEntry(e.id)}
                          >
                            <span className="ms mut" aria-hidden="true">
                              delete
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="btn o w"
                      type="button"
                      onClick={handleVerifyAll}
                    >
                      <span className="ms" aria-hidden="true">
                        done_all
                      </span>
                      Verify all entries
                    </button>
                  </>
                ) : (
                  <div className="card empty">
                    <p style={{ margin: 0 }}>No entries yet. Upload pages or add one.</p>
                  </div>
                )
              ) : (
                projectDocuments.length > 0 ? (
                  projectDocuments.map((d: any, idx: number) => (
                    <div className="card" key={d.id || idx}>
                      <div className="row sb">
                        <b style={{ fontSize: '15px', wordBreak: 'break-all' }}>
                          {d.filename || d.file_name || d.title || 'Document'}
                        </b>
                        {d.status === 'error' ? (
                          <span className="chip w">
                            <span className="ms" aria-hidden="true">
                              warning
                            </span>
                            Check required
                          </span>
                        ) : (
                          <span className="chip">Extracted</span>
                        )}
                      </div>
                      <div className="pg">
                        {d.extracted_pages?.[0]?.extracted_text ||
                          d.pages?.[0]?.extracted_text ||
                          d.extracted_text ||
                          'Text extracted from this source will appear here for student review.'}
                      </div>
                      <div className="row" style={{ gap: '10px', marginTop: '10px' }}>
                        <button
                          className="tx"
                          type="button"
                          onClick={() => {
                            setCorrectingDocIdx(idx);
                            setCorrectingText(d.extracted_pages?.[0]?.extracted_text || '');
                            setActiveSheet('correctText');
                          }}
                        >
                          <span className="ms" aria-hidden="true">
                            edit
                          </span>
                          Correct text
                        </button>
                        {d.id && (
                          <>
                            <button
                              className="tx"
                              type="button"
                              onClick={() => handleReprocessDoc(d.id)}
                            >
                              <span className="ms" aria-hidden="true">
                                refresh
                              </span>
                              Reprocess
                            </button>
                            <button
                              className="tx"
                              type="button"
                              style={{ color: '#dc2626' }}
                              onClick={() => handleDeleteDoc(d.id)}
                            >
                              <span className="ms" aria-hidden="true">
                                delete
                              </span>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="card empty">
                    <p style={{ margin: 0 }}>No documents uploaded yet.</p>
                  </div>
                )
              )}
            </div>
          )}

          {/* ======================= TAB: REPORT ======================= */}
          {currentTab === 'report' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">
                    arrow_back
                  </span>
                </button>
                <span className="tt">Report</span>
                <span className="sp"></span>
              </header>

              <div className="lg">
                <h1>Report</h1>
                <p>{effectiveProject?.title || 'SIWES Technical Report'}</p>
              </div>

              {/* Institutional Guidelines Status Banner */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '14px', padding: '10px 14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="guideline-badge">
                    <span className="ms" style={{ fontSize: '15px' }}>verified</span>
                    {effectiveProject?.guideline_preset === 'custom' ? 'Custom Guidelines Applied' : 'LASUSTECH Standard Format'}
                  </span>
                  <span style={{ fontSize: '12.5px', color: 'var(--mut)' }}>
                    {effectiveProject?.university_name || 'Lagos State University of Science and Technology'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn o s"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => {
                    setGuidelineInputUniversity(effectiveProject?.university_name || 'Lagos State University of Science and Technology (LASUSTECH)');
                    setGuidelineInputText(effectiveProject?.department_requirements || '');
                    setActiveSheet('uploadGuideline');
                  }}
                >
                  <span className="ms" style={{ fontSize: '15px' }}>upload_file</span>
                  {effectiveProject?.guideline_preset === 'custom' ? 'Update Guidelines' : 'Custom Guidelines'}
                </button>
              </div>

              {/* Segmented Subtabs: Editor | Preview | Versions | Export */}
              <div className="seg" role="tablist" aria-label="Report view">
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'editor'}
                  onClick={() => setReportTab('editor')}
                >
                  Editor
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'preview'}
                  onClick={() => setReportTab('preview')}
                >
                  Academic Preview
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'versions'}
                  onClick={() => setReportTab('versions')}
                >
                  Versions ({reportVersions.length})
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'export'}
                  onClick={() => setReportTab('export')}
                >
                  Export
                </button>
              </div>

              {/* 1. EDITOR VIEW */}
              {reportTab === 'editor' && (
                !hasReport ? (
                  <div className="card empty">
                    <div className="ico">
                      <span className="ms" aria-hidden="true">
                        description
                      </span>
                    </div>
                    <h2>Generate your report</h2>
                    <p>
                      Your verified entries and placement details become the standard
                      academic chapters. Everything is grounded in your actual training.
                    </p>
                    <button
                      className="btn w"
                      type="button"
                      disabled={isGeneratingReport}
                      onClick={handleGenerateReport}
                    >
                      <span className="ms" aria-hidden="true">
                        auto_awesome
                      </span>
                      {isGeneratingReport ? 'Generating report with AI...' : 'Generate report'}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Chapter selector pills */}
                    <div className="pills" role="tablist" aria-label="Chapters">
                      {CHAPTER_NAMES.map((name, i) => (
                        <button
                          key={name}
                          role="tab"
                          type="button"
                          aria-selected={i === currentChapterIdx}
                          onClick={() => setCurrentChapterIdx(i)}
                        >
                          {i === 0 ? 'Prelims' : `Ch.${i}: ${name.split(' ')[0]}`}
                        </button>
                      ))}
                    </div>

                    {/* Editor Action Bar */}
                    <div className="row sb" style={{ marginBottom: '10px' }}>
                      <button
                        className="btn o s"
                        type="button"
                        onClick={handleRegenerateCurrentSection}
                      >
                        <span className="ms" aria-hidden="true">
                          auto_awesome
                        </span>
                        Regenerate this chapter
                      </button>
                      <button
                        className="btn o s"
                        type="button"
                        onClick={() => setActiveSheet('addVersion' as any)}
                      >
                        <span className="ms" aria-hidden="true">
                          bookmark_add
                        </span>
                        Save snapshot
                      </button>
                    </div>

                    {/* Editor Card */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div className="tl" role="toolbar" aria-label="Formatting">
                        <button
                          type="button"
                          aria-label="Bold"
                          onClick={() => handleFormat('bold')}
                        >
                          <span className="ms" aria-hidden="true">
                            format_bold
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label="Italic"
                          onClick={() => handleFormat('italic')}
                        >
                          <span className="ms" aria-hidden="true">
                            format_italic
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label="Bullets"
                          onClick={() => handleFormat('insertUnorderedList')}
                        >
                          <span className="ms" aria-hidden="true">
                            format_list_bulleted
                          </span>
                        </button>
                        <span className="sv">
                          <span className="ms" style={{ fontSize: '17px' }} aria-hidden="true">
                            {saveStatus === 'saving' ? 'sync' : 'cloud_done'}
                          </span>
                          {saveStatus === 'saving' ? 'Saving...' : 'Saved to cloud'}
                        </span>
                      </div>

                      <div
                        className="doc"
                        ref={docRef}
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        aria-multiline="true"
                        aria-label={CHAPTER_NAMES[currentChapterIdx]}
                        onInput={handleDocInput}
                        dangerouslySetInnerHTML={{
                          __html: getSectionContent(currentChapterIdx),
                        }}
                      />
                    </div>
                    <p className="hint">Edits are auto-saved. Click "Save snapshot" to preserve a reversion point.</p>
                  </>
                )
              )}

              {/* 2. ACADEMIC PRINT PREVIEW VIEW */}
              {reportTab === 'preview' && (
                <div className="academic-container">
                  <div className="row sb" style={{ gap: '10px' }}>
                    <button
                      className="btn s"
                      type="button"
                      onClick={handleDirectPrint}
                    >
                      <span className="ms" aria-hidden="true">
                        print
                      </span>
                      Print / Save PDF
                    </button>
                    <div className="row" style={{ gap: '8px' }}>
                      <button
                        className="btn o s"
                        type="button"
                        onClick={handleDownloadWord}
                      >
                        <span className="ms" aria-hidden="true">
                          download
                        </span>
                        Word (.docx)
                      </button>
                      <button
                        className="btn o s"
                        type="button"
                        onClick={() => setReportTab('editor')}
                      >
                        <span className="ms" aria-hidden="true">
                          edit
                        </span>
                        Edit chapters
                      </button>
                    </div>
                  </div>

                  <div className="academic-paper">
                    {/* Cover Page */}
                    <div className="academic-cover page-break">
                      <h1>{effectiveProject?.university_name || 'LAGOS STATE UNIVERSITY OF SCIENCE AND TECHNOLOGY'}</h1>
                      <h2>{effectiveProject?.faculty_school || 'COLLEGE OF APPLIED SCIENCES AND TECHNOLOGY'}</h2>
                      <p style={{ fontWeight: 600, fontSize: '15px' }}>DEPARTMENT OF {effectiveProject?.department?.toUpperCase() || 'COMPUTER SCIENCE'}</p>
                      
                      <div style={{ margin: '36px 0' }}>
                        <h2 style={{ fontSize: '18px', lineHeight: 1.5 }}>
                          TECHNICAL REPORT ON STUDENTS INDUSTRIAL WORK EXPERIENCE SCHEME (SIWES)
                        </h2>
                        <p style={{ fontStyle: 'italic', margin: '8px 0' }}>HELD AT</p>
                        <h3 style={{ fontSize: '17px', fontWeight: 800 }}>
                          {effectiveProject?.organization_name?.toUpperCase() || 'HOST INDUSTRIAL ATTACHMENT ORGANIZATION'}
                        </h3>
                        <p style={{ fontSize: '14px', color: '#444' }}>
                          {effectiveProject?.organization_address || 'Lagos, Nigeria'}
                        </p>
                      </div>

                      <div style={{ marginTop: '30px' }}>
                        <p style={{ margin: '4px 0' }}>BY</p>
                        <p style={{ fontSize: '17px', fontWeight: 700, margin: '4px 0' }}>
                          {effectiveProject?.full_name?.toUpperCase() || effectiveUser?.first_name?.toUpperCase() || 'STUDENT INTERN'}
                        </p>
                        <p style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '0.05em' }}>
                          MATRIC NO: {effectiveProject?.matric_number || 'STE/2021/0000'}
                        </p>
                      </div>

                      <div style={{ marginTop: '40px', fontSize: '14px', fontStyle: 'italic' }}>
                        SUBMITTED IN PARTIAL FULFILMENT OF THE REQUIREMENTS FOR THE AWARD OF BACHELOR OF SCIENCE / TECHNOLOGY DEGREE
                      </div>
                      
                      <p style={{ marginTop: '24px', fontWeight: 600 }}>
                        {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </p>
                    </div>

                    {/* Certification Page */}
                    <div className="academic-prelim page-break">
                      <h2>Certification & Approval</h2>
                      <p style={{ textIndent: '2em', textAlign: 'justify' }}>
                        This is to certify that this technical report is a true and accurate record of the Students Industrial Work Experience Scheme (SIWES) undertaken by <b>{effectiveProject?.full_name || 'the student'}</b> (Matriculation Number: <b>{effectiveProject?.matric_number || 'N/A'}</b>) in the Department of <b>{effectiveProject?.department || 'Engineering'}</b>, at <b>{effectiveProject?.organization_name || 'the host organization'}</b>, during the {new Date().getFullYear()} industrial training session.
                      </p>

                      <div className="academic-sig-block">
                        <div className="sig-line">
                          <b>{effectiveProject?.full_name || 'Student'}</b><br />
                          <span>Student Signature & Date</span>
                        </div>
                        <div className="sig-line">
                          <b>{effectiveProject?.industry_supervisor_name || 'Industry Supervisor'}</b><br />
                          <span>Industry-Based Supervisor Signature & Date</span>
                        </div>
                        <div className="sig-line">
                          <b>{effectiveProject?.academic_supervisor_name || 'Institutional Supervisor'}</b><br />
                          <span>Departmental SIWES Coordinator Signature & Date</span>
                        </div>
                      </div>
                    </div>

                    {/* Table of Contents */}
                    <div className="academic-prelim page-break">
                      <h2>Table of Contents</h2>
                      <ul className="toc-list">
                        <li className="toc-item"><span>Title Page</span> <span>i</span></li>
                        <li className="toc-item"><span>Certification and Approval</span> <span>ii</span></li>
                        <li className="toc-item"><span>Dedication & Acknowledgements</span> <span>iii</span></li>
                        <li className="toc-item"><span>Abstract / Executive Summary</span> <span>iv</span></li>
                        <li className="toc-item"><span>Table of Contents</span> <span>v</span></li>
                        <li className="toc-item"><span><b>CHAPTER ONE: INTRODUCTION & OBJECTIVES</b></span> <span>1</span></li>
                        <li className="toc-item"><span><b>CHAPTER TWO: HOST ORGANISATION PROFILE</b></span> <span>4</span></li>
                        <li className="toc-item"><span><b>CHAPTER THREE: TECHNICAL ACTIVITIES & LOGBOOK</b></span> <span>8</span></li>
                        <li className="toc-item"><span><b>CHAPTER FOUR: SKILLS ACQUIRED & TROUBLESHOOTING</b></span> <span>18</span></li>
                        <li className="toc-item"><span><b>CHAPTER FIVE: CONCLUSIONS & RECOMMENDATIONS</b></span> <span>23</span></li>
                      </ul>
                    </div>

                    {/* Chapters Body */}
                    {CHAPTER_NAMES.map((name, i) => (
                      <div className="academic-chapter page-break" key={name} style={{ marginTop: '28px' }}>
                        <h2>{i === 0 ? 'Preliminary Notes' : `CHAPTER ${i === 1 ? 'ONE' : i === 2 ? 'TWO' : i === 3 ? 'THREE' : i === 4 ? 'FOUR' : 'FIVE'}: ${name.toUpperCase()}`}</h2>
                        <div
                          style={{ textAlign: 'justify', lineHeight: 1.7 }}
                          dangerouslySetInnerHTML={{
                            __html: getSectionContent(i),
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. VERSION HISTORY VIEW */}
              {reportTab === 'versions' && (
                <div>
                  <div className="row sb" style={{ marginBottom: '16px' }}>
                    <div>
                      <h2 style={{ fontSize: '18px', margin: 0 }}>Version History</h2>
                      <p className="mut" style={{ fontSize: '13px', margin: '2px 0 0' }}>
                        Snapshots are preserved automatically during generation and manual saves.
                      </p>
                    </div>
                    <button
                      className="btn s"
                      type="button"
                      onClick={() => setActiveSheet('addVersion' as any)}
                    >
                      <span className="ms" aria-hidden="true">
                        add
                      </span>
                      Save snapshot
                    </button>
                  </div>

                  {reportVersions.length > 0 ? (
                    reportVersions.map((v: any) => (
                      <div className={`ver-card ${v.version_number === (report?.version || 1) ? 'current' : ''}`} key={v.id}>
                        <div className="ver-header">
                          <span className={`ver-badge ${v.version_number === (report?.version || 1) ? 'active' : ''}`}>
                            Version {v.version_number} {v.version_number === (report?.version || 1) ? '(Current)' : ''}
                          </span>
                          <span className="mut" style={{ fontSize: '12px' }}>
                            {v.created_at ? new Date(v.created_at).toLocaleString() : 'Recent'}
                          </span>
                        </div>
                        <p style={{ margin: '4px 0', fontSize: '14.5px', fontWeight: 500 }}>
                          {v.change_summary || v.title || 'Report Revision'}
                        </p>
                        <div className="row sb" style={{ marginTop: '8px' }}>
                          <span className="mut" style={{ fontSize: '12.5px' }}>
                            {v.sections_snapshot ? `${v.sections_snapshot.length} sections snapshot` : 'Full report'}
                          </span>
                          <button
                            className="btn o s"
                            type="button"
                            onClick={() => handleRevertVersion(v.id, v.version_number)}
                          >
                            <span className="ms" aria-hidden="true">
                              history
                            </span>
                            Revert to this version
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="card empty">
                      <p>No snapshots yet. Click "Save snapshot" to record a milestone.</p>
                    </div>
                  )}
                </div>
              )}

              {/* 4. EXPORT VIEW */}
              {reportTab === 'export' && (
                <>
                  <div className="card">
                    <span className="tag">WORD</span>
                    <h3 style={{ fontSize: '20px', margin: '10px 0 6px' }}>Editable report (.docx)</h3>
                    <p className="mut" style={{ fontSize: '14px', marginBottom: '16px' }}>
                      A4, 1.5 inch binding margin, Times New Roman 12pt, 1.5 line spacing.
                    </p>
                    <button
                      className="btn w"
                      type="button"
                      disabled={!hasReport}
                      onClick={handleDownloadWord}
                    >
                      <span className="ms" aria-hidden="true">
                        download
                      </span>
                      Download Word (.docx)
                    </button>
                  </div>

                  <div className="card">
                    <span className="tag p">PDF</span>
                    <h3 style={{ fontSize: '20px', margin: '10px 0 6px' }}>Print-ready PDF (.pdf)</h3>
                    <p className="mut" style={{ fontSize: '14px', marginBottom: '16px' }}>
                      Strict academic formatting, running headers, preliminary Roman numerals and certification sign-offs.
                    </p>
                    <button
                      className="btn w"
                      type="button"
                      disabled={!hasReport}
                      onClick={handleDownloadPdf}
                    >
                      <span className="ms" aria-hidden="true">
                        download
                      </span>
                      Download PDF (.pdf)
                    </button>
                  </div>

                  <div className="card">
                    <span className="tag" style={{ background: '#e0f2fe', color: '#0369a1' }}>PRINT</span>
                    <h3 style={{ fontSize: '20px', margin: '10px 0 6px' }}>Direct Browser Print</h3>
                    <p className="mut" style={{ fontSize: '14px', marginBottom: '16px' }}>
                      Prints or saves to PDF directly from your browser with clean print formatting.
                    </p>
                    <button
                      className="btn w o"
                      type="button"
                      disabled={!hasReport}
                      onClick={handleDirectPrint}
                    >
                      <span className="ms" aria-hidden="true">
                        print
                      </span>
                      Print Document
                    </button>
                  </div>

                  {!hasReport && (
                    <p className="hint" style={{ marginBottom: '14px' }}>
                      Generate your report to enable downloads.
                    </p>
                  )}

                  <div className="card">
                    <h3 style={{ fontSize: '17px', marginBottom: '6px' }}>Academic Submission Checklist</h3>
                    <ul className="cl">
                      <li>
                        <span className="ms" aria-hidden="true">
                          check_circle
                        </span>
                        A4 format with 1.5-inch left binding margin
                      </li>
                      <li>
                        <span className="ms" aria-hidden="true">
                          check_circle
                        </span>
                        Certification and approval page with signature lines
                      </li>
                      <li>
                        <span className="ms" aria-hidden="true">
                          check_circle
                        </span>
                        Roman numerals for preliminary pages (i, ii, iii...)
                      </li>
                      <li>
                        <span className="ms" aria-hidden="true">
                          check_circle
                        </span>
                        Arabic numbering for technical chapters (1, 2, 3...)
                      </li>
                      <li>
                        <span className="ms" aria-hidden="true">
                          check_circle
                        </span>
                        Weekly technical procedures derived from verified logbook
                      </li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ======================= TAB: DEFENCE ======================= */}
          {currentTab === 'defence' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">
                    arrow_back
                  </span>
                </button>
                <span className="tt">Defence</span>
                <span className="sp"></span>
              </header>

              <div className="lg">
                <h1>Defence</h1>
                <p>Rehearse with AI mock quizzes, presentation slides, and speech scripts.</p>
              </div>

              {/* Defence Subtabs */}
              <div className="seg" role="tablist" aria-label="Defence mode">
                <button
                  role="tab"
                  type="button"
                  aria-selected={defenceTab === 'quiz'}
                  onClick={() => setDefenceTab('quiz')}
                >
                  Mock Questions ({questionsList.length})
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={defenceTab === 'slides'}
                  onClick={() => setDefenceTab('slides')}
                >
                  Slides ({defenceSlides.length})
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={defenceTab === 'interview'}
                  onClick={() => {
                    setDefenceTab('interview');
                    const q = questionsList[interviewQIdx] || questionsList[0];
                    if (q && !isVoiceMuted) {
                      setTimeout(() => speakVoice(q.question), 250);
                    }
                  }}
                >
                  <span className="ms" style={{ fontSize: '15px', marginRight: '4px', verticalAlign: 'text-bottom' }}>
                    record_voice_over
                  </span>
                  Voice Simulation
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={defenceTab === 'script'}
                  onClick={() => setDefenceTab('script')}
                >
                  Oral Script & Timer
                </button>
              </div>

              {/* LIVE VOICE DEFENCE SIMULATION SUBTAB */}
              {defenceTab === 'interview' && (
                <>
                  <div className="interview-panel-card">
                    <div className="supervisor-header">
                      <div className={`supervisor-avatar ${isSupervisorSpeaking ? 'speaking' : ''}`}>
                        <span className="ms" style={{ fontSize: '24px' }}>
                          {isSupervisorSpeaking ? 'record_voice_over' : 'school'}
                        </span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <b style={{ fontSize: '15px', color: 'var(--ink)' }}>Supervisor Oral Defence Panel</b>
                          <button
                            type="button"
                            className="ib"
                            style={{ width: '32px', height: '32px' }}
                            title={isVoiceMuted ? 'Unmute supervisor voice' : 'Mute supervisor voice'}
                            onClick={() => setIsVoiceMuted(!isVoiceMuted)}
                          >
                            <span className="ms" style={{ fontSize: '18px', color: isVoiceMuted ? '#ef4444' : '#10b981' }}>
                              {isVoiceMuted ? 'volume_off' : 'volume_up'}
                            </span>
                          </button>
                        </div>
                        <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--mut)' }}>
                          Question {interviewQIdx + 1} of {questionsList.length} &middot; {questionsList[interviewQIdx]?.category || 'General'}
                        </p>
                      </div>
                    </div>

                    {/* Question Box */}
                    <div className="interview-question-box">
                      <span className="chip" style={{ marginBottom: '8px' }}>
                        {questionsList[interviewQIdx]?.category || 'Defence Question'}
                      </span>
                      <h3>&ldquo;{questionsList[interviewQIdx]?.question}&rdquo;</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                        <button
                          type="button"
                          className="btn o s"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => speakVoice(questionsList[interviewQIdx]?.question)}
                          disabled={isSupervisorSpeaking}
                        >
                          <span className="ms" style={{ fontSize: '16px' }}>volume_up</span>
                          {isSupervisorSpeaking ? 'Speaking...' : 'Replay Question'}
                        </button>
                        {isSupervisorSpeaking && (
                          <div className="voice-wave-container">
                            <span className="voice-bar active"></span>
                            <span className="voice-bar active"></span>
                            <span className="voice-bar active"></span>
                            <span className="voice-bar active"></span>
                            <span className="voice-bar active"></span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Student Voice Response Box */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                          Your Verbal Defence Answer:
                        </label>
                        {isVoiceListening && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '12px', fontWeight: 600 }}>
                            <span className="voice-wave-container" style={{ height: '16px' }}>
                              <span className="voice-bar active"></span>
                              <span className="voice-bar active"></span>
                              <span className="voice-bar active"></span>
                            </span>
                            Listening to microphone...
                          </div>
                        )}
                      </div>

                      <textarea
                        className="interview-transcript-box"
                        style={{ width: '100%', resize: 'vertical' }}
                        value={studentSpokenAnswer}
                        onChange={(e) => setStudentSpokenAnswer(e.target.value)}
                        placeholder="Click 'Start Voice Answer' below to speak your response into the microphone, or type here directly..."
                      />
                    </div>

                    {/* Response Controls */}
                    <div className="row sb" style={{ gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className={`btn ${isVoiceListening ? 'bad' : 's'}`}
                          style={{
                            background: isVoiceListening ? '#ef4444' : undefined,
                            borderColor: isVoiceListening ? '#ef4444' : undefined,
                          }}
                          onClick={toggleVoiceListening}
                        >
                          <span className="ms">{isVoiceListening ? 'mic_off' : 'mic'}</span>
                          {isVoiceListening ? 'Stop Listening' : 'Start Voice Answer'}
                        </button>
                        <button
                          type="button"
                          className="btn w s"
                          onClick={handleEvaluateVoiceAnswer}
                          disabled={!studentSpokenAnswer.trim() || isEvaluatingAnswer}
                        >
                          <span className="ms">grading</span>
                          {isEvaluatingAnswer ? 'Grading...' : 'Grade Answer'}
                        </button>
                      </div>

                      <button
                        type="button"
                        className="btn o s"
                        onClick={handleNextInterviewQuestion}
                      >
                        {interviewQIdx < questionsList.length - 1 ? 'Next Question' : 'Complete Session'}
                        <span className="ms">arrow_forward</span>
                      </button>
                    </div>

                    {/* AI Evaluation Box */}
                    {voiceEvaluation && (
                      <div className="interview-feedback-box">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                          <span style={{ fontWeight: 700, fontSize: '14px', color: '#175438' }}>
                            Panel Evaluation & Score
                          </span>
                          <span
                            className="chip"
                            style={{
                              background: voiceEvaluation.score >= 80 ? '#10b981' : '#f59e0b',
                              color: '#fff',
                              fontWeight: 700,
                            }}
                          >
                            {voiceEvaluation.score}% &middot; {voiceEvaluation.verdict}
                          </span>
                        </div>
                        <p style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--ink)' }}>
                          <strong>Strengths:</strong> {voiceEvaluation.strengths}
                        </p>
                        <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--mut)' }}>
                          <strong>Examiner Tip:</strong> {voiceEvaluation.tips}
                        </p>
                        <div style={{ background: 'var(--card)', borderRadius: '10px', padding: '10px', border: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', display: 'block', marginBottom: '4px' }}>
                            Model Academic Defence Answer:
                          </span>
                          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--mut)', lineHeight: 1.45 }}>
                            {questionsList[interviewQIdx]?.suggested_answer}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 1. MOCK QUESTIONS SUBTAB */}
              {defenceTab === 'quiz' && (
                <>
                  {/* Empty state: no questions yet and real project loaded */}
                  {questionsList.length === 0 && activeProject?.id && (
                    <div className="card empty" style={{ marginBottom: '14px' }}>
                      <div className="ico">
                        <span className="ms" aria-hidden="true">quiz</span>
                      </div>
                      <h2>No questions yet</h2>
                      <p>Generate AI-grounded oral defence questions tailored to your logbook and report.</p>
                      <button
                        className="btn w"
                        type="button"
                        onClick={async () => {
                          try {
                            triggerToast('Generating defence questions with AI...');
                            await storeGenerateDefence(activeProject.id);
                            triggerToast('Defence questions ready');
                          } catch (err: any) {
                            triggerToast(err.message || 'Failed to generate questions');
                          }
                        }}
                      >
                        <span className="ms" aria-hidden="true">auto_awesome</span>
                        Generate questions
                      </button>
                    </div>
                  )}
                  <div className="row sb" style={{ marginBottom: '14px', gap: '8px' }}>
                    <button
                      className="btn w"
                      type="button"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setExamIndex(0);
                        setExamRevealed(false);
                        setExamOpen(true);
                      }}
                    >
                      <span className="ms" aria-hidden="true">
                        play_arrow
                      </span>
                      Start mock defence
                    </button>
                    {activeProject?.id && (
                      <button
                        className="btn o s"
                        type="button"
                        onClick={async () => {
                          try {
                            triggerToast('Regenerating defence questions with AI...');
                            await storeGenerateDefence(activeProject.id);
                            triggerToast('Defence questions updated');
                          } catch (err: any) {
                            triggerToast(err.message || 'Failed to generate questions');
                          }
                        }}
                      >
                        <span className="ms" aria-hidden="true">
                          auto_awesome
                        </span>
                        Regenerate
                      </button>
                    )}
                  </div>

                  {/* Category Filter Pills */}
                  <div className="pills" role="group" aria-label="Filter questions">
                    {categories.map((c: string) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={selectedCategory === c}
                        onClick={() => setSelectedCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  {/* Questions List */}
                  {filteredQuestions.map((q: any) => {
                    const isOpen = !!revealedDefenceAnswers[q.id];
                    return (
                      <article className={`card q ${isOpen ? 'open' : ''}`} key={q.id}>
                        <span className="chip">{q.category}</span>
                        <h3>{q.question}</h3>
                        <button
                          className="tx"
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setRevealedDefenceAnswers((prev) => ({
                              ...prev,
                              [q.id]: !prev[q.id],
                            }))
                          }
                        >
                          <span className="ms" aria-hidden="true">
                            visibility
                          </span>
                          {isOpen ? 'Hide answer guidance' : 'How to answer'}
                        </button>
                        <p className="ans">{q.suggested_answer}</p>
                        <div className="row">
                          <button
                            className="btn o s"
                            type="button"
                            aria-pressed={q.mastery_status === 'confident'}
                            onClick={() => handleUpdateMastery(q.id, 'confident')}
                          >
                            Confident
                          </button>
                          <button
                            className="btn o s"
                            type="button"
                            aria-pressed={q.mastery_status === 'needs_practice'}
                            onClick={() => handleUpdateMastery(q.id, 'needs_practice')}
                          >
                            Needs practice
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </>
              )}

              {/* 2. PRESENTATION SLIDES SUBTAB */}
              {defenceTab === 'slides' && (
                <>
                  <div className="row sb" style={{ marginBottom: '16px', gap: '8px' }}>
                    <button
                      className="btn s"
                      type="button"
                      style={{ flex: 1 }}
                      onClick={() => openSlideshow(0)}
                    >
                      <span className="ms" aria-hidden="true">
                        slideshow
                      </span>
                      Start slideshow (Projector)
                    </button>
                    {activeProject?.id && (
                      <button
                        className="btn o s"
                        type="button"
                        disabled={isLoadingSlides}
                        onClick={async () => {
                          try {
                            triggerToast('Regenerating presentation slides with AI...');
                            await storeRegenerateSlides(activeProject.id);
                            triggerToast('Slides deck regenerated');
                          } catch (err: any) {
                            triggerToast(err.message || 'Failed to regenerate slides');
                          }
                        }}
                      >
                        <span className="ms" aria-hidden="true">
                          auto_awesome
                        </span>
                        Regenerate slides
                      </button>
                    )}
                  </div>

                  <div className="slide-deck">
                    {defenceSlides.length === 0 ? (
                      <div className="card empty" style={{ marginBottom: '14px' }}>
                        <div className="ico"><span className="ms" aria-hidden="true">slideshow</span></div>
                        <h2>No slides yet</h2>
                        <p>Generate your presentation slides from your report and logbook entries.</p>
                      </div>
                    ) : defenceSlides.map((s: any, idx: number) => (
                      <div className="slide-card" key={s.slide_number || idx}>
                        <div className="slide-card-header">
                          <span className="slide-num">SLIDE {s.slide_number || idx + 1}</span>
                          <button
                            className="tx"
                            type="button"
                            onClick={() => openSlideshow(idx)}
                          >
                            <span className="ms" aria-hidden="true">
                              fullscreen
                            </span>
                            Present slide
                          </button>
                        </div>
                        <h3 className="slide-title">{s.title}</h3>
                        {s.subtitle && <p className="mut" style={{ fontSize: '13px', margin: '-4px 0 10px' }}>{s.subtitle}</p>}
                        <ul className="slide-bullets">
                          {(s.bullets || []).map((b: string, bIdx: number) => (
                            <li key={bIdx}>{b}</li>
                          ))}
                        </ul>
                        {s.speaker_notes && (
                          <div className="slide-notes">
                            <b>Speaker Notes:</b> {s.speaker_notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* 3. ORAL SPEECH SCRIPT & REHEARSAL TIMER SUBTAB */}
              {defenceTab === 'script' && (
                <>
                  {/* Rehearsal Stopwatch Card */}
                  <div className="rehearsal-timer-card">
                    <span className="chip" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                      Rehearsal Stopwatch
                    </span>
                    <div className="timer-digits">
                      {formatTimer(speechTimerSeconds)}
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#aab6c8' }}>
                      Target: 5:00 - 7:00 minutes · Speaking pace: ~130 words/minute
                    </p>
                    <div className="row" style={{ justifyContent: 'center', gap: '10px' }}>
                      <button
                        className="btn s"
                        type="button"
                        onClick={() => setIsSpeechTimerRunning(!isSpeechTimerRunning)}
                      >
                        <span className="ms" aria-hidden="true">
                          {isSpeechTimerRunning ? 'pause' : 'play_arrow'}
                        </span>
                        {isSpeechTimerRunning ? 'Pause timer' : 'Start rehearsal'}
                      </button>
                      <button
                        className="btn o s"
                        type="button"
                        style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
                        onClick={() => {
                          setIsSpeechTimerRunning(false);
                          setSpeechTimerSeconds(0);
                        }}
                      >
                        <span className="ms" aria-hidden="true">
                          restart_alt
                        </span>
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="row sb" style={{ marginBottom: '14px', gap: '8px' }}>
                    <button
                      className="btn o s"
                      type="button"
                      onClick={handleCopyScript}
                    >
                      <span className="ms" aria-hidden="true">
                        content_copy
                      </span>
                      Copy script
                    </button>
                    {activeProject?.id && (
                      <button
                        className="btn o s"
                        type="button"
                        disabled={isLoadingScript}
                        onClick={async () => {
                          try {
                            triggerToast('Regenerating oral presentation script with AI...');
                            await storeRegenerateScript(activeProject.id);
                            triggerToast('Presentation script updated');
                          } catch (err: any) {
                            triggerToast(err.message || 'Failed to regenerate script');
                          }
                        }}
                      >
                        <span className="ms" aria-hidden="true">
                          auto_awesome
                        </span>
                        Regenerate script
                      </button>
                    )}
                  </div>

                  {defenceScript ? (
                    <div className="script-body">{defenceScript}</div>
                  ) : (
                    <div className="card empty">
                      <div className="ico"><span className="ms" aria-hidden="true">article</span></div>
                      <h2>No script yet</h2>
                      <p>Generate your oral presentation script from your report and logbook entries, then rehearse with the timer above.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ======================= TAB: WIZARD (NEW REPORT) ======================= */}
          {currentTab === 'new' && (
            <div className="view">
              <div className="wh">
                <div className="row sb">
                  <button
                    className="ib"
                    type="button"
                    aria-label="Close and go back to home"
                    onClick={() => navigateTab('home', 'bw')}
                  >
                    <span className="ms" aria-hidden="true">
                      close
                    </span>
                  </button>
                  <b style={{ fontSize: '14px' }}>
                    Step {wizardStep + 1} of {WIZARD_PHASES.length}
                  </b>
                  <span className="sp"></span>
                </div>
                <div
                  className="wp"
                  role="progressbar"
                  aria-valuemin={1}
                  aria-valuemax={WIZARD_PHASES.length}
                  aria-valuenow={wizardStep + 1}
                  aria-label="Setup progress"
                >
                  {WIZARD_PHASES.map((_, k) => (
                    <i key={k} className={k <= wizardStep ? 'on' : ''}></i>
                  ))}
                </div>
              </div>

              <form id="wf" className="view" noValidate onSubmit={handleWizardSubmit}>
                <h1 className="wt" tabIndex={-1}>
                  {WIZARD_PHASES[wizardStep].t}
                </h1>
                <p className="wd">{WIZARD_PHASES[wizardStep].d}</p>

                {WIZARD_PHASES[wizardStep].f.map((f: any) => {
                  const val = (wizardData as any)[f.id] || '';
                  const hasErr = !!wizardErrors[f.id];

                  return (
                    <div className={`f ${hasErr ? 'bad' : ''}`} key={f.id}>
                      <label htmlFor={f.id}>
                        {f.label}
                        {f.req && <em aria-hidden="true"> *</em>}
                      </label>
                      {f.sel ? (
                        <select
                          id={f.id}
                          name={f.id}
                          value={val}
                          onChange={(e) =>
                            setWizardData({ ...wizardData, [f.id]: e.target.value })
                          }
                        >
                          {f.sel.map((opt: string) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : f.txt ? (
                        <textarea
                          id={f.id}
                          name={f.id}
                          placeholder={f.ph}
                          value={val}
                          onChange={(e) =>
                            setWizardData({ ...wizardData, [f.id]: e.target.value })
                          }
                        />
                      ) : (
                        <input
                          id={f.id}
                          name={f.id}
                          type={f.date ? 'date' : 'text'}
                          placeholder={f.ph}
                          value={val}
                          required={f.req}
                          onChange={(e) =>
                            setWizardData({ ...wizardData, [f.id]: e.target.value })
                          }
                        />
                      )}
                      {hasErr && <p className="err">{wizardErrors[f.id]}</p>}
                    </div>
                  );
                })}

                <div className="wc">
                  {wizardStep > 0 && (
                    <button
                      className="ib"
                      type="button"
                      aria-label="Previous step"
                      style={{ width: '54px', height: '54px' }}
                      onClick={() => {
                        setAnimDir('bw');
                        setWizardStep((prev) => prev - 1);
                      }}
                    >
                      <span className="ms" aria-hidden="true">
                        arrow_back
                      </span>
                    </button>
                  )}
                  <button className="btn" type="submit" style={{ flex: 1 }}>
                    {wizardStep === WIZARD_PHASES.length - 1 ? (
                      <>
                        <span className="ms" aria-hidden="true">
                          check
                        </span>
                        Create report
                      </>
                    ) : (
                      <>
                        Continue
                        <span className="ms" aria-hidden="true">
                          arrow_forward
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Floating Bottom Tab Bar */}
        <nav className="tb" id="tb" aria-label="Main">
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'home' ? 'page' : undefined}
            onClick={() => navigateTab('home')}
          >
            <span className="ms" aria-hidden="true">
              home
            </span>
            <span className="tab-label">Home</span>
          </button>
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'logbook' ? 'page' : undefined}
            onClick={() => navigateTab('logbook')}
          >
            <span className="ms" aria-hidden="true">
              menu_book
            </span>
            <span className="tab-label">Logbook</span>
          </button>
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'report' ? 'page' : undefined}
            onClick={() => navigateTab('report')}
          >
            <span className="ms" aria-hidden="true">
              description
            </span>
            <span className="tab-label">Report</span>
          </button>
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'defence' ? 'page' : undefined}
            onClick={() => navigateTab('defence')}
          >
            <span className="ms" aria-hidden="true">
              school
            </span>
            <span className="tab-label">Defence</span>
          </button>
        </nav>

        {/* ======================= FULL-SCREEN MOCK DEFENCE ======================= */}
        {examOpen && (
          <div id="exam" role="dialog" aria-modal="true" aria-labelledby="exT">
            <div className="row sb" style={{ padding: '14px 18px' }}>
              <div>
                <b id="exT" style={{ font: '600 14px Fraunces, serif', color: '#58d6ad' }}>
                  MOCK DEFENCE
                </b>
                <div style={{ fontSize: '13px', color: '#aab6c8' }} aria-live="polite">
                  Question {examIndex + 1} of {questionsList.length}
                </div>
              </div>
              <button
                className="ib"
                type="button"
                aria-label="Exit mock defence"
                style={{
                  background: 'rgba(255,255,255,.12)',
                  color: '#fff',
                  boxShadow: 'none',
                }}
                onClick={() => setExamOpen(false)}
              >
                <span className="ms" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <div
              className="bar"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={questionsList.length}
              aria-valuenow={examIndex + 1}
              aria-label="Exam progress"
            >
              <i
                style={{
                  width: `${((examIndex + 1) / questionsList.length) * 100}%`,
                }}
              ></i>
            </div>

            <div className="xb">
              <span className="chip" style={{ width: 'max-content' }}>
                {questionsList[examIndex]?.category}
              </span>
              <h2 id="exq" tabIndex={-1}>
                “{questionsList[examIndex]?.question}”
              </h2>
              <p style={{ color: '#aab6c8', fontSize: '14.5px' }}>
                Say your answer aloud first, then check the guidance.
              </p>
              <div>
                <button
                  className="btn o s"
                  type="button"
                  aria-expanded={examRevealed}
                  onClick={() => setExamRevealed(!examRevealed)}
                >
                  {examRevealed ? 'Hide guidance' : 'Show guidance'}
                </button>
              </div>
              {examRevealed && (
                <p className="ans" id="exa">
                  {questionsList[examIndex]?.suggested_answer}
                </p>
              )}
            </div>

            <div className="xn">
              <button
                className="btn o"
                type="button"
                disabled={examIndex === 0}
                aria-label="Previous question"
                onClick={() => {
                  if (examIndex > 0) {
                    setExamIndex((prev) => prev - 1);
                    setExamRevealed(false);
                  }
                }}
              >
                <span className="ms" aria-hidden="true">
                  arrow_back
                </span>
              </button>
              <button
                className="btn"
                type="button"
                style={{ flex: 1 }}
                onClick={() => {
                  if (examIndex < questionsList.length - 1) {
                    setExamIndex((prev) => prev + 1);
                    setExamRevealed(false);
                  } else {
                    setExamOpen(false);
                    triggerToast('Mock defence complete');
                  }
                }}
              >
                {examIndex === questionsList.length - 1 ? 'Finish' : 'Next question'}
              </button>
            </div>
          </div>
        )}

        {/* ======================= FULLSCREEN SLIDESHOW / PROJECTOR ======================= */}
        {slideshowOpen && (
          <div className="slideshow-modal" role="dialog" aria-modal="true" aria-label="Slideshow Projector">
            <div className="slideshow-topbar">
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#55d6a2', letterSpacing: '0.05em' }}>
                SLIDE {slideshowIndex + 1} OF {defenceSlides.length}
              </span>
              <div className="row" style={{ gap: '10px' }}>
                <button
                  className="btn o s"
                  type="button"
                  style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
                  onClick={() => setShowSpeakerNotes(!showSpeakerNotes)}
                >
                  <span className="ms" aria-hidden="true">
                    notes
                  </span>
                  {showSpeakerNotes ? 'Hide notes' : 'Speaker notes'}
                </button>
                <button
                  className="ib"
                  type="button"
                  aria-label="Exit slideshow"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', boxShadow: 'none' }}
                  onClick={closeSlideshow}
                >
                  <span className="ms" aria-hidden="true">
                    close
                  </span>
                </button>
              </div>
            </div>

            <div className="slideshow-content">
              {(() => {
                const currentSlide = defenceSlides[slideshowIndex] || {};

                return (
                  <div>
                    <h1 style={{ fontSize: '32px', fontFamily: 'Fraunces, Georgia, serif', marginBottom: '10px', color: '#fff' }}>
                      {currentSlide.title || 'Slide Title'}
                    </h1>
                    {currentSlide.subtitle && (
                      <h3 style={{ fontSize: '18px', fontWeight: 500, color: '#55d6a2', marginBottom: '24px' }}>
                        {currentSlide.subtitle}
                      </h3>
                    )}
                    <ul style={{ fontSize: '19px', lineHeight: 1.8, paddingLeft: '24px', color: '#e2e8f0', margin: '20px 0' }}>
                      {(currentSlide.bullets || []).map((b: string, idx: number) => (
                        <li key={idx} style={{ marginBottom: '10px' }}>{b}</li>
                      ))}
                    </ul>

                    {showSpeakerNotes && currentSlide.speaker_notes && (
                      <div style={{ marginTop: '24px', padding: '14px 18px', background: 'rgba(235, 178, 59, 0.15)', borderLeft: '4px solid #ebb23b', borderRadius: '0 12px 12px 0', fontSize: '15px', color: '#fef08a' }}>
                        <b>Speaker Notes:</b> {currentSlide.speaker_notes}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="slideshow-footer">
              <button
                className="btn o s"
                type="button"
                style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
                disabled={slideshowIndex === 0}
                onClick={prevSlide}
              >
                <span className="ms" aria-hidden="true">
                  arrow_back
                </span>
                Previous
              </button>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                Navigate with Left / Right arrow keys or Spacebar
              </span>
              <button
                className="btn s"
                type="button"
                disabled={slideshowIndex >= defenceSlides.length - 1}
                onClick={nextSlide}
              >
                Next
                <span className="ms" aria-hidden="true">
                  arrow_forward
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ======================= BOTTOM MODAL SHEETS ======================= */}
        {activeSheet && (
          <div id="layer">
            <div className="bd" onClick={() => setActiveSheet(null)}></div>
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Dialog"
              tabIndex={-1}
            >
              <div className="hd"></div>

              {/* Account Profile Sheet */}
              {activeSheet === 'me' && (
                <>
                  <h2>{studentName}</h2>
                  <p className="mut" style={{ margin: '-8px 0 18px' }}>
                    {effectiveUser?.email || 'Logged in student'}
                  </p>

                  {projects.length > 1 && (
                    <div className="f" style={{ marginBottom: '14px' }}>
                      <label htmlFor="switch-proj">Switch Active Project</label>
                      <select
                        id="switch-proj"
                        value={activeProject?.id || ''}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          fetchActiveProject(id);
                          setActiveSheet(null);
                        }}
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {canInstallPWA && (
                    <div className="pwa-install-card">
                      <div className="pwa-install-info">
                        <div className="pwa-install-icon">
                          <img src="/icons/icon-72.png" alt="Log2Def" />
                        </div>
                        <div className="pwa-install-text">
                          <h4>
                            {deviceOS === 'ios'
                              ? 'Add to Home Screen'
                              : deviceOS === 'android'
                              ? 'Install Android App'
                              : 'Install Desktop App'}
                          </h4>
                          <p>
                            {deviceOS === 'ios'
                              ? 'Fast full-screen access on iOS Safari'
                              : deviceOS === 'android'
                              ? 'Fast offline access on your phone'
                              : 'Fast standalone window on your PC'}
                          </p>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          className="btn s"
                          type="button"
                          onClick={handleInstallApp}
                        >
                          {deviceOS === 'ios' ? 'How to Add' : 'Install'}
                        </button>
                        {deviceOS !== 'ios' && !(window as any).__pwaInstallPrompt && (
                          <button
                            className="btn o s"
                            type="button"
                            style={{ padding: '6px 10px', fontSize: '12px' }}
                            onClick={() => setActiveSheet('pwaGuide')}
                          >
                            Guide
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    className="btn o w"
                    type="button"
                    style={{ marginBottom: '10px' }}
                    onClick={() => {
                      setActiveSheet(null);
                      navigateTab('new');
                    }}
                  >
                    Start new report project
                  </button>

                  <button
                    className="btn w"
                    type="button"
                    onClick={() => {
                      setActiveSheet(null);
                      logout();
                    }}
                  >
                    Log out
                  </button>
                </>
              )}

              {/* PWA Device-specific Installation & Add to Home Screen Guide */}
              {activeSheet === 'pwaGuide' && (
                <div className="pwa-guide-sheet">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                    <div className="pwa-install-icon" style={{ width: '44px', height: '44px' }}>
                      <img src="/icons/icon-72.png" alt="Log2Def" style={{ width: '30px', height: '30px' }} />
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                        {deviceOS === 'ios'
                          ? 'Add Log2Def to Home Screen'
                          : deviceOS === 'android'
                          ? 'Install Log2Def on Android'
                          : 'Install Log2Def Desktop App'}
                      </h2>
                      <p className="mut" style={{ margin: '2px 0 0', fontSize: '12.5px' }}>
                        {deviceOS === 'ios'
                          ? 'Apple iOS requires adding via the Safari Share menu'
                          : deviceOS === 'android'
                          ? 'Quick installation via your Android browser'
                          : 'Run Log2Def as a standalone desktop application'}
                      </p>
                    </div>
                  </div>

                  {/* Device selector tabs so users can also switch guide manually */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                    <button
                      type="button"
                      className={`btn s ${deviceOS === 'ios' ? '' : 'o'}`}
                      style={{ padding: '4px 10px', fontSize: '11.5px', flex: 1 }}
                      onClick={() => setDeviceOS('ios')}
                    >
                      iPhone / iPad
                    </button>
                    <button
                      type="button"
                      className={`btn s ${deviceOS === 'android' ? '' : 'o'}`}
                      style={{ padding: '4px 10px', fontSize: '11.5px', flex: 1 }}
                      onClick={() => setDeviceOS('android')}
                    >
                      Android
                    </button>
                    <button
                      type="button"
                      className={`btn s ${deviceOS === 'pc' ? '' : 'o'}`}
                      style={{ padding: '4px 10px', fontSize: '11.5px', flex: 1 }}
                      onClick={() => setDeviceOS('pc')}
                    >
                      PC / Mac
                    </button>
                  </div>

                  {/* Steps */}
                  <div className="pwa-steps-list">
                    {deviceOS === 'ios' && (
                      <>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">1</div>
                          <div className="pwa-step-content">
                            <b>Tap the Share button</b>
                            <p>In Safari, tap the <strong>Share</strong> button (<span className="ms" style={{ verticalAlign: 'middle', fontSize: '15px' }}>ios_share</span>) in the bottom navigation bar.</p>
                          </div>
                        </div>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">2</div>
                          <div className="pwa-step-content">
                            <b>Select &ldquo;Add to Home Screen&rdquo;</b>
                            <p>Scroll down the share sheet and tap <strong>Add to Home Screen</strong> (<span className="ms" style={{ verticalAlign: 'middle', fontSize: '15px' }}>add_box</span>).</p>
                          </div>
                        </div>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">3</div>
                          <div className="pwa-step-content">
                            <b>Tap &ldquo;Add&rdquo;</b>
                            <p>Tap <strong>Add</strong> in the top-right corner to place Log2Def on your home screen with instant offline loading.</p>
                          </div>
                        </div>
                      </>
                    )}

                    {deviceOS === 'android' && (
                      <>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">1</div>
                          <div className="pwa-step-content">
                            <b>Open browser menu (⋮)</b>
                            <p>Tap the three vertical dots menu in the top right corner of Chrome or your browser.</p>
                          </div>
                        </div>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">2</div>
                          <div className="pwa-step-content">
                            <b>Tap &ldquo;Install app&rdquo;</b>
                            <p>Select <strong>Install app</strong> or <strong>Add to Home screen</strong> from the dropdown menu.</p>
                          </div>
                        </div>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">3</div>
                          <div className="pwa-step-content">
                            <b>Confirm Installation</b>
                            <p>Tap <strong>Install</strong> to add Log2Def to your home screen and app drawer.</p>
                          </div>
                        </div>
                      </>
                    )}

                    {deviceOS === 'pc' && (
                      <>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">1</div>
                          <div className="pwa-step-content">
                            <b>Click the Install icon in address bar</b>
                            <p>In Chrome, Edge, or Brave, look at the right end of the URL bar for the <strong>Install</strong> icon (⊕ or 💻).</p>
                          </div>
                        </div>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">2</div>
                          <div className="pwa-step-content">
                            <b>Or use browser menu (⋮)</b>
                            <p>Click Menu (⋮) → <strong>Install Log2Def</strong> or <strong>Save and share</strong> → <strong>Install page as app</strong>.</p>
                          </div>
                        </div>
                        <div className="pwa-step-item">
                          <div className="pwa-step-num">3</div>
                          <div className="pwa-step-content">
                            <b>Launch as Desktop App</b>
                            <p>Click <strong>Install</strong> to open Log2Def in its own independent distraction-free window.</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="row" style={{ marginTop: '16px', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn o w"
                      onClick={() => {
                        localStorage.setItem('pwa_installed', 'true');
                        setCanInstallPWA(false);
                        setActiveSheet(null);
                        triggerToast('App marked as installed');
                      }}
                    >
                      I&apos;ve added it
                    </button>
                    <button
                      type="button"
                      className="btn w"
                      onClick={() => setActiveSheet(null)}
                    >
                      Got it
                    </button>
                  </div>
                </div>
              )}

              {/* Upload Department SIWES Guidelines Sheet */}
              {activeSheet === 'uploadGuideline' && (
                <form onSubmit={handleSaveGuideline}>
                  <h2>Department SIWES Guidelines</h2>
                  <p className="mut" style={{ fontSize: '13.5px', margin: '-6px 0 16px' }}>
                    Configure institutional presets or upload custom departmental guidelines for report generation.
                  </p>

                  <div className="f">
                    <label htmlFor="gl-uni">University / Institution</label>
                    <select
                      id="gl-uni"
                      value={guidelineInputUniversity}
                      onChange={(e) => setGuidelineInputUniversity(e.target.value)}
                    >
                      <option value="Lagos State University of Science and Technology (LASUSTECH)">
                        Lagos State University of Science and Technology (LASUSTECH) — Preset
                      </option>
                      <option value="University of Lagos (UNILAG)">
                        University of Lagos (UNILAG)
                      </option>
                      <option value="Lagos State University (LASU)">
                        Lagos State University (LASU)
                      </option>
                      <option value="Federal University of Technology, Akure (FUTA)">
                        Federal University of Technology, Akure (FUTA)
                      </option>
                      <option value="Other University (Custom Guidelines)">
                        Other University (Custom Guidelines)
                      </option>
                    </select>
                  </div>

                  <div className="f">
                    <label htmlFor="gl-file">Upload Guidelines Document (PDF, Word, or TXT)</label>
                    <input
                      id="gl-file"
                      type="file"
                      accept=".pdf,.docx,.doc,.txt,.md"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setGuidelineInputFile(e.target.files[0]);
                        }
                      }}
                    />
                    <small style={{ color: 'var(--mut)', marginTop: '4px', display: 'block' }}>
                      Upload your departmental SIWES handbook, marking scheme, or chapter rubrics.
                    </small>
                  </div>

                  <div className="f">
                    <label htmlFor="gl-text">Or Paste Specific Department Guidelines & Instructions</label>
                    <textarea
                      id="gl-text"
                      rows={5}
                      value={guidelineInputText}
                      onChange={(e) => setGuidelineInputText(e.target.value)}
                      placeholder="e.g. Chapter 3 must focus on networking protocols. Maximum report length 35 pages. Include detailed block diagrams for all circuits."
                    />
                  </div>

                  <div className="row" style={{ gap: '8px' }}>
                    <button
                      className="btn o w"
                      type="button"
                      onClick={() => setActiveSheet(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn w"
                      type="submit"
                      disabled={isUploadingGuideline}
                    >
                      {isUploadingGuideline ? 'Saving...' : 'Apply Guidelines'}
                    </button>
                  </div>
                </form>
              )}

              {/* Save Version Snapshot Sheet */}
              {activeSheet === 'addVersion' && (
                <form onSubmit={handleCreateSnapshot}>
                  <h2>Save Version Snapshot</h2>
                  <p className="mut" style={{ fontSize: '13.5px', margin: '-6px 0 16px' }}>
                    Save a named milestone to track revisions and easily revert at any time.
                  </p>
                  <div className="f">
                    <label htmlFor="vs">Snapshot Description</label>
                    <input
                      id="vs"
                      type="text"
                      placeholder="e.g. Before supervisor inspection or Chapter 3 review"
                      value={newVersionSummary}
                      onChange={(e) => setNewVersionSummary(e.target.value)}
                    />
                  </div>
                  <button className="btn w" type="submit">
                    Save snapshot
                  </button>
                </form>
              )}

              {/* Add Manual Entry Sheet */}
              {activeSheet === 'addEntry' && (
                <form onSubmit={handleAddManualEntry}>
                  <h2>Add entry</h2>
                  <div className="f">
                    <label htmlFor="mw">Week</label>
                    <input
                      id="mw"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={52}
                      value={manualWeek}
                      onChange={(e) => setManualWeek(parseInt(e.target.value, 10) || 1)}
                    />
                  </div>
                  <div className="f">
                    <label htmlFor="mt">What you did</label>
                    <textarea
                      id="mt"
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      placeholder="Tasks performed, machines operated, or troubleshooting carried out"
                    ></textarea>
                  </div>
                  <button className="btn w" type="submit">
                    Save entry
                  </button>
                </form>
              )}

              {/* Type Notes Sheet */}
              {activeSheet === 'typeNotes' && (
                <form onSubmit={handleProcessNotes}>
                  <h2>Type notes</h2>
                  <div className="f">
                    <label htmlFor="nt">One entry per line, like “Week 3: …”</label>
                    <textarea
                      id="nt"
                      style={{ minHeight: '160px' }}
                      value={rawNotes}
                      onChange={(e) => setRawNotes(e.target.value)}
                      placeholder="Week 1: Safety induction and tour of facility&#10;Week 2: Configured router subnets with supervisor&#10;Week 3: Troubleshot optical transceiver attenuation"
                    ></textarea>
                  </div>
                  <button className="btn w" type="submit">
                    Add entries
                  </button>
                </form>
              )}

              {/* Correct Extracted Text Sheet */}
              {activeSheet === 'correctText' && (
                <div>
                  <h2>Correct text</h2>
                  <div className="f">
                    <label htmlFor="ft">Fix any OCR or unclear words</label>
                    <textarea
                      id="ft"
                      style={{ minHeight: '180px' }}
                      value={correctingText}
                      onChange={(e) => setCorrectingText(e.target.value)}
                    ></textarea>
                  </div>
                  <button
                    className="btn w"
                    type="button"
                    onClick={handleSaveCorrectedPage}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Local Toast Notification Pill */}
        <div
          id="toast"
          className={localToast.visible ? 'on' : ''}
          role="status"
          aria-live="polite"
        >
          {localToast.message}
        </div>
      </div>
    </div>
  );
}
