#!/usr/bin/env node
// install.mjs - installe le ou les harnais Hypervibe Team sur ce poste.
//
//   node install.mjs --harness admin|collab|both
//
// Ce que fait le script, dans l'ordre, et rien d'autre :
//   1. lit la clé enregistrée par la fenêtre (jamais d'argument --key : la clé
//      ne passe ni par la conversation, ni par une ligne de commande) ;
//   2. enrôle le siège auprès de hypervibe.fr (activation, jeton de siège) ;
//   3. télécharge l'exemplaire filigrané au nom de l'organisation, vérifie son
//      empreinte, l'extrait à part, le valide ;
//   4. le pose dans la marketplace locale de Claude Code et l'y déclare
//      (known_marketplaces, marketplace.json local, installed_plugins,
//      settings.enabledPlugins), exactement comme l'aurait fait un téléversement
//      manuel dans Claude Desktop.
//
// Si le registre de Claude Code n'a pas la forme attendue (format qui aurait
// changé), le script POSE le zip dans le dossier de téléchargements et rend la
// main avec le mode d'emploi manuel : il ne bricole jamais un format inconnu.
//
// Sortie : une ligne JSON par harnais installé. Jamais de process.exit après
// du réseau (Windows) : process.exitCode.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { inflateRawSync } from "node:zlib";

const API_BASE = process.env.HYPERVIBE_LICENSE_API || "https://hypervibe.fr";
const HV_DIR = path.join(os.homedir(), ".hypervibe");
const SEAT_FILE = path.join(HV_DIR, "team-seat.json");
const CACHE_FILE = path.join(HV_DIR, "team-license.json");
const PLUGINS_DIR = path.join(os.homedir(), ".claude", "plugins");
const MARKET_NAME = "local-desktop-app-uploads";
const MARKET_DIR = path.join(PLUGINS_DIR, "marketplaces", MARKET_NAME);

const resultats = [];
const rendre = (obj) => {
  resultats.push(obj);
  console.log(JSON.stringify(obj));
};

function lireJson(p, defaut = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return defaut; }
}
function ecrireJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
}

// ─── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const idx = args.indexOf("--harness");
const choix = idx >= 0 ? args[idx + 1] : null;
const HARNAIS = choix === "both" ? ["admin", "collab"] : choix === "admin" || choix === "collab" ? [choix] : null;
if (!HARNAIS) {
  console.error("Usage: node install.mjs --harness admin|collab|both");
  process.exitCode = 1;
} else {
  await principal();
}

// ─── Zip : lecture et extraction, en Node pur ────────────────────────────────
function lireArchive(buf) {
  let fin = -1;
  const plancher = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= plancher; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("archive illisible");
  const nombre = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  if (p === 0xffffffff) throw new Error("archive zip64, non geree");
  const entrees = [];
  for (let i = 0; i < nombre; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("repertoire d'archive corrompu");
    const methode = buf.readUInt16LE(p + 10);
    const tailleComp = buf.readUInt32LE(p + 20);
    const lNom = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lComm = buf.readUInt16LE(p + 32);
    const decalage = buf.readUInt32LE(p + 42);
    const nom = buf.toString("utf8", p + 46, p + 46 + lNom);
    entrees.push({ nom, methode, tailleComp, decalage });
    p += 46 + lNom + lExtra + lComm;
  }
  return entrees
    .filter((e) => !e.nom.endsWith("/"))
    .map((e) => {
      if (buf.readUInt32LE(e.decalage) !== 0x04034b50) throw new Error(`entree illisible : ${e.nom}`);
      const lNom = buf.readUInt16LE(e.decalage + 26);
      const lExtra = buf.readUInt16LE(e.decalage + 28);
      const debut = e.decalage + 30 + lNom + lExtra;
      const brut = buf.subarray(debut, debut + e.tailleComp);
      if (e.methode === 0) return { nom: e.nom, contenu: brut };
      if (e.methode === 8) return { nom: e.nom, contenu: inflateRawSync(brut) };
      throw new Error(`compression non geree : ${e.nom}`);
    });
}

function extraire(entrees, destination) {
  for (const e of entrees) {
    if (e.nom.includes("..") || path.isAbsolute(e.nom) || /^[A-Za-z]:/.test(e.nom)) {
      throw new Error(`chemin refuse dans l'archive : ${e.nom}`);
    }
    const cible = path.join(destination, e.nom);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, e.contenu);
  }
}

// ─── Registre Claude Code ────────────────────────────────────────────────────
/**
 * Le registre a-t-il la forme qu'on sait écrire ? On vérifie AVANT de poser
 * quoi que ce soit : un format inconnu = repli manuel, jamais d'écriture à
 * l'aveugle dans les fichiers internes d'un autre logiciel.
 */
function registreCompatible() {
  const installed = lireJson(path.join(PLUGINS_DIR, "installed_plugins.json"), { version: 2, plugins: {} });
  if (installed.version !== 2 || typeof installed.plugins !== "object") return false;
  const known = lireJson(path.join(PLUGINS_DIR, "known_marketplaces.json"), {});
  if (typeof known !== "object" || Array.isArray(known)) return false;
  return true;
}

function declarerPlugin(nom, version, installPath) {
  // 1. La marketplace locale existe (dossier + manifeste + known_marketplaces).
  const manifeste = path.join(MARKET_DIR, ".claude-plugin", "marketplace.json");
  const market = lireJson(manifeste, {
    name: MARKET_NAME,
    version: "1.0.0",
    description: "Locally uploaded plugins",
    owner: { name: "Local User" },
    plugins: [],
  });
  const entree = { name: nom, version, source: `./${nom}` };
  const i = market.plugins.findIndex((p) => p.name === nom);
  if (i >= 0) market.plugins[i] = entree;
  else market.plugins.push(entree);
  ecrireJson(manifeste, market);

  const knownPath = path.join(PLUGINS_DIR, "known_marketplaces.json");
  const known = lireJson(knownPath, {});
  // installLocation n'est pas décoratif : c'est par lui que Claude Code
  // localise la marketplace au chargement. Sans lui, le plugin posé finit en
  // « failed to load : Marketplace not found » (constaté au banc VM, 30/08).
  known[MARKET_NAME] ??= {
    source: { source: "directory", path: MARKET_DIR },
    installLocation: MARKET_DIR,
    lastUpdated: new Date().toISOString(),
  };
  if (!known[MARKET_NAME].installLocation) {
    known[MARKET_NAME].installLocation = MARKET_DIR;
  }
  ecrireJson(knownPath, known);

  // 2. installed_plugins.json (v2).
  const installedPath = path.join(PLUGINS_DIR, "installed_plugins.json");
  const installed = lireJson(installedPath, { version: 2, plugins: {} });
  const cle = `${nom}@${MARKET_NAME}`;
  const maintenant = new Date().toISOString();
  const existante = Array.isArray(installed.plugins[cle]) ? installed.plugins[cle][0] : null;
  installed.plugins[cle] = [{
    scope: "user",
    installPath,
    version,
    installedAt: existante?.installedAt ?? maintenant,
    lastUpdated: maintenant,
  }];
  ecrireJson(installedPath, installed);

  // 3. settings.enabledPlugins : activer, sans toucher au reste du fichier.
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const settings = lireJson(settingsPath, {});
  settings.enabledPlugins = { ...(settings.enabledPlugins || {}), [cle]: true };
  ecrireJson(settingsPath, settings);
}

// ─── Le parcours ─────────────────────────────────────────────────────────────
async function api(route, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API_BASE}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function principal() {
  const cle = lireJson(CACHE_FILE)?.licenseKey;
  if (!cle) {
    return rendre({ ok: false, code: "cle_absente", message: "Aucune clé enregistrée sur ce poste : la fenêtre de saisie n'a pas abouti." });
  }

  // Un siège = une personne/machine, partagé par les deux harnais.
  let seat = lireJson(SEAT_FILE) || {};
  if (!seat.seatUuid) {
    seat = { seatUuid: crypto.randomUUID(), createdAt: new Date().toISOString() };
    ecrireJson(SEAT_FILE, seat);
  }

  for (const harness of HARNAIS) {
    const nom = `hypervibe-team-${harness}`;
    const installPath = path.join(MARKET_DIR, nom);

    if (fs.existsSync(installPath)) {
      rendre({ ok: false, harness, code: "deja_installe", message: `${nom} est déjà installé : c'est /update-hypervibe-team qui le met à jour.` });
      continue;
    }

    // Enrôlement (idempotent : re-rend le même jeton de siège).
    let act;
    try {
      act = await api("/api/team/activate", {
        licenseKey: cle,
        seatUuid: seat.seatUuid,
        harness,
        pluginVersion: "0.0.0",
      });
    } catch {
      rendre({ ok: false, harness, code: "hors_ligne", message: "hypervibe.fr injoignable : réessaie quand le réseau revient." });
      continue;
    }
    if (!act?.ok) {
      rendre({ ok: false, harness, code: act?.code || "activation_refusee", message: act?.message || "Activation refusée." });
      continue;
    }
    if (act.seatToken) {
      const s = lireJson(SEAT_FILE) || {};
      ecrireJson(SEAT_FILE, { ...s, seatToken: act.seatToken });
    }

    // Téléchargement de l'exemplaire filigrané, empreinte vérifiée.
    let dl;
    try {
      dl = await api("/api/team/download", act.seatToken ? { seatToken: act.seatToken, harness } : { licenseKey: cle, seatUuid: seat.seatUuid, harness });
    } catch {
      rendre({ ok: false, harness, code: "hors_ligne", message: "Téléchargement interrompu : réessaie plus tard." });
      continue;
    }
    if (!dl?.ok || !dl.url) {
      rendre({ ok: false, harness, code: dl?.code || "refus", message: dl?.message || "Téléchargement refusé." });
      continue;
    }
    let buf;
    try {
      const res = await fetch(dl.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      if (dl.sha256 && sha !== dl.sha256) throw new Error("empreinte différente de celle annoncée");
    } catch (e) {
      rendre({ ok: false, harness, code: "telechargement_echoue", message: String(e?.message || e) });
      continue;
    }

    // Repli manuel si le registre n'a pas la forme connue.
    if (!registreCompatible()) {
      const depot = path.join(HV_DIR, "updates", `${nom}-${dl.version}.zip`);
      fs.mkdirSync(path.dirname(depot), { recursive: true });
      fs.writeFileSync(depot, buf);
      rendre({
        ok: false, harness, code: "registre_inconnu", zip: depot,
        message: "Le registre des plugins de Claude Code n'a pas la forme attendue. Le zip est prêt : installe-le par Claude Desktop (Personnaliser, Plugins, Téléverser un plugin).",
      });
      continue;
    }

    // Extraction à part, validation, pose, déclaration.
    const extraction = path.join(HV_DIR, "updates", `install-${harness}-${Date.now()}`);
    try {
      extraire(lireArchive(buf), extraction);
      const racines = fs.readdirSync(extraction);
      const source = racines.length === 1 ? path.join(extraction, racines[0]) : extraction;
      const manifest = lireJson(path.join(source, ".claude-plugin", "plugin.json"));
      if (manifest?.name !== nom) throw new Error(`archive inattendue (${String(manifest?.name)})`);
      fs.mkdirSync(path.dirname(installPath), { recursive: true });
      fs.renameSync(source, installPath);
      fs.rmSync(extraction, { recursive: true, force: true });
      declarerPlugin(nom, String(manifest.version || dl.version), installPath);
      rendre({ ok: true, harness, version: String(manifest.version || dl.version), installPath });
    } catch (e) {
      fs.rmSync(extraction, { recursive: true, force: true });
      fs.rmSync(installPath, { recursive: true, force: true });
      rendre({ ok: false, harness, code: "pose_echouee", message: String(e?.message || e) });
    }
  }

  if (resultats.some((r) => !r.ok)) process.exitCode = 1;
}
