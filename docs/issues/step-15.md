# Step 15: 時間帯ごとの推移を計測できるようにする

## 0. 位置づけ

現在の計測は**すべて「総量」か「最終状態」**である。

- `totalCompleted` / `gapThroughput` / `outOfField` … 3,600ステップ分の合計
- `densityMaxExSource` / `blockedFrontDensityMax` / `fieldEdgeDensityMax` … 最終状態
- `completionStep` … 単一しきい値を通過した時刻が1つだけ

**したがって「いつ、どれだけ流れていたか」が取れない。**

### 現状で時系列を得るコスト

レビュー時に、壁の手前の滞留と通過量の推移を調べる必要が生じた。取得手段は
**「ステップ数を変えて何度も実行し、差分を取る」しかない。** 24点を得るのに
48回の再実行（約90秒）を要した。計算量は取得点数に対して二乗で増える。

### 実際に得られた結果（本 Step の再現目標）

`poc-2-canyon` / `gapWidth=1` / `straight` 入力 / `corridorWidth=2` /
`corridorBlocksOutOfField=true` / `restoreWeight=0` / `congestionWeight=0` /
`congestionReference=2048` / `edgeFluxMax=512` / `seed=324508639`

| step | `blockedFrontDensityMax` | 区間通過量（central）/step |
|---:|---:|---:|
| 100 | 454 | 13.9 |
| 250 | 6,906 | 475.1 |
| 400 | 18,988 | **512.0** |
| 1,000 | 31,549 | 512.0 |
| 2,000 | 40,365 | 512.0 |
| 3,550 | 51,213 | **512.0** |

**step 400 以降、区間通過量が 512.0 に張り付いたまま3,200ステップ動かない**
（512 = `gapWidth × edgeFluxMax`）。一方で滞留は 51,213 まで単調に増え続ける。

**この2つの数値を、本 Step で追加する計測から直接読み取れるようにすること。**

engineVersion: **0.11.0 のまま（変更しない）**

前提: PR #23（Step 14）がマージ済みであること。

---

## 1. スコープの原則

- 変更するのは `src/simulation.js`（measure 専用の追加）、`src/config.js`（設定1件）、
  `debug/`、`docs/`、必要なら `scripts/sweep.js`
- **`measure = false` のときの挙動を一切変えないこと**
- **`stateHash` を変えないこと。** 既存の「measure 無影響テスト」で確認する
- 既定値を変更しないこと。受け入れ基準・閾値を変更しないこと
- 掃引を実施しないこと

---

## 2. 実装内容

### 2-1. 設定 `sampleInterval` の追加

| 名前 | 既定値 | 意味 |
|---|---|---|
| `sampleInterval` | `0` | 0 なら時系列を記録しない。正の整数なら、そのステップ間隔で標本を取る |

- セル単位・ステップ単位の整数。Q16.16 ではない。`createConfig` の整数キー側で検査する
- 許容範囲は `0 .. steps`
- **`measure = false` のときは `sampleInterval` の値によらず標本を取らないこと**
- **既定 `0` により、既存の全実行が現行と同一挙動になること**

### 2-2. 時系列の記録

`measure = true` かつ `sampleInterval > 0` のとき、`step` が `sampleInterval` の
倍数になるたび、および最終ステップで、以下を1標本として記録する。

| 標本の項目 | 内容 |
|---|---|
| `step` | そのステップ番号 |
| `completed` | その時点までの `totalCompleted`（累積） |
| `outOfField` | その時点までの場外流出量（累積） |
| `remaining` | その時点で場に残っている量（瞬時値） |
| `gapThroughput` | ギャップ群ごとの累積通過量。群が無ければ空 |
| `blockedFrontDensityMax` | その時点の障害物前面の最大密度（瞬時値） |
| `densityMaxExSource` | その時点の源を除く最大密度（瞬時値） |
| `occupiedCells` | その時点で密度が非ゼロのセル数（瞬時値） |

**累積値と瞬時値を混ぜないこと。** 上表の区別をそのまま守り、報告にも明記すること。

区間量（1ステップあたりの通過量など）は**エンジン側で計算しないこと。** 累積値を
記録し、差分は利用側で取る。**エンジンは判定も加工もしない。**

結果は `result.measurements.timeline` に標本の配列として返す。
`sampleInterval = 0` のときは `null` とすること。

### 2-3. 掃引 CSV には含めないこと

標本数が数十になるため、CSV に展開すると列数が爆発する。

- **`scripts/sweep.js` は `sampleInterval` を既定 `0` のまま使い、`timeline` を
  CSV に出力しないこと**
- 既存の CSV 列構成を変更しないこと

### 2-4. ビューアでの表示（`debug/`）

Step 14 で定めた境界線（`runSimulation` の入力を作る／出力を読む、まで）の内側である。

- `sampleInterval` の入力欄を置く（既定 0）
- `sampleInterval > 0` で実行したとき、`timeline` を**表形式で表示**すること
- **区間通過量**（`gapThroughput` の差分 ÷ 区間ステップ数）を表に併記すること。
  これはビューア側の計算とする
- `timeline` を **CSV としてダウンロード**できること
- **グラフ描画は本 Step では行わない。** 表と CSV のみとする（演出・作り込みは
  境界線の外側であるため）

---

## 3. 後方互換の検証

- **`sampleInterval` 未指定（既定 0）で、3 シナリオ × 3 入力の 9 ハッシュすべてが
  0.11.0 の記録と一致すること。** `test/core.test.js` に恒久テストとして追加する。
  **明示指定ではなく未指定で検証すること**

| シナリオ | straight | distributed | detour |
|---|---|---|---|
| poc-0-default | `4910305d` | `e63ba5b1` | `9164f600` |
| poc-1-wide | `f7606aa8` | `97a13950` | `13073731` |
| poc-2-canyon | `e3ddaebc` | `6e03aff9` | `ae3a98ad` |

- **`sampleInterval` を 1 / 50 / 100 に変えても `stateHash` が上記と一致すること。**
  これも恒久テストに含めること
- `measure = true` と `measure = false` でハッシュが一致すること（既存テスト）
- `npm run verify` PASS

**ハッシュが変わった場合は停止して報告すること。engineVersion を上げて辻褄を
合わせないこと。**

---

## 4. 掃引

**実施しない。** `docs/reports/data/` に掃引データを追加しないこと。

ただし第0節の再現として、**単発実行を1件だけ行い、結果を CSV でコミットすること。**

```text
シナリオ  : poc-2-canyon, gapWidth = 1
入力      : straight
設定      : corridorWidth=2, corridorBlocksOutOfField=true, restoreWeight=0,
            congestionWeight=0, congestionReference=2048, edgeFluxMax=512,
            steps=3600, sampleInterval=100, seed=324508639
```

- 出力先: `docs/reports/data/step-15-timeline.csv`
- 列: `step`, `completed`, `outOfField`, `remaining`, `gapThroughput.central`,
  `gapThroughput.detour`, `blockedFrontDensityMax`, `densityMaxExSource`,
  `occupiedCells`

**第0節の表と照合し、`blockedFrontDensityMax` と区間通過量が近い値になるかを
報告すること。** レビュー側の値はステップ刻みが異なる（150刻み）ため完全一致は
しない。**一致させるために刻みを変えないこと。**

---

## 5. 報告すべき内容（`docs/reports/step-15.md`）

**解釈・推奨・順位付けは不要である。事実のみを記載すること。**

- 実装した項目（第2節の各項目について、実装したか・しなかったか）
- 第3節のハッシュ一致確認（`sampleInterval` = 未指定 / 1 / 50 / 100 の4通り × 9件）
- 第4節の時系列 CSV の要約表（step 100 / 400 / 1000 / 2000 / 3600 の抜粋）
- **第0節の表との照合結果**（近いか、外れたか。外れたならその値をそのまま）
- `sampleInterval` を 0 / 100 / 1 にしたときの**実行時間**（`steps=3600`）
- 累積値と瞬時値の区別を、どの項目にどう適用したか
- ブラウザとバージョン
- **既知の制限**

---

## 6. 完了条件

- 第2節の 2-1 〜 2-4 を実装
- 第3節のハッシュ検証をすべて満たす
- `npm run verify` PASS、measure 無影響テスト PASS
- `docs/reports/data/step-15-timeline.csv`
- `docs/reports/step-15.md` に第5節の内容
- `docs/LOOP.md` の「密度デバッグビューア」節と、計測の説明を実態に合わせて更新
- `docs/DECISIONS.md` の更新（第8節）
- 本文書を `docs/issues/step-15.md` としてコミット
- PR 本文に `Closes #<本Issue番号>`、**マージせず停止**
- **push すること。** 最終コミット後に `git ls-remote --heads origin` を実行し、
  その出力を報告に含めること

---

## 7. 想定される結果

- `sampleInterval = 0` と未指定で、実行時間は現行と変わらないと予想する
- `sampleInterval = 100`（36標本）で、実行時間の増加は 5% 未満と予想する
- `sampleInterval = 1`（3,600標本）では、`occupiedCells` の走査が毎ステップ入るため
  実行時間が明確に増えると予想する。**遅ければ遅いと報告すること。速くするために
  項目を削らないこと**
- 第4節の時系列で、区間通過量は step 400 前後で 512 に達し、その後 3,600 まで
  ほぼ一定になると予想する
- 同じ区間で `blockedFrontDensityMax` は単調に増加し続けると予想する

**いずれも外れて構わない。外れた場合に定数や刻みを調整して辻褄を合わせないこと。
未達は未達のまま報告すること。**

---

## 8. `docs/DECISIONS.md` の更新（必須）

### 8-1. 第2節「有効な決定」へ追加

| 決定 | 理由 |
|---|---|
| 時系列の標本は measure 専用とし、既定 `sampleInterval = 0` で記録しない | 既存の全実行と `stateHash` を変えないため。時系列は診断と検討のための情報であり、シミュレーションの一部ではない |
| エンジンは累積値のみを記録し、区間量・変化率・判定は行わない | 掃引ハーネスが判定・順位付け・推奨を行わないのと同じ原則。加工は利用側で行う |
| 時系列は掃引 CSV に出力しない | 標本数が数十になり列数が爆発する。掃引の CSV 構成は変更しない |

### 8-2. 第3節「撤回・棄却された主張」へ追加

| 主張 | 撤回理由 |
|---|---|
| Claude の「壁の手前に材料が溜まる現象は、詰まって解消する動的な見どころになりうる」 | 実測で否定。`gapWidth=1` では区間通過量が step 400 で `gapWidth × edgeFluxMax` = 512 に達したのち3,200ステップ一定で、滞留は 51,213 まで単調増加し**一度も抜けない**。通過容量が密度によらず固定のため、現在の機構では「溜まって抜ける」は原理的に起きない |

### 8-3. 第4節「保留中の判断」の更新

既存の保留項目はそのまま残すこと。以下を追加・更新する。

- **「決壊」を実現するか**（溜まった材料がある瞬間に一気に抜ける挙動。現在の機構では
  起きない。実現するにはモデルの定式化の変更が要る。候補は3つ）
  - 有限の供給（注入を途中で止める／総量を決める）
  - 圧力依存の通過容量（密度が高いほど通過量が増える）
  - 壊れる障害物（密度が閾値を超えた障害物が消える）

  **いずれも既存の均衡（線に沿って流れる／線から離れられる）への影響が未知である。
  本 Step では扱わない。**
- **シンクごとの到達量と到達時刻を計測するか**（Step 14 の multisink 盤面で、
  シンクを2つに分けても `completionRatio` が合算されることが判明した。「順番」の前提）
- **「線と実際の流路の一致度」の計測を追加するか**（引き続き保留）

---

## 9. スコープ外

- モデルの定式化の変更（決壊の3案を含む）
- 既定値、受け入れ基準、基準閾値の変更
- engineVersion の変更
- パラメータ掃引
- 時系列のグラフ描画（表と CSV のみ）
- シンクごとの到達量の区別
- 線と流路の一致度の計測
- 成功・失敗条件、スコア、演出、UI の作り込み
- ゲーム層のディレクトリ作成
- 外部ライブラリの追加、ビルド手順の追加
- テーマ・製品名
