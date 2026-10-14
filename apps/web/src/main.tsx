import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito-sans/wght.css';
import { App } from './App';
import { registerPwaUpdates } from './pwaUpdates';
import './index.css';

registerPwaUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
