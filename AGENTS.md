# RPG Maker XP 游戏制作

优先调用 RPGXP Agent Studio 的 `studio_guide` 读取制作接口。当前会话若未加载 MCP，可按 README 安装，并用 `node studio/studio.mjs call studio_guide` 调用等价的 CLI。

从游戏需求生成可玩的原生 XP 工程。补齐引导、任务、地图和结局，检查地图预览和素材，再用原版 RGSS 试玩关键路径并导出 Windows 游戏包。制作器的独立入口为 `Start-RPGXP-Studio.cmd`。

`lighthouse.json` 与 `lighthouse-playtest.json` 提供完整规格和测试示例。原版编辑器和 Agent 应轮流编辑同一个项目，避免覆盖对方的修改。

`projects`、`dist`、`reports` 和 `studio/settings.json` 属于本机工作区。公开发行包包含制作器和依赖，构建时从本机 RPG Maker XP 读取项目模板、运行时与素材。
