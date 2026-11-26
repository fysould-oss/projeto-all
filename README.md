# PROJETO ALL

Um escritório isométrico para acompanhar o Codex. Os primeiros andares são sisc, sisc-test e projeto-all. Cada avatar corresponde a uma sessão observada. A mesa central é reservada à coordenação do Codex. Clique em um agente para ver a atividade e as respostas registradas em Conversas.

## Executar localmente

Com Node.js 20 ou posterior, execute **node server.mjs** nesta pasta e abra [o painel local](http://127.0.0.1:4173). Mantenha o servidor aberto durante o trabalho.

O monitor acompanha os registros de sessões do Codex atualizados nos últimos sete dias, incluindo sessões novas, retomadas e subagentes. Ele usa a pasta padrão do Codex ou a indicada por CODEX_HOME. PROJETO_ALL_CODEX_HOME seleciona outra pasta de registros. Em repositórios, o monitor agrupa sessões pela raiz da cópia de trabalho, indica a branch e conta arquivos alterados. Eventos de arquivos indicam mudanças no diretório e podem vir de outras ferramentas ou edições manuais.

Para o Codex Cloud, o monitor usa a listagem de tarefas que o CLI autenticado disponibiliza. O andamento de uma tarefa de nuvem vem do resumo do CLI. As ferramentas e os subagentes internos dessa tarefa aparecem somente quando seus eventos estão disponíveis nos registros locais.

O servidor local escuta apenas em 127.0.0.1. Ele reúne estados de sessão, categorias de atividade, metadados Git e trechos das respostas do agente. Somente a última imagem desses dados, com uma janela de conversas recentes, é sincronizada com a versão privada autenticada. Prompts, raciocínio interno e argumentos de ferramentas ficam fora dessa sincronização. O painel indica quando o monitor deixa de enviar sinais.

## Abrir no navegador

- [Escritório no GitHub Pages](https://fysould-oss.github.io/projeto-all/) para abrir a sala, os andares e o catálogo. **Abrir painel ao vivo** leva à versão privada mantendo o andar selecionado.
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

## Aplicativo Android

O aplicativo Android abre o escritório privado ao vivo, preserva o login no celular e usa a mesma sincronização do painel web. O APK atual é gerado pelo GitHub Actions como artefato de teste:

1. Abra o [build do APK no GitHub Actions](https://github.com/fysould-oss/projeto-all/actions/runs/45751841241).
2. Entre no GitHub, se for solicitado, e abra a seção **Artifacts**.
3. Baixe `projeto-all-debug-apk.zip`, extraia o arquivo e abra `app-debug.apk` no Android.
4. Autorize a instalação de aplicativos desconhecidos quando o sistema solicitar.
5. Abra o aplicativo e entre com a conta autorizada do ChatGPT.

O computador que possui as sessões do Codex deve continuar ligado com `node server.mjs` em execução. O APK é uma build debug para instalação direta e não contém credenciais.

## Arte do escritório

Arte original gerada com ImageGen e salva em dist/office-lobby.png e dist/office-sprites.png. Os prompts de produção seguem abaixo.

> Create a completely original isometric 2D pixel-art virtual office room for a browser dashboard, composition inspired by classic isometric social rooms, without copying any game's assets or room. Landscape 16:9, genuinely angled 2:1 isometric geometry, whole floor as a diagonal diamond, visible short cutaway walls along ONLY the far left and far right, dark midnight-navy solid backdrop, plenty of clear dark breathing room around the whole room. The room is a welcoming shared office, with warm parquet and small beige tile details, caramel wooden desks, muted sage walls and blue-green painted trim, softly lit windows, a couple of plants, bookshelf, comfortable brick-red couch and coffee table in small lounge, water cooler. Original charming 2000s palette-based game pixel craft with deliberate dark outlined edges, hard square pixels, simple chunky furniture, no realistic rendering. Include exactly nine individual computer workstations with chairs clearly visible and empty, grouped organically: one distinct lead desk on the far side near the center, four permanent team desks at ordinary workspaces and four extra desks surrounding the open aisle. Space the workstations widely throughout the scene so interactive speech bubbles and avatars can be overlaid. Do not show any human figures, silhouettes, faces, silhouettes in screens, icons, text, letters, labels, branding, watermarks or bubbles. Focus on a natural lively room composition and unmistakable diagonal isometric view, original architecture and props. No imitation of a specific game asset.

> Asset: original sprite sheet for small isometric office characters in a browser. True transparent background, perfectly regular atlas with EXACTLY 3 COLUMNS and 2 ROWS, 6 tiles edge-to-edge with no frames. In every tile there is just one original visibly 2D pixel-art chibi adult office worker, at the exact center with feet aligned, facing the viewer in slight diagonal three-quarter perspective. Each worker must be fully visible head to toe, with the art occupying about 64% of its tile height and at most 56% width, ample transparent gaps. Top row left to right: supervisor with navy suit and dark wavy hair; accounts specialist with green sweater, glasses, dark complexion and short curly hair; community specialist with blue-and-cream jacket and tanned complexion. Bottom row left to right: integrations specialist with amber hoodie and headphones, quality specialist with plum coat and light-colored short hair, neutral worker with slate-gray outfit and medium complexion. Crisp intentionally chunky 2000s pixel art, dark defined outlines, clean flat small-cluster colors, simple rounded faces, unmistakably handmade and entirely original character designs. All stand in relaxed idle pose with hands down, separate images; no text, no labels, no props, no rooms or floors, no drop shadows, no gridlines, no lettering, no branding, no copies of game sprites. Actual alpha everywhere outside the characters. Landscape atlas.
