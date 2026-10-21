/* หน้าเจ้าของร้าน (admin) — ต้องล็อกอินด้วยบัญชีเจ้าของร้าน ข้อมูลทั้งหมดอยู่ในฐานข้อมูลเซิร์ฟเวอร์ */
const STAGES = ["รับผ้า", "ซัก", "อบ", "รีด/พับ", "พร้อมรับ", "รับแล้ว"];
const DLV = { wait_pickup: { label: "รอไปรับผ้า", next: "picked" }, picked: { label: "รับผ้าแล้ว", next: "out" }, out: { label: "กำลังนำส่ง", next: "delivered" }, delivered: { label: "ส่งถึงมือแล้ว", next: "delivered" } };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const baht = n => "฿" + Math.round(n).toLocaleString("th-TH");
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = ms => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const dtfmt = t => new Date(t).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const unitOf = o => o.unit || (/ต่อ/.test(o.service) ? "ชิ้น" : "กก.");
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2400); }

let S = { machines: [], orders: [], settings: { shop: "", grace: 10, speed: 1, sound: true, programs: { washer: [], dryer: [] }, services: [], promos: [], line: {}, cost: {} }, catalog: { weight: {}, wash: { tiers: [], fabrics: [], addons: [] }, services: [], categories: [] } };
let saving = 0, pushT = null, seenIncoming = null, lastSig = "", lastCfg = "";

/* ---------- เชื่อมเซิร์ฟเวอร์ ---------- */
const apiF = (path, opt = {}) => fetch(path, { ...opt, headers: { "content-type": "application/json", ...opt.headers } });
const post = (path, body) => apiF(path, { method: "POST", body: JSON.stringify(body || {}) });
function save() {
  clearTimeout(pushT);
  pushT = setTimeout(async () => {
    pushT = null; saving++;
    try { await apiF("/api/state", { method: "PUT", body: JSON.stringify({ machines: S.machines, settings: S.settings, catalog: S.catalog }) }); lastCfg = ""; } catch {}
    saving--;
  }, 300);
}
async function patch(o, fields) {
  Object.assign(o, fields, { updated: Date.now() });
  try { const r = await apiF("/api/orders/" + o.id, { method: "PATCH", body: JSON.stringify(fields) }); if (r.ok) Object.assign(o, await r.json()); } catch {}
}
async function pull() {
  let j;
  try { const r = await apiF("/api/state"); if (r.status === 401) return authView(); j = await r.json(); } catch { return; }
  S.orders = j.orders;
  const page0 = location.hash.replace("#/", "") || "machines";
  if (!saving && !pushT) {
    S.machines = j.machines;
    // ตั้งค่า/แคตตาล็อก: แทนที่เฉพาะเมื่อเซิร์ฟเวอร์ต่างจากที่เรารู้ และไม่ได้อยู่หน้าที่กำลังแก้ (ไม่งั้นตัวแปรที่หน้าตั้งค่าถืออยู่จะกลายเป็นของเก่า)
    const cfg = JSON.stringify([j.settings, j.catalog]);
    if (cfg !== lastCfg && !["settings", "cost"].includes(page0)) { S.settings = j.settings; S.catalog = j.catalog; lastCfg = cfg; }
  }
  const inc = j.orders.filter(o => o.incoming);
  if (seenIncoming) {
    const fresh = inc.filter(o => !seenIncoming.has(o.id));
    if (fresh.length) { beep(4); toast(`🆕 ออเดอร์ใหม่จากลูกค้า #${fresh[0].no} ${fresh[0].name}`); try { if ("Notification" in window && Notification.permission === "granted") new Notification("🫧 ออเดอร์ใหม่ #" + fresh[0].no); } catch {} }
  }
  seenIncoming = new Set(inc.map(o => o.id));
  const sig = JSON.stringify([j.orders, j.machines]), page = location.hash.replace("#/", "") || "machines";
  if (sig !== lastSig) { lastSig = sig; if (!["settings", "cost"].includes(page) && !$("#dlg").open) route(); }
}

/* ---------- ล็อกอิน / ตั้งรหัสครั้งแรก ---------- */
async function boot() {
  let st;
  try { st = await (await fetch("/api/admin/status")).json(); } catch { $("#app").innerHTML = `<div class="card"><h2>ติดต่อเซิร์ฟเวอร์ไม่ได้</h2><p>เปิดหน้านี้ผ่านเซิร์ฟเวอร์: รัน <code>node server.js</code> แล้วเข้า <code>http://localhost:8080/admin</code></p></div>`; return; }
  if (st.setup) return authView(true);
  if (!st.loggedIn) return authView(false);
  await start();
}
function authView(setup, err = "") {
  clearInterval(authView.poll); document.body.classList.add("locked");
  $("#alerts").innerHTML = ""; $("#nav").hidden = true;
  $("#app").innerHTML = `<div class="card" style="max-width:420px;margin:30px auto"><h2>${setup ? "🔐 ตั้งบัญชีเจ้าของร้าน (ครั้งแรก)" : "🔒 เข้าสู่ระบบเจ้าของร้าน"}</h2>
    ${setup ? `<p class="hint">สร้างชื่อผู้ใช้และรหัสผ่านสำหรับเจ้าของร้านเพียงคนเดียว ลูกค้าจะเข้าหน้านี้ไม่ได้</p>` : ""}
    <label>ชื่อผู้ใช้</label><input id="lg" autocomplete="username" autocapitalize="off">
    <label>รหัสผ่าน ${setup ? '<span class="hint">(อย่างน้อย 8 ตัว)</span>' : ""}</label><input id="pw" type="password" autocomplete="${setup ? "new-password" : "current-password"}">
    ${err ? `<div class="alert r" style="margin:8px 0">${esc(err)}</div>` : ""}
    <p><button class="btn" id="go" style="width:100%">${setup ? "สร้างบัญชี" : "เข้าสู่ระบบ"}</button></p>
    <p class="hint"><a href="/">← กลับไปเลือกบทบาท</a></p></div>`;
  const go = async () => {
    const r = await post(setup ? "/api/admin/setup" : "/api/admin/login", { login: $("#lg").value, password: $("#pw").value }), j = await r.json();
    if (!r.ok) return authView(setup, j.error);
    start();
  };
  $("#go").onclick = go; $("#pw").onkeydown = e => { if (e.key === "Enter") go(); };
}
async function start() {
  document.body.classList.remove("locked"); $("#nav").hidden = false;
  await pull(); clearInterval(start.t); start.t = setInterval(pull, 3000);
  route(); tick();
}

/* ---------- เสียง ---------- */
let actx;
function beep(times = 3) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * .3;
      o.frequency.value = i % 2 ? 660 : 880; g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.001, t + .25);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .26);
    }
  } catch {}
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
const stateOf = m => {
  if (m.status === "run") return Date.now() >= m.endAt ? (Date.now() - m.endAt > S.settings.grace * 60000 ? "late" : "done") : "run";
  return m.status;
};
const orderOf = id => S.orders.find(o => o.id === id);
const tierOf = id => S.catalog.wash.tiers.find(t => t.id === id);
const label = { idle: "ว่าง", run: "กำลังทำงาน", done: "เสร็จแล้ว!", late: "ลืมผ้า?", broken: "ซ่อม" };

/* ---------- router ---------- */
function route() {
  const page = location.hash.replace("#/", "") || "machines";
  document.body.classList.toggle("board", page === "board");
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.t === page));
  $("#shopName").textContent = "🫧 " + (S.settings.shop || "ร้านซักอบรีด");
  ({ machines: machinesView, orders: ordersView, customers: customersView, report: reportView, cost: costView, settings: settingsView, board: boardView }[page] || machinesView)();
}

/* ---------- ลูกค้าสมาชิก (เห็นได้เฉพาะเจ้าของร้าน) ---------- */
async function customersView() {
  $("#app").innerHTML = `<h1>👥 ลูกค้าสมาชิก</h1><p class="hint">กำลังโหลด…</p>`;
  const r = await apiF("/api/admin/customers"); if (r.status === 401) return authView(false);
  const rows = await r.json(), q = (location.hash.split("?q=")[1] || "");
  $("#app").innerHTML = `<div class="row"><h1 class="grow">👥 ลูกค้าสมาชิก <span class="hint">· ${rows.length} คน</span></h1><input id="q" placeholder="ค้นหาชื่อ/เบอร์" style="width:200px" value="${esc(decodeURIComponent(q))}"></div>
    <div class="tablewrap"><table><tr><th>ชื่อ</th><th>เบอร์</th><th>ออเดอร์</th><th>ยอดใช้จ่าย</th><th>แต้ม</th><th>LINE</th><th>ล่าสุด</th></tr>
    <tbody id="cb"></tbody></table></div><p class="hint">ลูกค้าที่ไม่ได้สมัครสมาชิก (สั่งแบบแขก) ดูได้ในหน้าออเดอร์</p>`;
  const draw = () => {
    const s = $("#q").value.trim().toLowerCase();
    $("#cb").innerHTML = rows.filter(c => !s || (c.name + c.phone).toLowerCase().includes(s)).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.orders}</td><td>${baht(c.spent)}</td><td>${c.points}</td><td>${c.line ? "✅" : "—"}</td><td>${c.last ? dtfmt(c.last) : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="hint">ไม่พบ</td></tr>`;
  };
  $("#q").oninput = draw; draw();
}
addEventListener("hashchange", () => { if (!document.body.classList.contains("locked")) route(); });

/* ---------- machines ---------- */
function machineCard(m, tv) {
  const st = stateOf(m), o = m.orderId ? orderOf(m.orderId) : null, t = m.tier && tierOf(m.tier);
  const total = m.endAt - m.startAt, pct = m.status === "run" ? Math.min(100, ((Date.now() - m.startAt) / total) * 100) : 0;
  const who = o ? `#${o.no} ${tv ? "" : esc(o.name)}` : esc(m.note || "");
  const big = st === "run" ? fmt(m.endAt - Date.now()) : st === "done" || st === "late" ? "เสร็จแล้ว" : st === "broken" ? "—" : "ว่าง";
  const over = (st === "done" || st === "late") ? `เกินมา ${fmt(Date.now() - m.endAt)}` : "";
  return `<div class="card mc ${st}" data-id="${m.id}">
    <div class="row"><span class="n">${m.type === "washer" ? "🌀" : "♨️"} ${esc(m.name)}</span>${t ? `<span class="tag idle">${baht(t.price)}</span>` : ""}<span class="grow"></span><span class="tag ${st}">${label[st]}</span></div>
    <div class="big">${big}</div>
    <div class="sub">${m.status === "run" || st === "done" ? esc(m.program) + " · " : ""}${who}${over ? " · " + over : ""}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    ${tv ? "" : `<div class="row" style="margin-top:10px">${
      st === "idle" ? `<button class="btn s" data-a="start">▶ เริ่ม</button><button class="btn s o" data-a="broken">🔧 ซ่อม</button>`
      : st === "broken" ? `<button class="btn s g" data-a="fix">กลับมาใช้</button>`
      : st === "run" ? `<button class="btn s o" data-a="add">+5 นาที</button><button class="btn s r" data-a="stop">หยุด</button>`
      : `<button class="btn s g" data-a="clear">✓ เก็บผ้าแล้ว</button>${m.type === "washer" ? `<button class="btn s" data-a="todry">→ ย้ายไปอบ</button>` : ""}`}</div>`}
  </div>`;
}
function machinesView() {
  const w = S.machines.filter(m => m.type === "washer"), d = S.machines.filter(m => m.type === "dryer");
  const free = S.machines.filter(m => stateOf(m) === "idle");
  $("#app").innerHTML = `
    <h1>เครื่องซัก-อบ <span class="hint">· ว่าง ${free.length}/${S.machines.length} เครื่อง</span></h1>
    <div class="sec">🌀 เครื่องซัก</div><div class="grid">${w.map(m => machineCard(m)).join("")}</div>
    <div class="sec">♨️ เครื่องอบ</div><div class="grid">${d.map(m => machineCard(m)).join("")}</div>
    <p class="hint">💡 เปิดแท็บนี้ค้างไว้หน้าร้าน ระบบจะส่งเสียงเตือนเมื่อซักเสร็จ ${S.settings.speed > 1 ? `<b style="color:var(--red)">· โหมดทดสอบ เร่งเวลา ×${S.settings.speed}</b>` : ""}</p>
    <button class="btn o" id="notif">🔔 เปิดการแจ้งเตือนของเบราว์เซอร์</button>`;
  $("#notif").onclick = async () => { if (!("Notification" in window)) return toast("เบราว์เซอร์ไม่รองรับ"); toast((await Notification.requestPermission()) === "granted" ? "เปิดแล้ว" : "ไม่ได้รับอนุญาต"); };
  $("#app").onclick = e => { const b = e.target.closest("[data-a]"); if (!b) return; machineAction(S.machines.find(x => x.id === b.closest(".mc").dataset.id), b.dataset.a); };
}
function machineAction(m, a) {
  if (a === "start") return startDialog(m);
  if (a === "broken") m.status = "broken";
  else if (a === "fix" || a === "clear") { m.status = "idle"; delete m.orderId; delete m.note; }
  else if (a === "stop") { if (!confirm("หยุดเครื่องนี้?")) return; m.status = "idle"; }
  else if (a === "add") { m.endAt += 5 * 60000 / S.settings.speed; m.notified = false; }
  else if (a === "todry") {
    const oid = m.orderId; m.status = "idle"; delete m.orderId; save();
    const dry = S.machines.find(x => x.type === "dryer" && stateOf(x) === "idle");
    if (!dry) { toast("ไม่มีเครื่องอบว่าง"); return render(); }
    return startDialog(dry, oid);
  }
  save(); render();
}
function startDialog(m, preOrder) {
  const progs = S.settings.programs[m.type], t = m.tier && tierOf(m.tier);
  const open = S.orders.filter(o => o.stage < 5);
  const needs = o => (o.lines || []).filter(l => l.wash).map(l => `${tierOf(l.tier)?.price || ""}฿×${l.loads}`).join(" ");
  const dlg = $("#dlg");
  dlg.innerHTML = `<h2>เริ่ม ${esc(m.name)} ${t ? `<span class="hint">(${esc(t.name)} · ${baht(t.price)}/รอบ)</span>` : ""}</h2>
    <label>โปรแกรม</label><select id="p">${progs.map((p, i) => `<option value="${i}">${esc(p.n)} (${p.min} นาที)</option>`).join("")}</select>
    <label>ผูกกับออเดอร์ (ถ้ามี)</label><select id="o"><option value="">— ไม่ผูก —</option>${open.map(o => `<option value="${o.id}" ${o.id === preOrder ? "selected" : ""}>#${o.no} ${esc(o.name)} · ${o.kg} ${unitOf(o)} ${needs(o)}</option>`).join("")}</select>
    <label>หมายเหตุ (กรณีลูกค้าเข้าเครื่องเอง)</label><input id="n" placeholder="เช่น คุณสมชาย เครื่อง 2">
    <div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn o" id="c">ยกเลิก</button><button class="btn" id="ok">เริ่มเลย</button></div>`;
  dlg.showModal();
  $("#c", dlg).onclick = () => dlg.close();
  $("#ok", dlg).onclick = () => {
    const p = progs[+$("#p", dlg).value], oid = $("#o", dlg).value;
    m.status = "run"; m.program = p.n; m.startAt = Date.now(); m.endAt = m.startAt + p.min * 60000 / S.settings.speed;
    m.orderId = oid || undefined; m.note = $("#n", dlg).value; m.notified = false;
    const o = oid && orderOf(oid);
    if (o) { const want = m.type === "washer" ? 1 : 2; if (o.stage < want) patch(o, { stage: want, incoming: false }); }
    save(); dlg.close(); render();
  };
}

/* ---------- orders ---------- */
function ordersView() {
  const open = S.orders.filter(o => o.stage < 5).sort((a, b) => a.due - b.due);
  const closed = S.orders.filter(o => o.stage === 5).sort((a, b) => b.updated - a.updated).slice(0, 15);
  const row = o => `<tr data-id="${o.id}">
    <td><b>#${o.no}</b></td>
    <td>${esc(o.name)}<br><span class="hint">${esc(o.phone || "")}${o.userId ? " · สมาชิก" : ""}</span></td>
    <td>${o.src === "customer" ? `<span class="tag run">ออนไลน์</span> ` : ""}${o.incoming ? `<span class="tag late">🆕 รอยืนยัน</span> ` : ""}${esc(o.service)}<br><span class="hint">${o.kg} ${unitOf(o)} · ${baht(o.price)} ${o.paid ? "✅จ่ายแล้ว" : "⏳ค้างจ่าย"}</span>
      ${(o.lines || []).length ? `<details><summary class="hint">ดูรายการ (${o.lines.length})</summary>${o.lines.map(l => `<div class="hint">• ${esc(l.name)} ${l.svc === "weight" ? "~" + l.qty + " กก." + (l.estimate ? " (ประมาณ)" : "") : l.wash ? esc(l.svcName) + (l.addonNames?.length ? " +" + l.addonNames.map(esc).join(",") : "") : esc(l.svcName) + " ×" + l.qty} = ${baht(l.amount)}</div>`).join("")}${o.minTopUp ? `<div class="hint">• ปรับเป็นยอดขั้นต่ำ +${baht(o.minTopUp)}</div>` : ""}${o.stainFee ? `<div class="hint">• ซักคราบ +${baht(o.stainFee)}</div>` : ""}${o.expressFee ? `<div class="hint">• ด่วน +${baht(o.expressFee)}</div>` : ""}${o.deliveryFee ? `<div class="hint">• ส่ง +${baht(o.deliveryFee)}</div>` : ""}${o.promoDisc ? `<div class="hint">• โค้ด −${baht(o.promoDisc)}</div>` : ""}${o.pointsDisc ? `<div class="hint">• แต้ม −${baht(o.pointsDisc)}</div>` : ""}</details>` : ""}
      ${o.delivery ? `<div class="hint" style="background:var(--bg);border-radius:8px;padding:6px 8px;margin:4px 0">🛵 <b>${esc(o.zone?.name || "รับ-ส่ง")}</b> · ${esc(o.pickupSlot || "")}<br>${o.addr ? `${esc(o.addr.recipient)} ☎ ${esc(o.addr.phone)}<br>${esc([o.addr.house, o.addr.building, o.addr.street, o.addr.subdistrict].filter(Boolean).join(" "))}${o.addr.landmark ? `<br>📌 ${esc(o.addr.landmark)}` : ""}${o.addr.dropoff ? `<br>วิธีส่งมอบ: ${esc(o.addr.dropoff)}` : ""}${o.addr.courierNote ? `<br>💬 ${esc(o.addr.courierNote)}` : ""}${o.addr.mapUrl ? `<br><a href="${esc(o.addr.mapUrl)}" target="_blank" rel="noopener">🗺️ เปิดแผนที่</a>` : ""}` : esc(o.address || "")}<br><b>สถานะส่ง: ${DLV[o.dlv || "wait_pickup"].label}</b></div>` : ""}${o.express ? `<div class="hint">⚡ งานด่วน</div>` : ""}${o.note ? `<div class="hint">📝 ${esc(o.note)}</div>` : ""}
      ${(o.photos || []).length ? `<div class="hint">📸 ${o.photos.length} รูป</div>` : ""}</td>
    <td><b>${STAGES[o.stage]}</b><div class="stages">${STAGES.map((_, i) => `<i class="${i < o.stage ? "on" : i === o.stage ? "cur" : ""}"></i>`).join("")}</div><span class="hint">นัดรับ ${dtfmt(o.due)}${Date.now() > o.due && o.stage < 4 ? " ⚠ เลยกำหนด" : ""}</span></td>
    <td>${o.incoming ? `<button class="btn s g" data-a="accept">✓ ยืนยันรับ</button> ` : ""}${o.stage < 5 ? `<button class="btn s" data-a="next">→ ${STAGES[o.stage + 1]}</button> ` : ""}
      ${!o.paid ? `<button class="btn s g" data-a="pay">รับเงิน</button> ` : ""}
      <button class="btn s o" data-a="photos">📸</button> ${(o.lines || []).some(l => l.svc === "weight") ? `<button class="btn s o" data-a="weigh">⚖ ชั่งจริง</button> ` : ""}
      ${o.delivery && o.dlv !== "delivered" ? `<button class="btn s g" data-a="dlv">🛵 ${DLV[DLV[o.dlv || "wait_pickup"].next].label}</button> ` : ""}${o.delivery ? `<button class="btn s o" data-a="slip">📄 ใบส่ง</button> ` : ""}<button class="btn s o" data-a="print">🖨</button> <button class="btn s o" data-a="msg">💬</button> <button class="btn s o" data-a="edit">แก้ไข</button></td></tr>`;
  $("#app").innerHTML = `
    <div class="row"><h1 class="grow">ออเดอร์ / คิวรับผ้า</h1><button class="btn" id="new">＋ รับผ้าใหม่ (หน้าร้าน)</button></div>
    <div class="tablewrap"><table><tr><th>คิว</th><th>ลูกค้า</th><th>บริการ</th><th>สถานะ</th><th></th></tr>
    ${open.map(row).join("") || `<tr><td colspan="5" class="hint">ยังไม่มีออเดอร์ค้าง</td></tr>`}</table></div>
    <div class="sec">ปิดงานล่าสุด</div>
    <div class="tablewrap"><table>${closed.map(row).join("") || `<tr><td class="hint">—</td></tr>`}</table></div>`;
  $("#new").onclick = () => orderDialog();
  $("#app").onclick = async e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const o = orderOf(b.closest("tr").dataset.id), a = b.dataset.a;
    if (a === "accept") await patch(o, { incoming: false });
    else if (a === "next") { await patch(o, { stage: o.stage + 1, incoming: false }); if (o.stage === 4) msgDialog(o); }
    else if (a === "pay") await patch(o, { paid: true, paidAt: Date.now() });
    else if (a === "weigh") return weighDialog(o);
    else if (a === "photos") return photoDialog(o);
    else if (a === "dlv") await patch(o, { dlv: DLV[o.dlv || "wait_pickup"].next });
    else if (a === "slip") return printSlip(o);
    else if (a === "print") return printTicket(o);
    else if (a === "msg") return msgDialog(o);
    else if (a === "edit") return orderDialog(o);
    render();
  };
}
function weighDialog(o) {
  const dlg = $("#dlg"), est = o.lines.find(l => l.svc === "weight");
  dlg.innerHTML = `<h2>⚖ น้ำหนักจริง คิว #${o.no}</h2><p class="hint">ลูกค้าประมาณไว้ ${est.qty} กก. ระบบจะคิดราคาทั้งออเดอร์ใหม่ (ยอดขั้นต่ำ ค่าด่วน ส่วนลด ปัดเศษ) ตามน้ำหนักจริง</p>
    <label>น้ำหนักที่ชั่งได้ (กก.)</label><input id="kg" type="number" step="0.1" value="${o.actualKg ?? est.qty}">
    <div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn o" id="c">ยกเลิก</button><button class="btn" id="ok">คิดราคาใหม่</button></div>`;
  dlg.showModal(); $("#c", dlg).onclick = () => dlg.close();
  $("#ok", dlg).onclick = async () => {
    const old = o.price;
    const r = await apiF("/api/orders/" + o.id, { method: "PATCH", body: JSON.stringify({ actualKg: +$("#kg", dlg).value }) });
    if (!r.ok) return toast("คิดราคาไม่สำเร็จ"); Object.assign(o, await r.json());
    dlg.close(); toast(`ยอดใหม่ ${baht(o.price)} (เดิม ${baht(old)})`); render();
  };
}
/* ถ่ายรูปก่อนซัก: ย่อเป็น JPEG ≤1280px ก่อนอัปโหลด */
const shrink = file => new Promise((ok, no) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", .8));
  };
  img.onerror = () => no(new Error("อ่านรูปไม่ได้")); img.src = url;
});
function photoDialog(o) {
  const dlg = $("#dlg");
  const draw = () => {
    dlg.innerHTML = `<h2>📸 รูปผ้า คิว #${o.no}</h2><p class="hint">ถ่ายก่อนซักเพื่อบันทึกสภาพผ้า (รอยขาด คราบ กระดุมหลุด) ลูกค้าเห็นรูปในหน้าติดตามสถานะ</p>
      <div class="gal2">${(o.photos || []).map(p => `<div><a href="/photos/${p.file}" target="_blank"><img src="/photos/${p.file}"></a><small>${p.kind === "after" ? "หลังซัก" : "ก่อนซัก"}</small><button class="btn s r" data-del="${p.file}">ลบ</button></div>`).join("") || '<span class="hint">ยังไม่มีรูป</span>'}</div>
      <div class="row" style="margin-top:10px"><label class="btn g" style="margin:0">📷 ก่อนซัก<input type="file" id="fb" accept="image/*" capture="environment" multiple hidden></label>
      <label class="btn o" style="margin:0">📷 หลังซัก<input type="file" id="fa" accept="image/*" capture="environment" multiple hidden></label><span class="grow"></span><button class="btn o" id="c">ปิด</button></div>`;
    $("#c", dlg).onclick = () => { dlg.close(); render(); };
    const up = kind => async e => {
      for (const f of e.target.files) {
        try { const r = await post(`/api/orders/${o.id}/photos`, { dataUrl: await shrink(f), kind }), j = await r.json(); if (!r.ok) { toast(j.error); break; } Object.assign(o, j); } catch (er) { toast(er.message); }
      }
      draw();
    };
    $("#fb", dlg).onchange = up("before"); $("#fa", dlg).onchange = up("after");
    dlg.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { const r = await apiF(`/api/orders/${o.id}/photos/${b.dataset.del}`, { method: "DELETE" }); if (r.ok) Object.assign(o, await r.json()); draw(); });
  };
  draw(); dlg.showModal();
}
function orderDialog(o) {
  const dlg = $("#dlg"), sv = S.settings.services, isNew = !o;
  o = o || { service: sv[0].n, kg: 5, name: "", phone: "", note: "", paid: false };
  dlg.innerHTML = `<h2>${isNew ? "รับผ้าใหม่ (หน้าร้าน)" : "แก้ไข #" + o.no}</h2>
    <label>ชื่อลูกค้า</label><input id="nm" value="${esc(o.name)}">
    <label>เบอร์โทร</label><input id="ph" value="${esc(o.phone)}" inputmode="tel">
    <label>บริการ</label><select id="sv">${sv.map(s => `<option ${s.n === o.service ? "selected" : ""}>${esc(s.n)}</option>`).join("")}</select>
    <label>น้ำหนัก (กก.) / จำนวนชิ้น</label><input id="kg" type="number" step="0.1" value="${o.kg}">
    <label>ราคา (฿) <span class="hint">— คำนวณอัตโนมัติ แก้ได้</span></label><input id="pr" type="number" value="${o.price ?? ""}">
    <label>หมายเหตุ</label><textarea id="nt" rows="2">${esc(o.note)}</textarea>
    <div class="row" style="margin-top:14px">${isNew ? "" : `<button class="btn r s" id="del">ลบ</button>`}<span class="grow"></span><button class="btn o" id="c">ยกเลิก</button><button class="btn" id="ok">บันทึก</button></div>`;
  dlg.showModal();
  const calc = () => { const s = sv.find(x => x.n === $("#sv", dlg).value); $("#pr", dlg).value = Math.round((+$("#kg", dlg).value || 0) * s.perKg); };
  if (isNew) calc();
  if (isNew || !(o.lines || []).length) { $("#sv", dlg).onchange = calc; $("#kg", dlg).oninput = calc; }
  $("#c", dlg).onclick = () => dlg.close();
  if (!isNew) $("#del", dlg).onclick = async () => {
    if (!confirm("ลบออเดอร์นี้? (รูปที่แนบจะถูกลบด้วย)")) return;
    S.orders = S.orders.filter(x => x !== o); await apiF("/api/orders/" + o.id, { method: "DELETE" }); dlg.close(); render();
  };
  $("#ok", dlg).onclick = async () => {
    const s = sv.find(x => x.n === $("#sv", dlg).value);
    const f = { name: $("#nm", dlg).value || "ลูกค้าหน้าร้าน", phone: $("#ph", dlg).value.replace(/\D/g, ""), service: s.n, kg: +$("#kg", dlg).value, unit: /ต่อ/.test(s.n) ? "ชิ้น" : "กก.", price: +$("#pr", dlg).value, note: $("#nt", dlg).value };
    if (!isNew) await patch(o, f);
    else { try { const r = await post("/api/admin/orders", { ...f, due: Date.now() + s.min * 60000 + 3 * 3600000 }); o = await r.json(); S.orders.unshift(o); } catch { return toast("บันทึกไม่สำเร็จ"); } }
    dlg.close(); render(); if (isNew) toast(`บันทึกแล้ว คิว #${o.no}`);
  };
}
function printSlip(o) {
  const w = window.open("", "_blank", "width=420,height=640"); if (!w) return toast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์");
  const a = o.addr || {};
  w.document.write(`<meta charset=utf-8><title>ใบส่ง #${o.no}</title><style>body{font:15px Tahoma,sans-serif;width:340px;margin:8px}h1{font-size:40px;margin:0}hr{border:0;border-top:1px dashed #000}.big{font-size:20px;font-weight:bold}</style>
    <h1>🛵 #${o.no}</h1><div>${esc(o.zone?.name || "")} · ${esc(o.pickupSlot || "")}</div><hr>
    <div class=big>${esc(a.recipient || o.name)}</div><div class=big>☎ ${esc(a.phone || o.phone)}</div>
    <p>${esc([a.house, a.building, a.street, a.subdistrict].filter(Boolean).join(" ") || o.address)}</p>
    ${a.landmark ? `<p>📌 ${esc(a.landmark)}</p>` : ""}${a.dropoff ? `<p>วิธีส่งมอบ: <b>${esc(a.dropoff)}</b></p>` : ""}${a.courierNote ? `<p>💬 ${esc(a.courierNote)}</p>` : ""}
    ${a.mapUrl ? `<p>🗺️ ${esc(a.mapUrl)}</p>` : ""}<hr>
    <div class=big>${o.paid ? "ชำระแล้ว ไม่ต้องเก็บเงิน" : "เก็บเงินปลายทาง " + baht(o.price)}</div>
    <div>สถานะ: ${DLV[o.dlv || "wait_pickup"].label}${o.express ? " · ⚡ งานด่วน" : ""}</div><script>print()<\/script>`);
  w.document.close();
}
function printTicket(o) {
  const w = window.open("", "_blank", "width=380,height=640"); if (!w) return toast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์");
  const rows = (o.lines || []).map(l => `<tr><td>${esc(l.name)}<br><small>${l.svc === "weight" ? "~" + l.qty + " กก." : l.wash ? esc(l.svcName) : esc(l.svcName) + " ×" + l.qty}</small></td><td align=right>${baht(l.amount)}</td></tr>`).join("") || `<tr><td>${esc(o.service)}<br><small>${o.kg} ${unitOf(o)}</small></td><td align=right>${baht(o.price)}</td></tr>`;
  const extra = [[o.stainFee, "ซักคราบ", 1], [o.minTopUp, "ปรับเป็นยอดขั้นต่ำ", 1], [o.expressFee, "งานด่วน", 1], [o.deliveryFee, "ค่ารับ-ส่ง", 1], [o.promoDisc, "ส่วนลดโค้ด", -1], [o.pointsDisc, "ใช้แต้ม", -1]].filter(x => x[0]).map(x => `<tr><td>${x[1]}</td><td align=right>${x[2] < 0 ? "−" : "+"}${baht(x[0])}</td></tr>`).join("");
  w.document.write(`<meta charset=utf-8><title>ใบรับผ้า #${o.no}</title><style>body{font:14px Tahoma,sans-serif;width:300px;margin:8px}h1{font-size:44px;margin:0;text-align:center}td{padding:3px 0;vertical-align:top}small{color:#555}hr{border:0;border-top:1px dashed #000}</style>
    <div align=center><b>${esc(S.settings.shop)}</b><br>${esc(S.settings.phone || "")}</div><h1>#${o.no}</h1><div align=center>${esc(o.name)} ${esc(o.phone || "")}</div><hr>
    <table width=100%>${rows}${extra}</table><hr><b>รวม ${baht(o.price)}</b> ${o.paid ? "(ชำระแล้ว)" : "(ค้างชำระ)"}${o.vat ? `<br><small>รวม VAT ${o.vat.toFixed(2)} บาท</small>` : ""}<br>รับผ้า ${dtfmt(o.created)}<br>นัดรับ ${dtfmt(o.due)}
    ${o.note ? `<br>หมายเหตุ: ${esc(o.note)}` : ""}<hr><div align=center><small>ติดตามสถานะ: ${esc(location.origin)}/track.html<br>เลขคิว #${o.no} + เบอร์ท้าย 4 ตัว</small></div><script>print()<\/script>`);
  w.document.close();
}
function msgDialog(o) {
  const dlg = $("#dlg");
  const text = o.stage >= 4
    ? `สวัสดีค่ะคุณ${o.name} 🫧 ผ้าคิว #${o.no} ของคุณซักเสร็จเรียบร้อยแล้ว พร้อมรับที่ร้าน ${S.settings.shop} ยอด ${baht(o.price)} ${o.paid ? "(ชำระแล้ว)" : ""} ขอบคุณที่ใช้บริการค่ะ`
    : `สวัสดีค่ะคุณ${o.name} ผ้าคิว #${o.no} ตอนนี้อยู่ขั้น “${STAGES[o.stage]}” คาดว่าพร้อมรับ ${dtfmt(o.due)} ค่ะ`;
  dlg.innerHTML = `<h2>ข้อความแจ้งลูกค้า</h2><textarea id="t" rows="5">${esc(text)}</textarea>
    <p class="hint">${S.settings.line?.enabled ? "ระบบส่ง LINE อัตโนมัติให้ลูกค้าที่เชื่อม LINE แล้ว (ตอนยืนยันรับ และตอนพร้อมรับ) · " : ""}ใช้ปุ่มนี้ส่งเองได้ทาง LINE/SMS</p>
    <div class="row"><span class="grow"></span><button class="btn o" id="c">ปิด</button>
    ${o.phone ? `<a class="btn o" id="sms" href="#">SMS</a>` : ""}<button class="btn" id="cp">📋 คัดลอก</button></div>`;
  dlg.showModal();
  $("#c", dlg).onclick = () => { dlg.close(); render(); };
  $("#cp", dlg).onclick = async () => { try { await navigator.clipboard.writeText($("#t", dlg).value); toast("คัดลอกแล้ว"); } catch { $("#t", dlg).select(); } };
  const sms = $("#sms", dlg); if (sms) sms.onclick = () => (sms.href = `sms:${o.phone}?body=${encodeURIComponent($("#t", dlg).value)}`);
}

/* ---------- report ---------- */
function reportView() {
  const day = 86400000, today0 = new Date().setHours(0, 0, 0, 0);
  const paid = S.orders.filter(o => o.paid), at = o => o.paidAt || o.created;
  const sum = from => paid.filter(o => at(o) >= from).reduce((a, o) => a + o.price, 0);
  const days = [...Array(7)].map((_, i) => { const s = today0 - (6 - i) * day; return { d: new Date(s).toLocaleDateString("th-TH", { weekday: "short" }), v: paid.filter(o => at(o) >= s && at(o) < s + day).reduce((a, o) => a + o.price, 0) }; });
  const mx = Math.max(1, ...days.map(x => x.v));
  const unpaid = S.orders.filter(o => !o.paid).reduce((a, o) => a + o.price, 0);
  const svc = {}; S.orders.forEach(o => (o.lines?.length ? o.lines : [{ name: o.service }]).forEach(l => (svc[l.name] = (svc[l.name] || 0) + 1)));
  $("#app").innerHTML = `<h1>สรุปร้าน</h1>
    <div class="stat">
      <div class="card"><b>${baht(sum(today0))}</b><span>รายได้วันนี้</span></div>
      <div class="card"><b>${baht(sum(today0 - 6 * day))}</b><span>7 วันล่าสุด</span></div>
      <div class="card"><b>${baht(unpaid)}</b><span>ยอดค้างชำระ</span></div>
      <div class="card"><b>${S.orders.filter(o => o.stage < 5).length}</b><span>ออเดอร์ค้าง</span></div>
      <div class="card"><b>${S.orders.filter(o => o.stage === 4).length}</b><span>รอลูกค้ามารับ</span></div>
    </div>
    <div class="sec">รายได้ 7 วัน</div>
    <div class="card"><div class="bars">${days.map(x => `<div><i style="height:${x.v / mx * 110}px"></i>${x.d}<br>${x.v ? baht(x.v) : ""}</div>`).join("")}</div></div>
    <div class="sec">รายการยอดนิยม</div>
    <div class="card">${Object.entries(svc).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `<div class="row"><span class="grow">${esc(k)}</span><b>${v} ออเดอร์</b></div>`).join("") || '<span class="hint">ยังไม่มีข้อมูล</span>'}</div>
    <div class="row" style="margin-top:14px"><button class="btn o" id="csv">⬇ ส่งออก CSV (เปิดใน Excel)</button></div>`;
  $("#csv").onclick = () => {
    const rows = [["คิว", "ชื่อ", "เบอร์", "บริการ", "จำนวน", "ราคา", "จ่ายแล้ว", "สถานะ", "วันที่รับ"], ...S.orders.map(o => [o.no, o.name, o.phone, o.service, o.kg, o.price, o.paid ? "Y" : "N", STAGES[o.stage], new Date(o.created).toISOString()])];
    const csv = "﻿" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "laundry-orders.csv"; a.click();
  };
}

/* ---------- ต้นทุน & กำไรต่อรอบซัก ---------- */
function costView() {
  const st = S.settings, c = st.cost = st.cost || {}, tiers = S.catalog.wash.tiers;
  const calc = t => {
    const k = t.cost || {};
    const water = (k.waterL || 0) / 1000 * (c.waterPerM3 || 0), elec = (k.kwh || 0) * (c.kwhRate || 0), labor = (k.laborMin || 0) * (c.laborPerMin || 0);
    const direct = water + elec + (k.detergent || 0) + labor + (k.dep || 0), total = direct * (1 + (c.overheadPct || 0) / 100);
    return { water, elec, labor, direct, total, profit: t.price - total, pct: (t.price - total) / t.price * 100 };
  };
  const target = c.targetPct ?? 40;
  $("#app").innerHTML = `<h1>💰 ต้นทุน & กำไรต่อรอบซัก</h1>
    <p class="hint">ตัวเลขเริ่มต้นเป็นค่าประมาณเพื่อให้เห็นวิธีคิด — แก้ให้ตรงกับบิลน้ำ/ไฟและเครื่องของร้านคุณ แล้วดูว่าเรท ฿20–60 ต่อรอบยังกำไรพอไหม</p>
    <div class="card"><h2>ค่าใช้จ่ายพื้นฐานของร้าน</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      ${[["waterPerM3", "ค่าน้ำ (฿/ลบ.ม.)"], ["kwhRate", "ค่าไฟ (฿/หน่วย)"], ["laborPerMin", "ค่าแรง (฿/นาที)"], ["overheadPct", "ค่าเช่า/ภาษี/อื่นๆ (% บวกเพิ่ม)"], ["targetPct", "กำไรขั้นต้นที่ต้องการ (%)"]].map(([k, l]) => `<div><label>${l}</label><input type="number" step="0.1" data-g="${k}" value="${k === "targetPct" ? target : c[k] ?? 0}"></div>`).join("")}</div></div>
    <div class="tablewrap" style="margin-top:12px"><table><tr><th>เครื่อง</th><th>ราคาขาย</th><th>น้ำ (ลิตร)</th><th>ไฟ (หน่วย)</th><th>น้ำยา ฿</th><th>แรง (นาที)</th><th>ค่าเสื่อม ฿/รอบ</th><th>ต้นทุนรวม</th><th>กำไร/รอบ</th><th>ราคาที่ควรขาย*</th></tr>
    ${tiers.map((t, i) => { const r = calc(t), k = t.cost || {}, sug = Math.ceil(r.total / (1 - target / 100) / 5) * 5; return `<tr data-i="${i}"><td><b>${esc(t.name)}</b></td>
      <td><b>${baht(t.price)}</b></td>
      ${["waterL", "kwh", "detergent", "laborMin", "dep"].map(f => `<td><input type="number" step="0.1" style="width:76px" data-f="${f}" value="${k[f] ?? 0}"></td>`).join("")}
      <td>${baht(r.total)}<br><small class="hint">น้ำ${r.water.toFixed(1)} ไฟ${r.elec.toFixed(1)} แรง${r.labor.toFixed(1)}</small></td>
      <td style="color:${r.profit >= 0 ? "var(--green)" : "var(--red)"}"><b>${baht(r.profit)}</b><br><small>${r.pct.toFixed(0)}%</small></td>
      <td>${baht(sug)} ${sug !== t.price ? `<button class="btn s o" data-set="${i}" data-v="${sug}">ใช้ราคานี้</button>` : "✓"}</td></tr>`; }).join("")}</table></div>
    <p class="hint">*ราคาที่ควรขาย = ต้นทุนรวม ÷ (1 − กำไรที่ต้องการ) ปัดขึ้นเป็นผลคูณของ 5 บาท · ค่าเสื่อม = ราคาเครื่อง ÷ จำนวนรอบที่คาดว่าจะใช้ได้ตลอดอายุ · ยังไม่รวมค่ารีด/อบ</p>
    <div class="card"><h2>จุดคุ้มทุนรายเดือน</h2>
      <label>ค่าใช้จ่ายคงที่ต่อเดือน (เช่น ค่าเช่าที่ ค่าจ้างประจำ ค่าผ่อนเครื่อง) ฿</label><input type="number" id="fixed" value="${c.fixedMonthly ?? 0}">
      <div id="be" style="margin-top:10px"></div></div>
    <div class="card"><h2>ยอดซักเครื่องจริง 30 วันล่าสุด</h2><div id="real"></div></div>`;
  const real = () => {
    const from = Date.now() - 30 * 864e5; let loads = 0, rev = 0, cost = 0;
    S.orders.filter(o => o.created >= from).forEach(o => (o.lines || []).filter(l => l.wash).forEach(l => { loads += l.loads; rev += l.amount; const t = tierOf(l.tier); if (t) cost += calc(t).total * l.loads; }));
    $("#real").innerHTML = loads ? `<div class="stat"><div class="card"><b>${loads}</b><span>รอบที่ซัก</span></div><div class="card"><b>${baht(rev)}</b><span>รายได้จากการซักเครื่อง</span></div><div class="card"><b>${baht(rev - cost)}</b><span>กำไรขั้นต้นโดยประมาณ</span></div></div>` : `<span class="hint">ยังไม่มีออเดอร์ซักเครื่อง</span>`;
    const avg = tiers.reduce((a, t) => a + calc(t).profit, 0) / (tiers.length || 1);
    $("#be").innerHTML = (c.fixedMonthly > 0 && avg > 0) ? `กำไรขั้นต้นเฉลี่ย ~${baht(avg)}/รอบ → ต้องซักอย่างน้อย <b>${Math.ceil(c.fixedMonthly / avg)} รอบ/เดือน</b> (~${Math.ceil(c.fixedMonthly / avg / 30)} รอบ/วัน) ถึงจะคุ้มทุน` : `<span class="hint">ใส่ค่าใช้จ่ายคงที่เพื่อคำนวณ</span>`;
  };
  real();
  $("#app").onchange = e => {
    const t = e.target;
    if (t.dataset.g) c[t.dataset.g] = +t.value;
    else if (t.id === "fixed") c.fixedMonthly = +t.value;
    else if (t.dataset.f) { const tier = tiers[+t.closest("tr").dataset.i]; tier.cost = tier.cost || {}; tier.cost[t.dataset.f] = +t.value; }
    else return;
    save(); costView();
  };
  $("#app").onclick = e => { const b = e.target.closest("[data-set]"); if (!b) return; tiers[+b.dataset.set].price = +b.dataset.v; save(); toast("ปรับราคาเครื่องแล้ว — ลูกค้าเห็นราคาใหม่ทันที"); costView(); };
}

/* ---------- settings ---------- */
function settingsView() {
  const st = S.settings;
  $("#app").innerHTML = `<h1>ตั้งค่า</h1>
    <div class="card"><h2>ทั่วไป</h2>
      <label>ชื่อร้าน</label><input id="shop" value="${esc(st.shop)}">
      <label>เตือน “ลืมผ้า” เมื่อเสร็จแล้วเกิน (นาที)</label><input id="grace" type="number" value="${st.grace}">
      <label><input type="checkbox" id="snd" ${st.sound ? "checked" : ""} style="width:auto"> เปิดเสียงเตือน</label>
      <label>โหมดทดสอบ: เร่งเวลา (1 = ปกติ, 60 = 1 นาทีเท่า 1 วินาที)</label><input id="spd" type="number" min="1" value="${st.speed}"></div>
    <div class="card" style="margin-top:12px"><h2>เครื่องซัก-อบ</h2><div id="mlist"></div>
      <div class="row" style="margin-top:8px"><button class="btn s" id="addW">＋ เครื่องซัก</button><button class="btn s" id="addD">＋ เครื่องอบ</button></div></div>
    <div id="online"></div>
    <div class="card" style="margin-top:12px"><h2>บริการหน้าร้าน (ฟอร์ม “รับผ้าใหม่” โดยพนักงาน)</h2><div id="slist"></div><button class="btn s" id="addS" style="margin-top:8px">＋ บริการ</button></div>
    <div class="card" style="margin-top:12px"><h2>โปรแกรมเครื่อง (นาที)</h2><div id="plist"></div></div>
    <div class="card" style="margin-top:12px"><h2>🔑 เปลี่ยนรหัสผ่านเจ้าของร้าน</h2>
      <label>รหัสผ่านเดิม</label><input type="password" id="pwo" autocomplete="current-password"><label>รหัสผ่านใหม่ (8 ตัวขึ้นไป)</label><input type="password" id="pwn" autocomplete="new-password">
      <p><button class="btn" id="pwgo">เปลี่ยนรหัสผ่าน</button></p></div>
    <div class="card" style="margin-top:12px"><h2>สำรองข้อมูล</h2><p class="hint">ข้อมูลทั้งหมดอยู่ที่ <code>data/laundry.db</code> และรูปใน <code>data/photos/</code> — สำรองโดยคัดลอกโฟลเดอร์ data ตอนปิดเซิร์ฟเวอร์</p>
      <button class="btn o" id="exp">⬇ ส่งออกออเดอร์ทั้งหมด (JSON)</button></div>`;
  const bind = (id, k, num) => $(id).onchange = e => { st[k] = num ? +e.target.value : e.target.value; save(); route(); };
  bind("#shop", "shop"); bind("#grace", "grace", 1); bind("#spd", "speed", 1);
  $("#snd").onchange = e => { st.sound = e.target.checked; save(); };
  const redraw = () => {
    $("#mlist").innerHTML = S.machines.map(m => `<div class="row" data-id="${m.id}" style="margin:4px 0"><span>${m.type === "washer" ? "🌀" : "♨️"}</span><input class="grow" value="${esc(m.name)}" data-f="name">
      ${m.type === "washer" ? `<select data-f="tier" style="width:200px"><option value="">— เรทราคา —</option>${S.catalog.wash.tiers.map(t => `<option value="${t.id}" ${m.tier === t.id ? "selected" : ""}>${esc(t.name)} ${baht(t.price)}</option>`).join("")}</select>` : ""}<button class="btn s r" data-a="rm">ลบ</button></div>`).join("");
    $("#slist").innerHTML = st.services.map((s, i) => `<div class="row" data-i="${i}" style="margin:4px 0"><input class="grow" value="${esc(s.n)}" data-f="n"><input style="width:90px" type="number" value="${s.perKg}" data-f="perKg" title="ราคาต่อหน่วย"><input style="width:90px" type="number" value="${s.min}" data-f="min" title="เวลา (นาที)"><button class="btn s r" data-a="rm">ลบ</button></div>`).join("") + `<p class="hint">ชื่อ · ราคา/กก. (หรือต่อชิ้น) · เวลา (นาที) — ใส่คำว่า “ต่อ” ในชื่อถ้านับเป็นชิ้น</p>`;
    $("#plist").innerHTML = ["washer", "dryer"].map(t => `<b>${t === "washer" ? "🌀 เครื่องซัก" : "♨️ เครื่องอบ"}</b>` + st.programs[t].map((p, i) => `<div class="row" data-t="${t}" data-i="${i}" style="margin:4px 0"><input class="grow" value="${esc(p.n)}" data-f="n"><input style="width:90px" type="number" value="${p.min}" data-f="min"></div>`).join("")).join("");
  };
  redraw();
  $("#mlist").onchange = e => { const m = S.machines.find(x => x.id === e.target.closest("[data-id]").dataset.id); const t = tierOf(e.target.value); m[e.target.dataset.f] = e.target.value; if (e.target.dataset.f === "tier" && t) m.cap = t.cap; save(); };
  $("#mlist").onclick = e => { if (e.target.dataset.a !== "rm") return; const id = e.target.closest("[data-id]").dataset.id; if (confirm("ลบเครื่องนี้?")) { S.machines = S.machines.filter(m => m.id !== id); save(); redraw(); } };
  const addM = t => { const n = S.machines.filter(m => m.type === t).length + 1; S.machines.push({ id: uid(), name: (t === "washer" ? "ซัก " : "อบ ") + n, type: t, cap: 14, status: "idle" }); save(); redraw(); };
  $("#addW").onclick = () => addM("washer"); $("#addD").onclick = () => addM("dryer");
  $("#slist").onchange = e => { const s = st.services[+e.target.closest("[data-i]").dataset.i]; s[e.target.dataset.f] = e.target.type === "number" ? +e.target.value : e.target.value; save(); };
  $("#slist").onclick = e => { if (e.target.dataset.a !== "rm") return; st.services.splice(+e.target.closest("[data-i]").dataset.i, 1); save(); redraw(); };
  $("#addS").onclick = () => { st.services.push({ n: "บริการใหม่", perKg: 40, min: 60 }); save(); redraw(); };
  $("#plist").onchange = e => { const r = e.target.closest("[data-i]"), p = st.programs[r.dataset.t][+r.dataset.i]; p[e.target.dataset.f] = e.target.type === "number" ? +e.target.value : e.target.value; save(); };
  $("#exp").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.orders, null, 1)], { type: "application/json" })); a.download = "laundry-orders.json"; a.click(); };
  $("#pwgo").onclick = async () => { const r = await post("/api/admin/password", { old: $("#pwo").value, password: $("#pwn").value }), j = await r.json(); toast(r.ok ? "เปลี่ยนรหัสผ่านแล้ว" : j.error); if (r.ok) { $("#pwo").value = $("#pwn").value = ""; } };
  onlineSettings();
}

/* ร้านออนไลน์: กติกาคิดเงิน, LINE, ราคาซักเครื่อง, แคตตาล็อกรายชิ้น */
function onlineSettings() {
  const st = S.settings, cat = S.catalog, box = $("#online"), link = location.origin + "/";
  const num = (k, label, hint = "") => `<div><label>${label}</label><input type="number" step="any" data-s="${k}" value="${st[k] ?? 0}">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  const price = v => (v > 0 ? v : "");
  const W = cat.wash;
  const draw = () => {
    box.innerHTML = `
    <div class="card" style="margin-top:12px"><h2>🌐 ลิงก์สำหรับลูกค้า</h2>
      <div class="row"><input class="grow" readonly value="${esc(link)}"><button class="btn s" id="cplnk">คัดลอก</button></div>
      <p class="hint">ในวง Wi-Fi ร้านใช้ IP ของเครื่องนี้แทน localhost · ถ้าจะให้คนนอกเข้าได้ ดูไฟล์ HOSTING.md · ติดคิวอาร์โค้ดหน้าร้านให้สแกนสั่งได้</p>
      <img alt="QR" width="150" height="150" src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(link)}" style="border-radius:8px"><br>
      <span class="hint">(QR สร้างผ่าน api.qrserver.com — ส่งเฉพาะลิงก์ร้านไปที่บริการนั้น)</span></div>
    <div class="card" style="margin-top:12px"><h2>📞 ข้อมูลร้าน</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div><label>เบอร์ร้าน</label><input data-s="phone" value="${esc(st.phone || "")}"></div><div><label>LINE ID</label><input data-s="lineId" value="${esc(st.lineId || "")}"></div><div><label>เวลาเปิด</label><input data-s="hours" value="${esc(st.hours || "")}"></div></div></div>
    <div class="card" style="margin-top:12px"><h2>🧮 กติกาคิดเงิน</h2>
      <p class="hint">ลำดับคำนวณ: ราคารายการ → +ค่าซักคราบ → เติมให้ถึงยอดขั้นต่ำ → +งานด่วน → −โค้ด → −แต้ม → +ค่าส่ง → ปัดเศษ</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      ${num("minOrder", "ยอดขั้นต่ำต่อออเดอร์ (฿)", "ต่ำกว่านี้เติมให้ครบ")}${num("stainFee", "ค่าซักคราบพิเศษ (฿/ชิ้น)")}
      ${num("expressPct", "งานด่วน +%")}${num("expressMin", "ค่าด่วนขั้นต่ำ (฿)")}${num("expressHours", "ด่วนเสร็จใน (ชม.)")}${num("leadHours", "งานปกติเสร็จใน (ชม.)")}
      ${num("roundTo", "ปัดยอดสุดท้ายเป็นผลคูณของ", "เช่น 5 = ปัดเป็นเลข 5")}${num("vatPct", "VAT % (0 = ไม่ใช้)", "ถือว่าราคารวมแล้ว")}
      ${num("earnDiv", "จ่ายครบทุก ฿ ได้ 1 แต้ม")}${num("redeemStep", "ใช้แต้มครั้งละ (แต้ม)")}${num("redeemBaht", "ได้ส่วนลด (฿)")}${num("maxRedeemPct", "ลดจากแต้มได้ไม่เกิน (% ของยอด)")}</div></div>
    <div class="card" style="margin-top:12px"><h2>🛵 พื้นที่รับ-ส่งถึงบ้าน</h2>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="dOn" style="width:auto" ${st.deliveryEnabled !== false ? "checked" : ""}> เปิดบริการรับ-ส่ง</label>
      <p class="hint">ลูกค้าเลือกส่งได้เฉพาะโซนที่เปิดไว้ นอกโซนต้องเอามาที่ร้านเอง · ค่าส่งคิดตามโซน · ยอดถึงเกณฑ์ส่งฟรี · ต่ำกว่ายอดขั้นต่ำของโซนจะสั่งส่งไม่ได้</p>
      <div class="tablewrap"><table><tr><th>เปิด</th><th>ชื่อโซน/พื้นที่</th><th>ค่าส่ง ฿</th><th>ส่งฟรีเมื่อยอด ฿</th><th>ยอดขั้นต่ำ ฿</th><th>หมายเหตุให้ลูกค้า</th><th></th></tr>
      ${(st.zones || []).map((z, i) => `<tr data-zi="${i}"><td><input type="checkbox" style="width:auto" data-z="active" ${z.active !== false ? "checked" : ""}></td><td><input data-z="name" value="${esc(z.name)}" style="min-width:170px"></td><td><input type="number" style="width:70px" data-z="fee" value="${z.fee ?? 0}"></td><td><input type="number" style="width:80px" data-z="freeOver" value="${z.freeOver ?? ""}" placeholder="ไม่มี"></td><td><input type="number" style="width:80px" data-z="minOrder" value="${z.minOrder ?? 0}"></td><td><input data-z="note" value="${esc(z.note || "")}"></td><td><button class="btn s r" data-a="rmz">ลบ</button></td></tr>`).join("")}</table></div>
      <button class="btn s" id="addZone" style="margin-top:6px">＋ โซนจัดส่ง</button>
      <label>ช่วงเวลารับ-ส่ง (หนึ่งบรรทัดต่อหนึ่งช่วง)</label><textarea data-lines="slots" rows="3">${esc((st.slots || []).join("\n"))}</textarea>
      <label>ตัวเลือกวิธีส่งมอบผ้า (หนึ่งบรรทัดต่อหนึ่งตัวเลือก)</label><textarea data-lines="dropoffOptions" rows="3">${esc((st.dropoffOptions || []).join("\n"))}</textarea>
      <label>ข้อความแจ้งลูกค้าเรื่องการรับ-ส่ง</label><input data-s="deliveryNote" value="${esc(st.deliveryNote || "")}"></div>
    <div class="card" style="margin-top:12px"><h2>🏷️ โค้ดส่วนลด</h2>
      ${(st.promos || []).map((p, i) => `<div class="row" data-pi="${i}" style="margin:4px 0"><input style="width:120px" data-p="code" value="${esc(p.code)}"><input style="width:80px" type="number" data-p="pct" value="${p.pct || 0}">%<input style="width:90px" type="number" data-p="min" value="${p.min || 0}">ขั้นต่ำ ฿<button class="btn s r" data-a="rmp">ลบ</button></div>`).join("")}
      <button class="btn s" id="addPromo">＋ โค้ด</button></div>
    <div class="card" style="margin-top:12px"><h2>💬 แจ้งเตือน LINE อัตโนมัติ</h2>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="lineOn" style="width:auto" ${st.line?.enabled ? "checked" : ""}> เปิดใช้งาน</label>
      <label>Channel access token (long-lived)</label><input type="password" data-l="token" value="${esc(st.line?.token || "")}" autocomplete="off">
      <label>Channel secret</label><input type="password" data-l="secret" value="${esc(st.line?.secret || "")}" autocomplete="off">
      <p class="hint">ตั้ง Webhook URL ใน LINE Developers เป็น <code>${esc(location.origin)}/api/line/webhook</code> (ต้องเป็น https ที่เข้าถึงได้จากอินเทอร์เน็ต) · ลูกค้าผูกบัญชีโดยพิมพ์ “ผูก 123456” หรือ “คิว 12 5678” · ข้อความที่ส่ง: ตอนยืนยันรับ และตอนผ้าพร้อมรับ · ดูเงื่อนไขโควตาข้อความของ LINE OA ของคุณ</p></div>
    <div class="card" style="margin-top:12px"><h2>🌀 ราคาซักเครื่อง (เรทต่อรอบ)</h2>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="wOn" style="width:auto" ${W.enabled ? "checked" : ""}> เปิดบริการซักเครื่องให้ลูกค้าเลือก</label>
      <b>ขนาดเครื่อง</b>
      ${W.tiers.map((t, i) => `<div class="row" data-ti="${i}" style="margin:4px 0"><input class="grow" data-t="name" value="${esc(t.name)}"><input style="width:70px" type="number" data-t="cap" value="${t.cap}" title="กก.">กก.<input style="width:80px" type="number" data-t="price" value="${t.price}" title="ราคา">฿/รอบ<input style="width:70px" type="number" data-t="minutes" value="${t.minutes}" title="นาที">นาที<button class="btn s r" data-a="rmt">ลบ</button></div>`).join("")}
      <button class="btn s" id="addTier">＋ ขนาดเครื่อง</button>
      <p style="margin-bottom:2px"><b>ชนิดผ้า</b> <span class="hint">— “fill” = สัดส่วนที่ใส่ได้ของความจุเครื่อง · ชิ้น/รอบ ใส่เป็น w60:2,w40:1</span></p>
      ${W.fabrics.map((f, i) => `<div class="card" data-fi="${i}" style="margin:6px 0;padding:10px"><div class="row"><input style="width:50px" data-f="icon" value="${esc(f.icon)}"><input class="grow" data-f="name" value="${esc(f.name)}"><button class="btn s r" data-a="rmf">ลบ</button></div>
        <div class="row" style="margin-top:6px"><select data-f="unit"><option value="kg" ${f.unit === "kg" ? "selected" : ""}>คิดตามน้ำหนัก</option><option value="piece" ${f.unit === "piece" ? "selected" : ""}>คิดตามชิ้น</option></select>
        ${f.unit === "kg" ? `fill <input style="width:70px" type="number" step="0.05" data-f="fill" value="${f.fill}">` : `ชิ้น/รอบ <input style="width:150px" data-f="perLoad" value="${Object.entries(f.perLoad || {}).map(([k, v]) => k + ":" + v).join(",")}">`}
        ค่าเสริม/รอบ ฿<input style="width:70px" type="number" data-f="extraPerLoad" value="${f.extraPerLoad || 0}"></div>
        <div class="row" style="margin-top:6px">ใช้เครื่องได้: ${W.tiers.map(t => `<label style="margin:0;display:flex;gap:3px;align-items:center"><input type="checkbox" style="width:auto" data-ft="${t.id}" ${f.tiers.includes(t.id) ? "checked" : ""}>${baht(t.price)}</label>`).join("")}</div>
        <input data-f="note" value="${esc(f.note || "")}" placeholder="หมายเหตุให้ลูกค้า" style="margin-top:6px"></div>`).join("")}
      <button class="btn s" id="addFab">＋ ชนิดผ้า</button>
      <p style="margin-bottom:2px"><b>บริการเสริม (ต่อรอบ)</b></p>
      ${W.addons.map((a, i) => `<div class="row" data-ai="${i}" style="margin:4px 0"><input class="grow" data-a2="name" value="${esc(a.name)}"><input style="width:80px" type="number" data-a2="price" value="${a.price}">฿<button class="btn s r" data-a="rma">ลบ</button></div>`).join("")}
      <button class="btn s" id="addAddon">＋ บริการเสริม</button></div>
    <div class="card" style="margin-top:12px"><h2>👔 ราคารายชิ้น (รีด/ซัก+รีด/ซักแห้ง)</h2>
      <div class="row" style="margin-bottom:8px"><label style="margin:0"><input type="checkbox" id="kOn" style="width:auto" ${cat.weight.enabled ? "checked" : ""}> เปิดบริการชั่งกิโล</label>
        <input style="width:160px" data-w="name" value="${esc(cat.weight.name)}"><input style="width:70px" type="number" data-w="perKg" value="${cat.weight.perKg}"> ฿/กก.<input style="width:60px" type="number" step="0.5" data-w="minKg" value="${cat.weight.minKg}"> กก.ขั้นต่ำ</div>
      <p class="hint">เว้นช่องว่าง = ไม่มีบริการนั้นสำหรับรายการนี้ · ราคาต่อชิ้น</p>
      <div class="tablewrap"><table id="ct"><tr><th>รายการ</th>${cat.services.map(s => `<th>${esc(s.name)}</th>`).join("")}<th></th></tr>
      ${cat.categories.map((c, ci) => `<tr><td colspan="${cat.services.length + 2}" style="background:var(--bg)"><b>${c.icon}</b> <input style="width:60%;display:inline" data-c="${ci}" value="${esc(c.name)}"> <button class="btn s" data-a="additem" data-ci="${ci}">＋ รายการ</button> <button class="btn s r" data-a="rmcat" data-ci="${ci}">ลบหมวด</button></td></tr>` +
        c.items.map((it, ii) => `<tr data-ci="${ci}" data-ii="${ii}"><td><input data-f2="name" value="${esc(it.name)}"></td>${cat.services.map(s => `<td><input type="number" style="width:84px" data-f2="${s.id}" value="${price(it[s.id])}"></td>`).join("")}<td><button class="btn s r" data-a="rmitem">×</button></td></tr>`).join("")).join("")}</table></div>
      <button class="btn s" id="addCat" style="margin-top:8px">＋ หมวดใหม่</button></div>`;
  };
  draw();
  const parsePer = s => Object.fromEntries(String(s).split(",").map(x => x.split(":").map(y => y.trim())).filter(x => x[0] && +x[1] > 0).map(([k, v]) => [k, +v]));
  box.onchange = e => {
    const t = e.target, val = t.type === "number" ? +t.value : t.value;
    if (t.id === "dOn") st.deliveryEnabled = t.checked;
    else if (t.dataset.z) { const z = st.zones[+t.closest("[data-zi]").dataset.zi]; z[t.dataset.z] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? null : +t.value) : t.value; }
    else if (t.dataset.lines) st[t.dataset.lines] = t.value.split("\n").map(x => x.trim()).filter(Boolean);
    else if (t.id === "wOn") W.enabled = t.checked; else if (t.id === "kOn") cat.weight.enabled = t.checked;
    else if (t.id === "lineOn") (st.line = st.line || {}).enabled = t.checked;
    else if (t.dataset.l) (st.line = st.line || {})[t.dataset.l] = t.value.trim();
    else if (t.dataset.s) st[t.dataset.s] = val;
    else if (t.dataset.w) cat.weight[t.dataset.w] = val;
    else if (t.dataset.t) W.tiers[+t.closest("[data-ti]").dataset.ti][t.dataset.t] = val;
    else if (t.dataset.ft) { const f = W.fabrics[+t.closest("[data-fi]").dataset.fi]; f.tiers = t.checked ? [...new Set([...f.tiers, t.dataset.ft])] : f.tiers.filter(x => x !== t.dataset.ft); }
    else if (t.dataset.f) { const f = W.fabrics[+t.closest("[data-fi]").dataset.fi]; f[t.dataset.f] = t.dataset.f === "perLoad" ? parsePer(t.value) : val; if (t.dataset.f === "unit") { if (val === "kg") { f.fill = f.fill || 0.8; delete f.perLoad; } else f.perLoad = f.perLoad || {}; draw(); } }
    else if (t.dataset.a2) W.addons[+t.closest("[data-ai]").dataset.ai][t.dataset.a2] = val;
    else if (t.dataset.c) cat.categories[+t.dataset.c].name = t.value;
    else if (t.dataset.p) st.promos[+t.closest("[data-pi]").dataset.pi][t.dataset.p] = t.type === "number" ? +t.value : t.value.toUpperCase();
    else if (t.dataset.f2) { const r = t.closest("tr"), it = cat.categories[+r.dataset.ci].items[+r.dataset.ii]; it[t.dataset.f2] = t.type === "number" ? (t.value === "" ? null : +t.value) : t.value; }
    else return;
    save();
  };
  box.onclick = e => {
    const t = e.target, a = t.dataset.a;
    if (t.id === "cplnk") { navigator.clipboard?.writeText(link); return toast("คัดลอกแล้ว"); }
    if (t.id === "addZone") (st.zones = st.zones || []).push({ id: "z" + uid(), name: "โซนใหม่", fee: 30, freeOver: 300, minOrder: 0, active: true, note: "" });
    else if (a === "rmz") { if (!confirm("ลบโซนนี้? (ออเดอร์เดิมไม่ได้รับผลกระทบ)")) return; st.zones.splice(+t.closest("[data-zi]").dataset.zi, 1); }
    else if (t.id === "addPromo") (st.promos = st.promos || []).push({ code: "CODE" + (st.promos.length + 1), pct: 10, min: 0 });
    else if (t.id === "addCat") cat.categories.push({ id: uid(), name: "หมวดใหม่", icon: "🧺", items: [] });
    else if (t.id === "addTier") W.tiers.push({ id: "w" + uid(), name: "เครื่องใหม่", cap: 10, price: 30, minutes: 40, cost: {} });
    else if (t.id === "addFab") W.fabrics.push({ id: uid(), icon: "🧺", name: "ชนิดผ้าใหม่", unit: "kg", fill: 0.8, tiers: W.tiers.slice(0, 1).map(x => x.id), extraPerLoad: 0, note: "" });
    else if (t.id === "addAddon") W.addons.push({ id: uid(), name: "บริการเสริม", price: 5 });
    else if (a === "rmp") st.promos.splice(+t.closest("[data-pi]").dataset.pi, 1);
    else if (a === "rmt") { const x = W.tiers.splice(+t.closest("[data-ti]").dataset.ti, 1)[0]; W.fabrics.forEach(f => { f.tiers = f.tiers.filter(i => i !== x.id); }); S.machines.forEach(m => { if (m.tier === x.id) delete m.tier; }); }
    else if (a === "rmf") W.fabrics.splice(+t.closest("[data-fi]").dataset.fi, 1);
    else if (a === "rma") W.addons.splice(+t.closest("[data-ai]").dataset.ai, 1);
    else if (a === "additem") cat.categories[+t.dataset.ci].items.push({ id: uid(), name: "รายการใหม่", iron: 15, washiron: 25, dry: null });
    else if (a === "rmcat") { if (!confirm("ลบทั้งหมวด?")) return; cat.categories.splice(+t.dataset.ci, 1); }
    else if (a === "rmitem") { const r = t.closest("tr"); cat.categories[+r.dataset.ci].items.splice(+r.dataset.ii, 1); }
    else return;
    save(); draw();
  };
}

/* ---------- TV board ---------- */
function boardView() {
  const q = S.orders.filter(o => o.stage < 5 && !o.incoming).sort((a, b) => b.stage - a.stage || a.no - b.no);
  $("#app").innerHTML = `<div class="tv"><h1>${esc(S.settings.shop)} · สถานะเครื่อง</h1>
    <div class="grid">${S.machines.map(m => machineCard(m, true)).join("")}</div>
    <h1 style="margin-top:24px">คิวรับผ้า</h1>
    <div class="queue">${q.map(o => `<div class="qt ${o.stage === 4 ? "ready" : ""}"><b>#${o.no}</b><small>${o.stage === 4 ? "✅ พร้อมรับ" : STAGES[o.stage]}</small></div>`).join("") || '<span class="hint">ไม่มีคิวค้าง</span>'}</div>
    <p class="hint">เปิดหน้านี้บนทีวี/แท็บเล็ตหน้าร้าน (F11 เต็มจอ) · แสดงเฉพาะเลขคิว ไม่แสดงชื่อลูกค้า</p></div>`;
}

/* ---------- tick ---------- */
const alertsEl = $("#alerts");
function tick() {
  if (document.body.classList.contains("locked")) return;
  let changed = false;
  S.machines.forEach(m => {
    if (m.status === "run" && Date.now() >= m.endAt && !m.notified) {
      m.notified = true; changed = true; beep();
      const o = m.orderId && orderOf(m.orderId);
      const msg = `${m.name} เสร็จแล้ว${o ? ` (คิว #${o.no} ${o.name})` : m.note ? ` (${m.note})` : ""}`;
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("🫧 " + msg); } catch {}
      if (o && m.type === "dryer" && o.stage < 3) patch(o, { stage: 3 });
    }
  });
  if (changed) save();
  const done = S.machines.filter(m => ["done", "late"].includes(stateOf(m))), incoming = S.orders.filter(o => o.incoming);
  alertsEl.innerHTML = (incoming.length ? `<div class="alert r"><span>🆕 ออเดอร์ใหม่จากลูกค้า ${incoming.length} รายการ รอยืนยัน (${incoming.slice(0, 3).map(o => "#" + o.no).join(", ")})</span><a href="#/orders" style="color:inherit">ดูออเดอร์</a></div>` : "") + done.map(m => {
    const late = stateOf(m) === "late", o = m.orderId && orderOf(m.orderId);
    return `<div class="alert ${late ? "r" : "g"}"><span>${late ? "⚠ ลืมผ้า? " : "✅ "}${esc(m.name)} เสร็จแล้ว${o ? ` · คิว #${o.no} ${esc(o.name)}` : ""}</span><a href="#/machines" style="color:inherit">ไปที่เครื่อง</a></div>`;
  }).join("");
  const page = location.hash.replace("#/", "") || "machines";
  if ((page === "machines" || page === "board") && !$("#dlg").open) {
    document.querySelectorAll(".mc").forEach(el => {
      const m = S.machines.find(x => x.id === el.dataset.id); if (!m) return;
      const t = document.createElement("div"); t.innerHTML = machineCard(m, page === "board");
      if (el.className !== t.firstElementChild.className || el.innerHTML !== t.firstElementChild.innerHTML) { el.className = t.firstElementChild.className; el.innerHTML = t.firstElementChild.innerHTML; }
    });
  }
}
function render() { route(); tick(); }
setInterval(tick, 1000);
$("#logout").onclick = async e => { e.preventDefault(); await post("/api/admin/logout"); clearInterval(start.t); authView(false); };
boot();
