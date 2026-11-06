import type {
    AllergenDeclaration,
    AllergenSeverity,
    DietaryProfile,
} from '@healthy360/api-client/contracts';
import { Icon, InfoTip, cx, useBreakpoint, useToast } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, TextInput, View } from 'react-native';

import {
    toFailure,
    useDietaryProfileQuery,
    useSaveDietaryProfileMutation,
} from '../../data/account-hooks.ts';
import type { UnsavedGuard } from '../../navigation/use-unsaved-guard.ts';
import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../marketplace/query-states.tsx';
import { ALLERGEN_CODES } from '../onboarding/vocabularies.ts';
import { ACCOUNT_CARD, PanelHead } from './account-card.tsx';
import { ALLERGEN_SEVERITIES, declarationsFor, initialAllergyAnswer } from './dietary.ts';

/**
 * Allergies — the store of record for what a person cannot eat, as the accepted Account board's
 * Allergies pane draws it: "Any food allergies?" with Yes and No, then the fourteen allergens as
 * tiles — each with what it covers, ticked in amber — and under a ticked one how strictly to avoid
 * it and a note; "No" shows a calm green "No allergies". The account page shows it as a section; the
 * allergies route shows the same pane for the flows (checkout, plan setup) that send a person here
 * and expect to be sent back.
 *
 * ## Why there is a Yes/No question in front of the tiles
 *
 * "No allergies" and "has not said yet" are different facts, and only one of them completes the
 * step. An empty list cannot tell them apart. The contract's `DietaryProfile.updatedAt` is what
 * distinguishes them, and the question is what lets a person *say* no rather than leave a list empty
 * and hope. Answering "no" saves an empty declaration — a real answer with a real timestamp.
 *
 * ## The list is kept while the answer is "no"
 *
 * Flipping to "no" clears what is *saved*, not what is on screen: somebody who ticks peanuts,
 * changes their mind, then changes it back should not have to tick peanuts again (`./dietary.ts`).
 *
 * ## Severity is asked, not assumed
 *
 * Ticking an allergen declares it at `allergy` — the strictest reading, the only one the configurator
 * treats as a hard exclusion. A person may then soften it. Defaulting the other way round would let a
 * mis-tap quietly downgrade a safety constraint to a preference.
 *
 * ## What it saves, and what it leaves alone
 *
 * The allergens only. The diet is the Profile pane's and the ingredient exclusions have no control
 * here, so both are carried through as stored rather than sent empty.
 *
 * The board's "Foods you avoid" row is not drawn: there is no way here to search the kitchens'
 * ingredients to add one, and a row that could only show what something else stored would invite a
 * press that does nothing.
 */

const ANSWERS = ['yes', 'no'] as const;
type Answer = (typeof ANSWERS)[number];

/** Component state, seeded from the profile the first time it arrives. */
interface Edit {
    readonly answer: Answer | null;
    readonly allergens: readonly AllergenDeclaration[];
    /** `updatedAt` of the profile this edit was seeded from — `null` before the first save. */
    readonly from: string | null;
}

function seed(profile: DietaryProfile): Edit {
    const answered = initialAllergyAnswer(profile);
    return {
        answer: answered === null ? null : answered ? 'yes' : 'no',
        allergens: profile.allergens,
        from: profile.updatedAt,
    };
}

export interface AllergiesPanelProps {
    readonly testID: string;
    /** Marks the page dirty while there is an unsaved change, so leaving asks first. */
    readonly guard?: UnsavedGuard | undefined;
    /** After a save — the route sends the person back to the flow that asked. */
    readonly onSaved?: (() => void) | undefined;
    /** Cancel: back to where the person came from. Absent, Cancel only drops the edit. */
    readonly onCancel?: (() => void) | undefined;
}

export function AllergiesPanel({ testID, guard, onSaved, onCancel }: AllergiesPanelProps) {
    const { t } = useTranslation();
    const toast = useToast();
    const { atLeast } = useBreakpoint();
    const profile = useDietaryProfileQuery();
    const save = useSaveDietaryProfileMutation();
    const [edit, setEdit] = useState<Edit | null>(null);

    /*
     * Derived rather than pushed by an effect, on the address editor's rule: the refetch that follows
     * a save would otherwise overwrite the very edit that caused it.
     */
    const loaded = profile.data;
    const current: Edit =
        loaded === undefined
            ? { answer: null, allergens: [], from: null }
            : edit !== null && edit.from === loaded.updatedAt
              ? edit
              : seed(loaded);
    const dirty = edit !== null && edit.from === (loaded?.updatedAt ?? null);

    const set = (patch: Partial<Edit>) => {
        guard?.markDirty();
        setEdit({ ...current, ...patch, from: loaded?.updatedAt ?? null });
    };

    const declared = new Map(current.allergens.map((entry) => [entry.allergenCode, entry]));
    const toggle = (code: string) => {
        set({
            allergens: declared.has(code)
                ? current.allergens.filter((entry) => entry.allergenCode !== code)
                : [...current.allergens, { allergenCode: code, severity: 'allergy', note: null }],
        });
    };
    const amend = (code: string, patch: Partial<AllergenDeclaration>) => {
        set({
            allergens: current.allergens.map((entry) =>
                entry.allergenCode === code ? { ...entry, ...patch } : entry,
            ),
        });
    };

    /*
     * Shop · Account, pin 2: a failed save is the shop's danger toast with Try again, in place of
     * the full-width red box; the edit stays on screen to try again from.
     */
    const submit = () => {
        save.mutate(
            {
                // Carried through: the diet is the Profile pane's.
                dietCategoryCode: loaded?.dietCategoryCode ?? null,
                allergens: declarationsFor(current.answer === 'yes', current.allergens),
                // No control for exclusions here: what is stored is kept, not silently dropped.
                excludedIngredientIds: loaded?.excludedIngredientIds ?? [],
            },
            {
                onSuccess: () => {
                    // Drop the local edit so the saved profile becomes the seed.
                    setEdit(null);
                    guard?.markClean();
                    toast.show({
                        testID: `${testID}-saved-toast`,
                        tone: 'success',
                        message: t('account:dietary.savedToast'),
                    });
                    onSaved?.();
                },
                onError: (error) => {
                    toast.show({
                        testID: `${testID}-error`,
                        tone: 'danger',
                        message: toFailure(error)?.message ?? t('account:saveFailed'),
                        title: t('account:saveFailed'),
                        action: {
                            label: t('errors:generic.retry'),
                            testID: `${testID}-error-retry`,
                            onPress: submit,
                        },
                    });
                },
            },
        );
    };
    const savedCount = loaded === undefined ? 0 : loaded.allergens.length;
    const columns = atLeast('lg') ? 3 : atLeast('md') ? 2 : 1;
    const rows: string[][] = [];
    ALLERGEN_CODES.forEach((code, index) => {
        (rows[Math.floor(index / columns)] ??= []).push(code);
    });
    const question = t('account:dietary.anyAllergies');

    return (
        <View testID={testID} className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead
                testID={`${testID}-title`}
                title={t('account:nav.allergies')}
                count={t('account:dietary.declaredCount', { count: savedCount })}
            />

            <QueryStates
                skeleton="form"
                query={profile}
                isEmpty={false}
                emptyTitle={t('account:dietary.title')}
                skeletonCount={2}
                testID={`${testID}-profile`}
            >
                <View className="flex-row flex-wrap items-center gap-4 rounded-[20px] bg-surface-base px-[18px] py-4">
                    <Icon name="alert" size="md" className="text-warning-on-subtle" />
                    <RNText className="min-w-0 flex-1 text-base font-bold text-content-primary text-start">
                        {question}
                    </RNText>
                    <View
                        testID={`${testID}-answer`}
                        role="radiogroup"
                        aria-label={question}
                        className="flex-row gap-1 rounded-[14px] border border-stroke-subtle bg-surface-raised p-1"
                    >
                        {ANSWERS.map((answer) => {
                            const on = current.answer === answer;
                            return (
                                <Pressable
                                    key={answer}
                                    testID={`${testID}-answer-${answer}`}
                                    role="radio"
                                    aria-checked={on}
                                    accessibilityState={{ checked: on, selected: on }}
                                    onPress={() => {
                                        set({ answer });
                                    }}
                                    className={cx(
                                        'h-11 min-w-[92px] items-center justify-center rounded-[11px] px-4',
                                        on ? 'bg-content-primary' : 'hover:bg-surface-base',
                                    )}
                                >
                                    <RNText
                                        className={cx(
                                            'text-sm font-bold',
                                            on ? 'text-surface-base' : 'text-content-secondary',
                                        )}
                                    >
                                        {t(`account:dietary.answerShort.${answer}`)}
                                    </RNText>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {current.answer === null ? (
                    <RNText
                        testID={`${testID}-unanswered`}
                        className="mt-3.5 text-sm text-content-secondary text-start"
                    >
                        {t('account:dietary.unanswered')}
                    </RNText>
                ) : null}

                {current.answer === 'no' ? (
                    <View
                        testID={`${testID}-none`}
                        className="mt-3.5 flex-row items-center gap-3.5 rounded-[20px] bg-surface-brand-subtle p-[18px]"
                    >
                        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-brand">
                            <Icon name="check" size="md" className="text-content-on-brand" />
                        </View>
                        <View className="min-w-0 flex-1">
                            <RNText className="text-base font-bold text-content-on-brand-subtle text-start">
                                {t('account:dietary.noAllergies')}
                            </RNText>
                            <RNText className="text-sm text-content-on-brand-subtle text-start">
                                {t('account:dietary.noneBody')}
                            </RNText>
                        </View>
                    </View>
                ) : null}

                {current.answer === 'yes' ? (
                    <View testID={`${testID}-allergens`}>
                        <RNText className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                            {`${t('account:dietary.allergensTitle')} · ${t(
                                'account:dietary.tickedCount',
                                {
                                    count: current.allergens.length,
                                },
                            )}`}
                        </RNText>
                        <View
                            role="group"
                            aria-label={t('account:dietary.allergensTitle')}
                            className="flex-col gap-2.5"
                        >
                            {rows.map((row, rowIndex) => (
                                <View key={String(rowIndex)} className="flex-row gap-2.5">
                                    {Array.from({ length: columns }, (_, column) => {
                                        const code = row[column];
                                        if (code === undefined) {
                                            return (
                                                <View
                                                    key={column}
                                                    className="min-w-0 flex-1 p-3.5"
                                                />
                                            );
                                        }
                                        const on = declared.has(code);
                                        return (
                                            <Pressable
                                                key={code}
                                                testID={`${testID}-allergens-${code}`}
                                                role="checkbox"
                                                aria-checked={on}
                                                accessibilityState={{
                                                    checked: on,
                                                    selected: on,
                                                    disabled: save.isPending,
                                                }}
                                                disabled={save.isPending}
                                                onPress={() => {
                                                    toggle(code);
                                                }}
                                                className={cx(
                                                    'min-w-0 flex-1 flex-row items-start gap-3 rounded-[18px] border-[1.5px] p-3.5',
                                                    on
                                                        ? 'border-warning-border bg-warning-subtle'
                                                        : 'border-stroke-subtle bg-surface-raised hover:border-stroke',
                                                )}
                                            >
                                                <View
                                                    className={cx(
                                                        'h-6 w-6 items-center justify-center rounded-lg border-2',
                                                        on
                                                            ? 'border-warning-on-subtle bg-warning-on-subtle'
                                                            : 'border-stroke bg-surface-raised',
                                                    )}
                                                >
                                                    {on ? (
                                                        <Icon
                                                            name="check"
                                                            size="sm"
                                                            className="text-surface-raised"
                                                        />
                                                    ) : null}
                                                </View>
                                                <View className="min-w-0 flex-1">
                                                    <RNText className="text-base font-bold text-content-primary text-start">
                                                        {t(`onboarding:allergens.${code}`)}
                                                    </RNText>
                                                    <RNText className="mt-0.5 text-xs leading-4 text-content-secondary text-start">
                                                        {t(`account:dietary.covers.${code}`)}
                                                    </RNText>
                                                </View>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ))}
                        </View>

                        {/*
                         * Plan meals & allergies, pin 5 (Shop · Account): how strictly to avoid each,
                         * one card per declared allergen — what it is and covers, then three answers
                         * side by side, then the note. "I am allergic" is the strictest and the only
                         * one that takes a meal out outright, which the (i) says.
                         */}
                        {current.allergens.length === 0 ? null : (
                            <View className="mt-[22px] flex-col gap-2.5">
                                <View className="flex-row items-center gap-1.5">
                                    <RNText className="text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                                        {t('account:dietary.howStrict')}
                                    </RNText>
                                    <InfoTip
                                        testID={`${testID}-allergens-how-strict-tip`}
                                        label={t('account:dietary.howStrict')}
                                        text={t('account:dietary.howStrictTip')}
                                    />
                                </View>
                                {current.allergens.map((entry) => (
                                    <SeverityCard
                                        key={entry.allergenCode}
                                        testID={`${testID}-allergens`}
                                        entry={entry}
                                        wide={atLeast('md')}
                                        disabled={save.isPending}
                                        onChange={(patch) => {
                                            amend(entry.allergenCode, patch);
                                        }}
                                    />
                                ))}
                            </View>
                        )}
                    </View>
                ) : null}

                <View className="mt-[18px]">
                    <MedicalDisclaimer context={t('account:dietary.disclaimerContext')} />
                </View>

                <View className="mt-5 flex-row flex-wrap items-center gap-2">
                    <Pressable
                        testID={`${testID}-save`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityState={{
                            disabled: current.answer === null || save.isPending,
                            busy: save.isPending,
                        }}
                        disabled={current.answer === null || save.isPending}
                        onPress={submit}
                        className={cx(
                            'h-12 flex-row items-center gap-2 rounded-[14px] px-5',
                            current.answer === null
                                ? 'bg-stroke-subtle'
                                : 'bg-surface-brand hover:bg-surface-canopy',
                        )}
                    >
                        {save.isPending ? <ActivityIndicator size="small" /> : null}
                        <RNText
                            className={cx(
                                'text-sm font-bold',
                                current.answer === null
                                    ? 'text-content-secondary'
                                    : 'text-content-on-brand',
                            )}
                        >
                            {t('account:profile.save')}
                        </RNText>
                    </Pressable>
                    <Pressable
                        testID={`${testID}-cancel`}
                        role="button"
                        accessibilityRole="button"
                        onPress={() => {
                            setEdit(null);
                            guard?.markClean();
                            onCancel?.();
                        }}
                        className="h-12 justify-center rounded-[14px] border border-stroke bg-surface-raised px-[18px] hover:bg-surface-brand-subtle"
                    >
                        <RNText className="text-sm font-semibold text-content-primary">
                            {t('account:profile.cancel')}
                        </RNText>
                    </Pressable>
                    {dirty ? null : save.isSuccess ? (
                        <View className="h-[34px] flex-row items-center gap-1.5 rounded-full bg-surface-brand-subtle px-3">
                            <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                            <RNText className="text-sm font-bold text-content-on-brand-subtle">
                                {t('account:dietary.saved')}
                            </RNText>
                        </View>
                    ) : null}
                </View>
            </QueryStates>
        </View>
    );
}

const SEVERITY_ICONS: Readonly<Record<AllergenSeverity, IconName>> = {
    avoidance: 'leaf',
    intolerance: 'circleHelp',
    allergy: 'shield',
};

/** One declared allergen: what it is, how strictly to avoid it, and anything to know. */
function SeverityCard({
    testID,
    entry,
    wide,
    disabled,
    onChange,
}: {
    readonly testID: string;
    readonly entry: AllergenDeclaration;
    readonly wide: boolean;
    readonly disabled: boolean;
    readonly onChange: (patch: Partial<AllergenDeclaration>) => void;
}) {
    const { t } = useTranslation();
    const code = entry.allergenCode;
    const name = t(`onboarding:allergens.${code}`);
    const strict = entry.severity === 'allergy';
    return (
        <View
            testID={`${testID}-row-${code}`}
            className={cx(
                'gap-x-4 gap-y-2.5 rounded-[20px] border p-3.5',
                wide ? 'flex-row flex-wrap items-center' : 'flex-col',
                strict
                    ? 'border-danger-border bg-danger-subtle'
                    : 'border-stroke-subtle bg-surface-raised',
            )}
        >
            <View className={cx('flex-row items-center gap-3', wide ? 'w-[230px]' : null)}>
                <View
                    className={cx(
                        'h-11 w-11 items-center justify-center rounded-[14px]',
                        strict ? 'bg-danger-strong' : 'bg-warning-subtle',
                    )}
                >
                    <Icon
                        name="alert"
                        size="md"
                        className={strict ? 'text-danger-on-strong' : 'text-warning-on-subtle'}
                    />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText className="text-base font-bold leading-5 text-content-primary text-start">
                        {name}
                    </RNText>
                    <RNText className="text-xs leading-4 text-content-secondary text-start">
                        {t(`account:dietary.covers.${code}`)}
                    </RNText>
                </View>
            </View>
            <View
                testID={`${testID}-severity-${code}`}
                role="radiogroup"
                aria-label={t('account:dietary.severityFor', { allergen: name })}
                className={cx(
                    'min-w-0 gap-1 rounded-2xl bg-surface-base p-1',
                    wide ? 'flex-1 flex-row' : 'flex-col',
                )}
            >
                {ALLERGEN_SEVERITIES.map((severity) => {
                    const on = entry.severity === severity;
                    return (
                        <Pressable
                            key={severity}
                            testID={`${testID}-severity-${code}-${severity}`}
                            role="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on, disabled }}
                            disabled={disabled}
                            onPress={() => {
                                onChange({ severity });
                            }}
                            className={cx(
                                'h-11 flex-row items-center gap-2 rounded-xl px-3',
                                wide ? 'flex-1 justify-center' : 'justify-start',
                                on
                                    ? severity === 'allergy'
                                        ? 'bg-danger-strong shadow-elevation-2'
                                        : severity === 'intolerance'
                                          ? 'bg-warning-subtle'
                                          : 'bg-surface-raised shadow-elevation-1'
                                    : 'hover:bg-surface-raised',
                            )}
                        >
                            <Icon
                                name={SEVERITY_ICONS[severity]}
                                size="md"
                                className={
                                    on
                                        ? severity === 'allergy'
                                            ? 'text-danger-on-strong'
                                            : severity === 'intolerance'
                                              ? 'text-warning-on-subtle'
                                              : 'text-content-on-brand-subtle'
                                        : 'text-content-secondary'
                                }
                            />
                            <RNText
                                numberOfLines={1}
                                className={cx(
                                    'shrink text-sm',
                                    on
                                        ? severity === 'allergy'
                                            ? 'font-bold text-danger-on-strong'
                                            : severity === 'intolerance'
                                              ? 'font-bold text-warning-on-subtle'
                                              : 'font-bold text-content-primary'
                                        : 'font-semibold text-content-secondary',
                                )}
                            >
                                {t(`account:dietary.severity.${severity}`)}
                            </RNText>
                        </Pressable>
                    );
                })}
            </View>
            <View
                className={cx('flex-row items-center gap-2.5', wide ? 'w-full ps-[246px]' : null)}
            >
                <RNText className="text-sm font-semibold text-content-primary">
                    {t('account:dietary.noteLabel')}
                </RNText>
                <View className="h-11 min-w-0 flex-1 justify-center rounded-xl border border-stroke bg-surface-raised px-3.5">
                    <TextInput
                        testID={`${testID}-note-${code}`}
                        accessibilityLabel={t('account:dietary.noteLabel')}
                        placeholder={t('account:dietary.notePlaceholder')}
                        value={entry.note ?? ''}
                        editable={!disabled}
                        onChangeText={(note: string) => {
                            // Empty is `null`, not `''`: the contract's note is "there is a note or
                            // there is not".
                            onChange({ note: note.trim() === '' ? null : note });
                        }}
                        className="h-full w-full text-sm text-content-primary"
                    />
                </View>
            </View>
        </View>
    );
}
