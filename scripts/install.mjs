#!/usr/bin/env node
// install.mjs - installe le ou les harnais Hypervibe Enterprise sur ce poste.
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
// Hypervibe Team s'appelle désormais Hypervibe Enterprise (2.0.0 de cet
// installateur, harnais 2.5.0). Un harnais déjà posé sous l'ancien nom est
// « déjà installé » : c'est sa propre mise à jour qui lui donne le nouveau nom.
// Le siège d'un poste qui en avait déjà un est repris tel quel (jamais un
// second seatUuid), sous l'un ou l'autre nom de fichier.
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
// Les fichiers de poste, sous le nouveau nom ; ceux d'un poste équipé avant la
// 2.5.0 portent l'ancien, et se lisent encore.
const SEAT_FILE = path.join(HV_DIR, "enterprise-seat.json");
const OLD_SEAT_FILE = path.join(HV_DIR, "team-seat.json");
const CACHE_FILE = path.join(HV_DIR, "enterprise-license.json");
const OLD_CACHE_FILE = path.join(HV_DIR, "team-license.json");
const PLUGINS_DIR = path.join(os.homedir(), ".claude", "plugins");
const MARKET_NAME = "local-desktop-app-uploads";
const MARKET_DIR = path.join(PLUGINS_DIR, "marketplaces", MARKET_NAME);
const PREFIXE = "hypervibe-enterprise-";
const ANCIEN_PREFIXE = "hypervibe-team-";

const resultats = [];
const rendre = (obj) => {
  resultats.push(obj);
  console.log(JSON.stringify(obj));
};

function lireJsonOu(p, defaut = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return defaut; }
}
function ecrireJsonPoste(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
}
/** Le siège, sous le nouveau nom d'abord, sinon sous l'ancien. */
const lireSiege = () => lireJsonOu(SEAT_FILE) || lireJsonOu(OLD_SEAT_FILE);
/** Écrit le siège sous le nouveau nom, et sous l'ancien s'il existe (un harnais d'avant ne lit que lui). */
function ecrireSiege(o) {
  ecrireJsonPoste(SEAT_FILE, o);
  if (fs.existsSync(OLD_SEAT_FILE)) ecrireJsonPoste(OLD_SEAT_FILE, o);
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

// >>> déclaration partagée
// Ce bloc est le même, au caractère près, dans l'installateur public (scripts/install.mjs) et dans
// le module de migration des harnais (scripts/license/enterprise-migration.mjs) : une seule façon
// de déclarer un plugin posé dans la marketplace locale, celle que Claude Desktop applique à un
// téléversement. Une recette de l'atelier les compare.
function lireRegistreJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function ecrireRegistreJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Les chemins des registres, depuis le dossier de la marketplace (…/plugins/marketplaces/<m>). */
function registres(mp) {
  const plugins = path.dirname(path.dirname(mp));
  return {
    market: path.basename(mp),
    catalogue: path.join(mp, ".claude-plugin", "marketplace.json"),
    known: path.join(plugins, "known_marketplaces.json"),
    installed: path.join(plugins, "installed_plugins.json"),
    settings: path.join(path.dirname(plugins), "settings.json"),
  };
}

/**
 * Les registres ont-ils la forme qu'on sait écrire ? Vérifié AVANT toute écriture : une forme
 * inconnue, et rien n'est touché (jamais d'écriture à l'aveugle dans les fichiers d'un autre
 * logiciel). Un fichier absent a la forme vide qu'on connaît ; un fichier présent mais illisible
 * n'a pas de forme connue.
 */
export function registreCompatible(mp) {
  const r = registres(mp);
  const lu = (p, defaut) => (fs.existsSync(p) ? lireRegistreJson(p) : defaut);
  const installed = lu(r.installed, { version: 2, plugins: {} });
  if (!installed || installed.version !== 2 || !installed.plugins || typeof installed.plugins !== "object" || Array.isArray(installed.plugins)) return false;
  for (const [, v] of Object.entries(installed.plugins)) if (!Array.isArray(v)) return false;
  const known = lu(r.known, {});
  if (!known || typeof known !== "object" || Array.isArray(known)) return false;
  const settings = lu(r.settings, {});
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  if (settings.enabledPlugins !== undefined && (typeof settings.enabledPlugins !== "object" || Array.isArray(settings.enabledPlugins) || settings.enabledPlugins === null)) return false;
  const catalogue = lu(r.catalogue, { plugins: [] });
  if (!catalogue || !Array.isArray(catalogue.plugins)) return false;
  return true;
}

/**
 * Déclare un plugin posé dans la marketplace locale, comme le fait un téléversement par Claude
 * Desktop : le catalogue de la marketplace (créé s'il manque), known_marketplaces,
 * installed_plugins, settings.enabledPlugins. Le reste de chaque fichier est gardé.
 */
export function declarerPlugin(mp, nom, version, installPath) {
  const r = registres(mp);
  const catalogue = lireRegistreJson(r.catalogue) ?? { name: r.market, version: "1.0.0", description: "Locally uploaded plugins", owner: { name: "Local User" }, plugins: [] };
  const entree = { name: nom, version, source: `./${nom}` };
  const i = catalogue.plugins.findIndex((p) => p?.name === nom);
  if (i >= 0) catalogue.plugins[i] = { ...catalogue.plugins[i], ...entree };
  else catalogue.plugins.push(entree);
  ecrireRegistreJson(r.catalogue, catalogue);

  const known = lireRegistreJson(r.known) ?? {};
  // installLocation n'est pas décoratif : c'est par lui que Claude Code localise la marketplace
  // au chargement (« Marketplace not found » sans lui, constaté au banc le 30/08/2026).
  known[r.market] ??= { source: { source: "directory", path: mp }, installLocation: mp, lastUpdated: new Date().toISOString() };
  if (!known[r.market].installLocation) known[r.market].installLocation = mp;
  ecrireRegistreJson(r.known, known);

  const installed = lireRegistreJson(r.installed) ?? { version: 2, plugins: {} };
  const cle = `${nom}@${r.market}`;
  const maintenant = new Date().toISOString();
  const existante = Array.isArray(installed.plugins[cle]) ? installed.plugins[cle][0] : null;
  installed.plugins[cle] = [{ scope: "user", installPath, version, installedAt: existante?.installedAt ?? maintenant, lastUpdated: maintenant }];
  ecrireRegistreJson(r.installed, installed);

  const settings = lireRegistreJson(r.settings) ?? {};
  settings.enabledPlugins = { ...(settings.enabledPlugins || {}), [cle]: true };
  ecrireRegistreJson(r.settings, settings);
}
// <<< déclaration partagée

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
  // La clé personnelle (jeton hvs_, chemin nominal) ou la clé
  // d'organisation (transition) : la fenêtre a rangé l'une des deux.
  const cle = (lireJsonOu(CACHE_FILE) || lireJsonOu(OLD_CACHE_FILE))?.licenseKey;
  let jeton = lireSiege()?.seatToken || null;
  if (!cle && !jeton) {
    return rendre({ ok: false, code: "cle_absente", message: "Aucune clé enregistrée sur ce poste : la fenêtre de saisie n'a pas abouti." });
  }

  // Un siège = une personne/machine, partagé par les deux harnais, repris tel
  // quel quand le poste en a déjà un (sous l'un ou l'autre nom de fichier).
  let seat = lireSiege() || {};
  if (!seat.seatUuid) {
    seat = { ...seat, seatUuid: crypto.randomUUID(), createdAt: new Date().toISOString() };
  }
  ecrireSiege(seat);

  for (const harness of HARNAIS) {
    const nom = `${PREFIXE}${harness}`;
    const ancienNom = `${ANCIEN_PREFIXE}${harness}`;
    const installPath = path.join(MARKET_DIR, nom);

    if (fs.existsSync(installPath)) {
      rendre({ ok: false, harness, code: "deja_installe", message: `${nom} est déjà installé : c'est /update-hypervibe-enterprise qui le met à jour.` });
      continue;
    }
    // Un harnais posé avant le nouveau nom : il est installé, et c'est sa mise à jour qui le renomme.
    if (fs.existsSync(path.join(MARKET_DIR, ancienNom))) {
      rendre({ ok: false, harness, code: "deja_installe", ancienNom: true, message: `Ce harnais est déjà installé sous son nom d'avant Hypervibe Enterprise : sa mise à jour (/update-hypervibe-enterprise, ou l'ancienne commande sur une version d'avant) lui donne le nouveau nom.` });
      continue;
    }

    // Enrôlement (idempotent : re-rend le même jeton de siège).
    let act;
    try {
      act = await api("/api/enterprise/activate", {
        ...(jeton ? { seatToken: jeton } : { licenseKey: cle }),
        seatUuid: seat.seatUuid,
        harness,
        pluginVersion: "0.0.0",
        pluginName: nom,
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
      ecrireSiege({ ...(lireSiege() || {}), seatToken: act.seatToken });
      jeton = act.seatToken;
    }

    // Téléchargement de l'exemplaire filigrané, empreinte vérifiée.
    let dl;
    try {
      dl = await api("/api/enterprise/download", jeton ? { seatToken: jeton, harness } : { licenseKey: cle, seatUuid: seat.seatUuid, harness });
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
    if (!registreCompatible(MARKET_DIR)) {
      const depot = path.join(HV_DIR, "updates", `${nom}-${dl.version}.zip`);
      fs.mkdirSync(path.dirname(depot), { recursive: true });
      fs.writeFileSync(depot, buf);
      rendre({
        ok: false, harness, code: "registre_inconnu", zip: depot,
        message: "Le registre des plugins de Claude Code n'a pas la forme attendue. Le zip est prêt : installe-le par Claude Desktop (Personnaliser, Plugins, Téléverser un plugin).",
      });
      continue;
    }

    // Extraction à part, validation, pose, déclaration. L'archive porte le nouveau nom ; une
    // version approuvée par l'organisation d'avant la 2.5.0 arrive sous l'ancien, et se pose sous
    // le nom qu'elle porte (elle ne connaît que lui ; sa mise à jour le changera).
    const extraction = path.join(HV_DIR, "updates", `install-${harness}-${Date.now()}`);
    let cible = installPath;
    try {
      extraire(lireArchive(buf), extraction);
      const racines = fs.readdirSync(extraction);
      const source = racines.length === 1 ? path.join(extraction, racines[0]) : extraction;
      const manifest = lireJsonOu(path.join(source, ".claude-plugin", "plugin.json"));
      const posee = manifest?.name === nom || manifest?.name === ancienNom ? manifest.name : null;
      if (!posee) throw new Error(`archive inattendue (${String(manifest?.name)})`);
      cible = path.join(MARKET_DIR, posee);
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.renameSync(source, cible);
      fs.rmSync(extraction, { recursive: true, force: true });
      declarerPlugin(MARKET_DIR, posee, String(manifest.version || dl.version), cible);
      rendre({ ok: true, harness, name: posee, version: String(manifest.version || dl.version), installPath: cible });
    } catch (e) {
      fs.rmSync(extraction, { recursive: true, force: true });
      if (cible && fs.existsSync(cible)) fs.rmSync(cible, { recursive: true, force: true });
      rendre({ ok: false, harness, code: "pose_echouee", message: String(e?.message || e) });
    }
  }

  if (resultats.some((r) => !r.ok)) process.exitCode = 1;
}
