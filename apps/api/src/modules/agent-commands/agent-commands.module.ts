import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { AgentCommandsController } from "./agent-commands.controller";
import { AgentCommandsRepository } from "./agent-commands.repository";
import { AgentCommandsService } from "./agent-commands.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AgentCommandsController],
  providers: [AgentCommandsService, AgentCommandsRepository],
  exports: [AgentCommandsService]
})
export class AgentCommandsModule {}
