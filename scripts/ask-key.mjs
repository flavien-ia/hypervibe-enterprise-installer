#!/usr/bin/env node
// ask-key.mjs - tourne DANS la fenêtre ouverte par window.mjs (vrai TTY).
// Saisie masquée de la clé d'accès, validation de forme, écriture directe
// dans ~/.hypervibe : la clé ne passe JAMAIS par la conversation Claude,
// c'est la règle de tout l'écosystème Hypervibe. Deux formes acceptées :
// la clé d'accès PERSONNELLE (hvs_..., remise à l'invitation, chemin
// nominal) et la clé d'organisation (HV-TEAM-XXXX-XXXX, transition des
// postes d'avant les invitations).
//
// Ce fichier est volontairement autonome (zéro dépendance, zéro import du
// harnais) : le stub s'installe avant tout le reste.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const HV_DIR = path.join(os.homedir(), ".hypervibe");
const CACHE_FILE = path.join(HV_DIR, "team-license.json");
const SEAT_FILE = path.join(HV_DIR, "team-seat.json");
const KEY_REGEX = /^HV-TEAM-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/;
const SEAT_TOKEN_REGEX = /^HVS_[0-9A-F]{48}$/;

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
  const brut = (await promptMasked("  Clé de licence : ")).trim().toUpperCase();
  if (KEY_REGEX.test(brut)) {
    cle = brut;
    break;
  }
  console.log("  Ce n'est pas la forme attendue (HV-TEAM-XXXX-XXXX). Réessaie.");
}

if (!cle) {
  console.log("\n  Trois essais sans clé valide. Relance l'installation quand tu l'as retrouvée.");
  await promptVisible("  Entrée pour fermer... ");
  process.exit(2);
}

fs.mkdirSync(HV_DIR, { recursive: true });
let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  /* premier passage */
}
fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...cache, licenseKey: cle }, null, 2));

console.log("\n  Clé enregistrée sur ce poste. Tu peux fermer cette fenêtre,");
console.log("  l'installation continue dans Claude Code.");
setTimeout(() => process.exit(0), 1500);
