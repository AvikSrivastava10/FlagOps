# FlagOps

FlagOps runs next to a self-hosted Flagsmith and manages the lifecycle of its feature flags. For every flag in a Flagsmith project it shows where the flag is in its life, with the evidence for that stage. It promotes a flag's configuration from one environment to the next with a preview of the identities it affects. And it retires a finished flag from the code with a deterministic codemod and a pull request, then archives the flag in Flagsmith.

FlagOps is one application: a server and a web dashboard in one process, configured by one env file. It works against unmodified, open-source Flagsmith.

## Status

FlagOps is built in stages, and this README describes what exists today. This version contains the foundation:

- the pnpm workspace with type checking, linting, formatting, tests and CI;
- the server: configuration checks at startup, the `GET /api/health` endpoint, a host check against DNS rebinding, security headers, JSON error responses and SQLite migrations;
- the web app shell, served by the server.

The lifecycle features described above are added in the next stages, and this README grows with them.

## Requirements

- Node.js 22.12 or later.
- pnpm 10. With `corepack enable`, the pnpm version pinned in `package.json` is used.
- A running Flagsmith instance, and an organisation API key of the Flagsmith organisation FlagOps will manage.

## Set up and run

1. Install the dependencies:

   ```sh
   pnpm install
   ```

2. Copy `.env.example` to `.env` and set the two required variables:
   - `FLAGSMITH_URL`: Flagsmith as your browser reaches it, for example `http://localhost:8000`.
   - `FLAGSMITH_ORG_API_KEY`: the organisation API key. On open-source Flagsmith this key is a full organisation admin key. FlagOps keeps it on the server and never sends it to the browser.

   `.env.example` documents every other variable; the optional ones are commented out.

3. Build and start:

   ```sh
   pnpm build
   pnpm start
   ```

4. Open http://localhost:3000. `GET http://localhost:3000/api/health` answers `{"status":"ok"}`.

FlagOps keeps its own state in a SQLite database in `./data`. Set `FLAGOPS_DATA_DIR` to use another directory.

If a required variable is missing or invalid, FlagOps exits with code 1 and logs one line per problem, naming the variable, for example `FLAGSMITH_URL is required (URL of your Flagsmith API)`.

## Development

| Command                          | What it does                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                       | Runs the server on port 3000, restarting on changes, and the web app on http://localhost:5173 with hot reload. |
| `pnpm typecheck`                 | Type-checks every package with strict TypeScript.                                                              |
| `pnpm lint`, `pnpm format:check` | ESLint, including the module boundaries, and Prettier.                                                         |
| `pnpm test`                      | Unit and HTTP tests. They need no network.                                                                     |
| `pnpm build`                     | Builds the shared package, the web app and the server into `apps/server/dist`.                                 |
| `pnpm openapi:generate`          | Regenerates the Flagsmith API types from the pinned OpenAPI schema of Flagsmith 2.295.2.                       |

## License

MIT. See [LICENSE](LICENSE).
