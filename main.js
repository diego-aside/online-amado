// 온라인 아마도 월드 v1 — main.js
// 정적 사이트. Three.js r170(importmap) + Supabase JS v2(CDN, window.supabase) + PeerJS(CDN, window.Peer).
// 구조: 설정 → 채널/프라이버시 → 상태 → 유틸 → 3D → 네트워크(로비/테이블/문) → 취기 → 주문 → 시나리오 → 화상 → UI → 루프
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

/* ================================================================ 채널명 · 프라이버시 규칙 (코드로 검증) */
function checkTid(id) {
  if (!Number.isInteger(id) || id < 1 || id > TABLES) throw new Error(`잘못된 테이블 번호: ${id}`);
  return id;
}
const CH = {
  lobby: 'amado-lobby',                              // 위치(아바타)만. 채팅·주문·취기·시나리오는 절대 안 싣는다.
  table: (id) => `amado-table-${checkTid(id)}`,      // 채팅·주문·취기·시나리오·건배·무지개 토
  door: (id) => `amado-door-${checkTid(id)}`,        // 입장 코드 확인 전용(노크/승인)
};
// 테이블 채널에서만 오가는 이벤트. 로비·문 채널로는 이 이벤트를 보낼 수 없다(tsend만 보냄).
const PRIVATE_EVENTS = ['chat', 'order', 'cancel', 'treat', 'cheers', 'scenario', 'sevent', 'rainbow', 'care', 'sync-req', 'sync', 'volunteer', 'graffiti'];
const DOOR_EVENTS = ['knock', 'grant'];
// 로비 presence 에 허용되는 키 (위치·표시용만). 취기·코드·채팅은 여기 없음.
const LOBBY_KEYS = ['id', 'name', 'color', 'x', 'z', 'rot', 'table', 'seat', 'sit'];

const LEVELS = ['아직 멀쩡해요', '기분 좋아', '취기', '취기가 올라요', '만취 직전', '🌈 무지개 토'];
const FACES = ['🙂', '😊', '😄', '🥴', '🤢', '🌈'];

/* ================================================================ 상태 */
const S = {
  me: { id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: '', why: '', color: 0xffc861 },
  entered: false,
  pos: new THREE.Vector3(0, 0, 3.6), rot: Math.PI, target: null, sitTarget: null, seated: false,
  table: null, seat: null,
  drunk: 0, rainbowUntil: 0, wc: false,
  cam: false, mic: false, peer: null, peerId: null,
  menu: null, scenarios: null, activeCat: 'main',
  online: false,
  eaten: new Map(),
};
let T = null; // 현재 앉은 테이블 세션 (없으면 null)
const Net = { sb: null, lobby: null, ready: false };
const Remote = new Map(); // 로비 presence → 다른 사람 아바타
let lobbyMembers = new Map();

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

/* ================================================================ 방 레이아웃 (순수 데이터) */
const ROOM = { w: 14, d: 10, h: 3.2 };
const TABLE_DEFS = [];
{
  const cols = [-3.6, 0.4, 4.4], rows = [-0.5, 2.5];
  let n = 1;
  for (const rz of rows) for (const cx of cols) {
    const seats = [];
    [[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]].forEach(([dx, dz]) => {
      seats.push({ x: cx + dx, z: rz + dz });
    });
    TABLE_DEFS.push({ id: n++, x: cx, z: rz, hw: 0.8, hd: 0.5, seats });
  }
}
const COUNTER = { x: 0, z: -3.8, hw: 3, hd: 0.4 };
const WC_DOOR = { x: 6.6, z: -2.2 };
const BOUNDS = { x0: -6.6, x1: 6.6, z0: -3.2, z1: 4.6 };
const OWNER_POS = new THREE.Vector3(0, 0, -4.45);

/* ================================================================ 3D */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16231f);
scene.fog = new THREE.Fog(0x16231f, 18, 40);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
let renderer = null;
const orbit = { theta: 0.0, phi: 1.0, dist: 10.5 };
const camTarget = new THREE.Vector3(0, 1, 3);
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
  [[-3.6, -1], [0.4, 1.5], [4.4, 2.5]].forEach(([x, z]) => {
    const l = new THREE.PointLight(0xffc861, 14, 9, 1.6); l.position.set(x, 2.6, z); scene.add(l); tableLights.push(l);
  });

  // 바닥 (회색 타일 느낌, 도형+캔버스 텍스처만)
  const floorTex = canvasTex(256, 256, (g, w, hh) => {
    g.fillStyle = '#6b6f6e'; g.fillRect(0, 0, w, hh);
    g.strokeStyle = '#555a59'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, hh); g.stroke(); g.beginPath(); g.moveTo(0, i * hh / 4); g.lineTo(w, i * hh / 4); g.stroke(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(14, 10);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.userData.floor = true; scene.add(floor); pickables.push(floor);

  // 벽 (카메라가 벽 바깥에 있으면 투명)
  const wallMat = (side) => { const m = mats.wall(); wallSides.push({ mat: m, side }); return m; };
  const hw = ROOM.w / 2, hd = ROOM.d / 2, H = ROOM.h;
  box(ROOM.w, H, 0.2, wallMat('n'), 0, H / 2, -hd - 0.1);
  box(0.2, H, ROOM.d, wallMat('e'), hw + 0.1, H / 2, 0);
  box(0.2, H, ROOM.d, wallMat('w'), -hw - 0.1, H / 2, 0);
  box(5, H, 0.2, wallMat('s'), -4.5, H / 2, hd + 0.1);
  box(5, H, 0.2, wallMat('s'), 4.5, H / 2, hd + 0.1);
  box(4, 0.7, 0.2, wallMat('s'), 0, H - 0.35, hd + 0.1);
  // 현관 유리 접이문
  const glass = new THREE.MeshStandardMaterial({ color: 0x9ec9c0, transparent: true, opacity: 0.22, roughness: 0.1 });
  for (let i = 0; i < 4; i++) {
    box(0.98, H - 0.7, 0.05, glass, -1.5 + i, (H - 0.7) / 2, hd);
    box(0.04, H - 0.7, 0.08, std(0x1a1a1a), -2 + i, (H - 0.7) / 2, hd);
  }
  box(4, 0.05, 0.1, std(0x1a1a1a), 0, 0.03, hd);

  // 스트링 조명 (도형만)
  [[-1.6, -6.8, 6.8], [1.6, -6.8, 6.8], [4.2, -6.8, 6.8]].forEach(([z, x0, x1]) => {
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = 2.95 - Math.sin(t * Math.PI) * 0.35;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bulb); b.position.set(x, y, z); scene.add(b);
    }
    box(x1 - x0, 0.01, 0.01, std(0x222222), 0, 2.85, z);
  });

  // 카운터 + POS + 술병 선반 + 맥주 상자
  box(COUNTER.hw * 2, 1.0, COUNTER.hd * 2, mats.wood, COUNTER.x, 0.5, COUNTER.z);
  box(COUNTER.hw * 2 + 0.1, 0.06, COUNTER.hd * 2 + 0.1, mats.woodLight, COUNTER.x, 1.03, COUNTER.z);
  box(0.4, 0.3, 0.3, std(0x222222), 1.8, 1.2, COUNTER.z - 0.05);
  [1.2, 1.9].forEach((y) => box(6, 0.05, 0.32, mats.woodLight, 0, y + 0.3, -4.82));
  const bcols = [0x2d6a3e, 0x7a4a1e, 0x9b2d2d, 0x335c8a, 0xcfc9b3, 0x3f7a58, 0x6b3f7a];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 20; i++) {
    const c = bcols[(i * 3 + r) % bcols.length], hgt = 0.32 + ((i * 7 + r) % 3) * 0.05;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, hgt, 8), std(c, 0.3)); b.position.set(-2.8 + i * 0.3, (r ? 1.9 : 1.2) + 0.33 + hgt / 2, -4.82); scene.add(b);
  }
  const brandTex = (txt, col, bg) => canvasTex(128, 64, (g, w, hh) => { g.fillStyle = bg; g.fillRect(0, 0, w, hh); g.fillStyle = col; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText(txt, w / 2, 42); });
  [['CASS', '#fff', '#c1272d'], ['TERRA', '#fff', '#1c8a4e']].forEach(([t, c, bg], k) => {
    for (let i = 0; i < 3; i++) {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ map: brandTex(t, c, bg) }));
      bx.position.set(4.6 + k * 0.6, 0.15 + i * 0.3, -4.5); scene.add(bx);
    }
  });

  // 벽 장식: 간판·액자·체크 주머니·안내문
  const sign = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({
    map: canvasTex(256, 256, (g, w, hh) => { g.fillStyle = '#1f6a4f'; g.fillRect(0, 0, w, hh); g.fillStyle = '#fff'; g.font = `84px ${SCRIPT_FONT}`; g.textAlign = 'center'; g.fillText('Amado', w / 2, hh / 2 + 26); }),
  }));
  sign.position.set(-3.6, 2.3, 4.88); sign.rotation.y = Math.PI; scene.add(sign);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshBasicMaterial({
    transparent: true, map: canvasTex(512, 160, (g, w, hh) => { g.fillStyle = '#fff'; g.font = `120px ${SCRIPT_FONT}`; g.textAlign = 'center'; g.fillText('Amado', w / 2, hh / 2 + 40); }),
  }));
  banner.position.set(0, 2.5, -4.88); scene.add(banner);
  const art = [['#e0735a', '#f4d35e'], ['#5aa6e0', '#f6efe2'], ['#c9a227', '#3a2a1e']];
  art.forEach(([a, b], i) => {
    const fr = box(0.04, 0.6, 0.5, mats.wood, -6.92, 1.9, -1.6 + i * 1.0);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.54), new THREE.MeshBasicMaterial({
      map: canvasTex(64, 80, (g, w, hh) => { g.fillStyle = b; g.fillRect(0, 0, w, hh); g.fillStyle = a; g.beginPath(); g.arc(w / 2, hh / 2, 22, 0, 7); g.fill(); }),
    }));
    pic.position.set(-6.895, 1.9, -1.6 + i * 1.0); pic.rotation.y = Math.PI / 2; scene.add(pic); void fr;
  });
  const gingham = canvasTex(64, 64, (g, w, hh) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.fillStyle = '#d83a3a88';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 16 + 0, 0, 8, hh); g.fillRect(0, i * 16, w, 8); }
  });
  [1.2, 1.9].forEach((z) => {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), new THREE.MeshStandardMaterial({ map: gingham }));
    bag.position.set(-6.9, 1.4, z); scene.add(bag);
    box(0.05, 0.05, 0.05, mats.wood, -6.95, 1.65, z);
  });
  const note = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({
    map: canvasTex(512, 256, (g, w, hh) => { g.fillStyle = '#fffbe0'; g.fillRect(0, 0, w, hh); g.fillStyle = '#3a2a1e'; g.font = `32px ${HAND_FONT}`; g.textAlign = 'center'; g.fillText('신분증 제시 … 불편하게 생각지 마세요', w / 2, 100); g.fillText('Why? 동안이니까~', w / 2, 170); }),
  }));
  note.position.set(6.88, 1.7, 1.5); note.rotation.y = -Math.PI / 2; scene.add(note);
  // 벽쪽 긴 원목 벤치
  box(0.5, 0.45, 5.5, mats.wood, -6.6, 0.23, 1.2); box(0.12, 0.5, 5.5, mats.wood, -6.88, 0.7, 1.2);
  // 화장실 문 (클릭하면 화장실 화면)
  const door = box(0.08, 2.0, 0.9, std(0x6a4a2a, 0.6), 6.95, 1.0, WC_DOOR.z);
  door.userData.wc = true; pickables.push(door);
  const wcSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({
    map: canvasTex(128, 64, (g, w, hh) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.fillStyle = '#222'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText('화장실', w / 2, 42); }),
  }));
  wcSign.position.set(6.89, 1.75, WC_DOOR.z); wcSign.rotation.y = -Math.PI / 2; scene.add(wcSign);

  // 테이블 6개 + 의자 24개
  const numTex = (n) => canvasTex(64, 64, (g, w, hh) => { g.fillStyle = '#5a4128'; g.fillRect(0, 0, w, hh); g.fillStyle = '#ffc861'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillText(String(n), w / 2, 46); });
  for (const t of TABLE_DEFS) {
    const top = box(t.hw * 2, 0.07, t.hd * 2, mats.wood, t.x, 0.8, t.z);
    top.userData.table = t.id; pickables.push(top);
    box(0.12, 0.76, 0.12, mats.wood, t.x, 0.38, t.z);
    box(0.7, 0.04, 0.5, std(0x222222), t.x, 0.02, t.z);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: numTex(t.id) }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(t.x - 0.55, 0.845, t.z + 0.28); scene.add(lab);
    t.seats.forEach((s, i) => {
      const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
      g.rotation.y = Math.atan2(t.x - s.x, t.z - s.z);
      box(0.46, 0.08, 0.46, mats.leather, 0, 0.45, 0, g);
      box(0.46, 0.5, 0.06, mats.leather, 0, 0.75, -0.22, g);
      [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(([lx, lz]) => box(0.04, 0.42, 0.04, std(0x333333), lx, 0.21, lz, g));
      g.traverse((o) => { if (o.isMesh) { o.userData.seat = { table: t.id, idx: i }; pickables.push(o); } });
      scene.add(g);
    });
  }
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

/* ================================================================ 네트워크: 로비 (위치만) */
function initSupabase() {
  try {
    if (!window.supabase?.createClient) throw new Error('supabase-js 로드 실패');
    Net.sb = window.supabase.createClient(MP_CONFIG.url, MP_CONFIG.anonKey, { realtime: { params: { eventsPerSecond: 20 } } });
  } catch (e) { console.warn('[amado] Supabase 사용 불가 → 1인 모드', e); Net.sb = null; }
}
function setOnline(on) {
  S.online = on;
  const b = $('#net-badge'); b.textContent = on ? '온라인 · 함께 있는 공간' : '1인 모드 (혼자 둘러보기·주문 연습)';
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
  lastLobby = s; Net.lobby.track(p);
}
function joinLobby() {
  if (!Net.sb) { setOnline(false); return; }
  const ch = Net.sb.channel(CH.lobby, { config: { presence: { key: S.me.id } } });
  ch.on('presence', { event: 'sync' }, () => onLobbySync(ch.presenceState()));
  ch.subscribe((st) => {
    if (st === 'SUBSCRIBED') { Net.ready = true; setOnline(true); trackLobby(true); }
    else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { Net.ready = false; setOnline(false); }
  });
  Net.lobby = ch;
  setTimeout(() => { if (!Net.ready) { setOnline(false); toast('실시간 연결에 실패했어요. 1인 모드로 둘러보세요.'); } }, 6000);
  setInterval(() => trackLobby(true), 15000); // 재접속 대비 재전송
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
  renderLobby();
}
function occupants(tid) {
  const list = [];
  for (const m of lobbyMembers.values()) if (m.table === tid) list.push(m);
  return list;
}
const seatTaken = (tid, idx) => occupants(tid).some((m) => m.seat === idx) || (S.table === tid && S.seat === idx);

/* ================================================================ 네트워크: 테이블 세션 */
function newSession(tid, code, creator, seat) {
  return { id: tid, code, creator, seat, joinedAt: Date.now(), members: new Map(), ch: null, door: null, subscribed: false,
    cart: [], scn: null, mood: 0, flags: {}, volunteer: null, graffiti: [], fails: new Map(), usedNonces: new Set(), left: false, chat: [] };
}
function trackTable() {
  if (!T) return;
  const p = tablePayload();
  T.members.set(S.me.id, p);
  if (T.ch && T.subscribed) T.ch.track(p);
  renderGrid();
}
function tablePayload() {
  return { id: S.me.id, name: S.me.name, why: S.me.why, color: S.me.color, seat: S.seat, drunk: S.drunk, cam: S.cam, mic: S.mic, peer: S.peerId, wc: S.wc, joinedAt: T.joinedAt, creator: T.creator };
}
function tsend(event, payload) {
  if (!T) return;
  if (!PRIVATE_EVENTS.includes(event)) throw new Error(`비공개 이벤트 아님: ${event}`);
  if (T.ch && T.subscribed) { T.ch.send({ type: 'broadcast', event, payload }); return; }
  if (T.ch) return; // 구독 전 — 보내지 않는다(다른 곳으로 새지 않게)
  queueMicrotask(() => onTableEvent(T, event, payload)); // 1인 모드: 루프백
}
async function openSession(tid, code, creator, seat) {
  T = newSession(tid, code, creator, seat);
  const mySession = T;
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
  const sp = TABLE_DEFS[tid - 1].seats[seat];
  S.sitTarget = { x: sp.x, z: sp.z, yaw: Math.atan2(TABLE_DEFS[tid - 1].x - sp.x, TABLE_DEFS[tid - 1].z - sp.z) };
  trackTable(); trackLobby(true);
  onTableChanged(true);
  tsend('sync-req', { id: S.me.id });
  if (creator) logLine(`테이블 ${tid}을(를) 만들었어요. 코드를 같은 테이블 사람에게만 알려주세요.`, 'sys');
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
  const tid = T.id, sp = TABLE_DEFS[tid - 1];
  stopMedia(true); closePeers();
  closeSession();
  const seat = sp.seats[S.seat ?? 0]; const dx = seat.x - sp.x, dz = seat.z - sp.z, d = Math.hypot(dx, dz) || 1;
  S.pos.set(seat.x + (dx / d) * 0.8, 0, seat.z + (dz / d) * 0.8); S.seated = false; S.table = null; S.seat = null; S.sitTarget = null; S.target = null;
  trackLobby(true); onTableChanged(false);
}
function onTableSync(sess, state) {
  if (T !== sess) return;
  const next = new Map();
  for (const [key, metas] of Object.entries(state)) if (metas.length) next.set(key, metas[metas.length - 1]);
  next.set(S.me.id, tablePayload());
  sess.members = next;
  // 정원·자리 충돌·동시 생성 정리: (joinedAt,id) 순 우선
  const order = [...next.values()].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  const myIdx = order.findIndex((m) => m.id === S.me.id);
  if (myIdx >= SEATS) { toast('테이블이 만석이에요.'); leaveTable(); return; }
  const rival = order.find((m) => m.creator && m.id !== S.me.id && (m.joinedAt < sess.joinedAt || (m.joinedAt === sess.joinedAt && m.id < S.me.id)));
  if (sess.creator && rival) { toast('같은 순간에 다른 사람이 먼저 테이블을 만들었어요. 코드를 받아 다시 입장해주세요.', 5000); leaveTable(); return; }
  const clash = order.find((m) => m.id !== S.me.id && m.seat === S.seat && (m.joinedAt < sess.joinedAt || (m.joinedAt === sess.joinedAt && m.id < S.me.id)));
  if (clash) {
    const free = [0, 1, 2, 3].find((i) => !order.some((m) => m.seat === i));
    if (free == null) { leaveTable(); return; }
    S.seat = free; const sp = TABLE_DEFS[sess.id - 1].seats[free];
    S.sitTarget = { x: sp.x, z: sp.z, yaw: Math.atan2(TABLE_DEFS[sess.id - 1].x - sp.x, TABLE_DEFS[sess.id - 1].z - sp.z) }; S.seated = false;
    trackTable(); trackLobby(true);
  }
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
  const ok = (await proofOf(sess.id, sess.code, p.nonce)) === p.proof;
  if (!ok) { f.n++; if (f.n >= 3) { f.until = Date.now() + 60000; f.n = 0; } sess.fails.set(p.id, f); return reply({ ok: false, reason: 'bad' }); }
  sess.fails.delete(p.id);
  reply({ ok: true, taken });
}
// 새로 들어오는 사람의 노크 (코드 증명) → 문 채널에서 승인/거절
async function knock(tid, code) {
  if (!(Net.sb && Net.ready)) return { ok: false, reason: 'offline' };
  const door = Net.sb.channel(CH.door(tid), { config: { broadcast: { self: false } } });
  const nonce = uid() + uid();
  let done;
  const got = new Promise((res) => { done = res; });
  door.on('broadcast', { event: 'grant' }, ({ payload }) => { if (payload?.to === S.me.id && payload.nonce === nonce) done(payload); });
  const sub = new Promise((res) => { const to = setTimeout(res, 5000); door.subscribe((st) => { if (st === 'SUBSCRIBED') { clearTimeout(to); res(true); } }); });
  await sub;
  door.send({ type: 'broadcast', event: 'knock', payload: { id: S.me.id, nonce, proof: await proofOf(tid, code, nonce) } });
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
    case 'cancel': sess.cart = sess.cart.filter((l) => !(l.id === p.itemId && l.by === p.id)); renderCart(); break;
    case 'treat': {
      const l = sess.cart.find((x) => x.id === p.itemId);
      if (l && !l.service) { if (p.on) { l.paidBy = p.id; l.paidByName = p.name; } else if (l.paidBy === p.id) { l.paidBy = null; l.paidByName = null; } }
      renderCart(); break;
    }
    case 'cheers': {
      sess.mood = Math.min(10, sess.mood + 1);
      logLine(`🍻 ${p.name} 님의 건배! 분위기 ${sess.mood}/10`, 'sys');
      if (p.id !== S.me.id) toast(`🍻 ${p.name} 님이 건배!`, 2200);
      const t = TABLE_DEFS[sess.id - 1]; burst(new THREE.Vector3(t.x, 1.1, t.z), 'cheers'); break;
    }
    case 'scenario': startScenario(p); break;
    case 'sevent': applyServiceEvent(p); break;
    case 'volunteer': sess.volunteer = { id: p.id, name: p.name }; logLine(`🥴 ${p.name} 님이 '취하는 역할'을 자원했어요. 다들 케어해주세요!`, 'sys'); renderScenario(); break;
    case 'graffiti': sess.graffiti.push({ name: p.name, text: String(p.text).slice(0, 80) }); renderScenario(); break;
    case 'rainbow': {
      if (p.id !== S.me.id) {
        toast(`🌈 무지개 토! (${p.name})`, 3500, 'big'); logLine(`🌈 무지개 토! — ${p.name}`, 'sys');
        const r = Remote.get(p.id); if (r) burst(frontOf(r.g.position, r.g.rotation.y), 'rainbow');
        if (sess.scn?.id === 5 && sess.scn.mission && !sess.scn.mission.done) sess.scn.mission.failed = true;
      }
      break;
    }
    case 'care': {
      if (p.to === S.me.id) {
        addDrunk(p.kind === 'water' ? -1 : -0.5);
        toast(`${p.fromName} 님이 ${p.kind === 'water' ? '물을' : '안주를'} 건네줬어요 (${p.kind === 'water' ? '-1' : '-0.5'})`);
      }
      break;
    }
    case 'sync-req': {
      if (p.id !== S.me.id && isKeeper(sess)) tsend('sync', { to: p.id, cart: sess.cart, scn: sess.scn, mood: sess.mood, volunteer: sess.volunteer, graffiti: sess.graffiti });
      break;
    }
    case 'sync': {
      if (p.to !== S.me.id) break;
      for (const l of p.cart || []) mergeLine(l);
      if (p.scn && !sess.scn) { sess.scn = p.scn; }
      sess.mood = Math.max(sess.mood, p.mood || 0); sess.volunteer = sess.volunteer || p.volunteer || null;
      if (p.graffiti?.length && !sess.graffiti.length) sess.graffiti = p.graffiti;
      renderCart(); renderScenario(); break;
    }
    default: break;
  }
}
const frontOf = (pos, rot) => new THREE.Vector3(pos.x + Math.sin(rot) * 0.45, 1.3, pos.z + Math.cos(rot) * 0.45);

/* ================================================================ 취기 */
function addDrunk(d) {
  const now = Date.now();
  let v = Math.max(0, S.drunk + d);
  if (d > 0 && S.rainbowUntil > now) v = Math.min(v, 4); // 쿨다운 중엔 무지개 토 재발동 방지
  const before = lvl();
  S.drunk = Math.min(5, v);
  if (S.drunk >= 5) { triggerRainbow(); return; }
  if (lvl() === 4 && before < 4) ownerSay(S.scenarios.owner.care);
  applyDrunkFx(); if (T) trackTable();
}
function triggerRainbow() {
  S.drunk = 2; S.rainbowUntil = Date.now() + RAINBOW_COOLDOWN_MS;
  burst(frontOf(S.pos, S.rot), 'rainbow');
  const fl = $('#rainbow-flash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  toast('🌈 무지개 토!', 3000, 'big');
  if (T) {
    logLine('🌈 무지개 토! (취기 레벨 2로 내려갔어요)', 'sys');
    if (T.scn?.id === 5 && T.scn.mission && !T.scn.mission.done) T.scn.mission.failed = true;
    tsend('rainbow', { id: S.me.id, name: S.me.name });
  }
  applyDrunkFx(); if (T) trackTable(); renderScenario();
}
function applyDrunkFx() {
  const L = lvl();
  document.body.className = document.body.className.replace(/\bd\d\b/g, '').trim() + ` d${L}`;
  if (T) document.body.classList.add('zoomed');
  $('#dr-level').textContent = L; $('#dr-text').textContent = LEVELS[L];
  $$('.dr-bar i').forEach((i, k) => i.classList.toggle('on', k < L));
  $('.dr-bar').classList.toggle('l4', L >= 4);
  $('#btn-water').classList.toggle('blink', L >= 4);
  document.body.dataset.drunkLevel = String(L);
  const ci = $('#chat-input'); ci.classList.toggle('ghost', L >= 3 && Math.random() < 0.6);
}
function tickCooldown() {
  const el = $('#dr-cool'), left = Math.ceil((S.rainbowUntil - Date.now()) / 1000);
  el.hidden = left <= 0; if (left > 0) el.textContent = `🌈 무지개 토 쿨다운 ${left}초 (이 동안 취기 4 이상 안 올라가요)`;
  if (lvl() >= 3) $('#chat-input').classList.toggle('ghost', Math.random() < 0.5);
}
function drinkWater() { addDrunk(-1); toast('💧 물 마셨어요 (-1)', 1800); }
function goToilet() {
  if (S.wc) return;
  S.wc = true; if (T) trackTable();
  const o = $('#toilet'); o.hidden = false; o.classList.remove('go'); void o.offsetWidth; o.classList.add('go');
  setTimeout(() => { o.hidden = true; o.classList.remove('go'); S.wc = false; addDrunk(-1); toast('🚽 개운해졌어요 (-1)', 2000); if (T) trackTable(); }, 4200);
}
function cheers() {
  if (!T) { toast('테이블에 앉아야 건배할 수 있어요.'); return; }
  tsend('cheers', { id: S.me.id, name: S.me.name });
}

/* ================================================================ 주문 */
const allItems = () => S.menu.categories.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.id, kind: c.kind })));
const itemById = (id) => allItems().find((i) => i.id === id);
function order(item) {
  if (!T) { toast('테이블에 앉으면 주문할 수 있어요. 로비에서 자리를 골라보세요.'); showTab('lobby'); return; }
  const line = { id: uid(), itemId: item.id, name: item.name, price: item.price, alcohol: !!item.alcohol, kind: item.kind, by: S.me.id, byName: S.me.name, paidBy: null, paidByName: null };
  tsend('order', { line });
}
function mergeLine(l) {
  const ex = T.cart.find((x) => x.id === l.id);
  if (!ex) T.cart.push(l); else if (l.paidBy && !ex.paidBy) { ex.paidBy = l.paidBy; ex.paidByName = l.paidByName; }
  if (l.service) { T.flags[l.id.slice(4)] = true; if (l.itemId === 'shrimpchip') T.flags.chip = true; } // 이미 나간 서비스 이벤트는 다시 안 나가게
}
function applyOrder(line) {
  if (!line || T.cart.some((x) => x.id === line.id)) return;
  const first = !T.cart.some((x) => !x.service);
  T.cart.push(line);
  logLine(`🧾 ${line.byName}: ${line.name} ${won(line.price)}`, 'sys');
  if (line.by === S.me.id) {
    if (line.alcohol) addDrunk(1 + (T.volunteer?.id === S.me.id ? 1 : 0));
    if (line.itemId === 'sukju' || line.itemId === 'corn') ownerSay(S.scenarios.owner.order);
    if (first && !T.flags.chip) tsend('sevent', { key: `chip-${T.id}`, itemId: 'shrimpchip', owner: S.scenarios.owner.service, alert: null });
    const hr = new Date().getHours(); if (hr === 23 || hr === 0) ownerSay(S.scenarios.owner.closing);
  }
  renderCart();
}
function applyServiceEvent(p) {
  if (T.flags[p.key]) return; T.flags[p.key] = true;
  if (p.itemId === 'shrimpchip') T.flags.chip = true;
  const svc = S.menu.service.find((s) => s.id === p.itemId) || itemById(p.itemId);
  if (svc) T.cart.push({ id: `svc-${p.key}`, itemId: svc.id, name: `${svc.name.replace(' (서비스)', '')} (서비스)`, price: 0, service: true, kind: 'food', by: 'owner', byName: '사장님', paidBy: null });
  if (p.owner) ownerSay(p.owner);
  if (p.alert) { toast(p.alert, 4000, 'big'); logLine(p.alert, 'sys'); }
  renderCart(); renderScenario();
}
function eat(line) {
  const n = S.eaten.get(line.id) || 0;
  if (n >= 4) { toast('다 먹었어요!', 1500); return; }
  S.eaten.set(line.id, n + 1); addDrunk(-0.5); toast(`🥢 ${line.name.replace(' (서비스)', '')} 냠냠 (-0.5)`, 1400); renderCart();
}
function renderCart() {
  const box = $('#cart-lines'); box.textContent = '';
  const cart = T?.cart || [];
  $('#cart-count').textContent = cart.length ? `(${cart.length})` : '';
  if (!T) { box.textContent = '테이블에 앉으면 주문할 수 있어요.'; $('#cart-total').textContent = ''; return; }
  if (!cart.length) box.textContent = '아직 주문이 없어요. 위 메뉴판에서 담아보세요.';
  for (const l of cart) {
    const mine = l.by === S.me.id;
    const row = h('div', { class: `line ${l.service ? 'svc' : ''}` },
      h('div', { class: 'l1' }, `${l.name}`, h('small', {}, `${l.byName} · ${l.service ? '서비스' : won(l.price)}${l.paidBy ? ` · 🎁 ${l.paidByName} 님이 쏨` : ''}`)));
    if (l.kind === 'food') row.append(h('button', { onclick: () => eat(l), title: '먹으면 취기 -0.5' }, '🥢 먹기'));
    if (!l.service && !l.paidBy) row.append(h('button', { onclick: () => tsend('treat', { itemId: l.id, id: S.me.id, name: S.me.name, on: true }) }, '🎁 내가 쏜다'));
    if (l.paidBy === S.me.id) row.append(h('button', { onclick: () => tsend('treat', { itemId: l.id, id: S.me.id, name: S.me.name, on: false }) }, '쏘기 취소'));
    if (mine && !l.service && !l.paidBy) row.append(h('button', { onclick: () => tsend('cancel', { itemId: l.id, id: S.me.id }) }, '✕'));
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
function treatAll() {
  if (!T) return;
  for (const l of T.cart) if (!l.service && !l.paidBy) tsend('treat', { itemId: l.id, id: S.me.id, name: S.me.name, on: true });
}

/* ================================================================ 시나리오 */
function selectScenario(sc) {
  if (!T) { toast('테이블에 앉으면 시나리오를 고를 수 있어요.'); return; }
  tsend('scenario', { sid: sc.id, by: S.me.id, byName: S.me.name, startedAt: Date.now() });
}
function startScenario(p) {
  const sc = S.scenarios.scenarios.find((s) => s.id === p.sid); if (!sc) return;
  T.scn = { id: sc.id, startedAt: p.startedAt, by: p.byName, fired: false };
  if (sc.mission) T.scn.mission = { endsAt: p.startedAt + sc.mission.durationSec * 1000, failed: false, done: false };
  T.volunteer = null;
  logLine(`🎭 시나리오 '${sc.title}' 시작 (${p.byName})`, 'sys');
  if (sc.startDrunk && S.drunk < sc.startDrunk) { S.drunk = sc.startDrunk; applyDrunkFx(); trackTable(); }
  renderScenario(); if (p.by !== S.me.id) toast(`🎭 시나리오: ${sc.title}`);
}
function fireScenarioEvent(sc) {
  if (!T?.scn || T.scn.fired) return;
  const e = sc.event; if (!e) return;
  T.scn.fired = true;
  tsend('sevent', { key: `scn-${sc.id}-${T.scn.startedAt}`, itemId: e.service, owner: e.owner, alert: e.alert });
  renderScenario();
}
function renderScenario() {
  const box = $('#scn-body'); box.textContent = '';
  const cur = T?.scn && S.scenarios.scenarios.find((s) => s.id === T.scn.id);
  if (cur) {
    const card = h('div', { class: 'scn-cur' }, h('b', {}, `${cur.id}. ${cur.title}`), h('div', { class: 'small muted' }, cur.summary));
    card.append(h('b', {}, '추천 주문'));
    card.append(cur.recommend.length
      ? h('div', {}, cur.recommend.map((id) => h('button', { class: 'chip', onclick: () => order(itemById(id)) }, `${itemById(id).name} 담기`)))
      : h('div', { class: 'small muted' }, '자유롭게 주문하세요.'));
    card.append(h('b', {}, '프롬프트'), h('ul', {}, cur.prompts.map((p) => h('li', {}, p))));
    if (cur.id === 2 && S.me.why) card.append(h('div', { class: 'small' }, `내가 적은 이유: "${S.me.why}"`));
    if (cur.event) {
      const done = T.scn.fired || T.flags[`scn-${cur.id}-${T.scn.startedAt}`];
      card.append(h('b', {}, '이벤트'), h('div', { class: 'small' }, `${cur.event.label}${cur.event.owner ? ` — “${cur.event.owner}”` : ''}`),
        h('button', { class: 'primary', disabled: !!done, onclick: () => fireScenarioEvent(cur) }, done ? '발동됨' : '🎁 이벤트 발동'));
    }
    if (cur.graffiti) {
      card.append(h('b', {}, '낙서벽'), h('div', { class: 'small' }, T.graffiti.map((g) => h('div', {}, `✍ ${g.name}: ${g.text}`))));
      const inp = h('input', { maxlength: 80, placeholder: '00학과 00학번, 아마도에서…' });
      card.append(h('div', { class: 'row' }, inp, h('button', { onclick: () => { const v = inp.value.trim(); if (v) { tsend('graffiti', { name: S.me.name, text: v }); inp.value = ''; } } }, '남기기')));
    }
    if (cur.mission) {
      const m = T.scn.mission; const left = Math.max(0, Math.ceil((m.endsAt - Date.now()) / 1000));
      card.append(h('b', {}, '미션'), h('div', { class: 'small' }, m.done ? (m.failed ? cur.mission.fail : cur.mission.success) : `무지개 토를 ${left}초 동안 막아라!`));
      card.append(h('div', { class: 'small' }, T.volunteer ? `🥴 취하는 역할: ${T.volunteer.name}` : '아직 자원자가 없어요.'),
        h('button', { onclick: () => tsend('volunteer', { id: S.me.id, name: S.me.name }), disabled: !!T.volunteer }, '🥴 내가 취하는 역할'));
    }
    box.append(card);
  } else if (T) box.append(h('p', { class: 'muted' }, '시나리오를 고르면 추천 주문·프롬프트·이벤트가 여기에 떠요. 선택은 같은 테이블 전원에게 공유돼요.'));
  else box.append(h('p', { class: 'muted' }, '테이블에 앉으면 시나리오를 고를 수 있어요. (둘러보기만 해도 목록은 볼 수 있어요)'));
  box.append(h('h3', {}, '시나리오 8종'));
  for (const sc of S.scenarios.scenarios) box.append(h('div', { class: `scn-card ${T?.scn?.id === sc.id ? 'on' : ''}`, onclick: () => selectScenario(sc) }, h('b', {}, `${sc.id}. ${sc.title}`), h('span', {}, sc.summary)));
}
function tickMission() {
  const m = T?.scn?.mission; if (!m || m.done) return;
  if (Date.now() >= m.endsAt) {
    m.done = true;
    if (!m.failed) { toast('🏅 케어 성공!', 4000, 'big'); logLine('🏅 케어 성공 배지! 무지개 토를 막았어요.', 'sys'); } else logLine('🌈 무지개 토가 터졌어요… 케어 실패!', 'sys');
  }
  renderScenario();
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
    t.meta.append(h('span', {}, `${isMe ? '나 · ' : ''}${m.name}`), h('span', {}, `${m.mic ? '🎤' : ''}${m.cam ? '📷' : ''} 🍺${L}`));
    t.care.textContent = '';
    if (!isMe) {
      t.care.append(h('button', { title: '물 건네기(-1)', onclick: () => tsend('care', { from: S.me.id, fromName: S.me.name, to: m.id, kind: 'water' }) }, '💧'),
        h('button', { title: '안주 건네기(-0.5)', onclick: () => tsend('care', { from: S.me.id, fromName: S.me.name, to: m.id, kind: 'snack' }) }, '🥨'));
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
  if (!sitting) { tiles.clear(); $('#zoom-grid').textContent = ''; S.eaten.clear(); }
  if (sitting) { ensurePeer(); showTab('chat'); }
  renderCart(); renderScenario(); renderLobby(); applyDrunkFx();
}

/* ================================================================ 모달 (코드 입력) */
function askCode(title, desc) {
  return new Promise((resolve) => {
    const m = $('#modal'), inp = $('#modal-code'), err = $('#modal-err');
    $('#modal-title').textContent = title; $('#modal-desc').textContent = desc; err.textContent = ''; inp.value = '';
    m.hidden = false; setTimeout(() => inp.focus(), 30);
    const done = (v) => { m.hidden = true; $('#modal-form').onsubmit = null; $('#modal-cancel').onclick = null; resolve(v); };
    $('#modal-form').onsubmit = (e) => { e.preventDefault(); if (!/^\d{4}$/.test(inp.value)) { err.textContent = '숫자 4자리를 입력하세요.'; return; } done(inp.value); };
    $('#modal-cancel').onclick = () => done(null);
  });
}
let sitBusy = false;
const REASONS = { bad: '코드가 틀렸어요. 입장할 수 없어요.', locked: '코드를 여러 번 틀렸어요. 1분 뒤에 다시 시도하세요.', full: '테이블이 만석이에요.', timeout: '테이블이 응답하지 않아요. 잠시 후 다시 시도하세요.', offline: '연결이 없어 이 테이블에 들어갈 수 없어요.' };
async function requestSit(tid, seatPref = null) {
  if (sitBusy) return;
  if (!S.entered) return;
  if (T) { toast('이미 테이블에 앉아 있어요. 먼저 일어서세요.'); return; }
  sitBusy = true;
  try {
    const occ = occupants(tid);
    if (occ.length >= SEATS) { toast('만석이에요.'); return; }
    let seat = seatPref != null && !seatTaken(tid, seatPref) ? seatPref : [0, 1, 2, 3].find((i) => !seatTaken(tid, i));
    if (seat == null) { toast('빈자리가 없어요.'); return; }
    if (!occ.length) {
      const code = await askCode(`테이블 ${tid} 새로 만들기`, '비어 있는 테이블이에요. 같은 테이블 사람이 입장할 4자리 숫자 코드를 정하세요.');
      if (!code) return;
      await openSession(tid, code, true, seat);
    } else {
      const code = await askCode(`테이블 ${tid} 입장`, '이 테이블의 4자리 코드를 입력하세요. 코드가 틀리면 입장할 수 없어요.');
      if (!code) return;
      const r = await knock(tid, code);
      if (!r.ok) { toast(REASONS[r.reason] || '입장할 수 없어요.', 4500); return; }
      if (r.taken?.includes(seat)) seat = [0, 1, 2, 3].find((i) => !r.taken.includes(i));
      if (seat == null) { toast('만석이에요.'); return; }
      await openSession(tid, code, false, seat);
    }
    toast(`🪑 테이블 ${tid}에 앉았어요.`);
  } catch (e) { console.warn(e); toast('테이블에 연결하지 못했어요. 잠시 후 다시 시도하세요.'); } finally { sitBusy = false; }
}
function createFromLobby() {
  const tid = +$('#new-table').value, code = $('#new-code').value;
  if (T) { toast('이미 테이블에 앉아 있어요.'); return; }
  if (!tid) { toast('만들 수 있는 빈 테이블이 없어요.'); return; }
  if (!/^\d{4}$/.test(code)) { toast('코드는 숫자 4자리예요.'); return; }
  if (occupants(tid).length) { toast('이미 사람이 있는 테이블이에요.'); return; }
  const seat = 0; sitBusy = true;
  openSession(tid, code, true, seat).then(() => { $('#new-code').value = ''; toast(`🪑 테이블 ${tid}을(를) 만들었어요.`); }).catch(() => toast('테이블 생성에 실패했어요.')).finally(() => { sitBusy = false; });
}

/* ================================================================ 패널 UI */
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.id === `pane-${name}`));
  $('#side').classList.add('open'); document.body.classList.remove('side-closed');
  if (name === 'chat') { $('#chat-unread').hidden = true; $('#chat-unread').textContent = '0'; }
}
let lobbyTimer = 0;
function renderLobby() { clearTimeout(lobbyTimer); lobbyTimer = setTimeout(drawLobby, 80); }
function drawLobby() {
  const list = $('#table-list'); if (!list) return; list.textContent = '';
  const empties = [];
  $('#lobby-people').textContent = Net.ready ? `지금 접속 ${lobbyMembers.size + 1}명 (다른 테이블 대화는 보이지 않아요)` : '1인 모드 — 혼자 둘러보고 주문을 연습할 수 있어요.';
  for (const t of TABLE_DEFS) {
    const occ = occupants(t.id); const mine = T?.id === t.id;
    const n = occ.length + (mine ? 1 : 0);
    if (n === 0) empties.push(t.id);
    const dots = [0, 1, 2, 3].map((i) => (seatTaken(t.id, i) ? '●' : '○')).join('');
    const full = n >= SEATS;
    list.append(h('div', { class: `tcard ${mine ? 'mine' : ''}` },
      h('span', { class: 'tn' }, `테이블 ${t.id}`), h('span', { class: 'seats' }, dots),
      h('span', { class: 'st' }, `👥 ${n}/${SEATS} · ${n === 0 ? '🔓 비어 있음' : '🔒 코드 필요'}`),
      mine ? h('button', { disabled: true }, '앉는 중') : h('button', { disabled: full || !!T, onclick: () => requestSit(t.id) }, n === 0 ? '만들기' : '앉기')));
  }
  const sel = $('#new-table'); const keep = sel.value; sel.textContent = '';
  for (const id of empties) sel.append(h('option', { value: id }, `테이블 ${id}`));
  if (keep && empties.includes(+keep)) sel.value = keep;
  $('#btn-create').disabled = !empties.length || !!T;
}
function renderMenu() {
  const cats = $('#menu-cats'); cats.textContent = '';
  for (const c of S.menu.categories) cats.append(h('button', { class: c.id === S.activeCat ? 'on' : '', onclick: () => { S.activeCat = c.id; renderMenu(); } }, c.name));
  const box = $('#menu-items'); box.textContent = '';
  const cat = S.menu.categories.find((c) => c.id === S.activeCat);
  for (const it of cat.items) {
    box.append(h('div', { class: 'item' }, h('span', { class: 'nm' }, it.name, it.signature ? h('span', { class: 'sig' }, '시그니처') : null, it.alcohol ? ' 🍺' : ''),
      h('span', { class: 'pr' }, won(it.price)), h('button', { onclick: () => order({ ...it, kind: cat.kind }) }, '담기')));
  }
}
function renderInfo() {
  const f = S.menu.meta.facts;
  const rows = [['주소', f.address], ['영업시간', f.hours], ['전화번호', f.phone], ['인스타그램', f.instagram], ['기본안주', f.basic_snack], ['서비스', f.service], ['이름의 유래', f.name_origin], ['메뉴 출처', `${S.menu.meta.source}. ${S.menu.meta.disclaimer}`]];
  const b = $('#info-body'); b.textContent = '';
  b.append(h('h3', {}, '가게 정보'));
  for (const [k, v] of rows) b.append(h('div', { class: 'info-row' }, h('b', {}, k), v));
  b.append(h('p', { class: 'muted small' }, '이 월드는 비공식 팬메이드 재현이에요. 사진 속 인물이나 사장님을 특정하지 않으며, 사장님 NPC는 리뷰 언급에 기반한 캐릭터예요. 영업시간·전화번호·현재 가격은 가게에 직접 확인하세요.'));
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
  if (u.seat) { requestSit(u.seat.table, u.seat.idx); return; }
  if (u.table) { requestSit(u.table); return; }
  if (u.owner) { ownerClick(); return; }
  if (u.wc) { if (confirm('화장실 다녀올까요?')) goToilet(); return; }
  if (u.floor && !T) S.target = { x: clamp(hit.point.x, BOUNDS.x0, BOUNDS.x1), z: clamp(hit.point.z, BOUNDS.z0, BOUNDS.z1) };
  else if (u.floor && T && !S.seated) S.target = { x: hit.point.x, z: hit.point.z };
}
let ownerIdx = 0;
function ownerClick() {
  const o = S.scenarios.owner; const seq = [o.enter, o.order, o.service, o.care, o.closing];
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
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase(); keys.add(k);
    if (k === 'e' && S.entered) { if (T) leaveTable(); else nearestSeat(); }
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
  const boxes = [...TABLE_DEFS.map((t) => ({ x: t.x, z: t.z, hw: t.hw, hd: t.hd })), COUNTER];
  for (const b of boxes) {
    const dx = p.x - b.x, dz = p.z - b.z, ox = b.hw + pad - Math.abs(dx), oz = b.hd + pad - Math.abs(dz);
    if (ox > 0 && oz > 0) { if (ox < oz) p.x += Math.sign(dx || 1) * ox; else p.z += Math.sign(dz || 1) * oz; }
  }
  p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1); p.z = clamp(p.z, BOUNDS.z0, BOUNDS.z1);
}
function stepMove(dt) {
  if (S.seated) return;
  let vx = 0, vz = 0;
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y;
  const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x;
  if (S.sitTarget) {
    const dx = S.sitTarget.x - S.pos.x, dz = S.sitTarget.z - S.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { S.pos.set(S.sitTarget.x, 0, S.sitTarget.z); S.rot = S.sitTarget.yaw; S.seated = true; trackLobby(true); return; }
    vx = dx / d; vz = dz / d;
  } else if (f || r) {
    const sx = Math.sin(orbit.theta), cz = Math.cos(orbit.theta);
    vx = -sx * f + cz * r; vz = -cz * f - sx * r; S.target = null;
  } else if (S.target) {
    const dx = S.target.x - S.pos.x, dz = S.target.z - S.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.1) S.target = null; else { vx = dx / d; vz = dz / d; }
  }
  const m = Math.hypot(vx, vz);
  if (m > 0) {
    const sp = (lvl() >= 3 ? 2.4 : 3.4) * dt;
    S.pos.x += (vx / m) * sp; S.pos.z += (vz / m) * sp;
    if (!S.sitTarget) collide(S.pos);
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
  const mood = T ? T.mood : 0;
  tableLights.forEach((l, i) => { l.intensity = 14 + mood * 1.2 + Math.sin(t * 3 + i) * 0.4; });
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
  }
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
  ok('로비 채널명이 amado-lobby 이고 테이블 채널과 다름', CH.lobby === 'amado-lobby' && !names.includes(CH.lobby));
  ok('로비 presence 허용 키에 취기·코드·채팅 없음', !LOBBY_KEYS.some((k) => ['drunk', 'code', 'chat', 'cart', 'why'].includes(k)));
  ok('비공개 이벤트와 문 이벤트 집합이 겹치지 않음', !PRIVATE_EVENTS.some((e) => DOOR_EVENTS.includes(e)));
  const a = await proofOf(1, '1234', 'n1'), b = await proofOf(1, '1234', 'n1'), c = await proofOf(1, '1235', 'n1'), d = await proofOf(2, '1234', 'n1'), e = await proofOf(1, '1234', 'n2');
  ok('노크 증명: 같은 입력은 같고, 코드·테이블·nonce가 다르면 달라짐', a === b && a !== c && a !== d && a !== e);
  ok('노크 증명에 평문 코드가 들어있지 않음', !a.includes('1234'));
  let blocked = false; try { tsendCheck('not-private'); } catch { blocked = true; }
  ok('비공개 목록에 없는 이벤트는 전송 거부', blocked);
  return out;
}
function tsendCheck(ev) { if (!PRIVATE_EVENTS.includes(ev)) throw new Error('blocked'); }

/* ================================================================ 시작 */
async function boot() {
  const [menu, scn] = await Promise.all([fetch('./menu.json').then((r) => r.json()), fetch('./scenarios.json').then((r) => r.json())]);
  S.menu = menu; S.scenarios = scn;
  const prof = loadProfile(); if (prof) { $('#in-name').value = prof.name || ''; $('#in-why').value = prof.why || ''; }
  renderMenu(); renderInfo(); renderScenario(); renderLobby(); renderCart();
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
  $('#btn-side').addEventListener('click', () => { const s = $('#side'); s.classList.toggle('open'); document.body.classList.toggle('side-closed', !s.classList.contains('open')); });
  $('#btn-create').addEventListener('click', createFromLobby);
  $('#btn-sit').addEventListener('click', () => { if (T) leaveTable(); });
  $('#btn-cheers').addEventListener('click', cheers);
  $('#btn-water').addEventListener('click', drinkWater);
  $('#btn-wc').addEventListener('click', goToilet);
  $('#btn-cam').addEventListener('click', () => toggleMedia('cam'));
  $('#btn-mic').addEventListener('click', () => toggleMedia('mic'));
  $('#btn-grid').addEventListener('click', toggleGrid);
  $('#btn-treat-all').addEventListener('click', treatAll);
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-input'); sendChat(i.value); i.value = ''; });
  $('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); enter(); });
  setInterval(() => { tickCooldown(); tickMission(); }, 1000);
  addEventListener('beforeunload', () => { try { closeSession(); Net.lobby?.untrack?.(); } catch { /* 무시 */ } });
  window.__amado = { S, CH, selfTest, get T() { return T; }, Net, requestSit, addDrunk, order, itemById, leaveTable, sendChat, TABLE_DEFS, lobbyMembers: () => lobbyMembers, enter, openSession, knock };
  document.body.dataset.ready = '1';
}
function enter() {
  const name = $('#in-name').value.trim().slice(0, 12) || randomNick();
  S.me.name = name; S.me.why = $('#in-why').value.trim().slice(0, 60);
  S.me.color = COLORS[Math.floor(Math.random() * COLORS.length)];
  saveProfile();
  if (myAvatar) { scene.remove(myAvatar); myAvatar = makeAvatar(S.me.color); scene.add(myAvatar); }
  S.entered = true;
  $('#entry').hidden = true; $('#hud-drunk').hidden = false; $('#hud-actions').hidden = false; $('#btn-sit').hidden = true;
  applyDrunkFx(); updateMediaButtons();
  joinLobby(); if (!Net.sb) setOnline(false);
  showTab('lobby');
  setTimeout(() => ownerSay(S.scenarios.owner.enter, 8000), 700);
}
boot();
