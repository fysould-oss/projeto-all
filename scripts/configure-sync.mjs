import { spawn } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('A configuração protegida usa o Windows.');
const script = [
  "$ErrorActionPreference = 'Stop'",
  "$line = [Console]::In.ReadLine()",
  "if (!$line) { exit 1 }",
  "$folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ProjetoAll'",
  "[IO.Directory]::CreateDirectory($folder) | Out-Null",
  "$encoded = ConvertTo-SecureString $line -AsPlainText -Force | ConvertFrom-SecureString",
  "[IO.File]::WriteAllText((Join-Path $folder 'sync.dpapi'), $encoded)",
].join('\n');

console.log('Aguardando a credencial da sincronização privada. A entrada está oculta.');
let credential = '';
process.stdin.setRawMode?.(true);
for await (const chunk of process.stdin) {
  const input = credential + chunk.toString('utf8');
  const end = input.search(/[\r\n]/);
  if (end !== -1) {
    credential = input.slice(0, end).trim();
    break;
  }
  if (input.length > 4096 || input.includes('\x03')) process.exit(1);
  credential = input;
}
process.stdin.setRawMode?.(false);
if (!credential || credential.length > 4096) throw new Error('Credencial inválida.');
const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
});
const result = new Promise((resolve, reject) => {
  child.once('exit', resolve);
  child.once('error', reject);
});
child.stdin.end(credential + '\n');
if (await result !== 0) throw new Error('Não foi possível salvar a credencial protegida.');
console.log('Sincronização privada configurada para este usuário do Windows.');
