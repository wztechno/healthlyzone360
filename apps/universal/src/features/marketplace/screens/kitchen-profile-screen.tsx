import {
    Accordion,
    Badge,
    Breadcrumbs,
    Button,
    Card,
    Chip,
    Heading,
    ImagePlaceholder,
    Inline,
    Rating,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { KitchenBranch, OpeningHours } from '@healthy360/api-client/contracts';
import { KitchenId } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { formatMoney, weekdayKey } from '../format.ts';
import { QueryStates } from '../query-states.tsx';

/** The channels a consumer can act on. `b2b`, `corporate` and `pos` are not consumer information. */
const CONSUMER_CHANNELS: readonly SalesChannel[] = [
    'delivery',
    'pickup',
    'subscription',
    'marketplace',
];

export interface KitchenProfileScreenProps {
    /** Raw route parameter. `undefined` on the first frame of a deep link. */
    readonly kitchenId: string | undefined;
}

/**
 * One kitchen: who they are, where they cook, where they deliver and when they are open.
 *
 * The delivery zones and the opening hours are the point of this screen. A marketplace that shows a
 * beautiful kitchen page and only reveals at checkout that it cannot reach the person has wasted
 * their time; doc 17 (SUB-02) makes the same argument about the subscription flow. So the zones are
 * named, the fees and minimums are shown where the kitchen publishes them, and the operating
 * schedule — including the same-day order cut-off — is on the page rather than in a tooltip.
 */
export function KitchenProfileScreen({ kitchenId }: KitchenProfileScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const parsed = kitchenId === undefined ? null : KitchenId.safeParse(kitchenId);
    const query = useKitchenQuery(parsed);
    const kitchen = query.data;

    const openingLine = (hours: OpeningHours): string => {
        const day = t(weekdayKey(hours.weekday));
        if (hours.opensAt === null || hours.closesAt === null) {
            return t('marketplace:kitchen.closedOn', { day });
        }
        const base = t('marketplace:kitchen.openBetween', {
            day,
            opensAt: hours.opensAt,
            closesAt: hours.closesAt,
        });
        return hours.orderCutOffAt === null
            ? base
            : `${base} ${t('marketplace:kitchen.orderCutOff', { time: hours.orderCutOffAt })}`;
    };

    const branchPanel = (branch: KitchenBranch) => (
        <Stack space="sm" testID={`kitchen-branch-${String(branch.id)}`}>
            <Text tone="secondary">
                {t('marketplace:kitchen.branchArea', {
                    area: branch.area,
                    country: branch.countryCode,
                })}
            </Text>

            <Stack space="xs">
                <Text variant="label">{t('marketplace:kitchen.openingHours')}</Text>
                {branch.openingHours.map((hours) => (
                    <Text key={hours.weekday} variant="caption" tone="secondary">
                        {openingLine(hours)}
                    </Text>
                ))}
            </Stack>

            <Stack space="xs">
                <Text variant="label">{t('marketplace:kitchen.deliveryZones')}</Text>
                {branch.deliveryZones.length === 0 ? (
                    <Text variant="caption" tone="secondary">
                        {t('marketplace:kitchen.noDeliveryZones')}
                    </Text>
                ) : (
                    branch.deliveryZones.map((zone) => (
                        <Text key={zone.id} variant="caption" tone="secondary">
                            {[
                                zone.name,
                                zone.estimatedMinutes === null
                                    ? null
                                    : t('marketplace:kitchen.zoneMinutes', {
                                          minutes: zone.estimatedMinutes,
                                      }),
                                zone.deliveryFee === null
                                    ? null
                                    : t('marketplace:kitchen.zoneFee', {
                                          fee: formatMoney(formatter, zone.deliveryFee),
                                      }),
                                zone.minimumOrder === null
                                    ? null
                                    : t('marketplace:kitchen.zoneMinimum', {
                                          minimum: formatMoney(formatter, zone.minimumOrder),
                                      }),
                            ]
                                .filter((part): part is string => part !== null)
                                .join(t('marketplace:common.listSeparator'))}
                        </Text>
                    ))
                )}
            </Stack>

            {branch.supportsPickup ? (
                <Badge tone="info" label={t('marketplace:channels.pickup')} />
            ) : null}
        </Stack>
    );

    return (
        <Stack space="lg" testID="kitchen-profile-screen">
            <Breadcrumbs
                testID="kitchen-breadcrumbs"
                items={[
                    {
                        key: 'kitchens',
                        label: t('marketplace:nav.kitchens'),
                        onPress: () => {
                            router.push('/kitchens');
                        },
                    },
                    { key: 'kitchen', label: kitchen?.name ?? t('marketplace:kitchen.loading') },
                ]}
            />

            <QueryStates
                query={query}
                isEmpty={query.data === undefined && !query.isPending}
                emptyTitle={t('marketplace:kitchen.notFoundTitle')}
                emptyBody={t('marketplace:kitchen.notFoundBody')}
                skeletonCount={2}
                testID="kitchen"
            >
                {kitchen === undefined ? null : (
                    <Stack space="lg">
                        <ImagePlaceholder
                            testID="kitchen-image"
                            seed={kitchen.slug}
                            label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                            aspect="wide"
                        />

                        <Stack space="xs">
                            <Inline space="sm" align="center" wrap>
                                <Heading level={1} testID="kitchen-name">
                                    {kitchen.name}
                                </Heading>
                                {kitchen.isVerified ? (
                                    <Badge
                                        testID="kitchen-verified"
                                        tone="success"
                                        label={t('marketplace:kitchens.verified')}
                                    />
                                ) : null}
                            </Inline>
                            <Text tone="secondary">{kitchen.tagline}</Text>
                            {kitchen.rating === null ? (
                                <Text tone="secondary" variant="caption">
                                    {t('marketplace:kitchens.notRatedYet')}
                                </Text>
                            ) : (
                                <Rating
                                    testID="kitchen-rating"
                                    label={t('marketplace:kitchens.ratingLabel', {
                                        kitchen: kitchen.name,
                                    })}
                                    value={kitchen.rating}
                                    count={kitchen.ratingCount}
                                />
                            )}
                        </Stack>

                        <Inline space="xs" wrap testID="kitchen-channels">
                            {CONSUMER_CHANNELS.filter((channel) => kitchen.channels[channel]).map(
                                (channel) => (
                                    <Badge
                                        key={channel}
                                        testID={`kitchen-channel-${channel}`}
                                        tone="info"
                                        label={t(`marketplace:channels.${channel}`)}
                                    />
                                ),
                            )}
                        </Inline>

                        <Text testID="kitchen-description">{kitchen.description}</Text>

                        <Inline space="xs" wrap testID="kitchen-cuisines">
                            {kitchen.cuisines.map((cuisine) => (
                                <Chip key={cuisine} label={cuisine} tone="neutral" />
                            ))}
                            {kitchen.dietClassifications.map((diet) => (
                                <Chip
                                    key={diet}
                                    label={t(`marketplace:diets.${diet}`)}
                                    tone="brand"
                                />
                            ))}
                        </Inline>

                        <Card padding="md" tone="raised">
                            <Stack space="sm">
                                <Heading level={2}>{t('marketplace:kitchen.menuTitle')}</Heading>
                                <Text tone="secondary">{t('marketplace:kitchen.menuBody')}</Text>
                                <Inline space="sm" wrap>
                                    <Button
                                        testID="kitchen-view-menu"
                                        label={t('marketplace:kitchen.viewMenu')}
                                        onPress={() => {
                                            router.push(
                                                `/kitchens/${String(kitchen.id)}/menu` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </Card>

                        <Stack space="sm" testID="kitchen-branches">
                            <Heading level={2}>{t('marketplace:kitchen.branchesTitle')}</Heading>
                            {kitchen.branches.length === 0 ? (
                                <Text tone="secondary">{t('marketplace:kitchen.noBranches')}</Text>
                            ) : (
                                <Accordion
                                    testID="kitchen-branch-accordion"
                                    multiple
                                    defaultExpandedKeys={[String(kitchen.branches[0]?.id ?? '')]}
                                    items={kitchen.branches.map((branch) => ({
                                        key: String(branch.id),
                                        title: branch.name,
                                        testID: `kitchen-branch-panel-${String(branch.id)}`,
                                        children: branchPanel(branch),
                                    }))}
                                />
                            )}
                        </Stack>
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
