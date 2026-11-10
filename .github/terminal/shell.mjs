#!/usr/bin/env node
// Terminal ilustrativo do perfil + dashboard de atividade.
// Executa uma sessão de comandos num filesystem virtual e desenha o terminal (SVG), o dashboard e o README.
//
//   node shell.mjs              -> sessão do dia (Actions)
//   node shell.mjs "git log"    -> renderiza só esse comando (teste; use FIXTURE=dados.json)
// Zero dependências (Node 20+).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { FS, HOME } from "./fs.mjs";
import { fetchActivity, renderDashboard } from "./dashboard.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "Brunoo47/Brunoo47";
const OWNER = REPO.split("/")[0];
const ROOT = new URL("../../", import.meta.url).pathname;
const DATA_FILE = ROOT + ".github/terminal/github.json";
const README = ROOT + "README.md";
const ASSETS = ROOT + "assets/";
const AVATAR = JSON.parse(readFileSync(ROOT + ".github/data/avatar.json", "utf8"));
const COLS = 100, MAX_CMD = 60;

// ════════════════════════════ dados do GitHub ════════════════════════════
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-terminal" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function fetchGithub() {
  if (process.env.FIXTURE) return JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
  const { user: u } = await gql(`query($l:String!){ user(login:$l){
    login name createdAt followers{totalCount}
    repositories(ownerAffiliations:OWNER,isFork:false,first:100,privacy:PUBLIC){ totalCount nodes{ stargazerCount
      languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}} } }
    recent: repositories(ownerAffiliations:OWNER,first:6,orderBy:{field:PUSHED_AT,direction:DESC},privacy:PUBLIC){ nodes{ name
      defaultBranchRef{ target{ ... on Commit { history(first:5){ nodes{ oid messageHeadline committedDate author{ user{ login } } } } } } } } }
    contributionsCollection{ totalCommitContributions restrictedContributionsCount totalPullRequestContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`, { l: OWNER });

  const first = new Date(u.createdAt).getUTCFullYear(), last = new Date().getUTCFullYear(), parts = [];
  for (let y = first; y <= last; y++)
    parts.push(`y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z",to:"${y}-12-31T23:59:59Z"){ totalCommitContributions restrictedContributionsCount }`);
  const years = (await gql(`query($l:String!){ user(login:$l){ ${parts.join(" ")} } }`, { l: OWNER })).user;

  const cc = u.contributionsCollection, days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  let longest = 0, run = 0, current = 0;
  for (const d of days) { run = d.contributionCount ? run + 1 : 0; longest = Math.max(longest, run); }
  for (let i = days.length - 1; i >= 0; i--) { if (days[i].contributionCount) current++; else if (i === days.length - 1) continue; else break; }
  const sum = (n) => days.slice(-n).reduce((s, d) => s + d.contributionCount, 0);

  const lm = new Map();
  for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
    const c = lm.get(e.node.name) || { name: e.node.name, color: e.node.color || "#8b949e", size: 0 };
    c.size += e.size; lm.set(e.node.name, c);
  }
  const tot = [...lm.values()].reduce((s, l) => s + l.size, 0) || 1;
  const langs = [...lm.values()].sort((a, b) => b.size - a.size).slice(0, 6).map((l) => ({ name: l.name, color: l.color, pct: (l.size / tot) * 100 }));

  const commits = u.recent.nodes.flatMap((r) => (r.defaultBranchRef?.target?.history?.nodes || [])
    .filter((c) => c.author?.user?.login === OWNER && !/^(⌨️ terminal|chore: atualiza dashboard|🎮 4 em Linha)|\[bot\]/u.test(c.messageHeadline))
    .map((c) => ({ repo: r.name, sha: c.oid.slice(0, 7), msg: c.messageHeadline, date: c.committedDate })))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return {
    login: u.login, createdAt: u.createdAt, followers: u.followers.totalCount, repos: u.repositories.totalCount,
    stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    total: cc.contributionCalendar.totalContributions, prs: cc.totalPullRequestContributions,
    commitsYear: cc.totalCommitContributions + cc.restrictedContributionsCount,
    commitsAllTime: Object.values(years).reduce((s, y) => s + y.totalCommitContributions + y.restrictedContributionsCount, 0),
    load: [sum(1), sum(7), sum(30)], current, longest,
    weeks: cc.contributionCalendar.weeks.slice(-26).map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0)),
    langs, commits, fetchedAt: new Date().toISOString(),
  };
}

// ════════════════════════════ filesystem virtual ════════════════════════════
const norm = (cwd, p = "") => {
  if (!p || p === "~") return HOME;
  let parts = p.startsWith("/") ? [] : p.startsWith("~") ? HOME.split("/").filter(Boolean) : cwd.split("/").filter(Boolean);
  for (const seg of p.replace(/^~\/?/, "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop(); else parts.push(seg);
  }
  return "/" + parts.join("/");
};
const lookup = (path) => { let node = FS; for (const s of path.split("/").filter(Boolean)) { if (node.type !== "dir" || !node.children[s]) return null; node = node.children[s]; } return node; };
const pretty = (path) => (path === HOME ? "~" : path.startsWith(HOME + "/") ? "~" + path.slice(HOME.length) : path);

// ════════════════════════════ comandos ════════════════════════════
// Cada linha de saída é uma lista de segmentos [texto, cor]. Cores: p g b y r c m w (ou #hex).
const L = (...segs) => segs.map((s) => (typeof s === "string" ? [s, "w"] : s));
const fmt = (n) => Number(n).toLocaleString("pt-BR");
const spark = (arr) => { const bars = "▁▂▃▄▅▆▇█", mx = Math.max(1, ...arr); return arr.map((v) => (v ? bars[Math.min(7, Math.ceil((v / mx) * 7))] : "·")).join(""); };
const bar = (pct, w = 24) => { const f = Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * w)); return "█".repeat(f) + "░".repeat(w - f); };
function since(iso) {
  const a = new Date(iso), b = new Date();
  let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return `${y} ${y === 1 ? "ano" : "anos"}, ${m} ${m === 1 ? "mês" : "meses"}, ${d} ${d === 1 ? "dia" : "dias"}`;
}
const nowBR = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });

const HELP = [
  ["help", "lista os comandos"], ["ls [-la] [dir]", "lista arquivos"], ["cd <dir>", "muda de diretório (a sessão é compartilhada!)"],
  ["cat <arquivo>", "mostra um arquivo"], ["tree", "árvore de diretórios"], ["neofetch", "info do sistema"],
  ["htop", "minhas estatísticas do GitHub ao vivo"], ["git log", "meus últimos commits públicos"],
  ["./contato.sh", "como falar comigo"], ["open <projeto>", "link de um projeto"], ["whoami", "quem é você"],
  ["who", "quem passou por aqui"], ["history", "últimos comandos da sessão"], ["uptime  date  pwd  echo  clear  man", ""],
];

function exec(raw, ctx) {
  const { user, data, state } = ctx;
  const line = raw.trim().slice(0, MAX_CMD);
  const [cmd, ...args] = line.split(/\s+/);
  const flags = args.filter((a) => a.startsWith("-")).join("");
  const pos = args.filter((a) => !a.startsWith("-"));
  const cwd = state.cwd;
  const out = [];

  const lsDir = (path, long) => {
    const node = lookup(path);
    if (!node) return out.push(L([`ls: não foi possível acessar '${pos[0]}': Arquivo ou diretório inexistente`, "r"]));
    if (node.type !== "dir") return out.push(L(pos[0]));
    const names = Object.keys(node.children).filter((n) => flags.includes("a") || !n.startsWith(".")).sort();
    if (long) {
      out.push(L([`total ${names.length * 4}`, "m"]));
      if (flags.includes("a")) { out.push(L(["drwxr-xr-x ", "m"], [`${OWNER.toLowerCase()}  4096  `, "m"], [".", "b"])); out.push(L(["drwxr-xr-x ", "m"], [`${OWNER.toLowerCase()}  4096  `, "m"], ["..", "b"])); }
      for (const n of names) {
        const c = node.children[n], perm = c.type === "dir" ? "drwxr-xr-x" : c.exec ? "-rwxr-xr-x" : "-rw-r--r--";
        const size = c.type === "dir" ? 4096 : (c.lines || []).join("\n").length;
        out.push(L([perm + " ", "m"], [`${OWNER.toLowerCase()}  ${String(size).padStart(4)}  `, "m"], [n + (c.type === "dir" ? "/" : ""), c.type === "dir" ? "b" : c.exec ? "g" : "w"]));
      }
    } else out.push(names.flatMap((n) => { const c = node.children[n]; return [[n + (c.type === "dir" ? "/" : ""), c.type === "dir" ? "b" : c.exec ? "g" : "w"], ["   ", "w"]]; }));
  };

  switch (cmd) {
    case "": break;
    case "help": case "?":
      out.push(L(["Comandos disponíveis:", "p"]));
      for (const [c, d] of HELP) out.push(L(["  " + c.padEnd(26), "g"], [d, "m"]));
      out.push(L(["Dica: clique nos botões abaixo do terminal ou digite qualquer comando.", "m"]));
      break;
    case "ls": case "ll": case "la":
      lsDir(norm(cwd, pos[0] || "."), flags.includes("l") || cmd === "ll"); break;
    case "cd": {
      const target = norm(cwd, pos[0] || "~"), node = lookup(target);
      if (!node) out.push(L([`bash: cd: ${pos[0]}: Arquivo ou diretório inexistente`, "r"]));
      else if (node.type !== "dir") out.push(L([`bash: cd: ${pos[0]}: Não é um diretório`, "r"]));
      else state.cwd = target;
      break;
    }
    case "pwd": out.push(L(cwd)); break;
    case "cat": case "less": case "more": case "bat": {
      if (!pos.length) { out.push(L(["uso: cat <arquivo>", "m"])); break; }
      const p = norm(cwd, pos[0]), node = lookup(p);
      if (!node) out.push(L([`cat: ${pos[0]}: Arquivo ou diretório inexistente`, "r"]));
      else if (node.type === "dir") out.push(L([`cat: ${pos[0]}: É um diretório`, "r"]));
      else out.push(...node.render);
      break;
    }
    case "tree": {
      const walk = (node, prefix) => {
        const names = Object.keys(node.children).filter((n) => !n.startsWith(".")).sort();
        names.forEach((n, i) => {
          const c = node.children[n], lastOne = i === names.length - 1;
          out.push(L([prefix + (lastOne ? "└── " : "├── "), "m"], [n + (c.type === "dir" ? "/" : ""), c.type === "dir" ? "b" : c.exec ? "g" : "w"]));
          if (c.type === "dir") walk(c, prefix + (lastOne ? "    " : "│   "));
        });
      };
      const start = norm(cwd, pos[0] || "."), node = lookup(start);
      if (!node || node.type !== "dir") { out.push(L([`tree: ${pos[0]}: diretório inválido`, "r"])); break; }
      out.push(L([pretty(start), "b"])); walk(node, "");
      break;
    }
    case "neofetch": case "fastfetch": case "screenfetch": {
      const info = [
        [[`${OWNER.toLowerCase()}`, "p"], ["@", "w"], ["github", "p"]],
        [["─".repeat(OWNER.length + 7), "m"]],
        [["OS", "p"], [": Linux", "w"]],
        [["Host", "p"], [": Ultra Lims · Joinville - SC", "w"]],
        [["Kernel", "p"], [": PHP · Slim", "w"]],
        [["Uptime", "p"], [`: ${since(data.createdAt)}`, "w"]],
        [["Shell", "p"], [": bash", "w"]],
        [["IDE", "p"], [": IntelliJ IDEA · VS Code", "w"]],
        [["Backend", "p"], [": PHP · Java · Spring Boot · Python", "w"]],
        [["Frontend", "p"], [": TypeScript · Next.js", "w"]],
        [["Dados", "p"], [": MySQL · PostgreSQL", "w"]],
        [["DevOps", "p"], [": Docker · AWS · Git", "w"]],
        [["Orgs", "p"], [": @ultralims · @NexusGen-Projetos", "w"]],
        [],
        [["Repos", "p"], [`: ${data.repos}   `, "w"], ["Stars", "p"], [`: ${data.stars}   `, "w"], ["Seguidores", "p"], [`: ${data.followers}`, "w"]],
        [["Commits", "p"], [`: ${fmt(data.commitsAllTime)}   `, "w"], ["Streak", "p"], [`: ${data.current}d (recorde ${data.longest}d)`, "w"]],
        [],
        [["███", "#484f58"], ["███", "#f85149"], ["███", "#3fb950"], ["███", "#d29922"], ["███", "#58a6ff"], ["███", "#a78bfa"], ["███", "#39c5cf"], ["███", "#e6edf3"]],
      ];
      const rows = Math.max(AVATAR.rows.length, info.length), off = Math.floor((AVATAR.rows.length - info.length) / 2);
      for (let i = 0; i < rows; i++) {
        const art = (AVATAR.rows[i] || []).map(([ch, c]) => [ch, c || "w"]);
        while (art.length < AVATAR.cols) art.push([" ", "w"]);
        out.push([...art, ["   ", "w"], ...(info[i - Math.max(0, off)] || [])]);
      }
      break;
    }
    case "htop": case "top": case "btop": case "stats": {
      const mx = Math.max(...data.load);
      out.push(L(["  Contribuições  ", "m"], [spark(data.weeks), "g"], ["  últimas 26 semanas", "m"]));
      out.push(L(["  Load average   ", "m"], [`${data.load[0]} ${data.load[1]} ${data.load[2]}`, "y"], ["  (1d · 7d · 30d)", "m"]));
      out.push(L(["  Tasks          ", "m"], [`${data.repos} repos, ${data.stars} ★, ${data.followers} seguidores`, "w"]));
      out.push(L(["  Commits        ", "m"], [`${fmt(data.commitsYear)} no ano · ${fmt(data.commitsAllTime)} no total · ${data.prs} PRs`, "w"]));
      out.push(L(["  Streak         ", "m"], [`${data.current}d atual · recorde ${data.longest}d`, "w"]));
      out.push(L());
      out.push(L(["  PID  LINGUAGEM      USO", "m"]));
      data.langs.forEach((l, i) => out.push(L([`  ${String(i + 1).padStart(3)}  `, "m"], [l.name.padEnd(14), "w"], [bar(l.pct), l.color], [` ${l.pct.toFixed(1).padStart(5)}%`, "c"])));
      if (mx === 0) out.push(L(["  (dica: boa parte do meu trabalho é em repositórios privados)", "m"]));
      break;
    }
    case "git": {
      if (pos[0] === "log") {
        if (!data.commits.length) { out.push(L(["fatal: nenhum commit público recente", "r"])); break; }
        for (const c of data.commits) {
          const d = new Date(c.date).toLocaleDateString("pt-BR");
          out.push(L([c.sha + " ", "y"], [`(${c.repo}) `, "c"], [c.msg.slice(0, 58), "w"], [` · ${d}`, "m"]));
        }
      } else if (pos[0] === "status") out.push(L("On branch master"), L(["nothing to commit, working tree clean", "g"]));
      else if (pos[0] === "clone") out.push(L(["Cloning into '", "w"], [pos[1] || OWNER, "b"], ["'... use: ", "w"], [`git clone https://github.com/${OWNER}/${pos[1] || OWNER}`, "c"]));
      else out.push(L(["uso: git log | git status | git clone <repo>", "m"]));
      break;
    }
    case "./contato.sh": case "contato.sh": case "sh": case "bash": case "contato":
      if (cmd === "sh" || cmd === "bash") { if (!/contato\.sh$/.test(pos[0] || "")) { out.push(L([`${cmd}: ${pos[0] || ""}: Arquivo ou diretório inexistente`, "r"])); break; } }
      out.push(L(["→ ", "g"], ["Abrindo canais de contato...", "w"]));
      out.push(L(["  email   ", "p"], ["brunoostroskiprogramador@gmail.com", "c"]));
      out.push(L(["  github  ", "p"], [`github.com/${OWNER}`, "c"]));
      out.push(L(["  local   ", "p"], ["Joinville - SC, Brasil", "w"]));
      out.push(L(["✔ ", "g"], ["Bora conversar!", "w"]));
      break;
    case "open": case "xdg-open": {
      const projs = lookup(HOME + "/projetos").children, key = (pos[0] || "").replace(/\.md$/, "").replace(/^.*\//, "");
      const p = projs[key + ".md"];
      if (!p) out.push(L(["uso: open <projeto>  →  ", "m"], [Object.keys(projs).map((n) => n.replace(/\.md$/, "")).join("  "), "b"]));
      else out.push(L(["Abrindo ", "w"], [p.url, "c"]));
      break;
    }
    case "whoami": {
      const nth = Object.keys(state.users).indexOf(user) + 1;
      out.push(L([user, "g"], [`  · visitante nº ${nth || Object.keys(state.users).length + 1} deste terminal`, "m"]));
      break;
    }
    case "who": case "w": case "users": {
      const entries = Object.entries(state.users).sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, 10);
      for (const [u, v] of entries) out.push(L([u.padEnd(22), "g"], [`pts/${v.n}`.padEnd(9), "m"], [new Date(v.last).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).padEnd(20), "w"], [`${v.count} comando${v.count > 1 ? "s" : ""}`, "m"]));
      break;
    }
    case "history":
      state.history.slice(-10).forEach((h, i, arr) => out.push(L([String(state.history.length - arr.length + i + 1).padStart(5) + "  ", "m"], [h.cmd.padEnd(28), "w"], [`@${h.user}`, "g"])));
      break;
    case "date": out.push(L(nowBR())); break;
    case "uptime": out.push(L([`up ${since(data.createdAt)}`, "w"], [`,  ${Object.keys(state.users).length} usuários,  load average: `, "m"], [data.load.join(", "), "y"])); break;
    case "echo": out.push(L(args.join(" ").replace(/^["']|["']$/g, "").slice(0, 60))); break;
    case "clear": state.clearAt = state.session.length + 1; break;
    case "man": out.push(L([`${(pos[0] || "man").toUpperCase()}(1)`, "p"], ["  —  manual: digite ", "m"], ["help", "g"], [" para ver o que cada comando faz.", "m"])); break;
    case "exit": case "logout": out.push(L("logout"), L(["Connection to github.com closed. (mas o terminal continua aberto pro próximo visitante)", "m"])); break;
    case "sudo": out.push(L([`[sudo] senha para ${user}: `, "w"]), L([`${user} não está no arquivo sudoers. Este incidente será reportado.`, "r"])); break;
    case "rm": case "mv": case "touch": case "mkdir": case "vim": case "nano": case "chmod":
      out.push(L([`${cmd}: operação não permitida: sistema de arquivos somente leitura`, "r"])); break;
    default:
      out.push(L([`bash: ${cmd}: comando não encontrado`, "r"]));
      out.push(L(["digite ", "m"], ["help", "g"], [" para ver os comandos disponíveis", "m"]));
  }
  return { cmd: line, out };
}

// ════════════════════════════ estado ════════════════════════════
function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { cwd: HOME, session: [], history: [], users: {}, clearAt: 0, seeded: false };
}
function run(state, user, raw, data, issue) {
  const promptCwd = pretty(state.cwd);
  const now = new Date().toISOString();
  if (!state.users[user]) state.users[user] = { n: Object.keys(state.users).length, count: 0, first: now, last: now };
  state.users[user].count++; state.users[user].last = now;
  const r = exec(raw, { user, data, state });
  state.history.push({ user, cmd: r.cmd, at: now });
  state.history = state.history.slice(-200);
  state.session.push({ user, cwd: promptCwd, cmd: r.cmd, out: r.out, at: now, issue });
  if (state.session.length > 40) { const cut = state.session.length - 40; state.session = state.session.slice(cut); state.clearAt = Math.max(0, state.clearAt - cut); }
  return r;
}

// ════════════════════════════ render ════════════════════════════
const C = { p: "#c4b5fd", g: "#7ee787", b: "#79c0ff", y: "#e3b341", r: "#ff7b72", c: "#56d4dd", m: "#8b949e", w: "#e6edf3" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// cores do avatar muito escuras somem no fundo do terminal: clareia mantendo o tom
function lift(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  if (l >= 0.32) return hex;
  const t = Math.min(1, (0.32 - l) / 0.32 * 0.85), g = [118, 108, 160];
  return "#" + c.map((v, i) => Math.round(v + (g[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const color = (k) => C[k] || (k.startsWith("#") ? lift(k) : k);
const BANNER = [
  "██████╗ ██████╗ ██╗   ██╗███╗   ██╗ ██████╗ ",
  "██╔══██╗██╔══██╗██║   ██║████╗  ██║██╔═══██╗",
  "██████╔╝██████╔╝██║   ██║██╔██╗ ██║██║   ██║",
  "██╔══██╗██╔══██╗██║   ██║██║╚██╗██║██║   ██║",
  "██████╔╝██║  ██║╚██████╔╝██║ ╚████║╚██████╔╝",
  "╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ",
];
const prompt = (user, cwd) => [[user.toLowerCase(), "g"], ["@github", "g"], [":", "w"], [cwd, "b"], ["$ ", "w"]];
const segLen = (segs) => segs.reduce((s, [t]) => s + [...t].length, 0);
function clip(segs, max = COLS) {
  const outp = []; let n = 0;
  for (const [t, c] of segs) { const ch = [...t]; if (n + ch.length > max) { outp.push([ch.slice(0, Math.max(0, max - n - 1)).join("") + "…", c]); break; } outp.push([t, c]); n += ch.length; }
  return outp;
}

function renderTerminal(state, data) {
  const FS_ = 13, LH = 17, CW = 7.8, PADX = 22, TOP = 52, MAX_LINES = 40;
  const W = Math.round(PADX * 2 + COLS * CW);

  // monta as linhas: banner fixo + motd + sessão (rolada até o fim) + prompt atual
  const head = [
    ...BANNER.map((b) => [[b, "p"]]),
    [["Full-stack developer · PHP + Slim · Java + Spring · Next.js · Joinville - SC", "m"]],
    [["─".repeat(COLS), "#30363d"]],
  ];
  const visible = state.session.slice(state.clearAt);
  const blocks = visible.map((e, i) => ({ e, lines: [[...prompt(e.user, e.cwd), [e.cmd, "w"]], ...e.out], newest: i === visible.length - 1 }));
  const room = MAX_LINES - head.length - 1;
  let flat = blocks.flatMap((b) => b.lines.map((l, j) => ({ l, newest: b.newest, j, isCmd: j === 0, cmdLen: segLen(prompt(b.e.user, b.e.cwd)), cmdText: b.e.cmd })));
  if (flat.length > room) flat = flat.slice(flat.length - room);
  const pr = { l: [...prompt(OWNER, pretty(state.cwd))], prompt: true };
  const BODY_LINES = head.length + flat.length + 1, H = TOP + BODY_LINES * LH + 10;

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="tt td">`);
  o.push(`<title id="tt">Terminal de ${esc(OWNER)}</title><desc id="td">Sessão compartilhada: último comando "${esc(visible.at(-1)?.cmd || "")}" por ${esc(visible.at(-1)?.user || "")}.</desc>`);
  o.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1320"/><stop offset="1" stop-color="#0a0d14"/></linearGradient>
  <linearGradient id="ban" gradientUnits="userSpaceOnUse" x1="22" y1="0" x2="370" y2="0"><stop offset="0" stop-color="#a78bfa"/><stop offset=".5" stop-color="#c084fc"/><stop offset="1" stop-color="#56d4dd"/></linearGradient></defs>`);
  o.push(`<style>text{font-family:'JetBrains Mono','Fira Code','Cascadia Code','DejaVu Sans Mono',Menlo,Consolas,monospace;font-size:${FS_}px;white-space:pre}</style>`);
  o.push(`<rect width="${W}" height="${H}" rx="12" fill="url(#bg)"/><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#30363d"/>`);
  o.push(`<rect x="1" y="1" width="${W - 2}" height="34" rx="11" fill="#161b22"/><rect x="1" y="24" width="${W - 2}" height="11" fill="#161b22"/><line x1="0" y1="35" x2="${W}" y2="35" stroke="#30363d"/>`);
  o.push(`<circle cx="22" cy="18" r="6" fill="#ff5f57"/><circle cx="42" cy="18" r="6" fill="#febc2e"/><circle cx="62" cy="18" r="6" fill="#28c840"/>`);
  o.push(`<text x="${W / 2}" y="22" text-anchor="middle" fill="#8b949e" style="font-size:12px">${OWNER.toLowerCase()}@github: ${esc(pretty(state.cwd))} — bash — ${COLS}×${BODY_LINES}</text>`);

  const lineXml = (segs, y, attrs = "", inner = "") => `<text x="${PADX}" y="${y}" xml:space="preserve"${attrs}>${clip(segs).map(([t, c]) => `<tspan fill="${color(c)}">${esc(t)}</tspan>`).join("")}${inner}</text>`;
  let y = TOP;
  head.forEach((segs, i) => {
    if (i < BANNER.length) {
      // banner desenhado em "pixels" (não depende da fonte do visitante): █ = bloco cheio, bordas = sombra
      const cells = [...segs[0][0]].map((ch, x) => (ch === "█" ? x : -1)).filter((x) => x >= 0);
      for (const [dx, dy, fill] of [[3, 3, "#2a1f55"], [0, 0, "url(#ban)"]])
        for (const x of cells) o.push(`<rect x="${(PADX + x * CW + dx).toFixed(1)}" y="${y - 13 + dy}" width="${(CW + 0.4).toFixed(1)}" height="${LH + 0.4}" fill="${fill}"/>`);
    }
    else o.push(lineXml(segs, y));
    y += LH;
  });

  // animação: o comando mais novo é "digitado" e a saída aparece em seguida
  const TYPE_MS = 55, START = 400;
  const newestCmd = flat.find((f) => f.newest && f.isCmd);
  const typeDur = newestCmd ? START + [...newestCmd.cmdText].length * TYPE_MS : 0;
  let outIdx = 0;
  for (const f of flat) {
    if (f.newest && f.isCmd) {
      const x0 = PADX + f.cmdLen * CW, wText = Math.max(1, [...f.cmdText].length) * CW;
      o.push(`<clipPath id="type"><rect x="${x0}" y="${y - 14}" width="0" height="20"><animate attributeName="width" from="0" to="${wText + 2}" begin="${START}ms" dur="${typeDur - START}ms" fill="freeze" calcMode="discrete" values="${[...Array([...f.cmdText].length + 1).keys()].map((k) => (k * CW).toFixed(1)).join(";")}"/></rect></clipPath>`);
      o.push(lineXml(prompt(f.l[0][0], f.l[3][0]), y));
      o.push(`<text x="${x0}" y="${y}" xml:space="preserve" clip-path="url(#type)" fill="${C.w}">${esc(f.cmdText)}</text>`);
    } else if (f.newest) {
      const begin = typeDur + 250 + outIdx++ * 35;
      o.push(lineXml(f.l, y, ` opacity="0"`, `<set attributeName="opacity" to="1" begin="${begin}ms" fill="freeze"/>`));
    } else o.push(lineXml(f.l, y));
    y += LH;
  }
  const promptBegin = typeDur + 250 + outIdx * 35 + 150;
  o.push(`<g opacity="${newestCmd ? 0 : 1}">${newestCmd ? `<set attributeName="opacity" to="1" begin="${promptBegin}ms" fill="freeze"/>` : ""}${lineXml(pr.l, y)}`);
  o.push(`<rect x="${PADX + segLen(pr.l) * CW}" y="${y - 12}" width="${CW}" height="15" fill="#c4b5fd"><animate attributeName="opacity" values="1;0;1" dur="1.1s" calcMode="discrete" repeatCount="indefinite"/></rect></g>`);
  o.push(`</svg>`);
  return o.join("\n");
}

function renderKey(label) {
  const CW = 8.4, w = Math.round(28 + [...label].length * CW + 14), h = 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="$ ${esc(label)}">
<style>text{font-family:'JetBrains Mono','Fira Code','DejaVu Sans Mono',Menlo,Consolas,monospace;font-size:14px;white-space:pre}</style>
<rect x="1" y="3" width="${w - 2}" height="${h - 4}" rx="8" fill="#0b0e14"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 6}" rx="8" fill="#161b22" stroke="#30363d"/>
<text x="12" y="21" xml:space="preserve"><tspan fill="#7ee787">$</tspan><tspan fill="#e6edf3"> ${esc(label)}</tspan></text>
</svg>`;
}

function renderReadme(data) {
  return `<!-- Este README é gerado por .github/terminal/shell.mjs — edite o script, não este arquivo. -->
<p align="center">
  <img src="./assets/terminal.svg?v=${Date.parse(data.fetchedAt)}" alt="Terminal do ${OWNER} rodando ${esc(SESSION.at(-1))}" width="100%" />
</p>

<p align="center">
  <img src="./assets/dashboard.svg?v=${Date.parse(data.fetchedAt)}" alt="Dashboard de atividade dos últimos 12 meses, incluindo repositórios privados de forma anonimizada" width="100%" />
</p>

<p align="center"><sub>Gerado todo dia por <a href="./.github/terminal">scripts próprios</a> no GitHub Actions · o comando do terminal muda a cada dia</sub></p>
`;
}

// ════════════════════════════ main ════════════════════════════
// Sessão ilustrativa: um "ls" e depois um comando que muda a cada dia.
const ROTATION = ["neofetch", "cat sobre.md", "git log", "tree", "htop", "cat stack.json"];
const day = Math.floor(Date.now() / 86400e3);
const SESSION = ["ls", ROTATION[day % ROTATION.length]];

let data;
try { data = await fetchGithub(); }
catch (e) { if (!existsSync(DATA_FILE)) throw e; console.warn("usando cache:", e.message); data = JSON.parse(readFileSync(DATA_FILE, "utf8")); }

let activity;
if (process.env.ACTIVITY_FIXTURE) activity = JSON.parse(readFileSync(process.env.ACTIVITY_FIXTURE, "utf8"));
else if (process.env.GITHUB_TOKEN) activity = await fetchActivity(process.env.GITHUB_TOKEN, OWNER);

const state = { cwd: HOME, session: [], history: [], users: {}, clearAt: 0 };
for (const c of (process.argv[2] ? [process.argv[2]] : SESSION)) run(state, OWNER, c, data);

mkdirSync(ASSETS, { recursive: true });
writeFileSync(ASSETS + "terminal.svg", renderTerminal(state, data));
if (activity) writeFileSync(ASSETS + "dashboard.svg", renderDashboard(activity, data.fetchedAt));
writeFileSync(README, renderReadme(data));
writeFileSync(DATA_FILE, JSON.stringify(data, null, 1) + "\n");
console.log("ok:", SESSION.join(" → "));
