import { createConfig, DEFAULT_CONFIG, Q } from "../src/config.js";
import { runSimulation } from "../src/simulation.js";
import { ENGINE_VERSION } from "../src/scenarios.js";

const CELL_SIZE = 10;
const MIN_POINT_DISTANCE = Q / 4;
const LINE_COLORS = ["#ddd", "#bbb", "#999", "#777", "#555"];
const canvas = document.querySelector("#board");
const context = canvas.getContext("2d");
const elements = Object.fromEntries([
  "line-list", "line-status", "add-line", "remove-line", "reset", "run", "save", "load",
  "status", "result-panel", "judgment", "conditions", "state-hash", "scores", "score-speed",
  "score-quantity", "score-focus", "score-moves", "challenge-title", "challenge-goal",
  "challenge-constraints", "challenge-current", "challenge-steps", "sink-legend", "playback",
  "playback-step", "playback-slider", "replay",
].map((id) => [id, document.querySelector(`#${id}`)]));

let challenge;
let lines = [];
let selectedLine = 0;
let tracing = null;
let displayedDensity = null;
let lastResult = null;

const PLAYBACK_FRAME_MS = 75;
const SINK_COLORS = ["#65b9ff", "#ffb36b"];
let playbackFrames = [];
let playbackMaximum = 0;
let playbackIndex = 0;
let playbackTimer = null;

function clone(value) {
  return structuredClone(value);
}

function validateLines(candidate) {
  if (!Array.isArray(candidate) || candidate.length < 3 || candidate.length > 5) {
    throw new RangeError("線は3〜5本にしてください");
  }
  for (const line of candidate) {
    if (!Array.isArray(line) || line.length < 2) throw new RangeError("各線には2点以上が必要です");
    for (const point of line) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)) {
        throw new TypeError("制御点はQ16.16整数の[x, y]である必要があります");
      }
      if (point[0] < 0 || point[0] >= DEFAULT_CONFIG.width * Q || point[1] < 0 || point[1] >= DEFAULT_CONFIG.height * Q) {
        throw new RangeError("制御点が盤面外です");
      }
    }
  }
}

function config() {
  return createConfig(challenge.parameters);
}

function simulationRequest() {
  validateLines(lines);
  return {
    lines: clone(lines),
    source: clone(challenge.source),
    sink: clone(challenge.sink),
    blocked: clone(challenge.blocked),
    gaps: clone(challenge.gaps),
    sinkGroups: clone(challenge.sinkGroups),
    seed: challenge.seed,
    config: config(),
    measure: true,
  };
}

function linePointCount() {
  return lines.reduce((total, line) => total + line.length, 0);
}

function percent(value) {
  return `${Number(value).toFixed(2)}%`;
}

function sinkColor(name) {
  const index = challenge.sinkGroups.findIndex((group) => group.name === name);
  return SINK_COLORS[index] ?? "#fff";
}

function renderChallenge() {
  elements["challenge-title"].textContent = challenge.title;
  elements["challenge-goal"].textContent = `${challenge.sinkGroups[0].name} に ${challenge.goal.upperRatioMin}〜${challenge.goal.upperRatioMax}% を届ける`;
  elements["challenge-constraints"].textContent = `場外損失 ${challenge.constraints.outOfFieldRatioMax}% / 到達率 ${challenge.constraints.completionRatioMin}% 以上`;
  elements["challenge-steps"].textContent = `${challenge.parameters.steps} steps`;
  elements["sink-legend"].replaceChildren(...challenge.sinkGroups.map((group) => {
    const row = document.createElement("div");
    const marker = document.createElement("span");
    marker.style.background = sinkColor(group.name);
    row.append(marker, document.createTextNode(`${group.name}: —`));
    return row;
  }));
}

function renderCurrent() {
  if (!lastResult) {
    elements["challenge-current"].textContent = "—";
    renderChallenge();
    return;
  }
  const evaluation = lastResult.evaluation;
  elements["challenge-current"].textContent = `${challenge.sinkGroups[0].name} ${percent(evaluation.upperRatio)} / 場外 ${percent(evaluation.outOfFieldRatio)} / 到達率 ${percent(evaluation.completionRatio)}`;
  elements["sink-legend"].replaceChildren(...challenge.sinkGroups.map((group) => {
    const row = document.createElement("div");
    const marker = document.createElement("span");
    marker.style.background = sinkColor(group.name);
    const throughput = lastResult.measurements.sinkThroughput[group.name] ?? 0;
    row.append(marker, document.createTextNode(`${group.name}: ${throughput.toLocaleString()}`));
    return row;
  }));
}

function evaluate(result) {
  const measure = result.measurements;
  const upper = measure.sinkThroughput.upper;
  const lower = measure.sinkThroughput.lower;
  const delivered = upper + lower;
  const upperRatio = delivered === 0 ? 0 : (upper * 100) / delivered;
  const constraintPassed = measure.outOfFieldRatio <= challenge.constraints.outOfFieldRatioMax
    && measure.completionRatio >= challenge.constraints.completionRatioMin;
  const goalPassed = constraintPassed
    && upperRatio >= challenge.goal.upperRatioMin
    && upperRatio <= challenge.goal.upperRatioMax;
  const judgment = goalPassed ? "クリア" : "失敗";
  const densityTotal = measure.lineDistanceDensity.reduce((total, value) => total + value, 0);
  const axes = goalPassed ? {
    speed: Math.max(...Object.values(measure.sinkFirstArrivalStep)),
    quantity: measure.totalCompleted,
    focusNumerator: measure.lineDistanceDensity[0],
    focusDenominator: densityTotal,
    focusRatio: densityTotal === 0 ? 0 : measure.lineDistanceDensity[0] / densityTotal,
    lineCount: lines.length,
    controlPointCount: linePointCount(),
  } : null;
  return {
    judgment,
    failedStage: constraintPassed ? (goalPassed ? null : "goal") : "constraint",
    outOfFieldRatio: measure.outOfFieldRatio,
    completionRatio: measure.completionRatio,
    upperThroughput: upper,
    lowerThroughput: lower,
    upperRatio,
    axes,
  };
}

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.dataset.error = String(error);
}

function renderResult() {
  elements["result-panel"].hidden = !lastResult;
  if (!lastResult) {
    elements.scores.hidden = true;
    elements.save.disabled = true;
    return;
  }
  const { evaluation, stateHash } = lastResult;
  elements.judgment.textContent = evaluation.judgment;
  elements.conditions.replaceChildren();
  const rows = [
    ["場外損失", `${percent(evaluation.outOfFieldRatio)}（${challenge.constraints.outOfFieldRatioMax}% 以下が必要）`],
    ["到達率", `${percent(evaluation.completionRatio)}（${challenge.constraints.completionRatioMin}% 以上が必要）`],
    ["upper 比率", evaluation.failedStage === "constraint"
      ? "未評価（制約未達）"
      : `${percent(evaluation.upperRatio)}（${challenge.goal.upperRatioMin}〜${challenge.goal.upperRatioMax}% が必要）`],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    elements.conditions.append(term, description);
  }
  elements["state-hash"].textContent = stateHash;
  elements.scores.hidden = evaluation.axes === null;
  if (evaluation.axes) {
    const axes = evaluation.axes;
    elements["score-speed"].textContent = `${axes.speed} step`;
    elements["score-quantity"].textContent = String(axes.quantity);
    elements["score-focus"].textContent = `${axes.focusNumerator} / ${axes.focusDenominator} (${(axes.focusRatio * 100).toFixed(2)}%)`;
    elements["score-moves"].textContent = `${axes.lineCount}本 / ${axes.controlPointCount}点`;
  }
  elements.save.disabled = false;
}

function heatColor(amount, maximum) {
  if (amount <= 0 || maximum <= 0) return "#080808";
  const lightness = 15 + 65 * (Math.log1p(amount) / Math.log1p(maximum));
  return `hsl(0 0% ${lightness}%)`;
}

function drawMarker([x, y], shape, color = "#fff") {
  context.strokeStyle = color;
  context.lineWidth = 2;
  if (shape === "source") context.strokeRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, 6, 6);
  else {
    context.beginPath();
    context.arc(x * CELL_SIZE + 5, y * CELL_SIZE + 5, 4, 0, Math.PI * 2);
    context.stroke();
  }
}

function draw() {
  const density = displayedDensity ?? new Int32Array(DEFAULT_CONFIG.width * DEFAULT_CONFIG.height);
  let maximum = playbackMaximum;
  if (maximum === 0) for (const amount of density) maximum = Math.max(maximum, amount);
  for (let index = 0; index < density.length; index += 1) {
    context.fillStyle = heatColor(density[index], maximum);
    context.fillRect((index % 64) * CELL_SIZE, Math.floor(index / 64) * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }
  context.fillStyle = "#555";
  for (const [x, y] of challenge.blocked) context.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  for (const lineGroup of challenge.gaps) {
    context.fillStyle = "#888";
    for (const [x, y] of lineGroup.cells) context.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, 6, 6);
  }
  lines.forEach((line, index) => {
    context.strokeStyle = LINE_COLORS[index];
    context.lineWidth = index === selectedLine ? 3 : 2;
    context.beginPath();
    line.forEach(([x, y], pointIndex) => {
      const px = (x / Q) * CELL_SIZE + CELL_SIZE / 2;
      const py = (y / Q) * CELL_SIZE + CELL_SIZE / 2;
      if (pointIndex === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
  });
  for (const point of challenge.source) drawMarker(point, "source");
  for (const group of challenge.sinkGroups) {
    for (const point of group.cells) drawMarker(point, "sink", sinkColor(group.name));
  }
}

function stopPlayback() {
  if (playbackTimer !== null) window.clearTimeout(playbackTimer);
  playbackTimer = null;
}

function showPlaybackFrame(index) {
  playbackIndex = Math.max(0, Math.min(playbackFrames.length - 1, index));
  displayedDensity = playbackFrames[playbackIndex].density;
  elements["playback-slider"].value = String(playbackIndex);
  elements["playback-step"].textContent = `step ${playbackFrames[playbackIndex].step}`;
  draw();
}

function finishPlayback() {
  playbackTimer = null;
  renderResult();
  setStatus("再生完了");
}

function playTimeline() {
  stopPlayback();
  if (playbackFrames.length === 0) {
    renderResult();
    return;
  }
  elements["result-panel"].hidden = true;
  elements.scores.hidden = true;
  showPlaybackFrame(0);
  const advance = () => {
    if (playbackIndex >= playbackFrames.length - 1) {
      finishPlayback();
      return;
    }
    showPlaybackFrame(playbackIndex + 1);
    playbackTimer = window.setTimeout(advance, PLAYBACK_FRAME_MS);
  };
  playbackTimer = window.setTimeout(advance, PLAYBACK_FRAME_MS);
}

function renderLines() {
  elements["line-list"].replaceChildren();
  lines.forEach((line, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `線 ${index + 1}（${line.length}点）`;
    button.ariaPressed = String(index === selectedLine);
    button.addEventListener("click", () => {
      selectedLine = index;
      renderLines();
      draw();
    });
    elements["line-list"].append(button);
  });
  elements["line-status"].textContent = `${lines.length}本 / 制御点${linePointCount()}点`;
  elements["add-line"].disabled = lines.length >= 5;
  elements["remove-line"].disabled = lines.length <= 3;
  elements.run.disabled = false;
  try { validateLines(lines); } catch (error) {
    elements["line-status"].textContent = error.message;
    elements.run.disabled = true;
  }
}

function invalidateResult() {
  stopPlayback();
  displayedDensity = null;
  lastResult = null;
  playbackFrames = [];
  playbackMaximum = 0;
  elements.playback.hidden = true;
  renderResult();
  renderCurrent();
  setStatus("");
  renderLines();
  draw();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = Math.round((((event.clientX - bounds.left) * canvas.width) / bounds.width / CELL_SIZE - 0.5) * Q);
  const y = Math.round((((event.clientY - bounds.top) * canvas.height) / bounds.height / CELL_SIZE - 0.5) * Q);
  return [
    Math.max(0, Math.min(DEFAULT_CONFIG.width * Q - 1, x)),
    Math.max(0, Math.min(DEFAULT_CONFIG.height * Q - 1, y)),
  ];
}

function addTracePoint(point) {
  const previous = tracing.at(-1);
  if (!previous || (point[0] - previous[0]) ** 2 + (point[1] - previous[1]) ** 2 >= MIN_POINT_DISTANCE ** 2) {
    tracing.push(point);
  }
}

canvas.addEventListener("pointerdown", (event) => {
  tracing = [];
  addTracePoint(canvasPoint(event));
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!tracing) return;
  addTracePoint(canvasPoint(event));
});
canvas.addEventListener("pointerup", (event) => {
  if (!tracing) return;
  addTracePoint(canvasPoint(event));
  if (tracing.length >= 2) lines[selectedLine] = tracing;
  tracing = null;
  invalidateResult();
});

elements["add-line"].addEventListener("click", () => {
  if (lines.length >= 5) return;
  lines.push([[4 * Q, 32 * Q], [59 * Q, 32 * Q]]);
  selectedLine = lines.length - 1;
  invalidateResult();
});
elements["remove-line"].addEventListener("click", () => {
  if (lines.length <= 3) return;
  lines.splice(selectedLine, 1);
  selectedLine = Math.min(selectedLine, lines.length - 1);
  invalidateResult();
});
elements.reset.addEventListener("click", () => {
  lines = clone(challenge.lines);
  selectedLine = 0;
  invalidateResult();
});

async function run() {
  try {
    elements.run.disabled = true;
    elements["result-panel"].hidden = true;
    elements.scores.hidden = true;
    setStatus("計算中…");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const started = performance.now();
    const result = runSimulation(simulationRequest());
    const evaluation = evaluate(result);
    lastResult = { evaluation, stateHash: result.stateHash, measurements: result.measurements };
    playbackFrames = (result.measurements.timeline ?? []).filter((sample) => sample.density instanceof Int32Array);
    playbackMaximum = playbackFrames.reduce((maximum, sample) => sample.density.reduce((value, amount) => Math.max(value, amount), maximum), 0);
    displayedDensity = result.density;
    elements.playback.hidden = playbackFrames.length === 0;
    elements["playback-slider"].max = String(Math.max(0, playbackFrames.length - 1));
    renderCurrent();
    setStatus(`計算完了（${(performance.now() - started).toFixed(1)} ms）。再生中…`);
    playTimeline();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    renderLines();
  }
}


elements.replay.addEventListener("click", playTimeline);
elements["playback-slider"].addEventListener("input", () => {
  stopPlayback();
  showPlaybackFrame(Number(elements["playback-slider"].value));
  renderResult();
});

elements.run.addEventListener("click", run);

function savedState() {
  if (!lastResult) throw new Error("先に実行してください");
  return {
    formatVersion: 4,
    engineVersion: ENGINE_VERSION,
    challengeId: challenge.challengeId,
    scenarioId: challenge.scenarioId,
    gapWidth: challenge.gapWidth,
    parameters: clone(challenge.parameters),
    seed: challenge.seed,
    lines: clone(lines),
    blocked: clone(challenge.blocked),
    source: clone(challenge.source),
    sink: clone(challenge.sink),
    gaps: clone(challenge.gaps),
    sinkGroups: clone(challenge.sinkGroups),
    stateHash: lastResult.stateHash,
    result: {
      ...clone(lastResult.evaluation),
      measurements: clone(lastResult.measurements),
      density: Array.from(displayedDensity),
    },
  };
}

elements.save.addEventListener("click", () => {
  const blob = new Blob([`${JSON.stringify(savedState(), null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "flowcast-step-18-solution.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

function sameGeometry(candidate) {
  return ["blocked", "source", "sink", "gaps"].every((key) => JSON.stringify(candidate[key]) === JSON.stringify(challenge[key]));
}

elements.load.addEventListener("change", async () => {
  try {
    const file = elements.load.files[0];
    if (!file) return;
    const state = JSON.parse(await file.text());
    if (state.formatVersion !== 4) throw new RangeError("formatVersion 4 のJSONが必要です");
    if (!sameGeometry(state)) throw new RangeError("課題の盤面と一致しません");
    validateLines(state.lines);
    lines = clone(state.lines);
    selectedLine = 0;
    displayedDensity = state.result?.density ? Int32Array.from(state.result.density) : null;
    lastResult = state.result && state.stateHash ? {
      evaluation: clone(state.result),
      stateHash: state.stateHash,
      measurements: clone(state.result.measurements),
    } : null;
    playbackFrames = [];
    playbackMaximum = 0;
    elements.playback.hidden = true;
    renderLines();
    renderResult();
    renderCurrent();
    draw();
    setStatus(state.engineVersion === ENGINE_VERSION ? "JSONを読み込みました" : `engineVersion ${state.engineVersion} を読み込みました`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    elements.load.value = "";
  }
});

challenge = await fetch("./challenge.json").then((response) => {
  if (!response.ok) throw new Error(`challenge.json: HTTP ${response.status}`);
  return response.json();
});
if (challenge.engineVersion !== ENGINE_VERSION) throw new Error("課題のengineVersionが一致しません");
lines = clone(challenge.lines);
renderChallenge();
renderLines();
renderResult();
renderCurrent();
draw();
window.flowcastGame = { run, savedState: () => clone(savedState()), challenge: () => clone(challenge) };
