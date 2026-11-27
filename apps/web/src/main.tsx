import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html has no #root element to mount FlagOps into');
}

createRoot(container).render(
  <StrictMode>
    <main>
      <h1>FlagOps</h1>
      <p>Lifecycle management for the feature flags of a self-hosted Flagsmith.</p>
    </main>
  </StrictMode>,
);
