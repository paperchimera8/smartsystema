import "./instrument";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import {
  applyPrivateNetworkCorsHeader,
  applySecurityHeaders,
  buildRuntimeSecurityConfig
} from "./config/runtime-security";

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8080);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

async function bootstrap() {
  const runtimeSecurity = buildRuntimeSecurityConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true
  });

  app.enableShutdownHooks();
  applySecurityHeaders(app);
  app.enableCors({
    allowedHeaders: ["accept", "authorization", "content-type"],
    maxAge: 600,
    methods: ["GET", "POST", "OPTIONS"],
    origin: runtimeSecurity.corsOrigin
  });
  applyPrivateNetworkCorsHeader(app, runtimeSecurity.allowPrivateNetworkCors);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true
    })
  );

  if (runtimeSecurity.enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("СмартСистема Platform API")
      .setDescription("Control plane API for agents, documents, metadata, drafts, and jobs.")
      .setVersion("0.1.0")
      .build();

    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(parsePort(process.env.PORT), "0.0.0.0");
}

void bootstrap();
