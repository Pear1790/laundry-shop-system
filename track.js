const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const baht = n => "฿" + Math.round(n).toLocaleString("th-TH");
const root = $("#root");
const STEPS = [["🧺", "รับผ้า"], ["🌀", "ซัก"], ["♨️", "อบ"], ["👔", "รีด/พับ"], ["✅", "พร้อมรับ"]];
const params = new URLSearchParams(location.search);
let q = params.get("t") ? "t=" + encodeURIComponent(params.get("t")) : "";

function form(err) {
  root.innerHTML = `<div class="card" style="margin-top:14px"><h2>ค้นหาออเดอร์</h2>
    <label>เลขคิว</label><input id="no" inputmode="numeric" placeholder="เช่น 12">
    <label>เบอร์โทร 4 ตัวท้าย</label><input id="p4" inputmode="numeric" maxlength="4">
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <p><button class="btn" id="go" style="width:100%">ค้นหา</button></p></div>`;
  $("#go").onclick = () => { q = `no=${+$("#no").value}&p4=${encodeURIComponent($("#p4").value)}`; load(); };
}
async function load() {
  if (!q) return form();
  let r, j;
  try { r = await fetch("/api/track?" + q); j = await r.json(); } catch { return root.innerHTML = `<div class="err" style="margin-top:14px">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</div>`; }
  if (!r.ok) { q = ""; return form(j.error); }
  show(j);
}
function show(o) {
  const done = o.stage >= 5, cur = o.incoming ? -1 : Math.min(o.stage, 4), b = o.breakdown || {};
  const head = o.incoming ? "ส่งออเดอร์แล้ว รอร้านยืนยัน" : done ? "รับผ้าเรียบร้อย ขอบคุณค่ะ 🙏" : o.stage === 4 ? "ผ้าพร้อมรับแล้ว! 🎉" : `ตอนนี้: ${STEPS[o.stage][1]}`;
  const row = (a, v) => `<div><span>${a}</span><span>${v}</span></div>`;
  const photos = (o.photos || []);
  root.innerHTML = `
    <div class="card" style="margin-top:14px;text-align:center"><div class="hint">คิวของ ${esc(o.name)}</div><div style="font:800 56px/1.1 var(--f);color:var(--blue)">#${o.no}</div><h2>${head}</h2>
      ${!done && o.stage < 4 ? `<div class="hint">คาดว่าเสร็จ ${new Date(o.due).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>` : ""}
      <div class="steps">${STEPS.map((s, i) => `<div class="s ${i < cur || done ? "on" : i === cur ? "cur" : ""}"><i>${i < cur || done ? "✓" : s[0]}</i>${s[1]}</div>`).join("")}</div></div>
    ${o.delivery ? `<div class="card"><h2>🛵 รับ-ส่งถึงบ้าน</h2><div class="hint">${esc(o.zoneName || "")}${o.pickupSlot ? " · ช่วงเวลา " + esc(o.pickupSlot) : ""}</div>
      <div class="steps" style="margin-top:10px">${[["wait_pickup", "📞", "รอไปรับผ้า"], ["picked", "🧺", "รับผ้าแล้ว"], ["out", "🛵", "กำลังนำส่ง"], ["delivered", "🏠", "ส่งถึงมือ"]].map(([k, ic, t], i, arr) => { const cur = arr.findIndex(x => x[0] === (o.dlv || "wait_pickup")); return `<div class="s ${i < cur || o.dlv === "delivered" ? "on" : i === cur ? "cur" : ""}"><i>${i < cur || o.dlv === "delivered" ? "✓" : ic}</i>${t}</div>`; }).join("")}</div></div>` : ""}
    <div class="card"><h2>รายการ</h2><div class="sum">
      ${(o.lines || []).length ? o.lines.map(l => row(`${esc(l.name)} <small>${l.svc === "weight" ? "ชั่งกิโล" : l.wash ? esc(l.svcName) : esc(l.svcName) + " × " + l.qty}</small>`, baht(l.amount))).join("") : row(`${esc(o.service)} <small>${o.kg} ${esc(o.unit || "")}</small>`, "")}
      ${b.stainFee ? row("🧼 ค่าซักคราบพิเศษ", baht(b.stainFee)) : ""}${b.minTopUp ? row("📏 ปรับเป็นยอดขั้นต่ำ", "+" + baht(b.minTopUp)) : ""}
      ${b.expressFee ? row("⚡ งานด่วน", "+" + baht(b.expressFee)) : ""}${b.deliveryFee ? row("🛵 ค่ารับ-ส่ง", "+" + baht(b.deliveryFee)) : ""}
      ${b.promoDisc ? row("🏷️ ส่วนลด " + esc(b.promo), "−" + baht(b.promoDisc)) : ""}${b.pointsDisc ? row("⭐ ใช้แต้ม", "−" + baht(b.pointsDisc)) : ""}
      <div class="t"><span>รวม</span><span>${baht(o.total)}</span></div>
      <small>${o.paid ? "✅ ชำระเงินแล้ว" : "ชำระเงินตอนรับผ้า"}${o.delivery ? " · รับ-ส่งถึงบ้าน" : ""}${o.express ? " · งานด่วน" : ""}${b.vat ? ` · รวม VAT ${b.vat.toFixed(2)}` : ""}</small></div></div>
    ${photos.length ? `<div class="card"><h2>📸 รูปผ้าของคุณ</h2><p class="hint">ร้านถ่ายตอนรับผ้า เพื่อบันทึกสภาพก่อนซัก</p><div class="gal">${photos.map(p => `<a href="${esc(p.url)}" target="_blank"><img src="${esc(p.url)}" alt="${p.kind === "after" ? "หลังซัก" : "ก่อนซัก"}" loading="lazy"></a>`).join("")}</div></div>` : ""}
    ${o.points ? `<div class="pts">⭐ แต้มสะสมของคุณ ${o.points} แต้ม</div>` : ""}
    ${!o.linked && !done ? `<p class="hint" style="margin-top:12px">💬 อยากให้แจ้งเตือนทาง LINE? แอดไลน์ร้านแล้วพิมพ์ <b>คิว ${o.no} เบอร์ท้าย4ตัว</b></p>` : ""}
    <p class="hint" style="text-align:center;margin-top:16px"><a href="order.html">← สั่งซักเพิ่ม</a></p>`;
}
load(); setInterval(() => q && load(), 15000);
