# Releasing

This project uses [Semantic Versioning](https://semver.org) and
[Keep a Changelog](https://keepachangelog.com). Releases are cut by pushing a `vX.Y.Z`
git tag; a [GitHub Actions workflow](.github/workflows/release.yml) then publishes the
GitHub Release and the container image automatically.

While the project is pre-1.0, breaking changes may land in **minor** versions (`0.Y.0`)
and fixes in **patch** versions (`0.Y.Z`).

## Cutting a release

1. Make sure `master` is green (CI passing) and your working tree is clean.
2. Pick the next version `X.Y.Z`.
3. In [CHANGELOG.md](CHANGELOG.md), rename the `## [Unreleased]` heading to
   `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty `## [Unreleased]` section above it.
   (Optionally bump `version` in the root `package.json` to match.)
4. Commit:
   ```bash
   git commit -am "chore(release): vX.Y.Z"
   ```
5. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin master --follow-tags
   ```

That's it. The `Release` workflow triggers on the tag and:

- creates a **GitHub Release** named `vX.Y.Z`, using the matching `## [X.Y.Z]` section of
  `CHANGELOG.md` as the body; and
- builds and pushes a **multi-arch image** (`linux/amd64` + `linux/arm64`) to the GitHub
  Container Registry at `ghcr.io/<owner>/discord-semantic-search`, tagged both `:vX.Y.Z`
  and `:latest`.

After it finishes, check the **Releases** page and the **Packages** tab to confirm both
published.

> The very first release should be `v0.1.0`. The image name assumes the repository is
> named `discord-semantic-search`; if you rename it, update the image in
> [docker-compose.yml](docker-compose.yml) and the workflow to match.

## Running a published release

Operators can run a tagged image instead of building from source: set `APP_VERSION` in
`.env` (e.g. `APP_VERSION=v0.1.0`), then:

```bash
docker compose pull
docker compose up -d
```

Leaving `APP_VERSION=local` (the default) builds the image from source as usual.
