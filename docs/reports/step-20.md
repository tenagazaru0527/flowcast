# Step 20 完了報告

## 実装項目

| Issue節 | 結果 | 実装内容 |
|---|---|---|
| 2-1 | 実装 | Step 18課題は達成可能。中央線の終点y=24のクリア解を追加 |
| 2-2 | 実装 | クリア解JSONとStep 18報告の達成可能性・4軸を訂正 |
| 3-1 | 実装 | `sampleDensity: true`の36標本を共通色スケールで75ms間隔に再生。スライダーと再生ボタンを追加 |
| 3-2 | 実装 | 実行前に「計算中…」を描画し、同期実行後に再生を開始 |
| 3-3 | 実装 | 目標・制約・現在値をchallenge定義から常時表示 |
| 3-4 | 実装 | 初期線が目標を満たさないことを常時表示 |
| 3-5 | 実装 | 線の選択、なぞり直し、3〜5本制約、実行手順を表示 |
| 3-6 | 実装 | upper/lowerシンクを色分けし、各群の到達量を表示 |

engineVersion、既定値、受け入れ基準、閾値、標本数、stepsは変更していない。

## Chrome実測

- Google Chrome（headless）で、元の線を実行して再生開始まで **2,108ms**。
- 表示間隔は **75ms/標本**。step 100から3600まで36標本の再生時間は約**2.625秒**。
- 同一ページ内の単発比較: `sampleDensity=false` **2,077.9ms**、`true` **2,034.2ms**（差 **-43.7ms / -2.1%**）。両方とも`stateHash=798d58e4`、timelineは36標本。

## 検証結果

- 元の線: upper **69.17%** / 場外 **0.00%** / 到達率 **67.00%** / `stateHash=798d58e4` / 失敗。
- クリア解JSON読込後: upper **64.26%** / 場外 **0.00%** / 到達率 **58.00%** / `stateHash=9e564fe2` / クリア。
- Chromeでスライダー最大値35、最終表示step 3600、最初と最後のCanvasが異なること、再生後に結果表示となることを確認。
- `src/`、`scripts/`、`test/`、`runtime-hashes.json`、`debug/`は変更していない。

## 既知の制限

- 実行中は同期計算のため、計算中は画面操作を受け付けない。
- 1課題のみで、課題進行・比較・チュートリアルはない。
- 200標本を超える密度標本はエンジン側で拒否される。

## 実行した確認コマンド

- `node scripts/check-forbidden-apis.js`: PASS
- `node scripts/check-runtime-hashes.js`: 既存9ハッシュ一致
- `npm run test:core`: PASS（17件）
- `npm run test:hashes`: PASS（9件）
- `npm run test:conservation`: PASS（1件）
- `node --check game/game.js`: PASS
- `git diff --exit-code origin/main -- src scripts test runtime-hashes.json debug`: PASS（出力なし）
- `git diff --check`: PASS
- `npm run build`: `package.json`にbuild scriptがないため未実行
- Chrome: Google Chrome 149.0.7827.200（headless）
