# Step 8 完了報告

- Issue: Closes #10
- engineVersion: 0.8.0
- 実装: 既存guideへ静的距離場由来の復元ベクトルを加算。既定 `restoreWeight=0`。

## 実装記録

- 距離場は焼き込みguideが存在するセルを始点に、通行可能セルだけをFIFO BFSする。近傍順は **上・下・左・右**。
- 最急降下の同値も同じ順で最初の近傍を選ぶ。障害物は距離場・復元方向の双方で通過しない。
- `g(D) = min(D, 4) / 4`。距離1〜4でQ/4ずつ増え、Qで飽和する。遠方で無制限に強くならず、線外の材料を帯へ戻す力だけを加える。
- `restoreWeight=0` 時は加算項が常に0となる。距離場は計算するが、0.7.0の3シナリオ×3入力の全ハッシュが一致した。

## 互換性と検証

- poc-0-default: `4910305d / e63ba5b1 / 9164f600`
- poc-1-wide: `f7606aa8 / 97a13950 / 13073731`
- poc-2-canyon: `e3ddaebc / 6e03aff9 / ae3a98ad`
- `test/core.test.js` に `restoreWeight=0` の恒久互換テスト、固定近傍順・障害物回避テストを追加。
- `measure=true/false` の既存無影響テストを維持。掃引の各測定は保存則を満たした（ハーネスが測定時に検査）。

## 第1掃引: wide / モードA

- 生データ: [`data/step-08-wide-sweep.csv`](./data/step-08-wide-sweep.csv)
- `restoreWeight`: 0, Q/16, Q/8, Q/4, Q/2, Q。
- detourの `outOfFieldRatio` は0で28%、Q/16以降で0%。完了率は58%から91〜92%。
- 第2掃引には **0, Q/16, Q** を採用。0は比較基準、Q/16は最初に場外損失が明確に下がった値、Qは飽和域端点として記録するためであり、既定値の選定ではない。

## 第2掃引: canyon / モードB

- 生データ: [`data/step-08-canyon-sweep.csv`](./data/step-08-canyon-sweep.csv)
- 格子: restoreWeight {0, Q/16, Q} × gapWidth {1,3,9} × edgeFluxMax {Q,512}。全18点、234ラン。
- detour: weight 0で完了率6〜7%、場外78〜79%。Q/16で85%・場外0%、Qで86%・場外0%。
- detour gap throughput: weight 0で約91〜95万、Q/16以降で約343〜345万。
- 基本ランの `criterion4Dominated`、感度の生値、ギャップ手前を含む計測値はCSVに記録した。合否・順位・推奨はハーネスから出していない。

## 残リスク・判断を仰ぎたい点

- 既定 `restoreWeight` は0のまま。掃引記録からの既定値決定は別Issueとする。
- 距離場BFS単体は障害物なしdetour入力で **0.7269 ms/ラン**（1000回平均、Node 20）だった。
