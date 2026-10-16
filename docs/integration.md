# Integration

## Install the frontend

The packages are not on a registry yet. Build and install a local tarball:

```sh
npm run build
mkdir -p artifacts
npm pack --workspace @loadsmart/dashboard-kit --pack-destination artifacts
```

In your React application, install the resulting file:

```sh
npm install /path/to/artifacts/loadsmart-dashboard-kit-0.1.0.tgz
```

Import the package and its stylesheet:

```tsx
import { Dashboard, createHttpAdapter } from '@loadsmart/dashboard-kit';
import '@loadsmart/dashboard-kit/styles.css';

// Construct once per authorized user and dataset. Remount when either changes.
const options = {
  namespace: 'sales:v1:current-user',
  adapter: createHttpAdapter('/api/dashboards'),
  palette: ['#5b5bd6', '#11a78f', '#f59e0b'],
  features: { sharing: false },
};

export function SalesDashboard() {
  return <Dashboard options={options} />;
}
```

Mount the dashboard on the client. Importing the package is safe without browser globals, but interactive charts need a browser. React 18 and 19 are declared peers. The current demo and tests use React 18.

## Frontend

`Dashboard` takes a stable `DashboardOptions` object and creates its runtime once. Remount it with a different React `key` when the user, dataset, version, or adapter changes. Use a non-secret namespace unique to that scope; table preferences are stored locally under it.

The adapter loads the workspace, creates/saves/archives boards, stores preferences, runs queries, and optionally composes charts. Saves use server revisions. A stale save must return a conflict rather than silently overwrite another edit. `DashboardHandle.flush()` waits for queued saves; `refresh()` reruns data queries; `setPeriod()` applies a host-defined period.

`createHttpAdapter(base, { headers })` implements the bundled Flask API contract. Use `headers` for your application's CSRF token or authorized session headers. The local demo shows cookie sessions plus a CSRF header. Do not put provider keys in this adapter.

Sharing requires a host `share` callback and server access rules. `features.sharing = false` hides its UI. The kit does not create public links or decide which rows are safe to share. Supply pre-authorized, filtered results to the `shared` prop for read-only rendering.

## Date filtering

Dragging across an ISO date axis on a line, area, or bar chart sets the dashboard period. The date chip clears it. `mapping.timeUnit` defines each bucket as `day` (default), `week`, or `month`.

Implement `adapter.applyFilters(query, { period })` to apply that period to every query. `period.from` is inclusive and `period.to` is exclusive, both UTC days since January 1, 1970. The kit retains the saved query and caches each filtered query separately. Without this adapter hook, selecting dates cannot filter your data.

The [browser demo adapter](../demo/src/browserAdapter.ts) and [Python data adapter](../demo/server/data.py) show the complete flow: add a validated `{ from, to }` period to the query, filter rows by date, then aggregate. With `createHttpAdapter`, add the same `applyFilters` hook to the returned adapter.

## Python backend

Install the local package with `pip install './python[flask]'`. `DashboardService` joins three host decisions:

1. A repository scoped by dataset, version, and authenticated user.
2. A data adapter that validates charts/queries, executes permitted queries, and supplies the default board and approved AI metadata.
3. An authorization callback checked for every service action.

`SQLiteBoardRepository` is a small persistent implementation. Replace it with your own repository for your database or deployment constraints. The Flask blueprint accepts the service and a trusted server-side scope resolver. Never derive the user scope from an unverified request field.

The kit validates document structure, sizes, unique IDs, and revisions. Your data adapter must validate query semantics, every retained chart version, result limits, and the allowed dataset. Treat imported boards and AI output as untrusted. Do not execute arbitrary SQL, HTML, JavaScript, or URLs from them.

The demo uses a bounded JSON query vocabulary (`metric`, `group`, optional `series` and `period`) over fictional rows. It accepts empty draft charts but rejects queries hidden inside them. Its loopback binding, host/origin checks, CSRF protection, 512 KiB request limit, and six AI requests per minute are demo defaults. Before exposing a server, supply authentication, tenant permissions, HTTPS, secure cookies, durable secrets, operational limits, logging, and a production WSGI server.

## AI

AI is optional. Without a composer the manual editor still works. A composer receives a prompt plus host-approved metadata, returns a chart specification, and the data adapter validates it before use. A custom adapter can report progress and a build trace. A trace is an explanation/query log supplied by the application, not private model reasoning.

The Python OpenAI transport uses the Responses API with structured output and `store: false`. The separate Node Anthropic transport can support a host-owned tool loop. Both need server credentials. Hosts select the model, reasoning settings, token budget, query tools, timeouts, rate limits, and what metadata may leave their systems. Never pass credentials, unrestricted row samples, or private notes by default.

## Styling and charts

Import the kit stylesheet once, then apply your overrides. Set `--dashboard-*` CSS variables on `.ldk-surface` and `.ldk-popover` for colors, borders, typography, and overlays. The [demo stylesheet](../demo/src/style.css) includes light and dark themes for charts, tooltips, and dialogs.

Use `slots.Editor` for a custom chart builder, `slots.Toolbar` for filters, and `renderers` to replace a built-in chart. See [contracts.ts](../frontend/src/contracts.ts) for the option and adapter types.

Use `fieldPresentation` to give result fields readable labels and units across cards, axes, tooltips, tables, and maps. Resolve fields from your dataset or validated query metadata; numeric values remain unchanged for sorting and export.

```ts
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' });
const fieldPresentation = (spec, field) => field === 'revenue'
  ? { label: 'Revenue', format: usd.format, axisFormat: compactUsd.format }
  : undefined;
// Include fieldPresentation in DashboardOptions.
```

A custom renderer receives a container, chart specification, and rows. Return cleanup logic for subscriptions or observers. Render text safely; don't interpolate untrusted labels into HTML. Table columns and cell actions are configurable without replacing the whole chart.

Map data is included as local JSON assets. The package resolves those files relative to its compiled ESM module; it does not require Vite's `?url` import syntax. Ensure your bundler copies those assets when building an application with maps.

## Distribution

The frontend tarball contains compiled ESM, declarations, CSS, map data, README, MIT license, and dependency notices. It excludes raw source, local configuration, databases, and review media. The Python wheel contains only its package and license/metadata.

For repositories that must vendor dependencies, run `npm run build`, then `node scripts/vendor.mjs /path/to/consumer`. The script copies only `distribution-files.json`, records SHA-256 hashes, and rejects symlinked destinations or sources. `--check` detects modified, extra, and stale files. Install the vendored compiled frontend as a local package; consume the Python and Node directories separately.
