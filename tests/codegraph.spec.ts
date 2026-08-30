/**
 * Tests for the codegraph plugin: tool-catalog argv building and timeouts,
 * model-facing result rendering markers, and the canonical output schema.
 * All units under test are pure functions — no network, no files, no harness.
 */

import { describe, expect, it } from 'vitest'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { CODEGRAPH_OUTPUT_SCHEMA, buildCommand, resolveTimeout } from '../src/index.ts'
import type { CodegraphResult, ResolvedConfig } from '../src/index.ts'
import { renderResult, renderShellFailure } from '../src/render.ts'
import { codegraphToolSpecs, quoteArg } from '../src/tools.ts'
import type { TimeoutKind } from '../src/tools.ts'

/** Find one tool spec by registered name. */
function spec(name: string) {
  const found = codegraphToolSpecs.find(s => s.name === name)
  if (found === undefined) throw new Error(`tool not found: ${name}`)
  return found
}

/**
 * Model-facing text of a rendered result. The real `ToolResultView` union
 * carries the model text in the terminal variant's `output` field (there is
 * no `text` field); the local narrowing keeps this helper cast-free.
 */
function modelTextOf(view: unknown): string {
  if (typeof view === 'object' && view !== null && 'output' in view) {
    const output = (view as { output?: unknown }).output
    if (typeof output === 'string') return output
  }
  throw new Error(`rendered view carries no model text: ${JSON.stringify(view)}`)
}

/**
 * Minimal neutral `ShellRunResult` fixture matching the real dsh-shell type:
 * every required field gets a neutral default and the overrides replace them.
 */
function shellResult(overrides: Partial<ShellRunResult>): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 10_000,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides,
  }
}

describe('codegraph tool catalog', () => {
  it('maps codegraph_search to the query subcommand with --json', () => {
    expect(spec('codegraph_search').buildArgs({ query: 'renderResult' }))
      .toEqual(['query', "'renderResult'", '--json'])
  })

  it('resolves 60s for sync and 10s for everything else', () => {
    const timeouts: Record<TimeoutKind, number> = { init: 60_000, query: 10_000 }
    const config: ResolvedConfig = {
      executable: 'codegraph',
      queryTimeoutMs: timeouts.query,
      initTimeoutMs: timeouts.init,
    }
    expect(resolveTimeout('init', config)).toBe(60_000)
    expect(resolveTimeout('query', config)).toBe(10_000)
    expect(codegraphToolSpecs.filter(s => s.timeout === 'init').map(s => s.name).sort())
      .toEqual(['codegraph_sync'])
    expect(codegraphToolSpecs.filter(s => s.timeout === 'query')).toHaveLength(9)
  })

  it('single-quote escapes quotes inside values', () => {
    expect(quoteArg("it's")).toBe(`'it'\\''s'`)
  })

  it('single-quote-escapes an executable path containing spaces', () => {
    expect(buildCommand('/Applications/My Folder/codegraph', ['status']))
      .toBe("'/Applications/My Folder/codegraph' status")
    expect(buildCommand('codegraph', ['status']))
      .toBe("'codegraph' status")
  })

  it('keeps shell metacharacters in the executable path inert', () => {
    expect(buildCommand('/opt/my$dir bin/codegraph', ['query', "'x'"]))
      .toBe("'/opt/my$dir bin/codegraph' query 'x'")
  })

  it('builds impact argv with optional --depth', () => {
    expect(spec('codegraph_impact').buildArgs({ symbol: 'foo', depth: 2 }))
      .toEqual(['impact', "'foo'", '--depth', '2'])
    expect(spec('codegraph_impact').buildArgs({ symbol: 'foo' }))
      .toEqual(['impact', "'foo'"])
  })

  it('builds affected argv for changed source files', () => {
    expect(spec('codegraph_affected').buildArgs({ files: ['src/a.ts', 'src/b.ts'] }))
      .toEqual(['affected', "'src/a.ts'", "'src/b.ts'"])
    expect(spec('codegraph_affected').buildArgs({ files: [] }))
      .toEqual(['affected'])
  })

  it('passes static argv through for parameterless tools', () => {
    expect(spec('codegraph_status').buildArgs(undefined)).toEqual(['status'])
    expect(spec('codegraph_files').buildArgs(undefined)).toEqual(['files', '--json'])
    expect(spec('codegraph_sync').buildArgs(undefined)).toEqual(['sync'])
  })

  it('registers exactly the ten documented tools', () => {
    expect(codegraphToolSpecs.map(s => s.name)).toEqual([
      'codegraph_status',
      'codegraph_sync',
      'codegraph_search',
      'codegraph_explore',
      'codegraph_callers',
      'codegraph_callees',
      'codegraph_impact',
      'codegraph_node',
      'codegraph_files',
      'codegraph_affected',
    ])
  })
})

describe('codegraph result rendering', () => {
  it('renders the missing-index error with the init hint', () => {
    const result = shellResult({
      exitCode: 1,
      stdout: { text: '', truncated: false },
      stderr: { text: 'Error: project not initialized (.codegraph missing)', truncated: false },
    })
    const text = modelTextOf(renderResult(result, 'callers', 'codegraph callers renderResult', undefined))
    expect(text).toContain('not initialized')
    expect(text).toContain('[Codegraph error: Index missing. Run codegraph_init first.]')
  })

  it('marks a missing codegraph binary', () => {
    const result = shellResult({
      exitCode: 127,
      stdout: { text: '', truncated: false },
      stderr: { text: 'zsh: command not found: codegraph', truncated: false },
    })
    const text = modelTextOf(renderResult(result, 'status', 'codegraph status', undefined))
    expect(text).toContain('[Codegraph executable not found. Please install it or rely on grep (or similar) instead.]')
  })

  it('appends the truncation marker on truncated stdout', () => {
    const result = shellResult({
      exitCode: 0,
      stdout: { text: 'partial output', truncated: true, spillPath: '/tmp/spill-1.txt' },
      stderr: { text: '', truncated: false },
    })
    const text = modelTextOf(renderResult(result, 'query', 'codegraph query renderResult', undefined))
    expect(text).toContain('[output truncated; full output: /tmp/spill-1.txt]')
  })

  it('returns plain stdout text on success', () => {
    const result = shellResult({
      exitCode: 0,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: '', truncated: false },
    })
    expect(modelTextOf(renderResult(result, 'status', 'codegraph status', undefined))).toBe('ok')
  })

  it('labels the completed card with the action, never the executable', () => {
    const result = shellResult({
      exitCode: 0,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: '', truncated: false },
    })
    const done = renderResult(result, 'status', "'codegraph' status", undefined) as { title?: string }
    expect(done.title).toBe('codegraph status')
    const failed = renderShellFailure('query', "'codegraph' query 'x'", undefined, 'boom') as { title?: string }
    expect(failed.title).toBe('codegraph query')
  })
})

describe('canonical output schema', () => {
  it('compiles CODEGRAPH_OUTPUT_SCHEMA with the canonical value shape', () => {
    const schema = valueSchemaSpecToJsonSchema(CODEGRAPH_OUTPUT_SCHEMA)
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties ?? {})).toEqual(['kind', 'command', 'workdir', 'exitCode', 'content'])
    expect(schema.required).toEqual(['kind', 'command', 'workdir', 'exitCode', 'content'])
    expect(schema.properties?.kind?.const).toBe('codegraph')
    expect(schema.properties?.workdir?.oneOf?.map(branch => branch.type)).toEqual(['string', 'null'])
    expect(schema.properties?.exitCode?.oneOf?.map(branch => branch.type)).toEqual(['integer', 'null'])
  })

  it('matches a canonical execute value against the compiled schema', () => {
    const schema = valueSchemaSpecToJsonSchema(CODEGRAPH_OUTPUT_SCHEMA)
    const value: CodegraphResult = {
      kind: 'codegraph',
      command: 'codegraph status',
      workdir: null,
      exitCode: 0,
      content: 'ok',
    }
    expect(Object.keys(value).sort()).toEqual([...(schema.required ?? [])].sort())
  })
})
