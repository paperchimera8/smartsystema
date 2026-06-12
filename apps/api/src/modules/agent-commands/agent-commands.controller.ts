import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type {
  AgentCommandEnvelope,
  AgentHeartbeatResponse,
  CreateAgentCommandRequest,
  CreateAgentCommandResponse
} from "@automator/contracts";
import { NativeAuthGuard } from "../auth/native-auth.guard";
import { AgentHeartbeatDto } from "./dto/agent-heartbeat.dto";
import { CreateAgentCommandDto } from "./dto/create-agent-command.dto";
import { GetPendingCommandsDto } from "./dto/get-pending-commands.dto";
import { SubmitCommandResultDto } from "./dto/submit-command-result.dto";
import { AgentCommandsService } from "./agent-commands.service";

const MAX_POLL_LIMIT = 20;

@Controller("agents")
export class AgentCommandsController {
  constructor(private readonly service: AgentCommandsService) {}

  @Post("commands")
  @HttpCode(201)
  @UseGuards(NativeAuthGuard)
  async createCommand(
    @Body() dto: CreateAgentCommandDto
  ): Promise<CreateAgentCommandResponse> {
    return this.service.createCommand(dto as CreateAgentCommandRequest);
  }

  @Get("commands/pending")
  async getPendingCommands(
    @Query() query: GetPendingCommandsDto
  ): Promise<{ commands: AgentCommandEnvelope[] }> {
    assertAgentRuntimeEndpointAllowed();
    const limit = Math.min(parseInt(query.limit ?? "10", 10) || 10, MAX_POLL_LIMIT);
    const commands = await this.service.getPendingCommands(query.tenantId, query.agentId, limit);
    return { commands };
  }

  @Post("commands/:commandId/result")
  @HttpCode(200)
  async submitCommandResult(
    @Param("commandId") commandId: string,
    @Body() dto: SubmitCommandResultDto
  ): Promise<AgentCommandEnvelope> {
    assertAgentRuntimeEndpointAllowed();
    return this.service.submitResult(commandId, dto);
  }

  @Post("heartbeat")
  @HttpCode(200)
  async recordHeartbeat(@Body() dto: AgentHeartbeatDto): Promise<AgentHeartbeatResponse> {
    assertAgentRuntimeEndpointAllowed();
    return this.service.recordHeartbeat({
      agentId: dto.agentId,
      tenantId: dto.tenantId,
      runState: dto.runState,
      capabilities: dto.capabilities as never,
      ...(dto.schemaSnapshotId !== undefined ? { schemaSnapshotId: dto.schemaSnapshotId } : {})
    });
  }
}

function assertAgentRuntimeEndpointAllowed(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AGENT_COMMAND_BUS_ALLOW_UNAUTHENTICATED_DEV_MODE !== "true"
  ) {
    throw new UnauthorizedException({
      code: "agentAuthenticationRequired",
      message: "Agent runtime endpoints require authenticated enrollment in production.",
      retryable: false,
      remediation: "Enable the enrolled-agent authentication module before production use."
    });
  }
}
