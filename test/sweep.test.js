import assert from "node:assert/strict";
import test from "node:test";

import { parseGridDocument, runSweep } from "../scripts/sweep.js";

test("multi-dimensional grid preserves declared Cartesian order", () => {
  const points = parseGridDocument({
    parameters: [
      { name: "steps", values: [12, 24] },
      { name: "capacity", values: [65_536, 131_072] },
    ],
  });
  assert.deepEqual(points, [
    { steps: 12, capacity: 65_536 },
    { steps: 12, capacity: 131_072 },
    { steps: 24, capacity: 65_536 },
    { steps: 24, capacity: 131_072 },
  ]);
});

test("workers 1 and 4 return identical ordered results", async () => {
  const points = [{ steps: 24 }, { steps: 32 }, { steps: 40 }, { steps: 48 }];
  const sequential = await runSweep({ points, inputNames: ["straight"], workers: 1 });
  const parallel = await runSweep({ points, inputNames: ["straight"], workers: 4 });

  assert.deepEqual(parallel, sequential);
  assert.deepEqual(parallel.map((result) => result.pointIndex), [0, 1, 2, 3]);
  assert.ok(parallel.every((result) => /^[0-9a-f]{8}$/.test(result.stateHash)));
});
