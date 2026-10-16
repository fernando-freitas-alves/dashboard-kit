# Dashboard Kit

https://github.com/user-attachments/assets/3e0f855d-4312-4db7-9bf8-e1c7114a3f73

Dashboard Kit is a React library for editable dashboards. Users can move and resize charts, create them with AI, and restore previous versions. Connect your own data, permissions, and theme.

[Try the live demo](https://fernando-freitas-alves.github.io/dashboard-kit/). Changes stay in your browser. Run the Python demo below for live AI.

## Try the demo

Install Node 22.12 or later, Python 3.12 or later, and [uv](https://docs.astral.sh/uv/). Then run:

```sh
npm ci
npm run demo
```

Open [localhost:8781](http://127.0.0.1:8781). The demo uses fictional sales data and saves boards locally. It works without an API key. See the [demo guide](demo/README.md) to enable AI.

## What you can build

- Create multiple boards and import or export their definitions.
- Display charts, maps, tables, and KPI cards.
- Add custom editors, filters, and chart renderers.
- Save boards through your backend or the Python and SQLite packages.

Start with the [integration guide](docs/integration.md) for installation, React usage, themes, and backend contracts. Your application controls authentication and data access.

## Explore

- [Demo setup and AI configuration](demo/README.md)
- [API types](frontend/src/contracts.ts)
- [Contributing and tests](CONTRIBUTING.md)
- [Validation results](docs/validation.md)
- [Release review](docs/release-review.md)
- [Security reporting](SECURITY.md)

## License

The library uses [MIT](LICENSE). See [dependency notices](THIRD_PARTY_NOTICES.md) and the separate [review media terms](docs/media-license.md).
