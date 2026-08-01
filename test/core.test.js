import assert from "node:assert/strict";
import test from "node:test";

import { Q, createConfig } from "../src/config.js";
import { divQ, fnv1aInt32, mulQ, XorShift32 } from "../src/fixed-point.js";
import { burnLines } from "../src/lines.js";
import {
  createReplay,
  DEFAULT_SEED,
  INPUTS,
  replayInput,
  SINK,
  SOURCE,
} from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";

test("Q16.16 multiplication and division truncate toward zero", () => {
  assert.equal(mulQ(3 * Q, Q >> 1), Q + (Q >> 1));
  assert.equal(mulQ(-3 * Q, Q >> 1), -(Q + (Q >> 1)));
  assert.equal(divQ(3 * Q, 2 * Q), Q + (Q >> 1));
});

test("xorshift32 is repeatable and has a single 32-bit state", () => {
  const first = new XorShift32(12345);
  const second = new XorShift32(12345);
  for (let index = 0; index < 32; index += 1) {
    assert.equal(first.nextInt32(), second.nextInt32());
  }
});

test("FNV-1a hashes Int32 values in explicit little-endian byte order", () => {
  assert.equal(fnv1aInt32(new Int32Array([0])), 0x4b95f515);
  assert.equal(fnv1aInt32(new Int32Array([0x01020304])), 0x9b35d555);
});

test("line burning emits bounded Int32 guide arrays", () => {
  const config = createConfig();
  const field = burnLines(INPUTS.straight, config);
  assert.ok(field.guideX instanceof Int32Array);
  assert.ok(field.guideY instanceof Int32Array);
  for (let index = 0; index < field.guideX.length; index += 1) {
    assert.ok(field.guideX[index] >= -Q && field.guideX[index] <= Q);
    assert.ok(field.guideY[index] >= -Q && field.guideY[index] <= Q);
  }
});

test("replay data contains only the five portable input fields", () => {
  const replay = createReplay();
  assert.deepEqual(Object.keys(replay).sort(), ["engineVersion", "formatVersion", "lines", "scenarioId", "seed"]);
  const input = replayInput(replay);
  assert.deepEqual(input.lines, INPUTS.straight);
});

test("measurement instrumentation does not affect simulation results", () => {
  const input = {
    lines: INPUTS.straight,
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
  };
  const unmeasured = runSimulation(input);
  const measured = runSimulation({ ...input, measure: true });
  assert.equal(measured.stateHash, unmeasured.stateHash);
  assert.equal(measured.totalCompleted, unmeasured.totalCompleted);
});
