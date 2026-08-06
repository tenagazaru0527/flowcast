import assert from "node:assert/strict";
import test from "node:test";

import { Q, createConfig } from "../src/config.js";
import { clampVector, divQ, fnv1aInt32, isqrt, mulQ, XorShift32 } from "../src/fixed-point.js";
import { burnLines } from "../src/lines.js";
import {
  createReplay,
  createWideSink,
  createWideSource,
  DEFAULT_SEED,
  INPUTS,
  replayInput,
  SINK,
  SOURCE,
  WIDE_SOURCE,
} from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";

const EDGE_FLUX_SWEEP = [128, 256, 512, 768, 1_024, 1_536, 2_048, 4_096, Q];

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

test("isqrt returns the exact floor square root without 32-bit coercion", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(isqrt), [0, 1, 1, 1, 2]);
  const fixedRoots = [2, 3, 10, Q, 92_681];
  for (let index = 0; index < fixedRoots.length; index += 1) {
    const root = fixedRoots[index];
    assert.equal(isqrt(root * root), root);
    assert.equal(isqrt(root * root - 1), root - 1);
  }
  assert.equal(isqrt(2 * Q * Q), 92_681);
});

test("clampVector applies one symmetric magnitude limit", () => {
  assert.deepEqual(clampVector(Q, Q, Q), [46_341, 46_341]);
  assert.deepEqual(clampVector(-Q, -Q, Q), [-46_341, -46_341]);
  assert.ok(isqrt(46_341 * 46_341 * 2) <= Q);
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

test("default edge flux limit is at least the current theoretical transfer budget", () => {
  const config = createConfig();
  assert.ok(config.edgeFluxMax >= mulQ(config.capacity, config.transferRate));
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
  assert.equal(measured.measurements.fluxLimitedAmount, 0);
  assert.equal(measured.measurements.fluxLimitedEvents, 0);
  assert.equal(measured.measurements.capacityLimitedAmount, 0);
  assert.equal(measured.measurements.sigmaProfile.length, 64);
  assert.ok(measured.measurements.sigmaProfile.every((sigma) => (
    sigma === null || (Number.isInteger(sigma) && sigma >= 0)
  )));
  assert.equal(measured.measurements.sigmaProfile[4], 12_967);
  assert.equal(measured.measurements.sigmaProfile[20], 185_165);
  assert.equal(measured.measurements.coherenceLengthSigma, 19);
  assert.equal(measured.measurements.bandThreshold, 38);
  assert.equal(measured.measurements.bandCells.length, 64);
  assert.equal(measured.measurements.segmentCount.length, 64);
  assert.equal(measured.measurements.meanSegmentWidth.length, 64);
  assert.ok(measured.measurements.meanSegmentWidth.every((width) => (
    width === null || (Number.isInteger(width) && width >= Q)
  )));
  assert.equal(measured.measurements.w0, 3 * Q);
  assert.equal(measured.measurements.coherenceLength, 55);
});

test("single-cell source and sink arrays preserve 0.5.0 hashes", () => {
  const expected = {
    straight: "4910305d",
    distributed: "e63ba5b1",
    detour: "9164f600",
  };
  for (const inputName of Object.keys(expected)) {
    const result = runSimulation({
      lines: INPUTS[inputName],
      source: SOURCE,
      sink: SINK,
      seed: DEFAULT_SEED,
    });
    assert.equal(result.stateHash, expected[inputName], inputName);
  }
});

test("poc-1-wide source width 1 and sink width 1 preserve poc-0-default hashes", () => {
  const expected = {
    straight: "4910305d",
    distributed: "e63ba5b1",
    detour: "9164f600",
  };
  const source = createWideSource(1);
  const sink = createWideSink(1);
  assert.deepEqual(createWideSource(3), [[4, 31], [4, 32], [4, 33]]);
  assert.deepEqual(WIDE_SOURCE, createWideSource(9));
  for (const inputName of Object.keys(expected)) {
    const result = runSimulation({
      lines: INPUTS[inputName],
      source,
      sink,
      seed: DEFAULT_SEED,
    });
    assert.equal(result.stateHash, expected[inputName], inputName);
  }
});

test("source injection is divided in scenario order without changing the total", () => {
  const measured = runSimulation({
    lines: INPUTS.straight,
    source: WIDE_SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
    config: { steps: 1 },
    measure: true,
  });
  assert.equal(measured.measurements.sourceCellCount, 9);
  assert.equal(measured.measurements.sourceExclusionCellCount, 29);
  assert.equal(measured.measurements.injectionBase, 113);
  assert.equal(measured.measurements.injectionRemainder, 7);
  assert.equal(measured.measurements.totalInjected, 1_024);
});

test("empty sigma columns remain undefined", () => {
  const measured = runSimulation({
    lines: INPUTS.straight,
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
    config: { steps: 1 },
    measure: true,
  });

  assert.equal(measured.measurements.sigmaProfile[0], null);
  assert.equal(measured.measurements.w0, null);
  assert.equal(measured.measurements.coherenceLength, null);
  assert.equal(measured.measurements.coherenceLengthSigma, 63);
  assert.equal(measured.measurements.meanSegmentWidth[0], null);
});

test("edge flux diagnostics count only measurement-side suppression", () => {
  const input = {
    lines: INPUTS.straight,
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
    config: { steps: 16, edgeFluxMax: 1 },
  };
  const unmeasured = runSimulation(input);
  const measured = runSimulation({ ...input, measure: true });

  assert.equal(measured.stateHash, unmeasured.stateHash);
  assert.equal(measured.totalCompleted, unmeasured.totalCompleted);
  assert.ok(measured.measurements.fluxLimitedAmount > 0);
  assert.ok(measured.measurements.fluxLimitedEvents > 0);
  assert.equal(measured.measurements.capacityLimitedAmount, 0);
});

test("quantity is conserved for every edge flux sweep point and input", () => {
  const inputNames = ["straight", "distributed", "detour"];
  for (let pointIndex = 0; pointIndex < EDGE_FLUX_SWEEP.length; pointIndex += 1) {
    const edgeFluxMax = EDGE_FLUX_SWEEP[pointIndex];
    for (let inputIndex = 0; inputIndex < inputNames.length; inputIndex += 1) {
      const inputName = inputNames[inputIndex];
      const result = runSimulation({
        lines: INPUTS[inputName],
        source: SOURCE,
        sink: SINK,
        seed: DEFAULT_SEED,
        config: { edgeFluxMax },
        measure: true,
      });
      const remaining = result.density.reduce((total, amount) => total + amount, 0);
      assert.equal(
        result.totalCompleted + result.measurements.outOfField + remaining,
        result.measurements.totalInjected,
        `edgeFluxMax=${edgeFluxMax}, input=${inputName}`,
      );
    }
  }
});
