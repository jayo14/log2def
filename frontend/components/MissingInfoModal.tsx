'use client';

import React, { useState, useEffect } from 'react';
import { CompletenessResult } from '@/lib/api';

export interface MissingInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  completeness: CompletenessResult | null;
  project: any;
  onSubmit: (data: Record<string, any>) => Promise<void>;
}

export default function MissingInfoModal({
  isOpen,
  onClose,
  completeness,
  project,
  onSubmit,
}: MissingInfoModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [dateError, setDateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize missing fields from active project
  useEffect(() => {
    if (project) {
      setFormData({
        full_name: project.full_name || '',
        matric_number: project.matric_number || '',
        university_name: project.university_name || 'Lagos State University of Science and Technology (LASUSTECH)',
        department: project.department || '',
        organization_name: project.organization_name || '',
        organization_address: project.organization_address || project.company_address || '',
        training_start_date: project.training_start_date ? String(project.training_start_date).slice(0, 10) : '',
        training_end_date: project.training_end_date ? String(project.training_end_date).slice(0, 10) : '',
        placement_department: project.placement_department || project.department_unit || '',
        industry_supervisor_name: project.industry_supervisor_name || '',
      });
      setDateError(null);
      setErrorMessage(null);
    }
  }, [project, isOpen]);

  if (!isOpen) return null;

  const missingKeys = completeness?.missing_required_fields || [];
  const uncertainKeys = completeness?.uncertain_fields || [];
  const targetKeys = Array.from(new Set([...missingKeys, ...uncertainKeys]));

  // Date validation helper
  const validateDates = (start: string, end: string) => {
    if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      if (s >= e) {
        setDateError('Training start date must be strictly before training end date.');
        return false;
      }
      const diffDays = Math.round((e.getTime() - s.getTime()) / (1000 * 3600 * 24));
      if (diffDays < 14) {
        setDateError('Training period seems too short (under 2 weeks). Please verify dates.');
        return false;
      }
    }
    setDateError(null);
    return true;
  };

  const handleInputChange = (field: string, value: string) => {
    const updated = { ...formData, [field]: value };
    setFormData(updated);

    if (field === 'training_start_date' || field === 'training_end_date') {
      validateDates(
        field === 'training_start_date' ? value : formData.training_start_date,
        field === 'training_end_date' ? value : formData.training_end_date
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validate dates if present
    if (
      (formData.training_start_date || formData.training_end_date) &&
      !validateDates(formData.training_start_date, formData.training_end_date)
    ) {
      return;
    }

    // Filter only target fields or updated fields
    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(formData)) {
      if (v !== undefined && v !== null && v.trim() !== '') {
        payload[k] = v.trim();
      }
    }

    setIsSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update missing information');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Specific question prompt mapping
  const fieldPrompts: Record<string, { title: string; subtitle: string; placeholder: string; type?: string }> = {
    organization_address: {
      title: 'Company / Placement Address',
      subtitle: 'Where is your SIWES employer physically located? Required on title page & certificate.',
      placeholder: 'e.g., Plot 12, Industrial Avenue, Ikeja, Lagos State',
    },
    training_start_date: {
      title: 'Training Start Date',
      subtitle: 'Official first day of your SIWES placement.',
      placeholder: 'YYYY-MM-DD',
      type: 'date',
    },
    training_end_date: {
      title: 'Training End Date',
      subtitle: 'Official final day of your SIWES placement.',
      placeholder: 'YYYY-MM-DD',
      type: 'date',
    },
    organization_name: {
      title: 'Company / Organization Name',
      subtitle: 'The full registered name of your place of attachment.',
      placeholder: 'e.g., Nigerian Breweries Plc, Lagos',
    },
    department: {
      title: 'Academic Department',
      subtitle: 'Your department at LASUSTECH.',
      placeholder: 'e.g., Computer Engineering',
    },
    matric_number: {
      title: 'Matriculation Number',
      subtitle: 'Your unique student identifier at LASUSTECH.',
      placeholder: 'e.g., STE/2021/0458',
    },
    full_name: {
      title: 'Full Student Name',
      subtitle: 'Surname first or formal student name.',
      placeholder: 'e.g., Babatunde Oluwaseun Emmanuel',
    },
    university_name: {
      title: 'Institution Name',
      subtitle: 'Your higher institution.',
      placeholder: 'Lagos State University of Science and Technology (LASUSTECH)',
    },
    placement_department: {
      title: 'Unit or Department at Company',
      subtitle: 'Optional: Unit within the company (e.g. IT Support, Network Operations).',
      placeholder: 'e.g., Network Infrastructure & Data Center Unit',
    },
    industry_supervisor_name: {
      title: 'Industry Supervisor Name',
      subtitle: 'Optional: Name and title of your workplace supervisor.',
      placeholder: 'e.g., Engr. T. A. Balogun (Lead Network Engineer)',
    },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      style={{
        backgroundColor: 'rgba(20, 32, 27, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90dvh]"
        style={{
          background: 'var(--card, #fffefb)',
          border: '1px solid var(--line, #e6e2d7)',
          color: 'var(--ink, #14201b)',
          fontFamily: "'Manrope', system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <header
          className="px-6 py-4 flex items-start justify-between border-b"
          style={{
            borderColor: 'var(--line, #e6e2d7)',
            background: 'var(--paper, #f8f6f1)',
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="w-10 h-10 rounded-2xl flex items-center justify-center flex-none"
              style={{
                background: targetKeys.length > 0 ? '#fbefd0' : 'var(--mint, #dcf0e7)',
                color: targetKeys.length > 0 ? 'var(--amb, #8a5a00)' : 'var(--g, #066b4d)',
              }}
            >
              <span className="ms" style={{ fontSize: '22px' }}>
                {targetKeys.length > 0 ? 'warning' : 'check_circle'}
              </span>
            </span>
            <div>
              <h2
                style={{
                  fontFamily: "'Fraunces', Georgia, serif",
                  fontSize: '18px',
                  fontWeight: 600,
                  margin: 0,
                  color: 'var(--ink, #14201b)',
                }}
              >
                {targetKeys.length > 0 ? 'Complete Missing Information' : 'Information Complete'}
              </h2>
              <p style={{ fontSize: '12.5px', color: 'var(--mut, #5f6761)', margin: '3px 0 0' }}>
                {targetKeys.length > 0
                  ? `Only ${targetKeys.length} required field${targetKeys.length === 1 ? '' : 's'} needed for your LASUSTECH report.`
                  : 'All essential information has been verified from your logbook.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:opacity-80 transition"
            style={{
              background: 'transparent',
              color: 'var(--mut, #5f6761)',
              border: 'none',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <span className="ms" style={{ fontSize: '20px' }}>close</span>
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto space-y-4" style={{ flex: 1 }}>
          {errorMessage && (
            <div
              className="p-3 rounded-2xl text-xs flex items-center gap-2"
              style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
            >
              <span className="ms" style={{ fontSize: '18px' }}>error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {dateError && (
            <div
              className="p-3 rounded-2xl text-xs flex items-center gap-2"
              style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309' }}
            >
              <span className="ms" style={{ fontSize: '18px' }}>warning</span>
              <span>{dateError}</span>
            </div>
          )}

          {targetKeys.length === 0 ? (
            <div
              className="p-5 rounded-2xl text-center space-y-2"
              style={{ background: 'var(--mint, #dcf0e7)', border: '1px solid rgba(6, 107, 77, 0.2)' }}
            >
              <span className="ms" style={{ fontSize: '32px', color: 'var(--g, #066b4d)' }}>
                verified
              </span>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--g, #066b4d)', margin: 0 }}>
                All required details are in place!
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--gd, #04513a)', margin: 0 }}>
                You can generate your 12–15 page LASUSTECH technical report directly.
              </p>
            </div>
          ) : (
            targetKeys.map((key) => {
              const meta = fieldPrompts[key] || {
                title: key.replace(/_/g, ' '),
                subtitle: 'Required for technical report formatting.',
                placeholder: '',
                type: 'text',
              };

              const isUnclear = uncertainKeys.includes(key);

              return (
                <div
                  key={key}
                  className="p-3.5 rounded-2xl space-y-1.5"
                  style={{
                    background: 'var(--paper, #f8f6f1)',
                    border: '1px solid var(--line, #e6e2d7)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor={`field-${key}`}
                      style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink, #14201b)' }}
                    >
                      {meta.title}
                      {missingKeys.includes(key) && (
                        <span style={{ color: 'var(--red, #b42318)', marginLeft: '3px' }}>*</span>
                      )}
                    </label>
                    {isUnclear && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ background: '#fbefd0', color: 'var(--amb, #8a5a00)' }}
                      >
                        Unclear in logbook
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: '11.5px', color: 'var(--mut, #5f6761)', margin: 0 }}>
                    {meta.subtitle}
                  </p>

                  <input
                    id={`field-${key}`}
                    type={meta.type || 'text'}
                    value={formData[key] || ''}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    placeholder={meta.placeholder}
                    required={missingKeys.includes(key)}
                    style={{
                      width: '100%',
                      background: 'var(--card, #fffefb)',
                      border: '1px solid var(--line, #e6e2d7)',
                      borderRadius: '12px',
                      padding: '10px 14px',
                      fontSize: '13.5px',
                      color: 'var(--ink, #14201b)',
                      outline: 'none',
                    }}
                  />
                </div>
              );
            })
          )}

          {/* Gentle reminder */}
          <div
            className="p-3 rounded-2xl text-[12px] flex items-start gap-2"
            style={{
              background: 'rgba(6, 107, 77, 0.05)',
              border: '1px solid rgba(6, 107, 77, 0.12)',
              color: 'var(--mut, #5f6761)',
            }}
          >
            <span className="ms" style={{ fontSize: '16px', color: 'var(--g, #066b4d)' }}>info</span>
            <span>
              Log2Def only asks for missing essentials. Optional fields (like company unit) may remain blank without blocking generation.
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-full text-xs font-bold transition hover:opacity-80"
              style={{
                background: 'var(--card, #fffefb)',
                border: '1px solid var(--line, #e6e2d7)',
                color: 'var(--ink, #14201b)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(dateError)}
              className="px-6 py-2.5 rounded-full text-xs font-extrabold flex items-center gap-2 shadow-sm transition hover:opacity-90 disabled:opacity-40"
              style={{
                background: 'var(--g, #066b4d)',
                color: '#fff',
                border: 'none',
                cursor: isSubmitting || Boolean(dateError) ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span className="ms" style={{ fontSize: '16px' }}>check</span>
                  <span>Confirm Details</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
