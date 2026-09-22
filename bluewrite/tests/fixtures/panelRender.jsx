import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProfilePanel from '../../src/components/ProfilePanel.jsx';

const NOOP = () => {};

export function renderProfile(user) {
  return renderToStaticMarkup(
    React.createElement(ProfilePanel, {
      user,
      stationName: 'Station 4',
      formFormat: 'standard',
      onFormFormat: NOOP,
      theme: 'light',
      onTheme: NOOP,
      density: 'comfortable',
      onDensity: NOOP,
      onClose: NOOP,
      onConnError: NOOP,
      onPasswordChanged: NOOP,
      onUserPatch: NOOP,
    })
  );
}
