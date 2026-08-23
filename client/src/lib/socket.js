import { io } from 'socket.io-client';

function resolveApiOrigin() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000`;
}
const API_ORIGIN = resolveApiOrigin();

export function createSocket(token) {
  return io(API_ORIGIN, {
    auth: { token },
    transports: ['websocket'],
  });
}

export function emitAck(socket, event, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack?.error) return reject(new Error(ack.error));
      resolve(ack || {});
    });
  });
}
