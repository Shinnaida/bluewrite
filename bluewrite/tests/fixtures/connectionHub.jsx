// BlueWrite — the render fixture for ConnectionHub (who is signed in right now).

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConnectionHub from '../../src/components/ConnectionHub.jsx';

/** A stamp `minutesAgo` before now, in the server's own "YYYY-MM-DD HH:MM:SS" form. */
export function stampAgo(minutesAgo) {
  const d = new Date(Date.now() - minutesAgo * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function render(users) {
  return renderToStaticMarkup(<ConnectionHub users={users} />);
}
