# Release checklist

The GitHub repository contains the library, documentation, and demo under MIT. GitHub Pages serves the browser demo after checks pass. npm and Python registry releases are separate from the source release.

## Before a registry release

1. Verify ownership of the package names and registry scopes.
2. Run checks and inspect the npm tarball, Python wheel, and source archive.
3. Test React 19 before advertising it as verified. The current demo uses React 18.
4. Remove `private: true` from the intended package in a release change. Keep the workspace and demo private.
5. Tag the reviewed commit and publish those artifacts.

## Checks

```sh
npm ci
npm run check
uv build python --out-dir artifacts/python
uv run --project demo/server python scripts/check-python-package.py
npm audit --omit=dev
```

See [validation results](validation.md) for local checks and [GitHub Actions](https://github.com/fernando-freitas-alves/dashboard-kit/actions) for hosted runs. Environment files, browser state, and local databases are not part of the source release.
