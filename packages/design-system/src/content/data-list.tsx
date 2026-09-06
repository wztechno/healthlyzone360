import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RowDensity } from '@healthy360/design-tokens';
import { Pressable, Text as RNText, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { GRID_CONTENT_ATTR } from '../overlays/anchored-surface.ts';

/**
 * DataList — the Catalogue's list, driven by a column spec.
 *
 * Ingredients, Recipes and Sauces differ by an array and nothing else (§4.1). That is the whole
 * design goal: a new entity is a spec, not a screen. What this component owns is the geometry those
 * specs share — the track widths, the hairline, the hover tint, the row height, and the two things
 * below that are easy to get wrong.
 *
 * **No card, no panel outline, no vertical rules, no zebra** (§4.1). The only line is the row's
 * bottom hairline. A list of 25 rows is already a grid to the eye; drawing that grid a second time
 * in ink is what made the previous tables feel like spreadsheets.
 *
 * ## The row box must be as wide as the tracks, not as wide as the port
 *
 * Rows carry an explicit minimum width equal to the sum of their tracks — the `min-width:
 * max-content` the handoff calls for, stated as the number it resolves to. Without it the hairline,
 * the hover tint and the overflow menu's anchor all stop at the scroll port's edge while the cells
 * carry on past it: you hover a row and the highlight ends mid-record.
 *
 * Stating the sum rather than the keyword is not a compromise. Every track here is a fixed number,
 * so `max-content` *is* that sum — and unlike the keyword it is a value React Native understands,
 * so both platforms get the same box from one code path. It also gives `Dropdown`'s edge flip a
 * real measurement to compare against, which is the other half of the phantom-scrollbar fix.
 *
 * ## Columns are dropped by priority, never scrolled away
 *
 * Between `md` and `lg` there is not room for every track. The list drops the lowest-priority
 * columns until the rest fit rather than letting the row scroll sideways (§4.1), because a row that
 * scrolls hides its overflow menu — the one control that must always be reachable. Designation
 * (100) and the action column (95) are pinned above the drop threshold and never leave.
 */

export const UNDROPPABLE_PRIORITY = 95;

export interface DataListColumn<Row> {
    readonly key: string;
    /** Column label, translated. Rendered on the `micro` step — 10px, uppercase. */
    readonly label: string;
    /** Track width in dp. Fixed: these are columns, not a fluid layout. */
    readonly width: number;
    /**
     * Ranks the column for narrow viewports. Handoff's ladder: Designation 100, the overflow menu
     * 95, the entity's headline metric 85, status 80, reference 70, down to `updated` 20. Anything
     * at or above {@link UNDROPPABLE_PRIORITY} survives every width.
     */
    readonly priority: number;
    readonly align?: 'start' | 'end' | undefined;
    /** Sets the cell in the mono role. Quantities, costs, references and versions (§1.2). */
    readonly mono?: boolean | undefined;
    /** Draws the header as a plain label instead of a sort/filter trigger. Action columns. */
    readonly sortable?: boolean | undefined;
    readonly filterable?: boolean | undefined;
    /** Custom cell. Falls back to `value()` rendered as text. */
    readonly render?: ((row: Row) => ReactNode) | undefined;
    readonly value?: ((row: Row) => string) | undefined;
    /**
     * Replaces the header label with a caller-drawn control — the sort/filter `Menu` of §4.3. It is
     * a slot rather than built in because the menu needs the *unfiltered* row set to derive its
     * values from, which lives a layer up with the list state.
     */
    readonly renderHeader?: (() => ReactNode) | undefined;
}

/**
 * Which columns fit, highest priority first.
 *
 * Exported and pure so the fitting rule can be tested without a renderer — it is the piece most
 * likely to be quietly wrong at one specific width, and "9 columns in a 713px port" is not a thing
 * a snapshot catches.
 *
 * Column *order* is preserved: dropping is a filter, not a sort. A list whose columns reordered
 * themselves as the window narrowed would be unreadable even though every one of them fit.
 */
export function fitColumns<Row>(
    columns: readonly DataListColumn<Row>[],
    available: number,
): readonly DataListColumn<Row>[] {
    const total = columns.reduce((sum, column) => sum + column.width, 0);
    if (available <= 0 || total <= available) return columns;

    // Pinned columns are not negotiable and are charged against the budget first, so a very narrow
    // port drops everything else before it considers them — and then still renders them, scrolling
    // if it must. A reachable overflow menu past the edge beats an unreachable one inside it.
    const pinned = columns.filter((column) => column.priority >= UNDROPPABLE_PRIORITY);
    let used = pinned.reduce((sum, column) => sum + column.width, 0);

    const kept = new Set(pinned.map((column) => column.key));
    const candidates = columns
        .filter((column) => column.priority < UNDROPPABLE_PRIORITY)
        .sort((left, right) => right.priority - left.priority);

    for (const column of candidates) {
        if (used + column.width > available) continue;
        used += column.width;
        kept.add(column.key);
    }

    return columns.filter((column) => kept.has(column.key));
}

export interface DataListProps<Row> {
    readonly columns: readonly DataListColumn<Row>[];
    readonly rows: readonly Row[];
    readonly rowKey: (row: Row) => string;
    /** Accessible name for the list as a whole. */
    readonly label: string;
    /** Row height ladder, switched by the toolbar's density control. `md` (32px) is the default. */
    readonly density?: RowDensity | undefined;
    /** Opens the editor. The row body's behaviour is unchanged from today's list (§4.1). */
    readonly onRowPress?: ((row: Row) => void) | undefined;
    readonly emptyState?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const ROW_HEIGHT_CLASS: Readonly<Record<RowDensity, string>> = {
    sm: 'h-row-sm',
    md: 'h-row-md',
    lg: 'h-row-lg',
};

function cellClass(column: DataListColumn<unknown>): string {
    return cx(
        'text-role-body font-admin text-content-primary',
        column.mono === true ? 'font-mono' : null,
        column.align === 'end' ? 'text-end' : 'text-start',
    );
}

export function DataList<Row>({
    columns,
    rows,
    rowKey,
    label,
    density = 'md',
    onRowPress,
    emptyState,
    className,
    testID,
}: DataListProps<Row>) {
    // Measured rather than derived from the breakpoint: the list's port is the shell's content
    // area, not the window, and the two differ by the 224px nav rail — which is itself
    // collapsible. §4.2's warning applies here, and `onLayout` is the measurement that survives
    // the nav's width transition on both platforms.
    const [available, setAvailable] = useState(0);
    const visible = fitColumns(columns, available);
    const trackSum = visible.reduce((sum, column) => sum + column.width, 0);

    const onLayout = (event: LayoutChangeEvent) => {
        setAvailable(event.nativeEvent.layout.width);
    };

    return (
        <View
            testID={testID}
            role="table"
            aria-label={label}
            accessibilityLabel={label}
            onLayout={onLayout}
            className={cx('flex-col', className)}
        >
            <View
                // Spread rather than declared: `data-*` is a web attribute React Native does not
                // type, and JSX spread performs no excess-property check — the same technique, and
                // the same reason, as `keyDownProps`. It marks this box as the `max-content` width
                // `Dropdown`'s edge flip measures against.
                {...{ [GRID_CONTENT_ATTR]: 'true' }}
                style={{ minWidth: trackSum }}
                className="flex-col"
            >
                <View
                    role="row"
                    className={cx(
                        'h-row-sm flex-row items-center border-b border-stroke-subtle',
                    )}
                >
                    {visible.map((column) => (
                        <View
                            key={column.key}
                            role="columnheader"
                            style={{ width: column.width }}
                            className="px-control-sm"
                        >
                            {column.renderHeader === undefined ? (
                                /*
                                 * A plain, non-interactive label when the column neither sorts nor
                                 * filters. Emitting the same focusable wrapper for every column
                                 * leaves a keyboard user tabbing through targets that do nothing —
                                 * §4.3 calls this out by name, and the action column is exactly it.
                                 */
                                <RNText
                                    className={cx(
                                        'text-role-micro font-admin uppercase text-content-secondary',
                                        column.align === 'end' ? 'text-end' : 'text-start',
                                    )}
                                >
                                    {column.label}
                                </RNText>
                            ) : (
                                column.renderHeader()
                            )}
                        </View>
                    ))}
                </View>

                {rows.length === 0
                    ? null
                    : rows.map((row) => {
                          const key = rowKey(row);
                          const cells = visible.map((column) => (
                              <View
                                  key={column.key}
                                  role="cell"
                                  style={{ width: column.width }}
                                  className={cx(
                                      'flex-row items-center px-control-sm',
                                      column.align === 'end' ? 'justify-end' : 'justify-start',
                                  )}
                              >
                                  {column.render === undefined ? (
                                      <RNText
                                          numberOfLines={1}
                                          className={cellClass(
                                              column as DataListColumn<unknown>,
                                          )}
                                      >
                                          {column.value?.(row) ?? ''}
                                      </RNText>
                                  ) : (
                                      column.render(row)
                                  )}
                              </View>
                          ));

                          const rowClass = cx(
                              ROW_HEIGHT_CLASS[density],
                              'flex-row items-center border-b border-stroke-subtle',
                          );

                          if (onRowPress === undefined) {
                              return (
                                  <View
                                      key={key}
                                      role="row"
                                      testID={
                                          testID === undefined ? undefined : `${testID}-row-${key}`
                                      }
                                      className={rowClass}
                                  >
                                      {cells}
                                  </View>
                              );
                          }

                          return (
                              <Pressable
                                  key={key}
                                  role="row"
                                  testID={testID === undefined ? undefined : `${testID}-row-${key}`}
                                  onPress={() => {
                                      onRowPress(row);
                                  }}
                                  // The hover tint is the row's only affordance — there is no
                                  // chevron and no button — so it covers the whole track sum rather
                                  // than the port, which is what the `minWidth` above buys.
                                  className={cx(rowClass, 'hover:bg-surface-sunken')}
                              >
                                  {cells}
                              </Pressable>
                          );
                      })}
            </View>

            {rows.length === 0 ? emptyState : null}
        </View>
    );
}
