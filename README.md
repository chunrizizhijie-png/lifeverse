# 生命之境 · Lifeverse

生命之境是一个在浏览器里运行的生态模拟沙盒。Alpha 0.1 从苔湾群岛开始。苔叶兽采食植物，琥脊兽捕食苔叶兽。个体的能量、年龄、气温和食物共同影响它能否繁殖，后代继承父代的性状并发生有限变异。

## 游玩

- 拖动地图旋转视角，用滚轮或地图按钮缩放。点击生物或使用个体面板的编号下拉框查看性状。
- 在个体面板促生、恢复能量或调适遗传适温。标记神选者后，在血脉面板观察其后代。
- 调整世界气温和降水。可用空格暂停，暂停后可单步推进。
- 存档保存在当前浏览器。读取后从保存时的模拟状态继续，初始为暂停。新世界使用指定种子重新生成。

当前版本有两种生态角色、有限的身体构型和一条可追踪血脉。规则属于简化的游戏模型。复杂身体结构和更长尺度的演化仍在[路线图](docs/ROADMAP.md)中。

## 本地运行

使用 Node.js 22.18 或更高版本及 `package.json` 声明的 pnpm 版本。仓库的 CI 使用 Node.js 24。

```sh
git clone https://github.com/chunrizizhijie-png/lifeverse.git
cd lifeverse
pnpm install --frozen-lockfile
pnpm dev
```

在浏览器打开终端打印的本地地址。生产构建输出在 `dist/`。

```sh
pnpm check
pnpm test
pnpm build
pnpm preview
```

## 参与开发

阅读[贡献流程](CONTRIBUTING.md)、[项目结构](docs/ARCHITECTURE.md)和[可领取任务](docs/TASKS.md)。先认领 Issue，再在独立分支提交 Pull Request。

代码、程序化地形和生物模型采用 [Apache-2.0](LICENSE)。随包分发的 DM Sans 和 Instrument Serif 使用 SIL Open Font License 1.1，许可文本位于 [public/fonts](public/fonts)。
