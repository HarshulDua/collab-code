import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class YjsSocketProvider {
  constructor(socket, roomId, branch, doc) {
    this.socket = socket;
    this.roomId = roomId;
    this.branch = branch;
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.synced = false;

    this._onDocUpdate = this._onDocUpdate.bind(this);
    this._onAwarenessUpdate = this._onAwarenessUpdate.bind(this);
    this._onRemoteUpdate = this._onRemoteUpdate.bind(this);
    this._onRemoteAwareness = this._onRemoteAwareness.bind(this);

    this.doc.on('update', this._onDocUpdate);
    this.awareness.on('update', this._onAwarenessUpdate);
    this.socket.on('collab:update', this._onRemoteUpdate);
    this.socket.on('collab:awareness', this._onRemoteAwareness);
  }

  join() {
    return new Promise((resolve, reject) => {
      this.socket.emit(
        'collab:join',
        { roomId: this.roomId, branch: this.branch, awarenessClientID: this.doc.clientID },
        (ack) => {
          if (ack?.error) return reject(new Error(ack.error));
          Y.applyUpdate(this.doc, base64ToBytes(ack.doc), 'remote');
          if (ack.awareness) applyAwarenessUpdate(this.awareness, base64ToBytes(ack.awareness), 'remote');
          this.synced = true;
          resolve();
        }
      );
    });
  }

  _onDocUpdate(update, origin) {
    if (origin === 'remote') return;
    this.socket.emit('collab:update', { roomId: this.roomId, branch: this.branch, update: bytesToBase64(update) });
  }

  _onRemoteUpdate({ update }) {
    Y.applyUpdate(this.doc, base64ToBytes(update), 'remote');
  }

  _onAwarenessUpdate({ added, updated, removed }, origin) {
    if (origin === 'remote') return;
    const changedIds = added.concat(updated, removed);
    if (changedIds.length === 0) return;
    const update = encodeAwarenessUpdate(this.awareness, changedIds);
    this.socket.emit('collab:awareness', { roomId: this.roomId, branch: this.branch, update: bytesToBase64(update) });
  }

  _onRemoteAwareness({ update }) {
    applyAwarenessUpdate(this.awareness, base64ToBytes(update), 'remote');
  }

  destroy() {
    this.socket.emit('collab:leave', { roomId: this.roomId, branch: this.branch });
    this.socket.off('collab:update', this._onRemoteUpdate);
    this.socket.off('collab:awareness', this._onRemoteAwareness);
    this.doc.off('update', this._onDocUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);
    this.awareness.destroy();
  }
}
