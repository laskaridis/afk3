/** What a session ended as, classified from process- and adapter-level facts only. */
export type SessionResult =
  | { kind: "launch-failed"; detail: string }
  | { kind: "timed-out" }
  | { kind: "interrupted" }
  | { kind: "exited-unsuccessfully"; detail: string; stderrTail: string[] }
  | { kind: "missing-final-message"; detail: string; stderrTail: string[] }
  | { kind: "invalid-final-message"; detail: string; stderrTail: string[] }
  | { kind: "success"; finalMessage: string; stderrTail: string[] };
