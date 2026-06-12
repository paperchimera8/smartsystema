import { IsOptional, IsString, MaxLength } from "class-validator";

export class GetPendingCommandsDto {
  @IsString()
  @MaxLength(120)
  tenantId!: string;

  @IsString()
  @MaxLength(120)
  agentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  limit?: string;
}
