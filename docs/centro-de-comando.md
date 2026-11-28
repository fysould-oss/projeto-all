# Centro de comando local

## Executar

Requer Node.js 20 ou posterior e Git no PATH. Execute `node server.mjs` e abra http://127.0.0.1:4173/command.html. O escritório continua em http://127.0.0.1:4173/.

Cadastre o caminho absoluto de uma pasta, registre um objetivo e crie as tarefas na ordem das dependências. Marque as predecessoras como concluídas antes de iniciar uma tarefa dependente. O operador altera os estados, que persistem entre reinícios.

A seção Git mostra status e diff das alterações rastreadas contra HEAD. A seção Qualidade executa `git diff --check HEAD`. O painel resume sessões observadas, núcleos lógicos e uso de RAM. O histórico lista as últimas 50 operações de cadastro e transição de estado.

## Arquitetura

O painel anterior usa HTML, CSS e JavaScript sem framework. O monitor Node acompanha as sessões locais, a listagem Codex Cloud e Git. O relay envia snapshots ao Worker privado, que usa D1. O APK abre o endereço privado em WebView.

A central usa uma API de loopback. A API valida a origem de operações de escrita e persiste os dados em `~/.projeto-all/command.json`, ou no caminho absoluto configurado em `PROJETO_ALL_COMMAND_DB`. Use uma instância do servidor por arquivo. O armazenamento inclui caminhos e títulos informados pelo operador. A auditoria guarda os tipos de operação e identificadores. Esses dados ficam fora do relay e dos artefatos de publicação.

O fluxo atual é projeto → objetivo → tarefas → dependências → mudanças de estado → histórico. O [PR #10](https://github.com/fysould-oss/projeto-all/pull/10) descreve o transporte pareado e a execução isolada para a próxima etapa. A camada de objetivos ainda requer planejamento automático, agendamento e um contrato de aprovação com o executor. O [TODO](../TODO.md) detalha as próximas entregas.

## Testar e empacotar

```powershell
node --test command/api.test.mjs
node scripts/build-worker.mjs
git diff --check
```

Para um ambiente isolado, configure `PAINEL_PORT`, `PROJETO_ALL_COMMAND_DB` e `PROJETO_ALL_CODEX_HOME` com valores descartáveis e defina `PROJETO_ALL_DISABLE_RELAY=1`. O build existente empacota o Worker privado. A central requer o servidor Node local.
