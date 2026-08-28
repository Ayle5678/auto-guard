window.__ModuleLoader__.load({
  id: "dsh-auto-guard",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    // DSH client module table only seeds react/cordis/ui packages; keep
    // remote result validators self-contained instead of requiring zod.
    function schemaFail(message) {
      return new Error(message);
    }

    function checkType(value, type, path) {
      var ok = type === "string" ? typeof value === "string"
        : type === "number" ? typeof value === "number"
        : type === "boolean" ? typeof value === "boolean"
        : type === "array" ? Array.isArray(value)
        : type === "object" ? value !== null && typeof value === "object"
        : false;
      if (!ok) throw schemaFail(path + ": expected " + type);
      return value;
    }

    function optionalSchema(inner) {
      return {
        isOptional: true,
        parse: function (value) {
          if (value === undefined) return undefined;
          return inner.parse(value);
        }
      };
    }

    function nullableSchema(inner) {
      return {
        parse: function (value) {
          if (value === null) return null;
          return inner.parse(value);
        }
      };
    }

    function primitiveSchema(type) {
      var schema = {
        parse: function (value) {
          return checkType(value, type, "value");
        },
        optional: function () {
          return optionalSchema(schema);
        },
        nullable: function () {
          return nullableSchema(schema);
        }
      };
      return schema;
    }

    function arraySchema(item) {
      return {
        parse: function (value) {
          checkType(value, "array", "value");
          return value.map(function (entry, index) {
            return item.parse(entry);
          });
        }
      };
    }

    function objectSchema(shape) {
      return {
        parse: function (value) {
          checkType(value, "object", "value");
          var result = {};
          for (var key in shape) {
            if (!Object.prototype.hasOwnProperty.call(shape, key)) continue;
            var field = shape[key];
            if (field.isOptional && value[key] === undefined) continue;
            result[key] = field.parse(value[key]);
          }
          return result;
        }
      };
    }

    function recordSchema(valueSchema) {
      return {
        parse: function (value) {
          checkType(value, "object", "value");
          var result = {};
          for (var key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
            if (typeof key !== "string") throw schemaFail("value: record keys must be strings");
            result[key] = valueSchema.parse(value[key]);
          }
          return result;
        }
      };
    }

    var z = {
      string: function () { return primitiveSchema("string"); },
      number: function () { return primitiveSchema("number"); },
      boolean: function () { return primitiveSchema("boolean"); },
      literal: function (expected) {
        return {
          parse: function (value) {
            if (value !== expected) throw schemaFail("value: expected literal " + JSON.stringify(expected));
            return value;
          }
        };
      },
      array: arraySchema,
      object: objectSchema,
      record: function (keySchema, valueSchema) {
        return recordSchema(valueSchema);
      }
    };

    var TOKENS = {
      border: "var(--dsw-alias-border-l2, #d0d3d6)",
      borderDimmed: "var(--dsw-alias-label-dimmed, #a0a4a8)",
      bgLayer2: "var(--dsw-alias-bg-layer-2, #f6f7f8)",
      bgLayer3: "var(--dsw-alias-bg-layer-3, #ffffff)",
      labelPrimary: "var(--dsw-alias-label-primary, #1f2328)",
      labelSecondary: "var(--dsw-alias-label-secondary, #61666b)",
      labelTertiary: "var(--dsw-alias-label-tertiary, #888d93)",
      brand: "var(--dsw-alias-brand-primary, #4f6ef7)"
    };

    var STYLES = {
      page: {
        padding: "16px"
      },
      title: {
        margin: "0 0 2px",
        fontSize: "17px",
        fontWeight: 600,
        lineHeight: 1.4,
        color: TOKENS.labelPrimary
      },
      lede: {
        margin: "0 0 16px",
        fontSize: "13px",
        lineHeight: 1.5,
        color: TOKENS.labelTertiary
      },
      category: {
        border: "1px dashed " + TOKENS.border,
        borderRadius: "12px",
        background: TOKENS.bgLayer3,
        marginBottom: "12px",
        overflow: "hidden",
        transition: "border-color 0.16s, background 0.16s"
      },
      categoryOpen: {
        background: TOKENS.bgLayer2,
        borderColor: TOKENS.borderDimmed
      },
      categoryHeader: {
        appearance: "none",
        width: "100%",
        font: "inherit",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
        background: "transparent",
        border: "0",
        borderRadius: "12px",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px"
      },
      categoryHeaderText: {
        flex: "1",
        minWidth: "0",
        display: "flex",
        flexDirection: "column",
        gap: "4px"
      },
      categoryName: {
        color: TOKENS.labelPrimary,
        fontSize: "15px",
        fontWeight: 600,
        lineHeight: 1.4
      },
      categoryDescription: {
        color: TOKENS.labelTertiary,
        fontSize: "13px",
        lineHeight: 1.5
      },
      chevron: {
        color: TOKENS.labelTertiary,
        flex: "none",
        transition: "transform 0.16s"
      },
      chevronOpen: {
        transform: "rotate(180deg)"
      },
      body: {
        borderTop: "1px solid " + TOKENS.border,
        margin: "0 16px",
        paddingBottom: "8px"
      },
      field: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px 16px",
        padding: "12px 0"
      },
      fieldBorder: {
        borderTop: "1px solid " + TOKENS.border
      },
      fieldText: {
        flex: "1",
        minWidth: "200px"
      },
      label: {
        display: "block",
        color: TOKENS.labelPrimary,
        fontSize: "13px",
        fontWeight: 500,
        lineHeight: 1.5
      },
      hint: {
        margin: "2px 0 0",
        color: TOKENS.labelTertiary,
        fontSize: "12px",
        lineHeight: 1.5
      },
      control: {
        flex: "none",
        minWidth: "220px",
        maxWidth: "100%"
      },
      input: {
        boxSizing: "border-box",
        width: "100%",
        height: "34px",
        border: "1px solid " + TOKENS.border,
        background: TOKENS.bgLayer3,
        color: TOKENS.labelPrimary,
        borderRadius: "8px",
        padding: "0 12px",
        fontSize: "13px",
        lineHeight: 1.5,
        font: "inherit"
      },
      select: {
        boxSizing: "border-box",
        width: "100%",
        height: "34px",
        border: "1px solid " + TOKENS.border,
        background: TOKENS.bgLayer3,
        color: TOKENS.labelPrimary,
        borderRadius: "8px",
        padding: "0 12px",
        fontSize: "13px",
        lineHeight: 1.5,
        font: "inherit"
      },
      checkbox: {
        width: "16px",
        height: "16px",
        accentColor: TOKENS.brand,
        cursor: "pointer"
      },
      footer: {
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "8px",
        borderTop: "1px solid " + TOKENS.border,
        padding: "12px 0 4px",
        marginTop: "12px"
      },
      save: {
        appearance: "none",
        font: "inherit",
        cursor: "pointer",
        border: "1px solid transparent",
        borderRadius: "8px",
        padding: "5px 14px",
        fontSize: "13px",
        lineHeight: 1.5,
        background: TOKENS.labelPrimary,
        color: TOKENS.bgLayer3
      },
      saveDisabled: {
        opacity: 0.4,
        cursor: "default"
      },
      clear: {
        appearance: "none",
        font: "inherit",
        cursor: "pointer",
        border: "1px solid " + TOKENS.border,
        borderRadius: "8px",
        padding: "5px 12px",
        fontSize: "13px",
        lineHeight: 1.5,
        background: "transparent",
        color: TOKENS.labelSecondary,
        whiteSpace: "nowrap"
      },
      message: {
        margin: "8px 0 0",
        fontSize: "13px",
        lineHeight: 1.5,
        color: TOKENS.labelSecondary
      }
    };

    function AutoGuardCommandRow(props) {
      var node = props.node;
      var text = (node.outcome && node.outcome.text) || node.args || "";
      return React.createElement(
        "div",
        {
          style: {
            padding: "4px 12px",
            fontSize: "13px",
            lineHeight: "20px",
            color: TOKENS.labelSecondary
          }
        },
        text
      );
    }

    var CATEGORIES = [
      { id: "basic", label: "基本设置", description: "兜底策略、审查日志与审计密码" },
      { id: "endpoint", label: "审查端点与模型", description: "直连 OpenAI 兼容端点、API Key 与模型选择" },
      { id: "notify", label: "通知行为", description: "各裁决结果的通知开关与路由" },
      { id: "tracker", label: "文件追踪", description: "短时间连续文件操作的默认策略" },
      { id: "cache", label: "缓存与记忆", description: "会话缓存、记忆 TTL 与审查缓存" },
      { id: "history", label: "历史与学习", description: "历史判断、学习规则、自动分析与维护" }
    ];

    var FIELDS = [
      { key: "examineEnabled", label: "审查日志", category: "basic", type: "boolean", hint: "开启后每个裁决写入 ~/.dsh/auto-guard/audit.db（SQLCipher 加密）；可用 sqlcipher CLI 或导出明文库查询。" },
      { key: "auditPassword", label: "审计密码", category: "basic", type: "secret", hint: "开启审查日志前必须设置；用于打开 SQLCipher 审计库，不回显明文。" },

      { key: "apiBase", label: "审查端点 Base URL", category: "endpoint", type: "text", hint: "直连 OpenAI 兼容审查端点，例如 https://api.deepseek.com；留空则走 DSH 内置模型路由。" },
      { key: "apiKeyEnv", label: "API Key 环境变量", category: "endpoint", type: "text", hint: "从环境变量读取 API Key 的名称，优先于下方本地 Key。" },
      { key: "apiKey", label: "API Key", category: "endpoint", type: "secret", hint: "本地保存的 API Key；留空不修改已配置值。" },
      { key: "provider", label: "Provider", category: "endpoint", type: "text", hint: "审查模型供应商名称。" },
      { key: "model", label: "Model", category: "endpoint", type: "text", hint: "主审查模型名。" },
      { key: "reasoningEffort", label: "Reasoning Effort", category: "endpoint", type: "text", hint: "推理强度，off/low/medium/high 等，按端点支持。" },
      { key: "fallbackProvider", label: "Fallback Provider", category: "endpoint", type: "text", hint: "主模型不可用时的备用供应商。" },
      { key: "fallbackModel", label: "Fallback Model", category: "endpoint", type: "text", hint: "备用模型名。" },
      { key: "timeoutMs", label: "超时 (ms)", category: "endpoint", type: "number", hint: "单次审查请求超时毫秒数。" },
      { key: "onTimeout", label: "超时策略", category: "endpoint", type: "select", options: ["deny", "ask"], hint: "审查超时后的处理策略。" },

      { key: "notifyCacheHit", label: "缓存命中通知", category: "notify", type: "boolean", hint: "命中缓存时是否发送通知。" },
      { key: "notifyLlmDecision", label: "LLM 裁决通知", category: "notify", type: "boolean", hint: "LLM 给出裁决时是否发送通知。" },
      { key: "notifyAllow", label: "放行通知路由", category: "notify", type: "select", options: ["page", "context", "off"], hint: "放行时通知去向。" },
      { key: "notifyDeny", label: "拒绝通知路由", category: "notify", type: "select", options: ["page", "context", "off"], hint: "拒绝时通知去向。" },
      { key: "notifyAsk", label: "询问通知路由", category: "notify", type: "select", options: ["page", "context", "off"], hint: "询问用户时通知去向。" },

      { key: "fileTrackerDefault", label: "File Tracker 默认", category: "tracker", type: "select", options: ["ask", "deny"], hint: "同一文件短时间连续操作的默认策略。" },
      { key: "fileTrackerWindowSec", label: "File Tracker 窗口 (秒)", category: "tracker", type: "number", hint: "文件追踪判定窗口秒数。" },

      { key: "sessionCacheSize", label: "会话缓存大小", category: "cache", type: "number", hint: "会话内缓存条目上限。" },
      { key: "alwaysReviewCacheTtlMinutes", label: "每次审查缓存 TTL (分钟)", category: "cache", type: "number", hint: "始终审查缓存的有效期（分钟）。" },
      { key: "lowRiskTtlDays", label: "低风险 TTL (天)", category: "cache", type: "number", hint: "低风险记忆保留天数。" },
      { key: "mediumRiskTtlDays", label: "中风险 TTL (天)", category: "cache", type: "number", hint: "中风险记忆保留天数。" },

      { key: "historyEnabled", label: "运行时历史层", category: "history", type: "boolean", hint: "开启后在精确缓存之后、LLM 之前使用历史放行。" },
      { key: "autoAnalyzeEnabled", label: "自动分析", category: "history", type: "boolean", hint: "开启后 session/created 到期自动分析学习规则。" },
      { key: "historyDays", label: "历史窗口 (天)", category: "history", type: "number", hint: "历史判断/学习分析读取多少天内的审计数据。" },
      { key: "historyMinTotal", label: "历史命中最少 allow", category: "history", type: "number", hint: "同一骨架至少多少条 low-risk allow 才放行。" },
      { key: "historyMinLlm", label: "历史命中最少 LLM allow", category: "history", type: "number", hint: "其中至少多少条真实 LLM 放行。" },
      { key: "learnedCacheableMinTotal", label: "学习 cacheable 最少 allow", category: "history", type: "number", hint: "生成学习 cacheable 模板规则的最少总 allow 数。" },
      { key: "analyzeIntervalDays", label: "自动分析间隔 (天)", category: "history", type: "number", hint: "距上次手动/自动分析多少天后再次自动分析。" }
    ];

    var patternRuleSchema = z.object({ pattern: z.string(), reason: z.string().optional() });
    var okMessageSchema = z.object({ ok: z.boolean(), message: z.string() });
    var listRulesSchema = z.object({
      version: z.literal(1),
      cacheable: z.array(patternRuleSchema)
    });
    var statusSchema = z.object({
      examineEnabled: z.boolean(),
      historyEnabled: z.boolean(),
      autoAnalyzeEnabled: z.boolean(),
      lastAnalysisAt: z.string().nullable(),
      cacheableCount: z.number()
    });
    var clearOldSchema = z.object({ removed: z.number() });
    var clearAllSchema = z.object({ ok: z.boolean() });
    var statsSchema = z.object({
      llmCalls: z.number(),
      sessionCacheHits: z.number(),
      persistentCacheHits: z.number(),
      historyHits: z.number(),
      learnedHits: z.number(),
      ruleHits: z.record(z.string(), z.number())
    });

    var AUTO_GUARD_REMOTE = {
      package: "dsh-auto-guard",
      descriptors: [
        { id: "dsh-auto-guard#autoGuard/analyzeNow", service: "autoGuard", namespace: "autoGuard", method: "analyzeNow", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#OkMessage", schema: okMessageSchema } },
        { id: "dsh-auto-guard#autoGuard/listRules", service: "autoGuard", namespace: "autoGuard", method: "listRules", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#ListRules", schema: listRulesSchema } },
        { id: "dsh-auto-guard#autoGuard/rollback", service: "autoGuard", namespace: "autoGuard", method: "rollback", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#OkMessage", schema: okMessageSchema } },
        { id: "dsh-auto-guard#autoGuard/status", service: "autoGuard", namespace: "autoGuard", method: "status", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#Status", schema: statusSchema } },
        { id: "dsh-auto-guard#autoGuard/clearOld", service: "autoGuard", namespace: "autoGuard", method: "clearOld", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#ClearOld", schema: clearOldSchema } },
        { id: "dsh-auto-guard#autoGuard/clearAll", service: "autoGuard", namespace: "autoGuard", method: "clearAll", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#ClearAll", schema: clearAllSchema } },
        { id: "dsh-auto-guard#autoGuard/stats", service: "autoGuard", namespace: "autoGuard", method: "stats", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "dsh-auto-guard#Stats", schema: statsSchema } }
      ]
    };

    function apply(ctx) {
      var autoGuardRemote;
      ctx.effect(function () {
        return ctx.remote.$mount(AUTO_GUARD_REMOTE).then(function (dispose) {
          autoGuardRemote = (ctx.reflect && ctx.reflect.get)
            ? ctx.reflect.get("remote.autoGuard")
            : ctx.get("remote.autoGuard");
          return dispose;
        });
      });

      ctx.slots.inject("conversation.chat.commandview", function () {
        return ctx.slots.register(
          { name: "conversation.chat.commandview", key: "auto-guard" },
          AutoGuardCommandRow
        );
      });

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "dsh-auto-guard", order: 80, label: "DSH Auto Guard" },
          SettingsSection
        );
      });

      function SettingsSection() {
        var scope = React.useMemo(function () {
          return ctx.settingsScope.bind({ namespace: "auto-guard" });
        }, []);
        var snapshot = scope.getSnapshot();
        var initial = snapshot.value || {};
        var state = React.useState(function () {
          return Object.assign({}, initial);
        });
        var draft = state[0];
        var setDraft = state[1];
        var savingState = React.useState(false);
        var saving = savingState[0];
        var setSaving = savingState[1];
        var messageState = React.useState("");
        var message = messageState[0];
        var setMessage = messageState[1];
        var remoteMessageState = React.useState("");
        var remoteMessage = remoteMessageState[0];
        var setRemoteMessage = remoteMessageState[1];
        var statsState = React.useState(null);
        var stats = statsState[0];
        var setStats = statsState[1];
        var rulesModalState = React.useState(null);
        var rulesModal = rulesModalState[0];
        var setRulesModal = rulesModalState[1];
        var openState = React.useState(function () {
          var opened = {};
          CATEGORIES.forEach(function (category) {
            opened[category.id] = true;
          });
          return opened;
        });
        var openCategories = openState[0];
        var setOpenCategories = openState[1];

        React.useEffect(function () {
          return scope.subscribe(function () {
            var next = scope.getSnapshot();
            setDraft(Object.assign({}, next.value || {}));
          });
        }, [scope]);

        function setField(key, value) {
          setMessage("");
          setDraft(function (d) {
            var next = Object.assign({}, d);
            next[key] = value;
            return next;
          });
        }

        function toggleCategory(id) {
          setOpenCategories(function (prev) {
            var next = Object.assign({}, prev);
            next[id] = !next[id];
            return next;
          });
        }

        function isDirty() {
          var current = scope.getSnapshot().value || {};
          for (var i = 0; i < FIELDS.length; i++) {
            var field = FIELDS[i];
            var value = draft[field.key];
            if (field.type === "secret") {
              if (typeof value === "string" && value.trim() !== "") {
                return true;
              }
              continue;
            }
            if (value === undefined) {
              continue;
            }
            if (field.type === "number" && typeof value === "string" && value.trim() !== "") {
              if (Number(value) !== current[field.key]) {
                return true;
              }
              continue;
            }
            if (value !== current[field.key]) {
              return true;
            }
          }
          return false;
        }

        async function save() {
          setSaving(true);
          setMessage("");
          try {
            var current = scope.getSnapshot().value || {};
            var hasAuditPassword = typeof draft.auditPassword === "string" && draft.auditPassword.trim() !== "";
            if (draft.examineEnabled && !hasAuditPassword && !current.auditPasswordMasked) {
              setMessage("开启审查日志前必须先设置审计密码");
              setSaving(false);
              return;
            }
            for (var i = 0; i < FIELDS.length; i++) {
              var field = FIELDS[i];
              var value = draft[field.key];
              if (field.type === "secret") {
                if (typeof value === "string" && value.trim() !== "") {
                  await scope.set(field.key, value.trim());
                }
              } else if (value !== undefined && value !== current[field.key]) {
                var nextValue = field.type === "number" && typeof value === "string"
                  ? Number(value)
                  : value;
                await scope.set(field.key, nextValue);
              }
            }
            setDraft(Object.assign({}, scope.getSnapshot().value || {}));
            setMessage("已保存");
          } catch (e) {
            setMessage("保存失败：" + ((e && e.message) || String(e)));
          }
          setSaving(false);
        }

        async function clearSecret(fieldKey) {
          setSaving(true);
          setMessage("");
          try {
            await scope.unset(fieldKey);
            await scope.unset(fieldKey + "Masked");
            setDraft(Object.assign({}, scope.getSnapshot().value || {}));
            setMessage(fieldKey === "apiKey" ? "已清除本地 API Key" : "已清除审计密码");
          } catch (e) {
            setMessage("清除失败：" + ((e && e.message) || String(e)));
          }
          setSaving(false);
        }

        async function callRemote(method) {
          if (!autoGuardRemote || !autoGuardRemote[method]) {
            setRemoteMessage("远程服务未就绪");
            return;
          }
          setRemoteMessage("");
          try {
            var result = await autoGuardRemote[method]();
            if (!result.ok) {
              setRemoteMessage("调用失败：" + ((result.error && (result.error.message || result.error.code)) || "未知错误"));
              return;
            }
            var value = result.value;
            if (method === "analyzeNow" || method === "rollback") {
              setRemoteMessage(value.message || (method === "analyzeNow" ? "分析完成" : "回滚完成"));
            } else if (method === "clearOld") {
              setRemoteMessage("已删除 " + value.removed + " 条 30 天前记录");
            } else if (method === "clearAll") {
              setRemoteMessage("已清空全部审查日志");
            } else if (method === "exportPlaintext") {
              setRemoteMessage(value.message || "已导出明文审计库");
            } else if (method === "createNewAudit") {
              setRemoteMessage(value.message || "已重建空审计库");
            } else if (method === "status") {
              setRemoteMessage("状态：" + value.examineEnabled + " / " + value.historyEnabled + " / " + value.autoAnalyzeEnabled + "，cacheable " + value.cacheableCount);
            } else if (method === "listRules") {
              setRulesModal(value);
              setRemoteMessage("规则已加载：cacheable " + value.cacheable.length);
            } else if (method === "stats") {
              setStats(value);
              setRemoteMessage("统计已刷新");
            }
          } catch (e) {
            setRemoteMessage("调用失败：" + ((e && e.message) || String(e)));
          }
        }

        function renderField(field, index) {
          var control;
          if (field.type === "boolean") {
            control = React.createElement("input", {
              type: "checkbox",
              checked: Boolean(draft[field.key]),
              onChange: function (e) { setField(field.key, e.target.checked); },
              style: STYLES.checkbox
            });
            var controlStyle = Object.assign({}, STYLES.control, { minWidth: "auto" });
          } else if (field.type === "select") {
            control = React.createElement(
              "select",
              {
                value: draft[field.key] || field.options[0],
                onChange: function (e) { setField(field.key, e.target.value); },
                style: STYLES.select
              },
              field.options.map(function (option) {
                return React.createElement("option", { key: option, value: option }, option);
              })
            );
          } else if (field.type === "secret") {
            var snapshotValue = snapshot.value || {};
            var maskedKey = field.key + "Masked";
            var configured = Boolean(snapshotValue[maskedKey]);
            var masked = snapshotValue[maskedKey] || "已配置";
            control = React.createElement(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px" } },
              React.createElement("input", {
                type: "password",
                placeholder: configured ? "已配置（留空不修改）" : "未配置",
                value: typeof draft[field.key] === "string" ? draft[field.key] : "",
                onChange: function (e) { setField(field.key, e.target.value); },
                style: Object.assign({}, STYLES.input, { flex: "1", width: "auto" })
              }),
              React.createElement(
                "span",
                { style: { flex: "none", fontSize: "12px", color: TOKENS.labelTertiary, whiteSpace: "nowrap" } },
                configured ? ("已配置 (" + masked + ")") : "未配置"
              ),
              configured
                ? React.createElement(
                    "button",
                    {
                      type: "button",
                      onClick: function () { clearSecret(field.key); },
                      disabled: saving,
                      style: STYLES.clear
                    },
                    field.key === "apiKey" ? "清除已配置 Key" : "清除已配置"
                  )
                : null
            );
          } else {
            control = React.createElement("input", {
              type: field.type === "number" ? "number" : "text",
              value: draft[field.key] === undefined || draft[field.key] === null ? "" : String(draft[field.key]),
              onChange: function (e) {
                setField(field.key, field.type === "number" ? e.target.value : e.target.value);
              },
              style: STYLES.input
            });
          }

          return React.createElement(
            "div",
            {
              style: Object.assign(
                { },
                STYLES.field,
                index > 0 ? STYLES.fieldBorder : null
              )
            },
            React.createElement(
              "div",
              { style: STYLES.fieldText },
              React.createElement("label", { style: STYLES.label }, field.label),
              React.createElement("p", { style: STYLES.hint }, field.hint)
            ),
            React.createElement("div", { style: controlStyle || STYLES.control }, control)
          );
        }

        function renderCategory(category) {
          var open = Boolean(openCategories[category.id]);
          var fields = FIELDS.filter(function (field) {
            return field.category === category.id;
          });

          function actionButton(label, method) {
            return React.createElement(
              "button",
              {
                type: "button",
                key: method,
                onClick: function () { callRemote(method); },
                style: STYLES.clear
              },
              label
            );
          }

          var historyExtras = category.id === "history"
            ? React.createElement(
                React.Fragment,
                { key: "history-extras" },
                React.createElement(
                  "div",
                  { style: { borderTop: "1px solid " + TOKENS.border, padding: "12px 0 4px", display: "flex", flexWrap: "wrap", gap: "8px" } },
                  actionButton("立即分析", "analyzeNow"),
                  actionButton("查看规则", "listRules"),
                  actionButton("回滚", "rollback"),
                  actionButton("状态", "status"),
                  actionButton("清理 30 天前", "clearOld"),
                  actionButton("清空全部", "clearAll"),
                  actionButton("导出明文审计库", "exportPlaintext"),
                  actionButton("新建审计库", "createNewAudit")
                ),
                stats
                  ? React.createElement(
                      "pre",
                      { style: { margin: "8px 0 0", padding: "8px", background: TOKENS.bgLayer3, border: "1px solid " + TOKENS.border, borderRadius: "8px", fontSize: "12px", lineHeight: 1.5, overflow: "auto", color: TOKENS.labelSecondary } },
                      JSON.stringify(stats, null, 2)
                    )
                  : null,
                remoteMessage
                  ? React.createElement(
                      "p",
                      { style: { margin: "8px 0 0", fontSize: "13px", lineHeight: 1.5, color: TOKENS.labelSecondary } },
                      remoteMessage
                    )
                  : null
              )
            : null;
          return React.createElement(
            "div",
            {
              key: category.id,
              style: Object.assign({}, STYLES.category, open ? STYLES.categoryOpen : null)
            },
            React.createElement(
              "button",
              {
                type: "button",
                onClick: function () { toggleCategory(category.id); },
                "aria-expanded": open,
                style: STYLES.categoryHeader
              },
              React.createElement(
                "span",
                { style: STYLES.categoryHeaderText },
                React.createElement("span", { style: STYLES.categoryName }, category.label),
                React.createElement("span", { style: STYLES.categoryDescription }, category.description)
              ),
              React.createElement(
                "svg",
                {
                  width: "14",
                  height: "14",
                  viewBox: "0 0 14 14",
                  fill: "none",
                  xmlns: "http://www.w3.org/2000/svg",
                  style: Object.assign({}, STYLES.chevron, open ? STYLES.chevronOpen : null)
                },
                React.createElement("path", {
                  d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 9.08696 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
                  fill: "currentColor"
                })
              )
            ),
            open
              ? React.createElement(
                  "div",
                  { style: STYLES.body },
                  fields.map(function (field, index) {
                    return React.createElement(
                      React.Fragment,
                      { key: field.key },
                      renderField(field, index)
                    );
                  }),
                  historyExtras
                )
              : null
          );
        }

        function renderRuleList(title, items, format) {
          return React.createElement(
            "div",
            { key: title, style: { marginBottom: "12px" } },
            React.createElement(
              "h4",
              { style: { margin: "0 0 6px", fontSize: "13px", fontWeight: 600, color: TOKENS.labelPrimary } },
              title + " (" + items.length + ")"
            ),
            items.length === 0
              ? React.createElement("p", { style: { margin: "0", fontSize: "12px", color: TOKENS.labelTertiary } }, "无")
              : React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "4px" } },
                  items.map(function (item, index) {
                    return React.createElement(
                      "div",
                      { key: index, style: { fontSize: "12px", lineHeight: 1.5, color: TOKENS.labelSecondary, wordBreak: "break-all" } },
                      format(item)
                    );
                  })
                )
          );
        }

        function renderRulesModal() {
          if (!rulesModal) return null;
          return React.createElement(
            "div",
            {
              style: {
                position: "fixed",
                inset: "0",
                background: "rgba(0,0,0,0.4)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px"
              },
              onClick: function () { setRulesModal(null); }
            },
            React.createElement(
              "div",
              {
                style: {
                  background: TOKENS.bgLayer3,
                  border: "1px solid " + TOKENS.border,
                  borderRadius: "12px",
                  maxWidth: "680px",
                  width: "100%",
                  maxHeight: "80vh",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.18)"
                },
                onClick: function (e) { e.stopPropagation(); }
              },
              React.createElement(
                "div",
                { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "12px 16px", borderBottom: "1px solid " + TOKENS.border } },
                React.createElement("h3", { style: { margin: "0", fontSize: "15px", fontWeight: 600, color: TOKENS.labelPrimary } }, "学习规则列表"),
                React.createElement(
                  "button",
                  { type: "button", onClick: function () { setRulesModal(null); }, style: STYLES.clear },
                  "关闭"
                )
              ),
              React.createElement(
                "div",
                { style: { padding: "16px", overflow: "auto" } },
                renderRuleList("cacheable", rulesModal.cacheable || [], function (r) {
                  return r.pattern;
                })
              )
            )
          );
        }

        var dirty = isDirty();

        return React.createElement(
          "div",
          { style: STYLES.page },
          React.createElement("h3", { style: STYLES.title }, "DSH Auto Guard"),
          React.createElement("p", { style: STYLES.lede }, "启用/停用：在对话输入框的权限选择器中选择 Auto Guard 预设。配置审查端点、通知、文件追踪与缓存行为。"),
          CATEGORIES.map(renderCategory),
          React.createElement(
            "div",
            { style: STYLES.footer },
            React.createElement(
              "button",
              {
                onClick: save,
                disabled: saving || !dirty,
                style: Object.assign({}, STYLES.save, saving || !dirty ? STYLES.saveDisabled : null)
              },
              saving ? "保存中..." : "保存"
            )
          ),
          message
            ? React.createElement(
                "div",
                { style: STYLES.message },
                message
              )
            : null,
          renderRulesModal()
        );
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "settingsScope", "remote"];
    return module.exports;
  }
});
