# PROJETO ALL

Um escritório isométrico para acompanhar o Codex. Os primeiros andares são sisc, sisc-test e projeto-all. Cada avatar corresponde a uma sessão observada. A mesa central é reservada à coordenação do Codex. Clique em um agente para ver a atividade e as respostas registradas em Conversas.

## Executar localmente

Com Node.js 20 ou posterior, execute **node server.mjs** nesta pasta e abra [o painel local](http://127.0.0.1:4173). Mantenha o servidor aberto durante o trabalho.

O monitor acompanha os registros de sessões do Codex atualizados nos últimos sete dias, incluindo sessões novas, retomadas e subagentes. Ele usa a pasta padrão do Codex ou a indicada por CODEX_HOME. PROJETO_ALL_CODEX_HOME seleciona outra pasta de registros. Em repositórios, o monitor agrupa sessões pela raiz da cópia de trabalho, indica a branch e conta arquivos alterados. Eventos de arquivos indicam mudanças no diretório e podem vir de outras ferramentas ou edições manuais.

Para o Codex Cloud, o monitor usa a listagem de tarefas que o CLI autenticado disponibiliza. O andamento de uma tarefa de nuvem vem do resumo do CLI. As ferramentas e os subagentes internos dessa tarefa aparecem somente quando seus eventos estão disponíveis nos registros locais.

O servidor local escuta apenas em 127.0.0.1. Ele reúne estados de sessão, categorias de atividade, metadados Git e trechos das respostas do agente. Somente a última imagem desses dados, com uma janela de conversas recentes, é sincronizada com a versão privada autenticada. Prompts, raciocínio interno e argumentos de ferramentas ficam fora dessa sincronização. O painel indica quando o monitor deixa de enviar sinais.

## Abrir no navegador

- [Escritório no GitHub Pages](https://fysould-oss.github.io/projeto-all/) para abrir a interface pública, os andares e o catálogo.
- [Escritório privado ao vivo](https://projeto-all-condoconnect.sunnyode3.chatgpt.site) para abrir a mesma interface com a atividade sincronizada. Requer a conta autorizada do ChatGPT.

No Windows, inicie o monitor com node server.mjs. A configuração da sincronização usa a credencial protegida da conta do Windows. Em outros sistemas, o monitor pode receber PROJETO_ALL_SYNC_TOKEN no ambiente do processo. A credencial é de serviço do Site privado e nunca faz parte da publicação do GitHub.

## Andares e equipe fixa

O monitor procura as pastas irmãs definidas em dist/projects.json. Ele usa a raiz Git para reunir as sessões de subpastas no mesmo andar. O painel mostra a branch e as alterações mesmo quando ainda não há sessões registradas para o repositório.

Na instalação local do Codex, os perfis contas, comunidade, integracoes e qualidade têm lugares fixos. A orientação global no AGENTS.md do Codex solicita delegação em cada pedido à sessão principal, aproveitando agentes da conversa quando estiverem disponíveis e criando uma instância do mesmo perfil quando necessário. Novas sessões carregam a orientação e os perfis locais.

## Histórico do CondoConnect

O catálogo mantém os 20 postos históricos em dist/progress.json. Eles registram os papéis de referência e o levantamento de regras de negócio. O escritório ao vivo tem nove cadeiras. Sessões adicionais continuam visíveis na lista.

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

Arte original gerada com ImageGen e salva em dist/office-studio.png. O prompt de produção segue abaixo.

> Illustration-story. Original landscape isometric 2D pixel-art office interior as an interactive web dashboard map, wide 16:9. Professional ordinary real-world design studio, warm neutral wood, cream walls, oak flooring, subdued slate-blue and sage cabinets, large soft daylight windows, natural plants, matte dark teal backdrop. One compact cutaway room with no human figures whatsoever, no characters, no silhouettes, no faces in screens. Each chair is empty. Clear uncluttered walkways. Precisely nine empty desks positioned in a strict screen-space 3x3 layout, each chair clearly visible with room around it for a small HTML avatar to be added later. Top row: two normal desks left and right and a distinguished but modest supervisor desk in the TOP CENTER, slightly larger in a tiny glazed alcove. Middle row: three ordinary roomy modern desks. Bottom row: three ordinary roomy modern desks. Distinguish desk separation through gentle shadow and small furniture, no bright colored rugs, no game-like row coloring. All nine discrete desks point mostly toward the viewer with slight isometric angle, chair behind side of desk where visible, computer at other side, small tasteful object or plant. Crisp visibly pixelated aesthetic, high detail, editorial work illustration, no copied branding, no existing game assets, no watermarks, no lettering, no numbers, no speech bubbles, no UI. Let the room fill the image, with generous safe margin above the upper desks for interactive bubbles.
