import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from "class-validator";
import { AGENT_COMMAND_TYPES } from "@automator/contracts";

export class CreateAgentCommandDto {
  @IsInt()
  @Min(1)
  @Max(1)
  payloadVersion!: number;

  @IsString()
  @MaxLength(120)
  tenantId!: string;

  @IsString()
  @MaxLength(120)
  agentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  commandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  draftId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  metadataSnapshotId?: string;

  @IsIn(AGENT_COMMAND_TYPES)
  commandType!: (typeof AGENT_COMMAND_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(20)
  commandPayloadVersion!: number;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;

  @IsISO8601()
  deadlineAt!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @IsString()
  @MaxLength(160)
  correlationId!: string;

  @IsString()
  @MaxLength(120)
  createdByUserId!: string;
}
