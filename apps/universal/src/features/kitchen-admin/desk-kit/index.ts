/**
 * The desk kit — the Orders canvas's controls (2026-11-10), built once for every kitchen-admin
 * page. Each has the props of the part it replaces, so a page moves over by changing an import:
 *
 * | Canvas            | Part               | Replaces                    |
 * | ----------------- | ------------------ | --------------------------- |
 * | `.btn.sm` `.nx`   | `DeskButton`       | `Button`                    |
 * | `.ib.sm`          | `DeskIconButton`   | `IconButton`                |
 * | `.ac`             | `DeskChip`         | `Badge`                     |
 * | `.drop.has` `.mm` | `MiniMonthPicker`  | `DatePickerButton` (or `DeskDateButton`, its props) |
 * | `.otabs` `.seg3`  | `DeskTabs`         | `Tabs variant="segmented"`  |
 * | `.gh2`            | `ListGroupRow`     | a hand-made section heading |
 * | `.drv` `.cb`      | `ChoiceRow`        | `FilterChip` / choose buttons in a dialog |
 * | `.dots.more`      | `DeskRowMenu`      | `RowActionsMenu` (or `rowActionsLook="desk"`) |
 * | `.dtl`            | `DeskToggleTile`   | `FilterChip` for a record's own multi-choice |
 * | `.chipset`        | `DeskChoiceChips`  | a `Select` over a few short choices (on `/showcase-corporate`) |
 * | Show columns      | `DeskColumnPicker` | `ColumnPicker`              |
 * | Breadcrumb board  | `DeskTrail`        | `Breadcrumbs` in the kitchen top bar |
 *
 * All of them are on `/showcase-orders`. Dropdowns are not here: every "pick a value" list is the
 * design system's `Select` (`trigger="pill"` on a toolbar), on `/showcase-components`.
 */
export { ChoiceRow, initialsOf } from './choice-row.tsx';
export { DeskButton, DeskIconButton } from './desk-button.tsx';
export type { DeskButtonProps, DeskButtonVariant } from './desk-button.tsx';
export { DeskCheckbox } from './desk-checkbox.tsx';
export { DeskChoiceChips } from './desk-choice-chips.tsx';
export type { DeskChoiceChip } from './desk-choice-chips.tsx';
export { DeskChip } from './desk-chip.tsx';
export { DeskColumnPicker } from './desk-column-picker.tsx';
export { DeskRowMenu } from './desk-row-menu.tsx';
export type { DeskChipSize } from './desk-chip.tsx';
export { DropTrigger } from './drop-trigger.tsx';
export { DeskTabs } from './desk-tabs.tsx';
export { DeskToggleTile } from './desk-toggle-tile.tsx';
export { DeskTrail } from './desk-trail.tsx';
export type { DeskCrumb } from './desk-trail.tsx';
export type { DeskTabItem } from './desk-tabs.tsx';
export { ListGroupRow } from './list-group-row.tsx';
export { DeskDateButton, MiniMonthPicker } from './mini-month.tsx';
export { DeskDateField } from './desk-date-field.tsx';
