# Step 17: シンクごとの到達量と到達時刻を計測する

## 0. 位置づけ

Step 14 で盤面を自由に編集できるようにし、シンクを2箇所に分けた盤面
（`docs/reports/data/step-14-board-multisink.json`、`sink = [[59,20],[59,44]]`）を作った。

**しかしシンクを分けても、到達量は合算されて区別できない。**

```
completionRatio 27%   ← 2つのシンクの合計。内訳が取れない
```

一方、ギャップは `gaps`（名前付きセル群）を渡すことで群ごとの通過量が取れる
（`gapThroughput`）。**シンクにも同じ仕組みを用意する。**

これは保留中の「**順番**（先にA、次にB）」を検討するための前提である。順番を扱うには
「どのシンクに、いつ、どれだけ届いたか」が要る。

engineVersion: **0.11.0 のまま（変更しない）**

前提: PR #27（Step 16）がマージ済みであること。

---

## 1. スコープの原則

- 変更するのは `src/simulation.js`（measure 専用の追加）、`debug/`、`docs/`、
  必要なら `scripts/sweep.js` と `test/`
- **`measure = false` のときの挙動を一切変えないこと**
- **`stateHash` を変えないこと**
- 既定値・受け入れ基準・閾値・`sink` の扱いそのものを変更しないこと
- 掃引を実施しないこと

---

## 2. 実装内容

### 2-1. 引数 `sinkGroups` の追加

`runSimulation` に省略可能な引数 `sinkGroups` を追加する。形式は `gaps` と同型とする。

```js
sinkGroups = [ { name: "upper", cells: [[59, 20]] }, { name: "lower", cells: [[59, 44]] } ]
```

**検証条件（満たさない場合は例外を投げること）**

- 群は **最大4つ**
- 名前は空でない文字列で、重複しないこと
- **各群のセルは `sink` に含まれること**
- **群の和が `sink` の全セルと完全に一致すること（過不足なし）**
- 群どうしでセルが重複しないこと

**「群の和 = `sink` 全体」を必須にする理由**：これにより
**`Σ sinkThroughput === totalCompleted`** が不変条件になり、実装の誤りを検出できる。
`gaps` と異なり、部分集合は許さない。

`sinkGroups` を渡さない場合は現行と完全に同一の挙動とし、後述の計測を `null` とする。

### 2-2. 追加する計測（measure 専用）

| 名前 | 内容 | 種別 |
|---|---|---|
| `sinkThroughput` | 群ごとの到達量。群名をキーとするオブジェクト | 累積 |
| `sinkFirstArrivalStep` | 群ごとに、到達量が初めて 0 より大きくなったステップ番号。一度も到達しなければ `-1` | — |

- `sinkGroups` 未指定のときは両方とも `null`
- **しきい値を用いた到達判定を持ち込まないこと。** `sinkFirstArrivalStep` は
  「初めて 0 より大きくなった」という事実のみとする。`completionTarget` は使わない
- **比・順位・「どちらが先か」の判定を行わないこと。** 加工は利用側で行う

### 2-3. 時系列への追加

Step 15 の `timeline` の各標本に `sinkThroughput`（累積）を追加する。

- `gapThroughput` と同じ形式・同じ位置づけとする
- 群は最大4つなので、`timeline` の CSV 列は最大4列しか増えない
  （距離分布のように爆発しない）
- `sinkGroups` 未指定のときは標本にも含めない、または `null` とすること

### 2-4. 掃引 CSV の扱い

- `scripts/sweep.js` は `sinkGroups` を渡さないこと。既存の CSV 列構成を変更しないこと
- `sinkThroughput` / `sinkFirstArrivalStep` は `null` になるため、
  **`flattenMeasurements` が `null` を安全に扱えることを確認すること**

### 2-5. ビューアでの対応（`debug/`）

Step 14 で定めた境界線（`runSimulation` の入力を作る／出力を読む、まで）の内側である。

- **シンク群の編集**：シンクセルを群に割り当てられること。UI は Step 14 の
  ギャップ群編集と同じ形式とする（最大4群、名前は編集可、既定は `A` / `B` / `C` / `D`）
- **第2-1節の検証を UI 側で先に行い**、満たさない場合は実行ボタンを無効化して理由を
  表示すること（`src/` の例外に頼らない）
- 群が未定義のときは実行可能とし、計測は `—` と表示すること
- **シンク群を色分けして描画**し、名前を表示すること
- 計測パネルに `sinkThroughput` と `sinkFirstArrivalStep` を群ごとに表示すること
- `timeline` の表と CSV に `sinkThroughput` の列を追加すること
- 保存 JSON に `sinkGroups` を含めること。**`formatVersion` を 4 に上げ、
  1 / 2 / 3 の JSON も読み込めること**（`sinkGroups` が無ければ未定義として扱う）

---

## 3. 後方互換の検証

- **`sinkGroups` 未指定で、3 シナリオ × 3 入力の 9 ハッシュすべてが 0.11.0 の記録と
  一致すること**

| シナリオ | straight | distributed | detour |
|---|---|---|---|
| poc-0-default | `4910305d` | `e63ba5b1` | `9164f600` |
| poc-1-wide | `f7606aa8` | `97a13950` | `13073731` |
| poc-2-canyon | `e3ddaebc` | `6e03aff9` | `ae3a98ad` |

- **`sinkGroups` を指定しても `stateHash` が上記と一致すること。**
  `poc-1-wide` はシンクが5セルなので、これを 2 群（3セル + 2セル）に分けて検証すること。
  恒久テストに含めること
- **`Σ sinkThroughput === totalCompleted` が成立すること。** 恒久テストに含めること
- `measure = true` と `measure = false` でハッシュが一致すること（既存テスト）
- `npm run verify` PASS

**ハッシュが変わった場合は停止して報告すること。engineVersion を上げて辻褄を
合わせないこと。**

---

## 4. 掃引

**実施しない。** ただし動作確認として、**Step 14 の multisink 盤面にシンク群を
定義した盤面を1件作り、コミットすること。**

- 出力先: `docs/reports/data/step-17-board-multisink-groups.json`
- 元にする盤面: `docs/reports/data/step-14-board-multisink.json`
- シンク `[[59,20],[59,44]]` を 2 群（`upper` = `[[59,20]]`、`lower` = `[[59,44]]`）に分ける
- **線と障害物は変更しないこと**

この盤面を次の2条件で実行し、結果を報告すること。

| 件 | 設定 |
|---|---|
| 1 | 既定パラメータ（Step 14 の盤面 JSON と同じ）＋ `sampleInterval = 100` |
| 2 | `corridorWidth = 2` / `corridorBlocksOutOfField = true` / `restoreWeight = 0` / `congestionWeight = 0` / `congestionReference = 2048` / `edgeFluxMax = 512` / `sampleInterval = 100` |

時系列は `docs/reports/data/step-17-timeline-multisink.csv` にコミットすること
（2件を `case` 列で区別する）。

**どちらが良いかは書かないこと。**

---

## 5. 前 Step からの持ち越し（報告への追記）

Step 15・16 のレビューで指摘された未反映事項を、本 Step の報告に含めること。
**掃引や再実行は不要で、既存データからの転記または追加実測1件のみである。**

1. **`sampleInterval = 1` の実行時間**（`steps = 3600`）。Step 15 の Issue 第5節で
   求めていたが記載が無い。0 / 100 / 1 の3条件で測ること
2. **`occupiedCells` が頭打ちになる事実**。`docs/reports/data/step-15-timeline.csv` に
   よれば step 1,000 以降 449〜450 で止まる一方、`remaining` は 1,956,200 まで増え続ける。
   **面積が増えず密度だけが上がっている**という事実を記載すること
3. **Step 16 の想定が外れた点**。Issue 第7節の「`corridorWidth` が大きい構成では
   距離0が最大にならない可能性がある」は外れ、**4条件すべてで距離0が最大**だった
   （セルあたり平均密度で 616 / 628 / 647 / 605）。外れた旨を明記すること

---

## 6. CI 実行時間の報告

Step 16 で Node 20 の CI が 9分45秒となり、10分の上限に近い。

- 本 Step 適用後の **CI 実行時間を Node 20 / 22 それぞれについて報告すること**
- **上限を超えた場合は、テストを削らず、超えた事実をそのまま報告して停止すること。**
  分割方法は人間が判断する

---

## 7. 報告すべき内容（`docs/reports/step-17.md`）

**解釈・推奨・順位付けは不要である。事実のみを記載すること。**

- 実装した項目（第2節の各項目について、実装したか・しなかったか）
- 第3節のハッシュ一致確認（未指定9件 + `sinkGroups` 指定時）
- `Σ sinkThroughput === totalCompleted` の確認結果
- 第4節の2件について、`sinkThroughput`（群ごと）、`sinkFirstArrivalStep`（群ごと）、
  `completionRatio` / `remainingRatio` / `outOfFieldRatio` / `stateHash`
- 第5節の持ち越し3件
- 第6節の CI 実行時間
- `formatVersion` 1 / 2 / 3 の読み込み確認
- ブラウザとバージョン
- **既知の制限**

---

## 8. 完了条件

- 第2節の 2-1 〜 2-5 を実装
- 第3節のハッシュ検証と不変条件をすべて満たす
- `npm run verify` PASS、measure 無影響テスト PASS
- `docs/reports/data/step-17-board-multisink-groups.json`
- `docs/reports/data/step-17-timeline-multisink.csv`
- `docs/reports/step-17.md` に第7節の内容
- `docs/LOOP.md` の計測とビューアの説明を実態に合わせて更新
- `docs/DECISIONS.md` の更新（第10節）
- 本文書を `docs/issues/step-17.md` としてコミット
- PR 本文に `Closes #<本Issue番号>`、**マージせず停止**
- **push すること。** 最終コミット後に `git ls-remote --heads origin` を実行し、
  その出力を報告に含めること

---

## 9. 想定される結果

- `sinkGroups` を指定してもハッシュは変わらないと予想する
- `Σ sinkThroughput === totalCompleted` は成立すると予想する
- multisink 盤面の既定パラメータでは、2群の到達量に大きな偏りは出ないと予想する
  （線が上下対称に近いため）。**偏った場合はそのまま報告すること**
- `sinkFirstArrivalStep` は2群で近い値になると予想する
- 既定パラメータでは場外損失が 57% あるため、両群の到達量とも小さいと予想する
- `corridorWidth = 2` の条件では場外損失が 0% になり、到達量が増えると予想する

**いずれも外れて構わない。外れた場合に定数や群の分け方を調整して辻褄を
合わせないこと。未達は未達のまま報告すること。**

---

## 10. `docs/DECISIONS.md` の更新（必須）

### 10-1. 第2節「有効な決定」へ追加

| 決定 | 理由 |
|---|---|
| シンクの内訳は `sinkGroups`（名前付きセル群）で表現し、`gaps` と同型とする | 既にある仕組みの流用で、新しい概念を持ち込まない |
| `sinkGroups` は `sink` 全体を過不足なく分割することを必須とする | `Σ sinkThroughput === totalCompleted` が不変条件になり、実装の誤りを検出できる。`gaps` と異なり部分集合は許さない |
| `sinkFirstArrivalStep` はしきい値を用いず「初めて 0 より大きくなったステップ」とする | しきい値を導入すると、その値が結論を決めてしまう。計測は事実のみを記録する |

### 10-2. 第3節「撤回・棄却された主張」へ追加

| 主張 | 撤回理由 |
|---|---|
| Claude の Step 16 想定「`corridorWidth` が大きい構成では距離0（線上）が最大にならない可能性がある」 | 外れ。4条件すべてで距離0のセルあたり平均密度が最大だった（616 / 628 / 647 / 605） |

### 10-3. 第4節「保留中の判断」の更新

既存の保留項目はそのまま残すこと。以下を更新する。

- **「順番」を成功条件に使うか**（本 Step で計測は可能になる。使うかどうかは、
  成功・失敗の型の判断に含まれる）
- **「時間を稼ぐ」ことに価値を持たせるか**（実装は不要。Step 15 の時系列と
  本 Step の `sinkFirstArrivalStep` で検証できる）
- **「一致度」をどう定義するか**（Step 16 で分布は取れた。スカラー化の要否は未決）
- **決壊の3案**（有限の供給／圧力依存の通過容量／壊れる障害物。基本線を優先し後回し）
- **CI 実行時間が上限に近づいた場合のテスト分割方法**（Step 16 で Node 20 が9分45秒）

---

## 11. スコープ外

- モデルの定式化の変更（決壊の3案を含む）
- 既定値、受け入れ基準、基準閾値の変更
- engineVersion の変更
- `sink` の扱いそのものの変更（注入・除去の規則、多セル規則）
- パラメータ掃引
- 「順番」の成功条件としての実装、しきい値の導入
- 「一致度」のスカラー化
- 分布の時系列記録
- グラフ描画（表と CSV のみ）
- 成功・失敗条件、スコア、演出、UI の作り込み
- ゲーム層のディレクトリ作成
- 外部ライブラリの追加、ビルド手順の追加
- テーマ・製品名
