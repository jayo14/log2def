'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import {
  useAuthStore,
  useProjectStore,
  useReportStore,
  useUIStore,
  useFeatureFlags,
} from '@/lib/store';
import {
  enqueueUploads,
  getQueuedUploads,
  processUploadQueue,
  clearCompletedUploads,
  reorderQueuedUploads,
  removeQueuedUpload,
  QueuedUpload,
} from '@/lib/offline-queue';
import CameraCapture, { CapturedPage } from '@/components/CameraCapture';
import PageReviewModal from '@/components/PageReviewModal';
import MissingInfoModal from '@/components/MissingInfoModal';
import { detectDeviceOS, isStandaloneApp, DeviceOS } from '@/lib/device';
import '@/app/dashboard.css';

export default function DashboardPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();

  // Project & Data Stores
  const {
    projects,
    activeProject,
    completeness,
    fetchProjects,
    fetchActiveProject,
    fetchCompleteness,
    updateMissingInfo: storeUpdateMissingInfo,
    createProject,
    uploadDocument: storeUploadDocument,
    reorderDocuments: storeReorderDocuments,
    deleteDocument: storeDeleteDocument,
    reprocessDocument: storeReprocessDocument,
    updatePage: storeUpdatePage,
    updateLogbookEntry: storeUpdateLogbookEntry,
    deleteLogbookEntry: storeDeleteLogbookEntry,
    bulkVerifyEntries: storeBulkVerifyEntries,
    updateActiveProject: storeUpdateProject,
  } = useProjectStore();

  const {
    report,
    fetchReport,
    generateReport: storeGenerateReport,
    saveSection: storeSaveSection,
    downloadDocx: storeDownloadDocx,
    downloadPdf: storeDownloadPdf,
    isGeneratingReport,
  } = useReportStore();

  const { flags: systemFlags, fetchFlags: fetchFeatureFlags } = useFeatureFlags();

  // Navigation tab state: 'home' | 'logbook' | 'report' | 'settings' | 'new'
  const [currentTab, setCurrentTab] = useState<'home' | 'logbook' | 'report' | 'settings' | 'new'>('home');
  const [logbookTab, setLogbookTab] = useState<'entries' | 'docs'>('docs');
  const [reportTab, setReportTab] = useState<'editor' | 'preview' | 'export'>('editor');
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number>(0);

  // Multi-file upload progress & offline queue
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [uploadQueue, setUploadQueue] = useState<QueuedUpload[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  // Affirmation dialog / banner state
  const [affirmationScreen, setAffirmationScreen] = useState<{
    visible: boolean;
    step: number;
    title: string;
    description: string;
    stats?: { label: string; value: string }[];
    primaryActionLabel: string;
    onPrimaryAction: () => void;
  } | null>(null);

  // PWA Offline & Install Prompt states
  const [isOffline, setIsOffline] = useState(false);
  const [canInstallPWA, setCanInstallPWA] = useState(false);
  const [deviceOS, setDeviceOS] = useState<DeviceOS>('pc');

  // Local UI & Scroll states
  const [isScrolled, setIsScrolled] = useState(false);
  const [animDir, setAnimDir] = useState<'fw' | 'bw'>('fw');
  const scrRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');

  // Interactive Bottom Sheet Modal state: 'me' (profile) | 'editDetails' | 'pwaGuide' | null
  const [activeSheet, setActiveSheet] = useState<'me' | 'editDetails' | 'pwaGuide' | null>(null);

  // Page Review & Missing Info Modal states
  const [reviewingDoc, setReviewingDoc] = useState<any | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isMissingInfoOpen, setIsMissingInfoOpen] = useState(false);

  // Step 1: Details Form state
  const [detailsStep, setDetailsStep] = useState<1 | 2>(1);
  const [detailsData, setDetailsData] = useState({
    full_name: '',
    matric_number: '',
    department: '',
    faculty_school: 'College of Applied Sciences and Technology',
    university_name: 'Lagos State University of Science and Technology (LASUSTECH)',
    organization_name: '',
    organization_address: '',
    placement_department: '',
    training_start_date: '',
    training_end_date: '',
    industry_supervisor_name: '',
    academic_supervisor_name: '',
  });
  const [detailsErrors, setDetailsErrors] = useState<Record<string, string>>({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);

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
    }, 2500);
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
    fetchFeatureFlags();

    const handleHash = () => {
      const hash = window.location.hash.replace('#/', '').replace('#', '').split('/')[0];
      if (['home', 'logbook', 'report', 'settings', 'new'].includes(hash)) {
        setCurrentTab(hash as any);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [fetchFeatureFlags]);

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

  // Load active project details
  useEffect(() => {
    if (activeProject?.id) {
      fetchCompleteness(activeProject.id).catch(() => null);
      fetchReport(activeProject.id).catch(() => null);
      getQueuedUploads(activeProject.id).then(setUploadQueue).catch(() => []);

      // Prepopulate details data from active project
      setDetailsData({
        full_name: activeProject.full_name || '',
        matric_number: activeProject.matric_number || '',
        department: activeProject.department || '',
        faculty_school: activeProject.faculty_school || 'College of Applied Sciences and Technology',
        university_name: activeProject.university_name || 'Lagos State University of Science and Technology (LASUSTECH)',
        organization_name: activeProject.organization_name || '',
        organization_address: activeProject.organization_address || '',
        placement_department: activeProject.placement_department || '',
        training_start_date: activeProject.training_start_date ? String(activeProject.training_start_date).slice(0, 10) : '',
        training_end_date: activeProject.training_end_date ? String(activeProject.training_end_date).slice(0, 10) : '',
        industry_supervisor_name: activeProject.industry_supervisor_name || '',
        academic_supervisor_name: activeProject.academic_supervisor_name || '',
      });
    }
  }, [activeProject?.id]);

  // Prepopulate user profile in details if empty
  useEffect(() => {
    if (user && !detailsData.full_name) {
      const fullName = user.first_name
        ? `${user.first_name} ${user.last_name || ''}`.trim()
        : user.username;
      setDetailsData((prev) => ({
        ...prev,
        full_name: prev.full_name || fullName,
      }));
    }
  }, [user]);

  // PWA Offline detection & installability
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);

      const detectedOS = detectDeviceOS();
      setDeviceOS(detectedOS);

      const installed = isStandaloneApp();
      if (!installed) {
        setCanInstallPWA(true);
      }

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  // Scroll detection
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollTop > 40 && !isScrolled) {
      setIsScrolled(true);
    } else if (target.scrollTop <= 40 && isScrolled) {
      setIsScrolled(false);
    }
  };

  // Switch Tab
  const navigateTab = (newTab: 'home' | 'logbook' | 'report' | 'settings' | 'new', dir: 'fw' | 'bw' = 'fw') => {
    setAnimDir(dir);
    setCurrentTab(newTab);
    if (typeof window !== 'undefined') {
      window.location.hash = `#/${newTab}`;
    }
    if (scrRef.current) {
      scrRef.current.scrollTop = 0;
    }
  };

  // Artifact fallback project for preview
  const FALLBACK_PROJECT = {
    id: 1,
    title: 'SIWES Technical Report',
    full_name: 'Babatunde Emmanuel',
    matric_number: 'LASU/STE/2021/0458',
    department: 'Computer Engineering',
    faculty_school: 'College of Applied Sciences and Technology',
    university_name: 'Lagos State University of Science and Technology (LASUSTECH)',
    organization_name: 'Mi Labs Engineering',
    organization_address: 'Plot 14, Commercial Avenue, Ikeja, Lagos State',
    training_start_date: '2024-03-04',
    training_end_date: '2024-08-30',
    logbook_entries: [
      {
        id: 1,
        week_number: 1,
        activity_summary: 'Safety induction, equipment orientation, and workshop setup',
        verified_text: 'Safety induction, equipment orientation, and workshop setup',
        is_verified: true,
      },
      {
        id: 2,
        week_number: 2,
        activity_summary: 'Configured local development network and verified router tables',
        verified_text: 'Configured local development network and verified router tables',
        is_verified: true,
      },
      {
        id: 3,
        week_number: 3,
        activity_summary: 'Assisted senior engineer with server maintenance and cable termination',
        verified_text: 'Assisted senior engineer with server maintenance and cable termination',
        is_verified: false,
      },
    ],
    source_documents: [
      {
        id: 1,
        original_filename: 'Logbook_Weeks_1_to_4.pdf',
        ocr_status: 'completed',
        page_index: 0,
        pages: [
          {
            id: 1,
            page_number: 1,
            confidence_score: 0.92,
            extracted_text:
              'Week 1: Safety induction and workshop tour.\nWeek 2: Configured local development network and verified routing tables.',
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
          first_name: 'Babatunde',
          last_name: 'Emmanuel',
          email: 'babatunde@lasustech.edu.ng',
          username: 'babatunde',
        }
      : null);

  const studentName = effectiveProject?.full_name || (effectiveUser?.first_name ? `${effectiveUser.first_name} ${effectiveUser.last_name || ''}`.trim() : 'Student');
  const userInitials = effectiveUser?.first_name
    ? `${effectiveUser.first_name[0]}${effectiveUser.last_name ? effectiveUser.last_name[0] : ''}`.toUpperCase()
    : 'SI';

  // Derived Workflow Progress
  const projectEntries = effectiveProject?.logbook_entries || [];
  const projectDocuments = effectiveProject?.source_documents || [];
  const sortedDocuments = [...projectDocuments].sort((a: any, b: any) => (a.page_index ?? 0) - (b.page_index ?? 0));
  const verifiedCount = projectEntries.filter((e: any) => e.is_verified).length;
  const totalEntries = projectEntries.length;
  const hasReport = !!(report || effectiveProject?.report);
  const isCompletenessReady = completeness?.can_generate ?? (totalEntries > 0 && effectiveProject?.organization_name);

  // Compute Active Step in the 6-Step Journey:
  // Step 1: Details entered? (Yes if project exists with org name and matric)
  // Step 2: Upload? (Yes if source_documents.length > 0)
  // Step 3: Extract & review? (Yes if entries exist and at least 1 verified)
  // Step 4: Complete? (Yes if completeness.can_generate is true)
  // Step 5: Generate? (Yes if report is generated)
  // Step 6: Review & export
  const hasDetails = Boolean(effectiveProject && effectiveProject.matric_number && effectiveProject.organization_name);
  const hasUploads = sortedDocuments.length > 0 || uploadQueue.length > 0;
  const hasExtracted = totalEntries > 0;
  const isComplete = Boolean(completeness?.can_generate);

  let currentWorkflowStep = 1;
  if (!effectiveProject || !hasDetails) {
    currentWorkflowStep = 1;
  } else if (!hasUploads) {
    currentWorkflowStep = 2;
  } else if (!hasExtracted || verifiedCount === 0) {
    currentWorkflowStep = 3;
  } else if (!isComplete) {
    currentWorkflowStep = 4;
  } else if (!hasReport) {
    currentWorkflowStep = 5;
  } else {
    currentWorkflowStep = 6;
  }

  const progressPct = effectiveProject
    ? Math.round(
        ((hasDetails ? 1 : 0) +
          (hasUploads ? 1 : 0) +
          (verifiedCount > 0 ? 1 : 0) +
          (isComplete ? 1 : 0) +
          (hasReport ? 1 : 0)) /
          5 *
          100
      )
    : 0;

  // Up Next CTA based on workflow step
  const getUpNextAction = () => {
    switch (currentWorkflowStep) {
      case 1:
        return {
          title: 'Enter your basic details',
          desc: 'Student name, matric, department, and company placement',
          buttonText: 'Enter Details',
          tab: 'new' as const,
        };
      case 2:
        return {
          title: 'Capture or upload your logbook',
          desc: 'Snap pages with phone camera or upload photos/PDF',
          buttonText: 'Upload Logbook',
          tab: 'logbook' as const,
        };
      case 3:
        return {
          title: 'Review extracted entries',
          desc: `${totalEntries} weekly technical activities found in your logbook`,
          buttonText: 'Review Activities',
          tab: 'logbook' as const,
        };
      case 4:
        return {
          title: 'Complete required information',
          desc: completeness?.blocking_reasons?.[0] || 'A few essential fields are required before generation',
          buttonText: 'Complete Missing Info',
          action: () => setIsMissingInfoOpen(true),
          tab: 'logbook' as const,
        };
      case 5:
        return {
          title: 'Generate your technical report',
          desc: 'All information verified. Generate your 12–15 page LASUSTECH report',
          buttonText: 'Generate Technical Report',
          action: () => handleGenerateReport(),
          tab: 'report' as const,
        };
      case 6:
      default:
        return {
          title: 'Review and download report',
          desc: 'Your LASUSTECH technical report is ready for export (Word & PDF)',
          buttonText: 'Download Report',
          tab: 'report' as const,
        };
    }
  };

  const upNext = getUpNextAction();

  // Chapter names
  const CHAPTER_NAMES = [
    'Preliminary pages',
    'Chapter One: Introduction',
    'Chapter Two: Company Profile',
    'Chapter Three: Training Activities',
    'Chapters Four & Five: Skills & Conclusion',
  ];

  const getSectionContent = (idx: number) => {
    if (report?.sections && report.sections.length > idx) {
      return report.sections[idx].content;
    }
    const title = CHAPTER_NAMES[idx] || `Chapter ${idx + 1}`;
    return `<p style="color:#5f6761;font-style:italic;"><strong>${title}</strong> will be generated using your verified logbook records and the approved LASUSTECH format.</p>`;
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
        {
          maxConcurrency: 2,
          onItemCompleted: () => {
            setUploadProgress((prev) => ({
              current: Math.min(prev.total, prev.current + 1),
              total: prev.total,
            }));
          },
        }
      );
      if (result.processed > 0) {
        await fetchActiveProject(activeProject.id);
        await fetchCompleteness(activeProject.id);
        setLogbookTab('docs');
        triggerToast(`Processed ${result.processed} logbook photo${result.processed > 1 ? 's' : ''}`);

        // Affirmation Screen for upload completion
        setAffirmationScreen({
          visible: true,
          step: 2,
          title: 'Logbook Successfully Uploaded!',
          description: `${result.processed} logbook page${result.processed > 1 ? 's were' : ' was'} processed and safely preserved as your authoritative source of technical truth.`,
          stats: [
            { label: 'Pages Processed', value: String(result.processed) },
            { label: 'Status', value: 'OCR Extraction Complete' },
          ],
          primaryActionLabel: 'Review Extracted Activities',
          onPrimaryAction: () => {
            setAffirmationScreen(null);
            navigateTab('logbook');
            setLogbookTab('entries');
          },
        });
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

  // Multi-file Logbook Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeProject?.id) {
      triggerToast('Please save your placement details first.');
      navigateTab('new');
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
        triggerToast(`${filesArray.length} photo${filesArray.length > 1 ? 's' : ''} queued offline. Will upload when back online.`);
        return;
      }

      await runAutoResumeQueue();
    } catch (err: any) {
      triggerToast(err.message || 'Failed to process files');
    }
  };

  // Camera capture complete handler
  const handleCameraCaptureComplete = async (captured: CapturedPage[]) => {
    setIsCameraOpen(false);
    if (!activeProject?.id || captured.length === 0) return;

    try {
      setIsUploadingFiles(true);
      setUploadStatusText(`Compressing and preparing ${captured.length} photo${captured.length > 1 ? 's' : ''}...`);

      const blobs = captured.map((c) => c.blob);
      const names = captured.map((c) => `${c.label.toLowerCase().replace(/\s+/g, '_')}.jpg`);

      await enqueueUploads(activeProject.id, blobs, {
        fileNames: names,
      });

      const currentQueue = await getQueuedUploads(activeProject.id);
      setUploadQueue(currentQueue);

      if (!navigator.onLine) {
        triggerToast(`${captured.length} page${captured.length > 1 ? 's' : ''} saved offline. Will auto-upload when back online.`);
        setIsUploadingFiles(false);
        return;
      }

      await runAutoResumeQueue();
    } catch (err: any) {
      triggerToast(err.message || 'Failed to queue captured pages');
      setIsUploadingFiles(false);
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
      triggerToast('Document removed');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to delete document');
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

  // Generate Report Action with Affirmation
  const handleGenerateReport = async () => {
    if (!activeProject?.id) return;
    try {
      triggerToast('Generating report using approved LASUSTECH template...');
      await storeGenerateReport(activeProject.id);
      await fetchReport(activeProject.id);
      triggerToast('Technical report generated successfully!');

      // Affirmation Screen
      setAffirmationScreen({
        visible: true,
        step: 5,
        title: 'Report Generated Successfully!',
        description: 'Your SIWES technical report has been generated following the approved LASUSTECH format. It is approximately 12–15 pages, with Times New Roman 12pt, 1.5 line spacing, and correct academic pagination.',
        stats: [
          { label: 'Chapters', value: '5 Chapters Complete' },
          { label: 'Pagination', value: 'Preliminary i-iv • Main 1-15' },
          { label: 'Institution', value: 'LASUSTECH Approved' },
        ],
        primaryActionLabel: 'Review & Download Report',
        onPrimaryAction: () => {
          setAffirmationScreen(null);
          navigateTab('report');
          setReportTab('editor');
        },
      });
    } catch (err: any) {
      triggerToast(err.message || 'Report generation failed');
    }
  };

  // Download Handlers
  const handleDownloadWord = async () => {
    if (!activeProject?.id) return;
    try {
      triggerToast('Preparing Word document (.docx)...');
      await storeDownloadDocx(activeProject.id);
      triggerToast('Downloaded Word document (.docx)');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to download Word document');
    }
  };

  const handleDownloadPdf = async () => {
    if (!activeProject?.id) return;
    try {
      triggerToast('Compiling print-ready PDF...');
      await storeDownloadPdf(activeProject.id);
      triggerToast('Downloaded PDF (.pdf)');
    } catch (err: any) {
      triggerToast(err.message || 'Failed to download PDF');
    }
  };

  const handleDirectPrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  // Step 1: Save Details Form
  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!detailsData.full_name?.trim()) errors.full_name = 'Full name is required';
    if (!detailsData.matric_number?.trim()) errors.matric_number = 'Matriculation number is required';
    if (!detailsData.department?.trim()) errors.department = 'Department is required';
    if (!detailsData.organization_name?.trim()) errors.organization_name = 'Company name is required';
    if (!detailsData.organization_address?.trim()) errors.organization_address = 'Company address is required';
    if (!detailsData.training_start_date) errors.training_start_date = 'Start date is required';
    if (!detailsData.training_end_date) errors.training_end_date = 'End date is required';

    if (detailsData.training_start_date && detailsData.training_end_date) {
      const s = new Date(detailsData.training_start_date);
      const eDate = new Date(detailsData.training_end_date);
      if (s >= eDate) {
        errors.training_end_date = 'End date must be strictly after start date';
      }
    }

    if (Object.keys(errors).length > 0) {
      setDetailsErrors(errors);
      triggerToast('Please complete all required fields.');
      return;
    }

    setDetailsErrors({});
    setIsSavingDetails(true);

    try {
      const payload = {
        title: `SIWES Technical Report - ${detailsData.organization_name.trim()}`,
        full_name: detailsData.full_name.trim(),
        matric_number: detailsData.matric_number.trim(),
        department: detailsData.department.trim(),
        faculty_school: detailsData.faculty_school.trim(),
        university_name: detailsData.university_name.trim(),
        organization_name: detailsData.organization_name.trim(),
        organization_address: detailsData.organization_address.trim(),
        placement_department: detailsData.placement_department?.trim() || '',
        training_start_date: detailsData.training_start_date,
        training_end_date: detailsData.training_end_date,
        industry_supervisor_name: detailsData.industry_supervisor_name?.trim() || '',
        academic_supervisor_name: detailsData.academic_supervisor_name?.trim() || '',
      };

      if (activeProject?.id) {
        await storeUpdateProject(activeProject.id, payload);
        await fetchActiveProject(activeProject.id);
      } else {
        const newProj = await createProject(payload);
        if (newProj?.id) {
          await fetchActiveProject(newProj.id);
        }
      }

      triggerToast('Placement details confirmed!');

      // Affirmation Screen for Step 1
      setAffirmationScreen({
        visible: true,
        step: 1,
        title: 'Placement Details Saved!',
        description: 'Your student and SIWES details have been saved to the approved LASUSTECH template. Now, let’s capture or upload your logbook pages.',
        stats: [
          { label: 'Institution', value: 'LASUSTECH' },
          { label: 'Company', value: detailsData.organization_name },
          { label: 'Matric No', value: detailsData.matric_number },
        ],
        primaryActionLabel: 'Proceed to Logbook Upload',
        onPrimaryAction: () => {
          setAffirmationScreen(null);
          navigateTab('logbook');
        },
      });
    } catch (err: any) {
      triggerToast(err.message || 'Failed to save details');
    } finally {
      setIsSavingDetails(false);
    }
  };

  // PWA Install Trigger
  const handleInstallApp = async () => {
    if (deviceOS === 'ios') {
      setActiveSheet('pwaGuide');
      return;
    }
    const promptEvent = (window as any).__pwaInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        localStorage.setItem('pwa_installed', 'true');
        setCanInstallPWA(false);
        triggerToast('Log2Def installed successfully!');
      }
    } else {
      setActiveSheet('pwaGuide');
    }
  };

  return (
    <div className="dashboard-root">
      <div className={`app ${animDir}`}>
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
                  aria-label="Student Account"
                  onClick={() => setActiveSheet('me')}
                >
                  {userInitials}
                </button>
              </header>

              <div className="lg">
                <h1>Hi, {studentName.split(' ')[0]}</h1>
                <p>Turn your logbook into a technical report.</p>
              </div>

              {/* Offline Warning Banner */}
              {isOffline && (
                <div className="offline-banner" role="status">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ms" aria-hidden="true">cloud_off</span>
                    <span>Offline mode. Your local drafts remain accessible.</span>
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

              {/* Hero Card / Empty State */}
              {!effectiveProject ? (
                <div className="card empty">
                  <div className="ico">
                    <span className="ms" aria-hidden="true">auto_stories</span>
                  </div>
                  <h2>Turn your logbook into a technical report</h2>
                  <p>
                    Upload your completed SIWES logbook. We&apos;ll extract your activities and help you prepare your technical report.
                  </p>
                  <button
                    className="btn w"
                    type="button"
                    onClick={() => navigateTab('new')}
                  >
                    <span className="ms" aria-hidden="true">add</span>
                    Start a new report
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
                      {hasReport ? 'Report ready' : `Step ${currentWorkflowStep} of 6`}
                    </span>
                    <h2 style={{ maxWidth: '11em' }}>{effectiveProject.organization_name || effectiveProject.title}</h2>
                    <p>
                      {verifiedCount} of {totalEntries} entries verified • {sortedDocuments.length} page{sortedDocuments.length === 1 ? '' : 's'}
                    </p>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        if (upNext.action) upNext.action();
                        else navigateTab(upNext.tab);
                      }}
                    >
                      {upNext.buttonText}
                      <span className="ms" aria-hidden="true">arrow_forward</span>
                    </button>
                  </section>

                  {/* Quick Actions */}
                  <div className="qa">
                    <button type="button" onClick={() => navigateTab('new')}>
                      <span className="ms" aria-hidden="true">edit_note</span>
                      Details
                    </button>
                    <button type="button" onClick={() => navigateTab('logbook')}>
                      <span className="ms" aria-hidden="true">upload_file</span>
                      Logbook
                    </button>
                    <button type="button" onClick={() => navigateTab('report')}>
                      <span className="ms" aria-hidden="true">auto_awesome</span>
                      Report
                    </button>
                  </div>

                  {/* Up Next Section */}
                  <h2 className="sh">Up next</h2>
                  <div className="card" style={{ padding: '4px 16px' }}>
                    <div
                      className="lr"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (upNext.action) upNext.action();
                        else navigateTab(upNext.tab);
                      }}
                    >
                      <span className="ic">
                        <span className="ms" aria-hidden="true">
                          {currentWorkflowStep === 6 ? 'download' : 'arrow_forward'}
                        </span>
                      </span>
                      <span style={{ flex: 1 }}>
                        <b>{upNext.title}</b>
                        <small>{upNext.desc}</small>
                      </span>
                      <span className="ms mut" aria-hidden="true">chevron_right</span>
                    </div>

                    {hasReport && (
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
                          <span className="ms" aria-hidden="true">download</span>
                        </span>
                        <span style={{ flex: 1 }}>
                          <b>Export Word and PDF</b>
                          <small>LASUSTECH 1.5&rdquo; binding margin format</small>
                        </span>
                        <span className="ms mut" aria-hidden="true">chevron_right</span>
                      </div>
                    )}
                  </div>

                  {/* Secondary Action */}
                  <button
                    className="home-fab"
                    type="button"
                    onClick={() => navigateTab('new')}
                    aria-label="Start a new report"
                  >
                    <span className="ms" aria-hidden="true">add</span>
                    New report
                  </button>
                </>
              )}
            </div>
          )}

          {/* ======================= TAB: LOGBOOK (STEPS 2 & 3) ======================= */}
          {currentTab === 'logbook' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">arrow_back</span>
                </button>
                <span className="tt">My Logbooks</span>
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
                <h1>My Logbooks</h1>
                <p>
                  {effectiveProject?.organization_name || 'Upload handwritten notes & scans'}
                </p>
              </div>

              {/* Completeness / Validation Banner */}
              {completeness && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '14px',
                    background: completeness.can_generate ? 'var(--mint)' : '#fffbeb',
                    border: `1px solid ${completeness.can_generate ? 'rgba(6, 107, 77, 0.3)' : '#fde68a'}`,
                    borderRadius: '16px',
                    padding: '12px 16px',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className="ms" style={{ color: completeness.can_generate ? 'var(--g)' : 'var(--amb)', fontSize: '22px' }}>
                      {completeness.can_generate ? 'verified' : 'fact_check'}
                    </span>
                    <div>
                      <strong style={{ fontSize: '13.5px', display: 'block', color: 'var(--ink)' }}>
                        {completeness.can_generate ? 'Information Verified (Ready)' : 'Missing Information Notice'}
                      </strong>
                      <span style={{ fontSize: '12px', color: 'var(--mut)' }}>
                        {completeness.can_generate
                          ? 'All required fields found. Ready to generate report.'
                          : completeness.blocking_reasons?.[0] || 'Provide missing required details.'}
                      </span>
                    </div>
                  </div>

                  {!completeness.can_generate && (
                    <button
                      type="button"
                      className="btn s"
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                      onClick={() => setIsMissingInfoOpen(true)}
                    >
                      Complete Missing Info
                    </button>
                  )}
                </div>
              )}

              {/* Upload Actions (Step 2) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <button
                  type="button"
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px 12px',
                    textAlign: 'center',
                    border: '1.5px dashed var(--line)',
                    background: 'var(--card)',
                    cursor: 'pointer',
                    borderRadius: '20px',
                    margin: 0,
                  }}
                  onClick={() => setIsCameraOpen(true)}
                >
                  <span className="ms" style={{ fontSize: '30px', color: 'var(--g)', marginBottom: '4px' }} aria-hidden="true">
                    photo_camera
                  </span>
                  <b style={{ fontSize: '14px' }}>Take Photos</b>
                  <span className="mut" style={{ fontSize: '11.5px', marginTop: '2px' }}>
                    Continuous camera capture
                  </span>
                </button>

                <label
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px 12px',
                    textAlign: 'center',
                    border: '1.5px dashed var(--line)',
                    background: 'var(--card)',
                    cursor: 'pointer',
                    borderRadius: '20px',
                    margin: 0,
                  }}
                >
                  <span className="ms" style={{ fontSize: '30px', color: '#0369a1', marginBottom: '4px' }} aria-hidden="true">
                    cloud_upload
                  </span>
                  <b style={{ fontSize: '14px' }}>Upload Files</b>
                  <span className="mut" style={{ fontSize: '11.5px', marginTop: '2px' }}>
                    JPG, PNG, WebP or PDF
                  </span>
                  <input
                    type="file"
                    id="fi"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    aria-label="Upload logbook pages"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {/* Sub-tabs: Logbook Pages | Extracted Activities */}
              <div className="seg" role="tablist" aria-label="Logbook views" style={{ marginBottom: '14px' }}>
                <button
                  role="tab"
                  type="button"
                  aria-selected={logbookTab === 'docs'}
                  onClick={() => setLogbookTab('docs')}
                >
                  Logbook Pages ({sortedDocuments.length})
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={logbookTab === 'entries'}
                  onClick={() => setLogbookTab('entries')}
                >
                  Extracted Activities ({totalEntries})
                </button>
              </div>

              {/* 1. Logbook Pages View */}
              {logbookTab === 'docs' && (
                <div>
                  {isUploadingFiles && (
                    <div className="card" style={{ padding: '16px', background: 'var(--mint)', border: '1px solid rgba(6, 107, 77, 0.2)' }}>
                      <div className="row sb" style={{ marginBottom: '6px' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--gd)' }}>{uploadStatusText}</strong>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--g)' }}>
                          {uploadProgress.current} / {uploadProgress.total}
                        </span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.7)', borderRadius: '99px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            background: 'var(--g)',
                            width: `${uploadProgress.total ? (uploadProgress.current / uploadProgress.total) * 100 : 30}%`,
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {sortedDocuments.length === 0 && uploadQueue.length === 0 ? (
                    <div className="card empty">
                      <div className="ico">
                        <span className="ms" aria-hidden="true">photo_library</span>
                      </div>
                      <h2>No logbook pages yet</h2>
                      <p>Use the camera button or upload button above to add your completed logbook pages.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {sortedDocuments.map((doc: any, idx: number) => {
                        const page = doc.pages?.[0];
                        return (
                          <div key={doc.id} className="card" style={{ padding: '12px 14px', margin: 0 }}>
                            <div className="row sb">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div
                                  style={{
                                    width: '42px',
                                    height: '52px',
                                    borderRadius: '8px',
                                    background: 'var(--paper)',
                                    border: '1px solid var(--line)',
                                    display: 'grid',
                                    placeItems: 'center',
                                    overflow: 'hidden',
                                    flex: 'none',
                                  }}
                                >
                                  {doc.file_url ? (
                                    <img src={doc.file_url} alt="Page" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : (
                                    <span className="ms mut" style={{ fontSize: '20px' }}>description</span>
                                  )}
                                </div>
                                <div>
                                  <b style={{ fontSize: '14px', display: 'block' }}>
                                    Page {idx + 1}: {doc.original_filename || 'Logbook Scan'}
                                  </b>
                                  <span className="mut" style={{ fontSize: '12px' }}>
                                    OCR Status: {doc.ocr_status || 'Processed'} {page?.confidence_score ? `• ${Math.round(page.confidence_score * 100)}% accuracy` : ''}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  className="btn o s"
                                  style={{ padding: '6px 12px', fontSize: '12px' }}
                                  onClick={() => {
                                    setReviewingDoc(doc);
                                    setIsReviewModalOpen(true);
                                  }}
                                >
                                  Inspect
                                </button>
                                <button
                                  type="button"
                                  className="ib"
                                  style={{ width: '34px', height: '34px' }}
                                  onClick={() => handleDeleteDoc(doc.id)}
                                  title="Delete page"
                                >
                                  <span className="ms mut" style={{ fontSize: '18px' }}>delete</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 2. Extracted Activities View (Step 3) */}
              {logbookTab === 'entries' && (
                <div>
                  <div className="row sb" style={{ marginBottom: '12px' }}>
                    <div>
                      <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Verified Weekly Entries</h2>
                      <span className="mut" style={{ fontSize: '12px' }}>
                        Extracted directly from your logbook. No fabricated experiences.
                      </span>
                    </div>
                    {totalEntries > 0 && verifiedCount < totalEntries && (
                      <button
                        type="button"
                        className="btn s"
                        style={{ padding: '6px 14px', fontSize: '12px' }}
                        onClick={handleVerifyAll}
                      >
                        Verify All ({totalEntries})
                      </button>
                    )}
                  </div>

                  {projectEntries.length === 0 ? (
                    <div className="card empty">
                      <p>No activities extracted yet. Upload your logbook pages to trigger OCR extraction.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {projectEntries.map((entry: any) => (
                        <div key={entry.id} className="card" style={{ padding: '14px', margin: 0 }}>
                          <div className="row sb" style={{ marginBottom: '6px' }}>
                            <span className="chip">Week {entry.week_number}</span>
                            <button
                              type="button"
                              className={`btn s ${entry.is_verified ? '' : 'o'}`}
                              style={{ padding: '4px 10px', fontSize: '11px', minHeight: '30px' }}
                              onClick={() => handleToggleVerify(entry)}
                            >
                              <span className="ms" style={{ fontSize: '14px' }}>
                                {entry.is_verified ? 'check' : 'check_box_outline_blank'}
                              </span>
                              {entry.is_verified ? 'Verified' : 'Verify'}
                            </button>
                          </div>
                          <p style={{ fontSize: '13.5px', color: 'var(--ink)', lineHeight: '1.5' }}>
                            {entry.activity_summary || entry.verified_text}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Proceed to Generation Button */}
                  <div style={{ marginTop: '20px' }}>
                    <button
                      type="button"
                      className="btn w"
                      onClick={() => {
                        if (isComplete) {
                          handleGenerateReport();
                        } else {
                          setIsMissingInfoOpen(true);
                        }
                      }}
                    >
                      {isComplete ? 'Generate Report' : 'Complete Info'}
                      <span className="ms">arrow_forward</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================= TAB: REPORT (STEPS 5 & 6) ======================= */}
          {currentTab === 'report' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">arrow_back</span>
                </button>
                <span className="tt">My Reports</span>
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
                <h1>Technical Report</h1>
                <p>{effectiveProject?.title || 'SIWES Technical Report'}</p>
              </div>

              {/* Sub-tabs: Editor | Preview | Export */}
              <div className="seg" role="tablist" aria-label="Report views" style={{ marginBottom: '14px' }}>
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'editor'}
                  onClick={() => setReportTab('editor')}
                >
                  Document Editor
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'preview'}
                  onClick={() => setReportTab('preview')}
                >
                  Page Preview
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={reportTab === 'export'}
                  onClick={() => setReportTab('export')}
                >
                  Export & Download
                </button>
              </div>

              {/* 1. DOCUMENT EDITOR */}
              {reportTab === 'editor' && (
                <div>
                  {!hasReport && (
                    <div className="card empty" style={{ marginBottom: '16px' }}>
                      <div className="ico">
                        <span className="ms" aria-hidden="true">auto_awesome</span>
                      </div>
                      <h2>Report Not Generated Yet</h2>
                      <p>Generate your 12–15 page report from your verified logbook records.</p>
                      <button
                        className="btn"
                        type="button"
                        disabled={isGeneratingReport}
                        onClick={handleGenerateReport}
                      >
                        {isGeneratingReport ? 'Generating...' : 'Generate Report'}
                      </button>
                    </div>
                  )}

                  {/* Chapter Selector */}
                  <div className="card" style={{ padding: '8px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                      {CHAPTER_NAMES.map((chap, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`btn s ${currentChapterIdx === idx ? '' : 'o'}`}
                          style={{
                            whiteSpace: 'nowrap',
                            padding: '6px 14px',
                            fontSize: '12px',
                            minHeight: '36px',
                          }}
                          onClick={() => setCurrentChapterIdx(idx)}
                        >
                          {chap.split(':')[0]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Editor Container */}
                  <div
                    className="card"
                    style={{
                      padding: 'clamp(14px, 4vw, 24px)',
                      background: 'var(--card)',
                      fontFamily: "'Times New Roman', Times, serif",
                      fontSize: '15px',
                      lineHeight: '1.6',
                      minHeight: '380px',
                    }}
                  >
                    <div className="row sb" style={{ marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0, fontFamily: 'inherit' }}>
                        {CHAPTER_NAMES[currentChapterIdx]}
                      </h3>
                      <span className="mut" style={{ fontSize: '12px', fontFamily: "'Manrope', sans-serif" }}>
                        Times New Roman 12pt • 1.5 line spacing
                      </span>
                    </div>

                    <div
                      contentEditable
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: getSectionContent(currentChapterIdx) }}
                      style={{ outline: 'none', minHeight: '260px' }}
                    />
                  </div>
                </div>
              )}

              {/* 2. PAGE PREVIEW */}
              {reportTab === 'preview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="card" style={{ padding: 'clamp(16px, 5vw, 28px)', background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                      <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--mut)' }}>
                        {effectiveProject?.university_name || 'Lagos State University of Science and Technology'}
                      </p>
                      <h2 style={{ fontSize: '20px', fontFamily: "'Fraunces', Georgia, serif", margin: '14px 0 8px' }}>
                        {effectiveProject?.title || 'SIWES TECHNICAL REPORT'}
                      </h2>
                      <p style={{ fontSize: '13px', color: 'var(--mut)' }}>
                        Submitted by: <strong>{studentName}</strong> ({effectiveProject?.matric_number || 'Matric Pending'})
                      </p>
                    </div>

                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '20px', fontSize: '14px', lineHeight: '1.6' }}>
                      <p style={{ fontStyle: 'italic', color: 'var(--mut)' }}>
                        Approved LASUSTECH institutional template applied. Technical activities derived solely from your verified logbook records.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. EXPORT & DOWNLOAD */}
              {reportTab === 'export' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="card">
                    <span className="chip">Editable Document</span>
                    <h3 style={{ fontSize: '18px', margin: '8px 0 4px' }}>Word Document (.docx)</h3>
                    <p className="mut" style={{ fontSize: '13.5px', marginBottom: '14px' }}>
                      Editable in Microsoft Word, Google Docs. A4, 1.5-inch left margin for binding.
                    </p>
                    <button
                      className="btn w"
                      type="button"
                      disabled={!hasReport}
                      onClick={handleDownloadWord}
                    >
                      <span className="ms">download</span>
                      Download (.docx)
                    </button>
                  </div>

                  <div className="card">
                    <span className="chip" style={{ background: '#e0f2fe', color: '#0369a1' }}>Submission Ready</span>
                    <h3 style={{ fontSize: '18px', margin: '8px 0 4px' }}>Print-Ready PDF (.pdf)</h3>
                    <p className="mut" style={{ fontSize: '13.5px', marginBottom: '14px' }}>
                      Fixed academic pagination: Roman preliminary numerals (i-iv) and Arabic main numbering (1-15).
                    </p>
                    <button
                      className="btn w"
                      type="button"
                      disabled={!hasReport}
                      onClick={handleDownloadPdf}
                    >
                      <span className="ms">download</span>
                      Download (.pdf)
                    </button>
                  </div>

                  <div className="card">
                    <span className="chip" style={{ background: '#fef3c7', color: '#b45309' }}>Direct Print</span>
                    <h3 style={{ fontSize: '18px', margin: '8px 0 4px' }}>Browser Print</h3>
                    <p className="mut" style={{ fontSize: '13.5px', marginBottom: '14px' }}>
                      Print or save directly using clean print stylesheet.
                    </p>
                    <button
                      className="btn w o"
                      type="button"
                      disabled={!hasReport}
                      onClick={handleDirectPrint}
                    >
                      <span className="ms">print</span>
                      Print Report
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================= TAB: SETTINGS ======================= */}
          {currentTab === 'settings' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">arrow_back</span>
                </button>
                <span className="tt">Settings</span>
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
                <h1>Settings</h1>
                <p>Student Profile & Application Preferences</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Student Profile Card */}
                <div className="card">
                  <div className="row sb" style={{ marginBottom: '10px' }}>
                    <div>
                      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 2px' }}>{studentName}</h2>
                      <p className="mut" style={{ fontSize: '13px' }}>
                        {effectiveUser?.email || 'Student Account'}
                      </p>
                    </div>
                    <span className="ms" style={{ color: 'var(--g)', fontSize: '32px' }}>account_circle</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', margin: '14px 0', fontSize: '12.5px' }}>
                    <div style={{ padding: '8px 10px', background: 'var(--paper)', borderRadius: '10px' }}>
                      <span className="mut" style={{ display: 'block', fontSize: '10.5px', textTransform: 'uppercase', fontWeight: 700 }}>Matric Number</span>
                      <strong>{effectiveProject?.matric_number || 'Pending'}</strong>
                    </div>
                    <div style={{ padding: '8px 10px', background: 'var(--paper)', borderRadius: '10px' }}>
                      <span className="mut" style={{ display: 'block', fontSize: '10.5px', textTransform: 'uppercase', fontWeight: 700 }}>Department</span>
                      <strong>{effectiveProject?.department || 'Pending'}</strong>
                    </div>
                    <div style={{ padding: '8px 10px', background: 'var(--paper)', borderRadius: '10px', gridColumn: '1 / -1' }}>
                      <span className="mut" style={{ display: 'block', fontSize: '10.5px', textTransform: 'uppercase', fontWeight: 700 }}>Institution</span>
                      <strong>{effectiveProject?.university_name || 'Lagos State University of Science and Technology (LASUSTECH)'}</strong>
                    </div>
                  </div>

                  <button
                    className="btn w o s"
                    type="button"
                    onClick={() => navigateTab('new')}
                  >
                    Edit Student & Placement Details
                  </button>
                </div>

                {/* Switch Active Project if multiple exist */}
                {projects.length > 1 && (
                  <div className="card">
                    <div className="row sb" style={{ marginBottom: '8px' }}>
                      <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Active SIWES Project</h2>
                      <span className="ms mut" style={{ fontSize: '20px' }}>folder</span>
                    </div>
                    <select
                      value={activeProject?.id || ''}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        fetchActiveProject(id);
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: '12px',
                        border: '1px solid var(--line)',
                        background: 'var(--paper)',
                        fontSize: '13px',
                      }}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.organization_name || 'SIWES'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* PWA Mobile App Card */}
                {canInstallPWA && (
                  <div className="card">
                    <div className="row sb" style={{ marginBottom: '6px' }}>
                      <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Mobile App Installation</h2>
                      <span className="ms" style={{ color: 'var(--g)' }}>smartphone</span>
                    </div>
                    <p className="mut" style={{ fontSize: '12.5px', marginBottom: '12px' }}>
                      Install Log2Def on your phone for rapid camera access and offline logbook capture.
                    </p>
                    <button
                      className="btn w s"
                      type="button"
                      onClick={handleInstallApp}
                    >
                      {deviceOS === 'ios' ? 'How to Add to Home Screen' : 'Install Mobile App'}
                    </button>
                  </div>
                )}

                {/* Sign Out Button */}
                <button
                  className="btn w o"
                  type="button"
                  style={{ color: 'var(--red)', borderColor: 'rgba(180, 35, 24, 0.3)' }}
                  onClick={logout}
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* ======================= TAB: NEW / EDIT DETAILS (STEP 1) ======================= */}
          {currentTab === 'new' && (
            <div className="view">
              <header className="top">
                <button
                  className="ib"
                  type="button"
                  aria-label="Back to home"
                  onClick={() => navigateTab('home', 'bw')}
                >
                  <span className="ms" aria-hidden="true">arrow_back</span>
                </button>
                <span className="tt">Placement Details</span>
                <span className="sp"></span>
              </header>

              <div className="lg">
                <h1>Step 1: Enter Your Details</h1>
                <p>Provide your basic student and SIWES placement information once.</p>
              </div>

              <form onSubmit={handleSaveDetails} className="card" style={{ padding: '20px' }}>
                <h2 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '14px', color: 'var(--gd)' }}>
                  A. Student & Institution
                </h2>

                <div className="f">
                  <label htmlFor="fn">Full Name <em>*</em></label>
                  <input
                    id="fn"
                    type="text"
                    required
                    value={detailsData.full_name}
                    onChange={(e) => setDetailsData({ ...detailsData, full_name: e.target.value })}
                    placeholder="e.g., Babatunde Oluwaseun Emmanuel"
                  />
                  {detailsErrors.full_name && <p className="err">{detailsErrors.full_name}</p>}
                </div>

                <div className="f">
                  <label htmlFor="mn">Matriculation Number <em>*</em></label>
                  <input
                    id="mn"
                    type="text"
                    required
                    value={detailsData.matric_number}
                    onChange={(e) => setDetailsData({ ...detailsData, matric_number: e.target.value })}
                    placeholder="e.g., STE/2021/0458"
                  />
                  {detailsErrors.matric_number && <p className="err">{detailsErrors.matric_number}</p>}
                </div>

                <div className="f">
                  <label htmlFor="dept">Department <em>*</em></label>
                  <input
                    id="dept"
                    type="text"
                    required
                    value={detailsData.department}
                    onChange={(e) => setDetailsData({ ...detailsData, department: e.target.value })}
                    placeholder="e.g., Computer Engineering"
                  />
                  {detailsErrors.department && <p className="err">{detailsErrors.department}</p>}
                </div>

                <div className="f">
                  <label htmlFor="fac">Faculty / School</label>
                  <input
                    id="fac"
                    type="text"
                    value={detailsData.faculty_school}
                    onChange={(e) => setDetailsData({ ...detailsData, faculty_school: e.target.value })}
                    placeholder="College of Applied Sciences and Technology"
                  />
                </div>

                <div className="f">
                  <label htmlFor="uni">Higher Institution</label>
                  <input
                    id="uni"
                    type="text"
                    value={detailsData.university_name}
                    onChange={(e) => setDetailsData({ ...detailsData, university_name: e.target.value })}
                    placeholder="Lagos State University of Science and Technology (LASUSTECH)"
                  />
                </div>

                <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '24px 0 14px', color: 'var(--gd)' }}>
                  B. SIWES Placement Company
                </h2>

                <div className="f">
                  <label htmlFor="on">Company / Organisation Name <em>*</em></label>
                  <input
                    id="on"
                    type="text"
                    required
                    value={detailsData.organization_name}
                    onChange={(e) => setDetailsData({ ...detailsData, organization_name: e.target.value })}
                    placeholder="e.g., Mi Labs Engineering Ltd, Lagos"
                  />
                  {detailsErrors.organization_name && <p className="err">{detailsErrors.organization_name}</p>}
                </div>

                <div className="f">
                  <label htmlFor="oa">Company Physical Address <em>*</em></label>
                  <input
                    id="oa"
                    type="text"
                    required
                    value={detailsData.organization_address}
                    onChange={(e) => setDetailsData({ ...detailsData, organization_address: e.target.value })}
                    placeholder="e.g., Plot 12, Commercial Avenue, Ikeja, Lagos State"
                  />
                  {detailsErrors.organization_address && <p className="err">{detailsErrors.organization_address}</p>}
                </div>

                <div className="f">
                  <label htmlFor="pd">Unit / Department at Company (Optional)</label>
                  <input
                    id="pd"
                    type="text"
                    value={detailsData.placement_department}
                    onChange={(e) => setDetailsData({ ...detailsData, placement_department: e.target.value })}
                    placeholder="e.g., Network & Systems Maintenance Unit"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="f">
                    <label htmlFor="sd">Start Date <em>*</em></label>
                    <input
                      id="sd"
                      type="date"
                      required
                      value={detailsData.training_start_date}
                      onChange={(e) => setDetailsData({ ...detailsData, training_start_date: e.target.value })}
                    />
                    {detailsErrors.training_start_date && <p className="err">{detailsErrors.training_start_date}</p>}
                  </div>

                  <div className="f">
                    <label htmlFor="ed">End Date <em>*</em></label>
                    <input
                      id="ed"
                      type="date"
                      required
                      value={detailsData.training_end_date}
                      onChange={(e) => setDetailsData({ ...detailsData, training_end_date: e.target.value })}
                    />
                    {detailsErrors.training_end_date && <p className="err">{detailsErrors.training_end_date}</p>}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSavingDetails}
                  className="btn w"
                  style={{ marginTop: '14px' }}
                >
                  {isSavingDetails ? 'Saving Details...' : 'Save & Continue to Logbook Upload'}
                  <span className="ms">arrow_forward</span>
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Floating Bottom Tab Bar — 4 tabs, sleek glass */}
        <nav className="tb" id="tb" aria-label="Main">
          <span
            className="tb-glide"
            aria-hidden="true"
            style={{
              '--i': ['home', 'logbook', 'report', 'settings'].indexOf(
                ['home', 'logbook', 'report', 'settings'].includes(currentTab) ? currentTab : 'home'
              ),
            } as React.CSSProperties}
          />
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'home' ? 'page' : undefined}
            onClick={() => navigateTab('home')}
          >
            <span className="ms" aria-hidden="true">home</span>
            <span className="tab-label">Home</span>
          </button>
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'logbook' ? 'page' : undefined}
            onClick={() => navigateTab('logbook')}
          >
            <span className="ms" aria-hidden="true">menu_book</span>
            <span className="tab-label">My Logbooks</span>
          </button>
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'report' ? 'page' : undefined}
            onClick={() => navigateTab('report')}
          >
            <span className="ms" aria-hidden="true">description</span>
            <span className="tab-label">My Reports</span>
          </button>
          <button
            className="tab-btn"
            type="button"
            aria-current={currentTab === 'settings' ? 'page' : undefined}
            onClick={() => navigateTab('settings')}
          >
            <span className="ms" aria-hidden="true">settings</span>
            <span className="tab-label">Settings</span>
          </button>
        </nav>

        {/* ======================= AFFIRMATION MODAL SCREEN ======================= */}
        {affirmationScreen?.visible && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
            style={{
              backgroundColor: 'rgba(20, 32, 27, 0.7)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="affirmation-card w-full max-w-md shadow-2xl"
              style={{ background: 'var(--card)', border: '1px solid rgba(6, 107, 77, 0.3)', margin: 0 }}
            >
              <div className="affirmation-header">
                <div className="affirmation-icon">
                  <span className="ms" style={{ fontSize: '24px' }}>check</span>
                </div>
                <div>
                  <h3 className="affirmation-title">{affirmationScreen.title}</h3>
                  <span className="chip" style={{ fontSize: '11px', padding: '2px 8px' }}>
                    Step {affirmationScreen.step} Complete
                  </span>
                </div>
              </div>

              <p className="affirmation-desc">{affirmationScreen.description}</p>

              {affirmationScreen.stats && (
                <div className="affirmation-stats">
                  {affirmationScreen.stats.map((s, idx) => (
                    <div key={idx} className="affirmation-stat-chip">
                      <span>{s.label}</span>
                      <strong>{s.value}</strong>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="btn w"
                onClick={affirmationScreen.onPrimaryAction}
              >
                {affirmationScreen.primaryActionLabel}
                <span className="ms">arrow_forward</span>
              </button>
            </div>
          </div>
        )}

        {/* ======================= BOTTOM SHEET: PROFILE / ACCOUNT ======================= */}
        {activeSheet && (
          <div className="layer on" id="layer">
            <div className="bd" onClick={() => setActiveSheet(null)}></div>
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Dialog"
              tabIndex={-1}
            >
              <div className="hd"></div>

              {activeSheet === 'me' && (
                <>
                  <h2>{studentName}</h2>
                  <p className="mut" style={{ margin: '-8px 0 18px' }}>
                    {effectiveUser?.email || 'Logged in student'}
                  </p>

                  <div className="card" style={{ padding: '12px 14px', marginBottom: '14px', background: 'var(--paper)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                      <div className="row sb">
                        <span className="mut">Matric Number:</span>
                        <strong>{effectiveProject?.matric_number || 'Pending'}</strong>
                      </div>
                      <div className="row sb">
                        <span className="mut">Department:</span>
                        <strong>{effectiveProject?.department || 'Pending'}</strong>
                      </div>
                      <div className="row sb">
                        <span className="mut">Company:</span>
                        <strong>{effectiveProject?.organization_name || 'Not set'}</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    className="btn o w"
                    type="button"
                    style={{ marginBottom: '10px' }}
                    onClick={() => {
                      setActiveSheet(null);
                      navigateTab('new');
                    }}
                  >
                    Edit Student & Placement Details
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

              {activeSheet === 'pwaGuide' && (
                <div style={{ padding: '10px 0' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px' }}>
                    Install Log2Def on {deviceOS === 'ios' ? 'iPhone / iPad' : 'your device'}
                  </h3>
                  <p className="mut" style={{ fontSize: '13px', marginBottom: '16px' }}>
                    {deviceOS === 'ios'
                      ? 'In Safari, tap the Share button (square with arrow pointing up) and select "Add to Home Screen".'
                      : 'Tap Install to save Log2Def as a standalone application on your home screen.'}
                  </p>
                  <button
                    className="btn w"
                    type="button"
                    onClick={() => setActiveSheet(null)}
                  >
                    Got it
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Camera Capture Modal */}
        {isCameraOpen && (
          <CameraCapture
            onCaptureComplete={handleCameraCaptureComplete}
            onCancel={() => setIsCameraOpen(false)}
            existingPageCount={sortedDocuments.length}
          />
        )}

        {/* Page Review & OCR Inspection Modal */}
        {isReviewModalOpen && reviewingDoc && (
          <PageReviewModal
            isOpen={isReviewModalOpen}
            onClose={() => {
              setIsReviewModalOpen(false);
              setReviewingDoc(null);
            }}
            document={reviewingDoc}
            onSave={async (pageId, updatedText, meta) => {
              if (activeProject?.id) {
                await storeUpdatePage(activeProject.id, pageId, {
                  extracted_text: updatedText,
                  ...meta,
                });
                triggerToast('Corrections saved');
              }
            }}
            onReprocess={async (docId) => {
              if (activeProject?.id) {
                await storeReprocessDocument(activeProject.id, docId);
                triggerToast('Document reprocessed');
              }
            }}
          />
        )}

        {/* Missing Info Completeness Modal */}
        {isMissingInfoOpen && (
          <MissingInfoModal
            isOpen={isMissingInfoOpen}
            onClose={() => setIsMissingInfoOpen(false)}
            completeness={completeness}
            project={effectiveProject}
            onSubmit={async (data) => {
              if (activeProject?.id) {
                await storeUpdateMissingInfo(activeProject.id, data);
                await fetchActiveProject(activeProject.id);
                await fetchCompleteness(activeProject.id);
                triggerToast('Information confirmed and saved');
              }
            }}
          />
        )}

        {/* Toast Notification */}
        {localToast.visible && (
          <div id="toast" role="status" className="on">
            <span className="ms">check_circle</span>
            <span id="toast-text">{localToast.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
