/* twin-dashboard.js
 * Dashboard astronaute + vue synoptique médecin de bord + mock de /api/astronaut/body-status
 * Sans build : React par CDN, pas de JSX, pas de lib de graphiques.
 * Ordre de chargement : three, OrbitControls, React, body-twin.js, puis ce fichier.
 * Expose uniquement window.AstroTwin.{ toTwinProps, useBodyStatus, TwinDashboard, FlightSurgeonView }.
 * Mode mock : ne pas passer baseUrl. Mode réel : baseUrl + token.
 */
(function (global) {
  var R = global.React, h = R.createElement;

  /* ---------- Constantes & helpers ---------- */
  var LV = { green: "#4fb286", yellow: "#e3a43b", red: "#e5534b" };
  var LV_FR = { green: "Nominal", yellow: "À surveiller", red: "Critique" };
  var LV_SCORE = { green: 0.15, yellow: 0.55, red: 0.9 };
  var ORDER = { green: 0, yellow: 1, red: 2 };
  var ZONE_FR = { head: "Tête", torso: "Torse", legs: "Jambes", skin: "Radiations" };
  var Z3 = ["head", "torso", "legs"];
  var PART_FR = { neck: "Cou", arms: "Bras", forearms: "Avant-bras", hands: "Mains", thighs: "Cuisses", calves: "Mollets", feet: "Pieds" };
  var PART_ZONE = { neck: "head", arms: "torso", forearms: "torso", hands: "torso", thighs: "legs", calves: "legs", feet: "legs" };
  var PART_ORDER = ["neck", "arms", "forearms", "hands", "thighs", "calves", "feet"];
  var card = { background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 };
  var muted = { color: "#94a3b8", fontSize: 13 };

  function ext(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function levelOf(s) { return s < 0.4 ? "green" : s < 0.7 ? "yellow" : "red"; }
  function worst(levels) { return levels.reduce(function (a, b) { return ORDER[b] > ORDER[a] ? b : a; }, "green"); }
  function seedOf(id) { var n = 0, i; id = id || ""; for (i = 0; i < id.length; i++) n += id.charCodeAt(i); return n; }
  function zoneScore(o) { return !o ? 0 : (o.score != null ? o.score : (LV_SCORE[o.level] || 0)); }

  // réponse API -> props du jumeau 3D
  function toTwinProps(s) {
    return {
      risks: { head: zoneScore(s.zones.head), torso: zoneScore(s.zones.torso), legs: zoneScore(s.zones.legs) },
      radiation: zoneScore(s.radiation)
    };
  }

  function overallLevel(s) {
    return worst(Z3.map(function (z) { return s.zones[z].level; }).concat(s.radiation.level));
  }

  /* ---------- Mock de l'API (même format que le contrat) ---------- */
  function createMock(seed) {
    var t = seed || 0, hr = 72, spo2 = 97, hrv = 45, co2 = 900, temp = 22.5, core = 36.8, resp = 15, hyd = 92;
    function walk(v, step, lo, hi) { return Math.max(lo, Math.min(hi, v + (Math.random() - 0.5) * step)); }
    return {
      next: function () {
        t++;
        var spike = (t % 90) > 70; // pic de CO2 périodique
        hr = walk(hr, 4, 55, 125);
        spo2 = walk(spo2, 0.8, 90, 99);
        co2 = spike ? Math.min(3000, co2 + 180) : Math.max(800, co2 - 60);
        hrv = walk(hrv + (spike ? -2.5 : 1), 4, 15, 70);
        temp = walk(temp, 0.2, 20, 26);
        core = walk(core, 0.06, 36.3, 37.8); resp = walk(resp, 1.2, 11, 24); hyd = walk(hyd, 0.4, 82, 98);

        var sc = {
          head: clamp((50 - hrv) / 40 * 0.6 + (co2 - 800) / 2500 * 0.6),
          torso: clamp(Math.abs(hr - 70) / 70 * 0.7 + (98 - spo2) / 8 * 0.5),
          legs: clamp(0.15 + 0.75 * (0.5 + 0.5 * Math.sin(t / 45))),
          skin: clamp(0.1 + 0.4 * (0.5 + 0.5 * Math.sin(t / 70 + 1)))
        };
        var why = { head: [], torso: [], legs: [], skin: [] };
        if (hrv < 35) why.head.push("HRV bas (" + Math.round(hrv) + " ms)");
        if (co2 > 1500) why.head.push("CO2 cabine élevé (" + Math.round(co2) + " ppm)");
        if (hr > 100) why.torso.push("FC élevée (" + Math.round(hr) + " bpm)");
        if (spo2 < 94) why.torso.push("SpO2 basse (" + Math.round(spo2) + " %)");
        if (sc.legs > 0.4) why.legs.push("Faible charge musculaire récente");
        if (sc.skin > 0.4) why.skin.push("Flux de radiations en hausse");

        function z(k) { return { level: levelOf(sc[k]), score: +sc[k].toFixed(2), reasons: why[k] }; }
        var zones = { head: z("head"), torso: z("torso"), legs: z("legs") };
        var radiation = z("skin");

        var correlations = [];
        if (co2 > 2000 && hrv < 35) correlations.push({ zone: "head", cause: "co2", message: "HRV en baisse pendant un pic de CO2 cabine" });

        var P = {
          neck: { s: clamp(sc.head * 0.7 + 0.05), t: 34.5, n: "Tension cervicale, stress" },
          arms: { s: clamp(sc.torso * 0.6 + sc.skin * 0.2), t: 33.5, n: "Fatigue musculaire" },
          forearms: { s: clamp(sc.torso * 0.5 + 0.1 + 0.1 * Math.sin(t / 30)), t: 33.0, n: "Charge de travail élevée" },
          hands: { s: clamp(sc.torso * 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(t / 55 + 2))), t: 31.5, n: "Circulation réduite, mains froides" },
          thighs: { s: clamp(sc.legs * 0.9), t: 33.5, n: "Perte de masse musculaire" },
          calves: { s: clamp(sc.legs), t: 32.5, n: "Atrophie, retour veineux" },
          feet: { s: clamp(sc.legs * 0.6 + 0.15 * (0.5 + 0.5 * Math.sin(t / 40 + 1))), t: 30.5, n: "Extrémités froides, gonflement" }
        };
        var parts = {}, tsum = 0, tn = 0;
        Object.keys(P).forEach(function (k) {
          var o = P[k], tt = o.t - (o.s > 0.4 ? (o.s - 0.4) * 5 : 0) + (Math.random() - 0.5) * 0.2;
          parts[k] = { level: levelOf(o.s), score: +o.s.toFixed(2), temp_c: +tt.toFixed(1), reasons: o.s >= 0.4 ? [o.n] : [] };
          tsum += tt; tn++;
        });
        var bodyStats = { core_temp_c: +core.toFixed(1), skin_temp_c: +(tsum / tn).toFixed(1), resp_rate: Math.round(resp),
          bp_sys: Math.round(118 + (hr - 70) * 0.25), bp_dia: Math.round(76 + (hr - 70) * 0.12), hydration_pct: Math.round(hyd) };

        var actions = {
          head: co2 > 2000 ? "Vérifier la ventilation / purge du CO2, puis session de relaxation guidée" : "Session de relaxation guidée",
          torso: "Repos et contrôle cardiovasculaire",
          legs: "Lancer un protocole d'exercice de résistance",
          skin: "Se replier dans la zone abritée du module"
        };
        var countermeasures = [];
        Z3.forEach(function (k) { if (zones[k].level !== "green") countermeasures.push({ zone: k, level: zones[k].level, action: actions[k] }); });
        if (radiation.level !== "green") countermeasures.push({ zone: "skin", level: radiation.level, action: actions.skin });

        return {
          session_id: "mock", role: "astronaut", ts: new Date().toISOString(),
          zones: zones, radiation: radiation,
          vitals: { hr: hr, spo2: spo2, hrv: hrv },
          cabin: { co2_ppm: co2, temp_c: temp },
          correlations: correlations, countermeasures: countermeasures,
          body: bodyStats, parts: parts
        };
      }
    };
  }

  var MOCK_PATIENTS = [
    { id: "A-01", name: "Astronaute A-01" }, { id: "A-02", name: "Astronaute A-02" },
    { id: "A-03", name: "Astronaute A-03" }, { id: "A-04", name: "Astronaute A-04" }
  ];

  function summarize(p, s) {
    return { astronaut_id: p.id, name: p.name, overall_level: overallLevel(s), zones: s.zones, radiation: s.radiation };
  }

  /* ---------- Hooks de données ---------- */
  function authHeaders(token) { return { Authorization: "Bearer " + token }; }

  // L'IA de traitement peut oublier un champ ou donner un score sur 100 : on remet tout au contrat.
  function normScore(o) {
    var sc = o && o.score != null ? parseFloat(o.score) : NaN;
    if (isNaN(sc)) sc = (o && LV_SCORE[o.level]) || 0;
    if (sc > 1) sc = sc / 100;
    return clamp(sc);
  }
  function normZone(o) {
    var sc = normScore(o), lv = o && ORDER[o.level] != null ? o.level : levelOf(sc);
    return { level: lv, score: sc, reasons: (o && o.reasons) || [] };
  }
  function normParts(o) {
    var r = {};
    if (!o) return r;
    Object.keys(o).forEach(function (k) {
      var z = normZone(o[k]); z.temp_c = o[k] && o[k].temp_c != null ? +o[k].temp_c : null; r[k] = z;
    });
    return r;
  }
  function normBody(b) {
    if (!b) return null;
    return { core_temp_c: +b.core_temp_c || 0, skin_temp_c: +b.skin_temp_c || 0, resp_rate: +b.resp_rate || 0,
             bp_sys: +b.bp_sys || 0, bp_dia: +b.bp_dia || 0, hydration_pct: +b.hydration_pct || 0 };
  }
  function normalizeStatus(s) {
    s = s || {};
    var z = s.zones || {};
    return {
      session_id: s.session_id, role: s.role, ts: s.ts,
      zones: { head: normZone(z.head), torso: normZone(z.torso), legs: normZone(z.legs) },
      radiation: normZone(s.radiation),
      vitals: { hr: +(s.vitals && s.vitals.hr) || 0, spo2: +(s.vitals && s.vitals.spo2) || 0, hrv: +(s.vitals && s.vitals.hrv) || 0 },
      cabin: { co2_ppm: +(s.cabin && s.cabin.co2_ppm) || 0, temp_c: +(s.cabin && s.cabin.temp_c) || 0 },
      correlations: s.correlations || [], countermeasures: s.countermeasures || [],
      body: normBody(s.body), parts: normParts(s.parts)
    };
  }

  // o = { baseUrl, token, astronautId, everyMs }
  function useBodyStatus(o) {
    var mock = R.useRef(null), hist = R.useRef({ hr: [], spo2: [], hrv: [], co2: [] });
    var a = R.useState(null), data = a[0], setData = a[1];
    var b = R.useState(null), err = b[0], setErr = b[1];
    R.useEffect(function () {
      var alive = true;
      hist.current = { hr: [], spo2: [], hrv: [], co2: [] };
      if (!o.baseUrl) mock.current = createMock(seedOf(o.astronautId));
      function accept(s) {
        var H = hist.current;
        [["hr", s.vitals.hr], ["spo2", s.vitals.spo2], ["hrv", s.vitals.hrv], ["co2", s.cabin.co2_ppm]].forEach(function (p) {
          H[p[0]].push(p[1]); if (H[p[0]].length > 60) H[p[0]].shift();
        });
        if (alive) { setData(s); setErr(null); }
      }
      function load() {
        if (!o.baseUrl) return accept(mock.current.next());
        var url = o.baseUrl + "/api/astronaut/body-status" + (o.astronautId ? "?astronaut_id=" + encodeURIComponent(o.astronautId) : "");
        fetch(url, { headers: authHeaders(o.token) })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (j) { accept(normalizeStatus(j)); })
          .catch(function (e) { if (alive) setErr(e.message); });
      }
      load();
      var id = setInterval(load, o.everyMs || 2000);
      return function () { alive = false; clearInterval(id); };
    }, [o.baseUrl, o.token, o.astronautId]);
    return { data: data, history: hist.current, error: err };
  }

  // vue médecin : liste des patients
  function usePatients(o) {
    var mocks = R.useRef(null);
    var a = R.useState([]), list = a[0], setList = a[1];
    R.useEffect(function () {
      var alive = true;
      if (!o.baseUrl && !mocks.current) mocks.current = MOCK_PATIENTS.map(function (p, i) { return createMock(i * 25); });
      function load() {
        if (!o.baseUrl) {
          return setList(MOCK_PATIENTS.map(function (p, i) { return summarize(p, mocks.current[i].next()); }));
        }
        fetch(o.baseUrl + "/api/astronaut/body-status", { headers: authHeaders(o.token) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (alive) setList((j.patients || []).map(function (x) {
              var n = normalizeStatus(x); x.zones = n.zones; x.radiation = n.radiation;
              if (ORDER[x.overall_level] == null) x.overall_level = overallLevel(n);
              return x;
            }));
          });
      }
      load();
      var id = setInterval(load, o.everyMs || 3000);
      return function () { alive = false; clearInterval(id); };
    }, [o.baseUrl, o.token]);
    return list;
  }

  /* ---------- Interface (mobile d'abord, sobre) ---------- */
  var T = { bg: "#0e1013", card: "#181b20", card2: "#20242a", fg: "#eceef1", mut: "#8d949e" };
  card = { background: T.card, borderRadius: 18, padding: 14 };
  muted = { color: T.mut, fontSize: 13, lineHeight: 1.4 };
  var page = { background: T.bg, color: T.fg, padding: "12px 12px 28px", display: "grid", gap: 14, fontFamily: "-apple-system, 'Segoe UI', Roboto, system-ui, sans-serif" };
  var num = { fontVariantNumeric: "tabular-nums" };

  function Badge(p) {
    return h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.07)", borderRadius: 999, padding: "5px 11px", fontSize: 12, color: T.fg } },
      h("i", { style: { width: 7, height: 7, borderRadius: 4, background: LV[p.level], display: "inline-block" } }), LV_FR[p.level]);
  }

  function Spark(p) {
    var v = p.values;
    if (!v || v.length < 2) return h("div", { style: { height: 26 } });
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), d = hi - lo || 1;
    var pts = v.map(function (y, i) { return (i / (v.length - 1) * 100).toFixed(1) + "," + (24 - (y - lo) / d * 22).toFixed(1); }).join(" ");
    return h("svg", { viewBox: "0 0 100 26", width: "100%", height: 26, preserveAspectRatio: "none" },
      h("polyline", { points: pts, fill: "none", stroke: p.color, strokeWidth: 1.6, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }));
  }

  function vLevel(kind, v) {
    if (kind === "hr") return (v > 120 || v < 45) ? "red" : (v > 100 || v < 55) ? "yellow" : "green";
    if (kind === "spo2") return v < 90 ? "red" : v < 94 ? "yellow" : "green";
    if (kind === "hrv") return v < 20 ? "red" : v < 35 ? "yellow" : "green";
    if (kind === "co2") return v > 2500 ? "red" : v > 1500 ? "yellow" : "green";
    return "green";
  }

  // pastille de mesure posée sur l'image du mannequin
  function Chip(p) {
    var lv = vLevel(p.kind, p.value);
    return h("div", { style: { background: "rgba(14,16,19,.66)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderRadius: 14, padding: "8px 12px", minWidth: 86 } },
      h("div", { style: { fontSize: 11, color: T.mut } }, p.label),
      h("div", { style: ext(num, { fontSize: 22, fontWeight: 600, lineHeight: 1.15 }) }, Math.round(p.value), h("span", { style: { fontSize: 11, color: T.mut, marginLeft: 3, fontWeight: 400 } }, p.unit)),
      h("div", { style: { height: 3, borderRadius: 2, marginTop: 5, background: LV[lv], opacity: lv === "green" ? 0.3 : 1 } }));
  }

  function Row(p) {
    return h("div", { onClick: p.onClick, style: { background: T.card, borderRadius: 16, padding: "12px 14px", display: "flex", gap: 12, alignItems: "flex-start" } },
      h("i", { style: { width: 9, height: 9, borderRadius: 5, background: p.color, marginTop: 6, flex: "none" } }),
      h("div", { style: { minWidth: 0 } }, p.children));
  }

  function tl(kind, v) { // niveau d'une mesure du corps
    if (kind === "core") return (v < 35.5 || v > 38.4) ? "red" : (v < 36.1 || v > 37.5) ? "yellow" : "green";
    if (kind === "resp") return (v < 10 || v > 25) ? "red" : (v < 12 || v > 20) ? "yellow" : "green";
    if (kind === "hyd") return v < 85 ? "red" : v < 90 ? "yellow" : "green";
    if (kind === "bp") return (v > 160 || v < 90) ? "red" : (v > 140 || v < 100) ? "yellow" : "green";
    if (kind === "cab") return (v < 18 || v > 28) ? "yellow" : "green";
    return "green";
  }

  function Stat(p) {
    return h("div", { style: { background: T.card, borderRadius: 16, padding: "10px 12px" } },
      h("div", { style: { fontSize: 11, color: T.mut } }, p.label),
      h("div", { style: ext(num, { fontSize: 20, fontWeight: 600, marginTop: 2 }) }, p.value, h("span", { style: { fontSize: 11, color: T.mut, marginLeft: 3, fontWeight: 400 } }, p.unit)),
      h("div", { style: { height: 3, borderRadius: 2, marginTop: 6, background: LV[p.level], opacity: p.level === "green" ? 0.3 : 1 } }));
  }

  // températures, autres mesures du corps, et détail par partie du corps
  function BodyPanel(p) {
    var s = p.s, b = s.body, parts = s.parts || {};
    var keys = PART_ORDER.filter(function (k) { return parts[k]; });
    if (!b && !keys.length) return null;
    return h("div", { style: { display: "grid", gap: 10 } },
      h("div", { style: { fontSize: 13, color: T.mut, padding: "0 4px", letterSpacing: 0.3 } }, "CORPS"),
      b ? h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
        h(Stat, { label: "Température centrale", value: b.core_temp_c.toFixed(1), unit: "°C", level: tl("core", b.core_temp_c) }),
        h(Stat, { label: "Température cutanée", value: b.skin_temp_c.toFixed(1), unit: "°C", level: "green" }),
        h(Stat, { label: "Respiration", value: Math.round(b.resp_rate), unit: "/min", level: tl("resp", b.resp_rate) }),
        h(Stat, { label: "Tension", value: Math.round(b.bp_sys) + "/" + Math.round(b.bp_dia), unit: "mmHg", level: tl("bp", b.bp_sys) }),
        h(Stat, { label: "Hydratation", value: Math.round(b.hydration_pct), unit: "%", level: tl("hyd", b.hydration_pct) }),
        h(Stat, { label: "Température cabine", value: s.cabin.temp_c.toFixed(1), unit: "°C", level: tl("cab", s.cabin.temp_c) })) : null,
      keys.length ? h("div", { style: ext(card, { padding: "6px 14px" }) },
        keys.map(function (k, i) {
          var o = parts[k];
          return h("div", { key: k, onClick: function () { p.onZone(PART_ZONE[k]); }, style: { padding: "9px 0", borderTop: i ? "1px solid rgba(255,255,255,.06)" : "none", cursor: "pointer" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
              h("i", { style: { width: 8, height: 8, borderRadius: 4, background: LV[o.level], flex: "none", opacity: o.level === "green" ? 0.45 : 1 } }),
              h("div", { style: { flex: 1, fontSize: 14 } }, PART_FR[k] || k),
              h("div", { style: ext(num, { fontSize: 14, color: o.level === "green" ? T.mut : T.fg }) }, o.temp_c != null ? o.temp_c.toFixed(1) + " °C" : "")),
            o.reasons && o.reasons.length ? h("div", { style: ext(muted, { marginLeft: 18, marginTop: 2, fontSize: 12 }) }, o.reasons.join(" · ")) : null);
        })) : null);
  }

  function VariantToggle(p) {
    return h("div", { style: { display: "inline-flex", background: "rgba(14,16,19,.66)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderRadius: 999, padding: 3, pointerEvents: "auto" } },
      [["mannequin", "Mannequin"], ["suit", "Combinaison"]].map(function (o) {
        var on = p.value === o[0];
        return h("button", { key: o[0], onClick: function () { p.onChange(o[0]); }, style: { border: 0, borderRadius: 999, padding: "5px 11px", fontSize: 12, cursor: "pointer", background: on ? "#2a2f37" : "transparent", color: on ? T.fg : T.mut } }, o[1]);
      }));
  }

  function useWide() {
    var s = R.useState(window.innerWidth >= 900), w = s[0], set = s[1];
    R.useEffect(function () {
      function f() { set(window.innerWidth >= 900); }
      window.addEventListener("resize", f);
      return function () { window.removeEventListener("resize", f); };
    }, []);
    return w;
  }

  // grande carte de mesure (écran large)
  function VitalCard(p) {
    var lv = vLevel(p.kind, p.value);
    return h("div", { style: ext(card, { padding: "14px 16px" }) },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
        h("div", { style: muted }, p.label),
        h("i", { style: { width: 8, height: 8, borderRadius: 4, background: LV[lv], display: "inline-block", opacity: lv === "green" ? 0.4 : 1 } })),
      h("div", { style: ext(num, { fontSize: 34, fontWeight: 600, lineHeight: 1.2 }) }, Math.round(p.value), h("span", { style: { fontSize: 13, color: T.mut, marginLeft: 5, fontWeight: 400 } }, p.unit)),
      h(Spark, { values: p.values, color: LV[lv] }));
  }

  // props : baseUrl, token, astronautId, onBack
  function TwinDashboard(p) {
    var r = useBodyStatus(p), s = r.data, wide = useWide();
    var zs = R.useState(null), zone = zs[0], setZone = zs[1];
    var vs = R.useState(p.variant || "mannequin"), variant = vs[0], setVariant = vs[1];
    if (!s) return h("div", { style: ext(page, { minHeight: 300 }) }, h("div", { style: muted }, r.error ? "Erreur : " + r.error : "Connexion au flux…"));

    var tw = toTwinProps(s), H = r.history, lvl = overallLevel(s);
    var cm = {};
    (s.countermeasures || []).forEach(function (c) { cm[c.zone] = c.action; });
    var items = Z3.map(function (k) { return { key: k, z: s.zones[k] }; }).concat([{ key: "skin", z: s.radiation }]);
    var alerts = items.filter(function (i) { return i.z.level !== "green"; })
      .sort(function (a, b) { return ORDER[b.z.level] - ORDER[a.z.level] || b.z.score - a.z.score; });
    var label = { fontSize: 13, color: T.mut, padding: "0 4px", letterSpacing: 0.3 };

    var head = h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px" } },
      h("div", null,
        p.onBack ? h("button", { onClick: p.onBack, style: { background: "none", border: "none", color: T.mut, padding: 0, fontSize: 13, display: "block", marginBottom: 2, cursor: "pointer" } }, "‹ Équipage") : null,
        h("div", { style: { fontSize: 20, fontWeight: 600 } }, p.astronautId ? "Astronaute " + p.astronautId : "Mon jumeau"),
        h("div", { style: muted }, "Mis à jour à l’instant")),
      h(Badge, { level: lvl }));

    var caption = h("div", { style: { position: "absolute", left: 0, right: 0, bottom: 12, textAlign: "center", pointerEvents: "none" } },
      h("span", { style: { background: "rgba(14,16,19,.66)", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: zone ? T.fg : T.mut } },
        zone ? ZONE_FR[zone] + " · " + LV_FR[s.zones[zone].level] : (wide ? "Cliquez sur le corps pour une zone" : "Touchez le corps pour une zone")));

    function chips(side) {
      var L = side === "l" ? [["hr", "Cœur", "bpm", s.vitals.hr], ["spo2", "Oxygène", "%", s.vitals.spo2]] : [["hrv", "HRV", "ms", s.vitals.hrv], ["co2", "CO₂ cabine", "ppm", s.cabin.co2_ppm]];
      var o = { position: "absolute", top: 12, display: "grid", gap: 8, pointerEvents: "none" };
      o[side === "l" ? "left" : "right"] = 10;
      return h("div", { style: o }, L.map(function (c) { return h(Chip, { key: c[0], kind: c[0], label: c[1], unit: c[2], value: c[3] }); }));
    }

    var hero = h("div", { style: { position: "relative", height: wide ? "calc(100vh - 140px)" : "min(64vh, 520px)", minHeight: wide ? 520 : 380, borderRadius: 26, overflow: "hidden", background: "radial-gradient(ellipse at 50% 38%, #2b3038 0%, #171a1f 62%, #121418 100%)" } },
      h(global.AstroTwin.BodyTwinView, { risks: tw.risks, radiation: tw.radiation, selectedZone: zone, onSelectZone: setZone, variant: variant }),
      wide ? null : chips("l"), wide ? null : chips("r"),
      h("div", { style: { position: "absolute", left: 0, right: 0, top: 12, textAlign: "center", pointerEvents: "none" } }, h(VariantToggle, { value: variant, onChange: setVariant })),
      caption);

    var corr = (s.correlations || []).map(function (c, i) {
      return h(Row, { key: "c" + i, color: LV.red },
        h("div", { style: { fontWeight: 600, fontSize: 14 } }, "Lien habitat et santé"),
        h("div", { style: muted }, ZONE_FR[c.zone] + " : " + c.message));
    });
    var alertRows = alerts.length ? alerts.map(function (a) {
      return h(Row, { key: a.key, color: LV[a.z.level], onClick: function () { if (a.key !== "skin") setZone(a.key); } },
        h("div", { style: { fontWeight: 600, fontSize: 14 } }, ZONE_FR[a.key] + " · " + LV_FR[a.z.level]),
        (a.z.reasons || []).length ? h("div", { style: muted }, a.z.reasons.join(" · ")) : null,
        cm[a.key] ? h("div", { style: { fontSize: 13, marginTop: 6, color: T.fg } }, cm[a.key]) : null);
    }) : [h(Row, { key: "ok", color: LV.green }, h("div", { style: muted }, "Tout est dans les normes."))];

    if (wide) {
      var V = [["hr", "Fréquence cardiaque", "bpm", s.vitals.hr, H.hr], ["spo2", "Oxygène (SpO₂)", "%", s.vitals.spo2, H.spo2],
               ["hrv", "Variabilité cardiaque", "ms", s.vitals.hrv, H.hrv], ["co2", "CO₂ cabine", "ppm", s.cabin.co2_ppm, H.co2]];
      return h("div", { style: ext(page, { maxWidth: 1440, margin: "0 auto", padding: "16px 24px 24px" }) },
        head,
        h("div", { style: { display: "grid", gridTemplateColumns: "290px minmax(0,1fr) 380px", gap: 16, alignItems: "start" } },
          h("div", { style: { display: "grid", gap: 12 } }, V.map(function (v) { return h(VitalCard, { key: v[0], kind: v[0], label: v[1], unit: v[2], value: v[3], values: v[4] }); })),
          hero,
          h("div", { style: { display: "grid", gap: 10 } }, corr, h("div", { style: label }, "À SURVEILLER"), alertRows, h(BodyPanel, { s: s, onZone: setZone }))));
    }

    return h("div", { style: ext(page, { maxWidth: 520, margin: "0 auto" }) },
      head, hero, corr,
      h("div", { style: label }, "À SURVEILLER"), alertRows,
      h(BodyPanel, { s: s, onZone: setZone }),
      h("div", { style: label }, "TENDANCES"),
      h("div", { style: ext(card, { display: "grid", gap: 10 }) },
        [["Cœur", H.hr, "hr", s.vitals.hr], ["HRV", H.hrv, "hrv", s.vitals.hrv], ["CO₂ cabine", H.co2, "co2", s.cabin.co2_ppm]].map(function (t) {
          return h("div", { key: t[0], style: { display: "grid", gridTemplateColumns: "86px 1fr", alignItems: "center", gap: 10 } },
            h("div", { style: muted }, t[0]), h(Spark, { values: t[1], color: LV[vLevel(t[2], t[3])] }));
        })));
  }

  // props : baseUrl, token
  function FlightSurgeonView(p) {
    var list = usePatients(p), sel = R.useState(null), id = sel[0], setId = sel[1], wide = useWide();
    var vs = R.useState("mannequin"), variant = vs[0], setVariant = vs[1];
    if (id) return h(TwinDashboard, { baseUrl: p.baseUrl, token: p.token, astronautId: id, variant: variant, onBack: function () { setId(null); } });
    var sorted = list.slice().sort(function (a, b) { return ORDER[b.overall_level] - ORDER[a.overall_level]; });
    var nRed = sorted.filter(function (x) { return x.overall_level === "red"; }).length;
    var nYel = sorted.filter(function (x) { return x.overall_level === "yellow"; }).length;
    return h("div", { style: ext(page, wide ? { maxWidth: 1440, margin: "0 auto", padding: "16px 24px 24px", minHeight: "calc(100vh - 60px)", alignContent: "start" } : { maxWidth: 520, margin: "0 auto" }) },
      h("div", { style: { padding: "0 4px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" } },
        h("div", null,
          h("div", { style: { fontSize: 20, fontWeight: 600 } }, "Équipage"),
          h("div", { style: muted }, nRed + " critique · " + nYel + " à surveiller · " + sorted.length + " astronautes")),
        h(VariantToggle, { value: variant, onChange: setVariant })),
      h("div", { style: { display: "grid", gap: 12, gridTemplateColumns: wide ? "repeat(auto-fill, minmax(260px, 1fr))" : "1fr 1fr" } },
        sorted.map(function (x) {
          var dots = Z3.map(function (k) { return x.zones[k].level; }).concat(x.radiation ? [x.radiation.level] : []);
          var tw = toTwinProps(x);
          return h("div", { key: x.astronaut_id, onClick: function () { setId(x.astronaut_id); }, style: ext(card, { cursor: "pointer", padding: 12 }) },
            h("div", { style: { fontWeight: 600, fontSize: 14 } }, x.name),
            h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, flexWrap: "wrap" } },
              h(Badge, { level: x.overall_level }),
              h("div", { style: { display: "flex", gap: 5 } },
                dots.map(function (l, i) { return h("i", { key: i, style: { width: 9, height: 9, borderRadius: 5, background: LV[l], display: "inline-block", opacity: l === "green" ? 0.45 : 1 } }); }))),
            h("div", { style: { marginTop: 10, borderRadius: 16, overflow: "hidden", background: "radial-gradient(ellipse at 50% 40%, #2b3038 0%, #171a1f 70%)" } },
              h(global.AstroTwin.BodyPreview, { variant: variant, risks: tw.risks, radiation: tw.radiation, height: wide ? 280 : 210 })));
        })));
  }

  global.AstroTwin = ext(global.AstroTwin || {}, {
    toTwinProps: toTwinProps,
    normalizeStatus: normalizeStatus,
    useBodyStatus: useBodyStatus,
    usePatients: usePatients,
    TwinDashboard: TwinDashboard,
    FlightSurgeonView: FlightSurgeonView
  });
})(window);
