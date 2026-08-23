const STYLE_ELEMENT_ID = 'y-remote-cursor-styles';

function getStyleElement() {
  let el = document.getElementById(STYLE_ELEMENT_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  return el;
}

function ruleForClient(clientID, color, name) {
  const escapedName = (name || 'Anonymous').replace(/"/g, '\\"');
  return `
.yRemoteSelection-${clientID} { background-color: ${color}66; }
.yRemoteSelectionHead-${clientID} {
  position: absolute;
  border-left: 2px solid ${color};
  height: 100%;
  box-sizing: border-box;
  pointer-events: none;
}
.yRemoteSelectionHead-${clientID}::after {
  content: "${escapedName}";
  position: absolute;
  top: -1.15em;
  left: -2px;
  background: ${color};
  color: #111;
  padding: 0 4px;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  border-radius: 2px 2px 2px 0;
  pointer-events: none;
}`;
}

export function watchRemoteCursorStyles(awareness) {
  const styleEl = getStyleElement();

  const update = () => {
    const rules = [];
    awareness.getStates().forEach((state, clientID) => {
      if (clientID === awareness.doc.clientID) return; // never need a rule for our own cursor
      if (state.user?.color) {
        rules.push(ruleForClient(clientID, state.user.color, state.user.name));
      }
    });
    styleEl.textContent = rules.join('\n');
  };

  awareness.on('change', update);
  update();

  return () => awareness.off('change', update);
}
