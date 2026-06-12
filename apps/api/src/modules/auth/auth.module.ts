import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { NativeAuthGuard } from "./native-auth.guard";

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: requireJwtSecret(configService)
      })
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, NativeAuthGuard],
  exports: [AuthService, NativeAuthGuard]
})
export class AuthModule {}

function requireJwtSecret(configService: ConfigService): string {
  const configuredSecret = configService.get<string>("AUTH_JWT_SECRET")?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_JWT_SECRET must be configured in production.");
  }

  return "automator-local-development-jwt-secret-change-me";
}
