/**
 * The desk kit — the Orders canvas's controls (2026-11-10), built once for every kitchen-admin
 * page. Each has the props of the part it replaces, so a page moves over by changing an import:
 *
 * | Canvas            | Part               | Replaces                    |
 * | ----------------- | ------------------ | --------------------------- |
 * | `.btn.sm` `.nx`   | `DeskButton`       | `Button`                    |
 * | `.ib.sm`          | `DeskIconButton`   | `IconButton`                |
 * | `.ac`             | `DeskChip`         | `Badge`                     |
 * | `.drop` `.cpop`   | `DeskSelect`       | `LensScope`                 |
 * | `.drop.has` `.mm` | `MiniMonthPicker`  | `DatePickerButton` (or `DeskDateButton`, its props) |
 * | `.otabs` `.seg3`  | `DeskTabs`         | `Tabs variant="segmented"`  |
 * | `.gh2`            | `ListGroupRow`     | a hand-made section heading |
 * | `.drv` `.cb`      | `ChoiceRow`        | `FilterChip` / choose buttons in a dialog |
 * | `.dots.more`      | `DeskRowMenu`      | `RowActionsMenu` (or `rowActionsLook="desk"`) |
 * | Show columns      | `DeskColumnPicker` | `ColumnPicker`              |
 * | Breadcrumb board  | `DeskTrail`        | `Breadcrumbs` in the kitchen top bar |
 *
 * All of them are on `/showcase-orders`.
 */
export { ChoiceRow, initialsOf } from './choice-row.tsx';
export { DeskButton, DeskIconButton } from './desk-button.tsx';
export type { DeskButtonProps, DeskButtonVariant } from './desk-button.tsx';
export { DeskCheckbox } from './desk-checkbox.tsx';
export { DeskChip } from './desk-chip.tsx';
export { DeskColumnPicker } from './desk-column-picker.tsx';
export { DeskRowMenu } from './desk-row-menu.tsx';
export type { DeskChipSize } from './desk-chip.tsx';
export { DeskSelect, DropTrigger } from './desk-select.tsx';
export type { DeskSelectOption } from './desk-select.tsx';
export { DeskTabs } from './desk-tabs.tsx';
export { DeskTrail } from './desk-trail.tsx';
export type { DeskCrumb } from './desk-trail.tsx';
export type { DeskTabItem } from './desk-tabs.tsx';
export { ListGroupRow } from './list-group-row.tsx';
export { DeskDateButton, MiniMonthPicker } from './mini-month.tsx';
