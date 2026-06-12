import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DraftsController } from "./drafts.controller";
import { DraftsRepository } from "./drafts.repository";
import { DraftsService } from "./drafts.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DraftsController],
  providers: [DraftsService, DraftsRepository]
})
export class DraftsModule {}
