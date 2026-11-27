import { beforeAll, describe, expect, it } from 'vitest';
import { readDemoShopFiles, type DemoFile } from '../src/cli/demo-publish.js';

// The demo shop that `pnpm demo:publish` pushes must keep the shapes that the scanner, the codemod
// and the acceptance tests expect (architecture.md 13.2, brief DR-3 to DR-6, D-063). It reads the
// demo shop's files as data, and names its SDK packages, so it lives outside apps/server/src,
// where only impact/engine/ may name an @flagsmith/ module (the source rules test).

let files: DemoFile[];
const text = (path: string): string => {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`the demo shop has no ${path}`);
  }
  return file.content;
};
/** The demo shop keeps its tests in `*.test.ts(x)` files and its test helpers under `test/`. */
const isDemoShopTest = (path: string) => /(^|\/)test\/|\.test\.tsx?$/.test(path);
const isCode = (path: string) => /\.[cm]?[jt]sx?$/.test(path);

beforeAll(async () => {
  files = await readDemoShopFiles();
});

describe('the published demo shop', () => {
  it.each([
    ['web/src/checkout/Checkout.tsx', "const { new_checkout } = useFlags(['new_checkout']);"],
    [
      'web/src/checkout/Checkout.tsx',
      'new_checkout.enabled ? <NewCheckout cart={cart} /> : <LegacyCheckout cart={cart} />',
    ],
    ['web/src/checkout/Checkout.tsx', "import { LegacyCheckout } from './LegacyCheckout';"],
    ['api/src/routes/checkout.ts', "if (request.flags.isFeatureEnabled('new_checkout')) {"],
    ['api/src/routes/checkout.ts', "import { legacyTotals } from '../pricing/legacyTotals.ts';"],
    ['api/src/flags.ts', 'request.flags = await flagsmith.getIdentityFlags(user.id, traits);'],
    ['web/src/theme/useTheme.ts', "const { dark_mode } = useFlags(['dark_mode']);"],
    ['web/src/settings/Appearance.tsx', "const flags = useFlags(['dark_mode']);"],
    ['web/src/settings/Appearance.tsx', 'flags.dark_mode.enabled'],
    ['web/src/App.tsx', "const showHolidayBanner = useFeature('holiday_banner');"],
    ['web/src/App.tsx', '{showHolidayBanner && <HolidayBanner />}'],
    ['web/src/App.tsx', "import { HolidayBanner } from './banner/HolidayBanner';"],
    ['web/src/App.tsx', 'const flagsmith = useFlagsmith();'],
    ['web/src/App.tsx', "flagsmith.hasFeature('recomendations_v2')"],
    ['web/src/flags/useFeature.ts', 'const flags = useFlags([name]);'],
    ['api/src/routes/recommendations.ts', "request.flags.getFeatureValue('recommendations_v2')"],
    ['web/src/home/Recommendations.tsx', "flagsmith.getValue('recommendations_v2')"],
    ['api/src/routes/payments.ts', "request.flags.isFeatureEnabled('payments_kill_switch')"],
    ['api/src/routes/admin.ts', "request.flags.isFeatureEnabled('admin_reports')"],
    ['web/src/admin/AdminNav.tsx', "const { admin_reports } = useFlags(['admin_reports']);"],
    ['api/src/routes/shipping.ts', "request.flags.getFeatureValue('free_shipping_threshold')"],
    ['web/src/cart/ShippingNote.tsx', "flagsmith.getValue('free_shipping_threshold')"],
  ])('has the shape of architecture.md 13.2 in %s: %s', (path, shape) => {
    expect(text(path)).toContain(shape);
  });

  it('checks order_tracking_v2 twice in the orders routes', () => {
    const checks = text('api/src/routes/orders.ts').split(
      "request.flags.isFeatureEnabled('order_tracking_v2')",
    );
    expect(checks).toHaveLength(3);
  });

  it.each([
    ['new_checkout', ['api/src/routes/checkout.ts', 'web/src/checkout/Checkout.tsx']],
    ['dark_mode', ['web/src/settings/Appearance.tsx', 'web/src/theme/useTheme.ts']],
    ['holiday_banner', ['web/src/App.tsx']],
    [
      'recommendations_v2',
      ['api/src/routes/recommendations.ts', 'web/src/home/Recommendations.tsx'],
    ],
    ['payments_kill_switch', ['api/src/routes/payments.ts']],
    ['admin_reports', ['api/src/routes/admin.ts', 'web/src/admin/AdminNav.tsx']],
    ['free_shipping_threshold', ['api/src/routes/shipping.ts', 'web/src/cart/ShippingNote.tsx']],
    ['order_tracking_v2', ['api/src/routes/orders.ts']],
  ])('names %s only in the application files that read it', (flag, readers) => {
    const naming = files
      .filter((file) => isCode(file.path) && !isDemoShopTest(file.path))
      .filter((file) => new RegExp(`\\b${flag}\\b`).test(file.content))
      .map((file) => file.path);
    expect(naming).toEqual(readers);
  });

  it('never names gift_wrap or legacy_search, tests included', () => {
    expect(files.filter((file) => /gift_wrap|legacy_search/.test(file.content))).toEqual([]);
  });

  it('sets no tsconfig paths', () => {
    const tsconfigs = files.filter((file) => /(^|\/)[tj]sconfig[^/]*\.json$/.test(file.path));
    expect(tsconfigs.length).toBeGreaterThan(0);
    for (const tsconfig of tsconfigs) {
      const options = (JSON.parse(tsconfig.content) as { compilerOptions?: object })
        .compilerOptions;
      expect(options ?? {}, tsconfig.path).not.toHaveProperty('paths');
    }
  });

  it('names no module the codemod deletes in a stylesheet, HTML, JSON or YAML file', () => {
    const scanned = files.filter(
      (file) =>
        /\.(css|scss|sass|less|html?|json|ya?ml|toml)$/.test(file.path) &&
        !/(^|\/)(package\.json|pnpm-lock\.yaml)$/.test(file.path),
    );
    expect(scanned.length).toBeGreaterThan(0);
    const naming = scanned.filter((file) =>
      /\b(LegacyCheckout|legacyTotals|HolidayBanner)\b/.test(file.content),
    );
    expect(naming.map((file) => file.path)).toEqual([]);
  });

  it.each([
    ['web/src/checkout/LegacyCheckout.test.tsx', './LegacyCheckout'],
    ['web/src/banner/HolidayBanner.test.tsx', './HolidayBanner'],
    ['api/src/pricing/legacyTotals.test.ts', './legacyTotals.ts'],
  ])('lets %s import only its module and packages', (path, module) => {
    const specifiers = [
      ...text(path).matchAll(/(?:from\s+|import\s*\(\s*|mock\s*\(\s*|require\s*\(\s*)'([^']+)'/g),
    ].map((match) => match[1] ?? '');
    expect(specifiers.filter((specifier) => specifier.startsWith('.'))).toEqual([module]);
  });

  it('declares the useFeature hook as its one accessor in flagops.json (D-063)', () => {
    expect(JSON.parse(text('flagops.json'))).toEqual({
      version: 1,
      accessors: [
        {
          kind: 'hook',
          module: 'web/src/flags/useFeature.ts',
          export: 'useFeature',
          reads: 'enabled',
          nameArg: 0,
        },
      ],
    });
  });

  it('has the CODEOWNERS lines of DR-3', () => {
    expect(text('.github/CODEOWNERS')).toBe(
      [
        '* @AvikSrivastava10',
        '/web/src/checkout/ @AvikSrivastava10',
        '/web/src/theme/ @AvikSrivastava10',
        '/api/src/routes/ @AvikSrivastava10',
        '/api/src/pricing/ @AvikSrivastava10',
        '',
      ].join('\n'),
    );
  });

  it('uses the scoped Flagsmith SDKs at the versions of DR-5', () => {
    const dependencies = (path: string) =>
      (JSON.parse(text(path)) as { dependencies: Record<string, string> }).dependencies;
    expect(dependencies('web/package.json')).toMatchObject({ '@flagsmith/flagsmith': '12.6.0' });
    expect(dependencies('api/package.json')).toMatchObject({ '@flagsmith/nodejs': '9.5.0' });
    const manifests = files.filter((file) => file.path.endsWith('package.json'));
    for (const manifest of manifests) {
      expect(manifest.content, manifest.path).not.toMatch(
        /"(flagsmith|flagsmith-nodejs|react-native-flagsmith)"/,
      );
    }
  });

  it('runs one CI job on ubuntu-latest for pushes to main and for pull requests (DR-6)', () => {
    const workflow = text('.github/workflows/ci.yml');
    expect(workflow.match(/runs-on:/g)).toHaveLength(1);
    expect(workflow).toContain('runs-on: ubuntu-latest');
    expect(workflow).toMatch(/push:\s+branches: \[main\]/);
    expect(workflow).toContain('pull_request:');
    expect(workflow).not.toContain('matrix');
    for (const step of ['install --frozen-lockfile', 'typecheck', 'lint', 'test', 'build']) {
      expect(workflow).toContain(`run: pnpm ${step}`);
    }
  });

  it('keeps every file under 150 lines, and LegacyCheckout.tsx at 60 to 120 (DR-4)', () => {
    const lines = (content: string) => content.split('\n').length;
    const long = files.filter(
      (file) => file.path !== 'pnpm-lock.yaml' && lines(file.content) > 150,
    );
    expect(long.map((file) => file.path)).toEqual([]);
    const legacyCheckout = lines(text('web/src/checkout/LegacyCheckout.tsx'));
    expect(legacyCheckout).toBeGreaterThanOrEqual(60);
    expect(legacyCheckout).toBeLessThanOrEqual(120);
  });
});
