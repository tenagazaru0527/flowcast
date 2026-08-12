# Step 19-a 完了報告

- engineVersion: `0.11.0`（変更なし）
- 掃引: 実施なし

## テスト分割

| ファイル | 分割前 | 分割後 |
|---|---:|---:|
| `test/core.test.js` | 26 | 17 |
| `test/hashes.test.js` | 0 | 8 |
| `test/conservation.test.js` | 0 | 1 |
| 合計 | 26 | 26 |
| `test/sweep.test.js`（分割対象外） | 3 | 3 |

`origin/main`（Step 18）の `test/core.test.js` にある各 `test(...)` ブロックと、
分割後3ファイルのブロックをテスト名で対応付けて文字列比較した。

```json
{"before":26,"after":26,"changed":[],"missing":[],"extra":[]}
```

## 移動前後のテスト名

| # | 移動前 | 移動後 |
|---:|---|---|
| 1 | Q16.16 multiplication and division truncate toward zero | `core.test.js` 同名 |
| 2 | xorshift32 is repeatable and has a single 32-bit state | `core.test.js` 同名 |
| 3 | FNV-1a hashes Int32 values in explicit little-endian byte order | `core.test.js` 同名 |
| 4 | isqrt returns the exact floor square root without 32-bit coercion | `core.test.js` 同名 |
| 5 | clampVector applies one symmetric magnitude limit | `core.test.js` 同名 |
| 6 | line burning emits bounded Int32 guide arrays | `core.test.js` 同名 |
| 7 | restore field uses fixed descent ties and avoids blocked cells | `core.test.js` 同名 |
| 8 | restoreWeight zero preserves every 0.7.0 scenario hash | `hashes.test.js` 同名 |
| 9 | congestionWeight zero preserves every 0.8.0 scenario hash | `hashes.test.js` 同名 |
| 10 | default unlimited corridor preserves every 0.9.0 scenario hash | `hashes.test.js` 同名 |
| 11 | unspecified corridorBlocksOutOfField preserves every 0.10.0 scenario hash | `hashes.test.js` 同名 |
| 12 | sampleInterval and line distance measurements preserve every 0.11.0 scenario hash | `hashes.test.js` 同名 |
| 13 | timeline records cumulative and instantaneous measurements at intervals and the final step | `core.test.js` 同名 |
| 14 | sinkGroups must partition sink cells with unique names and cells | `core.test.js` 同名 |
| 15 | default edge flux limit is at least the current theoretical transfer budget | `core.test.js` 同名 |
| 16 | replay data contains only the five portable input fields | `core.test.js` 同名 |
| 17 | measurement instrumentation does not affect simulation results | `core.test.js` 同名 |
| 18 | corridorBlocksOutOfField is boolean and structurally prevents exterior transfer | `core.test.js` 同名 |
| 19 | single-cell source and sink arrays preserve 0.5.0 hashes | `hashes.test.js` 同名 |
| 20 | poc-1-wide source width 1 and sink width 1 preserve poc-0-default hashes | `hashes.test.js` 同名 |
| 21 | an empty obstacle mask preserves the new poc-1-wide default hashes | `hashes.test.js` 同名 |
| 22 | canyon obstacles stay empty and quantity conservation remains valid | `core.test.js` 同名 |
| 23 | source injection is divided in scenario order without changing the total | `core.test.js` 同名 |
| 24 | empty sigma columns remain undefined | `core.test.js` 同名 |
| 25 | edge flux diagnostics count only measurement-side suppression | `core.test.js` 同名 |
| 26 | quantity is conserved for every edge flux sweep point and input | `conservation.test.js` 同名 |

過不足はない。

## ローカル確認（Node 20.20.2）

| コマンド | 結果 | 実時間 |
|---|---|---:|
| `npm run test:core` | PASS（17件） | 10.99秒 |
| `npm run test:hashes` | PASS（8件） | 224.09秒 |
| `npm run test:conservation` | PASS（1件） | 94.84秒 |
| `npm run test:sweep` | PASS（3件） | 18.74秒 |
| `npm run verify` | PASS | 349.83秒 |

`npm run verify` では禁止APIなし、runtime hash 9件すべてMATCH、分割後の
core由来26テストすべてPASSを確認した。

## CI 所要時間

PR作成後に Node 20 / 22 の全8ジョブを記録する。

## 保護対象の差分

実装コミット後に次を実行して記録する。

```text
git diff --stat origin/main..step/19-a -- src scripts runtime-hashes.json game debug
```

## push確認

push後に `git ls-remote --heads origin` の出力を記録する。

## 既知の制限

- Issue本文の「現在27件」は Step 19 の追加1件を含む。前提のStep 18 `origin/main` は
  core 26件 + sweep 3件であり、本Stepではその26件を内容変更なしで分割した。
- ローカル確認は Node 20.20.2。Node 22 は CI で確認する。
- `node --test <file>` のローカルTAP出力はファイル単位に集約されるため、論理件数は
  直接実行のTAPとソース上のテスト名照合で確認した。
