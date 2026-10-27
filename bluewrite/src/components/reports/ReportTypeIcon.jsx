import React from 'react';

// ============================================================================
// ReportTypeIcon — the incident-type glyph a Glass Folder wears.
//
// There is no icon library in this app: every icon is an inline <svg> drawn with
// `stroke="currentColor"`, and these follow the same convention (24×24 viewBox,
// fill none, round caps, aria-hidden) so a folder's glyph inherits the card's
// ink and weight like every other mark in the interface.
//
// The KEY comes from lib/reportFolder.js (typeIcon). Keeping the drawings here
// and the type→key map there means the map stays plain data the tests can read
// without parsing JSX — and a glyph that is never referenced from the map is
// obvious, because the only caller is a card.
// ============================================================================

const GLYPHS = {
  // Traffic Accident
  car: (
    <>
      <path d="M4 14.6 5.6 9.4A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4l1.6 5.2" />
      <path d="M3 14.6h18v3.1a.8.8 0 0 1-.8.8h-1.9a.8.8 0 0 1-.8-.8v-.9H6.5v.9a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8z" />
      <circle cx="7.4" cy="17.3" r="1" />
      <circle cx="16.6" cy="17.3" r="1" />
    </>
  ),
  // Theft — a bag: something carried off
  bag: (
    <>
      <path d="M5.2 8h13.6l-1 12.3H6.2z" />
      <path d="M9 8V6.4a3 3 0 0 1 6 0V8" />
    </>
  ),
  // Robbery — a bandit mask
  mask: (
    <>
      <path d="M3.2 12c3-1.6 14.6-1.6 17.6 0 0 3.6-3.1 5.2-6.2 5.2-1.4 0-2.6-.8-2.6-.8s-1.2.8-2.6.8c-3.1 0-6.2-1.6-6.2-5.2z" />
      <path d="M7.4 12.5h2M14.6 12.5h2" />
    </>
  ),
  // Assault / Physical Injury — a dressing/plaster
  bandage: (
    <g transform="rotate(-45 12 12)">
      <rect x="6.6" y="2.4" width="10.8" height="19.2" rx="5.4" />
      <path d="M9.6 8.4h4.8M9.6 12h4.8M9.6 15.6h4.8" />
    </g>
  ),
  // Rape / Sexual Assault — protection, urgently
  'shield-alert': (
    <>
      <path d="M12 3 5 6v5.2c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
      <path d="M12 9.2v3.6M12 16.2h.01" />
    </>
  ),
  // Domestic Violence — the home, flagged
  'home-alert': (
    <>
      <path d="M4 10.6 12 4l8 6.6" />
      <path d="M6.2 9.9V19a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.9" />
      <path d="M12 12.4v3.2M12 18.3h.01" />
    </>
  ),
  // Missing Person — looking for a person
  'user-search': (
    <>
      <circle cx="9.6" cy="8" r="3.1" />
      <path d="M4.2 19.4c0-3 2.4-5.1 5.4-5.1.9 0 1.7.2 2.5.5" />
      <circle cx="16.4" cy="16.4" r="2.9" />
      <path d="M18.6 18.6 21.4 21.4" />
    </>
  ),
  // Lost Property — looking through a package
  'package-search': (
    <>
      <path d="M12 3.2 4.2 7v10L12 20.8 19.8 17V7z" />
      <path d="M4.2 7 12 10.8 19.8 7M12 20.8V10.8" />
      <circle cx="15.6" cy="15.6" r="2.5" />
      <path d="M17.4 17.4 19.6 19.6" />
    </>
  ),
  // Fraud / Estafa — the card
  'credit-card': (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M6.6 14h3.2" />
    </>
  ),
  // Property Damage / Malicious Mischief — a hammer
  hammer: (
    <>
      <path d="M14.4 3.2 20.8 9.6a1.5 1.5 0 0 1 0 2.1l-1.3 1.3a1.5 1.5 0 0 1-2.1 0l-6.4-6.4a1.5 1.5 0 0 1 0-2.1l1.3-1.3a1.5 1.5 0 0 1 2.1 0z" />
      <path d="M12.6 8.5 4 17.1a1.8 1.8 0 0 0 2.5 2.5l8.6-8.6" />
    </>
  ),
  // Fire Incident
  flame: (
    <>
      <path d="M12 3c2.7 3.3 4.6 5.7 4.6 8.5a4.6 4.6 0 0 1-9.2 0C7.4 8.7 9.3 6.3 12 3z" />
      <path d="M12 20.4a3 3 0 0 0 3-3c0-1.4-1-2.4-1.8-3.6" />
    </>
  ),
  // Drug-Related Incident — a vial
  vial: (
    <>
      <path d="M9.2 3h5.6" />
      <path d="M10.2 3v13.3a1.8 1.8 0 0 0 3.6 0V3" />
      <path d="M10.2 12.4h3.6" />
    </>
  ),
  // Burglary / Break-In — an opened door
  'door-open': (
    <>
      <path d="M4.6 19.6h14.8" />
      <path d="M8 19.6V5.7a1 1 0 0 1 .7-1l6-1.7a1 1 0 0 1 1.3 1v15.6" />
      <path d="M13.2 4.9l2.8.8" />
      <path d="M12.2 12.5h.01" />
    </>
  ),
  // Other Incident — a plain record
  'file-text': (
    <>
      <path d="M14 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.2V8h5" />
      <path d="M9.2 12.8h5.6M9.2 16.4h5.6" />
    </>
  ),
};

export default function ReportTypeIcon({ name, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name] ?? GLYPHS['file-text']}
    </svg>
  );
}
