/**
 * Catalog of the codegraph agent tools: names, model-facing descriptions,
 * parameter schemas, CLI argv builders and timeout kinds. Pure data — no
 * context, no shell. The CLI is the open-source codegraph binary
 * (https://github.com/colbymchenry/codegraph) wrapped by this plugin.
 * @module @m1khal3v/dsh-tool-codegraph/tools
 */

import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Which configured timeout a tool uses (see plugin Config). */
export type TimeoutKind = 'query' | 'init'

/**
 * POSIX single-quote shell escaping: wraps the value in '…' and replaces every
 * interior single quote with '\'' so the value survives shell joining intact.
 */
export function quoteArg(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Parameter shapes per tool. */
export interface SearchParams { query: string }
export interface ExploreParams { query: string }
export interface CallersParams { symbol: string }
export interface CalleesParams { symbol: string }
export interface ImpactParams { symbol: string; depth?: number }
export interface NodeParams { name: string }
export interface AffectedParams { files: string[] }

/** Erased per-tool spec stored in the registry. */
export interface CodegraphToolSpec {
  /** Registered tool name, e.g. `codegraph_search`. */
  readonly name: string
  /** Model-facing description (English, verbatim from the catalog table). */
  readonly description: string
  /** dsh-tools parameter schema validating the tool input before buildArgs. */
  readonly parameters: ParameterSchemaSpec
  /** Build CLI argv after the executable; dynamic values are quoteArg-ed. */
  buildArgs(params: unknown): string[]
  /** Which configured timeout applies to this tool. */
  readonly timeout: TimeoutKind
}

/** Type-safe factory erasing the concrete param type into CodegraphToolSpec. */
function defineSpec<P>(spec: {
  name: string
  description: string
  parameters: ParameterSchemaSpec
  buildArgs(params: P): string[]
  timeout: TimeoutKind
}): CodegraphToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    buildArgs: (params: unknown) => spec.buildArgs(params as P),
    timeout: spec.timeout,
  }
}

/** All codegraph tools in registration order. */
export const codegraphToolSpecs: readonly CodegraphToolSpec[] = [
  defineSpec<undefined>({
    name: 'codegraph_status',
    description:
      'Check index health and statistics. Run this once per session to confirm index freshness before querying.',
    parameters: {},
    buildArgs: () => ['status'],
    timeout: 'query',
  }),
  defineSpec<undefined>({
    name: 'codegraph_sync',
    description: 'Sync changes since the last index. Run this if the index is stale.',
    parameters: {},
    buildArgs: () => ['sync'],
    timeout: 'init',
  }),
  defineSpec<SearchParams>({
    name: 'codegraph_search',
    description: 'Find a symbol by name across the codebase (Light output).',
    parameters: {
      query: { type: 'string', required: true, description: 'Symbol name to look up.' },
    },
    buildArgs: ({ query }) => ['query', quoteArg(query), '--json'],
    timeout: 'query',
  }),
  defineSpec<ExploreParams>({
    name: 'codegraph_explore',
    description:
      'PRIMARY tool for orienting. Explores an area by returning verbatim source code of relevant symbols and their call paths grouped by file.',
    parameters: {
      query: { type: 'string', required: true, description: 'Area or question to explore.' },
    },
    buildArgs: ({ query }) => ['explore', quoteArg(query)],
    timeout: 'query',
  }),
  defineSpec<CallersParams>({
    name: 'codegraph_callers',
    description:
      'Find all functions/methods that call a specific symbol. Unsound (may have false negatives). Do not use for exhaustive completeness.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol name to look up.' },
    },
    buildArgs: ({ symbol }) => ['callers', quoteArg(symbol)],
    timeout: 'query',
  }),
  defineSpec<CalleesParams>({
    name: 'codegraph_callees',
    description: 'Find all functions/methods that a specific symbol calls.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol name to look up.' },
    },
    buildArgs: ({ symbol }) => ['callees', quoteArg(symbol)],
    timeout: 'query',
  }),
  defineSpec<ImpactParams>({
    name: 'codegraph_impact',
    description:
      'Analyze what code is affected by changing a symbol. Pre-rank blast radius before editing. depth is optional (default 2).',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol to change.' },
      depth: {
        type: 'number',
        description: 'Blast-radius depth (default 2); flag added only when provided.',
      },
    },
    buildArgs: ({ symbol, depth }) => [
      'impact',
      quoteArg(symbol),
      ...(depth !== undefined ? ['--depth', String(depth)] : []),
    ],
    timeout: 'query',
  }),
  defineSpec<NodeParams>({
    name: 'codegraph_node',
    description:
      "Get one symbol's details (source + caller/callee trail) or read a file with line numbers + dependents. Good for overloaded names.",
    parameters: {
      name: { type: 'string', required: true, description: 'Symbol name or file path.' },
    },
    buildArgs: ({ name }) => ['node', quoteArg(name)],
    timeout: 'query',
  }),
  defineSpec<undefined>({
    name: 'codegraph_files',
    description: 'Show project file structure from the index.',
    parameters: {},
    buildArgs: () => ['files', '--json'],
    timeout: 'query',
  }),
  defineSpec<AffectedParams>({
    name: 'codegraph_affected',
    description: 'Find test files affected by changed source files.',
    parameters: {
      files: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Changed source files whose affected tests to find.',
      },
    },
    buildArgs: ({ files }) => ['affected', ...files.map(quoteArg)],
    timeout: 'query',
  }),
]
