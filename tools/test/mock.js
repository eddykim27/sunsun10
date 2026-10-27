// Apps Script 환경을 흉내 내는 아주 작은 목(mock) — 로컬 테스트용
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEnv(opts = {}) {
  const sheets = {};
  let fakeNow = opts.now || null; // Date or null

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    _cells(fn) {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push(fn(this.r - 1 + i, this.c - 1 + j));
        out.push(row);
      }
      return out;
    }
    getDisplayValues() { return this._cells((i, j) => { const v = (this.sh.data[i] || [])[j]; return v == null ? '' : String(v); }); }
    getValues() { return this._cells((i, j) => { const v = (this.sh.data[i] || [])[j]; return v == null ? '' : v; }); }
    setValues(vals) {
      if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error(`setValues size mismatch ${vals.length}x${vals[0].length} vs ${this.nr}x${this.nc}`);
      vals.forEach((row, i) => row.forEach((v, j) => { const ri = this.r - 1 + i; this.sh.data[ri] = this.sh.data[ri] || []; this.sh.data[ri][this.c - 1 + j] = v; }));
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() { this._cells((i, j) => { if (this.sh.data[i]) this.sh.data[i][j] = ''; }); return this; }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
    getName() { return this.name; }
    getLastRow() { let n = 0; this.data.forEach((r, i) => { if (r && r.some(v => v !== '' && v != null)) n = i + 1; }); return n; }
    getLastColumn() { return Math.max(0, ...this.data.map(r => (r || []).length)); }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(_, n) { this.maxRows += n; }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    setFrozenRows() {}
  }
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
    toast: () => {}
  };
  const pad = (n) => String(n).padStart(2, '0');
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ss, flush: () => {}, getUi: () => ({}) },
    Utilities: {
      formatDate(d, tz, f) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
        return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'http://localhost:8787/' }), getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ nearMinute: () => ({ inTimezone: () => ({ create() {} }) }) }) }) }) }) },
    HtmlService: {},
    PropertiesService: (() => { const m = {}; return { getScriptProperties: () => ({ getProperty: k => m[k] || null, setProperty: (k, v) => { m[k] = v; }, deleteProperty: k => { delete m[k]; } }) }; })(),
  };
  // 시계 고정
  const RealDate = Date;
  ctx.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0 && fakeNow) super(fakeNow.getTime()); else super(...a); }
    static now() { return fakeNow ? fakeNow.getTime() : RealDate.now(); }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  ctx.__sheets = sheets;
  ctx.__setNow = (d) => { fakeNow = d; };
  return ctx;
}

function seed(env, data) {
  env.ensureSheets_();
  const put = (name, rows) => { const sh = env.__sheets[name]; if (rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows); };
  put('지점', [['1호점', '인천', '', '', '마지막 오더 5:30pm'], ['2호점', '여의도', '', '', '']]);
  put('기본근무시간', data.hours);
  put('직원', [
    ['형기', '직원', '', '재직', '', ''], ['하윤', '직원', '', '재직', '', ''], ['경동', '직원', '', '재직', '', ''],
    ['효은', '알바', '11000', '재직', '#7B3FA0', ''], ['예진', '알바', '11000', '재직', '#1F3FE0', ''], ['수현', '알바', '11000', '재직', '#8A2BE2', ''],
    ['민경', '알바', '11000', '재직', '#D41FB0', ''], ['성광', '알바', '11000', '재직', '#E8930C', ''], ['세진', '알바', '11000', '재직', '#1B1B1B', ''],
    ['주리', '알바', '11000', '재직', '#0E8F82', '']
  ]);
  put('공휴일', data.holidays);
  put('스케줄', data.sched);
  put('일정메모', data.memos);
}

module.exports = { makeEnv, seed };
