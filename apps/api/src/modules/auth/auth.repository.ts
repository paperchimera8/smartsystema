import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull } from "drizzle-orm";
import { DATABASE } from "../database/database.constants";
import type { AutomatorDatabase } from "../database/database.types";
import {
  authSessions,
  nativeAuthRequests,
  users,
  type AuthUserRole,
  type NativeAuthRequestStatus
} from "../database/schema";

export type AuthUserRow = typeof users.$inferSelect;
export type NativeAuthRequestRow = typeof nativeAuthRequests.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;

type CreateUserInput = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: AuthUserRole;
  passwordHash: string;
  createdAt: Date;
};

type CreateNativeAuthRequestInput = {
  authRequestId: string;
  stateHash: string;
  pollTokenHash: string;
  deviceLabel?: string;
  correlationId: string;
  expiresAt: Date;
  createdAt: Date;
};

type CompleteNativeAuthRequestInput = {
  authRequestId: string;
  userId: string;
  tenantId: string;
  sessionCodeHash: string;
  completedAt: Date;
};

type CreateSessionInput = {
  sessionId: string;
  userId: string;
  tenantId: string;
  accessTokenHash: string;
  userAgent?: string;
  expiresAt: Date;
  createdAt: Date;
};

@Injectable()
export class AuthRepository {
  constructor(@Inject(DATABASE) private readonly database: AutomatorDatabase) {}

  async findUserByEmail(email: string): Promise<AuthUserRow | undefined> {
    const rows = await this.database
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return rows[0];
  }

  async findUserById(userId: string): Promise<AuthUserRow | undefined> {
    const rows = await this.database
      .select()
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);

    return rows[0];
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRow> {
    const rows = await this.database
      .insert(users)
      .values({
        userId: input.userId,
        tenantId: input.tenantId,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        status: "active",
        passwordHash: input.passwordHash,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      .returning();

    return rows[0]!;
  }

  async createNativeAuthRequest(input: CreateNativeAuthRequestInput): Promise<NativeAuthRequestRow> {
    const rows = await this.database
      .insert(nativeAuthRequests)
      .values({
        authRequestId: input.authRequestId,
        stateHash: input.stateHash,
        pollTokenHash: input.pollTokenHash,
        status: "pending",
        deviceLabel: input.deviceLabel,
        correlationId: input.correlationId,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      .returning();

    return rows[0]!;
  }

  async findNativeAuthRequest(authRequestId: string): Promise<NativeAuthRequestRow | undefined> {
    const rows = await this.database
      .select()
      .from(nativeAuthRequests)
      .where(eq(nativeAuthRequests.authRequestId, authRequestId))
      .limit(1);

    return rows[0];
  }

  async completeNativeAuthRequest(
    input: CompleteNativeAuthRequestInput
  ): Promise<NativeAuthRequestRow | undefined> {
    const rows = await this.database
      .update(nativeAuthRequests)
      .set({
        status: "completed",
        userId: input.userId,
        tenantId: input.tenantId,
        sessionCodeHash: input.sessionCodeHash,
        completedAt: input.completedAt,
        updatedAt: input.completedAt
      })
      .where(
        and(
          eq(nativeAuthRequests.authRequestId, input.authRequestId),
          eq(nativeAuthRequests.status, "pending")
        )
      )
      .returning();

    return rows[0];
  }

  async consumeNativeAuthRequest(
    authRequestId: string,
    consumedAt: Date
  ): Promise<NativeAuthRequestRow | undefined> {
    const rows = await this.database
      .update(nativeAuthRequests)
      .set({
        status: "consumed",
        consumedAt,
        updatedAt: consumedAt
      })
      .where(
        and(
          eq(nativeAuthRequests.authRequestId, authRequestId),
          eq(nativeAuthRequests.status, "completed")
        )
      )
      .returning();

    return rows[0];
  }

  async expireNativeAuthRequest(authRequestId: string, expiredAt: Date): Promise<void> {
    await this.database
      .update(nativeAuthRequests)
      .set({
        status: "expired",
        updatedAt: expiredAt
      })
      .where(
        and(
          eq(nativeAuthRequests.authRequestId, authRequestId),
          eq(nativeAuthRequests.status, "pending")
        )
      );
  }

  async createSession(input: CreateSessionInput): Promise<AuthSessionRow> {
    const rows = await this.database
      .insert(authSessions)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        tenantId: input.tenantId,
        accessTokenHash: input.accessTokenHash,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      .returning();

    return rows[0]!;
  }

  async findActiveSession(sessionId: string, now: Date): Promise<AuthSessionRow | undefined> {
    const rows = await this.database
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.sessionId, sessionId),
          gt(authSessions.expiresAt, now),
          isNull(authSessions.revokedAt)
        )
      )
      .limit(1);

    return rows[0];
  }
}

export function isAuthUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export function isNativeAuthStatus(value: string): value is NativeAuthRequestStatus {
  return value === "pending" || value === "completed" || value === "consumed" || value === "expired";
}
