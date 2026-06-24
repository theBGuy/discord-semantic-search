# Contributing

Thanks for your interest in improving the Discord Semantic Search & Knowledge Assistant!
This is a self-hosted, local-first project — contributions of all sizes are welcome.

By contributing you agree that your contributions are licensed under the project's
[MIT License](LICENSE).

## Ground rules

- Be respectful — this project follows a [Code of Conduct](CODE_OF_CONDUCT.md).
- Found a **security** issue? Do **not** open a public issue — see [SECURITY.md](SECURITY.md).
- For anything non-trivial, open an issue (or a Discussion) first so we can agree on the
  approach before you invest time.

## Development setup

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 22.12 (see [.nvmrc](.nvmrc)),
[pnpm](https://pnpm.io) 10, and Docker (for Postgres + Ollama).

```bash
pnpm install
cp .env.example .env        # fill in DISCORD_TOKEN / DISCORD_CLIENT_ID for a live run
```

You don't need a live Discord bot to work on most of the code. To exercise anything that
touches the database, run a throwaway Postgres with the pgvector extension:

```bash
docker run -d --name dss-pg --rm \
  -e POSTGRES_USER=discord -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=discord_search \
  -p 5433:5432 pgvector/pgvector:pg17
export DATABASE_URL=postgres://discord:postgres@localhost:5433/discord_search
pnpm migrate
# ... and `docker rm -f dss-pg` when you're done.
```

The full stack runs via `docker compose` — see the [README](README.md#quick-start).

## Project layout

A pnpm-workspaces monorepo. **There is no build step** — services run directly from
TypeScript source via `tsx`, and `@app/shared` is consumed as source (extensionless
relative imports, `moduleResolution: "Bundler"`).

| Path | What |
| --- | --- |
| `packages/shared` (`@app/shared`) | Config, DB pool + migrations, queue, Ollama client, chunking, extraction, repository, governance, audit, types. |
| `services/discord-bot` | Discord gateway client, ingest, backfill, slash-command handlers. A thin client. |
| `services/embedding-worker` | The only writer of message/embedding/attachment rows. |
| `services/search-api` | Internal-only Fastify API: semantic/hybrid search + RAG. |
| `db/migrations` | Ordered, idempotent SQL migrations. |

See the [Architecture](README.md#architecture) section for the data flow.

## Before you push

CI runs these on every PR; run them locally first so the build stays green:

```bash
pnpm typecheck     # tsc --noEmit across the workspace (strict)
pnpm check         # Biome format + lint (auto-fixes); use `pnpm check:ci` to verify without writing
```

Coding conventions:

- **Style is enforced by [Biome](https://biomejs.dev)** — double quotes, semicolons,
  2-space indent, 100-column width. Run `pnpm check` before committing.
- **Strict TypeScript.** `strict` + `noUncheckedIndexedAccess` are on; avoid `any`,
  `as`, and non-null `!` assertions — narrow types instead. The existing code has almost
  none; please keep it that way.
- **Never write a literal NUL byte into a source file** — it makes the file be treated as
  binary by git/editors. (If you need to detect one in code, test the raw bytes, e.g.
  `buffer.includes(0)`.)
- **Migrations are append-only and idempotent** — add a new numbered file in
  `db/migrations/`; never edit an already-released one. Use `IF NOT EXISTS` guards.
- **All SQL must be parameterized** (`$1`, `$2`, …). Never interpolate user input into a
  query string.
- **Don't log secrets or message content** at `info` level — logs stay local and
  privacy-aware.

## Database changes

When you add a migration, verify it applies cleanly on a fresh database (the pgvector
container above + `pnpm migrate`) and that re-running `pnpm migrate` is a no-op.

## Commit & PR conventions

- Branch off `master`; keep PRs focused.
- We use [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, …) for commit and PR titles.
- Fill out the pull-request template, including how you tested the change.
- Update the [README](README.md) and [CHANGELOG](CHANGELOG.md) when behavior or config changes.

## Releases

Maintainers cut releases by tagging `vX.Y.Z`; a workflow then publishes the GitHub Release
and the container image. See [RELEASING.md](RELEASING.md) for the full process.

Thanks again — happy hacking!
