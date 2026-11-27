// tsc emits only JavaScript, so the build copies the SQL migrations next to the compiled runner.
import { cpSync } from 'node:fs';

cpSync(
  new URL('../src/db/migrations/', import.meta.url),
  new URL('../dist/db/migrations/', import.meta.url),
  {
    recursive: true,
  },
);
