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
        <span style={{ color: 'var(--mut, #5f6761)', fontStyle: 'italic', fontSize: '13px' }}>
          No extracted text available for this page.
        </span>
      );
    }

    if (lowConfidenceItems.length === 0) {
      return (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '13.5px', color: 'var(--ink, #14201b)', lineHeight: '1.6' }}>
          {editedText}
        </div>
      );
    }

    const escaped = lowConfidenceItems
      .filter((s) => s.trim().length > 0)
      .map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));

    if (escaped.length === 0) {
      return (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '13.5px', color: 'var(--ink, #14201b)', lineHeight: '1.6' }}>
          {editedText}
        </div>
      );
    }

    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = editedText.split(regex);

    return (
      <div style={{ whiteSpace: 'pre-wrap', fontSize: '13.5px', color: 'var(--ink, #14201b)', lineHeight: '1.6' }}>
        {parts.map((part: string, i: number) => {
          const isLow = lowConfidenceItems.some(
            (item) => item.toLowerCase() === part.toLowerCase()
          );
          if (isLow) {
            return (
              <mark
                key={i}
                style={{
                  background: '#fbefd0',
                  color: 'var(--amb, #8a5a00)',
                  padding: '2px 5px',
                  borderRadius: '6px',
                  border: '1px solid #fde68a',
                  fontWeight: 600,
                }}
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      style={{
        backgroundColor: 'rgba(20, 32, 27, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex flex-col w-full max-w-5xl h-[92vh] rounded-3xl overflow-hidden shadow-2xl"
        style={{
          background: 'var(--card, #fffefb)',
          border: '1px solid var(--line, #e6e2d7)',
          color: 'var(--ink, #14201b)',
          fontFamily: "'Manrope', system-ui, sans-serif",
        }}
      >
        {/* Header Bar */}
        <header
          className="flex items-center justify-between px-5 py-3.5 border-b"
          style={{
            borderColor: 'var(--line, #e6e2d7)',
            background: 'var(--paper, #f8f6f1)',
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-2xl flex items-center justify-center flex-none"
              style={{
                background: 'var(--mint, #dcf0e7)',
                color: 'var(--g, #066b4d)',
              }}
            >
              <span className="ms" style={{ fontSize: '20px' }}>find_in_page</span>
            </span>
            <div>
              <h2
                style={{
                  fontFamily: "'Fraunces', Georgia, serif",
                  fontSize: '16px',
                  fontWeight: 600,
                  margin: 0,
                  color: 'var(--ink, #14201b)',
                }}
              >
                Page Review & OCR Inspection
                <span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--mut, #5f6761)', marginLeft: '8px' }}>
                  (Page #{activePage?.page_index ?? document?.page_index ?? 1})
                </span>
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--mut, #5f6761)', margin: '2px 0 0' }} className="truncate max-w-md">
                {document.original_filename || 'Logbook Page'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pageStatus === 'flagged_illegible' && (
              <span
                className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                style={{ background: '#fef2f2', color: 'var(--red, #b42318)', border: '1px solid #fecaca' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                Flagged Illegible
              </span>
            )}
            {pageStatus === 'manual_correction_needed' && (
              <span
                className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                style={{ background: '#fbefd0', color: 'var(--amb, #8a5a00)', border: '1px solid #fde68a' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                Needs Review
              </span>
            )}
            {pageStatus === 'processed' && (
              <span
                className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                style={{ background: 'var(--mint, #dcf0e7)', color: 'var(--g, #066b4d)', border: '1px solid rgba(6, 107, 77, 0.2)' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                OCR Confidence {confidencePercent}%
              </span>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-80 transition ml-2"
              style={{
                background: 'transparent',
                color: 'var(--mut, #5f6761)',
                border: 'none',
                cursor: 'pointer',
              }}
              title="Close modal"
            >
              <span className="ms" style={{ fontSize: '20px' }}>close</span>
            </button>
          </div>
        </header>

        {/* Split Container */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Left Pane: Page Image Viewer */}
          <div
            className="w-full md:w-1/2 flex flex-col border-b md:border-b-0 md:border-r relative"
            style={{
              borderColor: 'var(--line, #e6e2d7)',
              background: 'var(--paper, #f8f6f1)',
            }}
          >
            {/* Image Toolbar */}
            <div
              className="flex items-center justify-between px-3.5 py-2 border-b text-xs"
              style={{
                borderColor: 'var(--line, #e6e2d7)',
                background: 'var(--card, #fffefb)',
                color: 'var(--mut, #5f6761)',
              }}
            >
              <span style={{ fontWeight: 600 }}>Original Logbook Scan</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="px-2 py-0.5 rounded-md hover:opacity-80"
                  style={{ background: 'var(--paper, #f8f6f1)', border: '1px solid var(--line, #e6e2d7)' }}
                  title="Zoom Out"
                >
                  -
                </button>
                <span style={{ width: '38px', textAlign: 'center', fontFamily: 'monospace' }}>
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="px-2 py-0.5 rounded-md hover:opacity-80"
                  style={{ background: 'var(--paper, #f8f6f1)', border: '1px solid var(--line, #e6e2d7)' }}
                  title="Zoom In"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="px-2 py-0.5 rounded-md hover:opacity-80 text-[11px]"
                  style={{ background: 'var(--paper, #f8f6f1)', border: '1px solid var(--line, #e6e2d7)' }}
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Scrollable Zoom Area */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center" style={{ background: '#f0ede6' }}>
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
                    className="max-w-full max-h-[65vh] object-contain rounded-xl shadow-md border"
                    style={{ borderColor: 'var(--line, #e6e2d7)' }}
                  />
                </div>
              ) : (
                <div className="text-center p-8" style={{ color: 'var(--mut, #5f6761)' }}>
                  <span className="ms" style={{ fontSize: '40px', opacity: 0.5 }}>image_not_supported</span>
                  <p style={{ fontSize: '12px', marginTop: '6px' }}>No direct image preview available.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Pane: Extracted Text & Inspection */}
          <div className="w-full md:w-1/2 flex flex-col overflow-hidden" style={{ background: 'var(--card, #fffefb)' }}>
            {/* Tab Toolbar for Right Pane */}
            <div
              className="flex items-center justify-between px-4 py-2 border-b"
              style={{ borderColor: 'var(--line, #e6e2d7)', background: 'var(--paper, #f8f6f1)' }}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setViewMode('highlight')}
                  className="px-3 py-1 rounded-full text-xs font-bold transition"
                  style={{
                    background: viewMode === 'highlight' ? 'var(--mint, #dcf0e7)' : 'transparent',
                    color: viewMode === 'highlight' ? 'var(--g, #066b4d)' : 'var(--mut, #5f6761)',
                    border: viewMode === 'highlight' ? '1px solid rgba(6, 107, 77, 0.2)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  Highlights ({lowConfidenceItems.length} notices)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className="px-3 py-1 rounded-full text-xs font-bold transition"
                  style={{
                    background: viewMode === 'edit' ? 'var(--mint, #dcf0e7)' : 'transparent',
                    color: viewMode === 'edit' ? 'var(--g, #066b4d)' : 'var(--mut, #5f6761)',
                    border: viewMode === 'edit' ? '1px solid rgba(6, 107, 77, 0.2)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  Edit Transcript
                </button>
              </div>

              {onReprocess && (
                <button
                  type="button"
                  onClick={() => onReprocess(document.id)}
                  className="text-xs flex items-center gap-1 hover:opacity-80 transition"
                  style={{ color: 'var(--mut, #5f6761)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  title="Reprocess OCR on this file"
                >
                  <span className="ms" style={{ fontSize: '15px' }}>refresh</span>
                  Re-run OCR
                </button>
              )}
            </div>

            {/* Alert / Notice if low confidence items exist */}
            {lowConfidenceItems.length > 0 && (
              <div
                className="px-4 py-2 text-xs flex items-center justify-between border-b"
                style={{ background: '#fffbeb', borderColor: '#fde68a', color: 'var(--amb, #8a5a00)' }}
              >
                <span>
                  <strong>Human verification suggested:</strong> {lowConfidenceItems.length} uncertain word(s) detected.
                </span>
                {viewMode !== 'edit' && (
                  <button
                    onClick={() => setViewMode('edit')}
                    className="underline font-bold text-xs"
                    style={{ background: 'transparent', border: 'none', color: 'var(--amb, #8a5a00)', cursor: 'pointer' }}
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
                  <div
                    className="flex-1 p-3.5 rounded-2xl border overflow-y-auto"
                    style={{ background: 'var(--paper, #f8f6f1)', borderColor: 'var(--line, #e6e2d7)' }}
                  >
                    {renderHighlightedText()}
                  </div>
                  <p style={{ fontSize: '11.5px', color: 'var(--mut, #5f6761)', marginTop: '8px' }}>
                    Highlighted sections denote words with lower OCR certainty or handwritten marks. Switch to &ldquo;Edit Transcript&rdquo; to fix any misreadings.
                  </p>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  <label
                    htmlFor="extracted-editor"
                    style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink, #14201b)', marginBottom: '4px' }}
                  >
                    Editable OCR Transcript:
                  </label>
                  <textarea
                    id="extracted-editor"
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="flex-1 w-full p-3 text-sm leading-relaxed resize-none outline-none rounded-2xl border"
                    style={{
                      background: 'var(--paper, #f8f6f1)',
                      borderColor: 'var(--line, #e6e2d7)',
                      color: 'var(--ink, #14201b)',
                      fontFamily: 'inherit',
                    }}
                    placeholder="Enter or fix the logbook text extracted from this page..."
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setEditedText(initialText)}
                      className="text-xs underline hover:opacity-80"
                      style={{ background: 'transparent', border: 'none', color: 'var(--mut, #5f6761)', cursor: 'pointer' }}
                    >
                      Reset to original OCR
                    </button>
                    <span style={{ fontSize: '11.5px', color: 'var(--mut, #5f6761)', fontFamily: 'monospace' }}>
                      {editedText.length} characters
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Supervisor Signature & Verification Checkbox */}
            <div
              className="px-4 py-3 border-t flex items-center justify-between text-xs"
              style={{ borderColor: 'var(--line, #e6e2d7)', background: 'var(--paper, #f8f6f1)' }}
            >
              <label className="flex items-center gap-2 cursor-pointer select-none" style={{ color: 'var(--ink, #14201b)' }}>
                <input
                  type="checkbox"
                  checked={hasSignature}
                  onChange={(e) => setHasSignature(e.target.checked)}
                  style={{ accentColor: 'var(--g, #066b4d)', width: '16px', height: '16px' }}
                />
                <span style={{ fontWeight: 600 }}>Supervisor stamp / signature verified on this page</span>
              </label>
              {activePage?.supervisor_signature_confidence && (
                <span style={{ fontSize: '11.5px', color: 'var(--mut, #5f6761)', fontFamily: 'monospace' }}>
                  Signature confidence: {Math.round(activePage.supervisor_signature_confidence * 100)}%
                </span>
              )}
            </div>

            {/* Modal Footer Controls */}
            <footer
              className="px-4 py-3 border-t flex items-center justify-end gap-3"
              style={{ borderColor: 'var(--line, #e6e2d7)', background: 'var(--card, #fffefb)' }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 rounded-full text-xs font-bold hover:opacity-80 transition"
                style={{
                  background: 'var(--paper, #f8f6f1)',
                  border: '1px solid var(--line, #e6e2d7)',
                  color: 'var(--ink, #14201b)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 rounded-full text-xs font-extrabold flex items-center gap-2 shadow-sm transition hover:opacity-90 disabled:opacity-40"
                style={{
                  background: 'var(--g, #066b4d)',
                  color: '#fff',
                  border: 'none',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                }}
              >
                {isSaving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving corrections...</span>
                  </>
                ) : (
                  <>
                    <span className="ms" style={{ fontSize: '16px' }}>check</span>
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
