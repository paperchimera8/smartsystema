import { describe, expect, it } from "vitest";
import {
  NOMENCLATURE_RESOLUTION_PAYLOAD_VERSION,
  type NomenclatureMatchCandidate,
  type NomenclatureResolutionRequest,
  type NomenclatureResolutionResult
} from "./index";

describe("nomenclature resolution contracts", () => {
  it("accepts request and result shapes", () => {
    const request = {
      payloadVersion: NOMENCLATURE_RESOLUTION_PAYLOAD_VERSION,
      tenantId: "tenant-1",
      metadataSnapshotId: "metadata-1",
      documentId: "document-1",
      draftId: "draft-1",
      correlationId: "corr-1",
      extracted: {
        rawName: "Premium flour 1 kg",
        vendorCode: "FL-100",
        sku: "SKU-100",
        barcode: "4601234567890",
        unit: "kg",
        supplierCounterpartyId: "counterparty-1",
        supplierItemCode: "SUP-FL-100",
        sourceLineId: "line-1",
        extractionConfidence: 0.91
      },
      candidates: [
        {
          candidateId: "nomenclature-1",
          displayName: "Premium flour 1kg",
          vendorCode: "FL100",
          sku: "SKU100",
          barcode: "4601234567890",
          unit: "kilogram",
          metadataSnapshotId: "metadata-1",
          sourceResourceName: "Catalog_Nomenclature",
          supplierAliases: [
            {
              counterpartyId: "counterparty-1",
              displayName: "Supplier flour",
              supplierItemCode: "SUP-FL-100"
            }
          ]
        }
      ],
      options: {
        autoAcceptThreshold: 0.9,
        maxCandidates: 5
      }
    } satisfies NomenclatureResolutionRequest;

    const candidate = {
      entityType: "nomenclature",
      candidateId: "nomenclature-1",
      displayName: "Premium flour 1kg",
      score: 0.99,
      matchReasons: ["Barcode matched exactly."],
      signals: [
        { code: "barcode-exact", score: 0.99 },
        { code: "unit-compatible", score: 1 }
      ],
      warnings: [],
      requiresReview: false
    } satisfies NomenclatureMatchCandidate;

    const result = {
      entityType: "nomenclature",
      tenantId: request.tenantId,
      metadataSnapshotId: request.metadataSnapshotId,
      correlationId: request.correlationId,
      sourceLineId: request.extracted.sourceLineId,
      candidates: [candidate],
      requiresReview: false
    } satisfies NomenclatureResolutionResult;

    expect(result.candidates[0]?.signals[0]?.code).toBe("barcode-exact");
  });

  it("accepts warning and signal variants", () => {
    const candidate = {
      entityType: "nomenclature",
      candidateId: "nomenclature-2",
      displayName: "Different product",
      score: 0.65,
      matchReasons: ["Candidate score was capped by a unit mismatch."],
      signals: [
        { code: "name-fuzzy", score: 0.78 },
        { code: "unit-mismatch", score: 0.65 }
      ],
      warnings: [
        {
          code: "unit-mismatch",
          severity: "severe",
          message: "Extracted unit is not compatible with candidate unit."
        },
        {
          code: "supplier-context-only",
          severity: "severe",
          message: "Supplier-specific code matched without enough independent support."
        },
        {
          code: "invalid-extracted-identifier",
          severity: "warning",
          message: "Extracted barcode has an invalid length after normalization."
        },
        {
          code: "invalid-candidate-identifier",
          severity: "warning",
          message: "Candidate barcode has an invalid length after normalization."
        }
      ],
      requiresReview: true
    } satisfies NomenclatureMatchCandidate;

    expect(candidate.requiresReview).toBe(true);
    expect(candidate.warnings[0]?.severity).toBe("severe");
  });
});
