#!/usr/bin/env node
// Fake `claude` executable: the shared fake agent, emitting final messages as Claude's print-mode JSON.
process.env.FAKE_AGENT_FORMAT = "claude";
await import("./fake-codex.mjs");
