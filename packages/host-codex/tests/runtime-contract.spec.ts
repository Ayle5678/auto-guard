/**
 * Codex's row of the runtime parameterized contract (ADR-0016): the whole
 * createHookHost behavioral contract, driven through the Codex descriptor.
 * The fail-closed ladder renders deny instead of ask — codex discards an
 * `permissionDecision:"ask"` and continues the call, so the descriptor
 * declares `headlessFallback: 'deny'` and the contract suite follows.
 */
import { describeHookHostContract } from '@auto-guard/host-runtime/tests/hook-host-contract.ts'
import { CODEX_DESCRIPTOR } from '../src/descriptor.ts'

describeHookHostContract(CODEX_DESCRIPTOR, 'hook host contract: codex')
