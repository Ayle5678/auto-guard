/**
 * ZCode's row of the runtime parameterized contract (ADR-0016): the whole
 * createHookHost behavioral contract, driven through the ZCode descriptor.
 * Language golden paths port the pre-runtime zcode-cli-lang.spec (the vi.mock
 * config seam is replaced by the runtime's `{ home }` injection).
 */
import { describeHookHostContract } from '@auto-guard/host-runtime/tests/hook-host-contract.ts'
import { ZCODE_DESCRIPTOR } from '../src/descriptor.ts'

describeHookHostContract(ZCODE_DESCRIPTOR, 'hook host contract: zcode')
