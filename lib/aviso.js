/* =====================================================================================
   AVISO — e-mail à equipe de advogados quando o documento não achou o card sozinho
   -------------------------------------------------------------------------------------
   Sai da própria caixa documentos@ (SMTP do mesmo servidor), com os documentos do cliente
   anexados: quem for anexar à mão já tem os arquivos.
   O SMTP da HostGator recusa algumas extensões (".eml" foi recusado em 22/10/2026, com
   "550 ... has disallowed extension"). Se recusar, o aviso sai sem anexos e diz onde estão.
   ===================================================================================== */
"use strict";
const nodemailer = require("nodemailer");

/** cfg = { host, porta, usuario, senha, para: [e-mails da equipe] } */
function criarAviso(cfg) {
  const transporte = nodemailer.createTransport({
    host: cfg.host, port: Number(cfg.porta || 465), secure: Number(cfg.porta || 465) === 465,
    auth: { user: cfg.usuario, pass: cfg.senha },
  });
  return {
    /** anexos: [{ nome, conteudo }] */
    async enviar({ assunto, texto, anexos }) {
      if (!(cfg.para || []).length) throw new Error("EQUIPE_EMAILS não configurado: não há para quem avisar");
      const base = { from: '"Recebimento de documentos" <' + cfg.usuario + ">", to: cfg.para.join(", "), subject: assunto };
      const arquivos = (anexos || []).map((a) => ({ filename: a.nome, content: a.conteudo }));
      // devolve a resposta do servidor (ex.: "250 OK id=..."), que vai para o log como prova da entrega
      try {
        const info = await transporte.sendMail(Object.assign({}, base, { text: texto, attachments: arquivos }));
        return String(info.response || "");
      } catch (e) {
        if (!arquivos.length || !/disallowed|extension|attachment|552|550/i.test(String(e && e.message))) throw e;
        const info = await transporte.sendMail(Object.assign({}, base, {
          text: texto + "\n\n(O servidor de e-mail recusou mandar os anexos junto com este aviso: " + String(e.message).slice(0, 160) + ". Eles estão no e-mail original, na caixa " + cfg.usuario + ".)",
        }));
        return String(info.response || "") + " (sem anexos)";
      }
    },
  };
}

module.exports = { criarAviso };
