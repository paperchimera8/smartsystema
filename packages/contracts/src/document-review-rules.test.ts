import { describe, expect, it } from "vitest";
import { deriveDocumentReviewDecision, type DocumentReviewIssue } from "./index";

describe("document review rules", () => {
  it("marks a clean processed document as ready to send", () => {
    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.96,
      requiredFieldsComplete: true,
      validationPassed: true,
      issues: [
        {
          code: "counterparty_fuzzy_match",
          severity: "warning",
          message: "The accountant already confirmed this candidate.",
          resolved: true
        }
      ]
    });

    expect(decision).toMatchObject({
      status: "ready_to_send",
      readiness: 100,
      confidence: 0.96,
      requiresReview: false,
      canSendToOneC: true,
      activeIssues: []
    });
  });

  it("routes low document confidence to review without critical issues", () => {
    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.78,
      requiredFieldsComplete: true,
      validationPassed: true,
      issues: []
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.readiness).toBe(84);
    expect(decision.requiresReview).toBe(true);
    expect(decision.canSendToOneC).toBe(false);
  });

  it("caps readiness for missing required fields", () => {
    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.97,
      requiredFieldsComplete: false,
      validationPassed: true,
      issues: [
        {
          code: "missing_required_field",
          severity: "critical",
          message: "The document number is missing.",
          field: "number"
        }
      ]
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.readiness).toBe(79);
    expect(decision.activeIssues).toHaveLength(1);
  });

  it("keeps identifier conflicts critical even when confidence is high", () => {
    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.98,
      requiredFieldsComplete: true,
      validationPassed: true,
      issues: [
        {
          code: "counterparty_identifier_conflict",
          severity: "critical",
          message: "Extracted INN does not match the selected counterparty.",
          field: "counterparty"
        }
      ]
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.readiness).toBe(84);
    expect(decision.canSendToOneC).toBe(false);
  });

  it("caps warning-only nomenclature and VAT issues below ready state", () => {
    const issues: DocumentReviewIssue[] = [
      {
        code: "nomenclature_fuzzy_match",
        severity: "warning",
        message: "Nomenclature matched by similar name only.",
        lineId: "line-1",
        score: 0.82
      },
      {
        code: "vat_mismatch",
        severity: "warning",
        message: "VAT differs by a rounding amount.",
        field: "vat"
      }
    ];

    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.93,
      requiredFieldsComplete: true,
      validationPassed: true,
      issues
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.readiness).toBe(93);
    expect(decision.activeIssues.map((issue) => issue.code)).toEqual([
      "nomenclature_fuzzy_match",
      "vat_mismatch"
    ]);
  });

  it("caps unit mismatch and missing conversion coefficient as critical review work", () => {
    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.65,
      requiredFieldsComplete: true,
      validationPassed: true,
      issues: [
        {
          code: "unit_mismatch",
          severity: "critical",
          message: "Supplier unit differs from accounting unit.",
          lineId: "line-1"
        },
        {
          code: "conversion_coefficient_missing",
          severity: "critical",
          message: "No conversion coefficient is configured.",
          lineId: "line-1"
        }
      ]
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.readiness).toBe(70);
    expect(decision.activeIssues).toHaveLength(2);
  });

  it("handles technical failure and processing phases deterministically", () => {
    expect(
      deriveDocumentReviewDecision({
        phase: "uploaded",
        confidence: Number.NaN,
        requiredFieldsComplete: false,
        validationPassed: false
      })
    ).toMatchObject({ status: "uploaded", readiness: 20, confidence: 0 });

    expect(
      deriveDocumentReviewDecision({
        phase: "processing",
        confidence: 0.4,
        requiredFieldsComplete: false,
        validationPassed: false,
        processingReadiness: 120
      })
    ).toMatchObject({ status: "recognizing", readiness: 45 });

    expect(
      deriveDocumentReviewDecision({
        phase: "failed",
        confidence: 0.5,
        requiredFieldsComplete: false,
        validationPassed: false,
        processingReadiness: 88,
        issues: [
          {
            code: "technical_failure",
            severity: "critical",
            message: "OCR provider failed."
          }
        ]
      })
    ).toMatchObject({ status: "error", readiness: 69, requiresReview: true });
  });

  it("ignores removed duplicate and 1C reconciliation legacy issues", () => {
    const decision = deriveDocumentReviewDecision({
      phase: "processed",
      confidence: 0.96,
      requiredFieldsComplete: true,
      validationPassed: true,
      issues: [
        {
          code: "duplicate_suspected",
          severity: "critical",
          message: "Legacy duplicate signal must not affect the decision."
        },
        {
          code: "one_c_reconciliation_mismatch",
          severity: "critical",
          message: "Legacy 1C reconciliation signal must not affect the decision."
        }
      ] as unknown as DocumentReviewIssue[]
    });

    expect(decision.status).toBe("ready_to_send");
    expect(decision.readiness).toBe(100);
    expect(decision.activeIssues).toEqual([]);
  });
});
