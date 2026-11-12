/* Apuntes de clase — compartido por los módulos (panel lateral) y la página central /apuntes/.
   Datos en Firestore: users/{uid}/apuntes/{a_*}  (apuntes)  y  users/{uid}/apuntes/idx_m*  (índice de temas de cada módulo).
   No toca el contenido de los módulos: solo lee sus temas, resaltados y notas. */
(function(){
  const X = window.APX; if (!X || window.__apuntes) return; window.__apuntes = true;
  const MOD = X.mod || null, BASE = X.base || '../', PAGE = !!X.root;
  const COL = 'apuntes';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const STOP = new Set(('para como sobre entre desde hasta donde cuando porque pero tambien este esta estos estas tiene tienen puede pueden ' +
    'cual cuales mucho mucha muchos muchas poco poca tanto tanta ante bajo cabe contra durante mediante tras segun dentro fuera ' +
    'unos unas ellos ellas nosotros usted ustedes nuestro nuestra nuestros nuestras sobre todo toda todos todas otro otra otros otras ' +
    'esto eso ese esa esos esas aquel aquella aqui alli asi bien solo mismo misma mismos mismas hace hacer hacen sera seran ' +
    'habia hemos haber siendo sido estar estan estaba fueron tema temas clase profesor profesora decir dice dijo').split(' '));
  const toks = s => { const o = new Set(); norm(s).split(/[^a-z0-9]+/).forEach(w => { if (w.length >= 4 && !STOP.has(w)) o.add(w.slice(0, 6)); }); return o; };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fdate = s => { const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return p ? (+p[3]) + ' ' + MES[+p[2] - 1] + ' ' + p[1] : ''; };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ---------- state
  let mods = [];                    // [{slug,label,name,m}]
  const idx = new Map();            // m -> {m, topics:[{id,ua,n,title,kw}]}
  const aps = new Map();            // id -> apunte
  const hls = new Map();            // m -> Map(annotation docs)
  const hlAt = new Map(), hlLoading = new Set();
  const dirty = new Set(), deleted = new Set(), timers = {}, pend = {};
  let cur = null, view = 'list', curTopic = null, filterQ = '', panelOpen = false, gotFirst = false, status = '';
  let pendingOpen = null;

  const mNum = m => String(m || '').replace(/\D/g, '');
  const shortM = m => 'M' + mNum(m);
  const slugOf = m => (mods.find(x => x.m === m) || {}).slug || ('modulo-' + mNum(m));
  const topicOf = (m, id) => { const ix = idx.get(m); return ix && ix.topics ? ix.topics.find(t => t.id === id) : null; };
  const tidOfBlock = b => (/^(ua\d+-t\d+)/.exec(b || '') || [])[1] || '';
  function topicLabel(m, id){ const t = topicOf(m, id); const r = /^ua(\d+)-t(\d+)$/.exec(id || ''); return shortM(m) + ' · ' + (t ? t.ua.toUpperCase() + ' ' + t.n : r ? 'UA' + r[1] + ' T' + (+r[2]) : id); }
  const uaOf = id => (/^(ua\d+)/.exec(id || '') || [])[1] || '';
  const ext = m => (m === MOD ? '' : ' data-ext="1"');
  const hrefTopic = (m, id) => (m === MOD ? '#' + id : BASE + slugOf(m) + '/#' + id);
  const hrefBlock = (m, b) => (m === MOD ? '#b=' + b : BASE + slugOf(m) + '/#b=' + b);
  const hrefHl = (m, g) => (m === MOD ? '#hl=' + g : BASE + slugOf(m) + '/#hl=' + g);
  const apList = () => [...aps.values()].sort((a, b) => (b.d || '').localeCompare(a.d || '') || (b.u || 0) - (a.u || 0));

  // ---------- annotation helpers (resaltados y notas de cada módulo)
  const bn = b => { const r = /-b(\d+)$/.exec(b || ''); return r ? +r[1] : 0; };
  function groupsOf(m){
    const d = hls.get(m); const out = new Map(); if (!d) return out;
    for (const [id, v] of d) {
      if (!v || v.t !== 'h') continue; const g = v.g || id; let e = out.get(g);
      if (!e) { e = { m, g, k: v.k, c: v.c || 'c1', n: '', parts: [] }; out.set(g, e); }
      e.parts.push(v); if (v.n) e.n = v.n;
    }
    for (const e of out.values()) { e.parts.sort((a, b) => bn(a.b) - bn(b.b) || a.s - b.s); e.x = e.parts.map(p => p.x).join(' … '); e.b = e.parts[0].b; e.o = bn(e.b) * 1e4 + (e.parts[0].s || 0); }
    return out;
  }
  function topicNote(m, k){ const d = hls.get(m); const v = d && d.get('n_' + k); return v && v.v ? v.v : ''; }
  function ensureHl(m, force){
    if (!m || m === MOD || hlLoading.has(m)) return;
    if (hls.has(m) && !force && Date.now() - (hlAt.get(m) || 0) < 120000) return;
    hlLoading.add(m);
    X.list(m).then(map => { hls.set(m, map); hlAt.set(m, Date.now()); }).catch(() => { if (!hls.has(m)) hls.set(m, new Map()); hlAt.set(m, Date.now()); })
      .finally(() => { hlLoading.delete(m); if (view === 'ed') renderDyn(); });
  }

  // ---------- texto del apunte: **negrita**, "- " viñetas, "> " citas con ⟨m1:bloque⟩
  const TOK = /\s*⟨(m\d+):([a-z0-9-]+)⟩\s*$/;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  function md(tx){
    let h = '', list = false;
    const close = () => { if (list) { h += '</ul>'; list = false; } };
    for (const raw of String(tx || '').split('\n')) {
      const l = raw.replace(/\s+$/, '');
      if (/^\s*[-•*]\s+/.test(l)) { if (!list) { h += '<ul>'; list = true; } h += '<li>' + inline(l.replace(/^\s*[-•*]\s+/, '')) + '</li>'; continue; }
      close();
      if (/^>\s?/.test(l)) {
        let t = l.replace(/^>\s?/, ''), link = ''; const mm = TOK.exec(t);
        if (mm) { t = t.replace(TOK, ''); link = ' <a class="apgo" href="' + esc(hrefBlock(mm[1], mm[2])) + '"' + ext(mm[1]) + '>' + esc(topicLabel(mm[1], tidOfBlock(mm[2]))) + ' →</a>'; }
        h += '<blockquote>' + inline(t) + link + '</blockquote>'; continue;
      }
      if (l.trim()) h += '<p>' + inline(l) + '</p>';
    }
    close(); return h;
  }
  const plainTx = tx => String(tx || '').split('\n').map(l => l.replace(TOK, '').replace(/^\s*(?:[-•*]|>)\s?/, '').replace(/\*\*/g, '')).join(' ').replace(/\s+/g, ' ').trim();

  // ---------- guardar
  const drafts = () => lsGet('ap-drafts', {});
  function save(id, now){
    const a = aps.get(id); if (!a) return;
    a.u = Date.now(); dirty.add(id); const dr = drafts(); dr[id] = a; lsSet('ap-drafts', dr);
    setSaved('Guardando…');
    clearTimeout(timers[id]);
    const go = () => { timers[id] = null; return write(id); };
    if (now) return go(); timers[id] = setTimeout(go, 700);
  }
  function write(id){
    const a = aps.get(id); if (!a) return Promise.resolve(); const u = a.u;
    const data = Object.assign({}, a); delete data.id;
    pend[id] = Promise.resolve(pend[id]).then(() => X.put(COL, id, data)).then(() => {
      const cu = aps.get(id); if (!cu || cu.u === u) { dirty.delete(id); const dr = drafts(); if (dr[id] && dr[id].u === u) { delete dr[id]; lsSet('ap-drafts', dr); } }
      if (id === cur) setSaved('Guardado');
    }).catch(e => { if (id === cur) setSaved('No se pudo guardar en tu cuenta (' + ((e && e.code) || 'error') + '). Queda guardado en este navegador y se reintenta.'); setTimeout(() => { if (dirty.has(id)) write(id); }, 8000); });
    return pend[id];
  }
  function flush(){
    const ps = [];
    for (const id of Object.keys(timers)) if (timers[id]) { clearTimeout(timers[id]); timers[id] = null; ps.push(write(id)); }
    Object.values(pend).forEach(p => ps.push(p));
    return Promise.race([Promise.all(ps).catch(() => {}), new Promise(r => setTimeout(r, 2500))]);
  }
  function newAp(){
    const id = 'a_' + rid(); const a = { id, t: 'a', ti: '', d: today(), tx: '', L: [], H: [], N: [], c: Date.now(), u: Date.now() };
    aps.set(id, a); save(id, true); return a;
  }
  const addU = (a, f, v) => { a[f] = a[f] || []; if (!a[f].includes(v)) a[f].push(v); };
  const remU = (a, f, v) => { a[f] = (a[f] || []).filter(x => x !== v); };

  // ---------- estilos
  const css = `
.apbtn{font:inherit;font-size:14px;font-weight:600;white-space:nowrap;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--soft);color:var(--fg);cursor:pointer}
.apbtn[aria-pressed="true"]{background:var(--fg);color:var(--paper);border-color:var(--fg)}
.appanel{position:fixed;z-index:79;top:0;right:0;bottom:0;width:min(460px,100vw);background:var(--paper);border-left:1px solid var(--line);box-shadow:var(--shadow);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-right:env(safe-area-inset-right,0px)}
@media (min-width:1100px){body.apopen .layout{margin-right:460px}body.apopen .totop{right:480px}}
.aphead{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--line)}
.aphead h2{font-family:var(--f-display);font-size:21px;margin:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aphead button,.aphead a.apall{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--paper);color:var(--fg);border-radius:999px;padding:6px 11px;cursor:pointer;text-decoration:none;white-space:nowrap}
.aphead .apx{width:36px;height:36px;padding:0;font-size:22px;border-radius:50%}
.apbody{overflow-y:auto;padding:14px 16px 60px;flex:1;-webkit-overflow-scrolling:touch}
.apstatus{font-size:13px;color:var(--c-nota-b,#a2325a);margin:0 0 10px}
.apnew{width:100%;font:inherit;font-size:15px;font-weight:600;padding:11px;border-radius:12px;border:0;background:var(--fg);color:var(--paper);cursor:pointer}
.apsearch{width:100%;font:inherit;font-size:15px;margin:10px 0 4px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--soft);color:var(--fg)}
.apitem{display:block;width:100%;text-align:left;font:inherit;color:var(--fg);padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--paper);margin-top:8px;cursor:pointer}
.apitem:hover{border-color:var(--fg)}
.apitem .apih{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.apitem b{font-size:16px}.apitem .apd{font-size:12px;color:var(--muted);white-space:nowrap}
.apitem .apex{font-size:14px;color:var(--muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.apitem .aptags{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.aptag{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--ut,var(--soft));color:var(--ua,var(--fg))}
.apempty{font-size:14px;color:var(--muted);margin:14px 2px}
.aprow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.apti{flex:1 1 220px;min-width:0;font-family:var(--f-display);font-size:22px;font-weight:700;border:0;border-bottom:1.5px solid var(--line);background:transparent;color:var(--fg);padding:6px 0;outline:none}
.apti:focus{border-bottom-color:var(--fg)}
.apdate{font:inherit;font-size:14px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--soft);color:var(--fg)}
.apfmt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:12px 0 6px}
.apfmt button{font:inherit;font-size:13px;padding:4px 11px;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--fg);cursor:pointer}
.aphint{font-size:12px;color:var(--muted);line-height:1.35}
.aptx{display:block;width:100%;min-height:220px;font:inherit;font-size:16px;line-height:1.55;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:10px 12px;color:var(--fg);resize:vertical;overflow:hidden}
.apsaved{font-size:12px;color:var(--muted);min-height:18px;margin:4px 2px 0}
.apsec{margin-top:18px}
.apsec h3{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.apsec h4{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ua,var(--fg));margin:12px 0 6px}
.apchip{display:inline-flex;align-items:center;gap:6px;background:var(--ut,var(--soft));border-radius:999px;padding:3px 4px 3px 11px;font-size:13px;margin:0 6px 6px 0;max-width:100%}
.apchip a{font-weight:700;color:var(--ua,var(--fg));text-decoration:none;white-space:nowrap}
.apchip .apct{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.apchip button{border:0;background:transparent;cursor:pointer;color:var(--muted);font-size:16px;width:24px;height:24px;border-radius:50%;flex:none}
.apadd{width:100%;font:inherit;font-size:14px;padding:7px 10px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--fg);margin-top:2px}
.apsg{display:grid;grid-template-columns:6px minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px 8px 8px 10px;border-radius:10px;background:var(--soft);margin-bottom:6px;font-size:14px;line-height:1.4}
.apsg small{display:block;color:var(--muted);font-size:12px}
.apsg .q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.apsg button{font:inherit;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--fg);cursor:pointer}
.apsg button.no{border:0;background:transparent;color:var(--muted);font-size:16px;padding:2px 6px}
.apbar{align-self:stretch;border-radius:4px;background:var(--ua,var(--line))}
.apbar.c1{background:var(--h1,#ffe86b)}.apbar.c2{background:var(--h2,#b6efb0)}.apbar.c3{background:var(--h3,#ffc2dc)}.apbar.c4{background:var(--h4,#b9dcff)}
.apmi{display:grid;grid-template-columns:6px minmax(0,1fr) auto;gap:10px;padding:8px 8px 8px 10px;border-radius:10px;background:var(--soft);text-decoration:none;color:var(--fg);font-size:14px;line-height:1.45;margin-bottom:6px}
.apmi .q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.apmi .n{display:block;margin-top:3px;font-weight:600}
.apmi button{border:0;background:transparent;color:var(--muted);font-size:16px;cursor:pointer;align-self:start}
.aptn2{font-size:14px;white-space:pre-wrap;background:var(--ut,var(--soft));border-radius:10px;padding:8px 10px;margin:0 0 6px}
.aptn2::before{content:"Nota del tema · ";font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.apfoot{margin-top:26px;display:flex;justify-content:flex-end}
.apdel{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--paper);color:var(--c-nota-b,#a2325a);border-radius:999px;padding:6px 12px;cursor:pointer}
.apmd{font-size:15px;line-height:1.55}
.apmd p{margin:0 0 .55em}.apmd ul{margin:0 0 .6em;padding-left:1.2em}.apmd li{margin-bottom:.2em}
.apmd blockquote{margin:.4em 0 .7em;padding:6px 10px;border-left:3px solid var(--ua,var(--line));background:var(--soft);border-radius:0 8px 8px 0;font-style:italic}
.apgo{font-style:normal;font-size:12px;font-weight:700;white-space:nowrap;margin-left:4px;color:var(--ua,var(--fg))!important;text-decoration:none}
.apbox{display:none;margin:0 0 26px;border:1.5px dashed var(--ua);border-radius:14px;padding:12px 16px 8px;background:var(--paper)}
.apbox.has-ap{display:block}body.repaso .apbox.has-tn{display:block}
.apbox .aptn{display:none}body.repaso .apbox .aptn{display:block;margin-bottom:10px}
.apbox .aptn p{margin:0;white-space:pre-wrap;font-size:15px}
.aplab{display:block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ua);margin-bottom:6px}
.apcard{border-top:1px solid var(--line);padding:10px 0 6px}.apls .apcard:first-of-type{border-top:0;padding-top:2px}
.apcard .apch{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:4px}
.apcard .apch span{font-size:12px;color:var(--muted);white-space:nowrap}
.apcard .apmd{max-height:9.6em;overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}
.apopen{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--soft);color:var(--fg);border-radius:999px;padding:4px 12px;cursor:pointer;margin-top:6px}
.aprn{display:none}
body.repaso .aprn{display:block;margin:-.3em 0 1.1em;padding:6px 12px;border-left:3px solid var(--fg);background:var(--soft);border-radius:0 10px 10px 0;font-size:15px;line-height:1.5}
.aprn p{margin:3px 0;white-space:pre-wrap}.aprn .apbar{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.apflash{animation:apfl 2.2s ease}@keyframes apfl{0%,45%{background:var(--mark,#ffe066)}100%{background:transparent}}
.aptoast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--fg);color:var(--paper);padding:9px 16px;border-radius:999px;z-index:95;font-size:14px;box-shadow:var(--shadow);max-width:calc(100vw - 32px)}
`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function toast(t){ const d = document.createElement('div'); d.className = 'aptoast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

  // ---------- contenedor (panel en los módulos, página en /apuntes/)
  let shell, head, body;
  if (PAGE) {
    shell = X.root; shell.innerHTML = '<div class="aphead"></div><div class="apbody"></div>';
  } else {
    shell = document.createElement('div'); shell.className = 'appanel'; shell.id = 'apPanel'; shell.hidden = true;
    shell.innerHTML = '<div class="aphead"></div><div class="apbody"></div>';
    document.body.appendChild(shell);
  }
  head = shell.querySelector('.aphead'); body = shell.querySelector('.apbody');
  let topBtn = null;
  function openPanel(){ if (PAGE) return; shell.hidden = false; panelOpen = true; document.body.classList.add('apopen'); if (topBtn) topBtn.setAttribute('aria-pressed', 'true'); }
  function closePanel(){ if (PAGE) return; flush(); shell.hidden = true; panelOpen = false; document.body.classList.remove('apopen'); if (topBtn) topBtn.setAttribute('aria-pressed', 'false'); }

  function renderHead(){
    if (view === 'ed') head.innerHTML = '<button type="button" data-act="back">‹ Apuntes</button><h2></h2>' + (PAGE ? '' : '<button type="button" class="apx" data-act="close" aria-label="Cerrar">×</button>');
    else head.innerHTML = '<h2>Apuntes de clase</h2>' + (PAGE ? '' : '<a class="apall" href="' + BASE + 'apuntes/" data-ext="1">Ver todos</a><button type="button" class="apx" data-act="close" aria-label="Cerrar">×</button>');
    if (view === 'ed') { const a = aps.get(cur); head.querySelector('h2').textContent = (a && a.ti) || 'Apunte'; }
  }
  function render(){ renderHead(); if (view === 'ed' && aps.get(cur)) renderEditor(); else { view = 'list'; renderHead(); renderList(); } }

  function renderList(){
    const q = norm(filterQ).trim();
    const list = apList().filter(a => !q || norm(a.ti + ' ' + plainTx(a.tx)).includes(q));
    let h = (status ? '<p class="apstatus">' + esc(status) + '</p>' : '') +
      '<button type="button" class="apnew" data-act="new">+ Nuevo apunte</button>' +
      '<input type="search" class="apsearch" placeholder="Buscar en mis apuntes…" value="' + esc(filterQ) + '">';
    if (!gotFirst && !aps.size) h += '<p class="apempty">Cargando tus apuntes…</p>';
    else if (!list.length) h += '<p class="apempty">' + (q ? 'Ningún apunte coincide con la búsqueda.' : 'Todavía no tienes apuntes. Crea uno con el botón de arriba' + (MOD ? ', o selecciona texto del módulo y toca <b>→ Apunte</b>.' : '.')) + '</p>';
    h += list.map(a => {
      const tags = [...new Set((a.L || []).map(x => x.split(':')))].slice(0, 6).map(([m, k]) => '<span class="aptag ' + uaOf(k) + '">' + esc(topicLabel(m, k)) + '</span>').join('');
      return '<button type="button" class="apitem" data-open="' + esc(a.id) + '"><span class="apih"><b>' + esc(a.ti || 'Sin título') + '</b><span class="apd">' + esc(fdate(a.d)) + '</span></span>' +
        '<span class="apex">' + esc(plainTx(a.tx).slice(0, 220) || 'Vacío') + '</span>' + (tags ? '<span class="aptags">' + tags + '</span>' : '') + '</button>';
    }).join('');
    const had = document.activeElement && document.activeElement.classList.contains('apsearch');
    body.innerHTML = h;
    const s = body.querySelector('.apsearch');
    s.addEventListener('input', () => { filterQ = s.value; renderList(); });
    if (had) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  function setSaved(t){ const s = body.querySelector('.apsaved'); if (s && view === 'ed') s.textContent = t; }
  function grow(ta){ ta.style.height = 'auto'; ta.style.height = Math.max(220, ta.scrollHeight + 4) + 'px'; }

  function renderEditor(){
    const a = aps.get(cur); if (!a) return;
    body.innerHTML = (status ? '<p class="apstatus">' + esc(status) + '</p>' : '') +
      '<div class="aprow"><input class="apti" placeholder="Título (p. ej. Clase 4 · Tendencias)" value="' + esc(a.ti) + '"><input class="apdate" type="date" value="' + esc(a.d) + '" aria-label="Fecha de la clase"></div>' +
      '<div class="apfmt"><button type="button" data-f="b"><b>B</b> Negrita</button><button type="button" data-f="li">• Viñeta</button>' +
      (MOD ? '<span class="aphint">Selecciona texto del módulo y toca <b>→ Apunte</b> para citarlo aquí.</span>' : '') + '</div>' +
      '<textarea class="aptx" placeholder="Escribe tus apuntes de la clase…">' + esc(a.tx) + '</textarea><div class="apsaved">' + (dirty.has(a.id) ? 'Guardando…' : '') + '</div>' +
      '<section class="apsec"><h3>Temas relacionados</h3><div class="aprel"></div><select class="apadd" aria-label="Añadir tema relacionado"></select></section>' +
      '<section class="apsec"><h3>Sugerencias</h3><div class="apsug"></div></section>' +
      '<section class="apsec"><h3>Lo que marcaste en estos temas</h3><div class="apmarks"></div></section>' +
      '<div class="apfoot"><button type="button" class="apdel">Eliminar apunte</button></div>';
    const ti = body.querySelector('.apti'), dt = body.querySelector('.apdate'), ta = body.querySelector('.aptx');
    const A = () => aps.get(a.id) || a;
    ti.addEventListener('input', () => { A().ti = ti.value; head.querySelector('h2').textContent = ti.value || 'Apunte'; save(a.id); sugSoon(); });
    dt.addEventListener('change', () => { A().d = dt.value; save(a.id); });
    ta.addEventListener('input', () => { A().tx = ta.value; grow(ta); save(a.id); sugSoon(); });
    body.querySelectorAll('.apfmt button').forEach(b => { b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', () => fmt(ta, b.dataset.f)); });
    body.querySelector('.apadd').addEventListener('change', e => { const v = e.target.value; if (!v) return; addU(A(), 'L', v); remU(A(), 'N', v); save(a.id); renderDyn(); });
    const del = body.querySelector('.apdel'); let armed = 0;
    del.addEventListener('click', () => {
      if (Date.now() - armed > 3000) { armed = Date.now(); del.textContent = 'Toca otra vez para eliminar'; setTimeout(() => { if (del.isConnected) del.textContent = 'Eliminar apunte'; }, 3000); return; }
      deleted.add(a.id); aps.delete(a.id); dirty.delete(a.id); clearTimeout(timers[a.id]); timers[a.id] = null;
      const dr = drafts(); delete dr[a.id]; lsSet('ap-drafts', dr);
      X.del(COL, a.id).catch(() => {}); cur = null; view = 'list'; render(); topicBoxes(); toast('Apunte eliminado');
    });
    requestAnimationFrame(() => grow(ta));
    mods.forEach(m => ensureHl(m.m));
    renderDyn();
  }
  function fmt(ta, f){
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    if (f === 'b') { const sel = v.slice(s, e) || 'texto'; ta.setRangeText('**' + sel + '**', s, e, 'end'); }
    else { const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', e); if (le < 0) le = v.length; ta.setRangeText(v.slice(ls, le).split('\n').map(l => /^\s*[-•]\s/.test(l) ? l : '- ' + l).join('\n'), ls, le, 'end'); }
    ta.dispatchEvent(new Event('input')); ta.focus();
  }

  // ---------- secciones dinámicas del editor
  let sugT;
  function sugSoon(){ clearTimeout(sugT); sugT = setTimeout(() => { if (view === 'ed') renderDyn(); }, 700); }
  function renderDyn(){
    const a = aps.get(cur); if (!a || view !== 'ed') return;
    const rel = body.querySelector('.aprel'), add = body.querySelector('.apadd'), sug = body.querySelector('.apsug'), mk = body.querySelector('.apmarks');
    if (!rel) return;
    const L = a.L || [];
    rel.innerHTML = L.length ? L.map(key => { const [m, k] = key.split(':'); const t = topicOf(m, k);
      return '<span class="apchip ' + uaOf(k) + '"><a href="' + esc(hrefTopic(m, k)) + '"' + ext(m) + '>' + esc(topicLabel(m, k)) + '</a><span class="apct">' + esc(t ? t.title : '') + '</span><button type="button" data-rm="' + esc(key) + '" aria-label="Quitar">×</button></span>'; }).join('')
      : '<p class="apempty" style="margin:0 0 8px">Ningún tema enlazado todavía.</p>';
    // selector de temas
    let o = '<option value="">+ Añadir tema relacionado…</option>';
    const order = mods.length ? mods.map(x => x.m) : [...idx.keys()];
    order.forEach(m => { const ix = idx.get(m); const mm = mods.find(x => x.m === m);
      if (!ix || !ix.topics) { o += '<optgroup label="' + esc(shortM(m) + ' · ' + (mm ? mm.name : '') + ' (ábrelo una vez para ver sus temas)') + '"></optgroup>'; return; }
      o += '<optgroup label="' + esc(shortM(m) + ' · ' + (mm ? mm.name : '')) + '">' + ix.topics.filter(t => !L.includes(m + ':' + t.id)).map(t => '<option value="' + esc(m + ':' + t.id) + '">' + esc(t.ua.toUpperCase() + ' ' + t.n + ' · ' + t.title) + '</option>').join('') + '</optgroup>'; });
    add.innerHTML = o;
    // sugerencias
    const sg = suggest(a);
    sug.innerHTML = sg.length ? sg.map(s => s.type === 't'
      ? '<div class="apsg ' + uaOf(s.k) + '"><span class="apbar"></span><span><b>' + esc(topicLabel(s.m, s.k)) + '</b> · ' + esc((topicOf(s.m, s.k) || {}).title || '') + '<small>' + esc(s.why) + '</small></span><button type="button" data-acc="' + esc(s.m + ':' + s.k) + '">Relacionar</button><button type="button" class="no" data-no="' + esc(s.m + ':' + s.k) + '" aria-label="Descartar">×</button></div>'
      : '<div class="apsg"><span class="apbar ' + esc(s.g.c) + '"></span><span><span class="q">“' + esc(s.g.x) + '”</span><small>' + esc(topicLabel(s.g.m, s.g.k)) + (s.g.n ? ' · ✎ ' + esc(s.g.n.slice(0, 80)) : '') + '</small></span><button type="button" data-acch="' + esc(s.g.m + ':' + s.g.g) + '">Enlazar</button><button type="button" class="no" data-no="' + esc('h:' + s.g.m + ':' + s.g.g) + '" aria-label="Descartar">×</button></div>').join('')
      : '<p class="apempty" style="margin:0">Mientras escribes, aquí aparecen temas y resaltados tuyos que se relacionan con el apunte.</p>';
    // lo que marcaste
    let h = '';
    const H = a.H || []; const shownG = new Set();
    L.forEach(key => { const [m, k] = key.split(':'); ensureHl(m);
      const tn = topicNote(m, k); const gs = [...groupsOf(m).values()].filter(g => g.k === k).sort((x, y) => x.o - y.o);
      gs.forEach(g => shownG.add(m + ':' + g.g));
      h += '<div class="' + uaOf(k) + '"><h4>' + esc(topicLabel(m, k) + ' · ' + ((topicOf(m, k) || {}).title || '')) + '</h4>';
      if (!hls.has(m)) h += '<p class="apempty" style="margin:0 0 6px">Cargando…</p>';
      else if (!tn && !gs.length) h += '<p class="apempty" style="margin:0 0 6px">Sin resaltados ni notas en este tema.</p>';
      if (tn) h += '<p class="aptn2">' + esc(tn) + '</p>';
      h += gs.map(g => mItem(g, false)).join('') + '</div>';
    });
    const extra = H.map(x => { const i = x.indexOf(':'); const m = x.slice(0, i), gid = x.slice(i + 1); ensureHl(m); return groupsOf(m).get(gid); }).filter(g => g && !shownG.has(g.m + ':' + g.g));
    if (extra.length) h += '<h4>Enlazados a este apunte</h4>' + extra.map(g => mItem(g, true)).join('');
    if (!h) h = '<p class="apempty" style="margin:0">Cuando relaciones temas, aquí verás tus resaltados y notas de esos temas.</p>';
    mk.innerHTML = h;
  }
  const mItem = (g, rm) => '<a class="apmi" href="' + esc(hrefHl(g.m, g.g)) + '"' + ext(g.m) + '><span class="apbar ' + esc(g.c) + '"></span><span><span class="q">“' + esc(g.x) + '”</span>' +
    (g.n ? '<span class="n">✎ ' + esc(g.n) + '</span>' : '') + (rm ? '<small style="color:var(--muted);font-size:12px">' + esc(topicLabel(g.m, g.k)) + '</small>' : '') + '</span>' +
    (rm ? '<button type="button" data-rmh="' + esc(g.m + ':' + g.g) + '" aria-label="Quitar">×</button>' : '<span></span>') + '</a>';

  function suggest(a){
    const out = []; const L = new Set(a.L || []), N = new Set(a.N || []), H = new Set(a.H || []);
    if (MOD && curTopic && !L.has(MOD + ':' + curTopic) && !N.has(MOD + ':' + curTopic)) out.push({ type: 't', m: MOD, k: curTopic, why: 'Es el tema que estás leyendo ahora', s: 1e3 });
    const text = (a.ti || '') + ' ' + plainTx(a.tx); const T = toks(text); const nb = ' ' + norm(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (!T.size) return out;
    const tops = [];
    for (const [m, ix] of idx) for (const t of (ix.topics || [])) {
      const key = m + ':' + t.id; if (L.has(key) || N.has(key) || (out[0] && out[0].m === m && out[0].k === t.id)) continue;
      let s = 0, why = '';
      for (const kw of (t.kw || [])) { const nk = ' ' + norm(kw).replace(/[^a-z0-9]+/g, ' ').trim() + ' '; if (nk.length >= 7 && nb.includes(nk)) { s += 3; if (!why) why = 'Mencionas «' + kw + '», concepto clave del tema'; } }
      let ov = 0; toks(t.title).forEach(w => { if (T.has(w)) ov++; }); s += ov * 1.5; if (!why && ov) why = 'Coincide con el título del tema';
      if (s >= 3) tops.push({ type: 't', m, k: t.id, why, s });
    }
    tops.sort((x, y) => y.s - x.s); out.push(...tops.slice(0, 5));
    const hs = [];
    for (const m of hls.keys()) for (const g of groupsOf(m).values()) {
      const key = m + ':' + g.g; if (H.has(key) || N.has('h:' + key) || L.has(m + ':' + g.k)) continue;
      let ov = 0; toks(g.x + ' ' + g.n).forEach(w => { if (T.has(w)) ov++; });
      if (ov >= 2) hs.push({ type: 'h', g, s: ov });
    }
    hs.sort((x, y) => y.s - x.s); out.push(...hs.slice(0, 5));
    return out;
  }

  // ---------- clicks
  shell.addEventListener('click', e => {
    const t = e.target.closest('button, a'); if (!t || !shell.contains(t)) return;
    const a = aps.get(cur);
    if (t.dataset.act === 'close') return closePanel();
    if (t.dataset.act === 'back') { flush(); view = 'list'; cur = null; return render(); }
    if (t.dataset.act === 'new') { const n = newAp(); cur = n.id; view = 'ed'; render(); setTimeout(() => { const ti = body.querySelector('.apti'); if (ti) ti.focus(); }, 30); return; }
    if (t.dataset.open) return openAp(t.dataset.open);
    if (a && t.dataset.rm) { remU(a, 'L', t.dataset.rm); save(a.id); return renderDyn(); }
    if (a && t.dataset.acc) { addU(a, 'L', t.dataset.acc); save(a.id); return renderDyn(); }
    if (a && t.dataset.acch) { addU(a, 'H', t.dataset.acch); save(a.id); return renderDyn(); }
    if (a && t.dataset.no) { addU(a, 'N', t.dataset.no); save(a.id); return renderDyn(); }
    if (a && t.dataset.rmh) { e.preventDefault(); remU(a, 'H', t.dataset.rmh); save(a.id); return renderDyn(); }
  });
  function openAp(id){ if (!aps.get(id)) return; flush(); cur = id; view = 'ed'; lsSet('ap-cur', id); openPanel(); render(); body.scrollTop = 0; }

  // enlaces: dentro del mismo módulo se navega sin recargar; a otro módulo se guarda primero
  document.addEventListener('click', e => {
    const l = e.target.closest('a[href]'); if (!l) return;
    if (!shell.contains(l) && !l.closest('.apbox')) return;
    const href = l.getAttribute('href');
    if (l.dataset.ext) { e.preventDefault(); flush().then(() => { location.href = href; }); return; }
    if (href.startsWith('#')) { e.preventDefault(); goHash(href.slice(1)); }
  });
  document.addEventListener('click', e => { const b = e.target.closest('.apopen[data-ap]'); if (b) openAp(b.dataset.ap); });

  function goEl(el){
    const det = el.closest('details'); if (det) det.open = true;
    if (document.body.classList.contains('repaso') && el.offsetParent === null) { const r = document.getElementById('repaso'); if (r) { r.checked = false; r.dispatchEvent(new Event('change')); } }
    if (!PAGE && window.innerWidth < 1100) closePanel();
    el.scrollIntoView({ block: 'center' }); el.classList.remove('apflash'); void el.offsetWidth; el.classList.add('apflash');
  }
  function goHash(h, n){
    h = decodeURIComponent(h || ''); n = n || 0;
    if (h.startsWith('ap=')) { pendingOpen = h.slice(3); tryPending(); return; }
    if (PAGE) return;
    if (h.startsWith('b=')) { const el = document.querySelector('[data-b="' + CSS.escape(h.slice(2)) + '"]'); if (el) goEl(el); return; }
    if (h.startsWith('hl=')) { const m = document.querySelector('#main mark.uhl[data-g="' + CSS.escape(h.slice(3)) + '"]'); if (m) goEl(m); else if (n < 24) setTimeout(() => goHash(h, n + 1), 500); return; }
    const el = document.getElementById(h); if (el) { if (window.innerWidth < 1100) closePanel(); el.scrollIntoView(); }
  }
  function tryPending(){ if (pendingOpen && aps.get(pendingOpen)) { const id = pendingOpen; pendingOpen = null; openAp(id); } }
  window.addEventListener('hashchange', () => goHash(location.hash.slice(1)));
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // ---------- integración con el módulo abierto
  function topicsFrom(root){
    return [...root.querySelectorAll('article.topic')].map(a => {
      const tn = a.querySelector('.tnum'); const r = /^ua(\d+)-t(\d+)$/.exec(a.id) || [];
      return { id: a.id, ua: uaOf(a.id), n: 'T' + (tn ? parseInt(tn.textContent.replace(/\D/g, ''), 10) : +r[2]), title: ((a.querySelector('.ttitle') || {}).textContent || a.id).trim(),
        kw: [...a.querySelectorAll('.chips .chip')].map(c => c.textContent.trim()).filter(Boolean).slice(0, 40) };
    });
  }
  let localIdx = null;
  if (MOD) {
    localIdx = { t: 'i', m: MOD, topics: topicsFrom(document) }; idx.set(MOD, localIdx);
    // botón en la barra superior
    const bar = document.querySelector('.topbar');
    if (bar) { topBtn = document.createElement('button'); topBtn.type = 'button'; topBtn.className = 'apbtn'; topBtn.setAttribute('aria-pressed', 'false'); topBtn.textContent = '✎ Apuntes';
      const tg = bar.querySelector('.toggle'); bar.insertBefore(topBtn, tg || null);
      topBtn.addEventListener('click', () => { if (panelOpen) closePanel(); else { const last = lsGet('ap-cur', null); if (view !== 'ed' && last && aps.get(last)) { cur = last; view = 'ed'; } openPanel(); render(); } }); }
    // botón "→ Apunte" en la barra de resaltar
    const tool = document.getElementById('hltool');
    if (tool) { const b = document.createElement('button'); b.type = 'button'; b.className = 'hn-btn'; b.textContent = '→ Apunte'; tool.appendChild(b);
      b.addEventListener('click', () => { const r = grab(); if (!r) return; quote(r); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); try { window.getSelection().removeAllRanges(); } catch (e) {} }); }
    // tema que se está leyendo
    const io = new IntersectionObserver(ents => { ents.forEach(en => { if (en.isIntersecting && en.target.id !== curTopic) { curTopic = en.target.id; if (view === 'ed' && panelOpen) sugSoon(); } }); }, { rootMargin: '-30% 0px -65% 0px' });
    document.querySelectorAll('article.topic').forEach(a => io.observe(a));
    // resaltados y notas de este módulo (los emite el compendio cada vez que cambian)
    document.addEventListener('m1store', e => { if (e.detail instanceof Map) { hls.set(MOD, e.detail); hlAt.set(MOD, Date.now()); repasoNotes(); topicBoxes(); if (view === 'ed') sugSoon(); } });
  }
  function grab(){
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      const r = sel.getRangeAt(0); let n = r.startContainer; n = n.nodeType === 1 ? n : n.parentNode;
      const art = n.closest('article.topic') || ((r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode).closest('article.topic'));
      let blk = n.closest('[data-b]'); if (!blk && art) blk = [...art.querySelectorAll('.content [data-b]')].find(b => r.intersectsNode(b));
      return art ? { x: sel.toString().replace(/\s+/g, ' ').trim(), b: blk && blk.dataset.b, k: art.id } : null;
    }
    const act = document.querySelector('#main mark.uhl.active');
    if (act) { const g = act.dataset.g; const ms = [...document.querySelectorAll('#main mark.uhl[data-g="' + CSS.escape(g) + '"]')];
      const art = ms[0].closest('article.topic'); const blk = ms[0].closest('[data-b]');
      return art ? { x: ms.map(m => m.textContent).join(' ').replace(/\s+/g, ' ').trim(), b: blk && blk.dataset.b, k: art.id, g } : null; }
    return null;
  }
  function quote(r){
    let a = aps.get(cur) || aps.get(lsGet('ap-cur', null)); if (!a) a = newAp();
    const line = '> “' + r.x.slice(0, 800) + '”' + (r.b ? ' ⟨' + MOD + ':' + r.b + '⟩' : '');
    a.tx = (a.tx || '').replace(/\s+$/, ''); a.tx = (a.tx ? a.tx + '\n\n' : '') + line + '\n';
    addU(a, 'L', MOD + ':' + r.k); remU(a, 'N', MOD + ':' + r.k); if (r.g) addU(a, 'H', MOD + ':' + r.g);
    cur = a.id; view = 'ed'; lsSet('ap-cur', a.id); save(a.id); openPanel(); render();
    const ta = body.querySelector('.aptx'); if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block: 'end' }); }
    toast('Añadido a «' + (a.ti || 'apunte sin título') + '»');
  }

  // notas de los resaltados debajo del párrafo (visibles en modo repaso)
  function repasoNotes(){
    if (!MOD) return;
    document.querySelectorAll('#main .aprn').forEach(n => n.remove());
    const by = new Map();
    for (const g of groupsOf(MOD).values()) {
      if (!g.n) continue; const ms = document.querySelectorAll('#main mark.uhl[data-g="' + CSS.escape(g.g) + '"]'); if (!ms.length) continue;
      const blk = ms[ms.length - 1].closest('.content > *'); if (!blk) continue;
      if (!by.has(blk)) by.set(blk, []); by.get(blk).push(g);
    }
    for (const [blk, list] of by) { const d = document.createElement('div'); d.className = 'aprn'; d.innerHTML = list.map(g => '<p><span class="apbar ' + esc(g.c) + '"></span>✎ ' + esc(g.n) + '</p>').join(''); blk.after(d); }
  }
  // recuadro por tema: apuntes enlazados (siempre) + nota del tema (en repaso)
  function topicBoxes(){
    if (!MOD) return;
    const all = apList();
    document.querySelectorAll('#main article.topic').forEach(art => {
      const k = art.id, key = MOD + ':' + k; let box = art.querySelector(':scope > .apbox');
      if (!box) { box = document.createElement('div'); box.className = 'apbox'; const tools = art.querySelector(':scope > .tools') || art.querySelector(':scope > .thead'); if (!tools) return; tools.after(box); }
      const list = all.filter(a => (a.L || []).includes(key)); const tn = topicNote(MOD, k);
      let h = '';
      if (tn) h += '<div class="aptn"><span class="aplab">Tu nota del tema</span><p>' + esc(tn) + '</p></div>';
      if (list.length) h += '<div class="apls"><span class="aplab">Apuntes de clase · ' + list.length + '</span>' + list.map(a =>
        '<div class="apcard"><div class="apch"><b>' + esc(a.ti || 'Sin título') + '</b><span>' + esc(fdate(a.d)) + '</span></div><div class="apmd">' + md(a.tx) + '</div><button type="button" class="apopen" data-ap="' + esc(a.id) + '">Abrir apunte</button></div>').join('') + '</div>';
      if (box.__sig !== h) { box.innerHTML = h; box.__sig = h; }
      box.classList.toggle('has-ap', !!list.length); box.classList.toggle('has-tn', !!tn);
    });
  }

  // ---------- datos
  function onAps(map){
    const first = !gotFirst; gotFirst = true; status = '';
    const next = new Map();
    for (const [id, d] of map) {
      if (!d || deleted.has(id)) continue;
      if (d.t === 'i') { if (d.m && d.m !== MOD) idx.set(d.m, d); continue; }
      if (d.t !== 'a') continue;
      const loc = aps.get(id);
      if (loc && (dirty.has(id) || (loc.u || 0) >= (d.u || 0))) next.set(id, loc);
      else next.set(id, Object.assign({}, d, { id }));
    }
    for (const id of dirty) if (!next.has(id) && aps.get(id)) next.set(id, aps.get(id));
    if (first) {
      const dr = drafts();
      for (const [id, a] of Object.entries(dr)) { if (deleted.has(id)) continue; const s = next.get(id); if (!s || (s.u || 0) < (a.u || 0)) { next.set(id, a); aps.set(id, a); dirty.add(id); write(id); } }
      if (MOD && localIdx) { const ex = map.get('idx_' + MOD); if (!ex || JSON.stringify(ex.topics) !== JSON.stringify(localIdx.topics)) X.put(COL, 'idx_' + MOD, localIdx).catch(() => {}); }
      if (PAGE) buildMissing();
    }
    const edA = aps.get(cur), edB = next.get(cur);
    aps.clear(); next.forEach((v, k) => aps.set(k, v));
    if (view === 'ed') {
      if (!edB) { view = 'list'; cur = null; render(); }
      else if (edA !== edB && !shell.contains(document.activeElement)) render();
      else renderDyn();
    } else if (PAGE || panelOpen) renderList();
    topicBoxes(); tryPending();
  }
  function onErr(e){
    status = (e && e.code === 'permission-denied') ? 'Tu cuenta todavía no permite guardar apuntes (falta actualizar las reglas de Firestore).' : 'No se pudo conectar con tus apuntes (' + ((e && e.code) || 'error') + ').';
    gotFirst = true; render();
  }
  async function buildMissing(){
    if (!X.moduleHtml) return;
    for (const m of mods) {
      if (idx.has(m.m)) continue;
      try { const html = await X.moduleHtml(m.slug); const dom = new DOMParser().parseFromString(html, 'text/html');
        const ix = { t: 'i', m: m.m, topics: topicsFrom(dom) }; if (ix.topics.length) { idx.set(m.m, ix); X.put(COL, 'idx_' + m.m, ix).catch(() => {}); render(); } } catch (e) {}
    }
  }

  fetch(BASE + 'modules.json', { cache: 'no-store' }).then(r => r.json()).then(ms => {
    mods = (Array.isArray(ms) ? ms : []).map(x => Object.assign({}, x, { m: 'm' + mNum(x.slug) }));
    if (PAGE) { mods.forEach(m => ensureHl(m.m)); if (gotFirst) buildMissing(); }
    render();
  }).catch(() => {});
  X.watch(COL, onAps, onErr);
  render(); repasoNotes(); topicBoxes();
  if (location.hash) goHash(location.hash.slice(1));
  if (PAGE) setInterval(() => mods.forEach(m => ensureHl(m.m)), 120000);
  window.Apuntes = { open: openAp, flush };
})();
