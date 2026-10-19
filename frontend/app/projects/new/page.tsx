'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { projectsApi } from '@/lib/api';
import { MaterialIcon } from '@/components/ui/material-icon';

export default function NewProjectWizard() {
  const { user } = useAuth();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    title: 'SIWES Technical Report',
    // 1. Student info
    full_name: user?.first_name ? `${user.first_name} ${user.last_name}` : '',
    matric_number: '',
    department: '',
    programme: '',
    level: '400',
    // 2. Institution
    university_name: 'Lagos State University of Science and Technology (LASUSTECH)',
    faculty_school: 'College of Applied Sciences and Technology',
    department_requirements: '',
    // 3. Placement
    organization_name: '',
    organization_address: '',
    placement_department: '',
    industry_supervisor_name: '',
    industry_supervisor_title: '',
    academic_supervisor_name: '',
    training_start_date: '',
    training_end_date: '',
    organization_activities: '',
    // 4. Technical experience
    tools_used: '',
    projects_undertaken: '',
    tasks_performed: '',
    problems_encountered: '',
    skills_acquired: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleNext = () => {
    setError('');
    if (currentStep === 1 && !formData.matric_number) {
      setError('Please provide your matriculation number.');
      return;
    }
    if (currentStep === 3 && !formData.organization_name) {
      setError('Please provide the host organization name.');
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrev = () => {
    setError('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    setError('');
    setSaving(true);

    try {
      // Auto-tune title if default
      const finalData = {
        ...formData,
        title: formData.organization_name 
          ? `SIWES Report at ${formData.organization_name}` 
          : formData.title,
        training_start_date: formData.training_start_date || null,
        training_end_date: formData.training_end_date || null,
      };

      const res = await projectsApi.create(finalData);
      router.push(`/projects/${res.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create report project.');
      setSaving(false);
    }
  };

  const steps = [
    { num: 1, label: 'Student Info', iconName: 'person' },
    { num: 2, label: 'Institution', iconName: 'school' },
    { num: 3, label: 'Placement', iconName: 'domain' },
    { num: 4, label: 'Experience', iconName: 'build' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 w-full flex-1">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none rounded transition-colors cursor-pointer"
        >
          <MaterialIcon name="arrow_back" size={16} /> <span>Back to Dashboard</span>
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold font-serif text-foreground">
          Create New SIWES Report Project
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete the setup wizard with your placement information. You can edit any details later.
        </p>
      </div>

      {/* Wizard Step Indicator */}
      <div className="grid grid-cols-4 gap-2 mb-8" role="tablist" aria-label="Wizard Steps">
        {steps.map((s) => {
          const isActive = currentStep === s.num;
          const isDone = currentStep > s.num;
          return (
            <button
              key={s.num}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Step ${s.num}: ${s.label}`}
              onClick={() => isDone && setCurrentStep(s.num)}
              className={`p-3 rounded-lg border text-left flex items-center gap-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
                isActive
                  ? 'border-emerald-800 bg-emerald-50/50 text-emerald-950 font-medium'
                  : isDone
                  ? 'border-emerald-200 bg-white text-emerald-800 cursor-pointer'
                  : 'border-border bg-white text-muted-foreground cursor-default'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono shrink-0 ${
                  isDone
                    ? 'bg-emerald-800 text-white'
                    : isActive
                    ? 'bg-emerald-800 text-white font-bold'
                    : 'bg-zinc-100 text-zinc-500'
                }`}
              >
                {isDone ? <MaterialIcon name="check" size={16} /> : s.num}
              </div>
              <span className="text-xs hidden sm:inline truncate">{s.label}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-6 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2.5"
        >
          <MaterialIcon name="error" size={18} className="text-red-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}


      {/* Wizard Step Forms */}
      <div className="bg-white rounded-xl border border-border p-6 sm:p-8 shadow-xs mb-8">
        {/* Step 1: Student Information */}
        {currentStep === 1 && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-foreground border-b border-border pb-2">
              1. Student Academic Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Full Name (Surname First or Official Order)
                </label>
                <input
                  type="text"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  placeholder="e.g. Oluwaseun Emmanuel Adeleke"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Matriculation / Student Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  name="matric_number"
                  value={formData.matric_number}
                  onChange={handleChange}
                  placeholder="e.g. STE/2021/0456 or LASUSTECH/..."
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Department
                </label>
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  placeholder="e.g. Computer Engineering"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Programme / Course
                </label>
                <input
                  type="text"
                  name="programme"
                  value={formData.programme}
                  onChange={handleChange}
                  placeholder="e.g. B.Tech Computer Engineering"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Level
                </label>
                <select
                  name="level"
                  value={formData.level}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700 bg-white"
                >
                  <option value="300">300 Level</option>
                  <option value="400">400 Level (Final Year SIWES)</option>
                  <option value="500">500 Level</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Institution Information */}
        {currentStep === 2 && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-foreground border-b border-border pb-2">
              2. Institution Information & Guidelines
            </h2>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                University / Tertiary Institution
              </label>
              <input
                type="text"
                name="university_name"
                value={formData.university_name}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
              <span className="text-[11px] text-muted-foreground mt-1 block">
                Defaulted to Lagos State University of Science and Technology (LASUSTECH).
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Faculty / College / School
              </label>
              <input
                type="text"
                name="faculty_school"
                value={formData.faculty_school}
                onChange={handleChange}
                placeholder="e.g. College of Applied Sciences and Technology (COASIT)"
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Departmental Guidelines or Specific Instructions (Optional)
              </label>
              <textarea
                name="department_requirements"
                rows={3}
                value={formData.department_requirements}
                onChange={handleChange}
                placeholder="Include any specific instructions from your departmental SIWES coordinator (e.g. specific chapter focus, font guidelines, or formatting rules)."
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>
        )}

        {/* Step 3: Industrial Placement */}
        {currentStep === 3 && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-foreground border-b border-border pb-2">
              3. Industrial Placement Details
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Host Organization Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  name="organization_name"
                  value={formData.organization_name}
                  onChange={handleChange}
                  placeholder="e.g. MainOne Cable Company, MTN Nigeria, etc."
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Department / Unit Attached To
                </label>
                <input
                  type="text"
                  name="placement_department"
                  value={formData.placement_department}
                  onChange={handleChange}
                  placeholder="e.g. Network Operations Center (NOC) / IT Support"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Host Organization Physical Address
              </label>
              <input
                type="text"
                name="organization_address"
                value={formData.organization_address}
                onChange={handleChange}
                placeholder="e.g. Victoria Island, Lagos State, Nigeria"
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Industry-Based Supervisor Full Name
                </label>
                <input
                  type="text"
                  name="industry_supervisor_name"
                  value={formData.industry_supervisor_name}
                  onChange={handleChange}
                  placeholder="e.g. Engr. Babatunde Fashola"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Supervisor Designation / Job Title
                </label>
                <input
                  type="text"
                  name="industry_supervisor_title"
                  value={formData.industry_supervisor_title}
                  onChange={handleChange}
                  placeholder="e.g. Senior Network Operations Engineer"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Institution-Based Supervisor
                </label>
                <input
                  type="text"
                  name="academic_supervisor_name"
                  value={formData.academic_supervisor_name}
                  onChange={handleChange}
                  placeholder="e.g. Dr. K. A. Salami"
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Training Start Date
                </label>
                <input
                  type="date"
                  name="training_start_date"
                  value={formData.training_start_date}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Training End Date
                </label>
                <input
                  type="date"
                  name="training_end_date"
                  value={formData.training_end_date}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Summary of Organization's Activities
              </label>
              <textarea
                name="organization_activities"
                rows={2}
                value={formData.organization_activities}
                onChange={handleChange}
                placeholder="Briefly state what the organization does (e.g. telecommunications infrastructure, subsea fiber routing, software engineering, civil works)."
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>
        )}

        {/* Step 4: Technical Experience */}
        {currentStep === 4 && (
          <div className="space-y-5">
            <h2 className="text-base font-bold text-foreground border-b border-border pb-2">
              4. Technical Experience & Key Highlights
            </h2>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Tools, Hardware, Software & Technologies Used
              </label>
              <input
                type="text"
                name="tools_used"
                value={formData.tools_used}
                onChange={handleChange}
                placeholder="e.g. Wireshark, Cisco Packet Tracer, Linux Terminal, Fiber OTDR, Python, Multimeter"
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Key Technical Tasks Performed
              </label>
              <textarea
                name="tasks_performed"
                rows={3}
                value={formData.tasks_performed}
                onChange={handleChange}
                placeholder="Describe recurring technical procedures you handled (e.g. network switch configuration, fiber termination, routine preventive maintenance, database indexing)."
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Specific Projects Undertaken
                </label>
                <textarea
                  name="projects_undertaken"
                  rows={3}
                  value={formData.projects_undertaken}
                  onChange={handleChange}
                  placeholder="e.g. Core switch redundancy migration, building LAN structured cabling, developing internal dashboard."
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                  Technical Problems & Solutions Attempted
                </label>
                <textarea
                  name="problems_encountered"
                  rows={3}
                  value={formData.problems_encountered}
                  onChange={handleChange}
                  placeholder="e.g. High fiber signal attenuation due to microbending — resolved by re-splicing with fusion splicer."
                  className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1 uppercase tracking-wider">
                Skills Acquired
              </label>
              <input
                type="text"
                name="skills_acquired"
                value={formData.skills_acquired}
                onChange={handleChange}
                placeholder="e.g. Optical diagnostics, VLAN configuration, industrial safety compliance, technical teamwork"
                className="w-full px-3.5 py-2.5 rounded-md border border-border text-sm focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>
        )}

        {/* Wizard Navigation Buttons */}
        <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={handlePrev}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-foreground text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors cursor-pointer"
            >
              <MaterialIcon name="arrow_back" size={18} />
              <span>Previous</span>
            </button>
          ) : (
            <div></div>
          )}

          {currentStep < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md bg-emerald-800 text-white text-sm font-medium hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700/60 focus-visible:outline-none transition-colors cursor-pointer"
            >
              <span>Next Step</span>
              <MaterialIcon name="arrow_forward" size={18} />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-md bg-emerald-800 text-white text-sm font-medium hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700/60 focus-visible:outline-none disabled:opacity-50 transition-colors cursor-pointer"
            >
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size={18} spin />
                  <span>Saving Project...</span>
                </>
              ) : (
                <>
                  <MaterialIcon name="save" size={18} />
                  <span>Create & Open Workspace</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
