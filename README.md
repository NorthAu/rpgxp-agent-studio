# RPGXP Agent Studio

让 Codex 等 Agent 直接制作 RPG Maker XP 游戏。用 JSON 定义地图、事件和任务，生成原生 `.rxproj`，再用 RGSS1 跑完关键路线、导出发行包。

[在线试玩《最后一座灯塔》](https://northau.github.io/rpgxp-agent-studio/) · [下载离线试玩包](https://github.com/NorthAu/rpgxp-agent-studio/releases/latest) · [制作接口](studio/制作接口.md)

## 试玩《最后一座灯塔》

风暴打坏了港口的灯。和守灯人交谈，沿石径前往观测岭，带回透镜，点亮最后一座灯塔。

- Windows、macOS 和 Linux 可在现代浏览器打开在线版，也可解压 ZIP 后双击 `index.html`。方向键移动，Enter 或 Z 确认。窄屏和触屏会显示操作按钮。
- 网页版读取与 XP 示例相同的地图布局和事件定义。画面与音效在浏览器内绘制或合成，发行包可离线运行。

## 用 Agent 制作

Windows 上用 Steam 安装并启动一次 RPG Maker XP，再准备 Node.js 22 或更新版本。

```powershell
Copy-Item studio/settings.example.json studio/settings.json
# 按需把 studio/settings.json 中的 rpgxp 改成实际安装目录
npm ci --prefix studio --ignore-scripts
codex mcp add rpgxp-agent-studio -- node (Join-Path $PWD 'studio/studio.mjs') mcp
```

也可直接用 CLI。先执行 `node studio/studio.mjs call studio_guide`，再通过 `studio_build`、`studio_playtest` 和 `studio_package` 生成、测试和打包 XP 工程。`lighthouse.json` 与 `lighthouse-playtest.json` 提供完整规格和试玩路线。

独立构建示例的网页版本只需要 Node.js。输出目录应为新目录。

```sh
node studio/web-export.mjs lighthouse.json dist/lighthouse-web
```

Codex 可用 `studio_export_web` 导出布局和事件兼容的规格。网页导出器目前支持示例所用的两种地形和原生式地图事件。任意 RGSS 插件、战斗系统及其他瓦片集仍使用 XP 原生工程。

## 组件

原生工程工具复用 [rpgmaker-xp-mcp](https://github.com/SerifeusStudio/rpgmaker-xp-mcp)。构建和运行原生工程时，工具从本机 RPG Maker XP 读取模板、运行时和 RTP。公开仓库及网页发行包只包含制作器、原创示例规格和浏览器代码。
