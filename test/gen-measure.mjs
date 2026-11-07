// 从 lib/client.js 抽出真实 CSS，配上真实 DOM 结构，测量每个元素的
// computed 尺寸与关键属性。
//
// 目的：回答"元素渲染了但看不见"到底卡在哪一层 ——
// 是 0 尺寸、被 opacity/animation 吃掉、还是 CSS 规则根本没解析。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const src = readFileSync(join(repo, 'lib', 'client.js'), 'utf8')

const m = /const CSS = `([\s\S]*?)`;/.exec(src)
if (m === null) throw new Error('找不到 CSS')
const css = m[1]

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:#6a3d2f}
  .host{display:flex;align-items:center;gap:12px;padding:20px;width:900px}
${css}
</style></head>
<body>
  <div class="host">
    <div class="cb-effort" id="root"
         style="--cb-effort-pos:0.6666666666666666;--cb-lum-lo:0.98;--cb-lum-hi:1.16;--cb-glow-lo:7px;--cb-glow-hi:37px;--cb-halo-lo:0.22;--cb-halo-hi:0.85"
         data-effort-index="2" data-effort-count="4" data-dragging="0" data-settling="0">
      <span class="cb-effort-label">High</span>
      <div class="cb-effort-track" role="slider" tabindex="0">
        <div class="cb-effort-rail"></div>
        <div class="cb-effort-fill"></div>
        <div class="cb-effort-knob"></div>
      </div>
    </div>
  </div>
<script>
  window.__MEASURE__ = () => {
    const q = (s) => document.querySelector(s);
    const box = (s) => {
      const el = q(s);
      if (!el) return { missing: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: +r.width.toFixed(2), h: +r.height.toFixed(2),
        x: +r.x.toFixed(1), y: +r.y.toFixed(1),
        display: cs.display,
        position: cs.position,
        opacity: cs.opacity,
        visibility: cs.visibility,
        animation: cs.animationName,
        filter: cs.filter,
        background: cs.backgroundColor,
        boxShadow: (cs.boxShadow || '').slice(0, 60),
      };
    };
    // 统计已解析的 .cb-effort 相关规则
    let rules = 0, propAt = 0, kf = 0;
    for (const sh of document.styleSheets) {
      try {
        for (const r of sh.cssRules || []) {
          const t = r.constructor.name;
          if (t === 'CSSPropertyRule') propAt++;
          if (t === 'CSSKeyframesRule') kf++;
          if ((r.selectorText || '').includes('.cb-effort')) rules++;
        }
      } catch {}
    }
    return {
      root: box('#root'),
      label: box('.cb-effort-label'),
      track: box('.cb-effort-track'),
      rail: box('.cb-effort-rail'),
      fill: box('.cb-effort-fill'),
      knob: box('.cb-effort-knob'),
      parsedRules: rules,
      propertyRules: propAt,
      keyframesRules: kf,
    };
  };
</script>
</body></html>`

const out = join(repo, '..', '..', 'preview', 'measure.html')
writeFileSync(out, html, 'utf8')
console.log('written:', out)
