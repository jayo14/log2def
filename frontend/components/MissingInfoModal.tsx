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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="flex flex-col w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-amber-500/20 text-amber-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <h2 className="text-base font-semibold text-slate-100">
                Essential Information Needed
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Only {targetKeys.length} question{targetKeys.length === 1 ? '' : 's'} to unlock your technical report. No big profile forms.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs">
              {errorMessage}
            </div>
          )}

          {dateError && (
            <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{dateError}</span>
            </div>
          )}

          {targetKeys.length === 0 ? (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs text-center">
              All essential required fields are complete! You can generate your report right away.
            </div>
          ) : (
            targetKeys.map((key) => {
              const meta = fieldPrompts[key] || {
                title: key.replace(/_/g, ' '),
                subtitle: 'Required for technical report formatting.',
                placeholder: '',
                type: 'text',
              };

              return (
                <div key={key} className="space-y-1.5 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`field-${key}`} className="text-xs font-semibold text-slate-200">
                      {meta.title}
                    </label>
                    {uncertainKeys.includes(key) && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Unclear in logbook
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    {meta.subtitle}
                  </p>
                  <input
                    id={`field-${key}`}
                    type={meta.type || 'text'}
                    value={formData[key] || ''}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    placeholder={meta.placeholder}
                    required={missingKeys.includes(key)}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition"
                  />
                </div>
              );
            })
          )}

          {/* Optional notice */}
          <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-[11px] text-slate-400">
            💡 <strong>Note:</strong> Optional fields (such as workplace department unit and supervisor names) can stay blank and will never prevent you from generating your report.
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white rounded-lg bg-slate-800 hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(dateError)}
              className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-2 shadow-sm transition disabled:opacity-40"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save & Continue</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
