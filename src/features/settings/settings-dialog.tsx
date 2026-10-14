import { type ReactNode, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { ConfirmRequest } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api-client"
import type { AgentInfo } from "@/lib/acp/types"
import { clampInt, SHELL_LINES_MAX, SHELL_TIMEOUT_MAX } from "@/lib/settings/types"
import { cn } from "@/lib/utils"
import type { SettingsState } from "./use-settings"

// Same wording as the per-session toggle in the agent panel.
export const AUTO_MODE_WARNING = "The agent will run commands and edit files without asking."

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-3 last:border-b-0 sm:px-6">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

function Row({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full border border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-background shadow transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
    </button>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// `envValue` = set by an env var: shown read-only.
function NumberField({ id, value, max, envValue, onCommit }: {
  id: string
  value: number
  max: number
  envValue?: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const next = clampInt(draft, value, max)
    setDraft(null)
    if (next !== value) onCommit(next)
  }
  if (envValue !== undefined) {
    return (
      <div className="flex items-center gap-2">
        <Input id={id} className="h-8 w-24 text-right" value={envValue} disabled readOnly />
        <span className="text-[10px] text-muted-foreground">set by env</span>
      </div>
    )
  }
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      className="h-8 w-24 text-right"
      value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape" && draft !== null) {
          e.stopPropagation()
          setDraft(null)
        }
      }}
    />
  )
}

function IgnoreEditor({ value, defaults, onSave }: { value: string[] | null; defaults: string[]; onSave: (value: string[] | null) => void }) {
  const current = (value ?? defaults).join("\n")
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    if (draft === null) return
    setDraft(null)
    if (draft === current) return
    const list = draft.split("\n").map(l => l.trim()).filter(Boolean)
    onSave(list.length > 0 ? list : null)
  }
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor="settings-ignore" className="text-sm font-medium">Ignore patterns</label>
        {value !== null && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onSave(null)}>Reset to defaults</Button>
        )}
      </div>
      <textarea
        id="settings-ignore"
        rows={7}
        spellCheck={false}
        value={draft ?? current}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        One per line, for All Files and Quick Open. <code>name</code> = any path segment, <code>*.ext</code> suffix, <code>name*</code> prefix, <code>a/b</code> path prefix. Per-project patterns from projects.json are added on top.
        {value === null && " Showing the defaults."}
      </p>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, state, confirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: SettingsState
  confirm: (request: ConfirmRequest) => Promise<boolean>
}) {
  const { settings, env, ignoreDefaults, update } = state
  const [agents, setAgents] = useState<AgentInfo[]>([])

  useEffect(() => {
    if (!open || agents.length > 0) return
    api.acp.agents().then(setAgents, () => {})
  }, [open, agents.length])

  const setAutoApprove = async (enabled: boolean) => {
    if (enabled && !(await confirm({
      title: "Start new sessions in auto mode?",
      description: `${AUTO_MODE_WARNING} This applies to every new or resumed session, on every device. You can still turn it off per session.`,
      confirmLabel: "Turn on",
      destructive: true,
    }))) return
    void update({ agent: { autoApproveDefault: enabled } })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[85vh] sm:max-w-xl">
        <DialogHeader className="border-b border-border px-4 py-3 text-left sm:px-6">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved on the server and shared by every device.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Agent">
            <Row label="Auto mode for new sessions" hint="Sessions start without permission prompts. Questions are still asked." htmlFor="settings-auto">
              <Switch id="settings-auto" checked={settings.agent.autoApproveDefault} onChange={v => void setAutoApprove(v)} />
            </Row>
            <Row label="Default agent" hint="Used when this browser has no last-used agent." htmlFor="settings-agent">
              <select
                id="settings-agent"
                value={settings.agent.defaultAgent}
                onChange={e => void update({ agent: { defaultAgent: e.target.value } })}
                className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">First configured</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                {settings.agent.defaultAgent && !agents.some(a => a.id === settings.agent.defaultAgent) && (
                  <option value={settings.agent.defaultAgent}>{settings.agent.defaultAgent} (not configured)</option>
                )}
              </select>
            </Row>
            <Row label="Shell output lines" hint={`Lines kept from a ! command (max ${SHELL_LINES_MAX}).`} htmlFor="settings-lines">
              <NumberField
                id="settings-lines"
                value={settings.agent.shellMaxLines}
                max={SHELL_LINES_MAX}
                envValue={env.shellMaxLines}
                onCommit={v => void update({ agent: { shellMaxLines: v } })}
              />
            </Row>
            <Row label="Shell timeout" hint="Seconds before a ! command is stopped." htmlFor="settings-timeout">
              <NumberField
                id="settings-timeout"
                value={settings.agent.shellTimeout}
                max={SHELL_TIMEOUT_MAX}
                envValue={env.shellTimeout}
                onCommit={v => void update({ agent: { shellTimeout: v } })}
              />
            </Row>
          </Section>

          <Section title="Viewer">
            <Row label="Default diff view" hint="For newly opened tabs.">
              <Segmented
                label="Default diff view"
                value={settings.viewer.defaultDiffView}
                options={[{ value: "split", label: "Split" }, { value: "unified", label: "Unified" }]}
                onChange={v => void update({ viewer: { defaultDiffView: v } })}
              />
            </Row>
            <Row label="Render Markdown" hint="Markdown files open rendered." htmlFor="settings-md">
              <Switch id="settings-md" checked={settings.viewer.renderMarkdown} onChange={v => void update({ viewer: { renderMarkdown: v } })} />
            </Row>
          </Section>

          <Section title="Git">
            <Row label="Confirm before push" htmlFor="settings-push">
              <Switch id="settings-push" checked={settings.git.confirmPush} onChange={v => void update({ git: { confirmPush: v } })} />
            </Row>
          </Section>

          <Section title="Files">
            <IgnoreEditor value={settings.files.ignore} defaults={ignoreDefaults} onSave={v => void update({ files: { ignore: v } })} />
          </Section>

          <Section title="Appearance">
            <Row label="Theme">
              <Segmented
                label="Theme"
                value={settings.theme}
                options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]}
                onChange={v => void update({ theme: v })}
              />
            </Row>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
