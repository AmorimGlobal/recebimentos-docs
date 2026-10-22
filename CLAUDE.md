# CLAUDE.md

Guia para o Claude Code (e para quem mantiver) o worker **recebimentos-docs** da Amorim.

## O que faz

Clientes da Amorim mandam documentos para **recebimentos-docs@amorimlawfirm.com**. A cada passada, o worker lê o INBOX e trata cada e-mail, do mais antigo para o mais novo:

- **Achou o card:** o remetente bate com o e-mail do contato de um card aberto do funil **2.Development** (categoria 1). O worker então:
  - anexa os documentos no campo **"Anexo - Documentação cliente"** (`UF_CRM_1616530159`);
  - comenta no card;
  - move o e-mail para **INBOX.Sucedidos**.
- **Não achou:** pode ser nenhum card, mais de um card, ou e-mail sem anexo. O worker avisa a equipe por e-mail, com o original anexado, e move para **INBOX.Mal-sucedidos**.
- **Mensagem automática** (cPanel, mailer-daemon, no-reply, a própria caixa): só move para Mal-sucedidos, sem aviso.

## Regras que importam

- **Card:** a busca usa `crm.duplicate.findbycomm` (CONTACT, EMAIL), que ignora maiúsculas. Depois pega os negócios abertos da categoria 1 com esse contato principal. Contato secundário de um card não entra.
- **Mais de um card aberto com o mesmo e-mail:** no portal, em 22/10/2026, eram 101 de 1.191 e-mails. O desempate é a etapa **Documentação** (`C1:NEW`). Se ainda sobrar mais de um, o caso vai para a equipe.
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
  - `ETAPA_PREFERIDA` (Documentação)
  - `PASTA_SUCESSO` (Sucedidos)
  - `PASTA_FALHA` (Mal-sucedidos)
  - `LIMITE_POR_EXECUCAO` (20)

O `.env` está no `.gitignore` e nunca vai para o repositório.

## Estado (22/10/2026)

- **Testado contra o real:**
  - login IMAP e SMTP;
  - busca do card (8 de 8);
  - anexo sem apagar, com comentário, em cards de teste do funil "Testes - Inovações" apagados depois;
  - simulação na caixa.
- **Ainda não está publicado.** Falta:
  - o repositório no GitHub;
  - o projeto na Vercel, com as variáveis;
  - o agendador externo;
  - os e-mails da equipe (`EQUIPE_EMAILS`).
