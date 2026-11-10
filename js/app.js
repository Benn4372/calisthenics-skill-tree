(function () {
  'use strict';

  const DATA = window.SKILL_DATA;
  const STORAGE_KEY = 'calisthenics-skill-tree:v1';
  const PREFS_KEY = 'calisthenics-skill-tree:prefs';
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Geometry
  const UNIT = 112;          // horizontal spacing between neighbouring leaves
  const BRANCH_GAP = 0.6;    // extra spacing between branches, in units
  const ROW = 116;           // vertical spacing per difficulty level
  const ROOT_DROP = 240;     // Start sits this far below the branch bases
  const R = { skill: 25, hub: 36, root: 44 };
  const RING_GAP = 6;        // gap between disc and progress ring
  const RING_W = 6;          // progress ring thickness
  const MARGIN_X = 80;
  const MARGIN_TOP = 70;
  const MARGIN_BOTTOM = 90;
  const MIN_K = 0.15;
  const MAX_K = 2.5;

  // ------------------------------------------------------------------
  // Data model: root -> branch hubs -> skills
  // ------------------------------------------------------------------
  const ROOT_ID = '_root';
  const root = {
    id: ROOT_ID, kind: 'root', name: (DATA.root && DATA.root.name) || 'Start',
    children: [], level: 0
  };
  const hubs = DATA.branches.map(b => ({
    id: 'hub:' + b.id, kind: 'hub', branch: b.id, name: b.name, color: b.color,
    blurb: b.blurb || '', children: [], parent: root, level: 1
  }));
  root.children = hubs.slice();
  const hubByBranch = new Map(hubs.map(hb => [hb.branch, hb]));

  const skills = DATA.skills.map(s => ({
    ...s,
    kind: 'skill',
    requires: s.requires || [],
    carry: s.carry || [],
    unlocks: [],     // [skillId, tierNeededFromThisSkill]
    carriesTo: [],   // skillIds this one helps with
    children: []
  }));
  const byId = new Map(skills.map(s => [s.id, s]));
  const nodeById = new Map([[ROOT_ID, root], ...hubs.map(hb => [hb.id, hb]), ...skills.map(s => [s.id, s])]);

  skills.forEach(s => {
    if (!hubByBranch.has(s.branch)) {
      console.warn(`Skill "${s.id}" has unknown branch "${s.branch}"`);
      s.branch = hubs[0].branch;
    }
    s.color = hubByBranch.get(s.branch).color;
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

  // Tree parent: explicit `parent`, else first same-branch prerequisite, else the branch hub.
  skills.forEach(s => {
    let parent = null;
    if (s.parent) {
      parent = byId.get(s.parent) || null;
      if (!parent) console.warn(`Skill "${s.id}" has unknown parent "${s.parent}"`);
    }
    if (!parent) {
      const req = s.requires.find(([pid]) => byId.get(pid).branch === s.branch);
      parent = req ? byId.get(req[0]) : hubByBranch.get(s.branch);
    }
    s.parent = parent;
  });
  // Guard against parent cycles (bad `parent` overrides): fall back to the hub.
  skills.forEach(s => {
    const seen = new Set([s.id]);
    let p = s.parent;
    while (p && p.kind === 'skill') {
      if (seen.has(p.id)) {
        console.warn(`Parent cycle at "${s.id}"`);
        s.parent = hubByBranch.get(s.branch);
        break;
      }
      seen.add(p.id);
      p = p.parent;
    }
  });
  skills.forEach(s => s.parent.children.push(s));

  // The tree-edge prerequisite (if the parent is a skill) vs cross-links.
  skills.forEach(s => {
    s.parentReq = s.parent.kind === 'skill' ? s.requires.find(([pid]) => pid === s.parent.id) || null : null;
    s.crossReqs = s.requires.filter(r => r !== s.parentReq);
  });

  // ------------------------------------------------------------------
  // Layout: height = difficulty level, spread = tree shape
  // ------------------------------------------------------------------
  const levelMemo = new Map();
  function levelOf(s, stack) {
    if (levelMemo.has(s.id)) return levelMemo.get(s.id);
    if (stack.has(s.id)) { console.warn(`Prerequisite cycle at "${s.id}"`); return 2; }
    stack.add(s.id);
    let lv = s.parent.kind === 'skill' ? levelOf(s.parent, stack) + 1 : 2;
    s.requires.forEach(([pid]) => { lv = Math.max(lv, levelOf(byId.get(pid), stack) + 1); });
    stack.delete(s.id);
    levelMemo.set(s.id, lv);
    return lv;
  }
  skills.forEach(s => { s.level = levelOf(s, new Set()); });
  const maxLevel = Math.max(...skills.map(s => s.level));

  let cursor = 0;
  function place(n) {
    if (!n.children.length) { n.ux = cursor; cursor += 1; return; }
    n.children.forEach(place);
    n.ux = (n.children[0].ux + n.children[n.children.length - 1].ux) / 2;
  }
  hubs.forEach((hb, i) => {
    if (i > 0) cursor += BRANCH_GAP;
    place(hb);
  });
  root.ux = (hubs[0].ux + hubs[hubs.length - 1].ux) / 2;

  const CONTENT_W = MARGIN_X * 2 + (cursor - 1) * UNIT;
  const CONTENT_H = MARGIN_TOP + (maxLevel - 1) * ROW + ROOT_DROP + MARGIN_BOTTOM;
  nodeById.forEach(n => {
    n.x = MARGIN_X + n.ux * UNIT;
    n.y = n.kind === 'root'
      ? MARGIN_TOP + (maxLevel - 1) * ROW + ROOT_DROP
      : MARGIN_TOP + (maxLevel - n.level) * ROW;
  });

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
  function completion(list) {
    let done = 0, total = 0;
    list.forEach(s => { done += level(s.id); total += s.tiers.length; });
    return { done, total, frac: total ? done / total : 0 };
  }
  const branchSkills = branch => skills.filter(s => s.branch === branch);

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
    children.flat(3).forEach(c => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }

  const svg = $('#tree');
  const viewportG = $('#viewport');
  const edgesG = $('#edges');
  const nodesG = $('#nodes');
  const panel = $('#panel');
  const canvas = $('#canvas');

  let selectedId = null;

  // ------------------------------------------------------------------
  // Geometry helpers
  // ------------------------------------------------------------------
  function curve(a, b) {
    const dy = b.y - a.y;
    if (dy < -1) {
      const c = dy * 0.55;
      return `M${a.x},${a.y} C${a.x},${a.y + c} ${b.x},${b.y - c} ${b.x},${b.y}`;
    }
    // Same height or downward (cross-links/carryover only): arc over the top.
    const lift = 46 + Math.abs(dy) * 0.25;
    const dx = (b.x - a.x) / 3;
    return `M${a.x},${a.y} C${a.x + dx},${a.y - lift} ${b.x - dx},${b.y - lift} ${b.x},${b.y}`;
  }
  function polar(r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  }
  function arcPath(r, a0, a1) {
    const [x0, y0] = polar(r, a0);
    const [x1, y1] = polar(r, a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  function wrapLabel(text, max) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach(w => {
      if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; }
      else line = line ? line + ' ' + w : w;
    });
    if (line) lines.push(line);
    return lines;
  }

  // ------------------------------------------------------------------
  // Selection relationships
  // ------------------------------------------------------------------
  // `path`: nodes whose connecting edges get highlighted (the route to the
  // selection). `nodes`: everything left undimmed (path + direct neighbours).
  function relatedSets(id) {
    const path = new Set();
    if (!id) return { path, nodes: path };
    const n = nodeById.get(id);
    path.add(id);
    if (n.kind === 'hub') {
      path.add(ROOT_ID);
      skills.forEach(s => { if (s.branch === n.branch) path.add(s.id); });
      return { path, nodes: path };
    }
    // Skill: every prerequisite, recursively, plus their route down to Start.
    const stack = [n];
    while (stack.length) {
      const s = stack.pop();
      s.requires.forEach(([pid]) => {
        if (!path.has(pid)) { path.add(pid); stack.push(byId.get(pid)); }
      });
    }
    [...path].forEach(sid => {
      let p = nodeById.get(sid).parent;
      while (p) { path.add(p.id); p = p.parent; }
    });
    const nodes = new Set(path);
    n.unlocks.forEach(([uid]) => nodes.add(uid));
    n.carry.forEach(cid => nodes.add(cid));
    n.carriesTo.forEach(cid => nodes.add(cid));
    return { path, nodes };
  }

  // ------------------------------------------------------------------
  // Render tree
  // ------------------------------------------------------------------
  function renderTree() {
    edgesG.textContent = '';
    nodesG.textContent = '';
    svg.classList.toggle('hide-carry', !prefs.showCarry);

    const sel = selectedId ? nodeById.get(selectedId) : null;
    const rel = relatedSets(selectedId);
    svg.classList.toggle('has-selection', !!sel);

    const edgeRelated = (a, b) => !!sel && (
      a.id === selectedId || b.id === selectedId || (rel.path.has(a.id) && rel.path.has(b.id))
    );

    // 1. Carryover (dashed)
    skills.forEach(s => {
      s.carry.forEach(cid => {
        const from = byId.get(cid);
        svgEl('path', {
          class: 'edge carry' + (edgeRelated(from, s) ? ' related' : ''),
          d: curve(from, s)
        }, edgesG);
      });
    });
    // 2. Cross-branch / secondary prerequisites (thin)
    skills.forEach(s => {
      s.crossReqs.forEach(req => {
        const from = byId.get(req[0]);
        svgEl('path', {
          class: 'edge cross' + (prereqMet(req) ? ' met' : '') + (edgeRelated(from, s) ? ' related' : ''),
          d: curve(from, s)
        }, edgesG);
      });
    });
    // 3. Tree branches (thick, branch colour)
    nodeById.forEach(n => {
      if (!n.parent) return;
      const lit = n.kind === 'hub' ? true : status(n) !== 'locked';
      svgEl('path', {
        class: `edge tree ${n.kind === 'hub' ? 'trunk' : ''}` + (lit ? ' lit' : '') +
          (edgeRelated(n.parent, n) ? ' related' : ''),
        d: curve(n.parent, n),
        stroke: n.color
      }, edgesG);
    });

    // 4. Nodes
    drawNode(root, rel, sel);
    hubs.forEach(hb => drawNode(hb, rel, sel));
    skills.forEach(s => drawNode(s, rel, sel));
  }

  function drawRing(g, r, frac, color) {
    const rr = r + RING_GAP + RING_W / 2;
    svgEl('circle', { class: 'ring-track', r: rr, 'stroke-width': RING_W }, g);
    if (frac >= 0.999) {
      svgEl('circle', { class: 'ring-fill', r: rr, 'stroke-width': RING_W, stroke: color }, g);
    } else if (frac > 0) {
      svgEl('path', { class: 'ring-fill', d: arcPath(rr, 0, 360 * frac), 'stroke-width': RING_W, stroke: color }, g);
    }
  }

  function drawSegments(g, r, n, done, color) {
    const rr = r + RING_GAP + RING_W / 2;
    if (n === 1) {
      svgEl('circle', { class: done ? 'ring-fill' : 'ring-track', r: rr, 'stroke-width': RING_W, stroke: done ? color : null }, g);
      return;
    }
    const seg = 360 / n;
    const gap = 16;
    for (let i = 0; i < n; i++) {
      const isDone = i < done;
      const attrs = {
        class: isDone ? 'ring-fill' : 'ring-track',
        d: arcPath(rr, i * seg + gap / 2, (i + 1) * seg - gap / 2),
        'stroke-width': RING_W
      };
      if (isDone) attrs.stroke = color;
      svgEl('path', attrs, g);
    }
  }

  function drawLabel(g, text, y, max) {
    const lines = wrapLabel(text, max);
    const t = svgEl('text', { class: 'label', y, 'text-anchor': 'middle' }, g);
    lines.forEach((ln, i) => {
      const ts = svgEl('tspan', { x: 0, dy: i === 0 ? 0 : 14 }, t);
      ts.textContent = ln;
    });
  }

  function drawNode(n, rel, sel) {
    const classes = ['node', n.kind];
    let st = null;
    if (n.kind === 'skill') { st = status(n); classes.push(st); }
    if (sel && rel.nodes.has(n.id)) classes.push('related');
    if (n.id === selectedId) classes.push('selected');

    const g = svgEl('g', {
      class: classes.join(' '),
      transform: `translate(${n.x},${n.y})`,
      tabindex: 0,
      role: 'button',
      'data-id': n.id
    }, nodesG);

    const r = R[n.kind];

    if (n.kind === 'root') {
      const c = completion(skills);
      g.setAttribute('aria-label', `${n.name}: ${Math.round(c.frac * 100)}% of all levels complete`);
      svgEl('title', null, g).textContent = `${n.name}: overview`;
      drawRing(g, r, c.frac, 'var(--accent)');
      svgEl('circle', { class: 'disc', r }, g);
      svgEl('text', { class: 'root-name', y: -2, 'text-anchor': 'middle' }, g).textContent = n.name;
      svgEl('text', { class: 'root-pct', y: 15, 'text-anchor': 'middle' }, g).textContent = `${Math.round(c.frac * 100)}%`;
      return;
    }

    if (n.kind === 'hub') {
      const c = completion(branchSkills(n.branch));
      g.setAttribute('aria-label', `${n.name} branch: ${Math.round(c.frac * 100)}% complete`);
      svgEl('title', null, g).textContent = `${n.name} branch`;
      drawRing(g, r, c.frac, n.color);
      svgEl('circle', { class: 'disc', r, style: `fill:${n.color}` }, g);
      svgEl('text', { class: 'hub-name', y: 5, 'text-anchor': 'middle' }, g).textContent = n.name;
      return;
    }

    // Skill
    const lv = level(n.id);
    const total = n.tiers.length;
    g.setAttribute('aria-label', `${n.name}: ${STATUS_TEXT[st]}, level ${lv} of ${total}`);
    svgEl('title', null, g).textContent = n.name;
    drawSegments(g, r, total, lv, n.color);

    const disc = svgEl('circle', { class: 'disc', r }, g);
    if (st === 'mastered') {
      disc.style.fill = n.color;
      svgEl('path', { class: 'glyph-check', d: 'M-9,0 L-3,6 L9,-7' }, g);
    } else if (st === 'locked') {
      svgEl('rect', { class: 'glyph-lock', x: -7, y: -2, width: 14, height: 11, rx: 2 }, g);
      svgEl('path', { class: 'glyph-lock-shackle', d: 'M-4,-2 V-6 A4,4 0 0 1 4,-6 V-2' }, g);
    } else {
      disc.style.stroke = n.color;
      if (st === 'progress') {
        svgEl('circle', { class: 'disc-tint', r: r - 2, fill: n.color }, g);
      }
      svgEl('text', { class: 'level-text', y: 5, 'text-anchor': 'middle' }, g).textContent = `${lv}/${total}`;
    }
    drawLabel(g, n.name, r + RING_GAP + RING_W + 15, 15);
  }

  // ------------------------------------------------------------------
  // Side panel
  // ------------------------------------------------------------------
  function linkButton(id, mark, markOk, sub) {
    const n = nodeById.get(id);
    return h('li', null,
      h('button', { type: 'button', class: 'link', onclick: () => select(id, true) },
        h('span', { class: 'mark' + (markOk ? ' ok' : '') }, mark),
        h('span', null, n.name),
        sub ? h('span', { class: 'sub' }, sub) : null
      )
    );
  }

  function progressBar(frac, color) {
    return h('span', { class: 'bar' },
      h('span', { class: 'bar-fill', style: `width:${(frac * 100).toFixed(1)}%;background:${color}` }));
  }

  function renderSkillPanel(s) {
    const st = status(s);
    const lv = level(s.id);
    const hub = hubByBranch.get(s.branch);

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
        h('button', { type: 'button', class: 'chip', onclick: () => select(hub.id, true) },
          h('span', { class: 'dot', style: `background:${hub.color}` }), hub.name),
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
          linkButton(req[0], prereqMet(req) ? '✓' : '○', prereqMet(req), byId.get(req[0]).tiers[req[1] - 1])
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

  function renderHubPanel(hb) {
    const list = branchSkills(hb.branch).slice().sort((a, b) => a.level - b.level || a.x - b.x);
    const c = completion(list);
    const marks = { locked: '○', available: '○', progress: '◐', mastered: '●' };
    return [
      h('div', { class: 'panel-head' },
        h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${hb.color}` }), 'Branch'),
        h('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => select(null) }, '×')
      ),
      h('h2', null, hb.name),
      hb.blurb ? h('p', { class: 'muted' }, hb.blurb) : null,
      h('div', { class: 'branch-progress' },
        progressBar(c.frac, hb.color),
        h('span', { class: 'muted' }, `${c.done} / ${c.total} levels`)
      ),
      h('h3', null, 'Skills'),
      h('ul', { class: 'links' }, list.map(s => {
        const st = status(s);
        const lv = level(s.id);
        const sub = st === 'mastered' ? 'mastered' : st === 'locked' ? 'locked' : `next: ${s.tiers[lv]}`;
        return linkButton(s.id, marks[st], st === 'progress' || st === 'mastered', sub);
      }))
    ];
  }

  function legendNode(cls, color) {
    const g = [`<svg width="40" height="40" viewBox="-20 -20 40 40" aria-hidden="true"><g class="node skill ${cls}">`];
    g.push(`<circle class="ring-track" r="16" stroke-width="4"/>`);
    if (cls === 'progress') g.push(`<path class="ring-fill" d="${arcPath(16, 8, 112)}" stroke="${color}" stroke-width="4"/>`);
    if (cls === 'mastered') g.push(`<circle class="ring-fill" r="16" stroke="${color}" stroke-width="4"/>`);
    const style = cls === 'mastered' ? `fill:${color}` : cls === 'available' || cls === 'progress' ? `stroke:${color}` : '';
    g.push(`<circle class="disc" r="11" style="${style}"/>`);
    if (cls === 'progress') g.push(`<circle class="disc-tint" r="9" fill="${color}"/>`);
    g.push('</g></svg>');
    return g.join('');
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
      .sort((a, b) => (status(a) === 'progress' ? 0 : 1) - (status(b) === 'progress' ? 0 : 1) || a.level - b.level);
    const demo = '#3b82d6';
    const line = (cls, extra) =>
      `<svg width="40" height="20" viewBox="0 0 40 20" aria-hidden="true"><path class="edge ${cls}" d="M2,10 H38" ${extra || ''}/></svg>`;

    return [
      h('h2', null, 'Your skill tree'),
      h('p', { class: 'muted' },
        'The tree grows up from Start into five branches. Each skill has levels: the first is the bare minimum ("can do it"), the rest are the reps or holds that build toward the next skill. Click any circle to log your level.'),

      h('h3', null, 'Branches'),
      h('ul', { class: 'branches' }, hubs.map(hb => {
        const c = completion(branchSkills(hb.branch));
        return h('li', null,
          h('button', { type: 'button', class: 'branch-row', onclick: () => select(hb.id, true) },
            h('span', { class: 'branch-name' }, h('span', { class: 'dot', style: `background:${hb.color}` }), hb.name),
            progressBar(c.frac, hb.color),
            h('span', { class: 'muted pct' }, `${Math.round(c.frac * 100)}%`)
          )
        );
      })),

      h('h3', null, 'Up next'),
      upNext.length
        ? h('ul', { class: 'links' }, upNext.map(s => {
          const lv = level(s.id);
          return linkButton(s.id, status(s) === 'progress' ? '◐' : '○', status(s) === 'progress', `next: ${s.tiers[lv]}`);
        }))
        : h('p', { class: 'muted' }, 'Everything unlocked is mastered. Impressive.'),

      h('h3', null, 'Legend'),
      h('div', { class: 'legend' },
        legendRow(legendNode('locked', demo), 'Locked: prerequisites not met'),
        legendRow(legendNode('available', demo), 'Ready to start'),
        legendRow(legendNode('progress', demo), 'In progress: ring shows levels done'),
        legendRow(legendNode('mastered', demo), 'Mastered: every level done'),
        legendRow(line('tree lit', `stroke="${demo}"`), 'Branch: grows out of the skill below'),
        legendRow(line('cross met'), 'Extra prerequisite, often from another branch'),
        legendRow(line('carry'), 'Carryover: helps, not required')
      ),
      h('p', { class: 'muted', style: 'margin-top:16px;font-size:13px' },
        'Progress is saved in this browser only. Use Export to back it up or move it to another device.')
    ];
  }

  function renderPanel(focusTier) {
    const scroll = panel.scrollTop;
    const sel = selectedId ? nodeById.get(selectedId) : null;
    panel.textContent = '';
    let content;
    if (!sel || sel.kind === 'root') content = renderOverviewPanel();
    else if (sel.kind === 'hub') content = renderHubPanel(sel);
    else content = renderSkillPanel(sel);
    content.flat(3).forEach(c => { if (c) panel.appendChild(c); });
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
    selectedId = id === ROOT_ID ? null : id;
    renderAll();
    if (id && center) centerOn(nodeById.get(id));
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
    const dur = 300;
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
    const target = { k, x: (r.width - CONTENT_W * k) / 2, y: (r.height - CONTENT_H * k) / 2 };
    if (animate) animateTo(target); else { view = target; applyView(); }
  }
  // Start at the base of the tree: Start node centred at the bottom.
  function initialView() {
    const r = svg.getBoundingClientRect();
    const fitK = Math.min(r.width / CONTENT_W, r.height / CONTENT_H);
    const k = clamp(fitK, r.width < 600 ? 0.5 : 0.42, 1);
    view = {
      k,
      x: r.width / 2 - root.x * k,
      y: Math.min((r.height - CONTENT_H * k) / 2, r.height - (root.y + R.root + 40) * k)
    };
    applyView();
  }
  function centerOn(n) {
    const r = svg.getBoundingClientRect();
    const k = Math.max(view.k, 0.75);
    animateTo({ k, x: r.width / 2 - n.x * k, y: r.height / 2 - n.y * k });
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
      const again = nodesG.querySelector(`[data-id="${CSS.escape(id)}"]`);
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
  // Position the view once the canvas actually has a size (it can be 0x0
  // while the page is still being laid out or opened in a hidden tab).
  let viewReady = false;
  function tryInitialView() {
    if (viewReady) return;
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) { viewReady = true; initialView(); }
  }
  tryInitialView();
  if (!viewReady && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { tryInitialView(); if (viewReady) ro.disconnect(); });
    ro.observe(svg);
  }
})();
