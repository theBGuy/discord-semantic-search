# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First public release — the complete feature set ships in the initial version.

### Search & retrieval

- **Semantic search** (`/search`) — find indexed messages by meaning, surfacing the best
  matching chunk per message, with optional single-channel or all-servers scope.
- **Hybrid search** — blends semantic and full-text keyword ranking via Reciprocal Rank
  Fusion, tunable with `RRF_K` / `RRF_CAP_MIN`.
- **Result filtering** — narrow by guild, channel/thread, author, or time range, and choose
  how many results to return.
- **Rich results** — each hit shows the channel, author, a relative timestamp, a one-line
  preview, and a clickable jump link to the original message.
- **Configurable embeddings** — choose the embedding model and dimension with optional
  document/query prefixes; embeddings always run locally, decoupled from the chat endpoint.
- **Tunable recall** — `SEARCH_TOP_N`, `RAG_TOP_K`, `KB_TOP_K`, `ANN_OVERSAMPLE`, and
  `HNSW_EF_SEARCH` trade recall against speed. Deleted messages are excluded everywhere.

### AI question answering & generation

- **Grounded Q&A** (`/ask`) — answers drawn strictly from indexed messages, with numbered
  `[n]` citations that deep-link to the source (plus previews); says "I don't know" rather
  than inventing facts.
- **Channel summaries** (`/summarize`) — an overview plus key topics, decisions, and open
  questions for a channel/thread's recent conversation.
- **Topic digest** (`/digest`) — a roundup of the main discussions across the channels you
  can see.
- **Knowledge base** (`/kb`) — synthesize a topic into an FAQ, decision log, or timeline,
  grounded only in real messages and cited.
- **Flexible time windows** — additive `days` + `hours` options (default 24h, capped at one
  year) for summaries and digests.
- **Runtime model control** (`/model`) — view and switch the primary (cloud) and fallback
  (local) chat models with live autocomplete, validated against each endpoint.
- **Cloud-primary, local-fallback generation** — uses a cloud Ollama endpoint when
  configured and automatically falls back to local on a session limit, with a cooldown and
  independently configurable models per endpoint.
- **Citation normalization** — fullwidth/grouped markers (e.g. `【1, 2】`) are rewritten to
  `[1]`, and only the sources actually cited are shown (with a top-N fallback).
- **Context-budgeted prompting** — retrieved context is packed to stay within the model's
  configured window.

### Indexing & ingestion

- **Embed & integration indexing** — embed text (title / description / fields / author /
  footer) is now indexed, and bot/webhook messages that carry embeds or attachments
  (GitHub, RSS, status bots, …) are kept even with `SKIP_BOT_MESSAGES=true`. `/index`
  gained a `reindex:true` option that re-crawls a channel from scratch to backfill them.
- **Resumable historical backfill** (`/index`) — crawls full channel/thread history with
  per-scope checkpoints, so an interrupted or restarted run resumes exactly where it left off.
- **Targeted indexing** — scope a run to up to five specific channels, threads, or whole
  categories instead of the entire server.
- **Concurrent crawling** — configurable backfill and worker concurrency, with a self-guard
  against overlapping runs and live traffic prioritized over backfill.
- **Archived-thread crawling** — indexes archived public threads and forum/media posts, not
  just active channels; unreadable channels are skipped and logged.
- **Offline catch-up** — indexes anything posted while the bot was down, without a full
  re-crawl.
- **Live consistency** — real-time ingestion, edit re-embedding, and delete tombstones
  (single, bulk, and channel/thread deletion) keep results current and remove dead jump links.
- **Idempotent embedding** — content-hash dedup means re-crawls, restarts, and duplicate
  jobs never redundantly re-embed unchanged content.
- **Durable queue** — Postgres-backed pg-boss with retries, exponential backoff, a
  dead-letter queue, and duplicate-job suppression.
- **Re-embed from stored text** (`pnpm reembed`) — switch embedding model/dimension and
  re-embed everything straight from the database, with no Discord re-crawl and no re-OCR;
  the embedding column reprovisions automatically and a startup check verifies the model's
  dimension and warns on corpus drift.

### Attachments & OCR

- **Document extraction** — text from PDF and DOCX attachments is indexed alongside messages.
- **Text & code extraction** — Markdown, JSON, YAML, CSV, and dozens of source-code formats
  are read and indexed; binaries mislabeled as text are safely skipped.
- **Image OCR** — text inside screenshots/images is recognized via a bundled, fully offline
  Tesseract pass (configurable language and minimum-text threshold).
- **Efficient & safe downloads** — only extractable attachments are fetched, under a size
  cap and timeout, with expired CDN URLs skipped and transient failures retried.
- **Overlapping chunking** — long messages and documents are split on natural boundaries
  with overlap so passages spanning a split are still captured.

### Governance & access control

- **Per-server admins** plus environment-defined global operators (`BOOTSTRAP_ADMIN_IDS`)
  who can't be locked out and alone control global settings.
- **Manage-Server bootstrap** so the bot is usable immediately after invite.
- **Access modes** — switch a server between open (everyone) and allowlist (admins plus
  granted roles/users via `/admin allow` / `disallow`).
- **Per-user channel scoping** — search and AI answers only ever surface channels the
  requester can actually read, with thread→parent access inheritance.
- **Per-server rate limiting** — a sliding-window per-user commands/hour cap (admins exempt).
- **Per-server audit log** (`/admin log`) — records governance changes and access denials,
  each with the actor and a timestamp; `/admin show` summarizes current governance.
- **Tiered authorization** — operator / server-admin / user tiers with clear denial
  messages; all replies are ephemeral.

### Operations & reliability

- **Ops dashboard** (`/status`) — indexed counts, backfill progress, queue depth, live
  indexer state, active models, and the newest indexed message time.
- **Process guards** in every service — stray promise rejections are logged without
  crashing, and uncaught exceptions exit cleanly for the supervisor to restart.
- **Request timeouts** on bot→search-API, Ollama, attachment download, and OCR calls so a
  stalled dependency fails cleanly instead of hanging.
- **Resilient worker** — no hard dependency on Ollama; jobs retry through the queue when it
  is briefly unavailable.
- **Best-effort audit writes** that never break the action being recorded.
- **Privacy-conscious logging** — logs stay local and avoid recording query text or message
  content.

### Deployment & configuration

- **One-command stack** — `docker compose up` brings up Postgres + pgvector, optional Ollama
  (with model pre-pull), migrations, the bot, the worker, and the search API.
- **Automatic migrations** run after Postgres is healthy and before the app services start.
- **Flexible Ollama** — local container, remote LAN host, or Ollama Cloud via compose
  profiles; an NVIDIA GPU override is available, and the base stack is CPU-portable.
- **Single shared image** runs all TypeScript services via `tsx` (no build step), with
  Tesseract baked in.
- **Private by default** — the search API publishes no host port and fails closed without an
  access list, the bot is outbound-only, and Postgres binds to localhost. All config is
  environment-driven.

### Project & tooling

- MIT license; Contributing, Code of Conduct, and Security policy; issue and PR templates.
- GitHub Actions CI (typecheck + Biome + tests), a Vitest unit-test suite, `.editorconfig`,
  and `.nvmrc`.
- Brand identity: the **Mimir** logo — a runic "M" (Mannaz) mark in indigo + gold — with
  app icon, favicon, monochrome mark, and wordmark/combination lockups under
  [`assets/logo/`](assets/logo/).
