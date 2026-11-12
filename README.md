# 生命之境 · Lifeverse

生命之境是一个在浏览器里运行的生态模拟沙盒。苔湾群岛有苔叶兽、琥脊兽、棘冠兽、潮鳍兽和影爪兽。草地、丘陵和浅滩提供不同的觅食条件。捕食、气候和资源共同影响哪些个体能留下后代，后代继承性状并发生有限变异。

## 游玩

- 拖动地图旋转视角，用滚轮或地图按钮缩放。点击生物或使用个体面板的编号下拉框查看性状。
- 在个体面板让幼体立即成熟、补满能量，或将遗传适温和偏好湿度调向当地环境。恩赐结果显示在按钮下方。追踪个体后，可在血脉面板观察它的后代及其体型分支。
- 在环境面板调整气温和降水，再用 48× 观察几代。调节降水后，长期降水会逐渐变化。相同种子下，干湿环境可能留下不同血脉。可用空格暂停，暂停后可单步推进。
- 存档保存在当前浏览器。读取后从保存时的模拟状态继续，初始为暂停。新世界使用指定种子重新生成。

第 1 代指创始个体，每次繁殖产生比父代高一代的后代。48× 控制世界时间推进速度。湿地型与旱地型可在繁殖中出现，仍沿用各自的食性。详见[演化规则](docs/EVOLUTION.md)与[路线图](docs/ROADMAP.md)。

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
