import { Q } from "../src/config.js";
import { runSimulation } from "../src/simulation.js";
import {
  createPerturbationsAtPercent,
  DEFAULT_SEED,
  INPUTS,
  SINK,
  SOURCE,
} from "../src/scenarios.js";

const names = ["straight", "distributed", "detour"];
const sweepPoints = [
  { ratio: "1:16", advectionWeight: Q, diffusionWeight: 16 * Q },
  { ratio: "1:4", advectionWeight: Q, diffusionWeight: 4 * Q },
  { ratio: "1:1", advectionWeight: Q, diffusionWeight: Q },
  { ratio: "4:1", advectionWeight: Q, diffusionWeight: Q >> 2 },
  { ratio: "16:1", advectionWeight: Q, diffusionWeight: Q >> 4 },
  { ratio: "64:1", advectionWeight: Q, diffusionWeight: Q >> 6 },
];

function measure(name, config = {}) {
  return runSimulation({
    lines: INPUTS[name],
    source: SOURCE,
    sink: SINK,
    seed: DEFAULT_SEED,
    config,
    measure: true,
  });
}

function printDefaultMeasurements() {
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const result = measure(name);
    const values = result.measurements;
    const completion = values.completionStep === -1 ? "-1 (未到達)" : String(values.completionStep);
    console.log(name);
    console.log(`  densityMax: ${values.densityMax}`);
    console.log(`  densityMaxRatio: ${values.densityMaxRatio}%`);
    console.log(`  occupiedCellsPeak: ${values.occupiedCellsPeak}`);
    console.log(`  meanResidency: ${values.meanResidency}`);
    console.log(`  backflowEvents: ${values.backflowEvents}`);
    console.log(`  completionStep: ${completion}`);
    console.log(`  maxStagnation: ${values.maxStagnation}`);
    console.log(`  totalCompleted: ${values.totalCompleted}`);
    console.log(`  completionRatio: ${values.completionRatio}%`);
    console.log(`  outOfFieldRatio: ${values.outOfFieldRatio}%`);
    console.log(`  remainingRatio: ${values.remainingRatio}%`);
    console.log(`  advectionShare: ${values.advectionShare}%`);
    console.log(`  diffusionShare: ${values.diffusionShare}%`);
    console.log(`  guideMagnitudeMax: ${values.guideMagnitudeMax}`);
    console.log(`  stateHash: ${result.stateHash}`);
  }
}

function printSweep() {
  const headers = [
    "ratio",
    "input",
    "densityMax",
    "densityMaxRatio",
    "occupiedCellsPeak",
    "meanResidency",
    "backflowEvents",
    "completionStep",
    "maxStagnation",
    "totalCompleted",
    "completionRatio",
    "outOfFieldRatio",
    "remainingRatio",
    "advectionShare",
    "diffusionShare",
    "guideMagnitudeMax",
    "stateHash",
  ];
  console.log(headers.join("\t"));
  for (let pointIndex = 0; pointIndex < sweepPoints.length; pointIndex += 1) {
    const point = sweepPoints[pointIndex];
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      const name = names[nameIndex];
      const result = measure(name, {
        advectionWeight: point.advectionWeight,
        diffusionWeight: point.diffusionWeight,
      });
      const values = result.measurements;
      console.log([
        point.ratio,
        name,
        values.densityMax,
        values.densityMaxRatio,
        values.occupiedCellsPeak,
        values.meanResidency,
        values.backflowEvents,
        values.completionStep,
        values.maxStagnation,
        values.totalCompleted,
        values.completionRatio,
        values.outOfFieldRatio,
        values.remainingRatio,
        values.advectionShare,
        values.diffusionShare,
        values.guideMagnitudeMax,
        result.stateHash,
      ].join("\t"));
    }
  }
}

function variationBasisPoints(baseline, candidate) {
  if (baseline === -1 || candidate === -1) return null;
  const rawDifference = candidate >= baseline ? candidate - baseline : baseline - candidate;
  return ((rawDifference * 10_000) / baseline) | 0;
}

function summarizeSensitivity(baseline, results) {
  const rates = [];
  let indeterminate = 0;
  for (let index = 0; index < results.length; index += 1) {
    const rate = variationBasisPoints(baseline, results[index].completionStep);
    if (rate === null) indeterminate += 1;
    else rates.push(rate);
  }
  rates.sort((left, right) => left - right);
  if (rates.length === 0) {
    return { assessable: 0, indeterminate, medianTwiceBasisPoints: null, maximumBasisPoints: null };
  }
  const middle = (rates.length / 2) | 0;
  const medianTwiceBasisPoints = rates.length % 2 === 0
    ? rates[middle - 1] + rates[middle]
    : rates[middle] * 2;
  return {
    assessable: rates.length,
    indeterminate,
    medianTwiceBasisPoints,
    maximumBasisPoints: rates[rates.length - 1],
  };
}

function formatThousandthsPercent(value) {
  const whole = (value / 1_000) | 0;
  const fraction = String(value % 1_000).padStart(3, "0");
  return `${whole}.${fraction}%`;
}

function printSensitivity() {
  const baseline = measure("distributed");
  const levels = [1, 3, 10];
  const summaries = [];
  console.log("baseline\tdistributed");
  console.log(`baselineCompletionStep\t${baseline.completionStep}`);
  console.log("level\tassessable\tindeterminate\tmedian\tmaximum");
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const results = createPerturbationsAtPercent(INPUTS.distributed, level).map((lines) => (
      runSimulation({ lines, source: SOURCE, sink: SINK, seed: DEFAULT_SEED })
    ));
    const summary = summarizeSensitivity(baseline.completionStep, results);
    summaries.push(summary);
    const levelAssessable = summary.indeterminate === 0;
    const median = !levelAssessable || summary.medianTwiceBasisPoints === null
      ? "判定不能"
      : formatThousandthsPercent(summary.medianTwiceBasisPoints * 5);
    const maximum = !levelAssessable || summary.maximumBasisPoints === null
      ? "判定不能"
      : formatThousandthsPercent(summary.maximumBasisPoints * 10);
    console.log(`${level}%\t${summary.assessable}\t${summary.indeterminate}\t${median}\t${maximum}`);
  }
  const assessable = summaries[0].indeterminate === 0
    && summaries[1].indeterminate === 0
    && summaries[2].indeterminate === 0;
  const monotonic = assessable
    && summaries[0].medianTwiceBasisPoints <= summaries[1].medianTwiceBasisPoints
    && summaries[1].medianTwiceBasisPoints <= summaries[2].medianTwiceBasisPoints;
  const separated = assessable
    && summaries[2].medianTwiceBasisPoints >= summaries[0].medianTwiceBasisPoints * 3;
  console.log(`monotonic\t${assessable ? (monotonic ? "PASS" : "FAIL") : "判定不能"}`);
  console.log(`separation\t${assessable ? (separated ? "PASS" : "FAIL") : "判定不能"}`);
  console.log(`criterion3\t${assessable ? (monotonic && separated ? "PASS" : "FAIL") : "判定不能"}`);
}

if (process.argv[2] === "--sweep") {
  printSweep();
} else if (process.argv[2] === "--sensitivity") {
  printSensitivity();
} else {
  printDefaultMeasurements();
}
