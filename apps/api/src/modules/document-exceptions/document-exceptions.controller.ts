import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import type { CreateDocumentExceptionResponse } from "@automator/contracts";
import { NativeAuthGuard } from "../auth/native-auth.guard";
import { CreateDocumentExceptionDto } from "./dto/create-document-exception.dto";
import { DocumentExceptionsService } from "./document-exceptions.service";

@Controller("document-exceptions")
@UseGuards(NativeAuthGuard)
export class DocumentExceptionsController {
  constructor(private readonly documentExceptionsService: DocumentExceptionsService) {}

  @Post()
  @HttpCode(201)
  createException(
    @Body() request: CreateDocumentExceptionDto
  ): Promise<CreateDocumentExceptionResponse> {
    return this.documentExceptionsService.createException(request);
  }
}
