// 量一下预览页里的真实布局：每个胶囊的位置、宽高、颜色、以及有没有溢出/重叠。
// 用 CDP 的 Runtime.evaluate 拿 getBoundingClientRect + getComputedStyle —— 这是
// 「没有视觉模型」时唯一能当证据的东西：数字不会骗人。
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'
const PAGE = 'file:///D:/Documents/deepseek-harness/default-workspace/plugins/dsh-codebuddy/preview/credits-chip.html'
const PORT = 9455

const profile = mkdtempSync(join(tmpdir(), 'chip-measure-'))
const child = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  PAGE
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('CDP 没起来')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  const slot = msg.id && pending.get(msg.id)
  if (!slot) return
  pending.delete(msg.id)
  if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)))
  else slot.resolve(msg.result)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

const expression = `
(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => { const r = el.getBoundingClientRect();
    return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }; };
  const cells = [...document.querySelectorAll('.cell')].map((cell) => {
    const label = cell.querySelector('.cell-label').textContent;
    const row = cell.querySelector('.dock-row');
    const rowBox = box(row);
    const items = [...row.children].map((el) => {
      const cs = getComputedStyle(el);
      const b = box(el);
      return {
        kind: el.className,
        text: el.textContent.replace(/\\s+/g, ' ').trim(),
        box: b,
        color: cs.color,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        overflowRight: round(b.x + b.w - (rowBox.x + rowBox.w)),
        overflowLeft: round(rowBox.x - b.x),
        // 文本有没有被裁：scrollWidth 大于 clientWidth 就是裁了
        clipped: el.scrollWidth > el.clientWidth + 1,
        svgBox: (() => { const s = el.querySelector('svg'); return s ? box(s) : null; })(),
        boldColor: (() => { const b2 = el.querySelector('span.cb-credits-today b, span.cb-credits-left b'); return b2 ? getComputedStyle(b2).color : null; })(),
        bg: cs.backgroundColor
      };
    });
    // 相邻元素是否重叠
    const overlaps = [];
    for (let i = 1; i < items.length; i += 1) {
      const prev = items[i - 1].box, cur = items[i].box;
      if (cur.x < prev.x + prev.w - 0.5) overlaps.push([i - 1, i, round(prev.x + prev.w - cur.x)]);
    }
    return { label, rowBox, items, overlaps, rowScrollOverflow: row.scrollWidth - row.clientWidth };
  });
  return { cells, bodyFont: getComputedStyle(document.body).fontFamily };
})()
`

const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
const data = result.value

for (const cell of data.cells) {
  console.log('\n=== ' + cell.label)
  console.log('  行盒: x=%s w=%s h=%s  行内溢出=%s', cell.rowBox.x, cell.rowBox.w, cell.rowBox.h, cell.rowScrollOverflow)
  for (const item of cell.items) {
    console.log('  [%s] "%s"', String(item.kind).slice(0, 28), item.text)
    console.log('        x=%s w=%s h=%s  font=%s/%s  color=%s  bold=%s  clipped=%s  bg=%s',
      item.box.x, item.box.w, item.box.h, item.fontSize, item.lineHeight, item.color, item.boldColor, item.clipped, item.bg)
    console.log('        icon=%s  右溢出=%s  左溢出=%s', item.svgBox ? `${item.svgBox.w}x${item.svgBox.h}` : 'none', item.overflowRight, item.overflowLeft)
  }
  console.log('  重叠:', cell.overlaps.length === 0 ? '无' : JSON.stringify(cell.overlaps))
}

ws.close()
child.kill()
await sleep(400)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
