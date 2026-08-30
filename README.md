<p align="center">
  <a href="https://www.npmjs.com/package/@m1khal3v/dsh-tool-codegraph"><img alt="npm" src="https://img.shields.io/npm/v/@m1khal3v/dsh-tool-codegraph?style=flat-square&color=4b6fff"></a>
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/deepseek--harness-v0.1.1--rc.1-263146?style=flat-square">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-263146?style=flat-square"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-beta-7da1de?style=flat-square">
</p>

<h1 align="center">dsh-tool-codegraph</h1>
<p align="center">
  <b>CodeGraph navigation tools for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.</b><br>
  A DSH plugin that wraps the open-source <a href="https://github.com/colbymchenry/codegraph">codegraph</a> CLI
  (an AST/tree-sitter code index) into ten focused agent tools — status, search,
  callers/callees, impact, explore, and more.
</p>

> **This package is a thin wrapper.** All indexing and querying is done by the
> [codegraph](https://github.com/colbymchenry/codegraph) CLI — install it first
> and make sure its binary is on `PATH`.

---

## ⚡️ Highlights

- 🧭 **Orientation-first workflow** — usage rules (`status → sync → explore → targeted lookups`) are injected into the agent system prompt automatically.
- 🧰 **Ten focused tools**, one per operation — no mega-tool with an `action` parameter.
- ⚡ **O(1) indexed lookups** — light outputs for the main session, heavy explore builds routed to subagents.
- ⚠️ **Honest about soundness** — callers/callees/impact can miss dynamic-dispatch edges; the prompt tells the model when to fall back to `grep`.

## 🛠 Requirements

- Node `^22.19 || >=24`
- The [`codegraph`](https://github.com/colbymchenry/codegraph) CLI available on `PATH` (override via the `executable` config key)

## 🚀 Quick Start

### 1. Install the plugin

```sh
dsh plugin add --profile web @m1khal3v/dsh-tool-codegraph
```

### 2. Check the wrapped CLI

```sh
codegraph status
```

If the binary is missing, the tools reply with an install hint and the agent
falls back to `bash`/`grep`.

## 🧰 Tools

| Tool | Purpose | Output |
|---|---|---|
| `codegraph_status` | Index health and statistics | light |
| `codegraph_sync` | Sync changes since the last index | long |
| `codegraph_search` | Find a symbol by name | light |
| `codegraph_explore` | Map an area with verbatim source and call paths | heavy |
| `codegraph_callers` | Who calls this symbol (unsound) | light |
| `codegraph_callees` | What this symbol calls | light |
| `codegraph_impact` | Blast radius of changing a symbol | light |
| `codegraph_node` | One symbol's details or a file view | light |
| `codegraph_files` | Project file structure from the index | light |
| `codegraph_affected` | Find test files affected by changed source files | light |

## ⚙️ Configuration

| Key | Default | Description |
|---|---|---|
| `executable` | `codegraph` | Binary name or path of the wrapped CLI |
| `queryTimeoutMs` | `10000` | Timeout for regular commands |
| `initTimeoutMs` | `60000` | Timeout for `init` / `sync` |

## 🧑‍💻 Development

```sh
pnpm install
pnpm run verify    # typecheck + test
pnpm run build
```

## 📄 License

[MIT](LICENSE)

Built on top of [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph).
