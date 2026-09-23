#!/usr/bin/env node
// ask-key.mjs - tourne DANS la fenêtre ouverte par window.mjs (vrai TTY).
// Saisie masquée de la clé d'accès, validation de forme, écriture directe
// dans ~/.hypervibe : la clé ne passe JAMAIS par la conversation Claude,
// c'est la règle de tout l'écosystème Hypervibe. Deux formes acceptées :
// - la clé d'accès PERSONNELLE (hvs_..., remise à l'invitation, chemin
//   nominal), rangée dans le fichier de siège, là où license.mjs la lit ;
// - la clé d'organisation (HV-TEAM-XXXX-XXXX, transition des postes d'avant
//   les invitations), rangée dans le cache de licence. Elle ne fait plus que
//   ré-activer un poste déjà connu du serveur.
//
// Jusqu'à la 2.2.6, la fenêtre ne reconnaissait que la clé d'organisation :
// la clé personnelle, seul moyen d'ouvrir un poste depuis le 31/08/2026, était
// refusée (ticket du 23/09/2026). D'où `classerCle` et `rangerCle`, exportées
// pour que leur recette tienne les deux formes.
//
// Ce fichier est volontairement autonome (zéro dépendance, zéro import du
// harnais) : le stub s'installe avant tout le reste.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HV_DIR = path.join(os.homedir(), ".hypervibe");
const KEY_REGEX = /^HV-TEAM-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/;
// La forme exacte que produit le serveur (generateSeatToken), la seule qu'il
// reconnaît : en minuscules.
const SEAT_TOKEN_REGEX = /^hvs_[0-9a-f]{48}$/;

/**
 * Ce que la personne a tapé : sa clé personnelle, la clé d'organisation, ou
 * rien de reconnaissable (null). La casse ne compte pas, un copier-coller ou
 * une saisie à la main peut la changer ; chaque clé repart en revanche sous la
 * forme exacte que le serveur attend.
 */
export function classerCle(saisie) {
  const brut = String(saisie ?? "").trim();
  const jeton = brut.toLowerCase();
  if (SEAT_TOKEN_REGEX.test(jeton)) return { type: "personnelle", valeur: jeton };
  const cle = brut.toUpperCase();
  if (KEY_REGEX.test(cle)) return { type: "organisation", valeur: cle };
  return null;
}

function lireJson(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, "utf8"));
  } catch {
    return null;
  }
}

function ecrireJson(fichier, donnees) {
  fs.writeFileSync(fichier, JSON.stringify(donnees, null, 2) + "\n", "utf8");
}

/**
 * Range la clé là où license.mjs la cherche. La clé personnelle va dans le
 * fichier de siège, partagé par les deux harnais : son seatUuid ne change
 * jamais, et il est créé ici s'il manque, pour que le fichier soit complet
 * quel que soit le script qui passe ensuite. La clé d'organisation va dans le
 * cache de licence. Rend le chemin du fichier écrit.
 */
export function rangerCle(dossier, cle) {
  fs.mkdirSync(dossier, { recursive: true });
  if (cle.type === "personnelle") {
    const fichier = path.join(dossier, "team-seat.json");
    const siege = lireJson(fichier) || {};
    const complet = siege.seatUuid
      ? siege
      : { ...siege, seatUuid: crypto.randomUUID(), createdAt: new Date().toISOString() };
    ecrireJson(fichier, { ...complet, seatToken: cle.valeur });
    return fichier;
  }
  const fichier = path.join(dossier, "team-license.json");
  ecrireJson(fichier, { ...(lireJson(fichier) || {}), licenseKey: cle.valeur });
  return fichier;
}

function promptMasked(question) {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (typeof stdin.setRawMode !== "function") {
      return reject(new Error("Pas de terminal interactif pour la saisie masquée."));
    }
    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(buf);
        }
        if (code === 3) {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (code === 8 || code === 127) {
          if (buf.length) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (code < 32) continue;
        buf += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function promptVisible(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

/** Vrai quand la fenêtre lance ce fichier, faux quand une recette l'importe. */
function lanceDirectement() {
  if (!process.argv[1]) return false;
  let lance;
  try {
    lance = fs.realpathSync(process.argv[1]);
  } catch {
    lance = path.resolve(process.argv[1]);
  }
  const ici = fileURLToPath(import.meta.url);
  return process.platform === "win32" ? ici.toLowerCase() === lance.toLowerCase() : ici === lance;
}

if (lanceDirectement()) {
  console.log("─".repeat(60));
  console.log("  Hypervibe Team : ta clé d'accès");
  console.log("─".repeat(60));
  console.log("");
  console.log("  Ta clé d'accès PERSONNELLE commence par hvs_ : elle t'attend");
  console.log("  dans ton espace app.hypervibe.fr, onglet Licence et");
  console.log("  téléchargements. (Les postes d'avant les invitations peuvent");
  console.log("  encore saisir la clé d'organisation HV-TEAM-XXXX-XXXX.)");
  console.log("  La saisie est masquée : c'est normal de voir des étoiles.");
  console.log("");

  let cle = null;
  for (let essai = 0; essai < 3; essai++) {
    cle = classerCle(await promptMasked("  Clé d'accès : "));
    if (cle) break;
    console.log("  Ce n'est pas une clé reconnue. Ta clé personnelle commence par");
    console.log("  hvs_, suivie de 48 caractères : le bouton Copier de ton espace");
    console.log("  la prend en entier. Réessaie.");
  }

  if (!cle) {
    console.log("\n  Trois essais sans clé valide. Relance l'installation quand tu l'as retrouvée.");
    await promptVisible("  Entrée pour fermer... ");
    process.exit(2);
  }

  rangerCle(HV_DIR, cle);

  if (cle.type === "organisation") {
    console.log("\n  Clé d'organisation enregistrée. Elle ne ré-active qu'un poste");
    console.log("  déjà installé : pour un nouveau poste, c'est ta clé personnelle");
    console.log("  (hvs_...) qui compte.");
  } else {
    console.log("\n  Clé personnelle enregistrée sur ce poste.");
  }
  console.log("  Tu peux fermer cette fenêtre, l'installation continue dans Claude Code.");
  setTimeout(() => process.exit(0), 1500);
}
