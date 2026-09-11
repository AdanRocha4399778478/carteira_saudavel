# Handoff: ícones de aplicativo (3 marcas)

## Visão geral

Este pacote contém os **ícones de aplicativo prontos para produção** de três marcas, extraídos dos logotipos originais, e as páginas HTML de referência que documentam cada aplicação (favicon, PWA Android, iOS, chip do cabeçalho).

Marcas incluídas:

| Marca | Símbolo isolado | Pasta |
|---|---|---|
| AgroAlfafa | folhas | `assets/` (raiz) |
| Eixo Real Transportes | escudo + coroa | `assets/eixoreal/` |
| Resultados S/A | brasão (anel concêntrico) | `assets/resultados/` |

## Sobre os arquivos deste pacote

Há dois tipos de arquivo aqui, e eles têm status diferentes:

1. **Os PNGs em `assets/` são entregáveis finais.** Devem ser copiados para o projeto como estão. Não reexportar, não reescalar, não recomprimir, não achatar a transparência — a geometria e o preenchimento de cada arquivo já foram calculados (ver "Preenchimento"). Reescalar quebra a margem de segurança contra o recorte do Android.
2. **Os arquivos `.dc.html` são referências de design**, não código de produção. São protótipos que mostram como cada ícone se comporta em cada contexto. Não copie esse HTML para o app; use-o como especificação visual e recrie no ambiente existente do codebase (React, Vue, SwiftUI, nativo). Se ainda não houver ambiente definido, escolha o framework mais adequado ao projeto.

## Fidelidade

**Alta fidelidade (hifi).** Os PNGs são os arquivos finais. As páginas de referência trazem cores, tipografia e espaçamento definitivos das telas de documentação — mas essas telas são documentação interna, não uma tela do produto; não precisam ser implementadas.

## Como o símbolo foi extraído

Processo idêntico nas três marcas:

1. Detecção do bounding box exato do símbolo na arte original, com limiar sobre o canal de luminância.
2. Remoção do fundo por *flood fill* a partir das bordas da imagem — isso apaga o fundo externo e **preserva as áreas internas fechadas** (p. ex. os pretos internos do brasão da Resultados S/A, que não podem ser confundidos com fundo).
3. Alfa real nas bordas: pixels de transição recebem alfa proporcional, não um corte binário.
4. Recorte no bounding box exato, sem margem e sem perda de nenhuma parte do símbolo (incluindo a base).
5. Nenhuma distorção: a escala é sempre proporcional; o símbolo nunca foi esticado, rotacionado ou redesenhado.
6. Redução por etapas (halving sucessivo) até o tamanho-alvo, para nitidez nos tamanhos pequenos (16 px).

Arquivo-mestre de cada marca: `logo-mark.png`.

| Marca | logo-mark.png | Fundo original |
|---|---|---|
| AgroAlfafa | 700 × 475 px | branco → transparente |
| Eixo Real | 315 × 432 px | branco → transparente |
| Resultados S/A | 479 × 432 px | preto → transparente |

## Preenchimento (regra central)

O símbolo é centralizado em um quadrado e ocupa a fração indicada da **maior dimensão** do quadrado. O restante é margem.

| Ícone | Preenchimento | Motivo |
|---|---|---|
| favicon (aba) | 92% | não sofre recorte |
| pwa-192 / pwa-512 (tela inicial Android) | 78% | o Android recorta em círculo — a 78% as extremidades do símbolo ficam a ~11% da borda, dentro do corte |
| apple-touch-icon (iOS) | 84% | iOS só arredonda os cantos |
| chip no cabeçalho do app | 86% | sem recorte |

## Arquivos por marca

Cada pasta de marca contém:

```
logo-mark.png          símbolo isolado, alfa real, tamanho original
favicon-16.png         16×16   · 92% · transparente
favicon-32.png         32×32   · 92% · transparente
favicon-64.png         64×64   · 92% · transparente
pwa-192.png            192×192 · 78% · fundo opaco
pwa-512.png            512×512 · 78% · fundo opaco
apple-touch-icon.png   180×180 · 84% · fundo opaco
chip-96.png            96×96   · 86% · transparente
chip-192.png           192×192 · 86% · transparente
```

### Cor de fundo dos ícones opacos

PWA e apple-touch-icon exigem fundo opaco (o iOS achata alfa em preto; o Android preenche o *maskable*).

- **AgroAlfafa** e **Eixo Real**: `#FFFFFF`
- **Resultados S/A**: `#000000` — os contornos internos do brasão são pretos; sobre branco a marca perde a leitura original. `theme_color` e `background_color` do manifest devem acompanhar: `#000000`.

## Integração

```html
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#FFFFFF"><!-- Resultados S/A: #000000 -->
```

```json
{
  "background_color": "#FFFFFF",
  "theme_color": "#FFFFFF",
  "icons": [
    { "src": "/assets/pwa-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/assets/pwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Notas de implementação:

- `purpose: "any maskable"` é o que justifica os 78%. Se o time preferir separar, publique o mesmo PNG duas vezes (`any` e `maskable`) em vez de reduzir a margem.
- O `favicon-64.png` cobre telas de alta densidade e a aba do Safari; inclua os três tamanhos.
- O `chip-*.png` é transparente por design: o chip do cabeçalho herda o fundo do app. Use `chip-96` em alturas até ~40 px e `chip-192` acima disso ou em telas 3x.
- Sirva os PNGs com cache longo e hash no nome, se o pipeline do projeto fizer isso; os arquivos são imutáveis.
- Não gerar `.ico`: os navegadores em suporte leem PNG. Se um requisito legado exigir `.ico`, empacote 16/32/64 sem reamostrar.

## Chip do cabeçalho — especificação

O chip é o único componente destas páginas que pode virar UI real. Estrutura implementada nas referências:

- `display: flex; align-items: center; gap: 12px;` · `padding: 14px 16px` · `border-radius: 12px`
- Ícone: `height: 34–36px; width: auto; flex: none` (nunca `width` fixo — preserva a proporção da marca)
- Bloco de texto: nome da empresa + linha secundária monoespaçada em caixa alta, `letter-spacing: 0.12em`, `font-size: 10px`
- AgroAlfafa: fundo `#14301A`, nome em `Spectral`, secundária `#9CC08F`
- Eixo Real: fundo `#16203A`, nome em `Archivo` 700, secundária `#93A6C8`
- Resultados S/A: fundo `#000000`, nome em `Rajdhani` 600 caixa alta `letter-spacing: 0.06em`, secundária `#CCF500`

## Tokens usados nas páginas de referência

| Marca | Fundo | Superfície | Borda | Acento | Texto | Texto secundário |
|---|---|---|---|---|---|---|
| AgroAlfafa | `#F7F8F5` | `#FFFFFF` | `#E4E8DE` | `#2F6B2A` | `#1C2418` | `#46523F` |
| Eixo Real | `#F4F6F9` | `#FFFFFF` | `#E2E7EE` | `#1C3159` | `#16203A` | `#3F4A60` |
| Resultados S/A | `#0A0A0A` | `#131410` | `#242620` | `#CCF500` | `#F2F4EC` | `#A8AD9D` |

Raios: 14 px (cartões), 12 px (chip), 22 px (apple-touch), 24 px (squircle Android), 50% (círculo Android).
Tipografia: `IBM Plex Sans` (corpo), `IBM Plex Mono` (legendas e código), display por marca — `Spectral`, `Archivo`, `Rajdhani`.

## Arquivos deste pacote

```
README.md
support.js                      runtime das páginas de referência
Icones AgroAlfafa.dc.html       página de referência
Icones Resultados SA.dc.html    página de referência
assets/                         AgroAlfafa (raiz) + eixoreal/ + resultados/
```

A página de referência da Eixo Real não está incluída (foi removida do projeto), mas o conjunto completo de ícones em `assets/eixoreal/` está.

## Origem dos assets

Todos os símbolos foram extraídos dos logotipos enviados pelo cliente. Nenhuma parte foi desenhada, vetorizada novamente ou substituída. Se o time precisar de versões vetoriais (SVG), elas devem vir do arquivo original da marca — o material fornecido era raster.
