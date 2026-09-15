import { SearchInput, SegmentedControl } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

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
 * `search` is uncontrolled-width by design — 240px, stated once below. It is not a `FormGrid` field
 * and so it is not 280px; it is a control on a control row, and the number is the design's.
 */

/** The search field's width. Stated as a style, not a class: there is no 240px width token. */

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
     * Single-select status segments, "All" first. Omit both this and `status` for an entity with no
     * lifecycle to narrow by, and the segmented set is simply not drawn.
     */
    readonly statusSegments?: readonly CatalogueStatusSegment<Status>[] | undefined;
    readonly status?: Status | undefined;
    readonly onStatusChange?: ((status: Status) => void) | undefined;
    readonly statusLabel?: string | undefined;

    /** Anything else the entity needs, at the row's inline end. Rare — the row is deliberately bare. */
    readonly children?: ReactNode | undefined;
    readonly testID: string;
}

export function CatalogueToolbar<Status extends string = string>({
    search,
    onSearchChange,
    searchLabel,
    searchPlaceholder,
    statusSegments,
    status,
    onStatusChange,
    statusLabel,
    children,
    testID,
}: CatalogueToolbarProps<Status>) {
    const showStatus =
        statusSegments !== undefined &&
        statusSegments.length > 0 &&
        status !== undefined &&
        onStatusChange !== undefined;

    /*
     * `min-h-`, not `h-`. The row was a fixed 28px because it held nothing but `sm` controls; the
     * page's one primary is the `md` (32px) exception the handoff names, and now that it sits on
     * this line a fixed 28px row would clip it. The floor keeps the row's height where it was on a
     * page that has no primary.
     */
    return (
        <View
            testID={testID}
            className="min-h-control-sm flex-row items-center justify-center gap-tight"
        >
            {/*
             * The search is what absorbs the row.
             *
             * It was 240px, which is the width the handoff draws it at on a page whose actions sat
             * up in the header. With Import, Export and the primary moved down onto this line there
             * is a variable amount of space between the field and them, and a fixed field left a
             * third of the row empty in the middle. `flex-1` here is the exemption STRETCH_MESSAGE
             * names: this container *is* the row, not a control taking its width from one.
             */}
            {/* eslint-disable-next-line no-restricted-syntax -- the row's own filler; the exempt case. */}
            <View className="flex-1">
                <SearchInput
                    value={search}
                    onChangeText={onSearchChange}
                    label={searchLabel}
                    placeholder={searchPlaceholder}
                    size="sm"
                    testID={`${testID}-search`}
                />
            </View>

            {showStatus ? (
                <SegmentedControl
                    label={statusLabel ?? searchLabel}
                    items={statusSegments.map((segment) => ({
                        value: segment.value,
                        label: segment.label,
                        // Named by the value, not by position: a suite that clicks "Draft" should
                        // keep clicking Draft when a segment is added before it, and the label is
                        // translated so it cannot be the handle.
                        testID: `${testID}-status-${segment.value}`,
                    }))}
                    value={status}
                    onChange={onStatusChange}
                    // `-status-segments`, not `-status`: the segmented set is what a reader
                    // presses and what the RTL spec reads, and naming the control rather than the
                    // value keeps that id true if a second status control ever joins the row.
                    testID={`${testID}-status-segments`}
                />
            ) : null}

            {/*
             * No spacer any more: the search above absorbs the slack, so the status set and
             * whatever the entity puts here already sit at the inline end.
             */}
            {children}
        </View>
    );
}
