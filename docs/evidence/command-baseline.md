# Centro de comando local no Chrome headless

Capturado em 2026-11-28 com o servidor de teste em loopback, relay desligado e base descartável vazia.

- [Desktop, 1440 × 1100](command-desktop.png)
- [Janela estreita, 500 × 950](command-mobile.png)

O Chrome headless usado neste ambiente recorta imagens solicitadas abaixo de 500 px de largura. A captura de janela estreita da central usa 500 px para mostrar a largura inteira. A linha de base histórica de 390 px pode apresentar recorte. Essa evidência é da aplicação web. O APK Android requer validação em dispositivo.

## Recursos

A sondagem sequencial em loopback mediu 130,6 ms para quatro recursos que somam 49.368 bytes, incluindo o HTML do escritório vinculado. Os três arquivos próprios da tela somam 35.918 bytes. A linha de base do escritório mediu outro conjunto de recursos em outro servidor. Os valores não são uma comparação de tempo para interação, FPS ou consumo de CPU e RAM.

[Dados por requisição](command-baseline-metrics.json) · [Linha de base do escritório](baseline.md)
