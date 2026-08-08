import { Q } from "./config.js";

const point = (x, y) => [x * Q, y * Q];

export const ENGINE_VERSION = "0.9.0";
export const SCENARIO_ID = "poc-0-default";
export const WIDE_SCENARIO_ID = "poc-1-wide";
export const CANYON_SCENARIO_ID = "poc-2-canyon";
export const DEFAULT_SEED = 0x13579bdf;

function freezeCells(cells) {
  return Object.freeze(cells.map(([x, y]) => Object.freeze([x, y])));
}

export const SOURCE = freezeCells([[4, 32]]);
export const SINK = freezeCells([[59, 32]]);

function createCenteredCells(x, width, label) {
  if (!Number.isInteger(width) || width <= 0 || width > 63 || (width & 1) === 0) {
    throw new RangeError(`${label} width must be an odd integer from 1 through 63`);
  }
  const firstY = 32 - ((width / 2) | 0);
  return freezeCells(Array.from({ length: width }, (_, index) => [x, firstY + index]));
}

export function createWideSource(width) {
  return createCenteredCells(4, width, "source");
}

export function createWideSink(width) {
  return createCenteredCells(59, width, "sink");
}

export const WIDE_SOURCE = createWideSource(1);

export const INPUTS = Object.freeze({
  straight: Object.freeze([
    [point(4, 31), point(32, 31), point(59, 32)],
    [point(4, 32), point(32, 32), point(59, 32)],
    [point(4, 33), point(32, 33), point(59, 32)],
  ]),
  distributed: Object.freeze([
    [point(4, 32), point(20, 17), point(44, 17), point(59, 32)],
    [point(4, 32), point(32, 32), point(59, 32)],
    [point(4, 32), point(20, 47), point(44, 47), point(59, 32)],
  ]),
  detour: Object.freeze([
    [point(4, 32), point(16, 23), point(43, 23), point(59, 32)],
    [point(4, 33), point(18, 39), point(42, 39), point(59, 32)],
    [point(4, 31), point(24, 27), point(48, 28), point(59, 32)],
  ]),
});

export const WIDE_INPUTS = INPUTS;

export const CANYON_INPUTS = Object.freeze({
  straight: Object.freeze([
    [point(4, 31), point(24, 31), point(32, 32), point(48, 31), point(59, 31)],
    [point(4, 32), point(32, 32), point(59, 32)],
    [point(4, 33), point(24, 33), point(32, 32), point(48, 33), point(59, 33)],
  ]),
  distributed: Object.freeze([
    [point(4, 31), point(20, 11), point(32, 11), point(44, 11), point(59, 31)],
    [point(4, 32), point(32, 32), point(59, 32)],
    [point(4, 33), point(20, 13), point(32, 13), point(44, 13), point(59, 33)],
  ]),
  detour: Object.freeze([
    [point(4, 31), point(20, 11), point(32, 11), point(44, 11), point(59, 31)],
    [point(4, 32), point(20, 12), point(32, 12), point(44, 12), point(59, 32)],
    [point(4, 33), point(20, 13), point(32, 13), point(44, 13), point(59, 33)],
  ]),
});

export function createCanyonLayout(centralGapWidth) {
  if (![1, 3, 5, 9, 63].includes(centralGapWidth)) {
    throw new RangeError("central gap width must be one of 1, 3, 5, 9, or 63");
  }
  const detourY = [10, 11, 12, 13, 14];
  const centralFirstY = 32 - ((centralGapWidth / 2) | 0);
  const centralY = centralGapWidth === 63
    ? Array.from({ length: 64 }, (_, y) => y).filter((y) => !detourY.includes(y))
    : Array.from({ length: centralGapWidth }, (_, offset) => centralFirstY + offset);
  const open = new Uint8Array(64);
  for (let index = 0; index < centralY.length; index += 1) open[centralY[index]] = 1;
  for (let index = 0; index < detourY.length; index += 1) open[detourY[index]] = 1;
  const blocked = [];
  for (let y = 0; y < 64; y += 1) {
    if (open[y] === 0) blocked.push([32, y]);
  }
  return Object.freeze({
    blocked: freezeCells(blocked),
    gaps: Object.freeze([
      Object.freeze({ name: "central", cells: freezeCells(centralY.map((y) => [32, y])) }),
      Object.freeze({ name: "detour", cells: freezeCells(detourY.map((y) => [32, y])) }),
    ]),
  });
}

export function createCanyonScenario(centralGapWidth = 1) {
  const layout = createCanyonLayout(centralGapWidth);
  return Object.freeze({
    scenarioId: CANYON_SCENARIO_ID,
    source: createWideSource(1),
    sink: createWideSink(5),
    inputs: CANYON_INPUTS,
    blocked: layout.blocked,
    gaps: layout.gaps,
  });
}

export const SCENARIOS = Object.freeze([
  Object.freeze({ scenarioId: SCENARIO_ID, source: SOURCE, sink: SINK, inputs: INPUTS }),
  Object.freeze({ scenarioId: WIDE_SCENARIO_ID, source: WIDE_SOURCE, sink: createWideSink(5), inputs: WIDE_INPUTS }),
  createCanyonScenario(1),
]);

function cloneLines(lines) {
  return lines.map((line) => line.map(([x, y]) => [x, y]));
}

export function createSmallPerturbations(lines = INPUTS.straight) {
  const offsets = [
    [-Q / 2, 0],
    [Q / 2, 0],
    [0, -Q / 2],
    [0, Q / 2],
    [-Q / 4, -Q / 4],
    [Q / 4, Q / 4],
    [-Q / 3 | 0, Q / 3 | 0],
    [Q / 3 | 0, -Q / 3 | 0],
    [-Q / 8, Q / 2],
    [Q / 8, -Q / 2],
  ];
  return offsets.map(([offsetX, offsetY]) => {
    const result = cloneLines(lines);
    for (let path = 0; path < result.length; path += 1) {
      for (let control = 1; control < result[path].length - 1; control += 1) {
        result[path][control][0] = (result[path][control][0] + offsetX) | 0;
        result[path][control][1] = (result[path][control][1] + offsetY) | 0;
      }
    }
    return result;
  });
}

export function createPerturbationsAtPercent(lines, percent, fieldWidth = 64) {
  if (!Number.isInteger(percent) || percent <= 0 || percent >= 100) {
    throw new RangeError("percent must be an integer in (0, 100)");
  }
  if (!Number.isInteger(fieldWidth) || fieldWidth <= 0) {
    throw new RangeError("fieldWidth must be a positive integer");
  }
  const radius = ((fieldWidth * Q * percent) / 100) | 0;
  // Every direction has the same L-infinity displacement radius. Half-axis
  // components use fixed truncation toward zero; no angle or Math API is used.
  const directions = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-2, -2],
    [2, 2],
    [-2, 2],
    [2, -2],
    [-1, 2],
    [1, -2],
  ];
  return directions.map(([directionX, directionY]) => {
    const result = cloneLines(lines);
    const offsetX = ((radius * directionX) / 2) | 0;
    const offsetY = ((radius * directionY) / 2) | 0;
    for (let path = 0; path < result.length; path += 1) {
      for (let control = 1; control < result[path].length - 1; control += 1) {
        result[path][control][0] = (result[path][control][0] + offsetX) | 0;
        result[path][control][1] = (result[path][control][1] + offsetY) | 0;
      }
    }
    return result;
  });
}

export function createLargePerturbation(lines = INPUTS.straight) {
  const result = cloneLines(lines);
  for (let path = 0; path < result.length; path += 1) {
    for (let control = 1; control < result[path].length - 1; control += 1) {
      result[path][control][1] = (result[path][control][1] + 8 * Q) | 0;
    }
  }
  return result;
}

export function createReplay(lines = INPUTS.straight, seed = DEFAULT_SEED) {
  return {
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    scenarioId: SCENARIO_ID,
    seed: seed | 0,
    lines: cloneLines(lines),
  };
}

export function replayInput(replay) {
  const keys = ["formatVersion", "engineVersion", "scenarioId", "seed", "lines"];
  if (replay === null || typeof replay !== "object" || Array.isArray(replay)) {
    throw new TypeError("replay must be an object");
  }
  const actualKeys = Object.keys(replay).sort();
  const expectedKeys = [...keys].sort();
  if (actualKeys.length !== expectedKeys.length) throw new TypeError("replay has unsupported fields");
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (actualKeys[index] !== expectedKeys[index]) throw new TypeError("replay has unsupported fields");
  }
  if (replay.formatVersion !== 1 || replay.engineVersion !== ENGINE_VERSION || replay.scenarioId !== SCENARIO_ID) {
    throw new RangeError("replay version or scenario does not match");
  }
  return { lines: cloneLines(replay.lines), source: SOURCE, sink: SINK, seed: replay.seed };
}
