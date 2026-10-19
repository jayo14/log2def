import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

interface UIState {
  toast: {
    message: string;
    type: ToastType;
    isVisible: boolean;
  };
  modals: Record<string, boolean>;
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
  hideToast: () => void;
  openModal: (modalId: string) => void;
  closeModal: (modalId: string) => void;
  toggleModal: (modalId: string) => void;
}

let toastTimeout: NodeJS.Timeout | null = null;

export const useUIStore = create<UIState>((set) => ({
  toast: {
    message: '',
    type: 'info',
    isVisible: false,
  },
  modals: {},

  showToast: (message: string, type: ToastType = 'info', durationMs = 2800) => {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }
    set({ toast: { message, type, isVisible: true } });
    toastTimeout = setTimeout(() => {
      set((state) => ({ toast: { ...state.toast, isVisible: false } }));
    }, durationMs);
  },

  hideToast: () => {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }
    set((state) => ({ toast: { ...state.toast, isVisible: false } }));
  },

  openModal: (modalId: string) => {
    set((state) => ({ modals: { ...state.modals, [modalId]: true } }));
  },

  closeModal: (modalId: string) => {
    set((state) => ({ modals: { ...state.modals, [modalId]: false } }));
  },

  toggleModal: (modalId: string) => {
    set((state) => ({
      modals: { ...state.modals, [modalId]: !state.modals[modalId] },
    }));
  },
}));
