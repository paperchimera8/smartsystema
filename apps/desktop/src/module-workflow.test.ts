import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDocumentExceptionRequestFromDocument,
  buildDemoDocumentExceptionRequest,
  buildDemoDraftRequest,
  buildDemoWritePackageRequest,
  BackendRequestError,
  buildDraftRequestFromDocument,
  buildWritePackageRequestFromDocument,
  apiEndpointUrl,
  configuredApiBaseUrl,
  createDraftWorkflow,
  demoCounterpartyResolution,
  demoDocumentExceptionResponse,
  demoDraftResponse,
  demoNomenclatureResolution,
  isTauriRuntime,
  normalizeApiBaseUrl,
  pollNativeBrowserAuth,
  routeDocumentExceptionWorkflow,
  startNativeBrowserAuth,
  fetchNativeAuthMe
} from "./module-workflow";
import type { MappedDocument } from "./sample-document";

describe("module workflow helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes safe API base URLs and treats empty config as demo mode", () => {
    expect(normalizeApiBaseUrl(undefined)).toBeNull();
    expect(normalizeApiBaseUrl("  ")).toBeNull();
    expect(normalizeApiBaseUrl("https://api.example.com")).toBe("https://api.example.com/api");
    expect(normalizeApiBaseUrl("https://api.example.com/api/")).toBe("https://api.example.com/api");
    expect(apiEndpointUrl("https://api.example.com", "/drafts")).toBe("https://api.example.com/api/drafts");
    expect(apiEndpointUrl("https://api.example.com/api", "/documents/upload")).toBe(
      "https://api.example.com/api/documents/upload"
    );
    vi.stubEnv("VITE_API_BASE_URL", "");
    expect(configuredApiBaseUrl()).toBeNull();
  });

  it("rejects unsafe API base URLs", () => {
    expect(() => normalizeApiBaseUrl("ftp://api.example.com")).toThrow("http or https");
    expect(() => normalizeApiBaseUrl("https://user:pass@api.example.com")).toThrow("must not include");
    expect(() => normalizeApiBaseUrl("https://api.example.com?token=secret")).toThrow("must not include");
    expect(() => normalizeApiBaseUrl("not a url")).toThrow("valid http or https URL");
  });

  it("detects Tauri runtime only when the bridge marker exists", () => {
    expect(isTauriRuntime()).toBe(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {}
    });
    expect(isTauriRuntime()).toBe(true);
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("builds deterministic demo requests and responses", () => {
    const draftRequest = buildDemoDraftRequest("corr-draft");
    const exceptionRequest = buildDemoDocumentExceptionRequest("corr-exception");

    expect(draftRequest.validationSummary.status).toBe("warning");
    expect(demoDraftResponse(draftRequest)).toMatchObject({
      lifecycleStatus: "needs_review",
      approvalStatus: "pending",
      writeStatus: "not_requested"
    });
    expect(exceptionRequest.signals[0]?.code).toBe("nomenclature_ambiguous");
    expect(demoDocumentExceptionResponse(exceptionRequest)).toMatchObject({
      queueName: "accountant_review",
      status: "open"
    });
  });

  it("builds demo write-package requests and resolver fixtures", () => {
    expect(buildDemoWritePackageRequest("fresh-odata").targetKind).toBe("fresh-odata");
    expect(buildDemoWritePackageRequest().document.approvalStatus).toBe("approved");
    expect(demoCounterpartyResolution().requiresReview).toBe(false);
    expect(demoNomenclatureResolution().requiresReview).toBe(true);
  });

  it("builds selected-document draft, write, and exception payloads", () => {
    const document = mappedDocumentFixture();
    const draftRequest = buildDraftRequestFromDocument(document, "corr-draft-selected");
    const writeRequest = buildWritePackageRequestFromDocument(document, "draft-selected", "local-json-export", "corr-write-selected");
    const exceptionRequest = buildDocumentExceptionRequestFromDocument(document, "draft-selected", "corr-exception-selected");

    expect(draftRequest.documentId).toBe("uploaded-selected");
    expect(draftRequest.fields).toContainEqual(
      expect.objectContaining({ name: "Number", value: "4512", sourceField: "number" })
    );
    expect(draftRequest.fields).toContainEqual(expect.objectContaining({ name: "TotalAmount", value: 148920.4 }));
    expect(draftRequest.references?.[0]).toMatchObject({ targetKey: "counterparty-romashka" });
    expect(writeRequest.document.draftId).toBe("draft-selected");
    expect(writeRequest.document.fields).toContainEqual({ name: "VATAmount", value: 24820.07 });
    expect(exceptionRequest.signals.map((signal) => signal.code)).toContain("unit_mismatch");
    expect(exceptionRequest.signals.map((signal) => signal.code)).toContain("low_field_confidence");
  });

  it("uses demo workflow responses when API base URL is absent", async () => {
    await expect(createDraftWorkflow(null)).resolves.toMatchObject({
      mode: "demo",
      response: { draftId: "draft-demo-upd-4512" }
    });
    await expect(routeDocumentExceptionWorkflow(null)).resolves.toMatchObject({
      mode: "demo",
      response: { exceptionId: "exception-demo-upd-4512" }
    });
  });

  it("posts draft and exception payloads to the configured API", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      json: async () =>
        url.endsWith("/drafts")
          ? demoDraftResponse(JSON.parse(String(init.body)))
          : demoDocumentExceptionResponse(JSON.parse(String(init.body)))
    })) as unknown as typeof fetch;

    await expect(createDraftWorkflow("https://api.example.com", fetcher)).resolves.toMatchObject({
      mode: "live-api",
      response: { draftId: "draft-demo-upd-4512" }
    });
    await expect(
      routeDocumentExceptionWorkflow("https://api.example.com/api", fetcher)
    ).resolves.toMatchObject({
      mode: "live-api",
      response: { queueName: "accountant_review" }
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/drafts",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/document-exceptions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("starts and polls native browser auth through the configured API", async () => {
    const fetcherMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      json: async () =>
        url.endsWith("/auth/native/start")
          ? {
              payloadVersion: 1,
              authRequestId: "auth-1",
              pollToken: "poll-1",
              loginUrl: "https://api.example.com/api/auth/native/login?requestId=auth-1&state=state-1",
              expiresAt: "2026-06-02T12:00:00.000Z",
              pollIntervalMs: 1500,
              correlationId: JSON.parse(String(init.body)).correlationId
            }
          : {
              payloadVersion: 1,
              status: "authenticated",
              accessToken: "jwt-token",
              expiresAt: "2026-06-02T12:15:00.000Z",
              user: {
                userId: "user-1",
                tenantId: "tenant-1",
                email: "accountant@example.test",
                displayName: "Accountant",
                role: "accountant"
              },
              correlationId: JSON.parse(String(init.body)).correlationId
            }
    }));
    const fetcher = fetcherMock as unknown as typeof fetch;

    await expect(startNativeBrowserAuth("https://api.example.com", fetcher)).resolves.toMatchObject({
      authRequestId: "auth-1",
      pollToken: "poll-1"
    });
    await expect(startNativeBrowserAuth("https://api.example.com", fetcher, "register")).resolves.toMatchObject({
      authRequestId: "auth-1",
      pollToken: "poll-1"
    });
    await expect(
      pollNativeBrowserAuth(
        {
          payloadVersion: 1,
          authRequestId: "auth-1",
          pollToken: "poll-1",
          correlationId: "corr-auth-1"
        },
        "https://api.example.com",
        fetcher
      )
    ).resolves.toMatchObject({
      status: "authenticated",
      accessToken: "jwt-token"
    });
    expect(fetcherMock).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/native/start",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetcherMock.mock.calls[1]?.[1]?.body))).toMatchObject({ preferredMode: "register" });
    expect(fetcherMock).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/native/poll",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sends bearer token when fetching current auth session", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionId: "session-1",
        expiresAt: "2026-06-02T12:15:00.000Z",
        user: {
          userId: "user-1",
          tenantId: "tenant-1",
          email: "accountant@example.test",
          displayName: "Accountant",
          role: "accountant"
        }
      })
    })) as unknown as typeof fetch;

    await expect(fetchNativeAuthMe("jwt-token", "https://api.example.com", fetcher)).resolves.toMatchObject({
      sessionId: "session-1"
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/me",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer jwt-token" })
      })
    );
  });

  it("returns redacted API errors without echoing response bodies", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ token: "secret" })
    })) as unknown as typeof fetch;

    await expect(createDraftWorkflow("https://api.example.com", fetcher)).rejects.toThrow(
      "Backend request /api/drafts failed with status 503."
    );
  });

  it("preserves safe backend auth error codes without exposing raw response bodies", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        code: "authRequestNotFound",
        message: "Native auth request was not found.",
        token: "secret"
      })
    })) as unknown as typeof fetch;

    await expect(
      pollNativeBrowserAuth(
        {
          payloadVersion: 1,
          authRequestId: "auth-1",
          pollToken: "poll-1",
          correlationId: "corr-auth-1"
        },
        "https://api.example.com",
        fetcher
      )
    ).rejects.toMatchObject({
      code: "authRequestNotFound",
      message: "Backend request /api/auth/native/poll failed with status 404.",
      status: 404
    } satisfies Partial<BackendRequestError>);
  });
});

function mappedDocumentFixture(): MappedDocument {
  return {
    row: {
      id: "uploaded-selected",
      fileName: "selected.pdf",
      documentType: "УПД",
      supplier: "ООО Ромашка",
      date: "28.05.2026",
      amount: "148 920,40 ₽",
      status: "Требует проверки",
      readiness: 82,
      issueSummary: "требует проверки",
      issueTone: "warning"
    },
    preview: {
      title: "selected.pdf",
      pageLabel: "Страница 1",
      documentType: "УПД",
      supplier: "ООО Ромашка"
    },
    fields: [
      reviewField("document-type", "Тип документа", "УПД", "high", "confirmed"),
      reviewField("number", "Номер", "4512", "high", "confirmed"),
      reviewField("date", "Дата", "28.05.2026", "high", "confirmed"),
      reviewField("supplier", "Поставщик", "ООО Ромашка", "high", "confirmed"),
      reviewField("tax-id", "ИНН / КПП", "7708123456 / 770801001", "high", "confirmed"),
      reviewField("total-amount", "Сумма", "148 920,40 ₽", "high", "confirmed"),
      reviewField("vat", "НДС", "24 820,07 ₽", "medium", "pending")
    ],
    warnings: [
      {
        id: "unit-conversion-missing",
        tone: "critical",
        title: "Единица измерения отличается",
        description: "Коэффициент пересчета не найден.",
        resolutionStatus: "open"
      }
    ],
    nomenclatureLines: [],
    auditEvents: [],
    counterpartyResolution: demoCounterpartyResolution(),
    nomenclatureResolution: demoNomenclatureResolution()
  };
}

function reviewField(
  id: string,
  label: string,
  value: string,
  confidence: "high" | "medium" | "low",
  confirmationStatus: "pending" | "confirmed" | "rejected"
) {
  return {
    id,
    label,
    value,
    confidence,
    confirmationStatus,
    required: true
  };
}
