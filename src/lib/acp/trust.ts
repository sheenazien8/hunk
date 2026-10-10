// True when agent output asks the user to trust the project folder (pi's
// "This project is not trusted…" / "Trust project folder?", claude's
// "accept the trust dialog"). The chat then offers a Trust button.
export function asksForTrust(text: string): boolean {
  return /not trusted|trust dialog|trust (the |this )?(project|folder|repo|workspace)/i.test(text)
}
