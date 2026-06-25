# Releasing

This project uses [Semantic Versioning](https://semver.org) and
[Keep a Changelog](https://keepachangelog.com). Releases are cut by pushing a `vX.Y.Z`
git tag; a [GitHub Actions workflow](.github/workflows/release.yml) then publishes the
GitHub Release and the container image automatically.

While the project is pre-1.0, breaking changes may land in **minor** versions (`0.Y.0`)
and fixes in **patch** versions (`0.Y.Z`).

## Cutting a release

You no longer hand-edit the changelog at release time. During development, accumulate
changes under the `## [Unreleased]` heading in [CHANGELOG.md](CHANGELOG.md); to cut a
release, just tag and push.

1. Make sure `master` is green (CI passing) and your working tree is clean.
2. Pick the next version `X.Y.Z`, and confirm `## [Unreleased]` holds the notes for it.
3. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin master --follow-tags
   ```

That's it. The `Release` workflow triggers on the tag and:

- creates a **GitHub Release** named `vX.Y.Z`, using the `## [X.Y.Z]` section of
  `CHANGELOG.md` if you pre-flipped it, otherwise falling back to `## [Unreleased]` (so the
  body is never empty);
- builds and pushes a **multi-arch image** (`linux/amd64` + `linux/arm64`) to the GitHub
  Container Registry at `ghcr.io/<owner>/discord-semantic-search`, tagged both `:vX.Y.Z`
  and `:latest`; and
- **flips the changelog** on `master`: renames `## [Unreleased]` to `## [X.Y.Z] - <date>`,
  opens a fresh empty `## [Unreleased]` above it, and bumps `version` in the root
  `package.json` to match — committed as `github-actions[bot]`.

After it finishes, check the **Releases** page and the **Packages** tab to confirm both
published, and `git pull` to get the changelog-flip commit.

> Notes on the auto-flip: the **tagged commit itself** still shows `## [Unreleased]` — the
> flip lands on `master` as a follow-up commit, not retroactively on the tag. The flip is
> idempotent, so pre-flipping the changelog by hand (the old flow) still works and is left
> untouched. If `master` has branch protection that blocks pushes from `github-actions[bot]`,
> the flip step will fail; flip the changelog manually or grant the workflow push access.

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
