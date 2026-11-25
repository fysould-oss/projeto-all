import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const readProtected = [
  "$path = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ProjetoAll\\sync.dpapi'",
  "if (Test-Path -LiteralPath $path) {",
  "  $secret = Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString",
  "  [Console]::Out.Write([Net.NetworkCredential]::new('', $secret).Password)",
  "}",
].join('\n');

export async function readRelayCredential() {
  if (process.env.PROJETO_ALL_SYNC_TOKEN) return process.env.PROJETO_ALL_SYNC_TOKEN;
  if (process.platform !== 'win32') return '';
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', readProtected], {
      windowsHide: true, timeout: 5000, maxBuffer: 8192,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}
