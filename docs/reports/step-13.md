# Step 13 実装・検証報告

## 実装機能

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 Q16.16保持 | 実装 | 内部線・formatVersion 2 JSONをQ16.16整数へ統一。描画時のみセル座標へ換算。formatVersion 1は読込時にQを乗算 |
| 2-2 連続描画 | 実装 | 「点を置く」「なぞる」を切替。なぞりはpointerupで選択線を確定。既存の点移動・末尾取消を維持 |
| 2-3 制御点の間引き | 実装 | なぞり入力だけに距離間引き0 / 0.25 / 0.5 / 1.0セルを適用。既定表示は0.25セル。線別・合計点数を表示 |
| 2-4 URL / JSON | 実装 | URLハッシュ候補が8,000文字を超える場合は反映せず共有ボタンを無効化し、JSON保存を案内。JSONは無制限 |
| 2-5 steps上限 | 実装 | `max="20000"` と実行前の範囲検査を追加 |

Q16.16の範囲条件は `src/lines.js` の `assertPoint` と同じく、各座標が整数かつ
`0 <= x < width * Q`、`0 <= y < height * Q` である。

## 変更範囲

次の確認コマンドの出力は空だった。

```text
git diff --stat origin/main..step/13 -- src scripts test runtime-hashes.json
```

`src/` / `scripts/` / `test/` / `runtime-hashes.json` は変更していない。

## プリセットのブラウザ照合

Google Chrome 149 headless、既定パラメータで確認した。

| scenario | preset | 記録値 | ブラウザ実測 | 結果 |
|---|---|---|---|---|
| poc-0-default | straight | `4910305d` | `4910305d` | MATCH |
| poc-0-default | distributed | `e63ba5b1` | `e63ba5b1` | MATCH |
| poc-0-default | detour | `9164f600` | `9164f600` | MATCH |
| poc-1-wide | straight | `f7606aa8` | `f7606aa8` | MATCH |
| poc-1-wide | distributed | `97a13950` | `97a13950` | MATCH |
| poc-1-wide | detour | `13073731` | `13073731` | MATCH |
| poc-2-canyon | straight | `e3ddaebc` | `e3ddaebc` | MATCH |
| poc-2-canyon | distributed | `6e03aff9` | `6e03aff9` | MATCH |
| poc-2-canyon | detour | `ae3a98ad` | `ae3a98ad` | MATCH |

## 間引き閾値の単発比較

同一の320点ストロークを選択線へ入力し、残り2本は`distributed`プリセットのままとした。
条件は `poc-2-canyon` / `gapWidth=1` / `corridorWidth=2` /
`restoreWeight=0` / `corridorBlocksOutOfField=true` / `steps=3600`。
使用盤面は `docs/reports/data/step-13-stroke.json` に保存した。

| 閾値（セル） | 制御点数（3本合計） | JSON文字数 | URLハッシュ文字数 | 実行時間 | stateHash | completionRatio | outOfFieldRatio | remainingRatio | gap central | gap detour |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| 0 | 328 | 16,791 | 8,960 | 2.3136秒 | `a2047119` | 81% | 0% | 18% | 1,716,106 | 1,792,479 |
| 0.25 | 168 | 8,819 | 4,828 | 2.2945秒 | `3fe1ac24` | 81% | 0% | 18% | 1,720,400 | 1,793,698 |
| 0.5 | 113 | 6,078 | 3,407 | 2.3114秒 | `ba0843e3` | 81% | 0% | 18% | 1,725,638 | 1,781,274 |
| 1.0 | 63 | 3,587 | 2,116 | 2.2305秒 | `12eed27e` | 81% | 0% | 18% | 1,722,235 | 1,784,738 |

閾値0ではURLハッシュ候補が8,000文字を超えたため、実際のURLハッシュは空にされ、
共有ボタンが無効化され、JSON保存の警告が表示された。表は反映前の候補文字数を記録した。

## 検証結果

- `formatVersion: 1` のURL状態を読み込み、formatVersion 2の同一Q16.16線へ変換されることをChromeで確認
- `steps=20001` で実行ボタンが無効になり、範囲エラーが表示されることをChromeで確認
- `npm run verify`: PASS（禁止API、0.11.0ランタイムハッシュ9件、core test 23件）
- `node scripts/check-runtime-hashes.js`: PASS（9/9 MATCH）

## ブラウザとバージョン

- Google Chrome 149.0.7827.200（headless）
- Node v20.20.2

## 既知の制限

- `burnLines` は各セグメントの両端をサンプリングするため、同じ形でも制御点数が違えば接合部の重複数が変わり、`stateHash` が変わる。間引き閾値の変更も結果を変える。
- 線の本数は `src/lines.js` の制約により3〜5本である。
- source / sinkは固定で、`poc-0-default` / `poc-2-canyon` は `(4,32)` / `(59,32)` である。
- 線やパラメータの編集では自動再実行せず、明示実行が必要である。
- Canvas 2Dの診断ビューアであり、製品の描画スタックではない。
