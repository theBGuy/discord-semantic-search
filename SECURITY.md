# Security Policy

## Supported versions

This project is pre-1.0 and self-hosted. Security fixes are applied to the latest
`master`. If you run an older checkout, update before reporting.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions,
or pull requests.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (or open [`/security/advisories/new`](../../security/advisories/new)).
2. Describe the issue with enough detail to reproduce it.

If you can, please include:

- The affected component (`discord-bot`, `embedding-worker`, `search-api`, or `@app/shared`)
  and the commit you're on.
- Steps to reproduce, and the impact (what an attacker could read, change, or break).
- Any logs or proof-of-concept — with secrets redacted.

You'll get an acknowledgement as soon as possible (this is a small, best-effort project).
We'll work with you on a fix and coordinate disclosure; we're happy to credit you unless
you'd prefer to stay anonymous.

## Operator hardening notes

Because each user runs their own instance, most of your security posture is in your hands:

- **Keep `.env` private.** It holds your Discord bot token, database password, and any
  Ollama API keys. It is git-ignored and excluded from Docker images by default — keep it
  that way. If a token is ever exposed, **rotate it immediately** in the Discord Developer
  Portal (and rotate any Ollama keys).
- **Don't expose internal services.** `search-api` and the Postgres/Ollama ports are meant
  for the internal Docker network (or `127.0.0.1`) only — `search-api` is unauthenticated
  by design and trusts its caller, so never publish it to a LAN or the internet.
- **Access control lives in the bot.** Search and ask results are scoped to the channels
  each user can actually read, and governance (`/admin`) is per-server. Keep
  `BOOTSTRAP_ADMIN_IDS` limited to people you trust as global operators.
- **Logs stay local** and avoid recording query text or message content at `info` level;
  keep it that way if you change logging.
