'use client';

import React, { useState, useEffect, useMemo } from 'react';

export interface PageReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: any;
  page?: any;
  onSave: (pageId: number, updatedText: string, metadata?: { has_supervisor_signature?: boolean }) => Promise<void>;
  onReprocess?: (docId: number) => Promise<void>;
}

export default function PageReviewModal({
  isOpen,
  onClose,
  document,
  page,
  onSave,
  onReprocess,
}: PageReviewModalProps) {
  const activePage = page || document?.extracted_pages?.[0] || document?.pages?.[0];

  const initialText = activePage?.extracted_text || document?.extracted_text || '';
  const [editedText, setEditedText] = useState(initialText);
  const [hasSignature, setHasSignature] = useState(
    Boolean(activePage?.supervisor_signature_detected ?? activePage?.has_supervisor_signature)
  );
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'highlight'>('highlight');

  // Reset state when page changes
  useEffect(() => {
    if (activePage) {
      setEditedText(activePage.extracted_text || document?.extracted_text || '');
      setHasSignature(
        Boolean(activePage.supervisor_signature_detected ?? activePage.has_supervisor_signature)
      );
      setZoomLevel(1);
    }
  }, [activePage, document]);

  // Extract low-confidence segments or tokens
  const lowConfidenceItems = useMemo(() => {
    const list: string[] = [];
    if (activePage?.low_confidence_segments && Array.isArray(activePage.low_confidence_segments)) {
      list.push(...activePage.low_confidence_segments);
    }
    // Also parse bracketed uncertain text like [?] or [unclear: xyz]
    const matches = (editedText || '').match(/\[\?[^\]]*\]|\[unclear[^\]]*\]|\?\?\?/gi);
    if (matches) {
      matches.forEach((m: string) => {
        if (!list.includes(m)) list.push(m);
      });
    }
    return list;
  }, [activePage, editedText]);

  if (!isOpen || !document) return null;

  const pageStatus = activePage?.status || document?.status || 'pending';
  const confidencePercent = Math.round(
    ((activePage?.confidence_score ?? activePage?.confidence ?? 0.85) * 100)
  );

  const handleSave = async () => {
    if (!activePage?.id) return;
    setIsSaving(true);
    try {
      await onSave(activePage.id, editedText, {
        has_supervisor_signature: hasSignature,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  // Render text with highlighted low-confidence segments
  const renderHighlightedText = () => {
    if (!editedText) {
      return (
        <span className="text-slate-500 italic">
          No extracted text available for this page.
        </span>
      );
    }

    if (lowConfidenceItems.length === 0) {
      return <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">{editedText}</div>;
    }

    // Escape regex characters
    const escaped = lowConfidenceItems
      .filter((s) => s.trim().length > 0)
      .map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));

    if (escaped.length === 0) {
      return <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">{editedText}</div>;
    }

    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = editedText.split(regex);

    return (
      <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
        {parts.map((part: string, i: number) => {
          const isLow = lowConfidenceItems.some(
            (item) => item.toLowerCase() === part.toLowerCase()
          );
          if (isLow) {
            return (
              <mark
                key={i}
                className="bg-amber-500/30 text-amber-200 px-1 py-0.5 rounded border border-amber-500/40 font-medium"
                title="Low confidence OCR or uncertain handwriting"
              >
                {part}
              </mark>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-fade-in">
      <div className="flex flex-col w-full max-w-6xl h-[92vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-slate-100 flex items-center gap-2">
                Page Review & OCR Inspection
                <span className="text-xs font-mono font-normal text-slate-400">
                  (Page #{activePage?.page_index ?? document?.page_index ?? 1})
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate max-w-md">
                {document.original_filename || 'Logbook Page'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pageStatus === 'flagged_illegible' && (
              <span className="px-2.5 py-1 text-xs rounded-full bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                Flagged Illegible
              </span>
            )}
            {pageStatus === 'manual_correction_needed' && (
              <span className="px-2.5 py-1 text-xs rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Needs Review
              </span>
            )}
            {pageStatus === 'processed' && (
              <span className="px-2.5 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Verified ({confidencePercent}%)
              </span>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
              title="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {/* Split Container */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Left Pane: Page Image Viewer */}
          <div className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/40 relative">
            {/* Image Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/60 border-b border-slate-800/80 text-xs text-slate-300">
              <span className="text-[11px] font-mono text-slate-400">Original Logbook Image</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  title="Zoom Out"
                >
                  -
                </button>
                <span className="text-[11px] font-mono w-10 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  title="Zoom In"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Scrollable Zoom Area */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/60">
              {document.file_url ? (
                <div
                  style={{
                    transform: `scale(${zoomLevel})`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.15s ease-out',
                  }}
                  className="max-w-full max-h-full flex items-center justify-center"
                >
                  <img
                    src={document.file_url}
                    alt={document.original_filename}
                    className="max-w-full max-h-[70vh] object-contain rounded shadow-lg border border-slate-800"
                  />
                </div>
              ) : (
                <div className="text-center p-8 text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-xs">No direct image URL available.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Pane: Extracted Text & Inspection */}
          <div className="w-full md:w-1/2 flex flex-col bg-slate-900/90 overflow-hidden">
            {/* Tab Toolbar for Right Pane */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/40">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setViewMode('highlight')}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                    viewMode === 'highlight'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Highlights ({lowConfidenceItems.length} notices)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                    viewMode === 'edit'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Edit Text
                </button>
              </div>

              {onReprocess && (
                <button
                  type="button"
                  onClick={() => onReprocess(document.id)}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  title="Reprocess OCR on this file"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Re-run OCR
                </button>
              )}
            </div>

            {/* Alert / Notice if low confidence items exist */}
            {lowConfidenceItems.length > 0 && (
              <div className="bg-amber-950/40 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200/90 flex items-center justify-between">
                <span>
                  <strong>Human verification recommended:</strong> {lowConfidenceItems.length} unclear word(s) flagged.
                </span>
                {viewMode !== 'edit' && (
                  <button
                    onClick={() => setViewMode('edit')}
                    className="underline text-amber-300 hover:text-amber-100 font-semibold text-[11px]"
                  >
                    Edit directly
                  </button>
                )}
              </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 p-4 overflow-y-auto">
              {viewMode === 'highlight' ? (
                <div className="h-full flex flex-col">
                  <div className="flex-1 p-3 bg-slate-950/50 rounded-xl border border-slate-800 overflow-y-auto font-sans">
                    {renderHighlightedText()}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Highlighted sections denote words with lower OCR certainty or handwritten marks. Switch to “Edit Text” to fix them.
                  </p>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  <label htmlFor="extracted-editor" className="text-xs font-medium text-slate-300 mb-1">
                    Editable OCR Transcript:
                  </label>
                  <textarea
                    id="extracted-editor"
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="flex-1 w-full bg-slate-950/70 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl p-3 text-sm text-slate-100 font-mono leading-relaxed resize-none outline-none"
                    placeholder="Enter or fix the logbook text extracted from this page..."
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setEditedText(initialText)}
                      className="text-xs text-slate-400 hover:text-slate-300 underline"
                    >
                      Reset to original OCR
                    </button>
                    <span className="text-[11px] font-mono text-slate-500">
                      {editedText.length} characters
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Supervisor Signature & Verification Checkbox */}
            <div className="px-4 py-3 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2.5 text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasSignature}
                  onChange={(e) => setHasSignature(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900"
                />
                <span>Supervisor stamp / signature verified on this page</span>
              </label>
              {activePage?.supervisor_signature_confidence && (
                <span className="text-[11px] text-slate-400 font-mono">
                  Detector confidence: {Math.round(activePage.supervisor_signature_confidence * 100)}%
                </span>
              )}
            </div>

            {/* Modal Footer Controls */}
            <footer className="px-4 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white rounded-lg bg-slate-800 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-2 shadow-sm transition disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving corrections...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Save & Mark Verified</span>
                  </>
                )}
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
