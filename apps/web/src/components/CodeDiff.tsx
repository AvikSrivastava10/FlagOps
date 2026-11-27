import { useId } from 'react';
import type { CodeDiffProps, DiffFile, DiffLine } from './diff-data';
import styles from './CodeDiff.module.css';

const changeLabels: Readonly<Record<DiffFile['change'], string>> = {
  modified: 'Changed',
  added: 'Added',
  deleted: 'Deleted',
};

const signs: Readonly<Record<DiffLine['kind'], { sign: string; label: string }>> = {
  add: { sign: '+', label: 'added' },
  del: { sign: '\u2212', label: 'removed' },
  context: { sign: ' ', label: 'unchanged' },
};

function counts(file: DiffFile): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') added++;
      if (line.kind === 'del') removed++;
    }
  }
  return { added, removed };
}

/**
 * The unified code diff (ui-design.md 5): mono, line numbers, add and delete backgrounds, plus
 * and minus signs. Each file scrolls horizontally inside its own block (ui-design.md 6.8).
 */
export function CodeDiff({ files }: Omit<CodeDiffProps, 'mode'>) {
  if (files.length === 0) return <p className={styles.empty}>No changes.</p>;
  return (
    <div className={styles.files}>
      {files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}
    </div>
  );
}

function FileDiff({ file }: { file: DiffFile }) {
  const titleId = useId();
  const { added, removed } = counts(file);
  return (
    <section className={styles.file} data-change={file.change}>
      <header className={styles.header}>
        <h4 id={titleId} className={styles.path}>
          {file.path}
        </h4>
        <span className={styles.change}>{changeLabels[file.change]}</span>
        <span className={styles.counts}>
          <span>+{added}</span>{' '}
          <span>
            {'\u2212'}
            {removed}
          </span>
          <span className="visually-hidden">
            : {added} lines added, {removed} lines removed
          </span>
        </span>
      </header>
      {file.hunks.length === 0 ? (
        <p className={styles.empty}>No text lines to show.</p>
      ) : (
        <div className={styles.scroller} role="region" aria-labelledby={titleId} tabIndex={0}>
          <table className={styles.table}>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Old line</th>
                <th scope="col">New line</th>
                <th scope="col">Change</th>
                <th scope="col">Code</th>
              </tr>
            </thead>
            {file.hunks.map((hunk, index) => (
              <tbody key={index}>
                <tr className={styles.hunk}>
                  <td colSpan={4}>{hunk.header}</td>
                </tr>
                {hunk.lines.map((line, lineIndex) => (
                  <tr key={lineIndex} className={styles[line.kind]} data-kind={line.kind}>
                    <td className={styles.number}>{line.oldLine ?? ''}</td>
                    <td className={styles.number}>{line.newLine ?? ''}</td>
                    <td className={styles.sign}>
                      <span aria-hidden="true">{signs[line.kind].sign}</span>
                      <span className="visually-hidden">{signs[line.kind].label}</span>
                    </td>
                    <td className={styles.code}>
                      <code>{line.text}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
