import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import { DRAFT_CREATION_PAYLOAD_VERSION, type DraftJsonValue } from "@automator/contracts";

class DraftFieldDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsDefined()
  value!: DraftJsonValue;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sourceField?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

class DraftReferenceDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(160)
  fieldName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  targetResourceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  targetKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  candidateId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

class DraftConfidenceDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  score!: number;

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  reasons!: string[];

  @IsBoolean()
  requiresReview!: boolean;
}

class DraftValidationMessageDto {
  @IsString()
  @MaxLength(120)
  code!: string;

  @IsIn(["error", "warning", "info"])
  severity!: "error" | "warning" | "info";

  @IsString()
  @MaxLength(400)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  field?: string;
}

class DraftValidationSummaryDto {
  @IsIn(["passed", "warning", "failed"])
  status!: "passed" | "warning" | "failed";

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DraftValidationMessageDto)
  messages!: DraftValidationMessageDto[];
}

export class CreateDraftDto {
  @IsIn([DRAFT_CREATION_PAYLOAD_VERSION])
  payloadVersion!: typeof DRAFT_CREATION_PAYLOAD_VERSION;

  @IsString()
  @MaxLength(120)
  tenantId!: string;

  @IsString()
  @MaxLength(120)
  documentId!: string;

  @IsString()
  @MaxLength(120)
  metadataSnapshotId!: string;

  @IsString()
  @MaxLength(160)
  schemaHash!: string;

  @IsString()
  @MaxLength(120)
  documentType!: string;

  @IsString()
  @MaxLength(160)
  targetResourceName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => DraftFieldDto)
  fields!: DraftFieldDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => DraftReferenceDto)
  references?: DraftReferenceDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => DraftConfidenceDto)
  confidence!: DraftConfidenceDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => DraftValidationSummaryDto)
  validationSummary!: DraftValidationSummaryDto;

  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;

  @IsString()
  @MaxLength(160)
  correlationId!: string;

  @IsString()
  @MaxLength(120)
  createdByUserId!: string;
}
