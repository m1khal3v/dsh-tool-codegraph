/**
 * CodeGraph navigation tools for DeepSeek Harness agents.
 *
 * The plugin registers ten independent agent tools (`codegraph_status`,
 * `codegraph_sync`, `codegraph_search`, `codegraph_explore`,
 * `codegraph_callers`, `codegraph_callees`, `codegraph_impact`,
 * `codegraph_node`, `codegraph_files`, `codegraph_affected`). Every tool
 * shells out to the local codegraph CLI (https://github.com/colbymchenry/codegraph)
 * through `ctx.shell` and renders the result as a terminal call card plus
 * model-facing text.
 *
 * A system-prompt section teaches the model the orientation-first workflow:
 * status first; a missing index is the user's decision (the model tells the
 * user to run `codegraph init` and keeps working with other tools meanwhile);
 * sync when stale; then lookups; callers/callees/impact are accelerators, not
 * exhaustive proofs — exhaustive searches fall back to grep.
 *
 * Execution follows the canonical-value flow: `execute` returns the structured
 * `CodegraphResult` validated against `CODEGRAPH_OUTPUT_SCHEMA`, and the
 * model-facing text is a pure projection of that value (`output.render`), so
 * every consumer (model, UI, tests) reads the same canonical fact set.
 *
 * No background jobs: codegraph runs synchronously under the caller's
 * AbortSignal; timeouts come from the plugin config.
 *
 * @module @m1khal3v/dsh-tool-codegraph
 */

import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolResult, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { buildCallCard, extractModelText } from './render.ts'
import { codegraphToolSpecs, quoteArg } from './tools.ts'
import type { TimeoutKind } from './tools.ts'

/** Cordis plugin name. */
export const name = 'tool-codegraph'
/** Services the plugin needs on its context. */
export const inject = ['shell', 'tools', 'systemPrompt']

/** Plugin config shape (composition entry config). */
export interface Config {
  /** Binary name or path of the codegraph CLI. */
  executable?: string
  /** Timeout for regular (light) commands, ms. */
  queryTimeoutMs?: number
  /** Timeout for index-building commands (sync), ms. */
  initTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  executable: z.string().default('codegraph'),
  queryTimeoutMs: z.number().default(10_000),
  initTimeoutMs: z.number().default(60_000),
})

/** Config with every default applied. */
export interface ResolvedConfig {
  executable: string
  queryTimeoutMs: number
  initTimeoutMs: number
}

/** Resolve the configured timeout for one tool timeout kind. */
export function resolveTimeout(kind: TimeoutKind, config: ResolvedConfig): number {
  return kind === 'init' ? config.initTimeoutMs : config.queryTimeoutMs
}

/** Expand a leading `~` and make the path absolute and normalized. */
export function canonicalPath(input: string): string {
  const home = homedir()
  const expanded = input === '~' || input.startsWith('~/')
    ? join(home, input.slice(1).replace(/^\/+/, ''))
    : input
  return resolvePath(expanded)
}

/**
 * Shell command line for one invocation. The executable is a config value and
 * must be shell-escaped like every other dynamic fragment: single-quote escaping
 * (not double quotes) handles spaces AND keeps `$`, backticks and `"` inert.
 * The argv tokens arriving here are already quoteArg-ed by the tool specs.
 */
export function buildCommand(executable: string, argv: string[]): string {
  return [quoteArg(executable), ...argv].join(' ')
}

/** System-prompt section text, verbatim contract of the tool catalog workflow. */
const CODEGRAPH_PROMPT = `CodeGraph Usage Rules:
- Workflow: ALWAYS check \`codegraph_status\` once per session first. If the index is missing, do NOT build it yourself — indexing is the user's decision: tell the user to run \`codegraph init\`, and continue with other tools meanwhile. If stale, run \`codegraph_sync\`.
- Orientation: Use \`codegraph_explore\` for mapping architecture or "how X works". Use \`codegraph_callers\` / \`codegraph_callees\` / \`codegraph_node\` for targeted lookups.
- Subagents: For deep exploration, spawn a subagent and explicitly instruct it to use \`codegraph_explore\` — its verbatim source blocks are heavy, so keep them out of the main session.
- DO NOT trust callers/callees/impact for completeness! They silently drop unresolved method/generic/trait-dispatch edges.
- For 100% accuracy (e.g., finding ALL callers before a rename or signature change), use \`grep\` or similar. Codegraph is only an accelerator.
- Overloaded names: Do not query overloaded names with bare callers/callees. Use \`codegraph_node\` on a specific symbol ID or use grep.`

/** Canonical value every codegraph tool returns from `execute`. */
export interface CodegraphResult {
  /** Constant discriminant of this package's tool outputs. */
  kind: 'codegraph'
  /** Full CLI command line that was run, executable included. */
  command: string
  /** Working directory the command ran in; `null` when the session has no cwd. */
  workdir: string | null
  /** Process exit code; `null` when it never exited (signal kill or spawn failure). */
  exitCode: number | null
  /** Model-facing text for the run (output, markers, or an error envelope). */
  content: string
}

/**
 * Output contract validated against every successful `execute` value. The
 * author-facing `required: true` annotations compile into the object's JSON
 * Schema `required` list, and the nullable fields are `oneOf` unions — a plain
 * `type: 'string'` would reject the canonical `null` workdir of a session
 * without a cwd (and `null` exitCode of a signal-killed run).
 */
export const CODEGRAPH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'codegraph', required: true },
    command: { type: 'string', required: true },
    workdir: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    content: { type: 'string', required: true },
  },
} as const satisfies ValueSchemaSpec

/**
 * First content block of a completed tool result, when it is plain text.
 * `presentResult` sees only the durable content projection, and codegraph
 * results always render as a single text block; anything else (future block
 * kinds, empty content) degrades to an empty card output.
 */
function textOf(result: ToolResult): string {
  const block = result.content[0]
  return block !== undefined && block.type === 'text' ? block.text : ''
}

/**
 * Exit code carried in a tool result's presentation metadata, when present.
 * `ToolResult.meta` is an opaque `JsonValue`, so the shape is narrowed via
 * `in`/`typeof` with one local cast instead of trusting an untyped payload.
 */
function metaExitCode(meta: ToolResult['meta']): number | undefined {
  if (typeof meta !== 'object' || meta === null || !('exitCode' in meta)) return undefined
  const value = (meta as { exitCode?: unknown }).exitCode
  return typeof value === 'number' ? value : undefined
}

/**
 * Cordis plugin entry: register the codegraph tools and the system-prompt
 * section. State lives only in this closure; nothing is registered beyond
 * `ctx.tools` / `ctx.systemPrompt`, and no background jobs are started.
 * @param ctx - Cordis context carrying the injected services.
 * @param config - entry config; cordis applies the schemastery defaults of
 *   {@link Config} before calling `apply`, so the `?? fallback` reads here are
 *   a defensive normalization for hosts that bypass it, not the primary path.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    executable: config.executable ?? 'codegraph',
    queryTimeoutMs: config.queryTimeoutMs ?? 10_000,
    initTimeoutMs: config.initTimeoutMs ?? 60_000,
  }

  /** Run one codegraph CLI command in the agent session's cwd and project it canonically. */
  const runCodegraph = async (argv: string[], exec: ToolRunContext, timeout: number): Promise<CodegraphResult> => {
    const sessionCwd = exec.agent?.session.header.cwd
    const workdir = sessionCwd === undefined ? undefined : canonicalPath(sessionCwd)
    const cmd = buildCommand(resolved.executable, argv)
    // Same marker renderShellFailure emits in render.ts: whichever path fails,
    // the model always reads failures in one recognizable `[Codegraph error: …]`
    // shape instead of a raw exception leaking out of `execute`.
    const failure = (cause: string): CodegraphResult => ({
      kind: 'codegraph',
      command: cmd,
      workdir: workdir ?? null,
      exitCode: null,
      content: `[Codegraph error: ${cause}]`,
    })
    try {
      const spec = ctx.shell.resolve({
        command: cmd,
        workdir,
        timeoutMs: timeout,
        signal: exec.signal,
      })
      const execution = await ctx.shell.execute(spec)
      const result = await execution.result()
      // `result()` resolves (not rejects) timeout and abort kills; `aborted`
      // singles out caller cancellation so the model sees why the output stopped.
      if (result.aborted) return failure('call aborted')
      return {
        kind: 'codegraph',
        command: cmd,
        workdir: workdir ?? null,
        exitCode: result.exitCode,
        content: extractModelText(result),
      }
    } catch (error) {
      // `ctx.shell.execute` rejects on preparation failure or cancellation
      // before the process is published, and `execution.result()` rejects only
      // on infrastructure failure (a spawn that never produced a process).
      // Even those must surface as model text, never as an unhandled rejection.
      return failure(error instanceof Error ? error.message : String(error))
    }
  }

  // Exactly the catalog specs, in catalog order — no additions, no omissions.
  for (const spec of codegraphToolSpecs) {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: CODEGRAPH_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.content }],
        presentationMeta: (_args, value) => ({ command: value.command, workdir: value.workdir, exitCode: value.exitCode }),
      },
      execute: (args, exec) => runCodegraph(spec.buildArgs(args), exec, resolveTimeout(spec.timeout, resolved)),
      presentCall: (args) => {
        const argv = spec.buildArgs(args)
        // The presenter signature carries only the parsed args, so the session
        // cwd is unknowable here — the card omits `cwd` and the UI bridge falls
        // back to the session workspace.
        return buildCallCard(argv[0] ?? '', buildCommand(resolved.executable, argv), undefined)
      },
      presentResult: (_args, result) => {
        const exitCode = metaExitCode(result.meta)
        return { card: 'terminal', output: textOf(result), ...(exitCode !== undefined ? { exitCode } : {}) }
      },
    }))
  }

  ctx.systemPrompt.section({
    name: 'tool:codegraph',
    order: 110,
    text: CODEGRAPH_PROMPT,
  })
}
