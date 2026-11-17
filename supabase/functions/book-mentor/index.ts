// Supabase Edge Function: book-mentor
// '우리 가족 기록장' 📖 독후활동 탭의 AI 독서 코치.
//   - 도서 정보는 서버에서 알라딘 검색/상세 페이지를 실제로 조회해 확인한다.
//   - 질문 생성·답변 점검·독서록 정리는 Gemini 무료 티어 API로 처리한다.
//   - GEMINI_API_KEY는 Edge Function Secret에만 있고 브라우저로 내려가지 않는다.
//
// actions
//   lookup    { title, author? }                     -> 책 정보(출판사·ISBN·분류·소개)
//   start     { book, note?, images? }               -> 책 요약 + 1번 질문
//   answer    { book, brief, qa, question, answer, step, totalSteps, attempt } -> 점검/다음 질문
//   summarize { book, brief, qa }                    -> 독서록 카드 초안

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-room-code',
  'Access-Control-Max-Age': '86400',
};

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// 무료 티어 실측(AI Studio > 비율 제한): 3.8 Flash 5 RPM / 20 RPD, 3.5 Flash Lite 15 RPM / 500 RPD
const PRIMARY_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const THIRD_MODEL = 'gemini-3.1-flash-lite';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const LIMITS = { title: 120, author: 80, note: 1500, answer: 3000, question: 600, qa: 8, images: 3 };
const IMAGE_MAX_CHARS = 2_400_000;

// ---------------------------------------------------------------- helpers
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function clip(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v));
  return s.trim().slice(0, max);
}

const ENT: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};
function text(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENT[m] || ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function fetchPage(url: string, ms = 9000): Promise<{ ok: boolean; status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const buf = await res.arrayBuffer();
    const ct = res.headers.get('content-type') || '';
    const charset = /euc-kr|ks_c_5601/i.test(ct) ? 'euc-kr' : 'utf-8';
    return { ok: res.ok, status: res.status, body: new TextDecoder(charset).decode(buf) };
  } catch (_e) {
    return { ok: false, status: 0, body: '' };
  } finally {
    clearTimeout(timer);
  }
}

// 간단한 메모리 기반 호출 제한(방 단위). 인스턴스가 살아있는 동안만 유효.
const hits = new Map<string, number[]>();
function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

// ---------------------------------------------------------------- 도서 검색 (알라딘)
type Candidate = {
  title: string;
  author: string;
  publisher: string;
  year: string;
  cover: string;
  url: string;
  category: string;
  isbn: string;
  pages: string;
  blurb: string;
  source: string;
};

function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[\[\](){}<>·.,'"`~!?:;+\-_/\\]/g, '');
}

function splitAladinItems(html: string): string[] {
  const out: string[] = [];
  const marker = 'ss_book_box" itemId="';
  let idx = html.indexOf(marker);
  while (idx >= 0 && out.length < 12) {
    const next = html.indexOf(marker, idx + marker.length);
    out.push(html.slice(idx, next > 0 ? next : idx + 20000));
    idx = next;
  }
  return out;
}

const ROLE_WORDS = /\s*\((?:지은이|지음|저자|글|그림|옮긴이|옮김|엮은이|감수|원작|사진)\)/g;
function cleanAuthor(raw: string): string {
  return text(raw)
    .replace(ROLE_WORDS, '')
    .replace(/\s*(지은이|지음|저자|옮긴이|옮김|엮은이|감수)\s*$/g, '')
    .replace(/\s*,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanCategory(raw: string): string {
  const cut = String(raw || '').split('접기')[0];
  const parts = cut.split('>').map((s) => text(s)).filter(Boolean);
  const uniq: string[] = [];
  parts.forEach((p) => { if (!uniq.includes(p)) uniq.push(p); });
  return uniq.slice(0, 4).join(' > ');
}

function parseAladinItem(block: string): Candidate | null {
  const idm = block.match(/ss_book_box"\s+itemId="(\d+)"/);
  const titleM = block.match(/class="bo3"[^>]*>([\s\S]*?)<\/a>/);
  if (!idm || !titleM) return null;
  const itemId = idm[1];
  const title = text(titleM[1]);
  if (!title) return null;

  // 두 번째 <li> 가 "지은이 (옮긴이) | 출판사 | 2026년 4월" 형태
  const lis = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const infoRaw = lis.find((li) => /지은이|옮긴이|글·그림|저자/.test(li)) || lis[1] || '';
  let author = '';
  const authorM = infoRaw.match(/<a[^>]*>([\s\S]*?)<\/a>/);
  if (authorM) author = text(authorM[1]);
  else author = text(infoRaw.split('|')[0] || '');
  const roleNames = [...infoRaw.matchAll(/<a[^>]*>([\s\S]*?)<\/a>\s*\(([^)]*)\)/g)]
    .map((m) => `${text(m[1])} ${text(m[2])}`)
    .filter(Boolean);
  if (roleNames.length) author = roleNames.join(', ');

  const parts = infoRaw.split('|').map((p) => text(p)).filter(Boolean);
  const publisher = parts.length >= 2 ? parts[parts.length - 2].replace(/\s*\(.*\)$/, '').trim() : '';
  const dateM = infoRaw.match(/(\d{4})년\s*(\d{1,2})월/);
  const year = dateM ? `${dateM[1]}-${String(dateM[2]).padStart(2, '0')}` : '';
  // 표지: front_cover(앞표지) 우선, 없으면 상품 이미지 아무거나(SpineShelf 등)
  const coverM = block.match(/src="(https:\/\/image\.aladin\.co\.kr\/product\/[^"]*\/cover\d*\/[^"]+)"/) ||
    block.match(/<img[^>]+src="(https:\/\/image\.aladin\.co\.kr\/product\/[^"]+)"/);
  const catM = block.match(/class="tit_category">([\s\S]*?)<\/span>/);

  return {
    title,
    author: cleanAuthor(author),
    publisher,
    year,
    cover: coverM ? coverM[1] : '',
    url: `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`,
    category: catM ? cleanCategory(text(catM[1])) : '',
    isbn: '',
    pages: '',
    blurb: '',
    source: 'aladin',
  };
}

function scoreCandidate(c: Candidate, title: string, author: string): number {
  const want = norm(title);
  const have = norm(c.title);
  let s = 0;
  if (have === want) s += 6;
  else if (have.startsWith(want) || want.startsWith(have)) s += 4;
  else if (have.includes(want) || want.includes(have)) s += 2;
  else {
    // 낱말이 절반 이상 겹치면 후보로 인정
    const words = title.split(/\s+/).map(norm).filter((w) => w.length > 1);
    const hit = words.filter((w) => have.includes(w)).length;
    s += words.length && hit / words.length >= 0.6 ? 1 : 0;
  }
  if (author) {
    const a = norm(author);
    if (a && norm(c.author).includes(a)) s += 3;
  }
  return s;
}

async function aladinLookup(title: string, author: string) {
  const url = 'https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&BranchType=1&SearchWord=' +
    encodeURIComponent(title);
  const page = await fetchPage(url);
  if (!page.ok) return { candidates: [] as Candidate[], error: 'search_failed' };
  const blocks = splitAladinItems(page.body);
  const candidates = blocks.map(parseAladinItem).filter((c): c is Candidate => !!c);
  return { candidates, error: '' };
}

async function aladinDetail(c: Candidate): Promise<Candidate> {
  if (!c.url) return c;
  const page = await fetchPage(c.url);
  if (!page.ok) return c;
  const html = page.body;
  const out: Candidate = { ...c };

  const infoBlock = html.match(/<div class="conts_info_list1">([\s\S]*?)<\/div>/);
  if (infoBlock) {
    const items = [...infoBlock[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    const pages = items.find((i) => /쪽$/.test(i));
    if (pages) out.pages = pages;
    const isbn = items.find((i) => /ISBN/i.test(i));
    if (isbn) out.isbn = isbn.replace(/^ISBN\s*:\s*/i, '').trim();
  }
  const catBlock = html.match(/<ul id="ulCategory">([\s\S]*?)<\/ul>/);
  if (catBlock) {
    const parts = [...catBlock[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1])).filter(Boolean);
    if (parts.length) out.category = cleanCategory(parts.join(' > '));
  }
  const og = html.match(/<meta property="og:description" content="([^"]*)"/);
  if (og) {
    const blurb = text(og[1]);
    if (blurb && blurb.length > 20) out.blurb = blurb.slice(0, 600);
  }
  return out;
}

// 알라딘이 비어 있을 때만 쓰는 보조 경로(교보문고 검색 결과에서 제목/저자/출판사 확인)
async function kyoboLookup(title: string): Promise<Candidate[]> {
  const page = await fetchPage('https://search.kyobobook.co.kr/search?keyword=' + encodeURIComponent(title));
  if (!page.ok) return [];
  const out: Candidate[] = [];
  const re = /<span id="cmdtName_(\w+)">([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(page.body)) && out.length < 8) {
    const id = m[1];
    const name = text(m[2]);
    if (!name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      title: name, author: '', publisher: '', year: '', cover: '',
      url: `https://product.kyobobook.co.kr/detail/${id}`,
      category: '', isbn: '', pages: '', blurb: '', source: 'kyobobook',
    });
  }
  return out;
}

// ---------------------------------------------------------------- Gemini
const modelState = { primaryDownDate: '', primaryBusyUntil: 0 };

type GenResult = { ok: boolean; status: number; data: Record<string, unknown>; raw: string };

async function callGemini(model: string, body: unknown, timeoutMs: number): Promise<GenResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(5000, Math.min(20000, timeoutMs)));
  try {
    const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(raw); } catch (_e) { data = {}; }
    return { ok: res.ok, status: res.status, data, raw };
  } catch (e) {
    return { ok: false, status: 0, data: {}, raw: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function isDailyQuota(raw: string): boolean {
  return /PerDay|per day|daily/i.test(raw);
}

function firstText(data: Record<string, unknown>): string {
  const c = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0];
  const parts = c?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

type JsonSchema = Record<string, unknown>;

async function askJson(schema: JsonSchema, prompt: string, images: string[], temperature: number) {
  const parts: Array<Record<string, unknown>> = [];
  for (const img of images) {
    const m = img.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
    if (!m) continue;
    parts.push({ inline_data: { mime_type: m[1].toLowerCase().replace('jpg', 'jpeg'), data: m[2] } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: 2048,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  const primaryDown = modelState.primaryDownDate === todayKst() || Date.now() < modelState.primaryBusyUntil;
  const order = primaryDown ? [FALLBACK_MODEL, THIRD_MODEL] : [PRIMARY_MODEL, FALLBACK_MODEL, THIRD_MODEL];

  const trace: string[] = [];
  const deadline = Date.now() + 50000; // Edge Function 응답 예산
  for (let round = 0; round < 2; round++) {
    for (const model of order) {
      const left = deadline - Date.now();
      if (left < 4000) { trace.push('deadline'); break; }
      const r = await callGemini(model, body, left);
      trace.push(`${model}:${r.status}`);
      if (r.ok) {
        const txt = firstText(r.data);
        if (!txt) { trace.push('empty'); continue; }
        let parsed: unknown = null;
        try { parsed = JSON.parse(txt); } catch (_e) { parsed = null; }
        if (!parsed) { trace.push('badjson'); continue; }
        return { ok: true as const, model, data: parsed as Record<string, unknown>, trace };
      }
      if (r.status === 429) {
        if (isDailyQuota(r.raw)) modelState.primaryDownDate = todayKst();
        continue;
      }
      if (model === PRIMARY_MODEL && r.status === 503) {
        modelState.primaryBusyUntil = Date.now() + 5 * 60 * 1000; // 잠시 3.8은 건너뛴다
      }
    }
    if (round === 0 && deadline - Date.now() > 12000) {
      await new Promise((res) => setTimeout(res, 1200)); // 한 바퀴 더
    } else {
      break;
    }
  }
  return { ok: false as const, model: '', data: {}, trace };
}

// ---------------------------------------------------------------- 프롬프트
const COACH = [
  '너는 중학생 소윤이의 독서 코치 "초파"야. 소윤이가 책을 읽고 자기 생각을 자기 말로 꺼내도록 돕는다.',
  '절대 규칙:',
  '1) 대필 금지 — 소윤이 대신 답을 쓰거나 정답을 먼저 말하지 않는다. 너는 질문하고 짚어 주기만 한다.',
  '2) 질문은 한 번에 하나. 중학생이 2~5문장으로 답할 수 있는 구체적인 질문.',
  '3) 확인된 책 정보와 명백히 어긋나는 인물·사건 착각은 짚어 준다("그 인물은 ~한 쪽이야").',
  '4) 확인된 책 정보에 없는 세부 내용은 "틀렸다"고 단정하지 않는다. 대신 근거·논리를 묻는다.',
  '5) 말투는 친근한 반말, 짧게(2~3문장). 칭찬은 구체적으로 한 번만.',
  '6) 없는 내용을 지어내지 않는다. 확실하지 않으면 "확실하지 않다"고 말한다.',
].join('\n');

function bookLine(book: Record<string, unknown>): string {
  const b = book || {};
  const rows = [
    `제목: ${clip(b.title, LIMITS.title)}`,
    b.author ? `지은이: ${clip(b.author, LIMITS.author)}` : '',
    b.publisher ? `출판사: ${clip(b.publisher, 80)}` : '',
    b.year ? `출간: ${clip(b.year, 20)}` : '',
    b.category ? `분류: ${clip(b.category, 120)}` : '',
    b.isbn ? `ISBN: ${clip(b.isbn, 40)}` : '',
    b.blurb ? `출판사 소개문: ${clip(b.blurb, 600)}` : '',
  ].filter(Boolean);
  return rows.join('\n');
}

function qaLines(qa: Array<{ question?: string; answer?: string }>): string {
  if (!qa.length) return '(아직 없음)';
  return qa.map((x, i) => `Q${i + 1}. ${clip(x.question, LIMITS.question)}\nA${i + 1}. ${clip(x.answer, LIMITS.answer)}`).join('\n');
}

const SCHEMA_START: JsonSchema = {
  type: 'object',
  properties: {
    gist: { type: 'string', description: '책 전체 줄거리 4~6문장(한국어, 확실한 내용만)' },
    characters: { type: 'array', items: { type: 'string' }, description: '주요 인물과 한 줄 설명' },
    keyEvents: { type: 'array', items: { type: 'string' }, description: '핵심 사건 3~5개' },
    themes: { type: 'array', items: { type: 'string' }, description: '주제/갈등 2~4개' },
    uncertain: { type: 'boolean', description: '책 내용을 확신하기 어려우면 true' },
    greeting: { type: 'string', description: '소윤이에게 건네는 첫 인사 한 줄' },
    question: { type: 'string', description: '첫 번째 생각 질문' },
    focus: { type: 'string', description: '이 질문에서 보려는 것(한 줄, 소윤이에게는 보이지 않음)' },
  },
  required: ['gist', 'characters', 'keyEvents', 'themes', 'uncertain', 'greeting', 'question'],
};

const SCHEMA_ANSWER: JsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['revise', 'pass', 'complete'] },
    feedback: { type: 'string', description: '소윤이에게 보여 줄 2~3문장 피드백' },
    nextQuestion: { type: 'string', description: '통과했을 때 다음 질문. 마지막이면 빈 문자열' },
    focus: { type: 'string', description: '다음 질문의 의도(한 줄, 내부용)' },
  },
  required: ['status', 'feedback'],
};

const SCHEMA_SUMMARY: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '책 제목' },
    oneLine: { type: 'string', description: '한 줄 생각(소윤이 말투)' },
    report: { type: 'string', description: '독서록 본문 3~5문단, 1인칭, 소윤이 표현 살리기' },
    favorite: { type: 'string', description: '가장 인상 깊었던 장면' },
    question: { type: 'string', description: '책에 대해 남은 질문' },
    tags: { type: 'array', items: { type: 'string' }, description: '독서록 태그 3~5개' },
  },
  required: ['title', 'oneLine', 'report'],
};

// ---------------------------------------------------------------- actions
async function actionLookup(body: Record<string, unknown>) {
  const title = clip(body.title, LIMITS.title);
  const author = clip(body.author, LIMITS.author);
  if (!title) return json({ error: '책 제목을 적어 주세요.', code: 'no_title' }, 400);

  const { candidates } = await aladinLookup(title, author);
  let list = candidates
    .filter((c) => !/^\s*\[/.test(c.title) && !/북토크|굿즈|이벤트|세트\]|사은품/.test(c.title))
    .map((c) => ({ c, s: scoreCandidate(c, title, author) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);

  let source = 'aladin';
  if (!list.length) {
    list = (await kyoboLookup(title)).filter((c) => scoreCandidate(c, title, author) > 0);
    source = 'kyobobook';
  }

  if (!list.length) {
    return json({
      found: false,
      source: '',
      message: '검색 결과에서 이 책을 찾지 못했어요. 제목을 조금 다르게 적거나, 책 뒤표지·목차 사진을 올려 주세요.',
      candidates: [],
    });
  }

  const best = source === 'aladin' ? await aladinDetail(list[0]) : list[0];
  return json({
    found: true,
    source,
    book: {
      title: best.title,
      author: best.author,
      publisher: best.publisher,
      year: best.year,
      cover: best.cover,
      url: best.url,
      category: best.category,
      isbn: best.isbn,
      pages: best.pages,
      blurb: best.blurb,
    },
    candidates: list.slice(0, 5).map((c) => ({
      title: c.title, author: c.author, publisher: c.publisher, year: c.year, url: c.url,
    })),
  });
}

async function actionStart(body: Record<string, unknown>) {
  const book = (body.book || {}) as Record<string, unknown>;
  if (!clip(book.title, LIMITS.title)) return json({ error: '먼저 책을 찾아 주세요.', code: 'no_book' }, 400);
  const note = clip(body.note, LIMITS.note);
  const images = Array.isArray(body.images)
    ? (body.images as unknown[]).filter((x) => typeof x === 'string').slice(0, LIMITS.images)
    : [];
  const totalSteps = note || images.length ? 6 : 5;

  const prompt = [
    COACH,
    '',
    '[책 정보 — 서버에서 실제 검색으로 확인한 값]',
    bookLine(book),
    note ? `\n[소윤이가 직접 쓴 책 내용 메모]\n${note}` : '',
    images.length ? '\n[사진] 소윤이가 올린 책 페이지 사진이 함께 첨부돼 있다. 사진에서 읽히는 내용을 근거로 삼아도 된다.' : '',
    '',
    `[할 일] 이 책으로 소윤이와 ${totalSteps}번 주고받을 독후활동을 시작한다.`,
    '1) 책 내용을 정리해라: gist(4~6문장), characters, keyEvents, themes. 네가 이미 아는 이 책의 내용도 참고해도 되지만, 검색 정보·메모·사진과 어긋나면 그것을 우선한다. 확인되지 않은 세부는 쓰지 말고, 책 내용 확신이 낮으면 uncertain=true로 하고 gist를 짧고 조심스럽게 써라.',    '2) greeting: 소윤이에게 건네는 첫 인사 한 줄(책 제목을 자연스럽게 언급).',
    '3) question: 첫 번째 생각 질문. 정답이 하나로 정해지지 않고, 소윤이가 자기 느낌·경험을 말할 수 있는 질문. 책을 아직 다 안 읽었어도 답할 수 있게.',
    '4) focus: 이 질문에서 보려는 것 한 줄.',
  ].filter(Boolean).join('\n');

  const r = await askJson(SCHEMA_START, prompt, images, 0.7);
  if (!r.ok) return aiFailure(r.trace);

  const d = r.data;
  return json({
    ok: true,
    model: r.model,
    totalSteps,
    step: 1,
    greeting: clip(d.greeting, 300),
    question: clip(d.question, LIMITS.question),
    brief: {
      gist: clip(d.gist, 1400),
      characters: Array.isArray(d.characters) ? d.characters.slice(0, 12).map((x) => clip(x, 200)) : [],
      keyEvents: Array.isArray(d.keyEvents) ? d.keyEvents.slice(0, 8).map((x) => clip(x, 240)) : [],
      themes: Array.isArray(d.themes) ? d.themes.slice(0, 8).map((x) => clip(x, 120)) : [],
      uncertain: !!d.uncertain,
    },
    focus: clip(d.focus, 200),
  });
}

async function actionAnswer(body: Record<string, unknown>) {
  const book = (body.book || {}) as Record<string, unknown>;
  const brief = (body.brief || {}) as Record<string, unknown>;
  const qa = Array.isArray(body.qa) ? (body.qa as Array<{ question?: string; answer?: string }>).slice(-LIMITS.qa) : [];
  const question = clip(body.question, LIMITS.question);
  const answer = clip(body.answer, LIMITS.answer);
  const step = Math.max(1, Math.min(9, Number(body.step) || 1));
  const totalSteps = Math.max(1, Math.min(9, Number(body.totalSteps) || 5));
  const attempt = Math.max(1, Math.min(5, Number(body.attempt) || 1));
  if (!answer) return json({ error: '답을 적어 주세요.', code: 'no_answer' }, 400);

  const summary = [
    brief.gist ? `줄거리: ${clip(brief.gist, 1400)}` : '',
    Array.isArray(brief.characters) && brief.characters.length ? `인물: ${(brief.characters as unknown[]).map((x) => clip(x, 200)).join(' / ')}` : '',
    Array.isArray(brief.keyEvents) && brief.keyEvents.length ? `핵심 사건: ${(brief.keyEvents as unknown[]).map((x) => clip(x, 240)).join(' / ')}` : '',
    Array.isArray(brief.themes) && brief.themes.length ? `주제: ${(brief.themes as unknown[]).map((x) => clip(x, 120)).join(' / ')}` : '',
    brief.uncertain ? '※ 이 책 내용은 확신도가 낮게 정리됨 — 세부 내용을 단정하지 말 것.' : '',
  ].filter(Boolean).join('\n');

  const prompt = [
    COACH,
    '',
    '[책 정보 — 서버에서 실제 검색으로 확인한 값]',
    bookLine(book),
    '',
    '[책 내용 정리(너와 소윤이가 함께 참조하는 기준)]',
    summary || '(정리 없음)',
    '',
    '[지금까지의 문답]',
    qaLines(qa),
    '',
    `[이번 단계] ${step} / ${totalSteps} (이 단계 시도 ${attempt}번째)`,
    `[질문] ${question}`,
    `[소윤이의 답] ${answer}`,
    '',
    '[할 일] 위 답을 점검하고 JSON으로 답한다.',
    'a) 인물·사건을 명백히 착각했거나(책 정보와 어긋남) 답이 너무 짧아 생각이 드러나지 않으면 status="revise". feedback에는 ① 어긋난 부분을 아는 만큼 짚어 주고 ② 무엇을 더 말해 주면 좋을지 구체적으로 1~2가지 요청한다. 같은 질문에 다시 답하게 된다.',
    'b) 책 정보에 없는 세부 내용은 틀렸다고 하지 않는다. 답이 충분하면 받아 주고, 부족하면 "그 장면에서 어떤 부분이 그렇게 느껴졌는지" 같은 근거 질문으로 보완을 유도한다(그 경우도 status="revise").',
    'c) 소윤이의 생각이 드러나고 근거가 있으면 status="pass". feedback에는 구체적으로 인정할 점 한 가지.',
    `d) pass이고 ${step} < ${totalSteps}이면 nextQuestion에 다음 질문(이전 질문과 다른 각도: 인물의 선택, 갈등, 나와 비교, 결말 상상, 주제 등)을 넣는다.`,
    `e) ${step} === ${totalSteps}에서 통과면 status="complete", nextQuestion은 "".`,
    'f) 현재 단계 시도가 2번 이상이면 같은 질문을 반복하지 말고 status="pass"로 넘긴다(단, 명백한 착각은 feedback에 한 줄 남긴다).',
    'g) feedback과 nextQuestion 모두 소윤이에게 그대로 보이는 말이다. 내부 사정·모델 이름·영어는 쓰지 않는다.',
  ].join('\n');

  const r = await askJson(SCHEMA_ANSWER, prompt, [], 0.6);
  if (!r.ok) return aiFailure(r.trace);

  const d = r.data;
  let status = String(d.status || 'pass');
  if (!['revise', 'pass', 'complete'].includes(status)) status = 'pass';
  if (attempt >= 2 && status === 'revise') status = 'pass';
  if (status === 'pass' && step >= totalSteps) status = 'complete';

  const nextQuestion = status === 'complete' ? '' : clip(d.nextQuestion, LIMITS.question);
  if (status !== 'complete' && !nextQuestion) {
    // 다음 질문이 비어 오면 같은 단계에서 한 번 더 물어보게 한다(클라이언트가 처리).
    return json({
      ok: true, model: r.model, status: 'revise', step, totalSteps,
      feedback: clip(d.feedback, 600) || '조금만 더 자세히 말해 줄래?',
      nextQuestion: '',
    });
  }

  return json({
    ok: true,
    model: r.model,
    status,
    step,
    totalSteps,
    feedback: clip(d.feedback, 600),
    nextQuestion,
    focus: clip(d.focus, 200),
  });
}

async function actionSummarize(body: Record<string, unknown>) {
  const book = (body.book || {}) as Record<string, unknown>;
  const brief = (body.brief || {}) as Record<string, unknown>;
  const qa = Array.isArray(body.qa) ? (body.qa as Array<{ question?: string; answer?: string }>).slice(-LIMITS.qa) : [];
  const member = clip(body.memberName, 40) || '소윤';
  if (!qa.length) return json({ error: '문답이 아직 없어요.', code: 'no_qa' }, 400);

  const prompt = [
    COACH,
    '',
    `[책 정보 — 서버에서 실제 검색으로 확인한 값]`,
    bookLine(book),
    '',
    '[책 내용 정리]',
    brief.gist ? clip(brief.gist, 1400) : '(없음)',
    '',
    '[문답 전체]',
    qaLines(qa),
    '',
    `[할 일] ${member}이의 독서록 카드를 만든다.`,
    '1) report: 3~5문단 독서록. 1인칭. 문답에서 나온 소윤이의 표현·말투·관점을 최대한 그대로 살린다(문장을 새로 지어 쓰기보다 다듬기).',
    '2) 문답에 없는 사건·감상을 새로 만들어 넣지 않는다. 책 정보로 확인되는 사실만 보충한다.',
    '3) oneLine: 한 줄 생각(소윤이 말투로 짧게). favorite: 가장 인상 깊었던 장면. question: 책에 대해 남은 질문.',
    '4) tags: 독서록 태그 3~5개(예: 우정, 성장, 판타지).',
  ].join('\n');

  const r = await askJson(SCHEMA_SUMMARY, prompt, [], 0.5);
  if (!r.ok) return aiFailure(r.trace);

  const d = r.data;
  return json({
    ok: true,
    model: r.model,
    card: {
      title: clip(d.title, LIMITS.title) || clip(book.title, LIMITS.title),
      oneLine: clip(d.oneLine, 200),
      report: clip(d.report, 4000),
      favorite: clip(d.favorite, 400),
      question: clip(d.question, 300),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 6).map((x) => clip(x, 30)) : [],
    },
  });
}

function aiFailure(trace: string[]) {
  const busy = trace.some((t) => /:(429|503|500|502|504)$/.test(t));
  return json({
    error: busy
      ? 'AI가 지금 잠깐 붐비거나 오늘 무료 사용량을 다 썼어요. 1~2분 뒤에 다시 눌러 주세요.'
      : 'AI 응답을 받지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
    code: 'ai_unavailable',
    detail: trace.join(','),
  }, 503);
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 지원해요.' }, 405);

  const room = (req.headers.get('x-room-code') || '').trim();
  if (!room) return json({ error: '가족 코드(x-room-code)가 필요해요.', code: 'no_room' }, 400);
  if (!GEMINI_KEY) return json({ error: 'AI 키가 설정되지 않았어요.', code: 'no_key' }, 500);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: '요청 본문을 읽지 못했어요.', code: 'bad_json' }, 400);
  }

  const action = String(body.action || '');
  if (!['lookup', 'start', 'answer', 'summarize'].includes(action)) {
    return json({ error: '알 수 없는 요청이에요.', code: 'bad_action' }, 400);
  }

  if (!allow(`${room}:${action === 'lookup' ? 'q' : 'ai'}`, action === 'lookup' ? 60 : 40, 3600_000)) {
    return json({ error: '잠깐 너무 많이 눌렀어요. 조금 뒤에 다시 해 주세요.', code: 'rate_limited' }, 429);
  }

  try {
    if (action === 'lookup') return await actionLookup(body);
    if (action === 'start') return await actionStart(body);
    if (action === 'answer') return await actionAnswer(body);
    return await actionSummarize(body);
  } catch (e) {
    console.error('book-mentor error', action, String(e));
    return json({ error: '처리 중 문제가 생겼어요. 다시 시도해 주세요.', code: 'server_error' }, 500);
  }
});
