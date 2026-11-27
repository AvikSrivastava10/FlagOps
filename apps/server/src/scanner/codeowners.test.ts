import { describe, expect, it } from 'vitest';
import { ownersOf, parseCodeowners } from './codeowners.js';

const demoShop = [
  '* @AvikSrivastava10',
  '/web/src/checkout/ @AvikSrivastava10',
  '/web/src/theme/ @AvikSrivastava10',
  '/api/src/routes/ @AvikSrivastava10',
  '/api/src/pricing/ @AvikSrivastava10',
].join('\n');

describe('CODEOWNERS', () => {
  it('lets the last matching line win, and keeps the line as evidence (DR-3)', () => {
    const codeowners = parseCodeowners('.github/CODEOWNERS', demoShop);

    expect(ownersOf(codeowners, 'web/src/checkout/Checkout.tsx')).toEqual({
      owners: [{ handle: '@AvikSrivastava10', kind: 'user' }],
      line: 2,
      text: '/web/src/checkout/ @AvikSrivastava10',
    });
    expect(ownersOf(codeowners, 'web/src/App.tsx')?.line).toBe(1);
    expect(codeowners.errors).toEqual([]);
  });

  it('reads teams and emails, skips comments, and treats a line without owners as no owner', () => {
    const codeowners = parseCodeowners(
      'CODEOWNERS',
      [
        '# Owners of the shop',
        '',
        '*.ts @acme/platform dev@example.com # inline comment',
        'generated/',
      ].join('\n'),
    );

    expect(ownersOf(codeowners, 'src/a.ts')?.owners).toEqual([
      { handle: '@acme/platform', kind: 'team' },
      { handle: 'dev@example.com', kind: 'email' },
    ]);
    expect(ownersOf(codeowners, 'generated/a.ts')).toEqual({
      owners: [],
      line: 4,
      text: 'generated/',
    });
    expect(ownersOf(codeowners, 'README.md')).toBeUndefined();
  });

  it('reports negation, character ranges and unknown owner tokens, and ignores those lines', () => {
    const codeowners = parseCodeowners(
      'CODEOWNERS',
      ['!docs/ @a', 'src/[ab].ts @a', 'lib/ owner-without-at', 'docs/ @docs-team'].join('\n'),
    );

    expect(codeowners.errors.map((error) => [error.line, error.reason])).toEqual([
      [1, 'negated patterns are not supported in CODEOWNERS'],
      [2, 'character ranges are not supported in CODEOWNERS'],
      [3, 'owner-without-at is not a user, team or email'],
    ]);
    expect(codeowners.lines.map((line) => line.line)).toEqual([4]);
    expect(ownersOf(codeowners, 'docs/readme.ts')?.owners).toEqual([
      { handle: '@docs-team', kind: 'user' },
    ]);
  });
});
