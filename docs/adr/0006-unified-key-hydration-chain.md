# API key 统一为加密存储 + 水合链（env > 加密存储 > 遗留明文）

以 zcode ADR-0006 为基底统一三宿主的 key 管理：core 提供 key-store（AES-256-GCM、机器绑定密钥、`api-key.json`）与水合函数 `hydrateApiKey`：环境变量优先，其次加密存储，最后遗留明文字段（只读迁移源，永不回写）。pi 由此把明文 config.json 存 key 的已知弱点升级掉；dsh 适配层把 settings 的 secret role 挂进同一条水合链的最优先级之后；TTY 交互式 set-key 三步向导（端点→模型→key，不回显）归统一 CLI，聊天粘贴 key 的禁令文案随 slash 命令保留。

## Consequences

- 诚实定位不变：机器绑定加密是混淆级本地保护，非硬件 secret store；文档须保留此说明。
- pi 现存明文 key 字段作为"遗留明文"层被读取但不删除，用户重设 key 后自然转入加密层。
