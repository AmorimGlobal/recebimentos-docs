#!/usr/bin/env node
/* Roda uma passada pela caixa, pela linha de comando, lendo o .env desta pasta.
     node tools/processar.js            simulação: só mostra o que faria (não anexa, não move, não avisa)
     node tools/processar.js --gravar   faz de verdade */
"use strict";
const fs = require("fs");
const path = require("path");
const { lerConfig, faltando } = require("../lib/config.js");
const { criarChamada, criarBitrix } = require("../lib/bitrix.js");
const { criarCaixa } = require("../lib/caixa.js");
const { criarAviso } = require("../lib/aviso.js");
const { processar } = require("../lib/processar.js");

function lerEnv(arquivo) {
  const env = Object.assign({}, process.env);
  if (!fs.existsSync(arquivo)) return env;
  fs.readFileSync(arquivo, "utf8").split(/\r?\n/).forEach((l) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && !l.trim().startsWith("#")) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  });
  return env;
}

(async () => {
  const gravar = process.argv.includes("--gravar");
  const cfg = lerConfig(lerEnv(path.join(__dirname, "..", ".env")));
  const falta = faltando(cfg).filter((v) => gravar || v !== "EQUIPE_EMAILS");
  if (falta.length) { console.error("Falta no .env: " + falta.join(", ")); process.exit(1); }
  const bitrix = criarBitrix(Object.assign({ chamar: criarChamada(cfg.bitrix.url) }, cfg.bitrix));
  const resumo = await processar({
    caixa: criarCaixa(cfg.imap), bitrix, aviso: criarAviso(cfg.smtp), cfg, simular: !gravar, log: (t) => console.log(t),
  });
  console.log("\n" + (gravar ? "GRAVADO" : "SIMULAÇÃO (nada foi feito)") + ": " + resumo.lidos + " e-mail(s) · " + resumo.sucesso + " anexado(s) · " + resumo.falha + " para a equipe · " + resumo.ignorados + " automático(s) · " + resumo.erros.length + " erro(s)" + (resumo.pendentes ? " · " + resumo.pendentes + " ficam para a próxima" : ""));
  resumo.detalhes.forEach((d) => console.log("  - " + d.remetente + " | " + d.assunto + " | " + d.decisao + (d.negocio ? " → card " + d.negocio : "") + (d.motivo ? " | " + d.motivo : "") + " | anexos: " + (d.anexos.join(", ") || "nenhum")));
  resumo.erros.forEach((e) => console.log("  ! e-mail " + e.uid + ": " + e.erro));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
