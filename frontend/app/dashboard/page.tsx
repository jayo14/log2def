'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useProjectStore, useUIStore } from '@/lib/store';
import { MaterialIcon } from '@/components/ui/material-icon';

export default function DashboardPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const {
    projects,
    aiStatus,
    isLoadingProjects,
    fetchProjects,
    fetchAiStatus,
    deleteProject,
  } = useProjectStore();
  const { showToast } = useUIStore();
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  const loadDashboardData = async () => {
    try {
      await Promise.all([fetchProjects(), fetchAiStatus()]);
    } catch (err: any) {
      showToast(err.message || 'Failed to refresh dashboard', 'error');
    }
  };

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const handleDelete = async (id: number) => {
    try {
      await deleteProject(id);
      setDeleteConfirmId(null);
      showToast('Project deleted successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete project', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'exported':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Exported</span>;
      case 'editing_report':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Report Ready to Edit</span>;
      case 'reviewing_sources':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Reviewing Sources</span>;
      case 'generating':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Generating</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">{status.replace('_', ' ')}</span>;
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <MaterialIcon name="progress_activity" size={28} spin className="text-emerald-800" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 w-full flex-1">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-serif text-foreground">
            Welcome, {user.first_name || user.username}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your SIWES technical reports, verified logbooks, and defence preparation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {aiStatus && (
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium ${
              aiStatus.available 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : 'bg-zinc-100 border-zinc-200 text-zinc-700'
            }`}>
              <MaterialIcon name="auto_awesome" size={16} />
              <span>{aiStatus.available ? `AI Enabled (${aiStatus.model})` : 'No-AI Mode: Deterministic Engine'}</span>
            </div>
          )}

          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-800 text-white font-medium text-sm hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors shadow-xs"
          >
            <MaterialIcon name="add_circle" size={18} />
            <span>New Report Project</span>
          </Link>
        </div>
      </div>

      {/* Projects List */}
      {loadingProjects ? (
        <div className="py-20 text-center">
          <MaterialIcon name="progress_activity" size={26} spin className="mx-auto text-emerald-800 mb-2" />
          <p className="text-sm text-muted-foreground">Loading your report projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-xl border border-dashed border-border bg-white max-w-xl mx-auto my-8">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center mx-auto mb-4">
            <MaterialIcon name="menu_book" size={26} />
          </div>
          <h3 className="text-lg font-bold font-serif text-foreground">No Report Projects Yet</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
            Create your first SIWES report project. You can enter your placement details, upload logbook scans, and generate your chapters.
          </p>
          <div className="mt-6">
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-emerald-800 text-white font-medium text-sm hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none shadow-xs"
            >
              <MaterialIcon name="add_circle" size={18} />
              <span>Start Your First Report</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-xl border border-border p-5 hover:border-emerald-800/40 transition-all hover:shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                  <h3 className="font-semibold text-lg text-foreground hover:text-emerald-800 truncate">
                    <Link href={`/projects/${project.id}`}>{project.title}</Link>
                  </h3>
                  {getStatusBadge(project.status)}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                  {project.organization_name && (
                    <span className="flex items-center gap-1">
                      <MaterialIcon name="domain" size={15} className="text-zinc-500" />
                      {project.organization_name}
                    </span>
                  )}
                  {project.matric_number && (
                    <span className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-700">
                      {project.matric_number}
                    </span>
                  )}
                  {project.department && <span>{project.department}</span>}
                  <span className="flex items-center gap-1">
                    <MaterialIcon name="schedule" size={15} className="text-zinc-400" />
                    Updated {new Date(project.updated_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center gap-4 mt-3 text-xs text-zinc-600">
                  <span className="flex items-center gap-1.5">
                    <MaterialIcon name="folder_open" size={16} className="text-emerald-700" />
                    <strong>{project.source_documents_count || 0}</strong> sources uploaded
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MaterialIcon name="fact_check" size={16} className="text-emerald-700" />
                    <strong>{project.logbook_entries_count || 0}</strong> logbook entries
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border">
                {deleteConfirmId === project.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="px-2.5 py-1.5 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:outline-none cursor-pointer"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2.5 py-1.5 rounded border border-border text-xs font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(project.id)}
                    className="p-2 rounded text-muted-foreground hover:text-red-700 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:outline-none transition-colors cursor-pointer"
                    title="Delete Project"
                    aria-label={`Delete project ${project.title}`}
                  >
                    <MaterialIcon name="delete" size={18} />
                  </button>
                )}

                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-50 text-emerald-900 border border-emerald-200/80 font-medium text-xs hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors"
                >
                  <span>Open Workspace</span>
                  <MaterialIcon name="arrow_forward" size={15} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
