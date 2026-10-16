# Validation

Validated locally on October 16, 2026. Source baseline: Labs commit `1b96015837098633b3cc7b5725b2db9eb6cfacc8`.

## Automated checks

- TypeScript check and compiled ESM/declaration/CSS build: passed.
- Frontend and Node tests: 51 passed, including six browser-demo tests.
- Python library and standalone-demo tests: 46 passed.
- Package and vendoring tests: 5 passed.
- Demo production build: passed.
- npm runtime dependency audit: no reported vulnerabilities.
- Python wheel and source archive: built and inspected; wheel imports in isolation from the checkout.
- Candidate source scan: no credentials or internal service URLs found. Local environment files, databases, installed dependencies, and build artifacts are ignored.

See the GitHub Actions run linked in the release checklist for hosted results. React 18 was exercised; React 19 is a declared peer and still needs its own compatibility run before release.

## Browser checks

The standalone demo was exercised with fictional data:

- Create a chart with the configured OpenAI model.
- Edit chart fields manually and save a second version.
- Open details, inspect definitions and version history.
- Move and resize a chart; verify its saved layout.
- Reload and verify persisted boards.
- Inspect light and dark themes, including detached dialogs.

Live AI used the reviewer's server-side key and the configured `gpt-6-luna` model with high reasoning. It is optional; manual editing works without a key. Automated tests do not call a provider.

## Known limits

The demo is a local single-user playground. Production hosts must supply authentication, scope authorization, query validation, rate limits, and deployment controls. The demo limits queries to its fictional sales schema. It is not a generic SQL console.

The production build warns about a JavaScript chunk above 500 kB. No runtime performance improvement is claimed. The private film is reviewed separately; see the media provenance and release review.

## Video checks

The private HyperFrames preview was 32 seconds at 1920 × 1080, 30 fps, with an original synthesized soundtrack. HyperFrames checks passed with no runtime, layout, or motion errors; all 19 sampled text contrast checks passed AA. Key frames and a decoded frame from the final H.264/AAC MP4 were inspected. The editable project remains separate from this source snapshot.

## Public demo

The public source release adds a browser adapter, static Pages build, and tests for layout/history persistence, revisions, archive/restore, imports, query validation, cancellation, fixed starters, and storage errors. GitHub Actions checks the package and deploys only the static demo directory. The public video excludes the private template-based opening.
