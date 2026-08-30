/**
 * Shared TUI state types (SPEC 0009). Pure data — screens render it, the
 * reducer evolves it, actions.ts performs I/O against it.
 */
import type { DetectionResult } from '@auto-guard/cli/installer/detect'
import type { HostId } from '@auto-guard/cli/installer/profiles'
import type { GuardConfig, Lang, RuntimeStatus } from '@auto-guard/core'
import type { KeyEvent } from './keys.ts'
import type { ConfirmModel, InputModel } from './ui/kit.ts'

/** Detection enriched with the live integration status (installer screen). */
export interface IntegratedDetection extends DetectionResult {
  integrated?: 'integrated' | 'not-integrated' | 'unknown'
}

export type ScreenId = 'dashboard' | 'guard' | 'examine' | 'optimize' | 'set' | 'installer' | 'log' | 'help'

export const SCREEN_ORDER: readonly ScreenId[] = ['dashboard', 'guard', 'examine', 'optimize', 'set', 'installer', 'log', 'help']

/** One executed command's receipt: argv + exit code + output lines. */
export interface Receipt {
  id: number
  argv: string
  code: number
  output: string[]
}

/** A command the TUI is about to execute through the real CLI seams. */
export interface PendingRun {
  kind: 'mgmt' | 'inst'
  argv: string[]
  label: string
  /** Busy label key override (i18n). */
  busyKey?: 'busyRefresh' | 'busyPing' | 'busyAnalyze' | 'busyInstall' | 'busyRemove'
}

/** Structured snapshot of one host's guard root (dashboard cards). */
export interface RootSummary {
  hostId: HostId
  label: string
  homeDir: string
  root: string
  /** Host's home dir exists on this machine. */
  installed: boolean
  /** Guard config root exists (a guarded session ran at least once). */
  seeded: boolean
  config?: GuardConfig
  status?: RuntimeStatus
  auditCount?: number
  /** Encrypted key store present in this root. */
  keyStored?: boolean
  /** Env var name the config watches for the key (display only). */
  keyEnvName?: string
}

export type InputOwner =
  | 'command'
  | 'report-days'
  | 'recent-count'
  | 'set-api-base'
  | 'set-api-model'
  | 'wizard-base'
  | 'wizard-model'
  | 'wizard-key'

/** An open inline input (command mode, numeric prompts, wizard steps). */
export interface InputRequest {
  owner: InputOwner
  prompt: string
  model: InputModel
  /** Suggested value shown as the editable starting content. */
  preset?: string
}

/** Open confirm dialog + what runs on confirm. */
export interface DialogState extends ConfirmModel {
  pending: PendingRun | null
}

/** set-key wizard (SPEC 0009: mirrors the three-step TTY wizard semantics). */
export interface WizardState {
  step: 'base' | 'model' | 'key' | 'review'
  base: string
  model: string
  key: string
  error?: string
  envWarning?: string
}

export interface InstallerState {
  tab: 'init' | 'status' | 'remove'
  cursor: number
  checked: Partial<Record<HostId, boolean>>
  /** ADR-0013 rule-update choice; defaults to the explicit 'skip'. */
  rulesChoice: 'ask' | 'update' | 'skip'
  /** Installer language asked when no machine default and env unset. */
  langAsked: boolean
  detections: IntegratedDetection[]
  preview: string[]
  removeChecked: Partial<Record<HostId, boolean>>
}

/** Per-screen scrolling output pane. */
export interface ViewState {
  lines: string[]
  offset: number
}

export interface AppState {
  screen: ScreenId
  width: number
  height: number
  lang: Lang
  roots: RootSummary[]
  currentRoot: string
  /** Dashboard list cursor. */
  focusRoot: number
  /** Per-screen action cursor. */
  cursor: Partial<Record<ScreenId, number>>
  views: Partial<Record<ScreenId, ViewState>>
  /** Screens whose read-only autoload already ran (SPEC 0010). */
  autoloaded: Partial<Record<ScreenId, boolean>>
  installer: InstallerState
  wizard: WizardState | null
  input: InputRequest | null
  dialog: DialogState | null
  busy: PendingRun | null
  receipts: Receipt[]
  /** Transient footer notice; shown until the next key event (SPEC 0010). */
  notice?: string
  tick: number
  exitAfterBusies: boolean
}

/** Events feeding the reducer: keys, action completion, data refresh. */
export type AppEvent =
  | { type: 'key'; key: KeyEvent }
  | { type: 'resized'; width: number; height: number }
  | { type: 'busy-start'; run: PendingRun }
  | { type: 'run-done'; receipt: Receipt }
  | { type: 'autoload-done'; screen: ScreenId; receipt: Receipt }
  | { type: 'roots'; roots: RootSummary[]; machineLangResolved: boolean }
  | { type: 'tick' }

/** set-key wizard input (three steps collected; validation in actions). */
export interface WizardInput {
  base: string
  model: string
  key: string
  currentBase: string
  currentModel: string
}

/** Side effects the reducer asks the runtime to perform. */
export type Effect =
  | { type: 'run'; run: PendingRun }
  | { type: 'autoload'; run: PendingRun; screen: ScreenId }
  | { type: 'wizard'; input: WizardInput }
  | { type: 'refresh' }
  | { type: 'quit' }
