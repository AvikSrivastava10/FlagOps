import { GitHubError } from './errors.js';

/**
 * The rules for downloads such as repository tarballs (architecture.md 7.2 and 19). GitHub answers
 * a tarball request with a redirect to its download host, which FlagOps follows without the token.
 * A download is refused once it is larger than the cap, before or while its body is read.
 */
export const downloadHost = 'codeload.github.com';

export const maxDownloadBytes = 200 * 1024 * 1024;

/**
 * Whether FlagOps follows a redirect: only to the download host over HTTPS, or, when a test passed
 * its own API base URL, to that server's origin. The product has no test origin.
 */
export function isAllowedRedirect(target: URL, testOrigin: string | undefined): boolean {
  return (
    (target.protocol === 'https:' && target.host === downloadHost) || target.origin === testOrigin
  );
}

function tooLarge(request: string, limit: number): GitHubError {
  const megabytes = limit / (1024 * 1024);
  const size = Number.isInteger(megabytes) ? `${megabytes} MB` : `${limit} bytes`;
  return new GitHubError('github_validation', `${request} is larger than ${size}.`, {
    details: { request },
  });
}

/** The body, at most `limit` bytes. A larger body is refused before reading, or as it arrives. */
export async function readCapped(
  response: Response,
  request: string,
  limit = maxDownloadBytes,
): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw tooLarge(request, limit);
  }
  if (response.body === null) {
    return new Uint8Array();
  }
  // Node's fetch types the body as a stream of `any`; its chunks are bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks);
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge(request, limit);
    }
    chunks.push(value);
  }
}
