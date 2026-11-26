import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Mobile browsers only allow audio after a user gesture; warm the audio context
// on the very first interaction so lock-screen and boot SFX behave.
const warm = () => {
  try {
    const Ctor = window.AudioContext;
    if (Ctor) new Ctor();
  } catch {
    /* ignore */
  }
  window.removeEventListener('pointerdown', warm);
};
window.addEventListener('pointerdown', warm, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
