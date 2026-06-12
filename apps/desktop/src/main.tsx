import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { initializeBrowserTelemetry } from "./observability/sentry";
import "./styles.css";

initializeBrowserTelemetry();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <main className="auth-gate">
          <section className="auth-gate-card" role="alert">
            <h1>Не удалось открыть СмартСистему</h1>
            <p>Перезапустите приложение. Если ошибка повторится, обратитесь к администратору.</p>
          </section>
        </main>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
