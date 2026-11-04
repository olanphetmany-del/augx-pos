# AUGUSTX

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Customers** in Vientiane ordering on their phones from augustxshop.com: coffee and matcha for pickup or delivery, and sneakers (in stock or pre-order). The customer UI is in Lao, with Thai and English available.
- **Staff** (the owner, usually working alone) running the shop on tablets: cashier, kitchen, shop orders and admin. The staff UI is in Thai.

## Product Purpose

One small shop with two sides, AUGUSTX HOME COFFEE and AUGUSTX SHOP & PRE-ORDER, sold through one storefront and run from one POS. Success means a customer can order and pay in a minute without messaging back and forth, and the owner can see, make and hand over every order without missing one.

## Positioning

A home coffee bar and a sneaker shop under one name. The storefront should feel like the shop's own streetwear voice, not a generic food-delivery or AI template.

## Operating Context

- Customers order on phones, often outdoors or on the move. Payment is by bank transfer: the shop sends a QR over WhatsApp and the order shows a countdown until it is paid.
- Delivery is pinned on a map; pickup is at the shop counter.
- Staff screens run on an Android tablet and an old iPad (iOS 12, Safari 12). Receipts and cup stickers print through RawBT on Android.

## Capabilities and Constraints

- Plain HTML/JS, no build step, served by GitHub Pages. One production Firebase Realtime Database.
- Old iPad (Safari 12): no flex `gap` without the `old-ios.js` polyfill, no `inset`, no `clamp()` without a fallback, no optional chaining or `??`.
- Every new UI string needs Thai, Lao and English in `i18n-dict.js`.
- Prices are in kip (₭); sneakers can be priced in baht (฿) with an approximate kip value.

## Brand Commitments

- Name: AUGUSTX (short form AUGX). Two sides: HOME COFFEE and SHOP.
- Colours stay in the shop's own range: navy, deep blue, white and grey.
- Customer copy is Lao and plain; it never claims anything the shop has not confirmed.

## Evidence on Hand

- Real menu items, prices, product photos and stock come from the database at runtime. Mockups must not invent claims, reviews or ratings.

## Product Principles

1. The order flow is a tool: the customer should always know what to tap next and what state their order is in.
2. The shop's voice shows in type, colour and one signature detail, never in decoration that slows ordering.
3. Works on the oldest device the shop uses before it looks good on the newest.
4. Lao first for customers, Thai first for staff.
