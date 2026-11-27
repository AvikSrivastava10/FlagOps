/** The path of a request URL without its query string, which may carry search terms (architecture.md 18.3). */
export function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}
