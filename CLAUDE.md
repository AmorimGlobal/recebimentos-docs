# CLAUDE.md

Guia para o Claude Code (e para quem mantiver) o worker **recebimentos-docs** da Amorim (o repositório manteve o nome; a caixa é **documentos@amorimlawfirm.com** desde 22/10/2026, porque "recebimentos" lembra pagamento).

## O que faz

Clientes da Amorim mandam documentos para **documentos@amorimlawfirm.com**. A cada passada, o worker lê o INBOX e trata cada e-mail, do mais antigo para o mais novo:

- **Achou o card:** o remetente bate com o e-mail do contato de um card aberto do funil **2.Development** (categoria 1). O worker então:
  - anexa os documentos no campo **"Anexo - Documentação cliente"** (`UF_CRM_1616530159`);
  - comenta no card;
  - move o e-mail para **INBOX.Sucedidos**.
- **Não achou:** pode ser nenhum card com o e-mail ou e-mail sem anexo. O worker avisa a equipe por e-mail, com os documentos anexados, e move para **INBOX.mal-sucedidos**. O SMTP da HostGator recusa anexo `.eml` ("disallowed extension"); se recusar algum anexo, o aviso sai sem eles.
- **Mensagem automática** (cPanel, mailer-daemon, no-reply, a própria caixa): só move para Mal-sucedidos, sem aviso.

## Regras que importam

- **Card:** a busca usa `crm.duplicate.findbycomm` (CONTACT, EMAIL), que ignora maiúsculas. Depois pega os negócios abertos da categoria 1 com esse contato principal. Contato secundário de um card não entra.
- **Mais de um card aberto com o mesmo e-mail:** no portal, em 22/10/2026, eram 101 de 1.191 e-mails. Vai no card com a **movimentação mais recente** (`MOVED_TIME`, a última mudança de etapa; sem ela, `DATE_MODIFY`; empate, o maior ID), por decisão do usuário em 22/10/2026. O comentário no card lista os outros cards com o mesmo e-mail.
- **Anexos que contam:**
  - Ficam de fora:
    - imagem embutida no corpo (com Content-ID) abaixo de 100 KB, que é logo de assinatura;
    - qualquer imagem abaixo de 10 KB;
    - `.ics`, `.vcf`, `.p7s` e `.mobileconfig`.
  - Foto de documento enviada pelo celular vem embutida, mas é grande, e entra.
- **Gravar o anexo sem apagar os outros:** o campo é de arquivo múltiplo, e gravar substitui a lista inteira.
  - O único formato que preserva é o `crm.item.update` (entityTypeId 2), com o campo `ufCrm_1616530159`, os arquivos atuais como `{id}` e o novo como `[nome, base64]`.
  - O `crm.deal.update` com os mesmos `{id}` **apaga** o que já estava. Isso foi medido em card de teste.
  - Depois de cada arquivo, `anexar()` confere que nada sumiu.
- **Passada que cai no meio não repete nada:** cada documento anexado, o comentário e o aviso marcam o e-mail com uma palavra-chave IMAP (`Anexado-N`, `Comentado`, `Avisado`). Um e-mail que deu erro fica no INBOX para a próxima passada.
- **Pastas:** o worker usa a pasta que já existe com o nome dela (no servidor, "sucedidos" e "Sucedidos" são pastas diferentes) e só cria se não houver. Se o servidor não mover, vira erro e o e-mail fica no INBOX.
- **Servidor de e-mail:** cPanel da HostGator (`mail.amorimlawfirm.com`, IMAP 993 e SMTP 465), com a mesma conta. O separador de pasta é `.`. O servidor não tem MOVE, e a `imapflow` copia e apaga.

## Estrutura

```
lib/regras.js     puro: remetente de sistema, anexos válidos, nome do arquivo, decisão do card
lib/bitrix.js     webhook: etapa por nome, negócios do e-mail, anexar (com conferência), comentar
lib/caixa.js      IMAP (imapflow): pastas, listar, baixar, marcar, mover
lib/aviso.js      SMTP (nodemailer): aviso à equipe com o .eml original
lib/processar.js  uma passada pela caixa (injeção de dependências: testável sem rede)
lib/config.js     variáveis de ambiente
api/processar.js  função da Vercel, chamada por um agendador externo a cada 5 minutos
tools/processar.js linha de comando: simula por padrão; --gravar faz de verdade
test/             node --test: regras e uma passada completa com e-mails MIME de verdade
```

## Comandos

```
npm test                   # testes
node tools/processar.js    # simulação com a caixa e o Bitrix reais (lê o .env; não grava nada)
node tools/processar.js --gravar
```

## Variáveis (`.env` local e Vercel)

- **Obrigatórias:**
  - `EMAIL_SENHA`
  - `BITRIX_WEBHOOK_URL`: escopo crm
  - `EQUIPE_EMAILS`: separados por vírgula
  - `CRON_SECRET`: só na Vercel
- **Opcionais, com o padrão entre parênteses:**
  - `CATEGORIA` (1)
  - `CAMPO_ANEXO` (UF_CRM_1616530159)
  - `PASTA_SUCESSO` (Sucedidos)
  - `PASTA_FALHA` (Mal-sucedidos)
  - `LIMITE_POR_EXECUCAO` (20)

O `.env` está no `.gitignore` e nunca vai para o repositório.

## Onde roda

- **Bitrix:** não há app instalado. O worker usa um **webhook de entrada** (`BITRIX_WEBHOOK_URL`, escopo crm), e o que ele grava aparece no Bitrix como feito pelo dono do webhook.
- **Servidor:** a função `api/processar.js` na Vercel, em https://recebimentos-docs.vercel.app (projeto do time `amorims-projects-ee19b0fd`).
- **Quem chama a função:**
  1. O **cron do cPanel da HostGator** (Trabalhos Cron), a cada 5 minutos, com `curl -s -m 60 -H "Authorization: Bearer <CRON_SECRET>" https://recebimentos-docs.vercel.app/api/processar`. Testado em 23/10/2026: um e-mail foi processado sozinho em 1,4 minuto.
  2. **Reserva:** o cron da própria Vercel, 1 vez por dia às 12h UTC (9h em Brasília), configurado no `vercel.json`.
- **Tempo da passada:** no máximo 25 segundos (`TEMPO_MAX_SEGUNDOS`). O que não couber fica para a passada seguinte.
- **Agendador parado:** nenhum e-mail se perde. Eles esperam no INBOX.

## Estado (23/10/2026)

- **No ar e testado com e-mails reais:**
  - achou o card: anexou, comentou e moveu, sem duplicar ao rodar de novo;
  - sem anexo: gerou aviso;
  - card não encontrado: gerou aviso com o documento anexado;
  - mensagem automática: só arquivou.
- **Avisos:** chegam em fernando.piccinini@amorimglobal.com (`EQUIPE_EMAILS`, de teste) até a equipe definir quem recebe.
- **Pendente:**
  - os e-mails da equipe;
  - um webhook num usuário técnico (hoje é o do Fernando);
  - trocar a senha da caixa e o `CRON_SECRET`, que passaram pelo chat.
