import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = join(root, "src");

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const rel = (file: string) => relative(root, file).split("\\").join("/");

/** Every .ts file under src/ as repo-relative path -> content. */
const sources = (): Map<string, string> =>
  new Map(
    listFiles(srcDir)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => [rel(file), readFileSync(file, "utf8")]),
  );

/** Every relative import specifier of a module, resolved to a repo-relative path (extension kept as written). */
const relativeImports = (file: string, content: string): string[] =>
  [...content.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.[^"']*)["']/g)].map((match) =>
    rel(resolve(root, dirname(file), match[1] as string)),
  );

// Higher layers may import lower layers, never the other way round.
const LAYERS = ["src/cli", "src/reporter", "src/workflow", "src/session", "src/agents"];

const layerOf = (path: string): number => {
  const index = LAYERS.findIndex((layer) => path === layer || path.startsWith(`${layer}/`));
  return path === "src/cli.js" ? 0 : index;
};

const importViolations = (files: Map<string, string>): string[] => {
  const problems: string[] = [];
  for (const [file, content] of files) {
    for (const target of relativeImports(file, content)) {
      const from = layerOf(file);
      const to = layerOf(target);
      const edge = `${file} imports ${target}`;
      if (from >= 0 && to >= 0 && to < from) problems.push(`${edge}: upward import`);
      if (file.startsWith("src/reporter/") && !target.startsWith("src/reporter/")) {
        if (!/^src\/workflow\/workflow-(event|observer)\.js$/.test(target)) problems.push(`${edge}: reporter limits`);
      }
      if (file === "src/cli.ts" && !target.startsWith("src/cli/")) problems.push(`${edge}: entry limits`);
      if (!file.startsWith("src/agents/") && target.startsWith("src/agents/")) {
        if (target !== "src/agents/adapter.js" && target !== "src/agents/registry.js") {
          problems.push(`${edge}: agents internals`);
        }
      }
    }
  }
  return problems;
};

const AGENT_KNOWLEDGE = [
  /codex/i,
  /claude/i,
  /--output-last-message/,
  /--approve-for-me/,
  /--permission-mode/,
  /--output-format/,
  /\bis_error\b/,
  /\bsubtype\b/,
];

const agentKnowledgeViolations = (files: Map<string, string>): string[] =>
  [...files]
    .filter(([file]) => !file.startsWith("src/agents/"))
    .flatMap(([file, content]) =>
      AGENT_KNOWLEDGE.filter((pattern) => pattern.test(content)).map((pattern) => `${file} matches ${pattern}`),
    );

describe("architecture guard", () => {
  describe("import direction", () => {
    it("has no upward, reporter, entry or agents-internals import violations", () => {
      expect(importViolations(sources())).toEqual([]);
    });

    it("detects an upward import from session to workflow", () => {
      const files = new Map([["src/session/x.ts", `import { a } from "../workflow/coding-step.js";`]]);
      expect(importViolations(files)).toEqual(["src/session/x.ts imports src/workflow/coding-step.js: upward import"]);
    });

    it("detects reporter, entry and agents-internals violations", () => {
      const files = new Map([
        ["src/reporter/x.ts", `import type { A } from "../session/session-result.js";`],
        ["src/cli.ts", `import { CLI } from "./runner.js";`],
        ["src/cli/y.ts", `import { C } from "../agents/codex.js";`],
      ]);
      expect(importViolations(files)).toEqual([
        "src/reporter/x.ts imports src/session/session-result.js: reporter limits",
        "src/cli.ts imports src/runner.js: entry limits",
        "src/cli/y.ts imports src/agents/codex.js: agents internals",
      ]);
    });

    it("sees dynamic and multi-line imports", () => {
      const content = `import {\n  a,\n} from "../x.js";\nawait import("./y.js");`;
      expect(relativeImports("src/cli/z.ts", content)).toEqual(["src/x.js", "src/cli/y.js"]);
    });
  });

  describe("agent knowledge", () => {
    it("stays inside src/agents/", () => {
      expect(agentKnowledgeViolations(sources())).toEqual([]);
    });

    it("detects an agent flag outside src/agents/", () => {
      const files = new Map([
        ["src/session/x.ts", `const f = "--permission-mode";`],
        ["src/agents/ok.ts", `const f = "--permission-mode";`],
      ]);
      expect(agentKnowledgeViolations(files)).toEqual(["src/session/x.ts matches /--permission-mode/"]);
    });
  });

  describe("old layout", () => {
    it.each(["runner", "session", "protocol", "reporter", "prompt"])("src/%s.ts is gone", (name) => {
      expect(existsSync(join(srcDir, `${name}.ts`))).toBe(false);
    });

    it("src/agents/types.ts is gone", () => {
      expect(existsSync(join(srcDir, "agents/types.ts"))).toBe(false);
    });

    it("no unit test imports a removed module", () => {
      const removed =
        /(?:\/src\/|\.\.\/)(?:runner|session|protocol|reporter|prompt)(?:\.js)?["']|agents\/types(?:\.js)?["']/;
      const offenders = listFiles(join(root, "test/unit"))
        .filter((file) => file.endsWith(".ts") && file !== fileURLToPath(import.meta.url))
        .filter((file) => relativeImports(rel(file), readFileSync(file, "utf8")).some((t) => removed.test(`${t}"`)))
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });
});
