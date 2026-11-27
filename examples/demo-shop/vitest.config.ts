import { defineConfig } from 'vitest/config';

// Each package has its own test environment: jsdom for the web app, Node for the API.
export default defineConfig({
  test: {
    projects: ['web', 'api'],
  },
});
