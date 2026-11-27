import { z } from 'zod';
import { parseResponse, type FlagsmithClient } from './client.js';
import { authHeaders, type FlagsmithCredential } from './credentials.js';
import { unexpectedResponse } from './errors.js';
import { listFeatures } from './features.js';

/**
 * Flagsmith's Code References (architecture.md 6.3, 8.5): FlagOps uploads each scan of a
 * repository, and Flagsmith's Usage tab shows it. Flagsmith matches names exactly and drops
 * unknown ones, so every reference carries the canonical flag name.
 */
export type CodeReferenceUpload = {
  /** `https://github.com/{owner}/{name}`. */
  repositoryUrl: string;
  revision: string;
  references: readonly { featureName: string; filePath: string; lineNumber: number }[];
};

const scanSchema = z.object({ repository_url: z.string(), revision: z.string() });

/** How many references each flag has in the repository, as uploaded. */
function countsByFlag(upload: CodeReferenceUpload): Map<string, number> {
  const counts = new Map<string, number>();
  for (const reference of upload.references) {
    counts.set(reference.featureName, (counts.get(reference.featureName) ?? 0) + 1);
  }
  return counts;
}

/**
 * Uploads one scan, then reads the feature list back: each flag's count for the repository must
 * equal what was uploaded, 0 for flags without references (6.6). The upload replaces the
 * repository's previous scan, so an empty list is uploaded too.
 */
export async function uploadCodeReferences(
  client: FlagsmithClient,
  credential: FlagsmithCredential,
  projectId: number,
  upload: CodeReferenceUpload,
): Promise<void> {
  client.writeGuard.checkProject(projectId);
  const path = '/api/v1/projects/{project_pk}/code-references/';
  const { data } = await client.api.POST(path, {
    params: { path: { project_pk: projectId } },
    body: {
      repository_url: upload.repositoryUrl,
      vcs_provider: 'github',
      revision: upload.revision,
      code_references: upload.references.map((reference) => ({
        feature_name: reference.featureName,
        file_path: reference.filePath,
        line_number: reference.lineNumber,
      })),
    },
    headers: authHeaders(credential),
  });
  parseResponse(client, scanSchema, data, { method: 'POST', path });

  const expected = countsByFlag(upload);
  const features = await listFeatures(client, credential, projectId, undefined);
  const mismatched = features.filter((feature) => {
    const stored = feature.code_references_counts.find(
      (count) => count.repository_url === upload.repositoryUrl,
    );
    return (stored?.count ?? 0) !== (expected.get(feature.name) ?? 0);
  });
  if (mismatched.length > 0) {
    throw unexpectedResponse(
      { method: 'POST', path },
      `code reference counts that differ from the upload for ${mismatched.map((feature) => feature.name).join(', ')}`,
      client.observedVersion(),
    );
  }
}
