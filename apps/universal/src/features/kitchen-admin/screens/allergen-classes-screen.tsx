import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useAllergenClassesQuery } from '../../../data/kitchen-admin-hooks.ts';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';

/**
 * `/kitchen/allergen-classes` — the fourteen regulatory classes, read only.
 *
 * ## Why this screen has no controls at all
 *
 * An allergen code is an immutable regulatory identity (plan §4.6, decision D-041). The platform
 * owns the display names, the market applicability, the thresholds and the deactivation switch; a
 * kitchen owns only its *mappings* onto these codes. `KitchenAdminRepository` reflects that exactly
 * — `listAllergenClasses()` has no writer — so this page states the governance rule in plain words
 * and offers nothing that would imply otherwise. A greyed-out "Edit" would be a claim about the
 * interface that is not true.
 *
 * ## What each card has to say
 *
 * Which markets require the class, and the threshold when a regime states one — sulphites are
 * declarable at 10 mg/kg, most classes at any detectable amount. "No market in this list requires
 * it" is printed rather than left blank, because "not required here" is a fact a kitchen needs, and
 * an empty space is indistinguishable from missing data.
 */
export function AllergenClassesScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-allergen-classes"
        >
            <AllergenClasses />
        </Gate>
    );
}

function AllergenClasses() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();
    const classes = useAllergenClassesQuery();
    const failure = toFailure(classes.error);
    const rows = classes.data ?? [];

    return (
        <Stack space="lg" testID="kitchen-allergen-classes-screen">
            {/*
             * The way back is a real control rather than only a browser gesture.
             *
             * This page has no other interactive element — governance is platform-level, so there is
             * nothing here to press — and a scrolling region with no focusable content inside it is
             * unreachable by keyboard in Safari, which axe reports as a serious
             * `scrollable-region-focusable` violation. One honest destination fixes both the rule
             * and the dead end it describes.
             */}
            <Button
                testID="kitchen-allergen-classes-back"
                variant="ghost"
                size="sm"
                label={t('kitchen:common.back')}
                onPress={() => {
                    router.push('/kitchen' as never);
                }}
            />

            <Stack space="xs">
                <Heading level={1} testID="kitchen-allergen-classes-title">
                    {t('kitchen:classes.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-allergen-classes-subtitle">
                    {t('kitchen:classes.subtitle')}
                </Text>
            </Stack>

            <Callout
                testID="kitchen-allergen-classes-governance"
                role="note"
                tone="info"
                title={t('kitchen:classes.governanceTitle')}
                body={t('kitchen:classes.governanceBody')}
            />

            {classes.isPending ? (
                <Stack space="sm" testID="kitchen-allergen-classes-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-allergen-classes-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-2/3" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-allergen-classes-error"
                    failure={failure}
                    title={t('kitchen:classes.errorTitle')}
                    onRetry={() => {
                        void classes.refetch();
                    }}
                    retrying={classes.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-allergen-classes-empty"
                    title={t('kitchen:classes.emptyTitle')}
                    body={t('kitchen:classes.emptyBody')}
                />
            ) : (
                <Stack space="sm" testID="kitchen-allergen-classes-list">
                    <Text
                        tone="secondary"
                        variant="caption"
                        testID="kitchen-allergen-classes-count"
                    >
                        {t('kitchen:classes.count', { count: rows.length })}
                    </Text>

                    {rows.map((entry) => {
                        const testID = `kitchen-allergen-class-${String(entry.code)}`;
                        const name = displayName(entry.name, locale);
                        const description = displayName(entry.description, locale);

                        return (
                            <Card key={String(entry.code)} testID={testID} padding="md">
                                <Stack space="sm">
                                    <Inline space="sm" align="center" wrap>
                                        <Heading level={2} testID={`${testID}-name`}>
                                            {name.value}
                                        </Heading>
                                        <Badge
                                            testID={`${testID}-code`}
                                            tone="neutral"
                                            icon="dot"
                                            label={String(entry.code)}
                                        />
                                        {entry.severeByDefault ? (
                                            <Badge
                                                testID={`${testID}-severe`}
                                                tone="danger"
                                                label={t('kitchen:classes.severe')}
                                            />
                                        ) : null}
                                        {entry.isActive ? null : (
                                            <Badge
                                                testID={`${testID}-inactive`}
                                                tone="warning"
                                                label={t('kitchen:classes.inactive')}
                                            />
                                        )}
                                    </Inline>

                                    <Text testID={`${testID}-description`} tone="secondary">
                                        {description.value}
                                    </Text>

                                    <Stack space="none">
                                        <Text variant="label">
                                            {t('kitchen:classes.marketsLabel')}
                                        </Text>
                                        {entry.markets.length === 0 ? (
                                            <Text
                                                testID={`${testID}-markets-none`}
                                                tone="secondary"
                                            >
                                                {t('kitchen:classes.noMarkets')}
                                            </Text>
                                        ) : (
                                            <Inline space="xs" wrap testID={`${testID}-markets`}>
                                                {entry.markets.map((market) => (
                                                    <Badge
                                                        key={market}
                                                        testID={`${testID}-market-${market}`}
                                                        tone="info"
                                                        label={market}
                                                    />
                                                ))}
                                            </Inline>
                                        )}
                                    </Stack>

                                    <Stack space="none">
                                        <Text variant="label">
                                            {t('kitchen:classes.thresholdLabel')}
                                        </Text>
                                        <Text testID={`${testID}-threshold`} tone="secondary">
                                            {entry.declarationThreshold === null
                                                ? t('kitchen:classes.thresholdAny')
                                                : t('kitchen:classes.thresholdValue', {
                                                      value: formatter.formatNumber(
                                                          entry.declarationThreshold.value,
                                                      ),
                                                      unit: entry.declarationThreshold.unit,
                                                  })}
                                        </Text>
                                    </Stack>

                                    <Stack space="none">
                                        <Text variant="label">
                                            {t('kitchen:classes.referenceLabel')}
                                        </Text>
                                        <Text testID={`${testID}-reference`} tone="secondary">
                                            {entry.regulatoryReference}
                                        </Text>
                                    </Stack>
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
            )}
        </Stack>
    );
}
