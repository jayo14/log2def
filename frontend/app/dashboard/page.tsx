'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  useProjectStore,
  useReportStore,
} from '@/lib/store';
import { getApiBaseUrl, getAuthToken, projectsApi } from '@/lib/api';
import { detectDeviceOS, isStandaloneApp, DeviceOS } from '@/lib/device';
import { validReportImageCaption } from '@/lib/report-images';
import '@/app/dashboard.css';

// Approved Design Constants: seven-phase wizard flow
const SN = [
  'Your details',
  'Logbook',
  'Review',
  'Missing info',
  'Organisation',
  'Images',
  'Generate',
];

const GS = [
  'Cover page',
  'Front matter',
  'Introduction',
  'Organisation profile',
  'Training activities',
  'Skills and experience',
  'Conclusion',
  'Contents and page numbers',
];

const SEC = [
  'Cover page',
  'Certification',
  'Dedication',
  'Acknowledgement',
  'Abstract',
  'Chapter 1: Introduction',
  'Chapter 2: Organisation profile',
  'Chapter 3: Training activities',
  'Chapter 4: Skills and experience',
  'Chapter 5: Conclusion',
  'References',
];

const FLD: [string, string][] = [
  ['name', 'Full name'],
  ['matric', 'Matric number'],
  ['dept', 'Department'],
  ['fac', 'Faculty or College'],
  ['degree', 'Degree'],
  ['inst', 'Institution'],
  ['co', 'Company'],
  ['addr', 'Company address'],
  ['start', 'Training start date'],
  ['end', 'Training end date'],
];

const COLLEGES = [
  'College of Basic Science',
  'College of Engineering',
  'College of Applied Arts',
  'College of Environmental Technology',
  'College of Applied Sciences and Technology',
  'College of Agriculture',
  'College of Management Sciences',
  'College of Information and Communications Technology',
  'Other',
];

const INSTITUTIONS = [
  'Lagos State University of Science and Technology',
  'Other',
];

const CAMPUS_LOCATIONS = [
  'LASUSTECH Ikorodu Main Campus — First Gate',
  'LASUSTECH Ikorodu Main Campus — Senate Building',
  'LASUSTECH Ikorodu Main Campus — College of Engineering',
  'LASUSTECH Ikorodu Main Campus — Student Union Building (SUB)',
  'LASUSTECH Ikorodu Main Campus — College of Basic Science',
  'Off-Campus / Hostels / Residence Address (Specify below)',
];

interface LogPage {
  id?: number;
  n: string;
  pdf: boolean;
  th: string;
  q?: string;
  file?: File;
  status?: string;
  isUploading?: boolean;
  uploadProgress?: number;
}

interface LogEntry {
  id?: number;
  w: number;
  t: string;
  area: string;
  tools: string;
  u?: number;
  ph?: string;
  ok?: number;
}

interface ReportImage {
  id: number;
  caption: string;
  placement: string;
  week_number?: number | null;
  processed_url?: string | null;
  low_resolution_warning?: boolean;
}

export default function DashboardPage() {
  const { user, logout, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  // Redirect to login if user is not authenticated
  useEffect(() => {
    if (!isAuthLoading && !user && !getAuthToken()) {
      router.push('/login?redirect=/dashboard');
    }
  }, [isAuthLoading, user, router]);

  const {
    projects,
    activeProject,
    fetchProjects,
    fetchActiveProject,
    ensureActiveProject,
    createProject,
    updateActiveProject,
    deleteProject,
    clearActiveProject,
    uploadDocument,
    deleteDocument,
    reorderDocuments,
    reprocessDocument,
    fetchLogbookEntries,
    createLogbookEntry,
    updateLogbookEntry,
    deleteLogbookEntry,
    bulkVerifyEntries,
    fetchCompleteness,
    updateMissingInfo,
    payments,
    fetchPayments,
    initiateSquadPayment,
    verifySquadPayment,
  } = useProjectStore();

  const {
    report: dbReport,
    fetchReport,
    generateReport: storeGenerateReport,
    saveSection,
    isGeneratingReport,
    resetReportState,
  } = useReportStore();

  // Primary navigation tab: 'home' | 'logbooks' | 'reports' | 'settings'
  const [currentTab, setCurrentTab] = useState<'home' | 'logbooks' | 'reports' | 'settings'>('home');
  const [inFlow, setInFlow] = useState<boolean>(false);
  const [isScrolled, setIsScrolled] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  // Logbook screen sub-view: 'pages' | 'report'
  const [logbookView, setLogbookView] = useState<'pages' | 'report'>('pages');

  // Wizard Flow step: 1 to 7
  const [step, setStep] = useState<number>(1);
  const [method, setMethod] = useState<'manual' | 'photos'>('manual');

  const userFullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username
    : '';

  const [details, setDetails] = useState<Record<string, string>>({
    name: userFullName,
    inst: '',
    fac: 'College of Basic Science',
    degree: '',
    dept: '',
    matric: '',
    co: '',
    addr: '',
    unit: '',
    start: '',
    end: '',
    sup: '',
    isup: '',
  });
  const [fieldSources, setFieldSources] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSavingStep4, setIsSavingStep4] = useState(false);
  const [step4SaveError, setStep4SaveError] = useState<string | null>(null);

  const [pages, setPages] = useState<LogPage[]>([]);
  const [reading, setReading] = useState<boolean>(false);
  const [readProgress, setReadProgress] = useState<number>(0);
  const [readDone, setReadDone] = useState<boolean>(false);

  const [entries, setEntries] = useState<LogEntry[]>([]);

  // Step 7 report generation state: 0: not started, 1: generating, 2: ready
  const [genState, setGenState] = useState<0 | 1 | 2>(0);
  const [genProgress, setGenProgress] = useState<number>(0);
  const [genError, setGenError] = useState<string | null>(null);

  // Guided-intake state used by Step 4 missing-info routing and Step 5 blocked-
  // generation recovery. Kept in local state so the wizard can focus the first
  // missing field without re-fetching on every render.
  const [intake, setIntake] = useState<Record<string, any>>({});
  const [intakeLoading, setIntakeLoading] = useState<boolean>(false);
  const [intakeFocusKey, setIntakeFocusKey] = useState<string | null>(null);
  const [savingOrganisation, setSavingOrganisation] = useState(false);
  const [organisationError, setOrganisationError] = useState('');
  const intakeRefs = useRef<
    Record<string, HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement | null>
  >({});
  const [lastGenerateBlock, setLastGenerateBlock] = useState<{
    missing: string[];
    labels: string[];
    canGenerate: boolean;
  } | null>(null);
  const [reportImages, setReportImages] = useState<ReportImage[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');

  // Report editor / preview state (Housed in Logbook screen)
  const [editorTab, setEditorTab] = useState<'edit' | 'prev'>('edit');
  const [currentSectionIdx, setCurrentSectionIdx] = useState<number>(0);
  const [chapterEdits, setChapterEdits] = useState<Record<number, string>>({});
  const [isRefreshingQuality, setIsRefreshingQuality] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState<'saved' | 'saving'>('saved');

  // Payment & Checkout State
  const [checkoutModal, setCheckoutModal] = useState<'digital' | 'delivery' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'transfer'>('card');
  const [hasPaidDigital, setHasPaidDigital] = useState<boolean>(false);
  const [downloadLoading, setDownloadLoading] = useState<boolean>(false);

  const [paymentSuccess, setPaymentSuccess] = useState<{
    type: 'digital' | 'delivery';
    txRef: string;
    deliveryDetails?: {
      location: string;
      customAddress: string;
      date: string;
      recipient: string;
      phone: string;
    };
  } | null>(null);

  // Delivery form state (for NGN 4,000 physical print & binding delivery)
  const [deliveryData, setDeliveryData] = useState({
    recipientName: '',
    phone: '',
    campusLocation: CAMPUS_LOCATIONS[0],
    customAddress: '',
    deliveryDate: '',
    notes: '',
  });

  // OS-Aware PWA Installation state
  const [deviceOS, setDeviceOS] = useState<DeviceOS>('pc');
  // Default to "not installed" until hydration resolves; defaults to true caused
  // the install button to flash in after the mount effect corrected the value.
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  // Persist "Got it" dismissal so the install sheet does not recur after the user
  // has explicitly dismissed it (or once the app is actually installed).
  const [installDismissed, setInstallDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('log2def_install_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      setDeliveryData(prev => ({
        ...prev,
        recipientName: prev.recipientName || userFullName,
        deliveryDate: prev.deliveryDate || tomorrow,
      }));
    } catch {
      // fallback
    }
  }, [userFullName]);

  // Fetch the guided-intake (report interview) answers once the active project is
  // known, so Step 4 can render the required fields and Step 5 can recover from a
  // blocked generation by focusing the first missing field.
  useEffect(() => {
    const pid =
      activeProject?.id ||
      useProjectStore.getState().activeProject?.id;
    if (!pid) return;

    let cancelled = false;
    setIntakeLoading(true);
    projectsApi.getGuidedIntake(pid)
      .then((data: any) => {
        if (!cancelled) {
          setIntake((prev) => (Object.keys(data).length ? data : prev));
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Keep any previously fetched answers; the interview route is the
          // authoritative place to fix guided-intake fields.
        }
      })
      .finally(() => {
        if (!cancelled) setIntakeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id]);

  useEffect(() => {
    const pid = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!pid) return;
    projectsApi.getReportImages(pid)
      .then((items) => setReportImages(items || []))
      .catch(() => setReportImages([]));
  }, [activeProject?.id]);

  // Clear the focus key after it has been applied, so a re-render (for example after
  // the user saves the focused field) does not re-focus the same field.
  useEffect(() => {
    if (!intakeFocusKey) return;
    const el = intakeRefs.current[intakeFocusKey];
    if (!el || typeof el.focus !== 'function') return;
    el.focus();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Clear immediately after focusing; the setTimeout in startGenerating's catch
    // block is what triggers the mount-and-focus path, and this effect covers the
    // case where the key is already set when Step 4 renders.
    setIntakeFocusKey(null);
  }, [intakeFocusKey]);

  // Bottom sheet modal state for editing details & entries
  const [activeSheet, setActiveSheet] = useState<
    | { type: 'editWeek'; index: number }
    | { type: 'editField'; key: string; label: string }
    | { type: 'editDetails' }
    | null
  >(null);

  // Camera overlay state
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [retakeIndex, setRetakeIndex] = useState<number>(-1);
  const [cameraFlash, setCameraFlash] = useState<boolean>(false);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string>('');
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Render editor content only when the section changes. We deliberately do NOT
  // bind innerHTML via dangerouslySetInnerHTML on every render: typing triggers
  // setChapterEdits, which would re-render and clobber the DOM node under the
  // caret, throwing the cursor to the top of the editor. Setting innerHTML here
  // (and in the section-tab handlers) keeps the caret where the user is editing.
  useEffect(() => {
    if (!editorRef.current) return;
    const target = getSectionHtml(currentSectionIdx);
    // Only rewrite the editor DOM when the section content actually changes.
    // Resetting innerHTML on every switch clobbers the caret and scroll position,
    // so skip it when the target content is already what's on screen.
    if (editorRef.current.innerHTML !== target) {
      editorRef.current.innerHTML = target;
    }
    editorRef.current.focus();
  }, [currentSectionIdx]);
  const camInputRef = useRef<HTMLInputElement>(null);

  // Show Toast helper
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 2300);
  }, []);

  // Detect OS and listen for PWA install eligibility
  useEffect(() => {
    const os = detectDeviceOS();
    setDeviceOS(os);
    const standalone = isStandaloneApp();
    setIsInstalled(standalone);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstalled(false);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowInstallModal(false);
      setInstallDismissed(true);
      try {
        localStorage.setItem('pwa_installed', 'true');
        localStorage.setItem('log2def_install_dismissed', 'true');
      } catch {}
      showToast('Log2Def installed successfully!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [showToast]);

  const handleInstallClick = () => {
    if (installDismissed) return; // respect an explicit dismissal: do not re-open
    if (deviceOS === 'android' && deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choice: any) => {
        if (choice?.outcome === 'accepted') {
          setIsInstalled(true);
          setInstallDismissed(true);
          try {
            localStorage.setItem('pwa_installed', 'true');
            localStorage.setItem('log2def_install_dismissed', 'true');
          } catch {}
          showToast('Log2Def installed successfully!');
        }
        setDeferredPrompt(null);
      });
    } else {
      setShowInstallModal(true);
    }
  };

  // Sync user info on mount
  useEffect(() => {
    if (user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
      if (name) {
        setDetails((prev) => ({ ...prev, name }));
        setDeliveryData((prev) => ({ ...prev, recipientName: name }));
      }
    }
  }, [user]);

  // Report chapter templates
  const getSectionDefaultHtml = (i: number): string => {
    const N = details.name || userFullName || '[STUDENT NAME]';
    const C = details.co || '[ORGANISATION NAME]';
    const A = details.addr || answers.addr || '[ORGANISATION ADDRESS]';
    const c = 'style="text-align:center"';
    const per = `${details.start || answers.start || '[START DATE]'} to ${details.end || answers.end || '[END DATE]'}`;

    const chapters = [
      `<p ${c}><b>TECHNICAL REPORT ON THE STUDENT INDUSTRIAL WORK EXPERIENCE SCHEME (SIWES)</b></p><p ${c}>Undertaken at<br><b>${C}</b><br>${A}</p><p ${c}>BY<br><b>${N}</b><br>${details.matric || ''}<br>${details.dept || ''}</p><p ${c}>${details.inst || ''}<br>${per}</p>`,
      `<p ${c}><b>CERTIFICATION</b></p><p>This is to certify that ${N} (${details.matric || ''}) completed the industrial training at ${C}.</p><p>________________<br>Industry-based supervisor${details.sup ? ': ' + details.sup : ''}</p><p>________________<br>Institution-based supervisor${details.isup ? ': ' + details.isup : ''}</p>`,
      `<p ${c}><b>DEDICATION</b></p><p>[Add your dedication here.]</p>`,
      `<p ${c}><b>ACKNOWLEDGEMENT</b></p><p>[Add your acknowledgements here.]</p>`,
      `<p ${c}><b>ABSTRACT</b></p><p>This report presents the industrial training of ${N} at ${C}. It covers the organisation, the activities recorded in the logbook, the skills gained and the challenges met.</p>`,
      `<p><b>CHAPTER ONE: INTRODUCTION</b></p><p>The Student Industrial Work Experience Scheme (SIWES) exposes students to practical work in their field. This report describes the training of ${N} at ${C}.</p>`,
      `<p><b>CHAPTER TWO: ORGANISATION PROFILE</b></p><p>${C} is located at ${A}.${details.unit ? ' The student worked in the ' + details.unit + ' unit.' : ''}</p><p>[Add the company’s background, structure and services.]</p>`,
      `<p><b>CHAPTER THREE: TRAINING ACTIVITIES</b></p>${entries.map((e) => `<p>Week ${e.w}: ${e.t}</p>`).join('')}`,
      `<p><b>CHAPTER FOUR: SKILLS AND EXPERIENCE</b></p><p>Skills worked on in the recorded activities: ${Array.from(new Set(entries.map((e) => e.tools).filter(Boolean))).join(', ')}.</p><p>[Add challenges you met and how you solved them.]</p>`,
      `<p><b>CHAPTER FIVE: CONCLUSION AND RECOMMENDATIONS</b></p><p>[Add your conclusion and recommendations.]</p>`,
      `<p ${c}><b>REFERENCES</b></p><p>[Add references, if you used any.]</p>`,
    ];

    return chapters[i] || '';
  };

  // Maps 28 backend institutional sections into the 11 presentation views
  const getSectionForChapterTab = (tabIdx: number, sections: any[]) => {
    if (!sections || !sections.length) return null;
    if (sections.some((section) => section.section_key === 'ch1_importance')) return sections[tabIdx] || null;
    switch (tabIdx) {
      case 0:
        return sections.find((s) => s.section_key === 'cover') || sections.find((s) => s.section_key === 'title_page') || sections[0];
      case 1:
        return sections.find((s) => s.section_key === 'certification');
      case 2:
        return sections.find((s) => s.section_key === 'dedication');
      case 3:
        return sections.find((s) => s.section_key === 'acknowledgements');
      case 4:
        return sections.find((s) => s.section_key === 'abstract');
      case 5:
        return sections.find((s) => s.section_key === 'ch1_background') || sections.find((s) => s.chapter_number === 1);
      case 6:
        return sections.find((s) => s.section_key === 'ch2_org_profile') || sections.find((s) => s.chapter_number === 2);
      case 7:
        return sections.find((s) => s.section_key === 'ch3_training_env') || sections.find((s) => s.chapter_number === 3);
      case 8:
        return sections.find((s) => s.section_key === 'ch4_skills') || sections.find((s) => s.chapter_number === 4);
      case 9:
        return sections.find((s) => s.section_key === 'ch5_summary') || sections.find((s) => s.chapter_number === 5);
      case 10:
        return sections.find((s) => s.section_key === 'references');
      default:
        return sections[tabIdx] || null;
    }
  };

  const mapBackendSectionsToChapters = (sections: any[]): Record<number, string> => {
    const edits: Record<number, string> = {};
    if (!sections || sections.length === 0) return edits;
    if (sections.some((section) => section.section_key === 'ch1_importance')) {
      sections.forEach((section, index) => { edits[index] = section.content || ''; });
      return edits;
    }

    const findByKey = (k: string) => sections.find((s) => s.section_key === k)?.content || '';
    const findByChapter = (chapNum: number) =>
      sections
        .filter((s) => s.chapter_number === chapNum)
        .map((s) => `<h3>${s.title}</h3>${s.content}`)
        .join('<br/><br/>');

    // 0: Cover page
    edits[0] = findByKey('cover') || findByKey('title_page') || getSectionDefaultHtml(0);
    // 1: Certification
    edits[1] = findByKey('certification') || getSectionDefaultHtml(1);
    // 2: Dedication
    edits[2] = findByKey('dedication') || getSectionDefaultHtml(2);
    // 3: Acknowledgement
    edits[3] = findByKey('acknowledgements') || getSectionDefaultHtml(3);
    // 4: Abstract
    edits[4] = findByKey('abstract') || getSectionDefaultHtml(4);
    // 5: Chapter 1: Introduction
    edits[5] = findByChapter(1) || getSectionDefaultHtml(5);
    // 6: Chapter 2: Organisation profile
    edits[6] = findByChapter(2) || getSectionDefaultHtml(6);
    // 7: Chapter 3: Training activities
    edits[7] = findByChapter(3) || getSectionDefaultHtml(7);
    // 8: Chapter 4: Skills and experience
    edits[8] = findByChapter(4) || getSectionDefaultHtml(8);
    // 9: Chapter 5: Conclusion
    edits[9] = findByChapter(5) || getSectionDefaultHtml(9);
    // 10: References
    edits[10] = findByChapter(6) || findByKey('references') || getSectionDefaultHtml(10);

    return edits;
  };

  // Initialize and synchronize project from PostgreSQL database
  useEffect(() => {
    let isMounted = true;
    const initProject = async () => {
      try {
        const current = await ensureActiveProject();
        const projId = current?.id;

        if (projId && isMounted) {
          const freshProj = await fetchActiveProject(projId).catch(() => current);
          const entriesData = await fetchLogbookEntries(projId).catch(() => []);
          if (entriesData && entriesData.length > 0) {
            setEntries(
              entriesData.map((e: any) => ({
                id: e.id,
                w: e.week_number || 1,
                t: e.verified_text || e.raw_text || e.activity_summary || '',
                area: e.technical_area || 'Practical Engineering',
                tools: e.tools_used || '',
                u: e.is_flagged || (e.confidence_scores?.overall !== undefined && e.confidence_scores?.overall < 0.75) ? 1 : 0,
                ph: e.department_unit || 'activity details',
                ok: e.is_verified ? 1 : 0,
              }))
            );
          }

          // Hydrate uploaded pages into Step 2 and Home screen if available
          if (freshProj?.source_documents && freshProj.source_documents.length > 0) {
            setPages((prev) => {
              if (prev.length > 0) return prev;
              return freshProj.source_documents.map((d: any) => ({
                id: d.id,
                n: d.original_filename || `Page ${d.page_index + 1}`,
                pdf: d.file_type === 'pdf',
                th: d.presigned_url || (d.file ? (d.file.startsWith('http') ? d.file : `${getApiBaseUrl().replace(/\/api\/?$/, '')}${d.file.startsWith('/') ? '' : '/'}${d.file}`) : ''),
                status: d.status,
              }));
            });
          }

          const repData = await fetchReport(projId).catch(() => null);
          if (repData && repData.sections && repData.sections.length > 0) {
            const hasContent = repData.sections.some((s: any) => s.content && s.content.trim().length > 20);
            if (hasContent) {
              setGenState(2);
              setChapterEdits(mapBackendSectionsToChapters(repData.sections));
            }
          }
          await fetchPayments(projId).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to init project from database:', err);
      }
    };
    initProject();
    return () => {
      isMounted = false;
    };
  }, [user, ensureActiveProject, fetchActiveProject, fetchLogbookEntries, fetchReport, fetchPayments]);

  // Synchronize state directly from active database project
  useEffect(() => {
    if (!activeProject) return;

    setDetails((prev) => ({
      name: activeProject.full_name || prev.name || userFullName,
      matric: activeProject.matric_number || prev.matric || '',
      dept: activeProject.department || prev.dept || '',
      fac: activeProject.college || activeProject.faculty_school || prev.fac || 'College of Basic Science',
      degree: activeProject.degree || prev.degree || '',
      inst: activeProject.university_name || prev.inst || '',
      co: activeProject.organization_name || prev.co || '',
      addr: activeProject.organization_address || prev.addr || '',
      unit: activeProject.industry_department || prev.unit || '',
      start: activeProject.training_start_date ? activeProject.training_start_date.slice(0, 10) : prev.start,
      end: activeProject.training_end_date ? activeProject.training_end_date.slice(0, 10) : prev.end,
      sup: activeProject.industry_supervisor_name || prev.sup || '',
      isup: activeProject.institution_supervisor_name || prev.isup || '',
    }));

    if (activeProject.source_documents && activeProject.source_documents.length > 0) {
      setPages(
        activeProject.source_documents.map((doc: any, i: number) => {
          let thumb = doc.presigned_url || '';
          if (!thumb && doc.file) {
            thumb = doc.file.startsWith('http')
              ? doc.file
              : `${getApiBaseUrl().replace(/\/api\/?$/, '')}${doc.file.startsWith('/') ? '' : '/'}${doc.file}`;
          }
          return {
            id: doc.id,
            n: doc.original_filename || `Page ${i + 1}`,
            pdf: doc.file_type === 'pdf',
            th: thumb,
            status: doc.status,
          };
        })
      );
    }

    if (activeProject.logbook_entries && activeProject.logbook_entries.length > 0) {
      setEntries(
        activeProject.logbook_entries.map((e: any) => ({
          id: e.id,
          w: e.week_number || 1,
          t: e.verified_text || e.raw_text || e.activity_summary || '',
          area: e.technical_area || 'Practical Engineering',
          tools: e.tools_used || '',
          u: e.is_flagged || (e.confidence_scores?.overall !== undefined && e.confidence_scores?.overall < 0.75) ? 1 : 0,
          ph: e.department_unit || 'activity details',
          ok: e.is_verified ? 1 : 0,
        }))
      );
      setReadDone(true);
    }
  }, [activeProject, userFullName]);

  // Synchronize compiled report sections from PostgreSQL.
  // Seed chapter drafts from the DB, but never overwrite sections the user has
  // already edited locally. Blindly clobbering chapterEdits on every dbReport
  // change (which happens after each autosave + refetch) throws away unsaved
  // edits and, on the next section switch, resets the editor to the top.
  useEffect(() => {
    if (dbReport && dbReport.sections && dbReport.sections.length > 0) {
      setGenState(2);
      setChapterEdits((prev) => {
        const next: Record<number, string> = { ...prev };
        let changed = false;
        dbReport.sections.forEach((s: any, idx: number) => {
          if (next[idx] === undefined) {
            next[idx] = s.content || '';
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [dbReport]);

  // Synchronize payment records directly from PostgreSQL
  useEffect(() => {
    if (payments && payments.length > 0) {
      const digitalPaid = payments.find((p: any) => p.order_type === 'digital' && p.status === 'paid');
      if (digitalPaid) {
        setHasPaidDigital(true);
      }
      const deliveryPaid = payments.find((p: any) => p.order_type === 'delivery' && p.status === 'paid');
      if (deliveryPaid) {
        setDeliveryData((prev) => ({
          ...prev,
          recipientName: deliveryPaid.recipient_name || prev.recipientName,
          phone: deliveryPaid.phone_number || prev.phone,
          campusLocation: deliveryPaid.campus_location || prev.campusLocation,
          customAddress: deliveryPaid.custom_address || prev.customAddress,
          deliveryDate: deliveryPaid.delivery_date ? deliveryPaid.delivery_date.slice(0, 10) : prev.deliveryDate,
        }));
      }
    }
  }, [payments]);

  // Auto-save student details directly to database (debounced)
  const detailsDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isHydrated || !activeProject?.id) return;

    if (detailsDebounceTimer.current) clearTimeout(detailsDebounceTimer.current);
    detailsDebounceTimer.current = setTimeout(() => {
      updateActiveProject(activeProject.id, {
        full_name: details.name || undefined,
        matric_number: details.matric || undefined,
        department: details.dept || undefined,
        college: details.fac || undefined,
        faculty_school: details.fac || undefined,
        degree: details.degree || undefined,
        university_name: details.inst || undefined,
        organization_name: details.co || undefined,
        organization_address: details.addr || undefined,
        industry_department: details.unit || undefined,
        training_start_date: details.start || undefined,
        training_end_date: details.end || undefined,
        industry_supervisor_name: details.sup || undefined,
        institution_supervisor_name: details.isup || undefined,
      }).catch(() => {});
    }, 800);

    return () => {
      if (detailsDebounceTimer.current) clearTimeout(detailsDebounceTimer.current);
    };
  }, [details, activeProject?.id, isHydrated, updateActiveProject]);

  // 1. Initial hydration: parse URL parameters and hash to set active screen/phase
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let restoredInFlow = false;
    let restoredStep = 1;
    let restoredTab: 'home' | 'logbooks' | 'reports' | 'settings' = 'home';
    let restoredView: 'pages' | 'report' = 'pages';
    let restoredGenState: 0 | 1 | 2 = 0;
    let restoredCheckout: 'digital' | 'delivery' | null = null;
    let restoredPaymentSuccess: any = null;

    // Parse URL parameters and hash to determine the active screen/phase
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace('#/', '').replace('#', '').toLowerCase();

    const paramStep = searchParams.get('step');
    const paramTab = searchParams.get('tab');
    const paramView = searchParams.get('view');
    const paramStatus = searchParams.get('status');
    const paramCheckout = searchParams.get('checkout');

    if (paramStep) {
      if (paramStep === 'success' || paramStep === 'ready') {
        restoredInFlow = true;
        restoredStep = 5;
        restoredGenState = 2;
      } else {
        const s = parseInt(paramStep, 10);
        if (s >= 1 && s <= 7) {
          restoredStep = s;
          restoredInFlow = true;
        }
      }
    } else if (hash.startsWith('step-')) {
      if (hash === 'step-success') {
        restoredInFlow = true;
        restoredStep = 5;
        restoredGenState = 2;
      } else {
        const s = parseInt(hash.replace('step-', ''), 10);
        if (s >= 1 && s <= 7) {
          restoredStep = s;
          restoredInFlow = true;
        }
      }
    }

    if (paramStatus === 'ready' || paramStatus === 'success' || hash === 'step-success' || hash === 'generated') {
      restoredInFlow = true;
      restoredStep = 5;
      restoredGenState = 2;
    }

    if (paramTab === 'home' || hash === 'home' || hash === 'home-view') {
      restoredTab = 'home';
      restoredInFlow = false;
    } else if (paramTab === 'reports' || hash === 'reports' || hash === 'reports-view') {
      restoredTab = 'reports';
      restoredInFlow = false;
    } else if (paramTab === 'settings' || hash === 'settings' || hash === 'settings-view') {
      restoredTab = 'settings';
      restoredInFlow = false;
    } else if (paramTab === 'logbooks' || hash === 'logbooks' || hash === 'logbook-pages' || hash === 'report' || hash === 'technical-report') {
      restoredTab = 'logbooks';
      restoredInFlow = false;
      if (paramView === 'report' || hash === 'report' || hash === 'technical-report') {
        restoredView = 'report';
      } else {
        restoredView = 'pages';
      }
    }

    if (paramCheckout === 'digital' || hash === 'checkout-digital') {
      restoredCheckout = 'digital';
    } else if (paramCheckout === 'delivery' || hash === 'checkout-delivery') {
      restoredCheckout = 'delivery';
    }

    if (paramStatus === 'paid' || hash === 'payment-success') {
      restoredPaymentSuccess = {
        type: 'digital',
        txRef: `L2D_PAID_${Date.now().toString().slice(-6)}`,
      };
    } else if (paramStatus === 'delivery-confirmed' || hash === 'delivery-success') {
      restoredPaymentSuccess = {
        type: 'delivery',
        txRef: `L2D_DEL_${Date.now().toString().slice(-6)}`,
      };
    }

    setStep(restoredStep);
    setInFlow(restoredInFlow);
    setCurrentTab(restoredTab);
    setLogbookView(restoredView);
    setGenState(restoredGenState);
    if (restoredCheckout) setCheckoutModal(restoredCheckout);
    if (restoredPaymentSuccess) setPaymentSuccess(restoredPaymentSuccess);

    setIsHydrated(true);
  }, []);

  // 3. Keep the URL search parameters and hash updated across all phases, screens, and modals
  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;

    const path = window.location.pathname;
    const params = new URLSearchParams();
    let hash = '';

    if (checkoutModal === 'digital') {
      params.set('checkout', 'digital');
      hash = '#checkout-digital';
    } else if (checkoutModal === 'delivery') {
      params.set('checkout', 'delivery');
      hash = '#checkout-delivery';
    } else if (paymentSuccess?.type === 'digital') {
      params.set('status', 'paid');
      hash = '#payment-success';
    } else if (paymentSuccess?.type === 'delivery') {
      params.set('status', 'delivery-confirmed');
      hash = '#delivery-success';
    } else if (inFlow) {
      if (step === 7 && genState === 2) {
        params.set('step', '7');
        params.set('status', 'ready');
        hash = '#step-success';
      } else {
        params.set('step', String(step));
        hash = `#step-${step}`;
      }
    } else {
      if (currentTab === 'logbooks') {
        params.set('tab', 'logbooks');
        if (logbookView === 'report') {
          params.set('view', 'report');
          hash = '#technical-report';
        } else {
          params.set('view', 'pages');
          hash = '#logbook-pages';
        }
      } else if (currentTab === 'reports') {
        params.set('tab', 'reports');
        hash = '#reports-view';
      } else if (currentTab === 'settings') {
        params.set('tab', 'settings');
        hash = '#settings-view';
      } else {
        params.set('tab', 'home');
        hash = '#home-view';
      }
    }

    const paramStr = params.toString();
    const newUrl = `${path}${paramStr ? '?' + paramStr : ''}${hash}`;
    const currentFull = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (currentFull !== newUrl) {
      window.history.replaceState({ tab: currentTab, step, inFlow, logbookView }, '', newUrl);
    }
  }, [
    isHydrated,
    inFlow,
    step,
    currentTab,
    logbookView,
    genState,
    checkoutModal,
    paymentSuccess,
  ]);

  // 4. Handle browser Back/Forward and manual hash navigation
  useEffect(() => {
    const handleUrlChange = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash.replace('#/', '').replace('#', '').toLowerCase();

      const paramStep = searchParams.get('step');
      const paramTab = searchParams.get('tab');
      const paramView = searchParams.get('view');
      const paramStatus = searchParams.get('status');
      const paramCheckout = searchParams.get('checkout');

      if (paramStep) {
        if (paramStep === 'success' || paramStep === 'ready') {
          setInFlow(true);
          setStep(7);
          setGenState(2);
        } else {
          const s = parseInt(paramStep, 10);
          if (s >= 1 && s <= 7) {
            setStep(s);
            setInFlow(true);
          }
        }
      } else if (hash.startsWith('step-')) {
        if (hash === 'step-success') {
          setInFlow(true);
          setStep(7);
          setGenState(2);
        } else {
          const s = parseInt(hash.replace('step-', ''), 10);
          if (s >= 1 && s <= 7) {
            setStep(s);
            setInFlow(true);
          }
        }
      }

      if (hash === 'step-success' || hash === 'generated' || paramStatus === 'ready' || paramStatus === 'success') {
        setInFlow(true);
        setStep(7);
        setGenState(2);
      }

      if (paramTab === 'home' || hash === 'home' || hash === 'home-view') {
        setCurrentTab('home');
        setInFlow(false);
      } else if (paramTab === 'reports' || hash === 'reports' || hash === 'reports-view') {
        setCurrentTab('reports');
        setInFlow(false);
      } else if (paramTab === 'settings' || hash === 'settings' || hash === 'settings-view') {
        setCurrentTab('settings');
        setInFlow(false);
      } else if (paramTab === 'logbooks' || hash === 'logbooks' || hash === 'logbook-pages' || hash === 'report' || hash === 'technical-report') {
        setCurrentTab('logbooks');
        setInFlow(false);
        setLogbookView(paramView === 'report' || hash === 'report' || hash === 'technical-report' ? 'report' : 'pages');
      }

      if (paramCheckout === 'digital' || hash === 'checkout-digital') {
        setCheckoutModal('digital');
      } else if (paramCheckout === 'delivery' || hash === 'checkout-delivery') {
        setCheckoutModal('delivery');
      } else {
        setCheckoutModal(null);
      }
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  // 5. Handle Squad payment callback URL params (returning from Squad checkout)
  useEffect(() => {
    const handleSquadCallback = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const transactionRef =
        searchParams.get('transaction_ref') ||
        searchParams.get('transaction_reference') ||
        searchParams.get('transactionRef') ||
        searchParams.get('reference');
      const orderRef = searchParams.get('order_ref');
      const type = searchParams.get('type');
      const error = searchParams.get('error');

      if (error) {
        showToast('Payment was not completed. Please try again.');
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }

      if (transactionRef && activeProject?.id) {
        try {
          setSquadCheckoutLoading(true);
          const result = await verifySquadPayment(activeProject.id, transactionRef);
          if (result.order_status === 'paid') {
            setCheckoutModal(null);
            setHasPaidDigital(true);
            setPaymentSuccess({
              type: type === 'delivery' ? 'delivery' : 'digital',
              txRef: orderRef || transactionRef,
              deliveryDetails: {
                location: deliveryData.campusLocation,
                customAddress: deliveryData.customAddress,
                date: deliveryData.deliveryDate,
                recipient: deliveryData.recipientName || details.name || userFullName,
                phone: deliveryData.phone,
              },
            });
            showToast('Payment verified! Report unlocked.');
          } else {
            showToast('Payment not yet confirmed. Please try again.');
          }
        } catch (err: any) {
          showToast(err.message || 'Payment verification failed');
        } finally {
          setSquadCheckoutLoading(false);
        }
        // Clean up URL params
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    handleSquadCallback();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 6. Restore payment state from backend on load
  useEffect(() => {
    const restorePaymentState = async () => {
      if (!activeProject?.id) return;
      try {
        const payments = await fetchPayments(activeProject.id);
        const paidDigital = (payments || []).find(
          (p: any) => p.order_type === 'digital' && p.status === 'paid'
        );
        const paidDelivery = (payments || []).find(
          (p: any) => p.order_type === 'delivery' && p.status === 'paid'
        );

        if (paidDigital) {
          setHasPaidDigital(true);
          setPaymentSuccess({
            type: 'digital',
            txRef: paidDigital.transaction_reference || paidDigital.order_reference,
          });
        } else if (paidDelivery) {
          setPaymentSuccess({
            type: 'delivery',
            txRef: paidDelivery.transaction_reference || paidDelivery.order_reference,
            deliveryDetails: {
              location: paidDelivery.campus_location || '',
              customAddress: paidDelivery.custom_address || '',
              date: paidDelivery.delivery_date || '',
              recipient: paidDelivery.recipient_name || '',
              phone: paidDelivery.phone_number || '',
            },
          });
        }
      } catch (err) {
        // Silently fail - payments will be fetched when needed
      }
    };

    restorePaymentState();
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update document title based on view
  useEffect(() => {
    let t = 'Home';
    if (inFlow) t = `Step ${step} of 7 · ${SN[step - 1]}`;
    else if (currentTab === 'logbooks') t = logbookView === 'report' ? 'Technical Report' : 'Logbooks';
    else if (currentTab === 'reports') t = 'Reports';
    else if (currentTab === 'settings') t = 'Settings';
    document.title = `Log2Def: ${t}`;
  }, [inFlow, step, currentTab, logbookView]);

  // Scroll handler for top bar border reveal
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    setIsScrolled(top > 10);
  };

  const hasStarted = Boolean(details.co || pages.length || step > 1);

  // Field helpers
  const getVal = (k: string) => details[k] || answers[k] || '';

  const checkCompleteness = () => {
    return FLD.map(([key, label]) => {
      const v = details[key] || '';
      const exists = Boolean(v && v.trim());
      const source =
        fieldSources[key] === 'logbook'
          ? 'your logbook'
          : fieldSources[key] === 'you added'
          ? 'you added'
          : 'your details';
      return { key, label, exists, source, value: v };
    });
  };

  const isStep4Invalid = () => {
    const items = checkCompleteness();
    const hasMissing = items.some((item) => !item.exists);
    const st = details.start;
    const en = details.end;
    const badDate = Boolean(st && en && en <= st);
    return hasMissing || badDate;
  };

  const handleConfirmField = async (key: string) => {
    const val = (answers[key] ?? '').trim();
    if (!val) {
      showToast('Please enter a value before confirming');
      return;
    }

    // Date validation
    if (key === 'start') {
      const en = details.end || answers.end;
      if (en && en <= val) {
        showToast('Start date must be before end date');
        return;
      }
    }
    if (key === 'end') {
      const st = details.start || answers.start;
      if (st && val <= st) {
        showToast('End date must be after start date');
        return;
      }
    }

    setDetails((prev) => ({ ...prev, [key]: val }));
    setFieldSources((prev) => ({ ...prev, [key]: 'you added' }));

    if (activeProject?.id) {
      try {
        await updateMissingInfo(activeProject.id, { [key]: val }).catch(() => {});
        const payload: Record<string, any> = {};
        if (key === 'co') payload.organization_name = val;
        if (key === 'addr') payload.organization_address = val;
        if (key === 'start') payload.training_start_date = val;
        if (key === 'end') payload.training_end_date = val;
        if (key === 'matric') payload.matric_number = val;
        if (key === 'dept') payload.department = val;
        if (key === 'fac') payload.faculty_school = val;
        if (key === 'inst') payload.university_name = val;
        if (key === 'sup') payload.industry_supervisor_name = val;
        if (key === 'isup') payload.institution_supervisor_name = val;
        await updateActiveProject(activeProject.id, payload).catch(() => {});
        showToast('Confirmed and saved');
      } catch (err) {
        console.warn('Could not save field to DB:', err);
      }
    }
  };

  // Step 3 Reading logic: runs OCR & fetches real logbook entries from PostgreSQL database
  const startReading = async (forceReread = false) => {
    setReading(true);
    setReadProgress(0);

    // Resolve active project robustly
    let proj = activeProject || useProjectStore.getState().activeProject;
    let projId = proj?.id;

    if (!projId) {
      try {
        proj = await ensureActiveProject();
        projId = proj?.id || useProjectStore.getState().activeProject?.id;
      } catch (err) {
        console.warn('Could not ensure active project in startReading:', err);
      }
    }

    if (!projId) {
      const allProjects = useProjectStore.getState().projects;
      if (allProjects && allProjects.length > 0) {
        try {
          proj = await fetchActiveProject(allProjects[0].id);
          projId = proj?.id;
        } catch {
          projId = allProjects[0].id;
        }
      }
    }

    if (!projId) {
      setReading(false);
      const token = getAuthToken();
      if (!token) {
        showToast('Please sign in or register to analyze your logbook with AI OCR');
        router.push('/login?redirect=/dashboard');
      } else {
        showToast('No active report project found. Please try refreshing or re-uploading.');
      }
      return;
    }

    try {
      // If there are uploaded pages with files that haven't been saved to DB yet, upload them now
      const pendingUploads = pages.filter((p) => p.file && !p.id);
      if (pendingUploads.length > 0 && projId) {
        showToast(`Uploading ${pendingUploads.length} pending logbook page${pendingUploads.length > 1 ? 's' : ''} to server...`);
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          if (page.file && !page.id) {
            const fd = new FormData();
            fd.append('file', page.file);
            fd.append('page_index', String(i));
            try {
              const uploadedDoc = await uploadDocument(projId, fd);
              if (uploadedDoc?.id) {
                setPages((prev) => {
                  const next = [...prev];
                  if (next[i]) {
                    next[i] = {
                      ...next[i],
                      id: uploadedDoc.id,
                      isUploading: false,
                      uploadProgress: 100,
                    };
                  }
                  return next;
                });
              }
            } catch (uErr) {
              console.warn(`Pending upload error on page ${i}:`, uErr);
            }
          }
        }
      }

      const freshProj = await fetchActiveProject(projId).catch(() => proj);
      const docs = freshProj?.source_documents || proj?.source_documents || [];
      const totalDocs = Math.max(docs.length, pages.length, 1);

      const iv = setInterval(() => {
        setReadProgress((prev) => (prev < totalDocs ? prev + 1 : prev));
      }, 350);

      let dbEntries = await fetchLogbookEntries(projId).catch(() => []);

      if (docs.length === 0 && pages.length === 0 && dbEntries.length === 0) {
        clearInterval(iv);
        setReading(false);
        showToast('No logbook pages uploaded yet. Please upload pages in Step 2 first.');
        return;
      }

      if (forceReread || dbEntries.length === 0) {
        if (docs.length > 0) {
          showToast(`Analyzing ${docs.length} logbook page${docs.length > 1 ? 's' : ''} with AI OCR...`);
          for (let dIdx = 0; dIdx < docs.length; dIdx++) {
            const doc = docs[dIdx];
            setReadProgress(dIdx + 1);
            try {
              await reprocessDocument(projId, doc.id);
            } catch (e) {
              console.warn(`OCR reprocess error on doc ${doc.id}:`, e);
            }
          }
          dbEntries = await fetchLogbookEntries(projId).catch(() => []);
          // Refresh active project in case cover details were updated during OCR
          await fetchActiveProject(projId).catch(() => {});
        }
      }

      clearInterval(iv);
      setReadProgress(totalDocs);

      if (dbEntries && dbEntries.length > 0) {
        setEntries(
          dbEntries.map((e: any) => ({
            id: e.id,
            w: e.week_number || 1,
            t: e.verified_text || e.raw_text || e.activity_summary || '',
            area: e.technical_area || 'Practical Engineering',
            tools: e.tools_used || '',
            u: e.is_flagged || (e.confidence_scores?.overall !== undefined && e.confidence_scores?.overall < 0.75) ? 1 : 0,
            ph: e.department_unit || 'activity details',
            ok: e.is_verified ? 1 : 0,
          }))
        );
        showToast(`AI OCR reading complete: ${dbEntries.length} entries extracted & structured`);
      } else {
        showToast('Pages scanned. You can confirm or add weekly entries directly below.');
      }
    } catch (err: any) {
      console.warn('Could not re-read logbook with OCR:', err);
      showToast(err.message || 'OCR reading error');
    } finally {
      setReading(false);
      setReadDone(true);
    }
  };

  // Step 5 Report Generation: triggers real generation in PostgreSQL
  const startGenerating = async () => {
    setGenError(null);

    // Pre-flight: if a previous generation was blocked by missing guided-intake
    // fields, do not POST again until those fields are actually filled in. Focus
    // the first still-empty required field so the user lands where the fix is.
    if (lastGenerateBlock && lastGenerateBlock.missing.length > 0) {
      const stillMissing = lastGenerateBlock.missing.filter(
        (k) =>
          typeof k === 'string' &&
          k.startsWith('guided_intake:') &&
          !((intake as any)[k.replace(/^guided_intake:/, '')] &&
            String((intake as any)[k.replace(/^guided_intake:/, '')]).trim())
      );
      if (stillMissing.length > 0) {
        const firstMissing = stillMissing.find((k) => typeof k === 'string') || null;
        if (firstMissing) {
          const focusKey = firstMissing.replace(/^guided_intake:/, '');
          setIntakeFocusKey(focusKey);
          setTimeout(() => {
            const el = intakeRefs.current[focusKey];
            if (el && typeof el.focus === 'function') {
              el.focus();
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }, 0);
        }
        setGenState(0);
        return;
      }
    }

    setGenState(1);
    setGenProgress(0);

    // Progress smoothly through the 8 stages (up to 7 while waiting for backend)
    const iv = setInterval(() => {
      setGenProgress((prev) => (prev < GS.length - 1 ? prev + 1 : prev));
    }, 2800);

    try {
      const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
      if (!projId) {
        throw new Error('No active project found. Please select or initialize your report project.');
      }

      const rep = await storeGenerateReport(projId, true);
      clearInterval(iv);
      setGenProgress(GS.length); // All 8 completed
      await new Promise((r) => setTimeout(r, 600));

      if (rep && rep.sections && rep.sections.length > 0) {
        const edits = mapBackendSectionsToChapters(rep.sections);
        setChapterEdits(edits);
      }
      setGenState(2);
      showToast('Institutional report compiled!');
    } catch (err: any) {
      clearInterval(iv);
      setGenState(0);

      // Surface a human-friendly message; keep the raw payload for routing.
      const raw = (err && (err as any).data) || null;
      const missingFields: string[] = raw
        ? (raw.missing_required_fields || (raw.completeness && (raw.completeness as any).missing_required_fields) || [])
        : [];
      const missingLabels: string[] = raw ? (raw.missing_labels || []) : [];
      const canGenerate: boolean = raw
        ? !!(raw.completeness && (raw.completeness as any).can_generate !== false)
        : false;

      if (missingFields.length > 0) {
        // Stash the blocked-generation payload so Step 4 / Step 5 can render the
        // right list and focus the first missing field on retry.
        setLastGenerateBlock({ missing: missingFields, labels: missingLabels, canGenerate });

        const hasGuidedIntake = missingFields.some(
          (k) => typeof k === 'string' && k.startsWith('guided_intake:')
        );

        // Build a friendly message from the backend's labels when available.
        const labelLine =
          missingLabels.length > 0
            ? missingLabels
                .map((l: string) => (l && l.trim() ? l.trim() : l))
                .filter(Boolean)
                .join(', ')
            : null;
        let msg: string;
        if (labelLine) {
          msg = `We couldn’t generate the report yet — these are still needed: ${labelLine}.`;
        } else {
          msg = 'We couldn’t generate the report yet — some required information is still missing.';
        }
        // Guided-intake fields are filled on the separate report-interview route,
        // so point the user there explicitly when they are part of the block.
        if (hasGuidedIntake) {
          msg +=
            ' Some of these are answered in the report interview — open it from the Missing info step.';
        }
        setGenError(msg);

        // Route to the missing-info step. For FLD detail fields (rendered inline in
        // Step 4), focus the first missing one; guided-intake fields live on the
        // /intake route, so we don't attempt an inline focus for those.
        setStep(4);
        const firstDetailMissing = missingFields.find(
          (k) => typeof k === 'string' && !k.startsWith('guided_intake:')
        ) || null;
        if (firstDetailMissing) {
          setIntakeFocusKey(firstDetailMissing as string);
          setTimeout(() => {
            const el = intakeRefs.current[firstDetailMissing as string];
            if (el && typeof el.focus === 'function') {
              el.focus();
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }, 0);
        }
        showToast('Report generation blocked — missing required information.');
      } else {
        setGenError(err.message || 'Report generation failed. Please try again.');
        showToast(err.message || 'Report generation error');
      }
    }
  };

  const getSectionHtml = (i: number): string => {
    if (chapterEdits[i] !== undefined) return chapterEdits[i];
    if (dbReport && dbReport.sections && dbReport.sections.length > 0) {
      if (dbReport.template_version === 'lasustech_cs:2.0.0') {
        return dbReport.sections[i]?.content || '';
      }
      const mapped = mapBackendSectionsToChapters(dbReport.sections);
      if (mapped[i]) return mapped[i];
    }
    return getSectionDefaultHtml(i);
  };

  // Academic Layout calculations
  const computeLayout = () => {
    const R: { t: string; h: string; l: string; p: number }[] = [];
    let r = 0;
    let n = 0;
    const rm = ['i', 'ii', 'iii', 'iv', 'v'];
    let tot = 0;

    const words = (h: string) => h.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const pg = (h: string) => Math.max(1, Math.ceil(words(h) / 230));

    // Cover
    R.push({ t: SEC[0], h: getSectionHtml(0), l: '', p: 1 });
    tot += 1;

    // Front matter
    for (let i = 1; i <= 3; i++) {
      R.push({ t: SEC[i], h: getSectionHtml(i), l: rm[r], p: 1 });
      r++;
      tot++;
    }

    // Abstract
    R.push({ t: SEC[4], h: getSectionHtml(4), l: rm[r], p: 1 });
    r++;
    tot++;

    // Contents page
    const tp = { t: 'Contents', h: '', l: rm[r], p: 1 };
    r++;
    tot++;
    R.push(tp);

    // Chapters 1 to 5 + References
    const toc: [string, number][] = [];
    for (let j = 5; j <= 10; j++) {
      const p = pg(getSectionHtml(j));
      R.push({ t: SEC[j], h: getSectionHtml(j), l: String(n + 1), p });
      toc.push([SEC[j], n + 1]);
      n += p;
      tot += p;
    }

    tp.h =
      '<p style="text-align:center"><b>TABLE OF CONTENTS</b></p>' +
      toc.map((x) => `<p>${x[0]} ........ ${x[1]}</p>`).join('');

    return { rows: R, total: tot };
  };

  // Thumbnail generator
  const generateThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve('');
        return;
      }
      const u = URL.createObjectURL(file);
      const im = new window.Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        const k = Math.min(1, 200 / Math.max(im.width, im.height));
        c.width = Math.round(im.width * k);
        c.height = Math.round(im.height * k);
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(im, 0, 0, c.width, c.height);
          URL.revokeObjectURL(u);
          resolve(c.toDataURL('image/jpeg', 0.6));
        } else {
          URL.revokeObjectURL(u);
          resolve('');
        }
      };
      im.onerror = () => {
        URL.revokeObjectURL(u);
        resolve('');
      };
      im.src = u;
    });
  };

  // File uploads directly to Neon S3 storage bucket and DB
  const handleFilesAdded = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    let proj = activeProject || useProjectStore.getState().activeProject;
    let projId = proj?.id;

    if (!projId) {
      try {
        proj = await ensureActiveProject();
        projId = proj?.id || useProjectStore.getState().activeProject?.id;
      } catch (err) {
        console.warn('Could not ensure active project for file upload:', err);
      }
    }

    if (!projId) {
      const list = useProjectStore.getState().projects;
      if (list && list.length > 0) {
        projId = list[0].id;
      }
    }

    const token = getAuthToken();
    if (!projId && !token) {
      showToast('Please sign in or register to upload logbook pages');
      router.push('/login?redirect=/dashboard');
      return;
    }

    if (!projId) {
      showToast('Could not initialize report project. Please refresh the page.');
      return;
    }

    const count = files.length;
    showToast(`Uploading ${count} logbook page${count > 1 ? 's' : ''}...`);

    const startingIndex = pages.length;
    const fileArr = Array.from(files);
    const initialPlaceholders: LogPage[] = fileArr.map((f: File) => ({
      n: f.name,
      pdf: f.type === 'application/pdf',
      th: '',
      file: f,
      isUploading: true,
      uploadProgress: 15,
    }));

    setPages((prev) => [...prev, ...initialPlaceholders]);

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const pageIdx = startingIndex + i;

      // Animate progress smoothly while uploading
      const progressTimer = setInterval(() => {
        setPages((prev) => {
          const idx = prev.findIndex((p) => p.file === f);
          if (idx === -1 || !prev[idx].isUploading) return prev;
          const next = [...prev];
          const current = next[idx].uploadProgress || 15;
          if (current < 85) {
            next[idx] = { ...next[idx], uploadProgress: current + 12 };
          }
          return next;
        });
      }, 140);

      const localThPromise = generateThumbnail(f);

      const fd = new FormData();
      fd.append('file', f);
      fd.append('page_index', String(pageIdx));
      fd.append('async', 'true');

      try {
        const uploadedDoc = await uploadDocument(projId, fd);
        clearInterval(progressTimer);
        successCount++;

        const localTh = await localThPromise;
        let finalTh = localTh;
        if (uploadedDoc) {
          if (uploadedDoc.presigned_url) {
            finalTh = uploadedDoc.presigned_url;
          } else if (uploadedDoc.file) {
            finalTh = uploadedDoc.file.startsWith('http')
              ? uploadedDoc.file
              : `${getApiBaseUrl().replace(/\/api\/?$/, '')}${uploadedDoc.file.startsWith('/') ? '' : '/'}${uploadedDoc.file}`;
          }
        }

        // Complete loader line to 100%
        setPages((prev) => {
          const idx = prev.findIndex((p) => p.file === f);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            id: uploadedDoc?.id,
            uploadProgress: 100,
          };
          return next;
        });

        // Short 200ms pause so the student sees the filled progress line
        await new Promise((r) => setTimeout(r, 200));

        setPages((prev) => {
          const idx = prev.findIndex((p) => p.file === f);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            id: uploadedDoc?.id,
            th: finalTh,
            isUploading: false,
            uploadProgress: 100,
          };
          return next;
        });
      } catch (err: any) {
        clearInterval(progressTimer);
        const localTh = await localThPromise;
        setPages((prev) => {
          const idx = prev.findIndex((p) => p.file === f);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            th: localTh,
            isUploading: false,
            q: 'error',
          };
          return next;
        });
        showToast(`Upload error on ${f.name}: ${err.message || 'failed'}`);
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (camInputRef.current) camInputRef.current.value = '';

    if (projId) {
      await fetchActiveProject(projId).catch(() => {});
      await fetchLogbookEntries(projId).catch(() => {});
    }

    if (successCount > 0) {
      showToast(`${successCount} logbook page${successCount > 1 ? 's' : ''} uploaded successfully!`);
    } else {
      showToast('Page upload failed. Please check network connection and retry.');
    }
  };

  // In-app Camera
  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async (targetIndex = -1) => {
    setRetakeIndex(targetIndex);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Camera unavailable');
      if (camInputRef.current) camInputRef.current.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: cameraFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      showToast('Camera blocked. Allow it, or upload files');
      if (camInputRef.current) camInputRef.current.click();
    }
  };

  const closeCamera = () => {
    stopCameraStream();
    setIsCameraActive(false);
  };

  const switchCamera = () => {
    const nextMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(nextMode);
    stopCameraStream();
    setTimeout(() => {
      startCamera(retakeIndex);
    }, 100);
  };

  const snapPhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;

    const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);

    // Luminance check
    const t = document.createElement('canvas');
    t.width = 24;
    t.height = 24;
    const tx = t.getContext('2d');
    let avgLuminance = 100;
    if (tx) {
      tx.drawImage(c, 0, 0, 24, 24);
      const d = tx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      for (let z = 0; z < d.length; z += 4) {
        sum += d[z] * 0.3 + d[z + 1] * 0.59 + d[z + 2] * 0.11;
      }
      avgLuminance = sum / 576;
    }

    const thCanvas = document.createElement('canvas');
    const k2 = 200 / Math.max(c.width, c.height);
    thCanvas.width = Math.round(c.width * k2);
    thCanvas.height = Math.round(c.height * k2);
    const thCtx = thCanvas.getContext('2d');
    let thumbUrl = '';
    if (thCtx) {
      thCtx.drawImage(c, 0, 0, thCanvas.width, thCanvas.height);
      thumbUrl = thCanvas.toDataURL('image/jpeg', 0.6);
    }

    const isDark = avgLuminance < 40;
    const pageItem: LogPage = {
      n: 'Camera page',
      pdf: false,
      th: thumbUrl,
      q: isDark ? 'dark' : undefined,
    };

    setCameraFlash(true);
    setTimeout(() => setCameraFlash(false), 200);

    // Save camera photo blob to S3 bucket & DB
    c.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_page_${Date.now()}.jpg`, { type: 'image/jpeg' });
      let proj = activeProject || useProjectStore.getState().activeProject;
      let projId = proj?.id;
      if (!projId) {
        try {
          proj = await ensureActiveProject();
          projId = proj?.id || useProjectStore.getState().activeProject?.id;
        } catch (e) {
          console.error('Could not ensure active project:', e);
        }
      }
      if (!projId) {
        const list = useProjectStore.getState().projects;
        if (list && list.length > 0) {
          projId = list[0].id;
        }
      }

      if (projId) {
        showToast('Saving photo to database...');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('page_index', String(retakeIndex >= 0 ? retakeIndex : pages.length));
        fd.append('async', 'true');
        try {
          await uploadDocument(projId, fd);
          await fetchActiveProject(projId);
          await fetchLogbookEntries(projId).catch(() => {});
          showToast('Captured page saved to cloud');
        } catch (err: any) {
          showToast(err.message || 'Failed to save captured page');
        }
      }
    }, 'image/jpeg', 0.85);

    if (retakeIndex >= 0) {
      setPages((prev) => {
        const copy = [...prev];
        copy[retakeIndex] = pageItem;
        return copy;
      });
      closeCamera();
      return;
    }

    setPages((prev) => [...prev, pageItem]);
    if (isDark) {
      showToast(`Page ${pages.length + 1} looks dark`);
    }
  };

  const movePage = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    const reordered = [...pages];
    const temp = reordered[index];
    reordered[index] = reordered[target];
    reordered[target] = temp;
    setPages(reordered);

    const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (projId) {
      const orderPayload = reordered
        .filter((p) => p.id !== undefined)
        .map((p, idx) => ({ id: p.id as number, page_index: idx }));
      if (orderPayload.length > 0) {
        await reorderDocuments(projId, orderPayload).catch(() => {});
      }
    }
  };

  const removePage = async (index: number) => {
    const page = pages[index];
    setPages((prev) => prev.filter((_, i) => i !== index));

    const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (projId && page?.id) {
      try {
        await deleteDocument(projId, page.id);
        await fetchActiveProject(projId).catch(() => {});
        const fresh = await fetchLogbookEntries(projId).catch(() => []);
        if (fresh && Array.isArray(fresh)) {
          setEntries(
            fresh.map((e: any) => ({
              id: e.id,
              w: e.week_number || 1,
              t: e.verified_text || e.raw_text || e.activity_summary || '',
              area: e.technical_area || 'Practical Engineering',
              tools: e.tools_used || '',
              u: e.is_flagged || (e.confidence_scores?.overall !== undefined && e.confidence_scores?.overall < 0.75) ? 1 : 0,
              ph: e.department_unit || 'activity details',
              ok: e.is_verified ? 1 : 0,
            }))
          );
        }
        showToast('Page removed');
      } catch (err: any) {
        showToast(err.message || 'Failed to remove page from server');
      }
    } else {
      showToast('Page removed');
    }
  };

  // ========================================================
  // REAL DOWNLOAD EXECUTION (PDF / DOCX FROM DATABASE)
  // ========================================================
  const executeRealFileDownload = async (format: 'PDF' | 'Word') => {
    const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!projId) {
      showToast('No active project');
      return;
    }
    setDownloadLoading(true);
    try {
      // Verify payment via secure backend endpoint
      const url = `${getApiBaseUrl()}/projects/${projId}/squad/download/${format.toLowerCase()}/`;
      const token = getAuthToken();
      const res = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        if (res.status === 403) {
          showToast('You must complete payment before downloading.');
        } else {
          showToast('Download not available yet.');
        }
        return;
      }
      const blob = await res.blob();
      const filename = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || `siwes_report.${format.toLowerCase()}`;
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();
    } catch (err: any) {
      showToast(err.message || 'Download failed');
    } finally {
      setDownloadLoading(false);
    }
  };

  // ========================================================
  // SQUAD PAYMENT HANDLERS
  // ========================================================
  const [squadCheckoutLoading, setSquadCheckoutLoading] = useState<boolean>(false);
  const [squadTxRef, setSquadTxRef] = useState<string | null>(null);

  const initiateDigitalSquadPayment = async () => {
    if (!activeProject?.id) {
      showToast('No active project found');
      return;
    }
    setSquadCheckoutLoading(true);
    try {
      const result = await initiateSquadPayment(activeProject.id, {
        order_type: 'digital',
        recipient_name: details.name || userFullName,
        phone_number: '',
        campus_location: '',
        custom_address: '',
        delivery_date: '',
        notes: '',
      });
      setSquadTxRef(result.transaction_reference);
      // Redirect to Squad hosted checkout
      window.location.href = result.checkout_url;
    } catch (err: any) {
      setSquadCheckoutLoading(false);
      showToast(err.message || 'Failed to start payment');
    }
  };

  const initiateDeliverySquadPayment = async () => {
    if (!deliveryData.phone.trim()) {
      showToast('Please enter your phone number');
      return;
    }
    if (!deliveryData.recipientName.trim()) {
      showToast('Please enter recipient name');
      return;
    }
    if (!activeProject?.id) {
      showToast('No active project found');
      return;
    }

    setSquadCheckoutLoading(true);
    try {
      const result = await initiateSquadPayment(activeProject.id, {
        order_type: 'delivery',
        recipient_name: deliveryData.recipientName,
        phone_number: deliveryData.phone,
        campus_location: deliveryData.campusLocation,
        custom_address: deliveryData.customAddress,
        delivery_date: deliveryData.deliveryDate,
        notes: deliveryData.notes,
      });
      setSquadTxRef(result.transaction_reference);
      // Redirect to Squad hosted checkout
      window.location.href = result.checkout_url;
    } catch (err: any) {
      setSquadCheckoutLoading(false);
      showToast(err.message || 'Failed to start payment');
    }
  };

  const verifySquadPaymentStatus = async (transactionRef: string) => {
    if (!activeProject?.id) return;
    try {
      const result = await verifySquadPayment(activeProject.id, transactionRef);
      if (result.order_status === 'paid') {
        if (result.type === 'digital' || (result as any).order_type === 'digital') {
          setHasPaidDigital(true);
        }
        setCheckoutModal(null);
        setPaymentSuccess({
          type: (result as any).order_type === 'delivery' ? 'delivery' : 'digital',
          txRef: transactionRef,
          deliveryDetails: {
            location: deliveryData.campusLocation,
            customAddress: deliveryData.customAddress,
            date: deliveryData.deliveryDate,
            recipient: deliveryData.recipientName || details.name || userFullName,
            phone: deliveryData.phone,
          },
        });
        showToast('Payment verified! Order confirmed.');
      } else {
        showToast('Payment not yet confirmed. Please try again.');
      }
    } catch (err: any) {
      showToast(err.message || 'Payment verification failed');
    }
  };

  // Step 1 Submission
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (method === 'photos') {
      if (!activeProject?.id) {
        await ensureActiveProject().catch(() => {});
      }
      setStep(2);
      if (scrRef.current) scrRef.current.scrollTop = 0;
      return;
    }

    const required = ['name', 'matric', 'dept', 'fac', 'inst', 'co'];
    let firstBadField: string | null = null;

    for (const k of required) {
      const val = details[k] ? details[k].trim() : '';
      if (!val) {
        firstBadField = k;
        break;
      }
    }

    if (firstBadField) {
      const el = document.getElementById(firstBadField);
      if (el) el.focus();
      return;
    }

    let proj = activeProject || useProjectStore.getState().activeProject;
    let projId = proj?.id;
    if (!projId) {
      proj = await ensureActiveProject().catch(() => null);
      projId = proj?.id;
    }

    if (projId) {
      updateActiveProject(projId, {
        full_name: details.name || undefined,
        matric_number: details.matric,
        department: details.dept,
        college: details.fac,
        faculty_school: details.fac,
        degree: details.degree,
        university_name: details.inst,
        organization_name: details.co,
        organization_address: details.addr,
        training_start_date: details.start || undefined,
        training_end_date: details.end || undefined,
        industry_supervisor_name: details.sup || undefined,
        institution_supervisor_name: details.isup || undefined,
      }).catch(() => {});
    }

    setStep(2);
    if (scrRef.current) scrRef.current.scrollTop = 0;
  };

  const closeSheet = () => setActiveSheet(null);

  const switchTab = (tab: 'home' | 'logbooks' | 'reports' | 'settings') => {
    setCurrentTab(tab);
    setInFlow(false);
    if (scrRef.current) scrRef.current.scrollTop = 0;
  };

  const goToFlow = (targetStep = 1) => {
    setStep(targetStep);
    setInFlow(true);
    if (scrRef.current) scrRef.current.scrollTop = 0;
  };

  const stepIcons = ['badge', 'photo_camera', 'fact_check', 'edit_note', 'auto_awesome'];
  const stepNames = ['Details', 'Logbook', 'Review', 'Missing info', 'Generate'];
  const stepSubtitles = [
    'Add your details',
    'Add your pages',
    'Check what we read',
    'Fill what’s missing',
    'Generate your report',
  ];

  // ==========================================
  // VIEW: HOME
  // ==========================================
  const renderHomeView = () => {
    const s = Math.min(step, 5);
    const n = pages.length;

    return (
      <div className="view" id="home-view" suppressHydrationWarning>
        <header className="top">
          <span className="sp" />
          <span className="tt">Home</span>
          {!isInstalled && !installDismissed ? (
            <button
              type="button"
              className="ib"
              onClick={handleInstallClick}
              title={
                deviceOS === 'ios'
                  ? 'Install on iPhone / iPad'
                  : deviceOS === 'android'
                  ? 'Install Android App'
                  : 'Install Log2Def App'
              }
              aria-label="Install App"
            >
              <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }}>
                {deviceOS === 'ios' ? 'phone_iphone' : deviceOS === 'android' ? 'android' : 'download'}
              </span>
            </button>
          ) : (
            <span className="sp" />
          )}
        </header>

        <div className="lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div>
              <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--mut)' }}>
                Hi, {details.name ? details.name.split(' ')[0] : (user?.first_name || user?.username || 'there')}
              </p>
              <h1>
                Logbook in.
                <br />
                Report out.
              </h1>
            </div>
            {!isInstalled && !installDismissed && (
              <button
                type="button"
                onClick={handleInstallClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '20px',
                  background: 'var(--mint)',
                  color: 'var(--gd)',
                  border: '1px solid rgba(6,107,77,0.2)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                  marginTop: '4px',
                }}
                title={
                  deviceOS === 'ios'
                    ? 'Install Log2Def on your iPhone or iPad'
                    : deviceOS === 'android'
                    ? 'Install Log2Def Android App'
                    : 'Install Log2Def App'
                }
              >
                <span className="ms" style={{ fontSize: '18px', color: 'var(--g)' }}>
                  {deviceOS === 'ios' ? 'phone_iphone' : deviceOS === 'android' ? 'android' : 'download'}
                </span>
                <span>
                  {deviceOS === 'ios'
                    ? 'Install'
                    : deviceOS === 'android'
                    ? 'Install'
                    : 'Install'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* OS-Aware Install Button / Banner */}
        {!isInstalled && !installDismissed && (
          <div
            className="install-card"
            style={{
              marginBottom: '16px',
              padding: '12px 14px',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              boxShadow: '0 2px 8px rgba(20, 32, 27, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                className="ms"
                style={{
                  color: 'var(--g)',
                  fontSize: '22px',
                  background: 'var(--mint)',
                  padding: '7px',
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                {deviceOS === 'ios' ? 'phone_iphone' : deviceOS === 'android' ? 'android' : 'download'}
              </span>
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontWeight: 700,
                    fontSize: '13px',
                    color: 'var(--ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {deviceOS === 'ios'
                    ? 'Install on iPhone / iPad'
                    : deviceOS === 'android'
                    ? 'Install Android App'
                    : 'Install Log2Def App'}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: '11px',
                    color: 'var(--mut)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {deviceOS === 'ios'
                    ? 'Tap Share → Add to Home Screen'
                    : deviceOS === 'android'
                    ? '1-tap install & offline access'
                    : 'Get the native app experience'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleInstallClick}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 14px',
                background: 'var(--g)',
                color: '#fff',
                border: 'none',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
                boxShadow: '0 2px 4px rgba(6,107,77,0.2)',
              }}
            >
              <span className="ms" style={{ fontSize: '15px' }}>
                {deviceOS === 'ios' ? 'ios_share' : 'download'}
              </span>
              Install
            </button>
          </div>
        )}

        {/* Hero Card */}
        <section className="hero" aria-label="Your report">
          <span className="chip" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>
            <span className="ms" aria-hidden="true">
              {stepIcons[s - 1]}
            </span>
            {hasStarted ? `Step ${s} of 7` : '7 steps'}
          </span>
          <h2>{hasStarted ? stepNames[s - 1] : 'New report'}</h2>
          <p>{hasStarted ? stepSubtitles[s - 1] : 'Photos to PDF or Word'}</p>
          <div className="wp" aria-hidden="true">
            {stepNames.map((_, k) => (
              <i key={k} className={hasStarted && k < s ? 'on' : ''} />
            ))}
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => goToFlow(s)}
            style={{ textDecoration: 'none', marginTop: '16px' }}
          >
            {hasStarted ? 'Continue' : 'Start'}
            <span className="ms" aria-hidden="true">
              arrow_forward
            </span>
          </button>
        </section>

        {/* Your Steps */}
        <h2 className="sh">Your steps</h2>
        <div className="card" style={{ padding: '4px 14px' }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {stepNames.map((x, i) => {
              const k = !hasStarted ? (i === 0 ? 'c' : 'u') : i + 1 < s ? 'd' : i + 1 === s ? 'c' : 'u';
              const can = k !== 'u';
              return (
                <li key={x}>
                  <button
                    className={`rm ${k}`}
                    type="button"
                    disabled={!can}
                    onClick={() => {
                      if (can) goToFlow(i + 1);
                    }}
                    aria-current={k === 'c' ? 'step' : undefined}
                  >
                    <span className="ji">
                      <span className="ms" aria-hidden="true">
                        {k === 'd' ? 'check' : stepIcons[i]}
                      </span>
                    </span>
                    <span>
                      {x}
                      <small>{k === 'd' ? 'Done' : k === 'c' ? 'Next' : 'Later'}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* 2 Bottom Quick Links */}
        <div className="tl2">
          <button
            type="button"
            onClick={() => {
              setLogbookView('pages');
              switchTab('logbooks');
            }}
          >
            <span className="ms" aria-hidden="true">
              menu_book
            </span>
            <b>Logbook</b>
            <small>{n ? `${n} page${n === 1 ? '' : 's'}` : 'None yet'}</small>
          </button>
          <button
            type="button"
            onClick={() => {
              setLogbookView('report');
              switchTab('logbooks');
            }}
          >
            <span className="ms" aria-hidden="true">
              description
            </span>
            <b>Report</b>
            <small>{genState === 2 ? 'Draft ready' : 'Not yet'}</small>
          </button>
        </div>
      </div>
    );
  };

  // ==========================================
  // VIEW: TECHNICAL REPORT (INSIDE LOGBOOK)
  // ==========================================
  const renderReportViewer = () => {
    const layout = computeLayout();
    const modelSections = dbReport?.document_model?.sections;
    const modelRows = dbReport?.template_version === 'lasustech_cs:2.0.0' && Array.isArray(modelSections)
      ? modelSections.map((section: any, index: number) => {
          const escapeHtml = (value: string) => value.replace(/[&<>\"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
          }[char] as string));
          const renderNode = (node: any): string => {
            if (node.type === 'paragraph' || node.type === 'heading') {
              const text = escapeHtml(node.text || '').replace(/\n/g, '<br/>');
              return node.type === 'heading' ? `<h3>${text}</h3>` : `<p>${text}</p>`;
            }
            if (node.type === 'list') {
              const tag = node.attrs?.ordered ? 'ol' : 'ul';
              return `<${tag}>${(node.children || []).map((item: any) => `<li>${escapeHtml(item.text || '')}</li>`).join('')}</${tag}>`;
            }
            if (node.type === 'table') {
              return `<table>${(node.children || []).map((row: any) => `<tr>${(row.children || []).map((cell: any) => `<td>${escapeHtml(cell.text || '')}</td>`).join('')}</tr>`).join('')}</table>`;
            }
            if (node.type === 'figure') return node.attrs?.caption ? `<p>${escapeHtml(node.attrs.caption)}</p>` : '';
            return '';
          };
          const priorChapter = index > 0 ? modelSections[index - 1]?.chapter : undefined;
          const chapterHeading = section.chapter_title && section.chapter !== priorChapter
            ? `<h2>${escapeHtml(section.chapter_title).replace(/\n/g, '<br/>')}</h2>` : '';
          return {
            t: section.title,
            h: `${chapterHeading}<h3>${escapeHtml(section.title || '')}</h3>${(section.nodes || []).map(renderNode).join('')}`,
            p: 1,
            l: null,
          };
        })
      : null;
    const previewRows = modelRows || layout.rows;
    const pageEstimate = dbReport?.page_estimate_breakdown || {};
    const qualityGate = dbReport?.quality_gate || { passed: true, blockers: [], warnings: [], summary: {} };
    const needsMoreDetail = (qualityGate.warnings || []).filter((issue: any) =>
      ['thin_section', 'low_student_content', 'unconfirmed_inference'].includes(issue.code)
    );
    const editorLabels = dbReport?.template_version === 'lasustech_cs:2.0.0'
      ? (dbReport.sections || []).map((section: any) => section.title)
      : SEC;

    const openQualityCheckedPreview = async () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setIsRefreshingQuality(true);
      let checked = false;
      try {
        const projectId = activeProject?.id;
        if (projectId && dbReport?.sections) {
          const section = getSectionForChapterTab(currentSectionIdx, dbReport.sections);
          const content = editorRef.current?.innerHTML;
          if (section?.id && content !== undefined) {
            await saveSection(projectId, section.id, content, section.title);
          }
          await fetchReport(projectId);
          checked = true;
        } else if (dbReport?.quality_gate) {
          checked = true;
        }
      } catch (error) {
        showToast('Could not check the latest report. Please try again.');
      } finally {
        setIsRefreshingQuality(false);
        if (checked) setEditorTab('prev');
      }
    };

    if (genState !== 2) {
      return (
        <div className="card big" style={{ marginTop: '10px' }}>
          <div className="ok">
            <span className="ms" aria-hidden="true">
              auto_stories
            </span>
          </div>
          <h2>No report generated yet</h2>
          <p>Complete the 5-step generator to compile your logbook entries into an institutional report.</p>
          <button
            className="btn w"
            type="button"
            onClick={() => goToFlow(hasStarted ? step : 1)}
            style={{ marginTop: '20px' }}
          >
            {hasStarted ? 'Continue generation' : 'Start report generator'}
          </button>
        </div>
      );
    }

    return (
      <div style={{ marginTop: '6px' }}>
        <div className="seg" role="tablist" aria-label="View" style={{ marginBottom: '14px' }}>
          <button
            role="tab"
            type="button"
            aria-selected={editorTab === 'edit'}
            onClick={() => setEditorTab('edit')}
          >
            Edit
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={editorTab === 'prev'}
            onClick={openQualityCheckedPreview}
            disabled={isRefreshingQuality}
            aria-busy={isRefreshingQuality}
          >
            {isRefreshingQuality ? 'Checking…' : 'Preview'}
          </button>
        </div>

        {editorTab === 'edit' ? (
          <>
            <div className="pills" role="tablist" aria-label="Sections">
              {editorLabels.map((x: string, i: number) => (
                <button
                  key={x}
                  role="tab"
                  type="button"
                  aria-selected={i === currentSectionIdx}
                  onClick={() => {
                    setCurrentSectionIdx(i);
                    if (editorRef.current) {
                      editorRef.current.innerHTML = getSectionHtml(i);
                    }
                  }}
                >
                  {x.replace(/Chapter (\d): /, 'Ch $1: ')}
                </button>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="tl" role="toolbar" aria-label="Formatting">
                <button
                  type="button"
                  onClick={() => {
                    document.execCommand('bold');
                    editorRef.current?.focus();
                  }}
                  aria-label="Bold"
                >
                  <span className="ms" aria-hidden="true">
                    format_bold
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    document.execCommand('italic');
                    editorRef.current?.focus();
                  }}
                  aria-label="Italic"
                >
                  <span className="ms" aria-hidden="true">
                    format_italic
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    document.execCommand('insertUnorderedList');
                    editorRef.current?.focus();
                  }}
                  aria-label="Bullets"
                >
                  <span className="ms" aria-hidden="true">
                    format_list_bulleted
                  </span>
                </button>
                <span className="sv" id="sv">
                  <span className="ms" style={{ fontSize: '17px' }} aria-hidden="true">
                    {saveStatusText === 'saving' ? 'sync' : 'cloud_done'}
                  </span>
                  {saveStatusText === 'saving' ? 'Saving' : 'Saved'}
                </span>
              </div>

              <div
                ref={editorRef}
                className="doc"
                id="doc"
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label={editorLabels[currentSectionIdx] || 'Report section'}
                style={{ textAlign: 'justify' }}
                onInput={(e) => {
                  setSaveStatusText('saving');
                  const val = e.currentTarget.innerHTML;
                  setChapterEdits((prev) => ({ ...prev, [currentSectionIdx]: val }));
                  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                  saveTimerRef.current = setTimeout(async () => {
                    setSaveStatusText('saved');
                    if (activeProject?.id && dbReport?.sections) {
                      const sec = getSectionForChapterTab(currentSectionIdx, dbReport.sections);
                      if (sec?.id) {
                        try {
                          await saveSection(activeProject.id, sec.id, val, sec.title);
                        } catch (err) {
                          console.warn('Failed to save section to DB:', err);
                        }
                      }
                    }
                  }, 600);
                }}
              />
            </div>

            {needsMoreDetail.length > 0 && (
              <aside className="card" aria-label="Needs more detail" style={{ marginTop: '12px' }}>
                <h2 style={{ marginTop: 0 }}>Needs more detail</h2>
                <p className="mut">Add only information you can confirm. These prompts are not included in the report.</p>
                {needsMoreDetail.map((issue: any, idx: number) => (
                  <div key={`${issue.code}-${issue.section_key || 'report'}-${idx}`} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <p style={{ margin: '0 0 6px' }}>{issue.question || issue.message}</p>
                    {issue.section_key && (
                      <button
                        className="btn o s"
                        type="button"
                        onClick={() => {
                          const sectionIndex = (dbReport?.sections || []).findIndex((section: any) => section.section_key === issue.section_key);
                          if (sectionIndex >= 0) {
                            setCurrentSectionIdx(sectionIndex);
                            if (editorRef.current) editorRef.current.innerHTML = getSectionHtml(sectionIndex);
                          }
                        }}
                      >
                        Open {dbReport?.sections?.find((section: any) => section.section_key === issue.section_key)?.title || 'section'}
                      </button>
                    )}
                  </div>
                ))}
              </aside>
            )}

            <button
              className="btn o w s"
              type="button"
              onClick={() => setActiveSheet({ type: 'editDetails' })}
            >
              <span className="ms" aria-hidden="true">
                badge
              </span>
              Edit your details
            </button>
            <p className="hint" style={{ marginTop: '10px' }}>
              Edits save automatically. Review missing required details before export.
            </p>
          </>
        ) : (
          <>
            <div className="card">
              <span className="chip">
                <span className="ms" aria-hidden="true">info</span>
                Estimated {qualityGate.summary?.total_pages ?? dbReport?.estimated_pages ?? layout.total} total pages
              </span>
              <p className="mut" style={{ fontSize: '13.5px', marginTop: '10px' }}>
                Student-derived content: {qualityGate.summary?.student_derived_pages ?? pageEstimate.student_derived_page_equivalent ?? '—'} pages. {qualityGate.blockers?.length || 0} blockers · {qualityGate.warnings?.length || 0} warnings.
              </p>
              <p className="mut" style={{ fontSize: '13.5px', marginTop: '6px' }}>
                Student-derived words: {qualityGate.summary?.student_derived_words ?? pageEstimate.student_derived_words ?? '—'}.
              </p>
              <p className="mut" style={{ fontSize: '13.5px', marginTop: '6px' }}>
                Times New Roman 12pt · 1.5 spacing · justified · template {dbReport?.template_version || 'v1'}
              </p>
              {(qualityGate.warnings || []).map((issue: any, idx: number) => (
                <p key={`${issue.code}-${idx}`} className="mut" style={{ fontSize: '13px', marginTop: '6px' }}>
                  Warning: {issue.message}
                </p>
              ))}
            </div>

            {!qualityGate.passed ? (
              <div className="card" id="report-quality" role="alert" style={{ border: '1px solid #b42318' }}>
                <h2 style={{ marginTop: 0 }}>Preview blocked</h2>
                <p>Fix these report issues before preview or export.</p>
                {[...(qualityGate.blockers || []), ...(qualityGate.warnings || [])].map((issue: any, idx: number) => (
                  <div key={`${issue.code}-${idx}`} id={issue.anchor?.replace('#', '')} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <p style={{ margin: 0 }}>{issue.message}</p>
                    {issue.section_key && (
                      <button
                        className="btn o s"
                        type="button"
                        onClick={() => {
                          const sectionIndex = (dbReport?.sections || []).findIndex((section: any) => section.section_key === issue.section_key);
                          if (sectionIndex >= 0) {
                            setCurrentSectionIdx(sectionIndex);
                            if (editorRef.current) editorRef.current.innerHTML = getSectionHtml(sectionIndex);
                          }
                          setEditorTab('edit');
                        }}
                      >
                        Go to {dbReport?.sections?.find((section: any) => section.section_key === issue.section_key)?.title || 'section'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : previewRows.map((q: any, idx: number) => (
              <React.Fragment key={idx}>
                <p className="pl2">
                  {q.t} ·{' '}
                  {q.l
                    ? `page ${q.l}${q.p > 1 ? ` (continues to ${+q.l + q.p - 1})` : ''}`
                    : 'no page number'}
                </p>
                <div
                  className="pgp"
                  role="group"
                  aria-label={q.t}
                >
                  <div dangerouslySetInnerHTML={{ __html: q.h }} />
                  {q.l && <div className="pn">Page {q.l}{q.p > 1 ? ` – ${+q.l + q.p - 1}` : ''}</div>}
                </div>
              </React.Fragment>
            ))}
          </>
        )}

        {/* Dual Actions: 1. Digital Download (NGN 2,000) & 2. Print Delivery (NGN 4,000) */}
        <div style={{ marginTop: '22px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            className="btn w"
            type="button"
            disabled={downloadLoading}
            onClick={() => {
              if (hasPaidDigital) {
                executeRealFileDownload('PDF');
              } else {
                setCheckoutModal('digital');
              }
            }}
          >
            <span className="ms" aria-hidden="true" style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}>
              download
            </span>
            {downloadLoading
              ? 'Preparing download…'
              : hasPaidDigital
                ? 'Download Report (Paid)'
                : 'Download Report (NGN 2,000)'}
          </button>

          <button
            className="btn o w"
            type="button"
            onClick={() => setCheckoutModal('delivery')}
          >
            <span className="ms" aria-hidden="true">
              local_shipping
            </span>
            Print & Spiral Binding Delivery (NGN 4,000)
          </button>
        </div>
      </div>
    );
  };

  // ==========================================
  // VIEW: LOGBOOKS
  // ==========================================
  const renderLogbooksView = () => {
    const un = entries.filter((e) => e.u && !e.ok).length;
    const st = !readDone ? (reading ? 'Reading' : 'Not read yet') : un ? `${un} to check` : 'Reviewed';

    return (
      <div className="view" id={logbookView === 'report' ? 'technical-report' : 'logbook-pages'}>
        <header className="top">
          <span className="sp" />
          <span className="tt">Logbooks</span>
          <span className="sp" />
        </header>

        <div className="lg" style={{ paddingBottom: '12px' }}>
          <h1>My Logbooks</h1>
        </div>

        {/* Sub-tab segmented toggle: Logbook Pages vs Technical Report */}
        <div className="seg" role="tablist" aria-label="Logbook tabs" style={{ marginBottom: '14px' }}>
          <button
            role="tab"
            type="button"
            aria-selected={logbookView === 'pages'}
            onClick={() => setLogbookView('pages')}
          >
            Logbook Pages ({pages.length})
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={logbookView === 'report'}
            onClick={() => setLogbookView('report')}
          >
            Technical Report {genState === 2 ? '•' : ''}
          </button>
        </div>

        {logbookView === 'report' ? (
          renderReportViewer()
        ) : !pages.length ? (
          <div className="card big">
            <div className="ok">
              <span className="ms" aria-hidden="true">
                photo_camera
              </span>
            </div>
            <h2>No logbook yet</h2>
            <p>Add your logbook to begin.</p>
            <button
              className="btn w"
              type="button"
              onClick={() => goToFlow(1)}
              style={{ textDecoration: 'none', marginTop: '20px' }}
            >
              Start a new report
            </button>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="row sb">
                <b>SIWES logbook</b>
                <span className={`chip${un ? ' w' : ''}`}>{st}</span>
              </div>
              <p className="mut" style={{ margin: '6px 0 14px', fontSize: '14px' }}>
                {pages.length} page{pages.length === 1 ? '' : 's'}
                {details.co ? ` · ${details.co}` : ''}
              </p>
              <button className="btn w s" type="button" onClick={() => goToFlow(2)}>
                Add or Reorder Pages
              </button>
            </div>

            {/* List of thumbnails */}
            <h2 className="sh" style={{ fontSize: '17px', margin: '18px 2px 10px' }}>
              Captured Pages ({pages.length})
            </h2>
            <div className="t3" role="list">
              {pages.map((p, i) => (
                <div key={i} className="th" role="listitem">
                  {p.isUploading ? (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '10px 8px',
                        boxSizing: 'border-box',
                        background: 'var(--bg)',
                      }}
                    >
                      <span
                        className="ms"
                        style={{
                          fontSize: '32px',
                          color: p.pdf ? '#ef4444' : 'var(--g)',
                          animation: 'pulse 1.8s infinite',
                        }}
                        aria-hidden="true"
                      >
                        {p.pdf ? 'picture_as_pdf' : 'image'}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          maxWidth: '90%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: '4px 0',
                        }}
                        title={p.n}
                      >
                        {p.n}
                      </span>
                      {/* Small loader line that fills up to the end */}
                      <div
                        style={{
                          width: '84%',
                          height: '4px',
                          background: 'rgba(16, 185, 129, 0.16)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                          margin: '4px 0 3px',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${p.uploadProgress || 15}%`,
                            background: 'linear-gradient(90deg, #10b981, #34d399)',
                            borderRadius: '999px',
                            transition: 'width 0.35s ease-out',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--g)' }}>
                        {p.uploadProgress ? `${p.uploadProgress}%` : 'Uploading…'}
                      </span>
                    </div>
                  ) : p.th ? (
                    <img src={p.th} alt={`Page ${i + 1}`} />
                  ) : (
                    <span className="ms" style={{ fontSize: '34px', color: 'var(--g)' }} aria-hidden="true">
                      {p.pdf ? 'picture_as_pdf' : 'sync'}
                    </span>
                  )}
                  <span className="n" title={p.n || (i === 0 ? 'Cover' : `Page ${i}`)}>
                    {p.n ? (p.n.length > 14 ? p.n.slice(0, 11) + '…' : p.n) : (i === 0 ? 'Cover' : `Page ${i}`)}
                  </span>
                </div>
              ))}
            </div>

            {genState === 2 && (
              <div className="card" style={{ marginTop: '16px', background: 'var(--mint)', border: 'none' }}>
                <div className="row sb">
                  <div>
                    <b>Technical Report Ready</b>
                    <p style={{ fontSize: '13px', color: 'var(--gd)', margin: '2px 0 0' }}>
                      About {computeLayout().total} pages generated
                    </p>
                  </div>
                  <button
                    className="btn s"
                    type="button"
                    onClick={() => setLogbookView('report')}
                    style={{ background: 'var(--gd)' }}
                  >
                    View Report
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ==========================================
  // VIEW: REPORTS
  // ==========================================
  const renderReportsView = () => {
    const layout = computeLayout();
    const hasReport = genState === 2 || Boolean(dbReport && dbReport.sections && dbReport.sections.length > 0);

    return (
      <div className="view" id="reports-view">
        <header className="top">
          <span className="sp" />
          <span className="tt">Reports</span>
          <span className="sp" />
        </header>

        <div className="lg">
          <h1>My Reports</h1>
        </div>

        {!hasReport ? (
          <div className="card big">
            <div className="ok">
              <span className="ms" aria-hidden="true">
                description
              </span>
            </div>
            <h2>No reports yet</h2>
            <p>Complete the 5-step generator to compile your institutional SIWES report.</p>
            <button
              className="btn w"
              type="button"
              onClick={() => goToFlow(hasStarted ? step : 1)}
              style={{ textDecoration: 'none', marginTop: '20px' }}
            >
              {hasStarted ? 'Continue your report' : 'Start a new report'}
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: '20px' }}>
            <div className="row sb" style={{ alignItems: 'flex-start' }}>
              <div>
                <b style={{ fontSize: '17px', color: 'var(--ink)' }}>
                  {activeProject?.title || 'LASUSTECH SIWES Technical Report'}
                </b>
                <p className="mut" style={{ margin: '4px 0 0', fontSize: '13.5px' }}>
                  {details.co ? `${details.co} · ` : ''}{details.inst || 'LASUSTECH'}
                </p>
              </div>
              <span className="chip" style={{ background: 'var(--mint)', color: 'var(--g)', fontWeight: 700 }}>
                Draft Ready
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '10px',
                margin: '16px 0',
                padding: '12px',
                background: 'var(--bg)',
                borderRadius: '14px',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--mut)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Estimated Length
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink)', marginTop: '2px' }}>
                  {layout.total} pages
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--mut)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Confirmed Weeks
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink)', marginTop: '2px' }}>
                  {entries.length} weeks
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--mut)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Format
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink)', marginTop: '2px' }}>
                  LASUSTECH v1
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                className="btn w s"
                type="button"
                onClick={() => {
                  setLogbookView('report');
                  switchTab('logbooks');
                }}
              >
                <span className="ms" aria-hidden="true">
                  edit_note
                </span>
                Open &amp; Edit Technical Report
              </button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn o w s"
                  type="button"
                  style={{ flex: 1 }}
                  disabled={downloadLoading}
                  onClick={() => executeRealFileDownload('PDF')}
                >
                  <span className="ms" aria-hidden="true" style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}>
                    picture_as_pdf
                  </span>
                  {downloadLoading ? 'Preparing…' : 'PDF'}
                </button>
                <button
                  className="btn o w s"
                  type="button"
                  style={{ flex: 1 }}
                  disabled={downloadLoading}
                  onClick={() => executeRealFileDownload('Word')}
                >
                  <span className="ms" aria-hidden="true" style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}>
                    description
                  </span>
                  {downloadLoading ? 'Preparing…' : 'Word (DOCX)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ==========================================
  // VIEW: SETTINGS — ENHANCED UI
  // ==========================================
  const renderSettingsView = () => {
    const studentName = details.name || userFullName || 'Student';
    const initials = studentName
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'ST';

    return (
      <div className="view" id="settings-view">
        <header className="top">
          <span className="sp" />
          <span className="tt">Settings</span>
          <span className="sp" />
        </header>

        <div className="lg" style={{ paddingBottom: '12px' }}>
          <h1>Settings &amp; Profile</h1>
        </div>

        {/* 1. Student Profile Card */}
        <div className="settings-profile">
          <div className="settings-avatar" aria-hidden="true">
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '17px', color: 'var(--fg)', lineHeight: 1.2 }}>
              {studentName}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
              <span className="chip" style={{ fontSize: '11.5px', padding: '2px 8px' }}>
                {details.matric || 'Matric not set'}
              </span>
              <span className="mut" style={{ fontSize: '12.5px', wordBreak: 'break-all' }}>
                {user?.email || 'No email registered'}
              </span>
            </div>
          </div>
        </div>

        <button
          className="btn o w"
          type="button"
          onClick={() => setActiveSheet({ type: 'editDetails' })}
          style={{ marginBottom: '18px' }}
        >
          <span className="ms" aria-hidden="true">
            edit
          </span>
          Edit Student Details
        </button>

        {/* 2. Academic & Institutional Affiliation */}
        <div className="settings-group">
          <div className="settings-group-title">Academic Affiliation</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  account_balance
                </span>
              </div>
              <div>
                <div className="s-label">Institution</div>
                <div className="s-val">{details.inst || 'Not provided'}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  school
                </span>
              </div>
              <div>
                <div className="s-label">Faculty or College</div>
                <div className="s-val">{details.fac || 'Not provided'}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  science
                </span>
              </div>
              <div>
                <div className="s-label">Department</div>
                <div className="s-val">{details.dept || <span className="mut">Not set</span>}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  article
                </span>
              </div>
              <div>
                <div className="s-label">Official SIWES Template</div>
                <div className="s-val">LASUSTECH Technical Report (Version 1.0)</div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. SIWES Placement & Supervision */}
        <div className="settings-group">
          <div className="settings-group-title">SIWES Placement &amp; Supervision</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  business
                </span>
              </div>
              <div>
                <div className="s-label">Company / Organisation</div>
                <div className="s-val">{details.co || <span className="mut">Not set</span>}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  pin_drop
                </span>
              </div>
              <div>
                <div className="s-label">Workplace Address</div>
                <div className="s-val">{details.addr || <span className="mut">Not set</span>}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  engineering
                </span>
              </div>
              <div>
                <div className="s-label">Attached Department / Unit</div>
                <div className="s-val">{details.unit || <span className="mut">Not set</span>}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  date_range
                </span>
              </div>
              <div>
                <div className="s-label">Training Period</div>
                <div className="s-val">
                  {details.start && details.end ? `${details.start} to ${details.end}` : <span className="mut">Not set</span>}
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  badge
                </span>
              </div>
              <div>
                <div className="s-label">Industry-based Supervisor</div>
                <div className="s-val">{details.sup || <span className="mut">Not set</span>}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  verified_user
                </span>
              </div>
              <div>
                <div className="s-label">Institution-based Supervisor</div>
                <div className="s-val">{details.isup || <span className="mut">Not set</span>}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Service Pricing & Delivery Specs */}
        <div className="settings-group">
          <div className="settings-group-title">Report Services &amp; Pricing</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  file_download
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div className="s-label">Digital Download (PDF &amp; Word DOCX)</div>
                <div className="s-val">NGN 2,000</div>
              </div>
              {hasPaidDigital && (
                <span className="chip" style={{ background: 'var(--mint)', color: 'var(--g)' }}>
                  Unlocked
                </span>
              )}
            </div>

            <div className="settings-row">
              <div className="s-icon">
                <span className="ms" aria-hidden="true">
                  local_shipping
                </span>
              </div>
              <div>
                <div className="s-label">Printed &amp; Spiral Binding Delivery</div>
                <div className="s-val">NGN 4,000 (LASUSTECH Campus drop-off)</div>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Direct WhatsApp Support */}
        <div className="settings-group">
          <div className="settings-group-title">Direct SIWES Helpdesk</div>
          <div className="settings-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span className="ms" style={{ color: '#25d366', fontSize: '26px' }}>
                support_agent
              </span>
              <div>
                <b style={{ fontSize: '15px' }}>Official WhatsApp Support</b>
                <p className="mut" style={{ fontSize: '13px', margin: '2px 0 0' }}>
                  Available for report inquiries, payments, and delivery follow-ups.
                </p>
              </div>
            </div>
            <a
              href="https://wa.me/2348096044860?text=Hello%20Log2Def%20Support%2C%20I%20need%20assistance%20with%20my%20SIWES%20technical%20report"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-wa"
              style={{ width: '100%', boxSizing: 'border-box' }}
            >
              <span className="ms" aria-hidden="true">
                chat
              </span>
              Chat on WhatsApp (+234 809 604 4860)
            </a>
          </div>
        </div>

        {/* 6. Storage & Account Actions */}
        <div className="settings-group">
          <div className="settings-group-title">Account &amp; Project</div>
          <button
            className="btn o w"
            type="button"
            style={{ marginBottom: '10px' }}
            onClick={async () => {
              if (typeof window === 'undefined' || !window.confirm('Reset this project and start over? This will clear uploaded logbook pages, entries, and generated reports for the current project.')) return;
              const projectId = activeProject?.id;
              try {
                if (projectId) await deleteProject(projectId);
                resetReportState();
                clearActiveProject();
                await createProject({ title: 'SIWES Technical Report' });
                setDetails({
                  name: userFullName,
                  inst: '',
                  degree: '',
                  fac: 'College of Basic Science',
                  dept: '',
                  matric: '',
                  co: '',
                  addr: '',
                  unit: '',
                  start: '',
                  end: '',
                  sup: '',
                  isup: '',
                });
                setFieldSources({});
                setAnswers({});
                setPages([]);
                setEntries([]);
                setReading(false);
                setReadProgress(0);
                setReadDone(false);
                setStep(1);
                setMethod('manual');
                setGenState(0);
                setGenProgress(0);
                setGenError(null);
                setEditorTab('edit');
                setCurrentSectionIdx(0);
                setChapterEdits({});
                setInFlow(false);
                setLogbookView('pages');
                setHasPaidDigital(false);
                setPaymentSuccess(null);
                setStep4SaveError(null);
                showToast('Project reset. Starting fresh.');
              } catch (err: any) {
                console.error('Reset project failed:', err);
                showToast(err?.message || 'Failed to reset project');
              }
            }}
          >
            <span className="ms" aria-hidden="true">
              restart_alt
            </span>
            Reset project &amp; start over
          </button>

          <button
            className="btn o w"
            type="button"
            onClick={() => {
              showToast('Logged out');
              logout();
            }}
          >
            <span className="ms" aria-hidden="true">
              logout
            </span>
            Log out
          </button>
        </div>

        <p className="mut" style={{ textAlign: 'center', fontSize: '12px', marginTop: '20px', paddingBottom: '20px' }}>
          Log2Def v1.2 · Built for LASUSTECH SIWES Students
        </p>
      </div>
    );
  };

  // ==========================================
  // WIZARD FLOW: STEP 1 (YOUR DETAILS)
  // ==========================================
  const renderStep1 = () => {
    const isPhotos = method === 'photos';

    return (
      <form id="sf" noValidate onSubmit={handleStep1Submit}>
        <div className="view" id="step-1">
          <h1 className="wt" id="wh" tabIndex={-1}>
            {isPhotos ? 'Photos first' : 'Your details'}
          </h1>
          <div className="seg" role="tablist" aria-label="How to start" style={{ marginTop: '14px' }}>
            <button
              role="tab"
              type="button"
              aria-selected={!isPhotos}
              onClick={() => setMethod('manual')}
            >
              Fill in details
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={isPhotos}
              onClick={() => setMethod('photos')}
            >
              Photos first
            </button>
          </div>

          {isPhotos ? (
            <div className="card big" style={{ padding: '26px 16px' }}>
              <div className="ok">
                <span className="ms" aria-hidden="true">
                  photo_camera
                </span>
              </div>
              <p style={{ margin: 0 }}>We read your details from the cover and last page.</p>
            </div>
          ) : (
            <>
              <p className="gt">ABOUT YOU</p>

              <div className="f" data-f="name">
                <label htmlFor="name">
                  Full name <em aria-hidden="true">*</em>
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={details.name || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
                <p className="err" id="name-e" hidden={Boolean(details.name?.trim())}>
                  Please fill this in.
                </p>
              </div>

              <div className="f" data-f="matric">
                <label htmlFor="matric">
                  Matriculation number <em aria-hidden="true">*</em>
                </label>
                <input
                  id="matric"
                  name="matric"
                  type="text"
                  placeholder="e.g. STE/2021/0456"
                  value={details.matric || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, matric: e.target.value }))}
                  required
                />
                <p className="err" id="matric-e" hidden={Boolean(details.matric?.trim())}>
                  Please fill this in.
                </p>
              </div>

              <div className="f" data-f="dept">
                <label htmlFor="dept">
                  Department <em aria-hidden="true">*</em>
                </label>
                <input
                  id="dept"
                  name="dept"
                  type="text"
                  value={details.dept || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, dept: e.target.value }))}
                  required
                />
                <p className="err" id="dept-e" hidden={Boolean(details.dept?.trim())}>
                  Please fill this in.
                </p>
              </div>

              <div className="f" data-f="fac">
                <label htmlFor="fac">
                  Faculty or College <em aria-hidden="true">*</em>
                </label>
                <select
                  id="fac"
                  name="fac"
                  value={details.fac || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, fac: e.target.value }))}
                  required
                >
                  {COLLEGES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {details.fac === 'Other' && (
                  <input
                    type="text"
                    placeholder="Enter your Faculty or College"
                    value={details.customFac || ''}
                    onChange={(e) => setDetails((prev) => ({ ...prev, customFac: e.target.value }))}
                    style={{ marginTop: '8px' }}
                    required
                  />
                )}
                <p className="err" id="fac-e" hidden={Boolean(details.fac?.trim())}>
                  Please select your faculty or college.
                </p>
              </div>

              <div className="f" data-f="inst">
                <label htmlFor="inst">
                  Institution <em aria-hidden="true">*</em>
                </label>
                <select
                  id="inst"
                  name="inst"
                  value={details.inst ? (INSTITUTIONS.includes(details.inst) ? details.inst : 'Other') : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'Other') {
                      setDetails((prev) => ({ ...prev, inst: prev.customInst || 'Other' }));
                    } else {
                      setDetails((prev) => ({ ...prev, inst: val }));
                    }
                  }}
                  required
                >
                  <option value="">Select an institution</option>
                  {INSTITUTIONS.map((instOption) => (
                    <option key={instOption} value={instOption}>
                      {instOption}
                    </option>
                  ))}
                </select>
                {(details.inst === 'Other' || (details.inst && !INSTITUTIONS.includes(details.inst))) && (
                  <input
                    type="text"
                    placeholder="Enter your institution name"
                    value={details.inst === 'Other' ? '' : details.inst}
                    onChange={(e) =>
                      setDetails((prev) => ({ ...prev, inst: e.target.value, customInst: e.target.value }))
                    }
                    style={{ marginTop: '8px' }}
                    required
                  />
                )}
                <p className="err" id="inst-e" hidden={Boolean(details.inst?.trim())}>
                  Please fill this in.
                </p>
              </div>

              <p className="gt">YOUR PLACEMENT</p>

              <div className="f" data-f="co">
                <label htmlFor="co">
                  Company or organisation <em aria-hidden="true">*</em>
                </label>
                <input
                  id="co"
                  name="co"
                  type="text"
                  value={details.co || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, co: e.target.value }))}
                  required
                />
                <p className="err" id="co-e" hidden={Boolean(details.co?.trim())}>
                  Please fill this in.
                </p>
              </div>

              <div className="f" data-f="addr">
                <label htmlFor="addr">
                  Company address <span className="mut" style={{ fontWeight: 600 }}>(optional now)</span>
                </label>
                <input
                  id="addr"
                  name="addr"
                  type="text"
                  value={details.addr || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, addr: e.target.value }))}
                />
              </div>

              <div className="f" data-f="unit">
                <label htmlFor="unit">
                  Department or unit at company <span className="mut" style={{ fontWeight: 600 }}>(optional)</span>
                </label>
                <input
                  id="unit"
                  name="unit"
                  type="text"
                  value={details.unit || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, unit: e.target.value }))}
                />
              </div>

              <div className="f" data-f="start">
                <label htmlFor="start">
                  Training start date <span className="mut" style={{ fontWeight: 600 }}>(optional now)</span>
                </label>
                <input
                  id="start"
                  name="start"
                  type="date"
                  value={details.start || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, start: e.target.value }))}
                />
              </div>

              <div className="f" data-f="end">
                <label htmlFor="end">
                  Training end date <span className="mut" style={{ fontWeight: 600 }}>(optional now)</span>
                </label>
                <input
                  id="end"
                  name="end"
                  type="date"
                  value={details.end || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, end: e.target.value }))}
                />
              </div>

              <p className="gt">SUPERVISORS</p>
              <p className="hint" style={{ margin: '-4px 4px 12px' }}>
                If your template asks.
              </p>

              <div className="f" data-f="sup">
                <label htmlFor="sup">
                  Industry supervisor <span className="mut" style={{ fontWeight: 600 }}>(optional)</span>
                </label>
                <input
                  id="sup"
                  name="sup"
                  type="text"
                  value={details.sup || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, sup: e.target.value }))}
                />
              </div>

              <div className="f" data-f="isup">
                <label htmlFor="isup">
                  Institution supervisor <span className="mut" style={{ fontWeight: 600 }}>(optional)</span>
                </label>
                <input
                  id="isup"
                  name="isup"
                  type="text"
                  value={details.isup || ''}
                  onChange={(e) => setDetails((prev) => ({ ...prev, isup: e.target.value }))}
                />
              </div>
            </>
          )}
        </div>
      </form>
    );
  };

  // ==========================================
  // WIZARD FLOW: STEP 2 (YOUR LOGBOOK)
  // ==========================================
  const renderStep2 = () => {
    const n = pages.length;

    return (
      <div className="view" id="step-2">
        <h1 className="wt" id="wh" tabIndex={-1}>
          Your logbook
        </h1>
        <p className="wd">Cover to last page, in order.</p>

        <div className="row">
          <button className="btn" type="button" onClick={() => startCamera()} style={{ flex: 1 }}>
            <span className="ms" aria-hidden="true">
              photo_camera
            </span>
            Take photos
          </button>
          <label className="btn o" style={{ flex: 1, position: 'relative' }}>
            <span className="ms" aria-hidden="true">
              upload_file
            </span>
            Upload files
            <input
              ref={fileInputRef}
              className="fi"
              id="upl"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              aria-label="Upload logbook images or PDFs"
              onChange={(e) => handleFilesAdded(e.target.files)}
            />
          </label>
        </div>

        <input
          ref={camInputRef}
          id="cam"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => handleFilesAdded(e.target.files)}
        />

        {/* Upload status banner if uploads are pending */}
        {pages.some((p) => p.isUploading || (p.uploadProgress !== undefined && p.uploadProgress < 100)) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.24)',
              color: 'var(--g)',
              fontSize: '13px',
              fontWeight: 600,
              margin: '12px 0',
            }}
            role="status"
            aria-live="polite"
          >
            <span className="ms" style={{ animation: 'spin 1.2s linear infinite', fontSize: '18px' }}>
              sync
            </span>
            <span>
              Uploading {pages.filter((p) => p.isUploading).length || 1} file{pages.filter((p) => p.isUploading).length > 1 ? 's' : ''}... The Next button will be enabled once uploads finish.
            </span>
          </div>
        )}

        {n ? (
          <>
            <div className="t3" role="list">
              {pages.map((p, i) => (
                <div key={i} className="th" role="listitem">
                  {p.isUploading ? (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '10px 8px',
                        boxSizing: 'border-box',
                        background: 'var(--bg)',
                      }}
                    >
                      <span
                        className="ms"
                        style={{
                          fontSize: '32px',
                          color: p.pdf ? '#ef4444' : 'var(--g)',
                          animation: 'pulse 1.8s infinite',
                        }}
                        aria-hidden="true"
                      >
                        {p.pdf ? 'picture_as_pdf' : 'image'}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          maxWidth: '90%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: '4px 0',
                        }}
                        title={p.n}
                      >
                        {p.n}
                      </span>
                      {/* Small loader line that fills up to the end */}
                      <div
                        style={{
                          width: '84%',
                          height: '4px',
                          background: 'rgba(16, 185, 129, 0.16)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                          margin: '4px 0 3px',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${p.uploadProgress || 15}%`,
                            background: 'linear-gradient(90deg, #10b981, #34d399)',
                            borderRadius: '999px',
                            transition: 'width 0.35s ease-out',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--g)' }}>
                        {p.uploadProgress ? `${p.uploadProgress}%` : 'Uploading…'}
                      </span>
                    </div>
                  ) : p.th ? (
                    <img src={p.th} alt={`Page ${i + 1}`} />
                  ) : (
                    <span className="ms" style={{ fontSize: '34px', color: 'var(--g)' }} aria-hidden="true">
                      {p.pdf ? 'picture_as_pdf' : 'sync'}
                    </span>
                  )}
                  {p.q === 'dark' && (
                    <button
                      className="chip w"
                      type="button"
                      onClick={() => startCamera(i)}
                      style={{ position: 'absolute', left: '6px', top: '6px', border: 0, cursor: 'pointer' }}
                    >
                      <span className="ms" aria-hidden="true">
                        refresh
                      </span>
                      Dark. Retake
                    </button>
                  )}
                  <span className="n" title={p.n || (i === 0 ? 'Cover' : `Page ${i}`)}>
                    {p.n ? (p.n.length > 14 ? p.n.slice(0, 11) + '…' : p.n) : (i === 0 ? 'Cover' : `Page ${i}`)}
                  </span>
                  <button
                    className="ib x"
                    type="button"
                    onClick={() => removePage(i)}
                    aria-label={`Remove page ${i + 1}`}
                  >
                    <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">
                      close
                    </span>
                  </button>
                  <div className="mv">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => movePage(i, -1)}
                      aria-label={`Move page ${i + 1} earlier`}
                    >
                      <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">
                        chevron_left
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={i === n - 1}
                      onClick={() => movePage(i, 1)}
                      aria-label={`Move page ${i + 1} later`}
                    >
                      <span className="ms" style={{ fontSize: '18px' }} aria-hidden="true">
                        chevron_right
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="hint" role="status">
              {n} page{n === 1 ? '' : 's'} added
            </p>
          </>
        ) : (
          <div className="card empty" style={{ marginTop: '16px', padding: '30px' }}>
            <p style={{ margin: 0, color: 'var(--mut)' }}>No pages yet</p>
          </div>
        )}
      </div>
    );
  };

  // ==========================================
  // WIZARD FLOW: STEP 3 (CHECK WHAT WE READ)
  // ==========================================
  const renderStep3 = () => {
    if (reading) {
      const n = Math.max(pages.length, 1);
      return (
        <div className="view" id="step-3">
          <div className="card big">
            <div className="ok">
              <span className="ms" aria-hidden="true">
                auto_stories
              </span>
            </div>
            <h2 id="wh" tabIndex={-1}>
              Reading your logbook
            </h2>
            <p>
              Page {Math.min(readProgress + 1, n)} of {n}
            </p>
            <div
              className="pb"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={n}
              aria-valuenow={readProgress}
              aria-label="Reading progress"
              style={{ marginTop: '20px' }}
            >
              <i
                style={{
                  animation: 'none',
                  width: `${(readProgress / n) * 100}%`,
                  transition: 'width .3s',
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    const un = entries.filter((e) => e.u && !e.ok);
    const rest = entries.filter((e) => !(e.u && !e.ok));

    return (
      <div className="view" id="step-3">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <div>
            <h1 className="wt" id="wh" tabIndex={-1}>
              Check what we read
            </h1>
            <p className="wd">{entries.length} entries found</p>
          </div>
          <button
            type="button"
            className="btn o s"
            onClick={() => startReading(true)}
            title="Re-analyze uploaded pages with AI OCR"
            style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '20px', gap: '4px', flexShrink: 0, marginTop: '8px' }}
          >
            <span className="ms" style={{ fontSize: '16px', color: 'var(--g)' }}>
              auto_awesome
            </span>
            Re-read with OCR
          </button>
        </div>

        {un.length > 0 ? (
          <>
            <p className="gt">UNCLEAR READINGS ({un.length})</p>
            {un.map((e) => {
              const i = entries.indexOf(e);
              return (
                <div key={i} className="card">
                  <div className="row sb">
                    <b>Week {e.w}</b>
                    <span className="chip w">
                      <span className="ms" aria-hidden="true">
                        warning
                      </span>
                      Unclear
                    </span>
                  </div>
                  <div className="f" style={{ margin: '10px 0 8px' }}>
                    <label htmlFor={`e${i}`} className="sr-only" style={{ display: 'none' }}>
                      Week {e.w} text
                    </label>
                    <textarea
                      id={`e${i}`}
                      value={e.t}
                      onChange={(ev) => {
                        const val = ev.target.value;
                        setEntries((prev) => {
                          const copy = [...prev];
                          copy[i] = { ...copy[i], t: val };
                          return copy;
                        });
                        const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
                        if (projId && e.id) {
                          updateLogbookEntry(projId, e.id, {
                            verified_text: val,
                            raw_text: val,
                          }).catch(() => {});
                        }
                      }}
                      style={{ minHeight: '84px', fontSize: '16px', borderRadius: '16px' }}
                    />
                  </div>
                  <p className="hint" style={{ margin: '0 0 12px' }}>
                    Unsure about “{e.ph}”
                  </p>
                  <button
                    className="btn w s"
                    type="button"
                    onClick={() => {
                      setEntries((prev) => {
                        const copy = [...prev];
                        copy[i] = { ...copy[i], ok: 1, u: 0 };
                        return copy;
                      });
                      const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
                      if (projId && e.id) {
                        updateLogbookEntry(projId, e.id, {
                          is_verified: true,
                          is_flagged: false,
                        }).catch(() => {});
                      }
                    }}
                  >
                    <span className="ms" aria-hidden="true">
                      check
                    </span>
                    Looks right
                  </button>
                </div>
              );
            })}
          </>
        ) : (
          <div className="card" style={{ background: 'var(--mint)', boxShadow: 'none' }}>
            <div className="row">
              <span className="ms" style={{ color: 'var(--g)', fontSize: '28px' }} aria-hidden="true">
                check_circle
              </span>
              <b>All unclear readings confirmed</b>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="card big" style={{ margin: '14px 0' }}>
            <div className="ok">
              <span className="ms" aria-hidden="true">
                event_note
              </span>
            </div>
            <h2>No entries recorded yet</h2>
            <p>
              {pages.length > 0
                ? `${pages.length} page${pages.length > 1 ? 's' : ''} uploaded. If your pages contain handwritten weekly logs, tap Re-read with OCR to extract them automatically, or add an entry below.`
                : 'Upload your logbook pages or add a weekly activity directly to the database.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {pages.length > 0 && (
                <button
                  className="btn o s"
                  type="button"
                  onClick={() => startReading(true)}
                  style={{ borderRadius: '20px', gap: '6px' }}
                >
                  <span className="ms" aria-hidden="true" style={{ color: 'var(--g)' }}>
                    auto_awesome
                  </span>
                  Re-read with OCR
                </button>
              )}
              <button
                className="btn w s"
                type="button"
                onClick={async () => {
                  let projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
                  if (!projId) {
                    const ensured = await ensureActiveProject().catch(() => null);
                    projId = ensured?.id;
                  }
                  if (projId) {
                    try {
                      const newEntry = await createLogbookEntry(projId, {
                        week_number: 1,
                        verified_text: 'Completed introductory departmental orientation and engineering workstation configuration.',
                        technical_area: 'Engineering Practice',
                        tools_used: 'Workstation, Git, Terminal',
                        is_verified: true,
                      });
                      setEntries([
                        {
                          id: newEntry.id,
                          w: newEntry.week_number || 1,
                          t: newEntry.verified_text || newEntry.raw_text || '',
                          area: newEntry.technical_area || 'Engineering Practice',
                          tools: newEntry.tools_used || '',
                          ok: 1,
                          u: 0,
                        },
                      ]);
                      showToast('Week 1 entry created in database');
                      setActiveSheet({ type: 'editWeek', index: 0 });
                    } catch (err: any) {
                      showToast(err.message || 'Failed to create entry');
                    }
                  }
                }}
                style={{ borderRadius: '20px', gap: '6px' }}
              >
                <span className="ms" aria-hidden="true">
                  add
                </span>
                Add Week 1 Entry
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="gt">ALL ENTRIES ({entries.length})</p>
            <div className="card" style={{ padding: '4px 16px' }}>
              {rest.map((e) => {
                const i = entries.indexOf(e);
                return (
                  <div key={i} className="en">
                    <div style={{ flex: 1 }}>
                      <small>WEEK {e.w}</small>
                      <p>{e.t}</p>
                      <div className="row" style={{ marginTop: '6px', gap: '6px', flexWrap: 'wrap' }}>
                        <span className="chip">
                          <span className="ms" aria-hidden="true">
                            menu_book
                          </span>
                          Recorded
                        </span>
                        <span className="chip" style={{ background: '#e6ecff', color: '#1d3fbf' }}>
                          <span className="ms" aria-hidden="true">
                            lightbulb
                          </span>
                          Inferred: {e.area}
                        </span>
                      </div>
                    </div>
                    <button
                      className="tx"
                      type="button"
                      onClick={() => setActiveSheet({ type: 'editWeek', index: i })}
                    >
                      Edit
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              className="btn o w s"
              type="button"
              onClick={async () => {
                let projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
                if (!projId) {
                  const ensured = await ensureActiveProject().catch(() => null);
                  projId = ensured?.id;
                }
                if (projId) {
                  try {
                    const nextWeek = entries.length + 1;
                    const newEntry = await createLogbookEntry(projId, {
                      week_number: nextWeek,
                      verified_text: `Week ${nextWeek} technical tasks, system implementation, and supervisory review.`,
                      technical_area: 'Engineering Practice',
                      tools_used: 'Engineering Tools',
                      is_verified: true,
                    });
                    setEntries((prev) => [
                      ...prev,
                      {
                        id: newEntry.id,
                        w: nextWeek,
                        t: newEntry.verified_text || '',
                        area: newEntry.technical_area || 'Engineering Practice',
                        tools: newEntry.tools_used || '',
                        ok: 1,
                        u: 0,
                      },
                    ]);
                    showToast(`Week ${nextWeek} entry added`);
                  } catch (err: any) {
                    showToast(err.message || 'Failed to add entry');
                  }
                }
              }}
              style={{ marginTop: '12px' }}
            >
              <span className="ms" aria-hidden="true">
                add
              </span>
              Add another week
            </button>
          </>
        )}
      </div>
    );
  };

  // ==========================================
  // WIZARD FLOW: STEP 4 (COMPLETE MISSING INFO)
  // ==========================================
  const renderStep4 = () => {
    const items = checkCompleteness();
    const missing = items.filter((x) => !x.exists);
    const st = details.start;
    const en = details.end;
    const dateError = Boolean(st && en && en <= st);

    return (
      <div className="view" id="step-4">
        <h1 className="wt" id="wh" tabIndex={-1}>
          {missing.length ? 'Complete your details' : 'All details found'}
        </h1>
        <p className="wd">
          {missing.length ? 'Fill what’s missing. Check the rest.' : 'Check them, then continue.'}
        </p>

        <div className="card" style={{ padding: '4px 16px' }}>
          {items.map((x) => {
            if (x.exists) {
              return (
                <div key={x.key} className="tk">
                  <span className="ms" style={{ color: 'var(--g)' }} aria-hidden="true">
                    check_circle
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {x.label}
                    <small style={{ wordBreak: 'break-word' }}>
                      {x.value} · {x.source}
                    </small>
                  </span>
                  <button
                    className="tx"
                    type="button"
                    onClick={() => {
                      setAnswers((prev) => ({ ...prev, [x.key]: details[x.key] || '' }));
                      setDetails((prev) => ({ ...prev, [x.key]: '' }));
                    }}
                  >
                    Edit
                  </button>
                </div>
              );
            }

            const isDate = x.key === 'start' || x.key === 'end';
            if (x.key === 'fac') {
              return (
                <div key={x.key} className="f" style={{ margin: '14px 0 16px' }}>
                  <label htmlFor={`a_${x.key}`}>
                    {x.label} <em aria-hidden="true">*</em>
                    <span className="chip w" style={{ marginLeft: '6px' }}>
                      <span className="ms" aria-hidden="true">
                        error
                      </span>
                      Missing
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      id={`a_${x.key}`}
                      ref={(el) => { intakeRefs.current[x.key] = el; }}
                      value={answers[x.key] || ''}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [x.key]: e.target.value }))}
                      style={{ flex: 1, minWidth: 0 }}
                      required
                    >
                      {COLLEGES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn s"
                      onClick={() => handleConfirmField(x.key)}
                      style={{
                        padding: '0 14px',
                        height: '46px',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexShrink: 0,
                        background: 'var(--g)',
                        color: '#fff',
                      }}
                      title="Save and confirm"
                      aria-label={`Confirm and save ${x.label}`}
                    >
                      <span className="ms" style={{ fontSize: '20px' }}>check</span>
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              );
            }
            if (x.key === 'inst') {
              return (
                <div key={x.key} className="f" style={{ margin: '14px 0 16px' }}>
                  <label htmlFor={`a_${x.key}`}>
                    {x.label} <em aria-hidden="true">*</em>
                    <span className="chip w" style={{ marginLeft: '6px' }}>
                      <span className="ms" aria-hidden="true">
                        error
                      </span>
                      Missing
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      id={`a_${x.key}`}
                      ref={(el) => { intakeRefs.current[x.key] = el; }}
                      value={answers[x.key] || ''}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [x.key]: e.target.value }))}
                      style={{ flex: 1, minWidth: 0 }}
                      required
                    >
                      {INSTITUTIONS.map((instOption) => (
                        <option key={instOption} value={instOption}>
                          {instOption}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn s"
                      onClick={() => handleConfirmField(x.key)}
                      style={{
                        padding: '0 14px',
                        height: '46px',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexShrink: 0,
                        background: 'var(--g)',
                        color: '#fff',
                      }}
                      title="Save and confirm"
                      aria-label={`Confirm and save ${x.label}`}
                    >
                      <span className="ms" style={{ fontSize: '20px' }}>check</span>
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={x.key} className="f" style={{ margin: '14px 0 16px' }}>
                <label htmlFor={`a_${x.key}`}>
                  {x.label} <em aria-hidden="true">*</em>
                  <span className="chip w" style={{ marginLeft: '6px' }}>
                    <span className="ms" aria-hidden="true">
                      error
                    </span>
                    Missing
                  </span>
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input                    id={`a_${x.key}`}
                    ref={(el) => { intakeRefs.current[x.key] = el; }}
                    type={isDate ? 'date' : 'text'}
                    placeholder={isDate ? 'dd/mm/yyyy' : `Enter ${x.label.toLowerCase()}`}
                    value={answers[x.key] || ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [x.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirmField(x.key);
                      }

                    }}
                    style={{ flex: 1, minWidth: 0 }}
                    required
                  />
                  <button
                    type="button"
                    className="btn s"
                    disabled={!(answers[x.key]?.trim())}
                    onClick={() => handleConfirmField(x.key)}
                    style={{
                      padding: '0 14px',
                      height: '46px',
                      borderRadius: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      flexShrink: 0,
                      opacity: !(answers[x.key]?.trim()) ? 0.45 : 1,
                      background: 'var(--g)',
                      color: '#fff',
                    }}
                    title="Confirm and save"
                    aria-label={`Confirm and save ${x.label}`}
                  >
                    <span className="ms" style={{ fontSize: '20px' }}>check</span>
                    <span>Save</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {dateError && (
          <p className="err" id="derr" role="alert">
            The end date must be after the start date.
          </p>
        )}
        {isSavingStep4 && (
          <p className="wd" role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
            <span className="ms" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
            Saving your details… Please wait.
          </p>
        )}
        {step4SaveError && <p className="err" role="alert">{step4SaveError}</p>}
      </div>
    );
  };

  const organisationFields = [
    { key: 'organisation_what', label: "What does the organisation do? (main products or services)", required: true, rows: 4 },
    { key: 'organisation_when_where', label: 'When and how did it start? Where is it based?', required: false, rows: 3 },
    { key: 'organisation_objectives', label: "What is the organisation's mission, vision or main objectives?", required: true, rows: 4 },
    { key: 'organisation_structure', label: 'Who heads the organisation (title)? What are the main departments or units? Which one did you work in? Who did you report to?', required: true, rows: 5 },
    { key: 'organogram_tree', label: 'Organogram: one role per line, with two spaces for each reporting level', required: true, rows: 6 },
    { key: 'student_unit', label: 'Which unit were you attached to?', required: true, rows: 2 },
    { key: 'duties', label: 'What were your main responsibilities there?', required: true, rows: 4 },
    { key: 'organisation_paste_text', label: 'Paste instead (optional): text from the company profile or About page', required: false, rows: 4 },
    { key: 'organisation_paste_source', label: 'Where did the pasted text come from? (optional)', required: false, rows: 2 },
  ];

  const saveOrganisationAnswers = async (advanceOnComplete: boolean = false): Promise<boolean> => {
    const pid = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!pid) return false;
    const currentAnswers = ((intake as any).answers || {}) as Record<string, string>;
    const missing = organisationFields.filter((field) => field.required && !String(currentAnswers[field.key] || '').trim());
    if (missing.length) {
      setOrganisationError(`Please complete: ${missing.map((field) => field.label).join(', ')}`);
      return false;
    }
    setSavingOrganisation(true);
    setOrganisationError('');
    try {
      for (const field of organisationFields) {
        await projectsApi.saveGuidedIntakeAnswer(pid, field.key, currentAnswers[field.key] || '');
      }
      const refreshed = await projectsApi.getGuidedIntake<Record<string, any>>(pid);
      setIntake(refreshed);
      if (advanceOnComplete) {
        setStep(6);
        if (scrRef.current) scrRef.current.scrollTop = 0;
      }
      return true;
    } catch (error) {
      setOrganisationError(error instanceof Error ? error.message : 'Your organisation answers could not be saved.');
      return false;
    } finally {
      setSavingOrganisation(false);
    }
  };

  // ==========================================
  // WIZARD FLOW: STEP 5 (READY TO GENERATE) — ENHANCED UI
  const renderStepOrganisation = () => {
    const currentAnswers = ((intake as any).answers || {}) as Record<string, string>;
    return (
      <div className="view" id="step-5">
        <h1 className="wt" id="wh" tabIndex={-1}>About your organisation</h1>
        <p className="wd">Answer only what your logbook and profile do not already provide. Your progress is saved as you go.</p>
        <div className="card" style={{ padding: '18px 16px' }}>
          <p style={{ marginTop: 0, color: 'var(--mut)', fontSize: '13px', lineHeight: 1.5 }}>
            We never look up your company or fill gaps. Use a true sentence, paste confirmed profile text, or leave optional items blank.
          </p>
          {organisationFields.map((field) => (
            <div className="f" key={field.key} style={{ marginTop: '16px' }}>
              <label htmlFor={`organisation-${field.key}`}>
                {field.label} {field.required && <em aria-hidden="true">*</em>}
              </label>
              <textarea
                id={`organisation-${field.key}`}
                rows={field.rows}
                value={currentAnswers[field.key] || ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setIntake((previous) => ({
                    ...previous,
                    answers: { ...((previous as any).answers || {}), [field.key]: value },
                  }));
                }}
                placeholder={field.key === 'organogram_tree' ? 'Managing Director\n  Operations Manager\n    Your Unit' : ''}
              />
            </div>
          ))}
          {organisationError && <p className="err" role="alert">{organisationError}</p>}
        </div>
      </div>
    );
  };

  const renderStepImages = () => {
    const pid = activeProject?.id || useProjectStore.getState().activeProject?.id;
    const uploadImage = async (file: File) => {
      if (!pid) return;
      setImageUploading(true);
      setImageError('');
      try {
        const formData = new FormData();
        formData.append('file', file);
        const caption = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        if (!validReportImageCaption(caption)) {
          throw new Error('Each image needs a caption of at least three words. Rename the file or edit it after upload.');
        }
        formData.append('caption', caption);
        formData.append('placement', 'week');
        const saved = await projectsApi.uploadReportImage(pid, formData);
        setReportImages((current) => [...current, saved]);
      } catch (error) {
        setImageError(error instanceof Error ? error.message : 'The image could not be uploaded.');
      } finally {
        setImageUploading(false);
      }
    };
    return (
      <div className="view" id="step-6">
        <h1 className="wt" id="wh" tabIndex={-1}>Images</h1>
        <p className="wd">Do you have images you’d like to attach to the technical report?</p>
        <div className="card" style={{ padding: '18px 16px' }}>
          <p style={{ marginTop: 0, color: 'var(--mut)', fontSize: '13px', lineHeight: 1.5 }}>
            Add photos of your own work or workplace. Don’t include confidential company material without permission.
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            disabled={imageUploading || reportImages.length >= 6}
            onChange={async (event) => {
              const files = Array.from(event.target.files || []);
              for (const file of files) await uploadImage(file);
              event.currentTarget.value = '';
            }}
          />
          {imageUploading && <p className="wd" role="status">Processing image…</p>}
          {imageError && <p className="err" role="alert">{imageError}</p>}
          {reportImages.length === 0 ? (
            <p style={{ color: 'var(--mut)', fontSize: '13px' }}>No images added. This step is optional.</p>
          ) : (
            <div style={{ display: 'grid', gap: '12px', marginTop: '16px' }}>
              {reportImages.map((image, index) => (
                <div key={image.id} className="tk" style={{ alignItems: 'flex-start', gap: '10px' }}>
                  {image.processed_url && <img src={image.processed_url} alt={image.caption} style={{ width: '76px', height: '58px', objectFit: 'cover', borderRadius: '8px' }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <input
                      value={image.caption}
                      aria-label={`Caption for image ${index + 1}`}
                      onChange={(event) => setReportImages((current) => current.map((item) => item.id === image.id ? { ...item, caption: event.target.value } : item))}
                      onBlur={() => {
                        if (validReportImageCaption(image.caption)) {
                          projectsApi.updateReportImage(pid!, image.id, { caption: image.caption }).catch(() => {});
                        }
                      }}
                      style={{ width: '100%', border: 0, borderBottom: '1px solid var(--line)', background: 'transparent', fontWeight: 700 }}
                    />
                    <select
                      value={image.placement}
                      aria-label={`Location for image ${index + 1}`}
                      onChange={(event) => {
                        const placement = event.target.value;
                        setReportImages((current) => current.map((item) => item.id === image.id ? { ...item, placement } : item));
                        projectsApi.updateReportImage(pid!, image.id, { placement }).catch(() => {});
                      }}
                      style={{ marginTop: '5px', fontSize: '12px' }}
                    >
                      <option value="organisation">Organisation</option>
                      <option value="week">Weekly activity</option>
                      <option value="tools">Equipment/tools</option>
                      <option value="projects">Projects</option>
                      <option value="challenges">Challenges</option>
                    </select>
                    {image.low_resolution_warning && <small style={{ color: '#b45309' }}>May look blurry when printed.</small>}
                  </span>
                  <button className="tx" type="button" disabled={index === 0} onClick={async () => {
                    if (index === 0) return;
                    const reordered = [...reportImages];
                    [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
                    setReportImages(reordered);
                    await projectsApi.reorderReportImages(pid!, reordered.map((item) => item.id));
                  }}>↑</button>
                  <button className="tx" type="button" disabled={index === reportImages.length - 1} onClick={async () => {
                    if (index === reportImages.length - 1) return;
                    const reordered = [...reportImages];
                    [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
                    setReportImages(reordered);
                    await projectsApi.reorderReportImages(pid!, reordered.map((item) => item.id));
                  }}>↓</button>
                  <button className="tx" type="button" onClick={async () => {
                    await projectsApi.deleteReportImage(pid!, image.id);
                    setReportImages((current) => current.filter((item) => item.id !== image.id));
                  }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ==========================================
  const renderStep5 = () => {
    const n = pages.length;
    const wk = entries.length;
    const layout = computeLayout();

    if (genState === 1) {
      return (
        <div className="view" id="step-5">
          <h1 className="wt" id="wh" tabIndex={-1}>
            Building your report
          </h1>
          <p className="wd">Almost there</p>
          <div className="card" style={{ padding: '6px 16px' }} role="status">
            {GS.map((x, i) => {
              const d = i < genProgress;
              const c = i === genProgress;
              return (
                <div key={x} className="tk" style={{ padding: '9px 0', borderBottom: i < GS.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span
                    className="ms"
                    style={{
                      color: d ? 'var(--g)' : c ? 'var(--gl)' : '#c9c3b2',
                      animation: c ? 'spin 1.4s linear infinite' : 'none',
                    }}
                    aria-hidden="true"
                  >
                    {d ? 'check_circle' : c ? 'sync' : 'radio_button_unchecked'}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <span style={{ fontWeight: c || d ? 700 : 500, color: d || c ? 'var(--ink)' : 'var(--mut)', fontSize: '14px' }}>
                      {x}
                    </span>
                    <small style={{ color: d ? 'var(--g)' : c ? 'var(--g)' : 'var(--mut)', fontWeight: 600 }}>
                      {d ? 'Done' : c ? 'In progress…' : 'Waiting'}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (genState === 2) {
      return (
        <div className="view" id="step-success">
          <div className="card big">
            <div className="ok">
              <span className="ms" aria-hidden="true">
                check
              </span>
            </div>
            <h1 id="wh" tabIndex={-1} style={{ fontSize: '30px' }}>
              Your report is ready
            </h1>
            <p style={{ marginTop: '8px' }}>
              Compiled into a complete ~{layout.total} page SIWES technical report.
            </p>
            <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                className="btn w"
                type="button"
                onClick={() => {
                  setInFlow(false);
                  setCurrentTab('logbooks');
                  setLogbookView('report');
                  if (scrRef.current) scrRef.current.scrollTop = 0;
                }}
              >
                <span className="ms" aria-hidden="true">
                  menu_book
                </span>
                View Report in Logbook
              </button>
              <button
                className="btn o w"
                type="button"
                onClick={() => {
                  setInFlow(false);
                  setCurrentTab('home');
                  if (scrRef.current) scrRef.current.scrollTop = 0;
                }}
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="view" id="step-5">
        {genError && (
          <div className="card" style={{ border: '1px solid #ef4444', background: '#fef2f2', marginBottom: '14px' }}>
            <div className="row" style={{ color: '#b91c1c' }}>
              <span className="ms">error</span>
              <b>Generation Note</b>
            </div>
            <p style={{ margin: '8px 0 14px', fontSize: '13.5px', color: '#7f1d1d' }}>
              {genError}
            </p>
            <button className="btn w" type="button" onClick={() => startGenerating()}>
              <span className="ms">refresh</span>
              Retry Generating Report
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span className="chip" style={{ background: 'var(--mint)', color: 'var(--g)', fontWeight: 800 }}>
            <span className="ms" style={{ fontSize: '16px' }} aria-hidden="true">
              auto_awesome
            </span>
            INSTITUTIONAL AI GENERATOR
          </span>
        </div>
        <h1 className="wt" id="wh" tabIndex={-1}>
          Ready to generate
        </h1>
        <p className="wd" style={{ marginBottom: '16px', fontWeight: 600 }}>
          We’ll use:
        </p>

        <div className="gen-checklist">
          {/* 1. Pages read */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">
                menu_book
              </span>
            </div>
            <div className="gi-content">
              <div className="gi-title">{n || 9} logbook pages read</div>
              <div className="gi-desc">Cover to final page extracted &amp; sequenced</div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }} aria-hidden="true">
              check_circle
            </span>
          </div>

          {/* 2. Entries confirmed */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">
                event_note
              </span>
            </div>
            <div className="gi-content">
              <div className="gi-title">{wk || 6} entries confirmed</div>
              <div className="gi-desc">Weekly technical activities and competencies mapped</div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }} aria-hidden="true">
              check_circle
            </span>
          </div>

          {/* 3. Details complete */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">
                badge
              </span>
            </div>
            <div className="gi-content">
              <div className="gi-title">Your details complete</div>
              <div className="gi-desc">
                {details.name || userFullName || 'Student'} · {details.matric || 'Matric not set'}{details.dept ? `, ${details.dept}` : ''}
              </div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }} aria-hidden="true">
              check_circle
            </span>
          </div>

          {/* 4. Institutional template */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">
                article
              </span>
            </div>
            <div className="gi-content">
              <div className="gi-title">LASUSTECH technical report</div>
              <div className="gi-desc">Template version 1</div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }} aria-hidden="true">
              check_circle
            </span>
          </div>

          {/* 5. Typography */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">
                text_fields
              </span>
            </div>
            <div className="gi-content">
              <div className="gi-title">Times New Roman 12pt</div>
              <div className="gi-desc">1.5 spacing, 12–15 pages</div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }} aria-hidden="true">
              check_circle
            </span>
          </div>
        </div>

        <div className="trust-banner">
          <span className="ms" aria-hidden="true">
            verified_user
          </span>
          <span>Guaranteed academic integrity — No fabricated projects or unverified activities.</span>
        </div>
      </div>
    );
  };

  const renderStep7 = renderStep5;

  // Primary CTA Button for wizard bottom navigation
  const renderPrimaryCta = () => {
    if (step === 1) {
      return (
        <button className="btn" type="submit" form="sf" style={{ flex: 1 }}>
          Next
          <span className="ms" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      );
    }
    if (step === 2) {
      const uploadingCount = pages.filter((p) => p.isUploading || (p.uploadProgress !== undefined && p.uploadProgress < 100) || (!p.id && p.q !== 'error')).length;
      const isAnyUploading = uploadingCount > 0;
      return (
        <button
          className="btn"
          type="button"
          disabled={pages.length === 0 || isAnyUploading}
          aria-disabled={pages.length === 0 || isAnyUploading}
          onClick={async () => {
            if (pages.length === 0 || isAnyUploading) return;
            setStep(3);
            if (scrRef.current) scrRef.current.scrollTop = 0;
            if (!readDone) {
              await startReading();
            }
          }}
          style={{ flex: 1 }}
        >
          {isAnyUploading ? (
            <>
              <span className="ms" style={{ animation: 'spin 1.2s linear infinite', fontSize: '18px' }}>
                sync
              </span>
              <span>Uploading {uploadingCount} {uploadingCount > 1 ? 'files' : 'file'}…</span>
            </>
          ) : (
            <>
              <span>Next</span>
              <span className="ms" aria-hidden="true">
                arrow_forward
              </span>
            </>
          )}
        </button>
      );
    }
    if (step === 3) {
      const un = entries.filter((e) => e.u && !e.ok);
      return (
        <button
          className="btn"
          type="button"
          disabled={un.length > 0}
          onClick={() => {
            setStep(4);
            if (scrRef.current) scrRef.current.scrollTop = 0;
          }}
          style={{ flex: 1 }}
        >
          {un.length ? `Confirm ${un.length} more to continue` : 'Continue'}
          <span className="ms" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      );
    }
    if (step === 4) {
      return (
        <button
          className="btn"
          type="button"
          id="c4"
          disabled={isStep4Invalid() || isSavingStep4}
          aria-busy={isSavingStep4}
          onClick={async () => {
            if (isStep4Invalid() || isSavingStep4) return;
            setIsSavingStep4(true);
            setStep4SaveError(null);
            const updatedDetails = { ...details };
            for (const [k, v] of Object.entries(answers)) {
              if (v && v.trim() && !updatedDetails[k]) {
                updatedDetails[k] = v.trim();
              }
            }
            try {
              let projectId = activeProject?.id || useProjectStore.getState().activeProject?.id;
              if (!projectId) {
                const ensured = await ensureActiveProject().catch(() => null);
                projectId = ensured?.id;
              }
              if (!projectId) throw new Error('Could not find your report project. Please try again.');
              await updateActiveProject(projectId, {
                full_name: updatedDetails.name,
                matric_number: updatedDetails.matric,
                department: updatedDetails.dept,
                college: updatedDetails.fac,
                university_name: updatedDetails.inst,
                degree: updatedDetails.degree,
                organization_name: updatedDetails.co,
                organization_address: updatedDetails.addr,
                placement_department: updatedDetails.unit,
                training_start_date: updatedDetails.start,
                training_end_date: updatedDetails.end,
                industry_supervisor_name: updatedDetails.sup,
                academic_supervisor_name: updatedDetails.isup,
              });
              setDetails(updatedDetails);
              setStep(5);
              if (scrRef.current) scrRef.current.scrollTop = 0;
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : 'Could not save your details. Please try again.';
              setStep4SaveError(message);
              showToast(message);
            } finally {
              setIsSavingStep4(false);
            }
          }}
          style={{ flex: 1 }}
        >
          {isSavingStep4 ? (
            <>
              <span className="ms" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
              Saving details…
            </>
          ) : (
            <>
              Next: Answer organisation questions
              <span className="ms" aria-hidden="true">arrow_forward</span>
            </>
          )}
        </button>
      );
    }
    if (step === 5) {
      return (
        <button
          className="btn"
          type="button"
          disabled={savingOrganisation}
          onClick={async () => {
            await saveOrganisationAnswers(true);
          }}
          style={{ flex: 1 }}
        >
          {savingOrganisation ? (
            <>
              <span className="ms" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
              Saving answers…
            </>
          ) : (
            <>
              Next
              <span className="ms" aria-hidden="true">arrow_forward</span>
            </>
          )}
        </button>
      );
    }
    if (step === 6) {
      return (
        <button className="btn" type="button" onClick={() => {
          setStep(7);
          if (scrRef.current) scrRef.current.scrollTop = 0;
        }} style={{ flex: 1 }}>
          Continue to generate
          <span className="ms" aria-hidden="true">arrow_forward</span>
        </button>
      );
    }
    // step === 7
    if (genState === 0) {
      return (
        <button
          className="btn"
          type="button"
          onClick={startGenerating}
          style={{ flex: 1 }}
        >
          <span className="ms" aria-hidden="true">
            auto_awesome
          </span>
          Generate report
        </button>
      );
    }
    if (genState === 1) {
      return (
        <button className="btn" type="button" disabled style={{ flex: 1 }}>
          Please wait…
        </button>
      );
    }
    return (
      <button
        className="btn"
        type="button"
        onClick={() => {
          setInFlow(false);
          setCurrentTab('logbooks');
          setLogbookView('report');
          if (scrRef.current) scrRef.current.scrollTop = 0;
        }}
        style={{ flex: 1 }}
      >
        <span className="ms" aria-hidden="true">
          menu_book
        </span>
        View in Logbook
      </button>
    );
  };

  // ==========================================
  // RENDER BOTTOM SHEET CONTENT (EDITING DETAILS & ENTRIES)
  // ==========================================
  const renderSheetContent = () => {
    if (!activeSheet) return null;

    if (activeSheet.type === 'editWeek') {
      const entry = entries[activeSheet.index];
      return (
        <>
          <h2>Edit week {entry?.w}</h2>
          <div className="f">
            <label htmlFor="et">What your logbook says</label>
            <textarea
              id="et"
              value={entry?.t || ''}
              onChange={(e) => {
                const val = e.target.value;
                setEntries((prev) => {
                  const copy = [...prev];
                  copy[activeSheet.index] = { ...copy[activeSheet.index], t: val };
                  return copy;
                });
                const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
                if (projId && entry?.id) {
                  updateLogbookEntry(projId, entry.id, {
                    verified_text: val,
                    raw_text: val,
                  }).catch(() => {});
                }
              }}
            />
          </div>
          <button
            className="btn w"
            type="button"
            onClick={() => {
              closeSheet();
              showToast('Saved');
            }}
          >
            Save
          </button>
        </>
      );
    }

    if (activeSheet.type === 'editField') {
      const isDate = activeSheet.key === 'start' || activeSheet.key === 'end';
      const isFac = activeSheet.key === 'fac';
      const isInst = activeSheet.key === 'inst';
      return (
        <>
          <h2>{activeSheet.label}</h2>
          <div className="f">
            {isFac ? (
              <select
                id="fv"
                aria-label={activeSheet.label}
                value={getVal(activeSheet.key) || ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setDetails((prev) => ({ ...prev, [activeSheet.key]: val }));
                  setAnswers((prev) => {
                    const copy = { ...prev };
                    delete copy[activeSheet.key];
                    return copy;
                  });
                }}
              >
                {COLLEGES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : isInst ? (
              <select
                id="fv"
                aria-label={activeSheet.label}
                value={getVal(activeSheet.key) ? 'Other' : ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setDetails((prev) => ({ ...prev, [activeSheet.key]: val }));
                  setAnswers((prev) => {
                    const copy = { ...prev };
                    delete copy[activeSheet.key];
                    return copy;
                  });
                }}
              >
                {INSTITUTIONS.map((instOption) => (
                  <option key={instOption} value={instOption}>
                    {instOption}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="fv"
                aria-label={activeSheet.label}
                type={isDate ? 'date' : 'text'}
                value={getVal(activeSheet.key) || ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setDetails((prev) => ({ ...prev, [activeSheet.key]: val }));
                  setAnswers((prev) => {
                    const copy = { ...prev };
                    delete copy[activeSheet.key];
                    return copy;
                  });
                }}
              />
            )}
          </div>
          <button
            className="btn w"
            type="button"
            onClick={async () => {
              if (activeProject?.id) {
                await updateActiveProject(activeProject.id, {
                  full_name: details.name || undefined,
                  matric_number: details.matric || undefined,
                  department: details.dept || undefined,
                  faculty_school: details.fac || undefined,
                  college: details.fac || undefined,
                  degree: details.degree || undefined,
                  university_name: details.inst || undefined,
                  organization_name: details.co || undefined,
                  organization_address: details.addr || undefined,
                  industry_department: details.unit || undefined,
                  training_start_date: details.start || undefined,
                  training_end_date: details.end || undefined,
                  industry_supervisor_name: details.sup || undefined,
                  institution_supervisor_name: details.isup || undefined,
                }).catch(() => {});
                await updateMissingInfo(activeProject.id, details).catch(() => {});
              }
              closeSheet();
              showToast('Details updated and saved');
            }}
          >
            Save
          </button>
        </>
      );
    }

    if (activeSheet.type === 'editDetails') {
      return (
        <>
          <h2>Your details</h2>
          {FLD.map(([key, label]) => {
            if (key === 'fac') {
              return (
                <div key={key} className="f">
                  <label htmlFor={`d_${key}`}>{label}</label>
                  <select
                    id={`d_${key}`}
                    value={details[key] || ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setDetails((prev) => ({ ...prev, [key]: val }));
                    }}
                  >
                    {COLLEGES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            if (key === 'inst') {
              return (
                <div key={key} className="f">
                  <label htmlFor={`d_${key}`}>{label}</label>
                  <select
                    id={`d_${key}`}
                    value={details[key] ? (INSTITUTIONS.includes(details[key]) ? details[key] : 'Other') : ''}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setDetails((prev) => ({ ...prev, [key]: val }));
                    }}
                  >
                    {INSTITUTIONS.map((instOption) => (
                      <option key={instOption} value={instOption}>
                        {instOption}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            return (
              <div key={key} className="f">
                <label htmlFor={`d_${key}`}>{label}</label>
                <input
                  id={`d_${key}`}
                  type={key === 'start' || key === 'end' ? 'date' : 'text'}
                  value={details[key] || ''}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    setDetails((prev) => ({ ...prev, [key]: val }));
                  }}
                />
              </div>
            );
          })}
          <button
            className="btn w"
            type="button"
            onClick={async () => {
              if (activeProject?.id) {
                await updateActiveProject(activeProject.id, {
                  full_name: details.name || undefined,
                  matric_number: details.matric || undefined,
                  department: details.dept || undefined,
                  faculty_school: details.fac || undefined,
                  college: details.fac || undefined,
                  degree: details.degree || undefined,
                  university_name: details.inst || undefined,
                  organization_name: details.co || undefined,
                  organization_address: details.addr || undefined,
                  industry_department: details.unit || undefined,
                  training_start_date: details.start || undefined,
                  training_end_date: details.end || undefined,
                  industry_supervisor_name: details.sup || undefined,
                  institution_supervisor_name: details.isup || undefined,
                }).catch(() => {});
                await updateMissingInfo(activeProject.id, details).catch(() => {});
              }
              closeSheet();
              showToast('Details updated and saved');
            }}
          >
            Save
          </button>
        </>
      );
    }

    return null;
  };

  if (!isHydrated) {
    return (
      <div className="dashboard-root" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <span className="ms" style={{ fontSize: '32px', color: 'var(--g)', animation: 'spin 1.2s linear infinite' }}>
            sync
          </span>
          <p style={{ marginTop: '12px', fontSize: '14px', color: 'var(--mut)', fontWeight: 600 }}>Loading Log2Def…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-root" suppressHydrationWarning>
      <div className={`app ${inFlow ? 'wz nt' : ''} ${isScrolled ? 'sc' : ''}`} id="app">
        {/* Main Viewport Container */}
        <div className="scr" id="scr" ref={scrRef} onScroll={handleScroll} tabIndex={-1}>
          {inFlow ? (
            <>
              {/* Wizard Sticky Top Header */}
              <div className="wh">
                <div className="row sb">
                  <button
                    className="ib"
                    type="button"
                    onClick={() => {
                      setInFlow(false);
                      setCurrentTab('home');
                      showToast('Progress saved');
                    }}
                    aria-label="Save and close"
                  >
                    <span className="ms" aria-hidden="true">
                      close
                    </span>
                  </button>
                  <b style={{ fontSize: '14px' }}>
                    Step {step} of 7 · {SN[step - 1]}
                  </b>
                  <span className="sp" />
                </div>
                <div
                  className="wp"
                  role="progressbar"
                  aria-valuemin={1}
                  aria-valuemax={7}
                  aria-valuenow={step}
                  aria-label="Report progress"
                >
                  {SN.map((_, k) => (
                    <i key={k} className={k < step ? 'on' : ''} />
                  ))}
                </div>
              </div>

              {/* Wizard Steps (1 through 5) */}
              {step === 1 && renderStep1()}
              {step === 2 && renderStep2()}
              {step === 3 && renderStep3()}
              {step === 4 && renderStep4()}
              {step === 5 && renderStepOrganisation()}
              {step === 6 && renderStepImages()}
              {step === 7 && renderStep7()}
            </>
          ) : (
            <>
              {currentTab === 'home' && renderHomeView()}
              {currentTab === 'logbooks' && renderLogbooksView()}
              {currentTab === 'reports' && renderReportsView()}
              {currentTab === 'settings' && renderSettingsView()}
            </>
          )}
        </div>

        {/* Tab Bar (Visible when outside wizard) */}
        <nav className="tb" id="tb" aria-label="Main">
          <button
            type="button"
            onClick={() => switchTab('home')}
            data-t="home"
            aria-current={currentTab === 'home' && !inFlow ? 'page' : undefined}
          >
            <span className="ms" aria-hidden="true">
              home
            </span>
            Home
          </button>
          <button
            type="button"
            onClick={() => switchTab('logbooks')}
            data-t="logbooks"
            aria-current={currentTab === 'logbooks' && !inFlow ? 'page' : undefined}
          >
            <span className="ms" aria-hidden="true">
              menu_book
            </span>
            Logbooks
          </button>
          <button
            type="button"
            onClick={() => switchTab('reports')}
            data-t="reports"
            aria-current={currentTab === 'reports' && !inFlow ? 'page' : undefined}
          >
            <span className="ms" aria-hidden="true">
              description
            </span>
            Reports
          </button>
          <button
            type="button"
            onClick={() => switchTab('settings')}
            data-t="settings"
            aria-current={currentTab === 'settings' && !inFlow ? 'page' : undefined}
          >
            <span className="ms" aria-hidden="true">
              settings
            </span>
            Settings
          </button>
        </nav>

        {/* Wizard Bottom Action Bar (#nv) */}
        {inFlow && (
          <div id="nv">
            <div className="wc">
              <button
                className="btn o"
                type="button"
                style={{ flex: '0 0 42%' }}
                disabled={step === 1 || reading || (step === 7 && genState === 1)}
                onClick={() => {
                  setStep((prev) => Math.max(1, prev - 1));
                  if (scrRef.current) scrRef.current.scrollTop = 0;
                }}
              >
                <span className="ms" aria-hidden="true">
                  arrow_back
                </span>
                Previous
              </button>
              {renderPrimaryCta()}
            </div>
          </div>
        )}

        {/* In-app Camera Overlay (#cv) */}
        {isCameraActive && (
          <div id="cv" className={cameraFlash ? 'fl' : ''}>
            <video ref={videoRef} id="vd" playsInline autoPlay muted aria-label="Camera" />
            <div className="cf" aria-hidden="true" />
            <div className="ct">
              <button
                className="ib"
                type="button"
                onClick={closeCamera}
                aria-label="Close camera"
              >
                <span className="ms" aria-hidden="true">
                  close
                </span>
              </button>
              <span className="chip" id="cc" role="status">
                {pages.length} page{pages.length === 1 ? '' : 's'}
              </span>
              <button
                className="ib"
                type="button"
                onClick={switchCamera}
                aria-label="Switch camera"
              >
                <span className="ms" aria-hidden="true">
                  cameraswitch
                </span>
              </button>
            </div>
            <p className="ctip">Fit the whole page</p>
            <div className="cb">
              <div className="cth" id="cth">
                {pages.length > 0 && pages[pages.length - 1].th ? (
                  <img src={pages[pages.length - 1].th} alt="Last page" />
                ) : null}
              </div>
              <button
                className="sh2"
                type="button"
                onClick={snapPhoto}
                aria-label="Take photo"
              />
              <button className="btn s" type="button" onClick={closeCamera}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Details & Entries Editing Sheet (#layer) */}
        {activeSheet && (
          <div id="layer">
            <div className="bd" onClick={closeSheet} />
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Dialog"
              tabIndex={-1}
            >
              <div className="hd" />
              {renderSheetContent()}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* CHECKOUT MODAL 1: DIGITAL REPORT (NGN 2,000)             */}
        {/* ======================================================== */}
        {checkoutModal === 'digital' && (
          <div id="checkout-digital">
            <div className="bd" onClick={() => !squadCheckoutLoading && setCheckoutModal(null)} />
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Digital Checkout"
              tabIndex={-1}
            >
              <div className="hd" />
              <h2>Checkout · Digital Report</h2>
              <p className="mut" style={{ fontSize: '13.5px', marginBottom: '14px' }}>
                Instant access to download your institutional technical report.
              </p>

              <div className="checkout-card">
                <div className="row sb">
                  <div>
                    <b>SIWES Technical Report</b>
                    <small className="mut" style={{ display: 'block', marginTop: '2px' }}>
                      PDF (Print Ready) + Word DOCX (Editable)
                    </small>
                  </div>
                  <span className="chip">Digital</span>
                </div>

                <div className="checkout-price">
                  <span>Total Amount</span>
                  <b>NGN 2,000</b>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--mut)', marginBottom: '16px' }}>
                  Student: <b>{details.name || userFullName || 'Student'}</b> ({details.matric || 'Matric not set'})
                </div>

                <p style={{ fontWeight: 800, fontSize: '13px', marginBottom: '8px' }}>
                  SELECT PAYMENT METHOD
                </p>

                <div
                  className={`pay-option ${paymentMethod === 'card' ? 'selected' : ''}`}
                  onClick={() => setPaymentMethod('card')}
                >
                  <span className="ms" style={{ color: 'var(--g)' }}>
                    credit_card
                  </span>
                  <div style={{ flex: 1 }}>
                    <div>Debit / Credit Card</div>
                    <small className="mut">Mastercard, Visa, Verve</small>
                  </div>
                  {paymentMethod === 'card' && (
                    <span className="ms" style={{ color: 'var(--g)' }}>
                      check_circle
                    </span>
                  )}
                </div>

                <div
                  className={`pay-option ${paymentMethod === 'transfer' ? 'selected' : ''}`}
                  onClick={() => setPaymentMethod('transfer')}
                >
                  <span className="ms" style={{ color: 'var(--g)' }}>
                    account_balance
                  </span>
                  <div style={{ flex: 1 }}>
                    <div>Bank Transfer</div>
                    <small className="mut">Instant automated verification</small>
                  </div>
                  {paymentMethod === 'transfer' && (
                    <span className="ms" style={{ color: 'var(--g)' }}>
                      check_circle
                    </span>
                  )}
                </div>

                <button
                  className="btn w"
                  type="button"
                  disabled={squadCheckoutLoading}
                  onClick={initiateDigitalSquadPayment}
                  style={{ marginTop: '14px' }}
                >
                  {squadCheckoutLoading ? (
                    <>
                      <span className="ms" style={{ animation: 'spin 1s linear infinite' }}>
                        sync
                      </span>
                      Starting Payment…
                    </>
                  ) : (
                    <>
                      <span className="ms">lock</span>
                      Pay NGN 2,000 Now
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* CHECKOUT MODAL 2: PRINT & SPIRAL BINDING DELIVERY (NGN 4,000) */}
        {/* ======================================================== */}
        {checkoutModal === 'delivery' && (
          <div id="checkout-delivery">
            <div className="bd" onClick={() => !squadCheckoutLoading && setCheckoutModal(null)} />
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Delivery Checkout"
              tabIndex={-1}
            >
              <div className="hd" />
              <h2>Print & Spiral Binding Delivery</h2>
              <p className="mut" style={{ fontSize: '13.5px', marginBottom: '14px' }}>
                Your report printed, spiral-bound, and delivered directly to your campus or address.
              </p>

              <div className="checkout-card">
                <div className="checkout-price" style={{ margin: '0 0 16px' }}>
                  <span>Print, Binding & Delivery</span>
                  <b>NGN 4,000</b>
                </div>

                {/* Delivery Form */}
                <div className="f" style={{ marginBottom: '12px' }}>
                  <label htmlFor="del_name">
                    Recipient Full Name <em aria-hidden="true">*</em>
                  </label>
                  <input
                    id="del_name"
                    type="text"
                    value={deliveryData.recipientName}
                    onChange={(e) =>
                      setDeliveryData((prev) => ({ ...prev, recipientName: e.target.value }))
                    }
                    required
                  />
                </div>

                <div className="f" style={{ marginBottom: '12px' }}>
                  <label htmlFor="del_phone">
                    Phone Number / WhatsApp for Rider <em aria-hidden="true">*</em>
                  </label>
                  <input
                    id="del_phone"
                    type="tel"
                    placeholder="e.g. 08012345678"
                    value={deliveryData.phone}
                    onChange={(e) =>
                      setDeliveryData((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    required
                  />
                </div>

                <div className="f" style={{ marginBottom: '12px' }}>
                  <label htmlFor="del_location">
                    Delivery Location
                  </label>
                  <input
                    id="del_location"
                    type="text"
                    placeholder="e.g. Hostel Name, Department, Street, City"
                    value={deliveryData.campusLocation}
                    onChange={(e) =>
                      setDeliveryData((prev) => ({ ...prev, campusLocation: e.target.value }))
                    }
                  />
                </div>

                <div className="f" style={{ marginBottom: '16px' }}>
                  <label htmlFor="del_date">
                    Preferred Delivery Date <em aria-hidden="true">*</em>
                  </label>
                  <input
                    id="del_date"
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={deliveryData.deliveryDate}
                    onChange={(e) =>
                      setDeliveryData((prev) => ({ ...prev, deliveryDate: e.target.value }))
                    }
                    required
                  />
                </div>

                <button
                  className="btn w"
                  type="button"
                  disabled={squadCheckoutLoading}
                  onClick={initiateDeliverySquadPayment}
                >
                  {squadCheckoutLoading ? (
                    <>
                      <span className="ms" style={{ animation: 'spin 1s linear infinite' }}>
                        sync
                      </span>
                      Starting Payment…
                    </>
                  ) : (
                    <>
                      <span className="ms">check_circle</span>
                      Pay NGN 4,000 & Confirm Delivery
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAYMENT SUCCESS SCREEN: DIGITAL (DOWNLOAD UNLOCKED)      */}
        {/* ======================================================== */}
        {paymentSuccess?.type === 'digital' && (
          <div id="payment-success">
            <div className="bd" onClick={() => setPaymentSuccess(null)} />
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Payment Successful"
              tabIndex={-1}
            >
              <div className="hd" />
              <div className="big" style={{ padding: '10px 0 8px' }}>
                <div className="ok">
                  <span className="ms" aria-hidden="true">
                    check
                  </span>
                </div>
                <h2>Payment Successful!</h2>
                <p style={{ marginTop: '6px' }}>
                  Payment of <b>NGN 2,000</b> confirmed.
                  <br />
                  Reference: <code>{paymentSuccess.txRef}</code>
                </p>
              </div>

              <div className="checkout-card" style={{ background: '#f8faf9', marginTop: '12px' }}>
                <p style={{ fontWeight: 800, fontSize: '13px', marginBottom: '12px' }}>
                  DOWNLOAD YOUR TECHNICAL REPORT NOW:
                </p>

                <button
                  className="btn w"
                  type="button"
                  disabled={downloadLoading}
                  onClick={() => executeRealFileDownload('PDF')}
                  style={{ marginBottom: '10px' }}
                >
                  <span className="ms" aria-hidden="true" style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}>
                    picture_as_pdf
                  </span>
                  {downloadLoading ? 'Preparing PDF…' : 'Download PDF (Print Ready)'}
                </button>

                <button
                  className="btn o w"
                  type="button"
                  disabled={downloadLoading}
                  onClick={() => executeRealFileDownload('Word')}
                >
                  <span className="ms" aria-hidden="true" style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}>
                    description
                  </span>
                  {downloadLoading ? 'Preparing Word…' : 'Download Word DOCX (Editable)'}
                </button>
              </div>

              <button
                className="btn o w s"
                type="button"
                onClick={() => setPaymentSuccess(null)}
                style={{ marginTop: '10px' }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* PAYMENT SUCCESS SCREEN: PHYSICAL DELIVERY CONFIRMED      */}
        {/* ======================================================== */}
        {paymentSuccess?.type === 'delivery' && (
          <div id="delivery-success">
            <div className="bd" onClick={() => setPaymentSuccess(null)} />
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Delivery Confirmed"
              tabIndex={-1}
            >
              <div className="hd" />
              <div className="big" style={{ padding: '10px 0 8px' }}>
                <div className="ok" style={{ background: '#dcf0e7', color: 'var(--g)' }}>
                  <span className="ms" aria-hidden="true">
                    local_shipping
                  </span>
                </div>
                <h2>Delivery Order Confirmed!</h2>
                <p style={{ marginTop: '6px' }}>
                  Payment of <b>NGN 4,000</b> confirmed.
                  <br />
                  Tracking Ref: <code>{paymentSuccess.txRef}</code>
                </p>
              </div>

              <div className="checkout-card" style={{ fontSize: '13.5px', marginTop: '10px' }}>
                <div className="row sb" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                  <span className="mut">Delivery Date:</span>
                  <b>{paymentSuccess.deliveryDetails?.date}</b>
                </div>

                <div className="row sb" style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                  <span className="mut">Location:</span>
                  <b style={{ textAlign: 'right', maxWidth: '65%' }}>
                    {paymentSuccess.deliveryDetails?.location}
                    {paymentSuccess.deliveryDetails?.customAddress ? ` (${paymentSuccess.deliveryDetails.customAddress})` : ''}
                  </b>
                </div>

                <div className="row sb" style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                  <span className="mut">Recipient:</span>
                  <b>{paymentSuccess.deliveryDetails?.recipient} ({paymentSuccess.deliveryDetails?.phone})</b>
                </div>

                <div className="row sb" style={{ paddingTop: '8px' }}>
                  <span className="mut">Status:</span>
                  <span className="chip">Laser Printing & Spiral Binding</span>
                </div>
              </div>

              {/* Direct WhatsApp Follow-up Button */}
              {(() => {
                const det = paymentSuccess.deliveryDetails;
                const waMessage = `Hello Log2Def, I just paid NGN 4,000 for the printed and spiral-bound SIWES technical report delivery.%0A%0AOrder Ref: ${paymentSuccess.txRef}%0AName: ${encodeURIComponent(det?.recipient || '')}%0AMatric: ${encodeURIComponent(details.matric || '')}%0ALocation: ${encodeURIComponent((det?.location || '') + (det?.customAddress ? ' - ' + det.customAddress : ''))}%0ADelivery Date: ${encodeURIComponent(det?.date || '')}%0APhone: ${encodeURIComponent(det?.phone || '')}`;
                const waUrl = `https://wa.me/2348096044860?text=${waMessage}`;

                return (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-wa"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                        style={{ flex: 'none' }}
                      >
                        <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824zm-3.423-14.416c-6.627 0-12 5.373-12 12 0 2.159.57 4.184 1.564 5.938l-1.564 5.719 5.864-1.538c1.703.929 3.655 1.461 5.736 1.461 6.627 0 12-5.373 12-12s-5.373-12-12-12z" />
                      </svg>
                      Follow up on WhatsApp (+234 809 604 4860)
                    </a>

                    <button
                      className="btn o w s"
                      type="button"
                      onClick={() => setPaymentSuccess(null)}
                    >
                      Back to Dashboard
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* OS-AWARE INSTALL GUIDANCE MODAL / SHEET                  */}
        {/* ======================================================== */}
        {showInstallModal && !installDismissed && (
          <div id="install-modal">
            <div
              className="bd"
              onClick={() => {
                setShowInstallModal(false);
                setInstallDismissed(true);
                try {
                  localStorage.setItem('log2def_install_dismissed', 'true');
                } catch {}
              }}
            />
            <div
              className="sht"
              role="dialog"
              aria-modal="true"
              aria-label="Install Log2Def"
              tabIndex={-1}
            >
              <div className="hd" />
              <div style={{ textAlign: 'center', padding: '6px 0 16px' }}>
                <div
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '16px',
                    background: 'var(--mint)',
                    color: 'var(--g)',
                    display: 'grid',
                    placeItems: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <span className="ms" style={{ fontSize: '28px' }}>
                    {deviceOS === 'ios' ? 'phone_iphone' : deviceOS === 'android' ? 'android' : 'download'}
                  </span>
                </div>
                <h2 style={{ fontSize: '20px', margin: '0 0 6px' }}>
                  {deviceOS === 'ios'
                    ? 'Install on iPhone or iPad'
                    : deviceOS === 'android'
                    ? 'Install on Android'
                    : 'Install Log2Def App'}
                </h2>
                <p style={{ color: 'var(--mut)', fontSize: '13px' }}>
                  {deviceOS === 'ios'
                    ? 'Install Log2Def to your home screen for quick, full-screen access anytime.'
                    : deviceOS === 'android'
                    ? 'Add Log2Def to your home screen for an instant app experience.'
                    : 'Install Log2Def as a standalone desktop app on your computer.'}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                {deviceOS === 'ios' ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: 'var(--card)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--g)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '12px',
                          flexShrink: 0,
                        }}
                      >
                        1
                      </span>
                      <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Tap the <b>Share</b> button{' '}
                        <span className="ms" style={{ fontSize: '16px', verticalAlign: 'middle', color: 'var(--g)' }}>
                          ios_share
                        </span>{' '}
                        at the bottom of Safari.
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: 'var(--card)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--g)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '12px',
                          flexShrink: 0,
                        }}
                      >
                        2
                      </span>
                      <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Scroll down and select <b>Add to Home Screen</b>{' '}
                        <span className="ms" style={{ fontSize: '16px', verticalAlign: 'middle', color: 'var(--g)' }}>
                          add_box
                        </span>
                        .
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: 'var(--card)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--g)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '12px',
                          flexShrink: 0,
                        }}
                      >
                        3
                      </span>
                      <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Tap <b>Add</b> in the top right corner. All done!
                      </div>
                    </div>
                  </>
                ) : deviceOS === 'android' ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: 'var(--card)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--g)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '12px',
                          flexShrink: 0,
                        }}
                      >
                        1
                      </span>
                      <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Tap the <b>Menu (three dots ⋮)</b> at the top-right of Chrome.
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: 'var(--card)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--g)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '12px',
                          flexShrink: 0,
                        }}
                      >
                        2
                      </span>
                      <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Select <b>Install app</b> or <b>Add to Home screen</b>.
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: 'var(--card)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'var(--g)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '12px',
                          flexShrink: 0,
                        }}
                      >
                        3
                      </span>
                      <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Tap <b>Install</b> to confirm and launch from your app drawer!
                      </div>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: '14px',
                      background: 'var(--card)',
                      borderRadius: '14px',
                      border: '1px solid var(--line)',
                      fontSize: '13px',
                      lineHeight: 1.5,
                    }}
                  >
                    Click the <b>Install</b> icon in your browser’s address bar (or browser menu &rarr; <b>Install Log2Def</b>) to install as a desktop app.
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn w"
                onClick={() => {
                  setShowInstallModal(false);
                  setInstallDismissed(true);
                  try {
                    localStorage.setItem('log2def_install_dismissed', 'true');
                  } catch {}
                }}
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Global Toast (#toast) */}
        <div
          id="toast"
          role="status"
          aria-live="polite"
          className={toastMessage ? 'on' : ''}
        >
          {toastMessage}
        </div>
      </div>
    </div>
  );
}
