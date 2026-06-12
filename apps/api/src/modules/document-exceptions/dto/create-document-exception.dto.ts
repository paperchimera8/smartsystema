import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";
import {
  DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
  DOCUMENT_EXCEPTION_SIGNAL_CODES,
  DOCUMENT_EXCEPTION_STAGES,
  type DocumentExceptionSeverity
} from "@automator/contracts";

const DOCUMENT_EXCEPTION_SEVERITIES = ["info", "warning", "critical"] as const;
const DOCUMENT_EXCEPTION_ENTITY_KINDS = [
  "counterparty",
  "nomenclature",
  "unit",
  "document",
  "metadata",
  "validation"
] as const;

class DocumentExceptionSignalDto {
  @IsIn(DOCUMENT_EXCEPTION_SIGNAL_CODES)
  code!: (typeof DOCUMENT_EXCEPTION_SIGNAL_CODES)[number];

  @IsIn(DOCUMENT_EXCEPTION_SEVERITIES)
  severity!: DocumentExceptionSeverity;

  @IsString()
  @MaxLength(300)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  field?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  lineId?: string;

  @IsOptional()
  @IsIn(DOCUMENT_EXCEPTION_ENTITY_KINDS)
  entityKind?: (typeof DOCUMENT_EXCEPTION_ENTITY_KINDS)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  score?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  candidateCount?: number;
}

export class CreateDocumentExceptionDto {
  @IsIn([DOCUMENT_EXCEPTION_PAYLOAD_VERSION])
  payloadVersion!: typeof DOCUMENT_EXCEPTION_PAYLOAD_VERSION;

  @IsString()
  @MaxLength(120)
  tenantId!: string;

  @IsString()
  @MaxLength(120)
  documentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  draftId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  metadataSnapshotId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  schemaHash?: string;

  @IsIn(DOCUMENT_EXCEPTION_STAGES)
  stage!: (typeof DOCUMENT_EXCEPTION_STAGES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DocumentExceptionSignalDto)
  signals!: DocumentExceptionSignalDto[];

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
