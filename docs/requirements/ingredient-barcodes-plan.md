# Ingredient Barcodes — Implementation Plan

Status: approved by the product owner, 2026-10-21 (revision 2, after senior review). Baseline: branch
`Barcode` at `acdd808f`.

The owner made four decisions on 2026-10-21:

- Scanning works in the ingredient editor, when receiving deliveries, on the stock screen (count,
  waste, adjust) and in the ingredient list search.
- When a receiver scans a barcode nobody has linked yet, **the receiver links it on the spot**. Anyone
  who may receive deliveries may link one, and every link is audited.
- Supplier lot `(10)`, expiry `(17)` and best-before `(15)` are captured on goods-receipt lines **in
  this build**.
- Input is handheld USB/Bluetooth scanners (keyboard wedge) **and** phone/tablet camera. The camera adds
  the `expo-camera` dependency.

Production batches already carry GS1-128 lot labels (D-145 to D-147). This plan reuses that work.
Today, ingredients carry no barcode: no `barcode`, `gtin` or `ean` column exists in any table. The only
barcode in the product is the Open Food Facts allergen lookup, which keeps the GTIN as evidence inside
`ingredient_allergens.lookup_source`, not as an identity.

## 1. Outcome

A kitchen can:

1. Attach a producer's barcode to an ingredient (EAN-8, UPC-A, EAN-13, or a GTIN-14 case code). The
   barcode can carry an optional pack size: "one scan of this code = 5 kg".
2. Generate a kitchen barcode for goods that arrive without one, such as loose produce or decanted bulk,
   and print it on 58×40 mm label stock.
3. Scan or type a code in the ingredient list to find the ingredient. On the stock screen, a scan opens
   that shelf's count, waste or adjust editor.
4. Receive a delivery by scanning. Each scan picks the right line and adds one pack. It also records the
   product's GTIN, the supplier lot and the expiry / best-before dates on the receipt line, and splits
   the line when a second lot or brand arrives.
5. Link an unknown barcode at the dock, without leaving the receive screen.
6. Answer the recall question "which deliveries brought supplier lot X".

## 2. Corrections from the senior review

The first draft was reviewed before approval. These changes are part of the approved plan:

1. Kitchen codes come from a **never-decreasing per-organisation counter**, not `MAX(gtin) + 1`.
   Otherwise, deleting the highest code would let the next one reuse a number that is already printed
   on a label (§4.2).
2. Order-mode receiving prefills every line with the outstanding quantity, so scanning needs **explicit
   scan counting**. A scan replaces an untouched prefill, adds to a scan-counted line, and never edits a
   quantity someone typed (§8).
3. Readiness checks **sum the drafts per `purchase_order_line_id`** before comparing them with the
   outstanding quantity. Two lots of 5 against 10 outstanding is neither short nor over (§8).
4. A pack adds to a line only when **the pack's unit equals that line's unit**. An order line can be
   quoted in another purchase unit, and the client has no unit ratios, so it never converts (§8).
5. **Forking an ingredient leaves its barcodes where they are.** A fork derives a new, empty shelf while
   balances and purchase orders stay on the source's shelf, so moving the barcodes would steer scans
   away from the stock. Stock continuity on fork is an open question (§11).
6. The camera passes the **symbology** with the data. The server expands UPC-E to UPC-A when the camera
   says the symbol was UPC-E (§5).
7. Receipt lines keep a **snapshot of the scanned GTIN**, and keep **expiry `(17)` and best-before
   `(15)` as separate fields**. A scan merges only into a line with an identical GTIN, lot and dates
   (§4.3, §8).
8. The parser **never splits a field heuristically**. A separator-free variable field read to the end of
   the scan is flagged as unverified, and the line needs a one-tap "lot checked" before it posts (§5).
9. Corrections:
   - the first kitchen code is `0400000000015`, not `…017`;
   - EAN-13 bars are 26 mm tall, not truncated;
   - scan results are cached by organisation + raw scan + symbology.

## 3. Barcode rules

These are the GS1 practices this design applies.

1. **A GTIN identifies a trade item at one packaging level, and the brand owner assigns it, not the
   distributor.** The same can carries the same GTIN whichever supplier sells it. So a barcode belongs
   to the ingredient plus a pack size, never to a supplier.
   - One ingredient has many GTINs, one per brand and per pack level.
   - A case code (GTIN-14 / ITF-14, indicator digit 1–8) is a different GTIN from the unit inside the
     case.
2. **One stored form: 14 digits, left-zero-padded, with the GS1 mod-10 check digit verified.** EAN-8,
   UPC-A, EAN-13 and GTIN-14 all land in one column under one unique index. A wrong digit is refused,
   never matched to the nearest code.
3. **Kitchen codes are GS1 Restricted Circulation Numbers with prefix `04`** (GTIN-13 range 040–049,
   reserved by GS1 for numbers used inside a company).
   - They are valid EAN-13s that any scanner reads, and they can never collide with a real product
     GTIN.
   - Format: `04` + a 10-digit counter value + check digit. The first one is `0400000000015`.
   - They print as EAN-13, the symbology an RCN-13 is carried in.
   - **A number, once issued, is never reissued**, because a printed label outlives its row.
4. **Codes that change from pack to pack are refused.**
   - This covers variable-measure items: GTIN-14 indicator `9`, and GTIN-13 prefixes `02` and `20–29`
     (weighed-item and store labels with an embedded weight or price).
   - The `04` range is reserved for kitchen codes, so it is refused as a supplier code.
   - Each refusal says what to do instead: for a weighed-item label, pick the item and type the weight;
     otherwise, make a kitchen barcode.
5. **Read every form a pack or scanner produces, and never guess a boundary (§5):**
   - bare digits;
   - AIM symbology prefixes (`]E0`, `]E4`, `]C1`, `]d2`, `]Q3`, `]I1`);
   - GS1-128 and GS1 DataMatrix element strings;
   - the human-readable `(01)…(10)…` form;
   - GS1 Digital Link URLs, the QR codes GS1's 2027 "Sunrise" programme is moving packs to.
6. **Dates keep their GS1 meaning.**
   - `(17)` is the expiry and `(15)` is best-before, and they are two separate fields.
   - In `YYMMDD`, a day of `00` means the last day of that month.
   - `YY` is read as 20YY.
7. **Traceability, "one step back".** Each receipt line records which product (GTIN) and which supplier
   lot arrived, from whom, when, and with which dates. "One step forward" (which batch used which
   supplier lot) needs lot-level stock and is a later phase (§11).
8. **Scanner-friendly input.**
   - Wedge scanners type the code and press Enter, the pattern the production register's scan field
     already uses.
   - Wedge scanners should be configured to send UPC-E as UPC-A. This is a standard scanner setting.
   - Scan results are cached on the client, so scanning thirty identical cases does not trip the API's
     60-per-minute throttle.

## 4. Domain and database design

### 4.1 `ingredient_barcodes` (Ingredients module)

| column                   | type                                   | notes                                      |
| ------------------------ | -------------------------------------- | ------------------------------------------ |
| `id`                     | uuid v7                                | `HasUuidV7Key`                             |
| `organisation_id`        | uuid NOT NULL → organisations, cascade | always the kitchen's own row               |
| `ingredient_id`          | uuid NOT NULL → ingredients, cascade   | may point at a **platform** ingredient     |
| `gtin`                   | char(14) NOT NULL                      | CHECK `^[0-9]{14}$`                        |
| `origin`                 | varchar(16) NOT NULL                   | CHECK `supplier` or `system`               |
| `pack_quantity`          | numeric(14,4) NULL                     | CHECK > 0; "one scan = this much"          |
| `pack_unit_id`           | → measurement_units NULL               | set together with `pack_quantity` or not at all |
| `created_by`, timestamps |                                        |                                            |

- **`UNIQUE (organisation_id, gtin)`.** Within a kitchen, a code means exactly one ingredient. Linking a
  code that is already taken returns a 409 naming the ingredient that holds it.
- **Partial unique `(organisation_id, ingredient_id) WHERE origin = 'system'`.** Each ingredient has at
  most one kitchen code, so generating one is idempotent.
- **`CHECK ((origin = 'system') = (gtin LIKE '004%'))`.** The `04…` range padded to 14 digits is
  `004…`, so the origin can never contradict the number.
- An index on `ingredient_id`.
- **ADR-0007.** The table is application-scoped through `BelongsToOrganisation`, without RLS. Its
  parents, `ingredients` and `stock_items`, are application-scoped too, so RLS on this child alone
  would add nothing. The migration docblock records this.
- **Platform ingredients.** A kitchen may attach barcodes to a platform-library ingredient: the barcode
  row is the kitchen's own, so platform-row immutability does not apply.
- **Pack sizes.** A pack size is stored as entered, for example `5 kg`. Its unit must be the
  ingredient's default unit, or convert to it through `UnitConversionService` (mass or volume).
  Package units such as bag, can or pack are refused.
- **Fork.** Forking an ingredient does not touch its barcodes (see §2.5). A test pins this, and moving a
  barcode is a manual remove and re-add.

### 4.2 `ingredient_barcode_counters` (Ingredients module)

The table has two columns: `organisation_id` (uuid primary key → organisations, cascade) and
`last_value` (bigint NOT NULL).

A kitchen code is minted by one statement inside the generate transaction:

```sql
INSERT INTO ingredient_barcode_counters (organisation_id, last_value) VALUES (?, 1)
ON CONFLICT (organisation_id) DO UPDATE SET last_value = ingredient_barcode_counters.last_value + 1
RETURNING last_value
```

- The row lock serialises concurrent mints.
- The counter only climbs, so deleting a kitchen code, or the ingredient that held one, never frees its
  number.
- A deleted kitchen label scans as a kitchen code with no link, and the screen says the label is no
  longer in use. It cannot be relinked as a supplier code, because the `04` range is reserved.
- The unique index on `ingredient_barcodes` remains the backstop.

### 4.3 `goods_receipt_lines` (Procurement, four new columns)

- `gtin char(14) NULL` holds the product that was scanned. Several brands can map to one ingredient,
  and lines that share a lot text but differ in GTIN must not merge.
- `supplier_lot varchar(20) NULL` holds AI `(10)`: at most 20 characters from the GS1 character set.
- `expires_on date NULL` holds AI `(17)`, or a typed expiry.
- `best_before_on date NULL` holds AI `(15)`, or a typed best-before.

When one item arrives in two lots or two brands in the same delivery, it becomes several lines. The
server already allows this: the index on `purchase_order_line_id` is not unique, and received
quantities are computed as sums.

## 5. Parsing

All parsing stays on the server, in one class: `Healthy360\Support\Identifiers\Gs1`
(`apps/api/app-modules/support/src/Identifiers/Gs1.php`). Support is a foundation module, so
Ingredients, Procurement and Production can all use it without a new module-registry edge.

- **`checkDigit()`** moves here from `ProductionOrderNumbers`. The old method delegates to it and keeps
  its signature.
- **`parse(scan, symbology)`** returns the GTIN (14 digits, or none), the element map (AI → value) and
  a `boundaryVerified` flag. It works as follows:
  - Any AIM `]Xn` prefix is stripped first.
  - **Bare digits.** Eight digits with symbology `upc_e` are expanded to UPC-A. Otherwise 8, 12, 13 or
    14 digits are read as GTIN-8, UPC-A, EAN-13 or GTIN-14. Either way the check digit must hold.
  - **Fixed-length AIs:**
    - `00` is 18 digits;
    - `01` and `02` are 14;
    - `11`, `13`, `15` and `17` are 6;
    - the 4-digit `31nn`–`36nn` measures are 6.
  - **Variable-length AIs** (`10`, `21`, `37`, `91`–`99`) run to a GS separator or to the end of the
    scan.
  - **Every value is validated:**
    - GTINs by their check digit;
    - dates by a real month and a day that is `00` or valid for that month;
    - `10` and `21` as 1–20 characters from GS1's character set.
  - An unknown AI, an invalid value or trailing data makes the whole scan unreadable.
  - **GS1 Digital Link.** The path is read as `/01/<gtin>[/10/<lot>]`, and the query as `15=` and
    `17=`.
- **Boundaries are never guessed.** Parentheses, a GS separator and Digital Link paths all mark
  boundaries explicitly.
  - When a variable-length AI is read to the end of a raw scan that has no separators and no
    parentheses, its end cannot be proven. `10ABC17261130` is equally `(10)ABC17261130` and
    `(10)ABC(17)261130`.
  - The parser takes GS1's literal reading (to the end), does not split, and reports
    `boundaryVerified = false`.
  - A value longer than its AI allows is unreadable, never trimmed.
- **`date()`** applies the `00`-day and 20YY rules.
- **Production lot lookup.** `ProductionOrderNumbers::lookupKey()` reads `(10)` through `parse()`. It
  keeps its own lot validation, so a swallowed tail still fails as it does today.

## 6. Permissions

No new permission is added. The route permission middleware takes a single code, so an endpoint that
two roles need gets two routes to one controller.

| Action                                               | Permission                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| List an ingredient's barcodes                        | `catalogue.view_organisation`                                                      |
| Add a supplier code, generate a kitchen code, remove | `org.trading` + `catalogue.manage_organisation`                                    |
| Link a supplier code while receiving                 | `org.trading` + `inventory.manage_organisation`; supplier codes only, no removal   |
| Resolve a scan (receiving, stock)                    | `inventory.view_organisation`                                                      |
| Search ingredients by code                           | the existing ingredient list route (`catalogue.view_organisation`)                 |

The audit recorder redacts any metadata key that contains `code`, and `barcode` contains it. Audit
metadata therefore uses the keys `gtin`, `origin`, `ingredient_id` and `pack_quantity`, and never
`barcode`.

## 7. API surface

OpenAPI comes first. The flow is: `apps/api/openapi/healthy360.v1.yaml` → `composer api:bundle` →
`pnpm gen:api`.

- **List and remove.** `GET /catalogue/ingredients/{ingredient}/barcodes` and
  `DELETE /catalogue/ingredients/{ingredient}/barcodes/{barcode}`, shaped like the existing alias
  routes.
- **Add.** `POST /catalogue/ingredients/{ingredient}/barcodes` takes either
  `{origin: "supplier", code, symbology?, pack_quantity?, pack_unit_code?}` or
  `{origin: "system", pack_quantity?, pack_unit_code?}`.
  - It returns 201, or 200 when the kitchen code already exists.
  - `409 barcode_taken` names the ingredient that holds the code.
  - `422 invalid_barcode` carries one of these reasons:
    - `unreadable`;
    - `check_digit`;
    - `variable_measure`;
    - `reserved`;
    - `not_a_product_code` (a scan with no GTIN in it).
- **Receiver's link.** `POST /catalogue/inventory/ingredient-barcodes` takes
  `{ingredient_id, code, symbology?, pack_quantity?, pack_unit_code?}`. It runs the same controller with
  the supplier origin forced.
- **Scan.** `GET /catalogue/ingredient-barcodes/scan?code=<raw>&symbology=<camera type>` returns
  `{gtin, supplier_lot, expires_on, best_before_on, boundary_verified, origin_hint, link}`.
  - `link` is null, or `{id, ingredient_id, name_en, name_ar, origin, pack_quantity, pack_unit_code}`.
  - A readable code nobody has linked returns 200 with `link: null`. An unreadable or refused code
    returns `422 invalid_barcode`.
  - The path sits beside `/ingredients`, so it can never collide with `{ingredient}`.
- **Search.** On `GET /catalogue/ingredients?query=`, when the query parses to a GTIN, the search also
  matches the ingredients that hold that code in this organisation. The existing search box then works
  with a scanner, with no screen change.
- **Receiving.** `POST /catalogue/procurement/goods-receipts` accepts four new optional fields on each
  line:
  - `gtin`, with its check digit validated;
  - `supplier_lot`, at most 20 characters;
  - `expires_on`;
  - `best_before_on`.

  The four fields are echoed wherever receipt lines are presented.
- **Recall.** `GET /catalogue/procurement/goods-receipts?supplier_lot=` answers which deliveries brought
  a lot.

## 8. Frontend and print UX

### Shared pieces

- **EAN-13 renderer** (`kitchen-admin/ean13-barcode.tsx`). It draws the L/G/R module tables, first-digit
  parity and the guard bars.
  - It shares the module-to-SVG drawing code with the existing production GS1-128 renderer, and like
    that renderer it is web-only.
  - The module width is 0.375 mm (3 dots at 203 dpi, 114 % of nominal), and the bars are 26 mm tall,
    GS1's 22.85 mm scaled to that width and not truncated.
  - Quiet zones are 11 modules on the left and 7 on the right, so the symbol is about 42.4 × 26 mm.
  - Module width and bar height are the calibration constants once a printer is chosen.
- **Camera scan button** (`kitchen-admin/camera-scan-button.tsx`).
  - It lazy-loads `expo-camera`, so desk users never download it, and asks for camera permission.
  - It opens a dialog holding the camera, which reads EAN-13, EAN-8, UPC-A, UPC-E, Code 128, ITF-14,
    DataMatrix and QR.
  - It closes on the first read and hands `{data, symbology}` to the same callback the wedge path uses.
    The wedge path passes no symbology.
  - On the web, the camera needs HTTPS (or localhost).
- **Catalogue toolbar.** It gains an optional `onScan` that shows the camera button beside the search
  field.
- **API client.** It gains contracts, repositories and hooks, plus a GTIN formatter that shows 13
  digits.
  - Scan results are cached under `[organisationId, 'ingredient-barcode-scan', raw, symbology]`, never
    under the GTIN alone, because the lot and dates live in the raw scan.
  - Linking, removing, generating and forking clear that cache.

### Ingredient editor

The editor gets a new barcodes section:

- It lists codes with an origin badge ("Supplier" or "Kitchen") and the pack size.
- To add a code, you scan or type it, with an optional pack quantity and unit. The unit defaults to the
  ingredient's default unit.
- "Make a kitchen barcode" appears only when the ingredient has none. The kitchen code gets a "Print
  label" action.
- The section works on platform ingredients, whose own fields stay read-only. It also works on
  packaging, which reuses this editor.

### Label

The label is a new route, `/kitchen/ingredients/[ingredient]/label`. It shows the ingredient name in the
session language, the EAN-13, its digits, and a copies field.

- It reuses the production label's print sheet, copy rules and 58×40 mm `@page`, so one label stock is
  configured once.
- The layout is one name line (about 3 mm), 26 mm of bars, and the digits (about 3 mm). With margins,
  that is roughly 35 mm of the 40 mm label. The name is truncated to one line.
- If a printer's real margins break the layout, the knob is the module width, never a shorter bar.

### Stock screen

A wedge scan or camera scan resolves the code, finds the shelf and opens its editor (count, waste,
adjust).

- The shelf is the stock item whose `ingredient_id` matches, preferring the ingredient's own shelf over
  a product shelf.
- An unknown or retired code shows a message.

### Ingredient list

The list gains the camera button. Wedge scans already work through the server-side search (§7).

### Receiving

These rules live in `receive-delivery-model.ts`, so the market-purchase and receive-against-order
screens share them.

- **New draft fields.** Each line draft gains:
  - `gtin`, `supplierLot`, `expiresOn` and `bestBeforeOn`;
  - `quantitySource`, which is `prefill`, `typed` or `scanned`;
  - `lotConfirmed`.

  Typing in a quantity box sets `typed`.
- **Scan to draft.**
  1. Resolve the code and find the shelf, using the stock-screen rule.
  2. Look for a scan-counted draft on that shelf, and in order mode on that order line, with the
     identical GTIN, lot, expiry and best-before. If there is one, add one pack to it.
  3. Otherwise, in order mode, an untouched prefilled draft on that order line is **converted**:
     - its quantity becomes one pack; the outstanding prefill is dropped, never added to;
     - it is marked `scanned`;
     - it takes the scan's GTIN, lot and dates.
  4. Otherwise, add a new scan-counted draft holding one pack. In order mode it copies the order line,
     its unit and its unit price.
  5. A typed quantity is never edited by a scan. The scan lands on its own draft, and the grouped check
     below flags any double count.
  6. When the lot matches but the dates differ, the scan becomes a new draft with a notice. Nothing is
     merged silently.
- **One pack** is the barcode's pack quantity, but only when its unit equals the draft's unit. That is
  the shelf's unit in market mode, and the order line's unit in order mode. Otherwise, or with no pack
  size, the draft is scan-counted with an empty quantity, and focus goes to it.
- **Unverified lots.** A scan with an unverified boundary shows a warning on its lot field. The draft
  cannot post until "lot checked" is ticked or the lot is edited.
- **Unknown codes** open "Link this barcode": pick an ingredient-backed shelf, optionally give a pack
  size, then save. The scan re-runs automatically.
  - A retired kitchen code gets its own message.
  - A weighed-item label gets its own message.
- **Readiness** sums the drafts of each order line before comparing them with the outstanding quantity,
  all in the order line's unit. Unplanned extra items stay per-line. Submitting also requires every
  unverified lot to be confirmed.
- **The request** carries `gtin`, `supplier_lot`, `expires_on` and `best_before_on` whenever they are
  set.
- **Display.** Lot, expiry and best-before appear wherever delivery lines are already listed: order
  detail deliveries and the purchases ledger. The goods-receipt list gains a lot filter.

### Language

All strings go through the `en`, `ar` and `en-XA` catalogues. Digits under RTL are isolated, as on the
production label.

## 9. Implementation slices

| Slice | Backend                                                                                                                                              | Frontend                                                                                                                                   | Exit condition                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| S0    | This document                                                                                                                                        | —                                                                                                                                          | Document committed                                                     |
| S1    | `Gs1` in Support; Production delegates to it                                                                                                         | —                                                                                                                                          | `Gs1Test` and production number tests written                          |
| S2    | `ingredient_barcodes`, `ingredient_barcode_counters`, model, barcode service (link, generate, remove, resolve), controllers, both routes, search, OpenAPI | —                                                                                                                                      | Pest for every rule in §3–§4, cross-organisation isolation             |
| S3    | Receipt-line `gtin`, `supplier_lot`, `expires_on`, `best_before_on`; validation; presenter; `?supplier_lot=`; OpenAPI                                | —                                                                                                                                          | Pest: two lots and two GTINs on one order line; recall filter          |
| S4    | `composer api:bundle`, `pnpm gen:api`                                                                                                                | API client and hooks, EAN-13 renderer, editor barcodes section, label route, print CSS, strings                                            | Jest: EAN-13 vector `4006381333931`, section, label                    |
| S5    | —                                                                                                                                                    | `expo-camera`, camera scan button, toolbar `onScan`, stock and ingredient-list scanning                                                    | Jest with `expo-camera` mocked                                         |
| S6    | —                                                                                                                                                    | Receive model (scan rules, grouped readiness, lot confirmation), both receive screens, link dialog, lot and dates on lines, ledger, order detail | Jest: a model test per scan rule; both screens                    |
| S7    | Registers: decisions, data register, module-registry descriptions, open questions, risks                                                             | —                                                                                                                                          | `pnpm i18n:check`, `pnpm gen:api:check`                                |

- The order is S1 → S2 → S3 → S4. S2 and S3 share the OpenAPI file, and S4 regenerates the client from
  it.
- S5 and S6 depend on S4.
- Durable decisions are numbered in the register only after this plan is approved, in S7.

## 10. Verification

Tests run once, at the end of the build.

- **Migrations** are applied with `php artisan migrate --database=pgsql_migrations`.
- **Pest, parser:**
  - check digits, including `040000000001` → 5;
  - 8/12/13/14-digit normalisation;
  - UPC-E expansion;
  - AIM prefixes;
  - separators, parentheses and Digital Link reported as verified;
  - `0105012345678900` + `10ABC17261130` read as lot `ABC17261130`, unverified and not split;
  - a lot over 20 characters is unreadable;
  - a bad month or day is unreadable;
  - the `00` day;
  - every refusal reason.
- **Pest, ingredient barcodes:**
  - create, read and delete;
  - the 409;
  - idempotent generation;
  - a new number after the highest code is deleted;
  - a link on a platform ingredient;
  - fork leaves barcodes on the source;
  - the receiver route is limited to supplier codes;
  - cross-organisation isolation;
  - search by code.
- **Pest, receiving:**
  - the four new fields round-trip;
  - two lots and two GTINs on one order line;
  - the lot filter.
- **Pest, existing suites:**
  - production number and production API;
  - the OpenAPI contract;
  - seeder idempotency.
- **Jest, receive model:**
  - the first scan converts a prefill rather than adding to it;
  - a typed quantity is untouched by a scan;
  - a scan with the same key adds a pack;
  - a different lot, GTIN or date makes a new draft;
  - a unit mismatch leaves the quantity empty;
  - two lots of 5 against 10 outstanding is neither short nor over;
  - two lots of 6 is an over-receipt;
  - an unverified lot blocks submission until confirmed.
- **Static checks:** `pnpm check`, `pnpm i18n:check`, `pnpm gen:api:check`, Pint and PHPStan.
- **Browser pass:**
  - generate a kitchen code on a platform ingredient, print it, delete it, generate again, and confirm
    the new number differs;
  - a supplier EAN with a wrong check digit is refused, and with the right one it is saved;
  - search the ingredient list by code;
  - scan into the stock screen;
  - at order receiving:
    - the first scan replaces the prefill;
    - a second lot splits the line;
    - an unverified lot blocks posting until ticked;
    - an unknown code is linked;
    - a weighed-item label is refused.
- **The owner's physical check:**
  - a handheld scanner on a printed kitchen label and on a real supplier pack;
  - a phone camera on both, over HTTPS on the test instance, including a UPC-E pack if one is to hand.

## 11. Later phases and open questions

- **Open question: fork and stock continuity.** A fork gets a new, empty shelf while balances and
  purchase orders stay on the source's shelf. This predates barcodes. The intended inventory
  relationship is decided first; moving barcodes on fork follows from that answer.
- **One step forward.** This means lot-level stock: FEFO consumption, a lot on each stock movement, and
  which production batch used which supplier lot. It is what turns captured expiry dates into
  trustworthy "expiring soon" alerts.
- **Resold products and production labels.** Barcodes for resold products (catalogue items), and a
  `(01)` GTIN on production batch labels (noted in D-146).
- **Catch-weight quantities.** Reading a GS1-128 `(310n)` net weight to fill catch-weight quantities.
- **Open Food Facts.** Saving the GTIN after a confirmed Open Food Facts allergen lookup, and running
  that lookup for a newly linked code.
- **Client-side unit conversion.** This would let a pack add to a line quoted in another unit of the
  same dimension. It needs unit dimensions and ratios exposed to the client.

## Sources

- [GS1 prefixes — 040–049 restricted circulation within a company](https://biip.readthedocs.io/stable/reference/gs1_prefixes/)
- [GS1 Application Identifiers](https://ref.gs1.org/ai/)
- [GS1 Syntax Dictionary](https://github.com/gs1/gs1-syntax-dictionary)
- [GS1 GTIN decision support — pack and case quantity](https://gs1.org/en/standards/id-keys/gtin/gtin-decision-support-tool/packcase-quantity)
- [GS1 Canada — what a GTIN-14 is and how to use it](https://gs1ca.org/documents/standards/GS1CA-What-is-GTIN-14-and-How-to-Use-it-EN.pdf)
- [GS1 Ireland — EAN-13 dimensions](https://www.gs1ie.org/standards/data-carriers/barcodes/ean-13/)
- [AI (10) lot numbers and one-up / one-down traceability](https://sgsystemsglobal.com/?p=16879)
- [expo-camera v57 — `onBarcodeScanned`](https://docs.expo.dev/versions/v57.0.0/sdk/camera/#onbarcodescanned)
