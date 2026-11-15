/* app.js : application complète, 2 modes.
 *  - Mode DÉMO   : 100 % navigateur (comptes dans localStorage, capteurs simulés). Marche sur GitHub Pages.
 *  - Mode NORMAL : serveur local (backend/) : comptes, base SQLite chiffrée AES-256-GCM, capteurs réels, IA locale, alertes. */
(function () {
  var R = React, h = R.createElement, A = window.AstroTwin;
  var ROLE_FR = { astronaut: "Astronaute", doctor: "Médecin de bord", admin: "Administration" };
  var LV_FR = { green: "Nominal", yellow: "À surveiller", red: "Critique" };
  var LV_CLS = { green: "ok", yellow: "warn", red: "bad" };
  var SEV = { red: 0, yellow: 1, green: 2 };
  var ZONE_FR = { head: "Tête", torso: "Torse", legs: "Jambes", radiation: "Radiations" };
  var KU = "astro_demo_users", KS = "astro_session", KM = "astro_mode", KB = "astro_base", KSND = "astro_sound", KAUD = "astro_demo_audit";
  var DEMO_CODES = { doctor: "MED2026", admin: "ADMIN2026" };

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet() { try { return JSON.parse(sessionStorage.getItem(KS)); } catch (e) { return null; } }
  function ssSet(s) { try { s ? sessionStorage.setItem(KS, JSON.stringify(s)) : sessionStorage.removeItem(KS); } catch (e) {} }
  function fail(m) { return Promise.reject(new Error(m)); }
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  function fmtTime(iso) { return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ================= Adaptateur DÉMO (localStorage) ================= */
  function demoSeed() {
    return [
      { id: "A-01", name: "Astronaute A-01", age: 38, mission: "Artemis III", role: "astronaut", pass: "demo" },
      { id: "A-02", name: "Astronaute A-02", age: 41, mission: "Artemis III", role: "astronaut", pass: "demo" },
      { id: "MED-01", name: "Dr Médecin de bord", age: 45, mission: "Artemis III", role: "doctor", pass: "demo" },
      { id: "ADM-01", name: "Administrateur", age: 50, mission: "—", role: "admin", pass: "demo" }
    ];
  }
  function demoUsers() {
    try { var u = JSON.parse(lsGet(KU, "null")); if (u && u.length) return u; } catch (e) {}
    var s = demoSeed(); lsSet(KU, JSON.stringify(s)); return s;
  }
  function pub(u) { return { id: u.id, name: u.name, age: u.age, mission: u.mission, role: u.role }; }
  function demoAudit() { try { return JSON.parse(lsGet(KAUD, "[]")); } catch (e) { return []; } }
  function addDemoAudit(actor, target) { lsSet(KAUD, JSON.stringify([{ ts: new Date().toISOString(), actor: actor, action: "lecture", target: target }].concat(demoAudit()).slice(0, 100))); }
  var demo = {
    mode: "demo",
    login: function (id, pass) {
      var u = demoUsers().filter(function (x) { return x.id.toLowerCase() === id.trim().toLowerCase() && x.pass === pass; })[0];
      return u ? Promise.resolve({ mode: "demo", user: pub(u) }) : fail("Identifiant ou mot de passe incorrect.");
    },
    quick: function (id) { return Promise.resolve({ mode: "demo", user: pub(demoUsers().filter(function (x) { return x.id === id; })[0]) }); },
    register: function (v) {
      var age = +v.age;
      if (!v.name.trim() || !age || age < 18 || age > 80 || !v.pass) return fail("Nom, âge (18–80) et mot de passe obligatoires.");
      if (v.role !== "astronaut" && v.code !== DEMO_CODES[v.role]) return fail("Code d'accès invalide pour ce rôle.");
      var us = demoUsers(), pre = { astronaut: "A-", doctor: "MED-", admin: "ADM-" }[v.role];
      var n = Math.max.apply(null, [0].concat(us.filter(function (x) { return x.role === v.role; }).map(function (x) { return +x.id.slice(pre.length); }))) + 1;
      var u = { id: pre + (n < 10 ? "0" : "") + n, name: v.name.trim(), age: age, mission: v.mission.trim() || "—", role: v.role, pass: v.pass };
      us.push(u); lsSet(KU, JSON.stringify(us));
      return Promise.resolve({ mode: "demo", user: pub(u), created: u.id });
    },
    users: function () { return Promise.resolve(demoUsers().map(pub)); },
    audit: function () { return Promise.resolve(demoAudit()); }
  };

  /* ================= Adaptateur NORMAL (serveur local) ================= */
  function jf(base, path, opts) {
    return fetch(base + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Champs invalides (" + r.status + ")");
        return j;
      });
    }, function () { throw new Error("Serveur injoignable : " + base); });
  }
  function post(base, path, body) { return jf(base, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function authH(s) { return { headers: { Authorization: "Bearer " + s.token } }; }
  function normal(base) {
    function wrap(r, created) { return { mode: "normal", base: base, token: r.token, user: r.user, created: created }; }
    return {
      mode: "normal",
      login: function (id, pass) { return post(base, "/api/auth/login", { id: id.trim(), password: pass }).then(wrap); },
      register: function (v) {
        return post(base, "/api/auth/register", { name: v.name.trim(), age: +v.age || 0, mission: v.mission.trim(), role: v.role, password: v.pass, access_code: v.code })
          .then(function (r) { return wrap(r, r.user.id); });
      },
      users: function (s) { return jf(base, "/api/users", authH(s)).then(function (j) { return j.users; }); },
      audit: function (s) { return jf(base, "/api/audit", authH(s)).then(function (j) { return j.audit; }); }
    };
  }
  function adapterOf(s) { return s.mode === "normal" ? normal(s.base) : demo; }
  // démo : aucune baseUrl => le dashboard utilise ses capteurs simulés ; normal : API du serveur local
  function connProps(s) { return s.mode === "normal" ? { baseUrl: s.base, token: s.token } : {}; }

  /* ================= Petits composants ================= */
  function Logo(p) {
    var s = p.size || 32;
    return h("svg", { width: s, height: s, viewBox: "0 0 512 512", "aria-hidden": "true" },
      h("defs", null,
        h("linearGradient", { id: "lgS", x1: 0.15, y1: 0, x2: 0.85, y2: 1 }, h("stop", { offset: 0, stopColor: "#fbf8f1" }), h("stop", { offset: 1, stopColor: "#b9bec8" })),
        h("linearGradient", { id: "lgV", x1: 0.1, y1: 0, x2: 0.9, y2: 1 }, h("stop", { offset: 0, stopColor: "#f3c35f" }), h("stop", { offset: 0.45, stopColor: "#b8741f" }), h("stop", { offset: 1, stopColor: "#2a1a08" })),
        h("clipPath", { id: "lgF" }, h("rect", { x: -100, y: 262, width: 720, height: 400 }))),
      h("g", { transform: "rotate(-22 256 266)" }, h("ellipse", { cx: 256, cy: 266, rx: 196, ry: 58, fill: "none", stroke: "#ff6b35", strokeWidth: 15, opacity: 0.55 })),
      h("path", { d: "M150 392q0-40 36-52h140q36 12 36 52v22H150z", fill: "url(#lgS)" }),
      h("circle", { cx: 256, cy: 246, r: 128, fill: "url(#lgS)" }),
      h("rect", { x: 148, y: 170, width: 216, height: 152, rx: 76, fill: "#1a1d24" }),
      h("rect", { x: 156, y: 178, width: 200, height: 136, rx: 68, fill: "url(#lgV)" }),
      h("path", { d: "M176 250h42l16-34 26 74 22-52 14 12h40", fill: "none", stroke: "#fff6dc", strokeWidth: 10, strokeLinecap: "round", strokeLinejoin: "round" }),
      h("g", { transform: "rotate(-22 256 266)" }, h("g", { clipPath: "url(#lgF)" }, h("ellipse", { cx: 256, cy: 266, rx: 196, ry: 58, fill: "none", stroke: "#ff6b35", strokeWidth: 15 }))),
      h("circle", { cx: 425, cy: 212, r: 19, fill: "#5eb1ff", stroke: "#e8edf5", strokeWidth: 4 }));
  }
  var ICONS = {
    server: "M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01", play: "M8 5v14l11-7z", arrow: "M5 12h14M13 6l6 6-6 6",
    bell: "M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4", sound: "M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13",
    mute: "M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6", grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.5 3-6 7-6s7 2.5 7 6M17 4.5a3.5 3.5 0 010 6.5M22 20c0-2.6-1.6-4.6-4-5.5", log: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h4", heart: "M12 21s-7-4.5-9-9a5 5 0 019-3 5 5 0 019 3c-2 4.5-9 9-9 9z",
    cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5", shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", file: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M8 13h8M8 17h8"
  };
  function Icon(p) {
    return h("svg", { width: p.size || 18, height: p.size || 18, viewBox: "0 0 24 24", fill: p.fill ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: ICONS[p.n] }));
  }
  function Field(p) {
    return h("label", { className: "field" }, p.label,
      h("input", { className: "input", type: p.type || "text", value: p.value, placeholder: p.ph || "", autoComplete: p.ac, inputMode: p.im, onBlur: p.onBlur, onChange: function (e) { p.set(e.target.value); } }));
  }
  function useClock() {
    var f = function () { return new Date().toISOString().slice(11, 19); };
    var s = R.useState(f()), v = s[0], set = s[1];
    R.useEffect(function () { var id = setInterval(function () { set(f()); }, 1000); return function () { clearInterval(id); }; }, []);
    return v;
  }
  var AC = null;
  function beep() {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.24].forEach(function (d, i) {
        var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + d;
        o.type = "sine"; o.frequency.value = i ? 660 : 880;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + 0.22);
      });
    } catch (e) {}
  }
  function whyOf(x) {
    var out = [];
    ["head", "torso", "legs"].forEach(function (k) { (x.zones[k].reasons || []).forEach(function (r) { out.push(r); }); });
    ((x.radiation && x.radiation.reasons) || []).forEach(function (r) { out.push(r); });
    return out;
  }

  /* ================= Accueil (PC : 2 colonnes avec jumeau 3D animé) ================= */
  function useViewport() {
    var f = function () { return { w: window.innerWidth || 1280, h: window.innerHeight || 800 }; };
    var s = R.useState(f), v = s[0], set = s[1];
    R.useEffect(function () {
      if (!window.addEventListener) return;
      function on() { set(f()); }
      window.addEventListener("resize", on);
      return function () { window.removeEventListener("resize", on); };
    }, []);
    return v;
  }

  // scénarios d'illustration (z = risque tête, torse, jambes, radiations)
  var SCEN = [
    { name: "Nominal", note: "Tous les paramètres sont dans la normale.", z: [0.12, 0.1, 0.1, 0.06], hr: 72, spo2: 98, co2: 900, rad: 0.02 },
    { name: "CO₂ cabine en hausse", note: "Le CO₂ monte : la tête passe en surveillance.", z: [0.55, 0.15, 0.1, 0.06], hr: 78, spo2: 97, co2: 2600, rad: 0.02 },
    { name: "Effort cardiaque", note: "FC et SpO₂ dégradées : alerte critique sur le torse.", z: [0.3, 0.85, 0.12, 0.06], hr: 121, spo2: 92, co2: 1100, rad: 0.03 },
    { name: "Pic de radiation", note: "Dose élevée : mise à l'abri conseillée.", z: [0.15, 0.15, 0.1, 0.8], hr: 80, spo2: 97, co2: 950, rad: 0.27 }
  ];
  function lvl(sc) { return sc < 0.4 ? "ok" : sc < 0.7 ? "warn" : "bad"; }

  function LiveTwin(p) {
    var a = R.useState(0), i = a[0], setI = a[1], b = R.useState(0), tick = b[0], setTick = b[1];
    R.useEffect(function () {
      var t1 = setInterval(function () { setTick(function (x) { return x + 1; }); }, 1100);
      var t2 = setInterval(function () { setI(function (x) { return (x + 1) % SCEN.length; }); }, 5200);
      return function () { clearInterval(t1); clearInterval(t2); };
    }, []);
    var s = SCEN[i], j = function (k, amp) { return Math.sin(tick * 1.7 + k) * amp; };
    var hr = Math.round(s.hr + j(1, 2.5)), spo2 = Math.round(Math.min(100, s.spo2 + j(2, 0.7)));
    var co2 = Math.round(s.co2 + j(3, 40)), rad = (s.rad + j(4, 0.004)).toFixed(3);
    function tm(pos, label, level, body, extra) {
      return h("div", { className: "tm " + pos + " " + level }, h("small", null, label), h("b", { className: "mono" }, body), extra || null);
    }
    return h("div", { className: "twin" },
      h("div", { className: "ring r1" }), h("div", { className: "ring r2" }),
      h(A_().BodyPreview, { key: p.height, variant: "suit", risks: { head: s.z[0], torso: s.z[1], legs: s.z[2] }, radiation: s.z[3], height: p.height }),
      h("div", { className: "sim" }, "Simulation d'illustration"),
      tm("tl", "Fréquence cardiaque", lvl(s.z[1]), [hr, h("em", { key: "u" }, "bpm")],
        h("svg", { className: "ecg", viewBox: "0 0 120 28", "aria-hidden": "true" }, h("path", { d: "M0 14h20l4-8 5 18 5-26 5 22 4-6h16l4-4 5 8 3-4h24" }))),
      tm("tr", "SpO₂", lvl(s.z[1]), [spo2, h("em", { key: "u" }, "%")]),
      tm("bl", "CO₂ cabine", lvl(s.z[0]), [co2, h("em", { key: "u" }, "ppm")]),
      tm("br", "Rayonnement", lvl(s.z[3]), [rad, h("em", { key: "u" }, "mGy/h")]),
      h("div", { className: "cap" }, h("span", { className: "dot " + (Math.max.apply(null, s.z) < 0.4 ? "ok" : Math.max.apply(null, s.z) < 0.7 ? "warn" : "bad") }),
        h("b", null, s.name), h("span", { className: "hint hide-m" }, s.note),
        h("span", { className: "pips" }, SCEN.map(function (x, k) { return h("i", { key: k, className: k === i ? "on" : "" }); }))));
  }
  function A_() { return window.AstroTwin; }

  function Stage(p) {
    var th = Math.max(300, Math.min(500, Math.round(p.vp.h * 0.44 / 40) * 40));
    var feats = [["cube", "Jumeau 3D", "Zones du corps colorées selon le risque"], ["bell", "Alertes en direct", "Bandeau, son et historique"],
                 ["shield", "Chiffré AES-256", "Données médicales protégées"], ["server", "100 % local", "Rien ne part sur Internet"]];
    return h("aside", { className: "l-stage" },
      h("div", { className: "aurora" }),
      h("div", { className: "l-top" },
        h("div", { className: "brand" }, h(Logo, { size: 38 }), h("div", null, h("b", null, "NasAstro"), h("small", null, "Santé de l'équipage"))),
        h("a", { className: "link", href: "guide.html", target: "_blank" }, "Guide d'utilisation")),
      h("div", { className: "l-mid" },
        h("h1", { className: "l-h1" }, "La santé de l'équipage, ", h("span", { className: "grad" }, "en temps réel"), "."),
        h("p", { className: "l-sub" }, "Un jumeau 3D alimenté par les capteurs de la combinaison et de la cabine, analysé par une IA qui tourne hors ligne. Vos données ne quittent jamais votre machine."),
        h(LiveTwin, { height: th })),
      h("div", { className: "l-feats" }, feats.map(function (f) {
        return h("div", { key: f[0], className: "feat-i" }, h("div", { className: "fi" }, h(Icon, { n: f[0], size: 18 })), h("div", null, h("b", null, f[1]), h("span", null, f[2])));
      })));
  }

  // PC : colonne gauche (jumeau animé, reste en place) + colonne droite (contenu). Mobile : contenu seul.
  function Shell(p) {
    var vp = useViewport();
    if (vp.w < 960) return p.children;
    return h("div", { className: "landing" }, h(Stage, { vp: vp }), h("main", { className: "l-panel" }, h("div", { className: "l-card" }, p.children)));
  }

  function ModeSelect(p) {
    var vp = useViewport(), wide = vp.w >= 960;
    R.useEffect(function () { // raccourcis clavier PC : 1 = normal, 2 = démo
      if (!window.addEventListener || !wide) return;
      function key(e) { var t = (e.target && e.target.tagName) || ""; if (/INPUT|TEXTAREA|SELECT/.test(t)) return; if (e.key === "1") p.onPick("normal"); if (e.key === "2") p.onPick("demo"); }
      window.addEventListener("keydown", key);
      return function () { window.removeEventListener("keydown", key); };
    }, [wide]);
    function card(cls, icon, title, badge, text, ticks, mode, k) {
      return h("button", { className: "mode " + cls, onClick: function () { p.onPick(mode); } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("div", { className: "ic" }, h(Icon, { n: icon, size: 22, fill: icon === "play" })),
          h("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, h("span", { className: "chip solid " + (mode === "normal" ? "ok" : "warn") }, badge), wide ? h("kbd", null, k) : null)),
        h("h3", null, title), h("p", null, text),
        wide ? h("ul", { className: "ticks" }, ticks.map(function (t) { return h("li", { key: t }, t); })) : null,
        h("div", { className: "go" }, "Ouvrir ", h(Icon, { n: "arrow", size: 16 })));
    }
    return h("div", { className: wide ? "pane" : "wrap narrow screen" },
      wide
        ? h("div", { className: "p-head" }, h("h2", null, "Bienvenue"), h("p", null, "Choisissez comment utiliser l'application."))
        : h("div", { className: "hero" }, h("div", { className: "logo" }, h(Logo, { size: 104 })), h("h1", null, "NasAstro"),
            h("p", null, "Santé de l'équipage en temps réel : jumeau 3D, IA locale, données qui restent sur votre machine.")),
      h("div", { className: "modes" },
        card("normal", "server", "Mode normal", "DONNÉES RÉELLES", "Serveur local : comptes, capteurs de la combinaison et de la cabine, alertes, base chiffrée.",
          ["Comptes et rôles : astronaute, médecin, administration", "Capteurs réels, alertes enregistrées", "Base locale chiffrée AES-256-GCM"], "normal", "1"),
        card("demo", "play", "Mode démo", "SIMULÉ", "Sans serveur, directement dans le navigateur. Idéal pour présenter l'application.",
          ["Aucune installation ni serveur", "Capteurs simulés et comptes d'essai", "Parfait pour présenter ou tester"], "demo", "2")),
      wide ? null : h("div", { className: "feat" }, ["Hors ligne", "Chiffré AES-256", "IA locale", "PC + téléphone"].map(function (t) { return h("span", { key: t, className: "chip" }, t); })),
      h("div", { className: "foot" }, wide ? null : h("span", null, h("a", { href: "guide.html", target: "_blank" }, "Guide d'utilisation"), " · "), "Prototype, ne remplace pas un dispositif médical"));
  }

  /* ================= Connexion / inscription ================= */
  function Auth(p) {
    var isN = p.mode === "normal", vp = useViewport(), cls = vp.w >= 960 ? "pane" : "wrap narrow screen";
    var m = R.useState("login"), tab = m[0], setTab = m[1];
    var f = R.useState({ id: "", pass: "", name: "", age: "", mission: "", role: "astronaut", code: "" }), v = f[0], setV = f[1];
    var e = R.useState(""), err = e[0], setErr = e[1];
    var b = R.useState(false), busy = b[0], setBusy = b[1];
    var defBase = lsGet(KB, /github\.io$/.test(location.hostname) || !/^https?:$/.test(location.protocol) ? "http://localhost:8000" : location.origin);
    var bs = R.useState(defBase), base = bs[0], setBase = bs[1];
    var ps = R.useState(""), ping = ps[0], setPing = ps[1];
    var cleanBase = base.trim().replace(/\/+$/, "");
    var adapter = isN ? normal(cleanBase) : demo;
    var mixed = isN && location.protocol === "https:" && /^http:\/\/(?!localhost|127\.0\.0\.1)/.test(cleanBase);

    function testServer() {
      if (!isN) return; setPing("…");
      jf(cleanBase, "/api/health").then(function () { setPing("ok"); lsSet(KB, cleanBase); }, function () { setPing("ko"); });
    }
    R.useEffect(testServer, [p.mode]);
    function set(k) { return function (x) { var o = {}; for (var i in v) o[i] = v[i]; o[k] = x; setV(o); }; }
    function go(promise) {
      setBusy(true); setErr("");
      promise.then(function (s) { setBusy(false); if (s.created) alert("Compte créé. Votre identifiant : " + s.created + "\nNotez-le : il sert à vous connecter."); p.onLogin(s); },
                   function (x) { setBusy(false); setErr(x.message || String(x)); });
    }
    function submit(ev) { ev.preventDefault(); go(tab === "login" ? adapter.login(v.id, v.pass) : adapter.register(v)); }

    return h("div", { className: cls },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, h(Logo, { size: 34 }),
          h("div", null, h("b", null, isN ? "Mode normal" : "Mode démo"), h("div", { className: "hint" }, isN ? "Données réelles, stockage local chiffré" : "Données simulées"))),
        h("button", { className: "btn ghost sm", onClick: p.onBack }, "Changer")),
      isN && h("div", { className: "panel" },
        h(Field, { label: "Adresse du serveur", value: base, set: setBase, onBlur: testServer, ph: "http://192.168.1.20:8000", im: "url" }),
        h("div", { className: "status" }, h("span", { className: cx("dot", ping === "ok" ? "ok" : ping === "ko" ? "bad" : "") }),
          ping === "ok" ? "Serveur connecté · stockage local chiffré" : ping === "ko" ? "Serveur injoignable : lancez l'application sur le PC (voir le guide)" : "Test de connexion…"),
        mixed && h("div", { className: "hint", style: { color: "var(--warn)", marginTop: 8 } }, "Cette page est en HTTPS : le navigateur bloquera un serveur en HTTP. Ouvrez l'application depuis le serveur lui-même (http://adresse:8000).")),
      h("form", { className: "panel", onSubmit: submit },
        h("div", { className: "seg" },
          h("button", { type: "button", className: tab === "login" ? "on" : "", onClick: function () { setTab("login"); setErr(""); } }, "Connexion"),
          h("button", { type: "button", className: tab === "reg" ? "on" : "", onClick: function () { setTab("reg"); setErr(""); } }, "Créer un compte")),
        tab === "login"
          ? [h(Field, { key: 1, label: "Identifiant", value: v.id, set: set("id"), ph: "ex. A-01", ac: "username" }),
             h(Field, { key: 2, label: "Mot de passe", type: "password", value: v.pass, set: set("pass"), ac: "current-password" })]
          : [h(Field, { key: 1, label: "Nom complet", value: v.name, set: set("name"), ac: "name" }),
             h("div", { key: 2, style: { display: "grid", gridTemplateColumns: "90px 1fr", gap: 10 } },
               h(Field, { label: "Âge", type: "number", value: v.age, set: set("age"), im: "numeric" }),
               h(Field, { label: "Mission", value: v.mission, set: set("mission"), ph: "ex. Artemis III" })),
             h("label", { key: 3, className: "field" }, "Rôle",
               h("select", { className: "input", value: v.role, onChange: function (x) { set("role")(x.target.value); } },
                 Object.keys(ROLE_FR).map(function (k) { return h("option", { key: k, value: k }, ROLE_FR[k]); }))),
             v.role !== "astronaut" && h(Field, { key: 4, label: isN ? "Code d'accès (affiché au démarrage du serveur)" : "Code d'accès (démo : MED2026 / ADMIN2026)", value: v.code, set: set("code") }),
             h(Field, { key: 5, label: isN ? "Mot de passe (8 caractères min.)" : "Mot de passe", type: "password", value: v.pass, set: set("pass"), ac: "new-password" })],
        h("button", { className: "btn primary block", type: "submit", disabled: busy }, busy ? h("span", { className: "spinner" }) : (tab === "login" ? "Se connecter" : "Créer le compte")),
        err && h("div", { className: "err", role: "alert" }, err)),
      !isN && h("div", { className: "panel" },
        h("div", { className: "hint" }, "Accès rapide démo (mot de passe : demo)"),
        h("div", { className: "quick" }, [["Astronaute", "A-01"], ["Médecin", "MED-01"], ["Administration", "ADM-01"]].map(function (x) {
          return h("button", { key: x[1], type: "button", className: "btn ghost sm", onClick: function () { go(demo.quick(x[1])); } }, x[0]);
        }))));
  }

  /* ================= Coque de l'application ================= */
  function Topbar(p) {
    var clock = useClock(), isN = p.s.mode === "normal";
    return h("header", { className: "topbar" },
      h("div", { className: "tb-l" }, h(Logo, { size: 30 }),
        h("div", { style: { minWidth: 0 } }, h("div", { className: "tb-title" }, p.s.user.name),
          h("div", { className: "tb-sub" }, ROLE_FR[p.s.user.role] + " · " + p.s.user.mission + " · " + p.s.user.id))),
      h("div", { className: "tb-r" },
        h("span", { className: "chip mono hide-s" }, "UTC " + clock),
        h("span", { className: "chip solid " + (isN ? "ok" : "warn") }, isN ? "RÉEL" : "DÉMO"),
        h("button", { className: "btn ghost sm", onClick: p.onLogout }, "Quitter")));
  }

  // alertes : normal = enregistrées par le serveur (même si personne ne regarde) ; démo = déduites des changements de niveau
  function useAlerts(s, patients) {
    var st = R.useState([]), list = st[0], setList = st[1];
    var prev = R.useRef({});
    R.useEffect(function () {
      if (s.mode !== "normal") return;
      var alive = true;
      function load() { jf(s.base, "/api/alerts", authH(s)).then(function (j) { if (alive) setList(j.alerts || []); }, function () {}); }
      load(); var id = setInterval(load, 5000);
      return function () { alive = false; clearInterval(id); };
    }, [s.mode, s.token]);
    R.useEffect(function () {
      if (s.mode !== "demo" || !patients.length) return;
      var fresh = [];
      patients.forEach(function (x) {
        var last = prev.current[x.astronaut_id], lvl = x.overall_level;
        if (last === undefined ? lvl !== "green" : last !== lvl)
          fresh.push({ ts: new Date().toISOString(), astronaut_id: x.astronaut_id, name: x.name, level: lvl, from: last || "green", reasons: whyOf(x).slice(0, 4) });
        prev.current[x.astronaut_id] = lvl;
      });
      if (fresh.length) setList(function (old) { return fresh.concat(old).slice(0, 50); });
    }, [patients]);
    return list;
  }

  function AlertList(p) {
    if (!p.items.length) return h("div", { className: "empty" }, "Aucune alerte pour le moment.");
    return h("div", { className: "list" }, p.items.map(function (a, i) {
      var title = a.level === "green" ? "Retour à la normale" : a.level === "red" ? "Passage en état critique" : "À surveiller";
      return h("div", { key: a.ts + i, className: "row" }, h("span", { className: "lv " + a.level }),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", null, h("b", null, a.name || a.astronaut_id), " · ", title),
          a.reasons && a.reasons.length ? h("div", { className: "w" }, a.reasons.join(" · ")) : null,
          h("div", { className: "t mono" }, fmtTime(a.ts) + " · " + a.astronaut_id)));
    }));
  }


  /* ---------- Mise en page PC : barre latérale + zone de travail ---------- */
  function Side(p) {
    var clock = useClock(), isN = p.s.mode === "normal", u = p.s.user;
    return h("aside", { className: "side" },
      h("div", { className: "side-brand" }, h(Logo, { size: 34 }), h("div", null, h("b", null, "NasAstro"), h("small", null, "Santé équipage"))),
      h("nav", { className: "nav", "aria-label": "Navigation" }, p.nav.map(function (n, i) {
        return h("button", { key: n[0], className: cx("nav-i", p.active === n[0] && "on"), onClick: function () { p.onNav(n[0]); } },
          h(Icon, { n: { crew: "grid", alerts: "bell", users: "users", audit: "log", twin: "cube" }[n[0]] || "grid", size: 18 }),
          h("span", { className: "grow" }, n[1]), n[2] ? h("span", { className: "badge" }, n[2]) : null, h("kbd", null, i + 1));
      })),
      h("div", { className: "side-foot" },
        h("div", { className: "who" }, h("b", null, u.name), h("small", null, ROLE_FR[u.role] + (u.mission ? " · " + u.mission : "")), h("small", { className: "mono" }, u.id)),
        h("div", { className: "side-row" }, h("span", { className: "chip mono" }, "UTC " + clock), h("span", { className: "chip solid " + (isN ? "ok" : "warn") }, isN ? "RÉEL" : "DÉMO")),
        h("button", { className: "btn ghost sm block", onClick: p.onLogout }, "Quitter")));
  }
  // PC (≥ 900 px) : barre latérale, raccourcis clavier 1-4. Petit écran : barre du haut + onglets.
  function Layout(p) {
    var vp = useViewport(), ref = R.useRef(p); ref.current = p;
    R.useEffect(function () {
      function key(e) {
        var t = (e.target && e.target.tagName) || "";
        if (/INPUT|TEXTAREA|SELECT/.test(t) || e.ctrlKey || e.metaKey || e.altKey) return;
        var i = +e.key - 1, c = ref.current;
        if (i >= 0 && i < c.nav.length) c.onNav(c.nav[i][0]);
      }
      window.addEventListener("keydown", key);
      return function () { window.removeEventListener("keydown", key); };
    }, []);
    if (vp.w >= 900) return h("div", { className: "app" }, h(Side, p), h("main", { className: "main" }, p.children));
    return h("div", null, h(Topbar, { s: p.s, onLogout: p.onLogout }),
      p.nav.length > 1 ? h("div", { className: "tabs", role: "tablist" }, p.nav.map(function (x) {
        return h("button", { key: x[0], role: "tab", "aria-selected": p.active === x[0], className: cx("tab", p.active === x[0] && "on"), onClick: function () { p.onNav(x[0]); } },
          x[1], x[2] ? h("span", { className: "badge" }, x[2]) : null);
      })) : null, p.children);
  }
  function Head(p) {
    return h("div", { className: "pagehead" }, h("div", null, h("h1", null, p.title), h("div", { className: "hint" }, p.sub)),
      h("div", { className: "ph-actions" }, p.children));
  }

  function AstroCard(p) {
    var x = p.x, tw = A.toTwinProps(x), why = whyOf(x);
    var zones = [["head", x.zones.head.level], ["torso", x.zones.torso.level], ["legs", x.zones.legs.level], ["radiation", x.radiation.level]];
    return h("button", { className: "acard", "data-level": x.overall_level, onClick: p.onOpen, "aria-label": "Ouvrir " + x.name },
      h("div", { className: "ac-head" },
        h("div", null, h("div", { className: "ac-name" }, x.name), h("div", { className: "ac-id mono" }, x.astronaut_id)),
        h("span", { className: "chip " + LV_CLS[x.overall_level] }, LV_FR[x.overall_level])),
      h("div", { className: "ac-3d" }, h(A.BodyPreview, { variant: "suit", risks: tw.risks, radiation: tw.radiation, height: 210 })),
      h("div", { className: "zdots" }, zones.map(function (z) { return h("span", { key: z[0] }, h("i", { className: z[1] }), ZONE_FR[z[0]]); })),
      x.vitals && x.vitals.hr ? h("div", { className: "ac-v mono" }, "♥ " + Math.round(x.vitals.hr) + " bpm · SpO₂ " + Math.round(x.vitals.spo2) + " %") : null,
      h("div", { className: "ac-why" }, why.length ? why.slice(0, 2).join(" · ") : "Aucun écart détecté"));
  }

  function report(s, pl, alerts) {
    var rows = pl.map(function (x) {
      var cm = (x.countermeasures || []).map(function (c) { return c.action; });
      return "<tr><td>" + esc(x.astronaut_id) + "</td><td>" + esc(x.name) + "</td><td class='" + x.overall_level + "'>" + LV_FR[x.overall_level] + "</td><td>" + esc(whyOf(x).join(" · ") || "—") + "</td><td>" + esc(cm.join(" ; ") || "—") + "</td></tr>";
    }).join("");
    var arows = alerts.slice(0, 30).map(function (a) {
      return "<tr><td>" + esc(fmtTime(a.ts)) + "</td><td>" + esc(a.name || a.astronaut_id) + "</td><td class='" + a.level + "'>" + LV_FR[a.level] + "</td><td>" + esc((a.reasons || []).join(" · ") || "—") + "</td></tr>";
    }).join("");
    var w = window.open("", "_blank");
    if (!w) { alert("Autorisez les fenêtres pop-up pour générer le rapport."); return; }
    w.document.write("<!doctype html><html lang='fr'><meta charset='utf-8'><title>Rapport de santé de l'équipage</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:28px;color:#111}h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 6px}small{color:#666}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;font-size:12.5px}th{background:#f1f3f5}.green{color:#1f7a5a;font-weight:600}.yellow{color:#b36b00;font-weight:600}.red{color:#c92a2a;font-weight:600}</style>" +
      "<h1>Rapport de santé de l'équipage</h1><small>Édité le " + esc(new Date().toLocaleString("fr-FR")) + " par " + esc(s.user.name) + " (" + esc(ROLE_FR[s.user.role]) + ") · Mode " + (s.mode === "normal" ? "réel" : "démo") + "</small>" +
      "<h2>État actuel</h2><table><tr><th>ID</th><th>Nom</th><th>Niveau</th><th>Constats</th><th>Mesures conseillées</th></tr>" + rows + "</table>" +
      "<h2>Dernières alertes</h2><table><tr><th>Date</th><th>Astronaute</th><th>Niveau</th><th>Constats</th></tr>" + (arows || "<tr><td colspan='4'>Aucune alerte</td></tr>") + "</table>" +
      "<p><small>Prototype : seuils à valider par un médecin. Ce document ne remplace pas un avis médical.</small></p></html>");
    w.document.close(); setTimeout(function () { w.focus(); w.print(); }, 350);
  }

  function Table(p) {
    return h("div", { className: "tablewrap" }, h("table", null,
      h("thead", null, h("tr", null, p.cols.map(function (c) { return h("th", { key: c }, c); }))),
      h("tbody", null, p.rows.length ? p.rows.map(function (r, i) { return h("tr", { key: i }, r.map(function (c, j) { return h("td", { key: j }, c); })); })
        : h("tr", null, h("td", { colSpan: p.cols.length, className: "hint" }, "Aucune donnée")))));
  }
  function Remote(p) { // charge une liste (comptes / journal) auprès de l'adaptateur
    var a = R.useState([]), d = a[0], setD = a[1], e = R.useState(""), err = e[0], setErr = e[1];
    function load() { adapterOf(p.s)[p.what](p.s).then(function (x) { setD(x); setErr(""); }, function (x) { setErr(x.message); }); }
    R.useEffect(load, []);
    return h("div", null,
      h("div", { className: "tools" }, h("b", null, p.title(d.length)), h("button", { className: "btn ghost sm", onClick: load }, "Actualiser")),
      err && h("div", { className: "err" }, err), h(Table, { cols: p.cols, rows: d.map(p.row) }));
  }

  function CrewView(p) {
    var s = p.s, isAdmin = s.user.role === "admin", conn = connProps(s), vp = useViewport(), wide = vp.w >= 1100;
    var pl = A.usePatients(Object.assign({ everyMs: 3000 }, conn));
    var t = R.useState("crew"), tab = t[0], setTab = t[1];
    var sl = R.useState(null), sel = sl[0], setSel = sl[1];
    var sd = R.useState(lsGet(KSND, "1") === "1"), sound = sd[0], setSound = sd[1];
    var vw = R.useState(lsGet("astro.view", "cards")), view = vw[0], setView = vw[1];
    var ts = R.useState(""), toast = ts[0], setToast = ts[1];
    var alerts = useAlerts(s, pl), prev = R.useRef({});

    R.useEffect(function () { // nouvelle alerte critique : bandeau + son + vibration
      var fresh = [];
      pl.forEach(function (x) { if (x.overall_level === "red" && prev.current[x.astronaut_id] !== "red") fresh.push(x); prev.current[x.astronaut_id] = x.overall_level; });
      if (fresh.length) {
        setToast("Alerte critique : " + fresh.map(function (x) { return x.name; }).join(", "));
        if (sound) { beep(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
      }
    }, [pl]);
    R.useEffect(function () { if (!toast) return; var id = setTimeout(function () { setToast(""); }, 6000); return function () { clearTimeout(id); }; }, [toast]);
    R.useEffect(function () { // Échap : retour à la liste
      function key(e) { if (e.key === "Escape") setSel(null); }
      window.addEventListener("keydown", key); return function () { window.removeEventListener("keydown", key); };
    }, []);

    var critAlerts = alerts.filter(function (a) { return a.level === "red"; }).length;
    var nav = [["crew", "Équipage"], ["alerts", "Alertes", critAlerts || null]].concat(isAdmin ? [["users", "Comptes"], ["audit", "Journal d'accès"]] : []);
    function go(k) { setSel(null); setTab(k); }
    function open(id) { setSel(id); if (s.mode === "demo") addDemoAudit(s.user.id, id); }
    function shell(children) { return h(Layout, { s: s, onLogout: p.onLogout, nav: nav, active: tab, onNav: go }, children, toast ? h("div", { className: "toast", role: "alert" }, toast) : null); }
    if (sel) return shell(h(A.TwinDashboard, Object.assign({ variant: "suit", astronautId: sel, onBack: function () { setSel(null); } }, conn)));

    var sorted = pl.slice().sort(function (a, b) { return SEV[a.overall_level] - SEV[b.overall_level] || (a.astronaut_id > b.astronaut_id ? 1 : -1); });
    var n = { green: 0, yellow: 0, red: 0 }; pl.forEach(function (x) { n[x.overall_level]++; });
    var reds = sorted.filter(function (x) { return x.overall_level === "red"; });
    function kpi(label, val, color) { return h("div", { className: "kpi", style: { "--c": color } }, h("small", null, label), h("b", { className: "mono" }, val)); }

    function table() {
      var cols = ["État", "Astronaute", "FC", "SpO₂", "HRV", "Tête", "Torse", "Jambes", "Rayonn.", "Constats"];
      return h("div", { className: "tablewrap" }, h("table", { className: "tbl" },
        h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { key: c }, c); }))),
        h("tbody", null, sorted.map(function (x) {
          var v = x.vitals || {}, sq = function (l) { return h("td", null, h("i", { className: "sq " + l })); };
          return h("tr", { key: x.astronaut_id, className: "clk", onClick: function () { open(x.astronaut_id); } },
            h("td", null, h("span", { className: "chip " + LV_CLS[x.overall_level] }, LV_FR[x.overall_level])),
            h("td", null, h("b", null, x.name), h("div", { className: "ac-id mono" }, x.astronaut_id)),
            h("td", { className: "mono" }, v.hr ? Math.round(v.hr) : "—"), h("td", { className: "mono" }, v.spo2 ? Math.round(v.spo2) + " %" : "—"), h("td", { className: "mono" }, v.hrv ? Math.round(v.hrv) : "—"),
            sq(x.zones.head.level), sq(x.zones.torso.level), sq(x.zones.legs.level), sq(x.radiation.level),
            h("td", { className: "why" }, whyOf(x).slice(0, 2).join(" · ") || "—"));
        }))));
    }
    var crewBody = !sorted.length ? h("div", { className: "empty" }, s.mode === "normal" ? "Aucun astronaute pour l'instant. Créez un compte astronaute avec la même mission." : "Chargement…")
      : view === "table" ? table()
      : h("div", { className: "crew" }, sorted.map(function (x) { return h(AstroCard, { key: x.astronaut_id, x: x, onOpen: function () { open(x.astronaut_id); } }); }));

    var content;
    if (tab === "crew") {
      content = h("div", { className: "screen" },
        h(Head, { title: "Équipage", sub: (s.user.mission || "Toutes les missions") + " · " + pl.length + " astronaute" + (pl.length > 1 ? "s" : "") + " · actualisation automatique" },
          h("div", { className: "seg sm", role: "group", "aria-label": "Affichage" }, [["cards", "Cartes"], ["table", "Tableau"]].map(function (o) {
            return h("button", { key: o[0], className: view === o[0] ? "on" : "", onClick: function () { lsSet("astro.view", o[0]); setView(o[0]); } }, o[1]);
          })),
          h("button", { className: "btn ghost sm", onClick: function () { lsSet(KSND, sound ? "0" : "1"); setSound(!sound); }, "aria-pressed": sound }, h(Icon, { n: sound ? "sound" : "mute", size: 16 }), sound ? "Son activé" : "Son coupé"),
          h("button", { className: "btn ghost sm", onClick: function () { report(s, pl, alerts); } }, h(Icon, { n: "file", size: 16 }), "Rapport")),
        h("div", { className: "kpis" }, kpi("Équipage", pl.length, "var(--blue)"), kpi("Nominal", n.green, "var(--ok)"), kpi("À surveiller", n.yellow, "var(--warn)"), kpi("Critique", n.red, "var(--bad)")),
        reds.length ? h("div", { className: "banner", role: "alert" }, h(Icon, { n: "bell", size: 22 }),
          h("div", { className: "grow" }, h("b", null, reds.length + (reds.length > 1 ? " astronautes en état critique" : " astronaute en état critique")), h("div", { className: "hint" }, reds.map(function (x) { return x.name; }).join(", "))),
          h("button", { className: "btn sm", onClick: function () { open(reds[0].astronaut_id); } }, "Ouvrir")) : null,
        h("div", { className: "split" },
          h("div", { className: "split-main" }, crewBody),
          wide ? h("aside", { className: "feed" }, h("div", { className: "sec-title" }, "Flux d'alertes en direct"), h(AlertList, { items: alerts.slice(0, 10) })) : null));
    } else if (tab === "alerts") content = h("div", { className: "screen" }, h(Head, { title: "Alertes", sub: alerts.length + " enregistrée" + (alerts.length > 1 ? "s" : "") }), h(AlertList, { items: alerts }));
    else if (tab === "users") content = h("div", { className: "screen" }, h(Head, { title: "Comptes", sub: "Base de données locale" }), h(Remote, { key: "users", s: s, what: "users", title: function (n) { return "Base de données · " + n + " comptes"; }, cols: ["ID", "Nom", "Âge", "Mission", "Rôle"], row: function (u) { return [u.id, u.name, u.age, u.mission, ROLE_FR[u.role]]; } }));
    else content = h("div", { className: "screen" }, h(Head, { title: "Journal d'accès", sub: "Qui a consulté quelles données" }), h(Remote, { key: "audit", s: s, what: "audit", title: function (n) { return "Journal d'accès · " + n + " entrées"; }, cols: ["Date", "Utilisateur", "Action", "Cible"], row: function (a) { return [fmtTime(a.ts), a.actor, a.action, a.target]; } }));
    return shell(h("div", { className: "section" }, content));
  }

  function AstroView(p) {
    var s = p.s, al = useAlerts(s, []);
    return h(Layout, { s: s, onLogout: p.onLogout, nav: [["twin", "Mon jumeau"]], active: "twin", onNav: function () {} },
      h("div", { className: "screen" },
        h(A.TwinDashboard, Object.assign({ variant: "suit", astronautId: s.mode === "demo" ? s.user.id : undefined }, connProps(s))),
        s.mode === "normal" ? h("div", { className: "section" }, h("div", { className: "sec-title" }, "Mes alertes récentes"), h(AlertList, { items: al.slice(0, 10) })) : null));
  }

  function Main(p) {
    return p.s.user.role === "astronaut" ? h(AstroView, { s: p.s, onLogout: p.onLogout }) : h(CrewView, { s: p.s, onLogout: p.onLogout });
  }

  function App() {
    var a = R.useState(function () { return lsGet(KM, null); }), mode = a[0], setMode = a[1];
    var b = R.useState(ssGet), s = b[0], setS = b[1];
    R.useEffect(function () { // session normale sauvegardée : vérifier qu'elle est encore valide
      if (s && s.mode === "normal") jf(s.base, "/api/auth/me", authH(s)).catch(function () { ssSet(null); setS(null); });
    }, []);
    function pick(m) { lsSet(KM, m); setMode(m); }
    function login(x) { ssSet(x); setS(x); }
    function logout() { ssSet(null); setS(null); }
    function back() { try { localStorage.removeItem(KM); } catch (e) {} setMode(null); }
    if (s) return h(Main, { s: s, onLogout: logout });
    return h(Shell, null, !mode ? h(ModeSelect, { onPick: pick }) : h(Auth, { mode: mode, onLogin: login, onBack: back }));
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
