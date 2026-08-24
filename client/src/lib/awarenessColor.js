// Cursor/presence colors are derived from a connection's Yjs clientID rather
// than picked from a small fixed palette: a short list collides often enough
// that two people in the same room regularly ended up the same color, which
// reads as one cursor teleporting around instead of two separate people.
//
// The golden-angle step spreads consecutive hashes far apart on the color
// wheel, so even similar ids land on visibly different hues. Saturation and
// lightness stay in a band that keeps every hue readable as a caret and a
// selection highlight against the dark editor background.
const GOLDEN_ANGLE = 137.508;

function hashOf(id) {
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function colorForUser(id) {
  const hash = hashOf(id);
  const hue = Math.round((hash * GOLDEN_ANGLE) % 360);
  // Two small deterministic variations so same-hue collisions still differ.
  const saturation = 62 + (hash % 3) * 9; // 62 / 71 / 80
  const lightness = 58 + (Math.floor(hash / 3) % 3) * 6; // 58 / 64 / 70
  return hslToHex(hue, saturation, lightness);
}

// y-monaco composes these into CSS with an alpha suffix (`${color}66`), so
// they have to be hex, not `hsl(...)`.
function hslToHex(h, s, l) {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;

  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return `#${rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
