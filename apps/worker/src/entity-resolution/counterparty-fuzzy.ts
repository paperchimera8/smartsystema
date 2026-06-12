import type {
  CounterpartyCandidate,
  CounterpartyMatchCandidate,
  CounterpartyMatchSignal,
  CounterpartyMatchWarning,
  CounterpartyResolutionOptions,
  CounterpartyResolutionRequest,
  CounterpartyResolutionResult
} from "@automator/contracts";

type IdentifierState = {
  value: string | undefined;
  invalid: boolean;
};

type NormalizedCounterpartyInput = {
  name: string;
  inn: string | undefined;
  kpp: string | undefined;
  invalidInn: boolean;
  invalidKpp: boolean;
};

type ResolvedOptions = {
  autoAcceptThreshold: number;
  nameOnlyScoreCap: number;
  identifierMismatchScoreCap: number;
  maxCandidates: number;
};

type SeverityRank = 0 | 1 | 2 | 3;

const DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.92;
const DEFAULT_NAME_ONLY_SCORE_CAP = 0.82;
const DEFAULT_IDENTIFIER_MISMATCH_SCORE_CAP = 0.4;
const DEFAULT_MAX_CANDIDATES = 10;
const SUPPORTED_PAYLOAD_VERSION = 1;
const LOW_NAME_SIMILARITY_THRESHOLD = 0.35;
const VALID_INN_LENGTHS = new Set([10, 12]);
const VALID_KPP_LENGTHS = new Set([9]);

const LEGAL_FORM_TOKENS = new Set([
  "ao",
  "cjsc",
  "ip",
  "jsc",
  "llc",
  "ooo",
  "oao",
  "pao",
  "zao"
]);

export function resolveCounterpartyCandidates(
  request: CounterpartyResolutionRequest
): CounterpartyResolutionResult {
  const options = resolveOptions(request.options);
  const extracted = normalizeCounterpartyInput(request.extracted);

  if (
    request.payloadVersion !== SUPPORTED_PAYLOAD_VERSION ||
    request.candidates.length === 0
  ) {
    return {
      entityType: "counterparty",
      tenantId: request.tenantId,
      metadataSnapshotId: request.metadataSnapshotId,
      correlationId: request.correlationId,
      candidates: [],
      requiresReview: true
    };
  }

  const candidates = request.candidates
    .map((candidate) => scoreCandidate(extracted, candidate, options))
    .sort(compareCandidates)
    .slice(0, options.maxCandidates);
  const bestCandidate = candidates[0];

  return {
    entityType: "counterparty",
    tenantId: request.tenantId,
    metadataSnapshotId: request.metadataSnapshotId,
    correlationId: request.correlationId,
    candidates,
    requiresReview:
      bestCandidate === undefined ||
      bestCandidate.requiresReview ||
      bestCandidate.score < options.autoAcceptThreshold
  };
}

export function normalizeCounterpartyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"«»'`]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !LEGAL_FORM_TOKENS.has(token))
    .join(" ")
    .trim();
}

export function normalizeTaxIdentifier(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\D/g, "") ?? "";

  return normalized.length > 0 ? normalized : undefined;
}

export function trigramDiceSimilarity(left: string, right: string): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftTrigrams = trigramCounts(left);
  const rightTrigrams = trigramCounts(right);
  let intersection = 0;

  for (const [trigram, leftCount] of leftTrigrams) {
    intersection += Math.min(leftCount, rightTrigrams.get(trigram) ?? 0);
  }

  const denominator = totalCount(leftTrigrams) + totalCount(rightTrigrams);

  return denominator === 0 ? 0 : roundScore((2 * intersection) / denominator);
}

function scoreCandidate(
  extracted: NormalizedCounterpartyInput,
  candidate: CounterpartyCandidate,
  options: ResolvedOptions
): CounterpartyMatchCandidate {
  const normalizedCandidate = normalizeCandidate(candidate);
  const nameSimilarity = trigramDiceSimilarity(extracted.name, normalizedCandidate.name);
  const innMatch =
    extracted.inn !== undefined &&
    normalizedCandidate.inn !== undefined &&
    extracted.inn === normalizedCandidate.inn;
  const kppMatch =
    extracted.kpp !== undefined &&
    normalizedCandidate.kpp !== undefined &&
    extracted.kpp === normalizedCandidate.kpp;
  const innMismatch =
    extracted.inn !== undefined &&
    normalizedCandidate.inn !== undefined &&
    extracted.inn !== normalizedCandidate.inn;

  const signals: CounterpartyMatchSignal[] = [];
  const warnings: CounterpartyMatchWarning[] = [];
  const matchReasons: string[] = [];

  appendIdentifierFormatWarnings(extracted, normalizedCandidate, warnings);

  // score is always assigned in exactly one of the three branches below.
  let score: number;

  if (innMatch && kppMatch) {
    score = 0.98;
    signals.push({ code: "inn-kpp-exact", score });
    matchReasons.push("INN and KPP matched exactly.");
  } else if (innMatch) {
    score = 0.9;
    signals.push({ code: "inn-exact", score });
    matchReasons.push("INN matched exactly.");

    if (extracted.kpp !== undefined && normalizedCandidate.kpp === undefined) {
      warnings.push({
        code: "missing-candidate-identifier",
        severity: "warning",
        message: "Candidate KPP is missing, so only INN was matched."
      });
    } else if (extracted.kpp !== undefined && !kppMatch) {
      warnings.push({
        code: "kpp-mismatch",
        severity: "warning",
        message: "Extracted KPP does not match candidate KPP."
      });
    }
  } else {
    // Name-only path: cap score to avoid auto-accepting name-only matches.
    score = Math.min(nameSimilarity, options.nameOnlyScoreCap);

    if (nameSimilarity > 0) {
      signals.push({ code: "name-fuzzy", score: nameSimilarity });
      matchReasons.push(`Legal name fuzzy similarity is ${nameSimilarity.toFixed(2)}.`);
    }

    if (innMismatch) {
      score = Math.min(score, options.identifierMismatchScoreCap);
      signals.push({ code: "identifier-conflict", score });
      warnings.push({
        code: "inn-mismatch",
        severity: "severe",
        message: "Extracted INN does not match candidate INN."
      });
      matchReasons.push("Name similarity was capped by identifier conflict.");
    }
  }

  if (
    innMatch &&
    extracted.name.length > 0 &&
    normalizedCandidate.name.length > 0 &&
    nameSimilarity < LOW_NAME_SIMILARITY_THRESHOLD
  ) {
    warnings.push({
      code: "identifier-name-conflict",
      severity: "severe",
      message: "INN matched but legal-name similarity is low."
    });
  }

  if (extracted.name.length === 0) {
    warnings.push({
      code: "missing-extracted-name",
      severity: "warning",
      message: "Extracted counterparty name is empty after normalization."
    });
  } else if (nameSimilarity < LOW_NAME_SIMILARITY_THRESHOLD && !innMatch) {
    warnings.push({
      code: "low-name-similarity",
      severity: "warning",
      message: "Candidate legal name has low fuzzy similarity."
    });
  }

  if (normalizedCandidate.inn === undefined && normalizedCandidate.kpp === undefined) {
    warnings.push({
      code: "missing-candidate-identifier",
      severity: "info",
      message: "Candidate has no INN or KPP available for exact matching."
    });
  }

  return {
    entityType: "counterparty",
    candidateId: candidate.candidateId,
    displayName: safeOutputText(candidate.displayName),
    score: roundScore(score),
    matchReasons: redactedMessages(matchReasons),
    signals: signals.map((signal) => ({
      ...signal,
      score: roundScore(signal.score)
    })),
    warnings,
    requiresReview:
      hasSevereWarning(warnings) ||
      roundScore(score) < options.autoAcceptThreshold
  };
}

function normalizeCounterpartyInput(
  input: CounterpartyResolutionRequest["extracted"]
): NormalizedCounterpartyInput {
  const inn = normalizeIdentifier(input.inn, VALID_INN_LENGTHS);
  const kpp = normalizeIdentifier(input.kpp, VALID_KPP_LENGTHS);

  return {
    name: normalizeCounterpartyName(input.rawName),
    inn: inn.value,
    kpp: kpp.value,
    invalidInn: inn.invalid,
    invalidKpp: kpp.invalid
  };
}

function normalizeCandidate(candidate: CounterpartyCandidate): NormalizedCounterpartyInput {
  const inn = normalizeIdentifier(candidate.inn, VALID_INN_LENGTHS);
  const kpp = normalizeIdentifier(candidate.kpp, VALID_KPP_LENGTHS);

  return {
    name: normalizeCounterpartyName(candidate.displayName),
    inn: inn.value,
    kpp: kpp.value,
    invalidInn: inn.invalid,
    invalidKpp: kpp.invalid
  };
}

function normalizeIdentifier(
  value: string | undefined,
  validLengths: ReadonlySet<number>
): IdentifierState {
  const normalized = normalizeTaxIdentifier(value);

  if (normalized === undefined) {
    return { value: undefined, invalid: false };
  }

  if (validLengths.has(normalized.length)) {
    return { value: normalized, invalid: false };
  }

  return { value: undefined, invalid: true };
}

function appendIdentifierFormatWarnings(
  extracted: NormalizedCounterpartyInput,
  candidate: NormalizedCounterpartyInput,
  warnings: CounterpartyMatchWarning[]
): void {
  if (extracted.invalidInn || extracted.invalidKpp) {
    warnings.push({
      code: "invalid-extracted-identifier",
      severity: "warning",
      message: "Extracted INN or KPP has an invalid length after normalization."
    });
  }

  if (candidate.invalidInn || candidate.invalidKpp) {
    warnings.push({
      code: "invalid-candidate-identifier",
      severity: "warning",
      message: "Candidate INN or KPP has an invalid length after normalization."
    });
  }
}

function resolveOptions(options: CounterpartyResolutionOptions | undefined): ResolvedOptions {
  return {
    autoAcceptThreshold: secureMinimumScore(
      options?.autoAcceptThreshold,
      DEFAULT_AUTO_ACCEPT_THRESHOLD
    ),
    nameOnlyScoreCap: secureMaximumScore(
      options?.nameOnlyScoreCap,
      DEFAULT_NAME_ONLY_SCORE_CAP
    ),
    identifierMismatchScoreCap: secureMaximumScore(
      options?.identifierMismatchScoreCap,
      DEFAULT_IDENTIFIER_MISMATCH_SCORE_CAP
    ),
    maxCandidates: boundedInteger(options?.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, 100)
  };
}

function trigramCounts(value: string): Map<string, number> {
  // Pad with 2 leading and 1 trailing space so single-char inputs still
  // produce boundary-aware trigrams.  padded.length >= 3 always holds.
  const padded = `  ${value} `;
  const counts = new Map<string, number>();

  for (let index = 0; index <= padded.length - 3; index += 1) {
    const trigram = padded.slice(index, index + 3);
    counts.set(trigram, (counts.get(trigram) ?? 0) + 1);
  }

  return counts;
}

function totalCount(counts: Map<string, number>): number {
  let total = 0;

  for (const count of counts.values()) {
    total += count;
  }

  return total;
}

function compareCandidates(
  left: CounterpartyMatchCandidate,
  right: CounterpartyMatchCandidate
): number {
  return (
    right.score - left.score ||
    maxSeverityRank(left.warnings) - maxSeverityRank(right.warnings) ||
    left.displayName.localeCompare(right.displayName, "en") ||
    left.candidateId.localeCompare(right.candidateId, "en")
  );
}

function maxSeverityRank(warnings: CounterpartyMatchWarning[]): SeverityRank {
  return warnings.reduce<SeverityRank>((current, warning) => {
    const rank = severityRank(warning.severity);
    return rank > current ? rank : current;
  }, 0);
}

function severityRank(severity: CounterpartyMatchWarning["severity"]): SeverityRank {
  switch (severity) {
    case "info":
      return 1;
    case "warning":
      return 2;
    case "severe":
      return 3;
  }
}

function hasSevereWarning(warnings: CounterpartyMatchWarning[]): boolean {
  return warnings.some((warning) => warning.severity === "severe");
}

function boundedScore(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 0), 1);
}

function secureMinimumScore(value: number | undefined, minimum: number): number {
  return Math.max(boundedScore(value, minimum), minimum);
}

function secureMaximumScore(value: number | undefined, maximum: number): number {
  return Math.min(boundedScore(value, maximum), maximum);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function redactedMessages(messages: string[]): string[] {
  return messages.map((message) => (containsSecretLikeFragment(message) ? "[redacted]" : message));
}

function safeOutputText(value: string): string {
  return containsSecretLikeFragment(value) ? "[redacted]" : value;
}

function containsSecretLikeFragment(value: string): boolean {
  const lower = value.toLowerCase();

  return (
    lower.includes(";") ||
    lower.includes("://") ||
    lower.includes("authorization:") ||
    lower.includes("bearer ") ||
    lower.includes("api_key") ||
    lower.includes("apikey") ||
    lower.includes("secret=") ||
    lower.includes("usr=") ||
    lower.includes("user=") ||
    lower.includes("password=") ||
    lower.includes("pwd=") ||
    lower.includes("token=") ||
    lower.includes("access_token") ||
    lower.includes("connectionstring=")
  );
}
