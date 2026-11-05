/** Destination for reporter output, such as `process.stderr`. */
// FIXME: Rename this to ReportingOutputSink
export interface OutputSink {
  /** Writes `text` as-is. Returns `true` on success and `false` on failure. */
  write(text: string): boolean;
}
