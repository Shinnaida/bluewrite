import React, { useEffect, useRef, useState } from 'react';

/**
 * Right-click context menu for a sidebar report item.
 * Renders a small floating menu at the cursor; Escape or outside click
 * closes it. Options, top to bottom:
 *   Open · Print · Copy report no. · History · ─── · Archive (red, last)
 * Archive is the destructive action and always sits at the very bottom.
 *
 * Props:
 *   x, y          cursor position (client coords)
 *   report        the report row {id, incident_type, status, location}
 *   isAdmin       whether destructive bypass (finalized) is allowed
 *   canArchive    permission + status check already applied by parent
 *   onClose()     dismiss
 *   onAction(action, report)  run one of: open|print|copy|history|archive
 */
export default function ReportContextMenu({ x, y, report, isAdmin, canArchive, onClose, onAction }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  // Keep the menu inside the viewport: measure after first paint and flip
  // if it would overflow the right or bottom edge.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) ny = window.innerHeight - r.height - 8;
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function run(action) {
    onAction(action, report);
    onClose();
  }

  const item = (action, label, extra = {}) => (
    <button
      key={action}
      type="button"
      className={`ctx-item ${extra.className ?? ''}`}
      onClick={() => run(action)}
      role="menuitem"
    >
      {extra.icon}
      {label}
    </button>
  );

  return (
    <>
      <div className="ctx-scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} aria-hidden="true" />
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        aria-label={`Actions for BW-${String(report.id).padStart(4, '0')}`}
        style={{ left: pos.x, top: pos.y }}
      >
        {item('open', 'Open')}
        {item('print', 'Print')}
        {item('copy', 'Copy report no.')}
        {item('history', 'History')}
        <div className="ctx-sep" aria-hidden="true" />
        {canArchive ? (
          item('archive', isAdmin && report.status === 'finalized' ? 'Archive (admin)' : 'Archive', {
            className: 'ctx-danger',
          })
        ) : (
          <button type="button" className="ctx-item is-disabled" disabled role="menuitem">
            Archived — admin only
          </button>
        )}
      </div>
    </>
  );
}
