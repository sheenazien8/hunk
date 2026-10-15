# Hunk

A local web UI for reviewing and acting on changes across your Git repositories, with a coding-agent chat and a plugin system built in. Pick a project (or one of its worktrees), read diffs, stage and commit, manage branches and stashes, resolve conflicts, ask an agent to do work in the repo, and open plugin apps, all from one page.

Built with [Next.js](https://nextjs.org) 16 (App Router), React 19, TypeScript, Tailwind CSS v4 and shadcn/ui. Ships as a Docker image or a host systemd service, and is installable as a PWA.

## Features

- **Projects and worktrees**: add, edit and remove the repositories Hunk may open (stored in `projects.json`, no rebuild needed), switch between them and their linked worktrees, or create and remove worktrees.
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
| `projects.json` | The projects you can open: `{ "projects": [{ "name", "dir", "ignore"? }] }`. Only these directories, and worktrees of them, are allowed. Edited from the project switcher in the header (add / edit / remove) and read at runtime, so changes apply without a rebuild. Under Docker it lives in the container and is reset when the container is recreated — mount a volume and set `HUNK_PROJECTS_PATH` to keep changes. |
| `settings.json` | Global settings, edited from **Settings…** in the account menu (or `Ctrl/Cmd+,`). See below. |
| `ignore.config.json` | Global ignore patterns for the file browser (per-project `ignore` entries add to them). Superseded by the Settings dialog's ignore list once you save one there. |
| `acp.config.json` | Agents offered in the chat: `{ "agents": [{ "id", "name", "command": [...] }] }`. |
| `plugins.json` | Plugins: see below. |

Useful environment variables: `HUNK_ALLOW_ANY_REPO=1` (lift the project allowlist), `HUNK_ACP_CONFIG` / `HUNK_PLUGINS_CONFIG` (other config paths), `HUNK_SHELL_DISABLED=1` (turn off `!command` in the chat), `HUNK_SHELL_MAX_LINES` / `HUNK_SHELL_TIMEOUT` (override the Settings values), `HUNK_SETTINGS_PATH` (where `settings.json` lives) and `HUNK_PROJECTS_PATH` (where `projects.json` lives).

### Settings

The Settings dialog stores its values on the server, in `settings.json` (next to the other config files, or at `HUNK_SETTINGS_PATH`), so they follow you to every device. Changes apply right away, without a restart. See `settings.example.json` for the format. Missing or invalid values fall back to the defaults.

| Section | Setting | Default |
|---------|---------|---------|
| Agent | **Auto mode for new sessions**: new and resumed sessions answer permission requests themselves. You can still turn it off per session. Questions from the agent are always asked. | off |
| Agent | **Default agent**: used when the browser has no last-used agent. | first in `acp.config.json` |
| Agent | **Shell output lines** / **Shell timeout** for `!` commands. When `HUNK_SHELL_MAX_LINES` / `HUNK_SHELL_TIMEOUT` are set, those win and the dialog shows them read-only. | 150 lines (max 5000), 300 s |
| Viewer | **Default diff view** (split or unified) and **Render Markdown** for new tabs. | split, off |
| Git | **Confirm before push**. | off |
| Files | **Ignore patterns** for All Files and Quick Open. Empty = `ignore.config.json`, else the built-in list. | — |
| Appearance | **Theme**: light, dark or system. Each browser keeps a copy, so the page loads without a flash. | system |

Agent and plugin commands, `HUNK_ALLOW_ANY_REPO` and `HUNK_SHELL_DISABLED` can't be changed from the browser. The project list **is** editable from the header's project switcher — anyone who can log in can add a directory to the allowlist (it must exist and be a git repo), so Hunk is only as safe as its login. Turning on auto mode for new sessions lets the agent run tools without asking, so it gets the same warning as the per-session toggle.

Under Docker, `settings.json` lives inside the container. To keep it across rebuilds, mount a directory and point `HUNK_SETTINGS_PATH` into it.

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
