import { useCallback, useState } from 'react';

// Drag-to-resize a panel's width, persisted per-panel across sessions.
// `side` says which edge of the panel the handle sits on: 'right' means
// dragging right grows the panel (a left-hand sidebar), 'left' means
// dragging left grows it (a right-hand sidebar).
export function useResizableWidth({ storageKey, defaultWidth, min = 150, max = 600, side = 'right' }) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return Number.isFinite(stored) && stored > 0 ? stored : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });

  const onMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const latest = { current: startWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMouseMove(ev) {
        const delta = ev.clientX - startX;
        const next = side === 'right' ? startWidth + delta : startWidth - delta;
        const clamped = Math.min(max, Math.max(min, next));
        latest.current = clamped;
        setWidth(clamped);
      }
      function onMouseUp() {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(storageKey, String(latest.current));
        } catch {
          // localStorage unavailable — resize still works, just doesn't persist
        }
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [width, min, max, side, storageKey]
  );

  return [width, onMouseDown];
}
