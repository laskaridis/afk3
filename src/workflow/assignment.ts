/** What a verification session must verify. Every value is passed through verbatim; the harness never reads it. */
export interface VerificationAssignment {
  /** The task the coding session reported. */
  taskId: string;
  /** The task plan file the coding session reported. */
  taskPlanFile: string;
  /** The candidate's commit identifier, when the coding session reported one. */
  revision?: string | null;
}

/** What a correction iteration must fix. Every value is passed through verbatim; the harness never reads it. */
export interface CorrectionAssignment {
  /** The task whose candidate was rejected. */
  taskId: string;
  /** The task plan file the verification session reported. */
  taskPlanFile: string;
  /** The verification agent's notes on the rejection. */
  findingsFile: string;
  /** The verifier's summary of what it found. */
  failureSummary: string;
}
