# 開発ループ（flowcast PoC）

## 1周の手順

1. `docs/DECISIONS.md` を全文読み、撤回済み・保留中の判断を確認する
2. 指示を受ける（スコープ・禁止事項・完了条件・想定結果が明記されている）
3. `step/NN` ブランチを作成する
4. 実装する
5. `npm run verify` と必要な測定を実行する
6. 固定フォーマットの報告と掃引CSVを `docs/reports/` に置く
7. 報告時に `docs/DECISIONS.md` の該当行を更新する。保留中の判断が決着したら
   「有効な決定」または「撤回・棄却された主張」へ移す
8. commit・pushし、`step/NN` から `main` へのPRを作成する
9. 下記の確認不要条件を満たさない限り、マージせずレビューを待つ

## GitHub 運用

- `main` へ直接コミットせず、`step/NN`（例: `step/035`）で作業する
- 報告はチャットやPR本文ではなく `docs/reports/step-NN.md` にcommitする
- 掃引CSVは `docs/reports/data/step-NN-sweep.csv` に置く。JSONLはcommitしない
- CSVが1MBを超える場合は要約版を置き、報告に明記する
- PR本文は先頭に対応するIssueを記載し、その次に
  `docs/reports/step-NN.md` へのリンクだけを記載する
- PR作成後はマージせず停止し、レビュー結果を待つ

## push の義務

- コミット後は必ず `git push` を実行すること
- **報告には push の成否を明記すること。** commit だけで「完了」と報告しない
- push 後に `git ls-remote --heads origin` の出力を報告に含めること

理由：レビュー担当はリポジトリを git 経由でしか読めない。
ローカルのコミットは存在しないのと同じである。

### Issue のクローズ

PR本文の先頭には、対応するIssueを次の規則で記載する。

- 1つのIssueが1つのPRで完結する場合は `Closes #N` とし、マージ時に自動でクローズする
- 1つのIssueが複数のPRにまたがる場合は `Refs #N` とし、最後のPRのマージ後にCodexが明示的にクローズする

Issueを明示的にクローズするときのコメントには、次の項目だけを記載する。

- 報告ファイルのパス（`docs/reports/step-NN.md`）
- 積み残しがある場合は、それを引き継いだ先のIssue番号

CI通過後、確認不要でマージできる変更は次のとおり。

- 事前に承認済みのStepの実装
- ハッシュ不変が証明できる計装追加・最適化・可視化
- 掃引の実行と結果の記録
- `src/**` に差分がない変更
- ドキュメント・テストのみの変更

次の変更はPR作成後に必ず停止し、確認を得る。

- 基準の定義・閾値の変更
- モデルの定式化の変更（移送規則・境界条件・場の構造）
- `src/config.js` の既定値の変更
- 工程の順序変更、Stepの追加・スキップ
- テーマ・製品名・描画スタックの決定
- 想定と実測が大きく食い違った場合
- 指示に誤りや矛盾があると判断した場合

## 即時停止条件（実装せず報告する）

- 指示が現行コードの構造と矛盾する
- 指示されたコードに誤りがある
- 指示のスコープ外のファイルに触れる必要がある
- ハッシュが変わったが engineVersion の更新指示がない
- 基準を通すために定数を変えたくなった
- 想定結果と実測が大きく食い違う

## 不変条件（毎周チェックする）

- engineVersion を上げたら同一コミットで `runtime-hashes.json` に記録する
- `measure=true` と `measure=false` でハッシュが一致する
- `src/` に禁止APIがない
- 基準の閾値を変更しない
- 未達は未達のまま報告する
- 掃引は判定を行わない（記録のみ）

## テスト構成

`test/core.test.js` は短時間のコアテスト、`test/hashes.test.js` はバージョン間の
ハッシュ回帰テスト、`test/conservation.test.js` は保存則テスト、
`test/sweep.test.js` は掃引ハーネスのテストを持つ。CI は4種類を独立ジョブとして
Node 20 / 22 で並列実行し、各ジョブのタイムアウトは15分、`fail-fast` は無効とする。
core ジョブでは受け入れ基準レポート、禁止API検査、runtime hash検査も実行する。
`npm run verify` は分割前と同じく、禁止API・runtime hash・core由来の全テストを検証する。

### source / sink の多セル規則

- source / sink は座標配列とし、シナリオ定義側で昇順に固定する。実行時にソートしない
- 総注入量 `injectionPerStep` はsourceセル群全体で維持する
- `base = (injectionPerStep / cellCount) | 0`
- `remainder = injectionPerStep - base * cellCount`
- 配列先頭の `remainder` セルへ `base + 1`、残りへ `base` を割り当てる
- sinkセル群はいずれも到達分を除去し、完了量は全sinkセルの合計とする

## 固定報告フォーマット

```markdown
## Step N 完了報告
- engineVersion:
- ハッシュ確認:

### 基準判定
| 基準 | 結果 | 前ステップからの変化 |
|---|---|---|

### 主要計測値
| 入力 | completionRatio | densityMaxExSource | densityMax(source平衡値) | occupiedPeak | maxStagnation | backflow | completionStep(参考) |
|---|---:|---:|---:|---:|---:|---:|---:|

### 修正前後の比較
| 入力 | completionRatio 前 | 後 | densityMaxExSource 前 | 後 | occupiedPeak 前 | 後 |
|---|---:|---:|---:|---:|---:|---:|

### guideMagnitudeMax
- 修正前:
- 修正後:

### 検証ゲート
- npm run verify:
- npm run report:
- git diff --check:

### 変更ファイル
- ファイル名: 変更内容

### 残リスク・判断を仰ぎたい点
```

## 掃引モード

掃引の実行本数を Issue で指定する。**指定がない場合は B とする。**

| モード | 実行内容 | 掃引点1つあたり |
|---|---|---:|
| A（探索） | 3入力の基本ラン＋基準4（基本ランから算出） | 3ラン |
| B（既定） | A ＋ 基準2（1%変位 × 10） | 13ラン |
| C（感度が論点） | B ＋ 基準3（3% / 10% × 各10） | 33ラン |

### 選び方

- **A**：場で何が起きるかを問う Step（滞留の発生、経路の勝敗、分布の形）
- **B**：既定。手ぶれ耐性がパラメータでどう変わるかを見たい場合
- **C**：感度そのものが論点の Step（adv:diff 比の掃引など）

### 基準1（決定性）は掃引で評価しない

決定性はエンジンの性質であり、掃引点ごとの性質ではない。
`scripts/check-runtime-hashes.js` と CI が既に担保している。
**掃引点ごとの再実行は行わない。**

### steps は変更しない

探索目的でも `steps` を 3600 から変えないこと。
判定用の結果と混ざると比較不能になる。

## 掃引ハーネス

`scripts/sweep.js` は実行と記録だけを行い、合否判定・順位付け・推奨を行わない。
出力は `sweep-out/results.jsonl` と `sweep-out/results.csv` で、格子順、実行種別順に固定される。
モードにかかわらずCSV列は同一で、実行していない感度項目は空欄となる（0ではない）。
基準4は3入力の基本ランから `criterion4Dominated` として算出する。これは優越関係の生値であり、
掃引ハーネスは合否・順位・推奨を出力しない。
`sampleInterval` は既定 `0` のままとし、`measurements.timeline` は掃引CSVへ
展開しない。最終状態の `lineDistanceDensity` / `lineDistanceCells` /
`lineDistanceUnreachable` / `lineDistanceUnreachableCells` も掃引CSVへ展開しない。
`sinkGroups` は渡さず、`sinkThroughput` / `sinkFirstArrivalStep` も掃引CSVへ展開しない。
`sampleDensity` は渡さず既定 `false` のままとする。
Step 16基準とのCSV全内容diffで差分がないことを確認する。
既存の掃引CSV列構成は変更しない。

```bash
node scripts/sweep.js --param capacity --values 65536,131072,262144 --mode B
node scripts/sweep.js --grid grid.json --scenario canyon --mode C --workers 4
node --test test/sweep.test.js
```

Node 22 での決定性確認は CI（Node 20/22 マトリクス）が担保する。
ローカルでは Node 20 のみで検証し、Node 22 の結果は CI の実行結果を参照する。
ローカルに Node 22 を導入しないこと（本構成はゼロ依存を維持する）。

多次元格子は、配列形式、`{ "points": [...] }`、または次の直積形式を受け付ける。

```json
{
  "parameters": [
    { "name": "capacity", "values": [65536, 131072] },
    { "name": "edgeFluxMax", "values": [32768, 65536] }
  ]
}
```

## 密度デバッグビューア

`debug/` は製品描画ではなく、`runSimulation` の出力を読む診断専用Canvasビューアである。
リポジトリ直下でHTTPサーバーを起動し、ブラウザーから開く。ビルドは不要。

```bash
python3 -m http.server 8000
```

```text
http://localhost:8000/debug/
```

`poc-0-default` / `poc-1-wide` / `poc-2-canyon` と峡谷の `gapWidth` を選択し、
Step 11までの設定値を操作できる。キャンバスでは3〜5本の線をQ16.16座標で編集し、
各シナリオの `straight` / `distributed` / `detour` をプリセットとして読み込める。
線は点を1個ずつ置くか、ポインタでなぞって入力する。なぞり入力だけは0 / 0.25 /
0.5 / 1.0セルの距離間引きを選択でき、線別と合計の制御点数を表示する。

同じキャンバスで障害物の切替・連続塗り・矩形塗り、複数セルのsource / sink、最大4群の
名前付きgapと最大4群の名前付きsink groupを編集できる。sink groupはsink全セルを重複なく
分割する必要があり、未定義なら実行可能、不正なら理由を表示して実行を無効化する。
source / sink / blocked / gap / sink groupはセル座標の昇順を保って保存し、実行時には
ソートしない。編集後の盤面は`scenarioId = custom`となり、検証用3シナリオのハッシュ回帰対象には
含めない。実行前に範囲外、重複、障害物との重なり、source / sinkの空配列、sink groupの全分割を検証する。

最終状態モードは指定stepまで1回だけ再実行する。再生モードは固定の19段階を計算し、
全フレーム共通の色スケールで表示する。生成済みフレームはシナリオ・設定・線・seedが
変わらない間キャッシュされる。障害物、線、回廊の縁、場の縁は個別に表示を切り替えられる。

`sampleInterval` を正の整数にすると、最終状態モードで指定間隔と最終stepの
`measurements.timeline` を表形式で表示する。`completed` / `outOfField` /
`gapThroughput` / `sinkThroughput` は累積値、`remaining` / `blockedFrontDensityMax` /
`densityMaxExSource` / `occupiedCells` は標本時点の瞬時値である。区間通過量/stepは
隣接する累積`gapThroughput`の差分を区間step数で割り、ビューア側だけで計算する。
エンジンは区間量・変化率・判定を計算しない。表示したtimelineの累積値はCSVとして
ダウンロードできる。グラフは描画しない。

`sampleDensity = true` のとき、各timeline標本はその時点の全セル密度を独立した
`Int32Array`の`density`として持つ。既定は`false`で、この場合は`density`キーを持たない。
`sampleInterval = 0`または`measure = false`では記録しない。密度を記録する場合、標本数は
`ceil(steps / sampleInterval)`で事前判定し、200を超えると実行前に例外を投げる。

sink group指定時は、最終状態に群別の`sinkThroughput`と`sinkFirstArrivalStep`を表示する。
未指定時は両方を`null`としてビューアに`—`を表示する。比・順位・到達順の判定は行わない。

最終状態では、既存のBFS距離場を使った線からの距離別の密度合計とセル数を、距離0から
密度合計が最初に0になる距離まで表形式で表示する。全65距離の生値をCSVとして
ダウンロードでき、到達不能セルの密度合計が0でない場合だけ警告する。比・平均・判定や
時系列への追加、グラフ描画は行わない。

現在の盤面は `debug/` 独自形式のJSONとして保存・読み込みでき、URLのハッシュ部でも
共有できる。formatVersion 4は線・`blocked` / `source` / `sink` / `gaps`に加えて
`sinkGroups`を保持する。旧formatVersion 1 / 2は`scenarioId`と`gapWidth`から盤面を復元し、
formatVersion 3は保存済み盤面を`sinkGroups`未定義として読み込む。
URLハッシュ候補が8,000文字を超える場合はURLへ反映せず、JSON保存を案内する。
この形式は `src/scenarios.js` のreplay形式とは別であり、製品用の描画・リプレイ形式を
決定するものではない。同期実行の停止時間を制限するため、steps上限は20,000である。

## 経緯（要点のみ）

- 0.1.0: 決定論的なシミュレーション核と初期測定を実装した。
- 0.2.0: 線の焼き込みを双線形按分へ変更し、測定指標を整備した。基準2は 2/10 だった。
- 0.3.0: guide クランプを成分別からベクトル長へ変更し、方向異方性を除去した。基準2は 6/10 に改善した。
- 0.4.0: 辺ごとの `edgeFluxMax` と流量制限の診断計測を導入した。
