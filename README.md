# PROJETO ALL

Painel de acompanhamento dos agentes e catálogo de regras de negócio do CondoConnect. O catálogo registra o comportamento observado no commit f7846b3 do projeto original e identifica propostas para a próxima etapa.

## Executar localmente

Com Node.js instalado, execute **node server.mjs** e abra [o painel local](http://127.0.0.1:4173). Use a aba **Agentes** para acompanhar o trabalho e **Regras de negócio** para consultar o catálogo pesquisável.

## Atualizar a equipe

A coordenação registra a tarefa, o estado e a última atividade reportada por cada agente. Os identificadores iniciais são coordenacao, contas, comunidade e integracoes. Faça as atualizações em sequência para preservar o registro compartilhado.

~~~sh
node scripts/status.mjs contas em-andamento "Revisar cadastro" "Conferindo a validação de documentos."
~~~

A versão local lê o registro a cada cinco segundos. A versão hospedada mostra o registro da última publicação. Novas atividades precisam ser registradas e o site republicado para aparecer na versão hospedada.

O catálogo fica em dist/rules.js. Cada regra aponta para o código de origem na revisão analisada.
