import { Worker, type Job } from "bullmq";
import type { DocumentProcessingJob } from "@automator/contracts";
import { extractWithOpenAI } from "./ocr/openai-ocr-adapter.js";
import {
  captureWorkerException,
  closeWorkerTelemetry,
  workerSentryStatus
} from "./observability/sentry.js";

type KnownJobName = "ocr.extract" | "mapping.resolve" | "draft.validate";

function parseOcrConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for ocr.extract jobs.");
  const model = process.env.OPENAI_OCR_MODEL?.trim() || "gpt-4o-mini";
  return { apiKey, model };
}

async function handleOcrExtract(job: Job): Promise<unknown> {
  const data = job.data as DocumentProcessingJob;
  const { imageUrl, documentId } = data;

  if (!imageUrl) {
    return {
      status: "skipped",
      reason: "imageUrl not provided; storage fetch not yet implemented",
      jobId: job.id,
      documentId
    };
  }

  const config = parseOcrConfig();
  const result = await extractWithOpenAI({ documentId, imageUrl }, config);

  return {
    status: "completed",
    jobId: job.id,
    documentId,
    ocrResult: result
  };
}

function parseRedisConnection(rawValue: string | undefined) {
  const raw = rawValue?.trim();

  if (!raw && process.env.NODE_ENV === "production") {
    throw new Error("REDIS_URL must be configured in production.");
  }

  const normalizedRaw = raw || "redis://localhost:6379";
  let url: URL;

  try {
    url = new URL(normalizedRaw);
  } catch {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL.");
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }

  const port = url.port === "" ? 6379 : Number(url.port);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`REDIS_URL contains an invalid port: ${url.port}`);
  }

  return {
    host: url.hostname,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined
  };
}

function parseQueueName(rawValue: string | undefined): string {
  const queueName = rawValue?.trim() || "document-processing";

  if (queueName.length > 120) {
    throw new Error("WORKER_QUEUE must be 120 characters or fewer.");
  }

  return queueName;
}

async function processJob(job: Job) {
  switch (job.name as KnownJobName) {
    case "ocr.extract":
      return handleOcrExtract(job);
    case "mapping.resolve":
    case "draft.validate":
      return {
        status: "accepted",
        jobId: job.id,
        jobName: job.name
      };
    default:
      throw new Error(`Unsupported job type: ${job.name}`);
  }
}

const worker = new Worker(parseQueueName(process.env.WORKER_QUEUE), processJob, {
  connection: parseRedisConnection(process.env.REDIS_URL)
});

worker.on("completed", (job) => {
  logWorkerEvent("info", "job_completed", {
    jobId: job.id ?? "unknown",
    jobName: job.name
  });
});

worker.on("failed", (job, error) => {
  captureWorkerException(error, {
    jobId: job?.id ?? "unknown",
    jobName: job?.name ?? "unknown"
  });
  logWorkerEvent("error", "job_failed", {
    jobId: job?.id ?? "unknown",
    jobName: job?.name ?? "unknown",
    errorMessage: error.message
  });
});

logWorkerEvent("info", "worker_started", {
  queueName: parseQueueName(process.env.WORKER_QUEUE),
  sentryEnabled: String(workerSentryStatus().enabled)
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownWorker(signal);
  });
}

async function shutdownWorker(signal: NodeJS.Signals): Promise<void> {
  logWorkerEvent("info", "worker_shutdown_started", { signal });

  try {
    await worker.close();
    await closeWorkerTelemetry();
    logWorkerEvent("info", "worker_shutdown_completed", { signal });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown shutdown error";
    logWorkerEvent("error", "worker_shutdown_failed", { signal, errorMessage });
    process.exitCode = 1;
  }
}

function logWorkerEvent(
  level: "error" | "info",
  event: string,
  payload: Record<string, string>
) {
  const entry = {
    level,
    event,
    service: "worker",
    timestamp: new Date().toISOString(),
    ...payload
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
