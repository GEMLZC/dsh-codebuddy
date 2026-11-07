// NOTE: 本文件是 dsh-codebuddy 的网页端**源码**，不经过构建。
// 改完用 `node --check lib/client.js` 自检。
window.__ModuleLoader__.load({ id: "dsh-codebuddy", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const React = require("react");
const { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } = React;
const h = React.createElement;

/** 后端 HTTP 路由（**带前导斜杠**，与 host 半的 SETTINGS_ROUTE 一致）。 */
const ROUTE = "/_dsh/dsh-codebuddy/settings";

/** 调用 host 侧 API。signal 可选（用于取消长耗时的探测）。 */
async function api(action, payload, signal) {
  const init = action === undefined
    ? { credentials: "same-origin", signal: signal }
    : {
        credentials: "same-origin",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action }, payload)),
        signal: signal,
      };
  const res = await fetch(ROUTE, init);
  const body = await res.json();
  if (!res.ok || !body.ok) {
    const err = new Error((body && body.error && body.error.message) || ("request failed " + res.status));
    err.code = body && body.error ? body.error.code : undefined;
    throw err;
  }
  return body.value;
}

// ── 样式 ──────────────────────────────────────────────────────
const CSS = `
.cb-wrap { display: flex; flex-direction: column; gap: 14px; font-size: 14px; }
.cb-row { display: flex; flex-direction: column; gap: 6px; }
.cb-label { font-weight: 600; opacity: .9; }
.cb-hint { font-size: 12px; opacity: .6; line-height: 1.5; }
.cb-input { padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35);
            background: rgba(128,128,128,.08); color: inherit; font-size: 13px; font-family: inherit; }
.cb-input:focus { outline: 2px solid rgba(90,140,255,.5); outline-offset: 0; }
.cb-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.cb-btn { padding: 7px 14px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35);
          background: rgba(128,128,128,.12); color: inherit; cursor: pointer; font-size: 13px; }
.cb-btn:hover:not(:disabled) { background: rgba(128,128,128,.22); }
.cb-btn:disabled { opacity: .45; cursor: not-allowed; }
.cb-btn.primary { background: rgba(90,140,255,.2); border-color: rgba(90,140,255,.5); }
.cb-msg { padding: 8px 10px; border-radius: 6px; font-size: 13px; line-height: 1.5; }
.cb-ok { background: rgba(60,180,100,.15); border: 1px solid rgba(60,180,100,.4); }
.cb-err { background: rgba(220,80,80,.15); border: 1px solid rgba(220,80,80,.4); }
.cb-info { background: rgba(90,140,255,.12); border: 1px solid rgba(90,140,255,.35); }
.cb-models { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto;
             padding: 8px; border-radius: 6px; background: rgba(128,128,128,.08); }
.cb-model { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; }
.cb-model:hover { background: rgba(128,128,128,.12); }
.cb-model code { font-size: 12px; opacity: .85; }
.cb-check { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.cb-check input { cursor: pointer; }
.cb-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px;
            background: rgba(128,128,128,.18); opacity: .85; }
.cb-badge-img { background: rgba(90,140,255,.22); border: 1px solid rgba(90,140,255,.45); opacity: 1; }

/* ── 输入框底栏的推理等级拖动条 ────────────────────────────────
 * 三段式设计：
 *   ① 拖动连续、无档位跳变 —— 自己画轨道，不用原生 input[type=range]
 *   ② 松手才吸附到最近档位（带缓动）
 *   ③ 呼吸灯：亮度在「本档下限 → 本档上限」之间往复
 *
 * ── 为什么不用原生 range ───────────────────────────────────────
 * 原生 range 是**按 step 量化的**：4 个档位就只能有 4 个停靠点，
 * 拖动时滑块一格一格地蹦，这就是「不流畅/卡顿」的全部来源。
 * 改成自绘轨道后：
 *   · 位置是【连续像素】，鼠标移动 1px 它就动 1px，原生没有任何量化；
 *   · 拖动期间**完全不碰 React state**（只改 CSS 变量 + transform），
 *     不触发重渲染，所以跟手；
 *   · 松手后才做一次吸附 + 一次 selectModel 提交。
 *
 * ── 呼吸灯的亮度区间（关键约束）────────────────────────────────
 * 用户要求：亮度不得超过当前档位的最高亮度，最低亮度 = 前一档的最高亮度。
 * 所以每一档 [i] 界定一个亮度窗口：
 *      窗口下限 = max(全局最低亮度, 档位 i-1 的高亮度)
 *      窗口上限 = 档位 i 的高亮度
 * 首档没有前一档，下限就用全局最低亮度。窗口由 JS 写成两个 CSS 变量，
 * @property 让它们可以在 keyframes 里被连续插值。
 */
/* 呼吸灯由 JS 的 requestAnimationFrame 驱动（见 EffortControl 的 breathing effect）。
 *
 * 为什么不用 CSS @property + keyframes：
 * 那条路依赖 @property 注册成功，一旦插件样式表被后注入 / 被宿主覆盖，
 * --cb-lum 会退化成不可插值的普通自定义属性，动画与
 * filter: brightness(var(...)) 一起失效，元素可能直接不可见。
 * 这在真机上表现为"代码没错但什么都不显示"，排查成本极高。
 * JS 写变量没有这层依赖：只要元素在，值一定生效。
 */
.cb-effort {
  display: flex; align-items: center; gap: 8px; flex: none; min-width: 0;
  --cb-effort-accent: var(--dsw-alias-state-business-primary, #4d7cff);
  /* 位置：0..1 的连续比例。拖动时直接改这个变量，不经过 React */
  --cb-effort-pos: 0;
  /* 亮度 / 辉光 / 光晕：由 rAF 每帧写入 */
  --cb-lum: 1;
  --cb-glow: 4px;
  --cb-halo: .3;
}
.cb-effort-label {
  flex: none; max-width: 58px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 11px; line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-caption, #81858c); user-select: none;
}

/* 自绘轨道：可点击/可拖拽的命中区 */
.cb-effort-track {
  position: relative; flex: none;
  width: 160px; height: 26px;
  cursor: pointer; touch-action: none; user-select: none;
  filter: brightness(var(--cb-lum));
}
.cb-effort-track:focus-visible { outline: none; }
.cb-effort-track:focus-visible .cb-effort-knob {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cb-effort-accent) 55%, transparent);
}
/* 底层轨道（未到达区间）：6px 实心，比之前的 2px 细线厚得多 */
.cb-effort-rail {
  position: absolute; left: 0; right: 0; top: 50%; height: 6px;
  transform: translateY(-50%); border-radius: 999px;
  background: rgba(255, 255, 255, .18);
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, .18);
}
/* 已达到区间：宽度跟随 --cb-effort-pos，带随呼吸脉动的外发辉光 */
.cb-effort-fill {
  position: absolute; left: 0; top: 50%; height: 6px;
  transform: translateY(-50%); border-radius: 999px;
  width: calc(var(--cb-effort-pos) * 100%);
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--cb-effort-accent) 55%, transparent),
    var(--cb-effort-accent));
  box-shadow:
    0 0 var(--cb-glow) color-mix(in srgb, var(--cb-effort-accent) 85%, transparent),
    0 0 calc(var(--cb-glow) * .45) color-mix(in srgb, var(--cb-effort-accent) 95%, transparent);
}
/* 滑块：用 translate 定位（合成层，不触发布局）。
   外圈光晕吃 --cb-halo，呼吸时明显胀缩。 */
.cb-effort-knob {
  position: absolute; top: 50%; left: 0;
  width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border-radius: 50%; background: #fff; border: none;
  transform: translateX(calc(var(--cb-effort-pos) * 160px));
  box-shadow:
    0 0 0 2.5px color-mix(in srgb, var(--cb-effort-accent) 45%, transparent),
    0 0 calc(var(--cb-glow) * 1.4)
      color-mix(in srgb, var(--cb-effort-accent) calc(var(--cb-halo) * 100%), transparent),
    0 0 calc(var(--cb-glow) * 2.6)
      color-mix(in srgb, var(--cb-effort-accent) calc(var(--cb-halo) * 55%), transparent);
  will-change: transform;
}
/* 松手吸附：只给位置加缓动，拖动中不加（否则会拖出一条延迟） */
.cb-effort[data-settling="1"] .cb-effort-knob,
.cb-effort[data-settling="1"] .cb-effort-fill {
  transition: transform .26s cubic-bezier(.22, 1, .36, 1),
              width .26s cubic-bezier(.22, 1, .36, 1);
}
.cb-effort-track:active .cb-effort-knob {
  transform: translateX(calc(var(--cb-effort-pos) * 160px)) scale(1.1);
}

.cb-effort-busy .cb-effort-label { opacity: .55; }
.cb-effort-error { --cb-effort-accent: var(--dsw-alias-state-error-primary, #b42c3f); }
.cb-effort-error .cb-effort-label { color: var(--dsw-alias-state-error-primary, #b42c3f); }
@container (width <= 560px) {
  /* 收起文字标签，把省下的宽度全给轨道 —— 窄屏也不缩成一小截 */
  .cb-effort-label { display: none; }
  .cb-effort-track { width: 140px; }
  .cb-effort-knob { transform: translateX(calc(var(--cb-effort-pos) * 140px)); }
}
`;

// ── 组件 ──────────────────────────────────────────────────────
function CodeBuddySettings() {
  const [cfg, setCfg] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  // 深度探测默认关闭：一次「获取模型」= 每条候选一次真实计费请求，
  // 默认只探已知清单，猜新模型必须由用户显式勾选。
  const [deep, setDeep] = useState(false);
  const [note, setNote] = useState("");
  const abortRef = React.useRef(null);

  const load = useCallback(async () => {
    try {
      const v = await api();
      setCfg(v);
      setBaseURL(v.baseURL || "");
      setModels(v.models || []);
    } catch (e) {
      setMsg({ kind: "err", text: "读取配置失败：" + e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** 保存密钥。 */
  const saveKey = async () => {
    if (!apiKey.trim()) { setMsg({ kind: "err", text: "请先填写 API 密钥" }); return; }
    setBusy("save"); setMsg(null);
    try {
      await api("set-key", { apiKey: apiKey.trim() });
      setApiKey("");
      setMsg({ kind: "ok", text: "✅ 密钥已保存（写入 DSH 凭据库）" });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: "保存失败：" + e.message });
    } finally { setBusy(""); }
  };

  /**
   * 带上「还没保存」的草稿值：新用户粘贴密钥后直接点测试/获取模型也能用，
   * 不必先点保存。只带 sk-/ck- 字面量密钥 —— 环境变量名之类交给服务端从凭据库解析。
   */
  const draftPayload = (extra) => {
    const payload = Object.assign({}, extra);
    const k = apiKey.trim();
    if (/^(sk-|ck-)/.test(k)) payload.apiKey = k;
    if (baseURL.trim()) payload.baseURL = baseURL.trim();
    return payload;
  };

  /** 测试连通性。 */
  const testConn = async () => {
    setBusy("test"); setMsg(null);
    try {
      const v = await api("test", draftPayload({}));
      setMsg({ kind: v.ok ? "ok" : "err", text: v.message });
    } catch (e) {
      setMsg({ kind: "err", text: "测试失败：" + e.message });
    } finally { setBusy(""); }
  };

  /** 探测可用模型。 */
  const discover = async (force) => {
    if (busy) return;
    setBusy("discover"); setMsg(null);
    // 允许用户中途取消：AbortController 会把中断传到服务端，服务端再传进每个探测请求
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const v = await api("discover", draftPayload({ deep: deep, force: force === true }), ac.signal);
      setModels(v.models || []);
      const st = v.stats || {};
      // 成本可见：探测次数 / 命中 / 限流 / 超时
      const cost = `发送 ${st.probed ?? 0} 次计费请求 · 命中 ${st.hit ?? (v.models || []).length}` +
        (st.rate ? ` · 限流 ${st.rate}` : "") +
        (st.quota ? ` · 额度不足 ${st.quota}` : "") +
        (st.timeout ? ` · 超时 ${st.timeout}` : "") +
        (st.absent ? ` · 不存在 ${st.absent}` : "");
      let text;
      let kind;
      if (st.aborted) {
        // 用户主动取消**不是**配置错误，别再说「请检查密钥与网络」
        kind = "info"; text = "⏹ 已取消探测。" + cost;
      } else if (st.quotaStopped) {
        // 额度用尽是**永久失败**：必须说「去充值」，说「稍后重试」是误导
        kind = "err";
        text = "⛔ CodeBuddy 额度已用尽（网关 code 14018），探测已停止。" + cost
          + "　请到 codebuddy.cn 充值或购买加量包后再试。";
      } else if (st.deadlineHit) {
        // 总时限到点：结果不完整，但**不能**当成「模型不存在」（否则会误剔除可用模型）
        kind = "info";
        text = "⏱ 探测达到 60 秒总时限已中止，结果不完整。" + cost + "　可稍后重试。";
      } else if ((v.models || []).length) {
        kind = "ok"; text = `✅ 探测到 ${v.models.length} 个可用模型` + (st.cached ? "（缓存命中，0 请求）" : "") + `　|　${cost}`;
      } else if (st.throttleStopped) {
        kind = "err"; text = `⚠️ 触发限流已熔断（连续 429）。${cost}`;
      } else {
        kind = "info"; text = `未探测到模型。${cost}`;
      }
      // 只有「限流」才建议稍后重试；额度不足不能这么说
      if (st.throttleStopped && !st.quotaStopped) text += "　建议稍后重试，或先不勾选深度探测。";
      setMsg({ kind: kind, text: text });
      if (v.note) setNote(v.note);
    } catch (e) {
      if (e && e.name === "AbortError") setMsg({ kind: "info", text: "⏹ 已取消探测。" });
      else setMsg({ kind: "err", text: "探测失败：" + e.message });
    } finally { abortRef.current = null; setBusy(""); }
  };

  /** 取消正在进行的探测。 */
  const cancelDiscover = () => { if (abortRef.current) abortRef.current.abort(); };

  /** 清空探测缓存。 */
  const clearCache = async () => {
    setBusy("cache"); setMsg(null);
    try {
      const v = await api("discover-cache-clear", {});
      setMsg({ kind: "ok", text: `✅ 已清空探测缓存（${v.cleared} 条），下次探测将重新联网` });
    } catch (e) {
      setMsg({ kind: "err", text: "清空缓存失败：" + e.message });
    } finally { setBusy(""); }
  };

  /** 删除已保存的密钥。 */
  const clearKey = async () => {
    if (!window.confirm("确定删除已保存的 CodeBuddy API 密钥？")) return;
    setBusy("clearkey"); setMsg(null);
    try {
      const v = await api("clear-key", {});
      setMsg({ kind: v.cleared ? "ok" : "info", text: v.message });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: "删除失败：" + e.message });
    } finally { setBusy(""); }
  };

  if (!cfg) return h("div", { className: "cb-wrap" }, h("div", { className: "cb-hint" }, "加载中…"));

  return h("div", { className: "cb-wrap" },
    // 状态
    h("div", { className: "cb-row" },
      h("div", { className: "cb-label" }, "CodeBuddy 开放平台"),
      h("div", { className: "cb-hint" },
        cfg.hasKey ? "✅ 已配置 API 密钥" : "⚠️ 尚未配置 API 密钥",
        "　|　", "已收录 ", cfg.models?.length ?? 0, " 个模型")
    ),

    // API Key
    h("div", { className: "cb-row" },
      h("div", { className: "cb-label" }, "API 密钥"),
      h("input", {
        className: "cb-input",
        type: "password",
        placeholder: cfg.hasKey ? "已保存（留空则不修改）" : "粘贴你的 CodeBuddy API Key",
        value: apiKey,
        onChange: (e) => setApiKey(e.target.value),
        autoComplete: "off",
        spellCheck: false
      }),
      h("div", { className: "cb-hint" },
        "从 CodeBuddy 开放平台获取，通常以 ck_ 开头。密钥保存到 DSH 凭据库，不写入配置文件。")
    ),

    // BaseURL（只读展示：端点由 cordis.patch.yml / 环境变量决定，设置页无法修改）
    h("div", { className: "cb-row" },
      h("div", { className: "cb-label" }, "接口地址"),
      h("input", {
        className: "cb-input",
        type: "text",
        value: baseURL,
        readOnly: true,
        spellCheck: false
      }),
      h("div", { className: "cb-hint" },
        "只读。端点由 cordis.patch.yml 的 baseURL 决定；如需修改请改配置或设环境变量 CODEBUDDY_BASE_URL，然后重启 DSH。")
    ),

    // 按钮
    h("div", { className: "cb-btns" },
      h("button", { className: "cb-btn primary", onClick: () => saveKey(), disabled: busy || !apiKey.trim() },
        busy === "save" ? "保存中…" : "保存密钥"),
      h("button", { className: "cb-btn", onClick: testConn, disabled: busy },
        busy === "test" ? "测试中…" : "测试连接"),
      h("button", { className: "cb-btn", onClick: () => discover(false), disabled: busy },
        busy === "discover" ? "探测中…" : "获取模型"),
      busy === "discover" && h("button", { className: "cb-btn", onClick: cancelDiscover }, "取消"),
      cfg.hasKey && h("button", { className: "cb-btn", onClick: clearKey, disabled: busy },
        busy === "clearkey" ? "删除中…" : "删除密钥")
    ),

    // 探测成本控制
    h("div", { className: "cb-row" },
      h("label", { className: "cb-check" },
        h("input", {
          type: "checkbox",
          checked: deep,
          disabled: !!busy,
          onChange: (e) => setDeep(e.target.checked)
        }),
        h("span", null, "深度探测（尝试猜测尚未收录的新模型）")
      ),
      h("div", { className: "cb-hint" },
        deep
          ? "⚠️ 深度探测会逐条试全部候选，每条都是一次真实计费请求，耗时更长也更容易触发限流。"
          : "默认只探测已收录的 " + (cfg.models?.length ?? 0) + " 个模型；探测结果会缓存 30 分钟，重复点击 0 请求。"),
      h("div", { className: "cb-btns" },
        h("button", { className: "cb-btn", onClick: clearCache, disabled: !!busy },
          busy === "cache" ? "清理中…" : "清空探测缓存")
      )
    ),

    // 消息
    msg && h("div", { className: "cb-msg cb-" + msg.kind }, msg.text),
    note && h("div", { className: "cb-hint" }, note),

    // 模型列表
    models.length > 0 && h("div", { className: "cb-row" },
      h("div", { className: "cb-label" }, "可用模型（", models.length, "）"),
      h("div", { className: "cb-models" },
        models.map((m) => h("div", { className: "cb-model", key: m.id },
          h("span", null, "•"),
          h("code", null, m.id),
          m.name && m.name !== m.id ? h("span", { className: "cb-hint" }, m.name) : null,
          // 视觉能力对用户是决定性的（能不能贴图），必须显式标出
          (m.inputModalities || []).indexOf("image") >= 0
            ? h("span", { className: "cb-badge cb-badge-img" }, "视觉")
            : null,
          m.contextWindow ? h("span", { className: "cb-badge" }, Math.round(m.contextWindow / 1000) + "k") : null
        ))
      ),
      h("div", { className: "cb-hint" },
        "在「设置 → 模型」里选择 CodeBuddy 路由后即可使用这些模型。")
    )
  );
}

// ── 输入框底栏：推理等级拖动条 ────────────────────────────────
/*
 * 为什么是 `conversation.input.right` 而不是自己造一个位置：
 *   宿主把 model 座位渲染成 `renderSlot("conversation.input.model", …)`，它的
 *   左边紧邻 `renderSlot("conversation.input.right", {})`（dsh-client-ui-conversation
 *   InputBar 的 `.standardControls`）。占 right 槽 = 天然贴在模型选择器左侧，
 *   不碰任何宿主 DOM、不靠 CSS-module 哈希类名定位。
 *
 * 为什么必须复用 `ctx.modelDirectories`：
 *   弹框（dsh-client-ui-model-selection 的 ModelSelect）与这里是**同一个**
 *   每会话 ModelDirectory：同一份 store，同一个 `directory.select()`。
 *   - 默认档位天然一致：两边都算 `current.reasoningEffort ?? reasoning.defaultEffort`，
 *     而 defaultEffort 来自各适配器自己（CodeBuddy 是「次高档」，官方 DeepSeek 是
 *     connection.defaults.reasoningEffort），这里一行都不用复制。
 *   - 双向联动天然成立：拖动写进 select()，落定后 projection→store 更新，弹框的下次
 *     渲染就跟着变；反过来弹框选完 store 变了，这里的 index 也跟着变。
 *   若改用「自己存一个档位再拼进请求」的做法，两套状态必然漂移，正是要避免的。
 *
 * 提交时机：range 的 `input` 只更新本地预览（拖动跟手、零请求），
 * `change`（松手 / 键盘落定）才提交一次 —— 一次拖动只花一次 selectModel。
 */

/**
 * 把宿主的 reasoning 元数据摊成线性档位序列。
 *
 * ⚠️ `efforts` 为空 = 该模型不支持调档，必须返回**空数组**：
 * 宿主 `dsh-llm` 收到空 efforts 会直接抛 INVALID_MODEL_REASONING，所以 catalog 里
 * 根本不会出现这种模型；这里返回空是为了让拖动条整个不渲染，而不是画一个只能停
 * 在「Default」上的假滑块。
 * @param reasoning - catalog 里该模型的 `reasoning: { efforts, defaultEffort? }`
 * @returns {{effort: string|undefined, label: string}[]} 未声明 defaultEffort 时
 *   首项为 `{effort: undefined}`，即宿主语义里的「Provider Default」
 */
function effortChoicesOf(reasoning) {
  if (reasoning === undefined || reasoning === null) return [];
  const levels = Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
  if (levels.length === 0) return [];
  const out = [];
  if (reasoning.defaultEffort === undefined) out.push({ effort: undefined, label: "Default" });
  for (const level of levels) {
    if (level === null || level === undefined) continue;
    out.push({ effort: level.id, label: level.name || String(level.id) });
  }
  return out;
}

/**
 * 拖动条要渲染的全部状态 —— 纯函数，零 DOM、零 React。
 *
 * 这里的 `effectiveEffort` 与弹框（dsh-client-ui-model-selection 的 ModelSelect）
 * 是**同一个表达式**：
 *   `current.reasoningEffort ?? reasoning.defaultEffort`
 * 所以「默认等级」不需要另外维护一份配置：CodeBuddy 适配器给的 defaultEffort
 * 是次高档，官方 DeepSeek 适配器给的是 connection.defaults.reasoningEffort，
 * 两边都自动落到同一条链上。
 * @param reasoning - 该模型的 reasoning 元数据
 * @param current - 目录 store 的 `current`（`{provider, model, reasoningEffort?}` 或 null）
 * @returns 档位列表、当前档位、上下界与「是否只有一个档位」
 */
function effortSliderModel(reasoning, current) {
  const choices = effortChoicesOf(reasoning);
  const defaultEffort = reasoning === undefined || reasoning === null ? undefined : reasoning.defaultEffort;
  const declared = current === null || current === undefined ? undefined : current.reasoningEffort;
  const effectiveEffort = declared === undefined ? defaultEffort : declared;
  const found = choices.findIndex((choice) => choice.effort === effectiveEffort);
  return {
    choices: choices,
    effectiveEffort: effectiveEffort,
    // 宿主给了个不在列表里的档位（模型被换掉、catalog 过期）→ 停在首项，
    // 与弹框的 `at < 0 ? 0 : at` 保持一致，不猜也不抛
    effectiveIndex: found < 0 ? 0 : found,
    lastIndex: Math.max(0, choices.length - 1),
    fixed: choices.length <= 1
  };
}

/**
 * 推理等级拖动条的入口：会话不可用（子代理会话）时直接不渲染。
 *
 * 为什么要拆成两层：`useSyncExternalStore(subscribe, getSnapshot)` 是**无条件**调用的
 * hook，一旦 `directory` 为空就必须完全不进内层组件 —— 在内层 return null 也行，
 * 但 hook 顺序会随 available 变化而变化，React 会直接报错。拆层后每层自己的
 * hook 数量恒定。
 * @param props - `available` 与注入的目录面
 * @returns 拖动条或 null
 */


/**
 * 实际渲染拖动条：对外只暴露「读同一份 store、调同一个 select」。
 *
 * 提交时机是本组件最难的部分：React 把 `<input type="range">` 的 `onChange`
 * 接在原生 `input` 事件上（拖动过程中每移动一格都触发），所以**不能**用它提交 ——
 * 一次拖动会打出十几次 selectModel，还会互相覆盖。
 * 做法：手写原生监听器，并用非受控 value（默认值只在挂载时写入）——
 *   `input`  → 只更新标签文字与 CSS 填充，零请求
 *   `change` → 一次提交（原生 change 只在松手或键盘落定时触发）
 * @param props - 每会话目录（store / load / select）
 * @returns 拖动条，或 null（该模型没有档位、尚无当前模型）
 */
/**
 * 每一档的亮度窗口（呼吸灯的上下界），以及光晕的呼吸幅度。
 *
 * 用户的两条硬约束：
 *   · 亮度不得超过当前档位的最高亮度 → 窗口上限 = 本档的峰值
 *   · 最低亮度 = 前一档的最高亮度       → 窗口下限 = 前一档的峰值
 *
 * 所以只要把 [FLOOR, CEIL] 切成 (lastIndex+1) 份、让**每档各占一个峰值**，
 * 两条约束就同时成立，且每档都有一段真实宽度可以呼吸：
 *
 *   档位 i 的峰值 = FLOOR + STEP * (i + 1)
 *   档位 i 的下限 = 档位 i-1 的峰值（首档取全局 FLOOR）
 *
 * ⚠️ 这里踩过一个坑：最初把峰值写成 `FLOOR + STEP * i`，于是首档峰值 =
 * FLOOR，窗口变成 [FLOOR, FLOOR] —— 宽度为 0，首档**完全不呼吸**，
 * 而且看起来像"代码跑通了"（数值都对，只是没动画）。改成 `(i+1)` 才对。
 *
 * ⚠️ 第二个坑：亮度窗口受上面两条约束限制，**幅度天生就只有 0.144~0.18**
 * （档位越少越大，4 档时 0.18）。要把"呼吸"做得明显，只能在
 * 亮度之外再加大光晕（halo）的脉动幅度 —— 光晕是加性发光，
 * 不改变轨道本身的亮度语义，所以不违反约束。
 * @param index - 当前档位下标（0 起）
 * @param lastIndex - 最高档下标
 * @returns {{lumLo:number, lumHi:number, glowLo:number, glowHi:number,
 *            haloLo:number, haloHi:number}}
 */
function effortGlowWindow(index, lastIndex) {
  /** 全局最低亮度：再暗就糊进背景、找不到控件了。 */
  const FLOOR = 0.62
  /** 最高档的峰值：全区间最高也就到这里。 */
  const CEIL = 1.34
  /** 切成 (lastIndex + 1) 份，每档一个峰值 —— 首档也必须有非零宽度。 */
  const STEP = (CEIL - FLOOR) / (Math.max(0, lastIndex) + 1)
  /** 档位 i 的峰值（呼吸时的最亮点）。 */
  const peak = (i) => FLOOR + STEP * (i + 1)
  const clampIndex = Math.min(Math.max(index, 0), lastIndex)
  const lumHi = peak(clampIndex)
  // 下限 = 前一档的峰值；首档没有前一档 → 全局最低
  const lumLo = clampIndex === 0 ? FLOOR : peak(clampIndex - 1)

  /**
   * 辉光半径：单位 px。
   *
   * ⚠️ 这里不能像早期版本那样写成 `glowAt(lumLo) / glowAt(lumHi)` ——
   * 那样辉光摆幅会被亮度窗口一起压住（4 档时亮度只差 0.18，
   * 换算到辉光只有 3~4px，肉眼根本看不出在呼吸）。
   * 所以辉光基线按档位走（越右越亮），但**摆幅独立给足**：
   * 谷 = 基线 × 0.35，峰 = 基线 × 1.85，跨度约 1.5 倍基线。
   */
  const tierFrac = (clampIndex + 1) / (Math.max(0, lastIndex) + 1)
  const glowBase = 8 + tierFrac * 16
  const glowLo = glowBase * 0.35
  const glowHi = glowBase * 1.85

  /**
   * 光晕浓度：0..1。它决定 box-shadow 里 accent 色的不透明度，
   * 呼吸峰谷之间从 0.22 摆到 0.85，是"看得出在呼吸"的主要贡献者。
   */
  const haloLo = 0.22
  const haloHi = 0.85

  return {
    lumLo,
    lumHi,
    glowLo,
    glowHi,
    haloLo,
    haloHi
  }
}

/**
 * 把指针在轨道上的横坐标换算成 0..1 的连续比例。
 * @param clientX - 指针的视口横坐标
 * @param el - 轨道元素（用来取边界与宽度）
 * @returns {{ratio:number, pixels:number}} 夹到 0..1 的比例与实际像素位置
 */
function ratioFromPointer(clientX, el) {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return { ratio: 0, pixels: 0 }
  const raw = clientX - rect.left
  const ratio = Math.min(1, Math.max(0, raw / rect.width))
  return { ratio, pixels: ratio * rect.width }
}

/**
 * 推理等级拖动条的入口：会话不可用（子代理会话）时直接不渲染。
 *
 * 为什么要拆成两层：`useSyncExternalStore(subscribe, getSnapshot)` 是**无条件**调用的
 * hook，一旦 `directory` 为空就必须完全不进内层组件 —— 在内层 return null 也行，
 * 但 hook 顺序会随 available 变化而变化，React 会直接报错。拆层后每层自己的
 * hook 数量恒定。
 * @param props - `available` 与注入的目录面
 * @returns 拖动条或 null
 */
function EffortSlider({ available, directory, load, select }) {
  if (available !== true || directory === undefined || directory === null) return null;
  return h(EffortControl, { directory: directory, load: load, select: select });
}

/**
 * 实际渲染拖动条：读同一份 store、调同一个 select。
 *
 * ── 三段几何：为什么这样才不卡 ────────────────────────────────
 * 原生 `<input type="range">` 按 `step` 量化：4 个档位就只有 4 个停靠点，
 * 拖动时滑块只能一格一格地跳 —— 这就是「不流畅」的全部来源。
 * 换成自绘轨道后：
 *
 *   拖动中：pointermove → 直接改 DOM 上的 CSS 变量（`--cb-effort-pos`）
 *           与 `data-*` 属性。**完全不调 setState**，不触发 React 重渲染，
 *           所以指针动多少像素滑块就走多少像素，没有量化、没有丢帧。
 *   松手时：才把连续位置吸附到最近档位，并提交一次 selectModel。
 *
 * 呼吸灯也在这两条路径上分流：拖动中停掉呼吸（手控中的东西还在闪会晃眼），
 * 松手后按该档的亮度窗口重新起呼吸。
 * @param props - 每会话目录（store / load / select）
 * @returns 拖动条，或 null（该模型没有档位、尚无当前模型）
 */
function EffortControl({ directory, load, select }) {
  // subscribe / getSnapshot 必须是稳定引用：每次渲染新建闭包会让
  // useSyncExternalStore 每帧重订阅一次（正确但白烧一次 unsubscribe/subscribe）。
  const subscribe = useCallback((fn) => directory.subscribe(fn), [directory]);
  const getSnapshot = useCallback(() => directory.getSnapshot(), [directory]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const trackRef = useRef(null);
  const rootRef = useRef(null);
  /**
   * 拖动中的连续比例（0..1）。只在松手吸附时用于计算落点 ——
   * 它是 ref 不是 state，因为拖动过程中不能触发重渲染。
   */
  const posRef = useRef(0);
  /** 拖动中的档位序号，用于标签文字；同样只在松手/换档时才需要同步到 state。 */
  const [dragIndex, setDragIndex] = useState(null);
  const [settling, setSettling] = useState(false);
  const [revision, setRevision] = useState(0);
  const [errorText, setErrorText] = useState(null);
  const seqRef = useRef(0);
  const loadedRef = useRef(false);
  const draggingRef = useRef(false);

  const current = state.current;
  const providerId = current === null || current === undefined ? null : current.provider;
  const modelId = current === null || current === undefined ? null : current.model;

  // 档位元数据只从 catalog 的 groups 里取（与弹框同一来源，不另存一份）
  const reasoning = useMemo(() => {
    if (providerId === null) return undefined;
    for (const group of state.groups || []) {
      if (group.id !== providerId) continue;
      for (const model of group.models || []) {
        if (model.id === modelId) return model.reasoning;
      }
    }
    return undefined;
  }, [state.groups, providerId, modelId]);

  const choices = useMemo(() => effortChoicesOf(reasoning), [reasoning]);

  // 与弹框完全一致的当前档位表达式（见 ModelSelect 的 effectiveEffort）
  const slider = effortSliderModel(reasoning, current);
  const effectiveEffort = slider.effectiveEffort;
  const effectiveIndex = slider.effectiveIndex;
  const lastIndex = slider.lastIndex;
  const fixed = slider.fixed;

  const settledIndex = dragIndex === null ? effectiveIndex : dragIndex;
  const choice = choices[settledIndex];
  const pendingSelection = state.pending !== null && state.pending !== undefined;
  const failed = typeof state.error === "string" && state.error.length > 0;

  const glowWin = useMemo(
    () => effortGlowWindow(settledIndex, lastIndex),
    [settledIndex, lastIndex]
  );

  // catalog 只需主动拉一次；`load` 的标识随 owner 重渲染可能变化，
  // 所以用 ref 记账，避免 effect 反复触发（同步目录会回写 store）。
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    if (typeof loadRef.current === "function") loadRef.current();
  }, []);

  /** 把某个档位序号对应的比例直接写进 DOM（不经过 React）。 */
  const paintAt = useCallback((ratio) => {
    const root = rootRef.current;
    if (root === null) return;
    posRef.current = ratio;
    root.style.setProperty("--cb-effort-pos", String(ratio));
  }, []);

  /**
   * 呼吸灯：用 requestAnimationFrame 每帧写 --cb-lum / --cb-glow / --cb-halo。
   *
   * 为什么不用 CSS 动画：
   *   那条路要 @property 把自定义属性注册成可插值类型。插件样式表是运行期
   *   注入 <style> 的，一旦被后注入或被宿主覆盖，--cb-lum 就退化成普通字符串，
   *   动画与 filter: brightness(var(--cb-lum)) 一起失效 —— 元素可能直接不可见。
   *   真机上表现为"改了代码却什么都不显示"，很难定位。
   *   JS 每帧写变量没有这层依赖：只要元素在，值一定生效。
   *
   * 亮度严格限制在本档窗口 [lumLo, lumHi] 内；辉光与光晕用更大摆幅，
   * 因为亮度窗口受"不越过前一档"约束、幅度天生很小，单靠亮度看不出呼吸。
   */
  useEffect(() => {
    if (fixed) return undefined;
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return undefined;
    // 系统要求减少动态效果时不做呼吸
    const reduce = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return undefined;

    const { lumLo, lumHi, glowLo, glowHi, haloLo, haloHi } = glowWin;
    const PERIOD = 2600;
    let raf = 0;
    let start = 0;

    const frame = (now) => {
      const root = rootRef.current;
      if (root === null) { raf = window.requestAnimationFrame(frame); return; }
      if (start === 0) start = now;
      // 0..1 的三角波：ease-in-out 感更接近"吸进去再吐出来"
      const t = ((now - start) % PERIOD) / PERIOD;
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
      const eased = tri * tri * (3 - 2 * tri); // smoothstep
      // 拖动中钉在峰值、不呼吸（手控中的东西还自顾自闪会晃眼）
      const k = draggingRef.current ? 1 : eased;
      root.style.setProperty("--cb-lum", String(lumLo + (lumHi - lumLo) * k));
      root.style.setProperty("--cb-glow", (glowLo + (glowHi - glowLo) * k) + "px");
      root.style.setProperty("--cb-halo", String(haloLo + (haloHi - haloLo) * k));
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [fixed, glowWin]);

  // 宿主真值变了 / 换档后 → 把位置对齐到该档，并应用这一档的亮度窗口。
  // （吸附动画只在 settling 时启用；平时直接落位，避免"自己慢慢滑过去"）
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    root.style.setProperty("--cb-lum-lo", String(glowWin.lumLo));
    root.style.setProperty("--cb-lum-hi", String(glowWin.lumHi));
    root.style.setProperty("--cb-glow-lo", glowWin.glowLo + "px");
    root.style.setProperty("--cb-glow-hi", glowWin.glowHi + "px");
    root.style.setProperty("--cb-halo-lo", String(glowWin.haloLo));
    root.style.setProperty("--cb-halo-hi", String(glowWin.haloHi));
    // 拖动中不覆盖用户手里的位置
    if (!draggingRef.current) {
      const ratio = lastIndex > 0 ? settledIndex / lastIndex : 1;
      paintAt(ratio);
    }
  }, [settledIndex, lastIndex, glowWin, revision, paintAt]);

  /**
   * 提交一个档位。失败的文案留在 title 上，不弹 toast 抢输入焦点。
   * @param at - 目标档位下标
   */
  const commit = useCallback(async (at) => {
    const target = choices[at];
    if (target === undefined || current === null || current === undefined) return;
    if (target.effort === effectiveEffort) return;
    const mine = ++seqRef.current;
    try {
      const result = await select({
        provider: current.provider,
        model: current.model,
        ...(target.effort === undefined ? {} : { reasoningEffort: target.effort })
      });
      if (result !== undefined && result !== null && result.ok === false) {
        const error = result.error || {};
        setErrorText(error.code === "session-writer-held"
          ? "会话正在写入，稍后再试"
          : (error.message || "切换推理等级失败"));
        // 失败：把位置弹回宿主真值
        if (seqRef.current === mine) {
          setSettling(true);
          setDragIndex(null);
          setRevision((n) => n + 1);
        }
        return;
      }
      setErrorText(null);
    } catch (error) {
      setErrorText((error && error.message) || "切换推理等级失败");
      if (seqRef.current === mine) {
        setSettling(true);
        setDragIndex(null);
        setRevision((n) => n + 1);
      }
    }
  }, [choices, current, effectiveEffort, select]);

  // 指针交互：全程不 setState，只改 DOM；松手才吸附 + 提交
  useEffect(() => {
    const track = trackRef.current;
    const root = rootRef.current;
    if (track === null || root === null || fixed) return undefined;

    /** 松手（或点击）时把连续位置吸到最近档位。 */
    const settleFromPointer = (clientX) => {
      const { ratio } = ratioFromPointer(clientX, track);
      const at = Math.round(ratio * lastIndex);
      const targetRatio = lastIndex > 0 ? at / lastIndex : 1;
      // 先吸附到格点（带动画），再提交
      setSettling(true);
      paintAt(targetRatio);
      setDragIndex(at);
      commit(at);
      // 动画结束后关掉过渡，恢复"跟手"状态
      window.setTimeout(() => setSettling(false), 280);
    };

    const onDown = (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      track.setPointerCapture?.(event.pointerId);
      draggingRef.current = true;
      root.dataset.dragging = "1";
      root.dataset.settling = "0";
      // 按下即跳到该点（跟手第一帧）
      const { ratio } = ratioFromPointer(event.clientX, track);
      paintAt(ratio);
    };

    const onMove = (event) => {
      if (!draggingRef.current) return;
      // ★ 关键：这里只改 CSS 变量，不 setState。这是"连续不卡"的根本。
      const { ratio } = ratioFromPointer(event.clientX, track);
      paintAt(ratio);
    };

    const onUp = (event) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      root.dataset.dragging = "0";
      root.dataset.settling = "1";
      track.releasePointerCapture?.(event.pointerId);
      settleFromPointer(event.clientX);
    };

    const onCancel = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      root.dataset.dragging = "0";
      // 取消视为放弃：回到宿主真值
      setSettling(true);
      setDragIndex(null);
      setRevision((n) => n + 1);
      window.setTimeout(() => setSettling(false), 280);
    };

    // 键盘：方向键一次一档，Home/End 到两端（可访问性，也是"精确选择"路径）
    const onKeyDown = (event) => {
      const base = dragIndex === null ? effectiveIndex : dragIndex;
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(lastIndex, base + 1);
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, base - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = lastIndex;
      if (next === null) return;
      event.preventDefault();
      setSettling(true);
      paintAt(lastIndex > 0 ? next / lastIndex : 1);
      setDragIndex(next);
      commit(next);
      window.setTimeout(() => setSettling(false), 280);
    };

    track.addEventListener("pointerdown", onDown);
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onCancel);
    track.addEventListener("keydown", onKeyDown);
    return () => {
      track.removeEventListener("pointerdown", onDown);
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onCancel);
      track.removeEventListener("keydown", onKeyDown);
    };
  }, [choices, commit, dragIndex, effectiveIndex, fixed, lastIndex, paintAt]);

  // 宿主真值落定后清掉本地拖动残留
  useEffect(() => {
    if (dragIndex !== null && dragIndex === effectiveIndex) setDragIndex(null);
  }, [dragIndex, effectiveIndex]);

  if (current === null || current === undefined || choice === undefined) return null;

  const className = "cb-effort"
    + (pendingSelection ? " cb-effort-busy" : "")
    + (failed ? " cb-effort-error" : "");
  // 首帧位置：直接按档位算，避免"先 0 位再滑过去"的闪烁
  const ratio = lastIndex > 0 ? settledIndex / lastIndex : 1;

  return h("div", {
    ref: rootRef,
    className: className,
    "data-dsh-codebuddy-effort": "",
    "data-effort-id": choice.effort === undefined ? "" : String(choice.effort),
    "data-effort-index": String(settledIndex),
    "data-effort-count": String(choices.length),
    "data-dragging": "0",
    "data-settling": settling ? "1" : "0",
    style: {
      "--cb-effort-pos": String(ratio),
      "--cb-lum-lo": String(glowWin.lumLo),
      "--cb-lum-hi": String(glowWin.lumHi),
      "--cb-glow-lo": glowWin.glowLo + "px",
      "--cb-glow-hi": glowWin.glowHi + "px",
      "--cb-halo-lo": String(glowWin.haloLo),
      "--cb-halo-hi": String(glowWin.haloHi)
    }
  },
    h("span", {
      className: "cb-effort-label",
      title: "推理等级：" + choice.label
    }, choice.label),
    h("div", {
      ref: trackRef,
      className: "cb-effort-track",
      role: "slider",
      tabIndex: 0,
      "aria-label": "推理等级",
      "aria-valuemin": 0,
      "aria-valuemax": lastIndex,
      "aria-valuenow": settledIndex,
      "aria-valuetext": choice.label,
      title: errorText
        ? "上次切换失败：" + errorText
        : "拖动调整推理等级（" + choices.map((c) => c.label).join(" → ") + "）"
    },
      h("div", { className: "cb-effort-rail" }),
      h("div", { className: "cb-effort-fill" }),
      h("div", { className: "cb-effort-knob" })
    )
  );
}

// ── 插件入口 ──────────────────────────────────────────────────
// ⚠️ `sessions` 必须出现在 `ctx.inject([...])` 的声明列表里（下面那处）。
//
// cordis 对**未声明**的服务访问不是返回 undefined，而是直接抛
// `cannot get property "sessions" without inject`（见 vendor/cordis 的
// ReflectService.handler.get）。首版把 `const sessions = scope.sessions` 写在
// `ctx.inject(["slots","modelDirectories"], scope => {...})` 的回调**开头**，
// 而那个作用域没声明 sessions —— 于是回调第一行就抛，
// `scope.slots.register(...)` 一次都没执行，槽位压根没注册。
//
// 实测复现（照抄本文件结构，只改声明列表）：
//   漏 sessions → apply 执行了，slots.register 调用 0 次
//   含 sessions → apply 执行了，slots.register 调用 1 次
//
// 所以症状是「底栏完全不出现、且控制台干净」——异常被 cordis 记进 fiber，
// 没有冒到浏览器控制台。这种静默失败只有回归测试守得住（见 test/slider.test.mjs）。
//
// 顶层这里也一并声明：它是真实的依赖，声明了才能保证 apply 在 sessions 就绪后才跑。
// ⚠️ `remote` / `remote.session` 也是真实依赖，且**必须**在这里声明。
//
// `modelDirectories.directoryFor()` 内部读的是 `this.ctx.remote.session`，
// 而 cordis 的 Service 代理把 `ctx` 绑成**调用方**的 fiber —— 也就是说这一读
// 用的是本插件的注入表。漏声明时不是返回 undefined，而是直接抛
// `Cannot get property "remote.session" without inject`，
// 被 inject 回调的 try/catch 吃掉 → 返回 {available:false} → 组件静默不画。
// 现场证据（用户 DevTools）：
//   [dsh-codebuddy] ...取模型目录失败 Error: Cannot get property "remote.session"
//     without inject   at Proxy.directoryFor (client.js)
// 官方 model-selection 插件的 inject 同样含 "remote"、"remote.session"。
const inject = ["slots", "locale", "sessions", "remote", "remote.session"];

function apply(ctx) {
  // 样式注入。
  //
  // ⚠️ 这里曾经是「标签已存在就直接 return」的写法，那是个真 bug：
  // 插件热更新 / 重新挂载时旧的 <style> 还挂在 head 上，新 CSS 就被整段跳过，
  // 页面继续用着上一版的样式 —— 改了轨道粗细、呼吸幅度却完全看不到变化，
  // 而且现象是「代码明明改了、界面没动」，极难判断。
  // 现在每次挂载都**替换**旧标签，保证样式与代码同源。
  ctx.effect(() => {
    const id = "dsh-codebuddy/client";
    const previous = document.querySelector('style[data-plugin-css="' + id + '"]');
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-codebuddy";
    style.dataset.pluginCss = id;
    style.textContent = CSS;
    if (previous !== null) previous.replaceWith(style);
    else document.head.appendChild(style);
    return () => { style.remove(); };
  }, "dsh-codebuddy: styles");

  // 设置页分区
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "dsh-codebuddy",
    order: 46,
    label: () => "CodeBuddy",
    inject: () => ({}),
  }, CodeBuddySettings));

  // 输入框底栏的推理等级拖动条。
  //
  // 这里刻意**不**只对 CodeBuddy 生效：`modelDirectories` 是所有 provider 共用的
  // 每会话目录，官方 DeepSeek 账号、CodeBuddy、任何第三方适配器都走同一个模型
  // 选择器与同一套 reasoning 元数据。所以只要有档位就能拖 —— 装了这个插件
  // 就能在底栏直接换档，不必再为「dsh 原本的模型」单独开一份实现。
  //
  // 非 CodeBuddy 路由时组件照常工作，只是读宿主自己声明的档位表
  // （例如官方 deepseek-flash 的 off/low/high/max），行为与弹框完全一致。
  // 作用域声明必须与顶层保持一致：`remote`/`remote.session` 缺一不可
  // （directoryFor 会用**本作用域**去读 ctx.remote.session）。
  ctx.inject(["slots", "modelDirectories", "sessions", "remote", "remote.session"], (scope) => {
    const models = scope.modelDirectories;
    // ⚠️ 这一行是首版故障的现场：它必须在**本作用域的 inject 列表**里再取。
    // 列表漏了 sessions 时，这行会抛 `cannot get property "sessions" without inject`，
    // 下面整个 register 一次都不执行（实测：注册 0 次）。
    const sessions = scope.sessions;
    scope.slots.inject("conversation.input.right", () => scope.slots.register({
      name: "conversation.input.right",
      id: "codebuddy-effort",
      // 负序：排在 right 槽最前，紧贴模型选择器的左缘
      order: -100,
      inject: (sessionId) => {
        if (sessionId === undefined) return { available: false };
        // 子代理会话没有可路由的模型目录：与 model 座位同一判据
        if (sessions.subagentAddress(sessionId) !== undefined) return { available: false };
        let directory;
        try {
          directory = models.directoryFor(sessionId);
        } catch (error) {
          // 只有「会话还没绑定」（重建中 / 已关闭）才允许安静地不画。
          // 其它异常必须打出来 —— 不要再把结构性错误伪装成「不可用」。
          const message = String((error && error.message) || error);
          if (!/resolved no (scope|binding)/.test(message)) {
            console.error("[dsh-codebuddy] 推理等级拖动条：取模型目录失败", error);
          }
          return { available: false };
        }
        return {
          available: true,
          directory: directory.store,
          load: () => { directory.load().catch(() => {}); },
          select: (selection) => directory.select(selection)
        };
      }
    }, EffortSlider));
  });
}

exports.apply = apply;
exports.inject = inject;
/** 纯函数交给测试用（浏览器侧不读这个导出）。 */
exports.__test__ = { effortChoicesOf, effortSliderModel };

return module.exports;
}});
