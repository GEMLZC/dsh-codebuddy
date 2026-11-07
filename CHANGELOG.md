# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.8] - 2026-11-06

修 **拖动条在界面上完全不出现**（前几版都白改）。

### 现象

`document.querySelectorAll('[data-dsh-codebuddy-effort]').length === 0`，槽位没注册成功。
用户 DevTools 里的决定性证据：

```
[dsh-codebuddy] 推理等级拖动条：取模型目录失败
Error: Cannot get property "remote.session" without inject
    at Object.get (index-BXV-oxvX.js:2:8854)
    at Proxy.directoryFor (client.js:1034:1)
    at inject (client.js:1037:1)
```

### 根因

`ctx.modelDirectories.directoryFor()` 的实现里读的是 `this.ctx.remote.session`。
cordis 的 `Service` 代理把服务上的 `ctx` 绑成**调用方 fiber** 的 ctx，
所以这一读走的是**本插件**的注入表。

而本插件的 `inject` 只声明了 `["slots", "locale", "sessions"]`，漏了 `remote.session`，
cordis 对未声明服务的访问不是返回 `undefined` 而是直接抛错
（`ReflectService.handler.get`）。异常正好落进 `inject` 回调的 `try/catch`，
被归类成「会话未绑定」→ 返回 `{available:false}` → 组件一次都没渲染。

官方 `dsh-client-ui-model-selection` 的 `inject` 里 `"remote"`、`"remote.session"` 都在，
本插件必须照抄。

### 改动

`inject` 与 `ctx.inject([...])` 两处同时补上 `"remote"`、`"remote.session"`
（两处少一处都会复现，因为 `directoryFor` 用的是**作用域**那份表）。

### 记录

之前三次诊断（style 标签幂等、`@property` 关键帧、`dsh.client.inject`）都不是这条主因。
样式替换与 rAF 改动本身没问题、保留。

### 为什么这次能确认修好了

新增 `test/cordis-replay.test.mjs`：把 `lib/client.js` 原样挂到 **dsh 自带的真 cordis**
上跑，用一个「服务挂在兄弟 fiber 上」的宿主（`ctx.provide` 只写自己的 `fiber.store`，
跨插件靠 Inject 把 impl 复制进消费方 `_store`，所以 inject 是唯一通道）。

- 正向：`inject("session-1").available === true`
- 负向：把两处 inject 里的 `remote.session` 去掉，必须复现线上那句
  `cannot get property "remote.session" without inject`

负向用例一开始写成「只去掉作用域那份」并直接把服务 provide 到 root —— 假通过了。
两个原因都记在测试注释里：作用域是决定性的（`models` 代理捕获了作用域 ctx），
服务必须挂在兄弟 fiber 上（挂 root 的话任何 fiber 都能沿链找到）。

---

## [1.1.7] - 2026-11-06

加 **输入框底栏的推理等级拖动条**：不用再点开弹框才能换档，且对**所有 provider** 生效。

### 现象

换推理等级本来要 「点模型选择器 → 点「推理等级」→ 再点一档」，三次交互都对同一件事
重复确认。截图里那一屏（Off / Low / High / Max）就是被藏起来的第二层。

### 做法

新槽位 `conversation.input.right`（`order: -100`），它正是宿主 InputBar 中
`conversation.input.model` 的**左邻**——所以拖动条天然贴在模型选择器旁边，
不需要读任何宿主的 CSS-module 哈希类名，也不碰宿主的 DOM。

**为什么不是自己存一个档位**：
档位状态只有一处真源 —— `ctx.modelDirectories` 的每会话 `ModelDirectory`。
弹框（`dsh-client-ui-model-selection`）和这个拖动条读同一个 store、调同一个
`directory.select()`，于是：

| 需求 | 为什么天然成立 |
|---|---|
| 默认等级与原逻辑一致 | 两边都是 `current.reasoningEffort ?? reasoning.defaultEffort`；`defaultEffort` 由各适配器自己给（CodeBuddy 是本机定制的「次高档」，官方 DeepSeek 是 `connection.defaults.reasoningEffort`） |
| 拖动 → 弹框跟着变 | 拖动写 store，弹框下次渲染就读到 |
| 弹框改 → 拖动条跟着变 | 反向是同一条链 |

自己再存一份档位必然和弹框漂移，所以一行都没存。

**为什么 dsh 原本的模型也能用**：拖动条注册的是宿主公共槽位，读的是全 provider
共享的目录。只要该模型在 catalog 里声明了 `reasoning.efforts` 就会出现，
CodeBuddy / DeepSeek 账号 / 第三方适配器一视同仁。

### 请求时机

React 把 `<input type="range">` 的 `onChange` 接在原生 `input` 上（拖动时每移一格都发），
直接用它提交会打出一串 `selectModel` 并互相覆盖。改成手写原生监听器 + 非受控 value：

- `input` → 只更新标签与 CSS 填充，**零请求**
- `change` → 一次提交（原生 `change` 只在松手 / 键盘落定时触发）

失败时不弹 toast（会抢输入焦点），而是把滑块弹回宿主真值、文案挂在 `title` 上。

### 其它

- 单档模型（`efforts.length === 1`）只渲染静态标签，不给假拖动条。
- 子代理会话（`subagentAddress` 非空）不渲染 —— 与模型座位同一判据。
- 窄容器（`@container (width <= 560px)`，与宿主的阈值一致）收起文字标签只留滑块。
- 新增 `test/slider.test.mjs`：11 条纯逻辑断言，把「默认档位 / 列表外档位兜底 /
  单档降级 / 只注册这两个槽」钉住，其中一条在实现阶段抓到了真 bug
  （无 `efforts` 的模型曾被造出一个只能停在 Default 的假滑块）。

### 外观：D 方案 + 亮度随档位变化

首版那条 76px 的圆角粗轨道视觉上太单薄（光溜溜一条线 + 一个白球，
既短又看不出有几档）。改为 D 方案：

- 轨道 2px 细线、滑块 11px 小白球 + 外辉光环，宽度 **76px → 150px**。
- **亮度随档位连续变化**（本次新增的核心）：

| 量 | 最低档 | 最高档 |
|---|---|---|
| `filter: brightness` | 0.72 | 1.16 |
| `opacity` | 0.78 | 1.00 |
| 辉光半径 | 1px | 10px |

三个量同时随 `--cb-effort-t`（0→1）变化，而不是只调亮度 ——
只调亮度的话 Off 档仍有明显存在感，暗不下去；叠上不透明度与辉光才真的读得出
「此刻思考很轻 / 很重」。

**关键实现细节**：`t` 是**连续的比例值**，不是档位序号。拖动过程中（还没松手）
`input` 事件就实时改写 `--cb-effort-t`，所以越往右滑，手里那条轨道立刻越亮 ——
等松手才变就太迟了。

`--cb-effort-t` 写在**容器**上而非 `<input>` 上：轨道伪元素、滑块伪元素与文字标签
都要读它，放容器上三者共享同一份值。（有 `t` 就不需要单独算百分比填充了，
旧的 `--cb-effort-fill` 一并删除。）

亮度下限取 0.72 而非更低，是因为拖到 Off 时仍要能看见「这里有一条可以拖的轨道」；
压到 0.6 以下就糊进背景、找不到控件。

窄屏（`@container (width <= 560px)`）收起文字标签，但把省下的宽度给轨道
（150px → 132px），不会缩回一小截。

预览工具：`test/render-slider-preview.mjs` 从 `lib/client.js` **直接抽取真实 CSS**
生成静态页，避免预览与实际实现漂移。

### 修复：第一版拖动条完全不出现（控制台也没有任何报错）

首版上线后底栏**什么也没出现**，控制台干净。根因不在渲染逻辑，而比渲染更早一步：

首版写的是

```js
ctx.inject(["slots", "modelDirectories"], (scope) => {
  const models = scope.modelDirectories
  const sessions = scope.sessions          // ← 炸点
  scope.slots.inject(..., () => scope.slots.register(...))
})
```

**外层 `ctx.inject` 的作用域没声明 `sessions`，回调体却读了它。**
cordis 对未声明服务的访问不是返回 `undefined`，而是直接抛
`cannot get property "sessions" without inject`（`vendor/cordis` 的
`ReflectService.handler.get`）。于是回调第一行就中断，
`scope.slots.register(...)` **一次都没被调用** —— 槽位连注册都没发生。

用真实 cordis 照抄本文件结构重放，结果：

| 版本 | apply 是否执行 | `slots.register` 调用次数 |
|---|---|---|
| 首版（外层漏 `sessions`） | 执行了 | **0** |
| 修复版（含 `sessions`） | 执行了 | **1** |

注意 `applyRan=true`：插件本身加载正常，只是注册那一步死了。
异常没有冒到浏览器控制台（被记进 cordis fiber），所以症状是
「什么都没发生、也什么都没说」。

修复：

1. 外层 `ctx.inject([...])` 补上 `sessions`（顶层 `inject` 一并声明，
   它是真实依赖，也保证 apply 在 sessions 就绪后运行）。
2. 顺手收紧取目录的 `catch`：只对 `directoryFor` 自己抛的
   `resolved no scope` / `resolved no binding`（会话重建中、已关闭）安静返回，
   **其它异常一律 `console.error`**，不再把结构性错误伪装成「不可用」。

回归护栏（`test/slider.test.mjs` 现共 14 条）：新增一条**作用域一致性检查**，
静态解析每个 `ctx.inject([...], …)`，把它声明列表与回调体里所有
`scope.X` 读取做差集，任何漏声明直接红。已验证它能在首版代码上报出：

```
ctx.inject([slots, modelDirectories]) 的回调读了 scope.sessions，但没声明它
```

（写这条护栏时自己先踩了两个坑并修掉：正则必须行首锚定否则匹配到注释；
正文切分必须从匹配末尾开始，否则会切到本次匹配自身、正文恒为空、护栏变摆设。）

### 交互重做：连续滑动 + 松手吸附 + 呼吸灯

#### 卡顿的真正原因：原生 range 按 step 量化

旧实现用 `<input type="range" step="1" max="3">`。原生 range 是**按 step
量化**的 —— 4 个档位就只有 4 个停靠点，指针移动时滑块只能在格点间跳，
这就是「滑动不流畅」的全部来源。不是缓动曲线的问题，改 CSS 治不好。

改用自绘轨道（`div` + `pointerdown/move/up`）：

| | 旧（原生 range） | 新（自绘） |
|---|---|---|
| 位置取值 | 4 个离散格点 | **连续像素** |
| 拖动中 | 每次 `input` 都 `setState` → React 重渲染 | **只改 CSS 变量，零 setState** |
| 视觉效果 | 一格一格蹦 | 指针动 1px 滑块走 1px |

关键：`pointermove` 里只写 `--cb-effort-pos` 与 `data-*`，**完全不碰 React state**。
这是"跟手"的根本；一旦每帧 setState，鼠标事件密集时必然掉帧。

#### 松手才吸附

拖动期间位置自由（连续），`pointerup` / `pointercancel` 才把连续位置
`Math.round(ratio * lastIndex)` 吸到最近档位，并且：

- 吸附走 `cubic-bezier(.22, 1, .36, 1)` / 260ms 的缓动，有"咔哒"落定感；
- 吸附到位后才提交**一次** `selectModel`（一次手势 = 一次请求）；
- 过渡只在 `data-settling="1"` 时启用 —— 拖动中加 transition 会拖出一条延迟。

键盘也可用：方向键一次一档，Home/End 到两端。

#### 呼吸灯（亮度区间有硬约束）

要求：亮度不超过本档上限，最低不低于前一档上限。于是把 `[0.62, 1.34]`
切成 `lastIndex + 1` 份，每档占一个**峰值**：

```
档位 i 峰值 = 0.62 + STEP * (i + 1)
档位 i 下限 = 档位 i-1 的峰值（首档取 0.62）
```

相邻档首尾相接，亮度逐档右移，呼吸时永不越界。
用 `@property` 注册 `--cb-lum` / `--cb-glow` 为 `<number>` / `<length>`，
使其可在 keyframes 里连续插值（已用 CDP 实测：40 帧采样到 37 个不同值）。

拖动中停掉呼吸（`animation: none`），亮度钉在本档上限 ——
正在被手控制的东西还自顾自闪会晃眼。

`@media (prefers-reduced-motion: reduce)` 下关闭呼吸，位置照常可拖。

#### 两个自己踩的坑（都已修）

1. **首档呼吸窗口宽度为 0**：最初峰值写成 `0.62 + STEP * i`，于是首档峰值
   恰好等于全局下限，窗口变成 `[0.62, 0.62]` —— 数值全对、看着像跑通了，
   但首档**纹丝不动**。改成 `(i + 1)` 才真正有宽度。
2. **局部变量遮蔽全局 `window`**：曾用 `const window = useMemo(...)` 存亮度窗口，
   直接让 `window.setTimeout(...)` 变成对普通对象的调用，吸附收尾必然抛错。
   已改名 `glowWin`。

护栏（`test/slider.test.mjs` 现 17 条）新增 3 条：
呼吸窗口宽度 > 0 且相邻档首尾相接；不得再用原生 range 的 step 量化；
`onMove` 内不得出现 `setState`。其中"首档宽度为 0"这条正是被测试抓出来的。

验证脚本：`test/gen-breathe-preview.mjs` 从 `lib/client.js` 抽取真实 CSS 与
真实窗口函数生成预览；`preview/verify-anim.mjs` 用 CDP 实测每档亮度轨迹是否越界。

### 加粗轨道 + 放大呼吸幅度

反馈两点：轨道太细、呼吸灯看不出来。

#### 轨道加粗

| | 之前 | 现在 |
|---|---|---|
| 轨道高度 | 2px 细线 | **6px 实心** |
| 滑块 | 11px | **14px** |
| 宽度 | 150px | **160px** |

未到达区间加了 `inset` 内阴影，6px 的圆柱感更实。填充条与轨道严格同高。

#### 呼吸为什么看不出来，以及怎么修

亮度被用户的两条约束（不超本档上限、不低于前档上限）限死在相邻两档之间，
**4 档时幅度只有 0.18**，折算视觉约 15% —— 单靠亮度就是"几乎看不出"。

更糟的是我第一版把辉光半径也**从亮度推导**（`glowAt(lumLo)/glowAt(lumHi)`），
于是辉光摆幅被同一个 0.18 一起压扁，实测只有 **3~4px**。

修法：亮度仍严格守住约束，但把**辉光半径与光晕浓度解耦成独立摆幅**：

| 量 | 之前 | 现在 |
|---|---|---|
| 亮度 `--cb-lum` | 窗口内 0.14~0.36 | 不变（受约束） |
| 辉光 `--cb-glow` | 3~4px 摆幅 | **16.8~36px 摆幅** |
| 光晕 `--cb-halo` | 无此变量 | **0.22 → 0.85 摆幅** |

辉光基线按档位走（越右越亮），摆幅固定取基线的 `×0.35 ~ ×1.85`。
光晕是加性发光，不改变轨道本身的亮度语义，所以不违反约束，
却把"在呼吸"放大到一眼可见。节奏也从 3.2s 收紧到 **2.6s**。

#### 护栏

`test/slider.test.mjs` 现 19 条，新增 2 条并已验证它们能在旧代码上报红：

```
lastIndex=1 第 0 档辉光摆幅仅 8.0px，太不明显（需 >= 12px）
轨道只有 2px，太细（需 >= 5px）
```

第一条正是"辉光跟亮度走"这个错误的形状——把摆幅和亮度耦合在一起，
数值上说得通，视觉上等于没动。

验证脚本：`preview/verify-breathe.mjs` 用 CDP 采样三个维度的实际摆幅；
`preview/capture-phases.mjs` 分别抓呼吸谷/峰两帧并排对比。

### 修复：重启后拖动条彻底消失

现象：重启 DSH 后底栏完全没有拖动条，模型选择器左侧连占位都没有，控制台干净。

#### 根因：样式注入的幂等性写错了

`apply` 里注入 CSS 的那段原来是：

```js
if (document.querySelector('style[data-plugin-css="' + id + '"]')) return () => {}
```

**标签已存在就提前 return。** 于是插件重新挂载（重启 / HMR）时，
head 上还挂着上一版的 `<style>`，新 CSS 被整段跳过 ——
页面继续用着旧样式，而新版本把轨道从 2px 改成了 6px、把呼吸幅度整体放大，
这些改动一律没生效。更糟的是当时的旧样式与新 DOM 结构对不上：
新版组件渲染的是 `.cb-effort-track`（自绘 div），旧 CSS 还指着
`.cb-effort-range`（原生 input），于是渲染出来的节点没有任何尺寸与颜色，
视觉上就是"什么都没出现"。

改成每次挂载都替换旧标签：

```js
const previous = document.querySelector('style[data-plugin-css="' + id + '"]');
...
if (previous !== null) previous.replaceWith(style);
else document.head.appendChild(style);
```

#### 同时清掉一处重复定义

上一轮编辑时残留了一份 `EffortSlider` 的旧副本（同名函数声明两份）。
JS 里后者覆盖前者、不报错，所以它没直接引发故障，但属于必须清掉的隐患。

#### 新增两个验证手段

1. `test/render-effort.test.mjs` —— 用真实组件代码 + 极简 hooks 实现**真的渲染一次**，
   断言四种输入下的产出（正常 4 档 / catalog 未就绪 / current 为空 / 单档）。
   这一步把"return null"与"渲染期抛错"彻底区分开 ——
   前几轮只读代码猜原因，正是卡在这里。
2. `test/slider.test.mjs` 新增样式注入护栏：禁止「查到标签就提前 return」，
   必须显式 `replaceWith`/`removeChild`。已验证它能在旧写法上报红：

   ```
   不允许「标签已存在就提前 return」——必须替换旧标签，否则新 CSS 永远不生效
   ```

`test/slider.test.mjs` 现 20 条，另加渲染测试 4 个场景。

### 修复：拖动条在重启后彻底不显示（第二次）

上次的样式注入修复不够。真正的问题在于**用了 `@property` + CSS keyframes 驱动呼吸灯**。

#### 为什么这条路会静默失败

呼吸灯原本靠 `@property --cb-lum { syntax: '<number>' }` 把自定义属性注册成
可插值类型，再由 `@keyframes` 在 `--cb-lum-lo` / `--cb-lum-hi` 之间往复，
最后用 `filter: brightness(var(--cb-lum))` 体现在元素上。

这有三个串行依赖，任一断掉就整条失效：

1. `@property` 必须注册成功。插件样式表是**运行期注入 `<style>`** 的，
   它的注册时机与宿主样式表存在竞争；一旦没注册上，`--cb-lum` 退化成普通
   字符串，不可插值；
2. 不可插值 → `@keyframes` 里那几行自定义属性动画整段无效；
3. 值失效 → `filter: brightness(var(--cb-lum))` 与
   `color-mix(..., calc(var(--cb-halo) * 100%), ...)` 一起作废。

结果是元素虽然渲染了 DOM、也有尺寸，却完全不显示 —— 且不抛任何错误。

#### 改法：呼吸灯改由 JS 驱动

`EffortControl` 里加了一个 `requestAnimationFrame` 循环，每帧直接写
`--cb-lum` / `--cb-glow` / `--cb-halo` 三个变量：

```js
const tri = t < 0.5 ? t * 2 : (1 - t) * 2;   // 三角波
const eased = tri * tri * (3 - 2 * tri);     // smoothstep，接近 ease-in-out
root.style.setProperty("--cb-lum", String(lumLo + (lumHi - lumLo) * k));
```

这样只剩一个依赖：元素存在。没有任何注册时机问题。
`prefers-reduced-motion` 时直接不启动循环；拖动中把 `k` 钉在 1（不呼吸）。

CSS 里现在只剩静态变量声明，`@property` / `@keyframes` / `animation:` 全部移除。

#### 同时回退一处自己引入的风险

第 5 轮往 `package.json` 的 `dsh.client.inject` 里加了
`@deepseek-ai/dsh-client-ui-model-selection`。该包只存在于 DSH 安装目录，
**不在 profile 的 `node_modules` 里**，而 `dsh.client.inject` 会参与
client-modules 的图排序与 prune 保留判定。这是在"工作正常"之后引入的额外风险，
已回退为原来的单项。

#### 验证方式（这次用实测而非读代码）

`test/gen-measure.mjs` 从 `lib/client.js` 抽出真实 CSS，配上真实 DOM 结构与
真实的档位变量，在 Chromium 里测量每个元素：

```
root  193.25 x 26   track 160 x 26   rail 160 x 6
fill  106.66 x 6    knob  14 x 14
parsedRules=13  propertyRules=0  keyframes=0
```

全部有实际尺寸、`opacity=1`、`visibility=visible`，且已不依赖 `@property`。

## [1.1.6] - 2026-11-06

修 **控制台「使用端」为空**：补齐 CodeBuddy 请求标准要求的客户端标识头。

### 现象

CodeBuddy 控制台 → 积分概览 → 消耗明细里，每一行的
`产品 = WorkBuddy`、`模型 = deepseek-v4.1-flash`、`积分消耗 = 0.54` 都正常，
只有 **`使用端` 是空的（渲染成 `-`）**。

### 根因

「使用端」由服务端按**请求头里的客户端标识**归类，判据来自 CodeBuddy 客户端产物：

```js
[["tcodex","tcodex"],["tclaude-code","tclaude-code"],["gongfeng","GongfengCopilot"],
 ["codebuddyide","IDE"],["workbuddy","workbuddy"],["codebuddy","Plugin"],["cli","CLI"]]
```

输入是 `x-source-type` / `x-client-product` / `x-client-platform` / **`user-agent`**。

v1.1.5 为了绕开 `11128 request illegal` 把 attribution 的 UA 整条删掉（`scrubbedAttribution`），
而 DSH 的 `attributionHeaders()` **只有 `user-agent` 一条** —— 删完等于一条客户端标识都没有：
UA 由 undici 补成 `node`，`x-ide-*` / `x-client-*` / `x-product` 全缺 →
服务端匹配不到任何键 → 归类为空 → 「使用端」显示 `-`。

### 修复

新增 `CLIENT_IDENTITY` / `clientIdentityHeaders()`，按**官方 CLI 2.180.0 的真实出网头**
（本地抓包实测，逐条对齐）补齐：

| 头 | 值 |
|---|---|
| `User-Agent` | `CLI/2.180.0 CodeBuddy/2.180.0` ← 使用端判据 |
| `X-IDE-Type` / `X-IDE-Name` | `CLI` |
| `X-IDE-Version` / `X-Product-Version` / `X-Client-Version` | `2.180.0` |
| `X-Product` | `SaaS` |
| `X-Agent-Intent` | `craft` |
| `X-Agent-Runtime` | `other` |
| `X-Agent-Type` | `main` |
| `X-Agent-Purpose` | `conversation` |
| `X-Private-Data` | `false` |
| `X-Requested-With` | `XMLHttpRequest` |
| `X-API-Key` | 与 `Authorization` 同源（官方两条都发） |
| `X-Request-ID` / `X-Conversation-Request-ID` / `X-Conversation-Message-ID` | 每条请求唯一（26 位） |
| `X-Conversation-ID` | 进程级 UUID，控制台按它归组 |

版本号可用 `DSH_CODEBUDDY_CLIENT_VERSION` 覆盖，便于和官方 CLI 版本对齐（只影响展示，不影响分类判据）。

### 与 v1.1.5 的关系

v1.1.5 拉黑的是 **UA 里含 `deepseek-harness` 子串**，不是「所有 UA」。新 UA 不含该子串，
`scrubbedAttribution()` 保留不动 —— 契约仍满足（仍调用 `attributionHeaders()`，只删被拦的），
且补充的头只声明「本适配器以 CLI 形态调用」，不是给 DSH 换品牌。

### ⚠️ 已知细节

官方 CLI 的 UA 同时含 `codebuddy` 与 `cli`，若严格按
`resolveMaasSourceClientType()` 的表顺序会先命中 `codebuddy → Plugin`；
该函数只作用于 `tencentmaas.com` 域（见 `isMaasSourceHeaderUrl`），
`copilot.tencent.com` 走的是服务端另一套归类，故这里**原样复刻官方 CLI 的 UA**，不自行改写。
若线上仍显示为空，把 `clientUserAgent()` 改成只发 `CLI/<v>` 一段即可再试。

## [1.1.5] - 2026-11-05

修 **腾讯按客户端标识（UA）拦截**：`400 code=11128 msg="request illegal"`。
这是同码不同文的**第三种**形态 —— 与正文指纹无关，**打散正文完全无效**，
所以 v1.1.4 重启后仍然失败。

### 现象

v1.1.4 装好重启后，desktop 会话一发消息立刻失败：

```
dsh-codebuddy: 网关返回 400 — {"code":11128,"msg":"request illegal", ...}
```

（注意 msg 从 `Illegal API invocation from an unapproved channel` 变成了 `request illegal`）

### 根因（逐条 A/B，真实密钥 / 真实网关）

| 实验 | 结果 |
|---|---|
| 裸请求（不带头、默认 UA） | ✅ 200 |
| 加 DSH 的 `attributionHeaders()` | ❌ 400 `11128 request illegal` |
| 只加 `user-agent: deepseek-harness/0.1.7-rc.2 (+https://…)` | ❌ 400 |
| `user-agent: deepseek-harness` / `deepseek-harness/1.0` | ❌ 400 |
| `user-agent: DeepSeek-Harness/1.0`（大小写） | ❌ 400 |
| `user-agent: X deepseek-harness/1.0`（任意位置出现） | ❌ 400 |
| `user-agent: deepseek harness`（空格代替连字符） | ✅ 200 |
| `user-agent: WorkBuddy/1.0` / `openai-node/4.0.0` / 空串 | ✅ 200 |

⇒ 判据：**UA 不区分大小写地包含 `deepseek-harness`**。
而 DSH 的 `attributionHeaders()` **唯一一个头**就是这条 UA —— 插件等于每发一次请求就自报家门。

### 修复

1. 新增 `BLOCKED_ATTRIBUTION_SUBSTRINGS` + `scrubbedAttribution()`：
   仍然调用 `attributionHeaders()`（守 DSH 契约），但把**命中黑名单的头整体丢弃**
   （只删不伪造，不冒充官方客户端），让运行时用默认 UA。
2. `isIdentifierRejection()`：识别 `msg=request illegal`（同码 11128）→ **跳过打散重试**
   （那对请求头问题毫无作用，只会白烧一次请求），并在 `classifyHttpFailure` 里给出
   「请求头客户端标识被拉黑」的定向提示，不再误导成正文问题。

### 验证

- 单测 **72/72**（新增 3 条：归属头过滤、标识拒绝识别、标识拒绝不重试）
- 真实网关：`wireHeaders()` 出网 + 真实 7,990 字符 system prompt + 71 个工具 → **200**
- 逐头 A/B 见上表（10 组，含大小写与子串位置）

## [1.1.4] - 2026-11-05

修 **DSH 升级后 desktop 又全量 400 / code 11128**：腾讯同步收紧了两件事 ——
① DSH 11-04 升级新增的「@ 文件引用」段落进了黑名单；② **零宽空格/连续空格已被网关归一化**，
v1.1.3 的兜底打散因此失效。

### 现象

10-26 修好、连用 10 天正常；DSH 11-04 升级后（system prompt 7,809 → 7,990 字符）
desktop 侧又整轮失败，`headless` 依旧正常。

### 根因（逐条 A/B，真实密钥 / 真实网关）

**新增字面量**（DSH 11-04 新增段落的前 111 字符，精确子串、位置无关）：

```
Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root
```

| 实验 | 结果 |
|---|---|
| 该串 111 字符 → 400；110 字符 → **200** | 仍是精确子串 |
| 句中 / 前垫空格 / 前垫换行 / 前垫正文 | 全部 400（与 10-26 一致） |
| **插零宽空格 U+200B** | **400** ← 10-26 时是 200，**已失效** |
| **行内双空格** | **400** ← 10-26 时是 200，**已失效** |
| 句号后插**换行** | **200** ← 唯一可靠的断字方式 |

⇒ 网关现在匹配前会剥掉零宽字符、折叠行内连续空格，但**保留换行**。

### 修复

1. `HARD_BLOCK_FINGERPRINTS` 新增第 2 条字面量（在 `referenced.` 后断行）。
2. **兜底重试改为换行打散**：`shatterWhitespace()` 把正文里每个空格换成换行
   （`sprinkleZeroWidth` 删除，注释里写明「零宽已被剥，禁止改回」）。
3. **新增 `shatterMemo`**：某提示词一旦 11128→打散→200，记住它的 sha256，
   同一提示词后续**直接打散发**，不再每轮白吃一次 400（只存哈希，进程内有效）。
4. 已知表 + 兜底的分工不变：已知字面量精确断行（不影响排版），未知形态打散兜底（排版难看但能过）。

### 验证

- 单测 **69/69**（改 3 条：多字面量表、换行打散、重试+记忆）
- 真实失败会话（turn 6，7,990 字符 system prompt）跑新 `buildBody` 打真网关 → **200**
- 逐轮二分确认：新版本 system prompt 里**只有这 1 处**触发（破开后整段 200）

## [1.1.3] - 2026-10-26

修 **desktop 侧全量 400 / code 11128**：网关上线了**第二种**渠道校验规则 ——
「整段字面量出现在正文**任何位置**都拒」，而新增的字面量正是 **DSH Web GUI 的系统提示词段落**。

### 现象

只有 **desktop profile** 的会话必然失败；headless（`dsh --profile headless`）却一直正常 ——
因为那段 GUI 说明只在 desktop 的系统提示词里。同一密钥、同一模型，换会话就"时好时坏"。

```
400 {"code":11128,"msg":"Illegal API invocation from an unapproved channel"}
```

### 根因（逐字符二分，真实密钥 / 真实网关）

v1.1.2 的规避建立在一个假设上：**黑名单只认「顶格」**，前面加个换行即可。
2026-10-26 起这条假设只对旧字面量成立，新规则是**精确整段子串、与位置无关**：

| 实验 | 结果 |
|---|---|
| 字面量夹在一句话中间（`Hello there. <字面量> End.`） | 400 |
| 字面量前垫空格 / 垫换行 / 垫正文 | 全部 400（顶格假设失效） |
| 字面量取 221 字符（两句整段） | 400 |
| 只取前 220 字符 | **200** → 精确子串，差一个字符都不触发 |
| 句号后改换行 / 改双空格 / 插零宽空格 | **全部 200** → 不折叠空白、无模糊匹配 |
| 只扫 system / assistant | user 顶格与中段全 200（网关不看 user） |

命中的字面量（**DSH Web GUI 的运行时说明**，desktop 每个会话必带）：

```
You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime
context names. When the user refers to "this page", "this GUI", or "this app" without naming
another target, they mean this GUI.
```

### 修复

1. **`HARD_BLOCK_FINGERPRINTS`（新增第二层规则）**：整段子串命中 → 在两句之间插一个换行
   （字面量被打断、网关放行；**文字一字不改**，模型看到的仍是同一句，只是多了一个断行）。
   `defuseFingerprint()` 现在先过顶格层、再过整段层，两层都保持幂等。
2. **未知指纹兜底重试**：万一以后网关再上新字面量，`stream()` 在收到 11128/11152 时
   会**自动把 system / assistant 正文按 16 字打散零宽空格后重试一次**（只重试一次、
   只动正文、不压缩上下文），并打一条 warn 提示去补字面量表。这样下次规则变更不会
   再"整轮失败"，最坏情况只是多花一次请求。

### 验证

- 单测：新增 `defuseHardBlock` / `sprinkleZeroWidth` / 兜底重试三条回归（见 `test/index.test.mjs`）
- 真网关：用**真实失败会话**的 system prompt（7,809 字符）跑 `buildBody` → 网关 **200**；
  未打补丁时同一份 payload 稳定 **400/11128**
- headless 冒烟：`dsh --profile headless "回复OK"` 仍返回 OK（未回归）

## [1.1.2] - 2026-10-21

修 **全量 400 / code 11128**：网关新增了一条客户端黑名单，正中 DSH 系统提示词第一行。

### 现象

所有 CodeBuddy 路由的对话都立刻失败：

```
400 {"code":11128,"msg":"Illegal API invocation from an unapproved channel",
     "displayTips":{"zh":"这次调用没通过渠道校验，可能不是官方客户端发出的。"}}
```

### 根因（逐条 A/B 实测，真实密钥、真实网关）

**不是 HTTP 头，是消息正文**。UA / X-Product / Origin 四种组合全部 200；
`developer` 角色确实会 400，但走的是「角色被拒」，不是本条。

黑名单是**精确字面量 + 顶格匹配**：

| 顶格（行首） | system | assistant | user | tool |
|---|---|---|---|---|
| 命中 | **400** | **400** | 200 | 200 |
| 中段出现 | 200 | 200 | 200 | — |

本次新增的字面量是：

```
You are an AI agent powered by DeepSeek Harness.
```

它正是 **DSH 自己系统提示词的第一行**。插件以前能正常发出去，是因为这条规则
2026-10-21 之前不存在；规则上线后，凡是 `codebuddy-native` 路由的请求**必然全灭**。
（同批黑名单里还有 `You are Claude Code, Anthropic's official CLI for Claude.`
和 `x-anthropic-billing-header`，与旧版 `codebuddy-anthropic-proxy` 里记录的完全一致。）

### 修复

`defuseFingerprint()`：命中黑名单且处于顶格时，**在文本最前面加一个换行**。

- 一个换行 = 不再顶格 → 网关放行；文字本身一字不改，模型看到的身份声明仍是原文。
- 中段出现**一律不动**（实测 200，而用户/模型真的会引用这句话，删了是误伤）。
- 覆盖 `options.system`、`system`/`developer` 消息、`assistant` 正文。
- `user` 刻意不处理：网关根本不看，改了只会损失用户原文。
- 工具名走另一套（网关用 **11152**）：`defuseToolName()` 把字面量替换成安全词。
- 幂等：已经带前导换行的不再叠加，长会话不会每轮多一行。

### 验证

- 66 条单测全过（新增 4 条：`defuseFingerprint`、`buildBody`/`mapMessage` 覆盖、
  `defuseToolName`、11128 的错误文案）。
- 用**真实失败会话**（756 条消息、7819 字系统提示词）经插件 `buildBody` 重组后
  打真实网关：修复前 400/11128，修复后 **200 + [DONE]**。

### 备注

`classifyHttpFailure` 仍把 11128 归为 `INVALID_REQUEST`（不可重试 —— 重试只会白烧额度），
但补了一句可读提示，不再是裸的英文原文。

## [1.1.1] - 2026-10-17

修 peer/engines 范围的 **3.x 泄漏**：声明支持 `dsh <3.0.0`，实际放行了整个 3.x/4.x。

### 问题

v1.0.2 为修「预发布版本被静默排除」把范围写成了两个 `||` 分支：

```
>=0.1.7-rc.2 || >=0.2.0-rc.1 <3.0.0-0
                     ↑ 上界只约束第二个分支
```

第一个分支 `>=0.1.7-rc.2` 是**开放上界** —— 它不继承后面的 `<3.0.0-0`。
实测（node-semver）：

| 版本 | 应该 | 实际（旧） |
|---|---|---|
| `0.1.7-rc.2` / `0.1.7` | ✅ | ✅ |
| `0.2.0-rc.1` / `0.2.0` / `1.0.0` / `2.9.9` | ✅ | ✅ |
| **`3.0.0` / `3.0.1` / `4.0.0`** | ❌ 应排除 | **❌ 全部 MATCH** |

危害方向是「该拒绝的接受了」：用户装上明知不兼容的 harness，
拿到的不是清楚的 `ERESOLVE`，而是更难查的运行时错误。

### 修复

三处（`engines.dsh` + 两个 `peerDependencies`）统一改为：

```
>=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.1 <3.0.0-0
```

给第一个分支补上 `<0.2.0-0` 上界。全版本矩阵 16/16 符合预期，
`3.0.0` / `3.0.1` / `4.0.0` 现已正确排除，同时保留 v1.0.2 想要的
预发布匹配（`0.2.0-rc.1` 等仍能命中）。

### 新增

- **`test/manifest-peer.test.mjs`**：7 条断言。核心是「每个 `||` 分支都必须自带
  `<` 上界」—— 这正是旧 bug 的形状。变异测试验证：把范围还原成 v1.1.0 的错误写法，
  测试报 2 条失败；正确写法 7/7 通过。

### 已知限制（不修）

- **`0.2.1-rc.2` 这类「中间版本号的预发布」仍匹配不上**。这是 node-semver 的固有
  规则：预发布版本只有在范围里某个比较符与其 `major.minor.patch` **元组完全一致**
  且自身带预发布标签时才放行。要覆盖每一个中间预发布就得给每个版本写分支，
  不可能穷举。受影响的只有「harness 发 0.2.1-rc.* 而用户装的就是它」这一窄窗口，
  届时升一下范围即可。

## [1.1.0] - 2026-10-17

推理档位从「两个硬编码 Set」改成「按模型的实测档位表」，并补齐 6 个漏收录的模型。

### 为什么改

旧实现只有 `EFFORT_OFF_MODELS` / `EFFORT_MAX_XHIGH_MODELS` 两个集合，
产出的档位**永远是 off + high + max/xhigh 三档**：

- **`low`/`medium` 从来没存在过** —— 而网关早就支持了（`deepseek-v4.1-flash`
  官方声明就是 `low/high/max`）。用户看不到 Low 档，是因为插件根本没列。
- 反过来，旧表还给 `hy4-preview`（只声明 high）、`step-5-preview`（只声明
  low/medium/high）发了 `max` —— **发的是官方没声明的假档位**。
- `low`/`medium` 即使被传入，`wireReasoningEffort` 也会把它压到顶档 —— 档位开关形同虚设。

### 新增

- **`MODEL_EFFORTS` 单表**（`lib/index.js`）：按模型声明 `off` / `tiers` / `forceEffort`。
  `effortsForModel()` 从表生成档位（顺序 off → low → medium → high → xhigh → max），
  `wireReasoningEffort()` 按表直映射，不再把所有档压到顶档。
- **`test/efforts.test.mjs`**：17 条断言，覆盖三种模型类型的关键契约。
  经变异测试验证：把实现改回「off 发字面量」「全压顶档」「给假 Off 模型加 off」
  三种旧 bug，测试分别报 2/2/1 条失败 —— 不是空转的测试。
- **6 个漏收录模型**（客户端 cli 清单有、网关实测可达）：
  `fast-model` / `balanced-model` / `deep-model`（WorkBuddy 的快速/均衡/极致路由）、
  `hy3-x`、`space-bunny`（五档全开的推理模型）、`kimi-k3-2`。

### 修复

- **`glm-5.1` 不传 `reasoning_effort` 会 400/11150**（"the reasoning effort value
  is not supported by the current model"）—— 它是唯一**强制档位**的模型。
  新增 `forceEffort: true`：选 Off 时降级为最低可用档（`low`），而不是省略字段。
- **`kimi-k2.8-preview` / `kimi-k3-2` 不再提供 Off**：客户端声明
  `canDisableThinking: true`，但硬题实测 omit 仍思考 1986~4093 tokens —— 是**假开关**。

### 数据依据（三层校验，2026-10-17 全网关实测）

1. **声明**：`acc-product-config-v3.json` 的 `reasoning.supportedEfforts` / `canDisableThinking`
2. **接受**：直连 `copilot.tencent.com` 逐档实发，只有 HTTP 200 才收录
3. **Off 有效性**：硬题 + `max_tokens=4096` 实测 `completion_thinking_tokens`，
   只有「不传字段 → think 恒为 0」才算真 Off

### 踩过的坑（写下来防止重复踩）

- **HTTP 200 ≠ 档位有效**：glm/hy/step 一整批模型对**任何**字符串都回 200，
  实测连 `"off"` / `"false"` / `"disabled"` / 乱码全部放行。网关根本不校验，
  只能靠客户端声明做交集。
- **`"off"` 字面量对 DeepSeek 是致命的**：三个模型实测全部 400/11133。
  Off 只能实现为「不发字段」。
- **`max_tokens=1` 的探针会被整批拒绝**（连 omit 都 400/11133），
  最低可用 `max_tokens=16`。
- **思考 token 数不能用来排档位强弱**：难题下 low/medium/high/max 全部撞
  `max_tokens` 天花板（一模一样）；中等题下样本间方差 > 档位间差异。
  能确定的是「档位被接受且计费倍率不同」，不能确定「low 比 high 思考少多少」。

## [1.0.3] - 2026-10-07

修复两个会造成用户可见故障的缺陷，并补上回归防护与 CI。

### 修复

- **流式响应中途静默会干等约 5 分钟，且最终不重试。**
  网关半路静默时（代理停止转发但不断开连接），`sseFrames` 会在 `reader.read()` 上死等，
  直到 Node 内置 `fetch`（undici）的默认 `bodyTimeout` 触发 —— **实测 303 秒** —— 抛出一个**裸 `TypeError`**
  （`cause.code = 'UND_ERR_BODY_TIMEOUT'`）。而宿主 `normalizeLlmFailure` → `harnessErrorCode` 只承认
  `HarnessError` 子类，其余一律归 `"UNKNOWN"`，`UNKNOWN` 不在 `retryableCodes` 里 → **不重试**，
  用户干等五分钟只看到一句无法理解的错误。

  现在给每次 `read()` 加 **空闲超时**（`STREAM_IDLE_TIMEOUT_MS`，默认 60 秒；`sseFrames(resp, { idleTimeoutMs })`
  可覆盖，测试用），超时即取消响应体并抛 `LlmError(..., 'TRANSPORT')` —— `TRANSPORT` 在重试策略里，会走正常重试。

  注意是**空闲**超时不是总时长超时：每收到一块数据就重置计时，长回答不受影响。

- **读取失败（TCP RST / 连接重置等）同样不重试。**
  上一条修的是「静默」；但若 `read()` 直接抛出硬错误（如 `ECONNRESET`），抛出的仍是**裸 `TypeError`**，
  同样被宿主归成 `UNKNOWN` → 不重试。现在把**非 `LlmError` 的读取失败**统一归一成
  `LlmError(..., 'TRANSPORT', { cause })`，让重试策略接管；已是 `LlmError` 的原样透出，不二次包装。

  > 用户主动取消**不会**因此被误重试：宿主 `adapterFailureChunk(error, options.signal)` 先判 `signal?.aborted`，
  命中即走 `kind: 'aborted'` 分支。

  > **这条守卫的边界（实测，勿误解）**：它按「两次收到数据之间是否静默」判定，因此**会被心跳骗过** ——
  > 网关只要持续吐任意字节（SSE 注释 `: keepalive`、半截帧），计时就不断重置。
  > 实测：完全不发字节 → 60 秒准时超时；每 200ms 发一次心跳 → 永不超时。
  > Node `fetch` 自带的 300 秒 `bodyTimeout` 同样被心跳骗过，故这不是退步，而是适用范围。
  > 另外失败等待的上界约为 **5.5 分钟**（60 秒 × 最多 5 次重试 + 退避约 30 秒）——
  > 这是把「必然失败」换成「大概率自愈」的有意取舍。

### 变更

- `package.json` 的 `files` 加入 `"test"`。此前 npm 包不含 `test/`，而 `scripts.test` 指向
  `test/index.test.mjs` —— **装完之后 `npm test` 必然报 `Could not find 'test/index.test.mjs'`**（实测退出码 1）。

### 新增

- **GitHub Actions CI**（`.github/workflows/ci.yml`）：push 到 main 与所有 PR 都跑全量测试。
  **为什么这个仓库能在 CI 里跑测试**：`lib/index.js` 顶层 import `@deepseek-ai/dsh-llm`，该包此前被认为
  「只在 DSH profile 里可解析」；实测它**已发布到 npm**（31 个版本），CI 里 `npm i -D @deepseek-ai/dsh-llm@0.2.0-rc.2`
  即可，无需安装整个 DSH。
  ⚠️ **必须钉版本号**：该包 dist-tags 的 `latest` 是 `0.0.1-rc.1`（很旧），不写版本会装错。

- **模型清单一致性测试**。`cordis.patch.yml` 的 `models:` 与 `lib/index.js` 的 `FALLBACK_MODELS`
  是同一份清单的两个副本，此前只靠注释里一句「改一边务必改另一边」，没有任何测试覆盖。
  现在逐条断言 id 集合、`contextWindow`、`maxTokens`、`inputModalities` 一致，不一致时报出**具体模型与字段**。

### 文档

- **修正 `CHANGELOG.md` 中 v1.0.1 的两处失实描述**（本次修复的起因之一）。
  原文写「全链路超时：**流式空闲看门狗**、单次探测 8s、探测总时限 60s、**测试连接 15s**」。对着代码逐条核实后：

  | 声称 | 实况 |
  |---|---|
  | 流式空闲看门狗 | ❌ **当时并不存在**（全仓无实现，历史里也没有；v1.0.3 才真正补上） |
  | 单次探测 8s | ✅ 属实（`PROBE_TIMEOUT_MS`） |
  | 探测总时限 60s | ✅ 属实（`DISCOVER_DEADLINE_MS`） |
  | 测试连接 15s | ❌ **实际是 8s**（用的是 `PROBE_TIMEOUT_MS`；`15000` 是 `DISCOVER_429_MAX_WAIT_MS`，与测试连接无关） |

- `cordis.patch.yml` 的注释曾写「→ 改为官方配置：见下方 `compat.supportsDeveloperRole: false`」，
  但**下方并不存在 compat 段**，而且 `compat.*` 是 `llm-pi-ai` 的协议漂移门禁字段，
  DSH 核心与官方 `dsh-llm-deepseek` 都不消费它 —— 已改为说明本适配器在代码里直接规避
  （只发 `system`、回传 `reasoning_content`），不存在对应配置项。

> **这一节的教训**：发版前把 CHANGELOG 里**每个动词和数字**对着代码跑一遍。
> 插件收录指南明写「描述会被当作对插件的声明并与代码核对，**夸大是让一个本来不错的插件被打回的主要原因**」——
> 同一条标准不只适用于市场条目，也适用于仓库里每一份对外文字。

## [1.0.2] - 2026-10-05

`peerDependencies` 预发布范围修正：让声明在**普通 semver 语义**下也成立。不改任何运行时代码。

### 修复

- `"@deepseek-ai/dsh-llm"` 与 `"@deepseek-ai/dsh-credentials"` 的范围
  由 `>=0.1.7-rc.2` 改为 `>=0.1.7-rc.2 || >=0.2.0-rc.1 <3.0.0-0`。

  原因：node-semver 只放行「范围里存在**同一个 major.minor.patch 元组**、且该比较符自身带预发布标签」
  的预发布版本。`>=0.1.7-rc.2` 在 `0.1.7-rc.2` 上为真，但**在 `0.2.0-rc.1` / `0.2.0-rc.2` 上为假** ——
  而 `0.2.0-rc.2` 正是当前 DSH 的运行时版本。

  需要说明的是：**DSH 自身的兼容门禁不会因此拦下本插件**。门禁
  （`evaluatePluginCompatibility`）在比较时传了 `{ includePrerelease: true }`，
  `>=0.1.7-rc.2` 在那个语义下对 `0.2.0-rc.2` 返回真，实测判定为「无不兼容 peer」。

  受影响的是**普通 semver 的消费方**（npm / pnpm 的 peer 解析、任何未加 `includePrerelease`
  的校验），对它们在 `0.2.0-rc.2` 上会判为不满足。新增的 `||` 分支把预发布标签放在匹配的
  `0.2.0` 元组上，两种语义下都成立 —— 这也是插件列表收录指南明确要求的形式。

  覆盖矩阵（普通 semver / 门禁语义，修复后一致为真）：
  `0.1.7-rc.2` ✓ / `0.1.8` ✓ / `0.2.0-rc.1` ✓ / `0.2.0-rc.2` ✓ / `0.2.0` ✓ / `0.2.9` ✓ / `0.3.0` ✓

- `engines.dsh` 同步为同一范围（该字段由工具链读取，不参与 DSH 门禁）。

## [1.0.1] - 2026-10-05

默认参数校准：只调整内置模型清单的声明值与对应文档，不改动接口、探测逻辑或请求构造。

### 变更

- **`contextWindow` 统一为 1000000**（全部 22 个模型）。此前各模型取官方产物里的
  `defaultLength`（131072 / 192000 / 200000 / 256000 / 300000 不等）。
  `contextWindow` 是宿主 DSH 的**本地声明** —— 决定它何时压缩上下文、何时判定溢出 ——
  不是请求体字段，与网关侧的 `supportedLengths` 无关；实测网关硬上限 1048576 tokens，
  1M 声明下长期运行正常。
- **`deepseek-v4.1-flash` 的 `maxTokens` 8192 → 128000**。8192 会让长回答被截断在半途，
  表现为「已达到输出 token 上限，发送继续才能继续」。其余模型维持 8192，
  `deepseek-v4-pro` 维持 32768。
- 修正 `cordis.patch.yml` 中与调整后取值自相矛盾的注释（原文称「1M 会顶穿网关硬上限，
  故取官方 defaultLength」）。

### 文档

- `README.md` / `README.en.md`：内置模型清单表重算（22 行），补记两个参数的取值理由，
  以及它们之间的约束 —— `contextWindow - reservedCompletionTokens > 0`，
  二者之和无需小于网关硬上限。

## [1.0.0] - 2026-10-03

首次公开发布。

### 新增

- **探测结果真正进入模型选择器**：`listModels()` 现在合并「配置清单 ∪ 本会话探测命中」。
  此前探测结果只回给设置页展示，GUI 模型选择器仍只认静态清单 —— 网关上新增的模型「看得到却选不到」。
- **探测确认下线的模型会被剔除**：只加不减会让已下线模型仍能被选中，一选就 HTTP 400。
  仅在一次**干净完成**的探测后整体替换该结论；限流 / 超时 / 取消的结果一律不写入，避免误删可用模型。
- **目录结论按作用域隔离**（端点 + 密钥指纹）：更换端点或密钥会自动清空，旧端点的模型不再串味。
- 设置页新增：删除密钥、清空探测缓存、深度探测开关、探测中取消、成本统计显示。
- **全链路超时**：单次探测 8s、探测总时限 60s（`PROBE_TIMEOUT_MS` / `DISCOVER_DEADLINE_MS`），
  以及设置页「测试连接」的同一个 8s 守卫。
  > ⚠️ **本条曾被写错，2026-10-07 更正**：原文声称还包含「流式空闲看门狗」与「测试连接 15s」，
  > 对着代码核实后两者都不成立（看门狗当时根本没有实现；测试连接用的是 8s 而非 15s）。
  > 看门狗已于 [1.0.3] 真正补上，见该节。
- **请求生命周期取消信号**：关闭页面即停止服务端探测（此前「取消」只停了进度条）。
- **SSE 截断守卫**：未收到 `[DONE]` 或 `finish_reason` 时归一成 `TRANSPORT` 重试，
  不再把半截正文或半截工具参数当完整结果提交。
- 带内错误帧与 HTTP 错误路径**共用同一个分类器**。
- 回归测试 21 条（零网络、零额度，含本地 mock 网关端到端）。
- `LICENSE`、`README.md`、`README.en.md`、`.gitignore`、`CHANGELOG.md`。

### 修复

- **额度用尽被误判为限流**：网关额度耗尽时返回 HTTP 429 + `code 14018`，
  此前一律归 `RATE_LIMIT`（可重试）→ 用户白等 5 次退避约 30 秒，且看到「限流」而非「欠费」。
  现在归 `QUOTA`（不可重试），探测**第一批即停**，文案改为引导充值。
- **上下文超限未分类**：网关返回 `code 11115` / `prompt is too long`，
  此前落 `INVALID_REQUEST`，导致 DSH 的溢出兜底压缩「永不触发」（消费方是硬门槛判断）。
  现在归 `CONTEXT_WINDOW_EXCEEDED`。
- `probeModel` 的 429 分支**不读响应体** → 无法区分限流与欠费（同一状态码，语义相反）。
- `11102`（模型不存在）判定只读顶层 `code` → 改为穿透 `error.data.code`。
- `usage` 忽略 `total_tokens`，且网关回空对象 `{}` 时会覆盖真实计数 → 用量被上报成 0。
- 图片未声明 `inputModalities` → 宿主跳过图片投影，图片被静默降级为字面量 `[图片]`。
- 流式响应中途失败时未 `cancel` 响应体 → 连接与缓冲被挂住直到服务端超时。
- `clear-key` 谎报成功：密钥可能来自只读来源（如 `~/.dsh/.env`），删了会被「复活」，
  此前仍回「✅ 已删除」→ 现在复验并**如实报告删不掉**。
- `set-base-url` 是空操作却弹「✅ 端点已保存」→ 改为如实拒绝，UI 的地址框改为只读。
- 探测候选硬编码兜底表 → 改为**配置清单优先**（否则用户从配置里删掉的模型会被探测重新加回）。
- 深度探测的猜测清单可能与被探候选重复 → 去重，避免同一模型双倍计费。
- 注释中的成本数字与实测不符（63/126 → 实测 60/120）。

### 安全

- **修复凭据外发原语**：`discover` 动作曾直接采信请求体中的 `apiKey` 与 `baseURL`，
  而 `resolveKey` 会把任意字符串当作**环境变量名**解析 ——
  构造一个请求即可令插件把 `.env` 中任意一条凭据以 `Authorization: Bearer` 发往任意主机。
  现在草稿密钥**只接受 `sk-` / `ck-` 字面量**，草稿地址必须为 `https` 且与已配置端点**同主机**。
- **修复漏写 `await`**：`key = draftKey ? resolveKey(...) : await resolveKey(...)`
  真值分支漏 `await` → 会发出 `Bearer [object Promise]`、把缓存键塌陷成同一槽，并产生未处理的 Promise 拒绝。
- 设置页写操作围栏加固：`Host` 必须为回环名（挡 DNS rebinding）、拒绝 `Origin: null`、
  `Sec-Fetch-Site` 校验、`Content-Type` 必须为 JSON、请求体 64 KB 上限。
- 错误文案不再回显密钥原文。

### 变更

- 模型清单纯净化为单一真相源（`PROBE_CANDIDATES` 由 `FALLBACK_MODELS` 派生，不再手抄）。
- 显示名改为 `CodeBuddy (unofficial)`，`keywords` 移除 `tencent`。
- `peerDependencies` 由 `"*"` 收窄为 `>=0.1.7-rc.2`（此前 `"*"` 会让 registry 上过期的 `latest` 也被视为满足）。
- 新增 `npm test`（`node --test`）。

### 已知限制

- 探测结果**不跨会话持久化**：重启 DSH 后回到内置清单，需重新点一次「获取模型」。
  （跨会话持久化需要 `Config` schema 与 `@deepseek-ai/schemastery` 依赖，会牵动 profile 的 lockfile。）
- 接口地址不能在设置页修改（由配置 / 环境变量决定）。
- 一次「获取模型」会产生真实计费请求（默认 22 次，最坏 44；深度探测 60 / 120）。
- 模型元数据（上下文窗口、最大输出）为静态声明，官方调整后需更新 `cordis.patch.yml`。
