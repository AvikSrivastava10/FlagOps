import type { ConfigField, DiffFile } from '../../components/diff-data';
import type { ImpactBlock } from '../../components/ImpactSummary';

/** The promotion of dark_mode from Staging to Production (brief 0e, DR-1). */
export const configFields: readonly ConfigField[] = [
  {
    id: 'enabled',
    label: 'Enabled',
    source: { text: 'ON' },
    target: { text: 'ON' },
    changed: false,
  },
  {
    id: 'value',
    label: 'Value',
    source: { text: 'true', mono: true },
    target: { text: 'true', mono: true },
    changed: false,
  },
  {
    id: 'segment-beta_testers',
    label: 'Segment override: beta_testers',
    source: null,
    target: { text: 'priority 0 · ON · true\nrule: email ends with @example.com', mono: true },
    changed: true,
    note: 'only in target, removed by this promotion',
  },
  {
    id: 'identity-overrides',
    label: 'Identity overrides',
    source: { text: '0' },
    target: { text: '3' },
    changed: false,
    note: 'not changed by promotion',
  },
  {
    id: 'dependencies',
    label: 'Dependencies',
    source: { text: 'none' },
    target: { text: 'none' },
    changed: false,
  },
];

const legacyCheckout = [
  "import { useState } from 'react';",
  "import { legacyTotals } from '../pricing/legacyTotals';",
  '',
  'export function LegacyCheckout({ items }: { items: CartItem[] }) {',
  "  const [address, setAddress] = useState('');",
  "  const [card, setCard] = useState('');",
  '  const totals = legacyTotals(items);',
  '  const valid = address.length > 5 && card.length === 16;',
  '  return (',
  '    <form className="legacy-checkout">',
  '      <input value={address} onChange={(e) => setAddress(e.target.value)} />',
  '      <input value={card} onChange={(e) => setCard(e.target.value)} />',
  '      <p>Total: {totals.total.toFixed(2)}</p>',
  '      <button disabled={!valid}>Pay</button>',
  '    </form>',
  '  );',
  '}',
];

/** The new_checkout retirement: one changed file and a deleted file with its lines (BN-2). */
export const codeFiles: readonly DiffFile[] = [
  {
    path: 'web/src/checkout/Checkout.tsx',
    change: 'modified',
    hunks: [
      {
        header: '@@ -1,12 +1,7 @@',
        lines: [
          {
            kind: 'del',
            text: "import { useFlags } from '@flagsmith/flagsmith/react';",
            oldLine: 1,
            newLine: null,
          },
          {
            kind: 'del',
            text: "import { LegacyCheckout } from './LegacyCheckout';",
            oldLine: 2,
            newLine: null,
          },
          {
            kind: 'context',
            text: "import { NewCheckout } from './NewCheckout';",
            oldLine: 3,
            newLine: 1,
          },
          { kind: 'context', text: '', oldLine: 4, newLine: 2 },
          {
            kind: 'context',
            text: 'export function Checkout({ items }: Props) {',
            oldLine: 5,
            newLine: 3,
          },
          {
            kind: 'del',
            text: "  const flags = useFlags(['new_checkout']);",
            oldLine: 6,
            newLine: null,
          },
          { kind: 'del', text: '  if (!flags.new_checkout.enabled) {', oldLine: 7, newLine: null },
          {
            kind: 'del',
            text: '    return <LegacyCheckout items={items} />;',
            oldLine: 8,
            newLine: null,
          },
          { kind: 'del', text: '  }', oldLine: 9, newLine: null },
          {
            kind: 'add',
            text: '  // Checkout always uses the new flow.',
            oldLine: null,
            newLine: 4,
          },
          {
            kind: 'context',
            text: '  return <NewCheckout items={items} />;',
            oldLine: 10,
            newLine: 5,
          },
          { kind: 'context', text: '}', oldLine: 11, newLine: 6 },
        ],
      },
    ],
  },
  {
    path: 'web/src/checkout/LegacyCheckout.tsx',
    change: 'deleted',
    hunks: [
      {
        header: `@@ -1,${legacyCheckout.length} +0,0 @@`,
        lines: legacyCheckout.map((text, index) => ({
          kind: 'del' as const,
          text,
          oldLine: index + 1,
          newLine: null,
        })),
      },
    ],
  },
];

const filter = (kind: string, flag: string) => `#identities?flag=${flag}&change=${kind}`;

function hrefs(flag: string): ImpactBlock['hrefs'] {
  return {
    offToOn: filter('off-to-on', flag),
    onToOff: filter('on-to-off', flag),
    valueChanged: filter('value-changed', flag),
    unchanged: filter('unchanged', flag),
    valueEstimated: filter('value-estimated', flag),
  };
}

/** AT4's numbers: 855 identities turn ON and 145 stay as they are (brief 0e, DR-1). */
export const impactBlocks: readonly ImpactBlock[] = [
  {
    flagName: 'dark_mode',
    role: 'promoted',
    counts: { offToOn: 855, onToOff: 0, valueChanged: 0, unchanged: 145, valueEstimated: 0 },
    hrefs: hrefs('dark_mode'),
  },
  {
    flagName: 'recommendations_v2',
    role: 'dependent',
    counts: { offToOn: 12, onToOff: 3, valueChanged: 40, unchanged: 945, valueEstimated: 1000 },
    hrefs: hrefs('recommendations_v2'),
    approximate: 'a new multivariate split: values are estimated from the variant weights',
  },
];
