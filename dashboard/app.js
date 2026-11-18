/* Token Radar dashboard: renders window.TOKEN_RADAR (written by main.ts).
   Sort, filter, search and a detail view for every ranked protocol. */
(function () {
  "use strict";
  var D = window.TOKEN_RADAR || { meta: {}, rows: [], comparables: [] };
  var rows = D.rows || [];
  var meta = D.meta || {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    if (n == null) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function pct(n) {
    if (n == null) return "—";
    var cls = n > 0 ? "pos" : n < 0 ? "neg" : "";
    return '<span class="' + cls + '">' + (n > 0 ? "+" : "") + n.toFixed(1) + "%</span>";
  }
  function ageLabel(days) {
    if (days == null) return "—";
    if (days < 30) return days + "d";
    if (days < 365) return (days / 30).toFixed(0) + "mo";
    return (days / 365).toFixed(1) + "y";
  }

  var state = { q: "", cat: "", chain: "", scope: "all", sort: "value" };

  // ---- header, KPIs, filter options -------------------------------------
  $("metaLine").textContent =
    "Snapshot " + meta.as_of + " · " + meta.source + " · floor $" +
    (meta.floor_usd / 1e6).toFixed(0) + "M · " + meta.protocols_scanned +
    " protocols scanned · " + meta.pre_token_found + " record no token · watchlist " +
    meta.watchlist_covered + "/" + meta.watchlist_total + " covered";
  var top = rows[0];
  $("kpis").innerHTML =
    kpi("Rank #1", top ? top.name : "—", top ? money(top.implied_value_usd) + " implied" : "") +
    kpi("Board total implied", money(meta.total_implied_value_usd), rows.length + " pre-token protocols") +
    kpi("Watchlist covered", meta.watchlist_covered + " / " + meta.watchlist_total, "every watchlist protocol is ranked") +
    kpi("Global FDV/TVL multiple", "×" + meta.global_multiple, "median of " + meta.trading_protocols + " trading protocols");
  function kpi(k, v, s) {
    return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
  }

  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { $("cat").appendChild(opt(c, c)); });
  chains.forEach(function (c) { $("chain").appendChild(opt(c, c)); });
  function opt(v, t) { var o = document.createElement("option"); o.value = v; o.textContent = t; return o; }

  // ---- filtering + sorting -------------------------------------------------
  var SORTS = {
    value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    age: function (a, b) { return b.age_days - a.age_days; },
    density: function (a, b) { return b.value_per_1k_usd - a.value_per_1k_usd; },
    name: function (a, b) { return a.name.localeCompare(b.name); }
  };
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.scope === "watchlist" && !r.on_watchlist) return false;
      if (state.scope === "below" && r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + " " + (r.category || "") + " " + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(SORTS[state.sort]);
  }

  function render() {
    var list = filtered();
    $("countLine").textContent = "Showing " + list.length + " of " + rows.length +
      " ranked protocols · sorted by " + $("sort").selectedOptions[0].textContent.replace("Sort: ", "");
    $("rows").innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : "") + '>' +
        '<td class="rank' + (r.rank === 1 ? " top1" : "") + '">' + r.rank + "</td>" +
        '<td><span class="nm">' + esc(r.name) + '</span><div class="sub2">' + esc(r.slug) + "</div></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc((r.chains || []).slice(0, 3).join(", ")) + ((r.chains || []).length > 3 ? " +" + (r.chains.length - 3) : "") + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + ageLabel(r.age_days) + "</td>" +
        '<td class="num"><b>' + money(r.implied_value_usd) + "</b></td>" +
        '<td class="num">' + money(r.value_per_1k_usd) + "</td>" +
        "<td>" + (r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge pre">PRE-TOKEN</span>') + "</td></tr>";
    }).join("");
    $("compRows").innerHTML = (D.comparables || []).map(function (c) {
      return "<tr><td><b>" + esc(c.name) + "</b></td><td>" + esc(c.category || "—") + '</td><td class="num">' +
        money(c.tvl_usd) + '</td><td class="num">' + money(c.mcap_usd) + '</td><td class="num">×' + c.multiple.toFixed(2) + "</td></tr>";
    }).join("");
  }

  // ---- detail view ---------------------------------------------------------
  var selected = null;
  var fromDeepLink = false;
  function factorRow(label, value, frac, text) {
    return '<div class="frow"><span>' + esc(label) + '</span><span class="bar"><i style="width:' +
      Math.round(frac * 100) + '%"></i></span><span class="fv">' + esc(text) + "</span></div>";
  }
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    selected = slug;
    var d = $("detail");
    d.hidden = false;
    d.innerHTML =
      "<h2>#" + r.rank + " — " + esc(r.name) + "</h2>" +
      '<div class="badges">' +
      '<span class="badge pre">RECORDS NO TOKEN</span>' +
      (r.on_watchlist ? '<span class="badge wl">ON WATCHLIST · TVL ≥ $50M</span>' : '<span class="badge pre">BELOW THE FLOOR · EARLY FIND</span>') +
      '<span class="badge pre">' + esc(r.category || "Uncategorized") + "</span></div>" +
      '<div class="stats">' +
      stat("Implied value", money(r.implied_value_usd)) +
      stat("Implied FDV", money(r.implied_fdv_usd)) +
      stat("TVL", money(r.tvl_usd)) +
      stat("7-day change", (r.change_7d == null ? "—" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(1) + "%")) +
      stat("Running with no token", ageLabel(r.age_days) + " (" + r.age_days + " days)") +
      stat("Chains", (r.chains || []).slice(0, 4).join(", ") + ((r.chains || []).length > 4 ? " +" + (r.chains.length - 4) + " more" : "")) +
      stat("Category multiple", "×" + r.multiple.toFixed(2)) +
      stat("Value per $1k TVL", money(r.value_per_1k_usd)) +
      "</div>" +
      '<div class="factors"><h3>Why this value — factor breakdown</h3>' +
      factorRow("Category FDV/TVL multiple", r.multiple, Math.min(r.multiple / 3, 1), "×" + r.multiple.toFixed(2)) +
      factorRow("Growth factor (7d TVL)", r.growth_factor, (r.growth_factor - 0.85) / 0.4, "×" + r.growth_factor.toFixed(2)) +
      factorRow("Launch probability (age)", r.launch_probability, r.launch_probability, (r.launch_probability * 100).toFixed(0) + "%") +
      factorRow("Breadth factor (chains)", r.breadth_factor, (r.breadth_factor - 1) / 0.15, "×" + r.breadth_factor.toFixed(2)) +
      factorRow("Airdrop share assumption", 0.07, 0.07, "7% of FDV") +
      "</div>" +
      '<div class="steps"><h3>How to farm it — concrete plan</h3><ol>' +
      r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
      "</ol></div>" +
      '<p class="note">Implied value is this entry’s model claim from the snapshot’s own figures. ' +
      esc(r.name) + " records no token in DefiLlama’s data — that is not proof it has none, and no launch is promised.</p>";
    function stat(k, v) {
      return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
    }
    render();
    if (!fromDeepLink) d.scrollIntoView({ behavior: "auto", block: "start" });
  }

  // ---- events + deep links ---------------------------------------------------
  $("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.getAttribute("data-slug"));
  });
  $("q").addEventListener("input", function () { state.q = this.value; render(); });
  $("cat").addEventListener("change", function () { state.cat = this.value; render(); });
  $("chain").addEventListener("change", function () { state.chain = this.value; render(); });
  $("scope").addEventListener("change", function () { state.scope = this.value; render(); });
  $("sort").addEventListener("change", function () { state.sort = this.value; render(); });
  $("reset").addEventListener("click", function () {
    state = { q: "", cat: "", chain: "", scope: "all", sort: "value" };
    $("q").value = ""; $("cat").value = ""; $("chain").value = "";
    $("scope").value = "all"; $("sort").value = "value";
    render();
  });

  var params = new URLSearchParams(window.location.search);
  if (params.get("category")) { state.cat = params.get("category"); $("cat").value = state.cat; }
  if (params.get("chain")) { state.chain = params.get("chain"); $("chain").value = state.chain; }
  if (params.get("scope")) { state.scope = params.get("scope"); $("scope").value = state.scope; }
  if (params.get("sort")) { state.sort = params.get("sort"); $("sort").value = state.sort; }
  if (params.get("q")) { state.q = params.get("q"); $("q").value = state.q; }
  render();
  if (params.get("view") === "detail" && params.get("slug")) {
    // Deep link: put the detail card above the board so it is the first
    // thing on the page (no scroll needed — headless renderers paint it).
    fromDeepLink = true;
    document.body.classList.add("detail-mode");
    var board = $("board");
    board.parentNode.insertBefore($("detail"), board);
    showDetail(params.get("slug"));
  }
})();
