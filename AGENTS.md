# Acompanhamento

Os andares em tempo real usam os registros locais do Codex e a listagem do Codex Cloud. A API local deve enviar somente os metadados necessários ao painel. Preserve o conteúdo privado de conversas e ferramentas e o isolamento do servidor na interface de loopback.

O escritório tem nove cadeiras, incluindo a mesa da coordenação e as posições fixas da equipe. Desenhe personagens apenas para sessões observadas. O catálogo dist/progress.json preserva nomes, equipes e o histórico do levantamento.

GitHub Pages hospeda os arquivos estáticos. O monitor envia atividade resumida apenas ao Site privado com credencial de serviço. Não inclua snapshots, conversas ou credenciais na publicação do GitHub.

Mantenha o catálogo com referências ao código de origem e indique quais regras são propostas. Evite copiar credenciais, dados de usuários ou conteúdo privado de conversas.

## Coordenação entre conversas pelo GitHub

- Ao iniciar ou retomar trabalho em um repositório, atualize as referências remotas e leia os PRs abertos relevantes, incluindo descrições, comentários recentes, arquivos alterados e checks. Repita a consulta antes de integrar ou publicar. Se o GitHub estiver indisponível, informe isso e verifique as referências Git acessíveis.
- Use uma branch e uma cópia de trabalho separadas para cada tarefa. Use o PR relacionado como ponto de coordenação. Quando houver implementação em paralelo e a tarefa exigir um PR próprio, abra um rascunho cedo e indique objetivo, escopo de arquivos, dependências e validação prevista.
- Com autorização para comentar, use a conversa do PR para enviar atualizações técnicas sobre sobreposição de arquivos, dependências, bloqueios, sequência de integração ou passagem de responsabilidade. Indique a branch, o PR relacionado e a decisão ou ação necessária. Responda na discussão existente. Preserve conversas privadas, credenciais e dados do monitor.
- Ao encontrar sobreposição relevante ou receber uma passagem de responsabilidade, releia a versão mais recente do PR e combine a ordem de trabalho com o responsável. Enquanto isso, avance nas partes independentes. Antes de integrar, valide o resultado combinado contra a base atual.

## Delegação em cada tarefa

- Em cada novo pedido de trabalho no projeto-all, o agente principal deve criar ou reativar ao menos um subagente, quando a ferramenta de delegação estiver disponível. Faça a primeira atribuição no início do trabalho e dê ao subagente uma entrega verificável, mesmo em tarefas curtas. Em uma alteração pequena, delegue uma revisão ou validação independente.
- Para implementação em paralelo, informe ao subagente quais arquivos ou componentes pode editar e como verificar a entrega. Quando ele terminar, aproveite-o em outra tarefa independente que ajude a concluir o pedido. O agente principal revisa os resultados e valida a integração.
- Se a ferramenta estiver indisponível, registre essa limitação na resposta e avance com o trabalho. Os avatares do monitor representam sessões observadas pelos dados disponíveis. Uma sessão sem registro no monitor pode ter contado com subagentes.
