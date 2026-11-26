import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, preloadPage } from '@/app/App';
import './index.css';

preloadPage(location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
