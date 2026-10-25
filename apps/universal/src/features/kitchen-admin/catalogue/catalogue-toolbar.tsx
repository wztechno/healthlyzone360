import type { BarcodeScan } from '@healthy360/api-client/contracts';
import { SearchInput, SegmentedControl } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { CameraScanButton } from '../camera-scan-button.tsx';

/**
 * The Catalogue's toolbar: **one** 28px row, and two controls on it, centred.
 *
 * ```
 *              [ ⌕ Search 240px ]  [ All | Live | Draft | Review ]
 * ```
 *
 * ## Centred, because it follows a centred row of cards
 *
 * The two controls come to roughly 450px on a page whose content area is nearer 1230, so pinned to
 * the leading edge they read as the start of a third column that never arrives — with the stat
 * cards centred directly above them, the page had a centred band and then a left-hung one under it.
 * The pair is a single group and is treated as one: search and its status set stay adjacent, and
 * the remainder is spent on both margins.
 *
 * A row that fills its `children` slot opts out. The spacer below absorbs every spare pixel to push
 * that slot to the inline end, which leaves `justify-center` nothing to distribute — the group sits
 * at the start again, which is the right answer once there is something anchored opposite it.
 *
 * The predecessor (`list-toolbar.tsx`) stacked search, a Filters disclosure, a chip run and a count
 * across as many as four rows. Everything that used to live in the disclosure now lives on a column
 * header instead (§4.3) — filtering a catalogue is a per-column act, and asking for it from a panel
 * that names columns you can already see was the indirection that made the panel necessary.
 *
 * ## The two controls that used to sit at the inline end are gone
 *
 * **Density (S · M · L).** The list is fixed at the ladder's smallest step. A switch that resizes
 * every row under the reader is a preference control on a working surface that has one right
 * answer — a catalogue is scanned, and 28px rows are what put a full page in the fold — so the
 * three-way set was three presses to get back to where it started.
 *
 * **The field chooser (`▽`).** Every column the spec declares is drawn, and the fitter drops the
 * low-priority ones by itself as the port narrows (§4.1). A menu whose entire job was to hide
 * columns the layout was already hiding, and to hide ones the reader would then have to remember
 * turning off, had nothing left to decide.
 *
 * Both removals are the user's call, recorded here rather than in a commit message because the next
 * person reading §4.1 will find the row it describes has four controls and this one has two.
 *
 * Every control is `sm` (28px). The page's one 32px control is the primary in the header, and
 * nothing on this row competes with it.
 *
 * ## `statusSegments` is a slot, not a derivation
 *
 * The values come from the *unfiltered* row set, which lives a layer up with the list state. A
 * toolbar that derived its own status segments would watch them disappear as you narrowed the list
 * with them — the same reason `DataList`'s `renderHeader` is a slot.
 *
 * `search` takes whatever its zone has left and gives way to `SEARCH_MIN_WIDTH`, stated once below.
 * It is not a `FormGrid` field and so it is not 280px; it is a control on a control row.
 */

/**
 * The narrowest the search gives way to before the filters beside it drop to a line of their own:
 * an order number and a short name. A style, not a class: there is no width token for it.
 */
const SEARCH_MIN_WIDTH = 200;

export interface CatalogueStatusSegment<T extends string = string> {
    readonly value: T;
    readonly label: string;
}

export interface CatalogueToolbarProps<Status extends string = string> {
    readonly search: string;
    readonly onSearchChange: (search: string) => void;
    /** Translated. The field carries no visible label on this row, so this is its accessible one. */
    readonly searchLabel: string;
    readonly searchPlaceholder?: string | undefined;
    /**
     * Enter in the search does something besides filter — the batch register's scan field, which
     * looks a code up and opens the batch it names. The field keeps focus after it, so a scanner's
     * next label lands without a click, and it stops correcting and capitalising what is typed,
     * because what is typed is a code.
     */
    readonly onSearchSubmit?: (() => void) | undefined;
    /**
     * A camera scan (ingredient barcodes): draws the camera button beside the search, and hands its
     * read to the same path a keyboard-wedge scan takes through {@link onSearchSubmit}.
     */
    readonly onScan?: ((scan: BarcodeScan) => void) | undefined;

    /**
     * Single-select status segments, "All" first. Omit both this and `status` for an entity with no
     * lifecycle to narrow by, and the segmented set is simply not drawn.
     */
    readonly statusSegments?: readonly CatalogueStatusSegment<Status>[] | undefined;
    readonly status?: Status | undefined;
    readonly onStatusChange?: ((status: Status) => void) | undefined;
    readonly statusLabel?: string | undefined;

    /**
     * The entity's own narrowing controls — a date range, a second segmented set — drawn after the
     * status segments, in the part of the row that wraps. Never an action: see `children`.
     */
    readonly filters?: ReactNode | undefined;
    /**
     * The row's actions — the column picker, Import / Export, the page's primary — at its inline end.
     * They hold the first line: when the row runs short of width it is the search and the filters
     * that wrap, never these, so a primary is never left on a line of its own.
     */
    readonly children?: ReactNode | undefined;
    readonly testID: string;
}

export function CatalogueToolbar<Status extends string = string>({
    search,
    onSearchChange,
    searchLabel,
    searchPlaceholder,
    onSearchSubmit,
    onScan,
    statusSegments,
    status,
    onStatusChange,
    statusLabel,
    filters,
    children,
    testID,
}: CatalogueToolbarProps<Status>) {
    const showStatus =
        statusSegments !== undefined &&
        statusSegments.length > 0 &&
        status !== undefined &&
        onStatusChange !== undefined;

    /*
     * On the same raised panel as the list under it and the cards above — border, fill and the card
     * cast — so the page reads as three objects rather than two and a loose row of controls.
     *
     * `min-h-`, not `h-`. The row was a fixed 28px because it held nothing but `sm` controls; the
     * page's one primary is the `md` (32px) exception the handoff names, and now that it sits on
     * this line a fixed 28px row would clip it. The floor keeps the row's height where it was on a
     * page that has no primary.
     *
     * ## Two zones, so the actions never wrap alone
     *
     * One wrapping row put its *last* control on a line of its own as soon as the row ran short —
     * and the last control is the primary. On a laptop (a 1280px window, a ~920px page) that is
     * where it went. So the row is two zones:
     *
     * - the **filters** — search, status, the entity's own filters — take the leftover width and
     *   wrap *inside themselves*. The search gives way first, to `SEARCH_MIN_WIDTH`, then the
     *   filters drop under it;
     * - the **actions** never shrink and never wrap, and so keep the first line's inline end.
     *
     * The outer row wraps only as the last resort, when even the narrowed filters cannot sit beside
     * the actions; the actions then move as one group to the end of the next line.
     */
    return (
        // `z-10`: React Native Web makes every View a stacking context at `z-index: 0`, so without a
        // rank of its own the row sits under the table drawn after it — and so does every popover
        // its filters open (a date picker's month). A plain View, so the class is not overridden.
        <View
            testID={testID}
            className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-tight rounded-panel border border-brand-100 bg-surface-raised p-tight shadow-elevation-card"
        >
            {/*
             * `flex-1` — basis zero — is what makes the zone wrap inside before the row wraps
             * outside: the row breaks a line on an item's floor, and this zone's floor is the
             * search's, not the width of every filter laid end to end. It is the exemption
             * STRETCH_MESSAGE names: this container *is* the row's filler, not a control taking its
             * width from one.
             */}
            <View
                testID={`${testID}-filters`}
                // eslint-disable-next-line no-restricted-syntax -- the row's own filler; the exempt case.
                className="z-auto flex-1 flex-row flex-wrap items-center gap-tight"
                style={{ minWidth: SEARCH_MIN_WIDTH }}
            >
                {/* eslint-disable-next-line no-restricted-syntax -- the search absorbs the zone; the exempt case. */}
                <View className="flex-1" style={{ minWidth: SEARCH_MIN_WIDTH }}>
                    <SearchInput
                        value={search}
                        onChangeText={onSearchChange}
                        label={searchLabel}
                        placeholder={searchPlaceholder}
                        size="sm"
                        {...(onSearchSubmit === undefined
                            ? {}
                            : {
                                  onSubmitEditing: onSearchSubmit,
                                  blurOnSubmit: false,
                                  autoCorrect: false,
                                  autoCapitalize: 'none' as const,
                              })}
                        testID={`${testID}-search`}
                    />
                </View>

                {onScan === undefined ? null : (
                    <CameraScanButton testID={`${testID}-camera`} onScan={onScan} />
                )}

                {showStatus ? (
                    <SegmentedControl
                        label={statusLabel ?? searchLabel}
                        items={statusSegments.map((segment) => ({
                            value: segment.value,
                            label: segment.label,
                            // Named by the value, not by position: a suite that clicks "Draft"
                            // should keep clicking Draft when a segment is added before it, and the
                            // label is translated so it cannot be the handle.
                            testID: `${testID}-status-${segment.value}`,
                        }))}
                        value={status}
                        onChange={onStatusChange}
                        // `-status-segments`, not `-status`: the segmented set is what a reader
                        // presses and what the RTL spec reads, and naming the control rather than
                        // the value keeps that id true if a second status control ever joins.
                        testID={`${testID}-status-segments`}
                    />
                ) : null}

                {filters}
            </View>

            {children === undefined || children === null ? null : (
                <View
                    testID={`${testID}-actions`}
                    className="z-auto ms-auto flex-row items-center gap-tight self-start"
                >
                    {children}
                </View>
            )}
        </View>
    );
}
