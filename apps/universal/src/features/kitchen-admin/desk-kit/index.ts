/**
 * The desk kit — the Orders canvas's controls (2026-11-10), built once for every kitchen-admin
 * page. Each has the props of the part it replaces, so a page moves over by changing an import:
 *
 * | Canvas            | Part               | Replaces                    |
 * | ----------------- | ------------------ | --------------------------- |
 * | `.gh2`            | `ListGroupRow`     | a hand-made section heading |
 * | Show columns      | `DeskColumnPicker` | `ColumnPicker`              |
 * | Breadcrumb board  | `DeskTrail`        | `Breadcrumbs` in the kitchen top bar |
 *
 * All of them are on `/showcase-orders`. Dropdowns, buttons, labels, tick boxes and choices are
 * not here: they are the design system's `Select`, `Button` / `IconButton`, `Badge`, `Checkbox`,
 * `ChoiceRow`, `ChoiceChips`, `Tabs`, `DatePicker` and `DataTable`, all on `/showcase-components`.
 */
export { DeskColumnPicker } from './desk-column-picker.tsx';
export { DropTrigger } from './drop-trigger.tsx';
export { DeskTrail } from './desk-trail.tsx';
export type { DeskCrumb } from './desk-trail.tsx';
export { ListGroupRow } from './list-group-row.tsx';
