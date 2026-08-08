import { readFileSync } from "node:fs";

import { runSimulation } from "../src/simulation.js";
import {
  DEFAULT_SEED,
  ENGINE_VERSION,
  SCENARIOS,
} from "../src/scenarios.js";

const inputNames = ["straight", "distributed", "detour"];
const hashRecords = JSON.parse(readFileSync(new URL("../runtime-hashes.json", import.meta.url), "utf8"));

const currentMajor = process.version.match(/^v(\d+)\./)[1];

let mismatchCount = 0;
for (let scenarioIndex = 0; scenarioIndex < SCENARIOS.length; scenarioIndex += 1) {
  const scenario = SCENARIOS[scenarioIndex];
  const versionRecord = hashRecords.records.find((record) => (
    record.engineVersion === ENGINE_VERSION && record.scenarioId === scenario.scenarioId
  ));
  if (!versionRecord) {
    console.error(
      `engineVersion ${ENGINE_VERSION} / scenarioId ${scenario.scenarioId} のハッシュ記録がありません。\n` +
      "バージョンまたはシナリオを更新した場合は、同じコミットで記録を追加してください。",
    );
    process.exit(1);
  }

  let runtimeRecord = versionRecord.runtimes.find(
    (runtime) => runtime.node.startsWith(`v${currentMajor}.`),
  );
  let comparisonNote;
  if (runtimeRecord) {
    comparisonNote = `${runtimeRecord.node} の記録と比較（同一メジャー）`;
  } else {
    runtimeRecord = versionRecord.runtimes[0];
    if (!runtimeRecord) {
      console.error(`engineVersion ${ENGINE_VERSION} / scenarioId ${scenario.scenarioId} に処理系の記録がありません。`);
      process.exit(1);
    }
    comparisonNote =
      `${runtimeRecord.node} の記録と比較（実行中の ${process.version} は未記録。処理系間一致を検証）`;
  }

  console.log(`${scenario.scenarioId}: ${comparisonNote}`);
  for (let inputIndex = 0; inputIndex < inputNames.length; inputIndex += 1) {
    const name = inputNames[inputIndex];
    const actual = runSimulation({
      lines: scenario.inputs[name],
      source: scenario.source,
      sink: scenario.sink,
      blocked: scenario.blocked,
      gaps: scenario.gaps,
      seed: DEFAULT_SEED,
    }).stateHash;
    const expected = runtimeRecord.stateHashes[name];
    const matches = actual === expected;
    console.log(`${name}: expected=${expected} actual=${actual} ${matches ? "MATCH" : "MISMATCH"}`);
    if (!matches) mismatchCount += 1;
  }
}

if (mismatchCount > 0) {
  throw new Error(`${mismatchCount} hash mismatch(es) with unchanged engineVersion ${ENGINE_VERSION}`);
}
