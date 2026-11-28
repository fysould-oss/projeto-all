# Centro de comando local

## Executar

Requer Node.js 20 ou posterior e Git no PATH. Execute `node server.mjs` e abra http://127.0.0.1:4173/command.html. O escritório continua em http://127.0.0.1:4173/.

Cadastre o caminho absoluto de uma pasta, registre um objetivo e crie as tarefas na ordem das dependências. Marque as predecessoras como concluídas antes de iniciar uma tarefa dependente. O operador altera os estados, que persistem entre reinícios.

Para gerar um rascunho, escreva as ações no objetivo e separe etapas explícitas com ponto e vírgula ou linhas. A central sugere dependências entre análise, implementação, qualidade e entrega. A revisão mostra os papéis e perfis de modelo sugeridos pelas regras locais. Registre as tarefas após conferir o rascunho. A geração e a aprovação do plano não iniciam agentes nem comandos.

Na seção Grafo, selecione um objetivo para ver os níveis de dependência. Selecione uma tarefa para consultar estado, dependências pendentes e o atalho para a lista. Uma tarefa pendente aparece como pronta quando suas dependências estiverem concluídas. Dependências de outros objetivos aparecem como contexto.

A seção Git mostra status e diff das alterações rastreadas contra HEAD. A seção Qualidade executa `git diff --check HEAD`. O painel resume sessões observadas, núcleos lógicos e uso de RAM. O histórico lista as últimas 50 operações de cadastro e transição de estado.

Em Git, selecione um projeto e consulte os arquivos alterados. Use **Preparar** ou **Retirar do índice** na linha do arquivo. Essas operações atuam no índice e preservam a cópia de trabalho. **Ver diff preparado** mostra o conteúdo atual do índice antes de solicitar o commit.

Para criar um commit, prepare os arquivos e solicite um commit na seção Git. Informe mensagem e motivo. A solicitação registra a branch, o commit base, a árvore preparada e os arquivos afetados. Abra o diff da solicitação para revisar o conteúdo. Você pode aprovar, rejeitar ou editar a solicitação. Uma edição atualiza o escopo preparado para nova revisão. Cada versão expira após 15 minutos. Se o estado Git divergir, a execução falha e a central exige outra revisão. O commit preserva as alterações fora do índice. Para desfazê-lo mantendo o histórico, revise um `git revert <commit>` no repositório.

As decisões e o resultado persistem no computador. O histórico de auditoria guarda tipos de evento e identificadores. Mensagens, motivos e caminhos ficam no registro local da solicitação. Se o servidor parar durante a execução, confira o histórico Git antes de criar outra solicitação.

A central cria o commit diretamente a partir da árvore aprovada, sem executar hooks Git. O fluxo exige uma branch local com commit inicial e recusa operações em andamento e repositórios com assinatura configurada.

Para publicar uma branch, selecione um remoto já configurado e solicite **Push** na seção Git. Confira o destino, a branch e os hashes local e remoto na aprovação. O executor aceita a criação da branch ou seu avanço fast-forward até o commit revisado. Se o destino, a branch ou um dos hashes mudar, solicite nova revisão. A operação publica a branch local com o mesmo nome no remoto e preserva o índice e a cópia de trabalho. Use um único destino HTTPS, SSH ou local. Configure a autenticação previamente no Git. O executor usa o destino revisado, sem redirecionamentos HTTP nem hook de pre-push.

Em Qualidade, selecione um projeto confiável com `package.json` para executar scripts declarados de lint, teste, build ou verificação de tipos. Os scripts usam as dependências e a configuração desse projeto. A seção mostra o estado, a duração e a saída limitada e permite interromper a execução. O histórico de execuções fica na memória do servidor local durante esta etapa.

Também é possível executar um desses scripts a partir de uma tarefa pendente ou com falha, desde que suas dependências estejam concluídas. Uma execução aprovada conclui a tarefa e libera suas dependentes. Falhas e cancelamentos atualizam o estado da tarefa. O nome do script, seu resultado e sua duração ficam registrados na tarefa e aparecem no grafo. Para acessar a saída ou interromper uma execução em andamento, use a seção Qualidade.

Use **Agendar** para escolher antecipadamente o script de uma tarefa. O servidor guarda a escolha, espera as dependências e inicia a execução quando houver uma vaga. O limite é de duas verificações simultâneas, compartilhado com Qualidade. A fila é retomada ao iniciar o servidor. Use **Limpar agendamento** para remover uma tarefa ainda na fila; execuções interrompidas no reinício ficam registradas como falha, sem nova execução automática.

No Coordenador, **Pausar novas execuções** mantém a fila do objetivo e deixa as verificações já iniciadas terminarem. **Retomar** volta a liberar tarefas elegíveis. **Cancelar objetivo** é definitivo, interrompe suas verificações ativas, remove agendamentos e cancela as tarefas inacabadas. Tarefas concluídas continuam no histórico.

Em Previews, selecione um projeto e salve o endereço de uma aplicação já em execução no mesmo computador do navegador. Use HTTP com `localhost` ou `127.0.0.1` e uma porta entre 1024 e 65535. A central guarda um endereço por projeto e só abre a aplicação quando você inicia o preview. Os controles ajustam as dimensões do quadro para desktop, tablet, celular ou tamanho personalizado. É possível girar, recarregar, programar recarga enquanto a aba está visível e parar. A abertura em nova aba atende aplicações que bloqueiam incorporação por CSP ou X-Frame-Options.

## Arquitetura

O painel anterior usa HTML, CSS e JavaScript sem framework. O monitor Node acompanha as sessões locais, a listagem Codex Cloud e Git. O relay envia snapshots ao Worker privado, que usa D1. O APK abre o endereço privado em WebView.

A central usa uma API de loopback. A API valida a origem de operações de escrita e persiste os dados em `~/.projeto-all/command.json`, ou no caminho absoluto configurado em `PROJETO_ALL_COMMAND_DB`. Use uma instância do servidor por arquivo. O armazenamento inclui caminhos e títulos informados pelo operador. A auditoria guarda os tipos de operação e identificadores. Esses dados ficam fora do relay e dos artefatos de publicação.

O fluxo atual é projeto → objetivo → tarefas → dependências → mudanças de estado → histórico. O [PR #10](https://github.com/fysould-oss/projeto-all/pull/10) descreve o transporte pareado e a execução isolada para a próxima etapa. A camada de objetivos ainda requer planejamento automático, agendamento e um contrato de aprovação com o executor. O [TODO](../TODO.md) detalha as próximas entregas.

## Testar e empacotar

```powershell
node --test --test-concurrency=1 command/*.test.mjs
node scripts/build-worker.mjs
git diff --check
```

Para um ambiente isolado, configure `PAINEL_PORT`, `PROJETO_ALL_COMMAND_DB` e `PROJETO_ALL_CODEX_HOME` com valores descartáveis e defina `PROJETO_ALL_DISABLE_RELAY=1`. O build existente empacota o Worker privado. A central requer o servidor Node local.
