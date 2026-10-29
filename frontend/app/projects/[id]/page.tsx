'use client';

import React, { useEffect, useState, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { projectsApi } from '@/lib/api';
import { MaterialIcon } from '@/components/ui/material-icon';
import UtilityTabs from '@/components/UtilityTabs';
import { TiptapEditor } from '@/components/TiptapEditor';
import {
  useProjectStore,
  useReportStore,
  useDefenceStore,
  useUIStore,
} from '@/lib/store';

function ProjectWorkspaceContent({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // Active Workspace Tab: 'sources' | 'report' | 'export' | 'defence' | 'details'
  const [activeTab, setActiveTab] = useState<'sources' | 'report' | 'export' | 'defence' | 'details'>('sources');
  const [error, setError] = useState('');

  // Project Zustand Store
  const {
    activeProject: project,
    isLoadingActiveProject: projectLoading,
    fetchActiveProject,
    uploadDocument: storeUploadDocument,
    updatePage: storeUpdatePage,
    createLogbookEntry: storeCreateLogbookEntry,
    deleteLogbookEntry: storeDeleteLogbookEntry,
    bulkVerifyEntries: storeBulkVerifyEntries,
    updateActiveProject: storeUpdateProject,
  } = useProjectStore();

  // Report Zustand Store
  const {
    report,
    activeSectionId,
    previewMode,
    isGeneratingReport: generatingReport,
    isSavingSection: savingSection,
    regeneratingSectionId,
    isExportingDocx: exportingDocx,
    isExportingPdf: exportingPdf,
    fetchReport,
    generateReport: storeGenerateReport,
    setActiveSectionId,
    setSectionDraft,
    saveSection: storeSaveSection,
    regenerateSection: storeRegenerateSection,
    setPreviewMode,
    downloadDocx: storeDownloadDocx,
    downloadPdf: storeDownloadPdf,
  } = useReportStore();

  // Defence Zustand Store
  const {
    questions: defenceQuestions,
    isGeneratingQuestions: generatingDefence,
    selectedCategory: selectedDefenceCategory,
    revealedAnswers,
    mockExamActive,
    mockExamIndex,
    fetchQuestions,
    generateQuestions: storeGenerateDefence,
    updateQuestion: storeUpdateDefenceQuestion,
    setSelectedCategory: setSelectedDefenceCategory,
    setAnswerReveal,
    startMockExam,
    exitMockExam,
    setMockExamIndex,
  } = useDefenceStore();

  const { showToast } = useUIStore();

  const loading = projectLoading;

  // Sources tab state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingPage, setEditingPage] = useState<any>(null);
  const [pageTextDraft, setPageTextDraft] = useState('');
  const [savingPage, setSavingPage] = useState(false);

  // New Logbook Entry modal state
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [newEntryData, setNewEntryData] = useState({
    week_number: 1,
    day_of_week: 'Monday',
    activity_summary: '',
    verified_text: '',
    tools_used: '',
  });

  // Report Section Content Draft
  const [sectionContentDraft, setSectionContentDraft] = useState('');

  // Load Project Data
  const loadProject = async () => {
    try {
      setError('');
      await Promise.all([
        fetchActiveProject(projectId),
        fetchReport(projectId).catch(() => null),
        fetchQuestions(projectId).catch(() => []),
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to load project.');
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user && projectId) {
      loadProject();
    }
  }, [user, authLoading, projectId]);

  // Sync draft when active section changes
  useEffect(() => {
    if (report?.sections && activeSectionId) {
      const sec = report.sections.find((s: any) => s.id === activeSectionId);
      if (sec) {
        setSectionContentDraft(sec.content || '');
      }
    }
  }, [report, activeSectionId]);

  // Section selection
  const handleSelectSection = (section: any) => {
    setActiveSectionId(section.id);
    setSectionContentDraft(section.content || '');
  };

  // Upload Document or Note
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setUploading(true);

    try {
      const formData = new FormData();
      if (isNoteMode) {
        if (!noteText.trim()) throw new Error('Please enter note text');
        formData.append('title', noteTitle.trim() || 'Manual Note');
        formData.append('text', noteText.trim());
        formData.append('file_type', 'note');
      } else {
        if (!uploadFile) throw new Error('Please select a file to upload');
        formData.append('file', uploadFile);
      }

      await storeUploadDocument(projectId, formData);
      setUploadFile(null);
      setNoteText('');
      setNoteTitle('');
      setIsNoteMode(false);
      showToast('Document uploaded and queued for processing', 'success');
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Save Page Correction
  const handleSavePage = async () => {
    if (!editingPage) return;
    setSavingPage(true);
    try {
      await storeUpdatePage(projectId, editingPage.id, {
        extracted_text: pageTextDraft,
        status: 'processed',
        is_reviewed: true,
      });
      setEditingPage(null);
      showToast('Page corrections saved', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save page', 'error');
    } finally {
      setSavingPage(false);
    }
  };

  // Bulk Verify Entries
  const handleBulkVerify = async () => {
    try {
      await storeBulkVerifyEntries(projectId);
      showToast('All logbook entries verified', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to verify entries', 'error');
    }
  };

  // Create Logbook Entry
  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await storeCreateLogbookEntry(projectId, {
        ...newEntryData,
        raw_text: newEntryData.verified_text,
        is_verified: true,
      });
      setShowNewEntry(false);
      setNewEntryData({
        week_number: 1,
        day_of_week: 'Monday',
        activity_summary: '',
        verified_text: '',
        tools_used: '',
      });
      showToast('Logbook entry created', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to create logbook entry', 'error');
    }
  };

  // Delete Logbook Entry
  const handleDeleteEntry = async (entryId: number) => {
    if (!confirm('Are you sure you want to delete this logbook entry?')) return;
    try {
      await storeDeleteLogbookEntry(projectId, entryId);
      showToast('Logbook entry deleted', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete entry', 'error');
    }
  };

  // Generate Report
  const handleGenerateReport = async (forceAll: boolean = false) => {
    setError('');
    try {
      const repData = await storeGenerateReport(projectId, forceAll);
      await fetchActiveProject(projectId);
      if (repData.sections && repData.sections.length > 0) {
        setSectionContentDraft(repData.sections[0].content || '');
      }
      showToast('Report generated successfully', 'success');
    } catch (err: any) {
      setError(err.message || 'Report generation failed');
      showToast(err.message || 'Report generation failed', 'error');
    }
  };

  // Save Section Edit
  const handleSaveSection = async () => {
    if (!activeSectionId) return;
    try {
      await storeSaveSection(projectId, activeSectionId, sectionContentDraft);
      showToast('Section saved', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to save section', 'error');
    }
  };

  // Regenerate Single Section
  const handleRegenerateSection = async (sectionId: number) => {
    try {
      const updated = await storeRegenerateSection(projectId, sectionId);
      if (activeSectionId === sectionId) {
        setSectionContentDraft(updated.content);
      }
      showToast('Section regenerated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to regenerate section', 'error');
    }
  };

  // Download DOCX
  const handleDownloadDocx = async () => {
    try {
      const filename = `${(project?.title || 'siwes_report').replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
      await storeDownloadDocx(projectId, filename);
      showToast('DOCX report download started', 'success');
    } catch (err: any) {
      showToast(err.message || 'DOCX download failed', 'error');
    }
  };

  // Download PDF
  const handleDownloadPdf = async () => {
    try {
      const filename = `${(project?.title || 'siwes_report').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      await storeDownloadPdf(projectId, filename);
      showToast('PDF report download started', 'success');
    } catch (err: any) {
      showToast(err.message || 'PDF export failed', 'error');
    }
  };

  // Generate Defence Questions
  const handleGenerateDefence = async () => {
    try {
      await storeGenerateDefence(projectId);
      showToast('Defence questions generated', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to generate defence questions', 'error');
    }
  };

  // Update Mastery Status
  const handleUpdateMastery = async (questionId: number, status: string) => {
    try {
      await storeUpdateDefenceQuestion(projectId, questionId, {
        mastery_status: status,
      });
      showToast(`Mastery set to ${status.replace('_', ' ')}`, 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to update mastery', 'error');
    }
  };

  // Toggle Hard Flag
  const handleToggleHard = async (questionId: number, currentVal: boolean) => {
    try {
      await storeUpdateDefenceQuestion(projectId, questionId, {
        is_flagged_hard: !currentVal,
      });
      showToast(!currentVal ? 'Flagged for revision' : 'Unflagged', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to toggle flag', 'error');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <MaterialIcon name="progress_activity" size={28} spin className="text-emerald-800" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <MaterialIcon name="error" size={36} className="text-red-600 mx-auto mb-3" />
        <h2 className="text-xl font-bold font-serif text-foreground">Project Not Found</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-6">
          The requested project does not exist or you do not have permission to view it.
        </p>
        <Link
          href="/dashboard"
          className="px-4 py-2 bg-emerald-800 text-white rounded-md text-sm font-medium hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const activeSection = report?.sections?.find((s: any) => s.id === activeSectionId);
  const filteredQuestions = defenceQuestions.filter((q) => {
    if (selectedDefenceCategory === 'all') return true;
    if (selectedDefenceCategory === 'flagged') return q.is_flagged_hard;
    return q.category === selectedDefenceCategory;
  });

  return (
    <div className="flex-1 flex flex-col w-full bg-[#FAF9F5]">
      {/* Workspace Sub-Header */}
      <div className="border-b border-border bg-white sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/dashboard"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors"
                title="Back to Dashboard"
                aria-label="Back to Dashboard"
              >
                <MaterialIcon name="arrow_back" size={18} />
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold font-serif text-foreground truncate">
                    {project.title}
                  </h1>
                  <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-700 capitalize">
                    {project.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                  <span>{project.full_name || user?.username}</span>
                  {project.matric_number && <span>• {project.matric_number}</span>}
                  {project.organization_name && <span>• {project.organization_name}</span>}
                </div>
              </div>
            </div>

            {/* Quick Export Trigger */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('export')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-white text-foreground text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors shadow-2xs cursor-pointer"
              >
                <MaterialIcon name="download" size={16} className="text-emerald-800" />
                <span>Export Documents</span>
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mt-3 overflow-x-auto border-t border-border/40 pt-2 text-xs font-medium" role="tablist" aria-label="Workspace tabs">
            <button
              role="tab"
              aria-selected={activeTab === 'sources'}
              onClick={() => setActiveTab('sources')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none cursor-pointer ${
                activeTab === 'sources'
                  ? 'bg-emerald-800 text-white font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <MaterialIcon name="cloud_upload" size={16} />
              <span>Sources & Logbook ({project.source_documents?.length || 0})</span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === 'report'}
              onClick={() => setActiveTab('report')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none cursor-pointer ${
                activeTab === 'report'
                  ? 'bg-emerald-800 text-white font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <MaterialIcon name="description" size={16} />
              <span>Report Editor {report ? `(${report.sections?.length || 0} sections)` : ''}</span>
            </button>
          </div>

          {/* Utility strip: secondary workspaces kept out of the primary tabs */}
          <UtilityTabs
            variant="workspace"
            ariaLabel="Workspace utilities"
            items={[
              { key: 'export', label: 'Document Export', icon: 'download' },
              {
                key: 'defence',
                label: `Defence Prep (${defenceQuestions.length})`,
                icon: 'school',
              },
            ]}
            activeKey={activeTab === 'export' || activeTab === 'defence' ? activeTab : null}
            onSelect={(item) => setActiveTab(item.key as 'export' | 'defence')}
          />
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
        {/* TAB 1: SOURCES & LOGBOOK */}
        {activeTab === 'sources' && (
          <div className="space-y-8">
            {/* Upload Area */}
            <div className="bg-white rounded-xl border border-border p-6 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
                <div>
                  <h2 className="font-bold text-base text-foreground font-serif">Upload Logbook & Technical Notes</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload handwritten logbook scans, photos, PDF pages, or type in weekly notes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsNoteMode(!isNoteMode)}
                  className="text-xs text-emerald-800 font-medium hover:underline"
                >
                  {isNoteMode ? 'Switch to File Upload' : 'Type/Paste Notes Directly'}
                </button>
              </div>

              <form onSubmit={handleUpload} className="space-y-4">
                {isNoteMode ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={noteTitle}
                      onChange={(e) => setNoteTitle(e.target.value)}
                      placeholder="Note Title (e.g. Week 4: Router Configuration & Fiber Testing)"
                      className="w-full px-3.5 py-2 rounded-md border border-border text-sm"
                    />
                    <textarea
                      required
                      rows={5}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Paste or type daily entries, e.g.:
Monday: Safety orientation and inspection of server rack.
Tuesday: Configured IP subnets on Cisco switch.
Wednesday: Assisted supervisor with fiber optic OTDR measurements."
                      className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm font-mono text-xs leading-relaxed"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block w-full border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-emerald-700/60 focus-within:ring-2 focus-within:ring-emerald-700 transition-colors bg-[#FAF9F5]/40">
                      <MaterialIcon name="cloud_upload" size={36} className="text-emerald-800 mx-auto mb-2" />
                      <span className="text-sm font-medium text-foreground block">
                        {uploadFile ? uploadFile.name : 'Choose a file or drag & drop here'}
                      </span>
                      <span className="text-xs text-muted-foreground block mt-1">
                        Accepts PDF, JPG, PNG, and DOCX (up to 15MB)
                      </span>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.docx"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        className="sr-only"
                        aria-label="Upload logbook file"
                      />
                    </label>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={uploading || (!uploadFile && !noteText.trim())}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {uploading ? (
                      <>
                        <MaterialIcon name="progress_activity" size={16} spin />
                        <span>Processing Source...</span>
                      </>
                    ) : (
                      <>
                        <MaterialIcon name="cloud_upload" size={16} />
                        <span>Process & Extract Text</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Uploaded Documents List & Pages */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base text-foreground font-serif">Uploaded Source Documents</h3>
                <span className="text-xs text-muted-foreground">{project.source_documents?.length || 0} document(s)</span>
              </div>

              {(!project.source_documents || project.source_documents.length === 0) ? (
                <div className="p-8 text-center bg-white rounded-xl border border-dashed border-border">
                  <p className="text-xs text-muted-foreground">No source documents uploaded yet. Upload your logbook pages above.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {project.source_documents.map((doc: any) => (
                    <div key={doc.id} className="bg-white rounded-xl border border-border p-4 shadow-2xs">
                      <div className="flex items-center justify-between pb-3 border-b border-border/60">
                        <div className="flex items-center gap-2.5">
                          <MaterialIcon name="description" size={20} className="text-emerald-800" />
                          <div>
                            <span className="font-semibold text-sm text-foreground">{doc.original_filename}</span>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                              <span className="uppercase font-mono">{doc.file_type}</span>
                              <span>• {doc.page_count} page(s)</span>
                              <span>• {new Date(doc.uploaded_at).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize ${
                            doc.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {doc.status}
                          </span>
                        </div>
                      </div>

                      {/* Extracted Pages */}
                      <div className="mt-3 space-y-2">
                        {doc.extracted_pages?.map((page: any) => (
                          <div
                            key={page.id}
                            className={`p-3 rounded-lg border text-xs ${
                              page.status === 'manual_correction_needed'
                                ? 'border-amber-300 bg-amber-50/40'
                                : 'border-border/70 bg-[#FAF9F5]/40'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-semibold text-foreground">Page {page.page_number}</span>
                              <div className="flex items-center gap-2">
                                {page.status === 'manual_correction_needed' && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-900 flex items-center gap-1">
                                    <MaterialIcon name="warning" size={14} /> Manual Verification Needed
                                  </span>
                                )}
                                <button
                                  onClick={() => {
                                    setEditingPage(page);
                                    setPageTextDraft(page.extracted_text || '');
                                  }}
                                  className="text-[11px] text-emerald-800 hover:underline flex items-center gap-1 font-medium focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none rounded cursor-pointer"
                                >
                                  <MaterialIcon name="edit" size={14} /> Correct Text
                                </button>
                              </div>
                            </div>

                            <p className="font-mono text-[11px] text-foreground/80 line-clamp-3 whitespace-pre-wrap">
                              {page.extracted_text || '(No text extracted or scanned image requiring manual input)'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Logbook Entries Manager */}
            <div className="bg-white rounded-xl border border-border p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                <div>
                  <h3 className="font-bold text-base text-foreground font-serif">Verified Logbook Entries</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Entries parsed from your uploads. Verify these milestones so the report generator can build Chapter Three.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkVerify}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-900 border border-emerald-200 text-xs font-medium hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors cursor-pointer"
                  >
                    <MaterialIcon name="check_circle" size={16} filled className="text-emerald-700" />
                    <span>Verify All Entries</span>
                  </button>
                  <button
                    onClick={() => setShowNewEntry(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors cursor-pointer"
                  >
                    <MaterialIcon name="add" size={16} />
                    <span>Add Manual Entry</span>
                  </button>
                </div>
              </div>

              {(!project.logbook_entries || project.logbook_entries.length === 0) ? (
                <div className="p-8 text-center">
                  <p className="text-xs text-muted-foreground">No entries found. Extract notes from documents above or add a manual entry.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {project.logbook_entries.map((entry: any) => (
                    <div
                      key={entry.id}
                      className="p-3 rounded-lg border border-border hover:border-emerald-700/30 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-3">
                        <span className="font-bold font-mono px-2 py-0.5 bg-zinc-100 text-zinc-800 rounded shrink-0">
                          Week {entry.week_number}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            {entry.day_of_week && (
                              <span className="font-semibold text-foreground">{entry.day_of_week}:</span>
                            )}
                            <span className="text-foreground">{entry.activity_summary || entry.verified_text}</span>
                          </div>
                          {entry.tools_used && (
                            <span className="text-[11px] text-muted-foreground block mt-0.5">
                              Tools: {entry.tools_used}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        {entry.is_verified ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 flex items-center gap-1">
                            <MaterialIcon name="check" size={14} /> Verified
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                            Unverified
                          </span>
                        )}
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="p-1 text-muted-foreground hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:outline-none rounded transition-colors cursor-pointer"
                          title="Delete entry"
                          aria-label={`Delete entry for Week ${entry.week_number}`}
                        >
                          <MaterialIcon name="delete" size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: REPORT EDITOR */}
        {activeTab === 'report' && (
          <div>
            {!report ? (
              <div className="p-12 text-center bg-white rounded-xl border border-dashed border-border max-w-xl mx-auto my-8">
                <MaterialIcon name="description" size={40} className="text-emerald-800 mx-auto mb-3" />
                <h3 className="font-bold text-lg font-serif text-foreground">Generate Your Technical Report</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-6 max-w-sm mx-auto leading-relaxed">
                  Log2Def will synthesize your verified logbook records and placement details into the official LASUSTECH 5-chapter academic format.
                </p>
                <button
                  onClick={() => handleGenerateReport(false)}
                  disabled={generatingReport}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-emerald-800 text-white font-medium text-sm hover:bg-emerald-900 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                >
                  {generatingReport ? (
                    <>
                      <MaterialIcon name="progress_activity" size={16} spin /> Generating All Sections...
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="auto_awesome" size={16} /> Generate Structured Report
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Chapter & Section Sidebar */}
                <div className="lg:col-span-4 bg-white rounded-xl border border-border p-4 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <span className="font-serif font-bold text-sm text-foreground">Report Sections</span>
                    <button
                      onClick={() => handleGenerateReport(true)}
                      disabled={generatingReport}
                      className="text-[11px] text-emerald-800 hover:underline flex items-center gap-1 font-medium cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none rounded"
                      title="Regenerate all sections from scratch"
                      aria-label="Regenerate all report sections from scratch"
                    >
                      <MaterialIcon name="sync" size={14} spin={generatingReport} />
                      Regen All
                    </button>
                  </div>

                  <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1" role="tablist" aria-label="Report sections list">
                    {report.sections?.map((sec: any) => {
                      const isSelected = sec.id === activeSectionId;
                      return (
                        <button
                          key={sec.id}
                          role="tab"
                          aria-selected={isSelected}
                          onClick={() => handleSelectSection(sec)}
                          className={`w-full text-left p-2.5 rounded-md text-xs transition-colors flex items-center justify-between cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
                            isSelected
                              ? 'bg-emerald-800 text-white font-medium'
                              : 'hover:bg-muted/70 text-foreground'
                          }`}
                        >
                          <span className="truncate pr-2">{sec.title}</span>
                          {sec.warnings && sec.warnings.length > 0 && (
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-amber-300' : 'bg-amber-500'}`} title="Missing information warning" aria-label="Warning: missing data" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Main Rich-Text Editor / Preview */}
                <div className="lg:col-span-8 bg-white rounded-xl border border-border p-6 shadow-xs flex flex-col min-h-[70vh]">
                  {activeSection ? (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border mb-4">
                        <div>
                          <h3 className="font-bold text-base text-foreground font-serif">{activeSection.title}</h3>
                          <span className="text-[11px] text-muted-foreground">
                            {activeSection.last_edited_by_student ? 'Customized by student' : 'Generated draft'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPreviewMode(!previewMode)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs font-medium text-foreground hover:bg-muted cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                            aria-label={previewMode ? 'Switch to rich text editor' : 'Switch to document preview view'}
                          >
                            <MaterialIcon name="visibility" size={16} />
                            {previewMode ? 'Editor View' : 'Preview View'}
                          </button>

                          <button
                            onClick={() => handleRegenerateSection(activeSection.id)}
                            disabled={regeneratingSectionId === activeSection.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                            title="Regenerate this specific section"
                            aria-label="Regenerate this section with AI"
                          >
                            <MaterialIcon name="sync" size={16} spin={regeneratingSectionId === activeSection.id} />
                            Regenerate
                          </button>

                          <button
                            onClick={handleSaveSection}
                            disabled={savingSection}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                            aria-label="Save section content"
                          >
                            {savingSection ? (
                              <MaterialIcon name="progress_activity" size={16} spin />
                            ) : (
                              <MaterialIcon name="check" size={16} />
                            )}
                            Save Section
                          </button>
                        </div>
                      </div>

                      {/* Warnings Alert */}
                      {activeSection.warnings && activeSection.warnings.length > 0 && (
                        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs" role="alert">
                          <div className="font-semibold flex items-center gap-1 mb-1">
                            <MaterialIcon name="warning" size={16} className="text-amber-600" />
                            Missing Information / Verification Alert:
                          </div>
                          <ul className="list-disc pl-5 space-y-0.5">
                            {activeSection.warnings.map((w: string, i: number) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Editor or Preview Pane */}
                      <div className="flex-1 flex flex-col">
                        {previewMode ? (
                          <div
                            className="p-8 border rounded-lg bg-[#FAF9F5]/30 prose prose-sm max-w-none font-serif text-sm leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: sectionContentDraft }}
                          />
                        ) : (
                          <TiptapEditor
                            content={sectionContentDraft}
                            onChange={(html) => setSectionContentDraft(html)}
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                      Select a section from the sidebar to view and edit.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DOCUMENT EXPORT */}
        {activeTab === 'export' && (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white rounded-xl border border-border p-6 sm:p-8 shadow-xs">
              <div className="text-center max-w-md mx-auto mb-8">
                <MaterialIcon name="download" size={40} className="text-emerald-800 mx-auto mb-2" />
                <h2 className="text-2xl font-bold font-serif text-foreground">Export Official Documents</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Download production-formatted files ready for academic review and physical binding.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* DOCX Card */}
                <div className="p-6 rounded-xl border border-border bg-[#FAF9F5]/40 flex flex-col justify-between">
                  <div>
                    <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                      MICROSOFT WORD (.DOCX)
                    </span>
                    <h3 className="font-bold text-base text-foreground mt-2">Editable Technical Report</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Standard A4 document with 1.5-inch left margins for Nigerian university binding, Times New Roman 12pt, 1.5 line spacing, and editable tables.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadDocx}
                    disabled={exportingDocx || !report}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
                    aria-label="Download technical report as Word document"
                  >
                    {exportingDocx ? (
                      <>
                        <MaterialIcon name="progress_activity" size={16} spin /> Generating DOCX...
                      </>
                    ) : (
                      <>
                        <MaterialIcon name="download" size={16} /> Download Word Document
                      </>
                    )}
                  </button>
                </div>

                {/* PDF Card */}
                <div className="p-6 rounded-xl border border-border bg-[#FAF9F5]/40 flex flex-col justify-between">
                  <div>
                    <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                      ADOBE PDF (.PDF)
                    </span>
                    <h3 className="font-bold text-base text-foreground mt-2">Printable Defence-Ready PDF</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Rendered using headless LibreOffice with validated pagination, headers, footers, signature blocks, and authentic %PDF-1.x structure.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={exportingPdf || !report}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                    aria-label="Download validated technical report as PDF document"
                  >
                    {exportingPdf ? (
                      <>
                        <MaterialIcon name="progress_activity" size={16} spin /> Rendering Validated PDF...
                      </>
                    ) : (
                      <>
                        <MaterialIcon name="download" size={16} /> Download PDF Document
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Pre-flight Checklist */}
              <div className="mt-8 pt-6 border-t border-border">
                <h4 className="font-bold text-xs uppercase tracking-wider text-foreground mb-3">
                  Pre-Submission Academic Checklist
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 text-zinc-700">
                    <MaterialIcon name="check_circle" size={16} filled className="text-emerald-700 shrink-0" />
                    <span>A4 Standard Layout & 1.5" Left Margin</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700">
                    <MaterialIcon name="check_circle" size={16} filled className="text-emerald-700 shrink-0" />
                    <span>Preliminary Roman Numerals (i, ii, iii...)</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700">
                    <MaterialIcon name="check_circle" size={16} filled className="text-emerald-700 shrink-0" />
                    <span>Certification Page with Sign-off Lines</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700">
                    <MaterialIcon name="check_circle" size={16} filled className="text-emerald-700 shrink-0" />
                    <span>Weekly Activities Grounded in Logbook</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: DEFENCE PREPARATION */}
        {activeTab === 'defence' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-border p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold font-serif text-foreground">Oral Defence Preparation & Drills</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  15+ realistic questions grounded in your technical report. Practice with model answers and mock examination.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={startMockExam}
                  disabled={defenceQuestions.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-700 focus-visible:outline-none"
                  aria-label="Launch full-screen mock defence oral examination"
                >
                  <MaterialIcon name="play_arrow" size={16} />
                  Launch Mock Defence Mode
                </button>
                <button
                  onClick={handleGenerateDefence}
                  disabled={generatingDefence}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                  aria-label="Generate questions grounded in your logbook"
                >
                  {generatingDefence ? (
                    <>
                      <MaterialIcon name="progress_activity" size={16} spin /> Generating...
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="sync" size={16} /> Generate Question Bank
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Category Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs" role="toolbar" aria-label="Question category filters">
              {[
                { id: 'all', label: 'All Questions' },
                { id: 'flagged', label: 'Flagged / Needs Review' },
                { id: 'organization', label: 'Organization & Objectives' },
                { id: 'tasks_and_projects', label: 'Tasks & Projects' },
                { id: 'technical_tools', label: 'Tools & Technologies' },
                { id: 'challenges_troubleshooting', label: 'Troubleshooting' },
                { id: 'examiner_followup', label: 'Examiner Cross-Exam' },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedDefenceCategory(c.id)}
                  aria-pressed={selectedDefenceCategory === c.id}
                  className={`px-3 py-1.5 rounded-full border transition-colors shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
                    selectedDefenceCategory === c.id
                      ? 'border-emerald-800 bg-emerald-800 text-white font-medium'
                      : 'border-border bg-white text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Questions List */}
            {defenceQuestions.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-xl border border-dashed border-border">
                <MaterialIcon name="school" size={40} className="text-emerald-800 mx-auto mb-2" />
                <h3 className="font-bold text-base font-serif text-foreground">No Defence Questions Generated Yet</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  Click 'Generate Question Bank' above to create custom questions grounded in your host company and technical tasks.
                </p>
                <button
                  onClick={handleGenerateDefence}
                  disabled={generatingDefence}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                  aria-label="Generate questions now"
                >
                  <MaterialIcon name="auto_awesome" size={16} /> Generate Questions Now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredQuestions.map((q) => {
                  const isRevealed = revealedAnswers[q.id];
                  return (
                    <div
                      key={q.id}
                      className="bg-white rounded-xl border border-border p-5 shadow-2xs space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-100 text-zinc-700 capitalize">
                            {q.category.replace('_', ' ')}
                          </span>
                          {q.grounded_context && (
                            <span className="text-[11px] text-muted-foreground">
                              • {q.grounded_context}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleHard(q.id, q.is_flagged_hard)}
                            className={`p-1.5 rounded transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none ${
                              q.is_flagged_hard ? 'text-amber-500 bg-amber-50' : 'text-zinc-400 hover:text-zinc-600'
                            }`}
                            title={q.is_flagged_hard ? 'Unflag question' : 'Flag question for revision'}
                            aria-label={q.is_flagged_hard ? 'Unflag question' : 'Flag question for revision'}
                          >
                            <MaterialIcon name="star" size={18} filled={q.is_flagged_hard} />
                          </button>
                        </div>
                      </div>

                      <h3 className="text-sm sm:text-base font-semibold text-foreground font-serif">
                        {q.question}
                      </h3>

                      {/* Suggested Answer Toggle */}
                      <div className="pt-2">
                        {isRevealed ? (
                          <div className="p-4 rounded-lg bg-emerald-50/50 border border-emerald-200/60 text-xs text-emerald-950 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[11px] uppercase tracking-wider text-emerald-900">
                                Grounded Suggested Answer:
                              </span>
                              <button
                                onClick={() => setAnswerReveal(q.id, false)}
                                className="text-[11px] text-emerald-800 hover:underline cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none rounded"
                              >
                                Hide
                              </button>
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">{q.suggested_answer}</p>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAnswerReveal(q.id, true)}
                            className="text-xs text-emerald-800 font-medium hover:underline inline-flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none rounded"
                            aria-label="Reveal model answer and examiner guidance"
                          >
                            <MaterialIcon name="visibility" size={16} /> Reveal Model Answer & Guidance
                          </button>
                        )}
                      </div>

                      {/* Self-Mastery Rating */}
                      <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground text-[11px]">Your Mastery:</span>
                        <div className="flex items-center gap-1.5" role="group" aria-label="Mastery status">
                          <button
                            onClick={() => handleUpdateMastery(q.id, 'confident')}
                            aria-pressed={q.mastery_status === 'confident'}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
                              q.mastery_status === 'confident'
                                ? 'bg-emerald-800 text-white border-emerald-800'
                                : 'bg-white border-border text-foreground hover:bg-muted'
                            }`}
                          >
                            Confident
                          </button>
                          <button
                            onClick={() => handleUpdateMastery(q.id, 'needs_practice')}
                            aria-pressed={q.mastery_status === 'needs_practice'}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:outline-none ${
                              q.mastery_status === 'needs_practice'
                                ? 'bg-amber-600 text-white border-amber-600'
                                : 'bg-white border-border text-foreground hover:bg-muted'
                            }`}
                          >
                            Needs Practice
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
      </div>

      {/* MODAL: Correct Extracted Page Text */}
      {editingPage && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-verify-page-title">
          <div className="bg-white rounded-xl border border-border p-6 max-w-2xl w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 id="modal-verify-page-title" className="font-bold text-base font-serif text-foreground">
                Verify / Correct Page {editingPage.page_number} Text
              </h3>
              <button
                onClick={() => setEditingPage(null)}
                className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                aria-label="Close dialog"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Review and correct any handwriting recognition discrepancies. This verified text will be used to generate logbook milestones.
            </p>
            <textarea
              rows={10}
              value={pageTextDraft}
              onChange={(e) => setPageTextDraft(e.target.value)}
              className="w-full p-3.5 rounded-md border border-border text-xs font-mono leading-relaxed"
              aria-label="Extracted OCR text"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingPage(null)}
                className="px-3.5 py-2 rounded border border-border text-xs font-medium text-foreground hover:bg-muted cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-700 focus-visible:outline-none"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePage}
                disabled={savingPage}
                className="px-4 py-2 rounded bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
              >
                {savingPage ? 'Saving...' : 'Save & Verify Page'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Manual Logbook Entry */}
      {showNewEntry && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-add-entry-title">
          <div className="bg-white rounded-xl border border-border p-6 max-w-lg w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 id="modal-add-entry-title" className="font-bold text-base font-serif text-foreground">Add Manual Logbook Entry</h3>
              <button
                onClick={() => setShowNewEntry(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                aria-label="Close dialog"
              >
                <MaterialIcon name="close" size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateEntry} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-entry-week" className="block font-semibold mb-1">Week Number</label>
                  <input
                    id="new-entry-week"
                    type="number"
                    min={1}
                    max={30}
                    value={newEntryData.week_number}
                    onChange={(e) => setNewEntryData({ ...newEntryData, week_number: parseInt(e.target.value) || 1 })}
                    className="w-full p-2 rounded border border-border"
                  />
                </div>
                <div>
                  <label htmlFor="new-entry-day" className="block font-semibold mb-1">Day of Week</label>
                  <select
                    id="new-entry-day"
                    value={newEntryData.day_of_week}
                    onChange={(e) => setNewEntryData({ ...newEntryData, day_of_week: e.target.value })}
                    className="w-full p-2 rounded border border-border bg-white"
                  >
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="new-entry-summary" className="block font-semibold mb-1">Activity Summary</label>
                <input
                  id="new-entry-summary"
                  type="text"
                  required
                  value={newEntryData.activity_summary}
                  onChange={(e) => setNewEntryData({ ...newEntryData, activity_summary: e.target.value })}
                  placeholder="e.g. Spliced 12-core optical cable at landing bay"
                  className="w-full p-2 rounded border border-border"
                />
              </div>

              <div>
                <label htmlFor="new-entry-tools" className="block font-semibold mb-1">Tools / Equipment Used</label>
                <input
                  id="new-entry-tools"
                  type="text"
                  value={newEntryData.tools_used}
                  onChange={(e) => setNewEntryData({ ...newEntryData, tools_used: e.target.value })}
                  placeholder="e.g. Fusion Splicer, Fiber Cleaver, OTDR"
                  className="w-full p-2 rounded border border-border"
                />
              </div>

              <div>
                <label htmlFor="new-entry-details" className="block font-semibold mb-1">Detailed Technical Explanation</label>
                <textarea
                  id="new-entry-details"
                  rows={4}
                  required
                  value={newEntryData.verified_text}
                  onChange={(e) => setNewEntryData({ ...newEntryData, verified_text: e.target.value })}
                  placeholder="Describe the procedure, safety precautions, and outcome..."
                  className="w-full p-2 rounded border border-border"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewEntry(false)}
                  className="px-3.5 py-1.5 rounded border border-border text-foreground hover:bg-muted cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-700 focus-visible:outline-none"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-emerald-800 text-white font-medium hover:bg-emerald-900 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none"
                >
                  Add Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FULL-SCREEN MOCK ORAL EXAMINATION MODAL */}
      {mockExamActive && defenceQuestions.length > 0 && (
        <div className="fixed inset-0 z-50 bg-[#111827] text-white flex flex-col" role="dialog" aria-modal="true" aria-label="Mock oral defence examination">
          <div className="p-4 border-b border-gray-800 flex items-center justify-between max-w-5xl mx-auto w-full">
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm uppercase tracking-wider text-emerald-400">
                Mock Oral Defence Examination
              </span>
              <span className="text-xs text-gray-400 font-mono">
                Question {mockExamIndex + 1} of {defenceQuestions.length}
              </span>
            </div>
            <button
              onClick={exitMockExam}
              className="px-3 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
            >
              Exit Mock Exam
            </button>
          </div>

          <div className="flex-1 max-w-3xl mx-auto w-full p-6 flex flex-col justify-center">
            <div className="space-y-6">
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-emerald-950 border border-emerald-800 text-emerald-300">
                Examiner Cross-Examination
              </span>

              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-gray-100 leading-snug">
                "{defenceQuestions[mockExamIndex]?.question}"
              </h2>

              <p className="text-xs text-gray-400">
                Take a moment to formulate your answer aloud before checking the model answer.
              </p>

              {revealedAnswers[defenceQuestions[mockExamIndex]?.id] ? (
                <div className="p-5 rounded-xl bg-gray-900 border border-emerald-900/60 text-emerald-300 text-sm space-y-2">
                  <span className="font-bold text-xs uppercase tracking-wider text-emerald-400 block">
                    Grounded Model Answer:
                  </span>
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {defenceQuestions[mockExamIndex]?.suggested_answer}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setAnswerReveal(defenceQuestions[mockExamIndex]?.id, true)}
                  className="px-4 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
                >
                  Reveal Model Answer
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-12 mt-12 border-t border-gray-800">
              <button
                disabled={mockExamIndex === 0}
                onClick={() => setMockExamIndex(mockExamIndex - 1)}
                className="px-4 py-2 rounded border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40 cursor-pointer focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none"
              >
                Previous Question
              </button>

              <button
                onClick={() => {
                  if (mockExamIndex < defenceQuestions.length - 1) {
                    setMockExamIndex(mockExamIndex + 1);
                  } else {
                    exitMockExam();
                    showToast('Mock examination complete! Review your mastery scores.', 'success');
                  }
                }}
                className="px-5 py-2 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
              >
                {mockExamIndex < defenceQuestions.length - 1 ? 'Next Question' : 'Finish Examination'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center min-h-[60vh]">
          <MaterialIcon name="progress_activity" size={24} spin className="text-emerald-800" />
        </div>
      }
    >
      <ProjectWorkspaceContent params={params} />
    </Suspense>
  );
}
