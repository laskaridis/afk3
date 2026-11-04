/** Destination for reporter output, such as `process.stderr`. */
// FIXME: Rename this to ReportingOutputSink
export interface OutputSink {
  /** Writes `text` as-is. The return value is ignored. */
  // FIXME: this function should not return anything
  write(text: string): unknown;
}
