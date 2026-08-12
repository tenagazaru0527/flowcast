# Step 19-a: CI を分割し、タイムアウトを延長する

## 0. 位置づけ

Step 19（PR #33）の CI が **Node 20 ジョブの 10分タイムアウトで cancel** された。

- Core tests 自体は **PASS**（27件、437秒）
- 既存9ハッシュも全一致
- **落ちたのはジョブ全体の所要時間のみ**（10分15秒）

これはテストの不具合ではない。**構造的な問題である。**

### 経緯

| Step | Node 20 の最長ジョブ |
|---|---|
| 16 | 9分45秒 |
| 17 | 9分41秒（上限まで19秒） |
| 19 | **10分15秒（超過）** |

Step 17 の時点で余裕は19秒しかなく、保留項目として記録されていた。
**Step が進むたびにハッシュ回帰テストが1件ずつ増える構造**であり、再実行しても
次の追加で必ず再発する。

### 実行時間の内訳（レビュー側で実測）

| テスト | 所要 |
|---|---:|
| `preserve every 0.11.0 scenario hash`（ハッシュ回帰群） | **177 秒** |
| `quantity is conserved for every edge flux sweep point and input` | **138 秒** |
| `measurement instrumentation does not affect simulation results` | 5.7 秒 |
| その他 24 件 | 合計で数秒 |

**2系統で 315 秒（全体の 72%）を占めている。** 残り25件は合計で数秒しかかからない。

**したがって、この2系統を切り出すだけで実時間が大きく下がる。**

engineVersion: **0.11.0 のまま（変更しない）**

前提: `origin/main` が Step 18 マージ済みであること。
**`step/19` ブランチは残しておくこと。本 Step の後で再度 CI を通す。**

---

## 1. スコープの原則

- 変更するのは `.github/workflows/ci.yml`、`test/` のファイル構成、`package.json`
  の scripts、`docs/`
- **テストを削除・スキップしないこと。** 分割のみとする
- **テストの内容を変更しないこと。** ファイル間の移動のみとする
- `src/` / `scripts/` / `runtime-hashes.json` / `game/` / `debug/` を変更しないこと
- 外部ライブラリを追加しないこと

---

## 2. 実装内容

### 2-1. `test/core.test.js` を3ファイルに分割する

**テストの内容は一切変更せず、移動のみとすること。**

| 新ファイル | 内容 | 想定所要 |
|---|---|---|
| `test/core.test.js` | 下記2つに該当しないもの（24件程度） | 10秒未満 |
| `test/hashes.test.js` | **バージョン間のハッシュ回帰テスト**（`preserve every X.Y.Z scenario hash` 系、および `preserve 0.5.0 hashes` / `preserve poc-0-default hashes` / `preserve the new poc-1-wide default hashes` 系） | 180秒程度 |
| `test/conservation.test.js` | `quantity is conserved for every edge flux sweep point and input` | 140秒程度 |

- 共通のヘルパーや定数が必要な場合は `test/helpers.js` 等に切り出してよい。
  **その場合もテストの内容は変えないこと**
- **移動前後でテストの総数が一致すること**を報告に明記すること（現在27件）

### 2-2. CI をジョブ分割する

`.github/workflows/ci.yml` を変更する。

```text
job: core          → node --test test/core.test.js
                     + acceptance report + forbidden APIs + runtime hashes
job: hashes        → node --test test/hashes.test.js
job: conservation  → node --test test/conservation.test.js
job: sweep         → node --test test/sweep.test.js
```

- **Node 20 / 22 のマトリクスは維持すること。** 決定論の検証はこのマトリクスに
  依存している（DECISIONS 第2-3節）
- 各ジョブは並列に走ること。GitHub Actions の無料枠は並列20ジョブであり、
  4ジョブ × 2 Node = 8ジョブでも収まる
- **`fail-fast: false` を維持すること。** 1つが落ちても他の結果を見たい

### 2-3. タイムアウトを延長する

- **`timeout-minutes: 10` → `15`**
- 分割により各ジョブは3分程度になる見込みだが、**分割だけに頼らないこと。**
  今後テストが増えたときの余裕として持つ

### 2-4. `package.json` の scripts を更新する

現在の `verify` が `test/core.test.js` のみを走らせている場合、
**分割後の全テストを走らせるように更新すること。**

- `npm run verify` で従来と同じ範囲が検証されること
- ローカルで個別に走らせられるよう、`test:hashes` / `test:conservation` のような
  scripts を追加してもよい

---

## 3. 検証

- **移動前後でテストの総数が一致すること**（現在27件 + sweep 3件）
- **`npm run verify` が PASS すること**
- **既存9ハッシュが全一致すること**
- `src/` / `scripts/` / `runtime-hashes.json` / `game/` / `debug/` に変更が無いこと。
  `git diff --stat origin/main..step/19-a -- src scripts runtime-hashes.json game debug` の
  出力が空であることを報告に貼ること
- **各テストファイルの内容が、移動前と論理的に同一であること。**
  テスト名の一覧を移動前後で比較し、過不足が無いことを報告すること

---

## 4. 掃引

**実施しない。**

---

## 5. 報告すべき内容（`docs/reports/step-19a.md`）

**解釈・推奨・順位付けは不要である。事実のみを記載すること。**

- 分割後の各テストファイルのテスト件数と、移動前後の合計の比較
- **移動前後のテスト名の一覧**（過不足が無いことを示すため）
- **CI の各ジョブの所要時間**（Node 20 / 22 それぞれ、全ジョブ）
- ローカルでの各テストファイルの所要時間
- `npm run verify` の結果
- 第3節の差分確認の出力
- **既知の制限**

---

## 6. 完了条件

- 第2節の 2-1 〜 2-4 を実装
- 第3節の検証をすべて満たす
- **CI が全ジョブ PASS すること**
- `docs/reports/step-19a.md` に第5節の内容
- `docs/LOOP.md` のテスト構成の説明を実態に合わせて更新
- `docs/DECISIONS.md` の更新（第8節）
- 本文書を `docs/issues/step-19a.md` としてコミット
- PR 本文に `Closes #<本Issue番号>`、**マージせず停止**
- **push すること。** 最終コミット後に `git ls-remote --heads origin` を実行し、
  その出力を報告に含めること

---

## 7. 想定される結果

- 分割後、最も長いジョブは `hashes`（180秒程度）になると予想する
- CI 全体の実時間（並列のため最長ジョブに律速）は 4〜5分程度になると予想する
- テストの総数は分割前後で変わらないと予想する

**いずれも外れて構わない。外れた場合にテストを削って辻褄を合わせないこと。
特に、時間短縮のためにテストをスキップしたり、シナリオ数を減らしたりしないこと。**

---

## 8. `docs/DECISIONS.md` の更新（必須）

### 8-1. 第2節「有効な決定」へ追加

| 決定 | 理由 |
|---|---|
| CI をテストの種類ごとにジョブ分割する | Step 8 以降、ハッシュ回帰テストが1 Step ごとに1件ずつ増える構造であり、Step 17 で余裕19秒、Step 19 で超過した。実測ではハッシュ回帰群177秒・保存則138秒の2系統で全体437秒の72%を占め、残り25件は合計数秒だった |
| CI のタイムアウトを 10 分から 15 分へ延長する | 分割だけに頼ると、次にテストが増えたときに同じことが起きる。分割と延長の両方を行う |
| Node 20 / 22 のマトリクスは維持する | 決定論の検証がこのマトリクスに依存している（第2-3節） |
| テストは削除・スキップせず、分割のみとする | 時間短縮のためにテストを減らすと、決定論の検証範囲が狭まる |

### 8-2. 第4節「保留中の判断」の更新

- **「CI 実行時間の分割方法」は本 Step で解決したため、保留から外すこと**
- 他の保留項目はそのまま残すこと

---

## 9. スコープ外

- テストの削除・スキップ・内容変更
- `src/` / `scripts/` / `runtime-hashes.json` / `game/` / `debug/` の変更
- モデルの定式化、既定値、受け入れ基準、閾値、engineVersion の変更
- Step 19 の密度スナップショット実装（`step/19` ブランチで停止中。本 Step とは別）
- パラメータ掃引
- 外部ライブラリの追加、ビルド手順の追加
- テーマ・世界観・製品名

---

## 10. 本 Step 完了後の手順（人間側）

1. 本 PR を `main` にマージする
2. `step/19` に `main` を取り込む（rebase または merge）
3. `step/19` の CI が通ることを確認する
4. Step 19 のレビューへ進む
