# Components — one part per job, one place for each

Applies to every new screen, every redesign, and every canvas board. Agreed 2026-11-26.

## Where a part lives

| Kind of part                                                                                         | Lives in                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Colours, fonts, sizes, radii                                                                         | `packages/design-tokens`                   |
| **Any control or part used on more than one page** — field, dropdown, button, tab, chip, table, menu | **`packages/design-system/src/<family>/`** |
| A bigger block that needs routing or data (page hero, sign-in frame)                                 | `apps/universal/src/ui/`                   |
| Something only one page uses                                                                         | that feature's folder                      |

- **Never start a "kit" folder inside a feature** (`features/*/…-kit/`). That is how `desk-kit/` grew a
  second copy of the design system; every part of it was moved out and the folder deleted on
  2026-11-26. **Never recreate `desk-kit/`.**
- An "admin only" part still goes in the design system. Admin vs shop is a **look**, not a second
  component: `AreaLookScope look="desk"` is set once in the `app/kitchen`, `app/corporate` and
  `app/platform-admin` layouts (and on the admin `/showcase-*` routes), and every part reads it
  with `useAreaLook()`. A new family reads this same switch — never add a scope of its own.

## Before building anything

1. Look at **`/showcase-components`** (`apps/universal/src/screens/components-showcase-screen.tsx`).
   If the part is there, use it — do not restyle it on the page.
2. If it is not there, build it **in `packages/design-system`**, add a section for it to
   `/showcase-components`, and add its test — all in the same commit.
3. A change of shape, size or font is made **once, in the design system** (fields:
   `inputFrameClassName` in `forms/text-input.tsx`; sizes: the tokens), never per page.

## Dropdowns — the one `Select`

Every list where the reader **picks a value** is `Select` from `@healthy360/design-system`:

| Job                                   | How                                               |
| ------------------------------------- | ------------------------------------------------- |
| A form field (Unit, Supplier)         | `<Select label value options onChange />`         |
| A toolbar filter ("Slot All ⌄")       | `trigger="pill"` with a `value`                   |
| An action pill ("Add an ingredient…") | `trigger="pill"` `value={null}` `placeholder="…"` |

Do **not** pass `look`, `searchable` or `width` unless a page truly needs the other answer. The part
decides by itself:

- the admin card look comes from the area (`AreaLookScope look="desk"`);
- the filter box appears past 8 options (`SEARCH_THRESHOLD`), and always on a list with
  `noResultsAction` (add what was typed);
- a field whose options are all a few letters (kg / L / Pc) draws narrow.

Not dropdowns, and not `Select`: a row's actions (`⋯`) are `RowMenu`, and Show columns is
`ColumnPicker` (both under Tables).

**Removed, never recreate:** `DeskSelect`, `DeskPicker`, `LensScope`. `PeriodScope` (design system) and
the Orders page's own `SlotScope` are presets that draw `Select` inside — fine to use, not a pattern to
copy.

## Buttons — `Button` and `IconButton`

Every button is `Button` (a label) or `IconButton` (a glyph) from `@healthy360/design-system`. Under
the admin look they draw the canvas pills by themselves — do not restyle them with `className`.

| Job                                        | `variant`                        |
| ------------------------------------------ | -------------------------------- |
| The one lifted action (New order, Save)    | `primary` (default) — glows      |
| A real alternative (Pause kitchen, Export) | `secondary`                      |
| A link-weight word (Clear filters)         | `quiet` (`ghost` draws the same) |
| A row's next step (Mark delivered)         | `next`                           |
| Destructive confirm in a dialog            | `danger`                         |
| Destructive among others (Cancel order)    | `dangerOutline`                  |
| On a dark band                             | `inverse` / `inverseOutline`     |

`size`: `sm`/`md` are the 34px toolbar pill, `lg` the 44px pill a panel ends in. A disabled
`primary`/`danger` draws grey on its own; `loading` sweeps. `IconButton variant="secondary"` is the
round bordered ‹ › ✕; `variant="ghost"` is the flat glyph a table row carries; `round` is the top
bar's own size.

A special button (Pause kitchen, Staff alerts, Camera scan) is built **from** `Button` /
`IconButton`, never from a hand-made `Pressable`.

**Removed, never recreate:** `DeskButton`, `DeskIconButton`.

## Labels, tick boxes and choices

| Job                                                      | Part                                             |
| -------------------------------------------------------- | ------------------------------------------------ |
| A status or count on a record (To confirm, Late, 5)      | `Badge` with a `tone`; `size` sm / md / lg       |
| A record's state in a list's status column (● Published) | `Badge variant="dot"` with a `tone`              |
| An allergen or diet word under a name (shop cards)       | `Tag`                                            |
| A tick with its words                                    | `Checkbox`                                       |
| A tick in a table row or header                          | `Checkbox labelHidden` (+ `mixed` for "some")    |
| One of a set ticked as a card (diets, sales channels)    | `Checkbox shape="card"` (`description` = line 2) |
| A setting that applies where it stands                   | `Switch`                                         |
| One of a few short choices (days, slots, 2×)             | `ChoiceChips` (made of `FilterChip`)             |
| One choice with a detail, in a pop-up (driver, reason)   | `ChoiceRow` (`mark` avatar / radio / check)      |

The admin look of each comes from `AreaLookScope`. On `Checkbox` the pressable box is
`<testID>-control`; the bare `testID` is its wrapper.

**Removed, never recreate:** `DeskStatusDot` (now `Badge variant="dot"`), `DeskChip`, `DeskCheckbox`, `DeskToggleTile`, `DeskChoiceChips`, the
desk-kit `ChoiceRow`, and the kitchen-admin `CountPill` copies.

## Tabs — `Tabs` in two looks

The admin uses `Tabs` from `@healthy360/design-system` in **two looks only**:

| Job                                                          | How                                        |
| ------------------------------------------------------------ | ------------------------------------------ |
| A page's views (Orders: Today / Calendar / All orders, Cash) | `variant="strip"` — counts in amber        |
| A mode inside a toolbar or form (Month / Week, Read as)      | `variant="segmented"` (`SegmentedControl`) |
| A value picked (payment method, Open / Closed)               | `segmented` + `radio` (+ `block`)          |
| Icons only (list / cards)                                    | `segmented` + `radio` + `labelHidden`      |

A row of picked values (`radio`) and a read-only step row grow from their words' width to fill
their space and never shrink below a word — never pass a width to stop them squeezing.

`underline` is the web shop's; `steps` is the older numbered look. Do not use them on a new admin
page.

## Steps — `Tabs` pills and `StatusSteps`

| Job                                                   | How                                                      |
| ----------------------------------------------------- | -------------------------------------------------------- |
| A form's sections you click between (recipe, receipt) | `Tabs variant="pills"` (+ `detail`, `done`, `issues`)    |
| Where the reader is, not clickable (New order 1·2·3)  | `Tabs variant="pills" readOnly`                          |
| How far a record has got (order, supply order, quote) | `StatusSteps` — bars with dates; `trailing` for a button |

**Removed, never recreate:** `ProcessSteps`, `SaleSteps`, the order pop-up's `StageTrack`,
`RecordSteps`, and the unused `editor-steps.tsx` wrapper.

**Removed, never recreate:** `DeskTabs`, `LensViewSwitch`.

## Dates — the one `DatePicker`

Every day picked in the admin is `DatePicker` from `@healthy360/design-system`. It always opens the
same small month (other months faded, today ringed, the chosen day filled, `marked` days dotted).

| Job                                        | How                                                           |
| ------------------------------------------ | ------------------------------------------------------------- |
| A toolbar's day (Orders day, a sale's day) | `trigger="pill"` + `valueLabel` ("Today · Thu, Nov 26")       |
| A toolbar's From / To                      | `trigger="pill"` + `min` / `max`; `onClear` if it may be open |
| A pill with its name above it (Due on)     | `trigger="pill"` `labelVisible`                               |
| A form's date (Received on, Expires)       | `trigger="field"` (default) — Today under the month           |
| A date a form may leave empty              | pass `onClear` — that is what adds Clear                      |

The web shop keeps `DateField`. Times are `TimeField`.

**Removed, never recreate:** `MiniMonthPicker`, `DeskDateButton`, `DeskDateField`,
`DatePickerButton`, and the admin's `DateField` / `PickerField kind="date"` uses.

## Tables — the one `DataTable`

Every admin table is `DataTable` from `@healthy360/design-system`. It draws the rows through
`DataList`, which a page never uses on its own.

| Job                                                     | How                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A list of records (Ingredients, Orders, Suppliers)      | `<DataTable columns rows rowKey label rowActions />` — pages past 18                         |
| A list the screen pages on the server                   | the same, plus `TablePager` under it (`TABLE_PAGE_SIZE`)                                     |
| A form's own lines (recipe lines, an order's items)     | `<DataTable lines … />` — every row, every width, no pager                                   |
| A line with a problem, or added since the list was read | `lines` + `rowTone` (`danger` / `new`) and `rowNote` under it                                |
| A row's picture                                         | the title column's `thumbnail(row, shape)` draws it (`RowThumbnail`)                         |
| A row's actions (`⋯`)                                   | `rowActions` on `DataTable`; a hand-drawn row uses `RowMenu` itself                          |
| Show columns (▦ 6 of 6 ⌄) and header sort / filter      | `useColumnControls(rows, columns, id)` → `ColumnPicker {...picker}` + its `columns` / `rows` |

The column spec is `DataTableColumn` (`role`: title / status / metric / meta / actions, which is
what a row becomes on a phone). Columns are dropped by `priority` when the page is narrow, never
scrolled away; a column that must stay says `UNDROPPABLE_PRIORITY`.

Not tables: a printed sheet (technical sheet, print sheets) and the web shop's `Table`.

**Removed, never recreate:** `CatalogueList`, `CatalogueListItem`, `CatalogueListBody`,
`CataloguePager`, `catalogue-column-spec.ts`, and the price list's hand-drawn `role="table"` grid.

The row menu is `RowMenu` alone — a `⋯` that turns soft green while open (`IconButton pressed`).
**Removed, never recreate:** `RowActionsMenu`, `DeskRowMenu`, and `DataTable`'s `rowActionsLook`.

`ColumnPicker` opens one window of check rows from a `PillTrigger` (the toolbar's ⌄ pill); the
headers' sort and filter menus are `ColumnHeader`, drawn by `useColumnControls`. **Removed, never
recreate:** `DeskColumnPicker`, `DropTrigger`, `CatalogueColumnHeader`.

## Toolbars — the one `LensBar`

Every admin list or report opens with `LensBar` from `@healthy360/design-system`: the figures as chips
on the page with the actions at their end, the mix on the card's top edge, and the query row as the
top of the list's card. There is one look; there is no `layout` to pick.

| Job                                                           | How                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| A list's opening (Ingredients, Orders, Suppliers)             | `<LensBar figures mix actions search tokens result />`              |
| The list under it closes the card                             | `joined` on both the `LensBar` and the `DataTable`                  |
| A report with no search (Activity, Cash report)               | `figures={[]}` + `scope` — the empty figures row is left out        |
| A period before From / To                                     | `PeriodScope` in `scope`, then two `DatePicker` pills               |
| A camera scan beside the search                               | `scanAction={<CameraScanButton … />}` (`ui/camera-scan-button.tsx`) |
| Counts with no list under them (kitchen home, a bill's facts) | `FigureChips` (`fill` for an even row)                              |

**Removed, never recreate:** `CatalogueToolbar`, `ToolbarPanel`, `ListToolbar`, `CatalogueStatCards`,
`StatTile`, the unused `TodayCard`, and `LensBar`'s one-panel `layout="bar"`. The web shop keeps its own
`toolbar-row.tsx`.

## Page openings — the one `PageHeader`

An editor, a record or a settings page opens with `PageHeader` from `@healthy360/design-system`: a
24px bold title, the record's status beside it (`titleAside`), and the actions at the row's end. A
list page has none — its `LensBar` is its opening. Neither draws a breadcrumb: the top bar's trail
names the page.

| Job                                        | How                                           |
| ------------------------------------------ | --------------------------------------------- |
| An editor (recipe, product, quotation)     | `title` + `titleAside` (status) + `actions`   |
| What a page is for, when it needs saying   | `info` — an (i) beside the title, never prose |
| A way back the trail cannot give (a sheet) | `back` above the title                        |

**Removed, never recreate:** `CataloguePageHeader` (and its `titleLook`), `KitchenPageHeader` (and its
`band` variant and subtitle line), `CatalogueNavToggle` / `catalogue-nav.tsx`, `OpsPanel`, `KpiTile`.

## Banners, toasts and pop-ups

A state that stays is a **strip**; what just happened is a **toast**; a decision is a **pop-up**
(Toasts / pop-ups / banners canvas, 2026-11-11). Problems a page must fix go in the issue tray.

| Job                                                  | How                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| A state that stays (paused, offline, could not load) | `Callout` — the admin draws it as the 40px strip by itself |
| What just happened (saved, sent)                     | `toast.show` from `useToast()`                             |
| A save or send the server refused                    | `FailureToast` where the old red box was                   |
| A row removed, with its way back                     | `UndoBar` beside the rows                                  |
| Leaving a form with unsaved edits                    | `LeaveDialog` (`title` / `body` for the form's own words)  |
| Saving over somebody else's edit                     | `ConflictDialog`                                           |
| Both, on a record editor                             | the app's `EditorGuardDialogs`, which draws the two above  |

Do not pass `size="regular"` to an admin `Callout`, and never hand-draw a `Dialog` that asks
"leave without saving?" or "someone else changed this".

**Removed, never recreate:** the kitchen `UnsavedDialog`, the hand-drawn leave and conflict dialogs in
the editors, and the admin's use of the customer `UnsavedChangesDialog` (it stays for the shop and the
public B2B application).

## Record pop-ups — one window, one look

A record opened from its list (View) is the white "sheet" in `RecordPopupWindow`, at the order
pop-up's sizes: a 20px title, 20px figures, 14px values, 12px labels and capital card headings. The
sizes live in the design system's sheet parts — never set them on a page.

| Job                                                      | How                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A kitchen, corporate or platform record's View           | the app's `RecordViewPage` (fields, figures, sections, rail)                          |
| A record drawn by hand (ingredient, supply order, order) | `TrailedRecordWindow` + `RecordSheetHead`, `RecordFigures`, `SheetCard`, `SheetFacts` |
| The window itself, outside the kitchen shell             | `RecordPopupWindow` (`nav` for ‹ ›, `footer` for the actions)                         |
| Two columns or one inside a record                       | `SheetColumns` / `useRecordSplit` — never a width of its own                          |
| An editor's summary box beside the form                  | `RecordSummaryAside`                                                                  |
| A small figure tile (Analytics, Cost report)             | `RecordTile`                                                                          |

**Removed, never recreate:** the green record canopy (`RecordCanopy`, `look="board"` and the default
look of `RecordViewPage`), `CompactRecordPopup` (now `RecordPopupWindow`), `RecordDialog`, the old
`RecordWindow` window (its `RecordWindowFieldGrid` stays), and `/showcase-record-canopy`.

## Form bits

| Job                                                               | Part                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| A name, a description — one label, an English and an Arabic box   | `BilingualField` (`multiline`, `layout`, `requiredEnglish`) |
| "● Unsaved changes" beside an editor's title                      | `UnsavedMark`                                               |
| The checks pill ("1/3 checks · Next fix →") in an editor's header | `InlineChecksButton`, inside the page's `IssueTrayFrame`    |
| A camera scan beside a search or barcode field                    | the app's `ui/camera-scan-button.tsx` (it loads the camera) |

Import / Export on the catalogue lists stays the catalogue's own (`CatalogueTransferActions`): it reads
and writes catalogue data, and no other page has it.

## Text sizes — the admin type scale

Kitchen, corporate and platform admin read one scale and one face (2026-11-26, the user's pick "B,
size M"): **Inter everywhere**, titles and figures included, at these sizes. They live in `textRoles`
(`packages/design-tokens/src/typography.ts`); change a number there and every admin page follows.
The face comes from `AreaLookScope look="desk"`, which marks `<html data-look="desk">` so
`global.css` sets Inter on the whole admin, pop-ups included. The web shop keeps its own sizes and
Space Grotesk titles.

| Role                         | Size        | How                                                       |
| ---------------------------- | ----------- | --------------------------------------------------------- |
| Page title, a record's name  | 22 bold     | `PageHeader`, `Heading level={1}`, `Text variant="title"` |
| Big figure                   | 22 bold     | `Text variant="display"`                                  |
| Card / section title         | 15 semibold | `Heading level={2}` (3, 4), `Text variant="section"`      |
| Values, table cells, buttons | 14          | `Text variant="body"` / `"strong"`                        |
| Chips, tabs                  | 14 semibold | `Text variant="label"`                                    |
| Labels, headers, small notes | 12          | `Text variant="caption"` / `"micro"`                      |

A class needs a size? Use `text-role-<role>` — never `text-sm`, `text-xl` or `text-[13px]` in an admin
page or an admin part. Print sheets and the kitchen display screen keep their own sizes.

## Canvas designs

A new board draws dropdowns, fields, buttons, labels, tick boxes, choices, tabs, pills, dates, tables, toolbars, page headers, banners, pop-ups and record pop-ups and form bits as `/showcase-components` shows them. If a design
needs a part that is not on that page, say so — it is a new design-system part, not a one-off.
