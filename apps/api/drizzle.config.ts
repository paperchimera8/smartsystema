import type { Config } from "drizzle-kit";

export default {
  dialect: "postgresql",
  schema: "./src/modules/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://automator:automator@localhost:5432/automator"
  }
} satisfies Config;
