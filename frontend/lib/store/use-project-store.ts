import { create } from 'zustand';
import { projectsApi, authApi } from '../api';

export interface ProjectState {
  projects: any[];
  activeProject: any | null;
  isLoadingProjects: boolean;
  isLoadingActiveProject: boolean;
  aiStatus: any | null;
  error: string | null;

  fetchProjects: () => Promise<any[]>;
  fetchActiveProject: (projectId: number | string) => Promise<any>;
  fetchAiStatus: () => Promise<any>;
  createProject: (data: any) => Promise<any>;
  updateActiveProject: (projectId: number | string, data: any) => Promise<any>;
  deleteProject: (projectId: number | string) => Promise<void>;

  // Source documents & extracted pages
  uploadGuideline: (projectId: number | string, formData: FormData) => Promise<any>;
  uploadDocument: (projectId: number | string, formData: FormData) => Promise<any>;
  deleteDocument: (projectId: number | string, docId: number | string) => Promise<void>;
  reprocessDocument: (projectId: number | string, docId: number | string) => Promise<any>;
  updatePage: (projectId: number | string, pageId: number | string, data: any) => Promise<any>;

  // Logbook entries
  fetchLogbookEntries: (projectId: number | string) => Promise<any[]>;
  createLogbookEntry: (projectId: number | string, data: any) => Promise<any>;
  updateLogbookEntry: (projectId: number | string, entryId: number | string, data: any) => Promise<any>;
  deleteLogbookEntry: (projectId: number | string, entryId: number | string) => Promise<void>;
  bulkVerifyEntries: (projectId: number | string, entryIds?: number[]) => Promise<any>;

  clearActiveProject: () => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProject: null,
  isLoadingProjects: false,
  isLoadingActiveProject: false,
  aiStatus: null,
  error: null,

  clearActiveProject: () => set({ activeProject: null, error: null }),
  setError: (error) => set({ error }),

  fetchProjects: async () => {
    set({ isLoadingProjects: true, error: null });
    try {
      const data = await projectsApi.list();
      set({ projects: data, isLoadingProjects: false });
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Failed to load projects', isLoadingProjects: false });
      throw err;
    }
  },

  fetchActiveProject: async (projectId: number | string) => {
    set({ isLoadingActiveProject: true, error: null });
    try {
      const data = await projectsApi.get(projectId);
      set({ activeProject: data, isLoadingActiveProject: false });
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Failed to load project details', isLoadingActiveProject: false });
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
      set((state) => ({ projects: [newProj, ...state.projects] }));
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
}));
