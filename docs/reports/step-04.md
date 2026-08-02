## Step 4 完了報告

- engineVersion: 0.5.0（計測専用追加のため据え置き）
- ハッシュ確認: 直進 `4910305d` / 分散 `e63ba5b1` / 迂回 `9164f600`
- Issue: #2
- 生データ: [`data/step-04-sweep.csv`](./data/step-04-sweep.csv)（7,156 bytes、全30ケース）

### 計測規則

- `sigmaProfile`: 最終密度から列ごとの重心・分散を整数モーメントで計算し、sigmaをQ16.16で保持する
- 列密度0は `null` とし、CSVでは空欄にする
- `coherenceLength`: source x=4から走査し、sigmaが初めて2.0を超えるx。一度も超えなければ63
- CSVのsigmaはQ16.16値を実数へ戻し、小数4桁で記録する

### coherenceLength・主要掃引値

各セルは `直進 / 分散 / 迂回` の順。

| adv:diff | coherenceLength | occupiedPeak | completionRatio | outOfFieldRatio |
|---|---:|---:|---:|---:|
| 1:4 | 4 / 4 / 4 | 4090 / 4092 / 4091 | 18 / 23 / 20 | 70 / 62 / 67 |
| 1:1 | 4 / 4 / 4 | 4037 / 4084 / 4090 | 30 / 34 / 22 | 60 / 53 / 65 |
| 2:1 | 4 / 4 / 4 | 3950 / 4069 / 4088 | 36 / 40 / 23 | 54 / 48 / 64 |
| 4:1 | 19 / 4 / 4 | 2656 / 3841 / 4058 | 44 / 45 / 23 | 47 / 44 / 63 |
| 8:1 | 38 / 4 / 4 | 1266 / 2689 / 4045 | 53 / 48 / 24 | 38 / 41 / 62 |
| 16:1 | 52 / 4 / 4 | 502 / 2458 / 3962 | 62 / 50 / 24 | 30 / 38 / 59 |
| 32:1 | 58 / 4 / 4 | 308 / 2133 / 3141 | 71 / 53 / 24 | 22 / 34 / 57 |
| 64:1 | 59 / 4 / 4 | 234 / 1836 / 2245 | 77 / 54 / 26 | 15 / 30 / 55 |
| 128:1 | 60 / 5 / 4 | 135 / 1045 / 1574 | 78 / 56 / 28 | 14 / 31 / 53 |
| 256:1 | 60 / 6 / 6 | 123 / 675 / 1089 | 79 / 57 / 30 | 14 / 32 / 54 |

### sigmaProfile の観測

- coherenceLength最大: 直進は128:1・256:1の60、分散は256:1の6、迂回は256:1の6
- 1:4〜2:1では3入力ともsource列からsigma>2で、全域に幅広い分布を持つ
- 4:1以上では直進のsigmaが分散・迂回から分離し、比率増加に伴って低sigma区間が伸びる
- 64:1で直進と分散は一致しない。x=4/16/32/60のsigmaは、直進 `0.05/0.04/0.10/2.61`、分散 `9.20/9.53/8.11/6.92`
- 256:1では直進がx=56までsigma 0.35以下、x=60で2.09。分散・迂回は中域でsigma 4〜8を持つ
- 全入力でcoherenceLength=63となる比率はない

### 基準判定の比率依存

基準3の数値は1% / 3% / 10%摂動に対するcompletionRatio変化率の中央値。

| adv:diff | 基準1 | 基準2（pass/10） | 基準3中央値 | 基準3 | 基準4 |
|---|---|---:|---|---|---|
| 1:4 | PASS | 1 | 8.850% / 4.230% / 10.785% | FAIL | FAIL |
| 1:1 | PASS | 9 | 2.535% / 8.305% / 15.810% | PASS | FAIL |
| 2:1 | PASS | 6 | 3.465% / 13.940% / 23.845% | PASS | FAIL |
| 4:1 | PASS | 3 | 6.645% / 18.125% / 28.885% | PASS | FAIL |
| 8:1 | PASS | 2 | 8.485% / 19.755% / 31.470% | PASS | FAIL |
| 16:1 | PASS | 2 | 9.435% / 20.345% / 32.240% | PASS | FAIL |
| 32:1 | PASS | 2 | 11.705% / 22.275% / 34.005% | FAIL | FAIL |
| 64:1 | PASS | 2 | 11.485% / 21.975% / 33.505% | FAIL | FAIL |
| 128:1 | PASS | 2 | 11.555% / 22.040% / 31.705% | FAIL | FAIL |
| 256:1 | PASS | 2 | 11.230% / 17.615% / 27.660% | FAIL | FAIL |

### 既定4:1の主要計測値

| 入力 | completionRatio | densityMaxExSource | densityMax | occupiedPeak | maxStagnation | backflow | completionStep | coherenceLength |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 直進 | 44 | 3868 | 4164 | 2656 | 0 | 0 | -1 | 19 |
| 分散 | 45 | 2640 | 4152 | 3841 | 0 | 0 | -1 | 4 |
| 迂回 | 23 | 2549 | 4148 | 4058 | 0 | 0 | -1 | 4 |

### 修正前後の比較

計測専用追加のため、measure=falseの状態・ハッシュ・既存指標は変更なし。

### guideMagnitudeMax

- 修正前: 65536
- 修正後: 65536

### 検証ゲート

- `npm run verify`: PASS
- measure=true / false ハッシュ一致: PASS
- 既定3入力ハッシュ: PASS
- 全edgeFluxMax掃引点の保存則テスト: PASS
- `npm run report`: FAIL（exit 1。基準1・3 PASS、基準2・4 FAIL。既定4:1）
- `git diff --check`: PASS

### 変更ファイル

- `src/simulation.js`: `sigmaProfile`と`coherenceLength`の計測専用追加
- `test/core.test.js`: 指標形式・未定義列・measure無影響の確認
- `docs/reports/data/step-04-sweep.csv`: 10比率×3入力の掃引結果
- `docs/reports/step-04.md`: 本報告
- `docs/DECISIONS.md`: 0.2.0主張の再測定結果と保留判断を更新

### 残リスク・判断を仰ぎたい点

- 直進はcoherenceLength 60まで伸びたが、分散・迂回は最大6だった
- 全入力で63に達する比率はなかった
- guide定式化をStep 5で変更するかはPRレビューで判断する
- 既定のadvectionWeight / diffusionWeightは変更していない
