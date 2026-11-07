// 从 lib/client.js 取真实 CSS + 真实窗口函数，生成用于验证的静态页。
//
// 这个文件同时承担两件事：
//   ① 生成可渲染的预览页（人工目检）
//   ② 给 verify-anim.mjs 提供断言目标（程序化验证呼吸区间不越界）
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const src = readFileSync(join(repo, 'lib', 'client.js'), 'utf8')

const cssMatch = /const CSS = `([\s\S]*?)`;/.exec(src)
if (cssMatch === null) throw new Error('找不到 CSS 模板字符串')
const css = cssMatch[1]

// 复用实现里的窗口函数：直接从源码里抠出来执行，保证预览 = 实现。
//
// ⚠️ 不能用 /function effortGlowWindow\([\s\S]*?\n\}/ ——那个非贪婪正则会停在
// 函数体内部**第一个** 顶格 `}` 之前（函数里有多个 if/return 块），
// 抠出来的是残缺函数，执行时抛错或算出错误窗口，而且看起来"跑通了"。
// 这里改成按花括号配平来切。
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`找不到函数 ${name}`)
  let depth = 0
  let i = source.indexOf('{', start)
  if (i === -1) throw new Error(`${name} 之后没有 {`)
  const bodyStart = i
  for (; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${name} 的花括号没有配平`)
}

const fnText = extractFunction(src, 'effortGlowWindow')
// eslint-disable-next-line no-new-func
const effortGlowWindow = new Function(`return (${fnText})`)()

const models = [
  { name: 'deepseek-v4.1-flash（4 档）', tiers: ['Off', 'Low', 'High', 'Max'] },
  { name: 'deepseek-v4-pro（3 档）', tiers: ['Off', 'High', 'XHigh'] },
  { name: 'hy3（2 档）', tiers: ['Low', 'High'] },
  { name: 'glm-5.1（5 档）', tiers: ['Low', 'Medium', 'High', 'XHigh', 'Max'] },
]

let rows = ''
const expected = []
for (const model of models) {
  rows += `<div class="grp"><div class="gname">${model.name}</div>`
  const last = model.tiers.length - 1
  for (let i = 0; i <= last; i += 1) {
    const w = effortGlowWindow(i, last)
    const ratio = last > 0 ? i / last : 1
    expected.push({ model: model.name, index: i, label: model.tiers[i], last, ...w })
    rows += `
      <div class="stage">
        <div class="cb-effort" data-probe-index="${i}" data-probe-last="${last}"
             style="--cb-effort-pos:${ratio};--cb-lum-lo:${w.lumLo};--cb-lum-hi:${w.lumHi};--cb-glow-lo:${w.glowLo}px;--cb-glow-hi:${w.glowHi}px;--cb-halo-lo:${w.haloLo};--cb-halo-hi:${w.haloHi}">
          <span class="cb-effort-label">${model.tiers[i]}</span>
          <div class="cb-effort-track" role="slider" tabindex="0">
            <div class="cb-effort-rail"></div>
            <div class="cb-effort-fill"></div>
            <div class="cb-effort-knob"></div>
          </div>
        </div>
        <span class="meta">${w.lumLo.toFixed(2)} → ${w.lumHi.toFixed(2)}</span>
      </div>`
  }
  rows += '</div>'
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:20px 24px 28px;
    font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    color:#e9e2dc;
    background:linear-gradient(160deg,#6a3d2f 0%,#6b3a2d 55%,#5f3345 100%);}
  h1{font-size:14px;font-weight:600;margin:0 0 4px}
  .sub{font-size:11px;color:#b9a89c;margin:0 0 18px}
  .grp{margin:0 0 18px}
  .gname{font-size:11px;font-weight:600;color:#cdbfb5;margin:0 0 8px}
  .stage{display:flex;align-items:center;gap:14px;min-height:32px}
  .meta{font-size:10px;color:#9d8b80;font-variant-numeric:tabular-nums}
${css}
</style></head>
<body>
  <h1>连续滑动 + 松手吸附 + 呼吸灯</h1>
  <p class="sub">呼吸区间：下限 = 前一档上限，上限 = 本档上限（不越界）。数值在右侧。</p>
  ${rows}
  <script>window.__EXPECTED__ = ${JSON.stringify(expected)};</script>
</body></html>`

const out = join(repo, '..', '..', 'preview', 'slider-breathe.html')
writeFileSync(out, html, 'utf8')
writeFileSync(join(repo, '..', '..', 'preview', 'slider-breathe.expected.json'), JSON.stringify(expected, null, 2), 'utf8')
console.log('written:', out)
console.log('windows:')
for (const e of expected) {
  console.log(`  ${e.label.padEnd(8)} [${e.index}/${e.last}]  ${e.lumLo.toFixed(3)} → ${e.lumHi.toFixed(3)}`)
}
