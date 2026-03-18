import type { RunState, FlairResult } from '../store/run-state';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RESULT_LABELS: Record<string, { label: string; color: string }> = {
  posted: { label: 'Posted', color: '#16a34a' },
  skipped: { label: 'Skipped', color: '#ca8a04' },
  failed: { label: 'Failed', color: '#dc2626' },
  dry_run: { label: 'Dry Run', color: '#6366f1' },
  comment_added: { label: 'Comment Added', color: '#0ea5e9' },
  comment_skipped: { label: 'Comment Exists', color: '#525252' },
};

const COMMENT_LABELS: Record<string, { label: string; color: string }> = {
  posted: { label: 'Comment ✓', color: '#16a34a' },
  failed: { label: 'Comment ✗', color: '#dc2626' },
  skipped: { label: 'No comment', color: '#525252' },
};

function flairBadge(flair: FlairResult): string {
  if (flair.status === 'set') return badge(`${flair.party} · ${flair.person}`, '#854d0e');
  if (flair.status === 'failed') return badge('Flair ✗', '#dc2626');
  return '';
}

function badge(label: string, color: string): string {
  return `<span class="badge" style="background:${color}">${esc(label)}</span>`;
}

function formatDate(iso: string): string {
  return esc(new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
}

function buildLatestCard(state: RunState): string {
  const resultInfo = RESULT_LABELS[state.lastRunResult] ?? { label: state.lastRunResult, color: '#737373' };
  const sourceLabel = state.source === 'manual' ? ' <span class="source-tag">manual</span>' : '';

  return `
    <div class="row">
      <span class="label">Last run</span>
      <span class="value">${formatDate(state.lastRunAt)}${sourceLabel}</span>
    </div>
    <div class="row">
      <span class="label">Result</span>
      <span style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
        ${badge(resultInfo.label, resultInfo.color)}
        ${state.commentResult ? badge(COMMENT_LABELS[state.commentResult].label, COMMENT_LABELS[state.commentResult].color) : ''}
        ${state.flairResult ? flairBadge(state.flairResult) : ''}
      </span>
    </div>
    ${state.lastPostedTitle ? `
    <div class="row">
      <span class="label">Last posted</span>
      <span class="value">${state.lastPostedUrl ? `<a href="${esc(state.lastPostedUrl)}" target="_blank" rel="noopener">${esc(state.lastPostedTitle)}</a>` : esc(state.lastPostedTitle)}</span>
    </div>` : ''}
    ${state.lastError ? `
    <div class="row">
      <span class="label">Error</span>
      <span class="value error">${esc(state.lastError)}</span>
    </div>` : ''}`;
}

const chevronSvg = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 1.5L6 4.5L2.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function buildLogLines(logs: RunState['logs']): string {
  if (!logs?.length) return '';
  return logs
    .map((e) => {
      const time = e.ts.slice(11, 19);
      const lvLabel = e.level === 'warn' ? 'WARN' : e.level === 'error' ? 'ERR ' : 'log ';
      return `<div class="log-line"><span class="log-ts">${esc(time)}</span><span class="log-lv ${e.level}">${lvLabel}</span><span class="log-msg ${e.level}">${esc(e.msg)}</span></div>`;
    })
    .join('');
}

function buildHistoryRows(history: RunState[]): string {
  if (!history.length) return '<p class="empty">No history yet.</p>';

  return history
    .map((entry, i) => {
      const resultInfo = RESULT_LABELS[entry.lastRunResult] ?? { label: entry.lastRunResult, color: '#737373' };
      const commentInfo = entry.commentResult ? COMMENT_LABELS[entry.commentResult] : null;
      const sourceTag = entry.source === 'manual' ? ' <span class="source-tag">manual</span>' : '';
      const logCount = entry.logs?.length ?? 0;
      const viewerId = `log-viewer-${i}`;
      const toggleId = `log-toggle-${i}`;
      const logSection = logCount > 0 ? `
        <button class="log-toggle" id="${toggleId}" aria-expanded="false" onclick="toggleLog('${viewerId}','${toggleId}')">${chevronSvg} ${logCount} log line${logCount === 1 ? '' : 's'}</button>
        <div class="log-viewer" id="${viewerId}">${buildLogLines(entry.logs)}</div>` : '';
      return `
        <div class="history-entry">
          <div class="history-row">
            <span class="history-time">${formatDate(entry.lastRunAt)}${sourceTag}</span>
            <span style="display:flex;gap:.35rem;align-items:center;flex-shrink:0;flex-wrap:wrap">
              ${badge(resultInfo.label, resultInfo.color)}
              ${commentInfo ? badge(commentInfo.label, commentInfo.color) : ''}
              ${entry.flairResult ? flairBadge(entry.flairResult) : ''}
            </span>
          </div>${logSection}
        </div>`;
    })
    .join('');
}

export function buildDashboardHtml(
  history: RunState[],
  // Set collapsible: false to render right-column sections as plain cards
  { collapsible = true }: { collapsible?: boolean } = {},
): string {
  const state = history[0] ?? null;

  const statusRows = state ? buildLatestCard(state) : '<p class="empty">No runs recorded yet.</p>';
  const historyRows = buildHistoryRows(history);

  // Helpers for right-column cards — switch between <details> and <div> via the option above
  const rOpen = (open = true) =>
    collapsible ? '<details class="card"' + (open ? ' open' : '') + '>' : '<div class="card">';
  const rClose = () => (collapsible ? '</details>' : '</div>');
  const rHead = (h: string) => (collapsible ? '<summary>' + h + '</summary>' : h);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reddit Savage Bot Dashboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#0f0f0f;color:#e5e5e5;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:1.5rem}
    .dashboard{display:grid;grid-template-columns:1fr 1fr;gap:1rem;width:100%;max-width:1060px;align-items:start}
    .col{display:flex;flex-direction:column;gap:1rem;min-width:0}
    @media(max-width:680px){.dashboard{grid-template-columns:1fr}}
    .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:2rem;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.4)}
    h1{font-size:1.25rem;font-weight:600;color:#fff;margin-bottom:1.5rem}
    h1 span{color:#ff4500}
    h2{font-size:.9rem;font-weight:600;color:#a3a3a3;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1rem}
    details.card>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:1rem;user-select:none;padding-bottom:1.25rem;margin-bottom:0}
    details.card>summary::-webkit-details-marker{display:none}
    details.card>summary h1,details.card>summary h2{margin-bottom:0}
    details.card>summary::after{content:"▾";font-size:1.1rem;color:#525252;flex-shrink:0;transition:transform .2s}
    details.card[open]>summary::after{transform:rotate(-180deg)}
    details.card:not([open])>summary{padding-bottom:0}
    @keyframes detailsOpen{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes detailsClose{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-6px)}}
    details.card[open]:not(.closing)>*:not(summary){animation:detailsOpen .18s ease}
    details.card.closing>*:not(summary){animation:detailsClose .18s ease forwards;pointer-events:none}
    .row{display:flex;justify-content:space-between;align-items:center;padding:.75rem 0;border-bottom:1px solid #2a2a2a}
    .row:last-child{border-bottom:none}
    .label{font-size:.85rem;color:#a3a3a3;flex-shrink:0;margin-right:1rem}
    .value{font-size:.85rem;text-align:right;word-break:break-word}
    .value a,.post-link{color:#60a5fa;text-decoration:none}
    .value a:hover,.post-link:hover{text-decoration:underline}
    .badge{font-size:.75rem;font-weight:600;color:#fff;padding:.2rem .6rem;border-radius:999px;white-space:nowrap}
    .error{color:#f87171}
    .empty{color:#737373;font-size:.9rem;text-align:center;padding:1rem 0}
    .footer{margin-top:1.5rem;display:flex;justify-content:space-between;align-items:center;font-size:.75rem;color:#525252}
    .footer a{color:#525252}
    .refresh-btn{background:none;border:1px solid #3a3a3a;color:#a3a3a3;border-radius:6px;padding:.25rem .6rem;font-size:.75rem;cursor:pointer}
    .refresh-btn:hover{border-color:#525252;color:#e5e5e5}
    .post-item{padding:.6rem 0;border-bottom:1px solid #2a2a2a;display:flex;justify-content:space-between;align-items:baseline;gap:.75rem}
    .post-item:last-child{border-bottom:none}
    .post-title{font-size:.85rem;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .post-age{font-size:.75rem;color:#737373;flex-shrink:0}
    #posts-list .empty{padding:.5rem 0}
    .top-post-item{display:flex;gap:.85rem;padding:.7rem 0;border-bottom:1px solid #2a2a2a;align-items:flex-start}
    .top-post-item:last-child{border-bottom:none}
    .top-post-thumb{width:72px;height:54px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#2a2a2a}
    .top-post-thumb-placeholder{width:72px;height:54px;border-radius:6px;flex-shrink:0;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:1.2rem}
    .top-post-body{flex:1;min-width:0}
    .top-post-title{font-size:.83rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .top-post-meta{font-size:.73rem;color:#737373;margin-top:.25rem;display:flex;gap:.6rem}
    .score-chip{color:#ff6314}
    .tf-btn{background:none;border:1px solid #3a3a3a;color:#a3a3a3;border-radius:6px;padding:.2rem .55rem;font-size:.73rem;cursor:pointer}
    .tf-btn:hover{border-color:#525252;color:#e5e5e5}
    .tf-btn.active{border-color:#ff4500;color:#ff4500}
    #top-posts-list .empty{padding:.5rem 0}
    .run-btn{background:#ff4500;border:none;color:#fff;border-radius:8px;padding:.5rem 1.1rem;font-size:.85rem;font-weight:600;cursor:pointer;transition:background .15s}
    .run-btn:hover:not(:disabled){background:#e03d00}
    .run-btn:disabled{opacity:.5;cursor:not-allowed}
    .run-result{margin-top:.85rem;padding:.6rem .85rem;border-radius:8px;font-size:.82rem;background:#2a2a2a;word-break:break-word;display:none}
    .run-result.visible{display:block}
    .source-tag{display:inline-block;font-size:.65rem;font-weight:600;color:#a78bfa;background:#2e1065;border-radius:4px;padding:.1rem .35rem;margin-left:.35rem;vertical-align:middle}
    .history-entry{border-bottom:1px solid #2a2a2a}.history-entry:last-child{border-bottom:none}
    .history-row{display:flex;justify-content:space-between;align-items:center;padding:.55rem 0;gap:.75rem}
    .history-time{font-size:.8rem;color:#a3a3a3;min-width:0;flex:1}
    .log-toggle{display:inline-flex;align-items:center;gap:.3rem;background:none;border:none;color:#525252;font-size:.72rem;cursor:pointer;padding:.1rem 0 .45rem;line-height:1}
    .log-toggle:hover{color:#a3a3a3}.log-toggle svg{transition:transform .15s}
    .log-toggle[aria-expanded="true"] svg{transform:rotate(90deg)}
    .log-viewer{background:#111;border-radius:6px;padding:.5rem .75rem;font-family:ui-monospace,monospace;font-size:.7rem;max-height:260px;overflow-y:auto;margin-bottom:.45rem;display:none}
    .log-viewer.open{display:block}
    .log-line{display:flex;gap:.55rem;padding:.1rem 0;line-height:1.45}
    .log-ts{color:#404040;flex-shrink:0;user-select:none}.log-lv{flex-shrink:0;font-weight:600;width:2.5rem}
    .log-lv.warn{color:#ca8a04}.log-lv.error{color:#f87171}.log-lv.log{color:#525252}
    .log-msg{word-break:break-all;color:#a3a3a3}.log-msg.warn{color:#d97706}.log-msg.error{color:#fca5a5}
    .run-logs{margin-top:.6rem}
    .run-log-line{display:flex;gap:.5rem;font-family:ui-monospace,monospace;font-size:.72rem;padding:.1rem 0;line-height:1.45}
    .run-log-ts{color:#525252;flex-shrink:0}.run-log-lv{flex-shrink:0;font-weight:600;width:2.5rem}
    .run-log-lv.warn{color:#ca8a04}.run-log-lv.error{color:#f87171}.run-log-lv.log{color:#737373}
    .run-log-msg{word-break:break-all}.run-log-msg.warn{color:#d97706}.run-log-msg.error{color:#fca5a5}
  </style>
</head>
<body>
  <div class="dashboard">

    <div class="col">
      <div class="card">
        <h1><span>r/DHSavagery</span> Poster</h1>
        ${statusRows}
        <div class="footer">
          <a href="/api/status">JSON</a>
          <a href="/logout">Sign out</a>
        </div>
      </div>

      <div class="card">
        <h2>Run manually</h2>
        <p style="font-size:.82rem;color:#737373;margin-bottom:1rem">Runs the bot now with the same duplicate check as the scheduled job — will skip if today's Speakout is already posted.</p>
        <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
          <button class="run-btn" id="run-btn" onclick="triggerRun(false)">Run Now</button>
          <button class="run-btn" id="dry-btn" style="background:#6366f1" onclick="triggerRun(true)" title="Fetches the latest Speakout and checks if it would post, but does not actually post anything">Dry Run (no post)</button>
        </div>
        <div class="run-result" id="run-result"></div>
      </div>

  <div class="card">
    <h2>Test flair detection</h2>
    <p style="font-size:.82rem;color:#737373;margin-bottom:1rem">Runs GPT-4o-mini against today's cartoon and shows what it would detect — no post or flair is touched.</p>
    <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.75rem">
      <input id="flair-url" type="url" placeholder="Custom image URL (optional — uses today's by default)"
        style="flex:1;min-width:0;background:#111;border:1px solid #3a3a3a;color:#e5e5e5;border-radius:6px;padding:.4rem .6rem;font-size:.8rem;outline:none" />
      <button class="run-btn" id="flair-test-btn" style="background:#854d0e;flex-shrink:0" onclick="triggerTestFlair()">Detect</button>
    </div>
    <div class="run-result" id="flair-test-result"></div>
  </div>

  <div class="card">
    <h2>Fix missing comment</h2>
        <p style="font-size:.82rem;color:#737373;margin-bottom:1rem">Checks if the latest post already has a source comment from the bot, and adds one if not.</p>
        <button class="run-btn" id="comment-btn" style="background:#0ea5e9" onclick="triggerComment()">Add Source Comment</button>
        <div class="run-result" id="comment-result"></div>
      </div>
    </div>

    <div class="col">
      ${rOpen()}
        ${rHead('<h2>Run history</h2>')}
        <div id="history-list">${historyRows}</div>
      ${rClose()}

      ${rOpen()}
        ${rHead('<h2>Recent posts</h2>')}
        <div id="posts-list"><p class="empty">Loading…</p></div>
        <div class="footer">
          <span id="posts-updated"></span>
          <button class="refresh-btn" onclick="loadPosts()">Refresh</button>
        </div>
      ${rClose()}

      ${rOpen()}
        ${rHead('<h2>Top posts</h2>')}
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.85rem" id="tf-buttons">
          <button class="tf-btn" onclick="loadTopPosts('day')" data-tf="day">Today</button>
          <button class="tf-btn active" onclick="loadTopPosts('week')" data-tf="week">This week</button>
          <button class="tf-btn" onclick="loadTopPosts('month')" data-tf="month">Month</button>
          <button class="tf-btn" onclick="loadTopPosts('year')" data-tf="year">Year</button>
          <button class="tf-btn" onclick="loadTopPosts('all')" data-tf="all">All time</button>
        </div>
        <div id="top-posts-list"><p class="empty">Loading…</p></div>
        <div class="footer">
          <span id="top-posts-updated"></span>
          <button class="refresh-btn" onclick="loadTopPosts(currentTf)">Refresh</button>
        </div>
      ${rClose()}
    </div>

  </div>

  <script>
    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function toggleLog(viewerId, toggleId) {
      var viewer = document.getElementById(viewerId);
      var toggle = document.getElementById(toggleId);
      var isOpen = viewer.classList.contains('open');
      viewer.classList.toggle('open', !isOpen);
      toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    }

    function buildRunLogs(logs) {
      if (!logs || !logs.length) return '';
      var lines = logs.map(function(e) {
        var time = e.ts.slice(11, 19);
        var lvLabel = e.level === 'warn' ? 'WARN' : e.level === 'error' ? 'ERR ' : 'log ';
        return '<div class="run-log-line">' +
          '<span class="run-log-ts">' + escHtml(time) + '</span>' +
          '<span class="run-log-lv ' + e.level + '">' + lvLabel + '</span>' +
          '<span class="run-log-msg ' + e.level + '">' + escHtml(e.msg) + '</span>' +
          '</div>';
      }).join('');
      return '<div class="run-logs" style="border-top:1px solid #2a2a2a;margin-top:.6rem;padding-top:.5rem">' + lines + '</div>';
    }

    function timeAgo(utcSecs) {
      const diff = Math.floor(Date.now() / 1000) - utcSecs;
      if (diff < 60) return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    async function loadPosts() {
      const list = document.getElementById('posts-list');
      const updated = document.getElementById('posts-updated');
      console.log('[loadPosts] starting fetch /api/posts');
      list.innerHTML = '<p class="empty">Loading…</p>';
      updated.textContent = 'Fetching…';
      try {
        const res = await fetch('/api/posts');
        console.log('[loadPosts] response status:', res.status, res.ok);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const posts = await res.json();
        console.log('[loadPosts] received', posts.length, 'posts');
        if (!posts.length) {
          list.innerHTML = '<p class="empty">No posts found.</p>';
        } else {
          list.innerHTML = posts.map(p =>
            '<div class="post-item">' +
              '<span class="post-title"><a class="post-link" href="' + p.permalink + '" target="_blank" rel="noopener">' + p.title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</a></span>' +
              '<span class="post-age">' + timeAgo(p.createdUtc) + '</span>' +
            '</div>'
          ).join('');
        }
        updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
      } catch (e) {
        console.error('[loadPosts] error:', e);
        list.innerHTML = '<p class="empty error">Failed to load posts: ' + e.message + '</p>';
        updated.textContent = 'Error — see console';
      }
    }

    async function triggerRun(dryRun) {
      const btn = document.getElementById(dryRun ? 'dry-btn' : 'run-btn');
      const otherBtn = document.getElementById(dryRun ? 'run-btn' : 'dry-btn');
      const resultEl = document.getElementById('run-result');

      btn.disabled = true;
      otherBtn.disabled = true;
      btn.textContent = dryRun ? 'Running…' : 'Running…';
      resultEl.className = 'run-result';
      resultEl.textContent = '';

      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun }),
        });
        const data = await res.json();

        const RESULT_COLORS = { posted: '#16a34a', skipped: '#ca8a04', failed: '#dc2626', dry_run: '#6366f1' };
        const RESULT_LABELS = { posted: 'Posted', skipped: 'Skipped', failed: 'Failed', dry_run: 'Dry Run' };
        const color = RESULT_COLORS[data.lastRunResult] || '#737373';
        const label = RESULT_LABELS[data.lastRunResult] || data.lastRunResult;

        let summary = '<strong>' + escHtml(label) + '</strong>';
        if (data.lastPostedTitle) summary += ' — ' + escHtml(data.lastPostedTitle);
        if (data.lastError) summary += '<br><span style="color:#f87171">Error: ' + escHtml(data.lastError) + '</span>';
        if (data.commentResult === 'failed') summary += '<br><span style="color:#f87171">⚠ Comment failed to post</span>';

        resultEl.style.borderLeft = '3px solid ' + color;
        resultEl.style.color = color === '#dc2626' ? '#f87171' : '#e5e5e5';
        resultEl.innerHTML = summary + buildRunLogs(data.logs);
        resultEl.className = 'run-result visible';

        // reload page after a short delay so history + status refresh
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        resultEl.style.borderLeft = '3px solid #dc2626';
        resultEl.style.color = '#f87171';
        resultEl.textContent = 'Request failed: ' + e.message;
        resultEl.className = 'run-result visible';
      } finally {
        btn.disabled = false;
        otherBtn.disabled = false;
        btn.textContent = dryRun ? 'Dry Run' : 'Run Now';
      }
    }

    async function triggerTestFlair() {
      const btn = document.getElementById('flair-test-btn');
      const resultEl = document.getElementById('flair-test-result');
      const urlInput = document.getElementById('flair-url');
      btn.disabled = true;
      btn.textContent = 'Detecting…';
      resultEl.className = 'run-result';

      try {
        const body = {};
        const customUrl = urlInput.value.trim();
        if (customUrl) body.imageUrl = customUrl;

        const res = await fetch('/api/test-flair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Request failed');
        }

        const d = data.detection;
        let lines = [];
        if (data.speakoutTitle) lines.push('Image: ' + data.speakoutTitle);
        if (d.party) {
          lines.push('Person: ' + d.person);
          lines.push('Party: ' + d.party + ' (confidence: ' + d.confidence + ')');
          lines.push(data.matchedFlair
            ? 'Flair match: "' + data.matchedFlair.text + '" ✓'
            : 'No matching flair template found ✗');
        } else {
          lines.push('Could not identify: ' + d.reason);
        }

        const color = d.party ? '#16a34a' : '#ca8a04';
        resultEl.style.borderLeft = '3px solid ' + color;
        resultEl.style.color = '#e5e5e5';
        resultEl.style.whiteSpace = 'pre-line';
        resultEl.textContent = lines.join('\\n');
        resultEl.className = 'run-result visible';
      } catch (e) {
        resultEl.style.borderLeft = '3px solid #dc2626';
        resultEl.style.color = '#f87171';
        resultEl.textContent = 'Error: ' + e.message;
        resultEl.className = 'run-result visible';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Detect';
      }
    }

    async function triggerComment() {
      const btn = document.getElementById('comment-btn');
      const resultEl = document.getElementById('comment-result');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      resultEl.className = 'run-result';

      try {
        const res = await fetch('/api/comment', { method: 'POST' });
        const data = await res.json();
        const MESSAGES = {
          commented: { text: "Source comment posted successfully.", color: "#16a34a" },
          already_exists: { text: "Comment already exists — nothing to do.", color: "#ca8a04" },
          title_mismatch: { text: "Latest post doesn't match today's Speakout: " + (data.latestPostTitle || ""), color: "#ca8a04" },
          failed: { text: "Failed: " + (data.error || "unknown error"), color: "#dc2626" },
        };
        const info = MESSAGES[data.status] || { text: JSON.stringify(data), color: '#737373' };
        resultEl.style.borderLeft = '3px solid ' + info.color;
        resultEl.style.color = info.color === '#dc2626' ? '#f87171' : '#e5e5e5';
        resultEl.textContent = info.text;
        resultEl.className = 'run-result visible';
      } catch (e) {
        resultEl.style.borderLeft = '3px solid #dc2626';
        resultEl.style.color = '#f87171';
        resultEl.textContent = 'Request failed: ' + e.message;
        resultEl.className = 'run-result visible';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add Source Comment';
      }
    }

    let currentTf = 'week';

    async function loadTopPosts(tf) {
      currentTf = tf;
      document.querySelectorAll('#tf-buttons .tf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tf === tf);
      });
      const list = document.getElementById('top-posts-list');
      const updated = document.getElementById('top-posts-updated');
      console.log('[loadTopPosts] starting fetch /api/top-posts?t=' + tf);
      list.innerHTML = '<p class="empty">Loading…</p>';
      updated.textContent = 'Fetching…';
      try {
        const res = await fetch('/api/top-posts?t=' + tf);
        console.log('[loadTopPosts] response status:', res.status, res.ok);
        if (!res.ok) {
          const body = await res.text();
          console.error('[loadTopPosts] error body:', body);
          throw new Error('HTTP ' + res.status + ' — ' + body.slice(0, 120));
        }
        const posts = await res.json();
        console.log('[loadTopPosts] received', posts.length, 'posts, first:', posts[0]);
        if (!posts.length) {
          list.innerHTML = '<p class="empty">No posts found.</p>';
        } else {
          list.innerHTML = posts.map(p => {
            const safeTitle = p.title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            console.log('[loadTopPosts] post:', p.title, '| imageUrl:', p.imageUrl ?? '(none)');
            const thumb = p.imageUrl
              ? '<img class="top-post-thumb" src="' + p.imageUrl + '" alt="" loading="lazy" onerror="this.remove()">'
              : '<div class="top-post-thumb-placeholder">🖼</div>';
            const score = p.score != null ? '<span class="score-chip">▲ ' + (p.score >= 1000 ? (p.score / 1000).toFixed(1) + 'k' : p.score) + '</span>' : '';
            return '<div class="top-post-item">' +
              thumb +
              '<div class="top-post-body">' +
                '<a class="post-link top-post-title" href="' + p.permalink + '" target="_blank" rel="noopener">' + safeTitle + '</a>' +
                '<div class="top-post-meta">' + score + '<span>' + timeAgo(p.createdUtc) + '</span></div>' +
              '</div>' +
            '</div>';
          }).join('');
        }
        updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
      } catch (e) {
        console.error('[loadTopPosts] error:', e);
        list.innerHTML = '<p class="empty error">Failed to load: ' + e.message + '</p>';
        updated.textContent = 'Error — see console';
      }
    }

    // Intercept close clicks to run the slide-up animation before removing [open]
    document.querySelectorAll('details.card').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (!e.target.closest('summary')) return;
        if (!el.open) return;
        e.preventDefault();
        el.classList.add('closing');
        setTimeout(function() { el.classList.remove('closing'); el.removeAttribute('open'); }, 180);
      });
    });

    console.log('[dashboard] script loaded, kicking off loadPosts + loadTopPosts');
    loadPosts();
    loadTopPosts('week');
  </script>
</body>
</html>`;
}
