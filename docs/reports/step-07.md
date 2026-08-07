# Step 7 完了報告

- Issue: #8
- engineVersion: 0.7.0
- 生データ: [`data/step-07-sweep.csv`](./data/step-07-sweep.csv)（11,623 bytes、全75ケース）
- 掃引条件: 中央ギャップ幅1/3/5/9/63 × edgeFluxMax 128/256/512/768/既定 × 3入力
- 既定のedgeFluxMax、adv:diff比、capacity、reverseThreshold、基準閾値は変更していない

## コミット1：既定値の変更

- コミット: `55de550`
- `poc-1-wide`の既定をsource幅1・sink幅5へ変更した
- Step 6 CSVの`sourceWidth=1, sinkWidth=5, adv=4:1`と3入力すべてで一致した
- `poc-0-default`のハッシュは不変だった

| scenarioId | 直進 | 分散 | 迂回 |
|---|---|---|---|
| `poc-0-default` | `4910305d` | `e63ba5b1` | `9164f600` |
| `poc-1-wide` | `f7606aa8` | `97a13950` | `13073731` |

既定値の変更理由は基準の数値ではなく、次の構造的欠陥である。

- source幅9では線が3本しかないため、注入の67%が無誘導だった
- sink幅1はビームの正常な微小移動を当たり／外れに二値化した
- sink幅3も基準2は10/10だが、後から狭められる安全側として幅5を採用した

## コミット2：障害物マスク

- シナリオは通行不可セル座標を宣言し、実行時に`Uint8Array(cellCount)`へ変換する
- 障害物セルを移送元・移送先の候補から除外し、容量も0とする
- 障害物セルの密度は常に0で、保存則は障害物ありでも成立した
- 空マスクではコミット1と全6ハッシュが一致した
- `blockedCellCount`と、x=31からx=32へ順方向に入った流量を`gapThroughput`として記録した

### guideの焼き込み規則

選択肢(a)の「障害物セルにも通常どおり焼き込む」を採用した。
障害物セルは移送元・移送先にならないため、そのセルのguideは使用されない。
焼き込みを除外して障害物の縁に新たな不連続を作る必要がなく、空マスク時の経路も変えないためである。

## `poc-2-canyon`

- source: x=4、y=32
- sink: x=59、y=30〜34
- 壁: x=32。中央ギャップとy=10〜14の迂回ギャップ以外を障害物とする
- 基準ハッシュの中央ギャップ幅: 1
- g=63は障害物0セル。迂回ギャップy=10〜14を先に区分し、残り59セルを中央ギャップとして流量を重複計上しない

### 制御点座標

`straight`:

- `(4,31)-(24,31)-(32,32)-(48,31)-(59,31)`
- `(4,32)-(32,32)-(59,32)`
- `(4,33)-(24,33)-(32,32)-(48,33)-(59,33)`

`distributed`:

- `(4,31)-(20,11)-(32,11)-(44,11)-(59,31)`
- `(4,32)-(32,32)-(59,32)`
- `(4,33)-(20,13)-(32,13)-(44,13)-(59,33)`

`detour`:

- `(4,31)-(20,11)-(32,11)-(44,11)-(59,31)`
- `(4,32)-(20,12)-(32,12)-(44,12)-(59,32)`
- `(4,33)-(20,13)-(32,13)-(44,13)-(59,33)`

### 0.7.0ハッシュ

| scenarioId | 直進 | 分散 | 迂回 | Node 20 | Node 22 |
|---|---|---|---|---|---|
| `poc-0-default` | `4910305d` | `e63ba5b1` | `9164f600` | MATCH | MATCH |
| `poc-1-wide` | `f7606aa8` | `97a13950` | `13073731` | MATCH | MATCH |
| `poc-2-canyon`（g=1） | `e3ddaebc` | `6e03aff9` | `ae3a98ad` | MATCH | MATCH |

## 掃引結果

順位は`totalCompleted`の降順。基準2は9/10以上でPASS。

| g | edgeFluxMax | totalCompleted順位 | 基準1 | 基準2 | 基準3 | 基準4 |
|---:|---:|---|---|---|---|---|
| 1 | 128 | distributed 508801 > straight 447592 > detour 118052 | PASS | 5/10 FAIL | PASS | PASS |
| 1 | 256 | distributed 963263 > straight 894107 > detour 215130 | PASS | 6/10 FAIL | PASS | PASS |
| 1 | 512 | straight 1752506 > distributed 1196701 > detour 251870 | PASS | 8/10 FAIL | PASS | FAIL |
| 1 | 768 | straight 2593734 > distributed 1256995 > detour 248973 | PASS | 6/10 FAIL | PASS | FAIL |
| 1 | 65536 | straight 3135317 > distributed 1256995 > detour 248973 | PASS | 6/10 FAIL | PASS | FAIL |
| 3 | 128 | straight 1233620 > distributed 631684 > detour 119553 | PASS | 6/10 FAIL | PASS | FAIL |
| 3 | 256 | straight 2375280 > distributed 1197388 > detour 218540 | PASS | 9/10 PASS | PASS | FAIL |
| 3 | 512 | straight 3219574 > distributed 1308213 > detour 255868 | PASS | 10/10 PASS | PASS | FAIL |
| 3 | 768 | straight 3255903 > distributed 1381751 > detour 252978 | PASS | 9/10 PASS | PASS | FAIL |
| 3 | 65536 | straight 3278985 > distributed 1381751 > detour 252978 | PASS | 9/10 PASS | PASS | FAIL |
| 5 | 128 | straight 1313762 > distributed 635389 > detour 120218 | PASS | 10/10 PASS | PASS | FAIL |
| 5 | 256 | straight 2507748 > distributed 1203722 > detour 220589 | PASS | 10/10 PASS | PASS | FAIL |
| 5 | 512 | straight 3181722 > distributed 1314656 > detour 258164 | PASS | 9/10 PASS | PASS | FAIL |
| 5 | 768 | straight 3241928 > distributed 1390181 > detour 255125 | PASS | 10/10 PASS | PASS | FAIL |
| 5 | 65536 | straight 3271259 > distributed 1390181 > detour 255125 | PASS | 10/10 PASS | PASS | FAIL |
| 9 | 128 | straight 1313132 > distributed 637153 > detour 122091 | PASS | 10/10 PASS | PASS | FAIL |
| 9 | 256 | straight 2505364 > distributed 1206061 > detour 224066 | PASS | 10/10 PASS | PASS | FAIL |
| 9 | 512 | straight 3182556 > distributed 1318395 > detour 260436 | PASS | 9/10 PASS | PASS | FAIL |
| 9 | 768 | straight 3251414 > distributed 1393987 > detour 258438 | PASS | 10/10 PASS | PASS | FAIL |
| 9 | 65536 | straight 3279322 > distributed 1393987 > detour 258438 | PASS | 10/10 PASS | PASS | FAIL |
| 63 | 128 | straight 1312935 > distributed 640163 > detour 125262 | PASS | 8/10 FAIL | FAIL | FAIL |
| 63 | 256 | straight 2504239 > distributed 1211280 > detour 229600 | PASS | 9/10 PASS | FAIL | FAIL |
| 63 | 512 | straight 3183525 > distributed 1326364 > detour 267350 | PASS | 8/10 FAIL | FAIL | FAIL |
| 63 | 768 | straight 3254692 > distributed 1401242 > detour 264381 | PASS | 10/10 PASS | FAIL | FAIL |
| 63 | 65536 | straight 3280954 > distributed 1401242 > detour 264381 | PASS | 10/10 PASS | FAIL | FAIL |

## 指定観測

- `densityMaxExSource`のピークがx=31に現れたのは、直進のg=1全5水準とg=3・128/256だった
- `maxStagnation`、`backflowEvents`、`capacityLimitedAmount`は、全gでedgeFluxMax 128/256のとき発火し、512以上では発火しなかった
- detourがstraightを`totalCompleted`で上回る構成はなかった
- distributedが最大になったのはg=1・128/256の2構成で、両方とも基準4がPASSした
- 基準1は全25構成PASS、基準2は17構成PASS、基準3は20構成PASS、基準4は2構成PASSだった
- g=1・128では、中央/迂回ギャップ流量はstraight 447855/104420、distributed 320116/518509、detour 37854/437578だった
- g=1・256では、中央/迂回ギャップ流量はstraight 895218/229295、distributed 617852/987938、detour 73268/820925だった
- 全75ケースの中央ギャップ流量は37,854〜3,657,380、迂回ギャップ流量は4,425〜1,248,971だった
- occupiedPeakは2,528〜4,081、completionRatioは5〜89、outOfFieldRatioは3〜79だった

### g=63と`poc-1-wide`既定の比較

g=63は障害物0セルだが、峡谷用の制御点を維持するため`poc-1-wide`と同一結果にはならなかった。

| 入力 | `poc-1-wide` completionRatio | canyon g=63 completionRatio | `poc-1-wide` outOfFieldRatio | canyon g=63 outOfFieldRatio |
|---|---:|---:|---:|---:|
| straight | 93 | 89 | 0 | 3 |
| distributed | 71 | 38 | 18 | 48 |
| detour | 58 | 7 | 28 | 78 |

## 検証ゲート

- コミット1とStep 6 CSVの3ハッシュ一致: PASS
- 空障害物マスクとコミット1の6ハッシュ一致: PASS
- `poc-0-default`ハッシュ不変: PASS
- 障害物あり保存則テスト: PASS
- 障害物セル密度0: PASS
- canyonのmeasure=true / falseハッシュ一致: PASS
- `npm run verify`（Node 20.20.2）: PASS
- `npx --yes node@22.22.2 scripts/check-runtime-hashes.js`: PASS
- `node scripts/step-07-sweep.js`: PASS（25構成、75行、11ワーカー）
- CSVのg × edgeFluxMax × 入力の一意な組合せ: 75
- `node --test test/sweep.test.js`: PASS（2 tests）
- `npm run report`: FAIL（`poc-0-default`既定4:1。基準1・3 PASS、基準2は3/10でFAIL、基準4 FAIL）
- `git diff --check`: PASS
- `npm run build`: スクリプト未定義

## 変更ファイル

- `src/scenarios.js`: 0.7.0、既定幅、峡谷定義、制御点
- `src/simulation.js`: 障害物マスク、ギャップ流量計測
- `test/core.test.js`: 回帰・保存則・計測テスト
- `scripts/check-runtime-hashes.js`: シナリオ障害物入力
- `runtime-hashes.json`: 0.7.0の3シナリオ × Node 20/22記録
- `scripts/step-07-sweep.js`: 75ケース掃引
- `docs/reports/data/step-07-sweep.csv`: 生データ
- `docs/DECISIONS.md`: 既定値根拠と基準4観測
- `docs/reports/step-07.md`: 本報告

## 残リスク・人間判断

- g=1・128/256では基準4がPASSした一方、基準2はFAILした
- detourがstraightを上回る構成は観測されなかった
- g=63対照は障害物を除去したが、峡谷用制御点との差が残る
- 掃引値から既定edgeFluxMaxやギャップ幅を選択していない
