import {
    createContext,
    useCallback,
    useContext,
    useId,
    useLayoutEffect,
    useMemo,
    useState,
} from 'react';
import type { ReactNode } from 'react';

/**
 * FormIssueScope — lets a `FormIssueBanner` tell the fields it names that they are already named.
 *
 * Badges & Callouts, 2a: once the banner under the header says `3 required` and names each field as
 * a chip, the field keeps its red edge but loses the line of copy under it. Saying "Required" in two
 * places is one too many, and on a long form the second copy is the one pushing the next field down.
 *
 * It is a registry rather than a mode, because a banner does not always name every field that has
 * something to say. A pack row whose code box carries "quantity must be whole" is summarised by one
 * `Packs` chip; the row's own message is the only place that says which column is wrong, so it has
 * to stay. A chip opts its field in with `FormIssueItem.fieldId`, and only the fields named that way
 * go quiet — everything else on the page reads as before.
 *
 * Outside a scope nothing is registered and every field keeps its message, so a form with no
 * banner, a test that renders one field, and the phone surfaces behave exactly as they did.
 */
interface FormIssueRegistry {
    readonly register: (owner: string, fieldIds: readonly string[]) => void;
    readonly release: (owner: string) => void;
}

/*
 * Two contexts, not one. The banners need the actions, which never change; the fields need the set,
 * which changes on every registration. Handing the banners the set too would make each registration
 * re-run every banner's effect — a release and a re-register that change the set again.
 */
const FormIssueRegistryContext = createContext<FormIssueRegistry | null>(null);
const SummarisedFieldsContext = createContext<ReadonlySet<string>>(new Set());

export interface FormIssueScopeProps {
    readonly children: ReactNode;
}

export function FormIssueScope({ children }: FormIssueScopeProps) {
    // Keyed by the banner that registered them, so two banners on one page (errors and warnings)
    // each take back only their own when they unmount.
    const [owners, setOwners] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map());

    const register = useCallback((owner: string, fieldIds: readonly string[]) => {
        setOwners((previous) => {
            const current = previous.get(owner);
            if (current !== undefined && sameIds(current, fieldIds)) return previous;
            if (current === undefined && fieldIds.length === 0) return previous;
            const next = new Map(previous);
            if (fieldIds.length === 0) next.delete(owner);
            else next.set(owner, fieldIds);
            return next;
        });
    }, []);

    const release = useCallback((owner: string) => {
        setOwners((previous) => {
            if (!previous.has(owner)) return previous;
            const next = new Map(previous);
            next.delete(owner);
            return next;
        });
    }, []);

    const summarised = useMemo(() => new Set([...owners.values()].flat()), [owners]);
    const registry = useMemo(() => ({ register, release }), [register, release]);

    return (
        <FormIssueRegistryContext.Provider value={registry}>
            <SummarisedFieldsContext.Provider value={summarised}>
                {children}
            </SummarisedFieldsContext.Provider>
        </FormIssueRegistryContext.Provider>
    );
}

/** True when a banner in scope names the field whose control carries `id`. */
export function useFieldSummarised(id: string): boolean {
    return useContext(SummarisedFieldsContext).has(id);
}

/**
 * Registers the fields a banner names for as long as it names them.
 *
 * A layout effect, not a plain one: the banner and the fields it quiets appear in the same commit,
 * and a passive effect would paint the field's message for a frame before taking it away again.
 */
export function useSummariseFields(fieldIds: readonly string[]): void {
    const registry = useContext(FormIssueRegistryContext);
    const owner = useId();
    const key = fieldIds.join('\u0000');

    useLayoutEffect(() => {
        registry?.register(owner, key === '' ? [] : key.split('\u0000'));
    }, [registry, owner, key]);

    useLayoutEffect(
        () => () => {
            registry?.release(owner);
        },
        [registry, owner],
    );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}
