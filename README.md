# RPGXP Agent Studio

用 JSON 规格生成原生 RPG Maker XP 工程。支持地图、事件、对话和 RGSS 脚本制作，使用原版 RGSS1 自动试玩，导出可运行的 Windows 游戏包。

[下载 Windows x64 便携版](https://github.com/NorthAu/rpgxp-agent-studio/releases/latest) · [制作接口](studio/制作接口.md)

## 开始制作

1. 解压便携版，双击 `Start-RPGXP-Studio.cmd`。Node.js 和制作器所需依赖随包提供。
2. 第一次使用时选「准备本机离线运行库」，输入本机已有的 RPG Maker XP 安装目录。素材安装在其他位置时，再填写 RTP 目录。这个过程只读取已有文件，完成后的本地运行库放在 `.rpgxp-runtime`。
3. 重新打开菜单，选择「构建、通关并打包内置示例」体验完整流程。也可以选择自己的 JSON 规格。工程在 `projects/<项目>`，游戏包在 `dist`。

本地运行库包含 XP 模板、素材和原版 RGSS1 游戏运行时。生成、试玩与打包可离线完成，无需启动或登录 Steam。公开便携包提供工具和 Node.js，初次准备运行库时需要来自本机授权安装的 XP 文件。

需要在图形界面手动修改 `.rxproj` 时，可把 `studio/settings.example.json` 复制为 `studio/settings.json`，在 `editor` 填入官方非 Steam 版 `RPGXP.exe` 的完整路径。按该版本的官方方式激活。[RPG Maker XP 官方下载与购买页](https://www.rpgmakerweb.com/products/rpg-maker-xp)

`lighthouse.json` 和 `lighthouse-playtest.json` 是《最后一座灯塔》的原生工程规格和测试路线。示例包含两张地图、对话分支、传送、任务和结局状态。

## 命令行与 Agent

```cmd
Start-RPGXP-Studio.cmd cache-runtime "D:\path\to\RPGXP"
Start-RPGXP-Studio.cmd demo lighthouse
Start-RPGXP-Studio.cmd call studio_guide
Start-RPGXP-Studio.cmd tools
```

可选的 MCP 入口是 `Start-RPGXP-Studio.cmd mcp`，用于接入 Codex 等 Agent。便携菜单可以独立完成 JSON 构建、试玩和打包。

从源码运行时，用 Node.js 22 或更新版本执行 `npm ci --prefix studio --ignore-scripts`。原生文件操作复用 [rpgmaker-xp-mcp](https://github.com/SerifeusStudio/rpgmaker-xp-mcp)。
