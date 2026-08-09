import { createConfig, DEFAULT_CONFIG, Q } from "../src/config.js";
import { buildRestoreField, burnLines } from "../src/lines.js";
import { runSimulation } from "../src/simulation.js";
import { createCanyonScenario, DEFAULT_SEED, ENGINE_VERSION, SCENARIOS } from "../src/scenarios.js";

const FORMAT_VERSION = 1;
const CELL_SIZE = 10;
const FRAME_STEPS = Object.freeze([
  25, 50, 75, 100, 150, 200, 300, 400, 550, 700, 900, 1_100,
  1_400, 1_700, 2_000, 2_400, 2_800, 3_200, 3_600,
]);
const LINE_COLORS = Object.freeze(["#35d0ff", "#ffcc4d", "#ff6b9d", "#8cff66", "#c79aff"]);
const $ = (selector) => document.querySelector(selector);
const canvas = $("#density");
const context = canvas.getContext("2d");
const finalCache = new Map();
const playbackCache = new Map();

let lines = [];
let selectedLine = 0;
let dragging = null;
let displayed = null;
let playback = null;
let playTimer = null;

function cloneLines(value) {
  return value.map((line) => line.map(([x, y]) => [x, y]));
}

function qLinesToCells(value) {
  return value.map((line) => line.map(([x, y]) => [x / Q, y / Q]));
}

function cellLinesToQ(value) {
  return value.map((line) => line.map(([x, y]) => [x * Q, y * Q]));
}

function integerValue(selector, label) {
  const value = Number($(selector).value);
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function scenarioFor(scenarioId = $("#scenario-id").value, gapWidth = Number($("#gap-width").value)) {
  if (scenarioId === "poc-2-canyon") return createCanyonScenario(gapWidth);
  const scenario = SCENARIOS.find((candidate) => candidate.scenarioId === scenarioId);
  if (!scenario) throw new RangeError(`unknown scenarioId: ${scenarioId}`);
  return { ...scenario, blocked: [], gaps: [] };
}

function currentConfig(steps = integerValue("#steps", "steps")) {
  return createConfig({
    corridorWidth: integerValue("#corridor-width", "corridorWidth"),
    corridorBlocksOutOfField: $("#corridor-blocks-out-of-field").checked,
    restoreWeight: integerValue("#restore-weight", "restoreWeight"),
    congestionWeight: integerValue("#congestion-weight", "congestionWeight"),
    congestionReference: integerValue("#congestion-reference", "congestionReference"),
    edgeFluxMax: integerValue("#edge-flux-max", "edgeFluxMax"),
    advectionWeight: integerValue("#advection-weight", "advectionWeight"),
    diffusionWeight: integerValue("#diffusion-weight", "diffusionWeight"),
    steps,
  });
}

function validateLines(candidate = lines) {
  if (!Array.isArray(candidate) || candidate.length < 3 || candidate.length > 5) {
    throw new RangeError("lines must contain between 3 and 5 paths");
  }
  for (const points of candidate) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new RangeError("each line needs at least two control points");
    }
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)) {
        throw new TypeError("control point coordinates must be integers");
      }
      if (point[0] < 0 || point[0] >= DEFAULT_CONFIG.width || point[1] < 0 || point[1] >= DEFAULT_CONFIG.height) {
        throw new RangeError("control point is outside the field");
      }
    }
  }
}

function stateObject() {
  return {
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    scenarioId: $("#scenario-id").value,
    gapWidth: Number($("#gap-width").value),
    parameters: {
      corridorWidth: Number($("#corridor-width").value),
      corridorBlocksOutOfField: $("#corridor-blocks-out-of-field").checked,
      restoreWeight: Number($("#restore-weight").value),
      congestionWeight: Number($("#congestion-weight").value),
      congestionReference: Number($("#congestion-reference").value),
      edgeFluxMax: Number($("#edge-flux-max").value),
      advectionWeight: Number($("#advection-weight").value),
      diffusionWeight: Number($("#diffusion-weight").value),
      steps: Number($("#steps").value),
    },
    seed: Number($("#seed").value),
    lines: cloneLines(lines),
  };
}

function requestFor(steps = integerValue("#steps", "steps")) {
  validateLines();
  const scenario = scenarioFor();
  return {
    lines: cellLinesToQ(lines),
    source: scenario.source,
    sink: scenario.sink,
    seed: integerValue("#seed", "seed"),
    config: currentConfig(steps),
    blocked: scenario.blocked ?? [],
    gaps: scenario.gaps ?? [],
    measure: true,
  };
}

function requestKey() {
  return JSON.stringify(stateObject());
}

function setStatus(message, error = false) {
  $("#status").dataset.error = String(error);
  $("#status").textContent = message;
}

function updateUrl() {
  const hash = `state=${encodeURIComponent(JSON.stringify(stateObject()))}`;
  history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`);
}

function updateValidation() {
  let message = "実行可能";
  let invalid = false;
  try {
    validateLines();
    currentConfig();
    integerValue("#seed", "seed");
  } catch (error) {
    invalid = true;
    message = error instanceof Error ? error.message : String(error);
  }
  $("#line-validation").dataset.error = String(invalid);
  $("#line-validation").textContent = message;
  $("#run-final").disabled = invalid;
  $("#build-playback").disabled = invalid;
  return !invalid;
}

function renderLineList() {
  const container = $("#line-list");
  container.replaceChildren();
  lines.forEach((points, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `線 ${index + 1} (${points.length}点)`;
    button.style.borderColor = LINE_COLORS[index];
    button.setAttribute("aria-pressed", String(index === selectedLine));
    button.addEventListener("click", () => {
      selectedLine = index;
      renderLineList();
      drawDisplayed();
    });
    container.append(button);
  });
  $("#add-line").disabled = lines.length >= 5;
  $("#remove-line").disabled = lines.length === 0;
  $("#undo-point").disabled = !lines[selectedLine]?.length;
  updateValidation();
}

function currentMaximum(density) {
  let amount = 0;
  for (const value of density) if (value > amount) amount = value;
  return amount;
}

function heatColor(amount, maximum) {
  if (amount <= 0 || maximum <= 0) return "#080c14";
  const normalized = Math.log1p(amount) / Math.log1p(maximum);
  return `hsl(${240 * (1 - normalized)} 90% ${15 + 45 * normalized}%)`;
}

function drawMarker(point, color) {
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.strokeRect(point[0] * CELL_SIZE + 1.5, point[1] * CELL_SIZE + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
}

function drawLines() {
  if (!$("#show-lines").checked) return;
  lines.forEach((points, lineIndex) => {
    context.strokeStyle = LINE_COLORS[lineIndex];
    context.lineWidth = lineIndex === selectedLine ? 3 : 2;
    context.beginPath();
    points.forEach(([x, y], pointIndex) => {
      const pixelX = x * CELL_SIZE + CELL_SIZE / 2;
      const pixelY = y * CELL_SIZE + CELL_SIZE / 2;
      if (pointIndex === 0) context.moveTo(pixelX, pixelY);
      else context.lineTo(pixelX, pixelY);
    });
    context.stroke();
    points.forEach(([x, y]) => {
      context.fillStyle = LINE_COLORS[lineIndex];
      context.beginPath();
      context.arc(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2, lineIndex === selectedLine ? 4 : 3, 0, Math.PI * 2);
      context.fill();
    });
  });
}

function geometry() {
  const scenario = scenarioFor();
  const config = currentConfig();
  const blockedMask = new Uint8Array(config.width * config.height);
  for (const [x, y] of scenario.blocked ?? []) blockedMask[y * config.width + x] = 1;
  let corridorDistance = null;
  try {
    validateLines();
    const field = burnLines(cellLinesToQ(lines), config);
    corridorDistance = buildRestoreField(field.lineMask, blockedMask, config).distance;
  } catch {
    // Invalid lines remain visible and execution stays disabled.
  }
  return { scenario, config, corridorDistance };
}

function drawOverlays() {
  let current;
  try {
    current = geometry();
  } catch {
    drawLines();
    return;
  }
  const { scenario, config, corridorDistance } = current;
  if ($("#show-blocked").checked) {
    context.fillStyle = "rgb(120 128 145 / 0.8)";
    for (const [x, y] of scenario.blocked ?? []) context.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }
  if ($("#show-corridor").checked && corridorDistance) {
    context.fillStyle = "rgb(255 255 255 / 0.2)";
    corridorDistance.forEach((distance, index) => {
      if (distance === config.corridorWidth) {
        context.fillRect((index % config.width) * CELL_SIZE, ((index / config.width) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    });
  }
  if ($("#show-field-edge").checked) {
    context.strokeStyle = "#ff8c42";
    context.lineWidth = 2;
    context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  }
  drawLines();
  for (const point of scenario.source) drawMarker(point, "#ff4fd8");
  for (const point of scenario.sink) drawMarker(point, "#62ff7a");
}

function drawDensity(result, scaleMaximum) {
  const density = result?.density ?? new Int32Array(DEFAULT_CONFIG.width * DEFAULT_CONFIG.height);
  for (let index = 0; index < density.length; index += 1) {
    context.fillStyle = heatColor(density[index], scaleMaximum);
    context.fillRect((index % DEFAULT_CONFIG.width) * CELL_SIZE, ((index / DEFAULT_CONFIG.width) | 0) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }
  context.strokeStyle = "rgb(255 255 255 / 0.12)";
  context.lineWidth = 1;
  for (let coordinate = 0; coordinate <= DEFAULT_CONFIG.width; coordinate += 8) {
    context.beginPath(); context.moveTo(coordinate * CELL_SIZE, 0); context.lineTo(coordinate * CELL_SIZE, canvas.height); context.stroke();
    context.beginPath(); context.moveTo(0, coordinate * CELL_SIZE); context.lineTo(canvas.width, coordinate * CELL_SIZE); context.stroke();
  }
}

function metricCell(value, cell) {
  return `${value ?? "—"} @ ${cell ? `[${cell.join(", ")}]` : "—"}`;
}

function showMetrics(result, step) {
  const measure = result?.measurements;
  $("#metric-step").textContent = result ? String(step) : "—";
  $("#metric-completion-step").textContent = measure ? String(measure.completionStep) : "—";
  $("#metric-completed").textContent = measure ? `${measure.totalCompleted} / ${measure.completionRatio}%` : "—";
  $("#metric-loss").textContent = measure ? `${measure.outOfFieldRatio}% / ${measure.remainingRatio}%` : "—";
  const isCanyon = $("#scenario-id").value === "poc-2-canyon";
  const central = measure?.gapThroughput?.central;
  const detour = measure?.gapThroughput?.detour;
  $("#metric-gap").textContent = isCanyon && measure ? `${central} / ${detour}` : "—";
  $("#metric-central-ratio").textContent = isCanyon && central + detour > 0 ? `${((central * 100) / (central + detour)).toFixed(2)}%` : "—";
  $("#metric-density-max").textContent = measure ? metricCell(measure.densityMaxExSource, measure.densityMaxExSourceCell) : "—";
  $("#metric-blocked-front").textContent = measure ? metricCell(measure.blockedFrontDensityMax, measure.blockedFrontDensityMaxCell) : "—";
  $("#metric-field-edge").textContent = measure ? metricCell(measure.fieldEdgeDensityMax, measure.fieldEdgeDensityMaxCell) : "—";
  $("#metric-occupied").textContent = measure ? String(measure.occupiedCellsPeak) : "—";
  $("#metric-hash").textContent = result?.stateHash ?? "—";
}

function drawDisplayed() {
  const result = displayed?.result ?? null;
  const maximum = displayed?.scaleMaximum ?? currentMaximum(result?.density ?? []);
  drawDensity(result, maximum);
  drawOverlays();
  showMetrics(result, displayed?.step);
}

function stateChanged() {
  stopPlaying();
  playback = null;
  $("#frame-range").disabled = true;
  $("#play").disabled = true;
  $("#frame-label").textContent = "最終状態モード";
  updateValidation();
  updateUrl();
  drawDisplayed();
}

async function yieldFrame() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function runFinal() {
  try {
    const key = requestKey();
    const cached = finalCache.has(key);
    setStatus(cached ? "最終状態をキャッシュから取得中…" : "最終状態を計算中…");
    await yieldFrame();
    const started = performance.now();
    let result = finalCache.get(key);
    if (!result) {
      result = runSimulation(requestFor());
      finalCache.set(key, result);
    }
    displayed = { result, step: integerValue("#steps", "steps"), scaleMaximum: currentMaximum(result.density) };
    drawDisplayed();
    $("#frame-label").textContent = "最終状態モード";
    setStatus(`${cached ? "cacheから表示" : "最終状態を表示"} (${(performance.now() - started).toFixed(1)} ms)`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function buildPlayback() {
  try {
    stopPlaying();
    const configuredSteps = integerValue("#steps", "steps");
    const steps = FRAME_STEPS.filter((step) => step <= configuredSteps);
    if (steps.length === 0) steps.push(configuredSteps);
    const key = requestKey();
    const cached = playbackCache.get(key);
    if (cached) {
      playback = cached;
      setupPlayback(0);
      setStatus(`${playback.frames.length}フレームをcacheから取得`);
      return;
    }
    const frames = [];
    const started = performance.now();
    for (let index = 0; index < steps.length; index += 1) {
      setStatus(`フレーム ${index + 1} / ${steps.length} を計算中`);
      await yieldFrame();
      frames.push({ step: steps[index], result: runSimulation(requestFor(steps[index])) });
    }
    let scaleMaximum = 0;
    for (const frame of frames) scaleMaximum = Math.max(scaleMaximum, currentMaximum(frame.result.density));
    playback = { frames, scaleMaximum };
    playbackCache.set(key, playback);
    setupPlayback(0);
    setStatus(`${frames.length}フレームを生成 (${((performance.now() - started) / 1_000).toFixed(2)} s)`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function setupPlayback(index) {
  $("#frame-range").max = String(playback.frames.length - 1);
  $("#frame-range").value = String(index);
  $("#frame-range").disabled = false;
  $("#play").disabled = false;
  showPlaybackFrame(index);
}

function showPlaybackFrame(index) {
  const frame = playback.frames[index];
  displayed = { ...frame, scaleMaximum: playback.scaleMaximum };
  $("#frame-label").textContent = `再生モード: フレーム ${index + 1} / ${playback.frames.length} (step ${frame.step})`;
  drawDisplayed();
}

function stopPlaying() {
  if (playTimer !== null) clearInterval(playTimer);
  playTimer = null;
  $("#play").textContent = "再生";
}

function togglePlayback() {
  if (playTimer !== null) {
    stopPlaying();
    return;
  }
  $("#play").textContent = "停止";
  playTimer = setInterval(() => {
    const next = Number($("#frame-range").value) + 1;
    if (next >= playback.frames.length) {
      stopPlaying();
      return;
    }
    $("#frame-range").value = String(next);
    showPlaybackFrame(next);
  }, 350);
}

function loadPreset(name = $("#preset").value) {
  const scenario = scenarioFor();
  lines = qLinesToCells(scenario.inputs[name]);
  selectedLine = 0;
  renderLineList();
  stateChanged();
}

function applyState(replay) {
  if (replay === null || typeof replay !== "object" || Array.isArray(replay)) throw new TypeError("viewer state must be an object");
  if (replay.formatVersion !== FORMAT_VERSION) throw new RangeError(`unsupported formatVersion: ${replay.formatVersion}`);
  scenarioFor(replay.scenarioId, replay.gapWidth);
  validateLines(replay.lines);
  $("#scenario-id").value = replay.scenarioId;
  $("#gap-width").value = String(replay.gapWidth);
  const selectors = {
    corridorWidth: "#corridor-width", restoreWeight: "#restore-weight", congestionWeight: "#congestion-weight",
    congestionReference: "#congestion-reference", edgeFluxMax: "#edge-flux-max", advectionWeight: "#advection-weight",
    diffusionWeight: "#diffusion-weight", steps: "#steps",
  };
  for (const [key, selector] of Object.entries(selectors)) $(selector).value = String(replay.parameters[key]);
  $("#corridor-blocks-out-of-field").checked = replay.parameters.corridorBlocksOutOfField;
  $("#seed").value = String(replay.seed);
  lines = cloneLines(replay.lines);
  selectedLine = 0;
  currentConfig();
  integerValue("#seed", "seed");
  $("#gap-width").disabled = replay.scenarioId !== "poc-2-canyon";
  $("#warning").textContent = replay.engineVersion === ENGINE_VERSION ? "" : `警告: engineVersion ${replay.engineVersion} を現行 ${ENGINE_VERSION} で読み込みました`;
  renderLineList();
  stateChanged();
}

function downloadState() {
  const blob = new Blob([`${JSON.stringify(stateObject(), null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `flowcast-viewer-${$("#scenario-id").value}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function canvasCell(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(63, Math.floor(((event.clientX - bounds.left) * canvas.width) / bounds.width / CELL_SIZE)));
  const y = Math.max(0, Math.min(63, Math.floor(((event.clientY - bounds.top) * canvas.height) / bounds.height / CELL_SIZE)));
  return [x, y];
}

function findPoint([x, y]) {
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    for (let pointIndex = lines[lineIndex].length - 1; pointIndex >= 0; pointIndex -= 1) {
      const [pointX, pointY] = lines[lineIndex][pointIndex];
      if (Math.abs(pointX - x) <= 1 && Math.abs(pointY - y) <= 1) return { lineIndex, pointIndex };
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (event) => {
  const cell = canvasCell(event);
  const found = findPoint(cell);
  if (found) {
    dragging = found;
    selectedLine = found.lineIndex;
    canvas.setPointerCapture(event.pointerId);
  } else if (lines[selectedLine]) {
    lines[selectedLine].push(cell);
  }
  renderLineList();
  stateChanged();
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  lines[dragging.lineIndex][dragging.pointIndex] = canvasCell(event);
  stateChanged();
});
canvas.addEventListener("pointerup", () => { dragging = null; renderLineList(); });
canvas.addEventListener("pointercancel", () => { dragging = null; });

$("#add-line").addEventListener("click", () => {
  if (lines.length >= 5) return;
  lines.push([]);
  selectedLine = lines.length - 1;
  renderLineList();
  stateChanged();
});
$("#remove-line").addEventListener("click", () => {
  if (!lines.length) return;
  lines.splice(selectedLine, 1);
  selectedLine = Math.max(0, Math.min(selectedLine, lines.length - 1));
  renderLineList();
  stateChanged();
});
$("#undo-point").addEventListener("click", () => {
  lines[selectedLine]?.pop();
  renderLineList();
  stateChanged();
});
$("#clear-lines").addEventListener("click", () => {
  lines = [];
  selectedLine = 0;
  renderLineList();
  stateChanged();
});
$("#load-preset").addEventListener("click", () => loadPreset());
$("#scenario-id").addEventListener("change", () => {
  $("#gap-width").disabled = $("#scenario-id").value !== "poc-2-canyon";
  loadPreset("distributed");
});
$("#gap-width").addEventListener("change", () => loadPreset("distributed"));

for (const selector of [
  "#corridor-width", "#corridor-blocks-out-of-field", "#restore-weight", "#congestion-weight",
  "#congestion-reference", "#edge-flux-max", "#advection-weight", "#diffusion-weight", "#steps", "#seed",
]) $(selector).addEventListener("change", stateChanged);
for (const selector of ["#show-blocked", "#show-lines", "#show-corridor", "#show-field-edge"]) {
  $(selector).addEventListener("change", drawDisplayed);
}

$("#run-final").addEventListener("click", () => void runFinal());
$("#build-playback").addEventListener("click", () => void buildPlayback());
$("#play").addEventListener("click", togglePlayback);
$("#frame-range").addEventListener("input", () => showPlaybackFrame(Number($("#frame-range").value)));
$("#download").addEventListener("click", downloadState);
$("#copy-url").addEventListener("click", async () => {
  updateUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus("共有URLをクリップボードへコピーしました");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});
$("#load-json").addEventListener("change", async () => {
  try {
    const [file] = $("#load-json").files;
    if (!file) return;
    applyState(JSON.parse(await file.text()));
    setStatus(`${file.name} を読み込みました`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    $("#load-json").value = "";
  }
});

function initializeDefaults() {
  $("#corridor-width").value = String(DEFAULT_CONFIG.width + DEFAULT_CONFIG.height);
  $("#corridor-blocks-out-of-field").checked = DEFAULT_CONFIG.corridorBlocksOutOfField;
  $("#restore-weight").value = String(DEFAULT_CONFIG.restoreWeight);
  $("#congestion-weight").value = String(DEFAULT_CONFIG.congestionWeight);
  $("#congestion-reference").value = String(DEFAULT_CONFIG.congestionReference);
  $("#edge-flux-max").value = String(DEFAULT_CONFIG.edgeFluxMax);
  $("#advection-weight").value = String(DEFAULT_CONFIG.advectionWeight);
  $("#diffusion-weight").value = String(DEFAULT_CONFIG.diffusionWeight);
  $("#steps").value = "3600";
  $("#seed").value = String(DEFAULT_SEED);
  $("#gap-width").disabled = true;
  lines = qLinesToCells(scenarioFor().inputs.distributed);
  if (location.hash.startsWith("#state=")) {
    try {
      applyState(JSON.parse(decodeURIComponent(location.hash.slice(7))));
      setStatus("URLから盤面を復元しました");
      return;
    } catch (error) {
      $("#warning").textContent = `URLの盤面を読み込めません: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  renderLineList();
  updateUrl();
  drawDisplayed();
}

initializeDefaults();
