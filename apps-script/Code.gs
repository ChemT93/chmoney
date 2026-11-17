/**
 * 가계부 웹앱 (Apps Script 서버 쪽)
 * 스프레드시트 > 확장 프로그램 > Apps Script 에 붙여넣고 "웹 앱"으로 배포합니다.
 * 배포 설정: 실행 사용자 = 나, 액세스 권한 = 모든 사용자 (비밀 키로 보호)
 * 월별 탭("1월", "2월" … 또는 "2026.01" 같은 이름)에서 머리글을 찾아 표 구조를 자동으로 알아냅니다.
 */
const CONFIG = {
  // 연도별 스프레드시트: '' = 이 스크립트가 붙어 있는 시트. 다른 해는 그 시트의 주소(URL)를 따옴표 안에 붙여넣으세요.
  SHEETS: {
    2026: '',
    // 2025: 'https://docs.google.com/spreadsheets/d/여기에-주소/edit',
  },
  APP_URL: 'https://chemt93.github.io/chmoney/',   // 휴대폰 앱 주소 (GitHub Pages)
  API_URL: 'https://script.google.com/macros/s/AKfycbxVXgVjSk4pI38qvW91FZpjVl_2chnvCW8dcju7XnmQO1gZiw1anB0pjxWcnce8tGJ0/exec',   // 이 스크립트의 웹 앱 주소
  HEADER_SCAN_ROWS: 40,     // 머리글을 찾을 위쪽 줄 수
  EMPTY_STOP: 30,           // 빈 줄이 이만큼 이어지면 표가 끝난 것으로 봄
  INCOME_CAT: '수입',        // 수입 표의 대항목 값 (실제 종류는 소항목에 적음)
  COLS: {                   // 머리글 이름 후보 (띄어쓰기 무시, 앞부분 일치)
    date:   ['날짜', '일자', '일'],
    type:   ['구분', '수입/지출', '수입지출'],
    sub:    ['소항목', '세부항목', '세부분류'],
    cat:    ['대항목', '항목', '분류', '카테고리'],
    memo:   ['내용', '메모', '내역', '적요', '비고', '사용처'],
    amount: ['금액', '수입금액', '지출금액'],
    pay:    ['지출구분', '수입구분', '결제수단', '결제', '수단', '카드']
  }
};

/* ---------- 앱과 주고받기 ----------
 * 휴대폰 앱(GitHub Pages)이 POST로 {key, fn, args}를 보내면, 키가 맞을 때만 시트를 읽고 씁니다.
 * 비밀 키는 코드가 아니라 [프로젝트 설정 > 스크립트 속성]의 APP_KEY 에 저장합니다.
 */
function doGet() {
  return ContentService.createTextOutput('가계부 서버가 동작 중입니다.');
}

function doPost(e) {
  const API = { getBootstrap: getBootstrap, getMonth: getMonth, getYear: getYear, getSummary: getSummary, addEntry: addEntry, updateEntry: updateEntry, deleteEntry: deleteEntry, deleteEntries: deleteEntries };
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const key = PropertiesService.getScriptProperties().getProperty('APP_KEY');
    const cache = CacheService.getScriptCache(), fails = Number(cache.get('auth_fail') || 0);
    if (!key || key.length < 8) out = { ok: false, error: '서버에 비밀 키(APP_KEY)가 설정되지 않았어요.' };
    else if (fails >= 10) out = { ok: false, code: 429, error: '틀린 키가 여러 번 들어와 잠시 잠갔어요. 15분 뒤에 다시 시도해 주세요.' };
    else if (!sameText_(String(req.key || ''), key)) {
      cache.put('auth_fail', String(fails + 1), 900);   // 15분 안에 10번 틀리면 15분 잠금
      Utilities.sleep(1000);
      out = { ok: false, code: 401, error: '비밀 키가 맞지 않아요.' };
    }
    else if (!Object.prototype.hasOwnProperty.call(API, req.fn)) out = { ok: false, error: '알 수 없는 요청이에요.' };
    else out = { ok: true, data: API[req.fn].apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sameText_(a, b) {   // 글자 수와 상관없이 같은 시간 동안 비교
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 무작위 비밀 키를 새로 만들어 저장합니다. (키를 바꾸면 기존 휴대폰은 다시 입력해야 해요) */
function 키만들기() {
  const key = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('APP_KEY', key);
  Logger.log('새 비밀 키: ' + key + '  (각 휴대폰 앱의 시작 화면에 직접 입력하세요)');
  설치링크();
}

/** 저장된 키로 휴대폰 설치용 링크를 보여줍니다. 두 분만 있는 곳으로 보내고, 설치 후 메시지는 지우세요. */
function 설치링크() {
  const key = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!key) { Logger.log('먼저 스크립트 속성에 APP_KEY를 넣거나 키만들기를 실행하세요.'); return; }
  if (key.length < 8) Logger.log('⚠️ 키가 너무 짧아요. 8자 이상으로 바꿔 주세요.');
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(CONFIG.API_URL)) { Logger.log('먼저 CONFIG의 API_URL에 웹 앱 주소(…/exec)를 붙여넣고 저장하세요.'); return; }
  // 링크에는 키를 넣지 않습니다. 앱을 처음 열면 시작 화면에서 키를 직접 입력해요.
  Logger.log('앱 주소: ' + CONFIG.APP_URL + '  (키는 링크로 보내지 말고 직접 알려주세요)');
}

/* ---------- 구조 파악 ---------- */
const norm_ = s => String(s == null ? '' : s).replace(/\s+/g, '');
const HEADER_WORDS_ = ['구분', '대항목', '소항목', '일', '날짜', '내역', '금액', '지출구분', '수입구분'];

function monthOfSheet_(name) {
  const n = norm_(name);
  if (/연간|백업|요약|설정|분류|목록|합계/.test(n)) return null;
  let m = n.match(/(?:^|\D)(\d{1,2})월/) ||                   // 1월, 2026년1월, 26년 1월, 가계부 1월
          n.match(/^(?:\d{2}|\d{4})[.\-_\/]?(\d{1,2})$/) ||    // 2026.01, 26-1, 202601
          n.match(/^(\d{1,2})$/);                             // 1
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 1 && v <= 12 ? v : null;
}

/* ---------- 연도 → 스프레드시트 ---------- */
let Y_ = null;
const SS_CACHE_ = {};
function years_() { return Object.keys(CONFIG.SHEETS).map(Number).filter(Boolean).sort((a, b) => a - b); }
function defaultYear_() { const y = new Date().getFullYear(), ys = years_(); return ys.indexOf(y) >= 0 ? y : ys[ys.length - 1]; }
function boundYear_() { const y = years_().find(k => !String(CONFIG.SHEETS[k] || '').trim()); return y || defaultYear_(); }
function openYear_(y) {
  y = Number(y) || defaultYear_();
  if (!Object.prototype.hasOwnProperty.call(CONFIG.SHEETS, y))
    throw new Error(y + '년 스프레드시트가 연결되어 있지 않아요. Code.gs의 CONFIG.SHEETS에 추가해 주세요.');
  if (!SS_CACHE_[y]) {
    const src = String(CONFIG.SHEETS[y] || '').trim();
    if (!src) SS_CACHE_[y] = SpreadsheetApp.getActive();
    else {
      const m = src.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
      try { SS_CACHE_[y] = SpreadsheetApp.openById(m ? m[1] : src); }
      catch (err) { throw new Error(y + '년 스프레드시트를 열지 못했어요. 주소와 공유 권한을 확인해 주세요.'); }
    }
  }
  return SS_CACHE_[y];
}
function useYear_(y) { y = Number(y) || defaultYear_(); Y_ = { year: y, ss: openYear_(y) }; return Y_; }
function ss_() { return (Y_ || useYear_()).ss; }
function yr_() { return (Y_ || useYear_()).year; }
function layoutKey_(sh) { return 'layout3_' + sh.getParent().getId().slice(0, 12) + '_' + sh.getSheetId(); }
function clearLayoutCache_() { CacheService.getScriptCache().removeAll(ss_().getSheets().map(layoutKey_)); }

function monthSheets_() {
  const out = {};
  ss_().getSheets().forEach(sh => {
    const m = monthOfSheet_(sh.getName());
    if (m && !out[m]) out[m] = sh;
  });
  return out;
}

function matchKey_(text, used) {
  const h = norm_(text);
  if (!h) return null;
  for (const key of Object.keys(CONFIG.COLS)) {
    if (used[key]) continue;
    if (CONFIG.COLS[key].some(c => h === c)) return key;
  }
  for (const key of Object.keys(CONFIG.COLS)) {
    if (used[key]) continue;
    if (CONFIG.COLS[key].some(c => c.length > 1 && h.indexOf(c) === 0)) return key;
  }
  return null;
}

/** 탭 하나의 거래 표(들)를 찾는다. 수입/지출이 따로 있거나 한 표에 "구분" 열이 있는 경우 모두 처리 */
function tablesOf_(sh) {
  const cache = CacheService.getScriptCache();
  const ck = layoutKey_(sh);
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);

  const rows = Math.min(CONFIG.HEADER_SCAN_ROWS, sh.getMaxRows());
  const cols = sh.getLastColumn();
  if (cols < 1) return [];
  const v = sh.getRange(1, 1, rows, cols).getDisplayValues();
  const tables = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!CONFIG.COLS.date.some(x => norm_(v[r][c]) === x)) continue;
      const used = {}, map = {};
      let end = c;
      for (let cc = c; cc < cols; cc++) {
        const t = v[r][cc];
        if (cc > c && (!norm_(t) || CONFIG.COLS.date.some(x => norm_(t) === x))) break;
        const k = matchKey_(t, used);
        if (k) { used[k] = true; map[k] = cc + 1; }
        end = cc;
      }
      if (!map.amount) continue;
      let kind = map.type ? 'mixed' : null;
      if (!kind) {
        const near = [];
        for (let rr = Math.max(0, r - 3); rr <= r; rr++)
          for (let cc = Math.max(0, c - 1); cc <= end; cc++) near.push(norm_(v[rr][cc]));
        const s = near.join('|');
        const inc = s.indexOf('수입') >= 0, exp = s.indexOf('지출') >= 0;
        kind = inc && !exp ? 'income' : exp && !inc ? 'expense' : null;
      }
      tables.push({ headerRow: r + 1, startCol: c + 1, endCol: end + 1, map: map, kind: kind });
      c = end;
    }
  }
  // 종류를 못 정한 표: 표가 2개면 왼쪽부터 수입/지출 순서로 가정, 1개면 지출로 가정
  const unknown = tables.filter(t => !t.kind);
  if (unknown.length) {
    if (tables.length === 2 && unknown.length === 2) { tables[0].kind = 'income'; tables[1].kind = 'expense'; }
    else if (tables.length === 2) unknown[0].kind = tables.some(t => t.kind === 'income') ? 'expense' : 'income';
    else unknown.forEach(t => t.kind = 'expense');
  }
  // 같은 열에 표가 위아래로 있으면 위 표는 아래 표 머리글 전에서 끝남
  tables.forEach(t => {
    const below = tables.filter(o => o.headerRow > t.headerRow && o.startCol <= t.endCol && o.endCol >= t.startCol)
                        .sort((a, b) => a.headerRow - b.headerRow)[0];
    t.lastRow = below ? below.headerRow - 1 : 0;
  });
  cache.put(ck, JSON.stringify(tables), 600);
  return tables;
}

/** 표의 데이터 영역(머리글 다음 ~ 합계 줄 전) 읽기
 *  extra: 시트의 마지막 내용 줄 아래로 더 읽을 줄 수. 맨 아래 표는 내용이 끝난 뒤의 빈 줄이
 *  getLastRow() 밖에 있어서, 빈 줄을 찾을 때는 그 아래까지 봐야 함 */
function readTable_(sh, t, extra) {
  const first = t.headerRow + 1;
  const last = t.lastRow || Math.min(sh.getMaxRows(), sh.getLastRow() + (extra || 0));
  if (last < first) return { first: first, values: [], display: [] };
  const width = t.endCol - t.startCol + 1;
  const rng = sh.getRange(first, t.startCol, last - first + 1, width);
  const values = rng.getValues(), display = rng.getDisplayValues();
  let stop = values.length, empties = 0;
  for (let i = 0; i < values.length; i++) {
    const rowTxt = display[i].join('');
    if (/합계|총계|소계|^계$/.test(norm_(display[i][0])) || /^합계|^총계/.test(norm_(rowTxt))) { stop = i; break; }
    if (display[i].some(x => HEADER_WORDS_.indexOf(norm_(x)) >= 0)) { values[i] = values[i].map(() => '__header__'); continue; }
    if (!norm_(rowTxt)) { if (++empties >= CONFIG.EMPTY_STOP) { stop = i + 1; break; } }
    else empties = 0;
  }
  return { first: first, values: values.slice(0, stop), display: display.slice(0, stop) };
}

function cell_(t, row, key) { return t.map[key] ? row[t.map[key] - t.startCol] : ''; }

function toDate_(v, month, year) {
  const y = year || yr_();
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v >= 1 && v <= 31) return new Date(y, month - 1, v);
  const s = String(v || '').trim();
  let m = s.match(/(\d{1,2})[.\/\-월]\s*(\d{1,2})/);
  if (m) return new Date(y, Number(m[1]) - 1, Number(m[2]));
  m = s.match(/^(\d{1,2})일?$/);
  if (m) return new Date(y, month - 1, Number(m[1]));
  return null;
}

function kindOf_(t, row) {
  if (t.kind !== 'mixed') return t.kind;
  const s = norm_(cell_(t, row, 'type'));
  return s.indexOf('수입') >= 0 ? 'income' : 'expense';
}

function entriesOf_(month) {
  const sh = monthSheets_()[month];
  if (!sh) return [];
  const out = [];
  tablesOf_(sh).forEach((t, ti) => {
    const d = readTable_(sh, t);
    d.values.forEach((row, i) => {
      if (row[0] === '__header__') return;
      // 금액 칸이 비어 있으면 내역이 아님. 0원은 날짜·분류·내용 중 하나라도 있으면 내역으로 인정
      const raw = cell_(t, row, 'amount');
      if (raw === '' || raw === null) return;
      const amt = Number(raw);
      if (isNaN(amt)) return;
      if (amt === 0 && !norm_(cell_(t, row, 'date')) && !norm_(cell_(t, row, 'cat')) && !norm_(cell_(t, row, 'memo'))) return;
      const dt = toDate_(cell_(t, row, 'date'), month);
      let cat = String(cell_(t, row, 'cat') || '').trim(), sub = String(cell_(t, row, 'sub') || '').trim();
      const kind = kindOf_(t, row);
      if (kind === 'income' && cat === CONFIG.INCOME_CAT) { cat = sub; sub = ''; }
      out.push({
        id: [yr_(), sh.getName(), ti, d.first + i].join('|'),
        kind: kind,
        date: dt ? Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
        cat: cat,
        sub: sub,
        memo: String(cell_(t, row, 'memo') || ''),
        pay: String(cell_(t, row, 'pay') || ''),
        amount: amt
      });
    });
  });
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out;
}

function listFromValidation_(sh, row, col) {
  if (!col) return [];
  const dv = sh.getRange(row, col).getDataValidation();
  if (!dv) return [];
  const type = dv.getCriteriaType(), args = dv.getCriteriaValues();
  let vals = [];
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) vals = args[0];
  else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) vals = [].concat.apply([], args[0].getDisplayValues());
  return vals.map(String).map(s => s.trim()).filter(Boolean);
}

/* ---------- 앱에서 부르는 함수 ---------- */
/** 첫 화면용 목록(분류·결제수단 등). 1년 치를 훑어 만드는 데 시간이 걸려 1시간 동안 기억해 둡니다 */
function getBootstrap(year) {
  useYear_(year);
  const cache = CacheService.getScriptCache(), ck = 'boot2_' + yr_();
  let b = null;
  try { const hit = cache.get(ck); if (hit) b = JSON.parse(hit); } catch (err) {}
  if (!b) { b = buildBootstrap_(); try { cache.put(ck, JSON.stringify(b), 3600); } catch (err) {} }
  const now = new Date();
  b.currentMonth = now.getFullYear() === b.year ? now.getMonth() + 1 : b.months[b.months.length - 1];
  b.years = years_();
  return b;
}
function clearBootCache_() { CacheService.getScriptCache().removeAll(years_().map(y => 'boot2_' + y)); }

function buildBootstrap_() {
  const sheets = monthSheets_();
  const months = Object.keys(sheets).map(Number).sort((a, b) => a - b);
  const cats = { income: [], expense: [] }, pays = { income: [], expense: [] }, subs = {};
  const add = (arr, v) => { v = String(v || '').trim(); if (v && arr.indexOf(v) < 0) arr.push(v); };
  const now = new Date();
  const curMonth = now.getFullYear() === yr_() ? now.getMonth() + 1 : months[months.length - 1];
  const ref = sheets[curMonth] || sheets[months[months.length - 1]];
  if (ref) tablesOf_(ref).forEach(t => {
    const r = t.headerRow + 1;
    const kinds = t.kind === 'mixed' ? ['income', 'expense'] : [t.kind];
    const catList = listFromValidation_(ref, r, t.map.cat);
    const subList = listFromValidation_(ref, r, t.map.sub);
    kinds.forEach(k => {
      if (k === 'income' && catList.indexOf(CONFIG.INCOME_CAT) >= 0) subList.forEach(x => add(cats.income, x));
      else catList.filter(x => x !== CONFIG.INCOME_CAT).forEach(x => add(cats[k], x));
      listFromValidation_(ref, r, t.map.pay).forEach(x => add(pays[k], x));
    });
  });
  // 실제 사용 내역에서 보충 (세부 항목은 1년 전체에서)
  months.forEach(m => entriesOf_(m).forEach(e => {
    if (e.kind === 'expense' && e.cat === CONFIG.INCOME_CAT) return;
    add(cats[e.kind], e.cat); add(pays[e.kind], e.pay);
    if (e.sub && e.cat) { subs[e.cat] = subs[e.cat] || []; add(subs[e.cat], e.sub); }
  }));
  return { year: yr_(), years: years_(), months: months, currentMonth: curMonth, cats: cats, subs: subs, pays: pays, ok: !!ref };
}

function getMonth(month, year) {
  useYear_(year);
  const entries = entriesOf_(Number(month));
  const sum = k => entries.filter(e => e.kind === k).reduce((s, e) => s + e.amount, 0);
  const byCat = {};
  entries.filter(e => e.kind === 'expense').forEach(e => { const k = e.cat || '미분류'; byCat[k] = (byCat[k] || 0) + e.amount; });
  return { month: Number(month), entries: entries, income: sum('income'), expense: sum('expense'), byCat: byCat };
}

function getYear(year) {
  useYear_(year);
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const es = entriesOf_(m);
    out.push({
      month: m,
      income: es.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0),
      expense: es.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0)
    });
  }
  return out;
}

/** 월 탭 왼쪽 요약 영역(고정·유동지출, 항목별수입, 지출구분, 잔액, 저축현황)을 화면에 보이는 그대로 읽기 */
function getSummary(month, year) {
  useYear_(year);
  const sh = monthSheets_()[Number(month)];
  if (!sh) throw new Error(month + '월 탭을 찾지 못했어요.');
  const t = tablesOf_(sh)[0];
  const limit = t ? t.startCol - 1 : sh.getLastColumn();
  // 거래 표 왼쪽에서 "항목" 머리글이 있는 열을 시작으로
  const top = sh.getRange(1, 1, 6, limit).getDisplayValues();
  let sc = -1;
  for (let r = 0; r < top.length && sc < 0; r++)
    for (let c = 0; c < limit; c++) if (norm_(top[r][c]) === '항목') { sc = c + 1; break; }
  if (sc < 0) throw new Error('요약표("항목" 머리글)를 찾지 못했어요.');
  const nRows = Math.min(sh.getLastRow(), 150), nCols = limit - sc + 1;
  const rng = sh.getRange(1, sc, nRows, nCols);
  const vals = rng.getDisplayValues(), bgs = rng.getBackgrounds(), fw = rng.getFontWeights(), fc = rng.getFontColors();
  // 완전히 빈 열이 나오면 요약 영역이 끝난 것으로 봄 (거래 표와 사이의 빈 열)
  let width = nCols;
  for (let c = 1; c < nCols; c++) if (vals.every(row => !String(row[c]).trim())) { width = c; break; }
  let lastR = 0, lastC = 0;
  vals.forEach((row, r) => row.forEach((v, c) => { if (c < width && String(v).trim()) { lastR = Math.max(lastR, r); lastC = Math.max(lastC, c); } }));
  let firstR = vals.findIndex(row => row.some(v => String(v).trim()));
  if (firstR < 0) firstR = 0;
  const cut = a => a.slice(firstR, lastR + 1).map(row => row.slice(0, lastC + 1));
  const merges = rng.getMergedRanges().map(m => [m.getRow() - 1 - firstR, m.getColumn() - sc, m.getNumRows(), m.getNumColumns()])
    .filter(m => m[0] >= 0 && m[1] <= lastC);
  return { cols: lastC + 1, rows: cut(vals), bg: cut(bgs), bold: cut(fw).map(r => r.map(x => x === 'bold')), color: cut(fc), merges: merges };
}

/* ---------- 쓰기: 추가 · 수정 · 삭제 ---------- */
function checkEntry_(e) {
  const date = new Date(e.date + 'T00:00:00');
  if (isNaN(date)) throw new Error('날짜를 확인해 주세요.');
  useYear_(date.getFullYear());   // 날짜의 연도에 해당하는 스프레드시트로
  const amount = Math.round(Number(e.amount));
  if (e.amount === '' || e.amount == null || isNaN(amount) || amount < 0) throw new Error('금액을 확인해 주세요.');   // 0원은 허용
  if (e.kind !== 'income' && e.kind !== 'expense') throw new Error('수입/지출 구분을 확인해 주세요.');
  const month = date.getMonth() + 1;
  const sh = monthSheets_()[month];
  if (!sh) throw new Error(month + '월 탭을 찾지 못했어요.');
  const tables = tablesOf_(sh);
  let ti = tables.findIndex(x => x.kind === e.kind);
  if (ti < 0) ti = tables.findIndex(x => x.kind === 'mixed');
  if (ti < 0) throw new Error((e.kind === 'income' ? '수입' : '지출') + ' 표를 찾지 못했어요.');
  return { date: date, month: month, amount: amount, sh: sh, t: tables[ti], ti: ti };
}

/** 한 줄에 내역을 적는다 (비어 있는 값은 칸을 비움) */
function writeRow_(v, row, e) {
  const sh = v.sh, t = v.t;
  const put = (key, val) => { if (t.map[key]) sh.getRange(row, t.map[key]).setValue(val == null ? '' : val); };
  const d = readTable_(sh, t);
  const sample = d.values.map(r => cell_(t, r, 'date')).find(x => x !== '' && x !== '__header__');
  put('date', typeof sample === 'number' ? v.date.getDate() : v.date);   // 시트가 "일"만 적는 방식이면 숫자로
  if (t.kind === 'mixed') put('type', e.kind === 'income' ? '수입' : '지출');
  const incomeStyle = e.kind === 'income' && t.map.sub &&
    listFromValidation_(sh, t.headerRow + 1, t.map.cat).indexOf(CONFIG.INCOME_CAT) >= 0;
  if (incomeStyle) { put('cat', CONFIG.INCOME_CAT); put('sub', e.cat); }
  else { put('cat', e.cat); put('sub', e.sub); }
  put('memo', e.memo); put('pay', e.pay);
  put('amount', v.amount);
}

function emptyRow_(v) {
  const t = v.t, d = readTable_(v.sh, t, 50);
  const idx = d.values.findIndex(row => row[0] !== '__header__' && Object.keys(t.map).every(k => !norm_(cell_(t, row, k))));
  if (idx < 0) throw new Error(v.month + '월 ' + (t.kind === 'income' ? '수입' : '지출') + ' 표에 빈 줄이 없어요. 시트에서 줄을 추가해 주세요.');
  return d.first + idx;
}

/** id("탭|표번호|행")가 가리키는 줄을 찾고, 금액이 그대로인지 확인 */
/** id가 가리키는 줄을 찾고, 앱에서 본 내용(금액·날짜·내용)과 지금 시트가 같은지 확인 */
function locate_(id, ref) {
  const want = (ref && typeof ref === 'object') ? ref : { amount: ref };   // 예전 형식: 금액만
  let p = String(id).split('|');
  if (p.length === 3) p = [defaultYear_()].concat(p);   // 예전 형식
  const sh = openYear_(p[0]).getSheetByName(p[1]);
  if (!sh) throw new Error('탭을 찾지 못했어요.');
  const t = tablesOf_(sh)[Number(p[2])], row = Number(p[3]);
  if (!t || !row) throw new Error('표를 찾지 못했어요.');
  const changed = () => { throw new Error('시트 내용이 바뀌었어요. 화면을 당겨 새로고침한 뒤 다시 시도해 주세요.'); };
  if (Number(sh.getRange(row, t.map.amount).getValue()) !== Number(want.amount)) changed();
  if (want.memo !== undefined && t.map.memo &&
      String(sh.getRange(row, t.map.memo).getValue() || '').trim() !== String(want.memo || '').trim()) changed();
  if (want.date !== undefined && t.map.date) {
    const dt = toDate_(sh.getRange(row, t.map.date).getValue(), monthOfSheet_(sh.getName()), Number(p[0]));
    const got = dt ? Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    if (got !== String(want.date || '')) changed();
  }
  return { sh: sh, t: t, ti: Number(p[2]), row: row };
}
function clearRow_(loc) { Object.keys(loc.t.map).forEach(k => loc.sh.getRange(loc.row, loc.t.map[k]).clearContent()); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { const r = fn(); SpreadsheetApp.flush(); clearBootCache_(); return r; } finally { lock.releaseLock(); }
}

function addEntry(e) {
  const v = checkEntry_(e);
  return withLock_(() => { const row = emptyRow_(v); writeRow_(v, row, e); return { ok: true, row: row, sheet: v.sh.getName() }; });
}

/** 내역 수정: 같은 달·같은 표면 그 줄을 고치고, 달이나 수입/지출이 바뀌면 새 자리로 옮김 */
function updateEntry(id, oldRef, e) {
  const v = checkEntry_(e);
  return withLock_(() => {
    const loc = locate_(id, oldRef);
    if (loc.sh.getParent().getId() === v.sh.getParent().getId() && loc.sh.getSheetId() === v.sh.getSheetId() && loc.ti === v.ti) {
      writeRow_(v, loc.row, e);
      return { ok: true, moved: false, row: loc.row, sheet: v.sh.getName() };
    }
    const row = emptyRow_(v);
    writeRow_(v, row, e);
    clearRow_(loc);
    return { ok: true, moved: true, row: row, sheet: v.sh.getName() };
  });
}

/** 여러 건 삭제: 모두 확인한 뒤에 지움 (하나라도 바뀌었으면 아무것도 지우지 않음) */
function deleteEntries(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('지울 내역이 없어요.');
  return withLock_(() => {
    const locs = items.map(x => locate_(x.id, x));
    locs.forEach(clearRow_);
    return { ok: true, count: locs.length };
  });
}
function deleteEntry(id, amount) { return deleteEntries([{ id: id, amount: amount }]); }

/**
 * 편집기에서 한 번만 실행: 모든 월 탭의 수입 입력 칸을 20줄로 늘립니다.
 * - 거래 표 열(P~U)만 아래로 밀어서 왼쪽 요약표는 그대로 둡니다.
 * - 마지막 수입 줄 "위"에 끼워 넣어, 수입 칸을 가리키는 수식 범위가 함께 늘어나게 합니다.
 * - 이미 20줄 이상인 탭은 건너뜁니다. 실행 전 [파일 > 사본 만들기]로 백업을 권장합니다.
 */
function 수입칸20개로() { 늘리기_('income', 20); }

function 늘리기_(kind, target) {
  useYear_(boundYear_());
  const sheets = monthSheets_();
  Object.keys(sheets).forEach(m => {
    const sh = sheets[m];
    CacheService.getScriptCache().remove(layoutKey_(sh));
    const t = tablesOf_(sh).find(x => x.kind === kind);
    if (!t) { Logger.log(sh.getName() + ': 표를 찾지 못해 건너뜀'); return; }
    // 입력 줄 = 머리글 바로 아래부터 "대항목" 칸에 드롭다운이 있는 줄들
    const first = t.headerRow + 1;
    let last = first - 1;
    while (last + 1 <= sh.getMaxRows() && sh.getRange(last + 1, t.map.cat).getDataValidation()) last++;
    const count = last - first + 1;
    if (count < 2) { Logger.log(sh.getName() + ': 입력 줄을 확인하지 못해 건너뜀 (' + count + '줄)'); return; }
    if (count >= target) { Logger.log(sh.getName() + ': 이미 ' + count + '줄이라 건너뜀'); return; }
    const add = target - count, width = t.endCol - t.startCol + 1;
    // 마지막 입력 줄 위치에 칸 삽입 → 기존 마지막 줄은 아래로 밀림
    sh.getRange(last, t.startCol, add, width).insertCells(SpreadsheetApp.Dimension.ROWS);
    const fresh = sh.getRange(last, t.startCol, add, width);
    sh.getRange(last - 1, t.startCol, 1, width).copyTo(fresh, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    // 드롭다운은 첫 입력 줄과 똑같은 목록으로
    for (let c = t.startCol; c <= t.endCol; c++) {
      const dv = sh.getRange(first, c).getDataValidation();
      if (dv) sh.getRange(last, c, add, 1).setDataValidation(dv);
    }
    Logger.log(sh.getName() + ': ' + count + '줄 → ' + target + '줄 (' + last + '~' + (last + add - 1) + '행 추가)');
  });
  SpreadsheetApp.flush();
  clearLayoutCache_();
  Logger.log('완료. 진단을 실행해 수입/지출 표 위치를 확인해 보세요.');
}

/** 편집기에서 실행해 보세요: 각 월 탭에서 찾아낸 표 구조를 로그로 보여줍니다 */
function 진단() {
  years_().forEach(y => { try { openYear_(y); Logger.log(y + '년 시트: ' + openYear_(y).getName()); } catch (err) { Logger.log('⚠️ ' + err.message); } });
  useYear_(boundYear_());
  clearLayoutCache_();
  clearBootCache_();
  Logger.log('전체 탭: ' + ss_().getSheets().map(s => '[' + s.getName() + ']').join(' '));
  const sheets = monthSheets_();
  Logger.log('월 탭으로 알아본 것: ' + (Object.keys(sheets).map(m => m + '월=[' + sheets[m].getName() + ']').join(' ') || '없음'));
  const first = sheets[Object.keys(sheets)[0]];
  if (first) {   // 거래 표("일"/"날짜" 열부터 오른쪽 끝까지) 미리보기
    const lc = first.getLastColumn();
    const v = first.getRange(1, 1, Math.min(40, first.getMaxRows()), lc).getDisplayValues();
    let dc = -1, hr = -1;
    v.forEach((row, r) => row.forEach((x, c) => { if (dc < 0 && /^(일|날짜|일자)$/.test(norm_(x))) { dc = c; hr = r; } }));
    if (dc < 0) dc = 0;
    const show = (r, label) => {
      const cells = v[r].slice(dc).map((x, i) => x ? first.getRange(r + 1, dc + i + 1).getA1Notation() + ':' + x : '').filter(Boolean);
      Logger.log(label + ' ' + (r + 1) + '행 → ' + cells.join(' | ').slice(0, 600));
    };
    for (let r = Math.max(0, hr - 1); r <= hr; r++) show(r, '[머리글]');
    let shownExp = 0;
    for (let r = hr + 1; r < v.length && shownExp < 3; r++) {
      const kindCell = norm_(v[r][dc + 1]);
      if (kindCell && kindCell !== '수입') { show(r, '[지출 예시]'); shownExp++; }
    }
    if (hr >= 0) v[hr].forEach((x, c) => {
      if (c < dc || !x) return;
      const dv = first.getRange(hr + 2, c + 1).getDataValidation();
      if (!dv) return;
      const a = dv.getCriteriaValues()[0];
      const src = a && a.getA1Notation ? (a.getSheet().getName() + '!' + a.getA1Notation()) : String(a).slice(0, 200);
      Logger.log('[드롭다운] ' + x + ' 열 → ' + dv.getCriteriaType() + ' ' + src);
    });
  }
  Object.keys(sheets).forEach(m => {
    const sh = sheets[m];
    if (!tablesOf_(sh).length) Logger.log(sh.getName() + ': "날짜"+"금액" 머리글을 가진 표를 못 찾음');
    tablesOf_(sh).forEach((t, i) => {
      const cols = Object.keys(t.map).map(k => k + '=' + sh.getRange(t.headerRow, t.map[k]).getA1Notation()).join(', ');
      Logger.log(sh.getName() + ' 표' + (i + 1) + ' [' + t.kind + '] 머리글 ' + t.headerRow + '행' + (t.lastRow ? '~' + t.lastRow + '행' : '') + ': ' + cols);
    });
  });
  const b = getBootstrap(yr_());
  Logger.log('지출 분류: ' + b.cats.expense.join(', '));
  Logger.log('수입 분류: ' + b.cats.income.join(', '));
  Logger.log('지출 결제수단: ' + b.pays.expense.join(', '));
  Logger.log('수입 받은 곳: ' + b.pays.income.join(', '));
  Logger.log('세부 항목: ' + JSON.stringify(b.subs));
  const m = getMonth(b.currentMonth, yr_());
  Logger.log(b.currentMonth + '월 합계 → 수입 ' + m.income + ' / 지출 ' + m.expense + ' (' + m.entries.length + '건)');
}
