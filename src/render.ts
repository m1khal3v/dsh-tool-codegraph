/**
 * Result rendering for codegraph tool calls: the terminal call card shown to
 * the user and the model-facing text with actionable markers (missing binary,
 * missing index, truncated output). Pure functions only.
 * @module @m1khal3v/dsh-tool-codegraph/render
 */

import type { CollectedOutput, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { TerminalCallView, TerminalResultView, ToolResultView } from '@deepseek-ai/dsh-tools'

/** Placeholder shown when a truncated stream has no recoverable spill file. */
const SPILL_UNAVAILABLE = '(unavailable)'
/** Model text for a successful run that produced no stdout at all. */
const NO_OUTPUT = '(no output)'

/**
 * First CLI token of a full command line, used as the card's action label.
 * `String.split` yields an empty string (never undefined) as the first token
 * of an empty command, so the fallback is an explicit emptiness check rather
 * than a nullish coalesce.
 */
const firstToken = (command: string): string => {
  const token = command.split(' ')[0]
  return token.length > 0 ? token : 'codegraph'
}

/**
 * Marker appended when the executor truncated a stream and can name the file
 * holding the complete output. `spillPath` is optional in the real
 * `CollectedOutput`: truncation can occur without a safe spill path, so the
 * marker degrades to an explicit placeholder instead of printing "undefined".
 */
const truncationMarker = (output: CollectedOutput): string => {
  if (!output.truncated) return ''
  return `\n[output truncated; full output: ${output.spillPath ?? SPILL_UNAVAILABLE}]`
}

/**
 * Terminal call card for one codegraph invocation.
 * @param action - CLI subcommand (first argv token), rendered as `codegraph <action>`.
 * @param description - full CLI command line of the invocation.
 * @param cwd - working directory the command runs in; omit when unknown.
 * @returns the pending-state call card shown to the user.
 */
export function buildCallCard(action: string, description: string, cwd: string | undefined): TerminalCallView {
  return { card: 'terminal', title: `codegraph ${action}`, description, cwd }
}

/** True when the failure looks like a missing codegraph binary. */
export function detectBinaryNotFound(stderrText: string, exitCode: number): boolean {
  if (exitCode === 127) return true
  return /not found|missing|no such file/i.test(stderrText)
}

/** True when the failure looks like a missing/uninitialized index. */
export function detectIndexMissing(stderrText: string): boolean {
  return /not initialized/i.test(stderrText) || /\.codegraph\b/.test(stderrText)
}

/**
 * Model-facing text extracted from a finished shell run. A zero exit code
 * surfaces stdout (stderr is deliberately ignored there); anything else —
 * including a signal kill with a null exit code — surfaces stderr plus
 * actionable recovery markers, each on its own leading-newline line.
 * @param result - completed shell run to summarize.
 * @returns the text handed back to the model for this tool call.
 */
export function extractModelText(result: ShellRunResult): string {
  if (result.exitCode === 0) {
    const base = result.stdout.text.length > 0 ? result.stdout.text : NO_OUTPUT
    return base + truncationMarker(result.stdout)
  }

  // A signal-killed run carries no shell exit code; the placeholder passed to
  // the detector can therefore only ever match via the stderr pattern, never
  // via the exit-code-127 branch.
  const stderr = result.stderr.text
  let text = stderr
  if (detectBinaryNotFound(stderr, result.exitCode ?? 0)) {
    text += '\n[Codegraph executable not found. Please install it or rely on bash/grep.]'
  }
  if (detectIndexMissing(stderr)) {
    text += '\n[Codegraph error: Index missing. Run codegraph_init first.]'
  }
  return text
}

/**
 * Project one invocation onto the completed terminal view: reuse the pending
 * call card's title and attach the model-facing output. The real
 * `TerminalResultView` has no `cwd`/`description` slots, so those pending
 * fields are intentionally dropped instead of spread into the result card.
 */
const completedCard = (
  command: string,
  workdir: string | undefined,
  output: string,
  exitCode: number | null,
): TerminalResultView => {
  const card: TerminalResultView = {
    card: 'terminal',
    title: buildCallCard(firstToken(command), command, workdir).title,
    output,
  }
  // The exit-status pill only makes sense when the process actually exited; a
  // signal kill or a spawn failure has no exit code to report.
  if (exitCode !== null) card.exitCode = exitCode
  return card
}

/**
 * Full tool result for a finished shell run: the completed terminal card
 * carrying the model text in `output` (the real `ToolResultView` union has no
 * `text` field) plus the exit code when the process exited.
 * @param result - completed shell run.
 * @param command - full CLI command line of the invocation.
 * @param workdir - working directory the command ran in; the completed view
 *   cannot carry it, but the pending title is still derived through the call
 *   card built from it.
 * @returns the completed terminal card for the invocation.
 */
export function renderResult(result: ShellRunResult, command: string, workdir: string | undefined): ToolResultView {
  return completedCard(command, workdir, extractModelText(result), result.exitCode)
}

/**
 * Tool result for a shell call that threw (timeout/abort/spawn failure): the
 * run produced no exit status, so the completed card carries only the error
 * text for the model.
 * @param command - full CLI command line of the invocation.
 * @param workdir - working directory the command was meant to run in.
 * @param cause - short reason string, e.g. `call aborted` on an aborted signal.
 * @returns the completed terminal card with the `[Codegraph error: …]` text.
 */
export function renderShellFailure(command: string, workdir: string | undefined, cause: string): ToolResultView {
  return completedCard(command, workdir, `[Codegraph error: ${cause}]`, null)
}
