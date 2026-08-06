# Step 6 完了報告

- Issue: #6
- engineVersion: 0.6.0（既定source幅・sink幅と状態遷移は変更なし）
- 生データ: [`data/step-06-sweep.csv`](./data/step-06-sweep.csv)（28,633 bytes、全90ケース）
- 掃引条件: source幅 1/3/9 × sink幅 1/3/5/9/17 × adv:diff 4:1/16:1 × 3入力
- 既定のadvectionWeight / diffusionWeight / source幅 / sink幅は変更していない

## 実装A：coherenceLength の走査開始位置修正

- コミット: `1d6944d`（実装Bと分離）
- 全sourceセルの最大xを`sourceX`とし、`sourceX + 2`から走査する
- `w0 = meanSegmentWidth[sourceX + 2]`をQ16.16で記録する
- `coherenceLength`は`meanSegmentWidth > w0 * 2`となる最初のx。一度も超えなければ63
- `w0`が未定義なら`w0`と`coherenceLength`を未定義のまま記録する
- 未定義列はスキップする
- `coherenceLengthSigma`も走査開始位置を`sourceX + 2`へ変更し、旧閾値は維持する
- 実装Aのみの時点で、両シナリオの全6ハッシュが既存記録と一致した

### 実装A時点のハッシュ

| scenarioId | 直進 | 分散 | 迂回 |
|---|---|---|---|
| `poc-0-default` | `4910305d` | `e63ba5b1` | `9164f600` |
| `poc-1-wide` | `deca574a` | `ab9b7ec2` | `ca52f07e` |

## 実装B：source幅の可変化

- コミット: `8764188`
- source中心をy=32に固定し、幅1はy=32、幅3はy=31〜33、幅9はy=28〜36とした
- 配列順と`base` / `remainder`の注入配分規則は変更していない
- `poc-1-wide`の既定source幅9・sink幅1は変更していない
- source幅1・sink幅1・4:1は`poc-0-default`と3入力すべて同一ハッシュ
- 既定値と状態ハッシュが不変のため、engineVersionと`runtime-hashes.json`は変更していない

## 掃引結果

基準2は9/10以上がPASS。基準3中央値は既存形式の`medianTwiceBasisPoints`を1%/3%/10%の順で記載する。

| source幅 | sink幅 | adv:diff | 基準2 | 基準3中央値 | 基準3 | 基準4 |
|---:|---:|---:|---:|---:|---|---|
| 1 | 1 | 4:1 | 3/10 FAIL | 1329/3625/5777 | PASS | FAIL |
| 1 | 1 | 16:1 | 2/10 FAIL | 1887/4069/6448 | PASS | FAIL |
| 1 | 3 | 4:1 | 10/10 PASS | 320/1948/3647 | PASS | FAIL |
| 1 | 3 | 16:1 | 10/10 PASS | 377/1265/3138 | PASS | FAIL |
| 1 | 5 | 4:1 | 10/10 PASS | 342/1524/2743 | PASS | FAIL |
| 1 | 5 | 16:1 | 10/10 PASS | 362/915/2177 | PASS | FAIL |
| 1 | 9 | 4:1 | 10/10 PASS | 475/1049/1994 | PASS | FAIL |
| 1 | 9 | 16:1 | 10/10 PASS | 341/597/1480 | PASS | FAIL |
| 1 | 17 | 4:1 | 10/10 PASS | 385/691/1360 | PASS | FAIL |
| 1 | 17 | 16:1 | 10/10 PASS | 357/764/1253 | PASS | FAIL |
| 3 | 1 | 4:1 | 9/10 PASS | 551/2118/3070 | PASS | FAIL |
| 3 | 1 | 16:1 | 9/10 PASS | 589/1998/2994 | PASS | FAIL |
| 3 | 3 | 4:1 | 9/10 PASS | 696/931/2189 | PASS | FAIL |
| 3 | 3 | 16:1 | 9/10 PASS | 751/815/2109 | FAIL | FAIL |
| 3 | 5 | 4:1 | 7/10 FAIL | 866/665/1143 | FAIL | FAIL |
| 3 | 5 | 16:1 | 7/10 FAIL | 910/514/927 | FAIL | FAIL |
| 3 | 9 | 4:1 | 5/10 FAIL | 966/622/722 | FAIL | FAIL |
| 3 | 9 | 16:1 | 4/10 FAIL | 1052/488/763 | FAIL | FAIL |
| 3 | 17 | 4:1 | 5/10 FAIL | 974/471/730 | FAIL | FAIL |
| 3 | 17 | 16:1 | 4/10 FAIL | 1097/439/638 | FAIL | FAIL |
| 9 | 1 | 4:1 | 3/10 FAIL | 1656/1667/2775 | FAIL | FAIL |
| 9 | 1 | 16:1 | 3/10 FAIL | 1571/1422/2280 | FAIL | FAIL |
| 9 | 3 | 4:1 | 0/10 FAIL | 2516/1321/1158 | FAIL | FAIL |
| 9 | 3 | 16:1 | 0/10 FAIL | 2282/1154/1358 | FAIL | FAIL |
| 9 | 5 | 4:1 | 0/10 FAIL | 2589/1596/2090 | FAIL | FAIL |
| 9 | 5 | 16:1 | 0/10 FAIL | 2405/1574/2112 | FAIL | FAIL |
| 9 | 9 | 4:1 | 0/10 FAIL | 2537/1726/2241 | FAIL | FAIL |
| 9 | 9 | 16:1 | 0/10 FAIL | 2514/1920/2526 | FAIL | FAIL |
| 9 | 17 | 4:1 | 0/10 FAIL | 2379/1722/2092 | FAIL | FAIL |
| 9 | 17 | 16:1 | 0/10 FAIL | 2372/1933/2310 | FAIL | FAIL |

## 指定観測

- source幅1では、sink幅1の基準2 pass件数が4:1で3/10、16:1で2/10だった。sink幅3/5/9/17では両比率とも10/10へ増えた
- source幅3では、sink幅1/3の基準2が両比率とも9/10。sink幅5で7/10、幅9/17で4〜5/10だった。基準3はsink幅1の両比率とsink幅3・4:1がPASS、それ以外はFAILだった
- source幅9では、sink幅1の基準2が3/10、sink幅3以上は0/10。基準3は全10構成でFAILだった
- source幅1・sink幅1・4:1の状態ハッシュは、直進`4910305d`、分散`e63ba5b1`、迂回`9164f600`で`poc-0-default`と一致した
- 修正後の`coherenceLength`は90ケースで7/11/21/24/32/47/55/63を記録し、構成間で異なる値を返した。4を返したケースはなかった
- source幅別の`coherenceLength`は、幅1で7/11/21/32/55/63、幅3で7/24/47/55/63、幅9で全ケース63だった
- `w0`の範囲は、source幅1で65,536〜2,031,616（1〜31セル）、幅3で196,608〜4,194,304（3〜64セル）、幅9で3,932,160〜4,194,304（60〜64セル）だった
- `coherenceLengthSigma`は6/19/45/48/52/59/63を記録した
- 基準4は全30構成でFAILし、Step 5から様相は変わらなかった
- occupiedPeakは165〜4,077、completionRatioは11〜93、outOfFieldRatioは0〜78だった

## 検証ゲート

- `node scripts/check-runtime-hashes.js`（Node 20.20.2）: PASS
- source幅1・sink幅1の`poc-0-default`ハッシュ一致: PASS
- 実装Aのmeasure=true / falseハッシュ一致: PASS
- `node scripts/step-06-sweep.js`: PASS（30構成、90行、11ワーカー）
- CSVのsource幅 × sink幅 × 比率 × 入力の一意な組合せ: 90
- `npm run verify`（Node 20.20.2）: PASS（15 tests）
- `npx --yes node@22.22.2 scripts/check-runtime-hashes.js`: PASS（両シナリオの全6ハッシュ一致）
- `node --test test/sweep.test.js`: PASS（2 tests）
- `npm run report`: FAIL（基準1・3 PASS、基準2は3/10でFAIL、基準4 FAIL。`poc-0-default`既定4:1）
- `git diff --check`: PASS
- `npm run build`: スクリプト未定義

## 変更ファイル

- `src/simulation.js`: 走査開始位置、`w0`、未定義処理
- `src/scenarios.js`: source幅生成
- `test/core.test.js`: 計測値と後方互換の恒久テスト
- `scripts/step-06-sweep.js`: 90ケース掃引
- `docs/reports/data/step-06-sweep.csv`: 生データ
- `docs/DECISIONS.md`: Step 5測定の無効化と保留判断
- `docs/reports/step-06.md`: 本報告

## 残リスク・人間判断

- guideの定式化とsource幅の関係は本Stepでは変更していない
- 掃引値から既定source幅・sink幅・adv:diff比を選択していない
- 基準閾値と基準4の指標セットは変更していない
