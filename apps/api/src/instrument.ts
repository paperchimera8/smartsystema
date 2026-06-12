import * as Sentry from "@sentry/nestjs";
import { buildNodeSentryOptions } from "./observability/sentry";

const sentryOptions = buildNodeSentryOptions("api");

if (sentryOptions) {
  Sentry.init(sentryOptions);
}
