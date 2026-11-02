import { defineConfig, type UserConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    outDir: 'lib',
    clean: true,
    dts: false,
    sourcemap: false,
    target: 'node22',
    platform: 'node',
    deps: { neverBundle: [/^@deepseek-ai\//, /^node:/] },
    outExtensions: () => ({ js: '.js' }),
  } satisfies UserConfig
])
