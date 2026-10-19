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
  error: string | null;

  fetchQuestions: (projectId: number | string) => Promise<any[]>;
  generateQuestions: (projectId: number | string) => Promise<any[]>;
  updateQuestion: (projectId: number | string, questionId: number, data: any) => Promise<any>;
  setSelectedCategory: (category: string) => void;
  toggleAnswerReveal: (questionId: number) => void;
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
      const questions = res.questions || [];
      set({ questions, isGeneratingQuestions: false });
      return questions;
    } catch (err: any) {
      set({ isGeneratingQuestions: false, error: err.message || 'Failed to generate defence questions' });
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
