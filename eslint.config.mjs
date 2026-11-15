import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// The Next.js rules for React, hooks, accessibility and TypeScript, as `create-next-app` sets them up.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist*/**', 'data/**', 'promo/**', 'public/**', 'next-env.d.ts', 'npm/**', 'plugins/**', 'skills/**']),
])
