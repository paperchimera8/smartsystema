import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE, DATABASE_POOL } from "./database.constants";
import * as schema from "./schema";

function requireDatabaseUrl(configService: ConfigService): string {
  const databaseUrl = configService.get<string>("DATABASE_URL")?.trim();

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL must be configured.");
  }

  return databaseUrl;
}

@Injectable()
class DatabaseShutdownService implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Pool =>
        new Pool({
          connectionString: requireDatabaseUrl(configService)
        })
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema })
    },
    DatabaseShutdownService
  ],
  exports: [DATABASE]
})
export class DatabaseModule {}
