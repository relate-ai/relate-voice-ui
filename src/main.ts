import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';

// ── API Client ──
const API = {
  async get<T>(path: string): Promise<T> {
    const r = await fetch(path, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `${r.status}`); }
    return r.json();
  },
  async patch<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(path, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `${r.status}`); }
    return r.json();
  },
  async del<T>(path: string): Promise<T> {
    const r = await fetch(path, { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
};

// ── Types ──
interface AgentSummary { agent_id: string; name: string; version: string; state: string; description: string; llm_provider: string; llm_model: string; updated_at: string; }
interface AgentDetail extends AgentSummary { personality: string; greeting: string; llm: { provider: string; model: string; temperature: number; max_tokens: number; timeout_seconds: number }; speech: Record<string, string>; turn_handling: Record<string, unknown>; tools: unknown[]; appearance: Record<string, string>; }
interface Provider { id: string; name: string; description: string; models: { id: string; name: string; free: boolean }[]; unavailable_reason?: string; }
interface Diagnostics { agent_id: string | null; agent_version: string | null; llm_provider: string | null; llm_model: string | null; stt_provider: string | null; tts_provider: string | null; tts_voice: string | null; theme: string | null; enabled_tools: string[]; build_version: string; }

// ── State ──
let room: Room | null = null;
let userWasSpeaking = false;
let currentAgentId: string | null = null;
let providers: Provider[] = [];
let allAgents: AgentSummary[] = [];

// ── DOM ──
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const orb = $('#orb');
const voiceState = $('#voice-state');
const voiceDetail = $('#voice-detail');
const voiceError = $('#voice-error');
const voiceMeta = $('#voice-meta');
const btnStart = $('#btn-start');
const btnEnd = $('#btn-end');

// ── Tabs ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#panel-${(tab as HTMLElement).dataset.tab}`).classList.add('active');
    if ((tab as HTMLElement).dataset.tab === 'diagnostics') loadDiagnostics();
    if ((tab as HTMLElement).dataset.tab === 'agent') loadAgents();
  });
});

// ── Toast ──
function toast(msg: string, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Voice ──
function setState(s: string) {
  voiceState.textContent = s[0].toUpperCase() + s.slice(1);
  orb.dataset.state = s === 'ready' ? 'idle' : s;
  const details: Record<string, string> = {
    ready: 'Click Start to begin a hands-free conversation.',
    connecting: 'Creating a secure room and connecting your microphone.',
    listening: 'Speak naturally. Pause when done.',
    thinking: 'Preparing a response...',
    speaking: 'You can interrupt by speaking.',
    error: 'Conversation could not continue.',
  };
  voiceDetail.textContent = details[s] || '';
}

async function startConversation() {
  btnStart.disabled = true;
  voiceError.textContent = '';
  setState('connecting');
  try {
    room = new Room({ adaptiveStream: true, dynacast: true });
    await room.startAudio();
    room.on(RoomEvent.ConnectionStateChanged, s => { if (s === ConnectionState.Reconnecting) setState('connecting'); });
    room.on(RoomEvent.TrackSubscribed, t => { if (t.kind === Track.Kind.Audio) { const el = t.attach(); el.autoplay = true; $('#audio').append(el); } });
    room.on(RoomEvent.TrackUnsubscribed, t => t.detach().forEach(n => n.remove()));
    room.on(RoomEvent.ActiveSpeakersChanged, speakers => {
      const local = speakers.some(p => p.identity === room?.localParticipant.identity);
      const remote = speakers.some(p => p.identity !== room?.localParticipant.identity);
      if (local) { userWasSpeaking = true; setState('listening'); }
      else if (remote) { userWasSpeaking = false; setState('speaking'); }
      else if (userWasSpeaking) { userWasSpeaking = false; setState('thinking'); }
    });
    const session = await API.post<{ server_url: string; token: string; room_name: string; agent_id?: string; agent_version?: string }>('/api/session', {});
    await room.connect(session.server_url, session.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    btnEnd.disabled = false;
    setState('listening');
    if (session.agent_id) {
      voiceMeta.innerHTML = `<span>Agent: ${session.agent_id} v${session.agent_version || '?'}</span>`;
    }
  } catch (err: any) {
    await room?.disconnect(true); room = null;
    btnStart.disabled = false; btnEnd.disabled = true;
    voiceError.textContent = err.message || 'Connection failed';
    setState('error');
  }
}

async function endConversation() {
  await room?.disconnect(true); room = null;
  $('#audio').replaceChildren();
  btnStart.disabled = false; btnEnd.disabled = true;
  voiceError.textContent = ''; voiceMeta.innerHTML = '';
  setState('ready');
}

btnStart.addEventListener('click', startConversation);
btnEnd.addEventListener('click', endConversation);
window.addEventListener('beforeunload', () => room?.disconnect(true));

// ── Agent Management ──
async function loadAgents() {
  try {
    allAgents = await API.get<AgentSummary[]>('/api/agents');
    renderAgentList();
    populateAgentSelects();
  } catch (e: any) { toast(e.message, 'error'); }
}

function renderAgentList() {
  const list = $('#agent-list');
  if (!allAgents.length) { list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No agents yet. Create one to get started.</p>'; return; }
  list.innerHTML = allAgents.map(a => `
    <div class="agent-row ${a.agent_id === currentAgentId ? 'active' : ''}" data-id="${a.agent_id}">
      <div class="agent-info">
        <div class="agent-name">${esc(a.name)} <span class="badge badge-${a.state}">${a.state}</span></div>
        <div class="agent-meta">${esc(a.agent_id)} · v${a.version} · ${a.llm_provider}/${a.llm_model}</div>
      </div>
      <div class="agent-actions">
        <button class="btn btn-sm" onclick="editAgent('${a.agent_id}')">Edit</button>
      </div>
    </div>
  `).join('');
}

function populateAgentSelects() {
  const selects = ['personality-agent-select', 'model-agent-select', 'speech-agent-select', 'tools-agent-select', 'appearance-agent-select'];
  selects.forEach(id => {
    const el = $(`#${id}`) as HTMLSelectElement;
    if (!el) return;
    el.innerHTML = allAgents.map(a => `<option value="${a.agent_id}" ${a.agent_id === currentAgentId ? 'selected' : ''}>${esc(a.name)} (${a.state})</option>`).join('');
    el.addEventListener('change', () => loadAgentForEditing(el.value));
  });
}

(window as any).editAgent = async function(agentId: string) {
  currentAgentId = agentId;
  try {
    const agent = await API.get<AgentDetail>(`/api/agents/${agentId}`);
    $('#agent-editor').style.display = 'block';
    $('#editor-title').textContent = `Edit: ${agent.name}`;
    ($('#edit-agent-id') as HTMLInputElement).value = agent.agent_id;
    ($('#edit-id') as HTMLInputElement).value = agent.agent_id;
    ($('#edit-name') as HTMLInputElement).value = agent.name;
    ($('#edit-description') as HTMLInputElement).value = agent.description;
    // Personality
    ($('#personality-prompt') as HTMLTextAreaElement).value = agent.personality;
    ($('#personality-greeting') as HTMLInputElement).value = agent.greeting;
    // Model
    ($('#model-provider') as HTMLSelectElement).value = agent.llm?.provider || 'openrouter';
    loadModelOptions(agent.llm?.provider || 'openrouter', agent.llm?.model);
    ($('#model-temperature') as HTMLInputElement).value = String(agent.llm?.temperature ?? 0.4);
    ($('#model-max-tokens') as HTMLInputElement).value = String(agent.llm?.max_tokens ?? 300);
    // Speech
    ($('#speech-stt-model') as HTMLInputElement).value = agent.speech?.stt_model || 'nova-3';
    ($('#speech-stt-language') as HTMLInputElement).value = agent.speech?.stt_language || 'en-US';
    ($('#speech-tts-voice') as HTMLInputElement).value = agent.speech?.tts_voice || 'asteria';
    ($('#speech-tts-language') as HTMLInputElement).value = agent.speech?.tts_language || 'en';
    // Appearance
    const theme = agent.appearance?.theme || 'relate-prism';
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('selected', (c as HTMLElement).dataset.theme === theme));
    renderAgentList();
    populateAgentSelects();
  } catch (e: any) { toast(e.message, 'error'); }
};

async function loadAgentForEditing(agentId: string) {
  (window as any).editAgent(agentId);
}

$('#btn-create-agent').addEventListener('click', async () => {
  const id = prompt('Agent ID (lowercase, numbers, dashes):');
  if (!id) return;
  const name = prompt('Agent Name:') || id;
  try {
    await API.post('/api/agents', { agent_id: id, name });
    toast('Agent created');
    await loadAgents();
    (window as any).editAgent(id);
  } catch (e: any) { toast(e.message, 'error'); }
});

$('#btn-save-draft').addEventListener('click', async () => {
  const id = ($('#edit-agent-id') as HTMLInputElement).value;
  if (!id) return;
  try {
    await API.patch(`/api/agents/${id}`, {
      name: ($('#edit-name') as HTMLInputElement).value,
      description: ($('#edit-description') as HTMLInputElement).value,
    });
    toast('Agent saved');
    await loadAgents();
  } catch (e: any) { toast(e.message, 'error'); }
});

$('#btn-activate-agent').addEventListener('click', async () => {
  const id = ($('#edit-agent-id') as HTMLInputElement).value;
  if (!id) return;
  try {
    await API.post('/api/agents/activate', { agent_id: id });
    toast('Agent activated');
    await loadAgents();
    updateActiveBadge();
  } catch (e: any) { toast(e.message, 'error'); }
});

$('#btn-delete-agent').addEventListener('click', async () => {
  const id = ($('#edit-agent-id') as HTMLInputElement).value;
  if (!id || !confirm('Delete this agent?')) return;
  try {
    await API.del(`/api/agents/${id}`);
    toast('Agent deleted');
    $('#agent-editor').style.display = 'none';
    currentAgentId = null;
    await loadAgents();
  } catch (e: any) { toast(e.message, 'error'); }
});

$('#btn-export-agent').addEventListener('click', async () => {
  const id = ($('#edit-agent-id') as HTMLInputElement).value;
  if (!id) return;
  try {
    const r = await fetch(`/api/agents/${id}/export`, { credentials: 'same-origin' });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${id}.relate-agent.zip`; a.click();
    URL.revokeObjectURL(url);
    toast('Agent exported');
  } catch (e: any) { toast(e.message, 'error'); }
});

// Import
$('#btn-import-agent').addEventListener('click', () => $('#import-file-input').click());
$('#import-file-input').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/agents/import', { method: 'POST', credentials: 'same-origin', body: fd });
    if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.detail || 'Import failed'); }
    const result = await r.json();
    toast(`Imported: ${result.agent_id}`);
    await loadAgents();
    (window as any).editAgent(result.agent_id);
  } catch (e: any) { toast(e.message, 'error'); }
  (e.target as HTMLInputElement).value = '';
});

// ── Personality ──
$('#btn-save-personality').addEventListener('click', async () => {
  const id = ($('#personality-agent-select') as HTMLSelectElement).value;
  if (!id) return;
  try {
    await API.patch(`/api/agents/${id}`, {
      personality: ($('#personality-prompt') as HTMLTextAreaElement).value,
      greeting: ($('#personality-greeting') as HTMLInputElement).value,
    });
    toast('Personality saved');
  } catch (e: any) { toast(e.message, 'error'); }
});

// ── Model ──
async function loadProviders() {
  try { providers = await API.get<Provider[]>('/api/providers'); } catch { providers = []; }
}

function loadModelOptions(provider: string, selected?: string) {
  const p = providers.find(pr => pr.id === provider);
  const sel = $('#model-model') as HTMLSelectElement;
  if (!p || !p.models.length) { sel.innerHTML = '<option>No models available</option>'; return; }
  sel.innerHTML = p.models.map(m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)} ${m.free ? '(free)' : ''}</option>`).join('');
}

$('#model-provider').addEventListener('change', async (e) => {
  const provider = (e.target as HTMLSelectElement).value;
  loadModelOptions(provider);
  // Check health
  try {
    const h = await API.get<{ available: boolean; reason?: string }>(`/api/providers/${provider}/health`);
    $('#provider-health-status').textContent = h.available ? 'Provider available' : `Unavailable: ${h.reason}`;
    $('#provider-health-status').style.color = h.available ? 'var(--success)' : 'var(--danger)';
  } catch { $('#provider-health-status').textContent = ''; }
});

$('#btn-save-model').addEventListener('click', async () => {
  const id = ($('#model-agent-select') as HTMLSelectElement).value;
  if (!id) return;
  try {
    await API.patch(`/api/agents/${id}`, {
      llm: {
        provider: ($('#model-provider') as HTMLSelectElement).value,
        model: ($('#model-model') as HTMLSelectElement).value,
        temperature: parseFloat(($('#model-temperature') as HTMLInputElement).value),
        max_tokens: parseInt(($('#model-max-tokens') as HTMLInputElement).value),
        timeout_seconds: 20,
      },
    });
    toast('Model saved');
    await loadAgents();
  } catch (e: any) { toast(e.message, 'error'); }
});

// ── Speech ──
$('#btn-save-speech').addEventListener('click', async () => {
  const id = ($('#speech-agent-select') as HTMLSelectElement).value;
  if (!id) return;
  try {
    await API.patch(`/api/agents/${id}`, {
      speech: {
        stt_provider: ($('#speech-stt-provider') as HTMLInputElement).value,
        stt_model: ($('#speech-stt-model') as HTMLInputElement).value,
        stt_language: ($('#speech-stt-language') as HTMLInputElement).value,
        tts_provider: ($('#speech-tts-provider') as HTMLInputElement).value,
        tts_model: 'aura-2',
        tts_voice: ($('#speech-tts-voice') as HTMLInputElement).value,
        tts_language: ($('#speech-tts-language') as HTMLInputElement).value,
      },
    });
    toast('Speech saved');
  } catch (e: any) { toast(e.message, 'error'); }
});

// ── Appearance ──
document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const theme = (card as HTMLElement).dataset.theme!;
    document.documentElement.dataset.theme = theme;
  });
});

$('#btn-save-appearance').addEventListener('click', async () => {
  const id = ($('#appearance-agent-select') as HTMLSelectElement).value;
  if (!id) return;
  const selected = document.querySelector('.theme-card.selected') as HTMLElement;
  try {
    await API.patch(`/api/agents/${id}`, {
      appearance: { theme: selected?.dataset.theme || 'relate-prism' },
    });
    toast('Appearance saved');
  } catch (e: any) { toast(e.message, 'error'); }
});

// ── Diagnostics ──
async function loadDiagnostics() {
  try {
    const d = await API.get<Diagnostics>('/api/diagnostics');
    const grid = $('#diag-grid');
    const items = [
      ['Active Agent', d.agent_id || 'None'],
      ['Agent Version', d.agent_version || '—'],
      ['LLM Provider', d.llm_provider || '—'],
      ['LLM Model', d.llm_model || '—'],
      ['STT Provider', d.stt_provider || '—'],
      ['TTS Provider', d.tts_provider || '—'],
      ['TTS Voice', d.tts_voice || '—'],
      ['Theme', d.theme || '—'],
      ['Enabled Tools', d.enabled_tools?.join(', ') || 'None'],
      ['Build Version', d.build_version || '—'],
    ];
    grid.innerHTML = items.map(([l, v]) => `<div class="diag-item"><div class="diag-label">${l}</div><div class="diag-value">${esc(v)}</div></div>`).join('');
  } catch { $('#diag-grid').innerHTML = '<p style="color:var(--danger)">Failed to load diagnostics</p>'; }
}

$('#btn-refresh-diag').addEventListener('click', loadDiagnostics);

// ── Active Badge ──
async function updateActiveBadge() {
  try {
    const active = await API.get<{ agent_id?: string; name?: string }>('/api/agents/active');
    const badge = $('#active-agent-badge');
    if (active.agent_id) { badge.textContent = `${active.name || active.agent_id}`; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  } catch { }
}

// ── Helpers ──
function esc(s: string) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Init ──
async function init() {
  await Promise.all([loadAgents(), loadProviders(), updateActiveBadge()]);
  // Load first agent for editing if available
  if (allAgents.length && !currentAgentId) {
    currentAgentId = allAgents[0].agent_id;
    (window as any).editAgent(currentAgentId);
  }
}

init();
