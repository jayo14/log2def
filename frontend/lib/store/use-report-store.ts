import { create } from 'zustand';
import { projectsApi } from '../api';

export interface ReportState {
  report: any | null;
  activeSectionId: number | null;
  sectionDrafts: Record<number, string>;
  isLoadingReport: boolean;
  isGeneratingReport: boolean;
  isSavingSection: boolean;
  regeneratingSectionId: number | null;
  previewMode: boolean;
  isExportingDocx: boolean;
  isExportingPdf: boolean;
  error: string | null;

  fetchReport: (projectId: number | string) => Promise<any>;
  generateReport: (projectId: number | string, forceAll?: boolean) => Promise<any>;
  setActiveSectionId: (sectionId: number | null) => void;
  setSectionDraft: (sectionId: number, content: string) => void;
  saveSection: (projectId: number | string, sectionId: number, content?: string, title?: string) => Promise<any>;
  regenerateSection: (projectId: number | string, sectionId: number) => Promise<any>;
  setPreviewMode: (preview: boolean) => void;
  downloadDocx: (projectId: number | string, filename?: string) => Promise<void>;
  downloadPdf: (projectId: number | string, filename?: string) => Promise<void>;
  resetReportState: () => void;
}

export const useReportStore = create<ReportState>((set, get) => ({
  report: null,
  activeSectionId: null,
  sectionDrafts: {},
  isLoadingReport: false,
  isGeneratingReport: false,
  isSavingSection: false,
  regeneratingSectionId: null,
  previewMode: false,
  isExportingDocx: false,
  isExportingPdf: false,
  error: null,

  resetReportState: () =>
    set({
      report: null,
      activeSectionId: null,
      sectionDrafts: {},
      isLoadingReport: false,
      isGeneratingReport: false,
      isSavingSection: false,
      regeneratingSectionId: null,
      previewMode: false,
      isExportingDocx: false,
      isExportingPdf: false,
      error: null,
    }),

  setActiveSectionId: (sectionId) => {
    set((state) => {
      const draft = sectionId && state.report?.sections
        ? state.sectionDrafts[sectionId] ?? state.report.sections.find((s: any) => s.id === sectionId)?.content ?? ''
        : '';
      return {
        activeSectionId: sectionId,
        sectionDrafts: sectionId ? { ...state.sectionDrafts, [sectionId]: draft } : state.sectionDrafts,
      };
    });
  },

  setSectionDraft: (sectionId, content) =>
    set((state) => ({
      sectionDrafts: { ...state.sectionDrafts, [sectionId]: content },
    })),

  setPreviewMode: (previewMode) => set({ previewMode }),

  fetchReport: async (projectId: number | string) => {
    set({ isLoadingReport: true, error: null });
    try {
      const data = await projectsApi.getReport(projectId);
      set({ report: data, isLoadingReport: false });
      if (data.sections && data.sections.length > 0 && !get().activeSectionId) {
        const first = data.sections[0];
        set((state) => ({
          activeSectionId: first.id,
          sectionDrafts: { ...state.sectionDrafts, [first.id]: first.content || '' },
        }));
      }
      return data;
    } catch (err: any) {
      set({ report: null, isLoadingReport: false, error: err.message || 'Report not found' });
      throw err;
    }
  },

  generateReport: async (projectId: number | string, forceAll: boolean = false) => {
    set({ isGeneratingReport: true, error: null });
    try {
      const data = await projectsApi.generateReport(projectId, forceAll);
      set({ report: data, isGeneratingReport: false });
      if (data.sections && data.sections.length > 0) {
        const first = data.sections[0];
        set({
          activeSectionId: first.id,
          sectionDrafts: { [first.id]: first.content || '' },
        });
      }
      return data;
    } catch (err: any) {
      set({ isGeneratingReport: false, error: err.message || 'Failed to generate report' });
      throw err;
    }
  },

  saveSection: async (projectId: number | string, sectionId: number, content?: string, title?: string) => {
    set({ isSavingSection: true, error: null });
    try {
      const draftContent = content ?? get().sectionDrafts[sectionId] ?? '';
      const payload: Record<string, any> = { content: draftContent };
      if (title) payload.title = title;

      const updatedSection = await projectsApi.updateSection(projectId, sectionId, payload);

      set((state) => {
        if (!state.report) return { isSavingSection: false };
        const updatedSections = state.report.sections.map((s: any) =>
          s.id === sectionId ? { ...s, ...updatedSection } : s
        );
        return {
          report: { ...state.report, sections: updatedSections },
          sectionDrafts: { ...state.sectionDrafts, [sectionId]: updatedSection.content },
          isSavingSection: false,
        };
      });
      return updatedSection;
    } catch (err: any) {
      set({ isSavingSection: false, error: err.message || 'Failed to save section' });
      throw err;
    }
  },

  regenerateSection: async (projectId: number | string, sectionId: number) => {
    set({ regeneratingSectionId: sectionId, error: null });
    try {
      const updatedSection = await projectsApi.regenerateSection(projectId, sectionId);
      set((state) => {
        if (!state.report) return { regeneratingSectionId: null };
        const updatedSections = state.report.sections.map((s: any) =>
          s.id === sectionId ? { ...s, ...updatedSection } : s
        );
        return {
          report: { ...state.report, sections: updatedSections },
          sectionDrafts: { ...state.sectionDrafts, [sectionId]: updatedSection.content },
          regeneratingSectionId: null,
        };
      });
      return updatedSection;
    } catch (err: any) {
      set({ regeneratingSectionId: null, error: err.message || 'Failed to regenerate section' });
      throw err;
    }
  },

  downloadDocx: async (projectId: number | string, filename?: string) => {
    set({ isExportingDocx: true, error: null });
    try {
      await projectsApi.downloadDocx(projectId, filename);
    } catch (err: any) {
      set({ error: err.message || 'DOCX export failed' });
      throw err;
    } finally {
      set({ isExportingDocx: false });
    }
  },

  downloadPdf: async (projectId: number | string, filename?: string) => {
    set({ isExportingPdf: true, error: null });
    try {
      await projectsApi.downloadPdf(projectId, filename);
    } catch (err: any) {
      set({ error: err.message || 'PDF export failed' });
      throw err;
    } finally {
      set({ isExportingPdf: false });
    }
  },
}));
