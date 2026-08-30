/**
 * ZCode bootstrap surface — re-exported from the shared runtime's
 * descriptor-driven composition root (ADR-0016). Behavior identical to the
 * pre-runtime zcode bootstrap: disk session state (ADR-0004), the Light
 * audit store (ADR-0005) and the API-key hydration chain (ADR-0006).
 */
import { createBootstrap, createConfigSpace } from '@auto-guard/host-runtime'
import type { GuardRuntime, RuntimeStatus } from '@auto-guard/host-runtime'
import { ZCODE_DESCRIPTOR } from './descriptor.ts'

const kit = createBootstrap(ZCODE_DESCRIPTOR, createConfigSpace(ZCODE_DESCRIPTOR))

export const bootstrap = kit.bootstrap
export const appendDecisionHistory = kit.appendDecisionHistory
export const readRecentDecisions = kit.readRecentDecisions
export const readStatus = kit.readStatus
export const writeStatus = kit.writeStatus
export const isDisabledByConfig = kit.isDisabledByConfig
export const recordAudit = kit.recordAudit
export const analysisDue = kit.analysisDue
export const sessionIdFromEnv = kit.sessionIdFromEnv
export const workspaceFromEnv = kit.workspaceFromEnv
export type { GuardRuntime, RuntimeStatus }
