# Demo Shop

A small shop that reads its feature flags from Flagsmith: a React storefront in `web/` and a Fastify API in `api/`. It is the sample application for [FlagOps](https://github.com/AvikSrivastava10/FlagOps), which scans this repository, writes its findings into Flagsmith, and opens pull requests here that remove retired flags.

## Flags

| Flag | Read in | How |
|---|---|---|
| `new_checkout` | `web/src/checkout/Checkout.tsx`, `api/src/routes/checkout.ts` | `useFlags`; `request.flags.isFeatureEnabled` |
| `dark_mode` | `web/src/theme/useTheme.ts`, `web/src/settings/Appearance.tsx` | `useFlags` |
| `holiday_banner` | `web/src/App.tsx` | the app's own `useFeature` hook, declared in `flagops.json` |
| `recommendations_v2` | `web/src/home/Recommendations.tsx`, `api/src/routes/recommendations.ts` | `flagsmith.getValue`; `request.flags.getFeatureValue` |
| `payments_kill_switch` | `api/src/routes/payments.ts` | `request.flags.isFeatureEnabled` |
| `admin_reports` | `web/src/admin/AdminNav.tsx`, `api/src/routes/admin.ts` | `useFlags`; `request.flags.isFeatureEnabled` |
| `free_shipping_threshold` | `web/src/cart/ShippingNote.tsx`, `api/src/routes/shipping.ts` | `flagsmith.getValue`; `request.flags.getFeatureValue` |
| `order_tracking_v2` | `api/src/routes/orders.ts` | `request.flags.isFeatureEnabled`, twice |

When FlagOps retires a flag, its pull request changes only code, so this table keeps listing the flag until the shop is reset.

`web/src/App.tsx` also checks `recomendations_v2`, a misspelling of `recommendations_v2`. Flagsmith has no flag with that name, so the check is always false and the recommendations never show. The typo is deliberate: FlagOps reports it as a zombie reference.

`flagops.json` tells FlagOps that `useFeature(name)` in `web/src/flags/useFeature.ts` returns whether the named flag is on, so FlagOps finds and removes the checks made through it as well.

## Run it

Requires Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm dev
```

Set these first, in `web/.env.local` and `api/.env`:

| Variable | Used by | Value |
|---|---|---|
| `VITE_FLAGSMITH_ENVIRONMENT_ID` | web | the environment's client-side key |
| `VITE_FLAGSMITH_API_URL` | web | the Flagsmith API, default `http://localhost:8000/api/v1/` |
| `FLAGSMITH_ENVIRONMENT_KEY` | api | the environment's server-side key |
| `FLAGSMITH_API_URL` | api | the Flagsmith API, default `http://localhost:8000/api/v1/` |

The API evaluates flags remotely: each request asks Flagsmith for the user's flags, so a change in Flagsmith applies to the next request. The user comes from the `x-user-id`, `x-user-role` and `x-user-plan` headers, which the shop's sign-in gateway would set; without them, the request is an anonymous customer on the free plan.

The API asks Flagsmith transiently, so running it never creates or changes identities. An existing identity is evaluated with its overrides and stored traits, the request's `role` and `plan` count for that evaluation only, and anonymous or unknown users are evaluated without being stored.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The tests replace the Flagsmith SDKs with stand-ins (`web/test/flagsmith.ts`, `api/test/flagsmith.ts`), so they need no Flagsmith. CI runs the same four checks on every pull request and on every push to `main`.

Two rules keep the pull requests that remove a flag green:

- Code that only a retiring branch uses lives in its own module, with its test next to it, so the pull request that deletes the module deletes the test too.
- Tests of modules that stay assert only the behaviour that Production serves today.
