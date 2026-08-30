// Headless frame dump for SPEC 0010 (mirrors the 0009 preview format):
// renders real `render(state)` frames with injected demo data — no TTY, no
// machine reads. Run from repo root:  node .scratch/0010-tui-ux-polish/make-preview.mjs
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
    mkRoot('dsh', 'DeepSeek Harness', '.dsh', { auditCount: undefined, keyEnvName: 'DEEPSEEK_API_KEY' }),
    mkRoot('pi', 'Pi', '.pi', { auditCount: 561 }),
    mkRoot('zcode', 'ZCode', '.zcode', { auditCount: 2087, keyStored: true }),
    mkRoot('claude', 'Claude Code', '.claude', { auditCount: undefined }),
    mkRoot('opencode', 'OpenCode', join('.config', 'opencode'), { seeded: false }),
    mkRoot('qoder', 'Qoder', '.qoder', { auditCount: 344, keyStored: true }),
  ],
  currentRoot: root,
  focusRoot: 2,
}

const key = (name, ch) => ({ type: 'key', key: { name, ch } })
const frame = (title) => {
  const plain = render(state).map((row) => rowToString(row, false).replace(/\s+$/, ''))
  console.log(`===== ${title} =====`)
  console.log(plain.join('\n'))
  console.log()
}

frame('dashboard (banner @110x30)')

// guard: switch via digit, autoload fills the output pane
state = reduce(state, key('char', '2')).state
state = reduce(state, { type: 'autoload-done', screen: 'guard', receipt: {
  id: 1,
  argv: 'guard recent 10 --config-root ' + root,
  code: 0,
  output: [
    '最近 10 条裁决（当前根 ZCode）：',
    '  08-30 02:10  Bash    cd /d/proj && ./deploy.sh        allow  [cache]',
    '  08-30 02:09  Bash    rm -rf build/                    ask    [recursive-delete]',
    '  08-30 02:07  Read    cat .env                          deny   [secrets]',
    '  08-30 02:06  Write   edit src/app.ts                   allow  [edit-tracked]',
    '  08-30 02:04  Bash    git push origin main              ask    [push]',
  ],
} }).state
frame('guard (autoloaded recent + notice)')

// examine: arrived via arrow key; autoload its status
state = reduce(state, key('right')).state
state = reduce(state, { type: 'autoload-done', screen: 'examine', receipt: {
  id: 2,
  argv: 'examine status --config-root ' + root,
  code: 0,
  output: ['审计层 : on', '审计库 : audit.db（2087 条）', '历史层 : on', '保留 : 30 天（clear-old）'],
} }).state
frame('examine (status panel + autoloaded status)')

// set screen via digits
state = reduce(state, key('char', '5')).state
state = reduce(state, { type: 'autoload-done', screen: 'set', receipt: {
  id: 3,
  argv: 'set show-key --config-root ' + root,
  code: 0,
  output: ['已存储 key：sk-••••••••（脱敏）', '来源：加密 key 存储', '环境变量 DEEPSEEK_API_KEY 未设置 → 生效'],
} }).state
frame('set (autoloaded show-key)')

// installer: tab over to status sub-tab autoloads list
state = reduce(state, key('char', '6')).state
state = reduce(state, key('tab', undefined)).state
state = reduce(state, { type: 'autoload-done', screen: 'installer', receipt: {
  id: 4,
  argv: 'list',
  code: 0,
  output: ['dsh      : 已集成（settings.json 注入）', 'pi       : 已集成', 'zcode    : 已集成（hooks 注入）', 'claude   : 已集成', 'qoder    : 已集成'],
} }).state
frame('installer status (autoloaded list)')

state = reduce(state, key('char', '7')).state
state = reduce(state, { type: 'run-done', receipt: { id: 5, argv: 'guard ping --config-root ' + root, code: 0, output: ['pong 200 OK · 412ms · deepseek-v4-flash'] } }).state
frame('log (receipts)')

state = reduce(state, key('char', '8')).state
frame('help')

// command mode with masked wizard-free argv
state = reduce(state, key('char', '2')).state
state = reduce(state, key('char', ':')).state
for (const ch of 'guard report 30') state = reduce(state, key('char', ch)).state
frame('command mode')

// small terminal: banner degrades
state = { ...state, input: null, screen: 'dashboard', width: 40, height: 12 }
state = { ...state, screen: 'dashboard', width: 100, height: 30 }
frame('dashboard (banner hidden @100x30)')
state = { ...state, width: 40, height: 12 }
frame('dashboard (banner hidden @40x12)')
