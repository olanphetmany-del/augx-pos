/* =====================================================================
   shared.js  —  ใช้ร่วมกันทั้ง cashier.html / kitchen.html / admin.html
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
if (window.AUGX_APP_NAME) {
    /* หน้านี้ใช้การล็อกอินแยกของตัวเอง (เช่น Admin) — ไม่ปนกับบัญชีที่ล็อกอินในหน้าแคชเชียร์บนเครื่องเดียวกัน */
    (function (N) {
        var app = firebase.apps.filter(function (a) { return a.name === N; })[0] || firebase.initializeApp(firebaseConfig, N);
        ['auth', 'database'].forEach(function (k) {
            var o = firebase[k]; if (typeof o !== 'function') return;
            var f = function (a) { return o(a || app); };
            Object.getOwnPropertyNames(o).forEach(function (p) { if (!(p in f)) try { f[p] = o[p]; } catch (e) {} });
            try { f.Auth = o.Auth; f.EmailAuthProvider = o.EmailAuthProvider; } catch (e) {}
            firebase[k] = f;
        });
    })(window.AUGX_APP_NAME);
} else if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const database = firebase.database();

/* ---------- ฟังก์ชันช่วยทั่วไป ---------- */
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}
function money(n) { return Number(n || 0).toLocaleString() + ' ₭'; }

/* ---------- เงินบาท (฿) ----------
   - สินค้าตั้งราคาเป็นบาทได้ (menu_items/<id>/currency = 'THB')
   - 1 บิล = 1 สกุลเงิน · บิลบาทเก็บ total เป็น "กีบ" (แปลงด้วยเรทตอนรับเงิน) เพื่อให้รายงานรวมยอดได้เหมือนเดิม
     ยอดบาทจริงอยู่ที่ totalThb / subtotalThb / discountThb · เรทที่ใช้อยู่ที่ rate
   - เรทแสดงผล (ตั้งใน Admin) อยู่ที่ settings/currency {enabled, rate, rateAt} */
const FX = { on: false, rate: 0, rateAt: 0, started: false, loaded: false, cbs: [] };
// เรียกได้หลายที่ (หน้าเว็บ + preorder.js) · ทุก callback จะถูกเรียกเมื่อเรทเปลี่ยน
function fxInit(cb) {
    if (cb) { FX.cbs.push(cb); if (FX.loaded) cb(); }
    if (FX.started) return;
    FX.started = true;
    database.ref('settings/currency').on('value', function (s) {
        const v = s.val() || {};
        FX.on = v.enabled === true; FX.rate = Number(v.rate) || 0; FX.rateAt = Number(v.rateAt) || 0; FX.loaded = true;
        FX.cbs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    });
}
function baht(n) { return '฿' + Number(n || 0).toLocaleString(); }
function moneyC(n, cur) { return cur === 'THB' ? baht(n) : money(n); }
// บาท -> กีบ (ปัดเป็นหลัก 500 สำหรับรับเงินจริง · 1,000 สำหรับยอดโดยประมาณ)
function toLak(thb, rate, step) { step = step || 500; return Math.round(Number(thb || 0) * Number(rate || 0) / step) * step; }
function approxLak(thb, rate) { rate = rate || FX.rate; return rate > 0 ? '≈ ' + money(toLak(thb, rate, 1000)) : ''; }
function fxStale() { return !FX.rateAt || Date.now() - FX.rateAt > 26 * 3600000; }
function billCur(o) { return o && o.currency === 'THB' ? 'THB' : 'LAK'; }
// ยอดที่โชว์ของบิล (บิลบาทโชว์ ฿)
function billAmt(o) { return billCur(o) === 'THB' ? baht(o.totalThb != null ? o.totalThb : itemsSubtotal(o.items)) : money(o.total); }
// คำนวณยอดของบิลใหม่ (ใช้หลังเพิ่ม/ลบรายการ)
function recalcBill(o) {
    const sub = itemsSubtotal(o.items);
    if (o.currency === 'THB') {
        const rate = Number(o.rate || FX.rate || 0);
        o.subtotalThb = sub; o.totalThb = Math.max(0, sub - Number(o.discountThb || 0));
        o.subtotal = toLak(sub, rate); o.total = toLak(o.totalThb, rate); o.discount = Math.max(0, o.subtotal - o.total);
    } else {
        o.subtotal = sub; o.total = Math.max(0, sub - Number(o.discount || 0));
    }
    return o;
}
// ยอดเป็นกีบของ 1 รายการในบิล (ใช้ในรายงานสินค้าขายดี)
function lineLak(o, c) {
    const v = Number(c.price || 0) * Number(c.quantity || 0);
    if (billCur(o) !== 'THB') return v;
    return Number(o.totalThb) > 0 ? Math.round(v * Number(o.total || 0) / Number(o.totalThb)) : toLak(v, o.rate || FX.rate, 1);
}
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

/* ---------- หมวดหมู่ / 2 ร้าน (☕ ร้านกาแฟ | 👟 SHOP) / สต็อกรายไซส์ ----------
   categories/<id>: { name, shop:true = ขายที่หน้า SHOP, authentic:true = ของแท้ (ใบรับประกัน 30 วัน), shoe:true = รองเท้า (ถาม cm) }
   menu_items/<id>: { stockOn:true, stock:{ "<ไซส์>": จำนวนคู่ } }  (จุดในชื่อไซส์ เช่น 42.5 เก็บเป็น 42_5) */
function catByName(name) {
    const L = (typeof globalCategories !== 'undefined' && Array.isArray(globalCategories)) ? globalCategories : [];
    return L.find(function (c) { return c.name === name; }) || null;
}
function itemById(id) {
    if (!id || typeof globalItems === 'undefined' || !Array.isArray(globalItems)) return null;
    return globalItems.find(function (x) { return x.id === id; }) || null;
}
function itemFlags(it) {
    const c = it ? catByName(it.category) : null;
    return { shop: !!(c && c.shop), authentic: !!((it && it.authentic === true) || (c && c.authentic)), shoe: !!(c && c.shoe) };
}
function isShopItem(id) { return itemFlags(itemById(id)).shop; }
function stockKey(label) { return String(label == null || label === '' ? 'one' : label).replace(/[.#$\/\[\]]/g, '_'); }
// null = สินค้านี้ไม่ได้นับสต็อก · ตัวเลข = จำนวนที่เหลือ
function stockOf(it, label) {
    if (!it || it.stockOn !== true) return null;
    const v = (it.stock || {})[stockKey(label)];
    return Math.max(0, Number(v) || 0);
}
// ตัด/คืนสต็อกตามรายการในบิล (sign = -1 ขาย, +1 คืน)
function adjustStock(lines, sign) {
    arr(lines).forEach(function (c) {
        const it = itemById(c.itemId);
        if (!it || it.stockOn !== true || !c.quantity) return;
        database.ref('menu_items/' + c.itemId + '/stock/' + stockKey(c.variant)).transaction(function (n) {
            return Math.max(0, (Number(n) || 0) + sign * Number(c.quantity || 0));
        }).catch(function () {});
    });
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
    items = arr(items).filter(function (c) { return !c.shop && !isRetailItemId(c.itemId) && !isShopItem(c.itemId); });
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
        const x = { lid: newLid(), itemId: c.itemId || '', name: c.name, variant: c.variant || '', price: Number(c.price || 0), quantity: c.quantity, modifiers: c.modifiers || [], note: c.note || '', cup: c.cup !== false, round: 1 };
        if (c.retail || isRetailItemId(c.itemId)) x.retail = true;
        const fl = itemFlags(itemById(c.itemId));
        if (fl.authentic) x.auth = true;
        if (fl.shop) { x.shop = true; x.retail = true; x.cup = false; }
        return x;
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
    if (d.currency === 'THB') { bill.currency = 'THB'; bill.rate = FX.rate || 0; recalcBill(bill); }
    if (d.store === 'shop' || (items.length && items.every(function (x) { return x.shop; }))) bill.store = 'shop';
    bill.cups = billCups(bill);
    bill.customer = billName(bill) || 'ทั่วไป';
    if (d.paidByApp) bill.paidAt = now;
    const ref = database.ref('orders').push(bill);
    ref.catch(function (e) { toast('บันทึกบิลไม่สำเร็จ: ' + e.message, false); });
    pushTicket(ref.key, bill, 'new', items, 1, '');
    adjustCups(-bill.cups);
    adjustStock(items, -1);
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
            const x = { lid: newLid(), itemId: c.itemId || '', name: c.name, variant: c.variant || '', price: Number(c.price || 0), quantity: c.quantity, modifiers: c.modifiers || [], note: c.note || '', cup: c.cup !== false, round: round };
            if (c.retail || isRetailItemId(c.itemId)) x.retail = true;
            const fl = itemFlags(itemById(c.itemId));
            if (fl.authentic) x.auth = true;
            if (fl.shop) { x.shop = true; x.retail = true; x.cup = false; }
            return x;
        });
        o.items = arr(o.items).concat(added);
        recalcBill(o);
        o.rounds = round;
        o.status = 'open'; o.paid = false;
        o.cups = billCups(o);
        return o;
    }).then(function (res) {
        const bill = res.snapshot.val();
        if (!res.committed || !bill) throw new Error('บิลนี้ปิดหรือถูกยกเลิกไปแล้ว');
        pushTicket(id, bill, 'add', added, round, '');
        adjustStock(added, -1);
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
        recalcBill(o);
        o.removedItems = arr(o.removedItems).concat([{ name: removed.name, quantity: removed.quantity, price: removed.price, at: Date.now() }]);
        o.cups = billCups(o);
        return o;
    }).then(function (res) {
        const bill = res.snapshot.val();
        if (!res.committed || !bill || !removed) throw new Error('ลบรายการไม่ได้ (บิลปิดแล้ว หรือเหลือรายการเดียว ให้ใช้ยกเลิกบิลแทน)');
        pushTicket(id, bill, 'cancel', [removed], bill.rounds || 1, 'ลบรายการ');
        adjustStock([removed], 1);
        adjustCups(removed.cup === false ? 0 : Number(removed.quantity || 0));
        return bill;
    });
}

/* ---------- ชำระเงิน (ปิดบิล) ---------- */
// p: { discountType:'amount'|'percent', discountValue, method:'cash'|'transfer', cashReceived:'' หรือตัวเลข }
// บิลบาท: p.payCurrency 'THB'|'LAK' (จ่ายเป็นบาท หรือ กีบ) · p.rate = เรทจริงตอนรับเงิน (กีบต่อ 1 บาท)
//   cashReceived เป็นสกุลที่ลูกค้าจ่าย · บันทึก total เป็นกีบตามเรทนี้ (ให้รายงานรวมได้)
function payBill(id, p) {
    return database.ref('orders/' + id).transaction(function (o) {
        if (o === null) return o;
        if (!isOpenBill(o)) return;
        if (o.currency === 'THB') return payThb(o, p);
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

function payThb(o, p) {
    const sub = itemsSubtotal(o.items);
    const val = Math.max(0, Number(p.discountValue) || 0);
    let disc = p.discountType === 'percent' ? sub * Math.min(val, 100) / 100 : val;
    disc = Math.round(Math.min(disc, sub));
    const totalThb = sub - disc;
    const rate = Number(p.rate) > 0 ? Number(p.rate) : Number(o.rate || FX.rate || 0);
    const payCur = p.payCurrency === 'LAK' ? 'LAK' : 'THB';
    if (payCur === 'LAK' && !(rate > 0)) return;
    const due = payCur === 'LAK' ? toLak(totalThb, rate) : totalThb;
    const cash = p.method === 'cash';
    const rec = cash ? ((p.cashReceived === '' || p.cashReceived == null) ? due : Number(p.cashReceived)) : 0;
    if (cash && rec < due) return;
    const now = Date.now();
    o.rate = rate; o.subtotalThb = sub; o.discountThb = disc; o.discountType = p.discountType || 'amount'; o.discountValue = val; o.totalThb = totalThb;
    o.subtotal = toLak(sub, rate); o.total = payCur === 'LAK' ? due : toLak(totalThb, rate); o.discount = Math.max(0, o.subtotal - o.total);
    o.payCurrency = payCur; o.payAmount = due;
    o.status = 'paid'; o.paid = true; o.paymentMethod = p.method;
    o.cashReceived = cash ? rec : 0; o.change = cash ? Math.max(0, rec - due) : 0;
    o.openedAt = o.openedAt || o.timestamp || now;
    o.paidAt = now; o.timestamp = now; o.dayKey = dayKey(now); o.date = fmtDate(now);
    return o;
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
        if (bill.source !== 'preorder') adjustStock(bill.items, 1);
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

// หัวใบเสร็จ: กาแฟ = ค่าที่ตั้งใน Admin · สินค้า/พรีออเดอร์ = SHOP & PRE-ORDER · ปนกัน = HOME COFFEE · SHOP
function receiptSub(o) {
    const items = arr(o.items);
    if (o.source === 'preorder') return 'SHOP & PRE-ORDER';
    if (o.store === 'shop') return 'SHOP & PRE-ORDER';
    const shop = items.filter(function (c) { return c.shop || c.retail || isRetailItemId(c.itemId); }).length;
    if (items.length && shop === items.length) return 'SHOP & PRE-ORDER';
    if (shop > 0) return 'HOME COFFEE · SHOP';
    return RCPT.s.shopSub || '';
}
function receiptModel(o, copy) {
    if (o.source === 'preorder' && o.po && typeof poReceiptModel === 'function') return poReceiptModel(o, copy);
    const S = RCPT.s, m = [], items = arr(o.items), cur = billCur(o);
    const amt = function (n) { return cur === 'THB' ? baht(n) : Number(n || 0).toLocaleString(); };
    if (RCPT.logo) m.push({ t: 'logo' });
    m.push({ t: 'c', x: S.shopName, b: 1, z: 18 });
    const sub0 = receiptSub(o);
    if (sub0) m.push({ t: 'c', x: sub0 });
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
        m.push({ t: 'r', l: c.name + ' x' + c.quantity, r: amt(Number(c.price || 0) * Number(c.quantity || 0)) });
        const d = lineDetails(c);
        if (d) m.push({ t: 'i', x: d });
        if (c.note) m.push({ t: 'i', x: '* ' + c.note });
    });
    m.push({ t: 'hr' });
    if (cur === 'THB') {
        const subT = o.subtotalThb != null ? o.subtotalThb : itemsSubtotal(items), totT = o.totalThb != null ? o.totalThb : subT;
        m.push({ t: 'r', l: 'รวม', r: baht(subT) });
        if (Number(o.discountThb) > 0) m.push({ t: 'r', l: 'ส่วนลด', r: '-' + baht(o.discountThb) });
        m.push({ t: 'r', l: 'ยอดสุทธิ', r: baht(totT), b: 1, z: 16 });
        const pc = o.payCurrency === 'LAK' ? 'LAK' : 'THB', pm = function (n) { return moneyC(n, pc); };
        if (o.status === 'paid' && pc === 'LAK') { m.push({ t: 'r', l: 'ชำระเป็นกีบ', r: money(o.payAmount), b: 1 }); m.push({ t: 'r', l: 'เรท', r: '1 ฿ = ' + Number(o.rate || 0).toLocaleString() + ' ₭', s: 1 }); }
        else if (o.status !== 'paid' && (o.rate || FX.rate)) m.push({ t: 'r', l: '', r: approxLak(totT, o.rate || FX.rate), s: 1 });
        if (o.paymentMethod === 'cash') {
            m.push({ t: 'r', l: 'เงินสด', r: pm(o.cashReceived) });
            m.push({ t: 'r', l: 'เงินทอน', r: pm(o.change) });
        } else if (o.paymentMethod === 'transfer') m.push({ t: 'r', l: 'ชำระโดย', r: 'โอนเงิน QR' });
        warrantyBox(o, m);
        m.push({ t: 'hr' });
        m.push({ t: 'c', x: S.footer || '' });
        return m;
    }
    const sub = o.subtotal != null ? o.subtotal : itemsSubtotal(items);
    m.push({ t: 'r', l: 'รวม', r: Number(sub).toLocaleString() });
    if (Number(o.discount) > 0) m.push({ t: 'r', l: 'ส่วนลด', r: '-' + Number(o.discount).toLocaleString() });
    m.push({ t: 'r', l: 'ยอดสุทธิ', r: Number(o.total || 0).toLocaleString() + ' ₭', b: 1, z: 16 });
    if (o.paymentMethod === 'cash') {
        m.push({ t: 'r', l: 'เงินสด', r: Number(o.cashReceived || 0).toLocaleString() });
        m.push({ t: 'r', l: 'เงินทอน', r: Number(o.change || 0).toLocaleString() });
    } else if (o.paymentMethod === 'transfer') m.push({ t: 'r', l: 'ชำระโดย', r: 'โอนเงิน QR' });
    else if (o.paymentMethod === 'delivery') m.push({ t: 'r', l: 'ชำระโดย', r: 'แอป Delivery' });
    warrantyBox(o, m);
    m.push({ t: 'hr' });
    m.push({ t: 'c', x: S.footer || '' });
    return m;
}
// สินค้าในหมวด "ของแท้" → ใบเสร็จมีกล่องรับประกัน 30 วัน (นับจากวันที่จ่าย)
function warrantyBox(o, m) {
    if (o.status !== 'paid') return;
    const auth = arr(o.items).filter(function (c) { return c.auth; });
    if (!auth.length) return;
    m.push({ t: 'box', lines: [{ x: '✓ ຮັບປະກັນຂອງແທ້ 100%', b: 1 }, { x: 'ກວດພົບວ່າບໍ່ແທ້ ຄືນເງິນເຕັມຈຳນວນ' }, { x: 'ແຈ້ງໄດ້ຮອດ ' + fmtDate((o.paidAt || o.timestamp || Date.now()) + 30 * 86400000) + ' · ນຳສິນຄ້າ ແລະ ໃບນີ້ມາກວດ' }] });
}

function receiptText(o) {
    const S = RCPT.s;
    if (o.source === 'preorder' && o.po && typeof poReceiptText === 'function') return poReceiptText(o);
    const thb = billCur(o) === 'THB';
    let t = S.shopName + '\n' + 'บิล #' + (o.orderNo || '-') + '  ' + fmtDateTime(o.paidAt || o.timestamp) + '\n----------------\n';
    arr(o.items).forEach(function (c) {
        const d = lineDetails(c), v = Number(c.price || 0) * Number(c.quantity || 0);
        t += c.name + (d ? ' (' + d + ')' : '') + ' x' + c.quantity + '  ' + (thb ? baht(v) : v.toLocaleString()) + '\n';
    });
    t += '----------------\n';
    if (thb) {
        if (Number(o.discountThb) > 0) t += 'ส่วนลด -' + baht(o.discountThb) + '\n';
        t += 'ยอดสุทธิ ' + baht(o.totalThb) + (o.payCurrency === 'LAK' ? '\nชำระเป็นกีบ ' + money(o.payAmount) + ' (1฿ = ' + o.rate + '₭)' : '') + '\n';
        if (S.footer) t += '\n' + S.footer;
        return t;
    }
    if (Number(o.discount) > 0) t += 'ส่วนลด -' + Number(o.discount).toLocaleString() + '\n';
    t += 'ยอดสุทธิ ' + Number(o.total || 0).toLocaleString() + ' ₭\n';
    if (S.footer) t += '\n' + S.footer;
    return t;
}

/* ---------- ใบพรีออเดอร์ (ภาษาลาว) ----------
   บิลพรีออเดอร์เก็บข้อมูลไว้ใน bill.po ครบ จึงพิมพ์ซ้ำได้จากทุกหน้า (แคชเชียร์ / Admin)
   po.kind: 'deposit' มัดจำ · 'full' จ่ายเต็มตอนสั่ง · 'final' จ่ายส่วนที่เหลือ · 'pickup' ใบรับของ (ไม่มีเงิน) */
const PO_TXT = {
    noCancelDep: '⚠️ ມັດຈຳແລ້ວ ບໍ່ສາມາດຍົກເລີກ ແລະ ບໍ່ຄືນເງິນມັດຈຳ',
    noCancelFull: '⚠️ ສັ່ງຈອງແລ້ວ ບໍ່ສາມາດຍົກເລີກ ແລະ ບໍ່ຄືນເງິນ',
    authHead: 'ເກີບຂອງແທ້ 100%',
    c1: 'ທຸກຄູ່ມີລະຫັດລຸ້ນ ໃຫ້ທ່ານກວດເອງໄດ້',
    c2: 'ກວດພົບວ່າບໍ່ແທ້ ຄືນເງິນເຕັມຈຳນວນ ພາຍໃນ 30 ວັນ',
    c3: 'ເຄື່ອງຮອດພາຍໃນ 7–14 ວັນເຮັດການ · ຖ້າຮ້ານສົ່ງເຄື່ອງບໍ່ໄດ້ ຄືນເງິນເຕັມຈຳນວນ',
    c4: 'ກໍລະນີເຄື່ອງສົ່ງມາແລ້ວ ແຕ່ມີບັນຫາຂົນສົ່ງ ລໍຖ້າເພີ່ມບໍ່ເກີນ 7 ວັນ · ຖ້າບໍ່ຮອດ ຄືນເງິນເຕັມຈຳນວນ',
    condHead: 'ເງື່ອນໄຂການສັ່ງຈອງ'
};
function poConds(auth) {
    const out = [];
    if (auth) { out.push(PO_TXT.c1, PO_TXT.c2); }
    out.push(PO_TXT.c3, PO_TXT.c4);
    return out.map(function (t, i) { return (i + 1) + '. ' + t; });
}
function poVar(v) { v = String(v || '').trim(); return !v ? '' : /^[0-9]+(\.[0-9]+)?$/.test(v) ? 'ໄຊສ໌ ' + v : v; }
function poItemSub(p) { return [poVar(p.variant), p.styleCode ? 'ລະຫັດລຸ້ນ ' + p.styleCode : '', Number(p.qty) > 1 ? p.qty + ' ຄູ່' : ''].filter(Boolean).join(' · '); }
function poDM(ts) { const d = new Date(ts); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1); }
function poEta(p) { return p.etaFrom && p.etaTo ? poDM(p.etaFrom) + ' – ' + poDM(p.etaTo) : ''; }
function poMethod(o) { return (o.paymentMethod === 'cash' ? 'ເງິນສົດ' : 'ໂອນ') + (o.currency === 'THB' ? (o.payCurrency === 'LAK' ? ' · ເປັນກີບ' : ' · ເປັນບາດ') : ''); }
function poReceiptModel(o, copy) {
    const S = RCPT.s, p = o.po, m = [], cur = p.cur === 'THB' ? 'THB' : 'LAK', M = function (n) { return moneyC(n, cur); };
    const thb = cur === 'THB', rate = Number(o.rate || FX.rate || 0);
    if (RCPT.logo) m.push({ t: 'logo' });
    m.push({ t: 'c', x: S.shopName, b: 1, z: 18 });
    m.push({ t: 'c', x: 'SHOP & PRE-ORDER', b: 1 });
    const contact = [S.address, S.phone ? 'WhatsApp ' + S.phone : ''].filter(Boolean).join(' · ');
    if (contact) m.push({ t: 'cs', x: contact });
    if (copy) m.push({ t: 'c', x: '*** ສຳເນົາ (COPY) ***', b: 1 });
    if (o.status === 'void') m.push({ t: 'c', x: '*** ຍົກເລີກ (VOID) ***', b: 1, z: 16 });
    m.push({ t: 'hr2' });
    m.push({ t: 'c', x: p.kind === 'deposit' ? 'ໃບຮັບເງິນມັດຈຳ' : p.kind === 'pickup' ? 'ໃບຮັບເຄື່ອງ' : 'ໃບຮັບເງິນ', b: 1, z: 16 });
    m.push({ t: 'tag', x: 'PRE-ORDER' });
    m.push({ t: 'hr' });
    m.push({ t: 'r', l: 'ເລກທີ', r: p.no || '' });
    m.push({ t: 'r', l: p.pickedAt ? 'ວັນທີຮັບເຄື່ອງ' : 'ວັນທີ', r: fmtDateTime(p.pickedAt || o.paidAt || o.timestamp) });
    if (o.customerName) m.push({ t: 'r', l: 'ລູກຄ້າ', r: o.customerName });
    if (o.customerPhone && p.kind !== 'final' && p.kind !== 'pickup') m.push({ t: 'r', l: 'ເບີ', r: o.customerPhone });
    m.push({ t: 'hr' });
    m.push({ t: 'p', x: String(p.name || '').toUpperCase(), b: 1 });
    const sub = poItemSub(p);
    if (sub) m.push({ t: 'p', x: sub });
    m.push({ t: 'hr' });
    m.push({ t: 'r', l: 'ລາຄາເຕັມ', r: M(p.total) });
    if (p.kind === 'pickup') {
        m.push({ t: 'r', l: 'ຊຳລະແລ້ວ', r: M(p.paidBefore) });
    } else {
        if (p.kind === 'final' && Number(p.paidBefore) > 0) m.push({ t: 'r', l: 'ມັດຈຳ' + (p.depositAt ? ' (' + poDM(p.depositAt) + ')' : ''), r: '−' + M(p.paidBefore) });
        const lbl = p.kind === 'deposit' ? 'ມັດຈຳແລ້ວ' + (p.pct ? ' (' + p.pct + '%)' : '') : p.kind === 'final' ? 'ຊຳລະວັນນີ້' : 'ຊຳລະແລ້ວ (ເຕັມ)';
        m.push({ t: 'r', l: lbl, r: M(p.paidNow), inv: 1 });
        if (thb && o.payCurrency === 'LAK') {
            m.push({ t: 'r', l: 'ຊຳລະ: ' + poMethod(o), r: money(o.payAmount), s: 1 });
            m.push({ t: 'r', l: 'ເຣດ', r: '1 ฿ = ' + Number(o.rate || 0).toLocaleString() + ' ₭', s: 1 });
        } else m.push({ t: 'r', l: 'ຊຳລະ: ' + poMethod(o), r: thb ? baht(o.payAmount != null ? o.payAmount : p.paidNow) : money(o.total), s: 1 });
        if (o.paymentMethod === 'cash' && Number(o.cashReceived) > 0) {
            const pc = thb ? (o.payCurrency === 'LAK' ? 'LAK' : 'THB') : 'LAK';
            m.push({ t: 'r', l: 'ຮັບເງິນ / ທອນ', r: Number(o.cashReceived).toLocaleString() + ' / ' + moneyC(o.change, pc), s: 1 });
        }
    }
    const remain = Math.max(0, Number(p.remaining || 0));
    if (remain > 0) {
        m.push({ t: 'r', l: 'ຍອດຄົງເຫຼືອ', r: M(remain), b: 1, z: 15 });
        if (thb && rate) m.push({ t: 'r', l: 'ຈ່າຍຕອນຮັບເຄື່ອງ', r: approxLak(remain, rate), s: 1 });
    } else m.push({ t: 'stamp', x: 'ຊຳລະຄົບ ✓' });
    if (p.pickedAt) {
        if (p.authentic) m.push({ t: 'box', lines: [{ x: '✓ ຮັບປະກັນຂອງແທ້ 100%', b: 1 }, { x: 'ກວດພົບວ່າບໍ່ແທ້ ຄືນເງິນເຕັມຈຳນວນ' }, { x: 'ແຈ້ງໄດ້ຮອດ ' + fmtDate(p.claimUntil) + ' · ນຳເກີບ ແລະ ໃບນີ້ມາກວດ' }] });
        if (p.authentic) m.push({ t: 'cs', x: 'ກະລຸນາເກັບໃບນີ້ໄວ້ ສຳລັບການຮັບປະກັນ' });
    } else {
        m.push({ t: 'hr' });
        if (poEta(p)) m.push({ t: 'r', l: 'ຄາດວ່າເຄື່ອງຮອດ', r: poEta(p) });
        m.push({ t: 'cs', x: '7–14 ວັນເຮັດການ · ຮ້ານຈະແຈ້ງທາງ WhatsApp ເມື່ອເຄື່ອງຮອດ' });
        if (p.kind !== 'final') m.push({ t: 'box', lines: [{ x: p.kind === 'deposit' ? PO_TXT.noCancelDep : PO_TXT.noCancelFull, b: 1 }] });
        m.push({ t: 'p', x: p.authentic ? PO_TXT.authHead : PO_TXT.condHead, b: 1 });
        poConds(p.authentic).forEach(function (t) { m.push({ t: 'p', x: t }); });
        if (p.track) { m.push({ t: 'hr' }); m.push({ t: 'cs', x: 'ສະແກນເບິ່ງສະຖານະເຄື່ອງ' }); m.push({ t: 'qr', x: p.track }); }
        m.push({ t: 'cs', x: 'ກະລຸນາເກັບໃບນີ້ໄວ້ ເພື່ອຮັບເຄື່ອງ' });
    }
    m.push({ t: 'c', x: 'ຂອບໃຈທີ່ອຸດໜູນ 🙏' });
    return m;
}
// ข้อความ WhatsApp ของใบพรีออเดอร์ (ภาษาลาว)
function poReceiptText(o) {
    const p = o.po, cur = p.cur === 'THB' ? 'THB' : 'LAK', M = function (n) { return moneyC(n, cur); }, rate = Number(o.rate || FX.rate || 0);
    const remain = Math.max(0, Number(p.remaining || 0)), out = [];
    out.push('ສະບາຍດີ ' + (o.customerName || '') + ' 🙏');
    if (p.kind === 'deposit') out.push('ຮ້ານໄດ້ຮັບເງິນມັດຈຳແລ້ວ', 'ໃບຮັບມັດຈຳ ' + p.no);
    else if (p.kind === 'pickup') out.push('ຂອບໃຈທີ່ມາຮັບເຄື່ອງ', 'ໃບຮັບເຄື່ອງ ' + p.no);
    else out.push('ຮ້ານໄດ້ຮັບເງິນແລ້ວ', 'ໃບຮັບເງິນ ' + p.no);
    out.push(String(p.name || '').toUpperCase());
    const sub = poItemSub(p); if (sub) out.push(sub);
    out.push('ລາຄາເຕັມ: ' + M(p.total));
    if (p.kind === 'deposit') out.push('ມັດຈຳແລ້ວ: ' + M(p.paidNow) + ' (' + (o.paymentMethod === 'cash' ? 'ເງິນສົດ' : 'ໂອນ') + ')');
    else if (p.kind === 'final') { if (Number(p.paidBefore) > 0) out.push('ມັດຈຳ: ' + M(p.paidBefore)); out.push('ຊຳລະວັນນີ້: ' + M(p.paidNow)); }
    else if (p.kind === 'full') out.push('ຊຳລະແລ້ວ (ເຕັມ): ' + M(p.paidNow));
    if (remain > 0) out.push('ຄົງເຫຼືອ: ' + M(remain) + (cur === 'THB' && rate ? ' (' + approxLak(remain, rate) + ')' : ''));
    else out.push('ຊຳລະຄົບ ✓');
    if (p.pickedAt) {
        if (p.authentic) out.push('', '✓ ຮັບປະກັນຂອງແທ້ 100% · ກວດພົບວ່າບໍ່ແທ້ ຄືນເງິນເຕັມຈຳນວນ', 'ແຈ້ງໄດ້ຮອດ ' + fmtDate(p.claimUntil));
    } else {
        if (poEta(p)) out.push('ຄາດວ່າເຄື່ອງຮອດ: ' + poEta(p));
        if (p.kind !== 'final') out.push(p.kind === 'deposit' ? PO_TXT.noCancelDep : PO_TXT.noCancelFull);
        out.push((p.authentic ? '✓ ' + PO_TXT.authHead : PO_TXT.condHead));
        poConds(p.authentic).forEach(function (t) { out.push(t); });
        if (p.track) out.push('🔎 ຕິດຕາມສະຖານະເຄື່ອງ:', p.track);
    }
    return out.join('\n');
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
        '.r-b{font-weight:bold}.r-i{padding-left:8px;font-size:11px}#print-area img{max-width:100%;max-height:70px}' +
        '.r-hr2{border-top:2px solid #000;margin:6px 0}.r-s{font-size:10.5px}.r-inv{background:#000;color:#fff;padding:3px 4px;font-weight:bold;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
        '.r-tag{display:inline-block;border:1.5px solid #000;padding:0 6px;font-weight:bold;letter-spacing:1px;margin-top:2px}.r-stamp{border:2px solid #000;text-align:center;font-weight:bold;font-size:16px;padding:2px 0;margin:6px 0}' +
        '.r-box{border:1.5px solid #000;padding:4px 6px;margin:6px 0;font-size:11px}.r-p{font-size:11px;margin:2px 0}#print-area img.r-qr{width:30mm;height:30mm;max-height:none;image-rendering:pixelated}}';
    document.head.appendChild(st);
    const ps = document.createElement('style'); ps.id = 'print-page-style'; document.head.appendChild(ps);
    return a;
}
// copy = true จะพิมพ์คำว่า "สำเนา (COPY)"; id = ใส่เพื่อนับจำนวนครั้งที่พิมพ์
// ตั้งค่า "ส่งตรงไป RawBT" + เปิดบน Android = ส่งเป็นรูป ESC/POS ไป RawBT ทันที ไม่ผ่านหน้าต่างพิมพ์
function printReceipt(o, copy, id) {
    if (id) database.ref('orders/' + id + '/printCount').transaction(function (n) { return (n || 0) + 1; });
    if (!rcptRawbtOk()) { printReceiptDialog(o, copy); return; }
    rcptEscBytes(o, copy).then(function (b) { window.location.href = 'rawbt:base64,' + stkB64(b); },
        function () { printReceiptDialog(o, copy); });   /* วาดรูปไม่ได้ -> ใช้หน้าต่างพิมพ์แทน */
}
function rcptRawbtOk() { return RCPT.s.printMethod === 'rawbt' && /Android/i.test(navigator.userAgent || ''); }
// ใบเสร็จ (รูปเดียวกับที่แชร์ให้ลูกค้า) -> ภาพขาวดำกว้างเท่าหัวพิมพ์ 384/576 จุด -> ESC/POS + เลื่อนกระดาษ + ตัด (เครื่องไม่มีมีดจะข้ามคำสั่งตัด)
async function rcptEscBytes(o, copy) {
    const cv = await receiptCanvas(o, copy);
    const W = RCPT.s.paperSize === '80mm' ? 576 : 384, H = Math.round(cv.height * W / cv.width);
    const k = document.createElement('canvas'); k.width = W; k.height = H;
    const c = k.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.drawImage(cv, 0, 0, W, H);
    return stkCat([Uint8Array.of(0x1B, 0x40), stkEscRaster(stkBits(k, 160, false), W / 8, H, 40, 0), Uint8Array.of(0x1B, 0x64, 4, 0x1D, 0x56, 0x42, 0)]);
}
function printReceiptDialog(o, copy) {
    const area = ensurePrintArea();
    const narrow = RCPT.s.paperSize !== '80mm';
    let h = '';
    receiptModel(o, copy).forEach(function (e) {
        const z = e.z ? ' style="font-size:' + e.z + 'px"' : '';
        if (e.t === 'logo') h += '<div class="r-c"><img src="' + esc(RCPT.logo) + '"></div>';
        else if (e.t === 'hr') h += '<div class="r-hr"></div>';
        else if (e.t === 'c') h += '<div class="r-c' + (e.b ? ' r-b' : '') + '"' + z + '>' + esc(e.x) + '</div>';
        else if (e.t === 'i') h += '<div class="r-i">' + esc(e.x) + '</div>';
        else if (e.t === 'r') h += '<div class="r-r' + (e.b ? ' r-b' : '') + (e.inv ? ' r-inv' : '') + (e.s ? ' r-s' : '') + '"' + z + '><span>' + esc(e.l) + '</span><span>' + esc(e.r) + '</span></div>';
        else if (e.t === 'hr2') h += '<div class="r-hr2"></div>';
        else if (e.t === 'cs') h += '<div class="r-c r-s' + (e.b ? ' r-b' : '') + '">' + esc(e.x) + '</div>';
        else if (e.t === 'tag') h += '<div class="r-c"><span class="r-tag">' + esc(e.x) + '</span></div>';
        else if (e.t === 'stamp') h += '<div class="r-stamp">' + esc(e.x) + '</div>';
        else if (e.t === 'box') h += '<div class="r-box">' + e.lines.map(function (L) { return '<div class="' + (L.b ? 'r-b' : '') + '">' + esc(L.x) + '</div>'; }).join('') + '</div>';
        else if (e.t === 'p') h += '<div class="r-p' + (e.b ? ' r-b' : '') + '">' + esc(e.x) + '</div>';
        else if (e.t === 'qr') h += '<div class="r-c"><img class="r-qr" src="' + qrDataUrl(e.x) + '"></div>';
    });
    area.style.width = narrow ? '48mm' : '72mm';
    area.innerHTML = h;
    document.getElementById('print-page-style').textContent = '@page{size:' + (narrow ? '58mm' : '80mm') + ' auto;margin:2mm}';
    setTimeout(function () { window.print(); }, 150);
}

// QR เป็นรูป (ใช้ในใบพรีออเดอร์ให้ลูกค้าสแกนดูสถานะ)
function qrDataUrl(url) {
    try {
        const q = stkQr(url), n = q.getModuleCount(), cell = 4, cv = document.createElement('canvas');
        cv.width = cv.height = (n + 4) * cell;
        const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + 2) * cell, (r + 2) * cell, cell, cell);
        return cv.toDataURL('image/png');
    } catch (e) { return ''; }
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
            } else if (e.t === 'hr2') {
                if (draw) { ctx.fillStyle = '#000'; ctx.fillRect(PAD, y + 3, cw, 2); }
                y += 10;
            } else if (e.t === 'c' || e.t === 'i' || e.t === 'cs' || e.t === 'p') {
                const z = e.z || (e.t === 'i' || e.t === 'p' ? 12 : e.t === 'cs' ? 11.5 : 14), f = font(e.b, z), lh = Math.round(z * 1.45), ind = e.t === 'i' ? 10 : 0;
                const center = e.t === 'c' || e.t === 'cs';
                wrap(e.x, cw - ind, f).forEach(function (L) {
                    if (draw) {
                        ctx.font = f; ctx.fillStyle = '#000';
                        if (center) { ctx.textAlign = 'center'; ctx.fillText(L, W / 2, y + z); } else { ctx.textAlign = 'left'; ctx.fillText(L, PAD + ind, y + z); }
                    }
                    y += lh;
                });
            } else if (e.t === 'tag' || e.t === 'stamp') {
                const z = e.t === 'stamp' ? 18 : 13, f = font(1, z);
                ctx.font = f; const tw = ctx.measureText(e.x).width, bw = e.t === 'stamp' ? cw : tw + 14, bh = Math.round(z * 1.6);
                if (draw) {
                    ctx.strokeStyle = '#000'; ctx.lineWidth = e.t === 'stamp' ? 2 : 1.5; ctx.strokeRect((W - bw) / 2, y + 2, bw, bh);
                    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.fillText(e.x, W / 2, y + 2 + bh / 2 + z * 0.36);
                }
                y += bh + 8;
            } else if (e.t === 'box') {
                const z = 12, lh = Math.round(z * 1.45), all = [];
                e.lines.forEach(function (L) { wrap(L.x, cw - 14, font(L.b, z)).forEach(function (t) { all.push({ x: t, b: L.b }); }); });
                const bh = all.length * lh + 10;
                if (draw) {
                    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.strokeRect(PAD, y + 2, cw, bh);
                    all.forEach(function (L, i) { ctx.font = font(L.b, z); ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.fillText(L.x, PAD + 7, y + 7 + i * lh + z); });
                }
                y += bh + 8;
            } else if (e.t === 'qr') {
                const q = stkQr(e.x), n = q.getModuleCount(), cell = Math.max(2, Math.floor(150 / (n + 2))), sz = cell * n;
                if (draw) {
                    ctx.fillStyle = '#000';
                    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((W - sz) / 2 + c * cell, y + 4 + r * cell, cell, cell);
                }
                y += sz + 10;
            } else if (e.t === 'r') {
                const z = e.z || (e.s ? 12 : 14), f = font(e.b || e.inv, z), lh = Math.round(z * 1.45);
                ctx.font = f; const rw = ctx.measureText(e.r || '').width;
                const lines = wrap(e.l, Math.max(60, cw - rw - 8), f);
                if (e.inv && draw) { ctx.fillStyle = '#000'; ctx.fillRect(PAD - 4, y, cw + 8, lines.length * lh + 6); }
                if (e.inv) y += 3;
                lines.forEach(function (L, idx) {
                    if (draw) {
                        ctx.font = f; ctx.fillStyle = e.inv ? '#fff' : '#000';
                        ctx.textAlign = 'left'; ctx.fillText(L, PAD, y + z);
                        if (idx === lines.length - 1) { ctx.textAlign = 'right'; ctx.fillText(e.r || '', W - PAD, y + z); }
                    }
                    y += lh;
                });
                if (e.inv) y += 5;
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
    const t = String(raw || '').trim();
    let d = t.replace(/[^\d]/g, '');
    if (!d) return '';
    // ใส่ + นำหน้า = เบอร์ต่างประเทศครบรหัสแล้ว (เช่น +66 88 866 9566) ใช้ตามนั้นเลย
    if (t.charAt(0) === '+') return d;
    // เบอร์ไทย 10 หลัก ขึ้นต้น 06 / 08 / 09 (เบอร์ลาวขึ้นต้น 020 / 030)
    if (/^0[689]\d{8}$/.test(d)) return '66' + d.slice(1);
    if (/^66[689]\d{8}$/.test(d)) return d;
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
    if (del) name = bill.appOrderNo ? String(bill.appOrderNo) : '';
    else if (cfg.showName) name = bill.customerName || (cfg.nameFallback === 'table' && bill.table ? 'โต๊ะ ' + bill.table : '');
    return {
        no: bill.orderNo, k: k, n: n, name: name,
        item: line.name || '', details: lineDetails(line), note: line.note || '',
        type: cfg.showType ? (del ? String(bill.source) : (bill.orderType || '')) : '',
        time: cfg.showTime ? timeHHMM(Date.now()) : ''
    };
}
function stkQr(url) {
    var q = new QRLib.QRCode(-1, QRLib.ECL.L); q.addData(url); q.make(); return q;
}
function stkLS(c, px) { try { c.letterSpacing = px + 'px'; } catch (e) {} }
// วาดสติกเกอร์ลง ctx ที่ตำแหน่ง (x0,y0) ขนาด d.w x d.h — แบบ A3 (ตัวใหญ่เต็มแผ่น + ป้ายดำประเภทออเดอร์)
function stkPaint(c, d, data, cfg, x0, y0) {
    c.save(); c.translate(x0, y0);
    c.fillStyle = '#fff'; c.fillRect(0, 0, d.w, d.h); c.fillStyle = '#000'; c.textBaseline = 'top'; c.textAlign = 'left';
    var s = Math.min(d.w / 480, d.h / 320), pad = Math.round(14 * s), W = d.w - 2 * pad, R = d.w - pad, B = d.h - pad;
    var F = function (px, w) { c.font = (w || '') + ' ' + Math.round(px) + 'px ' + STK_FONT; };
    // ---- ล่าง: QR ขวา, เวลา + ชื่อร้าน ซ้าย ----
    var hasQr = !!(cfg.qrOn && cfg.qrUrl), qx = d.w, qTop = d.h;
    if (hasQr) {
        try {
            var q = stkQr(cfg.qrUrl), cnt = q.getModuleCount(), labelH = cfg.qrLabel ? Math.round(22 * s) : 0;
            var maxBox = Math.min(Math.round(cfg.qrSizeMm * d.k), Math.round(104 * s));
            var mod = Math.floor(maxBox / (cnt + 2));
            if (mod >= 2) {
                var box = mod * (cnt + 2), qy = B - labelH - box; qx = R - box;
                for (var r = 0; r < cnt; r++) for (var cc = 0; cc < cnt; cc++) if (q.isDark(r, cc)) c.fillRect(qx + (cc + 1) * mod, qy + (r + 1) * mod, mod, mod);
                if (cfg.qrLabel) { var lb = stkFit(c, cfg.qrLabel, box + pad, Math.round(18 * s), 12, ''); F(lb.px); c.textAlign = 'center'; c.fillText(lb.text, qx + box / 2, B - labelH + 2); c.textAlign = 'left'; }
                qTop = qy;
            } else qx = d.w;
        } catch (e) { qx = d.w; }
    }
    var botW = (qx < d.w ? qx - pad : R) - pad;
    var hasShop = cfg.showShop && cfg.shopText;
    var shopPx = Math.round(28 * s), metaPx = Math.round(25 * s);
    var yShop = B - shopPx, yMeta = hasShop ? yShop - Math.round(metaPx * 1.25) : B - metaPx;
    var useTypePill = !!data.type;
    var meta = [useTypePill && data.n ? data.k + '/' + data.n : '', data.time].filter(Boolean).join('  ·  ');
    if (hasShop) { stkLS(c, Math.round(4 * s)); var sh = stkFit(c, String(cfg.shopText).toUpperCase(), botW, shopPx, 14, 'bold'); F(sh.px, 'bold'); c.fillText(sh.text, pad, yShop); stkLS(c, 0); }
    if (meta) { var mt = stkFit(c, meta, botW, metaPx, 14, '600'); F(mt.px, '600'); c.fillText(mt.text, pad, yMeta); }
    var bottomTop = (meta ? yMeta : (hasShop ? yShop : B)) - Math.round(8 * s);
    // ---- บน: เลขคิว + ป้ายดำ ----
    var y = pad;
    var noTxt = '#' + data.no, noPx = Math.round(70 * s);
    F(noPx, 'bold'); var noW = c.measureText(noTxt).width;
    var pill = useTypePill ? String(data.type).toUpperCase() : (data.n ? data.k + '/' + data.n : '');
    if (pill) {
        var pPx = Math.round(26 * s), pPad = Math.round(12 * s), pH = Math.round(pPx * 1.55);
        stkLS(c, Math.round(2 * s));
        var pf = stkFit(c, pill, W - noW - 3 * pad - 2 * pPad, pPx, 12, 'bold'); F(pf.px, 'bold');
        var pw = c.measureText(pf.text).width + 2 * pPad, px0 = R - pw, py0 = y + Math.round((noPx * 0.86 - pH) / 2);
        c.beginPath(); if (c.roundRect) c.roundRect(px0, py0, pw, pH, Math.round(9 * s)); else c.rect(px0, py0, pw, pH); c.fill();
        c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(pf.text, px0 + pPad, py0 + pH / 2 + 1); c.textBaseline = 'top'; c.fillStyle = '#000';
        stkLS(c, 0);
    }
    F(noPx, 'bold'); c.fillText(noTxt, pad - Math.round(2 * s), y);
    y += Math.round(noPx * 0.98);
    // ชื่อลูกค้า / เลขออร์เดอร์แอป
    if (data.name) { var nf = stkFit(c, data.name, W, Math.round(30 * s), Math.round(20 * s), 'bold'); F(nf.px, 'bold'); c.fillText(nf.text, pad, y); y += Math.round(nf.px * 1.2); }
    // ---- ชื่อเมนู (ใหญ่สุด ยาวได้ 2 บรรทัด) ----
    var rowW = function (yy, hh) { return (yy + hh > qTop) ? qx - 2 * pad : W; };
    var big = Math.round(74 * s), minOne = Math.round(44 * s);
    var it = stkFit(c, data.item, W, big, minOne, 'bold');
    var itemLines;
    if (it.text !== data.item) {
        var p2 = Math.round(40 * s); F(p2, 'bold');
        itemLines = stkWrap(c, data.item, W, 2); it.px = p2;
    } else itemLines = [it.text];
    F(it.px, 'bold');
    var ilh = Math.round(it.px * 1.08);
    itemLines.forEach(function (l) { c.fillText(l, pad - Math.round(1 * s), y); y += ilh; });
    y += Math.round(6 * s);
    // ---- ตัวเลือก + หมายเหตุ (มีแถบดำนำหน้า) ----
    var bar = Math.max(3, Math.round(6 * s)), ix = pad + bar + Math.round(10 * s), lines = [], oPx, olh;
    var sizes = [30, 26, 22];
    for (var si = 0; si < sizes.length; si++) {
        oPx = Math.round(sizes[si] * s); olh = Math.round(oPx * 1.28); F(oPx, '600'); lines = [];
        var ow = rowW(y, olh) - (ix - pad);
        if (data.details) stkWrap(c, data.details.split(' | ').join('  ·  '), ow, 2, '  ·  ').forEach(function (l) { lines.push(l.replace(/\s*·\s*$/, '')); });
        if (data.note) stkWrap(c, '* ' + data.note, ow, 2).forEach(function (l) { lines.push(l); });
        if (y + lines.length * olh <= bottomTop + Math.round(6 * s)) break;
    }
    var y0b = y, drawn = 0;
    lines.forEach(function (l) { if (y + olh <= bottomTop + Math.round(6 * s)) { c.fillText(l, ix, y + Math.round(2 * s)); y += olh; drawn++; } });
    if (drawn) c.fillRect(pad, y0b, bar, y - y0b);
    if (cfg.paper === 'receipt') { for (var dx = 0; dx < d.w; dx += 20) c.fillRect(dx, d.h - 4, 12, 2); }
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
    if (m === 'esc') { /* เติมขอบขาว + โหมดประหยัดข้อมูล (½ = ลดแนวตั้ง, ¼ = ลดทั้งสองแนว เครื่องขยายกลับเองด้วย GS v 0 m=1/2/3) */
        var sv2 = Number(cfg.dataSave) || 0, gx = sv2 >= 2 ? 2 : 1, gy = sv2 >= 1 ? 2 : 1;
        var pw = Math.ceil(hd / gx / 8) * 8, ph = Math.ceil(d.h / gy);
        k = document.createElement('canvas'); k.width = pw; k.height = ph; c = k.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, pw, ph); c.scale(1 / gx, 1 / gy);
        if (ruler) stkRuler(c, hd, d.h, d.k); else stkPaint(c, d, data, cfg, d.ox, d.oy);
        return stkEscJobs(Uint8Array.of(0x1B, 0x40), stkBits(k, thr, false), pw / 8, ph, stkPost(cfg), cfg, (gx === 2 ? 1 : 0) + (gy === 2 ? 2 : 0));
    }
    k = document.createElement('canvas'); k.width = hd; k.height = d.h; c = k.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, hd, d.h);
    if (ruler) stkRuler(c, hd, d.h, d.k); else stkPaint(c, d, data, cfg, d.ox, d.oy);
    var bits = stkBits(k, thr, false), bw = hd / 8;
    if (m === 'cpcl') return [stkCat([stkEnc('! 0 ' + cfg.dpi + ' ' + cfg.dpi + ' ' + d.h + ' 1\r\nPW ' + hd + '\r\nEG ' + bw + ' ' + d.h + ' 0 0 '), bits, stkEnc('\r\nFORM\r\nPRINT\r\n')])];
    return stkEscJobs(Uint8Array.of(0x1B, 0x40), bits, bw, d.h, stkPost(cfg), cfg);
}
// ส่งทีละใบ เว้นช่วงให้ RawBT รับทันทีละงาน
var STK_JOB_MAX = 1, STK_JOB_GAP = 5000;   // 1 = ส่งทีละใบเสมอ (เครื่อง DP30S รับ 2 ใบติดกันไม่ทัน ใบแรกเพี้ยน ใบที่สองหาย)
function stkSendAll(list, cfg) {
    if (true) {
        /* RawBT ใช้เวลาต่อเครื่อง ~5 วินาทีต่องาน และเครื่องสติกเกอร์รับข้อมูลก้อนใหญ่ไม่ทัน (ใบแรกเพี้ยน)
           → รวมหลายใบเป็นงานเดียวได้ไม่เกิน STK_JOB_MAX ไบต์ ที่เหลือส่งเป็นงานถัดไป เว้น 5 วินาที */
        var per = list.map(function (it) { return stkCat(stkBytes(it === 'RULER' ? null : it, cfg)); });
        var jobs = [], cur = [], size = 0, max = cfg.paper === 'receipt' ? 1e9 : STK_JOB_MAX;
        per.forEach(function (b) {
            if (cur.length && size + b.length > max) { jobs.push(cur); cur = []; size = 0; }
            cur.push(b); size += b.length;
        });
        if (cur.length) jobs.push(cur);
        if (cfg.paper === 'receipt') jobs[jobs.length - 1].push(Uint8Array.of(0x1B, 0x64, 4)); /* เลื่อนกระดาษพ้นแท่นฉีก */
        var ji = 0;
        (function go() {
            if (ji >= jobs.length) return;
            window.location.href = 'rawbt:base64,' + stkB64(stkCat(jobs[ji++]));
            if (ji < jobs.length) setTimeout(go, STK_JOB_GAP);
        })();
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
