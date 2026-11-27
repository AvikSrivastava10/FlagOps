/** Hosts that, inside the FlagOps container, name the container itself rather than the machine (D-055). */
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export type FlagsmithUrls = {
  /** Flagsmith as the operator's browser reaches it (`FLAGSMITH_URL`). Dashboard links always use it. */
  dashboardUrl: string;
  /** Where FlagOps sends its own requests. */
  requestUrl: string;
  /** True when `requestUrl` comes from the Docker rewrite, which startup logs once. */
  rewrittenForDocker: boolean;
};

/** Formats a base URL as origin plus path, without a trailing slash, so request paths can be appended. */
export function formatBaseUrl(url: URL): string {
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Decides where FlagOps' own Flagsmith requests go (architecture.md section 2):
 * `FLAGSMITH_INTERNAL_URL` when set; otherwise, inside the image, a loopback `FLAGSMITH_URL` host
 * becomes `host.docker.internal`; otherwise `FLAGSMITH_URL` itself.
 */
export function resolveFlagsmithUrls(input: {
  flagsmithUrl: string;
  internalUrl: string | undefined;
  inDocker: boolean;
}): FlagsmithUrls {
  const dashboardUrl = input.flagsmithUrl;
  if (input.internalUrl !== undefined) {
    return { dashboardUrl, requestUrl: input.internalUrl, rewrittenForDocker: false };
  }
  const url = new URL(dashboardUrl);
  if (input.inDocker && loopbackHosts.has(url.hostname)) {
    url.hostname = 'host.docker.internal';
    return { dashboardUrl, requestUrl: formatBaseUrl(url), rewrittenForDocker: true };
  }
  return { dashboardUrl, requestUrl: dashboardUrl, rewrittenForDocker: false };
}
