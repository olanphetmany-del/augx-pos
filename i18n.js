/* AUGUSTX — เลือกภาษาของระบบ ไทย / ລາວ / English
   ใช้คู่กับ i18n-dict.js · แปลข้อความบนหน้าจอขณะแสดงผล (ไม่แตะข้อมูล ชื่อเมนู ใบเสร็จที่พิมพ์ หรือข้อความ WhatsApp)
   หน้าแคชเชียร์/ครัว/SHOP/Admin: ต้นฉบับภาษาไทย · หน้าลูกค้า: ต้นฉบับภาษาลาว */
(function () {
    'use strict';
    var SET = window.I18N_SET || 'staff';            // 'staff' | 'cust'
    var SRC = SET === 'cust' ? 'lo' : 'th';
    var KEY = SET === 'cust' ? 'augx-lang-cust' : 'augx-lang';
    var LANGS = [['th', 'ไทย', '🇹🇭'], ['lo', 'ລາວ', '🇱🇦'], ['en', 'English', '🇬🇧']];
    var lang = SRC;
    try { var s = localStorage.getItem(KEY); if (s === 'th' || s === 'lo' || s === 'en') lang = s; } catch (e) {}
    var COL = { th: 0, lo: 1, en: 2 };
    var I18N = window.I18N = { lang: lang, src: SRC, set: setLang, t: function (x) { return x; } };
    document.documentElement.setAttribute('data-lang', lang);
    if (lang !== SRC) document.documentElement.lang = lang;

    function setLang(l) { try { localStorage.setItem(KEY, l); } catch (e) {} location.reload(); }

    // ---------- ตัวเลือกภาษา ----------
    function mkSel() {
        var sel = document.createElement('select');
        sel.className = 'i18n-sel'; sel.setAttribute('data-noi18n', ''); sel.title = 'Language / ພາສາ / ภาษา';
        LANGS.forEach(function (l) { var o = document.createElement('option'); o.value = l[0]; o.textContent = l[2] + ' ' + l[1]; if (l[0] === lang) o.selected = true; sel.appendChild(o); });
        sel.onchange = function () { setLang(sel.value); };
        return sel;
    }
    function picker() {
        if (document.querySelector('.i18n-sel')) return;
        var slots = [];
        ['[data-i18n-slot]', '.pos-header .top-controls', '.kitchen-header .top-controls', 'body > header .top-controls', '#m-bar', '.sidebar'].forEach(function (q) { var el = document.querySelector(q); if (el && slots.indexOf(el) < 0) slots.push(el); });
        var st = document.createElement('style');
        st.textContent = ('#i18n-sel{font:inherit;font-size:13px;font-weight:700;border-radius:10px;padding:6px 8px;cursor:pointer;border:1px solid rgba(0,0,0,.15);background:#fff;color:#0e1626;max-width:120px}' +
            '.pos-header #i18n-sel,.kitchen-header #i18n-sel,body>header #i18n-sel,#m-bar #i18n-sel,.sidebar #i18n-sel{background:rgba(255,255,255,.16);color:#fff;border-color:rgba(255,255,255,.3)}' +
            '#i18n-sel option{color:#0e1626;background:#fff}#i18n-sel.float{position:fixed;right:10px;bottom:10px;z-index:3000;box-shadow:0 4px 14px rgba(0,0,0,.15)}' +
            '#m-bar #i18n-sel{margin-left:auto;font-size:12px;padding:4px 6px}.sidebar #i18n-sel{display:block;margin:8px 16px;width:calc(100% - 32px);max-width:none}' +
            '.band #i18n-sel{background:rgba(255,255,255,.16);color:#fff;border-color:rgba(255,255,255,.35)}').replace(/#i18n-sel/g, '.i18n-sel');
        document.head.appendChild(st);
        if (slots.length) slots.forEach(function (s) { s.appendChild(mkSel()); });
        else { var f = mkSel(); f.classList.add('float'); document.body.appendChild(f); }
    }

    // ---------- พจนานุกรม (ยาวก่อน) ----------
    var DICT = window.I18N_DICT || {}, map = {}, keys = [];
    function add(k, v) { if (k && v && v !== k && !map[k]) { map[k] = v; keys.push(k); } }
    if (lang !== SRC) {
        var to = SET === 'cust' ? (lang === 'th' ? 1 : 2) : (lang === 'lo' ? 1 : 2);
        (DICT[SET] || []).forEach(function (r) { add(r[0], r[to]); });
    }
    // ป้ายภาษาลาวที่ปนอยู่ในหน้าร้าน (เช่น เมนู Admin) → แปลเป็นภาษาที่เลือก
    if (SET === 'staff') (DICT.staffLo || []).forEach(function (r) { add(r[0], lang === 'lo' ? r[1] : lang === 'en' ? r[2] : r[3]); });
    if (!keys.length) { ready(picker); return; }
    keys.sort(function (a, b) { return b.length - a.length; });
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var RX = keys.length ? new RegExp(keys.map(esc).join('|'), 'g') : null;
    var SCRIPT = SRC === 'th' ? /[\u0E00-\u0EFF]/ : /[\u0E80-\u0EFF]/;
    var LET = /[\u0E01-\u0E3A\u0E40-\u0E4E\u0E81-\u0EDF]/;
    function tr(s) {
        if (!s || !RX || !SCRIPT.test(s)) return s;
        RX.lastIndex = 0;
        // คำสั้น (เช่น "รอ") ต้องอยู่แยกเป็นคำ ไม่แปลกลางคำอื่น (เช่น "รอง")
        return s.replace(RX, function (m, off) {
            if (m.length < 8 && (LET.test(s.charAt(off - 1)) || LET.test(s.charAt(off + m.length)))) return m;
            return map[m];
        });
    }
    I18N.t = tr;

    // ---------- แปลหน้าจอ ----------
    var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
    var done = new WeakMap();
    function skipEl(el) {
        for (var e = el; e && e !== document.body; e = e.parentElement) {
            if (SKIP[e.tagName] || e.id === 'print-area' || e.id === 'msg' || e.hasAttribute('data-noi18n') || e.isContentEditable) return true;
        }
        return false;
    }
    function doText(n) {
        var v = n.nodeValue;
        if (done.get(n) === v) return;
        var o = tr(v);
        if (o !== v) n.nodeValue = o;
        done.set(n, n.nodeValue);
    }
    var ATTRS = ['placeholder', 'title', 'aria-label'];
    function doAttrs(el) {
        for (var i = 0; i < ATTRS.length; i++) {
            var a = el.getAttribute && el.getAttribute(ATTRS[i]);
            if (a && SCRIPT.test(a)) { var o = tr(a); if (o !== a) el.setAttribute(ATTRS[i], o); }
        }
        if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && SCRIPT.test(el.value)) el.value = tr(el.value);
    }
    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { if (root.parentElement && !skipEl(root.parentElement)) doText(root); return; }
        if (root.nodeType !== 1 || skipEl(root)) return;
        doAttrs(root);
        var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.nodeType === 1) return (SKIP[n.tagName] || n.id === 'print-area' || n.id === 'msg' || n.hasAttribute('data-noi18n')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        for (var n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
    }
    var pending = [], queued = false;
    function flush() {
        queued = false;
        var list = pending; pending = [];
        for (var i = 0; i < list.length; i++) walk(list[i]);
        if (SCRIPT.test(document.title)) document.title = tr(document.title);
    }
    function queue(n) { pending.push(n); if (!queued) { queued = true; (window.queueMicrotask || setTimeout)(flush); } }

    // กล่องแจ้งเตือนของเบราว์เซอร์
    ['alert', 'confirm', 'prompt'].forEach(function (k) {
        var f = window[k]; if (!f) return;
        window[k] = function (m) { var a = Array.prototype.slice.call(arguments); if (typeof m === 'string') a[0] = tr(m); return f.apply(window, a); };
    });

    function start() {
        picker();
        walk(document.body); document.title = tr(document.title);
        new MutationObserver(function (ms) {
            for (var i = 0; i < ms.length; i++) {
                var m = ms[i];
                if (m.type === 'characterData') queue(m.target);
                else if (m.type === 'attributes') queue(m.target);
                else for (var j = 0; j < m.addedNodes.length; j++) queue(m.addedNodes[j]);
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    function ready(fn) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn(); }
    ready(start);
})();
