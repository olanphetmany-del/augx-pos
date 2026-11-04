---
name: AUGUSTX
description: Streetwear-voiced storefront and POS for a home coffee bar and sneaker shop in Vientiane
colors:
  navy-ink: "#14284B"
  harbor-blue: "#1B74C8"
  concrete: "#F2F3F5"
  paper: "#FFFFFF"
  slate: "#596377"
  hairline: "#D3D7DF"
  ok: "#15803D"
  bad: "#B42318"
  whatsapp: "#128C4A"
  dark-ground: "#0B1424"
  dark-surface: "#13203A"
  dark-ink: "#E8EDF6"
  dark-blue: "#5AA2EE"
typography:
  display: "Big Shoulders Display"
  body: "Barlow, Noto Sans Lao, Noto Sans Thai"
---

# Design System: AUGUSTX

## Overview

**Creative North Star: "The shoebox label"**

The storefront borrows its voice from a sneaker shop: tall condensed capitals for product names, prices set inside a ruled box like the label on the end of a shoebox, and a flat, high-contrast page with no gradients or glows. The coffee side and the shop side share one system; only the content changes.

It is a working screen first. Ordering, paying and tracking follow the patterns customers already know (tabs, lists, bottom sheets, a cart bar); the brand lives in type, colour and the price label.

**Key Characteristics:**
- Navy ink on cool concrete grey, white sheets, one deep blue accent.
- Condensed display capitals for Latin product names, prices and the logo; Lao text stays in Noto Sans Lao.
- Square corners and 1.5px ruled borders instead of rounded cards and shadows.
- Prices inside a ruled label box.

## Colors

A cool, mostly monochrome navy palette with one blue accent.

### Primary
- **Navy Ink** (#14284B): text, the logo, primary buttons, the cart bar, selected chips, completed tracking steps.

### Secondary
- **Harbor Blue** (#1B74C8): the accent. The active tab underline, the current tracking step, PRE-ORDER marks, links and focus rings. White text on it passes 4.5:1.

### Neutral
- **Concrete** (#F2F3F5): page background.
- **Paper** (#FFFFFF): bottom sheets, inputs, option buttons.
- **Slate** (#596377): secondary text, unselected tabs.
- **Hairline** (#D3D7DF): row dividers and resting borders.

### Status
- **OK** (#15803D) for paid and in stock, **Bad** (#B42318) for unpaid, errors and the payment countdown, **WhatsApp** (#128C4A) only on WhatsApp buttons.

### Dark mode
Ground #0B1424, surfaces #13203A, ink #E8EDF6, accent #5AA2EE. Same roles, same rules.

### Named Rules
**The One Accent Rule.** Harbor Blue marks where the customer is or what needs attention. It is never a background for large areas.

**The No Gradient Rule.** No gradients, glows or coloured shadows. Depth comes from the scrim behind sheets and from ruled borders.

## Typography

**Display Font:** Big Shoulders Display (with Barlow Condensed, Arial Narrow)
**Body Font:** Barlow (with Noto Sans Lao, Noto Sans Thai, system-ui)

**Character:** Tall, tight shop-sign capitals for names and numbers, against a plain readable body face.

### Hierarchy
- **Logo** (900, 56–64px, line-height .85): AUGUSTX in the header.
- **Product name** (800, 22–27px, uppercase, line-height 1): Latin item names in the menu and sheets.
- **Price** (800, 22px, tabular numerals): inside the price label.
- **Section heading** (700, 20–22px, Noto Sans Lao): category names.
- **Body** (400–600, 15px, line-height 1.5).
- **Label** (700, 12–13px): field labels, badges, the currency line under a price. Never below 11px.

### Named Rules
**The Lao Stays Lao Rule.** Display capitals are for Latin names and numbers only. Lao headings use Noto Sans Lao at weight 700–800 with line-height ≥1.2; never force Lao into the condensed face.

## Layout

One phone-width column (max 560px). 16–20px side margins. Menu items are full-width rows separated by hairlines, not cards. Steps happen in bottom sheets over a dark scrim; the cart bar is pinned to the bottom. Tracking is a full screen with a big status line, the bill number in a label box, and a vertical step list.

## Elevation & Depth

Flat. The only shadow is under the bottom sheet and the floating cart bar (`0 -8px 30px rgba(0,0,0,.18)`), to separate them from the page beneath.

## Components

- **Price label:** right-aligned price in display numerals inside a 1.5px navy box, with the currency or "from" line underneath in 12px.
- **Add button:** 40px navy square with a white plus.
- **Tabs (coffee / shop):** two text tabs on a 1.5px navy rule; the active one gets a 5px Harbor Blue bar.
- **Category chips:** plain text; the active one is navy and underlined.
- **Options and sizes:** white boxes with a hairline border; selected gets a 1.5px navy inset ring. PRE-ORDER sizes show the label in Harbor Blue; sold-out sizes are grey and struck through.
- **Primary button:** navy block, white text, square corners, label on the left and amount on the right.

## Do's and Don'ts

- Do keep the order flow, controls and wording customers already know.
- Do test on Safari 12 (old iPad) before shipping staff screens.
- Don't use emoji as icons in new work; use simple SVG strokes.
- Don't add gradients, glass, glows, rounded pill cards or letter avatars.
