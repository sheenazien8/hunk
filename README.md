# Hunk

A local web UI for reviewing and acting on changes across your Git repositories, with a coding-agent chat and a plugin system built in. Pick a project (or one of its worktrees), read diffs, stage and commit, manage branches and stashes, resolve conflicts, ask an agent to do work in the repo, and open plugin apps, all from one page.

Built with [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript, Tailwind CSS v4 and shadcn/ui. Ships as a Docker image or a host systemd service, and is installable as a PWA.

## Features

- **Projects and worktrees**: switch between repositories listed in `projects.json` and their linked worktrees, or create and remove worktrees.
- **Changes**: staged, unstaged, untracked and conflicted files in trees with multi-select. Stage, unstage and discard them, or commit, amend and push.
- **Diffs and files**: split, unified or raw diffs; syntax-highlighted source; rendered Markdown; in-file find; blame; editing and saving files.
- **File manager**: create, rename, move (drag and drop) and delete files and folders from the sidebar.
- **History**: paged commit log, per-file history, commit tabs, plus undo commit, revert and cherry-pick.
- **Branches, stash and sync**: create, switch and delete branches; stash, apply, pop and drop; fetch, pull (fast-forward or rebase) and push, with force push only as `--force-with-lease`.
- **Merge conflicts**: a current/incoming view with one-click resolutions and "Mark resolved".
- **Quick Open**: Ctrl/Cmd+P fuzzy file finder (`path:42` jumps to a line).
- **Agent chat**: run Claude (`claude-agent-acp`) or [pi](https://pi.dev) (`pi-acp`) in the active repo over the Agent Client Protocol. It supports `@file` mentions, model, mode and thinking controls, permission prompts with an optional auto mode, resumable sessions, and `!command` / `!!command` shell runs.
- **Plugins**: separate apps that open as tabs and can give the agent extra tools over MCP. See [Plugins](#plugins).
- **Dark mode, PWA and mobile layout.**

## Requirements

- Node.js 22+ and [pnpm](https://pnpm.io) 11, or Docker.
- `git` on the machine (or in the container) that runs Hunk.
- For the agent chat: `claude-agent-acp` and/or `pi-acp` on the `PATH` (the Docker image installs both).

## Getting started

```bash
pnpm install
cp acp.config.example.json acp.config.json   # optional: agents for the chat
cp plugins.example.json plugins.json         # optional: list your plugins
# create projects.json (see Configuration) and .env.local (see Authentication)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and log in.

### Running with Docker

```bash
docker compose up -d --build
```

The app is served on **http://localhost:3456**. The compose file mounts `/mnt/storage` and `/DATA` from the host so the container can work on your real repositories; change these mounts to wherever your code lives. The container runs as `node` (uid 1000) to match typical host file ownership. It also mounts `~/.claude`, `~/.claude.json` and `~/.pi` so the agents reuse your logins.

### Running on the host

`scripts/deploy-host.sh` builds the app, links the config files into `.next/standalone` and (re)starts the systemd user unit `deploy/hunk.service` on port 3456. Use this instead of Docker when the agent should see your host toolchain (Go, PHP, …). Don't run both, because they share the port.

## Authentication

Every page and API route needs a login. Set these in `.env.local`:

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Signs the session cookie. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BASIC_AUTH_USERNAME` | Login name (default `admin`) |
| `BASIC_AUTH_PASSWORD` | Login password. If unset, a temporary one is printed to the server log |

## Configuration

| File | Purpose |
|------|---------|
| `projects.json` | The projects you can open: `{ "projects": [{ "name", "dir", "ignore"? }] }`. Only these directories, and worktrees of them, are allowed. It is bundled at build time, so rebuild after editing. |
| `ignore.config.json` | Global ignore patterns for the file browser (per-project `ignore` entries add to them). |
| `acp.config.json` | Agents offered in the chat: `{ "agents": [{ "id", "name", "command": [...] }] }`. |
| `plugins.json` | Plugins: see below. |

Useful environment variables: `HUNK_ALLOW_ANY_REPO=1` (lift the project allowlist), `HUNK_ACP_CONFIG` / `HUNK_PLUGINS_CONFIG` (other config paths), `HUNK_SHELL_DISABLED=1` (turn off `!command` in the chat), and `HUNK_SHELL_MAX_LINES` / `HUNK_SHELL_TIMEOUT`.

## Plugins

A plugin is a separate web app, written in any language, that Hunk shows as an editor tab. Plugins are listed in `plugins.json`:

```json
{
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "url": "http://127.0.0.1:4320",
      "mcp": "/mcp",
      "command": ["node", "server.mjs"],
      "cwd": "/path/to/my-plugin"
    }
  ]
}
```

- **Opening a plugin**: the puzzle-piece button in the header lists your plugins, and each one opens as a tab. Hunk forwards `/plugins/<id>/…` to the plugin behind its own login, so a plugin needs no auth of its own.
- **Starting**: if `command` is set, Hunk starts the plugin on first use with `PORT` taken from `url`. Otherwise it expects something already running at `url`.
- **Project context**: requests carry `x-hunk-repo` / `x-hunk-project` headers once Hunk has checked them against `projects.json`.
- **Plugin pages**: they load `/hunk-plugin-sdk.js` to get the current project and theme (`hunk.onContext`), open files (`hunk.openFile(path, line)`), show toasts, and hand work to the agent (`hunk.startAgentTask(prompt, files)`). Hunk always asks you before starting an agent.
- **Agent tools**: a plugin with `mcp` set is offered to every new agent session as an MCP server, so the agent can use its tools. Claude connects over HTTP directly. Agents that read MCP from their own config, like pi with [pi-mcp-adapter](https://pi.dev/packages/pi-mcp-adapter), can add the server there:
  ```json
  "my-plugin": {
    "url": "http://127.0.0.1:4320/mcp",
    "headers": { "x-hunk-repo": "${HUNK_REPO}", "x-hunk-project": "${HUNK_PROJECT}", "x-project-dir": "${PWD}" }
  }
  ```
  Hunk sets `HUNK_REPO` / `HUNK_PROJECT` for its agents. Outside Hunk they're empty, so a plugin can fall back to `x-project-dir` (the directory pi was started in).
- **Writing a plugin**: any HTTP server works. To know which project a request is for, read `x-hunk-project`, then `x-hunk-repo`, then `x-project-dir`. For agent tools, serve MCP over HTTP at the `mcp` path. Requests that come through Hunk carry `x-forwarded-prefix` (`/plugins/<id>`), so build page URLs under it.

## Security

Hunk is a local tool. Anyone who can log in can make the agent run commands and edit files as the server user inside the allowed repositories, and plugins run with the same rights. Only list plugins you trust. Plugin ports listen on `127.0.0.1` and have no login of their own, so don't expose Hunk or the plugin ports to the internet.

## Development

| Action | Command |
|--------|---------|
| Dev server | `pnpm dev` |
| Lint | `pnpm lint` |
| Tests | `pnpm test` (`pnpm test:watch`) |
| Production build | `pnpm build` |

See [`AGENTS.md`](AGENTS.md) for the architecture, conventions and detailed notes, which are aimed at contributors and AI assistants. Feature plans live in `docs/plan/`.
