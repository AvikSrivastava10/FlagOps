import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffView, type ConfigField, type DiffFile } from './DiffView';
import { setUpComponentTests } from './test-utils';

const media = setUpComponentTests();

const fields: ConfigField[] = [
  {
    id: 'enabled',
    label: 'Enabled',
    source: { text: 'ON' },
    target: { text: 'ON' },
    changed: false,
  },
  {
    id: 'segment',
    label: 'Segment override: beta_testers',
    source: null,
    target: { text: 'priority 0 · ON', mono: true },
    changed: true,
    note: 'only in target, removed by this promotion',
  },
];

const deletedFile: DiffFile = {
  path: 'web/src/checkout/LegacyCheckout.tsx',
  change: 'deleted',
  hunks: [
    {
      header: '@@ -1,2 +0,0 @@',
      lines: [
        { kind: 'del', text: "import { useState } from 'react';", oldLine: 1, newLine: null },
        { kind: 'del', text: 'export function LegacyCheckout() {}', oldLine: 2, newLine: null },
      ],
    },
  ],
};

const changedFile: DiffFile = {
  path: 'web/src/checkout/Checkout.tsx',
  change: 'modified',
  hunks: [
    {
      header: '@@ -4,2 +4,2 @@',
      lines: [
        { kind: 'del', text: '  if (!flags.new_checkout.enabled) {', oldLine: 4, newLine: null },
        { kind: 'add', text: '  // Checkout always uses the new flow.', oldLine: null, newLine: 4 },
        { kind: 'context', text: '  return <NewCheckout />;', oldLine: 5, newLine: 5 },
      ],
    },
  ],
};

describe('DiffView, configuration mode', () => {
  it('puts fields in rows and the two environments in columns', () => {
    render(
      <DiffView
        mode="config"
        caption="dark_mode"
        sourceName="Staging"
        targetName="Production"
        fields={fields}
      />,
    );
    const table = screen.getByRole('table', { name: 'dark_mode' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Field', 'Staging', 'Production']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
  });

  it('marks changed fields with the text "changed" and keeps their notes', () => {
    render(
      <DiffView
        mode="config"
        caption="dark_mode"
        sourceName="Staging"
        targetName="Production"
        fields={fields}
      />,
    );
    const [unchanged, changed] = screen.getAllByRole('rowheader');
    expect(unchanged?.textContent).not.toContain('changed');
    expect(changed?.textContent).toContain('changed');
    expect(changed?.textContent).toContain('only in target, removed by this promotion');
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByText('priority 0 · ON').tagName).toBe('CODE');
  });

  it('becomes a field list with both values under each field on narrow screens', () => {
    media.setMedia({ narrow: true });
    render(
      <DiffView
        mode="config"
        caption="dark_mode"
        sourceName="Staging"
        targetName="Production"
        fields={fields}
      />,
    );
    expect(screen.queryByRole('table')).toBeNull();
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    expect(terms[1]).toContain('Segment override: beta_testers');
    expect(screen.getAllByText('Production')).toHaveLength(2);
  });
});

describe('DiffView, code mode', () => {
  it('shows a deleted file as its removed lines, not only its name (BN-2)', () => {
    render(<DiffView mode="code" files={[deletedFile]} />);
    const file = screen.getByRole('region', { name: deletedFile.path });
    expect(screen.getByText('Deleted')).toBeTruthy();
    const rows = within(file)
      .getAllByRole('row')
      .filter((row) => row.dataset['kind'] === 'del');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("import { useState } from 'react';");
    expect(rows[0]?.querySelector('td')?.textContent).toBe('1');
    expect(within(rows[0] as HTMLElement).getByText('removed')).toBeTruthy();
    expect(screen.getByText(/0 lines added, 2 lines removed/)).toBeTruthy();
  });

  it('numbers lines and signs additions and removals', () => {
    render(<DiffView mode="code" files={[changedFile]} />);
    const rows = screen.getAllByRole('row').filter((row) => row.dataset['kind'] !== undefined);
    expect(rows.map((row) => row.dataset['kind'])).toEqual(['del', 'add', 'context']);
    const signs = rows.map((row) => row.querySelector('[aria-hidden="true"]')?.textContent);
    expect(signs).toEqual(['\u2212', '+', ' ']);
    const numbers = rows.map((row) =>
      [...row.querySelectorAll('td')].slice(0, 2).map((cell) => cell.textContent),
    );
    expect(numbers).toEqual([
      ['4', ''],
      ['', '4'],
      ['5', '5'],
    ]);
  });

  it('says so when there are no changes', () => {
    render(<DiffView mode="code" files={[]} />);
    expect(screen.getByText('No changes.')).toBeTruthy();
  });
});
