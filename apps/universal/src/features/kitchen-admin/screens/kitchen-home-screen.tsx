import {
    Badge,
    Button,
    Card,
    EmptyState,
    Heading,
    Icon,
    Inline,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import {
    useAllergenClassesQuery,
    useIngredientSummaryQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { WORKSPACE_PERMISSIONS, permittedFamilies } from '../entity-registry.ts';
import type { EntityFamily } from '../entity-registry.ts';

/**
 * `/kitchen` — the workspace hub.
 *
 * One card per entity family the signed-in person may actually open, read from
 * `../entity-registry.ts` and filtered through the same permission the screen behind the card
 * checks. The grid is data-driven precisely so that K1.2–K1.8 add a registry entry and change
 * nothing here.
 *
 * ## The counts are real or they are absent
 *
 * A managed family's card reports how many records exist and how many are still drafts, because
 * "what is left to do?" is the question a workspace home answers. Where the repository cannot count
 * — `CursorPage.totalCount` is nullable by contract — the card says the count is unavailable rather
 * than showing a zero it does not know to be true. Reference families carry no draft count at all:
 * platform reference data has no draft state, and a badge reading "0 drafts" would imply one exists.
 */

function FamilyCardShell({
    family,
    testID,
    children,
}: {
    readonly family: EntityFamily;
    readonly testID: string;
    readonly children: ReactNode;
}) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Card testID={testID} padding="md">
            <Stack space="sm">
                <Inline space="sm" align="center">
                    <Icon name={family.icon} size="lg" className="text-content-secondary" />
                    <Heading level={2} testID={`${testID}-name`}>
                        {t(family.nameKey)}
                    </Heading>
                </Inline>

                <Text tone="secondary" testID={`${testID}-description`}>
                    {t(family.descriptionKey)}
                </Text>

                {children}

                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-open`}
                        label={t('kitchen:hub.open', { family: t(family.nameKey) })}
                        onPress={() => {
                            router.push(family.href as never);
                        }}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}

function IngredientsCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const summary = useIngredientSummaryQuery();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {summary.isPending ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone="neutral"
                        icon="dot"
                        label={
                            summary.data?.total === null || summary.data === undefined
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:hub.itemCount', { count: summary.data.total })
                        }
                    />
                    {summary.data?.drafts === null || summary.data === undefined ? null : (
                        <Badge
                            testID={`${testID}-drafts`}
                            tone="info"
                            label={t('kitchen:hub.draftCount', { count: summary.data.drafts })}
                        />
                    )}
                    {summary.data?.quarantined === null ||
                    summary.data === undefined ||
                    summary.data.quarantined === 0 ? null : (
                        <Badge
                            testID={`${testID}-quarantined`}
                            tone="warning"
                            label={t('kitchen:hub.quarantineCount', {
                                count: summary.data.quarantined,
                            })}
                        />
                    )}
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function AllergenClassesCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const classes = useAllergenClassesQuery();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {classes.isPending ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone="neutral"
                        icon="dot"
                        label={
                            classes.data === undefined
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:classes.count', { count: classes.data.length })
                        }
                    />
                    <Badge
                        testID={`${testID}-reference`}
                        tone="info"
                        label={t('kitchen:hub.referenceOnly')}
                    />
                </Inline>
            )}
        </FamilyCardShell>
    );
}

export function KitchenHomeScreen() {
    const { t } = useTranslation();
    const state = useAccessState();
    const families = permittedFamilies(state);

    return (
        <Gate area="kitchen" requirement={{ anyOf: WORKSPACE_PERMISSIONS }} testID="kitchen-home">
            <Stack space="lg" testID="kitchen-home-screen">
                <Stack space="xs">
                    <Heading level={1} testID="kitchen-home-title">
                        {t('kitchen:hub.title')}
                    </Heading>
                    <Text tone="secondary" testID="kitchen-home-subtitle">
                        {t('kitchen:hub.subtitle')}
                    </Text>
                </Stack>

                {families.length === 0 ? (
                    <EmptyState
                        testID="kitchen-home-empty"
                        title={t('kitchen:hub.emptyTitle')}
                        body={t('kitchen:hub.emptyBody')}
                    />
                ) : (
                    <Stack space="md" testID="kitchen-home-grid">
                        {/*
                         * Switched on the family key rather than on `kind`, so that the next slice's
                         * managed family gets its own counts instead of silently inheriting the
                         * ingredient ones. A family with no card yet falls back to the shell, which
                         * links correctly and claims no numbers.
                         */}
                        {families.map((family) => {
                            if (family.key === 'ingredients') {
                                return <IngredientsCard key={family.key} family={family} />;
                            }
                            if (family.key === 'allergen-classes') {
                                return <AllergenClassesCard key={family.key} family={family} />;
                            }
                            return (
                                <FamilyCardShell
                                    key={family.key}
                                    family={family}
                                    testID={`kitchen-family-${family.key}`}
                                >
                                    {null}
                                </FamilyCardShell>
                            );
                        })}
                    </Stack>
                )}
            </Stack>
        </Gate>
    );
}
