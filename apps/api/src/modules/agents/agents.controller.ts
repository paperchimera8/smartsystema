import { Controller, Get } from "@nestjs/common";
import { INTEGRATION_PATHS, type IntegrationPath } from "@automator/contracts";

type AgentCapabilitiesResponse = {
  integrationPaths: IntegrationPath[];
  offlineQueue: boolean;
  nativeAuth: "oidc-pkce";
};

@Controller("agents")
export class AgentsController {
  @Get("capabilities")
  getCapabilities(): AgentCapabilitiesResponse {
    return {
      integrationPaths: [...INTEGRATION_PATHS],
      offlineQueue: true,
      nativeAuth: "oidc-pkce"
    };
  }
}

