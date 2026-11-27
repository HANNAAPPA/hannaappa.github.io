/* 따라 말하기 서버 함수 — 가정경영/gas 에서 자동 생성(build.py). dosa.js 가 Apps Script 를 흉내 내 돌린다 */
function pf_props_(){ return PropertiesService.getScriptProperties(); }
//  'eng_list'     = [{id, yt, title, ch, n}]        영상 목록(n = 문장 수)
//  'eng_s_<id>'   = [[s, e, text], ...]              문장 구간(초). 값 하나당 9KB 한도라 영상별로 나눈다
//  'eng_log'      = {'2026-09-28': 말한 문장 수}      최근 120일만
// ══════════════════════════════════════════════════
function eng_get_(key, def){
  var raw = pf_props_().getProperty(key);
  if (!raw) return def;
  try { return JSON.parse(raw); } catch (e) { return def; }
}
function eng_today_(){ return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }

//  'eng_prog'     = {id: {k:따라 말한 문장 누계, mx:가장 멀리 간 문장, d:마지막 날짜, done:1}}   학습 여부
//  'eng_logv'     = {'2026-09-28': {id: 문장 수}}     영상별 기록(최근 14일)
//  'eng_seedver'  = 씨드 버전(EngSeed.gs)
function eng_data(){
  eng_seed_();
  var list = eng_get_('eng_list', []);
  list.forEach(function(v){ v.segs = eng_get_('eng_s_' + v.id, []); });
  return { videos: list, log: eng_get_('eng_log', {}), logv: eng_get_('eng_logv', {}),
           prog: eng_get_('eng_prog', {}), today: eng_today_(), logm: eng_months_(3) };
}
// 월별 영상별 문장 수 {'2026-09': {영상id: n}} — 'eng_m_YYYY-MM' 로 달마다 따로 저장(값 하나 9KB 한도)
function eng_months_(n){
  var out = {}, d = new Date(eng_today_() + 'T00:00:00+09:00');
  for (var i = 0; i < n; i++){
    var ym = Utilities.formatDate(new Date(d.getFullYear(), d.getMonth() - i, 1), 'Asia/Seoul', 'yyyy-MM');
    out[ym] = eng_get_('eng_m_' + ym, {});
  }
  return out;
}
function eng_month(ym){
  if (!/^\d{4}-\d{2}$/.test(String(ym))) return { error: 'ym' };
  return { ym: ym, m: eng_get_('eng_m_' + ym, {}) };
}

// EngSeed.gs 의 영상을 채운다. 이미 있는 영상은 단계가 비었을 때만 단계를 붙이고,
// 손으로 나눈 문장이 글자 없이 시간만 있으면 자막 버전으로 바꾼다. 화면에서 지운 영상은 다시 안 깔린다(버전 키)
function eng_seed_(){
  var P = pf_props_();
  if (Number(P.getProperty('eng_seedver')) >= ENG_SEED_VER) return;
  var list = eng_get_('eng_list', []), put = {}, t0 = new Date().getTime();
  ENG_SEED.forEach(function(s, i){
    var have = null;
    list.forEach(function(v){ if (v.yt === s.yt) have = v; });
    if (!have){
      if (list.length >= 60) return;
      have = { id: 's' + s.yt.replace(/[^A-Za-z0-9]/g, ''), yt: s.yt, title: s.title, ch: s.ch, n: 0, stage: s.stage };
      list.push(have);
      put['eng_s_' + have.id] = JSON.stringify(s.segs);
      have.n = s.segs.length;
    } else {
      if (have.stage == null) have.stage = s.stage;
      var cur = eng_get_('eng_s_' + have.id, []);
      var hasText = cur.some(function(q){ return q[2]; });
      if (!hasText){ put['eng_s_' + have.id] = JSON.stringify(s.segs); have.n = s.segs.length; }
    }
    have.m = s.m; have.note = s.note;
  });
  put.eng_list = JSON.stringify(list);
  put.eng_seedver = String(ENG_SEED_VER);
  P.setProperties(put, false);
}

// 유튜브 주소 → 11자리 영상 ID. 이상한 값은 받지 않는다
function eng_ytId_(url){
  var s = (url || '').toString().trim();
  var m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

function eng_addVideo(url, stage){
  var yt = eng_ytId_(url);
  if (!yt) return { error: '유튜브 주소를 확인해 주세요' };
  var list = eng_get_('eng_list', []);
  if (list.some(function(v){ return v.yt === yt; })) return { error: '이미 있는 영상이에요' };
  if (list.length >= 60) return { error: '영상은 60개까지예요. 안 보는 영상을 지워 주세요' };
  var title = yt, ch = '';
  try {
    var r = UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url='
              + encodeURIComponent('https://www.youtube.com/watch?v=' + yt), { muteHttpExceptions:true });
    if (r.getResponseCode() !== 200) return { error: '영상을 찾을 수 없어요(비공개·삭제·퍼가기 금지일 수 있어요)' };
    var j = JSON.parse(r.getContentText());
    title = (j.title || yt).toString().slice(0, 120);
    ch = (j.author_name || '').toString().slice(0, 60);
  } catch (e) {}
  var st = Number(stage);
  var v = { id: 'v' + new Date().getTime(), yt: yt, title: title, ch: ch, n: 0,
            stage: (stage != null && stage !== '' && st >= 0 && st <= 5) ? st : null };
  // 챱(문장 나누기)은 자동 — 자막이 있으면 여기서 바로 나눠 저장한다. 없으면 화면에서 손으로
  try {
    var cs = eng_cues_(yt);
    var segs = eng_chop_(cs.cues);
    if (segs.length){
      var js = JSON.stringify(segs.slice(0, 150));
      if (js.length <= 8500){
        pf_props_().setProperty('eng_s_' + v.id, js);
        v.n = Math.min(150, segs.length); v.m = eng_metrics_(segs, cs.sec);
      }
    }
  } catch (e) {}
  list.unshift(v);
  pf_props_().setProperty('eng_list', JSON.stringify(list));
  return eng_data();
}

function eng_delVideo(id){
  var list = eng_get_('eng_list', []).filter(function(v){ return v.id !== id; });
  pf_props_().setProperty('eng_list', JSON.stringify(list));
  pf_props_().deleteProperty('eng_s_' + id);
  var pr = eng_get_('eng_prog', {}); delete pr[id];
  pf_props_().setProperty('eng_prog', JSON.stringify(pr));
  return eng_data();
}

// 로드맵 단계 배정/변경. stage 는 0~5 정수, null 이면 미배정으로 되돌린다
function eng_setStage(id, stage){
  var list = eng_get_('eng_list', []);
  var v = null;
  list.forEach(function(x){ if (x.id === id) v = x; });
  if (!v) return { error: '영상이 없어요' };
  var st = Number(stage);
  v.stage = (stage != null && stage !== '' && st >= 0 && st <= 5) ? st : null;
  pf_props_().setProperty('eng_list', JSON.stringify(list));
  return eng_data();
}

function eng_saveSegs(id, segs){
  var list = eng_get_('eng_list', []);
  var v = null;
  list.forEach(function(x){ if (x.id === id) v = x; });
  if (!v) return { error: '영상이 없어요' };
  var clean = [];
  (Array.isArray(segs) ? segs : []).forEach(function(q){
    var s = Math.round(Number(q[0]) * 10) / 10, e = Math.round(Number(q[1]) * 10) / 10;
    if (!(s >= 0) || !(e > s) || e - s > 60) return;
    clean.push([s, e, (q[2] || '').toString().replace(/[<>]/g, '').slice(0, 160)]);
  });
  clean.sort(function(a, b){ return a[0] - b[0]; });
  var js = JSON.stringify(clean);
  if (clean.length > 150 || js.length > 8500) return { error: '문장이 너무 많아요. 영상을 나눠서 등록해 주세요' };
  pf_props_().setProperty('eng_s_' + id, js);
  v.n = clean.length;
  pf_props_().setProperty('eng_list', JSON.stringify(list));
  return eng_data();
}

// 챱 자동: 유튜브 자막으로 문장 구간을 나눠 바로 저장한다. 화면에서는 고치기만 하면 된다.
// (공식 API 아님 — 안드로이드 앱이 쓰는 player 엔드포인트로 자막 트랙을 받는다)
function eng_autoSegs(id){
  var list = eng_get_('eng_list', []);
  var v = null;
  list.forEach(function(x){ if (x.id === id) v = x; });
  if (!v) return { error: '영상이 없어요' };
  var cs;
  try { cs = eng_cues_(v.yt); } catch (e) { return { error: '자막을 못 읽었어요: ' + e.message }; }
  if (!cs.cues.length){
    // 구글 서버 IP 는 유튜브가 「로봇이 아닌지 확인」으로 막는 일이 많다(2026-09 확인). 씨드 영상은 PC 에서 미리 나눠 둔 것
    if ((cs.why || '').indexOf('LOGIN_REQUIRED') >= 0) return { error: '유튜브가 자동 자막 읽기를 막았어요. 이 영상은 Claude 에게 「챱 해줘」라고 하거나, 아래 ✂ 로 나눠 주세요' };
    return { error: '이 영상엔 영어 자막이 없어요. ✂ 로 손으로 나눠 주세요' };
  }
  var segs = eng_chop_(cs.cues);
  if (!segs.length) return { error: '문장을 못 나눴어요. ✂ 로 손으로 나눠 주세요' };
  segs = segs.slice(0, 150);
  var js = JSON.stringify(segs);
  if (js.length > 8500) return { error: '문장이 너무 길어요. 영상을 나눠서 등록해 주세요' };
  pf_props_().setProperty('eng_s_' + id, js);
  v.n = segs.length; v.m = eng_metrics_(segs, cs.sec);
  pf_props_().setProperty('eng_list', JSON.stringify(list));
  var d = eng_data(); d.auto = segs.length;
  return d;
}

// 영어 자막 큐 [{s,d,t}] 와 영상 길이(초). 사람이 올린 자막이 있으면 그걸 먼저 쓴다
function eng_cues_(yt){
  var body = JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 } }, videoId: yt });
  var r = UrlFetchApp.fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
    headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' } });
  var j = JSON.parse(r.getContentText());
  var sec = Number((j.videoDetails || {}).lengthSeconds) || 0;
  var why = r.getResponseCode() + ' ' + ((j.playabilityStatus || {}).status || '?') + ' ' + ((j.playabilityStatus || {}).reason || '').slice(0, 60);
  var tr = (((j.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []).filter(function(t){
    return (t.languageCode || '').indexOf('en') === 0; });
  tr.sort(function(a, b){ return (a.kind ? 1 : 0) - (b.kind ? 1 : 0); });
  if (!tr.length) return { cues: [], sec: sec, why: why + ' tracks=0' };
  var xr = UrlFetchApp.fetch(tr[0].baseUrl, { muteHttpExceptions: true }), x = xr.getContentText();
  return { cues: eng_parseTt_(x), sec: sec, auto: !!tr[0].kind, why: why + ' tt=' + xr.getResponseCode() + '/' + x.length };
}
// <p t="6940" d="3000">…</p> (밀리초). 자동자막의 <s> 조각은 태그만 걷어낸다
function eng_parseTt_(xml){
  var out = [], re = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g, m;
  while ((m = re.exec(xml))){
    var t = m[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(Number(n)); });
    out.push({ s: Number(m[1]) / 1000, d: (Number(m[2]) || 2000) / 1000, t: t });
  }
  return out;
}
// (박수 소리)·[Music]·*Roar!*·NARRATOR: 같은 표시를 걷어낸다
function eng_clean_(t){
  return (t || '').replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]*\*|[♪♫]/g, ' ')
    .replace(/^\s*-\s*|\s+-\s*(?=[A-Z])/g, ' ').replace(/\b[A-Z]{3,}:\s*/g, '').replace(/\s+/g, ' ').replace(/\s*-+$/, '').trim();
}
// 자막 줄을 문장 구간으로 묶는다. 줄이 문장 중간에서 끊겼을 때(쉼표·마침표 없이 소문자로 이어짐)만 붙이고
// 12단어를 넘기지 않는다. 끝은 0.3초 여유를 둔다(PC 에서 문장 끝소리가 잘리던 문제)
function eng_chop_(cues){
  var segs = [], buf = null;
  function flush(){ if (buf && buf.t) segs.push([Math.round(buf.s * 10) / 10, Math.round((buf.e + 0.3) * 10) / 10, buf.t.slice(0, 160)]); buf = null; }
  cues.forEach(function(c){
    var t = eng_clean_(c.t), e = c.s + c.d;
    if (!t || !/[A-Za-z]/.test(t)){ flush(); return; }
    if (!buf) buf = { s: c.s, e: e, t: t };
    else if (c.s - buf.e <= 0.6 && !/[.!?,;:]["')\]]?$/.test(buf.t) && /^[a-z]/.test(t) && (buf.t + ' ' + t).split(' ').length <= 12){
      buf.t += ' ' + t; buf.e = e;
    } else { flush(); buf = { s: c.s, e: e, t: t }; }
  });
  flush();
  for (var i = 0; i < segs.length - 1; i++) if (segs[i][1] > segs[i + 1][0]) segs[i][1] = segs[i + 1][0];
  return segs.filter(function(q){ return q[1] - q[0] >= 0.4 && q[1] - q[0] <= 25; });
}
// 정량 지표: sec 길이 · n 문장 · words 총 단어 · uniq 서로 다른 단어 · wps 말하는 동안 초당 단어 · wpsent 문장당 단어 · rep 반복률
function eng_metrics_(segs, sec){
  var ws = [], speak = 0;
  segs.forEach(function(q){
    speak += q[1] - q[0];
    (q[2].toLowerCase().match(/[a-z']+/g) || []).forEach(function(w){ ws.push(w); });
  });
  var u = {}; ws.forEach(function(w){ u[w] = 1; });
  var uniq = Object.keys(u).length;
  return { sec: sec || 0, n: segs.length, words: ws.length, uniq: uniq,
           wps: Math.round(ws.length / (speak || 1) * 100) / 100,
           wpsent: Math.round(ws.length / Math.max(1, segs.length) * 10) / 10,
           rep: Math.round((1 - uniq / Math.max(1, ws.length)) * 100) / 100 };
}

// 따라 말한 문장 기록. vid·idx·total 을 주면 영상별 진도(학습 여부)도 갱신한다
function eng_logSay(n, vid, idx, total){
  var add = Math.max(0, Math.min(50, Math.round(Number(n) || 0)));
  var P = pf_props_(), log = eng_get_('eng_log', {}), d = eng_today_();
  log[d] = (log[d] || 0) + add;
  var keys = Object.keys(log).sort();
  while (keys.length > 120) delete log[keys.shift()];
  P.setProperty('eng_log', JSON.stringify(log));
  var mk = 'eng_m_' + d.slice(0, 7), mm = eng_get_(mk, {});
  mm[vid || '-'] = (mm[vid || '-'] || 0) + add;
  P.setProperty(mk, JSON.stringify(mm));
  if (vid){
    var lv = eng_get_('eng_logv', {});
    lv[d] = lv[d] || {}; lv[d][vid] = (lv[d][vid] || 0) + add;
    var ks = Object.keys(lv).sort();
    while (ks.length > 14) delete lv[ks.shift()];
    P.setProperty('eng_logv', JSON.stringify(lv));
    var pr = eng_get_('eng_prog', {}), p = pr[vid] || { k: 0, mx: 0 };
    p.k += add; p.mx = Math.max(p.mx, Number(idx) || 0); p.d = d; p.nx = (Number(idx) || 0) + 1;   // nx = 다음에 이어할 문장
    if (Number(total) > 0 && p.mx >= Number(total) - 1 && p.k >= Math.ceil(Number(total) * 0.6)){ p.done = 1; p.nx = 0; }
    pr[vid] = p;
    P.setProperty('eng_prog', JSON.stringify(pr));
  }
  return { log: log, logv: eng_get_('eng_logv', {}), prog: eng_get_('eng_prog', {}), logm: eng_months_(3), today: d };
}

// 학습함 표시를 손으로 켜고 끈다(끄면 진도도 처음부터)
function eng_setDone(id, on){
  var P = pf_props_(), pr = eng_get_('eng_prog', {}), p = pr[id] || { k: 0, mx: 0 };
  if (on) { p.done = 1; p.d = eng_today_(); } else { pr[id] = { k: 0, mx: 0 }; p = null; }
  if (p) pr[id] = p;
  P.setProperty('eng_prog', JSON.stringify(pr));
  return eng_data();
}

// 🗣 아빠표영어 로드맵 씨드 — 영상 30개(단계별·언어 난이도 순). 자막 문장 구간은 미리 나눠 둔 것.
// 값을 바꾸면 ENG_SEED_VER 를 올릴 것(이미 있는 영상은 건드리지 않고 없는 것만 채운다).
var ENG_SEED_VER = 1;
var ENG_SEED = [{"yt":"tVlcKp3bWH8","title":"Hello! | Kids Greeting Song and Feelings Song | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":0,"note":"후렴 \"Hello\" 반복 · 감정 표현 3개뿐이라 첫 영상으로 딱","m":{"sec":79,"n":28,"words":76,"uniq":12,"wps":1.16,"wpsent":2.7,"rep":0.84,"long":1},"segs":[[6.9,10.0,"Hello, hello, hello"],[10.0,11.5,"How are you?"],[11.5,14.5,"Hello, hello, hello"],[14.5,16.2,"How are you?"],[16.2,18.4,"I'm good"],[18.4,20.6,"I'm great"],[20.8,23.2,"I'm wonderful"],[23.2,25.4,"I'm good"],[25.4,27.8,"I'm great"],[27.9,30.6,"I'm wonderful"],[32.3,35.9,"Hello, hello, hello"],[35.9,37.2,"How are you?"],[37.2,40.4,"Hello, hello, hello"],[40.4,41.8,"How are you?"],[41.8,43.9,"I'm tired"],[43.9,46.2,"I'm hungry"],[46.4,48.8,"I'm not so good"],[48.9,50.9,"I'm tired"],[50.9,53.2,"I'm hungry"],[53.5,56.2,"I'm not so good"],[58.0,61.3,"Hello, hello, hello"],[61.3,62.8,"How are you?"],[62.8,65.7,"Hello, hello, hello"],[65.7,67.4,"How are you?"],[67.4,70.4,"Hello, hello, hello"],[70.4,71.9,"How are you?"],[71.9,75.1,"Hello, hello, hello"],[75.1,76.9,"How are you?"]]},{"yt":"PraN5ZoSjiY","title":"Bye Bye Goodbye | Goodbye Song for Kids | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":0,"note":"헤어질 때 손 흔드는 표현 하나만 집중 반복","m":{"sec":121,"n":11,"words":45,"uniq":9,"wps":1.31,"wpsent":4.1,"rep":0.8,"long":1},"segs":[[14.2,18.1,"Bye bye. Goodbye."],[18.2,21.9,"Bye, bye, bye, bye. Goodbye."],[23.6,25.8,"I can clap my hands."],[27.6,29.9,"I can stamp my feet."],[31.6,33.9,"I can clap my hands."],[35.6,38.1,"I can stamp my feet."],[41.2,44.7,"Bye bye. Goodbye."],[44.7,49.2,"Bye, bye, bye, bye. Goodbye."],[49.2,53.0,"Bye bye. Goodbye."],[53.1,56.8,"Bye, bye, bye, bye. Goodbye."],[58.6,60.5,"GOODBYE!"]]},{"yt":"fN1Cyr0ZK9M","title":"Hello Hello! Can You Clap Your Hands? | Original  Kids Song | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":0,"note":"손뼉 치기 동작이 붙은 인사송 · 문장이 매우 짧아요","m":{"sec":92,"n":20,"words":78,"uniq":16,"wps":1.72,"wpsent":3.9,"rep":0.79,"long":1},"segs":[[13.0,15.1,"Hello, hello."],[16.0,18.3,"Can you clap your hands?"],[18.9,21.2,"Hello, hello."],[21.9,24.2,"Can you clap your hands?"],[24.8,27.2,"Can you stretch up high?"],[27.8,29.9,"Can you touch your toes?"],[30.8,32.9,"Can you turn around?"],[33.8,36.1,"Can you say, \"Hello\"?"],[38.4,40.6,"Hello, hello."],[41.2,43.5,"Can you stamp your feet?"],[44.1,46.4,"Hello, hello."],[47.1,49.4,"Can you stamp your feet?"],[50.0,52.7,"Can you stretch up high?"],[53.0,55.3,"Can you touch your toes?"],[55.9,58.2,"Can you turn around?"],[58.8,61.1,"Can you say, \"Hello\"?"],[63.6,65.6,"Hello, hello."],[66.3,68.6,"Can you clap your hands?"],[69.3,71.5,"Hello, hello."],[72.2,74.5,"Can you stamp your feet?"]]},{"yt":"03XgDWozJOw","title":"How are you? I'm fine. (Greeting song) - English song for Kids - Exciting song","ch":"English Singsing","stage":0,"note":"How are you? / I'm fine 한 쌍만 반복 · 대답까지 익히기","m":{"sec":83,"n":12,"words":54,"uniq":14,"wps":1.97,"wpsent":4.5,"rep":0.74,"long":3},"segs":[[4.8,6.9,"Good morning. Good morning."],[6.9,9.1,"Good morning. How are you?"],[9.1,12.3,"I'm fine. I'm fine. I'm fine."],[12.3,14.3,"Thank you."],[14.3,15.9,"Good afternoon. Good afternoon."],[15.9,17.8,"Good afternoon. How are you?"],[17.8,20.7,"I'm not good. I'm not good. I'm not good."],[20.7,22.4,"Oh, no."],[26.6,28.8,"Good evening. Good evening."],[28.8,30.9,"Good evening. How are you?"],[30.9,34.1,"I'm great. I'm great. I'm great."],[34.1,36.4,"Thank you."]]},{"yt":"Ann91TPhOxc","title":"Good Morning It's Such A Beautiful Day | Preschool Songs | Noodle & Pals","ch":"Noodle & Pals","stage":0,"note":"아침 인사 + 날씨 · 인사송 중 가장 어휘가 많아 마지막에","m":{"sec":112,"n":31,"words":125,"uniq":30,"wps":1.67,"wpsent":4.0,"rep":0.76,"long":5},"segs":[[14.2,15.8,"Good morning"],[15.8,17.6,"Good morning"],[17.6,21.2,"It's such a beautiful day"],[21.2,23.0,"Good morning"],[23.0,24.8,"Good morning"],[24.8,28.6,"It's such a beautiful day"],[28.6,30.4,"The sun is up"],[30.4,32.2,"The birds are singing"],[32.2,35.8,"The grass is green and the sky is blue"],[35.8,37.7,"The flowers bloom"],[37.7,39.4,"The trees are swaying"],[39.4,43.5,"I want to spend this beautiful day with you"],[49.8,51.4,"Good morning"],[51.4,53.1,"Good morning"],[53.1,56.8,"It's such a beautiful day"],[56.8,58.5,"Good morning"],[58.5,60.3,"Good morning"],[60.3,64.1,"It's such a beautiful day"],[64.1,66.0,"The sun is up"],[66.0,67.7,"The birds are singing"],[67.7,71.3,"The grass is green and the sky is blue"],[71.3,73.0,"The flowers bloom"],[73.0,74.8,"The trees are swaying"],[74.8,79.0,"I want to spend this beautiful day with you"],[85.5,86.9,"Good morning"],[86.9,88.7,"Good morning"],[88.7,90.8,"It's such a beautiful"],[90.8,92.6,"Such a beautiful"],[92.6,94.4,"Such a beautiful"],[94.4,97.8,"Such a beautiful day"],[100.4,104.4,"It's such a beautiful day"]]},{"yt":"-iMGSD_35pM","title":"Stand Up Sit Down | Preschool Song | Noodle & Pals","ch":"Noodle & Pals","stage":1,"note":"Stand up / Sit down 두 동작만 · 몸으로 반응하기 쉬움","m":{"sec":134,"n":41,"words":116,"uniq":15,"wps":1.2,"wpsent":2.8,"rep":0.87,"long":0},"segs":[[17.8,20.1,"Up, up, up"],[20.1,22.5,"Down, down, down"],[22.5,25.1,"Up, up, up"],[25.1,27.5,"Down, down, down"],[27.5,30.1,"Up, up, up"],[30.1,32.4,"Down, down, down"],[32.4,34.5,"Up, up, up"],[34.5,38.9,"Down, down, down"],[38.9,41.3,"Stand up"],[41.3,43.8,"Sit down"],[43.8,46.2,"Stand up"],[46.2,49.0,"And spin around"],[49.0,51.9,"Now sit down"],[56.4,60.7,"Let's try it faster."],[60.7,62.7,"Up, up, up"],[62.7,64.7,"Down, down, down"],[64.7,66.6,"Up, up, up"],[66.6,68.7,"Down, down, down"],[68.7,70.5,"Up, up, up"],[70.5,72.6,"Down, down, down"],[72.6,74.6,"Up, up, up"],[74.6,78.1,"Down, down, down"],[78.1,80.2,"Stand up"],[80.2,82.1,"Sit down"],[82.1,84.3,"Stand up"],[84.3,86.7,"And spin around"],[86.7,89.6,"Now sit down"],[92.6,96.4,"Let's go really fast."],[96.4,98.0,"Up, up, up"],[98.0,99.8,"Down, down, down"],[99.8,101.3,"Up, up, up"],[101.3,103.3,"Down, down, down"],[103.3,104.7,"Up, up, up"],[104.7,106.5,"Down, down, down"],[106.5,108.4,"Up, up, up"],[108.4,111.3,"Down, down, down"],[111.3,113.1,"Stand up"],[113.1,114.8,"Sit down"],[114.8,116.7,"Stand up"],[116.7,118.7,"And spin around"],[118.7,121.6,"Now sit down"]]},{"yt":"ZanHgPprl-0","title":"Head Shoulders Knees & Toes (Sing It) | Follow Along | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":1,"note":"몸 부위 이름 · 아빠가 먼저 짚어 주며 따라 하기 좋은 짧은 버전","m":{"sec":61,"n":9,"words":67,"uniq":12,"wps":1.64,"wpsent":7.4,"rep":0.82,"long":1},"segs":[[7.2,12.3,"Head, shoulders, knees, and toes Knees and toes"],[12.3,17.2,"Head, shoulders, knees, and toes Knees and toes, and"],[17.2,21.8,"Eyes and ears and mouth and nose"],[21.8,26.9,"Head, shoulders, knees, and toes Knees and toes"],[29.1,31.3,"One more time"],[31.5,36.3,"Head, shoulders, knees, and toes Knees and toes"],[36.3,41.1,"Head, shoulders, knees, and toes Knees and toes, and"],[41.2,45.8,"Eyes and ears and mouth and nose"],[46.0,50.7,"Head, shoulders, knees, and toes Knees and toes"]]},{"yt":"RuqvGiZi0qg","title":"Head Shoulders Knees And Toes | Noodle & Pals | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":1,"note":"같은 후렴이 계속 돌아와 아이가 자연스럽게 외움","m":{"sec":106,"n":16,"words":128,"uniq":9,"wps":1.63,"wpsent":8.0,"rep":0.93,"long":1},"segs":[[9.4,14.2,"Head, shoulders, knees, and toes, knees and toes"],[14.2,18.4,"Head, shoulders, knees, and toes, knees and toes"],[18.4,23.7,"And eyes and ears and mouth and nose"],[23.8,29.1,"Head, shoulders, knees, and toes, knees and toes"],[33.4,38.2,"Head, shoulders, knees, and toes, knees and toes"],[38.2,42.4,"Head, shoulders, knees, and toes, knees and toes"],[42.4,47.7,"And eyes and ears and mouth and nose"],[47.8,53.1,"Head, shoulders, knees, and toes, knees and toes"],[57.4,62.2,"Head, shoulders, knees, and toes, knees and toes"],[62.2,66.4,"Head, shoulders, knees, and toes, knees and toes"],[66.4,71.7,"And eyes and ears and mouth and nose"],[71.8,77.1,"Head, shoulders, knees, and toes, knees and toes"],[81.5,86.2,"Head, shoulders, knees, and toes, knees and toes"],[86.2,90.4,"Head, shoulders, knees, and toes, knees and toes"],[90.4,95.7,"And eyes and ears and mouth and nose"],[95.8,101.1,"Head, shoulders, knees, and toes, knees and toes"]]},{"yt":"WX8HmogNyCY","title":"Head Shoulders Knees & Toes (Speeding Up) | Nursery Rhyme | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":1,"note":"점점 빨라지는 버전 · 앞 영상에 익숙해진 뒤에","m":{"sec":114,"n":24,"words":163,"uniq":15,"wps":1.88,"wpsent":6.8,"rep":0.91,"long":2},"segs":[[9.8,13.6,"Head, shoulders, knees and toes, knees and toes"],[13.8,18.4,"Head, shoulders, knees and toes, knees and toes"],[18.8,23.4,"Eyes, and ears, and mouth, and nose"],[23.6,28.9,"Head, shoulders, knees and toes, knees and toes"],[28.9,31.5,"Let's try a little faster"],[32.2,37.1,"Head, shoulders, knees and toes, knees and toes"],[37.3,41.9,"Head, shoulders, knees and toes, knees and toes"],[41.9,46.1,"Eyes, and ears, and mouth, and nose"],[46.1,50.0,"Head, shoulders, knees and toes, knees and toes"],[50.4,52.7,"FASTER"],[54.1,58.5,"Head, shoulders, knees and toes, knees and toes"],[58.5,62.3,"Head, shoulders, knees and toes, knees and toes"],[62.3,64.9,"Eyes, and ears, and mouth, and nose"],[64.9,69.0,"Head, shoulders, knees and toes, knees and toes"],[70.3,72.8,"Faaster!"],[73.2,75.6,"Head, shoulders, knees and toes, knees and toes"],[75.6,80.0,"Head, shoulders, knees and toes, knees and toes"],[80.0,82.9,"Eyes, and ears, and mouth, and nose"],[82.9,86.4,"Head, shoulders, knees and toes, knees and toes"],[88.0,89.9,"Faaster"],[89.9,93.8,"Head, shoulders, knees and toes, knees and toes"],[93.8,96.6,"Head, shoulders, knees and toes, knees and toes"],[96.6,99.7,"Eyes, and ears, and mouth, and nose"],[99.7,103.1,"Head, shoulders, knees and toes, knees and toes"]]},{"yt":"M6LoRZsHMSs","title":"If You’re Happy And You Know It | Kids Songs | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":1,"note":"박수·발구르기 등 동작 다양 · 가사가 조금 늘어남","m":{"sec":98,"n":26,"words":178,"uniq":22,"wps":2.34,"wpsent":6.8,"rep":0.88,"long":0},"segs":[[12.5,16.3,"If you're happy and you know it, clap your hands"],[16.3,20.1,"If you're happy and you know it, clap your hands"],[20.1,22.1,"If you're happy and you know it"],[22.1,24.0,"Then your face will surely show it"],[24.0,29.3,"If you're happy and you know it, clap your hands"],[32.0,35.9,"If you're happy and you know it, stomp your feet"],[35.9,39.6,"If you're happy and you know it, stomp your feet"],[39.6,41.6,"If you're happy and you know it"],[41.6,43.6,"Then your face will surely show it"],[43.6,48.9,"If you're happy and you know it, stomp your feet"],[51.5,54.2,"If you're happy and you know it, shout hurray"],[54.2,55.3,"Hurray"],[55.3,58.1,"If you're happy and you know it, shout hurray"],[58.1,59.2,"Hurray"],[59.2,61.1,"If you're happy and you know it"],[61.1,63.0,"Then your face will surely show it"],[63.0,65.9,"If you're happy and you know it, shout hurray"],[65.9,71.2,"Hurray"],[71.2,75.7,"If you're happy and you know it, do all three"],[75.7,76.9,"Hurray"],[76.9,81.5,"If you're happy and you know it, do all three"],[81.5,82.6,"Hurray"],[82.6,84.6,"If you're happy and you know it"],[84.6,86.5,"Then your face will surely it"],[86.5,91.3,"If you're happy and you know it, do all three"],[91.3,93.8,"Hurray"]]},{"yt":"jYAWf8Y91hA","title":"I See Something Blue | Colors Song for Children | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":2,"note":"파랑 하나에 집중 · 어휘 10종으로 가장 가벼움","m":{"sec":183,"n":33,"words":88,"uniq":10,"wps":1.29,"wpsent":2.7,"rep":0.89,"long":2},"segs":[[10.8,12.7,"Blue!"],[13.2,15.4,"I see something blue."],[15.4,17.1,"Blue!"],[17.6,20.0,"I see something blue."],[20.0,22.3,"Blue, blue, blue, blue."],[22.3,24.5,"I see something blue."],[24.7,26.7,"Find something blue!"],[46.4,48.2,"Yellow!"],[48.8,51.0,"I see something yellow."],[51.0,52.6,"Yellow!"],[53.0,55.4,"I see something yellow."],[55.4,57.8,"Yellow, yellow."],[57.8,60.2,"I see something yellow."],[60.2,62.1,"Find something yellow!"],[81.9,83.0,"Red!"],[84.4,86.6,"I see something red."],[86.6,87.9,"Red!"],[88.6,91.0,"I see something red."],[91.0,93.2,"Red, red, red, red."],[93.2,95.9,"I see something red."],[95.9,97.9,"Find something red!"],[117.6,119.0,"Purple!"],[119.8,122.1,"I see something purple."],[122.1,123.3,"Purple!"],[124.3,126.6,"I see something purple!"],[126.6,129.0,"Purple, purple."],[129.0,131.4,"I see something purple."],[131.5,133.3,"Find something purple!"],[153.2,154.5,"Blue."],[155.3,157.1,"Yellow."],[157.7,159.3,"Red."],[159.9,161.6,"Purple."],[162.1,166.9,"I see colors everywhere."]]},{"yt":"zxIpA5nF_LY","title":"What's Your Favorite Color? | Kids Songs | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":2,"note":"색깔 이름 여러 개 · 질문-대답 구조 시작","m":{"sec":122,"n":41,"words":161,"uniq":18,"wps":1.6,"wpsent":3.9,"rep":0.89,"long":2},"segs":[[13.0,15.2,"My favorite color's blue"],[15.2,18.0,"How about you, how about you"],[18.0,19.9,"My favorite color's blue"],[19.9,23.2,"How about you, how about you"],[23.2,25.5,"Red"],[25.5,27.4,"My favorite color's red"],[27.4,30.0,"I like red, I like red"],[30.0,31.9,"My favorite color's red"],[31.9,35.3,"I like red, I like red"],[35.3,37.4,"Colors, colors"],[37.4,39.8,"What's your favorite color"],[39.8,42.2,"Colors, colors"],[42.2,44.8,"What's your favorite color"],[44.8,47.0,"Green"],[47.0,48.9,"My favorite color's green"],[48.9,51.5,"I like green, I like green"],[51.5,53.5,"My favorite color's green"],[53.5,56.8,"I like green, I like green"],[56.8,59.0,"Yellow"],[59.0,60.7,"My favorite color's yellow"],[60.7,63.5,"I like yellow, I like yellow"],[63.5,65.4,"My favorite color's yellow"],[65.4,68.6,"I like yellow, I like yellow"],[68.6,71.0,"Colors, colors"],[71.0,73.4,"What's your favorite color"],[73.4,75.7,"Colors, colors"],[75.7,78.5,"What's your favorite color"],[78.5,80.4,"Orange"],[80.4,82.5,"My favorite color's orange"],[82.5,85.2,"I like orange, I like orange"],[85.2,87.1,"My favorite color's orange"],[87.1,90.4,"I like orange, I like orange"],[90.4,92.7,"Purple"],[92.7,94.4,"My favorite color's purple"],[94.4,97.2,"I like purple, I like purple"],[97.2,99.0,"My favorite color's purple"],[99.0,102.5,"I like purple, I like purple"],[102.5,104.5,"Colors, colors"],[104.5,106.9,"What's your favorite color"],[106.9,109.2,"Colors, colors"],[109.2,113.4,"What's your favorite color"]]},{"yt":"AlB6ZNqykXU","title":"I Like To Draw | Colors And Shapes Song | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":2,"note":"색 + 모양 두 가지를 함께 · 그림 그리기 놀이로 연결","m":{"sec":151,"n":26,"words":98,"uniq":22,"wps":1.36,"wpsent":3.8,"rep":0.78,"long":2},"segs":[[3.1,5.7,"\"Super Simple Songs.\""],[15.8,18.5,"I like to draw"],[18.5,21.2,"Let's draw with red"],[21.2,24.5,"Come draw with me"],[24.5,27.7,"Let's draw a square"],[35.4,36.7,"A red square."],[39.8,42.5,"I like to draw"],[42.5,45.2,"Let's draw with green"],[45.2,48.6,"Come draw with me"],[48.6,51.7,"Let's draw a triangle"],[59.3,61.5,"A green triangle."],[63.9,66.5,"I like to draw"],[66.5,69.2,"Let's draw with blue"],[69.2,72.5,"Come draw with me"],[72.5,75.7,"Let's draw a circle"],[83.5,85.3,"A blue circle."],[87.9,90.5,"I like to draw"],[90.5,93.2,"Let's draw with yellow"],[93.2,96.5,"Come draw with me"],[96.5,99.8,"Let's draw a rectangle"],[107.2,109.7,"A yellow rectangle."],[111.9,114.5,"I like to draw"],[114.5,117.2,"Let's draw with pink"],[117.2,120.5,"Come draw with me"],[120.5,123.6,"Let's draw a heart"],[132.0,134.4,"A pink heart."]]},{"yt":"DR-cfDsHCGA","title":"Counting 1-10 Song | Number Songs for Children | The Singing Walrus","ch":"The Singing Walrus - English Songs For Kids","stage":2,"note":"1~10 숫자 · 노래 속도가 조금 빠름","m":{"sec":162,"n":32,"words":180,"uniq":25,"wps":1.55,"wpsent":5.6,"rep":0.86,"long":2},"segs":[[2.4,6.9,"The Singing Walrus. Counting from 1 to 10!"],[21.6,24.2,"One, two, three. One, two, three!"],[24.9,27.8,"Four, five, six. Four, five, six!"],[27.9,29.4,"Seven. Seven!"],[29.4,31.1,"Eight. Eight!"],[31.1,33.6,"Nine and ten. Nine and ten!"],[33.9,36.1,"Do you know"],[36.6,38.8,"how to count?"],[39.7,44.1,"Yes I know how to count!"],[45.6,47.8,"Do you know - do you know?"],[47.8,51.3,"how to count? How to count?"],[51.3,54.0,"Yes, I know! Yes, I know!"],[54.0,57.2,"how to count. How to count!"],[57.2,60.0,"One, two, three. One, two, three."],[60.0,63.0,"Four, five, six. Four, five, six."],[63.0,64.3,"Seven. Seven!"],[64.3,66.0,"Eight. Eight!"],[66.0,68.9,"Nine and ten. Nine and ten!"],[68.9,71.8,"One, two, three. One, two, three!"],[71.8,74.7,"Four, five, six. Four, five, six!"],[74.7,76.2,"Seven. Seven!"],[76.2,77.8,"Eight. Eight!"],[77.8,80.9,"Nine and ten. Nine and ten!"],[86.9,98.1,"One, two, three, four five, six, seven, eight, nine, ten!"],[98.1,103.6,"Can you count from ten to one?"],[104.5,109.2,"I can count from ten to one"],[110.4,112.8,"Can you count - can you count"],[112.8,116.3,"from ten to one? From ten to one?"],[116.6,118.8,"I can count I can count!"],[118.8,121.9,"from ten to one. From ten to one!"],[121.9,133.4,"Ten, nine, eight, seven six, five, four, three, two, one."],[133.4,145.9,"Ten, nine, eight, seven six, five, four, three, two, one"]]},{"yt":"xNw1SSz18Gg","title":"How Many Fingers? | Kids Songs | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":2,"note":"숫자 세기 + 손가락 놀이 · 반복 많음","m":{"sec":182,"n":24,"words":128,"uniq":20,"wps":1.95,"wpsent":5.3,"rep":0.84,"long":2},"segs":[[16.2,19.4,"How many fingers on one hand?"],[19.4,21.6,"How many fingers on one hand?"],[21.6,24.6,"How many fingers on one hand?"],[24.6,27.0,"Let's all count together."],[38.4,41.3,"How many fingers on two hands?"],[41.3,43.8,"How many fingers on two hands?"],[43.8,46.1,"How many fingers on two hands?"],[46.6,49.4,"Let's all count together."],[60.0,63.0,"Clap clap clap your hands."],[65.6,68.5,"Clap clap clap your hands."],[71.0,73.9,"Clap clap clap your hands."],[76.6,78.9,"Clap your hands with me."],[87.4,90.2,"How many toes on one foot?"],[90.2,92.6,"How many toes on one foot?"],[93.0,95.7,"How many toes on one foot?"],[95.8,98.2,"Let's all count together."],[109.3,112.0,"How many toes on two feet?"],[112.0,114.7,"How many toes on two feet?"],[114.7,117.6,"How many toes on two feet?"],[117.6,120.5,"Let's all count together."],[130.7,133.9,"Stomp stomp stomp your feet."],[136.6,139.5,"Stomp stomp stomp your feet."],[141.8,144.9,"Stomp stomp stomp your feet."],[147.4,149.9,"Stomp your feet with me."]]},{"yt":"zXEq-QO3xTg","title":"The Animals On The Farm | Animals and Farm Song for Kids | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":2,"note":"동물 + 울음소리 · 어휘가 가장 많아 2단계 마지막","m":{"sec":204,"n":29,"words":213,"uniq":33,"wps":1.95,"wpsent":7.3,"rep":0.85,"long":2},"segs":[[14.7,18.1,"The ducks on the farm say, \"Quack, quack quack.\""],[20.4,24.2,"The mice on the farm say, \"Squeak, squeak, squeak.\""],[26.6,30.2,"The chickens on the farm say, \"Cluck, cluck, cluck.\""],[32.8,37.4,"\"Quack. Squeak. Cluck.\""],[44.3,48.4,"The pigs on the farm say, \"Oink, oink, oink.\""],[50.3,54.2,"The goats on the farm say \"Meh, meh, meh.\""],[56.6,60.3,"The sheep on the farm say \"Baa, baa, baa.\""],[63.0,67.3,"\"Oink. Meh. Baa.\""],[74.3,78.2,"The horses on the farm say, \"Neigh, neigh, neigh.\""],[80.4,84.3,"The cows on the farm say, \"Moo, moo, moo.\""],[86.6,90.3,"The roosters on the farm say, \"Cock-a-doodle-doo.\""],[92.8,98.6,"\"Neigh. Moo. Cock-a-doodle-doo.\""],[98.8,104.8,"\"Neigh. Moo. Cock-a-doodle-doo.\""],[106.2,109.7,"Let's try it a little faster."],[110.0,113.3,"The ducks on the farm say, \"Quack, quack, quack.\""],[115.1,118.5,"The mice on the farm say, \"Squeak, squeak, squeak.\""],[120.3,123.7,"The chickens on the farm say, \"Cluck, cluck, cluck.\""],[126.0,129.8,"\"Quack. Squeak. Cluck.\""],[130.8,134.0,"Okay, a little faster."],[135.0,137.9,"The pigs on the farm say, \"Oink, oink, oink.\""],[139.5,142.6,"The goats on the farm say \"Meh, meh, meh.\""],[143.9,147.2,"The sheep on the farm say \"Baa, baa, baa.\""],[148.6,152.1,"\"Oink. Meh. Baa.\""],[153.3,156.5,"Okay, super fast!"],[156.7,159.7,"The horses on the farm say, \"Neigh, neigh, neigh.\""],[160.3,163.6,"The cows on the farm say, \"Moo, moo, moo.\""],[164.5,167.3,"The roosters on the farm say, \"Cock-a-doodle-doo.\""],[168.2,172.4,"\"Neigh. Moo. Cock-a-doodle-doo.\""],[172.4,177.2,"\"Neigh. Moo. Cock-a-doodle-doo.\""]]},{"yt":"gfZ6tCMjjsw","title":"Brown Bear Song | Sing Along Song Music for Kids | Sing a Story with Bri Reads","ch":"Bri Reads","stage":3,"note":"\"Brown bear\" 문형이 계속 반복되는 노래형 이야기 · 이야기 입문용","m":{"sec":193,"n":22,"words":169,"uniq":37,"wps":1.46,"wpsent":7.7,"rep":0.78,"long":6},"segs":[[3.3,8.9,"Hi friends! It's me, Bri. Today, let's sing a story together!"],[18.1,22.9,"Brown bear, brown bear What do you see?"],[23.1,27.5,"I see a red bird looking at me"],[32.9,38.2,"Red bird, red bird What do you see?"],[38.4,43.4,"I see a yellow duck looking at me"],[47.8,52.7,"Yellow duck, yellow duck What do you see?"],[52.7,58.3,"I see a blue horse looking at me"],[62.7,68.0,"Blue horse, blue horse What do you see?"],[68.0,73.3,"I see a green frog looking at me"],[77.7,82.9,"Green frog, green frog What do you see?"],[82.9,88.3,"I see a purple cat looking at me"],[92.9,98.0,"Purple cat, purple cat What do you see?"],[98.0,103.2,"I see a white dog looking at me"],[107.9,113.0,"White dog, white dog What do you see?"],[113.0,118.2,"I see a black sheep looking at me"],[122.9,127.9,"Black sheep, black sheep What do you see?"],[127.9,133.3,"I see a goldfish looking at me"],[137.9,143.0,"Goldfish, goldfish What do you see?"],[143.0,148.3,"I see a teacher looking at me"],[152.9,157.9,"Teacher, teacher What do you see?"],[157.9,163.2,"I see children looking at me"],[167.7,174.9,"Children, children What do you see?"]]},{"yt":"Mc9My7TnxFU","title":"Brown Bear, Brown Bear, What Do You See? - Animated Children's Book","ch":"Animated Children's Books","stage":3,"note":"같은 문장 틀에 동물만 바뀌는 그림책 · 낭독 속도 적당","m":{"sec":192,"n":23,"words":212,"uniq":42,"wps":1.93,"wpsent":9.2,"rep":0.8,"long":4},"segs":[[0.5,7.8,"brown bear brown bear what do you see by Bill Martin Jr and Eric Carle"],[12.1,19.7,"brown bear brown bear what do you see I see a red bird looking at me"],[24.8,28.0,"red bird red bird what do you see"],[30.7,33.5,"I see a yellow duck looking at me"],[34.3,40.8,"yellow duck yellow duck what do you see"],[41.8,46.0,"I see a blue horse looking at me"],[49.0,57.4,"Blue Horse Blue Horse what do you see I see a green frog looking at me"],[58.1,65.8,"green frog green frog what do you see"],[68.1,70.9,"I see a purple cat looking at me"],[74.2,76.9,"cat purple cat what do you see"],[79.9,82.6,"I see a white dog looking at me"],[86.5,89.5,"white dog white dog what do you see"],[92.0,94.8,"I see a black sheep looking at me"],[95.1,100.9,"Black Sheep Black Sheep what do you see"],[103.1,106.7,"I see a goldfish looking at me"],[108.5,111.4,"old fish goldfish what do you see"],[114.1,116.6,"I see a teacher looking at me"],[120.7,123.1,"to your teacher what do you see"],[125.9,128.5,"I see children looking at me"],[133.4,136.4,"children children what do you see"],[139.3,153.3,"we see a brown bear a red bird a yellow duck a blue horse a green frog a purple cat"],[155.0,162.5,"a white dog a black sheep a goldfish"],[165.4,169.1,"and a teacher looking at us that's what we see"]]},{"yt":"75NQK-Sm1YY","title":"The Very Hungry Caterpillar - Official Animated Film | Made For Kids | Eric Carle Book","ch":"Illuminated Films","stage":3,"note":"요일·음식이 나오는 진짜 이야기 · 길이 7분 · 어휘 다양","m":{"sec":408,"n":40,"words":232,"uniq":109,"wps":2.46,"wpsent":5.8,"rep":0.53,"long":20},"segs":[[2.5,4.4,"The Very Hungry Caterpillar"],[40.3,42.4,"In the light of the moon"],[44.1,46.2,"a little egg lay on a leaf"],[63.7,67.4,"One Sunday morning the warm sun came up and..."],[67.7,68.5,"Pop!"],[69.3,73.4,"Out of the egg came a tiny and very hungry caterpillar."],[76.9,78.8,"He started to look for some food."],[105.7,108.5,"On Monday he ate through one apple."],[120.9,122.5,"But he was still hungry."],[130.7,134.2,"On Tuesday he ate through two pears."],[134.7,136.6,"But he was still hungry."],[157.1,160.5,"On Wednesday he ate through three plums."],[162.3,163.8,"But he was still hungry."],[177.2,180.3,"On Thursday he ate through four strawberries."],[180.7,182.5,"But he was still hungry."],[223.3,226.7,"On Friday he ate through five oranges."],[227.1,228.8,"But he was still hungry."],[240.0,242.1,"On Saturday he ate through..."],[242.1,243.9,"one piece of chocolate cake..."],[243.9,245.4,"one ice-cream cone..."],[245.4,246.7,"one pickle..."],[251.5,253.7,"one slice of Swiss cheese..."],[253.7,255.5,"one slice of salami..."],[255.5,256.9,"one lollipop..."],[261.0,263.3,"one piece of cherry pie..."],[263.3,264.7,"one sausage..."],[264.7,266.2,"one cupcake..."],[266.2,268.9,"and one slice of watermelon."],[275.0,277.2,"That night he had a stomach-ache!"],[288.5,290.8,"The next day was Sunday again."],[291.6,294.6,"The caterpillar ate through one nice green leaf"],[294.7,297.6,"and after that he felt much better."],[298.9,301.0,"Now he wasn’t hungry any more"],[301.0,303.5,"and he wasn’t a little caterpillar any more."],[303.5,307.1,"He was a BIG, fat caterpillar."],[323.6,327.6,"He built a small house, called a cocoon, around himself."],[338.1,341.0,"He stayed inside for more than two weeks."],[350.2,353.0,"Then he nibbled a hole in the cocoon"],[353.3,355.1,"pushed his way out and..."],[356.9,359.8,"he was a beautiful butterfly!"]]},{"yt":"E2MPOr2g0zg","title":"Peppa Pig Season 1 Episode 3 - Best Friend - Cartoons for Children","ch":"George Pig - Official Channel","stage":3,"note":"대사·나레이션이 섞인 에피소드 · 5분 · 제일 어려움(끝까지 안 봐도 OK)","m":{"sec":316,"n":62,"words":383,"uniq":169,"wps":1.9,"wpsent":6.2,"rep":0.56,"long":24},"segs":[[2.5,4.5,"I'm Peppa Pig."],[4.5,7.1,"This is my little brother George."],[7.1,9.4,"This is Mummy Pig."],[9.4,12.3,"And this is Daddy Pig."],[13.3,15.2,"Peppa Pig."],[26.1,30.1,"Peppa is waiting for her best friend, Suzy Sheep."],[34.7,38.8,"Hello, Suzy. Hello, Peppa."],[38.8,43.7,"Suzy Sheep has come to play with Peppa."],[44.3,46.1,"Peppa loves Suzy."],[46.1,50.2,"Suzy loves Peppa. They are best friends."],[55.8,59.7,"Peppa, why don't you and Suzy go and play in your bedroom?"],[59.7,63.2,"Yes, Mummy!"],[63.2,66.0,"George wants to play, too."],[70.5,74.4,"Peppa and Suzy love playing in Peppa's bedroom."],[77.0,80.1,"So does George."],[81.5,85.6,"No, George! This game is just for big girls."],[85.6,89.2,"Go and play with your own toys."],[90.2,93.4,"Peppa and Suzy want to play on their own."],[93.4,97.2,"I'm a tiny, little fairy princess."],[105.4,108.6,"I'm going to wave my magic wand"],[108.6,112.7,"and turn you into a frog!"],[113.8,117.0,"George doesn't like playing on his own."],[121.0,123.1,"George wants to play, too."],[123.1,125.3,"No, George!"],[125.3,129.7,"I'm playing with Suzy! You have to play somewhere else!"],[130.8,134.5,"George wants to play with Peppa. He feels a bit lonely."],[134.5,139.6,"George, I need some help! I'm making chocolate-chip cookies!"],[143.1,145.5,"Someone needs to lick out the bowl."],[147.3,150.6,"George likes helping Mummy make cookies."],[152.5,155.5,"But he likes playing with Peppa more."],[158.0,160.6,"I can be a nurse!"],[160.6,163.7,"I want to be a doctor!"],[163.7,166.2,"But who's gonna be the sick person?"],[169.0,171.5,"Geo-orge!"],[173.3,177.2,"-Peppa and Suzy love playing doctors and nurses."],[178.6,180.6,"So does George."],[181.5,183.9,"Peppa listens to George's chest."],[183.9,188.5,"Now, George, take a big breath in, then cough."],[190.7,194.8,"Hmm, I think your heart is a bit loose."],[194.8,197.5,"I'll put a plaster on it."],[197.5,201.1,"Open wide, please!"],[201.1,204.1,"Suzy takes George's temperature."],[204.1,207.4,"Oh, dear! You're very, very hot."],[207.4,212.1,"I think you'll have to stay in bed for three years."],[213.7,216.2,"Daddy Pig has come to find George."],[216.2,219.5,"Oh, no! What's wrong with George?"],[219.5,223.8,"Don't worry, Daddy, it's only a game. George is our patient."],[223.8,225.6,"Oh, I see."],[225.6,228.3,"Can the patient have a visitor?"],[228.3,232.9,"Just for a little while. He might get tired."],[232.9,235.1,"PEPPA AND Cookies!"],[235.1,239.6,"Yes, they're for George. They're his medicine to make him feel better."],[247.1,250.5,"Um, excuse me, Doctor. Can you help me?"],[250.5,253.0,"I have a sore tummy."],[253.0,256.2,"Heh-heh-heh! That tickles."],[257.8,263.1,"I can hear it rumbling. I think you're hungry, Daddy."],[263.1,268.3,"-Then, I think I need lots of cookies to make me better."],[269.8,273.1,"And me! And me!"],[273.1,276.2,"And me!"],[287.6,289.5,"Peppa Pig"],[292.3,294.2,"Peppa Pig"],[296.4,298.3,"Peppa Pig"]]},{"yt":"yqlbn_nI2w8","title":"What's Your Name? featuring The Super Simple Puppets | Greeting Song | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":4,"note":"What's your name? 하나에 집중 · 첫 대화 연습","m":{"sec":94,"n":22,"words":69,"uniq":19,"wps":1.06,"wpsent":3.1,"rep":0.72,"long":1},"segs":[[13.1,15.1,"Hello, hello"],[15.1,17.3,"What's your name"],[17.3,19.6,"Hello, hello"],[19.6,21.5,"What's your name"],[21.5,23.7,"My name is Ryan"],[23.7,29.0,"My name is Anna"],[30.0,34.8,"Nice to meet you"],[34.8,36.6,"Hello, hello"],[36.6,38.7,"What's your name"],[38.7,40.7,"Hello, hello"],[40.7,43.1,"What's your name"],[43.1,45.2,"My name is Ben"],[45.2,50.0,"My name is Bella"],[55.2,59.9,"Nice to meet you"],[59.9,61.6,"Hello, hello"],[61.6,63.7,"What's your name"],[63.7,65.8,"Hello, hello"],[65.8,68.2,"What's your name"],[68.2,70.1,"My name is Kaylee"],[70.1,75.4,"My name is Owen"],[78.7,83.2,"Nice to meet you"],[83.2,88.0,"Let's be friends"]]},{"yt":"1OON8dkC_AM","title":"How old are you song for kids - English educational videos for kindergarten","ch":"ZooZooSong - ABC Kids Song","stage":4,"note":"How old are you? · 숫자로 대답하기","m":{"sec":130,"n":21,"words":95,"uniq":17,"wps":1.2,"wpsent":4.5,"rep":0.82,"long":2},"segs":[[6.0,9.8,"How old are you?"],[9.8,13.2,"I am 4 ! I am 5 !"],[13.2,16.9,"I'm younger than you. I'm older than you."],[16.9,21.0,"hahaha!"],[28.0,31.6,"How old are you?"],[31.6,35.1,"I am 6 ! I am 7 !"],[35.1,39.1,"I'm younger than you. I'm older than you."],[39.1,42.8,"hahaha!"],[50.4,53.8,"How old are you?"],[53.8,57.7,"I am 10 ! I am 11 !"],[57.7,61.2,"I'm younger than you. I'm older than you."],[61.2,65.3,"hahaha!"],[72.5,76.0,"How old are you?"],[76.0,79.7,"I am 17 ! I am 18 !"],[79.7,83.4,"I'm younger than you. I'm older than you."],[83.4,87.3,"hahaha!"],[94.3,98.2,"How old are you?"],[98.2,101.2,"I am 100 ! I am 1000 !"],[101.2,105.6,"I'm younger than you. I'm older than you."],[105.6,109.3,"hahaha!"],[116.8,121.6,"Okay everybody, Now It's your turn! How old are you?"]]},{"yt":"frN3nvhIHUk","title":"Do You Like Broccoli Ice Cream? | Food Song for Kids! | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":4,"note":"Do you like…? Yes, I do / No, I don't 질문-대답 세트","m":{"sec":163,"n":36,"words":118,"uniq":20,"wps":1.46,"wpsent":3.3,"rep":0.83,"long":3},"segs":[[11.5,14.1,"Do you like broccoli?"],[15.9,17.8,"Yes, I do."],[17.8,19.8,"Yes, I do."],[19.8,22.4,"Do you like ice cream?"],[23.8,25.8,"Yes, I do."],[25.8,28.1,"Yes, I do."],[28.5,31.8,"Do you like broccoli ice cream?"],[34.7,37.0,"No, I don't."],[37.0,38.1,"Yucky!"],[43.7,46.7,"Do you like donuts?"],[48.0,49.8,"Yes, I do."],[49.8,51.8,"Yes, I do."],[51.8,54.8,"Do you like juice?"],[55.9,57.8,"Yes, I do."],[57.8,60.1,"Yes, I do."],[60.5,63.5,"Do you like donut juice?"],[66.8,68.8,"No, I don't."],[68.8,70.0,"Yucky!"],[75.5,78.6,"Do you like popcorn?"],[79.9,81.8,"Yes, I do."],[81.8,83.8,"Yes, I do."],[83.8,86.1,"Do you like pizza?"],[87.7,89.8,"Yes, I do."],[89.8,92.1,"Yes, I do."],[92.3,95.7,"Do you like popcorn pizza?"],[98.8,100.8,"No, I don't."],[100.8,102.2,"Yucky!"],[107.7,110.7,"Do you like bananas?"],[111.7,113.8,"Yes, I do."],[113.8,115.9,"Yes, I do."],[115.9,118.2,"Do you like soup?"],[119.9,121.8,"Yes, I do."],[121.8,124.1,"Yes, I do."],[124.5,127.7,"Do you like banana soup?"],[130.8,132.9,"No, I don't."],[132.9,134.0,"Yuck!"]]},{"yt":"ddDN30evKPc","title":"Do You Like Spaghetti Yogurt? | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":4,"note":"같은 질문 틀에 음식만 바뀜 · 웃긴 조합이라 지루하지 않음","m":{"sec":152,"n":24,"words":116,"uniq":20,"wps":1.3,"wpsent":4.8,"rep":0.83,"long":5},"segs":[[15.7,19.6,"Do you like spaghetti?"],[19.6,23.4,"Yes, I do! Yes, I do!"],[23.4,27.5,"Do you like yogurt?"],[27.5,31.9,"Yes, I do! Yes, I do!"],[32.3,36.8,"Do you like spaghetti yogurt?"],[38.6,41.8,"No, I don't. Yucky!"],[47.6,51.2,"Do you like cookies?"],[51.2,55.4,"Yes, I do! Yes, I do!"],[55.5,59.4,"Do you like salad?"],[59.4,63.5,"Yes, I do! Yes, I do!"],[64.3,67.4,"Do you like cookie salad?"],[70.8,73.8,"No, I don't. Yucky!"],[79.8,83.4,"Do you like tomatoes?"],[83.4,87.2,"Yes, I do! Yes, I do!"],[87.3,91.8,"Do you like pancakes?"],[91.8,95.8,"Yes, I do! Yes, I do!"],[96.4,99.9,"Do you like tomato pancakes?"],[102.9,105.6,"No, I don't. Yucky!"],[111.8,115.9,"Do you like carrots?"],[116.0,119.3,"Yes, I do! Yes, I do!"],[119.3,123.5,"Do you like cereal?"],[123.5,127.7,"Yes, I do! Yes, I do!"],[128.2,131.2,"Do you like carrot cereal?"],[135.0,137.7,"No, I don't. Yuck!"]]},{"yt":"Mfb--R1fhtQ","title":"Do You Like Pickle Pudding? | Kids Food Song | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":4,"note":"앞 영상과 같은 틀 · 어휘만 살짝 늘어남","m":{"sec":162,"n":24,"words":120,"uniq":20,"wps":1.52,"wpsent":5.0,"rep":0.83,"long":8},"segs":[[16.1,18.7,"Do you like pickles?"],[20.1,23.8,"Yes, I do! Yes, I do!"],[24.0,26.7,"Do you like pudding?"],[28.2,31.9,"Yes, I do! Yes, I do!"],[32.5,35.6,"Do you like pickle pudding?"],[39.2,42.4,"No, I don’t! Yucky!"],[48.0,50.7,"Do you like mushrooms?"],[51.9,55.6,"Yes, I do! Yes, I do!"],[56.0,58.8,"Do you like popsicles?"],[60.1,63.5,"Yes, I do! Yes, I do!"],[64.5,68.2,"Do you like mushroom popsicles?"],[71.0,74.2,"No, I don’t! Yucky!"],[79.9,82.6,"Do you like cauliflower?"],[84.1,88.0,"Yes, I do! Yes, I do!"],[88.0,90.7,"Do you like cupcakes?"],[92.1,95.9,"Yes, I do! Yes, I do!"],[96.6,101.2,"Do you like cauliflower cupcakes?"],[103.1,106.1,"No, I don’t! Yucky!"],[112.1,114.5,"Do you like sushi?"],[116.1,119.7,"Yes, I do! Yes, I do!"],[120.0,122.8,"Do you like smoothies?"],[124.1,127.8,"Yes, I do! Yes, I do!"],[128.6,133.0,"Do you like sushi smoothies?"],[135.2,138.1,"No, I don’t! Yuck!"]]},{"yt":"SFE0mMWbA-Y","title":"Clean Up Song | Kids Song for Tidying Up | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":5,"note":"정리 시간에 바로 쓰는 표현 · 실제 상황과 연결","m":{"sec":110,"n":32,"words":122,"uniq":12,"wps":1.7,"wpsent":3.8,"rep":0.9,"long":1},"segs":[[11.0,13.5,"Clean up, clean up."],[13.5,15.8,"Everybody, let's clean up."],[16.2,18.7,"Clean up, clean up."],[18.7,21.0,"Put your things away."],[21.2,23.7,"Clean up, clean up."],[23.7,26.2,"Everybody, let's clean up."],[26.2,28.7,"Clean up, clean up."],[28.7,31.2,"Put your things away."],[35.1,37.4,"Clean up, clean up."],[37.4,40.0,"Everybody, let's clean up."],[40.2,42.6,"Clean up, clean up."],[42.6,44.8,"Put your things away."],[44.8,47.6,"Clean up, clean up."],[47.6,50.3,"Everybody, let's clean up."],[50.3,52.8,"Clean up, clean up."],[52.8,55.1,"Put your things away."],[56.9,57.9,"Clean up!"],[59.4,60.7,"Clean up!"],[61.9,62.9,"Clean up!"],[62.9,65.2,"Put your things away."],[66.5,68.3,"Pick up your toys."],[69.0,70.9,"Pick up your books."],[71.6,73.1,"Pick up your shoes."],[73.1,75.1,"Put your things away."],[75.3,78.0,"Clean up, clean up."],[78.2,80.6,"Everybody, let's clean up."],[80.6,83.1,"Clean up, clean up."],[83.1,85.2,"Put your things away."],[85.2,88.1,"Clean up, clean up."],[88.2,90.5,"Everybody, let's clean up."],[90.6,93.1,"Clean up, clean up."],[93.1,95.4,"Put your things away."]]},{"yt":"GbdEhhxyBo4","title":"Good Night Sleep Tight | Lullaby for Kids | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":5,"note":"가장 느리고 조용한 자장가 · 잠자리에서 마무리","m":{"sec":132,"n":14,"words":75,"uniq":21,"wps":1.15,"wpsent":5.4,"rep":0.72,"long":3},"segs":[[18.2,23.5,"Goodnight, sleep tight in the moonlight"],[24.4,29.7,"Goodnight, sleep tight until morning light"],[35.2,40.5,"Goodnight, sleep tight in the moonlight"],[41.3,46.6,"Goodnight, sleep tight until morning light"],[52.1,55.2,"Goodnight, goodnight"],[55.2,58.3,"I love you, goodnight"],[58.3,61.3,"Goodnight, goodnight"],[61.3,64.3,"I love you, sleep tight"],[64.3,69.6,"Close your eyes and dream of stars and moon beams"],[72.0,77.3,"Goodnight, I love you"],[81.3,86.6,"Goodnight, sleep tight in the moonlight"],[87.5,92.8,"Goodnight, sleep tight until morning light"],[98.2,103.5,"Goodnight, sleep tight in the moonlight"],[104.4,109.7,"Goodnight, sleep tight until morning light"]]},{"yt":"HVYXHMY7wvo","title":"The Bath Song | Original Kids Song | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":5,"note":"목욕 시간 표현 · 실제 목욕 전에 틀기","m":{"sec":137,"n":26,"words":136,"uniq":22,"wps":1.77,"wpsent":5.2,"rep":0.84,"long":1},"segs":[[12.1,14.9,"Can you wash your hair?"],[16.1,19.1,"I can wash my hair."],[19.9,23.0,"Can you wash your feet?"],[24.2,26.5,"I can wash my feet."],[27.9,31.0,"Can you wash your face?"],[32.3,34.6,"I can wash my face."],[36.3,38.9,"Can you wash your knees?"],[40.2,43.0,"I can wash my knees."],[44.0,47.1,"I can wash my hair."],[48.2,51.0,"I can wash my feet."],[52.7,55.3,"I can wash my face."],[56.7,59.0,"I can wash my knees."],[60.1,65.4,"This is the way we take a bath."],[67.8,70.7,"Can you wash your shoulders?"],[71.7,74.5,"I can wash my shoulders."],[75.5,78.2,"Can you wash your toes?"],[79.9,82.2,"I can wash my toes."],[83.7,86.8,"Can you wash your hands?"],[87.6,90.7,"I can wash my hands."],[91.8,95.0,"Can you wash your nose?"],[95.8,98.6,"I can wash my nose."],[99.8,103.0,"I can wash my shoulders."],[104.1,107.0,"I can wash my toes."],[108.1,110.7,"I can wash my hands."],[112.1,114.6,"I can wash my nose."],[115.5,120.3,"This is the way we take a bath."]]},{"yt":"v1YjJmMvnOw","title":"This Is The Way We Go To Bed | Kids Songs | Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":5,"note":"잠자기 전 루틴 표현","m":{"sec":119,"n":21,"words":143,"uniq":25,"wps":1.98,"wpsent":6.8,"rep":0.83,"long":3},"segs":[[11.1,13.9,"This is the way we take a bath"],[13.9,16.9,"Take a bath take a bath"],[16.9,19.6,"This is the way we take a bath"],[19.6,24.9,"We do it every evening"],[29.1,31.9,"This is the way we put on our pajamas"],[31.9,35.0,"Put on our pajamas put on our pajamas"],[35.0,37.6,"This is the way we put on our pajamas"],[37.6,42.9,"We do it every evening"],[47.1,50.0,"This is the way we brush our teeth"],[50.0,53.0,"Brush our teeth brush our teeth"],[53.0,55.5,"This is the way we brush our teeth"],[55.5,60.8,"We do it every evening"],[65.0,68.0,"This is the way we read a book"],[68.0,71.0,"Read a book read a book"],[71.0,73.6,"This is the way we read a book"],[73.6,78.9,"We do it every evening"],[83.1,86.1,"This is the way we say goodnight"],[86.1,89.3,"Say goodnight say goodnight"],[89.3,91.9,"This is the way we say goodnight"],[91.9,95.6,"We do it every evening"],[102.8,107.2,"This is the way we go to sleep"]]},{"yt":"wCio_xVlgQ0","title":"Brush Your Teeth | Kids Songs |  Super Simple Songs","ch":"Super Simple Songs - Kids Songs","stage":5,"note":"양치 시간 표현 · 아침저녁 루틴","m":{"sec":135,"n":24,"words":165,"uniq":38,"wps":1.89,"wpsent":6.9,"rep":0.77,"long":1},"segs":[[15.9,19.6,"Brush you teeth up and down"],[19.6,23.2,"Brush you teeth round and round"],[23.2,26.8,"Brush you teeth from left to right"],[26.8,30.4,"Brush you teeth in the morning and night"],[30.4,34.1,"Brush brush brush brush brush brush"],[34.1,37.8,"Brush you teeth in the morning and night"],[41.4,44.9,"Brush you teeth to keep them white"],[44.9,48.5,"Brush you teeth so your smile is bright"],[48.5,52.3,"Brush you teeth it's so much fun"],[52.3,56.0,"Brush you teeth when the day's begun"],[56.0,59.5,"Brush brush brush brush brush brush"],[59.5,63.3,"Brush you teeth when the day's begun"],[66.8,70.4,"Brush you teeth just open wide"],[70.4,74.0,"Brush you teeth from side to side"],[74.0,77.7,"Brush you teeth you sleepy head"],[77.7,81.4,"Brush you teeth before you go to bed"],[81.4,84.9,"Brush brush brush brush brush brush"],[84.9,88.6,"Brush you teeth before you go to bed"],[103.2,106.8,"Brush you teeth up and down"],[106.8,110.4,"Brush you teeth round and round"],[110.4,113.9,"Brush you teeth from left to right"],[113.9,117.7,"Brush you teeth in the morning and night"],[117.7,121.3,"Brush brush brush brush brush brush"],[121.3,125.1,"Brush you teeth in the morning and night"]]}];
