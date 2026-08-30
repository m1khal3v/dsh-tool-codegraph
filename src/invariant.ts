/**
 * Package-owned invariant companion for `@m1khal3v/dsh-tool-codegraph`.
 * @module @m1khal3v/dsh-tool-codegraph/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@m1khal3v/dsh-tool-codegraph'

/** Cordis companion plugin name. */
export const name = 'tool-codegraph-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// No runtime invariant: the plugin owns no durable session-log relation. It
// registers stateless agent tools and a system-prompt section through the
// existing `ctx.tools` / `ctx.systemPrompt` seams, and shells out to the
// codegraph CLI through `ctx.shell`. A host that mounts `ctx.invariants`
// still sees the package reserved.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
