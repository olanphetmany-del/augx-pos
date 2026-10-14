/* =====================================================================
   online-cashier.js — ออร์เดอร์ที่ลูกค้าสั่งเองจาก order.html (ใช้ในหน้าแคชเชียร์ index.html)
   ต้องโหลดหลัง shared.js และ augustx-menu.js
   - เด้งแจ้งเตือน + เสียงดังซ้ำจนกว่าจะเปิดดู
   - คิดราคาใหม่จากเมนูในระบบทุกครั้ง (ไม่เชื่อตัวเลขจากมือถือลูกค้า)
   - รับเงินแล้ว → สร้างบิล + ส่งเข้าครัว (ไม่ต้องคีย์ซ้ำ)
   - อัปเดตหน้าติดตามของลูกค้า (order_track/<รหัส>) : ชำระแล้ว / ส่งของ / พร้อมรับ
     ส่วน "กำลังทำ" และ "ทำเสร็จ" ครัวอัปเดตเองจากจอครัว
   ===================================================================== */
(function () {
    'use strict';

    var DEF_REPLY = 'ສະບາຍດີ {name}\nຮ້ານໄດ້ຮັບອໍເດີ້ {bill} ແລ້ວ\nຍອດລວມ: {total}\nກະລຸນາໂອນເງິນ ແລະ ສົ່ງສະລິບມາທາງນີ້ ຂໍຂອບໃຈ 🙏';
    var STAGE_TH = { new: 'รอร้านยืนยัน', accepted: 'อยู่ในคิว', making: 'ครัวกำลังทำ', packed: 'ทำเสร็จ รอส่ง', delivering: 'กำลังส่ง', ready: 'พร้อมรับ/ส่งถึงแล้ว', rejected: 'ไม่รับ' };
    var orders = {}, tracks = {}, trackRefs = {}, billRefs = {}, menu = null, cfg = {}, raw = { menu_items: {}, modifiers: {}, categories: {} };
    var panelOpen = false, seen = {}, busy = {}, beepTimer = null, started = false, btn = null, overlay = null, feeDraft = {};

    function E(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s); }
    function M(n) { return typeof money === 'function' ? money(n) : Number(n || 0).toLocaleString() + ' ₭'; }
    function say(t, ok) { if (typeof toast === 'function') toast(t, ok); }
    function ago(ts) {
        var m = Math.max(0, Math.round((Date.now() - (ts || 0)) / 60000));
        return m < 1 ? 'เมื่อกี้' : m < 60 ? m + ' นาทีที่แล้ว' : Math.floor(m / 60) + ' ชม. ที่แล้ว';
    }
    function waDigits(p) { return typeof waNumber === 'function' ? waNumber(p) : String(p || '').replace(/\D/g, ''); }
    function trackLink(tok) { return location.href.replace(/[^/]*([?#].*)?$/, 'order.html') + '#t=' + tok; }

    /* ---------- เริ่มทำงานหลังล็อกอิน ---------- */
    function boot() {
        if (started) return;
        started = true;
        injectUI();
        ['menu_items', 'modifiers', 'categories'].forEach(function (k) {
            database.ref(k).on('value', function (s) { raw[k] = s.val() || {}; menu = AugustxMenu.buildMenu(raw.menu_items, raw.modifiers, raw.categories); render(); });
        });
        database.ref('settings/online').on('value', function (s) { cfg = s.val() || {}; });
        database.ref('online_orders').orderByChild('createdAt').startAt(Date.now() - 36 * 3600000).on('value', function (s) {
            orders = s.val() || {};
            watch();
            render();
        }, function (e) { say('อ่านออร์เดอร์ออนไลน์ไม่ได้: ' + e.message, false); });
    }
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.REQUIRE_LOGIN && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (u) { if (u) boot(); });
    } else {
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
    }

    /* ---------- ติดตามสถานะ: หน้าติดตามของลูกค้า + บิล (ถ้าคิดเงินจากหน้าบิลปกติ ให้ลูกค้าเห็นว่าชำระแล้ว) ---------- */
    function watch() {
        Object.keys(orders).forEach(function (id) {
            var o = orders[id];
            if (o.trackTok && !trackRefs[o.trackTok]) {
                trackRefs[o.trackTok] = database.ref('order_track/' + o.trackTok);
                trackRefs[o.trackTok].on('value', function (s) { tracks[o.trackTok] = s.val(); render(); });
            }
            if (o.billId && !billRefs[o.billId]) {
                billRefs[o.billId] = database.ref('orders/' + o.billId + '/status');
                billRefs[o.billId].on('value', function (s) {
                    var st = s.val(), cur = orders[id] || {};
                    if (st === 'paid' && !cur.paid) {
                        database.ref('online_orders/' + id + '/paid').set(true);
                        setTrack(cur, { paid: true });
                    }
                    if (st === 'void') setTrack(cur, { status: 'rejected' });
                });
            }
        });
    }
    function setTrack(o, patch) {
        if (!o || !o.trackTok) return Promise.resolve();
        return database.ref('order_track/' + o.trackTok).update(patch).catch(function (e) { say('อัปเดตหน้าติดตามไม่สำเร็จ: ' + e.message, false); });
    }
    function stageOf(o) { var t = o.trackTok && tracks[o.trackTok]; return (t && t.status) || (o.status === 'accepted' ? 'accepted' : o.status); }

    /* ---------- หน้าจอ ---------- */
    var CSS = '' +
        '.axo-btn{position:relative}.axo-btn.alert{background:#dc2626!important;color:#fff!important;animation:axoPulse 1s infinite}' +
        '@keyframes axoPulse{50%{box-shadow:0 0 0 6px rgba(220,38,38,.25)}}' +
        '.axo-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:3000;display:flex;justify-content:center;align-items:flex-start;padding:24px 12px;overflow:auto}' +
        '.axo-box{background:#fff;color:#0f172a;border-radius:12px;width:100%;max-width:680px;padding:18px;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.3)}' +
        '.axo-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}.axo-head h3{margin:0;font-size:18px;color:#1a365d}' +
        '.axo-card{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-top:10px}.axo-card.new{border:2px solid #dc2626;background:#fff7f7}.axo-card.done{opacity:.6}.axo-card.live{border:2px solid #1a365d}' +
        '.axo-row{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.axo-sm{color:#64748b;font-size:12.5px}' +
        '.axo-line{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #e2e8f0}.axo-line:last-child{border-bottom:0}' +
        '.axo-warn{background:#fef3c7;color:#92400e;border-radius:6px;padding:6px 8px;margin-top:6px;font-size:12.5px}.axo-err{background:#fee2e2;color:#991b1b}' +
        '.axo-dl{background:#eff6ff;color:#1e3a8a;border-radius:8px;padding:8px 10px;margin:6px 0 8px;font-size:13px;line-height:1.6}.axo-dl a{color:#1d4ed8;font-weight:bold}' +
        '.axo-tot{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;margin-top:8px}' +
        '.axo-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}.axo-acts button,.axo-acts a{border:0;border-radius:8px;padding:10px 12px;font-weight:bold;cursor:pointer;font-size:13.5px;text-decoration:none;display:inline-block}' +
        '.axo-acts input{width:130px;padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}' +
        '.axo-g{background:#16a34a;color:#fff}.axo-b{background:#1a365d;color:#fff}.axo-w{background:#128c4a;color:#fff}.axo-x{background:#f1f5f9;color:#b91c1c}.axo-o{background:#ea580c;color:#fff}' +
        '.axo-pill{font-size:11.5px;font-weight:bold;border-radius:99px;padding:2px 8px;margin-left:4px}.axo-pill.new{background:#dc2626;color:#fff}.axo-pill.accepted{background:#dcfce7;color:#166534}.axo-pill.rejected{background:#f1f5f9;color:#64748b}' +
        '.axo-pill.st{background:#dbeafe;color:#1e3a8a}.axo-pill.unpaid{background:#fee2e2;color:#991b1b}.axo-pill.paid{background:#dcfce7;color:#166534}.axo-pill.dlv{background:#ffedd5;color:#9a3412}';

    function injectUI() {
        var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
        var first = document.querySelector('.top-btn');
        btn = document.createElement('button');
        btn.className = (first ? first.className.replace('badge-btn', '') : '') + ' axo-btn';
        btn.type = 'button';
        btn.onclick = openPanel;
        if (first && first.parentElement) first.parentElement.insertBefore(btn, first);
        else { btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2500;padding:12px 16px;border-radius:99px;border:0;background:#1a365d;color:#fff;font-weight:bold'; document.body.appendChild(btn); }
        render();
    }

    function finished(o) { var s = stageOf(o); return o.status === 'rejected' || s === 'ready' || s === 'rejected'; }
    function list() {
        return Object.keys(orders).map(function (k) { return Object.assign({ id: k }, orders[k]); })
            .sort(function (a, b) {
                return (b.status === 'new') - (a.status === 'new') || finished(a) - finished(b) || (b.createdAt || 0) - (a.createdAt || 0);
            });
    }
    function newOnes() { return list().filter(function (o) { return o.status === 'new'; }); }
    function liveOnes() { return list().filter(function (o) { return o.status === 'accepted' && !finished(o); }); }

    function render() {
        if (!btn) return;
        var n = newOnes(), live = liveOnes();
        btn.innerHTML = '🛵 ออนไลน์' + (n.length ? ' <span class="cnt" style="background:#fff;color:#dc2626;border-radius:99px;padding:0 7px;margin-left:4px">' + n.length + '</span>' : '') +
            (!n.length && live.length ? ' <span class="cnt" style="background:#dbeafe;color:#1e3a8a;border-radius:99px;padding:0 7px;margin-left:4px">' + live.length + '</span>' : '');
        btn.classList.toggle('alert', n.length > 0 && !panelOpen);
        var fresh = n.filter(function (o) { return !seen[o.id]; });
        if (fresh.length && !panelOpen) startBeep(); else if (!n.length || panelOpen) stopBeep();
        document.title = (n.length ? '(' + n.length + ') 🛵 ' : '') + document.title.replace(/^\(\d+\) 🛵 /, '');
        if (panelOpen) drawPanel();
    }

    /* ---------- เสียงเตือน: ดังซ้ำทุก 15 วินาทีจนกว่าจะเปิดดู ---------- */
    var actx = null;
    function beep() {
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            if (actx.state === 'suspended') actx.resume();
            [0, 0.22, 0.44].forEach(function (d) {
                var o = actx.createOscillator(), g = actx.createGain();
                o.type = 'square'; o.frequency.value = d === 0.22 ? 1175 : 880; o.connect(g); g.connect(actx.destination);
                g.gain.setValueAtTime(0.25, actx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d + 0.18);
                o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.2);
            });
        } catch (e) {}
        try { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance('New online order')); } catch (e) {}
    }
    function startBeep() { if (beepTimer) return; beep(); beepTimer = setInterval(beep, 15000); }
    function stopBeep() { if (beepTimer) { clearInterval(beepTimer); beepTimer = null; } }

    /* ---------- แผงรายการ ---------- */
    function openPanel() {
        panelOpen = true;
        newOnes().forEach(function (o) { seen[o.id] = true; });
        stopBeep();
        if (!overlay) {
            overlay = document.createElement('div'); overlay.className = 'axo-ov';
            overlay.addEventListener('click', function (e) { if (e.target === overlay) closePanel(); });
            overlay.addEventListener('click', onAction);
            overlay.addEventListener('input', function (e) { if (e.target.dataset.fee) feeDraft[e.target.dataset.fee] = e.target.value; });
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        render();
    }
    function closePanel() { panelOpen = false; if (overlay) overlay.style.display = 'none'; render(); }

    function priced(o) {
        var r = menu ? AugustxMenu.priceRound(menu, arrOf(o.items)) : { lines: arrOf(o.items), total: Number(o.total || 0), problems: [] };
        r.missing = r.problems.filter(function (p) { return /ไม่พบ/.test(p.reason); });
        return r;
    }
    function arrOf(x) { return Array.isArray(x) ? x.filter(Boolean) : (x && typeof x === 'object' ? Object.values(x) : []); }
    function optText(l) {
        var by = {};
        arrOf(l.options).forEach(function (o) { (by[o.group] = by[o.group] || []).push(o.name); });
        return Object.keys(by).map(function (g) { return g + ': ' + by[g].join(', '); }).join(' | ');
    }
    // ค่าส่ง: ร้านออกให้ไม่เกิน freeCap เมื่อยอดถึง (คิดตอนลูกค้าสั่ง)
    function feeSplit(dl, fee) {
        var shop = dl.free ? Math.min(fee, Number(dl.freeCap || 0)) : 0;
        return { shop: shop, cust: Math.max(0, fee - shop) };
    }

    function drawPanel() {
        var keepScroll = overlay.scrollTop;
        var all = list(), html = '<div class="axo-box"><div class="axo-head"><h3>🛵 ออร์เดอร์ลูกค้าสั่งเอง</h3><button class="axo-x" data-a="close" style="border:0;border-radius:8px;padding:8px 12px;font-weight:bold;cursor:pointer">ปิด</button></div>';
        if (!all.length) html += '<p class="axo-sm" style="text-align:center;padding:24px 0">ยังไม่มีออร์เดอร์ออนไลน์ใน 36 ชั่วโมงที่ผ่านมา</p>';
        all.forEach(function (o) {
            var p = priced(o), isNew = o.status === 'new', stage = stageOf(o), dl = o.delivery, t = o.trackTok && tracks[o.trackTok];
            var live = o.status === 'accepted' && !finished(o);
            html += '<div class="axo-card ' + (isNew ? 'new' : live ? 'live' : 'done') + '">' +
                '<div class="axo-row"><div><b style="font-size:15px">' + E(o.id) + '</b> <span class="axo-pill ' + E(o.status) + '">' + ({ new: 'ใหม่', accepted: 'รับแล้ว', rejected: 'ไม่รับ' }[o.status] || E(o.status)) + '</span>' +
                (o.status === 'accepted' ? '<span class="axo-pill ' + (o.paid ? 'paid">จ่ายแล้ว' : 'unpaid">ยังไม่จ่าย') + '</span><span class="axo-pill st">' + E(STAGE_TH[stage] || stage) + '</span>' : '') +
                (dl ? '<span class="axo-pill dlv">🛵 จัดส่ง</span>' : '') +
                (o.orderNo ? ' <span class="axo-sm">บิล #' + E(o.orderNo) + '</span>' : '') + '</div><span class="axo-sm">' + ago(o.createdAt) + '</span></div>' +
                '<div style="margin:4px 0 8px"><b>' + E(o.name) + '</b> <span class="axo-sm">📞 ' + E(o.phone) + '</span></div>';
            if (dl) {
                var fee = Number((t && t.delivery && t.delivery.fee) || dl.actualFee || 0), est = Number(dl.estFee || 0);
                var sp = feeSplit(dl, fee || est);
                html += '<div class="axo-dl">🛵 <b>จัดส่ง ' + E(Number(dl.km || 0).toFixed(1)) + ' กม.</b> · จุดรับ: <b>' + E(dl.spot) + '</b> · ' +
                    '<a target="_blank" rel="noopener" href="https://maps.google.com/?q=' + E(dl.lat) + ',' + E(dl.lng) + '">📍 เปิดแผนที่</a><br>' +
                    (fee ? 'ค่ารถจริง ' + M(fee) : 'ค่าส่งประมาณ ' + M(est)) +
                    (dl.free ? ' · <b>ส่งฟรี</b> ร้านออกให้ ' + M(sp.shop) + (sp.cust ? ' · ลูกค้าจ่ายคนขับส่วนเกิน ' + M(sp.cust) : '') : ' · ลูกค้าจ่ายคนขับเอง') +
                    '<br><span class="axo-sm">ใส่เบอร์ลูกค้า ' + E(o.phone) + ' ในแอปเรียกรถ ให้คนขับโทรหาตอนถึง</span></div>';
            }
            p.lines.forEach(function (l) {
                var meta = [l.variant, optText(l)].filter(Boolean).join(' · ');
                var it = menu && menu.byId[l.itemId];
                html += '<div class="axo-line"><div>' + l.qty + '× <b>' + E(l.name) + '</b>' + (it && it.preorder ? ' <span class="axo-pill unpaid">PRE-ORDER</span>' : '') + (it && it.retail ? ' <span class="axo-sm">(ไม่เข้าครัว)</span>' : '') +
                    (meta ? '<div class="axo-sm">' + E(meta) + '</div>' : '') + (l.note ? '<div class="axo-sm">📝 ' + E(l.note) + '</div>' : '') + '</div><div style="white-space:nowrap">' + M(l.unitPrice * l.qty) + '</div></div>';
            });
            if (isNew) {
                p.problems.forEach(function (x) { html += '<div class="axo-warn ' + (/ไม่พบ/.test(x.reason) ? 'axo-err' : '') + '">⚠️ ' + E(x.line.name) + ': ' + E(x.reason) + '</div>'; });
                if (Number(o.total) !== p.total) html += '<div class="axo-warn">⚠️ ยอดที่ลูกค้าเห็น ' + M(o.total) + ' · <b>ใช้ยอดจากระบบ ' + M(p.total) + '</b></div>';
            }
            html += '<div class="axo-tot"><span>ยอดค่าอาหาร' + (isNew ? ' (คิดจากเมนูในระบบ)' : '') + '</span><span>' + M(p.total) + '</span></div>';
            html += '<div class="axo-acts"><a class="axo-w" target="_blank" rel="noopener" href="' + E(replyLink(o, p.total)) + '">💬 ตอบลูกค้าทาง WhatsApp</a>';
            if (isNew) {
                if (p.missing.length) html += '<span class="axo-sm" style="align-self:center">มีรายการที่ไม่มีในเมนูแล้ว ให้คีย์เองที่หน้าแคชเชียร์ แล้วกด "ไม่รับ"</span>';
                else html += '<button class="axo-g" data-a="paid" data-id="' + E(o.id) + '">✅ รับเงินโอนแล้ว → เข้าครัว</button><button class="axo-b" data-a="unpaid" data-id="' + E(o.id) + '">เข้าครัว (ยังไม่จ่าย)</button>';
                html += '<button class="axo-x" data-a="reject" data-id="' + E(o.id) + '">✕ ไม่รับ</button>';
            } else if (live) {
                if (!o.paid && o.billId) html += '<button class="axo-g" data-a="pay" data-id="' + E(o.id) + '">💰 รับเงินโอนแล้ว</button>';
                if (dl) {
                    if (stage !== 'delivering') {
                        html += '<input type="number" inputmode="numeric" min="0" placeholder="ค่ารถจริง" data-fee="' + E(o.id) + '" value="' + E(feeDraft[o.id] || '') + '">' +
                            '<button class="axo-o" data-a="ship" data-id="' + E(o.id) + '">🛵 เรียกรถแล้ว / ส่งของ</button>';
                    } else html += '<button class="axo-g" data-a="ready" data-id="' + E(o.id) + '">✅ ส่งถึงแล้ว</button>';
                } else html += '<button class="axo-b" data-a="ready" data-id="' + E(o.id) + '">🔔 แจ้งลูกค้า: พร้อมรับ</button>';
            }
            if (o.trackTok) html += '<span class="axo-sm">หน้าติดตาม: <a target="_blank" rel="noopener" href="' + E(trackLink(o.trackTok)) + '">เปิดดู</a></span>';
            html += '</div></div>';
        });
        overlay.innerHTML = html + '</div>';
        overlay.scrollTop = keepScroll;
    }

    function replyLink(o, total) {
        var t = String(cfg.replyText || DEF_REPLY).replace(/\{name\}/g, o.name || '').replace(/\{bill\}/g, o.id).replace(/\{total\}/g, M(total))
            .replace(/\{link\}/g, o.trackTok ? trackLink(o.trackTok) : '');
        return 'https://wa.me/' + waDigits(o.phone) + '?text=' + encodeURIComponent(t);
    }

    function onAction(e) {
        var b = e.target.closest('[data-a]'); if (!b) return;
        var a = b.dataset.a, id = b.dataset.id, o = id && orders[id];
        if (a === 'close') return closePanel();
        if (!o || busy[id]) return;
        if (a === 'reject') {
            if (!confirm('ไม่รับออร์เดอร์ ' + id + ' ?')) return;
            database.ref('online_orders/' + id).update({ status: 'rejected', handledAt: Date.now() });
            setTrack(o, { status: 'rejected' });
            return;
        }
        if (a === 'paid' || a === 'unpaid') return accept(id, a === 'paid', b);
        if (a === 'pay') return payLater(id, b);
        if (a === 'ship') {
            var fee = Math.round(Number(feeDraft[id] || 0));
            if (!(fee > 0) && !confirm('ยังไม่ได้ใส่ค่ารถจริง จะใช้ค่าประมาณ ' + M(o.delivery.estFee) + ' ไปก่อน?')) return;
            fee = fee > 0 ? fee : Number(o.delivery.estFee || 0);
            var sp = feeSplit(o.delivery, fee);
            database.ref('online_orders/' + id + '/delivery').update({ actualFee: fee, shopPaid: sp.shop, custPaid: sp.cust, shippedAt: Date.now() });
            setTrack(o, { status: 'delivering', 'delivery/fee': fee, 'delivery/shopPays': sp.shop });
            delete feeDraft[id];
            say('แจ้งลูกค้าแล้ว: กำลังจัดส่ง' + (sp.cust ? ' · ลูกค้าจ่ายคนขับ ' + M(sp.cust) : ''));
            return;
        }
        if (a === 'ready') {
            setTrack(o, { status: 'ready' });
            database.ref('online_orders/' + id).update({ readyAt: Date.now() });
            say(o.delivery ? 'บันทึกแล้ว: ส่งถึงลูกค้าแล้ว' : 'แจ้งลูกค้าแล้ว: พร้อมรับ');
        }
    }

    async function accept(id, paid, b) {
        var o = orders[id];
        if (!o || o.status !== 'new') return;
        var p = priced(o);
        if (p.missing.length) return say('มีรายการที่ไม่มีในเมนูแล้ว', false);
        busy[id] = true; b.disabled = true; b.textContent = 'กำลังส่ง…';
        try {
            var items = p.lines.map(function (l) {
                var it = menu && menu.byId[l.itemId];
                return {
                    itemId: l.itemId, name: it ? it.name : l.name, variant: l.variant || '', price: l.unitPrice, quantity: l.qty,
                    modifiers: arrOf(l.options).map(function (x) { return { group: x.group || '', option: x.name, price: Number(x.price || 0) }; }),
                    note: l.note || '', cup: it ? (it.retail ? false : (raw.menu_items[l.itemId] || {}).usesCup !== false) : true
                };
            });
            var cust = findCust(o.phone);
            var r = await createBill({
                items: items, source: 'online', orderType: o.delivery ? 'Online 🛵' : 'Online', appOrderNo: id,
                customerName: o.name || '', customerPhone: o.phone || '', customerId: cust ? cust.id : '',
                trackTok: o.trackTok || '', trackDelivery: !!o.delivery
            });
            if (paid) await payBill(r.id, { discountType: 'amount', discountValue: 0, method: 'transfer', cashReceived: '' });
            await database.ref('online_orders/' + id).update({ status: 'accepted', billId: r.id, orderNo: r.bill.orderNo, paid: !!paid, handledAt: Date.now() });
            await setTrack(o, { status: 'accepted', paid: !!paid, total: p.total });
            if (!cust && o.phone) database.ref('customers').push({ name: o.name || '', phone: o.phone, email: '', source: 'online' });
            say('ออร์เดอร์ ' + id + ' เข้าครัวแล้ว (บิล #' + r.bill.orderNo + (paid ? ' · จ่ายแล้ว' : ' · ยังไม่จ่าย') + ')');
        } catch (err) {
            say('ไม่สำเร็จ: ' + (err && err.message || err), false);
        } finally { delete busy[id]; render(); }
    }

    async function payLater(id, b) {
        var o = orders[id];
        if (!o || !o.billId || o.paid) return;
        busy[id] = true; b.disabled = true; b.textContent = 'กำลังบันทึก…';
        try {
            await payBill(o.billId, { discountType: 'amount', discountValue: 0, method: 'transfer', cashReceived: '' });
            await database.ref('online_orders/' + id + '/paid').set(true);
            await setTrack(o, { paid: true });
            say('บันทึกรับเงินแล้ว · ลูกค้าเห็นสถานะ "ชำระแล้ว"');
        } catch (err) {
            say('ไม่สำเร็จ: ' + (err && err.message || err), false);
        } finally { delete busy[id]; render(); }
    }

    function findCust(phone) {
        if (typeof globalCustomers === 'undefined' || !phone) return null;
        var n = waDigits(phone);
        return globalCustomers.find(function (c) { return waDigits(c.phone) === n; }) || null;
    }
})();
