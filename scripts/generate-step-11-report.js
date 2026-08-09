import { readFile, writeFile } from "node:fs/promises";

const csvPath = new URL("../docs/reports/data/step-11-sweep.csv", import.meta.url);
const reportPath = new URL("../docs/reports/step-11.md", import.meta.url);
const inputs = ["straight", "distributed", "detour"];
const gapWidths = [1, 3, 5, 9];
const Q = 65_536;

function parseLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; } else value += character;
  }
  values.push(value);
  return values;
}

function number(value) { return Number(value); }
function cell(value) { return value === "" ? "null" : `(${value})`; }
function percent(numerator, denominator) {
  if (denominator === 0) return "0.00%";
  return `${(Math.floor((numerator * 10_000) / denominator) / 100).toFixed(2)}%`;
}

function readRows(text) {
  const [header, ...lines] = text.trimEnd().split("\n");
  const names = parseLine(header);
  return lines.map((line) => {
    const values = parseLine(line);
    const row = Object.fromEntries(names.map((name, index) => [name, values[index]]));
    return row;
  });
}

function ratio(row) { return percent(number(row["measurement.gapThroughput.central"]), number(row["measurement.gapThroughput.central"]) + number(row["measurement.gapThroughput.detour"])); }
function label(row) { return `cbof=${row["param.corridorBlocksOutOfField"] === "true" ? 1 : 0}, cw=${row["param.corridorWidth"]}, cong=${row["param.congestionWeight"]}, rw=${row["param.restoreWeight"]}, g=${row["param.gapWidth"]}`; }
function primary(rows) { return rows.filter((row) => row["param.corridorBlocksOutOfField"] === "true" && number(row["param.restoreWeight"]) === 0 && [0, Q].includes(number(row["param.congestionWeight"]))); }

function variationRows(rows) {
  const values = [];
  for (const input of inputs) for (const congestionWeight of [0, Q]) for (const corridorWidth of [1, 2, 3, 4, 8]) {
    const selected = primary(rows).filter((row) => row.inputName === input && number(row["param.congestionWeight"]) === congestionWeight && number(row["param.corridorWidth"]) === corridorWidth);
    const ratios = gapWidths.map((gap) => ratio(selected.find((row) => number(row["param.gapWidth"]) === gap)));
    const numeric = ratios.map(Number.parseFloat);
    values.push(`| ${input} | ${congestionWeight} | ${corridorWidth} | ${ratios.join(" / ")} | ${(Math.max(...numeric) - Math.min(...numeric)).toFixed(2)}pt |`);
  }
  return values;
}

function controlRows(rows) {
  return rows.filter((row) => number(row["param.restoreWeight"]) === 0 && number(row["param.congestionWeight"]) === 0 && [2, 8].includes(number(row["param.corridorWidth"]))).map((row) => (
    `| ${row.inputName} | ${row["param.corridorWidth"]} | ${row["param.gapWidth"]} | ${row["param.corridorBlocksOutOfField"] === "true" ? 1 : 0} | ${ratio(row)} | ${row["measurement.completionRatio"]}% | ${row["measurement.outOfFieldRatio"]}% | {bottom:${row["measurement.outOfFieldByEdge.bottom"]},left:${row["measurement.outOfFieldByEdge.left"]},right:${row["measurement.outOfFieldByEdge.right"]},top:${row["measurement.outOfFieldByEdge.top"]}} |`
  ));
}

function observationRows(rows) {
  return rows.map((row) => {
    const remaining = number(row["measurement.totalInjected"]) - number(row["measurement.totalCompleted"]) - number(row["measurement.outOfField"]);
    return `| ${label(row)} | ${row.inputName} | ${ratio(row)} | ${row["measurement.completionRatio"]}% | ${row["measurement.remainingRatio"]}% | ${row["measurement.outOfFieldRatio"]}% | {bottom:${row["measurement.outOfFieldByEdge.bottom"]},left:${row["measurement.outOfFieldByEdge.left"]},right:${row["measurement.outOfFieldByEdge.right"]},top:${row["measurement.outOfFieldByEdge.top"]}} | ${row["measurement.fieldEdgeDensityMax"]} ${cell(row["measurement.fieldEdgeDensityMaxCell"])} | ${row["measurement.fieldEdgeDensityPeak"]} ${cell(row["measurement.fieldEdgeDensityPeakCell"])} | ${row["measurement.blockedFrontDensityMax"]} ${cell(row["measurement.blockedFrontDensityMaxCell"])} | ${row["measurement.blockedFrontDensityPeak"]} ${cell(row["measurement.blockedFrontDensityPeakCell"])} | ${cell(row["measurement.densityMaxExSourceCell"])} | ${row["measurement.corridorEdgeDensityMax"]} ${row["measurement.corridorEdgeDensityMean"]} ${row["measurement.corridorEdgeDensityPeak"]} | ${cell(row["measurement.corridorEdgeDensityMaxCell"])} / ${cell(row["measurement.corridorEdgeDensityPeakCell"])} | ${row["measurement.occupiedCellsPeak"]} | ${row["measurement.coherenceLength"]} | ${row["measurement.outsideCorridorCells"]} | ${row["measurement.totalCompleted"]}+${row["measurement.outOfField"]}+${remaining}=${row["measurement.totalInjected"]} |`;
  });
}

const rows = readRows(await readFile(csvPath, "utf8"));
if (rows.some((row) => row["param.corridorBlocksOutOfField"] === "true" && number(row["measurement.outOfField"]) !== 0)) {
  throw new Error("corridorBlocksOutOfField=true produced non-zero outOfField");
}
if (rows.some((row) => number(row["measurement.outsideCorridorCells"]) !== 0)) {
  throw new Error("outsideCorridorCells must be zero");
}
const wallFrontDensityMaxExSourceCount = rows.filter((row) => row["measurement.densityMaxExSourceCell"].startsWith("31,")).length;
const report = [
  "# Step 11 観測記録", "",
  "engineVersion 0.11.0。主格子40点、場外遮断対照8点、復元力対照4点の計52点を、各入力で mode A 実行した。`gapWidth=63` は含めない。以下は測定値のみであり、推奨・順位付け・判定を含めない。", "",
  "## 主観測：中央ルート比率", "", "| input | congestionWeight | cw | g=1 / 3 / 5 / 9 | 変化幅 |", "|---|---:|---:|---|---:|", ...variationRows(rows), "",
  "## 場外遮断 true / false の対照", "", "| input | cw | g | cbof | 中央ルート比率 | completionRatio | outOfFieldRatio | outOfFieldByEdge |", "|---|---:|---:|---:|---:|---:|---:|---|", ...controlRows(rows), "",
  "## 副観測・保存則（全52点 × 3入力）", "", "`blockedFront*` は障害物なしでは null。セルの3要素目は観測ステップ。保存則欄は `completed + outOfField + remaining = injected`。", "",
  `densityMaxExSourceCell が障害物前列 x=31 に来た行数: ${wallFrontDensityMaxExSourceCount}。`, "",
  "| point | input | central ratio | completion | remaining | out | outByEdge | fieldEdge max cell | fieldEdge peak cell | blockedFront max cell | blockedFront peak cell | densityMaxExSource cell | corridorEdge max mean peak | corridorEdge cells | occupied peak | coherence | outside | conservation |", "|---|---|---:|---:|---:|---:|---|---|---|---|---|---|---|---|---:|---:|---:|---|", ...observationRows(rows), "",
].join("\n");
await writeFile(reportPath, report, "utf8");
