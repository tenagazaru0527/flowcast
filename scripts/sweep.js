import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { DEFAULT_CONFIG } from "../src/config.js";
import {
  createCanyonScenario,
  createPerturbationsAtPercent,
  DEFAULT_SEED,
  ENGINE_VERSION,
  INPUTS,
  SCENARIOS,
  SINK,
  SOURCE,
} from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";

const INPUT_NAMES = Object.freeze(["straight", "distributed", "detour"]);
const MODES = Object.freeze({ A: [], B: [1], C: [1, 3, 10] });
const SCENARIO_NAMES = Object.freeze(["default", "wide", "canyon"]);

export function runsPerPoint(mode) {
  if (!Object.hasOwn(MODES, mode)) throw new RangeError("mode must be A, B, or C");
  return INPUT_NAMES.length + MODES[mode].length * 10;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/sweep.js --param capacity --values 65536,131072 --mode B",
    "  node scripts/sweep.js --grid grid.json --mode C --workers 4",
    "Options:",
    "  --mode A|B|C                           (default: B)",
    "  --scenario default|wide|canyon          (default: default)",
    "  --workers N                            (default: min(cores - 1, points))",
    "  --out-dir PATH                         (default: sweep-out)",
  ].join("\n");
}

function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be a safe integer`);
  return parsed;
}

function assertParameterName(name) {
  if (name !== "corridorWidth" && !Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, name)) {
    throw new RangeError(`unknown config parameter: ${name}`);
  }
  if (name === "steps") throw new RangeError("steps must remain 3600 during sweeps");
}

function assertPoint(point, index) {
  if (point === null || typeof point !== "object" || Array.isArray(point)) {
    throw new TypeError(`grid point ${index} must be an object`);
  }
  const names = Object.keys(point).sort();
  if (names.length === 0) throw new RangeError(`grid point ${index} must not be empty`);
  const checked = {};
  for (const name of names) {
    if (name !== "gapWidth") assertParameterName(name);
    if (name === "corridorBlocksOutOfField") {
      if (typeof point[name] !== "boolean") throw new TypeError(`grid point ${index}.${name} must be a boolean`);
      checked[name] = point[name];
    } else {
      checked[name] = parseInteger(point[name], `grid point ${index}.${name}`);
    }
  }
  return checked;
}

function cartesianParameters(parameters) {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    throw new TypeError("grid.parameters must be a non-empty array");
  }
  let points = [{}];
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    if (parameter === null || typeof parameter !== "object" || Array.isArray(parameter)) {
      throw new TypeError(`grid.parameters[${index}] must be an object`);
    }
    const { name, values } = parameter;
    if (typeof name !== "string") throw new TypeError(`grid.parameters[${index}].name must be a string`);
    if (name !== "gapWidth") assertParameterName(name);
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError(`grid.parameters[${index}].values must be a non-empty array`);
    }
    points = points.flatMap((point) => values.map((value, valueIndex) => ({
      ...point,
      [name]: parseInteger(value, `grid.parameters[${index}].values[${valueIndex}]`),
    })));
  }
  return points;
}

export function parseGridDocument(document) {
  if (Array.isArray(document)) return document.map(assertPoint);
  if (document !== null && typeof document === "object" && !Array.isArray(document)) {
    if (Array.isArray(document.points)) return document.points.map(assertPoint);
    if (document.parameters !== undefined) return cartesianParameters(document.parameters);
  }
  throw new TypeError("grid must be an array, { points: [...] }, or { parameters: [...] }");
}

function parseArguments(argv) {
  const options = { mode: "B", scenario: "default", outDir: "sweep-out" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!argument.startsWith("--")) throw new RangeError(`unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new RangeError(`${argument} requires a value`);
    index += 1;
    if (argument === "--param") options.param = value;
    else if (argument === "--values") options.values = value;
    else if (argument === "--grid") options.grid = value;
    else if (argument === "--mode") options.mode = value;
    else if (argument === "--scenario") options.scenario = value;
    else if (argument === "--workers") options.workers = parseInteger(value, "--workers");
    else if (argument === "--out-dir") options.outDir = value;
    else throw new RangeError(`unknown option: ${argument}`);
  }
  if (!Object.hasOwn(MODES, options.mode)) throw new RangeError("--mode must be A, B, or C");
  if (!SCENARIO_NAMES.includes(options.scenario)) throw new RangeError("--scenario must be default, wide, or canyon");
  if (options.grid !== undefined && (options.param !== undefined || options.values !== undefined)) {
    throw new RangeError("--grid cannot be combined with --param or --values");
  }
  if (options.grid === undefined && (options.param === undefined || options.values === undefined)) {
    throw new RangeError("specify either --grid or both --param and --values");
  }
  if (options.workers !== undefined && options.workers <= 0) throw new RangeError("--workers must be positive");
  return options;
}

function variationBasisPoints(baseline, candidate) {
  const base = baseline.measurements;
  const next = candidate.measurements;
  if (base.totalCompleted <= 0 || base.totalInjected <= 0 || next.totalInjected <= 0) return null;
  const candidateScaled = BigInt(next.totalCompleted) * BigInt(base.totalInjected);
  const baselineScaled = BigInt(base.totalCompleted) * BigInt(next.totalInjected);
  const difference = candidateScaled >= baselineScaled ? candidateScaled - baselineScaled : baselineScaled - candidateScaled;
  return Number((difference * 10_000n) / (BigInt(next.totalInjected) * BigInt(base.totalCompleted)));
}

function medianTwice(values) {
  if (values.some((value) => value === null)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = (sorted.length / 2) | 0;
  return sorted.length % 2 === 0 ? sorted[middle - 1] + sorted[middle] : sorted[middle] * 2;
}

function createSweepScenario(scenarioName, parameters) {
  if (scenarioName === "default") return { source: SOURCE, sink: SINK, inputs: INPUTS, blocked: [], gaps: [] };
  if (scenarioName === "wide") return SCENARIOS.find((scenario) => scenario.scenarioId === "poc-1-wide");
  return createCanyonScenario(parameters.gapWidth ?? 1);
}

function simulate(lines, parameters, scenario) {
  const { gapWidth, ...config } = parameters;
  return runSimulation({ lines, source: scenario.source, sink: scenario.sink, blocked: scenario.blocked, gaps: scenario.gaps, seed: DEFAULT_SEED, config, measure: true });
}

function dominatedByAnother(direct, candidateIndex) {
  const candidate = direct[candidateIndex].result.measurements;
  return direct.some(({ result }, otherIndex) => {
    if (otherIndex === candidateIndex) return false;
    const other = result.measurements;
    const candidateStep = candidate.completionStep < 0 ? Number.POSITIVE_INFINITY : candidate.completionStep;
    const otherStep = other.completionStep < 0 ? Number.POSITIVE_INFINITY : other.completionStep;
    return other.totalCompleted >= candidate.totalCompleted
      && otherStep <= candidateStep
      && other.maxStagnation <= candidate.maxStagnation
      && (other.totalCompleted > candidate.totalCompleted || otherStep < candidateStep || other.maxStagnation < candidate.maxStagnation);
  });
}

function evaluatePoint(pointIndex, parameters, mode, scenarioName) {
  const scenario = createSweepScenario(scenarioName, parameters);
  const direct = INPUT_NAMES.map((inputName) => ({ inputName, result: simulate(scenario.inputs[inputName], parameters, scenario) }));
  const baseline = direct.find(({ inputName }) => inputName === "distributed").result;
  const perturbationLevels = MODES[mode].map((percent) => ({
    percent,
    results: createPerturbationsAtPercent(scenario.inputs.distributed, percent).map((lines) => simulate(lines, parameters, scenario)),
  }));
  const sensitivity = new Map(perturbationLevels.map(({ percent, results }) => [
    percent,
    results.map((result) => variationBasisPoints(baseline, result)),
  ]));
  const summaries = new Map([...sensitivity].map(([percent, values]) => [percent, medianTwice(values)]));
  const rows = direct.map(({ inputName, result }, inputOrder) => ({
    pointIndex, parameters, mode, runKind: "basic", inputName, perturbationPercent: null, perturbationIndex: null,
    inputOrder,
    engineVersion: ENGINE_VERSION, stateHash: result.stateHash, measurements: result.measurements,
    sensitivityBasisPoints: null,
    criterion4Dominated: dominatedByAnother(direct, inputOrder),
    criterion2MedianTwiceBasisPoints: summaries.get(1) ?? null,
    criterion3Median3TwiceBasisPoints: summaries.get(3) ?? null,
    criterion3Median10TwiceBasisPoints: summaries.get(10) ?? null,
  }));
  for (const { percent, results } of perturbationLevels) {
    for (let index = 0; index < results.length; index += 1) {
      rows.push({
        pointIndex, parameters, mode, runKind: "perturbation", inputName: "distributed", perturbationPercent: percent,
        perturbationIndex: index + 1, inputOrder: INPUT_NAMES.indexOf("distributed"), engineVersion: ENGINE_VERSION, stateHash: results[index].stateHash,
        measurements: results[index].measurements, sensitivityBasisPoints: sensitivity.get(percent)[index],
        criterion4Dominated: null,
        criterion2MedianTwiceBasisPoints: summaries.get(1) ?? null,
        criterion3Median3TwiceBasisPoints: summaries.get(3) ?? null,
        criterion3Median10TwiceBasisPoints: summaries.get(10) ?? null,
      });
    }
  }
  return rows;
}

function executePoints(points, mode, scenarioName, pointIndexes) {
  return pointIndexes.flatMap((pointIndex) => evaluatePoint(pointIndex, points[pointIndex], mode, scenarioName));
}

function executeWorkerPoints(points, mode, scenarioName, pointIndexes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { points, mode, scenarioName, pointIndexes } });
    worker.once("message", (message) => {
      worker.terminate().then(() => resolvePromise(message), rejectPromise);
    });
    worker.once("error", rejectPromise);
  });
}

export async function runSweep({ points, mode = "B", scenarioName = "default", workers } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new RangeError("points must not be empty");
  runsPerPoint(mode);
  if (!SCENARIO_NAMES.includes(scenarioName)) throw new RangeError("scenarioName must be default, wide, or canyon");
  const checkedPoints = points.map(assertPoint);
  const defaultWorkers = Math.min(Math.max(availableParallelism() - 1, 1), checkedPoints.length);
  const workerCount = workers === undefined ? defaultWorkers : workers;
  if (!Number.isInteger(workerCount) || workerCount <= 0) throw new RangeError("workers must be a positive integer");
  if (workerCount === 1) return executePoints(checkedPoints, mode, scenarioName, checkedPoints.map((_, index) => index));
  const buckets = Array.from({ length: Math.min(workerCount, checkedPoints.length) }, () => []);
  for (let index = 0; index < checkedPoints.length; index += 1) buckets[index % buckets.length].push(index);
  return (await Promise.all(buckets.map((bucket) => executeWorkerPoints(checkedPoints, mode, scenarioName, bucket))))
    .flat()
    .sort((left, right) => left.pointIndex - right.pointIndex || left.runKind.localeCompare(right.runKind)
      || (left.perturbationPercent ?? 0) - (right.perturbationPercent ?? 0)
      || (left.perturbationIndex ?? 0) - (right.perturbationIndex ?? 0) || left.inputOrder - right.inputOrder);
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeJsonLines(results) {
  return `${results.map((result) => JSON.stringify(result)).join("\n")}\n`;
}

function flattenMeasurements(measurements) {
  const flat = {};
  for (const name of Object.keys(measurements)) {
    const value = measurements[name];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const child of Object.keys(value).sort()) flat[`${name}.${child}`] = value[child];
    } else flat[name] = value;
  }
  return flat;
}

export function serializeCsv(results) {
  const parameterNames = [...new Set(results.flatMap((result) => Object.keys(result.parameters)))].sort();
  const flattened = results.map((result) => flattenMeasurements(result.measurements));
  const measurementNames = [...new Set(flattened.flatMap((measurements) => Object.keys(measurements)))].sort();
  const headers = ["pointIndex", "mode", "runKind", "inputName", "perturbationPercent", "perturbationIndex", "engineVersion", "stateHash",
    ...parameterNames.map((name) => `param.${name}`), ...measurementNames.map((name) => `measurement.${name}`),
    "sensitivityBasisPoints", "criterion4Dominated", "criterion2MedianTwiceBasisPoints", "criterion3Median3TwiceBasisPoints", "criterion3Median10TwiceBasisPoints"];
  const rows = results.map((result, index) => [result.pointIndex, result.mode, result.runKind, result.inputName, result.perturbationPercent,
    result.perturbationIndex, result.engineVersion, result.stateHash, ...parameterNames.map((name) => result.parameters[name]),
    ...measurementNames.map((name) => flattened[index][name]), result.sensitivityBasisPoints, result.criterion4Dominated, result.criterion2MedianTwiceBasisPoints,
    result.criterion3Median3TwiceBasisPoints, result.criterion3Median10TwiceBasisPoints].map(csvValue).join(","));
  return `${headers.map(csvValue).join(",")}\n${rows.join("\n")}\n`;
}

async function loadPoints(options) {
  if (options.grid !== undefined) return parseGridDocument(JSON.parse(await readFile(resolve(options.grid), "utf8")));
  assertParameterName(options.param);
  const values = options.values.split(",");
  if (values.length === 0 || values.some((value) => value.length === 0)) throw new RangeError("--values must be a comma-separated list");
  return values.map((value, index) => ({ [options.param]: parseInteger(value, `--values[${index}]`) }));
}

async function writeResults(results, outDir) {
  const jsonPath = resolve(outDir, "results.jsonl");
  const csvPath = resolve(outDir, "results.csv");
  await mkdir(dirname(jsonPath), { recursive: true });
  await Promise.all([writeFile(jsonPath, serializeJsonLines(results), "utf8"), writeFile(csvPath, serializeCsv(results), "utf8")]);
  return { jsonPath, csvPath };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const points = await loadPoints(options);
  const workers = options.workers ?? Math.min(Math.max(availableParallelism() - 1, 1), points.length);
  const results = await runSweep({ points, mode: options.mode, scenarioName: options.scenario, workers });
  const paths = await writeResults(results, options.outDir);
  console.log(`points: ${points.length}`);
  console.log(`mode: ${options.mode}`);
  console.log(`runs: ${results.length}`);
  console.log(`workers: ${Math.min(workers, points.length)}`);
  console.log(`jsonl: ${paths.jsonPath}`);
  console.log(`csv: ${paths.csvPath}`);
}

if (!isMainThread) parentPort.postMessage(executePoints(workerData.points, workerData.mode, workerData.scenarioName, workerData.pointIndexes));
else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
