import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import type { CreateDraftResponse } from "@automator/contracts";
import { NativeAuthGuard } from "../auth/native-auth.guard";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { DraftsService } from "./drafts.service";

@Controller("drafts")
@UseGuards(NativeAuthGuard)
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @Post()
  @HttpCode(201)
  createDraft(@Body() request: CreateDraftDto): Promise<CreateDraftResponse> {
    return this.draftsService.createDraft(request);
  }
}
