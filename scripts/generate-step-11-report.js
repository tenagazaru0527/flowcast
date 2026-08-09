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
function multiplier(numerator, denominator) {
  return denominator === 0 ? "—" : `${(numerator / denominator).toFixed(2)}x`;
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

function fieldEdgeControlRows(rows) {
  return rows.filter((row) => number(row["param.restoreWeight"]) === 0 && number(row["param.congestionWeight"]) === 0
    && [2, 8].includes(number(row["param.corridorWidth"])) && row["param.corridorBlocksOutOfField"] === "true").map((enabled) => {
    const disabled = rows.find((row) => row.inputName === enabled.inputName
      && row["param.corridorBlocksOutOfField"] === "false"
      && number(row["param.restoreWeight"]) === 0
      && number(row["param.congestionWeight"]) === 0
      && number(row["param.corridorWidth"]) === number(enabled["param.corridorWidth"])
      && number(row["param.gapWidth"]) === number(enabled["param.gapWidth"]));
    const enabledMax = number(enabled["measurement.fieldEdgeDensityMax"]);
    const disabledMax = number(disabled["measurement.fieldEdgeDensityMax"]);
    return `| ${enabled.inputName} | ${enabled["param.corridorWidth"]} | ${enabled["param.gapWidth"]} | ${enabledMax} ${cell(enabled["measurement.fieldEdgeDensityMaxCell"])} | ${disabledMax} ${cell(disabled["measurement.fieldEdgeDensityMaxCell"])} | ${multiplier(enabledMax, disabledMax)} |`;
  });
}

function fieldEdgeRiskRows(rows) {
  return primary(rows).map((row) => {
    const fieldEdgeMax = number(row["measurement.fieldEdgeDensityMax"]);
    const densityMaxExSource = number(row["measurement.densityMaxExSource"]);
    return `| ${row.inputName} | ${row["param.congestionWeight"]} | ${row["param.corridorWidth"]} | ${row["param.gapWidth"]} | ${fieldEdgeMax} ${cell(row["measurement.fieldEdgeDensityMaxCell"])} | ${densityMaxExSource} ${cell(row["measurement.densityMaxExSourceCell"])} | ${percent(fieldEdgeMax, densityMaxExSource)} |`;
  });
}

function conductanceBlockedFrontRows(rows) {
  const selected = primary(rows).filter((row) => number(row["param.congestionWeight"]) === 0);
  return selected.map((withoutConductance) => {
    const withConductance = primary(rows).find((row) => row.inputName === withoutConductance.inputName
      && number(row["param.congestionWeight"]) === Q
      && number(row["param.corridorWidth"]) === number(withoutConductance["param.corridorWidth"])
      && number(row["param.gapWidth"]) === number(withoutConductance["param.gapWidth"]));
    const maxWithout = number(withoutConductance["measurement.blockedFrontDensityMax"]);
    const maxWith = number(withConductance["measurement.blockedFrontDensityMax"]);
    const peakWithout = number(withoutConductance["measurement.blockedFrontDensityPeak"]);
    const peakWith = number(withConductance["measurement.blockedFrontDensityPeak"]);
    return `| ${withoutConductance.inputName} | ${withoutConductance["param.corridorWidth"]} | ${withoutConductance["param.gapWidth"]} | ${maxWithout} ${cell(withoutConductance["measurement.blockedFrontDensityMaxCell"])} | ${maxWith} ${cell(withConductance["measurement.blockedFrontDensityMaxCell"])} | ${multiplier(maxWith, maxWithout)} | ${peakWithout} ${cell(withoutConductance["measurement.blockedFrontDensityPeakCell"])} | ${peakWith} ${cell(withConductance["measurement.blockedFrontDensityPeakCell"])} | ${multiplier(peakWith, peakWithout)} |`;
  });
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
  "## 2. 場の縁の密度", "",
  "### 2-1. `fieldEdgeDensityMax` の cbof=true / false 比較", "",
  "同一の input / cw / g / `congestionWeight=0` / `restoreWeight=0` の対照行を比較した。倍率は `cbof=true ÷ cbof=false`、分母が0のときは `—`。", "",
  "| input | cw | g | cbof=true max cell | cbof=false max cell | true/false |", "|---|---:|---:|---|---|---:|", ...fieldEdgeControlRows(rows), "",
  "### 2-2. `fieldEdgeDensityMax` と `densityMaxExSource` の比", "",
  "主格子（`cbof=true`, `restoreWeight=0`）の全行。比は `fieldEdgeDensityMax ÷ densityMaxExSource`。", "",
  "| input | congestionWeight | cw | g | fieldEdgeDensityMax cell | densityMaxExSource cell | edge/ex-source |", "|---|---:|---:|---:|---|---|---:|", ...fieldEdgeRiskRows(rows), "",
  "## 4. 通気度と壁前面滞留の関係", "",
  "主格子（`cbof=true`, `restoreWeight=0`）で、`congestionWeight=0` と `Q` を同じ input / cw / g ごとに並べた。倍率は `Q ÷ 0`、分母が0のときは `—`。", "",
  "| input | cw | g | blockedFront max (0) cell | blockedFront max (Q) cell | Q/0 | blockedFront peak (0) cell | blockedFront peak (Q) cell | Q/0 |", "|---|---:|---:|---|---|---:|---|---|---:|", ...conductanceBlockedFrontRows(rows), "",
  "## 副観測・保存則（全52点 × 3入力）", "", "`blockedFront*` は障害物なしでは null。セルの3要素目は観測ステップ。保存則欄は `completed + outOfField + remaining = injected`。", "",
  `densityMaxExSourceCell が障害物前列 x=31 に来た行数: ${wallFrontDensityMaxExSourceCount}。`, "",
  "| point | input | central ratio | completion | remaining | out | outByEdge | fieldEdge max cell | fieldEdge peak cell | blockedFront max cell | blockedFront peak cell | densityMaxExSource cell | corridorEdge max mean peak | corridorEdge cells | occupied peak | coherence | outside | conservation |", "|---|---|---:|---:|---:|---:|---|---|---|---|---|---|---|---|---:|---:|---:|---|", ...observationRows(rows), "",
].join("\n");
await writeFile(reportPath, report, "utf8");
