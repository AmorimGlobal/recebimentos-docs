// Uma passada inteira, com e-mails MIME de verdade, uma caixa e um Bitrix em memória.
const test = require("node:test");
const assert = require("node:assert/strict");
const MailComposer = require("nodemailer/lib/mail-composer");
const { processar } = require("../lib/processar.js");
const { lerConfig } = require("../lib/config.js");

const cfg = lerConfig({ EMAIL_SENHA: "x", BITRIX_WEBHOOK_URL: "https://amorimglobal.bitrix24.com.br/rest/1/abc/", EQUIPE_EMAILS: "advogados@amorimlawfirm.com" });

function emailMime({ de, assunto, anexos }) {
  return new MailComposer({
    from: de, to: "recebimentos-docs@amorimlawfirm.com", subject: assunto, text: "Seguem os documentos.",
    date: new Date("2026-10-22T13:00:00Z"),
    attachments: (anexos || []).map((a) => ({ filename: a.nome, content: Buffer.alloc(a.tamanho || 50000, 7), contentType: a.tipo || "application/pdf", cid: a.cid })),
  }).compile().build();
}

function caixaFalsa(emails) {
  const msgs = {};
  let n = 0;
  return {
    msgs,
    async adicionar(e) { msgs[++n] = { fonte: await emailMime(e), marcas: new Set(), pasta: "INBOX" }; },
    async abrir() {}, async fechar() {},
    async garantirPastas(p) { return { sucesso: "INBOX." + p.sucesso, falha: "INBOX." + p.falha }; },
    async listar() { return Object.keys(msgs).map(Number).filter((u) => msgs[u].pasta === "INBOX").sort((a, b) => a - b); },
    async baixar(uid) { return { fonte: msgs[uid].fonte, marcas: new Set(msgs[uid].marcas) }; },
    async marcar(uid, m) { msgs[uid].marcas.add(m); },
    async mover(uid, destino) { msgs[uid].pasta = destino; },
  };
}

function bitrixFalso(porEmail, opcoes) {
  const o = opcoes || {};
  const arquivos = {}, comentarios = [];
  let chamadasAnexar = 0, seq = 900;
  return {
    arquivos, comentarios,
    async etapaPorNome() { return "C1:NEW"; },
    async negociosDoEmail(email) { return porEmail[email] || []; },
    async anexar(id, nome) {
      chamadasAnexar++;
      if (o.falharNaChamada === chamadasAnexar) throw new Error("Bitrix fora do ar");
      (arquivos[id] = arquivos[id] || []).push(nome);
      return ++seq;
    },
    async comentar(id, texto) { comentarios.push({ id, texto }); },
    linkDoCard(id) { return "https://amorimglobal.bitrix24.com.br/crm/deal/details/" + id + "/"; },
  };
}
const avisoFalso = () => { const enviados = []; return { enviados, async enviar(m) { enviados.push(m); } }; };

const CARDS = {
  "ana@gmail.com": [{ ID: "775", TITLE: "Ana Ribeiro · Cidadania", STAGE_ID: "C1:NEW" }],
  "bruno@gmail.com": [{ ID: "801", TITLE: "Bruno · Visto", STAGE_ID: "C1:EXECUTING", MOVED_TIME: "2026-10-01T10:00:00+03:00" }, { ID: "802", TITLE: "Bruno · Cidadania", STAGE_ID: "C1:PREPARATION", MOVED_TIME: "2026-10-15T10:00:00+03:00" }],
};

test("passada completa: anexa, comenta e move; mais de um card vai no mais recente; avisa a equipe com o original; ignora o automático", async () => {
  const caixa = caixaFalsa();
  await caixa.adicionar({ de: "Ana Ribeiro <Ana@Gmail.com>", assunto: "Documentos", anexos: [{ nome: "passaporte.pdf" }, { nome: "logo.png", tipo: "image/png", tamanho: 9000, cid: "logo@x" }, { nome: "rg.jpg", tipo: "image/jpeg", tamanho: 900000 }] });
  await caixa.adicionar({ de: "desconhecido@hotmail.com", assunto: "meus docs", anexos: [{ nome: "certidao.pdf" }] });
  await caixa.adicionar({ de: "bruno@gmail.com", assunto: "docs", anexos: [{ nome: "x.pdf" }] });
  await caixa.adicionar({ de: "cpanel@amorimlawfirm.com", assunto: "Configuração", anexos: [{ nome: "a.mobileconfig", tamanho: 7000 }] });
  const bitrix = bitrixFalso(CARDS), aviso = avisoFalso();
  const r = await processar({ caixa, bitrix, aviso, cfg });
  assert.deepEqual([r.lidos, r.sucesso, r.falha, r.ignorados, r.erros.length], [4, 2, 1, 1, 0]);
  assert.deepEqual(bitrix.arquivos["775"], ["passaporte.pdf", "rg.jpg"]); // o logo da assinatura ficou de fora
  assert.match(bitrix.comentarios[0].texto, /Arquivos: passaporte\.pdf, rg\.jpg/);
  assert.equal(caixa.msgs[1].pasta, "INBOX.Sucedidos");
  assert.equal(caixa.msgs[2].pasta, "INBOX.Mal-sucedidos");
  assert.equal(caixa.msgs[3].pasta, "INBOX.Sucedidos");
  assert.deepEqual(bitrix.arquivos["802"], ["x.pdf"]); // o card do Bruno movimentado por último
  assert.match(bitrix.comentarios.find((c) => c.id === "802").texto, /outros cards abertos[\s\S]*deal\/details\/801\//);
  assert.equal(caixa.msgs[4].pasta, "INBOX.Mal-sucedidos");
  assert.equal(aviso.enviados.length, 1, "o automático do cPanel não gera aviso");
  assert.match(aviso.enviados[0].assunto, /Card não encontrado: desconhecido@hotmail\.com/);
  assert.ok(Buffer.isBuffer(aviso.enviados[0].original), "o e-mail original vai anexado");
});

test("passada que cai no meio: o e-mail fica no INBOX e a próxima não anexa de novo o que já foi", async () => {
  const caixa = caixaFalsa();
  await caixa.adicionar({ de: "ana@gmail.com", assunto: "Docs", anexos: [{ nome: "a.pdf" }, { nome: "b.pdf" }, { nome: "c.pdf" }] });
  const bitrix = bitrixFalso(CARDS, { falharNaChamada: 2 }); // o 2º arquivo falha
  const r1 = await processar({ caixa, bitrix, aviso: avisoFalso(), cfg });
  assert.equal(r1.erros.length, 1);
  assert.equal(caixa.msgs[1].pasta, "INBOX");
  assert.deepEqual(bitrix.arquivos["775"], ["a.pdf"]);
  const r2 = await processar({ caixa, bitrix, aviso: avisoFalso(), cfg });
  assert.equal(r2.sucesso, 1);
  assert.deepEqual(bitrix.arquivos["775"], ["a.pdf", "b.pdf", "c.pdf"], "sem duplicar o a.pdf");
  assert.equal(bitrix.comentarios.length, 1);
  assert.equal(caixa.msgs[1].pasta, "INBOX.Sucedidos");
});

test("simulação não anexa, não move e não avisa", async () => {
  const caixa = caixaFalsa();
  await caixa.adicionar({ de: "ana@gmail.com", assunto: "Docs", anexos: [{ nome: "a.pdf" }] });
  await caixa.adicionar({ de: "x@y.com", assunto: "Docs", anexos: [{ nome: "a.pdf" }] });
  const bitrix = bitrixFalso(CARDS), aviso = avisoFalso();
  const r = await processar({ caixa, bitrix, aviso, cfg, simular: true });
  assert.deepEqual(r.detalhes.map((d) => d.decisao), ["sucesso", "falha"]);
  assert.deepEqual(bitrix.arquivos, {});
  assert.equal(aviso.enviados.length, 0);
  assert.equal(caixa.msgs[1].pasta, "INBOX");
});
