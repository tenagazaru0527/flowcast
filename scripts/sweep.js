import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { DEFAULT_CONFIG } from "../src/config.js";
import { runSimulation } from "../src/simulation.js";
import {
  DEFAULT_SEED,
  ENGINE_VERSION,
  INPUTS,
  SINK,
  SOURCE,
} from "../src/scenarios.js";

const INPUT_NAMES = Object.freeze(["straight", "distributed", "detour"]);

function usage() {
  return [
    "Usage:",
    "  node scripts/sweep.js --param capacity --values 65536,131072 --inputs all",
    "  node scripts/sweep.js --grid grid.json --workers 8",
    "Options:",
    "  --inputs all|straight,distributed,detour  (default: all)",
    "  --workers N                              (default: min(cores - 1, runs))",
    "  --out-dir PATH                           (default: sweep-out)",
  ].join("\n");
}

function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be a safe integer`);
  return parsed;
}

function assertParameterName(name) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, name)) {
    throw new RangeError(`unknown config parameter: ${name}`);
  }
}

function assertPoint(point, index) {
  if (point === null || typeof point !== "object" || Array.isArray(point)) {
    throw new TypeError(`grid point ${index} must be an object`);
  }
  const names = Object.keys(point).sort();
  if (names.length === 0) throw new RangeError(`grid point ${index} must not be empty`);
  const checked = {};
  for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
    const name = names[nameIndex];
    assertParameterName(name);
    checked[name] = parseInteger(point[name], `grid point ${index}.${name}`);
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
    assertParameterName(name);
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError(`grid.parameters[${index}].values must be a non-empty array`);
    }
    const next = [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        next.push({
          ...points[pointIndex],
          [name]: parseInteger(values[valueIndex], `grid.parameters[${index}].values[${valueIndex}]`),
        });
      }
    }
    points = next;
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

function parseInputs(value = "all") {
  if (value === "all") return [...INPUT_NAMES];
  const names = value.split(",").filter((name) => name.length > 0);
  if (names.length === 0) throw new RangeError("--inputs must select at least one input");
  for (let index = 0; index < names.length; index += 1) {
    if (!INPUT_NAMES.includes(names[index])) throw new RangeError(`unknown input: ${names[index]}`);
  }
  return names;
}

function parseArguments(argv) {
  const options = { inputs: "all", outDir: "sweep-out" };
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
    else if (argument === "--inputs") options.inputs = value;
    else if (argument === "--workers") options.workers = parseInteger(value, "--workers");
    else if (argument === "--out-dir") options.outDir = value;
    else throw new RangeError(`unknown option: ${argument}`);
  }
  if (options.grid !== undefined && (options.param !== undefined || options.values !== undefined)) {
    throw new RangeError("--grid cannot be combined with --param or --values");
  }
  if (options.grid === undefined && (options.param === undefined || options.values === undefined)) {
    throw new RangeError("specify either --grid or both --param and --values");
  }
  if (options.workers !== undefined && options.workers <= 0) {
    throw new RangeError("--workers must be positive");
  }
  return options;
}

function createJobs(points, inputNames) {
  const jobs = [];
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    for (let inputIndex = 0; inputIndex < inputNames.length; inputIndex += 1) {
      jobs.push({
        order: jobs.length,
        pointIndex,
        inputIndex,
        parameters: points[pointIndex],
        inputName: inputNames[inputIndex],
      });
    }
  }
  return jobs;
}

function executeJob(job) {
  const result = runSimulation({
    lines: INPUTS[job.inputName],
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
    config: job.parameters,
    measure: true,
  });
  return {
    ...job,
    engineVersion: ENGINE_VERSION,
    stateHash: result.stateHash,
    measurements: result.measurements,
  };
}

function executeJobs(jobs) {
  return jobs.map(executeJob);
}

function executeWorkerJobs(jobs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { jobs } });
    let settled = false;
    worker.once("message", (message) => {
      settled = true;
      resolvePromise(message);
    });
    worker.once("error", (error) => {
      settled = true;
      rejectPromise(error);
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) rejectPromise(new Error(`worker stopped with exit code ${code}`));
    });
  });
}

export async function runSweep({ points, inputNames = INPUT_NAMES, workers } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new RangeError("points must not be empty");
  const checkedPoints = points.map(assertPoint);
  const checkedInputs = parseInputs(inputNames.join(","));
  const jobs = createJobs(checkedPoints, checkedInputs);
  const defaultWorkers = Math.min(Math.max(availableParallelism() - 1, 1), jobs.length);
  const workerCount = workers === undefined ? defaultWorkers : workers;
  if (!Number.isInteger(workerCount) || workerCount <= 0) throw new RangeError("workers must be a positive integer");
  if (workerCount === 1) return executeJobs(jobs);

  const activeWorkers = Math.min(workerCount, jobs.length);
  const buckets = Array.from({ length: activeWorkers }, () => []);
  for (let index = 0; index < jobs.length; index += 1) buckets[index % activeWorkers].push(jobs[index]);
  const groups = await Promise.all(buckets.map(executeWorkerJobs));
  return groups.flat().sort((left, right) => left.order - right.order);
}

function csvValue(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeJsonLines(results) {
  return `${results.map((result) => JSON.stringify(result)).join("\n")}\n`;
}

export function serializeCsv(results) {
  const parameterNames = [...new Set(results.flatMap((result) => Object.keys(result.parameters)))].sort();
  const measurementNames = [...new Set(results.flatMap((result) => Object.keys(result.measurements)))].sort();
  const headers = [
    "pointIndex",
    "inputName",
    "engineVersion",
    "stateHash",
    ...parameterNames.map((name) => `param.${name}`),
    ...measurementNames.map((name) => `measurement.${name}`),
  ];
  const rows = results.map((result) => [
    result.pointIndex,
    result.inputName,
    result.engineVersion,
    result.stateHash,
    ...parameterNames.map((name) => result.parameters[name] ?? ""),
    ...measurementNames.map((name) => result.measurements[name] ?? ""),
  ].map(csvValue).join(","));
  return `${headers.map(csvValue).join(",")}\n${rows.join("\n")}\n`;
}

async function loadPoints(options) {
  if (options.grid !== undefined) {
    const document = JSON.parse(await readFile(resolve(options.grid), "utf8"));
    return parseGridDocument(document);
  }
  assertParameterName(options.param);
  const values = options.values.split(",");
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    throw new RangeError("--values must be a comma-separated list");
  }
  return values.map((value, index) => ({
    [options.param]: parseInteger(value, `--values[${index}]`),
  }));
}

async function writeResults(results, outDir) {
  const jsonPath = resolve(outDir, "results.jsonl");
  const csvPath = resolve(outDir, "results.csv");
  await mkdir(dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, serializeJsonLines(results), "utf8"),
    writeFile(csvPath, serializeCsv(results), "utf8"),
  ]);
  return { jsonPath, csvPath };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const points = await loadPoints(options);
  const inputNames = parseInputs(options.inputs);
  const runCount = points.length * inputNames.length;
  const workers = options.workers ?? Math.min(Math.max(availableParallelism() - 1, 1), runCount);
  const results = await runSweep({ points, inputNames, workers });
  const paths = await writeResults(results, options.outDir);
  console.log(`runs: ${results.length}`);
  console.log(`workers: ${Math.min(workers, runCount)}`);
  console.log(`jsonl: ${paths.jsonPath}`);
  console.log(`csv: ${paths.csvPath}`);
}

if (!isMainThread) {
  parentPort.postMessage(executeJobs(workerData.jobs));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
