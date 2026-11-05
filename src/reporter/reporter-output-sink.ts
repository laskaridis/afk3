/** Destination for reporter output, such as `process.stderr`. */
export interface ReporterOutputSink {
  /** Writes `text` as-is. Returns `true` on success and `false` on failure. */
  write(text: string): boolean;
}
