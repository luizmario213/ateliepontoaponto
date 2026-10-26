/* =====================================================================
   Ateliê Ponto a Ponto — sistema de gestão
   Front-end estático + Supabase (login, banco e regras de segurança).
   ===================================================================== */
"use strict";
/* lido antes de tudo: o Supabase limpa o endereço depois de processar o link */
let recuperandoSenha = /type=recovery/.test(location.hash);

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r2 = v => Math.round((+v || 0) * 100) / 100;
const brl = v => (r2(v)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = v => isFinite(v) ? (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—";
const num2 = v => (r2(v)).toFixed(2).replace(".", ",");
/* aceita "20", "20,5", "1.234,56", "R$ 20,00", "20.5" */
function lerValor(s) {
  s = String(s ?? "").replace(/R\$|\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? r2(n) : NaN;
}
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() :
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoje = () => window.__HOJE__ || isoLocal(new Date());
const fmtD = d => { if (!d) return "—"; const [, m, dd] = d.split("-"); return `${dd}/${m}`; };
const fmtDC = d => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
const mesDe = d => (d || "").slice(0, 7);
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = ym => { const [y, m] = ym.split("-"); return MESES[+m - 1] + " de " + y; };
const prevMes = ym => { let [y, m] = ym.split("-").map(Number); m--; if (!m) { m = 12; y--; } return y + "-" + String(m).padStart(2, "0"); };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
};
function toast(msg, ms) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms || 2600);
}
const FORMAS = ["Pix", "Dinheiro", "Débito", "Crédito", "Outro"];
const optFormas = sel => FORMAS.map(f => `<option ${f === sel ? "selected" : ""}>${f}</option>`).join("");

/* ---------- mensagens de erro em português ---------- */
function traduzErro(e) {
  if (!e) return new Error("Erro desconhecido.");
  if (e instanceof Error && e.amigavel) return e;
  const msg = String(e.message || e.error_description || e || "");
  const code = e.code || "";
  let txt;
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ERR_INTERNET|network/i.test(msg))
    txt = "Sem conexão com o servidor. Nada foi salvo. Confira a internet e tente de novo.";
  else if (/Invalid login credentials/i.test(msg)) txt = "E-mail ou senha incorretos.";
  else if (/Email not confirmed/i.test(msg)) txt = "Este e-mail ainda não foi confirmado.";
  else if (/rate limit|too many/i.test(msg)) txt = "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  else if (/Password should be|password.*characters|weak/i.test(msg)) txt = "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.";
  else if (/New password should be different/i.test(msg)) txt = "A nova senha precisa ser diferente da atual.";
  else if (/JWT|token.*expired|not authenticated|session/i.test(msg)) txt = "Sua sessão expirou. Entre de novo.";
  else if (code === "23503") txt = "Não dá para excluir: existem registros ligados a este (por exemplo, cliente com pedidos).";
  else if (code === "23505") txt = "Já existe um registro com esse nome.";
  else if (code === "42501" || /row-level security|permission denied|Sem permissão/i.test(msg)) txt = "Você não tem permissão para fazer isso.";
  else if (code === "P0001" || code === "") txt = msg || "Algo deu errado.";
  else txt = "Algo deu errado: " + msg;
  const err = new Error(txt); err.amigavel = true; err.original = e;
  return err;
}

/* =====================================================================
   CAMADA DE DADOS (Supabase)
   ===================================================================== */
const CFG = window.ATELIE_CONFIG || {};
const configurado = !!(CFG.supabaseUrl && CFG.supabaseKey && !/COLE_AQUI/.test(CFG.supabaseUrl + CFG.supabaseKey));

function criarApiSupabase() {
  const sb = window.supabase.createClient(CFG.supabaseUrl.trim(), CFG.supabaseKey.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "pap-auth" }
  });
  const ok = ({ data, error }) => { if (error) throw traduzErro(error); return data; };
  const tenta = async fn => { try { return await fn(); } catch (e) { throw traduzErro(e); } };
  async function todos(tabela, ordem) {
    const out = [];
    for (let de = 0; ; de += 1000) {
      const d = ok(await sb.from(tabela).select("*").order(ordem).range(de, de + 999));
      out.push(...d);
      if (d.length < 1000) break;
    }
    return out;
  }
  return {
    async sessao() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth(fn) { sb.auth.onAuthStateChange((ev, s) => setTimeout(() => fn(ev, s), 0)); },
    entrar: (email, senha) => tenta(async () => ok(await sb.auth.signInWithPassword({ email, password: senha }))),
    sair: () => tenta(async () => { await sb.auth.signOut(); }),
    esqueci: email => tenta(async () => ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }))),
    novaSenha: senha => tenta(async () => ok(await sb.auth.updateUser({ password: senha }))),
    meuPerfil: uid => tenta(async () => ok(await sb.from("perfis").select("*").eq("id", uid).maybeSingle())),
    carregar: () => tenta(async () => {
      const [servicos, clientes, pedidos, pedido_itens, pagamentos, despesas, investimentos, categorias_despesa, config] = await Promise.all([
        todos("servicos", "nome"), todos("clientes", "nome"), todos("pedidos", "numero"), todos("pedido_itens", "id"),
        todos("pagamentos", "pago_em"), todos("despesas", "data"), todos("investimentos", "data"),
        todos("categorias_despesa", "ordem"), todos("config", "chave")]);
      return { servicos, clientes, pedidos, pedido_itens, pagamentos, despesas, investimentos, categorias_despesa, config };
    }),
    inserir: (t, row) => tenta(async () => ok(await sb.from(t).insert(row).select().single())),
    atualizar: (t, id, campos, col = "id") => tenta(async () => ok(await sb.from(t).update(campos).eq(col, id).select().single())),
    excluir: (t, id, col = "id") => tenta(async () => {
      const d = ok(await sb.from(t).delete().eq(col, id).select());
      if (!d.length) throw traduzErro({ message: "Nada foi excluído (sem permissão ou já tinha sido removido)." });
    }),
    salvarConfig: (chave, valor) => tenta(async () => ok(await sb.from("config").upsert({ chave, valor }).select().single())),
    salvarPedido: p => tenta(async () => ok(await sb.rpc("salvar_pedido", { p }))),
    receber: a => tenta(async () => ok(await sb.rpc("receber_pagamento", a))),
    importar: b => tenta(async () => ok(await sb.rpc("importar_backup", { b }))),
    perfis: () => tenta(async () => ok(await sb.from("perfis").select("*").order("criado_em"))),
    auditoria: () => tenta(async () => ok(await sb.from("auditoria").select("*").order("quando", { ascending: false }).limit(150)))
  };
}
const api = window.__ATELIE_API__ || (configurado && window.supabase ? criarApiSupabase() : null);

/* ---------- estado ---------- */
let RAW = null;        // tabelas como vêm do banco (base do backup)
let DB = null;         // formato usado pelas telas
let EU = null;         // perfil de quem está logado
let carregadoEm = 0;
const ST = { tab: "inicio", filtro: "abertos", busca: "", mes: mesDe(hoje()), limite: 150 };
const STATUS = { recebido: "Recebido", andamento: "Em andamento", pronto: "Pronto p/ retirar", entregue: "Entregue" };

function montarDB(raw) {
  const itensPor = {}, pagsPor = {};
  raw.pedido_itens.forEach(i => (itensPor[i.pedido_id] = itensPor[i.pedido_id] || []).push(i));
  raw.pagamentos.forEach(p => (pagsPor[p.pedido_id] = pagsPor[p.pedido_id] || []).push(p));
  const cfg = {}; raw.config.forEach(c => cfg[c.chave] = c.valor);
  return {
    services: raw.servicos.map(s => ({ id: s.id, nome: s.nome, cat: s.categoria, preco: +s.preco, custo: +s.custo, ativo: s.ativo })),
    clients: raw.clientes.map(c => ({ id: c.id, nome: c.nome, fone: c.fone || "", obs: c.obs || "" })),
    orders: raw.pedidos.map(o => ({
      id: o.id, num: +o.numero, cli: o.cliente_id, data: o.recebido_em, entrega: o.entregar_em, status: o.status,
      entregue_em: o.entregue_em, detalhes: o.detalhes || "",
      itens: (itensPor[o.id] || []).sort((a, b) => a.ordem - b.ordem).map(i => ({ id: i.id, servico_id: i.servico_id, nome: i.nome, qtd: +i.qtd, preco: +i.preco, custo: +i.custo, avulso: i.avulso })),
      pagamentos: (pagsPor[o.id] || []).map(p => ({ id: p.id, data: p.pago_em, valor: +p.valor, forma: p.forma, taxa: +p.taxa }))
    })),
    despesas: raw.despesas.map(d => ({ id: d.id, data: d.data, desc: d.descricao, cat: d.categoria, valor: +d.valor })),
    investimentos: raw.investimentos.map(i => ({ id: i.id, nome: i.nome, data: i.data, valor: +i.valor })),
    cats: raw.categorias_despesa.map(c => c.nome),
    cfg: { taxa_debito: +cfg.taxa_debito || 0, taxa_credito: +cfg.taxa_credito || 0, ultimo_backup: cfg.ultimo_backup || null }
  };
}
async function recarregar() {
  RAW = await api.carregar();
  DB = montarDB(RAW);
  carregadoEm = Date.now();
}
/* executa uma gravação com o botão travado (evita toque duplo) e recarrega os dados */
async function acao(btn, fn, okMsg) {
  if (btn && btn.disabled) return false;
  const txt = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
  try {
    await fn();
    await recarregar();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    const err = traduzErro(e);
    toast(err.message, 5000);
    console.error(e);
    return false;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = txt; }
  }
}

/* ---------- cálculos ---------- */
const totalPedido = o => r2(o.itens.reduce((a, i) => a + i.qtd * i.preco, 0));
const custoPedido = o => r2(o.itens.reduce((a, i) => a + i.qtd * (i.custo || 0), 0));
const pagoPedido = o => r2(o.pagamentos.reduce((a, p) => a + p.valor, 0));
const saldoPedido = o => Math.max(0, r2(totalPedido(o) - pagoPedido(o)));
const atrasado = o => o.status !== "entregue" && o.entrega < hoje();
const cliente = id => DB.clients.find(c => c.id === id) || { nome: "Cliente removida", fone: "" };
const taxaPara = (forma, valor) => r2(valor * ((forma === "Débito" ? DB.cfg.taxa_debito : forma === "Crédito" ? DB.cfg.taxa_credito : 0) / 100));
function resumoMes(ym) {
  const ped = DB.orders.filter(o => mesDe(o.data) === ym);
  const fat = r2(ped.reduce((a, o) => a + totalPedido(o), 0));
  const mat = r2(ped.reduce((a, o) => a + custoPedido(o), 0));
  const pags = DB.orders.flatMap(o => o.pagamentos).filter(p => mesDe(p.data) === ym);
  const rec = r2(pags.reduce((a, p) => a + p.valor, 0));
  const taxas = r2(pags.reduce((a, p) => a + (p.taxa || 0), 0));
  const desp = r2(DB.despesas.filter(d => mesDe(d.data) === ym).reduce((a, d) => a + d.valor, 0));
  const liq = r2(fat - mat - desp - taxas);
  return { ped, fat, mat, rec, taxas, desp, liq, margem: fat ? liq / fat : NaN, ticket: ped.length ? fat / ped.length : 0 };
}
const aReceber = () => r2(DB.orders.reduce((a, o) => a + saldoPedido(o), 0));
const mesesComDados = () => {
  const s = new Set([...DB.orders.map(o => mesDe(o.data)), ...DB.despesas.map(d => mesDe(d.data)),
    ...DB.orders.flatMap(o => o.pagamentos.map(p => mesDe(p.data))), mesDe(hoje())]);
  return [...s].filter(Boolean).sort().reverse();
};
const chip = o => atrasado(o) ? `<span class="chip st-atrasado">Atrasado</span>` : `<span class="chip st-${o.status}">${STATUS[o.status]}</span>`;
const ehAdmin = () => EU && EU.papel === "admin";

/* ---------- tema ---------- */
function temaAtual() { const t = document.documentElement.dataset.theme; if (t) return t; return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
function alternaTema() { const n = temaAtual() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = n; store.set("pap-tema", n); if (DB && EU) render(); else { const b = $("#ltema"); if (b) b.innerHTML = botaoTemaTxt(); } }
const icSol = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const icLua = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const botaoTemaTxt = () => temaAtual() === "dark" ? icSol + " Modo claro" : icLua + " Modo escuro";
const LOGO_GRANDE = `<img class="logo-light" src="assets/logo-claro.png" alt="Ateliê Ponto a Ponto — Conserto de Roupas em Geral"><img class="logo-dark" src="assets/logo-escuro.png" alt="Ateliê Ponto a Ponto — Conserto de Roupas em Geral">`;

/* =====================================================================
   TELAS DE ACESSO
   ===================================================================== */
function telaSimples(corpo) {
  fechaModal();
  $("#app").innerHTML = `<div class="wrap"><div class="login"><div class="card">${LOGO_GRANDE}${corpo}
    <div style="display:flex;justify-content:center"><button type="button" class="iconbtn" id="ltema">${botaoTemaTxt()}</button></div></div></div></div>`;
  $("#ltema").onclick = alternaTema;
}
function telaSemConfig() {
  telaSimples(`<h1>Falta configurar</h1><p class="muted" style="margin:0">Abra o arquivo <strong>config.js</strong> no GitHub e cole a <em>Project URL</em> e a chave <em>Publishable</em> do Supabase. O passo a passo está no README.</p>`);
}
function telaLogin(msg) {
  telaSimples(`<form id="flogin" novalidate style="display:grid;gap:16px">
    <h1>Entrar</h1>
    <label class="f">E-mail<input type="email" id="lemail" autocomplete="username" inputmode="email" required></label>
    <label class="f">Senha<input type="password" id="lsenha" autocomplete="current-password" required></label>
    <p class="erro-login" id="lerro" ${msg ? "" : "hidden"}>${esc(msg || "")}</p>
    <button class="btn primary" type="submit" id="lentrar">Entrar</button>
    <button class="link" type="button" id="lesqueci" style="justify-self:center">Esqueci minha senha</button>
  </form>`);
  const lembrado = store.get("pap-email"); if (lembrado) { $("#lemail").value = lembrado; $("#lsenha").focus(); } else $("#lemail").focus();
  const erro = m => { const e = $("#lerro"); e.textContent = m; e.hidden = !m; };
  $("#flogin").onsubmit = async e => {
    e.preventDefault();
    const email = $("#lemail").value.trim(), senha = $("#lsenha").value;
    if (!email || !senha) { erro("Preencha e-mail e senha."); return; }
    const b = $("#lentrar"); b.disabled = true; b.textContent = "Entrando…"; erro("");
    try { await api.entrar(email, senha); store.set("pap-email", email); await iniciarSessao(); }
    catch (err) { erro(traduzErro(err).message); b.disabled = false; b.textContent = "Entrar"; }
  };
  $("#lesqueci").onclick = async () => {
    const email = $("#lemail").value.trim();
    if (!email) { erro("Digite seu e-mail acima e toque de novo em “Esqueci minha senha”."); return; }
    try { await api.esqueci(email); erro(""); toast("Se o e-mail estiver cadastrado, chega um link para criar nova senha. Veja também o spam.", 7000); }
    catch (err) { erro(traduzErro(err).message); }
  };
}
function telaNovaSenha() {
  telaSimples(`<form id="fsenha" novalidate style="display:grid;gap:16px">
    <h1>Criar nova senha</h1>
    <label class="f">Nova senha<input type="password" id="ns1" autocomplete="new-password" minlength="8"></label>
    <label class="f">Repita a nova senha<input type="password" id="ns2" autocomplete="new-password" minlength="8"></label>
    <p class="erro-login" id="nerro" hidden></p>
    <button class="btn primary" type="submit" id="nsalvar">Salvar nova senha</button></form>`);
  $("#fsenha").onsubmit = async e => {
    e.preventDefault();
    const a = $("#ns1").value, b = $("#ns2").value, er = $("#nerro");
    const msg = a.length < 8 ? "Use pelo menos 8 caracteres." : a !== b ? "As senhas não são iguais." : "";
    if (msg) { er.textContent = msg; er.hidden = false; return; }
    const bt = $("#nsalvar"); bt.disabled = true;
    try { await api.novaSenha(a); recuperandoSenha = false; history.replaceState(null, "", location.pathname); toast("Senha alterada."); await iniciarSessao(); }
    catch (err) { er.textContent = traduzErro(err).message; er.hidden = false; bt.disabled = false; }
  };
}
function telaInativo() {
  telaSimples(`<h1>Acesso ainda não liberado</h1>
    <p class="muted" style="margin:0;text-align:center">Sua conta <strong>${esc(EU?.email || "")}</strong> existe, mas ainda não foi liberada. Peça ao administrador para ativar seu acesso.</p>
    <button class="btn ghost" id="isair">Sair</button>`);
  $("#isair").onclick = sair;
}
function telaErroCarga(err) {
  telaSimples(`<h1>Não foi possível carregar</h1>
    <p class="muted" style="margin:0;text-align:center">${esc(traduzErro(err).message)}</p>
    <button class="btn primary" id="etentar">Tentar de novo</button><button class="btn ghost" id="esair">Sair</button>`);
  $("#etentar").onclick = iniciarSessao;
  $("#esair").onclick = sair;
}
async function sair() { try { await api.sair(); } catch (e) { } EU = null; DB = null; RAW = null; telaLogin(); }

async function iniciarSessao() {
  if (recuperandoSenha) { telaNovaSenha(); return; }
  let s;
  try { s = await api.sessao(); } catch (e) { s = null; }
  if (!s) { telaLogin(); return; }
  try {
    EU = await api.meuPerfil(s.user.id);
    if (!EU) EU = { email: s.user.email, ativo: false };
    if (!EU.ativo) { telaInativo(); return; }
    await recarregar();
    ST.tab = "inicio"; render();
  } catch (e) { console.error(e); telaErroCarga(e); }
}

/* =====================================================================
   CASCA (cabeçalho e abas)
   ===================================================================== */
const ABAS = [["inicio", "Início"], ["pedidos", "Pedidos"], ["clientes", "Clientes"], ["caixa", "Caixa"], ["relatorios", "Relatórios"], ["servicos", "Serviços"]];
const ABAS_ADM = [["usuarios", "Usuários"], ["config", "Configurações"]];
function render() {
  if (!EU || !DB) return;
  const adm = ehAdmin();
  if (!adm && ABAS_ADM.some(([k]) => k === ST.tab)) ST.tab = "inicio";
  const tabs = ABAS.map(([k, n]) => `<button data-tab="${k}" aria-current="${ST.tab === k}">${n}</button>`).join("") +
    (adm ? `<span class="sep" aria-hidden="true"></span>` + ABAS_ADM.map(([k, n]) => `<button class="adm" data-tab="${k}" aria-current="${ST.tab === k}">${n}</button>`).join("") : "");
  $("#app").innerHTML = `
  <header class="top"><div class="wrap">
    <div class="bar">
      <div class="brand">
        <img class="logo-light" src="assets/logo-compacta-claro.png" alt="Ponto a Ponto">
        <img class="logo-dark" src="assets/logo-compacta-escuro.png" alt="Ponto a Ponto">
        ${adm ? `<span class="role">Admin</span>` : ""}
      </div>
      <button class="iconbtn" id="btema" aria-label="Alternar tema">${temaAtual() === "dark" ? icSol : icLua}<span class="hide-s">${temaAtual() === "dark" ? "Claro" : "Escuro"}</span></button>
      <button class="iconbtn" id="bconta" aria-label="Minha conta">${esc((EU.nome || EU.email || "Conta").split(" ")[0])}</button>
    </div>
    <nav class="tabs" aria-label="Seções">${tabs}</nav>
  </div></header>
  <main class="wrap" id="view"></main>`;
  $$("[data-tab]").forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; ST.busca = ""; ST.limite = 150; render(); scrollTo(0, 0); });
  $("#btema").onclick = alternaTema;
  $("#bconta").onclick = minhaConta;
  ({ inicio: vInicio, pedidos: vPedidos, clientes: vClientes, caixa: vCaixa, relatorios: vRelatorios, servicos: vServicos, usuarios: vUsuarios, config: vConfig }[ST.tab] || vInicio)();
}
function minhaConta() {
  abreModal(`<header><h2>Minha conta</h2><button class="close" data-close aria-label="Fechar">×</button></header>
  <div class="body">
    <div><div style="font-weight:700">${esc(EU.nome || "")}</div><div class="muted">${esc(EU.email)} · ${EU.papel === "admin" ? "Administrador" : "Ateliê"}</div></div>
    <div class="fgrid">
      <label class="f">Nova senha<input type="password" id="mc1" autocomplete="new-password"></label>
      <label class="f">Repita<input type="password" id="mc2" autocomplete="new-password"></label>
    </div>
    <div><button class="btn ghost" id="mcsenha">Trocar senha</button></div>
    <p class="hint">Dados atualizados ${carregadoEm ? "às " + new Date(carregadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}. <button class="link" id="mcrec">Atualizar agora</button></p>
  </div>
  <footer><span></span><button class="btn primary" id="mcsair">Sair do sistema</button></footer>`, () => {
    $("#mcsair").onclick = () => { fechaModal(); sair(); };
    $("#mcrec").onclick = async e => { if (await acao(e.target, async () => { }, "Dados atualizados")) { fechaModal(); render(); } };
    $("#mcsenha").onclick = async e => {
      const a = $("#mc1").value, b = $("#mc2").value;
      if (a.length < 8) { toast("Use pelo menos 8 caracteres."); return; }
      if (a !== b) { toast("As senhas não são iguais."); return; }
      const bt = e.target; bt.disabled = true;
      try { await api.novaSenha(a); toast("Senha alterada."); fechaModal(); } catch (err) { toast(traduzErro(err).message, 5000); bt.disabled = false; }
    };
  });
}

/* =====================================================================
   INÍCIO
   ===================================================================== */
function vInicio() {
  const ym = mesDe(hoje()), r = resumoMes(ym), ant = resumoMes(prevMes(ym));
  const abertos = DB.orders.filter(o => o.status !== "entregue").sort((a, b) => a.entrega.localeCompare(b.entrega));
  const atr = abertos.filter(atrasado).length;
  const h = new Date().getHours(); const saud = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const nome = (EU.nome || "").split(" ")[0];
  const delta = (a, b) => { if (!b) return `<span class="muted">sem dados do mês anterior</span>`; const d = (a - b) / Math.abs(b); return `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))}</span> vs. ${MESES[+prevMes(ym).slice(5) - 1]}`; };
  let avisos = "";
  if (ehAdmin()) {
    const ult = DB.cfg.ultimo_backup;
    const dias = ult ? Math.floor((Date.now() - new Date(ult).getTime()) / 864e5) : null;
    if (dias === null || dias >= 7) avisos += `<div class="alerta"><span>${dias === null ? "Nenhum backup feito ainda." : `Último backup há ${dias} dias.`} O plano grátis do Supabase não guarda cópias para você.</span><button class="btn ghost small" id="irbackup">Fazer backup</button></div>`;
  }
  if (!DB.services.length) avisos += `<div class="alerta"><span>O catálogo de serviços está vazio. Cadastre os serviços com preço e custo de material para o lucro ser calculado.</span><button class="btn ghost small" data-go="servicos">Cadastrar serviços</button></div>`;
  else if (DB.services.some(s => s.ativo && !s.custo)) avisos += `<div class="alerta"><span>${DB.services.filter(s => s.ativo && !s.custo).length} serviço(s) estão sem custo de material. O lucro desses aparece maior do que é.</span><button class="btn ghost small" data-go="servicos">Revisar</button></div>`;
  $("#view").innerHTML = `
  ${avisos}
  <div class="pagehead"><div><div class="eyebrow">${nomeMes(ym)}</div><h1>${saud}${nome ? ", " + esc(nome) : ""}!</h1><p>${abertos.length} peça(s) no ateliê · ${atr ? `<strong style="color:var(--bad)">${atr} atrasada(s)</strong>` : "nenhuma atrasada"}</p></div>
    <button class="btn primary" id="novo">+ Novo pedido</button></div>
  <div class="kpis">
    <div class="kpi hero"><div class="l">Lucro líquido do mês</div><div class="v">${brl(r.liq)}</div><div class="d">margem ${pct(r.margem)}</div></div>
    <div class="kpi"><div class="l">Faturamento do mês</div><div class="v">${brl(r.fat)}</div><div class="d">${delta(r.fat, ant.fat)}</div></div>
    <div class="kpi"><div class="l">A receber</div><div class="v">${brl(aReceber())}</div><div class="d muted">saldo de pedidos em aberto</div></div>
    <div class="kpi"><div class="l">Custos do mês</div><div class="v">${brl(r.desp + r.mat + r.taxas)}</div><div class="d muted">${brl(r.desp)} despesas + ${brl(r.mat)} material${r.taxas ? " + " + brl(r.taxas) + " taxas" : ""}</div></div>
  </div>
  <div class="grid2">
    <section class="block"><h2>Próximas entregas <button class="link" data-go="pedidos">Ver todos</button></h2>
      <div class="list">${abertos.length ? abertos.slice(0, 8).map(linhaPedido).join("") : `<div class="empty">Nenhuma peça em aberto.</div>`}</div></section>
    <section class="block"><h2>Serviços mais pedidos no mês</h2>${barrasServicos(r.ped, "qtd")}</section>
  </div>`;
  $("#novo").onclick = () => formPedido();
  const ib = $("#irbackup"); if (ib) ib.onclick = () => { ST.tab = "config"; render(); };
  ligaPedidos(); $$("[data-go]").forEach(b => b.onclick = () => { ST.tab = b.dataset.go; render(); });
}
function linhaPedido(o) {
  const c = cliente(o.cli), saldo = saldoPedido(o);
  const ent = o.status === "entregue" ? `entregue ${fmtD(o.entregue_em || o.entrega)}` : `entrega ${fmtD(o.entrega)}${o.entrega === hoje() ? " (hoje)" : ""}`;
  return `<button class="row" data-ped="${o.id}">
    <div class="t">${esc(c.nome)}</div><div class="r">${brl(totalPedido(o))}</div>
    <div class="s">#${o.num} · ${esc(o.itens.map(i => (i.qtd > 1 ? i.qtd + "× " : "") + i.nome).join(", "))}</div>
    <div class="s" style="text-align:right">${saldo > 0 ? `<span class="pay open">falta ${brl(saldo)}</span>` : `<span class="pay done">pago</span>`}</div>
    <div class="s" style="grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${chip(o)}<span>${ent}</span></div>
  </button>`;
}
const ligaPedidos = () => $$("[data-ped]").forEach(b => b.onclick = () => detalhePedido(b.dataset.ped));
function barrasServicos(peds, modo) {
  const m = {};
  peds.forEach(o => o.itens.forEach(i => { const k = i.avulso ? "Serviços avulsos" : i.nome; m[k] = m[k] || { qtd: 0, fat: 0, lucro: 0 }; m[k].qtd += i.qtd; m[k].fat += i.qtd * i.preco; m[k].lucro += i.qtd * (i.preco - (i.custo || 0)); }));
  const arr = Object.entries(m).sort((a, b) => b[1][modo] - a[1][modo]).slice(0, 6);
  if (!arr.length) return `<div class="bars"><div class="empty">Sem pedidos no período.</div></div>`;
  const max = Math.max(...arr.map(a => a[1][modo]), 1);
  return `<div class="bars">${arr.map(([k, v]) => `<div class="bar"><span class="lbl" title="${esc(k)}">${esc(k)}</span><span class="track"><span class="fill${modo === "qtd" ? " alt" : ""}" style="width:${Math.max(4, v[modo] / max * 100)}%;display:block"></span></span><span class="val">${modo === "qtd" ? v.qtd + " un." : brl(v[modo])}</span></div>`).join("")}</div>`;
}

/* =====================================================================
   PEDIDOS
   ===================================================================== */
function vPedidos() {
  const f = ST.filtro, q = ST.busca.toLowerCase().trim();
  let lst = DB.orders.slice().sort((a, b) => b.data.localeCompare(a.data) || b.num - a.num);
  if (f === "abertos") lst = lst.filter(o => o.status !== "entregue");
  else if (f === "atrasados") lst = lst.filter(atrasado);
  else if (f === "prontos") lst = lst.filter(o => o.status === "pronto");
  else if (f === "receber") lst = lst.filter(o => saldoPedido(o) > 0);
  if (q) { const qd = q.replace(/\D/g, ""); lst = lst.filter(o => { const c = cliente(o.cli); return c.nome.toLowerCase().includes(q) || String(o.num) === q.replace("#", "") || (qd.length >= 4 && c.fone.replace(/\D/g, "").includes(qd)) || o.itens.some(i => i.nome.toLowerCase().includes(q)); }); }
  const F = [["abertos", "Em aberto"], ["prontos", "Prontos"], ["atrasados", "Atrasados"], ["receber", "A receber"], ["todos", "Todos"]];
  const vis = lst.slice(0, ST.limite);
  $("#view").innerHTML = `
  <div class="pagehead"><div><h1>Pedidos</h1><p>${lst.length} pedido(s) · a receber ${brl(aReceber())}</p></div><button class="btn primary" id="novo">+ Novo pedido</button></div>
  <div class="toolbar"><div class="seg">${F.map(([k, n]) => `<button data-f="${k}" aria-pressed="${f === k}">${n}</button>`).join("")}</div>
    <input class="search" id="busca" type="search" placeholder="Buscar cliente, nº, telefone ou serviço" value="${esc(ST.busca)}" aria-label="Buscar pedidos"></div>
  <div class="list">${vis.length ? vis.map(linhaPedido).join("") : `<div class="empty">Nenhum pedido neste filtro.</div>`}</div>
  ${lst.length > vis.length ? `<div class="mais"><button class="btn ghost" id="mais">Mostrar mais (${lst.length - vis.length})</button></div>` : ""}`;
  $("#novo").onclick = () => formPedido();
  $$("[data-f]").forEach(b => b.onclick = () => { ST.filtro = b.dataset.f; ST.limite = 150; vPedidos(); });
  const bi = $("#busca"); bi.oninput = () => { ST.busca = bi.value; const p = bi.selectionStart; vPedidos(); const n = $("#busca"); n.focus(); n.setSelectionRange(p, p); };
  const bm = $("#mais"); if (bm) bm.onclick = () => { ST.limite += 300; vPedidos(); };
  ligaPedidos();
}

/* ---------- modal ---------- */
function abreModal(html, onMount) {
  $("#modal").innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#ov").onclick = e => { if (e.target.id === "ov") fechaModal(); };
  $$("[data-close]").forEach(b => b.onclick = fechaModal);
  document.body.style.overflow = "hidden"; onMount && onMount();
}
function fechaModal() { $("#modal").innerHTML = ""; document.body.style.overflow = ""; }
addEventListener("keydown", e => { if (e.key === "Escape" && $("#ov")) fechaModal(); });
/* botão que pede um segundo toque para confirmar */
function confirmaDuplo(btn, texto, fn) {
  let armado = false;
  btn.onclick = e => {
    if (!armado) { armado = true; btn.dataset.orig = btn.textContent; btn.textContent = texto || "Toque de novo para confirmar"; setTimeout(() => { if (btn.isConnected && armado) { armado = false; btn.textContent = btn.dataset.orig; } }, 4000); return; }
    armado = false; fn(e);
  };
}

/* ---------- novo / editar pedido ---------- */
function formPedido(editId) {
  const ed = editId ? DB.orders.find(o => o.id === editId) : null;
  const P = ed ? {
    id: ed.id, cli: ed.cli, novaCli: false, nome: "", fone: "", data: ed.data, entrega: ed.entrega,
    itens: ed.itens.map(i => ({ ...i })), detalhes: ed.detalhes, sinal: "", forma: "Pix"
  } : {
    id: novoId(), pagId: novoId(), cliId: novoId(), cli: "", novaCli: !DB.clients.length, nome: "", fone: "",
    data: hoje(), entrega: "", itens: [], detalhes: "", sinal: "", forma: "Pix"
  };
  const ativos = DB.services.filter(s => s.ativo);
  const cats = [...new Set(ativos.map(s => s.cat))].sort((a, b) => a.localeCompare(b));
  abreModal(`<header><h2>${ed ? "Editar pedido #" + ed.num : "Novo pedido"}</h2><button class="close" data-close aria-label="Fechar">×</button></header>
  <div class="body" id="fp"></div>
  <footer><div class="num" id="fpTot"></div><div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="fpSalvar">${ed ? "Salvar alterações" : "Salvar pedido"}</button></div></footer>`, () => {
    const desenha = () => {
      const tot = r2(P.itens.reduce((a, i) => a + i.qtd * i.preco, 0)), cus = r2(P.itens.reduce((a, i) => a + i.qtd * (i.custo || 0), 0));
      const sinal = lerValor(P.sinal) || 0;
      const clis = DB.clients.slice().sort((a, b) => a.nome.localeCompare(b.nome));
      $("#fp").innerHTML = `
      <div class="fgrid">
        ${P.novaCli ? `<label class="f">Nome da cliente<input type="text" id="pnome" value="${esc(P.nome)}" placeholder="Nome completo" autocomplete="off"></label>
          <label class="f">WhatsApp<input type="tel" id="pfone" value="${esc(P.fone)}" placeholder="(85) 9…" autocomplete="off"></label>
          ${DB.clients.length ? `<div class="full"><button class="link" id="pcliex">Escolher cliente já cadastrada</button></div>` : ""}`
          : `<label class="f full">Cliente<input type="search" id="pbusca" placeholder="Digite para filtrar…" autocomplete="off" style="margin-bottom:6px">
              <select id="pcli"><option value="">Escolha a cliente…</option>${clis.map(c => `<option value="${c.id}" ${c.id === P.cli ? "selected" : ""}>${esc(c.nome)}${c.fone ? " · " + esc(c.fone) : ""}</option>`).join("")}</select></label>
          <div class="full"><button class="link" id="pclinova">+ Cliente nova</button></div>`}
        <label class="f">Recebido em<input type="date" id="pdata" value="${P.data}"></label>
        <label class="f">Entregar até<input type="date" id="pent" value="${P.entrega}" min="${P.data}"></label>
      </div>
      <div class="items">
        <label class="f">Adicionar serviço<select id="padd"><option value="">${ativos.length ? "Escolha um serviço do catálogo…" : "Catálogo vazio — use serviço avulso"}</option>${cats.map(c => `<optgroup label="${esc(c)}">${ativos.filter(s => s.cat === c).map(s => `<option value="${s.id}">${esc(s.nome)} — ${brl(s.preco)}</option>`).join("")}</optgroup>`).join("")}</select></label>
        ${P.itens.length ? `<div class="hint" style="display:grid;grid-template-columns:minmax(0,1fr) 64px 104px 34px;gap:8px;padding:0 9px"><span>Serviço</span><span>Qtd</span><span>Preço un.</span><span></span></div>` : ""}
        ${P.itens.map((i, k) => `<div class="item">
          <div class="nm">${i.avulso ? `<input type="text" data-k="${k}" data-c="nome" value="${esc(i.nome)}" placeholder="Descreva o serviço">` : esc(i.nome)}</div>
          <input type="number" min="1" step="1" inputmode="numeric" data-k="${k}" data-c="qtd" value="${i.qtd}" aria-label="Quantidade">
          <input type="text" inputmode="decimal" class="input-money" data-k="${k}" data-c="preco" value="${num2(i.preco)}" aria-label="Preço">
          <button class="rm" data-rm="${k}" aria-label="Remover">×</button>
          ${i.avulso ? `<label class="hint" style="grid-column:1/-1;display:flex;gap:8px;align-items:center">Custo de material (un.) <input type="text" inputmode="decimal" class="input-money" style="width:96px" data-k="${k}" data-c="custo" value="${num2(i.custo)}"></label>` : ""}
        </div>`).join("")}
        <div><button class="btn ghost small" id="pavulso">+ Serviço avulso (fora do catálogo)</button></div>
      </div>
      <label class="f">Detalhes do serviço<textarea id="pdet" placeholder="Ex.: tecido delicado, cliente vai trazer o zíper, marcar na prova…">${esc(P.detalhes)}</textarea></label>
      ${ed ? `<p class="hint">Pagamentos e andamento são alterados na tela do pedido. Mudar o preço aqui não altera o que já foi pago.</p>` : `<div class="fgrid">
        <label class="f">Valor pago agora (sinal)<input type="text" inputmode="decimal" class="input-money" id="psinal" value="${esc(P.sinal)}" placeholder="0,00"></label>
        <label class="f">Forma de pagamento<select id="pforma">${optFormas(P.forma)}</select></label>
      </div>`}
      <div class="sum">
        <div><span>Custo de material (estimado)</span><span>${brl(cus)}</span></div>
        <div><span>Lucro do pedido</span><span>${brl(tot - cus)}</span></div>
        ${ed ? `<div><span>Já pago</span><span>${brl(pagoPedido(ed))}</span></div>` : `<div><span>Falta receber</span><span>${brl(Math.max(0, tot - sinal))}</span></div>`}
        <div class="tot"><span>Total</span><span>${brl(tot)}</span></div>
      </div>`;
      $("#fpTot").innerHTML = `<strong>${brl(tot)}</strong> <span class="muted">· ${P.itens.length} item(ns)</span>`;
      const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
      on("#pcli", "onchange", e => P.cli = e.target.value);
      on("#pbusca", "oninput", e => { const q = e.target.value.toLowerCase(); const sel = $("#pcli"); let primeiro = null; [...sel.options].forEach(o => { if (!o.value) return; const vis = o.textContent.toLowerCase().includes(q); o.hidden = !vis; if (vis && !primeiro) primeiro = o; }); if (q && primeiro) { sel.value = primeiro.value; P.cli = primeiro.value; } });
      on("#pclinova", "onclick", () => { P.novaCli = true; desenha(); $("#pnome")?.focus(); }); on("#pcliex", "onclick", () => { P.novaCli = false; desenha(); });
      on("#pnome", "oninput", e => P.nome = e.target.value); on("#pfone", "oninput", e => P.fone = e.target.value);
      on("#pdata", "onchange", e => { P.data = e.target.value; desenha(); }); on("#pent", "onchange", e => P.entrega = e.target.value);
      on("#pdet", "oninput", e => P.detalhes = e.target.value);
      on("#pforma", "onchange", e => P.forma = e.target.value);
      on("#psinal", "onchange", e => { P.sinal = e.target.value; desenha(); });
      on("#padd", "onchange", e => { const s = DB.services.find(x => x.id === e.target.value); if (!s) return; const ex = P.itens.find(i => !i.avulso && i.servico_id === s.id); if (ex) ex.qtd++; else P.itens.push({ servico_id: s.id, nome: s.nome, qtd: 1, preco: s.preco, custo: s.custo, avulso: false }); desenha(); });
      on("#pavulso", "onclick", () => { P.itens.push({ servico_id: null, nome: "", qtd: 1, preco: 0, custo: 0, avulso: true }); desenha(); const ins = $$('[data-c="nome"]'); ins[ins.length - 1]?.focus(); });
      $$("[data-rm]").forEach(b => b.onclick = () => { P.itens.splice(+b.dataset.rm, 1); desenha(); });
      $$("[data-k]").forEach(inp => {
        const k = +inp.dataset.k, c = inp.dataset.c;
        if (c === "nome") inp.oninput = () => P.itens[k].nome = inp.value;
        else if (c === "qtd") inp.onchange = () => { P.itens[k].qtd = Math.max(1, Math.round(+inp.value || 1)); desenha(); };
        else inp.onchange = () => { const v = lerValor(inp.value); P.itens[k][c] = isNaN(v) ? 0 : Math.max(0, v); desenha(); };
      });
    };
    desenha();
    $("#fpSalvar").onclick = async e => {
      if (P.novaCli && !P.nome.trim()) { toast("Informe o nome da cliente"); return; }
      if (!P.novaCli && !P.cli) { toast("Escolha a cliente"); return; }
      if (!P.itens.length) { toast("Adicione pelo menos um serviço"); return; }
      if (P.itens.some(i => i.avulso && !i.nome.trim())) { toast("Descreva o serviço avulso"); return; }
      if (!P.entrega) { toast("Informe a data de entrega"); return; }
      if (P.entrega < P.data) { toast("A entrega não pode ser antes do recebimento"); return; }
      const sinal = ed ? 0 : (lerValor(P.sinal) || 0);
      const tot = r2(P.itens.reduce((a, i) => a + i.qtd * i.preco, 0));
      if (sinal < 0 || sinal > tot) { toast("O sinal não pode ser maior que o total"); return; }
      const corpo = {
        id: P.id, recebido_em: P.data, entregar_em: P.entrega, detalhes: P.detalhes.trim(),
        itens: P.itens.map(i => ({ servico_id: i.servico_id || null, nome: i.nome.trim(), qtd: i.qtd, preco: i.preco, custo: i.custo || 0, avulso: !!i.avulso }))
      };
      if (P.novaCli) corpo.cliente_nova = { id: P.cliId, nome: P.nome.trim(), fone: P.fone.trim() }; else corpo.cliente_id = P.cli;
      if (!ed && sinal > 0) corpo.pagamento = { id: P.pagId, valor: sinal, forma: P.forma, pago_em: P.data, taxa: taxaPara(P.forma, sinal) };
      let numero;
      const ok = await acao(e.currentTarget, async () => { const r = await api.salvarPedido(corpo); numero = r && r.numero; });
      if (ok) { fechaModal(); render(); toast(ed ? `Pedido #${ed.num} atualizado` : `Pedido #${numero} salvo`); if (!ed) detalhePedido(P.id); }
    };
  });
}

/* ---------- WhatsApp e comprovante ---------- */
function linkWhats(o) {
  const c = cliente(o.cli); let d = (c.fone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = "55" + d;
  const saldo = saldoPedido(o), nome = c.nome.split(" ")[0];
  const msg = o.status === "pronto"
    ? `Olá, ${nome}! Aqui é do Ateliê Ponto a Ponto. Seu pedido nº ${o.num} está pronto para retirada.${saldo > 0 ? ` Valor a pagar na retirada: ${brl(saldo)}.` : ""} Obrigada!`
    : `Olá, ${nome}! Aqui é do Ateliê Ponto a Ponto, sobre o seu pedido nº ${o.num}.`;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
}
function imprimirComprovante(o) {
  const c = cliente(o.cli);
  $("#print").innerHTML = `<img src="assets/logo-claro.png" alt="">
    <h2>Pedido nº ${o.num}</h2>
    <p><strong>Cliente:</strong> ${esc(c.nome)}${c.fone ? " · " + esc(c.fone) : ""}<br>
    <strong>Recebido em:</strong> ${fmtDC(o.data)} &nbsp; <strong>Entrega:</strong> ${fmtDC(o.entrega)}</p>
    <table><thead><tr><th>Serviço</th><th class="n">Qtd</th><th class="n">Valor</th></tr></thead><tbody>
    ${o.itens.map(i => `<tr><td>${esc(i.nome)}</td><td class="n">${i.qtd}</td><td class="n">${brl(i.qtd * i.preco)}</td></tr>`).join("")}
    </tbody></table>
    <p style="text-align:right"><strong>Total: ${brl(totalPedido(o))}</strong><br>Pago: ${brl(pagoPedido(o))}<br>Falta pagar: ${brl(saldoPedido(o))}</p>
    ${o.detalhes ? `<p><strong>Observações:</strong> ${esc(o.detalhes)}</p>` : ""}
    <p class="rod">Guarde este comprovante para retirar sua peça.<br>Ateliê Ponto a Ponto · Conserto de Roupas em Geral</p>`;
  const img = $("#print img");
  const go = () => setTimeout(() => window.print(), 50);
  if (img.complete) go(); else { img.onload = go; img.onerror = go; }
}

/* ---------- detalhe do pedido ---------- */
function detalhePedido(id) {
  const o = DB.orders.find(x => x.id === id); if (!o) { fechaModal(); return; }
  const c = cliente(o.cli);
  const tot = totalPedido(o), cus = custoPedido(o), saldo = saldoPedido(o);
  const wa = linkWhats(o);
  const pagId = novoId();
  abreModal(`<header><h2>Pedido #${o.num}</h2><button class="close" data-close aria-label="Fechar">×</button></header>
  <div class="body">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div><div style="font-weight:700;font-size:17px">${esc(c.nome)}</div><div class="muted">WhatsApp: <span class="wa">${esc(c.fone || "não informado")}</span></div></div>
      <div style="text-align:right">${chip(o)}<div class="muted" style="font-size:13px;margin-top:4px">recebido ${fmtD(o.data)} · entrega ${fmtD(o.entrega)}${o.entregue_em ? " · entregue " + fmtD(o.entregue_em) : ""}</div></div>
    </div>
    <div class="acoes">
      ${wa ? `<a class="btn ghost small" href="${esc(wa)}" target="_blank" rel="noopener">${o.status === "pronto" ? "Avisar no WhatsApp que está pronto" : "Chamar no WhatsApp"}</a>` : ""}
      <button class="btn ghost small" id="dimp">Imprimir comprovante</button>
      <button class="btn ghost small" id="dedit">Editar pedido</button>
    </div>
    <div><div class="eyebrow" style="margin-bottom:6px">Andamento</div><div class="statusflow">${Object.entries(STATUS).map(([k, n]) => `<button data-st="${k}" aria-pressed="${o.status === k}">${n}</button>`).join("")}</div></div>
    <div class="tablewrap"><table><thead><tr><th>Serviço</th><th class="n">Qtd</th><th class="n">Valor</th></tr></thead><tbody>
      ${o.itens.map(i => `<tr><td>${esc(i.nome)} ${i.avulso ? '<span class="tag">avulso</span>' : ""}</td><td class="n">${i.qtd}</td><td class="n">${brl(i.qtd * i.preco)}</td></tr>`).join("")}
    </tbody></table></div>
    ${o.detalhes ? `<div class="note"><strong>Detalhes:</strong> ${esc(o.detalhes)}</div>` : ""}
    <div class="sum">
      <div><span>Total</span><span>${brl(tot)}</span></div>
      <div><span>Custo de material</span><span>${brl(cus)}</span></div>
      <div><span>Lucro do pedido</span><span>${brl(tot - cus)}</span></div>
      <div class="tot"><span>Falta receber</span><span style="color:${saldo > 0 ? "var(--warn)" : "var(--ok)"}">${brl(saldo)}</span></div>
    </div>
    ${o.pagamentos.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Pagamentos</div><div class="pags">${o.pagamentos.map(p => `<div class="pag"><span>${fmtD(p.data)} · ${esc(p.forma)}${p.taxa ? ` <span class="muted">(taxa ${brl(p.taxa)})</span>` : ""}</span><span><strong>${brl(p.valor)}</strong> <button class="x" data-xpag="${p.id}" aria-label="Remover pagamento">remover</button></span></div>`).join("")}</div></div>` : ""}
    ${saldo > 0 ? `<div class="fgrid"><label class="f">Receber agora<input type="text" inputmode="decimal" class="input-money" id="dval" value="${num2(saldo)}"></label>
      <label class="f">Forma<select id="dforma">${optFormas("Pix")}</select></label></div>` : ""}
  </div>
  <footer><button class="btn danger small" id="dexc">Excluir pedido</button>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${saldo > 0 ? `<button class="btn ghost" id="dreceb">Registrar pagamento</button>` : ""}
    ${o.status !== "entregue" ? `<button class="btn primary" id="dentregar">${saldo > 0 ? "Receber e entregar" : "Marcar como entregue"}</button>` : `<button class="btn ghost" data-close>Fechar</button>`}</div></footer>`, () => {
    const reabre = () => { render(); if (DB.orders.some(x => x.id === id)) detalhePedido(id); else fechaModal(); };
    $$("[data-st]").forEach(b => b.onclick = async () => {
      if (b.dataset.st === o.status) return;
      const campos = { status: b.dataset.st, entregue_em: b.dataset.st === "entregue" ? (o.entregue_em || hoje()) : null };
      if (await acao(b, () => api.atualizar("pedidos", o.id, campos), "Andamento atualizado")) reabre();
    });
    $("#dimp").onclick = () => imprimirComprovante(o);
    $("#dedit").onclick = () => formPedido(o.id);
    const lerReceb = () => {
      const el = $("#dval"); if (!el) return 0;
      const v = lerValor(el.value);
      if (isNaN(v) || v < 0) throw traduzErro({ message: "Valor inválido." });
      if (v > saldo) throw traduzErro({ message: `O valor passa do que falta receber (${brl(saldo)}).` });
      return v;
    };
    const receber = async (btn, entregar) => {
      let v; try { v = lerReceb(); } catch (err) { toast(err.message); return; }
      if (!entregar && !(v > 0)) { toast("Informe o valor recebido"); return; }
      const forma = $("#dforma") ? $("#dforma").value : "Pix";
      const ok = await acao(btn, () => api.receber({ p_id: pagId, p_pedido: o.id, p_valor: v, p_forma: forma, p_taxa: taxaPara(forma, v), p_data: hoje(), p_entregar: !!entregar }),
        entregar ? `Pedido #${o.num} entregue` : "Pagamento registrado");
      if (ok) { if (entregar) { fechaModal(); render(); } else reabre(); }
    };
    const br = $("#dreceb"); if (br) br.onclick = e => receber(e.currentTarget, false);
    const be = $("#dentregar"); if (be) be.onclick = e => receber(e.currentTarget, true);
    $$("[data-xpag]").forEach(b => confirmaDuplo(b, "confirmar?", async () => { if (await acao(b, () => api.excluir("pagamentos", b.dataset.xpag), "Pagamento removido")) reabre(); }));
    confirmaDuplo($("#dexc"), "Toque de novo para excluir", async e => {
      if (await acao(e.target, () => api.excluir("pedidos", o.id), `Pedido #${o.num} excluído`)) { fechaModal(); render(); }
    });
  });
}

/* =====================================================================
   CLIENTES
   ===================================================================== */
function vClientes() {
  const q = ST.busca.toLowerCase().trim(), qd = q.replace(/\D/g, "");
  const lst = DB.clients.filter(c => !q || c.nome.toLowerCase().includes(q) || (qd.length >= 3 && c.fone.replace(/\D/g, "").includes(qd))).sort((a, b) => a.nome.localeCompare(b.nome));
  const porCli = {}; DB.orders.forEach(o => (porCli[o.cli] = porCli[o.cli] || []).push(o));
  const stat = c => { const ps = porCli[c.id] || []; return { n: ps.length, gasto: ps.reduce((a, o) => a + totalPedido(o), 0), deve: ps.reduce((a, o) => a + saldoPedido(o), 0), ult: ps.map(o => o.data).sort().pop() }; };
  const vis = lst.slice(0, ST.limite);
  $("#view").innerHTML = `
  <div class="pagehead"><div><h1>Clientes</h1><p>${DB.clients.length} cadastrada(s)</p></div><button class="btn primary" id="ncli">+ Nova cliente</button></div>
  <div class="toolbar"><input class="search" id="busca" type="search" placeholder="Buscar por nome ou telefone" value="${esc(ST.busca)}" aria-label="Buscar clientes"></div>
  <div class="tablewrap"><table><thead><tr><th>Cliente</th><th>WhatsApp</th><th class="n">Pedidos</th><th class="n">Total gasto</th><th class="n">Deve</th><th>Último</th></tr></thead><tbody>
  ${vis.map(c => { const s = stat(c); return `<tr style="cursor:pointer" data-cli="${c.id}" tabindex="0"><td><strong>${esc(c.nome)}</strong>${c.obs ? `<div class="hint">${esc(c.obs)}</div>` : ""}</td><td class="wa num">${esc(c.fone)}</td><td class="n">${s.n}</td><td class="n">${brl(s.gasto)}</td><td class="n" style="color:${s.deve ? "var(--warn)" : "inherit"}">${s.deve ? brl(s.deve) : "—"}</td><td class="num">${s.ult ? fmtD(s.ult) : "—"}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">Nenhuma cliente encontrada.</td></tr>`}
  </tbody></table></div>
  ${lst.length > vis.length ? `<div class="mais"><button class="btn ghost" id="mais">Mostrar mais (${lst.length - vis.length})</button></div>` : ""}`;
  $("#ncli").onclick = () => formCliente();
  $$("[data-cli]").forEach(r => { r.onclick = () => formCliente(r.dataset.cli); r.onkeydown = e => { if (e.key === "Enter") formCliente(r.dataset.cli); }; });
  const bi = $("#busca"); bi.oninput = () => { ST.busca = bi.value; const p = bi.selectionStart; vClientes(); const n = $("#busca"); n.focus(); n.setSelectionRange(p, p); };
  const bm = $("#mais"); if (bm) bm.onclick = () => { ST.limite += 300; vClientes(); };
}
function formCliente(id) {
  const c = id ? DB.clients.find(x => x.id === id) : { nome: "", fone: "", obs: "" };
  if (!c) return;
  const ps = id ? DB.orders.filter(o => o.cli === id).sort((a, b) => b.data.localeCompare(a.data)) : [];
  abreModal(`<header><h2>${id ? "Cliente" : "Nova cliente"}</h2><button class="close" data-close aria-label="Fechar">×</button></header>
  <div class="body"><div class="fgrid">
    <label class="f full">Nome<input type="text" id="cnome" value="${esc(c.nome)}"></label>
    <label class="f full">WhatsApp<input type="tel" id="cfone" value="${esc(c.fone)}" placeholder="(85) 9…"></label>
    <label class="f full">Observações<textarea id="cobs" placeholder="Preferências, medidas, como gosta da barra…">${esc(c.obs)}</textarea></label></div>
    ${ps.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Histórico (${ps.length})</div><div class="list">${ps.slice(0, 30).map(linhaPedido).join("")}</div></div>` : ""}
  </div>
  <footer>${id && !ps.length ? `<button class="btn danger small" id="cexc">Excluir</button>` : "<span></span>"}<div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="csalvar">Salvar</button></div></footer>`, () => {
    ligaPedidos();
    $("#csalvar").onclick = async e => {
      const nome = $("#cnome").value.trim(); if (!nome) { toast("Informe o nome"); return; }
      const campos = { nome, fone: $("#cfone").value.trim(), obs: $("#cobs").value.trim() };
      if (await acao(e.currentTarget, () => id ? api.atualizar("clientes", id, campos) : api.inserir("clientes", campos), "Cliente salva")) { fechaModal(); render(); }
    };
    const bx = $("#cexc"); if (bx) confirmaDuplo(bx, "Toque de novo para excluir", async () => { if (await acao(bx, () => api.excluir("clientes", id), "Cliente excluída")) { fechaModal(); render(); } });
  });
}

/* =====================================================================
   CAIXA
   ===================================================================== */
function seletorMes() { return `<select id="smes" aria-label="Mês" style="width:auto">${mesesComDados().map(m => `<option value="${m}" ${m === ST.mes ? "selected" : ""}>${nomeMes(m)}</option>`).join("")}</select>`; }
function vCaixa() {
  const ym = ST.mes;
  const ent = DB.orders.flatMap(o => o.pagamentos.map(p => ({ ...p, tipo: "e", desc: `Pedido #${o.num} · ${cliente(o.cli).nome}`, cat: p.forma, ped: o.id }))).filter(p => mesDe(p.data) === ym);
  const sai = DB.despesas.filter(d => mesDe(d.data) === ym).map(d => ({ ...d, tipo: "s" }));
  const taxas = r2(ent.reduce((a, x) => a + (x.taxa || 0), 0));
  const mov = [...ent, ...sai].sort((a, b) => b.data.localeCompare(a.data));
  const te = r2(ent.reduce((a, x) => a + x.valor, 0)), ts = r2(sai.reduce((a, x) => a + x.valor, 0));
  const porForma = {}; ent.forEach(p => porForma[p.forma] = (porForma[p.forma] || 0) + p.valor);
  $("#view").innerHTML = `
  <div class="pagehead"><div><h1>Caixa</h1><p>Dinheiro que entrou e saiu de fato no mês</p></div><div class="toolbar" style="margin:0">${seletorMes()}<button class="btn primary" id="ndesp">+ Lançar despesa</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Entradas</div><div class="v up">${brl(te)}</div><div class="d muted">${Object.entries(porForma).map(([f, v]) => `${esc(f)} ${brl(v)}`).join(" · ") || "—"}</div></div>
    <div class="kpi"><div class="l">Saídas</div><div class="v down">${brl(ts + taxas)}</div><div class="d muted">${taxas ? `inclui ${brl(taxas)} de taxas de cartão` : "despesas lançadas"}</div></div>
    <div class="kpi hero"><div class="l">Saldo do mês</div><div class="v">${brl(te - ts - taxas)}</div></div>
  </div>
  <div class="tablewrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="n">Valor</th></tr></thead><tbody>
  ${mov.map(m => `<tr ${m.tipo === "s" ? `data-desp="${m.id}"` : `data-pedc="${m.ped}"`} style="cursor:pointer"><td class="num">${fmtD(m.data)}</td><td>${esc(m.desc)}</td><td><span class="tag">${esc(m.cat)}</span></td><td class="n" style="color:var(--${m.tipo === "e" ? "ok" : "bad"});font-weight:600">${m.tipo === "e" ? "+" : "−"} ${brl(m.valor)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Sem movimentações neste mês.</td></tr>`}
  </tbody></table></div>
  <p class="hint" style="margin-top:10px">Entradas vêm dos pagamentos registrados nos pedidos. Toque numa despesa para editar ou num recebimento para abrir o pedido.</p>`;
  $("#smes").onchange = e => { ST.mes = e.target.value; vCaixa(); };
  $("#ndesp").onclick = () => formDespesa();
  $$("[data-desp]").forEach(r => r.onclick = () => formDespesa(r.dataset.desp));
  $$("[data-pedc]").forEach(r => r.onclick = () => detalhePedido(r.dataset.pedc));
}
function formDespesa(id) {
  const d = id ? DB.despesas.find(x => x.id === id) : { data: hoje(), desc: "", cat: DB.cats[0] || "Outros", valor: "" };
  if (!d) return;
  const cats = DB.cats.includes(d.cat) ? DB.cats : [...DB.cats, d.cat];
  abreModal(`<header><h2>${id ? "Editar despesa" : "Lançar despesa"}</h2><button class="close" data-close aria-label="Fechar">×</button></header>
  <div class="body"><div class="fgrid">
    <label class="f full">Descrição<input type="text" id="ddesc" value="${esc(d.desc)}" placeholder="Ex.: Conta de energia"></label>
    <label class="f">Categoria<select id="dcat">${cats.map(c => `<option ${c === d.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    <label class="f">Valor (R$)<input type="text" inputmode="decimal" class="input-money" id="dvalor" value="${d.valor === "" ? "" : num2(d.valor)}" placeholder="0,00"></label>
    <label class="f">Data<input type="date" id="ddata" value="${d.data}"></label></div>
    <p class="hint">Material comprado para estoque (linhas, zíperes) entra aqui como despesa. O custo de material por serviço é só uma estimativa para mostrar o lucro de cada serviço.</p></div>
  <footer>${id ? `<button class="btn danger small" id="dexcl">Excluir</button>` : "<span></span>"}<div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="dsalvar">Salvar</button></div></footer>`, () => {
    $("#dsalvar").onclick = async e => {
      const descricao = $("#ddesc").value.trim(), valor = lerValor($("#dvalor").value);
      if (!descricao || !(valor > 0)) { toast("Preencha descrição e valor"); return; }
      const campos = { descricao, valor, categoria: $("#dcat").value, data: $("#ddata").value || hoje() };
      if (await acao(e.currentTarget, () => id ? api.atualizar("despesas", id, campos) : api.inserir("despesas", campos), "Despesa salva")) { fechaModal(); render(); }
    };
    const bx = $("#dexcl"); if (bx) confirmaDuplo(bx, "Toque de novo para excluir", async () => { if (await acao(bx, () => api.excluir("despesas", id), "Despesa excluída")) { fechaModal(); render(); } });
  });
}

/* =====================================================================
   RELATÓRIOS
   ===================================================================== */
function vRelatorios() {
  const ym = ST.mes, r = resumoMes(ym), a = resumoMes(prevMes(ym));
  const dl = (x, y, inv) => { if (!y) return `<span class="muted">sem mês anterior</span>`; const d = (x - y) / Math.abs(y); const bom = inv ? d <= 0 : d >= 0; return `<span class="${bom ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))}</span> <span class="muted">vs. mês anterior</span>`; };
  const pc = {}; DB.despesas.filter(d => mesDe(d.data) === ym).forEach(d => pc[d.cat] = (pc[d.cat] || 0) + d.valor);
  if (r.mat) pc["Material dos serviços (estimado)"] = (pc["Material dos serviços (estimado)"] || 0) + r.mat;
  if (r.taxas) pc["Taxas de cartão"] = r.taxas;
  const pcA = Object.entries(pc).sort((x, y) => y[1] - x[1]), pmax = pcA[0]?.[1] || 1;
  const fechados = mesesComDados().filter(m => m < mesDe(hoje()));
  const media = fechados.length ? fechados.reduce((s, m) => s + resumoMes(m).liq, 0) / fechados.length : r.liq;
  const inv = DB.investimentos.map(i => { const ms = mesesComDados().filter(m => m >= mesDe(i.data)); const acum = ms.reduce((s, m) => s + resumoMes(m).liq, 0); return { ...i, acum, roi: (acum - i.valor) / i.valor, payback: media > 0 ? i.valor / media : Infinity }; });
  // últimos 6 meses
  const ult = []; let m = ym; for (let k = 0; k < 6; k++) { ult.unshift(m); m = prevMes(m); }
  const serie = ult.map(x => ({ m: x, ...resumoMes(x) })); const smax = Math.max(1, ...serie.map(s => Math.max(s.fat, Math.abs(s.liq))));
  $("#view").innerHTML = `
  <div class="pagehead"><div><h1>Relatórios</h1><p>${nomeMes(ym)}</p></div>${seletorMes()}</div>
  <div class="kpis">
    <div class="kpi"><div class="l">Faturamento</div><div class="v">${brl(r.fat)}</div><div class="d">${dl(r.fat, a.fat)}</div></div>
    <div class="kpi"><div class="l">Custos totais</div><div class="v">${brl(r.mat + r.desp + r.taxas)}</div><div class="d">${dl(r.mat + r.desp + r.taxas, a.mat + a.desp + a.taxas, true)}</div></div>
    <div class="kpi hero"><div class="l">Lucro líquido</div><div class="v">${brl(r.liq)}</div><div class="d">margem ${pct(r.margem)}</div></div>
    <div class="kpi"><div class="l">Pedidos · ticket médio</div><div class="v">${r.ped.length} · ${brl(r.ticket)}</div><div class="d">${dl(r.ticket, a.ticket)}</div></div>
  </div>
  <section class="block"><h2>Últimos 6 meses</h2><div class="bars">${serie.map(s => `
    <div class="bar"><span class="lbl">${MESES[+s.m.slice(5) - 1].slice(0, 3)}/${s.m.slice(2, 4)}</span><span class="track"><span class="fill alt" style="width:${s.fat > 0 ? Math.max(2, s.fat / smax * 100) : 0}%;display:block"></span></span><span class="val">${brl(s.fat)}</span></div>
    <div class="bar" style="margin-top:-6px"><span class="lbl hint">lucro</span><span class="track"><span class="fill" style="width:${s.liq > 0 ? Math.max(2, s.liq / smax * 100) : 0}%;display:block"></span></span><span class="val ${s.liq < 0 ? "down" : ""}">${brl(s.liq)}</span></div>`).join("")}
    <p class="hint" style="margin:0">Barra azul: faturamento. Barra dourada: lucro líquido.</p></div></section>
  <div class="grid2">
    <section class="block"><h2>Serviços que mais dão lucro</h2>${barrasServicos(r.ped, "lucro")}</section>
    <section class="block"><h2>Para onde foi o dinheiro</h2><div class="bars">${pcA.length ? pcA.map(([k, v]) => `<div class="bar"><span class="lbl" title="${esc(k)}">${esc(k)}</span><span class="track"><span class="fill alt" style="width:${Math.max(4, v / pmax * 100)}%;display:block"></span></span><span class="val">${brl(v)}</span></div>`).join("") : `<div class="empty">Sem custos no período.</div>`}</div></section>
  </div>
  <section class="block"><h2>Retorno dos investimentos (ROI)</h2>
    <div class="tablewrap"><table><thead><tr><th>Investimento</th><th>Desde</th><th class="n">Valor</th><th class="n">Lucro desde então</th><th class="n">ROI</th><th class="n">Se paga em</th></tr></thead><tbody>
    ${inv.map(i => `<tr><td><strong>${esc(i.nome)}</strong></td><td class="num">${fmtD(i.data)}/${i.data.slice(2, 4)}</td><td class="n">${brl(i.valor)}</td><td class="n">${brl(i.acum)}</td><td class="n" style="color:var(--${i.roi >= 0 ? "ok" : "warn"});font-weight:600">${pct(i.roi)}</td><td class="n">${i.roi >= 0 ? "já se pagou" : isFinite(i.payback) ? "~" + i.payback.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " meses" : "—"}</td></tr>`).join("") || `<tr><td colspan="6" class="empty" style="text-align:left">Nenhum investimento cadastrado${ehAdmin() ? " (cadastre em Configurações)" : ""}.</td></tr>`}
    </tbody></table></div>
    <p class="hint" style="margin-top:10px">Lucro líquido = faturamento dos pedidos do mês − material estimado − despesas − taxas de cartão. ROI = (lucro do ateliê desde a compra − valor investido) ÷ valor investido; negativo significa que ainda não se pagou. ${media > 0 ? `"Se paga em" usa o lucro médio dos meses fechados (${brl(media)}/mês).` : `"Se paga em" só aparece quando o lucro médio dos meses fechados for positivo.`} Atenção: o lucro do ateliê inteiro não é causado só por um investimento; use como referência, não como verdade.</p>
  </section>`;
  $("#smes").onchange = e => { ST.mes = e.target.value; vRelatorios(); };
}

/* =====================================================================
   SERVIÇOS (catálogo)
   ===================================================================== */
function vServicos() {
  const cats = [...new Set(DB.services.map(s => s.cat))].sort((a, b) => a.localeCompare(b));
  $("#view").innerHTML = `
  <div class="pagehead"><div><h1>Serviços e preços</h1><p>Catálogo usado ao lançar pedidos. Mudar um preço aqui não altera pedidos já feitos.</p></div><button class="btn primary" id="nserv">+ Novo serviço</button></div>
  ${cats.length ? cats.map(c => `<section class="block"><h2 style="font-size:18px">${esc(c)}</h2><div class="tablewrap"><table><thead><tr><th>Serviço</th><th class="n">Preço</th><th class="n">Custo material</th><th class="n">Lucro</th><th class="n">Margem</th><th></th></tr></thead><tbody>
    ${DB.services.filter(s => s.cat === c).sort((a, b) => a.nome.localeCompare(b.nome)).map(s => `<tr class="${s.ativo ? "" : "off"}"><td><strong>${esc(s.nome)}</strong>${s.ativo ? "" : ' <span class="tag">inativo</span>'}${s.ativo && !s.custo ? ' <span class="tag" style="color:var(--warn)">sem custo</span>' : ""}</td><td class="n">${brl(s.preco)}</td><td class="n">${brl(s.custo)}</td><td class="n">${brl(s.preco - s.custo)}</td><td class="n">${pct(s.preco ? (s.preco - s.custo) / s.preco : NaN)}</td><td class="n"><button class="btn ghost small" data-sv="${s.id}">Editar</button></td></tr>`).join("")}
  </tbody></table></div></section>`).join("") : `<div class="list"><div class="empty">Nenhum serviço cadastrado ainda. Comece pelos mais comuns: barras, ajustes, zíper.</div></div>`}`;
  $("#nserv").onclick = () => formServico();
  $$("[data-sv]").forEach(b => b.onclick = () => formServico(b.dataset.sv));
}
function formServico(id) {
  const s = id ? DB.services.find(x => x.id === id) : { nome: "", cat: "", preco: "", custo: "", ativo: true };
  if (!s) return;
  const cats = [...new Set(DB.services.map(x => x.cat))];
  abreModal(`<header><h2>${id ? "Editar serviço" : "Novo serviço"}</h2><button class="close" data-close aria-label="Fechar">×</button></header>
  <div class="body"><div class="fgrid">
    <label class="f full">Nome do serviço<input type="text" id="snome" value="${esc(s.nome)}" placeholder="Ex.: Barra de calça simples"></label>
    <label class="f">Categoria<input type="text" id="scat" list="lcats" value="${esc(s.cat)}" placeholder="Ex.: Barras, Ajustes, Zíper"><datalist id="lcats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label class="f">Situação<select id="sativo"><option value="1" ${s.ativo ? "selected" : ""}>Ativo (aparece no pedido)</option><option value="0" ${s.ativo ? "" : "selected"}>Inativo</option></select></label>
    <label class="f">Preço (R$)<input type="text" inputmode="decimal" class="input-money" id="spreco" value="${s.preco === "" ? "" : num2(s.preco)}" placeholder="0,00"></label>
    <label class="f">Custo de material (R$)<input type="text" inputmode="decimal" class="input-money" id="scusto" value="${s.custo === "" ? "" : num2(s.custo)}" placeholder="0,00"><span class="hint">Linha, zíper, botão, elástico… É o que permite calcular o lucro.</span></label></div></div>
  <footer>${id ? `<button class="btn danger small" id="sexc">Excluir</button>` : "<span></span>"}<div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="ssalvar">Salvar</button></div></footer>`, () => {
    $("#ssalvar").onclick = async e => {
      const nome = $("#snome").value.trim(), preco = lerValor($("#spreco").value), custo = lerValor($("#scusto").value);
      if (!nome || isNaN(preco) || preco < 0) { toast("Preencha nome e preço"); return; }
      if (!isNaN(custo) && custo > preco) { toast("O custo está maior que o preço. Confira os valores."); return; }
      const campos = { nome, categoria: $("#scat").value.trim() || "Outros", preco, custo: isNaN(custo) ? 0 : Math.max(0, custo), ativo: $("#sativo").value === "1" };
      if (await acao(e.currentTarget, () => id ? api.atualizar("servicos", id, campos) : api.inserir("servicos", campos), "Serviço salvo")) { fechaModal(); render(); }
    };
    const bx = $("#sexc"); if (bx) confirmaDuplo(bx, "Excluir mesmo? (melhor: inativar)", async () => { if (await acao(bx, () => api.excluir("servicos", id), "Serviço excluído")) { fechaModal(); render(); } });
  });
}

/* =====================================================================
   ADMIN: USUÁRIOS
   ===================================================================== */
async function vUsuarios() {
  $("#view").innerHTML = `<div class="pagehead"><div><div class="eyebrow">Administração</div><h1>Usuários</h1><p>Carregando…</p></div></div>`;
  let perfis;
  try { perfis = await api.perfis(); } catch (e) { $("#view").innerHTML = `<div class="alerta erro">${esc(traduzErro(e).message)}</div>`; return; }
  if (ST.tab !== "usuarios") return;
  $("#view").innerHTML = `
  <div class="pagehead"><div><div class="eyebrow">Administração</div><h1>Usuários</h1><p>Quem pode entrar no sistema</p></div></div>
  <div class="tablewrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Acesso</th><th>Situação</th><th></th></tr></thead><tbody>
  ${perfis.map(u => `<tr><td><strong>${esc(u.nome || "—")}</strong>${u.id === EU.id ? ' <span class="tag">você</span>' : ""}</td><td>${esc(u.email)}</td><td><span class="tag">${u.papel === "admin" ? "Administrador" : "Ateliê"}</span></td><td>${u.ativo ? '<span class="pay done">ativo</span>' : '<span class="pay open">bloqueado</span>'}</td><td class="n"><button class="btn ghost small" data-usr="${u.id}">Editar</button></td></tr>`).join("")}
  </tbody></table></div>
  <div class="note" style="margin-top:14px;display:grid;gap:6px">
    <strong>Como adicionar alguém</strong>
    <span>1. No Supabase: Authentication → Users → Add user → Create new user (e-mail + senha, marque “Auto Confirm User”).</span>
    <span>2. A pessoa aparece aqui como <em>bloqueada</em>. Toque em Editar, dê um nome, escolha o acesso e ative.</span>
    <span><strong>Ateliê</strong>: pedidos, clientes, caixa, relatórios e preços. <strong>Administrador</strong>: tudo isso + usuários, investimentos, categorias, taxas, backup e histórico.</span>
  </div>`;
  $$("[data-usr]").forEach(b => b.onclick = () => {
    const u = perfis.find(x => x.id === b.dataset.usr);
    abreModal(`<header><h2>Editar usuário</h2><button class="close" data-close aria-label="Fechar">×</button></header>
    <div class="body"><div class="fgrid">
      <label class="f full">Nome<input type="text" id="unome" value="${esc(u.nome)}"></label>
      <label class="f">Acesso<select id="upapel"><option value="atelie" ${u.papel === "atelie" ? "selected" : ""}>Ateliê</option><option value="admin" ${u.papel === "admin" ? "selected" : ""}>Administrador</option></select></label>
      <label class="switch" style="align-self:end"><input type="checkbox" id="uativo" ${u.ativo ? "checked" : ""}> Acesso liberado</label>
    </div><p class="hint">${esc(u.email)}. Para trocar a senha de outra pessoa ou excluir a conta, use o painel do Supabase.</p></div>
    <footer><span></span><div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="usalvar">Salvar</button></div></footer>`, () => {
      $("#usalvar").onclick = async e => {
        const campos = { nome: $("#unome").value.trim(), papel: $("#upapel").value, ativo: $("#uativo").checked };
        if (await acao(e.currentTarget, async () => { await api.atualizar("perfis", u.id, campos); if (u.id === EU.id) EU = await api.meuPerfil(EU.id); }, "Usuário atualizado")) {
          fechaModal(); if (!EU.ativo) { telaInativo(); return; } render();
        }
      };
    });
  });
}

/* =====================================================================
   ADMIN: CONFIGURAÇÕES, BACKUP E HISTÓRICO
   ===================================================================== */
function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const csvCel = v => { const s = String(v ?? ""); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = linhas => "﻿" + linhas.map(l => l.map(csvCel).join(";")).join("\r\n");
function vConfig() {
  const ult = DB.cfg.ultimo_backup;
  $("#view").innerHTML = `
  <div class="pagehead"><div><div class="eyebrow">Administração</div><h1>Configurações</h1></div></div>
  <section class="block"><h2>Backup dos dados</h2>
    <div class="note" style="display:grid;gap:10px">
      <span>${ult ? `Último backup: <strong>${new Date(ult).toLocaleString("pt-BR")}</strong>.` : "<strong>Nenhum backup feito ainda.</strong>"} O plano grátis do Supabase não guarda cópias para você: faça um backup por semana e guarde no Google Drive.</span>
      <div class="acoes">
        <button class="btn primary" id="bkjson">Baixar backup completo</button>
        <button class="btn ghost" id="bkped">Planilha de pedidos (CSV)</button>
        <button class="btn ghost" id="bkdesp">Planilha de despesas (CSV)</button>
        <button class="btn ghost" id="bkimp">Restaurar backup…</button>
        <input type="file" id="bkfile" accept="application/json,.json" hidden>
      </div>
    </div></section>
  <div class="grid2">
    <section class="block"><h2>Investimentos <button class="link" id="ninv">+ Adicionar</button></h2>
      <div class="list">${DB.investimentos.map(i => `<div class="row" style="cursor:default"><div class="t">${esc(i.nome)}</div><div class="r">${brl(i.valor)}</div><div class="s">desde ${fmtDC(i.data)}</div><div class="s" style="text-align:right"><button class="link" data-xinv="${i.id}">remover</button></div></div>`).join("") || `<div class="empty">Nenhum investimento.</div>`}</div>
      <p class="hint" style="margin-top:8px">Máquinas, reformas, cursos, anúncios. É a base do cálculo de ROI.</p></section>
    <section class="block"><h2>Categorias de despesa</h2>
      <div class="list">${DB.cats.map(c => `<div class="row" style="cursor:default;grid-template-columns:1fr auto"><div class="t">${esc(c)}</div><button class="link" data-xcat="${esc(c)}">remover</button></div>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="ncat" placeholder="Nova categoria" aria-label="Nova categoria"><button class="btn ghost" id="acat">Adicionar</button></div></section>
  </div>
  <section class="block"><h2>Taxas da maquininha</h2>
    <div class="fgrid" style="max-width:520px">
      <label class="f">Débito (%)<input type="text" inputmode="decimal" id="tdeb" value="${num2(DB.cfg.taxa_debito)}"></label>
      <label class="f">Crédito à vista (%)<input type="text" inputmode="decimal" id="tcre" value="${num2(DB.cfg.taxa_credito)}"></label>
    </div>
    <div style="margin-top:8px"><button class="btn ghost" id="stax">Salvar taxas</button></div>
    <p class="hint">Aplicadas a pagamentos novos em débito/crédito e descontadas do lucro. Pagamentos antigos não mudam.</p></section>
  <section class="block"><h2>Histórico de alterações <button class="link" id="vaud">Carregar</button></h2><div id="aud" class="hint">Mostra quem criou, alterou ou excluiu pedidos, pagamentos, despesas, clientes e preços.</div></section>`;

  $("#bkjson").onclick = async e => {
    const nome = `backup-atelie-${hoje()}.json`;
    const ok = await acao(e.currentTarget, async () => {
      await recarregar();
      const b = { sistema: "atelie-ponto-a-ponto", versao: 1, gerado_em: new Date().toISOString(), ...RAW };
      baixar(nome, JSON.stringify(b, null, 1), "application/json");
      await api.salvarConfig("ultimo_backup", new Date().toISOString());
    }, "Backup baixado: " + nome);
    if (ok) vConfig();
  };
  $("#bkped").onclick = () => {
    const linhas = [["Número", "Cliente", "WhatsApp", "Recebido", "Entrega", "Status", "Serviços", "Total", "Custo material", "Pago", "Falta receber", "Detalhes"]];
    DB.orders.slice().sort((a, b) => a.num - b.num).forEach(o => { const c = cliente(o.cli); linhas.push([o.num, c.nome, c.fone, fmtDC(o.data), fmtDC(o.entrega), STATUS[o.status], o.itens.map(i => `${i.qtd}x ${i.nome}`).join(", "), num2(totalPedido(o)), num2(custoPedido(o)), num2(pagoPedido(o)), num2(saldoPedido(o)), o.detalhes]); });
    baixar(`pedidos-atelie-${hoje()}.csv`, csv(linhas), "text/csv;charset=utf-8"); toast("Planilha de pedidos baixada");
  };
  $("#bkdesp").onclick = () => {
    const linhas = [["Data", "Descrição", "Categoria", "Valor"]];
    DB.despesas.slice().sort((a, b) => a.data.localeCompare(b.data)).forEach(d => linhas.push([fmtDC(d.data), d.desc, d.cat, num2(d.valor)]));
    baixar(`despesas-atelie-${hoje()}.csv`, csv(linhas), "text/csv;charset=utf-8"); toast("Planilha de despesas baixada");
  };
  $("#bkimp").onclick = () => $("#bkfile").click();
  $("#bkfile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let b; try { b = JSON.parse(await f.text()); } catch (err) { toast("Arquivo inválido."); return; }
    if (b.sistema !== "atelie-ponto-a-ponto") { toast("Este arquivo não é um backup deste sistema."); return; }
    abreModal(`<header><h2>Restaurar backup</h2><button class="close" data-close aria-label="Fechar">×</button></header>
      <div class="body"><p>Backup de <strong>${b.gerado_em ? new Date(b.gerado_em).toLocaleString("pt-BR") : "data desconhecida"}</strong> com ${(b.pedidos || []).length} pedidos e ${(b.clientes || []).length} clientes.</p>
      <p class="hint">Os registros do backup são gravados por cima dos que têm o mesmo código. Nada que existe hoje é apagado. Faça um backup do estado atual antes, por segurança.</p></div>
      <footer><span></span><div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="rconf">Restaurar</button></div></footer>`, () => {
      $("#rconf").onclick = async ev => { if (await acao(ev.currentTarget, () => api.importar(b), "Backup restaurado")) { fechaModal(); render(); } };
    });
    e.target.value = "";
  };
  $("#ninv").onclick = () => abreModal(`<header><h2>Novo investimento</h2><button class="close" data-close aria-label="Fechar">×</button></header>
    <div class="body"><div class="fgrid"><label class="f full">O que foi<input type="text" id="inome" placeholder="Ex.: Máquina reta industrial"></label>
    <label class="f">Valor (R$)<input type="text" inputmode="decimal" id="ivalor" placeholder="0,00"></label><label class="f">Data<input type="date" id="idata" value="${hoje()}"></label></div></div>
    <footer><span></span><div style="display:flex;gap:8px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="isalvar">Salvar</button></div></footer>`, () => {
    $("#isalvar").onclick = async e => {
      const nome = $("#inome").value.trim(), valor = lerValor($("#ivalor").value);
      if (!nome || !(valor > 0)) { toast("Preencha nome e valor"); return; }
      if (await acao(e.currentTarget, () => api.inserir("investimentos", { nome, valor, data: $("#idata").value || hoje() }), "Investimento salvo")) { fechaModal(); render(); }
    };
  });
  $$("[data-xinv]").forEach(b => confirmaDuplo(b, "confirmar?", async () => { if (await acao(b, () => api.excluir("investimentos", b.dataset.xinv), "Investimento removido")) render(); }));
  $$("[data-xcat]").forEach(b => confirmaDuplo(b, "confirmar?", async () => { if (await acao(b, () => api.excluir("categorias_despesa", b.dataset.xcat, "nome"), "Categoria removida")) render(); }));
  $("#acat").onclick = async e => {
    const v = $("#ncat").value.trim(); if (!v) return;
    if (await acao(e.currentTarget, () => api.inserir("categorias_despesa", { nome: v, ordem: DB.cats.length + 1 }), "Categoria adicionada")) render();
  };
  $("#stax").onclick = async e => {
    const d = lerValor($("#tdeb").value), c = lerValor($("#tcre").value);
    if (isNaN(d) || isNaN(c) || d < 0 || c < 0 || d > 30 || c > 30) { toast("Taxas devem ficar entre 0 e 30%"); return; }
    if (await acao(e.currentTarget, async () => { await api.salvarConfig("taxa_debito", d); await api.salvarConfig("taxa_credito", c); }, "Taxas salvas")) render();
  };
  $("#vaud").onclick = async e => {
    const bt = e.target; bt.disabled = true;
    try {
      const rows = await api.auditoria();
      const NOMES = { pedidos: "Pedido", pagamentos: "Pagamento", despesas: "Despesa", clientes: "Cliente", servicos: "Serviço", investimentos: "Investimento", perfis: "Usuário", config: "Configuração", categorias_despesa: "Categoria" };
      const ACOES = { insert: "criou", update: "alterou", delete: "excluiu" };
      const resumo = r => { const x = r.depois || r.antes || {}; return x.numero ? "#" + x.numero : x.nome || x.descricao || (x.valor !== undefined && r.tabela === "pagamentos" ? brl(x.valor) : "") || x.chave || x.email || ""; };
      const mud = r => { if (r.acao !== "update" || !r.antes || !r.depois) return ""; return Object.keys(r.depois).filter(k => !["atualizado_em"].includes(k) && JSON.stringify(r.antes[k]) !== JSON.stringify(r.depois[k])).map(k => `${k}: ${esc(r.antes[k] ?? "—")} → ${esc(r.depois[k] ?? "—")}`).join("; "); };
      $("#aud").innerHTML = rows.length ? `<div class="tablewrap"><table class="aud"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead><tbody>${rows.map(r => `<tr><td class="num">${new Date(r.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(r.email || "sistema")}</td><td>${ACOES[r.acao] || r.acao} ${(NOMES[r.tabela] || r.tabela).toLowerCase()} <strong>${esc(resumo(r))}</strong><div class="det">${mud(r)}</div></td></tr>`).join("")}</tbody></table></div>` : "Nada registrado ainda.";
    } catch (err) { toast(traduzErro(err).message, 5000); }
    bt.disabled = false;
  };
}

/* =====================================================================
   INICIALIZAÇÃO
   ===================================================================== */
function atualizaOnline() { $("#offline").hidden = navigator.onLine; }
addEventListener("online", atualizaOnline); addEventListener("offline", atualizaOnline);
/* ao voltar para o app (ex.: celular), recarrega se os dados tiverem mais de 1 minuto */
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !EU || !DB || $("#ov")) return;
  if (Date.now() - carregadoEm < 60000) return;
  try { await recarregar(); if (!$("#ov")) render(); } catch (e) { /* silencioso; próxima ação mostra o erro */ }
});

(function iniciar() {
  atualizaOnline();
  if (!api) { telaSemConfig(); return; }
  api.onAuth((ev) => {
    if (ev === "PASSWORD_RECOVERY") { recuperandoSenha = true; telaNovaSenha(); }
    else if (ev === "USER_UPDATED" && recuperandoSenha) { recuperandoSenha = false; }
    else if (ev === "SIGNED_OUT") { EU = null; DB = null; RAW = null; telaLogin(); }
  });
  iniciarSessao();
})();
