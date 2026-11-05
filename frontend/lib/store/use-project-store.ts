import { create } from 'zustand';
import { projectsApi, authApi, CompletenessResult } from '../api';

export interface ProjectState {
  projects: any[];
  activeProject: any | null;
  completeness: CompletenessResult | null;
  isLoadingProjects: boolean;
  isLoadingActiveProject: boolean;
  isLoadingCompleteness: boolean;
  aiStatus: any | null;
  error: string | null;

  fetchProjects: () => Promise<any[]>;
  fetchActiveProject: (projectId: number | string) => Promise<any>;
  ensureActiveProject: () => Promise<any>;
  fetchCompleteness: (projectId: number | string) => Promise<CompletenessResult>;
  updateMissingInfo: (projectId: number | string, data: Record<string, any>) => Promise<any>;
  fetchAiStatus: () => Promise<any>;
  createProject: (data: any) => Promise<any>;
  updateActiveProject: (projectId: number | string, data: any) => Promise<any>;
  deleteProject: (projectId: number | string) => Promise<void>;

  // Source documents & extracted pages
  uploadGuideline: (projectId: number | string, formData: FormData) => Promise<any>;
  uploadDocument: (projectId: number | string, formData: FormData) => Promise<any>;
  reorderDocuments: (projectId: number | string, order: { id: number; page_index: number }[]) => Promise<any>;
  deleteDocument: (projectId: number | string, docId: number | string) => Promise<void>;
  reprocessDocument: (projectId: number | string, docId: number | string) => Promise<any>;
  updatePage: (projectId: number | string, pageId: number | string, data: any) => Promise<any>;

  // Logbook entries
  fetchLogbookEntries: (projectId: number | string) => Promise<any[]>;
  createLogbookEntry: (projectId: number | string, data: any) => Promise<any>;
  updateLogbookEntry: (projectId: number | string, entryId: number | string, data: any) => Promise<any>;
  deleteLogbookEntry: (projectId: number | string, entryId: number | string) => Promise<void>;
  bulkVerifyEntries: (projectId: number | string, entryIds?: number[]) => Promise<any>;

  // Payment orders
  payments: any[];
  fetchPayments: (projectId: number | string) => Promise<any[]>;
  recordPayment: (projectId: number | string, data: any) => Promise<any>;

  clearActiveProject: () => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProject: null,
  completeness: null,
  payments: [],
  isLoadingProjects: false,
  isLoadingActiveProject: false,
  isLoadingCompleteness: false,
  aiStatus: null,
  error: null,

  clearActiveProject: () => set({ activeProject: null, completeness: null, error: null }),
  setError: (error) => set({ error }),

  fetchProjects: async () => {
    set({ isLoadingProjects: true, error: null });
    try {
      const data = await projectsApi.list();
      const currentActive = get().activeProject;
      const resolvedActive = currentActive || (data && data.length > 0 ? data[0] : null);
      set({
        projects: data,
        activeProject: resolvedActive,
        isLoadingProjects: false,
      });
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Failed to load projects', isLoadingProjects: false });
      throw err;
    }
  },

  ensureActiveProject: async () => {
    let current = get().activeProject;
    if (current && current.id) return current;

    if (typeof window !== 'undefined') {
      const savedId = localStorage.getItem('log2def_active_project_id');
      if (savedId) {
        try {
          const full = await get().fetchActiveProject(savedId);
          if (full && full.id) return full;
        } catch {
          localStorage.removeItem('log2def_active_project_id');
        }
      }
    }

    let list = get().projects;
    if (!list || list.length === 0) {
      try {
        list = await get().fetchProjects();
      } catch {
        list = [];
      }
    }

    if (list && list.length > 0) {
      try {
        const full = await get().fetchActiveProject(list[0].id);
        return full;
      } catch {
        set({ activeProject: list[0] });
        return list[0];
      }
    }

    try {
      const newProj = await get().createProject({
        title: 'LASUSTECH SIWES Technical Report',
        department: 'Computer Science',
        faculty_school: 'College of Basic Science',
        university_name: 'Lagos State University of Science and Technology',
      });
      return newProj;
    } catch (err) {
      console.error('Failed to ensure active project:', err);
      return null;
    }
  },

  fetchActiveProject: async (projectId: number | string) => {
    set({ isLoadingActiveProject: true, error: null });
    try {
      const data = await projectsApi.get(projectId);
      set({ activeProject: data, isLoadingActiveProject: false });
      if (typeof window !== 'undefined' && data?.id) {
        localStorage.setItem('log2def_active_project_id', String(data.id));
      }
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Failed to load project details', isLoadingActiveProject: false });
      throw err;
    }
  },

  fetchCompleteness: async (projectId: number | string) => {
    set({ isLoadingCompleteness: true, error: null });
    try {
      const data = await projectsApi.getCompleteness(projectId);
      set({ completeness: data, isLoadingCompleteness: false });
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Failed to check completeness', isLoadingCompleteness: false });
      throw err;
    }
  },

  updateMissingInfo: async (projectId: number | string, data: Record<string, any>) => {
    set({ error: null });
    try {
      const res = await projectsApi.updateMissingInfo(projectId, data);
      await get().fetchActiveProject(projectId);
      await get().fetchCompleteness(projectId);
      return res;
    } catch (err: any) {
      set({ error: err.message || 'Failed to update missing information' });
      throw err;
    }
  },

  fetchAiStatus: async () => {
    try {
      const statusData = await authApi.getAiStatus();
      set({ aiStatus: statusData });
      return statusData;
    } catch {
      set({ aiStatus: null });
      return null;
    }
  },

  createProject: async (data: any) => {
    set({ error: null });
    try {
      const newProj = await projectsApi.create(data);
      set((state) => ({
        projects: [newProj, ...state.projects],
        activeProject: newProj,
      }));
      if (typeof window !== 'undefined' && newProj?.id) {
        localStorage.setItem('log2def_active_project_id', String(newProj.id));
      }
      return newProj;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create project' });
      throw err;
    }
  },

  updateActiveProject: async (projectId: number | string, data: any) => {
    set({ error: null });
    try {
      const updated = await projectsApi.update(projectId, data);
      set((state) => ({
        activeProject: state.activeProject ? { ...state.activeProject, ...updated } : updated,
        projects: state.projects.map((p) => (p.id === Number(projectId) ? { ...p, ...updated } : p)),
      }));
      return updated;
    } catch (err: any) {
      set({ error: err.message || 'Failed to update project' });
      throw err;
    }
  },

  deleteProject: async (projectId: number | string) => {
    set({ error: null });
    try {
      await projectsApi.delete(projectId);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== Number(projectId)),
        activeProject: state.activeProject?.id === Number(projectId) ? null : state.activeProject,
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete project' });
      throw err;
    }
  },

  uploadGuideline: async (projectId: number | string, formData: FormData) => {
    set({ error: null });
    try {
      const res = await projectsApi.uploadGuideline(projectId, formData);
      await get().fetchActiveProject(projectId);
      return res;
    } catch (err: any) {
      set({ error: err.message || 'Failed to upload guideline' });
      throw err;
    }
  },

  uploadDocument: async (projectId: number | string, formData: FormData) => {
    set({ error: null });
    try {
      const doc = await projectsApi.uploadDocument(projectId, formData);
      await get().fetchActiveProject(projectId);
      return doc;
    } catch (err: any) {
      set({ error: err.message || 'Failed to upload document' });
      throw err;
    }
  },

  reorderDocuments: async (projectId: number | string, order: { id: number; page_index: number }[]) => {
    set({ error: null });
    try {
      const res = await projectsApi.reorderDocuments(projectId, order);
      await get().fetchActiveProject(projectId);
      return res;
    } catch (err: any) {
      set({ error: err.message || 'Failed to reorder documents' });
      throw err;
    }
  },

  deleteDocument: async (projectId: number | string, docId: number | string) => {
    set({ error: null });
    try {
      await projectsApi.deleteDocument(projectId, docId);
      await get().fetchActiveProject(projectId);
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete document' });
      throw err;
    }
  },

  reprocessDocument: async (projectId: number | string, docId: number | string) => {
    set({ error: null });
    try {
      const res = await projectsApi.reprocessDocument(projectId, docId);
      await get().fetchActiveProject(projectId);
      return res;
    } catch (err: any) {
      set({ error: err.message || 'Failed to reprocess document' });
      throw err;
    }
  },

  updatePage: async (projectId: number | string, pageId: number | string, data: any) => {
    set({ error: null });
    try {
      const res = await projectsApi.updatePage(projectId, pageId, data);
      await get().fetchActiveProject(projectId);
      return res;
    } catch (err: any) {
      set({ error: err.message || 'Failed to update page' });
      throw err;
    }
  },

  fetchLogbookEntries: async (projectId: number | string) => {
    try {
      const entries = await projectsApi.getLogbookEntries(projectId);
      set((state) => ({
        activeProject: state.activeProject
          ? { ...state.activeProject, logbook_entries: entries }
          : state.activeProject,
      }));
      return entries;
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch logbook entries' });
      throw err;
    }
  },

  createLogbookEntry: async (projectId: number | string, data: any) => {
    set({ error: null });
    try {
      const newEntry = await projectsApi.createLogbookEntry(projectId, data);
      await get().fetchActiveProject(projectId);
      return newEntry;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create logbook entry' });
      throw err;
    }
  },

  updateLogbookEntry: async (projectId: number | string, entryId: number | string, data: any) => {
    set({ error: null });
    try {
      const updated = await projectsApi.updateLogbookEntry(projectId, entryId, data);
      await get().fetchActiveProject(projectId);
      return updated;
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404')) {
        // If entry was deleted on backend, resync entries cleanly without error banner
        try {
          const freshEntries = await projectsApi.getLogbookEntries(projectId);
          set((state) => ({
            activeProject: state.activeProject
              ? { ...state.activeProject, logbook_entries: freshEntries }
              : state.activeProject,
          }));
        } catch {}
        return null;
      }
      set({ error: err.message || 'Failed to update logbook entry' });
      throw err;
    }
  },

  deleteLogbookEntry: async (projectId: number | string, entryId: number | string) => {
    set({ error: null });
    try {
      await projectsApi.deleteLogbookEntry(projectId, entryId);
      await get().fetchActiveProject(projectId);
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete logbook entry' });
      throw err;
    }
  },

  bulkVerifyEntries: async (projectId: number | string, entryIds?: number[]) => {
    set({ error: null });
    try {
      const res = await projectsApi.bulkVerifyEntries(projectId, entryIds);
      await get().fetchActiveProject(projectId);
      return res;
    } catch (err: any) {
      set({ error: err.message || 'Failed to bulk verify entries' });
      throw err;
    }
  },

  fetchPayments: async (projectId: number | string) => {
    try {
      const data = await projectsApi.getPayments(projectId);
      set({ payments: data });
      return data;
    } catch (err: any) {
      console.warn('Failed to load payments:', err);
      return [];
    }
  },

  recordPayment: async (projectId: number | string, data: any) => {
    try {
      const created = await projectsApi.createPayment(projectId, data);
      set((state) => ({ payments: [created, ...state.payments] }));
      return created;
    } catch (err: any) {
      set({ error: err.message || 'Failed to record payment' });
      throw err;
    }
  },
}));
