import { useEffect, useRef, useState } from 'react';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function VideoCallPanel({ socket, roomId }) {
  const [remoteStreams, setRemoteStreams] = useState({});
  const [joined, setJoined] = useState(false);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcsRef = useRef(new Map());

  useEffect(() => {
    let cancelled = false;

    function getOrCreatePeerConnection(peerId) {
      let pc = pcsRef.current.get(peerId);
      if (pc) return pc;

      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcsRef.current.set(peerId, pc);

      localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));

      pc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('webrtc:signal', { roomId, to: peerId, data: event.candidate });
      };
      pc.ontrack = (event) => {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: event.streams[0] }));
      };

      return pc;
    }

    function removePeer(peerId) {
      pcsRef.current.get(peerId)?.close();
      pcsRef.current.delete(peerId);
      setRemoteStreams((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    }

    async function onSignal({ from, data }) {
      const pc = getOrCreatePeerConnection(from);
      if (data.type === 'offer') {
        await pc.setRemoteDescription(data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:signal', { roomId, to: from, data: answer });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(data);
      } else {
        await pc.addIceCandidate(data).catch(() => {});
      }
    }

    function onPeerLeft({ peerId }) {
      removePeer(peerId);
    }

    async function start() {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        localStreamRef.current = null;
      }
      if (cancelled) return;
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;

      socket.on('webrtc:signal', onSignal);
      socket.on('webrtc:peer-left', onPeerLeft);

      socket.emit('webrtc:join', { roomId }, async (ack) => {
        if (cancelled || ack?.error) return;
        setJoined(true);
        for (const peerId of ack.peers) {
          const pc = getOrCreatePeerConnection(peerId);
          // eslint-disable-next-line no-await-in-loop
          const offer = await pc.createOffer();
          // eslint-disable-next-line no-await-in-loop
          await pc.setLocalDescription(offer);
          socket.emit('webrtc:signal', { roomId, to: peerId, data: offer });
        }
      });
    }

    start();

    return () => {
      cancelled = true;
      socket.off('webrtc:signal', onSignal);
      socket.off('webrtc:peer-left', onPeerLeft);
      socket.emit('webrtc:leave', { roomId });
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [socket, roomId]);

  return (
    <div className="video-panel">
      <video ref={localVideoRef} autoPlay muted playsInline className="video-tile" />
      {Object.entries(remoteStreams).map(([peerId, stream]) => (
        <RemoteVideo key={peerId} stream={stream} />
      ))}
      {!joined && <div className="video-status">Connecting to video…</div>}
    </div>
  );
}

function RemoteVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="video-tile" />;
}
