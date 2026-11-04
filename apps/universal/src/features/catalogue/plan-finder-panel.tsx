import { cx } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import type { CalorieLevel, FinderAnswers, FinderOptions } from './plan-finder.ts';

/**
 * "Find your plan" — the accepted board's three segmented questions in one white bar, and the best
 * match beside them on the canopy. The answers are the page's own (`plan-finder.ts`).
 */
export function PlanFinder({
    options,
    answers,
    onChange,
    matchName,
}: {
    readonly options: FinderOptions;
    readonly answers: FinderAnswers;
    readonly onChange: (next: FinderAnswers) => void;
    readonly matchName: string | null;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const question = <T extends string | number>(
        key: string,
        label: string,
        values: readonly T[],
        current: T | null,
        text: (value: T) => string,
        pick: (value: T) => void,
    ) =>
        values.length === 0 ? null : (
            <View
                key={key}
                className="grow flex-row items-center gap-2.5 rounded-2xl bg-surface-base py-1.5 pe-1.5 ps-3"
            >
                <RNText className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                    {label}
                </RNText>
                <View
                    testID={`plans-finder-${key}`}
                    role="radiogroup"
                    aria-label={label}
                    className="grow flex-row gap-1 rounded-[14px] bg-surface-raised p-1"
                >
                    {values.map((value) => {
                        const on = value === current;
                        return (
                            <Pressable
                                key={String(value)}
                                testID={`plans-finder-${key}-${String(value)}`}
                                role="radio"
                                aria-checked={on}
                                accessibilityState={{ checked: on }}
                                onPress={() => {
                                    pick(value);
                                }}
                                className={cx(
                                    'h-9 grow items-center justify-center rounded-[10px] px-2.5 transition duration-normal ease-standard',
                                    on ? 'bg-surface-brand' : '',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'font-display text-sm font-bold',
                                        on ? 'text-content-on-brand' : 'text-content-secondary',
                                    )}
                                >
                                    {text(value)}
                                </RNText>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
        );

    return (
        <View
            testID="plans-finder"
            aria-label={t('catalogue:plans.finderLabel')}
            className="mt-3 flex-row flex-wrap gap-2 rounded-[26px] border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-2"
        >
            {question(
                'meals',
                t('catalogue:plans.finderMeals'),
                options.meals,
                answers.meals,
                (value) => formatter.formatNumber(value),
                (value) => {
                    onChange({ ...answers, meals: value });
                },
            )}
            {question(
                'days',
                t('catalogue:plans.finderDays'),
                options.days,
                answers.days,
                (value) => t('catalogue:plans.finderDaysValue', { count: value }),
                (value) => {
                    onChange({ ...answers, days: value });
                },
            )}
            {question<CalorieLevel>(
                'level',
                t('catalogue:plans.finderCalories'),
                options.levels,
                answers.level,
                (value) => t(`catalogue:plans.level.${value}`),
                (value) => {
                    onChange({ ...answers, level: value });
                },
            )}
            <View
                testID="plans-finder-match"
                role="status"
                className="min-w-[200px] grow justify-center gap-0.5 rounded-[18px] bg-surface-canopy px-[18px] py-2.5"
            >
                <RNText className="text-xs text-content-on-canopy-muted">
                    {t('catalogue:plans.bestMatch')}
                </RNText>
                <RNText
                    numberOfLines={1}
                    className="font-display text-lg font-bold text-content-on-canopy"
                >
                    {matchName ?? t('catalogue:card.noFigure')}
                </RNText>
            </View>
        </View>
    );
}
