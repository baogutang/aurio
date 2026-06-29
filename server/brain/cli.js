// CLI brain: spawn a locally-installed coding CLI as a subprocess and feed it
// the prompt on stdin. Each CLI uses *its own* saved login (Claude Max, Codex
// ChatGPT login, etc.) — Aurio stores no key for this path.
//
// Presets define the binary + argv; the prompt always goes in on stdin:
//   claude → `claude -p --output-format json [--model X]`   (reply wrapped in JSON)
//   codex  → `codex exec --skip-git-repo-check -`           (final message on stdout)
//   cli    → custom binary from settings (AI_CLI_BIN), prompt on stdin
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { toAction } from './parse.js';

const MAC_CODEX_DESKTOP_BIN = '/Applications/Codex.app/Contents/Resources/codex';

function hasOnPath(bin) {
  const parts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return parts.some((dir) => fs.existsSync(path.join(dir, bin)));
}

const PRESETS = {
  claude: {
    bin: 'claude',
    args: (cfg) => ['-p', '--output-format', 'json', ...(cfg.model ? ['--model', cfg.model] : [])],
    wrapped: true, // stdout is { type, result, is_error, ... }
  },
  codex: {
    bin: 'codex',
    args: () => ['exec', '--skip-git-repo-check', '-'],
    wrapped: false, // stdout is the plain final message
  },
  cli: {
    bin: '', // taken from cfg.bin
    args: () => [],
    wrapped: false,
  },
};

function resolve(cfg) {
  const preset = PRESETS[cfg.preset] || PRESETS.claude;
  let bin = cfg.bin || preset.bin || process.env.CLAUDE_BIN || 'claude';
  if (!cfg.bin && cfg.preset === 'codex' && process.platform === 'darwin' && !hasOnPath('codex') && fs.existsSync(MAC_CODEX_DESKTOP_BIN)) {
    bin = MAC_CODEX_DESKTOP_BIN;
  }
  return { preset, bin, args: preset.args(cfg) };
}

function childEnv(cfg) {
  const e = { ...process.env };
  if (cfg.forceLogin) {
    // Use the tool's stored login instead of any inherited token, which may be
    // invalid for a freshly spawned process (fixes "401 Invalid bearer token").
    delete e.ANTHROPIC_API_KEY;
    delete e.ANTHROPIC_AUTH_TOKEN;
  }
  return e;
}

function explainCliError(bin, detail) {
  if (
    bin.includes('Codex.app')
    && /readonly database|Operation not permitted|failed to open state db/i.test(detail)
  ) {
    return `${detail}\nCodex Desktop 的内置命令已找到，但当前进程不能写入 Codex 状态目录。请在普通终端/桌面 App 环境运行 Aurio，或改用 Claude CLI / API Key。`;
  }
  return detail;
}

// Run the CLI with the prompt on stdin. Returns raw stdout.
function runCli(prompt, cfg) {
  const { bin, args } = resolve(cfg);
  return new Promise((resolve_, reject) => {
    // On Windows `claude`/`codex` are .cmd shims, which Node can only launch via
    // a shell. Pass the whole command as one string (no args array) to avoid the
    // DEP0190 warning that fires when an args array is combined with shell:true.
    let child;
    if (process.platform === 'win32') {
      const cmd = `"${bin}" ${args.join(' ')}`;
      child = spawn(cmd, { shell: true, windowsHide: true, env: childEnv(cfg) });
    } else {
      child = spawn(bin, args, { windowsHide: true, env: childEnv(cfg) });
    }

    let stdout = '', stderr = '';
    const killer = setTimeout(() => { child.kill(); reject(new Error(`${bin} timed out`)); }, 120000);

    child.on('error', (e) => {
      clearTimeout(killer);
      reject(new Error(e.code === 'ENOENT' ? `找不到命令：${bin}（未安装或不在 PATH）` : e.message));
    });
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(killer);
      // CLIs often put API errors in stdout JSON, so include it in the failure text.
      if (code !== 0) {
        const detail = explainCliError(bin, (stderr || stdout).slice(0, 400));
        return reject(new Error(`${bin} exited ${code}: ${detail}`));
      }
      resolve_(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Unwrap claude's JSON envelope ({ result }) → text; pass everything else through.
function unwrap(raw, cfg) {
  const preset = (PRESETS[cfg.preset] || PRESETS.claude);
  if (!preset.wrapped) return raw;
  try { const w = JSON.parse(raw); return (w.result ?? raw).toString(); }
  catch { return raw; }
}

export async function think(prompt, cfg) {
  return toAction(unwrap(await runCli(prompt, cfg), cfg));
}

export async function ask(prompt, cfg) {
  return unwrap(await runCli(prompt, cfg), cfg).toString();
}

// Returns { ok, detail }. detail explains why the brain is unavailable.
export async function available(cfg) {
  try {
    const raw = await runCli('Reply with exactly: OK', cfg);
    if ((PRESETS[cfg.preset] || PRESETS.claude).wrapped) {
      try {
        const w = JSON.parse(raw);
        if (w && w.is_error) return { ok: false, detail: (w.result || 'error').toString().slice(0, 200) };
      } catch { /* unwrapped output is fine */ }
    }
    return { ok: true, detail: '' };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// Probe which coding CLIs are installed (for the settings UI). Short timeout.
function binCandidates(bin) {
  if (bin === 'codex' && process.platform === 'darwin') return ['codex', MAC_CODEX_DESKTOP_BIN];
  return [bin];
}

export function detectClis(bins = ['claude', 'codex', 'gemini']) {
  const probeOne = (bin) => new Promise((resolve_) => {
    let child;
    try {
      if (process.platform === 'win32') {
        child = spawn(`"${bin}" --version`, { shell: true, windowsHide: true });
      } else {
        child = spawn(bin, ['--version'], { windowsHide: true });
      }
    } catch { return resolve_(false); }
    const killer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } resolve_(false); }, 4000);
    child.on('error', () => { clearTimeout(killer); resolve_(false); });
    child.on('close', (code) => { clearTimeout(killer); resolve_(code === 0); });
  });
  const probe = async (bin) => {
    for (const candidate of binCandidates(bin)) {
      if (candidate !== bin && !fs.existsSync(candidate)) continue;
      if (await probeOne(candidate)) return true;
    }
    return false;
  };
  return Promise.all(bins.map(probe)).then((oks) =>
    Object.fromEntries(bins.map((b, i) => [b, oks[i]]))
  );
}
