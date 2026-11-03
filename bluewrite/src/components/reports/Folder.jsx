// Phone-files folder beside the Write Report sheet's Edit/zoom controls.
//
// A small, dependency-free take on the React Bits <Folder /> idea: a folder
// that stands on the sheet's desk bar and holds the files coming from the
// phone app (blotter captures filed against this report). Click to open,
// click a page to review it, Escape or outside click to close. No WebGL, no
// physics — just the flap + pages so it stays cheap on station hardware.

import React, { useEffect, useRef, useState } from 'react';
import './Folder.css';

export default function Folder({
  label = 'Phone files',
  items = [],
  onItemClick = null,
  emptyText = 'No files from the phone yet — captured photos for this report will list here.',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const shown = items.slice(0, 6);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open ]);

  return (
    <div ref={rootRef} className={`rb-folder${open ? ' is-open' : ''}`} data-open={open ? '' : undefined}>
      <button
        type="button"
        className="rb-folder-hit"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} — ${shown.length} file${shown.length === 1 ? '' : 's'} from the phone`}
        title={shown.length === 0 ? 'No files from the phone yet' : `${shown.length} file${shown.length === 1 ? '' : 's'} from the phone — click to open`}
      >
        <span className="rb-folder-back" aria-hidden="true">
          {shown.slice(0, 3).map((item, i) => (
            <span key={i} className={`rb-folder-page rb-folder-page--${i}`} />
          ))}
        </span>
        <span className="rb-folder-front" aria-hidden="true">
          <span className="rb-folder-tab">{label}</span>
        </span>
        {shown.length > 0 && <span className="rb-folder-count">{shown.length}</span>}
      </button>
      {open && (
        <div className="rb-folder-tray" role="list" aria-label={`${label} contents`}>
          {shown.length === 0 && (
            <p className="rb-folder-empty">{emptyText}</p>
          )}
          {shown.map((item, index) => {
            const name = item.title || `File ${index + 1}`;
            return (
              <button
                key={item.id ?? index}
                type="button"
                role="listitem"
                className="rb-folder-item"
                onClick={() => onItemClick?.(item, index)}
                title={item.badge ? `${item.badge} — ${name} (click to view the photo)` : `${name} (click to view the photo)`}
              >
                {item.badge && <span className="rb-folder-badge">{item.badge}</span>}
                <span className="rb-folder-item-text">
                  <span className="rb-folder-item-title">{name}</span>
                  {item.description && <span className="rb-folder-item-sub">{item.description}</span>}
                </span>
                <span className="rb-folder-go" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
