import {
    DataList,
    Icon,
    IconButton,
    Inline,
    Text,
    fitColumns,
    useBreakpoint,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { RowDensity } from '@healthy360/design-tokens';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { CatalogueListItem } from './catalogue-list-item.tsx';
import { CATALOGUE_PRIORITY, columnFloor, columnForRole } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';
import { useCataloguePort } from './catalogue-nav.tsx';
import { RowThumbnail } from './row-thumbnail.tsx';

/**
 * The list's panel — the same surface as the toolbar above it and every other admin panel, so the
 * rows read as one object on the page rather than lines drawn straight onto the ground. Only drawn
 * around rows: an empty state is the caller's own block and brings its own layout.
 */
const FRAME_CLASS =
    'flex-col rounded-panel border border-brand-100 bg-surface-raised shadow-elevation-card';

/**
 * Part five (§4.1): the list.
 *
 * ```
 * 10px upper column labels · a rule under the header · 32px rows · hover tint
 * ```
 *
 * **Ingredients, Recipes and Sauces differ by `columns` and nothing else.** Everything a spec could
 * want to vary is in the array — the tracks, the priorities, the cell renderers, and (through
 * `role`) what each column becomes when the grid collapses. Nothing entity-specific is written
 * here, and the third entity should be a spec file with no companion component.
 *
 * One panel around the rows (`FRAME_CLASS`), and inside it no vertical rules and no zebra.
 * `DataList` owns the row geometry; this component adds only the frame.
 *
 * ## Why the fitting happens here and not in `DataList`
 *
 * `DataList` measures its own box and fits against it, which is right for a list standing on its
 * own. It is not sufficient here, because §4.2's warning is precisely that the measurement which
 * matters — the port after the nav's width transition — is the one an automatic observer misses,
 * and `DataList` reads its node after every commit while the transition is still running. So the
 * port is measured by `useCataloguePort` (commit, *settled*, resize) and the columns are fitted
 * against that before they reach `DataList`.
 *
 * The double fit is deliberate and idempotent: `fitColumns` over an already-fitting set returns it
 * unchanged, so `DataList`'s own pass is a no-op on the same width and a correct fallback on a
 * surface with no nav around it — the showcase, a test renderer, a native screen before its first
 * layout.
 *
 * `columnFloor` is what is charged against the budget: `min` where a spec states one, `width`
 * otherwise. That is the difference between "this column needs 96px to be worth drawing" and "this
 * column gets a 140px track when it is drawn".
 *
 * ## The overflow column is the shell's, not the spec's
 *
 * `rowActions` appends the action column rather than each entity declaring one. §4.1 fixes
 * everything about it — the `⋯`, the priority that keeps it undroppable, the plain non-interactive
 * header, the end alignment — so three specs restating it would be three chances to get one of
 * them wrong. What an entity decides is which actions there are, which is exactly what the callback
 * returns.
 *
 * ## The photograph is the shell's too
 *
 * A spec names a row's picture with `thumbnail` on its title column and nothing else. This file
 * draws it in both shapes — 20px inside the wide table's title cell, avatar-sized on the narrow
 * row's leading edge — for the same reason as the overflow column. When the specs drew their own,
 * the three that had a picture all drew it in the wide table and none on the narrow row, because
 * the narrow row reads a column's plain `value` and never calls its renderer.
 *
 * ## The narrow branch
 *
 * Below `md` the tracks are gone and each record renders through `CatalogueListItem`. The branch is
 * in JavaScript, on `useBreakpoint`, because the two trees have different element counts — the
 * reasoning `ListItem` already carries. The roles in the spec are what let one array feed both
 * shapes.
 */
export interface CatalogueListProps<Row> {
    /** The spec. The only thing that differs between Ingredients, Recipes and Sauces. */
    readonly columns: readonly CatalogueColumn<Row>[];
    readonly rows: readonly Row[];
    readonly rowKey: (row: Row) => string;
    /** Accessible name for the list as a whole. */
    readonly label: string;
    readonly density?: RowDensity | undefined;
    /** The row body opens the editor, at both widths. */
    readonly onRowPress?: ((row: Row) => void) | undefined;
    /** View · Edit · Archive for one row. Rendered by the `actions` column, and by the narrow row. */
    readonly rowActions?: ((row: Row) => readonly MenuItem[]) | undefined;
    /** Accessible name for the overflow trigger. */
    readonly rowActionsLabel: string;
    readonly emptyState?: ReactNode | undefined;
    readonly testID: string;
}

export function CatalogueList<Row>({
    columns,
    rows,
    rowKey,
    label,
    density = 'md',
    onRowPress,
    rowActions,
    rowActionsLabel,
    emptyState,
    testID,
}: CatalogueListProps<Row>) {
    const { atLeast } = useBreakpoint();
    const port = useCataloguePort();

    if (!atLeast('md')) {
        return (
            <View
                testID={testID}
                role="list"
                aria-label={label}
                accessibilityLabel={label}
                className={rows.length === 0 ? 'flex-col' : FRAME_CLASS}
            >
                {rows.length === 0
                    ? emptyState
                    : rows.map((row, index) => (
                          <CatalogueListItem
                              key={rowKey(row)}
                              title={cellText(columnForRole(columns, 'title'), row)}
                              media={narrowThumbnail(columns, row, rowKey, testID)}
                              status={renderRole(columns, 'status', row)}
                              metric={renderRole(columns, 'metric', row)}
                              meta={metaEntries(columns, row)}
                              actions={rowActions?.(row)}
                              actionsLabel={rowActionsLabel}
                              onPress={
                                  onRowPress === undefined
                                      ? undefined
                                      : () => {
                                            onRowPress(row);
                                        }
                              }
                              divider={index < rows.length - 1}
                              testID={`${testID}-row-${rowKey(row)}`}
                          />
                      ))}
            </View>
        );
    }

    const drawn = withTableThumbnail(columns, rowKey, testID);
    const withActions =
        rowActions === undefined
            ? drawn
            : [...drawn, actionColumn<Row>(rowActions, rows, rowActionsLabel, rowKey, testID)];

    // `columnFloor` is the fitting currency; the tracks `DataList` draws are still `width`. Fitting
    // on a floor and drawing on a width is the whole reason the spec carries both.
    const fitted = fitColumns(
        withActions.map((column) => ({ ...column, width: columnFloor(column) })),
        port.width,
    );
    const visible = withActions.filter((column) =>
        fitted.some((candidate) => candidate.key === column.key),
    );

    return (
        /*
         * The frame is outside the port, not on it: the port is measured with
         * `getBoundingClientRect`, which includes a border, so a frame on the measured box would
         * fit tracks two pixels wider than the space inside it.
         */
        <View className={rows.length === 0 ? 'flex-col' : FRAME_CLASS}>
            <View
                testID={`${testID}-port`}
                // Both measurement paths, and each is inert on the other's platform: `onLayout` never
                // fires with a useful width on web before the nav settles, and `ref` has no
                // `getBoundingClientRect` on native.
                ref={Platform.OS === 'web' ? port.ref : undefined}
                onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
                /*
                 * No scroll port of its own.
                 *
                 * This used to carry `web:overflow-x-auto` so a track sum wider than the port could be
                 * reached. Two things are wrong with that. The first is CSS: `overflow-x: auto` with
                 * `overflow-y: visible` computes `overflow-y: auto` as well, so the list grew its own
                 * *vertical* scrollbar inside the page's — the table scrolled independently of the
                 * screen it sits on, which is what the reader sees as a scrollbar appearing halfway
                 * down the page and a row list that will not move with the wheel.
                 *
                 * The second is that it should never be needed. §4.1 is explicit that columns are
                 * *dropped by priority, never scrolled away*, because a row that scrolls sideways
                 * hides its overflow menu. `fitColumns` runs twice — here against the measured port,
                 * again inside `DataList` — precisely so the track sum fits. A scroll port on top of
                 * that was a second answer to a question the fitter had already answered, and the two
                 * disagreed.
                 */
                className="flex-col"
            >
                <DataList
                    columns={visible}
                    rows={rows}
                    rowKey={rowKey}
                    label={label}
                    density={density}
                    onRowPress={onRowPress}
                    emptyState={emptyState}
                    framed={rows.length > 0}
                    testID={testID}
                />
            </View>
        </View>
    );
}

function cellText<Row>(column: CatalogueColumn<Row> | undefined, row: Row): string {
    return column?.value?.(row) ?? '';
}

/**
 * The spec's columns with the row photograph drawn into the title cell, when the spec names one.
 *
 * The title's own renderer is kept and wrapped, not replaced, so a spec still owns how its title
 * reads — the missing-Arabic badge, the weight — and only the picture is added in front of it.
 */
function withTableThumbnail<Row>(
    columns: readonly CatalogueColumn<Row>[],
    rowKey: (row: Row) => string,
    testID: string,
): readonly CatalogueColumn<Row>[] {
    return columns.map((column) => {
        const thumbnail = column.thumbnail;
        if (column.role !== 'title' || thumbnail === undefined) return column;

        const titleCell = (row: Row): ReactNode =>
            column.render === undefined ? (
                <Text variant="label">{cellText(column, row)}</Text>
            ) : (
                column.render(row)
            );

        return {
            ...column,
            render: (row: Row) => (
                <Inline space="xs" align="center">
                    <RowThumbnail
                        assetId={thumbnail(row)}
                        seed={rowKey(row)}
                        label={cellText(column, row)}
                        size="table"
                        testID={`${testID}-row-${rowKey(row)}-image`}
                    />
                    {titleCell(row)}
                </Inline>
            ),
        };
    });
}

/** The same photograph for the two-line row below `md`, or nothing when the spec names none. */
function narrowThumbnail<Row>(
    columns: readonly CatalogueColumn<Row>[],
    row: Row,
    rowKey: (row: Row) => string,
    testID: string,
): ReactNode {
    const title = columnForRole(columns, 'title');
    if (title?.thumbnail === undefined) return undefined;

    return (
        <RowThumbnail
            assetId={title.thumbnail(row)}
            seed={rowKey(row)}
            label={cellText(title, row)}
            size="narrow"
            testID={`${testID}-row-${rowKey(row)}-image`}
        />
    );
}

function renderRole<Row>(
    columns: readonly CatalogueColumn<Row>[],
    role: 'status' | 'metric',
    row: Row,
): ReactNode {
    const column = columnForRole(columns, role);
    if (column === undefined) return undefined;
    return column.render === undefined ? column.value?.(row) : column.render(row);
}

/**
 * The second line's meta run: every column the spec marked `meta`, in spec order.
 *
 * Explicit rather than "whatever did not fit", because what a narrow row should say is a decision
 * about the entity, not a leftover of the fitting maths — a reference and a category read well
 * there; a lock version does not.
 */
function metaEntries<Row>(
    columns: readonly CatalogueColumn<Row>[],
    row: Row,
): readonly ReactNode[] {
    return columns
        .filter((column) => column.role === 'meta')
        .map((column) => (column.render === undefined ? column.value?.(row) : column.render(row)))
        .filter((entry): entry is ReactNode => entry !== undefined && entry !== '');
}

/**
 * The row-action column — the three controls drawn flat, at the priority that keeps them reachable.
 *
 * ## Three buttons, not one `⋯`
 *
 * §4.1 specified a single overflow menu holding View · Edit · Archive, and that is the right shape
 * on a phone, where a row has space for exactly one affordance — which is why
 * {@link CatalogueListItem} still draws it that way below `md`. It is the wrong shape on a desk.
 * Three named actions behind a menu is two presses and a mouse round-trip for the thing a user came
 * to do, on a surface with a pointer and 100px to spare, and it hides Archive — the one action
 * worth being able to *see* is guarded — behind a control that reveals nothing until you open it.
 *
 * So the wide row spends the width: the same `MenuItem[]` the caller already supplies is rendered
 * as one `IconButton` per action, in order, tone included. The caller's API does not change, and
 * the narrow row keeps the menu, so one array feeds both shapes exactly as the column spec does.
 *
 * ## The track is measured, not assumed
 *
 * It used to be the sum for exactly three buttons, which was true of the one caller there was and
 * silently clipped the fourth as soon as there were two. `actionTrack` charges the widest row on
 * the page instead: the ingredient list still returns three and still gets the same 108px, and a
 * recipe row that adds New draft against an immutable version gets the width to draw it. Measured
 * per page rather than per row because a column has one track — a row that offers three actions
 * inside a page whose widest offers four leaves 32px of end padding, which is the correct answer to
 * a ragged set.
 *
 * ## The buttons must swallow their own click on the web
 *
 * The row is itself a `Pressable` that opens the editor. On the web a nested `<button>`'s click
 * bubbles, so pressing Archive would run the archive *and* navigate away from the list behind the
 * dialog. React Native's responder system hands the touch to the innermost target and never
 * bubbles, so the stop is `Platform.OS === 'web'` only — spread rather than declared, because
 * `onClick` is a DOM prop React Native does not type. Same technique, same reason, as
 * `GRID_CONTENT_ATTR` above.
 *
 * `sortable` is left off deliberately: §4.3 says a column with nothing to sort or filter renders a
 * plain, non-interactive header, because emitting the focusable wrapper anyway leaves a keyboard
 * user tabbing onto a target that does nothing.
 */
function actionColumn<Row>(
    rowActions: (row: Row) => readonly MenuItem[],
    rows: readonly Row[],
    label: string,
    rowKey: (row: Row) => string,
    testID: string,
): CatalogueColumn<Row> {
    const track = actionTrack(rowActions, rows);

    return {
        key: 'actions',
        // Blank, which is what the design draws over this track — a box holding the header row's
        // height and no text. "Row actions" set in 10px caps does not fit the track, so it wrapped
        // to two lines and clipped mid-word ("ROW ACTIO / NS") while saying nothing the buttons
        // below it do not. The names are not lost: each button carries its own.
        label: '',
        width: track,
        min: track,
        priority: CATALOGUE_PRIORITY.actions,
        align: 'end',
        // The one column whose width is its content. `DataList` shares the port's leftover width
        // out over the other tracks so the row fills the page; giving this one a share of it would
        // only push the buttons off the edge they are anchored to and spend on padding the width
        // the designation column needs to finish its words.
        grow: false,
        role: 'actions',
        render: (row) => (
            <View
                accessibilityLabel={label}
                aria-label={label}
                className="flex-row items-center gap-hair"
                {...(Platform.OS === 'web'
                    ? {
                          onClick: (event: { stopPropagation: () => void }) => {
                              event.stopPropagation();
                          },
                      }
                    : {})}
            >
                {rowActions(row).map((action) => (
                    <IconButton
                        key={action.key}
                        label={action.label}
                        variant="ghost"
                        size="sm"
                        {...(action.tone === undefined ? {} : { tone: action.tone })}
                        {...(action.disabled === undefined ? {} : { disabled: action.disabled })}
                        icon={<Icon name={action.icon ?? 'more'} size="sm" />}
                        onPress={action.onSelect}
                        // The item's own id where it has one, so a spec that used to click the
                        // menu entry clicks the button instead and nothing else has to change.
                        testID={
                            action.testID ?? `${testID}-row-${rowKey(row)}-action-${action.key}`
                        }
                    />
                ))}
            </View>
        ),
    };
}

/**
 * The action column's track: as many 28px buttons as the busiest row on the page needs.
 *
 * `MIN_ACTION_SLOTS` is three — the View / Edit / Archive set every Catalogue list starts from —
 * so a page whose rows all happen to hide Archive does not draw a narrower column than the page
 * before it and shuffle every other track sideways. Empty pages take the same floor for the same
 * reason.
 *
 * Stated as the sum — buttons, the gaps between them, the cell's own inset — rather than a round
 * number, so the track cannot silently stop fitting its contents when the control ladder moves.
 */
const MIN_ACTION_SLOTS = 3;

function actionTrack<Row>(
    rowActions: (row: Row) => readonly MenuItem[],
    rows: readonly Row[],
): number {
    let slots = MIN_ACTION_SLOTS;
    for (const row of rows) slots = Math.max(slots, rowActions(row).length);
    return slots * 28 + (slots - 1) * 4 + 2 * 8;
}
