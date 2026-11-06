import type { HarnessAdapter } from '../../core/adapter.js';
import { scanOpencode } from './scan.js';

/** OpenCode V2 adapter. Behaviour contract: docs/mapping/opencode.md. */
export const opencodeAdapter: HarnessAdapter = {
  id: 'opencode',
  displayName: 'OpenCode V2',
  version: '0.1.0',
  scan: scanOpencode,
  capabilities: {
    skill: 'exact',
    command: 'adapted',
    persona: 'adapted',
    mcpServer: 'adapted',
    includeFile: 'exact',
    plugin: 'unsupported',
  },
};
