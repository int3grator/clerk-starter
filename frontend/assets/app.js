// SalesDesk CRM frontend
const CLERK_PUBLISHABLE_KEY = 'pk_test_cmVndWxhci1zdGFsbGlvbi05OC5jbGVyay5hY2NvdW50cy5kZXYk';
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:4000' : window.location.origin;

let clerk;
const state = {
    briefing: null,
    contacts: [],
    deals: [],
    meetings: [],
    activities: [],
};

const STAGE_LABELS = {
    new: 'New',
    qualified: 'Qualified',
    meeting: 'Meeting',
    proposal: 'Proposal',
    negotiation: 'Negotiation',
};
const VISIBLE_STAGES = ['new', 'qualified', 'meeting', 'proposal', 'negotiation'];

// ---------------------------------------------------------------------------
// API wrapper
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
    const token = await clerk.session.getToken();
    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `API error: ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
    try {
        if (!window.Clerk) throw new Error('Clerk nu s-a încărcat.');
        clerk = window.Clerk;
        await clerk.load();

        document.getElementById('loading').classList.add('hidden');

        if (clerk.user) {
            await showApp();
        } else {
            showSignedOut();
        }
        clerk.addListener(({ user }) => {
            if (user) showApp();
            else showSignedOut();
        });
    } catch (err) {
        document.getElementById('loading').textContent = 'Eroare: ' + err.message;
    }
}

function showSignedOut() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('signed-out').classList.remove('hidden');
    const mount = document.getElementById('clerk-sign-in');
    mount.innerHTML = '';
    clerk.mountSignIn(mount);
}

async function showApp() {
    document.getElementById('signed-out').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    const user = clerk.user;
    document.getElementById('user-name').textContent =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
    document.getElementById('user-email').textContent =
        user.primaryEmailAddress?.emailAddress || '';
    clerk.mountUserButton(document.getElementById('clerk-user-button'));

    await loadAll();
    switchView('dashboard');
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
    document.querySelectorAll('.nav-item').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === `view-${view}`);
    });
    if (view === 'dashboard') renderDashboard();
    if (view === 'pipeline') renderPipeline();
    if (view === 'contacts') renderContacts();
    if (view === 'meetings') renderMeetings();
    if (view === 'tasks') renderTasks();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadAll() {
    try {
        const [briefing, contacts, deals, meetings, activities] = await Promise.all([
            api('/crm/assistant/briefing'),
            api('/crm/contacts'),
            api('/crm/deals'),
            api('/crm/meetings'),
            api('/crm/activities'),
        ]);
        state.briefing = briefing;
        state.contacts = contacts.contacts || [];
        state.deals = deals.deals || [];
        state.meetings = meetings.meetings || [];
        state.activities = activities.activities || [];
        renderAll();
    } catch (err) {
        toast('Eroare la încărcare: ' + err.message, 'error');
    }
}

function renderAll() {
    renderDashboard();
    renderPipeline();
    renderContacts();
    renderMeetings();
    renderTasks();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function renderDashboard() {
    const b = state.briefing;
    if (!b) return;
    document.getElementById('dash-greeting').textContent = b.greeting;
    document.getElementById('dash-headline').textContent = b.headline;
    document.getElementById('stat-leads').textContent = b.stats.openLeads;
    document.getElementById('stat-deals').textContent = b.stats.activeDeals;
    document.getElementById('stat-pipeline').textContent = formatMoney(b.stats.pipelineValueCents, b.stats.currency);
    document.getElementById('stat-overdue').textContent = b.stats.overdueTasks;

    const pl = document.getElementById('priorities-list');
    if (!b.priorities.length) {
        pl.innerHTML = '<div class="empty">Asistentul nu are nimic urgent. Relaxare. 😎</div>';
    } else {
        pl.innerHTML = b.priorities.map(p => `
            <div class="priority-item">
                <div class="priority-icon ${p.kind}">${iconFor(p.kind)}</div>
                <div class="priority-body">
                    <div class="priority-title">${escape(p.title)}</div>
                    <div class="priority-reason">${escape(p.reason)}</div>
                    ${p.contactName || p.dealTitle ? `<div class="priority-meta">${[p.contactName, p.dealTitle].filter(Boolean).map(escape).join(' · ')}</div>` : ''}
                </div>
            </div>
        `).join('');
    }

    const tm = document.getElementById('today-meetings');
    if (!b.todayMeetings.length) {
        tm.innerHTML = '<div class="empty">Nicio întâlnire azi.</div>';
    } else {
        tm.innerHTML = b.todayMeetings.map(m => `
            <div class="meeting-item" data-meeting-id="${m.id}">
                <div class="meeting-header">
                    <span class="meeting-time">${formatTime(m.startsAt)}</span>
                    <button class="mini-btn" data-action="followup" data-id="${m.id}">Follow-up</button>
                </div>
                <div class="meeting-title">${escape(m.title)}</div>
                <div class="meeting-sub">${[m.contactName, m.location].filter(Boolean).map(escape).join(' · ') || '—'}</div>
            </div>
        `).join('');
    }

    const ot = document.getElementById('open-tasks');
    if (!b.openTasks.length) {
        ot.innerHTML = '<div class="empty">Fără task-uri deschise.</div>';
    } else {
        ot.innerHTML = b.openTasks.map(t => taskItemHtml(t)).join('');
    }
}

function iconFor(kind) {
    return {
        overdue_task: '!',
        today_task: '•',
        today_meeting: '☀',
        stale_contact: '↻',
        stalled_deal: '⏸',
        hot_deal: '★',
    }[kind] || '•';
}

function taskItemHtml(t) {
    const overdue = t.dueAt && new Date(t.dueAt) < new Date();
    const due = t.dueAt ? formatDateTime(t.dueAt) : 'Fără termen';
    return `
        <div class="task-item" data-task-id="${t.id}">
            <div class="task-check ${t.generatedByAssistant ? 'assistant' : ''}" data-action="complete-task" data-id="${t.id}"></div>
            <div class="task-body">
                <div class="task-title">${escape(t.title)}</div>
                <div class="task-meta">
                    <span class="${overdue ? 'overdue' : ''}">${due}</span>
                    ${t.contactName ? ' · ' + escape(t.contactName) : ''}
                    ${t.dealTitle ? ' · ' + escape(t.dealTitle) : ''}
                    ${t.generatedByAssistant ? ' · <span class="badge">auto</span>' : ''}
                </div>
            </div>
        </div>
    `;
}

document.getElementById('refresh-dash').addEventListener('click', loadAll);

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
function renderPipeline() {
    const root = document.getElementById('pipeline');
    const byStage = {};
    VISIBLE_STAGES.forEach(s => byStage[s] = []);
    state.deals.forEach(d => {
        if (VISIBLE_STAGES.includes(d.stage)) byStage[d.stage].push(d);
    });
    root.innerHTML = VISIBLE_STAGES.map(stage => `
        <div class="pipeline-col">
            <h3>${STAGE_LABELS[stage]} <span class="count">${byStage[stage].length}</span></h3>
            ${byStage[stage].map(d => dealCardHtml(d)).join('')}
        </div>
    `).join('');
}

function dealCardHtml(d) {
    const nextStage = nextStageOf(d.stage);
    return `
        <div class="deal-card" data-deal-id="${d.id}">
            <div class="deal-title">${escape(d.title)}</div>
            <div class="deal-value">${formatMoney(d.valueCents, d.currency)}</div>
            ${d.contactName ? `<div class="deal-contact">${escape(d.contactName)}</div>` : ''}
            <div class="deal-actions">
                ${nextStage ? `<button class="mini-btn" data-action="move-stage" data-id="${d.id}" data-stage="${nextStage}">→ ${STAGE_LABELS[nextStage] || nextStage}</button>` : ''}
                <button class="mini-btn" data-action="move-stage" data-id="${d.id}" data-stage="won">Won</button>
                <button class="mini-btn" data-action="move-stage" data-id="${d.id}" data-stage="lost">Lost</button>
            </div>
        </div>
    `;
}

function nextStageOf(stage) {
    const idx = VISIBLE_STAGES.indexOf(stage);
    if (idx === -1 || idx === VISIBLE_STAGES.length - 1) return null;
    return VISIBLE_STAGES[idx + 1];
}

document.getElementById('new-deal-btn').addEventListener('click', () => openDealForm());

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
function renderContacts() {
    const body = document.getElementById('contacts-body');
    if (!state.contacts.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty">Niciun contact. Adaugă primul lead.</td></tr>';
        return;
    }
    body.innerHTML = state.contacts.map(c => `
        <tr>
            <td>
                <strong>${escape(c.fullName)}</strong>
                ${c.jobTitle ? `<div class="muted" style="font-size:12px">${escape(c.jobTitle)}</div>` : ''}
            </td>
            <td>${escape(c.company || '—')}</td>
            <td><span class="status-pill ${c.status}">${c.status}</span></td>
            <td>${c.lastContactedAt ? formatDate(c.lastContactedAt) : '<span class="muted">nicicând</span>'}</td>
            <td>
                <button class="btn sm ghost" data-action="open-contact" data-id="${c.id}">Deschide</button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('new-contact-btn').addEventListener('click', () => openContactForm());

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
function renderMeetings() {
    const list = document.getElementById('meetings-list');
    const upcoming = state.meetings.filter(m => !m.completed);
    if (!upcoming.length) {
        list.innerHTML = '<div class="empty">Nicio întâlnire programată.</div>';
        return;
    }
    list.innerHTML = upcoming.map(m => `
        <div class="meeting-item">
            <div class="meeting-header">
                <span class="meeting-time">${formatDateTime(m.startsAt)}</span>
                <div style="display:flex; gap:4px;">
                    <button class="mini-btn" data-action="complete-meeting" data-id="${m.id}">Marchează ca avut</button>
                    <button class="mini-btn" data-action="followup" data-id="${m.id}">Draft follow-up</button>
                </div>
            </div>
            <div class="meeting-title">${escape(m.title)}</div>
            <div class="meeting-sub">${[m.contactName, m.location].filter(Boolean).map(escape).join(' · ') || '—'}</div>
            ${m.agenda ? `<div class="muted" style="font-size:12px; margin-top:4px;">${escape(m.agenda)}</div>` : ''}
        </div>
    `).join('');
}

document.getElementById('new-meeting-btn').addEventListener('click', () => openMeetingForm());

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
function renderTasks() {
    const root = document.getElementById('tasks-full');
    if (!state.activities.length) {
        root.innerHTML = '<div class="empty">Fără task-uri. Asistentul va popula asta în curând.</div>';
        return;
    }
    root.innerHTML = state.activities.map(taskItemHtml).join('');
}

document.getElementById('new-task-btn').addEventListener('click', () => openTaskForm());

// ---------------------------------------------------------------------------
// Action dispatcher (event delegation)
// ---------------------------------------------------------------------------
document.body.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    try {
        if (action === 'complete-task') {
            await api(`/crm/activities/${id}/complete`, { method: 'POST', body: '{}' });
            toast('Task marcat ca făcut', 'success');
            await loadAll();
        } else if (action === 'move-stage') {
            const stage = target.dataset.stage;
            await api(`/crm/deals/${id}/stage`, { method: 'POST', body: JSON.stringify({ stage }) });
            toast(`Deal mutat la ${stage}`, 'success');
            await loadAll();
        } else if (action === 'complete-meeting') {
            const summary = prompt('Rezumat scurt al întâlnirii (opțional):') || undefined;
            await api(`/crm/meetings/${id}/complete`, {
                method: 'POST',
                body: JSON.stringify({ summary }),
            });
            toast('Întâlnire marcată', 'success');
            await loadAll();
        } else if (action === 'followup') {
            await showFollowUpDraft(id);
        } else if (action === 'open-contact') {
            await openContactDetail(id);
        }
    } catch (err) {
        toast(err.message, 'error');
    }
});

// ---------------------------------------------------------------------------
// Forms & modals
// ---------------------------------------------------------------------------
function openModal(title, body) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-backdrop').classList.remove('hidden');
}
function closeModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
}
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop' || e.target.closest('[data-close]')) closeModal();
});

function openContactForm() {
    openModal('Contact nou', `
        <form id="contact-form">
            <div class="form-group"><label>Nume complet</label><input required name="fullName" /></div>
            <div class="form-row">
                <div class="form-group"><label>Companie</label><input name="company" /></div>
                <div class="form-group"><label>Funcție</label><input name="jobTitle" /></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Email</label><input type="email" name="email" /></div>
                <div class="form-group"><label>Telefon</label><input name="phone" /></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Sursă</label><input name="source" placeholder="LinkedIn, referral..." /></div>
                <div class="form-group"><label>Status</label>
                    <select name="status">
                        <option value="lead">Lead</option>
                        <option value="qualified">Qualified</option>
                        <option value="customer">Customer</option>
                        <option value="churned">Churned</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Notițe</label><textarea name="notes" rows="3"></textarea></div>
            <div class="form-actions">
                <button type="button" class="btn ghost" data-close>Anulează</button>
                <button class="btn primary">Salvează</button>
            </div>
        </form>
    `);
    document.getElementById('contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        try {
            await api('/crm/contacts', { method: 'POST', body: JSON.stringify(data) });
            closeModal();
            toast('Contact adăugat', 'success');
            await loadAll();
        } catch (err) { toast(err.message, 'error'); }
    });
}

function openDealForm() {
    const contactOptions = state.contacts.map(c =>
        `<option value="${c.id}">${escape(c.fullName)}${c.company ? ' · ' + escape(c.company) : ''}</option>`
    ).join('');
    openModal('Deal nou', `
        <form id="deal-form">
            <div class="form-group"><label>Titlu</label><input required name="title" /></div>
            <div class="form-group"><label>Contact</label>
                <select name="contactId"><option value="">— fără —</option>${contactOptions}</select>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Valoare (€)</label><input type="number" name="value" min="0" step="100" /></div>
                <div class="form-group"><label>Stage</label>
                    <select name="stage">
                        ${VISIBLE_STAGES.map(s => `<option value="${s}">${STAGE_LABELS[s]}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Dată estimată închidere</label><input type="date" name="expectedCloseDate" /></div>
            <div class="form-group"><label>Notițe</label><textarea name="notes" rows="3"></textarea></div>
            <div class="form-actions">
                <button type="button" class="btn ghost" data-close>Anulează</button>
                <button class="btn primary">Salvează</button>
            </div>
        </form>
    `);
    document.getElementById('deal-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {
            title: fd.get('title'),
            contactId: fd.get('contactId') ? Number(fd.get('contactId')) : undefined,
            valueCents: fd.get('value') ? Math.round(Number(fd.get('value')) * 100) : 0,
            stage: fd.get('stage'),
            expectedCloseDate: fd.get('expectedCloseDate') || undefined,
            notes: fd.get('notes') || undefined,
        };
        try {
            await api('/crm/deals', { method: 'POST', body: JSON.stringify(body) });
            closeModal();
            toast('Deal adăugat', 'success');
            await loadAll();
        } catch (err) { toast(err.message, 'error'); }
    });
}

function openMeetingForm() {
    const contactOptions = state.contacts.map(c =>
        `<option value="${c.id}">${escape(c.fullName)}</option>`
    ).join('');
    const dealOptions = state.deals.map(d =>
        `<option value="${d.id}">${escape(d.title)}</option>`
    ).join('');
    openModal('Întâlnire nouă', `
        <form id="meeting-form">
            <div class="form-group"><label>Titlu</label><input required name="title" placeholder="Discovery cu Acme" /></div>
            <div class="form-row">
                <div class="form-group"><label>Contact</label>
                    <select name="contactId"><option value="">— fără —</option>${contactOptions}</select>
                </div>
                <div class="form-group"><label>Deal</label>
                    <select name="dealId"><option value="">— fără —</option>${dealOptions}</select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Începe la</label><input required type="datetime-local" name="startsAt" /></div>
                <div class="form-group"><label>Locație</label><input name="location" placeholder="Online / adresă" /></div>
            </div>
            <div class="form-group"><label>Agendă</label><textarea name="agenda" rows="3"></textarea></div>
            <div class="form-actions">
                <button type="button" class="btn ghost" data-close>Anulează</button>
                <button class="btn primary">Salvează</button>
            </div>
        </form>
    `);
    document.getElementById('meeting-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {
            title: fd.get('title'),
            contactId: fd.get('contactId') ? Number(fd.get('contactId')) : undefined,
            dealId: fd.get('dealId') ? Number(fd.get('dealId')) : undefined,
            startsAt: new Date(fd.get('startsAt')).toISOString(),
            location: fd.get('location') || undefined,
            agenda: fd.get('agenda') || undefined,
        };
        try {
            await api('/crm/meetings', { method: 'POST', body: JSON.stringify(body) });
            closeModal();
            toast('Întâlnire programată', 'success');
            await loadAll();
        } catch (err) { toast(err.message, 'error'); }
    });
}

function openTaskForm() {
    const contactOptions = state.contacts.map(c =>
        `<option value="${c.id}">${escape(c.fullName)}</option>`
    ).join('');
    openModal('Task nou', `
        <form id="task-form">
            <div class="form-group"><label>Titlu</label><input required name="title" /></div>
            <div class="form-row">
                <div class="form-group"><label>Tip</label>
                    <select name="type">
                        <option value="call">Call</option>
                        <option value="email">Email</option>
                        <option value="meeting">Meeting</option>
                        <option value="follow_up">Follow-up</option>
                        <option value="task">Task</option>
                    </select>
                </div>
                <div class="form-group"><label>Contact</label>
                    <select name="contactId"><option value="">— fără —</option>${contactOptions}</select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Scadent</label><input type="datetime-local" name="dueAt" /></div>
                <div class="form-group"><label>Prioritate</label>
                    <select name="priority">
                        <option value="1">Înaltă</option>
                        <option value="2" selected>Medie</option>
                        <option value="3">Joasă</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Descriere</label><textarea name="description" rows="3"></textarea></div>
            <div class="form-actions">
                <button type="button" class="btn ghost" data-close>Anulează</button>
                <button class="btn primary">Salvează</button>
            </div>
        </form>
    `);
    document.getElementById('task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {
            title: fd.get('title'),
            type: fd.get('type'),
            contactId: fd.get('contactId') ? Number(fd.get('contactId')) : undefined,
            dueAt: fd.get('dueAt') ? new Date(fd.get('dueAt')).toISOString() : undefined,
            priority: Number(fd.get('priority')),
            description: fd.get('description') || undefined,
        };
        try {
            await api('/crm/activities', { method: 'POST', body: JSON.stringify(body) });
            closeModal();
            toast('Task adăugat', 'success');
            await loadAll();
        } catch (err) { toast(err.message, 'error'); }
    });
}

async function openContactDetail(id) {
    const contact = state.contacts.find(c => c.id == id);
    if (!contact) return;
    openModal(contact.fullName, `<div class="empty">Asistentul pregătește sugestii...</div>`);
    try {
        const resp = await api(`/crm/assistant/contact/${id}/suggest`);
        const body = document.getElementById('modal-body');
        const deal = state.deals.find(d => d.contactId == id);
        body.innerHTML = `
            <div class="detail-section">
                <h4>Detalii</h4>
                <div>${escape(contact.company || '—')}${contact.jobTitle ? ' · ' + escape(contact.jobTitle) : ''}</div>
                <div class="muted" style="font-size:12px">
                    ${contact.email ? escape(contact.email) : ''}
                    ${contact.phone ? ' · ' + escape(contact.phone) : ''}
                </div>
                <div style="margin-top:8px;"><span class="status-pill ${contact.status}">${contact.status}</span></div>
            </div>
            ${deal ? `<div class="detail-section">
                <h4>Deal activ</h4>
                <div><strong>${escape(deal.title)}</strong> — ${formatMoney(deal.valueCents, deal.currency)} · ${deal.stage}</div>
            </div>` : ''}
            <div class="detail-section">
                <h4>Sugestii de la asistent</h4>
                ${resp.suggestions.length ? resp.suggestions.map(s => `
                    <div class="suggestion-item">
                        <div class="suggestion-title">${escape(s.title)}</div>
                        <div class="suggestion-desc">${escape(s.description)}</div>
                        <button class="btn sm primary" data-suggest-add
                            data-type="${s.type}"
                            data-title="${escapeAttr(s.title)}"
                            data-description="${escapeAttr(s.description)}"
                            data-due-days="${s.dueInDays}"
                            data-contact-id="${contact.id}">
                            + Adaugă ca task
                        </button>
                    </div>
                `).join('') : '<div class="empty">Nicio sugestie acum.</div>'}
            </div>
        `;
        body.querySelectorAll('[data-suggest-add]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const due = new Date();
                due.setDate(due.getDate() + Number(btn.dataset.dueDays || 0));
                try {
                    await api('/crm/activities', {
                        method: 'POST',
                        body: JSON.stringify({
                            type: btn.dataset.type,
                            title: btn.dataset.title,
                            description: btn.dataset.description,
                            contactId: Number(btn.dataset.contactId),
                            dueAt: due.toISOString(),
                            priority: 2,
                        }),
                    });
                    toast('Task adăugat', 'success');
                    await loadAll();
                } catch (err) { toast(err.message, 'error'); }
            });
        });
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function showFollowUpDraft(meetingId) {
    openModal('Draft follow-up', '<div class="empty">Asistentul scrie...</div>');
    try {
        const resp = await api(`/crm/assistant/meeting/${meetingId}/followup`);
        document.getElementById('modal-body').innerHTML = `
            <div class="form-group"><label>Subiect</label>
                <input id="fu-subject" value="${escapeAttr(resp.subject)}" />
            </div>
            <div class="form-group"><label>Corp email</label>
                <textarea id="fu-body" rows="12">${escape(resp.body)}</textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn ghost" data-close>Închide</button>
                <button type="button" class="btn primary" id="fu-copy">Copiază în clipboard</button>
            </div>
        `;
        document.getElementById('fu-copy').addEventListener('click', async () => {
            const text = `Subject: ${document.getElementById('fu-subject').value}\n\n${document.getElementById('fu-body').value}`;
            try {
                await navigator.clipboard.writeText(text);
                toast('Copiat', 'success');
            } catch {
                toast('Nu am putut copia', 'error');
            }
        });
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escape(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escape(s).replace(/'/g, '&#39;'); }

function formatMoney(cents, currency) {
    const v = (cents || 0) / 100;
    try {
        return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(v);
    } catch {
        return `${v.toFixed(0)} ${currency || ''}`;
    }
}
function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(iso) {
    return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(iso) {
    return new Date(iso).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
function toast(message, type = '') {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.className = 'toast ' + type;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

window.addEventListener('load', () => setTimeout(init, 50));
