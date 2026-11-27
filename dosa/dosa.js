/* 🧰 아빠 도구함 공용 엔진 — 모든 앱 페이지가 먼저 불러온다.
   - 내 기록 창고 주소(각자 시트 사본의 …/exec)는 ?api= 로 받아 이 기기에 저장(dosa_api). 링크마다 ?api= 를 이어 붙인다
     (iOS 홈 화면 앱은 저장소가 따로라 주소에 남겨 둔다).
   - 앱의 「서버 함수」(Apps Script 문법 그대로)를 이 페이지 안에서 돌린다. 저장은 창고의 kv_load/kv_save,
     외부 주소는 fetch_text 로 대신 불러온다 → 창고 코드는 앱이 늘어도 안 바뀐다.
   페이지는 window.DOSA_APP = '앱이름' 을 정하고, 서버 함수 이름은 그 앱의 접두어로 시작해야 부를 수 있다(DOSA_FNS). */
(function(){
  'use strict';
  var KEY = 'dosa_api', RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
  var q = new URLSearchParams(location.search).get('api');
  if (q && RE.test(q)) { try { localStorage.setItem(KEY, q); } catch (e) {} }
  function api(){ if (q && RE.test(q)) return q; try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }

  function rpc(fn, args, tries){
    tries = tries || 0;
    return fetch(api(), { method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: fn, args: args || [] }) })
      .then(function(r){ if (!r.ok) throw new Error('서버 응답 ' + r.status); return r.json(); })
      .catch(function(e){
        if (fn !== 'kv_save' && tries < 2) return new Promise(function(res){ setTimeout(res, 1200 * (tries + 1)); }).then(function(){ return rpc(fn, args, tries + 1); });
        throw e;
      }).then(function(j){ if (!j.ok) throw new Error(j.err || '오류'); return j.v; });
  }

  /* ── Apps Script 흉내 ── */
  var P = null, dirty = {}, fetched = {}, need = null;   // need: 앱 코드의 try/catch 가 삼켜도 알 수 있게 따로 적어 둔다
  function Need(key, url, o){ this.key = key; this.url = url; this.o = o; }
  window.PropertiesService = { getScriptProperties: function(){ return {
    getProperty: function(k){ return Object.prototype.hasOwnProperty.call(P, k) ? P[k] : null; },
    getProperties: function(){ return Object.assign({}, P); },
    setProperty: function(k, v){ P[k] = String(v); dirty[k] = P[k]; return this; },
    setProperties: function(o){ for (var k in o) { P[k] = String(o[k]); dirty[k] = P[k]; } return this; },
    deleteProperty: function(k){ delete P[k]; dirty[k] = null; return this; }
  }; } };
  window.Utilities = { formatDate: function(d, tz, f){
    var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).forEach(function(x){ p[x.type] = x.value; });
    return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  } };
  window.UrlFetchApp = { fetch: function(url, o){
    o = o || {};
    var key = url + '|' + (o.payload || '');
    if (!fetched[key]) { need = need || new Need(key, url, { method: o.method, payload: o.payload, contentType: o.contentType, headers: o.headers }); throw need; }
    var r = fetched[key];
    return { getResponseCode: function(){ return r.code; }, getContentText: function(){ return r.text; } };
  } };
  window.LockService = { getScriptLock: function(){ return { waitLock: function(){}, tryLock: function(){ return true; }, releaseLock: function(){} }; } };

  var queue = Promise.resolve();
  function runLocal(fn, args){
    var app = window.DOSA_APP, pre = (window.DOSA_FNS || app + '_');
    if (typeof window[fn] !== 'function' || fn.indexOf(pre) !== 0 || /_$/.test(fn)) return Promise.reject(new Error('없는 기능: ' + fn));
    var load = P ? Promise.resolve() : rpc('kv_load', [app]).then(function(m){ P = m || {}; });
    return load.then(function attempt(n){
      n = n || 0;
      var snap = Object.assign({}, P), snapD = Object.assign({}, dirty), v, err = null;
      need = null;
      try { v = window[fn].apply(null, args); } catch (e) { err = e; }
      if (need && n < 9) {
        var e = need; need = null;
        P = snap; dirty = snapD;              // 외부 주소가 필요하면 불러온 뒤 처음부터 다시 돌린다
        return rpc('fetch_text', [e.url, e.o]).then(function(r){ fetched[e.key] = r; }, function(){ fetched[e.key] = { code: 599, text: '' }; })
          .then(function(){ return attempt(n + 1); });
      }
      if (err) throw err;
      var d = dirty; dirty = {};
      if (!Object.keys(d).length) return v;
      return rpc('kv_save', [app, d]).then(function(){ return v; }, function(err){ Object.assign(dirty, d); throw err; });
    });
  }

  function mk(ok, fail){
    var base = { withSuccessHandler: function(f){ return mk(f, fail); }, withFailureHandler: function(f){ return mk(ok, f); } };
    return new Proxy(base, { get: function(t, name){
      if (name in t) return t[name];
      if (typeof name !== 'string') return undefined;
      return function(){
        if (!api()) { setup(); return; }
        var args = Array.prototype.slice.call(arguments);
        queue = queue.then(function(){ return runLocal(name, args); })      // 저장 순서가 꼬이지 않게 한 줄로
          .then(function(v){ if (ok) ok(v); }, function(e){ if (fail) fail(e); else alert(e.message); });
      };
    }});
  }
  window.google = { script: { run: mk(null, null) } };
  window.dosa = { api: api, rpc: rpc, link: function(path){ return path + (api() ? '?api=' + encodeURIComponent(api()) : ''); } };

  function setup(){
    var show = function(){
      document.body.innerHTML = '<div style="max-width:420px;margin:60px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.7;text-align:center">'
        + '<div style="font-size:52px">🧰</div><h2>내 도구함 주소가 필요해요</h2>'
        + '<p style="color:#6b7484;font-size:15px">구글 시트 사본에서 배포한 <b>웹 앱 주소</b>를 열고 <b>「도구함 열기」</b>로 들어와 주세요.</p>'
        + '<p style="color:#6b7484;font-size:13px">시트 위 메뉴 「🧰 아빠 도구함 → 내 앱 주소 보기」에서 다시 볼 수 있어요.</p></div>';
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }
  window.dosaSetup = setup;
})();
