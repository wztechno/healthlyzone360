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
 * | `.drop.has` `.mm` | `MiniMonthPicker`  | `DatePickerButton`          |
 * | `.otabs` `.seg3`  | `DeskTabs`         | `Tabs variant="segmented"`  |
 * | `.gh2`            | `ListGroupRow`     | a hand-made section heading |
 * | `.drv` `.cb`      | `ChoiceRow`        | `FilterChip` / choose buttons in a dialog |
 *
 * All of them are on `/showcase-orders`.
 */
export { ChoiceRow, initialsOf } from './choice-row.tsx';
export { DeskButton, DeskIconButton } from './desk-button.tsx';
export type { DeskButtonProps, DeskButtonVariant } from './desk-button.tsx';
export { DeskChip } from './desk-chip.tsx';
export type { DeskChipSize } from './desk-chip.tsx';
export { DeskSelect, DropTrigger } from './desk-select.tsx';
export type { DeskSelectOption } from './desk-select.tsx';
export { DeskTabs } from './desk-tabs.tsx';
export type { DeskTabItem } from './desk-tabs.tsx';
export { ListGroupRow } from './list-group-row.tsx';
export { MiniMonthPicker } from './mini-month.tsx';
