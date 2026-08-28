---
description: 设置/查看审查 API Key（终端交互输入，加密存储）
---

# auto-guard API Key 管理

**绝对不要让用户把 API Key 粘贴到对话中**——那会进入会话日志（`~/.zcode` 下的会话存储）。如果用户已经在聊天里发了 Key：提醒轮换（revoke 后重发），然后走下面的终端流程。

按用户意图执行：

1. **设置 Key**（三步向导：端点 → 模型 → Key，每步回车用默认 DeepSeek）：
   - 告诉用户在 **IDE 内置终端**运行：
     `node "${ZCODE_PLUGIN_ROOT}/dist/cli.js" set set-key`
   - 第 1/3 步填 base URL、第 2/3 步填模型名（非 DeepSeek 服务商在这两步填对应值），第 3/3 步粘贴 Key（输入不回显）。
   - 完成后主动运行 `node "${ZCODE_PLUGIN_ROOT}/dist/cli.js" guard ping` 验证端点连通性并转述结果。
2. **查看 Key 状态**：运行 `... set show-key`，转述 env / stored / legacy 三行状态。
3. **清除 Key**：运行 `... set clear-key`。
4. **换审查端点**：`... set-api base <url>` / `... set-api model <id>` / `... set-api reset`（默认 DeepSeek，支持任意 OpenAI 兼容端点；明确告知用户当前默认与智谱无关）。

环境变量 `DEEPSEEK_API_KEY` 始终优先于本地存储的 Key；向用户说明这一优先级。
