import assert from "node:assert/strict";
import test from "node:test";

import { runSimulation } from "../src/simulation.js";
import {
  createPerturbationsAtPercent,
  DEFAULT_SEED,
  INPUTS,
  SINK,
  SOURCE,
} from "../src/scenarios.js";

function run(lines) {
  return runSimulation({ lines, source: SOURCE, sink: SINK, seed: DEFAULT_SEED });
}

function runMeasured(lines) {
  return runSimulation({ lines, source: SOURCE, sink: SINK, seed: DEFAULT_SEED, measure: true });
}

function completionRatioVariationBasisPoints(baseline, candidate) {
  const baselineValues = baseline.measurements;
  const candidateValues = candidate.measurements;
  if (
    baselineValues.totalCompleted <= 0
    || baselineValues.totalInjected <= 0
    || candidateValues.totalInjected <= 0
  ) {
    return null;
  }
  const candidateScaled = BigInt(candidateValues.totalCompleted) * BigInt(baselineValues.totalInjected);
  const baselineScaled = BigInt(baselineValues.totalCompleted) * BigInt(candidateValues.totalInjected);
  const difference = candidateScaled >= baselineScaled
    ? candidateScaled - baselineScaled
    : baselineScaled - candidateScaled;
  const denominator = BigInt(candidateValues.totalInjected) * BigInt(baselineValues.totalCompleted);
  return Number((difference * 10_000n) / denominator);
}

const first = run(INPUTS.straight);
const second = run(INPUTS.straight);
const stableBase = runMeasured(INPUTS.distributed);
const sensitivityLevels = [1, 3, 10].map((percent) => (
  createPerturbationsAtPercent(INPUTS.distributed, percent).map(runMeasured)
));
const perturbed = sensitivityLevels[0];
const choices = [first, stableBase, run(INPUTS.detour)];

test("1. same seed and input produce the same state hash", () => {
  assert.equal(first.stateHash, second.stateHash);
  assert.deepEqual(first.perPathFlow, second.perPathFlow);
});

test("2. at least 9 of 10 1% perturbations keep completionRatio within 5%", () => {
  let passing = 0;
  let failing = 0;
  let indeterminate = 0;
  for (let index = 0; index < perturbed.length; index += 1) {
    const result = perturbed[index];
    const variation = completionRatioVariationBasisPoints(stableBase, result);
    if (variation === null) {
      indeterminate += 1;
    } else if (variation <= 500) {
      passing += 1;
    } else {
      failing += 1;
    }
  }
  assert.ok(
    indeterminate === 0 && passing >= 9,
    `distributed completionRatio: pass=${passing}, fail=${failing}, indeterminate=${indeterminate}; baseline=${stableBase.measurements.totalCompleted}/${stableBase.measurements.totalInjected}`,
  );
});

function sensitivitySummary(results) {
  const rates = [];
  let indeterminate = 0;
  for (let index = 0; index < results.length; index += 1) {
    const variation = completionRatioVariationBasisPoints(stableBase, results[index]);
    if (variation === null) {
      indeterminate += 1;
      continue;
    }
    rates.push(variation);
  }
  rates.sort((left, right) => left - right);
  const middle = (rates.length / 2) | 0;
  const medianTwiceBasisPoints = rates.length === 0
    ? null
    : rates.length % 2 === 0
      ? rates[middle - 1] + rates[middle]
      : rates[middle] * 2;
  return { indeterminate, medianTwiceBasisPoints };
}

const sensitivitySummaries = sensitivityLevels.map(sensitivitySummary);
const sensitivityAssessable = sensitivitySummaries.every((summary) => summary.indeterminate === 0);

test("3. median completionRatio sensitivity is monotonic and 10% is at least 3x the 1% response", () => {
  const monotonic = sensitivitySummaries[0].medianTwiceBasisPoints <= sensitivitySummaries[1].medianTwiceBasisPoints
    && sensitivitySummaries[1].medianTwiceBasisPoints <= sensitivitySummaries[2].medianTwiceBasisPoints;
  const separated = sensitivitySummaries[2].medianTwiceBasisPoints
    >= sensitivitySummaries[0].medianTwiceBasisPoints * 3;
  assert.ok(
    sensitivityAssessable && monotonic && separated,
    `indeterminate=${sensitivitySummaries.map((summary) => summary.indeterminate).join(",")}; medianTwiceBasisPoints=${sensitivitySummaries.map((summary) => summary.medianTwiceBasisPoints).join(",")}`,
  );
});

test("4. no one input Pareto-dominates both alternatives", () => {
  const allWin = choices.some((candidate, candidateIndex) => choices.every((other, otherIndex) => {
    if (candidateIndex === otherIndex) return true;
    const candidateCompletion = candidate.completionStep < 0 ? Number.POSITIVE_INFINITY : candidate.completionStep;
    const otherCompletion = other.completionStep < 0 ? Number.POSITIVE_INFINITY : other.completionStep;
    const noWorse = candidate.totalCompleted >= other.totalCompleted
      && candidateCompletion <= otherCompletion
      && candidate.maxStagnation <= other.maxStagnation;
    const betterSomewhere = candidate.totalCompleted > other.totalCompleted
      || candidateCompletion < otherCompletion
      || candidate.maxStagnation < other.maxStagnation;
    return noWorse && betterSomewhere;
  }));
  assert.equal(allWin, false);
});
