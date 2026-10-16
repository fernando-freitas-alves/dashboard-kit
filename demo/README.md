# Standalone demo

https://github.com/user-attachments/assets/3e0f855d-4312-4db7-9bf8-e1c7114a3f73

The demo runs a React dashboard with a Python backend and SQLite storage. It includes fictional sales data, five starter charts, and a manual chart editor.

## Browser demo

[Open the live demo](https://fernando-freitas-alves.github.io/dashboard-kit/). It runs on GitHub Pages with fictional data and browser storage. You can edit charts, move and resize them, manage boards, and export definitions. Fixed starters work without a provider. Freeform AI prompts require the Python demo below.

Clearing site data also clears saved boards. Export boards to keep a copy. To build this version yourself, run `npm run demo:pages`. The output is `demo/dist`.

## Run locally

Install Node 22.12 or later, Python 3.12 or later, and [uv](https://docs.astral.sh/uv/). Run these commands from the repository root:

```sh
npm ci
npm run demo
```

Open [localhost:8781](http://127.0.0.1:8781). Drag charts by their headers, resize them from their corners, and open their details to inspect version history. Boards persist in `demo/.demo/boards.sqlite`.

The demo supports bars, horizontal bars, lines, areas, donuts, KPI cards, and tables. Its queries use a fixed vocabulary over fictional rows. See the [integration guide](../docs/integration.md) to connect your own dataset.

## Enable AI

Manual editing works without a key. To enable AI, copy `demo/.env.example` to `demo/.env`, set these values, and restart the demo:

```dotenv
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-6-luna
OPENAI_REASONING_EFFORT=high
```

Choose a model available to your OpenAI account that supports structured output. AI calls use your account and may incur charges. The demo sends your prompt and its fictional schema to OpenAI. It does not send dataset rows. Keep the key on the server. Environment variables take precedence over `.env`.

## Deployment limits

This demo runs locally for one user. It does not provide production authentication. Before exposing it to a network, implement the [host security requirements](../docs/integration.md#python-backend).
