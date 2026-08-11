# Step 15 完了報告

## 実装項目

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 | 実装 | `sampleInterval`（既定0、整数、`0..steps`）を追加 |
| 2-2 | 実装 | measure専用の `result.measurements.timeline` を追加。正の間隔と最終stepで標本化 |
| 2-3 | 実装 | 掃引は既定0を維持し、timelineを掃引CSVから明示的に除外 |
| 2-4 | 実装 | ビューアへ入力欄、表、区間通過量/step、timeline CSVダウンロードを追加。グラフは未実装 |

engineVersionは`0.11.0`のまま、既定値・受け入れ基準・閾値は変更していない。掃引は実施していない。

## ハッシュ一致

`measure=true`で確認した。未指定では`config`へ`sampleInterval`を入れていない。

| sampleInterval | poc-0-default 3入力 | poc-1-wide 3入力 | poc-2-canyon 3入力 | 合計 |
|---:|---:|---:|---:|---:|
| 未指定 | 3/3一致 | 3/3一致 | 3/3一致 | 9/9一致 |
| 1 | 3/3一致 | 3/3一致 | 3/3一致 | 9/9一致 |
| 50 | 3/3一致 | 3/3一致 | 3/3一致 | 9/9一致 |
| 100 | 3/3一致 | 3/3一致 | 3/3一致 | 9/9一致 |

36件すべて0.11.0の記録値と一致した。既存のmeasure無影響テストでも`measure=true`と`false`のハッシュが一致した。

## 指定単発実行

条件はIssue第4節の指定どおり。`docs/reports/data/step-15-timeline.csv`へ36標本を記録した。
区間通過量/stepは、当該標本と直前標本（最初の標本ではstep 0、累積0）の
`gapThroughput.central`差分を区間step数で割った利用側の計算値である。

| step | completed（累積） | remaining（瞬時） | central（累積） | central区間量/step | blockedFrontDensityMax（瞬時） | densityMaxExSource（瞬時） | occupiedCells（瞬時） |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0 | 102,400 | 1,392 | 13.9 | 454 | 2,039 | 95 |
| 400 | 92,451 | 317,149 | 149,450 | 512.0 | 18,988 | 21,177 | 424 |
| 1,000 | 399,027 | 624,973 | 456,650 | 512.0 | 31,549 | 31,549 | 449 |
| 2,000 | 911,011 | 1,136,989 | 968,650 | 512.0 | 40,063 | 40,063 | 449 |
| 3,600 | 1,730,200 | 1,956,200 | 1,787,850 | 512.0 | 51,512 | 51,512 | 450 |

`outOfField`と`gapThroughput.detour`は全標本で0だった。

### Issue第0節との照合

- step 100は`blockedFrontDensityMax=454`、区間量`13.9`で一致した。
- step 400 / 1,000は滞留最大と区間量が一致した。
- step 2,000は40,063で、レビュー値40,365との差は-302。区間量は512.0で一致した。
- レビュー値step 3,550の51,213は、本実行のstep 3,500の50,876とstep 3,600の51,512の間にある。区間量はどちらも512.0だった。

以上より、指定された`blockedFrontDensityMax`と区間通過量は近い値になった。値を合わせるための刻み・定数変更はしていない。

## 実行時間

Node v20.20.2で各設定を3回実行した中央値。同じ指定単発条件、`steps=3600`。

| sampleInterval | 中央値 | sampleInterval=0比 |
|---:|---:|---:|
| 0 | 2,216.5 ms | — |
| 100 | 2,267.2 ms | +2.3% |
| 1 | 2,510.1 ms | +13.2% |

## 累積値と瞬時値

- 累積値: `completed`、`outOfField`、`gapThroughput`
- 瞬時値: `remaining`、`blockedFrontDensityMax`、`densityMaxExSource`、`occupiedCells`
- エンジンは区間量・変化率・判定を返さない。ビューアだけが累積`gapThroughput`の差分から区間量/stepを算出する。

## ブラウザ

- Google Chrome 149.0.7827.200
- 指定条件をChromeで実行し、36標本の表、step 100の区間量13.9、step 400 / 3,600の区間量512.0を確認した。
- ビューアから`flowcast-timeline-poc-2-canyon.csv`をダウンロードし、ヘッダーを含む37行を確認した。

## 検証コマンド

- `npm run verify`: PASS（禁止API、既存9ハッシュ、coreテスト）
- 4条件 × 3シナリオ × 3入力の独立ハッシュ確認: 36/36 PASS
- `node --test test/sweep.test.js`: PASS
- `npm run test:browsers`: ChromeのハッシュはNodeと一致。Firefox未導入のためコマンド全体は終了コード1
- Chrome 149によるtimeline UI実操作: PASS

## 既知の制限

- timelineは`measure=true`かつ`sampleInterval>0`のときだけ生成される。
- ビューアは表とCSVのみで、グラフを描画しない。
- シンクごとの到達量・到達時刻を区別しない。
- 区間量・変化率・成功判定はエンジン側で計算しない。
- `sampleInterval=1`は標本3,600件を保持し、本計測では既定0より13.2%遅かった。
