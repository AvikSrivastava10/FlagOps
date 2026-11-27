import { describe, expect, it } from 'vitest';
import { tarEntries } from '../../test/helpers/tarball.js';
import { readArchive } from './archive.js';
import { isSelected, safeRelativePath } from './files.js';

const root = 'acme-shop-0123456/';

describe('file selection', () => {
  it('selects code files, package.json files and the root configuration files', () => {
    expect(
      [
        'src/App.tsx',
        'api/server.mjs',
        'web/package.json',
        'tsconfig.json',
        'flagops.json',
        '.github/CODEOWNERS',
        'src/types.d.ts',
        'public/vendor.min.js',
        'node_modules/flagsmith/index.js',
        'web/dist/main.js',
        'README.md',
        'web/tsconfig.json',
      ].filter(isSelected),
    ).toEqual([
      'src/App.tsx',
      'api/server.mjs',
      'web/package.json',
      'tsconfig.json',
      'flagops.json',
      '.github/CODEOWNERS',
    ]);
  });

  it('strips the top-level folder and refuses paths that leave the repository', () => {
    expect(safeRelativePath(`${root}src/App.tsx`)).toBe('src/App.tsx');
    expect(safeRelativePath(`${root}src/../../etc/passwd`)).toBeUndefined();
    expect(safeRelativePath('/etc/passwd')).toBeUndefined();
    expect(safeRelativePath('C:/Windows/win.ini')).toBeUndefined();
    expect(safeRelativePath(root)).toBeUndefined();
  });
});

describe('readArchive', () => {
  it('keeps the selected files as text, and reports unsafe paths, links, large and binary files', async () => {
    const archive = tarEntries([
      { path: root, directory: true },
      { path: `${root}src/App.tsx`, text: 'export const App = () => null;\n' },
      { path: `${root}README.md`, text: '# Shop\n' },
      { path: `${root}src/../../escape.ts`, text: 'export {};\n' },
      { path: `${root}src/link.ts`, link: '/etc/passwd' },
      { path: `${root}src/big.ts`, text: `export const big = '${'x'.repeat(1024 * 1024)}';\n` },
    ]);

    const contents = await readArchive(archive);

    expect(contents.files).toEqual([
      { path: 'src/App.tsx', text: 'export const App = () => null;\n' },
    ]);
    expect(contents.skipped).toEqual([
      { path: `${root}src/../../escape.ts`, reason: 'its path leaves the repository' },
      { path: 'src/big.ts', reason: 'larger than 1 MB' },
      { path: 'src/link.ts', reason: 'a link, which the scanner does not follow' },
    ]);
  });

  it('rejects data that is not a tarball', async () => {
    await expect(readArchive(new TextEncoder().encode('<!doctype html>'))).rejects.toThrow();
  });
});
