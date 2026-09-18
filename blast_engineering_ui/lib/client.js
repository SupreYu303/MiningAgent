// blast-engineering-ui — browser half (the DSH client bundle), v0.4.0-conversation-native.
//
// Conversation-native engineering workspace. The whole surface is DSH's own
// three-column AppFrame; this plugin never covers the conversation or the
// composer:
//
//   ┌ Context Sidebar ─┬─ DSH Conversation (native) ────────────┬─ Preview ─┐
//   │ PROJECT          │ user bubbles / agent answers /         │ report    │
//   │ CASES            │ Think / tool cards / approvals — all   │ plan      │
//   │ DESIGN VERSIONS  │ official @deepseek-ai plugins — plus   │ 3D        │
//   │ THREADS / HISTORY│ BLAST engineering nodes in the turn    │ charge    │
//   │ ARTIFACTS        │ tail (diff / trace / result / links)   │ QC        │
//   └──────────────────┴────────────────────────────────────────┴───────────┘
//                     ↓ native composer: text + dsh-voice-scribe microphone
//
// Slot map — every seat below is declared by an official plugin; the only two
// shadowed seats are the two columns this product owns, each at priority -1:
//
//   sidebar                                single/root    → ContextSidebar
//   details                                single/session → PreviewPane
//   conversation.session.header.utilities   list/session   → SessionStatusChip
//   conversation.composer.dock              list/session   → ComposerDock
//                                                           (change gate + live run)
//   conversation.chat.turnTail              chain/session  → TurnEngineeringBlock
//   conversation.input.right                list/session   → ComposerVoice
//   conversation.hero.brand.mark            single/root    → HeroBrandMark
//                                                           (the approved BS monogram;
//                                                            the shell's own FishLogo is
//                                                            only the fallback here)

//
// Discipline carried over from rounds 1–2 and extended here:
//   * every number comes from the project's own tools through the host half;
//     the browser never computes, interpolates or formats an engineering value;
//   * the first screen carries no absolute path, no task id, no raw JSON and no
//     token/cache accounting — developer material stays in the native
//     conversation's own collapsed Think/tool cards;
//   * the model's private reasoning is never rendered: the engine shows the
//     project's recorded pipeline stages and its own decision summary.
//
// Format contract (see @deepseek-ai/dsh-client-modules): a classic script that
// registers one lazy-CJS factory with the page's module loader. No build step:
// this file IS the shipped bundle.
window.__ModuleLoader__.load({
  id: "blast-engineering-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const prim = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createElement: h } = React;

    // ── Minimal Industrial Intelligence: one cool accent, dividers instead of
    //    cards, 120–260 ms transitions, no gradients / glow / particles.
    const ACCENT = "#6f9fc4";
    const ACCENT_DIM = "rgba(111,159,196,.34)";
    const WARN = "#c9a26b";
    const BAD = "#b8756a";
    const OK = "#7fa88a";
    const LINE = "var(--dsw-alias-border-l1,rgba(255,255,255,.07))";
    const FG = "var(--dsw-alias-label-primary,rgba(255,255,255,.92))";
    const FG2 = "var(--dsw-alias-label-secondary,rgba(255,255,255,.55))";
    const FG3 = "var(--dsw-alias-label-tertiary,rgba(255,255,255,.4))";
    const HOVER = "var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))";
    const BG = "var(--dsw-alias-bg-base,#151619)";

    // ── product identity ────────────────────────────────────────────────────
    // Display copy only: the brand pass changes what the user reads, never an
    // id, a directory name, a config key or a data field. `blast-demo`, the
    // package row, the API prefix and every ledger key stay exactly as they are.
    const BRAND = { name: "BLAST Studio", sub: "钻爆设计与分析工作台" };

    const CSS = [
      // ── shared primitives ────────────────────────────────────────────────
      ".beu{box-sizing:border-box;font-size:13px;line-height:1.45;color:" + FG + "}",
      ".beu *{box-sizing:border-box}",
      ".beu-cap{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:" + FG3 + "}",
      ".beu-meta{font-size:11px;color:" + FG3 + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".beu-h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:" + FG3 + ";margin:16px 0 6px}",
      ".beu-btn{font:inherit;font-size:12px;color:" + FG2 + ";background:none;border:1px solid " + LINE
        + ";border-radius:4px;padding:3px 9px;cursor:pointer;"
        + "transition:background 140ms ease,color 140ms ease,border-color 140ms ease}",
      ".beu-btn:hover:not(:disabled){color:" + FG + ";border-color:rgba(255,255,255,.16);background:" + HOVER + "}",
      ".beu-btn:disabled{opacity:.45;cursor:default}",
      ".beu-btn[data-primary]{color:" + ACCENT + ";border-color:" + ACCENT_DIM + "}",
      ".beu-btn[data-primary]:hover:not(:disabled){color:#8fb8d6;border-color:" + ACCENT + "}",
      ".beu-dot{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.28);flex:none}",
      ".beu-dot[data-tone=ok]{background:" + OK + "}",
      ".beu-dot[data-tone=warn]{background:" + WARN + "}",
      ".beu-dot[data-tone=bad]{background:" + BAD + "}",
      ".beu-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:" + FG2 + ";"
        + "border:1px solid " + LINE + ";border-radius:3px;padding:1px 7px;white-space:nowrap}",
      ".beu-chip[data-tone=warn]{color:" + WARN + ";border-color:rgba(201,162,107,.35)}",
      ".beu-chip[data-tone=ok]{color:" + OK + ";border-color:rgba(127,168,138,.3)}",
      ".beu-chip[data-tone=bad]{color:" + BAD + ";border-color:rgba(184,117,106,.35)}",
      ".beu-chip[data-tone=accent]{color:" + ACCENT + ";border-color:" + ACCENT_DIM + "}",
      "@media (prefers-reduced-motion:reduce){.beu *{transition:none!important;animation:none!important}}",

      // ── left column: Context Sidebar ────────────────────────────────────
      ".beu-side{display:flex;flex-direction:column;height:100%;min-width:0;overflow:hidden}",
      ".beu-side-head{flex:none;padding:14px 12px 10px;border-bottom:1px solid " + LINE + "}",
      ".beu-side-proj{font-size:13px;font-weight:600;letter-spacing:-.01em;margin-top:5px}",
      ".beu-side-body{flex:1;min-height:0;overflow:auto;padding:0 0 10px}",
      ".beu-side-foot{flex:none;display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid " + LINE + "}",
      ".beu-sect{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 12px 5px;color:" + FG3 + "}",
      ".beu-sect:first-child{padding-top:10px}",
      ".beu-sect .beu-link{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:" + FG3 + "}",
      ".beu-row{display:flex;align-items:center;gap:7px;width:100%;background:none;border:none;"
        + "border-left:2px solid transparent;font:inherit;color:" + FG2 + ";text-align:left;cursor:pointer;"
        + "padding:5px 10px 5px 12px;transition:background 160ms ease,color 160ms ease,border-color 160ms ease}",
      ".beu-row:hover{background:" + HOVER + "}",
      ".beu-row[data-active]{color:" + FG + ";border-left-color:" + ACCENT + ";background:rgba(111,159,196,.055)}",
      ".beu-row[data-superseded]{color:" + FG3 + "}",
      ".beu-row-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".beu-row-sub{font-size:11px;color:" + FG3 + ";flex:none;white-space:nowrap}",
      ".beu-row[data-depth='1']{padding-left:22px}",
      ".beu-row[data-depth='2']{padding-left:32px;font-size:12px}",
      ".beu-empty{padding:6px 12px;font-size:12px;color:" + FG3 + ";line-height:1.7}",
      // The rail owns its own width: the shell may collapse the column at the
      // desktop-shell layer (leaving this seat inside a wider surface), so the
      // rail states the 56 px track itself instead of trusting the host box.
      ".beu-side[data-blast-sidebar=\"rail\"]{width:56px;max-width:56px;align-items:center}",
      ".beu-rail{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px 0}",
      ".beu-rail-btn{width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:14px;"
        + "color:" + FG2 + ";background:none;border:1px solid transparent;border-radius:5px;cursor:pointer;"
        + "transition:background 140ms ease,color 140ms ease}",
      ".beu-rail-btn:hover{color:" + FG + ";background:" + HOVER + "}",
      ".beu-rail-mark{font-size:12px;font-weight:600;color:" + ACCENT + ";letter-spacing:.04em}",
    ].join("");

    const CSS_ENG = [
      // ── centre: engineering nodes inside the native thread ──────────────
      ".beu-eng{margin:10px 0 2px;padding:2px 0 2px 12px;border-left:1px solid " + LINE + "}",
      ".beu-eng-body > * + *{margin-top:8px}",
      ".beu-eng-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".beu-eng-title{font-size:12px;color:" + FG2 + "}",
      ".beu-reason{font-size:12px;color:" + FG2 + ";margin-top:6px;max-width:62ch;line-height:1.6}",
      ".beu-diff{margin-top:8px;display:flex;flex-direction:column;gap:5px}",
      ".beu-diff-row{display:flex;align-items:baseline;gap:8px;font-size:12.5px;flex-wrap:wrap}",
      ".beu-diff-field{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:" + FG + ";min-width:16ch}",
      ".beu-diff-from{color:" + FG3 + "}",
      ".beu-diff-arrow{color:" + FG3 + "}",
      ".beu-diff-to{color:" + ACCENT + "}",
      ".beu-steps{margin-top:8px;display:flex;flex-direction:column;gap:3px}",
      ".beu-step{display:flex;align-items:baseline;gap:8px;font-size:12px;color:" + FG2 + "}",
      ".beu-step-mark{flex:none;width:11px;text-align:center;font-size:11px;color:" + FG3 + "}",
      ".beu-step[data-state=done] .beu-step-mark{color:" + OK + "}",
      ".beu-step[data-state=active]{color:" + FG + "}",
      ".beu-step[data-state=active] .beu-step-mark{color:" + WARN + "}",
      ".beu-step[data-state=warn] .beu-step-mark{color:" + WARN + "}",
      ".beu-step-value{margin-left:auto;font-size:11px;color:" + FG3 + ";text-align:right}",
      ".beu-metrics{display:flex;gap:28px;margin-top:10px;flex-wrap:wrap}",
      ".beu-metric{display:flex;flex-direction:column;gap:1px}",
      ".beu-metric-v{font-size:18px;font-variant-numeric:tabular-nums;color:" + FG + "}",
      ".beu-metric-k{font-size:11px;color:" + FG3 + "}",
      ".beu-links{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px}",
      ".beu-link{font:inherit;font-size:12.5px;color:" + FG2 + ";background:none;border:none;"
        + "border-bottom:1px solid transparent;padding:0 0 1px;cursor:pointer;"
        + "transition:color 160ms ease,border-color 160ms ease}",
      ".beu-link:hover{color:" + FG + ";border-bottom-color:rgba(255,255,255,.24)}",
      ".beu-link[data-active]{color:" + ACCENT + ";border-bottom-color:" + ACCENT_DIM + "}",
    ].join("");

    const CSS_SURF = [
      // ── composer dock: the change gate and the live run strip ───────────
      // One bordered card in the native sticky composer stack. The gate is a
      // block inside it, so nothing is drawn twice and nothing floats.
      ".beu-dock{margin:0 auto 6px;width:100%;max-width:748px;padding:10px 12px;border:1px solid " + LINE + ";"
        + "border-radius:6px;background:" + BG + "}",
      ".beu-dock > * + *{margin-top:10px;padding-top:10px;border-top:1px solid " + LINE + "}",
      ".beu-dock-head{display:flex;align-items:center;gap:8px}",
      ".beu-dock .beu-steps{margin-top:6px}",
      ".beu-gate-actions{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}",

      // ── composer voice strip ───────────────────────────────────────────
      ".beu-voice{display:inline-flex;align-items:center;gap:8px;padding:0 4px;font-size:12px;color:" + FG2 + "}",
      ".beu-voice[data-state=listening]{color:" + FG + "}",
      ".beu-mic{font:inherit;font-size:14px;line-height:1;color:" + FG2 + ";background:none;"
        + "border:1px solid transparent;border-radius:5px;padding:4px 6px;cursor:pointer;"
        + "transition:background 140ms ease,color 140ms ease}",
      ".beu-mic:hover{color:" + FG + ";background:" + HOVER + "}",
      ".beu-mic[data-on]{color:" + ACCENT + "}",
      ".beu-level{display:inline-flex;align-items:flex-end;gap:2px;height:12px}",
      ".beu-level i{display:block;width:2px;background:" + ACCENT_DIM + ";border-radius:1px;"
        + "transition:height 120ms linear}",
      ".beu-listening{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:" + ACCENT + "}",
      ".beu-voice-note{font-size:11px;color:" + FG3 + ";max-width:30ch;white-space:nowrap;"
        + "overflow:hidden;text-overflow:ellipsis}",
    ].join("");

    const CSS_PV = [
      // ── right column: Preview Pane ─────────────────────────────────────
      ".beu-pv{display:flex;flex-direction:column;height:100%;min-width:0;overflow:hidden}",
      ".beu-pv-head{flex:none;display:flex;align-items:flex-end;gap:8px;padding:10px 12px 0;"
        + "border-bottom:1px solid " + LINE + "}",
      ".beu-pv-tabs{display:flex;gap:14px;flex:1;min-width:0;overflow:hidden}",
      ".beu-pv-tab{font:inherit;font-size:12.5px;color:" + FG3 + ";background:none;border:none;"
        + "border-bottom:1.5px solid transparent;padding:2px 0 8px;cursor:pointer;white-space:nowrap;"
        + "transition:color 160ms ease,border-color 160ms ease}",
      ".beu-pv-tab:hover{color:" + FG2 + "}",
      ".beu-pv-tab[data-active]{color:" + FG + ";border-bottom-color:" + ACCENT + "}",
      ".beu-pv-body{flex:1;min-height:0;overflow:auto;padding:12px 14px 24px}",
      ".beu-pv-img{display:block;width:100%;height:auto;border:1px solid " + LINE + ";"
        + "border-radius:3px;background:#0e0f11}",
      ".beu-pv-cap{font-size:11px;color:" + FG3 + ";margin-top:6px}",
      ".beu-pv-empty{font-size:12.5px;color:" + FG3 + ";line-height:1.7}",
      ".beu-kv{display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:12px;"
        + "border-bottom:1px solid " + LINE + "}",
      ".beu-kv span{color:" + FG2 + ";flex:1;min-width:0}",
      ".beu-kv b{font-weight:500;color:" + FG + ";font-variant-numeric:tabular-nums}",
      ".beu-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}",
      ".beu-table th{text-align:left;font-weight:500;color:" + FG3 + ";padding:3px 8px 3px 0;"
        + "border-bottom:1px solid " + LINE + "}",
      ".beu-table td{padding:3px 8px 3px 0;color:" + FG2 + ";border-bottom:1px solid " + LINE + "}",
      ".beu-pre{white-space:pre-wrap;word-break:break-word;"
        + "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:" + FG2 + ";margin:6px 0 0}",
      ".beu-dl{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}",
      ".beu-dl a{font-size:12px;color:" + FG2 + ";text-decoration:none;border-bottom:1px solid " + LINE + "}",
      ".beu-dl a:hover{color:" + FG + "}",
    ].join("");

    // ── hero brand mark — the approved BS logo motion (package CSS verbatim) ──
    // Default: the flat blue-gray monogram — no background disc, no standing
    // glow, no idle motion. Hover: one restrained sheen + a 2 px lift, and never
    // a ring. Click: short press → rebound → two rings expanding from the B/S
    // junction plus one very short centre spark, then straight back to default.
    // Only the box size and the gap to the headline are adapted (see CSS_BRAND_HERO).
    const CSS_BRAND = [
      ".bs-logo-button{position:relative;width:250px;height:190px;border:0;background:transparent;"
        + "padding:0;display:grid;place-items:center;cursor:pointer;outline:none;"
        + "-webkit-tap-highlight-color:transparent}",
      ".bs-logo-core{position:relative;width:190px;height:135px;display:grid;place-items:center}",
      ".bs-logo-mark{position:relative;z-index:5;display:flex;align-items:center;color:#a9bdd3;"
        + "font-family:Inter,ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif;"
        + "font-size:126px;font-weight:620;line-height:.78;letter-spacing:-.14em;"
        + "transform:translateY(0) scale(1);user-select:none;"
        + "transition:color 180ms ease,text-shadow 180ms ease,transform 180ms cubic-bezier(.2,.8,.2,1)}",
      ".bs-logo-mark .s{margin-left:-7px}",
      // The pulse origin intentionally sits at the visual B/S junction (51%/52%
      // of the core), never at the geometric centre of the button box.
      ".bs-logo-origin{position:absolute;z-index:3;left:51%;top:52%;width:0;height:0;pointer-events:none}",
      ".bs-logo-pulse{position:absolute;left:0;top:0;width:34px;height:34px;margin-left:-17px;"
        + "margin-top:-17px;border-radius:999px;border:1.5px solid rgba(181,211,241,.72);opacity:0;"
        + "transform:scale(.25);transform-origin:center;pointer-events:none}",
      ".bs-logo-pulse.second{border-color:rgba(181,211,241,.42)}",
      ".bs-logo-spark{position:absolute;left:0;top:0;width:10px;height:10px;margin-left:-5px;margin-top:-5px;"
        + "border-radius:50%;background:rgba(210,230,249,.86);box-shadow:0 0 14px rgba(166,204,241,.45);"
        + "opacity:0;pointer-events:none}",
      ".bs-logo-sheen{position:absolute;z-index:6;width:32px;height:112px;left:20px;top:12px;"
        + "background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);opacity:0;"
        + "filter:blur(1px);transform:translateX(-45px) skewX(-14deg);pointer-events:none}",
      "@media (hover:hover) and (pointer:fine){"
        + ".bs-logo-button:hover .bs-logo-mark{color:#b9cde2;text-shadow:0 0 14px rgba(143,181,220,.10);"
        + "transform:translateY(-2px) scale(1.018)}"
        + ".bs-logo-button:hover .bs-logo-sheen{animation:bsCenterSheen 720ms cubic-bezier(.2,.75,.25,1) both}}",
      ".bs-logo-button.is-down .bs-logo-mark{transform:translateY(1px) scale(.955);transition-duration:75ms}",
      ".bs-logo-button.is-click .bs-logo-mark{animation:bsCenterBounce 430ms cubic-bezier(.16,.86,.28,1) both}",
      ".bs-logo-button.is-click .bs-logo-pulse.first{animation:bsCenterWave1 650ms cubic-bezier(.12,.72,.18,1) both}",
      ".bs-logo-button.is-click .bs-logo-pulse.second{animation:bsCenterWave2 820ms cubic-bezier(.12,.72,.18,1) 85ms both}",
      ".bs-logo-button.is-click .bs-logo-spark{animation:bsCenterSpark 300ms ease-out both}",
      "@keyframes bsCenterSheen{0%{opacity:0;transform:translateX(-45px) skewX(-14deg)}25%{opacity:.38}"
        + "100%{opacity:0;transform:translateX(174px) skewX(-14deg)}}",
      "@keyframes bsCenterBounce{0%{transform:translateY(1px) scale(.955)}"
        + "40%{transform:translateY(-2px) scale(1.038);color:#c5d8ea;text-shadow:0 0 16px rgba(154,193,232,.18)}"
        + "72%{transform:translateY(0) scale(.993)}"
        + "100%{transform:translateY(0) scale(1);color:#a9bdd3;text-shadow:none}}",
      "@keyframes bsCenterWave1{0%{opacity:.80;transform:scale(.25)}28%{opacity:.58}"
        + "100%{opacity:0;transform:scale(5.2)}}",
      "@keyframes bsCenterWave2{0%{opacity:.44;transform:scale(.25)}32%{opacity:.32}"
        + "100%{opacity:0;transform:scale(6.7)}}",
      "@keyframes bsCenterSpark{0%{opacity:0;transform:scale(.35)}24%{opacity:1;transform:scale(1)}"
        + "100%{opacity:0;transform:scale(2.4)}}",
    ].join("");

    // ── hero adaptation (the only sizing/spacing changes to the package) ─────
    // The mark is a supporting brand cue next to the headline, not the subject of
    // the page. Two deliberate numbers keep the shell's geometry EXACTLY as it was
    // with its own mark:
    //   * the cell is 34 px wide (the official brand-mark track) but ZERO tall —
    //     the shell's own mark is 34×25 in a 32 px headline row, so a 34 px-tall
    //     box would make the row 2 px taller and move the home line and the
    //     composer down by 1 px. The mark itself is absolutely positioned and
    //     overflows its cell, which is what the pulse needs anyway;
    //   * the scale keeps the monogram at phone-menu size next to a 26 px
    //     headline, and the gap leaves ~10 px of air, the shell's own column gap.
    // The pulse origin stays at the same 51%/52% of the untouched package core.
    const CSS_BRAND_HERO = [
      ".beu-hero-mark{position:relative;width:34px;height:0;flex:none;"
        + "--bs-hero-scale:.54;--bs-hero-gap:-15px}",
      ".beu-hero-mark .bs-logo-button{position:absolute;left:50%;top:50%;margin:0;pointer-events:none;"
        + "transform:translate(-50%,-50%) translateX(var(--bs-hero-gap)) scale(var(--bs-hero-scale))}",
      // Only the letterforms take the pointer: an invisible 250×190 button box must
      // never swallow a click on the headline sitting next to the mark.
      ".beu-hero-mark .bs-logo-mark{pointer-events:auto}",
      // Keyboard focus only (never on hover): a plain rectangle around the glyphs.
      ".beu-hero-mark .bs-logo-button:focus-visible{outline:none}",
      ".beu-hero-mark .bs-logo-button:focus-visible .bs-logo-mark{outline:1px solid rgba(111,159,196,.55);"
        + "outline-offset:6px}",
      "@media (prefers-reduced-motion:reduce){.bs-logo-button *,.bs-logo-button *::before,"
        + ".bs-logo-button *::after{animation-duration:1ms!important;transition-duration:1ms!important}}",
    ].join("");

    /** Inject the plugin stylesheet once (idempotent across hot reloads). */
    function installCss() {
      if (typeof document === "undefined") return () => {};
      const tagId = "blast-engineering-ui/conversation-native.css";
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return () => {};
      const tag = document.createElement("style");
      tag.dataset.plugin = "blast-engineering-ui";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS + CSS_ENG + CSS_SURF + CSS_PV + CSS_BRAND + CSS_BRAND_HERO;
      document.head.appendChild(tag);
      return () => { try { tag.remove() } catch (error) { /* ignore */ } };
    }

    // ── host API (the plugin's own prefix route; real project data only) ───
    function resolveApiBase() {
      if (typeof globalThis !== "undefined" && typeof globalThis.__BLAST_ENGINEERING_API__ === "string") {
        return globalThis.__BLAST_ENGINEERING_API__;
      }
      if (typeof location !== "undefined" && location.protocol.startsWith("http")) {
        return location.origin + "/blast-engineering-api";
      }
      return "http://127.0.0.1:43120/blast-engineering-api";
    }
    const API_BASE = resolveApiBase();

    function apiGet(path) {
      return fetch(API_BASE + path, { headers: { accept: "application/json" } }).then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status + " " + path);
        return response.json();
      });
    }

    function artifactUrl(taskId, name) {
      return API_BASE + "/artifact?task=" + encodeURIComponent(taskId) + "&name=" + encodeURIComponent(name);
    }

    // ── engineering parameters (names/units copied from the project's own
    //    contract: 51_one_click_end_to_end/one_click_schema.json → input) ──────
    const PARAMS = [
      { field: "shaft_diameter_m", label: "井筒设计直径", unit: "m", speak: ["井筒直径", "设计直径", "井筒设计直径", "直径"] },
      { field: "shaft_depth_m", label: "井筒深度", unit: "m", speak: ["井筒深度", "井深", "深度"] },
      { field: "protodyakonov_f", label: "普氏坚固性系数", unit: "", speak: ["坚固性系数", "普氏", "f 值", "f值"] },
      { field: "planned_advance_mm", label: "计划进尺", unit: "mm", speak: ["计划进尺", "进尺"] },
      { field: "borehole_diameter_mm", label: "炮孔直径", unit: "mm", speak: ["炮孔直径", "孔径", "钎头"] },
      { field: "borehole_depth_mm", label: "炮孔深度", unit: "mm", speak: ["炮孔深度", "孔深"] },
    ];

    const CN_DIGIT = { "零": "0", "一": "1", "二": "2", "两": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };
    const VERB = "改成|改为|设为|设置为|调整到|调整为|变成|换成|修改为|调到|到";
    const DESTRUCTIVE = ["覆盖", "删除", "替换", "作废", "废弃", "冻结", "回滚", "恢复原", "清空", "抹掉"];

    /** "五点五" / "5.5" / "五" → 5.5 / 5 ; null when it is not a number at all. */
    function readNumber(fragment) {
      if (!fragment) return null;
      const text = String(fragment).trim();
      if (/^[0-9]+(\.[0-9]+)?$/.test(text)) return Number(text);
      if (/^[零一二两三四五六七八九点]+$/.test(text)) {
        const digits = text.split("").map((ch) => (ch === "点" ? "." : CN_DIGIT[ch])).join("");
        const value = Number(digits);
        return Number.isFinite(value) ? value : null;
      }
      return null;
    }

    /**
     * Turn a recognised utterance (or a typed instruction) into the structured
     * change it asks for. Nothing is executed here: the caller renders the diff
     * above the composer and waits for a click. `from` values are read from the
     * focused Design Version's own INPUT.json, so the arrow is a real comparison
     * and never a guess.
     */
    function detectImpact(draft) {
      if (typeof draft !== "string" || draft.trim() === "") return null;
      const destructive = DESTRUCTIVE.find((word) => draft.includes(word));
      const changes = [];
      for (const param of PARAMS) {
        for (const trigger of param.speak) {
          const pattern = new RegExp(trigger + "[^0-9零一二两三四五六七八九]{0,6}(?:" + VERB
            + ")[^0-9零一二两三四五六七八九]{0,4}([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九点]{1,8})");
          const plain = new RegExp(trigger + "[^0-9零一二两三四五六七八九]{0,4}([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九点]{1,8})");
          const match = pattern.exec(draft) || plain.exec(draft);
          if (!match) continue;
          const value = readNumber(match[1]);
          if (value === null || !Number.isFinite(value) || value <= 0) continue;
          if (!changes.some((row) => row.field === param.field)) {
            changes.push({ field: param.field, label: param.label, unit: param.unit, to: value });
          }
          break;
        }
      }
      if (changes.length === 0 && !destructive) return null;
      return { kind: destructive ? "destructive" : "new_version", word: destructive || null, changes, draft };
    }

    // ── formatting (display only, never an engineering value) ─────────────
    function fmtBytes(n) {
      if (typeof n !== "number") return "";
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
      return (n / 1024 / 1024).toFixed(1) + " MB";
    }

    function fmtNum(v, digits) {
      if (v === null || v === undefined) return "—";
      if (typeof v !== "number") return String(v);
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(digits === undefined ? 3 : digits).replace(/0+$/, "").replace(/\.$/, "");
    }

    function statusTone(status) {
      if (status === "AUTO_RECOMMENDED") return "ok";
      if (status === "RECOMMENDED_WITH_REVIEW" || status === "CANDIDATE_REFERENCE") return "warn";
      if (status === "BLOCKED_BY_HARD_CONSTRAINT") return "bad";
      return null;
    }

    // The project's own final-status vocabulary plus its Chinese explanation.
    // The code itself is never translated away — the reader keeps seeing the
    // canonical word (`CANDIDATE_REFERENCE`) and, next to it, what it means.
    const STATUS_GLOSS = {
      AUTO_RECOMMENDED: "自动推荐",
      RECOMMENDED_WITH_REVIEW: "推荐但需人工复核",
      CANDIDATE_REFERENCE: "候选参考方案",
      BLOCKED_BY_HARD_CONSTRAINT: "硬约束阻断",
    };

    function statusLabel(status) {
      const gloss = STATUS_GLOSS[status];
      return gloss ? status + " · " + gloss : status;
    }

    function metricValue(version, label) {
      const rows = (version && version.render && version.render.core_metrics) || [];
      const row = rows.find((r) => r && r.label_cn === label);
      return row ? row.value : null;
    }

    function mustState(version, key) {
      const rows = (version && version.render && version.render.must_state) || [];
      return rows.find((r) => r && r.key === key) || null;
    }

    /** The focused version's own INPUT.json values — the real "from" side of a diff. */
    function currentInputs(version) {
      const normalized = (version && version.input && version.input.normalized) || {};
      const out = {};
      for (const param of PARAMS) {
        const value = normalized[param.field];
        if (value !== undefined && value !== null) out[param.field] = value;
      }
      if (out.shaft_diameter_m === undefined && version && version.design_version) {
        out.shaft_diameter_m = version.design_version.diameter_m;
      }
      return out;
    }

    /**
     * Diff rows for the gate and for the in-thread record: field / from → to.
     * A row whose requested value already equals the focused version's own value
     * is NOT a change and is dropped, so the gate can never announce a no-op.
     */
    function buildDiffRows(impact, version) {
      if (!impact || !impact.changes) return [];
      const from = currentInputs(version);
      const rows = [];
      for (const change of impact.changes) {
        const rawFrom = from[change.field];
        if (typeof rawFrom === "number" && rawFrom === change.to) continue;
        const unit = change.unit ? " " + change.unit : "";
        rows.push({
          field: change.field,
          label: change.label,
          from: rawFrom === undefined ? "—" : fmtNum(rawFrom) + unit,
          to: fmtNum(change.to) + unit,
        });
      }
      return rows;
    }

    // The engineering trace is the pipeline's OWN stage vocabulary, grouped into
    // the six engineering steps the product brief asks for. Stage keys come from
    // the project contract (`one_click_schema.json → pipeline_stages`) via
    // AGENT_RESULT.json; nothing here invents progress.
    const TRACE_STEPS = [
      { id: "input", name: "Input validation", cn: "输入校验", stages: ["input_validation"], detail: "硬约束与单位口径" },
      { id: "recommend", name: "Parameter recommendation", cn: "参数推荐", stages: ["phase6", "rbr_validation"], detail: "Phase 6 / RBR 证据域" },
      { id: "geometry", name: "Geometry design", cn: "几何设计", stages: ["canonical_geometry", "geometry_generation"], detail: "规范几何 + 布孔生成" },
      { id: "charge", name: "Charge design", cn: "装药设计", stages: ["charge_recommender", "joint_calibration", "charge_structure"], detail: "装药推荐 / 联合标定 / 装药结构" },
      { id: "qc", name: "Engineering QC", cn: "工程 QC", stages: ["unified_qc"], detail: "统一 QC + 一致性校验" },
      { id: "artifacts", name: "Artifact rendering", cn: "图件与报告", stages: ["cad_export", "charge_drawings"], detail: "CAD 平面/三维 + 装药图" },
    ];
    const TRACE_ORDER = ["plan", "3d", "charge", "qc", "report"];

    function stepState(step, stages, running, activeIndex) {
      if (!running && stages) {
        const values = step.stages.map((key) => stages[key]).filter((v) => v !== undefined);
        if (values.length === 0) return { state: "pending", value: "—" };
        const bad = values.find((v) => typeof v === "string" && /FAIL|BLOCKED|ERROR/.test(v));
        if (bad) return { state: "warn", value: String(bad) };
        const review = values.find((v) => typeof v === "string" && /REVIEW|WARNING|RESOLVED/.test(v));
        return { state: "done", value: String(review || values[0]) };
      }
      if (!running) return { state: "pending", value: "—" };
      const index = TRACE_STEPS.indexOf(step);
      if (activeIndex === -1) return { state: "pending", value: "待执行" };
      if (index < activeIndex) return { state: "done", value: "已完成" };
      if (index === activeIndex) return { state: "active", value: "进行中" };
      return { state: "pending", value: "待执行" };
    }

    /** Map the adapter's live STATUS.stage word onto the six trace steps. */
    function activeStepIndex(stage) {
      const key = String(stage || "").toUpperCase();
      if (key.includes("INPUT")) return 0;
      if (key.includes("PHASE6") || key.includes("RBR")) return 1;
      if (key.includes("GEOMETRY")) return 2;
      if (key.includes("PIPELINE") || key.includes("RUN")) return 2;
      if (key.includes("CHARGE")) return 3;
      if (key.includes("QC")) return 4;
      if (key.includes("OUTPUT")) return 5;
      return -1;
    }

    // ── the engine store: one focused case, one focused Design Version, one
    //    preview target. Nothing here is a UI-local invention — every field is
    //    filled from the project's own ledger / canonical result.
    const ARTIFACT_LINKS = [
      { key: "plan", label: "平面布孔图", kind: "plan", fallback: "FINAL_PLAN.png" },
      { key: "3d", label: "3D炮孔布置", kind: "3d", fallback: "FINAL_3D_PREVIEW.png" },
      { key: "charge", label: "装药结构", kind: "charge", fallback: "CHARGE_STRUCTURE.png" },
      { key: "qc", label: "工程QC", kind: "qc", fallback: "ENGINEERING_QC.json" },
      { key: "report", label: "设计报告", kind: "report", fallback: "ONE_CLICK_REPORT.md" },
    ];

    /** One artifact name → the preview renderer that fits it. */
    function previewKindFor(name) {
      const upper = String(name || "").toUpperCase();
      if (upper.startsWith("FINAL_PLAN")) return "plan";
      if (upper.startsWith("FINAL_3D")) return "3d";
      if (upper.startsWith("CHARGE_STRUCTURE")) return "charge";
      if (upper === "ENGINEERING_QC.JSON") return "qc";
      if (upper === "ONE_CLICK_REPORT.MD") return "report";
      return "artifact";
    }

    function findArtifact(version, matcher) {
      const rows = (version && version.artifacts) || [];
      return rows.find((a) => matcher(String(a.name))) || null;
    }

    /**
     * The canonical artifact list of one version: five kinds first (the output
     * package ships the same drawing as png/svg/pdf/dxf — showing it four times
     * helps nobody), then every remaining file by its own name.
     */
    function artifactRows(version) {
      const rows = [];
      const canonical = [];
      for (const artifact of ((version && version.artifacts) || [])) {
        const kind = previewKindFor(artifact.name);
        if (kind === "artifact") {
          rows.push({ kind, name: artifact.name, fileKind: artifact.kind, count: 1 });
          continue;
        }
        const seen = canonical.find((row) => row.kind === kind);
        if (seen) { seen.count += 1; continue; }
        canonical.push({ kind, name: artifact.name, fileKind: artifact.kind, count: 1 });
      }
      canonical.sort((a, b) => TRACE_ORDER.indexOf(a.kind) - TRACE_ORDER.indexOf(b.kind));
      return canonical.concat(rows);
    }

    const initialState = {
      status: "idle",                 // manifest load state
      error: null,
      manifest: null,
      caseId: null,
      taskId: null,
      version: null,
      versionStatus: "idle",
      versionError: null,
      validation: null,
      validationStatus: "idle",
      activity: null,                 // newest real task of the focused case (live)
      stages: null,
      stagesTask: null,
      preview: null,                  // { kind, name, taskId }
      previewOpen: false,             // mirrors ctx.layout's details panel
      sidebarNative: false,           // true while the left column is DSH's own
      showAllThreads: false,
      revision: 0,
    };
    let state = Object.assign({}, initialState);
    const listeners = new Set();

    function setState(patch) {
      state = Object.assign({}, state, patch, { revision: state.revision + 1 });
      listeners.forEach((fn) => {
        try { fn() } catch (error) { console.error("blast-engineering-ui: listener failed", error) }
      });
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function useEngine() {
      return React.useSyncExternalStore(subscribe, () => state, () => state);
    }

    /** Client services captured at apply() time (never read from a render path). */
    const services = { slots: null, locale: null, layout: null, sessions: null, workspaces: null, conversation: null };

    let manifestRequest = null;
    function loadManifest(force) {
      if (manifestRequest && !force) return manifestRequest;
      setState({ status: "loading", error: null });
      manifestRequest = apiGet("/manifest")
        .then((manifest) => {
          const cases = manifest.cases || [];
          const caseRow = cases.find((c) => c.case_id === state.caseId)
            || cases.find((c) => c.case_id === manifest.focus_case)
            || cases[0] || null;
          const versions = (caseRow && caseRow.versions) || [];
          const keep = state.taskId && versions.find((v) => v.task_id === state.taskId);
          const pick = keep || versions.find((v) => v.primary) || versions[0] || null;
          setState({
            status: "ready",
            manifest,
            caseId: caseRow ? caseRow.case_id : null,
            taskId: pick ? pick.task_id : null,
            version: null,
            versionStatus: pick ? "loading" : "idle",
          });
          if (pick) loadVersion(pick.task_id, false);
          resolvePendingChanges();
          return manifest;
        })
        .catch((error) => {
          setState({ status: "error", error: String(error.message || error) });
          return null;
        })
        .finally(() => { manifestRequest = null; });
      return manifestRequest;
    }

    let versionNonce = 0;
    function loadVersion(taskId, refresh) {
      const nonce = ++versionNonce;
      setState({ taskId, versionStatus: "loading", versionError: null });
      return apiGet("/version?task=" + encodeURIComponent(taskId) + (refresh ? "&refresh=1" : ""))
        .then((version) => {
          if (nonce !== versionNonce) return version;
          setState({ version, versionStatus: "ready", versionError: null });
          loadStages(taskId);
          return version;
        })
        .catch((error) => {
          if (nonce !== versionNonce) return null;
          setState({ version: null, versionStatus: "error", versionError: String(error.message || error) });
          return null;
        });
    }

    function loadStages(taskId) {
      if (!taskId || state.stagesTask === taskId) return Promise.resolve(null);
      return apiGet("/stages?task=" + encodeURIComponent(taskId))
        .then((payload) => { setState({ stages: payload, stagesTask: taskId }); return payload })
        .catch(() => { setState({ stages: null, stagesTask: taskId }); return null });
    }

    /**
     * Poll the newest real task of the focused case. While one is running the
     * live execution dock shows the pipeline's own stage word; the moment it
     * finishes the ledger is refreshed so the new Design Version lands in the
     * left column and the result summary replaces the trace.
     */
    /** Claim the running task for any record whose change matches it (pure data). */
    function claimRunningTask(caseId, latest) {
      if (!latest || typeof latest.task_id !== "string") return;
      let changed = false;
      for (const [sessionId, record] of records) {
        if (!record.change || record.taskId) continue;
        const wanted = record.change.changes && record.change.changes[0];
        if (!wanted) continue;
        if (record.caseId && caseId && record.caseId !== caseId) continue;
        if (String(latest.diameter_m) !== String(wanted.to)) continue;
        if (String(latest.stamp || "") <= stampOf(record.parentTaskId)) continue;
        records.set(sessionId, Object.assign({}, record, {
          taskId: latest.task_id,
          resultTurn: record.resultTurn === undefined ? record.maxTurn : record.resultTurn,
        }));
        changed = true;
      }
      if (changed) recordListeners.forEach((fn) => {
        try { fn() } catch (error) { console.error("blast-engineering-ui: record listener failed", error) }
      });
    }

    function loadActivity(caseId) {
      if (!caseId) return Promise.resolve(null);
      return apiGet("/activity?case=" + encodeURIComponent(caseId))
        .then((payload) => {
          const previous = state.activity;
          const latest = payload && payload.latest;
          const wasRunning = Boolean(previous && previous.latest && previous.latest.running);
          setState({ activity: payload });
          // The ledger row exists from the moment the run starts, so the run's own
          // task is claimed WHILE the turn is still live — that is what lets the
          // engineering node mount in this turn instead of after it went idle.
          claimRunningTask(caseId, latest);
          if (wasRunning && latest && !latest.running && latest.has_package) {
            // The run just finished: refresh the ledger, then focus the Design
            // Version it produced (real ledger data, never a fabricated result).
            loadManifest(true).then(() => {
              if (state.taskId !== latest.task_id) loadVersion(latest.task_id, false);
            });
          }
          return payload;
        })
        .catch(() => { setState({ activity: null }); return null });
    }

    let validationNonce = 0;
    function loadValidation(taskId, refresh) {
      if (!taskId) return Promise.resolve(null);
      const nonce = ++validationNonce;
      setState({ validationStatus: "loading" });
      return apiGet("/validate?task=" + encodeURIComponent(taskId) + (refresh ? "&refresh=1" : ""))
        .then((result) => {
          if (nonce !== validationNonce) return result;
          setState({ validation: result, validationStatus: "ready" });
          return result;
        })
        .catch(() => {
          if (nonce !== validationNonce) return null;
          setState({ validation: null, validationStatus: "error" });
          return null;
        });
    }

    // ── per-session engineering record ──────────────────────────────────────
    // A Thread is a real DSH session. The engine keeps one small, honest record
    // per session: the change this session's instruction asked for, the Design
    // Version the ledger produced from it, and the highest turn number seen (so
    // the in-thread engineering block sits at the bottom of that thread).
    const records = new Map();
    const recordListeners = new Set();

    function recordOf(sessionId) {
      return sessionId ? (records.get(sessionId) || null) : null;
    }

    function setRecord(sessionId, patch) {
      if (!sessionId) return;
      const next = Object.assign({ gate: null, change: null, taskId: null, caseId: null,
        parentTaskId: null, submittedAt: 0, maxTurn: 0, note: null }, records.get(sessionId) || {}, patch);
      records.set(sessionId, next);
      recordListeners.forEach((fn) => {
        try { fn() } catch (error) { console.error("blast-engineering-ui: record listener failed", error) }
      });
    }

    function subscribeRecords(fn) {
      recordListeners.add(fn);
      return () => recordListeners.delete(fn);
    }

    function useRecord(sessionId) {
      return React.useSyncExternalStore(subscribeRecords, () => recordOf(sessionId), () => recordOf(sessionId));
    }

    function stampOf(taskId) {
      const match = /^T(\d{8}_\d{6})/.exec(String(taskId || ""));
      return match ? match[1] : "";
    }

    /**
     * Bind a session's approved change to the Design Version the ledger actually
     * produced: the newest real run of that case with the requested diameter and
     * a stamp strictly newer than the parent version's. Nothing is guessed — an
     * unbound record simply stays unbound and no result is shown for it.
     */
    function resolvePendingChanges() {
      const manifest = state.manifest;
      if (!manifest) return;
      let changed = false;
      for (const [sessionId, record] of records) {
        if (!record.change || record.taskId) continue;
        const caseRow = (manifest.cases || []).find((c) => c.case_id === record.caseId);
        if (!caseRow) continue;
        const wanted = record.change.changes && record.change.changes[0];
        if (!wanted) continue;
        const parentStamp = stampOf(record.parentTaskId);
        const hit = (caseRow.versions || []).find((v) => String(v.diameter_m) === String(wanted.to)
          && String(v.stamp || "") > parentStamp);
        if (!hit) continue;
        // Pin the turn the result belongs to: the run's own turn is the newest one
        // at the moment the ledger answers with the produced version.
        records.set(sessionId, Object.assign({}, record, {
          taskId: hit.task_id,
          resultTurn: record.resultTurn === undefined ? record.maxTurn : record.resultTurn,
        }));
        changed = true;
      }
      if (changed) recordListeners.forEach((fn) => {
        try { fn() } catch (error) { console.error("blast-engineering-ui: record listener failed", error) }
      });
    }

    // ── navigation (left column → centre thread / right preview) ───────────
    function selectCase(caseId) {
      const manifest = state.manifest;
      if (!manifest) return;
      const caseRow = (manifest.cases || []).find((c) => c.case_id === caseId);
      if (!caseRow) return;
      const versions = caseRow.versions || [];
      const same = state.version && state.version.case_id === caseId
        && versions.find((v) => v.task_id === state.taskId);
      const pick = same || versions.find((v) => v.primary) || versions[0] || null;
      setState({ caseId, version: null, activity: null, stages: null, stagesTask: null,
        versionStatus: pick ? "loading" : "idle", validation: null, validationStatus: "idle" });
      if (pick) loadVersion(pick.task_id, false);
      loadActivity(caseId);
      resolvePendingChanges();
    }

    function selectVersion(caseId, taskId) {
      setState({ caseId, stages: null, stagesTask: null, validation: null, validationStatus: "idle" });
      loadVersion(taskId, false);
    }

    function openSession(sessionId) {
      const sessions = services.sessions;
      if (!sessions || !sessionId) return false;
      try { sessions.open(sessionId); return true } catch (error) { return false }
    }

    function startSession(workspaceId) {
      const workspaces = services.workspaces;
      if (!workspaces) return false;
      try { workspaces.startSession(workspaceId); return true } catch (error) { return false }
    }

    /** The preview pane switch: never navigates, never opens a page. */
    function showPreview(kind, name, taskId) {
      if (taskId && taskId !== state.taskId) loadVersion(taskId, false);
      setState({ preview: { kind, name: name || null, taskId: taskId || state.taskId },
        previewOpen: true });
      const layout = services.layout;
      if (layout) { try { layout.openDetails() } catch (error) { /* ignore */ } }
    }

    function closePreview() {
      setState({ previewOpen: false });
      const layout = services.layout;
      if (layout) { try { layout.closeDetails() } catch (error) { /* ignore */ } }
    }

    function toggleSidebarPanel() {
      const layout = services.layout;
      if (layout) { try { layout.toggleSidebar() } catch (error) { /* ignore */ } }
    }

    // ── voice layer ─────────────────────────────────────────────────────────
    // STT stays exactly where round 1 put it: `dsh-voice-scribe` records and the
    // LOCAL SenseVoice model on the DSH host transcribes — no browser speech
    // recognition, nothing leaves the machine. Voice is an INPUT MODE of the
    // native composer; this layer only mirrors that plugin's state, meters the
    // microphone for the level bars, and speaks the project's own whitelisted
    // conclusion script through the local speechSynthesis.
    const voiceState = {
      state: "idle",        // idle | listening | transcribing | speaking | interrupted
      note: null,
      muted: false,
      auto: false,          // auto read-aloud on a finished version: OFF by default
      level: 0,
      bands: [],
      transcript: "",
      interruptedAt: 0,
    };
    let voiceSnapshot = Object.assign({}, voiceState);
    const voiceListeners = new Set();

    function voiceSet(patch) {
      Object.assign(voiceState, patch);
      voiceSnapshot = Object.assign({}, voiceState);
      voiceListeners.forEach((fn) => {
        try { fn() } catch (error) { console.error("blast-engineering-ui: voice listener failed", error) }
      });
    }

    function subscribeVoice(fn) {
      voiceListeners.add(fn);
      return () => voiceListeners.delete(fn);
    }

    const useVoice = () => React.useSyncExternalStore(subscribeVoice, () => voiceSnapshot, () => voiceSnapshot);

    function speechSupported() {
      return typeof window !== "undefined" && !!window.speechSynthesis
        && typeof window.SpeechSynthesisUtterance === "function";
    }

    function pickVoice() {
      if (!speechSupported()) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      const zh = voices.filter((v) => /zh|Chinese|Huihui|Kangkang|Yaoyao/i.test((v.lang || "") + " " + (v.name || "")));
      return zh[0] || voices[0] || null;
    }

    function voiceStop(fromInterrupt) {
      if (speechSupported()) {
        try { window.speechSynthesis.cancel() } catch (error) { /* ignore */ }
      }
      voiceSet({
        state: fromInterrupt ? "interrupted" : "idle",
        interruptedAt: fromInterrupt ? Date.now() : voiceState.interruptedAt,
        note: fromInterrupt ? "已停止朗读，开始识别" : null,
      });
      if (fromInterrupt) {
        setTimeout(() => { if (voiceState.state === "interrupted") voiceSet({ state: "idle" }) }, 1400);
      }
    }

    /** Speak the project's own whitelisted script (never the conversation). */
    function voiceSpeakScript(script, label) {
      if (!speechSupported() || voiceState.muted || !script || !script.text) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(script.text);
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = (voice && voice.lang) || "zh-CN";
        utterance.rate = 1.0;
        utterance.onend = () => { if (voiceState.state === "speaking") voiceSet({ state: "idle" }) };
        utterance.onerror = () => { if (voiceState.state === "speaking") voiceSet({ state: "idle" }) };
        voiceSet({ state: "speaking", note: label ? "正在朗读：" + label : null });
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        voiceSet({ state: "idle", note: "朗读失败：" + error.message });
      }
    }

    let speakRequest = null;
    function voiceSpeakVersion(taskId, label) {
      if (!taskId || !speechSupported() || voiceState.muted) return;
      if (speakRequest === taskId && voiceState.state === "speaking") return;
      speakRequest = taskId;
      apiGet("/voice?task=" + encodeURIComponent(taskId))
        .then((script) => voiceSpeakScript(script, label || "方案结论"))
        .catch((error) => voiceSet({ state: "idle", note: "朗读失败：" + error.message }));
    }

    // Microphone metering for the level bars. A short-lived capture stream of our
    // own is used only while `dsh-voice-scribe` is recording and released
    // immediately after, so the level shown is a real microphone RMS.
    let micStream = null;
    let audioCtx = null;
    let analyser = null;
    let meterRaf = null;
    const bandBuffer = new Uint8Array(32);

    function stopMeter() {
      if (meterRaf !== null) { cancelAnimationFrame(meterRaf); meterRaf = null; }
      if (micStream) {
        micStream.getTracks().forEach((track) => { try { track.stop() } catch (error) { /* ignore */ } });
        micStream = null;
      }
      if (audioCtx) {
        try { audioCtx.close() } catch (error) { /* ignore */ }
        audioCtx = null;
      }
      analyser = null;
      voiceSet({ level: 0, bands: [] });
    }

    function startMeter() {
      if (meterRaf !== null || typeof navigator === "undefined" || !navigator.mediaDevices) return;
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        micStream = stream;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        const time = new Uint8Array(analyser.fftSize);
        let floor = 0.004;
        let frame = 0;
        const tick = () => {
          meterRaf = requestAnimationFrame(tick);
          if (!analyser) return;
          frame += 1;
          if (frame % 3 !== 0) return;   // ~20 Hz is plenty for level bars
          analyser.getByteTimeDomainData(time);
          let sum = 0;
          for (let i = 0; i < time.length; i += 1) {
            const value = (time[i] - 128) / 128;
            sum += value * value;
          }
          const rms = Math.sqrt(sum / time.length);
          floor = Math.max(0.002, Math.min(0.05, floor * 0.995 + rms * 0.005));
          analyser.getByteFrequencyData(bandBuffer);
          const bands = [];
          for (let i = 0; i < 8; i += 1) bands.push(bandBuffer[i * 3] / 255);
          voiceSet({ level: Math.max(0, Math.min(1, (rms - floor) / 0.22)), bands });
        };
        tick();
      }).catch((error) => voiceSet({ note: "麦克风电平不可用：" + error.message }));
    }

    /**
     * Mirror `dsh-voice-scribe`'s own status line (the only signal it publishes in
     * this harness) and implement speak-to-interrupt: the moment a new recording
     * starts, playback is cancelled.
     */
    function installVoiceMirror() {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
      let timer = null;
      const sync = () => {
        timer = null;
        const text = (document.body && document.body.innerText) || "";
        const listening = text.includes("录音中");
        const busy = text.includes("转写中") || text.includes("润色中") || text.includes("处理中");
        if (listening && voiceState.state === "speaking") voiceStop(true);
        if (voiceState.state === "interrupted" && Date.now() - voiceState.interruptedAt < 1400) return;
        if (listening) {
          if (voiceState.state !== "listening") voiceSet({ state: "listening", note: null });
          startMeter();
          return;
        }
        if (busy) {
          if (voiceState.state !== "transcribing") voiceSet({ state: "transcribing" });
          stopMeter();
          return;
        }
        if (voiceState.state === "listening" || voiceState.state === "transcribing") {
          stopMeter();
          voiceSet({ state: "idle" });
        }
      };
      const schedule = () => { if (timer === null) timer = setTimeout(sync, 150); };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      schedule();
      return () => {
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        stopMeter();
      };
    }

    /** scribe's own composer microphone button, when the harness renders it. */
    function scribeMicButton() {
      if (typeof document === "undefined") return null;
      return Array.from(document.querySelectorAll("button")).find((candidate) => {
        const label = (candidate.getAttribute("aria-label") || "") + (candidate.title || "");
        return /语音输入|录音中/.test(label);
      }) || null;
    }

    /**
     * Voice never captures audio itself: it presses what `dsh-voice-scribe`
     * publishes — its microphone button when mounted, or the plugin's documented
     * Alt hotkey (tap to start, tap again to stop) otherwise.
     */
    function toggleScribeMic() {
      if (typeof document === "undefined") return "no-mic-button";
      const button = scribeMicButton();
      if (button) { button.click(); return "button" }
      const target = document.activeElement || document.body;
      const options = { key: "Alt", code: "AltLeft", keyCode: 18, which: 18, altKey: true, bubbles: true, cancelable: true };
      try {
        target.dispatchEvent(new KeyboardEvent("keydown", options));
        target.dispatchEvent(new KeyboardEvent("keyup", options));
        return "alt-hotkey";
      } catch (error) {
        return "no-mic-button";
      }
    }

    // ── the ONE execution path ──────────────────────────────────────────────
    // A confirmed change is written into the CURRENT session's own composer (the
    // documented service face `conversation.input.shell(sessionId)`) and submitted
    // there, so the work happens inside the same Thread the user is reading. No
    // other code path calls setDraft/submit, and nothing runs on detection.
    const INSTRUCTION_MARK = "BLAST 工程指令";

    function composerShell(sessionId) {
      const conversation = services.conversation;
      if (!conversation || !conversation.input || !sessionId) return null;
      try { return conversation.input.shell(sessionId) || null } catch (error) { return null }
    }

    function buildInstruction(record) {
      const rows = (record.diffRows || []).map((row) => row.label + "（" + row.field + "）从 " + row.from + " 改为 " + row.to);
      const parentClause = record.parentDiameter === null || record.parentDiameter === undefined
        ? "父版本请用 blast_engine 的 list_tasks / task_status 从本项目真实台账中取该案例最新的已完成任务。"
        : "父版本请用 blast_engine 的 list_tasks / task_status 从本项目真实台账中确认，取该案例中井筒设计直径为 "
          + fmtNum(record.parentDiameter) + " m 的那个已完成设计版本，并把它的 task_id 作为 parent_task_id。";
      return INSTRUCTION_MARK + "\n"
        + "用户原话：" + (record.draft || "") + "\n"
        + "请执行：以上述改动为本轮唯一变更，为案例 " + (record.caseId || "(当前案例)")
        + " 新建一个设计版本并重算。" + parentClause
        + "其余参数沿用父版本的真实输入（INPUT.json），不要改动它们。"
        + "计算完成后用简短工程结论汇报，并引用 artifacts。\n变更：" + rows.join("；");
    }

    /** The only function that submits work; it runs from a click, never on detection. */
    function sendConfirmedChange(sessionId, record, inputActions) {
      const text = buildInstruction(record);
      const actions = inputActions && typeof inputActions.setDraft === "function" ? inputActions : null;
      // The confirmation line is a transient receipt, not a permanent caption.
      const note = (message) => {
        voiceSet({ state: "idle", note: message });
        setTimeout(() => { if (voiceState.note === message) voiceSet({ note: "" }) }, 8000);
      };
      if (actions) {
        try {
          actions.setDraft(text);
          note(VOICE_TEXT.processing + "已交给当前会话执行");
          setTimeout(() => {
            try { if (typeof actions.submit === "function") actions.submit() } catch (error) { /* ignore */ }
          }, 80);
          return true;
        } catch (error) { /* fall through to the service face */ }
      }
      if (!sessionId) return false;
      const shell = composerShell(sessionId);
      if (!shell || typeof shell.setDraft !== "function") {
        voiceSet({ note: "找不到当前会话的输入框，无法发送" });
        return false;
      }
      shell.setDraft(text);
      note(VOICE_TEXT.processing + "已交给当前会话执行");
      setTimeout(() => {
        try { shell.submit() } catch (error) { voiceSet({ note: "未找到发送通道，请手动按回车" }) }
      }, 80);
      return true;
    }

    // ── shared engineering renderers (gate, live dock, in-thread record) ────
    /** Parameter Diff Node: `shaft_diameter_m  5.0 m → 5.5 m`. */
    function DiffRows(props) {
      const rows = props.rows || [];
      if (!rows.length) return null;
      return h("div", { className: "beu-diff", "data-parameter-diff": "1" },
        rows.map((row) => h("div", { className: "beu-diff-row", key: row.field, "data-field": row.field },
          h("span", { className: "beu-diff-field" }, row.field),
          h("span", { className: "beu-diff-from" }, row.from),
          h("span", { className: "beu-diff-arrow" }, "→"),
          h("span", { className: "beu-diff-to" }, row.to))));
    }

    /** Engineering Trace Node: the pipeline's own stages, never a fake progress bar. */
    function TraceSteps(props) {
      const running = Boolean(props.running);
      const stages = props.stages || null;
      const activeIndex = running ? activeStepIndex(props.stage) : -1;
      return h("div", { className: "beu-steps", "data-engineering-trace": running ? "running" : "recorded" },
        TRACE_STEPS.map((step) => {
          const stepInfo = stepState(step, stages, running, activeIndex);
          const mark = stepInfo.state === "done" ? "✓"
            : stepInfo.state === "active" ? "●"
              : stepInfo.state === "warn" ? "!" : "○";
          return h("div", { className: "beu-step", key: step.id, "data-step": step.id, "data-state": stepInfo.state },
            h("span", { className: "beu-step-mark" }, mark),
            h("span", null, step.name + " · " + step.cn),
            h("span", { className: "beu-step-value" }, stepInfo.value));
        }));
    }

    /** Result Summary Node: real numbers, straight from `render.core_metrics`. */
    function MetricTriple(props) {
      const version = props.version;
      if (!version) return null;
      const rows = [
        { k: "炮孔总数", v: fmtNum(metricValue(version, "炮孔总数")) },
        { k: "总装药量", v: fmtNum(metricValue(version, "推荐总装药量（kg）")) + " kg" },
        { k: "单位耗药量", v: fmtNum(metricValue(version, "单位炸药消耗量（kg/m³）")) + " kg/m³" },
      ];
      return h("div", { className: "beu-metrics", "data-result-summary": "1" },
        rows.map((row) => h("div", { className: "beu-metric", key: row.k },
          h("span", { className: "beu-metric-v" }, row.v),
          h("span", { className: "beu-metric-k" }, row.k))));
    }

    /** Neutral final status / confidence / review chip row (never a repainted block). */
    function StatusChips(props) {
      const version = props.version;
      if (!version) return null;
      const canonical = version.canonical || {};
      const status = (canonical.status && canonical.status.final) || "—";
      const confidence = (canonical.confidence && canonical.confidence.overall) || "—";
      const review = mustState(version, "review_required");
      return h("div", { className: "beu-chips" },
        h("span", { className: "beu-chip", "data-tone": statusTone(status) || undefined, "data-final-status": status },
          h("span", { className: "beu-dot", "data-tone": statusTone(status) || undefined }), statusLabel(status)),
        h("span", { className: "beu-chip", "data-tone": confidence === "LOW" ? "warn" : undefined },
          "Confidence " + confidence),
        review ? h("span", { className: "beu-chip", "data-tone": review.value === true ? "warn" : "ok" },
          review.value === true ? "需要人工复核" : "无需人工复核") : null);
    }

    /** Artifact Links Node: five light text links, never five big buttons. */
    function ArtifactLinks(props) {
      const engine = useEngine();
      const taskId = props.taskId || engine.taskId;
      return h("div", { className: "beu-links", "data-artifact-links": "1" },
        ARTIFACT_LINKS.map((link) => h("button", {
          key: link.key,
          type: "button",
          className: "beu-link",
          "data-artifact-link": link.key,
          "data-active": engine.preview && engine.preview.kind === link.kind ? "1" : undefined,
          onClick: () => showPreview(link.kind, null, taskId),
        }, link.label)));
    }

    // ── left column: Context Sidebar ────────────────────────────────────────
    // PROJECT → CASES → DESIGN VERSIONS → THREADS / HISTORY → ARTIFACTS.
    // Rows are text, hierarchy is indentation and whitespace; the current row is
    // marked with a 2 px accent line only. THREADS are REAL DSH sessions, and
    // clicking one opens it — the centre column is the native conversation.
    function normPath(value) {
      return String(value || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
    }

    function samePath(a, b) {
      return Boolean(a && b) && normPath(a) === normPath(b);
    }

    // Sessions that are obviously developer instruments are hidden from the demo
    // list by default — never deleted, never rewritten; one click shows them all.
    const THREAD_NOISE = /\bprobe\b|\bsmoke\b|\bacceptance\b|\bselftest\b|\be2e\b|^\[(probe|test)\]/i;

    function sessionLabel(row) {
      return row.title || row.displayTitle || "(未命名会话)";
    }

    /** PROJECT → …  section heading, with an optional right-hand hint. */
    function Section(props) {
      return h("div", { className: "beu-sect" },
        h("span", null, props.label),
        props.hint ? h("span", null, props.hint) : null);
    }

    function Row(props) {
      return h("button", {
        type: "button",
        className: "beu-row",
        "data-depth": props.depth === undefined ? undefined : String(props.depth),
        "data-active": props.active ? "1" : undefined,
        "data-superseded": props.superseded ? "1" : undefined,
        title: props.title || undefined,
        onClick: props.onClick,
        ...(props.data || {}),
      },
        props.dotTone ? h("span", { className: "beu-dot", "data-tone": props.dotTone }) : null,
        h("span", { className: "beu-row-label" }, props.label),
        props.sub ? h("span", { className: "beu-row-sub" }, props.sub) : null);
    }

    function ContextSidebar(props) {
      const engine = useEngine();
      const collapsed = Boolean(props && props.collapsed);
      const useSessions = props && props.useSessions;
      const useWorkspaces = props && props.useWorkspaces;
      const sessionsSnap = typeof useSessions === "function" ? useSessions((snapshot) => snapshot) : null;
      const workspacesSnap = typeof useWorkspaces === "function" ? useWorkspaces((snapshot) => snapshot) : null;

      React.useEffect(() => {
        if (engine.status === "idle") loadManifest(false);
      }, [engine.status]);

      if (collapsed) {
        return h("div", { className: "beu beu-side", "data-blast-sidebar": "rail" },
          h("div", { className: "beu-rail" },
            h("button", {
              type: "button", className: "beu-rail-btn", "data-blast-action": "sidebar-expand",
              title: "展开工程侧栏", onClick: () => toggleSidebarPanel(),
            }, "»"),
            h("span", { className: "beu-rail-mark" }, "B")));
      }

      const manifest = engine.manifest;
      const project = (manifest && manifest.project) || {};
      const cases = (manifest && manifest.cases) || [];
      const activeCase = cases.find((row) => row.case_id === engine.caseId) || null;
      const versions = (activeCase && activeCase.versions) || [];
      const artifacts = artifactRows(engine.version);
      const repoRoot = project.root || null;

      // ── THREADS / HISTORY: real sessions of this workspace ────────────────
      const threads = [];
      if (sessionsSnap && sessionsSnap.byId) {
        const archived = (workspacesSnap && workspacesSnap.archivedSessionIds) || [];
        for (const id of (sessionsSnap.ids || Object.keys(sessionsSnap.byId))) {
          const row = sessionsSnap.byId[id];
          if (!row || row.blank === true || row.origin === "subagent") continue;
          if (archived.includes(id)) continue;
          const title = sessionLabel(row);
          const forThisProject = !repoRoot || !row.cwd || samePath(row.cwd, repoRoot);
          if (!engine.showAllThreads && (!forThisProject || THREAD_NOISE.test(title))) continue;
          threads.push({
            id, title,
            active: sessionsSnap.current === id,
            record: recordOf(id),
          });
        }
      }

      const workspaceReady = !workspacesSnap || (workspacesSnap.items || []).length > 0;

      const caseRows = cases.map((row) => h(Row, {
        key: "case:" + row.case_id,
        label: row.case_id,
        sub: row.primary_count + "/" + row.version_count,
        dotTone: statusTone(row.latest_status) || undefined,
        active: row.case_id === engine.caseId,
        title: row.case_id,
        data: { "data-case": row.case_id },
        onClick: () => selectCase(row.case_id),
      }));

      const versionRows = versions.map((version) => h(Row, {
        key: "ver:" + version.task_id,
        depth: 1,
        label: (version.diameter_m === null || version.diameter_m === undefined ? "—" : fmtNum(version.diameter_m) + " m")
          + (version.task_id === engine.taskId ? " · current" : ""),
        sub: version.final_status || version.phase || "",
        superseded: version.superseded,
        active: version.task_id === engine.taskId,
        data: { "data-version": version.diameter_m === null ? "(unknown)" : String(version.diameter_m) + "m" },
        onClick: () => selectVersion(activeCase.case_id, version.task_id),
      }));

      const otherFiles = artifacts.filter((row) => row.kind === "artifact").slice(0, 8);

      return h("div", { className: "beu beu-side", "data-blast-sidebar": "1" },
        h("div", { className: "beu-side-head" },
          h("div", { className: "beu-cap" }, "Project"),
          h("div", {
            className: "beu-side-proj", "data-brand-name": "1",
            title: project.name || "立井钻爆智能参数推荐与炮孔设计",
          }, BRAND.name),
          h("div", { className: "beu-meta", "data-brand-sub": "1" }, BRAND.sub),
          h("div", { className: "beu-meta", "data-project-meta": "1" },
            (project.case_count === undefined ? "—" : project.case_count) + " cases · "
            + (project.version_count === undefined ? "—" : project.version_count) + " design versions")),

        h("div", { className: "beu-side-body", "data-blast-sidebar-body": "1" },
          Section({ label: "Cases", hint: cases.length ? String(cases.length) : "" }),
          engine.status === "error"
            ? h("div", { className: "beu-empty", "data-sidebar-error": "1" }, "台账读取失败：" + engine.error)
            : caseRows,
          !caseRows.length && engine.status !== "error"
            ? h("div", { className: "beu-empty" }, engine.status === "loading" ? "正在读取真实台账…" : "暂无真实案例")
            : null,

          Section({ label: "Design versions", hint: activeCase ? activeCase.case_id : "" }),
          versionRows.length ? versionRows : h("div", { className: "beu-empty" }, "该案例尚无设计版本"),

          Section({ label: "Threads / History", hint: String(threads.length) }),
          threads.length
            ? threads.map((thread) => h(Row, {
              key: "thread:" + thread.id,
              label: thread.title,
              sub: thread.record && thread.record.taskId ? "已建版本" : "",
              dotTone: thread.record && thread.record.taskId ? "ok" : undefined,
              active: thread.active,
              title: thread.title,
              data: { "data-session": thread.id },
              onClick: () => {
                openSession(thread.id);
                if (thread.record && thread.record.taskId) loadVersion(thread.record.taskId, false);
              },
            }))
            : h("div", { className: "beu-empty" }, "本工程暂无会话记录"),
          h("div", { className: "beu-sect" },
            h("span", null, ""),
            h("button", {
              type: "button", className: "beu-link", "data-blast-action": "threads-toggle",
              onClick: () => setState({ showAllThreads: !engine.showAllThreads }),
            }, engine.showAllThreads ? "只看工程会话" : "显示全部会话")),

          Section({ label: "Artifacts", hint: engine.version ? (fmtNum(engine.version.design_version.diameter_m) + " m") : "" }),
          engine.versionStatus === "loading"
            ? h("div", { className: "beu-empty" }, "读取 artifacts…")
            : null,
          engine.version
            ? h("div", { className: "beu-side-body", style: { padding: 0 } },
              ARTIFACT_LINKS.map((link) => h("button", {
                key: link.key,
                type: "button",
                className: "beu-row",
                "data-depth": "1",
                "data-artifact-link": link.key,
                "data-active": engine.preview && engine.preview.kind === link.kind ? "1" : undefined,
                onClick: () => showPreview(link.kind, null, engine.taskId),
              }, h("span", { className: "beu-row-label" }, link.label))),
              otherFiles.map((row) => h(Row, {
                key: "file:" + row.name,
                depth: 1,
                label: row.name,
                sub: row.fileKind,
                title: row.name,
                onClick: () => showPreview("artifact", row.name, engine.taskId),
              })),
              artifacts.length === 0 ? h("div", { className: "beu-empty" }, "该版本尚无 artifact") : null)
            : null),

        h("div", { className: "beu-side-foot" },
          h("button", {
            type: "button", className: "beu-btn", "data-blast-action": "new-session",
            title: "在当前工作区新建一个 DSH 会话（Thread）",
            onClick: () => {
              const items = (workspacesSnap && workspacesSnap.items) || [];
              const current = sessionsSnap && sessionsSnap.current ? sessionsSnap.byId[sessionsSnap.current] : null;
              const match = current ? items.find((item) => samePath(item.path, current.cwd)) : null;
              startSession(match ? match.workspaceId : (items[0] && items[0].workspaceId));
            },
          }, "新会话"),
          h("button", {
            type: "button", className: "beu-btn", "data-blast-action": "refresh",
            onClick: () => loadManifest(true),
          }, "刷新"),
          h("button", {
            type: "button", className: "beu-btn", "data-blast-action": "native-sidebar",
            title: "让出左栏，改用 DSH 自带侧栏（会话管理 / 工作区 / 设置）",
            onClick: () => { if (sidebarControl.yieldToNative) sidebarControl.yieldToNative() },
          }, "DSH 侧栏"),
          h("button", {
            type: "button", className: "beu-btn", "data-blast-action": "sidebar-collapse",
            title: "收起侧栏", onClick: () => toggleSidebarPanel(),
          }, "«")));
    }

    // ── center: the native header's restrained status seat ──────────────────
    // One vocabulary for every voice state the product can be in. Idle keeps the
    // composer's own semantics ("input or speak an engineering instruction") —
    // never a thinking/inference slogan.
    const VOICE_TEXT = {
      idle: "输入或说出工程指令…",
      listening: "正在聆听…",
      transcribing: "正在识别…",
      processing: "正在处理…",
      speaking: "正在朗读…",
      interrupted: "已停止朗读",
    };
    const VOICE_LABEL = VOICE_TEXT;

    /**
     * Top bar: `AGENT_DEMO_1 · 5.5 m` + the project's own final status. It sits in
     * the conversation's OWN header utilities seat, so nothing is overlaid and
     * the whole row stays as quiet as the native one.
     */
    function SessionStatusChip() {
      const engine = useEngine();
      const voice = useVoice();
      const version = engine.version;
      const label = version
        ? (engine.caseId || "案例") + " · " + fmtNum(version.design_version.diameter_m) + " m"
        : (engine.caseId || null);
      const voiceChip = voice.state !== "idle" && voice.state !== "speaking";
      // The top bar stays empty until there is something true to say (the native
      // header renders nothing for an empty seat).
      if (!label && !version && !voiceChip && !engine.sidebarNative) return null;
      return h("div", { className: "beu beu-chips", "data-blast-status": "1" },
        label ? h("span", { className: "beu-chip" }, label) : null,
        version ? h(StatusChips, { version }) : null,
        voiceChip
          ? h("span", { className: "beu-chip", "data-tone": "accent", "data-voice-state": voice.state },
            "● " + (VOICE_LABEL[voice.state] || voice.state))
          : null,
        engine.sidebarNative
          ? h("button", {
            type: "button", className: "beu-btn", "data-blast-action": "blast-sidebar",
            title: "把左栏切回 BLAST 工程上下文",
            onClick: () => { if (sidebarControl.restoreBlast) sidebarControl.restoreBlast() },
          }, "工程栏")
          : null);
    }

    // ── composer: voice as an input mode, not a theme ───────────────────────
    /**
     * The unified composer keeps DSH's own textarea and send button. This seat
     * adds only the voice STATE (and a microphone when `dsh-voice-scribe` has not
     * published its own in this session) — plus the one honest bridge between the
     * two: the recognised text is read back from the composer draft it landed in,
     * and a parameter change becomes the structured gate above the input.
     */
    function ComposerVoice(props) {
      const voice = useVoice();
      const engine = useEngine();
      const sessionId = props.sessionId || null;
      const sessionRecord = useRecord(sessionId);
      const provided = props.input && typeof props.input.draft === "string" ? props.input.draft : "";
      // Fallback source of truth: when the input machine reports no draft (boot
      // races, a composer mounted before its state settles) read the native
      // textarea itself. Read-only, never a write, and never used when the
      // machine already reports text.
      const [domDraft, setDomDraft] = React.useState("");
      React.useEffect(() => {
        const timer = setInterval(() => {
          try {
            const area = document.querySelector("textarea");
            const value = area && typeof area.value === "string" ? area.value : "";
            setDomDraft((prev) => (prev === value ? prev : value));
          } catch (error) { /* ignore */ }
        }, 500);
        return () => clearInterval(timer);
      }, []);
      const draft = provided !== "" ? provided : domDraft;

      // The newest turn of this Thread is the anchor of the engineering record.
      // DSH's session snapshot carries the turn list as `chat.timeline.turns`
      // (a Map of turn records, each with its own `turn` number) — read only.
      const useSession = props.useSession;
      const newestTurn = typeof useSession === "function" ? useSession((snapshot) => {
        const turns = snapshot && snapshot.chat && snapshot.chat.timeline
          ? snapshot.chat.timeline.turns : null;
        if (!turns || typeof turns.values !== "function") return null;
        let newest = null;
        for (const turn of turns.values()) {
          const number = turn && typeof turn.turn === "number" ? turn.turn : null;
          if (number !== null && (newest === null || number > newest)) newest = number;
        }
        return newest;
      }) : null;

      React.useEffect(() => {
        if (!sessionId || newestTurn === null || newestTurn === undefined) return;
        const record = recordOf(sessionId);
        // Once a run's turn is pinned, the record's block stays in THAT turn.
        if (!record || record.resultTurn !== undefined) return;
        if (record.maxTurn === newestTurn) return;
        setRecord(sessionId, { maxTurn: newestTurn });
      }, [sessionId, newestTurn]);

      React.useEffect(() => {
        if (!sessionId) return;
        if (draft.includes(INSTRUCTION_MARK)) return;              // our own approved instruction
        const record = recordOf(sessionId);
        if (record && record.lastDraft === draft) return;          // this exact draft is already evaluated
        const impact = detectImpact(draft);
        const rows = impact ? buildDiffRows(impact, engine.version) : [];
        if (!impact || rows.length === 0) {
          setRecord(sessionId, { lastDraft: draft, gate: null, diffRows: [] });
          return;
        }
        voiceSet({ transcript: draft, note: "" });
        setRecord(sessionId, { lastDraft: draft, gate: impact, diffRows: rows, draft, caseId: engine.caseId });
      }, [sessionId, draft, engine.version, engine.caseId]);

      const listening = voice.state === "listening";
      const transcribing = voice.state === "transcribing";
      const bands = voice.bands && voice.bands.length ? voice.bands : [0, 0, 0, 0, 0, 0, 0, 0];
      const ownMic = !scribeMicButton();

      const items = [];
      if (listening || transcribing) {
        items.push(h("span", { className: "beu-listening", key: "live", "data-voice-live": listening ? "listening" : "transcribing" },
          h("span", { className: listening ? "beu-level" : "beu-meta" },
            listening ? bands.map((value, index) => h("i", { key: index, style: { height: (2 + value * 10).toFixed(1) + "px" } })) : null),
          listening ? VOICE_TEXT.listening : VOICE_TEXT.transcribing));
      }
      if (listening) {
        items.push(h("button", {
          key: "stop", type: "button", className: "beu-btn", "data-voice-action": "stop",
          onClick: () => toggleScribeMic(),
        }, "停止"));
      }
      if (ownMic) {
        items.push(h("button", {
          key: "mic", type: "button", className: "beu-mic", "data-voice-action": "mic",
          "data-on": listening ? "1" : undefined,
          title: "开始/结束语音识别（驱动 dsh-voice-scribe，本地 SenseVoice 识别，音频不出本机）",
          onClick: () => {
            const result = toggleScribeMic();
            if (result === "no-mic-button") voiceSet({ note: "没找到 dsh-voice-scribe 的麦克风按钮" });
          },
        }, "🎙"));
      }
      if (!listening && !transcribing && voice.note) {
        items.push(h("span", { key: "note", className: "beu-voice-note", title: voice.note }, voice.note));
      }
    // Always mounted while a real session's composer exists: the empty strip has
    // no size. The data attributes are honest observability hooks for the
    // acceptance driver (a draft length and a gate/row count, never text).
    return h("span", {
      className: "beu beu-voice",
      "data-voice-strip": "1",
      "data-state": voice.state,
      "data-voice-draft": String(draft.length),
      "data-voice-session": sessionId ? "1" : "0",
      "data-voice-gate": sessionRecord && sessionRecord.gate ? "1" : "0",
      "data-voice-rows": String(sessionRecord && sessionRecord.diffRows ? sessionRecord.diffRows.length : 0),
      "data-voice-turn": newestTurn === null || newestTurn === undefined ? "" : String(newestTurn),
      "data-voice-anchor": sessionRecord
        ? String(sessionRecord.maxTurn) + ":" + (sessionRecord.resultTurn === undefined ? "-" : String(sessionRecord.resultTurn))
          + ":" + (sessionRecord.change ? "c" : "-") + (sessionRecord.taskId ? "t" : "-")
        : "-",
      "data-voice-match": newestTurn === null || newestTurn === undefined
        ? "" : String(selectTurnTail({ turn: newestTurn }) !== null),
    }, items);
    }

    /** Sidebar mode control — filled in by apply(); the components only call it. */
    const sidebarControl = { yieldToNative: null, restoreBlast: null };

    // ── product copy overrides (strings the shell owns) ─────────────────────
    // Three visible strings are owned by the official bundles, not by this
    // plugin: the empty-session headline (a locale key of ui-conversation), the
    // window title, and the composer placeholder. A locale namespace can be
    // registered only once per locale (`LocaleRuntime.register` refuses a
    // second registration), so these are re-pointed at render time — text only:
    // no structure, no layout, no behaviour, and nothing engineering-related.
    // Same technique the voice mirror already uses to read the shell's status.
    const SHELL_HEADLINE_OLD = "探索未至之境";
    const HOME_COPY = {
      headline: "开始一次工程设计",
      line: "连接案例、生成方案、追溯结果，并预览工程成果。",
    };
    const COMPOSER_PLACEHOLDER = "输入或说出工程指令…";

    function applyCopyOverrides() {
      if (typeof document === "undefined" || !document.body) return;

      // 1. window title — the product name, never the harness' own.
      try {
        if (document.title.includes("DeepSeek Harness")) {
          document.title = document.title.split("DeepSeek Harness").join(BRAND.name);
        }
      } catch (error) { /* ignore */ }

      // 2. the empty-session hero: headline + the one line under it.
      try {
        const headline = Array.prototype.find.call(document.querySelectorAll("span"), (el) => {
          const value = (el.textContent || "").trim();
          return value === SHELL_HEADLINE_OLD || value === HOME_COPY.headline;
        });
        if (headline && (headline.textContent || "").trim() === SHELL_HEADLINE_OLD) {
          headline.textContent = HOME_COPY.headline;
        }
        if (headline) {
          const stack = headline.parentElement && headline.parentElement.parentElement;
          if (stack && !stack.querySelector("[data-blast-home-line]")) {
            const line = document.createElement("div");
            line.setAttribute("data-blast-home-line", "1");
            line.textContent = HOME_COPY.line;
            line.style.cssText = "align-self:center;text-align:center;font-size:12.5px;line-height:1.6;"
              + "margin-top:7px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,.55));letter-spacing:.01em;";
            stack.appendChild(line);
          }
        }
      } catch (error) { /* ignore */ }

      // 3. composer placeholder (a truthful unavailable/offline state keeps its
      //    own wording — the product never claims an input is possible when it
      //    is not).
      try {
        for (const area of Array.prototype.slice.call(document.querySelectorAll("textarea"))) {
          const current = area.getAttribute("placeholder") || "";
          if (current === COMPOSER_PLACEHOLDER || /不可用|离线/.test(current)) continue;
          area.setAttribute("placeholder", COMPOSER_PLACEHOLDER);
        }
      } catch (error) { /* ignore */ }
    }

    // ── the empty-session hero brand mark ───────────────────────────────────
    // The shell's hero headline has a leading brand-mark cell and asks for it
    // through its own `conversation.hero.brand.mark` single slot (fallback: the
    // harness' FishLogo). Filling that slot is the whole integration: no official
    // file is read, re-written or monkey-patched, and because the mark is a slot
    // value the shell's own re-renders can never bring the old logo back.
    //
    // Interaction is the approved package's: a class toggle drives every keyframe
    // (see CSS_BRAND). It is deliberately one-shot — the class is removed after a
    // full pulse cycle, so nothing loops, nothing idles and nothing keeps glowing.
    const BS_PULSE_MS = 900;

    function HeroBrandMark() {
      const markRef = React.useRef(null);

      React.useEffect(() => {
        const el = markRef.current;
        if (!el) return () => {};
        let timer = 0;
        const press = () => el.classList.add("is-down");
        const release = () => el.classList.remove("is-down");
        const pulse = () => {
          clearTimeout(timer);
          el.classList.remove("is-click");
          void el.offsetWidth; // restart the cycle even on a double click
          el.classList.add("is-click");
          timer = setTimeout(() => el.classList.remove("is-click"), BS_PULSE_MS);
        };
        el.addEventListener("pointerdown", press);
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);
        el.addEventListener("pointerleave", release);
        el.addEventListener("click", pulse);
        return () => {
          clearTimeout(timer);
          el.removeEventListener("pointerdown", press);
          el.removeEventListener("pointerup", release);
          el.removeEventListener("pointercancel", release);
          el.removeEventListener("pointerleave", release);
          el.removeEventListener("click", pulse);
        };
      }, []);

      // The cell takes the official brand-mark track (34 px) but stays out of the
      // row's height, so the headline, the home line and the composer keep their
      // geometry (see CSS_BRAND_HERO).
      return h("span", { className: "beu-hero-mark", "data-blast-hero-mark": "1" },
        h("button", {
          ref: markRef,
          type: "button",
          className: "bs-logo-button",
          "data-blast-hero-mark-button": "1",
          "aria-label": BRAND.name,
          title: BRAND.name + " · " + BRAND.sub,
        },
          h("span", { className: "bs-logo-core" },
            h("span", { className: "bs-logo-origin", "aria-hidden": "true" },
              h("span", { className: "bs-logo-pulse first" }),
              h("span", { className: "bs-logo-pulse second" }),
              h("span", { className: "bs-logo-spark" })),
            h("span", { className: "bs-logo-mark", "aria-hidden": "true" },
              h("span", null, "B"),
              h("span", { className: "s" }, "S")),
            h("span", { className: "bs-logo-sheen", "aria-hidden": "true" }))));
    }

    /** Keep the three shell-owned strings re-pointed while the shell re-renders. */
    function installCopyOverrides() {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
      let timer = null;
      const sync = () => { timer = null; applyCopyOverrides() };
      const schedule = () => { if (timer === null) timer = setTimeout(sync, 120) };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ["placeholder"],
      });
      schedule();
      return () => {
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
      };
    }

    // ── centre: the composer dock (a seat this plugin OWNS) ────────────────
    /**
     * Why this seat and not `conversation.composer` (the chain DSH uses for its
     * own approval panel): a chain selector is evaluated by the conversation's own
     * render, and this plugin's store cannot trigger that render — a gate chosen
     * there would appear only on the next unrelated re-render. The composer dock
     * is a list seat whose component is ours, so a detected change shows up
     * immediately; it is part of the native sticky composer stack (the same place
     * the native stats line lives), so it never covers the transcript or the
     * input, and the native composer keeps the keyboard focus.
     *
     * The dock does three jobs, in this order:
     *   * the parameter-change gate (diff + Cancel / Create version);
     *   * the live engineering trace while a real pipeline run is in flight;
     *   * the same engineering record card once the run has landed (the guaranteed
     *     home — see §6.2 of docs/CONVERSATION_NATIVE_UI_REDESIGN.md for why the
     *     turn-tail chain copy alone cannot be relied on).
     * It also owns the single `/activity` poll of the focused case and refreshes
     * the ledger the moment a run finishes.
     */
    function ComposerDock(props) {
      const engine = useEngine();
      const sessionId = props.sessionId || null;
      const record = useRecord(sessionId);
      const caseId = engine.caseId;

      React.useEffect(() => {
        if (!caseId) return () => {};
        loadActivity(caseId);
        const timer = setInterval(() => loadActivity(caseId), 2500);
        return () => clearInterval(timer);
      }, [caseId]);

      const gate = record && record.gate ? record.gate : null;
      const latest = engine.activity && engine.activity.latest;
      const running = Boolean(latest && latest.running);
      const result = record && record.taskId && !running && record.dockHidden !== record.taskId ? record : null;
      if (!gate && !running && !result) return null;

      return h("div", { className: "beu beu-dock", "data-blast-dock": gate ? "gate" : (running ? "running" : "done") },
        gate ? h(ChangeGateBlock, { gate, rows: record.diffRows || [], sessionId, inputActions: props.inputActions })
          : null,
        running
          ? h("div", null,
            h("div", { className: "beu-dock-head" },
              h("span", { className: "beu-dot", "data-tone": "warn" }),
              h("span", null, "正在生成设计方案"),
              h("span", { className: "beu-meta", style: { marginLeft: "auto" } },
                (latest.elapsed_s === undefined || latest.elapsed_s === null ? "" : "已用 " + Math.round(latest.elapsed_s) + " 秒 · ")
                + "进度判据来自本项目 STATUS.json / AGENT_RESULT.json")),
            h(TraceSteps, { running: true, stage: latest.stage }),
            latest.stage
              ? null
              : h("div", { className: "beu-meta", "data-trace-note": "no-stage" },
                "该任务还没有写入阶段记录（STATUS.json）；写入后这里逐条点亮。"))
          : null,
        result
          ? h("div", { "data-blast-result": "1" },
            h("div", { className: "beu-dock-head" },
              h("span", { className: "beu-dot", "data-tone": "ok" }),
              h("span", null, BRAND.name + " · 本轮工程记录"),
              h("button", {
                type: "button", className: "beu-btn", "data-blast-action": "result-dismiss",
                style: { marginLeft: "auto" },
                onClick: () => setRecord(sessionId, { dockHidden: record.taskId }),
              }, "收起")),
            h(EngineeringCard, { sessionId }))
          : null);
    }

    /**
     * The change gate itself. Detection never executes anything — the only
     * execution path is the "Create version" click, which hands the structured
     * change to the same Thread through the composer's own service face.
     */
    function ChangeGateBlock(props) {
      const engine = useEngine();
      const gate = props.gate;
      if (!gate) return null;
      const sessionId = props.sessionId || null;
      const destructive = gate.kind === "destructive";
      const rows = (props.rows && props.rows.length) ? props.rows : buildDiffRows(gate, engine.version);

      const cancel = () => {
        const shell = composerShell(sessionId);
        if (shell && typeof shell.setDraft === "function") {
          try { shell.setDraft("") } catch (error) { /* ignore */ }
        }
        voiceSet({ transcript: "" });
        setRecord(sessionId, { gate: null });
      };

      const confirm = () => {
        if (destructive || rows.length === 0) return;
        const approved = {
          gate: null,
          change: gate,
          diffRows: rows,
          draft: gate.draft,
          caseId: engine.caseId,
          parentTaskId: engine.taskId,
          parentDiameter: engine.version && engine.version.design_version
            ? engine.version.design_version.diameter_m : null,
          taskId: null,
          resultTurn: undefined,     // a new run re-opens the newest-turn anchor
        };
        setRecord(sessionId, approved);
        sendConfirmedChange(sessionId, Object.assign({}, recordOf(sessionId), approved), props.inputActions);
      };

      return h("div", { "data-blast-gate": "1" },
        h("div", { className: "beu-eng-head" },
          h("span", { className: "beu-eng-title" }, BRAND.name),
          h("span", { className: "beu-chip", "data-tone": "warn" }, "检测到一个参数变化")),
        h("div", { className: "beu-reason" }, "只有下列参数会改变；其余参数继承当前设计版本的真实输入（INPUT.json）。"),
        h(DiffRows, { rows }),
        destructive
          ? h("div", { className: "beu-reason", "data-gate-destructive": gate.word },
            "指令中包含破坏性动词「" + gate.word + "」，本闸门不会执行它；请改用文字确认。")
          : null,
        h("div", { className: "beu-gate-actions" },
          h("button", {
            type: "button", className: "beu-btn", "data-gate-action": "cancel", onClick: cancel,
          }, "Cancel"),
          h("button", {
            type: "button", className: "beu-btn", "data-primary": "1", "data-gate-action": "confirm",
            disabled: destructive || rows.length === 0, onClick: confirm,
          }, destructive ? "需文字确认" : "Create version")));
    }

    // ── centre: engineering nodes inside the native thread ──────────────────
    /**
     * ChainSelect for `conversation.chat.turnTail`: match ONLY the turn this
     * session's engineering record belongs to, and only while that record has
     * something to show. Returning null for every other turn keeps DSH's own
     * produced-files entry in the chain untouched.
     */
    function selectTurnTail(owner) {
      const turn = owner && owner.turn;
      if (typeof turn !== "number") return null;
      for (const [sessionId, record] of records) {
        if (!record || (!record.change && !record.taskId)) continue;
        // A pinned result turn wins; until then the block follows the newest turn.
        const target = record.resultTurn === undefined ? record.maxTurn : record.resultTurn;
        if (target !== turn) continue;
        return { sessionId, turn };
      }
      return null;
    }

    /**
     * The durable engineering block of one Thread: the approved parameter diff,
     * the pipeline's own stage verdicts, the project's own headline numbers and
     * the artifact links — rendered inside the native turn, before its own
     * icon actions. It reads the record's Design Version on its own, so it never
     * steals the focus of the left column.
     */
    // ── the engineering record card (shared by the turn tail and the dock) ──
    /**
     * The card itself: the recorded change, the pipeline's own stage verdicts,
     * the three real metrics and the artifact links. Its two homes:
     *   * `conversation.chat.turnTail` (this plugin's chain entry) — the natural
     *     place, rendered at the end of the turn that ran the pipeline. The chain
     *     select is consulted by DSH's memoised `TurnTailNodeView`, so this copy
     *     appears whenever that node re-renders (measured: it re-renders while the
     *     turn is being created/closed, not on our store's changes);
     *   * the composer dock — a seat this plugin owns, which re-renders on our
     *     store, so the SAME card is guaranteed to be visible the moment the
     *     ledger answers (see docs/CONVERSATION_NATIVE_UI_REDESIGN.md §6.2).
     */
    function EngineeringCard(props) {
      const engine = useEngine();
      const sessionId = props.sessionId || null;
      const record = useRecord(sessionId);
      const taskId = record ? record.taskId : null;
      const [snapshot, setSnapshot] = React.useState(null);
      const [stages, setStages] = React.useState(null);

      React.useEffect(() => {
        if (!taskId) { setSnapshot(null); return () => {}; }
        if (engine.taskId === taskId && engine.version) { setSnapshot(engine.version); return () => {}; }
        let alive = true;
        apiGet("/version?task=" + encodeURIComponent(taskId))
          .then((version) => { if (alive) setSnapshot(version) })
          .catch(() => { if (alive) setSnapshot(null) });
        return () => { alive = false };
      }, [taskId, engine.taskId, engine.version]);

      React.useEffect(() => {
        if (!taskId) { setStages(null); return () => {}; }
        if (engine.stagesTask === taskId && engine.stages) { setStages(engine.stages); return () => {}; }
        let alive = true;
        apiGet("/stages?task=" + encodeURIComponent(taskId))
          .then((payload) => { if (alive) setStages(payload) })
          .catch(() => { if (alive) setStages(null) });
        return () => { alive = false };
      }, [taskId, engine.stagesTask, engine.stages]);

      if (!record) return null;
      if (!record.change && !record.taskId) return null;

      const rows = record.diffRows || [];
      const stageMap = stages && stages.stages ? stages.stages : null;
      const done = Boolean(snapshot);

      return h("div", { className: "beu-eng-body" },
        h("div", { className: "beu-reason", "data-eng-reason": "1" },
          record.change
            ? "本轮只修改下列参数，其余参数沿用当前设计版本的真实输入（INPUT.json）；"
              + (done ? "设计版本与交付物如下。" : "计算结果尚未落库。")
            : "本轮新建了一个设计版本，其工程结论与交付物如下。"),
        h(DiffRows, { rows }),
        snapshot ? h(StatusChips, { version: snapshot }) : null,
        taskId ? h(TraceSteps, { running: false, stages: stageMap }) : null,
        snapshot ? h(MetricTriple, { version: snapshot }) : null,
        taskId ? h(ArtifactLinks, { taskId }) : null,
        !taskId
          ? h("div", { className: "beu-meta", "data-eng-pending": "1" }, "台账中尚未出现与该改动匹配的真实设计版本。")
          : null);
    }

    /** Chain entry: the engineering card at the end of the turn that ran the run. */
    function TurnEngineeringBlock(props) {
      const matched = props.matched || null;
      if (!matched) return null;
      const sessionId = matched.sessionId || props.sessionId;
      return h("div", { className: "beu beu-eng", "data-blast-eng": "1", "data-turn": String(matched.turn) },
        h("div", { className: "beu-eng-head" },
          h("span", { className: "beu-eng-title" }, BRAND.name),
          h("span", { className: "beu-eng-title" }, "· 本轮工程记录")),
        h(EngineeringCard, { sessionId }));
    }

    // ── right column: Preview Pane (the shell's own details panel) ──────────
    // It IS the AppFrame's details column: the shell gives it its border, its
    // width, its drag handle and its concession chain, and closing it widens the
    // conversation again. Switching content is one state change — never a page.
    function PreviewFigure(props) {
      const engine = useEngine();
      const file = findArtifact(engine.version, (name) => name === props.name);
      if (!file) return h("div", { className: "beu-pv-empty" }, "该版本输出包中没有 " + props.name);
      return h("div", null,
        h("img", {
          className: "beu-pv-img", src: artifactUrl(engine.taskId, props.name), alt: props.name,
          loading: "eager", "data-preview-image": props.name,
        }),
        h("div", { className: "beu-pv-cap" }, (props.caption || props.name) + " · " + fmtBytes(file.bytes)));
    }

    function PreviewDownloads(props) {
      const engine = useEngine();
      const present = (props.exts || []).map((ext) => props.base + ext)
        .filter((name) => findArtifact(engine.version, (n) => n === name));
      if (!present.length) return null;
      return h("div", { className: "beu-dl" }, present.map((name) => h("a", {
        key: name, href: artifactUrl(engine.taskId, name), target: "_blank", rel: "noreferrer",
      }, "打开/导出 " + name.slice(props.base.length))));
    }

    function PreviewTable(props) {
      return h("table", { className: "beu-table" },
        props.head ? h("thead", null, h("tr", null, props.head.map((cell) => h("th", { key: cell }, cell)))) : null,
        h("tbody", null, props.rows.map((row, index) => h("tr", { key: index },
          row.map((cell, i) => h("td", { key: i }, cell === null || cell === undefined ? "—" : String(cell)))))));
    }

    function ReportPreview() {
      const engine = useEngine();
      const markdown = engine.version ? engine.version.report_markdown : null;
      const MarkdownText = prim.MarkdownText;
      if (!markdown) return h("div", { className: "beu-pv-empty" }, "该版本输出包中没有 ONE_CLICK_REPORT.md");
      return h("div", { "data-preview-report": "1" },
        h("div", { className: "beu-pv-cap" }, "ONE_CLICK_REPORT.md · " + markdown.length + " 字符（原文，未改写）"),
        MarkdownText ? h(MarkdownText, { text: markdown }) : h("pre", { className: "beu-pre" }, markdown));
    }

    function ChargePreview() {
      const engine = useEngine();
      const structure = (engine.version.files || {})["CHARGE_STRUCTURE.json"] || null;
      const groups = (structure && structure.hole_groups) || {};
      const rows = Object.keys(groups).map((key) => {
        const group = groups[key] || {};
        const perHole = group.per_hole || {};
        return [key, group.hole_count, perHole.charge_required === false ? "0（不装药）" : fmtNum(perHole.value),
          perHole.status || group.charge || "—", perHole.method || "—", fmtNum(perHole.confidence, 3)];
      });
      return h("div", null,
        h(PreviewFigure, { name: "CHARGE_STRUCTURE.png", caption: "装药结构剖面图（Core 渲染器输出，未重绘）" }),
        h(PreviewDownloads, { base: "CHARGE_STRUCTURE", exts: [".svg", ".pdf", ".json"] }),
        rows.length
          ? h("div", null,
            h("div", { className: "beu-h2" }, "分组装药（CHARGE_STRUCTURE.json）"),
            h(PreviewTable, { head: ["分组", "孔数", "单孔装药", "状态", "方法", "置信度"], rows }))
          : h("div", { className: "beu-pv-empty" }, "该版本输出包中没有 CHARGE_STRUCTURE.json"));
    }

    function QcPreview() {
      const engine = useEngine();
      const qc = (engine.version.files || {})["ENGINEERING_QC.json"] || null;
      const validation = engine.validation;
      const counts = (validation && validation.counts) || {};
      const rows = (validation && validation.results && validation.results.checks) || [];
      const failures = rows.filter((row) => row && /fail/i.test(String(row.status || row.result || "")));
      const warnings = rows.filter((row) => row && /warn/i.test(String(row.status || row.result || "")));
      const qcRows = qc ? Object.keys(qc).slice(0, 24).map((key) => [key, typeof qc[key] === "object" ? JSON.stringify(qc[key]) : String(qc[key])]) : [];
      React.useEffect(() => { if (engine.taskId && !validation) loadValidation(engine.taskId, false) }, [engine.taskId]);
      return h("div", null,
        qcRows.length
          ? h(PreviewTable, { head: ["检查", "结果"], rows: qcRows })
          : h("div", { className: "beu-pv-empty" }, "输出包中没有 ENGINEERING_QC.json"),
        h("div", { className: "beu-h2" }, "一致性校验 · validate-result-consistency"),
        h("div", { className: "beu-meta", "data-validator-counts": "1" },
          "Checks " + (counts.checks === undefined ? "—" : counts.checks)
          + " · Pass " + (counts.pass === undefined ? "—" : counts.pass)
          + " · Warn " + (counts.warn === undefined ? "—" : counts.warn)
          + " · Fail " + (counts.fail === undefined ? "—" : counts.fail)
          + (validation ? (validation.results && validation.results.valid ? " · CONSISTENT" : " · INCONSISTENT") : " · 未运行")),
        h("div", { className: "beu-dl" },
          h("button", {
            type: "button", className: "beu-btn", "data-qc-action": "revalidate",
            onClick: () => loadValidation(engine.taskId, true),
          }, engine.validationStatus === "loading" ? "校验中…" : "重新校验")),
        failures.length
          ? h("div", null, h("div", { className: "beu-h2" }, "Fail"),
            failures.map((row, index) => h("div", { className: "beu-kv", key: index },
              h("span", null, row.check || row.name || "check"), h("b", null, row.detail || ""))))
          : null,
        warnings.length
          ? h("div", null, h("div", { className: "beu-h2" }, "Warn"),
            warnings.map((text, index) => h("div", { className: "beu-kv", key: index, "data-validator-warning": "1" },
              h("span", null, "warn"), h("b", null, String(text)))))
          : null);
    }

    function ArtifactPreview(props) {
      const engine = useEngine();
      const name = props.name;
      const ext = String(name || "").split(".").pop().toLowerCase();
      if (["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) {
        return h(PreviewFigure, { name, caption: name });
      }
      if (name === "ONE_CLICK_REPORT.md" && engine.version.report_markdown) return h(ReportPreview, null);
      const inline = (engine.version.files || {})[name];
      if (inline) return h("pre", { className: "beu-pre" }, JSON.stringify(inline, null, 1));
      return h("div", { className: "beu-pv-empty" },
        "该文件不在内联白名单内（体积或类型），可用下方链接打开原文。",
        h("div", { className: "beu-dl" }, h("a", {
          href: artifactUrl(engine.taskId, name), target: "_blank", rel: "noreferrer",
        }, "打开 " + name)));
    }

    const PREVIEW_FILE = {
      report: "ONE_CLICK_REPORT.md",
      plan: "FINAL_PLAN.png",
      "3d": "FINAL_3D_PREVIEW.png",
      charge: "CHARGE_STRUCTURE.png",
      qc: "ENGINEERING_QC.json",
    };

    /**
     * The preview pane. Default target is the design report (the brief's own
     * first screen); every later switch is one state change inside the same
     * column, with no navigation and no new window. Absolute paths never appear.
     */
    function PreviewPane() {
      const engine = useEngine();
      const preview = engine.preview || { kind: "report", name: null };
      const kind = preview.kind || "report";
      const ready = engine.versionStatus === "ready" && engine.version;
      const fileName = kind === "artifact" ? (preview.name || "Artifact") : PREVIEW_FILE[kind];

      let body;
      if (!ready) {
        body = h("div", { className: "beu-pv-empty", "data-preview-empty": "1" },
          engine.versionStatus === "loading" ? "正在读取真实结果…"
            : (engine.versionError || "尚未选择设计版本。"));
      } else if (kind === "report") {
        body = h(ReportPreview, null);
      } else if (kind === "plan") {
        body = h("div", null,
          h(PreviewFigure, { name: "FINAL_PLAN.png", caption: "最终炮孔布置平面图（Core CAD 输出，未重绘）" }),
          h(PreviewDownloads, { base: "FINAL_PLAN", exts: [".svg", ".pdf", ".dxf"] }));
      } else if (kind === "3d") {
        body = h("div", null,
          h(PreviewFigure, { name: "FINAL_3D_PREVIEW.png", caption: "三维炮孔布置预览（Core 输出）" }),
          h(PreviewDownloads, { base: "FINAL_3D", exts: [".dxf"] }));
      } else if (kind === "charge") {
        body = h(ChargePreview, null);
      } else if (kind === "qc") {
        body = h(QcPreview, null);
      } else {
        body = h(ArtifactPreview, { name: preview.name });
      }

      return h("div", { className: "beu beu-pv", "data-blast-preview": "1" },
        h("div", { className: "beu-pv-head" },
          h("span", { className: "beu-pv-cap", "data-preview-file": "1", style: { paddingBottom: "8px" } }, fileName),
          h("div", { className: "beu-pv-tabs" }, ARTIFACT_LINKS.map((link) => h("button", {
            key: link.key,
            type: "button",
            className: "beu-pv-tab",
            "data-preview-tab": link.kind,
            "data-active": kind === link.kind ? "1" : undefined,
            onClick: () => showPreview(link.kind, null, engine.taskId),
          }, link.kind === "plan" ? "平面图" : link.kind === "3d" ? "3D" : link.kind === "charge" ? "装药"
            : link.kind === "qc" ? "QC" : "报告"))),
          h("button", {
            type: "button", className: "beu-btn", "data-blast-action": "preview-close",
            title: "收起预览（中间 Thread 会自动扩宽）", onClick: () => closePreview(),
          }, "收起")),
        h("div", { className: "beu-pv-body", "data-preview-body": "1" }, body));
    }

    // ── plugin entry ────────────────────────────────────────────────────────
    const NS = "blast";
    const REGISTRANT = "blast-engineering-ui";
    /** Declared to the client loader: services are only readable when injected. */
    const inject = ["slots", "locale"];
    /** Sidebar registration lifecycle (the DSH-sidebar escape hatch needs it). */
    const sidebarEntry = { register: null, dispose: null };

    /** Give the left column back to DSH (its own sidebar has sessions/settings). */
    sidebarControl.yieldToNative = () => {
      if (!sidebarEntry.dispose) return false;
      try { sidebarEntry.dispose() } catch (error) { /* ignore */ }
      sidebarEntry.dispose = null;
      setState({ sidebarNative: true });
      return true;
    };

    /** Bring the BLAST context column back. */
    sidebarControl.restoreBlast = () => {
      if (sidebarEntry.dispose) { setState({ sidebarNative: false }); return true; }
      if (typeof sidebarEntry.register === "function") sidebarEntry.register();
      setState({ sidebarNative: false });
      return true;
    };

    function apply(ctx) {
      ctx.effect(() => installCss(), "blast-engineering-ui: stylesheet");

      // All service access happens inside an explicit injection scope: the client
      // ctx is a guard proxy, and reading a service the plugin has not injected is
      // an error there. `ctx.inject([...])` also WAITS for those services, so this
      // plugin can never race the locale/slots/layout registries at boot.
      ctx.inject(["slots", "locale"], (scope) => {
        services.slots = scope.slots;
        services.locale = scope.locale;
        scope.locale.register(NS, {
          title: BRAND.name,
          sidebar: "工程上下文",
          preview: "成果预览",
          "voice.idle": VOICE_TEXT.idle,
          "voice.listening": VOICE_TEXT.listening,
          "voice.transcribing": VOICE_TEXT.transcribing,
          "voice.processing": VOICE_TEXT.processing,
          "voice.speaking": VOICE_TEXT.speaking,
          "voice.interrupted": VOICE_TEXT.interrupted,
        });

        // 1. left column — Context Sidebar (shadows the official browser; the
        //    footer's "DSH 侧栏" button gives it back at any moment).
        //    `mine` is per-apply: a re-applied plugin instance disposes only its
        //    own entry, so a stale cleanup can never remove the live sidebar.
        scope.slots.inject("sidebar", () => {
          let mine = null;
          const register = () => {
            if (sidebarEntry.dispose) { try { sidebarEntry.dispose() } catch (error) { /* ignore */ } }
            mine = scope.slots.register({
              name: "sidebar",
              id: "blast.context.sidebar",
              priority: -1,
              locale: NS,
              registrant: REGISTRANT,
            }, ContextSidebar);
            sidebarEntry.dispose = () => {
              const disposer = mine;
              mine = null;
              sidebarEntry.dispose = null;
              if (disposer) disposer();
            };
            sidebarEntry.register = register;
            return mine;
          };
          if (!state.sidebarNative) register();
          return () => {
            const disposer = mine;
            mine = null;
            sidebarEntry.dispose = null;
            sidebarEntry.register = null;
            if (disposer) { try { disposer() } catch (error) { /* ignore */ } }
          };
        });

        // 2. right column — Preview Pane, on the shell's own details panel. The
        //    official details panel has no entry point in this composition, so
        //    this seat is free; the shell keeps owning width / drag / collapse.
        scope.slots.inject("details", () => scope.slots.register({
          name: "details",
          id: "blast.preview.pane",
          priority: -1,
          locale: NS,
          registrant: REGISTRANT,
        }, PreviewPane));

        // 3. centre — the restrained status row, inside the native header.
        scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
          name: "conversation.session.header.utilities",
          id: "blast.status",
          order: 10,
          locale: NS,
          registrant: REGISTRANT,
        }, SessionStatusChip));

        // 4. centre — the composer dock: the parameter-change gate and the live run
        //    strip, inside the native sticky composer stack.
        scope.slots.inject("conversation.composer.dock", () => scope.slots.register({
          name: "conversation.composer.dock",
          id: "blast.composer.dock",
          order: 10,
          locale: NS,
          registrant: REGISTRANT,
        }, ComposerDock));

        // 5. centre — the engineering nodes in the turn tail of the owning turn.
        scope.slots.inject("conversation.chat.turnTail", () => scope.slots.register({
          name: "conversation.chat.turnTail",
          id: "blast.engineering.nodes",
          select: selectTurnTail,
          locale: NS,
          registrant: REGISTRANT,
        }, TurnEngineeringBlock));

        // 6. the unified composer — voice state only; text and send stay native.
        scope.slots.inject("conversation.input.right", () => scope.slots.register({
          name: "conversation.input.right",
          id: "blast.voice",
          order: 30,
          locale: NS,
          registrant: REGISTRANT,
        }, ComposerVoice));

        // 7. the empty-session hero — its leading brand-mark cell, filled with the
        //    approved BS monogram motion. The shell declares this single slot itself
        //    and the deployment bundle already holds its cell at priority 0 with the
        //    harness' own mark (its registrant is a minified fiber name), so the BS
        //    mark takes the cell at a LOWER priority — the documented way to shadow a
        //    single slot's occupied cell ("lowest renders"). No official file is read,
        //    re-written or monkey-patched.
        scope.slots.inject("conversation.hero.brand.mark", () => scope.slots.register({
          name: "conversation.hero.brand.mark",
          id: "blast.hero.brand.mark",
          priority: -1,
          locale: NS,
          registrant: REGISTRANT,
        }, HeroBrandMark));
      });

      // Panel geometry (open/close the native details panel) and the two
      // navigation services the left column drives (sessions / workspaces).
      ctx.inject(["layout"], (scope) => { services.layout = scope.layout || scope.get("layout") });
      ctx.inject(["sessions"], (scope) => { services.sessions = scope.sessions || scope.get("sessions") });
      ctx.inject(["workspaces"], (scope) => { services.workspaces = scope.workspaces || scope.get("workspaces") });
      // The composer service face: the only way a confirmed change is submitted.
      ctx.inject(["conversation"], (scope) => { services.conversation = scope.conversation || scope.get("conversation") });

      ctx.effect(() => installVoiceMirror(), "blast-engineering-ui: voice state mirror");

      // The three shell-owned visible strings (hero headline + its line, window
      // title, composer placeholder) — display copy only, and only ever text.
      ctx.effect(() => installCopyOverrides(), "blast-engineering-ui: product copy overrides");

      // Chromium fills the speechSynthesis voice list asynchronously.
      ctx.effect(() => {
        if (!speechSupported()) return () => {};
        try {
          pickVoice();
          window.speechSynthesis.onvoiceschanged = () => pickVoice();
        } catch (error) { /* ignore */ }
        return () => {
          try { window.speechSynthesis.onvoiceschanged = null } catch (error) { /* ignore */ }
          try { window.speechSynthesis.cancel() } catch (error) { /* ignore */ }
        };
      }, "blast-engineering-ui: speech voice warm-up");

      loadManifest(false);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});






















