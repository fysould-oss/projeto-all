# Centro de comando: baseline local

Capturado em 2026-11-28 contra `http://127.0.0.1:4187/command.html`, servidor
local isolado com dados vazios. Nenhuma credencial, conversa ou snapshot privado
foi incluído. Chrome headless 158.0.8127.37 foi usado nos mesmos viewports da
linha de base estática.

- [Desktop, 1440×1100](command-desktop.png)
- [Mobile, 390×844](command-mobile.png)

O painel abriu com estado vazio: 0 projetos, 0 objetivos, 0 tarefas em execução
e 0 sessões observadas. A interface indicou servidor local conectado.

## Assets

Os requests abaixo foram medidos sequencialmente pelo mesmo host, separadamente
da medição do `dist` estático. Todos retornaram HTTP 200; os bytes e timings estão
em [command-baseline-metrics.json](command-baseline-metrics.json).
