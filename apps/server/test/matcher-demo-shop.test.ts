import type { RecordKind } from '@flagops/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDemoShopFiles } from '../src/cli/demo-publish.js';
import { seedFlags } from '../src/cli/seed-data.js';
import { matchRepository, type MatchResult } from '../src/matcher/match-repository.js';

// The matcher on the demo shop that `pnpm demo:publish` pushes, with the seeded flag names: the
// references of architecture.md 13.2 and testing.md section 4 (plan S4.1, offline part).

let result: MatchResult;

beforeAll(async () => {
  const files = (await readDemoShopFiles()).map((file) => ({
    path: file.path,
    text: file.content,
  }));
  result = matchRepository(
    files,
    seedFlags.map((flag) => flag.name),
  );
});

function recordsOf(kind: RecordKind) {
  return result.records.filter((record) => record.kind === kind);
}

function countBy(kind: RecordKind): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of recordsOf(kind)) {
    const key = record.flagName ?? record.literal ?? '';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('the matcher on the demo shop', () => {
  it('parses every file and validates the useFeature accessor of flagops.json', () => {
    expect(result.parseErrors).toEqual([]);
    expect(result.accessorProblems).toEqual([]);
    expect(result.accessorRules).toEqual([
      'via-accessor:hook:web/src/flags/useFeature.ts#useFeature',
    ]);
  });

  it('finds the references of architecture.md 13.2, per flag and file', () => {
    expect(
      recordsOf('reference').map((record) => [record.flagName, record.filePath, record.ruleId]),
    ).toEqual([
      ['admin_reports', 'api/src/routes/admin.ts', 'N1'],
      ['new_checkout', 'api/src/routes/checkout.ts', 'N1'],
      ['order_tracking_v2', 'api/src/routes/orders.ts', 'N1'],
      ['order_tracking_v2', 'api/src/routes/orders.ts', 'N1'],
      ['payments_kill_switch', 'api/src/routes/payments.ts', 'N1'],
      ['recommendations_v2', 'api/src/routes/recommendations.ts', 'N2'],
      ['free_shipping_threshold', 'api/src/routes/shipping.ts', 'N2'],
      ['admin_reports', 'web/src/admin/AdminNav.tsx', 'R1'],
      [
        'holiday_banner',
        'web/src/App.tsx',
        'via-accessor:hook:web/src/flags/useFeature.ts#useFeature',
      ],
      ['free_shipping_threshold', 'web/src/cart/ShippingNote.tsx', 'C2'],
      ['new_checkout', 'web/src/checkout/Checkout.tsx', 'R1'],
      ['recommendations_v2', 'web/src/home/Recommendations.tsx', 'C2'],
      ['dark_mode', 'web/src/settings/Appearance.tsx', 'R2'],
      ['dark_mode', 'web/src/theme/useTheme.ts', 'R1'],
    ]);
    expect(
      recordsOf('reference')
        .filter((record) => !record.traced)
        .map((record) => record.ruleId),
    ).toEqual(['N1', 'N1', 'N1', 'N1', 'N1', 'N2', 'N2']);
  });

  it('reports the zombie recomendations_v2 with its suggestion, and nothing dynamic, unattributed or ambiguous', () => {
    expect(recordsOf('unresolved_name')).toEqual([
      expect.objectContaining({
        literal: 'recomendations_v2',
        filePath: 'web/src/App.tsx',
        ruleId: 'C1',
        suggestion: 'recommendations_v2',
      }),
    ]);
    expect(recordsOf('dynamic')).toEqual([]);
    expect(recordsOf('unattributed')).toEqual([]);
    expect(recordsOf('ambiguous_name')).toEqual([]);
    expect(recordsOf('mention')).toEqual([]);
  });

  it('counts the test mentions and the two test references through the accessor', () => {
    expect(countBy('test_mention')).toEqual({
      admin_reports: 4,
      dark_mode: 1,
      free_shipping_threshold: 3,
      holiday_banner: 2,
      new_checkout: 3,
      order_tracking_v2: 1,
      payments_kill_switch: 2,
      recommendations_v2: 2,
    });
    expect(recordsOf('test_reference').map((record) => [record.flagName, record.filePath])).toEqual(
      [
        ['holiday_banner', 'web/src/flags/useFeature.test.ts'],
        ['holiday_banner', 'web/src/flags/useFeature.test.ts'],
      ],
    );
  });
});
