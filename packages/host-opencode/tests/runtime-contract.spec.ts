/**
 * OpenCode's row of the runtime parameterized contract (ADR-0016): the whole
 * createHookHost behavioral contract, driven through the OpenCode descriptor
 * (the `{status,reason}` wire rides the serializer slot).
 */
import { describeHookHostContract } from '@auto-guard/host-runtime/tests/hook-host-contract.ts'
import { OPENCODE_DESCRIPTOR } from '../src/descriptor.ts'

describeHookHostContract(OPENCODE_DESCRIPTOR, 'hook host contract: opencode')
