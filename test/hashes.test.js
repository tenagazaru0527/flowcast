import assert from "node:assert/strict";
import test from "node:test";

import { Q } from "../src/config.js";
import {
  createWideSink,
  createWideSource,
  DEFAULT_SEED,
  INPUTS,
  SCENARIOS,
  SINK,
  SOURCE,
  WIDE_SOURCE,
} from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";

test("restoreWeight zero preserves every 0.7.0 scenario hash", () => {
  const expected = {
    "poc-0-default": { straight: "4910305d", distributed: "e63ba5b1", detour: "9164f600" },
    "poc-1-wide": { straight: "f7606aa8", distributed: "97a13950", detour: "13073731" },
    "poc-2-canyon": { straight: "e3ddaebc", distributed: "6e03aff9", detour: "ae3a98ad" },
  };
  for (const scenario of SCENARIOS) {
    for (const inputName of Object.keys(expected[scenario.scenarioId])) {
      const result = runSimulation({
        lines: scenario.inputs[inputName], source: scenario.source, sink: scenario.sink,
        blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED, config: { restoreWeight: 0 },
      });
      assert.equal(result.stateHash, expected[scenario.scenarioId][inputName], `${scenario.scenarioId}/${inputName}`);
    }
  }
});

test("congestionWeight zero preserves every 0.8.0 scenario hash", () => {
  const expected = {
    "poc-0-default": { straight: "4910305d", distributed: "e63ba5b1", detour: "9164f600" },
    "poc-1-wide": { straight: "f7606aa8", distributed: "97a13950", detour: "13073731" },
    "poc-2-canyon": { straight: "e3ddaebc", distributed: "6e03aff9", detour: "ae3a98ad" },
  };
  for (const scenario of SCENARIOS) {
    for (const inputName of Object.keys(expected[scenario.scenarioId])) {
      const result = runSimulation({
        lines: scenario.inputs[inputName], source: scenario.source, sink: scenario.sink,
        blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
        config: { congestionWeight: 0 }, measure: inputName === "distributed",
      });
      assert.equal(result.stateHash, expected[scenario.scenarioId][inputName], `${scenario.scenarioId}/${inputName}`);
      if (inputName === "distributed") {
        assert.equal(result.measurements.conductanceMin, Q);
        assert.equal(result.measurements.throttledEdgeCount, 0);
      }
    }
  }
});

test("default unlimited corridor preserves every 0.9.0 scenario hash", () => {
  const expected = {
    "poc-0-default": { straight: "4910305d", distributed: "e63ba5b1", detour: "9164f600" },
    "poc-1-wide": { straight: "f7606aa8", distributed: "97a13950", detour: "13073731" },
    "poc-2-canyon": { straight: "e3ddaebc", distributed: "6e03aff9", detour: "ae3a98ad" },
  };
  for (const scenario of SCENARIOS) {
    for (const inputName of Object.keys(expected[scenario.scenarioId])) {
      const result = runSimulation({
        lines: scenario.inputs[inputName], source: scenario.source, sink: scenario.sink,
        blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED,
        config: {},
      });
      assert.equal(result.stateHash, expected[scenario.scenarioId][inputName], `${scenario.scenarioId}/${inputName}`);
    }
  }
});

test("unspecified corridorBlocksOutOfField preserves every 0.10.0 scenario hash", () => {
  const expected = {
    "poc-0-default": { straight: "4910305d", distributed: "e63ba5b1", detour: "9164f600" },
    "poc-1-wide": { straight: "f7606aa8", distributed: "97a13950", detour: "13073731" },
    "poc-2-canyon": { straight: "e3ddaebc", distributed: "6e03aff9", detour: "ae3a98ad" },
  };
  for (const scenario of SCENARIOS) {
    for (const inputName of Object.keys(expected[scenario.scenarioId])) {
      const result = runSimulation({
        lines: scenario.inputs[inputName], source: scenario.source, sink: scenario.sink,
        blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED, config: {},
      });
      assert.equal(result.stateHash, expected[scenario.scenarioId][inputName], `${scenario.scenarioId}/${inputName}`);
    }
  }
});

test("sampleInterval and line distance measurements preserve every 0.11.0 scenario hash", () => {
  const expected = {
    "poc-0-default": { straight: "4910305d", distributed: "e63ba5b1", detour: "9164f600" },
    "poc-1-wide": { straight: "f7606aa8", distributed: "97a13950", detour: "13073731" },
    "poc-2-canyon": { straight: "e3ddaebc", distributed: "6e03aff9", detour: "ae3a98ad" },
  };
  for (const sampleInterval of [undefined, 1, 50, 100]) {
    for (const scenario of SCENARIOS) {
      for (const inputName of Object.keys(expected[scenario.scenarioId])) {
        const config = sampleInterval === undefined ? {} : { sampleInterval };
        const grouped = sampleInterval === 100 && scenario.scenarioId === "poc-1-wide" && inputName === "straight";
        const sinkGroups = grouped ? [
          { name: "upper", cells: scenario.sink.slice(0, 3) },
          { name: "lower", cells: scenario.sink.slice(3) },
        ] : undefined;
        const result = runSimulation({
          lines: scenario.inputs[inputName], source: scenario.source, sink: scenario.sink,
          blocked: scenario.blocked, gaps: scenario.gaps, sinkGroups, seed: DEFAULT_SEED, config, measure: true,
        });
        assert.equal(
          result.stateHash,
          expected[scenario.scenarioId][inputName],
          `sampleInterval=${sampleInterval ?? "unspecified"}/${scenario.scenarioId}/${inputName}`,
        );
        if (grouped) {
          const values = result.measurements;
          assert.equal(Object.values(values.sinkThroughput).reduce((total, value) => total + value, 0), values.totalCompleted);
          for (const [name, throughput] of Object.entries(values.sinkThroughput)) {
            assert.equal(values.sinkFirstArrivalStep[name] === -1, throughput === 0);
          }
          assert.ok(values.timeline.every((sample) => Object.keys(sample.sinkThroughput).join(",") === "upper,lower"));
        }
        if (sampleInterval === undefined) {
          const values = result.measurements;
          assert.equal(values.timeline, null);
          assert.equal(values.sinkThroughput, null);
          assert.equal(values.sinkFirstArrivalStep, null);
          assert.equal(values.lineDistanceDensity.length, 65);
          assert.equal(values.lineDistanceCells.length, 65);
          assert.ok(values.lineDistanceDensity.every((value) => Number.isInteger(value) && value >= 0));
          assert.ok(values.lineDistanceCells.every((value) => Number.isInteger(value) && value >= 0));
          assert.equal(values.lineDistanceUnreachable, 0);
          assert.equal(values.lineDistanceCells.reduce((total, value) => total + value, 0) + values.lineDistanceUnreachableCells, 64 * 64);
          const remaining = result.density.reduce((total, value) => total + value, 0);
          assert.equal(values.lineDistanceDensity.reduce((total, value) => total + value, 0), remaining);
        }
      }
    }
  }
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
  assert.deepEqual(WIDE_SOURCE, createWideSource(1));
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

test("an empty obstacle mask preserves the new poc-1-wide default hashes", () => {
  const expected = {
    straight: "f7606aa8",
    distributed: "97a13950",
    detour: "13073731",
  };
  for (const inputName of Object.keys(expected)) {
    const result = runSimulation({
      lines: INPUTS[inputName],
      source: createWideSource(1),
      sink: createWideSink(5),
      blocked: [],
      gaps: [],
      seed: DEFAULT_SEED,
    });
    assert.equal(result.stateHash, expected[inputName], inputName);
  }
});
