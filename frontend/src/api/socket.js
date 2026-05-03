import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_SOCKET_URL || '';

export function connectSocket() {
  return io(URL || '/', {
    transports: ['websocket'],
    autoConnect: true,
  });
}
