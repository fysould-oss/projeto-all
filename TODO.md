# Centro de comando

## 1. Inventário e linha de base

- [x] Registrar capturas e métricas do escritório original em desktop e celular.
- [x] Revisar Android, Worker, monitor, catálogo e PRs #7, #9 e #10. O #10 integra os pilotos de execução em worktree e é a referência para integração futura.

## 2. Primeira entrega local

- [x] Persistir cadastro de projetos, objetivos, tarefas, dependências e eventos de auditoria no computador.
- [x] Conectar dashboard, lista de tarefas, Git de leitura e observabilidade ao servidor local.
- [x] Exibir CPU e RAM do host, memória residente do servidor e quantidade de verificações ativas.
- [ ] Preservar escritório, catálogo, APK e publicação existentes.
- [ ] Verificar persistência, dependências, restrições de origem e responsividade.

## 3. Coordenação automatizada

- [ ] Integrar executor pareado após revisão conjunta do #10. Definir contrato entre plano, dependências, fila e recibos.
- [x] Ler os estados reais da fila local do executor do #10 pelo painel, sem expor dados privados de execução.
- [x] Enviar tarefas elegíveis após confirmação à fila configurada do #10 e sincronizar o resultado para revisão.
- [x] Revisar o diff da worktree do agente e vincular a conclusão à versão do conteúdo revisado.
- [x] Retirar tarefas Codex pendentes da fila e recusar cancelamento depois que o executor assumir a tarefa.
- [x] Configurar habilitação de envio e limite de trabalhos Codex ativos por projeto.
- [ ] Decompor objetivos com revisão humana, agendar tarefas independentes e registrar progresso, bloqueio, reatribuição e revisão final.
- [x] Gerar e revisar um primeiro rascunho por regras a partir das ações escritas no objetivo e persistir as dependências após aprovação do plano.
- [ ] Definir modelos, políticas por projeto, limites de concorrência e tokens, medição de custo e alertas.
- [ ] Implementar aprovações com escopo, expiração, decisão e confirmação vinculada ao executor.
- [x] Vincular aprovação persistente e versionada ao Git commit local, com revisão do diff preparado, rejeição, expiração e prevenção de escopo desatualizado.

## 4. Ferramentas de desenvolvimento

- [ ] Integrar sessões de terminal, histórico, cancelamento de árvore de processos, testes, builds e logs.
- [x] Executar scripts declarados de lint, testes, build e tipos em projetos Node, com saída limitada, estado, duração e interrupção pela central.
- [x] Vincular a execução de um script de qualidade à tarefa, às suas dependências e ao resultado persistido no grafo.
- [x] Preservar metadados recentes das verificações, com consulta após reinício e saída mantida em memória.
- [x] Notificar localmente solicitações de aprovação e resultados de verificações e agentes, com estado de leitura persistente.
- [x] Pesquisar e filtrar o histórico de auditoria completo com paginação e atalhos de contexto.
- [x] Agendar scripts escolhidos pelo operador para iniciar quando as dependências forem concluídas e houver capacidade.
- [x] Pausar novas execuções por objetivo, retomar a fila e cancelar verificações e tarefas inacabadas do objetivo.
- [ ] Integrar stage, commit, push, PR, checks e deploy com confirmação e recuperação.
- [x] Listar e preparar mudanças por arquivo, retirar mudanças do índice e aprovar o commit da árvore preparada.
- [x] Publicar a branch atual mediante aprovação que vincula o destino e os commits local e remoto.
- [x] Consultar PRs abertos da branch ativa em remotos GitHub públicos, com link para a busca autenticada no navegador.
- [x] Exibir o resumo de check runs públicos do commit de cada PR e o link para os detalhes no GitHub.
- [x] Mostrar também o status combinado e os contextos públicos de CI externo para o mesmo commit.
- [x] Resumir revisões públicas de PR por commit, incluindo pedidos de alterações e decisões anteriores.
- [x] Listar execuções públicas do GitHub Actions para o commit e abrir o diff hospedado do PR.
- [x] Consultar branches locais, branch ativa, HEAD destacado e relação com o upstream conhecido localmente.
- [ ] Validar previews, captura visual e observabilidade por projeto.
- [x] Abrir aplicações locais em quadro isolado, com URL por projeto e dimensões ajustáveis.
- [ ] Integrar o controle móvel ao transporte privado autenticado.

## 5. Interface e verificação

- [ ] Implementar Kanban, grafo, agentes, painéis, widgets, temas e presets.
- [x] Persistir tema, densidade e tamanho do texto, com exportação, importação e restauração dos padrões.
- [x] Salvar visualizações nomeadas e alternar entre presets no navegador.
- [x] Recolher a barra lateral do desktop preservando os atalhos, com largura configurável e persistente.
- [x] Buscar projetos, objetivos e tarefas pela barra superior ou pelo atalho de teclado.
- [x] Abrir seções e solicitar atualização dos dados locais pela paleta de comandos.
- [x] Exibir, ocultar, redimensionar e reordenar os indicadores do resumo operacional, com persistência local.
- [x] Visualizar o grafo de dependências do objetivo com estados, prontidão e detalhes navegáveis de cada tarefa.
- [ ] Compartilhar tokens com a interface do WebView e preservar acessibilidade.
- [ ] Validar fluxos reais em desktop, tablet, ultrawide e Android, inclusive perda de conexão e recuperação.
- [x] Registrar bytes e tempos de transfer?ncias HTTP do escrit?rio e da central.
- [ ] Medir carregamento, interação, CPU, RAM, tamanho dos recursos e latência. Documentar instalação e publicação.
