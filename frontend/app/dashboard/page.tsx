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
  'Upload logbook',
  'Confirm details',
  'Check reading',
  'About organisation',
  'Your experience',
  'Extras',
  'Ready to generate',
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

const RECOMMENDATION_SUGGESTIONS = [
  'Provide interns with dedicated computing workstations and test environments',
  'Organize structured onboarding sessions on production toolchains and git workflows',
  'Increase practical hands-on project assignments aligned with university curriculum',
  'Strengthen liaison visits between industrial supervisors and university SIWES coordinators',
  'Grant interns expanded access to internal technical documentation and APIs',
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
  bytesUploaded?: number;
  totalBytes?: number;
}

interface LogEntry {
  id?: number;
  w: number;
  t: string;
  activity_summary?: string;
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

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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
    switchProject,
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
    isSwitchingProject,
    switchingProjectId,
    getWorkspaceFromCache,
    setWorkspaceCache,
    clearWorkspaceCache,
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

  const isPro = Boolean(
    activeProject?.tier === 'pro' ||
    activeProject?.is_pro === true ||
    (user as any)?.tier === 'pro'
  );

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
  const [shortDurationConfirmed, setShortDurationConfirmed] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Step 4: Organisation 4-screen flow state
  const [orgScreen, setOrgScreen] = useState<1 | 2 | 3 | 4>(1);
  const [orgWhat, setOrgWhat] = useState<string>('');
  const [orgWhen, setOrgWhen] = useState<string>('');
  const [orgWhere, setOrgWhere] = useState<string>('');
  const [orgObjectives, setOrgObjectives] = useState<string>('');
  const [orgPasteMode, setOrgPasteMode] = useState<boolean>(false);
  const [orgPasteText, setOrgPasteText] = useState<string>('');
  const [orgNotSure, setOrgNotSure] = useState<boolean>(false);
  const [headTitle, setHeadTitle] = useState<string>('');
  const [orgUnits, setOrgUnits] = useState<string[]>(['Technical Department', 'Operations Unit', 'Administration']);
  const [newUnitInput, setNewUnitInput] = useState<string>('');
  const [studentUnit, setStudentUnit] = useState<string>('');
  const [supervisorTitle, setSupervisorTitle] = useState<string>('');
  const [customTreeText, setCustomTreeText] = useState<string>('');
  const [isEditingTree, setIsEditingTree] = useState<boolean>(false);

  // Step 5: Your Experience state
  const [experienceDuties, setExperienceDuties] = useState<string>('');
  const [experienceAdditional, setExperienceAdditional] = useState<string>('');
  const [experienceTools, setExperienceTools] = useState<string[]>(['VS Code', 'Git', 'Linux', 'Python']);
  const [newToolInput, setNewToolInput] = useState<string>('');
  const [challengesNone, setChallengesNone] = useState<boolean>(true);
  const [challengeText, setChallengeText] = useState<string>('');
  const [solutionText, setSolutionText] = useState<string>('');
  const [challenge2Text, setChallenge2Text] = useState<string>('');
  const [solution2Text, setSolution2Text] = useState<string>('');
  const [showSecondPair, setShowSecondPair] = useState<boolean>(false);
  const [selectedRecommendations, setSelectedRecommendations] = useState<string[]>([]);
  const [customRecommendation, setCustomRecommendation] = useState<string>('');

  // Step 6: Extras state (all optional)
  const [dedicationText, setDedicationText] = useState<string>('');
  const [acknowledgementText, setAcknowledgementText] = useState<string>('');

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

  // Multi-report & project management state
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState<boolean>(false);
  const [isCreateReportModalOpen, setIsCreateReportModalOpen] = useState<boolean>(false);
  const [isCreatingReport, setIsCreatingReport] = useState<boolean>(false);
  const [projectToDelete, setProjectToDelete] = useState<any | null>(null);
  const [reportsFilter, setReportsFilter] = useState<'all' | 'ready' | 'in_progress'>('all');
  const [projectSearchQuery, setProjectSearchQuery] = useState<string>('');
  const loadedProjectIdRef = useRef<number | null>(null);
  const switchSequenceRef = useRef<number>(0);
  const isSwitchingRef = useRef<boolean>(false);
  const switchingToIdRef = useRef<number | null>(null);

  // Close project switcher dropdown on Escape key
  useEffect(() => {
    if (!isProjectDropdownOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsProjectDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProjectDropdownOpen]);

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
    if (!pid || isSwitchingRef.current || loadedProjectIdRef.current === pid) return;

    let cancelled = false;
    setIntakeLoading(true);
    if (typeof projectsApi?.getGuidedIntake === 'function') {
      projectsApi.getGuidedIntake(pid)
        .then((data: any) => {
          if (!cancelled) {
            const ans = (data?.answers || data || {}) as Record<string, any>;
            setIntake((prev) => (Object.keys(ans || {}).length ? ans : prev));

            if (ans.organisation_what) setOrgWhat(ans.organisation_what);
            if (ans.organisation_not_sure !== undefined) setOrgNotSure(Boolean(ans.organisation_not_sure));
            if (ans.organisation_when_where) {
              const match = ans.organisation_when_where.match(/^(\d{4})\s*(.*)$/);
              if (match) {
                setOrgWhen(match[1]);
                if (match[2]) setOrgWhere(match[2]);
              } else {
                setOrgWhere(ans.organisation_when_where);
              }
            }
            if (ans.organisation_objectives) setOrgObjectives(ans.organisation_objectives);
            if (ans.organisation_paste_text) {
              setOrgPasteText(ans.organisation_paste_text);
              if (!ans.organisation_objectives || ans.organisation_objectives === ans.organisation_paste_text) {
                setOrgPasteMode(true);
              }
            }
            if (ans.head_title) setHeadTitle(ans.head_title);
            if (Array.isArray(ans.organisation_units) && ans.organisation_units.length > 0) {
              setOrgUnits(ans.organisation_units);
            }
            if (ans.student_unit) setStudentUnit(ans.student_unit);
            if (ans.supervisor_title) setSupervisorTitle(ans.supervisor_title);
            if (ans.organogram_tree) setCustomTreeText(ans.organogram_tree);

            if (ans.duties) setExperienceDuties(ans.duties);
            if (ans.challenge_pairs) {
              setChallengesNone(Boolean(ans.challenge_pairs.none));
              if (Array.isArray(ans.challenge_pairs.pairs) && ans.challenge_pairs.pairs.length > 0) {
                setChallengeText(ans.challenge_pairs.pairs[0].challenge || '');
                setSolutionText(ans.challenge_pairs.pairs[0].solution || '');
                if (ans.challenge_pairs.pairs.length > 1) {
                  setShowSecondPair(true);
                  setChallenge2Text(ans.challenge_pairs.pairs[1].challenge || '');
                  setSolution2Text(ans.challenge_pairs.pairs[1].solution || '');
                }
              }
            }
            if (ans.recommendations) {
              const recLines = ans.recommendations.split('\n').map((s: string) => s.trim()).filter(Boolean);
              setSelectedRecommendations(recLines.filter((l: string) => RECOMMENDATION_SUGGESTIONS.includes(l)));
              const custom = recLines.filter((l: string) => !RECOMMENDATION_SUGGESTIONS.includes(l)).join('\n');
              if (custom) setCustomRecommendation(custom);
            }
            if (ans.dedication) setDedicationText(ans.dedication);
            if (ans.acknowledgement) setAcknowledgementText(ans.acknowledgement);
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
    } else {
      setIntakeLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id]);

  useEffect(() => {
    const pid = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!pid || isSwitchingRef.current || loadedProjectIdRef.current === pid) return;
    if (typeof projectsApi?.getReportImages === 'function') {
      projectsApi.getReportImages(pid)
        .then((items) => setReportImages(items || []))
        .catch(() => setReportImages([]));
    }
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
  const lastSavedDetailsRef = useRef<string>('');
  const lastSavedStep4Ref = useRef<string>('');
  const lastSavedStep5Ref = useRef<string>('');
  const lastSavedStep6Ref = useRef<string>('');

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

  // Sync user info on mount without overwriting active project student particulars
  useEffect(() => {
    if (user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
      if (name) {
        setDetails((prev) => {
          if (prev.name && prev.name !== userFullName) return prev;
          if (activeProject?.full_name) return prev;
          return { ...prev, name };
        });
        setDeliveryData((prev) => ({ ...prev, recipientName: prev.recipientName || name }));
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

  // Zero-bleed workspace state reset: cleanly purges all memory of previous report
  const resetAllWorkspaceState = useCallback(() => {
    setPages([]);
    setEntries([]);
    setGenState(0);
    setGenProgress(0);
    setGenError(null);
    setChapterEdits({});
    resetReportState();
    setIntake({});
    setReportImages([]);
    setReadDone(false);
    setReading(false);
    setReadProgress(0);
    setHasPaidDigital(false);
    setPaymentSuccess(null);
    setShortDurationConfirmed(false);
    setCurrentSectionIdx(0);

    // Reset Step 4 Organisation state
    setOrgScreen(1);
    setOrgWhat('');
    setOrgWhen('');
    setOrgWhere('');
    setOrgObjectives('');
    setOrgPasteMode(false);
    setOrgPasteText('');
    setOrgNotSure(false);
    setHeadTitle('');
    setOrgUnits(['Technical Department', 'Operations Unit', 'Administration']);
    setStudentUnit('');
    setSupervisorTitle('');
    setCustomTreeText('');
    setIsEditingTree(false);

    // Reset Step 5 Experience state
    setExperienceDuties('');
    setExperienceAdditional('');
    setExperienceTools(['VS Code', 'Git', 'Linux', 'Python']);
    setChallengesNone(true);
    setChallengeText('');
    setSolutionText('');
    setChallenge2Text('');
    setSolution2Text('');
    setShowSecondPair(false);
    setSelectedRecommendations([]);
    setCustomRecommendation('');

    // Reset Step 6 Extras state
    setDedicationText('');
    setAcknowledgementText('');

    // Clear autosave dirty check hashes
    lastSavedDetailsRef.current = '';
    lastSavedStep4Ref.current = '';
    lastSavedStep5Ref.current = '';
    lastSavedStep6Ref.current = '';
  }, [resetReportState]);

  // Apply workspace data cleanly into state and synchronize autosave baseline hashes
  const applyWorkspaceData = useCallback(
    (
      freshProj: any,
      entriesData: any[],
      repData: any,
      paymentsData: any[],
      intakeData: any,
      imagesData: any[]
    ) => {
      // 1. Hydrate project details & source documents
      if (freshProj) {
        const loadedDetails = {
          name: freshProj.full_name || '',
          matric: freshProj.matric_number || '',
          dept: freshProj.department || '',
          fac: freshProj.college || freshProj.faculty_school || 'College of Basic Science',
          degree: freshProj.degree || '',
          inst: freshProj.university_name || '',
          co: freshProj.organization_name || '',
          addr: freshProj.organization_address || '',
          unit: freshProj.industry_department || '',
          start: freshProj.training_start_date ? freshProj.training_start_date.slice(0, 10) : '',
          end: freshProj.training_end_date ? freshProj.training_end_date.slice(0, 10) : '',
          sup: freshProj.industry_supervisor_name || '',
          isup: freshProj.institution_supervisor_name || '',
        };
        setDetails(loadedDetails);
        lastSavedDetailsRef.current = JSON.stringify(loadedDetails);

        if (freshProj.source_documents && freshProj.source_documents.length > 0) {
          setPages(
            freshProj.source_documents.map((d: any) => ({
              id: d.id,
              n: d.original_filename || `Page ${d.page_index + 1}`,
              pdf: d.file_type === 'pdf',
              th:
                d.presigned_url ||
                (d.file
                  ? d.file.startsWith('http')
                    ? d.file
                    : `${getApiBaseUrl().replace(/\/api\/?$/, '')}${d.file.startsWith('/') ? '' : '/'}${d.file}`
                  : ''),
              status: d.status,
            }))
          );
          setReadDone(true);
        } else {
          setPages([]);
          setReadDone(false);
        }
      } else {
        setPages([]);
        setReadDone(false);
      }

      // 2. Hydrate logbook entries
      if (entriesData && entriesData.length > 0) {
        setEntries(
          entriesData.map((e: any) => ({
            id: e.id,
            w: e.week_number || 1,
            t: e.verified_text || e.raw_text || e.activity_summary || '',
            area: e.technical_area || 'Practical Engineering',
            tools: e.tools_used || '',
            u:
              e.is_flagged ||
              (e.confidence_scores?.overall !== undefined && e.confidence_scores?.overall < 0.75)
                ? 1
                : 0,
            ph: e.department_unit || 'activity details',
            ok: e.is_verified ? 1 : 0,
          }))
        );
      } else {
        setEntries([]);
      }

      // 3. Hydrate report sections and compiled state
      if (repData && repData.sections && repData.sections.length > 0) {
        const hasContent = repData.sections.some(
          (s: any) => s.content && s.content.trim().length > 20
        );
        if (hasContent) {
          setGenState(2);
          setChapterEdits(mapBackendSectionsToChapters(repData.sections));
        } else {
          setGenState(0);
          setChapterEdits({});
        }
        useReportStore.setState({
          report: repData,
          activeSectionId: repData.sections[0]?.id || null,
          sectionDrafts: repData.sections.reduce((acc: any, s: any) => {
            acc[s.id] = s.content || '';
            return acc;
          }, {}),
          isLoadingReport: false,
        });
      } else {
        setGenState(0);
        setChapterEdits({});
        useReportStore.getState().resetReportState();
      }

      // 4. Hydrate payment orders
      if (paymentsData && paymentsData.length > 0) {
        const isPaid = paymentsData.some((p: any) => p.status === 'paid');
        setHasPaidDigital(isPaid);
        useProjectStore.setState({ payments: paymentsData });
      } else {
        setHasPaidDigital(false);
        useProjectStore.setState({ payments: [] });
      }

      // 5. Hydrate guided intake answers
      if (intakeData) {
        const rawIntake = intakeData as any;
        const ans = (rawIntake?.answers || rawIntake || {}) as Record<string, any>;
        setIntake(ans);
        setOrgWhat(ans.organisation_what || '');
        setOrgNotSure(Boolean(ans.organisation_not_sure));
        if (ans.organisation_when_where) {
          const match = ans.organisation_when_where.match(/^(\d{4})\s*(.*)$/);
          if (match) {
            setOrgWhen(match[1]);
            setOrgWhere(match[2] || '');
          } else {
            setOrgWhen('');
            setOrgWhere(ans.organisation_when_where);
          }
        } else {
          setOrgWhen('');
          setOrgWhere('');
        }
        setOrgObjectives(ans.organisation_objectives || '');
        if (ans.organisation_paste_text) {
          setOrgPasteText(ans.organisation_paste_text);
          if (!ans.organisation_objectives || ans.organisation_objectives === ans.organisation_paste_text) {
            setOrgPasteMode(true);
          } else {
            setOrgPasteMode(false);
          }
        } else {
          setOrgPasteText('');
          setOrgPasteMode(false);
        }
        setHeadTitle(ans.head_title || '');
        if (Array.isArray(ans.organisation_units) && ans.organisation_units.length > 0) {
          setOrgUnits(ans.organisation_units);
        } else {
          setOrgUnits(['Technical Department', 'Operations Unit', 'Administration']);
        }
        setStudentUnit(ans.student_unit || freshProj?.placement_department || '');
        setSupervisorTitle(ans.supervisor_title || freshProj?.industry_supervisor_title || '');
        setCustomTreeText(ans.organogram_tree || '');

        setExperienceDuties(ans.duties || '');
        setExperienceAdditional(ans.additional_experience || '');
        if (ans.tools_used) {
          const tools = ans.tools_used.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (tools.length > 0) setExperienceTools(tools);
        } else if (freshProj?.tools_used) {
          const tools = freshProj.tools_used.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (tools.length > 0) setExperienceTools(tools);
        } else {
          setExperienceTools(['VS Code', 'Git', 'Linux', 'Python']);
        }

        if (ans.challenge_pairs) {
          setChallengesNone(Boolean(ans.challenge_pairs.none));
          if (Array.isArray(ans.challenge_pairs.pairs) && ans.challenge_pairs.pairs.length > 0) {
            setChallengeText(ans.challenge_pairs.pairs[0].challenge || '');
            setSolutionText(ans.challenge_pairs.pairs[0].solution || '');
            if (ans.challenge_pairs.pairs.length > 1) {
              setShowSecondPair(true);
              setChallenge2Text(ans.challenge_pairs.pairs[1].challenge || '');
              setSolution2Text(ans.challenge_pairs.pairs[1].solution || '');
            } else {
              setShowSecondPair(false);
              setChallenge2Text('');
              setSolution2Text('');
            }
          } else {
            setShowSecondPair(false);
            setChallengeText('');
            setSolutionText('');
            setChallenge2Text('');
            setSolution2Text('');
          }
        } else {
          setChallengesNone(true);
          setShowSecondPair(false);
          setChallengeText('');
          setSolutionText('');
          setChallenge2Text('');
          setSolution2Text('');
        }

        if (ans.recommendations) {
          const recLines = ans.recommendations.split('\n').map((s: string) => s.trim()).filter(Boolean);
          setSelectedRecommendations(recLines.filter((l: string) => RECOMMENDATION_SUGGESTIONS.includes(l)));
          const custom = recLines.filter((l: string) => !RECOMMENDATION_SUGGESTIONS.includes(l)).join('\n');
          setCustomRecommendation(custom);
        } else {
          setSelectedRecommendations([]);
          setCustomRecommendation('');
        }

        setDedicationText(ans.dedication || '');
        setAcknowledgementText(ans.acknowledgement || '');

        // Sync autosave refs with the clean loaded answers
        lastSavedStep4Ref.current = JSON.stringify({
          organisation_what: ans.organisation_what || '',
          organisation_not_sure: Boolean(ans.organisation_not_sure),
          organisation_when_where: ans.organisation_when_where || '',
          organisation_objectives: ans.organisation_objectives || '',
          organisation_paste_text: ans.organisation_paste_text || '',
          head_title: ans.head_title || '',
          organisation_units: ans.organisation_units || [],
          student_unit: ans.student_unit || '',
          supervisor_title: ans.supervisor_title || '',
          organogram_tree: ans.organogram_tree || '',
        });
        lastSavedStep5Ref.current = JSON.stringify({
          duties: ans.duties || '',
          additional_experience: ans.additional_experience || '',
          tools_used: ans.tools_used || '',
          challenge_pairs: ans.challenge_pairs || null,
          recommendations: ans.recommendations || '',
        });
        lastSavedStep6Ref.current = JSON.stringify({
          dedication: ans.dedication || '',
          acknowledgement: ans.acknowledgement || '',
        });
      } else {
        setIntake({});
        setOrgWhat('');
        setOrgWhen('');
        setOrgWhere('');
        setOrgObjectives('');
        setOrgPasteMode(false);
        setOrgPasteText('');
        setOrgNotSure(false);
        setHeadTitle('');
        setOrgUnits(['Technical Department', 'Operations Unit', 'Administration']);
        setStudentUnit(freshProj?.placement_department || '');
        setSupervisorTitle(freshProj?.industry_supervisor_title || '');
        setCustomTreeText('');
        setIsEditingTree(false);
        setExperienceDuties('');
        setExperienceAdditional('');
        if (freshProj?.tools_used) {
          const tools = freshProj.tools_used.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (tools.length > 0) setExperienceTools(tools);
        } else {
          setExperienceTools(['VS Code', 'Git', 'Linux', 'Python']);
        }
        setChallengesNone(true);
        setChallengeText('');
        setSolutionText('');
        setChallenge2Text('');
        setSolution2Text('');
        setShowSecondPair(false);
        setSelectedRecommendations([]);
        setCustomRecommendation('');
        setDedicationText('');
        setAcknowledgementText('');
      }

      // 6. Hydrate report images
      if (imagesData && Array.isArray(imagesData)) {
        setReportImages(imagesData);
      } else {
        setReportImages([]);
      }

      // 7. Update active project in store
      if (freshProj) {
        useProjectStore.setState({ activeProject: freshProj });
        if (typeof window !== 'undefined') {
          localStorage.setItem('log2def_active_project_id', String(freshProj.id));
        }
      }
    },
    []
  );

  // Background revalidation: update cache silently without disrupting UI
  const revalidateWorkspaceInBackground = useCallback(
    async (projId: number, expectedSwitchSeq: number) => {
      try {
        const [freshProj, entriesData, repData, paymentsData, intakeData, imagesData] = await Promise.all([
          projectsApi.get(projId).catch(() => null),
          projectsApi.getLogbookEntries(projId).catch(() => []),
          projectsApi.getReport(projId).catch(() => null),
          projectsApi.getPayments(projId).catch(() => []),
          typeof projectsApi?.getGuidedIntake === 'function'
            ? projectsApi.getGuidedIntake(projId).catch(() => null)
            : Promise.resolve(null),
          typeof projectsApi?.getReportImages === 'function'
            ? projectsApi.getReportImages(projId).catch(() => [])
            : Promise.resolve([]),
        ]);

        if (expectedSwitchSeq !== switchSequenceRef.current) return;

        if (freshProj) {
          useProjectStore.getState().setWorkspaceCache(projId, {
            project: freshProj,
            entries: entriesData,
            report: repData,
            payments: paymentsData,
            intake: intakeData,
            images: imagesData,
          });
        }
      } catch (err) {
        console.warn('Background workspace revalidation failed:', err);
      }
    },
    []
  );

  // Fast, anti-bleed workspace loader with caching & race-condition cancellation
  const loadProjectWorkspace = useCallback(
    async (
      projId: number,
      options?: { targetStep?: number; keepFlow?: boolean; forceFresh?: boolean }
    ) => {
      if (!projId) return;

      // Immediately cancel any pending autosave timers
      if (detailsDebounceTimer.current) {
        clearTimeout(detailsDebounceTimer.current);
        detailsDebounceTimer.current = null;
      }

      switchSequenceRef.current += 1;
      const thisSwitchSeq = switchSequenceRef.current;

      isSwitchingRef.current = true;
      switchingToIdRef.current = projId;
      loadedProjectIdRef.current = projId;

      // 1. Check workspace cache for instant 0ms switching
      const cached = !options?.forceFresh
        ? useProjectStore.getState().getWorkspaceFromCache(projId)
        : null;

      if (cached) {
        applyWorkspaceData(
          cached.project,
          cached.entries || [],
          cached.report,
          cached.payments || [],
          cached.intake,
          cached.images || []
        );

        isSwitchingRef.current = false;
        switchingToIdRef.current = null;

        if (options?.targetStep !== undefined) {
          setStep(options.targetStep);
          setInFlow(true);
        }

        // Revalidate in background
        revalidateWorkspaceInBackground(projId, thisSwitchSeq);
        return;
      }

      // 2. Cache miss: Clean slate reset to guarantee zero cross-report bleeding
      resetAllWorkspaceState();

      try {
        // Fetch all project records concurrently in ONE single network batch
        const [freshProj, entriesData, repData, paymentsData, intakeData, imagesData] = await Promise.all([
          projectsApi.get(projId).catch(() => null),
          projectsApi.getLogbookEntries(projId).catch(() => []),
          projectsApi.getReport(projId).catch(() => null),
          projectsApi.getPayments(projId).catch(() => []),
          typeof projectsApi?.getGuidedIntake === 'function'
            ? projectsApi.getGuidedIntake(projId).catch(() => null)
            : Promise.resolve(null),
          typeof projectsApi?.getReportImages === 'function'
            ? projectsApi.getReportImages(projId).catch(() => [])
            : Promise.resolve([]),
        ]);

        // If a newer switch was initiated while in-flight, discard this obsolete response
        if (thisSwitchSeq !== switchSequenceRef.current) {
          return;
        }

        // Store into workspace cache
        if (freshProj) {
          useProjectStore.getState().setWorkspaceCache(projId, {
            project: freshProj,
            entries: entriesData,
            report: repData,
            payments: paymentsData,
            intake: intakeData,
            images: imagesData,
          });
        }

        // Hydrate data into state cleanly
        applyWorkspaceData(
          freshProj,
          entriesData,
          repData,
          paymentsData,
          intakeData,
          imagesData
        );

        if (options?.targetStep !== undefined) {
          setStep(options.targetStep);
          setInFlow(true);
        }
      } catch (err) {
        console.error('Failed to load project workspace:', err);
      } finally {
        if (thisSwitchSeq === switchSequenceRef.current) {
          isSwitchingRef.current = false;
          switchingToIdRef.current = null;
        }
      }
    },
    [
      resetAllWorkspaceState,
      applyWorkspaceData,
      revalidateWorkspaceInBackground,
    ]
  );

  // Switch project handler with instant responsiveness and race protection
  const handleSwitchProject = useCallback(
    async (projectId: number, targetView?: 'wizard' | 'report' | 'dashboard') => {
      if (isSwitchingRef.current && switchingToIdRef.current === projectId) {
        return; // Already switching to this project
      }
      try {
        await loadProjectWorkspace(projectId);
        if (targetView === 'wizard') {
          const freshStoreProj = useProjectStore.getState().activeProject;
          const hasDocs = (freshStoreProj?.source_documents?.length || 0) > 0;
          setStep(hasDocs ? 2 : 1);
          setInFlow(true);
          if (scrRef.current) scrRef.current.scrollTop = 0;
        } else if (targetView === 'report') {
          setLogbookView('report');
          setCurrentTab('logbooks');
          setInFlow(false);
          if (scrRef.current) scrRef.current.scrollTop = 0;
        }
        const active = useProjectStore.getState().activeProject;
        const nameOrTitle = active?.full_name
          ? `${active.full_name} (${active.title})`
          : active?.title || 'Report';
        showToast(`Switched to ${nameOrTitle}`);
      } catch (err: any) {
        showToast(err.message || 'Failed to switch project');
      }
    },
    [loadProjectWorkspace, showToast]
  );

  // Initialize and synchronize project from PostgreSQL database on mount
  useEffect(() => {
    let isMounted = true;
    const initProject = async () => {
      try {
        await fetchProjects().catch(() => []);
        const current = await ensureActiveProject().catch(() => null);
        const projId = current?.id;

        if (projId && isMounted && loadedProjectIdRef.current !== projId) {
          await loadProjectWorkspace(projId);
        }
      } catch (err) {
        console.error('Failed to init project from database:', err);
      }
    };
    initProject();
    return () => {
      isMounted = false;
    };
  }, [user, fetchProjects, ensureActiveProject, loadProjectWorkspace]);

  // Synchronize workspace whenever active project changes externally
  useEffect(() => {
    if (activeProject?.id && loadedProjectIdRef.current !== activeProject.id && !isSwitchingRef.current) {
      loadProjectWorkspace(activeProject.id);
    }
  }, [activeProject?.id, loadProjectWorkspace]);

  // Synchronize state directly from active database project
  useEffect(() => {
    if (!activeProject || isSwitchingRef.current) return;

    setDetails((prev) => {
      const next = {
        name: activeProject.full_name || '',
        matric: activeProject.matric_number || '',
        dept: activeProject.department || '',
        fac: activeProject.college || activeProject.faculty_school || 'College of Basic Science',
        degree: activeProject.degree || '',
        inst: activeProject.university_name || '',
        co: activeProject.organization_name || '',
        addr: activeProject.organization_address || '',
        unit: activeProject.industry_department || '',
        start: activeProject.training_start_date ? activeProject.training_start_date.slice(0, 10) : '',
        end: activeProject.training_end_date ? activeProject.training_end_date.slice(0, 10) : '',
        sup: activeProject.industry_supervisor_name || '',
        isup: activeProject.institution_supervisor_name || '',
      };
      const isDiff = Object.keys(next).some((k) => (next as any)[k] !== (prev as any)[k]);
      if (!isDiff) return prev;
      lastSavedDetailsRef.current = JSON.stringify(next);
      return next;
    });

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
    } else {
      setPages([]);
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
    } else {
      setEntries([]);
      setReadDone(false);
    }

    setStudentUnit(activeProject.placement_department || '');
    setSupervisorTitle(activeProject.industry_supervisor_title || '');
    if (activeProject.tools_used) {
      const tools = activeProject.tools_used.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (tools.length > 0) setExperienceTools(tools);
    } else {
      setExperienceTools(['VS Code', 'Git', 'Linux', 'Python']);
    }
  }, [activeProject, userFullName]);

  // Synchronize compiled report sections from PostgreSQL
  useEffect(() => {
    if (isSwitchingRef.current) return;
    if (dbReport && dbReport.sections && dbReport.sections.length > 0) {
      setGenState(2);
      setChapterEdits((prev) => {
        if (Object.keys(prev).length === 0) {
          return mapBackendSectionsToChapters(dbReport.sections);
        }
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

  // Auto-save student details directly to database (debounced and dirty-checked)
  const detailsDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isHydrated || !activeProject?.id || isSwitchingRef.current) return;

    const serialized = JSON.stringify(details);
    if (serialized === lastSavedDetailsRef.current) return;

    if (detailsDebounceTimer.current) clearTimeout(detailsDebounceTimer.current);
    detailsDebounceTimer.current = setTimeout(async () => {
      if (isSwitchingRef.current) return;
      const currentSerialized = JSON.stringify(details);
      if (currentSerialized === lastSavedDetailsRef.current) return;
      lastSavedDetailsRef.current = currentSerialized;
      try {
        await updateActiveProject(activeProject.id, {
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
        });
      } catch (err) {
        console.warn('Auto-save student details failed:', err);
      }
    }, 1000);

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

    if (hash === 'new' || searchParams.get('action') === 'new') {
      restoredTab = 'reports';
      restoredInFlow = false;
      setIsCreateReportModalOpen(true);
    }

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

      if (hash === 'new' || searchParams.get('action') === 'new') {
        switchTab('reports');
        setInFlow(false);
        setIsCreateReportModalOpen(true);
      }

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
      if (!activeProject?.id || isSwitchingRef.current) return;
      try {
        const payments = await fetchPayments(activeProject.id);
        const paidDigital = (payments || []).find(
          (p: any) => p.order_type === 'digital' && p.status === 'paid'
        );
        const paidDelivery = (payments || []).find(
          (p: any) => p.order_type === 'delivery' && p.status === 'paid'
        );

        setHasPaidDigital(Boolean(paidDigital));
        if (paidDigital) {
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
        } else {
          setPaymentSuccess(null);
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

  const computeOrganogramTree = (
    head: string,
    units: string[],
    selectedUnit: string,
    supervisor: string
  ) => {
    if (!head.trim()) return '';
    const lines: string[] = [head.trim()];
    const cleanPlacement = selectedUnit.trim();
    let placed = false;
    units.forEach((u) => {
      lines.push(`  ${u.trim()}`);
      if (cleanPlacement && u.trim().toLowerCase() === cleanPlacement.toLowerCase() && !placed) {
        placed = true;
        if (supervisor.trim()) {
          lines.push(`    ${supervisor.trim()}`);
          lines.push(`      SIWES Intern`);
        } else {
          lines.push(`    SIWES Intern`);
        }
      }
    });
    if (!placed && supervisor.trim()) {
      if (lines.length > 1) {
        lines.splice(2, 0, `    ${supervisor.trim()}`, `      SIWES Intern`);
      } else {
        lines.push(`  ${supervisor.trim()}`, `    SIWES Intern`);
      }
    }
    return lines.join('\n');
  };

  const buildStructureNarrative = (
    head: string,
    units: string[],
    selectedUnit: string,
    supervisor: string
  ): string => {
    if (!head.trim()) return '';
    const narrative: string[] = [`The organisation is headed by the ${head.trim()}.`];
    const cleanUnits = units.map((u) => u.trim()).filter(Boolean);
    if (cleanUnits.length === 1) {
      narrative.push(`The primary operating unit is the ${cleanUnits[0]}.`);
    } else if (cleanUnits.length > 1) {
      const unitsStr = cleanUnits.slice(0, -1).join(', ') + ' and ' + cleanUnits[cleanUnits.length - 1];
      narrative.push(`The operational divisions comprise the ${unitsStr}.`);
    }
    if (selectedUnit.trim()) {
      const superStr = supervisor.trim() ? ` under the supervision of the ${supervisor.trim()}` : '';
      narrative.push(`During the training period, the student was assigned to the ${selectedUnit.trim()}${superStr}.`);
    }
    return narrative.join(' ');
  };

  const saveStep2Data = useCallback(async () => {
    if (isSwitchingRef.current) return;
    const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!projId) return;

    const currentSerialized = JSON.stringify(details);
    if (currentSerialized === lastSavedDetailsRef.current) return;
    lastSavedDetailsRef.current = currentSerialized;

    setAutoSaveStatus('saving');
    try {
      await updateActiveProject(projId, {
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
      });
      setAutoSaveStatus('saved');
    } catch (err) {
      console.warn('Step 2 autosave failed:', err);
      setAutoSaveStatus('error');
    }
  }, [activeProject?.id, details, updateActiveProject]);

  const saveStep4Data = useCallback(
    async (overrides?: Record<string, any>) => {
      if (isSwitchingRef.current) return;
      const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
      if (!projId) return;

      const treeToSave = isEditingTree && customTreeText.trim()
        ? customTreeText.trim()
        : computeOrganogramTree(headTitle, orgUnits, studentUnit, supervisorTitle);
      const structureNarrative = buildStructureNarrative(headTitle, orgUnits, studentUnit, supervisorTitle);
      const objText = (orgPasteMode && orgPasteText.trim()) ? orgPasteText.trim() : orgObjectives.trim();
      const whatText = orgWhat.trim() || (orgNotSure ? `${details.co || 'The organisation'} is an established technical organisation located in ${details.addr || 'Nigeria'}.` : '');
      const whenWhereText = `${orgWhen.trim()} ${orgWhere.trim()}`.trim();

      const placementUnit = studentUnit.trim() || orgUnits[0] || details.unit || activeProject?.placement_department || activeProject?.industry_department || '';
      const payload: Record<string, any> = {
        organisation_not_sure: orgNotSure,
        ...(whatText ? { organisation_what: whatText } : {}),
        ...(whenWhereText ? { organisation_when_where: whenWhereText } : {}),
        ...(objText ? { organisation_objectives: objText } : {}),
        ...(orgPasteMode && orgPasteText.trim() ? { organisation_paste_text: orgPasteText.trim() } : {}),
        ...(headTitle.trim() ? { head_title: headTitle.trim() } : {}),
        organisation_units: orgUnits,
        ...(placementUnit ? { student_unit: placementUnit } : {}),
        ...(supervisorTitle.trim() ? { supervisor_title: supervisorTitle.trim() } : {}),
        ...(treeToSave ? { organogram_tree: treeToSave } : {}),
        ...(structureNarrative ? { organisation_structure: structureNarrative } : {}),
        ...(overrides || {}),
      };

      const serialized = JSON.stringify(payload);
      if (!overrides && serialized === lastSavedStep4Ref.current) return;
      lastSavedStep4Ref.current = serialized;

      setAutoSaveStatus('saving');
      try {
        await projectsApi.saveGuidedIntakeAnswers(projId, payload);
        setAutoSaveStatus('saved');
      } catch (err) {
        console.warn('Step 4 autosave failed:', err);
        setAutoSaveStatus('error');
      }
    },
    [
      activeProject?.id,
      orgWhat,
      orgNotSure,
      orgWhen,
      orgWhere,
      orgObjectives,
      orgPasteMode,
      orgPasteText,
      headTitle,
      orgUnits,
      studentUnit,
      supervisorTitle,
      customTreeText,
      isEditingTree,
      details.co,
      details.addr,
    ]
  );

  const saveStep5Data = useCallback(
    async (overrides?: Record<string, any>) => {
      if (isSwitchingRef.current) return;
      const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
      if (!projId) return;

      const allEntries = entries.length > 0 ? entries : (activeProject?.logbook_entries || []);
      const logbookDuties = allEntries
        .map((e: any) => (e.t || e.activity_summary || e.verified_text || e.raw_text || '').trim())
        .filter((text: string): text is string => Boolean(text));
      const finalDuties = (experienceDuties.trim() || (logbookDuties.length > 0 ? logbookDuties.slice(0, 5).join('\n') : '') || experienceAdditional.trim() || 'Participated in core technical operations, software workflows, and assigned departmental tasks under engineering supervision.').trim();

      let challengePayload: any = { none: true, pairs: [] };
      if (!challengesNone) {
        const pairs: { challenge: string; solution: string }[] = [];
        if (challengeText.trim()) {
          pairs.push({
            challenge: challengeText.trim(),
            solution: solutionText.trim() || 'Addressed through consultation with industrial supervisor.',
          });
        }
        if (showSecondPair && challenge2Text.trim()) {
          pairs.push({
            challenge: challenge2Text.trim(),
            solution: solution2Text.trim() || 'Resolved under the guidance of technical team leads.',
          });
        }
        if (pairs.length > 0) {
          challengePayload = { none: false, pairs };
        }
      }

      const allRecs = [...selectedRecommendations, customRecommendation.trim()].filter(Boolean);

      const payload: Record<string, any> = {
        ...(finalDuties ? { duties: finalDuties } : {}),
        challenge_pairs: challengePayload,
        ...(allRecs.length > 0 ? { recommendations: allRecs.join('\n') } : {}),
        ...(overrides || {}),
      };

      const serialized = JSON.stringify({ payload, tools: experienceTools });
      if (!overrides && serialized === lastSavedStep5Ref.current) return;
      lastSavedStep5Ref.current = serialized;

      setAutoSaveStatus('saving');
      try {
        await projectsApi.saveGuidedIntakeAnswers(projId, payload);
        if (experienceTools.length > 0) {
          await updateActiveProject(projId, { tools_used: experienceTools.join(', ') }).catch(() => {});
        }
        setAutoSaveStatus('saved');
      } catch (err) {
        console.warn('Step 5 autosave failed:', err);
        setAutoSaveStatus('error');
      }
    },
    [
      activeProject?.id,
      entries,
      experienceDuties,
      experienceAdditional,
      experienceTools,
      challengesNone,
      challengeText,
      solutionText,
      showSecondPair,
      challenge2Text,
      solution2Text,
      selectedRecommendations,
      customRecommendation,
      updateActiveProject,
    ]
  );

  const saveStep6Data = useCallback(async () => {
    if (isSwitchingRef.current) return;
    const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!projId) return;

    const payload: Record<string, any> = {
      ...(dedicationText.trim() ? { dedication: dedicationText.trim() } : {}),
      ...(acknowledgementText.trim() ? { acknowledgement: acknowledgementText.trim() } : {}),
    };
    if (Object.keys(payload).length === 0) return;

    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedStep6Ref.current) return;
    lastSavedStep6Ref.current = serialized;

    setAutoSaveStatus('saving');
    try {
      await projectsApi.saveGuidedIntakeAnswers(projId, payload);
      setAutoSaveStatus('saved');
    } catch (err) {
      console.warn('Step 6 autosave failed:', err);
      setAutoSaveStatus('error');
    }
  }, [activeProject?.id, dedicationText, acknowledgementText]);

  // Debounced autosave effects per step
  useEffect(() => {
    if (step !== 2 || !activeProject?.id || isSwitchingRef.current) return;
    const timer = setTimeout(() => {
      saveStep2Data();
    }, 800);
    return () => clearTimeout(timer);
  }, [step, activeProject?.id, details, saveStep2Data]);

  useEffect(() => {
    if (step !== 4 || !activeProject?.id || isSwitchingRef.current) return;
    const timer = setTimeout(() => {
      saveStep4Data();
    }, 700);
    return () => clearTimeout(timer);
  }, [
    step,
    activeProject?.id,
    orgWhat,
    orgNotSure,
    orgWhen,
    orgWhere,
    orgObjectives,
    orgPasteMode,
    orgPasteText,
    headTitle,
    orgUnits,
    studentUnit,
    supervisorTitle,
    customTreeText,
    isEditingTree,
    saveStep4Data,
  ]);

  useEffect(() => {
    if (step !== 5 || !activeProject?.id || isSwitchingRef.current) return;
    const timer = setTimeout(() => {
      saveStep5Data();
    }, 700);
    return () => clearTimeout(timer);
  }, [
    step,
    activeProject?.id,
    experienceDuties,
    experienceAdditional,
    experienceTools,
    challengesNone,
    challengeText,
    solutionText,
    showSecondPair,
    challenge2Text,
    solution2Text,
    selectedRecommendations,
    customRecommendation,
    saveStep5Data,
  ]);

  useEffect(() => {
    if (step !== 6 || !activeProject?.id || isSwitchingRef.current) return;
    const timer = setTimeout(() => {
      saveStep6Data();
    }, 700);
    return () => clearTimeout(timer);
  }, [step, activeProject?.id, dedicationText, acknowledgementText, saveStep6Data]);

  const trackWizardEvent = useCallback((stepName: string, screenId: string, eventType: string, meta: Record<string, any> = {}) => {
    const projId = activeProject?.id;
    if (!projId) return;
    projectsApi.trackEvent(projId, {
      step_name: stepName,
      screen_id: screenId,
      event_type: eventType,
      metadata: meta,
    }).catch(() => {});
  }, [activeProject?.id]);

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
              const uploadedDoc = await uploadDocument(projId, fd, (progress) => {
                setPages((prev) => {
                  const next = [...prev];
                  if (next[i]) {
                    next[i] = {
                      ...next[i],
                      uploadProgress: progress.percentage,
                      bytesUploaded: progress.loaded,
                      totalBytes: progress.total,
                    };
                  }
                  return next;
                });
              });
              if (uploadedDoc?.id) {
                setPages((prev) => {
                  const next = [...prev];
                  if (next[i]) {
                    next[i] = {
                      ...next[i],
                      id: uploadedDoc.id,
                      isUploading: false,
                      uploadProgress: 100,
                      bytesUploaded: page.file?.size,
                      totalBytes: page.file?.size,
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

  // Step 7 Report Generation: triggers real generation in PostgreSQL
  const startGenerating = async () => {
    setGenError(null);
    setLastGenerateBlock(null);
    setGenState(1);
    setGenProgress(0);
    if (scrRef.current) scrRef.current.scrollTop = 0;

    // Flush any pending intake and details data before generation
    await saveStep2Data().catch(() => {});
    await saveStep4Data().catch(() => {});
    await saveStep5Data().catch(() => {});
    await saveStep6Data().catch(() => {});

    // Progress smoothly through the 8 stages (up to 7 while waiting for backend)
    const iv = setInterval(() => {
      setGenProgress((prev) => (prev < GS.length - 1 ? prev + 1 : prev));
    }, 2800);

    try {
      const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
      if (!projId) {
        throw new Error('No active project found. Please select or initialize your report project.');
      }

      const rep = await storeGenerateReport(projId, false);
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

      // Check if report sections actually exist in the database despite any transient proxy/network hiccup
      const projId = activeProject?.id || useProjectStore.getState().activeProject?.id;
      if (projId) {
        try {
          const fallbackRep = await fetchReport(projId);
          if (fallbackRep && fallbackRep.sections && fallbackRep.sections.length > 0) {
            setGenProgress(GS.length);
            const edits = mapBackendSectionsToChapters(fallbackRep.sections);
            setChapterEdits(edits);
            setGenState(2);
            showToast('Institutional report compiled!');
            return;
          }
        } catch {}
      }

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
        if (hasGuidedIntake) {
          msg += ' Review and confirm details in Step 4 (Organisation) or Step 5 (Experience).';
        }
        setGenError(msg);

        // Route to the appropriate step if fields are missing
        const firstDetailMissing = missingFields.find(
          (k) => typeof k === 'string' && !k.startsWith('guided_intake:') && !k.startsWith('section:') && FLD.some(([key]) => key === k)
        ) || null;
        const firstGuidedMissing = missingFields.find(
          (k) => typeof k === 'string' && k.startsWith('guided_intake:')
        ) || null;

        if (firstDetailMissing) {
          setStep(2);
          setIntakeFocusKey(firstDetailMissing as string);
          setTimeout(() => {
            const el = intakeRefs.current[firstDetailMissing as string];
            if (el && typeof el.focus === 'function') {
              el.focus();
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }, 0);
        } else if (firstGuidedMissing) {
          const rawKey = firstGuidedMissing.replace(/^guided_intake:/, '');
          if (['organisation_what', 'organisation_when_where', 'organisation_objectives', 'organisation_structure', 'organogram_tree', 'student_unit', 'head_title'].includes(rawKey)) {
            setStep(4);
            if (['organisation_structure', 'organogram_tree', 'head_title', 'student_unit'].includes(rawKey)) {
              setOrgScreen(4);
            } else if (rawKey === 'organisation_objectives') {
              setOrgScreen(3);
            } else if (rawKey === 'organisation_when_where') {
              setOrgScreen(2);
            } else {
              setOrgScreen(1);
            }
          } else if (['duties', 'challenge_pairs', 'recommendations'].includes(rawKey)) {
            setStep(5);
          }
        }
        showToast('Report generation note — check required details.');
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
      pdf: f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      th: '',
      file: f,
      isUploading: true,
      uploadProgress: 0,
      bytesUploaded: 0,
      totalBytes: f.size,
    }));

    setPages((prev) => [...prev, ...initialPlaceholders]);

    const queue = fileArr.map((f, i) => ({ file: f, pageIdx: startingIndex + i }));
    let successCount = 0;

    const uploadWorker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const { file: f, pageIdx } = item;

        const localThPromise = generateThumbnail(f);
        const fd = new FormData();
        fd.append('file', f);
        fd.append('page_index', String(pageIdx));
        fd.append('async', 'true');

        try {
          const uploadedDoc = await uploadDocument(projId, fd, (progress) => {
            setPages((prev) => {
              const idx = prev.findIndex((p) => p.file === f);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                uploadProgress: progress.percentage,
                bytesUploaded: progress.loaded,
                totalBytes: progress.total,
              };
              return next;
            });
          });

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

          // Complete progress to 100%
          setPages((prev) => {
            const idx = prev.findIndex((p) => p.file === f);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              id: uploadedDoc?.id,
              uploadProgress: 100,
              bytesUploaded: f.size,
              totalBytes: f.size,
            };
            return next;
          });

          // Short 200ms pause so the student sees 100% completion
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
    };

    // Parallel upload workers (concurrency = 2) for maximum speed with 500MB+ files
    const CONCURRENCY = 2;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, fileArr.length) }, () => uploadWorker())
    );

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
  const executeRealFileDownload = async (format: 'PDF' | 'Word', specificProjectId?: number) => {
    const projId = specificProjectId || activeProject?.id || useProjectStore.getState().activeProject?.id;
    if (!projId) {
      showToast('No active project');
      return;
    }
    setDownloadLoading(true);
    try {
      // Ensure export is ready with server-side long polling wait (avoids rapid client retries)
      const fmt = format === 'PDF' ? 'pdf' : 'docx';
      const statusRes = await projectsApi.getExportStatus(projId, fmt, true, 12).catch(() => null);
      if (statusRes && statusRes.status === 'failed') {
        showToast(statusRes.error || 'Export generation failed. Please review your chapters.');
        return;
      }

      // Verify payment via secure backend endpoint
      const url = `${getApiBaseUrl()}/projects/${projId}/squad/download/${fmt}/`;
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

  const stepIcons = ['photo_camera', 'badge', 'fact_check', 'domain', 'psychology', 'stars', 'auto_awesome'];
  const stepNames = ['Upload', 'Details', 'Review', 'Organisation', 'Experience', 'Extras', 'Ready'];
  const stepSubtitles = [
    'Upload your logbook pages',
    'Confirm your details',
    'Check what we read',
    'About your organisation',
    'Your experience and tools',
    'Optional extras',
    'Ready to generate',
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
          {renderProjectSwitcher()}
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
                Hi, {user?.first_name || (details.name ? details.name.split(' ')[0] : 'there')}
              </p>
              {activeProject?.full_name ? (
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gd)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="ms" style={{ fontSize: '15px' }}>badge</span>
                  <span>Report for: <b>{activeProject.full_name}</b>{activeProject.matric_number ? ` (${activeProject.matric_number})` : ''}</span>
                </div>
              ) : null}
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

        {renderActiveProjectBanner()}

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
    let romanIndex = 0;
    const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
    let arabicPageNumber = 1;

    const modelRows = dbReport?.template_version === 'lasustech_cs:2.0.0' && Array.isArray(modelSections)
      ? (() => {
          const rows: any[] = [];
          const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
          }[char] as string));
          const renderNode = (node: any): string => {
            if (node.children && Array.isArray(node.children) && node.children.length > 0) {
              const inner = node.children.map(renderNode).join('');
              if (node.type === 'list') {
                const tag = node.attrs?.ordered ? 'ol' : 'ul';
                return `<${tag}>${inner}</${tag}>`;
              }
              if (node.type === 'table') {
                return `<table>${inner}</table>`;
              }
              if (node.type === 'figure' || node.type === 'image' || node.type === 'img') {
                const src = node.attrs?.src || node.src || '';
                const caption = node.attrs?.caption || node.attrs?.alt || node.caption || '';
                const imgHtml = src ? `<div style="text-align: center; margin: 12px 0;"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" style="max-width: 100%; max-height: 240px; height: auto; display: inline-block; border-radius: 4px;" /></div>` : '';
                const capHtml = caption ? `<p style="text-align: center; font-style: italic; font-size: 11pt; margin-top: 4px;">${escapeHtml(caption)}</p>` : '';
                return `${imgHtml}${capHtml}${inner}`;
              }
              return `<div>${inner}</div>`;
            }
            if (node.type === 'paragraph' || node.type === 'heading') {
              const text = escapeHtml(node.text || '').replace(/\n/g, '<br/>');
              return node.type === 'heading' ? `<h3>${text}</h3>` : `<p>${text}</p>`;
            }
            if (node.type === 'container') {
              const text = escapeHtml(node.text || '').replace(/\n/g, '<br/>');
              return text ? `<div>${text}</div>` : '';
            }
            if (node.type === 'list') {
              const tag = node.attrs?.ordered ? 'ol' : 'ul';
              return `<${tag}>${(node.children || []).map((item: any) => `<li>${escapeHtml(item.text || '')}</li>`).join('')}</${tag}>`;
            }
            if (node.type === 'table') {
              return `<table>${(node.children || []).map((row: any) => `<tr>${(row.children || []).map((cell: any) => `<td>${escapeHtml(cell.text || '')}</td>`).join('')}</tr>`).join('')}</table>`;
            }
            if (node.type === 'figure' || node.type === 'image' || node.type === 'img') {
              const src = node.attrs?.src || node.src || '';
              const caption = node.attrs?.caption || node.attrs?.alt || node.caption || '';
              let imgHtml = '';
              if (src) {
                imgHtml = `<div style="text-align: center; margin: 12px 0;"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" style="max-width: 100%; max-height: 240px; height: auto; display: inline-block; border-radius: 4px;" /></div>`;
              }
              const capHtml = caption ? `<p style="text-align: center; font-style: italic; font-size: 11pt; margin-top: 4px;">${escapeHtml(caption)}</p>` : '';
              return `${imgHtml}${capHtml}`;
            }
            return '';
          };

          const chapterStartPages: Record<number, number> = {
            1: 1,
            2: 3,
            3: 5,
            4: 11,
            5: 12,
          };
          const chapterPageSpans: Record<number, number> = {
            1: 2,
            2: 2,
            3: 6,
            4: 1,
            5: 1,
          };

          let romanIdx = 0;
          let currentCh: number | null = null;
          let currentChHtml = '';
          let currentChTitle = '';

          modelSections.forEach((section: any) => {
            const rawSec = (dbReport?.sections || []).find((s: any) => s.section_key === section.key);
            const isPrelim = section.chapter === 0;
            const nodeHtml = (section.nodes || []).map(renderNode).join('');
            const contentHtml = rawSec?.content || nodeHtml;

            if (isPrelim) {
              const pLabel = romanNumerals[romanIdx] || `${romanIdx + 1}`;
              romanIdx++;
              if (section.key === 'title_page' || section.key === 'cover') {
                rows.push({
                  t: section.title || 'Title Page',
                  h: contentHtml,
                  p: 1,
                  l: pLabel,
                });
                return;
              }

              const hasHeading = contentHtml.includes('<h1') || contentHtml.includes('<h2');
              const titleHtml = hasHeading ? '' : `<h2>${escapeHtml(section.title.toUpperCase())}</h2>`;
              rows.push({
                t: section.title,
                h: `${titleHtml}${contentHtml}`,
                p: 1,
                l: pLabel,
              });
              return;
            }

            const chNum = section.chapter;
            const isNewChapter = currentCh !== chNum;

            if (isNewChapter) {
              if (currentCh !== null && currentChHtml) {
                const startP = chapterStartPages[currentCh] || 1;
                const spanP = chapterPageSpans[currentCh] || 1;
                rows.push({
                  t: currentChTitle,
                  h: currentChHtml,
                  p: spanP,
                  l: `${startP}${spanP > 1 ? ` – ${startP + spanP - 1}` : ''}`,
                });
              }
              currentCh = chNum;
              currentChTitle = section.chapter_title ? section.chapter_title.replace(/\n/g, ': ') : section.title;
              const chHeader = section.chapter_title
                ? `<h2>${escapeHtml(section.chapter_title).replace(/\n/g, '<br/>')}</h2>`
                : '';
              const isRef = section.key === 'references' || section.title?.toUpperCase() === 'REFERENCES';
              const subHeader = isRef ? '' : `<h3>${escapeHtml(section.title)}</h3>`;
              currentChHtml = `${chHeader}${subHeader}${contentHtml}`;
            } else {
              const isRef = section.key === 'references' || section.title?.toUpperCase() === 'REFERENCES';
              const subHeader = isRef ? '' : `<h3>${escapeHtml(section.title)}</h3>`;
              currentChHtml += `${subHeader}${contentHtml}`;
            }
          });

          if (currentCh !== null && currentChHtml) {
            const startP = chapterStartPages[currentCh] || 1;
            const spanP = chapterPageSpans[currentCh] || 1;
            rows.push({
              t: currentChTitle,
              h: currentChHtml,
              p: spanP,
              l: `${startP}${spanP > 1 ? ` – ${startP + spanP - 1}` : ''}`,
            });
          }

          return rows;
        })()
      : null;
    const previewRows = modelRows || layout.rows;
    const pageEstimate = dbReport?.page_estimate_breakdown || {};
    const qualityGate = dbReport?.quality_gate || { passed: true, blockers: [], warnings: [], summary: {} };
    const needsMoreDetail = (qualityGate.warnings || []).filter((issue: any) =>
      ['thin_section', 'low_student_content', 'unconfirmed_inference'].includes(issue.code)
    ).slice(0, 3);
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

    const hasReport = Boolean(
      (dbReport && dbReport.sections && dbReport.sections.length > 0) ||
      Object.keys(chapterEdits).length > 0
    );

    if (genState !== 2 && !hasReport) {
      return (
        <div className="card big" style={{ marginTop: '10px' }}>
          <div className="ok">
            <span className="ms" aria-hidden="true">
              auto_stories
            </span>
          </div>
          <h2>No report generated yet</h2>
          <p>Complete the generator steps to compile your logbook entries into an institutional report.</p>
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

    const totalSections = editorLabels.length;
    const filledSections = editorLabels.filter((_: string, i: number) => {
      const h = getSectionHtml(i);
      return Boolean(h && h.replace(/<[^>]*>/g, '').trim().length > 0);
    });
    const unfilledLabels = editorLabels.filter((_: string, i: number) => {
      const h = getSectionHtml(i);
      return !h || h.replace(/<[^>]*>/g, '').trim().length === 0;
    });
    const isAllFilled = unfilledLabels.length === 0;

    return (
      <div style={{ marginTop: '6px' }}>
        {/* Generation Status Overview Banner */}
        <div
          className="card"
          style={{
            padding: '12px 16px',
            marginBottom: '14px',
            background: isAllFilled ? 'var(--card)' : '#fffbeb',
            border: `1px solid ${isAllFilled ? 'var(--line)' : '#fde68a'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1, minWidth: '220px' }}>
              <span
                className="ms"
                style={{
                  fontSize: '22px',
                  color: isAllFilled ? 'var(--g)' : '#d97706',
                  marginTop: '1px',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                {isAllFilled ? 'task_alt' : 'info'}
              </span>
              <div>
                {(() => {
                  const isReadyToDownload = Boolean(qualityGate.passed && (!qualityGate.blockers || qualityGate.blockers.length === 0));
                  return (
                    <>
                      <b style={{ color: isReadyToDownload ? 'var(--g)' : '#92400e', fontSize: '14.5px', display: 'block' }}>
                        {isReadyToDownload ? 'Ready to download' : 'A few things to finish'}
                      </b>
                      {isReadyToDownload ? (
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--mut)' }}>
                          All chapters compiled and aligned with institutional guidelines.
                        </p>
                      ) : (
                        <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#b45309' }}>
                          {qualityGate.blockers?.length
                            ? `${qualityGate.blockers.length} item${qualityGate.blockers.length > 1 ? 's' : ''} to review before final export.`
                            : 'Review and polish remaining sections below.'}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            {!isAllFilled && (
              <button
                className="btn o s"
                type="button"
                onClick={() => goToFlow(7)}
                style={{ flexShrink: 0 }}
              >
                <span className="ms" style={{ fontSize: '16px' }} aria-hidden="true">auto_awesome</span>
                Generate Missing
              </button>
            )}
          </div>
        </div>

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
              {editorLabels.map((x: string, i: number) => {
                const h = getSectionHtml(i);
                const isFilled = Boolean(h && h.replace(/<[^>]*>/g, '').trim().length > 0);
                return (
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
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <span
                      className="ms"
                      style={{
                        fontSize: '14px',
                        color: isFilled ? 'var(--g)' : '#d97706',
                      }}
                      aria-hidden="true"
                    >
                      {isFilled ? 'check_circle' : 'pending'}
                    </span>
                    {x.replace(/Chapter (\d): /, 'Ch $1: ')}
                  </button>
                );
              })}
            </div>

            {(() => {
              const activeH = getSectionHtml(currentSectionIdx);
              const activeFilled = Boolean(activeH && activeH.replace(/<[^>]*>/g, '').trim().length > 0);
              if (!activeFilled) {
                return (
                  <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '10px', marginBottom: '10px', fontSize: '12.5px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ms" style={{ fontSize: '16px', color: '#d97706' }}>edit_note</span>
                    <span>This section has not been generated yet. You can type or paste your content directly below.</span>
                  </div>
                );
              }
              return null;
            })()}

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
                Total {dbReport?.actual_page_count || qualityGate.summary?.total_pages || 17} pages (12 body pages · 5 preliminary pages) · Print Ready
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

            {/* Blockers: Grouped and capped at max 5 */}
            {!qualityGate.passed && qualityGate.blockers && qualityGate.blockers.length > 0 && (
              <div className="card" id="report-quality" role="alert" style={{ border: '1px solid #fca5a5', background: '#fef2f2', marginBottom: '16px', padding: '14px 16px' }}>
                <div className="row" style={{ color: '#b91c1c', alignItems: 'center', gap: '8px' }}>
                  <span className="ms">error_outline</span>
                  <b style={{ fontSize: '14.5px' }}>
                    A few things to finish before download ({Math.min(qualityGate.blockers.length, 5)} item{qualityGate.blockers.length > 1 ? 's' : ''})
                  </b>
                  {((qualityGate.hidden_blocker_count || 0) > 0 || qualityGate.blockers.length > 5) && (
                    <span className="chip" style={{ background: '#fee2e2', color: '#991b1b', fontSize: '11px', padding: '2px 8px' }}>
                      and {(qualityGate.hidden_blocker_count || 0) + Math.max(0, qualityGate.blockers.length - 5)} more
                    </span>
                  )}
                </div>
                <p style={{ margin: '6px 0 10px', fontSize: '13px', color: '#7f1d1d' }}>
                  Review these items before final DOCX/PDF export.
                </p>
                {qualityGate.blockers.slice(0, 5).map((issue: any, idx: number) => (
                  <div key={`${issue.code}-${idx}`} id={issue.anchor?.replace('#', '')} style={{ padding: '8px 0', borderTop: '1px solid #fecaca', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: '#991b1b' }}>{issue.message}</p>
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
                        Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Needs More Detail: Capped at max 3 items, opens guided steps */}
            {qualityGate.needs_more_detail && qualityGate.needs_more_detail.length > 0 && (
              <div className="card" style={{ border: '1px solid #fdba74', background: '#fff7ed', marginBottom: '16px', padding: '14px 16px' }}>
                <div className="row" style={{ color: '#c2410c', alignItems: 'center', gap: '8px' }}>
                  <span className="ms">lightbulb</span>
                  <b style={{ fontSize: '14px' }}>Needs more detail (optional expansion)</b>
                </div>
                <p style={{ margin: '4px 0 10px', fontSize: '12.5px', color: '#9a3412' }}>
                  These sections are below recommended word counts. Tap to answer quick guided questions:
                </p>
                {qualityGate.needs_more_detail.slice(0, 3).map((item: any, idx: number) => {
                  const targetStep = item.section_key?.startsWith('ch2') ? 4 : (item.section_key?.startsWith('ch3') || item.section_key?.startsWith('ch4')) ? 5 : null;
                  return (
                    <div key={idx} style={{ padding: '8px 0', borderTop: '1px solid #fed7aa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                      <p style={{ margin: 0, fontSize: '12.5px', color: '#7c2d12' }}>{item.message}</p>
                      {targetStep ? (
                        <button
                          className="btn o s"
                          type="button"
                          onClick={() => goToFlow(targetStep)}
                        >
                          Add detail →
                        </button>
                      ) : (
                        <button
                          className="btn o s"
                          type="button"
                          onClick={() => {
                            const sectionIndex = (dbReport?.sections || []).findIndex((section: any) => section.section_key === item.section_key);
                            if (sectionIndex >= 0) {
                              setCurrentSectionIdx(sectionIndex);
                              if (editorRef.current) editorRef.current.innerHTML = getSectionHtml(sectionIndex);
                            }
                            setEditorTab('edit');
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {previewRows.map((q: any, idx: number) => {
              const isSectionEmpty = !q.h || !q.h.replace(/<[^>]*>/g, '').trim();
              return (
                <React.Fragment key={idx}>
                  <p className="pl2">
                    {q.t} ·{' '}
                    {q.l
                      ? `page ${q.l}${!String(q.l).includes('–') && !String(q.l).includes('-') && q.p > 1 && !isNaN(Number(q.l)) ? ` (continues to ${Number(q.l) + q.p - 1})` : ''}`
                      : 'Cover (unnumbered)'}
                    {isSectionEmpty && (
                      <span className="chip" style={{ background: '#fee2e2', color: '#b91c1c', marginLeft: '8px', fontSize: '11px', padding: '2px 8px' }}>
                        Not generated yet
                      </span>
                    )}
                  </p>
                  <div
                    className="pgp"
                    role="group"
                    aria-label={q.t}
                    style={isSectionEmpty ? { border: '1px dashed #f87171', background: '#fff5f5' } : undefined}
                  >
                    {isSectionEmpty ? (
                      <div style={{ padding: '24px 16px', textAlign: 'center', color: '#991b1b' }}>
                        <span className="ms" style={{ fontSize: '28px', color: '#ef4444', display: 'block', marginBottom: '8px' }}>pending</span>
                        <b style={{ fontSize: '14px' }}>{q.t} has not been generated yet</b>
                        <p style={{ margin: '6px 0 14px', fontSize: '13px', color: '#7f1d1d' }}>
                          This section requires additional logbook or organisation details, or can be written directly in the editor.
                        </p>
                        <button
                          className="btn o s"
                          type="button"
                          onClick={() => {
                            setCurrentSectionIdx(idx);
                            if (editorRef.current) editorRef.current.innerHTML = getSectionHtml(idx);
                            setEditorTab('edit');
                          }}
                        >
                          <span className="ms" style={{ fontSize: '16px' }}>edit</span>
                          Write or Edit this Section
                        </button>
                      </div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: q.h }} />
                    )}
                    {q.l && (
                      <div className="pn">
                        Page {q.l}{!String(q.l).includes('–') && !String(q.l).includes('-') && q.p > 1 && !isNaN(Number(q.l)) ? ` – ${Number(q.l) + q.p - 1}` : ''}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </>
        )}

        {/* Dual Actions: 1. Digital Download (NGN 2,000 for Basic, Free for Pro) & 2. Print Delivery (Hidden on Pro) */}
        <div style={{ marginTop: '22px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            className="btn w"
            type="button"
            disabled={downloadLoading}
            onClick={() => {
              if (isPro || hasPaidDigital) {
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
              : isPro
                ? 'Download Report (Pro Tier)'
                : hasPaidDigital
                  ? 'Download Report (Paid)'
                  : 'Download Report (NGN 2,000)'}
          </button>

          {!isPro && (
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
          )}
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
          {renderProjectSwitcher()}
          <span className="sp" />
        </header>

        <div className="lg" style={{ paddingBottom: '12px' }}>
          <h1>My Logbooks</h1>
        </div>

        {renderActiveProjectBanner()}

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
                        padding: '12px 6px',
                        boxSizing: 'border-box',
                        background: 'var(--bg)',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: '52px',
                          height: '52px',
                          borderRadius: '999px',
                          border: `3px solid ${(p.uploadProgress ?? 0) >= 90 ? '#059669' : 'rgba(16, 185, 129, 0.4)'}`,
                          background: (p.uploadProgress ?? 0) >= 90 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: (p.uploadProgress ?? 0) >= 90 ? '0 0 10px rgba(16, 185, 129, 0.25)' : 'none',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <span style={{ fontSize: '15px', fontWeight: 800, color: (p.uploadProgress ?? 0) >= 90 ? '#059669' : 'var(--g)', lineHeight: 1 }}>
                          {Math.round(p.uploadProgress ?? 0)}%
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          maxWidth: '90%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '6px',
                        }}
                        title={p.n}
                      >
                        {p.n}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: (p.uploadProgress ?? 0) >= 90 ? '#059669' : 'var(--g)',
                          marginTop: '2px',
                        }}
                      >
                        {(p.uploadProgress ?? 0) >= 100
                          ? 'Complete'
                          : (p.uploadProgress ?? 0) >= 90
                          ? 'Almost done…'
                          : 'Uploading…'}
                      </span>
                      {p.totalBytes ? (
                        <span style={{ fontSize: '9px', color: 'var(--ink)', opacity: 0.65, marginTop: '2px' }}>
                          {formatBytes(p.bytesUploaded)} / {formatBytes(p.totalBytes)}
                        </span>
                      ) : null}
                    </div>
                  ) : p.th ? (
                    <img src={p.th} alt={`Page ${i + 1}`} />
                  ) : (
                    <span className="ms" style={{ fontSize: '34px', color: 'var(--g)' }} aria-hidden="true">
                      {p.pdf ? 'picture_as_pdf' : (p.n?.toLowerCase().endsWith('.doc') || p.n?.toLowerCase().endsWith('.docx')) ? 'description' : (p.n?.toLowerCase().endsWith('.txt') || p.n?.toLowerCase().endsWith('.md')) ? 'article' : 'insert_drive_file'}
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
  // MULTI-REPORT PROJECT MANAGEMENT & SWITCHER
  // ==========================================
  const renderProjectSwitcher = () => {
    const isCurrentlySwitching = isSwitchingProject || isSwitchingRef.current;
    const currentActiveId = activeProject?.id;

    // Filter projects based on projectSearchQuery
    const query = projectSearchQuery.trim().toLowerCase();
    const filteredProjects = projects.filter((p) => {
      if (!query) return true;
      const titleMatch = (p.title || '').toLowerCase().includes(query);
      const nameMatch = (p.full_name || '').toLowerCase().includes(query);
      const matricMatch = (p.matric_number || '').toLowerCase().includes(query);
      const orgMatch = (p.organization_name || '').toLowerCase().includes(query);
      return titleMatch || nameMatch || matricMatch || orgMatch;
    });

    const activeTitle = activeProject?.full_name
      ? `${activeProject.title || 'SIWES Report'} · ${activeProject.full_name}`
      : activeProject?.title || 'SIWES Technical Report';

    const isPaidActive =
      activeProject?.is_paid ||
      (activeProject?.payment_orders &&
        activeProject.payment_orders.some((po: any) => po.status === 'paid'));
    const isReadyActive = activeProject?.report_status === 'ready';

    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => {
            setIsProjectDropdownOpen((prev) => {
              if (!prev) setProjectSearchQuery('');
              return !prev;
            });
          }}
          disabled={isCurrentlySwitching}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            maxWidth: 'clamp(180px, 32vw, 300px)',
            padding: '5px 12px',
            borderRadius: '20px',
            background: isCurrentlySwitching ? 'rgba(6, 107, 77, 0.04)' : 'rgba(6, 107, 77, 0.08)',
            border: '1px solid rgba(6, 107, 77, 0.18)',
            color: 'var(--ink)',
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: isCurrentlySwitching ? 'wait' : 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
          aria-expanded={isProjectDropdownOpen}
          aria-haspopup="dialog"
          aria-label="Switch Technical Report"
        >
          {isCurrentlySwitching ? (
            <span
              className="ms"
              style={{
                fontSize: '16px',
                color: 'var(--g)',
                animation: 'spin 0.8s linear infinite',
              }}
            >
              sync
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: isPaidActive ? '#066b4d' : isReadyActive ? '#0fa37a' : 'rgba(6, 107, 77, 0.2)',
                color: '#fff',
                fontSize: '11px',
                flexShrink: 0,
              }}
            >
              <span className="ms" style={{ fontSize: '13px' }}>
                folder
              </span>
            </span>
          )}

          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              textAlign: 'left',
            }}
          >
            {isCurrentlySwitching ? 'Switching report...' : activeTitle}
          </span>

          <span
            className="ms"
            style={{
              fontSize: '16px',
              color: 'var(--mut)',
              transition: 'transform 0.2s ease',
              transform: isProjectDropdownOpen ? 'rotate(180deg)' : 'none',
              flexShrink: 0,
            }}
          >
            expand_more
          </span>
        </button>

        {isProjectDropdownOpen && (
          <>
            {/* Backdrop overlay */}
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 998,
                background: 'rgba(0,0,0,0.15)',
              }}
              onClick={() => setIsProjectDropdownOpen(false)}
            />

            {/* Dropdown panel */}
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '360px',
                maxWidth: 'calc(100vw - 24px)',
                background: '#ffffff',
                borderRadius: '16px',
                boxShadow: '0 16px 40px -8px rgba(15, 23, 41, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.08)',
                zIndex: 999,
                overflow: 'hidden',
                textAlign: 'left',
                animation: 'fade 0.18s ease-out',
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--line)',
                  background: '#faf9f5',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 800,
                      color: 'var(--ink)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Switch Report
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: 'var(--gd)',
                      background: 'rgba(6, 107, 77, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                    }}
                  >
                    {projects.length} {projects.length === 1 ? 'report' : 'reports'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsProjectDropdownOpen(false);
                    switchTab('reports');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--gd)',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: '6px',
                  }}
                >
                  Manage
                </button>
              </div>

              {/* Search input (shown when >= 2 projects) */}
              {projects.length >= 2 && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--line)',
                    background: '#fff',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'var(--paper, #f8f6f1)',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <span className="ms" style={{ fontSize: '16px', color: 'var(--mut)' }}>
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Search reports or students..."
                      value={projectSearchQuery}
                      onChange={(e) => setProjectSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        border: 'none',
                        background: 'transparent',
                        fontSize: '12.5px',
                        color: 'var(--ink)',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                      autoFocus={projects.length > 3}
                    />
                    {projectSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setProjectSearchQuery('')}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--mut)',
                          padding: 0,
                          display: 'flex',
                        }}
                      >
                        <span className="ms" style={{ fontSize: '15px' }}>
                          close
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Projects List */}
              <div
                style={{
                  maxHeight: '260px',
                  overflowY: 'auto',
                }}
              >
                {filteredProjects.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 16px',
                      textAlign: 'center',
                      color: 'var(--mut)',
                      fontSize: '13px',
                    }}
                  >
                    <span
                      className="ms"
                      style={{ fontSize: '28px', color: '#c4bfb2', display: 'block', marginBottom: '4px' }}
                    >
                      search_off
                    </span>
                    No reports match &ldquo;{projectSearchQuery}&rdquo;
                  </div>
                ) : (
                  filteredProjects.map((proj) => {
                    const isActive = proj.id === currentActiveId;
                    const isTargetLoading =
                      isCurrentlySwitching &&
                      (switchingProjectId === proj.id || switchingToIdRef.current === proj.id);
                    const isPaid =
                      proj.is_paid ||
                      (proj.payment_orders &&
                        proj.payment_orders.some((po: any) => po.status === 'paid'));
                    const statusLabel = isPaid
                      ? 'Paid & Ready'
                      : proj.report_status === 'ready'
                      ? 'Report Ready'
                      : (proj.source_documents?.length || 0) > 0
                      ? `${proj.source_documents.length} pages`
                      : 'Draft';

                    return (
                      <button
                        key={proj.id}
                        type="button"
                        disabled={isCurrentlySwitching}
                        onClick={() => {
                          if (isCurrentlySwitching) return;
                          setIsProjectDropdownOpen(false);
                          if (!isActive) {
                            handleSwitchProject(proj.id);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          padding: '11px 16px',
                          background: isActive
                            ? 'rgba(6, 107, 77, 0.07)'
                            : isTargetLoading
                            ? 'rgba(6, 107, 77, 0.03)'
                            : 'transparent',
                          border: 'none',
                          borderLeft: isActive ? '3px solid var(--g)' : '3px solid transparent',
                          borderBottom: '1px solid var(--line)',
                          cursor: isCurrentlySwitching ? 'wait' : 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.15s ease',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, paddingRight: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div
                              style={{
                                fontSize: '13.5px',
                                fontWeight: isActive ? 800 : 600,
                                color: 'var(--ink)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {proj.title || 'SIWES Technical Report'}
                            </div>
                            {isActive && (
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  background: 'var(--g)',
                                  color: '#fff',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.02em',
                                  flexShrink: 0,
                                }}
                              >
                                Current
                              </span>
                            )}
                          </div>

                          {proj.full_name && (
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                color: 'var(--gd)',
                                marginTop: '2px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              👤 {proj.full_name}
                              {proj.matric_number ? ` · ${proj.matric_number}` : ''}
                            </div>
                          )}

                          <div
                            style={{
                              fontSize: '11.5px',
                              color: 'var(--mut)',
                              marginTop: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>{proj.organization_name || 'No company'}</span>
                            <span>•</span>
                            <span
                              style={{
                                color: isPaid
                                  ? '#066b4d'
                                  : proj.report_status === 'ready'
                                  ? '#0284c7'
                                  : 'inherit',
                                fontWeight: isPaid || proj.report_status === 'ready' ? 700 : 500,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>
                        </div>

                        {/* Right side status / spinner */}
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                          {isTargetLoading ? (
                            <span
                              className="ms"
                              style={{
                                color: 'var(--g)',
                                fontSize: '18px',
                                animation: 'spin 0.8s linear infinite',
                              }}
                            >
                              sync
                            </span>
                          ) : isActive ? (
                            <span
                              className="ms"
                              style={{
                                color: 'var(--g)',
                                fontSize: '20px',
                              }}
                            >
                              check_circle
                            </span>
                          ) : (
                            <span
                              className="ms"
                              style={{
                                color: 'var(--mut)',
                                fontSize: '18px',
                                opacity: 0.5,
                              }}
                            >
                              arrow_forward
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div
                style={{
                  padding: '10px 14px',
                  background: '#faf9f5',
                  borderTop: '1px solid var(--line)',
                }}
              >
                <button
                  type="button"
                  disabled={isCurrentlySwitching}
                  onClick={() => {
                    setIsProjectDropdownOpen(false);
                    setIsCreateReportModalOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    width: '100%',
                    padding: '9px 14px',
                    borderRadius: '10px',
                    background: 'var(--g)',
                    color: '#fff',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isCurrentlySwitching ? 'wait' : 'pointer',
                    boxShadow: '0 2px 6px rgba(6, 107, 77, 0.25)',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <span className="ms" style={{ fontSize: '16px' }}>
                    add
                  </span>
                  Create New Report
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderActiveProjectBanner = () => {
    if (!activeProject) return null;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(6, 107, 77, 0.05)',
          borderRadius: '12px',
          border: '1px solid rgba(6, 107, 77, 0.12)',
          margin: '0 0 16px',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span className="ms" style={{ color: 'var(--g)', fontSize: '20px', flexShrink: 0 }}>
            assignment
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '10.5px',
                textTransform: 'uppercase',
                color: 'var(--mut)',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              Active Technical Report
            </div>
            <div
              style={{
                fontSize: '13.5px',
                fontWeight: 800,
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeProject.title || 'SIWES Technical Report'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => switchTab('reports')}
          style={{
            padding: '5px 10px',
            fontSize: '11.5px',
            fontWeight: 700,
            color: 'var(--gd)',
            background: '#fff',
            border: '1px solid rgba(6, 107, 77, 0.2)',
            borderRadius: '8px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          All Reports ({projects.length})
        </button>
      </div>
    );
  };

  // ==========================================
  // VIEW: REPORTS (MULTI-PROJECT HUB)
  // ==========================================
  const renderReportsView = () => {
    const filteredProjects = projects.filter((proj) => {
      const isPaid =
        proj.is_paid ||
        (proj.payment_orders && proj.payment_orders.some((po: any) => po.status === 'paid'));
      const isReady = proj.report_status === 'ready' || isPaid;
      if (reportsFilter === 'ready') return isReady;
      if (reportsFilter === 'in_progress')
        return !isReady && (proj.source_documents?.length || 0) > 0;
      return true;
    });

    const readyCount = projects.filter(
      (p) =>
        p.is_paid ||
        p.report_status === 'ready' ||
        (p.payment_orders && p.payment_orders.some((po: any) => po.status === 'paid'))
    ).length;
    const inProgressCount = projects.filter(
      (p) =>
        !p.is_paid &&
        p.report_status !== 'ready' &&
        (!p.payment_orders || !p.payment_orders.some((po: any) => po.status === 'paid')) &&
        (p.source_documents?.length || 0) > 0
    ).length;

    return (
      <div className="view" id="reports-view">
        <header className="top">
          <span className="sp" />
          {renderProjectSwitcher()}
          <span className="sp" />
        </header>

        <div className="lg" style={{ paddingBottom: '10px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <h1 style={{ margin: 0 }}>Technical Reports</h1>
              <p
                style={{
                  margin: '4px 0 0',
                  color: 'var(--mut)',
                  fontSize: '13.5px',
                  fontWeight: 600,
                }}
              >
                {projects.length} {projects.length === 1 ? 'report project' : 'report projects'} in
                your account
              </p>
            </div>
            <button
              type="button"
              className="btn s"
              style={{
                background: 'var(--g)',
                color: '#fff',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                padding: '9px 16px',
                borderRadius: '10px',
              }}
              onClick={() => setIsCreateReportModalOpen(true)}
            >
              <span className="ms" aria-hidden="true" style={{ fontSize: '18px' }}>
                add
              </span>
              New Report
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        {projects.length > 0 && (
          <div
            className="seg"
            role="tablist"
            aria-label="Report filter tabs"
            style={{ marginBottom: '16px' }}
          >
            <button
              role="tab"
              type="button"
              aria-selected={reportsFilter === 'all'}
              onClick={() => setReportsFilter('all')}
            >
              All Reports ({projects.length})
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={reportsFilter === 'ready'}
              onClick={() => setReportsFilter('ready')}
            >
              Ready ({readyCount})
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={reportsFilter === 'in_progress'}
              onClick={() => setReportsFilter('in_progress')}
            >
              In Progress ({inProgressCount})
            </button>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="card big">
            <div className="ok">
              <span className="ms" aria-hidden="true">
                description
              </span>
            </div>
            <h2>No technical reports yet</h2>
            <p>
              Initialize your first SIWES report to upload logbook pages, review extracted entries,
              and compile an institutional report.
            </p>
            <button
              className="btn w"
              type="button"
              onClick={() => setIsCreateReportModalOpen(true)}
              style={{ textDecoration: 'none', marginTop: '20px' }}
            >
              + Create your first report
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="card" style={{ padding: '28px', textAlign: 'center' }}>
            <span className="ms" style={{ fontSize: '32px', color: 'var(--mut)' }}>
              filter_list_off
            </span>
            <h3 style={{ margin: '8px 0 4px', fontSize: '16px', fontWeight: 800 }}>
              No reports in this category
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--mut)' }}>
              Switch to "All Reports" to view all your technical reports.
            </p>
            <button
              type="button"
              className="btn o s"
              style={{ marginTop: '14px' }}
              onClick={() => setReportsFilter('all')}
            >
              View all reports
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {filteredProjects.map((proj) => {
              const isActive = proj.id === activeProject?.id;
              const isProjectPro =
                proj.tier === 'pro' ||
                proj.is_pro === true ||
                (user as any)?.tier === 'pro';
              const isPaid =
                isProjectPro ||
                proj.is_paid ||
                (proj.payment_orders &&
                  proj.payment_orders.some((po: any) => po.status === 'paid'));
              const isReady = proj.report_status === 'ready' || isPaid;
              const docCount = proj.source_documents?.length || 0;
              const pageCount = proj.actual_page_count || proj.estimated_pages || 0;

              return (
                <div
                  key={proj.id}
                  className="card"
                  style={{
                    padding: '18px',
                    border: isActive ? '2px solid var(--g)' : '1px solid var(--line)',
                    position: 'relative',
                  }}
                >
                  <div className="row sb" style={{ alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <b style={{ fontSize: '16.5px', color: 'var(--ink)' }}>
                          {proj.title || 'SIWES Technical Report'}
                        </b>
                        {isActive && (
                          <span
                            className="chip"
                            style={{
                              background: 'var(--mint)',
                              color: 'var(--gd)',
                              fontSize: '11px',
                              fontWeight: 800,
                              padding: '2px 8px',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      {proj.full_name && (
                        <div
                          style={{
                            fontSize: '13.5px',
                            fontWeight: 700,
                            color: 'var(--gd)',
                            marginTop: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <span className="ms" style={{ fontSize: '16px' }}>
                            person
                          </span>
                          <span>{proj.full_name}</span>
                          {proj.matric_number ? (
                            <span style={{ color: 'var(--mut)', fontWeight: 500, fontSize: '12px' }}>
                              · {proj.matric_number}
                            </span>
                          ) : null}
                        </div>
                      )}
                      <p className="mut" style={{ margin: '3px 0 0', fontSize: '13px' }}>
                        {proj.organization_name ? `${proj.organization_name} · ` : ''}
                        {proj.department ? `${proj.department} · ` : ''}
                        {proj.university_name || 'LASUSTECH'}
                      </p>
                    </div>

                    <div>
                      {isProjectPro ? (
                        <span
                          className="chip"
                          style={{ background: '#dcfce7', color: '#15803d', fontWeight: 800 }}
                        >
                          ✓ Pro Tier
                        </span>
                      ) : isPaid ? (
                        <span
                          className="chip"
                          style={{ background: '#dcfce7', color: '#15803d', fontWeight: 800 }}
                        >
                          ✓ Paid &amp; Ready
                        </span>
                      ) : isReady ? (
                        <span
                          className="chip"
                          style={{ background: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }}
                        >
                          Report Ready
                        </span>
                      ) : docCount > 0 ? (
                        <span
                          className="chip"
                          style={{ background: '#fef3c7', color: '#b45309', fontWeight: 700 }}
                        >
                          In Progress
                        </span>
                      ) : (
                        <span
                          className="chip"
                          style={{ background: 'var(--bg)', color: 'var(--mut)', fontWeight: 700 }}
                        >
                          Draft
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metadata Stats */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                      gap: '8px',
                      margin: '14px 0',
                      padding: '10px 12px',
                      background: 'var(--bg)',
                      borderRadius: '12px',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '10.5px',
                          color: 'var(--mut)',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        Source Pages
                      </div>
                      <div
                        style={{
                          fontSize: '15px',
                          fontWeight: 800,
                          color: 'var(--ink)',
                          marginTop: '2px',
                        }}
                      >
                        {docCount} {docCount === 1 ? 'page' : 'pages'}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '10.5px',
                          color: 'var(--mut)',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        Report Length
                      </div>
                      <div
                        style={{
                          fontSize: '15px',
                          fontWeight: 800,
                          color: 'var(--ink)',
                          marginTop: '2px',
                        }}
                      >
                        {pageCount > 0 ? `${pageCount} pages` : 'Pending'}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '10.5px',
                          color: 'var(--mut)',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        Created
                      </div>
                      <div
                        style={{
                          fontSize: '13.5px',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          marginTop: '3px',
                        }}
                      >
                        {proj.created_at
                          ? new Date(proj.created_at).toLocaleDateString()
                          : 'Recent'}
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {isActive ? (
                        <button
                          className="btn w s"
                          type="button"
                          style={{ flex: 1, minWidth: '160px' }}
                          onClick={() => {
                            if (isReady) {
                              setLogbookView('report');
                              switchTab('logbooks');
                            } else {
                              goToFlow(docCount > 0 ? 2 : 1);
                            }
                          }}
                        >
                          <span className="ms" aria-hidden="true">
                            {isReady ? 'edit_note' : 'play_arrow'}
                          </span>
                          {isReady ? 'Open & Edit Report' : 'Continue Workspace'}
                        </button>
                      ) : (
                        <button
                          className="btn o w s"
                          type="button"
                          disabled={isSwitchingProject || isSwitchingRef.current}
                          style={{ flex: 1, minWidth: '160px' }}
                          onClick={() =>
                            handleSwitchProject(proj.id, isReady ? 'report' : 'wizard')
                          }
                        >
                          <span
                            className="ms"
                            aria-hidden="true"
                            style={
                              (isSwitchingProject || isSwitchingRef.current) &&
                              (switchingProjectId === proj.id || switchingToIdRef.current === proj.id)
                                ? { animation: 'spin 0.8s linear infinite' }
                                : {}
                            }
                          >
                            {(isSwitchingProject || isSwitchingRef.current) &&
                            (switchingProjectId === proj.id || switchingToIdRef.current === proj.id)
                              ? 'sync'
                              : 'swap_horiz'}
                          </span>
                          {(isSwitchingProject || isSwitchingRef.current) &&
                          (switchingProjectId === proj.id || switchingToIdRef.current === proj.id)
                            ? 'Switching...'
                            : 'Switch to this Report'}
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn o s"
                        style={{
                          color: '#dc2626',
                          borderColor: 'rgba(220, 38, 38, 0.25)',
                          padding: '0 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Delete Report"
                        aria-label={`Delete ${proj.title || 'report'}`}
                        onClick={() => setProjectToDelete(proj)}
                      >
                        <span className="ms" aria-hidden="true" style={{ fontSize: '18px' }}>
                          delete_outline
                        </span>
                      </button>
                    </div>

                    {/* Quick export buttons when report is compiled */}
                    {isReady && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="btn o w s"
                          type="button"
                          style={{ flex: 1 }}
                          disabled={downloadLoading}
                          onClick={() => {
                            if (isPaid) {
                              executeRealFileDownload('PDF', proj.id);
                            } else {
                              if (!isActive) handleSwitchProject(proj.id);
                              setCheckoutModal('digital');
                            }
                          }}
                        >
                          <span
                            className="ms"
                            aria-hidden="true"
                            style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}
                          >
                            picture_as_pdf
                          </span>
                          {isPaid ? 'Download PDF' : 'Pay & Download PDF'}
                        </button>
                        <button
                          className="btn o w s"
                          type="button"
                          style={{ flex: 1 }}
                          disabled={downloadLoading}
                          onClick={() => {
                            if (isPaid) {
                              executeRealFileDownload('Word', proj.id);
                            } else {
                              if (!isActive) handleSwitchProject(proj.id);
                              setCheckoutModal('digital');
                            }
                          }}
                        >
                          <span
                            className="ms"
                            aria-hidden="true"
                            style={downloadLoading ? { animation: 'spin 1s linear infinite' } : {}}
                          >
                            description
                          </span>
                          {isPaid ? 'Download Word' : 'Pay & Download Word'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderCreateReportModal = () => (
    <div id="create-report-modal">
      <div
        className="bd"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 80,
          background: 'rgba(15, 23, 41, 0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'fade 0.25s',
        }}
        onClick={() => !isCreatingReport && setIsCreateReportModalOpen(false)}
      />
      <div
        className="sht"
        role="dialog"
        aria-modal="true"
        aria-label="Create Technical Report"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 81,
          background: 'var(--paper)',
          borderRadius: '32px 32px 0 0',
          padding: '12px 20px calc(24px + var(--sb))',
          maxHeight: '92%',
          overflowY: 'auto',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.25)',
          animation: 'up 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div className="hd" />
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '10px',
          }}
        >
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
              Create Technical Report
            </h2>
            <p style={{ fontSize: '12.5px', color: 'var(--mut)', margin: '4px 0 0', lineHeight: 1.4 }}>
              Set up a distinct report for yourself or for another student.
            </p>
          </div>
          <button
            type="button"
            className="ib"
            disabled={isCreatingReport}
            onClick={() => setIsCreateReportModalOpen(false)}
            aria-label="Close dialog"
            style={{ flexShrink: 0 }}
          >
            <span className="ms">close</span>
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const formData = new FormData(form);
            const fullName = (formData.get('fullName') as string)?.trim() || '';
            const matric = (formData.get('matric') as string)?.trim() || '';
            const university =
              (formData.get('university') as string)?.trim() ||
              'Lagos State University of Science and Technology';
            const faculty = (formData.get('faculty') as string)?.trim() || 'College of Basic Science';
            const dept = (formData.get('dept') as string)?.trim() || '';
            const orgName = (formData.get('orgName') as string)?.trim() || '';
            const title =
              (formData.get('title') as string)?.trim() ||
              (fullName ? `SIWES Report - ${fullName}` : `SIWES Technical Report #${projects.length + 1}`);

            setIsCreatingReport(true);
            try {
              const newProj = await createProject({
                title,
                full_name: fullName,
                matric_number: matric,
                university_name: university,
                faculty_school: faculty,
                college: faculty,
                department: dept,
                organization_name: orgName,
              });
              setIsCreateReportModalOpen(false);
              showToast(`New report created${fullName ? ` for ${fullName}` : ''}!`);
              await loadProjectWorkspace(newProj.id, { targetStep: 1 });
              goToFlow(1);
            } catch (err: any) {
              showToast(err.message || 'Failed to create report');
            } finally {
              setIsCreatingReport(false);
            }
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'rgba(6, 107, 77, 0.06)',
              border: '1px solid rgba(6, 107, 77, 0.18)',
              marginBottom: '14px',
              fontSize: '12.5px',
              color: 'var(--gd)',
              fontWeight: 600,
              lineHeight: 1.4,
            }}
          >
            💡 You can manage reports for different students on this account. Each report is completely separate with its own student particulars, logbook scans, and compiled document.
          </div>

          <div className="f" style={{ marginBottom: '14px' }}>
            <label>
              Student / Candidate Full Name <em>*</em>
            </label>
            <input
              name="fullName"
              type="text"
              required
              placeholder="e.g. Babatunde Fashola"
              autoFocus
            />
          </div>

          <div className="f" style={{ marginBottom: '14px' }}>
            <label>
              Matriculation / Student ID Number
            </label>
            <input
              name="matric"
              type="text"
              placeholder="e.g. 210591001"
            />
          </div>

          <div className="f" style={{ marginBottom: '14px' }}>
            <label>Institution / University</label>
            <select
              name="university"
              defaultValue="Lagos State University of Science and Technology"
            >
              {INSTITUTIONS.map((inst) => (
                <option key={inst} value={inst}>
                  {inst}
                </option>
              ))}
            </select>
          </div>

          <div className="f" style={{ marginBottom: '14px' }}>
            <label>Faculty / College</label>
            <select name="faculty" defaultValue="College of Basic Science">
              {COLLEGES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="f" style={{ marginBottom: '14px' }}>
            <label>Department / Course of Study</label>
            <input
              name="dept"
              type="text"
              placeholder="e.g. Computer Science"
            />
          </div>

          <div className="f" style={{ marginBottom: '14px' }}>
            <label>Company / Placement Organization</label>
            <input
              name="orgName"
              type="text"
              placeholder="e.g. MainOne Cables, Chevron Nigeria"
            />
          </div>

          <div className="f" style={{ marginBottom: '18px' }}>
            <label>Report Title / Reference</label>
            <input
              name="title"
              type="text"
              defaultValue={`SIWES Technical Report ${
                projects.length > 0 ? `#${projects.length + 1}` : ''
              }`}
              placeholder="e.g. SIWES Report - Software Engineering"
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '6px' }}>
            <button
              type="button"
              className="btn o s"
              disabled={isCreatingReport}
              onClick={() => setIsCreateReportModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn s"
              disabled={isCreatingReport}
              style={{
                background: 'var(--g)',
                color: '#fff',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isCreatingReport ? (
                <>
                  <span className="ms" style={{ animation: 'spin 1s linear infinite' }}>
                    sync
                  </span>
                  Creating...
                </>
              ) : (
                <>
                  <span className="ms">rocket_launch</span>
                  Start Technical Report
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderDeleteProjectModal = () => (
    <div id="delete-report-modal">
      <div
        className="bd"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 80,
          background: 'rgba(15, 23, 41, 0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'fade 0.25s',
        }}
        onClick={() => setProjectToDelete(null)}
      />
      <div
        className="sht"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Technical Report"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 81,
          background: 'var(--paper)',
          borderRadius: '32px 32px 0 0',
          padding: '12px 20px calc(24px + var(--sb))',
          maxHeight: '80%',
          overflowY: 'auto',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.25)',
          animation: 'up 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div className="hd" />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: 'rgba(220, 38, 38, 0.12)',
                color: '#dc2626',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <span className="ms" style={{ fontSize: '22px' }}>
                warning
              </span>
            </div>
            <h2 style={{ fontSize: '19px', margin: 0, fontWeight: 800, color: 'var(--ink)' }}>
              Delete Report?
            </h2>
          </div>
          <button
            type="button"
            className="ib"
            onClick={() => setProjectToDelete(null)}
            aria-label="Close dialog"
            style={{ flexShrink: 0 }}
          >
            <span className="ms">close</span>
          </button>
        </div>

        <p
          style={{
            fontSize: '13.5px',
            color: 'var(--ink)',
            lineHeight: 1.5,
            margin: '0 0 20px',
          }}
        >
          Are you sure you want to delete <b>{projectToDelete?.title || 'this report'}</b>? All
          uploaded logbook pages, extracted entries, and compiled reports for this project will be
          permanently removed.
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn o s"
            onClick={() => setProjectToDelete(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn s"
            style={{ background: '#dc2626', color: '#fff', border: 'none' }}
            onClick={async () => {
              const targetId = projectToDelete.id;
              setProjectToDelete(null);
              try {
                await deleteProject(targetId);
                showToast('Report deleted successfully');
                const nextActive = useProjectStore.getState().activeProject;
                if (nextActive?.id) {
                  await loadProjectWorkspace(nextActive.id);
                }
              } catch (err: any) {
                showToast(err.message || 'Failed to delete report');
              }
            }}
          >
            Delete Report
          </button>
        </div>
      </div>
    </div>
  );

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
          {renderProjectSwitcher()}
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
                <div className="s-val">{isPro ? 'Free (Pro Tier Included)' : 'NGN 2,000'}</div>
              </div>
              {(isPro || hasPaidDigital) && (
                <span className="chip" style={{ background: 'var(--mint)', color: 'var(--g)' }}>
                  {isPro ? 'Pro' : 'Unlocked'}
                </span>
              )}
            </div>

            {!isPro && (
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
            )}
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
  // WIZARD FLOW: STEP 1 (UPLOAD LOGBOOK)
  // ==========================================
  const renderStep1 = () => {
    const n = pages.length;

    return (
      <div className="view" id="step-1">
        <h1 className="wt" id="wh" tabIndex={-1}>
          Upload your logbook
        </h1>
        <p className="wd">Cover to last page, in order. The page check runs immediately to sequence your weeks.</p>

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
              accept="image/jpeg,image/png,image/webp,image/*,application/pdf,.pdf,.docx,.doc,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,text/markdown"
              multiple
              aria-label="Upload logbook documents (PDF, Word, Text, Images)"
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
        {pages.some((p) => p.isUploading || (p.uploadProgress !== undefined && p.uploadProgress < 100)) && (() => {
          const uploading = pages.filter((p) => p.isUploading || (p.uploadProgress !== undefined && p.uploadProgress < 100));
          const totalBytes = uploading.reduce((sum, p) => sum + (p.totalBytes || 0), 0);
          const uploadedBytes = uploading.reduce((sum, p) => sum + (p.bytesUploaded || 0), 0);
          const avgPct = totalBytes > 0
            ? Math.round((uploadedBytes / totalBytes) * 100)
            : Math.round(uploading.reduce((sum, p) => sum + (p.uploadProgress || 0), 0) / uploading.length);
          const isAlmostDone = avgPct >= 90;

          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: isAlmostDone ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.08)',
                border: `1px solid ${isAlmostDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(16, 185, 129, 0.24)'}`,
                color: 'var(--g)',
                fontSize: '13px',
                fontWeight: 600,
                margin: '12px 0',
              }}
              role="status"
              aria-live="polite"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="ms" style={{ animation: 'spin 1.2s linear infinite', fontSize: '20px' }}>
                  sync
                </span>
                <div>
                  <div>
                    Uploading {uploading.length} file{uploading.length > 1 ? 's' : ''}:{' '}
                    <strong style={{ fontSize: '14px' }}>{avgPct}%</strong>
                    {isAlmostDone && (
                      <span style={{ marginLeft: '8px', color: '#059669', fontWeight: 700 }}>
                        — Almost done!
                      </span>
                    )}
                  </div>
                  {totalBytes > 0 && (
                    <div style={{ fontSize: '11px', opacity: 0.8, fontWeight: 500, marginTop: '2px' }}>
                      {formatBytes(uploadedBytes)} of {formatBytes(totalBytes)} transferred
                    </div>
                  )}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '44px',
                  height: '44px',
                  borderRadius: '999px',
                  background: isAlmostDone ? '#059669' : 'var(--g)',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 800,
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
                }}
              >
                {avgPct}%
              </div>
            </div>
          );
        })()}

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
                        padding: '12px 6px',
                        boxSizing: 'border-box',
                        background: 'var(--bg)',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: '52px',
                          height: '52px',
                          borderRadius: '999px',
                          border: `3px solid ${(p.uploadProgress ?? 0) >= 90 ? '#059669' : 'rgba(16, 185, 129, 0.4)'}`,
                          background: (p.uploadProgress ?? 0) >= 90 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: (p.uploadProgress ?? 0) >= 90 ? '0 0 10px rgba(16, 185, 129, 0.25)' : 'none',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <span style={{ fontSize: '15px', fontWeight: 800, color: (p.uploadProgress ?? 0) >= 90 ? '#059669' : 'var(--g)', lineHeight: 1 }}>
                          {Math.round(p.uploadProgress ?? 0)}%
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          maxWidth: '90%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '6px',
                        }}
                        title={p.n}
                      >
                        {p.n}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: (p.uploadProgress ?? 0) >= 90 ? '#059669' : 'var(--g)',
                          marginTop: '2px',
                        }}
                      >
                        {(p.uploadProgress ?? 0) >= 100
                          ? 'Complete'
                          : (p.uploadProgress ?? 0) >= 90
                          ? 'Almost done…'
                          : 'Uploading…'}
                      </span>
                      {p.totalBytes ? (
                        <span style={{ fontSize: '9px', color: 'var(--ink)', opacity: 0.65, marginTop: '2px' }}>
                          {formatBytes(p.bytesUploaded)} / {formatBytes(p.totalBytes)}
                        </span>
                      ) : null}
                    </div>
                  ) : p.th ? (
                    <img src={p.th} alt={`Page ${i + 1}`} />
                  ) : (
                    <span className="ms" style={{ fontSize: '34px', color: 'var(--g)' }} aria-hidden="true">
                      {p.pdf ? 'picture_as_pdf' : (p.n?.toLowerCase().endsWith('.doc') || p.n?.toLowerCase().endsWith('.docx')) ? 'description' : (p.n?.toLowerCase().endsWith('.txt') || p.n?.toLowerCase().endsWith('.md')) ? 'article' : 'insert_drive_file'}
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
  // WIZARD FLOW: STEP 2 (CONFIRM YOUR DETAILS)
  // ==========================================
  const renderStep2 = () => {
    const startDateObj = details.start ? new Date(details.start) : null;
    const endDateObj = details.end ? new Date(details.end) : null;
    const durationDays = (startDateObj && endDateObj && !isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime()))
      ? Math.round((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 3600 * 24)) + 1
      : 0;
    const isShortDuration = durationDays > 0 && durationDays < 28;
    const isDateInverted = Boolean(details.start && details.end && details.start >= details.end);

    return (
      <div className="view" id="step-2">
        <h1 className="wt" id="wh" tabIndex={-1}>
          Confirm your details
        </h1>
        <p className="wd">Pre-filled from your logbook. Tap any value to edit or confirm.</p>

        {isDateInverted && (
          <div className="card" style={{ border: '1px solid #ef4444', background: 'rgba(239, 68, 68, 0.08)', padding: '12px 16px', borderRadius: '12px', marginBottom: '14px', color: '#b91c1c' }}>
            <span className="ms" style={{ verticalAlign: 'middle', marginRight: '6px' }}>error</span>
            <strong>Training start date must be before end date.</strong>
          </div>
        )}

        {isShortDuration && (
          <div className="card" style={{ border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', padding: '14px 16px', borderRadius: '12px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b45309', fontWeight: 600 }}>
              <span className="ms">info</span>
              <span>Short training duration ({durationDays} days)</span>
            </div>
            <p style={{ margin: '6px 0 10px', fontSize: '13px', color: 'var(--tx)' }}>
              Standard SIWES is usually 8 to 24 weeks. Did your department approve this short training period?
            </p>
            {shortDurationConfirmed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#059669', fontWeight: 600 }}>
                <span className="ms">check_circle</span>
                <span>Approved by institution / department</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={async () => {
                    setShortDurationConfirmed(true);
                    if (activeProject?.id) {
                      try {
                        await projectsApi.saveGuidedIntakeAnswer(activeProject.id, 'short_duration_confirmed', true);
                        showToast('Short training duration confirmed.');
                      } catch {}
                    }
                  }}
                >
                  <span className="ms">check</span> Yes, department approved
                </button>
                <button
                  type="button"
                  className="btn o"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => {
                    const el = document.getElementById('details-start') || document.getElementById('details-end');
                    if (el) el.focus();
                  }}
                >
                  Change dates
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {FLD.map(([k, label]) => {
            const val = details[k] || '';
            const isMissing = !val.trim();
            const source = fieldSources[k] === 'logbook' ? 'from your logbook' : 'your details';

            return (
              <div
                key={k}
                className="f"
                style={{
                  margin: 0,
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: isMissing ? '1px solid #ef4444' : '1px solid var(--bdr)',
                  background: isMissing ? 'rgba(239, 68, 68, 0.03)' : 'var(--bg)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label htmlFor={`details-${k}`} style={{ fontWeight: 600, fontSize: '13px' }}>
                    {label} <em aria-hidden="true" style={{ color: 'var(--e)' }}>*</em>
                  </label>
                  {!isMissing ? (
                    <span style={{ fontSize: '11px', color: '#059669', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="ms" style={{ fontSize: '13px' }}>check_circle</span>
                      {source} · tap to edit
                    </span>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>
                      Missing
                    </span>
                  )}
                </div>
                {k === 'fac' ? (
                  <select
                    id={`details-${k}`}
                    value={details[k] || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDetails((prev) => ({ ...prev, [k]: v }));
                      setFieldSources((prev) => ({ ...prev, [k]: 'you added' }));
                    }}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '14px', borderRadius: '8px' }}
                  >
                    {COLLEGES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`details-${k}`}
                    type={k === 'start' || k === 'end' ? 'date' : 'text'}
                    value={val}
                    placeholder={`Enter ${label.toLowerCase()}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDetails((prev) => ({ ...prev, [k]: v }));
                      setFieldSources((prev) => ({ ...prev, [k]: 'you added' }));
                    }}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '14px', borderRadius: '8px' }}
                  />
                )}
                {isMissing && (
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#ef4444' }}>
                    Required for your technical report title page and certification.
                  </p>
                )}
              </div>
            );
          })}
        </div>
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
  // WIZARD FLOW: STEP 5 (YOUR EXPERIENCE)
  // ==========================================
  const renderStepExperience = () => {
    // Collect logbook duties from verified entries
    const logbookDuties = entries
      .map((e) => (e.t || e.activity_summary || '').trim())
      .filter((text): text is string => Boolean(text));
    const displayDuties = experienceDuties || (logbookDuties.length > 0 ? logbookDuties.slice(0, 5).join('\n') : '');

    return (
      <div className="view" id="step-5-experience">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h1 className="wt" id="wh" tabIndex={-1} style={{ margin: 0 }}>Your experience</h1>
          {autoSaveStatus === 'saving' && (
            <span style={{ fontSize: '11px', color: 'var(--mut)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <span className="ms" style={{ fontSize: '13px', animation: 'spin 1s linear infinite' }}>sync</span> Saving...
            </span>
          )}
          {autoSaveStatus === 'saved' && (
            <span style={{ fontSize: '11px', color: 'var(--g)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <span className="ms" style={{ fontSize: '13px' }}>check_circle</span> Auto-saved
            </span>
          )}
        </div>
        <p className="wd" style={{ margin: '4px 0 16px', color: 'var(--mut)', fontSize: '13px' }}>
          Confirms your technical duties, tools, and reflections for Chapters 3 and 4.
        </p>

        {/* 1. Day-to-day Responsibilities */}
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label htmlFor="exp-duties" style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ms" style={{ color: 'var(--g)', fontSize: '18px' }}>assignment</span>
              What were you responsible for day-to-day?
            </label>
            <span style={{ fontSize: '11px', color: '#059669', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '8px' }}>
              from your logbook · tap to confirm
            </span>
          </div>
          <textarea
            id="exp-duties"
            rows={4}
            value={displayDuties}
            onChange={(e) => setExperienceDuties(e.target.value)}
            placeholder="e.g. Diagnosed hardware and network interface issues.\nInstalled operating systems and configured office workstations.\nAssisted software team with code testing and documentation."
            style={{ width: '100%', padding: '10px 12px', fontSize: '13px', borderRadius: '8px', lineHeight: 1.5 }}
          />

          <div style={{ marginTop: '10px' }}>
            <label htmlFor="exp-add" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--mut)' }}>
              Anything to add? (Optional)
            </label>
            <input
              id="exp-add"
              type="text"
              value={experienceAdditional}
              onChange={(e) => setExperienceAdditional(e.target.value)}
              placeholder="e.g. Attended weekly technical design reviews with senior engineers"
              style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px', marginTop: '4px' }}
            />
          </div>
        </div>

        {/* 2. Tools or Equipment Used */}
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ms" style={{ color: 'var(--g)', fontSize: '18px' }}>build</span>
              What tools or equipment did you use?
            </label>
            <span style={{ fontSize: '11px', color: 'var(--mut)' }}>
              tap off or add to
            </span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--mut)' }}>
            Populated from your logbook entries. Only tools you keep here will be included.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            {experienceTools.map((tool, idx) => (
              <span
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  fontSize: '13px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid var(--g)',
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                <span>{tool}</span>
                <button
                  type="button"
                  className="tx"
                  style={{ padding: 0, color: 'var(--mut)', fontSize: '14px', lineHeight: 1 }}
                  onClick={() => setExperienceTools(experienceTools.filter((_, i) => i !== idx))}
                  aria-label={`Remove ${tool}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={newToolInput}
              onChange={(e) => setNewToolInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newToolInput.trim()) {
                  e.preventDefault();
                  if (!experienceTools.includes(newToolInput.trim())) {
                    setExperienceTools([...experienceTools, newToolInput.trim()]);
                  }
                  setNewToolInput('');
                }
              }}
              placeholder="e.g. Cisco Packet Tracer, Wireshark, Docker"
              style={{ flex: 1, padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
            />
            <button
              type="button"
              className="btn o"
              style={{ padding: '8px 14px', fontSize: '13px' }}
              onClick={() => {
                if (newToolInput.trim() && !experienceTools.includes(newToolInput.trim())) {
                  setExperienceTools([...experienceTools, newToolInput.trim()]);
                  setNewToolInput('');
                }
              }}
            >
              + Add tool
            </button>
          </div>
        </div>

        {/* 3. Challenges Faced */}
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="ms" style={{ color: 'var(--g)', fontSize: '18px' }}>psychology</span>
              Any challenges you faced? <span className="mut" style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <button
              type="button"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: '8px',
                border: challengesNone ? '1.5px solid #059669' : '1.5px solid #64748b',
                background: challengesNone ? '#059669' : '#ffffff',
                color: challengesNone ? '#ffffff' : '#0f172a',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.15s ease',
              }}
              onClick={() => {
                const nextNone = !challengesNone;
                setChallengesNone(nextNone);
                if (nextNone) {
                  setChallengeText('');
                  setSolutionText('');
                  setChallenge2Text('');
                  setSolution2Text('');
                  setShowSecondPair(false);
                }
              }}
            >
              <span className="ms" style={{ fontSize: '14px' }}>
                {challengesNone ? 'check' : 'add'}
              </span>
              {challengesNone ? '✓ Nothing major' : 'Nothing major'}
            </button>
          </div>

          {!challengesNone ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mut)' }}>Challenge 1</span>
                <input
                  type="text"
                  value={challengeText}
                  onChange={(e) => setChallengeText(e.target.value)}
                  placeholder="What real challenge did you encounter? (e.g. Intermittent network connectivity during deployment)"
                  style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
                />
                <input
                  type="text"
                  value={solutionText}
                  onChange={(e) => setSolutionText(e.target.value)}
                  placeholder="How did you resolve it? (e.g. Re-terminated Ethernet RJ-45 connectors and rerouted trunk lines)"
                  style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
                />
              </div>

              {!showSecondPair ? (
                <button
                  type="button"
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--bdr, #cbd5e1)',
                    background: 'var(--card-bg, #ffffff)',
                    color: 'var(--ink, #0f172a)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    alignSelf: 'flex-start',
                    marginTop: '4px',
                  }}
                  onClick={() => setShowSecondPair(true)}
                >
                  <span className="ms" style={{ fontSize: '15px', color: 'var(--g)' }}>add</span>
                  Add another challenge & solution (optional)
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', background: 'var(--bg, #f8fafc)', borderRadius: '8px', border: '1px solid var(--bdr, #cbd5e1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mut)' }}>Challenge 2 (optional)</span>
                    <button
                      type="button"
                      style={{ fontSize: '11px', color: 'var(--mut)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                      onClick={() => {
                        setShowSecondPair(false);
                        setChallenge2Text('');
                        setSolution2Text('');
                      }}
                    >
                      Remove ×
                    </button>
                  </div>
                  <input
                    type="text"
                    value={challenge2Text}
                    onChange={(e) => setChallenge2Text(e.target.value)}
                    placeholder="Second challenge encountered..."
                    style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
                  />
                  <input
                    type="text"
                    value={solution2Text}
                    onChange={(e) => setSolution2Text(e.target.value)}
                    placeholder="How was this second challenge resolved?..."
                    style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
                  />
                </div>
              )}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--mut)' }}>
              Selected: Nothing major. Log2Def will state that duties were completed without significant impediment.
            </p>
          )}
        </div>

        {/* 4. Recommendations */}
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <label style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '18px' }}>recommend</span>
            Recommendations for {details.co || 'organisation'} or SIWES? <span className="mut" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--mut)' }}>
            Tap suggestions to include, or type your own. Suggestions start unselected.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
            {RECOMMENDATION_SUGGESTIONS.map((sug, idx) => {
              const isSelected = selectedRecommendations.includes(sug);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setSelectedRecommendations(selectedRecommendations.filter((item) => item !== sug));
                    } else {
                      setSelectedRecommendations([...selectedRecommendations, sug]);
                    }
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    border: isSelected ? '1px solid var(--g)' : '1px solid var(--bdr)',
                    background: isSelected ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--ink)',
                  }}
                >
                  <span className="ms" style={{ fontSize: '16px', color: isSelected ? 'var(--g)' : 'var(--mut)' }}>
                    {isSelected ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                  <span>{sug}</span>
                </button>
              );
            })}
          </div>

          <input
            type="text"
            value={customRecommendation}
            onChange={(e) => setCustomRecommendation(e.target.value)}
            placeholder="+ Add your own custom recommendation"
            style={{ width: '100%', padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
          />
        </div>
      </div>
    );
  };

  // ==========================================
  // WIZARD FLOW: STEP 4 (ABOUT ORGANISATION - 4 SCREENS)
  // ==========================================
  const renderStepOrganisation = () => {
    const orgName = details.co?.trim() || 'your organisation';

    const saveOrgScreen = async (nextScreen: 1 | 2 | 3 | 4) => {
      await saveStep4Data();
      trackWizardEvent('step4_organisation', `screen_${orgScreen}`, 'screen_completed');
      setOrgScreen(nextScreen);
      if (scrRef.current) scrRef.current.scrollTop = 0;
    };

    const treeToShow = isEditingTree ? customTreeText : computeOrganogramTree(headTitle, orgUnits, studentUnit, supervisorTitle);

    return (
      <div className="view" id="step-4-org">
        {/* Step indicator header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--g)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              About {orgName} · Screen {orgScreen} of 4
            </span>
            {autoSaveStatus === 'saving' && (
              <span style={{ fontSize: '11px', color: 'var(--mut)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <span className="ms" style={{ fontSize: '13px', animation: 'spin 1s linear infinite' }}>sync</span> Saving...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span style={{ fontSize: '11px', color: 'var(--g)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <span className="ms" style={{ fontSize: '13px' }}>check_circle</span> Auto-saved
              </span>
            )}
          </div>
          {orgScreen > 1 && (
            <button
              type="button"
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: '8px',
                border: '1.5px solid var(--bdr, #cbd5e1)',
                background: 'var(--card-bg, #ffffff)',
                color: 'var(--ink, #0f172a)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
              onClick={() => saveOrgScreen(Math.max(1, orgScreen - 1) as 1 | 2 | 3 | 4)}
            >
              <span className="ms" style={{ fontSize: '15px' }}>arrow_back</span> Back
            </button>
          )}
        </div>

        {/* SCREEN 1: What does organisation do? */}
        {orgScreen === 1 && (
          <div>
            <h1 className="wt" id="wh" tabIndex={-1}>What does {orgName} do?</h1>
            <p className="wd" style={{ margin: '4px 0 16px', color: 'var(--mut)', fontSize: '13px' }}>
              Used for Section 2.1 (Brief History & Background) of your technical report.
            </p>

            <div className="f" style={{ margin: '14px 0' }}>
              <label htmlFor="org-what" style={{ fontWeight: 600, fontSize: '14px' }}>
                Core activities or domain <em aria-hidden="true" style={{ color: 'var(--e)' }}>*</em>
              </label>
              <textarea
                id="org-what"
                rows={4}
                value={orgWhat}
                onChange={(e) => setOrgWhat(e.target.value)}
                placeholder="e.g. A technology solutions company specializing in web application development, cloud infrastructure, and IT consultancy services for businesses and public institutions."
                style={{ width: '100%', padding: '12px', fontSize: '14px', borderRadius: '10px' }}
              />
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--mut)' }}>
                Grey hint is an example — your answer should reflect where you trained.
              </p>
            </div>

            {/* I'm not sure path */}
            <div style={{ marginTop: '16px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg, #f8fafc)', border: '1.5px solid var(--bdr, #cbd5e1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink, #0f172a)' }}>Not sure about their background?</span>
                <button
                  type="button"
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: orgNotSure ? '1.5px solid #059669' : '1.5px solid #64748b',
                    background: orgNotSure ? '#059669' : '#ffffff',
                    color: orgNotSure ? '#ffffff' : '#0f172a',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => {
                    const nextVal = !orgNotSure;
                    setOrgNotSure(nextVal);
                    if (nextVal && !orgWhat.trim()) {
                      setOrgWhat(`${orgName} is an established technical organisation located in ${details.addr || 'Nigeria'}.`);
                    }
                  }}
                >
                  <span className="ms" style={{ fontSize: '14px' }}>
                    {orgNotSure ? 'check' : 'help_outline'}
                  </span>
                  {orgNotSure ? 'Using standard details ✓' : "I'm not sure"}
                </button>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--mut)' }}>
                If you're not sure, Log2Def will synthesize verified details from your placement location and let you polish it later.
              </p>
            </div>
          </div>
        )}

        {/* SCREEN 2: When started and where based */}
        {orgScreen === 2 && (
          <div>
            <h1 className="wt" id="wh" tabIndex={-1}>When did it start and where is it based?</h1>
            <p className="wd" style={{ margin: '4px 0 16px', color: 'var(--mut)', fontSize: '13px' }}>
              Gives historical and geographic context to your SIWES attachment.
            </p>

            <div className="f" style={{ margin: '14px 0' }}>
              <label htmlFor="org-when" style={{ fontWeight: 600, fontSize: '14px' }}>
                Year founded or began operations <span className="mut" style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="org-when"
                type="text"
                value={orgWhen}
                onChange={(e) => setOrgWhen(e.target.value)}
                placeholder="e.g. Founded in 2018"
                style={{ width: '100%', padding: '10px 12px', fontSize: '14px', borderRadius: '10px' }}
              />
            </div>

            <div className="f" style={{ margin: '14px 0' }}>
              <label htmlFor="org-where" style={{ fontWeight: 600, fontSize: '14px' }}>
                Location / headquarters
              </label>
              <input
                id="org-where"
                type="text"
                value={orgWhere || details.addr || ''}
                onChange={(e) => setOrgWhere(e.target.value)}
                placeholder="e.g. Ikeja, Lagos State"
                style={{ width: '100%', padding: '10px 12px', fontSize: '14px', borderRadius: '10px' }}
              />
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--g)' }}>
                Pre-filled from your company address.
              </p>
            </div>
          </div>
        )}

        {/* SCREEN 3: What does it aim to achieve (Mission & Objectives) */}
        {orgScreen === 3 && (
          <div>
            <h1 className="wt" id="wh" tabIndex={-1}>What does {orgName} aim to achieve?</h1>
            <p className="wd" style={{ margin: '4px 0 16px', color: 'var(--mut)', fontSize: '13px' }}>
              Used for Section 2.2 (Objectives of the Organisation).
            </p>

            {/* Toggle between writing and pasting */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <button
                type="button"
                className={`btn ${!orgPasteMode ? '' : 'o'}`}
                style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                onClick={() => setOrgPasteMode(false)}
              >
                Summarize objectives
              </button>
              <button
                type="button"
                className={`btn ${orgPasteMode ? '' : 'o'}`}
                style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                onClick={() => setOrgPasteMode(true)}
              >
                <span className="ms" style={{ fontSize: '16px' }}>content_paste</span> Paste from website
              </button>
            </div>

            {orgPasteMode ? (
              <div className="f" style={{ margin: '14px 0' }}>
                <label htmlFor="org-paste" style={{ fontWeight: 600, fontSize: '14px' }}>
                  Paste text from their website or company profile
                </label>
                <textarea
                  id="org-paste"
                  rows={5}
                  value={orgPasteText}
                  onChange={(e) => setOrgPasteText(e.target.value)}
                  placeholder="Paste their 'About Us', 'Mission', or 'Objectives' paragraph here..."
                  style={{ width: '100%', padding: '12px', fontSize: '14px', borderRadius: '10px' }}
                />
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--mut)' }}>
                  The writer will use this pasted text as its sole authoritative source for this section.
                </p>
              </div>
            ) : (
              <div className="f" style={{ margin: '14px 0' }}>
                <label htmlFor="org-objectives" style={{ fontWeight: 600, fontSize: '14px' }}>
                  Mission or main objectives <em aria-hidden="true" style={{ color: 'var(--e)' }}>*</em>
                </label>
                <textarea
                  id="org-objectives"
                  rows={4}
                  value={orgObjectives}
                  onChange={(e) => setOrgObjectives(e.target.value)}
                  placeholder="e.g. To deliver secure, high-availability software solutions and cultivate technological talent across West Africa."
                  style={{ width: '100%', padding: '12px', fontSize: '14px', borderRadius: '10px' }}
                />
              </div>
            )}

            {/* I'm not sure path */}
            <div style={{ marginTop: '16px', padding: '14px 16px', borderRadius: '10px', background: 'var(--bg, #f8fafc)', border: '1.5px solid var(--bdr, #cbd5e1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink, #0f172a)' }}>Don't have their formal mission statement?</span>
                <button
                  type="button"
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '6px 14px',
                    borderRadius: '8px',
                    border: '1.5px solid #059669',
                    background: '#ecfdf5',
                    color: '#065f46',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => {
                    setOrgObjectives(`To deliver professional services, engineering quality, and innovative technical solutions in its operational domain.`);
                    showToast('Standard institutional objectives added.');
                  }}
                >
                  <span className="ms" style={{ fontSize: '14px' }}>add_task</span>
                  Use general objective
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SCREEN 4: Leadership, Units, and Auto-built Organogram */}
        {orgScreen === 4 && (
          <div>
            <h1 className="wt" id="wh" tabIndex={-1}>Organisation Structure & Organogram</h1>
            <p className="wd" style={{ margin: '4px 0 16px', color: 'var(--mut)', fontSize: '13px' }}>
              Auto-builds Section 2.3 (Structure) and Section 2.4 (Organogram) from your entered boxes.
            </p>

            <div className="f" style={{ margin: '12px 0' }}>
              <label htmlFor="org-head" style={{ fontWeight: 600, fontSize: '13px' }}>
                Who heads {orgName}? (Job title) <em aria-hidden="true" style={{ color: 'var(--e)' }}>*</em>
              </label>
              <input
                id="org-head"
                type="text"
                value={headTitle}
                onChange={(e) => setHeadTitle(e.target.value)}
                placeholder="e.g. Managing Director / Chief Executive Officer"
                style={{ width: '100%', padding: '10px 12px', fontSize: '14px', borderRadius: '8px' }}
              />
            </div>

            <div className="f" style={{ margin: '12px 0' }}>
              <label style={{ fontWeight: 600, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                Departments or Operating Units (add as chips)
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                {orgUnits.map((unit, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 12px',
                      borderRadius: '16px',
                      fontSize: '13px',
                      background: studentUnit === unit ? 'rgba(16, 185, 129, 0.15)' : 'var(--card-bg, #ffffff)',
                      border: studentUnit === unit ? '1.5px solid var(--g)' : '1px solid var(--bdr)',
                      fontWeight: studentUnit === unit ? 700 : 500,
                      color: 'var(--ink, #0f172a)',
                    }}
                  >
                    <span>{unit}</span>
                    <button
                      type="button"
                      style={{ padding: '0 4px', color: 'var(--mut)', fontSize: '14px', lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
                      onClick={() => setOrgUnits(orgUnits.filter((_, i) => i !== idx))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={newUnitInput}
                  onChange={(e) => setNewUnitInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newUnitInput.trim()) {
                      e.preventDefault();
                      setOrgUnits([...orgUnits, newUnitInput.trim()]);
                      setNewUnitInput('');
                    }
                  }}
                  placeholder="Add another unit/department and press enter"
                  style={{ flex: 1, padding: '8px 10px', fontSize: '13px', borderRadius: '8px' }}
                />
                <button
                  type="button"
                  className="btn o"
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                  onClick={() => {
                    if (newUnitInput.trim()) {
                      setOrgUnits([...orgUnits, newUnitInput.trim()]);
                      setNewUnitInput('');
                    }
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <div className="f" style={{ margin: '12px 0' }}>
              <label style={{ fontWeight: 600, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                Which unit did you work in? <em aria-hidden="true" style={{ color: 'var(--e)' }}>*</em>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {orgUnits.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={`btn ${studentUnit === u ? '' : 'o'}`}
                    style={{
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: studentUnit === u ? 700 : 500,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}
                    onClick={() => {
                      setStudentUnit(u);
                      saveStep4Data({ student_unit: u });
                    }}
                  >
                    {studentUnit === u && <span className="ms" style={{ fontSize: '14px' }}>check</span>}
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="f" style={{ margin: '12px 0' }}>
              <label htmlFor="supervisor-title" style={{ fontWeight: 600, fontSize: '13px' }}>
                Who supervised you? (Job title) <span className="mut" style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="supervisor-title"
                type="text"
                value={supervisorTitle}
                onChange={(e) => setSupervisorTitle(e.target.value)}
                placeholder="e.g. Senior Software Engineer / Technical Lead"
                style={{ width: '100%', padding: '10px 12px', fontSize: '14px', borderRadius: '8px' }}
              />
            </div>

            {/* LIVE ORGANOGRAM PREVIEW */}
            <div style={{ marginTop: '18px', padding: '14px', borderRadius: '12px', background: 'var(--bg)', border: '1px solid var(--bdr)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="ms" style={{ fontSize: '18px', color: 'var(--g)' }}>account_tree</span>
                  Organogram Preview (Never adds unentered boxes)
                </span>
                <button
                  type="button"
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '5px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid #64748b',
                    background: '#ffffff',
                    color: '#0f172a',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => {
                    setIsEditingTree(!isEditingTree);
                    if (!customTreeText) {
                      setCustomTreeText(computeOrganogramTree(headTitle, orgUnits, studentUnit, supervisorTitle));
                    }
                  }}
                >
                  <span className="ms" style={{ fontSize: '14px', color: '#059669' }}>
                    {isEditingTree ? 'account_tree' : 'edit'}
                  </span>
                  {isEditingTree ? 'Use auto-build' : 'Edit as text'}
                </button>
              </div>

              {isEditingTree ? (
                <textarea
                  rows={6}
                  value={customTreeText}
                  onChange={(e) => setCustomTreeText(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px', borderRadius: '8px' }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 4px' }}>
                  {treeToShow.split('\n').map((line, idx) => {
                    if (!line.trim()) return null;
                    const indent = line.length - line.trimStart().length;
                    const isStudent = line.includes('SIWES Intern');
                    return (
                      <div
                        key={idx}
                        style={{
                          marginLeft: `${indent * 12}px`,
                          padding: '6px 12px',
                          borderRadius: '8px',
                          background: isStudent ? 'rgba(16, 185, 129, 0.15)' : indent === 0 ? 'rgba(30, 41, 59, 0.06)' : 'var(--card-bg, #fff)',
                          border: isStudent ? '1px solid var(--g)' : '1px solid var(--bdr)',
                          fontSize: '13px',
                          fontWeight: isStudent || indent === 0 ? 700 : 500,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          width: 'fit-content',
                        }}
                      >
                        <span className="ms" style={{ fontSize: '14px', color: isStudent ? 'var(--g)' : 'var(--mut)' }}>
                          {indent === 0 ? 'domain' : isStudent ? 'school' : 'person'}
                        </span>
                        {line.trim()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
  const renderStepExtras = () => {
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
        if (typeof projectsApi?.uploadReportImage === 'function') {
          const saved = await projectsApi.uploadReportImage(pid, formData);
          setReportImages((current) => [...current, saved]);
        }
      } catch (error) {
        setImageError(error instanceof Error ? error.message : 'The image could not be uploaded.');
      } finally {
        setImageUploading(false);
      }
    };

    return (
      <div className="view" id="step-6-extras">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h1 className="wt" id="wh" tabIndex={-1} style={{ margin: 0 }}>Extras</h1>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '12px', background: 'var(--card-sub)', color: 'var(--mut)', letterSpacing: '0.4px', textTransform: 'uppercase' }}>All Optional</span>
        </div>
        <p className="wd" style={{ marginBottom: '16px', lineHeight: 1.5, color: 'var(--mut)', fontSize: '13px' }}>
          Personalize your report with a dedication, acknowledgements, or workplace photos. All items here are optional — you can fill any or tap <b>Skip all</b> below.
        </p>

        {/* 1. Dedication (Optional) */}
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Dedication</span>
            <span style={{ fontSize: '11px', color: 'var(--mut)' }}>Optional</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: 'var(--mut)' }}>
            Who do you want to dedicate this technical report to?
          </p>
          <textarea
            className="w-full"
            rows={2}
            value={dedicationText}
            onChange={(e) => setDedicationText(e.target.value)}
            placeholder="e.g. This report is dedicated to Almighty God and to my loving parents for their constant support..."
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              background: 'var(--card-sub)',
              fontSize: '13px',
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
        </div>

        {/* 2. Acknowledgements (Optional) */}
        <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Acknowledgements</span>
            <span style={{ fontSize: '11px', color: 'var(--mut)' }}>Optional</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: 'var(--mut)' }}>
            Who helped you during your training? Quick chips:
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {['God Almighty', 'My Parents & Family', 'Industry Supervisor', 'Institution Supervisor'].map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip"
                onClick={() => {
                  setAcknowledgementText((prev) => {
                    const clean = prev.trim();
                    if (!clean) return `I express special gratitude to ${chip}.`;
                    return `${clean} Also to ${chip}.`;
                  });
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: '14px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  border: '1px solid var(--line)',
                  background: 'var(--card-sub)',
                  color: 'var(--ink)',
                }}
              >
                + {chip}
              </button>
            ))}
          </div>
          <textarea
            className="w-full"
            rows={2}
            value={acknowledgementText}
            onChange={(e) => setAcknowledgementText(e.target.value)}
            placeholder="e.g. My sincere appreciation to my industrial-based supervisor, colleagues, and institution staff..."
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              background: 'var(--card-sub)',
              fontSize: '13px',
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
        </div>

        {/* 3. Workplace Photos (Optional, max 6) */}
        <div className="card" style={{ padding: '16px 18px', borderRadius: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Workplace Photos</span>
            <span style={{ fontSize: '11px', color: 'var(--mut)' }}>Max 6 photos</span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '12.5px', color: 'var(--mut)' }}>
            Attach photos of your work, tools, or projects to include in your technical report.
          </p>

          <div
            onClick={() => {
              if (!imageUploading && reportImages.length < 6) {
                document.getElementById('step6-image-input')?.click();
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px 16px',
              borderRadius: '14px',
              border: '1.5px dashed var(--line)',
              background: 'var(--card-sub)',
              cursor: reportImages.length >= 6 ? 'not-allowed' : 'pointer',
              textAlign: 'center',
            }}
          >
            <span className="ms" style={{ fontSize: '28px', color: 'var(--g)', marginBottom: '4px' }}>
              {reportImages.length >= 6 ? 'task_alt' : 'add_photo_alternate'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
              {reportImages.length >= 6 ? 'Maximum 6 photos reached' : 'Tap to add photos'}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--mut)', marginTop: '2px' }}>
              {reportImages.length === 0
                ? 'Supports JPG, PNG, WebP or HEIC'
                : `${reportImages.length} of 6 photos added`}
            </span>
          </div>

          <input
            id="step6-image-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            disabled={imageUploading || reportImages.length >= 6}
            style={{ display: 'none' }}
            onChange={async (event) => {
              const files = Array.from(event.target.files || []);
              for (const file of files) await uploadImage(file);
              event.currentTarget.value = '';
            }}
          />

          {imageUploading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px', marginTop: '12px', color: 'var(--g)', fontSize: '13px', fontWeight: 600 }}>
              <span className="ms" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
              Processing photo…
            </div>
          )}

          {imageError && (
            <div style={{ padding: '10px 14px', marginTop: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', color: '#b91c1c', fontSize: '12px' }}>
              {imageError}
            </div>
          )}

          {reportImages.length > 0 && (
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {reportImages.map((image, index) => {
                const hasValidCaption = validReportImageCaption(image.caption);
                return (
                  <div
                    key={image.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: '12px',
                      border: '1px solid var(--line)',
                      background: 'var(--card)',
                    }}
                  >
                    {image.processed_url ? (
                      <img
                        src={image.processed_url}
                        alt={image.caption}
                        style={{
                          width: '56px',
                          height: '56px',
                          objectFit: 'cover',
                          borderRadius: '8px',
                          flexShrink: 0,
                          border: '1px solid var(--line)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '8px',
                          background: 'var(--card-sub)',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <span className="ms" style={{ color: 'var(--mut)' }}>image</span>
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <input
                        value={image.caption}
                        placeholder="Caption (min. 3 words)"
                        aria-label={`Caption for image ${index + 1}`}
                        onChange={(event) =>
                          setReportImages((current) =>
                            current.map((item) => (item.id === image.id ? { ...item, caption: event.target.value } : item))
                          )
                        }
                        onBlur={() => {
                          if (validReportImageCaption(image.caption) && typeof projectsApi?.updateReportImage === 'function') {
                            projectsApi.updateReportImage(pid!, image.id, { caption: image.caption }).catch(() => {});
                          }
                        }}
                        style={{
                          width: '100%',
                          border: 'none',
                          borderBottom: hasValidCaption ? '1px solid var(--line)' : '1px solid #f87171',
                          background: 'transparent',
                          fontSize: '13px',
                          fontWeight: 600,
                          padding: '2px 0',
                          outline: 'none',
                        }}
                      />
                      <select
                        value={image.placement}
                        aria-label={`Placement for image ${index + 1}`}
                        onChange={(event) => {
                          const placement = event.target.value;
                          setReportImages((current) =>
                            current.map((item) => (item.id === image.id ? { ...item, placement } : item))
                          );
                          if (typeof projectsApi?.updateReportImage === 'function') {
                            projectsApi.updateReportImage(pid!, image.id, { placement }).catch(() => {});
                          }
                        }}
                        style={{
                          fontSize: '11px',
                          color: 'var(--mut)',
                          border: 'none',
                          background: 'transparent',
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      >
                        <option value="week">Chapter 3: Weekly Activity</option>
                        <option value="organisation">Chapter 2: Organisation Profile</option>
                        <option value="tools">Chapter 3: Equipment & Tools</option>
                        <option value="projects">Chapter 3: Key Projects</option>
                        <option value="challenges">Chapter 3: Workplace Challenges</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      className="tx"
                      title="Remove image"
                      onClick={async () => {
                        if (typeof projectsApi?.deleteReportImage === 'function') {
                          await projectsApi.deleteReportImage(pid!, image.id);
                        }
                        setReportImages((current) => current.filter((item) => item.id !== image.id));
                      }}
                      style={{
                        padding: '6px',
                        borderRadius: '6px',
                        color: 'var(--mut)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        lineHeight: 1,
                      }}
                    >
                      <span className="ms" style={{ fontSize: '18px' }}>close</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Skip All one-tap */}
        <div style={{ textAlign: 'center', margin: '8px 0 16px' }}>
          <button
            type="button"
            className="tx"
            onClick={() => {
              setStep(7);
              if (scrRef.current) scrRef.current.scrollTop = 0;
            }}
            style={{ fontSize: '13px', color: 'var(--mut)', fontWeight: 600 }}
          >
            Skip all extras and view summary →
          </button>
        </div>
      </div>
    );
  };
  const renderStepImages = renderStepExtras;

  // ==========================================
  const renderStepReadySummary = () => {
    const n = pages.length;
    const wk = entries.length;
    const layout = computeLayout();

    // Check completeness
    const missingItems: { label: string; stepTarget: number }[] = [];
    if (pages.length === 0) {
      missingItems.push({ label: 'Logbook pages (Upload at least one page)', stepTarget: 1 });
    }
    if (!details.name || !details.matric || !details.dept || !details.inst || !details.co || !details.start || !details.end) {
      missingItems.push({ label: 'Student and institution details', stepTarget: 2 });
    }
    if (entries.length === 0) {
      missingItems.push({ label: 'Logbook weekly activity entries', stepTarget: 3 });
    }
    const hasOrgInfo = Boolean(
      (orgWhat && orgWhat.trim()) ||
      activeProject?.guided_intake?.organisation_what ||
      activeProject?.guided_intake?.organisation_objectives
    );
    if (!hasOrgInfo) {
      missingItems.push({ label: 'About your organisation (Chapter 2)', stepTarget: 4 });
    }

    const itemsToFix = missingItems.slice(0, 3);
    const isReadyToGenerate = missingItems.length === 0;

    if (genState === 1) {
      return (
        <div className="view" id="step-7-generating">
          <h1 className="wt" id="wh" tabIndex={-1}>
            Compiling your institutional report
          </h1>
          <p className="wd" style={{ color: 'var(--mut)', fontSize: '13.5px', marginBottom: '16px' }}>
            Applying institutional formatting, grounding text to your logbook entries, and compiling preliminary pages…
          </p>
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
            <h1 id="wh" tabIndex={-1} style={{ fontSize: '28px', marginTop: '12px' }}>
              Your report is ready
            </h1>
            <p style={{ marginTop: '8px', color: 'var(--mut)', fontSize: '14px' }}>
              Compiled into a complete ~{layout.total} page SIWES technical report ready for review and download.
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
                Open in Editor &amp; Preview
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
      <div className="view" id="step-7-ready">
        {genError && (
          <div className="card" style={{ border: '1px solid #ef4444', background: '#fef2f2', marginBottom: '14px', padding: '14px 16px' }}>
            <div className="row" style={{ color: '#b91c1c', gap: '6px' }}>
              <span className="ms">error</span>
              <b>Generation Note</b>
            </div>
            <p style={{ margin: '8px 0 14px', fontSize: '13px', color: '#7f1d1d' }}>
              {genError}
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="btn" type="button" onClick={() => startGenerating()} style={{ flex: 1, minWidth: '160px' }}>
                <span className="ms">refresh</span>
                Retry Generating Report
              </button>
              <button
                className="btn o"
                type="button"
                onClick={() => {
                  setStep(4);
                  if (scrRef.current) scrRef.current.scrollTop = 0;
                }}
                style={{ flex: 1, minWidth: '140px' }}
              >
                <span className="ms">apartment</span>
                Step 4: Organisation
              </button>
              <button
                className="btn o"
                type="button"
                onClick={() => {
                  setStep(5);
                  if (scrRef.current) scrRef.current.scrollTop = 0;
                }}
                style={{ flex: 1, minWidth: '140px' }}
              >
                <span className="ms">assignment</span>
                Step 5: Experience
              </button>
              {(dbReport?.sections?.length || Object.keys(chapterEdits).length > 0) && (
                <button
                  className="btn o"
                  type="button"
                  onClick={() => {
                    setInFlow(false);
                    setCurrentTab('logbooks');
                    setLogbookView('report');
                    if (scrRef.current) scrRef.current.scrollTop = 0;
                  }}
                  style={{ flex: 1, minWidth: '160px' }}
                >
                  <span className="ms">menu_book</span>
                  View Draft
                </button>
              )}
            </div>
          </div>
        )}

        {/* Actionable Missing Items Card (Max 3 items) */}
        {!isReadyToGenerate && (
          <div className="card" style={{ border: '1px solid #f59e0b', background: '#fffbeb', marginBottom: '16px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#b45309', fontWeight: 700, fontSize: '13.5px' }}>
              <span className="ms">info</span>
              <span>A few items needed before generation:</span>
            </div>
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {itemsToFix.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#fff', borderRadius: '8px', border: '1px solid #fde68a' }}>
                  <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>{item.label}</span>
                  <button
                    type="button"
                    className="tx"
                    onClick={() => {
                      setStep(item.stepTarget);
                      if (scrRef.current) scrRef.current.scrollTop = 0;
                    }}
                    style={{ fontSize: '12px', fontWeight: 700, color: 'var(--g)', padding: '4px 8px' }}
                  >
                    Complete →
                  </button>
                </div>
              ))}
            </div>
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
          {isReadyToGenerate ? 'Ready to generate' : 'Step 7 of 7 · Report Summary'}
        </h1>
        <p className="wd" style={{ marginBottom: '16px', color: 'var(--mut)', fontSize: '13px' }}>
          {isReadyToGenerate ? 'All steps verified. Review details and generate your report.' : 'Please complete the remaining items above to enable generation.'}
        </p>

        {/* Summary Checklist */}
        <div className="gen-checklist">
          {/* 1. Logbook Pages */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">menu_book</span>
            </div>
            <div className="gi-content">
              <div className="gi-title">{n || 0} logbook pages uploaded</div>
              <div className="gi-desc">Page classification and sequence checked</div>
            </div>
            <span className="ms" style={{ color: n > 0 ? 'var(--g)' : 'var(--mut)', fontSize: '20px' }}>
              {n > 0 ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </div>

          {/* 2. Details Confirmed */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">badge</span>
            </div>
            <div className="gi-content">
              <div className="gi-title">Student &amp; Institution Details</div>
              <div className="gi-desc">
                {details.name || 'Student'} · {details.dept || 'Department'}{details.inst ? ` (${details.inst})` : ''}
              </div>
            </div>
            <span className="ms" style={{ color: details.name && details.matric ? 'var(--g)' : 'var(--mut)', fontSize: '20px' }}>
              {details.name && details.matric ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </div>

          {/* 3. Logbook Entries */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">event_note</span>
            </div>
            <div className="gi-content">
              <div className="gi-title">{wk} verified logbook entries</div>
              <div className="gi-desc">Technical activities and competencies extracted</div>
            </div>
            <span className="ms" style={{ color: wk > 0 ? 'var(--g)' : 'var(--mut)', fontSize: '20px' }}>
              {wk > 0 ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </div>

          {/* 4. Organisation Profile */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">apartment</span>
            </div>
            <div className="gi-content">
              <div className="gi-title">Organisation Profile &amp; Structure</div>
              <div className="gi-desc">{details.co || 'Organisation'} · Organogram ready</div>
            </div>
            <span className="ms" style={{ color: hasOrgInfo ? 'var(--g)' : 'var(--mut)', fontSize: '20px' }}>
              {hasOrgInfo ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </div>

          {/* 5. Experience & Tools */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">handyman</span>
            </div>
            <div className="gi-content">
              <div className="gi-title">Experience &amp; Tools Grounding</div>
              <div className="gi-desc">{experienceTools.length} tools and duties verified</div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }}>
              check_circle
            </span>
          </div>

          {/* 6. Optional Extras */}
          <div className="gen-item">
            <div className="gi-icon">
              <span className="ms" aria-hidden="true">add_circle</span>
            </div>
            <div className="gi-content">
              <div className="gi-title">Optional Extras</div>
              <div className="gi-desc">
                {reportImages.length > 0 ? `${reportImages.length} workplace photos` : 'Optional sections reviewed'}
              </div>
            </div>
            <span className="ms" style={{ color: 'var(--g)', fontSize: '20px' }}>
              check_circle
            </span>
          </div>
        </div>

        <div className="trust-banner" style={{ marginTop: '16px' }}>
          <span className="ms" aria-hidden="true">
            verified_user
          </span>
          <span>Guaranteed academic integrity — Grounded strictly in your confirmed logbook activities.</span>
        </div>
      </div>
    );
  };
  const renderStep5 = renderStepReadySummary;
  const renderStep7 = renderStepReadySummary;

  // Primary CTA Button for wizard bottom navigation
  const renderPrimaryCta = () => {
    if (step === 1) {
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
            trackWizardEvent('step1_upload', 'logbook_pages', 'step_completed', { page_count: pages.length });
            setStep(2);
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
    if (step === 2) {
      const missingCount = FLD.filter(([k]) => !details[k]?.trim()).length;
      const startDateObj = details.start ? new Date(details.start) : null;
      const endDateObj = details.end ? new Date(details.end) : null;
      const durationDays = (startDateObj && endDateObj && !isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime()))
        ? Math.round((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 3600 * 24)) + 1
        : 0;
      const isShortDuration = durationDays > 0 && durationDays < 28;
      const isDateInverted = Boolean(details.start && details.end && details.start >= details.end);

      return (
        <button
          className="btn"
          type="button"
          disabled={missingCount > 0 || isDateInverted || (isShortDuration && !shortDurationConfirmed)}
          onClick={async () => {
            if (missingCount > 0 || isDateInverted) return;
            if (isShortDuration && !shortDurationConfirmed) {
              showToast('Please confirm your short training duration.');
              return;
            }
            await saveStep2Data();
            trackWizardEvent('step2_details', 'confirm_details', 'step_completed');
            setStep(3);
            if (scrRef.current) scrRef.current.scrollTop = 0;
          }}
          style={{ flex: 1 }}
        >
          {missingCount > 0
            ? `Fill ${missingCount} more to continue`
            : isDateInverted
            ? 'Fix training dates'
            : isShortDuration && !shortDurationConfirmed
            ? 'Confirm short period'
            : 'Continue'}
          <span className="ms" aria-hidden="true">
            arrow_forward
          </span>
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
      if (orgScreen < 4) {
        return (
          <button
            className="btn"
            type="button"
            disabled={orgScreen === 1 && !orgWhat.trim() && !orgNotSure}
            onClick={async () => {
              await saveStep4Data();
              trackWizardEvent('step4_organisation', `screen_${orgScreen}`, 'screen_completed');
              setOrgScreen((prev) => (Math.min(4, prev + 1) as 1 | 2 | 3 | 4));
              if (scrRef.current) scrRef.current.scrollTop = 0;
            }}
            style={{ flex: 1 }}
          >
            Next question
            <span className="ms" aria-hidden="true">arrow_forward</span>
          </button>
        );
      }
      return (
        <button
          className="btn"
          type="button"
          disabled={!headTitle.trim() || !studentUnit.trim()}
          onClick={async () => {
            await saveStep4Data();
            trackWizardEvent('step4_organisation', 'screen_4', 'screen_completed');
            setStep(5);
            if (scrRef.current) scrRef.current.scrollTop = 0;
          }}
          style={{ flex: 1 }}
        >
          Continue to Experience
          <span className="ms" aria-hidden="true">arrow_forward</span>
        </button>
      );
    }
    if (step === 5) {
      return (
        <button
          className="btn"
          type="button"
          onClick={async () => {
            await saveStep5Data();
            trackWizardEvent('step5_experience', 'experience_overview', 'step_completed');
            setStep(6);
            if (scrRef.current) scrRef.current.scrollTop = 0;
          }}
          style={{ flex: 1 }}
        >
          Continue to Extras
          <span className="ms" aria-hidden="true">arrow_forward</span>
        </button>
      );
    }
    if (step === 6) {
      return (
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <button
            className="btn s"
            type="button"
            style={{ flex: 1 }}
            onClick={() => {
              setStep(7);
              if (scrRef.current) scrRef.current.scrollTop = 0;
            }}
          >
            Skip all
          </button>
          <button
            className="btn"
            type="button"
            style={{ flex: 2 }}
            onClick={async () => {
              await saveStep6Data();
              setStep(7);
              if (scrRef.current) scrRef.current.scrollTop = 0;
            }}
          >
            Continue
            <span className="ms" aria-hidden="true">arrow_forward</span>
          </button>
        </div>
      );
    }
    // step === 7
    if (genState === 0) {
      const hasMissing = pages.length === 0 || !details.name || !details.matric || !details.dept || !details.inst || !details.co || !details.start || !details.end || entries.length === 0;
      return (
        <button
          className="btn"
          type="button"
          onClick={startGenerating}
          disabled={hasMissing}
          style={{ flex: 1, opacity: hasMissing ? 0.6 : 1, cursor: hasMissing ? 'not-allowed' : 'pointer' }}
        >
          <span className="ms" aria-hidden="true">
            auto_awesome
          </span>
          {hasMissing ? 'Complete missing steps to generate' : 'Generate report'}
        </button>
      );
    }
    if (genState === 1) {
      return (
        <button className="btn" type="button" disabled style={{ flex: 1, opacity: 0.9 }}>
          <span className="ms" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>
            sync
          </span>
          Compiling report… Please wait
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
                    onClick={async () => {
                      if (step === 2) await saveStep2Data();
                      if (step === 4) await saveStep4Data();
                      if (step === 5) await saveStep5Data();
                      if (step === 6) await saveStep6Data();
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
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <b style={{ fontSize: '14px' }}>
                        Step {step} of 7 · {SN[step - 1]}
                      </b>
                      {autoSaveStatus === 'saving' && (
                        <span style={{ fontSize: '11px', color: 'var(--mut)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <span className="ms" style={{ fontSize: '12px', animation: 'spin 1s linear infinite' }}>sync</span> Saving...
                        </span>
                      )}
                      {autoSaveStatus === 'saved' && (
                        <span style={{ fontSize: '11px', color: 'var(--g)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <span className="ms" style={{ fontSize: '13px' }}>check_circle</span> Saved
                        </span>
                      )}
                    </div>
                    {activeProject?.title && (
                      <span style={{ fontSize: '11px', color: 'var(--mut)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                        {activeProject.title}
                      </span>
                    )}
                  </div>
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
              {step === 4 && renderStepOrganisation()}
              {step === 5 && renderStepExperience()}
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
                onClick={async () => {
                  if (step === 2) await saveStep2Data();
                  if (step === 4) await saveStep4Data();
                  if (step === 5) await saveStep5Data();
                  if (step === 6) await saveStep6Data();
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
        {checkoutModal === 'delivery' && !isPro && (
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

        {/* Create Report Modal */}
        {isCreateReportModalOpen && renderCreateReportModal()}

        {/* Delete Report Confirmation Modal */}
        {projectToDelete && renderDeleteProjectModal()}

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
