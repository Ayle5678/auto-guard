/** Display helpers for filesystem paths (tilde-collapse home prefix). */
import { homedir } from 'node:os'

/** `C:\Users\me\.pi\auto-guard` → `~/.pi/auto-guard`. */
export function tildeRoot(path: string): string {
  const home = homedir()
  if (path.startsWith(`${home}\\`) || path.startsWith(`${home}/`)) {
    return `~${path.slice(home.length).replaceAll('\\', '/')}`
  }
  return path.replaceAll('\\', '/')
}
