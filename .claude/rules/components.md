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
  second copy of the design system. Its remaining parts are being moved out family by family.
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

Not dropdowns, and not `Select`: row actions (`⋯`) are a `Menu` (`RowActionsMenu` / `DeskRowMenu`
for now); Show columns is `DeskColumnPicker`.

**Removed, never recreate:** `DeskSelect`, `DeskPicker`, `LensScope`. `SlotScope` and `PeriodScope`
are presets that draw `Select` inside — fine to use, not a pattern to copy.

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

## Canvas designs

A new board draws dropdowns, fields, buttons and pills as `/showcase-components` shows them. If a design
needs a part that is not on that page, say so — it is a new design-system part, not a one-off.
