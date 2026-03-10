/**
 * Client-side vanilla JS for the debug dashboard panels.
 * Each function returns a string of JavaScript code.
 * Concatenated and injected into a <script> tag.
 */

function utilScript(): string {
  return `
    const API = window.location.href.split('?')[0] + window.location.search;
    async function api(action, params = {}) {
      const url = new URL(API);
      url.searchParams.set('action', action);
      for (const [k,v] of Object.entries(params)) url.searchParams.set(k, String(v));
      const r = await fetch(url);
      return r.json();
    }
    async function apiPost(action, body = {}) {
      const url = new URL(API);
      url.searchParams.set('action', action);
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      return r.json();
    }
    function togglePanel(id) {
      document.getElementById('panel-'+id).classList.toggle('collapsed');
    }
    function el(id) { return document.getElementById(id); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  `;
}

function memoryScript(): string {
  return `
    let memoryKeys = [];
    async function loadMemoryKeys() {
      const r = await api('list_keys');
      if (!r.success) { el('memory-content').innerHTML = r.error; return; }
      memoryKeys = r.data;
      const items = memoryKeys.map(k => '<li onclick="loadMemoryDoc(\\'' + esc(k) + '\\')">' + esc(k) + '</li>');
      el('memory-content').innerHTML = '<ul class="key-list">' + items.join('') + '</ul>' +
        '<div id="memory-doc"></div>';
    }
    async function loadMemoryDoc(key) {
      const r = await api('read_key', { key });
      const content = r.success ? r.data : r.error;
      el('memory-doc').innerHTML =
        '<h3>' + esc(key) + '</h3>' +
        '<pre id="memory-view">' + esc(content) + '</pre>' +
        '<button onclick="editMemory(\\'' + esc(key) + '\\')">Edit</button>' +
        '<button class="danger" onclick="deleteMemory(\\'' + esc(key) + '\\')">Delete</button>';
    }
    function editMemory(key) {
      const current = el('memory-view').textContent;
      el('memory-doc').innerHTML =
        '<h3>Editing: ' + esc(key) + '</h3>' +
        '<textarea id="memory-edit">' + esc(current) + '</textarea>' +
        '<button onclick="saveMemory(\\'' + esc(key) + '\\')">Save</button>' +
        '<button onclick="loadMemoryDoc(\\'' + esc(key) + '\\')">Cancel</button>';
    }
    async function saveMemory(key) {
      const content = el('memory-edit').value;
      const r = await apiPost('write_key', { key, content });
      el('memory-doc').innerHTML = '<div class="status">' + (r.success ? 'Saved!' : r.error) + '</div>';
      setTimeout(() => loadMemoryDoc(key), 800);
    }
    async function deleteMemory(key) {
      if (!confirm('Delete ' + key + '?')) return;
      await apiPost('delete_key', { key });
      loadMemoryKeys();
    }
  `;
}

function conversationScript(): string {
  return `
    let members = [];
    async function loadMembers() {
      const r = await api('list_members');
      if (!r.success) { el('conversation-content').innerHTML = r.error; return; }
      members = r.data;
      const opts = members.map(m => '<option value="' + m.chatId + '">' + esc(m.name) + '</option>');
      el('conversation-content').innerHTML =
        '<div class="filter-row"><select id="member-select" onchange="loadConversation()">' +
        '<option value="">Select member...</option>' + opts.join('') +
        '</select><button class="danger" onclick="clearConversation()">Clear History</button></div>' +
        '<div id="convo-body"></div>';
    }
    async function loadConversation() {
      const chatId = el('member-select').value;
      if (!chatId) { el('convo-body').innerHTML = ''; return; }
      const r = await api('get_history', { chatId });
      if (!r.success) { el('convo-body').innerHTML = r.error; return; }
      const msgs = r.data.map(m => {
        const cls = m.role === 'user' ? 'msg-user' : 'msg-assistant';
        const ts = m.timestamp ? '<span class="meta">' + m.timestamp + '</span> ' : '';
        return '<div class="' + cls + '">' + ts + '<b>' + m.role + ':</b> ' + esc(m.content) + '</div>';
      });
      el('convo-body').innerHTML = msgs.join('') || '<span class="meta">No history</span>';
    }
    async function clearConversation() {
      const chatId = el('member-select').value;
      if (!chatId || !confirm('Clear conversation history?')) return;
      await apiPost('clear_history', { chatId: Number(chatId) });
      loadConversation();
    }
  `;
}

function auditScript(): string {
  return `
    let auditOffset = 0;
    const AUDIT_LIMIT = 25;
    async function loadAudit() {
      const filter = el('audit-filter') ? el('audit-filter').value : '';
      const r = await api('get_audit', { offset: auditOffset, limit: AUDIT_LIMIT, filter });
      if (!r.success) { el('audit-content').innerHTML = r.error; return; }
      const { entries, total } = r.data;
      const rows = entries.map(e =>
        '<div class="entry"><span class="meta">' + esc(e.timestamp) + '</span> | ' +
        esc(e.memberId) + ' | ' + esc(e.action) + ' | ' + esc(e.detail || '') + '</div>'
      );
      const nav = auditNav(total);
      el('audit-content').innerHTML =
        '<div class="filter-row"><input id="audit-filter" placeholder="Filter by member/action" value="' +
        esc(filter) + '" onkeyup="auditOffset=0;loadAudit()"><button onclick="archiveAudit()">Archive >30d</button></div>' +
        rows.join('') + nav;
    }
    function auditNav(total) {
      const prev = auditOffset > 0 ? '<button onclick="auditOffset-=' + AUDIT_LIMIT + ';loadAudit()">Prev</button>' : '';
      const next = auditOffset + AUDIT_LIMIT < total ? '<button onclick="auditOffset+=' + AUDIT_LIMIT + ';loadAudit()">Next</button>' : '';
      return '<div class="pagination">' + prev + ' ' + next + ' <span class="meta">' + total + ' total</span></div>';
    }
    async function archiveAudit() {
      if (!confirm('Archive audit entries older than 30 days?')) return;
      const r = await apiPost('archive_audit');
      alert(r.success ? r.data : r.error);
      loadAudit();
    }
  `;
}

function incomingScript(): string {
  return `
    let incomingOffset = 0;
    const INCOMING_LIMIT = 25;
    async function loadIncoming() {
      const r = await api('get_incoming', { offset: incomingOffset, limit: INCOMING_LIMIT });
      if (!r.success) { el('incoming-content').innerHTML = r.error; return; }
      const { entries, total } = r.data;
      const rows = entries.map(e => {
        const preview = (e.text || '').substring(0, 80);
        return '<div class="entry" onclick="this.classList.toggle(\\'expanded\\')">' +
          '<div class="entry-header"><span class="meta">' + esc(e.timestamp) + '</span> ' +
          esc(e.memberId) + ' [' + esc(e.messageType) + '] ' + esc(preview) + '</div>' +
          '<div class="entry-body">' + esc(e.text || '') + '</div></div>';
      });
      const nav = incomingNav(total);
      el('incoming-content').innerHTML =
        '<button onclick="trimIncoming()">Trim to 500</button>' +
        rows.join('') + nav;
    }
    function incomingNav(total) {
      const prev = incomingOffset > 0 ? '<button onclick="incomingOffset-=' + INCOMING_LIMIT + ';loadIncoming()">Prev</button>' : '';
      const next = incomingOffset + INCOMING_LIMIT < total ? '<button onclick="incomingOffset+=' + INCOMING_LIMIT + ';loadIncoming()">Next</button>' : '';
      return '<div class="pagination">' + prev + ' ' + next + ' <span class="meta">' + total + ' total</span></div>';
    }
    async function trimIncoming() {
      if (!confirm('Trim to 500 most recent entries?')) return;
      const r = await apiPost('trim_incoming');
      alert(r.success ? r.data : r.error);
      loadIncoming();
    }
  `;
}

function initScript(): string {
  return `
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.panel').forEach(p => p.classList.add('collapsed'));
      document.querySelector('.panel').classList.remove('collapsed');
      loadMemoryKeys();
      loadMembers();
      loadAudit();
      loadIncoming();
    });
  `;
}

export function panelScript(): string {
  return [
    utilScript(),
    memoryScript(),
    conversationScript(),
    auditScript(),
    incomingScript(),
    initScript(),
  ].join("\n");
}
