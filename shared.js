/* =====================================================================
   shared.js  —  ใช้ร่วมกันทั้ง index.html / kitchen.html / admin.html
   ต้องอัปโหลดไฟล์นี้ไว้ในโฟลเดอร์เดียวกับ 3 หน้าเสมอ
   ===================================================================== */

/* ---------- ตั้งค่าที่เจ้าของร้านแก้ได้ ---------- */
const APP_CONFIG = {
    // false = เปิดใช้ได้เลยเหมือนเดิม (ไม่ต้องล็อกอิน)
    // true  = ต้องล็อกอินด้วยอีเมล/รหัสผ่านก่อนใช้งาน (ทำตามไฟล์ SETUP-คู่มือ.md ก่อนเปิด!)
    REQUIRE_LOGIN: true,
    // อีเมลเจ้าของร้าน (ใช้เมื่อ REQUIRE_LOGIN = true) เฉพาะอีเมลนี้เข้า Admin ได้
    OWNER_EMAIL: 'olan.phetmany@gmail.com',
    // เตือนเมื่อแก้วเหลือน้อยกว่าจำนวนนี้
    LOW_CUP_ALERT: 50,
    // รหัสประเทศสำหรับ WhatsApp (ลาว = 856) ใช้เติมหน้าเบอร์ที่ขึ้นต้นด้วย 0
    COUNTRY_CODE: '856'
};

const firebaseConfig = {
    apiKey: "AIzaSyDAJUEFUWkieMGFxRIZ6vRwzLbXF31c_BM",
    authDomain: "augx-d75c2.firebaseapp.com",
    databaseURL: "https://augx-d75c2-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "augx-d75c2",
    storageBucket: "augx-d75c2.firebasestorage.app"
};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const database = firebase.database();

/* ---------- ฟังก์ชันช่วยทั่วไป ---------- */
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}
function money(n) { return Number(n || 0).toLocaleString() + ' ₭'; }
function pad2(n) { return String(n).padStart(2, '0'); }
function dayKey(ts) {
    const d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function timeHHMM(ts) {
    const d = new Date(ts || Date.now());
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// 'YYYY-MM-DD' -> {start,end} เป็น timestamp (เวลาท้องถิ่น)
function dayRange(dateStr) {
    const start = new Date(dateStr + 'T00:00:00').getTime();
    return { start: start, end: start + 86400000 - 1 };
}
// "S|30000, M|35000"  หรือ "35000"  ->  [{label, price}]
function parsePrices(raw) {
    raw = String(raw == null ? '' : raw).trim();
    if (!raw) return [];
    if (raw.indexOf('|') === -1) {
        const p = parseFloat(raw.replace(/,/g, ''));
        return isNaN(p) ? [] : [{ label: '', price: p }];
    }
    return raw.split(',').map(function (part) {
        const i = part.lastIndexOf('|');
        if (i < 0) return null;
        const label = part.slice(0, i).trim();
        const price = parseFloat(part.slice(i + 1));
        if (isNaN(price)) return null;
        return { label: label, price: price };
    }).filter(Boolean);
}
// "หวาน 50%|0, Extra shot|10000" -> [{name, price}]
function parseOptions(text) {
    return String(text || '').split(/[,\n]+/).map(function (part) {
        part = part.trim();
        if (!part) return null;
        const i = part.lastIndexOf('|');
        if (i < 0) return { name: part, price: 0 };
        const name = part.slice(0, i).trim();
        const price = parseFloat(part.slice(i + 1)) || 0;
        return name ? { name: name, price: price } : null;
    }).filter(Boolean);
}
function normalizeModifier(m) {
    // รองรับทั้งแบบใหม่ (รายการ {name, price}) และแบบเก่าที่เก็บเป็นข้อความ "หวาน 0%, หวาน 50%"
    let opts = m.options;
    if (typeof opts === 'string') opts = parseOptions(opts);
    else if (opts && typeof opts === 'object') opts = Array.isArray(opts) ? opts : Object.values(opts);
    else opts = [];
    m.options = opts.map(function (o) {
        if (typeof o === 'string') return parseOptions(o)[0] || null;
        if (o && typeof o === 'object') {
            const name = String(o.name || o.option || o.label || o.value || o.title || '').trim();
            return name ? { name: name, price: Number(o.price || 0) || 0 } : null;
        }
        return null;
    }).filter(Boolean);
    return m;
}

/* ---------- ข้อความแจ้งเตือนมุมจอ (แทน alert) ---------- */
function toast(msg, ok) {
    let box = document.getElementById('toast-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-box';
        box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:4000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
        document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'background:' + (ok === false ? '#ef4444' : '#1a365d') + ';color:#fff;padding:10px 18px;border-radius:8px;font-weight:bold;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:90vw;text-align:center;';
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
}

/* ---------- แจ้งเตือนเมื่ออินเทอร์เน็ตหลุด ---------- */
function watchConnection() {
    const bar = document.createElement('div');
    bar.id = 'conn-banner';
    bar.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:3000;background:#ef4444;color:#fff;text-align:center;padding:6px 10px;font-weight:bold;font-size:13px;';
    bar.textContent = '⚠️ อินเทอร์เน็ตหลุด — ออร์เดอร์ที่กดตอนนี้จะส่งเมื่อกลับมาออนไลน์ (อย่ารีเฟรชหรือปิดหน้านี้)';
    document.body.appendChild(bar);
    let timer = null;
    database.ref('.info/connected').on('value', function (s) {
        if (s.val() === true) { clearTimeout(timer); bar.style.display = 'none'; }
        else { clearTimeout(timer); timer = setTimeout(function () { bar.style.display = 'block'; }, 4000); }
    });
}

/* ---------- ระบบล็อกอิน (เปิดด้วย REQUIRE_LOGIN) ---------- */
function logoutApp() {
    if (APP_CONFIG.REQUIRE_LOGIN) { firebase.auth().signOut().then(function () { location.reload(); }); }
}
function startApp(role, init) {
    if (!APP_CONFIG.REQUIRE_LOGIN) { watchConnection(); init(); return; }

    const ov = document.createElement('div');
    ov.id = 'login-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:#1a365d;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
        '<div style="background:#fff;border-radius:12px;padding:26px;width:100%;max-width:340px;box-shadow:0 10px 30px rgba(0,0,0,.3);">' +
        '<div style="font-size:1.3rem;font-weight:bold;color:#1a365d;text-align:center;margin-bottom:4px;">AUGUSTX POS</div>' +
        '<div style="text-align:center;color:#64748b;font-size:13px;margin-bottom:16px;">' + (role === 'admin' ? 'เข้าสู่ระบบเจ้าของร้าน (Admin)' : 'เข้าสู่ระบบพนักงาน') + '</div>' +
        '<div id="login-form">' +
        '<input id="login-email" type="email" placeholder="อีเมล" style="width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:10px;font-size:14px;">' +
        '<input id="login-pass" type="password" placeholder="รหัสผ่าน" style="width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:10px;font-size:14px;">' +
        '<button id="login-btn" style="width:100%;padding:12px;background:#689f38;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:15px;cursor:pointer;">เข้าสู่ระบบ</button>' +
        '</div>' +
        '<div id="login-msg" style="color:#ef4444;font-size:13px;text-align:center;margin-top:10px;min-height:18px;"></div>' +
        '<button id="login-logout" style="display:none;width:100%;margin-top:8px;padding:10px;background:#1a365d;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">ออกจากระบบ / ใช้บัญชีอื่น</button>' +
        '</div>';
    document.body.appendChild(ov);

    const msg = document.getElementById('login-msg');
    const form = document.getElementById('login-form');
    const logoutBtn = document.getElementById('login-logout');
    function doLogin() {
        msg.textContent = '';
        firebase.auth().signInWithEmailAndPassword(
            document.getElementById('login-email').value.trim(),
            document.getElementById('login-pass').value
        ).catch(function (e) {
            const code = (e && e.code) || '';
            const th = {
                'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
                'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
                'auth/invalid-login-credentials': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
                'auth/user-not-found': 'ไม่พบบัญชีอีเมลนี้ใน Firebase',
                'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง (มีช่องว่างหรือตัวไทยติดมาหรือเปล่า)',
                'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป ระบบล็อกชั่วคราว รอ 10-15 นาทีแล้วลองใหม่',
                'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้',
                'auth/operation-not-allowed': 'ยังไม่ได้เปิด Email/Password ใน Firebase',
                'auth/user-disabled': 'บัญชีนี้ถูกปิดใช้งาน'
            };
            msg.textContent = (th[code] || 'เข้าสู่ระบบไม่สำเร็จ') + (code ? ' [' + code + ']' : '');
        });
    }
    document.getElementById('login-btn').onclick = doLogin;
    document.getElementById('login-pass').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
    logoutBtn.onclick = function () { firebase.auth().signOut(); };

    let started = false;
    firebase.auth().onAuthStateChanged(function (user) {
        if (!user) { ov.style.display = 'flex'; form.style.display = 'block'; logoutBtn.style.display = 'none'; return; }
        const owner = String(APP_CONFIG.OWNER_EMAIL || '').toLowerCase();
        if (role === 'admin' && owner && String(user.email || '').toLowerCase() !== owner) {
            ov.style.display = 'flex'; form.style.display = 'none';
            msg.textContent = 'บัญชีนี้ไม่มีสิทธิ์เข้าหน้า Admin';
            logoutBtn.style.display = 'block';
            return;
        }
        ov.style.display = 'none';
        if (!started) { started = true; watchConnection(); init(); }
    });
}

/* =====================================================================
   ส่วนที่ 2: บิล / ใบสั่งครัว / ยกเลิก / ใบเสร็จ / PDF / ส่งให้ลูกค้า
   - "บิล" เก็บที่ orders/{id}  (status: open = ยังไม่จ่าย, paid = จ่ายแล้ว, void = ยกเลิก)
   - "ใบสั่งครัว" เก็บที่ tickets/{id} (ครัวอ่านเฉพาะส่วนนี้) 1 บิลมีได้หลายใบ (สั่งเพิ่ม/ยกเลิกรายการ)
   ===================================================================== */

const VOID_REASONS = ['ลูกค้ายกเลิก', 'คีย์ผิด', 'ออร์เดอร์ซ้ำ', 'ของหมด', 'ลูกค้าไม่พอใจ', 'อื่นๆ'];

function arr(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x) : []); }
function fmtDate(ts) { const d = new Date(ts || Date.now()); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
function fmtDateTime(ts) { return fmtDate(ts) + ' ' + timeHHMM(ts); }
function newLid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function lineDetails(c) { return [c.variant].concat(arr(c.modifiers).map(function (m) { return m.option; })).filter(Boolean).join(' | '); }
function itemsSubtotal(items) { return arr(items).reduce(function (s, c) { return s + Number(c.price || 0) * Number(c.quantity || 0); }, 0); }

// บิลที่ยังไม่จ่าย (รวมบิลเก่าที่เคยบันทึกเป็น paid:false)
function isOpenBill(o) { return !!o && (o.status === 'open' || (o.paid === false && o.status !== 'void' && o.status !== 'paid')); }

function billCups(o) {
    const items = arr(o.items);
    if (items.some(function (i) { return i.cup !== undefined; })) {
        return items.reduce(function (s, i) { return s + (i.cup === false ? 0 : Number(i.quantity || 0)); }, 0);
    }
    return Number(o.cups || 0);
}
function billName(o) {
    if (o.source && o.source !== 'store' && o.source !== 'online') return o.source + (o.appOrderNo ? ' ' + o.appOrderNo : '');
    if (o.table) return 'โต๊ะ ' + o.table;
    if (o.customerName) return o.customerName;
    if (o.customer && String(o.customer).indexOf('โต๊ะ') === 0) return o.customer;
    return '';
}
function adjustCups(delta) {
    if (!delta) return;
    database.ref('inventory/cups').transaction(function (c) { return Math.max(0, (c || 0) + delta); });
}
function nextOrderNo(dk) {
    const tx = database.ref('counters/orders/' + dk).transaction(function (n) { return (n || 0) + 1; }).then(function (r) { return r.snapshot.val(); });
    const timeout = new Promise(function (res) { setTimeout(function () { res(null); }, 3000); });
    return Promise.race([tx, timeout]).then(function (v) { return v != null ? v : 'T' + String(Date.now()).slice(-5); });
}

/* ---------- ใบสั่งครัว ---------- */
// kind: 'new' = ใบแรก, 'add' = สั่งเพิ่ม, 'cancel' = ยกเลิกรายการ/ยกเลิกบิล
// สินค้าขายปลีก (ติ๊ก "ไม่เข้าครัว" ใน Admin) ไม่ต้องส่งเข้าครัว
function isRetailItemId(id) {
    if (!id || typeof globalItems === 'undefined' || !Array.isArray(globalItems)) return false;
    const it = globalItems.find(function (x) { return x.id === id; });
    return !!(it && it.retail === true);
}
function pushTicket(billId, bill, kind, items, round, note) {
    items = arr(items).filter(function (c) { return !isRetailItemId(c.itemId); });
    if (!items.length) return null;
    const ts = Date.now();
    const t = {
        billId: billId, orderNo: bill.orderNo || '', kind: kind, round: round || 1, note: note || '',
        items: arr(items).map(function (c) {
            return { name: c.name || '', variant: c.variant || '', modifiers: arr(c.modifiers), note: c.note || '', quantity: Number(c.quantity || 0) };
        }),
        name: billName(bill), source: bill.source || 'store', orderType: bill.orderType || '',
        status: 'pending', timestamp: ts, dayKey: dayKey(ts)
    };
    if (bill.trackTok) { t.trackTok = bill.trackTok; t.trackDelivery = !!bill.trackDelivery; }
    const r = database.ref('tickets').push(t);
    database.ref('orders/' + billId + '/tickets/' + r.key).set(true);
    return r.key;
}

/* ---------- สร้างบิลใหม่ + ใบสั่งครัวใบแรก ---------- */
async function createBill(d) {
    const now = Date.now(), dk = dayKey(now);
    const orderNo = await nextOrderNo(dk);
    const items = d.items.map(function (c) {
        return { lid: newLid(), itemId: c.itemId || '', name: c.name, variant: c.variant || '', price: Number(c.price || 0), quantity: c.quantity, modifiers: c.modifiers || [], note: c.note || '', cup: c.cup !== false, round: 1 };
    });
    const sub = itemsSubtotal(items);
    const bill = {
        orderNo: orderNo, customerName: d.customerName || '', customerPhone: d.customerPhone || '', customerEmail: d.customerEmail || '', customerId: d.customerId || '',
        table: d.table || '', appOrderNo: d.appOrderNo || '', items: items, subtotal: sub, discount: 0, total: sub,
        status: d.paidByApp ? 'paid' : 'open', paid: !!d.paidByApp, paymentMethod: d.paidByApp ? 'delivery' : '', cashReceived: 0, change: 0,
        source: d.source || 'store', orderType: d.orderType || '', rounds: 1,
        date: fmtDate(now), dayKey: dk, openedAt: now, timestamp: now
    };
    if (d.trackTok) { bill.trackTok = d.trackTok; bill.trackDelivery = !!d.trackDelivery; }
    bill.cups = billCups(bill);
    bill.customer = billName(bill) || 'ทั่วไป';
    if (d.paidByApp) bill.paidAt = now;
    const ref = database.ref('orders').push(bill);
    ref.catch(function (e) { toast('บันทึกบิลไม่สำเร็จ: ' + e.message, false); });
    pushTicket(ref.key, bill, 'new', items, 1, '');
    adjustCups(-bill.cups);
    return { id: ref.key, bill: bill };
}

/* ---------- สั่งเพิ่มในบิลที่เปิดอยู่ ---------- */
function addItemsToBill(id, newItems) {
    let round = 0, added = [];
    return database.ref('orders/' + id).transaction(function (o) {
        if (o === null) return o;
        if (!isOpenBill(o)) return;
        round = (o.rounds || 1) + 1;
        added = arr(newItems).map(function (c) {
            return { lid: newLid(), itemId: c.itemId || '', name: c.name, variant: c.variant || '', price: Number(c.price || 0), quantity: c.quantity, modifiers: c.modifiers || [], note: c.note || '', cup: c.cup !== false, round: round };
        });
        o.items = arr(o.items).concat(added);
        o.subtotal = itemsSubtotal(o.items);
        o.total = Math.max(0, o.subtotal - Number(o.discount || 0));
        o.rounds = round;
        o.status = 'open'; o.paid = false;
        o.cups = billCups(o);
        return o;
    }).then(function (res) {
        const bill = res.snapshot.val();
        if (!res.committed || !bill) throw new Error('บิลนี้ปิดหรือถูกยกเลิกไปแล้ว');
        pushTicket(id, bill, 'add', added, round, '');
        adjustCups(-added.reduce(function (s, i) { return s + (i.cup === false ? 0 : i.quantity); }, 0));
        return { bill: bill, round: round, added: added };
    });
}

/* ---------- ลบรายการออกจากบิลที่เปิดอยู่ (ครัวเห็นป้ายแดง "ยกเลิก") ---------- */
function removeBillLine(id, lid) {
    let removed = null;
    return database.ref('orders/' + id).transaction(function (o) {
        removed = null;
        if (o === null) return o;
        if (!isOpenBill(o)) return;
        const items = arr(o.items);
        let i = items.findIndex(function (x) { return x.lid === lid; });
        if (i < 0 && /^idx:\d+$/.test(String(lid))) i = parseInt(String(lid).slice(4), 10);
        if (i < 0 || i >= items.length || items.length <= 1) return;
        removed = items.splice(i, 1)[0];
        o.items = items;
        o.subtotal = itemsSubtotal(items);
        o.total = Math.max(0, o.subtotal - Number(o.discount || 0));
        o.removedItems = arr(o.removedItems).concat([{ name: removed.name, quantity: removed.quantity, price: removed.price, at: Date.now() }]);
        o.cups = billCups(o);
        return o;
    }).then(function (res) {
        const bill = res.snapshot.val();
        if (!res.committed || !bill || !removed) throw new Error('ลบรายการไม่ได้ (บิลปิดแล้ว หรือเหลือรายการเดียว ให้ใช้ยกเลิกบิลแทน)');
        pushTicket(id, bill, 'cancel', [removed], bill.rounds || 1, 'ลบรายการ');
        adjustCups(removed.cup === false ? 0 : Number(removed.quantity || 0));
        return bill;
    });
}

/* ---------- ชำระเงิน (ปิดบิล) ---------- */
// p: { discountType:'amount'|'percent', discountValue, method:'cash'|'transfer', cashReceived:'' หรือตัวเลข }
function payBill(id, p) {
    return database.ref('orders/' + id).transaction(function (o) {
        if (o === null) return o;
        if (!isOpenBill(o)) return;
        const sub = itemsSubtotal(o.items);
        const val = Math.max(0, Number(p.discountValue) || 0);
        let disc = p.discountType === 'percent' ? sub * Math.min(val, 100) / 100 : val;
        disc = Math.round(Math.min(disc, sub));
        const total = sub - disc;
        const cash = p.method === 'cash';
        const rec = cash ? ((p.cashReceived === '' || p.cashReceived == null) ? total : Number(p.cashReceived)) : 0;
        if (cash && rec < total) return;
        const now = Date.now();
        o.subtotal = sub; o.discount = disc; o.discountType = p.discountType || 'amount'; o.discountValue = val; o.total = total;
        o.status = 'paid'; o.paid = true; o.paymentMethod = p.method;
        o.cashReceived = cash ? rec : 0; o.change = cash ? Math.max(0, rec - total) : 0;
        o.openedAt = o.openedAt || o.timestamp || now;
        o.paidAt = now; o.timestamp = now; o.dayKey = dayKey(now); o.date = fmtDate(now);
        return o;
    }).then(function (res) {
        const bill = res.snapshot.val();
        if (!res.committed || !bill || bill.status !== 'paid') throw new Error('ชำระไม่สำเร็จ: บิลถูกปิดหรือยกเลิกไปแล้ว หรือรับเงินไม่พอ');
        return bill;
    });
}

/* ---------- ยกเลิกบิล ---------- */
// opts: { reason, by:'cashier'|'admin', refund:{status:'refunded'|'pending', method:'cash'|'transfer'|''} }
// เหตุผลที่แสดงให้ลูกค้าเห็น (ภาษาลาว) · เหตุผลที่ไม่ควรโชว์ลูกค้า = ไม่แสดง
const LAO_REASON = {
    'ลูกค้ายกเลิก': 'ລູກຄ້າຂໍຍົກເລີກ', 'คีย์ผิด': '', 'ออร์เดอร์ซ้ำ': 'ອໍເດີຊ້ຳ', 'ของหมด': 'ສິນຄ້າໝົດ', 'ลูกค้าไม่พอใจ': '', 'อื่นๆ': '',
    'ร้านปิดแล้ว': 'ຮ້ານປິດແລ້ວ', 'อยู่นอกพื้นที่ส่ง': 'ຢູ່ນອກເຂດຈັດສົ່ງ', 'ยังไม่ได้รับเงิน': 'ຍັງບໍ່ໄດ້ຮັບການຊຳລະ'
};
function laoReason(r) { r = String(r || '').trim(); return Object.prototype.hasOwnProperty.call(LAO_REASON, r) ? LAO_REASON[r] : ''; }
function voidBill(id, bill, opts) {
    const wasOpen = isOpenBill(bill);
    const base = 'orders/' + id + '/', upd = {};
    upd[base + 'status'] = 'void';
    upd[base + 'voidReason'] = opts.reason || '';
    upd[base + 'voidedBy'] = opts.by || '';
    upd[base + 'voidedAt'] = Date.now();
    upd[base + 'voidedWasPaid'] = !wasOpen;
    if (!wasOpen && opts.refund) {
        upd[base + 'refund'] = { status: opts.refund.status, method: opts.refund.method || '', amount: Number(bill.total || 0), at: Date.now() };
    }
    return database.ref().update(upd).then(function () {
        // ออร์เดอร์ที่ลูกค้าสั่งออนไลน์: แจ้งหน้าติดตามของลูกค้าว่ายกเลิก พร้อมเหตุผล (ภาษาลาว)
        if (bill.trackTok) database.ref('order_track/' + bill.trackTok).update({ status: 'rejected', reason: laoReason(opts.reason) }).catch(function () {});
        adjustCups(billCups(bill));
        if (wasOpen) {
            Object.keys(bill.tickets || {}).forEach(function (k) {
                database.ref('tickets/' + k + '/status').transaction(function (s) { return (s === 'pending' || s === 'cooking') ? 'canceled' : s; });
            });
            pushTicket(id, bill, 'cancel', arr(bill.items), bill.rounds || 1, 'ยกเลิกทั้งบิล: ' + (opts.reason || ''));
        }
    });
}

/* ---------- หน้าต่างย่อยที่ใช้ร่วมกัน (CSS ฉีดเอง ไม่ต้องแก้ CSS ของหน้า) ---------- */
function injectSharedCss() {
    if (document.getElementById('sx-css')) return;
    const st = document.createElement('style');
    st.id = 'sx-css';
    st.textContent =
        '.sx-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3500;display:flex;align-items:center;justify-content:center;padding:12px}' +
        '.sx-box{background:#fff;width:100%;max-width:440px;max-height:96vh;max-height:96dvh;overflow-y:auto;border-radius:12px;padding:18px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:inherit}' +
        '.sx-box label{display:block;font-weight:bold;font-size:12px;color:#555;margin:10px 0 4px}' +
        '.sx-box input,.sx-box textarea{width:100%;padding:11px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;font-family:inherit}' +
        '.sx-title{font-size:1.1rem;font-weight:bold;color:#1a365d;margin-bottom:6px}' +
        '.sx-hint{font-size:12px;color:#64748b;margin:8px 0}' +
        '.sx-warn{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;font-size:13px;font-weight:bold;margin:8px 0}' +
        '.sx-chips{display:flex;flex-wrap:wrap;gap:8px}' +
        '.sx-chip{padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-weight:bold;font-size:13px;cursor:pointer;color:#334155;font-family:inherit}' +
        '.sx-chip.on{background:#1a365d;color:#fff;border-color:#1a365d}' +
        '.sx-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}' +
        '.sx-btn{padding:13px 10px;border:none;border-radius:8px;font-weight:bold;font-size:14px;color:#fff;cursor:pointer;font-family:inherit}' +
        '.sx-btn:disabled{opacity:.45;cursor:not-allowed}' +
        '.sx-blue{background:#1a365d}.sx-green{background:#689f38}.sx-red{background:#ef4444}.sx-gray{background:#64748b}' +
        '.sx-close{width:100%;margin-top:10px;background:#e2e8f0;color:#334155}' +
        '.sx-row{display:flex;gap:8px;margin-top:14px}.sx-row .sx-btn{flex:1}';
    document.head.appendChild(st);
}
function sxModal(html) {
    injectSharedCss();
    const ov = document.createElement('div');
    ov.className = 'sx-overlay';
    ov.innerHTML = '<div class="sx-box">' + html + '</div>';
    document.body.appendChild(ov);
    return ov;
}

// หน้าต่างยกเลิกบิล: เลือกเหตุผล (บังคับ) + ถ้าจ่ายแล้วต้องระบุสถานะคืนเงิน
function openVoidDialog(id, bill, by, onDone) {
    const paid = !isOpenBill(bill);
    const refundable = paid && (bill.paymentMethod === 'cash' || bill.paymentMethod === 'transfer');
    let reason = '', refund = null;
    const ov = sxModal(
        '<div class="sx-title">ยกเลิกบิล #' + esc(bill.orderNo || '') + ' ?</div>' +
        '<div class="sx-hint">ยอด ' + money(bill.total) + (paid ? ' (ชำระแล้ว)' : ' (ยังไม่ชำระ)') + '</div>' +
        (paid ? '<div class="sx-warn">บิลนี้ชำระแล้ว ยกเลิกแล้วอาจต้องคืนเงินลูกค้า</div>' : '') +
        '<label>เหตุผล (จำเป็น)</label><div class="sx-chips" id="vd-reasons">' +
        VOID_REASONS.map(function (r) { return '<button type="button" class="sx-chip" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
        '<div id="vd-other" style="display:none"><input id="vd-other-text" placeholder="ระบุเหตุผล"></div>' +
        (refundable ? '<label>การคืนเงิน (จำเป็น)</label><div class="sx-chips" id="vd-refunds">' +
            '<button type="button" class="sx-chip" data-s="refunded" data-m="cash">คืนเงินสดแล้ว</button>' +
            '<button type="button" class="sx-chip" data-s="refunded" data-m="transfer">โอนคืนแล้ว</button>' +
            '<button type="button" class="sx-chip" data-s="pending" data-m="">ยังไม่ได้คืน</button></div>' : '') +
        '<div class="sx-row"><button class="sx-btn sx-gray" id="vd-no">ไม่ยกเลิก</button><button class="sx-btn sx-red" id="vd-yes">ยืนยันยกเลิกบิล</button></div>'
    );
    ov.querySelectorAll('#vd-reasons .sx-chip').forEach(function (b) {
        b.onclick = function () {
            ov.querySelectorAll('#vd-reasons .sx-chip').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on'); reason = b.dataset.r;
            ov.querySelector('#vd-other').style.display = reason === 'อื่นๆ' ? 'block' : 'none';
        };
    });
    ov.querySelectorAll('#vd-refunds .sx-chip').forEach(function (b) {
        b.onclick = function () {
            ov.querySelectorAll('#vd-refunds .sx-chip').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on'); refund = { status: b.dataset.s, method: b.dataset.m };
        };
    });
    ov.querySelector('#vd-no').onclick = function () { ov.remove(); };
    ov.querySelector('#vd-yes').onclick = function () {
        let r = reason;
        if (!r) return toast('เลือกเหตุผลก่อน', false);
        if (r === 'อื่นๆ') { r = ov.querySelector('#vd-other-text').value.trim(); if (!r) return toast('ระบุเหตุผล', false); }
        if (refundable && !refund) return toast('เลือกสถานะการคืนเงินก่อน', false);
        ov.querySelector('#vd-yes').disabled = true;
        voidBill(id, bill, { reason: r, by: by, refund: refund }).then(function () {
            ov.remove(); toast('ยกเลิกบิลแล้ว');
            if (onDone) onDone();
        }).catch(function (e) { ov.querySelector('#vd-yes').disabled = false; toast('ไม่สำเร็จ: ' + e.message, false); });
    };
}

/* =====================================================================
   ใบเสร็จ: โมเดลเดียว ใช้ได้ทั้งพิมพ์ / รูป-PDF / ข้อความ
   ===================================================================== */
const RCPT = { s: { paperSize: '58mm', shopName: 'AUGUSTX', shopSub: 'HOME COFFEE RECIPE', address: '', phone: '', footer: 'ขอบคุณที่ใช้บริการ' }, logo: '', started: false };
function receiptInit() {
    if (RCPT.started) return;
    RCPT.started = true;
    stickerInit();
    database.ref('settings/printer').on('value', function (snap) {
        const p = snap.val() || {};
        Object.keys(p).forEach(function (k) { if (p[k] !== '' && p[k] != null) RCPT.s[k] = p[k]; });
        RCPT.s.address = p.address || ''; RCPT.s.phone = p.phone || '';
        if (typeof onReceiptSettings === 'function') onReceiptSettings(RCPT.s);
    });
    database.ref('store_logo').on('value', function (s) { RCPT.logo = s.val() || ''; });
}

function receiptModel(o, copy) {
    const S = RCPT.s, m = [], items = arr(o.items);
    if (RCPT.logo) m.push({ t: 'logo' });
    m.push({ t: 'c', x: S.shopName, b: 1, z: 18 });
    if (S.shopSub) m.push({ t: 'c', x: S.shopSub });
    if (S.address) m.push({ t: 'c', x: S.address });
    if (S.phone) m.push({ t: 'c', x: 'โทร ' + S.phone });
    if (copy) { m.push({ t: 'c', x: '*** สำเนา (COPY) ***', b: 1, z: 15 }); m.push({ t: 'c', x: 'พิมพ์เมื่อ ' + fmtDateTime(Date.now()) }); }
    if (o.status === 'void') m.push({ t: 'c', x: '*** ยกเลิก (VOID) ***', b: 1, z: 16 });
    m.push({ t: 'hr' });
    m.push({ t: 'r', l: 'บิล #' + (o.orderNo || '-'), r: fmtDateTime(o.paidAt || o.timestamp) });
    const where = o.table ? 'โต๊ะ ' + o.table : (o.source && o.source !== 'store' ? o.source : '');
    if (o.orderType || where) m.push({ t: 'r', l: o.orderType || '', r: where });
    if (o.appOrderNo) m.push({ t: 'r', l: 'เลขออร์เดอร์แอป', r: String(o.appOrderNo) });
    if (o.customerName) m.push({ t: 'r', l: 'ลูกค้า', r: o.customerName });
    m.push({ t: 'hr' });
    items.forEach(function (c) {
        m.push({ t: 'r', l: c.name + ' x' + c.quantity, r: (Number(c.price || 0) * Number(c.quantity || 0)).toLocaleString() });
        const d = lineDetails(c);
        if (d) m.push({ t: 'i', x: d });
        if (c.note) m.push({ t: 'i', x: '* ' + c.note });
    });
    m.push({ t: 'hr' });
    const sub = o.subtotal != null ? o.subtotal : itemsSubtotal(items);
    m.push({ t: 'r', l: 'รวม', r: Number(sub).toLocaleString() });
    if (Number(o.discount) > 0) m.push({ t: 'r', l: 'ส่วนลด', r: '-' + Number(o.discount).toLocaleString() });
    m.push({ t: 'r', l: 'ยอดสุทธิ', r: Number(o.total || 0).toLocaleString() + ' ₭', b: 1, z: 16 });
    if (o.paymentMethod === 'cash') {
        m.push({ t: 'r', l: 'เงินสด', r: Number(o.cashReceived || 0).toLocaleString() });
        m.push({ t: 'r', l: 'เงินทอน', r: Number(o.change || 0).toLocaleString() });
    } else if (o.paymentMethod === 'transfer') m.push({ t: 'r', l: 'ชำระโดย', r: 'โอนเงิน QR' });
    else if (o.paymentMethod === 'delivery') m.push({ t: 'r', l: 'ชำระโดย', r: 'แอป Delivery' });
    m.push({ t: 'hr' });
    m.push({ t: 'c', x: S.footer || '' });
    return m;
}

function receiptText(o) {
    const S = RCPT.s;
    let t = S.shopName + '\n' + 'บิล #' + (o.orderNo || '-') + '  ' + fmtDateTime(o.paidAt || o.timestamp) + '\n----------------\n';
    arr(o.items).forEach(function (c) {
        const d = lineDetails(c);
        t += c.name + (d ? ' (' + d + ')' : '') + ' x' + c.quantity + '  ' + (Number(c.price || 0) * Number(c.quantity || 0)).toLocaleString() + '\n';
    });
    t += '----------------\n';
    if (Number(o.discount) > 0) t += 'ส่วนลด -' + Number(o.discount).toLocaleString() + '\n';
    t += 'ยอดสุทธิ ' + Number(o.total || 0).toLocaleString() + ' ₭\n';
    if (S.footer) t += '\n' + S.footer;
    return t;
}

/* ---------- พิมพ์ใบเสร็จ ---------- */
function ensurePrintArea() {
    let a = document.getElementById('print-area');
    if (a) return a;
    a = document.createElement('div'); a.id = 'print-area'; document.body.appendChild(a);
    const st = document.createElement('style'); st.id = 'print-css';
    st.textContent = '#print-area{display:none}@media print{html,body{height:auto!important;overflow:visible!important;background:#fff!important}' +
        'body>*:not(#print-area){display:none!important}#print-area{display:block;margin:0 auto;color:#000;line-height:1.4;font-size:12px}' +
        '.r-c{text-align:center}.r-hr{border-top:1px dashed #000;margin:6px 0}.r-r{display:flex;justify-content:space-between;gap:6px}' +
        '.r-b{font-weight:bold}.r-i{padding-left:8px;font-size:11px}#print-area img{max-width:100%;max-height:70px}}';
    document.head.appendChild(st);
    const ps = document.createElement('style'); ps.id = 'print-page-style'; document.head.appendChild(ps);
    return a;
}
// copy = true จะพิมพ์คำว่า "สำเนา (COPY)"; id = ใส่เพื่อนับจำนวนครั้งที่พิมพ์
function printReceipt(o, copy, id) {
    const area = ensurePrintArea();
    const narrow = RCPT.s.paperSize !== '80mm';
    let h = '';
    receiptModel(o, copy).forEach(function (e) {
        const z = e.z ? ' style="font-size:' + e.z + 'px"' : '';
        if (e.t === 'logo') h += '<div class="r-c"><img src="' + esc(RCPT.logo) + '"></div>';
        else if (e.t === 'hr') h += '<div class="r-hr"></div>';
        else if (e.t === 'c') h += '<div class="r-c' + (e.b ? ' r-b' : '') + '"' + z + '>' + esc(e.x) + '</div>';
        else if (e.t === 'i') h += '<div class="r-i">' + esc(e.x) + '</div>';
        else if (e.t === 'r') h += '<div class="r-r' + (e.b ? ' r-b' : '') + '"' + z + '><span>' + esc(e.l) + '</span><span>' + esc(e.r) + '</span></div>';
    });
    area.style.width = narrow ? '48mm' : '72mm';
    area.innerHTML = h;
    document.getElementById('print-page-style').textContent = '@page{size:' + (narrow ? '58mm' : '80mm') + ' auto;margin:2mm}';
    if (id) database.ref('orders/' + id + '/printCount').transaction(function (n) { return (n || 0) + 1; });
    setTimeout(function () { window.print(); }, 150);
}

/* ---------- ใบเสร็จเป็นรูป -> PDF ---------- */
async function receiptCanvas(o, copy) {
    const wide = RCPT.s.paperSize === '80mm';
    const W = wide ? 576 : 384, PAD = 14, SC = 2;
    const F = '"Noto Sans Lao","Noto Sans Thai","Noto Sans",sans-serif';
    const model = receiptModel(o, copy);
    let logoImg = null;
    if (RCPT.logo) {
        logoImg = await new Promise(function (res) { const im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = RCPT.logo; });
    }
    try { if (document.fonts && document.fonts.load) { await document.fonts.load('14px "Noto Sans Lao"'); await document.fonts.load('bold 14px "Noto Sans Lao"'); } } catch (e) { }
    function layout(ctx, draw) {
        let y = PAD; const cw = W - PAD * 2;
        const font = function (b, z) { return (b ? 'bold ' : '') + (z || 14) + 'px ' + F; };
        function wrap(text, maxW, f) {
            ctx.font = f; const out = []; let cur = '';
            for (const ch of String(text == null ? '' : text)) {
                if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; } else cur += ch;
            }
            out.push(cur); return out;
        }
        model.forEach(function (e) {
            if (e.t === 'logo') {
                if (logoImg) {
                    const h = Math.min(70, logoImg.height * (Math.min(cw, 200) / logoImg.width)), w = logoImg.width * (h / logoImg.height);
                    if (draw) ctx.drawImage(logoImg, (W - w) / 2, y, w, h);
                    y += h + 6;
                }
            } else if (e.t === 'hr') {
                if (draw) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(PAD, y + 4); ctx.lineTo(W - PAD, y + 4); ctx.stroke(); ctx.setLineDash([]); }
                y += 10;
            } else if (e.t === 'c' || e.t === 'i') {
                const z = e.z || (e.t === 'i' ? 12 : 14), f = font(e.b, z), lh = Math.round(z * 1.45), ind = e.t === 'i' ? 10 : 0;
                wrap(e.x, cw - ind, f).forEach(function (L) {
                    if (draw) {
                        ctx.font = f; ctx.fillStyle = '#000';
                        if (e.t === 'c') { ctx.textAlign = 'center'; ctx.fillText(L, W / 2, y + z); } else { ctx.textAlign = 'left'; ctx.fillText(L, PAD + ind, y + z); }
                    }
                    y += lh;
                });
            } else if (e.t === 'r') {
                const z = e.z || 14, f = font(e.b, z), lh = Math.round(z * 1.45);
                ctx.font = f; const rw = ctx.measureText(e.r || '').width;
                const lines = wrap(e.l, Math.max(60, cw - rw - 8), f);
                lines.forEach(function (L, idx) {
                    if (draw) {
                        ctx.font = f; ctx.fillStyle = '#000';
                        ctx.textAlign = 'left'; ctx.fillText(L, PAD, y + z);
                        if (idx === lines.length - 1) { ctx.textAlign = 'right'; ctx.fillText(e.r || '', W - PAD, y + z); }
                    }
                    y += lh;
                });
            }
        });
        return y + PAD;
    }
    const H = Math.ceil(layout(document.createElement('canvas').getContext('2d'), false));
    const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC;
    const ctx = cv.getContext('2d'); ctx.scale(SC, SC); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    layout(ctx, true);
    return cv;
}

// สร้างไฟล์ PDF 1 หน้า จากรูป JPEG (ไม่ต้องใช้ไลบรารีภายนอก)
function buildPdf(jpeg, wPx, hPx, wPt, hPt) {
    const enc = new TextEncoder(), parts = [], offsets = []; let off = 0;
    function push(u8) { parts.push(u8); off += u8.length; }
    function str(s) { push(enc.encode(s)); }
    function obj(n, body) { offsets[n] = off; str(n + ' 0 obj\n' + body + '\nendobj\n'); }
    const w = wPt.toFixed(2), h = hPt.toFixed(2);
    str('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = off;
    str('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + wPx + ' /Height ' + hPx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    push(jpeg); str('\nendstream\nendobj\n');
    const content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q';
    obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    const xrefPos = off;
    let x = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    str(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF');
    const out = new Uint8Array(off); let p = 0;
    parts.forEach(function (u) { out.set(u, p); p += u.length; });
    return out;
}
async function receiptPdfFile(o, copy) {
    const cv = await receiptCanvas(o, copy);
    const blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.92); });
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const wPt = RCPT.s.paperSize === '80mm' ? 226.8 : 164.4;
    const pdf = buildPdf(jpeg, cv.width, cv.height, wPt, wPt * cv.height / cv.width);
    return new File([pdf], 'receipt-' + (o.orderNo || 'bill') + '.pdf', { type: 'application/pdf' });
}

/* ---------- ส่งใบเสร็จให้ลูกค้า (แชร์ไฟล์ + WhatsApp + อีเมล) ---------- */
function waNumber(raw) {
    let d = String(raw || '').replace(/[^\d]/g, '');
    if (!d) return '';
    const cc = String(APP_CONFIG.COUNTRY_CODE || '856');
    if (d.indexOf('00') === 0) return d.slice(2);
    if (d.charAt(0) === '0') return cc + d.slice(1);
    if (d.indexOf(cc) === 0 && d.length >= 11) return d;
    return cc + d;
}
function openShareModal(o) {
    const ov = sxModal(
        '<div class="sx-title">ส่งใบเสร็จให้ลูกค้า (บิล #' + esc(o.orderNo || '') + ')</div>' +
        '<label>เบอร์ WhatsApp</label><input id="sx-phone" type="tel" inputmode="tel" value="' + esc(o.customerPhone || '') + '" placeholder="เช่น 020 5555 5555">' +
        '<label>อีเมล</label><input id="sx-email" type="email" inputmode="email" value="' + esc(o.customerEmail || '') + '" placeholder="name@example.com">' +
        '<div class="sx-hint" id="sx-state">กำลังเตรียมไฟล์ PDF...</div>' +
        '<div class="sx-grid">' +
        '<button class="sx-btn sx-blue" id="sx-share" disabled>📎 แชร์ไฟล์ PDF</button>' +
        '<button class="sx-btn sx-gray" id="sx-dl" disabled>⬇️ ดาวน์โหลด PDF</button>' +
        '<button class="sx-btn sx-green" id="sx-wa">💬 WhatsApp (ข้อความ)</button>' +
        '<button class="sx-btn sx-gray" id="sx-mail">✉️ อีเมล (ข้อความ)</button></div>' +
        '<button class="sx-btn sx-close" id="sx-close">ปิด</button>'
    );
    let file = null;
    const $ = function (s) { return ov.querySelector(s); };
    receiptPdfFile(o, false).then(function (f) {
        file = f; $('#sx-share').disabled = false; $('#sx-dl').disabled = false;
        $('#sx-state').textContent = 'พร้อมส่ง: บนมือถือกด "แชร์ไฟล์ PDF" แล้วเลือก WhatsApp หรืออีเมล บนคอมกด "ดาวน์โหลด" แล้วแนบเอง';
    }).catch(function (e) { $('#sx-state').textContent = 'สร้างไฟล์ไม่สำเร็จ: ' + e.message + ' (ยังส่งแบบข้อความได้)'; });
    function download() {
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }
    $('#sx-dl').onclick = download;
    $('#sx-share').onclick = function () {
        if (!file) return;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: 'ใบเสร็จ #' + (o.orderNo || ''), text: receiptText(o) }).catch(function (e) { if (e && e.name !== 'AbortError') toast('แชร์ไม่สำเร็จ ลองดาวน์โหลดแทน', false); });
        } else { download(); toast('อุปกรณ์นี้แชร์ไฟล์ตรงไม่ได้ ดาวน์โหลดแล้ว ให้แนบเองในแอป'); }
    };
    $('#sx-wa').onclick = function () {
        const n = waNumber($('#sx-phone').value);
        if (!n) return toast('ใส่เบอร์ WhatsApp ก่อน', false);
        window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(receiptText(o)), '_blank');
    };
    $('#sx-mail').onclick = function () {
        const e = $('#sx-email').value.trim();
        if (!e) return toast('ใส่อีเมลก่อน', false);
        window.location.href = 'mailto:' + encodeURIComponent(e).replace(/%40/g, '@') + '?subject=' + encodeURIComponent('ใบเสร็จ ' + RCPT.s.shopName + ' #' + (o.orderNo || '')) + '&body=' + encodeURIComponent(receiptText(o));
    };
    $('#sx-close').onclick = function () { ov.remove(); };
}

/* ===== QR encoder (QRCode for JavaScript, (c) 2009 Kazuhiko Arase, MIT license) ===== */
var QRLib=(function(){var M={};var C0={};function R(n){n=n.replace('./','');if(!C0[n])C0[n]=M[n]();return C0[n];}
M['QRMode']=(function(){var module={exports:{}};var exports=module.exports;
module.exports = {
    MODE_NUMBER :       1 << 0,
    MODE_ALPHA_NUM :    1 << 1,
    MODE_8BIT_BYTE :    1 << 2,
    MODE_KANJI :        1 << 3
};

return module.exports;});
M['QRErrorCorrectLevel']=(function(){var module={exports:{}};var exports=module.exports;
module.exports = {
	L : 1,
	M : 0,
	Q : 3,
	H : 2
};


return module.exports;});
M['QRMaskPattern']=(function(){var module={exports:{}};var exports=module.exports;
module.exports = {
	PATTERN000 : 0,
	PATTERN001 : 1,
	PATTERN010 : 2,
	PATTERN011 : 3,
	PATTERN100 : 4,
	PATTERN101 : 5,
	PATTERN110 : 6,
	PATTERN111 : 7
};

return module.exports;});
M['QRMath']=(function(){var module={exports:{}};var exports=module.exports;
var QRMath = {

	glog : function(n) {
	
		if (n < 1) {
			throw new Error("glog(" + n + ")");
		}
		
		return QRMath.LOG_TABLE[n];
	},
	
	gexp : function(n) {
	
		while (n < 0) {
			n += 255;
		}
	
		while (n >= 256) {
			n -= 255;
		}
	
		return QRMath.EXP_TABLE[n];
	},
	
	EXP_TABLE : new Array(256),
	
	LOG_TABLE : new Array(256)

};
	
for (var i = 0; i < 8; i++) {
	QRMath.EXP_TABLE[i] = 1 << i;
}
for (var i = 8; i < 256; i++) {
	QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4]
		^ QRMath.EXP_TABLE[i - 5]
		^ QRMath.EXP_TABLE[i - 6]
		^ QRMath.EXP_TABLE[i - 8];
}
for (var i = 0; i < 255; i++) {
	QRMath.LOG_TABLE[QRMath.EXP_TABLE[i] ] = i;
}

module.exports = QRMath;

return module.exports;});
M['QRPolynomial']=(function(){var module={exports:{}};var exports=module.exports;
var QRMath = R('./QRMath');

function QRPolynomial(num, shift) {
	if (num.length === undefined) {
		throw new Error(num.length + "/" + shift);
	}

	var offset = 0;

	while (offset < num.length && num[offset] === 0) {
		offset++;
	}

	this.num = new Array(num.length - offset + shift);
	for (var i = 0; i < num.length - offset; i++) {
		this.num[i] = num[i + offset];
	}
}

QRPolynomial.prototype = {

	get : function(index) {
		return this.num[index];
	},
	
	getLength : function() {
		return this.num.length;
	},
	
	multiply : function(e) {
	
		var num = new Array(this.getLength() + e.getLength() - 1);
	
		for (var i = 0; i < this.getLength(); i++) {
			for (var j = 0; j < e.getLength(); j++) {
				num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i) ) + QRMath.glog(e.get(j) ) );
			}
		}
	
		return new QRPolynomial(num, 0);
	},
	
	mod : function(e) {
	
		if (this.getLength() - e.getLength() < 0) {
			return this;
		}
	
		var ratio = QRMath.glog(this.get(0) ) - QRMath.glog(e.get(0) );
	
		var num = new Array(this.getLength() );
		
		for (var i = 0; i < this.getLength(); i++) {
			num[i] = this.get(i);
		}
		
		for (var x = 0; x < e.getLength(); x++) {
			num[x] ^= QRMath.gexp(QRMath.glog(e.get(x) ) + ratio);
		}
	
		// recursive call
		return new QRPolynomial(num, 0).mod(e);
	}
};

module.exports = QRPolynomial;

return module.exports;});
M['QRRSBlock']=(function(){var module={exports:{}};var exports=module.exports;
var QRErrorCorrectLevel = R('./QRErrorCorrectLevel');

function QRRSBlock(totalCount, dataCount) {
	this.totalCount = totalCount;
	this.dataCount  = dataCount;
}

QRRSBlock.RS_BLOCK_TABLE = [

	// L
	// M
	// Q
	// H

	// 1
	[1, 26, 19],
	[1, 26, 16],
	[1, 26, 13],
	[1, 26, 9],
	
	// 2
	[1, 44, 34],
	[1, 44, 28],
	[1, 44, 22],
	[1, 44, 16],

	// 3
	[1, 70, 55],
	[1, 70, 44],
	[2, 35, 17],
	[2, 35, 13],

	// 4		
	[1, 100, 80],
	[2, 50, 32],
	[2, 50, 24],
	[4, 25, 9],
	
	// 5
	[1, 134, 108],
	[2, 67, 43],
	[2, 33, 15, 2, 34, 16],
	[2, 33, 11, 2, 34, 12],
	
	// 6
	[2, 86, 68],
	[4, 43, 27],
	[4, 43, 19],
	[4, 43, 15],
	
	// 7		
	[2, 98, 78],
	[4, 49, 31],
	[2, 32, 14, 4, 33, 15],
	[4, 39, 13, 1, 40, 14],
	
	// 8
	[2, 121, 97],
	[2, 60, 38, 2, 61, 39],
	[4, 40, 18, 2, 41, 19],
	[4, 40, 14, 2, 41, 15],
	
	// 9
	[2, 146, 116],
	[3, 58, 36, 2, 59, 37],
	[4, 36, 16, 4, 37, 17],
	[4, 36, 12, 4, 37, 13],
	
	// 10		
	[2, 86, 68, 2, 87, 69],
	[4, 69, 43, 1, 70, 44],
	[6, 43, 19, 2, 44, 20],
	[6, 43, 15, 2, 44, 16],

	// 11
	[4, 101, 81],
	[1, 80, 50, 4, 81, 51],
	[4, 50, 22, 4, 51, 23],
	[3, 36, 12, 8, 37, 13],

	// 12
	[2, 116, 92, 2, 117, 93],
	[6, 58, 36, 2, 59, 37],
	[4, 46, 20, 6, 47, 21],
	[7, 42, 14, 4, 43, 15],

	// 13
	[4, 133, 107],
	[8, 59, 37, 1, 60, 38],
	[8, 44, 20, 4, 45, 21],
	[12, 33, 11, 4, 34, 12],

	// 14
	[3, 145, 115, 1, 146, 116],
	[4, 64, 40, 5, 65, 41],
	[11, 36, 16, 5, 37, 17],
	[11, 36, 12, 5, 37, 13],

	// 15
	[5, 109, 87, 1, 110, 88],
	[5, 65, 41, 5, 66, 42],
	[5, 54, 24, 7, 55, 25],
	[11, 36, 12],

	// 16
	[5, 122, 98, 1, 123, 99],
	[7, 73, 45, 3, 74, 46],
	[15, 43, 19, 2, 44, 20],
	[3, 45, 15, 13, 46, 16],

	// 17
	[1, 135, 107, 5, 136, 108],
	[10, 74, 46, 1, 75, 47],
	[1, 50, 22, 15, 51, 23],
	[2, 42, 14, 17, 43, 15],

	// 18
	[5, 150, 120, 1, 151, 121],
	[9, 69, 43, 4, 70, 44],
	[17, 50, 22, 1, 51, 23],
	[2, 42, 14, 19, 43, 15],

	// 19
	[3, 141, 113, 4, 142, 114],
	[3, 70, 44, 11, 71, 45],
	[17, 47, 21, 4, 48, 22],
	[9, 39, 13, 16, 40, 14],

	// 20
	[3, 135, 107, 5, 136, 108],
	[3, 67, 41, 13, 68, 42],
	[15, 54, 24, 5, 55, 25],
	[15, 43, 15, 10, 44, 16],

	// 21
	[4, 144, 116, 4, 145, 117],
	[17, 68, 42],
	[17, 50, 22, 6, 51, 23],
	[19, 46, 16, 6, 47, 17],

	// 22
	[2, 139, 111, 7, 140, 112],
	[17, 74, 46],
	[7, 54, 24, 16, 55, 25],
	[34, 37, 13],

	// 23
	[4, 151, 121, 5, 152, 122],
	[4, 75, 47, 14, 76, 48],
	[11, 54, 24, 14, 55, 25],
	[16, 45, 15, 14, 46, 16],

	// 24
	[6, 147, 117, 4, 148, 118],
	[6, 73, 45, 14, 74, 46],
	[11, 54, 24, 16, 55, 25],
	[30, 46, 16, 2, 47, 17],

	// 25
	[8, 132, 106, 4, 133, 107],
	[8, 75, 47, 13, 76, 48],
	[7, 54, 24, 22, 55, 25],
	[22, 45, 15, 13, 46, 16],

	// 26
	[10, 142, 114, 2, 143, 115],
	[19, 74, 46, 4, 75, 47],
	[28, 50, 22, 6, 51, 23],
	[33, 46, 16, 4, 47, 17],

	// 27
	[8, 152, 122, 4, 153, 123],
	[22, 73, 45, 3, 74, 46],
	[8, 53, 23, 26, 54, 24],
	[12, 45, 15, 28, 46, 16],

	// 28
	[3, 147, 117, 10, 148, 118],
	[3, 73, 45, 23, 74, 46],
	[4, 54, 24, 31, 55, 25],
	[11, 45, 15, 31, 46, 16],

	// 29
	[7, 146, 116, 7, 147, 117],
	[21, 73, 45, 7, 74, 46],
	[1, 53, 23, 37, 54, 24],
	[19, 45, 15, 26, 46, 16],

	// 30
	[5, 145, 115, 10, 146, 116],
	[19, 75, 47, 10, 76, 48],
	[15, 54, 24, 25, 55, 25],
	[23, 45, 15, 25, 46, 16],

	// 31
	[13, 145, 115, 3, 146, 116],
	[2, 74, 46, 29, 75, 47],
	[42, 54, 24, 1, 55, 25],
	[23, 45, 15, 28, 46, 16],

	// 32
	[17, 145, 115],
	[10, 74, 46, 23, 75, 47],
	[10, 54, 24, 35, 55, 25],
	[19, 45, 15, 35, 46, 16],

	// 33
	[17, 145, 115, 1, 146, 116],
	[14, 74, 46, 21, 75, 47],
	[29, 54, 24, 19, 55, 25],
	[11, 45, 15, 46, 46, 16],

	// 34
	[13, 145, 115, 6, 146, 116],
	[14, 74, 46, 23, 75, 47],
	[44, 54, 24, 7, 55, 25],
	[59, 46, 16, 1, 47, 17],

	// 35
	[12, 151, 121, 7, 152, 122],
	[12, 75, 47, 26, 76, 48],
	[39, 54, 24, 14, 55, 25],
	[22, 45, 15, 41, 46, 16],

	// 36
	[6, 151, 121, 14, 152, 122],
	[6, 75, 47, 34, 76, 48],
	[46, 54, 24, 10, 55, 25],
	[2, 45, 15, 64, 46, 16],

	// 37
	[17, 152, 122, 4, 153, 123],
	[29, 74, 46, 14, 75, 47],
	[49, 54, 24, 10, 55, 25],
	[24, 45, 15, 46, 46, 16],

	// 38
	[4, 152, 122, 18, 153, 123],
	[13, 74, 46, 32, 75, 47],
	[48, 54, 24, 14, 55, 25],
	[42, 45, 15, 32, 46, 16],

	// 39
	[20, 147, 117, 4, 148, 118],
	[40, 75, 47, 7, 76, 48],
	[43, 54, 24, 22, 55, 25],
	[10, 45, 15, 67, 46, 16],

	// 40
	[19, 148, 118, 6, 149, 119],
	[18, 75, 47, 31, 76, 48],
	[34, 54, 24, 34, 55, 25],
	[20, 45, 15, 61, 46, 16]
];

QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
	
	var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
	
	if (rsBlock === undefined) {
		throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
	}

	var length = rsBlock.length / 3;
	
	var list = [];
	
	for (var i = 0; i < length; i++) {

		var count = rsBlock[i * 3 + 0];
		var totalCount = rsBlock[i * 3 + 1];
		var dataCount  = rsBlock[i * 3 + 2];

		for (var j = 0; j < count; j++) {
			list.push(new QRRSBlock(totalCount, dataCount) );	
		}
	}
	
	return list;
};

QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {

	switch(errorCorrectLevel) {
	case QRErrorCorrectLevel.L :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
	case QRErrorCorrectLevel.M :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
	case QRErrorCorrectLevel.Q :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
	case QRErrorCorrectLevel.H :
		return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
	default :
		return undefined;
	}
};

module.exports = QRRSBlock;

return module.exports;});
M['QRUtil']=(function(){var module={exports:{}};var exports=module.exports;
var QRMode = R('./QRMode');
var QRPolynomial = R('./QRPolynomial');
var QRMath = R('./QRMath');
var QRMaskPattern = R('./QRMaskPattern');

var QRUtil = {

    PATTERN_POSITION_TABLE : [
        [],
        [6, 18],
        [6, 22],
        [6, 26],
        [6, 30],
        [6, 34],
        [6, 22, 38],
        [6, 24, 42],
        [6, 26, 46],
        [6, 28, 50],
        [6, 30, 54],        
        [6, 32, 58],
        [6, 34, 62],
        [6, 26, 46, 66],
        [6, 26, 48, 70],
        [6, 26, 50, 74],
        [6, 30, 54, 78],
        [6, 30, 56, 82],
        [6, 30, 58, 86],
        [6, 34, 62, 90],
        [6, 28, 50, 72, 94],
        [6, 26, 50, 74, 98],
        [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106],
        [6, 32, 58, 84, 110],
        [6, 30, 58, 86, 114],
        [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122],
        [6, 30, 54, 78, 102, 126],
        [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134],
        [6, 34, 60, 86, 112, 138],
        [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150],
        [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158],
        [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166],
        [6, 30, 58, 86, 114, 142, 170]
    ],

    G15 : (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
    G18 : (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
    G15_MASK : (1 << 14) | (1 << 12) | (1 << 10)    | (1 << 4) | (1 << 1),

    getBCHTypeInfo : function(data) {
        var d = data << 10;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
            d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) ) );    
        }
        return ( (data << 10) | d) ^ QRUtil.G15_MASK;
    },

    getBCHTypeNumber : function(data) {
        var d = data << 12;
        while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
            d ^= (QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) ) );    
        }
        return (data << 12) | d;
    },

    getBCHDigit : function(data) {

        var digit = 0;

        while (data !== 0) {
            digit++;
            data >>>= 1;
        }

        return digit;
    },

    getPatternPosition : function(typeNumber) {
        return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
    },

    getMask : function(maskPattern, i, j) {
        
        switch (maskPattern) {
            
        case QRMaskPattern.PATTERN000 : return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001 : return i % 2 === 0;
        case QRMaskPattern.PATTERN010 : return j % 3 === 0;
        case QRMaskPattern.PATTERN011 : return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100 : return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 === 0;
        case QRMaskPattern.PATTERN101 : return (i * j) % 2 + (i * j) % 3 === 0;
        case QRMaskPattern.PATTERN110 : return ( (i * j) % 2 + (i * j) % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111 : return ( (i * j) % 3 + (i + j) % 2) % 2 === 0;

        default :
            throw new Error("bad maskPattern:" + maskPattern);
        }
    },

    getErrorCorrectPolynomial : function(errorCorrectLength) {

        var a = new QRPolynomial([1], 0);

        for (var i = 0; i < errorCorrectLength; i++) {
            a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0) );
        }

        return a;
    },

    getLengthInBits : function(mode, type) {

        if (1 <= type && type < 10) {

            // 1 - 9

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 10;
            case QRMode.MODE_ALPHA_NUM  : return 9;
            case QRMode.MODE_8BIT_BYTE  : return 8;
            case QRMode.MODE_KANJI      : return 8;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 27) {

            // 10 - 26

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 12;
            case QRMode.MODE_ALPHA_NUM  : return 11;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 10;
            default :
                throw new Error("mode:" + mode);
            }

        } else if (type < 41) {

            // 27 - 40

            switch(mode) {
            case QRMode.MODE_NUMBER     : return 14;
            case QRMode.MODE_ALPHA_NUM  : return 13;
            case QRMode.MODE_8BIT_BYTE  : return 16;
            case QRMode.MODE_KANJI      : return 12;
            default :
                throw new Error("mode:" + mode);
            }

        } else {
            throw new Error("type:" + type);
        }
    },

    getLostPoint : function(qrCode) {
        
        var moduleCount = qrCode.getModuleCount();
        var lostPoint = 0;
        var row = 0; 
        var col = 0;

        
        // LEVEL1
        
        for (row = 0; row < moduleCount; row++) {

            for (col = 0; col < moduleCount; col++) {

                var sameCount = 0;
                var dark = qrCode.isDark(row, col);

                for (var r = -1; r <= 1; r++) {

                    if (row + r < 0 || moduleCount <= row + r) {
                        continue;
                    }

                    for (var c = -1; c <= 1; c++) {

                        if (col + c < 0 || moduleCount <= col + c) {
                            continue;
                        }

                        if (r === 0 && c === 0) {
                            continue;
                        }

                        if (dark === qrCode.isDark(row + r, col + c) ) {
                            sameCount++;
                        }
                    }
                }

                if (sameCount > 5) {
                    lostPoint += (3 + sameCount - 5);
                }
            }
        }

        // LEVEL2

        for (row = 0; row < moduleCount - 1; row++) {
            for (col = 0; col < moduleCount - 1; col++) {
                var count = 0;
                if (qrCode.isDark(row,     col    ) ) count++;
                if (qrCode.isDark(row + 1, col    ) ) count++;
                if (qrCode.isDark(row,     col + 1) ) count++;
                if (qrCode.isDark(row + 1, col + 1) ) count++;
                if (count === 0 || count === 4) {
                    lostPoint += 3;
                }
            }
        }

        // LEVEL3

        for (row = 0; row < moduleCount; row++) {
            for (col = 0; col < moduleCount - 6; col++) {
                if (qrCode.isDark(row, col) && 
                        !qrCode.isDark(row, col + 1) && 
                         qrCode.isDark(row, col + 2) && 
                         qrCode.isDark(row, col + 3) && 
                         qrCode.isDark(row, col + 4) && 
                        !qrCode.isDark(row, col + 5) && 
                         qrCode.isDark(row, col + 6) ) {
                    lostPoint += 40;
                }
            }
        }

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount - 6; row++) {
                if (qrCode.isDark(row, col) &&
                        !qrCode.isDark(row + 1, col) &&
                         qrCode.isDark(row + 2, col) &&
                         qrCode.isDark(row + 3, col) &&
                         qrCode.isDark(row + 4, col) &&
                        !qrCode.isDark(row + 5, col) &&
                         qrCode.isDark(row + 6, col) ) {
                    lostPoint += 40;
                }
            }
        }

        // LEVEL4
        
        var darkCount = 0;

        for (col = 0; col < moduleCount; col++) {
            for (row = 0; row < moduleCount; row++) {
                if (qrCode.isDark(row, col) ) {
                    darkCount++;
                }
            }
        }
        
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;

        return lostPoint;       
    }

};

module.exports = QRUtil;

return module.exports;});
M['QRBitBuffer']=(function(){var module={exports:{}};var exports=module.exports;
function QRBitBuffer() {
	this.buffer = [];
	this.length = 0;
}

QRBitBuffer.prototype = {

	get : function(index) {
		var bufIndex = Math.floor(index / 8);
		return ( (this.buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
	},
	
	put : function(num, length) {
		for (var i = 0; i < length; i++) {
			this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
		}
	},
	
	getLengthInBits : function() {
		return this.length;
	},
	
	putBit : function(bit) {
	
		var bufIndex = Math.floor(this.length / 8);
		if (this.buffer.length <= bufIndex) {
			this.buffer.push(0);
		}
	
		if (bit) {
			this.buffer[bufIndex] |= (0x80 >>> (this.length % 8) );
		}
	
		this.length++;
	}
};

module.exports = QRBitBuffer;

return module.exports;});
M['QR8bitByte']=(function(){var module={exports:{}};var exports=module.exports;
var QRMode = R('./QRMode');

function QR8bitByte(data) {
	this.mode = QRMode.MODE_8BIT_BYTE;
	this.data = unescape(encodeURIComponent(data));
}

QR8bitByte.prototype = {

	getLength : function() {
		return this.data.length;
	},
	
	write : function(buffer) {
		for (var i = 0; i < this.data.length; i++) {
			// not JIS ...
			buffer.put(this.data.charCodeAt(i), 8);
		}
	}
};

module.exports = QR8bitByte;

return module.exports;});
M['index']=(function(){var module={exports:{}};var exports=module.exports;
//---------------------------------------------------------------------
// QRCode for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//   http://www.opensource.org/licenses/mit-license.php
//
// The word "QR Code" is registered trademark of 
// DENSO WAVE INCORPORATED
//   http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------
// Modified to work in node for this project (and some refactoring)
//---------------------------------------------------------------------

var QR8bitByte = R('./QR8bitByte');
var QRUtil = R('./QRUtil');
var QRPolynomial = R('./QRPolynomial');
var QRRSBlock = R('./QRRSBlock');
var QRBitBuffer = R('./QRBitBuffer');

function QRCode(typeNumber, errorCorrectLevel) {
	this.typeNumber = typeNumber;
	this.errorCorrectLevel = errorCorrectLevel;
	this.modules = null;
	this.moduleCount = 0;
	this.dataCache = null;
	this.dataList = [];
}

QRCode.prototype = {
	
	addData : function(data) {
		var newData = new QR8bitByte(data);
		this.dataList.push(newData);
		this.dataCache = null;
	},
	
	isDark : function(row, col) {
		if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
			throw new Error(row + "," + col);
		}
		return this.modules[row][col];
	},

	getModuleCount : function() {
		return this.moduleCount;
	},
	
	make : function() {
		// Calculate automatically typeNumber if provided is < 1
		if (this.typeNumber < 1 ){
			var typeNumber = 1;
			for (typeNumber = 1; typeNumber < 40; typeNumber++) {
				var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);

				var buffer = new QRBitBuffer();
				var totalDataCount = 0;
				for (var i = 0; i < rsBlocks.length; i++) {
					totalDataCount += rsBlocks[i].dataCount;
				}

				for (var x = 0; x < this.dataList.length; x++) {
					var data = this.dataList[x];
					buffer.put(data.mode, 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
					data.write(buffer);
				}
				if (buffer.getLengthInBits() <= totalDataCount * 8)
					break;
			}
			this.typeNumber = typeNumber;
		}
		this.makeImpl(false, this.getBestMaskPattern() );
	},
	
	makeImpl : function(test, maskPattern) {
		
		this.moduleCount = this.typeNumber * 4 + 17;
		this.modules = new Array(this.moduleCount);
		
		for (var row = 0; row < this.moduleCount; row++) {
			
			this.modules[row] = new Array(this.moduleCount);
			
			for (var col = 0; col < this.moduleCount; col++) {
				this.modules[row][col] = null;//(col + row) % 3;
			}
		}
	
		this.setupPositionProbePattern(0, 0);
		this.setupPositionProbePattern(this.moduleCount - 7, 0);
		this.setupPositionProbePattern(0, this.moduleCount - 7);
		this.setupPositionAdjustPattern();
		this.setupTimingPattern();
		this.setupTypeInfo(test, maskPattern);
		
		if (this.typeNumber >= 7) {
			this.setupTypeNumber(test);
		}
	
		if (this.dataCache === null) {
			this.dataCache = QRCode.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
		}
	
		this.mapData(this.dataCache, maskPattern);
	},

	setupPositionProbePattern : function(row, col)  {
		
		for (var r = -1; r <= 7; r++) {
			
			if (row + r <= -1 || this.moduleCount <= row + r) continue;
			
			for (var c = -1; c <= 7; c++) {
				
				if (col + c <= -1 || this.moduleCount <= col + c) continue;
				
				if ( (0 <= r && r <= 6 && (c === 0 || c === 6) ) || 
                     (0 <= c && c <= 6 && (r === 0 || r === 6) ) || 
                     (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
					this.modules[row + r][col + c] = true;
				} else {
					this.modules[row + r][col + c] = false;
				}
			}		
		}		
	},
	
	getBestMaskPattern : function() {
	
		var minLostPoint = 0;
		var pattern = 0;
	
		for (var i = 0; i < 8; i++) {
			
			this.makeImpl(true, i);
	
			var lostPoint = QRUtil.getLostPoint(this);
	
			if (i === 0 || minLostPoint >  lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
	
		return pattern;
	},
	
	createMovieClip : function(target_mc, instance_name, depth) {
	
		var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
		var cs = 1;
	
		this.make();

		for (var row = 0; row < this.modules.length; row++) {
			
			var y = row * cs;
			
			for (var col = 0; col < this.modules[row].length; col++) {
	
				var x = col * cs;
				var dark = this.modules[row][col];
			
				if (dark) {
					qr_mc.beginFill(0, 100);
					qr_mc.moveTo(x, y);
					qr_mc.lineTo(x + cs, y);
					qr_mc.lineTo(x + cs, y + cs);
					qr_mc.lineTo(x, y + cs);
					qr_mc.endFill();
				}
			}
		}
		
		return qr_mc;
	},

	setupTimingPattern : function() {
		
		for (var r = 8; r < this.moduleCount - 8; r++) {
			if (this.modules[r][6] !== null) {
				continue;
			}
			this.modules[r][6] = (r % 2 === 0);
		}
	
		for (var c = 8; c < this.moduleCount - 8; c++) {
			if (this.modules[6][c] !== null) {
				continue;
			}
			this.modules[6][c] = (c % 2 === 0);
		}
	},
	
	setupPositionAdjustPattern : function() {
	
		var pos = QRUtil.getPatternPosition(this.typeNumber);
		
		for (var i = 0; i < pos.length; i++) {
		
			for (var j = 0; j < pos.length; j++) {
			
				var row = pos[i];
				var col = pos[j];
				
				if (this.modules[row][col] !== null) {
					continue;
				}
				
				for (var r = -2; r <= 2; r++) {
				
					for (var c = -2; c <= 2; c++) {
					
						if (Math.abs(r) === 2 || 
                            Math.abs(c) === 2 ||
                            (r === 0 && c === 0) ) {
							this.modules[row + r][col + c] = true;
						} else {
							this.modules[row + r][col + c] = false;
						}
					}
				}
			}
		}
	},
	
	setupTypeNumber : function(test) {
	
		var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
        var mod;
	
		for (var i = 0; i < 18; i++) {
			mod = (!test && ( (bits >> i) & 1) === 1);
			this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
		}
	
		for (var x = 0; x < 18; x++) {
			mod = (!test && ( (bits >> x) & 1) === 1);
			this.modules[x % 3 + this.moduleCount - 8 - 3][Math.floor(x / 3)] = mod;
		}
	},
	
	setupTypeInfo : function(test, maskPattern) {
	
		var data = (this.errorCorrectLevel << 3) | maskPattern;
		var bits = QRUtil.getBCHTypeInfo(data);
        var mod;
	
		// vertical		
		for (var v = 0; v < 15; v++) {
	
			mod = (!test && ( (bits >> v) & 1) === 1);
	
			if (v < 6) {
				this.modules[v][8] = mod;
			} else if (v < 8) {
				this.modules[v + 1][8] = mod;
			} else {
				this.modules[this.moduleCount - 15 + v][8] = mod;
			}
		}
	
		// horizontal
		for (var h = 0; h < 15; h++) {
	
			mod = (!test && ( (bits >> h) & 1) === 1);
			
			if (h < 8) {
				this.modules[8][this.moduleCount - h - 1] = mod;
			} else if (h < 9) {
				this.modules[8][15 - h - 1 + 1] = mod;
			} else {
				this.modules[8][15 - h - 1] = mod;
			}
		}
	
		// fixed module
		this.modules[this.moduleCount - 8][8] = (!test);
	
	},
	
	mapData : function(data, maskPattern) {
		
		var inc = -1;
		var row = this.moduleCount - 1;
		var bitIndex = 7;
		var byteIndex = 0;
		
		for (var col = this.moduleCount - 1; col > 0; col -= 2) {
	
			if (col === 6) col--;
	
			while (true) {
	
				for (var c = 0; c < 2; c++) {
					
					if (this.modules[row][col - c] === null) {
						
						var dark = false;
	
						if (byteIndex < data.length) {
							dark = ( ( (data[byteIndex] >>> bitIndex) & 1) === 1);
						}
	
						var mask = QRUtil.getMask(maskPattern, row, col - c);
	
						if (mask) {
							dark = !dark;
						}
						
						this.modules[row][col - c] = dark;
						bitIndex--;
	
						if (bitIndex === -1) {
							byteIndex++;
							bitIndex = 7;
						}
					}
				}
								
				row += inc;
	
				if (row < 0 || this.moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
		
	}

};

QRCode.PAD0 = 0xEC;
QRCode.PAD1 = 0x11;

QRCode.createData = function(typeNumber, errorCorrectLevel, dataList) {
	
	var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
	
	var buffer = new QRBitBuffer();
	
	for (var i = 0; i < dataList.length; i++) {
		var data = dataList[i];
		buffer.put(data.mode, 4);
		buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber) );
		data.write(buffer);
	}

	// calc num max data.
	var totalDataCount = 0;
	for (var x = 0; x < rsBlocks.length; x++) {
		totalDataCount += rsBlocks[x].dataCount;
	}

	if (buffer.getLengthInBits() > totalDataCount * 8) {
		throw new Error("code length overflow. (" + 
            buffer.getLengthInBits() + 
            ">" +  
            totalDataCount * 8 + 
            ")");
	}

	// end code
	if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
		buffer.put(0, 4);
	}

	// padding
	while (buffer.getLengthInBits() % 8 !== 0) {
		buffer.putBit(false);
	}

	// padding
	while (true) {
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD0, 8);
		
		if (buffer.getLengthInBits() >= totalDataCount * 8) {
			break;
		}
		buffer.put(QRCode.PAD1, 8);
	}

	return QRCode.createBytes(buffer, rsBlocks);
};

QRCode.createBytes = function(buffer, rsBlocks) {

	var offset = 0;
	
	var maxDcCount = 0;
	var maxEcCount = 0;
	
	var dcdata = new Array(rsBlocks.length);
	var ecdata = new Array(rsBlocks.length);
	
	for (var r = 0; r < rsBlocks.length; r++) {

		var dcCount = rsBlocks[r].dataCount;
		var ecCount = rsBlocks[r].totalCount - dcCount;

		maxDcCount = Math.max(maxDcCount, dcCount);
		maxEcCount = Math.max(maxEcCount, ecCount);
		
		dcdata[r] = new Array(dcCount);
		
		for (var i = 0; i < dcdata[r].length; i++) {
			dcdata[r][i] = 0xff & buffer.buffer[i + offset];
		}
		offset += dcCount;
		
		var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
		var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);

		var modPoly = rawPoly.mod(rsPoly);
		ecdata[r] = new Array(rsPoly.getLength() - 1);
		for (var x = 0; x < ecdata[r].length; x++) {
            var modIndex = x + modPoly.getLength() - ecdata[r].length;
			ecdata[r][x] = (modIndex >= 0)? modPoly.get(modIndex) : 0;
		}

	}
	
	var totalCodeCount = 0;
	for (var y = 0; y < rsBlocks.length; y++) {
		totalCodeCount += rsBlocks[y].totalCount;
	}

	var data = new Array(totalCodeCount);
	var index = 0;

	for (var z = 0; z < maxDcCount; z++) {
		for (var s = 0; s < rsBlocks.length; s++) {
			if (z < dcdata[s].length) {
				data[index++] = dcdata[s][z];
			}
		}
	}

	for (var xx = 0; xx < maxEcCount; xx++) {
		for (var t = 0; t < rsBlocks.length; t++) {
			if (xx < ecdata[t].length) {
				data[index++] = ecdata[t][xx];
			}
		}
	}

	return data;

};

module.exports = QRCode;

return module.exports;});
var C={};function R2(n){n=n.replace('./','');if(!C[n])C[n]=M[n]();return C[n];}
return {QRCode:R2('index'),ECL:R2('QRErrorCorrectLevel')};})();

/* ================= สติกเกอร์แก้ว (วาดเป็นรูป -> ส่ง RawBT) ================= */
var STK = {
    cfg: null,
    defaults: {
        paper: 'label',           // label = ม้วนสติกเกอร์ | receipt = ม้วนใบเสร็จ 58mm (ฉีก/ตัดเอง)
        method: 'esc',            // esc | tspl | cpcl | text
        widthMm: 60, heightMm: 40, dpi: 203,
        headDots: 640,            // ความกว้างหัวพิมพ์ (ใช้กับ esc/cpcl แบบเติมขอบ)
        dataSave: 0,              // 0 = ปกติ | 1 = ประหยัดข้อมูล (½) | 2 = ประหยัดมาก (¼) เฉพาะ ESC/POS
        chunkRows: 0, chunkDelay: 600,   // chunkRows>0 = ส่งภาพทีละแถบ (กี่แถว) คนละงาน เว้น chunkDelay ms
        shiftMode: 'margin',      // margin = ใช้คำสั่งเว้นขอบของเครื่อง (ข้อมูลน้อย) | pad = เติมขอบขาวในภาพ
        offsetX: 0, offsetY: 0,   // ขยับภาพ (mm)
        darkness: 140,            // เกณฑ์ขาว/ดำ (ยิ่งมากยิ่งดำ)
        showName: true, nameFallback: 'table', showType: true, showTime: true,
        showShop: false, shopText: '',
        qrOn: false, qrUrl: '', qrLabel: '', qrSizeMm: 16
    }
};
var STK_FONT = '"Noto Sans Thai","Leelawadee UI",Tahoma,sans-serif';
function stickerCfg() { return Object.assign({}, STK.defaults, STK.cfg || {}); }
function stickerInit() {
    if (STK.started) return;
    STK.started = true;
    database.ref('settings/sticker').on('value', function (s) { STK.cfg = s.val() || {}; if (STK.onChange) STK.onChange(); });
}
function stkDims(cfg) {
    var k = Number(cfg.dpi) / 25.4;
    var w = Math.round(Number(cfg.widthMm) * k / 8) * 8, h = Math.round(Number(cfg.heightMm) * k);
    return { w: w, h: h, ox: Math.round(Number(cfg.offsetX || 0) * k), oy: Math.round(Number(cfg.offsetY || 0) * k), k: k };
}
function stkFit(c, text, maxW, px, min, weight) {
    c.font = weight + ' ' + px + 'px ' + STK_FONT;
    while (px > min && c.measureText(text).width > maxW) { px -= 2; c.font = weight + ' ' + px + 'px ' + STK_FONT; }
    if (c.measureText(text).width > maxW) {
        while (text.length > 1 && c.measureText(text + '…').width > maxW) text = text.slice(0, -1);
        text += '…';
    }
    return { text: text, px: px };
}
function stkWrap(c, text, maxW, maxLines, sep) {
    var segs;
    if (sep) { var parts = text.split(sep); segs = parts.map(function (p, i) { return i < parts.length - 1 ? p + sep : p; }); }
    else try { segs = Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), function (x) { return x.segment; }); }
    catch (e) { segs = Array.from(text); }
    var lines = [], cur = '';
    segs.forEach(function (sg) {
        var t = cur + sg;
        if (cur && c.measureText(t).width > maxW) { lines.push(cur.replace(/\s+$/, '')); cur = sg.replace(/^\s+/, ''); } else cur = t;
    });
    if (cur) lines.push(cur);
    var clipped = lines.length > maxLines;
    lines = lines.slice(0, maxLines);
    return lines.map(function (ln, i) {
        var last = clipped && i === maxLines - 1;
        var t = ln;
        while (t.length > 1 && c.measureText(last ? t + '…' : t).width > maxW) t = t.slice(0, -1);
        return (t !== ln || last) ? t + '…' : t;
    });
}
// ข้อมูลของสติกเกอร์ 1 ใบ
function stkData(bill, line, k, n, cfg) {
    cfg = cfg || stickerCfg();
    var del = bill.source && bill.source !== 'store';
    var name = '';
    if (del) name = bill.source + (bill.appOrderNo ? ' ' + bill.appOrderNo : '');
    else if (cfg.showName) name = bill.customerName || (cfg.nameFallback === 'table' && bill.table ? 'โต๊ะ ' + bill.table : '');
    return {
        no: bill.orderNo, k: k, n: n, name: name,
        item: line.name || '', details: lineDetails(line), note: line.note || '',
        type: cfg.showType ? (del ? 'Delivery' : (bill.orderType || '')) : '',
        time: cfg.showTime ? timeHHMM(Date.now()) : ''
    };
}
function stkQr(url) {
    var q = new QRLib.QRCode(-1, QRLib.ECL.L); q.addData(url); q.make(); return q;
}
// วาดสติกเกอร์ลง ctx ที่ตำแหน่ง (x0,y0) ขนาด d.w x d.h
function stkPaint(c, d, data, cfg, x0, y0) {
    c.save(); c.translate(x0, y0);
    c.fillStyle = '#fff'; c.fillRect(0, 0, d.w, d.h); c.fillStyle = '#000'; c.textBaseline = 'top'; c.textAlign = 'left';
    var s = Math.min(d.w / 480, d.h / 320), pad = Math.round(14 * s);
    var footH = Math.round(40 * s), fy = d.h - pad - footH;
    var hasQr = !!(cfg.qrOn && cfg.qrUrl);
    // หัว: เลขออร์เดอร์ + ลำดับแก้ว
    var y = pad;
    c.font = 'bold ' + Math.round(58 * s) + 'px ' + STK_FONT; c.textAlign = 'left'; c.fillText('#' + data.no, pad, y);
    c.font = 'bold ' + Math.round(50 * s) + 'px ' + STK_FONT; c.textAlign = 'right'; c.fillText(data.k + '/' + data.n, d.w - pad, y + 4 * s); c.textAlign = 'left';
    y += Math.round(64 * s);
    var headBottom = y;
    // QR (ขวา ใต้หัว)
    var textW = d.w - 2 * pad;
    if (hasQr) {
        try {
            var q = stkQr(cfg.qrUrl), cnt = q.getModuleCount(), labelH = cfg.qrLabel ? Math.round(26 * s) : 0;
            var maxBox = Math.min(Math.round(cfg.qrSizeMm * d.k), fy - headBottom - labelH - 4);
            var mod = Math.floor(maxBox / (cnt + 4));
            if (mod >= 2) {
                var box = mod * (cnt + 4), qx = d.w - pad - box, qy = headBottom;
                c.fillStyle = '#fff'; c.fillRect(qx, qy, box, box); c.fillStyle = '#000';
                for (var r = 0; r < cnt; r++) for (var cc = 0; cc < cnt; cc++) if (q.isDark(r, cc)) c.fillRect(qx + (cc + 2) * mod, qy + (r + 2) * mod, mod, mod);
                if (cfg.qrLabel) { c.font = Math.round(22 * s) + 'px ' + STK_FONT; c.textAlign = 'center'; var lb = stkFit(c, cfg.qrLabel, box + pad, Math.round(22 * s), 14, ''); c.font = lb.px + 'px ' + STK_FONT; c.fillText(lb.text, qx + box / 2, qy + box + 2); c.textAlign = 'left'; }
                textW = qx - 2 * pad;
            }
        } catch (e) { /* QR ใส่ไม่ได้ ข้ามไป */ }
    }
    // ชื่อลูกค้า / แอป
    if (data.name) {
        var f = stkFit(c, data.name, textW, Math.round(46 * s), Math.round(26 * s), 'bold');
        c.font = 'bold ' + f.px + 'px ' + STK_FONT; c.fillText(f.text, pad, y); y += Math.round(f.px * 1.25);
    }
    // ชื่อเมนู
    var it = stkFit(c, data.item, textW, Math.round(40 * s), Math.round(24 * s), 'bold');
    c.font = 'bold ' + it.px + 'px ' + STK_FONT; c.fillText(it.text, pad, y); y += Math.round(it.px * 1.25);
    // ไซส์ + ตัวเลือก + หมายเหตุ
    var lh = Math.round(34 * s);
    c.font = Math.round(30 * s) + 'px ' + STK_FONT;
    var lines = [];
    if (data.details) stkWrap(c, data.details, textW, 2, ' | ').forEach(function (l) { lines.push(l); });
    if (data.note) stkWrap(c, '* ' + data.note, textW, 2).forEach(function (l) { lines.push(l); });
    lines.forEach(function (l) { if (y + lh <= fy) { c.fillText(l, pad, y); y += lh; } });
    // ท้าย
    c.fillRect(pad, fy, d.w - 2 * pad, Math.max(2, Math.round(3 * s)));
    c.font = Math.round(26 * s) + 'px ' + STK_FONT;
    var left = [data.type, data.time].filter(Boolean).join('  ·  ');
    c.fillText(left, pad, fy + Math.round(8 * s));
    if (cfg.showShop && cfg.shopText) {
        var lw = c.measureText(left).width, sh = stkFit(c, cfg.shopText, d.w - 2 * pad - lw - pad, Math.round(26 * s), 16, '');
        c.font = sh.px + 'px ' + STK_FONT; c.textAlign = 'right'; c.fillText(sh.text, d.w - pad, fy + Math.round(8 * s)); c.textAlign = 'left';
    }
    if (cfg.paper === 'receipt') { /* เส้นประสำหรับตัด/ฉีก */
        for (var dx = 0; dx < d.w; dx += 20) c.fillRect(dx, d.h - 4, 12, 2);
    }
    c.restore();
}
function stkRuler(c, cw, h, k) {
    c.fillStyle = '#fff'; c.fillRect(0, 0, cw, h); c.fillStyle = '#000'; c.textBaseline = 'top'; c.textAlign = 'left';
    var step = 5 * k;
    c.font = 'bold 22px ' + STK_FONT;
    for (var i = 0; i * step < cw; i++) {
        var x = Math.round(i * step), mm = i * 5, long = mm % 10 === 0;
        c.fillRect(x, 0, 3, long ? 60 : 34);
        if (long) c.fillText(String(mm), x + 5, 64);
    }
    c.fillRect(0, 0, 3, h); c.fillRect(0, h - 3, cw, 3);
    for (var j = 0; j * step < h; j++) c.fillRect(0, Math.round(j * step), (j * 5) % 10 === 0 ? 50 : 28, 3);
    c.font = '26px ' + STK_FONT; c.fillText('วัดจากซ้ายหัวพิมพ์ (mm)', 70, 150);
}
function stkBits(canvas, thr, invert) {
    var w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data, bw = w / 8, o = new Uint8Array(bw * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4, black = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) < thr;
        if (black !== invert) o[y * bw + (x >> 3)] |= 0x80 >> (x & 7);
    }
    return o;
}
function stkCat(parts) {
    var n = parts.reduce(function (a, b) { return a + b.length; }, 0), o = new Uint8Array(n), k = 0;
    parts.forEach(function (b) { o.set(b, k); k += b.length; });
    return o;
}
function stkEnc(s) { return new TextEncoder().encode(s); }
function stkB64(u) { var s = ''; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
function stkHead(cfg, d) { return Math.max(8, Math.ceil(Math.max(Number(cfg.headDots) || 640, d.ox + d.w) / 8) * 8); }
// ภาพแบบ ESC/POS แบ่งเป็นแถบสูง band แถว (เครื่องราคาถูกมักรับภาพสูงในคำสั่งเดียวไม่ไหว)
function stkEscBands(bits, bw, h, band, gm) {
    var parts = [];
    for (var y = 0; y < h; y += band) {
        var n = Math.min(band, h - y);
        parts.push(stkCat([Uint8Array.of(0x1D, 0x76, 0x30, gm || 0, bw & 255, bw >> 8, n & 255, n >> 8), bits.subarray(y * bw, (y + n) * bw)]));
    }
    return parts;
}
function stkEscRaster(bits, bw, h, band, gm) { return stkCat(stkEscBands(bits, bw, h, band, gm)); }
// รวมหัว + แถบภาพ + ท้าย เป็นรายการ "งาน" ที่จะส่ง (ถ้า chunkRows > 0 ส่งทีละแถบเป็นคนละงาน)
function stkEscJobs(pre, bits, bw, h, post, cfg, gm) {
    var cr = Number(cfg.chunkRows) || 0;
    if (cr <= 0) return [stkCat([pre, stkEscRaster(bits, bw, h, 40, gm), post])];
    var b = stkEscBands(bits, bw, h, cr, gm);
    b[0] = stkCat([pre, b[0]]); b[b.length - 1] = stkCat([b[b.length - 1], post]);
    return b;
}
function stkPost(cfg) { return cfg.paper === 'receipt' ? Uint8Array.of(0x1B, 0x4A, 16) : Uint8Array.of(0x0C); }
// ข้อมูล 1 ใบ (หรือแถบวัดถ้า data = null) -> รายการงาน (Uint8Array[]) ที่ส่งเครื่องพิมพ์ตามลำดับ
function stkBytes(data, cfg) {
    var d = stkDims(cfg), thr = Number(cfg.darkness) || 140, m = cfg.method, k, c, ruler = !data;
    if (m === 'tspl') {
        k = document.createElement('canvas'); k.width = d.w; k.height = d.h; c = k.getContext('2d');
        if (ruler) stkRuler(c, d.w, d.h, d.k); else stkPaint(c, d, data, cfg, Math.min(0, d.ox), Math.min(0, d.oy));
        return [stkCat([stkEnc('SIZE ' + cfg.widthMm + ' mm,' + cfg.heightMm + ' mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP ' + Math.max(0, d.ox) + ',' + Math.max(0, d.oy) + ',' + (d.w / 8) + ',' + d.h + ',0,'), stkBits(k, thr, true), stkEnc('\r\nPRINT 1,1\r\n')])];
    }
    if (m === 'esc' && cfg.shiftMode !== 'pad') { /* เว้นขอบซ้ายด้วย GS L แล้วส่งภาพกว้างเท่าสติกเกอร์เท่านั้น */
        /* โหมดประหยัดข้อมูล: 1 = ลดความละเอียดแนวตั้งครึ่งหนึ่ง, 2 = ลดทั้งแนวตั้ง/แนวนอน (เครื่องขยายกลับเอง ด้วย GS v 0 m=2/3) */
        var sv = Number(cfg.dataSave) || 0, fx = sv >= 2 ? 2 : 1, fy = sv >= 1 ? 2 : 1;
        var cw = Math.ceil(d.w / fx / 8) * 8, ch = Math.ceil(d.h / fy);
        k = document.createElement('canvas'); k.width = cw; k.height = ch; c = k.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, cw, ch); c.scale(1 / fx, 1 / fy);
        if (ruler) stkRuler(c, d.w, d.h, d.k); else stkPaint(c, d, data, cfg, Math.min(0, d.ox), d.oy);
        var mg = Math.max(0, d.ox), gm = (fx === 2 ? 1 : 0) + (fy === 2 ? 2 : 0);
        return stkEscJobs(Uint8Array.of(0x1B, 0x40, 0x1D, 0x4C, mg & 255, mg >> 8), stkBits(k, thr, false), cw / 8, ch, stkPost(cfg), cfg, gm);
    }
    var hd = stkHead(cfg, d);
    k = document.createElement('canvas'); k.width = hd; k.height = d.h; c = k.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, hd, d.h);
    if (ruler) stkRuler(c, hd, d.h, d.k); else stkPaint(c, d, data, cfg, d.ox, d.oy);
    var bits = stkBits(k, thr, false), bw = hd / 8;
    if (m === 'cpcl') return [stkCat([stkEnc('! 0 ' + cfg.dpi + ' ' + cfg.dpi + ' ' + d.h + ' 1\r\nPW ' + hd + '\r\nEG ' + bw + ' ' + d.h + ' 0 0 '), bits, stkEnc('\r\nFORM\r\nPRINT\r\n')])];
    return stkEscJobs(Uint8Array.of(0x1B, 0x40), bits, bw, d.h, stkPost(cfg), cfg);
}
// ส่งทีละใบ เว้นช่วงให้ RawBT รับทันทีละงาน
function stkSendAll(list, cfg) {
    if (true) { /* รวมทุกใบเป็นงานเดียว (RawBT ต้องใช้เวลาต่อเครื่อง ~5 วินาทีต่องาน จึงไม่ส่งแยกชิ้น) */
        var parts = [];
        list.forEach(function (it) { stkBytes(it === 'RULER' ? null : it, cfg).forEach(function (b) { parts.push(b); }); });
        if (cfg.paper === 'receipt') parts.push(Uint8Array.of(0x1B, 0x64, 4)); /* เลื่อนกระดาษพ้นแท่นฉีก */
        window.location.href = 'rawbt:base64,' + stkB64(stkCat(parts));
        return;
    }
    var i = 0, delay = Math.max(100, Number(cfg.chunkDelay) || 600);
    function sendJobs(jobs, done) {
        var j = 0;
        (function one() {
            if (j >= jobs.length) { if (done) done(); return; }
            window.location.href = 'rawbt:base64,' + stkB64(jobs[j++]);
            setTimeout(one, jobs.length > 1 ? delay : 0);
        })();
    }
    (function next() {
        if (i >= list.length) return;
        var it = list[i++], jobs = it === 'RULER' ? stkBytes(null, cfg) : stkBytes(it, cfg);
        sendJobs(jobs, function () { if (i < list.length) setTimeout(next, 1500); });
    })();
}
