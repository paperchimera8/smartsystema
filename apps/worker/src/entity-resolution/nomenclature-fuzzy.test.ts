import { describe, expect, it } from "vitest";
import type { NomenclatureResolutionRequest } from "@automator/contracts";
import {
  normalizeProductName,
  normalizeUnit,
  resolveNomenclatureCandidates,
  trigramDiceSimilarity
} from "./nomenclature-fuzzy.js";

function request(
  overrides: Partial<NomenclatureResolutionRequest> = {}
): NomenclatureResolutionRequest {
  return {
    payloadVersion: 1,
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
      sourceLineId: "line-1"
    },
    candidates: [
      {
        candidateId: "candidate-1",
        displayName: "Premium flour 1kg",
        vendorCode: "FL100",
        sku: "SKU100",
        barcode: "4601234567890",
        unit: "kilogram"
      },
      {
        candidateId: "candidate-2",
        displayName: "Premium flour 1 kg",
        vendorCode: "DIFFERENT",
        unit: "kg"
      }
    ],
    ...overrides
  };
}

describe("nomenclature fuzzy resolver", () => {
  it("ranks exact barcode match first", () => {
    const result = resolveNomenclatureCandidates(request());

    expect(result.candidates[0]?.candidateId).toBe("candidate-1");
    expect(result.candidates[0]?.score).toBe(0.99);
    expect(result.candidates[0]?.requiresReview).toBe(false);
    expect(result.requiresReview).toBe(false);
  });

  it("fails closed for unsupported payload versions", () => {
    const invalidRequest = {
      ...request(),
      payloadVersion: 2
    } as unknown as NomenclatureResolutionRequest;

    const result = resolveNomenclatureCandidates(invalidRequest);

    expect(result.candidates).toEqual([]);
    expect(result.requiresReview).toBe(true);
  });

  it("ranks exact vendor code above a stronger fuzzy-name-only candidate", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Ultra bolts",
          vendorCode: "AB-42",
          unit: "pcs"
        },
        candidates: [
          {
            candidateId: "name-only",
            displayName: "Ultra bolts",
            unit: "pcs"
          },
          {
            candidateId: "vendor-code",
            displayName: "Different fastener",
            vendorCode: "AB42",
            unit: "pcs"
          }
        ]
      })
    );

    expect(result.candidates[0]?.candidateId).toBe("vendor-code");
    expect(result.candidates[0]?.score).toBe(0.94);
  });

  it("ranks exact SKU above a stronger fuzzy-name-only candidate", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Office chair",
          sku: "CHAIR-10",
          unit: "pcs"
        },
        candidates: [
          {
            candidateId: "name-only",
            displayName: "Office chair",
            unit: "pcs"
          },
          {
            candidateId: "sku",
            displayName: "Workplace seat",
            sku: "CHAIR10",
            unit: "pcs"
          }
        ]
      })
    );

    expect(result.candidates[0]?.candidateId).toBe("sku");
    expect(result.candidates[0]?.score).toBe(0.94);
  });

  it("boosts supplier-specific code above generic code and name candidates", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Supplier cable",
          vendorCode: "GEN-77",
          supplierCounterpartyId: "counterparty-1",
          supplierItemCode: "SUP-77",
          unit: "m"
        },
        candidates: [
          {
            candidateId: "generic-code",
            displayName: "Different cable",
            vendorCode: "GEN77",
            unit: "m"
          },
          {
            candidateId: "supplier-code",
            displayName: "Supplier cable alternate",
            unit: "meter",
            supplierAliases: [
              {
                counterpartyId: "counterparty-1",
                supplierItemCode: "SUP77"
              }
            ]
          },
          {
            candidateId: "name-only",
            displayName: "Supplier cable",
            unit: "m"
          }
        ]
      })
    );

    expect(result.candidates[0]?.candidateId).toBe("supplier-code");
    expect(result.candidates[0]?.score).toBe(0.96);
  });

  it("requires review when supplier-specific code is the only supporting signal", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Printer paper",
          supplierCounterpartyId: "counterparty-1",
          supplierItemCode: "SUP-77"
        },
        candidates: [
          {
            candidateId: "supplier-code-only",
            displayName: "Steel bolt",
            supplierAliases: [
              {
                counterpartyId: "counterparty-1",
                supplierItemCode: "SUP77"
              }
            ]
          }
        ]
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.96);
    expect(candidate?.requiresReview).toBe(true);
    expect(candidate?.warnings.some((warning) => warning.code === "supplier-context-only")).toBe(
      true
    );
    expect(result.requiresReview).toBe(true);
  });

  it("normalizes product names with punctuation, casing, and unit words", () => {
    const normalizedLeft = normalizeProductName("Premium Flour, 1 kilogram");
    const normalizedRight = normalizeProductName("premium flour 1kg");

    expect(normalizedLeft).toBe("premium flour 1 kg");
    expect(normalizedRight).toBe("premium flour 1 kg");
    expect(normalizeUnit("kilograms")).toBe("kg");
    expect(trigramDiceSimilarity(normalizedLeft, normalizedRight)).toBe(1);
  });

  it("normalizes product names idempotently for generated samples", () => {
    for (const sample of [
      "Premium Flour, 1 kilogram",
      "premium flour 1kg",
      "\"Service\" Hour",
      "Box of bolts 10pcs",
      "Cable-25m"
    ]) {
      const normalized = normalizeProductName(sample);

      expect(normalizeProductName(normalized)).toBe(normalized);
    }
  });

  it("keeps trigram similarity symmetric and bounded for generated pairs", () => {
    const pairs: Array<readonly [string, string]> = [
      ["premium flour", "premium flour"],
      ["premium flour", "premium flour 1 kg"],
      ["printer paper", "steel bolt"],
      ["", "printer paper"],
      ["a", "b"]
    ];

    for (const [left, right] of pairs) {
      const forward = trigramDiceSimilarity(left, right);
      const reverse = trigramDiceSimilarity(right, left);

      expect(forward).toBeGreaterThanOrEqual(0);
      expect(forward).toBeLessThanOrEqual(1);
      expect(forward).toBe(reverse);
    }
  });

  it("caps unit mismatch score and requires review", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Premium flour",
          barcode: "4601234567890",
          unit: "kg"
        },
        candidates: [
          {
            candidateId: "wrong-unit",
            displayName: "Premium flour",
            barcode: "4601234567890",
            unit: "pcs"
          }
        ]
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.65);
    expect(candidate?.requiresReview).toBe(true);
    expect(candidate?.warnings[0]?.code).toBe("unit-mismatch");
    expect(result.requiresReview).toBe(true);
  });

  it("does not allow options to weaken automatic-review safety thresholds", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Premium flour"
        },
        candidates: [
          {
            candidateId: "name-only",
            displayName: "Premium flour"
          }
        ],
        options: {
          autoAcceptThreshold: 0,
          nameOnlyScoreCap: 1,
          unitMismatchScoreCap: 1
        }
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.82);
    expect(candidate?.requiresReview).toBe(true);
    expect(result.requiresReview).toBe(true);
  });

  it("does not allow options to raise the unit mismatch score cap", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Premium flour",
          barcode: "4601234567890",
          unit: "kg"
        },
        candidates: [
          {
            candidateId: "wrong-unit",
            displayName: "Premium flour",
            barcode: "4601234567890",
            unit: "pcs"
          }
        ],
        options: {
          unitMismatchScoreCap: 1
        }
      })
    );

    expect(result.candidates[0]?.score).toBe(0.65);
  });

  it("does not let invalid short barcodes become exact matches", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Premium flour",
          barcode: "123",
          unit: "kg"
        },
        candidates: [
          {
            candidateId: "invalid-barcode",
            displayName: "Premium flour",
            barcode: "123",
            unit: "kg"
          }
        ]
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.85);
    expect(candidate?.signals.some((signal) => signal.code === "barcode-exact")).toBe(false);
    expect(
      candidate?.warnings.some((warning) => warning.code === "invalid-extracted-identifier")
    ).toBe(true);
    expect(
      candidate?.warnings.some((warning) => warning.code === "invalid-candidate-identifier")
    ).toBe(true);
    expect(candidate?.requiresReview).toBe(true);
  });

  it("returns low similarity candidates but requires review", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Printer paper"
        },
        candidates: [
          {
            candidateId: "low",
            displayName: "Steel bolt"
          }
        ]
      })
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.requiresReview).toBe(true);
    expect(result.candidates[0]?.warnings.some((warning) => warning.code === "low-name-similarity")).toBe(
      true
    );
  });

  it("returns no candidates and requires review for an empty candidate list", () => {
    const result = resolveNomenclatureCandidates(request({ candidates: [] }));

    expect(result.candidates).toEqual([]);
    expect(result.requiresReview).toBe(true);
  });

  it("bounds maxCandidates while preserving deterministic ordering", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Premium flour"
        },
        candidates: [
          { candidateId: "c", displayName: "Premium flour" },
          { candidateId: "b", displayName: "Premium flour" },
          { candidateId: "a", displayName: "Premium flour" }
        ],
        options: {
          maxCandidates: 2
        }
      })
    );

    expect(result.candidates.map((candidate) => candidate.candidateId)).toEqual(["a", "b"]);
  });

  it("sorts tied candidates deterministically", () => {
    const result = resolveNomenclatureCandidates(
      request({
        extracted: {
          rawName: "Premium flour"
        },
        candidates: [
          { candidateId: "b", displayName: "Premium flour" },
          { candidateId: "a", displayName: "Premium flour" }
        ]
      })
    );

    expect(result.candidates.map((candidate) => candidate.candidateId)).toEqual(["a", "b"]);
  });

  it("does not copy secret-like input values into reasons or warnings", () => {
    for (const secretMarker of [
      "user=alice",
      "usr=alice",
      "pwd=hunter2",
      "password=hunter2",
      "token=secret",
      "access_token=secret",
      "api_key=secret",
      "apikey=secret",
      "authorization: bearer secret",
      "bearer secret",
      "secret=value",
      "connectionString=Server=example",
      "https://alice:secret@example.test/odata"
    ]) {
      const result = resolveNomenclatureCandidates(
        request({
          extracted: {
            rawName: secretMarker,
            vendorCode: "SECRET-1",
            sourceLineId: secretMarker
          },
          candidates: [
            {
              candidateId: "candidate-1",
              displayName: secretMarker
            }
          ]
        })
      );
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(secretMarker);
      expect(serialized).not.toContain("SECRET-1");
    }
  });
});
