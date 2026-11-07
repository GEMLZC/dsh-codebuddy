// 从 lib/client.js 抽出真实 CSS，并生成各档位状态的静态快照页面。
// 目的：验证「最终落地的样式」而不是另写一份——避免预览与实现漂移。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const src = readFileSync(join(repo, 'lib', 'client.js'), 'utf8')

// 取 `const CSS = \`...\`;` 之间的全部内容
const m = /const CSS = `([\s\S]*?)`;/.exec(src)
if (m === null) throw new Error('找不到 CSS 模板字符串')
const css = m[1]

// 只保留拖动条相关规则（settings 页的 .cb-* 与本次无关，但不影响渲染）
const models = [
  { name: 'deepseek-v4.1-flash（4 档）', tiers: ['Off', 'Low', 'High', 'Max'] },
  { name: 'deepseek-v4-pro（3 档）', tiers: ['Off', 'High', 'XHigh'] },
  { name: 'hy3（2 档）', tiers: ['Low', 'High'] },
  { name: 'glm-5.1（5 档）', tiers: ['Low', 'Medium', 'High', 'XHigh', 'Max'] },
]

let rows = ''
for (const model of models) {
  rows += `<div class="modelgroup"><div class="modelname">${model.name}</div>`
  const last = model.tiers.length - 1
  for (let i = 0; i <= last; i += 1) {
    const t = last > 0 ? i / last : 1
    rows += `
      <div class="stage">
        <div class="cb-effort" style="--cb-effort-t:${t}">
          <span class="cb-effort-label">${model.tiers[i]}</span>
          <input class="cb-effort-range" type="range" min="0" max="${last}" value="${i}">
        </div>
        <span class="meta">t=${t.toFixed(3)} brightness=${(0.72 + t * 0.44).toFixed(2)}</span>
      </div>`
  }
  rows += '</div>'
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  :root{ --bg:#6a3d2f; }
  *{box-sizing:border-box}
  body{margin:0;padding:22px 26px 30px;
    font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    color:#e9e2dc;
    background:linear-gradient(160deg,#6a3d2f 0%,#6b3a2d 55%,#5f3345 100%);}
  h1{font-size:14px;font-weight:600;margin:0 0 4px}
  .sub{font-size:11px;color:#b9a89c;margin:0 0 20px}
  .modelgroup{margin:0 0 20px}
  .modelname{font-size:11px;font-weight:600;color:#cdbfb5;margin:0 0 8px;
    letter-spacing:.02em}
  .stage{display:flex;align-items:center;gap:14px;min-height:34px}
  .meta{font-size:10px;color:#9d8b80;font-variant-numeric:tabular-nums}

  /* ═══ 下面全部来自 lib/client.js 的真实 CSS ═══ */
${css}
  /* ═══ 以上来自 lib/client.js ═══ */
</style></head>
<body>
  <h1>D 方案 + 亮度随档位变化（渲染的是插件真实 CSS）</h1>
  <p class="sub">越往右越亮：亮度 0.72→1.16、不透明度 0.78→1.00、辉光 1px→10px 同时变化</p>
  ${rows}
</body></html>`

const out = join(repo, '..', '..', 'preview', 'slider-d-real.html')
writeFileSync(out, html, 'utf8')
console.log('written:', out)
console.log('css bytes:', css.length)
