/* หน้าสั่งของลูกค้า — ราคาจริงคำนวณที่เซิร์ฟเวอร์ (/api/quote) ที่นี่แสดงตัวเลขประมาณให้ดูระหว่างเลือก */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const baht = n => "฿" + Math.round(n).toLocaleString("th-TH");
const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const J = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const root = $("#root"), bar = $("#bar");

let CAT, SET, ME = null, POINTS = 0;
let svc = "iron";                 // แท็บที่เลือก: id บริการรายชิ้น | "wash" | "weight"
let cart = {};                    // "itemId|svc" -> จำนวน
let washes = [];                  // [{fabric,tier,loads,addons[]}]
let kg = 0;
let form = Object.assign({ name: "", phone: "", delivery: false, zone: "", express: false, slot: "", note: "", promo: "", stain: 0, points: 0 }, ls.get("cust", {}));
form.addr = Object.assign({ recipient: "", phone: "", house: "", building: "", street: "", subdistrict: "", landmark: "", dropoff: "", courierNote: "", mapUrl: "", lat: "", lon: "" }, ls.get("addr", {}));
form.points = 0;

const tierOf = id => CAT.wash.tiers.find(t => t.id === id);
const fabOf = id => CAT.wash.fabrics.find(f => f.id === id);
const addonOf = id => CAT.wash.addons.find(a => a.id === id);
const washPer = w => tierOf(w.tier).price + (fabOf(w.fabric).extraPerLoad || 0) + w.addons.reduce((a, x) => a + addonOf(x).price, 0);
const subtotal = () => {
  let t = 0, n = 0;
  for (const [k, q] of Object.entries(cart)) {
    const [id, s] = k.split("|");
    for (const c of CAT.categories) { const it = c.items.find(i => i.id === id); if (it && it[s] > 0) { t += it[s] * q; n += q; } }
  }
  washes.forEach(w => { t += washPer(w) * w.loads; n += 0; });
  if (kg > 0 && CAT.weight.enabled) t += Math.round(Math.max(kg, CAT.weight.minKg) * CAT.weight.perKg);
  return { t, n };
};
const washLoadsTotal = () => washes.reduce((a, w) => a + w.loads, 0);
function paintBar() {
  const { t, n } = subtotal(), wl = washLoadsTotal();
  bar.hidden = !(n || kg || wl);
  $("#tTotal").textContent = baht(t);
  $("#tCount").textContent = [n ? `${n} ชิ้น` : "", wl ? `ซักเครื่อง ${wl} รอบ` : "", kg ? `ชั่งกิโล ~${kg} กก.` : ""].filter(Boolean).join(" + ") + " (ยังไม่รวมค่าบริการเพิ่มเติม)";
}

async function init() {
  try {
    const r = await (await fetch("/api/catalog")).json(); CAT = r.catalog; SET = r.settings;
    const me = await (await fetch("/api/me")).json();
    if (me.user) { ME = me.user; POINTS = me.points; form.name = form.name || ME.name; form.phone = ME.phone; }
  } catch { root.innerHTML = `<div class="err">ติดต่อเซิร์ฟเวอร์ไม่ได้ — เปิดโดยรัน <code>node server.js</code> ก่อน</div>`; return; }
  $("#shop").textContent = "🫧 " + SET.shop;
  $("#sub").textContent = `เปิด ${SET.hours}${SET.phone ? " · โทร " + SET.phone : ""}`;
  $("#acct").innerHTML = ME ? `<a href="account.html">👤 ${esc(ME.name)} · ⭐${POINTS}</a>` : `<a href="account.html?next=/">เข้าสู่ระบบ / สมัคร</a>`;
  pickView();
}

/* ---------- 1) เลือกรายการ ---------- */
function pickView() {
  bar.hidden = true; $("#next").textContent = "ถัดไป →"; $("#next").onclick = checkoutView;
  const mine = ls.get("myOrders", []), last = ls.get("lastCart", null);
  root.innerHTML = `
    ${mine.length && !ME ? `<div class="mine" style="margin-top:12px"><div class="hint">ออเดอร์ล่าสุดในเครื่องนี้</div>${mine.slice(0, 3).map(o => `<a href="track.html?t=${o.token}"><span>คิว #${o.no}</span><span>ดูสถานะ →</span></a>`).join("")}</div>` : ""}
    ${!ME ? `<div class="hint" style="margin-top:10px">💡 <a href="account.html?next=/">สมัครสมาชิก</a> เพื่อสะสมแต้ม ดูประวัติ และรับแจ้งเตือนทาง LINE</div>` : ""}
    ${last ? `<button class="btn o" id="again" style="width:100%;margin-top:10px">🔁 สั่งซ้ำเหมือนครั้งก่อน</button>` : ""}
    <div class="chips" id="chips">
      ${CAT.wash.enabled ? `<button class="chip" data-s="wash">🌀 ซักเครื่อง</button>` : ""}
      ${CAT.services.map(s => `<button class="chip" data-s="${s.id}">${s.name}</button>`).join("")}
      ${CAT.weight.enabled ? `<button class="chip" data-s="weight">⚖️ ชั่งกิโล</button>` : ""}
    </div>
    <div id="list"></div>`;
  if (!CAT.wash.enabled && svc === "wash") svc = "iron";
  $("#chips").onclick = e => { const b = e.target.closest(".chip"); if (b) { svc = b.dataset.s; paintList(); } };
  if (last) $("#again").onclick = () => { cart = last.cart || {}; washes = last.washes || []; kg = last.kg || 0; paintList(); paintBar(); window.scrollTo(0, 0); };
  paintList(); paintBar();
}

function paintList() {
  document.querySelectorAll("#chips .chip").forEach(c => c.classList.toggle("on", c.dataset.s === svc));
  const list = $("#list");
  if (svc === "wash") return washView(list);
  if (svc === "weight") {
    const w = CAT.weight;
    list.innerHTML = `<div class="card"><h2>⚖️ ${esc(w.name)}</h2>
      <p>${baht(w.perKg)} / กก. · ขั้นต่ำ ${w.minKg} กก.<br><span class="hint">ใส่น้ำหนักโดยประมาณ ร้านจะชั่งจริงตอนรับผ้าและคิดตามน้ำหนักจริง</span></p>
      <div class="st"><button id="kgm">−</button><b id="kgv" style="min-width:90px">${kg} กก.</b><button id="kgp">+</button></div></div>`;
    const set = v => { kg = Math.max(0, Math.min(50, Math.round(v * 2) / 2)); $("#kgv").textContent = kg + " กก."; paintBar(); };
    $("#kgm").onclick = () => set(kg - 0.5); $("#kgp").onclick = () => set(kg + (kg === 0 ? w.minKg : 0.5));
    return;
  }
  list.innerHTML = CAT.categories.map(c => `<div class="cat">${c.icon} ${esc(c.name)}</div>` + c.items.map(it => {
    const p = it[svc], key = it.id + "|" + svc, q = cart[key] || 0;
    return `<div class="it ${p > 0 ? "" : "off"}" data-k="${key}"><span class="nm">${esc(it.name)}</span>
      ${p > 0 ? `<span class="pr">${baht(p)}</span><span class="st"><button data-d="-1" ${q ? "" : "disabled"}>−</button><b>${q}</b><button data-d="1">+</button></span>` : `<span class="hint">ไม่มีบริการนี้</span>`}</div>`;
  }).join("")).join("") + `<p class="hint" style="margin-top:14px">เลือกได้หลายบริการ — สลับแท็บด้านบนแล้วเพิ่มรายการต่อได้ ตะกร้าไม่หาย</p>`;
  list.onclick = e => {
    const b = e.target.closest("button[data-d]"); if (!b) return;
    const row = b.closest(".it"), k = row.dataset.k;
    cart[k] = Math.max(0, Math.min(99, (cart[k] || 0) + +b.dataset.d)); if (!cart[k]) delete cart[k];
    row.querySelector("b").textContent = cart[k] || 0; row.querySelector("button[data-d='-1']").disabled = !cart[k];
    paintBar();
  };
}

/* ---------- ซักเครื่อง: เลือกชนิดผ้า → ขนาดเครื่อง (เรทราคา) → จำนวนรอบ → แอดออน ---------- */
let wd = { fabric: null, tier: null, loads: 1, addons: [], amount: "" };
function washView(list) {
  const W = CAT.wash;
  const fab = wd.fabric && fabOf(wd.fabric);
  const tiers = fab ? fab.tiers.map(tierOf).filter(Boolean) : [];
  if (fab && !tiers.some(t => t.id === wd.tier)) wd.tier = tiers[0]?.id;
  const tier = wd.tier && tierOf(wd.tier);
  // แนะนำจำนวนรอบจากน้ำหนัก/จำนวนชิ้น
  const suggest = () => {
    const a = +wd.amount; if (!fab || !tier || !(a > 0)) return 0;
    return fab.unit === "kg" ? Math.ceil(a / (tier.cap * fab.fill)) : Math.ceil(a / (fab.perLoad?.[tier.id] || 1));
  };
  const per = fab && tier ? tier.price + (fab.extraPerLoad || 0) + wd.addons.reduce((a, x) => a + addonOf(x).price, 0) : 0;
  list.innerHTML = `
    <div class="card"><h2>1) เลือกชนิดผ้า</h2>
      <div class="fabs">${W.fabrics.map(f => `<button class="fab ${wd.fabric === f.id ? "on" : ""}" data-f="${f.id}"><span style="font-size:26px">${f.icon}</span><b>${esc(f.name)}</b><small>${esc(f.note || "")}</small></button>`).join("")}</div></div>
    ${fab ? `<div class="card"><h2>2) เลือกขนาดเครื่อง <span class="hint">(ราคาต่อรอบ)</span></h2>
      ${tiers.map(t => `<label class="tier ${wd.tier === t.id ? "on" : ""}"><input type="radio" name="tier" value="${t.id}" ${wd.tier === t.id ? "checked" : ""}>
        <span><b>${esc(t.name)}</b><br><small>ใส่ได้ ~${t.cap} กก. · ใช้เวลา ~${t.minutes} นาที${fab.unit === "piece" ? ` · ${fab.perLoad?.[t.id] || 1} ชิ้น/รอบ` : ` · ผ้านี้แนะนำไม่เกิน ${Math.floor(t.cap * fab.fill)} กก./รอบ`}</small></span>
        <span class="pr">${baht(t.price + (fab.extraPerLoad || 0))}<small>/รอบ</small></span></label>`).join("")}
      ${fab.extraPerLoad ? `<p class="hint">รวมค่าโปรแกรมถนอมผ้า +${baht(fab.extraPerLoad)}/รอบ แล้ว</p>` : ""}</div>
    <div class="card"><h2>3) จำนวนรอบ</h2>
      <label>${fab.unit === "kg" ? "น้ำหนักผ้าโดยประมาณ (กก.) — ให้ระบบแนะนำจำนวนรอบ" : "จำนวนชิ้น — ให้ระบบแนะนำจำนวนรอบ"}</label>
      <input id="amt" type="number" min="0" step="${fab.unit === "kg" ? 0.5 : 1}" value="${wd.amount}" placeholder="${fab.unit === "kg" ? "เช่น 8" : "เช่น 2"}">
      <p class="hint" id="sug">${suggest() ? `แนะนำ ${suggest()} รอบ` : "ไม่แน่ใจ ใส่ 1 รอบไว้ก่อนได้ ร้านจะปรับให้ตามจริง"}</p>
      <div class="st"><button id="lm">−</button><b id="lv" style="min-width:90px">${wd.loads} รอบ</b><button id="lp">+</button>${suggest() ? `<button class="chip" id="useSug" style="width:auto;height:auto;border-radius:99px;color:var(--ink);background:var(--card)">ใช้ที่แนะนำ</button>` : ""}</div></div>
    <div class="card"><h2>4) บริการเสริม <span class="hint">(ต่อรอบ)</span></h2>
      ${W.addons.map(a => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" style="width:auto" data-ad="${a.id}" ${wd.addons.includes(a.id) ? "checked" : ""}> ${esc(a.name)} <span class="pr" style="margin-left:auto">+${baht(a.price)}</span></label>`).join("")}</div>
    <button class="btn g" id="addWash" style="width:100%">＋ เพิ่มลงตะกร้า (${baht(per * wd.loads)})</button>` : ""}
    ${washes.length ? `<div class="card"><h2>🧺 ซักเครื่องในตะกร้า</h2>${washes.map((w, i) => `<div class="it" style="margin:4px 0"><span class="nm">${fabOf(w.fabric).icon} ${esc(fabOf(w.fabric).name)}<br><small class="hint">${esc(tierOf(w.tier).name)} × ${w.loads} รอบ${w.addons.length ? " · " + w.addons.map(a => esc(addonOf(a).name)).join(", ") : ""}</small></span><span class="pr">${baht(washPer(w) * w.loads)}</span><button class="chip" data-rm="${i}" style="padding:4px 10px">ลบ</button></div>`).join("")}</div>` : ""}
    <p class="hint">เครื่องซักแต่ละขนาดคิดราคาต่อรอบ ผ้านวมหนาควรใช้เครื่องจัมโบ้ เพื่อให้สะอาดและไม่พังเครื่อง</p>`;
  list.onclick = e => {
    const f = e.target.closest("[data-f]"); if (f) { wd = { fabric: f.dataset.f, tier: null, loads: 1, addons: [], amount: "" }; return washView(list); }
    const rm = e.target.closest("[data-rm]"); if (rm) { washes.splice(+rm.dataset.rm, 1); washView(list); return paintBar(); }
    if (e.target.id === "lm") { wd.loads = Math.max(1, wd.loads - 1); $("#lv").textContent = wd.loads + " รอบ"; $("#addWash").textContent = `＋ เพิ่มลงตะกร้า (${baht(per * wd.loads)})`; }
    if (e.target.id === "lp") { wd.loads = Math.min(20, wd.loads + 1); $("#lv").textContent = wd.loads + " รอบ"; $("#addWash").textContent = `＋ เพิ่มลงตะกร้า (${baht(per * wd.loads)})`; }
    if (e.target.id === "useSug") { wd.loads = Math.min(20, suggest()); washView(list); }
    if (e.target.id === "addWash") { washes.push({ fabric: wd.fabric, tier: wd.tier, loads: wd.loads, addons: [...wd.addons] }); wd = { fabric: null, tier: null, loads: 1, addons: [], amount: "" }; washView(list); paintBar(); window.scrollTo(0, 0); }
  };
  list.onchange = e => {
    if (e.target.name === "tier") { wd.tier = e.target.value; washView(list); }
    if (e.target.dataset.ad) { const id = e.target.dataset.ad; wd.addons = e.target.checked ? [...wd.addons, id] : wd.addons.filter(x => x !== id); washView(list); }
    if (e.target.id === "amt") { wd.amount = e.target.value; washView(list); }
  };
}

/* ---------- 2) ชำระ/ข้อมูล ---------- */
function body() {
  const lines = Object.entries(cart).map(([k, qty]) => { const [id, s] = k.split("|"); return { id, svc: s, qty }; });
  washes.forEach(w => lines.push({ wash: true, ...w }));
  return { lines, kg, ...form, delivery: form.delivery && !!form.zone };   // ยังไม่เลือกโซน = ยังไม่คิดค่าส่ง
}
async function quote() { const r = await J("/api/quote", body()); return { ok: r.ok, ...(await r.json()) }; }
async function checkoutView() {
  bar.hidden = true; window.scrollTo(0, 0);
  const canDeliver = SET.deliveryEnabled && SET.zones.length > 0, A = form.addr, zoneOf = id => SET.zones.find(z => z.id === id);
  const fld = (k, label, ph = "", extra = "") => `<label>${label}</label><input data-a="${k}" value="${esc(A[k])}" placeholder="${ph}" ${extra}>`;
  root.innerHTML = `
    <p style="margin-top:12px"><button class="btn o" id="back" style="padding:6px 14px">← กลับไปแก้รายการ</button></p>
    <div class="card"><h2>👤 ข้อมูลของคุณ</h2>
      <label>ชื่อ</label><input id="name" autocomplete="name" value="${esc(form.name)}">
      <label>เบอร์โทร <span class="hint">(ใช้เช็กสถานะ)</span></label><input id="phone" inputmode="tel" autocomplete="tel" value="${esc(form.phone)}" ${ME ? "readonly" : ""}></div>
    <div class="card"><h2>🚚 วิธีส่งผ้า</h2>
      <div class="seg"><button class="chip" data-v="0">🏪 เอามาที่ร้านเอง</button>${canDeliver ? `<button class="chip" data-v="1">🛵 ให้ไปรับ-ส่งที่บ้าน</button>` : ""}</div>
      ${!canDeliver ? `<p class="hint">ขณะนี้ร้านยังไม่เปิดบริการรับ-ส่งถึงบ้าน</p>` : ""}
      <div id="dl" hidden>
        <p class="hint">🛵 ร้านรับ-ส่งเฉพาะพื้นที่ที่ระบุเท่านั้น ${esc(SET.deliveryNote)}</p>
        <label>พื้นที่จัดส่ง <span class="hint">(เลือกโซนที่ที่อยู่ของคุณอยู่)</span></label>
        <select id="zone"><option value="">— เลือกพื้นที่ —</option>${SET.zones.map(z => `<option value="${z.id}" ${form.zone === z.id ? "selected" : ""}>${esc(z.name)} · ค่าส่ง ${baht(z.fee)}</option>`).join("")}</select>
        <div id="zinfo" class="hint"></div>
        <div id="addrBox" hidden>
          <label style="margin-top:14px">📍 ที่อยู่รับผ้า-ส่งผ้า</label>
          <button class="chip" id="gps" type="button">📍 ใช้ตำแหน่งปัจจุบัน (ช่วยกรอก)</button> <span class="hint" id="gpsMsg"></span>
          ${fld("recipient", "ชื่อผู้รับ", "ถ้าไม่ใช่ชื่อด้านบน")}${fld("phone", "เบอร์ผู้รับ/โทรได้", "เบอร์ที่พนักงานโทรติดต่อ", 'inputmode="tel"')}
          ${fld("house", "บ้านเลขที่ / ห้อง *", "เช่น 12/3 หรือ ห้อง 504")}${fld("building", "หมู่บ้าน / อาคาร / ชั้น", "เช่น คอนโดสุขสบาย ชั้น 5")}
          ${fld("street", "ซอย / ถนน *", "เช่น ซอยสุขุมวิท 22")}${fld("subdistrict", "แขวง/ตำบล เขต/อำเภอ", "")}
          ${fld("landmark", "จุดสังเกตใกล้เคียง", "เช่น ตรงข้าม 7-11 ปากซอย")}
          <label>วิธีส่งมอบผ้า</label><select data-a="dropoff"><option value="">— เลือก —</option>${SET.dropoffOptions.map(s => `<option ${A.dropoff === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
          <label>ช่วงเวลาที่สะดวก *</label><select id="slot"><option value="">— เลือก —</option>${SET.slots.map(s => `<option ${form.slot === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
          <label>ข้อความถึงพนักงานส่ง</label><textarea data-a="courierNote" rows="2" placeholder="เช่น มีสุนัข กดกริ่งสองครั้ง รหัสประตู 1234">${esc(A.courierNote)}</textarea>
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="saveAddr" style="width:auto" checked> จำที่อยู่นี้ไว้ใช้ครั้งหน้า</label></div></div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="exp" style="width:auto" ${form.express ? "checked" : ""}> ⚡ งานด่วน (เสร็จใน ~${SET.expressHours} ชม.) +${SET.expressPct}% (ขั้นต่ำ ${baht(SET.expressMin)})</label></div>
    <div class="card"><h2>📝 รายละเอียดเพิ่มเติม</h2>
      <label>มีผ้าที่มีคราบพิเศษกี่ชิ้น? <span class="hint">(+${baht(SET.stainFee)}/ชิ้น)</span></label><input id="stain" type="number" min="0" value="${form.stain || 0}">
      <label>หมายเหตุ</label><textarea id="note" rows="2" placeholder="เช่น มีคราบกาแฟที่เสื้อตัวขาว">${esc(form.note)}</textarea>
      <label>โค้ดส่วนลด</label><div style="display:flex;gap:8px"><input id="promo" placeholder="โค้ดส่วนลด" value="${esc(form.promo)}"><button class="btn o" id="applyPromo" style="padding:8px 14px">ใช้โค้ด</button></div>
      ${ME ? `<label>⭐ ใช้แต้ม <span class="hint">(คุณมี ${POINTS} แต้ม · ${SET.redeemStep} แต้ม = ${baht(SET.redeemBaht)} · ลดได้ไม่เกิน ${SET.maxRedeemPct}% ของยอด)</span></label>
      <div style="display:flex;gap:8px"><input id="pts" type="number" min="0" step="${SET.redeemStep}" value="${form.points || 0}"><button class="btn o" id="maxPts" style="padding:8px 14px">ใช้สูงสุด</button></div>` : `<p class="hint">🔒 <a href="account.html?next=/">เข้าสู่ระบบ</a> เพื่อใช้แต้มสะสมเป็นส่วนลด</p>`}</div>
    <div class="card sum" id="sum"></div>
    <div id="msg"></div>
    <button class="btn g" id="submit" style="width:100%;font-size:19px">✅ ยืนยันสั่งซัก</button>
    <p class="hint">ชำระเงินตอนรับผ้าคืน (เงินสด/โอน/พร้อมเพย์) · ราคาที่ชั่งกิโลเป็นราคาประมาณ ร้านจะชั่งจริงและแจ้งหากต่างจากนี้</p>`;
  const sync = () => {
    form.name = $("#name").value; form.phone = $("#phone").value; form.slot = $("#slot").value; form.zone = $("#zone").value;
    form.express = $("#exp").checked; form.note = $("#note").value; form.promo = $("#promo").value; form.stain = +$("#stain").value || 0;
    if (ME) form.points = +$("#pts").value || 0;
    root.querySelectorAll("[data-a]").forEach(el => (A[el.dataset.a] = el.value));
    ls.set("cust", { name: form.name, phone: ME ? "" : form.phone });
  };
  const paintSeg = () => {
    document.querySelectorAll(".seg .chip").forEach(c => c.classList.toggle("on", (c.dataset.v === "1") === form.delivery));
    $("#dl").hidden = !form.delivery;
    const z = zoneOf(form.zone);
    $("#addrBox").hidden = !z;
    $("#zinfo").innerHTML = z ? `ค่าส่ง ${baht(z.fee)}${z.freeOver ? ` · ส่งฟรีเมื่อยอดตั้งแต่ ${baht(z.freeOver)}` : ""}${z.minOrder ? ` · ยอดขั้นต่ำ ${baht(z.minOrder)}` : ""}${z.note ? `<br>${esc(z.note)}` : ""}` : "ไม่เห็นพื้นที่ของคุณ? แปลว่าร้านยังไปส่งไม่ถึง — เอามาที่ร้านได้ค่ะ";
  };
  async function refresh() {
    sync(); paintSeg();
    const q = await quote();
    if (!q.ok) { $("#sum").innerHTML = ""; $("#msg").innerHTML = `<div class="err">${esc(q.error)}</div>`; return false; }
    $("#msg").innerHTML = "";
    const row = (a, b, cls = "") => `<div class="${cls}"><span>${a}</span><span>${b}</span></div>`;
    $("#sum").innerHTML = q.lines.map(l => row(`${esc(l.name)} <small>${l.svc === "weight" ? `~${l.qty} กก.` : l.wash ? esc(l.svcName) + (l.addonNames.length ? " + " + l.addonNames.map(esc).join(", ") : "") : `${esc(l.svcName)} × ${l.qty}`}</small>`, baht(l.amount))).join("")
      + (q.stainFee ? row(`🧼 ค่าซักคราบพิเศษ <small>${q.stainPieces} ชิ้น</small>`, baht(q.stainFee)) : "")
      + (q.minTopUp ? row(`📏 ปรับเป็นยอดขั้นต่ำ <small>(ขั้นต่ำ ${baht(SET.minOrder)})</small>`, "+" + baht(q.minTopUp)) : "")
      + (q.expressFee ? row("⚡ งานด่วน", "+" + baht(q.expressFee)) : "")
      + (q.deliveryFee ? row("🛵 ค่ารับ-ส่ง", "+" + baht(q.deliveryFee)) : (q.delivery ? row("🛵 ค่ารับ-ส่ง", "ฟรี") : ""))
      + (q.promoDisc ? row(`🏷️ ส่วนลด ${esc(q.promo)}`, "−" + baht(q.promoDisc)) : "")
      + (q.pointsDisc ? row(`⭐ ใช้ ${q.pointsUsed} แต้ม`, "−" + baht(q.pointsDisc)) : "")
      + row("รวมทั้งสิ้น", baht(q.total), "t")
      + (q.vat ? `<small>รวมภาษีมูลค่าเพิ่ม ${SET.vatPct}% แล้ว (VAT ${q.vat.toFixed(2)} บาท)</small><br>` : "")
      + (q.lines.some(l => l.estimate) ? `<small>* ส่วนชั่งกิโลเป็นราคาประมาณ ร้านจะชั่งจริงอีกครั้ง</small>` : "");
    window.__q = q; return true;
  }
  $("#back").onclick = pickView;
  document.querySelectorAll(".seg .chip").forEach(c => c.onclick = () => { form.delivery = c.dataset.v === "1"; refresh(); });
  ["#exp", "#slot", "#stain", "#zone"].forEach(s => $(s).onchange = refresh);
  if (ME) { $("#pts").onchange = refresh; $("#maxPts").onclick = () => { $("#pts").value = POINTS; refresh(); }; }
  $("#applyPromo").onclick = async () => { await refresh(); if (form.promo && !$("#msg").innerHTML) $("#msg").innerHTML = `<div class="ok">ใช้โค้ดแล้ว</div>`; };
  root.addEventListener("input", sync);
  $("#gps").onclick = () => {
    if (!navigator.geolocation) return;
    $("#gpsMsg").textContent = "⏳ กำลังหาตำแหน่ง…";
    navigator.geolocation.getCurrentPosition(async pos => {
      const la = pos.coords.latitude.toFixed(5), lo = pos.coords.longitude.toFixed(5);
      A.lat = la; A.lon = lo; A.mapUrl = `https://maps.google.com/?q=${la},${lo}`;
      try {   // เติมซอย/ถนน/แขวง ให้ถ้าช่องยังว่าง (ส่งพิกัดไป OpenStreetMap เพื่อแปลงเป็นที่อยู่)
        const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=th&addressdetails=1&lat=${la}&lon=${lo}`)).json(), a = j.address || {};
        const set = (k, v) => { if (v && !A[k]) { A[k] = v; root.querySelector(`[data-a="${k}"]`).value = v; } };
        set("house", a.house_number); set("street", a.road); set("subdistrict", [a.suburb || a.quarter, a.city_district || a.county].filter(Boolean).join(" "));
      } catch {}
      $("#gpsMsg").textContent = `✅ ได้ตำแหน่งแล้ว (ตรวจและแก้ไขช่องด้านล่างให้ถูกต้อง) — ตำแหน่งที่ส่งให้พนักงานดูแผนที่ด้วย`;
    }, () => { $("#gpsMsg").textContent = "หาตำแหน่งไม่ได้ — กรอกเอง"; }, { enableHighAccuracy: true, timeout: 10000 });
  };
  $("#submit").onclick = async e => {
    if (!(await refresh())) return;
    if (!form.name.trim()) return ($("#msg").innerHTML = `<div class="err">กรุณากรอกชื่อ</div>`, $("#name").focus());
    if (form.phone.replace(/\D/g, "").length < 9) return ($("#msg").innerHTML = `<div class="err">กรุณากรอกเบอร์โทร</div>`, $("#phone").focus());
    if (form.delivery) {
      const need = !form.zone ? "กรุณาเลือกพื้นที่จัดส่ง" : !A.house.trim() ? "กรุณากรอกบ้านเลขที่/ห้อง" : !(A.street.trim() || A.landmark.trim()) ? "กรุณากรอกซอย/ถนน หรือจุดสังเกต" : !form.slot ? "กรุณาเลือกช่วงเวลารับ-ส่ง" : "";
      if (need) return ($("#msg").innerHTML = `<div class="err">${need}</div>`);
      if ($("#saveAddr").checked) ls.set("addr", { ...A, lat: "", lon: "", mapUrl: "" });
    }
    e.target.disabled = true; e.target.textContent = "กำลังส่ง…";
    const r = await J("/api/orders", body()), j = await r.json();
    if (!r.ok) { e.target.disabled = false; e.target.textContent = "✅ ยืนยันสั่งซัก"; return ($("#msg").innerHTML = `<div class="err">${esc(j.error)}</div>`); }
    ls.set("lastCart", { cart, washes, kg });
    ls.set("myOrders", [{ no: j.no, token: j.token }, ...ls.get("myOrders", [])].slice(0, 10));
    cart = {}; washes = []; kg = 0; form.points = 0; doneView(j);
  };
  refresh();
}

/* ---------- 3) สำเร็จ ---------- */
function doneView(j) {
  window.scrollTo(0, 0);
  const url = `${location.origin}/track.html?t=${j.token}`;
  root.innerHTML = `<div class="card ticket"><div style="font-size:48px">🎉</div><h2>สั่งซักเรียบร้อย</h2>
    <div class="hint">เลขคิวของคุณ</div><div class="no">#${j.no}</div>
    <p>ยอด <b>${baht(j.total)}</b> · คาดว่าเสร็จ ${new Date(j.due).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
    <a class="btn" href="track.html?t=${j.token}" style="width:100%">📍 ติดตามสถานะผ้า</a>
    <p><button class="btn o" id="cp">📋 คัดลอกลิงก์ติดตาม</button></p>
    <p class="hint">บันทึกลิงก์ไว้ ${ME ? "หรือดูในหน้า “บัญชีของฉัน”" : "หรือสมัครสมาชิกเพื่อเก็บประวัติและรับแต้ม"}</p>
    <button class="btn o" onclick="location.reload()">สั่งเพิ่ม</button></div>`;
  $("#cp").onclick = async e => { try { await navigator.clipboard.writeText(url); e.target.textContent = "✓ คัดลอกแล้ว"; } catch { prompt("คัดลอกลิงก์นี้", url); } };
}

init();
