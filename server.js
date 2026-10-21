/* เซิร์ฟเวอร์ร้านซักผ้า — ไม่ต้อง npm install (Node 22.13+ มี SQLite ในตัว)
   รัน: node server.js
   ลูกค้า  : /            (สมัคร/เข้าสู่ระบบที่ /account.html)
   เจ้าของ : /admin       (ครั้งแรกจะให้ตั้งชื่อผู้ใช้+รหัสผ่านเจ้าของร้าน)
   ตัวแปรสภาพแวดล้อม: PORT, DATA_DIR, SECURE_COOKIE=1 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
process.removeAllListeners("warning");
const { DatabaseSync } = require("node:sqlite");

const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const PHOTOS = path.join(DATA, "photos");
fs.mkdirSync(PHOTOS, { recursive: true });
const db = new DatabaseSync(path.join(DATA, "laundry.db"));
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS orders(
    id TEXT PRIMARY KEY, no INTEGER UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL,
    phone TEXT, user_id TEXT, created INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY, role TEXT NOT NULL, login TEXT NOT NULL UNIQUE, name TEXT,
    salt TEXT NOT NULL, hash TEXT NOT NULL, line_user_id TEXT, line_code TEXT, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, expires INTEGER NOT NULL);
`);
const kvGet = (k, d) => { const r = db.prepare("SELECT v FROM kv WHERE k=?").get(k); return r ? JSON.parse(r.v) : d; };
const kvSet = (k, v) => db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, JSON.stringify(v));
const rand = n => crypto.randomBytes(n).toString("hex");
const digits = s => String(s || "").replace(/\D/g, "");

/* ================= ค่าเริ่มต้น (เจ้าของแก้ได้ที่หน้า admin) ================= */
const P = (iron, washiron, dry) => ({ iron, washiron, dry });
const DEFAULT_CATALOG = {
  /* ซักอบพับชั่งกิโล (ราคาต่อกิโล) */
  weight: { enabled: true, name: "ซัก+อบ+พับ (ชั่งกิโล)", perKg: 30, minKg: 3 },
  /* ซักด้วยเครื่อง แยกตามขนาดเครื่อง/เรทราคา 20–60 บาทต่อรอบ */
  wash: {
    enabled: true,
    tiers: [
      { id: "w20", name: "เครื่องเล็ก 7 กก.", cap: 7, price: 20, minutes: 30, cost: { waterL: 60, kwh: 0.4, detergent: 3, laborMin: 1.5, dep: 3 } },
      { id: "w30", name: "เครื่องกลาง 10 กก.", cap: 10, price: 30, minutes: 35, cost: { waterL: 90, kwh: 0.6, detergent: 4.5, laborMin: 1.5, dep: 4 } },
      { id: "w40", name: "เครื่องใหญ่ 14 กก.", cap: 14, price: 40, minutes: 40, cost: { waterL: 120, kwh: 0.8, detergent: 6, laborMin: 1.5, dep: 5 } },
      { id: "w60", name: "เครื่องจัมโบ้ 20+ กก.", cap: 20, price: 60, minutes: 55, cost: { waterL: 180, kwh: 1.4, detergent: 9, laborMin: 3, dep: 8 } },
    ],
    /* ชนิดผ้า: unit "kg" = คำนวณรอบจากน้ำหนัก (cap × fill) ; unit "piece" = จำนวนชิ้นต่อรอบตามขนาดเครื่อง */
    fabrics: [
      { id: "general", icon: "👕", name: "เสื้อผ้าทั่วไป (ฝ้าย/โพลี)", unit: "kg", fill: 0.8, tiers: ["w20", "w30", "w40"], extraPerLoad: 0, note: "แยกสีเข้ม-สีอ่อน" },
      { id: "towel", icon: "🛁", name: "ผ้าเช็ดตัว/ผ้าขนหนู", unit: "kg", fill: 0.7, tiers: ["w30", "w40"], extraPerLoad: 0, note: "ผ้าอุ้มน้ำมาก ใส่ไม่เต็มเครื่อง" },
      { id: "heavy", icon: "👖", name: "ยีนส์/ผ้าหนา", unit: "kg", fill: 0.6, tiers: ["w30", "w40"], extraPerLoad: 0, note: "ผ้าหนัก ใส่ได้น้อยกว่า" },
      { id: "delicate", icon: "🧵", name: "ผ้าบอบบาง (ไหม/ลูกไม้/ชุดชั้นใน)", unit: "kg", fill: 0.5, tiers: ["w20"], extraPerLoad: 10, note: "โปรแกรมถนอมผ้า" },
      { id: "sheet", icon: "🛏️", name: "ผ้าปู/ปลอกหมอน/ผ้าห่มบาง", unit: "piece", perLoad: { w30: 3, w40: 5, w60: 8 }, tiers: ["w30", "w40", "w60"], extraPerLoad: 0, note: "จำนวนชิ้นต่อรอบ" },
      { id: "duvet", icon: "🧸", name: "ผ้านวม/ผ้าห่มหนา", unit: "piece", perLoad: { w40: 1, w60: 2 }, tiers: ["w40", "w60"], extraPerLoad: 0, note: "ผ้านวมหนา ใช้เครื่องใหญ่" },
    ],
    addons: [
      { id: "soft", name: "น้ำยาปรับผ้านุ่ม", price: 5 },
      { id: "rinse", name: "ล้างน้ำเพิ่ม (ผิวแพ้ง่าย)", price: 5 },
      { id: "hot", name: "ซักน้ำร้อน/ฆ่าเชื้อ", price: 15 },
    ],
  },
  /* รีด/ซักแห้ง/ซักรีด คิดเป็นรายชิ้น */
  services: [{ id: "iron", name: "รีดอย่างเดียว" }, { id: "washiron", name: "ซัก + รีด" }, { id: "dry", name: "ซักแห้ง" }],
  categories: [
    { id: "c1", name: "เสื้อ", icon: "👔", items: [
      { id: "shirt", name: "เสื้อเชิ้ต", ...P(15, 25, 50) }, { id: "tee", name: "เสื้อยืด/โปโล", ...P(10, 20, 40) },
      { id: "blouse", name: "เสื้อสตรี/เบลาส์", ...P(15, 25, 50) }, { id: "uniform", name: "ชุดนักเรียน/ยูนิฟอร์ม (ชุด)", ...P(20, 35, null) } ] },
    { id: "c2", name: "กางเกง/กระโปรง", icon: "👖", items: [
      { id: "pants", name: "กางเกงขายาว", ...P(15, 25, 50) }, { id: "shorts", name: "กางเกงขาสั้น", ...P(10, 15, 30) },
      { id: "skirt", name: "กระโปรง", ...P(15, 25, 50) }, { id: "dress", name: "เดรส/ชุดยาว", ...P(25, 40, 80) } ] },
    { id: "c3", name: "สูท/ชุดทางการ", icon: "🧥", items: [
      { id: "jacket", name: "สูท/แจ็กเก็ต", ...P(40, null, 120) }, { id: "coat", name: "โค้ท/เสื้อคลุม", ...P(null, null, 180) },
      { id: "tie", name: "เนคไท", ...P(null, null, 30) } ] },
    { id: "c4", name: "เครื่องนอน/ของใช้", icon: "🛏️", items: [
      { id: "pillow", name: "ปลอกหมอน", ...P(10, 15, null) }, { id: "sheet2", name: "ผ้าปูที่นอน", ...P(30, 50, null) },
      { id: "duvet2", name: "ผ้านวม/ผ้าห่ม (ซักแห้ง)", ...P(null, 120, 250) }, { id: "curtain", name: "ผ้าม่าน (ผืน)", ...P(null, 100, 200) } ] },
  ],
};
const DEFAULT_SETTINGS = {
  shop: "ร้านซักอบรีด", grace: 10, sound: true, speed: 1, phone: "", lineId: "", hours: "08:00–20:00",
  /* ---- กติกาคิดเงิน (ดูลำดับการคำนวณใน priceOrder) ---- */
  minOrder: 40,          // ยอดขั้นต่ำต่อออเดอร์ — ถ้าต่ำกว่าจะเติมให้ครบ (ไม่ปฏิเสธ)
  stainFee: 10,          // ค่าซักคราบพิเศษต่อชิ้น
  expressPct: 30, expressMin: 20, expressHours: 6, leadHours: 24,   // งานด่วน +% (ขั้นต่ำเป็นบาท)
  /* ---- บริการรับ-ส่งถึงบ้าน: ส่งได้เฉพาะพื้นที่ที่กำหนด คิดค่าส่งตามพื้นที่ ---- */
  deliveryEnabled: true,
  zones: [
    { id: "z1", name: "โซนใกล้ร้าน (ไม่เกิน 2 กม.)", fee: 20, freeOver: 300, minOrder: 0, active: true, note: "ถึงภายในวันเดียวกันถ้าสั่งก่อน 14:00" },
    { id: "z2", name: "โซนใกล้เคียง (2–5 กม.)", fee: 40, freeOver: 500, minOrder: 150, active: true, note: "" },
  ],
  slots: ["เช้า 08:00–12:00", "บ่าย 12:00–17:00", "เย็น 17:00–20:00"],
  dropoffOptions: ["ส่งให้ถึงมือ (โทรก่อน)", "ฝากไว้กับ รปภ./นิติบุคคล", "วางหน้าประตู/หน้าห้อง"],
  deliveryNote: "พนักงานจะโทรยืนยันก่อนไปรับ-ส่งทุกครั้ง",
  roundTo: 1,            // ปัดยอดสุดท้ายเป็นผลคูณของเลขนี้ (เช่น 5)
  vatPct: 0,             // ถ้า >0 = ราคารวมภาษีแล้ว แสดงยอด VAT ในใบเสร็จ
  earnDiv: 10,           // จ่ายครบทุก 10 บาท = 1 แต้ม
  redeemStep: 100, redeemBaht: 10, maxRedeemPct: 30,   // 100 แต้ม = 10 บาท, ลดได้ไม่เกิน 30% ของยอด
  promos: [{ code: "WELCOME", pct: 10, min: 100 }],
  line: { enabled: false, token: "", secret: "" },
  cost: { waterPerM3: 18, kwhRate: 4.5, laborPerMin: 3, overheadPct: 15 },   // ค่าประมาณ ปรับตามบิลจริง
  programs: {
    washer: [{ n: "ซักเร็ว", min: 25 }, { n: "ซักปกติ", min: 40 }, { n: "ผ้านวม/หนัก", min: 55 }],
    dryer: [{ n: "อบเบา", min: 25 }, { n: "อบปกติ", min: 40 }, { n: "อบหนัก", min: 55 }],
  },
  services: [
    { n: "ซัก+อบ (พับ)", perKg: 30, min: 60 }, { n: "ซัก+อบ+รีด", perKg: 60, min: 120 },
    { n: "รีดอย่างเดียว (ต่อชิ้น)", perKg: 15, min: 20 }, { n: "ผ้านวม/ผ้าห่ม (ต่อผืน)", perKg: 120, min: 60 },
  ],
};
if (!kvGet("catalog")) kvSet("catalog", DEFAULT_CATALOG);
if (!kvGet("settings")) kvSet("settings", DEFAULT_SETTINGS);
if (!kvGet("machines")) {
  const m = [], t = ["w20", "w30", "w40", "w60"];
  for (let i = 0; i < 4; i++) m.push({ id: rand(4), name: `ซัก ${i + 1}`, type: "washer", tier: t[i], cap: [7, 10, 14, 20][i], status: "idle" });
  for (let i = 1; i <= 3; i++) m.push({ id: rand(4), name: `อบ ${i}`, type: "dryer", cap: 14, status: "idle" });
  kvSet("machines", m);
}

/* ================= บัญชี / session ================= */
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString("hex");
function createUser({ role, login, name, password }) {
  const id = rand(6), salt = rand(16);
  db.prepare("INSERT INTO users(id,role,login,name,salt,hash,line_code,created) VALUES(?,?,?,?,?,?,?,?)").run(id, role, login, name || "", salt, hashPw(password, salt), String(100000 + crypto.randomInt(900000)), Date.now());
  return id;
}
function checkLogin(role, login, password) {
  const u = db.prepare("SELECT * FROM users WHERE role=? AND login=?").get(role, login);
  const salt = u ? u.salt : "0".repeat(32), h = Buffer.from(hashPw(password, salt), "hex");
  if (!u) return null;
  return crypto.timingSafeEqual(h, Buffer.from(u.hash, "hex")) ? u : null;
}
function startSession(res, req, u) {
  const token = rand(24), ttl = u.role === "owner" ? 12 * 3600e3 : 30 * 864e5;
  db.prepare("INSERT INTO sessions(token,user_id,role,expires) VALUES(?,?,?,?)").run(token, u.id, u.role, Date.now() + ttl);
  const secure = process.env.SECURE_COOKIE === "1" || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", `${COOKIE[u.role]}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}${secure ? "; Secure" : ""}`);
}
/* แยกคุกกี้ตามบทบาท: ลูกค้า (sc) กับเจ้าของร้าน (so) ล็อกอินพร้อมกันในเบราว์เซอร์เดียวกันได้ แต่สิทธิไม่ปนกัน */
const COOKIE = { owner: "so", customer: "sc" };
const clearCookie = role => `${COOKIE[role]}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
function sessionOf(req, role) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE[role]}=([a-f0-9]+)`).exec(req.headers.cookie || ""); if (!m) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token=? AND role=?").get(m[1], role);
  if (!s || s.expires < Date.now()) return null;
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id);
  return u ? { token: s.token, user: u } : null;
}
setInterval(() => db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now()), 3600e3).unref();

/* ================= ออเดอร์ ================= */
const parse = r => ({ ...JSON.parse(r.data), id: r.id, no: r.no, token: r.token });
const nextNo = () => db.prepare("SELECT COALESCE(MAX(no),0)+1 AS n FROM orders").get().n;
function insertOrder(o) {
  o.id = rand(5); o.token = rand(5); o.no = nextNo(); o.created = Date.now(); o.updated = o.created;
  db.prepare("INSERT INTO orders(id,no,token,phone,user_id,created,data) VALUES(?,?,?,?,?,?,?)").run(o.id, o.no, o.token, o.phone || "", o.userId || null, o.created, JSON.stringify(o));
  return o;
}
const saveOrder = o => db.prepare("UPDATE orders SET phone=?, user_id=?, data=? WHERE id=?").run(o.phone || "", o.userId || null, JSON.stringify(o), o.id);
const getOrder = id => { const r = db.prepare("SELECT * FROM orders WHERE id=?").get(id); return r && parse(r); };
const pointsOf = userId => {
  if (!userId) return 0;
  const os_ = db.prepare("SELECT data FROM orders WHERE user_id=?").all(userId).map(r => JSON.parse(r.data));
  const st = kvGet("settings");
  const earned = os_.filter(o => o.paid).reduce((a, o) => a + Math.floor((o.price || 0) / (st.earnDiv || 10)), 0);
  const used = os_.reduce((a, o) => a + (o.pointsUsed || 0), 0);
  return Math.max(0, earned - used);
};

/* ================= ★ ตรรกะคิดเงิน (คำนวณฝั่งเซิร์ฟเวอร์เสมอ) =================
   1) ราคารายการ  : รายชิ้น = ราคา×จำนวน | ชั่งกิโล = max(กก., ขั้นต่ำ)×ราคา/กก.
                    ซักเครื่อง = (ราคาเครื่อง + ค่าชนิดผ้าต่อรอบ + แอดออนต่อรอบ) × จำนวนรอบ
   2) ค่าซักคราบ   : จำนวนชิ้น × stainFee
   3) ยอดย่อย      = ผลรวมข้อ 1+2
   4) ยอดขั้นต่ำ   : ถ้า ยอดย่อย < minOrder → เติมส่วนต่างเป็น "ปรับเป็นยอดขั้นต่ำ"  (= base)
   5) งานด่วน      : max(expressMin, base × expressPct%)
   6) โค้ดส่วนลด   : % หรือบาท คิดจาก base (ไม่รวมค่าด่วน/ค่าส่ง) ไม่เกิน base
   7) แต้มสะสม     : ใช้เป็นชุด redeemStep แต้ม = redeemBaht บาท, ไม่เกิน maxRedeemPct% ของ (base − โค้ด) — ต้องล็อกอิน
   8) ค่ารับ-ส่ง    : ถ้าเลือกส่ง และ base < freeOver
   9) รวม = base + ด่วน + ส่ง − โค้ด − แต้ม → ปัดตาม roundTo  (ไม่ติดลบ)
  10) VAT (ถ้ามี) ถือว่าราคารวมแล้ว: vat = รวม × v/(100+v) */
function priceOrder(body, user, opt = {}) {
  const cat = kvGet("catalog"), st = kvGet("settings");
  const items = new Map(); cat.categories.forEach(c => c.items.forEach(i => items.set(i.id, i)));
  const svcName = Object.fromEntries(cat.services.map(s => [s.id, s.name]));
  const lines = []; let sub = 0, pieces = 0, washLoads = 0;
  const tierOf = id => cat.wash?.tiers.find(t => t.id === id);
  for (const l of (Array.isArray(body.lines) ? body.lines : []).slice(0, 60)) {
    if (l.wash) {                                                   // --- ซักเครื่อง
      if (!cat.wash?.enabled) continue;
      const fab = cat.wash.fabrics.find(f => f.id === l.fabric), tier = tierOf(l.tier), loads = Math.floor(+l.loads);
      if (!fab || !tier || !fab.tiers.includes(tier.id) || !(loads >= 1 && loads <= 20)) continue;
      const ad = (Array.isArray(l.addons) ? l.addons : []).map(a => cat.wash.addons.find(x => x.id === a)).filter(Boolean);
      const per = tier.price + (fab.extraPerLoad || 0) + ad.reduce((a, x) => a + x.price, 0), amount = per * loads;
      lines.push({ wash: true, fabric: fab.id, fabricName: fab.name, tier: tier.id, tierName: tier.name, loads, unit: per, addons: ad.map(x => x.id), addonNames: ad.map(x => x.name), name: `ซัก ${fab.name}`, svcName: `${tier.name} ×${loads} รอบ`, qty: loads, amount });
      sub += amount; washLoads += loads; continue;
    }
    const it = items.get(l.id), qty = Math.floor(+l.qty);                // --- รายชิ้น
    if (!it || !(qty >= 1 && qty <= 99)) continue;
    const unit = it[l.svc]; if (!(unit > 0)) continue;
    lines.push({ id: it.id, name: it.name, svc: l.svc, svcName: svcName[l.svc] || l.svc, qty, unit, amount: unit * qty });
    sub += unit * qty; pieces += qty;
  }
  let kg = 0;
  if (cat.weight?.enabled && +body.kg > 0) {                            // --- ชั่งกิโล
    kg = Math.min(80, Math.round(+body.kg * 10) / 10);
    const eff = Math.max(kg, cat.weight.minKg || 0), amount = Math.round(eff * cat.weight.perKg);
    lines.push({ id: "weight", name: cat.weight.name, svc: "weight", svcName: "ชั่งกิโล", qty: kg, unit: cat.weight.perKg, amount, estimate: !opt.actual });
    sub += amount;
  }
  if (!lines.length) throw new Error("ยังไม่ได้เลือกรายการ");
  const stainPieces = Math.max(0, Math.min(99, Math.floor(+body.stain || 0))), stainFee = stainPieces * (st.stainFee || 0);
  sub += stainFee;
  const minTopUp = Math.max(0, (st.minOrder || 0) - sub), base = sub + minTopUp;
  const express = !!body.express, delivery = !!body.delivery;
  const expressFee = express ? Math.max(st.expressMin || 0, Math.round(base * (st.expressPct || 0) / 100)) : 0;
  let promoDisc = 0, promo = null;
  const code = String(body.promo || "").trim().toUpperCase();
  if (code) {
    const p = (st.promos || []).find(x => x.code.toUpperCase() === code);
    if (!p) throw new Error("โค้ดส่วนลดไม่ถูกต้อง");
    if (base < (p.min || 0)) throw new Error(`โค้ดนี้ใช้ได้เมื่อยอดตั้งแต่ ${p.min} บาท`);
    promoDisc = Math.min(base, Math.round(p.pct ? base * p.pct / 100 : p.flat || 0)); promo = p.code;
  }
  let pointsUsed = 0, pointsDisc = 0;
  const want = Math.floor(+body.points || 0);
  if (want > 0) {
    if (!user) throw new Error("ต้องเข้าสู่ระบบก่อนจึงจะใช้แต้มได้");
    const step = st.redeemStep || 100, avail = opt.noPointCheck ? want : pointsOf(user.id);
    const maxBaht = Math.floor((base - promoDisc) * (st.maxRedeemPct || 30) / 100);
    const sets = Math.min(Math.floor(Math.min(want, avail) / step), Math.floor(maxBaht / (st.redeemBaht || 10)));
    if (sets < 1 && !opt.noPointCheck) throw new Error(`ใช้แต้มได้ครั้งละ ${step} แต้ม (คุณมี ${avail} แต้ม, ลดได้ไม่เกิน ${st.maxRedeemPct}% ของยอด)`);
    pointsUsed = Math.max(0, sets) * step; pointsDisc = Math.max(0, sets) * (st.redeemBaht || 10);
  }
  let deliveryFee = 0, zone = null;
  if (delivery) {                                  // ส่งได้เฉพาะโซนที่เจ้าของร้านเปิดไว้
    if (st.deliveryEnabled === false) throw new Error("ขณะนี้ปิดบริการรับ-ส่ง");
    zone = (st.zones || []).find(z => z.id === body.zone && z.active !== false);
    if (!zone) throw new Error("กรุณาเลือกพื้นที่จัดส่งที่ร้านให้บริการ");
    if (base < (zone.minOrder || 0)) throw new Error(`พื้นที่ “${zone.name}” ต้องมียอดตั้งแต่ ${zone.minOrder} บาทจึงจะรับ-ส่งได้`);
    deliveryFee = base < (zone.freeOver ?? Infinity) ? zone.fee || 0 : 0;
  }
  let total = base + expressFee + deliveryFee - promoDisc - pointsDisc;
  const r = st.roundTo || 1; total = Math.max(0, Math.round(total / r) * r);
  const vat = st.vatPct > 0 ? Math.round(total * st.vatPct / (100 + st.vatPct) * 100) / 100 : 0;
  return { lines, sub, stainPieces, stainFee, minTopUp, base, expressFee, deliveryFee, promoDisc, promo, pointsUsed, pointsDisc, total, vat, pieces, washLoads, kg, express, delivery, zone: zone && { id: zone.id, name: zone.name, fee: zone.fee }, discount: promoDisc + pointsDisc };
}

/* ================= LINE Messaging API ================= */
const lineVerify = (raw, sig, secret) => {
  if (!secret || !sig) return false;
  const h = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(h), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
async function linePush(to, text) {
  const cfg = kvGet("settings").line || {};
  if (!cfg.enabled || !cfg.token || !to) return false;
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token }, body: JSON.stringify({ to, messages: [{ type: "text", text }] }) });
    if (!r.ok) console.error("LINE push failed", r.status, await r.text());
    return r.ok;
  } catch (e) { console.error("LINE push error", e.message); return false; }
}
const lineTarget = o => o.lineUserId || (o.userId && db.prepare("SELECT line_user_id FROM users WHERE id=?").get(o.userId)?.line_user_id) || null;
function notifyStage(o, what) {
  const st = kvGet("settings"), who = o.name ? `คุณ${o.name}` : "ลูกค้า";
  const text = what === "accepted" ? `🫧 ${st.shop}\nรับออเดอร์คิว #${o.no} ของ${who}แล้วค่ะ คาดว่าเสร็จ ${new Date(o.due).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : `✅ ${st.shop}\nผ้าคิว #${o.no} ของ${who}ซักเสร็จพร้อมรับแล้วค่ะ ยอด ${o.price} บาท${o.paid ? " (ชำระแล้ว)" : ""}`;
  linePush(lineTarget(o), text);
}
async function lineWebhook(req, res, raw) {
  const cfg = kvGet("settings").line || {};
  if (!lineVerify(raw, req.headers["x-line-signature"], cfg.secret)) { res.writeHead(401); return res.end(); }
  res.writeHead(200); res.end("ok");
  let body; try { body = JSON.parse(raw); } catch { return; }
  for (const ev of body.events || []) {
    const uid = ev.source?.userId; if (ev.type !== "message" || ev.message?.type !== "text" || !uid) continue;
    const t = ev.message.text.trim(); let m;
    const reply = text => fetch("https://api.line.me/v2/bot/message/reply", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token }, body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: "text", text }] }) }).catch(() => {});
    if ((m = /^(?:ผูก|link)\s*(\d{6})$/i.exec(t))) {                   // ผูกบัญชีลูกค้า: "ผูก 123456"
      const u = db.prepare("SELECT id FROM users WHERE role='customer' AND line_code=?").get(m[1]);
      if (u) { db.prepare("UPDATE users SET line_user_id=? WHERE id=?").run(uid, u.id); reply("เชื่อมบัญชี LINE สำเร็จ จะแจ้งเตือนเมื่อผ้าเสร็จค่ะ 🫧"); } else reply("ไม่พบรหัสนี้ ตรวจสอบในหน้าบัญชีของคุณ");
    } else if ((m = /^(?:คิว|q)\s*#?(\d+)\s+(\d{4})$/i.exec(t))) {      // ลูกค้าไม่ได้สมัคร: "คิว 12 5678" (เลขคิว + เบอร์ 4 ตัวท้าย)
      const r = db.prepare("SELECT * FROM orders WHERE no=?").get(+m[1]);
      if (r && digits(r.phone).endsWith(m[2])) { const o = parse(r); o.lineUserId = uid; saveOrder(o); reply(`ผูกคิว #${o.no} แล้ว จะแจ้งเมื่อผ้าพร้อมรับค่ะ`); } else reply("ไม่พบคิว/เบอร์ไม่ตรง");
    } else reply("พิมพ์ “ผูก 123456” (รหัสจากหน้าบัญชี) หรือ “คิว 12 5678” (เลขคิว + เบอร์ 4 ตัวท้าย) เพื่อรับแจ้งเตือนค่ะ");
  }
}

/* ================= HTTP ================= */
const hits = new Map();
function limited(ip, key, max, winMs) {
  const k = key + ip, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < winMs);
  a.push(now); hits.set(k, a); return a.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 600000)) hits.delete(k); }, 60000).unref();
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
const readRaw = (req, max = 1.5e6) => new Promise((ok, no) => {
  let s = ""; req.on("data", c => { s += c; if (s.length > max) { no(new Error("big")); req.destroy(); } }); req.on("end", () => ok(s));
});
const readBody = async req => { const s = await readRaw(req); try { return s ? JSON.parse(s) : {}; } catch { throw new Error("bad json"); } };
const publicSettings = st => ({ shop: st.shop, phone: st.phone, lineId: st.lineId, hours: st.hours, expressPct: st.expressPct, expressMin: st.expressMin, deliveryEnabled: st.deliveryEnabled !== false, zones: (st.zones || []).filter(z => z.active !== false).map(z => ({ id: z.id, name: z.name, fee: z.fee, freeOver: z.freeOver, minOrder: z.minOrder, note: z.note })), slots: st.slots || [], dropoffOptions: st.dropoffOptions || [], deliveryNote: st.deliveryNote || "", minOrder: st.minOrder, stainFee: st.stainFee, leadHours: st.leadHours, expressHours: st.expressHours, redeemStep: st.redeemStep, redeemBaht: st.redeemBaht, maxRedeemPct: st.maxRedeemPct, vatPct: st.vatPct });
const photoUrls = o => (o.photos || []).map(p => ({ url: "/photos/" + p.file, kind: p.kind, at: p.at, note: p.note }));
const safeTrack = o => ({
  no: o.no, name: o.name, stage: o.stage, incoming: !!o.incoming, lines: o.lines || [], total: o.price, paid: !!o.paid, due: o.due, created: o.created,
  delivery: !!o.delivery, zoneName: o.zone?.name, dlv: o.dlv || null, pickupSlot: o.pickupSlot, express: !!o.express, unit: o.unit, kg: o.kg, service: o.service, photos: photoUrls(o), linked: !!lineTarget(o),
  breakdown: { sub: o.sub, stainFee: o.stainFee, minTopUp: o.minTopUp, expressFee: o.expressFee, deliveryFee: o.deliveryFee, promo: o.promo, promoDisc: o.promoDisc, pointsDisc: o.pointsDisc, vat: o.vat },
});
const PATCHABLE = ["name", "phone", "service", "kg", "unit", "price", "note", "stage", "paid", "paidAt", "due", "incoming", "address", "payMethod", "dlv"];
const DLV_STATES = ["wait_pickup", "picked", "out", "delivered"];   // รอไปรับผ้า → รับผ้าแล้ว → กำลังนำส่ง → ส่งถึงมือแล้ว
const clip = (v, n = 120) => String(v ?? "").trim().slice(0, n);
const strongPw = p => typeof p === "string" && p.length >= 8 && p.length <= 100;

async function api(req, res, u) {
  const ip = req.socket.remoteAddress, m = req.method, p = u.pathname;
  try {
    if (p === "/api/ping") return send(res, 200, { ok: true });
    if (p === "/api/line/webhook" && m === "POST") return lineWebhook(req, res, await readRaw(req, 1e6));
    // กัน CSRF เบื้องต้น: ทุกคำขอที่แก้ข้อมูลต้องเป็น JSON (ฟอร์มข้ามเว็บส่ง JSON ไม่ได้) + คุกกี้ SameSite=Lax
    if (m !== "GET" && !/application\/json/.test(req.headers["content-type"] || "")) return send(res, 415, { error: "json only" });
    const cs = sessionOf(req, "customer"), os_ = sessionOf(req, "owner");
    const user = cs?.user, isCust = !!user;          // user = ลูกค้า (ถ้ามี)
    const ou = os_?.user, isOwner = !!ou;            // ou = เจ้าของร้าน (ถ้ามี)

    if (p === "/api/catalog" && m === "GET") return send(res, 200, { catalog: kvGet("catalog"), settings: publicSettings(kvGet("settings")) });
    if (p === "/api/quote" && m === "POST") { try { return send(res, 200, priceOrder(await readBody(req), isCust ? user : null)); } catch (e) { return send(res, 400, { error: e.message }); } }

    /* ---------- สมัคร/เข้าสู่ระบบลูกค้า ---------- */
    if (p === "/api/auth/register" && m === "POST") {
      if (limited(ip, "reg", 5, 3600e3)) return send(res, 429, { error: "สมัครถี่เกินไป" });
      const b = await readBody(req), phone = digits(b.phone), name = String(b.name || "").trim().slice(0, 80);
      if (!name || phone.length < 9 || phone.length > 12) return send(res, 400, { error: "กรอกชื่อและเบอร์โทรให้ถูกต้อง" });
      if (!strongPw(b.password)) return send(res, 400, { error: "รหัสผ่านอย่างน้อย 8 ตัวอักษร" });
      if (db.prepare("SELECT 1 FROM users WHERE login=?").get(phone)) return send(res, 409, { error: "เบอร์นี้สมัครแล้ว — เข้าสู่ระบบแทน" });
      const id = createUser({ role: "customer", login: phone, name, password: b.password });
      startSession(res, req, { id, role: "customer" }); return send(res, 200, { ok: true });
    }
    if (p === "/api/auth/login" && m === "POST") {
      if (limited(ip, "login", 10, 600e3)) return send(res, 429, { error: "ลองผิดหลายครั้ง รอ 10 นาที" });
      const b = await readBody(req), u2 = checkLogin("customer", digits(b.phone), b.password);
      if (!u2) return send(res, 401, { error: "เบอร์หรือรหัสผ่านไม่ถูกต้อง" });
      startSession(res, req, u2); return send(res, 200, { ok: true });
    }
    if (p === "/api/auth/logout" && m === "POST") {
      if (cs) db.prepare("DELETE FROM sessions WHERE token=?").run(cs.token);
      res.setHeader("Set-Cookie", clearCookie("customer")); return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/logout" && m === "POST") {
      if (os_) db.prepare("DELETE FROM sessions WHERE token=?").run(os_.token);
      res.setHeader("Set-Cookie", clearCookie("owner")); return send(res, 200, { ok: true });
    }
    if (p === "/api/me" && m === "GET") {
      if (!isCust) return send(res, 200, { user: null });
      const orders = db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY no DESC LIMIT 50").all(user.id).map(parse).map(o => ({ ...safeTrack(o), token: o.token }));
      const line = kvGet("settings").line || {};
      return send(res, 200, { user: { name: user.name, phone: user.login, lineLinked: !!user.line_user_id, lineCode: user.line_code, lineEnabled: !!(line.enabled && line.token) }, points: pointsOf(user.id), orders, shop: publicSettings(kvGet("settings")) });
    }
    if (p === "/api/me" && m === "PATCH" && isCust) { const b = await readBody(req); if (b.name) db.prepare("UPDATE users SET name=? WHERE id=?").run(String(b.name).slice(0, 80), user.id); return send(res, 200, { ok: true }); }

    /* ---------- สั่งซัก ---------- */
    if (p === "/api/orders" && m === "POST") {
      const body = await readBody(req);
      if (limited(ip, "order", 8, 600000)) return send(res, 429, { error: "สั่งถี่เกินไป กรุณารอสักครู่" });
      const name = String(body.name || user?.name || "").trim().slice(0, 80), phone = digits(body.phone || (isCust ? user.login : ""));
      if (!name) return send(res, 400, { error: "กรุณากรอกชื่อ" });
      if (phone.length < 9 || phone.length > 12) return send(res, 400, { error: "เบอร์โทรไม่ถูกต้อง" });
      let q; try { q = priceOrder(body, isCust ? user : null); } catch (e) { return send(res, 400, { error: e.message }); }
      // ที่อยู่จัดส่ง: บังคับกรอกให้ครบเมื่อเลือกรับ-ส่ง
      let addr = null;
      if (q.delivery) {
        const a = body.addr || {}, rphone = digits(a.phone || phone);
        addr = { recipient: clip(a.recipient || name, 80), phone: rphone, house: clip(a.house, 60), building: clip(a.building, 80), street: clip(a.street, 100), subdistrict: clip(a.subdistrict, 80), landmark: clip(a.landmark, 120), dropoff: clip(a.dropoff, 80), courierNote: clip(a.courierNote, 200), mapUrl: /^https?:\/\/(maps\.google\.com|www\.google\.com\/maps|goo\.gl|maps\.app\.goo\.gl)\//.test(a.mapUrl || "") ? clip(a.mapUrl, 200) : "", lat: Number.isFinite(+a.lat) && a.lat !== "" ? +(+a.lat).toFixed(5) : null, lon: Number.isFinite(+a.lon) && a.lon !== "" ? +(+a.lon).toFixed(5) : null };
        if (!addr.house) return send(res, 400, { error: "กรุณากรอกบ้านเลขที่/ห้อง" });
        if (!addr.street && !addr.landmark) return send(res, 400, { error: "กรุณากรอกซอย/ถนน หรือจุดสังเกตใกล้เคียง" });
        if (addr.phone.length < 9 || addr.phone.length > 12) return send(res, 400, { error: "เบอร์ผู้รับไม่ถูกต้อง" });
        if (!clip(body.slot)) return send(res, 400, { error: "กรุณาเลือกช่วงเวลารับ-ส่ง" });
      }
      const st = kvGet("settings"), due = Date.now() + (q.express ? st.expressHours : st.leadHours) * 3600000;
      const parts = []; if (q.pieces) parts.push(`${q.pieces} ชิ้น`); if (q.washLoads) parts.push(`ซักเครื่อง ${q.washLoads} รอบ`); if (q.kg) parts.push(`ชั่งกิโล ~${q.kg} กก.`);
      const o = insertOrder({
        name, phone, userId: isCust ? user.id : undefined, src: "customer", incoming: true, stage: 0, paid: false,
        service: "สั่งออนไลน์ " + parts.join(" + "), kg: q.pieces || q.washLoads || q.kg, unit: q.pieces ? "ชิ้น" : q.washLoads ? "รอบ" : "กก.", price: q.total,
        lines: q.lines, sub: q.sub, stainFee: q.stainFee, stainPieces: q.stainPieces, minTopUp: q.minTopUp, expressFee: q.expressFee, deliveryFee: q.deliveryFee,
        promo: q.promo, promoDisc: q.promoDisc, pointsUsed: q.pointsUsed, pointsDisc: q.pointsDisc, vat: q.vat,
        express: q.express, delivery: q.delivery, zone: q.zone, addr, dlv: q.delivery ? "wait_pickup" : undefined,
        address: addr ? [addr.house, addr.building, addr.street, addr.subdistrict, q.zone?.name].filter(Boolean).join(" ") : "",
        pickupSlot: clip(body.slot, 60), note: clip(body.note, 300), due,
        input: { lines: body.lines, kg: body.kg, stain: body.stain, express: body.express, delivery: body.delivery, zone: body.zone, promo: body.promo, points: q.pointsUsed },
      });
      return send(res, 200, { no: o.no, token: o.token, total: o.price, due: o.due });
    }

    if (p === "/api/track" && m === "GET") {
      if (limited(ip, "track", 40, 60000)) return send(res, 429, { error: "ลองใหม่อีกสักครู่" });
      const t = u.searchParams.get("t"), no = +u.searchParams.get("no"), p4 = u.searchParams.get("p4");
      let r;
      if (t) r = db.prepare("SELECT * FROM orders WHERE token=?").get(t);
      else if (no && p4 && /^\d{4}$/.test(p4)) { r = db.prepare("SELECT * FROM orders WHERE no=?").get(no); if (r && !digits(r.phone).endsWith(p4)) r = null; }
      if (!r) return send(res, 404, { error: "ไม่พบออเดอร์ — ตรวจเลขคิวและเบอร์โทร 4 ตัวท้าย" });
      const o = parse(r); return send(res, 200, { ...safeTrack(o), points: o.userId ? pointsOf(o.userId) : 0 });
    }

    /* ---------- เจ้าของร้าน ---------- */
    if (p === "/api/admin/status" && m === "GET") return send(res, 200, { setup: !db.prepare("SELECT 1 FROM users WHERE role='owner'").get(), loggedIn: isOwner, name: isOwner ? ou.name : null });
    if (p === "/api/admin/setup" && m === "POST") {
      if (db.prepare("SELECT 1 FROM users WHERE role='owner'").get()) return send(res, 403, { error: "ตั้งค่าไปแล้ว" });
      const b = await readBody(req), login = String(b.login || "").trim().toLowerCase().slice(0, 40);
      if (!/^[a-z0-9_.-]{3,40}$/.test(login)) return send(res, 400, { error: "ชื่อผู้ใช้ 3–40 ตัว (a-z 0-9 _ . -)" });
      if (!strongPw(b.password)) return send(res, 400, { error: "รหัสผ่านอย่างน้อย 8 ตัวอักษร" });
      const id = createUser({ role: "owner", login, name: "เจ้าของร้าน", password: b.password });
      startSession(res, req, { id, role: "owner" }); return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/login" && m === "POST") {
      if (limited(ip, "alogin", 6, 600e3)) return send(res, 429, { error: "ลองผิดหลายครั้ง รอ 10 นาที" });
      const b = await readBody(req), u2 = checkLogin("owner", String(b.login || "").trim().toLowerCase(), b.password);
      if (!u2) return send(res, 401, { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      startSession(res, req, u2); return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/password" && m === "POST" && isOwner) {
      const b = await readBody(req);
      if (!checkLogin("owner", ou.login, b.old)) return send(res, 401, { error: "รหัสผ่านเดิมไม่ถูกต้อง" });
      if (!strongPw(b.password)) return send(res, 400, { error: "รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร" });
      const salt = rand(16); db.prepare("UPDATE users SET salt=?, hash=? WHERE id=?").run(salt, hashPw(b.password, salt), ou.id);
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(ou.id, os_.token); return send(res, 200, { ok: true });
    }
    if (!isOwner) return send(res, 401, { error: "ต้องเข้าสู่ระบบเจ้าของร้าน" });

    /* ---- ทุกอย่างต่อจากนี้ เจ้าของร้านเท่านั้น ---- */
    if (p === "/api/admin/orders" && m === "POST") {         // รับผ้าหน้าร้านโดยเจ้าของ (แยกจาก /api/orders ของลูกค้า)
      const body = await readBody(req);
      return send(res, 200, insertOrder({ name: String(body.name || "ลูกค้าหน้าร้าน").slice(0, 80), phone: digits(body.phone).slice(0, 15), service: String(body.service || "").slice(0, 80), kg: +body.kg || 0, unit: body.unit === "ชิ้น" ? "ชิ้น" : "กก.", price: +body.price || 0, note: String(body.note || "").slice(0, 300), paid: false, stage: 0, due: +body.due || Date.now() + 864e5, src: "staff" }));
    }
    if (p === "/api/admin/customers" && m === "GET") {       // รายชื่อสมาชิก + ยอดใช้จ่าย + แต้ม (ลูกค้าเห็นของตัวเองเท่านั้น เจ้าของเห็นทั้งหมด)
      const st = kvGet("settings"), rows = db.prepare("SELECT id,login,name,line_user_id,created FROM users WHERE role='customer' ORDER BY created DESC LIMIT 500").all();
      return send(res, 200, rows.map(u => {
        const os2 = db.prepare("SELECT data FROM orders WHERE user_id=?").all(u.id).map(r => JSON.parse(r.data));
        const spent = os2.filter(o => o.paid).reduce((a, o) => a + o.price, 0);
        return { name: u.name, phone: u.login, line: !!u.line_user_id, joined: u.created, orders: os2.length, spent, points: pointsOf(u.id), last: os2.reduce((a, o) => Math.max(a, o.created || 0), 0), earnDiv: st.earnDiv };
      }));
    }

    if (p === "/api/state" && m === "GET") {
      const orders = db.prepare("SELECT * FROM orders ORDER BY no DESC LIMIT 400").all().map(parse);
      return send(res, 200, { machines: kvGet("machines"), settings: kvGet("settings"), catalog: kvGet("catalog"), orders, now: Date.now() });
    }
    if (p === "/api/state" && m === "PUT") {
      const b = await readBody(req);
      if (Array.isArray(b.machines)) kvSet("machines", b.machines.slice(0, 60));
      if (b.catalog && Array.isArray(b.catalog.categories) && b.catalog.wash?.tiers) kvSet("catalog", b.catalog);
      if (b.settings && typeof b.settings === "object") kvSet("settings", { ...kvGet("settings"), ...b.settings });
      return send(res, 200, { ok: true });
    }
    const om = p.match(/^\/api\/orders\/([a-f0-9]+)$/);
    if (om && m === "PATCH") {
      const o = getOrder(om[1]); if (!o) return send(res, 404, { error: "not found" });
      const b = await readBody(req), prevStage = o.stage, wasIncoming = o.incoming;
      if ("dlv" in b && !DLV_STATES.includes(b.dlv)) return send(res, 400, { error: "สถานะจัดส่งไม่ถูกต้อง" });
      for (const k of PATCHABLE) if (k in b) o[k] = b[k];
      if ("actualKg" in b && o.input) {            // ชั่งน้ำหนักจริง → คิดราคาใหม่ทั้งออเดอร์
        const owner = o.userId ? { id: o.userId } : null;
        const q = priceOrder({ ...o.input, kg: +b.actualKg }, owner, { actual: true, noPointCheck: true });
        Object.assign(o, { lines: q.lines, sub: q.sub, minTopUp: q.minTopUp, expressFee: q.expressFee, deliveryFee: q.deliveryFee, promoDisc: q.promoDisc, pointsUsed: q.pointsUsed, pointsDisc: q.pointsDisc, vat: q.vat, price: q.total, actualKg: +b.actualKg });
      }
      o.updated = Date.now(); saveOrder(o);
      if (wasIncoming && o.incoming === false) notifyStage(o, "accepted");
      if (prevStage < 4 && o.stage === 4) notifyStage(o, "ready");
      return send(res, 200, o);
    }
    if (om && m === "DELETE") { const o = getOrder(om[1]); (o?.photos || []).forEach(ph => fs.rm(path.join(PHOTOS, ph.file), () => {})); db.prepare("DELETE FROM orders WHERE id=?").run(om[1]); return send(res, 200, { ok: true }); }

    const pm = p.match(/^\/api\/orders\/([a-f0-9]+)\/photos(?:\/([a-f0-9]{16}\.jpg))?$/);
    if (pm && m === "POST" && !pm[2]) {                       // อัปโหลดรูป (ฝั่งเบราว์เซอร์ย่อเป็น JPEG แล้ว)
      const o = getOrder(pm[1]); if (!o) return send(res, 404, { error: "not found" });
      const b = await readBody(req), mm = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || "");
      if (!mm) return send(res, 400, { error: "ต้องเป็นรูป JPEG" });
      const buf = Buffer.from(mm[1], "base64"); if (buf.length > 900e3) return send(res, 400, { error: "รูปใหญ่เกินไป" });
      if ((o.photos || []).length >= 12) return send(res, 400, { error: "แนบรูปได้สูงสุด 12 รูป" });
      const file = rand(8) + ".jpg"; fs.writeFileSync(path.join(PHOTOS, file), buf);
      (o.photos = o.photos || []).push({ file, kind: b.kind === "after" ? "after" : "before", at: Date.now(), note: String(b.note || "").slice(0, 100) });
      saveOrder(o); return send(res, 200, o);
    }
    if (pm && m === "DELETE" && pm[2]) {
      const o = getOrder(pm[1]); if (!o) return send(res, 404, { error: "not found" });
      o.photos = (o.photos || []).filter(ph => ph.file !== pm[2]); fs.rm(path.join(PHOTOS, pm[2]), () => {}); saveOrder(o); return send(res, 200, o);
    }
    return send(res, 404, { error: "no such api" });
  } catch (e) { console.error(e); return send(res, e.message === "bad json" ? 400 : 500, { error: e.message === "bad json" ? "bad json" : "server error" }); }
}

/* ================= ไฟล์หน้าเว็บ ================= */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg" };
const PUBLIC = new Set(["index.html", "order.html", "order.js", "track.html", "track.js", "account.html", "account.js", "admin.html", "admin.js", "style.css", "customer.css"]);
function serve(req, res, u) {
  let f = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  const sec = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "same-origin" };
  if (/^photos\/[a-f0-9]{16}\.jpg$/.test(f)) {
    return fs.readFile(path.join(PHOTOS, path.basename(f)), (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { ...sec, "content-type": "image/jpeg", "cache-control": "private, max-age=86400" }); res.end(data); });
  }
  if (f === "") f = "index.html";
  if (f === "admin" || f === "staff") f = "admin.html";
  if (!PUBLIC.has(f)) { res.writeHead(404); return res.end("not found"); }
  fs.readFile(path.join(__dirname, f), (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { ...sec, "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); res.end(data);
  });
}

if (require.main === module) {
  http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/api/")) return api(req, res, u);
    serve(req, res, u);
  }).listen(PORT, "0.0.0.0", () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === "IPv4" && !i.internal).map(i => i.address);
    console.log(`\n🫧 ร้านซักผ้ารันแล้ว\n  ลูกค้า:    http://localhost:${PORT}/\n  เจ้าของ:   http://localhost:${PORT}/admin  (ครั้งแรกจะให้ตั้งรหัสผ่าน)`);
    ips.forEach(ip => console.log(`  ในวง Wi-Fi เดียวกัน: http://${ip}:${PORT}/`));
  });
}
module.exports = { priceOrder, lineVerify };
