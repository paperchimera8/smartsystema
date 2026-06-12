import type {
  NomenclatureCandidate,
  NomenclatureMatchCandidate,
  NomenclatureMatchSignal,
  NomenclatureMatchWarning,
  NomenclatureResolutionOptions,
  NomenclatureResolutionRequest,
  NomenclatureResolutionResult
} from "@automator/contracts";

const DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.9;
const DEFAULT_NAME_ONLY_SCORE_CAP = 0.82;
const DEFAULT_UNIT_MISMATCH_SCORE_CAP = 0.65;
const DEFAULT_MAX_CANDIDATES = 10;
const SUPPORTED_PAYLOAD_VERSION = 1;
const LOW_NAME_SIMILARITY_THRESHOLD = 0.35;
const UNIT_COMPATIBILITY_BOOST = 0.03;
const UNIT_COMPATIBLE_NAME_CAP = 0.86;
const VALID_BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

const UNIT_ALIASES = new Map([
  ["box", "box"],
  ["boxes", "box"],
  ["carton", "box"],
  ["cartons", "box"],
  ["ea", "pcs"],
  ["each", "pcs"],
  ["g", "g"],
  ["gram", "g"],
  ["grams", "g"],
  ["hour", "hour"],
  ["hours", "hour"],
  ["kg", "kg"],
  ["kgs", "kg"],
  ["kilogram", "kg"],
  ["kilograms", "kg"],
  ["l", "l"],
  ["liter", "l"],
  ["liters", "l"],
  ["litre", "l"],
  ["litres", "l"],
  ["m", "m"],
  ["meter", "m"],
  ["meters", "m"],
  ["metre", "m"],
  ["metres", "m"],
  ["pc", "pcs"],
  ["pcs", "pcs"],
  ["piece", "pcs"],
  ["pieces", "pcs"],
  ["service", "service"],
  ["services", "service"],
  ["svc", "service"],
  ["unit", "pcs"],
  ["units", "pcs"]
]);

type NormalizedNomenclatureInput = {
  name: string;
  vendorCode: string | undefined;
  sku: string | undefined;
  barcode: string | undefined;
  invalidBarcode: boolean;
  unit: string | undefined;
  supplierCounterpartyId: string | undefined;
  supplierItemCode: string | undefined;
};

type NormalizedSupplierAlias = {
  counterpartyId: string;
  supplierItemCode: string | undefined;
  vendorCode: string | undefined;
  sku: string | undefined;
  barcode: string | undefined;
  invalidBarcode: boolean;
};

type NormalizedNomenclatureCandidate = {
  name: string;
  vendorCode: string | undefined;
  sku: string | undefined;
  barcode: string | undefined;
  invalidBarcode: boolean;
  unit: string | undefined;
  supplierAliases: NormalizedSupplierAlias[];
};

type ResolvedOptions = {
  autoAcceptThreshold: number;
  nameOnlyScoreCap: number;
  unitMismatchScoreCap: number;
  maxCandidates: number;
};

type SeverityRank = 0 | 1 | 2 | 3;

type IdentifierMatch = {
  barcode: boolean;
  supplierCode: boolean;
  vendorCode: boolean;
  sku: boolean;
};

type IdentifierState = {
  value: string | undefined;
  invalid: boolean;
};

export function resolveNomenclatureCandidates(
  request: NomenclatureResolutionRequest
): NomenclatureResolutionResult {
  const options = resolveOptions(request.options);
  const extracted = normalizeNomenclatureInput(request.extracted);

  if (request.payloadVersion !== SUPPORTED_PAYLOAD_VERSION || request.candidates.length === 0) {
    return resultEnvelope(request, [], true);
  }

  const candidates = request.candidates
    .map((candidate) => scoreCandidate(extracted, candidate, options))
    .sort(compareCandidates)
    .slice(0, options.maxCandidates);
  const bestCandidate = candidates[0];

  return resultEnvelope(
    request,
    candidates,
    bestCandidate === undefined ||
      bestCandidate.requiresReview ||
      bestCandidate.score < options.autoAcceptThreshold
  );
}

export function normalizeProductName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"«»'`]/g, " ")
    .replace(/(\d)([a-z]+)/g, "$1 $2")
    .replace(/([a-z]+)(\d)/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((token) => normalizeUnitToken(token.trim()))
    .filter((token) => token.length > 0)
    .join(" ")
    .trim();
}

export function normalizeProductCode(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu, "") ?? "";

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeUnit(value: string | undefined): string | undefined {
  // normalizeProductName already applies normalizeUnitToken to each token,
  // so the result is already unit-aliased.  No second pass needed.
  const normalized = normalizeProductName(value ?? "");

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
  extracted: NormalizedNomenclatureInput,
  candidate: NomenclatureCandidate,
  options: ResolvedOptions
): NomenclatureMatchCandidate {
  const normalizedCandidate = normalizeCandidate(candidate);
  const nameSimilarity = trigramDiceSimilarity(extracted.name, normalizedCandidate.name);
  const identifierMatch = matchIdentifiers(extracted, normalizedCandidate);
  const hasExactIdentifierMatch = Object.values(identifierMatch).some(Boolean);
  const unitCompatible =
    extracted.unit !== undefined &&
    normalizedCandidate.unit !== undefined &&
    extracted.unit === normalizedCandidate.unit;
  const unitMismatch =
    extracted.unit !== undefined &&
    normalizedCandidate.unit !== undefined &&
    extracted.unit !== normalizedCandidate.unit;

  const signals: NomenclatureMatchSignal[] = [];
  const warnings: NomenclatureMatchWarning[] = [];
  const matchReasons: string[] = [];

  appendIdentifierFormatWarnings(extracted, normalizedCandidate, warnings);

  // score is always assigned in exactly one of the four branches below.
  let score: number;

  if (identifierMatch.barcode) {
    score = 0.99;
    signals.push({ code: "barcode-exact", score });
    matchReasons.push("Barcode matched exactly.");
  } else if (identifierMatch.supplierCode) {
    score = 0.96;
    signals.push({ code: "supplier-code-exact", score });
    matchReasons.push("Supplier-specific item code matched exactly.");
  } else if (identifierMatch.vendorCode || identifierMatch.sku) {
    score = 0.94;

    if (identifierMatch.vendorCode) {
      signals.push({ code: "vendor-code-exact", score });
      matchReasons.push("Vendor code matched exactly.");
    }

    if (identifierMatch.sku) {
      signals.push({ code: "sku-exact", score });
      matchReasons.push("SKU matched exactly.");
    }
  } else {
    // Name-only path: cap score to prevent auto-accepting name-only matches.
    score = Math.min(nameSimilarity, options.nameOnlyScoreCap);

    if (nameSimilarity > 0) {
      signals.push({ code: "name-fuzzy", score: nameSimilarity });
      matchReasons.push(`Product name fuzzy similarity is ${nameSimilarity.toFixed(2)}.`);
    }
  }

  if (unitCompatible) {
    signals.push({ code: "unit-compatible", score: 1 });

    if (!hasExactIdentifierMatch) {
      score = Math.min(score + UNIT_COMPATIBILITY_BOOST, UNIT_COMPATIBLE_NAME_CAP);
      matchReasons.push("Unit compatibility increased confidence.");
    }
  }

  if (unitMismatch) {
    score = Math.min(score, options.unitMismatchScoreCap);
    signals.push({ code: "unit-mismatch", score });
    warnings.push({
      code: "unit-mismatch",
      severity: "severe",
      message: "Extracted unit is not compatible with candidate unit."
    });
    matchReasons.push("Candidate score was capped by a unit mismatch.");
  }

  if (
    identifierMatch.supplierCode &&
    !identifierMatch.barcode &&
    !identifierMatch.vendorCode &&
    !identifierMatch.sku &&
    !unitCompatible &&
    nameSimilarity < LOW_NAME_SIMILARITY_THRESHOLD
  ) {
    warnings.push({
      code: "supplier-context-only",
      severity: "severe",
      message: "Supplier-specific code matched without enough independent support."
    });
  }

  if (extracted.name.length === 0) {
    warnings.push({
      code: "missing-extracted-name",
      severity: "warning",
      message: "Extracted product name is empty after normalization."
    });
  } else if (nameSimilarity < LOW_NAME_SIMILARITY_THRESHOLD && !hasExactIdentifierMatch) {
    warnings.push({
      code: "low-name-similarity",
      severity: "warning",
      message: "Candidate product name has low fuzzy similarity."
    });
  }

  if (!hasCandidateIdentifier(normalizedCandidate)) {
    warnings.push({
      code: "missing-candidate-identifier",
      severity: "info",
      message: "Candidate has no barcode, vendor code, SKU, or supplier alias available for exact matching."
    });
  }

  const roundedScore = roundScore(score);

  return {
    entityType: "nomenclature",
    candidateId: candidate.candidateId,
    displayName: safeOutputText(candidate.displayName),
    score: roundedScore,
    matchReasons: redactedMessages(matchReasons),
    signals: signals.map((signal) => ({
      ...signal,
      score: roundScore(signal.score)
    })),
    warnings,
    requiresReview: hasSevereWarning(warnings) || roundedScore < options.autoAcceptThreshold
  };
}

function normalizeNomenclatureInput(
  input: NomenclatureResolutionRequest["extracted"]
): NormalizedNomenclatureInput {
  const barcode = normalizeBarcode(input.barcode);

  return {
    name: normalizeProductName(input.rawName),
    vendorCode: normalizeProductCode(input.vendorCode),
    sku: normalizeProductCode(input.sku),
    barcode: barcode.value,
    invalidBarcode: barcode.invalid,
    unit: normalizeUnit(input.unit),
    supplierCounterpartyId: normalizeContextId(input.supplierCounterpartyId),
    supplierItemCode: normalizeProductCode(input.supplierItemCode)
  };
}

function normalizeCandidate(candidate: NomenclatureCandidate): NormalizedNomenclatureCandidate {
  const barcode = normalizeBarcode(candidate.barcode);

  return {
    name: normalizeProductName(candidate.displayName),
    vendorCode: normalizeProductCode(candidate.vendorCode),
    sku: normalizeProductCode(candidate.sku),
    barcode: barcode.value,
    invalidBarcode: barcode.invalid,
    unit: normalizeUnit(candidate.unit),
    supplierAliases: (candidate.supplierAliases ?? []).map((alias) => {
      const aliasBarcode = normalizeBarcode(alias.barcode);

      return {
        counterpartyId: normalizeContextId(alias.counterpartyId) ?? "",
        supplierItemCode: normalizeProductCode(alias.supplierItemCode),
        vendorCode: normalizeProductCode(alias.vendorCode),
        sku: normalizeProductCode(alias.sku),
        barcode: aliasBarcode.value,
        invalidBarcode: aliasBarcode.invalid
      };
    })
  };
}

function normalizeBarcode(value: string | undefined): IdentifierState {
  const normalized = value?.replace(/\D/g, "") ?? "";

  if (normalized.length === 0) {
    return { value: undefined, invalid: false };
  }

  if (VALID_BARCODE_LENGTHS.has(normalized.length)) {
    return { value: normalized, invalid: false };
  }

  return { value: undefined, invalid: true };
}

function appendIdentifierFormatWarnings(
  extracted: NormalizedNomenclatureInput,
  candidate: NormalizedNomenclatureCandidate,
  warnings: NomenclatureMatchWarning[]
): void {
  if (extracted.invalidBarcode) {
    warnings.push({
      code: "invalid-extracted-identifier",
      severity: "warning",
      message: "Extracted barcode has an invalid length after normalization."
    });
  }

  if (candidate.invalidBarcode || candidate.supplierAliases.some((alias) => alias.invalidBarcode)) {
    warnings.push({
      code: "invalid-candidate-identifier",
      severity: "warning",
      message: "Candidate barcode has an invalid length after normalization."
    });
  }
}

function matchIdentifiers(
  extracted: NormalizedNomenclatureInput,
  candidate: NormalizedNomenclatureCandidate
): IdentifierMatch {
  const matchingSupplierAliases = candidate.supplierAliases.filter(
    (alias) =>
      extracted.supplierCounterpartyId !== undefined &&
      alias.counterpartyId.length > 0 &&
      alias.counterpartyId === extracted.supplierCounterpartyId
  );
  const supplierCodeMatch = matchingSupplierAliases.some((alias) =>
    hasOverlap(
      [extracted.supplierItemCode, extracted.vendorCode, extracted.sku],
      [alias.supplierItemCode, alias.vendorCode, alias.sku]
    )
  );
  const aliasBarcodeMatch = matchingSupplierAliases.some((alias) =>
    exactMatch(extracted.barcode, alias.barcode)
  );

  return {
    barcode: exactMatch(extracted.barcode, candidate.barcode) || aliasBarcodeMatch,
    supplierCode: supplierCodeMatch,
    vendorCode: exactMatch(extracted.vendorCode, candidate.vendorCode),
    sku: exactMatch(extracted.sku, candidate.sku)
  };
}

function exactMatch(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left === right;
}

function normalizeContextId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";

  return normalized.length > 0 ? normalized : undefined;
}

function hasOverlap(
  leftValues: Array<string | undefined>,
  rightValues: Array<string | undefined>
): boolean {
  const rightSet = new Set(rightValues.filter((value): value is string => value !== undefined));

  return leftValues.some((value) => value !== undefined && rightSet.has(value));
}

function hasCandidateIdentifier(candidate: NormalizedNomenclatureCandidate): boolean {
  return (
    candidate.barcode !== undefined ||
    candidate.vendorCode !== undefined ||
    candidate.sku !== undefined ||
    candidate.supplierAliases.some(
      (alias) =>
        alias.supplierItemCode !== undefined ||
        alias.vendorCode !== undefined ||
        alias.sku !== undefined ||
        alias.barcode !== undefined
    )
  );
}

function resultEnvelope(
  request: NomenclatureResolutionRequest,
  candidates: NomenclatureMatchCandidate[],
  requiresReview: boolean
): NomenclatureResolutionResult {
  return {
    entityType: "nomenclature",
    tenantId: request.tenantId,
    metadataSnapshotId: request.metadataSnapshotId,
    correlationId: request.correlationId,
    ...(request.extracted.sourceLineId === undefined
      ? {}
      : { sourceLineId: safeOutputText(request.extracted.sourceLineId) }),
    candidates,
    requiresReview
  };
}

function resolveOptions(options: NomenclatureResolutionOptions | undefined): ResolvedOptions {
  return {
    autoAcceptThreshold: secureMinimumScore(
      options?.autoAcceptThreshold,
      DEFAULT_AUTO_ACCEPT_THRESHOLD
    ),
    nameOnlyScoreCap: secureMaximumScore(
      options?.nameOnlyScoreCap,
      DEFAULT_NAME_ONLY_SCORE_CAP
    ),
    unitMismatchScoreCap: secureMaximumScore(
      options?.unitMismatchScoreCap,
      DEFAULT_UNIT_MISMATCH_SCORE_CAP
    ),
    maxCandidates: boundedInteger(options?.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, 100)
  };
}

function normalizeUnitToken(token: string): string {
  return UNIT_ALIASES.get(token) ?? token;
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
  left: NomenclatureMatchCandidate,
  right: NomenclatureMatchCandidate
): number {
  return (
    right.score - left.score ||
    maxSeverityRank(left.warnings) - maxSeverityRank(right.warnings) ||
    left.displayName.localeCompare(right.displayName, "en") ||
    left.candidateId.localeCompare(right.candidateId, "en")
  );
}

function maxSeverityRank(warnings: NomenclatureMatchWarning[]): SeverityRank {
  return warnings.reduce<SeverityRank>((current, warning) => {
    const rank = severityRank(warning.severity);
    return rank > current ? rank : current;
  }, 0);
}

function severityRank(severity: NomenclatureMatchWarning["severity"]): SeverityRank {
  switch (severity) {
    case "info":
      return 1;
    case "warning":
      return 2;
    case "severe":
      return 3;
  }
}

function hasSevereWarning(warnings: NomenclatureMatchWarning[]): boolean {
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
