/**
 * SaaS: Planilha (.xlsx/.xls/.csv) -> vídeos .mp4 + ZIP (UI + backend, SSE)
 * Atualizações essenciais:
 *  - Numeração sem corrida: reserva de BLOCO atômico (sem números repetidos)
 *  - yt-dlp com --user-agent e --add-header "Referer: <url>" (melhora Pinterest)
 *  - erros.csv fora do ZIP (botão dedicado)
 *  - Painel com dropdown do último item, URL clicável, botão "Abrir URL selecionada"
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const EventEmitter = require('events');

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const Archiver = require('archiver');
const ffmpegPath = require('ffmpeg-static');

/* ---------------- Config ---------------- */
const PORT = process.env.PORT || 3000;
const COUNTER_FILE = path.join(__dirname, 'counter.json');
const BIN_DIR = path.join(__dirname, 'bin');
const TMP_ROOT = path.join(os.tmpdir(), 'mp4-saas');
const MAX_FILE_SIZE_MB = 200;
const MAX_CONCURRENCY = 6;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

/* ---------------- UI ---------------- */
const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Downloader de Vídeos (MP4) — SaaS</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
:root{
  --bg:#0f172a;--panel:#0b1224;--text:#e5e7eb;--muted:#94a3b8;--brand:#22c55e;--border:#1f2937;
  --warn:#f59e0b;--err:#ef4444;--ok:#16a34a;--chip:#111827;--chipb:#1f2937;--accent:#3b82f6
}
*{box-sizing:border-box}
body{margin:0;background:
  radial-gradient(1200px 800px at 20% 10%,rgba(34,197,94,.12),transparent 60%),
  radial-gradient(1200px 800px at 80% 0%,rgba(59,130,246,.12),transparent 60%),
  var(--bg); color:var(--text); font-family:ui-sans-serif,system-ui,Segoe UI,Roboto}
.wrap{max-width:1100px;margin:40px auto;padding:24px;border:1px solid var(--border);
  border-radius:20px;background:rgba(11,18,36,.85);backdrop-filter:saturate(140%) blur(8px);
  box-shadow:0 10px 30px rgba(0,0,0,.35); position:relative}
h1{margin:0 0 8px;font-size:22px}
p{margin:0 0 12px;color:var(--muted)}
.top-actions{position:absolute; right:24px; top:24px; display:flex; gap:10px}
.btn{border:0;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer}
.btn.primary{background:linear-gradient(135deg,#22c55e,#16a34a);color:#06170e;box-shadow:0 6px 18px rgba(34,197,94,.25)}
.btn.warn{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#001129}
.btn.ghost{background:#050a18;border:1px solid var(--border);color:#fff}
.btn.outline{background:transparent;border:1px solid var(--accent);color:#bcd7ff}
.section{background:#0b1224;border:1px solid var(--border);border-radius:16px;padding:16px;margin-top:16px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
label{font-size:12px;color:var(--muted)}
input,button,select{font:inherit}
input[type=file],input[type=number],select{background:#050a18;border:1px solid var(--border);color:#fff;padding:10px;border-radius:10px}
input[type=number]{width:160px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.chip{background:linear-gradient(180deg,var(--chip),var(--chipb));border:1px solid var(--border);
  padding:8px 12px;border-radius:999px;font-size:12px}
.mono{font-family:ui-monospace, Menlo, Consolas, monospace}
.muted{color:var(--muted)}
.progress{height:14px;border-radius:999px;background:#050a18;border:1px solid var(--border);overflow:hidden}
.bar{height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#3b82f6);transition:width .15s}
.cards{display:grid;grid-template-columns:1fr;gap:12px}
.card{background:#0a1122;border:1px solid #182036;border-radius:12px;padding:12px}
.badge{display:inline-flex;gap:6px;align-items:center;border-radius:999px;padding:4px 8px;font-weight:700;font-size:12px}
.badge.ok{background:rgba(22,163,74,.15);border:1px solid rgba(22,163,74,.35);color:#34d399}
.badge.err{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#fca5a5}
.link{color:#8ab4ff; text-decoration:none}
.link:hover{text-decoration:underline}
.details{font-size:13px;color:#c7d2fe}
</style>
</head>
<body>
  <div class="wrap">
    <div class="top-actions">
      <button id="btnErr" class="btn outline" disabled>Baixar erros.csv</button>
    </div>

    <h1>Downloader de Vídeos (MP4) via Planilha</h1>
    <p>Envie <span class="mono">.xlsx/.xls</span> ou <span class="mono">.csv</span> com a coluna <span class="mono">URL</span>. O servidor baixa cada link, converte para <strong>.mp4</strong>, numera sem repetir e entrega um <strong>ZIP</strong>.</p>

    <div class="section">
      <div class="row">
        <div style="flex:1 1 320px">
          <label>Arquivo da planilha</label><br/>
          <input id="file" type="file" accept=".xlsx,.xls,.csv"/>
        </div>
        <div>
          <label>Concorrência</label><br/>
          <input id="conc" type="number" min="1" max="6" value="3"/>
        </div>
        <div>
          <label>Iniciar numeração em</label><br/>
          <input id="startFrom" type="number" min="1" value="1"/>
        </div>
        <div class="row" style="gap:10px">
          <button id="btnStart" class="btn primary">Iniciar</button>
          <button id="btnReset" class="btn ghost">Resetar contador</button>
          <button id="btnDownload" class="btn warn" disabled>Baixar ZIP</button>
        </div>
      </div>

      <div class="chips">
        <div class="chip">Próximo número global: <span id="next" class="mono">—</span></div>
        <div class="chip">Job: <span id="job" class="mono">—</span></div>
        <div class="chip">Total: <span id="sTotal" class="mono">0</span></div>
        <div class="chip">Sucesso: <span id="sOk" class="mono">0</span></div>
        <div class="chip">Erros: <span id="sErr" class="mono">0</span></div>
      </div>

      <div class="progress" style="margin-top:12px"><div id="bar" class="bar"></div></div>
    </div>

    <div class="section">
      <div class="row" style="align-items:center;gap:10px">
        <div style="flex:1">
          <label>Caixa suspensa (último item aparece e atualiza em tempo real)</label><br/>
          <select id="ddl" style="width:100%">
            <option value="">Aguardando processamento...</option>
          </select>
        </div>
        <div>
          <button id="btnOpenUrl" class="btn ghost">Abrir URL selecionada</button>
        </div>
      </div>

      <div class="cards" style="margin-top:12px">
        <div class="card">
          <div id="statusBadge" class="badge neut">—</div>
          <div id="itemTitle" class="details" style="margin-top:6px">Nenhum item selecionado.</div>
          <div id="itemUrl" style="margin-top:6px"><a id="itemUrlLink" href="#" class="link" target="_blank" rel="noopener"></a></div>
          <div id="itemReason" class="details" style="margin-top:6px"></div>
        </div>
      </div>
    </div>
  </div>

<script>
var $ = function(id){ return document.getElementById(id); };
var bar = $('bar'), ddl = $('ddl');
var JOB=null, source=null, lastErrorsCSV=null;

function setPct(p){ bar.style.width = Math.max(0,Math.min(100,p))+'%'; }

async function getStatus(){
  var r = await fetch('/status'); var j = await r.json();
  $('next').textContent = j.next;
  $('startFrom').value = j.next;
}
getStatus();

$('btnReset').onclick = async function(){
  if(!confirm('Resetar contador global para 1?')) return;
  await fetch('/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  await getStatus();
};

function setCard(ok, num, url, reason){
  var badge = $('statusBadge'); var title = $('itemTitle'); var a = $('itemUrlLink'); var rsn = $('itemReason');
  badge.className = 'badge ' + (ok ? 'ok' : 'err');
  badge.textContent = ok ? '✅ OK' : '❌ ERRO';
  title.textContent = 'Vídeo nº ' + num;
  a.textContent = url; a.href = url || '#';
  rsn.textContent = ok ? '' : ('Motivo: ' + (reason || '—'));
}

function addToDropdown(item){
  var num = item.num, ok = item.ok, url = item.url, reason = item.reason || '';
  var opt = document.createElement('option');
  opt.value = num;
  var host = '';
  try { host = new URL(url).host; } catch(e){}
  opt.textContent = num + ' — ' + (ok ? '✅ OK' : '❌ ERRO') + ' — ' + (host || url);
  opt.setAttribute('data-ok', ok ? '1' : '0');
  opt.setAttribute('data-url', url || '');
  if(reason) opt.setAttribute('data-reason', reason);
  ddl.insertBefore(opt, ddl.firstChild);
  ddl.selectedIndex = 0;
  setCard(ok, num, url, reason);
}

ddl.addEventListener('change', function(){
  var selectedNum = ddl.value; if(!selectedNum) return;
  var opt = Array.from(ddl.options).find(function(o){ return o.value===selectedNum; });
  if(!opt) return;
  var ok = opt.getAttribute('data-ok') === '1';
  var url = opt.getAttribute('data-url') || '';
  var reason = opt.getAttribute('data-reason') || '';
  setCard(ok, selectedNum, url, reason);
});

$('btnOpenUrl').onclick = function(){
  var selectedNum = ddl.value; if(!selectedNum) return;
  var opt = Array.from(ddl.options).find(function(o){ return o.value===selectedNum; });
  if(!opt) return;
  var url = opt.getAttribute('data-url') || '';
  if(url) window.open(url, '_blank', 'noopener');
};

$('btnStart').onclick = async function(){
  var f = $('file').files[0]; if(!f){ alert('Selecione a planilha.'); return; }
  var conc = Math.max(1, Math.min(6, parseInt(($('conc').value||'3'),10)));
  var startFrom = Math.max(1, parseInt(($('startFrom').value||'1'),10));

  $('btnStart').disabled = true; $('btnDownload').disabled = true; $('btnErr').disabled = true;
  $('sTotal').textContent='0'; $('sOk').textContent='0'; $('sErr').textContent='0'; setPct(0);
  ddl.innerHTML = '<option value=\"\">Processando...</option>';

  var fd = new FormData(); fd.append('file', f); fd.append('concurrency', String(conc)); fd.append('startFrom', String(startFrom));
  var res = await fetch('/start',{method:'POST',body:fd});
  if(!res.ok){ alert(await res.text()); $('btnStart').disabled=false; return; }
  var j = await res.json(); JOB = j.jobId; $('job').textContent = JOB;

  // SSE
  source = new EventSource('/events?job='+encodeURIComponent(JOB));
  source.onmessage = function(e){
    try{
      var d = JSON.parse(e.data);
      if(d.type==='meta'){ $('sTotal').textContent = d.total; }
      if(d.type==='progress'){
        $('sOk').textContent = d.ok; $('sErr').textContent = d.err;
        setPct(Math.round(100 * (d.ok + d.err) / Math.max(1,d.total)));
        if (d.item){ addToDropdown(d.item); }
      }
      if(d.type==='done'){
        setPct(100);
        $('btnDownload').disabled = !d.ready;
        $('btnErr').disabled = d.err === 0;
        lastErrorsCSV = d.err > 0 ? '/errors?job='+encodeURIComponent(JOB) : null;
        source.close();
        getStatus();
        $('btnStart').disabled = false;
      }
    }catch(_){}
  };
};

$('btnDownload').onclick = function(){ if(!JOB) return; window.location.href = '/download?job='+encodeURIComponent(JOB); };
$('btnErr').onclick = function(){ if(!lastErrorsCSV) return; window.location.href = lastErrorsCSV; };
</script>
</body></html>`;

/* ---------------- Utils ---------------- */
async function ensureDir(p){ await fsp.mkdir(p,{ recursive:true }); }
function zeroPad(n,w){ const s=String(n); return s.length>=w?s:'0'.repeat(w-s.length)+s; }
function sanitize(s){ return String(s||'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim(); }
function normPath(p){ return p.replace(/\\/g,'/'); }

/* ---------------- Counter persistente + LOCK ---------------- */
async function ensureCounter(){
  try{ await fsp.access(COUNTER_FILE, fs.constants.F_OK); }
  catch{ await fsp.writeFile(COUNTER_FILE, JSON.stringify({ next:1 }, null, 2)); }
}
async function readNext(){ await ensureCounter(); const raw=await fsp.readFile(COUNTER_FILE,'utf8'); const d=JSON.parse(raw||'{}'); const n=Number(d.next); return Number.isFinite(n)&&n>0?n:1; }
async function writeNext(n){ await fsp.writeFile(COUNTER_FILE, JSON.stringify({ next:n }, null, 2)); }

// Fila/lock simples para operações no contador (evita corrida entre jobs simultâneos)
let counterLock = Promise.resolve();
async function reserveBlock(count, desiredStart) {
  let start = 1;
  await (counterLock = counterLock.then(async ()=>{
    await ensureCounter();
    if (Number.isFinite(desiredStart) && desiredStart > 0) {
      await writeNext(desiredStart);
    }
    const s = await readNext();
    await writeNext(s + count);
    start = s;
  }));
  return start;
}

/* ---------------- Planilha -> URLs ---------------- */
function extractUrlsFromCSV(buffer){
  const text=buffer.toString('utf8');
  const parsed=Papa.parse(text,{ header:true, skipEmptyLines:true });
  if(!parsed.data?.length) return [];
  const headers=parsed.meta.fields||[];
  const urlKey=headers.find(h=>String(h).trim().toLowerCase()==='url');
  if(!urlKey) return [];
  const out=[];
  for(const row of parsed.data){
    const raw=((row[urlKey]??'')+'').trim(); if(!raw) continue;
    const parts=raw.split(/[\s\r\n\t]+/).filter(Boolean);
    for(const p of parts){ try{ const u=new URL(p); if(/^https?:$/i.test(u.protocol)) out.push(u.toString()); }catch{} }
  }
  return out;
}
function extractUrlsFromWorkbook(buffer){
  const wb=XLSX.read(buffer,{ type:'buffer' });
  const urls=[];
  for(const sheetName of wb.SheetNames){
    const ws=wb.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json(ws,{ defval:'' });
    if(!rows.length) continue;
    const keys=Object.keys(rows[0]||{});
    const urlKey=keys.find(k=>String(k).trim().toLowerCase()==='url');
    if(!urlKey) continue;
    for(const row of rows){
      const raw=(row[urlKey]??'').toString().trim(); if(!raw) continue;
      const parts=raw.split(/[\s\r\n\t]+/).filter(Boolean);
      for(const p of parts){ try{ const u=new URL(p); if(/^https?:$/i.test(u.protocol)) urls.push(u.toString()); }catch{} }
    }
  }
  return urls;
}
function isCSV(filename, mimetype){
  return /\.csv$/i.test(filename||'') || (mimetype && mimetype.toLowerCase().includes('text/csv'));
}

/* ---------------- Fetch com follow redirects ---------------- */
function fetchWithRedirects(url, { maxRedirects = 10, timeoutMs = 60000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method:'GET', headers: { 'User-Agent': USER_AGENT, ...headers }, timeout: timeoutMs },
      res => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if ([301,302,303,307,308].includes(status) && loc && maxRedirects > 0) {
          res.resume();
          const nextUrl = new URL(loc, url).toString();
          return resolve(fetchWithRedirects(nextUrl, { maxRedirects: maxRedirects-1, timeoutMs, headers }));
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve({ status, headers: res.headers, buffer: Buffer.concat(chunks) }));
      }
    );
    req.on('timeout', ()=>req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/* ---------------- yt-dlp (binário baixado automaticamente) ---------------- */
function getYtDlpInfo(){
  const pf=process.platform;
  if(pf==='win32') return { filename:'yt-dlp.exe', url:'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' };
  if(pf==='darwin') return { filename:'yt-dlp_macos', url:'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos' };
  return { filename:'yt-dlp', url:'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp' };
}
async function ensureYtDlp(){
  await ensureDir(BIN_DIR);
  const { filename, url } = getYtDlpInfo();
  const local = path.join(BIN_DIR, filename);
  const exists = await fsp.access(local).then(()=>true).catch(()=>false);
  if(!exists){
    console.log('[yt-dlp] Baixando binário...');
    const r = await fetchWithRedirects(url);
    if(r.status !== 200 || !r.buffer?.length) throw new Error('Falha ao baixar yt-dlp: '+r.status);
    await fsp.writeFile(local, r.buffer, { mode:0o755 });
    console.log('[yt-dlp] Salvo em', local);
  }
  return local;
}

/* ---------------- Download -> MP4 ---------------- */
async function downloadToMp4(url, targetMp4){
  if(!ffmpegPath) throw new Error('ffmpeg-static não encontrado. Instale: npm i ffmpeg-static');
  const ytdlp = await ensureYtDlp();
  await ensureDir(path.dirname(targetMp4));
  const outPath = path.resolve(targetMp4).replace(/\\/g,'/');

  const args = [
    '--no-playlist',
    '-f','bv*+ba/b',
    '--merge-output-format','mp4',
    '--recode-video','mp4',
    '--ffmpeg-location', ffmpegPath,
    '--user-agent', USER_AGENT,
    '--add-header', 'Referer: ' + url,
    '-o', outPath,
    url
  ];

  await new Promise((resolve,reject)=>{
    const p = spawn(ytdlp, args, { stdio:['ignore','pipe','pipe'] });
    let err=''; p.stderr.on('data',d=>err+=d.toString());
    p.on('error',reject); p.on('close', c => c===0?resolve():reject(new Error('yt-dlp exit '+c+': '+err)));
  });
  await fsp.access(targetMp4, fs.constants.F_OK);
  return targetMp4;
}

/* ---------------- Concurrency limiter ---------------- */
function pLimit(limit){
  let active=0; const q=[];
  const next=()=>{
    if(!q.length || active>=limit) return;
    const { fn, resolve, reject } = q.shift();
    active++;
    Promise.resolve().then(fn).then(resolve, reject).finally(()=>{ active--; next(); });
  };
  return (fn)=> new Promise((resolve,reject)=>{ q.push({fn,resolve,reject}); process.nextTick(next); next(); });
}

/* ---------------- Jobs + SSE ---------------- */
const JOBS = new Map(); // jobId -> { total, ok, err, errors[], status, zipPath, emitter }
function createJob(){
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const emitter = new EventEmitter();
  JOBS.set(id, { total:0, ok:0, err:0, errors:[], status:'pending', zipPath:null, emitter });
  return { id, job: JOBS.get(id) };
}

/* ---------------- App / Rotas ---------------- */
const app = express();
const uploadPlan = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_MB*1024*1024 } });

// UI
app.get('/', (_req,res)=>{ res.setHeader('Content-Type','text/html; charset=utf-8'); res.send(HTML); });

// Status / Reset
app.get('/status', async (_req,res)=> res.json({ next: await readNext() }));
app.post('/reset', express.json({limit:'10kb'}), async (_req,res)=>{ await writeNext(1); res.json({ ok:true }); });

// SSE de eventos
app.get('/events', (req,res)=>{
  const id = (req.query.job||'').toString();
  const info = JOBS.get(id);
  if(!id || !info){ res.status(404).end(); return; }
  res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
  const send = (obj)=> res.write('data: ' + JSON.stringify(obj) + '\n\n');
  send({ type:'meta', total: info.total });
  const onProgress = (payload)=> send({ type:'progress', ...payload });
  const onDone = (payload)=> { send({ type:'done', ...payload }); };
  info.emitter.on('progress', onProgress);
  info.emitter.once('done', onDone);
  req.on('close', ()=>{ info.emitter.off('progress', onProgress); });
});

// Inicia processamento (reserva BLOCO de numeração)
app.post('/start', uploadPlan.single('file'), async (req,res)=>{
  try{
    if(!req.file) return res.status(400).send('Arquivo não enviado');
    const conc = Math.min(MAX_CONCURRENCY, Math.max(1, parseInt(req.body.concurrency||'3',10)));
    const desiredStart = parseInt(req.body.startFrom || '0', 10);

    const { originalname, mimetype, buffer } = req.file;
    let urls=[]; if(isCSV(originalname, mimetype)) urls = extractUrlsFromCSV(buffer); else urls = extractUrlsFromWorkbook(buffer);
    if(!urls.length) return res.status(400).send('Nenhuma URL encontrada. Confirme a coluna "URL".');

    // Reserva bloco atômico (aplica "iniciar em" dentro do lock)
    const startBase = await reserveBlock(urls.length, Number.isFinite(desiredStart) && desiredStart>0 ? desiredStart : undefined);

    const { id, job } = createJob();
    job.total = urls.length;
    job.status = 'running';
    job.emitter.emit('progress', { ok:0, err:0, total:job.total });

    (async ()=>{
      const padWidth = Math.max(3, String(startBase + urls.length - 1).length);
      const jobDir = path.join(TMP_ROOT, 'job_' + process.pid + '_' + Date.now());
      await ensureDir(jobDir);
      const zipPath = path.join(jobDir, 'result_' + Date.now() + '.zip');
      const out = fs.createWriteStream(zipPath);
      const archive = Archiver('zip',{ zlib:{ level:9 }});
      archive.pipe(out);

      const limiter = pLimit(conc);
      const tasks = urls.map((url, idx)=> limiter(async ()=>{
        const my = startBase + idx; // número único já reservado
        const num = zeroPad(my, padWidth);
        const tmp = path.join(jobDir, num + '.mp4');
        try{
          await downloadToMp4(url, tmp);
          archive.append(fs.createReadStream(tmp).on('close', async ()=>{ try{ await fsp.rm(tmp,{force:true}); }catch{} }), { name: sanitize(num)+'.mp4' });
          job.ok++;
          job.emitter.emit('progress', { ok:job.ok, err:job.err, total:job.total, item:{ num:num, ok:true, url:url } });
        }catch(e){
          job.err++; job.errors.push({ idx: my, url, reason: e.message||String(e) });
          job.emitter.emit('progress', { ok:job.ok, err:job.err, total:job.total, item:{ num:num, ok:false, url:url, reason: (e.message||String(e)) } });
          try{ await fsp.rm(tmp,{force:true}); }catch{}
        }
      }));

      await Promise.allSettled(tasks);

      // NUNCA adiciona erros.csv ao ZIP — sai só pelo botão /errors
      await archive.finalize();
      await new Promise((r)=> out.on('close', r));
      job.zipPath = zipPath;
      job.status = 'done';
      job.emitter.emit('done', { ready: true, ok: job.ok, err: job.err, total: job.total });
    })().catch(err=>{
      job.status = 'failed';
      job.emitter.emit('done', { ready:false, error: err?.message||String(err), ok: job.ok, err: job.err, total: job.total });
    });

    res.json({ jobId: id, total: job.total });
  }catch(e){
    res.status(500).send('Erro ao iniciar: ' + (e?.message || String(e)));
  }
});

// Baixar ZIP (apenas .mp4)
app.get('/download', async (req,res)=>{
  const id = (req.query.job||'').toString();
  const job = JOBS.get(id);
  if(!job) return res.status(404).send('Job não encontrado');
  if(job.status!=='done' || !job.zipPath) return res.status(409).send('Ainda processando');
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=videos_' + new Date().toISOString().replace(/[:.]/g,'-') + '.zip');
  fs.createReadStream(job.zipPath).pipe(res);
});

// Exportar erros.csv (fora do ZIP)
app.get('/errors', async (req,res)=>{
  const id = (req.query.job||'').toString();
  const job = JOBS.get(id);
  if(!job) return res.status(404).send('Job não encontrado');
  if(!job.errors?.length) return res.status(204).end();
  const csv = Papa.unparse([{idx:'idx',url:'url',reason:'reason'}, ...job.errors]);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename=erros.csv');
  res.end(csv);
});

/* ---------------- Boot ---------------- */
app.listen(PORT, async ()=>{
  await ensureDir(TMP_ROOT);
  try { await ensureYtDlp(); } catch(e){ console.error('Falha ao preparar yt-dlp:', e?.message||e); }
  console.log('✅ SaaS online em http://localhost:' + PORT);
});

/* ---------------- Helpers simples ---------------- */
async function readNext(){ await ensureCounter(); const raw=await fsp.readFile(COUNTER_FILE,'utf8'); const d=JSON.parse(raw||'{}'); const n=Number(d.next); return Number.isFinite(n)&&n>0?n:1; }
async function writeNext(n){ await fsp.writeFile(COUNTER_FILE, JSON.stringify({ next:n }, null, 2)); }
async function ensureCounter(){
  try{ await fsp.access(COUNTER_FILE, fs.constants.F_OK); }
  catch{ await fsp.writeFile(COUNTER_FILE, JSON.stringify({ next:1 }, null, 2)); }
}
