import { describe, expect, it } from 'vitest';
import {
  findDescriptionLine,
  formatDescriptionLine,
  withDescriptionLine,
} from './description-line.js';

describe('formatDescriptionLine', () => {
  it('writes the type, the deadline and the cleanup PRs, joined by middle dots', () => {
    expect(
      formatDescriptionLine({
        type: 'release',
        expiresAt: '2026-11-21',
        cleanupPrs: ['https://github.com/o/r/pull/7'],
      }),
    ).toBe('FlagOps: release · remove by 2026-11-21 · https://github.com/o/r/pull/7');
  });

  it('calls ops and permission flags permanent', () => {
    expect(formatDescriptionLine({ type: 'ops', expiresAt: null, cleanupPrs: [] })).toBe(
      'FlagOps: ops · permanent',
    );
  });
});

describe('findDescriptionLine', () => {
  it('finds the last line that starts with "FlagOps: "', () => {
    expect(
      findDescriptionLine('Text\nFlagOps: release · old\nMore\nFlagOps: ops · permanent'),
    ).toBe('FlagOps: ops · permanent');
  });

  it('returns null without such a line', () => {
    expect(findDescriptionLine('Text that mentions FlagOps: inline')).toBeNull();
    expect(findDescriptionLine('')).toBeNull();
  });
});

describe('withDescriptionLine', () => {
  const line = 'FlagOps: release · remove by 2026-12-31';

  it('adds the line at the end, keeping the text above byte for byte', () => {
    const text = 'First line.\n\n  Indented, with trailing spaces   \nLast line.';

    expect(withDescriptionLine(text, line)).toBe(`${text}\n${line}`);
  });

  it('replaces the existing FlagOps line where it is, keeping every other line', () => {
    expect(withDescriptionLine('Above.\nFlagOps: ops · permanent\nBelow.', line)).toBe(
      `Above.\nBelow.\n${line}`,
    );
  });

  it('writes only the line when the description is empty, with no leading newline', () => {
    expect(withDescriptionLine('', line)).toBe(line);
    expect(withDescriptionLine('FlagOps: ops · permanent', line)).toBe(line);
  });

  it('trims the ends of the text, as Flagsmith does when it stores a description', () => {
    expect(withDescriptionLine('\n  Text.  \n\n', line)).toBe(`Text.\n${line}`);
  });
});
