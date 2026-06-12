import { IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { INTEGRATION_PATHS } from "@automator/contracts";

const RUN_STATES = ["ready", "degraded", "offline"] as const;

export class AgentHeartbeatDto {
  @IsString()
  @MaxLength(120)
  agentId!: string;

  @IsString()
  @MaxLength(120)
  tenantId!: string;

  @IsIn(RUN_STATES)
  runState!: (typeof RUN_STATES)[number];

  @IsArray()
  @IsIn(INTEGRATION_PATHS, { each: true })
  capabilities!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  schemaSnapshotId?: string;
}
