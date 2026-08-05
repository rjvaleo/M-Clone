#!/usr/bin/env node
// Every requirement in IDMLAB_TECH_SPEC.md must be cited by a test.
//
// The spec is only worth writing if it is enforced, and the cheapest possible
// enforcement is this: parse the requirement ids out of the spec, scan the test
// suites for citations, and fail on anything uncited. A requirement no test
// mentions is a requirement nobody checked.
//
// Citation is by literal id in a test file — in the test name, in a comment, in
// an attribute. Where the id lands does not matter; that it appears does.
//
// Two reports come out of this:
//   uncited     — defined here, mentioned by no test. The backlog.
//   undefined   — cited by a test, absent from the spec. A typo or a deleted
//                 requirement whose test is now asserting something unwritten.
//
// `--strict` fails on uncited. Without it only `undefined` fails, so the audit
// is useful long before coverage is complete.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SPEC = "IDMLAB_TECH_SPEC.md";
const ID = /R-[A-Z0-9]+-\d+/g;
/** Where tests live. */
const ROOTS = ["src", "rust/dsp-core/src", "rust/wasm"];
const TEST_FILE = /(\.test\.tsx?|\.rs|verify\.mjs)$/;

const strict = process.argv.includes("--strict");

/** Requirement ids, taken from the leading cell of a spec table row. */
function defined() {
  const rows = readFileSync(SPEC, "utf8").split("\n");
  const ids = new Map();
  for (const [index, line] of rows.entries()) {
    const match = /^\|\s*(R-[A-Z0-9]+-\d+)\s*\|/.exec(line);
    if (match) ids.set(match[1], index + 1);
  }
  return ids;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "target" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function cited() {
  const found = new Map();
  for (const root of ROOTS) {
    let entries;
    try {
      entries = [...walk(root)];
    } catch {
      continue; // a root that does not exist yet is not an error
    }
    for (const path of entries) {
      if (!TEST_FILE.test(path)) continue;
      // Rust keeps tests beside the code, so every .rs file is in scope.
      if (extname(path) === ".rs" && !readFileSync(path, "utf8").includes("R-")) continue;
      for (const id of readFileSync(path, "utf8").match(ID) ?? []) {
        (found.get(id) ?? found.set(id, []).get(id)).push(path);
      }
    }
  }
  return found;
}

const spec = defined();
const tests = cited();

const uncited = [...spec.keys()].filter((id) => !tests.has(id));
const undefinedIds = [...tests.keys()].filter((id) => !spec.has(id));

const total = spec.size;
const covered = total - uncited.length;
const percent = total === 0 ? 0 : ((covered / total) * 100).toFixed(1);

console.log(`spec audit — ${covered}/${total} requirements cited (${percent}%)`);

if (undefinedIds.length > 0) {
  console.error(`\n${undefinedIds.length} id(s) cited by tests and absent from ${SPEC}:`);
  for (const id of undefinedIds.sort()) {
    console.error(`  ${id}  ${[...new Set(tests.get(id))].join(", ")}`);
  }
}

if (uncited.length > 0) {
  const byArea = new Map();
  for (const id of uncited) {
    const area = id.slice(0, id.lastIndexOf("-"));
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  const summary = [...byArea.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([area, count]) => `${area}:${count}`)
    .join("  ");
  console.log(`\n${uncited.length} uncited — ${summary}`);
  if (strict) {
    console.error("\nuncited requirements:");
    for (const id of uncited.sort()) console.error(`  ${id}  ${SPEC}:${spec.get(id)}`);
  }
}

const failed = undefinedIds.length > 0 || (strict && uncited.length > 0);
process.exit(failed ? 1 : 0);
