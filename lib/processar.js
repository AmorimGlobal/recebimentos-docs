/* =====================================================================================
   PROCESSAR — uma passada pela caixa de entrada
   -------------------------------------------------------------------------------------
   Para cada e-mail do INBOX, do mais antigo para o mais novo:
   - acha o card aberto do Development pelo e-mail do remetente (contato do card);
   - achou: anexa cada documento no campo "Anexo - Documentação cliente", comenta no card e
     move o e-mail para "Sucedidos";
   - não achou (ou sem anexo, ou mais de um card): avisa a equipe por e-mail, com o original
     anexado, e move para "Mal-sucedidos";
   - mensagem automática (cPanel, mailer-daemon...): só move para "Mal-sucedidos".

   Uma passada que cair no meio não repete nada na seguinte: cada documento anexado, o
   comentário e o aviso deixam uma marca (palavra-chave IMAP) no próprio e-mail, e um e-mail
   que deu erro fica no INBOX para a próxima passada.
   ===================================================================================== */
"use strict";
const { simpleParser } = require("mailparser");
const regras = require("./regras.js");

const MARCA = { anexo: (i) => "Anexado-" + (i + 1), comentado: "Comentado", avisado: "Avisado" };

const dataHora = (d) => (d || new Date()).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const kb = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

/** op = { caixa, bitrix, aviso, cfg, simular, tempoMaxMs, log, agora } -> resumo da passada */
async function processar(op) {
  const { caixa, bitrix, cfg } = op;
  const log = op.log || (() => {});
  const inicio = Date.now();
  const tempoMax = op.tempoMaxMs || Infinity;
  const resumo = { simulado: !!op.simular, lidos: 0, sucesso: 0, falha: 0, ignorados: 0, erros: [], detalhes: [], pendentes: 0 };

  await caixa.abrir();
  try {
    const pastas = op.simular ? { sucesso: "(simulação)", falha: "(simulação)" } : await caixa.garantirPastas(cfg.pastas);
    const uids = await caixa.listar();
    const fila = uids.slice(0, cfg.limite || uids.length);
    resumo.pendentes = uids.length - fila.length;
    for (const uid of fila) {
      if (Date.now() - inicio > tempoMax) { resumo.pendentes += fila.length - resumo.lidos; break; }
      resumo.lidos++;
      try {
        const r = await processarUm(uid, Object.assign({}, op, { pastas, log }));
        resumo.detalhes.push(r);
        resumo[r.decisao === "sucesso" ? "sucesso" : r.decisao === "ignorar" ? "ignorados" : "falha"]++;
      } catch (e) {
        // fica no INBOX: a próxima passada tenta de novo, sem repetir o que já foi feito
        resumo.erros.push({ uid, erro: String((e && e.message) || e) });
        log("erro no e-mail " + uid + ": " + ((e && e.message) || e));
      }
    }
  } finally {
    await caixa.fechar();
  }
  return resumo;
}

async function processarUm(uid, op) {
  const { caixa, bitrix, aviso, cfg, pastas } = op;
  const { fonte, marcas } = await caixa.baixar(uid);
  const msg = await simpleParser(fonte);
  const de = (msg.from && msg.from.value && msg.from.value[0]) || {};
  const remetente = regras.normalizarEmail(de.address);
  const recebido = msg.date || op.agora || new Date();
  const anexos = regras.anexosValidos(msg.attachments).map((a, i) => ({ nome: regras.nomeDoArquivo(a, i, recebido.toISOString()), conteudo: a.content, tamanho: a.size || a.content.length }));
  const sistema = regras.ehSistema(remetente, cfg.imap.usuario);
  const candidatos = sistema ? [] : await bitrix.negociosDoEmail(remetente);
  const d = regras.decidir({ remetente, anexos, candidatos, proprioEmail: cfg.imap.usuario });
  const registro = {
    uid, remetente, assunto: msg.subject || "", recebido: recebido.toISOString(), anexos: anexos.map((a) => a.nome),
    decisao: d.tipo, motivo: d.motivo || d.criterio || "", negocio: d.negocio ? d.negocio.ID : "", candidatos: (d.candidatos || candidatos).map((c) => c.ID),
  };
  op.log("e-mail " + uid + " de " + (remetente || "?") + ": " + d.tipo + (d.negocio ? " → card " + d.negocio.ID : "") + (d.motivo ? " (" + d.motivo + ")" : ""));
  if (op.simular) return registro;

  if (d.tipo === "sucesso") {
    const id = d.negocio.ID;
    for (let i = 0; i < anexos.length; i++) {
      if (marcas.has(MARCA.anexo(i))) continue; // já foi numa passada anterior
      await bitrix.anexar(id, anexos[i].nome, anexos[i].conteudo);
      await caixa.marcar(uid, MARCA.anexo(i));
    }
    if (!marcas.has(MARCA.comentado)) {
      try {
        await bitrix.comentar(id, "Documentos recebidos por e-mail em " + dataHora(recebido) + ", anexados em \"Anexo - Documentação cliente\".\n" +
          "De: " + (de.name ? de.name + " <" + remetente + ">" : remetente) + "\nAssunto: " + (msg.subject || "(sem assunto)") + "\nArquivos: " + anexos.map((a) => a.nome).join(", ") +
          ((d.outros || []).length ? "\nEste e-mail também está em outros cards abertos do Development (este foi escolhido por ter a movimentação mais recente): " + d.outros.map((c) => bitrix.linkDoCard(c.ID)).join(" , ") : ""));
        await caixa.marcar(uid, MARCA.comentado);
      } catch (e) { op.log("comentário no card " + id + " não foi gravado: " + e.message); }
    }
    await caixa.mover(uid, pastas.sucesso);
    return registro;
  }

  if (d.tipo === "falha" && !marcas.has(MARCA.avisado)) {
    const linhasCards = (d.candidatos || []).map((c) => "- " + (c.TITLE || "Card " + c.ID) + ": " + bitrix.linkDoCard(c.ID));
    const texto = [
      "Um e-mail chegou em " + cfg.imap.usuario + " e não foi anexado automaticamente a nenhum card do Development.",
      "",
      "Motivo: " + regras.MOTIVOS[d.motivo],
      "De: " + (de.name ? de.name + " <" + remetente + ">" : remetente || "(sem remetente)"),
      "Assunto: " + (msg.subject || "(sem assunto)"),
      "Recebido em: " + dataHora(recebido),
      "Anexos: " + (anexos.length ? anexos.map((a) => a.nome + " (" + kb(a.tamanho) + ")").join(", ") : "nenhum"),
    ].concat(linhasCards.length ? ["", "Cards abertos com este e-mail:"].concat(linhasCards) : []).concat([
      "",
      "O que fazer: anexe os arquivos no campo \"Anexo - Documentação cliente\" do card certo. Se o cliente usou um e-mail que não está no contato dele, vale cadastrar esse e-mail no contato: os próximos envios passam a entrar sozinhos.",
      "O e-mail original vai anexado a esta mensagem e fica na pasta " + cfg.pastas.falha + " da caixa " + cfg.imap.usuario + ".",
    ]).join("\n");
    const assuntos = { "sem-anexo": "E-mail sem anexo", "nao-encontrado": "Card não encontrado" };
    await aviso.enviar({ assunto: "[Documentos] " + assuntos[d.motivo] + ": " + (remetente || "remetente desconhecido"), texto, original: fonte });
    await caixa.marcar(uid, MARCA.avisado);
  }
  await caixa.mover(uid, pastas.falha);
  return registro;
}

module.exports = { processar, MARCA };
