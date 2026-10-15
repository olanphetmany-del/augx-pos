/*
 * AUGUSTX — อ่านเมนูจาก Firebase ให้เป็นรูปแบบเดียว ใช้ร่วมกันระหว่างหน้าลูกค้า (order.html) และหน้า Cashier
 *
 * รองรับราคาได้หลายแบบ เช่น 35000, "35000", "M|35000, L|40000", [{name:'M',price:35000}], {M:35000}
 * ถ้าชื่อช่องในฐานข้อมูลจริงต่างจากที่เดาไว้ แก้ที่ FIELD ด้านล่างจุดเดียว
 */
(function (root) {
  'use strict';

  var FIELD = {
    name: ['name', 'title', 'nameEn', 'nameTh', 'nameLa'],
    price: ['priceOptions', 'prices', 'price', 'variants', 'sizes'],
    category: ['category', 'categoryId', 'cat', 'categoryName'],
    groups: ['modifierGroups', 'modifiers', 'modifierIds', 'modifierGroupIds'],
    image: ['image', 'img', 'photo', 'imageUrl'],
    sort: ['order', 'sort', 'position'],
    desc: ['description', 'desc', 'detail'],
    optList: ['options', 'items', 'choices', 'values'],
  };

  function pick(obj, keys) {
    if (!obj) return undefined;
    for (var i = 0; i < keys.length; i++) if (obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') return obj[keys[i]];
    return undefined;
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  // "label|price" หรือ "label:price" หรือ "price"
  function splitPair(s) {
    var m = String(s).trim().match(/^(.*?)\s*[|:]\s*([0-9][0-9.,]*)\s*$/);
    if (m) return { label: m[1].trim(), price: num(m[2]) };
    return { label: '', price: num(s) };
  }

  function parsePrices(raw) {
    if (raw == null || raw === '') return [{ label: '', price: 0 }];
    if (typeof raw === 'number') return [{ label: '', price: raw }];
    if (typeof raw === 'string') {
      var parts = raw.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
      return parts.length ? parts.map(splitPair) : [{ label: '', price: 0 }];
    }
    if (Array.isArray(raw)) {
      return raw.filter(Boolean).map(function (v) {
        if (typeof v !== 'object') return splitPair(v);
        return { label: String(pick(v, ['label', 'name', 'size', 'title']) || ''), price: num(pick(v, ['price', 'value', 'amount'])) };
      });
    }
    if (typeof raw === 'object') {
      return Object.keys(raw).map(function (k) {
        var v = raw[k];
        if (v && typeof v === 'object') return { label: String(pick(v, ['label', 'name', 'size']) || k), price: num(pick(v, ['price', 'value', 'amount'])) };
        return { label: k, price: num(v) };
      });
    }
    return [{ label: '', price: 0 }];
  }

  function parseOptions(raw) {
    if (raw == null) return [];
    if (typeof raw === 'string') return raw.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { var p = splitPair(s); return { name: p.label || s, price: p.label ? p.price : 0 }; });
    var list = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { var v = raw[k]; return (v && typeof v === 'object') ? Object.assign({ name: k }, v) : (typeof v === 'number' ? { name: k, price: v } : v); });
    return list.filter(Boolean).map(function (v) {
      if (typeof v !== 'object') { var p = splitPair(v); return { name: p.label || String(v), price: p.label ? p.price : 0 }; }
      if (v.available === false || v.active === false || v.hidden === true) return null;
      return { name: String(pick(v, ['name', 'label', 'title']) || ''), price: num(pick(v, ['price', 'value', 'amount']) || 0) };
    }).filter(function (o) { return o && o.name; });
  }

  function ids(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(function (v) { return typeof v === 'object' && v ? (v.id || v.key || v.name) : v; }).filter(Boolean).map(String);
    if (typeof raw === 'object') return Object.keys(raw).filter(function (k) { return raw[k]; });
    return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function isAvailable(raw) {
    return !(raw.available === false || raw.active === false || raw.isActive === false ||
      raw.hidden === true || raw.soldOut === true || raw.disabled === true || raw.deleted === true);
  }

  function normalizeGroup(id, raw) {
    raw = raw || {};
    var max = raw.max != null ? num(raw.max) : null;
    // AUGUSTX: กลุ่มที่ไม่ได้ติ๊ก "หลายตัวเลือก" (multi) = เลือกได้ 1 อย่าง
    var single = raw.type === 'multi' || raw.multiple === true ? false : !raw.multi;
    return {
      id: String(id),
      name: String(pick(raw, FIELD.name) || id),
      required: !!(raw.required || raw.min > 0),
      single: single,
      max: max,
      options: parseOptions(pick(raw, FIELD.optList)),
    };
  }

  function normalizeItem(id, raw, categoryNames) {
    raw = raw || {};
    var cat = pick(raw, FIELD.category);
    var catName = cat != null && categoryNames && categoryNames[cat] ? categoryNames[cat] : (cat == null ? '' : String(cat));
    var groupsRaw = pick(raw, FIELD.groups);
    return {
      id: String(id),
      name: String(pick(raw, FIELD.name) || ''),
      category: catName,
      variants: parsePrices(pick(raw, FIELD.price)),
      groupIds: ids(groupsRaw),
      image: pick(raw, FIELD.image) || '',
      desc: String(pick(raw, FIELD.desc) || ''),
      sort: num(pick(raw, FIELD.sort) || 0),
      available: isAvailable(raw),
      retail: raw.retail === true,        // ขายปลีก ไม่เข้าครัว
      preorder: raw.preorder === true,    // สินค้าสั่งจอง
      currency: raw.currency === 'THB' ? 'THB' : 'LAK', // ราคาตั้งเป็นบาท หรือ กีบ
      authentic: raw.authentic === true,  // รับประกันของแท้ (โชว์กล่อง "ເປັນຫຍັງໝັ້ນໃຈໄດ້")
      photos: Number(raw.photoCount || 0), // จำนวนรูปใหญ่ใน menu_photos/<id>
      color: String(raw.color || ''),     // สี/รายละเอียดรุ่น (รองเท้า)
      // ราคาพรีออเดอร์ (รองเท้า): ราคากลาง + ราคาเฉพาะเบอร์ · ว่าง = ສອບຖາມລາຄາ
      prePrice: raw.prePrice != null && raw.prePrice !== '' && isFinite(Number(raw.prePrice)) ? Number(raw.prePrice) : null,
      poPrice: raw.poPrice && typeof raw.poPrice === 'object' ? raw.poPrice : {},
      usesCup: raw.usesCup !== false,
      // ช่องทางที่ซ่อนเมนูนี้ เช่น "store,<partnerId>"
      hiddenChannels: String(raw.hiddenChannels || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
    };
  }

  // snapshot.val() ของแต่ละ node → เมนูพร้อมใช้
  function buildMenu(itemsVal, groupsVal, categoriesVal) {
    var catNames = {}, catOrder = {};
    Object.keys(categoriesVal || {}).forEach(function (k, i) {
      var c = categoriesVal[k];
      var name = typeof c === 'string' ? c : String(pick(c, FIELD.name) || k);
      catNames[k] = name;
      catOrder[name] = c && typeof c === 'object' && pick(c, FIELD.sort) != null ? num(pick(c, FIELD.sort)) : i;
    });
    var groups = {};
    Object.keys(groupsVal || {}).forEach(function (k) { groups[k] = normalizeGroup(k, groupsVal[k]); });
    var items = Object.keys(itemsVal || {}).map(function (k) { return normalizeItem(k, itemsVal[k], catNames); })
      .filter(function (it) { return it.name && it.available; });
    items.forEach(function (it) {
      it.groups = it.groupIds.map(function (g) {
        if (groups[g]) return groups[g];
        var byName = Object.keys(groups).filter(function (k) { return groups[k].name === g; })[0];
        return byName ? groups[byName] : null;
      }).filter(function (g) { return g && g.options.length; });
    });
    items.sort(function (a, b) { return a.sort - b.sort || a.name.localeCompare(b.name); });
    var categories = [];
    items.forEach(function (it) { if (categories.indexOf(it.category) < 0) categories.push(it.category); });
    categories.sort(function (a, b) { return (catOrder[a] != null ? catOrder[a] : 999) - (catOrder[b] != null ? catOrder[b] : 999); });
    var byId = {};
    items.forEach(function (it) { byId[it.id] = it; });
    return { items: items, categories: categories, byId: byId, groups: groups };
  }

  function sizeKey(v) { return String(v == null || v === '' ? 'one' : v).replace(/[.#$\/\[\]]/g, '_'); }
  // ราคาพรีออเดอร์ของไซส์นี้ (null = ยังไม่ตั้งราคา ต้องสอบถาม)
  function prePriceOf(it, label) {
    if (!it) return null;
    var k = sizeKey(label), p = it.poPrice && it.poPrice[k];
    if (p != null && p !== '' && isFinite(Number(p))) return Number(p);
    return it.prePrice != null ? it.prePrice : null;
  }

  // ราคาต่อหน่วยของ 1 รายการที่ลูกค้าเลือก คิดจากเมนูปัจจุบัน (ไม่เชื่อราคาที่ส่งมาจากมือถือลูกค้า)
  function unitPrice(menu, line) {
    var it = menu.byId[line.itemId];
    if (!it) return null;
    var v = it.variants.filter(function (x) { return x.label === (line.variant || ''); })[0];
    if (!v) { if (it.variants.length === 1 && !line.variant) v = it.variants[0]; else return null; }
    var total = v.price;
    if (line.po === true && (it.prePrice != null || Object.keys(it.poPrice || {}).length)) {
      var pp = prePriceOf(it, v.label);
      if (pp == null) return null;
      total = pp;
    }
    for (var i = 0; i < (line.options || []).length; i++) {
      var o = line.options[i], found = null;
      for (var g = 0; g < it.groups.length && !found; g++) {
        if (o.group && it.groups[g].name !== o.group) continue; // ชื่อตัวเลือกซ้ำกันได้ในคนละกลุ่ม
        found = it.groups[g].options.filter(function (x) { return x.name === o.name; })[0] || null;
      }
      if (!found) return null;
      total += found.price;
    }
    return total;
  }

  // ตรวจราคาทั้งรอบ: คืนรายการที่ราคาเชื่อถือได้ + รายการที่หาไม่เจอ/ราคาไม่ตรง
  function priceRound(menu, items) {
    var problems = [], total = 0;
    var lines = (items || []).map(function (line) {
      var p = unitPrice(menu, line);
      var qty = Math.max(1, Math.floor(num(line.qty) || 1));
      if (p == null) problems.push({ line: line, reason: 'ไม่พบเมนูหรือตัวเลือกนี้แล้ว' });
      else if (num(line.unitPrice) !== p) problems.push({ line: line, reason: 'ราคาเปลี่ยน ' + line.unitPrice + ' → ' + p });
      var unit = p == null ? num(line.unitPrice) : p;
      total += unit * qty;
      return Object.assign({}, line, { qty: qty, unitPrice: unit });
    });
    return { lines: lines, total: total, problems: problems };
  }

  function money(n) {
    return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  var api = { buildMenu: buildMenu, prePriceOf: prePriceOf, sizeKey: sizeKey, parsePrices: parsePrices, parseOptions: parseOptions, unitPrice: unitPrice, priceRound: priceRound, money: money, FIELD: FIELD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AugustxMenu = api;
})(typeof window !== 'undefined' ? window : globalThis);
