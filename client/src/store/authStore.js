import { create } from 'zustand';
import { apiClient } from '../lib/apiClient';

const STORAGE_KEY = 'collab.auth';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

function persist(token, user) {
  if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  else localStorage.removeItem(STORAGE_KEY);
}

export const useAuthStore = create((set) => ({
  ...loadStored(),
  error: null,

  async register(name, email, password) {
    set({ error: null });
    try {
      const { token, user } = await apiClient.register(name, email, password);
      persist(token, user);
      set({ token, user });
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  async login(email, password) {
    set({ error: null });
    try {
      const { token, user } = await apiClient.login(email, password);
      persist(token, user);
      set({ token, user });
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  async loginWithGoogle(credential) {
    set({ error: null });
    try {
      const { token, user } = await apiClient.loginWithGoogle(credential);
      persist(token, user);
      set({ token, user });
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },

  logout() {
    persist(null, null);
    set({ token: null, user: null });
  },
}));
