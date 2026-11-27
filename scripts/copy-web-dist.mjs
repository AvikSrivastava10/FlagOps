// Copies the built web app into the server's dist folder, so that folder holds everything the
// server needs at run time (architecture.md section 2).
import { cpSync, existsSync, rmSync } from 'node:fs';

const source = new URL('../apps/web/dist/', import.meta.url);
const target = new URL('../apps/server/dist/public/', import.meta.url);

if (!existsSync(new URL('index.html', source))) {
  throw new Error('apps/web/dist/index.html is missing: build the web app first');
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
