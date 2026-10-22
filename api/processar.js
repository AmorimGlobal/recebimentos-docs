// Uma passada pela caixa documentos@amorimlawfirm.com. Chamada a cada poucos minutos por um agendador
// externo (o cron da Vercel Hobby só roda uma vez por dia e fica como reserva, em vercel.json).
//
// Variáveis de ambiente na Vercel:
//   EMAIL_SENHA          senha da caixa documentos@amorimlawfirm.com (IMAP e SMTP)
//   BITRIX_WEBHOOK_URL   webhook de entrada com o escopo crm
//   EQUIPE_EMAILS        e-mails da equipe que recebe os casos não encontrados (separados por vírgula)
//   CRON_SECRET          o agendador manda "Authorization: Bearer <CRON_SECRET>"
//   opcionais: CATEGORIA (1), CAMPO_ANEXO (UF_CRM_1616530159),
//              PASTA_SUCESSO (Sucedidos), PASTA_FALHA (Mal-sucedidos), LIMITE_POR_EXECUCAO (20)
//
// ?simular=1 mostra o que seria feito, sem anexar, mover nem avisar.
"use strict";
const { lerConfig, faltando } = require("../lib/config.js");
const { criarChamada, criarBitrix } = require("../lib/bitrix.js");
const { criarCaixa } = require("../lib/caixa.js");
const { criarAviso } = require("../lib/aviso.js");
const { processar } = require("../lib/processar.js");

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(corpo));
}

module.exports = async function handler(req, res, injetado) {
  const inj = injetado || {};
  const env = inj.env || process.env;
  if (!env.CRON_SECRET) return responder(res, 503, { ok: false, erro: "CRON_SECRET não configurado na Vercel" });
  if ((req.headers || {}).authorization !== "Bearer " + env.CRON_SECRET) return responder(res, 401, { ok: false, erro: "não autorizado" });
  const cfg = lerConfig(env);
  const falta = faltando(cfg);
  if (falta.length) return responder(res, 503, { ok: false, erro: "falta configurar na Vercel: " + falta.join(", ") });
  const simular = /[?&]simular=1\b/.test(String(req.url || ""));
  try {
    const bitrix = inj.bitrix || criarBitrix(Object.assign({ chamar: criarChamada(cfg.bitrix.url) }, cfg.bitrix));
    const resumo = await processar({
      caixa: inj.caixa || criarCaixa(cfg.imap), bitrix, aviso: inj.aviso || criarAviso(cfg.smtp), cfg, simular,
      tempoMaxMs: 45 * 1000, log: (t) => console.log(t),
    });
    // a resposta não leva o conteúdo dos e-mails: só contagens e decisões
    return responder(res, 200, Object.assign({ ok: true }, resumo, { detalhes: resumo.detalhes.map((d) => ({ uid: d.uid, decisao: d.decisao, motivo: d.motivo, negocio: d.negocio, anexos: d.anexos.length })) }));
  } catch (e) {
    console.error(e);
    return responder(res, 500, { ok: false, erro: String((e && e.message) || e) });
  }
};
