import { describe, expect, it } from "vitest";
import { agentNames, agents } from "../../../src/agents/registry.js";

describe("agent registry", () => {
  it("derives the accepted names from the registry keys", () => {
    expect(agentNames()).toEqual(Object.keys(agents));
    for (const [key, adapter] of Object.entries(agents)) expect(adapter.name).toBe(key);
  });
});
