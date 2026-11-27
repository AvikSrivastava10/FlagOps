// The design system's global layer comes first, before any component's styles.
import '../design';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Gallery } from './Gallery';

const container = document.getElementById('gallery');
if (!container) {
  throw new Error('gallery.html has no #gallery element to mount the gallery into');
}

createRoot(container).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
