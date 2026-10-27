/* 선선 출퇴근 — Netlify 화면과 구글 스크립트(데이터)를 연결하는 파일
 * 구글 스크립트를 새로 배포해서 주소가 바뀌면 아래 API_URL 한 줄만 바꾸면 돼요. */
var API_URL = 'https://script.google.com/macros/s/AKfycbyTwR4H9eUiz0O0y8p7p35Piy2tx2GOk79lZItMVZGjgC5hb19cDLE-WEg_FGdpZlJZ8w/exec';
// 사이트 기본 주소 (api.js 위치 기준) → 예: https://eddykim27.github.io/sunsun10
var SITE_BASE = (function () {
  var src = (document.currentScript && document.currentScript.src) || location.href;
  return src.replace(/[^\/]*$/, '').replace(/\/$/, '');
})();
window.QR_BASE = 'https://sunsun10.netlify.app';   // 매장에 붙어 있는 QR 주소 (GitHub Pages로 자동 이동)
window.STAFF_URL = 'https://sunsun10.netlify.app/board/';   // 공유용 대시보드 주소

(function () {
  function call(fn, args) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 구글 스크립트가 받을 수 있는 형식
      body: JSON.stringify({ action: 'run', fn: fn, args: args })
    }).then(function (r) {
      if (!r.ok) throw new Error('서버 응답 오류 (' + r.status + ')');
      return r.json();
    }).then(function (j) {
      if (j.error) throw new Error(j.error);
      return j.result;
    }, function (e) {
      if (e && e.message && e.message.indexOf('서버') === 0) throw e;
      if (e && e.name === 'SyntaxError') throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요.');
      throw (e instanceof Error && !/fetch|network|Load failed/i.test(e.message)) ? e : new Error('인터넷 연결을 확인하고 다시 시도해주세요.');
    });
  }
  var FUNCS = ['getCheckinInfo', 'checkIn', 'getBoardData', 'getMonthData', 'adminLogin', 'saveDays', 'saveDay',
    'copyWeek', 'toggleHoliday', 'setStoreLocation', 'saveAttendance'];
  // 기존 화면 코드의 google.script.run.withSuccessHandler(...).함수(...) 모양을 그대로 쓰기 위한 흉내
  function runner(ok, fail) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); }
    };
    FUNCS.forEach(function (fn) {
      r[fn] = function () {
        var args = Array.prototype.slice.call(arguments);
        call(fn, args).then(function (v) { ok && ok(v); }, function (e) { fail && fail(e); });
      };
    });
    return r;
  }
  window.google = { script: { run: runner(null, null) } };
  // 화면을 열 때 구글 스크립트를 미리 깨워둠 (첫 요청 대기 줄이기)
  try { fetch(API_URL + '?api=ping', { mode: 'no-cors' }); } catch (e) {}
})();
