import { mkdir, writeFile } from "node:fs/promises";

import { Q } from "../src/config.js";
import { createCanyonScenario, DEFAULT_SEED } from "../src/scenarios.js";
import { runSimulation } from "../src/simulation.js";
import { runSweep, serializeCsv } from "./sweep.js";

const outputDirectory = new URL("../docs/reports/data/", import.meta.url);
const reportPath = new URL("../docs/reports/step-11.md", import.meta.url);
const shared = { congestionReference: 2_048, edgeFluxMax: 512 };
const gapWidths = [1, 3, 5, 9];
const inputs = ["straight", "distributed", "detour"];

function step11Points() {
  const primary = [1, 2, 3, 4, 8].flatMap((corridorWidth) => [0, Q].flatMap((congestionWeight) => (
    gapWidths.map((gapWidth) => ({ ...shared, corridorBlocksOutOfField: true, corridorWidth, restoreWeight: 0, congestionWeight, gapWidth }))
  )));
  const exteriorControls = [2, 8].flatMap((corridorWidth) => gapWidths.map((gapWidth) => (
    { ...shared, corridorBlocksOutOfField: false, corridorWidth, restoreWeight: 0, congestionWeight: 0, gapWidth }
  )));
  const restoreControls = gapWidths.map((gapWidth) => (
    { ...shared, corridorBlocksOutOfField: true, corridorWidth: 2, restoreWeight: Q >> 4, congestionWeight: 0, gapWidth }
  ));
  return [...primary, ...exteriorControls, ...restoreControls];
}

function densityCsv(density) {
  return Array.from({ length: 64 }, (_, y) => (
    Array.from(density.slice(y * 64, (y + 1) * 64)).join(",")
  )).join("\n") + "\n";
}

function percent(numerator, denominator) {
  if (denominator === 0) return "0.00%";
  const basisPoints = Math.floor((numerator * 10_000) / denominator);
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function pointLabel(parameters) {
  return `cbof=${parameters.corridorBlocksOutOfField ? 1 : 0}, cw=${parameters.corridorWidth}, cong=${parameters.congestionWeight}, rw=${parameters.restoreWeight}, g=${parameters.gapWidth}`;
}

function cell(cell) {
  return cell === null ? "null" : `(${cell.join(",")})`;
}

function routeRatio(row) {
  const { central = 0, detour = 0 } = row.measurements.gapThroughput;
  return percent(central, central + detour);
}

function primaryRows(results) {
  return results.filter((row) => row.parameters.corridorBlocksOutOfField
    && row.parameters.restoreWeight === 0
    && [0, Q].includes(row.parameters.congestionWeight));
}

function variationRows(results) {
  const rows = [];
  for (const input of inputs) {
    for (const congestionWeight of [0, Q]) {
      for (const corridorWidth of [1, 2, 3, 4, 8]) {
        const selected = primaryRows(results).filter((row) => row.inputName === input
          && row.parameters.congestionWeight === congestionWeight && row.parameters.corridorWidth === corridorWidth);
        const ratios = gapWidths.map((gapWidth) => routeRatio(selected.find((row) => row.parameters.gapWidth === gapWidth)));
        const values = ratios.map((ratio) => Number.parseFloat(ratio));
        rows.push(`| ${input} | ${congestionWeight} | ${corridorWidth} | ${ratios.join(" / ")} | ${(Math.max(...values) - Math.min(...values)).toFixed(2)}pt |`);
      }
    }
  }
  return rows;
}

function controlRows(results) {
  return results.filter((row) => row.parameters.restoreWeight === 0 && row.parameters.congestionWeight === 0
    && [2, 8].includes(row.parameters.corridorWidth)).map((row) => (
    `| ${row.inputName} | ${row.parameters.corridorWidth} | ${row.parameters.gapWidth} | ${row.parameters.corridorBlocksOutOfField ? 1 : 0} | ${routeRatio(row)} | ${row.measurements.completionRatio}% | ${row.measurements.outOfFieldRatio}% | ${JSON.stringify(row.measurements.outOfFieldByEdge)} |`
  ));
}

function observationRows(results) {
  return results.map((row) => {
    const value = row.measurements;
    return `| ${pointLabel(row.parameters)} | ${row.inputName} | ${routeRatio(row)} | ${value.completionRatio}% | ${value.remainingRatio}% | ${value.outOfFieldRatio}% | ${JSON.stringify(value.outOfFieldByEdge)} | ${value.fieldEdgeDensityMax} ${cell(value.fieldEdgeDensityMaxCell)} | ${value.fieldEdgeDensityPeak} ${cell(value.fieldEdgeDensityPeakCell)} | ${value.blockedFrontDensityMax} ${cell(value.blockedFrontDensityMaxCell)} | ${value.blockedFrontDensityPeak} ${cell(value.blockedFrontDensityPeakCell)} | ${cell(value.densityMaxExSourceCell)} | ${value.corridorEdgeDensityMax} ${value.corridorEdgeDensityMean} ${value.corridorEdgeDensityPeak} | ${cell(value.corridorEdgeDensityMaxCell)} / ${cell(value.corridorEdgeDensityPeakCell)} | ${value.occupiedCellsPeak} | ${value.coherenceLength} | ${value.outsideCorridorCells} | ${value.totalCompleted}+${value.outOfField}+${value.totalInjected - value.totalCompleted - value.outOfField}=${value.totalInjected} |`;
  });
}

function report(results) {
  return [
    "# Step 11 観測記録",
    "",
    "engineVersion 0.11.0。主格子40点、場外遮断対照8点、復元力対照4点の計52点を、各入力で mode A 実行した。`gapWidth=63` は含めない。以下は測定値のみであり、推奨・順位付け・判定を含めない。",
    "",
    "## 主観測：中央ルート比率",
    "",
    "| input | congestionWeight | cw | g=1 / 3 / 5 / 9 | 変化幅 |",
    "|---|---:|---:|---|---:|",
    ...variationRows(results),
    "",
    "## 場外遮断 true / false の対照",
    "",
    "| input | cw | g | cbof | 中央ルート比率 | completionRatio | outOfFieldRatio | outOfFieldByEdge |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...controlRows(results),
    "",
    "## 副観測・保存則（全52点 × 3入力）",
    "",
    "`blockedFront*` は障害物なしでは null。セルの3要素目は観測ステップ。保存則欄は `completed + outOfField + remaining = injected`。",
    "",
    "| point | input | central ratio | completion | remaining | out | outByEdge | fieldEdge max cell | fieldEdge peak cell | blockedFront max cell | blockedFront peak cell | densityMaxExSource cell | corridorEdge max mean peak | corridorEdge cells | occupied peak | coherence | outside | conservation |",
    "|---|---|---:|---:|---:|---:|---|---|---|---|---|---|---|---|---:|---:|---:|---|",
    ...observationRows(results),
    "",
  ].join("\n");
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const densityIndexArgument = process.argv.indexOf("--density-index");
  const densityIndex = densityIndexArgument < 0 ? null : Number(process.argv[densityIndexArgument + 1]);
  if (densityIndex !== null && (!Number.isInteger(densityIndex) || densityIndex < 0 || densityIndex > 11)) {
    throw new RangeError("--density-index must be an integer in [0, 11]");
  }
  if (densityIndex === null) {
    const results = await runSweep({ points: step11Points(), mode: "A", scenarioName: "canyon", workers: 12 });
    for (const row of results) {
      if (row.measurements.outsideCorridorCells !== 0) throw new Error(`outsideCorridorCells must be zero at point ${row.pointIndex}/${row.inputName}`);
      if (row.parameters.corridorBlocksOutOfField && row.measurements.outOfField !== 0) {
        throw new Error(`outOfField must be zero when corridorBlocksOutOfField is true at point ${row.pointIndex}/${row.inputName}`);
      }
    }
    await writeFile(reportPath, report(results), "utf8");
    await writeFile(new URL("step-11-sweep.csv", outputDirectory), serializeCsv(results), "utf8");
  }

  const densityDirectory = new URL("step-11-density/", outputDirectory);
  await mkdir(densityDirectory, { recursive: true });
  const densityPoints = [
    ...[1, 2, 3, 4, 8].flatMap((corridorWidth) => [1, 9].map((gapWidth) => ({ corridorBlocksOutOfField: true, corridorWidth, gapWidth }))),
    ...[1, 9].map((gapWidth) => ({ corridorBlocksOutOfField: false, corridorWidth: 8, gapWidth })),
  ];
  const selectedDensityPoints = densityIndex === null ? densityPoints : [densityPoints[densityIndex]];
  await Promise.all(selectedDensityPoints.map(async (point) => {
    const scenario = createCanyonScenario(point.gapWidth);
    const result = runSimulation({
      lines: scenario.inputs.distributed,
      source: scenario.source,
      sink: scenario.sink,
      blocked: scenario.blocked,
      gaps: scenario.gaps,
      seed: DEFAULT_SEED,
      config: { ...shared, ...point, restoreWeight: 0, congestionWeight: 0 },
      measure: true,
    });
    const name = `distributed-cbof${point.corridorBlocksOutOfField ? 1 : 0}-cw${point.corridorWidth}-g${point.gapWidth}.csv`;
    await writeFile(new URL(name, densityDirectory), densityCsv(result.density), "utf8");
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
