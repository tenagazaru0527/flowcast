import { runSimulation } from "./simulation.js";
import { createReplay, replayInput } from "./scenarios.js";

const result = runSimulation(replayInput(createReplay()));
document.body.textContent = result.stateHash;
document.body.dataset.ready = "true";

const runtime = new URLSearchParams(window.location.search).get("runtime");
if (runtime) {
  fetch(`/report?runtime=${encodeURIComponent(runtime)}&hash=${result.stateHash}`, { method: "POST" }).catch(() => {});
}
