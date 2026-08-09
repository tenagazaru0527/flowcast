# Step 11: 場外損失の交絡を切り、回廊幅を正当に評価する

## 0. 位置づけ

Step 10 で回廊制約を導入し、`restoreWeight = 0` と組み合わせると経路の自己調整が
戻ることを確認した。しかし**測定に2つの交絡があり、回廊幅を正当に評価できていない。**

### 交絡1: `gapWidth = 63` には壁が存在しない

```text
g=1  : blockedセル数=58, central幅=1,  detour幅=5
g=3  : blockedセル数=56, central幅=3,  detour幅=5
g=9  : blockedセル数=50, central幅=9,  detour幅=5
g=63 : blockedセル数= 0, central幅=59, detour幅=5
```

`createCanyonLayout(63)` は 64 行すべてを開くため、障害物が1セルも生成されない。
**変化幅 = ratio(g=63) − ratio(g=1) は、壁のある構成と壁のない構成の比較である。**

決定的な証拠として、detour 入力は壁のある3構成すべてで比率が 0.00% で固定される
一方、g=63 を含めた変化幅は cw=1/2/3/4/8 で 15.97 / 19.53 / 25.63 / 30.93 / 45.25pt
になる。**変化幅の全量が壁なし点から生じている。**

壁のある構成（g=1/3/9）だけで再計算した distributed の変化幅:

| corridorWidth | congestionWeight=0 | congestionWeight=Q |
|---:|---:|---:|
| 1 | 2.14pt | 2.61pt |
| 2 | 5.18pt | 6.75pt |
| 3 | 7.59pt | 10.08pt |
| 4 | 8.74pt | 12.03pt |
| 8 | 15.72pt | 20.68pt |

### 交絡2: 場外損失が配置の偶然で決まっている

`outOfFieldByEdge` は全点で left / right のみ非ゼロ、top / bottom はすべて 0 だった。

| corridorWidth | left | right | outOfFieldRatio |
|---:|---:|---:|---:|
| 1 | 0 | 0 | 0% |
| 2 | 0 | 0 | 0% |
| 3 | 161,740 | 657,351 | 22% |
| 4 | 272,200 | 676,592 | 25% |
| 8 | 597,792 | 689,481 | 34% |

回廊が場の境界に届く最小距離は 3 である（源が x=4、シンクが x=59 にあるため）。
**場外損失の有無は回廊幅の性質ではなく、線と場の左右端との距離という配置依存の
幾何で決まっている。** このため `corridorWidth >= 3` の評価が場外損失で汚れており、
目標 10pt を満たす構成がすべて場外損失 22〜34% を伴う。

### 結果として起きていること

現行の単一指標では `corridorWidth = 8` が最良（35.11pt）と判定されるが、実態は
`completionRatio` 41〜44%、場外損失 34%、密度場は線が判別できない塗り潰しである。

**本 Step は交絡2を除去する。** 交絡1は掃引軸の差し替えで対応する。

engineVersion: 0.10.0 → **0.11.0**

前提: PR #15 がマージ済みであること。

---

## 1. 実装（変更は1つだけ）

### 1-1. `corridorBlocksOutOfField` の追加

現行の `proposeFlows` は、移送先が場外（`destination < 0`）である辺を回廊フィルタの
対象外としている。これを設定で切り替えられるようにする。

| 名前 | 既定値 | 意味 |
|---|---|---|
| `corridorBlocksOutOfField` | `false` | `true` のとき、場外への辺も「回廊外」として提案しない |

- `false`（既定）: 現行と完全に同一の挙動
- `true`: 場外への移送が発生しなくなり、`outOfFieldRatio` は構造的に 0 になる

真偽値であり、Q16.16 でも整数でもない。`createConfig` の範囲検査からは除外し、
真偽値として検査すること（`integerKeys` / `fixedKeys` のどちらにも入れない）。

### 1-2. 他は変更しないこと

- `corridorWidth` の判定式、BFS 距離場、移送規則の他の部分は変更しない
- `restoreWeight` / `congestionWeight` / `congestionReference` / `capacity` /
  `reverseThreshold` / `edgeFluxMax` の既定値は変更しない
- 源・シンクの座標、峡谷レイアウトは変更しない
- **`createCanyonLayout` の `63` は削除しない。** 掃引から外すだけとする

---

## 2. 既知のリスク（必ず観測すること）

`corridorBlocksOutOfField = true` は、場の境界を実質的に反射壁にする。

**DECISIONS 第3節には、Step 3 で場の境界が反射壁だったときに壁際の堆積が診断を
狂わせた記録がある。同じ人工物が再発する恐れがある。**

したがって以下を measure 専用で追加し、全点で記録すること。

| 指標 | 内容 |
|---|---|
| `fieldEdgeDensityMax` | 場の最外周セル（x=0, x=W-1, y=0, y=H-1）の最大密度 |
| `fieldEdgeDensityMaxCell` | その座標 |
| `fieldEdgeDensityPeak` | 全ステップを通じた同上の最大値 |

**`fieldEdgeDensityMax` が `densityMaxExSourceCell` の密度に近づく構成があれば、
それは交絡の除去ではなく別の人工物の導入である。判定は人間が行うので、
数値をそのまま報告すること。**

---

## 3. 計測の追加

### 3-1. 障害物前面の密度（新規、measure 専用）

Step 10 で `densityMaxExSourceCell`（源を除く最大密度の位置）を全144行で集計した
ところ、壁の列（x=30 または 31）に来るのは 11 行のみで、すべて straight 入力だった。
distributed では回廊の縁 (19,8) または源の隣 (5,31) に固定された。

DECISIONS 第3節には「壁の手前で帯が膨らむ空間的な絵」を理由にレーングラフ案を
棄却した記録がある。**その現象が起きているかを直接測る指標が存在しない。**

| 指標 | 内容 |
|---|---|
| `blockedFrontDensityMax` | 障害物セルに隣接する非障害物セルの最大密度 |
| `blockedFrontDensityMaxCell` | その座標 |
| `blockedFrontDensityPeak` | 全ステップを通じた同上の最大値 |

障害物が存在しない構成では `null` とすること。

### 3-2. measure 無影響

第2節・第3節の指標はすべて measure 専用であり、`stateHash` に影響しないこと。
既存の「measure 無影響テスト」で確認すること。

---

## 4. 後方互換の検証

- **`corridorBlocksOutOfField` 未指定（既定 `false`）で、3 シナリオ × 3 入力の
  9 ハッシュすべてが 0.10.0 / 0.9.0 と一致すること**

| シナリオ | straight | distributed | detour |
|---|---|---|---|
| poc-0-default | `4910305d` | `e63ba5b1` | `9164f600` |
| poc-1-wide | `f7606aa8` | `97a13950` | `13073731` |
| poc-2-canyon | `e3ddaebc` | `6e03aff9` | `ae3a98ad` |

- `test/core.test.js` に恒久テストとして追加する。**明示指定ではなく未指定で検証すること**
- `runtime-hashes.json` に 0.11.0 を 3 シナリオ分記録すること。**engineVersion を
  上げたのと同一コミットで行うこと**
- **一致しなければ停止して報告すること。定数で辻褄を合わせないこと**

---

## 5. 掃引（モード A、52 点）

```text
主格子（40点）
  corridorBlocksOutOfField : true
  corridorWidth            : 1, 2, 3, 4, 8
  congestionWeight         : 0, Q
  gapWidth                 : 1, 3, 5, 9
  restoreWeight            : 0

対照群1（8点）— 場外遮断の効果を分離するため
  corridorBlocksOutOfField : false
  corridorWidth            : 2, 8
  congestionWeight         : 0
  gapWidth                 : 1, 3, 5, 9
  restoreWeight            : 0

対照群2（4点）— 復元力との比較を維持するため
  corridorBlocksOutOfField : true
  corridorWidth            : 2
  congestionWeight         : 0
  gapWidth                 : 1, 3, 5, 9
  restoreWeight            : Q/16

共通
  congestionReference : 2048（固定）
  edgeFluxMax         : 512（固定）
  入力                : straight / distributed / detour（各点で3入力とも走らせる）
```

**`gapWidth = 63` は掃引に含めないこと。** 第0節の交絡1による。
`5` は `createCanyonLayout` が既に許容しているため実装変更は不要である。

出力先は `docs/reports/data/step-11-sweep.csv`。

### 5-1. 密度場スナップショット（12 ファイル）

- 出力先: `docs/reports/data/step-11-density/`
- 形式: 64 行 × 64 列の整数 CSV（ヘッダなし、`density[y * 64 + x]` を行優先）
- ファイル名: `{input}-cbof{0|1}-cw{corridorWidth}-g{gapWidth}.csv`

```text
input = distributed, restoreWeight = 0, congestionWeight = 0,
congestionReference = 2048, edgeFluxMax = 512

  corridorBlocksOutOfField = true  × corridorWidth 1,2,3,4,8 × gapWidth 1, 9  … 10 ファイル
  corridorBlocksOutOfField = false × corridorWidth 8         × gapWidth 1, 9  …  2 ファイル
```

**画像化はしないこと。** 描画スタックは未決定であり、本 Step のスコープ外である。

---

## 6. 報告すべき観測（`docs/reports/step-11.md`）

**解釈・推奨・判定・順位付けは不要である。事実のみを記載すること。**

### 6-1. 主観測

- distributed の中央ルート比率を g = 1 / 3 / 5 / 9 で算出し、その変化幅
- 同じ表を straight / detour についても出すこと
- **`corridorBlocksOutOfField` の true / false で、対照群1 と同条件の主格子点を
  並べた比較表**（cw=2 と cw=8、congestionWeight=0）

### 6-2. 副観測（全点、3 入力それぞれ）

- `completionRatio` / `remainingRatio` / `outOfFieldRatio` / `outOfFieldByEdge`
- **`fieldEdgeDensityMax` / `Peak` とその座標**（第2節のリスク）
- **`blockedFrontDensityMax` / `Peak` とその座標**（第3-1節）
- `densityMaxExSourceCell`、および**それが障害物の列に来た行数**
- `corridorEdgeDensityMax` / `Mean` / `Peak` とその座標
- `occupiedCellsPeak`、`coherenceLength`
- `outsideCorridorCells`（全点 0 であること）

### 6-3. 保存則

- `completed + outOfField + remaining = injected` が全構成で成立すること
- `corridorBlocksOutOfField = true` の全点で `outOfField = 0` であること。
  **0 でない点があればそのまま報告すること**

---

## 7. 完了条件

- 第5節の格子で 52 点、`docs/reports/data/step-11-sweep.csv`
- 第5-1節の密度 CSV 12 ファイル
- 第1節の実装、第2節・第3節の計測追加
- **`corridorBlocksOutOfField` 未指定で 9 ハッシュ一致（恒久テスト）**
- `runtime-hashes.json` に 0.11.0 を 3 シナリオ分記録（同一コミット）
- `npm run verify` PASS、measure 無影響テスト PASS
- `docs/reports/step-11.md` に第6節の観測（**CSV への参照ではなく実数値の表**）
- `docs/DECISIONS.md` の更新（第9節）
- 本文書を `docs/issues/step-11.md` としてコミット
- PR 本文に `Closes #<本Issue番号>`、`needs-human:decision` を付与、**マージせず停止**
- **push すること。** `git ls-remote --heads origin` の出力を報告に含めること

---

## 8. 想定される結果

- `corridorBlocksOutOfField = true` で `outOfFieldRatio` は全点 0% になると予想する
- 同時に `completionRatio` が改善し、`corridorWidth >= 3` でも 8 割前後を保つと
  予想する
- 変化幅は `corridorBlocksOutOfField` の true / false でほとんど変わらないと予想する
  （場外へ出ていた材料が場内に留まるだけで、経路選択の機序は変わらないため）
- `fieldEdgeDensityMax` は `true` 側で上昇すると予想する。上昇幅は不明
- `blockedFrontDensityMax` は `gapWidth` が小さいほど大きくなると予想する
- `gapWidth` を 63 から 5 に置き換えた結果、どの構成も変化幅 10pt に届かない
  可能性がある

**いずれも外れて構わない。外れた場合に定数で辻褄を合わせないこと。
未達は未達のまま報告すること。基準を通す値を探すのが目的ではない。
依存関係の記録が目的である。**

特に、**変化幅が 10pt に届かないまま終わることは想定内である。** その場合は
「回廊制約だけでは不足」という結論が確定し、次の機構（下流混雑ポテンシャル）へ
進む根拠になる。**届かせるために閾値や既定値を動かさないこと。**

---

## 9. `docs/DECISIONS.md` の更新（必須）

### 9-1. 第3節「撤回・棄却された主張」へ追加

| 主張 | 撤回理由 |
|---|---|
| `gapWidth = 63` を「ギャップが十分広い構成」として扱うこと | `blocked` が空になり障害物が存在しない。壁のある構成との比較になっておらず、Step 10 の変化幅はその大半が壁なし点由来だった |
| Step 10 の変化幅（g=63 込み）を経路の自己調整の指標として扱うこと | detour 入力は壁のある3構成すべてで比率 0.00% 固定にもかかわらず変化幅が最大 45.25pt になった。指標はビームの広がりを測っていた |

### 9-2. 第2節「有効な決定」へ追加

| 決定 | 理由 |
|---|---|
| 掃引の `gapWidth` は `{1, 3, 5, 9}` とする | 63 は障害物が生成されず、峡谷シナリオとして成立しない |
| 場外損失は配置依存の幾何に頼らず、設定で構造的に排除できるようにする | Step 10 では源・シンクと場の左右端との距離（4セル）だけで場外損失の有無が決まり、`corridorWidth >= 3` の評価が汚れた |

### 9-3. 第4節「保留中の判断」の更新

- **`corridorWidth` の既定値**（本 Step の結果を見て別 Issue で決定）
- **`corridorBlocksOutOfField` の既定値**（同上。既定 `false` は互換のための値であり、
  採用判断ではない）
- **`restoreWeight` の既定値**（回廊採用時は 0 が前提になるが、Step 8 の撤回に
  相当するため別 Issue）
- **完了率・場外損失を受け入れ基準の副条件に加えるか**（基準の定義変更のため保留）
- **壁の手前の滞留を評価対象に加えるか**（本 Step では観測のみ）
- **中央ルート比率という指標の妥当性**（straight では構造上 100% 固定）
- **下流混雑ポテンシャル（大域最短路）の導入**（本 Step で不足の場合の次案）
- **非線形圧力（Anti-C）**（優先度は下）

---

## 10. スコープ外

- **受け入れ基準の閾値変更**（「変化幅 10pt 以上」は動かさない）
- **既定値の決定**（本 Step の結果を見て別途起票する）
- `restoreWeight` の削除
- `capacity` / `reverseThreshold` / `congestionReference` / `edgeFluxMax` の変更
- 源・シンクの座標変更、峡谷レイアウトの変更
- `createCanyonLayout` からの `63` の削除
- 密度場の画像化・描画スタックの選定
- 下流混雑ポテンシャル、非線形圧力
- 壁の手前の滞留の基準化（本 Step は観測のみ）
- テーマ・描画・演出
