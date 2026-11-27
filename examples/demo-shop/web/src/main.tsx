import flagsmith from '@flagsmith/flagsmith';
import { FlagsmithProvider } from '@flagsmith/flagsmith/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html needs an element with the id "root"');
}

// The flags load before the first render, so components that read the client directly see
// Flagsmith's values from the start.
try {
  await flagsmith.init({
    environmentID: import.meta.env.VITE_FLAGSMITH_ENVIRONMENT_ID,
    api: import.meta.env.VITE_FLAGSMITH_API_URL ?? 'http://localhost:8000/api/v1/',
  });
} catch (error) {
  console.error('Flagsmith did not send the flags, so the shop starts with every flag off.', error);
}

createRoot(root).render(
  <StrictMode>
    <FlagsmithProvider flagsmith={flagsmith}>
      <App />
    </FlagsmithProvider>
  </StrictMode>,
);
