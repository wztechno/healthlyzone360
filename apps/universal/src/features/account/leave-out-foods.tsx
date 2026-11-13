import type {
    DietaryIngredientMatch,
    FoodExclusion,
    FoodExclusionKind,
} from '@healthy360/api-client/contracts';
import { FOOD_EXCLUSION_KINDS } from '@healthy360/api-client/contracts';
import { Icon, InfoTip, cx, useBreakpoint } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, ScrollView, TextInput, View } from 'react-native';

import {
    DIETARY_INGREDIENT_MIN_QUERY,
    useDietaryIngredientSearch,
} from '../../data/account-hooks.ts';

/**
 * "Ingredients to leave out" — Account → Allergies, under "How strictly to avoid each", as the
 * Shop · Account boards draw it (Avoid-rest, -search, -picked, -none, -search-phone).
 *
 * - **Resting**: the foods already listed, as chips — the name (free text in quotes, italic), its
 *   kind ("I don't like it", or "Never" in red) and an ✕ — then a dashed "Add a food".
 * - **Searching**: the field, and under it the ingredients that match — the match picked out in the
 *   name, the category beneath, "Added" on one already listed — and a last row that adds the words
 *   as written. Nothing matching says so, and keeps that last row. On a phone the field and its
 *   answers are a bottom sheet, so the keyboard does not cover the list.
 * - **Picked**: the new chip with a two-way "I don't like it" / "Never", and Cancel / Add.
 *
 * The list is the panel's edit: nothing here writes — the panel's Save sends the whole set, the
 * way it sends the allergens. Both kinds keep a meal that lists the ingredient off a plan; "Never"
 * also tells the kitchen it must never be swapped in.
 */

/** A food on its way in: what was picked, before its kind is chosen. */
type Pending =
    | { readonly subject: 'ingredient'; readonly match: DietaryIngredientMatch }
    | { readonly subject: 'freeText'; readonly text: string };

type Mode =
    | { readonly step: 'rest' }
    | { readonly step: 'search' }
    | { readonly step: 'picked'; readonly pending: Pending };

const KIND_ICONS: Readonly<Record<FoodExclusionKind, IconName>> = {
    dislike: 'thumbsDown',
    forbidden: 'ban',
};

/** How long typing pauses before the search is asked. */
const SEARCH_DEBOUNCE_MS = 200;

/** The text a person typed, as one free-text food: trimmed, one space between words. */
function asWritten(query: string): string {
    return query.trim().replace(/\s+/g, ' ');
}

function sameText(a: string, b: string): boolean {
    return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function exclusionLabel(exclusion: FoodExclusion): string | null {
    switch (exclusion.subject) {
        case 'ingredient':
            return exclusion.name;
        case 'freeText':
            return exclusion.text;
        case 'dietClassification':
            return null;
    }
}

export interface LeaveOutFoodsProps {
    readonly testID: string;
    readonly exclusions: readonly FoodExclusion[];
    readonly onChange: (exclusions: readonly FoodExclusion[]) => void;
    readonly disabled?: boolean | undefined;
}

export function LeaveOutFoods({
    testID,
    exclusions,
    onChange,
    disabled = false,
}: LeaveOutFoodsProps) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const phone = !atLeast('md');
    const [mode, setMode] = useState<Mode>({ step: 'rest' });
    const [query, setQuery] = useState('');

    const title = t('account:dietary.exclusionsTitle');

    const listedIngredient = (id: string) =>
        exclusions.some(
            (entry) => entry.subject === 'ingredient' && String(entry.ingredientId) === id,
        );
    const listedText = (text: string) =>
        exclusions.some((entry) => entry.subject === 'freeText' && sameText(entry.text, text));

    const closeSearch = () => {
        setQuery('');
        setMode({ step: 'rest' });
    };
    const pick = (pending: Pending) => {
        setQuery('');
        setMode({ step: 'picked', pending });
    };
    const confirm = (pending: Pending, kind: FoodExclusionKind) => {
        onChange([
            ...exclusions,
            pending.subject === 'ingredient'
                ? {
                      subject: 'ingredient',
                      kind,
                      ingredientId: pending.match.id,
                      name: pending.match.name,
                  }
                : { subject: 'freeText', kind, text: pending.text },
        ]);
        setMode({ step: 'rest' });
    };
    const remove = (index: number) => {
        onChange(exclusions.filter((_, at) => at !== index));
    };

    const search =
        mode.step === 'search' ? (
            <FoodSearch
                testID={`${testID}-search`}
                query={query}
                onQuery={setQuery}
                onClose={closeSearch}
                onPick={pick}
                listedIngredient={listedIngredient}
                listedText={listedText}
                inline={!phone}
            />
        ) : null;

    return (
        <View testID={testID} className="z-auto mt-[22px]">
            <View className="mb-3 flex-row items-center gap-1.5">
                <RNText className="text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                    {title}
                </RNText>
                <InfoTip
                    testID={`${testID}-tip`}
                    label={title}
                    text={t('account:dietary.exclusionsSubtitle')}
                />
            </View>

            <View testID={`${testID}-chips`} className="flex-row flex-wrap items-center gap-2">
                {exclusions.map((exclusion, index) => {
                    const label = exclusionLabel(exclusion);
                    if (label === null) return null;
                    return (
                        <FoodChip
                            key={
                                exclusion.subject === 'ingredient'
                                    ? `i-${String(exclusion.ingredientId)}`
                                    : `t-${label}-${String(index)}`
                            }
                            testID={`${testID}-chip-${String(index)}`}
                            label={label}
                            asWritten={exclusion.subject === 'freeText'}
                            kind={exclusion.kind}
                            onRemove={
                                disabled
                                    ? undefined
                                    : () => {
                                          remove(index);
                                      }
                            }
                        />
                    );
                })}
                {mode.step === 'rest' ? (
                    <Pressable
                        testID={`${testID}-add`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityState={{ disabled }}
                        disabled={disabled}
                        onPress={() => {
                            setMode({ step: 'search' });
                        }}
                        className="h-10 flex-row items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-stroke px-3.5 hover:bg-surface-brand-subtle"
                    >
                        <Icon name="plus" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="text-sm font-bold text-content-on-brand-subtle">
                            {t('account:dietary.leaveOut.add')}
                        </RNText>
                    </Pressable>
                ) : null}
            </View>

            {search !== null && !phone ? search : null}
            {phone ? (
                <Modal
                    visible={mode.step === 'search'}
                    transparent
                    animationType="none"
                    onRequestClose={closeSearch}
                >
                    <View className="flex-1 justify-end">
                        <Pressable
                            testID={`${testID}-search-backdrop`}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            aria-hidden
                            focusable={false}
                            onPress={closeSearch}
                            className="absolute inset-0 bg-surface-inverse/50"
                        />
                        <View
                            role="dialog"
                            aria-modal
                            aria-label={title}
                            className="max-h-[85vh] w-full flex-col rounded-t-[28px] bg-surface-raised px-4 pb-6 pt-2.5 shadow-elevation-4"
                        >
                            <View className="mb-3 h-1 w-10 self-center rounded-full bg-stroke" />
                            {search}
                        </View>
                    </View>
                </Modal>
            ) : null}

            {mode.step === 'picked' ? (
                <KindChoice
                    testID={`${testID}-ask`}
                    pending={mode.pending}
                    onCancel={() => {
                        setMode({ step: 'rest' });
                    }}
                    onConfirm={(kind) => {
                        confirm(mode.pending, kind);
                    }}
                />
            ) : null}
        </View>
    );
}

/** A listed food: its name, its kind, and the ✕ that takes it off. */
function FoodChip({
    testID,
    label,
    asWritten: written,
    kind,
    onRemove,
    fresh = false,
}: {
    readonly testID: string;
    readonly label: string;
    readonly asWritten: boolean;
    readonly kind: FoodExclusionKind | null;
    readonly onRemove?: (() => void) | undefined;
    /** The chip being added — ringed in the brand colour, with no kind and no ✕ yet. */
    readonly fresh?: boolean;
}) {
    const { t } = useTranslation();
    const never = kind === 'forbidden';
    return (
        <View
            testID={testID}
            className={cx(
                'h-10 flex-row items-center gap-2 rounded-full bg-surface-raised ps-3.5',
                fresh
                    ? 'border-2 border-surface-brand pe-3.5 shadow-[0_0_0_4px_rgb(var(--h360-color-brand-surface)/0.12)]'
                    : onRemove === undefined
                      ? 'border pe-3.5'
                      : 'border pe-1.5',
                fresh ? null : never ? 'border-danger-border' : 'border-stroke',
            )}
        >
            <RNText
                testID={`${testID}-name`}
                numberOfLines={1}
                className={cx(
                    'shrink text-sm text-content-primary',
                    written ? 'font-medium italic' : 'font-semibold',
                )}
            >
                {written ? `“${label}”` : label}
            </RNText>
            {kind === null ? null : (
                <View
                    testID={`${testID}-kind`}
                    className={cx(
                        'h-6 flex-row items-center gap-1 rounded-full px-2.5',
                        never ? 'bg-danger-subtle' : 'bg-surface-base',
                    )}
                >
                    <Icon
                        name={KIND_ICONS[kind]}
                        size="sm"
                        className={never ? 'text-danger-on-subtle' : 'text-content-secondary'}
                    />
                    <RNText
                        className={cx(
                            'text-xs font-bold',
                            never ? 'text-danger-on-subtle' : 'text-content-secondary',
                        )}
                    >
                        {t(`account:dietary.leaveOut.kind.${kind}`)}
                    </RNText>
                </View>
            )}
            {onRemove === undefined ? null : (
                <Pressable
                    testID={`${testID}-remove`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('account:dietary.leaveOut.remove', { name: label })}
                    onPress={onRemove}
                    className="h-7 w-7 items-center justify-center rounded-full hover:bg-surface-base"
                >
                    <Icon name="close" size="sm" className="text-content-secondary" />
                </Pressable>
            )}
        </View>
    );
}

/** One row the search offers: an ingredient, or the words as written. */
type Option =
    | { readonly type: 'match'; readonly match: DietaryIngredientMatch; readonly added: boolean }
    | { readonly type: 'free'; readonly text: string; readonly added: boolean };

/**
 * The field and its answers. Arrow keys move the highlighted row, Enter takes it, Escape closes;
 * a pointer takes a row by pressing it. A row already listed says "Added" and cannot be taken again.
 *
 * The answers are a named group of buttons, not a `listbox`: a listbox needs owned options and
 * active-descendant wiring to be valid (the onboarding pickers' reasoning), and each row is simply
 * an action.
 */
function FoodSearch({
    testID,
    query,
    onQuery,
    onClose,
    onPick,
    listedIngredient,
    listedText,
    inline,
}: {
    readonly testID: string;
    readonly query: string;
    readonly onQuery: (query: string) => void;
    readonly onClose: () => void;
    readonly onPick: (pending: Pending) => void;
    readonly listedIngredient: (id: string) => boolean;
    readonly listedText: (text: string) => boolean;
    /** Beside the chips (a dropdown over the page) rather than inside a phone's sheet. */
    readonly inline: boolean;
}) {
    const { t } = useTranslation();
    const [debounced, setDebounced] = useState(query);
    const [active, setActive] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebounced(query);
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [query]);

    const text = asWritten(query);
    const ready = text.length >= DIETARY_INGREDIENT_MIN_QUERY;
    const found = useDietaryIngredientSearch(ready ? debounced : '');
    // A stale page for a different term would offer the wrong rows, and "No ingredient matches"
    // before any answer would be a guess; both wait for the answer for what is in the field.
    const settled =
        ready &&
        asWritten(debounced) === text &&
        ((found.isSuccess && !found.isPlaceholderData) || found.isError);
    const matches = settled ? (found.data ?? []) : [];
    const failed = settled && found.isError;

    const options: Option[] = ready
        ? [
              ...matches.map((match): Option => ({
                  type: 'match',
                  match,
                  added: listedIngredient(String(match.id)),
              })),
              { type: 'free', text, added: listedText(text) },
          ]
        : [];
    const takeable = options
        .map((option, index) => (option.added ? -1 : index))
        .filter((i) => i >= 0);
    // With no matches the as-written row is the one Enter takes, as the no-match board shows.
    const highlighted = takeable.includes(active) ? active : (takeable[0] ?? -1);

    const take = (option: Option | undefined) => {
        if (option === undefined || option.added) return;
        onPick(
            option.type === 'match'
                ? { subject: 'ingredient', match: option.match }
                : { subject: 'freeText', text: option.text },
        );
    };
    const move = (step: 1 | -1) => {
        if (takeable.length === 0) return;
        const at = takeable.indexOf(highlighted);
        const next = takeable[(at + step + takeable.length) % takeable.length];
        if (next !== undefined) setActive(next);
    };

    const answers =
        options.length === 0 ? null : (
            <View
                testID={`${testID}-results`}
                role="group"
                aria-label={t('account:dietary.leaveOut.searchLabel')}
                className={cx(
                    'rounded-[18px] bg-surface-raised p-1.5',
                    inline
                        ? 'absolute inset-x-0 top-[60px] z-30 border border-stroke-subtle shadow-elevation-4'
                        : 'mt-2',
                )}
            >
                {settled && matches.length === 0 ? (
                    <RNText
                        testID={`${testID}-none`}
                        className="px-3 pb-2.5 pt-3.5 text-sm font-semibold text-content-secondary text-start"
                    >
                        {failed
                            ? t('account:dietary.leaveOut.searchFailed')
                            : t('account:dietary.leaveOut.noMatch', { text })}
                    </RNText>
                ) : null}
                {options.map((option, index) => {
                    const free = option.type === 'free';
                    const on = index === highlighted;
                    return (
                        <View key={free ? 'free' : String(option.match.id)}>
                            {free && (matches.length > 0 || settled) ? (
                                <View className="mx-2 my-1.5 h-px bg-stroke-subtle" />
                            ) : null}
                            <Pressable
                                testID={
                                    free
                                        ? `${testID}-as-written`
                                        : `${testID}-option-${String(option.match.id)}`
                                }
                                role="button"
                                accessibilityRole="button"
                                accessibilityState={{ selected: on, disabled: option.added }}
                                disabled={option.added}
                                onPress={() => {
                                    take(option);
                                }}
                                onHoverIn={() => {
                                    if (!option.added) setActive(index);
                                }}
                                className={cx(
                                    'flex-row items-center gap-3 rounded-xl px-2.5 py-2',
                                    on ? 'bg-surface-brand-subtle' : null,
                                )}
                            >
                                <View
                                    className={cx(
                                        'h-9 w-9 items-center justify-center rounded-[11px]',
                                        free ? 'bg-surface-base' : 'bg-surface-brand-subtle',
                                    )}
                                >
                                    <Icon
                                        name={free ? 'typeText' : 'salad'}
                                        size="sm"
                                        className={
                                            free
                                                ? 'text-content-primary'
                                                : 'text-content-on-brand-subtle'
                                        }
                                    />
                                </View>
                                <View className="min-w-0 flex-1">
                                    {free ? (
                                        <RNText className="text-sm font-semibold text-content-primary text-start">
                                            {t('account:dietary.leaveOut.addAsWritten', {
                                                text: option.text,
                                            })}
                                        </RNText>
                                    ) : (
                                        <>
                                            <Highlighted name={option.match.name} term={text} />
                                            {option.match.category === null ? null : (
                                                <RNText className="text-xs font-medium text-content-secondary text-start">
                                                    {option.match.category}
                                                </RNText>
                                            )}
                                        </>
                                    )}
                                </View>
                                {option.added ? (
                                    <View
                                        testID={`${testID}-added-${free ? 'free' : String(option.match.id)}`}
                                        className="h-6 flex-row items-center gap-1 rounded-full bg-surface-base px-2.5"
                                    >
                                        <Icon
                                            name="check"
                                            size="sm"
                                            className="text-content-secondary"
                                        />
                                        <RNText className="text-xs font-bold text-content-secondary">
                                            {t('account:dietary.leaveOut.added')}
                                        </RNText>
                                    </View>
                                ) : on ? (
                                    <Icon
                                        name="cornerDownLeft"
                                        size="sm"
                                        className="text-content-secondary"
                                    />
                                ) : null}
                            </Pressable>
                        </View>
                    );
                })}
            </View>
        );

    return (
        <View className={cx('z-auto', inline ? 'mt-3 max-w-[560px]' : 'min-h-0 shrink')}>
            <View className="h-[52px] flex-row items-center gap-2.5 rounded-2xl border-2 border-surface-brand bg-surface-raised pe-2 ps-4 shadow-[0_0_0_4px_rgb(var(--h360-color-brand-surface)/0.12)]">
                <Icon name="searchLens" size="md" className="text-content-secondary" />
                <TextInput
                    testID={`${testID}-input`}
                    accessibilityLabel={t('account:dietary.leaveOut.searchLabel')}
                    placeholder={t('account:dietary.leaveOut.searchPlaceholder')}
                    value={query}
                    autoFocus
                    maxLength={60}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="done"
                    submitBehavior="submit"
                    onChangeText={(next: string) => {
                        setActive(0);
                        onQuery(next);
                    }}
                    onSubmitEditing={() => {
                        take(options[highlighted]);
                    }}
                    onKeyPress={(event) => {
                        const key = event.nativeEvent.key;
                        if (key === 'ArrowDown' || key === 'ArrowUp') {
                            event.preventDefault();
                            move(key === 'ArrowDown' ? 1 : -1);
                        } else if (key === 'Escape') {
                            onClose();
                        }
                    }}
                    className="h-full min-w-0 flex-1 text-base font-medium text-content-primary text-start web:outline-none"
                />
                <Pressable
                    testID={`${testID}-close`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('account:dietary.leaveOut.close')}
                    onPress={onClose}
                    className="h-9 w-9 items-center justify-center rounded-[10px] bg-surface-base hover:bg-stroke-subtle"
                >
                    <Icon name="close" size="sm" className="text-content-primary" />
                </Pressable>
            </View>
            {inline || answers === null ? (
                answers
            ) : (
                // In the phone sheet the answers scroll under the field, which stays put.
                <ScrollView className="min-h-0 shrink" keyboardShouldPersistTaps="handled">
                    {answers}
                </ScrollView>
            )}
        </View>
    );
}

/** The name, with the part that matches what was typed picked out in the brand colour. */
function Highlighted({ name, term }: { readonly name: string; readonly term: string }) {
    const at = name.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    let body: ReactNode = name;
    if (at >= 0 && term !== '') {
        body = (
            <>
                {name.slice(0, at)}
                <RNText className="font-extrabold text-content-on-brand-subtle">
                    {name.slice(at, at + term.length)}
                </RNText>
                {name.slice(at + term.length)}
            </>
        );
    }
    return (
        <RNText className="text-sm font-semibold leading-5 text-content-primary text-start">
            {body}
        </RNText>
    );
}

/** The food just picked, and how strictly to leave it out — then Cancel or Add. */
function KindChoice({
    testID,
    pending,
    onCancel,
    onConfirm,
}: {
    readonly testID: string;
    readonly pending: Pending;
    readonly onCancel: () => void;
    readonly onConfirm: (kind: FoodExclusionKind) => void;
}) {
    const { t } = useTranslation();
    const [kind, setKind] = useState<FoodExclusionKind>('dislike');
    const label = pending.subject === 'ingredient' ? pending.match.name : pending.text;
    return (
        <View
            testID={testID}
            className="mt-3 max-w-[560px] rounded-[18px] border border-stroke-subtle bg-surface-raised p-3.5 shadow-elevation-2"
        >
            <View className="mb-2.5 flex-row">
                <FoodChip
                    testID={`${testID}-chip`}
                    label={label}
                    asWritten={pending.subject === 'freeText'}
                    kind={null}
                    fresh
                />
            </View>
            <View
                testID={`${testID}-kind`}
                role="radiogroup"
                aria-label={t('account:dietary.leaveOut.kindFor', { name: label })}
                className="flex-row gap-1 rounded-2xl bg-surface-base p-1"
            >
                {FOOD_EXCLUSION_KINDS.map((option) => {
                    const on = kind === option;
                    const never = option === 'forbidden';
                    return (
                        <Pressable
                            key={option}
                            testID={`${testID}-kind-${option}`}
                            role="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on }}
                            onPress={() => {
                                setKind(option);
                            }}
                            className={cx(
                                'h-[46px] flex-1 flex-row items-center justify-center gap-2 rounded-xl px-2',
                                on
                                    ? never
                                        ? 'bg-danger-strong shadow-elevation-2'
                                        : 'bg-surface-raised shadow-elevation-1'
                                    : 'hover:bg-surface-raised',
                            )}
                        >
                            <Icon
                                name={KIND_ICONS[option]}
                                size="md"
                                className={
                                    on
                                        ? never
                                            ? 'text-danger-on-strong'
                                            : 'text-content-primary'
                                        : 'text-content-secondary'
                                }
                            />
                            <RNText
                                numberOfLines={1}
                                className={cx(
                                    'shrink text-sm',
                                    on
                                        ? never
                                            ? 'font-bold text-danger-on-strong'
                                            : 'font-bold text-content-primary'
                                        : 'font-semibold text-content-secondary',
                                )}
                            >
                                {t(`account:dietary.leaveOut.kind.${option}`)}
                            </RNText>
                        </Pressable>
                    );
                })}
            </View>
            <View className="mt-3 flex-row justify-end gap-2">
                <Pressable
                    testID={`${testID}-cancel`}
                    role="button"
                    accessibilityRole="button"
                    onPress={onCancel}
                    className="h-11 justify-center rounded-[13px] border border-stroke bg-surface-raised px-[18px] hover:bg-surface-brand-subtle"
                >
                    <RNText className="text-sm font-bold text-content-primary">
                        {t('account:dietary.leaveOut.cancel')}
                    </RNText>
                </Pressable>
                <Pressable
                    testID={`${testID}-confirm`}
                    role="button"
                    accessibilityRole="button"
                    onPress={() => {
                        onConfirm(kind);
                    }}
                    className="h-11 justify-center rounded-[13px] bg-surface-brand px-[18px] hover:bg-surface-canopy"
                >
                    <RNText className="text-sm font-bold text-content-on-brand">
                        {t('account:dietary.leaveOut.confirm')}
                    </RNText>
                </Pressable>
            </View>
        </View>
    );
}
