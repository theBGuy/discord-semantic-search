# Discord Semantic Search & Knowledge Assistant

Self-hosted, local-first semantic search and RAG over your Discord servers. Indexes
historical + live messages (and text attachments), embeds them locally with **Ollama**,
stores vectors in **Postgres + pgvector**, and answers `/search` and `/ask` slash
commands privately — nothing leaves your host and queries are never public.

## Architecture

```
Discord ──► discord-bot ──► pg-boss queue ──► embedding-worker ──► Ollama (embeddings)
                │                                     │
                │                                     ▼
                │                            Postgres + pgvector
                ▼                                     ▲
        slash commands ──HTTP──► search-api ──────────┘──► Ollama (chat / RAG)
```

| Service | Role |
| --- | --- |
| `discord-bot` | Connects to Discord, ingests live messages, runs resumable historical backfill, handles `/search` `/ask` `/index`. A thin client — all search/RAG logic lives in `search-api`. |
| `embedding-worker` | The only writer of message/embedding/attachment rows. Consumes jobs, chunks text, embeds via Ollama, UPSERTs vectors. |
| `search-api` | Fastify HTTP API (internal-only): semantic + hybrid search and RAG answers with citations. |
| `postgres` | `pgvector/pgvector:pg17` — metadata + vectors. |
| `ollama` | Embeddings + reasoning model (local container, or remote / Ollama Cloud). |

Monorepo: `packages/shared` (`@app/shared`) holds config, DB, queue, Ollama client,
chunking, extraction, repository, and types. Services run via **tsx** (no build step);
`@app/shared` is consumed as source.

## Prerequisites

- Docker + Docker Compose.
- A Discord application/bot. In the [Developer Portal](https://discord.com/developers/applications):
  enable the **Message Content Intent** (Bot → Privileged Gateway Intents). Under 10,000
  users no review is required.
- Invite the bot with the **`bot`** + **`applications.commands`** scopes and the
  **View Channels** + **Read Message History** permissions (integer `66560`) — that's all
  it needs; ephemeral slash replies don't require *Send Messages*:
  ```
  https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=66560&scope=bot%20applications.commands
  ```
  (Private archived threads also need *Manage Threads* or bot membership. `/index` is
  gated to members with *Manage Server*.)
- For local Ollama: ideally an NVIDIA GPU (8–12 GB) for `qwen2.5:7b`. CPU works but is slower.

## Quick start

```bash
cp .env.example .env       # fill DISCORD_TOKEN, DISCORD_CLIENT_ID, set a POSTGRES_PASSWORD
```

**Local Ollama (GPU):**
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile local-ollama up -d
```

**Local Ollama (CPU only):**
```bash
docker compose --profile local-ollama up -d
```

**Remote Ollama on your LAN** (e.g. a Mac running Ollama): set
`OLLAMA_BASE_URL=http://192.168.x.x:11434` (the host's IP — not `localhost`/`host.docker.internal`),
leave `OLLAMA_API_KEY` blank, then `docker compose up -d`. The remote box must bind
`OLLAMA_HOST=0.0.0.0` and have the models pre-pulled (`ollama pull nomic-embed-text qwen2.5:7b`) —
the bundled model-puller only runs with `--profile local-ollama`.

**Ollama Cloud** (no local model container): set `OLLAMA_BASE_URL=https://ollama.com` and
`OLLAMA_API_KEY=...`, then `docker compose up -d`.

With `--profile local-ollama`, first start pulls models (~5 GB for `qwen2.5:7b` + `nomic-embed-text`)
— watch progress with `docker compose logs -f ollama-init`. With a remote/cloud endpoint, models
must already exist there. Either way the worker/search-api tolerate Ollama not being ready yet
(jobs retry; `/health` reports degraded) and recover automatically.

### Register slash commands

```bash
# inside the running bot container (global registration; ~1h to propagate):
docker compose exec discord-bot pnpm deploy-commands
# or set DISCORD_DEV_GUILD_ID in .env first for instant per-guild registration.
```

### Use it

- `/search query:<text> [mode:semantic|hybrid] [channel:#x] [all_servers:true]`
- `/ask question:<text> [all_servers:true]`
- `/index [channel]` — start/resume backfill of everything, or just one channel/category (*Manage Server*; resumable, crawls scopes concurrently).
- `/status` — indexed counts, queue depth, backfill progress, models (*Manage Server*).
- `/model [set]` — view or switch the active chat/reasoning model (*Manage Server*).
- `/summarize [channel] [days] [hours]` — summarize a channel/thread's recent conversation.
- `/digest [days] [hours]` — topic digest of recent activity across the channels you can see.
- `/kb topic:<x> [kind:faq|decisions|timeline]` — synthesize a knowledge-base entry from history.
- `/admin …` — governance: admins, access, rate limit, audit log (admin-only; see below).

### Governance (per server)

Two admin tiers:
- **Operator** — Discord user IDs in `BOOTSTRAP_ADMIN_IDS`. Admin in **every** server,
  can't be locked out, and the only one who can run **`/model`** (the chat model is global).
- **Server admins** — added per guild with `/admin add @user` (removed with `/admin remove`).
  They manage that server's governance and run `/index` (scoped to that server) + `/status`.

Before a server has its own admin, anyone with Discord *Manage Server* there can run admin
commands to bootstrap. Each server has its **own** access policy, allowlist, and rate limit.

User commands (`/search` `/ask` `/summarize` `/digest` `/kb`) obey that server's policy —
**allowlist by default** (only admins + allowed roles/users):

- `/admin access mode:open` — let everyone in this server use them.
- `/admin allow role:@members` / `/admin allow user:@x` — grant access (this server).
- `/admin disallow …` — revoke.
- `/admin ratelimit per_hour:<n>` — per-user cap for this server (0 = off; admins exempt; default `RATE_LIMIT_PER_HOUR`).
- `/admin show` — view this server's governance.
- `/admin log [limit]` — audit trail of governance changes and access denials in this server.

`/search` and `/ask` are scoped to the server they're invoked in **and to the channels the
asker can read** (results never include channels the user can't see; public threads inherit
parent access). All replies are ephemeral (only you see them).

### Operations notes

- **Live consistency:** edits re-embed; single, bulk, and channel/thread deletions tombstone
  the affected messages so they drop out of search.
- **Model drift:** the worker asserts the embedding dimension at startup and warns if the
  corpus already contains vectors from a different model/dim (re-embed after a model change).
- **Backpressure:** backfill only *enqueues*; the worker embeds asynchronously. Watch progress
  with `/status` (a large `pending` that's shrinking just means it's catching up) or
  `docker compose logs -f embedding-worker`.

## Configuration

All config is environment-driven; see [.env.example](.env.example). Key variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | **Embeddings always run here** (kept local). Local container, LAN host, or cloud. |
| `OLLAMA_API_KEY` | — | Bearer key for `OLLAMA_BASE_URL`. |
| `OLLAMA_CLOUD_URL` / `OLLAMA_CLOUD_API_KEY` | — | If set, **chat/RAG uses cloud first** and falls back to `OLLAMA_BASE_URL` on a session limit (429). |
| `EMBED_MODEL` / `EMBED_DIM` | `qwen3-embedding:0.6b` / `1024` | **`EMBED_DIM` must match the model.** Column auto-sized on first migrate; use `pnpm reembed` to change after indexing. |
| `CHAT_MODEL` | `qwen2.5:7b` | Default chat model; the **active** one is set at runtime via `/model`. |
| `BACKFILL_CONCURRENCY` | `3` | Channels/threads crawled in parallel during backfill. |
| `SKIP_BOT_MESSAGES` | `true` | Skip bot/webhook authors when indexing. |
| `BACKFILL_ON_START` | `false` | Auto-run backfill on bot startup (otherwise use `/index`). |

### Switching the embedding model

Embeddings run locally on `OLLAMA_BASE_URL`. To change `EMBED_MODEL` to a different
dimension after you've indexed data, re-embed from the text already stored in Postgres
(no Discord re-crawl, no re-OCR):

```bash
docker compose stop discord-bot embedding-worker search-api   # quiesce writers
# edit .env: EMBED_MODEL, EMBED_DIM (+ prefixes), then make sure the new model is pulled locally
docker compose run --rm --no-deps embedding-worker pnpm reembed   # reprovision column + re-embed
docker compose up -d
```

`reembed` drops the ANN index, sets the vector column to `EMBED_DIM`, re-embeds every
stored message/attachment, and rebuilds the index. (HNSW supports ≤ 2000 dims, so
`qwen3-embedding` must be the `:0.6b`/1024 tag.) The full-text language is hardcoded
`english` in the migration; for multilingual servers switch it (and `FTS_LANG`) to `simple`.

### Chat model & cloud/local

Chat/RAG (`/ask`, `/summarize`, `/digest`, `/kb`) uses `OLLAMA_CLOUD_URL` as primary when
set and falls back to your local `OLLAMA_BASE_URL` on a session limit (429), staying local
for `OLLAMA_CLOUD_COOLDOWN_MS` before trying the cloud again. The **primary (cloud)** and
**fallback (local)** chat models are independent — run a big model in the cloud and a
smaller one locally. Set them live from Discord:

- `/model` — show current primary + fallback and the models available on each endpoint.
- `/model set:<name>` — set the primary (cloud) model.
- `/model set:<name> scope:fallback` — set the fallback (local) model.

Both are persisted in the DB; `CHAT_MODEL` / `CHAT_MODEL_LOCAL` are the env defaults.

## Development

```bash
pnpm install
pnpm typecheck        # tsc --noEmit across the workspace
pnpm check            # biome format + lint (write)
pnpm test             # vitest unit tests
pnpm migrate          # run DB migrations (needs a reachable Postgres)
pnpm dev:bot | dev:worker | dev:api
```

## Data model

`messages`, `embeddings` (chunk-level, polymorphic source: message or attachment),
`channels`, `attachments`, `indexing_state` (per-channel/thread crawl checkpoints).
See [db/migrations](db/migrations/). Snowflake IDs are `BIGINT` stored/handled as strings.

## Privacy

- `search-api` publishes **no host port** — reachable only on the internal compose network.
- Slash replies are **ephemeral**.
- Secrets (`DISCORD_TOKEN`, DB creds, `OLLAMA_API_KEY`) live in `.env` (git-ignored).
- Logs stay local and avoid recording full query/result bodies.

## Roadmap

Phases 1 (search/RAG), 2 (attachment text), 3 (**OCR** — text from image attachments via
bundled Tesseract), and 4 (**AI features** — `/summarize`, `/digest`, `/kb`) are
implemented, along with per-user access filtering and the `/status` ops view. The
AI-feature commands respect the asker's channel access just like search. Deferred: the
web dashboard. Everything extends the same chunk → embed → UPSERT pipeline and the
polymorphic `embeddings` table.

OCR runs in `embedding-worker` on image attachments (PNG/JPG/WebP/GIF/BMP/TIFF), gated by
`OCR_ENABLED`. It's CPU-bound (~1–3s/image), so a screenshot-heavy backfill takes time —
track it with `/status`. The English model is baked into the image; add
`tesseract-ocr-<lang>` packages and set `OCR_LANG` for other languages.

## Releases

Releases follow [Semantic Versioning](https://semver.org) and are published as GitHub
Releases (with notes from the [CHANGELOG](CHANGELOG.md)) plus multi-arch container images
on the GitHub Container Registry at `ghcr.io/thebguy/discord-semantic-search`.

To run a published release instead of building from source, set `APP_VERSION` in `.env`
(e.g. `APP_VERSION=v0.1.0`) and pull the prebuilt image:

```bash
docker compose pull
docker compose up -d
```

Maintainers: see [RELEASING.md](RELEASING.md) for how to cut a release.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, project
layout, and conventions, and our [Code of Conduct](CODE_OF_CONDUCT.md). To report a
security vulnerability, follow [SECURITY.md](SECURITY.md) (please don't open a public issue).

## License

[MIT](LICENSE) © theBGuy
