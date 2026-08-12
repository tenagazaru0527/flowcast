import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG, Q, createConfig } from "../src/config.js";
import { clampVector, divQ, fnv1aInt32, isqrt, mulQ, XorShift32 } from "../src/fixed-point.js";
import { buildRestoreField, burnLines } from "../src/lines.js";
import {
  createCanyonLayout,
  createCanyonScenario,
  createReplay,
  createWideSink,
  createWideSource,
  DEFAULT_SEED,
  INPUTS,
  replayInput,
  SCENARIOS,
  SINK,
  SOURCE,
  WIDE_SOURCE,
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

test("restore field uses fixed descent ties and avoids blocked cells", () => {
  const config = createConfig({ width: 5, height: 3 });
  const lineMask = new Uint8Array(15);
  const blocked = new Uint8Array(15);
  lineMask[7] = 1;
  blocked[6] = 1;
  const field = buildRestoreField(lineMask, blocked, config);
  assert.equal(field.distance[6], -1);
  assert.equal(field.distance[7], 0);
  assert.equal(field.restoreY[2], Q >> 2);
  assert.equal(field.restoreX[2], 0);
});

test("timeline records cumulative and instantaneous measurements at intervals and the final step", () => {
  assert.equal(createConfig().sampleDensity, false);
  assert.throws(() => createConfig({ sampleInterval: -1 }), /sampleInterval/);
  assert.throws(() => createConfig({ steps: 10, sampleInterval: 11 }), /sampleInterval/);
  assert.throws(() => createConfig({ sampleInterval: 1.5 }), /must be an integer/);
  assert.throws(() => createConfig({ sampleDensity: 1 }), /sampleDensity must be a boolean/);
  const scenario = createCanyonScenario(1);
  const sinkGroups = [
    { name: "upper", cells: scenario.sink.slice(0, 3) },
    { name: "lower", cells: scenario.sink.slice(3) },
  ];
  const result = runSimulation({
    lines: scenario.inputs.straight, source: scenario.source, sink: scenario.sink, sinkGroups,
    blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
    config: { steps: 51, sampleInterval: 20 }, measure: true,
  });
  assert.deepEqual(result.measurements.timeline.map(({ step }) => step), [20, 40, 51]);
  for (const sample of result.measurements.timeline) {
    assert.deepEqual(Object.keys(sample).sort(), [
      "blockedFrontDensityMax", "completed", "densityMaxExSource", "gapThroughput",
      "occupiedCells", "outOfField", "remaining", "sinkThroughput", "step",
    ]);
    assert.equal(Object.hasOwn(sample, "density"), false);
    assert.deepEqual(Object.keys(sample.gapThroughput), ["central", "detour"]);
    assert.deepEqual(Object.keys(sample.sinkThroughput), ["upper", "lower"]);
    assert.equal(sample.completed + sample.outOfField + sample.remaining, sample.step * DEFAULT_CONFIG.injectionPerStep);
  }
  assert.equal(result.measurements.timeline.at(-1).completed, result.measurements.totalCompleted);
  assert.equal(result.measurements.timeline.at(-1).outOfField, result.measurements.outOfField);
  assert.equal(Object.values(result.measurements.sinkThroughput).reduce((total, value) => total + value, 0), result.measurements.totalCompleted);
  const unmeasured = runSimulation({
    lines: scenario.inputs.straight, source: scenario.source, sink: scenario.sink, sinkGroups,
    blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
    config: { steps: 51, sampleInterval: 20 }, measure: false,
  });
  assert.equal(unmeasured.measurements, undefined);
  assert.equal(unmeasured.stateHash, result.stateHash);
  const unmeasuredWithDensitySampling = runSimulation({
    lines: scenario.inputs.straight, source: scenario.source, sink: scenario.sink, sinkGroups,
    blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
    config: { steps: 201, sampleInterval: 1, sampleDensity: true }, measure: false,
  });
  assert.equal(unmeasuredWithDensitySampling.measurements, undefined);

  const noInterval = runSimulation({
    lines: scenario.inputs.straight, source: scenario.source, sink: scenario.sink, sinkGroups,
    blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
    config: { steps: 1, sampleInterval: 0, sampleDensity: true }, measure: true,
  });
  assert.equal(noInterval.measurements.timeline, null);

  assert.throws(
    () => runSimulation({
      lines: [], source: [], sink: [], seed: DEFAULT_SEED,
      config: { steps: 3_600, sampleInterval: 1, sampleDensity: true }, measure: true,
    }),
    /3600 samples; limit is 200/,
  );
  const boundary = runSimulation({
    lines: scenario.inputs.straight, source: scenario.source, sink: scenario.sink, sinkGroups,
    blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
    config: { steps: 3_600, sampleInterval: 18, sampleDensity: true }, measure: true,
  });
  assert.equal(boundary.measurements.timeline.length, 200);
});

test("sinkGroups must partition sink cells with unique names and cells", () => {
  const scenario = SCENARIOS[1];
  const input = {
    lines: scenario.inputs.straight, source: scenario.source, sink: scenario.sink,
    seed: DEFAULT_SEED, config: { steps: 1 },
  };
  assert.throws(() => runSimulation({ ...input, sinkGroups: {} }), /at most four groups/);
  assert.throws(() => runSimulation({ ...input, sinkGroups: Array.from({ length: 5 }, (_, index) => ({ name: String(index), cells: [scenario.sink[index % scenario.sink.length]] })) }), /at most four groups/);
  assert.throws(() => runSimulation({ ...input, sinkGroups: [{ name: "", cells: scenario.sink }] }), /non-empty and unique/);
  assert.throws(() => runSimulation({ ...input, sinkGroups: [{ name: "same", cells: scenario.sink.slice(0, 3) }, { name: "same", cells: scenario.sink.slice(3) }] }), /non-empty and unique/);
  assert.throws(() => runSimulation({ ...input, sinkGroups: [{ name: "all", cells: [...scenario.sink, [0, 0]] }] }), /must be sink cells/);
  assert.throws(() => runSimulation({ ...input, sinkGroups: [{ name: "upper", cells: scenario.sink.slice(0, 3) }] }), /partition every sink cell/);
  assert.throws(() => runSimulation({ ...input, sinkGroups: [{ name: "upper", cells: scenario.sink.slice(0, 3) }, { name: "lower", cells: scenario.sink.slice(2) }] }), /must not overlap/);
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
  assert.equal(measured.measurements.blockedCellCount, 0);
  assert.deepEqual(measured.measurements.gapThroughput, {});
  assert.deepEqual(Object.keys(measured.measurements.outOfFieldByEdge).sort(), ["bottom", "left", "right", "top"]);
  assert.equal(measured.measurements.outsideCorridorCells, 0);
  assert.ok(Number.isInteger(measured.measurements.fieldEdgeDensityMax));
  assert.ok(Number.isInteger(measured.measurements.fieldEdgeDensityPeak));
  assert.equal(measured.measurements.fieldEdgeDensityMaxCell.length, 2);
  assert.equal(measured.measurements.fieldEdgeDensityPeakCell.length, 3);
  assert.equal(measured.measurements.blockedFrontDensityMax, null);
  assert.equal(measured.measurements.blockedFrontDensityPeak, null);
});

test("corridorBlocksOutOfField is boolean and structurally prevents exterior transfer", () => {
  assert.throws(() => createConfig({ corridorBlocksOutOfField: 1 }), /must be a boolean/);
  const scenario = createCanyonScenario(1);
  for (const inputName of ["straight", "distributed", "detour"]) {
    const result = runSimulation({
      lines: scenario.inputs[inputName], source: scenario.source, sink: scenario.sink,
      blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
      config: { corridorWidth: 8, restoreWeight: 0, congestionWeight: 0, congestionReference: 2_048, edgeFluxMax: 512, corridorBlocksOutOfField: true },
      measure: true,
    });
    assert.equal(result.measurements.outOfField, 0, inputName);
    assert.deepEqual(result.measurements.outOfFieldByEdge, { left: 0, right: 0, top: 0, bottom: 0 }, inputName);
  }
});

test("canyon obstacles stay empty and quantity conservation remains valid", () => {
  const scenario = createCanyonScenario(1);
  const input = {
    lines: scenario.inputs.straight,
    source: scenario.source,
    sink: scenario.sink,
    blocked: scenario.blocked,
    gaps: scenario.gaps,
    seed: DEFAULT_SEED,
    config: { steps: 128 },
  };
  const unmeasured = runSimulation(input);
  const measured = runSimulation({ ...input, measure: true });
  assert.equal(measured.stateHash, unmeasured.stateHash);
  assert.equal(measured.totalCompleted, unmeasured.totalCompleted);
  assert.equal(scenario.blocked.length, 58);
  assert.equal(measured.measurements.blockedCellCount, 58);
  assert.ok(measured.measurements.gapThroughput.central > 0);
  assert.equal(createCanyonLayout(63).blocked.length, 0);
  for (let index = 0; index < scenario.blocked.length; index += 1) {
    const [x, y] = scenario.blocked[index];
    assert.equal(measured.density[y * 64 + x], 0);
  }
});

test("source injection is divided in scenario order without changing the total", () => {
  const measured = runSimulation({
    lines: INPUTS.straight,
    source: createWideSource(9),
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
