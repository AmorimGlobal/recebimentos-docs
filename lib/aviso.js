/* =====================================================================================
   AVISO — e-mail à equipe de advogados quando o documento não achou o card sozinho
   -------------------------------------------------------------------------------------
   Sai da própria caixa recebimentos-docs (SMTP do mesmo servidor), com o e-mail original
   anexado (.eml): quem for anexar à mão já tem os arquivos.
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
    async enviar({ assunto, texto, original }) {
      if (!(cfg.para || []).length) throw new Error("EQUIPE_EMAILS não configurado: não há para quem avisar");
      await transporte.sendMail({
        from: '"Recebimento de documentos" <' + cfg.usuario + ">",
        to: cfg.para.join(", "),
        subject: assunto,
        text: texto,
        attachments: original ? [{ filename: "email-original.eml", content: original, contentType: "message/rfc822" }] : [],
      });
    },
  };
}

module.exports = { criarAviso };
