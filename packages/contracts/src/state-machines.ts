/**
 * Formal state machines for all Automator domain entities.
 *
 * Each machine exposes:
 *   - STATES           — exhaustive const array used for runtime checks and DTO validation
 *   - STATE_TRANSITIONS — adjacency map: from-state → allowed to-states
 *   - canTransition     — type-safe guard function
 *   - TERMINAL_STATES  — states with no outgoing transitions
 *   - INITIAL_STATE    — the one valid starting state
 */

import type {
  AgentCommandStatus,
  DraftApprovalStatus,
  DraftLifecycleStatus,
  DraftWriteStatus,
  DocumentExceptionStatus
} from "./index.js";

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S
): boolean {
  const allowed = map[from];
  return allowed !== undefined && (allowed as readonly string[]).includes(to);
}

export function terminalStates<S extends string>(map: TransitionMap<S>): readonly S[] {
  return (Object.keys(map) as S[]).filter((s) => map[s].length === 0);
}

export function reachableFrom<S extends string>(map: TransitionMap<S>, from: S): readonly S[] {
  return map[from] ?? [];
}

// ---------------------------------------------------------------------------
// 1. Document State Machine
//
// Tracks the full lifecycle of a document from first upload through 1C write.
// Lives in frontend/backend contracts — not yet stored as a single DB column
// (the lifecycle is derived from draft + exception state), but defines the
// canonical state vocabulary for UI status labels and routing decisions.
// ---------------------------------------------------------------------------

export const DOCUMENT_STATES = [
  "uploaded",         // file received, pre-OCR
  "ocr_pending",      // queued for OCR worker
  "ocr_processing",   // OCR worker running
  "ocr_failed",       // OCR returned error
  "mapped",           // fields extracted, review not yet started
  "review_pending",   // sent to accountant queue
  "in_review",        // accountant opened the document
  "approved",         // accountant approved, ready for 1C write
  "write_pending",    // write command issued to desktop agent
  "written",          // desktop agent confirmed write
  "rejected",         // accountant or policy rejected
  "exception_queued", // routed to manual / specialist queue
  "completed",        // all done, immutable
  "cancelled"         // explicitly voided
] as const;

export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const DOCUMENT_INITIAL_STATE = "uploaded" as const satisfies DocumentState;

export const DOCUMENT_STATE_TRANSITIONS: TransitionMap<DocumentState> = {
  uploaded:        ["ocr_pending", "cancelled"],
  ocr_pending:     ["ocr_processing", "ocr_failed", "cancelled"],
  ocr_processing:  ["mapped", "ocr_failed"],
  ocr_failed:      ["ocr_pending", "rejected", "cancelled"],
  mapped:          ["review_pending", "exception_queued", "rejected", "cancelled"],
  review_pending:  ["in_review", "exception_queued", "rejected", "cancelled"],
  in_review:       ["approved", "rejected", "exception_queued"],
  approved:        ["write_pending", "rejected"],
  write_pending:   ["written", "approved", "exception_queued"],
  written:         ["completed"],
  rejected:        ["review_pending", "cancelled"],
  exception_queued:["review_pending", "cancelled"],
  completed:       [],
  cancelled:       []
};

export const DOCUMENT_TERMINAL_STATES = terminalStates(DOCUMENT_STATE_TRANSITIONS);

/** Map from DocumentState to the Russian UI label used in the desktop app. */
export const DOCUMENT_STATE_LABELS: Readonly<Record<DocumentState, string>> = {
  uploaded:         "Загружен",
  ocr_pending:      "Ожидает распознавания",
  ocr_processing:   "Распознаётся",
  ocr_failed:       "Ошибка распознавания",
  mapped:           "Поля извлечены",
  review_pending:   "Ожидает проверки",
  in_review:        "На проверке",
  approved:         "Одобрен",
  write_pending:    "Ожидает записи",
  written:          "Записан в 1С",
  rejected:         "Отклонён",
  exception_queued: "В очереди исключений",
  completed:        "Завершён",
  cancelled:        "Отменён"
};

// ---------------------------------------------------------------------------
// 2. Draft Lifecycle State Machine
//
// Mirrors `DraftLifecycleStatus` in the database. The draft is the
// authoritative pre-write representation of a document mapped to 1C fields.
// ---------------------------------------------------------------------------

export const DRAFT_LIFECYCLE_STATES = [
  "created",
  "processing",
  "needs_review",
  "validated",
  "approved",
  "write_pending",
  "written",
  "failed",
  "write_failed",
  "export_required",
  "cancelled"
] as const satisfies readonly DraftLifecycleStatus[];

/**
 * In the current implementation drafts are created after OCR completes, so
 * the effective initial state is "needs_review". The "created" → "processing"
 * path is reserved for when OCR becomes a fully-async pre-draft step.
 */
export const DRAFT_LIFECYCLE_INITIAL_STATE = "needs_review" as const satisfies DraftLifecycleStatus;

export const DRAFT_LIFECYCLE_TRANSITIONS: TransitionMap<DraftLifecycleStatus> = {
  created:         ["processing", "cancelled"],
  processing:      ["needs_review", "failed", "cancelled"],
  needs_review:    ["validated", "failed", "cancelled"],
  validated:       ["approved", "needs_review", "cancelled"],
  approved:        ["write_pending", "needs_review"],
  write_pending:   ["written", "write_failed", "export_required"],
  written:         [],
  failed:          ["needs_review", "cancelled"],
  write_failed:    ["write_pending", "export_required", "cancelled"],
  export_required: ["write_pending", "cancelled"],
  cancelled:       []
};

export const DRAFT_LIFECYCLE_TERMINAL_STATES = terminalStates(DRAFT_LIFECYCLE_TRANSITIONS);

// ---------------------------------------------------------------------------
// 3. Draft Approval State Machine
//
// Tracks the human approval gate on a draft. Orthogonal to lifecycle status.
// ---------------------------------------------------------------------------

export const DRAFT_APPROVAL_STATES = [
  "pending",
  "approved",
  "rejected"
] as const satisfies readonly DraftApprovalStatus[];

export const DRAFT_APPROVAL_INITIAL_STATE = "pending" as const satisfies DraftApprovalStatus;

export const DRAFT_APPROVAL_TRANSITIONS: TransitionMap<DraftApprovalStatus> = {
  pending:  ["approved", "rejected"],
  approved: ["pending"],   // can un-approve to allow correction
  rejected: ["pending"]    // can un-reject for re-review
};

export const DRAFT_APPROVAL_TERMINAL_STATES = terminalStates(DRAFT_APPROVAL_TRANSITIONS);

// ---------------------------------------------------------------------------
// 4. Write Command (DraftWriteStatus) State Machine
//
// Models the 1C write execution pipeline after a draft is approved.
// ---------------------------------------------------------------------------

export const WRITE_STATUS_STATES = [
  "not_requested",
  "planning",
  "queued",
  "running",
  "succeeded",
  "failed",
  "export_required"
] as const satisfies readonly DraftWriteStatus[];

export const WRITE_STATUS_INITIAL_STATE = "not_requested" as const satisfies DraftWriteStatus;

export const WRITE_STATUS_TRANSITIONS: TransitionMap<DraftWriteStatus> = {
  not_requested:   ["planning"],
  planning:        ["queued", "not_requested"],
  queued:          ["running", "not_requested"],
  running:         ["succeeded", "failed", "export_required"],
  succeeded:       [],
  failed:          ["queued", "export_required"],
  export_required: ["queued"]
};

export const WRITE_STATUS_TERMINAL_STATES = terminalStates(WRITE_STATUS_TRANSITIONS);

// ---------------------------------------------------------------------------
// 5. Exception Queue State Machine
//
// Models the lifecycle of a DocumentException from creation through resolution.
// ---------------------------------------------------------------------------

export const EXCEPTION_QUEUE_STATES = [
  "open",
  "in_review",
  "resolved",
  "dismissed"
] as const satisfies readonly DocumentExceptionStatus[];

export const EXCEPTION_QUEUE_INITIAL_STATE = "open" as const satisfies DocumentExceptionStatus;

export const EXCEPTION_QUEUE_TRANSITIONS: TransitionMap<DocumentExceptionStatus> = {
  open:      ["in_review", "resolved", "dismissed"],
  in_review: ["resolved", "open", "dismissed"],
  resolved:  ["open"],     // re-open if resolution was incorrect
  dismissed: []
};

export const EXCEPTION_QUEUE_TERMINAL_STATES = terminalStates(EXCEPTION_QUEUE_TRANSITIONS);

// ---------------------------------------------------------------------------
// 6. Agent Command State Machine
//
// Full lifecycle of a backend → desktop command on the Agent Command Bus.
// ---------------------------------------------------------------------------

export const AGENT_COMMAND_STATE_TRANSITIONS: TransitionMap<AgentCommandStatus> = {
  queued:          ["delivered", "cancelled", "expired"],
  delivered:       [
    "accepted",
    "running",
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "rejected",
    "timed_out",
    "cancelled"
  ],
  accepted:        ["running", "rejected"],
  running:         ["succeeded", "failed_retryable", "failed_terminal", "timed_out"],
  succeeded:       [],
  rejected:        [],
  failed_retryable:["queued"],
  failed_terminal: [],
  timed_out:       ["queued"],
  cancelled:       [],
  expired:         []
};

export const AGENT_COMMAND_INITIAL_STATE = "queued" as const satisfies AgentCommandStatus;
export const AGENT_COMMAND_TERMINAL_STATES = terminalStates(AGENT_COMMAND_STATE_TRANSITIONS);

/** Statuses that count as active (command still in-flight). */
export const AGENT_COMMAND_ACTIVE_STATUSES: readonly AgentCommandStatus[] = [
  "queued",
  "delivered",
  "accepted",
  "running"
];

/** Statuses that represent a final outcome (success or permanent failure). */
export const AGENT_COMMAND_FINAL_STATUSES: readonly AgentCommandStatus[] = [
  "succeeded",
  "rejected",
  "failed_terminal",
  "expired",
  "cancelled"
];
