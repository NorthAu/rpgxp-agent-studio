# RPGXP Agent Studio

用 JSON 规格生成原生 RPG Maker XP 工程。支持地图、事件、对话和 RGSS 脚本制作，使用原版 RGSS1 自动试玩，导出可运行的 Windows 游戏包。

[下载 Windows x64 便携版](https://github.com/NorthAu/rpgxp-agent-studio/releases/latest) · [制作接口](studio/制作接口.md)

## 开始制作

1. 在 Windows 上安装 Steam 版 RPG Maker XP，并从 Steam 启动一次。
2. 解压便携版，双击 `Start-RPGXP-Studio.cmd`。Node.js 和制作器所需依赖随包提供。
3. 选择「构建、通关并打包内置示例」体验完整流程。也可以选择自己的 JSON 规格。生成的 `projects/<项目>/Game.rxproj` 可在原版编辑器中打开，游戏包在 `dist`。

便携版读取本机已安装的 XP 模板、素材和运行时。制作过程可离线完成。若安装目录未被识别，可把 `studio/settings.example.json` 复制为 `studio/settings.json`，然后填写 `rpgxp` 路径。

`lighthouse.json` 和 `lighthouse-playtest.json` 是《最后一座灯塔》的原生工程规格和测试路线。示例包含两张地图、对话分支、传送、任务和结局状态。

## 命令行与 Agent

```cmd
Start-RPGXP-Studio.cmd demo lighthouse
Start-RPGXP-Studio.cmd call studio_guide
Start-RPGXP-Studio.cmd tools
```

可选的 MCP 入口是 `Start-RPGXP-Studio.cmd mcp`，用于接入 Codex 等 Agent。便携菜单可以独立完成 JSON 构建、试玩和打包。

从源码运行时，用 Node.js 22 或更新版本执行 `npm ci --prefix studio --ignore-scripts`。原生文件操作复用 [rpgmaker-xp-mcp](https://github.com/SerifeusStudio/rpgmaker-xp-mcp)。
