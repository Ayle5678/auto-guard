/**
 * Qoder bootstrap surface — re-exported from the shared runtime's
 * descriptor-driven composition root (ADR-0016). Disk session state
 * (ADR-0004), the Light audit store (ADR-0005) and the API-key hydration
 * chain (ADR-0006), identical to the pre-runtime qoder bootstrap.
 */
import { createBootstrap, createConfigSpace } from '@auto-guard/host-runtime'
import type { GuardRuntime, RuntimeStatus } from '@auto-guard/host-runtime'
import { QODER_DESCRIPTOR } from './descriptor.ts'

const kit = createBootstrap(QODER_DESCRIPTOR, createConfigSpace(QODER_DESCRIPTOR))

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
