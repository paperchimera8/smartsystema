import { describe, expect, it } from "vitest";
import type { CounterpartyResolutionRequest } from "@automator/contracts";
import {
  normalizeCounterpartyName,
  resolveCounterpartyCandidates,
  trigramDiceSimilarity
} from "./counterparty-fuzzy.js";

function request(
  overrides: Partial<CounterpartyResolutionRequest> = {}
): CounterpartyResolutionRequest {
  return {
    payloadVersion: 1,
    tenantId: "tenant-1",
    metadataSnapshotId: "metadata-1",
    documentId: "document-1",
    draftId: "draft-1",
    correlationId: "corr-1",
    extracted: {
      rawName: "OOO Romashka",
      inn: "7701234567",
      kpp: "770101001"
    },
    candidates: [
      {
        candidateId: "candidate-1",
        displayName: "Romashka LLC",
        inn: "7701234567",
        kpp: "770101001"
      },
      {
        candidateId: "candidate-2",
        displayName: "Very Similar Romashka",
        inn: "7800000000",
        kpp: "780001001"
      }
    ],
    ...overrides
  };
}

describe("counterparty fuzzy resolver", () => {
  it("ranks exact INN and KPP match first", () => {
    const result = resolveCounterpartyCandidates(request());

    expect(result.candidates[0]?.candidateId).toBe("candidate-1");
    expect(result.candidates[0]?.score).toBe(0.98);
    expect(result.candidates[0]?.requiresReview).toBe(false);
    expect(result.requiresReview).toBe(false);
  });

  it("fails closed for unsupported payload versions", () => {
    const invalidRequest = {
      ...request(),
      payloadVersion: 2
    } as unknown as CounterpartyResolutionRequest;

    const result = resolveCounterpartyCandidates(invalidRequest);

    expect(result.candidates).toEqual([]);
    expect(result.requiresReview).toBe(true);
  });

  it("ranks exact INN above stronger fuzzy-name-only candidate", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka Trading",
          inn: "7701234567"
        },
        candidates: [
          {
            candidateId: "name-only",
            displayName: "Romashka Trading",
            inn: "7800000000"
          },
          {
            candidateId: "inn-match",
            displayName: "Different Legal Name",
            inn: "7701234567"
          }
        ]
      })
    );

    expect(result.candidates[0]?.candidateId).toBe("inn-match");
    expect(result.candidates[0]?.score).toBe(0.9);
  });

  it("requires review when exact INN has a severe legal-name conflict", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Northwind Manufacturing",
          inn: "7701234567",
          kpp: "770101001"
        },
        candidates: [
          {
            candidateId: "identifier-match-name-conflict",
            displayName: "Contoso Retail",
            inn: "7701234567",
            kpp: "770101001"
          }
        ]
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.98);
    expect(candidate?.requiresReview).toBe(true);
    expect(candidate?.warnings.some((warning) => warning.code === "identifier-name-conflict")).toBe(
      true
    );
    expect(result.requiresReview).toBe(true);
  });

  it("normalizes common legal forms before fuzzy matching", () => {
    const normalizedLeft = normalizeCounterpartyName("OOO Romashka");
    const normalizedRight = normalizeCounterpartyName("Romashka LLC");

    expect(normalizedLeft).toBe("romashka");
    expect(normalizedRight).toBe("romashka");
    expect(trigramDiceSimilarity(normalizedLeft, normalizedRight)).toBe(1);
  });

  it("normalizes names idempotently for generated samples", () => {
    for (const sample of [
      "OOO Romashka",
      "  Romashka, LLC  ",
      "\"Romashka\" JSC",
      "Pao North Wind",
      "IP Solo Trader"
    ]) {
      const normalized = normalizeCounterpartyName(sample);

      expect(normalizeCounterpartyName(normalized)).toBe(normalized);
    }
  });

  it("keeps trigram similarity symmetric and bounded for generated pairs", () => {
    const pairs: Array<readonly [string, string]> = [
      ["romashka", "romashka"],
      ["romashka", "romashka trading"],
      ["northwind", "contoso"],
      ["", "romashka"],
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

  it("caps INN mismatch score and requires review", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka",
          inn: "7701234567"
        },
        candidates: [
          {
            candidateId: "conflict",
            displayName: "Romashka",
            inn: "7800000000"
          }
        ]
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.4);
    expect(candidate?.requiresReview).toBe(true);
    expect(candidate?.warnings[0]?.code).toBe("inn-mismatch");
    expect(result.requiresReview).toBe(true);
  });

  it("does not let invalid short identifiers become exact matches", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka",
          inn: "123",
          kpp: "45"
        },
        candidates: [
          {
            candidateId: "invalid-identifiers",
            displayName: "Romashka",
            inn: "123",
            kpp: "45"
          }
        ]
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.82);
    expect(candidate?.signals.some((signal) => signal.code === "inn-exact")).toBe(false);
    expect(
      candidate?.warnings.some((warning) => warning.code === "invalid-extracted-identifier")
    ).toBe(true);
    expect(
      candidate?.warnings.some((warning) => warning.code === "invalid-candidate-identifier")
    ).toBe(true);
    expect(candidate?.requiresReview).toBe(true);
  });

  it("does not allow options to weaken automatic-review safety thresholds", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka"
        },
        candidates: [
          {
            candidateId: "name-only",
            displayName: "Romashka"
          }
        ],
        options: {
          autoAcceptThreshold: 0,
          nameOnlyScoreCap: 1,
          identifierMismatchScoreCap: 1
        }
      })
    );
    const candidate = result.candidates[0];

    expect(candidate?.score).toBe(0.82);
    expect(candidate?.requiresReview).toBe(true);
    expect(result.requiresReview).toBe(true);
  });

  it("does not allow options to raise the identifier conflict score cap", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka",
          inn: "7701234567"
        },
        candidates: [
          {
            candidateId: "conflict",
            displayName: "Romashka",
            inn: "7800000000"
          }
        ],
        options: {
          identifierMismatchScoreCap: 1
        }
      })
    );

    expect(result.candidates[0]?.score).toBe(0.4);
  });

  it("returns low similarity candidates but requires review", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Northwind"
        },
        candidates: [
          {
            candidateId: "low",
            displayName: "Contoso"
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
    const result = resolveCounterpartyCandidates(request({ candidates: [] }));

    expect(result.candidates).toEqual([]);
    expect(result.requiresReview).toBe(true);
  });

  it("bounds maxCandidates while preserving deterministic ordering", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka"
        },
        candidates: [
          { candidateId: "c", displayName: "Romashka" },
          { candidateId: "b", displayName: "Romashka" },
          { candidateId: "a", displayName: "Romashka" }
        ],
        options: {
          maxCandidates: 2
        }
      })
    );

    expect(result.candidates.map((candidate) => candidate.candidateId)).toEqual(["a", "b"]);
  });

  it("sorts tied candidates deterministically", () => {
    const result = resolveCounterpartyCandidates(
      request({
        extracted: {
          rawName: "Romashka"
        },
        candidates: [
          { candidateId: "b", displayName: "Romashka" },
          { candidateId: "a", displayName: "Romashka" }
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
      const result = resolveCounterpartyCandidates(
        request({
          extracted: {
            rawName: secretMarker,
            inn: "7701234567"
          },
          candidates: [
            {
              candidateId: "candidate-1",
              displayName: secretMarker,
              inn: "7701234567"
            }
          ]
        })
      );
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(secretMarker);
    }
  });
});
