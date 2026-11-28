# Centro de comando

## 1. Inventário e linha de base

- [x] Registrar capturas e métricas do escritório original em desktop e celular.
- [x] Revisar Android, Worker, monitor, catálogo e PRs #7, #9 e #10. O #10 integra os pilotos de execução em worktree e é a referência para integração futura.

## 2. Primeira entrega local

- [x] Persistir cadastro de projetos, objetivos, tarefas, dependências e eventos de auditoria no computador.
- [x] Conectar dashboard, lista de tarefas, Git de leitura e observabilidade ao servidor local.
- [ ] Preservar escritório, catálogo, APK e publicação existentes.
- [ ] Verificar persistência, dependências, restrições de origem e responsividade.

## 3. Coordenação automatizada

- [ ] Integrar executor pareado após revisão conjunta do #10. Definir contrato entre plano, dependências, fila e recibos.
- [x] Ler os estados reais da fila local do executor do #10 pelo painel, sem expor dados privados de execução.
- [x] Enviar tarefas elegíveis após confirmação à fila configurada do #10 e sincronizar o resultado para revisão.
- [x] Revisar o diff da worktree do agente e vincular a conclusão à versão do conteúdo revisado.
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
- [x] Agendar scripts escolhidos pelo operador para iniciar quando as dependências forem concluídas e houver capacidade.
- [x] Pausar novas execuções por objetivo, retomar a fila e cancelar verificações e tarefas inacabadas do objetivo.
- [ ] Integrar stage, commit, push, PR, checks e deploy com confirmação e recuperação.
- [x] Listar e preparar mudanças por arquivo, retirar mudanças do índice e aprovar o commit da árvore preparada.
- [x] Publicar a branch atual mediante aprovação que vincula o destino e os commits local e remoto.
- [ ] Validar previews, captura visual e observabilidade por projeto.
- [x] Abrir aplicações locais em quadro isolado, com URL por projeto e dimensões ajustáveis.
- [ ] Integrar o controle móvel ao transporte privado autenticado.

## 5. Interface e verificação

- [ ] Implementar Kanban, grafo, agentes, painéis, widgets, temas e presets.
- [x] Visualizar o grafo de dependências do objetivo com estados, prontidão e detalhes navegáveis de cada tarefa.
- [ ] Compartilhar tokens com a interface do WebView e preservar acessibilidade.
- [ ] Validar fluxos reais em desktop, tablet, ultrawide e Android, inclusive perda de conexão e recuperação.
- [x] Registrar bytes e tempos de transfer?ncias HTTP do escrit?rio e da central.
- [ ] Medir carregamento, interação, CPU, RAM, tamanho dos recursos e latência. Documentar instalação e publicação.
