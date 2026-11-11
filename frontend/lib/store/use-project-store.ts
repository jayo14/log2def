import { create } from 'zustand';
import { projectsApi, authApi, CompletenessResult, UploadProgressEvent } from '../api';

export interface ProjectState {
  projects: any[];
  activeProject: any | null;
  completeness: CompletenessResult | null;
  isLoadingProjects: boolean;
  isLoadingActiveProject: boolean;
  isLoadingCompleteness: boolean;
  aiStatus: any | null;
  error: string | null;

  // Multi-report switching & workspace caching
  isSwitchingProject: boolean;
  switchingProjectId: number | null;
  workspaceCache: Record<number, any>;
  setWorkspaceCache: (projectId: number | string, data: any) => void;
  getWorkspaceFromCache: (projectId: number | string) => any | null;
  clearWorkspaceCache: (projectId?: number | string) => void;

  fetchProjects: () => Promise<any[]>;
  fetchActiveProject: (projectId: number | string) => Promise<any>;
  ensureActiveProject: () => Promise<any>;
  fetchCompleteness: (projectId: number | string) => Promise<CompletenessResult>;
  updateMissingInfo: (projectId: number | string, data: Record<string, any>) => Promise<any>;
  fetchAiStatus: () => Promise<any>;
  createProject: (data: any) => Promise<any>;
  switchProject: (projectId: number | string) => Promise<any>;
  updateActiveProject: (projectId: number | string, data: any) => Promise<any>;
  deleteProject: (projectId: number | string) => Promise<void>;

  // Source documents & extracted pages
  uploadGuideline: (projectId: number | string, formData: FormData) => Promise<any>;
  uploadDocument: (
    projectId: number | string,
    formData: FormData,
    onProgress?: (progress: UploadProgressEvent) => void
  ) => Promise<any>;
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
  initiateSquadPayment: (projectId: number | string, data: any) => Promise<any>;
  verifySquadPayment: (projectId: number | string, transactionRef: string) => Promise<any>;

  // Page range status
  pageStatus: any | null;
  fetchPageStatus: (projectId: number | string) => Promise<any>;

  // Long polling
  lastStateHash: string;
  pollProject: (projectId: number | string, options?: { timeout?: number }) => Promise<any>;

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
  pageStatus: null,
  lastStateHash: '',
  error: null,
  isSwitchingProject: false,
  switchingProjectId: null,
  workspaceCache: {},

  setWorkspaceCache: (projectId: number | string, data: any) => {
    const numId = Number(projectId);
    set((state) => ({
      workspaceCache: {
        ...state.workspaceCache,
        [numId]: { ...data, cachedAt: Date.now() },
      },
    }));
  },

  getWorkspaceFromCache: (projectId: number | string) => {
    const numId = Number(projectId);
    const cached = get().workspaceCache[numId];
    if (!cached) return null;
    // 3 minutes TTL for stale-while-revalidate
    if (Date.now() - (cached.cachedAt || 0) > 180_000) {
      return null;
    }
    return cached;
  },

  clearWorkspaceCache: (projectId?: number | string) => {
    if (projectId !== undefined) {
      const numId = Number(projectId);
      set((state) => {
        const next = { ...state.workspaceCache };
        delete next[numId];
        return { workspaceCache: next };
      });
    } else {
      set({ workspaceCache: {} });
    }
  },

  clearActiveProject: () =>
    set({
      activeProject: null,
      completeness: null,
      error: null,
      isSwitchingProject: false,
      switchingProjectId: null,
    }),
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
        title: 'SIWES Technical Report',
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

  fetchPageStatus: async (projectId: number | string) => {
    try {
      const statusData = await projectsApi.getReportPageStatus(projectId);
      set({ pageStatus: statusData });
      return statusData;
    } catch {
      set({ pageStatus: null });
      return null;
    }
  },

  pollProject: async (projectId: number | string, options?: { timeout?: number }) => {
    try {
      const currentHash = get().lastStateHash;
      const res = await projectsApi.pollProjectStatus(projectId, {
        since: currentHash,
        timeout: options?.timeout ?? 15,
      });
      if (res && res.state_hash) {
        set({ lastStateHash: res.state_hash });
        if (res.has_changes) {
          await get().fetchActiveProject(projectId).catch(() => {});
        }
      }
      return res;
    } catch {
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

  switchProject: async (projectId: number | string) => {
    const numId = Number(projectId);
    set({
      error: null,
      isSwitchingProject: true,
      switchingProjectId: numId,
    });
    try {
      // Optimistically resolve project from list if available
      const existing = get().projects.find((p) => p.id === numId);
      if (existing) {
        set({ activeProject: existing });
      }

      const full = await get().fetchActiveProject(projectId);
      set({
        isSwitchingProject: false,
        switchingProjectId: null,
      });
      if (typeof window !== 'undefined' && full?.id) {
        localStorage.setItem('log2def_active_project_id', String(full.id));
      }
      return full;
    } catch (err: any) {
      set({
        error: err.message || 'Failed to switch project',
        isSwitchingProject: false,
        switchingProjectId: null,
      });
      throw err;
    }
  },

  updateActiveProject: async (projectId: number | string, data: any) => {
    set({ error: null });
    try {
      const updated = await projectsApi.update(projectId, data);
      get().clearWorkspaceCache(projectId);
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
      get().clearWorkspaceCache(projectId);
      const remaining = get().projects.filter((p) => p.id !== Number(projectId));
      let nextActive = get().activeProject;
      if (nextActive?.id === Number(projectId)) {
        nextActive = remaining.length > 0 ? remaining[0] : null;
        if (typeof window !== 'undefined') {
          if (nextActive?.id) {
            localStorage.setItem('log2def_active_project_id', String(nextActive.id));
          } else {
            localStorage.removeItem('log2def_active_project_id');
          }
        }
      }
      set({
        projects: remaining,
        activeProject: nextActive,
      });
      if (nextActive?.id) {
        await get().fetchActiveProject(nextActive.id).catch(() => {});
      }
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

  uploadDocument: async (
    projectId: number | string,
    formData: FormData,
    onProgress?: (progress: UploadProgressEvent) => void
  ) => {
    set({ error: null });
    try {
      const doc = await projectsApi.uploadDocument(projectId, formData, onProgress);
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

  initiateSquadPayment: async (projectId: number | string, data: any) => {
    set({ error: null });
    try {
      const result = await projectsApi.squadInitialize(projectId, data);
      return result;
    } catch (err: any) {
      set({ error: err.message || 'Failed to initialize payment' });
      throw err;
    }
  },

  verifySquadPayment: async (projectId: number | string, transactionRef: string) => {
    set({ error: null });
    try {
      const result = await projectsApi.squadVerify(projectId, transactionRef);
      return result;
    } catch (err: any) {
      set({ error: err.message || 'Failed to verify payment' });
      throw err;
    }
  },
}));
