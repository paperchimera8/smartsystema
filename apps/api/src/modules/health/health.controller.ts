import { Controller, Get } from "@nestjs/common";

type HealthResponse = {
  service: "api";
  status: "ok";
  checkedAt: string;
};

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: "api",
      status: "ok",
      checkedAt: new Date().toISOString()
    };
  }
}

