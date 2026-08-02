import { Q } from "../src/config.js";
import { runSimulation } from "../src/simulation.js";
import { DEFAULT_SEED, INPUTS, SINK, SOURCE } from "../src/scenarios.js";

const WIDTH = 64;
const HEIGHT = 64;
const CELL_SIZE = 10;
const STEP_INTERVAL = 50;
const MAX_STEP = 3_600;

const canvas = document.querySelector("#density");
const context = canvas.getContext("2d");
const inputName = document.querySelector("#input-name");
const edgeFluxMax = document.querySelector("#edge-flux-max");
const advectionWeight = document.querySelector("#advection-weight");
const diffusionWeight = document.querySelector("#diffusion-weight");
const stepRange = document.querySelector("#step-range");
const stepNumber = document.querySelector("#step-number");
const status = document.querySelector("#status");
const cache = new Map();
let requestId = 0;

function integerValue(control, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(control.value);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function currentRequest() {
  return {
    input: inputName.value,
    step: integerValue(stepNumber, "step", 0, MAX_STEP),
    edgeFluxMax: integerValue(edgeFluxMax, "edgeFluxMax", 0),
    advectionWeight: integerValue(advectionWeight, "advectionWeight", 0, 128 * Q),
    diffusionWeight: integerValue(diffusionWeight, "diffusionWeight", 0, 128 * Q),
  };
}

function cacheKey(request) {
  return [
    request.input,
    request.step,
    request.edgeFluxMax,
    request.advectionWeight,
    request.diffusionWeight,
  ].join(":");
}

function emptyResult() {
  return {
    density: new Int32Array(WIDTH * HEIGHT),
    totalCompleted: 0,
    stateHash: "—",
    measurements: { outOfField: 0 },
  };
}

function runRequest(request) {
  if (request.step === 0) return emptyResult();
  return runSimulation({
    lines: INPUTS[request.input],
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
    config: {
      steps: request.step,
      edgeFluxMax: request.edgeFluxMax,
      advectionWeight: request.advectionWeight,
      diffusionWeight: request.diffusionWeight,
    },
    measure: true,
  });
}

function currentMaximum(density) {
  let amount = 0;
  let cell = [0, 0];
  for (let index = 0; index < density.length; index += 1) {
    if (density[index] <= amount) continue;
    amount = density[index];
    cell = [index % WIDTH, (index / WIDTH) | 0];
  }
  return { amount, cell };
}

function heatColor(amount, maximum) {
  if (amount <= 0 || maximum <= 0) return "#080c14";
  const normalized = Math.log1p(amount) / Math.log1p(maximum);
  const hue = 240 * (1 - normalized);
  const lightness = 15 + 45 * normalized;
  return `hsl(${hue} 90% ${lightness}%)`;
}

function drawMarker(point, color) {
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.strokeRect(
    point[0] * CELL_SIZE + 1.5,
    point[1] * CELL_SIZE + 1.5,
    CELL_SIZE - 3,
    CELL_SIZE - 3,
  );
}

function draw(result, request, elapsed, cached) {
  const maximum = currentMaximum(result.density);
  for (let index = 0; index < result.density.length; index += 1) {
    const x = index % WIDTH;
    const y = (index / WIDTH) | 0;
    context.fillStyle = heatColor(result.density[index], maximum.amount);
    context.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }

  context.strokeStyle = "rgb(255 255 255 / 0.12)";
  context.lineWidth = 1;
  for (let coordinate = 0; coordinate <= WIDTH; coordinate += 8) {
    context.beginPath();
    context.moveTo(coordinate * CELL_SIZE, 0);
    context.lineTo(coordinate * CELL_SIZE, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, coordinate * CELL_SIZE);
    context.lineTo(canvas.width, coordinate * CELL_SIZE);
    context.stroke();
  }

  drawMarker(SOURCE, "#ff4fd8");
  drawMarker(SINK, "#62ff7a");

  document.querySelector("#metric-step").textContent = String(request.step);
  document.querySelector("#metric-density-max").textContent = `${maximum.amount} @ [${maximum.cell.join(", ")}]`;
  document.querySelector("#metric-completed").textContent = String(result.totalCompleted);
  document.querySelector("#metric-out-of-field").textContent = String(result.measurements.outOfField);
  document.querySelector("#metric-hash").textContent = result.stateHash;
  document.querySelector("#metric-cache").textContent = `${cache.size} states`;
  status.dataset.error = "false";
  status.textContent = cached ? `cacheから表示 (${elapsed.toFixed(1)} ms)` : `再実行して表示 (${elapsed.toFixed(1)} ms)`;
}

async function renderCurrent() {
  const localRequestId = ++requestId;
  try {
    const request = currentRequest();
    const key = cacheKey(request);
    const cached = cache.has(key);
    status.dataset.error = "false";
    status.textContent = cached ? "cacheを取得中…" : `step ${request.step} を再実行中…`;
    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    const started = performance.now();
    let result = cache.get(key);
    if (!result) {
      result = runRequest(request);
      cache.set(key, result);
    }
    if (localRequestId !== requestId) return;
    draw(result, request, performance.now() - started, cached);
  } catch (error) {
    status.dataset.error = "true";
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function setStep(value) {
  const step = Math.max(0, Math.min(MAX_STEP, value));
  stepNumber.value = String(step);
  stepRange.value = String(Math.round(step / STEP_INTERVAL) * STEP_INTERVAL);
  void renderCurrent();
}

document.querySelector("#apply").addEventListener("click", () => void renderCurrent());
inputName.addEventListener("change", () => void renderCurrent());
stepRange.addEventListener("input", () => {
  stepNumber.value = stepRange.value;
});
stepRange.addEventListener("change", () => void renderCurrent());
stepNumber.addEventListener("change", () => setStep(integerValue(stepNumber, "step", 0, MAX_STEP)));
document.querySelector("#previous").addEventListener("click", () => setStep(Number(stepNumber.value) - STEP_INTERVAL));
document.querySelector("#next").addEventListener("click", () => setStep(Number(stepNumber.value) + STEP_INTERVAL));

void renderCurrent();
