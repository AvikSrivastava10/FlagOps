import { buildServer } from './server.ts';

const app = buildServer({ logger: true });
await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
});
