/* Residual Continuum — app.js
   Data-driven SPA with Source & Citation Engine
*/

let TIMELINE = [];
let EVIDENCE = { meters: [], claims: [], categories: [] };
let ARTICLES = [];
let SOURCES = { sources: [] };
let sourceMap = {}; // id → source object

async function loadData() {
  try {
    const [tl, ev, ar, so] = await Promise.all([
      fetch('data/timeline.json').then(r => r.json()),
      fetch('data/evidence.json').then(r => r.json()),
      fetch('data/articles.json').then(r => r.json()),
      fetch('data/sources.json').then(r => r.json())
    ]);
    TIMELINE = tl;
    EVIDENCE = ev;
    ARTICLES = ar;
    SOURCES = so;
    sourceMap = {};
    (SOURCES.sources || []).forEach(s => { sourceMap[s.id] = s; });
    renderAll();
  } catch (err) {
    console.error('Failed to load data:', err);
    document.querySelectorAll('.loading').forEach(el => {
      el.textContent = 'Unable to load data. Check that data/*.json files are present.';
    });
  }
}

function renderAll() {
  renderTimeline();
  renderEvidenceMeters();
  renderClaims();
  renderArticlesList();
  renderSources();
  if (EVIDENCE.categories && EVIDENCE.categories.length) {
    document.getElementById('categoriesList').textContent = EVIDENCE.categories.join(' · ');
  }
}

/* ---------- Citation helpers ---------- */
function processCitations(text) {
  if (!text) return text;
  return text.replace(/\[ref:([a-z0-9\-]+)\]/gi, (_, id) => {
    const s = sourceMap[id];
    if (!s) return `<span class="cite" title="Source not found">[?]</span>`;
    const label = s.year || s.author.split(',')[0];
    return `<span class="cite" onclick="showSource('${id}')" title="${s.author} (${s.year})">${label}</span>`;
  });
}

function showSource(id) {
  const s = sourceMap[id];
  if (!s) return;
  const popup = document.getElementById('citePopup');
  const card = document.getElementById('citePopupCard');
  card.innerHTML = `
    <button class="close-btn" onclick="closeSource()">×</button>
    <div class="field">${s.field || 'Source'}</div>
    <h3>${s.title}</h3>
    <div class="meta">${s.author} · ${s.year}<br>${s.publication}</div>
    <div class="summary">${s.summary || ''}</div>
    <div class="reliability">${s.reliability || ''}</div>
    ${s.doi ? `<p style="font-size:0.8rem;color:var(--dim);margin-top:12px">DOI: ${s.doi}</p>` : ''}
  `;
  popup.classList.add('open');
}

function closeSource() {
  document.getElementById('citePopup').classList.remove('open');
}

function buildBibliography(sourceIds) {
  if (!sourceIds || !sourceIds.length) return '';
  const unique = [...new Set(sourceIds)];
  const items = unique.map(id => {
    const s = sourceMap[id];
    if (!s) return `<div class="bib-item"><span class="bib-id">[?]</span> Source ${id} not found</div>`;
    return `<div class="bib-item"><span class="bib-id">[${s.year}]</span> ${s.author}. <em>${s.title}</em>. ${s.publication}.</div>`;
  }).join('');
  return `<div class="bibliography"><h2>Bibliography</h2>${items}</div>`;
}

/* ---------- Renderers ---------- */
function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  container.innerHTML = TIMELINE.map(e => {
    const fp = Object.entries(e.fingerprint || {}).map(([k, v]) => {
      const color = k === 'climate' ? 'var(--climate)' : (k === 'archaeology' || k === 'geology') ? 'var(--arch)' : 'var(--text-cat)';
      return `<div class="fp-item">${k}<div class="fp-bar"><div class="fp-fill" style="width:${v}%;background:${color}"></div></div></div>`;
    }).join('');
    const sections = (e.sections || []).map(s => `<h3>${s.h}</h3><p>${processCitations(s.p)}</p>`).join('');
    const tags = (e.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
    return `
      <div class="era">
        <div class="era-card glass" onclick="tog(this)">
          <div class="era-head">
            <div class="era-year">${e.year}</div>
            <div class="era-title">${e.title}</div>
            <div class="era-summary">${e.summary}</div>
            <div class="confidence-badge">${e.confidence}</div>
          </div>
          <div class="era-detail">
            <div class="detail-body">
              ${sections}
              <div class="fingerprint">${fp}</div>
              <div class="tags">${tags}</div>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderEvidenceMeters() {
  document.getElementById('evidenceMeters').innerHTML = EVIDENCE.meters.map(m => `
    <div class="meter-block">
      <div class="meter-header">
        <span class="meter-label">${m.label}</span>
        <span class="meter-score">${m.strength}</span>
      </div>
      <div class="meter-track"><div class="meter-fill" style="width:${m.score}%"></div></div>
      <p class="meter-note">${m.note}</p>
    </div>`).join('');
}

function renderClaims() {
  document.getElementById('claimInspector').innerHTML = EVIDENCE.claims.map(c => `
    <div class="claim-card glass">
      <h3>${c.claim}</h3>
      <div class="claim-section"><strong>Supporting evidence</strong><p>${processCitations(c.support)}</p></div>
      <div class="claim-section"><strong>Counterpoints</strong><p>${c.counter}</p></div>
      <div class="claim-section"><strong>Remaining questions</strong><p>${c.questions}</p></div>
      <div class="claim-section"><strong>References</strong><p>${c.refs}</p></div>
    </div>`).join('');
}

function renderArticlesList() {
  document.getElementById('articlesList').innerHTML = ARTICLES.map(a => `
    <a href="#" class="card glass" onclick="openArticle('${a.id}')" style="margin-bottom:11px">
      <div class="article-meta">${a.num} · ${a.status}${a.readingTime !== '—' ? ' · ' + a.readingTime : ''}</div>
      <h2>${a.title}</h2>
      <p>${a.subtitle}</p>
    </a>`).join('');
}

function renderSources() {
  const list = document.getElementById('sourcesList');
  if (!SOURCES.sources || !SOURCES.sources.length) {
    list.innerHTML = '<p style="font-size:0.86rem;color:var(--dim)">No sources registered yet.</p>';
    return;
  }
  list.innerHTML = SOURCES.sources.map(s => `
    <div class="source-item" style="cursor:pointer" onclick="showSource('${s.id}')">
      <strong>${s.author} (${s.year})</strong><br>
      ${s.title}<br>
      <span style="font-size:0.78rem">${s.publication} · ${s.field}</span>
    </div>`).join('');
}

function openArticle(id) {
  const a = ARTICLES.find(x => x.id === id);
  if (!a) return;
  if (!a.exec) {
    document.getElementById('articleContent').innerHTML = `
      <div class="article-hero">
        <div class="back-link" onclick="go('articles')">← Investigations</div>
        <div class="label">${a.num} · ${a.status}</div>
        <h1>${a.title}</h1>
        <p class="subtitle">${a.subtitle}</p>
        <p style="font-size:0.9rem;color:var(--muted)">This investigation is still in outline stage. Full treatment will follow the same structure as 001 and 002.</p>
      </div>`;
    go('articleView');
    return;
  }

  const sectionsHtml = a.sections.map(s => `
    <div class="article-section">
      <h2>${s.h2}</h2>
      ${s.blocks.map(b => `<h3>${b.h3}</h3><p>${processCitations(b.p)}</p>`).join('')}
    </div>`).join('');

  const evidenceHtml = a.evidenceBlocks.map(eb => `
    <div class="evidence-block glass">
      <div class="eb-header">
        <span class="eb-type">${eb.type}</span>
        <span class="eb-strength">${eb.strength}</span>
      </div>
      <p>${processCitations(eb.text)}</p>
      <p style="font-size:0.82rem;color:var(--dim)"><em>Dating:</em> ${eb.dating}</p>
      <div class="limitations"><strong>Limitations:</strong> ${eb.limitations}</div>
      ${(eb.sourceIds || []).length ? `<div style="margin-top:8px;font-size:0.78rem">${(eb.sourceIds || []).map(sid => {
        const s = sourceMap[sid];
        return s ? `<span class="cite" onclick="showSource('${sid}')">${s.year || sid}</span>` : '';
      }).join(' ')}</div>` : ''}
    </div>`).join('');

  const countersHtml = a.counters.map(c => `
    <div class="counter-section">
      <h3>${c.title}</h3>
      <p>${c.text}</p>
    </div>`).join('');

  const bib = a.sourceIds && a.sourceIds.length
    ? buildBibliography(a.sourceIds)
    : (a.sources && a.sources.length
        ? `<div class="bibliography"><h2>Selected Sources</h2>${a.sources.map(s => `<div class="bib-item">${s}</div>`).join('')}</div>`
        : '');

  document.getElementById('articleContent').innerHTML = `
    <div class="article-hero">
      <div class="back-link" onclick="go('articles')">← Investigations</div>
      <div class="label">${a.num} · ${a.status}</div>
      <h1>${a.title}</h1>
      <p class="subtitle">${a.subtitle}</p>
      <div class="article-meta-row">
        <span>${a.readingTime} read</span>
        <span>Updated ${a.updated}</span>
      </div>
    </div>

    <div class="exec-summary glass">
      <h2>Executive Summary</h2>
      <div class="exec-block"><strong>What is known</strong><p>${a.exec.known}</p></div>
      <div class="exec-block"><strong>What is uncertain</strong><p>${a.exec.uncertain}</p></div>
      <div class="exec-block"><strong>Why it matters</strong><p>${a.exec.matters}</p></div>
    </div>

    ${sectionsHtml}

    <div class="article-section">
      <h2>Evidence Blocks</h2>
      ${evidenceHtml}
    </div>

    <div class="article-section">
      <h2>Counterarguments & Remaining Debates</h2>
      ${countersHtml}
    </div>

    ${bib}`;
  go('articleView');
}

/* Navigation & interaction */
function go(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const map = { home: 0, timeline: 1, articles: 2, data: 3, method: 4, articleView: 2 };
  const items = document.querySelectorAll('.nav-item');
  if (items[map[id]] !== undefined) items[map[id]].classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function tog(card) {
  const d = card.querySelector('.era-detail');
  const open = d.classList.contains('open');
  document.querySelectorAll('.era-detail.open').forEach(x => x.classList.remove('open'));
  if (!open) {
    d.classList.add('open');
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 40);
  }
}

function openSearch() {
  document.getElementById('searchOverlay').classList.add('open');
  document.getElementById('searchInput').focus();
}
function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('open');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
}

function runSearch(q) {
  q = q.trim().toLowerCase();
  const results = document.getElementById('searchResults');
  if (!q) { results.innerHTML = ''; return; }

  const hits = [];
  TIMELINE.forEach(e => {
    if (e.title.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q) || e.year.toLowerCase().includes(q) ||
        (e.tags || []).some(t => t.toLowerCase().includes(q))) {
      hits.push({ type: 'Timeline', title: e.title, sub: e.year + ' — ' + e.summary.slice(0, 80) + '…', action: () => { closeSearch(); go('timeline'); } });
    }
  });
  ARTICLES.forEach(a => {
    if (a.title.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q)) {
      hits.push({ type: 'Investigation', title: a.title, sub: a.subtitle, action: () => { closeSearch(); openArticle(a.id); } });
    }
  });
  (EVIDENCE.meters || []).forEach(m => {
    if (m.label.toLowerCase().includes(q) || m.note.toLowerCase().includes(q)) {
      hits.push({ type: 'Evidence', title: m.label, sub: m.strength + ' — ' + m.note.slice(0, 70) + '…', action: () => { closeSearch(); go('data'); } });
    }
  });
  (SOURCES.sources || []).forEach(s => {
    if (s.title.toLowerCase().includes(q) || s.author.toLowerCase().includes(q) || (s.summary || '').toLowerCase().includes(q)) {
      hits.push({ type: 'Source', title: s.title, sub: s.author + ' (' + s.year + ')', action: () => { closeSearch(); showSource(s.id); } });
    }
  });

  results.innerHTML = hits.length ? hits.map((h, i) => `
    <div class="search-result glass" onclick="window.__searchActions[${i}]()">
      <div style="font-size:0.68rem;color:var(--accent);margin-bottom:2px">${h.type}</div>
      <h3>${h.title}</h3>
      <p>${h.sub}</p>
    </div>`).join('') : '<p style="color:var(--dim);padding:12px">No matches.</p>';

  window.__searchActions = hits.map(h => h.action);
}

/* Boot */
loadData();
