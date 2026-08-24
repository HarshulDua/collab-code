import { create } from 'zustand';
import { apiClient } from '../lib/apiClient';

export const useRoomStore = create((set, get) => ({
  rooms: [],
  error: null,
  loading: false,

  async fetchRooms(token) {
    set({ loading: true, error: null });
    try {
      const { rooms } = await apiClient.listRooms(token);
      set({ rooms, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  async createRoom(token, name) {
    set({ error: null });
    try {
      const { room } = await apiClient.createRoom(token, name);
      set({ rooms: [room, ...get().rooms] });
      return room;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  async joinRoom(token, roomId) {
    set({ error: null });
    try {
      const { room } = await apiClient.joinRoom(token, roomId);
      return room;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  async deleteRoom(token, roomId) {
    set({ error: null });
    try {
      await apiClient.deleteRoom(token, roomId);
      set({ rooms: get().rooms.filter((r) => r.id !== roomId) });
      return true;
    } catch (err) {
      set({ error: err.message });
      return false;
    }
  },
}));
