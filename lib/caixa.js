/* =====================================================================================
   CAIXA — a caixa recebimentos-docs por IMAP (servidor cPanel da HostGator)
   -------------------------------------------------------------------------------------
   Pastas no servidor: INBOX.Sucedidos e INBOX.Mal-sucedidos (o separador é "."). O servidor
   não tem o comando MOVE; a imapflow move copiando e apagando do INBOX.
   ===================================================================================== */
"use strict";
const { ImapFlow } = require("imapflow");

/** cfg = { host, porta, usuario, senha } */
function criarCaixa(cfg) {
  const cliente = new ImapFlow({
    host: cfg.host, port: Number(cfg.porta || 993), secure: true,
    auth: { user: cfg.usuario, pass: cfg.senha }, logger: false, emitLogs: false,
  });
  let trava = null;

  return {
    async abrir() {
      await cliente.connect();
      trava = await cliente.getMailboxLock("INBOX");
    },
    async fechar() {
      try { if (trava) trava.release(); } catch (e) { /* já liberada */ }
      try { await cliente.logout(); } catch (e) { /* conexão já caiu */ }
    },
    /** Cria as pastas que faltarem e devolve o caminho de cada uma no servidor */
    async garantirPastas(nomes) {
      const lista = await cliente.list();
      const inbox = lista.find((p) => p.specialUse === "\\Inbox" || p.path.toUpperCase() === "INBOX");
      const sep = (inbox && inbox.delimiter) || ".";
      const caminhos = {};
      for (const chave of Object.keys(nomes)) {
        const caminho = "INBOX" + sep + nomes[chave];
        if (!lista.some((p) => p.path.toLowerCase() === caminho.toLowerCase())) await cliente.mailboxCreate(caminho);
        caminhos[chave] = caminho;
      }
      return caminhos;
    },
    /** UIDs do INBOX, do mais antigo para o mais novo */
    async listar(limite) {
      const uids = (await cliente.search({ all: true }, { uid: true })) || [];
      return uids.sort((a, b) => a - b).slice(0, limite || uids.length);
    },
    /** { fonte (Buffer), marcas (Set) } */
    async baixar(uid) {
      const m = await cliente.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
      return { fonte: m.source, marcas: new Set(m.flags || []) };
    },
    async marcar(uid, marca) { await cliente.messageFlagsAdd(String(uid), [marca], { uid: true }); },
    async mover(uid, destino) { await cliente.messageMove(String(uid), destino, { uid: true }); },
  };
}

module.exports = { criarCaixa };
