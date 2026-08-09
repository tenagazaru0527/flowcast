
# Step 10: 回廊制約の導入と、復元力からの置き換え（改訂版 rev.2）

本文書は Issue #14 の本文を全面差し替えするものである。`docs/issues/step-10.md` を本文書で上書きし、同じコミットに含めること。  
旧版（rev.1）の掃引格子・想定結果は、レビュー時の先行実行で誤りが判明したため破棄する。実装済みの部分は第 2 節で「実装済み」と明示する。

## 0. 位置づけ

Step 9 で通気度（バックプレッシャー）を導入したが、自己調整は戻らなかった。

**分散入力の中央ルート比率のギャップ幅依存（目標 10pt 以上）:**

| `congestionWeight` | `congestionReference` | g=1 | g=63 | 変化幅 |
| :--- | :--- | :--- | :--- | :--- |
| 0 | 4096 | 28.0% | 28.1% | 0.1pt |
| Q | 2048 | 33.6% | 33.7% | 0.2pt |

通気度は確実に発動している（`conductanceMin` が 0、`throttledEdgeCount` 74 万件）。  
比率の絶対値も 28.0% → 33.6% と上がった。しかしギャップ幅への依存が生まれない。

**原因（密度分布の実測）**

| 条件 | 構成壁の手前 (31,32) | 分岐付近 (6,32) |
| :--- | :--- | :--- |
| 通気度なし・g=1 | 1,124 | 1,196 |
| 通気度なし・g=63 | 652 | 1,196 |
| 通気度最大・g=1 | 1,360 | 1,220 |
| 通気度最大・g=63 | 711 | 1,220 |

壁の手前の密度はギャップ幅で倍以上変わるのに、分岐付近はまったく反応していない。  
渋滞が上流へ伸びていない。  
理由は復元力にある。通気度は「入りにくくする」力だが、入れなかった材料が線を離れて後ろへ戻る経路がない。復元力が材料を線に貼り付けているため、渋滞が伸びる先が存在しない。

* **engineVersion**: 0.9.0 → 0.10.0
* **前提**: PR #13 がマージ済みであること。

---

## 1. 方針

復元力（力による拘束）を、回廊（幾何による制約）へ置き換える。

* **漏れ防止**：線の周囲の帯（回廊）の外へは移送しない、という制約で担う
* **経路選択**：回廊の中では拡散を自由に働かせる

材料が線を離れられるようになるため、渋滞が上流へ伸びる余地が生まれる。  
副作用としてビームが回廊幅まで太る。回廊幅を小さく取れば緩和できるが、狭すぎると迂回する空間がなくなる。その両立点を探すのが本 Step の掃引である。

---

## 2. 実装

### 2-1. 回廊の定義（実装済み・変更不要）

Step 8 で導入済みの静的 BFS 距離場 $D$ を再利用する。新たな場は作らないこと。

* $\Omega = \{ \text{cell} \mid D(\text{cell}) \ge 0 \land D(\text{cell}) \le \text{corridorWidth} \}$
* $D$ が未定義（到達不能、$D == -1$）のセルは $\Omega$ の外とする
* 障害物セルは元から移送先にならない（既存の扱いを変えない）

### 2-2. 移送規則への反映（実装済み・変更不要）

移送先が $\Omega$ の外である辺は、提案しない（`proposeFlows` でスコアを 0 にする）。

* 判定は `advectionScore` / `diffusionScore` の算出前に行うこと
* 場外境界の扱い（吸収）は変更しないこと。回廊外は「場外」ではない。移送しないだけで、材料は消えない
* 場外への辺（`destination < 0`）は回廊フィルタの対象外とする

### 2-3. 設定値（実装済み・4-2 / 4-3 の修正のみ）

| 名前 | 既定値 | 意味 |
| :--- | :--- | :--- |
| `corridorWidth` | `width + height`（実質無制限） | $\Omega$ の半径。セル単位の整数。既定では全セルが $\Omega$ に入り、現行と同一挙動 |

Q16.16 ではなくセル単位の整数であり、`createConfig` の整数キー側で検査する。  
許容範囲は `0 .. width + height`。

### 2-4. `restoreWeight` は削除しないこと

回廊が復元力の役割を引き継ぐが、`restoreWeight` は残す。既定値の変更は本 Step では行わない。

### 2-5. CSV 出力の不具合修正（実装済み・変更不要）

`docs/reports/data/step-09-sweep.csv` の `measurement.gapThroughput` および `measurement.sourceDistance` が `[object Object]` として書き出されていた。  
`scripts/sweep.js` の CSV 出力でオブジェクト値を平坦化すること（`measurement.gapThroughput.central` / `.detour` の別列にする）。

---

## 3. 計測の追加

### 3-1. 回廊の縁の扱い（実装済み・3-2 を追加）

回廊の縁は移送が遮断されるため、材料が縁に溜まる。  
その密度上昇が内向きの勾配を作り、復元力を持たなくても線へ戻る効果が出る。  
これが本方式の要点である。 ただし Step 3 で場の境界が反射壁だったときに壁際の堆積が診断を狂わせた前例がある。同じ人工物が場の内部に生まれる恐れがある。  
以下を `measure` 専用で持つこと（`corridorEdgeDensityMax` / `Mean` / `outsideCorridorCells` は実装済み）。

| 指標 | 内容 | 状態 |
| :--- | :--- | :--- |
| `corridorEdgeDensityMax` | 最終状態の $D == \text{corridorWidth}$ セルにおける最大密度 | 実装済み |
| `corridorEdgeDensityMaxCell` | その座標 | 実装済み |
| `corridorEdgeDensityMean` | 同セル群の平均密度 | 実装済み |
| `outsideCorridorCells` | $\Omega$ 外にある非ゼロ密度セル数 | 実装済み（3-4 参照） |

### 3-2. 回廊縁密度のピーク（新規）

現行の `corridorEdgeDensityMax` は最終状態のみを見ており、途中の堆積を取り逃す。  
時間方向の最大も取ること。

| 指標 | 内容 |
| :--- | :--- |
| `corridorEdgeDensityPeak` | 全ステップを通じた $D == \text{corridorWidth}$ セルの最大密度 |
| `corridorEdgeDensityPeakCell` | その座標と、そのときのステップ番号 `[x, y, step]` |

### 3-3. 場外損失の内訳（新規）

`outOfFieldRatio` がどの境界から出たかが分からない。以下を追加する。

| 指標 | 内容 |
| :--- | :--- |
| `outOfFieldByEdge` | `{ left, right, top, bottom }` の流出量（絶対量） |

第 2-5 節の平坦化により `measurement.outOfFieldByEdge.left` 等として CSV に出る。

### 3-4. `outsideCorridorCells` の位置づけ変更

注入も移送も回廊内に閉じているため、この値は原理的に常に 0 である。  
観測ではなく不変条件として扱い、0 以外なら例外を投げること。  
報告では「全構成で 0」とだけ書けばよい。

### 3-5. `measure` 無影響

3-1 〜 3-4 はすべて `measure` 専用であり、`stateHash` に影響しないこと。  
既存の「measure 無影響テスト」で確認すること。

---

## 4. 実装の修正

### 4-1. 既定経路のハッシュテスト

`test/core.test.js` の恒久テストは `config: { corridorWidth: 128 }` を明示指定している。本 Issue 2-3 の要求は「既定値のとき現行と同一挙動」であり、既定経路（`corridorWidth` を渡さない）が検証されていない。  
`corridorWidth` を指定しないケースを追加すること。9 ハッシュとも一致させる。

### 4-2. `DEFAULT_CONFIG.corridorWidth` の重複

`DEFAULT_CONFIG.corridorWidth = 128` は `createConfig` の `config.width + config.height` 代入で必ず上書きされ、デッドコードになっている。  
どちらか一方に寄せること。既定の実効値（`= width + height`）は変えないこと。

### 4-3. `integerKeys.slice(2, -1)`

Q16.16 範囲検査の対象を配列末尾からの相対位置で決めており、今後キーを追加すると静かに壊れる。除外キーを名前で指定する形に変えること。

### 4-4. `runtime-hashes.json`

`ENGINE_VERSION` を 0.10.0 に上げた一方で記録が無く、`node scripts/check-runtime-hashes.js` が現在 exit 1 で落ちる。

```text
engineVersion 0.10.0 / scenarioId poc-0-default のハッシュ記録がありません。
```

3 シナリオ分を記録すること。Node 20 と Node 22 の両方で一致を確認すること。

  

### 4-5. Step 9 CSV の再生成

再生成すると `engineVersion` 列が 0.10.0 になり、Step 9 報告の記録と食い違う。元ファイルを上書きせず、`docs/reports/data/step-09-sweep-regen-0.10.0.csv` として別ファイルに置き、その旨を報告に明記すること。

  

## 5. 後方互換の検証

`corridorWidth` 未指定（既定）で、3 シナリオ × 3 入力の 9 ハッシュすべてが 0.9.0 と一致すること。 `test/core.test.js` に恒久テストとして追加する。

  

**期待値:**

  

|**シナリオ**|**straight**|**distributed**|**detour**|
|---|---|---|---|
|`poc-0-default`|`4910305d`|`e63ba5b1`|`9164f600`|
|`poc-1-wide`|`f7606aa8`|`97a13950`|`13073731`|
|`poc-2-canyon`|`e3ddaebc`|`6e03aff9`|`ae3a98ad`|

一致しなければ停止して報告すること。定数で辻褄を合わせないこと。

  

## 6. 掃引

### 6-1. 旧版（rev.1）の格子を破棄する理由

rev.1 の格子は $\text{corridorWidth} \in \{2, 4, 8\} \times \text{restoreWeight} \in \{0, Q/16\}$ だった。

  

レビュー側で distributed の 48 点を先行実行した結果、以下が判明した。

  

**(a) `restoreWeight = Q/16` では回廊が完全に無効。**

  

|**corridorWidth**|**変化幅 (congestionWeight = 0 / Q)**|
|---|---|
|2|0.12pt / 0.17pt|
|4|0.12pt / 0.17pt|
|8|0.12pt / 0.17pt|

Step 9 の値と小数第 2 位まで一致する。復元力が残る限り材料が線を離れないため、回廊制約が一度も発動しない。旧格子は 24 点を同一値の再生産に費やす。

  

**(b) 格子外の `corridorWidth = 1` が、現時点で唯一「漏れず・太らず・自己調整する」点。**

  

|**構成**|**変化幅**|**outOfFieldRatio**|**completionRatio**|**occupiedCellsPeak**|**coherenceLength**|
|---|---|---|---|---|---|
|cw=1, rw=0|10.93pt|0%|87%|798|63|
|cw=2, rw=0|14.29pt|0%|83%|1,044|63|
|cw=3, rw=0|18.68pt|22%|59%|1,260|49|
|cw=4, rw=0|22.49pt|26%|—|1,460|15|
|cw=8, rw=0|35.11pt|36%|—|2,175|8|

**(c) 場外損失の閾値は `corridorWidth = 3` にある。**

  

場の境界セルのうち回廊内に入る数は、w=1: 0、w=2: 0、w=3: 13、w=4: 18、w=8: 36（distributed）。

  

これらの数値は掃引で独立に再現すること。一致しない場合は一致しないまま報告すること。レビュー側の値に合わせて定数を調整しないこと。

  

### 6-2. 新しい格子（掃引モード A、48 点）

- **主格子（40点）**
    
      
    - `corridorWidth`: 1, 2, 3, 4, 8
        
          
        
    - `restoreWeight`: 0
        
          
        
    - `congestionWeight`: 0, Q
        
          
        
    - `gapWidth`: 1, 3, 9, 63
        
          
        
- **対照群（8点）**
    
      
    - `corridorWidth`: 2
        
          
        
    - `restoreWeight`: Q/16
        
          
        
    - `congestionWeight`: 0, Q
        
          
        
    - `gapWidth`: 1, 3, 9, 63
        
          
        
- **共通**
    
      
    - `congestionReference`: 2048（固定）
        
          
        
    - `edgeFluxMax`: 512（固定）
        
          
        
    - `入力`: straight / distributed / detour（各点で3入力とも走らせる）
        
          
        

出力先は `docs/reports/data/step-10-sweep.csv`。

  

対照群は「回廊が復元力を置き換えるか」の根拠として残す。`restoreWeight` を主格子から外したのは、変化幅が `corridorWidth` に依存しないことが確認されたためであり、`restoreWeight` を削除・変更する決定ではない。

  

### 6-3. 密度場スナップショットの commit（新規・必須）

掃引 CSV にはスカラーしか残らないため、絵の判断材料が残らない。

  

最終密度場を数値のまま commit すること。

  

- **出力先**: `docs/reports/data/step-10-density/`
    
      
    
- **形式**: 64 行 × 64 列の整数 CSV（ヘッダなし、`density[y * 64 + x]` を行優先）
    
      
    
- **ファイル名**: `{input}-cw{corridorWidth}-rw{restoreWeight}-g{gapWidth}.csv`
    
      
    
- **対象（12 ファイル）**:
    
      
    - `input = distributed`, `congestionWeight = 0`, `congestionReference = 2048`, `edgeFluxMax = 512`
        
          
        
    - `corridorWidth` 1, 2, 3, 4, 8 × `restoreWeight` 0 × `gapWidth` 1, 63 … 10 ファイル
        
          
        
    - `corridorWidth` 2 × `restoreWeight` Q/16 × `gapWidth` 1, 63 … 2 ファイル
        
          
        

画像化はしないこと。 描画スタックは未決定であり、本 Step のスコープ外である。数値のまま出せばよい。

  

## 7. 報告すべき観測（docs/reports/step-10.md）

解釈・推奨・判定・順位付けは不要である。事実のみを記載すること。

  

### 7-1. 主観測

- 各 (`corridorWidth`, `restoreWeight`, `congestionWeight`) について、distributed の中央ルート比率を g = 1 / 3 / 9 / 63 で算出し、その変化幅を出すこと
    
      
    
- 同じ表を straight / detour についても出すこと。構造上 100% / 0% で固定されるなら、固定されたという事実をそのまま書くこと
    
      
    
- 比較対象: `restoreWeight = 0`（回廊なし）で 30.4pt、Step 9 の最良で 0.2pt。
    
      
    

### 7-2. 副観測（全点、3 入力それぞれ）

- `outOfFieldRatio` と `outOfFieldByEdge` の内訳
    
      
    
- `remainingRatio`、`completionRatio`
    
      
    
- `corridorEdgeDensityMax` / `Mean` / `Peak` とその座標・ステップ
    
      
    
- `densityMaxExSourceCell`（詰まりの位置が壁の手前か、回廊の縁か）
    
      
    
- `occupiedCellsPeak`（ビームがどれだけ太ったか。回廊幅との対応）
    
      
    
- `coherenceLength`
    
      
    
- `outsideCorridorCells`（全点 0 であること）
    
      
    

### 7-3. 保存則

`completed + outOfField + remaining = injected` が全構成で成立すること。

  

## 8. 完了条件

- [ ] 第 6-2 節の格子で 48 点、`docs/reports/data/step-10-sweep.csv`
    
      
    
- [ ] 第 6-3 節の密度 CSV 12 ファイル
    
      
    
- [ ] 第 3 節の計測追加、第 4 節の実装修正
    
      
    
- [ ] `corridorWidth` 未指定で 0.9.0 の 9 ハッシュと一致（恒久テスト）
    
      
    
- [ ] `runtime-hashes.json` に 0.10.0 を 3 シナリオ分記録。Node 20 で一致（Node 22 は CI）
    
      
    
- [ ] 保存則が全構成で成立
    
      
    
- [ ] 第 4-5 節の Step 9 CSV 再生成（別ファイル）
    
      
    
- [ ] `npm run verify` PASS、measure 無影響テスト PASS
    
      
    
- [ ] `docs/reports/step-10.md` に第 7 節の観測
    
      
    
- [ ] `docs/DECISIONS.md` の更新（第 9 節）
    
      
    
- [ ] 本文書で `docs/issues/step-10.md` を上書き
    
      
    
- [ ] PR 本文に `Closes #14`、`needs-human:decision` を付与、マージせず停止
    
      
    
- [ ] push すること。 `git ls-remote --heads origin` の出力を報告に含めること
    
      
    

## 9. docs/DECISIONS.md の更新（必須）

### 9-1. 「撤回・棄却された主張」へ追加

|**主張**|**撤回理由**|
|---|---|
|Claude の「バックプレッシャーはセル単位で上流へ伝播し、分岐点まで届くので大域最短路（下流ポテンシャル）は不要」|実測で否定。壁の手前の密度は g=63→1 で 652→1,360 と倍増するのに、分岐付近 (6,32) は 1,196 / 1,220 でまったく反応しない。復元力が材料を線に貼り付けているため、渋滞が伸びる先がない|
|外部案「復元力の直交分離」|guide と restore が同時に非ゼロのセルは 0 個。直交化すべき重なりが存在せず no-op|
|外部案「通気度 $C = 1 - \rho / \text{capacity}$」をそのまま使うこと|混雑ピークでも密度は capacity の 1.82%。基準密度を別途持たなければ機能しない|
|外部案「線をレーングラフ化して分岐で配分」|詰まりがレーンごとのスカラー値になり、壁の手前で帯が膨らむ空間的な絵が描けなくなる。格子流体であること自体が観賞価値の源泉のため不採用|
|Step 10 Issue rev.1 第7節「`outOfFieldRatio` は 0% のまま保たれるはず」|外れ。回廊が場の境界に届くと材料は流出する。掃引の実測値を記載すること|
|Claude の「回廊幅を小さく取ればビームの太りは緩和できる」を両立の根拠として使うこと|緩和自体は起きるが、場外損失の可否は回廊幅ではなく線と場の縁との距離という配置依存の幾何で決まる。他レイアウトへ持ち越せない|

### 9-2. 「有効な決定」へ追加

|**決定**|**理由**|
|---|---|
|通気度（Step 9）は残す|自己調整は戻らなかったが、中央ルート比率の絶対値を 28.0% → 33.6% と動かし、完了率・場外損失を悪化させない|
|漏れ防止は「力」ではなく「幾何制約」で担う|復元力は漏れと自己調整の両方を同時に止める。制約なら経路選択の自由度を奪わない|
|回廊制約は `restoreWeight = 0` のときのみ機能する|復元力が非ゼロだと材料が線を離れず、回廊が発動しない。掃引で全 `corridorWidth` が同一値になることを確認|
|密度場スナップショットを掃引成果物として commit する|掃引 CSV はスカラーのみで、絵の判断材料が残らない。「見て面白いか」を後から検証できるようにする|

### 9-3. 「保留中の判断」の更新

- `corridorWidth` の既定値（掃引結果を見て別 Issue で決定）
    
      
    
- `restoreWeight` の既定値（回廊採用時は 0 が前提になるが、Step 8 の撤回に相当するため別 Issue）
    
      
    
- 回廊の縁の扱い（堆積が人工物になっている場合、吸収へ変える等）
    
      
    
- 中央ルート比率という指標の妥当性（straight / detour では構造上定数）
    
      
    
- 「下流混雑ポテンシャル（大域最短路）の導入」：局所伝播が届かないことが実証されたため必要性が上がった。Step 10 で不足の場合の次案
    
      
    
- 「非線形圧力（Anti-C）」：通気度と同じ土俵。優先度は下
    
      
    
- `congestionWeight` / `congestionReference` の既定値決定は引き続き保留
    
      
    

## 10. 想定される結果

- `corridorWidth` を上げるほど変化幅は増え、同時に `occupiedCellsPeak` が増え、`coherenceLength` が落ちると予想する
    
      
    
- `outOfFieldRatio` は `corridorWidth` のある値を境に 0% から跳ね上がると予想する
    
      
    
- `corridorEdgeDensityPeak` は `corridorEdgeDensityMax`（最終状態）より大きくなると予想する
    
      
    
- `densityMaxExSourceCell` が壁の手前ではなく回廊の縁を指す構成があると予想する
    
      
    
- `restoreWeight = Q/16` の対照群は、`corridorWidth` によらず Step 9 と同じ 0.1 〜 0.2pt に留まると予想する
    
      
    

いずれも外れて構わない。外れた場合に定数で辻褄を合わせないこと。

  

未達は未達のまま報告すること。基準を通す値を探すのが目的ではない。

  

依存関係の記録が目的である。

  

## 11. スコープ外

- `restoreWeight` の削除、および既定値の変更
    
      
    
- `capacity` / `reverseThreshold` / `congestionReference` の変更
    
      
    
- 既定値の決定（掃引の結果を見て別途起票する）
    
      
    
- 密度場の画像化・描画スタックの選定
    
      
    
- 下流混雑ポテンシャル、非線形圧力（いずれも保留）
    
      
    
- 基準閾値・基準 4 の指標セット変更
    
      
    
- 回廊の縁の扱いの変更（本 Step は観測のみ）
    
      
    
- テーマ・描画・演出
