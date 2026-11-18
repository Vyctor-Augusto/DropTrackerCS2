# Drop Tracker CS2

Painel local para acompanhar o **drop semanal de CS2** em várias contas Steam:
quem já dropou, quem ainda não dropou e quanto falta para o próximo reset.

Roda 100% na sua máquina, sem login na Steam, sem senha, sem API key e sem
dependências (`npm install` não é necessário — só Node 20+).

---

## Como rodar

**Jeito normal — ícone na bandeja, sem janela nenhuma**

Duplo clique no atalho **Drop Tracker CS2** (Área de Trabalho ou Menu Iniciar),
ou rode `iniciar-bandeja.vbs`.

Ele põe o ícone perto do relógio, sobe o servidor escondido e abre o painel em
<http://localhost:5179>. **Nenhuma janela preta aparece.**

Menu do ícone (botão direito):

| Item | O que faz |
| --- | --- |
| Abrir painel | abre <http://localhost:5179> |
| Atualizar inventários | força uma leitura agora mesmo |
| Abrir pasta de dados | abre `data/` no Explorador |
| Reiniciar servidor | derruba e sobe o servidor |
| Sair | encerra a bandeja e o servidor |

O tooltip do ícone mostra o resumo (ex.: `2 contas - 1 falta dropar - 1 dropou`),
atualizado a cada minuto. Duplo clique no ícone também abre o painel.

Para desligar tudo: **botão direito → Sair**, ou duplo clique em `parar-app.bat`.

**Plano B — modo console (para ver os erros na tela)**

```
iniciar.bat
```

ou `npm start`. Deixe a janela aberta: fechá-la desliga o app. Serve para
diagnóstico, porque os logs aparecem ali em vez de ir para `data/tray.log`.

De qualquer jeito, se o app já estiver rodando, abrir de novo só abre o
navegador (não sobe um segundo servidor).

### Atalho e ícone

O atalho **Drop Tracker CS2** fica na **Área de Trabalho** e no **Menu Iniciar**,
aponta para `iniciar-bandeja.vbs` e usa ícone próprio (hexágono âmbar,
`public/drop-tracker.ico`, em 16 a 256 px).

- Recriar os atalhos: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-shortcuts.ps1`
- Redesenhar o ícone: `node tools/make-icon.mjs` (gera o `.ico` e o preview PNG)
- Ver o estado da bandeja e do servidor:
  `powershell -NoProfile -ExecutionPolicy Bypass -File tray\drop-tracker-tray.ps1 -Status`
- Log da bandeja: `data/tray.log`

---

## Como usar

1. Clique em **+ Adicionar conta**.
2. Cole o link do perfil (`https://steamcommunity.com/id/seu_nome` ou
   `https://steamcommunity.com/profiles/7656...`) ou o SteamID64.
3. Repita para cada conta. Pronto.

O app lê o inventário público de CS2 de cada conta e, a cada atualização,
compara com o que já tinha visto. **Item que apareceu depois do reset = drop.**

### Registrar o que dropou (e o valor)

Ao clicar em **✓ Dropou**, abre uma janela para você escolher **quais itens**
caíram naquela semana:

- Por padrão aparecem os itens novos detectados desde o reset (pré-marcados).
- Marque **"Mostrar todos os itens do inventário"** para escolher qualquer item na mão.
- Clique em **Buscar preços na Steam** para preencher o valor em reais (menor
  anúncio do Mercado da Comunidade). O preço é editável — se o item não tiver
  mercado ou você quiser ajustar, é só digitar.
- **Salvar itens** grava o que foi marcado e soma no painel de ganhos.
- **Só marcar como dropou** registra o drop sem detalhar itens/valores.

O painel **Ganhos estimados** mostra os totais da semana, do mês, do ano e geral,
com a lista de itens por semana (link para o mercado e opção de remover item).
Os valores são estimativas do mercado (snapshot no momento da consulta), não uma
venda realizada.

### O inventário precisa estar público

Perfil → **Editar perfil → Privacidade** → *Detalhes do inventário* → **Público**.

Se estiver privado, o card mostra um aviso e você ainda pode marcar na mão e
registrar os itens pelo botão **✓ Dropou**. **✕ Não dropou** limpa os itens
registrados daquela semana; **desfazer** remove a marcação e os itens.

---

## Como a detecção funciona (e seus limites)

Guarda-se o primeiro "avistamento" de cada `assetid` do inventário. Qualquer
`assetid` inédito que apareça dentro da semana de reset conta como drop.

- **Primeira leitura de uma conta é a linha de base.** Tudo que já estava lá é
  ignorado (não dá pra saber quando chegou), então a semana em que a conta foi
  adicionada fica *Indefinido* — use o botão manual.
- Comprou/vendeu no mercado ou recebeu trade na mesma semana? Pode gerar um
  falso positivo. Os ícones dos itens detectados aparecem no card pra você
  conferir; se estiver errado, marque na mão.
- Se a detecção desandar, use **⋯ → Recriar linha de base** para zerar o
  histórico daquela conta.
- O app **não** sabe quanto de XP você tem. Não existe API pública pra isso, e é
  por isso que a ordenação usa "falta dropar" + tempo até o reset.

---

## Reset semanal

Padrão: **terça-feira 00:00 UTC**, configurável em **⚙ Configurações**
(dia, hora e minuto, sempre em UTC — a tela mostra o equivalente no seu fuso).

Se perceber que os itens aparecem algumas horas antes/depois do horário
configurado, ajuste ali: a janela da semana passa a bater com a realidade.

---

## Dados

Tudo fica em `data/state.json`, na pasta do projeto:

- contas, apelidos, avatar, SteamID64
- itens já vistos (assetid + nome + quando apareceu)
- marcações manuais e **itens registrados como drop** por semana (com valor)
- configurações

Os preços consultados no Mercado da Comunidade ficam em cache em
`data/prices.json` (para não repetir consultas à Steam). Esse arquivo pode ser
apagado sem perder os drops já registrados.

**Não existe botão "salvar":** cada alteração (adicionar conta, apelido, nota,
marcar dropou, registrar itens, configurações) é gravada no arquivo na hora, e a
resposta da API só volta depois que o disco foi escrito. Pode fechar o app pelo
**Sair** ou até pela força que o último clique continua lá.

A gravação é atômica (escreve `state.json.tmp` e renomeia), então desligar o PC
no meio não corrompe o arquivo: ou fica a versão anterior, ou a nova.

Apagar `data/state.json` = começar do zero. Para backup, copie `data/state.json`.
Nada disso é enviado pra lugar nenhum (o `data/` está no `.gitignore`).

---

## Atualização automática

Padrão: a cada 3 horas, uma conta por vez com 1,5 s de intervalo (para não
tomar bloqueio da Steam). O intervalo é ajustável de 30 min a 1 dia. O botão
**↻ Atualizar tudo** força na hora.

Se a Steam responder *"limitou as requisições"*, espere alguns minutos — o app
volta a funcionar sozinho na próxima rodada.

---

## Estrutura

```
server/
  index.js    servidor HTTP + API + agendador
  steam.js    perfil e inventário públicos da Steam
  drops.js    detecção do drop, candidatos e histórico
  prices.js   consulta/cache de preços do Mercado da Comunidade (BRL)
  earnings.js totais de ganhos por semana, mês e ano
  week.js     cálculo da semana de reset
  store.js    persistência em JSON (escrita atômica)
public/
  index.html  painel
  app.js      lógica da interface
  styles.css  estilo
  drop-tracker.ico   ícone (atalho + favicon)
  drop-tracker.preview.png  logo do cabeçalho / preview do ícone
tools/
  make-icon.mjs      gera o .ico e o preview PNG
  make-shortcuts.ps1 cria os atalhos na Área de Trabalho e no Menu Iniciar
tray/
  drop-tracker-tray.ps1  ícone da bandeja (sobe/derruba o servidor)
iniciar-bandeja.vbs  atalho sem console: abre a bandeja
iniciar.bat         modo console (diagnóstico)
parar-app.bat       encerra bandeja + servidor
data/         dados locais (criado na primeira execução)
```

### API

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/state` | estado completo (contas, semana, contadores, ganhos) |
| GET | `/api/events` | SSE com aviso de mudanças |
| GET | `/api/earnings` | totais de ganhos (semana, mês, ano) |
| POST | `/api/accounts` | adiciona conta (`{ input, label }`) |
| PATCH | `/api/accounts/:id` | renomeia / anota (`{ label, note }`) |
| DELETE | `/api/accounts/:id` | remove conta |
| POST | `/api/accounts/:id/refresh` | relê o inventário agora |
| POST | `/api/accounts/:id/mark` | marca a semana (`{ state: "dropped" \| "not_dropped" \| null }`) |
| POST | `/api/accounts/:id/candidates` | itens candidatos da semana (`{ week, all }`) |
| POST | `/api/accounts/:id/drops` | salva os itens do drop (`{ week, items }`) |
| DELETE | `/api/accounts/:id/drops/:week/:itemId` | remove um item registrado |
| POST | `/api/accounts/:id/rebaseline` | recria a linha de base |
| POST | `/api/prices` | busca preços no mercado (`{ names }`) |
| POST | `/api/refresh` | atualiza todas |
| PATCH | `/api/settings` | muda a regra de reset e o intervalo |

---

## Aviso

Isto é um painel de leitura. Ele não automatiza login, não joga e não mexe nas
contas — só consulta endpoints públicos da Steam. Várias contas na mesma
máquina é uma área cinzenta dos termos da Valve; manter tudo manual e somente
leitura é a parte segura.
