# Step 17 完了報告

## 実装項目

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 | 実装 | 省略可能な`sinkGroups`を追加し、最大4群、名前、sink包含、全分割、重複なしを検証 |
| 2-2 | 実装 | measure専用の`sinkThroughput`と`sinkFirstArrivalStep`を追加。未指定時は`null` |
| 2-3 | 実装 | timeline標本に群別の累積`sinkThroughput`を追加。未指定時は標本に含めない |
| 2-4 | 実装 | sweepは群を渡さず、2計測値を`flattenMeasurements`の除外対象に追加 |
| 2-5 | 実装 | 群編集・先行検証・色分け・計測表示・timeline表/CSV・formatVersion 4保存と1/2/3読込を追加 |

engineVersionは`0.11.0`のまま、モデル、既定値、受け入れ基準、閾値、sink除去規則は変更していない。パラメータ掃引は実施していない。

## 後方互換と不変条件

`sinkGroups`未指定、`measure=true`で確認した。

| シナリオ | straight | distributed | detour |
|---|---|---|---|
| poc-0-default | `4910305d` 一致 | `e63ba5b1` 一致 | `9164f600` 一致 |
| poc-1-wide | `f7606aa8` 一致 | `97a13950` 一致 | `13073731` 一致 |
| poc-2-canyon | `e3ddaebc` 一致 | `6e03aff9` 一致 | `ae3a98ad` 一致 |

9/9件が0.11.0の記録値と一致した。既存のmeasure無影響テストでも`measure=true`と`false`のハッシュが一致した。

`poc-1-wide` / straightの5 sinkセルを3+2に分割した恒久テストでは、ハッシュは`f7606aa8`のままだった。

| totalCompleted | upper | lower | 群合計 | 一致 |
|---:|---:|---:|---:|---|
| 3,458,064 | 2,703,238 | 754,826 | 3,458,064 | 一致 |

## multisink盤面の2件

`docs/reports/data/step-17-board-multisink-groups.json`はStep 14盤面の線と障害物を保持し、upper=`[[59,20]]`、lower=`[[59,44]]`を追加した。時系列は`docs/reports/data/step-17-timeline-multisink.csv`に記録した。

| case | sinkThroughput upper / lower | sinkFirstArrivalStep upper / lower | completionRatio | remainingRatio | outOfFieldRatio | stateHash |
|---|---:|---:|---:|---:|---:|---|
| default | 807,670 / 192,694 | 226 / 279 | 27% | 15% | 57% | `e1fde8fc` |
| corridor2 | 1,710,469 / 762,520 | 229 / 266 | 67% | 32% | 0% | `798d58e4` |

両件で`Σ sinkThroughput === totalCompleted`が成立した。既定条件では2群の到達量に偏りがあり、Issue第9節の想定は外れた。群や定数は変更していない。

## Step 15・16からの持ち越し

### sampleInterval実行時間

Node v20.20.2、Step 15第4節の同一条件、`steps=3600`、各3回の中央値。

| sampleInterval | 中央値 | 0比 |
|---:|---:|---:|
| 0 | 1,959.5 ms | — |
| 100 | 1,899.0 ms | -3.1% |
| 1 | 2,198.5 ms | +12.2% |

### occupiedCellsの頭打ち

既存の`docs/reports/data/step-15-timeline.csv`では、`occupiedCells`はstep 1,000以降449〜450で頭打ちになる。一方、`remaining`はstep 3,600で1,956,200まで増加する。面積は増えず、密度だけが上がっている。

### Step 16の想定との差

Step 16 Issue第7節の「`corridorWidth`が大きい構成では距離0が最大にならない可能性がある」は外れた。4条件すべてで距離0のセルあたり平均密度が最大で、順に616 / 628 / 647 / 605だった。定数や距離区分は変更していない。

## 掃引CSV列構成

Step 16基準コミット`aae40b8`と現在実装で、`corridorWidth=128` / mode A / workers 1の同一最小掃引を実行した。`results.csv`同士の`diff -u`は終了コード0、出力なしで、列名を含む全内容に差分がなかった。`sinkThroughput`と`sinkFirstArrivalStep`がCSV列に現れない恒久テストもPASSした。

## ブラウザと保存互換

- Google Chrome 149.0.7827.200 / Linux x86_64
- formatVersion 1 / 2 / 3 / 4をURLから読込: 全件「実行可能」、1〜3はsink group未定義、4は2群
- 群名を重複させたとき、実行ボタン無効化と理由表示を確認。修正後は再び実行可能
- formatVersion 4盤面を`sampleInterval=100`で実行し、群別計測、36行のtimeline、群別列を確認
- 保存JSONはformatVersion 4と`sinkGroups`を保持
- ダウンロードtimeline CSVは`sinkThroughput.upper` / `sinkThroughput.lower`列を保持
- Node / Chromeの既存ハッシュは`4910305d`で一致。Firefoxは環境に未導入

## CI実行時間

初回push後のGitHub ActionsでNode 20 / 22を計測し、最終報告へ反映する。

## 検証コマンド

- `npm run verify`: PASS（禁止API、既存9ハッシュ、coreテスト26件）
- `node --test test/sweep.test.js`: PASS（3件）
- Step 16基準と現在の掃引`results.csv`の`diff -u`: PASS（差分なし）
- Chrome 149によるformatVersion 1 / 2 / 3 / 4読込、UI検証、実行、CSV/JSON保存: PASS
- `npm run test:browsers`: Node / Chrome一致。Firefox未導入のため終了コード1
- `git diff --check`: PASS
- `npm run build`: package.jsonにbuild scriptがないため未実行

## 既知の制限

- `sinkGroups`は指定時にsink全体の分割が必須で、部分集合だけの計測はできない。
- `sinkFirstArrivalStep`は最初の正の到達だけを記録し、量のしきい値や順番判定を持たない。
- timelineのsink値は累積値だけで、区間量・比・順位はエンジンで計算しない。
- ビューアは診断用の表とCanvas描画で、グラフ、成功判定、スコア、演出は持たない。
- Firefoxはローカル環境に未導入。
