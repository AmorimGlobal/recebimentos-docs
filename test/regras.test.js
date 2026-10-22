const test = require("node:test");
const assert = require("node:assert/strict");
const r = require("../lib/regras.js");

const deal = (ID, STAGE_ID) => ({ ID, STAGE_ID, TITLE: "Card " + ID });

test("anexos: documentos passam; logo de assinatura, ícone, convite e assinatura digital ficam de fora", () => {
  const a = (filename, contentType, size, extra) => Object.assign({ filename, contentType, size, content: Buffer.alloc(size) }, extra || {});
  const validos = r.anexosValidos([
    a("passaporte.pdf", "application/pdf", 300000),
    a("rg-frente.jpg", "image/jpeg", 1800000, { contentId: "<foto@celular>" }), // foto do celular, embutida mas grande
    a("image001.png", "image/png", 18000, { contentId: "<logo>" }),           // logo da assinatura
    a("icone.png", "image/png", 3000),
    a("invite.ics", "text/calendar", 2000),
    a("smime.p7s", "application/pkcs7-signature", 4000),
    a("config.mobileconfig", "application/octet-stream", 7000),
    a("vazio.pdf", "application/pdf", 0),
  ]);
  assert.deepEqual(validos.map((x) => x.filename), ["passaporte.pdf", "rg-frente.jpg"]);
});

test("nome do arquivo: o original sem caracteres proibidos, ou um nome com a data", () => {
  assert.equal(r.nomeDoArquivo({ filename: "certidão: casamento?.pdf" }, 0, "2026-10-22T10:00:00Z"), "certidão_ casamento_.pdf");
  assert.equal(r.nomeDoArquivo({ contentType: "image/jpeg" }, 1, "2026-10-22T10:00:00Z"), "documento-2026-10-22-2.jpeg");
});

test("decisão: um card só, ou o único na etapa de Documentação; senão, para a equipe", () => {
  const anexos = [{ nome: "a.pdf" }];
  assert.equal(r.decidir({ remetente: "Cliente@Gmail.com", anexos, candidatos: [deal("10", "C1:NEW")] }).negocio.ID, "10");
  const dois = [deal("10", "C1:EXECUTING"), deal("11", "C1:NEW")];
  const d = r.decidir({ remetente: "c@x.com", anexos, candidatos: dois, etapaPreferida: "C1:NEW" });
  assert.equal(d.tipo, "sucesso");
  assert.equal(d.negocio.ID, "11");
  assert.deepEqual(r.decidir({ remetente: "c@x.com", anexos, candidatos: dois, etapaPreferida: "C1:PREPARATION" }).motivo, "ambiguo");
  assert.deepEqual(r.decidir({ remetente: "c@x.com", anexos, candidatos: [] }).motivo, "nao-encontrado");
  assert.deepEqual(r.decidir({ remetente: "c@x.com", anexos: [], candidatos: [deal("10")] }).motivo, "sem-anexo");
});

test("mensagens automáticas e da própria caixa são ignoradas, sem aviso", () => {
  for (const de of ["cpanel@amorimlawfirm.com", "MAILER-DAEMON@x.com", "no-reply@banco.com", "recebimentos-docs@amorimlawfirm.com", ""]) {
    assert.equal(r.decidir({ remetente: de, anexos: [{ nome: "a" }], candidatos: [], proprioEmail: "recebimentos-docs@amorimlawfirm.com" }).tipo, "ignorar", de);
  }
});
