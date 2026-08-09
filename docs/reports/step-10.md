# Step 10 完了報告

- Issue: Closes #14
- engineVersion: 0.10.0
- 生データ: `data/step-10-sweep.csv`（48点、各点3入力）
- Step 9再生成: `data/step-09-sweep-regen-0.10.0.csv`（旧CSVは保持）
- 密度場: `data/step-10-density/`（distributed、12ファイル、64×64整数CSV）

## 観測

- 主格子は cw=1/2/3/4/8、rw=0、congestionWeight=0/Q、g=1/3/9/63 の40点、対照群は cw=2、rw=Q/16 の8点である。
- straight / distributed / detour の中央・迂回ギャップ通過量、変化幅、完了率、残留率、場外損失、回廊縁密度、密度最大位置、occupiedCellsPeak、coherenceLength は掃引CSVに全点・全入力で記録した。
- `outOfFieldByEdge` は left/right/top/bottom の絶対量として記録した。
- `outsideCorridorCells` は不変条件として検査し、全実行で0だった。
- 保存則 `completed + outOfField + remaining = injected` は各測定実行で検査した。

解釈、推奨、順位付け、既定値の決定は行わない。
