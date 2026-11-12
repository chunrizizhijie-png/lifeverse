# Lifeverse 开发约定

1. 阅读 README、[架构](docs/ARCHITECTURE.md)、[演化规则](docs/EVOLUTION.md)和[任务](docs/TASKS.md)。通过 GitHub Issues 确认任务归属及相关文件。
2. 从最新的 `main` 建独立分支。优先选择与进行中分支不重叠的模块。
3. `src/sim/` 保持可脱离浏览器运行。模拟状态由 Worker 管理，渲染层消费快照。
4. 改动时间步、随机序列或存档结构时，在 PR 中说明影响，并覆盖相应的复现或迁移测试。
5. 提交前运行 `pnpm check`、`pnpm test` 和 `pnpm build`。界面改动还要在浏览器检查交互与布局。
