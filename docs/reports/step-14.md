# Step 14 完了報告

## 実装結果

| 項目 | 結果 |
|---|---|
| 障害物のクリック切替、連続塗り／消去、矩形塗り／消去、全消去、セル数表示 | 実装 |
| 複数セルのsource / sink指定と解除、昇順保存 | 実装 |
| 最大4群の名前付きgap編集、障害物・群間重複のUI拒否 | 実装 |
| source / sinkの空配列、範囲外、重複、障害物との重なりの実行前検証 | 実装 |
| 既存3シナリオのプリセット維持、盤面編集時の`scenarioId = custom`化 | 実装 |
| formatVersion 3保存、formatVersion 1 / 2読込、8,000文字URL制限 | 実装 |
| 障害物、source、sink、gapの色分けとgap名表示、既存overlay維持 | 実装 |

engineVersionは`0.11.0`のまま変更していない。掃引は実施していない。

## 保護対象の差分

```text
$ git diff --stat origin/main..step/14 -- src scripts test runtime-hashes.json
（出力なし）
```

## 後方互換

Headless Chrome 149.0.0.0で未編集プリセットを実行し、9件すべてが
`runtime-hashes.json`の0.11.0記録と一致した。

| scenario | straight | distributed | detour |
|---|---|---|---|
| poc-0-default | `4910305d` | `e63ba5b1` | `9164f600` |
| poc-1-wide | `f7606aa8` | `97a13950` | `13073731` |
| poc-2-canyon (gapWidth=1) | `e3ddaebc` | `6e03aff9` | `ae3a98ad` |

formatVersion 1と2はそれぞれ読み込み後にformatVersion 3として保存でき、
`poc-0-default`のsource 1セル、sink 1セル、blocked 0セルとQ16.16の線を復元した。

## 盤面別の実行結果

既定パラメータ、seed `324508639`、3,600 stepで各1回実行した。実行時間はビューアが
`performance.now()`で表示したシミュレーション呼び出し時間である。

| 盤面 | completionRatio | remainingRatio | outOfFieldRatio | completionStep | gapThroughput | occupiedCellsPeak | densityMaxExSource | blockedFrontDensityMax | stateHash | 実行時間 |
|---|---:|---:|---:|---:|---|---:|---|---|---|---:|
| pillars | 45% | 11% | 42% | -1 | — | 4,023 | 3,304 @ [6, 32] | 2,413 @ [29, 32] | `5938d923` | 4,016.5 ms |
| vessel | 74% | 25% | 0% | 2,849 | — | 3,843 | 3,448 @ [6, 32] | 1,887 @ [62, 31] | `de8e9088` | 3,830.8 ms |
| multisink | 27% | 15% | 57% | -1 | upper: 2,058,670 / lower: 919,916 | 4,006 | 3,344 @ [6, 32] | 1,008 @ [31, 26] | `e1fde8fc` | 3,940.5 ms |

## 保存サイズ

| 盤面 | 整形済み保存JSON | URLハッシュ候補 | 共有ボタン |
|---|---:|---:|---|
| pillars | 1,382文字 | 1,016文字 | 有効 |
| vessel | 9,026文字 | 4,756文字 | 有効 |
| multisink | 3,628文字 | 2,099文字 | 有効 |

器盤面の整形済みJSONは8,000文字を超えたが、URLは空白・改行なしのJSONを使うため
4,756文字となり、8,000文字制限には達しなかった。
別途2,047セルの盤面で33,001文字の候補を作り、URLハッシュを空に保ち、共有ボタンを
無効化してJSON保存の警告を表示することを確認した。

## 確認環境とコマンド

- Browser: HeadlessChrome 149.0.0.0 / Linux x86_64
- Node: v20.20.2

```text
npm run verify
node scripts/check-runtime-hashes.js
node /tmp/step14-browser-check.mjs
git diff --check
git diff --stat origin/main..step/14 -- src scripts test runtime-hashes.json
```

`npm run verify`はPASS（禁止API、9ハッシュ、core test 1件）。ブラウザでは障害物の
切替・連続塗り・消去・矩形塗りを操作し、7セル・`custom`・実行可能状態を確認した。
gapセルへの障害物指定は理由を表示して拒否し、sourceを0セルにすると実行ボタンが無効、
sourceを再指定すると実行可能へ戻ることも確認した。

## 既知の制限

- `custom`盤面は`runtime-hashes.json`のハッシュ回帰対象外である。
- URLハッシュ候補が8,000文字を超える盤面はURLへ反映せず、JSON保存のみ利用できる。
- 矩形操作中の範囲プレビューは表示せず、ポインタを離した時点で反映する。
- gapThroughputはgap未定義時に`—`を表示する。

最終push後の`git ls-remote --heads origin step/14`の出力は、自己参照になるため本コミットには
固定せず、PR本文と完了報告に記録する。
