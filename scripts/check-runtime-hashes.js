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
  console.warn(`No hash record for engineVersion ${ENGINE_VERSION}; treating this as a version update.`);
  process.exit(0);
}

const node20Record = versionRecord.runtimes.find((runtime) => runtime.node.startsWith("v20."));
if (!node20Record) {
  throw new Error(`No Node 20 hash record for engineVersion ${ENGINE_VERSION}`);
}

let mismatchCount = 0;
for (let index = 0; index < inputNames.length; index += 1) {
  const name = inputNames[index];
  const actual = runSimulation({
    lines: INPUTS[name],
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
  }).stateHash;
  const expected = node20Record.stateHashes[name];
  const matches = actual === expected;
  console.log(`${name}: expected=${expected} actual=${actual} ${matches ? "MATCH" : "MISMATCH"}`);
  if (!matches) mismatchCount += 1;
}

if (mismatchCount > 0) {
  throw new Error(`${mismatchCount} hash mismatch(es) with unchanged engineVersion ${ENGINE_VERSION}`);
}
