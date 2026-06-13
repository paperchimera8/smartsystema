import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { SAMPLE_DOCUMENT_FILE_NAME } from "./sample-document";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

const mockedInvoke = vi.mocked(invoke);
const authUser = {
  userId: "user-test",
  tenantId: "tenant-test",
  email: "accountant@example.test",
  displayName: "Accountant",
  role: "accountant" as const
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

function mockAuthenticatedApi(apiBaseUrl = "https://api.example.test") {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/auth/native/start")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { correlationId?: string; preferredMode?: string };
      const mode = body.preferredMode === "register" ? "register" : "login";

      return jsonResponse({
        payloadVersion: 1,
        authRequestId: "auth-test",
        pollToken: "poll-test-token",
        loginUrl: `https://api.example.test/api/auth/native/login?requestId=auth-test&state=state-test&mode=${mode}`,
        expiresAt,
        pollIntervalMs: 0,
        correlationId: body.correlationId ?? "auth-test"
      });
    }

    if (url.endsWith("/auth/native/poll")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { correlationId?: string };

      return jsonResponse({
        payloadVersion: 1,
        status: "authenticated",
        accessToken: "jwt-test-token",
        expiresAt,
        user: authUser,
        correlationId: body.correlationId ?? "auth-test"
      });
    }

    if (url.endsWith("/auth/me")) {
      return jsonResponse({
        user: authUser,
        sessionId: "session-test",
        expiresAt
      });
    }

    if (url.endsWith("/drafts")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { correlationId?: string; documentId?: string; tenantId?: string };

      return jsonResponse({
        draftId: "draft-api-test",
        tenantId: body.tenantId ?? "tenant-test",
        documentId: body.documentId ?? "document-test",
        metadataSnapshotId: "metadata-demo",
        lifecycleStatus: "needs_review",
        approvalStatus: "pending",
        writeStatus: "not_requested",
        requiresAccountantApproval: true,
        idempotencyReplay: false,
        createdAt: new Date().toISOString(),
        correlationId: body.correlationId ?? "draft-test"
      });
    }

    return jsonResponse({ error: "not mocked" }, 503);
  });

  vi.stubEnv("VITE_API_BASE_URL", apiBaseUrl);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "open").mockReturnValue({} as Window);

  return fetchMock;
}

async function renderAuthenticatedApp() {
  const fetchMock = mockAuthenticatedApi();

  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "Войти через браузер" }));
  await screen.findByRole("heading", { name: "Документы" });
  vi.stubEnv("VITE_API_BASE_URL", "");

  return fetchMock;
}

async function uploadSampleDocument() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;

  if (input === null) {
    throw new Error("File input was not rendered.");
  }

  await userEvent.upload(
    input,
    new File(["sample pdf bytes"], SAMPLE_DOCUMENT_FILE_NAME, { type: "application/pdf" })
  );
  await screen.findAllByText(SAMPLE_DOCUMENT_FILE_NAME);
}

async function confirmAllReviewFields() {
  for (const label of ["Тип документа", "Номер", "Дата", "Поставщик", "ИНН / КПП", "Сумма", "НДС"]) {
    const button = screen.queryByRole("button", { name: `Подтвердить поле ${label}` });

    if (button) {
      await userEvent.click(button);
    }
  }
}

async function resolveAllReviewWarnings() {
  for (const title of [
    "Номенклатура требует подтверждения",
    "Единица измерения отличается",
    "НДС отличается на 0,02 ₽"
  ]) {
    const button = screen.queryByRole("button", { name: `Подтвердить пункт ${title}` });

    if (button) {
      await userEvent.click(button);
    }
  }
}

describe("App module wiring", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    window.localStorage.clear();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("blocks the workspace until the user is authenticated", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Войдите в СмартСистему" })).toBeTruthy();
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.queryByText("Документы в 1С")).toBeNull();
    expect(screen.queryByLabelText("Адрес backend API")).toBeNull();
    expect(screen.queryByText("Можно указать локальный или self-hosted backend. Логины, пароли и токены в URL запрещены.")).toBeNull();
    expect(screen.getByRole("button", { name: "Войти через браузер" })).toBeTruthy();
    expect(screen.getByText("Нет аккаунта?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Зарегистрироваться" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Документы" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Настройки" })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("uses the API endpoint baked into the build", async () => {
    const fetchMock = mockAuthenticatedApi();

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    await screen.findByRole("heading", { name: "Документы" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/auth/native/start",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses the SmartSistema cloud API when the build has no endpoint override", async () => {
    const fetchMock = mockAuthenticatedApi("https://api.smartsystema.online/api");
    vi.stubEnv("VITE_API_BASE_URL", "");

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Войти через браузер" }));
    await screen.findByRole("heading", { name: "Документы" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.smartsystema.online/api/auth/native/start",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses a local self-hosted API endpoint from configuration", async () => {
    const fetchMock = mockAuthenticatedApi("http://127.0.0.1:8080/api");

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Войти через браузер" }));
    await screen.findByRole("heading", { name: "Документы" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/api/auth/native/start",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows a useful network error when the backend API is unreachable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_API_BASE_URL", "http://192.168.1.10:8082/api");

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));

    expect(await screen.findByText(/Не удалось подключиться к облачному backend API/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Документы" })).toBeNull();
  });

  it("shows a localized auth error when the native browser request is stale", async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/auth/native/start")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { correlationId?: string };

        return jsonResponse({
          payloadVersion: 1,
          authRequestId: "auth-stale",
          pollToken: "poll-stale-token",
          loginUrl: "https://api.example.test/api/auth/native/login?requestId=auth-stale&state=state-stale&mode=register",
          expiresAt,
          pollIntervalMs: 0,
          correlationId: body.correlationId ?? "auth-stale"
        });
      }

      if (url.endsWith("/auth/native/poll")) {
        return jsonResponse(
          {
            code: "authRequestNotFound",
            message: "Native auth request was not found.",
            retryable: false,
            remediation: "Start sign-in again."
          },
          404
        );
      }

      return jsonResponse({ error: "not mocked" }, 503);
    });

    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "open").mockReturnValue({} as Window);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));

    expect(await screen.findByText("Ссылка для входа устарела или уже использована. Запустите вход или регистрацию ещё раз.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Войдите в СмартСистему" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Документы" })).toBeNull();
  });

  it("focuses the Tauri window after native browser authentication succeeds", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {}
    });
    mockedInvoke.mockResolvedValue(undefined);
    mockAuthenticatedApi();

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Войти через браузер" }));
    await screen.findByRole("heading", { name: "Документы" });

    expect(mockedInvoke).toHaveBeenCalledWith("open_external_auth_url", {
      url: expect.stringContaining("/auth/native/login")
    });
    expect(mockedInvoke).toHaveBeenCalledWith("focus_main_window");
  });

  it("shows only the 1C connection card in settings", async () => {
    await renderAuthenticatedApp();
    expect(document.querySelector(".registration-door-button")).toBeNull();
    expect(screen.queryByText("Нет аккаунта?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Зарегистрироваться" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Настройки" }));

    expect(document.querySelectorAll(".nav-list .nav-item")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Подключение к 1С" })).toBeTruthy();
    expect(screen.getByText("не настроено")).toBeTruthy();
    expect(screen.getByLabelText("Способ подключения")).toBeTruthy();
    expect(screen.getByLabelText("OData-ссылка")).toBeTruthy();
    expect(screen.getByText("Как подключиться")).toBeTruthy();
    expect(screen.getByText("Только непроведённые черновики после проверки")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Способ подключения"), "odata");
    await userEvent.type(screen.getByLabelText("OData-ссылка"), "https://tenant.example/odata");
    expect(screen.getByText("адрес указан")).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("OData-ссылка"));
    await userEvent.type(screen.getByLabelText("OData-ссылка"), "https://user:password@tenant.example/odata");
    expect(screen.getByText("уберите секреты")).toBeTruthy();
    expect(document.querySelectorAll(".settings-grid > .content-card")).toHaveLength(1);
    expect(screen.queryByText("Последняя синхронизация")).toBeNull();
    expect(screen.queryByText("Доступная запись")).toBeNull();
    expect(screen.queryByRole("button", { name: "Проверить подключение" })).toBeNull();
    expect(screen.queryByText("EPF preflight показан в demo")).toBeNull();
    expect(screen.queryByText("Команды backend → desktop")).toBeNull();
    expect(screen.queryByText("Команд в очереди")).toBeNull();
    expect(screen.queryByRole("button", { name: "Обновить статус команд" })).toBeNull();
    expect(screen.queryByText("Контур модулей")).toBeNull();
    expect(screen.queryByText("Правила сопоставления")).toBeNull();
    expect(screen.queryByText("Безопасность")).toBeNull();
    expect(screen.queryByText("Agent Command Bus")).toBeNull();
  });

  it("keeps send-to-1C disabled when critical review issues exist", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(true);
    expect(screen.getByText("0 из 7 полей подтверждено")).toBeTruthy();
    expect(screen.getByText("7 полей ожидают решения.")).toBeTruthy();
    expect(screen.getByText("Базовый поиск контрагентов")).toBeTruthy();
    expect(screen.getByText("Базовый поиск номенклатуры")).toBeTruthy();
  });

  it("requires explicit accountant decisions for mapped fields", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));

    expect(screen.getByText("0 из 7 полей подтверждено")).toBeTruthy();
    expect(screen.getAllByText("не подтверждено").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Подтвердить поле Тип документа" }));

    expect(screen.getByText("1 из 7 полей подтверждено")).toBeTruthy();
    expect(screen.getByText("6 полей ожидают решения.")).toBeTruthy();
    expect(screen.getByText("подтверждено бухгалтером")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Не подтверждать поле НДС" }));

    expect(screen.getByText("1 из 7 полей подтверждено")).toBeTruthy();
    expect(screen.getByText("5 полей ожидают решения, 1 поле отклонено.")).toBeTruthy();
    expect(screen.getByText("отклонено бухгалтером")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(true);
  });

  it("hides removed document actions", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));

    expect(screen.queryByRole("button", { name: "Сохранить как черновик" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Показать пакет записи" })).toBeNull();
    expect(screen.queryByRole("button", { name: "На ручную проверку" })).toBeNull();
    expect(screen.getByRole("button", { name: "Отправить в 1С" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отклонить" })).toBeTruthy();
  });

  it("keeps send blocked until all fields and review items are confirmed", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(true);

    await confirmAllReviewFields();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(true);

    await resolveAllReviewWarnings();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(false);
  });

  it("simulates safe send only after all fields and review items are confirmed", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(true);

    await confirmAllReviewFields();
    await resolveAllReviewWarnings();

    expect(screen.getByText("Критичных ошибок нет, можно отправить в 1С как черновик.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Отправить в 1С" }));
    expect(screen.getByText("Будет создан непроведённый черновик в 1С. В MVP реальная запись не выполняется без безопасного executor.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить отправку" }));

    expect(await screen.findByText("Отправка смоделирована")).toBeTruthy();
    expect(screen.getByText("Отправлен в 1С")).toBeTruthy();
  });

  it("rejects the document locally and records an audit event", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));
    await userEvent.click(screen.getByRole("button", { name: "Отклонить" }));

    expect(screen.getByText("Документ отклонён")).toBeTruthy();
    expect(screen.getByText("Отклонён")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить в 1С" }).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Журнал" }));
    expect(screen.getByText("Отклонил документ")).toBeTruthy();
  });

  it("calls Tauri write package command during confirmed send when bridge is available", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {}
    });
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "plan_write_package") {
        return { targetKind: "local-json-export", operation: "create" };
      }

      return {};
    });

    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));
    await confirmAllReviewFields();
    await resolveAllReviewWarnings();
    await userEvent.click(screen.getByRole("button", { name: "Отправить в 1С" }));
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить отправку" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("plan_write_package", expect.any(Object));
    });
  });

  it("starts without example documents and maps the uploaded sample document", async () => {
    await renderAuthenticatedApp();

    expect(screen.getByRole("heading", { name: "Очередь обработки" })).toBeTruthy();
    expect(screen.getByText("В очереди обработки сейчас нет документов.")).toBeTruthy();
    expect(screen.queryByText("UPD_4512_Romashka.pdf")).toBeNull();
    expect(screen.queryByText("Invoice_8421.png")).toBeNull();

    await uploadSampleDocument();

    expect((await screen.findAllByText(SAMPLE_DOCUMENT_FILE_NAME)).length).toBeGreaterThan(0);
    expect(screen.getByText("ООО Ромашка")).toBeTruthy();
    expect(screen.getByText("148 920,40 ₽")).toBeTruthy();
    expect(screen.getByText("7 полей не подтверждены")).toBeTruthy();
    expect(screen.queryByText("Дубль")).toBeNull();
    expect(screen.queryByText("похожий документ найден")).toBeNull();
  });

  it("does not show duplicate-detection review warnings", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Проверка" }));

    expect(screen.getByText("Единица измерения отличается")).toBeTruthy();
    expect(screen.queryByText("Похожий документ уже был загружен")).toBeNull();
    expect(screen.queryByText(/дубл/i)).toBeNull();
  });

  it("shows expanded audit document context", async () => {
    await renderAuthenticatedApp();
    await uploadSampleDocument();
    await userEvent.click(screen.getByRole("button", { name: "Журнал" }));

    expect(screen.getAllByText("УПД №4512").length).toBeGreaterThan(0);
    expect(screen.getAllByText("28.05.2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ООО Ромашка").length).toBeGreaterThan(0);
  });
});
