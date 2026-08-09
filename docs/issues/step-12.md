# Step 12: デバッグビューアを現行エンジンに追随させ、線を引けるようにする

## 0. 位置づけ

`debug/` の密度ビューアは Step 7 以前のもので、**Step 7 以降に追加されたものが1つも
操作できない。**

`debug/viewer.js` の import は次の1行のみである。

```js
import { DEFAULT_SEED, INPUTS, SINK, SOURCE } from "../src/scenarios.js";
```

| 対象 | 追加 Step | ビューアで操作可能か |
|---|---|---|
| 峡谷シナリオ（壁とギャップ） | Step 7 | **不可**（`poc-0-default` 固定） |
| `gapWidth` | Step 7 | **不可** |
| `restoreWeight` | Step 8 | **不可** |
| `congestionWeight` / `congestionReference` | Step 9 | **不可** |
| `corridorWidth` | Step 10 | **不可** |
| `corridorBlocksOutOfField` | Step 11 | **不可** |
| `edgeFluxMax` / `advectionWeight` / `diffusionWeight` | Step 6 以前 | 可 |

さらに、入力は `INPUTS` の3種（直進・分散・迂回）に固定されており、**任意の線を試せない。**

Step 7〜11 で「見て面白いか」の判断が5回保留された。判断が進まなかった原因は材料の
不足であり、その材料を作るのが本 Step である。

**本 Step は `src/` を一切変更しない。** モデル・受け入れ基準・ハッシュ・
engineVersion はすべて据え置く。

engineVersion: **0.11.0 のまま（変更しない）**

前提: PR #17（Step 11）がマージ済みであること。

---

## 1. スコープの原則

- **変更してよいのは `debug/` 配下と `docs/` のみ**
- `src/` / `scripts/` / `test/` / `runtime-hashes.json` は変更しない
- ビルド手順を追加しない。素の ES modules のまま、
  `python3 -m http.server 8000` → `http://localhost:8000/debug/` で動くこと
- 外部ライブラリを追加しない。Canvas 2D のみを使う
- **本 Step の成果物は製品の描画スタックではない。** `docs/DECISIONS.md` 第4節の
  「描画スタックは PoC-0 通過後に決定」は有効なままである

---

## 2. 実装内容

### 2-1. シナリオとレイアウトの選択

| 項目 | 選択肢 |
|---|---|
| シナリオ | `poc-0-default` / `poc-1-wide` / `poc-2-canyon` |
| `gapWidth` | 1 / 3 / 5 / 9 / 63（`poc-2-canyon` のときのみ有効） |

`src/scenarios.js` の `SCENARIOS` と `createCanyonScenario` を使うこと。
シナリオごとの `source` / `sink` / `blocked` / `gaps` を正しく渡すこと。

**`gapWidth = 63` では障害物が生成されない**（`blocked` が空になる）。これは
Step 11 で確認済みの仕様であり、バグではない。選択肢からは外さないこと。

### 2-2. パラメータ入力欄

以下を数値入力または真偽値のトグルで操作できること。既定値は
`src/config.js` の `DEFAULT_CONFIG` を初期表示とする。

```text
corridorWidth              整数（0 .. width + height）
corridorBlocksOutOfField   真偽値
restoreWeight              整数（Q16.16）
congestionWeight           整数（Q16.16）
congestionReference        整数
edgeFluxMax                整数
advectionWeight            整数（Q16.16）
diffusionWeight            整数（Q16.16）
steps                      整数（既定 3600）
seed                       整数
```

`createConfig` が投げた `RangeError` / `TypeError` は握りつぶさず、
メッセージをそのまま画面に表示すること。

### 2-3. 線の描画（本 Step の中心）

キャンバス上でクリックして制御点を置き、線を作れること。

**`burnLines` の制約を UI 側で強制すること。** 制約を破った状態では実行ボタンを
無効化し、理由を文言で表示する。

```js
// src/lines.js より（変更しないこと）
if (!Array.isArray(lines) || lines.length < 3 || lines.length > 5) {
  throw new RangeError("lines must contain between 3 and 5 paths");
}
if (!Array.isArray(points) || points.length < 2) {
  throw new RangeError("each line needs at least two control points");
}
```

- **線は 3 本以上 5 本以下**
- **各線は制御点 2 個以上**
- 座標は場の範囲内の整数

必要な操作:

- 線の追加 / 削除 / 選択
- 選択中の線に制御点を追加、末尾の制御点を取り消し
- 制御点のドラッグ移動
- 全消去
- **プリセット読み込み**（現シナリオの `straight` / `distributed` / `detour`）。
  初期表示は `distributed` とする

線は密度の上に重ねて描画し、線ごとに色を変えること。source と sink は
現行ビューアと同じマーカーで表示する。

### 2-4. 実行と再生

シミュレーションは途中状態を取り出す API を持たないため、**指定 step まで
毎回再実行する**（現行ビューアと同じ方式）。実測（Node、`corridorWidth=8`）:

| steps | 所要 |
|---:|---:|
| 300 | 約 0.23 秒 |
| 1,200 | 約 1.3 秒 |
| 3,600 | 約 4.5 秒 |

したがって次の2モードに分けること。

**(a) 最終状態モード（既定）**
`steps` まで1回だけ実行して結果を表示する。線を編集するたびにこれを使う。

**(b) 再生モード（明示的にボタンを押したときのみ）**
以下の固定 step 階段でフレームを生成し、順に描画する。

```text
25, 50, 75, 100, 150, 200, 300, 400, 550, 700, 900, 1100,
1400, 1700, 2000, 2400, 2800, 3200, 3600
```

- 合計は約 21,900 step ぶんの計算で、**3,600step 単発の約 6 倍**（実測換算で 25〜30 秒）
- **進捗表示を必ず出すこと**（「フレーム 7 / 19 を計算中」など）
- 生成済みフレームは、線とパラメータの組が変わるまでキャッシュして再利用する
- 再生中はスライダーでフレームを行き来できること
- `steps` が 3,600 未満のときは階段を `steps` 以下に切り詰める

**色スケールは全フレーム共通とすること**（階段全体の最大密度で正規化した対数
スケール）。フレームごとに正規化すると、密度が増えていく様子が消える。

### 2-5. オーバーレイの表示切り替え

チェックボックスで個別に切り替えられること。

| 表示 | 内容 |
|---|---|
| 障害物 | `blocked` セル |
| 線 | 引いた線と制御点 |
| 回廊の縁 | `buildRestoreField` の `distance === corridorWidth` のセル |
| 場の縁 | 最外周セル（`corridorBlocksOutOfField` の影響を見るため） |

`buildRestoreField` は `src/lines.js` から import して使うこと。再実装しない。

### 2-6. 計測パネル

現在表示中の状態について、以下を表示すること。`runSimulation` に
`measure: true` を渡して取得する。

```text
completionStep          （目標量に到達した step。未到達なら -1）
totalCompleted / completionRatio
outOfFieldRatio / remainingRatio
gapThroughput.central / .detour  および 中央ルート比率（%）
densityMaxExSource と densityMaxExSourceCell
blockedFrontDensityMax とその座標
fieldEdgeDensityMax とその座標
occupiedCellsPeak
stateHash
```

**`gapThroughput` は `poc-2-canyon` のときのみ意味を持つ。** 他シナリオでは
`—` と表示すること。

### 2-7. 保存・読み込み・URL

- 現在の「シナリオ / gapWidth / パラメータ / 線 / seed」を **JSON でダウンロード**できること
- その JSON を**読み込んで復元**できること
- 同じ内容を **URL のハッシュ部**に載せ、URL を共有すれば同じ盤面が開けること

**`src/scenarios.js` の `createReplay` / `replayInput` は使えない。** これらは
`scenarioId` を `poc-0-default` に固定し、`source` / `sink` を定数から返すため、
峡谷シナリオや任意パラメータを表現できない。**ビューア独自の JSON 形式を
`debug/` 内に定義すること。`src/` 側の replay 形式は変更しないこと。**

JSON には `formatVersion` と `engineVersion` を含め、`engineVersion` が現行と
異なる場合は警告を表示したうえで読み込みは許可すること（拒否しない。過去の
盤面を見られなくなるため）。

---

## 3. 後方互換の検証

`src/` を変更しないため、ハッシュは自明に不変である。ただし確認は行うこと。

- `npm run verify` が PASS すること
- `node scripts/check-runtime-hashes.js` が 0.11.0 で PASS すること
- `git diff` で `src/` / `scripts/` / `test/` / `runtime-hashes.json` に
  **変更が1行も無いこと**を報告に明記すること

---

## 4. 掃引

**実施しない。** 本 Step にパラメータ掃引は無い。
`docs/reports/data/` に新規ファイルを追加しないこと。

---

## 5. 報告すべき内容（`docs/reports/step-12.md`）

**解釈・推奨・順位付けは不要である。事実のみを記載すること。**

- 実装した機能の一覧（第2節の各項目について、実装したか・しなかったか）
- **`src/` に変更が無いことの確認**（`git diff --stat origin/main..step/12` の出力）
- 再生モードのフレーム生成に要した実測時間（ブラウザ、19フレーム、`steps=3600`）。
  使用したブラウザとバージョンを明記すること
- 最終状態モードの1回あたり実測時間（`steps=3600`）
- `npm run verify` の結果
- **既知の制限**（実装できなかったもの、動作が重いもの、ブラウザ依存があるもの）

**「使いやすいか」「面白いか」は書かないこと。** それは人間が操作して判断する。

---

## 6. 完了条件

- 第2節の 2-1 〜 2-7 を実装
- `python3 -m http.server 8000` → `http://localhost:8000/debug/` で、
  **ビルドなしに動作すること**
- `src/` / `scripts/` / `test/` / `runtime-hashes.json` に変更が無いこと
- `npm run verify` PASS
- `docs/reports/step-12.md` に第5節の内容
- `docs/LOOP.md` の「密度デバッグビューア」節を実態に合わせて更新
- `docs/DECISIONS.md` の更新（第8節）
- 本文書を `docs/issues/step-12.md` としてコミット
- PR 本文に `Closes #<本Issue番号>`、**マージせず停止**
- **push すること。** `git ls-remote --heads origin` の出力を報告に含めること

---

## 7. 想定される結果

- 再生モードのフレーム生成は 25〜40 秒かかると予想する。**この遅さは想定内であり、
  速くするために step 階段を粗くしないこと。** 遅ければ遅いと報告すること
- 線をドラッグ編集するたびに最終状態モードを走らせると 4〜5 秒待つことになる。
  **自動再実行はせず、明示的な実行ボタンを置くこと**
- `corridorWidth` を大きくすると計算が重くなると予想する。実測を報告すること
- ブラウザによって実行時間に差が出ると予想する。`stateHash` は一致するはずである。
  **一致しない場合は停止して報告すること**

**いずれも外れて構わない。外れた場合に階段や既定値を調整して辻褄を合わせないこと。**

---

## 8. `docs/DECISIONS.md` の更新

### 8-1. 第2節「有効な決定」へ追加

| 決定 | 理由 |
|---|---|
| `debug/` のビューアはエンジンの変更に追随させる | Step 7〜11 の5つの機構がビューアに反映されず、「見て面白いか」の判断が5回保留された |
| ビューアで任意の線を引けるようにする | `INPUTS` の3種のみでは、入力と出力の対応をプレイヤー視点で確かめられない |
| ビューアの盤面保存は `src/` の replay 形式を使わず、`debug/` 独自形式とする | `createReplay` は `scenarioId` を `poc-0-default` に固定しており、峡谷シナリオや任意パラメータを表現できない。`src/` 側を触らずに済ませる |

### 8-2. 第4節「保留中の判断」へ追加

- **成功・失敗の定義**（型は複数あり、いずれもエンジンの既存計測で表現可能）
  - タイムアタック型：`completionStep`
  - 課題達成型：`totalCompleted` と `steps` と `outOfFieldRatio` の組
  - 配分型：`gapThroughput` の比
  - `config.completionTarget`（既定 `32 * Q`）は既に「目標量」として実装されているが、
    受け入れ基準からは参照されていない
- **走行中に線を引き直せるようにするか**（「入力は線が数本まで」の制約は線の本数に
  ついてのものであり、時間軸への介入を許すかは未決）

### 8-3. 第4節「保留中の判断」の既存項目は維持

Step 11 までの保留（`corridorWidth` / `corridorBlocksOutOfField` / `restoreWeight`
の既定値、完了率と場外損失を副条件に加えるか、壁の手前の滞留の扱い、
中央ルート比率の妥当性、下流混雑ポテンシャル）は**そのまま残すこと。**
本 Step では何も決定しない。

---

## 9. スコープ外

- `src/` / `scripts/` / `test/` / `runtime-hashes.json` の変更
- engineVersion の変更
- モデルの定式化、既定値、受け入れ基準、基準閾値の変更
- パラメータ掃引
- 成功・失敗条件の実装（第8-2節のとおり、定義自体が未決）
- 製品の描画スタックの選定、演出、色設計、UI の作り込み
- 外部ライブラリの追加、ビルド手順の追加
- テーマ・製品名
