# Carregamento da central em loopback

Em 28 de novembro de 2026, comparei os recursos web das revisões `0ebc4f7` e `6085130`. O Chrome headless abriu os dois conjuntos de arquivos pelo mesmo servidor HTTP de teste em loopback e consumiu a mesma API local, com banco descartável vazio, relay desligado e cache HTTP desativado. Cada largura teve três navegações por revisão. As larguras da tabela são as solicitadas ao Chrome, antes da barra de rolagem.

| Largura | DOM pronto antes → depois | Primeira resposta da API antes → depois | Duração da requisição à API antes → depois |
| --- | ---: | ---: | ---: |
| 390 px | 48,2 → 91,9 ms | 94,0 → 180,5 ms | 42,6 → 49,5 ms |
| 768 px | 71,5 → 47,9 ms | 116,9 → 75,8 ms | 45,5 → 26,3 ms |
| 1440 px | 35,9 → 73,4 ms | 43,7 → 97,2 ms | 8,9 → 14,0 ms |
| 2560 px | 63,7 → 94,4 ms | 129,1 → 163,2 ms | 49,0 → 70,3 ms |

As células mostram medianas. DOM pronto usa `domContentLoadedEventEnd`. A primeira resposta usa `responseEnd` da primeira requisição à API, desde o início da navegação. A duração usa o tempo dessa requisição isolada. A medição usa relógio real. As revisões foram executadas sequencialmente no mesmo processo do Chrome, o que deixa o resultado sujeito à variação do host e ao aquecimento do navegador.

O tempo até a primeira resposta foi maior em três larguras. O comparativo tem três amostras por caso e inclui latência observada no ambiente local. Ele indica onde investigar e não atribui a diferença a um componente específico.

| Recurso | Antes | Depois |
| --- | ---: | ---: |
| HTML | 8.632 B | 21.385 B |
| CSS | 14.798 B | 28.080 B |
| JavaScript | 12.488 B | 104.294 B |
| **Total bruto** | **35.918 B** | **153.759 B** |

O JavaScript responde por 91.806 dos 117.841 bytes adicionados. Os tamanhos acima são dos arquivos sem compressão. A largura útil foi de 375, 753, 1425 e 2545 px. Em todas as navegações, a largura do documento coincidiu com a largura útil, sem rolagem horizontal da página no cenário vazio.

Faltam medições com projetos e históricos preenchidos, latência de interação, atualização de eventos, FPS e consumo de CPU/RAM. O Chrome nem sempre reportou a primeira pintura com conteúdo durante a janela de coleta, então essa métrica ficou fora da tabela.

[Capturas e sondagem HTTP da linha de base](command-baseline.md)
