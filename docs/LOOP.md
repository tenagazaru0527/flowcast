# 開発ループ（flowcast PoC）

## 1周の手順

1. `docs/DECISIONS.md` を全文読み、撤回済み・保留中の判断を確認する
2. 指示を受ける（スコープ・禁止事項・完了条件・想定結果が明記されている）
3. `step/NN` ブランチを作成する
4. 実装する
5. `npm run verify` と必要な測定を実行する
6. 固定フォーマットの報告と掃引CSVを `docs/reports/` に置く
7. 報告時に `docs/DECISIONS.md` の該当行を更新する。保留中の判断が決着したら
   「有効な決定」または「撤回・棄却された主張」へ移す
8. commit・pushし、`step/NN` から `main` へのPRを作成する
9. 下記の確認不要条件を満たさない限り、マージせずレビューを待つ

## GitHub 運用

- `main` へ直接コミットせず、`step/NN`（例: `step/035`）で作業する
- 報告はチャットやPR本文ではなく `docs/reports/step-NN.md` にcommitする
- 掃引CSVは `docs/reports/data/step-NN-sweep.csv` に置く。JSONLはcommitしない
- CSVが1MBを超える場合は要約版を置き、報告に明記する
- PR本文は `docs/reports/step-NN.md` へのリンクだけにする
- PR作成後はマージせず停止し、レビュー結果を待つ

CI通過後、確認不要でマージできる変更は次のとおり。

- 事前に承認済みのStepの実装
- ハッシュ不変が証明できる計装追加・最適化・可視化
- 掃引の実行と結果の記録
- `src/**` に差分がない変更
- ドキュメント・テストのみの変更

次の変更はPR作成後に必ず停止し、確認を得る。

- 基準の定義・閾値の変更
- モデルの定式化の変更（移送規則・境界条件・場の構造）
- `src/config.js` の既定値の変更
- 工程の順序変更、Stepの追加・スキップ
- テーマ・製品名・描画スタックの決定
- 想定と実測が大きく食い違った場合
- 指示に誤りや矛盾があると判断した場合

## 即時停止条件（実装せず報告する）

- 指示が現行コードの構造と矛盾する
- 指示されたコードに誤りがある
- 指示のスコープ外のファイルに触れる必要がある
- ハッシュが変わったが engineVersion の更新指示がない
- 基準を通すために定数を変えたくなった
- 想定結果と実測が大きく食い違う

## 不変条件（毎周チェックする）

- engineVersion を上げたら同一コミットで `runtime-hashes.json` に記録する
- `measure=true` と `measure=false` でハッシュが一致する
- `src/` に禁止APIがない
- 基準の閾値を変更しない
- 未達は未達のまま報告する
- 掃引は判定を行わない（記録のみ）

## 固定報告フォーマット

```markdown
## Step N 完了報告
- engineVersion:
- ハッシュ確認:

### 基準判定
| 基準 | 結果 | 前ステップからの変化 |
|---|---|---|

### 主要計測値
| 入力 | completionRatio | densityMaxExSource | densityMax(source平衡値) | occupiedPeak | maxStagnation | backflow | completionStep(参考) |
|---|---:|---:|---:|---:|---:|---:|---:|

### 修正前後の比較
| 入力 | completionRatio 前 | 後 | densityMaxExSource 前 | 後 | occupiedPeak 前 | 後 |
|---|---:|---:|---:|---:|---:|---:|

### guideMagnitudeMax
- 修正前:
- 修正後:

### 検証ゲート
- npm run verify:
- npm run report:
- git diff --check:

### 変更ファイル
- ファイル名: 変更内容

### 残リスク・判断を仰ぎたい点
```

## 掃引ハーネス

`scripts/sweep.js` は実行と記録だけを行い、合否判定・順位付け・推奨を行わない。
出力は `sweep-out/results.jsonl` と `sweep-out/results.csv` で、格子順、入力順に固定される。

```bash
node scripts/sweep.js --param capacity --values 65536,131072,262144 --inputs all
node scripts/sweep.js --grid grid.json --workers 8
node --test test/sweep.test.js
```

多次元格子は、配列形式、`{ "points": [...] }`、または次の直積形式を受け付ける。

```json
{
  "parameters": [
    { "name": "capacity", "values": [65536, 131072] },
    { "name": "steps", "values": [1800, 3600] }
  ]
}
```

## 密度デバッグビューア

`debug/` は製品描画ではなく、`runSimulation` の出力を読む診断専用Canvasビューアである。
リポジトリ直下でHTTPサーバーを起動し、ブラウザーから開く。ビルドは不要。

```bash
python3 -m http.server 8000
```

```text
http://localhost:8000/debug/
```

スライダーは50step刻みで、任意step欄は1step単位で指定できる。中間状態は指定された
step数でシミュレーションを再実行して取得し、入力・step・パラメータの組み合わせごとに
ブラウザー内でキャッシュする。

## 経緯（要点のみ）

- 0.1.0: 決定論的なシミュレーション核と初期測定を実装した。
- 0.2.0: 線の焼き込みを双線形按分へ変更し、測定指標を整備した。基準2は 2/10 だった。
- 0.3.0: guide クランプを成分別からベクトル長へ変更し、方向異方性を除去した。基準2は 6/10 に改善した。
- 0.4.0: 辺ごとの `edgeFluxMax` と流量制限の診断計測を導入した。
