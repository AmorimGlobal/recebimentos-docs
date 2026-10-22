/* =====================================================================================
   BITRIX — achar o card do cliente e anexar os documentos (webhook de entrada, escopo crm)
   ===================================================================================== */
"use strict";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** chamar(metodo, params) -> result, com nova tentativa no limite de chamadas do Bitrix */
function criarChamada(url, fetchImpl) {
  const f = fetchImpl || fetch;
  const base = String(url || "").replace(/\/+$/, "") + "/";
  return async function chamar(metodo, params) {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const resp = await f(base + metodo + ".json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {}) });
      const json = await resp.json().catch(() => ({ error: "HTTP " + resp.status }));
      if (json.error === "QUERY_LIMIT_EXCEEDED") { await espera(1000 * (tentativa + 1)); continue; }
      if (json.error) throw new Error(metodo + ": " + json.error + (json.error_description ? " — " + json.error_description : ""));
      return json.result;
    }
    throw new Error(metodo + ": limite de chamadas do Bitrix excedido");
  };
}

/** op = { chamar, categoria, campoAnexo, portal } */
function criarBitrix(op) {
  const { chamar } = op;
  const categoria = Number(op.categoria);
  let etapas = null;

  return {
    /** STATUS_ID da etapa pelo nome (ex.: "Documentação"), lido do funil */
    async etapaPorNome(nome) {
      if (!etapas) etapas = await chamar("crm.dealcategory.stage.list", { id: categoria });
      const alvo = String(nome || "").trim().toLowerCase();
      const e = (etapas || []).find((s) => String(s.NAME || "").trim().toLowerCase() === alvo);
      return e ? e.STATUS_ID : "";
    },

    /** Negócios abertos do funil cujo contato principal tem este e-mail */
    async negociosDoEmail(email) {
      const achados = await chamar("crm.duplicate.findbycomm", { entity_type: "CONTACT", type: "EMAIL", values: [email] });
      const contatos = (achados && achados.CONTACT) || [];
      if (!contatos.length) return [];
      const lista = await chamar("crm.deal.list", {
        filter: { CATEGORY_ID: categoria, CLOSED: "N", CONTACT_ID: contatos },
        select: ["ID", "TITLE", "STAGE_ID", "CONTACT_ID", "ASSIGNED_BY_ID", "DATE_MODIFY"],
        order: { ID: "DESC" },
      });
      return lista || [];
    },

    /** Nome do campo de anexos na API crm.item.* (o portal devolve ufCrm_1616530159), lido do upperName */
    async chaveDoCampo() {
      if (!this._chave) {
        const f = (await chamar("crm.item.fields", { entityTypeId: 2 })).fields || {};
        this._chave = Object.keys(f).find((k) => String(f[k].upperName || "").toUpperCase() === op.campoAnexo.toUpperCase());
        if (!this._chave) throw new Error("o campo " + op.campoAnexo + " não existe nos negócios");
      }
      return this._chave;
    },

    /** Acrescenta UM arquivo ao campo de anexos sem apagar os que já estão lá. Gravar um campo de
        arquivo múltiplo substitui a lista inteira: os atuais vão de volta como {id} e o novo como
        [nome, base64]. Só o crm.item.update aceita esse formato. O crm.deal.update, com os mesmos
        {id}, APAGA os arquivos que já estavam (medido em card de teste em 22/10/2026).
        Confere depois que nada sumiu e que o número de arquivos subiu. */
    async anexar(negocioId, nome, conteudo) {
      const chave = await this.chaveDoCampo();
      const antes = await this.arquivos(negocioId);
      const valor = antes.map((id) => ({ id })).concat([[nome, Buffer.from(conteudo).toString("base64")]]);
      await chamar("crm.item.update", { entityTypeId: 2, id: Number(negocioId), fields: { [chave]: valor } });
      const depois = await this.arquivos(negocioId);
      const perdidos = antes.filter((id) => depois.indexOf(id) < 0);
      if (perdidos.length) throw new Error("o Bitrix apagou " + perdidos.length + " arquivo(s) que já estavam no card " + negocioId);
      if (depois.length !== antes.length + 1) throw new Error("o arquivo \"" + nome + "\" não apareceu no card " + negocioId);
      return depois.filter((id) => antes.indexOf(id) < 0)[0];
    },

    async arquivos(negocioId) {
      const d = await chamar("crm.deal.get", { id: Number(negocioId) });
      const v = d && d[op.campoAnexo];
      return (Array.isArray(v) ? v : v ? [v] : []).map((f) => Number(f.id)).filter(Boolean);
    },

    async comentar(negocioId, texto) {
      await chamar("crm.timeline.comment.add", { fields: { ENTITY_ID: Number(negocioId), ENTITY_TYPE: "deal", COMMENT: texto } });
    },

    linkDoCard(negocioId) { return "https://" + op.portal + "/crm/deal/details/" + negocioId + "/"; },
  };
}

module.exports = { criarChamada, criarBitrix };
