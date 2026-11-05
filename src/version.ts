import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: unknown };

/** Package version. Keep `package.json` as the single source of truth. */
export const VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
