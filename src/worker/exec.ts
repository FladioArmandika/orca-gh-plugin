// Child processes: the host API cannot run one, but a trusted-worker is plain Node.
import { execFile } from 'node:child_process'
import { delimiter } from 'node:path'

export type RunResult = { code: number; stdout: string; stderr: string }
export type RunOptions = { cwd?: string; timeoutMs?: number; maxBuffer?: number }
/** Resolves with the exit code; rejects only when the command did not run (ENOENT, timeout). */
export type Run = (cmd: string, args: string[], options?: RunOptions) => Promise<RunResult>

// Orca hands workers the login shell's PATH. Homebrew's folders go after it, for a launch from
// the Dock that leaves only launchd's, so a gh the user's PATH picks first still wins.
export function fallbackPath(path: string | undefined): string {
  return [path || '/usr/bin:/bin:/usr/sbin:/sbin', '/opt/homebrew/bin', '/usr/local/bin'].join(delimiter)
}

const ENV = {
  ...process.env,
  PATH: fallbackPath(process.env.PATH),
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GIT_TERMINAL_PROMPT: '0',
  NO_COLOR: '1'
}

const realRun: Run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: options.cwd,
        env: ENV,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code
        if (error && typeof code !== 'number') return reject(error)
        resolve({ code: typeof code === 'number' ? code : 0, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })

let current: Run = realRun

/** Tests swap in a fake; everything else goes through `run`. */
export function setRunner(runner: Run | null): void {
  current = runner ?? realRun
}

export const run: Run = (cmd, args, options) => current(cmd, args, options)

/** The first line of what a failed command printed, without gh's noise. */
export function errorLine(result: RunResult): string {
  const text = (result.stderr || result.stdout).trim()
  const line = text.split('\n').find((l) => l.trim()) ?? `exited with code ${result.code}`
  return line.replace(/^(gh|git|error|fatal):\s*/i, '').trim()
}

export function notFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT'
}
