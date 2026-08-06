import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from '@/renderer/App';
import { createBrowserPreviewApi } from '@/renderer/browser-preview';

const previewRequested = new URLSearchParams(window.location.search).get('preview') === 'chat';
if (import.meta.env.DEV && previewRequested && !(window as Partial<Window>).herdr) {
  window.herdr = createBrowserPreviewApi();
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
