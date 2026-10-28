import { create } from 'zustand';
import { authApi, getAuthToken, removeAuthToken } from '../api';

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  preferred_university?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (credentials: any) => Promise<any>;
  register: (data: any) => Promise<any>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: User | null) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  error: null,

  setUser: (user) => set({ user }),
  clearError: () => set({ error: null }),

  refreshUser: async () => {
    try {
      const currentToken = getAuthToken();
      if (!currentToken) {
        set({ user: null, token: null, isLoading: false, error: null });
        return;
      }
      set({ token: currentToken });
      const userData = await authApi.getCurrentUser();
      set({ user: userData, isLoading: false, error: null });
    } catch (err: any) {
      removeAuthToken();
      set({ user: null, token: null, isLoading: false, error: err.message || 'Session expired' });
    }
  },

  login: async (credentials: any) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.login(credentials);
      set({ user: res.user, token: res.access, isLoading: false, error: null });
      return res;
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Login failed' });
      throw err;
    }
  },

  register: async (data: any) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authApi.register(data);
      set({ user: res.user, token: res.tokens.access, isLoading: false, error: null });
      return res;
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Registration failed' });
      throw err;
    }
  },

  logout: () => {
    removeAuthToken();
    set({ user: null, token: null, isLoading: false, error: null });
  },
}));
