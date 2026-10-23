import { createConfig } from "../src/config.js";
import { runSimulation } from "../src/simulation.js";

// Keep the deterministic engine off the UI thread so cancellation stays responsive.
self.onmessage = ({ data: challenge }) => {
  try {
    const result = runSimulation({
      ...challenge,
      config: createConfig(challenge.parameters),
      measure: true,
    });
    const { timeline, sinkThroughput, completionRatio, outOfFieldRatio, totalInjected } = result.measurements;
    self.postMessage({
      result: {
        stateHash: result.stateHash,
        density: result.density,
        timeline,
        sinkThroughput,
        completionRatio,
        outOfFieldRatio,
        totalInjected,
      },
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
