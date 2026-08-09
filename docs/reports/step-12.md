# Step 12 実装・検証報告

## 実装機能

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 シナリオとレイアウト | 実装 | 3シナリオ、峡谷の `gapWidth` 5種、各シナリオ固有の source / sink / blocked / gaps |
| 2-2 パラメータ入力 | 実装 | 指定された8設定、steps、seed。`createConfig` の例外メッセージを画面表示 |
| 2-3 線の描画 | 実装 | 3〜5本・各2点以上の制約、追加・削除・選択・点追加・末尾取消・ドラッグ・全消去・3プリセット |
| 2-4 実行と再生 | 実装 | 明示実行の最終状態、固定19段階の再生、進捗、スライダー、入力単位キャッシュ、共通色スケール |
| 2-5 オーバーレイ | 実装 | 障害物、線、`buildRestoreField` による回廊の縁、場の縁の個別切替 |
| 2-6 計測パネル | 実装 | Issue指定の計測値。`gapThroughput` は峡谷以外で `—` |
| 2-7 保存・読込・URL | 実装 | `formatVersion` / `engineVersion` を含む独自JSON、JSON入出力、URLハッシュ、版違い警告付き読込 |

## 変更範囲

`src/` / `scripts/` / `test/` / `runtime-hashes.json` の変更は0行。

```text
 debug/index.html        | 136 +++++++---
 debug/viewer.js         | 660 ++++++++++++++++++++++++++++++++++++++----------
 docs/DECISIONS.md       |  14 +
 docs/LOOP.md            |  14 +-
 docs/issues/step-12.md  | 305 ++++++++++++++++++++++
 docs/reports/step-12.md |  72 ++++++
 6 files changed, 1034 insertions(+), 167 deletions(-)
```

## push確認

```text
543edfe0b818cf6b6831704df635d3a1320b21d9 refs/heads/step/12
```

## ブラウザ実測

| 項目 | 値 |
|---|---|
| ブラウザ | Google Chrome 149.0.7827.200（headless） |
| シナリオ / 入力 | `poc-0-default` / `distributed` |
| corridorWidth | 8 |
| steps | 3,600 |
| 最終状態モード | 2.944秒 |
| 再生モード（19フレーム） | 16.16秒 |
| 再生計算量 | 固定階段の合計21,900 step |

時間は同一マシン上の1回の実測値。予想25〜40秒より短かったため、階段や既定値は変更していない。

## 検証結果

```text
npm run verify
```

PASS。禁止API検査、Node v20.20.2での0.11.0ランタイムハッシュ9件、
`test/core.test.js` 23件がすべて成功した。

```text
node scripts/check-runtime-hashes.js
```

PASS。3シナリオ × 3入力の9件がすべて記録済みハッシュと一致した。

Chromeでは、初期 `distributed` 3本、URLハッシュ生成、最終状態、19フレーム生成、
全消去時の実行無効化と制約理由表示を確認した。

## 既知の制限

- 再生フレームはシミュレーションの途中状態APIがないため、各stepまで個別に再実行する。
- 線やパラメータの編集では自動再実行せず、明示実行が必要。
- 実測は Google Chrome 149 のheadlessモードのみ。他ブラウザの所要時間は未測定。
- Canvas 2Dの診断ビューアであり、製品の描画スタックではない。
