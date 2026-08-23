function resolveApiOrigin() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
}
const API_ORIGIN = resolveApiOrigin();
const BASE_URL = `${API_ORIGIN}/api`;

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const apiClient = {
  register: (name, email, password) => request('/auth/register', { method: 'POST', body: { name, email, password } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: (token) => request('/auth/me', { token }),

  createRoom: (token, name) => request('/rooms', { method: 'POST', token, body: { name } }),
  listRooms: (token) => request('/rooms', { token }),
  getRoom: (token, id) => request(`/rooms/${id}`, { token }),
  joinRoom: (token, id) => request(`/rooms/${id}/join`, { method: 'POST', token }),
  deleteRoom: (token, id) => request(`/rooms/${id}`, { method: 'DELETE', token }),
  getMessages: (token, id) => request(`/rooms/${id}/messages`, { token }),

  execute: (token, language, code, roomId) =>
    request('/execute', { method: 'POST', token, body: { language, code, roomId } }),

  adminListRooms: (token) => request('/admin/rooms', { token }),
  adminRoomDetail: (token, id) => request(`/admin/rooms/${id}`, { token }),
  adminStats: (token) => request('/admin/stats', { token }),
  adminLogs: (token) => request('/admin/logs', { token }),
};
