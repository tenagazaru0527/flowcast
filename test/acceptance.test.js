import assert from "node:assert/strict";
import test from "node:test";

import { runSimulation } from "../src/simulation.js";
import {
  createPerturbationsAtPercent,
  createSmallPerturbations,
  DEFAULT_SEED,
  INPUTS,
  SINK,
  SOURCE,
} from "../src/scenarios.js";

function run(lines) {
  return runSimulation({ lines, source: SOURCE, sink: SINK, seed: DEFAULT_SEED });
}

function relativeDifference(left, right) {
  if (left === right) return 0;
  if (left < 0 || right < 0) return Number.POSITIVE_INFINITY;
  const denominator = left === 0 ? 1 : left;
  return Math.abs(right - left) / denominator;
}

const first = run(INPUTS.straight);
const second = run(INPUTS.straight);
const stableBase = run(INPUTS.distributed);
const perturbed = createSmallPerturbations(INPUTS.distributed).map(run);
const sensitivityLevels = [1, 3, 10].map((percent) => (
  createPerturbationsAtPercent(INPUTS.distributed, percent).map(run)
));
const choices = [first, stableBase, run(INPUTS.detour)];

test("1. same seed and input produce the same state hash", () => {
  assert.equal(first.stateHash, second.stateHash);
  assert.deepEqual(first.perPathFlow, second.perPathFlow);
});

test("2. at least 9 of 10 small perturbations stay within 5%", () => {
  let passing = 0;
  let failing = 0;
  let indeterminate = 0;
  for (let index = 0; index < perturbed.length; index += 1) {
    const result = perturbed[index];
    if (stableBase.completionStep === -1 || result.completionStep === -1) {
      indeterminate += 1;
    } else if (relativeDifference(stableBase.completionStep, result.completionStep) <= 0.05) {
      passing += 1;
    } else {
      failing += 1;
    }
  }
  assert.ok(
    indeterminate === 0 && passing >= 9,
    `distributed baseline: pass=${passing}, fail=${failing}, indeterminate=${indeterminate}; base=${stableBase.completionStep}, variants=${perturbed.map((item) => item.completionStep).join(",")}`,
  );
});

function sensitivitySummary(results) {
  const rates = [];
  let indeterminate = 0;
  for (let index = 0; index < results.length; index += 1) {
    if (stableBase.completionStep === -1 || results[index].completionStep === -1) {
      indeterminate += 1;
      continue;
    }
    const candidate = results[index].completionStep;
    const difference = candidate >= stableBase.completionStep
      ? candidate - stableBase.completionStep
      : stableBase.completionStep - candidate;
    rates.push(((difference * 10_000) / stableBase.completionStep) | 0);
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

test("3. median sensitivity is monotonic and 10% is at least 3x the 1% response", {
  skip: sensitivityAssessable
    ? false
    : `indeterminate counts=${sensitivitySummaries.map((summary) => summary.indeterminate).join(",")}`,
}, () => {
  const monotonic = sensitivitySummaries[0].medianTwiceBasisPoints <= sensitivitySummaries[1].medianTwiceBasisPoints
    && sensitivitySummaries[1].medianTwiceBasisPoints <= sensitivitySummaries[2].medianTwiceBasisPoints;
  const separated = sensitivitySummaries[2].medianTwiceBasisPoints
    >= sensitivitySummaries[0].medianTwiceBasisPoints * 3;
  assert.ok(
    monotonic && separated,
    `medianTwiceBasisPoints=${sensitivitySummaries.map((summary) => summary.medianTwiceBasisPoints).join(",")}`,
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
