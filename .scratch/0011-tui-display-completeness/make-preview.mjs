// Headless frame dump for SPEC 0011 (mirrors the 0010 preview format):
// renders real `render(state)` frames with injected demo data — no TTY, no
// machine reads. Demonstrates: wide-line folding (layer tags visible),
// receipt argv without --config-root, set-screen groups, help scrolling,
// narrow-window pane scrolling. Run from repo root:
//   node .scratch/0011-tui-display-completeness/make-preview.mjs
import { join } from 'node:path'
import { initialState, reduce, render } from '../../packages/tui/src/app.ts'
import { defaultGuardConfig } from '../../packages/core/src/index.ts'
import { rowToString } from '../../packages/tui/src/ui/theme.ts'

const root = join('C:', 'Users', 'demo', '.zcode', 'auto-guard')
const config = (over = {}) => ({
  ...defaultGuardConfig(root),
  enabled: true,
  examineEnabled: true,
  historyEnabled: true,
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  lang: 'zh',
  ...over,
})
const mkRoot = (hostId, label, dir, over = {}) => ({
  hostId,
  label,
  homeDir: join('C:', 'Users', 'demo', dir),
  root: join('C:', 'Users', 'demo', dir, 'auto-guard'),
  installed: true,
  seeded: over.seeded ?? true,
  config: over.seeded === false ? undefined : config(over.config),
  status: over.seeded === false ? undefined : {},
  auditCount: over.auditCount,
  keyStored: over.keyStored ?? false,
  keyEnvName: 'DEEPSEEK_API_KEY',
})

let state = initialState({ width: 110, height: 30 })
state = {
  ...state,
  lang: 'zh',
  roots: [
    mkRoot('pi', 'Pi', '.pi', { auditCount: 561 }),
    mkRoot('zcode', 'ZCode', '.zcode', { auditCount: 2087, keyStored: true }),
    mkRoot('opencode', 'OpenCode', join('.config', 'opencode'), { seeded: false }),
  ],
  currentRoot: root,
  focusRoot: 1,
}

const key = (name, ch) => ({ type: 'key', key: { name, ch } })
const frame = (title) => {
  const plain = render(state).map((row) => rowToString(row, false).replace(/\s+$/, ''))
  console.log(`===== ${title} =====`)
  console.log(plain.join('\n'))
  console.log()
}

// guard: recent 30 with realistic wide rows — layer tags fold onto view
state = reduce(state, key('char', '2')).state
state = reduce(state, { type: 'autoload-done', screen: 'guard', receipt: {
  id: 1,
  argv: 'guard recent 30',
  code: 0,
  output: [
    '最近 30 条裁决（当前根 ZCode）：',
    '  08-30 02:10  Bash         cd /d/proj && ./deploy.sh          allow   [cache]',
    '  08-30 02:09  Bash         rm -rf build/                      ask     [recursive-delete]',
    '  08-30 02:07  Read         cat .env                           deny    [sensitive-path]',
    '  08-30 02:06  Write        edit src/app.ts                    allow   [edit-tracked]',
    '  08-30 02:04  Bash         git push origin main               ask     [user-confirmed]',
    '  …（PgUp/PgDn 翻页，g/G 首尾）',
  ],
} }).state
frame('guard (folded recent: layer tags visible, argv without --config-root)')

// set: grouped actions
state = reduce(state, key('char', '5')).state
state = reduce(state, { type: 'autoload-done', screen: 'set', receipt: {
  id: 2,
  argv: 'set show-key',
  code: 0,
  output: ['已存储 key：sk-••••••••（脱敏）', '来源：加密 key 存储', '环境变量 DEEPSEEK_API_KEY 未设置 → 生效'],
} }).state
frame('set (grouped: 密钥管理 / API 端点 / 偏好 / 维护)')

// help: scrolled to the tail — command-mode line reachable at 24 rows
state = { ...state, screen: 'help', width: 100, height: 24 }
state = reduce(state, key('char', 'G')).state
frame('help (scrolled to bottom @100x24: command-mode line reachable)')

// narrow guard: scrolled to top with folded rows
state = { ...state, screen: 'guard', width: 80, height: 24 }
state = reduce(state, key('char', 'g')).state
frame('guard @80x24 (g → top: folded rows scroll, first line visible)')
