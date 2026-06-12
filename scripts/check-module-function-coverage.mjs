import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const lcovFiles = [
  { path: "apps/desktop/coverage/lcov.info", baseDir: "apps/desktop", kind: "ts" },
  { path: "apps/worker/coverage/lcov.info", baseDir: "apps/worker", kind: "ts" },
  { path: "apps/api/coverage/lcov.info", baseDir: "apps/api", kind: "ts" },
  { path: "coverage/rust.lcov", baseDir: ".", kind: "rust" }
];

const tsTargetFiles = new Set(
  [
    "apps/desktop/src/module-workflow.ts",
    "apps/worker/src/entity-resolution/counterparty-fuzzy.ts",
    "apps/worker/src/entity-resolution/nomenclature-fuzzy.ts",
    "apps/api/src/modules/drafts/drafts.controller.ts",
    "apps/api/src/modules/drafts/drafts.service.ts",
    "apps/api/src/modules/drafts/drafts.repository.ts",
    "apps/api/src/modules/drafts/drafts.errors.ts",
    "apps/api/src/modules/document-exceptions/document-exceptions.controller.ts",
    "apps/api/src/modules/document-exceptions/document-exceptions.service.ts",
    "apps/api/src/modules/document-exceptions/document-exceptions.repository.ts",
    "apps/api/src/modules/document-exceptions/document-exceptions.errors.ts"
  ].map((file) => normalizePath(file))
);

const rustTargetFiles = new Set(
  [
    "apps/desktop/src-tauri/src/integrations/epf_runner.rs",
    "apps/desktop/src-tauri/src/integrations/metadata.rs",
    "apps/desktop/src-tauri/src/integrations/write_package.rs",
    "apps/desktop/src-tauri/src/integrations/readiness_report.rs"
  ].map((file) => normalizePath(file))
);

const targetFiles = new Set([...tsTargetFiles, ...rustTargetFiles]);
const records = new Map();

for (const lcovFile of lcovFiles) {
  const absolute = resolve(repoRoot, lcovFile.path);
  const content = readFileSync(absolute, "utf8");

  for (const recordText of content.split("end_of_record")) {
    const record = parseRecord(recordText, lcovFile.baseDir);

    if (record === undefined || !targetFiles.has(record.file)) {
      continue;
    }

    records.set(record.file, record);
  }
}

const missingFiles = [...targetFiles].filter((file) => !records.has(file));
const uncoveredFunctions = [];

for (const [file, record] of records) {
  if (tsTargetFiles.has(file)) {
    if (record.functions.length === 0) {
      uncoveredFunctions.push({ file, name: "<no function records>", line: 0, hits: 0 });
      continue;
    }

    for (const fn of record.functions) {
      if (fn.hits === 0) {
        uncoveredFunctions.push({ file, ...fn });
      }
    }

    continue;
  }

  for (const fn of rustSourceFunctions(file)) {
    if (!rustFunctionHasCoverage(record, fn)) {
      uncoveredFunctions.push({ file, ...fn, hits: 0 });
    }
  }
}

if (missingFiles.length > 0 || uncoveredFunctions.length > 0) {
  for (const file of missingFiles) {
    console.error(`Missing LCOV record for targeted module file: ${file}`);
  }

  for (const fn of uncoveredFunctions) {
    console.error(`Uncovered function: ${fn.file}:${fn.line} ${fn.name}`);
  }

  process.exit(1);
}

console.log(`Module function coverage gate passed for ${targetFiles.size} targeted files.`);

function parseRecord(recordText, baseDir) {
  const lines = recordText.split(/\r?\n/).filter(Boolean);
  const sourceLine = lines.find((line) => line.startsWith("SF:"));

  if (sourceLine === undefined) {
    return undefined;
  }

  const file = normalizePath(sourceLine.slice(3), baseDir);
  const functions = new Map();
  const lineHits = new Map();

  for (const line of lines) {
    if (line.startsWith("FN:")) {
      const [, fnLine, name] = /^FN:(\d+),(.+)$/.exec(line) ?? [];

      if (fnLine !== undefined && name !== undefined) {
        functions.set(name, { line: Number(fnLine), name, hits: 0 });
      }
    }

    if (line.startsWith("FNDA:")) {
      const [, hits, name] = /^FNDA:(\d+),(.+)$/.exec(line) ?? [];
      const existing = name === undefined ? undefined : functions.get(name);

      if (hits !== undefined && existing !== undefined) {
        existing.hits = Number(hits);
      }
    }

    if (line.startsWith("DA:")) {
      const [, sourceLine, hits] = /^DA:(\d+),(\d+)/.exec(line) ?? [];

      if (sourceLine !== undefined && hits !== undefined) {
        lineHits.set(Number(sourceLine), Number(hits));
      }
    }
  }

  return { file, functions: [...functions.values()], lineHits };
}

function rustFunctionHasCoverage(record, fn) {
  for (let line = fn.line; line <= fn.endLine; line += 1) {
    if ((record.lineHits.get(line) ?? 0) > 0) {
      return true;
    }
  }

  return false;
}

function rustSourceFunctions(file) {
  const absolute = resolve(repoRoot, file);
  const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
  const functions = [];
  let productionCode = true;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.includes("#[cfg(test)]")) {
      productionCode = false;
    }

    if (!productionCode) {
      continue;
    }

    const match =
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);

    if (match === null) {
      continue;
    }

    functions.push({
      line: index + 1,
      endLine: rustFunctionEndLine(lines, index),
      name: match[1]
    });
  }

  return functions;
}

function rustFunctionEndLine(lines, startIndex) {
  let depth = 0;
  let sawBody = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    for (const character of lines[index]) {
      if (character === "{") {
        depth += 1;
        sawBody = true;
      }

      if (character === "}") {
        depth -= 1;
      }
    }

    if (sawBody && depth <= 0) {
      return index + 1;
    }
  }

  return startIndex + 1;
}

function normalizePath(input, baseDir = ".") {
  const absolute = input.startsWith("/") ? input : resolve(repoRoot, baseDir, input);
  return relative(repoRoot, absolute).split(sep).join("/");
}
