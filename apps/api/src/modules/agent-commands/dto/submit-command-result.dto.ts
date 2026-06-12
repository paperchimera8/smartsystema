import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const RESULT_STATUSES = ["succeeded", "failed_retryable", "failed_terminal"] as const;

export class SubmitCommandResultDto {
  @IsString()
  @MaxLength(120)
  commandId!: string;

  @IsString()
  @MaxLength(120)
  tenantId!: string;

  @IsString()
  @MaxLength(120)
  agentId!: string;

  @IsIn(RESULT_STATUSES)
  status!: (typeof RESULT_STATUSES)[number];

  @IsString()
  startedAt!: string;

  @IsString()
  finishedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  selectedStrategy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  externalReference?: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(400, { each: true })
  normalizedErrors!: string[];

  @IsBoolean()
  retryable!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  diagnosticRef?: string;

  @IsString()
  @MaxLength(160)
  correlationId!: string;
}
