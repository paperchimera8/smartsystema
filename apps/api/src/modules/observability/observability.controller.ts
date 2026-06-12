import { Controller, Get } from "@nestjs/common";
import { sentryRuntimeStatus, type SentryRuntimeStatus } from "../../observability/sentry";

type ObservabilityResponse = {
  service: "api";
  status: "ok";
  checkedAt: string;
  telemetry: {
    sentry: SentryRuntimeStatus;
    pii: {
      rawDocumentsLogged: false;
      rawOcrTextLogged: false;
      credentialsLogged: false;
    };
  };
};

@Controller("observability")
export class ObservabilityController {
  @Get()
  getObservability(): ObservabilityResponse {
    return {
      service: "api",
      status: "ok",
      checkedAt: new Date().toISOString(),
      telemetry: {
        sentry: sentryRuntimeStatus(),
        pii: {
          rawDocumentsLogged: false,
          rawOcrTextLogged: false,
          credentialsLogged: false
        }
      }
    };
  }
}
