# Step 5 完了報告

- Issue: #4
- engineVersion: 0.6.0
- 生データ: [`data/step-05-sweep.csv`](./data/step-05-sweep.csv)（14,586 bytes、全45ケース）
- 掃引条件: sink幅 1/3/5/9/17 × adv:diff 4:1/16:1/64:1 × 3入力。source幅は9固定
- 既定のadvectionWeight / diffusionWeight / sink幅は変更していない

## 実装A：多峰対応指標

- コミット: `d216838`（実装Bと分離）
- `bandCells`: `densityMaxExSource` の1%を超える列内セル数
- `segmentCount`: 上記セルの連続区間数
- `meanSegmentWidth`: `bandCells / segmentCount` のQ16.16値。区間0の列は未定義
- `coherenceLength`: source xから走査し、`meanSegmentWidth > 2.0`となる最初のx
- 旧σ定義は`coherenceLengthSigma`として維持
- engineVersionは0.5.0のまま、直進`4910305d`・分散`e63ba5b1`・迂回`9164f600`で不変を確認した

## 実装B：source / sink 多セル化

- source / sink APIを座標配列へ変更し、配列順を実行時に変更しない
- 1要素配列では0.5.0と同一ハッシュ。`test/core.test.js`へ恒久テストを追加した
- `runtime-hashes.json`をengineVersion × scenarioIdで保持する構造へ変更した
- `scripts/check-runtime-hashes.js`は`poc-0-default`と`poc-1-wide`の両方を照合する

### ハッシュ

| scenarioId | 直進 | 分散 | 迂回 | Node 20 | Node 22 |
|---|---|---|---|---|---|
| `poc-0-default` | `4910305d` | `e63ba5b1` | `9164f600` | MATCH | MATCH |
| `poc-1-wide`（記録用sink幅1） | `deca574a` | `ab9b7ec2` | `ca52f07e` | MATCH | MATCH |

## シナリオ定義

### source / sink

- source: x=4、y=28〜36の9セル（昇順）
- 除外範囲: 全sourceセルと各マンハッタン距離1近傍の和集合、合計29セル
- 注入量: `base=113`、`remainder=7`
- y=28〜34の7セルへ114/step、y=35〜36の2セルへ113/step。合計1,024/step
- sink中心: x=59、y=32
- sink幅1/3/5/9/17のy範囲: 32 / 31〜33 / 30〜34 / 28〜36 / 24〜40

### 制御点座標

- 直進: `(4,31)-(32,31)-(59,32)`、`(4,32)-(32,32)-(59,32)`、`(4,33)-(32,33)-(59,32)`
- 分散: `(4,32)-(20,17)-(44,17)-(59,32)`、`(4,32)-(32,32)-(59,32)`、`(4,32)-(20,47)-(44,47)-(59,32)`
- 迂回: `(4,32)-(16,23)-(43,23)-(59,32)`、`(4,33)-(18,39)-(42,39)-(59,32)`、`(4,31)-(24,27)-(48,28)-(59,32)`

## 掃引結果

基準2は9/10以上がPASS。基準3中央値は既存形式の`medianTwiceBasisPoints`を1%/3%/10%の順で記載する。

| sink幅 | adv:diff | 基準2 | 基準3中央値 | 基準3 | 基準4 | totalCompleted順序 |
|---:|---:|---:|---:|---|---|---|
| 1 | 4:1 | 3/10 FAIL | 1656/1667/2775 | FAIL | FAIL | 直進 > 分散 > 迂回 |
| 1 | 16:1 | 3/10 FAIL | 1571/1422/2280 | FAIL | FAIL | 直進 > 分散 > 迂回 |
| 1 | 64:1 | 6/10 FAIL | 962/903/2214 | FAIL | FAIL | 分散 > 迂回 > 直進 |
| 3 | 4:1 | 0/10 FAIL | 2516/1321/1158 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 3 | 16:1 | 0/10 FAIL | 2282/1154/1358 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 3 | 64:1 | 1/10 FAIL | 1526/396/636 | FAIL | FAIL | 直進 > 分散 > 迂回 |
| 5 | 4:1 | 0/10 FAIL | 2589/1596/2090 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 5 | 16:1 | 0/10 FAIL | 2405/1574/2112 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 5 | 64:1 | 1/10 FAIL | 1479/591/1081 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 9 | 4:1 | 0/10 FAIL | 2537/1726/2241 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 9 | 16:1 | 0/10 FAIL | 2514/1920/2526 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 9 | 64:1 | 1/10 FAIL | 1602/737/1047 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 17 | 4:1 | 0/10 FAIL | 2379/1722/2092 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 17 | 16:1 | 0/10 FAIL | 2372/1933/2310 | FAIL | FAIL | 直進 > 迂回 > 分散 |
| 17 | 64:1 | 1/10 FAIL | 1649/848/1255 | FAIL | FAIL | 直進 > 迂回 > 分散 |

## 指定観測

- sink幅を広げても基準2のpass件数は増えなかった。幅1では3/3/6件、幅3以上では0〜1件だった
- 基準3は全15構成でFAIL。sink幅拡大時にも維持されなかった
- 新`coherenceLength`は全45ケースで4。分散・迂回を直進と同じ値で返したが、構成間の差は表現しなかった
- `coherenceLengthSigma`も全45ケースで4で、新旧定義の差が大きい構成はなかった
- 基準4は全15構成でFAILし、様相は変わらなかった
- totalCompleted順序は入れ替わった。幅1・64:1では分散 > 迂回 > 直進、幅3・64:1では直進 > 分散 > 迂回、幅3以上の他11構成では直進 > 迂回 > 分散だった
- occupiedPeakは1,071〜4,077、completionRatioは11〜63、outOfFieldRatioは28〜78だった

## Step 4レビュー結論の転記

- Step 4の「分散・迂回は全比率でビームを形成しない」は撤回。σは複数ビームを評価できない
- 基準2は9/10以上がPASSであり、Step 4の1:1は9/10でPASS
- 1:1は基準1・2・3がPASS、基準4のみFAILだが、occupiedPeak 4,037〜4,090で視覚的に価値のある流れがない
- 「高誘導域の基準2失敗は幅1sinkによる」という説明は推定として保留欄に記録した。Step 5実測はpass件数増加を支持しなかった

## 検証ゲート

- `npm run verify`（Node 20.20.2）: PASS
- `npx --yes node@22.22.2 scripts/check-runtime-hashes.js`: PASS
- `node --test test/core.test.js test/sweep.test.js`: PASS
- measure=true / falseハッシュ一致: PASS
- 1要素配列の0.5.0ハッシュ一致: PASS
- `node scripts/step-05-sweep.js`: PASS（15構成、45行、11ワーカー）
- `npm run report`: FAIL（基準1・3 PASS、基準2は3/10でFAIL、基準4 FAIL。`poc-0-default`既定4:1）
- `npm run build`: スクリプト未定義のため未実行
- `git diff --check`: PASS

## 変更ファイル

- `src/simulation.js`: 多セル注入・全sink回収・source除外和集合・多峰指標
- `src/scenarios.js`: 0.6.0、配列API、`poc-1-wide`
- `runtime-hashes.json`: engineVersion × scenarioId構造と0.6.0記録
- `scripts/check-runtime-hashes.js`: 2シナリオ照合
- `scripts/step-05-sweep.js`: Step 5固定掃引
- `test/core.test.js`: 後方互換・注入配分・計測テスト
- `debug/viewer.js`: 配列化したsource / sinkマーカー対応
- `docs/LOOP.md`: 注入配分規則
- `docs/DECISIONS.md`: Step 4レビュー結論とStep 5実測
- `docs/reports/data/step-05-sweep.csv`: 45ケース生データ
- `docs/reports/step-05.md`: 本報告

## 残リスク・人間判断

- sink幅拡大で基準2が改善する想定は実測と一致しなかった
- 新旧coherenceLengthが全ケース4となり、入力・構成間の識別力を示さなかった
- 基準2失敗要因の仮説を棄却するか、guide定式化へ戻るかは本PRで判断する
- 掃引値から既定sink幅やadv:diff比を選択していない
