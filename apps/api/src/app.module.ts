import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SentryModule } from "@sentry/nestjs/setup";
import { AgentCommandsModule } from "./modules/agent-commands/agent-commands.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ConnectionsModule } from "./modules/connections/connections.module";
import { DocumentExceptionsModule } from "./modules/document-exceptions/document-exceptions.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { DraftsModule } from "./modules/drafts/drafts.module";
import { HealthModule } from "./modules/health/health.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { MetadataModule } from "./modules/metadata/metadata.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { TenantsModule } from "./modules/tenants/tenants.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [".env.local", ".env", "../../.env.local", "../../.env"],
      isGlobal: true
    }),
    SentryModule.forRoot(),
    HealthModule,
    AuthModule,
    TenantsModule,
    AgentsModule,
    AgentCommandsModule,
    ConnectionsModule,
    MetadataModule,
    DocumentsModule,
    DocumentExceptionsModule,
    DraftsModule,
    ObservabilityModule,
    JobsModule
  ]
})
export class AppModule {}
