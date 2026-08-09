import { mkdir, writeFile } from "node:fs/promises";

import { Q } from "../src/config.js";
import { createCanyonScenario, DEFAULT_SEED } from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";
import { runSweep, serializeCsv } from "./sweep.js";

const outputDirectory = new URL("../docs/reports/data/", import.meta.url);
const shared = { congestionReference: 2_048, edgeFluxMax: 512 };
const gapWidths = [1, 3, 9, 63];

function step10Points() {
  const primary = [1, 2, 3, 4, 8].flatMap((corridorWidth) => [0, Q].flatMap((congestionWeight) => (
    gapWidths.map((gapWidth) => ({ ...shared, corridorWidth, restoreWeight: 0, congestionWeight, gapWidth }))
  )));
  const controls = [0, Q].flatMap((congestionWeight) => (
    gapWidths.map((gapWidth) => ({ ...shared, corridorWidth: 2, restoreWeight: Q >> 4, congestionWeight, gapWidth }))
  ));
  return [...primary, ...controls];
}

function step9Points() {
  return [0, Q >> 1, Q].flatMap((congestionWeight) => [2_048, 4_096, 8_192, 16_384].flatMap((congestionReference) => (
    gapWidths.map((gapWidth) => ({ edgeFluxMax: 512, restoreWeight: Q >> 4, congestionWeight, congestionReference, gapWidth }))
  )));
}

function densityCsv(density) {
  return Array.from({ length: 64 }, (_, y) => (
    Array.from(density.slice(y * 64, (y + 1) * 64)).join(",")
  )).join("\n") + "\n";
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const step10 = await runSweep({ points: step10Points(), mode: "A", scenarioName: "canyon" });
  await writeFile(new URL("step-10-sweep.csv", outputDirectory), serializeCsv(step10), "utf8");

  const step9 = await runSweep({ points: step9Points(), mode: "A", scenarioName: "canyon" });
  await writeFile(new URL("step-09-sweep-regen-0.10.0.csv", outputDirectory), serializeCsv(step9), "utf8");

  const densityDirectory = new URL("step-10-density/", outputDirectory);
  await mkdir(densityDirectory, { recursive: true });
  const densityPoints = [
    ...[1, 2, 3, 4, 8].flatMap((corridorWidth) => [1, 63].map((gapWidth) => ({ corridorWidth, restoreWeight: 0, gapWidth }))),
    ...[1, 63].map((gapWidth) => ({ corridorWidth: 2, restoreWeight: Q >> 4, gapWidth })),
  ];
  for (const point of densityPoints) {
    const scenario = createCanyonScenario(point.gapWidth);
    const result = runSimulation({
      lines: scenario.inputs.distributed,
      source: scenario.source,
      sink: scenario.sink,
      blocked: scenario.blocked,
      gaps: scenario.gaps,
      seed: DEFAULT_SEED,
      config: { ...shared, ...point, congestionWeight: 0 },
      measure: true,
    });
    const name = `distributed-cw${point.corridorWidth}-rw${point.restoreWeight}-g${point.gapWidth}.csv`;
    await writeFile(new URL(name, densityDirectory), densityCsv(result.density), "utf8");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
