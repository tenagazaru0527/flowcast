# Step 10 完了報告（作業中）

## 回廊判定

静的BFS距離場を再利用し、回廊は次式で定義する。

```text
Ω = { cell | distance(cell) >= 0 && distance(cell) <= corridorWidth }
```

`distance === -1` は障害物で囲まれるなどして線から到達不能なセルであり、回廊外である。
`proposeFlows` は移送先がΩ外なら、advectionScore / diffusionScore の算出前にその辺を提案しない。

`corridorWidth` はQ16.16ではなくセル単位の整数で、`createConfig` の整数キー側で検査する。
許容範囲は `0..width + height`。指定がなければ `width + height` を使い、格子全体で実質無制限とする。
