'use client';

import React, { useEffect, useState, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { projectsApi } from '@/lib/api';
import { 
  ArrowLeft, UploadCloud, FileText, Download, Award, Settings, 
  CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Eye, Edit3, 
  Trash2, Plus, Check, Star, Play, Sparkles, Loader2, BookOpen, Clock, Building
} from 'lucide-react';

function ProjectWorkspaceContent({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // Active Workspace Tab: 'sources' | 'report' | 'export' | 'defence' | 'details'
  const [activeTab, setActiveTab] = useState<'sources' | 'report' | 'export' | 'defence' | 'details'>('sources');
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  // Report tab state
  const [report, setReport] = useState<any>(null);
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [sectionContentDraft, setSectionContentDraft] = useState('');
  const [savingSection, setSavingSection] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [regeneratingSectionId, setRegeneratingSectionId] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  // Export tab state
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Defence tab state
  const [defenceQuestions, setDefenceQuestions] = useState<any[]>([]);
  const [generatingDefence, setGeneratingDefence] = useState(false);
  const [selectedDefenceCategory, setSelectedDefenceCategory] = useState<string>('all');
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [mockExamActive, setMockExamActive] = useState(false);
  const [mockExamIndex, setMockExamIndex] = useState(0);

  // Load Project Data
  const loadProject = async () => {
    try {
      setLoading(true);
      const data = await projectsApi.get(projectId);
      setProject(data);

      // Also check report if available
      try {
        const repData = await projectsApi.getReport(projectId);
        setReport(repData);
        if (repData.sections && repData.sections.length > 0 && !activeSectionId) {
          setActiveSectionId(repData.sections[0].id);
          setSectionContentDraft(repData.sections[0].content);
        }
      } catch {
        setReport(null);
      }

      // Load defence questions if available
      try {
        const qList = await projectsApi.getDefenceQuestions(projectId);
        setDefenceQuestions(qList);
      } catch {
        setDefenceQuestions([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load project.');
    } finally {
      setLoading(false);
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

      await projectsApi.uploadDocument(projectId, formData);
      setUploadFile(null);
      setNoteText('');
      setNoteTitle('');
      setIsNoteMode(false);
      await loadProject();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Save Page Correction
  const handleSavePage = async () => {
    if (!editingPage) return;
    setSavingPage(true);
    try {
      await projectsApi.updatePage(projectId, editingPage.id, {
        extracted_text: pageTextDraft,
        status: 'processed',
        is_reviewed: true,
      });
      setEditingPage(null);
      await loadProject();
    } catch (err: any) {
      alert(err.message || 'Failed to save page');
    } finally {
      setSavingPage(false);
    }
  };

  // Bulk Verify Entries
  const handleBulkVerify = async () => {
    try {
      await projectsApi.bulkVerifyEntries(projectId);
      await loadProject();
    } catch (err: any) {
      alert(err.message || 'Failed to verify entries');
    }
  };

  // Create Logbook Entry
  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await projectsApi.createLogbookEntry(projectId, {
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
      await loadProject();
    } catch (err: any) {
      alert(err.message || 'Failed to create logbook entry');
    }
  };

  // Delete Logbook Entry
  const handleDeleteEntry = async (entryId: number) => {
    if (!confirm('Are you sure you want to delete this logbook entry?')) return;
    try {
      await projectsApi.deleteLogbookEntry(projectId, entryId);
      await loadProject();
    } catch (err: any) {
      alert(err.message || 'Failed to delete entry');
    }
  };

  // Generate Report
  const handleGenerateReport = async (forceAll: boolean = false) => {
    setGeneratingReport(true);
    setError('');
    try {
      const repData = await projectsApi.generateReport(projectId, forceAll);
      setReport(repData);
      if (repData.sections && repData.sections.length > 0) {
        setActiveSectionId(repData.sections[0].id);
        setSectionContentDraft(repData.sections[0].content);
      }
      await loadProject();
    } catch (err: any) {
      setError(err.message || 'Report generation failed');
    } finally {
      setGeneratingReport(false);
    }
  };

  // Save Section Edit
  const handleSaveSection = async () => {
    if (!activeSectionId) return;
    setSavingSection(true);
    try {
      const updated = await projectsApi.updateSection(projectId, activeSectionId, {
        content: sectionContentDraft,
      });
      if (report && report.sections) {
        setReport({
          ...report,
          sections: report.sections.map((s: any) => (s.id === updated.id ? updated : s)),
        });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to save section');
    } finally {
      setSavingSection(false);
    }
  };

  // Regenerate Single Section
  const handleRegenerateSection = async (sectionId: number) => {
    setRegeneratingSectionId(sectionId);
    try {
      const updated = await projectsApi.regenerateSection(projectId, sectionId);
      if (activeSectionId === sectionId) {
        setSectionContentDraft(updated.content);
      }
      if (report && report.sections) {
        setReport({
          ...report,
          sections: report.sections.map((s: any) => (s.id === updated.id ? updated : s)),
        });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to regenerate section');
    } finally {
      setRegeneratingSectionId(null);
    }
  };

  // Download DOCX
  const handleDownloadDocx = async () => {
    setExportingDocx(true);
    try {
      const filename = `${project.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
      await projectsApi.downloadDocx(projectId, filename);
    } catch (err: any) {
      alert(err.message || 'DOCX download failed');
    } finally {
      setExportingDocx(false);
    }
  };

  // Download PDF
  const handleDownloadPdf = async () => {
    setExportingPdf(true);
    try {
      const filename = `${project.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      await projectsApi.downloadPdf(projectId, filename);
    } catch (err: any) {
      alert(err.message || 'PDF export and download failed');
    } finally {
      setExportingPdf(false);
    }
  };

  // Generate Defence Questions
  const handleGenerateDefence = async () => {
    setGeneratingDefence(true);
    try {
      const qList = await projectsApi.generateDefenceQuestions(projectId);
      setDefenceQuestions(qList);
    } catch (err: any) {
      alert(err.message || 'Failed to generate defence questions');
    } finally {
      setGeneratingDefence(false);
    }
  };

  // Update Mastery Status
  const handleUpdateMastery = async (questionId: number, status: string) => {
    try {
      const updated = await projectsApi.updateDefenceQuestion(projectId, questionId, {
        mastery_status: status,
      });
      setDefenceQuestions(defenceQuestions.map((q) => (q.id === questionId ? updated : q)));
    } catch (err: any) {
      console.error(err);
    }
  };

  // Toggle Hard Flag
  const handleToggleHard = async (questionId: number, currentVal: boolean) => {
    try {
      const updated = await projectsApi.updateDefenceQuestion(projectId, questionId, {
        is_flagged_hard: !currentVal,
      });
      setDefenceQuestions(defenceQuestions.map((q) => (q.id === questionId ? updated : q)));
    } catch (err: any) {
      console.error(err);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-800" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <AlertCircle className="w-8 h-8 text-red-600 mx-auto mb-3" />
        <h2 className="text-xl font-bold font-serif text-foreground">Project Not Found</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-6">
          The requested project does not exist or you do not have permission to view it.
        </p>
        <Link href="/dashboard" className="px-4 py-2 bg-emerald-800 text-white rounded-md text-sm">
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
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Back to Dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-white text-foreground text-xs font-medium hover:bg-muted transition-colors shadow-2xs"
              >
                <Download className="w-3.5 h-3.5 text-emerald-800" />
                Export Documents
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mt-3 overflow-x-auto border-t border-border/40 pt-2 text-xs font-medium">
            <button
              onClick={() => setActiveTab('sources')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors shrink-0 ${
                activeTab === 'sources'
                  ? 'bg-emerald-800 text-white font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              1. Sources & Logbook ({project.source_documents?.length || 0})
            </button>

            <button
              onClick={() => setActiveTab('report')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors shrink-0 ${
                activeTab === 'report'
                  ? 'bg-emerald-800 text-white font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              2. Report Editor {report ? `(${report.sections?.length || 0} sections)` : ''}
            </button>

            <button
              onClick={() => setActiveTab('export')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors shrink-0 ${
                activeTab === 'export'
                  ? 'bg-emerald-800 text-white font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              3. Document Export
            </button>

            <button
              onClick={() => setActiveTab('defence')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors shrink-0 ${
                activeTab === 'defence'
                  ? 'bg-emerald-800 text-white font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              4. Defence Prep ({defenceQuestions.length})
            </button>
          </div>
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
                    <label className="block w-full border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-emerald-700/60 transition-colors bg-[#FAF9F5]/40">
                      <UploadCloud className="w-8 h-8 text-emerald-800 mx-auto mb-2" />
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
                        className="hidden"
                      />
                    </label>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={uploading || (!uploadFile && !noteText.trim())}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing Source...
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-3.5 h-3.5" /> Process & Extract Text
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
                          <FileText className="w-4 h-4 text-emerald-800" />
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
                                    <AlertTriangle className="w-3 h-3" /> Manual Verification Needed
                                  </span>
                                )}
                                <button
                                  onClick={() => {
                                    setEditingPage(page);
                                    setPageTextDraft(page.extracted_text || '');
                                  }}
                                  className="text-[11px] text-emerald-800 hover:underline flex items-center gap-1 font-medium"
                                >
                                  <Edit3 className="w-3 h-3" /> Correct Text
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
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-900 border border-emerald-200 text-xs font-medium hover:bg-emerald-100"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    Verify All Entries
                  </button>
                  <button
                    onClick={() => setShowNewEntry(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Manual Entry
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
                            <Check className="w-3 h-3" /> Verified
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                            Unverified
                          </span>
                        )}
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="p-1 text-muted-foreground hover:text-red-700 rounded"
                          title="Delete entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
                <FileText className="w-10 h-10 text-emerald-800 mx-auto mb-3" />
                <h3 className="font-bold text-lg font-serif text-foreground">Generate Your Technical Report</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-6 max-w-sm mx-auto leading-relaxed">
                  Log2Def will synthesize your verified logbook records and placement details into the official LASUSTECH 5-chapter academic format.
                </p>
                <button
                  onClick={() => handleGenerateReport(false)}
                  disabled={generatingReport}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-emerald-800 text-white font-medium text-sm hover:bg-emerald-900 disabled:opacity-50"
                >
                  {generatingReport ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Generating All Sections...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Generate Structured Report
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
                      className="text-[11px] text-emerald-800 hover:underline flex items-center gap-1 font-medium"
                      title="Regenerate all sections from scratch"
                    >
                      <RefreshCw className={`w-3 h-3 ${generatingReport ? 'animate-spin' : ''}`} />
                      Regen All
                    </button>
                  </div>

                  <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
                    {report.sections?.map((sec: any) => {
                      const isSelected = sec.id === activeSectionId;
                      return (
                        <button
                          key={sec.id}
                          onClick={() => handleSelectSection(sec)}
                          className={`w-full text-left p-2.5 rounded-md text-xs transition-colors flex items-center justify-between ${
                            isSelected
                              ? 'bg-emerald-800 text-white font-medium'
                              : 'hover:bg-muted/70 text-foreground'
                          }`}
                        >
                          <span className="truncate pr-2">{sec.title}</span>
                          {sec.warnings && sec.warnings.length > 0 && (
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-amber-300' : 'bg-amber-500'}`} title="Missing information warning" />
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
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs font-medium text-foreground hover:bg-muted"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {previewMode ? 'Editor View' : 'Preview View'}
                          </button>

                          <button
                            onClick={() => handleRegenerateSection(activeSection.id)}
                            disabled={regeneratingSectionId === activeSection.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                            title="Regenerate this specific section"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${regeneratingSectionId === activeSection.id ? 'animate-spin' : ''}`} />
                            Regenerate
                          </button>

                          <button
                            onClick={handleSaveSection}
                            disabled={savingSection}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50"
                          >
                            {savingSection ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save Section
                          </button>
                        </div>
                      </div>

                      {/* Warnings Alert */}
                      {activeSection.warnings && activeSection.warnings.length > 0 && (
                        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                          <div className="font-semibold flex items-center gap-1 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
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
                          <textarea
                            value={sectionContentDraft}
                            onChange={(e) => setSectionContentDraft(e.target.value)}
                            rows={18}
                            className="w-full flex-1 p-4 rounded-lg border border-border text-sm font-mono leading-relaxed focus:outline-none focus:border-emerald-700 bg-white"
                            placeholder="Enter or edit HTML / structured section text..."
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
                <Download className="w-10 h-10 text-emerald-800 mx-auto mb-2" />
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
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50"
                  >
                    {exportingDocx ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating DOCX...
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" /> Download Word Document
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
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50"
                  >
                    {exportingPdf ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendering Validated PDF...
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" /> Download PDF Document
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
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>A4 Standard Layout & 1.5" Left Margin</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>Preliminary Roman Numerals (i, ii, iii...)</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>Certification Page with Sign-off Lines</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
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
                  onClick={() => setMockExamActive(true)}
                  disabled={defenceQuestions.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  Launch Mock Defence Mode
                </button>
                <button
                  onClick={handleGenerateDefence}
                  disabled={generatingDefence}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50"
                >
                  {generatingDefence ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" /> Generate Question Bank
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Category Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
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
                  className={`px-3 py-1.5 rounded-full border transition-colors shrink-0 ${
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
                <Award className="w-10 h-10 text-emerald-800 mx-auto mb-2" />
                <h3 className="font-bold text-base font-serif text-foreground">No Defence Questions Generated Yet</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  Click 'Generate Question Bank' above to create custom questions grounded in your host company and technical tasks.
                </p>
                <button
                  onClick={handleGenerateDefence}
                  disabled={generatingDefence}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Generate Questions Now
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
                            className={`p-1.5 rounded transition-colors ${
                              q.is_flagged_hard ? 'text-amber-500 bg-amber-50' : 'text-zinc-400 hover:text-zinc-600'
                            }`}
                            title="Flag question for revision"
                          >
                            <Star className="w-4 h-4 fill-current" />
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
                                onClick={() => setRevealedAnswers({ ...revealedAnswers, [q.id]: false })}
                                className="text-[11px] text-emerald-800 hover:underline"
                              >
                                Hide
                              </button>
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">{q.suggested_answer}</p>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRevealedAnswers({ ...revealedAnswers, [q.id]: true })}
                            className="text-xs text-emerald-800 font-medium hover:underline inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> Reveal Model Answer & Guidance
                          </button>
                        )}
                      </div>

                      {/* Self-Mastery Rating */}
                      <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground text-[11px]">Your Mastery:</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleUpdateMastery(q.id, 'confident')}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                              q.mastery_status === 'confident'
                                ? 'bg-emerald-800 text-white border-emerald-800'
                                : 'bg-white border-border text-foreground hover:bg-muted'
                            }`}
                          >
                            Confident
                          </button>
                          <button
                            onClick={() => handleUpdateMastery(q.id, 'needs_practice')}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-border p-6 max-w-2xl w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-base font-serif text-foreground">
                Verify / Correct Page {editingPage.page_number} Text
              </h3>
              <button
                onClick={() => setEditingPage(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
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
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingPage(null)}
                className="px-3.5 py-2 rounded border border-border text-xs font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePage}
                disabled={savingPage}
                className="px-4 py-2 rounded bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-900 disabled:opacity-50"
              >
                {savingPage ? 'Saving...' : 'Save & Verify Page'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add Manual Logbook Entry */}
      {showNewEntry && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-border p-6 max-w-lg w-full shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-base font-serif text-foreground">Add Manual Logbook Entry</h3>
              <button
                onClick={() => setShowNewEntry(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateEntry} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Week Number</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={newEntryData.week_number}
                    onChange={(e) => setNewEntryData({ ...newEntryData, week_number: parseInt(e.target.value) || 1 })}
                    className="w-full p-2 rounded border border-border"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Day of Week</label>
                  <select
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
                <label className="block font-semibold mb-1">Activity Summary</label>
                <input
                  type="text"
                  required
                  value={newEntryData.activity_summary}
                  onChange={(e) => setNewEntryData({ ...newEntryData, activity_summary: e.target.value })}
                  placeholder="e.g. Spliced 12-core optical cable at landing bay"
                  className="w-full p-2 rounded border border-border"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Tools / Equipment Used</label>
                <input
                  type="text"
                  value={newEntryData.tools_used}
                  onChange={(e) => setNewEntryData({ ...newEntryData, tools_used: e.target.value })}
                  placeholder="e.g. Fusion Splicer, Fiber Cleaver, OTDR"
                  className="w-full p-2 rounded border border-border"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Detailed Technical Explanation</label>
                <textarea
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
                  className="px-3.5 py-1.5 rounded border border-border text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-emerald-800 text-white font-medium hover:bg-emerald-900"
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
        <div className="fixed inset-0 z-50 bg-[#111827] text-white flex flex-col">
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
              onClick={() => setMockExamActive(false)}
              className="px-3 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
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
                  onClick={() =>
                    setRevealedAnswers({
                      ...revealedAnswers,
                      [defenceQuestions[mockExamIndex]?.id]: true,
                    })
                  }
                  className="px-4 py-2 rounded-md bg-emerald-800 text-white text-xs font-medium hover:bg-emerald-700"
                >
                  Reveal Model Answer
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-12 mt-12 border-t border-gray-800">
              <button
                disabled={mockExamIndex === 0}
                onClick={() => setMockExamIndex(mockExamIndex - 1)}
                className="px-4 py-2 rounded border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
              >
                Previous Question
              </button>

              <button
                onClick={() => {
                  if (mockExamIndex < defenceQuestions.length - 1) {
                    setMockExamIndex(mockExamIndex + 1);
                  } else {
                    setMockExamActive(false);
                    alert('Mock examination complete! Review your mastery scores in the defence workspace.');
                  }
                }}
                className="px-5 py-2 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500"
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
          <Loader2 className="w-6 h-6 animate-spin text-emerald-800" />
        </div>
      }
    >
      <ProjectWorkspaceContent params={params} />
    </Suspense>
  );
}
