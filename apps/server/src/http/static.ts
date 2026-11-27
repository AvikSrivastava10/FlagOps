import fastifyStatic from '@fastify/static';
import type { App } from './app.js';
import { errorBody } from './errors.js';
import { isApiPath, pathOf } from './request-path.js';

/**
 * Serves the built web app from `webRoot`, with index.html for every other GET outside `/api`, so
 * the app's own routes work on reload. Unknown API routes, and everything when there is no built
 * web app, get the JSON `not_found` error.
 */
export async function registerWebApp(app: App, webRoot: string | undefined): Promise<void> {
  if (webRoot !== undefined) {
    await app.register(fastifyStatic, { root: webRoot });
  }
  app.setNotFoundHandler(async (request, reply) => {
    const path = pathOf(request.url);
    if (isApiPath(path)) {
      return reply
        .status(404)
        .send(errorBody('not_found', `No API route matches ${request.method} ${path}`));
    }
    if (webRoot !== undefined && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.sendFile('index.html');
    }
    return reply
      .status(404)
      .send(errorBody('not_found', `Nothing is served at ${request.method} ${path}`));
  });
}
