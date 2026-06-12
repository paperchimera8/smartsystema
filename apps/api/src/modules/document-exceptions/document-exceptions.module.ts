import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DocumentExceptionsController } from "./document-exceptions.controller";
import { DocumentExceptionsRepository } from "./document-exceptions.repository";
import { DocumentExceptionsService } from "./document-exceptions.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DocumentExceptionsController],
  providers: [DocumentExceptionsService, DocumentExceptionsRepository]
})
export class DocumentExceptionsModule {}
