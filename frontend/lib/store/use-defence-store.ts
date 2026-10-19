import { create } from 'zustand';
import { projectsApi } from '../api';

export interface DefenceState {
  questions: any[];
  isLoadingQuestions: boolean;
  isGeneratingQuestions: boolean;
  selectedCategory: string;
  revealedAnswers: Record<number, boolean>;
  mockExamActive: boolean;
  mockExamIndex: number;
  mockAnswers: Record<number, string>;
  slides: any[];
  script: string;
  isLoadingSlides: boolean;
  isLoadingScript: boolean;
  slideshowOpen: boolean;
  slideshowIndex: number;
  error: string | null;

  fetchQuestions: (projectId: number | string) => Promise<any[]>;
  generateQuestions: (projectId: number | string) => Promise<any[]>;
  updateQuestion: (projectId: number | string, questionId: number, data: any) => Promise<any>;
  fetchSlides: (projectId: number | string) => Promise<any[]>;
  regenerateSlides: (projectId: number | string) => Promise<any[]>;
  fetchScript: (projectId: number | string) => Promise<string>;
  regenerateScript: (projectId: number | string) => Promise<string>;
  openSlideshow: (initialIndex?: number) => void;
  closeSlideshow: () => void;
  nextSlide: () => void;
  prevSlide: () => void;
  setSelectedCategory: (category: string) => void;
  toggleAnswerReveal: (questionId: number) => void;
  setAnswerReveal: (questionId: number, isRevealed: boolean) => void;
  revealAllAnswers: () => void;
  hideAllAnswers: () => void;
  startMockExam: () => void;
  exitMockExam: () => void;
  setMockExamIndex: (index: number) => void;
  nextMockQuestion: () => void;
  prevMockQuestion: () => void;
  setMockAnswer: (questionId: number, answer: string) => void;
  resetDefenceState: () => void;
}

export const useDefenceStore = create<DefenceState>((set, get) => ({
  questions: [],
  isLoadingQuestions: false,
  isGeneratingQuestions: false,
  selectedCategory: 'all',
  revealedAnswers: {},
  mockExamActive: false,
  mockExamIndex: 0,
  mockAnswers: {},
  slides: [],
  script: '',
  isLoadingSlides: false,
  isLoadingScript: false,
  slideshowOpen: false,
  slideshowIndex: 0,
  error: null,

  resetDefenceState: () =>
    set({
      questions: [],
      isLoadingQuestions: false,
      isGeneratingQuestions: false,
      selectedCategory: 'all',
      revealedAnswers: {},
      mockExamActive: false,
      mockExamIndex: 0,
      mockAnswers: {},
      slides: [],
      script: '',
      isLoadingSlides: false,
      isLoadingScript: false,
      slideshowOpen: false,
      slideshowIndex: 0,
      error: null,
    }),

  setSelectedCategory: (selectedCategory) => set({ selectedCategory }),

  toggleAnswerReveal: (questionId) =>
    set((state) => ({
      revealedAnswers: {
        ...state.revealedAnswers,
        [questionId]: !state.revealedAnswers[questionId],
      },
    })),

  setAnswerReveal: (questionId, isRevealed) =>
    set((state) => ({
      revealedAnswers: {
        ...state.revealedAnswers,
        [questionId]: isRevealed,
      },
    })),

  revealAllAnswers: () =>
    set((state) => {
      const all: Record<number, boolean> = {};
      state.questions.forEach((q) => {
        all[q.id] = true;
      });
      return { revealedAnswers: all };
    }),

  hideAllAnswers: () => set({ revealedAnswers: {} }),

  startMockExam: () =>
    set({
      mockExamActive: true,
      mockExamIndex: 0,
    }),

  exitMockExam: () =>
    set({
      mockExamActive: false,
    }),

  setMockExamIndex: (mockExamIndex) => set({ mockExamIndex }),

  nextMockQuestion: () => {
    const { mockExamIndex, questions, selectedCategory } = get();
    const filtered =
      selectedCategory === 'all'
        ? questions
        : questions.filter((q) => q.category === selectedCategory);
    if (mockExamIndex < filtered.length - 1) {
      set({ mockExamIndex: mockExamIndex + 1 });
    }
  },

  prevMockQuestion: () => {
    const { mockExamIndex } = get();
    if (mockExamIndex > 0) {
      set({ mockExamIndex: mockExamIndex - 1 });
    }
  },

  setMockAnswer: (questionId, answer) =>
    set((state) => ({
      mockAnswers: { ...state.mockAnswers, [questionId]: answer },
    })),

  fetchQuestions: async (projectId: number | string) => {
    set({ isLoadingQuestions: true, error: null });
    try {
      const data = await projectsApi.getDefenceQuestions(projectId);
      set({ questions: data, isLoadingQuestions: false });
      return data;
    } catch (err: any) {
      set({ questions: [], isLoadingQuestions: false, error: err.message || 'Failed to load defence questions' });
      throw err;
    }
  },

  generateQuestions: async (projectId: number | string) => {
    set({ isGeneratingQuestions: true, error: null });
    try {
      const res = await projectsApi.generateDefenceQuestions(projectId);
      const questions = Array.isArray(res) ? res : (res as any)?.questions || [];
      set({ questions, isGeneratingQuestions: false });
      return questions;
    } catch (err: any) {
      set({ isGeneratingQuestions: false, error: err.message || 'Failed to generate defence questions' });
      throw err;
    }
  },

  openSlideshow: (initialIndex = 0) =>
    set({
      slideshowOpen: true,
      slideshowIndex: Math.max(0, initialIndex),
    }),

  closeSlideshow: () =>
    set({
      slideshowOpen: false,
    }),

  nextSlide: () => {
    const { slideshowIndex, slides } = get();
    if (slideshowIndex < slides.length - 1) {
      set({ slideshowIndex: slideshowIndex + 1 });
    }
  },

  prevSlide: () => {
    const { slideshowIndex } = get();
    if (slideshowIndex > 0) {
      set({ slideshowIndex: slideshowIndex - 1 });
    }
  },

  fetchSlides: async (projectId: number | string) => {
    set({ isLoadingSlides: true, error: null });
    try {
      const data = await projectsApi.getDefenceSlides(projectId);
      const slides = data.slides || [];
      set({ slides, isLoadingSlides: false });
      return slides;
    } catch (err: any) {
      set({ slides: [], isLoadingSlides: false, error: err.message || 'Failed to load slides' });
      throw err;
    }
  },

  regenerateSlides: async (projectId: number | string) => {
    set({ isLoadingSlides: true, error: null });
    try {
      const data = await projectsApi.regenerateDefenceSlides(projectId);
      const slides = data.slides || [];
      set({ slides, isLoadingSlides: false });
      return slides;
    } catch (err: any) {
      set({ isLoadingSlides: false, error: err.message || 'Failed to regenerate slides' });
      throw err;
    }
  },

  fetchScript: async (projectId: number | string) => {
    set({ isLoadingScript: true, error: null });
    try {
      const data = await projectsApi.getDefenceScript(projectId);
      const script = data.script || '';
      set({ script, isLoadingScript: false });
      return script;
    } catch (err: any) {
      set({ script: '', isLoadingScript: false, error: err.message || 'Failed to load presentation script' });
      throw err;
    }
  },

  regenerateScript: async (projectId: number | string) => {
    set({ isLoadingScript: true, error: null });
    try {
      const data = await projectsApi.regenerateDefenceScript(projectId);
      const script = data.script || '';
      set({ script, isLoadingScript: false });
      return script;
    } catch (err: any) {
      set({ isLoadingScript: false, error: err.message || 'Failed to regenerate presentation script' });
      throw err;
    }
  },

  updateQuestion: async (projectId: number | string, questionId: number, data: any) => {
    set({ error: null });
    try {
      const updated = await projectsApi.updateDefenceQuestion(projectId, questionId, data);
      set((state) => ({
        questions: state.questions.map((q) => (q.id === questionId ? { ...q, ...updated } : q)),
      }));
      return updated;
    } catch (err: any) {
      set({ error: err.message || 'Failed to update defence question' });
      throw err;
    }
  },
}));
