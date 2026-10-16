import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function LayoutPreview({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [editing, setEditing] = useState(false);
  const id = useId();

  useEffect(() => {
    const element = viewport.current!;
    // The board measures its root minus 8px and stacks below 700px.
    const measure = () => setNarrow(element.clientWidth < 708);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function finish() {
    setEditing(false);
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
    toggle.current?.focus();
  }

  return <div className={`layout-preview${editing ? ' is-editing' : ''}`}>
    {(narrow || editing) && <div className="layout-preview-controls">
      <div>
        <strong>{editing ? 'Layout editing' : 'Move and resize charts'}</strong>
        <p id={`${id}-hint`}>{editing
          ? 'Drag headers to move. Drag corners to resize. Swipe gaps to scroll.'
          : 'Try the full board on a wider canvas.'}</p>
      </div>
      <button ref={toggle} type="button" aria-expanded={editing} aria-controls={id}
        onClick={() => editing ? finish() : setEditing(true)}>
        {editing ? 'Done' : 'Try layout editing'}
      </button>
    </div>}
    <div ref={viewport} id={id} className="layout-preview-viewport"
      role={editing ? 'region' : undefined} aria-label={editing ? 'Scrollable dashboard canvas' : undefined}
      aria-describedby={editing ? `${id}-hint` : undefined} tabIndex={editing ? 0 : undefined}
      onKeyDown={event => {
        if (editing && event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('dialog')) {
          event.preventDefault();
          finish();
        }
      }}>
      <div className="layout-preview-canvas">{children}</div>
    </div>
  </div>;
}
