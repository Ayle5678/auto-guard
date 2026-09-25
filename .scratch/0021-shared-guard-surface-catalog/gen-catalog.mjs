// SPEC 0021 ticket 02 — generate the shared guard-surface catalog from the
// host catalogs (canonical values are taken byte-exact from the named source
// file; no manual transcription), plus the key-level diff list.
// Throwaway tool; lives beside the audit dump in the spec directory.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'D:/yilun/yilun_project/auto-guard'
const files = {
  core: 'packages/core/src/messages.ts',
  runtime: 'packages/host-runtime/src/messages.ts',
  pi: 'packages/host-pi/src/messages.ts',
  dsh: 'packages/host-dsh/src/messages.ts',
  cli: 'packages/cli/src/shell-messages.ts',
}

function parseCatalog(src) {
  const callStart = src.indexOf('defineCatalog(')
  let i = src.indexOf('(', callStart) + 1
  const blocks = []
  while (blocks.length < 2) {
    while (src[i] !== '{') i++
    let depth = 0
    const start = i
    for (;;) {
      const c = src[i]
      if (c === "'") {
        i++
        while (src[i] !== "'") {
          if (src[i] === '\\') i++
          i++
        }
      }
      if (c === '{') depth++
      if (c === '}') {
        depth--
        if (depth === 0) break
      }
      i++
    }
    blocks.push(src.slice(start, i + 1))
    i++
  }
  const parseBlock = (block) => {
    const entries = {}
    const re = /(?:^|[,{]\s*)([A-Za-z_]\w*)\s*:\s*((?:'[^'\\]*(?:\\.[^'\\]*)*'))/g
    let m
    while ((m = re.exec(block))) entries[m[1]] = m[2]
    return entries
  }
  return { zh: parseBlock(blocks[0]), en: parseBlock(blocks[1]) }
}

const C = {}
for (const [name, rel] of Object.entries(files)) C[name] = parseCatalog(readFileSync(join(root, rel), 'utf8'))

// key -> source catalog (same key name); canonical = that file's exact bytes.
const TAKE = {
  pingOk: 'runtime', pingFail: 'runtime', unknownError: 'runtime',
  statsAuditCount: 'runtime',
  setKeyNeedsTty: 'runtime', setKeyEnvWarning: 'runtime',
  showKeyEnvSet: 'runtime', showKeyEnvUnset: 'runtime', showKeyStored: 'runtime',
  showKeyNoStore: 'runtime', showKeyLegacy: 'runtime', showKeyNoLegacy: 'runtime',
  clearKeyDone: 'runtime',
  reloadNote: 'runtime', setLangInvalid: 'runtime', setLangDone: 'runtime',
  examineOn: 'runtime', examineOff: 'runtime', examineClearedOld: 'runtime', examineClearedAll: 'runtime',
  askListHeader: 'runtime', askListEmpty: 'runtime', askRow: 'runtime',
  askResolvedAllow: 'runtime', askResolvedDeny: 'runtime', askResolvedDenyWithReason: 'runtime',
  askInvalidIndex: 'runtime', askStaleIndex: 'runtime',
  deleteFailReviewerTitle: 'pi',
  deleteFailLlmTitle: 'dsh',
  deleteFailDefaultReason: 'pi', deleteRunAnyway: 'pi',
  deleteAskReason: 'runtime', deleteNoDetail: 'runtime', deletionRetryHint: 'runtime',
  pingNoDirectEndpoint: 'dsh',
  exportUnsupported: 'dsh', exportDone: 'dsh', exportFailed: 'dsh',
  createNeedsPassword: 'dsh', createUnsupported: 'dsh', createDone: 'dsh', createFailed: 'dsh',
}

// Program-name-parameterized usage keys (SPEC 0020 programName injection).
const TEMPLATES = {
  statsExamineOff: {
    zh: `'审查日志未开启（{program} examine on 后才有持久统计）'`,
    en: `'Audit log is off (run {program} examine on for persistent stats)'`,
  },
  optimizeAutoUnsupported: {
    zh: `'用法：{program} set 不支持 auto；请手改 config.json 的 autoAnalyzeEnabled'`,
    en: `'Usage: {program} does not support set auto; edit autoAnalyzeEnabled in config.json manually'`,
  },
}

const ORDER = [
  'pingOk', 'pingFail', 'unknownError', 'pingNoDirectEndpoint',
  'deleteFailReviewerTitle', 'deleteFailLlmTitle', 'deleteFailDefaultReason', 'deleteRunAnyway',
  'deleteAskReason', 'deleteNoDetail', 'deletionRetryHint',
  'askListHeader', 'askListEmpty', 'askRow', 'askResolvedAllow', 'askResolvedDeny', 'askResolvedDenyWithReason', 'askInvalidIndex', 'askStaleIndex',
  'setKeyNeedsTty', 'setKeyEnvWarning', 'showKeyEnvSet', 'showKeyEnvUnset', 'showKeyStored', 'showKeyNoStore', 'showKeyLegacy', 'showKeyNoLegacy', 'clearKeyDone',
  'setLangInvalid', 'setLangDone', 'reloadNote',
  'examineOn', 'examineOff', 'examineClearedOld', 'examineClearedAll',
  'statsAuditCount', 'statsExamineOff', 'optimizeAutoUnsupported',
  'exportUnsupported', 'exportDone', 'exportFailed',
  'createNeedsPassword', 'createUnsupported', 'createDone', 'createFailed',
]

const zhLines = []
const enLines = []
for (const key of ORDER) {
  if (TEMPLATES[key]) {
    zhLines.push(`    ${key}: ${TEMPLATES[key].zh},`)
    enLines.push(`    ${key}: ${TEMPLATES[key].en},`)
    continue
  }
  const src = C[TAKE[key]]
  if (!(key in src.zh) || !(key in src.en)) throw new Error(`canonical source missing key: ${key}`)
  zhLines.push(`    ${key}: ${src.zh[key]},`)
  enLines.push(`    ${key}: ${src.en[key]},`)
}

const catalogTs = [
  '/**',
  ' * Shared guard-surface message catalog (zh / en) — the user-visible wording',
  ' * of the guard surface itself (receipts, usage, the deletion flow, key and',
  ' * audit management), hosted in core beside `defineCatalog` so every host',
  ' * resolves it through one definition (ADR-0023). Host chrome — dialogs,',
  ' * settings pages, installer, TUI — stays in the host packages; host-flavored',
  ' * wording rides `HostDescriptor.catalogOverride` (ADR-0016). Key parity',
  ' * between languages is enforced by the type system. Generated key values are',
  ' * byte-exact migrations (SPEC 0021); the `statsExamineOff` /',
  ' * `optimizeAutoUnsupported` usage lines take the driver program name',
  ' * (ADR-0022).',
  ' */',
  "import { defineCatalog, type Lang } from './lang.ts'",
  '',
  'const zhGuardSurface = {',
  ...zhLines,
  '}',
  'const enGuardSurface: Record<keyof typeof zhGuardSurface, string> = {',
  ...enLines,
  '}',
  '',
]
writeFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/gen-catalog.txt'), catalogTs.join('\n') + '\n')

// Key-level diff list: every migrated key, before (per host) → canonical,
// flagging hosts whose rendered text changes (params rendered as {name}).
const diff = ['# SPEC 0021 票02 — 键级 diff 清单（用户可见文案逐条可审）', '',
  '> 迁移前 = 各宿主目录原值；迁移后 = core 共享目录正典。`＝` 表示该宿主渲染结果不变；`≠` 表示变化（正典统一）。`{program}` 行按驱动程序名注入后与原文逐字节相同的标注为`＝(参数化)`。', '']
for (const key of ORDER) {
  const canZh = TEMPLATES[key] ? TEMPLATES[key].zh.slice(1, -1) : C[TAKE[key]].zh[key].slice(1, -1)
  const canEn = TEMPLATES[key] ? TEMPLATES[key].en.slice(1, -1) : C[TAKE[key]].en[key].slice(1, -1)
  diff.push(`## ${key}`)
  const params = key === 'optimizeAutoUnsupported' || key === 'statsExamineOff' ? { program: 'x' } : {}
  for (const host of ['runtime', 'pi', 'dsh', 'cli']) {
    const has = key in C[host].zh
    if (!has) continue
    const oldZh = C[host].zh[key].slice(1, -1)
    const oldEn = C[host].en[key].slice(1, -1)
    const same = oldZh === canZh && oldEn === canEn
    const paramNote = TEMPLATES[key] ? (host === 'runtime' ? '＝(参数化)' : '＝(参数化)') : ''
    diff.push(`- ${host} ${same ? '＝' : '≠'}${TEMPLATES[key] ? ' ' + paramNote : ''}`)
    if (!same || TEMPLATES[key]) {
      diff.push(`  - zh: ${JSON.stringify(oldZh)} → ${JSON.stringify(canZh)}`)
      diff.push(`  - en: ${JSON.stringify(oldEn)} → ${JSON.stringify(canEn)}`)
    }
  }
}
// Dedupe receipts rendered from core operations instead of host keys.
diff.push('## 复用 core 回执（宿主键删除，不再有独立文案）')
diff.push('- pi learnedAnalyzed → `analyzeLearnedRules` 返回的 core 回执（analyzeDone / analyzeDoneFull）')
diff.push('- pi optimizeRollbackDone / optimizeRollbackNone → `rollbackLearnedRules` 返回的 core 回执（rollbackDone / rollbackNoBackup）')
diff.push('- pi optimizeHistoryOn / optimizeHistoryOff → `applyHistoryToggle` 返回的 core 回执（historyEnabledNote / historyDisabledNote）')
diff.push('- pi optimizeListEmpty → core 同名键（该分支现为死代码：列表恒带表头，随迁移删除）')
diff.push('- dsh rollbackDone / rollbackNone → `rollbackLearnedRules` 返回的 core 回执（rollbackDone / rollbackNoBackup）')
diff.push('- dsh contextAllow / contextDeny / contextAsk → core 同义键 kindAllow / kindDeny / kindAsk（逐字相同，渲染零变化）')
writeFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/key-diff.md'), diff.join('\n') + '\n')

writeFileSync(join(root, '.scratch/0021-shared-guard-surface-catalog/gen-keys.txt'), [...ORDER].sort().join('\n') + '\n')
console.log('catalog keys:', ORDER.length, '— emitted gen-catalog.txt, key-diff.md, gen-keys.txt')
