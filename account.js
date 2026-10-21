const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const baht = n => "฿" + Math.round(n).toLocaleString("th-TH");
const J = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
const root = $("#root");
const next = new URLSearchParams(location.search).get("next");
const safeNext = next && /^\/[^/\\]/.test(next) || next === "/" ? next : null;   // กัน open-redirect: รับเฉพาะ path ภายในเว็บ
const STAGES = ["รับผ้า", "ซัก", "อบ", "รีด/พับ", "พร้อมรับ", "รับแล้ว"];

function authView(mode = "login", err = "") {
  root.innerHTML = `<div class="tabs"><button class="chip ${mode === "login" ? "on" : ""}" data-m="login">เข้าสู่ระบบ</button><button class="chip ${mode === "reg" ? "on" : ""}" data-m="reg">สมัครสมาชิก</button></div>
    <div class="card">
      ${mode === "reg" ? `<label>ชื่อ</label><input id="name" autocomplete="name">` : ""}
      <label>เบอร์โทร</label><input id="phone" inputmode="tel" autocomplete="tel">
      <label>รหัสผ่าน ${mode === "reg" ? '<span class="hint">(อย่างน้อย 8 ตัว)</span>' : ""}</label><input id="pw" type="password" autocomplete="${mode === "reg" ? "new-password" : "current-password"}">
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      <p><button class="btn" id="go" style="width:100%">${mode === "reg" ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</button></p>
      <p class="hint">${mode === "reg" ? "สมาชิกสะสมแต้มทุกออเดอร์ ใช้แต้มเป็นส่วนลด และรับแจ้งเตือนทาง LINE" : "ยังไม่มีบัญชี? กด “สมัครสมาชิก” ด้านบน"}</p></div>
    `;
  root.querySelectorAll("[data-m]").forEach(b => b.onclick = () => authView(b.dataset.m));
  $("#go").onclick = async () => {
    const body = { phone: $("#phone").value, password: $("#pw").value }; if (mode === "reg") body.name = $("#name").value;
    const r = await J(mode === "reg" ? "/api/auth/register" : "/api/auth/login", body), j = await r.json();
    if (!r.ok) return authView(mode, j.error);
    if (safeNext) return (location.href = safeNext);
    load();
  };
}

async function load() {
  const j = await (await fetch("/api/me")).json();
  if (!j.user) return authView();
  const { user, points, orders, shop } = j;
  root.innerHTML = `
    <div class="card"><h2>สวัสดี ${esc(user.name)}</h2><div class="hint">${esc(user.phone)}</div>
      <div class="pts" style="margin-top:10px">⭐ แต้มสะสม ${points} แต้ม<br><small style="font-weight:400">${shop.redeemStep} แต้ม = ${baht(shop.redeemBaht)} · จ่ายครบทุก 10 บาท ได้ 1 แต้ม</small></div>
      <p><a class="btn" href="order.html">สั่งซักเลย</a> <button class="btn o" id="out">ออกจากระบบ</button></p></div>
    ${user.lineEnabled ? `<div class="card"><h2>💬 รับแจ้งเตือนทาง LINE</h2>
      ${user.lineLinked ? `<div class="ok">เชื่อมต่อ LINE แล้ว — เราจะแจ้งเมื่อผ้าพร้อมรับ</div>`
        : `<p>1) เพิ่มเพื่อน LINE ร้าน ${shop.lineId ? `<b>${esc(shop.lineId)}</b>` : ""}<br>2) พิมพ์ข้อความนี้ส่งในแชต:</p><div class="script" style="font:800 26px var(--f);text-align:center;background:var(--bg);border:2px dashed var(--blue);padding:12px;border-radius:12px;user-select:all">ผูก ${esc(user.lineCode)}</div><p class="hint">แล้วรีเฟรชหน้านี้</p>`}</div>` : ""}
    <h2 style="margin-top:18px">ประวัติออเดอร์</h2>
    ${orders.map(o => `<div class="card"><div style="display:flex;justify-content:space-between"><b>คิว #${o.no}</b><span>${baht(o.total)} ${o.paid ? "✅" : ""}</span></div>
      <div class="hint">${new Date(o.created).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })} · ${o.incoming ? "รอร้านยืนยัน" : STAGES[o.stage]}</div>
      <a href="track.html?t=${o.token}">ดูสถานะ →</a></div>`).join("") || `<p class="hint">ยังไม่มีออเดอร์</p>`}`;
  $("#out").onclick = async () => { await J("/api/auth/logout"); load(); };
}
load();
