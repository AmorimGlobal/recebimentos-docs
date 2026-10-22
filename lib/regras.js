/* =====================================================================================
   REGRAS — quem enviou, quais anexos contam e qual card do Development recebe
   -------------------------------------------------------------------------------------
   Funções puras (sem e-mail e sem Bitrix), testadas em test/regras.test.js.
   ===================================================================================== */
"use strict";

// Mensagens do próprio servidor: não são de cliente e não geram aviso à equipe
const REMETENTE_SISTEMA = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|cpanel|root|abuse|bounce[^@]*)@/i;

// Anexos que não são documento do cliente
const EXTENSOES_FORA = /\.(ics|vcs|vcf|p7s|p7m|mobileconfig|eml)$/i; // convite, cartão de visita, assinatura digital
const TIPOS_FORA = /^(application\/(pkcs7-signature|x-pkcs7-signature)|text\/(calendar|x-vcard|vcard))$/i;
const LIMITE_LOGO = 100 * 1024;  // imagem embutida no corpo (com Content-ID) abaixo disso: logo ou assinatura
const LIMITE_ICONE = 10 * 1024;  // qualquer imagem abaixo disso: ícone

function normalizarEmail(e) { return String(e || "").trim().toLowerCase(); }

function ehSistema(remetente, proprio) {
  const r = normalizarEmail(remetente);
  return !r || REMETENTE_SISTEMA.test(r) || (proprio && r === normalizarEmail(proprio));
}

/** Anexos do mailparser -> só os documentos. Foto de documento enviada pelo celular costuma vir
    embutida (com Content-ID), mas é grande; o que é pequeno e embutido é logo de assinatura. */
function anexosValidos(anexos) {
  return (anexos || []).filter((a) => {
    const tamanho = a.size || (a.content ? a.content.length : 0);
    const imagem = /^image\//i.test(a.contentType || "");
    if (!tamanho) return false;
    if (EXTENSOES_FORA.test(a.filename || "") || TIPOS_FORA.test(a.contentType || "")) return false;
    if (imagem && (a.contentId || a.related) && tamanho < LIMITE_LOGO) return false;
    if (imagem && tamanho < LIMITE_ICONE) return false;
    return true;
  });
}

/** Nome do arquivo no Bitrix: o original, ou um nome com a data quando o e-mail não traz nome */
function nomeDoArquivo(anexo, indice, dataISO) {
  const original = String(anexo.filename || "").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  if (original) return original;
  const ext = (String(anexo.contentType || "").split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  return "documento-" + String(dataISO || "").slice(0, 10) + "-" + (indice + 1) + "." + ext;
}

/** Data da movimentação de um card: a última mudança de etapa (MOVED_TIME) e, sem ela, a última alteração */
const movimento = (d) => String(d.MOVED_TIME || d.DATE_MODIFY || "");

/** Decide o destino de um e-mail.
    candidatos: negócios ABERTOS do Development cujo contato tem o e-mail do remetente.
    Mais de um card: vai no de movimentação mais recente (decisão de 22/10/2026); empate, o de maior ID.
    -> { tipo: "sucesso", negocio, outros } | { tipo: "falha", motivo, candidatos } | { tipo: "ignorar", motivo } */
function decidir(op) {
  const remetente = normalizarEmail(op.remetente);
  if (ehSistema(remetente, op.proprioEmail)) return { tipo: "ignorar", motivo: "mensagem automática (" + (remetente || "sem remetente") + ")" };
  const anexos = op.anexos || [];
  if (!anexos.length) return { tipo: "falha", motivo: "sem-anexo", candidatos: op.candidatos || [] };
  const candidatos = op.candidatos || [];
  if (!candidatos.length) return { tipo: "falha", motivo: "nao-encontrado", candidatos };
  if (candidatos.length === 1) return { tipo: "sucesso", negocio: candidatos[0], outros: [], criterio: "único card aberto com este e-mail" };
  const ordem = candidatos.slice().sort((a, b) => (movimento(b) > movimento(a) ? 1 : movimento(b) < movimento(a) ? -1 : Number(b.ID) - Number(a.ID)));
  return { tipo: "sucesso", negocio: ordem[0], outros: ordem.slice(1), criterio: "movimentação mais recente entre " + candidatos.length + " cards com este e-mail" };
}

const MOTIVOS = {
  "sem-anexo": "O e-mail chegou sem documento anexado.",
  "nao-encontrado": "Nenhum card aberto no Development tem um contato com este e-mail.",
};

module.exports = { normalizarEmail, ehSistema, anexosValidos, nomeDoArquivo, decidir, MOTIVOS, LIMITE_LOGO, LIMITE_ICONE };
