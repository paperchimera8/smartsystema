import { describe, expect, it } from "vitest";
import {
  COUNTERPARTY_RESOLUTION_PAYLOAD_VERSION,
  type CounterpartyMatchCandidate,
  type CounterpartyResolutionRequest,
  type CounterpartyResolutionResult
} from "./index";

describe("counterparty resolution contracts", () => {
  it("accepts request and result shapes", () => {
    const request = {
      payloadVersion: COUNTERPARTY_RESOLUTION_PAYLOAD_VERSION,
      tenantId: "tenant-1",
      metadataSnapshotId: "metadata-1",
      documentId: "document-1",
      draftId: "draft-1",
      correlationId: "corr-1",
      extracted: {
        rawName: "OOO Romashka",
        inn: "7701234567",
        kpp: "770101001",
        sourceField: "supplier",
        extractionConfidence: 0.93
      },
      candidates: [
        {
          candidateId: "counterparty-1",
          displayName: "Romashka LLC",
          inn: "7701234567",
          kpp: "770101001",
          metadataSnapshotId: "metadata-1",
          sourceResourceName: "Catalog_Counterparties"
        }
      ],
      options: {
        autoAcceptThreshold: 0.92,
        maxCandidates: 5
      }
    } satisfies CounterpartyResolutionRequest;

    const candidate = {
      entityType: "counterparty",
      candidateId: "counterparty-1",
      displayName: "Romashka LLC",
      score: 0.98,
      matchReasons: ["INN and KPP matched exactly."],
      signals: [{ code: "inn-kpp-exact", score: 0.98 }],
      warnings: [],
      requiresReview: false
    } satisfies CounterpartyMatchCandidate;

    const result = {
      entityType: "counterparty",
      tenantId: request.tenantId,
      metadataSnapshotId: request.metadataSnapshotId,
      correlationId: request.correlationId,
      candidates: [candidate],
      requiresReview: false
    } satisfies CounterpartyResolutionResult;

    expect(result.candidates[0]?.signals[0]?.code).toBe("inn-kpp-exact");
  });

  it("accepts warning and signal variants", () => {
    const candidate = {
      entityType: "counterparty",
      candidateId: "counterparty-2",
      displayName: "Different Company",
      score: 0.4,
      matchReasons: ["Name similarity was capped by identifier conflict."],
      signals: [
        { code: "name-fuzzy", score: 0.77 },
        { code: "identifier-conflict", score: 0.4 }
      ],
      warnings: [
        {
          code: "inn-mismatch",
          severity: "severe",
          message: "Extracted INN does not match candidate INN."
        },
        {
          code: "identifier-name-conflict",
          severity: "severe",
          message: "INN matched but legal-name similarity is low."
        },
        {
          code: "invalid-extracted-identifier",
          severity: "warning",
          message: "Extracted INN or KPP has an invalid length after normalization."
        },
        {
          code: "invalid-candidate-identifier",
          severity: "warning",
          message: "Candidate INN or KPP has an invalid length after normalization."
        }
      ],
      requiresReview: true
    } satisfies CounterpartyMatchCandidate;

    expect(candidate.requiresReview).toBe(true);
    expect(candidate.warnings[0]?.severity).toBe("severe");
  });
});
