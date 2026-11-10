(function () {
  'use strict';

  const DATA = window.SKILL_DATA;
  const STORAGE_KEY = 'calisthenics-skill-tree:v1';
  const PREFS_KEY = 'calisthenics-skill-tree:prefs';
  const SVGNS = 'http://www.w3.org/2000/svg';

  const NODE_W = 184;
  const NODE_H = 60;
  const COL_W = 232;
  const ROW_H = 100;
  const PAD_X = 32;
  const HEADER_H = 70;
  const MIN_K = 0.2;
  const MAX_K = 2.5;

  // ------------------------------------------------------------------
  // Data model
  // ------------------------------------------------------------------
  const families = DATA.families.map((f, i) => ({ ...f, index: i }));
  const famById = new Map(families.map(f => [f.id, f]));
  const skills = DATA.skills.map(s => ({
    ...s,
    requires: s.requires || [],
    carry: s.carry || [],
    unlocks: [],     // [skillId, tierNeededFromThisSkill]
    carriesTo: []    // skillIds this one helps with
  }));
  const byId = new Map(skills.map(s => [s.id, s]));

  skills.forEach(s => {
    if (!famById.has(s.family)) {
      console.warn(`Skill "${s.id}" has unknown family "${s.family}"`);
      s.family = families[0].id;
    }
    s.requires = s.requires.filter(([pid, tier]) => {
      const p = byId.get(pid);
      if (!p) { console.warn(`Skill "${s.id}" requires unknown skill "${pid}"`); return false; }
      if (!(tier >= 1 && tier <= p.tiers.length)) {
        console.warn(`Skill "${s.id}" requires tier ${tier} of "${pid}", which has ${p.tiers.length} tiers`);
        return false;
      }
      p.unlocks.push([s.id, tier]);
      return true;
    });
    s.carry = s.carry.filter(cid => {
      const c = byId.get(cid);
      if (!c) { console.warn(`Skill "${s.id}" has unknown carryover "${cid}"`); return false; }
      c.carriesTo.push(s.id);
      return true;
    });
  });

  // ------------------------------------------------------------------
  // Layout: one column per family, rows from prerequisite depth
  // ------------------------------------------------------------------
  const depthMemo = new Map();
  function depth(s, stack) {
    if (depthMemo.has(s.id)) return depthMemo.get(s.id);
    if (stack.has(s.id)) { console.warn(`Prerequisite cycle at "${s.id}"`); return 0; }
    stack.add(s.id);
    let d = 0;
    s.requires.forEach(([pid]) => { d = Math.max(d, depth(byId.get(pid), stack) + 1); });
    stack.delete(s.id);
    depthMemo.set(s.id, d);
    return d;
  }

  const occupied = new Set();
  let maxRow = 0;
  skills
    .map((s, i) => ({ s, i, d: depth(s, new Set()) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .forEach(({ s }) => {
      let r = 0;
      s.requires.forEach(([pid]) => {
        const p = byId.get(pid);
        if (p.row !== undefined) r = Math.max(r, p.row + 1);
      });
      const col = famById.get(s.family).index;
      while (occupied.has(col + ':' + r)) r++;
      occupied.add(col + ':' + r);
      s.col = col;
      s.row = r;
      s.x = PAD_X + col * COL_W;
      s.y = HEADER_H + r * ROW_H;
      maxRow = Math.max(maxRow, r);
    });

  const CONTENT_W = PAD_X * 2 + (families.length - 1) * COL_W + NODE_W;
  const CONTENT_H = HEADER_H + (maxRow + 1) * ROW_H + 20;

  // ------------------------------------------------------------------
  // Progress (browser storage)
  // ------------------------------------------------------------------
  function sanitize(obj) {
    const out = {};
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(id => {
        const s = byId.get(id);
        const v = obj[id];
        if (s && Number.isInteger(v) && v > 0) out[id] = Math.min(v, s.tiers.length);
      });
    }
    return out;
  }
  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  let progress = sanitize(readJSON(STORAGE_KEY));
  const prefs = Object.assign({ showCarry: true }, readJSON(PREFS_KEY) || {});
  const saveProgress = () => writeJSON(STORAGE_KEY, progress);

  const level = id => progress[id] || 0;
  const prereqMet = ([pid, t]) => level(pid) >= t;
  const isUnlocked = s => s.requires.every(prereqMet);
  function status(s) {
    const l = level(s.id);
    if (l >= s.tiers.length) return 'mastered';
    if (l > 0) return 'progress';
    return isUnlocked(s) ? 'available' : 'locked';
  }
  const STATUS_TEXT = {
    locked: 'Locked',
    available: 'Ready to start',
    progress: 'In progress',
    mastered: 'Mastered'
  };

  // ------------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------------
  const $ = sel => document.querySelector(sel);
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(k => {
        const v = props[k];
        if (k === 'class') e.className = v;
        else if (k === 'style') e.setAttribute('style', v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
      });
    }
    children.flat().forEach(c => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }

  const svg = $('#tree');
  const viewportG = $('#viewport');
  const bandsG = $('#bands');
  const edgesG = $('#edges');
  const nodesG = $('#nodes');
  const panel = $('#panel');
  const canvas = $('#canvas');

  let selectedId = null;

  // ------------------------------------------------------------------
  // Static layer: column bands + headers
  // ------------------------------------------------------------------
  families.forEach(f => {
    const x = PAD_X + f.index * COL_W;
    svgEl('rect', {
      class: 'band', x: x - 14, y: 8, width: NODE_W + 28, height: CONTENT_H - 8, rx: 14
    }, bandsG);
    const t = svgEl('text', { class: 'col-title', x: x + NODE_W / 2, y: 36, 'text-anchor': 'middle' }, bandsG);
    t.textContent = f.name;
    svgEl('line', {
      class: 'col-rule', x1: x + NODE_W / 2 - 18, x2: x + NODE_W / 2 + 18, y1: 48, y2: 48, stroke: f.color
    }, bandsG);
  });

  // ------------------------------------------------------------------
  // Edges
  // ------------------------------------------------------------------
  function edgePath(a, b) {
    const sameCol = a.col === b.col;
    if (b.row > a.row) {
      if (sameCol && b.row - a.row > 1) {
        // Bow out to the right so the line doesn't run through nodes in between.
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
        const x2 = b.x + NODE_W, y2 = b.y + NODE_H / 2;
        const bow = 30 + 6 * (b.row - a.row);
        return `M${x1},${y1} C${x1 + bow},${y1} ${x2 + bow},${y2} ${x2},${y2}`;
      }
      const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H;
      const x2 = b.x + NODE_W / 2, y2 = b.y;
      const dy = Math.max(30, (y2 - y1) / 2);
      return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
    }
    // Same row or upward (only carryover links): connect the facing sides.
    const leftToRight = a.x < b.x;
    const x1 = leftToRight ? a.x + NODE_W : a.x;
    const x2 = leftToRight ? b.x : b.x + NODE_W;
    const y1 = a.y + NODE_H / 2, y2 = b.y + NODE_H / 2;
    if (sameCol) {
      const bx = a.x - 36;
      return `M${a.x},${y1} C${bx},${y1} ${bx},${y2} ${b.x},${y2}`;
    }
    const dx = (x2 - x1) / 2;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  // ------------------------------------------------------------------
  // Selection relationships
  // ------------------------------------------------------------------
  function ancestors(s, out) {
    s.requires.forEach(([pid]) => {
      if (!out.has(pid)) { out.add(pid); ancestors(byId.get(pid), out); }
    });
    return out;
  }
  function relatedSets(s) {
    const anc = ancestors(s, new Set());
    const nodes = new Set([s.id, ...anc]);
    s.unlocks.forEach(([id]) => nodes.add(id));
    s.carry.forEach(id => nodes.add(id));
    s.carriesTo.forEach(id => nodes.add(id));
    return { anc, nodes };
  }

  // ------------------------------------------------------------------
  // Render tree
  // ------------------------------------------------------------------
  function renderTree() {
    edgesG.textContent = '';
    nodesG.textContent = '';
    svg.classList.toggle('hide-carry', !prefs.showCarry);

    const sel = selectedId ? byId.get(selectedId) : null;
    const rel = sel ? relatedSets(sel) : null;
    svg.classList.toggle('has-selection', !!sel);

    // Carry edges first so hard edges draw on top.
    skills.forEach(s => {
      s.carry.forEach(cid => {
        const from = byId.get(cid);
        const related = sel && (s.id === sel.id || cid === sel.id);
        svgEl('path', {
          class: 'edge carry' + (related ? ' related' : ''),
          d: edgePath(from, s)
        }, edgesG);
      });
    });
    skills.forEach(s => {
      s.requires.forEach(req => {
        const from = byId.get(req[0]);
        let related = false;
        if (sel) {
          related = (s.id === sel.id || rel.anc.has(s.id)) && (from.id === sel.id || rel.anc.has(from.id));
          related = related || from.id === sel.id;
        }
        svgEl('path', {
          class: 'edge hard' + (prereqMet(req) ? ' met' : '') + (related ? ' related' : ''),
          d: edgePath(from, s)
        }, edgesG);
      });
    });

    skills.forEach(s => {
      const st = status(s);
      const lv = level(s.id);
      const fam = famById.get(s.family);
      const classes = ['node', st];
      if (sel && rel.nodes.has(s.id)) classes.push('related');
      if (s.id === selectedId) classes.push('selected');

      const g = svgEl('g', {
        class: classes.join(' '),
        transform: `translate(${s.x},${s.y})`,
        tabindex: 0,
        role: 'button',
        'data-id': s.id,
        'aria-label': `${s.name}: ${STATUS_TEXT[st]}, level ${lv} of ${s.tiers.length}`
      }, nodesG);
      svgEl('title', null, g).textContent = s.name;
      svgEl('rect', { class: 'node-bg', width: NODE_W, height: NODE_H, rx: 10 }, g);
      svgEl('rect', { x: 7, y: 11, width: 4, height: NODE_H - 22, rx: 2, fill: fam.color }, g);
      svgEl('text', { class: 'node-name', x: 20, y: 25 }, g).textContent = s.name;
      s.tiers.forEach((_, i) => {
        svgEl('circle', { class: 'pip' + (i < lv ? ' done' : ''), cx: 25 + i * 15, cy: 42, r: 4.5 }, g);
      });
      const meta = st === 'locked' ? 'locked' : st === 'mastered' ? 'mastered' : `${lv}/${s.tiers.length}`;
      svgEl('text', { class: 'node-meta', x: NODE_W - 12, y: 46, 'text-anchor': 'end' }, g).textContent = meta;
    });
  }

  // ------------------------------------------------------------------
  // Render side panel
  // ------------------------------------------------------------------
  function tierLabel(id, t) { return byId.get(id).tiers[t - 1]; }

  function linkButton(id, mark, markOk, sub) {
    const s = byId.get(id);
    return h('li', null,
      h('button', { type: 'button', class: 'link', onclick: () => select(id, true) },
        h('span', { class: 'mark' + (markOk ? ' ok' : '') }, mark),
        h('span', null, s.name),
        sub ? h('span', { class: 'sub' }, sub) : null
      )
    );
  }

  function renderSkillPanel(s) {
    const st = status(s);
    const lv = level(s.id);
    const fam = famById.get(s.family);

    const tiers = s.tiers.map((label, i) => {
      const n = i + 1;
      const tags = [];
      if (n === 1) tags.push(h('span', { class: 'tag' }, 'Can do it'));
      if (n === s.tiers.length && n > 1) tags.push(h('span', { class: 'tag' }, 'Mastered'));
      s.unlocks
        .filter(([, t]) => t === n)
        .forEach(([uid]) => tags.push(h('span', { class: 'tag unlock' }, '→ ' + byId.get(uid).name)));
      return h('li', null,
        h('button', {
          type: 'button',
          class: 'tier' + (n <= lv ? ' done' : ''),
          'data-tier': n,
          'aria-pressed': n <= lv ? 'true' : 'false',
          onclick: () => setLevel(s, lv === n ? n - 1 : n, n)
        },
          h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'),
          h('span', null,
            h('span', { class: 'label' }, label),
            tags.length ? h('span', { class: 'tags' }, tags) : null
          )
        )
      );
    });

    const nextTier = lv < s.tiers.length ? s.tiers[lv] : null;

    return [
      h('div', { class: 'panel-head' },
        h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${fam.color}` }), fam.name),
        h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => select(null) }, '×')
      ),
      h('h2', null, s.name),
      h('div', { class: 'status-line' },
        h('strong', null, STATUS_TEXT[st]),
        nextTier ? ` · next: ${nextTier}` : ''
      ),
      s.cue ? h('p', { class: 'cue' }, s.cue) : null,
      st === 'locked' && s.requires.length
        ? h('p', { class: 'note' }, 'Prerequisites aren\'t met yet. You can still log progress if you\'re already working on it.')
        : null,

      h('h3', null, 'Levels'),
      h('ul', { class: 'tiers' }, tiers),

      s.requires.length ? [
        h('h3', null, 'Requires'),
        h('ul', { class: 'links' }, s.requires.map(req =>
          linkButton(req[0], prereqMet(req) ? '✓' : '○', prereqMet(req), tierLabel(req[0], req[1]))
        ))
      ] : null,

      s.unlocks.length ? [
        h('h3', null, 'Leads to'),
        h('ul', { class: 'links' }, s.unlocks.map(([uid, t]) =>
          linkButton(uid, '→', false, `needs ${s.tiers[t - 1]} here`)
        ))
      ] : null,

      s.carry.length ? [
        h('h3', null, 'Helped by'),
        h('ul', { class: 'links' }, s.carry.map(id => linkButton(id, '⋯', false, null)))
      ] : null,

      s.carriesTo.length ? [
        h('h3', null, 'Also helps with'),
        h('ul', { class: 'links' }, s.carriesTo.map(id => linkButton(id, '⋯', false, null)))
      ] : null
    ];
  }

  function legendRow(svgMarkup, text) {
    const holder = h('div');
    holder.innerHTML = svgMarkup;
    return [holder.firstChild, h('span', null, text)];
  }

  function renderOverviewPanel() {
    const upNext = skills
      .filter(s => {
        const st = status(s);
        return st === 'progress' || st === 'available';
      })
      .sort((a, b) => (status(a) === 'progress' ? 0 : 1) - (status(b) === 'progress' ? 0 : 1) || a.row - b.row);

    const nodeSwatch = cls =>
      `<svg width="44" height="22" viewBox="0 0 44 22" class="${cls}" aria-hidden="true"><g class="node ${cls}"><rect class="node-bg" x="2" y="2" width="40" height="18" rx="5"/></g></svg>`;
    const lineSwatch = cls =>
      `<svg width="44" height="22" viewBox="0 0 44 22" aria-hidden="true"><path class="edge ${cls}" d="M2,11 H42"/></svg>`;

    return [
      h('h2', null, 'Your progressions'),
      h('p', { class: 'muted' },
        'Each skill has levels. The first is the bare minimum ("can do it"); the rest are the reps or holds that build toward the next skill. Click a skill to log your level and see what it leads to.'),

      h('h3', null, 'Up next'),
      upNext.length
        ? h('ul', { class: 'links' }, upNext.map(s => {
          const lv = level(s.id);
          return linkButton(s.id, status(s) === 'progress' ? '◐' : '○', status(s) === 'progress', `next: ${s.tiers[lv]}`);
        }))
        : h('p', { class: 'muted' }, 'Everything unlocked is mastered. Impressive.'),

      h('h3', null, 'Legend'),
      h('div', { class: 'legend' },
        legendRow(nodeSwatch('locked'), 'Locked: prerequisites not met'),
        legendRow(nodeSwatch('available'), 'Ready to start'),
        legendRow(nodeSwatch('progress'), 'In progress'),
        legendRow(nodeSwatch('mastered'), 'Mastered (all levels)'),
        legendRow(lineSwatch('hard'), 'Prerequisite, not yet met'),
        legendRow(lineSwatch('hard met'), 'Prerequisite met'),
        legendRow(lineSwatch('carry'), 'Carryover: helps, not required')
      ),
      h('p', { class: 'muted', style: 'margin-top:16px;font-size:13px' },
        'Progress is saved in this browser only. Use Export to back it up or move it to another device.')
    ];
  }

  function renderPanel(focusTier) {
    const scroll = panel.scrollTop;
    const sel = selectedId ? byId.get(selectedId) : null;
    panel.textContent = '';
    const content = sel ? renderSkillPanel(sel) : renderOverviewPanel();
    content.flat(2).forEach(c => { if (c) panel.appendChild(c); });
    if (focusTier) {
      panel.scrollTop = scroll;
      const btn = panel.querySelector(`.tier[data-tier="${focusTier}"]`);
      if (btn) btn.focus({ preventScroll: true });
    } else {
      panel.scrollTop = 0;
    }
  }

  function renderStats() {
    let m = 0, p = 0, a = 0;
    skills.forEach(s => {
      const st = status(s);
      if (st === 'mastered') m++;
      else if (st === 'progress') p++;
      else if (st === 'available') a++;
    });
    const stats = $('#stats');
    stats.textContent = '';
    stats.append(
      h('strong', null, m), ' mastered · ',
      h('strong', null, p), ' in progress · ',
      h('strong', null, a), ' ready · ',
      h('strong', null, skills.length), ' skills'
    );
  }

  function renderAll(focusTier) {
    renderTree();
    renderPanel(focusTier);
    renderStats();
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  function setLevel(s, newLevel, focusTier) {
    const before = new Set(skills.filter(isUnlocked).map(x => x.id));
    const wasMastered = status(s) === 'mastered';
    if (newLevel <= 0) delete progress[s.id];
    else progress[s.id] = Math.min(newLevel, s.tiers.length);
    saveProgress();

    const newlyUnlocked = skills.filter(x => isUnlocked(x) && !before.has(x.id) && x.requires.length);
    if (newlyUnlocked.length) {
      toast('Unlocked: ' + newlyUnlocked.map(x => x.name).join(', '));
    } else if (!wasMastered && status(s) === 'mastered') {
      toast(`${s.name} mastered`);
    }
    renderAll(focusTier);
  }

  function select(id, center) {
    selectedId = id;
    renderAll();
    if (id && center) centerOn(byId.get(id));
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ------------------------------------------------------------------
  // Pan & zoom
  // ------------------------------------------------------------------
  let view = { x: 0, y: 0, k: 1 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function applyView() {
    viewportG.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  }
  function zoomAt(mx, my, factor) {
    const k = clamp(view.k * factor, MIN_K, MAX_K);
    const f = k / view.k;
    view.x = mx - (mx - view.x) * f;
    view.y = my - (my - view.y) * f;
    view.k = k;
    applyView();
  }
  function animateTo(target) {
    const from = { ...view };
    const t0 = performance.now();
    const dur = 280;
    function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      view = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        k: from.k + (target.k - from.k) * e
      };
      applyView();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function fit(animate) {
    const r = svg.getBoundingClientRect();
    const k = clamp(Math.min(r.width / CONTENT_W, r.height / CONTENT_H), MIN_K, 1);
    const target = { k, x: (r.width - CONTENT_W * k) / 2, y: Math.max(0, (r.height - CONTENT_H * k) / 2) };
    if (animate) animateTo(target); else { view = target; applyView(); }
  }
  function initialView() {
    const r = svg.getBoundingClientRect();
    const k = clamp(r.width / CONTENT_W, 0.55, 1);
    view = { k, x: Math.max(0, (r.width - CONTENT_W * k) / 2), y: 0 };
    applyView();
  }
  function centerOn(s) {
    const r = svg.getBoundingClientRect();
    const k = Math.max(view.k, 0.7);
    animateTo({
      k,
      x: r.width / 2 - (s.x + NODE_W / 2) * k,
      y: r.height / 2 - (s.y + NODE_H / 2) * k
    });
  }

  const pointers = new Map();
  let dragStart = null;
  let dragMoved = false;
  let pinchDist = 0;

  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragMoved = false;
      dragStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  window.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (!dragMoved && Math.hypot(dx, dy) > 5) {
        dragMoved = true;
        canvas.classList.add('dragging');
      }
      if (dragMoved) {
        view.x = dragStart.vx + dx;
        view.y = dragStart.vy + dy;
        applyView();
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svg.getBoundingClientRect();
      if (pinchDist > 0) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinchDist);
      pinchDist = d;
      dragMoved = true;
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      dragStart = { x: p.x, y: p.y, vx: view.x, vy: view.y };
    } else if (pointers.size === 0) {
      dragStart = null;
      canvas.classList.remove('dragging');
    }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.0015));
  }, { passive: false });

  svg.addEventListener('click', e => {
    if (dragMoved) return;
    const node = e.target.closest('.node');
    select(node ? node.getAttribute('data-id') : null);
  });
  svg.addEventListener('keydown', e => {
    const node = e.target.closest && e.target.closest('.node');
    if (node && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const id = node.getAttribute('data-id');
      select(id);
      const again = nodesG.querySelector(`[data-id="${id}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selectedId) select(null);
  });

  $('#zoomIn').addEventListener('click', () => {
    const r = svg.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1.25);
  });
  $('#zoomOut').addEventListener('click', () => {
    const r = svg.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 0.8);
  });
  $('#btnFit').addEventListener('click', () => fit(true));

  // ------------------------------------------------------------------
  // Toolbar: carry toggle, export, import, reset
  // ------------------------------------------------------------------
  const carryToggle = $('#toggleCarry');
  carryToggle.checked = prefs.showCarry;
  carryToggle.addEventListener('change', () => {
    prefs.showCarry = carryToggle.checked;
    writeJSON(PREFS_KEY, prefs);
    svg.classList.toggle('hide-carry', !prefs.showCarry);
  });

  $('#btnExport').addEventListener('click', () => {
    const payload = {
      app: 'calisthenics-skill-tree',
      version: 1,
      exported: new Date().toISOString(),
      progress
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calisthenics-progress.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const fileInput = $('#fileImport');
  $('#btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    file.text().then(text => {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { toast('That file isn\'t valid JSON.'); return; }
      const incoming = sanitize(parsed && parsed.progress ? parsed.progress : parsed);
      const count = Object.keys(incoming).length;
      if (!count) { toast('No progress found in that file.'); return; }
      if (!confirm(`Replace your current progress with ${count} skills from this file?`)) return;
      progress = incoming;
      saveProgress();
      renderAll();
      toast(`Imported progress for ${count} skills`);
    });
  });

  $('#btnReset').addEventListener('click', () => {
    if (!Object.keys(progress).length) { toast('Nothing to reset.'); return; }
    if (!confirm('Clear all your progress? Export first if you want a backup.')) return;
    progress = {};
    saveProgress();
    renderAll();
    toast('Progress cleared');
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  renderAll();
  initialView();
})();
