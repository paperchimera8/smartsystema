import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DocumentsController } from "./documents.controller";
import { OcrService } from "./ocr.service";

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [OcrService]
})
export class DocumentsModule {}
