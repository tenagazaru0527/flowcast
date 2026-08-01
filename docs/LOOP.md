# 開発ループ（flowcast PoC）

## 1周の手順

1. 指示を受ける（スコープ・禁止事項・完了条件・想定結果が明記されている）
2. 実装する
3. `npm run verify` を実行する
4. `npm run report` を実行する
5. 固定フォーマットで報告する
6. 承認を待つ ← ここで必ず停止する
7. コミット・push・CI確認

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

## 経緯（要点のみ）

- 0.1.0: 決定論的なシミュレーション核と初期測定を実装した。
- 0.2.0: 線の焼き込みを双線形按分へ変更し、測定指標を整備した。基準2は 2/10 だった。
- 0.3.0: guide クランプを成分別からベクトル長へ変更し、方向異方性を除去した。基準2は 6/10 に改善した。
