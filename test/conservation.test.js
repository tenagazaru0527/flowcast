import assert from "node:assert/strict";
import test from "node:test";

import { Q } from "../src/config.js";
import { DEFAULT_SEED, INPUTS, SINK, SOURCE } from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";

const EDGE_FLUX_SWEEP = [128, 256, 512, 768, 1_024, 1_536, 2_048, 4_096, Q];

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
