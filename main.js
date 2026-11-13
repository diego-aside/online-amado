// 온라인 아마도 월드 v6 — main.js
// 정적 사이트. Three.js r170(importmap) + Supabase JS v2(CDN, window.supabase) + PeerJS(CDN, window.Peer).
// 구조: 설정 → 채널/프라이버시 → 사장님 대사·상수 → 상태 → 유틸 → 방 레이아웃 → 3D → 네트워크(로비/디렉토리/테이블/문) → 취기·허기 → 서빙·주문 → 채팅 → 화상 → UI → 루프
import * as THREE from 'three';

/* ================================================================ 설정 */
// 찬양반 연습실 multiplayer.js 의 MP_CONFIG 와 같은 Supabase 프로젝트(ezer-choir). 채널명만 amado- 로 분리한다.
const MP_CONFIG = {
  url: 'https://fhgvaeylpeacsbfnavyt.supabase.co',
  anonKey: 'sb_publishable_115NfIgoxpPA7fTx4wQSNQ_xcLLqbMF', // 공개용 publishable key
};
const TABLES = 6, SEATS = 4;
const RAINBOW_COOLDOWN_MS = 60000;
const TRACK_MS = 120;
const DIR_HEARTBEAT_MS = 5000, DIR_TTL_MS = 75000; // keeper 가 5초마다 알림. 백그라운드 탭은 타이머가 분당 1회로 줄 수 있어 만료는 넉넉히(정상 퇴장은 count 0 으로 즉시 반영)
const HUNGER_START = 2, HUNGER_TICK_MS = 180000;   // 입장 시 허기 2, 3분마다 +1 (최대 5)
const BITES = 4;                                   // 음식 1개 = 4입, 병 술 1병 = 4잔
const SERVE_MIN_MS = 15000, SERVE_MAX_MS = 25000;  // 주문 → 서빙까지
const CHIP_ID = 'svc-chip';                        // 서비스 안주(알새우칩) 라인 id — 테이블 세션마다 1개
const GREET_TTL_MS = 20000;

/* ================================================================ 채널명 · 프라이버시 규칙 (코드로 검증) */
function checkTid(id) {
  if (!Number.isInteger(id) || id < 1 || id > TABLES) throw new Error(`잘못된 테이블 번호: ${id}`);
  return id;
}
const CH = {
  lobby: 'amado-lobby',                              // 위치(아바타)만. 채팅·주문·취기·허기는 절대 안 싣는다.
  dir: 'amado-tables',                               // 테이블 디렉토리: 번호·인원·잠금 여부만. 코드·이름·채팅은 절대 안 싣는다.
  table: (id) => `amado-table-${checkTid(id)}`,      // 채팅·주문·서빙·먹기/마시기·취기·허기·건배·무지개 토
  door: (id) => `amado-door-${checkTid(id)}`,        // 입장 코드 확인 전용(노크/승인)
};
// 테이블 채널에서만 오가는 이벤트. 로비·문·디렉토리 채널로는 이 이벤트를 보낼 수 없다(tsend만 보냄).
const PRIVATE_EVENTS = ['chat', 'order', 'cancel', 'treat', 'cheers', 'rainbow', 'care', 'sync-req', 'sync', 'serve', 'eat', 'drink'];
const DOOR_EVENTS = ['knock', 'grant'];
const DIR_EVENTS = ['tables-req', 'tables-state'];
// 로비 presence 에 허용되는 키 (위치·표시용만). 취기·허기·코드·채팅은 여기 없음.
const LOBBY_KEYS = ['id', 'name', 'color', 'x', 'z', 'rot', 'table', 'seat', 'sit'];

/* ================================================================ 사장님 대사 · 인사 · 상수 */
const OWNER_LINES = {
  enter: '어서 와요, 아미고들! 오늘은 아마도 여기에 올 거라고 생각했어요?',
  order: '숙주 소 불고기 뽀끔밥은 끓여 드시면 돼요. 옥수수전은 달달하니까 소주랑 잘 맞아요.',
  service: '서비스예요. 알새우칩, 직접 튀겼어요. 따끈할 때 드세요.',
  care: '물 한 잔 드릴게요. 화장실은 안에 있어요, 머리 조심하고요.',
  closing: '마지막 주문은 12시 반이에요. 천천히 드세요.',
};
const GREETING = {
  prompt: '사장님이 반겨주세요. 인사해볼까요?',
  options: [
    { text: '안녕하세요!', reply: '안녕하세요! 편하게 앉으세요.' },
    { text: '오늘도 왔어요!', reply: '오셨네요, 아미고! 오늘은 뭐 드실 거예요?' },
    { text: '처음 왔어요!', reply: '처음 오셨구나! 환영해요. 편하게 둘러보세요.' },
  ],
};
const SERVE_LINES = ['나왔어요~ 따뜻할 때 드세요.', '주문하신 거 나왔어요! 맛있게 드세요.', '뜨거우니까 조심해서 드세요~ 나왔어요!'];
const FRIDGE_LINE = '네, 가져가세요! 계산은 나중에 한 번에 할게요.';
const HUNGER_LINES = ['옥수수전 하나 시켜놓고 천천히 드세요.', '빈속에 술은 금방 취해요. 안주부터 시켜요.', '배고프죠? 숙주 소 불고기 뽀끔밥이 든든해요.'];

const LEVELS = ['아직 멀쩡해요', '기분 좋아', '취기', '취기가 올라요', '만취 직전', '🌈 무지개 토'];
const FACES = ['🙂', '😊', '😄', '🥴', '🤢', '🌈'];
const HUNGER_TEXT = ['배부름', '든든해요', '슬슬 배고파요', '배고파요', '많이 배고파요', '배고파 죽겠어요'];

// 술 냉장고 품목. 가격·무알코올 여부는 menu.json 의 menuId 항목에서 읽는다 (병 술 = 4잔, 잔 술 = 1잔).
const FRIDGE = [
  { key: 'soju', name: '소주', menuId: 'soju', unit: 'bottle', color: 0x2d8a4e },
  { key: 'beer', name: '병맥주', menuId: 'bottle', unit: 'bottle', color: 0x7a4a1e },
  { key: 'cheongha', name: '청하', menuId: 'cheongha', unit: 'bottle', color: 0xbfe3d6 },
  { key: 'maehwa', name: '매화수', menuId: 'maehwa', unit: 'bottle', color: 0xd9c46a },
  { key: 'saero-omija', name: '새로오미자', menuId: 'saero-omija', unit: 'bottle', color: 0xb0365f },
  { key: 'bit-cheongha', name: '빛청하', menuId: 'cheongha', unit: 'bottle', color: 0x8fd1e8 },
  { key: 'draft', name: '생맥주', menuId: 'draft', unit: 'glass', color: 0xe0a82e },
  { key: 'highball', name: '하이볼', menuId: 'highball', unit: 'glass', color: 0xf0c55a },
  { key: 'cola', name: '콜라', menuId: 'soda', unit: 'glass', color: 0x3a2018 },
  { key: 'cider', name: '사이다', menuId: 'soda', unit: 'glass', color: 0xdff2e8 },
  { key: 'zero', name: '제로콜라', menuId: 'soda', unit: 'glass', color: 0x22171a },
  { key: 'galppa', name: '갈빠', menuId: 'galppa', unit: 'glass', color: 0xc98a3e },
  { key: 'icetea', name: '아이스티', menuId: 'icetea', unit: 'glass', color: 0xb5651d },
];
const bitesOf = (kind, unit) => (kind === 'food' || unit === 'bottle' ? BITES : 1);
// 마시기 한 번의 취기 변화: 무알코올 +0, 술 +1, 빈속(허기 4 이상)이면 +1.5
const drinkDelta = (alcohol, hunger) => (alcohol ? (hunger >= 4 ? 1.5 : 1) : 0);

/* ================================================================ 상태 */
const S = {
  me: { id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: '', why: '', color: 0xffc861 },
  entered: false,
  pos: new THREE.Vector3(-2.0, 0, 6.0), rot: Math.PI, target: null, path: [], trip: null, sitTarget: null, seated: false,
  table: null, seat: null,
  drunk: 0, rainbowUntil: 0, wc: false,
  hunger: HUNGER_START, hungerAlert: 0, hungerTimer: 0,
  cam: false, mic: false, peer: null, peerId: null,
  menu: null, activeCat: 'main',
  online: false, side: 'hidden',
};
let T = null; // 현재 앉은 테이블 세션 (없으면 null)
const Net = { sb: null, lobby: null, dir: null, ready: false, dirReady: false, everUp: false };
const Remote = new Map(); // 로비 presence → 다른 사람 아바타
let lobbyMembers = new Map();
const Dir = new Map();    // 테이블 디렉토리: tid → {count, seats, locked, ts}. keeper 가 broadcast 한 점유 상태 (로비 presence 와 무관)

/* ================================================================ 유틸 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lvl = () => clamp(Math.round(S.drunk), 0, 5);
const NICK_A = ['취한', '느긋한', '수줍은', '달달한', '바삭한', '따끈한', '졸린', '유쾌한'];
const NICK_B = ['옥수수전', '알새우칩', '숙주', '고양이', '단골', '막걸리', '푸앙이', '새우깡'];
const randomNick = () => `${NICK_A[Math.floor(Math.random() * NICK_A.length)]} ${NICK_B[Math.floor(Math.random() * NICK_B.length)]}`;
const COLORS = [0xe0735a, 0x5aa6e0, 0xc9a227, 0x8e6cc9, 0x4fb286, 0xd86aa5, 0xe08a3c, 0x6c8ae0];
function toast(msg, ms = 3500, cls = '') {
  const t = h('div', { class: `toast ${cls}`, text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
function saveProfile() { try { localStorage.setItem('amado-profile', JSON.stringify({ name: S.me.name, why: S.me.why })); } catch { /* 저장 차단 무시 */ } }
function loadProfile() { try { return JSON.parse(localStorage.getItem('amado-profile') || 'null'); } catch { return null; } }
async function sha256hex(str) {
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* 폴백 */ }
  let x = 0x811c9dc5; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return `fnv${x.toString(16)}`;
}
const proofOf = (tid, code, nonce) => sha256hex(`amado:${tid}:${code}:${nonce}`);

/* ================================================================ 방 레이아웃 (순수 데이터)
   주문대(카운터)를 기준으로 세로로 긴 공간. z 음수 끝 = 카운터·술 냉장고·사장님, z 양수 끝 = 통유리 입구. */
const ROOM = { w: 7.2, d: 14, h: 3.2 };
const TABLE_DEFS = [];
{
  const cols = [-1.7, 1.7], rows = [-3.3, 0.3, 3.9]; // 길이 방향으로 2열 × 3행, 가운데 통로 2.4m(테이블 사이)
  let n = 1;
  for (const rz of rows) for (const cx of cols) {
    const seats = [];
    // 테이블은 긴 방향이 z축. 좌석은 테이블 양옆(x축 방향)에 2개씩.
    [[-0.95, -0.42], [-0.95, 0.42], [0.95, -0.42], [0.95, 0.42]].forEach(([dx, dz]) => {
      seats.push({ x: cx + dx, z: rz + dz });
    });
    TABLE_DEFS.push({ id: n++, x: cx, z: rz, hw: 0.5, hd: 0.8, seats });
  }
}
const COUNTER = { x: 0, z: -5.9, hw: 1.7, hd: 0.35 };
const FRIDGE_POS = { x: -3.25, z: -6.2, hw: 0.35, hd: 0.45 }; // 서쪽(왼쪽) 벽에 붙은 술 냉장고, 주문대 옆 먼 쪽 끝. 문은 동쪽(+x, 방 안쪽)을 봄
const FRIDGE_STAND = { x: -2.3, z: -5.7 };                    // 냉장고 앞(동쪽)에 서는 자리 (BOUNDS.z0 안)
const FRIDGE_ROT = Math.atan2(FRIDGE_POS.x - FRIDGE_STAND.x, FRIDGE_POS.z - FRIDGE_STAND.z); // 서 있을 때 냉장고를 바라보는 방향
const FRIDGE_LANE_Z = -4.8;                                   // 맨 앞 줄 테이블과 카운터 사이 통행로
const WC_DOOR = { x: 3.6, z: -5.9 };                          // 먼 쪽 끝, 주문대 오른쪽(동쪽 벽)
const ENTRANCE = { x0: -3.3, x1: -0.7 };                      // 가까운 쪽(남쪽) 벽, 왼쪽 통유리 접이문
const AIRCON = { x: 3.48, y: 2.45, z: 5.3, w: 1.0, h: 0.3, d: 0.2, collide: false }; // 하단 오른쪽(동쪽) 벽 벽걸이 에어컨
const BOUNDS = { x0: -3.4, x1: 3.4, z0: -5.7, z1: 6.8 };
const OWNER_POS = new THREE.Vector3(0, 0, -6.5);              // 주문대 안(카운터 뒤)
const SPAWN = { x: -2.0, z: 6.0 };                            // 입구(하단 왼쪽) 근처
const SPAWN_ROT = Math.atan2(COUNTER.x - SPAWN.x, COUNTER.z - SPAWN.z); // 카운터를 바라보는 방향
const seatYaw = (t, sp) => Math.atan2(t.x - sp.x, 0);         // 좌석은 테이블 옆면에 마주 앉는다(±x 방향)

/* ---- 통유리 밖 내리막길: 인도 + 1차선 도로(중앙 점선). 그룹 전체를 +x 방향으로 내려가게 기울인다. 학생은 순수 함수로 위치 계산. ---- */
const STREET = { z0: ROOM.d / 2 + 0.1, sidewalkD: 1.6, roadD: 3.4, x0: -15, x1: 15, slope: 0.07 }; // slope: rad, +x 쪽이 낮음
const STUDENTS = [
  { lane: 7.95, speed: 0.55, phase: 0.0, pack: 0xd8573c },
  { lane: 8.35, speed: 0.45, phase: 0.33, pack: 0x3f7fbf },
  { lane: 9.45, speed: 0.62, phase: 0.66, pack: 0x5aa85a },
];
const studentX = (st, time) => { // 위쪽(-x)에서 아래쪽(+x)으로 천천히 내려가고, 끝에서 다시 위쪽으로 되돌아오는 루프
  const span = STREET.x1 - STREET.x0 - 2, u = ((time * st.speed) / span + st.phase) % 1;
  return STREET.x0 + 1 + u * span;
};

/* ================================================================ 3D */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16231f);
scene.fog = new THREE.Fog(0x16231f, 18, 40);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
let renderer = null;
const orbit = { theta: 0.0, phi: 0.9, dist: 9.5 }; // 입구 뒤쪽 위에서 길이 방향으로 카운터를 바라봄
const camTarget = new THREE.Vector3(SPAWN.x, 1, SPAWN.z - 2);
const pickables = [];
const wallSides = []; // {mat, side}
const bubbles = [];   // 파티클
const mats = {};
let tableLights = [];

function std(color, rough = 0.8, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }); }
function box(w, hh, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function canvasTex(w, hh, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  draw(c.getContext('2d'), w, hh);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const SCRIPT_FONT = "'Brush Script MT','Segoe Script','Snell Roundhand','Lucida Handwriting',cursive";
const HAND_FONT = "'Nanum Pen Script','Segoe Print','Comic Sans MS','Malgun Gothic',cursive";

function buildRoom() {
  mats.wall = (c = 0x2e4b44) => std(c, 0.95, { transparent: true });
  mats.wood = std(0x3a2a1e, 0.45); mats.woodLight = std(0x5a4128, 0.6); mats.leather = std(0x151515, 0.4);
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffc861 });

  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x1c2b27, 0.7));
  scene.add(new THREE.AmbientLight(0xffe2b0, 0.35));
  [-3.3, 0.3, 3.9].forEach((z) => {
    const l = new THREE.PointLight(0xffc861, 14, 9, 1.6); l.position.set(0, 2.6, z); scene.add(l); tableLights.push(l);
  });

  // 바닥 (회색 타일 느낌, 도형+캔버스 텍스처만)
  const floorTex = canvasTex(256, 256, (g, w, hh) => {
    g.fillStyle = '#6b6f6e'; g.fillRect(0, 0, w, hh);
    g.strokeStyle = '#555a59'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, hh); g.stroke(); g.beginPath(); g.moveTo(0, i * hh / 4); g.lineTo(w, i * hh / 4); g.stroke(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(ROOM.w, ROOM.d);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.userData.floor = true; scene.add(floor); pickables.push(floor);

  // 벽 (카메라가 벽 바깥에 있으면 투명). n = 카운터 쪽 안쪽 끝벽, s = 입구 쪽 벽
  const wallMat = (side) => { const m = mats.wall(); wallSides.push({ mat: m, side }); return m; };
  const hw = ROOM.w / 2, hd = ROOM.d / 2, H = ROOM.h;
  box(ROOM.w, H, 0.2, wallMat('n'), 0, H / 2, -hd - 0.1);
  box(0.2, H, ROOM.d, wallMat('e'), hw + 0.1, H / 2, 0);
  box(0.2, H, ROOM.d, wallMat('w'), -hw - 0.1, H / 2, 0);
  const ew = ENTRANCE.x1 - ENTRANCE.x0, ec = (ENTRANCE.x0 + ENTRANCE.x1) / 2;
  box(ENTRANCE.x0 + hw, H, 0.2, wallMat('s'), (-hw + ENTRANCE.x0) / 2, H / 2, hd + 0.1);
  box(hw - ENTRANCE.x1, H, 0.2, wallMat('s'), (hw + ENTRANCE.x1) / 2, H / 2, hd + 0.1);
  box(ew, 0.7, 0.2, wallMat('s'), ec, H - 0.35, hd + 0.1);
  // 입구(하단 왼쪽): 통유리 접이문
  const glass = new THREE.MeshStandardMaterial({ color: 0x9ec9c0, transparent: true, opacity: 0.22, roughness: 0.1 });
  const panels = 4, pw = ew / panels;
  for (let i = 0; i < panels; i++) box(pw - 0.02, H - 0.7, 0.05, glass, ENTRANCE.x0 + pw * (i + 0.5), (H - 0.7) / 2, hd);
  for (let i = 0; i <= panels; i++) box(0.04, H - 0.7, 0.08, std(0x1a1a1a), ENTRANCE.x0 + pw * i, (H - 0.7) / 2, hd);
  box(ew, 0.05, 0.1, std(0x1a1a1a), ec, 0.03, hd);
  buildStreet();
  buildAircon();

  // 스트링 조명 (길이 방향 두 줄, 도형만)
  [-1.7, 1.7].forEach((x) => {
    const n = 30, z0 = -6.8, z1 = 6.8;
    for (let i = 0; i <= n; i++) {
      const t = i / n, z = z0 + (z1 - z0) * t, y = 2.95 - Math.sin(t * Math.PI) * 0.35;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bulb); b.position.set(x, y, z); scene.add(b);
    }
    box(0.01, 0.01, z1 - z0, std(0x222222), x, 2.85, 0);
  });

  // 카운터 + POS + 술병 선반 + 맥주 상자 (z 음수 끝, x=0 중심)
  box(COUNTER.hw * 2, 1.0, COUNTER.hd * 2, mats.wood, COUNTER.x, 0.5, COUNTER.z);
  box(COUNTER.hw * 2 + 0.1, 0.06, COUNTER.hd * 2 + 0.1, mats.woodLight, COUNTER.x, 1.03, COUNTER.z);
  box(0.4, 0.3, 0.3, std(0x222222), -1.1, 1.2, COUNTER.z - 0.05);
  [1.2, 1.9].forEach((y) => box(3.6, 0.05, 0.32, mats.woodLight, 0, y + 0.3, -6.85));
  const bcols = [0x2d6a3e, 0x7a4a1e, 0x9b2d2d, 0x335c8a, 0xcfc9b3, 0x3f7a58, 0x6b3f7a];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 12; i++) {
    const c = bcols[(i * 3 + r) % bcols.length], hgt = 0.32 + ((i * 7 + r) % 3) * 0.05;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, hgt, 8), std(c, 0.3)); b.position.set(-1.65 + i * 0.3, (r ? 1.9 : 1.2) + 0.33 + hgt / 2, -6.85); scene.add(b);
  }
  const brandTex = (txt, col, bg) => canvasTex(128, 64, (g, w, hh) => { g.fillStyle = bg; g.fillRect(0, 0, w, hh); g.fillStyle = col; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText(txt, w / 2, 42); });
  [['CASS', '#fff', '#c1272d'], ['TERRA', '#fff', '#1c8a4e']].forEach(([t, c, bg], k) => {
    for (let i = 0; i < 3; i++) {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ map: brandTex(t, c, bg) }));
      bx.position.set(1.0 + k * 0.6, 0.15 + i * 0.3, -6.6); scene.add(bx);
    }
  });
  buildFridge();

  // 벽 장식: 간판·액자·체크 주머니·안내문
  const sign = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({
    map: canvasTex(256, 256, (g, w, hh) => { g.fillStyle = '#1f6a4f'; g.fillRect(0, 0, w, hh); g.fillStyle = '#fff'; g.font = `84px ${SCRIPT_FONT}`; g.textAlign = 'center'; g.fillText('Amado', w / 2, hh / 2 + 26); }),
  }));
  sign.position.set(2.0, 2.3, hd - 0.12); sign.rotation.y = Math.PI; scene.add(sign);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshBasicMaterial({
    transparent: true, map: canvasTex(512, 160, (g, w, hh) => { g.fillStyle = '#fff'; g.font = `120px ${SCRIPT_FONT}`; g.textAlign = 'center'; g.fillText('Amado', w / 2, hh / 2 + 40); }),
  }));
  banner.position.set(0, 2.7, -hd + 0.05); scene.add(banner);
  const art = [['#e0735a', '#f4d35e'], ['#5aa6e0', '#f6efe2'], ['#c9a227', '#3a2a1e']];
  art.forEach(([a, b], i) => {
    const az = -3.2 + i * 1.6;
    const fr = box(0.04, 0.6, 0.5, mats.wood, -hw + 0.08, 1.9, az);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.54), new THREE.MeshBasicMaterial({
      map: canvasTex(64, 80, (g, w, hh) => { g.fillStyle = b; g.fillRect(0, 0, w, hh); g.fillStyle = a; g.beginPath(); g.arc(w / 2, hh / 2, 22, 0, 7); g.fill(); }),
    }));
    pic.position.set(-hw + 0.105, 1.9, az); pic.rotation.y = Math.PI / 2; scene.add(pic); void fr;
  });
  const gingham = canvasTex(64, 64, (g, w, hh) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.fillStyle = '#d83a3a88';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 16 + 0, 0, 8, hh); g.fillRect(0, i * 16, w, 8); }
  });
  [4.2, 4.9].forEach((z) => {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), new THREE.MeshStandardMaterial({ map: gingham }));
    bag.position.set(-hw + 0.1, 1.4, z); scene.add(bag);
    box(0.05, 0.05, 0.05, mats.wood, -hw + 0.05, 1.65, z);
  });
  const note = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({
    map: canvasTex(512, 256, (g, w, hh) => { g.fillStyle = '#fffbe0'; g.fillRect(0, 0, w, hh); g.fillStyle = '#3a2a1e'; g.font = `32px ${HAND_FONT}`; g.textAlign = 'center'; g.fillText('신분증 제시 … 불편하게 생각지 마세요', w / 2, 100); g.fillText('Why? 동안이니까~', w / 2, 170); }),
  }));
  note.position.set(hw - 0.02, 1.7, 3.0); note.rotation.y = -Math.PI / 2; scene.add(note);
  // 벽쪽 긴 원목 벤치
  box(0.5, 0.45, 5.5, mats.wood, -hw + 0.25, 0.23, 1.8); box(0.12, 0.5, 5.5, mats.wood, -hw + 0.06, 0.7, 1.8);
  // 화장실 문 (먼 쪽 끝, 주문대 오른쪽 동쪽 벽, 클릭하면 화장실 화면)
  const door = box(0.08, 2.0, 0.9, std(0x6a4a2a, 0.6), WC_DOOR.x - 0.05, 1.0, WC_DOOR.z);
  door.userData.wc = true; pickables.push(door);
  const wcSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({
    map: canvasTex(128, 64, (g, w, hh) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.fillStyle = '#222'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText('화장실', w / 2, 42); }),
  }));
  wcSign.position.set(WC_DOOR.x - 0.11, 1.75, WC_DOOR.z); wcSign.rotation.y = -Math.PI / 2; scene.add(wcSign);

  // 테이블 6개 + 의자 24개
  const numTex = (n) => canvasTex(64, 64, (g, w, hh) => { g.fillStyle = '#5a4128'; g.fillRect(0, 0, w, hh); g.fillStyle = '#ffc861'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillText(String(n), w / 2, 46); });
  for (const t of TABLE_DEFS) {
    const top = box(t.hw * 2, 0.07, t.hd * 2, mats.wood, t.x, 0.8, t.z);
    top.userData.table = t.id; pickables.push(top);
    box(0.12, 0.76, 0.12, mats.wood, t.x, 0.38, t.z);
    box(0.5, 0.04, 0.7, std(0x222222), t.x, 0.02, t.z);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: numTex(t.id) }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(t.x - 0.2, 0.845, t.z + 0.62); scene.add(lab);
    t.seats.forEach((s, i) => {
      const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      g.rotation.y = seatYaw(t, s);
      box(0.46, 0.08, 0.46, mats.leather, 0, 0.45, 0, g);
      box(0.46, 0.5, 0.06, mats.leather, 0, 0.75, -0.22, g);
      [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([lx, lz]) => box(0.04, 0.42, 0.04, std(0x333333), lx, 0.21, lz, g));
      g.traverse((o) => { if (o.isMesh) { o.userData.seat = { table: t.id, idx: i }; pickables.push(o); } });
      scene.add(g);
    });
  }
}

// 통유리 밖 내리막길: 인도 + 아스팔트 1차선(중앙 점선) + 학생 3명(기본 도형, 걷기 애니메이션). 충돌·픽킹 없음.
const streetActors = [];
function buildStreet() {
  const g = new THREE.Group(); g.position.set(0, 0, 0); g.rotation.z = -STREET.slope; // +x 쪽이 낮아지는 내리막
  const w = STREET.x1 - STREET.x0, cx = (STREET.x0 + STREET.x1) / 2;
  const sz = STREET.z0 + STREET.sidewalkD / 2, rz = STREET.z0 + STREET.sidewalkD + STREET.roadD / 2;
  box(w, 0.14, STREET.sidewalkD, std(0x9a9a94, 0.95), cx, 0.07 - 0.02, sz, g);          // 인도
  box(w, 0.05, STREET.roadD, std(0x2c2f33, 0.95), cx, 0.025 - 0.02, rz, g);             // 아스팔트 1차선
  box(w, 0.2, 0.12, std(0xc8c8c0, 0.9), cx, 0.1 - 0.02, STREET.z0 + STREET.sidewalkD, g); // 연석
  const dash = std(0xe8d36a, 0.8);
  for (let x = STREET.x0 + 0.6; x < STREET.x1; x += 1.8) box(0.9, 0.012, 0.1, dash, x, 0.056 - 0.02, rz, g);
  box(w, 0.4, 0.1, std(0x23332e, 0.95), cx, 0.2, STREET.z0 + STREET.sidewalkD + STREET.roadD + 0.6, g); // 도로 건너편 낮은 담
  const skin = std(0xe6c3a0, 0.7), shirt = [0x3a4a6a, 0xa05a5a, 0x4a6a4a];
  STUDENTS.forEach((st, i) => {
    const f = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 10), std(shirt[i % shirt.length], 0.85)); body.position.y = 0.88; f.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin); head.position.y = 1.42; f.add(head);
    const pack = box(0.26, 0.38, 0.14, std(st.pack, 0.7), 0, 0.92, -0.2, f);
    const legs = [-0.07, 0.07].map((x) => { const l = new THREE.Group(); l.position.set(x, 0.6, 0); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.6, 8), std(0x2f3540)); m.position.y = -0.3; l.add(m); f.add(l); return l; });
    f.position.set(studentX(st, 0), 0.14, st.lane); f.rotation.y = Math.PI / 2; // +x(내리막) 방향을 바라봄
    g.add(f); streetActors.push({ f, st, legs, pack });
  });
  scene.add(g);
}
function stepStreet(t) {
  for (const a of streetActors) {
    const x = studentX(a.st, t);
    a.f.position.x = x;
    const sw = Math.sin(t * 5 + a.st.phase * 9) * 0.55; // 제자리 걷기(다리 교차) + 몸 상하 흔들림
    a.legs[0].rotation.x = sw; a.legs[1].rotation.x = -sw;
    a.f.position.y = 0.14 + Math.abs(Math.sin(t * 5 + a.st.phase * 9)) * 0.03;
  }
}
// 하단 오른쪽(동쪽) 벽걸이 에어컨: 작은 직사각형 + '에어컨' 라벨(DOM). 충돌·클릭 없음.
function buildAircon() {
  const g = new THREE.Group(); g.position.set(AIRCON.x, AIRCON.y, AIRCON.z);
  box(AIRCON.d, AIRCON.h, AIRCON.w, std(0xe9ece9, 0.5), 0, 0, 0, g);
  box(AIRCON.d * 0.4, 0.04, AIRCON.w * 0.9, std(0xb9c0bd, 0.5), -AIRCON.d * 0.3, -AIRCON.h * 0.35, 0, g);
  scene.add(g);
}

// 술 냉장고: 서쪽 벽에 붙인 유리문 냉장고(문이 +x 를 봄). 클릭하면 걸어가서 술을 고른다.
function buildFridge() {
  const g = new THREE.Group(); g.position.set(FRIDGE_POS.x, 0, FRIDGE_POS.z); g.rotation.y = Math.PI / 2; // 로컬 +z(앞면)가 월드 +x
  box(0.9, 1.9, 0.7, std(0x23282a, 0.5), 0, 0.95, 0, g);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.4, 0.03), new THREE.MeshStandardMaterial({ color: 0x9ed8e8, transparent: true, opacity: 0.35, roughness: 0.1 }));
  door.position.set(0, 0.88, 0.355); g.add(door);
  [0.3, 0.75, 1.2].forEach((y, r) => {
    box(0.7, 0.03, 0.5, std(0xcccccc, 0.5), 0, y, 0, g);
    for (let i = 0; i < 5; i++) {
      const f = FRIDGE[(r * 5 + i) % FRIDGE.length];
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.26, 8), std(f.color, 0.3)); b.position.set(-0.28 + i * 0.14, y + 0.15, 0.05); g.add(b);
    }
  });
  box(0.7, 0.03, 0.02, new THREE.MeshBasicMaterial({ color: 0xe8fff8 }), 0, 1.58, 0.3, g);
  const head = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), new THREE.MeshBasicMaterial({
    map: canvasTex(256, 64, (c, w, hh) => { c.fillStyle = '#12201d'; c.fillRect(0, 0, w, hh); c.fillStyle = '#ffc861'; c.font = 'bold 34px sans-serif'; c.textAlign = 'center'; c.fillText('술 냉장고', w / 2, 44); }),
  }));
  head.position.set(0, 1.8, 0.356); g.add(head);
  g.traverse((o) => { if (o.isMesh) { o.userData.fridge = true; pickables.push(o); } });
  scene.add(g);
}

/* ---- 아바타 (도형만) ---- */
function makeAvatar(color, { apron = false } = {}) {
  const g = new THREE.Group(); const root = new THREE.Group(); g.add(root);
  const skin = std(0xe6c3a0, 0.7);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.62, 12), std(color, 0.8)); body.position.y = 0.96; root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin); head.position.y = 1.45; root.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), std(0x2b1d14, 0.9)); hair.position.y = 1.47; root.add(hair);
  const eyeM = std(0x111111, 0.4);
  [-0.07, 0.07].forEach((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeM); e.position.set(x, 1.47, 0.18); root.add(e); });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), std(0x8a2d2d)); smile.rotation.z = Math.PI; smile.position.set(0, 1.4, 0.185); smile.visible = false; root.add(smile);
  const flat = box(0.1, 0.014, 0.01, std(0x8a2d2d), 0, 1.38, 0.19, root);
  const legs = [-0.1, 0.1].map((x) => { const p = new THREE.Group(); p.position.set(x, 0.65, 0); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.5, 8), std(0x3c4450)); l.position.y = -0.25; p.add(l); root.add(p); return p; });
  [-0.3, 0.3].forEach((x) => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), std(color, 0.8)); a.position.set(x, 0.95, 0); root.add(a); });
  if (apron) box(0.36, 0.5, 0.02, std(0xf3ead2), 0, 0.9, 0.21, root);
  g.userData = { root, legs, smile, flat, head };
  return g;
}
function poseAvatar(g, { seated, level, t, rid }) {
  const u = g.userData;
  u.legs.forEach((p) => { p.rotation.x = seated ? -Math.PI / 2 : 0; });
  u.root.position.y = seated ? -0.17 : 0;
  u.smile.visible = level >= 1; u.flat.visible = level < 1;
  const sway = level >= 3 ? Math.sin(t * 2 + rid) * 0.05 * (level - 2) : 0;
  u.root.rotation.z = sway; u.root.rotation.x = level >= 3 ? Math.sin(t * 1.3 + rid) * 0.03 * (level - 2) : 0;
}

/* ---- 파티클 (무지개 토 · 건배) ---- */
function burst(pos, kind) {
  const n = kind === 'rainbow' ? 180 : 60;
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3), v = new Float32Array(n * 3);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    p.set([pos.x, pos.y, pos.z], i * 3);
    if (kind === 'rainbow') col.setHSL((i % 7) / 7, 1, 0.55); else col.setHSL(0.11 + Math.random() * 0.04, 1, 0.6 + Math.random() * 0.2);
    c.set([col.r, col.g, col.b], i * 3);
    const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 2.2;
    v.set([Math.cos(a) * sp * 0.6, (kind === 'rainbow' ? 0.5 : 2) + Math.random() * 2, Math.sin(a) * sp * 0.6], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.Points(geo, new THREE.PointsMaterial({ size: kind === 'rainbow' ? 0.14 : 0.09, vertexColors: true, transparent: true, depthWrite: false }));
  scene.add(m); bubbles.push({ m, v, life: kind === 'rainbow' ? 2.4 : 1.4, age: 0, fwd: null });
}
function stepParticles(dt) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]; b.age += dt;
    const pa = b.m.geometry.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      b.v[k * 3 + 1] -= 3.2 * dt;
      pa.array[k * 3] += b.v[k * 3] * dt; pa.array[k * 3 + 1] += b.v[k * 3 + 1] * dt; pa.array[k * 3 + 2] += b.v[k * 3 + 2] * dt;
      if (pa.array[k * 3 + 1] < 0.02) { pa.array[k * 3 + 1] = 0.02; b.v[k * 3 + 1] = 0; b.v[k * 3] *= 0.5; b.v[k * 3 + 2] *= 0.5; }
    }
    pa.needsUpdate = true; b.m.material.opacity = Math.max(0, 1 - b.age / b.life);
    if (b.age > b.life) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); bubbles.splice(i, 1); }
  }
}

/* ---- 내 아바타 · 주인 ---- */
let myAvatar = null, ownerAvatar = null;
function buildActors() {
  myAvatar = makeAvatar(S.me.color); myAvatar.position.copy(S.pos); scene.add(myAvatar);
  ownerAvatar = makeAvatar(0x6a3b2a, { apron: true }); ownerAvatar.position.copy(OWNER_POS); ownerAvatar.rotation.y = 0;
  ownerAvatar.traverse((o) => { if (o.isMesh) { o.userData.owner = true; pickables.push(o); } });
  scene.add(ownerAvatar);
}

/* ---- 라벨/말풍선 (DOM 오버레이) ---- */
const labels = new Map(); // key → {el, bub, until}
function labelFor(key, text, cls = '') {
  let l = labels.get(key);
  if (!l) { l = { el: h('div', { class: 'lab' }), bub: h('div', { class: 'bub', hidden: true }), until: 0 }; $('#labels').append(l.el, l.bub); labels.set(key, l); }
  if (l.el.textContent !== text) l.el.textContent = text;
  l.el.className = `lab ${cls}`;
  return l;
}
function dropLabel(key) { const l = labels.get(key); if (l) { l.el.remove(); l.bub.remove(); labels.delete(key); } }
function say(key, text, ms = 5000) { const l = labels.get(key); if (!l) return; l.bub.textContent = text; l.bub.hidden = false; l.until = performance.now() + ms; }
const tmpV = new THREE.Vector3();
function project(el, x, y, z) {
  tmpV.set(x, y, z).project(camera);
  el.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
  el.style.visibility = (tmpV.z > 1 || Math.abs(tmpV.x) > 1.2) ? 'hidden' : 'visible';
}
function ownerSay(text, ms = 6500) {
  const b = $('#owner-bubble'); b.textContent = `사장님: ${text}`; b.hidden = false;
  clearTimeout(ownerSay._t); ownerSay._t = setTimeout(() => { b.hidden = true; }, ms);
  if (T) logLine(`🍳 사장님: ${text}`, 'sys');
}

/* ================================================================ 네트워크: 로비(위치만) · 디렉토리(테이블 점유) */
function initSupabase() {
  try {
    if (!window.supabase?.createClient) throw new Error('supabase-js 로드 실패');
    Net.sb = window.supabase.createClient(MP_CONFIG.url, MP_CONFIG.anonKey, { realtime: { params: { eventsPerSecond: 20 } } });
  } catch (e) { console.warn('[amado] Supabase 사용 불가 → 1인 모드', e); Net.sb = null; }
}
function updateBadge() { if (S.online) $('#net-badge').textContent = `온라인 · ${lobbyMembers.size + 1}명 접속 중`; }
function setOnline(on) {
  S.online = on;
  const b = $('#net-badge');
  b.textContent = on ? `온라인 · ${lobbyMembers.size + 1}명 접속 중` : (Net.everUp && S.entered ? '재연결 중… (잠시 1인 모드)' : '1인 모드 (혼자 둘러보기·주문 연습)');
  b.className = `badge ${on ? 'on' : 'off'}`;
}
function lobbyPayload() {
  return { id: S.me.id, name: S.me.name, color: S.me.color, x: +S.pos.x.toFixed(2), z: +S.pos.z.toFixed(2), rot: +S.rot.toFixed(2), table: S.table, seat: S.seat, sit: S.seated };
}
let lastLobby = '';
function trackLobby(force) {
  if (!Net.lobby || !Net.ready) return;
  const p = lobbyPayload(); const s = JSON.stringify(p);
  if (!force && s === lastLobby) return;
  lastLobby = s; Promise.resolve(Net.lobby.track(p)).catch(() => {});
}
// 구독이 CLOSED/CHANNEL_ERROR/TIMED_OUT 이 되면 1→2→4→8…최대 30초 간격으로 계속 재구독한다. 성공하면 onUp 으로 재등록(presence track 등).
function keepChannel(label, make, onUp, onDown) {
  const k = { ch: null, attempt: 0, timer: 0 };
  const retry = () => {
    if (k.timer) return;
    const delay = Math.min(30000, 1000 * 2 ** k.attempt++);
    console.warn(`[amado] ${label} channel: ${delay / 1000}초 뒤 재구독`);
    k.timer = setTimeout(() => { k.timer = 0; connect(); }, delay);
  };
  async function connect() {
    const old = k.ch; k.ch = null; // 먼저 비워서 옛 채널의 CLOSED 콜백이 재시도를 또 걸지 않게 한다
    if (old) { try { await Net.sb.removeChannel(old); } catch { /* 무시 */ } }
    const ch = make(); k.ch = ch;
    ch.subscribe((st) => {
      if (k.ch !== ch) return;
      console.warn(`[amado] ${label} channel: ${st}`);
      if (st === 'SUBSCRIBED') { k.attempt = 0; onUp(ch); }
      else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { onDown(); retry(); }
    });
  }
  // 콜백 없이 조용히 죽은 채널 대비 감시
  setInterval(() => {
    if (k.timer || !k.ch) return;
    if (k.ch.state === 'closed' || k.ch.state === 'errored') { console.warn(`[amado] ${label} channel: state=${k.ch.state}`); onDown(); retry(); }
  }, 10000);
  connect();
  return k;
}
function joinLobby() {
  if (!Net.sb) { setOnline(false); return; }
  Net.lobbyKeep = keepChannel('lobby',
    () => {
      const ch = Net.sb.channel(CH.lobby, { config: { presence: { key: S.me.id } } });
      ch.on('presence', { event: 'sync' }, () => onLobbySync(ch.presenceState()));
      Net.lobby = ch; return ch;
    },
    () => { Net.ready = true; Net.everUp = true; setOnline(true); trackLobby(true); },
    () => { Net.ready = false; setOnline(false); });
  Net.dirKeep = keepChannel('tables',
    () => {
      const ch = Net.sb.channel(CH.dir, { config: { broadcast: { self: false, ack: false } } });
      ch.on('broadcast', { event: 'tables-state' }, ({ payload }) => onDirState(payload));
      ch.on('broadcast', { event: 'tables-req' }, () => onDirReq());
      Net.dir = ch; return ch;
    },
    () => { Net.dirReady = true; dirSend('tables-req', { from: S.me.id }); announceTable(true); }, // 새로 들어오면(새로고침 포함) 현재 점유 상태부터 요청
    () => { Net.dirReady = false; });
  setTimeout(() => { if (!Net.ready) { setOnline(false); toast('실시간 연결에 실패했어요. 1인 모드로 둘러보세요.'); } }, 6000);
  setInterval(() => trackLobby(true), 15000); // 재접속 대비 재전송
  setInterval(() => { announceTable(true); refreshSitDialog(); }, DIR_HEARTBEAT_MS); // keeper heartbeat + 만료된 디렉토리 항목 정리
}
function onLobbySync(state) {
  const next = new Map();
  for (const [key, metas] of Object.entries(state)) {
    if (key === S.me.id || !metas.length) continue;
    const m = metas[metas.length - 1];
    const clean = {}; for (const k of LOBBY_KEYS) clean[k] = m[k]; // 허용 키만 사용
    next.set(key, clean);
  }
  lobbyMembers = next;
  for (const [id, m] of next) {
    let r = Remote.get(id);
    if (!r) {
      const g = makeAvatar(m.color ?? 0x888888); g.position.set(m.x, 0, m.z); scene.add(g);
      r = { g, t: { x: m.x, z: m.z, rot: m.rot }, m }; Remote.set(id, r);
    }
    r.t = { x: m.x, z: m.z, rot: m.rot }; r.m = m;
  }
  for (const id of [...Remote.keys()]) if (!next.has(id)) { const r = Remote.get(id); scene.remove(r.g); Remote.delete(id); dropLabel(`r:${id}`); }
  refreshSitDialog();
  updateBadge();
}

/* ---- 디렉토리: 앉은 사람이 로비 presence 에서 빠져도 테이블 점유가 남도록 keeper 가 상태를 직접 알린다 ---- */
function dirSend(event, payload) {
  if (!DIR_EVENTS.includes(event)) throw new Error(`디렉토리 이벤트 아님: ${event}`);
  if (!Net.dirReady || !Net.dir) return false;
  Net.dir.send({ type: 'broadcast', event, payload });
  return true;
}
function onDirState(p) {
  const tid = p?.tid;
  if (!Number.isInteger(tid) || tid < 1 || tid > TABLES) return;
  const count = clamp(Math.floor(+p.count || 0), 0, SEATS);
  if (count <= 0) Dir.delete(tid);
  else Dir.set(tid, { count, seats: Array.isArray(p.seats) ? p.seats.filter((s) => Number.isInteger(s) && s >= 0 && s < SEATS) : [], locked: p.locked === true, ts: Date.now() });
  refreshSitDialog();
}
function onDirReq() { setTimeout(() => announceTable(true), Math.random() * 250); } // keeper 들이 한꺼번에 답하지 않게 약간 흩뿌림
function dirEntry(tid) {
  const e = Dir.get(tid); if (!e) return null;
  if (Date.now() - e.ts > DIR_TTL_MS) { Dir.delete(tid); return null; } // keeper 가 사라진 테이블은 만료
  return e;
}
function tableStateOf(sess) {
  const seats = [...sess.members.values()].map((m) => m.seat).filter(Number.isInteger);
  return { tid: sess.id, count: sess.members.size, seats, locked: !!sess.code, from: S.me.id }; // locked = 비밀번호가 설정된 테이블
}
// 내가 이 테이블의 keeper(가장 먼저 앉은 사람)일 때만 알린다. 생성·합류/퇴장(인원 변화)·5초 heartbeat·tables-req 응답.
function announceTable(force) {
  const s = T;
  if (!s || !s.subscribed || s.left || !s.ready || !isKeeper(s)) return;
  const p = tableStateOf(s); const sig = `${p.count}:${p.seats.join(',')}`;
  if (!force && sig === s.dirSig) return;
  s.dirSig = sig; dirSend('tables-state', p);
}
async function dirProbe(ms) { // 로비에 들어온 직후·생성 직전: 디렉토리를 다시 요청하고 keeper 응답을 잠깐 기다린다
  if (!Net.dirReady) return;
  dirSend('tables-req', { from: S.me.id });
  await new Promise((r) => setTimeout(r, ms));
}
// 점유 여부는 디렉토리(keeper broadcast)를 먼저 보고, 로비 presence 는 보조로만 쓴다. 앉아 있는 테이블이면 세션 멤버가 정답.
function occupants(tid) {
  if (T?.id === tid) return [...T.members.values()].map((m) => ({ id: m.id, seat: m.seat }));
  const seats = new Set(); const e = dirEntry(tid); let count = e ? e.count : 0;
  if (e) e.seats.forEach((s) => seats.add(s));
  let pres = 0;
  for (const m of lobbyMembers.values()) if (m.table === tid) { pres++; if (Number.isInteger(m.seat)) seats.add(m.seat); }
  count = Math.max(count, pres, seats.size);
  const list = [...seats].map((seat) => ({ seat }));
  while (list.length < count) list.push({ seat: null });
  return list;
}
const seatTaken = (tid, idx) => occupants(tid).some((m) => m.seat === idx);

/* ================================================================ 네트워크: 테이블 세션 */
function newSession(tid, code, creator, seat) {
  return { id: tid, code, creator, seat, joinedAt: Date.now(), members: new Map(), ch: null, door: null, subscribed: false,
    ready: false, synced: false, pendingToast: null, dirSig: '', cart: [], served: [], serving: new Map(),
    fails: new Map(), usedNonces: new Set(), left: false, chat: [] };
}
const seatTarget = (tid, i) => {
  const d = TABLE_DEFS[tid - 1], sp = d.seats[i];
  return { x: sp.x, z: sp.z, yaw: seatYaw(d, sp) };
};
function trackTable() {
  if (!T) return;
  const p = tablePayload();
  T.members.set(S.me.id, p);
  if (T.ch && T.subscribed) Promise.resolve(T.ch.track(p)).catch(() => {});
  renderGrid();
}
function tablePayload() {
  return { id: S.me.id, name: S.me.name, why: S.me.why, color: S.me.color, seat: S.seat, drunk: S.drunk, hunger: S.hunger, cam: S.cam, mic: S.mic, peer: S.peerId, wc: S.wc, joinedAt: T.joinedAt, creator: T.creator };
}
function tsend(event, payload) {
  if (!T) return;
  if (!PRIVATE_EVENTS.includes(event)) throw new Error(`비공개 이벤트 아님: ${event}`);
  if (T.ch && T.subscribed) { T.ch.send({ type: 'broadcast', event, payload }); return; }
  if (T.ch) return; // 구독 전 — 보내지 않는다(다른 곳으로 새지 않게)
  queueMicrotask(() => onTableEvent(T, event, payload)); // 1인 모드: 루프백
}
function flushJoinToast(sess) { if (T !== sess || !sess.pendingToast) return; toast(sess.pendingToast); sess.pendingToast = null; }
// okMsg 는 첫 테이블 presence sync 에서 멤버십이 확정된 뒤에만 띄운다 (rival 충돌이면 띄우지 않고 충돌 토스트만).
async function openSession(tid, code, creator, seat, okMsg) {
  T = newSession(tid, code, creator, seat);
  const mySession = T;
  mySession.pendingToast = okMsg || null;
  if (Net.sb && Net.ready) {
    const ch = Net.sb.channel(CH.table(tid), { config: { broadcast: { self: true, ack: false }, presence: { key: S.me.id } } });
    ch.on('presence', { event: 'sync' }, () => onTableSync(mySession, ch.presenceState()));
    for (const ev of PRIVATE_EVENTS) ch.on('broadcast', { event: ev }, ({ payload }) => { if (T === mySession) onTableEvent(mySession, ev, payload); });
    mySession.ch = ch;
    await new Promise((res) => {
      const to = setTimeout(res, 6000);
      ch.subscribe((st) => { if (st === 'SUBSCRIBED') { mySession.subscribed = true; clearTimeout(to); res(); } });
    });
    const door = Net.sb.channel(CH.door(tid), { config: { broadcast: { self: false } } });
    door.on('broadcast', { event: 'knock' }, ({ payload }) => onKnock(mySession, payload));
    door.subscribe();
    mySession.door = door;
    if (!mySession.subscribed) { closeSession(); throw new Error('table-subscribe-failed'); }
  }
  S.table = tid; S.seat = seat;
  S.sitTarget = seatTarget(tid, seat); S.path = []; S.trip = null;
  trackTable(); trackLobby(true);
  mySession.ready = true; // 이 시점 이후의 presence sync 부터 멤버십을 판단한다
  onTableChanged(true);
  tsend('sync-req', { id: S.me.id });
  if (creator) { logLine(code ? `테이블 ${tid}에 앉았어요. 비밀번호를 같은 테이블 사람에게만 알려주세요.` : `테이블 ${tid}에 앉았어요. 비밀번호가 없는 공개 테이블이에요.`, 'sys'); announceTable(true); }
  if (!mySession.ch) flushJoinToast(mySession);       // 1인 모드: 기다릴 sync 가 없다
  else setTimeout(() => flushJoinToast(mySession), 4000); // sync 가 안 오는 경우의 안전장치
}
function closeSession() {
  const s = T; if (!s) return;
  s.left = true;
  try { if (s.ch) { s.ch.untrack?.(); Net.sb.removeChannel(s.ch); } } catch { /* 무시 */ }
  try { if (s.door) Net.sb.removeChannel(s.door); } catch { /* 무시 */ }
  T = null;
}
function leaveTable() {
  if (!T) return;
  const tid = T.id, sp = TABLE_DEFS[tid - 1], tripping = !!S.trip;
  // 마지막 사람이 나가면 즉시 '비어 있음'을 알린다 (다른 멤버가 남아 있으면 그쪽 keeper 가 이어서 알린다)
  if (T.synced && T.members.size <= 1) dirSend('tables-state', { tid, count: 0, seats: [], locked: false, from: S.me.id });
  stopMedia(true); closePeers();
  closeSession();
  S.path = []; S.trip = null; closeFridgePop();
  if (!tripping) {
    const seat = sp.seats[S.seat ?? 0]; const dx = seat.x - sp.x, dz = seat.z - sp.z, d = Math.hypot(dx, dz) || 1;
    S.pos.set(seat.x + (dx / d) * 0.8, 0, seat.z + (dz / d) * 0.8);
  }
  S.seated = false; S.table = null; S.seat = null; S.sitTarget = null; S.target = null;
  trackLobby(true); onTableChanged(false);
  dirSend('tables-req', { from: S.me.id }); // 떠난 테이블의 현재 상태를 바로 받아온다
}
function onTableSync(sess, state) {
  if (T !== sess) return;
  const next = new Map();
  for (const [key, metas] of Object.entries(state)) if (metas.length) next.set(key, metas[metas.length - 1]);
  next.set(S.me.id, tablePayload());
  sess.members = next;
  if (!sess.ready) return; // 자리 정보가 확정되기 전의 sync 는 멤버 목록만 갱신
  sess.synced = true;
  // 정원·자리 충돌·동시 생성 정리: (joinedAt,id) 순 우선
  const order = [...next.values()].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  const myIdx = order.findIndex((m) => m.id === S.me.id);
  if (myIdx >= SEATS) { toast('테이블이 만석이에요.'); leaveTable(); return; }
  const rival = order.find((m) => m.creator && m.id !== S.me.id && (m.joinedAt < sess.joinedAt || (m.joinedAt === sess.joinedAt && m.id < S.me.id)));
  if (sess.creator && rival) { toast('같은 순간에 다른 사람이 먼저 앉았어요. 테이블을 다시 눌러 앉아주세요.', 5000); leaveTable(); return; }
  const clash = order.find((m) => m.id !== S.me.id && m.seat === S.seat && (m.joinedAt < sess.joinedAt || (m.joinedAt === sess.joinedAt && m.id < S.me.id)));
  if (clash) {
    const free = [0, 1, 2, 3].find((i) => !order.some((m) => m.seat === i));
    if (free == null) { leaveTable(); return; }
    S.seat = free; S.sitTarget = seatTarget(sess.id, free); S.seated = false;
    trackTable(); trackLobby(true);
  }
  flushJoinToast(sess); // 멤버십 확정
  announceTable(false);
  renderGrid(); connectOutgoing(); flushPendingCalls();
}
const isKeeper = (sess) => {
  const order = [...sess.members.values()].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  return order.length && order[0].id === S.me.id;
};
async function onKnock(sess, p) {
  if (T !== sess || !p || !isKeeper(sess)) return;
  const reply = (extra) => sess.door.send({ type: 'broadcast', event: 'grant', payload: { to: p.id, nonce: p.nonce, ...extra } });
  const f = sess.fails.get(p.id) || { n: 0, until: 0 };
  if (Date.now() < f.until) return reply({ ok: false, reason: 'locked' });
  if (sess.usedNonces.has(p.nonce)) return;
  sess.usedNonces.add(p.nonce);
  const taken = [...sess.members.values()].map((m) => m.seat);
  if (sess.members.size >= SEATS) return reply({ ok: false, reason: 'full' });
  if (!sess.code) return reply({ ok: true, taken, open: true }); // 비밀번호 없는 공개 테이블: 바로 앉을 수 있다
  if (!p.proof) return reply({ ok: false, reason: 'need-pw' }); // 비밀번호가 필요한 테이블 — 입력 없이 노크한 경우(시도 횟수에 안 셈)
  const ok = (await proofOf(sess.id, sess.code, p.nonce)) === p.proof;
  if (!ok) { f.n++; if (f.n >= 3) { f.until = Date.now() + 60000; f.n = 0; } sess.fails.set(p.id, f); return reply({ ok: false, reason: 'bad' }); }
  sess.fails.delete(p.id);
  reply({ ok: true, taken });
}
// 새로 들어오는 사람의 노크 (코드 증명) → 문 채널에서 승인/거절
async function knock(tid, code) { // code 없으면 비밀번호 없이 노크(공개 테이블용)
  if (!(Net.sb && Net.ready)) return { ok: false, reason: 'offline' };
  const door = Net.sb.channel(CH.door(tid), { config: { broadcast: { self: false } } });
  const nonce = uid() + uid();
  let done;
  const got = new Promise((res) => { done = res; });
  door.on('broadcast', { event: 'grant' }, ({ payload }) => { if (payload?.to === S.me.id && payload.nonce === nonce) done(payload); });
  const sub = new Promise((res) => { const to = setTimeout(res, 5000); door.subscribe((st) => { if (st === 'SUBSCRIBED') { clearTimeout(to); res(true); } }); });
  await sub;
  door.send({ type: 'broadcast', event: 'knock', payload: { id: S.me.id, nonce, proof: code ? await proofOf(tid, code, nonce) : null } });
  const r = await Promise.race([got, new Promise((res) => setTimeout(() => res({ ok: false, reason: 'timeout' }), 5000))]);
  try { await Net.sb.removeChannel(door); } catch { /* 무시 */ }
  return r;
}

/* ---- 테이블 이벤트 처리 (모든 공유 상태는 여기로) ---- */
function onTableEvent(sess, ev, p) {
  if (!p || T !== sess) return;
  switch (ev) {
    case 'chat': addChat(p); break;
    case 'order': applyOrder(p.line); break;
    case 'cancel': sess.cart = sess.cart.filter((l) => !(l.id === p.itemId && l.by === p.id && l.status !== 'served')); renderCart(); renderTabletop(); break;
    case 'treat': {
      const l = sess.cart.find((x) => x.id === p.itemId);
      if (l && !l.service) { if (p.on) { l.paidBy = p.id; l.paidByName = p.name; } else if (l.paidBy === p.id) { l.paidBy = null; l.paidByName = null; } }
      renderCart(); break;
    }
    case 'cheers': {
      logLine(`🍻 ${p.name} 님의 건배!`, 'sys');
      if (p.id !== S.me.id) toast(`🍻 ${p.name} 님이 건배!`, 2200);
      const t = TABLE_DEFS[sess.id - 1]; burst(new THREE.Vector3(t.x, 1.1, t.z), 'cheers'); break;
    }
    case 'serve': applyServe(p); break;
    case 'eat': applyEat(p); break;
    case 'drink': applyDrink(p); break;
    case 'rainbow': {
      if (p.id !== S.me.id) {
        toast(`🌈 무지개 토! (${p.name})`, 3500, 'big'); logLine(`🌈 무지개 토! — ${p.name}`, 'sys');
        const r = Remote.get(p.id); if (r) burst(frontOf(r.g.position, r.g.rotation.y), 'rainbow');
      }
      break;
    }
    case 'care': {
      if (p.to === S.me.id) {
        addDrunk(p.kind === 'water' ? -1 : -0.5);
        toast(`${p.fromName} 님이 ${p.kind === 'water' ? '물을' : '안주를'} 건네줬어요`);
      }
      break;
    }
    case 'sync-req': {
      if (p.id !== S.me.id && isKeeper(sess)) tsend('sync', { to: p.id, cart: sess.cart, served: sess.served });
      break;
    }
    case 'sync': {
      if (p.to !== S.me.id) break;
      for (const l of p.cart || []) mergeLine(l);
      for (const s of p.served || []) mergeServed(s);
      renderCart(); renderTabletop(); syncTableProps(); break;
    }
    default: break;
  }
}
const frontOf = (pos, rot) => new THREE.Vector3(pos.x + Math.sin(rot) * 0.45, 1.3, pos.z + Math.cos(rot) * 0.45);

/* ================================================================ 취기 · 허기 */
function addDrunk(d) {
  const now = Date.now();
  let v = Math.max(0, S.drunk + d);
  if (d > 0 && S.rainbowUntil > now) v = Math.min(v, 4); // 쿨다운 중엔 무지개 토 재발동 방지
  const before = lvl();
  S.drunk = Math.min(5, v);
  if (S.drunk >= 5) { triggerRainbow(); return; }
  if (lvl() === 4 && before < 4) ownerSay(OWNER_LINES.care);
  applyDrunkFx(); if (T) trackTable();
}
function triggerRainbow() {
  S.drunk = 2; S.rainbowUntil = Date.now() + RAINBOW_COOLDOWN_MS;
  burst(frontOf(S.pos, S.rot), 'rainbow');
  const fl = $('#rainbow-flash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  toast('🌈 무지개 토!', 3000, 'big');
  if (T) {
    logLine('🌈 무지개 토! (취기가 많이 내려갔어요)', 'sys');
    tsend('rainbow', { id: S.me.id, name: S.me.name });
  }
  applyDrunkFx(); if (T) trackTable();
}
function applyDrunkFx() {
  const L = lvl();
  document.body.className = document.body.className.replace(/\bd\d\b/g, '').trim() + ` d${L}`;
  if (T) document.body.classList.add('zoomed');
  $('#dr-text').textContent = LEVELS[L];
  $$('.dr-bar i').forEach((i, k) => i.classList.toggle('on', k < L)); // 5칸 🍶: 채움=레벨 수, 빈 칸은 CSS 로 opacity .25
  $('.dr-bar').classList.toggle('l4', L >= 4);
  $('#btn-water').classList.toggle('blink', L >= 4);
  document.body.dataset.drunkLevel = String(L);
  const ci = $('#chat-input'); ci.classList.toggle('ghost', L >= 3 && Math.random() < 0.6);
}
// 허기: 0(배부름)~5(배고파 죽겠어요). 먹기 −1, 시간이 지나면 +1. 4 이상이 되면 한 번 알리고, 같은 단계에선 반복하지 않는다.
function addHunger(d) {
  const before = S.hunger;
  S.hunger = clamp(S.hunger + d, 0, 5);
  if (S.hunger === before) return;
  applyHungerFx();
  if (S.hunger < 4) S.hungerAlert = 0;
  else if (d > 0 && S.hunger > S.hungerAlert) {
    S.hungerAlert = S.hunger;
    toast('🍽️ 배고파요! 맛있는 거 시켜 먹어요', 4000);
    ownerSay(HUNGER_LINES[Math.floor(Math.random() * HUNGER_LINES.length)]);
  }
  if (T) { trackTable(); renderTabletop(); }
}
function applyHungerFx() {
  const L = S.hunger;
  $('#hg-text').textContent = HUNGER_TEXT[L];
  $$('.hg-bar i').forEach((i, k) => i.classList.toggle('on', k < L));
  $('.hg-bar').classList.toggle('hot', L >= 4);
}
function tickCooldown() {
  const el = $('#dr-cool'), left = Math.ceil((S.rainbowUntil - Date.now()) / 1000);
  el.hidden = left <= 0; if (left > 0) el.textContent = `🌈 무지개 토 쿨다운 ${left}초 (이 동안 취기 4 이상 안 올라가요)`;
  if (lvl() >= 3) $('#chat-input').classList.toggle('ghost', Math.random() < 0.5);
}
function drinkWater() { addDrunk(-1); toast('💧 물 마셨어요. 취기가 내려가요', 1800); }
function goToilet() {
  if (S.wc) return;
  S.wc = true; if (T) trackTable();
  const o = $('#toilet'); o.hidden = false; o.classList.remove('go'); void o.offsetWidth; o.classList.add('go');
  setTimeout(() => { o.hidden = true; o.classList.remove('go'); S.wc = false; addDrunk(-1); toast('🚽 개운해졌어요', 2000); if (T) trackTable(); }, 4200);
}
function cheers() {
  if (!T) { toast('테이블에 앉아야 건배할 수 있어요.'); return; }
  tsend('cheers', { id: S.me.id, name: S.me.name });
}
/* ================================================================ 주문 · 서빙 · 먹기/마시기
   원칙: 주문한다고 취하지 않는다. 먹고 마셔야 취한다(음식 먹기 −0.5, 술 마시기 +1 / 빈속 +1.5).
   음식: 주문(ordered) → 15~25초 뒤 사장님이 서빙(served) → 테이블 위에서 먹기.  술: 냉장고에서 직접 가져오면 바로 served. */
const allItems = () => S.menu.categories.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.id, kind: c.kind })));
const itemById = (id) => allItems().find((i) => i.id === id);
const rand = (a, b) => a + Math.random() * (b - a);
function order(item) {
  if (!T) { toast('테이블에 앉으면 주문할 수 있어요. 3D 테이블이나 의자를 눌러 앉아보세요.'); return; }
  if (item.kind === 'drink') { toast('술·음료는 주문하지 않고 술 냉장고에서 직접 가져와요.'); return; }
  const line = { id: uid(), itemId: item.id, name: item.name, price: item.price, alcohol: false, kind: 'food', by: S.me.id, byName: S.me.name, paidBy: null, paidByName: null, status: 'ordered', serveAt: Date.now() + rand(SERVE_MIN_MS, SERVE_MAX_MS) };
  tsend('order', { line });
  toast(`🧾 ${item.name} 주문했어요. 곧 나와요!`, 2200);
}
function chipLine() {
  return { id: CHIP_ID, itemId: 'shrimpchip', name: '알새우칩 (서비스)', price: 0, service: true, alcohol: false, kind: 'food', by: 'owner', byName: '사장님', host: S.me.id, paidBy: null, status: 'ordered', serveAt: Date.now() + rand(8000, 12000) };
}
function mergeLine(l) {
  const ex = T.cart.find((x) => x.id === l.id);
  if (!ex) T.cart.push({ ...l });
  else {
    if (l.paidBy && !ex.paidBy) { ex.paidBy = l.paidBy; ex.paidByName = l.paidByName; }
    if (l.status === 'served') ex.status = 'served';
  }
}
function mergeServed(s) { if (s?.sid && !T.served.some((x) => x.sid === s.sid)) T.served.push({ ...s }); }
// 'order' 이벤트는 장바구니 추가만 담당한다. 취기·허기에는 영향이 없다.
function applyOrder(line) {
  if (!line || T.cart.some((x) => x.id === line.id)) return;
  const l = { ...line };
  T.cart.push(l);
  logLine(`🧾 ${l.byName}: ${l.name} ${l.service ? '(서비스)' : won(l.price)}${l.fridge ? ' · 냉장고에서 가져감' : ''}`, 'sys');
  if (l.by === S.me.id && !l.fridge) {
    if (l.itemId === 'sukju' || l.itemId === 'corn') ownerSay(OWNER_LINES.order);
    const first = l.kind === 'food' && !T.cart.some((x) => x !== l && x.kind === 'food' && !x.service);
    if (first && !T.cart.some((x) => x.id === CHIP_ID)) tsend('order', { line: chipLine() }); // 첫 음식 주문 → 서비스 안주(알새우칩)
    const hr = new Date().getHours(); if (hr === 23 || hr === 0) ownerSay(OWNER_LINES.closing);
  }
  renderCart(); renderTabletop();
}
// 주문자의 클라이언트가 serveAt 에 'serve' 를 보낸다. 주문자가 이미 나갔으면 4초 뒤 keeper 가 대신 서빙한다.
function tickServe() {
  if (!T) return;
  const now = Date.now();
  for (const l of T.cart) {
    if (l.status !== 'ordered' || !l.serveAt || now < l.serveAt) continue;
    const sent = T.serving.get(l.id); if (sent && now - sent < 6000) continue;
    const resp = l.host || l.by;
    if (resp === S.me.id || (!T.members.has(resp) && now >= l.serveAt + 4000 && isKeeper(T))) {
      T.serving.set(l.id, now);
      tsend('serve', { sid: l.id, lineId: l.id, itemId: l.itemId, name: l.name.replace(' (서비스)', ''), kind: 'food', alcohol: false, unit: 'dish', max: BITES, free: !!l.service });
    }
  }
}
function applyServe(p) {
  if (!p?.sid || T.served.some((s) => s.sid === p.sid)) return;
  const kind = p.kind === 'drink' ? 'drink' : 'food';
  const max = clamp(Math.floor(+p.max || 1), 1, 8);
  const s = { sid: String(p.sid), lineId: p.lineId || null, itemId: String(p.itemId), name: String(p.name).slice(0, 40), kind, alcohol: !!p.alcohol, unit: p.unit === 'bottle' ? 'bottle' : kind === 'drink' ? 'glass' : 'dish', max, left: max, free: !!p.free };
  T.served.push(s);
  const l = T.cart.find((x) => x.id === s.lineId); if (l) l.status = 'served';
  if (kind === 'food') {
    logLine(`🍽️ ${s.name} 나왔어요${s.free ? ' (서비스)' : ''}`, 'sys');
    ownerSay(s.itemId === 'shrimpchip' ? OWNER_LINES.service : SERVE_LINES[Math.floor(Math.random() * SERVE_LINES.length)]);
  } else logLine(`🧊 ${s.name} — 테이블 위에 놓였어요`, 'sys');
  renderCart(); renderTabletop(); syncTableProps();
}
// 먹기/마시기: 눌러서 'eat'/'drink' 를 broadcast → 모든 클라이언트가 남은 횟수를 줄이고, 효과는 누른 사람만 받는다.
function eatServed(sid) {
  const s = T?.served.find((x) => x.sid === sid && x.kind === 'food');
  if (!s || s.left <= 0) return;
  tsend('eat', { sid, id: S.me.id, name: S.me.name, dd: -0.5, dh: -1 });
}
function drinkServed(sid) {
  const s = T?.served.find((x) => x.sid === sid && x.kind === 'drink');
  if (!s || s.left <= 0) return;
  tsend('drink', { sid, id: S.me.id, name: S.me.name, dd: drinkDelta(s.alcohol, S.hunger), dh: 0 });
}
function finishServed(s, verb) {
  T.served = T.served.filter((x) => x !== s);
  logLine(`${verb} — ${s.name}`, 'sys');
}
function applyEat(p) {
  const s = T.served.find((x) => x.sid === p.sid && x.kind === 'food');
  if (!s || s.left <= 0) return;
  s.left--;
  if (p.id === S.me.id) {
    addDrunk(clamp(+p.dd || 0, -1, 0)); addHunger(clamp(+p.dh || 0, -1, 0));
    toast(`🥢 ${s.name} 냠냠, 취기가 조금 내려가고 배가 불러요`, 1500);
  }
  if (s.left <= 0) finishServed(s, '다 먹었어요');
  renderCart(); renderTabletop(); syncTableProps();
}
function applyDrink(p) {
  const s = T.served.find((x) => x.sid === p.sid && x.kind === 'drink');
  if (!s || s.left <= 0) return;
  s.left--;
  const dd = clamp(+p.dd || 0, 0, 1.5);
  if (p.id === S.me.id) {
    if (dd > 0) { addDrunk(dd); toast(dd > 1 ? `🍶 ${s.name} 한 잔 — 빈속이라 더 빨리 취해요` : `🍶 ${s.name} 한 잔 마셨어요`, 2000); }
    else toast(`🥤 ${s.name} 한 잔 마셨어요`, 1500);
  } else logLine(`🥂 ${p.name} 님이 ${s.name}을(를) 마셨어요`, 'sys');
  if (s.left <= 0) finishServed(s, '다 마셨어요');
  renderCart(); renderTabletop(); syncTableProps();
}

/* ---- 술 냉장고: 클릭 → 걸어감 → 선택 팝업 → 자리로 복귀 → 테이블 위 + 계산서에 추가 ---- */
function useFridge() {
  if (!T) { toast('테이블에 앉은 뒤에 가져올 수 있어요.'); return; }
  if (S.trip) return;
  if (!S.seated) { toast('자리에 먼저 앉아주세요.'); return; }
  S.trip = { phase: 'going', pick: null };
  S.seated = false; S.sitTarget = null; S.target = null;
  S.path = fridgeRoute(S.pos);
  trackLobby(true);
}
// 자리(좌석 x)에서 곧장 통행로(z)로 나와 냉장고 앞으로. 테이블 사이 통로·바깥 열은 충돌 영역 밖이다(selfTest 가 24석 전부 검사).
function fridgeRoute(from) {
  return [{ x: from.x, z: from.z }, { x: from.x, z: FRIDGE_LANE_Z }, { x: FRIDGE_STAND.x, z: FRIDGE_LANE_Z }, { x: FRIDGE_STAND.x, z: FRIDGE_STAND.z }];
}
function onPathEnd() {
  if (S.trip?.phase !== 'going') return;
  S.rot = FRIDGE_ROT; // 냉장고를 바라봄
  openFridgePop();
}
function openFridgePop() {
  const list = $('#fr-list'); list.textContent = '';
  for (const def of FRIDGE) {
    const it = itemById(def.menuId);
    list.append(h('button', { class: 'fr-item', onclick: () => pickDrink(def) }, h('b', {}, def.name),
      h('small', {}, `${won(it.price)} · ${def.unit === 'bottle' ? '1병 = 4잔' : '1잔'}${it.alcohol ? '' : ' · 무알코올'}`)));
  }
  if (S.trip) S.trip.phase = 'choosing';
  $('#fridge').hidden = false;
}
function closeFridgePop() { const f = $('#fridge'); if (f) f.hidden = true; }
function pickDrink(def) { closeFridgePop(); ownerSay(FRIDGE_LINE); returnToSeat(def); }
function cancelFridge() { closeFridgePop(); returnToSeat(null); }
function returnToSeat(def) {
  if (!T || !S.trip) return;
  S.trip = { phase: 'returning', pick: def };
  const seat = TABLE_DEFS[T.id - 1].seats[S.seat];
  S.path = fridgeRoute(seat).reverse().slice(1);
  S.sitTarget = seatTarget(T.id, S.seat);
}
function onSeated() { // 자리에 도착
  const tr = S.trip; S.trip = null;
  if (tr?.pick) deliverDrink(tr.pick);
}
function deliverDrink(def) {
  if (!T) return;
  const it = itemById(def.menuId);
  const line = { id: uid(), itemId: def.key, name: def.name, price: it.price, alcohol: !!it.alcohol, kind: 'drink', by: S.me.id, byName: S.me.name, paidBy: null, paidByName: null, status: 'served', fridge: true };
  tsend('order', { line }); // 계산서에 자동 추가
  tsend('serve', { sid: line.id, lineId: line.id, itemId: def.key, name: def.name, kind: 'drink', alcohol: line.alcohol, unit: def.unit, max: bitesOf('drink', def.unit) });
}

/* ---- 3D 테이블 위 접시·술병 (served 목록과 동기화, 클릭하면 먹기/마시기) ---- */
const PROP_SLOTS = [[-0.17, -0.35], [-0.17, 0], [-0.17, 0.35], [0.17, -0.35], [0.17, 0], [0.17, 0.35], [0, -0.62], [0, 0.62]];
function removeProp(g) {
  scene.remove(g);
  g.traverse((o) => { const i = pickables.indexOf(o); if (i >= 0) pickables.splice(i, 1); o.geometry?.dispose(); o.material?.dispose?.(); });
}
function clearProps() { for (const g of PROPS.values()) removeProp(g); PROPS.clear(); }
const PROPS = new Map(); // sid → Group (내가 앉은 테이블의 것만)
function makeProp(s) {
  const g = new THREE.Group();
  if (s.kind === 'food') {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.02, 16), std(0xf4f1ea, 0.3)); plate.position.y = 0.01; g.add(plate);
    let hash = 0; for (const ch of s.itemId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const col = new THREE.Color().setHSL((hash % 360) / 360, 0.55, 0.5);
    const food = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), std(s.itemId === 'shrimpchip' ? 0xf2a65a : col, 0.7)); food.position.y = 0.05; food.scale.y = 0.6; g.add(food);
    g.userData.food = food;
  } else {
    const color = FRIDGE.find((f) => f.key === s.itemId)?.color ?? 0xcccccc;
    if (s.unit === 'bottle') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 10), std(color, 0.25)); body.position.y = 0.1; g.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.03, 0.09, 10), std(color, 0.25)); neck.position.y = 0.245; g.add(neck);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), std(0xdddddd, 0.4)); cap.position.y = 0.3; g.add(cap);
    } else {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.13, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.2, transparent: true, opacity: 0.85 })); cup.position.y = 0.065; g.add(cup);
      if (s.itemId === 'draft') { const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), std(0xfffbee, 0.9)); foam.position.y = 0.14; g.add(foam); }
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.userData.serve = s.sid; pickables.push(o); } });
  return g;
}
function syncTableProps() {
  const want = new Set(T ? T.served.map((s) => s.sid) : []);
  for (const [sid, g] of [...PROPS]) if (!want.has(sid)) { removeProp(g); PROPS.delete(sid); }
  if (!T) return;
  const def = TABLE_DEFS[T.id - 1];
  const used = new Set([...PROPS.values()].map((g) => g.userData.slot));
  for (const s of T.served) {
    let g = PROPS.get(s.sid);
    if (!g) {
      let slot = 0; while (used.has(slot)) slot++;
      used.add(slot);
      g = makeProp(s); g.userData.slot = slot;
      const [dx, dz] = PROP_SLOTS[slot % PROP_SLOTS.length];
      g.position.set(def.x + dx, 0.835 + Math.floor(slot / PROP_SLOTS.length) * 0.12, def.z + dz);
      scene.add(g); PROPS.set(s.sid, g);
    }
    if (g.userData.food) { const k = 0.4 + 0.6 * (s.left / s.max); g.userData.food.scale.set(k, k * 0.6, k); } // 먹을수록 줄어듦
  }
}

function renderCart() {
  const box = $('#cart-lines'); box.textContent = '';
  const cart = T?.cart || [];
  $('#cart-count').textContent = cart.length ? `(${cart.length})` : '';
  if (!T) { box.textContent = '테이블에 앉으면 주문할 수 있어요.'; $('#cart-total').textContent = ''; return; }
  if (!cart.length) box.textContent = '아직 주문이 없어요. 음식은 위 메뉴판에서 담고, 술은 술 냉장고에서 가져오세요.';
  for (const l of cart) {
    const stat = l.status === 'served' ? '✅ 나왔어요' : '⏳ 사장님이 준비 중';
    const row = h('div', { class: `line ${l.service ? 'svc' : ''}` },
      h('div', { class: 'l1' }, `${l.name}`, h('small', {}, `${l.byName} · ${l.service ? '서비스' : won(l.price)} · ${stat}${l.paidBy ? ` · 🎁 ${l.paidByName} 님이 쏨` : ''}`)));
    if (!l.service && !l.paidBy) row.append(h('button', { onclick: () => tsend('treat', { itemId: l.id, id: S.me.id, name: S.me.name, on: true }) }, '🎁 내가 쏜다'));
    if (l.paidBy === S.me.id) row.append(h('button', { onclick: () => tsend('treat', { itemId: l.id, id: S.me.id, name: S.me.name, on: false }) }, '쏘기 취소'));
    if (l.by === S.me.id && !l.service && !l.paidBy && l.status === 'ordered') row.append(h('button', { onclick: () => tsend('cancel', { itemId: l.id, id: S.me.id }) }, '✕'));
    box.append(row);
  }
  const total = cart.filter((l) => !l.service).reduce((a, l) => a + l.price, 0);
  const by = {};
  for (const l of cart) if (l.paidBy && !l.service) by[l.paidByName] = (by[l.paidByName] || 0) + l.price;
  const tot = $('#cart-total'); tot.textContent = `합계 ${won(total)}`;
  const treated = Object.entries(by);
  if (treated.length) tot.append(h('small', {}, treated.map(([n, v]) => `🎁 ${n} 님 ${won(v)} 부담`).join(' · ')));
  tot.append(h('small', {}, '2026-09 메뉴판 기준, 변동 가능 · 서비스 항목은 합계 제외'));
}
// '테이블 위' 목록: 서빙된 음식(먹기)·술(마시기). 채팅 탭 상단에 둔다 — 앉으면 채팅 탭이 열려 바로 보인다.
function renderTabletop() {
  const box = $('#tabletop-list'); if (!box) return; box.textContent = '';
  if (!T) { box.append(h('div', { class: 'muted small' }, '테이블에 앉으면 서빙된 음식·술이 여기에 올라와요.')); return; }
  const hungry = S.hunger >= 4;
  for (const s of T.served) {
    const pips = '●'.repeat(s.left) + '○'.repeat(s.max - s.left);
    const info = h('div', { class: 'l1' }, s.name, h('small', {}, `${pips} ${s.left}/${s.max}${s.free ? ' · 서비스' : ''}`));
    const btn = s.kind === 'food'
      ? h('button', { title: '한 입 먹어요', onclick: () => eatServed(s.sid) }, '🥢 먹기')
      : h('button', { title: s.alcohol ? (hungry ? '빈속이라 더 빨리 취해요' : '한 잔 마셔요') : '무알코올 — 취기는 그대로예요', onclick: () => drinkServed(s.sid) },
        s.alcohol ? (hungry ? '🍶 마시기 (빈속)' : '🍶 마시기') : '🥤 마시기');
    box.append(h('div', { class: `top-item ${s.kind}` }, info, btn));
  }
  for (const l of T.cart.filter((x) => x.status === 'ordered')) box.append(h('div', { class: 'top-item pending muted small' }, `⏳ ${l.name} — 사장님이 준비 중`));
  if (!box.children.length) box.append(h('div', { class: 'muted small' }, '아직 테이블 위에 아무것도 없어요. 메뉴판에서 음식을 담거나, 술 냉장고에서 가져오세요.'));
}
function treatAll() {
  if (!T) return;
  for (const l of T.cart) if (!l.service && !l.paidBy) tsend('treat', { itemId: l.id, id: S.me.id, name: S.me.name, on: true });
}

/* ================================================================ 채팅 */
function logLine(text, cls = '', name = null) {
  const log = $('#chat-log'); const p = h('p', { class: cls });
  if (name) p.append(h('b', {}, `${name}: `)); p.append(document.createTextNode(text));
  log.append(p); while (log.children.length > 200) log.firstChild.remove(); log.scrollTop = log.scrollHeight;
  if (!$('#pane-chat').classList.contains('on') && cls !== 'sys') { const u = $('#chat-unread'); u.hidden = false; u.textContent = String((+u.textContent || 0) + 1); }
}
function addChat(p) {
  const mine = p.id === S.me.id;
  logLine(String(p.text).slice(0, 200), mine ? 'me' : '', p.name);
  say(mine ? 'me' : `r:${p.id}`, String(p.text).slice(0, 80));
}
function sendChat(text) {
  if (!T) { toast('테이블에 앉으면 대화할 수 있어요. 대화는 같은 테이블에만 보여요.'); return; }
  let t = text.trim().slice(0, 200); if (!t) return;
  if (lvl() === 2 && Math.random() < 0.4) t += ' ~ㅋㅋ';
  tsend('chat', { id: S.me.id, name: S.me.name, text: t });
}

/* ================================================================ 화상 (PeerJS, 카메라·마이크 기본 OFF) */
const media = { v: null, a: null, stream: null, out: new Map(), inc: new Map(), remote: new Map(), pending: [] };
function ensurePeer() {
  if (S.peer || !window.Peer) return;
  try {
    const p = new window.Peer(); // 공개 클라우드 0.peerjs.com, 키 불필요
    S.peer = p;
    p.on('open', (id) => { S.peerId = id; if (T) { trackTable(); connectOutgoing(); } });
    p.on('call', onCall);
    p.on('error', (e) => console.warn('[peer]', e?.type || e));
    p.on('disconnected', () => { try { p.reconnect(); } catch { /* 무시 */ } });
  } catch (e) { console.warn('[peer] 사용 불가', e); }
}
const memberByPeer = (pid) => [...(T?.members.values() || [])].find((m) => m.peer === pid && m.id !== S.me.id);
function onCall(call) {
  if (!memberByPeer(call.peer)) { media.pending.push({ call, at: Date.now() }); return; }
  acceptCall(call);
}
function acceptCall(call) {
  media.inc.get(call.peer)?.close();
  media.inc.set(call.peer, call);
  call.answer(); // 받기 전용(내 영상은 내가 거는 호출로 보냄)
  call.on('stream', (st) => { media.remote.set(call.peer, st); renderGrid(); });
  call.on('close', () => { if (media.inc.get(call.peer) === call) { media.inc.delete(call.peer); media.remote.delete(call.peer); renderGrid(); } });
  call.on('error', () => { media.remote.delete(call.peer); renderGrid(); });
}
function flushPendingCalls() {
  media.pending = media.pending.filter(({ call, at }) => {
    if (memberByPeer(call.peer)) { acceptCall(call); return false; }
    if (Date.now() - at > 15000) { try { call.close(); } catch { /* 무시 */ } return false; }
    return true;
  });
}
function connectOutgoing() {
  if (!S.peer || !S.peerId || !media.stream || !T) return;
  const ids = new Set();
  for (const m of T.members.values()) {
    if (m.id === S.me.id || !m.peer) continue;
    ids.add(m.peer);
    if (!media.out.has(m.peer)) {
      try { const c = S.peer.call(m.peer, media.stream); media.out.set(m.peer, c); c.on('close', () => media.out.delete(m.peer)); } catch (e) { console.warn(e); }
    }
  }
  for (const [pid, c] of [...media.out]) if (!ids.has(pid)) { try { c.close(); } catch { /* 무시 */ } media.out.delete(pid); }
}
function closeOutgoing() { for (const c of media.out.values()) { try { c.close(); } catch { /* 무시 */ } } media.out.clear(); }
function closePeers() {
  closeOutgoing();
  for (const c of media.inc.values()) { try { c.close(); } catch { /* 무시 */ } }
  media.inc.clear(); media.remote.clear(); media.pending = [];
}
function rebuildStream() {
  const tracks = [media.v, media.a].filter(Boolean);
  media.stream = tracks.length ? new MediaStream(tracks) : null;
  closeOutgoing(); connectOutgoing(); renderGrid();
}
async function toggleMedia(kind) {
  if (!T) { toast('테이블에 앉으면 카메라·마이크를 켤 수 있어요.'); return; }
  const key = kind === 'cam' ? 'v' : 'a';
  if (media[key]) { media[key].stop(); media[key] = null; S[kind] = false; }
  else {
    try {
      const st = await navigator.mediaDevices.getUserMedia(kind === 'cam' ? { video: { width: 480, height: 360 } } : { audio: true });
      media[key] = (kind === 'cam' ? st.getVideoTracks() : st.getAudioTracks())[0]; S[kind] = true;
      media[key].addEventListener('ended', () => { media[key] = null; S[kind] = false; trackTable(); updateMediaButtons(); rebuildStream(); });
      ensurePeer();
    } catch (e) { toast(`${kind === 'cam' ? '카메라' : '마이크'}를 쓸 수 없어요. 아바타 모드로 계속 이용해요.`, 4000); console.warn(e); }
  }
  updateMediaButtons(); trackTable(); rebuildStream();
}
function stopMedia(all) {
  for (const k of ['v', 'a']) { media[k]?.stop(); media[k] = null; }
  S.cam = false; S.mic = false; media.stream = null; if (all) updateMediaButtons();
}
function updateMediaButtons() {
  const c = $('#btn-cam'), m = $('#btn-mic');
  c.setAttribute('aria-pressed', String(S.cam)); c.textContent = `📷 카메라 ${S.cam ? 'ON' : 'OFF'}`;
  m.setAttribute('aria-pressed', String(S.mic)); m.textContent = `🎤 마이크 ${S.mic ? 'ON' : 'OFF'}`;
}

/* ================================================================ 줌형 격자 */
const tiles = new Map();
function renderGrid() {
  const grid = $('#zoom-grid'); if (!grid) return;
  if (!T) { grid.textContent = ''; tiles.clear(); return; }
  const members = [...T.members.values()].sort((a, b) => (a.seat ?? 9) - (b.seat ?? 9));
  const seen = new Set();
  for (const m of members.slice(0, SEATS)) {
    seen.add(m.id);
    const isMe = m.id === S.me.id;
    let t = tiles.get(m.id);
    if (!t) {
      t = { el: h('div', { class: 'tile' }), video: h('video', { autoplay: true, playsinline: true }), av: h('div', { class: 'av' }), nm: h('div', { class: 'nm' }), dd: h('div', { class: 'dd' }), meta: h('div', { class: 'meta' }), care: h('div', { class: 'care' }) };
      t.video.muted = isMe;
      t.el.append(t.video, t.av, t.nm, t.dd, t.meta, t.care);
      if (isMe) t.el.append(h('div', { class: 'meB', text: '나' }));
      tiles.set(m.id, t); grid.append(t.el);
    }
    t.el.classList.toggle('me', isMe);
    const L = clamp(Math.round(m.drunk || 0), 0, 5);
    const stream = isMe ? media.stream : media.remote.get(m.peer);
    const showVideo = !!m.cam && !!stream;
    if (t.video.srcObject !== (stream || null)) t.video.srcObject = stream || null;
    t.video.classList.toggle('hid', !showVideo);
    t.av.style.display = showVideo ? 'none' : ''; t.nm.style.display = showVideo ? 'none' : ''; t.dd.style.display = showVideo ? 'none' : '';
    t.av.style.background = `#${(m.color ?? 0x888888).toString(16).padStart(6, '0')}`; t.av.textContent = m.wc ? '🚽' : FACES[L];
    t.nm.textContent = m.name + (isMe ? ' (나)' : '');
    t.dd.textContent = m.wc ? '화장실 다녀오는 중' : (m.why ? `처음 온 이유: ${m.why}`.slice(0, 40) : LEVELS[L]);
    t.meta.textContent = '';
    t.meta.append(h('span', {}, `${isMe ? '나 · ' : ''}${m.name}`), h('span', {}, `${m.mic ? '🎤' : ''}${m.cam ? '📷' : ''} 🍺${L} 🍽️${clamp(Math.round(m.hunger ?? 0), 0, 5)}`));
    t.care.textContent = '';
    if (!isMe) {
      t.care.append(h('button', { title: '물 건네기', onclick: () => tsend('care', { from: S.me.id, fromName: S.me.name, to: m.id, kind: 'water' }) }, '💧'),
        h('button', { title: '안주 건네기', onclick: () => tsend('care', { from: S.me.id, fromName: S.me.name, to: m.id, kind: 'snack' }) }, '🥨'));
    }
  }
  for (let i = members.length; i < SEATS; i++) seen.add(`empty${i}`);
  for (const [id, t] of [...tiles]) if (!seen.has(id) && !id.startsWith('empty')) { t.el.remove(); tiles.delete(id); }
  // 빈자리 타일
  $$('.tile.empty', grid).forEach((e) => e.remove());
  for (let i = members.length; i < SEATS; i++) grid.append(h('div', { class: 'tile empty' }, '빈자리'));
  $('#zoom-note').textContent = `테이블 ${T.id} · ${members.length}/${SEATS}명 · 카메라·마이크는 기본 OFF — 꺼져 있으면 아바타로 보여요`;
}
function toggleGrid() { const z = $('#zoom'); z.hidden = !z.hidden; document.body.classList.toggle('zoomed', !z.hidden && !!T); }
function onTableChanged(sitting) {
  $('#zoom').hidden = !sitting;
  document.body.classList.toggle('zoomed', sitting);
  $('#btn-sit').textContent = sitting ? '🪑 일어서기' : '🪑 앉기 (E)';
  $('#btn-sit').hidden = !sitting;
  $('#btn-side').hidden = !sitting;
  setSide(sitting ? 'open' : 'hidden'); // 패널은 앉았을 때만 자동으로 열리고, 일어서면 닫힌다
  if (!sitting) { tiles.clear(); $('#zoom-grid').textContent = ''; clearProps(); }
  if (sitting) { ensurePeer(); showTab('chat'); }
  renderCart(); renderTabletop(); refreshSitDialog(); applyDrunkFx();
}

/* ================================================================ 앉기 다이얼로그 (로비 없음 — 3D 테이블·의자를 눌러 앉는다) */
let sitBusy = false, sitCtx = null;
const REASONS = { bad: '비밀번호가 틀렸어요. 앉을 수 없어요.', 'need-pw': '비밀번호가 있는 테이블이에요. 숫자 4자리를 입력하세요.', locked: '비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 시도하세요.', full: '테이블이 만석이에요.', timeout: '테이블이 응답하지 않아요. 잠시 후 다시 시도하세요.', offline: '연결이 없어 이 테이블에 앉을 수 없어요.' };
// 점유·비밀번호 여부는 디렉토리(locked 플래그)로 판단. 앉아 있는 테이블이면 세션이 정답. 모르면 null(입력란 선택 사항).
function tableLocked(tid) {
  if (T?.id === tid) return !!T.code;
  const e = dirEntry(tid);
  return e ? !!e.locked : null;
}
function tableLabel(tid) {
  const n = occupants(tid).length, lk = tableLocked(tid);
  return `테이블 ${tid} · ${n}/${SEATS}${n && lk !== false ? ' 🔒' : ''}`;
}
function sitState(tid) {
  const n = occupants(tid).length, lk = n ? tableLocked(tid) : false;
  return { n, lk, empty: n === 0 };
}
function refreshSitDialog() {
  if (!sitCtx) return;
  const { tid } = sitCtx, { n, lk, empty } = sitState(tid);
  $('#sit-title').textContent = `테이블 ${tid}`;
  $('#sit-info').textContent = `현재 ${n}/${SEATS}명 · ${empty ? '비어 있는 테이블이에요' : lk === true ? '🔒 비밀번호가 있어요' : lk === false ? '🔓 공개 테이블이에요' : '비밀번호가 있을 수 있어요'}`;
  $('#sit-hint').textContent = empty ? '비밀번호는 선택이에요. 숫자 4자리를 넣으면 이 테이블의 비밀번호가 되고, 비워두면 누구나 앉을 수 있어요. 처음 앉은 사람이 테이블을 지켜요.'
    : lk === true ? '이 테이블의 비밀번호(숫자 4자리)를 입력하세요.' : lk === false ? '비밀번호 없이 바로 앉을 수 있어요.' : '비밀번호가 있으면 입력하고, 없으면 비워두세요.';
  $('#sit-pw-row').hidden = !empty && lk === false;
  $('#sit-pw').placeholder = empty ? '● ● ● ● (선택)' : '● ● ● ●';
}
function setSitErr(msg) { $('#sit-err').textContent = msg || ''; }
function closeSitDialog(ok) {
  const c = sitCtx; if (!c) return;
  sitCtx = null; $('#sit-dialog').hidden = true; $('#sit-pw').value = ''; setSitErr('');
  c.resolve(!!ok);
}
// 단일 진입 경로: 3D 테이블/의자 클릭(또는 E) → requestSit → 다이얼로그 → confirmSit → (필요 시 knock) → openSession
function requestSit(tid, seatPref = null) {
  if (!S.entered || sitCtx) return Promise.resolve(false);
  if (T) { toast('이미 테이블에 앉아 있어요. 먼저 일어서세요.'); return Promise.resolve(false); }
  checkTid(tid);
  return new Promise((resolve) => {
    sitCtx = { tid, seatPref, resolve };
    $('#sit-pw').value = ''; setSitErr(''); $('#sit-dialog').hidden = false;
    refreshSitDialog();
    setTimeout(() => { if (sitCtx && !$('#sit-pw-row').hidden) $('#sit-pw').focus(); }, 30);
    if (!occupants(tid).length) dirProbe(300).then(refreshSitDialog); // 비어 보여도 keeper 응답을 잠깐 기다려 다시 확인
  });
}
async function joinExisting(tid, code, seatPref = null) {
  const r = await knock(tid, code);
  if (!r.ok) {
    if (r.reason === 'timeout') { Dir.delete(tid); refreshSitDialog(); }
    if (r.reason === 'need-pw') { const e = Dir.get(tid); if (e) e.locked = true; refreshSitDialog(); }
    setSitErr(REASONS[r.reason] || '앉을 수 없어요.'); return false;
  }
  const taken = r.taken || [];
  const seat = seatPref != null && !taken.includes(seatPref) ? seatPref : [0, 1, 2, 3].find((i) => !taken.includes(i));
  if (seat == null) { setSitErr('만석이에요.'); return false; }
  // 공개 테이블에 불필요하게 비밀번호를 넣었더라도 세션 비밀번호는 없음으로 둔다(나중에 keeper 가 되어도 테이블이 잠기지 않게)
  await openSession(tid, r.open ? null : (code || null), false, seat, `🪑 테이블 ${tid}에 앉았어요.`);
  return true;
}
async function confirmSit() {
  const c = sitCtx; if (!c || sitBusy) return;
  const { tid, seatPref } = c, pw = $('#sit-pw').value.trim();
  setSitErr('');
  if (pw && !/^\d{4}$/.test(pw)) { setSitErr('비밀번호는 숫자 4자리예요.'); return; }
  sitBusy = true;
  try {
    if (!occupants(tid).length) await dirProbe(400); // 앉기 직전 재확인 — 다이얼로그를 여는 사이 누가 앉았을 수 있다
    refreshSitDialog();
    const occ = occupants(tid);
    if (occ.length >= SEATS) { setSitErr('만석이에요.'); return; }
    const seat = seatPref != null && !seatTaken(tid, seatPref) ? seatPref : [0, 1, 2, 3].find((i) => !seatTaken(tid, i));
    if (seat == null) { setSitErr('빈자리가 없어요.'); return; }
    let sat;
    if (!occ.length) { // 처음 앉는 사람: 비밀번호는 선택. 4자리면 이 테이블 비밀번호, 비우면 공개. 앉으면 keeper.
      await openSession(tid, pw || null, true, seat, `🪑 테이블 ${tid}에 앉았어요.`); sat = true;
    } else {
      if (tableLocked(tid) === true && !pw) { setSitErr(REASONS['need-pw']); return; }
      sat = await joinExisting(tid, pw || null, seat);
    }
    if (sat) closeSitDialog(true);
  } catch (e) { console.warn(e); setSitErr('테이블에 연결하지 못했어요. 잠시 후 다시 시도하세요.'); } finally { sitBusy = false; }
}

/* ================================================================ 패널 UI */
// 패널: 'hidden'(서 있을 때) / 'open'(앉았을 때 자동) / 'min'(최소화 → 작은 ☰ 메뉴 알약 버튼)
function setSide(mode) {
  S.side = mode;
  $('#side').classList.toggle('open', mode === 'open');
  $('#side-pill').hidden = mode !== 'min';
  document.body.classList.toggle('side-closed', mode !== 'open');
}
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.id === `pane-${name}`));
  if (name === 'chat') { $('#chat-unread').hidden = true; $('#chat-unread').textContent = '0'; }
}
function renderMenu() {
  const cats = $('#menu-cats'); cats.textContent = '';
  for (const c of S.menu.categories) cats.append(h('button', { class: c.id === S.activeCat ? 'on' : '', onclick: () => { S.activeCat = c.id; renderMenu(); } }, c.name));
  const box = $('#menu-items'); box.textContent = '';
  const cat = S.menu.categories.find((c) => c.id === S.activeCat);
  if (cat.kind === 'drink') box.append(h('div', { class: 'disc fridge-note' }, '🧊 술·음료는 주문하지 않고 술 냉장고에서 직접 가져오세요. 가져가면 계산서에 자동으로 올라가요.'));
  for (const it of cat.items) {
    box.append(h('div', { class: 'item' }, h('span', { class: 'nm' }, it.name, it.signature ? h('span', { class: 'sig' }, '시그니처') : null, it.alcohol ? ' 🍺' : ''),
      h('span', { class: 'pr' }, won(it.price)),
      cat.kind === 'drink' ? h('span', { class: 'hint' }, '🧊 냉장고에서') : h('button', { onclick: () => order({ ...it, kind: cat.kind }) }, '담기')));
  }
}
function renderInfo() {
  const b = $('#info-body'); b.textContent = '';
  b.append(h('h3', {}, '가게 소개'));
  b.append(h('p', { class: 'intro' }, '안녕하세요, 아마도예요 💚 중앙대 후문에서 작은 요리주점을 하고 있어요. Amado는 스페인어로 "애정하는"이라는 뜻이에요. 단골분들은 저희끼리 "아미고들"이라고 부른답니다. 크지 않은 공간이지만, 그만큼 조용하고 따뜻해요. 옥수수전 하나 시켜놓고 소주 한 잔, 천천히 이야기 나누다 가세요. 오늘도, 내일도, 아마도에서 만나요!'));
  b.append(h('p', { class: 'info-row' }, '주소 서울 동작구 흑석로 10 · 전화 070-4123-7776 · 인스타 @sangdo_amado'));
  b.append(h('p', { class: 'info-row' }, '영업시간은 가게에 직접 확인해주세요.'));
  b.append(h('p', { class: 'muted small' }, '이 월드는 비공식 팬메이드 재현이에요. 사진 속 인물이나 사장님을 특정하지 않으며, 사장님 NPC는 리뷰 언급에 기반한 캐릭터예요. 영업시간·전화번호·현재 가격은 가게에 직접 확인하세요.'));
}

/* ================================================================ 입장 인사 */
let greetTimer = 0;
function showGreeting() {
  $('#gr-text').textContent = GREETING.prompt;
  const opts = $('#gr-opts'); opts.textContent = '';
  for (const o of GREETING.options) opts.append(h('button', { class: 'primary', onclick: () => pickGreeting(o) }, o.text));
  $('#greet').hidden = false;
  clearTimeout(greetTimer); greetTimer = setTimeout(hideGreeting, GREET_TTL_MS); // 20초 뒤 자동으로 사라짐
}
function hideGreeting() { clearTimeout(greetTimer); $('#greet').hidden = true; }
function pickGreeting(o) {
  hideGreeting();
  say('me', o.text, 4500); logLine(`🙋 ${S.me.name}: ${o.text}`, 'sys');
  setTimeout(() => { ownerSay(o.reply); if (!T) logLine(`🍳 사장님: ${o.reply}`, 'sys'); }, 900);
}

/* ================================================================ 입력 · 카메라 · 이동 */
const keys = new Set(); let joy = { x: 0, y: 0 };
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables, false);
  return hits[0] || null;
}
function onWorldClick(ev) {
  if (!S.entered || S.wc) return;
  const hit = pick(ev); if (!hit) return;
  const u = hit.object.userData;
  if (u.serve) { const sv = T?.served.find((x) => x.sid === u.serve); if (sv) (sv.kind === 'food' ? eatServed : drinkServed)(sv.sid); return; }
  if (u.fridge) { useFridge(); return; }
  if (u.seat) { requestSit(u.seat.table, u.seat.idx); return; }
  if (u.table) { requestSit(u.table); return; }
  if (u.owner) { ownerClick(); return; }
  if (u.wc) { if (confirm('화장실 다녀올까요?')) goToilet(); return; }
  if (S.trip) return;
  if (u.floor && !T) S.target = { x: clamp(hit.point.x, BOUNDS.x0, BOUNDS.x1), z: clamp(hit.point.z, BOUNDS.z0, BOUNDS.z1) };
  else if (u.floor && T && !S.seated) S.target = { x: hit.point.x, z: hit.point.z };
}
let ownerIdx = 0;
function ownerClick() {
  const o = OWNER_LINES; const seq = [o.enter, o.order, o.service, o.care, o.closing];
  ownerSay(seq[ownerIdx++ % seq.length]);
}
function bindInput() {
  const el = renderer.domElement;
  let drag = null; const ptrs = new Map(); let pinch = 0;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY, moved: false }; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); orbit.dist = clamp(orbit.dist - (d - pinch) * 0.03, 4, 16); pinch = d; drag && (drag.moved = true); return; }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) { orbit.theta -= (e.clientX - prev.x) * 0.006; orbit.phi = clamp(orbit.phi - (e.clientY - prev.y) * 0.005, 0.35, 1.35); }
  });
  el.addEventListener('pointerup', (e) => { ptrs.delete(e.pointerId); if (drag && !drag.moved && ptrs.size === 0) onWorldClick(e); if (!ptrs.size) drag = null; });
  el.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); drag = null; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = clamp(orbit.dist + e.deltaY * 0.01, 4, 16); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sitCtx) { closeSitDialog(false); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase(); keys.add(k);
    if (k === 'e' && S.entered) { if (T) leaveTable(); else nearestSeat(); }
    if (k === 'escape' && S.trip?.phase === 'choosing') cancelFridge();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  // 모바일 조이스틱
  const jb = $('#joy'), knob = $('#joy i');
  const touch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
  document.body.dataset.device = touch ? 'touch' : 'desktop';
  jb.hidden = !touch;
  let jid = null;
  const setJoy = (e) => { const r = jb.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const m = Math.hypot(dx, dy), max = 40; if (m > max) { dx = dx / m * max; dy = dy / m * max; } knob.style.transform = `translate(${dx}px,${dy}px)`; joy = { x: dx / max, y: dy / max }; };
  jb.addEventListener('pointerdown', (e) => { jid = e.pointerId; jb.setPointerCapture(jid); setJoy(e); e.stopPropagation(); });
  jb.addEventListener('pointermove', (e) => { if (e.pointerId === jid) setJoy(e); });
  const endJoy = (e) => { if (e.pointerId !== jid) return; jid = null; joy = { x: 0, y: 0 }; knob.style.transform = ''; };
  jb.addEventListener('pointerup', endJoy); jb.addEventListener('pointercancel', endJoy);
}
function nearestSeat() {
  let best = null, bd = 1.8;
  for (const t of TABLE_DEFS) t.seats.forEach((s, i) => { const d = Math.hypot(S.pos.x - s.x, S.pos.z - s.z); if (d < bd) { bd = d; best = [t.id, i]; } });
  if (best) requestSit(best[0], best[1]); else toast('의자 가까이에서 E를 누르거나 의자를 직접 클릭하세요.');
}
function collide(p) {
  const pad = 0.38;
  const boxes = [...TABLE_DEFS.map((t) => ({ x: t.x, z: t.z, hw: t.hw, hd: t.hd })), COUNTER, FRIDGE_POS];
  for (const b of boxes) {
    const dx = p.x - b.x, dz = p.z - b.z, ox = b.hw + pad - Math.abs(dx), oz = b.hd + pad - Math.abs(dz);
    if (ox > 0 && oz > 0) { if (ox < oz) p.x += Math.sign(dx || 1) * ox; else p.z += Math.sign(dz || 1) * oz; }
  }
  p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1); p.z = clamp(p.z, BOUNDS.z0, BOUNDS.z1);
}
function stepMove(dt) {
  if (S.seated) return;
  let vx = 0, vz = 0;
  const locked = !!S.trip; // 냉장고 왕복 중엔 키보드·클릭 이동을 받지 않는다
  const f = locked ? 0 : (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y;
  const r = locked ? 0 : (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x;
  const pathing = S.path.length > 0;
  if (pathing) {
    const w = S.path[0], dx = w.x - S.pos.x, dz = w.z - S.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) { S.path.shift(); if (!S.path.length) onPathEnd(); } else { vx = dx / d; vz = dz / d; }
  } else if (S.sitTarget) {
    const dx = S.sitTarget.x - S.pos.x, dz = S.sitTarget.z - S.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { S.pos.set(S.sitTarget.x, 0, S.sitTarget.z); S.rot = S.sitTarget.yaw; S.seated = true; trackLobby(true); onSeated(); return; }
    vx = dx / d; vz = dz / d;
  } else if (f || r) {
    const sx = Math.sin(orbit.theta), cz = Math.cos(orbit.theta);
    vx = -sx * f + cz * r; vz = -cz * f - sx * r; S.target = null;
  } else if (S.target && !locked) {
    const dx = S.target.x - S.pos.x, dz = S.target.z - S.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.1) S.target = null; else { vx = dx / d; vz = dz / d; }
  }
  const m = Math.hypot(vx, vz);
  if (m > 0) {
    const sp = (lvl() >= 3 ? 2.4 : 3.4) * dt;
    S.pos.x += (vx / m) * sp; S.pos.z += (vz / m) * sp;
    if (!S.sitTarget || pathing) collide(S.pos);
    S.rot = Math.atan2(vx, vz);
  }
}

/* ================================================================ 렌더 루프 */
let lastT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016); lastT = ts;
  const t = ts / 1000;
  if (S.entered) stepMove(dt);
  // 내 아바타
  if (myAvatar) {
    myAvatar.position.set(S.pos.x, 0, S.pos.z); myAvatar.rotation.y = S.rot;
    poseAvatar(myAvatar, { seated: S.seated, level: lvl(), t, rid: 0 });
  }
  // 카메라 따라가기
  camTarget.lerp(new THREE.Vector3(S.pos.x, 1.0, S.pos.z), 0.12);
  camera.position.set(camTarget.x + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta), camTarget.y + orbit.dist * Math.cos(orbit.phi), camTarget.z + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta));
  camera.lookAt(camTarget);
  for (const w of wallSides) {
    const c = camera.position, hw = ROOM.w / 2, hd = ROOM.d / 2;
    const out = (w.side === 'n' && c.z < -hd) || (w.side === 's' && c.z > hd) || (w.side === 'e' && c.x > hw) || (w.side === 'w' && c.x < -hw);
    w.mat.opacity += ((out ? 0.1 : 1) - w.mat.opacity) * 0.2;
  }
  tableLights.forEach((l, i) => { l.intensity = 14 + Math.sin(t * 3 + i) * 0.4; });
  // 다른 사람
  for (const [id, r] of Remote) {
    const g = r.g;
    g.position.x += (r.t.x - g.position.x) * 0.3; g.position.z += (r.t.z - g.position.z) * 0.3;
    let da = (r.t.rot - g.rotation.y) % (Math.PI * 2); if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; g.rotation.y += da * 0.3;
    const mate = T && T.members.get(id);
    poseAvatar(g, { seated: !!r.m.sit, level: mate ? clamp(Math.round(mate.drunk || 0), 0, 5) : 0, t, rid: id.length });
    const l = labelFor(`r:${id}`, mate ? `${r.m.name} 🍺${clamp(Math.round(mate.drunk || 0), 0, 5)}${mate.wc ? ' 🚽' : ''}` : r.m.name, mate ? 'mate' : '');
    project(l.el, g.position.x, 2.0, g.position.z);
    if (!l.bub.hidden) { if (performance.now() > l.until) l.bub.hidden = true; else project(l.bub, g.position.x, 2.45, g.position.z); }
  }
  if (S.entered) {
    const l = labelFor('me', `${S.me.name} (나)`, 'me'); project(l.el, S.pos.x, 2.0, S.pos.z);
    if (!l.bub.hidden) { if (performance.now() > l.until) l.bub.hidden = true; else project(l.bub, S.pos.x, 2.45, S.pos.z); }
  }
  if (ownerAvatar) {
    const l = labelFor('owner', '사장님', ''); project(l.el, OWNER_POS.x, 2.0, OWNER_POS.z);
    const ob = $('#owner-bubble'); if (!ob.hidden) project(ob, OWNER_POS.x, 2.45, OWNER_POS.z);
    const fl = labelFor('fridge', '🧊 술 냉장고', ''); project(fl.el, FRIDGE_POS.x + FRIDGE_POS.hw, 2.25, FRIDGE_POS.z);
    const al = labelFor('aircon', '에어컨', ''); project(al.el, AIRCON.x, AIRCON.y + 0.3, AIRCON.z);
    for (const t of TABLE_DEFS) { const l = labelFor(`t${t.id}`, tableLabel(t.id), 'tlab'); project(l.el, t.x, 1.15, t.z); }
  }
  stepStreet(t);
  stepParticles(dt);
  if (S.entered && ts - frame.lastTrack > TRACK_MS) { frame.lastTrack = ts; trackLobby(false); }
  renderer.render(scene, camera);
}
frame.lastTrack = 0;
function resize() { const w = innerWidth, hh = innerHeight; renderer.setSize(w, hh); camera.aspect = w / hh; camera.updateProjectionMatrix(); }

/* ================================================================ 검증 훅 (채널 분리 · 코드 로직 자체 점검) */
async function selfTest() {
  const out = [];
  const ok = (name, cond) => out.push({ name, pass: !!cond });
  const names = Array.from({ length: TABLES }, (_, i) => CH.table(i + 1));
  ok('테이블 채널명 6개 모두 서로 다름', new Set(names).size === TABLES);
  ok('테이블 채널명이 amado-table-<id> 형식', names.every((n, i) => n === `amado-table-${i + 1}`));
  ok('문 채널과 테이블 채널이 겹치지 않음', Array.from({ length: TABLES }, (_, i) => CH.door(i + 1)).every((d) => !names.includes(d)));
  let threw = 0; for (const bad of [0, 7, 1.5, '1', null]) { try { CH.table(bad); } catch { threw++; } }
  ok('잘못된 테이블 번호는 채널명 생성 거부', threw === 5);
  ok('로비·디렉토리 채널명이 amado- 접두사이고 서로·테이블 채널과 다름', CH.lobby === 'amado-lobby' && CH.dir === 'amado-tables' && new Set([CH.lobby, CH.dir, ...names]).size === TABLES + 2);
  ok('로비 presence 허용 키에 취기·허기·코드·채팅 없음', !LOBBY_KEYS.some((k) => ['drunk', 'hunger', 'code', 'chat', 'cart', 'why'].includes(k)));
  ok('비공개·문·디렉토리 이벤트 집합이 서로 겹치지 않음', ![...PRIVATE_EVENTS, ...DOOR_EVENTS].some((e) => DIR_EVENTS.includes(e)) && !PRIVATE_EVENTS.some((e) => DOOR_EVENTS.includes(e)));
  ok('serve·eat·drink 가 비공개 이벤트에 있음', ['serve', 'eat', 'drink'].every((e) => PRIVATE_EVENTS.includes(e)));
  const a = await proofOf(1, '1234', 'n1'), b = await proofOf(1, '1234', 'n1'), c = await proofOf(1, '1235', 'n1'), d = await proofOf(2, '1234', 'n1'), e = await proofOf(1, '1234', 'n2');
  ok('노크 증명: 같은 입력은 같고, 코드·테이블·nonce가 다르면 달라짐', a === b && a !== c && a !== d && a !== e);
  ok('노크 증명에 평문 코드가 들어있지 않음', !a.includes('1234'));
  let blocked = false; try { tsendCheck('not-private'); } catch { blocked = true; }
  ok('비공개 목록에 없는 이벤트는 전송 거부', blocked);
  let dirBlocked = false; try { dirSend('chat', {}); } catch { dirBlocked = true; }
  ok('디렉토리 채널로 채팅 등 비공개 이벤트 전송 거부', dirBlocked);
  // 디렉토리 점유 판단 (로비 presence 와 무관해야 한다)
  const savedDir = new Map(Dir), savedLobby = lobbyMembers;
  try {
    Dir.clear(); lobbyMembers = new Map();
    ok('디렉토리가 비어 있으면 테이블은 비어 있음', occupants(3).length === 0);
    onDirState({ tid: 3, count: 2, seats: [0, 1], locked: true });
    ok('디렉토리 항목만으로 점유(2명)·자리(0,1) 인식 — presence 없이도', occupants(3).length === 2 && seatTaken(3, 0) && seatTaken(3, 1) && !seatTaken(3, 2));
    onDirState({ tid: 3, count: 0, seats: [] });
    ok('count 0 broadcast 로 테이블이 비어짐', occupants(3).length === 0);
    onDirState({ tid: 9, count: 1, seats: [0] }); onDirState({ tid: 'x', count: 1 });
    ok('범위 밖·잘못된 tid 는 무시', Dir.size === 0);
    Dir.set(4, { count: 1, seats: [2], ts: Date.now() - DIR_TTL_MS - 1 });
    ok('heartbeat 가 끊긴 항목은 만료', occupants(4).length === 0 && !Dir.has(4));
    lobbyMembers = new Map([['x', { table: 5, seat: 1 }]]);
    ok('presence 만 있어도 보조로 점유 인식', occupants(5).length === 1 && seatTaken(5, 1));
  } finally { Dir.clear(); for (const [k, v] of savedDir) Dir.set(k, v); lobbyMembers = savedLobby; }
  // 서빙·먹기/마시기·허기 규칙
  ok('음식 1개 = 4입, 병 술 = 4잔, 잔 술 = 1잔', bitesOf('food', 'dish') === 4 && bitesOf('drink', 'bottle') === 4 && bitesOf('drink', 'glass') === 1);
  ok('마시기: 무알코올 +0, 술 +1, 빈속(허기 4 이상) +1.5', drinkDelta(false, 5) === 0 && drinkDelta(true, 3) === 1 && drinkDelta(true, 4) === 1.5 && drinkDelta(true, 5) === 1.5);
  ok('술 냉장고 13종이 모두 메뉴 항목과 연결됨', FRIDGE.length === 13 && FRIDGE.every((f) => itemById(f.menuId)));
  ok('병 술 6종·잔 술 7종', FRIDGE.filter((f) => f.unit === 'bottle').length === 6 && FRIDGE.filter((f) => f.unit === 'glass').length === 7);
  ok('인사 선택지 3개와 답인사', GREETING.options.length === 3 && GREETING.options.every((o) => o.text && o.reply));
  ok('사장님 대사 5종', ['enter', 'order', 'service', 'care', 'closing'].every((k) => OWNER_LINES[k]));
  // 룸 레이아웃: 세로형, 테이블·좌석이 경계 안, 겹침 없음
  const inB = (x, z) => x >= BOUNDS.x0 && x <= BOUNDS.x1 && z >= BOUNDS.z0 - 0.01 && z <= BOUNDS.z1;
  ok('룸이 세로형(z 길이 > x 폭)이고 테이블 6개', ROOM.d > ROOM.w && TABLE_DEFS.length === 6);
  ok('테이블이 90도 회전: 긴 방향이 z축(hd 0.8 > hw 0.5)', TABLE_DEFS.every((t) => t.hw === 0.5 && t.hd === 0.8));
  ok('좌석 오프셋 (±0.95, ±0.42): 테이블 양옆(x축 방향) 좌석 4석', TABLE_DEFS.every((t) => t.seats.length === 4 && t.seats.every((s) => Math.abs(Math.abs(s.x - t.x) - 0.95) < 1e-9 && Math.abs(Math.abs(s.z - t.z) - 0.42) < 1e-9)));
  ok('좌석이 테이블 쪽(±x)을 정면으로 바라봄(yaw ±π/2)', TABLE_DEFS.every((t) => t.seats.every((s, i) => { const y = seatTarget(t.id, i).yaw; return Math.abs(Math.abs(y) - Math.PI / 2) < 1e-9 && Math.sign(y) === Math.sign(t.x - s.x); })));
  ok('모든 테이블 좌석이 이동 경계 안', TABLE_DEFS.every((t) => t.seats.every((s) => s.x >= BOUNDS.x0 && s.x <= BOUNDS.x1 && s.z >= BOUNDS.z0 && s.z <= BOUNDS.z1)));
  const ov = (a1, b1) => Math.abs(a1.x - b1.x) < a1.hw + b1.hw && Math.abs(a1.z - b1.z) < a1.hd + b1.hd;
  ok('테이블끼리·카운터·냉장고와 겹치지 않음', TABLE_DEFS.every((t, i) => !ov(t, COUNTER) && !ov(t, FRIDGE_POS) && TABLE_DEFS.every((u, j) => i === j || !ov(t, u))));
  ok('테이블이 벽 안쪽에 있음(방 경계)', TABLE_DEFS.every((t) => Math.abs(t.x) + t.hw < ROOM.w / 2 && Math.abs(t.z) + t.hd < ROOM.d / 2));
  ok('좌석이 다른 테이블·카운터·냉장고 영역과 겹치지 않음', TABLE_DEFS.every((t) => t.seats.every((s) => ![...TABLE_DEFS.filter((u) => u !== t), COUNTER, FRIDGE_POS].some((bx) => Math.abs(s.x - bx.x) < bx.hw + 0.23 && Math.abs(s.z - bx.z) < bx.hd + 0.23))));
  ok('가운데 통로 비어 있음: 테이블 사이 2.4m, 좌석 가장자리 사이 1m 이상, 통로(x≈0)에 장애물 없음', 2 * Math.min(...TABLE_DEFS.filter((t) => t.x > 0).map((t) => t.x - t.hw)) >= 1.5 && 2 * Math.min(...TABLE_DEFS.flatMap((t) => t.seats).map((s) => Math.abs(s.x) - 0.23)) >= 1.0 && ![...TABLE_DEFS, COUNTER].some((bx) => bx.z - bx.hd > BOUNDS.z0 + 1 && Math.abs(bx.x) - bx.hw < 0.5));
  ok('카운터는 z 음수 끝, 입구 스폰은 z 양수 끝', COUNTER.z < -4 && SPAWN.z > 4);
  // 사장님은 주문대 안(카운터 뒤, 카운터 폭 안, 뒷벽 앞)
  ok('사장님이 주문대 안(카운터 뒤)에 있음', Math.abs(OWNER_POS.x - COUNTER.x) < COUNTER.hw && OWNER_POS.z < COUNTER.z - COUNTER.hd + 0.001 && OWNER_POS.z > -ROOM.d / 2 + 0.2 && !ov({ x: OWNER_POS.x, z: OWNER_POS.z, hw: 0.2, hd: 0.2 }, FRIDGE_POS));
  // 위치 정정(B)
  ok('냉장고: 서쪽(왼쪽) 벽에 붙음, 먼 쪽 끝·카운터 옆, 카운터와 안 겹침, 문이 방 안쪽(+x)', Math.abs(FRIDGE_POS.x - FRIDGE_POS.hw + ROOM.w / 2) < 1e-9 && FRIDGE_POS.z < -5 && FRIDGE_POS.z - FRIDGE_POS.hd >= -ROOM.d / 2 - 1e-9 && FRIDGE_POS.x + FRIDGE_POS.hw < COUNTER.x - COUNTER.hw && FRIDGE_STAND.x > FRIDGE_POS.x + FRIDGE_POS.hw && Math.sin(FRIDGE_ROT) < 0);
  ok('화장실 문: 먼 쪽 끝, 카운터 오른쪽(x 양수) 벽, 왼쪽 벽 위치(x<0)는 없음', WC_DOOR.x > COUNTER.x + COUNTER.hw && WC_DOOR.z < -5 && Math.abs(WC_DOOR.x - ROOM.w / 2) < 0.2);
  ok('입구(통유리 접이문): 가까운 쪽(남쪽) 벽 왼쪽 — 문 범위 전체가 x<0, 벽 안', ENTRANCE.x0 >= -ROOM.w / 2 && ENTRANCE.x1 < 0 && ENTRANCE.x1 - ENTRANCE.x0 >= 2);
  ok('스폰: 입구 앞(하단 왼쪽)·경계 안·카운터를 바라봄', SPAWN.x >= ENTRANCE.x0 && SPAWN.x <= ENTRANCE.x1 && SPAWN.z > 4 && inB(SPAWN.x, SPAWN.z) && Math.sin(SPAWN_ROT) * (COUNTER.x - SPAWN.x) + Math.cos(SPAWN_ROT) * (COUNTER.z - SPAWN.z) > 0.99 * Math.hypot(COUNTER.x - SPAWN.x, COUNTER.z - SPAWN.z));
  ok('에어컨: 하단 오른쪽 벽(x 양수·z 양수), 충돌 없음', AIRCON.x > 0 && AIRCON.z > 3 && AIRCON.collide === false && AIRCON.x + AIRCON.d / 2 <= ROOM.w / 2 + 1e-9 && AIRCON.z + AIRCON.w / 2 < ROOM.d / 2);
  ok('스폰·냉장고 앞자리가 이동 경계 안', inB(SPAWN.x, SPAWN.z) && inB(FRIDGE_STAND.x, FRIDGE_STAND.z));
  const lane = FRIDGE_LANE_Z, pad = 0.38;
  ok('냉장고 통행로(z)가 맨 앞 줄 테이블·카운터 충돌 영역 사이에 있음', lane > COUNTER.z + COUNTER.hd + pad && lane < Math.min(...TABLE_DEFS.map((t) => t.z - t.hd)) - pad);
  // 냉장고 왕복 경로가 24개 좌석 모두에서 테이블·카운터·냉장고 충돌 영역을 지나지 않는지 (collide 와 같은 판정)
  const hitsAny = (x, z) => [...TABLE_DEFS, COUNTER, FRIDGE_POS].some((bx) => bx.hw + pad - Math.abs(x - bx.x) > 0 && bx.hd + pad - Math.abs(z - bx.z) > 0);
  const segClear = (p0, p1) => { const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 0.05); for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; if (hitsAny(p0.x + (p1.x - p0.x) * t, p0.z + (p1.z - p0.z) * t)) return false; } return true; };
  let routesOk = true, nRoutes = 0;
  for (const t of TABLE_DEFS) for (const sp of t.seats) {
    nRoutes++;
    const go = fridgeRoute(sp), back = fridgeRoute(sp).reverse();
    for (const pts of [go, back]) for (let i = 0; i < pts.length - 1; i++) if (!segClear(pts[i], pts[i + 1])) routesOk = false;
  }
  ok('냉장고 왕복 경로: 24개 좌석 전부(갈 때·올 때) 충돌 영역을 지나지 않음', routesOk && nRoutes === 24);
  // 통유리 밖 내리막길 + 학생
  const fullBox = [...TABLE_DEFS, COUNTER, FRIDGE_POS];
  ok('길·학생은 건물 밖(남쪽 벽 바깥)에 있고 이동 경계·충돌 영역과 겹치지 않음', STREET.z0 > ROOM.d / 2 + 0.05 && STUDENTS.every((st) => st.lane > STREET.z0 && st.lane < STREET.z0 + STREET.sidewalkD + STREET.roadD) && STUDENTS.every((st) => st.lane > BOUNDS.z1 && !fullBox.some((bx) => Math.abs(bx.z - st.lane) < bx.hd)));
  let xsOk = true, descend = true, loops = 0;
  for (const st of STUDENTS) { let prev = studentX(st, 0); for (let tt = 0.5; tt < 600; tt += 0.5) { const x = studentX(st, tt); if (x < STREET.x0 || x > STREET.x1) xsOk = false; if (x < prev) loops++; else if (x - prev > 2) descend = false; prev = x; } }
  ok('학생 3명: 걷는 x 범위가 길 안, 아래쪽(+x)으로 천천히 이동(≤0.31m/0.5s 이하)하고 끝에서 위쪽으로 되돌아오는 루프', STUDENTS.length === 3 && xsOk && descend && loops >= 3 && STUDENTS.every((st) => st.speed > 0 && st.speed < 1));
  ok('내리막: 기울기 양수(+x 쪽이 낮음), 입구 앞 길이 학생 이동 범위를 덮음', STREET.slope > 0 && STREET.slope < 0.2 && STREET.x0 < ENTRANCE.x0 - 4 && STREET.x1 > ROOM.w / 2 + 4);
  // 앉기 다이얼로그(로비 없음)
  ok('앉기 다이얼로그가 있고 테이블 고르기 카드(구 로비 UI)는 없음', !!document.getElementById('sit-dialog') && !document.querySelector('section[aria-label="테이블 고르기"]'));
  return out;
}
function tsendCheck(ev) { if (!PRIVATE_EVENTS.includes(ev)) throw new Error('blocked'); }

/* ================================================================ 시작 */
async function boot() {
  S.menu = await fetch('./menu.json').then((r) => r.json());
  const prof = loadProfile(); if (prof) { $('#in-name').value = prof.name || ''; $('#in-why').value = prof.why || ''; }
  renderMenu(); renderInfo(); renderCart(); renderTabletop(); applyHungerFx(); setSide('hidden');
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    $('#scene').append(renderer.domElement);
    buildRoom();
    buildActors();
    resize(); addEventListener('resize', resize);
    bindInput();
    requestAnimationFrame(frame);
  } catch (e) { console.error(e); toast('3D를 시작하지 못했어요(WebGL). 패널 기능은 그대로 쓸 수 있어요.', 6000); }
  initSupabase();
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
  $('#btn-side').addEventListener('click', () => { if (!T) { toast('테이블에 앉으면 패널을 열 수 있어요.'); return; } setSide(S.side === 'open' ? 'min' : 'open'); });
  $('#btn-min').addEventListener('click', () => setSide('min'));
  $('#side-pill').addEventListener('click', () => setSide('open'));
  $('#sit-form').addEventListener('submit', (e) => { e.preventDefault(); confirmSit(); });
  $('#sit-close').addEventListener('click', () => closeSitDialog(false));
  $('#btn-sit').addEventListener('click', () => { if (T) leaveTable(); });
  $('#btn-cheers').addEventListener('click', cheers);
  $('#btn-water').addEventListener('click', drinkWater);
  $('#btn-wc').addEventListener('click', goToilet);
  $('#btn-cam').addEventListener('click', () => toggleMedia('cam'));
  $('#btn-mic').addEventListener('click', () => toggleMedia('mic'));
  $('#btn-grid').addEventListener('click', toggleGrid);
  $('#btn-treat-all').addEventListener('click', treatAll);
  $('#fr-close').addEventListener('click', cancelFridge);
  $('#gr-x').addEventListener('click', hideGreeting);
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-input'); sendChat(i.value); i.value = ''; });
  $('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); enter(); });
  setInterval(() => { tickCooldown(); tickServe(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.entered) { trackLobby(true); announceTable(true); } });
  addEventListener('beforeunload', () => {
    clearInterval(S.hungerTimer);
    try { if (T?.synced && T.members.size <= 1) dirSend('tables-state', { tid: T.id, count: 0, seats: [], locked: false, from: S.me.id }); closeSession(); Net.lobby?.untrack?.(); } catch { /* 무시 */ }
  });
  window.__amado = { S, CH, selfTest, applyHungerFx, applyDrunkFx, get T() { return T; }, Net, Dir, requestSit, addDrunk, addHunger, order, itemById, leaveTable, sendChat, TABLE_DEFS, lobbyMembers: () => lobbyMembers, enter, openSession, knock, occupants, onDirState, useFridge, deliverDrink, eatServed, drinkServed,
    FRIDGE, OWNER_LINES, GREETING, HUNGER_TICK_MS, BOUNDS, COUNTER, FRIDGE_POS, props: () => PROPS, stepMove, tickServe, ownerClick, AIRCON, SPAWN_ROT, WC_DOOR, ENTRANCE, STREET, STUDENTS, studentX, OWNER_POS, SPAWN, ROOM, tableLocked, fridgeRoute, FRIDGE_STAND, FRIDGE_LANE_Z, FRIDGE_ROT, confirmSit, closeSitDialog };
  document.body.dataset.ready = '1';
}
function enter() {
  const name = $('#in-name').value.trim().slice(0, 12) || randomNick();
  S.me.name = name; S.me.why = $('#in-why').value.trim().slice(0, 60);
  S.me.color = COLORS[Math.floor(Math.random() * COLORS.length)];
  saveProfile();
  if (myAvatar) { scene.remove(myAvatar); myAvatar = makeAvatar(S.me.color); scene.add(myAvatar); }
  S.entered = true; S.pos.set(SPAWN.x, 0, SPAWN.z); S.rot = SPAWN_ROT; S.target = null;
  $('#entry').hidden = true; $('#hud-drunk').hidden = false; $('#hud-actions').hidden = false; $('#btn-sit').hidden = true;
  // 허기: 입장 시 2에서 시작, 3분마다 +1 (최대 5). 페이지를 떠나면 beforeunload 에서 정리.
  S.hunger = HUNGER_START; S.hungerAlert = 0; clearInterval(S.hungerTimer);
  S.hungerTimer = setInterval(() => addHunger(1), HUNGER_TICK_MS);
  applyDrunkFx(); applyHungerFx(); updateMediaButtons();
  joinLobby(); if (!Net.sb) setOnline(false);
  // 사장님이 먼저 맞이하고, 1.5초 뒤 인사 선택지가 한 번 뜬다
  setTimeout(() => ownerSay(OWNER_LINES.enter, 8000), 700);
  setTimeout(showGreeting, 700 + 1500);
}
boot();
