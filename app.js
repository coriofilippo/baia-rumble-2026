
(() => {
'use strict';

const MODE = window.BAIA_MODE === 'admin' ? 'admin' : 'viewer';
const firebaseConfig = window.BAIA_FIREBASE_CONFIG || {};
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'baia_rumble_2026_shared_v2';
const ADMIN_SESSION = 'baia_rumble_admin_session';
const CAPTAIN_SESSION = 'baia_rumble_captain_team';
const DEFAULT_ADMIN_HASH = '158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab';
const DEFAULT_CAPTAIN_HASH = '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5';

function safeStorageGet(storageName,key) {
  try { return window[storageName]?.getItem(key) ?? null; } catch { return null; }
}
function safeStorageSet(storageName,key,value) {
  try { window[storageName]?.setItem(key,value); return true; } catch { return false; }
}
function safeStorageRemove(storageName,key) {
  try { window[storageName]?.removeItem(key); return true; } catch { return false; }
}

let data = initialData();
let cloud = null;
let unsubscribe = null;
let installPrompt = null;
let isAdmin = MODE === 'admin' && safeStorageGet('sessionStorage',ADMIN_SESSION) === '1';
let captainTeamId = safeStorageGet('sessionStorage',CAPTAIN_SESSION) || null;
let currentLiveMatch = null;
let currentEventId = null;
let saveTimer = null;

function initialData() {
  const teams = [
    {id:'baia',name:'Baia Salata',players:[]},
    {id:'caricasa',name:'Caricasa',players:[]},
    {id:'sovversiva',name:'La Sovversiva',players:[]},
    {id:'paradise',name:'Paradise Beach',players:[]},
    {id:'melaverde',name:'La Melaverde',players:[]}
  ];

  const regular = [
    ['g01','2026-08-01','15:00','Baia Salata','baia','caricasa'],
    ['g02','2026-08-01','15:30','La Melaverde','melaverde','sovversiva'],
    ['g03','2026-08-01','16:00','Baia Salata','baia','paradise'],
    ['g04','2026-08-01','17:00','La Melaverde','melaverde','caricasa'],
    ['g05','2026-08-01','17:30','La Sovversiva','sovversiva','paradise'],
    ['g06','2026-08-01','18:00','Baia Salata','baia','melaverde'],
    ['g07','2026-08-02','14:00','Caricasa','caricasa','sovversiva'],
    ['g08','2026-08-02','14:30','La Melaverde','melaverde','paradise'],
    ['g09','2026-08-02','15:00','Baia Salata','baia','sovversiva'],
    ['g10','2026-08-02','15:30','Caricasa','caricasa','paradise']
  ].map((x,i) => ({
    id:x[0],phase:'regular',round:`Girone · Partita ${i+1}`,
    date:x[1],time:x[2],venue:'Spiaggia Baia Salata, Imperia – Borgo Prino',
    home:x[4],away:x[5],status:'scheduled',
    goals:{home:{},away:{},homeOther:0,awayOther:0}
  }));

  const finals = [
    {id:'p25',phase:'playoff',round:'Spareggio A · 2ª contro 5ª',date:'2026-08-02',time:'16:00',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino',home:null,away:null,status:'scheduled',goals:{home:{},away:{},homeOther:0,awayOther:0}},
    {id:'p34',phase:'playoff',round:'Spareggio B · 3ª contro 4ª',date:'2026-08-02',time:'16:30',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino',home:null,away:null,status:'scheduled',goals:{home:{},away:{},homeOther:0,awayOther:0}},
    {id:'pwin',phase:'playoff',round:'Sfida per l’accesso alla finale',date:'2026-08-02',time:'17:00',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino',home:null,away:null,status:'scheduled',goals:{home:{},away:{},homeOther:0,awayOther:0}},
    {id:'final',phase:'final',round:'Finale',date:'2026-08-02',time:'17:30',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino',home:null,away:null,status:'scheduled',goals:{home:{},away:{},homeOther:0,awayOther:0}}
  ];

  const events = [
    {id:'e01',date:'2026-08-01',time:'14:30',title:'Partita giovani promesse Rari',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino'},
    {id:'e02',date:'2026-08-01',time:'16:30',title:'Lezione gratuita Acquagym',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino'},
    {id:'e03',date:'2026-08-02',time:'18:00',title:'Premiazioni e chiusura torneo',venue:'Spiaggia Baia Salata, Imperia – Borgo Prino'}
  ];

  return {
    version:7,
    settings:{
      name:'Beach Water polo Cup - Baia Rumble 2026',
      code:'BAIARUMBLE2026',
      pointsWin:3,pointsDraw:1,pointsLoss:0,
      adminPinHash:DEFAULT_ADMIN_HASH,
      captainPasswordHash:DEFAULT_CAPTAIN_HASH,
      votingClosed:false
    },
    teams,matches:[...regular,...finals],events,votes:{}
  };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
}[c]));
const uuid = () => (typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function' ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
const team = id => data.teams.find(t => t.id === id);
const teamName = id => id ? (team(id)?.name || 'Squadra non disponibile') : 'Da definire';
const playerById = id => data.teams.flatMap(t => t.players || []).find(p => p.id === id);
const playerFullName = p => p ? [p.firstName,p.lastName].filter(Boolean).join(' ').trim() || p.name || '' : '';
const normalizeLogin = value => String(value || '').trim().toLocaleLowerCase('it-IT').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const captainOfTeam = teamId => {
  const t=team(teamId);
  return t ? (t.players || []).find(p => p.id === t.captainId) || null : null;
};
const getMatch = id => data.matches.find(m => m.id === id);
const getEvent = id => data.events.find(e => e.id === id);
const statusLabel = s => ({scheduled:'Programmata',live:'In corso',played:'Terminata',cancelled:'Annullata'})[s] || s;
const fmt = (date,time) => date
  ? new Date(`${date}T${time || '00:00'}`).toLocaleString('it-IT',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
  : 'Da programmare';

function normalize() {
  data.settings ||= initialData().settings;
  data.teams ||= initialData().teams;
  data.matches ||= initialData().matches;
  data.events ||= initialData().events;
  data.votes ||= {};
  Object.keys(data.votes).forEach(teamId=>{
    const value=data.votes[teamId];
    if(Array.isArray(value))data.votes[teamId]=[...new Set(value)].slice(0,3);
    else if(value)data.votes[teamId]=[value];
    else data.votes[teamId]=[];
  });
  data.settings.adminPinHash ||= DEFAULT_ADMIN_HASH;
  data.settings.captainPasswordHash ||= DEFAULT_CAPTAIN_HASH;
  data.settings.votingClosed = Boolean(data.settings.votingClosed);
  data.teams.forEach(t => {
    t.players ||= [];
    t.players.forEach(p => {
      if (!p.firstName && !p.lastName) {
        const parts=String(p.name || '').trim().split(/\s+/).filter(Boolean);
        p.lastName=parts.length>1?parts.pop():'';
        p.firstName=parts.join(' ') || p.name || '';
      }
      p.name=playerFullName(p);
    });
    if (!t.captainId) {
      const marked=t.players.find(p=>p.isCaptain);
      if(marked)t.captainId=marked.id;
    }
    t.players.forEach(p=>p.isCaptain=p.id===t.captainId);
  });
  data.matches.forEach(m => {
    m.goals ||= {home:{},away:{},homeOther:0,awayOther:0};
    m.goals.home ||= {};
    m.goals.away ||= {};
    m.goals.homeOther = Number(m.goals.homeOther || 0);
    m.goals.awayOther = Number(m.goals.awayOther || 0);
  });
}

function loadLocal() {
  try {
    const raw=safeStorageGet('localStorage',STORAGE_KEY);
    const saved=raw?JSON.parse(raw):null;
    if(saved)data=saved;
  } catch {}
  normalize();
}
function saveLocal() {
  safeStorageSet('localStorage',STORAGE_KEY,JSON.stringify(data));
}
function score(match, side) {
  return Object.values(match.goals?.[side] || {}).reduce((sum,n) => sum + Number(n || 0), 0)
    + Number(match.goals?.[`${side}Other`] || 0);
}
function matchHasGoals(m) {
  return score(m,'home') + score(m,'away') > 0;
}
function winner(m) {
  if (!m || m.status !== 'played') return null;
  const hs = score(m,'home'), as = score(m,'away');
  if (hs === as) return null;
  return hs > as ? m.home : m.away;
}
function regularComplete() {
  return data.matches.filter(m => m.phase === 'regular').every(m => m.status === 'played');
}
function standings() {
  const rows = {};
  data.teams.forEach(t => rows[t.id] = {team:t,pg:0,w:0,d:0,l:0,gf:0,ga:0,pts:0});
  data.matches.filter(m => m.phase === 'regular' && m.status === 'played').forEach(m => {
    const h = rows[m.home], a = rows[m.away];
    if (!h || !a) return;
    const hs = score(m,'home'), as = score(m,'away');
    h.pg++;a.pg++;h.gf+=hs;h.ga+=as;a.gf+=as;a.ga+=hs;
    if (hs > as) {
      h.w++;a.l++;h.pts+=Number(data.settings.pointsWin);a.pts+=Number(data.settings.pointsLoss);
    } else if (hs < as) {
      a.w++;h.l++;a.pts+=Number(data.settings.pointsWin);h.pts+=Number(data.settings.pointsLoss);
    } else {
      h.d++;a.d++;h.pts+=Number(data.settings.pointsDraw);a.pts+=Number(data.settings.pointsDraw);
    }
  });
  return Object.values(rows).sort((a,b) =>
    b.pts-a.pts || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf || a.team.name.localeCompare(b.team.name)
  );
}
function assignTeams(m, home, away) {
  if (!m) return;
  if ((m.home !== home || m.away !== away) && !matchHasGoals(m) && m.status === 'scheduled') {
    m.home = home || null;
    m.away = away || null;
  }
}
function seedFinals() {
  if (!regularComplete()) return;
  const s = standings();
  const p25 = getMatch('p25'), p34 = getMatch('p34'), pwin = getMatch('pwin'), final = getMatch('final');
  assignTeams(p25,s[1]?.team.id,s[4]?.team.id);
  assignTeams(p34,s[2]?.team.id,s[3]?.team.id);
  assignTeams(pwin,winner(p25),winner(p34));
  assignTeams(final,s[0]?.team.id,winner(pwin));
}

function setSync(text, ok=false) {
  $('syncStatus').textContent = text;
  $('syncStatus').className = 'sync ' + (ok ? 'ok' : 'warn');
}
async function initCloud() {
  if (!firebaseConfig.apiKey) {
    setSync(MODE === 'admin' ? 'Modalità locale · cloud non configurato' : 'Anteprima locale · dati non sincronizzati');
    return;
  }
  try {
    const appmod = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const fsmod = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    const app = appmod.initializeApp(firebaseConfig);
    const db = fsmod.getFirestore(app);
    cloud = {db,doc:fsmod.doc,setDoc:fsmod.setDoc,onSnapshot:fsmod.onSnapshot};
    subscribeCloud();
  } catch (error) {
    console.error(error);
    setSync('Cloud non disponibile');
  }
}
function subscribeCloud() {
  if (unsubscribe) unsubscribe();
  const code = (data.settings.code || 'BAIARUMBLE2026').trim().toUpperCase();
  const ref = cloud.doc(cloud.db,'tournaments',code);
  unsubscribe = cloud.onSnapshot(ref, snap => {
    if (snap.exists()) {
      data = snap.data();
      normalize();seedFinals();saveLocal();render();
      setSync('Aggiornamento in tempo reale · '+code,true);
    } else if (MODE === 'admin' && isAdmin) {
      saveAll(true);
    } else {
      setSync('Torneo non ancora pubblicato');
    }
  }, () => setSync('Connessione cloud interrotta'));
}
function saveCaptainVote() {
  if (!captainTeamId) return;
  normalize();saveLocal();render();
  if (!cloud) return;
  const code=(data.settings.code || 'BAIARUMBLE2026').trim().toUpperCase();
  cloud.setDoc(cloud.doc(cloud.db,'tournaments',code),{votes:data.votes},{merge:true})
    .catch(()=>setSync('Errore nel salvataggio del voto'));
}

function saveAll(immediate=false) {
  if (MODE !== 'admin' || !isAdmin) return;
  normalize();seedFinals();saveLocal();render();
  if (!cloud) return;
  clearTimeout(saveTimer);
  const send = () => {
    const code = (data.settings.code || 'BAIARUMBLE2026').trim().toUpperCase();
    cloud.setDoc(cloud.doc(cloud.db,'tournaments',code),data)
      .catch(() => setSync('Errore di sincronizzazione'));
  };
  if (immediate) send(); else saveTimer = setTimeout(send,200);
}

function sha256Fallback(value) {
  const utf8=unescape(encodeURIComponent(String(value)));
  const rightRotate=(v,a)=>(v>>>a)|(v<<(32-a));
  const maxWord=Math.pow(2,32),words=[],k=[];
  let hash=[];
  let primeCounter=0,isComposite={};
  for(let candidate=2;primeCounter<64;candidate++){
    if(!isComposite[candidate]){
      for(let i=0;i<313;i+=candidate)isComposite[i]=candidate;
      hash[primeCounter]=(Math.pow(candidate,.5)*maxWord)|0;
      k[primeCounter++]=(Math.pow(candidate,1/3)*maxWord)|0;
    }
  }
  let ascii=utf8+'\x80';
  while(ascii.length%64!==56)ascii+='\x00';
  for(let i=0;i<ascii.length;i++)words[i>>2]|=ascii.charCodeAt(i)<<((3-i)%4)*8;
  const bitLength=utf8.length*8;
  words.push(Math.floor(bitLength/maxWord));words.push(bitLength);
  for(let j=0;j<words.length;){
    const w=words.slice(j,j+=16),oldHash=hash.slice(0);hash=hash.slice(0,8);
    for(let i=0;i<64;i++){
      const w15=w[i-15],w2=w[i-2];
      const a=hash[0],e=hash[4];
      const temp1=hash[7]+(rightRotate(e,6)^rightRotate(e,11)^rightRotate(e,25))+((e&hash[5])^((~e)&hash[6]))+k[i]+(w[i]=(i<16?w[i]:(w[i-16]+(rightRotate(w15,7)^rightRotate(w15,18)^(w15>>>3))+w[i-7]+(rightRotate(w2,17)^rightRotate(w2,19)^(w2>>>10)))|0));
      const temp2=(rightRotate(a,2)^rightRotate(a,13)^rightRotate(a,22))+((a&hash[1])^(a&hash[2])^(hash[1]&hash[2]));
      hash=[(temp1+temp2)|0,a,hash[1],hash[2],(hash[3]+temp1)|0,e,hash[5],hash[6]];
    }
    for(let i=0;i<8;i++)hash[i]=(hash[i]+oldHash[i])|0;
  }
  let result='';
  for(let i=0;i<8;i++)for(let j=3;j+1;j--)result+=((hash[i]>>(j*8))&255).toString(16).padStart(2,'0');
  return result;
}
async function sha256(text) {
  try {
    if(typeof crypto!=='undefined'&&crypto.subtle&&typeof TextEncoder!=='undefined'){
      const bytes=new TextEncoder().encode(String(text));
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch{}
  return sha256Fallback(text);
}
function showModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click',() => closeModal(b.dataset.close)));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click',e => {
  if (e.target === m) closeModal(m.id);
}));

function updateAccessUI() {
  const enabled = MODE === 'admin' && isAdmin;
  document.body.classList.toggle('admin-enabled',enabled);
  $('accessLabel').innerHTML = MODE === 'viewer'
    ? '<b>Accesso visitatori · sola lettura</b>'
    : enabled ? '<b>Accesso amministratore attivo</b>' : '<b>Area amministratore bloccata</b>';
  $('loginBtn').style.display = MODE === 'admin' && !isAdmin ? 'inline-flex' : 'none';
  $('logoutBtn').style.display = MODE === 'admin' && isAdmin ? 'inline-flex' : 'none';
}
$('loginBtn').addEventListener('click',() => {
  $('pinInput').value='';$('loginError').textContent='';
  showModal('loginModal');setTimeout(()=>$('pinInput').focus(),100);
});
$('confirmLogin').addEventListener('click',async() => {
  if (await sha256($('pinInput').value) === data.settings.adminPinHash) {
    isAdmin=true;safeStorageSet('sessionStorage',ADMIN_SESSION,'1');
    closeModal('loginModal');updateAccessUI();render();
    if (cloud) subscribeCloud();
  } else {
    $('loginError').textContent='PIN non corretto.';
  }
});
$('pinInput').addEventListener('keydown',e => {if(e.key==='Enter')$('confirmLogin').click();});
$('logoutBtn').addEventListener('click',() => {
  isAdmin=false;safeStorageRemove('sessionStorage',ADMIN_SESSION);updateAccessUI();render();
});

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click',() => {
  if (button.dataset.panel === 'settings' && !(MODE === 'admin' && isAdmin)) return;
  document.querySelectorAll('.tab,.panel').forEach(x => x.classList.remove('on'));
  button.classList.add('on');$(button.dataset.panel).classList.add('on');
}));

function scorerSummary(m) {
  const parts = [];
  ['home','away'].forEach(side => {
    Object.entries(m.goals?.[side] || {}).forEach(([playerId,count]) => {
      const p = playerById(playerId);
      if (p && Number(count)>0) parts.push(`${p.name} ${count>1?'('+count+')':''}`.trim());
    });
    const other = Number(m.goals?.[`${side}Other`] || 0);
    if (other > 0) parts.push(`non attribuiti (${other})`);
  });
  return parts.length ? `<div class="goal-summary"><b>Marcatori:</b> ${parts.map(esc).join(', ')}</div>` : '';
}
function renderUpcoming() {
  const arr = data.matches.filter(m => m.status === 'scheduled' && m.home && m.away)
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,6);
  $('upcoming').innerHTML = arr.length ? arr.map(m => `
    <div class="match-card">
      <div class="match-time">${fmt(m.date,m.time)}</div>
      <div><div class="match-teams"><b>${esc(teamName(m.home))}</b> – <b>${esc(teamName(m.away))}</b></div><div class="match-sub">${esc(m.round)}</div></div>
      <span class="badge">${statusLabel(m.status)}</span>
    </div>`).join('') : '<p class="muted">Nessuna partita futura.</p>';
}
function renderTeams() {
  const colors=['#0a68ad','#ee9228','#d84046','#5c4bb1','#3b9a58'];
  $('teamCards').innerHTML = data.teams.map((t,i) => `
    <div class="card c6 team-card" style="border-top-color:${colors[i%colors.length]}">
      <div class="team-head">
        <div><h2>${esc(t.name)}</h2><span class="muted">${t.players.length} giocatori</span></div>
        <div class="actions admin-only">
          <button class="secondary tiny" onclick="window.editTeamName('${t.id}')">Rinomina</button>
          <button class="primary tiny" onclick="window.openPlayer('${t.id}')">Aggiungi giocatore</button>
        </div>
      </div>
      ${t.players.length ? `<ul class="player-list">${t.players.slice().sort((a,b)=>(Number(a.number)||999)-(Number(b.number)||999)||playerFullName(a).localeCompare(playerFullName(b))).map(p => `
        <li><span><span class="jersey">${esc(p.number||'–')}</span><b>${esc(playerFullName(p))}</b>${p.id===t.captainId?'<span class="captain-badge">CAPITANO</span>':''}</span>
        <span class="roster-actions admin-only">
          <button class="secondary tiny" onclick="window.openPlayer('${t.id}','${p.id}')">Modifica</button>
          <button class="danger tiny" onclick="window.deletePlayer('${t.id}','${p.id}')">Elimina</button>
        </span></li>`).join('')}</ul>` : '<p class="muted">Rosa non ancora inserita.</p>'}
    </div>`).join('');
}
window.editTeamName = teamId => {
  if (!isAdmin) return;
  const t=team(teamId),name=prompt('Nuovo nome squadra:',t.name);
  if (name?.trim()) {t.name=name.trim();saveAll(true);}
};
window.openPlayer = (teamId,playerId='') => {
  if (!isAdmin) return;
  const t=team(teamId),p=t?.players.find(x=>x.id===playerId);
  $('playerTeamId').value=teamId;$('playerId').value=playerId;
  $('playerNumber').value=p?.number||'';$('playerFirstName').value=p?.firstName||'';$('playerLastName').value=p?.lastName||'';$('playerCaptain').checked=Boolean(p&&p.id===t.captainId);
  $('playerModalTitle').textContent=p?'Modifica giocatore · '+t.name:'Aggiungi giocatore · '+t.name;
  showModal('playerModal');
};
$('savePlayer').addEventListener('click',() => {
  if (!isAdmin) return;
  const t=team($('playerTeamId').value);
  const firstName=$('playerFirstName').value.trim(),lastName=$('playerLastName').value.trim();
  if (!t || !firstName) return alert('Inserisci almeno il nome del giocatore.');
  if ($('playerCaptain').checked && !lastName) return alert('Per il capitano è obbligatorio inserire il cognome, che sarà il nome utente.');
  const id=$('playerId').value || uuid();
  const obj={id,number:$('playerNumber').value.trim(),firstName,lastName,name:[firstName,lastName].filter(Boolean).join(' ')};
  const index=t.players.findIndex(p=>p.id===id);
  if (index>=0) t.players[index]=obj; else t.players.push(obj);
  if ($('playerCaptain').checked) t.captainId=id;
  else if (t.captainId===id) t.captainId=null;
  t.players.forEach(p=>p.isCaptain=p.id===t.captainId);
  closeModal('playerModal');saveAll(true);
});
window.deletePlayer = (teamId,playerId) => {
  if (!isAdmin) return;
  const t=team(teamId);
  if(t?.captainId===playerId)return alert('Questo giocatore è il capitano. Imposta prima un altro capitano.');
  const used=data.matches.some(m=>Number(m.goals?.home?.[playerId]||0)>0||Number(m.goals?.away?.[playerId]||0)>0);
  if (used) return alert('Il giocatore ha già segnato e non può essere eliminato. Modificane il nome.');
  if (confirm('Eliminare il giocatore?')) {
    const t=team(teamId);t.players=t.players.filter(p=>p.id!==playerId);saveAll(true);
  }
};

function renderCalendar() {
  const all = [
    ...data.matches.map(m=>({...m,itemType:'match'})),
    ...data.events.map(e=>({...e,itemType:'event'}))
  ].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const grouped={};
  all.forEach(item => (grouped[item.date] ||= []).push(item));
  $('calendarList').innerHTML = Object.keys(grouped).sort().map(date => `
    <div class="card" style="box-shadow:none">
      <h3>${new Date(date+'T12:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h3>
      ${grouped[date].map(item => item.itemType==='event' ? `
        <div class="match-card event-card">
          <div class="match-time">${item.time}</div>
          <div><div class="match-teams"><b>${esc(item.title)}</b></div><div class="match-sub">${esc(item.venue)}</div></div>
          <div><span class="badge event">Evento</span>
          <div><button class="secondary tiny admin-only" onclick="window.openEventEditor('${item.id}')">Modifica</button></div></div>
        </div>` : `
        <div class="match-card">
          <div class="match-time">${item.time}<div class="match-sub">${esc(item.round)}</div></div>
          <div><div class="match-teams"><b>${esc(teamName(item.home))}</b> – <b>${esc(teamName(item.away))}</b></div>
          <div class="match-sub">${esc(item.venue)}</div>${scorerSummary(item)}</div>
          <div class="center"><div class="score">${score(item,'home')} : ${score(item,'away')}</div>
          <span class="badge ${item.status}">${statusLabel(item.status)}</span>
          <div><button class="primary tiny admin-only" onclick="window.openLive('${item.id}')" ${(!item.home||!item.away)?'disabled':''}>Gestisci</button></div></div>
        </div>`).join('')}
    </div>`).join('');
}
function renderStandings() {
  const s=standings();
  $('standingRows').innerHTML=s.map((x,i)=>`<tr class="${i===0?'champion':''}">
    <td>${i+1}</td><td><b>${esc(x.team.name)}</b>${i===0?'<div class="small">Finalista diretta</div>':''}</td>
    <td>${x.pg}</td><td>${x.w}</td><td>${x.d}</td><td>${x.l}</td>
    <td>${x.gf}</td><td>${x.ga}</td><td>${x.gf-x.ga}</td><td><b>${x.pts}</b></td></tr>`).join('');
  $('quickStandings').innerHTML=`<table><thead><tr><th>#</th><th>Squadra</th><th>Pt</th></tr></thead><tbody>
    ${s.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.team.name)}</td><td><b>${x.pts}</b></td></tr>`).join('')}
    </tbody></table>`;
}
function renderScorers() {
  const totals={};
  data.matches.forEach(m => ['home','away'].forEach(side => {
    Object.entries(m.goals?.[side] || {}).forEach(([pid,count]) => {
      const p=playerById(pid),teamId=side==='home'?m.home:m.away;
      if (!p || Number(count)<=0) return;
      totals[pid] ||= {player:playerFullName(p),teamId,goals:0};
      totals[pid].player=playerFullName(p);totals[pid].teamId=teamId;totals[pid].goals+=Number(count);
    });
  }));
  const rows=Object.values(totals).sort((a,b)=>b.goals-a.goals||a.player.localeCompare(b.player));
  $('scorerRows').innerHTML=rows.length ? rows.map((x,i)=>`
    <tr><td>${i+1}</td><td><b>${esc(x.player)}</b></td><td>${esc(teamName(x.teamId))}</td><td><b>${x.goals}</b></td></tr>`
  ).join('') : '<tr><td colspan="4" class="muted">Nessun gol ancora attribuito ai giocatori.</td></tr>';
}
function bracketBox(title,m,homePlaceholder,awayPlaceholder) {
  return `<div class="bracket-box"><h3>${title}</h3>
    <div class="bracket-team">${esc(m?.home?teamName(m.home):homePlaceholder)}</div>
    <div class="score">${m?score(m,'home'):0} : ${m?score(m,'away'):0}</div>
    <div class="bracket-team">${esc(m?.away?teamName(m.away):awayPlaceholder)}</div>
    ${m?`<span class="badge ${m.status}">${statusLabel(m.status)}</span>`:''}
  </div>`;
}
function renderBracket() {
  const p25=getMatch('p25'),p34=getMatch('p34'),pwin=getMatch('pwin'),final=getMatch('final');
  $('bracket').innerHTML=`
    <div>${bracketBox('16:00 · 2ª contro 5ª',p25,'2ª classificata','5ª classificata')}<br>
    ${bracketBox('16:30 · 3ª contro 4ª',p34,'3ª classificata','4ª classificata')}</div>
    <div class="bracket-arrow">➜</div>
    <div>${bracketBox('17:00 · Accesso alla finale',pwin,'Vincente 2ª/5ª','Vincente 3ª/4ª')}</div>
    <div class="bracket-arrow">➜</div>
    <div>${bracketBox('17:30 · Finale',final,'1ª classificata','Vincente spareggi')}</div>`;
}

function allCaptains() {
  return data.teams.map(t=>({team:t,captain:captainOfTeam(t.id)}));
}
function captainLoginState() {
  const c=captainOfTeam(captainTeamId);
  if(c&&team(captainTeamId))return {team:team(captainTeamId),captain:c};
  captainTeamId=null;safeStorageRemove('sessionStorage',CAPTAIN_SESSION);return null;
}
function voteTotals() {
  const totals={};
  Object.values(data.votes || {}).forEach(playerIds=>{
    (Array.isArray(playerIds)?playerIds:[]).forEach(playerId=>{
      if(playerById(playerId))totals[playerId]=(totals[playerId]||0)+1;
    });
  });
  return Object.entries(totals).map(([playerId,votes])=>({player:playerById(playerId),playerId,votes}))
    .filter(x=>x.player).sort((a,b)=>b.votes-a.votes||playerFullName(a.player).localeCompare(playerFullName(b.player)));
}
function renderMvp() {
  const login=captainLoginState();
  const captains=allCaptains();
  const configured=captains.filter(x=>x.captain).length;
  const voted=Object.keys(data.votes || {}).filter(teamId=>Array.isArray(data.votes[teamId])&&data.votes[teamId].length===3&&captainOfTeam(teamId)).length;
  const closed=Boolean(data.settings.votingClosed);

  $('voteProgress').innerHTML=`<p><b>${voted} squadre hanno espresso tutti e 3 i voti su ${configured} capitani configurati</b></p>
    <p class="muted">${configured<5?'L’amministratore deve ancora indicare il capitano di '+(5-configured)+' squadre.':'Tutte le squadre hanno un capitano.'}</p>
    ${closed?'<div class="vote-closed">Le votazioni sono chiuse. I capitani non possono più inserire o modificare i voti.</div>':''}`;

  $('captainCredentials').innerHTML=isAdmin?`<h3>Credenziali e stato capitani</h3>
    ${captains.map(x=>{
      const votes=Array.isArray(data.votes[x.team.id])?data.votes[x.team.id].length:0;
      return `<div class="teamline"><span><b>${esc(x.team.name)}</b><br><span class="muted">${x.captain?esc(playerFullName(x.captain)):'Capitano non impostato'}</span></span>
      <span>${x.captain?`utente: <b>${esc(x.captain.lastName)}</b><br><span class="muted">${votes===3?'3 voti registrati':votes+' voti registrati'}</span>`:'—'}</span></div>`;
    }).join('')}
    <p class="muted">Password comune: <span class="password-note">12345</span></p>`:'';

  if($('closeVotingBtn')){
    $('closeVotingBtn').style.display=isAdmin&&!closed?'inline-flex':'none';
    $('openVotingBtn').style.display=isAdmin&&closed?'inline-flex':'none';
  }

  $('captainLoginState').innerHTML=login
    ? `<div class="login-status">Accesso effettuato come <b>${esc(playerFullName(login.captain))}</b>, capitano di ${esc(login.team.name)}.</div>`
    : '<p class="muted">Nessun capitano autenticato.</p>';
  $('captainLoginBtn').style.display=login?'none':'inline-flex';
  $('captainLogoutBtn').style.display=login?'inline-flex':'none';

  if(login&&!closed){
    const selected=Array.isArray(data.votes[login.team.id])?data.votes[login.team.id]:[];
    $('voteLockedMessage').style.display='none';
    $('voteBallot').style.display='block';
    $('voteActions').style.display='flex';
    const eligibleTeams=data.teams.filter(t=>t.id!==login.team.id);
    $('voteBallot').innerHTML=eligibleTeams.map(t=>`<div class="vote-team"><h3>${esc(t.name)}</h3>
      ${(t.players||[]).length?t.players.slice().sort((a,b)=>playerFullName(a).localeCompare(playerFullName(b))).map(p=>`
        <label class="vote-option ${selected.includes(p.id)?'selected':''}">
          <input type="checkbox" name="mvpVote" value="${p.id}" ${selected.includes(p.id)?'checked':''}>
          <span><b>${esc(playerFullName(p))}</b>${p.id===t.captainId?'<span class="captain-badge">CAPITANO</span>':''}</span>
        </label>`).join(''):'<p class="muted">Nessun giocatore inserito.</p>'}</div>`).join('');
    updateVoteSelectionUI();
  }else{
    $('voteLockedMessage').style.display='block';
    $('voteLockedMessage').innerHTML=closed
      ? 'Le votazioni sono state chiuse dall’amministratore.'
      : 'Accedi come capitano per esprimere i tuoi tre voti.';
    $('voteBallot').style.display='none';$('voteActions').style.display='none';
  }

  const totals=voteTotals();
  if(isAdmin){
    $('voteResults').innerHTML=totals.length?totals.map((x,i)=>`<div class="vote-result">
      <span class="vote-rank">${i+1}</span><span><b>${esc(playerFullName(x.player))}</b><br><span class="muted">${esc(data.teams.find(t=>t.players.some(p=>p.id===x.playerId))?.name||'')}</span></span>
      <b>${x.votes} ${x.votes===1?'voto':'voti'}</b></div>`).join(''):'<p class="muted">Nessun voto ancora espresso.</p>';
  }else{
    $('voteResults').innerHTML='<p class="muted">L’esito della votazione è riservato agli amministratori.</p>';
  }
}

function updateVoteSelectionUI(){
  const checked=[...document.querySelectorAll('input[name="mvpVote"]:checked')];
  document.querySelectorAll('input[name="mvpVote"]').forEach(input=>{
    input.disabled=checked.length>=3&&!input.checked;
    input.closest('.vote-option')?.classList.toggle('selected',input.checked);
  });
  if($('voteCounter'))$('voteCounter').textContent=`Selezionati ${checked.length} di 3`;
  if($('saveVoteBtn'))$('saveVoteBtn').disabled=checked.length!==3;
}

$('captainLoginBtn').addEventListener('click',()=>{
  $('captainUsername').value='';$('captainPassword').value='';$('captainLoginError').textContent='';
  showModal('captainLoginModal');setTimeout(()=>$('captainUsername').focus(),100);
});
$('confirmCaptainLogin').addEventListener('click',async()=>{
  const username=normalizeLogin($('captainUsername').value);
  const matching=allCaptains().filter(x=>x.captain&&normalizeLogin(x.captain.lastName)===username);
  if(!username||matching.length===0){$('captainLoginError').textContent='Cognome non riconosciuto o capitano non ancora configurato.';return;}
  if(matching.length>1){$('captainLoginError').textContent='Cognome presente per più capitani: chiedere all’amministratore di usare cognomi distinti.';return;}
  if(await sha256($('captainPassword').value)!==data.settings.captainPasswordHash){$('captainLoginError').textContent='Password non corretta.';return;}
  captainTeamId=matching[0].team.id;safeStorageSet('sessionStorage',CAPTAIN_SESSION,captainTeamId);
  closeModal('captainLoginModal');render();
});
$('captainPassword').addEventListener('keydown',e=>{if(e.key==='Enter')$('confirmCaptainLogin').click();});
document.addEventListener('change',e=>{if(e.target.matches('input[name="mvpVote"]'))updateVoteSelectionUI();});
$('captainLogoutBtn').addEventListener('click',()=>{
  captainTeamId=null;safeStorageRemove('sessionStorage',CAPTAIN_SESSION);render();
});
$('saveVoteBtn').addEventListener('click',()=>{
  const login=captainLoginState();if(!login)return;
  if(data.settings.votingClosed)return alert('Le votazioni sono chiuse.');
  const selected=[...document.querySelectorAll('input[name="mvpVote"]:checked')].map(x=>x.value);
  if(selected.length!==3)return alert('Devi selezionare esattamente 3 giocatori diversi.');
  const ownPlayerIds=new Set((login.team.players||[]).map(p=>p.id));
  if(selected.some(id=>ownPlayerIds.has(id)))return alert('Non puoi votare giocatori della tua squadra.');
  if(new Set(selected).size!==3)return alert('I tre voti devono andare a giocatori diversi.');
  data.votes[login.team.id]=selected;saveCaptainVote();alert('I tre voti sono stati registrati.');
});


$('closeVotingBtn').addEventListener('click',()=>{
  if(!isAdmin)return;
  if(confirm('Chiudere le votazioni? I capitani non potranno più modificare i propri voti.')){
    data.settings.votingClosed=true;saveAll(true);
  }
});
$('openVotingBtn').addEventListener('click',()=>{
  if(!isAdmin)return;
  if(confirm('Riaprire le votazioni e consentire nuove modifiche ai capitani?')){
    data.settings.votingClosed=false;saveAll(true);
  }
});
$('printVoteResultsBtn').addEventListener('click',()=>{
  if(!isAdmin)return;
  document.body.classList.add('print-mvp');
  const oldPanel=document.querySelector('.panel.on');
  document.querySelectorAll('.panel,.tab').forEach(x=>x.classList.remove('on'));
  $('mvp').classList.add('on');
  window.print();
  setTimeout(()=>{
    document.body.classList.remove('print-mvp');
    $('mvp').classList.remove('on');
    if(oldPanel)oldPanel.classList.add('on');
    const tab=document.querySelector(`[data-panel="${oldPanel?.id||'home'}"]`);
    if(tab)tab.classList.add('on');
  },300);
});

function renderSettings() {
  $('setName').value=data.settings.name;$('setCode').value=data.settings.code;
  $('pointsWin').value=data.settings.pointsWin;$('pointsDraw').value=data.settings.pointsDraw;$('pointsLoss').value=data.settings.pointsLoss;
}
function render() {
  normalize();seedFinals();updateAccessUI();
  $('kpiTeams').textContent=data.teams.length;
  $('kpiMatches').textContent=data.matches.length;
  const played=data.matches.filter(m=>m.status==='played');
  $('kpiPlayed').textContent=played.length;
  $('kpiGoals').textContent=played.reduce((sum,m)=>sum+score(m,'home')+score(m,'away'),0);
  renderUpcoming();renderTeams();renderCalendar();renderStandings();renderScorers();renderMvp();renderBracket();renderSettings();
  if (currentLiveMatch && $('liveModal').classList.contains('open')) renderLiveModal();
}

window.openLive = id => {
  if (!isAdmin) return;
  const m=getMatch(id);if(!m)return;
  currentLiveMatch=id;renderLiveModal();showModal('liveModal');
};
function teamOptions(selected='') {
  return '<option value="">Da definire</option>'+data.teams.map(t=>
    `<option value="${t.id}" ${t.id===selected?'selected':''}>${esc(t.name)}</option>`
  ).join('');
}
function goalRows(m,side) {
  const t=team(side==='home'?m.home:m.away),map=m.goals[side],players=t?.players||[];
  const rows=players.map(p=>`
    <div class="goal-row"><span><span class="jersey">${esc(p.number||'–')}</span>${esc(playerFullName(p))}</span>
    <button class="danger icon-btn" onclick="window.goalChange('${side}','${p.id}',-1)">−</button>
    <span class="goal-count">${Number(map[p.id]||0)}</span>
    <button class="success icon-btn" onclick="window.goalChange('${side}','${p.id}',1)">+</button></div>`).join('');
  const key=`${side}Other`;
  return (rows||'<p class="muted">Inserire prima i giocatori nella rosa.</p>')+`
    <div class="goal-row"><span><b>Gol non attribuiti</b></span>
    <button class="danger icon-btn" onclick="window.otherGoalChange('${side}',-1)">−</button>
    <span class="goal-count">${Number(m.goals[key]||0)}</span>
    <button class="success icon-btn" onclick="window.otherGoalChange('${side}',1)">+</button></div>`;
}
function renderLiveModal() {
  const m=getMatch(currentLiveMatch);if(!m)return;
  $('liveTitle').textContent=teamName(m.home)+' – '+teamName(m.away);
  $('liveSubtitle').textContent=m.round+' · '+fmt(m.date,m.time);
  $('liveStatus').value=m.status;$('liveDate').value=m.date;$('liveTime').value=m.time;
  $('liveRound').value=m.round;$('liveVenue').value=m.venue;
  $('liveHomeSelect').innerHTML=teamOptions(m.home);$('liveAwaySelect').innerHTML=teamOptions(m.away);
  $('liveHomeScore').textContent=score(m,'home');$('liveAwayScore').textContent=score(m,'away');
  $('liveHomeName').textContent=teamName(m.home);$('liveAwayName').textContent=teamName(m.away);
  $('liveHomePlayers').innerHTML=goalRows(m,'home');$('liveAwayPlayers').innerHTML=goalRows(m,'away');
}
window.goalChange=(side,playerId,delta)=>{
  if(!isAdmin)return;const m=getMatch(currentLiveMatch);if(!m)return;
  m.goals[side][playerId]=Math.max(0,Number(m.goals[side][playerId]||0)+delta);
  if(m.goals[side][playerId]===0)delete m.goals[side][playerId];
  if(m.status==='scheduled'&&delta>0)m.status='live';
  saveAll();
};
window.otherGoalChange=(side,delta)=>{
  if(!isAdmin)return;const m=getMatch(currentLiveMatch);if(!m)return;
  const key=`${side}Other`;m.goals[key]=Math.max(0,Number(m.goals[key]||0)+delta);
  if(m.status==='scheduled'&&delta>0)m.status='live';
  saveAll();
};
function updateCurrentMatchField(field,value) {
  const m=getMatch(currentLiveMatch);if(!m)return;
  m[field]=value;saveAll(true);
}
$('liveStatus').addEventListener('change',() => {
  const m=getMatch(currentLiveMatch);
  if($('liveStatus').value==='played'&&m.phase!=='regular'&&score(m,'home')===score(m,'away')){
    alert('Nella fase finale deve esserci un vincitore. Inserisci il risultato definitivo.');
    $('liveStatus').value=m.status;return;
  }
  updateCurrentMatchField('status',$('liveStatus').value);
});
$('liveDate').addEventListener('change',()=>updateCurrentMatchField('date',$('liveDate').value));
$('liveTime').addEventListener('change',()=>updateCurrentMatchField('time',$('liveTime').value));
$('liveRound').addEventListener('change',()=>updateCurrentMatchField('round',$('liveRound').value.trim()));
$('liveVenue').addEventListener('change',()=>updateCurrentMatchField('venue',$('liveVenue').value.trim()));
$('liveHomeSelect').addEventListener('change',()=>updateCurrentMatchField('home',$('liveHomeSelect').value));
$('liveAwaySelect').addEventListener('change',()=>updateCurrentMatchField('away',$('liveAwaySelect').value));
$('markLive').addEventListener('click',()=>updateCurrentMatchField('status','live'));
$('markPlayed').addEventListener('click',()=>{
  const m=getMatch(currentLiveMatch);
  if(m.phase!=='regular'&&score(m,'home')===score(m,'away'))return alert('Nella fase finale serve un vincitore.');
  updateCurrentMatchField('status','played');
});

window.openEventEditor=id=>{
  if(!isAdmin)return;const e=getEvent(id);if(!e)return;
  currentEventId=id;$('eventTitle').value=e.title;$('eventDate').value=e.date;$('eventTime').value=e.time;$('eventVenue').value=e.venue;
  showModal('eventModal');
};
$('saveEvent').addEventListener('click',()=>{
  if(!isAdmin)return;const e=getEvent(currentEventId);if(!e)return;
  e.title=$('eventTitle').value.trim();e.date=$('eventDate').value;e.time=$('eventTime').value;e.venue=$('eventVenue').value.trim();
  closeModal('eventModal');saveAll(true);
});

$('saveSettings').addEventListener('click',()=>{
  if(!isAdmin)return;
  const oldCode=data.settings.code;
  data.settings.name=$('setName').value.trim()||'Beach Water polo Cup - Baia Rumble 2026';
  data.settings.code=$('setCode').value.trim().toUpperCase()||'BAIARUMBLE2026';
  data.settings.pointsWin=Number($('pointsWin').value);
  data.settings.pointsDraw=Number($('pointsDraw').value);
  data.settings.pointsLoss=Number($('pointsLoss').value);
  saveLocal();
  if(cloud&&oldCode!==data.settings.code)subscribeCloud();else saveAll(true);
});
$('changePin').addEventListener('click',async()=>{
  if(!isAdmin)return;
  const a=$('newPin').value,b=$('newPin2').value;
  if(a.length<4)return alert('Il PIN deve contenere almeno 4 caratteri.');
  if(a!==b)return alert('I PIN non coincidono.');
  data.settings.adminPinHash=await sha256(a);$('newPin').value='';$('newPin2').value='';
  saveAll(true);alert('PIN modificato.');
});
$('exportBtn').addEventListener('click',()=>{
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  link.download='baia-rumble-2026-backup.json';link.click();URL.revokeObjectURL(link.href);
});
$('importFile').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{try{data=JSON.parse(reader.result);normalize();saveAll(true);alert('Backup importato.')}catch{alert('File non valido.')}};
  reader.readAsText(file);
});
$('resetBtn').addEventListener('click',()=>{
  if(isAdmin&&confirm('Ripristinare calendario, squadre e dati iniziali? Rose e risultati saranno cancellati.')){
    data=initialData();saveAll(true);
  }
});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').hidden=false;});
$('installBtn').addEventListener('click',async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}});


if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}

loadLocal();seedFinals();render();initCloud();
if(MODE==='admin'&&!isAdmin)setTimeout(()=>$('loginBtn').click(),250);
})();
