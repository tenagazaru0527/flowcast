import { createConfig, DEFAULT_CONFIG, Q } from "../src/config.js";
import { buildRestoreField, burnLines } from "../src/lines.js";
import { runSimulation } from "../src/simulation.js";
import { createCanyonScenario, DEFAULT_SEED, ENGINE_VERSION, SCENARIOS } from "../src/scenarios.js";

const FORMAT_VERSION = 3;
const MAX_STEPS = 20_000;
const MAX_URL_HASH_LENGTH = 8_000;
const CELL_SIZE = 10;
const FRAME_STEPS = Object.freeze([
  25, 50, 75, 100, 150, 200, 300, 400, 550, 700, 900, 1_100,
  1_400, 1_700, 2_000, 2_400, 2_800, 3_200, 3_600,
]);
const LINE_COLORS = Object.freeze(["#35d0ff", "#ffcc4d", "#ff6b9d", "#8cff66", "#c79aff"]);
const GAP_COLORS = Object.freeze(["#ff9f1c", "#2ec4b6", "#e71d36", "#9b5de5"]);
const DEFAULT_GAP_NAMES = Object.freeze(["A", "B", "C", "D"]);
const $ = (selector) => document.querySelector(selector);
const canvas = $("#density");
const context = canvas.getContext("2d");
const finalCache = new Map();
const playbackCache = new Map();

let lines = [];
let board = null;
let presetScenarioId = "poc-0-default";
let selectedLine = 0;
let selectedGap = 0;
let dragging = null;
let tracing = null;
let boardStroke = null;
let rectangleStart = null;
let displayed = null;
let playback = null;
let playTimer = null;

function cloneLines(value) {
  return value.map((line) => line.map(([x, y]) => [x, y]));
}

function cloneCells(value) {
  return value.map(([x, y]) => [x, y]);
}

function cloneGaps(value) {
  return value.map(({ name, cells }) => ({ name, cells: cloneCells(cells) }));
}

function compareCells([leftX, leftY], [rightX, rightY]) {
  return leftX - rightX || leftY - rightY;
}

function sortedCells(value) {
  return cloneCells(value).sort(compareCells);
}

function cellKey([x, y]) {
  return `${x},${y}`;
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

function boardFromScenario(scenarioId, gapWidth) {
  const scenario = scenarioFor(scenarioId, gapWidth);
  return {
    scenarioId,
    source: sortedCells(scenario.source),
    sink: sortedCells(scenario.sink),
    blocked: sortedCells(scenario.blocked ?? []),
    gaps: (scenario.gaps ?? []).map(({ name, cells }) => ({ name, cells: sortedCells(cells) })),
  };
}

function setCustom() {
  if (board.scenarioId === "custom") return;
  board.scenarioId = "custom";
  $("#scenario-id").value = "custom";
  $("#gap-width").disabled = true;
}

function currentConfig(
  steps = integerValue("#steps", "steps"),
  sampleInterval = integerValue("#sample-interval", "sampleInterval"),
) {
  if (steps < 1 || steps > MAX_STEPS) {
    throw new RangeError(`steps must be an integer in [1, ${MAX_STEPS}]`);
  }
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
    sampleInterval,
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
      if (point[0] < 0 || point[0] >= DEFAULT_CONFIG.width * Q || point[1] < 0 || point[1] >= DEFAULT_CONFIG.height * Q) {
        throw new RangeError("control point is outside the field");
      }
    }
  }
}

function validateCell(point, label) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)) {
    throw new TypeError(`${label} must be an integer [x, y] cell`);
  }
  if (point[0] < 0 || point[0] >= DEFAULT_CONFIG.width || point[1] < 0 || point[1] >= DEFAULT_CONFIG.height) {
    throw new RangeError(`${label} is outside the field`);
  }
}

function cellSet(cells, label) {
  const result = new Set();
  cells.forEach((cell, index) => {
    validateCell(cell, `${label}[${index}]`);
    const key = cellKey(cell);
    if (result.has(key)) throw new RangeError(`${label} must not contain duplicate coordinates`);
    result.add(key);
  });
  return result;
}

function validateBoard(candidate = board) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("board must be an object");
  if (!Array.isArray(candidate.source) || candidate.source.length === 0) throw new RangeError("source needs at least one cell");
  if (!Array.isArray(candidate.sink) || candidate.sink.length === 0) throw new RangeError("sink needs at least one cell");
  if (!Array.isArray(candidate.blocked)) throw new TypeError("blocked must be an array");
  if (!Array.isArray(candidate.gaps) || candidate.gaps.length > 4) throw new RangeError("gaps must contain at most four groups");
  const blocked = cellSet(candidate.blocked, "blocked");
  const source = cellSet(candidate.source, "source");
  const sink = cellSet(candidate.sink, "sink");
  for (const key of source) if (blocked.has(key)) throw new RangeError("source cells must not be blocked");
  for (const key of sink) if (blocked.has(key)) throw new RangeError("sink cells must not be blocked");
  const gapNames = new Set();
  const gapCells = new Set();
  candidate.gaps.forEach((gap, gapIndex) => {
    if (!gap || typeof gap !== "object" || Array.isArray(gap) || !Array.isArray(gap.cells)) {
      throw new TypeError(`gaps[${gapIndex}] must contain cells`);
    }
    if (typeof gap.name !== "string" || gap.name.length === 0 || gapNames.has(gap.name)) {
      throw new RangeError("gap names must be non-empty and unique");
    }
    gapNames.add(gap.name);
    const cells = cellSet(gap.cells, `gaps[${gapIndex}].cells`);
    for (const key of cells) {
      if (blocked.has(key)) throw new RangeError("gap cells must not be blocked");
      if (gapCells.has(key)) throw new RangeError("gap cells must not overlap");
      gapCells.add(key);
    }
  });
}

function stateObject() {
  return {
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    scenarioId: board.scenarioId,
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
      sampleInterval: Number($("#sample-interval").value),
    },
    seed: Number($("#seed").value),
    lines: cloneLines(lines),
    blocked: cloneCells(board.blocked),
    source: cloneCells(board.source),
    sink: cloneCells(board.sink),
    gaps: cloneGaps(board.gaps),
  };
}

function requestFor(
  steps = integerValue("#steps", "steps"),
  sampleInterval = integerValue("#sample-interval", "sampleInterval"),
) {
  validateLines();
  validateBoard();
  return {
    lines: cloneLines(lines),
    source: cloneCells(board.source),
    sink: cloneCells(board.sink),
    seed: integerValue("#seed", "seed"),
    config: currentConfig(steps, sampleInterval),
    blocked: cloneCells(board.blocked),
    gaps: cloneGaps(board.gaps),
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
  const hashLength = hash.length + 1;
  $("#url-length").textContent = `URLハッシュ: ${hashLength}文字`;
  if (hashLength > MAX_URL_HASH_LENGTH) {
    const cleanUrl = new URL(location.href);
    cleanUrl.hash = "";
    history.replaceState(null, "", cleanUrl);
    $("#copy-url").disabled = true;
    $("#url-warning").textContent = "盤面または制御点が多いため URL 共有できません。JSON で保存してください";
    return false;
  }
  history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`);
  $("#copy-url").disabled = false;
  $("#url-warning").textContent = "";
  return true;
}

function updateValidation() {
  let message = "実行可能";
  let invalid = false;
  try {
    validateLines();
    validateBoard();
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
  const total = lines.reduce((sum, points) => sum + points.length, 0);
  $("#control-point-count").textContent = `制御点: 合計 ${total}点`;
  $("#add-line").disabled = lines.length >= 5;
  $("#remove-line").disabled = lines.length === 0;
  $("#undo-point").disabled = !lines[selectedLine]?.length;
  updateValidation();
}

function renderBoardControls() {
  $("#blocked-count").textContent = `障害物: ${board.blocked.length}セル`;
  const container = $("#gap-list");
  container.replaceChildren();
  board.gaps.forEach((gap, index) => {
    const row = document.createElement("div");
    row.className = "gap-row";
    row.setAttribute("aria-selected", String(index === selectedGap));
    const name = document.createElement("input");
    name.value = gap.name;
    name.ariaLabel = `ギャップ ${index + 1} の名前`;
    name.style.borderColor = GAP_COLORS[index];
    name.addEventListener("focus", () => {
      selectedGap = index;
      container.querySelectorAll(".gap-row").forEach((candidate, rowIndex) => candidate.setAttribute("aria-selected", String(rowIndex === index)));
      drawDisplayed();
    });
    name.addEventListener("change", () => {
      gap.name = name.value;
      setCustom();
      renderBoardControls();
      stateChanged();
    });
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = `${gap.cells.length}セル`;
    select.addEventListener("click", () => {
      selectedGap = index;
      $("#editor-mode").value = "gap";
      renderBoardControls();
      drawDisplayed();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      board.gaps.splice(index, 1);
      selectedGap = Math.max(0, Math.min(selectedGap, board.gaps.length - 1));
      setCustom();
      renderBoardControls();
      stateChanged();
    });
    row.append(name, select, remove);
    container.append(row);
  });
  $("#add-gap").disabled = board.gaps.length >= 4;
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
      const pixelX = (x * CELL_SIZE) / Q + CELL_SIZE / 2;
      const pixelY = (y * CELL_SIZE) / Q + CELL_SIZE / 2;
      if (pointIndex === 0) context.moveTo(pixelX, pixelY);
      else context.lineTo(pixelX, pixelY);
    });
    context.stroke();
    points.forEach(([x, y]) => {
      context.fillStyle = LINE_COLORS[lineIndex];
      context.beginPath();
      context.arc((x * CELL_SIZE) / Q + CELL_SIZE / 2, (y * CELL_SIZE) / Q + CELL_SIZE / 2, lineIndex === selectedLine ? 4 : 3, 0, Math.PI * 2);
      context.fill();
    });
  });
}

function geometry() {
  const config = currentConfig();
  const blockedMask = new Uint8Array(config.width * config.height);
  for (const [x, y] of board.blocked) blockedMask[y * config.width + x] = 1;
  let corridorDistance = null;
  try {
    validateLines();
    const field = burnLines(lines, config);
    corridorDistance = buildRestoreField(field.lineMask, blockedMask, config).distance;
  } catch {
    // Invalid lines remain visible and execution stays disabled.
  }
  return { config, corridorDistance };
}

function drawOverlays() {
  let current;
  try {
    current = geometry();
  } catch {
    drawLines();
    return;
  }
  const { config, corridorDistance } = current;
  if ($("#show-blocked").checked) {
    context.fillStyle = "rgb(120 128 145 / 0.8)";
    for (const [x, y] of board.blocked) context.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
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
  board.gaps.forEach((gap, index) => {
    context.fillStyle = `${GAP_COLORS[index]}99`;
    for (const [x, y] of gap.cells) context.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    if (gap.cells.length > 0) {
      const [x, y] = gap.cells[0];
      context.fillStyle = GAP_COLORS[index];
      context.font = "bold 10px ui-monospace";
      context.fillText(gap.name, x * CELL_SIZE + 1, y * CELL_SIZE + 9);
    }
  });
  for (const point of board.source) drawMarker(point, "#ff4fd8");
  for (const point of board.sink) drawMarker(point, "#62ff7a");
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
  const central = measure?.gapThroughput?.central;
  const detour = measure?.gapThroughput?.detour;
  const gapEntries = measure ? Object.entries(measure.gapThroughput) : [];
  $("#metric-gap").textContent = gapEntries.length > 0 ? gapEntries.map(([name, value]) => `${name}: ${value}`).join(" / ") : "—";
  $("#metric-central-ratio").textContent = central !== undefined && detour !== undefined && central + detour > 0
    ? `${((central * 100) / (central + detour)).toFixed(2)}%`
    : "—";
  $("#metric-density-max").textContent = measure ? metricCell(measure.densityMaxExSource, measure.densityMaxExSourceCell) : "—";
  $("#metric-blocked-front").textContent = measure ? metricCell(measure.blockedFrontDensityMax, measure.blockedFrontDensityMaxCell) : "—";
  $("#metric-field-edge").textContent = measure ? metricCell(measure.fieldEdgeDensityMax, measure.fieldEdgeDensityMaxCell) : "—";
  $("#metric-occupied").textContent = measure ? String(measure.occupiedCellsPeak) : "—";
  $("#metric-hash").textContent = result?.stateHash ?? "—";
  showTimeline(measure?.timeline ?? null);
}

function timelineGapNames(timeline) {
  return timeline.length === 0 ? [] : Object.keys(timeline[0].gapThroughput);
}

function intervalRate(timeline, index, gapName) {
  const current = timeline[index];
  const previous = index === 0 ? { step: 0, gapThroughput: {} } : timeline[index - 1];
  return ((current.gapThroughput[gapName] - (previous.gapThroughput[gapName] ?? 0)) / (current.step - previous.step)).toFixed(1);
}

function showTimeline(timeline) {
  const panel = $("#timeline-panel");
  panel.hidden = !timeline || timeline.length === 0;
  if (panel.hidden) {
    $("#timeline-table").replaceChildren();
    return;
  }
  const gapNames = timelineGapNames(timeline);
  const headers = [
    "step", "completed（累積）", "outOfField（累積）", "remaining（瞬時）",
    ...gapNames.map((name) => `gap.${name}（累積）`),
    ...gapNames.map((name) => `gap.${name} 区間量/step`),
    "blockedFrontDensityMax（瞬時）", "densityMaxExSource（瞬時）", "occupiedCells（瞬時）",
  ];
  const table = $("#timeline-table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  timeline.forEach((sample, index) => {
    const values = [
      sample.step, sample.completed, sample.outOfField, sample.remaining,
      ...gapNames.map((name) => sample.gapThroughput[name]),
      ...gapNames.map((name) => intervalRate(timeline, index, name)),
      sample.blockedFrontDensityMax, sample.densityMaxExSource, sample.occupiedCells,
    ];
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value ?? "";
      row.append(cell);
    }
    body.append(row);
  });
  table.replaceChildren(head, body);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function timelineCsv(timeline) {
  const gapNames = timelineGapNames(timeline);
  const rows = timeline.map((sample) => [
    sample.step, sample.completed, sample.outOfField, sample.remaining,
    ...gapNames.map((name) => sample.gapThroughput[name]),
    sample.blockedFrontDensityMax, sample.densityMaxExSource, sample.occupiedCells,
  ]);
  return [
    ["step", "completed", "outOfField", "remaining", ...gapNames.map((name) => `gapThroughput.${name}`),
      "blockedFrontDensityMax", "densityMaxExSource", "occupiedCells"],
    ...rows,
  ].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function downloadTimeline() {
  const timeline = displayed?.result?.measurements?.timeline;
  if (!timeline || timeline.length === 0) return;
  const blob = new Blob([timelineCsv(timeline)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `flowcast-timeline-${$("#scenario-id").value}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function drawDisplayed() {
  const result = displayed?.result ?? null;
  const maximum = displayed?.scaleMaximum ?? currentMaximum(result?.density ?? []);
  drawDensity(result, maximum);
  drawOverlays();
  showMetrics(result, displayed?.step);
}

function stateChanged(updateShare = true) {
  stopPlaying();
  playback = null;
  $("#frame-range").disabled = true;
  $("#play").disabled = true;
  $("#frame-label").textContent = "最終状態モード";
  updateValidation();
  if (updateShare) updateUrl();
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
      frames.push({ step: steps[index], result: runSimulation(requestFor(steps[index], 0)) });
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
  const scenario = scenarioFor(presetScenarioId, Number($("#gap-width").value));
  lines = cloneLines(scenario.inputs[name]);
  selectedLine = 0;
  renderLineList();
  stateChanged();
}

function loadScenarioPreset() {
  const scenarioId = $("#scenario-id").value;
  if (scenarioId === "custom") return;
  presetScenarioId = scenarioId;
  board = boardFromScenario(scenarioId, Number($("#gap-width").value));
  selectedGap = 0;
  renderBoardControls();
  loadPreset("distributed");
}

function applyState(replay) {
  if (replay === null || typeof replay !== "object" || Array.isArray(replay)) throw new TypeError("viewer state must be an object");
  if (![1, 2, FORMAT_VERSION].includes(replay.formatVersion)) {
    throw new RangeError(`unsupported formatVersion: ${replay.formatVersion}`);
  }
  if (replay.scenarioId !== "custom") scenarioFor(replay.scenarioId, replay.gapWidth);
  if (replay.formatVersion < FORMAT_VERSION && replay.scenarioId === "custom") {
    throw new RangeError("legacy states cannot reconstruct a custom board");
  }
  const replayLines = replay.formatVersion === 1 ? cellLinesToQ(replay.lines) : cloneLines(replay.lines);
  validateLines(replayLines);
  const replayBoard = replay.formatVersion < FORMAT_VERSION
    ? boardFromScenario(replay.scenarioId, replay.gapWidth)
    : {
        scenarioId: replay.scenarioId,
        blocked: cloneCells(replay.blocked),
        source: cloneCells(replay.source),
        sink: cloneCells(replay.sink),
        gaps: cloneGaps(replay.gaps),
      };
  validateBoard(replayBoard);
  replayBoard.blocked = sortedCells(replayBoard.blocked);
  replayBoard.source = sortedCells(replayBoard.source);
  replayBoard.sink = sortedCells(replayBoard.sink);
  replayBoard.gaps = replayBoard.gaps.map(({ name, cells }) => ({ name, cells: sortedCells(cells) }));
  $("#scenario-id").value = replay.scenarioId;
  $("#gap-width").value = String(replay.gapWidth);
  const selectors = {
    corridorWidth: "#corridor-width", restoreWeight: "#restore-weight", congestionWeight: "#congestion-weight",
    congestionReference: "#congestion-reference", edgeFluxMax: "#edge-flux-max", advectionWeight: "#advection-weight",
    diffusionWeight: "#diffusion-weight", steps: "#steps", sampleInterval: "#sample-interval",
  };
  for (const [key, selector] of Object.entries(selectors)) {
    if (Object.hasOwn(replay.parameters, key)) $(selector).value = String(replay.parameters[key]);
  }
  $("#corridor-blocks-out-of-field").checked = replay.parameters.corridorBlocksOutOfField;
  $("#seed").value = String(replay.seed);
  lines = replayLines;
  board = replayBoard;
  if (replay.scenarioId !== "custom") presetScenarioId = replay.scenarioId;
  selectedLine = 0;
  currentConfig();
  integerValue("#seed", "seed");
  $("#gap-width").disabled = replay.scenarioId !== "poc-2-canyon";
  $("#warning").textContent = replay.engineVersion === ENGINE_VERSION ? "" : `警告: engineVersion ${replay.engineVersion} を現行 ${ENGINE_VERSION} で読み込みました`;
  renderLineList();
  renderBoardControls();
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

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  const fieldX = (((event.clientX - bounds.left) * canvas.width) / bounds.width / CELL_SIZE - 0.5) * Q;
  const fieldY = (((event.clientY - bounds.top) * canvas.height) / bounds.height / CELL_SIZE - 0.5) * Q;
  const x = Math.max(0, Math.min(DEFAULT_CONFIG.width * Q - 1, Math.round(fieldX)));
  const y = Math.max(0, Math.min(DEFAULT_CONFIG.height * Q - 1, Math.round(fieldY)));
  return [x, y];
}

function canvasCell(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(DEFAULT_CONFIG.width - 1, Math.floor(((event.clientX - bounds.left) * canvas.width) / bounds.width / CELL_SIZE)));
  const y = Math.max(0, Math.min(DEFAULT_CONFIG.height - 1, Math.floor(((event.clientY - bounds.top) * canvas.height) / bounds.height / CELL_SIZE)));
  return [x, y];
}

function includesCell(cells, cell) {
  const key = cellKey(cell);
  return cells.some((candidate) => cellKey(candidate) === key);
}

function removeCell(cells, cell) {
  const key = cellKey(cell);
  const index = cells.findIndex((candidate) => cellKey(candidate) === key);
  if (index < 0) return false;
  cells.splice(index, 1);
  return true;
}

function cellHasMarker(cell) {
  return includesCell(board.source, cell)
    || includesCell(board.sink, cell)
    || board.gaps.some((gap) => includesCell(gap.cells, cell));
}

function applyBoardCell(cell, mode) {
  let changed = false;
  if (mode === "blocked-toggle") {
    if (removeCell(board.blocked, cell)) changed = true;
    else if (cellHasMarker(cell)) setStatus("源・シンク・ギャップのセルは障害物にできません", true);
    else { board.blocked.push(cell); changed = true; }
  } else if (mode === "blocked-paint" || mode === "blocked-rect-paint") {
    if (includesCell(board.blocked, cell)) return false;
    if (cellHasMarker(cell)) setStatus("源・シンク・ギャップのセルは障害物にできません", true);
    else { board.blocked.push(cell); changed = true; }
  } else if (mode === "blocked-erase" || mode === "blocked-rect-erase") {
    changed = removeCell(board.blocked, cell);
  } else if (mode === "source" || mode === "sink") {
    if (includesCell(board.blocked, cell)) {
      setStatus(`${mode === "source" ? "源" : "シンク"}は障害物セルに置けません`, true);
    } else {
      const cells = mode === "source" ? board.source : board.sink;
      if (!removeCell(cells, cell)) cells.push(cell);
      changed = true;
    }
  } else if (mode === "remove-marker") {
    changed = removeCell(board.source, cell) || changed;
    changed = removeCell(board.sink, cell) || changed;
    for (const gap of board.gaps) changed = removeCell(gap.cells, cell) || changed;
  } else if (mode === "gap") {
    const gap = board.gaps[selectedGap];
    if (!gap) {
      setStatus("先にギャップ群を追加してください", true);
    } else if (includesCell(board.blocked, cell)) {
      setStatus("障害物セルはギャップに登録できません", true);
    } else if (removeCell(gap.cells, cell)) {
      changed = true;
    } else if (board.gaps.some((candidate, index) => index !== selectedGap && includesCell(candidate.cells, cell))) {
      setStatus("ギャップセルは複数の群に重複登録できません", true);
    } else {
      gap.cells.push(cell);
      changed = true;
    }
  }
  if (!changed) return false;
  board.blocked.sort(compareCells);
  board.source.sort(compareCells);
  board.sink.sort(compareCells);
  board.gaps.forEach((gap) => gap.cells.sort(compareCells));
  setCustom();
  return true;
}

function applyRectangle(start, end, mode) {
  let changed = false;
  const left = Math.min(start[0], end[0]);
  const right = Math.max(start[0], end[0]);
  const top = Math.min(start[1], end[1]);
  const bottom = Math.max(start[1], end[1]);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) changed = applyBoardCell([x, y], mode) || changed;
  }
  return changed;
}

function findPoint([x, y]) {
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    for (let pointIndex = lines[lineIndex].length - 1; pointIndex >= 0; pointIndex -= 1) {
      const [pointX, pointY] = lines[lineIndex][pointIndex];
      if (Math.abs(pointX - x) <= Q && Math.abs(pointY - y) <= Q) return { lineIndex, pointIndex };
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (event) => {
  const editorMode = $("#editor-mode").value;
  if (editorMode !== "line") {
    const cell = canvasCell(event);
    if (editorMode.startsWith("blocked-rect-")) {
      rectangleStart = { cell, pointerId: event.pointerId, mode: editorMode };
    } else {
      applyBoardCell(cell, editorMode);
      boardStroke = { pointerId: event.pointerId, mode: editorMode, visited: new Set([cellKey(cell)]) };
    }
    canvas.setPointerCapture(event.pointerId);
    renderBoardControls();
    stateChanged(false);
    return;
  }
  const point = canvasPoint(event);
  const found = findPoint(point);
  if (found) {
    dragging = found;
    selectedLine = found.lineIndex;
    canvas.setPointerCapture(event.pointerId);
  } else if (lines[selectedLine]) {
    if ($("#drawing-mode").value === "trace") {
      lines[selectedLine] = [point];
      tracing = { lineIndex: selectedLine, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    } else {
      lines[selectedLine].push(point);
    }
  }
  renderLineList();
  stateChanged(false);
});
canvas.addEventListener("pointermove", (event) => {
  if (boardStroke && boardStroke.pointerId === event.pointerId) {
    if (!["blocked-paint", "blocked-erase"].includes(boardStroke.mode)) return;
    const cell = canvasCell(event);
    const key = cellKey(cell);
    if (boardStroke.visited.has(key)) return;
    boardStroke.visited.add(key);
    applyBoardCell(cell, boardStroke.mode);
    renderBoardControls();
    stateChanged(false);
    return;
  }
  const point = canvasPoint(event);
  if (dragging) {
    lines[dragging.lineIndex][dragging.pointIndex] = point;
  } else if (tracing && tracing.pointerId === event.pointerId) {
    const points = lines[tracing.lineIndex];
    const previous = points[points.length - 1];
    const threshold = Number($("#trace-spacing").value) * Q;
    if (threshold > 0 && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < threshold) return;
    if (threshold === 0 && point[0] === previous[0] && point[1] === previous[1]) return;
    points.push(point);
  } else {
    return;
  }
  stateChanged(false);
});
canvas.addEventListener("pointerup", (event) => {
  if (rectangleStart && rectangleStart.pointerId === event.pointerId) {
    applyRectangle(rectangleStart.cell, canvasCell(event), rectangleStart.mode);
    rectangleStart = null;
    renderBoardControls();
    stateChanged();
    return;
  }
  if (boardStroke && boardStroke.pointerId === event.pointerId) {
    boardStroke = null;
    renderBoardControls();
    stateChanged();
    return;
  }
  dragging = null;
  tracing = null;
  renderLineList();
  stateChanged();
});
canvas.addEventListener("pointercancel", () => {
  dragging = null;
  tracing = null;
  boardStroke = null;
  rectangleStart = null;
});

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
  if ($("#scenario-id").value === "custom") return;
  presetScenarioId = $("#scenario-id").value;
  $("#gap-width").disabled = presetScenarioId !== "poc-2-canyon";
  loadScenarioPreset();
});
$("#load-scenario").addEventListener("click", loadScenarioPreset);
$("#gap-width").addEventListener("change", loadScenarioPreset);
$("#clear-blocked").addEventListener("click", () => {
  if (board.blocked.length === 0) return;
  board.blocked = [];
  setCustom();
  renderBoardControls();
  stateChanged();
});
$("#add-gap").addEventListener("click", () => {
  if (board.gaps.length >= 4) return;
  const used = new Set(board.gaps.map((gap) => gap.name));
  const name = DEFAULT_GAP_NAMES.find((candidate) => !used.has(candidate)) ?? `G${board.gaps.length + 1}`;
  board.gaps.push({ name, cells: [] });
  selectedGap = board.gaps.length - 1;
  $("#editor-mode").value = "gap";
  setCustom();
  renderBoardControls();
  stateChanged();
});

for (const selector of [
  "#corridor-width", "#corridor-blocks-out-of-field", "#restore-weight", "#congestion-weight",
  "#congestion-reference", "#edge-flux-max", "#advection-weight", "#diffusion-weight", "#steps", "#sample-interval", "#seed",
]) $(selector).addEventListener("change", stateChanged);
for (const selector of ["#show-blocked", "#show-lines", "#show-corridor", "#show-field-edge"]) {
  $(selector).addEventListener("change", drawDisplayed);
}

$("#run-final").addEventListener("click", () => void runFinal());
$("#build-playback").addEventListener("click", () => void buildPlayback());
$("#play").addEventListener("click", togglePlayback);
$("#frame-range").addEventListener("input", () => showPlaybackFrame(Number($("#frame-range").value)));
$("#download-timeline").addEventListener("click", downloadTimeline);
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
  $("#sample-interval").value = String(DEFAULT_CONFIG.sampleInterval);
  $("#seed").value = String(DEFAULT_SEED);
  $("#gap-width").disabled = true;
  presetScenarioId = "poc-0-default";
  board = boardFromScenario(presetScenarioId, Number($("#gap-width").value));
  lines = cloneLines(scenarioFor(presetScenarioId).inputs.distributed);
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
  renderBoardControls();
  updateUrl();
  drawDisplayed();
}

initializeDefaults();
