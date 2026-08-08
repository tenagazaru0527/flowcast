# Step 9 完了報告

- Issue: Closes #12
- engineVersion: 0.9.0
- 生データ: data/step-09-sweep.csv

## 中央ルート比率の変化幅
- 0/2048: 0.1pt
- 0/4096: 0.1pt
- 0/8192: 0.1pt
- 0/16384: 0.1pt
- 32768/2048: 0.1pt
- 32768/4096: 0.1pt
- 32768/8192: 0.1pt
- 32768/16384: 0.1pt
- 65536/2048: 0.2pt
- 65536/4096: 0.1pt
- 65536/8192: 0.1pt
- 65536/16384: 0.1pt

## 観測

- `conductanceMin` は最小 **0**（Q=65,536 より十分小さい）となり、`throttledEdgeCount` は最大 4,626,380。通気度は掃引中に発動している。
- 144ランすべてで保存則 `completed + outOfField + remaining = injected` が成立した。
- 全方向の `conductance` が0でも、既存の `scoreTotal <= 0` 分岐により移送を提案しないため、ゼロ除算は起きず材料はセルに留まる。
- 受け入れ基準は基準1・3がPASS、基準2・4がFAIL（`test/acceptance.test.js`: 2/4 PASS）。既定値の決定・推奨は行わない。

既定 `congestionWeight=0` は0.8.0の全3シナリオ・9ハッシュと一致する。
