import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Same precedence Next.js itself uses (.env.local overrides .env) — plain
// `dotenv/config` only reads `.env`, which silently pointed migrate/seed at
// the wrong database whenever a stale `.env` coexisted with `.env.local`.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
      url:
      process.env["DIRECT_URL"] ??
      process.env["DATABASE_URL"] ??
      "postgresql://invoice_user:invoice_pass@localhost:5433/invoice_demo",
  },
});
