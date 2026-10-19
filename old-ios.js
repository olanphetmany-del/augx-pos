/* iPad / iPhone รุ่นเก่า (Safari ต่ำกว่า 14.1) ไม่รู้จัก gap ใน flex → ปุ่มและช่องต่างๆ ติดกัน
   ไฟล์นี้ตรวจว่าเครื่องรองรับไหม ถ้าไม่รองรับ จะเติมระยะห่างให้ลูกใน flex ด้วย margin แทน
   เครื่องใหม่ไม่ทำอะไรเลย */
(function () {
    'use strict';
    function hasFlexGap() {
        var d = document.createElement('div');
        d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
        d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div'));
        document.body.appendChild(d);
        var ok = d.scrollHeight === 1;
        d.parentNode.removeChild(d);
        return ok;
    }
    var SIDES = ['top', 'right', 'bottom', 'left'];
    function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    // ตั้ง margin ด้านที่กำหนด เฉพาะด้านที่ CSS เดิมเป็น 0 หรือเราเคยตั้งไว้เอง (ไม่ทับ margin ของหน้าเดิม)
    function setM(el, cs, want) {
        var mine = el.__fgap || {};
        SIDES.forEach(function (s) {
            var v = want[s] || 0, prop = 'margin-' + s;
            if (mine[s] == null && px(cs.getPropertyValue(prop)) !== 0) return;
            if (v) { el.style.setProperty(prop, v + 'px'); mine[s] = v; }
            else if (mine[s] != null) { el.style.removeProperty(prop); delete mine[s]; }
        });
        el.__fgap = mine;
    }
    function apply() {
        var all = document.body.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var box = all[i], cs = getComputedStyle(box);
            if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
            var cg = px(cs.columnGap), rg = px(cs.rowGap);
            if (!cg && !rg) continue;
            var dir = cs.flexDirection, wrap = cs.flexWrap !== 'nowrap', kids = [];
            for (var c = box.firstElementChild; c; c = c.nextElementSibling) {
                var ks = getComputedStyle(c);
                if (ks.display === 'none' || ks.position === 'absolute' || ks.position === 'fixed') continue;
                kids.push([c, ks]);
            }
            kids.forEach(function (k, n) {
                var w = {};
                if (dir === 'column' || dir === 'column-reverse') {
                    if (n > 0) w[dir === 'column' ? 'top' : 'bottom'] = rg;
                    if (wrap) w.right = cg;
                } else {
                    if (wrap) { if (n < kids.length - 1) w[dir === 'row' ? 'right' : 'left'] = cg; w.bottom = rg; }
                    else if (n > 0) w[dir === 'row' ? 'left' : 'right'] = cg;
                }
                setM(k[0], k[1], w);
            });
        }
    }
    var t = null;
    function later() { if (t) return; t = setTimeout(function () { t = null; apply(); }, 120); }
    function start() {
        if (window.AUGX_FORCE_FLEX_GAP_FIX !== true && hasFlexGap()) return;
        document.documentElement.className += ' no-flex-gap';
        apply();
        new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        window.addEventListener('resize', later);
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
