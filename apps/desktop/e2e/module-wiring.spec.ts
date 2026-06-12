import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const sampleDocumentPath = fileURLToPath(
  new URL("../public/sample-documents/automator-sample-upd-4512-romashka.pdf", import.meta.url)
);

test.describe("desktop module wiring", () => {
  test("shows primary screens and simplified settings without console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await prepareAuth(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Войдите в СмартСистему" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Настройки" })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await completeAuthentication(page);

    await expect(page.getByRole("heading", { name: "Документы" })).toBeVisible();
    await expect(page.getByText("Нет аккаунта?")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toHaveCount(0);
    await expect(page.locator(".registration-door-button")).toHaveCount(0);
    await expect(page.getByText("UPD_4512_Romashka.pdf")).toHaveCount(0);
    await uploadSampleDocument(page);

    await page.getByRole("button", { name: "Проверка" }).click();
    await expect(page.getByRole("heading", { name: "Проверка документа" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Отправить в 1С" })).toBeDisabled();
    await expect(page.getByText("0 из 7 полей подтверждено")).toBeVisible();
    await page.getByRole("button", { name: "Подтвердить поле Тип документа" }).click();
    await expect(page.getByText("1 из 7 полей подтверждено")).toBeVisible();
    await expect(page.getByText("Базовый поиск контрагентов")).toBeVisible();
    await expect(page.getByText("Базовый поиск номенклатуры")).toBeVisible();
    await expect(page.getByText("Похожий документ уже был загружен")).toHaveCount(0);
    await expect(page.getByText(/дубл/i)).toHaveCount(0);

    await expect(page.locator(".nav-list").getByRole("button")).toHaveCount(4);

    await page.getByRole("button", { name: "Настройки" }).click();
    await expect(page.getByRole("heading", { name: "Подключение к 1С" })).toBeVisible();
    await expect(page.getByText("не настроено")).toBeVisible();
    await expect(page.getByLabel("Способ подключения")).toBeVisible();
    await expect(page.getByLabel("OData-ссылка")).toBeVisible();
    await expect(page.getByText("Как подключиться")).toBeVisible();
    await expect(page.getByText("Только непроведённые черновики после проверки")).toBeVisible();
    await page.getByLabel("Способ подключения").selectOption("odata");
    await page.getByLabel("OData-ссылка").fill("https://tenant.example/odata");
    await expect(page.getByText("адрес указан")).toBeVisible();
    await page.getByLabel("OData-ссылка").fill("https://user:password@tenant.example/odata");
    await expect(page.getByText("уберите секреты")).toBeVisible();
    await expect(page.getByText("Последняя синхронизация")).toHaveCount(0);
    await expect(page.getByText("Доступная запись")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Проверить подключение" })).toHaveCount(0);
    await expect(page.getByText("EPF preflight показан в demo")).toHaveCount(0);
    await expect(page.getByText("Команды backend → desktop")).toHaveCount(0);
    await expect(page.getByText("Команд в очереди")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Обновить статус команд" })).toHaveCount(0);
    await expect(page.getByText("Контур модулей")).toHaveCount(0);
    await expect(page.getByText("Правила сопоставления")).toHaveCount(0);
    await expect(page.getByText("Безопасность")).toHaveCount(0);
    await expect(page.getByText("Agent Command Bus")).toHaveCount(0);

    await page.getByRole("button", { name: "Журнал" }).click();
    await expect(page.getByRole("heading", { name: "Журнал действий" })).toBeVisible();
    await expect(page.getByText("УПД №4512").first()).toBeVisible();
    await expect(page.getByText("ООО Ромашка").first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("calls backend draft endpoint from confirmed send action", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const calledEndpoints: string[] = [];

    await page.route("http://127.0.0.1:43170/api/drafts", async (route) => {
      calledEndpoints.push("/drafts");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          draftId: "draft-e2e",
          tenantId: "tenant-demo",
          documentId: "document-demo-upd-4512",
          metadataSnapshotId: "metadata-demo",
          lifecycleStatus: "needs_review",
          approvalStatus: "pending",
          writeStatus: "not_requested",
          requiresAccountantApproval: true,
          idempotencyReplay: false,
          createdAt: "2026-05-31T12:00:00.000Z",
          correlationId: "ui-draft-demo"
        })
      });
    });
    await authenticate(page);
    await uploadSampleDocument(page);
    await page.getByRole("button", { name: "Проверка" }).click();
    await expect(page.getByRole("button", { name: "Сохранить как черновик" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Показать пакет записи" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "На ручную проверку" })).toHaveCount(0);
    await confirmAllReviewFields(page);
    await resolveAllReviewWarnings(page);
    await page.getByRole("button", { name: "Отправить в 1С" }).click();
    await page.getByRole("button", { name: "Подтвердить отправку" }).click();
    await expect(page.getByText("Отправка смоделирована")).toBeVisible();
    await expect(page.getByText("Отправлен в 1С")).toBeVisible();

    expect(calledEndpoints).toEqual(["/drafts"]);
    expect(errors).toEqual([]);
  });

  test("keeps document table status, readiness, and check columns separated", async ({ page }) => {
    await authenticate(page);
    await uploadSampleDocument(page);

    await expect(page.getByRole("heading", { name: "Очередь обработки" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Требуют ручного действия" })).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "automator-sample-upd-4512-romashka.pdf" });
    const statusBox = await row.getByText("Требует проверки").boundingBox();
    const readinessBox = await row.getByLabel("Готовность 82%").boundingBox();
    const checkBox = await row.getByText("7 полей не подтверждены").boundingBox();

    expect(statusBox).not.toBeNull();
    expect(readinessBox).not.toBeNull();
    expect(checkBox).not.toBeNull();

    expect(statusBox!.x + statusBox!.width).toBeLessThan(readinessBox!.x);
    expect(readinessBox!.x + readinessBox!.width).toBeLessThan(checkBox!.x);
  });
});

async function prepareAuth(page: Page) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await page.addInitScript(() => {
    window.open = () => window;
  });
  await page.route("http://127.0.0.1:43170/api/auth/native/start", async (route) => {
    const body = route.request().postDataJSON() as { correlationId?: string; preferredMode?: string };
    const mode = body.preferredMode === "register" ? "register" : "login";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        payloadVersion: 1,
        authRequestId: "auth-e2e",
        pollToken: "poll-e2e",
        loginUrl: `http://127.0.0.1:43170/api/auth/native/login?requestId=auth-e2e&state=state-e2e&mode=${mode}`,
        expiresAt,
        pollIntervalMs: 0,
        correlationId: body.correlationId ?? "auth-e2e"
      })
    });
  });
  await page.route("http://127.0.0.1:43170/api/auth/native/poll", async (route) => {
    const body = route.request().postDataJSON() as { correlationId?: string };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        payloadVersion: 1,
        status: "authenticated",
        accessToken: "jwt-e2e",
        expiresAt,
        user: {
          userId: "user-e2e",
          tenantId: "tenant-e2e",
          email: "accountant@example.test",
          displayName: "Accountant",
          role: "accountant"
        },
        correlationId: body.correlationId ?? "auth-e2e"
      })
    });
  });
  await page.route("http://127.0.0.1:43170/api/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "session-e2e",
        expiresAt,
        user: {
          userId: "user-e2e",
          tenantId: "tenant-e2e",
          email: "accountant@example.test",
          displayName: "Accountant",
          role: "accountant"
        }
      })
    });
  });
}

async function authenticate(page: Page) {
  await prepareAuth(page);
  await page.goto("/");
  await completeAuthentication(page);
}

async function completeAuthentication(page: Page) {
  await page.getByRole("button", { name: "Войти через браузер" }).click();
  await expect(page.getByRole("heading", { name: "Документы" })).toBeVisible();
}

async function uploadSampleDocument(page: Page) {
  await page.route("**/api/documents/upload", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
  await page.locator('input[type="file"]').setInputFiles(sampleDocumentPath);
  await expect(page.getByText("automator-sample-upd-4512-romashka.pdf").first()).toBeVisible();
}

async function confirmAllReviewFields(page: Page) {
  for (const label of ["Тип документа", "Номер", "Дата", "Поставщик", "ИНН / КПП", "Сумма", "НДС"]) {
    await page.getByRole("button", { name: `Подтвердить поле ${label}` }).click();
  }
}

async function resolveAllReviewWarnings(page: Page) {
  for (const title of [
    "Номенклатура требует подтверждения",
    "Единица измерения отличается",
    "НДС отличается на 0,02 ₽"
  ]) {
    await page.getByRole("button", { name: `Подтвердить пункт ${title}` }).click();
  }
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}
