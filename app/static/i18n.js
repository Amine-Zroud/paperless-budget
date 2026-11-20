"use strict";
/* Minimal i18n (gettext style): the English text is the key.
   English is the default and the source language; locales/de.js maps English text -> German
   (window.I18N.de). The choice is stored per browser in localStorage ("lang"). */

window.I18N = window.I18N || {};
const LANGS = { en: "English", de: "Deutsch" };
const LOCALES = { en: "en-BE", de: "de-CH" };
let LANG = "en";
try { const l = localStorage.getItem("lang"); if (l in LANGS) LANG = l; } catch {}
const LOCALE = LOCALES[LANG];
try { document.cookie = "lang=" + LANG + "; path=/; max-age=31536000; SameSite=Lax"; } catch {}  // lets the server translate downloads (CSV, backup) too

/** __("English text {name}", {name: "x"}) – {name} placeholders.
 *  Plurals: "{n} item|{n} items" – the first numeric param (or params.n) picks the form (1 = singular). */
function __(key, params) {
  const dict = I18N[LANG] || {};
  let s = dict[key] ?? key;
  if (s.includes("|")) {
    const n = params && (params.n !== undefined ? params.n : Object.values(params).find((v) => typeof v === "number"));
    const forms = s.split("|");
    s = n === 1 ? forms[0] : (forms[1] ?? forms[0]);
  }
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m)) : s;
}

const _norm = (s) => s.replace(/\s+/g, " ").trim();
/** Translates the static HTML below root: text nodes, title / placeholder / aria-label / data-title attributes. */
function applyI18n(root = document) {
  document.documentElement.lang = LANG;
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = __(el.dataset.i18n); });
  if (LANG === "en") return;
  const dict = I18N[LANG] || {};
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && !/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName) && n.nodeValue.trim() ? 1 : 3) });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const m = n.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/), v = dict[_norm(m[2])];
    if (v !== undefined) n.nodeValue = m[1] + v + m[3];
  }
  root.querySelectorAll("[title],[placeholder],[aria-label],[data-title]").forEach((el) => {
    for (const a of ["title", "placeholder", "aria-label", "data-title"]) {
      const v = el.hasAttribute(a) ? dict[_norm(el.getAttribute(a))] : undefined;
      if (v !== undefined) el.setAttribute(a, v);
    }
  });
}

function setLang(l) {
  if (!(l in LANGS) || l === LANG) return;
  try { localStorage.setItem("lang", l); } catch {}
  location.reload();
}

document.addEventListener("change", (e) => { if (e.target.matches?.("select.lang-switch")) setLang(e.target.value); });
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("select.lang-switch").forEach((el) => { el.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join(""); el.value = LANG; });
  applyI18n();
});
