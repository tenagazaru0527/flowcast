import { readFileSync } from "node:fs";

import { runSimulation } from "../src/simulation.js";
import {
  DEFAULT_SEED,
  ENGINE_VERSION,
  INPUTS,
  SINK,
  SOURCE,
} from "../src/scenarios.js";

const inputNames = ["straight", "distributed", "detour"];
const hashRecords = JSON.parse(readFileSync(new URL("../runtime-hashes.json", import.meta.url), "utf8"));
const versionRecord = hashRecords.records.find((record) => record.engineVersion === ENGINE_VERSION);

if (!versionRecord) {
  console.error(
    `engineVersion ${ENGINE_VERSION} のハッシュ記録が runtime-hashes.json にありません。\n` +
    "バージョンを更新した場合は、同じコミットで記録を追加してください。",
  );
  process.exit(1);
}

const currentMajor = process.version.match(/^v(\d+)\./)[1];

let runtimeRecord = versionRecord.runtimes.find(
  (runtime) => runtime.node.startsWith(`v${currentMajor}.`),
);
let comparisonNote;

if (runtimeRecord) {
  comparisonNote = `${runtimeRecord.node} の記録と比較（同一メジャー）`;
} else {
  runtimeRecord = versionRecord.runtimes[0];
  if (!runtimeRecord) {
    console.error(`engineVersion ${ENGINE_VERSION} に処理系の記録が1件もありません。`);
    process.exit(1);
  }
  comparisonNote =
    `${runtimeRecord.node} の記録と比較（実行中の ${process.version} は未記録。処理系間一致を検証）`;
}

console.log(`比較対象: ${comparisonNote}`);

let mismatchCount = 0;
for (let index = 0; index < inputNames.length; index += 1) {
  const name = inputNames[index];
  const actual = runSimulation({
    lines: INPUTS[name],
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
  }).stateHash;
  const expected = runtimeRecord.stateHashes[name];
  const matches = actual === expected;
  console.log(`${name}: expected=${expected} actual=${actual} ${matches ? "MATCH" : "MISMATCH"}`);
  if (!matches) mismatchCount += 1;
}

if (mismatchCount > 0) {
  throw new Error(`${mismatchCount} hash mismatch(es) with unchanged engineVersion ${ENGINE_VERSION}`);
}
