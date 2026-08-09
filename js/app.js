      "use strict";

      // ---------- fixed config ----------
      const RUNNER_NAMES = [
        "Ulrik Olsson",
        "Håkan Svensson",
        "Anders Svensk",
        "Michael Wehlin",
      ];
      const NUM_STAGES = 5;
      const COMBINED = NUM_STAGES;
      const seriesColor = (i) => `var(--series-${(i % 8) + 1})`;

      // ---------- data model ----------
      function blankStage(n) {
        return {
          numControls: n,
          superman: Array(n).fill(""),
          splits: RUNNER_NAMES.map(() => Array(n).fill("")),
          extras: [], // runners who ran only this stage: [{ name, splits: [...] }]
        };
      }
      let stages = Array.from({ length: NUM_STAGES }, () => blankStage(1));
      let loadStatus = Array.from({ length: NUM_STAGES }, () => ({
        ok: false,
        err: "not loaded yet",
      }));
      let activeTab = 0;
      // Graph baseline: "superman" (ideal) or "best" (fastest actual runner).
      let refMode = "superman";
      try {
        const rm = localStorage.getItem("superman.refmode");
        if (rm === "superman" || rm === "best") refMode = rm;
      } catch (e) {}

      // ---------- parsing / formatting ----------
      function parseSplit(str) {
        if (str == null) return null;
        const s = String(str).trim().replace(",", ".");
        if (s === "") return null;
        const m = s.match(/^(\d+)[:.](\d{1,2})$/);
        if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        return null;
      }
      function fmtClock(sec) {
        const m = Math.floor(sec / 60),
          s = sec % 60;
        return m + ":" + String(s).padStart(2, "0");
      }
      function fmtBehind(sec) {
        if (sec === 0) return "0";
        return (sec > 0 ? "−" : "+") + fmtClock(Math.abs(sec));
      }

      // ---------- JSON normalization ----------
      function toTimeStr(v) {
        return v == null ? "" : String(v).trim();
      }

      function findRunnerKey(src, name) {
        const keys = Object.keys(src);
        const want = name.trim().toLowerCase();
        let k = keys.find((key) => key.trim().toLowerCase() === want);
        if (!k) {
          const first = want.split(/\s+/)[0];
          k = keys.find(
            (key) => key.trim().toLowerCase().split(/\s+/)[0] === first,
          );
        }
        return k || null;
      }

      function normalizeStage(obj) {
        if (!obj || typeof obj !== "object")
          throw new Error("not a JSON object");
        const src = obj.runners || obj.splits || obj;
        const supermanArr = Array.isArray(obj.superman) ? obj.superman : [];

        const runnerArrays = []; // the fixed core 4, in order
        const extras = []; // any additional runners in this file
        if (Array.isArray(src)) {
          RUNNER_NAMES.forEach((_, ri) =>
            runnerArrays.push(Array.isArray(src[ri]) ? src[ri] : []),
          );
          for (let j = RUNNER_NAMES.length; j < src.length; j++)
            if (Array.isArray(src[j]))
              extras.push({ name: `Runner ${j + 1}`, splits: src[j] });
        } else if (src && typeof src === "object") {
          const used = new Set();
          RUNNER_NAMES.forEach((name) => {
            const k = findRunnerKey(src, name);
            if (k) {
              used.add(k);
              runnerArrays.push(Array.isArray(src[k]) ? src[k] : []);
            } else runnerArrays.push([]);
          });
          for (const key of Object.keys(src)) {
            if (used.has(key) || !Array.isArray(src[key])) continue;
            extras.push({ name: key.trim(), splits: src[key] });
          }
        } else {
          RUNNER_NAMES.forEach(() => runnerArrays.push([]));
        }

        let n = Number.isFinite(obj.controls)
          ? obj.controls
          : Number.isFinite(obj.numControls)
            ? obj.numControls
            : 0;
        if (!n)
          n = Math.max(
            supermanArr.length,
            ...runnerArrays.map((a) => a.length),
            ...extras.map((e) => e.splits.length),
            1,
          );
        n = Math.max(1, Math.min(40, n | 0));

        if (
          !(
            runnerArrays.some((a) => a.length) ||
            supermanArr.length ||
            extras.length
          )
        )
          throw new Error("no runner or superman splits found");

        const st = blankStage(n);
        for (let c = 0; c < n; c++) {
          if (supermanArr[c] != null)
            st.superman[c] = toTimeStr(supermanArr[c]);
          runnerArrays.forEach((arr, ri) => {
            if (arr[c] != null) st.splits[ri][c] = toTimeStr(arr[c]);
          });
        }
        st.extras = extras.map((e) => ({
          name: e.name,
          splits: Array.from({ length: n }, (_, c) =>
            e.splits[c] != null ? toTimeStr(e.splits[c]) : "",
          ),
        }));
        return st;
      }

      // ---------- loading from stageN.json ----------
      async function loadAllStages() {
        document.getElementById("loadMsg").textContent = "Loading…";
        const loaded = [],
          missing = [];
        for (let s = 1; s <= NUM_STAGES; s++) {
          try {
            const res = await fetch(`data/stage${s}.json?_=${Date.now()}`, {
              cache: "no-store",
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            stages[s - 1] = normalizeStage(await res.json());
            loadStatus[s - 1] = { ok: true };
            loaded.push(s);
          } catch (err) {
            stages[s - 1] = blankStage(1);
            loadStatus[s - 1] = { ok: false, err: err.message };
            missing.push(s);
          }
        }
        const onFile = location.protocol === "file:";
        document.getElementById("fileBanner").hidden = !(
          onFile && loaded.length === 0
        );
        const fh = document.getElementById("folderHint");
        if (fh)
          fh.textContent =
            decodeURIComponent(location.pathname.replace(/\/[^/]*$/, "")) ||
            "this folder";

        const msg = document.getElementById("loadMsg");
        if (loaded.length === NUM_STAGES)
          msg.textContent = `All ${NUM_STAGES} stage files loaded.`;
        else if (loaded.length)
          msg.textContent = `Loaded stages ${loaded.join(", ")} · missing ${missing.join(", ")}.`;
        else
          msg.textContent = onFile
            ? "No files loaded — see the note below."
            : "No stage files found in the data folder.";

        renderTabs();
        renderEditor();
        renderChart();
      }

      // ---------- computation ----------
      function supermanForLeg(st, c) {
        const manual = parseSplit(st.superman[c]);
        if (manual != null) return manual;
        let best = null;
        for (let ri = 0; ri < RUNNER_NAMES.length; ri++) {
          const v = parseSplit(st.splits[ri][c]);
          if (v != null && (best == null || v < best)) best = v;
        }
        for (const ex of st.extras) {
          const v = parseSplit(ex.splits[c]);
          if (v != null && (best == null || v < best)) best = v;
        }
        return best;
      }

      // The core 4 runners (present in every stage and in Combined).
      function coreRoster() {
        return RUNNER_NAMES.map((name, ri) => ({
          name,
          color: seriesColor(ri),
          getRaw: (si, c) => stages[si].splits[ri][c],
        }));
      }
      // Core 4 + this stage's extra runners (single-stage view only).
      function stageRoster(si) {
        const extras = stages[si].extras.map((ex, j) => ({
          name: ex.name,
          color: seriesColor(RUNNER_NAMES.length + j),
          extra: true,
          getRaw: (_si, c) => ex.splits[c],
        }));
        return coreRoster().concat(extras);
      }

      // Builds each runner's cumulative time behind the baseline, control by
      // control. The baseline at each control is either Superman's cumulative
      // (mode "superman") or the CURRENT LEADER — the smallest cumulative time
      // among the runners at that control (mode "best"). In "best" mode the
      // leader can change along the course, so whoever leads sits at 0 there.
      function computeSeries(stageIdxList, roster) {
        const lines = roster.map((r) => ({
          name: r.name,
          color: r.color,
          extra: !!r.extra,
          getRaw: r.getRaw,
          pts: [{ x: 0, behind: 0 }],
          broken: false,
          cumElapsed: 0, // actual running time so far
        }));
        const bestMode = refMode === "best";

        const columns = [{ x: 0 }];
        const boundaries = [];
        const stageSpans = [];
        let x = 0;
        let supCum = 0, // Superman's cumulative (for "superman" mode)
          supBroken = false;

        stageIdxList.forEach((si, k) => {
          const st = stages[si];
          const startX = x;
          for (let c = 0; c < st.numControls; c++) {
            x++;
            columns.push({ x, stage: si, ctrl: c + 1 });

            // 1. advance each runner's actual elapsed time
            for (const ln of lines) {
              if (ln.broken) continue;
              const v = parseSplit(ln.getRaw(si, c));
              if (v == null) {
                ln.broken = true;
                continue;
              }
              ln.cumElapsed += v;
            }

            // 2. baseline cumulative time at this control
            let baseCum;
            if (bestMode) {
              baseCum = Infinity;
              for (const ln of lines)
                if (!ln.broken) baseCum = Math.min(baseCum, ln.cumElapsed);
              if (!isFinite(baseCum)) baseCum = null;
            } else {
              const sup = supermanForLeg(st, c);
              if (sup == null) supBroken = true;
              else if (!supBroken) supCum += sup;
              baseCum = supBroken ? null : supCum;
            }

            // 3. plot each runner's gap to the baseline (0 = at the front)
            for (const ln of lines) {
              if (ln.broken) continue;
              if (baseCum == null) {
                ln.broken = true;
                continue;
              }
              ln.pts.push({
                x,
                behind: ln.cumElapsed - baseCum,
                stage: si,
                ctrl: c + 1,
              });
            }
          }
          stageSpans.push({ stage: si, startX, endX: x });
          if (k < stageIdxList.length - 1) boundaries.push(x);
        });

        return {
          lines,
          columns,
          boundaries,
          stageSpans,
          totalLegs: x,
          mode: refMode,
        };
      }

      // ---------- geometry ----------
      const VB = { w: 920, h: 560 };
      const M = { top: 40, right: 150, bottom: 52, left: 56 };
      const PW = VB.w - M.left - M.right;
      const PH = VB.h - M.top - M.bottom;

      function niceMax(v) {
        if (v <= 0) return 10;
        const pow = Math.pow(10, Math.floor(Math.log10(v)));
        const n = v / pow;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
      }
      function niceStep(range) {
        const raw = range / 6;
        if (raw <= 0) return 10;
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / pow;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
      }

      let scale = null;
      function buildScale(series) {
        let maxLoss = 0,
          minLoss = 0;
        for (const ln of series.lines)
          for (const p of ln.pts) {
            if (p.behind > maxLoss) maxLoss = p.behind;
            if (p.behind < minLoss) minLoss = p.behind;
          }
        const hi = niceMax(Math.max(maxLoss, 10));
        const lo = minLoss < 0 ? -niceMax(-minLoss) : 0;
        const span = hi - lo || 1;
        const total = Math.max(1, series.totalLegs);
        scale = {
          hi,
          lo,
          span,
          xOf: (x) => M.left + (x / total) * PW,
          yOf: (behind) => M.top + ((behind - lo) / span) * PH,
        };
        return scale;
      }

      function esc(s) {
        return String(s).replace(
          /[&<>"]/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
        );
      }

      // ---------- chart ----------
      function renderChart() {
        const combined = activeTab === COMBINED;
        const stageList = combined ? [0, 1, 2, 3, 4] : [activeTab];
        const roster = combined ? coreRoster() : stageRoster(activeTab);
        const series = computeSeries(stageList, roster);
        const sc = buildScale(series);
        const svg = document.getElementById("chart");
        const parts = [];

        const step = niceStep(sc.hi - sc.lo);
        const first = Math.ceil(sc.lo / step) * step;
        for (let v = first; v <= sc.hi + 0.5; v += step) {
          const y = sc.yOf(v);
          parts.push(
            `<line x1="${M.left}" y1="${y}" x2="${M.left + PW}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`,
          );
          const label = v === 0 ? "0" : v > 0 ? "−" + v : "+" + -v;
          parts.push(
            `<text x="${M.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--muted)" style="font-variant-numeric:tabular-nums">${label}</text>`,
          );
        }

        const axisY = M.top + PH;
        if (combined) {
          for (const bx of series.boundaries) {
            const x = sc.xOf(bx);
            parts.push(
              `<line x1="${x}" y1="${M.top}" x2="${x}" y2="${axisY}" stroke="var(--muted)" stroke-width="2.5"/>`,
            );
          }
          for (const sp of series.stageSpans) {
            const cx = sc.xOf((sp.startX + sp.endX) / 2);
            parts.push(
              `<text x="${cx}" y="${axisY + 20}" text-anchor="middle" font-size="12" fill="var(--text-secondary)">Etapp ${sp.stage + 1}</text>`,
            );
          }
        } else {
          for (const col of series.columns) {
            const x = sc.xOf(col.x);
            parts.push(
              `<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="var(--axis)" stroke-width="1"/>`,
            );
            const lab =
              col.x === 0
                ? "0"
                : col.ctrl === stages[col.stage].numControls
                  ? "M"
                  : col.ctrl;
            parts.push(
              `<text x="${x}" y="${axisY + 20}" text-anchor="middle" font-size="12" fill="var(--muted)">${lab}</text>`,
            );
          }
          parts.push(
            `<text x="${M.left + PW / 2}" y="${VB.h - 8}" text-anchor="middle" font-size="12" fill="var(--text-secondary)">Control number</text>`,
          );
        }

        // Baseline at 0. In Superman mode draw the dedicated ideal line; in
        // Best mode the 0-line is the current leader, so no fixed baseline line.
        const y0 = sc.yOf(0);
        if (series.mode === "superman") {
          parts.push(
            `<line x1="${M.left}" y1="${y0}" x2="${M.left + PW}" y2="${y0}" stroke="var(--text-primary)" stroke-width="2" stroke-linecap="round"/>`,
          );
          parts.push(
            `<text x="${M.left + PW + 8}" y="${y0 + 4}" font-size="12.5" font-weight="600" fill="var(--text-primary)">Superman</text>`,
          );
        }

        const endLabels = [];
        for (const ln of series.lines) {
          if (ln.pts.length < 2) continue;
          const d = ln.pts
            .map((p) => `${sc.xOf(p.x)},${sc.yOf(p.behind)}`)
            .join(" ");
          parts.push(
            `<polyline points="${d}" fill="none" stroke="${ln.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
          );
          for (const p of ln.pts)
            parts.push(
              `<circle cx="${sc.xOf(p.x)}" cy="${sc.yOf(p.behind)}" r="4" fill="${ln.color}" stroke="var(--surface-1)" stroke-width="2"/>`,
            );
          const last = ln.pts[ln.pts.length - 1];
          endLabels.push({
            y: sc.yOf(last.behind),
            x: sc.xOf(last.x),
            name: ln.name,
            broken: ln.broken,
          });
        }

        endLabels.sort((a, b) => a.y - b.y);
        for (let i = 1; i < endLabels.length; i++)
          if (endLabels[i].y - endLabels[i - 1].y < 15)
            endLabels[i].y = endLabels[i - 1].y + 15;
        for (const el of endLabels)
          parts.push(
            `<text x="${el.x + 8}" y="${el.y + 4}" font-size="12.5" fill="var(--text-secondary)">${esc(el.name)}${el.broken ? " ∅" : ""}</text>`,
          );

        parts.push(
          `<g id="hoverLayer" style="display:none"><line id="crossline" y1="${M.top}" y2="${axisY}" stroke="var(--muted)" stroke-width="1"/></g>`,
        );
        parts.push(
          `<rect id="capture" x="${M.left}" y="${M.top}" width="${PW}" height="${PH}" fill="transparent"/>`,
        );

        svg.innerHTML = parts.join("");
        renderLegend(series);
        attachHover(svg, series, sc, combined);

        const baselineLabel =
          series.mode === "best" ? "ledaren" : "Superman";
        const scopeLabel = combined ? "Total" : `Etapp ${activeTab + 1}`;
        document.getElementById("chartTitle").textContent =
          `${scopeLabel} — versus ${baselineLabel}`;
        const refWord =
          series.mode === "best" ? "the current leader" : "the ideal race";
        document.getElementById("chartSub").textContent = combined
          ? `Cumulative time behind ${refWord} across all 5 stages (seconds)`
          : `Time behind ${refWord}, cumulative (seconds)`;
      }

      function renderLegend(series) {
        const el = document.getElementById("legend");
        el.innerHTML = "";
        const mk = (color, name) => {
          const span = document.createElement("span");
          const sw = document.createElement("span");
          sw.className = "swatch";
          sw.style.background = color;
          span.appendChild(sw);
          span.appendChild(document.createTextNode(name));
          return span;
        };
        if (series.mode === "superman")
          el.appendChild(mk("var(--text-primary)", "Superman"));
        for (const ln of series.lines) el.appendChild(mk(ln.color, ln.name));
      }

      // ---------- hover ----------
      function attachHover(svg, series, sc, combined) {
        const capture = svg.querySelector("#capture");
        const hoverLayer = svg.querySelector("#hoverLayer");
        const crossline = svg.querySelector("#crossline");
        const tooltip = document.getElementById("tooltip");
        const wrap = svg.parentElement;
        const total = Math.max(1, series.totalLegs);

        function nearestX(clientX) {
          const r = svg.getBoundingClientRect();
          const vbx = ((clientX - r.left) / r.width) * VB.w;
          const raw = ((vbx - M.left) / PW) * total;
          return Math.max(0, Math.min(total, Math.round(raw)));
        }

        function move(ev) {
          const xi = nearestX(ev.clientX);
          const col =
            series.columns.find((c) => c.x === xi) || series.columns[0];
          const x = sc.xOf(xi);
          hoverLayer.style.display = "";
          crossline.setAttribute("x1", x);
          crossline.setAttribute("x2", x);
          hoverLayer.querySelectorAll("circle").forEach((n) => n.remove());

          const rows = [];
          for (const ln of series.lines) {
            const p = ln.pts.find((pt) => pt.x === xi);
            if (!p) continue;
            const cy = sc.yOf(p.behind);
            const dot = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "circle",
            );
            dot.setAttribute("cx", x);
            dot.setAttribute("cy", cy);
            dot.setAttribute("r", 5);
            dot.setAttribute("fill", ln.color);
            dot.setAttribute("stroke", "var(--surface-1)");
            dot.setAttribute("stroke-width", 2);
            hoverLayer.appendChild(dot);
            rows.push({ name: ln.name, color: ln.color, behind: p.behind });
          }
          rows.sort((a, b) => a.behind - b.behind);

          tooltip.innerHTML = "";
          const head = document.createElement("div");
          head.className = "tt-head";
          const isFinish =
            xi !== 0 && col.ctrl === stages[col.stage].numControls;
          const ctrlText = isFinish ? "Mål" : "Kontroll " + col.ctrl;
          if (xi === 0) head.textContent = "Start";
          else if (combined)
            head.textContent = `Etapp ${col.stage + 1} · ${ctrlText}`;
          else head.textContent = ctrlText;
          tooltip.appendChild(head);

          const addRow = (color, name, valText) => {
            const row = document.createElement("div");
            row.className = "tt-row";
            const lab = document.createElement("span");
            lab.className = "lab";
            const sw = document.createElement("span");
            sw.className = "swatch";
            sw.style.background = color;
            lab.appendChild(sw);
            lab.appendChild(document.createTextNode(name));
            const val = document.createElement("span");
            val.className = "val";
            val.textContent = valText;
            row.appendChild(lab);
            row.appendChild(val);
            tooltip.appendChild(row);
          };
          if (series.mode === "superman")
            addRow("var(--text-primary)", "Superman", "0");
          for (const r of rows) addRow(r.color, r.name, fmtBehind(r.behind));

          const wr = wrap.getBoundingClientRect();
          let px = ev.clientX - wr.left + 14;
          const py = ev.clientY - wr.top + 14;
          if (px + 190 > wr.width) px = ev.clientX - wr.left - 190;
          tooltip.style.left = px + "px";
          tooltip.style.top = py + "px";
          tooltip.style.opacity = "1";
        }
        function leave() {
          hoverLayer.style.display = "none";
          tooltip.style.opacity = "0";
        }
        capture.addEventListener("pointermove", move);
        capture.addEventListener("pointerleave", leave);
      }

      // ---------- tabs ----------
      function renderTabs() {
        const nav = document.getElementById("tabs");
        nav.innerHTML = "";
        for (let s = 0; s < NUM_STAGES; s++) {
          const b = document.createElement("button");
          b.textContent = "Etapp " + (s + 1);
          if (activeTab === s) b.classList.add("active");
          if (!loadStatus[s].ok) b.classList.add("missing");
          b.addEventListener("click", () => setTab(s));
          nav.appendChild(b);
        }
        const spacer = document.createElement("span");
        spacer.className = "spacer";
        nav.appendChild(spacer);

        const cb = document.createElement("button");
        cb.className = "combined" + (activeTab === COMBINED ? " active" : "");
        cb.textContent = "Totalresultat";
        cb.addEventListener("click", () => setTab(COMBINED));
        nav.appendChild(cb);
      }

      function setTab(t) {
        activeTab = t;
        renderTabs();
        renderEditor();
        renderChart();
      }

      // ---------- read-only stage table ----------
      // ---- shared table cell/row builders ----
      const legCell = (text, blank, auto) =>
        `<td class="val${blank ? " blank" : ""}">${auto ? `<span class="auto">${esc(text)}</span>` : esc(text)}</td>`;
      const cumCell = (text, blank) =>
        `<td class="cum${blank ? " blank" : ""}">${esc(text)}</td>`;

      // Emit an entity as two rows: values on top, cumulative total beneath.
      function pushEntity(color, name, legValues, note) {
        // legValues[i] = { sec, text, blank, auto }
        const nameCell = `<strong>${esc(name)}</strong>${note ? ` <span class="cumlabel">${esc(note)}</span>` : ""}`;
        const body2 = [];
        body2.push(
          `<tr class="leg-row"><td rowspan="2"><span class="swatch" style="background:${color}"></span></td><td class="name">${nameCell}</td>`,
        );
        legValues.forEach((v) => body2.push(legCell(v.text, v.blank, v.auto)));
        body2.push(`</tr>`);
        body2.push(`<tr class="cum-row"><td class="name"></td>`);
        let cum = 0,
          broken = false;
        legValues.forEach((v) => {
          if (broken || v.sec == null) {
            broken = true;
            body2.push(cumCell("–", true));
          } else {
            cum += v.sec;
            body2.push(cumCell(fmtClock(cum), false));
          }
        });
        body2.push(`</tr>`);
        return body2.join("");
      }

      // Total elapsed time (seconds) for one stage; null if any control missing.
      function stageTotal(getRaw, st) {
        let total = 0;
        for (let c = 0; c < st.numControls; c++) {
          const v = parseSplit(getRaw(c));
          if (v == null) return null;
          total += v;
        }
        return total;
      }

      // ---- Combined standings: stages as columns, totals + cumulative ----
      function renderCombinedTable() {
        const statusEl = document.getElementById("combinedStatus");
        const missing = loadStatus
          .map((s, i) => (s.ok ? null : i + 1))
          .filter((x) => x);
        statusEl.className = missing.length
          ? "stage-status err"
          : "stage-status";
        statusEl.textContent = missing.length
          ? `Stages not loaded: ${missing.join(", ")} — totals for those are blank.`
          : "Total time per stage, with the running competition total beneath.";

        const head = ["<thead><tr><th></th><th>Runner</th>"];
        for (let s = 1; s <= NUM_STAGES; s++)
          head.push(`<th class="val">Etapp ${s}</th>`);
        head.push("</tr></thead>");

        // Superman total per stage (its ideal race = sum of fastest legs)
        const supValues = stages.map((st) => {
          let sec = 0,
            ok = true;
          for (let c = 0; c < st.numControls; c++) {
            const v = supermanForLeg(st, c);
            if (v == null) {
              ok = false;
              break;
            }
            sec += v;
          }
          return ok
            ? { sec, text: fmtClock(sec), blank: false, auto: false }
            : { sec: null, text: "–", blank: true, auto: false };
        });

        // Core runners' totals per stage
        const rows = RUNNER_NAMES.map((name, ri) => {
          let overall = 0,
            complete = true;
          const values = stages.map((st) => {
            const sec = stageTotal((c) => st.splits[ri][c], st);
            if (sec == null) {
              complete = false;
              return { sec: null, text: "–", blank: true, auto: false };
            }
            overall += sec;
            return { sec, text: fmtClock(sec), blank: false, auto: false };
          });
          return {
            color: seriesColor(ri),
            name,
            values,
            total: complete ? overall : Infinity,
          };
        });
        rows.sort((a, b) => a.total - b.total);

        const body = ["<tbody>"];
        body.push(pushEntity("var(--text-primary)", "Superman", supValues));
        for (const r of rows) body.push(pushEntity(r.color, r.name, r.values));
        body.push("</tbody>");

        document.getElementById("combinedTable").innerHTML =
          head.join("") + body.join("");
      }

      function renderEditor() {
        const card = document.getElementById("editorCard");
        const combinedCard = document.getElementById("combinedCard");
        if (activeTab === COMBINED) {
          card.style.display = "none";
          combinedCard.style.display = "";
          renderCombinedTable();
          return;
        }
        combinedCard.style.display = "none";
        card.style.display = "";

        const st = stages[activeTab];
        const status = loadStatus[activeTab];
        const statusEl = document.getElementById("stageStatus");
        if (status.ok) {
          statusEl.className = "stage-status";
          statusEl.textContent = `Loaded from data/stage${activeTab + 1}.json — ${st.numControls} control${st.numControls === 1 ? "" : "s"}.`;
        } else {
          statusEl.className = "stage-status err";
          statusEl.textContent = `data/stage${activeTab + 1}.json not loaded (${status.err}). Put the file in the data folder and click “Reload data files”.`;
        }

        const table = document.getElementById("dataTable");
        const head = ["<thead><tr><th></th><th>Runner</th>"];
        for (let c = 1; c <= st.numControls; c++)
          head.push(
            `<th class="val">${c === st.numControls ? "M" : "K" + c}</th>`,
          );
        head.push("</tr></thead>");

        const body = ["<tbody>"];

        // Superman: effective value per leg (manual, else auto-fastest)
        const supValues = [];
        for (let c = 0; c < st.numControls; c++) {
          const manual = parseSplit(st.superman[c]);
          const sup = supermanForLeg(st, c);
          if (manual != null)
            supValues.push({
              sec: manual,
              text: st.superman[c],
              blank: false,
              auto: false,
            });
          else if (sup != null)
            supValues.push({
              sec: sup,
              text: fmtClock(sup),
              blank: false,
              auto: true,
            });
          else
            supValues.push({ sec: null, text: "–", blank: true, auto: false });
        }
        body.push(pushEntity("var(--text-primary)", "Superman", supValues));

        // Build every runner (core 4 + this stage's extras), then order them
        // by total stage time — fastest directly below Superman.
        const buildValues = (splitsArr) => {
          const values = [];
          let total = 0,
            complete = true;
          for (let c = 0; c < st.numControls; c++) {
            const raw = splitsArr[c];
            const sec = parseSplit(raw);
            if (sec != null) {
              values.push({ sec, text: raw, blank: false, auto: false });
              total += sec;
            } else {
              values.push({ sec: null, text: "–", blank: true, auto: false });
              complete = false;
            }
          }
          // Runners with a missing split have no valid total — sort them last.
          return { values, total: complete ? total : Infinity };
        };

        const runnerRows = [];
        RUNNER_NAMES.forEach((name, ri) => {
          const { values, total } = buildValues(st.splits[ri]);
          runnerRows.push({
            color: seriesColor(ri),
            name,
            note: undefined,
            values,
            total,
          });
        });
        st.extras.forEach((ex, j) => {
          const { values, total } = buildValues(ex.splits);
          runnerRows.push({
            color: seriesColor(RUNNER_NAMES.length + j),
            name: ex.name,
            note: "",
            values,
            total,
          });
        });

        runnerRows.sort((a, b) => a.total - b.total);
        for (const r of runnerRows)
          body.push(pushEntity(r.color, r.name, r.values, r.note));

        body.push("</tbody>");
        table.innerHTML = head.join("") + body.join("");
      }

      // ---------- theme toggle (light / dark slider) ----------
      const THEME_KEY = "superman.theme";
      const themeToggle = document.getElementById("themeToggle");

      function isDarkNow() {
        try {
          const t = localStorage.getItem(THEME_KEY);
          if (t === "dark") return true;
          if (t === "light") return false;
        } catch (e) {}
        return false; // no saved preference → default to light
      }
      themeToggle.checked = isDarkNow();
      themeToggle.addEventListener("change", () => {
        const mode = themeToggle.checked ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", mode);
        try {
          localStorage.setItem(THEME_KEY, mode);
        } catch (e) {}
      });

      // ---------- reference toggle (Superman vs best runner) ----------
      const refToggle = document.getElementById("refToggle");
      function paintRefToggle() {
        refToggle.querySelectorAll("button").forEach((b) => {
          b.classList.toggle("active", b.dataset.ref === refMode);
        });
      }
      refToggle.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b.dataset.ref === refMode) return;
        refMode = b.dataset.ref;
        try {
          localStorage.setItem("superman.refmode", refMode);
        } catch (err) {}
        paintRefToggle();
        renderChart();
      });
      paintRefToggle();

      // ---------- events ----------
      document
        .getElementById("reloadBtn")
        .addEventListener("click", loadAllStages);
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", renderChart);

      // ---------- init ----------
      renderTabs();
      renderEditor();
      renderChart();
      loadAllStages();
