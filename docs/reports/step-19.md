# Step 19 完了報告

## 実装項目

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 | 実装 | `sampleDensity`を真偽値、既定`false`として追加。`sampleInterval=0`または`measure=false`では記録しない |
| 2-2 | 実装 | `ceil(steps / sampleInterval)`を実行前に算出し、200を超える場合に標本数と上限を含む例外を送出 |
| 2-3 | 実装 | 各標本に全セルの独立した`Int32Array`コピーを追加。無効時はキー不在 |
| 2-4 | 対応不要を確認 | `timeline`は既存のCSV除外対象であり、列構成は不変 |
| 2-5 | 対応不要を確認 | `scripts/sweep.js`は変更せず、`sampleDensity`を渡さない |

engineVersion、既定値、受け入れ基準、閾値は変更していない。掃引は実施していない。`game/`と`debug/`は変更していない。

## 後方互換と密度標本

### stateHash

`sampleDensity`未指定では`npm run verify`の既存9件、`sampleDensity=true`・`sampleInterval=100`では恒久テストの9件を確認した。

| シナリオ | straight | distributed | detour |
|---|---|---|---|
| poc-0-default | `4910305d` | `e63ba5b1` | `9164f600` |
| poc-1-wide | `f7606aa8` | `97a13950` | `13073731` |
| poc-2-canyon | `e3ddaebc` | `6e03aff9` | `ae3a98ad` |

両条件とも9/9件が0.11.0の記録と一致した。既存の`measure=true` / `false`ハッシュ一致テストもPASSした。

### コピーと最終状態

`poc-2-canyon` / `distributed` / `sampleInterval=100` / `sampleDensity=true`で確認した。

- 標本数: 36
- 標本0と標本35の`density`: 不一致
- 標本35の`density`と`result.density`: 一致
- 各標本の`density`: `Int32Array`
- `sampleDensity=false`の標本: `density`キー不在

### 標本上限

- `steps=3600` / `sampleInterval=1`: 3,600標本として実行前に例外
- 例外: `sampleDensity requires 3600 samples; limit is 200`
- `steps=3600` / `sampleInterval=18`: **200標本で上限ちょうど**、実行成功

## 実行時間とtimeline JSON容量

Node v20.20.2で各条件を1回実行した。`Int32Array`は全セル配列へ変換してJSON化し、UTF-8バイト数を計測した。

共通条件は`poc-2-canyon` / `gapWidth=1` / `distributed` / `corridorWidth=2` / `corridorBlocksOutOfField=true` / `restoreWeight=0` / `edgeFluxMax=512` / `congestionReference=2048` / `steps=3600`である。

| 件 | sampleInterval | sampleDensity | 標本数 | 実行時間 | timeline bytes | stateHash |
|---:|---:|---|---:|---:|---:|---|
| 1 | 0 | false | 0 | 2,501.8 ms | 4 | `aa0ac4df` |
| 2 | 100 | false | 36 | 2,403.2 ms | 7,020 | `aa0ac4df` |
| 3 | 100 | true | 36 | 2,469.6 ms | 374,034 | `aa0ac4df` |
| 4 | 18 | true | **200** | 2,435.4 ms | 2,073,415 | `aa0ac4df` |

件4でメモリまたは時間の問題は発生しなかった。

## 掃引CSV

- `scripts/sweep.js`の`flattenMeasurements`では`timeline`を除外済み
- `scripts/sweep.js`はStep 18から差分なし
- `node --test test/sweep.test.js`: PASS（1件、22,007 ms）

以上により、掃引CSVの列構成はStep 18時点と一致する。

## 検証コマンド

- `node --test --test-name-pattern='density timeline|timeline records' test/core.test.js`: PASS
- `npm run verify`: PASS（禁止API、既存9ハッシュ、core 1件・401,224 ms）
- `node --test test/sweep.test.js`: PASS（1件）
- `git diff --exit-code origin/main -- scripts/sweep.js`: PASS（差分なし）
- `git diff --check`: PASS
- `npm run build`: `package.json`にbuild scriptがないため未実行

## CI実行時間

Draft PR作成後にNode 20 / 22の結果を追記する。

## push確認

最終実装コミットのpush後に`git ls-remote --heads origin`の出力を追記する。

## 既知の制限

- 密度標本は最大200で、`sampleInterval=1`の全step記録はできない。
- 200標本のtimelineはJSONで2,073,415 bytesだった。
- 密度標本を使う再生UIはStep 20の対象であり、本Stepでは実装していない。
