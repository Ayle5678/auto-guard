/**
 * Claude Code's row of the runtime parameterized contract (ADR-0016): the
 * whole createHookHost behavioral contract, driven through the Claude Code
 * descriptor.
 */
import { describeHookHostContract } from '@auto-guard/host-runtime/tests/hook-host-contract.ts'
import { CLAUDE_DESCRIPTOR } from '../src/descriptor.ts'

describeHookHostContract(CLAUDE_DESCRIPTOR, 'hook host contract: claude')
