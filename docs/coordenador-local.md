# Coordenador local

Use Node.js 24, Git e o executável local do Codex autenticado. O coordenador roda sob a sua conta no Windows. Ele recebe instruções pelo terminal local. A página pública, o painel privado e o APK não enviam tarefas a esta fila.

Crie um arquivo JSON local com os dois executores. Informe o caminho absoluto existente em cada entrada. O campo opcional `model` aceita um modelo disponível na sua conta.

```json
{"executors":[
  {"binary":"C:/caminho/para/codex.exe"},
  {"binary":"C:/caminho/para/codex.exe"}
]}
```

Na pasta deste projeto, use PowerShell:

```powershell
'Revise os testes existentes e resuma o resultado.' | node scripts/coordinator.mjs add C:/projetos/meu-repo
node scripts/coordinator.mjs run C:/config/executores.json
```

Use `once` no lugar de `run` para processar no máximo uma tarefa em cada executor. Consulte o andamento em outro terminal com `node scripts/coordinator.mjs list` e os eventos com `node scripts/coordinator.mjs events ID`. O servidor local também disponibiliza os 50 registros mais recentes em `GET /api/local-tasks`. O relay do painel privado continua enviando apenas seu snapshot habitual.

A fila SQLite e as worktrees ficam em `~/.projeto-all/coordinator`. Para mudar o local, defina `PROJETO_ALL_COORDINATOR_HOME` no monitor e nos executores. Escolha uma pasta privada fora dos repositórios e de pastas sincronizadas. A fila guarda o texto para entrega e limpa o campo quando a tarefa termina. O registro de eventos preserva apenas tipo e horário. A saída de textos e comandos pode existir no histórico próprio do Codex.

Cada tarefa usa o commit HEAD registrado na inclusão, uma branch `coordinator/ID` e a pasta `worktrees/ID`. Alterações locais pendentes do repositório de origem ficam de fora. O prompt segue por stdin para `codex exec --json --sandbox workspace-write`. O coordenador não faz merge, push, instalação nem limpeza da worktree. Revise o diff e os arquivos novos antes de integrar. O resultado `turn_completed` indica que o processo retornou zero e informou conclusão. Os testes do projeto dependem da instrução que você fornecer.

Após interrupção abrupta, verifique a worktree e os processos locais. `node scripts/coordinator.mjs recover ID` encerra o registro abandonado depois que os PIDs conhecidos deixam de existir. A tarefa não será repetida. Se desejar outra tentativa, inclua uma nova instrução. Para verificar a implementação, execute `node --test monitor/coordinator.test.mjs`.
