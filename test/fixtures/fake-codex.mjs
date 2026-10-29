#!/usr/bin/env node
// Fake `codex` executable for integration tests. Never talks to a real Codex.
//
// Behavior is scripted per test through the JSON file named by FAKE_CODEX_SCRIPT:
//   { "steps": [ ... ] } where each step is one of
//     { "stdout": "text" } | { "stderr": "text" } | { "sleepMs": n }
//     | { "finalMessage": "text" }  (written to stdout, as codex does for a piped stdout)
//     | { "writeFile": "name" }  (created in the working directory)
//     | { "ignoreSignals": true }  (SIGINT/SIGTERM are recorded but no longer end the process)
//     | { "exit": code }
// SIGINT/SIGTERM are appended to FAKE_CODEX_RECORD + ".signals"; by default SIGINT exits 130.
// Alternatively { "sessions": [[steps], ...] } scripts one step list per invocation
// (by invocation order; the last list repeats once exhausted).
// Every invocation appends a record (argv, cwd, stdin, env) to FAKE_CODEX_RECORD
// as one JSON line, and the record is written before any step runs.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const script = JSON.parse(readFileSync(process.env.FAKE_CODEX_SCRIPT, "utf8"));

let stdin = "";
if (!process.stdin.isTTY) {
  stdin = await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const invocationIndex = readFileSync(process.env.FAKE_CODEX_RECORD, "utf8").split("\n").filter(Boolean).length;
const steps = script.sessions ? script.sessions[Math.min(invocationIndex, script.sessions.length - 1)] : script.steps;

appendFileSync(
  process.env.FAKE_CODEX_RECORD,
  JSON.stringify({ argv, cwd: process.cwd(), stdin, pid: process.pid, files: readdirSync(process.cwd()) }) + "\n",
);

let ignoreSignals = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    appendFileSync(process.env.FAKE_CODEX_RECORD + ".signals", signal + "\n");
    if (!ignoreSignals) process.exit(130);
  });
}

for (const step of steps) {
  if (step.ignoreSignals) ignoreSignals = true;
  if (step.stdout !== undefined) process.stdout.write(step.stdout);
  if (step.stderr !== undefined) process.stderr.write(step.stderr);
  if (step.writeFile !== undefined) writeFileSync(step.writeFile, "x");
  if (step.sleepMs !== undefined) await new Promise((r) => setTimeout(r, step.sleepMs));
  if (step.finalMessage !== undefined) process.stdout.write(step.finalMessage + "\n");
  if (step.exit !== undefined) process.exit(step.exit);
}
