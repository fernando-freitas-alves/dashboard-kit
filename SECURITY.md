# Security

Report vulnerabilities through [GitHub private reporting](https://github.com/fernando-freitas-alves/dashboard-kit/security/advisories/new). Include the affected version, reproduction steps, and impact. Keep credentials, personal data, and working exploit details out of public issues.

Host applications must authenticate users, authorize each dataset and action, validate queries and imported charts, limit query cost, and protect provider credentials. See the [integration guide](docs/integration.md).

The GitHub Pages demo uses fictional data and browser storage. It has no backend and makes no AI requests. The Python demo runs on localhost for one user. Add production authentication and deployment controls before exposing that server to a network.
