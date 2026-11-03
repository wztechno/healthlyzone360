import type { IngredientAllergenMapping } from '@healthy360/api-client/contracts';
import { Badge, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ALLERGEN_CODES } from '../../onboarding/vocabularies.ts';
import { TileEmpty } from './record-tiles.tsx';

/**
 * Every allergen group at once, each in one of three states: **contains**, **may contain**, or
 * **free from**. A reader checking a record for one allergen sees the answer for all fourteen,
 * including the ones that are not there — which is the question a kitchen is usually asking.
 *
 * ## Free from is the absence of a mapping, and only once somebody has looked
 *
 * The contract has two containments and no third (`ALLERGEN_CONTAINMENTS`): an allergen the
 * record does not map is one it does not carry. That holds only for a record somebody assessed.
 * An ingredient with no mapping and no `allergensAssessedClear` has simply not been recorded, and
 * drawing fourteen "free from" pills over it would be the most dangerous lie this page could tell,
 * so it says it has not been recorded instead.
 *
 * Codes beyond the fourteen — a kitchen's own allergen class — are drawn after them, named the way
 * the old chip row named them.
 */

type PillState = 'contains' | 'may' | 'free';

const PILL_CLASS: Readonly<Record<PillState, string>> = {
    contains: 'border-danger-border bg-danger-subtle',
    may: 'border-warning-border bg-warning-subtle',
    free: 'border-dashed border-stroke',
};

const PILL_TEXT_TONE: Readonly<Record<PillState, 'danger' | 'warning' | 'secondary'>> = {
    contains: 'danger',
    may: 'warning',
    free: 'secondary',
};

const MARK_CLASS: Readonly<Record<PillState, string>> = {
    contains: 'bg-danger',
    may: 'bg-warning',
    free: 'border border-stroke-strong',
};

const RANK: Readonly<Record<PillState, number>> = { contains: 0, may: 1, free: 2 };

export interface AllergenBoardProps {
    readonly mappings: readonly IngredientAllergenMapping[];
    /** Somebody checked the record and found it carries none. */
    readonly assessedClear: boolean;
    /** Translated diet names. */
    readonly diets: readonly string[];
    readonly noValue: string;
    readonly testID: string;
}

export function AllergenBoard({
    mappings,
    assessedClear,
    diets,
    noValue,
    testID,
}: AllergenBoardProps) {
    const { t } = useTranslation();
    const assessed = mappings.length > 0 || assessedClear;

    const stateOf = new Map<string, PillState>(
        mappings.map((mapping) => [
            String(mapping.allergenCode),
            mapping.containment === 'contains' ? 'contains' : 'may',
        ]),
    );
    const codes = [
        ...ALLERGEN_CODES,
        ...[...stateOf.keys()].filter(
            (code) => !(ALLERGEN_CODES as readonly string[]).includes(code),
        ),
    ];
    const stateWord: Readonly<Record<PillState, string>> = {
        contains: t('kitchen:containment.contains'),
        may: t('kitchen:containment.mayContain'),
        free: t('kitchen:allergenBoard.freeFrom'),
    };
    const pills = codes
        .map((code, order) => {
            const state = stateOf.get(code) ?? 'free';
            return {
                code,
                state,
                order,
                name: t(`marketplace:allergens.${code}`, { defaultValue: code }),
            };
        })
        .sort((a, b) => RANK[a.state] - RANK[b.state] || a.order - b.order);

    return (
        <View testID={testID} className="flex-col gap-snug">
            {assessed ? (
                <View
                    testID={`${testID}-list`}
                    role="list"
                    aria-label={t('kitchen:allergenBoard.listLabel')}
                    className="flex-row flex-wrap gap-1.5"
                >
                    {pills.map((pill) => (
                        <View
                            key={pill.code}
                            testID={`${testID}-${pill.code}-${pill.state}`}
                            role="listitem"
                            aria-label={t('kitchen:allergenBoard.pillLabel', {
                                state: stateWord[pill.state],
                                allergen: pill.name,
                            })}
                            className={`h-7 min-w-0 flex-row items-center gap-1.5 rounded-full border px-snug ${PILL_CLASS[pill.state]}`}
                            // eslint-disable-next-line no-restricted-syntax -- a pill in a wrapping run, not a control: a row's pills share its width.
                            style={{ flexBasis: 128, flexGrow: 1 }}
                        >
                            <View
                                aria-hidden
                                className={`h-2 w-2 shrink-0 rounded-full ${MARK_CLASS[pill.state]}`}
                            />
                            <Text
                                variant={pill.state === 'free' ? 'label' : 'strong'}
                                tone={PILL_TEXT_TONE[pill.state]}
                                numberOfLines={1}
                            >
                                {pill.name}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : (
                <TileEmpty
                    testID={`${testID}-not-assessed`}
                    tone="warning"
                    text={t('kitchen:allergens.notAssessed')}
                />
            )}

            <View className="flex-row flex-wrap items-center gap-tight border-t border-stroke-subtle pt-snug">
                <View className="min-w-[48px]">
                    <Text variant="label" tone="secondary">
                        {t('kitchen:allergenBoard.diets')}
                    </Text>
                </View>
                {diets.length === 0 ? (
                    <Text variant="body" tone="secondary" testID={`${testID}-no-diets`}>
                        {noValue}
                    </Text>
                ) : (
                    diets.map((diet) => (
                        <Badge
                            key={diet}
                            tone="brand"
                            icon="check"
                            label={diet}
                            testID={`${testID}-diet`}
                        />
                    ))
                )}
            </View>
        </View>
    );
}

/** The board's key — what each of the three pill styles means — for its tile's head. */
export function AllergenBoardKey() {
    const { t } = useTranslation();

    return (
        <View className="flex-row flex-wrap items-center gap-snug">
            {(
                [
                    ['contains', t('kitchen:containment.contains')],
                    ['may', t('kitchen:containment.mayContain')],
                    ['free', t('kitchen:allergenBoard.freeFrom')],
                ] as const
            ).map(([state, label]) => (
                <View key={state} className="flex-row items-center gap-1">
                    <View aria-hidden className={`h-2 w-2 rounded-full ${MARK_CLASS[state]}`} />
                    <Text variant="label" tone="secondary">
                        {label}
                    </Text>
                </View>
            ))}
        </View>
    );
}
