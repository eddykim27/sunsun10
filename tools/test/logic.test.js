const assert = require('assert');
const { makeEnv, seed } = require('./mock');
const data = require('../data.json');

const at = (s) => new Date(s + '+09:00');
const env = makeEnv({ now: at('2026-10-20T06:40:00') });
seed(env, data);

// 2호점 화요일: 형기 오픈 7:00 (직원 → 6:30까지), 성광 오픈 7:00-14:00 (알바 → 6:50까지)
let r = env.checkIn({ store: '2', name: '형기', kind: '출근' });
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(r.time, '6:40');
assert.strictEqual(r.work.deadline, '6:30');
assert.ok(r.work.status.includes('지각'), r.work.status);
assert.strictEqual(r.work.late, 10);
console.log('형기 6:40 출근 →', r.work.status, r.work.late + '분');

env.__setNow(at('2026-10-20T06:48:00'));
r = env.checkIn({ store: '2', name: '성광', kind: '출근' });
assert.strictEqual(r.work.status, '근무중');
console.log('성광 6:48 출근 →', r.work.status);

// 재출근은 유지
env.__setNow(at('2026-10-20T07:10:00'));
r = env.checkIn({ store: '2', name: '성광', kind: '출근' });
assert.strictEqual(r.result, '유지'); assert.strictEqual(r.time, '6:48');

// 스케줄 없는 사람
r = env.checkIn({ store: '1', name: '예진', kind: '출근' });
assert.strictEqual(r.work.status, '스케줄외');
console.log('예진 1호점(스케줄 없음) →', r.work.status);

// 성광 조퇴 13:30 (예정 14:00, 기준 10분)
env.__setNow(at('2026-10-20T13:30:00'));
r = env.checkIn({ store: '2', name: '성광', kind: '퇴근' });
assert.strictEqual(r.work.status, '조퇴'); assert.strictEqual(r.work.actual, 402);
console.log('성광 13:30 퇴근 →', r.work.status, '실근무', r.work.actual);

// 하윤 1호점 8:00-18:00 직원: 아무 기록 없음 → 오늘 아직 진행중이면 미출근
let info = env.getCheckinInfo('1');
const hy = info.todayList.find(w => w.name === '하윤');
assert.strictEqual(hy.status, '미출근');

// 밤 23:00 → 결근, 형기 퇴근누락
env.__setNow(at('2026-10-20T23:00:00'));
env.rebuildMonth_('2026-10');
const work = env.readRows_('근무내역');
const row = (n, s) => work.find(w => w[1] === '2026-10-20' && w[4] === n && w[3] === s);
assert.strictEqual(row('하윤', '1호점')[16], '결근');
assert.strictEqual(row('형기', '2호점')[16], '지각·퇴근누락');
assert.strictEqual(row('주리', '2호점')[16], '결근');
// 기록시작일(10/20) 이전은 기록전
assert.strictEqual(work.find(w => w[1] === '2026-10-19' && w[4] === '형기')[16], '기록전');
console.log('23:00 근무내역 → 하윤 결근 / 형기', row('형기', '2호점')[16]);

// 위치 확인: 2호점 위치 등록 후 먼 곳에서 시도
env.setStoreLocation('1234', '2호점', 37.5216, 126.9242);
env.__setNow(at('2026-10-21T06:50:00'));
r = env.checkIn({ store: '2', name: '예진', kind: '출근', lat: 37.5317, lng: 126.7079, acc: 10 });
assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'far');
console.log('먼 곳 →', r.message);
r = env.checkIn({ store: '2', name: '예진', kind: '출근', lat: 37.5217, lng: 126.9243, acc: 10 });
assert.ok(r.ok); assert.strictEqual(r.work.status, '근무중');

// 관리자: 당일 스케줄 변경 → 즉시 반영 (예진 7:00 → 6:30)
assert.throws(() => env.saveDay('0000', '2026-10-21', [], []));
const day = env.getMonthData('2026-10', '1234').schedule.filter(s => s.date === '2026-10-21');
const changed = day.map(s => s.name === '예진' ? Object.assign({}, s, { start: '6:30' }) : s);
const md = env.saveDay('1234', '2026-10-21', changed, [{ pos: '하단', text: '*코스트코: 형기' }]);
const yj = md.work.find(w => w.date === '2026-10-21' && w.name === '예진');
assert.strictEqual(yj.start, '6:30'); assert.ok(yj.status.includes('지각'), yj.status); assert.strictEqual(yj.late, 30);
console.log('스케줄 6:30으로 변경 후 예진 →', yj.status, yj.late + '분');
assert.strictEqual(md.memos.filter(m => m.date === '2026-10-21').length, 1);

// 관리자 출퇴근 수정
const md2 = env.saveAttendance('1234', '2026-10-21', '2호점', '예진', '06:20', '11:00', '', '2026-10');
const yj2 = md2.work.find(w => w.date === '2026-10-21' && w.name === '예진');
assert.strictEqual(yj2.status, '정상'); assert.strictEqual(yj2.actual, 280); assert.strictEqual(yj2.credited, 240);
console.log('관리자 수정 후 예진 →', yj2.status, '실', yj2.actual, '인정', yj2.credited);

// 주 복사: 10/18주 → 11/1주
const md3 = env.copyWeek('1234', '2026-10-18', '2026-11-01', '2026-11');
const nov = md3.schedule.filter(s => s.date >= '2026-11-01' && s.date <= '2026-11-07');
assert.strictEqual(nov.length, data.sched.filter(s => s[0] >= '2026-10-18' && s[0] <= '2026-10-24').length);
console.log('주 복사 →', nov.length, '건');

// 월 데이터 범위: 10월 달력은 9/27(일) ~ 10/31(토)
const m = env.getMonthData('2026-10');
assert.strictEqual(m.from, '2026-09-27'); assert.strictEqual(m.to, '2026-10-31');
assert.strictEqual(m.work, undefined); // 직원 보기에는 출퇴근 없음

// 같은 날 두 지점 근무 (10/23 형기: 1호점 8-11, 2호점 12-18)
env.__setNow(at('2026-10-23T07:20:00'));
r = env.checkIn({ store: '1', name: '형기', kind: '출근' });
assert.ok(r.elsewhere.length === 1, JSON.stringify(r.elsewhere));
console.log('형기 10/23 →', r.work.status, '| 다른 지점:', r.elsewhere[0]);

console.log('\n✅ 모든 로직 테스트 통과');

// ---------- 주휴수당 ----------
{
  const env2 = makeEnv({ now: at('2026-10-24T23:00:00') });
  seed(env2, data);
  // 10/19~10/24 주: 효은 소정 4+4+7=15h (10/19·10/21·10/23). 10/21 결근 처리 → 미지급
  const ci = (t, st, n, k) => { env2.__setNow(at(t)); env2.checkIn({ store: st, name: n, kind: k }); };
  ci('2026-10-23T10:55:00', '1', '효은', '출근'); ci('2026-10-23T18:00:00', '1', '효은', '퇴근');
  // 수현 10/20 미들 14-18(4h) 10/22 마감 15:30-20:30(5h) 10/23 미들 11-15(4h) = 13h → 15시간 미만
  // 예진 10/21 7-11(4h), 10/23 16:30-20:30(4h), 10/24 14-17(3h) = 11h
  // 성광 10/20 7-14(7h) 10/21 7-14(7h) 10/23 7-14(7h) = 21h, 전부 출근
  for (const d of ['20', '21', '23']) { ci(`2026-10-${d}T06:45:00`, '2', '성광', '출근'); ci(`2026-10-${d}T14:00:00`, '2', '성광', '퇴근'); }
  env2.__setNow(at('2026-10-25T00:30:00'));
  const rows = env2.weeklyRows_('2026-10');
  const get = (n, sat) => rows.find(r => r[3] === n && r[2] === sat);
  const sg = get('성광', '2026-10-24');
  assert.strictEqual(sg[5], 1080); assert.strictEqual(sg[10], 216); assert.strictEqual(sg[12], 39600); assert.strictEqual(sg[13], '지급');
  console.log('성광 10/18주 7h×3(휴게 1시간씩 차감=18h) →', sg[12], '원', sg[13]);
  const he = get('효은', '2026-10-24');
  assert.strictEqual(he[5], 840); assert.strictEqual(he[13], '미지급(15시간 미만)'); assert.strictEqual(he[12], 0);
  console.log('효은 4+4+7h(휴게 차감 14h) →', he[13]);
  assert.strictEqual(get('세진', '2026-10-24')[13], '미지급(15시간 미만)'); assert.strictEqual(get('수현', '2026-10-24')[13], '미지급(결근)');
  // 월 경계: 9/27~10/3 주가 10월에 포함
  const first = rows.filter(r => r[1] === '2026-09-27');
  assert.ok(first.length > 0 && first.every(r => r[0] === '2026-10'));
  console.log('9/27~10/3 주 → 10월 귀속', first.map(r => r[3] + ':' + r[5] / 60 + 'h').join(', '));
  // 직원은 제외
  assert.ok(!rows.some(r => ['형기', '하윤', '경동'].includes(r[3])));
  // 시트 재계산
  env2.rebuildMonth_('2026-10');
  assert.ok(env2.readRows_('주휴수당').length === rows.length);
  console.log('✅ 주휴수당 테스트 통과');
}

// ---------- 휴게 ----------
{
  const env3 = makeEnv({ now: at('2026-10-21T06:45:00') });
  seed(env3, data);
  const ci = (t, n, k) => { env3.__setNow(at(t)); return env3.checkIn({ store: '2', name: n, kind: k }); };
  let r = ci('2026-10-21T06:30:00', '세진', '휴게');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'noin');
  ci('2026-10-21T06:48:00', '성광', '출근');            // 성광 7:00-14:00 (7h)
  r = ci('2026-10-21T10:00:00', '성광', '휴게'); assert.strictEqual(r.breakState, '시작'); assert.ok(r.work.status.includes('휴게중'), r.work.status);
  r = ci('2026-10-21T10:40:00', '성광', '휴게'); assert.strictEqual(r.breakState, '끝'); assert.strictEqual(r.work.status, '근무중');
  r = ci('2026-10-21T14:00:00', '성광', '퇴근');
  // 실근무: 6:48~14:00 = 432 - 40(휴게) = 392 / 인정: 7:00~14:00 = 420 - max(30,40)=380 / 예정 420-30 = 390
  assert.strictEqual(r.work.actual, 392); assert.strictEqual(r.work.planned, 360);
  const w = env3.computeRange_('2026-10-21', '2026-10-21').find(x => x.name === '성광');
  assert.strictEqual(w.credited, 360); assert.strictEqual(w.breakMin, 60);
  console.log('성광 7h 근무 · 휴게 40분 찍음 → 예정', w.planned, '/ 인정', w.credited, '/ 휴게', w.breakMin);
  // 휴게 안 찍어도 5시간 이상이면 30분 차감
  ci('2026-10-21T06:50:00', '예진', '출근'); ci('2026-10-21T11:00:00', '예진', '퇴근'); // 4h → 차감 없음
  ci('2026-10-21T10:50:00', '세진', '출근'); ci('2026-10-21T17:00:00', '세진', '퇴근'); // 11-17 6h → 30분
  const all = env3.computeRange_('2026-10-21', '2026-10-21');
  assert.strictEqual(all.find(x => x.name === '예진').credited, 240);
  assert.strictEqual(all.find(x => x.name === '세진').credited, 330);
  // 직원은 차감 없음 (하윤 12-20 8h)
  assert.strictEqual(all.find(x => x.name === '하윤').planned, 480);
  // 관리자 수정해도 휴게 기록 유지
  const md = env3.saveAttendance('1234', '2026-10-21', '2호점', '성광', '06:45', '14:00', '', '2026-10');
  assert.strictEqual(env3.readRows_('출퇴근기록').find(x => x[2] === '성광')[6], '10:00-10:40');
  console.log('세진 6h → 인정 330 (30분 차감) / 예진 4h → 240 / 직원 하윤 → 차감 없음');
  console.log('✅ 휴게 테스트 통과');
}

// ---------- 휴게 규칙: 4시간마다 30분 ----------
{
  const env4 = makeEnv({ now: at('2026-10-21T08:00:00') });
  const st = env4.getSettings_ ? null : null;
  const S = { break30At: 270, break60At: 420 };
  const cases = [[240, 0], [269, 0], [270, 30], [300, 30], [390, 30], [419, 30], [420, 60], [510, 60], [600, 60]];
  cases.forEach(([stay, br]) => assert.strictEqual(env4.breakFor_(stay, S), br, stay + '분'));
  console.log('4h→0 / 4:30→30 / 6:30→30 / 7h→60 / 10h→60 ✓');
  console.log('✅ 휴게 규칙 테스트 통과');
}

// ---------- 1호점 휴게 차감 없음 ----------
{
  const env5 = makeEnv({ now: at('2026-10-24T23:00:00') });
  seed(env5, data);
  env5.__sheets['지점'].getRange(2, 6, 2, 1).setValues([['없음'], ['적용']]);
  // 10/23 효은 1호점 11-18 (7h) → 차감 없이 420 / 성광 2호점 7-14 (7h) → 390
  const ci = (t, st, n, k) => { env5.__setNow(at(t)); env5.checkIn({ store: st, name: n, kind: k }); };
  ci('2026-10-23T10:50:00', '1', '효은', '출근'); ci('2026-10-23T18:00:00', '1', '효은', '퇴근');
  ci('2026-10-23T06:50:00', '2', '성광', '출근'); ci('2026-10-23T14:00:00', '2', '성광', '퇴근');
  env5.__setNow(at('2026-10-24T23:00:00'));
  const ws = env5.computeRange_('2026-10-23', '2026-10-23');
  const he = ws.find(x => x.name === '효은'), sg = ws.find(x => x.name === '성광');
  assert.strictEqual(he.planned, 420); assert.strictEqual(he.credited, 420);
  assert.strictEqual(sg.planned, 360); assert.strictEqual(sg.credited, 360);
  // 주휴: 효은 10/18주 1호점 4h(10/19) + 4h(10/21) + 7h(10/23) = 15h → 조건 충족 (결근 없으면)
  const wk = env5.weeklyRows_('2026-10').find(r => r[3] === '효은' && r[2] === '2026-10-24');
  assert.strictEqual(wk[5], 900);
  console.log('1호점 효은 7h → 인정 420 (차감 없음) / 2호점 성광 7h → 390 / 효은 주 소정 15h');
  console.log('✅ 지점별 휴게 테스트 통과');
}

// ---------- 10원 올림 ----------
{
  const env6 = makeEnv({ now: at('2026-10-25T01:00:00') });
  seed(env6, data);
  env6.__sheets['직원'].getRange(5, 3).setValue('10333');
  const r = env6.weeklyRows_('2026-10').find(x => x[3] === '성광' && x[2] === '2026-10-24');
  // 19.5h → 3.9h × 10,333 = 40,298.7 → 40,300
  assert.strictEqual(r[5], 1080); assert.strictEqual(r[12], 0); // 기록 없음 → 결근 → 0
  const env7 = makeEnv({ now: at('2026-10-25T01:00:00') }); seed(env7, data);
  env7.__sheets['직원'].getRange(9, 3).setValue('10333');
  for (const d of ['20', '21', '23']) { env7.__setNow(at(`2026-10-${d}T06:45:00`)); env7.checkIn({ store: '2', name: '성광', kind: '출근' }); env7.__setNow(at(`2026-10-${d}T14:00:00`)); env7.checkIn({ store: '2', name: '성광', kind: '퇴근' }); }
  env7.__setNow(at('2026-10-25T01:00:00'));
  const r2 = env7.weeklyRows_('2026-10').find(x => x[3] === '성광' && x[2] === '2026-10-24');
  assert.strictEqual(r2[12], 37200);
  console.log('18h × 시급 10,333 → 37,198.8 → 37,200 (10원 올림) ✓');
}

// ---------- 1분 트리거 ----------
{
  const env8 = makeEnv({ now: at('2026-10-21T06:45:00') }); seed(env8, data);
  env8.minutely(); assert.strictEqual(env8.readRows_('근무내역').length, 0); // 변경 없으면 아무것도 안 함
  env8.checkIn({ store: '2', name: '성광', kind: '출근' });
  assert.strictEqual(env8.readRows_('근무내역').length, 0); // 버튼에서는 계산 안 함
  env8.minutely();
  const row = env8.readRows_('근무내역').find(r => r[1] === '2026-10-21' && r[4] === '성광');
  assert.ok(row && row[10] === '6:45', JSON.stringify(row));
  console.log('출근 → 1분 트리거에서 근무내역 반영 ✓');
}
