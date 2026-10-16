/* AUGUSTX รอบ 7 — เปลี่ยนอีโมจิหน้าปุ่มเป็นไอคอน (แบบ E) + ตัวนับสถานะจอครัว
   เปลี่ยนแค่หน้าตา ไม่แตะการทำงาน · ถ้าโหลดฟอนต์ไอคอนไม่ได้ (ออฟไลน์) จะใช้อีโมจิเดิมต่อ */
(function () {
    'use strict';
    var MAP = {
        '📋': 'list_alt', '🧾': 'receipt_long', '👨‍🍳': 'skillet', '⚙️': 'settings', '⚙': 'settings',
        '🛒': 'shopping_cart', '🛵': 'two_wheeler', '👟': 'steps', '📦': 'inventory_2', '📜': 'history',
        '🔔': 'notifications', '🔇': 'notifications_off', '🍽️': 'restaurant', '🍽': 'restaurant', '🥡': 'takeout_dining',
        '🏷️': 'sell', '🏷': 'sell', '📅': 'calendar_month', '🔥': 'local_fire_department', '💵': 'payments',
        '☕': 'local_cafe', '⏸': 'pause_circle', '⏸️': 'pause_circle', '📝': 'edit_note', '💳': 'credit_card', '🖨️': 'print', '🖨': 'print'
    };
    var KEYS = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; });
    // ปุ่มที่จะเปลี่ยนไอคอน · tile = ปุ่มพื้นขาว (ไอคอนอยู่ในกล่องฟ้า)
    var TARGETS = [
        ['body > header .top-btn, body > header h1, nav.tabs button > span, .pos-header .top-btn, .kitchen-header .top-btn, .kitchen-header h1, .cart-bar > span, .ctl-btns .big, .sh-foot .big, .action-btn', false],
        ['.tab-btn, #cart-ctl .seg button, .cart-header > span:first-child', true]
    ];
    function firstText(el) {
        for (var n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3) { if (n.nodeValue.trim()) return n; continue; }
            if (n.nodeType === 1 && n.classList.contains('mi')) return null; // ทำแล้ว
            if (n.nodeType === 1) return null;
        }
        return null;
    }
    function iconize(el, tile) {
        var tn = firstText(el); if (!tn) return;
        var s = tn.nodeValue, lead = s.match(/^\s*/)[0], i = lead.length, names = [];
        for (;;) {
            var k = null;
            for (var j = 0; j < KEYS.length; j++) if (s.substr(i, KEYS[j].length) === KEYS[j]) { k = KEYS[j]; break; }
            if (!k) break;
            names.push(MAP[k]); i += k.length;
            while (s.charAt(i) === '️') i++;
        }
        if (!names.length) return;
        tn.nodeValue = s.slice(i).replace(/^\s+/, '');
        for (var x = names.length - 1; x >= 0; x--) {
            var sp = document.createElement('span');
            sp.className = 'mi' + (tile ? ' tile' : ''); sp.setAttribute('aria-hidden', 'true'); sp.textContent = names[x];
            el.insertBefore(sp, tn);
        }
    }
    function sweep() {
        TARGETS.forEach(function (t) { document.querySelectorAll(t[0]).forEach(function (el) { iconize(el, t[1]); }); });
        kitchenCount();
    }
    var queued = false;
    function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; sweep(); }); }

    // ---------- ตัวนับด้านบนจอครัว: รอ · กำลังทำ ----------
    var kc = null;
    function kitchenCount() {
        var grid = document.getElementById('kitchen-orders-container'); if (!grid) return;
        var h1 = document.querySelector('.kitchen-header h1'); if (!h1) return;
        if (!kc) { kc = document.createElement('span'); kc.className = 'k7-count'; h1.appendChild(kc); }
        var hist = document.getElementById('tab-history-btn'), isHist = hist && hist.classList.contains('active');
        var cards = grid.querySelectorAll('.order-card'), wait = 0, cook = 0, done = 0;
        cards.forEach(function (c) { if (c.classList.contains('completed')) done++; else if (c.classList.contains('cooking')) cook++; else if (!c.classList.contains('cancel')) wait++; });
        var more = document.getElementById('queue-alert-banner'), plus = more && more.classList.contains('active') ? '+' : '';
        var html = isHist ? '<span>เสร็จ<b>' + done + '</b></span>' : '<span>รอ<b>' + wait + plus + '</b></span><span>กำลังทำ<b>' + cook + '</b></span>';
        if (kc.innerHTML !== html) kc.innerHTML = html;
    }

    function start() {
        sweep();
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
        setInterval(kitchenCount, 3000);
    }
    function ready(fn) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn(); }
    ready(function () {
        // ใช้ไอคอนเมื่อฟอนต์โหลดสำเร็จเท่านั้น
        var go = function () { document.documentElement.classList.add('icons7'); start(); };
        try {
            if (document.fonts && document.fonts.load) {
                var t = setTimeout(function () { t = null; kitchenOnly(); }, 6000);
                document.fonts.load('24px "Material Symbols Rounded"', 'settings').then(function (f) {
                    if (!t) return; clearTimeout(t);
                    f && f.length ? go() : kitchenOnly();
                }, function () { if (t) { clearTimeout(t); kitchenOnly(); } });
            } else kitchenOnly();
        } catch (e) { kitchenOnly(); }
    });
    function kitchenOnly() { kitchenCount(); setInterval(kitchenCount, 2000); }
})();
