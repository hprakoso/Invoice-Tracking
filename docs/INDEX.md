# Invoice Intelligence System — Documentation

Technical reference for the Invoice Intelligence System. The root [`README.md`](../README.md) is the pitch/quick-start for demo purposes; the files here are the structured engineering reference.

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, service topology, folder structure, request flows |
| [DATABASE.md](./DATABASE.md) | Prisma schema, table/column reference, migrations |
| [API.md](./API.md) | Every Next.js API route and AI-service endpoint, with response-field → data-source tracing |
| [SETUP.md](./SETUP.md) | Local dev setup, environment variables, demo accounts, troubleshooting |
| [CHANGELOG.md](./CHANGELOG.md) | Commit Log (full project history by phase) + Code Changes Made (running log for future work) |

## Other project docs (root)

| File | Purpose |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Working rules for AI-assisted changes in this repo (commit discipline, docs requirements, safety) |
| [`AGENTS.md`](../AGENTS.md) | Warning that this Next.js version has breaking changes vs. training data |
| [`memory.md`](../memory.md) | Running project memory — architecture snapshot, conventions, completed/pending tasks, known issues |

## Convention going forward

Per `CLAUDE.md`, every code change must be reflected in `docs/CHANGELOG.md` under **Code Changes Made** (what/why) and **Commit Log** (commit reference), and any new/changed API response field must be traceable to a `table.column` or formula in `docs/API.md`.
