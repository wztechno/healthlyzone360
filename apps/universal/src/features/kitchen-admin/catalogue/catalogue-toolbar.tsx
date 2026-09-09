import { SearchInput, SegmentedControl } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The Catalogue's toolbar: **one** 28px row, and two controls on it.
 *
 * ```
 * [ ⌕ Search 240px ]  [ All | Live | Draft | Review ]
 * ```
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
export const CATALOGUE_SEARCH_WIDTH = 240;

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

    return (
        <View testID={testID} className="h-control-sm flex-row items-center gap-tight">
            <View style={{ width: CATALOGUE_SEARCH_WIDTH }}>
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

            {children === undefined ? null : (
                <>
                    {/*
                     * The spacer *is* the row — it holds no control and exists only to push the
                     * trailing slot to the inline end — which is the exemption STRETCH_MESSAGE
                     * names by example.
                     */}
                    {/* eslint-disable-next-line no-restricted-syntax -- toolbar spacer; the exempt case. */}
                    <View className="flex-1" />
                    {children}
                </>
            )}
        </View>
    );
}
