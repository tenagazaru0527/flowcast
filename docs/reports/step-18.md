# Step 18 完了報告

## 実装項目

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 | 実装 | `game/challenge.json`にmultisink盤面、2群、目標、制約、固定設定を定義 |
| 2-2 | 実装 | 場外損失・到達率の制約を先に判定し、通過時だけupper比率を判定 |
| 2-3 | 実装 | クリア時だけ速さ・量・集中・手数の生値を表示。合算、順位、評価は未実装 |
| 2-4 | 実装 | Canvas 2Dで盤面・線・最終密度を描画し、3〜5本のなぞり入力、実行、判定、やり直しを実装 |
| 2-5 | 実装 | 失敗段階と条件ごとの実測値を表示。助言文は未実装 |
| 2-6 | 実装 | formatVersion 4の線・盤面・結果・密度・`stateHash`をJSON保存・読込 |

外部ライブラリ、ビルド手順、再生、演出、順位付けは追加していない。engineVersionは`0.11.0`のままである。

## 検証結果

### 保護対象の差分

実装差分をコミット後、次を実行した。

```text
$ git diff --stat origin/main..step/18 -- src scripts test runtime-hashes.json debug
（出力なし）
```

### 既存検証

- `npm run verify`: PASS
  - 禁止API: PASS
  - 既存シナリオ9件のstateHash: 9/9一致
  - `test/core.test.js`: PASS（1件、348,910 ms）
- `npm run build`: `package.json`にbuild scriptがないため未実行
- `node --check game/game.js`: PASS
- `git diff --check`: PASS

### 決定論

Step 14の元の線を同じ課題設定で2回実行した。

| 実行 | stateHash |
|---:|---|
| 1 | `798d58e4` |
| 2 | `798d58e4` |

一致した。

### 盤面一致

次の比較は終了コード0、出力なしだった。

```text
diff -u \
  <(jq -S '{blocked,source,sink,gaps}' docs/reports/data/step-14-board-multisink.json) \
  <(jq -S '{blocked,source,sink,gaps}' game/challenge.json)
```

`blocked` / `source` / `sink` / `gaps`は一致した。

## Step 14の元の線

| 場外損失 | 到達率 | upper | lower | upper比率 | 判定 | stateHash |
|---:|---:|---:|---:|---:|---|---|
| 0% | 67% | 1,710,469 | 762,520 | 69.166% | 失敗（目標） | `798d58e4` |

制約は満たし、upper比率55〜65%を外れた。

## 変更線の試行

変更線を3回試した。クリアできなかったため、`docs/reports/data/step-18-solution.json`は作成していない。目標値と制約値は変更していない。

| 試行 | 変更 | 場外損失 | 到達率 | upper | lower | upper比率 | 判定 | stateHash |
|---:|---|---:|---:|---:|---:|---:|---|---|
| 1 | 中央線を上側ギャップ通過後にlowerへ接続 | 0% | 68% | 1,022,259 | 1,508,427 | 40.395% | 失敗（目標） | `22eb6034` |
| 2 | 中央線を両シンクの中間`[59,32]`へ接続 | 0% | 48% | 1,033,682 | 769,026 | 57.341% | 失敗（制約） | `1a7aff07` |
| 3 | 元の3本にlowerへ向かう4本目を追加 | 0% | 65% | 978,638 | 1,450,661 | 40.285% | 失敗（目標） | `37e920f4` |

クリアできなかったため、クリア解の4軸の実測値はない。

## ブラウザ確認

- Google Chrome 149.0.7827.200 / Linux x86_64
- `python3 -m http.server 8000`から`http://localhost:8000/game/`を表示: PASS
- 元の線を実行し、失敗、3条件の数値、`stateHash=798d58e4`、スコア軸非表示を確認
- 線をなぞり直し、選択線が17制御点へ更新されることを確認
- 線追加で3本から4本、やり直しで3本へ戻ることを確認
- 保存状態はformatVersion 4、密度4096セル、`stateHash`を保持
- 保存JSONを読み戻し、`stateHash=798d58e4`、判定、密度4096セルが一致

## push確認

最初のpush後に`git ls-remote --heads origin`を実行し、その出力を追記する。

## 既知の制限

- 3回の変更線ではクリアできず、この目標帯が達成可能かは確認できていない。
- クリア解がないため、4軸の表示は実測確認できていない。
- 実行中は同期計算により約2.5秒、画面操作を受け付けない。
- 1課題のみで、再生、進行、比較機能はない。
