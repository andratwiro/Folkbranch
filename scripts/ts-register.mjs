// Lets plain `node` run the project's TypeScript from scripts: extensionless imports and the `@/` alias resolve to .ts/.tsx files.
// Usage: node --disable-warning=ExperimentalWarning --import ./scripts/ts-register.mjs scripts/<name>.ts
import { register } from 'node:module'
register('./ts-resolve.mjs', import.meta.url)
