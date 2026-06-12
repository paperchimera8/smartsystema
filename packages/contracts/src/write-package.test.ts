import { describe, expect, it } from "vitest";
import {
  WRITE_PACKAGE_PAYLOAD_VERSION,
  type LocalJsonExportArtifact,
  type ODataRequestArtifact,
  type WritePackagePlan,
  type WritePackagePlanError,
  type WritePackageRequest
} from "./index";

const sampleRequest = {
  payloadVersion: WRITE_PACKAGE_PAYLOAD_VERSION,
  targetKind: "fresh-odata",
  operation: "create",
  document: {
    draftId: "draft-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-hash-1",
    resourceName: "Document_PurchaseInvoice",
    approvalStatus: "approved",
    validationStatus: "passed",
    fields: [
      { name: "Number", value: "INV-1" },
      { name: "Date", value: "2026-05-28T10:00:00Z" }
    ],
    references: [
      {
        name: "Counterparty",
        fieldName: "Counterparty_Key",
        targetResourceName: "Catalog_Counterparties",
        targetKey: "41aa6331-954f-11e3-814b-005056c00008"
      }
    ],
    idempotencyKey: "idem-1",
    correlationId: "corr-1"
  },
  metadataObject: {
    name: "PurchaseInvoice",
    resourceName: "Document_PurchaseInvoice",
    fields: [
      {
        name: "Number",
        typeName: "Edm.String",
        nullable: false,
        isKey: false,
        isReference: false
      },
      {
        name: "Date",
        typeName: "Edm.DateTimeOffset",
        nullable: false,
        isKey: false,
        isReference: false
      },
      {
        name: "Counterparty_Key",
        typeName: "StandardODATA.CatalogRef.Counterparties",
        nullable: false,
        isKey: false,
        isReference: true
      }
    ],
    keys: ["Ref_Key"]
  }
} satisfies WritePackageRequest;

describe("write package contracts", () => {
  it("accepts a Fresh OData request artifact shape", () => {
    const artifact = {
      kind: "odata-request",
      method: "POST",
      relativePath: "Document_PurchaseInvoice",
      query: { "$format": "json" },
      headers: {
        accept: "application/json",
        contentType: "application/json"
      },
      body: {
        Counterparty_Key: "41aa6331-954f-11e3-814b-005056c00008",
        Date: "2026-05-28T10:00:00Z",
        Number: "INV-1"
      },
      bodyHash: "hash-1",
      willExecute: false,
      willWriteTo1C: false
    } satisfies ODataRequestArtifact;

    const plan = {
      planId: "write-plan-1",
      targetKind: sampleRequest.targetKind,
      operation: "create",
      draftId: sampleRequest.document.draftId,
      metadataSnapshotId: sampleRequest.document.metadataSnapshotId,
      schemaHash: sampleRequest.document.schemaHash,
      idempotencyKey: sampleRequest.document.idempotencyKey,
      correlationId: sampleRequest.document.correlationId,
      checks: [],
      artifact
    } satisfies WritePackagePlan;

    expect(plan.artifact.kind).toBe("odata-request");
    expect(plan.artifact.willExecute).toBe(false);
  });

  it("accepts a local JSON export artifact shape", () => {
    const artifact = {
      kind: "local-json-export",
      mediaType: "application/json",
      fileName: "draft-1.Document_PurchaseInvoice.json",
      package: {
        formatVersion: 1,
        draftId: sampleRequest.document.draftId,
        metadataSnapshotId: sampleRequest.document.metadataSnapshotId,
        schemaHash: sampleRequest.document.schemaHash,
        resourceName: sampleRequest.document.resourceName,
        operation: "create",
        fields: {
          Date: "2026-05-28T10:00:00Z",
          Number: "INV-1"
        },
        references: sampleRequest.document.references ?? [],
        idempotencyKey: sampleRequest.document.idempotencyKey
      },
      packageHash: "hash-2",
      willWriteFile: false,
      willWriteTo1C: false
    } satisfies LocalJsonExportArtifact;

    expect(artifact.kind).toBe("local-json-export");
    expect(artifact.package.operation).toBe("create");
  });

  it("accepts planner error shapes returned by the Rust module", () => {
    const duplicateFieldError = {
      code: "duplicateField",
      message: "The final document maps more than one value to the same output field.",
      retryable: false,
      remediation: "Resolve duplicate mapping outputs before planning a write package.",
      field: "Counterparty_Key",
      correlationId: sampleRequest.document.correlationId
    } satisfies WritePackagePlanError;

    expect(duplicateFieldError.code).toBe("duplicateField");
    expect(duplicateFieldError.retryable).toBe(false);
  });
});
