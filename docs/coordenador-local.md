# Coordenador local

Use Node.js 24, Git e o executável local do Codex autenticado. O coordenador roda sob a sua conta no Windows. As tarefas do terminal criam worktrees. As consultas do painel privado usam as mesmas duas vagas e retomam em modo de leitura a sessão local concluída que o proprietário autorizou. O APK abre esse mesmo painel. A página pública não tem formulário de envio.

O monitor busca entregas no relay quando o pareamento local e as duas chaves do Worker estão configurados. Cada recibo identifica uma entrega. A interface exibe a fase registrada e sinaliza desatualização após 45 segundos sem contato do executor. O monitor transmite a fase a cada dez segundos enquanto aguarda vaga ou executa a consulta. Mensagens, saída de ferramentas e identificadores locais de sessão ficam fora das atualizações de fase. Para habilitar isso na hospedagem de teste, aplique as migrações da fila, incluindo `0002_instruction_progress.sql`.

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
