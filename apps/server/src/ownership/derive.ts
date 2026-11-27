import type { CodeRecord } from '../matcher/records.js';
import { ownersOf, parseCodeowners, type Owner } from '../scanner/codeowners.js';

/**
 * Owner derivation (architecture.md 8.5, step 2): a flag's owners are the union of the
 * CODEOWNERS owners of the files that hold its references, in every tracked repository, each
 * with the line that matched.
 */
export type OwnerEvidence = {
  owner: Owner;
  repository: string;
  file: string;
  /** The CODEOWNERS line that won for the file. */
  rule: { path: string; line: number; text: string };
};

export type RepositoryScan = {
  repository: string;
  codeowners: { path: string; text: string } | null;
  records: readonly CodeRecord[];
};

/** By canonical flag name; a flag whose files have no owner gets an empty list. */
export function deriveOwners(scans: readonly RepositoryScan[]): Map<string, OwnerEvidence[]> {
  const owners = new Map<string, OwnerEvidence[]>();
  for (const scan of scans) {
    const codeowners =
      scan.codeowners === null
        ? undefined
        : parseCodeowners(scan.codeowners.path, scan.codeowners.text);
    for (const record of scan.records) {
      if (record.kind !== 'reference' || record.flagName === null) {
        continue;
      }
      const evidence = owners.get(record.flagName) ?? [];
      owners.set(record.flagName, evidence);
      const match = codeowners === undefined ? undefined : ownersOf(codeowners, record.filePath);
      if (codeowners === undefined || match === undefined) {
        continue;
      }
      for (const owner of match.owners) {
        const known = evidence.some(
          (item) =>
            item.owner.handle === owner.handle &&
            item.repository === scan.repository &&
            item.file === record.filePath,
        );
        if (!known) {
          evidence.push({
            owner,
            repository: scan.repository,
            file: record.filePath,
            rule: { path: codeowners.path, line: match.line, text: match.text },
          });
        }
      }
    }
  }
  return owners;
}
