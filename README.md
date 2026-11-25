# PROJETO ALL

Um escritório isométrico para acompanhar o Codex. Cada projeto observado abre um andar. Clique em um personagem para ver a atividade no balão ou consulte a lista de agentes e o histórico do andar.

## Executar localmente

Com Node.js 20 ou posterior, execute **node server.mjs** nesta pasta e abra [o painel local](http://127.0.0.1:4173). Mantenha o servidor aberto durante o trabalho.

O monitor acompanha os registros de sessões do Codex atualizados nos últimos sete dias, incluindo sessões novas, retomadas e subagentes. Ele usa a pasta padrão do Codex ou a indicada por CODEX_HOME. PROJETO_ALL_CODEX_HOME seleciona outra pasta de registros. Em repositórios, o monitor agrupa sessões pela raiz da cópia de trabalho, indica a branch e conta arquivos alterados. Eventos de arquivos indicam mudanças no diretório e podem vir de outras ferramentas ou edições manuais.

Para o Codex Cloud, o monitor usa a listagem de tarefas que o CLI autenticado disponibiliza. O andamento de uma tarefa de nuvem vem do resumo do CLI. As ferramentas e os subagentes internos dessa tarefa aparecem somente quando seus eventos estão disponíveis nos registros locais.

O servidor escuta apenas em 127.0.0.1. O painel recebe categorias de atividade e metadados resumidos. Prompts, resultados de ferramentas, conteúdo de arquivos e caminhos absolutos ficam fora da resposta da API. Os dados em tempo real ficam neste computador. A versão hospedada publica o escritório, o histórico do CondoConnect e o catálogo.

## Histórico do CondoConnect

O painel mostra 20 postos em cinco equipes fixas de quatro agentes. A escala fica em `dist/progress.json`. Cada agente tem um identificador próprio, o `teamId` da equipe e uma posição `seat` de 0 a 3. A coordenação usa o identificador do posto para registrar a tarefa, o estado e a última atividade reportada. Faça as atualizações em sequência para preservar o registro compartilhado.

| Equipe | Identificadores dos postos |
| --- | --- |
| Produto e coordenação | `coordenacao`, `produto`, `planejamento`, `documentacao` |
| Contas e acesso | `contas`, `cadastro-perfis`, `permissoes`, `administracao-usuarios` |
| Operações do condomínio | `comunidade`, `vinculos-unidades`, `atendimento`, `convivencia` |
| Financeiro e integrações | `integracoes`, `cobrancas`, `assinaturas`, `app-api` |
| Qualidade e publicação | `qualidade`, `testes`, `revisao`, `publicacao` |

~~~sh
node scripts/status.mjs contas em-andamento "Revisar cadastro" "Conferindo a validação de documentos."
node scripts/status.mjs contas disponivel
~~~

O estado `disponivel` sinaliza um posto livre e permite omitir tarefa e atividade. A mudança de estado registra o horário e atualiza o posto informado. O monitor de sessões em tempo real funciona automaticamente, independente desse registro histórico.

O catálogo fica em dist/rules.js e descreve o comportamento observado no commit f7846b3. Cada regra aponta para o código de origem. As propostas aparecem identificadas.

## Arte do escritório

Arte original gerada com ImageGen e salva em dist/office-isometrico.png. O prompt de produção segue abaixo.

> Illustration-story. Create an original, exceptionally clean, richly detailed 2D pixel-art isometric software team office, a cutaway dollhouse view from higher isometric three-quarter angle, for a dashboard with interactive overlays. One wide landscape image edge to edge. Dark solid teal near-black empty backdrop around the building. Three zones on the far side, two zones near the viewer, for a total of EXACTLY FIVE distinct workstation pods. Core spatial layout, viewed in IMAGE coordinates: at upper-left a LIME-colored zone, at upper-center a CYAN-colored zone, at upper-right an AMBER-colored zone, at lower-left a PURPLE-colored zone, and at lower-right a CORAL-colored zone. Each zone contains EXACTLY FOUR clearly visible tiny adult human software workers seated at computers, with unobstructed heads, spaced apart at four individual desks, exactly 20 people total. The five zones are joined by a single continuous slate-green tiled floor, very low dividing partitions or rugs, and an open central corridor. Varied outfits, hair, and skin tones. Dark blue-green lower facade, cream desk surfaces, mellow green backlit screens, sparse houseplants, small warmer lamps, shelves, comfy soft shadows, crisp handcrafted pixel edges. Visually inviting room with deep shadows and miniaturized pixel figurines; overhead camera shows desks, four workers in each zone, floor plus walls. Low walls and furniture that do not hide heads. Stretch the floor across most of the wide image and leave a little safe margin for the border. Inspired by the general visual grammar of isometric pixel office floorplans, with fully invented room layout, characters, and furnishings. No UI, no text, no logos, no speech bubbles, no captions, no game interface, no popups, no icon overlays. Boldly distinct team accent rugs in the five stipulated colors.
