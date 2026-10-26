import { useEffect, useRef } from 'react';

/**
 * A listing drawn inside a page whose own Save writes it as well — a cooked item's Selling tab,
 * saved by the recipe's one Save draft.
 *
 * The listing hands the page a function that writes whatever it holds unsaved and answers whether
 * that worked. The page calls it after its own writes and says once, for both, that everything
 * saved — so the listing draws no Save of its own and shows no toast of its own for that write.
 */
export type HostSave = () => Promise<boolean>;

/** How a listing hands its save to the page; `null` once the listing is gone. */
export type RegisterHostSave = (save: HostSave | null) => void;

/**
 * A listing's Archive, drawn by the host in its own action row — beside Cancel, Save draft and
 * Publish — rather than on a row of the listing's own under the page's header. The listing keeps
 * the dialog and the write; the host only draws the button.
 */
export interface HostArchive {
    readonly disabled: boolean;
    /** Translated. Why it cannot be pressed, or what pressing it does. */
    readonly hint: string;
    readonly open: () => void;
}

/** How a listing hands its Archive to the page; `null` once the listing is gone. */
export type RegisterHostArchive = (archive: HostArchive | null) => void;

/**
 * Registers `save` with the host for as long as the listing is mounted.
 *
 * The host is handed one stable function that always runs the listing's *latest* save — the save
 * closes over this render's drafts, and re-registering on every render would make the host's
 * setter a dependency of every keystroke.
 */
export function useHostSave(register: RegisterHostSave | undefined, save: HostSave): void {
    const latest = useRef(save);
    useEffect(() => {
        latest.current = save;
    });
    useEffect(() => {
        if (register === undefined) return;
        register(() => latest.current());
        return () => {
            register(null);
        };
    }, [register]);
}
