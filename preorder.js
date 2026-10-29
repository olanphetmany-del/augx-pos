/* =====================================================================
   preorder.js — 📦 พรีออเดอร์ (รองเท้า / สินค้าสั่งจอง)
   ใช้ในหน้าแคชเชียร์ (cashier.html) และหน้า Admin · ต้องโหลดหลัง shared.js
   - สร้างพรีออเดอร์: จ่ายเต็ม / มัดจำ 50% / กำหนดเอง · บังคับชื่อ + WhatsApp
   - สถานะ: รับออร์เดอร์ → สั่งของแล้ว → กำลังขนส่ง → ของถึงร้าน → ลูกค้ารับแล้ว
   - ของถึงช่วงไหน: 7–14 วันทำการ (หยุดวันอาทิตย์ + วันหยุดที่ตั้งใน Admin)
   - เตือน: 🟡 ครบ 7 วันทำการ · 🟠 สั่งแล้วแต่เลย 14 วัน (รอขนส่งเพิ่มได้ 7 วัน) · 🔴 เกินกำหนด → คืนเงินเต็ม
   - คืนเงิน / ลูกค้าไม่มารับ = เฉพาะบัญชีเจ้าของร้าน
   - เงินทุกงวด (มัดจำ / ส่วนที่เหลือ) ลงเป็นบิลชำระแล้วใน orders (source = 'preorder') ไม่เข้าครัว
   - ลูกค้าดูสถานะได้ที่ order.html#t=<รหัส> (order_track)
   ===================================================================== */
(function () {
    'use strict';

    var DAY = 86400000;
    var ST = {
        new: { th: 'รับออร์เดอร์', icon: '🧾', track: 'po_new' },
        ordered: { th: 'สั่งของแล้ว', icon: '🛒', track: 'po_ordered' },
        shipping: { th: 'กำลังขนส่ง', icon: '🚚', track: 'po_ship' },
        arrived: { th: 'ของถึงร้าน', icon: '📦', track: 'po_arrived' },
        picked: { th: 'ลูกค้ารับแล้ว', icon: '✅', track: 'po_done' },
        refunded: { th: 'คืนเงินแล้ว', icon: '↩', track: 'po_refund' },
        noshow: { th: 'ลูกค้าไม่มารับ', icon: '⏰', track: 'po_noshow' }
    };
    var FLOW = ['new', 'ordered', 'shipping', 'arrived', 'picked'];
    var REFUND_REASONS = [
        { th: 'ร้านต้นทางไม่มีของ / ส่งไม่ได้', lo: 'ຮ້ານສົ່ງເຄື່ອງບໍ່ໄດ້' },
        { th: 'เกิน 14 วันทำการ ยังสั่งของไม่ได้', lo: 'ເກີນ 14 ວັນເຮັດການ' },
        { th: 'ขนส่งมีปัญหา รอเพิ่มเกิน 7 วัน', lo: 'ບັນຫາຂົນສົ່ງ ເກີນ 7 ວັນ' },
        { th: 'ของไม่แท้ (ลูกค้าคืนของ)', lo: 'ກວດພົບວ່າບໍ່ແທ້', fake: true },
        { th: 'อื่นๆ', lo: '' }
    ];
    // หน้าไหนใช้: 'shop' = หน้า SHOP (รองเท้า) · 'cafe' = แคชเชียร์ (สินค้าร้านกาแฟ เปิดได้ใน Admin) · 'all' = Admin
    var MODE = window.AXPO_MODE || 'all';
    var A = {
        list: {}, cfg: {}, items: {}, cats: {}, cafeOn: false, embed: false, started: false, btn: null, ov: null,
        view: 'list', id: null, tab: 'active', q: '', f: null, pay: null, busy: false, done: null, refund: null
    };

    function E(s) { return esc(s); }
    function say(t, ok) { toast(t, ok); }
    function isOwner() {
        var u = firebase.auth && firebase.auth().currentUser;
        return !!(u && isOwnerEmail(u.email));
    }
    function trackLink(tok) { return location.href.replace(/[^/]*([?#].*)?$/, 'order.html') + '#t=' + tok; }
    function rnd(n) { var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', b = new Uint32Array(n), s = ''; crypto.getRandomValues(b); for (var i = 0; i < n; i++) s += abc[b[i] % abc.length]; return s; }
    function M(n, cur) { return moneyC(n, cur); }
    function eod(ts) { var d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }
    function arrOf(x) { return arr(x); }
    function payments(p) { return Object.keys(p.payments || {}).map(function (k) { return Object.assign({ key: k }, p.payments[k]); }).sort(function (a, b) { return a.at - b.at; }); }
    function remaining(p) { return Math.max(0, Number(p.total || 0) - Number(p.paid || 0)); }
    function paidLak(p) { return payments(p).reduce(function (s, x) { return s + Number(x.lak || 0); }, 0); }

    /* ---------- วันทำการ ---------- */
    function holidays() {
        var set = {};
        String(A.cfg.holidays || '').split(/[\n,;]+/).forEach(function (line) {
            var t = line.trim(), m;
            if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) set[m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3])] = 1;
            else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) set[m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1])] = 1;
        });
        return set;
    }
    function offDays() { var o = String(A.cfg.offDays == null ? '0' : A.cfg.offDays); return o.split(',').filter(function (x) { return x !== ''; }).map(Number); }
    function addBiz(ts, n) {
        var H = holidays(), off = offDays(), d = new Date(ts), k = 0, guard = 0;
        d.setHours(12, 0, 0, 0);
        while (k < n && guard++ < 400) { d.setDate(d.getDate() + 1); if (off.indexOf(d.getDay()) < 0 && !H[dayKey(d.getTime())]) k++; }
        return d.getTime();
    }
    function bizDaysSince(ts) {
        var H = holidays(), off = offDays(), d = new Date(ts), end = Date.now(), k = 0, guard = 0;
        d.setHours(12, 0, 0, 0);
        while (guard++ < 400) { d.setDate(d.getDate() + 1); if (d.getTime() > end) break; if (off.indexOf(d.getDay()) < 0 && !H[dayKey(d.getTime())]) k++; }
        return k;
    }
    // กำหนดคืนเงิน: ยังไม่สั่ง = 14 วันทำการ · สั่งแล้ว = 14 วันทำการ + 7 วัน
    function deadline(p) { return p.status === 'new' ? eod(p.etaTo) : eod(p.etaTo) + 7 * DAY; }
    function alertOf(p) {
        var now = Date.now();
        if (p.status === 'arrived') {
            if (p.pickupBy && now > eod(p.pickupBy)) return { lv: 'red', t: '🔴 เกินกำหนดมารับ (' + fmtDate(p.pickupBy) + ')' };
            return { lv: '', t: 'มารับภายใน ' + fmtDate(p.pickupBy) };
        }
        if (['new', 'ordered', 'shipping'].indexOf(p.status) < 0) return null;
        if (now > eod(p.etaTo)) {
            if (p.status === 'new') return { lv: 'red', t: '🔴 เกิน 14 วันทำการ ยังไม่ได้สั่ง → ต้องคืนเงินเต็ม' };
            var left = Math.ceil((deadline(p) - now) / DAY);
            if (left > 0) return { lv: 'orange', t: '🟠 เลยกำหนด · รอขนส่งเพิ่มได้อีก ' + left + ' วัน (ถึง ' + fmtDate(deadline(p)) + ')' };
            return { lv: 'red', t: '🔴 เกินกำหนดรอขนส่ง → ต้องคืนเงินเต็ม' };
        }
        if (now >= p.etaFrom - 12 * 3600000) return { lv: 'yellow', t: '🟡 ครบ 7 วันทำการ · ควรเช็คกับร้านต้นทาง' };
        return { lv: '', t: 'ถึงช่วง ' + poEta(p) + ' (วันทำการที่ ' + bizDaysSince(p.createdAt) + '/14)' };
    }

    /* ---------- เริ่มทำงาน ---------- */
    function boot() {
        if (A.started) return;
        A.started = true;
        fxInit();
        injectUI();
        database.ref('preorders').on('value', function (s) { A.list = s.val() || {}; render(); }, function (e) { say('อ่านพรีออเดอร์ไม่ได้: ' + e.message, false); });
        database.ref('settings/preorder').on('value', function (s) { A.cfg = s.val() || {}; render(); });
        database.ref('menu_items').on('value', function (s) { A.items = s.val() || {}; if (A.view === 'create') draw(); });
        database.ref('categories').on('value', function (s) { A.cats = s.val() || {}; });
        database.ref('settings/features/cashierPreorder').on('value', function (s) { A.cafeOn = s.val() === true; render(); });
        setInterval(render, 5 * 60000);
    }
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.REQUIRE_LOGIN && firebase.auth) firebase.auth().onAuthStateChanged(function (u) { if (u) boot(); });
    else document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

    var CSS = '' +
        '.axp-ov{position:fixed;top:0;right:0;bottom:0;left:0;background:#f4f6f8;z-index:2600;display:none;flex-direction:column;height:100vh;height:100dvh;font-family:inherit}' +
        '.axp-head{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-bottom:1px solid #e0e0e0}' +
        '.axp-head h3{flex:1;margin:0;color:#0b4db3;font-size:1.1rem;min-width:0}' +
        '.axp-body{flex:1;min-height:0;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch}.axp-in{max-width:760px;margin:0 auto}' +
        '.axp-foot{flex-shrink:0;display:flex;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e0e0e0;flex-wrap:wrap}' +
        '.axp-b{border:0;border-radius:10px;padding:13px 14px;font-weight:bold;font-size:14.5px;cursor:pointer;font-family:inherit;color:#fff;background:#0b4db3;line-height:1.25}' +
        '.axp-b:disabled{opacity:.45;cursor:not-allowed}.axp-b.g{background:#689f38}.axp-b.o{background:#ea580c}.axp-b.r{background:#ef4444}.axp-b.gr{background:#64748b}.axp-b.w{background:#128c4a}.axp-b.l{background:#e2e8f0;color:#334155}.axp-b.big{flex:1}' +
        '.axp-back{background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;font-weight:bold;color:#0b4db3;cursor:pointer;font-family:inherit}' +
        '.axp-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.axp-tab{border:1px solid #cbd5e1;background:#fff;border-radius:99px;padding:8px 14px;font-weight:bold;cursor:pointer;color:#0b4db3;font-family:inherit}.axp-tab.on{background:#0b4db3;color:#fff;border-color:#0b4db3}' +
        '.axp-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:10px;cursor:pointer}.axp-card.red{border:2px solid #ef4444}.axp-card.orange{border:2px solid #f59e0b}.axp-card.yellow{border:2px solid #eab308}' +
        '.axp-row{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.axp-sm{font-size:12.5px;color:#64748b}.axp-no{font-weight:bold;color:#0b4db3;font-size:15px}' +
        '.axp-pill{display:inline-block;font-size:11.5px;font-weight:bold;border-radius:99px;padding:2px 8px;margin-left:4px;background:#e2e8f0;color:#334155}' +
        '.axp-pill.new{background:#fef3c7;color:#92400e}.axp-pill.ordered,.axp-pill.shipping{background:#dbeafe;color:#1e3a8a}.axp-pill.arrived{background:#dcfce7;color:#166534}.axp-pill.picked{background:#e2e8f0;color:#334155}.axp-pill.refunded,.axp-pill.noshow{background:#fee2e2;color:#991b1b}' +
        '.axp-al{font-size:12.5px;margin-top:6px;font-weight:bold}.axp-al.red{color:#b91c1c}.axp-al.orange{color:#c2410c}.axp-al.yellow{color:#a16207}' +
        '.axp-in label{display:block;font-weight:bold;font-size:13px;color:#555;margin:12px 0 5px}' +
        '.axp-in input,.axp-in select,.axp-in textarea{width:100%;padding:12px 10px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;background:#fff;font-family:inherit;box-sizing:border-box}' +
        '.axp-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.axp-3{display:grid;grid-template-columns:2fr 1fr;gap:10px}' +
        '.axp-seg{display:flex;gap:8px;flex-wrap:wrap}.axp-seg button{flex:1;min-width:110px;padding:13px 8px;border:2px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:bold;font-size:14px;color:#0b4db3;cursor:pointer;font-family:inherit;line-height:1.3}.axp-seg button.on{background:#0b4db3;color:#fff;border-color:#0b4db3}' +
        '.axp-box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:12px}' +
        '.axp-tot{display:flex;justify-content:space-between;align-items:baseline;font-size:1.35rem;font-weight:bold;color:#0b4db3;padding:8px 0 2px}.axp-tot small{font-size:.85rem;color:#64748b}' +
        '.axp-ap{font-size:12px;color:#94a3b8;text-align:right}.axp-hint{font-size:12.5px;color:#64748b;margin-top:6px}.axp-warn{background:#fef2f2;color:#b91c1c;border-radius:8px;padding:8px 10px;font-size:13px;font-weight:bold;margin:8px 0}' +
        '.axp-ok{background:#f0fdf4;color:#166534;border-radius:8px;padding:8px 10px;font-size:13px;margin:8px 0}' +
        '.axp-tl{display:flex;gap:4px;margin:10px 0 4px}.axp-tl div{flex:1;text-align:center;font-size:11px;color:#94a3b8;border-top:4px solid #e2e8f0;padding-top:5px}.axp-tl div.on{color:#0b4db3;border-color:#689f38;font-weight:bold}' +
        '.axp-li{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px dashed #e2e8f0;font-size:14px}.axp-li:last-child{border-bottom:0}' +
        '.axp-tick{font-size:3rem;color:#689f38;text-align:center;line-height:1}' +
        '.axp-chk{display:flex!important;align-items:center;gap:8px;font-weight:normal!important}.axp-chk input{width:auto!important}';

    function injectUI() {
        var st = document.createElement('style'); st.textContent = CSS + '.axp-ov.embed{position:relative;inset:auto;z-index:1;height:100%;display:flex}.axp-ov.embed [data-a="close"]{display:none}';
        document.head.appendChild(st);
        A.ov = document.createElement('div'); A.ov.className = 'axp-ov';
        var embedHost = document.getElementById('axp-host');
        A.ov.innerHTML = '<div class="axp-head"><button class="axp-back" data-a="back">←</button><h3 id="axp-title">📦 พรีออเดอร์</h3><button class="axp-back" data-a="close">✕ ปิด</button></div>' +
            '<div class="axp-body" id="axp-body"><div class="axp-in" id="axp-main"></div></div><div class="axp-foot" id="axp-foot"></div>';
        if (embedHost) { A.embed = true; A.ov.classList.add('embed'); embedHost.appendChild(A.ov); }
        else document.body.appendChild(A.ov);
        A.ov.addEventListener('click', onClick);
        A.ov.addEventListener('input', onInput);
        A.ov.addEventListener('change', onInput);
        if (A.embed) { A.ov.style.display = 'flex'; draw(); return; }
        var host = document.querySelector('.top-controls');
        A.btn = document.createElement('button');
        A.btn.type = 'button';
        A.btn.className = host ? 'top-btn badge-btn' : 'btn btn-blue';
        A.btn.style.background = '#7c3aed';
        A.btn.onclick = function () { open(); };
        if (host) host.insertBefore(A.btn, host.firstChild);
        var slot = document.getElementById('axp-slot');
        if (slot) { A.btn.style.cssText += ';width:100%;color:#fff;border:0;border-radius:6px;padding:10px;font-weight:bold;cursor:pointer'; slot.appendChild(A.btn); }
        render();
    }

    /* ---------- รายการ ---------- */
    function storeOf(p) { return p.store === 'cafe' ? 'cafe' : 'shop'; }
    function inMode(p) { return MODE === 'all' || (MODE === 'cafe' ? storeOf(p) === 'cafe' : storeOf(p) === 'shop'); }
    function all() { return Object.keys(A.list).map(function (k) { return Object.assign({ id: k }, A.list[k]); }).filter(inMode); }
    function flagsOf(itemId) {
        var it = A.items[itemId] || {}, c = null;
        Object.keys(A.cats).forEach(function (k) { if (A.cats[k] && A.cats[k].name === it.category) c = A.cats[k]; });
        return { shop: !!(c && c.shop), authentic: it.authentic === true || !!(c && c.authentic), shoe: !!(c && c.shoe) };
    }
    function active(p) { return ['new', 'ordered', 'shipping', 'arrived'].indexOf(p.status) >= 0; }
    function needs(p) { var a = alertOf(p); return a && (a.lv === 'red' || a.lv === 'orange' || a.lv === 'yellow'); }
    function render() {
        if (A.embed) { if ((A.view === 'list' || A.view === 'detail') && !(document.activeElement && document.activeElement.id === 'axp-q')) { A.keepScroll = true; draw(); } return; }
        if (!A.btn) return;
        A.btn.hidden = MODE === 'cafe' && !A.cafeOn && !all().some(active);
        var L = all(), n = L.filter(active).length, warn = L.filter(needs).length;
        A.btn.innerHTML = '📦 พรีออเดอร์ <span class="cnt' + (warn ? ' warn' : '') + '" style="' + (warn ? 'background:#ef4444;color:#fff' : 'background:#fff;color:#7c3aed') + ';border-radius:10px;padding:0 7px;font-size:12px">' + (warn ? '⚠' + warn : n) + '</span>';
        if (A.ov && A.ov.style.display === 'flex' && (A.view === 'list' || A.view === 'detail') && document.activeElement && document.activeElement.id !== 'axp-q') { A.keepScroll = true; draw(); }
    }
    function open(view, id) {
        A.view = view || 'list'; A.id = id || null;
        A.ov.style.display = 'flex';
        draw();
    }
    function close() { A.ov.style.display = 'none'; A.view = 'list'; A.f = null; A.pay = null; A.done = null; A.refund = null; }
    function setHead(t, back) { document.getElementById('axp-title').textContent = t; A.ov.querySelector('[data-a="back"]').style.display = back ? '' : 'none'; }
    function main(h) { document.getElementById('axp-main').innerHTML = h; }
    function foot(h) { var f = document.getElementById('axp-foot'); f.innerHTML = h || ''; f.style.display = h ? 'flex' : 'none'; }
    function draw() {
        var body = document.getElementById('axp-body'), top = body.scrollTop;
        ({ list: drawList, detail: drawDetail, create: drawCreate, pay: drawPay, done: drawDone, refund: drawRefund })[A.view]();
        if (A.keepScroll) body.scrollTop = top; else body.scrollTop = 0;
        A.keepScroll = false;
    }

    function drawList() {
        setHead('📦 พรีออเดอร์', false);
        var L = all(), q = A.q.trim().toLowerCase();
        var tabs = { active: L.filter(active), warn: L.filter(needs), done: L.filter(function (p) { return !active(p); }) };
        var list = tabs[A.tab] || tabs.active;
        if (q) list = L.filter(function (p) { return [p.no, p.customerName, p.customerPhone, p.name, p.styleCode].join(' ').toLowerCase().indexOf(q) >= 0; });
        list.sort(function (a, b) {
            var r = { red: 0, orange: 1, yellow: 2 }, x = alertOf(a), y = alertOf(b);
            return ((x && r[x.lv] != null ? r[x.lv] : 9) - (y && r[y.lv] != null ? r[y.lv] : 9)) || (b.createdAt - a.createdAt);
        });
        if (A.tab === 'done' && !q) list = list.slice(0, 100);
        var h = '<div class="axp-tabs">' +
            '<button class="axp-tab' + (A.tab === 'active' ? ' on' : '') + '" data-tab="active">กำลังดำเนินการ (' + tabs.active.length + ')</button>' +
            '<button class="axp-tab' + (A.tab === 'warn' ? ' on' : '') + '" data-tab="warn">⚠️ ต้องดู (' + tabs.warn.length + ')</button>' +
            '<button class="axp-tab' + (A.tab === 'done' ? ' on' : '') + '" data-tab="done">จบแล้ว</button></div>' +
            '<input id="axp-q" placeholder="🔎 ค้นหา: ชื่อ / เบอร์ / เลข PO / รุ่น" value="' + E(A.q) + '" style="margin-bottom:10px">';
        if (!list.length) h += '<div class="axp-sm" style="text-align:center;padding:40px 0">' + (q ? 'ไม่พบ' : A.tab === 'warn' ? 'ไม่มีรายการที่ต้องดู 🎉' : 'ยังไม่มีพรีออเดอร์') + '</div>';
        list.forEach(function (p) {
            var a = alertOf(p), rem = remaining(p);
            h += '<div class="axp-card ' + (a ? a.lv : '') + '" data-open="' + E(p.id) + '">' +
                '<div class="axp-row"><span><span class="axp-no">' + E(p.no) + '</span><span class="axp-pill ' + E(p.status) + '">' + ST[p.status].icon + ' ' + ST[p.status].th + '</span></span><span class="axp-sm">' + fmtDate(p.createdAt) + '</span></div>' +
                '<div style="margin-top:4px"><b>' + E(p.customerName) + '</b> <span class="axp-sm">📞 ' + E(p.customerPhone) + '</span></div>' +
                '<div class="axp-sm" style="color:#334155">' + E(p.name) + (poItemSub(p) ? ' · ' + E(poItemSub(p)) : '') + '</div>' +
                '<div class="axp-row" style="margin-top:4px"><span class="axp-sm">จ่ายแล้ว ' + M(p.paid, p.cur) + ' / ' + M(p.total, p.cur) + '</span><b style="color:' + (rem > 0 ? '#b91c1c' : '#166534') + '">' + (rem > 0 ? 'ค้าง ' + M(rem, p.cur) : 'ครบ ✓') + '</b></div>' +
                (a && a.t ? '<div class="axp-al ' + a.lv + '">' + E(a.t) + '</div>' : '') + '</div>';
        });
        main(h);
        foot('<button class="axp-b g big" data-a="new">＋ สร้างพรีออเดอร์</button>');
    }

    /* ---------- รายละเอียด ---------- */
    function cur() { return A.list[A.id] ? Object.assign({ id: A.id }, A.list[A.id]) : null; }
    function drawDetail() {
        var p = cur();
        if (!p) { A.view = 'list'; return drawList(); }
        setHead(p.no + ' · ' + (p.customerName || ''), true);
        var a = alertOf(p), rem = remaining(p), owner = isOwner(), fi = FLOW.indexOf(p.status);
        var h = '<div class="axp-box"><div class="axp-row"><span class="axp-no" style="font-size:1.1rem">' + E(p.name) + '</span><span class="axp-pill ' + E(p.status) + '">' + ST[p.status].icon + ' ' + ST[p.status].th + '</span></div>' +
            '<div class="axp-sm" style="color:#334155">' + E(poItemSub(p) || '-') + (p.authentic ? ' · <b>รับประกันของแท้</b>' : '') + '</div>' +
            (p.note ? '<div class="axp-sm">📝 ' + E(p.note) + '</div>' : '') +
            '<div style="margin-top:6px"><b>' + E(p.customerName) + '</b> · <a href="https://wa.me/' + E(waNumber(p.customerPhone)) + '" target="_blank" rel="noopener">💬 ' + E(p.customerPhone) + '</a></div>';
        if (fi >= 0) h += '<div class="axp-tl">' + FLOW.map(function (s, i) { return '<div class="' + (i <= fi ? 'on' : '') + '">' + ST[s].th + '</div>'; }).join('') + '</div>';
        if (a && a.t) h += '<div class="axp-al ' + a.lv + '">' + E(a.t) + '</div>';
        h += '<div class="axp-li"><span>สั่งเมื่อ</span><span>' + fmtDateTime(p.createdAt) + '</span></div>' +
            '<div class="axp-li"><span>คาดว่าถึง (7–14 วันทำการ)</span><span>' + E(poEta(p)) + '</span></div>' +
            (p.orderedAt ? '<div class="axp-li"><span>สั่งของ</span><span>' + fmtDateTime(p.orderedAt) + '</span></div>' : '') +
            (p.shippedAt ? '<div class="axp-li"><span>ขนส่ง</span><span>' + fmtDateTime(p.shippedAt) + '</span></div>' : '') +
            (p.arrivedAt ? '<div class="axp-li"><span>ของถึงร้าน</span><span>' + fmtDateTime(p.arrivedAt) + ' · มารับภายใน ' + fmtDate(p.pickupBy) + '</span></div>' : '') +
            (p.pickedAt ? '<div class="axp-li"><span>ลูกค้ารับ</span><span>' + fmtDateTime(p.pickedAt) + (p.authentic ? ' · เคลมได้ถึง ' + fmtDate(p.claimUntil) : '') + '</span></div>' : '') +
            '</div>';
        h += '<div class="axp-box"><div class="axp-row"><b>การชำระเงิน</b><span>' + M(p.total, p.cur) + '</span></div>';
        payments(p).forEach(function (x) {
            h += '<div class="axp-li"><span>' + ({ deposit: 'มัดจำ', full: 'จ่ายเต็ม', final: 'ส่วนที่เหลือ' }[x.kind] || x.kind) + ' · ' + fmtDate(x.at) + ' · ' + (x.method === 'cash' ? 'เงินสด' : 'โอน') +
                (p.cur === 'THB' && x.payCur === 'LAK' ? ' <span class="axp-sm">(จ่ายเป็นกีบ ' + money(x.payAmount) + ' · เรท ' + x.rate + ')</span>' : '') + '</span>' +
                '<span>' + M(x.amt, p.cur) + (x.billId ? ' <button class="axp-back" data-print="' + E(x.billId) + '" style="padding:4px 8px">🖨️</button>' : '') + '</span></div>';
        });
        h += '<div class="axp-tot"><small>' + (rem > 0 ? 'คงเหลือ' : 'ชำระครบ') + '</small><span style="color:' + (rem > 0 ? '#b91c1c' : '#166534') + '">' + (rem > 0 ? M(rem, p.cur) : '✓') + '</span></div>' +
            (rem > 0 && p.cur === 'THB' && FX.rate ? '<div class="axp-ap">' + approxLak(rem) + '</div>' : '') + '</div>';
        if (p.refund) h += '<div class="axp-warn">↩ คืนเงินแล้ว ' + M(p.refund.amt, p.cur) + ' · ' + E(p.refund.reason) + ' · ' + fmtDateTime(p.refund.at) + (p.refund.returned ? ' · ได้ของคืนแล้ว' : '') + '</div>';
        if (p.status === 'noshow') h += '<div class="axp-warn">⏰ ลูกค้าไม่มารับ · ร้านเก็บมัดจำ · ของพร้อมขายต่อ</div>';
        // ปุ่มรอง
        h += '<div class="axp-seg" style="margin-top:4px">' +
            '<button data-a="wa-receipt">💬 ส่งใบล่าสุด WhatsApp</button>' +
            (p.status === 'arrived' ? '<button data-a="wa-arrived">💬 แจ้ง "ของถึงแล้ว"</button>' : '') +
            (p.trackTok ? '<button data-a="copy-track">🔗 ลิงก์ติดตาม</button>' : '') +
            (p.status === 'picked' ? '<button data-a="print-pickup">🖨️ ใบรับของ</button>' : '') +
            (fi > 0 && fi < 4 ? '<button data-a="undo">↩ ย้อนสถานะ</button>' : '') + '</div>';
        // ปุ่มเจ้าของร้าน
        if (owner) {
            var ownerBtns = '';
            if (active(p) || (p.status === 'picked' && p.authentic && Date.now() <= eod(p.claimUntil))) ownerBtns += '<button data-a="refund" style="border-color:#ef4444;color:#b91c1c">↩ คืนเงินเต็ม</button>';
            if (p.status === 'arrived') ownerBtns += '<button data-a="noshow" style="border-color:#ef4444;color:#b91c1c">⏰ ลูกค้าไม่มารับ</button>';
            if (ownerBtns) h += '<label>เฉพาะเจ้าของร้าน</label><div class="axp-seg">' + ownerBtns + '</div>';
        } else if (active(p)) h += '<div class="axp-hint">คืนเงิน / ลูกค้าไม่มารับ ทำได้เฉพาะบัญชีเจ้าของร้าน</div>';
        main(h);
        // ปุ่มหลัก
        var f = '';
        if (p.status === 'new') f = '<button class="axp-b big" data-step="ordered">🛒 สั่งของจากร้านแล้ว</button>';
        else if (p.status === 'ordered') f = '<button class="axp-b gr" data-step="arrived">📦 ของถึงร้าน</button><button class="axp-b big" data-step="shipping">🚚 กำลังขนส่ง</button>';
        else if (p.status === 'shipping') f = '<button class="axp-b g big" data-step="arrived">📦 ของถึงร้านแล้ว</button>';
        else if (p.status === 'arrived') f = rem > 0 ? '<button class="axp-b g big" data-a="pay-rest">💰 รับเงินส่วนที่เหลือ ' + M(rem, p.cur) + '</button>' : '<button class="axp-b g big" data-a="picked">✅ ลูกค้ารับของแล้ว</button>';
        if (rem > 0 && ['new', 'ordered', 'shipping'].indexOf(p.status) >= 0) f = '<button class="axp-b l" data-a="pay-rest">💰 รับเงินเพิ่ม</button>' + f;
        foot(f);
    }

    /* ---------- สร้างพรีออเดอร์ ---------- */
    function poItems() {
        return Object.keys(A.items).map(function (k) { return Object.assign({ id: k }, A.items[k]); }).filter(function (it) {
            if (it.preorder !== true) return false;
            var sh = flagsOf(it.id).shop;
            return MODE === 'all' || (MODE === 'shop' ? sh : !sh);
        })
            .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    }
    function newForm(pre) {
        pre = pre || {};
        A.f = { itemId: '', name: '', variant: '', styleCode: '', qty: 1, unit: '', cur: 'LAK', authentic: false, customerName: pre.name || '', customerPhone: pre.phone || '', note: pre.note || '', plan: 'custom', custom: '', trackTok: pre.trackTok || '', onlineId: pre.onlineId || '', onlineLine: pre.onlineLine, onlineOnly: !!pre.onlineOnly, err: '' };
        if (pre.itemId) pickItem(pre.itemId, pre.variant);
        else if (pre.itemName) A.f.name = pre.itemName;
        if (pre.qty) A.f.qty = pre.qty;
        A.pay = newPay(A.f.cur);
    }
    function newPay(c) { return { cur: c, payCur: c === 'THB' ? 'THB' : 'LAK', rate: String(FX.rate || ''), method: 'transfer', received: '' }; }
    // ราคาพรีของไซส์นี้ (ตั้งในหน้าเพิ่มรองเท้า) · ไม่ตั้ง = ราคาปกติ
    function poUnit(it, v) {
        if (!it || !v) return v ? v.price : 0;
        var k = String(v.label == null || v.label === '' ? 'one' : v.label).replace(/[.#$\/\[\]]/g, '_'), p = (it.poPrice || {})[k];
        if (p != null && p !== '' && isFinite(Number(p))) return Number(p);
        if (it.prePrice != null && it.prePrice !== '' && isFinite(Number(it.prePrice))) return Number(it.prePrice);
        return v.price;
    }
    function pickItem(id, variant) {
        var it = A.items[id]; if (!it) return;
        var f = A.f, prices = parsePrices(it.priceOptions);
        f.itemId = id; f.name = it.name || ''; f.cur = it.currency === 'THB' ? 'THB' : 'LAK'; f.authentic = flagsOf(id).authentic;
        var v = prices.find(function (x) { return x.label === variant; }) || (prices.length === 1 ? prices[0] : null);
        f.variant = v ? v.label : (variant || ''); f.unit = v ? String(poUnit(it, v)) : (prices[0] ? String(poUnit(it, prices[0])) : '');
        if (A.pay) { A.pay.cur = f.cur; A.pay.payCur = f.cur === 'THB' ? 'THB' : 'LAK'; }
    }
    function fTotal() { var f = A.f; return Math.max(0, Math.round((parseFloat(f.unit) || 0) * Math.max(1, parseInt(f.qty, 10) || 1))); }
    function roundAmt(n, c) { return c === 'THB' ? Math.round(n) : Math.ceil(n / 1000) * 1000; }
    function fAmount() {
        var f = A.f, t = fTotal();
        if (f.plan === 'full') return t;
        return Math.min(t, Math.max(0, Math.round(parseFloat(f.custom) || 0)));
    }
    function drawCreate() {
        var f = A.f, its = poItems(), t = fTotal(), amt = fAmount(), c = f.cur;
        setHead('＋ สร้างพรีออเดอร์', true);
        var sel = its.find(function (x) { return x.id === f.itemId; }), variants = sel ? parsePrices(sel.priceOptions) : [];
        var h = '<div class="axp-box"><label style="margin-top:0">สินค้า</label><select id="axp-item"><option value="">— พิมพ์ชื่อสินค้าเอง —</option>' +
            its.map(function (it) { return '<option value="' + E(it.id) + '"' + (it.id === f.itemId ? ' selected' : '') + '>' + E(it.name) + (it.currency === 'THB' ? ' (฿)' : '') + '</option>'; }).join('') + '</select>' +
            (its.length ? '' : '<div class="axp-hint">ยังไม่มีสินค้าที่ติ๊ก "สินค้าสั่งจอง" ใน Admin · พิมพ์ชื่อเองได้</div>') +
            '<label>ชื่อรุ่น (พิมพ์บนใบ)</label><input data-f="name" value="' + E(f.name) + '" placeholder="เช่น AIR JORDAN 1 LOW">';
        if (variants.length > 1) h += '<label>ไซส์ / แบบ</label><div class="axp-seg">' + variants.map(function (v) { return '<button data-var="' + E(v.label) + '" class="' + (v.label === f.variant ? 'on' : '') + '">' + E(v.label || '-') + '<br><small>' + M(poUnit(sel, v), c) + '</small></button>'; }).join('') + '</div>';
        h += '<div class="axp-2"><div><label>ไซส์ / แบบ</label><input data-f="variant" value="' + E(f.variant) + '" placeholder="เช่น 42"></div><div><label>รหัสรุ่น (Style code)</label><input data-f="styleCode" value="' + E(f.styleCode) + '" placeholder="เช่น 553558-140"></div></div>' +
            '<div class="axp-3"><div><label>ราคาต่อชิ้น (' + (c === 'THB' ? '฿ บาท' : '₭ กีบ') + ')</label><input data-f="unit" type="number" inputmode="numeric" min="0" value="' + E(f.unit) + '"></div><div><label>จำนวน</label><input data-f="qty" type="number" inputmode="numeric" min="1" value="' + E(f.qty) + '"></div></div>';
        if (FX.on || c === 'THB') h += '<label>สกุลเงินของราคา</label><div class="axp-seg"><button data-cur="LAK" class="' + (c === 'LAK' ? 'on' : '') + '">₭ กีบ</button><button data-cur="THB" class="' + (c === 'THB' ? 'on' : '') + '">฿ บาท</button></div>';
        h += '<label class="axp-chk"><input type="checkbox" data-f="authentic"' + (f.authentic ? ' checked' : '') + '> รับประกันของแท้ (พิมพ์ข้อ "ເກີບຂອງແທ້ 100%" + เคลมได้ 30 วัน)</label>' +
            '<label>หมายเหตุ (ไม่บังคับ)</label><input data-f="note" value="' + E(f.note) + '" placeholder="เช่น สีขาว-ดำ"></div>';
        h += '<div class="axp-box"><b>ลูกค้า</b> <span class="axp-sm">(จำเป็น)</span><div class="axp-2"><div><label>ชื่อ</label><input data-f="customerName" value="' + E(f.customerName) + '"></div>' +
            '<div><label>WhatsApp</label><input data-f="customerPhone" type="tel" inputmode="tel" value="' + E(f.customerPhone) + '" placeholder="020 xxxx xxxx · ไทย 08x xxx xxxx"></div></div></div>';
        h += '<div class="axp-box"><div class="axp-tot"><small>ราคาเต็ม</small><span id="axp-t">' + M(t, c) + '</span></div><div class="axp-ap" id="axp-tap">' + (c === 'THB' && t ? approxLak(t, parseFloat(A.pay.rate) || FX.rate) : '') + '</div>' +
            '<label>ลูกค้าจ่าย</label><div class="axp-seg"><button data-plan="full" class="' + (f.plan === 'full' ? 'on' : '') + '">จ่ายเต็ม<br><small id="axp-pf">' + M(t, c) + '</small></button>' +
            '<button data-plan="custom" class="' + (f.plan === 'custom' ? 'on' : '') + '">มัดจำ<br><small>พิมพ์ยอดเอง</small></button></div>' +
            (f.plan === 'custom' ? '<input data-f="custom" type="number" inputmode="numeric" min="0" value="' + E(f.custom) + '" placeholder="ยอดมัดจำ (' + (c === 'THB' ? '฿' : '₭') + ') เช่น ' + (c === 'THB' ? '2000' : '500000') + '" style="margin-top:8px">' : '') +
            '<div class="axp-hint" id="axp-rem">' + (amt < t && amt > 0 ? 'คงเหลือจ่ายตอนรับของ <b>' + M(t - amt, c) + '</b>' : '') + '</div></div>';
        h += payBoxHtml(amt);
        h += '<div class="axp-hint">ระบบนับวันให้: ถึงประมาณ <b>' + poEta({ etaFrom: addBiz(Date.now(), 7), etaTo: addBiz(Date.now(), 14) }) + '</b> (7–14 วันทำการ · หยุดอาทิตย์และวันหยุดที่ตั้งไว้)</div>' +
            '<div class="axp-warn" style="background:#fffbeb;color:#92400e">แจ้งลูกค้าก่อนรับเงิน: ' + E(amt < t ? PO_TXT.noCancelDep : PO_TXT.noCancelFull) + '</div>';
        if (f.err) h += '<div class="axp-warn" id="axp-err">' + E(f.err) + '</div>';
        main(h);
        var due = payDue(amt);
        foot('<button class="axp-b g big" data-a="create-save"' + (due.ok ? '' : ' disabled') + '>✓ รับเงิน ' + (due.ok ? M(due.due, due.payCur) : '') + ' · สร้าง' + (amt < t ? 'ใบมัดจำ' : 'ใบรับเงิน') + '</button>');
    }

    /* ---------- กล่องรับเงิน (ใช้ทั้งตอนสร้าง และรับเงินส่วนที่เหลือ) ---------- */
    function payDue(amt) {
        var P = A.pay, rate = parseFloat(P.rate) || 0, thb = P.cur === 'THB';
        var payCur = thb ? P.payCur : 'LAK', due = thb && payCur === 'LAK' ? toLak(amt, rate) : amt;
        var rec = P.received === '' ? due : (parseFloat(P.received) || 0);
        var ok = amt > 0 && (!thb || rate > 0) && (P.method !== 'cash' || rec >= due);
        return { due: due, payCur: payCur, rate: rate, rec: rec, change: Math.max(0, rec - due), ok: ok, lak: thb ? (payCur === 'LAK' ? due : toLak(amt, rate)) : amt };
    }
    function payBoxHtml(amt) {
        var P = A.pay, d = payDue(amt), thb = P.cur === 'THB';
        var h = '<div class="axp-box"><b>รับเงินครั้งนี้</b> <span id="axp-amt" style="float:right;font-weight:bold;color:#0b4db3">' + M(amt, P.cur) + '</span>';
        if (thb) {
            h += '<label>เรทวันนี้ (กีบ ต่อ 1 บาท) · จำเป็น</label><input data-p="rate" type="number" inputmode="numeric" min="0" value="' + E(P.rate) + '" placeholder="เช่น 650">' +
                '<div class="axp-hint">' + (FX.rate ? 'เรทที่ตั้งใน Admin: ' + FX.rate + (fxStale() ? ' · <b style="color:#b91c1c">เก่ากว่า 1 วัน</b>' : '') : 'ยังไม่ได้ตั้งเรทใน Admin') + '</div>' +
                '<label>ลูกค้าจ่ายเป็น</label><div class="axp-seg"><button data-pc="THB" id="axp-pct" class="' + (P.payCur === 'THB' ? 'on' : '') + '">จ่ายเป็น ' + baht(amt) + '</button>' +
                '<button data-pc="LAK" id="axp-pcl" class="' + (P.payCur === 'LAK' ? 'on' : '') + '">' + (d.rate ? 'จ่ายเป็น ' + money(toLak(amt, d.rate)) : 'จ่ายเป็นกีบ (ใส่เรทก่อน)') + '</button></div>';
        }
        h += '<label>วิธีชำระ</label><div class="axp-seg"><button data-m="transfer" class="' + (P.method === 'transfer' ? 'on' : '') + '">📱 โอน</button><button data-m="cash" class="' + (P.method === 'cash' ? 'on' : '') + '">💵 เงินสด</button></div>';
        if (P.method === 'cash') {
            h += '<label>รับเงินมา (' + (d.payCur === 'THB' ? '฿' : '₭') + ' · เว้นว่าง = พอดี)</label><input data-p="received" type="number" inputmode="numeric" min="0" value="' + E(P.received) + '" placeholder="พอดี">' +
                '<div class="axp-tot"><small>เงินทอน</small><span id="axp-chg" style="color:#689f38">' + M(d.change, d.payCur) + '</span></div>' +
                '<div class="axp-warn" id="axp-short"' + (d.rec < d.due ? '' : ' hidden') + '>รับเงินมาน้อยกว่ายอด</div>';
        }
        return h + '</div>';
    }

    async function nextPoNo() {
        var n = new Date(), dc = pad2(n.getDate()) + pad2(n.getMonth() + 1) + String(n.getFullYear()).slice(-2);
        var r = await database.ref('counters/po/' + dc).transaction(function (x) { return (x || 0) + 1; });
        var seq = r.snapshot.val() || 1;
        return 'PO' + dc + '-' + (seq < 1000 ? ('00' + seq).slice(-3) : seq);
    }
    // เขียนบิลชำระแล้ว 1 ใบต่อการรับเงิน 1 ครั้ง (ไม่เข้าครัว ไม่ใช้แก้ว)
    async function writePayBill(p, kind, amt, d, extraPo) {
        var now = Date.now(), dk = dayKey(now), orderNo = await nextOrderNo(dk), P = A.pay, thb = p.cur === 'THB';
        var label = { deposit: 'มัดจำ', full: 'จ่ายเต็ม', final: 'ส่วนที่เหลือ' }[kind];
        var bill = {
            orderNo: orderNo, customerName: p.customerName, customerPhone: p.customerPhone, customerEmail: '', customerId: '',
            table: '', appOrderNo: p.no,
            items: [{ lid: newLid(), itemId: p.itemId || '', name: '📦 ' + p.name, variant: [label, p.variant].filter(Boolean).join(' | '), price: amt, quantity: 1, modifiers: [], note: '', cup: false, round: 1, retail: true }],
            subtotal: d.lak, discount: 0, total: d.lak,
            status: 'paid', paid: true, paymentMethod: P.method,
            cashReceived: P.method === 'cash' ? d.rec : 0, change: P.method === 'cash' ? d.change : 0,
            source: 'preorder', orderType: 'Pre-order', rounds: 1, cups: 0,
            date: fmtDate(now), dayKey: dk, openedAt: now, paidAt: now, timestamp: now,
            preorderId: p.id, customer: p.customerName || 'ทั่วไป'
        };
        if (storeOf(p) === 'shop') bill.store = 'shop';
        if (thb) Object.assign(bill, { currency: 'THB', rate: d.rate, subtotalThb: amt, totalThb: amt, discountThb: 0, payCurrency: d.payCur, payAmount: d.due });
        var paidBefore = Number(p.paid || 0), dep = payments(p).filter(function (x) { return x.kind === 'deposit'; })[0];
        bill.po = Object.assign({
            id: p.id, no: p.no, kind: kind, name: p.name, variant: p.variant || '', styleCode: p.styleCode || '', qty: p.qty || 1, cur: p.cur,
            total: p.total, paidBefore: paidBefore, paidNow: amt, remaining: Math.max(0, p.total - paidBefore - amt),
            etaFrom: p.etaFrom, etaTo: p.etaTo, authentic: !!p.authentic, track: p.trackTok ? trackLink(p.trackTok) : '',
            pct: kind === 'deposit' && p.total ? Math.round(amt / p.total * 100) : 0, depositAt: dep ? dep.at : 0
        }, extraPo || {});
        var ref = database.ref('orders').push();
        await ref.set(bill);
        var pay = { kind: kind, amt: amt, method: P.method, at: now, billId: ref.key, lak: d.lak, by: (firebase.auth().currentUser || {}).email || '' };
        if (thb) Object.assign(pay, { payCur: d.payCur, payAmount: d.due, rate: d.rate });
        return { billId: ref.key, bill: bill, pay: pay };
    }

    async function saveCreate() {
        var f = A.f, t = fTotal(), amt = fAmount(), d = payDue(amt);
        f.err = '';
        var phoneOk = waNumber(f.customerPhone).length >= 10;
        if (!f.name.trim()) f.err = 'ใส่ชื่อสินค้า';
        else if (!(t > 0)) f.err = 'ใส่ราคา';
        else if (!f.customerName.trim()) f.err = 'ใส่ชื่อลูกค้า';
        else if (!phoneOk) f.err = 'ใส่เบอร์ WhatsApp ลูกค้าให้ถูก';
        else if (!(amt > 0)) f.err = 'ใส่ยอดมัดจำ';
        else if (f.plan === 'custom' && (parseFloat(f.custom) || 0) > t) f.err = 'ยอดมัดจำเกินราคาเต็ม';
        else if (f.cur === 'THB' && !(d.rate > 0)) f.err = 'สินค้าราคาบาท ต้องใส่เรทวันนี้ (ใช้คิดยอดขายเป็นกีบ)';
        else if (!d.ok) f.err = 'รับเงินมาน้อยกว่ายอด';
        if (f.err) { A.keepScroll = true; draw(); var el = document.getElementById('axp-err'); if (el) el.scrollIntoView({ block: 'center' }); return; }
        if (A.busy) return;
        A.busy = true;
        var btn = A.ov.querySelector('[data-a="create-save"]'); if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
        try {
            var now = Date.now(), ref = database.ref('preorders').push();
            var p = {
                id: ref.key, no: await nextPoNo(), createdAt: now, by: (firebase.auth().currentUser || {}).email || '',
                customerName: f.customerName.trim(), customerPhone: f.customerPhone.trim(),
                itemId: f.itemId || '', name: f.name.trim(), variant: f.variant.trim(), styleCode: f.styleCode.trim(), qty: Math.max(1, parseInt(f.qty, 10) || 1),
                unit: parseFloat(f.unit) || 0, total: t, cur: f.cur, authentic: !!f.authentic, note: f.note.trim(),
                status: 'new', etaFrom: addBiz(now, 7), etaTo: addBiz(now, 14), paid: 0, trackTok: f.trackTok || rnd(20)
            };
            if (f.onlineId) p.onlineId = f.onlineId;
            p.store = f.itemId ? (flagsOf(f.itemId).shop ? 'shop' : 'cafe') : (MODE === 'cafe' ? 'cafe' : 'shop');
            var kind = amt >= t ? 'full' : 'deposit';
            var r = await writePayBill(p, kind, amt, d);
            p.paid = amt; p.payments = {}; p.payments[database.ref('preorders').push().key] = r.pay;
            delete p.id;
            await ref.set(p);
            p.id = ref.key;
            A.list[ref.key] = p;
            pushTrack(p);
            if (f.onlineId && f.onlineOnly) database.ref('online_orders/' + f.onlineId).update({ status: 'accepted', poId: ref.key, poNo: p.no, handledAt: Date.now() }).catch(function () {});
            else if (f.onlineId && f.onlineLine != null) database.ref('online_orders/' + f.onlineId + '/poMade/' + f.onlineLine).set(p.no).catch(function () {});
            saveCustomer(p);
            A.done = { id: ref.key, billId: r.billId, bill: r.bill, title: kind === 'deposit' ? 'รับมัดจำแล้ว' : 'รับเงินเต็มแล้ว' };
            A.view = 'done'; A.f = null;
            draw();
        } catch (e) { say('ไม่สำเร็จ: ' + (e && e.message || e), false); if (btn) { btn.disabled = false; btn.textContent = 'ลองใหม่'; } }
        finally { A.busy = false; }
    }
    function saveCustomer(p) {
        if (typeof globalCustomers === 'undefined') return;
        var n = waNumber(p.customerPhone);
        if (!globalCustomers.some(function (c) { return waNumber(c.phone) === n; })) database.ref('customers').push({ name: p.customerName, phone: p.customerPhone, email: '', source: 'preorder' });
    }

    /* ---------- รับเงินส่วนที่เหลือ ---------- */
    function startPay() {
        var p = cur(); if (!p) return;
        A.pay = newPay(p.cur);
        A.pay.method = 'cash';
        A.payPick = p.status === 'arrived';
        A.view = 'pay'; draw();
    }
    function drawPay() {
        var p = cur(); if (!p) { A.view = 'list'; return draw(); }
        var rem = remaining(p), d = payDue(rem);
        setHead('💰 รับเงิน · ' + p.no, true);
        var h = '<div class="axp-box"><b>' + E(p.name) + '</b><div class="axp-sm">' + E(poItemSub(p)) + ' · ' + E(p.customerName) + '</div>' +
            '<div class="axp-li"><span>ราคาเต็ม</span><span>' + M(p.total, p.cur) + '</span></div><div class="axp-li"><span>จ่ายแล้ว</span><span>−' + M(p.paid, p.cur) + '</span></div>' +
            '<div class="axp-tot"><small>คงเหลือ</small><span>' + M(rem, p.cur) + '</span></div></div>';
        h += payBoxHtml(rem);
        if (p.status === 'arrived') h += '<label class="axp-chk"><input type="checkbox" id="axp-pick"' + (A.payPick ? ' checked' : '') + '> ลูกค้ารับของไปพร้อมกัน (ปิดพรีออเดอร์' + (p.authentic ? ' · เริ่มนับรับประกัน 30 วัน' : '') + ')</label>';
        main(h);
        foot('<button class="axp-b g big" data-a="pay-save"' + (d.ok ? '' : ' disabled') + '>✓ รับเงิน ' + (d.ok ? M(d.due, d.payCur) : '') + '</button>');
    }
    // BUG-7: 2 เครื่องรับเงินพรีออเดอร์เดียวกัน (หรือหน้าจอที่ข้อมูลเก่า) → บิลรายรับซ้ำ
    // ก่อนสร้างบิล: จองสิทธิ์รับเงิน (payClaim, หมดอายุเอง 2 นาที) แล้วตรวจยอด "จ่ายแล้ว" จากเซิร์ฟเวอร์ว่ายังตรงกับหน้าจอ
    var PAY_CLAIM_MS = 120000;
    async function claimPay(p) {
        var ref = database.ref('preorders/' + p.id), me = newLid(), busy = false;
        var lock = await ref.child('payClaim').transaction(function (c) {
            busy = !!(c && c.id !== me && c.at > Date.now() - PAY_CLAIM_MS);
            if (busy) return;
            return { id: me, at: Date.now(), by: (firebase.auth().currentUser || {}).email || '' };
        });
        if (busy || !lock.committed) throw new Error('อีกเครื่องกำลังรับเงินพรีออเดอร์นี้อยู่ · รอสักครู่แล้วลองใหม่');
        var paidNow = await ref.child('paid').transaction(function (x) { return x; }); // อ่านค่าล่าสุดจากเซิร์ฟเวอร์
        if (Number(paidNow.snapshot.val() || 0) !== Number(p.paid || 0)) {
            await ref.child('payClaim').remove();
            throw new Error('ยอดที่จ่ายแล้วเปลี่ยนจากเครื่องอื่น · ปิดแล้วเปิดพรีออเดอร์นี้ใหม่');
        }
        return ref.child('payClaim');
    }
    async function savePay() {
        var p = cur(); if (!p || A.busy) return;
        var rem = remaining(p), d = payDue(rem);
        if (!d.ok) return say('ตรวจยอด / เรท อีกครั้ง', false);
        A.busy = true;
        var claim = null;
        try {
            claim = await claimPay(p);
            var now = Date.now(), pick = p.status === 'arrived' && A.payPick, upd = {};
            var extra = pick ? { pickedAt: now, claimUntil: now + 30 * DAY } : {};
            var r = await writePayBill(p, 'final', rem, d, extra), pk = database.ref('preorders').push().key;
            claim = null; // มีบิลแล้ว: ถ้าบันทึกขั้นต่อไปพลาด ให้ล็อกหมดอายุเอง (กันกดซ้ำแล้วได้บิลที่ 2 ทันที)
            upd['payments/' + pk] = r.pay;
            upd.paid = Number(p.paid || 0) + rem;
            upd.payClaim = null;
            if (pick) { upd.status = 'picked'; upd.pickedAt = now; upd.claimUntil = now + 30 * DAY; }
            await database.ref('preorders/' + p.id).update(upd);
            var np = Object.assign({}, p); Object.keys(upd).forEach(function (k) { if (k.indexOf('payments/') !== 0) np[k] = upd[k]; });
            np.payments = Object.assign({}, p.payments); np.payments[pk] = r.pay;
            A.list[p.id] = np; pushTrack(np);
            A.done = { id: p.id, billId: r.billId, bill: r.bill, title: pick ? 'ชำระครบ · ลูกค้ารับของแล้ว' : 'รับเงินแล้ว' };
            A.view = 'done'; draw();
        } catch (e) {
            if (claim) claim.remove().catch(function (er) { console.warn('ปลดล็อกรับเงินไม่สำเร็จ (หมดอายุเองใน 2 นาที)', er); });
            say('ไม่สำเร็จ: ' + (e && e.message || e), false);
        }
        finally { A.busy = false; }
    }

    function drawDone() {
        var D = A.done, p = A.list[D.id] || {};
        setHead('✓ เรียบร้อย', false);
        main('<div class="axp-box" style="text-align:center"><div class="axp-tick">✓</div><div style="font-weight:bold;color:#689f38;font-size:1.1rem">' + E(D.title) + '</div>' +
            '<div class="axp-no" style="font-size:1.4rem;margin-top:6px">' + E(p.no || '') + '</div><div class="axp-sm">บิล #' + E(D.bill.orderNo) + ' · ' + E(p.customerName || '') + '</div>' +
            '<div style="font-size:1.6rem;font-weight:bold;color:#0b4db3;margin-top:8px">' + (D.bill.currency === 'THB' ? M(D.bill.payAmount, D.bill.payCurrency) : money(D.bill.total)) + '</div>' +
            (D.bill.paymentMethod === 'cash' && D.bill.change ? '<div style="color:#689f38;font-weight:bold">เงินทอน ' + M(D.bill.change, D.bill.currency === 'THB' ? D.bill.payCurrency : 'LAK') + '</div>' : '') + '</div>' +
            '<div class="axp-hint" style="text-align:center">ส่งให้ลูกค้าทาง WhatsApp เป็นข้อความได้เลย (มีเงื่อนไข + ลิงก์ติดตาม) หรือพิมพ์ใบ 58mm</div>');
        foot('<button class="axp-b" data-a="done-print">🖨️ พิมพ์ใบ</button><button class="axp-b gr" data-a="done-share">📤 PDF</button><button class="axp-b w big" data-a="done-wa">💬 ส่ง WhatsApp</button><button class="axp-b g" data-a="done-ok">เสร็จ</button>');
    }

    /* ---------- คืนเงิน (เจ้าของร้าน) ---------- */
    function drawRefund() {
        var p = cur(); if (!p) { A.view = 'list'; return draw(); }
        var R = A.refund, rs = REFUND_REASONS[R.i];
        setHead('↩ คืนเงิน · ' + p.no, true);
        var h = '<div class="axp-box"><b>' + E(p.name) + '</b> · ' + E(p.customerName) +
            '<div class="axp-tot"><small>คืนเต็มจำนวนที่จ่ายมา</small><span style="color:#b91c1c">' + M(p.paid, p.cur) + '</span></div>' +
            '<div class="axp-sm" style="text-align:right">นับในรายงานเป็น −' + money(paidLak(p)) + '</div></div>' +
            '<div class="axp-box"><label style="margin-top:0">เหตุผล</label><div class="axp-seg">' + REFUND_REASONS.map(function (x, i) { return '<button data-ri="' + i + '" class="' + (R.i === i ? 'on' : '') + '">' + E(x.th) + '</button>'; }).join('') + '</div>' +
            (rs && rs.th === 'อื่นๆ' ? '<input id="axp-rother" value="' + E(R.other) + '" placeholder="ระบุเหตุผล" style="margin-top:8px">' : '') +
            '<label>คืนเงินโดย</label><div class="axp-seg"><button data-rm="transfer" class="' + (R.method === 'transfer' ? 'on' : '') + '">📱 โอนคืน</button><button data-rm="cash" class="' + (R.method === 'cash' ? 'on' : '') + '">💵 เงินสด</button></div>' +
            (rs && rs.fake ? '<label class="axp-chk" style="margin-top:12px"><input type="checkbox" id="axp-returned"' + (R.returned ? ' checked' : '') + '> ได้รับรองเท้าคืนแล้ว (จำเป็น)</label>' + (p.claimUntil && Date.now() > eod(p.claimUntil) ? '<div class="axp-warn">เลยกำหนดเคลม 30 วันแล้ว (' + fmtDate(p.claimUntil) + ')</div>' : '') : '') + '</div>';
        var a = alertOf(p);
        if (a && a.lv !== 'red' && active(p) && !(rs && rs.th === REFUND_REASONS[0].th)) h += '<div class="axp-warn" style="background:#fffbeb;color:#92400e">ยังไม่ถึงกำหนดคืนเงินตามเงื่อนไข · ตรวจเหตุผลอีกครั้ง</div>';
        main(h);
        var ok = R.i != null && R.method && (!rs.fake || R.returned) && (rs.th !== 'อื่นๆ' || String(R.other || '').trim());
        foot('<button class="axp-b r big" data-a="refund-save"' + (ok ? '' : ' disabled') + '>ยืนยันคืนเงิน ' + M(p.paid, p.cur) + '</button>');
    }
    async function saveRefund() {
        var p = cur(), R = A.refund; if (!p || A.busy || !isOwner()) return;
        var rs = REFUND_REASONS[R.i], reason = rs.th === 'อื่นๆ' ? String(R.other || '').trim() : rs.th;
        A.busy = true;
        try {
            var now = Date.now(), refund = { reason: reason, lo: rs.lo || '', amt: Number(p.paid || 0), lak: paidLak(p), method: R.method, at: now, by: firebase.auth().currentUser.email, fromStatus: p.status };
            if (rs.fake) refund.returned = true;
            await database.ref('preorders/' + p.id).update({ status: 'refunded', refund: refund });
            var np = Object.assign({}, p, { status: 'refunded', refund: refund });
            A.list[p.id] = np; pushTrack(np);
            A.refund = null; A.view = 'detail'; draw();
            say('บันทึกคืนเงินแล้ว · แจ้งหน้าติดตามของลูกค้าแล้ว');
            var msg = 'ສະບາຍດີ ' + p.customerName + ' 🙏\nຮ້ານໄດ້ຄືນເງິນ ' + M(p.paid, p.cur) + ' ໃຫ້ທ່ານແລ້ວ\n' + p.no + ' · ' + String(p.name).toUpperCase() + (rs.lo ? '\nເຫດຜົນ: ' + rs.lo : '') + '\nຂໍອະໄພໃນຄວາມບໍ່ສະດວກ';
            if (confirm('ส่งข้อความแจ้งลูกค้าทาง WhatsApp?')) window.open('https://wa.me/' + waNumber(p.customerPhone) + '?text=' + encodeURIComponent(msg), '_blank');
        } catch (e) { say('ไม่สำเร็จ: ' + (e && e.message || e), false); }
        finally { A.busy = false; }
    }

    /* ---------- เปลี่ยนสถานะ ---------- */
    async function step(to) {
        var p = cur(); if (!p) return;
        var now = Date.now(), upd = { status: to };
        if (to === 'ordered') upd.orderedAt = now;
        if (to === 'shipping') { upd.shippedAt = now; if (!p.orderedAt) upd.orderedAt = now; }
        if (to === 'arrived') { upd.arrivedAt = now; upd.pickupBy = now + 7 * DAY; if (!p.orderedAt) upd.orderedAt = now; }
        if (to === 'picked') { upd.pickedAt = now; if (p.authentic) upd.claimUntil = now + 30 * DAY; }
        if (to === 'noshow') upd.noshowAt = now;
        try {
            await database.ref('preorders/' + p.id).update(upd);
            var np = Object.assign({}, p, upd); A.list[p.id] = np; pushTrack(np);
            say(ST[to].icon + ' ' + ST[to].th + ' · ลูกค้าเห็นในหน้าติดตามแล้ว');
            if (to === 'arrived' && confirm('ส่ง WhatsApp แจ้งลูกค้าว่าของถึงร้านแล้ว?')) waArrived(np);
            if (to === 'picked') { draw(); if (confirm('พิมพ์ใบรับของ (มีวันหมดเขตเคลม)?')) printPickup(np); return; }
            draw();
        } catch (e) { say('ไม่สำเร็จ: ' + e.message, false); }
    }
    function undo() {
        var p = cur(); if (!p) return;
        var fi = FLOW.indexOf(p.status); if (fi <= 0 || fi >= 4) return;
        var to = FLOW[fi - 1];
        if (!confirm('ย้อนสถานะจาก "' + ST[p.status].th + '" กลับเป็น "' + ST[to].th + '" ?')) return;
        var upd = { status: to };
        if (p.status === 'arrived') { upd.arrivedAt = null; upd.pickupBy = null; }
        if (p.status === 'shipping') upd.shippedAt = null;
        if (p.status === 'ordered') upd.orderedAt = null;
        database.ref('preorders/' + p.id).update(upd).then(function () { var np = Object.assign({}, p, upd); A.list[p.id] = np; pushTrack(np); draw(); });
    }

    /* ---------- หน้าติดตามของลูกค้า (ไม่มีชื่อ/เบอร์) ---------- */
    function pushTrack(p) {
        if (!p.trackTok) return;
        var t = {
            bill: p.no, kind: 'po', status: ST[p.status].track, at: p.createdAt, total: Number(p.total || 0), cur: p.cur, paid: remaining(p) <= 0, paidAmt: Number(p.paid || 0),
            lines: [{ n: p.name, m: poItemSub(p), q: p.qty || 1, s: Number(p.total || 0) }],
            eta: { from: p.etaFrom, to: p.etaTo }, auth: !!p.authentic, rate: FX.rate || 0
        };
        if (p.arrivedAt) { t.arrivedAt = p.arrivedAt; t.pickupBy = p.pickupBy; }
        if (p.pickedAt) { t.pickedAt = p.pickedAt; if (p.claimUntil) t.claimUntil = p.claimUntil; }
        if (p.refund) t.reason = p.refund.lo || '';
        database.ref('order_track/' + p.trackTok).set(t).catch(function (e) { say('อัปเดตหน้าติดตามไม่สำเร็จ: ' + e.message, false); });
    }

    /* ---------- ข้อความ / พิมพ์ ---------- */
    function wa(p, text) { window.open('https://wa.me/' + waNumber(p.customerPhone) + '?text=' + encodeURIComponent(text), '_blank'); }
    function waArrived(p) {
        var rem = remaining(p), lines = ['ສະບາຍດີ ' + p.customerName + ' 🙏', (p.authentic ? 'ເກີບ' : 'ສິນຄ້າ') + 'ຂອງທ່ານມາຮອດຮ້ານແລ້ວ ✅', p.no, String(p.name).toUpperCase() + (poVar(p.variant) ? ' · ' + poVar(p.variant) : '')];
        if (p.styleCode) lines.push('ລະຫັດລຸ້ນ ' + p.styleCode + ' (ກວດເອງໄດ້)');
        lines.push(rem > 0 ? 'ຍອດຄົງເຫຼືອ: ' + M(rem, p.cur) + (p.cur === 'THB' && FX.rate ? ' (' + approxLak(rem) + ')' : '') : 'ຊຳລະຄົບແລ້ວ ✓');
        lines.push('ກະລຸນາມາຮັບພາຍໃນ ' + fmtDate(p.pickupBy) + ' (7 ວັນ)', 'ມາຮັບທີ່ຮ້ານ ຫຼື ໃຫ້ຈັດສົ່ງ ແຈ້ງຮ້ານໄດ້ເລີຍ');
        if (p.trackTok) lines.push('🔎 ຕິດຕາມສະຖານະ:', trackLink(p.trackTok));
        wa(p, lines.join('\n'));
    }
    function lastBill(p) { var ps = payments(p); return ps.length ? ps[ps.length - 1].billId : null; }
    function withBill(id, fn) { database.ref('orders/' + id).once('value').then(function (s) { var b = s.val(); if (!b) return say('ไม่พบบิล', false); fn(Object.assign({ id: id }, b)); }); }
    function pickupDoc(p) {
        return {
            source: 'preorder', customerName: p.customerName, customerPhone: p.customerPhone, timestamp: p.pickedAt || Date.now(), paymentMethod: '', currency: p.cur, rate: FX.rate,
            po: { id: p.id, no: p.no, kind: 'pickup', name: p.name, variant: p.variant, styleCode: p.styleCode, qty: p.qty, cur: p.cur, total: p.total, paidBefore: p.paid, paidNow: 0, remaining: remaining(p), authentic: !!p.authentic, pickedAt: p.pickedAt || Date.now(), claimUntil: p.claimUntil || 0, etaFrom: p.etaFrom, etaTo: p.etaTo }
        };
    }
    function printPickup(p) { printReceipt(pickupDoc(p), false); }

    /* ---------- เหตุการณ์ ---------- */
    function onInput(e) {
        var t = e.target;
        if (t.id === 'axp-q') { if (e.type !== 'input') return; A.q = t.value; var pos = t.selectionStart; drawList(); var q = document.getElementById('axp-q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} return; }
        if (t.id === 'axp-item' && e.type === 'change') { if (t.value) pickItem(t.value); else { A.f.itemId = ''; } A.keepScroll = true; return draw(); }
        if (t.id === 'axp-pick') { A.payPick = t.checked; return; }
        if (t.id === 'axp-returned') { if (e.type !== 'change') return; A.refund.returned = t.checked; A.keepScroll = true; return draw(); }
        if (t.id === 'axp-rother') { A.refund.other = t.value; var b = A.ov.querySelector('[data-a="refund-save"]'); if (b) b.disabled = !t.value.trim() || !A.refund.method; return; }
        if (t.dataset.f && A.f) {
            var k = t.dataset.f;
            A.f[k] = t.type === 'checkbox' ? t.checked : t.value;
            if (['unit', 'qty', 'custom'].indexOf(k) >= 0) refreshFoot();
            return;
        }
        if (t.dataset.p && A.pay) { A.pay[t.dataset.p] = t.value; refreshFoot(); }
    }
    function setTxt(id, v) { var el = document.getElementById(id); if (el) el.innerHTML = v; }
    // อัปเดตปุ่มยืนยันโดยไม่วาดใหม่ (ไม่ให้คีย์บอร์ดหาย)
    // (ไม่วาดหน้าใหม่ตอนพิมพ์ เพราะจะทำให้กดปุ่มไม่ติดบนแท็บเล็ต — อัปเดตเฉพาะตัวเลข)
    function refreshFoot() {
        var amt, d, c = A.pay ? A.pay.cur : 'LAK';
        if (A.view === 'create') {
            var t = fTotal(); amt = fAmount(); d = payDue(amt);
            setTxt('axp-t', M(t, c)); setTxt('axp-tap', c === 'THB' && t ? approxLak(t, d.rate || FX.rate) : '');
            setTxt('axp-pf', M(t, c));
            setTxt('axp-rem', amt < t && amt > 0 ? 'คงเหลือจ่ายตอนรับของ <b>' + M(t - amt, c) + '</b>' : '');
            var b = A.ov.querySelector('[data-a="create-save"]');
            if (b) { b.disabled = !d.ok; b.textContent = '✓ รับเงิน ' + (d.ok ? M(d.due, d.payCur) : '') + ' · สร้าง' + (amt < t ? 'ใบมัดจำ' : 'ใบรับเงิน'); }
        } else if (A.view === 'pay') {
            amt = remaining(cur()); d = payDue(amt);
            var b2 = A.ov.querySelector('[data-a="pay-save"]');
            if (b2) { b2.disabled = !d.ok; b2.textContent = '✓ รับเงิน ' + (d.ok ? M(d.due, d.payCur) : ''); }
        } else return;
        setTxt('axp-amt', M(amt, c)); setTxt('axp-pct', 'จ่ายเป็น ' + baht(amt));
        setTxt('axp-pcl', d.rate ? 'จ่ายเป็น ' + money(toLak(amt, d.rate)) : 'จ่ายเป็นกีบ (ใส่เรทก่อน)');
        setTxt('axp-chg', M(d.change, d.payCur));
        var sh = document.getElementById('axp-short'); if (sh) sh.hidden = !(d.rec < d.due);
    }
    function onClick(e) {
        var b = e.target.closest('button,[data-open]'); if (!b) return;
        var ds = b.dataset;
        if (ds.open) { A.view = 'detail'; A.id = ds.open; return draw(); }
        if (ds.tab) { A.tab = ds.tab; A.q = ''; return draw(); }
        if (ds.var != null && A.f) { var it = A.items[A.f.itemId], v = parsePrices(it && it.priceOptions).find(function (x) { return x.label === ds.var; }); A.f.variant = ds.var; if (v) A.f.unit = String(poUnit(it, v)); A.keepScroll = true; return draw(); }
        if (ds.cur && A.f) { A.f.cur = ds.cur; A.pay.cur = ds.cur; A.pay.payCur = ds.cur; A.keepScroll = true; return draw(); }
        if (ds.plan && A.f) { A.f.plan = ds.plan; A.keepScroll = true; return draw(); }
        if (ds.pc && A.pay) { A.pay.payCur = ds.pc; A.pay.received = ''; A.keepScroll = true; return draw(); }
        if (ds.m && A.pay) { A.pay.method = ds.m; A.pay.received = ''; A.keepScroll = true; return draw(); }
        if (ds.ri != null && A.refund) { A.refund.i = +ds.ri; A.keepScroll = true; return draw(); }
        if (ds.rm && A.refund) { A.refund.method = ds.rm; A.keepScroll = true; return draw(); }
        if (ds.step) return step(ds.step);
        if (ds.print) return withBill(ds.print, function (bl) { printReceipt(bl, true, bl.id); });
        var p = cur();
        switch (ds.a) {
            case 'close': return close();
            case 'back':
                if (A.view === 'pay' || A.view === 'refund') { A.view = 'detail'; return draw(); }
                if (A.view === 'create' && A.f && (A.f.name || A.f.customerName) && !confirm('ยกเลิกการสร้างพรีออเดอร์นี้?')) return;
                A.view = 'list'; A.f = null; return draw();
            case 'new': newForm(); A.view = 'create'; return draw();
            case 'create-save': return saveCreate();
            case 'pay-rest': return startPay();
            case 'pay-save': return savePay();
            case 'picked': return confirm('ลูกค้ารับของแล้ว?') && step('picked');
            case 'undo': return undo();
            case 'noshow':
                if (!isOwner()) return;
                if (p.pickupBy && Date.now() <= eod(p.pickupBy) && !confirm('ยังไม่เลยกำหนดรับ (' + fmtDate(p.pickupBy) + ') ยืนยันว่าลูกค้าไม่มารับ?')) return;
                if (!confirm('ลูกค้าไม่มารับ: ร้านเก็บมัดจำ ' + M(p.paid, p.cur) + ' และนำของไปขายต่อ ?')) return;
                return step('noshow');
            case 'refund': if (!isOwner()) return; A.refund = { i: null, method: 'transfer', returned: false, other: '' }; A.view = 'refund'; return draw();
            case 'refund-save': return saveRefund();
            case 'wa-arrived': return waArrived(p);
            case 'wa-receipt': { var id = lastBill(p); if (!id) return; return withBill(id, function (bl) { wa(p, poReceiptText(bl)); }); }
            case 'copy-track': {
                var link = trackLink(p.trackTok);
                try { navigator.clipboard.writeText(link).then(function () { say('คัดลอกลิงก์แล้ว'); }, function () { prompt('ลิงก์ติดตาม', link); }); } catch (x) { prompt('ลิงก์ติดตาม', link); }
                return;
            }
            case 'print-pickup': return printPickup(p);
            case 'done-print': return printReceipt(A.done.bill, false, A.done.billId);
            case 'done-share': return openShareModal(A.done.bill);
            case 'done-wa': { var dp = A.list[A.done.id] || {}; return wa(dp, poReceiptText(A.done.bill)); }
            case 'done-ok': A.id = A.done.id; A.done = null; A.view = 'detail'; return draw();
        }
    }

    // ให้หน้าอื่นเรียกใช้: AXPO.openCreate({itemId, variant, name, phone, note, qty, trackTok, onlineId})
    window.AXPO = {
        open: function () { if (A.ov) open(); },
        openCreate: function (pre) { if (!A.ov) return; newForm(pre); open('create'); },
        list: function () { return all(); },
        alertOf: alertOf, addBiz: addBiz,
        cafeOn: function () { return A.cafeOn; }
    };
})();
