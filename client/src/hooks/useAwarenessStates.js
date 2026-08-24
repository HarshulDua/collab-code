import { useEffect, useState } from 'react';

// Reactively mirrors every connected client's awareness state (name, color,
// which file they have open), so any part of the UI can render presence
// without re-deriving it from the raw awareness instance. The local client is
// included and flagged `isSelf`, so a list can show "you" alongside everyone
// else rather than looking empty when you're alone in a room.
export function useAwarenessStates(awareness) {
  const [peers, setPeers] = useState([]);

  useEffect(() => {
    if (!awareness) return undefined;

    function update() {
      const next = [];
      awareness.getStates().forEach((state, clientID) => {
        if (state?.user) next.push({ clientID, isSelf: clientID === awareness.doc.clientID, ...state });
      });
      next.sort((a, b) => (a.isSelf === b.isSelf ? 0 : a.isSelf ? -1 : 1));
      setPeers(next);
    }

    awareness.on('change', update);
    update();
    return () => awareness.off('change', update);
  }, [awareness]);

  return peers;
}
