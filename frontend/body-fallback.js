/* body-fallback.js : silhouette 2D (SVG) utilisée quand three.js n'est pas disponible (aucune connexion, fichiers vendor/ absents).
 * Même interface que body-twin.js : BodyTwinView (cliquable) et BodyPreview (petit aperçu). Ne remplace rien si le 3D est chargé. */
(function (global) {
  var ns = global.AstroTwin = global.AstroTwin || {};
  if (ns.BodyTwinView && ns.BodyPreview) return;
  var R = global.React, h = R.createElement;
  var C = { green: "#34d399", yellow: "#fbbf24", red: "#ff4d5e" };
  function lv(s) { return s < 0.4 ? "green" : s < 0.7 ? "yellow" : "red"; }

  function Figure(p) {
    var r = p.risks || {}, rad = p.radiation || 0, sel = p.selectedZone, suit = p.variant === "suit";
    function zone(k, props) {
      var l = lv(r[k] || 0), on = sel === k;
      return h("g", { onClick: p.onSelectZone ? function (e) { e.stopPropagation(); p.onSelectZone(sel === k ? null : k); } : null, style: { cursor: p.onSelectZone ? "pointer" : "default" } },
        props.map(function (s, i) {
          return h(s.t, Object.assign({ key: i, fill: C[l], fillOpacity: l === "green" ? 0.28 : 0.82, stroke: on ? "#fff" : C[l], strokeWidth: on ? 2.2 : 1.2, strokeOpacity: on ? 1 : 0.7 }, s.a));
        }));
    }
    var ra = lv(rad);
    return h("svg", { viewBox: "0 0 200 400", style: { width: "100%", height: "100%", display: "block" }, role: "img", "aria-label": "Silhouette du corps avec zones de risque" },
      h("defs", null, h("filter", { id: "gl", x: "-30%", y: "-30%", width: "160%", height: "160%" }, h("feGaussianBlur", { stdDeviation: 4 }))),
      h("ellipse", { cx: 100, cy: 205, rx: 92, ry: 190, fill: "none", stroke: C[ra], strokeWidth: 1.4, strokeDasharray: "3 6", opacity: ra === "green" ? 0.22 : 0.9 }),
      r.torso >= 0.7 ? h("rect", { x: 62, y: 84, width: 76, height: 130, rx: 24, fill: C.red, opacity: 0.35, filter: "url(#gl)" }) : null,
      zone("legs", [{ t: "rect", a: { x: 68, y: 226, width: 29, height: 150, rx: 13 } }, { t: "rect", a: { x: 103, y: 226, width: 29, height: 150, rx: 13 } }]),
      zone("torso", [{ t: "rect", a: { x: 62, y: 84, width: 76, height: 138, rx: 22 } }, { t: "rect", a: { x: 30, y: 90, width: 26, height: 128, rx: 13 } }, { t: "rect", a: { x: 144, y: 90, width: 26, height: 128, rx: 13 } }]),
      zone("head", [{ t: "circle", a: { cx: 100, cy: 48, r: suit ? 30 : 25 } }, { t: "rect", a: { x: 91, y: 70, width: 18, height: 16, rx: 5 } }]),
      suit ? h("g", { pointerEvents: "none", opacity: 0.55 }, h("rect", { x: 84, y: 100, width: 32, height: 22, rx: 5, fill: "none", stroke: "#e8edf5", strokeWidth: 1.2 }), h("path", { d: "M82 44q18-14 36 0", fill: "none", stroke: "#e8edf5", strokeWidth: 1.4 })) : null);
  }

  ns.BodyTwinView = function (p) {
    return h("div", { style: { position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: "56px 0 52px" }, onClick: function () { if (p.onSelectZone) p.onSelectZone(null); } },
      h("div", { style: { height: "100%", aspectRatio: "1 / 2", maxWidth: "100%" } }, h(Figure, p)));
  };
  ns.BodyPreview = function (p) {
    var hh = (p.height || 220) - 16;
    return h("div", { style: { height: p.height || 220, display: "flex", alignItems: "center", justifyContent: "center" } }, h("div", { style: { height: hh, width: hh / 2 } }, h(Figure, p)));
  };
})(window);
