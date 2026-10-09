# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-19 (updated 2026-09-28 after the architecture refactor — see `docs/plan/20-refactor-architecture.md`)

## OVERVIEW
Project: **Hunk** (`hunk`; formerly git-review — the repo folder keeps that name)
A local multi-repo Git review tool: a single-page Next.js app that runs `git` (via `child_process.execFile`, never a shell) against a repository chosen from `projects.json`. Features: staged/untracked file lists, unified/split/raw diffs, full-file content view (with syntax highlighting and optional Markdown rendering), filesystem file browser, staging/unstaging/commit/push actions, blame, commit history + commit detail tabs, branch switching/creation/deletion, stash, merge-conflict resolution, and an **agent chat panel** (ACP — Agent Client Protocol: the server spawns `claude-agent-acp` / `pi-acp` over stdio in the active repo). Deployable as a Dockerized installable PWA.

Stack: Next.js **16.3.4** (App Router, Turbopack) · React **19.2.8** · TypeScript **5** · Tailwind CSS **v4** (via `@tailwindcss/postcss`) · shadcn/ui (new-york style, Radix UI primitives) · lucide-react icons · Serwist **9** (PWA service worker) · react-markdown + remark-gfm + rehype-highlight + highlight.js (content rendering) · @agentclientprotocol/sdk (agent chat) · Vitest **5** · pnpm **11.8.0** · Docker (node:22-alpine, standalone output)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## STRUCTURE
Layered: `app/` is routing only → `server/` (server-only git/fs logic) and `features/` (client UI by feature) → `lib/` (isomorphic, pure).
```
├── src/app/                    # ROUTING ONLY — keep thin
│   ├── layout.tsx              # Root layout: Geist fonts, PWA metadata, pre-hydration dark-mode script
│   ├── page.tsx                # Server component; just renders <HunkApp />
│   ├── login/page.tsx          # Login form
│   ├── manifest.ts             # MetadataRoute.Manifest → /manifest.webmanifest (only source — no public/ copy)
│   ├── sw.ts                   # Serwist service worker source
│   └── api/
│       ├── auth/{login,logout,me}/route.ts
│       ├── git/{status,diff,content,all-files,action,worktrees}/route.ts
│       ├── git/{blame,log,commit,branches,stash}/route.ts   (diff also takes ?commit=<sha>)
│       └── acp/{agents,sessions,action}/route.ts, acp/events/route.ts (SSE stream)
│                               # Each: parse params → resolveRepo() → one server/ call → JSON.
│                               #   Wrapped in withErrors() (HttpError → status, else 500 + git stderr).
├── src/proxy.ts                # Next 16 "proxy" (was middleware.ts): JWT session check, 401/redirect
├── src/server/                 # `import "server-only"` in every module
│   ├── config.ts               # projects.json (build-time import), defaultRepo(), findProject(),
│   │                           #   HUNK_ALLOW_ANY_REPO, loadIgnorePatterns()
│   ├── repo.ts                 # resolveRepo() allowlist (403) + resolveInRepo() path-escape guard (400)
│   ├── http.ts                 # HttpError, withErrors(), readJson(), requireParam(), errorMessage()
│   ├── git/exec.ts             # git(repo, args, {okExitCodes}) via execFile; isUnbornHead, EMPTY_TREE
│   ├── git/status.ts           # getStatus() (+ upstream/ahead/behind, HEAD, operation), getOperation(), isUntracked()
│   ├── git/diff.ts             # getDiff(repo, { file, oldPath, side })
│   ├── git/actions.ts          # `actions: Record<ActionName, handler>` — one fn per POST action
│   ├── git/worktree.ts         # list/add/remove worktrees, mainWorktreeOf() (reads .git file, no git)
│   ├── git/refs.ts             # requireRef / requireSha / requireNewBranchName / refExists (request validation)
│   ├── git/blame.ts            # getBlame(repo, file, ref?) — working tree, or as of a sha
│   ├── git/log.ts              # getLog (paged, --follow for a file, ?ref= another branch), getCommit, getCommitDiff
│   ├── git/branches.ts         # listBranches, switch/create/deleteBranch actions
│   ├── git/stash.ts            # listStashes, stash/stashPop/stashApply/stashDrop actions
│   ├── git/remote.ts           # fetch / pull (ff-only | rebase, autostash) / push (--force-with-lease)
│   ├── git/commit-tools.ts     # amend, undoCommit, revert, cherryPick, continue/abortOperation
│   ├── fs/files.ts             # read/write/create (file|dir)/rename/remove repo paths (path- and .git-guarded)
│   ├── fs/walk.ts              # All Files walker + ignore-pattern matching
│   └── acp/                    # agent chat: config.ts (acp.config.json), agent-process.ts (spawn +
│                               #   SDK ClientSideConnection), session.ts (event log, permissions),
│                               #   registry.ts (globalThis maps, list/open/prompt/cancel/close, idle reaper),
│                               #   shell.ts (`!`/`!!` prompt-box commands)
├── src/lib/                    # isomorphic + pure (no "use client", no server-only)
│   ├── git/types.ts            # API contract shared by routes and client (GitFile, RepoEntry, ActionName…)
│   ├── git/parse-status.ts     # porcelain v1 parser (one entry per staged/unstaged side)
│   ├── git/parse-diff.ts       # unified diff → hunks
│   ├── git/parse-worktrees.ts  # `git worktree list --porcelain -z` parser
│   ├── git/parse-{blame,log,branches,stash}.ts  # parsers (+ the git --format strings they expect)
│   ├── git/parse-conflict.ts   # conflict-marker parser + resolveConflict(content, i, ours|theirs|both)
│   ├── acp/                    # agent chat contract (types.ts), transcript.ts (event log → chat items),
│                               #   line-diff.ts (ACP diff → unified diff), permissions.ts, mentions.ts (@file parsing/ranking),
│                               #   agent-config.ts (settings → toolbar controls, context usage), shell-prefix.ts (!/!! parsing),
│                               #   tail-lines.ts (last-150-lines output buffer)
│   ├── repo-paths.ts           # topLevelPaths() — shared by server/fs and the sidebar
│   ├── time-ago.ts             # compact relative times ("5m", "2d")
│   ├── api-client.ts           # `api.*` typed fetchers — the ONLY place that calls /api/git/* and /api/acp/*
│   ├── auth.ts                 # JWT sign/verify, cookies, credentials from env
│   └── utils.ts                # cn()
├── src/features/               # client UI, one folder per feature
│   ├── app/                    # hunk-app.tsx ("use client" boundary + orchestration),
│   │                           #   app-header.tsx, use-keyboard-shortcuts.ts
│   ├── buffer/                 # open tabs: buffer.ts (pure reducer + persistence), use-buffer.ts
│   │                           #   (fetching, in-flight guard), use-editing.ts, tab-bar.tsx
│   ├── changes/                # use-git-status.ts, use-git-actions.ts, dialogs.tsx
│   ├── sidebar/                # tree.ts (pure), use-sidebar.ts (+useExpandedDirs), file-tree.tsx,
│   │                           #   sidebar-content.tsx (+Files toolbar), sidebar-frame.tsx (desktop aside + mobile sheet),
│   │                           #   file manager: file-ops.ts (pure), use-file-manager.ts, inline-name-input.tsx,
│   │                           #   tree-context-menu.tsx, move-dialog.tsx, selection.ts (pure multi-select)
│   ├── viewer/                 # viewer-panel.tsx (toolbar), file-viewer.tsx (view switch),
│   │                           #   diff/code/markdown/edit views, numbered-code.tsx, highlight-code.ts
│   ├── find/                   # find.ts (pure engine), use-find.ts, find-bar.tsx, highlight-segments.tsx
│   ├── quick-open/             # Ctrl/Cmd+P go-to-file palette: fuzzy.ts (pure ranker + path:line parse),
│   │                           #   use-quick-open.ts, quick-open.tsx (Radix dialog)
│   ├── files/                  # file-types.ts (binary/markdown/lang), status-display.tsx
│   ├── clipboard/              # use-copy-range.ts (click-twice path:line range copy)
│   ├── projects/projects.ts    # client copy of projects.json + ?project=&worktree= URL sync
│   ├── worktrees/              # worktrees.ts (pure: default path, labels), use-worktrees.ts,
│   │                           #   worktree-dialogs.tsx (add/remove)
│   ├── history/                # use-history.ts (paged log for the History tab), history-list.tsx,
│   │                           #   commit-detail.tsx + use-commit-diffs.ts (commit tab: lazy per-file diffs),
│   │                           #   commit-menu.tsx (undo/revert/cherry-pick menu + CommitActions contract)
│   ├── branches/               # use-branches.ts, branch-picker.tsx (header popover), branch-dialogs.tsx
│   ├── stash/                  # use-stash.ts, stash-menu.tsx (header popover)
│   ├── sync/                   # sync-menu.tsx (header ↑↓ + fetch/pull/push popover), sync-dialogs.tsx
│   ├── theme/theme.ts          # useTheme() over the .dark class
│   └── agent/                  # use-agent.ts (session + EventSource), agent-frame.tsx (aside/sheet +
│                               #   useAgentPanel, drag width), agent-panel.tsx, prompt-box.tsx
│                               #   (@-mentions, action buttons, resizable), config-bar.tsx (model/thinking/mode…),
│                               #   session-picker.tsx + use-session-list.ts (paged popover), chat-items.tsx
├── src/hooks/use-popover.ts     # open state + outside-click/Escape for hand-rolled popovers
├── src/components/ui/          # shadcn/ui (badge, button, card, context-menu, dialog, input, scroll-area,
│                               #   separator, sheet, skeleton, tabs, tooltip)
├── src/**/*.test.ts, test/     # Vitest; test/git-repo.ts creates throwaway git repos
├── projects.json               # Project list (name + dir [+ ignore]) — gitignored; imported at build time
├── ignore.config.json          # Global ignore patterns for all-files browser (read at runtime)
├── acp.config.json             # Agent list for the chat (gitignored + dockerignored; see acp.config.example.json)
├── Dockerfile / docker-compose.yml
└── public/                     # PWA icons (192/512/maskable/apple), generated sw.js, fonts/
```
*   `components.json`: shadcn/ui config — aliases `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`.
*   `pnpm-workspace.yaml`: `allowBuilds` flags (`@swc/core` allowed; sharp/unrs-resolver blocked).
*   Docker: container mounts host dirs `/mnt/storage` and `/DATA` so it can act on real repos; runs as `node` (uid 1000, matching host user for write access) with `git safe.directory '*'`.

## COMMANDS
| Action                | Command                          |
|-----------------------|----------------------------------|
| Install               | `pnpm install`                   |
| Dev server            | `pnpm dev`                       |
| Build                 | `pnpm build`                     |
| Start (prod)          | `pnpm start`                      |
| Lint                  | `pnpm lint`                       |
| Test                  | `pnpm test` (`pnpm test:watch`)   |
| Docker build & run    | `docker compose up -d --build`   |

Docker serves the app on **host port 3456** → container 3000 (`docker-compose.yml`).

**Host deploy** (alternative to Docker, so the agent chat sees the host toolchain — go, lerd php/composer, …): `scripts/deploy-host.sh` builds, copies static assets into `.next/standalone`, symlinks `acp.config.json`/`ignore.config.json` there, and (re)starts the systemd user unit `deploy/hunk.service` (port 3456, env from `.env.local`, explicit `PATH`). Don't run both — they share port 3456. Don't use `next start` (doesn't support `output: "standalone"`). pi-acp stores absolute session paths, so sessions created in Docker point at `/home/node/.pi/…`; rewrite them in `~/.pi/pi-acp/session-map.json` when switching.

Vitest (`vitest.config.mts`, node env). Unit tests sit next to the code (`*.test.ts`); git/fs integration tests run against temp repos from `test/git-repo.ts`; agent-chat tests drive `test/fake-acp-agent.mjs` (a scripted ACP agent) through the real registry. `server-only` is aliased to a stub for tests. UI has no automated tests — smoke-test in `pnpm dev`.

## CODING STANDARDS
*   **Language**: TypeScript, `strict: true`, `noEmit`, `moduleResolution: bundler`, `jsx: react-jsx`. Path alias `@/*` → `./src/*`.
*   **Style**: Function components; state lives in feature hooks (`use-*.ts`), pure logic in hook-free modules so it can be unit-tested (e.g. `buffer.ts` reducer, `find.ts`, `tree.ts`). Server logic lives in `src/server/`, never in route handlers. Kebab-case file names. No semicolons, double quotes in config files, no-quotes style in src. Plain `function` declarations preferred over arrow consts for top-level helpers.
*   **Lint/format**: ESLint 9 flat config (`eslint.config.mjs`) with `eslint-config-next` core-web-vitals + TS presets. No Prettier config.
*   **Styling**: Tailwind v4 utility classes; dark mode is **token-driven**: theme tokens are CSS variables in `globals.css` mapped via `@theme inline` (`bg-card`, `text-foreground`, `border-border`, `bg-primary`, …) plus `dark:` variants (`@custom-variant dark` on the `.dark` class) for semantic one-off colors (diff add/remove backgrounds). **Never** hardcode theme colors (`bg-white`, `bg-neutral-900`, `hover:bg-neutral-100`) and never compose class names with template interpolation — Tailwind JIT only sees complete literals.
*   **shadcn/ui**: new-york style, RSC on, CSS-variables theming. Add components with the shadcn CLI; they land in `src/components/ui/`.
*   **API routes / git**: always go through `git()` in `server/git/exec.ts` (argument array, `--` before paths). Never use `exec` or build shell strings. Every route resolves the repo with `resolveRepo()` and every repo-relative path with `resolveInRepo()`. Throw `HttpError` for 4xx; let `withErrors` handle the rest. Add request/response types to `lib/git/types.ts` and a wrapper to `lib/api-client.ts`.
*   **Boundaries**: `features/` must never import `server/` (enforced by `server-only`). `lib/` stays pure. Only `features/app/hunk-app.tsx` carries `"use client"`.

## WHERE TO LOOK
*   **Source**: `src/server/` (backend), `src/features/` (UI), `src/lib/` (shared contract + parsers), `src/app/` (routes)
*   **Feature plans**: `docs/plan/NN-*.md` (numbered by creation order; context + goals for each feature)
*   **Docs**: `README.md` (stock create-next-app); Next.js guides in `node_modules/next/dist/docs/` (see the agent-rules block above)
*   **Other context files**: `CLAUDE.md` → references `@AGENTS.md` (this file)

## NOTES
*   **Rebrand (git-review → Hunk)**: legacy names still work — `GIT_REVIEW_ALLOW_ANY_REPO` / `GIT_REVIEW_ACP_CONFIG` are read as fallbacks for the `HUNK_*` env vars, and the pre-hydration script in `layout.tsx` moves old `git-review-*` localStorage keys to `hunk-*` once. The session cookie was renamed (`hunk-session`), so everyone logs in again once.
*   **This is Next.js 16** — do NOT assume training-data knowledge of its APIs; consult `node_modules/next/dist/docs/` first (see block above).
*   **Repo allowlist**: `resolveRepo()` (async) only accepts dirs listed in `projects.json` **or linked worktrees of them** (403 otherwise). A worktree is recognised by reading its `.git` file (never by running git inside an unlisted dir) and confirmed with `git worktree list` in the project dir. Set `HUNK_ALLOW_ANY_REPO=1` to lift it. A missing `repo` param falls back to the **first** project — same default as the client. There is no hardcoded repo path anymore.
*   **projects.json** is imported **at build time** by both `server/config.ts` and `features/projects/projects.ts` — editing it (including per-project `ignore`) needs a rebuild/restart. It is gitignored but must exist to build (Docker copies it via `COPY . .`).
*   **Untracked-diff quirk** (`server/git/diff.ts`): untracked files are diffed via `git diff --no-index /dev/null <file>`, which exits 1 on success — passed as `okExitCodes: [1]` to `git()`. Staged diffs and unstage fall back to the empty tree / `git rm --cached` when HEAD is unborn (`isUnbornHead()`).
*   **all-files browser** (`server/fs/walk.ts`): walks with `readdir`/`stat`, ignore patterns = global `ignore.config.json` (hardcoded fallback if missing/malformed) ∪ per-project `"ignore"`. Pattern syntax: bare name = any path segment; `*.ext` = suffix; `name*` = prefix; `a/b` = path prefix.
*   **Worktrees**: the app tracks `projectDir` (from projects.json) and `repoPath` (the worktree every API call targets). The header is one row: a `project / branch` breadcrumb — `RepoSwitcher` (`features/projects/repo-switcher.tsx`: switch project or worktree, New worktree…, remove) and `BranchPicker` (create a branch here or in a new worktree, a branch checked out elsewhere opens that worktree, per-row "new worktree"). Both open `AddWorktreeDialog` with a `NewWorktreeSeed` prefill (remounted via `key`). Header popovers are `fixed inset-x-3` below `sm` so they never push the page sideways; arrow keys move between `[role=option]` rows (`moveOptionFocus`). `addWorktree`/`removeWorktree` are actions; worktree commands run from the main worktree. New worktree paths must be absolute and inside the main worktree's parent dir (UI default `<parent>/<repo>-<branch-slug>`), unless `HUNK_ALLOW_ANY_REPO=1`.
*   **Tabs** (`features/buffer/`): right-click a tab for Close / Others / to the Right / All, plus a Close-all button at the strip's end (2+ tabs); bulk closes go through `closeMany` and confirm once for unsaved tabs. Persisted per repo under `hunk-tabs-<base64 repo>` (list + active id only; content is re-fetched). `useBuffer` keeps a synchronous in-flight `Set` ref so rapid clicks don't queue duplicate fetches, and re-fetches the active tab once status has loaded (rename hints need `files`).
*   **Advanced git** — plan `docs/plan/23-advanced-git-features.md`:
    *   **Blame** is a view mode (`viewMode: "blame"`, available on every file tab); click a sha to open that commit.
    *   **Commit tabs**: buffer entries with `commit` set (`file` is ""), id `<repo>::commit::<sha>`. Opened from History, blame, stash ("show changes") and parent links. Diffs are against the **first parent** (stash commits therefore show the stashed tracked changes; untracked files in a stash aren't shown). Find is disabled there.
    *   **History** is the 4th sidebar tab (tabs are controlled by the app so "file history" — toolbar button or right-click a file in any tree — can switch to it). Loads lazily, 50 commits per page, infinite scroll.
    *   Shas from requests must be hex (`requireSha`) — no ref expressions. Branch names go through `requireRef` (no leading "-") and `check-ref-format` for new ones.
    *   **switchBranch** refuses (409) with tracked changes unless `stash: true`; the UI asks first ("Stash & Switch"). Remote branches ("origin/x") switch via `switch --track`, or to the existing local branch of the same name.
    *   **Conflicts**: porcelain unmerged codes (UU/AA/DU/…) → one `status: "conflicted"`, unstaged entry. Their diff is a combined diff, so `fetchEntry` also loads raw content and the viewer shows the conflict view (current | incoming panes, base in diff3 style). Resolutions live in `editContent`/`dirty` (like edit mode) until Save; "Mark resolved" = `add`.
*   **Remote sync & commit tools** — plan `docs/plan/26-git-remote-sync-and-commit-tools.md`:
    *   Network git (fetch/pull/push) goes through `remoteGit()` (`server/git/exec.ts`): `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS_REQUIRE=force` + `SSH_ASKPASS=false` (ssh prompts fail instead of waiting on a terminal; agent and credential helpers still work) and a 60s timeout → 504. Never call plain `git()` for anything that talks to a remote.
    *   Status comes from `git status --porcelain --branch` (v1 + the `## a...b [ahead n, behind m]` header, `parseBranchHeader`), plus `head`/`headSubject` and `operation` (merge/rebase/cherry-pick/revert, from `--git-path` state files). ahead/behind are as of the last fetch.
    *   `pull` is always explicit (`--no-rebase --ff-only` or `--rebase`) so `pull.rebase` config can't change it; tracked changes → 409 unless `stash` (`--autostash`; the UI asks "Stash & Pull"). A rejected push errors with the `PUSH_REJECTED` prefix → the client offers force push, which is only ever `--force-with-lease`.
    *   Revert/cherry-pick of a merge use `-m 1`. A pick that would be empty is aborted and reported (409). Conflicts leave the operation in progress: the header banner offers Continue (`GIT_EDITOR=true`, refuses while unmerged paths remain) / Abort. Those "failed" actions are in `PARTIAL_ACTIONS` (`hunk-app.tsx`), which refreshes status/history on failure too.
    *   `undoCommit` = `reset --soft HEAD~1`, guarded by the sha the UI saw (409 if HEAD moved); refused on the root commit. Amend with an empty message keeps HEAD's (`--no-edit`). Both confirm first when HEAD is already on the upstream.
    *   Cherry-pick sources: a branch's history (branch picker → History icon sets `history.ref`); the commit tab offers it unless the commit is HEAD or in the current branch's loaded history.
*   **Sidebar file manager** (plan `docs/plan/28-sidebar-file-manager.md`): all file management lives in the sidebar — the header has no New File button. Files tab toolbar (New File / New Folder / Collapse All / Refresh), VS Code-style inline create/rename rows, no row buttons in the Files tree (right-click / long-press menu only; Changes/Staged rows keep stage/discard hover buttons, always visible on `pointer-coarse`), one right-click menu per tree (`TreeContextMenu`; the row records itself as the target on `contextmenu`, the wrapper resets it to null first via capture), row keys `F2` / `Del` / `a` / `Shift+A`, drag-to-move (desktop), `Ctrl/Cmd+Alt+N` (matched on `e.code`). New items go in `useFileManager().target`: the clicked folder, else the active file's folder, else the root (click empty space). Actions: `create` (makes parent dirs), `createDir`, `rename` (`path` → `to`; `git mv` when anything under it is tracked, else `fs.rename`), `delete` (recursive). All refuse `.git`. Tabs follow renames (`buffer` `remap`, new key from fresh status) and close on delete (`closeUnder`); a created text file opens in edit mode. The shadcn CLI resolves the `utils` alias to an npm package called `cn` — fix the import to `@/lib/utils` and don't keep that dependency.
*   **Multi-select** (plan `docs/plan/29-sidebar-multi-select-actions.md`), in all three trees:
    *   **Selecting**: `Ctrl/Cmd+click` toggles (a first toggle includes the previously clicked row), `Shift+click` / `Shift+↑↓` select ranges, `Ctrl/Cmd+A` selects all visible rows, `Esc` or clicking empty space clears. The menu's "Add to Selection" builds one on touch screens.
    *   **State** lives in `sidebar-content.tsx` (pure transitions in `selection.ts`) and is pruned every render against the tree's paths, so moved, deleted or staged rows drop out without explicit clears. A plain click never creates a one-item selection.
    *   **Acting**: a selection bar appears above the tree. Right-clicking a selected row opens the bulk menu, and right-clicking any other row clears the selection. `Del` and drag act on the whole selection.
    *   Bulk Stage/Discard expand selected folders to the changed files under them.
    *   **Server**: action `move` (`files` + `to` folder) skips items already there and validates everything before moving anything. The client mirrors it with `validateMoveTarget` / `moveTargets`, and the latter drives the tab remap. Drag-and-drop always uses `move`; F2 rename uses `rename`.
*   **Quick Open** (`features/quick-open/`, plan `docs/plan/25-quick-open-file-picker.md`): Ctrl/Cmd+P (also the header search button) fuzzy-finds over `repoFiles` (All Files minus git-ignored) ∪ changed files; empty query = open tabs then changed files. It's separate from the sidebar search input, which stays a tree/History filter. While it's open the global shortcut handler ignores keys. `path:42` opens the file raw (All Files tab) with `BufferEntry.gotoLine`, which `NumberedCode` scrolls to/highlights (CodeView only).
*   **Dark mode**: persisted in `localStorage` under key `hunk-dark`. The `.dark` class is applied **pre-hydration** by an inline script in `layout.tsx` (localStorage → falls back to `prefers-color-scheme`), so there is no theme flash. `useTheme()` (`features/theme/theme.ts`) reads it via `useSyncExternalStore` and writes `localStorage` + toggles the class. Keep the key in sync with `layout.tsx`.
*   **Viewer toolbar** (plan 34): visible = Discard · Stage · Split/Unified/Raw · Find · ⋯; everything else (Edit, Markdown, Blame, File history, Fullscreen, Delete) lives in the ⋯ `DropdownMenu` (`components/ui/dropdown-menu.tsx`, hand-written shadcn wrapper over `radix-ui`). On phones the CommitBar is a floating Commit pill + bottom `Sheet`, and the ActionToast sits under the header.
*   **React compiler lint** (`react-hooks/refs`): don't return a ref inside an object you then read during render — destructure it (see `useFullscreen` in `viewer-panel.tsx`).
*   **PWA**: Serwist wraps `next.config.ts` (`withSerwist` from `@serwist/turbopack`); worker source is `src/app/sw.ts` (precache + `defaultCache` runtime caching, `skipWaiting`/`clientsClaim`); compiled to `public/sw.js`. `manifest.webmanifest` is served via `src/app/manifest.ts`. `output: "standalone"` is required for the slim Docker image.
*   The `LayoutProps<"/">` type in `layout.tsx` is a Next.js 16 global type (not a local import).
*   **Agent chat (ACP)** — plan `docs/plan/22-add-acp-agent-chat.md`:
    *   **Security**: anyone logged in can make the agent run commands and edit files as the server user inside allowlisted repos. Exposing Hunk publicly means exposing a coding agent. The agent command comes only from `acp.config.json` (`HUNK_ACP_CONFIG` overrides the path; fallback = `claude-agent-acp`), never from a request; `cwd` is always `resolveRepo()`'d.
    *   **Transport**: SSE (`GET /api/acp/events`, `id:` = event seq, replay from `Last-Event-ID`, `reset` when the client is new or fell behind the 20k-event buffer) + `POST /api/acp/action`. No WebSocket/custom server, so `output: "standalone"` stays. The service worker has a `NetworkOnly` rule for `/api/acp/` before `defaultCache` (whose `/api/` NetworkFirst would try to cache the endless stream).
    *   **State lives in server memory** (`globalThis.__hunkAcp`): one agent process per (agent, repo/worktree), sessions with their event logs. Turns keep running after the browser leaves; permission requests wait for an answer (or auto mode). Idle processes are killed after 30 min; children are killed synchronously on `process.exit` (async cleanup never runs there). After a restart, sessions come back via `session/load` ("Resume"), which replays history.
    *   Agent env strips `CLAUDECODE`/`NODE_OPTIONS` (claude refuses to start "nested" when Hunk itself was launched from Claude Code).
    *   **@-mentions**: `@path` stays in the prompt text; on send, mentioned paths that are real repo files go along as `files` and the server adds one ACP `resource_link` (`file://` URI, `resolveInRepo()`-checked, max 50) per file. Suggestions skip git-ignored files (`mentionableFiles()`: All Files entries with status `ignored`, i.e. neither `ls-files --cached` nor `--others --exclude-standard`). A mention ends at whitespace, so paths with spaces can't be mentioned.
    *   **Agent settings toolbar** (model, thinking/effort, mode, …): built only from what the agent advertises — ACP `configOptions` from session/new|load|resume, kept current by `config_option_update` / `current_mode_update` and by `setSessionConfigOption` responses. The legacy `modes` list is shown only when an agent sends no config options (pi's modes duplicate its thinking levels). `AgentSession.config` holds the latest snapshot and the SSE route sends it right after a `reset`, so it survives the event buffer rolling over. Options can disappear after a change (Claude drops Effort for haiku), so controls always re-render from the latest list. Context usage comes from `usage_update`.
    *   **Shell commands** (plan `docs/plan/27-agent-chat-shell-commands.md`): `!cmd` in the prompt box runs `cmd` on the server (`server/acp/shell.ts`, `$SHELL -c` in the session's repo, own process group, no stdin, one per session) — **not** the agent. This is the one deliberate exception to "never a shell"; it grants nothing a logged-in user can't already get from the agent. `HUNK_SHELL_DISABLED=1` turns it off. Env (read per run, set in `.env.local`): `HUNK_SHELL_MAX_LINES` (default 150, max 5000) and `HUNK_SHELL_TIMEOUT` (seconds, default 300). Output = last N lines (`lib/acp/tail-lines.ts`, shared by server and transcript). `!` results are prepended to the **next** prompt once (`session.sharedShell`); `!!cmd` is private and never reaches the agent; a request without `share` counts as private; `\!` sends a literal `!`. Live output goes out as `shell_output` snapshots via `session.broadcast()` (not logged, current seq), only `shell_start`/`shell_end` are logged.
    *   Auto mode is client-side (Hunk answers `allow_once`, then `allow_always`), per session, default off.
    *   **Docker**: the image installs `claude-agent-acp` (musl build), `pi` (`@earendil-works/pi-coding-agent`, pinned to the host's version) + `pi-acp`, and bash + ripgrep + fd, and ships `acp.config.example.json` as its `acp.config.json` (the host's own file is dockerignored). Compose mounts `~/.claude`, `~/.claude.json` and `~/.pi` into `/home/node` for logins, settings and sessions, and hides `~/.pi/agent/bin` behind a tmpfs (the host's glibc `fd`/`rg` can't run on alpine). The agents' tools only see the container's toolchain.
    *   `next dev` blocks HMR/dev resources for non-`localhost` origins (e.g. `127.0.0.1`); smoke-test the UI over `localhost` or against a production build.
