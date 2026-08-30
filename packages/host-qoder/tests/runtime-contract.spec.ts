/**
 * Qoder's row of the runtime parameterized contract (ADR-0016): the whole
 * createHookHost behavioral contract, driven through the Qoder descriptor
 * (including the SPEC 0012 delete_file rm synthesis via the guarded-tool
 * table).
 */
import { describeHookHostContract } from '@auto-guard/host-runtime/tests/hook-host-contract.ts'
import { QODER_DESCRIPTOR } from '../src/descriptor.ts'

describeHookHostContract(QODER_DESCRIPTOR, 'hook host contract: qoder')
