// What a prompt-box message means: `!cmd` runs cmd and shares the output
// with the agent on the next prompt, `!!cmd` runs it privately, `\!…` sends
// a literal "!…" to the agent, anything else is a prompt.
export type PromptInput =
  | { kind: "shell"; command: string; share: boolean }
  | { kind: "prompt"; text: string }

export function parsePromptInput(input: string): PromptInput {
  const text = input.trim()
  if (text.startsWith("\\!")) return { kind: "prompt", text: text.slice(1) }
  if (text.startsWith("!!")) return { kind: "shell", command: text.slice(2).trim(), share: false }
  if (text.startsWith("!")) return { kind: "shell", command: text.slice(1).trim(), share: true }
  return { kind: "prompt", text }
}
