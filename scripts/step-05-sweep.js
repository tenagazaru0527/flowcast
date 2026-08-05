import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { Q } from "../src/config.js";
import {
  createPerturbationsAtPercent,
  createWideSink,
  DEFAULT_SEED,
  WIDE_INPUTS,
  WIDE_SOURCE,
} from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";

const OUTPUT = "docs/reports/data/step-05-sweep.csv";
const INPUT_NAMES = ["straight", "distributed", "detour"];
const SAMPLE_X = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60];
const POINTS = [1, 3, 5, 9, 17].flatMap((sinkWidth) => [
  { sinkWidth, ratio: "4:1", advectionWeight: Q, diffusionWeight: Q >> 2 },
  { sinkWidth, ratio: "16:1", advectionWeight: Q, diffusionWeight: Q >> 4 },
  { sinkWidth, ratio: "64:1", advectionWeight: Q, diffusionWeight: Q >> 6 },
]);

function simulate(lines, point) {
  return runSimulation({
    lines,
    source: WIDE_SOURCE,
    sink: createWideSink(point.sinkWidth),
    seed: DEFAULT_SEED,
    config: {
      advectionWeight: point.advectionWeight,
      diffusionWeight: point.diffusionWeight,
    },
    measure: true,
  });
}

function variationBasisPoints(baseline, candidate) {
  const base = baseline.measurements;
  const next = candidate.measurements;
  if (base.totalCompleted <= 0 || base.totalInjected <= 0 || next.totalInjected <= 0) return null;
  const candidateScaled = BigInt(next.totalCompleted) * BigInt(base.totalInjected);
  const baselineScaled = BigInt(base.totalCompleted) * BigInt(next.totalInjected);
  const difference = candidateScaled >= baselineScaled
    ? candidateScaled - baselineScaled
    : baselineScaled - candidateScaled;
  const denominator = BigInt(next.totalInjected) * BigInt(base.totalCompleted);
  return Number((difference * 10_000n) / denominator);
}

function summarizeSensitivity(baseline, results) {
  const values = [];
  let indeterminate = 0;
  for (let index = 0; index < results.length; index += 1) {
    const variation = variationBasisPoints(baseline, results[index]);
    if (variation === null) indeterminate += 1;
    else values.push(variation);
  }
  values.sort((left, right) => left - right);
  const middle = (values.length / 2) | 0;
  const medianTwiceBasisPoints = values.length === 0
    ? null
    : values.length % 2 === 0
      ? values[middle - 1] + values[middle]
      : values[middle] * 2;
  return { indeterminate, medianTwiceBasisPoints };
}

function criterion4(direct) {
  const dominated = direct.some((candidate, candidateIndex) => direct.every((other, otherIndex) => {
    if (candidateIndex === otherIndex) return true;
    const candidateStep = candidate.completionStep < 0 ? Number.POSITIVE_INFINITY : candidate.completionStep;
    const otherStep = other.completionStep < 0 ? Number.POSITIVE_INFINITY : other.completionStep;
    const noWorse = candidate.totalCompleted >= other.totalCompleted
      && candidateStep <= otherStep
      && candidate.maxStagnation <= other.maxStagnation;
    const betterSomewhere = candidate.totalCompleted > other.totalCompleted
      || candidateStep < otherStep
      || candidate.maxStagnation < other.maxStagnation;
    return noWorse && betterSomewhere;
  }));
  return dominated ? "FAIL" : "PASS";
}

function evaluatePoint(pointIndex) {
  const point = POINTS[pointIndex];
  const direct = INPUT_NAMES.map((name) => simulate(WIDE_INPUTS[name], point));
  const baseline = direct[1];
  const levels = [1, 3, 10].map((percent) => (
    createPerturbationsAtPercent(WIDE_INPUTS.distributed, percent).map((lines) => simulate(lines, point))
  ));
  const criterion2Values = levels[0].map((result) => variationBasisPoints(baseline, result));
  const criterion2PassCount = criterion2Values.filter((value) => value !== null && value <= 500).length;
  const criterion2Assessable = criterion2Values.every((value) => value !== null);
  const summaries = levels.map((results) => summarizeSensitivity(baseline, results));
  const criterion3Assessable = summaries.every((summary) => summary.indeterminate === 0);
  const monotonic = criterion3Assessable
    && summaries[0].medianTwiceBasisPoints <= summaries[1].medianTwiceBasisPoints
    && summaries[1].medianTwiceBasisPoints <= summaries[2].medianTwiceBasisPoints;
  const separated = criterion3Assessable
    && summaries[2].medianTwiceBasisPoints >= summaries[0].medianTwiceBasisPoints * 3;
  return {
    pointIndex,
    point,
    direct,
    criterion2PassCount,
    criterion2: criterion2Assessable ? (criterion2PassCount >= 9 ? "PASS" : "FAIL") : "INDETERMINATE",
    criterion3Medians: summaries.map((summary) => summary.medianTwiceBasisPoints),
    criterion3: criterion3Assessable ? (monotonic && separated ? "PASS" : "FAIL") : "INDETERMINATE",
    criterion4: criterion4(direct),
  };
}

function runWorker(pointIndexes) {
  return pointIndexes.map(evaluatePoint);
}

function startWorker(pointIndexes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { pointIndexes } });
    worker.once("message", resolvePromise);
    worker.once("error", rejectPromise);
  });
}

function csvValue(value) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serialize(results) {
  const sampledHeaders = SAMPLE_X.flatMap((x) => [
    `bandCellsX${x}`,
    `segmentCountX${x}`,
    `meanSegmentWidthX${x}`,
  ]);
  const headers = [
    "sinkWidth", "ratio", "advectionWeight", "diffusionWeight", "inputName", "stateHash",
    "coherenceLength", "coherenceLengthSigma", ...sampledHeaders,
    "occupiedPeak", "totalCompleted", "completionRatio", "outOfFieldRatio",
    "densityMax", "densityMaxCell", "densityMaxExSource", "maxStagnation", "backflowEvents",
    "criterion2PassCount", "criterion2", "criterion3Median1TwiceBasisPoints",
    "criterion3Median3TwiceBasisPoints", "criterion3Median10TwiceBasisPoints", "criterion3", "criterion4",
  ];
  const rows = [];
  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    const result = results[resultIndex];
    for (let inputIndex = 0; inputIndex < INPUT_NAMES.length; inputIndex += 1) {
      const simulation = result.direct[inputIndex];
      const values = simulation.measurements;
      const sampled = SAMPLE_X.flatMap((x) => [
        values.bandCells[x],
        values.segmentCount[x],
        values.meanSegmentWidth[x],
      ]);
      rows.push([
        result.point.sinkWidth, result.point.ratio, result.point.advectionWeight,
        result.point.diffusionWeight, INPUT_NAMES[inputIndex], simulation.stateHash,
        values.coherenceLength, values.coherenceLengthSigma, ...sampled,
        values.occupiedCellsPeak, values.totalCompleted, values.completionRatio, values.outOfFieldRatio,
        values.densityMax, values.densityMaxCell.join(":"), values.densityMaxExSource,
        values.maxStagnation, values.backflowEvents, result.criterion2PassCount, result.criterion2,
        ...result.criterion3Medians, result.criterion3, result.criterion4,
      ].map(csvValue).join(","));
    }
  }
  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

async function main() {
  const workerCount = Math.min(Math.max(availableParallelism() - 1, 1), POINTS.length);
  const buckets = Array.from({ length: workerCount }, () => []);
  for (let index = 0; index < POINTS.length; index += 1) buckets[index % workerCount].push(index);
  const groups = await Promise.all(buckets.map(startWorker));
  const results = groups.flat().sort((left, right) => left.pointIndex - right.pointIndex);
  const outputPath = resolve(OUTPUT);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialize(results), "utf8");
  console.log(`points: ${results.length}`);
  console.log(`runs: ${results.length * INPUT_NAMES.length}`);
  console.log(`workers: ${workerCount}`);
  console.log(`csv: ${outputPath}`);
}

if (!isMainThread) {
  parentPort.postMessage(runWorker(workerData.pointIndexes));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
