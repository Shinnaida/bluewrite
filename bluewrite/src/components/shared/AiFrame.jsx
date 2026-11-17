import React from 'react';

/**
 * AiFrame — the AI assistance card's frame.
 *
 * A plain box carrying the frame's class: the ring, the ground and the clipping
 * are the stylesheet's (see the `.ir-ai-frame` rules in incident-report.css,
 * beside the workspace sizing the size test reads from that sheet). No paint of
 * its own, no animation, no glass — the card inside is the instrument, and the
 * frame is only its edge.
 */
export default function AiFrame({ children }) {
  return <div className="ir-ai-frame">{children}</div>;
}
