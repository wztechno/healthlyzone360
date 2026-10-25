import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

/**
 * The record a list's View page is showing, as an address: `?view=<id>`.
 *
 * A list draws its record page in place of itself (`RecordViewPage`), so which record is open used
 * to be state the list held. The kitchen layout is a `<Slot/>`: going on to the record's editor
 * unmounts the list, and coming back rebuilt it with nothing open. With the id in the URL the editor
 * is sent a `?returnTo=` of the list with that `?view=`, so Cancel, Save and the trail land on the
 * record the reader was reading — and Back and a refresh keep it open. `/kitchen/review` is where
 * this started.
 *
 * - Seeded from the route's `view`, and written back with `router.setParams`, which replaces the
 *   entry: opening and closing records never fills Back with the list's own states.
 * - Followed during render when the param changes underneath, so browser Back closes the record.
 * - Found among the rows the list already holds. One opened by hand, or one that leaves the rows
 *   while it is open (confirmed out of a status filter, say), stays open as it was last seen.
 * - Read by its id when the list settles without it. A refresh starts the list over — page one, no
 *   search, the default sort — so the record a link names is often on a page nobody has loaded.
 *   Only a record that read refuses (or a list with no such read) counts as gone: the list shows
 *   rather than an empty record, and the address stops naming it.
 */
export interface ViewedRecord<Row> {
    readonly viewing: Row | null;
    readonly viewingId: string | null;
    readonly setViewing: (row: Row | null) => void;
}

/** What a by-id read answers. A `UseQueryResult` of the row is one. */
export interface RecordLookupResult<Row> {
    readonly data: Row | undefined;
    readonly isError: boolean;
}

/**
 * The record with this id, read on its own — `null` while there is nothing to read. Called on every
 * render, so it is a hook, and the same one for the life of the list.
 */
export type RecordLookup<Row> = (id: string | null) => RecordLookupResult<Row>;

/** A read that can never answer: an id that does not parse, or a list with no by-id read. */
export const RECORD_NOT_FOUND: RecordLookupResult<never> = { data: undefined, isError: true };

function useNoLookup(): RecordLookupResult<never> {
    return RECORD_NOT_FOUND;
}

export interface ViewedRecordOptions<Row> {
    /** A record to open on arrival when the address names none — handed over by another view. */
    readonly seed?: Row | null | undefined;
    /** Reads the named record when the loaded rows do not hold it. Without one, it is gone. */
    readonly useLookup?: RecordLookup<Row> | undefined;
}

export function useViewedRecord<Row>(
    view: string | undefined,
    rows: readonly Row[],
    idOf: (row: Row) => string,
    /** The list holds its answer and is not refetching it — only then is a missing record looked for. */
    settled: boolean,
    { seed = null, useLookup = useNoLookup }: ViewedRecordOptions<Row> = {},
): ViewedRecord<Row> {
    const router = useRouter();
    const named = view === undefined || view === '' ? null : view;
    const [viewingId, setViewingId] = useState<string | null>(
        () => named ?? (seed === null ? null : idOf(seed)),
    );
    const [viewParam, setViewParam] = useState(named);
    if (viewParam !== named) {
        setViewParam(named);
        setViewingId(named);
    }

    const found = viewingId === null ? null : (rows.find((row) => idOf(row) === viewingId) ?? null);
    const [held, setHeld] = useState<Row | null>(seed);
    if (found !== null && found !== held) setHeld(found);
    const kept = found ?? (held !== null && idOf(held) === viewingId ? held : null);

    // Asked only once the list has answered without it, so a record on the page costs no request.
    const lookup = useLookup(viewingId !== null && kept === null && settled ? viewingId : null);
    const looked =
        lookup.data !== undefined && idOf(lookup.data) === viewingId ? lookup.data : null;
    const viewing = kept ?? looked;
    if (viewingId !== null && viewing === null && settled && lookup.isError) {
        setViewingId(null);
    }

    // The gone case above clears the state during render; the address follows once committed.
    useEffect(() => {
        if (viewingId === null && named !== null) router.setParams({ view: undefined } as never);
    }, [viewingId, named, router]);

    return {
        viewing,
        viewingId,
        setViewing: (row) => {
            const next = row === null ? null : idOf(row);
            if (next === viewingId) return;
            // A row opened by hand is shown even when this page of the list does not hold it.
            if (row !== null) setHeld(row);
            setViewingId(next);
            router.setParams({ view: next ?? undefined } as never);
        },
    };
}
