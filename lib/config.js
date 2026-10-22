/* Configuração vinda das variáveis de ambiente (Vercel ou .env local). Nenhuma senha no código. */
"use strict";

const lista = (v) => String(v || "").split(/[,;\s]+/).filter(Boolean);

function lerConfig(env) {
  const e = env || process.env;
  const host = e.EMAIL_HOST || "mail.amorimlawfirm.com";
  const usuario = e.EMAIL_USUARIO || "documentos@amorimlawfirm.com";
  let portal = e.BITRIX_PORTAL || "";
  if (!portal) { try { portal = new URL(e.BITRIX_WEBHOOK_URL).host; } catch (x) { portal = "amorimglobal.bitrix24.com.br"; } }
  return {
    imap: { host, porta: Number(e.IMAP_PORTA || 993), usuario, senha: e.EMAIL_SENHA || "" },
    smtp: { host: e.SMTP_HOST || host, porta: Number(e.SMTP_PORTA || 465), usuario, senha: e.EMAIL_SENHA || "", para: lista(e.EQUIPE_EMAILS) },
    bitrix: { url: e.BITRIX_WEBHOOK_URL || "", categoria: Number(e.CATEGORIA || 1), campoAnexo: e.CAMPO_ANEXO || "UF_CRM_1616530159", portal },
    pastas: { sucesso: e.PASTA_SUCESSO || "Sucedidos", falha: e.PASTA_FALHA || "Mal-sucedidos" },
    limite: Number(e.LIMITE_POR_EXECUCAO || 20),
  };
}

/** O que falta para rodar de verdade (nomes das variáveis, nunca os valores) */
function faltando(cfg) {
  const f = [];
  if (!cfg.imap.senha) f.push("EMAIL_SENHA");
  if (!cfg.bitrix.url) f.push("BITRIX_WEBHOOK_URL");
  if (!cfg.smtp.para.length) f.push("EQUIPE_EMAILS");
  return f;
}

module.exports = { lerConfig, faltando };
