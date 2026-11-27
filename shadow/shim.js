/* 따라 말하기 배포판 연결부 — 화면은 GitHub Pages, 데이터는 각자 시트 사본의 Apps Script(doPost).
   내 앱 주소(…/exec)는 주소창 ?api= 로 처음 한 번 받아 이 기기에 저장한다. 홈 화면에 추가할 때도 이 주소 그대로 저장된다.
   (Apps Script 화면 안에서는 마이크 권한이 막혀 녹음이 안 되므로 화면을 여기로 뺐다) */
(function(){
  'use strict';
  var KEY = 'sh_api';
  var q = new URLSearchParams(location.search).get('api');
  if (q && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(q)) { try { localStorage.setItem(KEY, q); } catch (e) {} }
  function api(){ if (q) return q; try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  var READ = { eng_data:1, eng_month:1 };

  function call(fn, args, tries){
    tries = tries || 0;
    return fetch(api(), {
      method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: fn, args: args })
    }).then(function(r){ if (!r.ok) throw new Error('서버 응답 ' + r.status); return r.json(); })
      .catch(function(e){
        if (READ[fn] && tries < 2) return new Promise(function(res){ setTimeout(res, 1200 * (tries + 1)); }).then(function(){ return call(fn, args, tries + 1); });
        throw e;
      }).then(function(j){ if (!j.ok) throw new Error(j.err || '오류'); return j.v; });
  }
  function mk(ok, fail){
    var base = { withSuccessHandler: function(f){ return mk(f, fail); }, withFailureHandler: function(f){ return mk(ok, f); } };
    return new Proxy(base, { get: function(t, name){
      if (name in t) return t[name];
      if (typeof name !== 'string') return undefined;
      return function(){
        if (!api()) { setup(); return; }
        call(name, Array.prototype.slice.call(arguments)).then(function(v){ if (ok) ok(v); })
          .catch(function(e){ if (fail) fail(e); else alert(e.message); });
      };
    }});
  }
  window.google = { script: { run: mk(null, null) } };

  function setup(){
    var show = function(){
      document.body.innerHTML = '<div style="max-width:420px;margin:60px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.7;text-align:center">'
        + '<div style="font-size:52px">🗣</div><h2>내 앱 주소가 필요해요</h2>'
        + '<p style="color:#6b7484;font-size:15px">구글 시트 사본에서 배포한 <b>웹 앱 주소</b>를 열고, 거기 있는 <b>「앱 열기」</b> 버튼으로 들어와 주세요.</p>'
        + '<p style="color:#6b7484;font-size:13px">시트 위 메뉴 「🗣 따라 말하기 → 내 앱 주소 보기」에서 주소를 다시 볼 수 있어요.</p></div>';
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }
})();
