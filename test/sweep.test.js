import assert from "node:assert/strict";
import test from "node:test";

import { parseGridDocument, runSweep, runsPerPoint, serializeCsv } from "../scripts/sweep.js";

test("multi-dimensional grid preserves declared Cartesian order", () => {
  const points = parseGridDocument({
    parameters: [
      { name: "capacity", values: [65_536, 131_072] },
      { name: "edgeFluxMax", values: [32_768, 65_536] },
    ],
  });
  assert.deepEqual(points, [
    { capacity: 65_536, edgeFluxMax: 32_768 },
    { capacity: 65_536, edgeFluxMax: 65_536 },
    { capacity: 131_072, edgeFluxMax: 32_768 },
    { capacity: 131_072, edgeFluxMax: 65_536 },
  ]);
});

test("sweep grid accepts corridorBlocksOutOfField only as a boolean", () => {
  assert.deepEqual(parseGridDocument({ points: [{ corridorBlocksOutOfField: true, corridorWidth: 2 }] }), [
    { corridorBlocksOutOfField: true, corridorWidth: 2 },
  ]);
  assert.throws(
    () => parseGridDocument({ points: [{ corridorBlocksOutOfField: 1 }] }),
    /must be a boolean/,
  );
});

test("modes have fixed counts and workers 1 and 4 agree", async () => {
  const points = [{ capacity: 65_536 }];
  const sequential = await runSweep({ points, mode: "A", workers: 1 });
  const parallel = await runSweep({ points, mode: "A", workers: 4 });

  assert.equal(runsPerPoint("A"), 3);
  assert.equal(runsPerPoint("B"), 13);
  assert.equal(runsPerPoint("C"), 33);
  assert.deepEqual(parallel, sequential);
  assert.match(serializeCsv(sequential), /criterion3Median10TwiceBasisPoints\n/);
  const csv = serializeCsv([{ ...sequential[0], measurements: {
    gapThroughput: { central: 1, detour: 2 },
    sourceDistance: { densityMax: 3, densityMaxExSource: 4 },
    timeline: [{ step: 1 }],
    lineDistanceDensity: [1],
    lineDistanceCells: [1],
    lineDistanceUnreachable: 0,
    lineDistanceUnreachableCells: 0,
  } }]);
  assert.match(csv, /measurement\.gapThroughput\.central/);
  assert.match(csv, /measurement\.gapThroughput\.detour/);
  assert.match(csv, /measurement\.sourceDistance\.densityMax/);
  assert.doesNotMatch(csv, /timeline/);
  assert.doesNotMatch(csv, /lineDistance/);
  assert.doesNotMatch(csv, /\[object Object\]/);
  assert.ok(serializeCsv(sequential).split("\n").slice(1, -1).every((row) => row.endsWith(",,,")));
  assert.ok(parallel.every((result) => /^[0-9a-f]{8}$/.test(result.stateHash)));
});
