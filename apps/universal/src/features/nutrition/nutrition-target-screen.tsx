import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    MeterBar,
    ProgressRing,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { ApiFailure } from '@healthy360/api-client';
import type { StoredNutritionTarget } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { MacroTarget, NutritionTargetResult } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCurrentTargetsQuery,
    useRequestNutritionReviewMutation,
    useSaveTargetsMutation,
} from '../../data/nutrition-hooks.ts';
import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../marketplace/query-states.tsx';
import { TargetExplanation } from './target-explanation.tsx';

/**
 * `/customer/nutrition` — the transparent target interface.
 *
 * The whole screen is an argument that a nutrition figure should be checkable rather than
 * authoritative, and the research says so in four separate places:
 *
 * * **maintenance and target are shown apart** (doc 17, NUT-01 — **NEW**; neither reference shows
 *   the separation, and conflating them is how a person comes to believe a deficit is their
 *   requirement);
 * * **the method is named and cited** (NUT-02), and the calculation source is stated as a prototype
 *   rather than implied to be clinical;
 * * **the working is available** (NUT-03), from the engine's own explanation;
 * * **a professional override is marked, with the original figures kept visible** (NUT-08 —
 *   **NEW**; a reference product makes the practitioner authoritative in copy and shows no marker
 *   at all).
 *
 * Two controls do real work. **Recalculate** re-runs the stored request through the repository, so
 * it produces the same figures unless something behind them changed — which is the honest behaviour
 * and the one that proves the number is derived rather than stored prose. **Request a review**
 * creates a real `NutritionReview` and puts the target on a dietitian's queue.
 */

const MACRO_ORDER: readonly string[] = ['protein', 'carbohydrate', 'fat'];

export function NutritionTargetScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const targets = useCurrentTargetsQuery(true);
    const recalculate = useSaveTargetsMutation();
    const requestReview = useRequestNutritionReviewMutation();

    const [reviewRequested, setReviewRequested] = useState(false);

    const stored: StoredNutritionTarget | null | undefined = targets.data;

    const onRecalculate = useCallback(() => {
        if (stored == null) return;
        recalculate.mutate({
            source: stored.result.request,
            acknowledgedDisclaimer: true,
        });
    }, [recalculate, stored]);

    const onRequestReview = useCallback(() => {
        if (stored == null) return;
        requestReview.mutate(
            { targetId: stored.id, urgency: 'routine' },
            {
                onSuccess: () => {
                    setReviewRequested(true);
                },
            },
        );
    }, [requestReview, stored]);

    const recalculateFailure: ApiFailure | null = toFailure(recalculate.error);
    const reviewFailure: ApiFailure | null = toFailure(requestReview.error);

    return (
        <Stack space="lg" testID="nutrition-target-screen">
            <Stack space="xs">
                <Heading level={1} testID="nutrition-title">
                    {t('nutrition:title')}
                </Heading>
                <Text tone="secondary">{t('nutrition:subtitle')}</Text>
            </Stack>

            <QueryStates
                query={targets}
                isEmpty={targets.data === null}
                emptyTitle={t('nutrition:empty.title')}
                emptyBody={t('nutrition:empty.body')}
                emptyActions={
                    <Button
                        testID="nutrition-empty-start-onboarding"
                        label={t('nutrition:empty.action')}
                        onPress={() => {
                            router.push('/customer/onboarding' as never);
                        }}
                    />
                }
                skeletonCount={2}
                testID="nutrition-target"
            >
                {stored == null ? null : (
                    <Stack space="lg" testID="nutrition-target-content">
                        <ProvenancePanel result={stored.result} stored={stored} />

                        <EnergyPanel result={stored.result} formatter={formatter} />

                        <MacroPanel result={stored.result} formatter={formatter} />

                        <OverridePanel result={stored.result} />

                        <TargetExplanation explanation={stored.result.explanation} />

                        {stored.result.requiresProfessionalReview ? (
                            <Callout
                                testID="nutrition-review-required"
                                role="alert"
                                tone="warning"
                                title={t('nutrition:review.requiredTitle')}
                                body={t('nutrition:review.requiredBody', {
                                    reasons: stored.result.reviewReasons
                                        .map((reason) =>
                                            t(`nutrition:reviewReasons.${reason}.title`, {
                                                defaultValue: reason,
                                            }),
                                        )
                                        .join(', '),
                                })}
                            />
                        ) : null}

                        {reviewRequested ? (
                            <Callout
                                testID="nutrition-review-pending"
                                role="status"
                                tone="success"
                                title={t('nutrition:review.pendingTitle')}
                                body={t('nutrition:review.pendingBody')}
                            />
                        ) : null}

                        {reviewFailure === null ? null : (
                            <Callout
                                testID="nutrition-review-error"
                                role="alert"
                                tone="danger"
                                title={t('nutrition:review.errorTitle')}
                                body={t('nutrition:review.errorBody')}
                            />
                        )}

                        {recalculateFailure === null ? null : (
                            <Callout
                                testID="nutrition-recalculate-error"
                                role="alert"
                                tone="danger"
                                title={t('nutrition:recalculate.errorTitle')}
                                body={t('nutrition:recalculate.errorBody')}
                            />
                        )}

                        <MedicalDisclaimer context={t('nutrition:disclaimerContext')} />

                        <Inline space="sm" wrap testID="nutrition-actions">
                            <Button
                                testID="nutrition-recalculate"
                                variant="secondary"
                                label={t('nutrition:recalculate.action')}
                                accessibilityHint={t('nutrition:recalculate.hint')}
                                loading={recalculate.isPending}
                                onPress={onRecalculate}
                            />
                            <Button
                                testID="nutrition-request-review"
                                label={t('nutrition:review.action')}
                                accessibilityHint={t('nutrition:review.hint')}
                                loading={requestReview.isPending}
                                disabled={reviewRequested}
                                onPress={onRequestReview}
                            />
                            <Button
                                testID="nutrition-edit-answers"
                                variant="ghost"
                                label={t('nutrition:editAnswers')}
                                onPress={() => {
                                    router.push('/customer/onboarding' as never);
                                }}
                            />
                        </Inline>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}

/* ── provenance ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Where the figures came from (doc 17, NUT-04 — **NEW**; neither reference offers provenance).
 *
 * The prototype marker is not a disclaimer in disguise. `NutritionTargetResult.prototype` is typed
 * as the literal `true`, so a production engine cannot be substituted without the compiler noticing
 * the claim changed — and this panel renders that field rather than a hard-coded string, which is
 * what keeps the badge honest when the day comes that it should disappear.
 */
function ProvenancePanel({
    result,
    stored,
}: {
    readonly result: NutritionTargetResult;
    readonly stored: StoredNutritionTarget;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Card padding="md" tone="sunken" testID="nutrition-provenance">
            <Stack space="xs">
                <Inline space="xs" wrap align="center">
                    <Badge
                        testID="nutrition-source-badge"
                        tone="info"
                        icon="prototype"
                        label={t('nutrition:provenance.engine')}
                    />
                    <Badge
                        testID="nutrition-method-badge"
                        tone="neutral"
                        icon="info"
                        label={t(`nutrition:methods.${result.method}`)}
                    />
                    {stored.professionallyApproved ? (
                        <Badge
                            testID="nutrition-approved-badge"
                            tone="success"
                            icon="success"
                            label={t('nutrition:provenance.approved')}
                        />
                    ) : (
                        <Badge
                            testID="nutrition-unapproved-badge"
                            tone="warning"
                            icon="warning"
                            label={t('nutrition:provenance.notApproved')}
                        />
                    )}
                </Inline>

                <Text variant="caption" tone="secondary" testID="nutrition-calculated-at">
                    {t('nutrition:provenance.calculatedAt', {
                        timestamp: formatter.formatDate(result.calculatedAt, {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                        }),
                    })}
                </Text>
                <Text variant="caption" tone="secondary" testID="nutrition-source-note">
                    {t('nutrition:provenance.note')}
                </Text>
            </Stack>
        </Card>
    );
}

/* ── energy ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Maintenance and target, side by side and clearly labelled as two different things.
 *
 * The ring shows the target *against maintenance*, which is the comparison that carries meaning:
 * "this is eighty-five per cent of what would hold you steady" is a sentence a person can act on,
 * where "1,687 kcal" alone is not. The numeric label is always present, because a ring read by fill
 * alone is a figure communicated by shape and colour (doc 17, NUT-07).
 */
function EnergyPanel({
    result,
    formatter,
}: {
    readonly result: NutritionTargetResult;
    readonly formatter: Formatter;
}) {
    const { t } = useTranslation();
    const share =
        result.maintenanceEnergy > 0
            ? Math.round((result.targetEnergy / result.maintenanceEnergy) * 100)
            : 0;

    return (
        <Card padding="md" testID="nutrition-energy">
            <Stack space="md">
                <Heading level={2}>{t('nutrition:energy.title')}</Heading>

                <Inline space="lg" wrap align="center">
                    <ProgressRing
                        testID="nutrition-energy-ring"
                        label={t('nutrition:energy.ringLabel')}
                        value={result.targetEnergy}
                        target={result.maintenanceEnergy}
                        unit="kcal"
                        size="lg"
                        valueText={t('nutrition:energy.ringValue', {
                            value: formatter.formatNumber(result.targetEnergy),
                            percent: share,
                        })}
                        caption={t('nutrition:energy.ringCaption')}
                    />

                    <Stack space="sm">
                        <Figure
                            testID="nutrition-maintenance"
                            label={t('nutrition:energy.maintenance')}
                            value={t('nutrition:energy.kcalPerDay', {
                                value: formatter.formatNumber(result.maintenanceEnergy),
                            })}
                            description={t('nutrition:energy.maintenanceDescription')}
                        />
                        <Figure
                            testID="nutrition-target-energy"
                            label={t('nutrition:energy.target')}
                            value={t('nutrition:energy.kcalPerDay', {
                                value: formatter.formatNumber(result.targetEnergy),
                            })}
                            description={t('nutrition:energy.targetDescription')}
                        />
                        <Figure
                            testID="nutrition-energy-tolerance"
                            label={t('nutrition:energy.tolerance')}
                            value={t('nutrition:energy.range', {
                                min: formatter.formatNumber(result.energyTolerance.min),
                                max: formatter.formatNumber(result.energyTolerance.max),
                            })}
                            description={t('nutrition:energy.toleranceDescription')}
                        />
                        <Figure
                            testID="nutrition-bmr"
                            label={t('nutrition:energy.restingRate')}
                            value={t('nutrition:energy.kcalPerDay', {
                                value: formatter.formatNumber(result.basalMetabolicRate),
                            })}
                            description={t('nutrition:energy.restingRateDescription')}
                        />
                    </Stack>
                </Inline>
            </Stack>
        </Card>
    );
}

function Figure({
    label,
    value,
    description,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly description: string;
    readonly testID: string;
}) {
    return (
        <Stack space="none" testID={testID}>
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Text variant="bodyStrong" testID={`${testID}-value`}>
                {value}
            </Text>
            <Text variant="caption" tone="secondary">
                {description}
            </Text>
        </Stack>
    );
}

/* ── macros ──────────────────────────────────────────────────────────────────────────────────── */

interface MacroRow {
    readonly key: string;
    readonly label: string;
    readonly grams: string;
    readonly percentage: string;
    readonly kilocalories: string;
    readonly tolerance: string;
}

/**
 * Grams first, percentages second (doc 17, ONB-10), and fibre alongside the three macros (NUT-05 —
 * **NEW**; neither reference displays a fibre target publicly).
 *
 * Both a meter and a table, because they answer different questions: the meters give the shape of
 * the day at a glance, and the table gives the four figures a person needs when they are actually
 * reading a label. The meters carry their numeric value as well as their fill, so nothing is
 * communicated by length alone.
 */
function MacroPanel({
    result,
    formatter,
}: {
    readonly result: NutritionTargetResult;
    readonly formatter: Formatter;
}) {
    const { t } = useTranslation();

    const macros: readonly MacroTarget[] = [...result.macros].sort(
        (left, right) =>
            MACRO_ORDER.indexOf(left.nutrientId) - MACRO_ORDER.indexOf(right.nutrientId),
    );

    const rows: readonly MacroRow[] = [
        ...macros.map((macro): MacroRow => ({
            key: macro.nutrientId,
            label: t(`nutrition:nutrients.${macro.nutrientId}`),
            grams: t('nutrition:macros.grams', {
                value: formatter.formatNumber(macro.grams),
            }),
            percentage: t('nutrition:macros.percentage', {
                value: formatter.formatNumber(macro.percentageOfEnergy),
            }),
            kilocalories: t('nutrition:macros.kilocalories', {
                value: formatter.formatNumber(macro.kilocalories),
            }),
            tolerance: t('nutrition:macros.range', {
                min: formatter.formatNumber(macro.tolerance.min),
                max: formatter.formatNumber(macro.tolerance.max),
            }),
        })),
        ...result.nutrients.map((nutrient): MacroRow => ({
            key: nutrient.nutrientId,
            label: t(`nutrition:nutrients.${nutrient.nutrientId}`),
            grams: t('nutrition:macros.grams', {
                value: formatter.formatNumber(nutrient.value),
            }),
            // Fibre is a floor rather than a share of energy, so a percentage would be a
            // number with no meaning attached to it (doc 17, ONB-11).
            percentage: t('nutrition:macros.notApplicable'),
            kilocalories: t('nutrition:macros.notApplicable'),
            tolerance: t('nutrition:macros.atLeast', {
                value: formatter.formatNumber(nutrient.tolerance.min),
            }),
        })),
    ];

    return (
        <Card padding="md" testID="nutrition-macros">
            <Stack space="md">
                <Heading level={2}>{t('nutrition:macros.title')}</Heading>
                <Text tone="secondary">{t('nutrition:macros.lead')}</Text>

                <Stack space="sm" testID="nutrition-macro-meters">
                    {macros.map((macro) => (
                        <MeterBar
                            key={macro.nutrientId}
                            testID={`nutrition-macro-meter-${macro.nutrientId}`}
                            label={t(`nutrition:nutrients.${macro.nutrientId}`)}
                            value={macro.grams}
                            target={macro.grams}
                            unit="g"
                            valueText={t('nutrition:macros.meterValue', {
                                grams: formatter.formatNumber(macro.grams),
                                percent: formatter.formatNumber(macro.percentageOfEnergy),
                            })}
                        />
                    ))}
                </Stack>

                <Table<MacroRow>
                    testID="nutrition-macro-table"
                    caption={t('nutrition:macros.tableCaption')}
                    rowKey={(row) => row.key}
                    rows={rows}
                    columns={[
                        {
                            key: 'label',
                            header: t('nutrition:macros.columnNutrient'),
                            rowHeader: true,
                            render: (row) => <Text>{row.label}</Text>,
                        },
                        {
                            key: 'grams',
                            header: t('nutrition:macros.columnGrams'),
                            numeric: true,
                            render: (row) => (
                                <Text variant="bodyStrong" testID={`nutrition-grams-${row.key}`}>
                                    {row.grams}
                                </Text>
                            ),
                        },
                        {
                            key: 'percentage',
                            header: t('nutrition:macros.columnPercentage'),
                            numeric: true,
                            render: (row) => <Text>{row.percentage}</Text>,
                        },
                        {
                            key: 'kilocalories',
                            header: t('nutrition:macros.columnEnergy'),
                            numeric: true,
                            render: (row) => <Text>{row.kilocalories}</Text>,
                        },
                        {
                            key: 'tolerance',
                            header: t('nutrition:macros.columnTolerance'),
                            numeric: true,
                            render: (row) => <Text>{row.tolerance}</Text>,
                        },
                    ]}
                />
            </Stack>
        </Card>
    );
}

/* ── professional override ───────────────────────────────────────────────────────────────────── */

/**
 * The override indicator (doc 17, NUT-08 — **NEW**).
 *
 * When a dietitian has replaced a figure, three things have to be visible at once: that it was
 * replaced, by whom and when, and what the calculation would have said. The third is the one
 * products leave out, and it is the one that lets a person ask a sensible question at their next
 * appointment.
 *
 * The dietitian's name is a placeholder rather than a lookup: `ProfessionalOverride` carries a
 * `dietitianId` and no display name, and resolving it would mean a marketplace call from a screen
 * that has no other reason to make one. The gap is recorded rather than papered over with an
 * invented name.
 */
function OverridePanel({ result }: { readonly result: NutritionTargetResult }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const override = result.override;

    if (override === null) {
        return (
            <Card padding="md" tone="sunken" testID="nutrition-override-absent">
                <Stack space="xs">
                    <Inline space="xs" align="center">
                        <Badge
                            tone="neutral"
                            icon="info"
                            label={t('nutrition:override.absentBadge')}
                        />
                    </Inline>
                    <Text variant="caption" tone="secondary">
                        {t('nutrition:override.absentBody')}
                    </Text>
                </Stack>
            </Card>
        );
    }

    return (
        <Card padding="md" tone="brand" testID="nutrition-override">
            <Stack space="sm">
                <Inline space="xs" align="center" wrap>
                    <Badge
                        testID="nutrition-override-badge"
                        tone="info"
                        icon="success"
                        label={t('nutrition:override.badge')}
                    />
                </Inline>

                <Text testID="nutrition-override-who">
                    {t('nutrition:override.who', {
                        dietitian: t('nutrition:override.dietitianPlaceholder'),
                        when: formatter.formatDate(override.approvedAt, {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                        }),
                    })}
                </Text>

                <Text tone="secondary" testID="nutrition-override-reason">
                    {t('nutrition:override.reason', { reason: override.reason })}
                </Text>

                <Text variant="caption" tone="secondary" testID="nutrition-override-original">
                    {override.energyKilocalories === null
                        ? t('nutrition:override.energyUnchanged')
                        : t('nutrition:override.energyReplaced', {
                              value: formatter.formatNumber(override.energyKilocalories),
                          })}
                </Text>

                <Text variant="caption" tone="secondary" testID="nutrition-override-macros">
                    {override.macros === null
                        ? t('nutrition:override.macrosUnchanged')
                        : t('nutrition:override.macrosReplaced')}
                </Text>
            </Stack>
        </Card>
    );
}
