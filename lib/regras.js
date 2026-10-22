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

/** Decide o destino de um e-mail.
    candidatos: negócios ABERTOS do Development cujo contato tem o e-mail do remetente.
    etapaPreferida: STATUS_ID da etapa "Documentação", que desempata quando há mais de um card.
    -> { tipo: "sucesso", negocio } | { tipo: "falha", motivo, candidatos } | { tipo: "ignorar", motivo } */
function decidir(op) {
  const remetente = normalizarEmail(op.remetente);
  if (ehSistema(remetente, op.proprioEmail)) return { tipo: "ignorar", motivo: "mensagem automática (" + (remetente || "sem remetente") + ")" };
  const anexos = op.anexos || [];
  if (!anexos.length) return { tipo: "falha", motivo: "sem-anexo", candidatos: op.candidatos || [] };
  const candidatos = op.candidatos || [];
  if (!candidatos.length) return { tipo: "falha", motivo: "nao-encontrado", candidatos };
  if (candidatos.length === 1) return { tipo: "sucesso", negocio: candidatos[0], criterio: "único card aberto com este e-mail" };
  const naEtapa = op.etapaPreferida ? candidatos.filter((d) => d.STAGE_ID === op.etapaPreferida) : [];
  if (naEtapa.length === 1) return { tipo: "sucesso", negocio: naEtapa[0], criterio: "único card na etapa de Documentação entre " + candidatos.length + " com este e-mail" };
  return { tipo: "falha", motivo: "ambiguo", candidatos };
}

const MOTIVOS = {
  "sem-anexo": "O e-mail chegou sem documento anexado.",
  "nao-encontrado": "Nenhum card aberto no Development tem um contato com este e-mail.",
  "ambiguo": "Mais de um card aberto no Development tem um contato com este e-mail, e a etapa de Documentação não desempatou.",
};

module.exports = { normalizarEmail, ehSistema, anexosValidos, nomeDoArquivo, decidir, MOTIVOS, LIMITE_LOGO, LIMITE_ICONE };
