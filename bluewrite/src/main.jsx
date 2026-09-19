import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './login-theme.css';
// Last, on purpose: it only carries [data-theme='dark'] rules, which win on
// specificity wherever they are, but keeping it last also makes the sheet's
// part in the cascade plain to read.
import './dark-theme.css';
import './fonts/fonts.css';

createRoot(document.getElementById('root')).render(<App />);
