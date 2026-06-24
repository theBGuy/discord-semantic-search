# Single image shared by all TypeScript services. They run via tsx (no build step);
# @app/shared is consumed as source. The compose `command` selects which service runs.
FROM node:22-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
RUN corepack enable

# Tesseract OCR (Phase 3): used by embedding-worker to read text from image
# attachments. Bundled into the image so OCR is fully offline. Add more languages
# with extra `tesseract-ocr-<lang>` packages and set OCR_LANG.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cache friendly): copy only manifests + lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/discord-bot/package.json services/discord-bot/
COPY services/embedding-worker/package.json services/embedding-worker/
COPY services/search-api/package.json services/search-api/
RUN pnpm install --frozen-lockfile

# App source (db/migrations included for the migrate service).
COPY . .

# Overridden per service in docker-compose.yml.
CMD ["node", "-e", "console.error('set a command in docker-compose'); process.exit(1)"]
