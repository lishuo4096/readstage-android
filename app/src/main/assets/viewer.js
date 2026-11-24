(function () {
  "use strict";

  // Bridge to the Android layer, with a harmless shim for browser preview.
  var A = window.Android || {
    getRecents:function(){return "[]";}, getSettings:function(){return "{}";},
    setSetting:function(){}, openRecent:function(){}, removeRecent:function(){},
    clearRecents:function(){}, pickFile:function(){}, reloadCurrent:function(){},
    shareCurrent:function(){}, saveScroll:function(){}, getScroll:function(){return 0;},
    setState:function(){}, toast:function(m){console.log(m);},
    pickFolder:function(){}, getFolder:function(){return "";},
    clearFolder:function(){}, requestFolderList:function(){}, copy:function(){},
    isSystemDark:function(){ try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return true; } }
  };

  var body = document.body;
  var content = document.getElementById("content");
  var titleEl = document.getElementById("title");

  var state = {
    view: "home",            // "home" | "reader"
    uri: null,
    settings: null,
    matches: [], matchIdx: -1,
    scrollTimer: null,
    folderFiles: null,       // cached list from the browsed folder
    restore: null            // active scroll-restore handle (see restoreScroll)
  };

  var DEFAULTS = { theme:"dark", font:"sans", size:17, width:"comfortable", wrapCode:false, reopenLast:true };
  var MIN_SIZE = 13, MAX_SIZE = 26;

  // Public API surface the Android layer (and our own handlers) call into.
  window.App = window.App || {};

  // ---------- Settings ----------
  function loadSettings() {
    var s = {};
    try { s = JSON.parse(A.getSettings() || "{}"); } catch (e) {}
    var out = {};
    for (var k in DEFAULTS) out[k] = (k in s) ? s[k] : DEFAULTS[k];
    state.settings = out;
  }

  // "auto" resolves to the system light/dark preference; everything else is literal.
  function systemPrefersDark() {
    if (typeof state.sysDark === "boolean") return state.sysDark;
    try { if (typeof A.isSystemDark === "function") return !!A.isSystemDark(); } catch (e) {}
    try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) {}
    return true;
  }
  function resolveTheme() {
    var t = state.settings ? state.settings.theme : "dark";
    return t === "auto" ? (systemPrefersDark() ? "dark" : "light") : t;
  }
  function applyTheme() { body.setAttribute("data-theme", resolveTheme()); }

  function applySettings() {
    var s = state.settings;
    applyTheme();
    document.documentElement.style.setProperty("--content-font",
      s.font === "serif" ? "var(--font-serif)" : "var(--font-sans)");
    document.documentElement.style.setProperty("--fs", s.size + "px");
    document.documentElement.style.setProperty("--maxw", s.width === "full" ? "100%" : "860px");
    body.classList.toggle("wrap-code", !!s.wrapCode);
    // Reflect into the settings UI.
    segSelect("set-theme", s.theme);
    segSelect("set-font", s.font);
    segSelect("set-width", s.width);
    document.getElementById("size-val").textContent = s.size + " px";
    document.getElementById("set-wrap").checked = !!s.wrapCode;
    document.getElementById("set-reopen").checked = !!s.reopenLast;
  }

  function setSetting(key, val) {
    state.settings[key] = val;
    A.setSetting(key, String(val));
    applySettings();
  }

  function segSelect(groupId, val) {
    var g = document.getElementById(groupId);
    if (!g) return;
    g.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("sel", b.getAttribute("data-v") === String(val));
    });
  }

  // ---------- View switching ----------
  function reportState() {
    var overlay = document.getElementById("menu").classList.contains("open")
      || document.getElementById("find").classList.contains("open")
      || document.getElementById("scrim").classList.contains("open");
    try { A.setState(state.view === "reader", overlay); } catch (e) {}
  }

  function showHome() {
    saveScrollNow();
    state.view = "home";
    body.className = "view-home";
    applyTheme();
    closeOverlays();
    renderRecents();
    renderFolder();
    reportState();
  }

  function showReader() {
    state.view = "reader";
    body.className = "view-reader" + (state.settings.wrapCode ? " wrap-code" : "");
    applyTheme();
    reportState();
  }

  // ---------- Recent files ----------
  function renderRecents() {
    var list = document.getElementById("recent-list");
    var empty = document.getElementById("recent-empty");
    var arr = [];
    try { arr = JSON.parse(A.getRecents() || "[]"); } catch (e) {}
    list.innerHTML = "";
    if (!arr.length) { empty.style.display = "block"; return; }
    empty.style.display = "none";
    arr.forEach(function (r) {
      var li = document.createElement("li");
      li.className = "recent-item";
      var main = document.createElement("div");
      main.className = "ri-main";
      var name = document.createElement("div");
      name.className = "ri-name";
      name.textContent = r.name || "Untitled";
      var sub = document.createElement("div");
      sub.className = "ri-sub";
      sub.textContent = prettyPath(r.uri);
      main.appendChild(name); main.appendChild(sub);
      main.addEventListener("click", function () { A.openRecent(r.uri); });
      var x = document.createElement("button");
      x.className = "ri-x"; x.textContent = "✕"; x.title = "Remove";
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        A.removeRecent(r.uri);
        renderRecents();
      });
      li.appendChild(main); li.appendChild(x);
      list.appendChild(li);
    });
  }

  // Turn an opaque content:// URI into a readable hint.
  function prettyPath(uri) {
    if (!uri) return "";
    try {
      var s = decodeURIComponent(uri);
      var m = s.match(/([^/:]+\/[^/]+\.(?:md|markdown|txt))$/i);
      if (m) return m[1];
      var seg = s.split("/").filter(Boolean).pop();
      return seg || s;
    } catch (e) { return uri; }
  }

  // ---------- Folder (SAF tree) ----------
  function renderFolder() {
    var section = document.getElementById("folder-section");
    var openBtn = document.getElementById("home-folder");
    var f = null;
    try { var raw = A.getFolder(); if (raw) f = JSON.parse(raw); } catch (e) {}
    if (!f || !f.uri) {
      section.style.display = "none";
      openBtn.style.display = "flex";
      state.folderFiles = null;
      return;
    }
    openBtn.style.display = "none";
    section.style.display = "block";
    document.getElementById("folder-name").textContent = f.name || "Folder";
    // Ask Java for the file list (async); show a placeholder meanwhile.
    var empty = document.getElementById("folder-empty");
    empty.style.display = "block";
    empty.textContent = "Loading…";
    document.getElementById("folder-list").innerHTML = "";
    state.folderFiles = null;
    try { A.requestFolderList(); } catch (e) {}
  }

  App.setFolderList = function (json) {
    var arr = [];
    try { arr = JSON.parse(json || "[]"); } catch (e) {}
    state.folderFiles = arr;
    applyFolderFilter();
  };

  function applyFolderFilter() {
    var arr = state.folderFiles || [];
    var q = (document.getElementById("folder-filter").value || "").trim().toLowerCase();
    var list = document.getElementById("folder-list");
    var empty = document.getElementById("folder-empty");
    list.innerHTML = "";
    var shown = arr.filter(function (r) {
      return !q || (r.name || "").toLowerCase().indexOf(q) !== -1;
    });
    if (!shown.length) {
      empty.style.display = "block";
      empty.textContent = arr.length ? "No files match." : "No markdown files in this folder.";
      return;
    }
    empty.style.display = "none";
    shown.forEach(function (r) {
      var li = document.createElement("li");
      li.className = "recent-item";
      var main = document.createElement("div");
      main.className = "ri-main";
      var name = document.createElement("div");
      name.className = "ri-name";
      name.textContent = r.name || "Untitled";
      main.appendChild(name);
      main.addEventListener("click", function () { A.openRecent(r.uri); });
      li.appendChild(main);
      list.appendChild(li);
    });
  }

  // ---------- Rendering markdown ----------
  window.App = window.App || {};

  // Teach marked to treat $…$ / $$…$$ as opaque math tokens and render them with
  // KaTeX DURING parsing. Without this, marked parses the markdown first and turns
  // the underscores/asterisks inside the LaTeX (subscripts, \text{a\_b}, …) into
  // <em>/<strong>, corrupting every subscript-heavy equation before KaTeX runs on
  // it. Registering once (guarded) means marked never sees the LaTeX internals.
  var mathExtReady = false;
  function ensureMathExtension() {
    if (mathExtReady || typeof marked.use !== "function" || typeof katex === "undefined") return;
    mathExtReady = true;
    function tex(src, display) {
      try { return katex.renderToString(src, { displayMode:display, throwOnError:false }); }
      catch (e) { return null; }
    }
    marked.use({
      extensions: [
        {
          name: "mathBlock", level: "block",
          start: function (s) { var i = s.indexOf("$$"); return i < 0 ? undefined : i; },
          tokenizer: function (s) {
            var m = /^\$\$([\s\S]+?)\$\$/.exec(s);
            if (m) return { type:"mathBlock", raw:m[0], text:m[1].trim() };
          },
          renderer: function (t) { var h = tex(t.text, true); return h != null ? h : "<pre>" + t.text + "</pre>"; }
        },
        {
          name: "mathInline", level: "inline",
          start: function (s) { var i = s.indexOf("$"); return i < 0 ? undefined : i; },
          tokenizer: function (s) {
            // Single-line $…$; \$ escapes a literal dollar; don't swallow the $$ opener.
            var m = /^\$(?!\$)((?:\\.|[^$\\\n])+?)\$/.exec(s);
            if (m) return { type:"mathInline", raw:m[0], text:m[1] };
          },
          renderer: function (t) { var h = tex(t.text, false); return h != null ? h : t.raw; }
        }
      ]
    });
  }

  App.render = function (mdText, uri, name) {
    saveScrollNow();
    state.uri = uri;
    titleEl.textContent = name || "";
    closeOverlays();
    var fm = extractFrontMatter(mdText || "");
    try {
      ensureMathExtension();
      marked.setOptions({ gfm:true, breaks:false, headerIds:false, mangle:false });
      content.innerHTML = frontMatterHtml(fm.meta) + DOMPurify.sanitize(marked.parse(fm.body), {FORBID_TAGS:["iframe","object","embed","form","input","style"], FORBID_ATTR:["style"]});
    } catch (e) {
      content.innerText = "Failed to render: " + e;
    }
    // Turn ```mermaid blocks into diagrams first, so highlighting/copy skip them.
    renderMermaid();
    // Syntax highlight + copy buttons.
    content.querySelectorAll("pre code").forEach(function (b) {
      try { hljs.highlightElement(b); } catch (e) {}
      addCopyButton(b);
    });
    // $ / $$ math is already rendered by the marked extension above (so marked
    // couldn't mangle it); here we only mop up the \(…\) and \[…\] delimiters.
    try {
      renderMathInElement(content, {
        delimiters: [
          { left:"\\(", right:"\\)", display:false },
          { left:"\\[", right:"\\]", display:true }
        ],
        throwOnError:false
      });
    } catch (e) {}
    assignHeadingIds();
    buildToc();
    showReader();
    restoreScroll(uri);
    updateProgress();
  };

  App.resumeReader = function () { showReader(); };
  App.showHome = function () { showHome(); };
  App.goHome = function () { showHome(); };
  App.refreshHome = function () { if (state.view === "home") { renderRecents(); renderFolder(); } };
  // Called by Java (onConfigurationChanged) and the CSS media listener; re-theme when on Auto.
  App.systemThemeChanged = function (isDark) {
    if (typeof isDark === "boolean") state.sysDark = isDark;
    else state.sysDark = undefined;
    if (state.settings && state.settings.theme === "auto") applyTheme();
  };

  App.closeOverlays = function () { closeOverlays(); };

  // ---------- Front matter ----------
  // Strip a leading YAML block and surface common keys as a small card.
  function extractFrontMatter(md) {
    var m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
    if (!m) return { meta:null, body:md };
    return { meta:parseYamlish(m[1]), body:md.slice(m[0].length) };
  }

  function parseYamlish(text) {
    var out = [], lines = text.split(/\r?\n/), curKey = null, curList = null;
    lines.forEach(function (line) {
      if (!line.trim()) return;
      var item = /^\s*-\s+(.*)$/.exec(line);
      if (item && curList) { curList.push(stripQuotes(item[1])); return; }
      var kv = /^([A-Za-z0-9_.\- ]+):\s*(.*)$/.exec(line);
      if (!kv) return;
      curKey = kv[1].trim();
      var val = kv[2].trim();
      if (val === "") { curList = []; out.push([curKey, curList]); }
      else if (/^\[.*\]$/.test(val)) {
        curList = null;
        out.push([curKey, val.slice(1, -1).split(",").map(function (s) { return stripQuotes(s.trim()); }).filter(Boolean)]);
      } else { curList = null; out.push([curKey, stripQuotes(val)]); }
    });
    return out.length ? out : null;
  }

  function stripQuotes(s) { return s.replace(/^["']|["']$/g, ""); }

  function frontMatterHtml(meta) {
    if (!meta) return "";
    var titleHtml = "", rows = "";
    meta.forEach(function (pair) {
      var k = pair[0], v = pair[1];
      var vs = Array.isArray(v) ? v.join(", ") : v;
      if (!vs) return;
      if (k.toLowerCase() === "title") { titleHtml = '<div class="fm-title">' + esc(vs) + "</div>"; return; }
      rows += "<dt>" + esc(k) + "</dt><dd>" + esc(vs) + "</dd>";
    });
    if (!titleHtml && !rows) return "";
    return '<div class="frontmatter">' + titleHtml + (rows ? "<dl>" + rows + "</dl>" : "") + "</div>";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c];
    });
  }

  // ---------- Copy buttons ----------
  function addCopyButton(codeEl) {
    var pre = codeEl.closest ? codeEl.closest("pre") : codeEl.parentNode;
    if (!pre || pre.querySelector(".copy-btn")) return;
    var btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      try { A.copy(codeEl.innerText); } catch (err) {}
      btn.textContent = "Copied"; btn.classList.add("done");
      setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1200);
    });
    pre.appendChild(btn);
  }

  // ---------- Mermaid diagrams ----------
  function mermaidTheme() {
    var t = resolveTheme();
    if (t === "light") return "default";
    if (t === "sepia") return "neutral";
    return "dark";                    // dark + black
  }

  function renderMermaid() {
    if (typeof mermaid === "undefined") return;
    var blocks = content.querySelectorAll("pre > code.language-mermaid");
    if (!blocks.length) return;
    try {
      mermaid.initialize({ startOnLoad:false, securityLevel:"strict", theme:mermaidTheme() });
    } catch (e) {}
    var nodes = [];
    blocks.forEach(function (code) {
      var pre = code.parentNode;
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;      // raw diagram source
      pre.parentNode.replaceChild(div, pre);
      nodes.push(div);
    });
    // Invalid diagrams reject/throw; leave their source visible rather than crash.
    try {
      var p = mermaid.run({ nodes: nodes });
      if (p && p.then) p.then(afterMermaid, afterMermaid);
    } catch (e) { afterMermaid(); }
  }

  function afterMermaid() {
    updateProgress();
    if (state.restore) state.restore.apply();   // diagrams shifted layout height
  }

  // ---------- Scroll restore (re-applies as async layout settles) ----------
  function restoreScroll(uri) {
    if (state.restore) state.restore.cancel();
    var y = 0;
    try { y = parseInt(A.getScroll(uri), 10) || 0; } catch (e) {}
    window.scrollTo(0, y);
    if (!y) { state.restore = null; return; }
    var r = { y:y, cancelled:false };
    r.apply = function () { if (!r.cancelled) window.scrollTo(0, r.y); };
    r.cancel = function () { r.cancelled = true; cleanup(); };
    function cleanup() {
      window.removeEventListener("touchstart", r.cancel);
      window.removeEventListener("wheel", r.cancel);
    }
    // Any user interaction wins over the restore.
    window.addEventListener("touchstart", r.cancel, { passive:true });
    window.addEventListener("wheel", r.cancel, { passive:true });
    requestAnimationFrame(r.apply);
    content.querySelectorAll("img").forEach(function (img) {
      if (!img.complete) { img.addEventListener("load", r.apply); img.addEventListener("error", r.apply); }
    });
    setTimeout(r.apply, 150);
    setTimeout(cleanup, 900);
    state.restore = r;
  }

  // ---------- Reading progress ----------
  function updateProgress() {
    var bar = document.getElementById("progress");
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var pct = h > 0 ? Math.min(1, Math.max(0, (window.scrollY || window.pageYOffset || 0) / h)) : 0;
    bar.style.width = (pct * 100) + "%";
  }

  // ---------- Table of contents ----------
  function assignHeadingIds() {
    var hs = content.querySelectorAll("h1,h2,h3,h4,h5,h6");
    hs.forEach(function (h, i) { h.id = "h-" + i; });
  }

  function buildToc() {
    var list = document.getElementById("toc-list");
    var empty = document.getElementById("toc-empty");
    list.innerHTML = "";
    var hs = content.querySelectorAll("h1,h2,h3,h4,h5,h6");
    if (!hs.length) { empty.style.display = "block"; return; }
    empty.style.display = "none";
    hs.forEach(function (h) {
      var lvl = parseInt(h.tagName.substring(1), 10);
      var li = document.createElement("li");
      li.className = "lvl" + lvl;
      var a = document.createElement("a");
      a.textContent = h.textContent;
      a.href = "#" + h.id;
      a.addEventListener("click", function (e) {
        e.preventDefault();
        closeSheet("toc");
        h.scrollIntoView({ behavior:"auto", block:"start" });
      });
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  // ---------- Find in page ----------
  function clearFind() {
    var marks = content.querySelectorAll("mark.find");
    marks.forEach(function (m) {
      var t = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(t, m);
    });
    content.normalize();
    state.matches = []; state.matchIdx = -1;
    document.getElementById("find-count").textContent = "";
  }

  function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function doFind(q) {
    clearFind();
    if (!q) return;
    var rx = new RegExp(escapeRx(q), "gi");
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      var p = n.parentNode ? n.parentNode.nodeName : "";
      if (/SCRIPT|STYLE|MARK|BUTTON/i.test(p)) continue;
      if (rx.test(n.nodeValue)) { rx.lastIndex = 0; nodes.push(n); }
    }
    nodes.forEach(function (node) {
      var text = node.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      rx.lastIndex = 0;
      while ((m = rx.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mk = document.createElement("mark");
        mk.className = "find"; mk.textContent = m[0];
        frag.appendChild(mk);
        last = m.index + m[0].length;
        if (m[0].length === 0) rx.lastIndex++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    state.matches = Array.prototype.slice.call(content.querySelectorAll("mark.find"));
    if (state.matches.length) gotoMatch(0);
    else document.getElementById("find-count").textContent = "0/0";
  }

  function gotoMatch(i) {
    if (!state.matches.length) return;
    if (state.matchIdx >= 0 && state.matches[state.matchIdx])
      state.matches[state.matchIdx].classList.remove("current");
    state.matchIdx = (i + state.matches.length) % state.matches.length;
    var el = state.matches[state.matchIdx];
    el.classList.add("current");
    el.scrollIntoView({ behavior:"auto", block:"center" });
    document.getElementById("find-count").textContent =
      (state.matchIdx + 1) + "/" + state.matches.length;
  }

  function openFind() {
    document.getElementById("find").classList.add("open");
    var inp = document.getElementById("find-input");
    inp.focus();
    reportState();
  }
  function closeFind() {
    document.getElementById("find").classList.remove("open");
    document.getElementById("find-input").value = "";
    clearFind();
    reportState();
  }

  // ---------- Overlays (menu, sheets) ----------
  function openMenu() { document.getElementById("menu").classList.add("open"); reportState(); }
  function closeMenu() { document.getElementById("menu").classList.remove("open"); reportState(); }

  function openSheet(id) {
    document.getElementById("scrim").classList.add("open");
    document.getElementById(id).classList.add("open");
    reportState();
  }
  function closeSheet(id) {
    document.getElementById(id).classList.remove("open");
    document.getElementById("scrim").classList.remove("open");
    reportState();
  }

  function closeOverlays() {
    closeMenu();
    document.getElementById("find").classList.remove("open");
    document.getElementById("toc").classList.remove("open");
    document.getElementById("settings").classList.remove("open");
    document.getElementById("scrim").classList.remove("open");
    reportState();
  }

  // ---------- Scroll persistence ----------
  function saveScrollNow() {
    if (state.view === "reader" && state.uri) {
      try { A.saveScroll(state.uri, Math.round(window.scrollY || window.pageYOffset || 0)); } catch (e) {}
    }
  }
  window.addEventListener("scroll", function () {
    if (state.view !== "reader") return;
    updateProgress();
    if (state.scrollTimer) clearTimeout(state.scrollTimer);
    state.scrollTimer = setTimeout(saveScrollNow, 350);
  }, { passive:true });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveScrollNow();
  });

  // ---------- Wire up controls ----------
  function on(id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }

  on("btn-back", "click", showHome);
  on("btn-find", "click", openFind);
  on("btn-toc", "click", function () { openSheet("toc"); });
  on("btn-menu", "click", function () {
    var m = document.getElementById("menu");
    m.classList.contains("open") ? closeMenu() : openMenu();
  });

  on("mi-reload", "click", function () { closeMenu(); A.reloadCurrent(); });
  on("mi-share", "click", function () { closeMenu(); A.shareCurrent(); });
  on("mi-settings", "click", function () { closeMenu(); openSheet("settings"); });
  on("mi-home", "click", function () { closeMenu(); showHome(); });

  on("home-open", "click", function () { A.pickFile(); });
  on("home-settings", "click", function () { openSheet("settings"); });
  on("recent-clear", "click", function () { A.clearRecents(); renderRecents(); });

  // Folder library
  on("home-folder", "click", function () { A.pickFolder(); });
  on("folder-change", "click", function () { A.pickFolder(); });
  on("folder-clear", "click", function () { A.clearFolder(); renderFolder(); });
  on("folder-filter", "input", applyFolderFilter);

  // Find bar
  on("find-input", "input", function () { doFind(this.value.trim()); });
  on("find-input", "keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); gotoMatch(state.matchIdx + 1); } });
  on("find-next", "click", function () { gotoMatch(state.matchIdx + 1); });
  on("find-prev", "click", function () { gotoMatch(state.matchIdx - 1); });
  on("find-close", "click", closeFind);

  // Scrim closes whichever sheet is open.
  on("scrim", "click", function () {
    closeSheet("toc"); closeSheet("settings");
  });
  document.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () { closeSheet(b.getAttribute("data-close")); });
  });

  // Settings controls
  document.getElementById("set-theme").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { setSetting("theme", b.getAttribute("data-v")); });
  });
  document.getElementById("set-font").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { setSetting("font", b.getAttribute("data-v")); });
  });
  document.getElementById("set-width").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { setSetting("width", b.getAttribute("data-v")); });
  });
  on("size-dn", "click", function () { setSetting("size", Math.max(MIN_SIZE, state.settings.size - 1)); });
  on("size-up", "click", function () { setSetting("size", Math.min(MAX_SIZE, state.settings.size + 1)); });
  on("set-wrap", "change", function () { setSetting("wrapCode", this.checked); });
  on("set-reopen", "change", function () { setSetting("reopenLast", this.checked); });

  // Re-theme on system light/dark change (fallback to Java's onConfigurationChanged).
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onMq = function (e) { App.systemThemeChanged(!!e.matches); };
    if (mq.addEventListener) mq.addEventListener("change", onMq);
    else if (mq.addListener) mq.addListener(onMq);
  } catch (e) {}

  // ---------- Boot ----------
  loadSettings();
  applySettings();
  showHome();   // Java may immediately override this with App.render(...)
})();
