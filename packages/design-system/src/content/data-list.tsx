import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RowDensity } from '@healthy360/design-tokens';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
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
 *
 * ## And the tracks fill the port they fit in
 *
 * Dropping answers the narrow case. The wide one is the opposite problem: eight fixed tracks add up
 * to about 1050px and the shell's content area on a laptop is nearer 1450, so the list drew itself
 * against the leading edge with 400px of nothing after the last column — while the cells inside
 * those tracks clipped their values to one line. `spreadColumns` shares the leftover out over the
 * columns in proportion to their declared width, so the row ends where the page ends and the
 * designation column gets most of what was going spare.
 */

export const UNDROPPABLE_PRIORITY = 95;

export interface DataListColumn<Row> {
    readonly key: string;
    /** Column label, translated. Rendered on the `micro` step — 10px, uppercase. */
    readonly label: string;
    /**
     * The track's floor in dp — what {@link fitColumns} charges against the port, and what the
     * column is drawn at when the tracks exactly fill it. It is not the final width: leftover port
     * width is shared out over the growable columns by {@link spreadColumns}.
     */
    readonly width: number;
    /**
     * Ranks the column for narrow viewports. Handoff's ladder: Designation 100, the overflow menu
     * 95, the entity's headline metric 85, status 80, reference 70, down to `updated` 20. Anything
     * at or above {@link UNDROPPABLE_PRIORITY} survives every width.
     */
    readonly priority: number;
    /**
     * Whether the column takes a share of the port's leftover width. Defaults to `true`.
     *
     * `false` is for a track whose width is its content and nothing else — the row-action column,
     * which is sized to the buttons in it. Widening that one only pushes the buttons away from the
     * edge they are anchored to, and spends on padding the width the designation column needs to
     * say `Condiments and sweeteners` without an ellipsis.
     */
    readonly grow?: boolean | undefined;
    /**
     * Cell and header alignment. Defaults to `start`, which is where the Catalogue's numeric
     * columns sit too: a price read down a left edge lines up with the label above it, and the
     * tracks are no longer narrow enough for `end` or `center` to be doing any work.
     */
    readonly align?: 'start' | 'end' | 'center' | undefined;
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

/**
 * The drawn width of each column, once the port's leftover width has been shared out.
 *
 * `fitColumns` answers "which columns"; this answers "how wide". They are separate because the
 * first is charged against a floor — the narrowest a column is worth drawing at — and the widths
 * that come out of it almost never add up to the port. On a 1440px window with the nav open that
 * is roughly 400px of nothing after the last column, and every text cell clipped to one line
 * *inside* its track while the space it needed sat unused beside it.
 *
 * ## The share is equal, not proportional
 *
 * Every growable column takes the same number of pixels. The first version of this shared the slack
 * out in proportion to the declared width, on the argument that a column declared at 260 holds a
 * sentence and one declared at 88 holds `4%`, so the wide one has more use for the space. What that
 * actually does is compound the widest track: `Designation` was already the biggest gap on the row
 * and proportional handed it the biggest share of the remainder as well, so the run between a short
 * name and the category beside it opened to nearly 200px while `Condiment & Sweetener` wrapped in
 * the column next door.
 *
 * Equal shares put the leftover where it is least visible — spread thinly across every boundary
 * instead of banked behind one. The declared width still says how much room a column's *content*
 * needs, which is what `fitColumns` ranks and drops on; it just stops being a claim on the page's
 * spare width too.
 *
 * Exported and pure for the same reason as `fitColumns`: "nine columns in a 1213px port" is
 * arithmetic, and arithmetic is worth a test rather than a screenshot.
 *
 * Integer widths throughout, with the division's remainder given to the widest growable column, so
 * the tracks sum to the port exactly and no sub-pixel seam opens between the header and its rows.
 */
export function spreadColumns<Row>(
    columns: readonly DataListColumn<Row>[],
    available: number,
): readonly number[] {
    const widths = columns.map((column) => column.width);
    const floor = widths.reduce((sum, width) => sum + width, 0);
    const slack = Math.floor(available) - floor;
    if (slack <= 0) return widths;

    const growable = columns.map((column) => column.grow !== false);
    const count = growable.filter((grows) => grows).length;
    if (count === 0) return widths;

    // `count > 0` guarantees a growable column, so this always resolves to one of them.
    let widest = 0;
    let widestWidth = -1;
    widths.forEach((width, index) => {
        if (growable[index] !== true || width <= widestWidth) return;
        widest = index;
        widestWidth = width;
    });

    const share = Math.floor(slack / count);
    const remainder = slack - share * count;

    return widths.map((width, index) => {
        if (growable[index] !== true) return width;
        return width + share + (index === widest ? remainder : 0);
    });
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

/**
 * The density ladder, as a *floor* rather than a fixed height.
 *
 * `h-row-md` clipped: a cell whose value does not fit its track was cut mid-word — `Condiments and
 * sweet…` — and there was nothing a reader could do about it short of opening the row. Every track
 * now grows to fill the port (see {@link spreadColumns}), which is enough for almost every value,
 * and `min-h-` is what covers the rest: the outliers wrap to a second line and take the row with
 * them instead of losing their tail. A page of ordinary rows is the same 28 / 32 / 36px it was.
 */
const ROW_HEIGHT_CLASS: Readonly<Record<RowDensity, string>> = {
    sm: 'min-h-row-sm',
    md: 'min-h-row-md',
    lg: 'min-h-row-lg',
};

const TEXT_ALIGN_CLASS: Readonly<Record<'start' | 'end' | 'center', string>> = {
    start: 'text-start',
    end: 'text-end',
    center: 'text-center',
};

const JUSTIFY_CLASS: Readonly<Record<'start' | 'end' | 'center', string>> = {
    start: 'justify-start',
    end: 'justify-end',
    center: 'justify-center',
};

function cellClass(column: DataListColumn<unknown>): string {
    return cx(
        'text-role-body font-admin text-content-primary',
        column.mono === true ? 'font-mono' : null,
        TEXT_ALIGN_CLASS[column.align ?? 'start'],
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
    // collapsible. §4.2's warning applies here.
    const [available, setAvailable] = useState(0);
    const visible = fitColumns(columns, available);
    const trackSum = visible.reduce((sum, column) => sum + column.width, 0);
    // `width` is the floor; this is what each column is actually drawn at once the port's leftover
    // width has been shared out. Before the first measurement there is no port to share, and
    // `spreadColumns` returns the declared widths unchanged.
    const tracks = spreadColumns(visible, available);

    // A zero is never a port. It is what a node reports before it has been laid out, and taking it
    // would fit every column against nothing and then need a second pass to undo that.
    const measure = (width: number) => {
        if (width <= 0) return;
        setAvailable((current) => (current === width ? current : width));
    };

    /**
     * Native's measurement, and the only one it needs — `onLayout` is the real layout system there
     * and fires on mount, on rotation and in split view.
     */
    const onLayout = (event: LayoutChangeEvent) => {
        measure(event.nativeEvent.layout.width);
    };

    /*
     * The web's measurement, read from the node rather than waited for.
     *
     * `onLayout` is the wrong instrument on this platform, which is the same conclusion
     * `useCataloguePort` reached and this component had not: react-native-web implements it as a
     * `ResizeObserver`, and here it never delivered a usable observation at all. The list sat on
     * `available = 0` — every column at its declared track, no fitting pass, no share of the port —
     * and stayed there through a window resize.
     *
     * So the node is held and read on demand, at the two moments the port can have changed: after
     * every commit, which covers mount and the nav rail's width transition (the shell re-renders
     * across it), and on `resize`. `measure` ignores an unchanged width, so a layout effect with no
     * dependency list settles after one pass instead of looping.
     */
    const port = useRef<View | null>(null);

    const readPort = useCallback(() => {
        const node = port.current as unknown as {
            getBoundingClientRect?: () => { width: number };
        } | null;
        const rect = node?.getBoundingClientRect?.();
        if (rect === undefined) return;
        if (rect.width <= 0) return;
        setAvailable((current) => (current === rect.width ? current : rect.width));
    }, []);

    useLayoutEffect(() => {
        if (Platform.OS !== 'web') return;
        readPort();
    });

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
        window.addEventListener('resize', readPort);
        return () => {
            window.removeEventListener('resize', readPort);
        };
    }, [readPort]);

    return (
        <View
            testID={testID}
            role="table"
            aria-label={label}
            accessibilityLabel={label}
            ref={port}
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
                    /*
                     * `z-raised`: react-native-web gives every view `z-index: 0`, which makes the
                     * header its own stacking context and paints the rows — later siblings — over
                     * anything hanging out of it. A column's sort/filter panel is exactly that.
                     *
                     * `web:sticky web:top-0`: the labels stay put while the rows run under them, so
                     * row 200 is still readable as a row rather than as eight unlabelled values.
                     * `top-0` is right and a design's `top: 130px` would not be — the scroll port
                     * here is the shell's `ScrollView`, not the document (CLAUDE.md), so zero
                     * already means "just under the top bar". It needs the page's own ground behind
                     * it (`bg-surface-base`) or the rows show through as they pass.
                     *
                     * `web:` because `position: sticky` has no React Native counterpart at all;
                     * NativeWind emits the variant on the web preset only, so native never sees a
                     * value its layout engine would reject. The list is a scroller in its own right
                     * there.
                     */
                    className={cx(
                        'min-h-row-sm z-raised flex-row items-center border-b border-stroke-subtle',
                        'bg-surface-base web:sticky web:top-0',
                    )}
                >
                    {visible.map((column, index) => (
                        <View
                            key={column.key}
                            role="columnheader"
                            testID={
                                testID === undefined
                                    ? undefined
                                    : `${testID}-columnheader-${column.key}`
                            }
                            style={{ width: tracks[index] ?? column.width }}
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
                                        TEXT_ALIGN_CLASS[column.align ?? 'start'],
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
                          const cells = visible.map((column, index) => (
                              <View
                                  key={column.key}
                                  role="cell"
                                  style={{ width: tracks[index] ?? column.width }}
                                  className={cx(
                                      // No vertical padding: `min-h-row-*` is what sets the row's
                                      // floor, and a padded cell would raise every row above the
                                      // density it was asked for.
                                      'flex-row items-center px-control-sm',
                                      JUSTIFY_CLASS[column.align ?? 'start'],
                                  )}
                              >
                                  {column.render === undefined ? (
                                      // No `numberOfLines`. A track wide enough for its value is
                                      // the fix for a long one; the clamp was the fix for a track
                                      // that was not, and all it ever did was hide the problem
                                      // behind an ellipsis.
                                      <RNText
                                          className={cellClass(column as DataListColumn<unknown>)}
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
