export function ResizeHandle({ onMouseDown, label }) {
  return <div className="resize-handle" onMouseDown={onMouseDown} role="separator" aria-label={label} aria-orientation="vertical" />;
}
