/**
 * 선선커피 출퇴근 · 스케줄 시스템 (Google Apps Script)
 * ------------------------------------------------------
 * 하나의 웹앱으로 3개 화면을 제공합니다.
 *   ?s=1            → 1호점(인천) 출퇴근 페이지   (QR 1)
 *   ?s=2            → 2호점(여의도) 출퇴근 페이지 (QR 2)
 *   ?v=admin        → 관리자 스케줄 페이지 (PIN 필요)
 *   (주소만)         → 직원용 스케줄표 (읽기 전용)
 *
 * 데이터는 이 스크립트가 연결된 구글 시트에 저장됩니다.
 */

var TZ = 'Asia/Seoul';

var SH = {
  settings: '설정',
  stores: '지점',
  hours: '기본근무시간',
  staff: '직원',
  sched: '스케줄',
  memo: '일정메모',
  hol: '공휴일',
  log: '체크인로그',
  att: '출퇴근기록',
  work: '근무내역',
  ju: '주휴수당',
  cmp: '알바근무비교'
};

var HEADERS = {
  '설정': ['항목', '값', '설명'],
  '지점': ['지점', '지역', '위도', '경도', '메모', '휴게차감'],
  '기본근무시간': ['지점', '요일구분', '파트', '시작', '종료'],
  '직원': ['이름', '구분', '시급', '상태', '색상', '메모'],
  '스케줄': ['날짜', '지점', '이름', '파트', '시작', '종료', '메모'],
  '일정메모': ['날짜', '위치', '내용'],
  '공휴일': ['날짜', '이름'],
  '체크인로그': ['체크시각', '지점', '이름', '구분', '결과', '위도', '경도', '정확도(m)', '매장까지(m)'],
  '출퇴근기록': ['날짜', '지점', '이름', '출근', '퇴근', '메모', '휴게기록'],
  '근무내역': ['월', '날짜', '요일', '지점', '이름', '구분', '파트', '예정시작', '예정종료', '예정(분)',
            '출근', '퇴근', '실근무(분)', '인정(분)', '차이(분)', '지각(분)', '상태', '메모', '휴게(분)', '예상인정(분)'],
  '주휴수당': ['귀속월', '주시작', '주종료', '이름', '구분', '소정근로(분)', '근무일수', '결근', '15시간이상', '개근',
            '주휴시간(분)', '시급', '주휴수당(원)', '판정', '예상주휴(원)']
};

// 주휴수당에서 숫자로 저장하는 열
var JU_NUM_COLS = [5, 6, 7, 10, 11, 12, 14];

// 근무내역에서 숫자로 저장하는 열 (0부터 시작하는 인덱스)
var WORK_NUM_COLS = [9, 12, 13, 14, 15, 18, 19];

var DEFAULT_SETTINGS = [
  ['관리자PIN', '1234', '관리자 페이지 비밀번호 (꼭 바꿔주세요)'],
  ['기록시작일', '2026-10-20', '이 날짜 이전은 결근 판정을 하지 않습니다'],
  ['준비시간_직원(분)', '30', '근무시작 몇 분 전까지 출근해야 하는지 (직원)'],
  ['준비시간_알바(분)', '10', '근무시작 몇 분 전까지 출근해야 하는지 (알바)'],
  ['지각유예(분)', '0', '출근 기준시각에서 이만큼은 지각으로 보지 않음'],
  ['조퇴기준(분)', '30', '예정 종료보다 이만큼 이상 일찍 퇴근하면 조퇴 (직원·알바 공통)'],
  ['인정유예(분)', '20', '예정보다 이만큼 미만으로 늦게 오거나 일찍 가면 예정 시간을 다 인정 (20 이상 차이나면 그만큼 빼요)'],
  ['휴게30분기준(분)', '300', '알바 근무(스케줄)가 이 시간(분) 이상이면 휴게 30분 · 300 = 5시간'],
  ['휴게1시간기준(분)', '420', '알바 근무(스케줄)가 이 시간(분) 이상이면 휴게 1시간 · 420 = 7시간 · 휴게를 더 길게 찍으면 실제만큼 뺌'],
  ['위치확인', '사용', '사용 / 미사용'],
  ['허용반경(m)', '200', '매장에서 이 거리 안에서만 출퇴근 가능'],
  ['로고URL', '', '로고 이미지 주소 (비워두면 기본 로고)']
];

var DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/* =========================================================
 * 웹앱 진입점
 * ======================================================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api) return api_(p.api, p);   // Netlify 화면에서 부르는 데이터 요청
  var url = ScriptApp.getService().getUrl();
  var t;
  if (p.v === 'board') {
    t = HtmlService.createTemplateFromFile('Board');
  } else if (p.s) {
    t = HtmlService.createTemplateFromFile('Checkin');
    t.storeParam = String(p.s).replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 10);
    // 첫 화면에 필요한 직원 목록·오늘 근무자를 페이지에 같이 담아 보내서 한 번 더 요청하지 않게 함
    var init = null;
    try { init = getCheckinInfo(t.storeParam); } catch (err) { init = null; }
    t.init = safeJson_(init);
  } else {
    t = HtmlService.createTemplateFromFile('App');
    t.mode = p.v === 'admin' ? 'admin' : 'view';
  }
  t.appUrl = url;
  var title = p.v === 'board' ? '선선 출퇴근 대시보드' : p.s ? '선선 출퇴근' : (p.v === 'admin' ? '선선 스케줄 관리' : '선선 스케줄');
  return t.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Netlify 화면에서 보내는 출퇴근 기록 (POST) */
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return api_(body.action, body);
}

/** Netlify 화면에서 부를 수 있는 함수 목록 (관리자 기능은 각 함수 안에서 비밀번호 확인) */
var API_FUNCS_ = {
  getCheckinInfo: function (a) { return getCheckinInfo(a); },
  checkIn: function (a) { return checkIn(a); },
  getBoardData: function (a) { return getBoardData(a); },
  getMonthData: function (a, b) { return getMonthData(a, b); },
  adminLogin: function (a) { return adminLogin(a); },
  saveDays: function (a, b, c) { return saveDays(a, b, c); },
  saveDay: function (a, b, c, d) { return saveDay(a, b, c, d); },
  copyWeek: function (a, b, c, d) { return copyWeek(a, b, c, d); },
  toggleHoliday: function (a, b, c, d) { return toggleHoliday(a, b, c, d); },
  setStoreLocation: function (a, b, c, d) { return setStoreLocation(a, b, c, d); },
  saveAttendance: function (a, b, c, d, e, f, g, h, i) { return saveAttendance(a, b, c, d, e, f, g, h, i); }
};

/** JSON API: run(함수 호출) · info · board · ping */
function api_(action, p) {
  var out;
  try {
    if (action === 'run' && API_FUNCS_[p.fn]) out = { result: API_FUNCS_[p.fn].apply(null, p.args || []) };
    else if (action === 'info') out = { result: getCheckinInfo(p.s) };
    else if (action === 'board') out = { result: getBoardData(p.ym || '') };
    else if (action === 'ping') out = { result: 'ok' };
    else out = { error: '알 수 없는 요청이에요.' };
  } catch (err) {
    out = { error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 템플릿 <script> 안에 넣어도 안전한 JSON */
function safeJson_(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* =========================================================
 * 초기 설정 (처음 한 번 실행)
 * ======================================================= */
function setup() {
  ensureSheets_();
  // 매일 밤 근무내역(결근·퇴근누락 등) 갱신
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    var h = tr.getHandlerFunction();
    if (h === 'nightly' || h === 'hourly' || h === 'minutely') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('nightly').timeBased().everyDays(1).atHour(23).nearMinute(40).inTimezone(TZ).create();
  // 출퇴근을 찍을 때는 기록만 하고, 근무내역·주휴수당은
  //  - 1분마다: 새 기록이 있을 때만 다시 계산
  //  - 1시간마다: 결근 등 시간이 지나면 바뀌는 상태 반영
  ScriptApp.newTrigger('minutely').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('hourly').timeBased().everyHours(1).create();
  rebuildMonth_(ymOf_(todayStr_()));
  SpreadsheetApp.getActive().toast('설정이 끝났어요. 출퇴근 기록은 1분 안에 근무내역에 반영돼요.', '선선 출퇴근', 8);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('☕ 선선 출퇴근')
    .addItem('근무내역 새로고침 (이번 달)', 'menuRebuildThis')
    .addItem('근무내역 새로고침 (지난 달)', 'menuRebuildPrev')
    .addSeparator()
    .addItem('처음 설정 실행', 'setup')
    .addToUi();
}

function menuRebuildThis() { ensureSheets_(); rebuildMonth_(ymOf_(todayStr_())); toast_('이번 달 근무내역을 새로 계산했어요.'); }
function menuRebuildPrev() { ensureSheets_(); rebuildMonth_(prevYm_(ymOf_(todayStr_()))); toast_('지난 달 근무내역을 새로 계산했어요.'); }

/** 출퇴근 기록이 생겼다고 표시 (1분 트리거가 보고 다시 계산) */
function markDirty_(ym) {
  try {
    var props = PropertiesService.getScriptProperties();
    var cur = (props.getProperty('dirtyMonths') || '').split(',').filter(String);
    if (cur.indexOf(ym) < 0) cur.push(ym);
    props.setProperty('dirtyMonths', cur.join(','));
  } catch (e) {}
}

/** 1분마다: 새 기록이 있을 때만 근무내역·주휴수당 다시 계산 */
function minutely() {
  var props = PropertiesService.getScriptProperties();
  var months = (props.getProperty('dirtyMonths') || '').split(',').filter(String);
  if (!months.length) return;
  props.deleteProperty('dirtyMonths');   // 계산 중에 들어온 기록은 다음 1분에 다시 반영
  months.forEach(function (ym) { rebuildMonth_(ym); });
}

function hourly() {
  var h = +Utilities.formatDate(new Date(), TZ, 'H');
  if (h < 6) return;   // 새벽에는 쉼
  rebuildMonth_(ymOf_(todayStr_()));
}

function nightly() {
  ensureSheets_();
  var ym = ymOf_(todayStr_());
  rebuildMonth_(ym);
  if (todayStr_().slice(8) <= '02') rebuildMonth_(prevYm_(ym));
}

/** 시트에서 스케줄/출퇴근기록을 직접 고치면 근무내역을 다시 계산 */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    if (name !== SH.sched && name !== SH.att && name !== SH.staff && name !== SH.hol) return;
    var months = {};
    if (name === SH.sched || name === SH.att) {
      var vals = e.range.getSheet().getRange(e.range.getRow(), 1, e.range.getNumRows(), 1).getDisplayValues();
      vals.forEach(function (r) { if (/^\d{4}-\d{2}-\d{2}$/.test(r[0])) months[r[0].slice(0, 7)] = 1; });
    }
    if (!Object.keys(months).length) months[ymOf_(todayStr_())] = 1;
    Object.keys(months).forEach(function (ym) { rebuildMonth_(ym); });
  } catch (err) { /* 단순 트리거: 실패해도 무시 */ }
}

function ensureSheets_() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange(2, 1, sh.getMaxRows() - 1, HEADERS[name].length).setNumberFormat('@');
    }
  });
  var st = ss.getSheetByName(SH.settings);
  if (st.getLastRow() < 2) st.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
}

function toast_(msg) { try { SpreadsheetApp.getActive().toast(msg, '선선 출퇴근', 5); } catch (e) {} }

/* =========================================================
 * 공통 유틸
 * ======================================================= */
function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function readRows_(name) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = HEADERS[name] ? HEADERS[name].length : sh.getLastColumn();
  return sh.getRange(2, 1, sh.getLastRow() - 1, n).getDisplayValues();
}

/** 시트 내용을 (헤더 제외) 통째로 다시 씀 */
function writeRows_(name, rows) {
  var sh = sheet_(name);
  var n = HEADERS[name].length;
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  var rng = sh.getRange(2, 1, rows.length, n);
  if (name === SH.work || name === SH.ju) {
    // 텍스트 열은 텍스트로, 숫자 열은 숫자로
    var numCols = name === SH.work ? WORK_NUM_COLS : JU_NUM_COLS;
    for (var c = 0; c < n; c++) {
      sh.getRange(2, c + 1, rows.length, 1).setNumberFormat(numCols.indexOf(c) >= 0 ? '0' : '@');
    }
  } else {
    rng.setNumberFormat('@');
  }
  rng.setValues(rows);
}

function appendRow_(name, row) {
  var sh = sheet_(name);
  var r = sh.getLastRow() + 1;
  var rng = sh.getRange(r, 1, 1, row.length);
  rng.setNumberFormat('@');
  rng.setValues([row]);
}

function getSettings_() {
  var map = {};
  readRows_(SH.settings).forEach(function (r) { if (r[0]) map[String(r[0]).trim()] = String(r[1]).trim(); });
  DEFAULT_SETTINGS.forEach(function (d) { if (!(d[0] in map)) map[d[0]] = d[1]; });
  return {
    pin: map['관리자PIN'],
    startDate: normDate_(map['기록시작일']) || '2000-01-01',
    prepStaff: num_(map['준비시간_직원(분)'], 30),
    prepPart: num_(map['준비시간_알바(분)'], 10),
    grace: num_(map['지각유예(분)'], 0),
    earlyLeave: num_(map['조퇴기준(분)'], 30),
    creditGrace: num_(map['인정유예(분)'], 20),
    break30At: num_(map['휴게30분기준(분)'], 300),
    break60At: num_(map['휴게1시간기준(분)'], 420),
    locationCheck: map['위치확인'] !== '미사용',
    radius: num_(map['허용반경(m)'], 200),
    logoUrl: map['로고URL'] || ''
  };
}

function num_(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowHM_() { return fmtMin_(toMin_(Utilities.formatDate(new Date(), TZ, 'HH:mm'))); }
function ymOf_(d) { return d.slice(0, 7); }
function prevYm_(ym) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
  if (m === 0) { y--; m = 12; }
  return y + '-' + pad2_(m);
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** "2026. 10. 5" / "2026-10-05" / "2026/10/5" → "2026-10-05" */
function normDate_(s) {
  var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]) : '';
}

/** "7:30", "07:30:00", "오후 4:30:00" → 분 (450). 실패하면 null */
function toMin_(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  var pm = /오후|PM/i.test(s), am = /오전|AM/i.test(s);
  var m = s.match(/(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return null;
  var h = +m[1], mi = +(m[2] || 0);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return h * 60 + mi;
}

function fmtMin_(n) {
  if (n == null || isNaN(n)) return '';
  return Math.floor(n / 60) + ':' + pad2_(n % 60);
}

function dateObj_(d) { return new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12); }
function dateStr_(o) { return o.getFullYear() + '-' + pad2_(o.getMonth() + 1) + '-' + pad2_(o.getDate()); }
function addDays_(d, n) { var o = dateObj_(d); o.setDate(o.getDate() + n); return dateStr_(o); }
function dow_(d) { return dateObj_(d).getDay(); }

function daysInMonth_(ym) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  var last = new Date(y, m, 0).getDate();
  var out = [];
  for (var i = 1; i <= last; i++) out.push(ym + '-' + pad2_(i));
  return out;
}

/** 두 지점 사이 거리 (m) */
function distM_(lat1, lng1, lat2, lng2) {
  var R = 6371000, toR = Math.PI / 180;
  var dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* =========================================================
 * 기준 정보 읽기
 * ======================================================= */
function getStores_() {
  return readRows_(SH.stores).filter(function (r) { return r[0]; }).map(function (r) {
    // 휴게차감: '적용'(기본 규칙) / '없음'(빼지 않음) / '최대30분'(규칙대로 빼되 30분까지만, QR 휴게 버튼 없음)
    var bt = String(r[5] || ''), cap = null;
    if (/(\d+)\s*분/.test(bt)) cap = +bt.match(/(\d+)\s*분/)[1];
    else if (/없음|미적용|X/i.test(bt)) cap = 0;
    return { name: r[0], area: r[1], lat: parseFloat(r[2]), lng: parseFloat(r[3]), memo: r[4], breakCap: cap, noBreak: cap === 0, hideBreakBtn: cap != null };
  });
}

/** QR 파라미터(1, 2, 1호점…)로 지점 찾기 */
function findStore_(param, stores) {
  stores = stores || getStores_();
  param = String(param || '').trim();
  for (var i = 0; i < stores.length; i++) {
    if (stores[i].name === param || stores[i].name.indexOf(param) === 0) return stores[i];
  }
  return null;
}

function getStaff_() {
  return readRows_(SH.staff).filter(function (r) { return r[0]; }).map(function (r) {
    return { name: r[0].trim(), type: r[1] === '직원' ? '직원' : '알바', wage: num_(r[2], 0), status: r[3] || '재직', color: r[4] || '', memo: r[5] };
  });
}

function getHours_() {
  return readRows_(SH.hours).filter(function (r) { return r[0]; }).map(function (r) {
    return { store: r[0], dayType: r[1], part: r[2], start: fmtMin_(toMin_(r[3])), end: fmtMin_(toMin_(r[4])) };
  });
}

function getHolidays_() {
  var map = {};
  readRows_(SH.hol).forEach(function (r) { var d = normDate_(r[0]); if (d) map[d] = r[1] || '공휴일'; });
  return map;
}

/** 평일 / 토·공휴일 / 일요일 */
function dayType_(d, hol) {
  var w = dow_(d);
  if (w === 0) return '일요일';
  if (w === 6 || hol[d]) return '토·공휴일';
  return '평일';
}

/* =========================================================
 * 근무 판정 (핵심 로직)
 * ======================================================= */

/** 구간 합치기 → [[s,e],...] */
function mergeIntervals_(list) {
  var a = list.filter(function (x) { return x[0] != null && x[1] != null && x[1] > x[0]; })
    .sort(function (p, q) { return p[0] - q[0]; });
  var out = [];
  a.forEach(function (x) {
    if (out.length && x[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]);
    else out.push([x[0], x[1]]);
  });
  return out;
}

function sumIntervals_(list) { return list.reduce(function (s, x) { return s + (x[1] - x[0]); }, 0); }

function overlap_(a, b, intervals) {
  if (a == null || b == null || b <= a) return 0;
  return intervals.reduce(function (s, x) { return s + Math.max(0, Math.min(b, x[1]) - Math.max(a, x[0])); }, 0);
}

/**
 * 한 사람·한 날·한 지점의 근무 판정
 * @param g {date, store, name, shifts:[{part,start,end,memo}], att:{in,out,memo}|null}
 * @param ctx {staffMap, settings, today, nowMin}
 */
function evaluate_(g, ctx) {
  var st = ctx.staffMap[g.name] || { type: '알바' };
  var shifts = g.shifts.slice().sort(function (a, b) { return toMin_(a.start) - toMin_(b.start); });
  var intervals = mergeIntervals_(shifts.map(function (s) { return [toMin_(s.start), toMin_(s.end)]; }));
  var planned = sumIntervals_(intervals);
  var S = intervals.length ? intervals[0][0] : null;
  var E = intervals.length ? intervals[intervals.length - 1][1] : null;
  // 같은 날 다른 지점 근무를 마치고 넘어오는 근무는 준비시간 없이 근무 시작시각이 출근 기준
  var prep = g.moved ? 0 : st.type === '직원' ? ctx.settings.prepStaff : ctx.settings.prepPart;
  var deadline = S == null ? null : S - prep + ctx.settings.grace;

  var tin = g.att ? toMin_(g.att['in']) : null;
  var tout = g.att ? toMin_(g.att.out) : null;
  // 휴게: 알바는 근무 5시간 이상 30분, 7시간 이상 1시간 (지점별 최대치 적용). 실제로 찍은 휴게가 더 길면 그만큼 차감
  var cap = ctx.breakCap ? ctx.breakCap[g.store] : null;
  var storeNoBreak = cap === 0;
  var ruleBreak = st.type !== '직원' && !storeNoBreak ? breakFor_(planned, ctx.settings) : 0;
  if (cap != null) ruleBreak = Math.min(ruleBreak, cap);
  var brks = storeNoBreak ? [] : parseBreaks_(g.att && g.att.brk);
  var breakOpen = brks.length > 0 && brks[brks.length - 1][1] == null;
  var recBreak = brks.reduce(function (a, b) {
    var e = b[1] != null ? b[1] : tout;
    if (e == null) return a;
    var s0 = tin != null ? Math.max(b[0], tin) : b[0], e0 = tout != null ? Math.min(e, tout) : e;
    return a + Math.max(0, e0 - s0);
  }, 0);
  var breakUsed = Math.max(ruleBreak, recBreak);
  var actual = tin != null && tout != null && tout > tin ? Math.max(0, tout - tin - recBreak) : null;
  // 인정: 예정보다 '인정유예' 미만으로 늦게 오거나 일찍 간 건 예정대로 인정 (각각 따로 판단)
  var cg = ctx.settings.creditGrace || 0;
  var cIn = tin != null && S != null && tin > S && tin - S < cg ? S : tin;
  var cOut = tout != null && E != null && tout < E && E - tout < cg ? E : tout;
  var credited = tin != null && tout != null ? Math.max(0, overlap_(cIn, cOut, intervals) - breakUsed) : null;
  planned = Math.max(0, planned - ruleBreak);
  var late = tin != null && deadline != null ? Math.max(0, tin - deadline) : 0;

  var isPast = g.date < ctx.today, isToday = g.date === ctx.today;
  var status;
  if (!shifts.length) {
    status = '스케줄외';
  } else if (tin == null && tout == null) {
    if (g.date < ctx.settings.startDate) status = '기록전';
    else if (isPast || (isToday && ctx.nowMin >= E)) status = '결근';
    else if (isToday && ctx.nowMin > deadline) status = '미출근';
    else status = '예정';
  } else if (tin == null) {
    status = '출근누락';
  } else {
    var tags = [];
    if (late > 0) tags.push('지각');
    if (tout == null) {
      if (isToday && ctx.nowMin < E + 60) tags.push(breakOpen ? '휴게중' : '근무중');
      else tags.push('퇴근누락');
    } else if (E != null && E - tout >= ctx.settings.earlyLeave) {
      tags.push('조퇴');
    }
    status = tags.length ? tags.join('·') : '정상';
  }

  var memo = [];
  shifts.forEach(function (s) { if (s.memo) memo.push(s.memo); });
  if (g.att && g.att.memo) memo.push(g.att.memo);

  return {
    ym: g.date.slice(0, 7),
    date: g.date,
    dow: DAY_KO[dow_(g.date)],
    store: g.store,
    name: g.name,
    type: st.type,
    parts: uniq_(shifts.map(function (s) { return s.part; })).join('+'),
    start: fmtMin_(S),
    end: fmtMin_(E),
    planned: planned,
    deadline: fmtMin_(deadline),
    tin: g.att ? fmtMin_(tin) : '',
    tout: g.att ? fmtMin_(tout) : '',
    actual: actual,
    credited: credited,
    diff: actual != null ? actual - planned : null,
    late: late,
    status: status,
    memo: memo.join(' / '),
    breakMin: tin != null && tout != null ? breakUsed : (ruleBreak || ''),
    // 예상 인정(분): 출퇴근을 다 찍은 날은 실제 인정, 아직 안 온 날·기록이 없는 날(결근·누락 포함)은 스케줄대로 일한 걸로
    expected: credited != null && tout != null ? credited : planned,
    breakOpen: breakOpen,
    breaks: g.att ? (g.att.brk || '') : ''
  };
}

function uniq_(a) { var o = []; a.forEach(function (x) { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }

function schedObj_(r) {
  return { date: normDate_(r[0]), store: r[1], name: String(r[2]).trim(), part: r[3], start: fmtMin_(toMin_(r[4])), end: fmtMin_(toMin_(r[5])), memo: r[6] };
}
function attObj_(r) {
  return { date: normDate_(r[0]), store: r[1], name: String(r[2]).trim(), 'in': r[3], out: r[4], memo: r[5], brk: r[6] || '' };
}

/** 근무(스케줄) 시간(분) → 빼야 할 휴게(분). 5:00 이상 30분, 7:00 이상 1시간 */
function breakFor_(stay, settings) {
  if (settings.break60At > 0 && stay >= settings.break60At) return 60;
  if (settings.break30At > 0 && stay >= settings.break30At) return 30;
  return 0;
}

/** "12:00-12:30, 15:00-" → [[720,750],[900,null]] */
function parseBreaks_(text) {
  var out = [];
  String(text || '').split(/[,\n]/).forEach(function (part) {
    var m = part.split('-');
    var a = toMin_(m[0]);
    if (a == null) return;
    var b = m.length > 1 ? toMin_(m[1]) : null;
    out.push([a, b != null && b > a ? b : null]);
  });
  return out;
}

/** 날짜 범위(포함)의 근무 판정 결과 목록 */
function computeRange_(from, to, data) {
  data = data || {};
  var settings = data.settings || getSettings_();
  var staff = data.staff || getStaff_();
  var staffMap = {};
  staff.forEach(function (s) { staffMap[s.name] = s; });
  var sched = (data.sched || readRows_(SH.sched).map(schedObj_)).filter(function (s) { return s.date >= from && s.date <= to && s.name; });
  var att = (data.att || readRows_(SH.att).map(attObj_)).filter(function (a) { return a.date >= from && a.date <= to && a.name; });

  var groups = {}, order = [];
  function key(d, st, n) { return d + '|' + st + '|' + n; }
  sched.forEach(function (s) {
    var k = key(s.date, s.store, s.name);
    if (!groups[k]) { groups[k] = { date: s.date, store: s.store, name: s.name, shifts: [], att: null }; order.push(k); }
    groups[k].shifts.push(s);
  });
  att.forEach(function (a) {
    var k = key(a.date, a.store, a.name);
    // 스케줄로 자동 입력한 기록은 항상 '지금' 스케줄을 따라감 (스케줄이 바뀌면 같이 바뀌고, 없어지면 기록도 무시)
    if (/^자동입력/.test(String(a.memo || ''))) {
      var g0 = groups[k];
      if (!g0 || !g0.shifts.length) return;
      var st0 = staffMap[a.name] || { type: '알바' };
      var prep0 = st0.type === '직원' ? settings.prepStaff : settings.prepPart;
      var s0 = Math.min.apply(null, g0.shifts.map(function (x) { return toMin_(x.start); }));
      var e0 = Math.max.apply(null, g0.shifts.map(function (x) { return toMin_(x.end); }));
      a = { date: a.date, store: a.store, name: a.name, 'in': fmtMin_(s0 - prep0), out: fmtMin_(e0), memo: a.memo, brk: a.brk };
    }
    if (!groups[k]) { groups[k] = { date: a.date, store: a.store, name: a.name, shifts: [], att: null }; order.push(k); }
    groups[k].att = a;
  });
  // 같은 날 다른 지점에서 먼저 근무하고 이동해 오는 근무 표시
  order.forEach(function (k) {
    var g = groups[k];
    if (!g.shifts.length) return;
    var start = Math.min.apply(null, g.shifts.map(function (s) { return toMin_(s.start); }));
    g.moved = sched.some(function (s) {
      return s.date === g.date && s.name === g.name && s.store !== g.store && toMin_(s.end) != null && toMin_(s.end) <= start;
    });
  });
  var nowStr = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  var breakCap = {};
  (data.stores || getStores_()).forEach(function (st) { if (st.breakCap != null) breakCap[st.name] = st.breakCap; });
  var ctx = { staffMap: staffMap, settings: settings, breakCap: breakCap, today: data.today || todayStr_(), nowMin: data.nowMin != null ? data.nowMin : toMin_(nowStr) };
  var out = order.map(function (k) { return evaluate_(groups[k], ctx); });
  out.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.store < b.store ? -1 : a.store > b.store ? 1 : (toMin_(a.start) || 0) - (toMin_(b.start) || 0);
  });
  return out;
}

function workRow_(w) {
  return [w.ym, w.date, w.dow, w.store, w.name, w.type, w.parts, w.start, w.end, w.planned,
    w.tin, w.tout, w.actual == null ? '' : w.actual, w.credited == null ? '' : w.credited,
    w.diff == null ? '' : w.diff, w.late, w.status, w.memo, w.breakMin === '' ? '' : w.breakMin, w.expected];
}

/** 근무내역 시트에서 해당 월만 다시 계산해 교체 */
function rebuildMonth_(ym) {
  var days = daysInMonth_(ym);
  var fresh = computeRange_(days[0], days[days.length - 1]).map(workRow_);
  var keep = readRows_(SH.work).filter(function (r) { return r[0] && r[0] !== ym; });
  var all = keep.concat(fresh).map(function (r) {
    return r.map(function (v, i) { return WORK_NUM_COLS.indexOf(i) >= 0 && v !== '' ? Number(v) : v; });
  });
  all.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : (toMin_(a[7]) || 0) - (toMin_(b[7]) || 0); });
  writeRows_(SH.work, all);
  // 이 달 날짜는 이번 달 또는 다음 달에 끝나는 주에 속하므로 두 달 다 주휴수당 갱신
  rebuildWeekly_(ym);
  rebuildWeekly_(nextYm_(ym));
}

/* =========================================================
 * 주휴수당 (알바 · 일~토 주 단위 · 토요일이 속한 달에 포함)
 * ======================================================= */

/** ym 달에 '토요일'이 있는 주들의 주휴수당 계산 */
function weeklyRows_(ym, data) {
  data = data || {};
  var days = daysInMonth_(ym);
  var sats = days.filter(function (d) { return dow_(d) === 6; });
  var from = addDays_(sats[0], -6), to = sats[sats.length - 1];
  var staff = data.staff || getStaff_();
  var staffMap = {};
  staff.forEach(function (s) { staffMap[s.name] = s; });
  var works = computeRange_(from, to, { settings: data.settings, staff: staff, sched: data.sched, att: data.att, today: data.today, nowMin: data.nowMin });
  var names = uniq_(works.filter(function (w) { return w.planned > 0 && (staffMap[w.name] || {}).type !== '직원'; }).map(function (w) { return w.name; }));
  names.sort();
  var rows = [];
  sats.forEach(function (sat) {
    var ws = addDays_(sat, -6);
    names.forEach(function (n) {
      var es = works.filter(function (w) { return w.name === n && w.date >= ws && w.date <= sat && w.planned > 0; });
      if (!es.length) return;
      var sched = es.reduce(function (a, w) { return a + w.planned; }, 0);
      var workDays = uniq_(es.map(function (w) { return w.date; })).length;
      var absent = uniq_(es.filter(function (w) { return w.status === '결근'; }).map(function (w) { return w.date; })).length;
      var pending = es.some(function (w) { return /예정|미출근|근무중/.test(w.status); });
      var ok15 = sched >= 15 * 60;
      var juMin = ok15 ? Math.round(Math.min(sched, 40 * 60) / 5) : 0;
      var wage = (staffMap[n] || {}).wage || 0;
      // (주 시간 ÷ 40) × 8 × 시급 → 10원 단위 올림
      var raw = ok15 ? Math.min(sched, 40 * 60) * wage / 300 : 0;
      var amount = absent ? 0 : Math.ceil(raw / 10 - 1e-9) * 10;
      var verdict = !ok15 ? '미지급(15시간 미만)' : absent ? '미지급(결근)' : pending ? '진행중' : !wage ? '시급 미입력' : '지급';
      // 예상 주휴: 기록이 없는 날도 스케줄대로 일했다고 보고 계산 (주 15시간 이상이면 지급)
      var expAmount = ok15 && wage ? Math.ceil(raw / 10 - 1e-9) * 10 : 0;
      rows.push([ym, ws, sat, n, (staffMap[n] || {}).type || '알바', sched, workDays, absent, ok15 ? 'O' : 'X', absent ? 'X' : (pending ? '-' : 'O'),
        absent ? 0 : juMin, wage, amount, verdict, expAmount]);
    });
  });
  return rows;
}

function rebuildWeekly_(ym) {
  var fresh = weeklyRows_(ym);
  var keep = readRows_(SH.ju).filter(function (r) { return r[0] && r[0] !== ym; });
  var all = keep.concat(fresh).map(function (r) {
    return r.map(function (v, i) { return JU_NUM_COLS.indexOf(i) >= 0 && v !== '' ? Number(v) : v; });
  });
  all.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0; });
  writeRows_(SH.ju, all);
}

/* =========================================================
 * 출퇴근 페이지 API
 * ======================================================= */
function getCheckinInfo(storeParam) {
  var stores = getStores_();
  var store = findStore_(storeParam, stores);
  if (!store) throw new Error('지점을 찾을 수 없어요. QR 주소를 확인해주세요.');
  var settings = getSettings_();
  var today = todayStr_();
  var allStaff = getStaff_();
  var staff = allStaff.filter(function (s) { return s.status !== '퇴사'; });
  var todayRows = computeRange_(today, today, { settings: settings, staff: allStaff, stores: stores }).filter(function (w) { return w.store === store.name; });
  return {
    store: { name: store.name, area: store.area, memo: store.memo, noBreak: store.noBreak, hideBreakBtn: store.hideBreakBtn },
    needLocation: settings.locationCheck && !isNaN(store.lat) && !isNaN(store.lng),
    radius: settings.radius,
    logoUrl: settings.logoUrl,
    today: today,
    dow: DAY_KO[dow_(today)],
    staff: staff.map(function (s) { return { name: s.name, type: s.type, color: s.color }; }),
    todayList: todayRows.map(publicWork_)
  };
}

function publicWork_(w) {
  return { name: w.name, type: w.type, parts: w.parts, start: w.start, end: w.end, deadline: w.deadline, tin: w.tin, tout: w.tout, status: w.status, late: w.late, planned: w.planned, actual: w.actual,
    breakOpen: w.breakOpen, breaks: w.breaks, breakMin: w.breakMin };
}

/**
 * 출근/퇴근 기록
 * @param req {store, name, kind:'출근'|'퇴근', lat, lng, acc}
 */
function checkIn(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var stores = getStores_();
    var store = findStore_(req.store, stores);
    if (!store) throw new Error('지점을 찾을 수 없어요.');
    var settings = getSettings_();
    var name = String(req.name || '').trim();
    var staffMap = {};
    var allStaff = getStaff_();
    allStaff.forEach(function (s) { staffMap[s.name] = s; });
    if (!staffMap[name]) throw new Error('직원 목록에 없는 이름이에요: ' + name);
    var kind = req.kind === '퇴근' ? '퇴근' : req.kind === '휴게' ? '휴게' : '출근';
    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    var lat = req.lat == null ? '' : Number(req.lat), lng = req.lng == null ? '' : Number(req.lng);
    var acc = req.acc == null ? '' : Math.round(req.acc);

    // 위치 확인
    var dist = '';
    if (settings.locationCheck && !isNaN(store.lat) && !isNaN(store.lng)) {
      if (lat === '' || lng === '') {
        appendRow_(SH.log, [stamp, store.name, name, kind, '거절(위치없음)', '', '', '', '']);
        return { ok: false, reason: 'location', message: '위치 정보를 받을 수 없어요. 휴대폰 위치 권한을 허용해주세요.' };
      }
      dist = distM_(lat, lng, store.lat, store.lng);
      if (dist > settings.radius) {
        appendRow_(SH.log, [stamp, store.name, name, kind, '거절(위치)', String(lat), String(lng), String(acc), String(dist)]);
        return { ok: false, reason: 'far', distance: dist, message: store.name + '에서 ' + dist + 'm 떨어져 있어요. 매장 안에서 다시 시도해주세요.' };
      }
    }

    var today = todayStr_();
    var hm = nowHM_();
    var sh = sheet_(SH.att);
    var rows = readRows_(SH.att);
    var idx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (normDate_(rows[i][0]) === today && rows[i][1] === store.name && String(rows[i][2]).trim() === name) { idx = i; break; }
    }
    var result, recorded = hm;
    var breakState = '';
    if (kind === '휴게') {
      if (idx < 0 || !rows[idx][3]) {
        appendRow_(SH.log, [stamp, store.name, name, kind, '거절(출근없음)', String(lat), String(lng), String(acc), String(dist)]);
        return { ok: false, reason: 'noin', message: '오늘 ' + store.name + ' 출근 기록이 없어요. 출근을 먼저 찍어주세요.' };
      }
      var brks = parseBreaks_(rows[idx][6]);
      var txt = String(rows[idx][6] || '').trim();
      if (brks.length && brks[brks.length - 1][1] == null) {
        txt = txt.replace(/-\s*$/, '') + '-' + hm;   // 휴게 끝
        breakState = '끝'; result = '휴게끝';
      } else {
        txt = (txt ? txt + ', ' : '') + hm + '-';     // 휴게 시작
        breakState = '시작'; result = '휴게시작';
      }
      sh.getRange(idx + 2, 7).setNumberFormat('@').setValue(txt);
    } else if (kind === '출근') {
      if (idx >= 0 && rows[idx][3]) { result = '유지'; recorded = fmtMin_(toMin_(rows[idx][3])); }
      else if (idx >= 0) { sh.getRange(idx + 2, 4).setNumberFormat('@').setValue(hm); result = '기록'; }
      else { appendRow_(SH.att, [today, store.name, name, hm, '', '', '']); result = '기록'; }
    } else {
      if (idx >= 0) { result = rows[idx][4] ? '갱신' : '기록'; sh.getRange(idx + 2, 5).setNumberFormat('@').setValue(hm); }
      else { appendRow_(SH.att, [today, store.name, name, '', hm, '', '']); result = '기록(출근없음)'; }
    }
    appendRow_(SH.log, [stamp, store.name, name, kind === '휴게' ? '휴게' + breakState : kind, result, String(lat), String(lng), String(acc), String(dist)]);
    SpreadsheetApp.flush();

    var todays = computeRange_(today, today, { settings: settings, staff: allStaff, stores: stores });
    var mine = todays.filter(function (w) { return w.name === name && w.store === store.name; })[0] || null;
    var elsewhere = todays.filter(function (w) { return w.name === name && w.store !== store.name && w.planned > 0; })
      .map(function (w) { return w.store + ' ' + w.parts + ' ' + w.start + '–' + w.end; });

    // 근무내역·주휴수당 재계산은 1분 안에 자동(minutely)으로 함 → 버튼 응답이 빨라짐
    markDirty_(ymOf_(today));

    return {
      ok: true, kind: kind, result: result, breakState: breakState, time: recorded, store: store.name, name: name,
      work: mine ? publicWork_(mine) : null, elsewhere: elsewhere,
      todayList: todays.filter(function (w) { return w.store === store.name; }).map(publicWork_)
    };
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
 * 스케줄 페이지 API (직원 열람 + 관리자)
 * ======================================================= */
function checkPin_(pin) {
  var s = getSettings_();
  if (!pin || String(pin) !== String(s.pin)) throw new Error('관리자 비밀번호가 맞지 않아요.');
}

function adminLogin(pin) {
  checkPin_(pin);
  return true;
}

/**
 * 직원용 출퇴근 현황판 데이터 (비밀번호 없음 · 근무 판정 결과만)
 */
function getBoardData(ym) {
  var today = todayStr_();
  if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = ymOf_(today);
  var settings = getSettings_();
  var staff = getStaff_();
  var days = daysInMonth_(ym);
  var work = computeRange_(days[0], days[days.length - 1], { settings: settings, staff: staff })
    .filter(function (w) { return w.planned > 0 || w.tin || w.tout; })
    .map(function (w) {
      return { date: w.date, store: w.store, name: w.name, parts: w.parts, start: w.start, end: w.end, deadline: w.deadline,
        tin: w.tin, tout: w.tout, planned: w.planned, actual: w.actual, late: w.late, status: w.status };
    });
  var active = {};
  work.forEach(function (w) { active[w.name] = 1; });
  // 선택 가능한 달: 기록 시작 달 ~ 이번 달
  var months = [], m = ymOf_(settings.startDate < today ? settings.startDate : today);
  for (var i = 0; i < 36 && m <= ymOf_(today); i++) { months.push(m); m = nextYm_(m); }
  if (months.indexOf(ym) < 0) months.push(ym);
  months.sort();
  return {
    ym: ym, today: today, nowMin: toMin_(nowHM_()), startDate: settings.startDate, months: months,
    stores: getStores_().map(function (s) { return { name: s.name, area: s.area }; }),
    staff: staff.filter(function (s) { return s.status !== '퇴사' || active[s.name]; })
      .map(function (s) { return { name: s.name, type: s.type, color: s.color }; }),
    work: work,
    prep: { staff: settings.prepStaff, part: settings.prepPart },
    logoUrl: settings.logoUrl
  };
}

function nextYm_(ym) {
  var y = +ym.slice(0, 4), mo = +ym.slice(5, 7) + 1;
  if (mo === 13) { y++; mo = 1; }
  return y + '-' + pad2_(mo);
}

/** 달력에 필요한 데이터. pin이 맞으면 출퇴근·근무내역까지 포함 */
function getMonthData(ym, pin) {
  var isAdmin = false;
  if (pin) { checkPin_(pin); isAdmin = true; }
  if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = ymOf_(todayStr_());
  var days = daysInMonth_(ym);
  var from = addDays_(days[0], -dow_(days[0]));
  var lastDay = days[days.length - 1];
  var to = addDays_(lastDay, 6 - dow_(lastDay));

  var settings = getSettings_();
  var staff = getStaff_();
  var sched = readRows_(SH.sched).map(schedObj_);
  var hol = getHolidays_();
  var res = {
    ym: ym, from: from, to: to, today: todayStr_(), isAdmin: isAdmin,
    stores: getStores_().map(function (s) { return { name: s.name, area: s.area, memo: s.memo, noBreak: s.noBreak, breakCap: s.breakCap, hasLocation: !isNaN(s.lat) && !isNaN(s.lng) }; }),
    hours: getHours_(),
    staff: staff.filter(function (s) { return isAdmin || s.status !== '퇴사'; })
      .map(function (s) { return { name: s.name, type: s.type, status: s.status, color: s.color }; }),
    holidays: hol,
    schedule: sched.filter(function (s) { return s.date >= from && s.date <= to; }),
    memos: readRows_(SH.memo).map(function (r) { return { date: normDate_(r[0]), pos: r[1], text: r[2] }; })
      .filter(function (m) { return m.date >= from && m.date <= to && m.text; }),
    logoUrl: settings.logoUrl,
    prep: { staff: settings.prepStaff, part: settings.prepPart },
    brk: { at30: settings.break30At, at60: settings.break60At }
  };
  if (isAdmin) {
    res.work = computeRange_(from, to, { settings: settings, staff: staff, sched: sched }).map(publicWorkAdmin_);
    res.startDate = settings.startDate;
  }
  return res;
}

function publicWorkAdmin_(w) {
  var o = publicWork_(w);
  o.date = w.date; o.store = w.store; o.credited = w.credited; o.diff = w.diff; o.memo = w.memo;
  return o;
}

/**
 * 하루치 스케줄 저장 (해당 날짜를 통째로 교체)
 * shifts: [{store,name,part,start,end,memo}], memos: [{pos,text}]
 */
function saveDay(pin, date, shifts, memos) {
  checkPin_(pin);
  date = normDate_(date);
  if (!date) throw new Error('날짜가 올바르지 않아요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var clean = (shifts || []).filter(function (s) { return s && s.name && s.store; }).map(function (s) {
      var a = toMin_(s.start), b = toMin_(s.end);
      if (a == null || b == null || b <= a) throw new Error(s.name + ' 님의 근무시간을 확인해주세요 (' + (s.start || '?') + '–' + (s.end || '?') + ')');
      return [date, s.store, String(s.name).trim(), s.part || '근무', fmtMin_(a), fmtMin_(b), s.memo || ''];
    });
    replaceDates_(SH.sched, [date], clean);
    var mm = (memos || []).filter(function (m) { return m && String(m.text || '').trim(); })
      .map(function (m) { return [date, m.pos || '상단', String(m.text).trim()]; });
    replaceDates_(SH.memo, [date], mm);
    SpreadsheetApp.flush();
    rebuildMonth_(ymOf_(date));
  } finally { lock.releaseLock(); }
  return getMonthData(ymOf_(date), pin);
}

/**
 * 여러 날짜를 한 번에 저장 (관리자 화면에서 [시트에 저장] 눌렀을 때)
 * days: [{date, shifts:[...], memos:[...]}]
 */
function saveDays(pin, days, viewYm) {
  checkPin_(pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var dates = [], schedRows = [], memoRows = [], months = {};
    (days || []).forEach(function (day) {
      var date = normDate_(day.date);
      if (!date) return;
      dates.push(date); months[ymOf_(date)] = 1;
      (day.shifts || []).filter(function (s) { return s && s.name && s.store; }).forEach(function (s) {
        var a = toMin_(s.start), b = toMin_(s.end);
        if (a == null || b == null || b <= a) throw new Error(date + ' ' + s.name + ' 님의 근무시간을 확인해주세요 (' + (s.start || '?') + '–' + (s.end || '?') + ')');
        schedRows.push([date, s.store, String(s.name).trim(), s.part || '근무', fmtMin_(a), fmtMin_(b), s.memo || '']);
      });
      (day.memos || []).filter(function (m) { return m && String(m.text || '').trim(); }).forEach(function (m) {
        memoRows.push([date, m.pos || '상단', String(m.text).trim()]);
      });
    });
    if (dates.length) {
      replaceDates_(SH.sched, dates, schedRows);
      replaceDates_(SH.memo, dates, memoRows);
      SpreadsheetApp.flush();
      Object.keys(months).forEach(rebuildMonth_);
    }
  } finally { lock.releaseLock(); }
  return getMonthData(viewYm || ymOf_(todayStr_()), pin);
}

/** 한 주(일~토) 스케줄을 다른 주로 복사 (대상 주의 스케줄은 덮어씀) */
function copyWeek(pin, fromSunday, toSunday, viewYm) {
  checkPin_(pin);
  fromSunday = normDate_(fromSunday); toSunday = normDate_(toSunday);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var all = readRows_(SH.sched).map(schedObj_);
    var targets = [], rows = [], months = {};
    for (var i = 0; i < 7; i++) {
      var src = addDays_(fromSunday, i), dst = addDays_(toSunday, i);
      targets.push(dst); months[ymOf_(dst)] = 1;
      all.filter(function (s) { return s.date === src; }).forEach(function (s) {
        rows.push([dst, s.store, s.name, s.part, s.start, s.end, s.memo || '']);
      });
    }
    replaceDates_(SH.sched, targets, rows);
    SpreadsheetApp.flush();
    Object.keys(months).forEach(rebuildMonth_);
  } finally { lock.releaseLock(); }
  return getMonthData(viewYm || ymOf_(toSunday), pin);
}

/** 지정한 날짜들의 행을 지우고 새 행을 넣음 (날짜순 정렬) */
function replaceDates_(name, dates, newRows) {
  var keep = readRows_(name).filter(function (r) { return r[0] && dates.indexOf(normDate_(r[0])) < 0; });
  var all = keep.concat(newRows);
  all.sort(function (a, b) {
    var da = normDate_(a[0]), db = normDate_(b[0]);
    if (da !== db) return da < db ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return (toMin_(a[4]) || 0) - (toMin_(b[4]) || 0);
  });
  writeRows_(name, all);
}

function toggleHoliday(pin, date, label, viewYm) {
  checkPin_(pin);
  date = normDate_(date);
  var rows = readRows_(SH.hol).filter(function (r) { return r[0]; });
  var exists = rows.some(function (r) { return normDate_(r[0]) === date; });
  rows = rows.filter(function (r) { return normDate_(r[0]) !== date; });
  if (!exists) rows.push([date, label || '공휴일']);
  rows.sort(function (a, b) { return normDate_(a[0]) < normDate_(b[0]) ? -1 : 1; });
  writeRows_(SH.hol, rows);
  rebuildMonth_(ymOf_(date));
  return getMonthData(viewYm || ymOf_(date), pin);
}

/** 관리자가 매장 안에서 '현재 위치를 매장 위치로' 등록 */
function setStoreLocation(pin, storeName, lat, lng) {
  checkPin_(pin);
  var sh = sheet_(SH.stores);
  var rows = readRows_(SH.stores);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === storeName) {
      sh.getRange(i + 2, 3, 1, 2).setNumberFormat('@').setValues([[String(lat), String(lng)]]);
      return true;
    }
  }
  throw new Error('지점을 찾을 수 없어요: ' + storeName);
}

/** 관리자 출퇴근 시간 수정 (빈칸이면 기록 삭제) */
function saveAttendance(pin, date, store, name, tin, tout, memo, viewYm, brk) {
  checkPin_(pin);
  date = normDate_(date);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var a = toMin_(tin), b = toMin_(tout);
    var all = readRows_(SH.att);
    var same = function (r) { return normDate_(r[0]) === date && r[1] === store && String(r[2]).trim() === name; };
    var old = all.filter(same)[0] || [];
    var rows = all.filter(function (r) { return r[0] && !same(r); });
    // 메모·휴게는 새로 넘어오지 않으면 기존 값을 유지
    // 자동입력 기록을 관리자가 고치면 더 이상 스케줄을 따라가지 않도록 메모를 바꿈
    var keepMemo = memo ? String(memo) : (/^자동입력/.test(String(old[5] || '')) ? '관리자 수정' : (old[5] || ''));
    var keepBrk = brk != null ? String(brk).trim() : (old[6] || '');
    if (a != null || b != null) {
      rows.push([date, store, name, fmtMin_(a), fmtMin_(b), keepMemo, keepBrk]);
    }
    rows.sort(function (x, y) { return normDate_(x[0]) < normDate_(y[0]) ? -1 : normDate_(x[0]) > normDate_(y[0]) ? 1 : 0; });
    writeRows_(SH.att, rows);
    SpreadsheetApp.flush();
    rebuildMonth_(ymOf_(date));
  } finally { lock.releaseLock(); }
  return getMonthData(viewYm || ymOf_(date), pin);
}
