import {
    Button,
    FilterChip,
    Icon,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Search and filtering for a marketplace listing.
 *
 * ## The state lives in the URL
 *
 * Not in component state, and not in a store. A filtered listing is a *place*: it can be shared,
 * bookmarked, reloaded and reached with the browser's back button, and none of that survives a
 * `useState`. It also means the query cache key and the address bar cannot disagree, because both
 * read the same parameters.
 *
 * The trade is a re-render and a refetch per keystroke. Against the repositories that is free, and
 * against a real API it is what a `staleTime` and a server-side debounce are for — introducing a
 * client-side debounce here would put the address bar one keystroke behind the results, which is
 * the more confusing of the two failure modes.
 *
 * ## Why filters exist at all
 *
 * Neither reference product filters its catalogue (doc 17, IA-11, MKT-06): one has fourteen items
 * and gets away with it. Six kitchens and forty meals do not.
 */
export interface FilterOption {
    readonly value: string;
    readonly label: string;
    readonly count?: number | undefined;
}

export interface FilterGroup {
    /** URL parameter name. Values are comma-separated. */
    readonly key: string;
    readonly label: string;
    readonly options: readonly FilterOption[];
    /**
     * `single` for a group the underlying filter can only express one of — selecting a chip
     * replaces the previous choice rather than adding to it. Two chips lit when only one of them is
     * actually applied is a filter that lies about what it did.
     */
    readonly mode?: 'multiple' | 'single' | undefined;
}

/** The search parameter every marketplace listing uses. */
export const QUERY_PARAM = 'q';

export interface MarketplaceFilterState {
    readonly query: string;
    /** Selected values per group key, in URL order. */
    readonly selected: Readonly<Record<string, readonly string[]>>;
    readonly setQuery: (value: string) => void;
    readonly toggle: (groupKey: string, value: string, selected: boolean) => void;
    /** Replaces a group's whole selection. `null` clears it. */
    readonly select: (groupKey: string, value: string | null) => void;
    readonly clear: () => void;
    readonly isFiltered: boolean;
}

function readParam(raw: string | string[] | undefined): string {
    if (Array.isArray(raw)) return raw[0] ?? '';
    return raw ?? '';
}

/**
 * Reads and writes the listing's filter state through the route.
 *
 * `groupKeys` is passed rather than inferred so that a stray parameter — a tracking tag, a typo in
 * a shared link — never becomes a filter nobody can see or clear.
 */
export function useMarketplaceFilters(groupKeys: readonly string[]): MarketplaceFilterState {
    const router = useRouter();
    const params = useLocalSearchParams();

    const query = readParam(params[QUERY_PARAM] as string | string[] | undefined);

    const selected = useMemo<Readonly<Record<string, readonly string[]>>>(() => {
        const entries = groupKeys.map((key) => {
            const raw = readParam(params[key] as string | string[] | undefined);
            return [key, raw === '' ? [] : raw.split(',')] as const;
        });
        return Object.fromEntries(entries);
    }, [groupKeys, params]);

    const setQuery = useCallback(
        (value: string) => {
            router.setParams({ [QUERY_PARAM]: value });
        },
        [router],
    );

    const toggle = useCallback(
        (groupKey: string, value: string, next: boolean) => {
            const current = selected[groupKey] ?? [];
            const updated = next
                ? [...current, value]
                : current.filter((candidate) => candidate !== value);
            router.setParams({ [groupKey]: updated.join(',') });
        },
        [router, selected],
    );

    const select = useCallback(
        (groupKey: string, value: string | null) => {
            router.setParams({ [groupKey]: value ?? '' });
        },
        [router],
    );

    const clear = useCallback(() => {
        const cleared: Record<string, string> = { [QUERY_PARAM]: '' };
        for (const key of groupKeys) cleared[key] = '';
        router.setParams(cleared);
    }, [groupKeys, router]);

    const isFiltered = query !== '' || groupKeys.some((key) => (selected[key] ?? []).length > 0);

    return { query, selected, setQuery, toggle, select, clear, isFiltered };
}

/** How long a typed term waits before it becomes the URL's `?q=` and a request. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchDraft {
    /** What the field shows. */
    readonly draft: string;
    readonly setDraft: (value: string) => void;
    /** Return pressed: the term now, without waiting out the pause. */
    readonly submit: () => void;
}

/**
 * A search field over a listing's `?q=`: the field holds a draft and the URL holds the term.
 *
 * Each keystroke is not a request — the draft settles for a moment first. A term changed from
 * elsewhere (a removed chip, "Clear all", the header's search, a shared link) is copied back into
 * the field, so the two never disagree. The same arrangement the kitchen directory's search has
 * (`screens/kitchens-screen.tsx`).
 *
 * The doc comment at the top of this file argues against a client-side debounce for the chip
 * filters, and that still holds for them: a chip is one deliberate press. A text field is a burst
 * of them, and one request per letter of "chicken" is seven requests for one question.
 */
export function useSearchDraft(state: MarketplaceFilterState): SearchDraft {
    const { query: term, setQuery } = state;
    const [draft, setDraft] = useState(term);
    // Adjusted during render rather than in an effect, so the field never paints a stale term.
    const [syncedTerm, setSyncedTerm] = useState(term);
    if (syncedTerm !== term) {
        setSyncedTerm(term);
        setDraft(term);
    }
    useEffect(() => {
        const next = draft.trim();
        if (next === term) return undefined;
        const timer = setTimeout(() => {
            setQuery(next);
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [draft, term, setQuery]);

    const submit = useCallback(() => {
        const next = draft.trim();
        if (next !== term) setQuery(next);
    }, [draft, term, setQuery]);

    return { draft, setDraft, submit };
}

export interface FilterBarProps {
    readonly state: MarketplaceFilterState;
    readonly searchLabel: string;
    readonly searchPlaceholder?: string | undefined;
    readonly groups?: readonly FilterGroup[] | undefined;
    /** Rendered as a live count so a filter change is announced, not merely seen. */
    readonly resultCount?: number | undefined;
    /**
     * `false` renders the chip groups without the text field — for a screen that keeps its search
     * box visible and collapses only the rest of the filters behind a disclosure.
     */
    readonly showSearch?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function FilterBar({
    state,
    searchLabel,
    searchPlaceholder,
    groups = [],
    resultCount,
    showSearch = true,
    testID = 'filter-bar',
}: FilterBarProps) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID={testID}>
            {showSearch ? (
                <TextInputField
                    testID={`${testID}-search`}
                    id={`${testID}-search`}
                    label={searchLabel}
                    value={state.query}
                    onChangeText={state.setQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    trailing={<Icon name="search" />}
                    {...(searchPlaceholder === undefined ? {} : { placeholder: searchPlaceholder })}
                />
            ) : null}

            {groups.map((group) => (
                <Stack space="xs" key={group.key} testID={`${testID}-group-${group.key}`}>
                    <Text variant="label" tone="secondary">
                        {group.label}
                    </Text>
                    <Inline space="xs" wrap>
                        {group.options.map((option) => {
                            const isSelected = (state.selected[group.key] ?? []).includes(
                                option.value,
                            );
                            return (
                                <FilterChip
                                    key={option.value}
                                    testID={`${testID}-${group.key}-${option.value}`}
                                    label={option.label}
                                    selected={isSelected}
                                    {...(option.count === undefined ? {} : { count: option.count })}
                                    onChange={(next) => {
                                        if (group.mode === 'single') {
                                            state.select(group.key, next ? option.value : null);
                                            return;
                                        }
                                        state.toggle(group.key, option.value, next);
                                    }}
                                />
                            );
                        })}
                    </Inline>
                </Stack>
            ))}

            <Inline space="sm" align="center" wrap>
                {resultCount === undefined ? null : (
                    <Text
                        testID={`${testID}-count`}
                        tone="secondary"
                        variant="caption"
                        role="status"
                        aria-live="polite"
                    >
                        {t('marketplace:filters.resultCount', { count: resultCount })}
                    </Text>
                )}
                {state.isFiltered ? (
                    <Button
                        testID={`${testID}-clear`}
                        size="sm"
                        variant="ghost"
                        label={t('marketplace:filters.clear')}
                        onPress={state.clear}
                    />
                ) : null}
            </Inline>
        </Stack>
    );
}
