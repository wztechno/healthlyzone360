import { isWholesaleChannelKind } from '@healthy360/api-client/contracts';
import type {
    CatalogueItemRef,
    PriceListAdmin,
    PriceListChannels,
    SalesChannelRecord,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Cascade,
    ErrorState,
    FormSkeleton,
    Icon,
    Inline,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { usePriceListWholeSetQuery } from '../../../data/kitchen-admin-hooks.ts';
import {
    useCreateSalesChannelMutation,
    useInvalidateKitchen,
    useItemChannelOfferings,
    useOfferItemOnChannel,
    usePriceListChannelsMany,
    useSalesChannelRowsQuery,
    useSetPriceListChannelsMutation,
} from '../../../data/kitchen-wholesale-hooks.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_VIEW_PERMISSION,
    PRICE_LIST_MANAGE_PERMISSION,
    PRICE_LIST_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { displayName, statusShortKey, statusTone } from '../format.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { NewPriceListDialog } from '../new-price-list-dialog.tsx';

const PAGE = 'kitchen-wholesale';
const ROUTE = '/kitchen/wholesale';

/** The code the one-click channel takes. Lower-case words joined by hyphens, as the server asks. */
export const WHOLESALE_CHANNEL_CODE = 'wholesale';

/** The channel a business customer orders through: an active wholesale row, `b2b` first. */
export function pickWholesaleChannel(
    rows: readonly SalesChannelRecord[],
): SalesChannelRecord | null {
    const open = rows.filter((row) => row.isActive && isWholesaleChannelKind(row.kind));
    return open.find((row) => row.kind === 'b2b') ?? open[0] ?? null;
}

function itemIdOf(item: CatalogueItemRef): string {
    if (item.kind === 'product') return String(item.productId);
    if (item.kind === 'meal') return String(item.mealId);
    return String(item.planId);
}

/** Every article an agreement list puts a confirmed price on, once. */
export function pricedItemIds(lists: readonly PriceListAdmin[]): readonly string[] {
    return [
        ...new Set(
            lists.flatMap((list) =>
                list.entries
                    .filter((entry) => entry.priceStatus === 'confirmed')
                    .map((entry) => itemIdOf(entry.item)),
            ),
        ),
    ];
}

/**
 * `/kitchen/wholesale` — what the seller side of B2B onboarding needs, as four rows that each say
 * whether they are done and carry the action that does them (`ProvisionApplication`'s "Seller-side
 * wholesale setup"):
 *
 * 1. **A wholesale channel** — without one, accepting a quotation fails with "no wholesale channel
 *    open". *Open wholesale channel* creates a `b2b` row coded `wholesale`.
 * 2. **An agreement price list**, published. *New agreement price list* creates the draft and
 *    opens it in the editor, where prices are added and it is published.
 * 3. **The list on the channel**, one *Assign* per list that is not.
 * 4. **The priced articles offered on the channel** — appended to each item's own channels, one
 *    item at a time, with what failed named.
 */
export function WholesaleSetupScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{
                // Reading the lists and the channel rows needs the two view codes; the page is a
                // setup page, so it opens for whoever may write prices. The channel and item rows
                // ask for `catalogue.manage_organisation` on their own buttons — a commercial
                // manager prices but does not run the catalogue.
                allOf: [
                    CATALOGUE_VIEW_PERMISSION,
                    PRICE_LIST_VIEW_PERMISSION,
                    PRICE_LIST_MANAGE_PERMISSION,
                ],
            }}
            testID={PAGE}
        >
            <WholesaleSetup />
        </Gate>
    );
}

interface ItemFailure {
    readonly id: string;
    readonly message: string;
}

function WholesaleSetup() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();
    const canManageCatalogue = useCan(CATALOGUE_MANAGE_PERMISSION);

    const channels = useSalesChannelRowsQuery();
    const lists = usePriceListWholeSetQuery(undefined);
    const listIds = useMemo(() => (lists.data ?? []).map((list) => list.id), [lists.data]);
    const scopes = usePriceListChannelsMany(listIds);

    const wholesale = pickWholesaleChannel(channels.data ?? []);
    const agreementLists = (lists.data ?? []).filter(
        (list) =>
            list.meta.status !== 'retired' &&
            scopes.byId.get(String(list.id))?.customerScope === 'agreement',
    );
    const itemIds = pricedItemIds(agreementLists);
    const offerings = useItemChannelOfferings(itemIds, wholesale !== null);

    const createChannel = useCreateSalesChannelMutation();
    const assign = useSetPriceListChannelsMutation();
    const offerOne = useOfferItemOnChannel();
    const invalidate = useInvalidateKitchen();

    const [creatingList, setCreatingList] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [failures, setFailures] = useState<readonly ItemFailure[]>([]);

    if (channels.isPending || lists.isPending || scopes.pending) {
        return <FormSkeleton testID={`${PAGE}-loading`} partTestID={PAGE} sections={4} />;
    }

    const loadFailure =
        toFailure(channels.error) ??
        toFailure(lists.error) ??
        (scopes.failed ? toFailure(new Error('price-list-channels')) : null);
    if (loadFailure !== null) {
        return (
            <ErrorState
                testID={`${PAGE}-error`}
                failure={loadFailure}
                title={t('kitchen:wholesale.loadErrorTitle')}
                onRetry={() => {
                    void invalidate();
                }}
                retrying={channels.isFetching || lists.isFetching}
            />
        );
    }

    const nameOf = (list: PriceListAdmin) => displayName(list.name, locale).value;
    const channelName = wholesale === null ? '' : displayName(wholesale.name, locale).value;

    /* ── 1. channel ─────────────────────────────────────────────────────────────────────────── */

    const openChannel = () => {
        createChannel.mutate(
            {
                code: WHOLESALE_CHANNEL_CODE,
                kind: 'b2b',
                // Both names, whatever language the page is read in: the row carries the pair.
                name: {
                    en: t('kitchen:wholesale.channelName', { lng: 'en' }),
                    ar: t('kitchen:wholesale.channelName', { lng: 'ar' }),
                },
            },
            {
                onSuccess: () => {
                    toast.show({
                        testID: `${PAGE}-channel-toast`,
                        tone: 'success',
                        message: t('kitchen:wholesale.channelOpenedToast'),
                    });
                },
            },
        );
    };
    const channelFailure = toFailure(createChannel.error);

    /* ── 2. agreement lists ─────────────────────────────────────────────────────────────────── */

    const published = agreementLists.filter((list) => list.meta.status === 'published').length;

    /* ── 3. assignment ──────────────────────────────────────────────────────────────────────── */

    const scopeOf = (list: PriceListAdmin): PriceListChannels | undefined =>
        scopes.byId.get(String(list.id));
    const isAssigned = (list: PriceListAdmin) =>
        wholesale !== null && (scopeOf(list)?.salesChannelIds.includes(wholesale.id) ?? false);
    const assignedCount = agreementLists.filter(isAssigned).length;

    const assignList = (list: PriceListAdmin) => {
        const scope = scopeOf(list);
        if (wholesale === null || scope === undefined) return;
        assign.mutate(
            {
                priceListId: list.id,
                request: {
                    lockVersion: scope.lockVersion,
                    salesChannelIds: [...scope.salesChannelIds, wholesale.id],
                },
            },
            {
                onSuccess: () => {
                    toast.show({
                        testID: `${PAGE}-assigned-toast`,
                        tone: 'success',
                        message: t('kitchen:wholesale.assignedToast', {
                            name: nameOf(list),
                            channel: channelName,
                        }),
                    });
                },
            },
        );
    };
    const assignFailure = toFailure(assign.error);

    /* ── 4. items ───────────────────────────────────────────────────────────────────────────── */

    const offered = new Set(
        wholesale === null
            ? []
            : itemIds.filter(
                  (id) => offerings.byId.get(id)?.salesChannelIds.includes(wholesale.id) === true,
              ),
    );
    const itemName = (id: string) => {
        const name = offerings.byId.get(id)?.name;
        return name === undefined ? id : displayName(name, locale).value;
    };

    // ponytail: one item at a time — a kitchen offers tens, not thousands; batch it server-side if not.
    const offerAll = async () => {
        if (wholesale === null) return;
        const missing = itemIds.filter((id) => !offered.has(id));
        const failed: ItemFailure[] = [];
        let succeeded = 0;
        setFailures([]);
        setProgress({ done: 0, total: missing.length });
        for (const [index, id] of missing.entries()) {
            try {
                await offerOne(id, wholesale.id);
                succeeded += 1;
            } catch (error) {
                failed.push({ id, message: toFailure(error)?.message ?? '' });
            }
            setProgress({ done: index + 1, total: missing.length });
        }
        setProgress(null);
        setFailures(failed);
        await invalidate();
        if (succeeded > 0) {
            toast.show({
                testID: `${PAGE}-offered-toast`,
                tone: 'success',
                message: t('kitchen:wholesale.itemsOfferedToast', { count: succeeded }),
            });
        }
    };

    const itemsBody =
        wholesale === null
            ? t('kitchen:wholesale.itemsNeedsChannel')
            : itemIds.length === 0
              ? t('kitchen:wholesale.itemsNone')
              : offerings.failed
                ? t('kitchen:wholesale.itemsReadError')
                : progress !== null
                  ? t('kitchen:wholesale.itemsProgress', progress)
                  : t('kitchen:wholesale.itemsSummary', {
                        offered: offered.size,
                        total: itemIds.length,
                    });

    return (
        <Cascade space="md" testID={`${PAGE}-screen`}>
            <KitchenPageHeader
                testID={`${PAGE}-header`}
                title={t('kitchen:families.wholesale.name')}
                subtitle={t('kitchen:wholesale.subtitle')}
            />

            <SetupStep
                testID={`${PAGE}-channel`}
                ordinal={1}
                title={t('kitchen:wholesale.channelTitle')}
                done={wholesale !== null}
                body={
                    wholesale === null
                        ? t('kitchen:wholesale.channelMissing')
                        : t('kitchen:wholesale.channelDone', { name: channelName })
                }
                error={channelFailure?.message}
                action={
                    wholesale === null && canManageCatalogue ? (
                        <Button
                            testID={`${PAGE}-channel-open`}
                            label={t('kitchen:wholesale.channelOpen')}
                            loading={createChannel.isPending}
                            onPress={openChannel}
                        />
                    ) : null
                }
            />

            <SetupStep
                testID={`${PAGE}-lists`}
                ordinal={2}
                title={t('kitchen:wholesale.listsTitle')}
                done={published > 0}
                body={
                    agreementLists.length === 0
                        ? t('kitchen:wholesale.listsNone')
                        : t('kitchen:wholesale.listsSummary', {
                              count: agreementLists.length,
                              published,
                          })
                }
                action={
                    <Button
                        testID={`${PAGE}-lists-new`}
                        variant={agreementLists.length === 0 ? 'primary' : 'secondary'}
                        label={t('kitchen:wholesale.listsNew')}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={() => {
                            setCreatingList(true);
                        }}
                    />
                }
            />

            <SetupStep
                testID={`${PAGE}-assign`}
                ordinal={3}
                title={t('kitchen:wholesale.assignTitle')}
                done={
                    wholesale !== null &&
                    agreementLists.length > 0 &&
                    assignedCount === agreementLists.length
                }
                body={
                    wholesale === null
                        ? t('kitchen:wholesale.assignNeedsChannel')
                        : agreementLists.length === 0
                          ? t('kitchen:wholesale.assignNeedsList')
                          : t('kitchen:wholesale.assignSummary', {
                                assigned: assignedCount,
                                total: agreementLists.length,
                                channel: channelName,
                            })
                }
                error={assignFailure?.message}
            >
                {wholesale === null
                    ? null
                    : agreementLists.map((list) => {
                          const rowID = `${PAGE}-list-${String(list.id)}`;
                          const pending =
                              assign.isPending && assign.variables?.priceListId === list.id;
                          return (
                              <Inline key={String(list.id)} testID={rowID} space="sm">
                                  <Text variant="strong" numberOfLines={1}>
                                      {nameOf(list)}
                                  </Text>
                                  <Badge
                                      tone={statusTone(list.meta.status)}
                                      label={t(statusShortKey(list.meta.status))}
                                  />
                                  {isAssigned(list) ? (
                                      <Badge
                                          testID={`${rowID}-assigned`}
                                          tone="success"
                                          label={t('kitchen:wholesale.assigned')}
                                      />
                                  ) : (
                                      <Button
                                          testID={`${rowID}-assign`}
                                          variant="secondary"
                                          label={t('kitchen:wholesale.assign')}
                                          loading={pending}
                                          disabled={assign.isPending}
                                          onPress={() => {
                                              assignList(list);
                                          }}
                                      />
                                  )}
                                  <Button
                                      testID={`${rowID}-open`}
                                      variant="quiet"
                                      label={t('kitchen:wholesale.openList')}
                                      onPress={() => {
                                          router.push(
                                              withReturnTo(
                                                  `/kitchen/price-lists/${String(list.id)}`,
                                                  ROUTE,
                                              ) as never,
                                          );
                                      }}
                                  />
                              </Inline>
                          );
                      })}
            </SetupStep>

            <SetupStep
                testID={`${PAGE}-items`}
                ordinal={4}
                title={t('kitchen:wholesale.itemsTitle')}
                done={wholesale !== null && itemIds.length > 0 && offered.size === itemIds.length}
                body={itemsBody}
                action={
                    wholesale !== null &&
                    canManageCatalogue &&
                    !offerings.pending &&
                    offered.size < itemIds.length ? (
                        <Button
                            testID={`${PAGE}-items-offer`}
                            label={t('kitchen:wholesale.itemsOffer')}
                            loading={progress !== null}
                            disabled={progress !== null}
                            onPress={() => {
                                void offerAll();
                            }}
                        />
                    ) : null
                }
            >
                {failures.length === 0 ? null : (
                    <Stack space="xs" testID={`${PAGE}-items-failures`}>
                        <Text variant="strong" tone="danger">
                            {t('kitchen:wholesale.itemsFailedTitle', { count: failures.length })}
                        </Text>
                        {failures.map((failure) => (
                            <Text
                                key={failure.id}
                                testID={`${PAGE}-items-failure-${failure.id}`}
                                variant="caption"
                                tone="danger"
                            >
                                {t('kitchen:wholesale.itemFailure', {
                                    name: itemName(failure.id),
                                    message: failure.message,
                                })}
                            </Text>
                        ))}
                    </Stack>
                )}
            </SetupStep>

            {creatingList ? (
                <NewPriceListDialog
                    testID={`${PAGE}-new-list`}
                    scope="agreement"
                    knownCurrency={lists.data?.[0]?.currency ?? null}
                    returnTo={ROUTE}
                    onClose={() => {
                        setCreatingList(false);
                    }}
                />
            ) : null}
        </Cascade>
    );
}

/** One checklist row: its number or a tick, what it is, where it stands, and what finishes it. */
function SetupStep({
    testID,
    ordinal,
    title,
    done,
    body,
    error,
    action,
    children,
}: {
    readonly testID: string;
    readonly ordinal: number;
    readonly title: string;
    readonly done: boolean;
    readonly body: string;
    readonly error?: string | undefined;
    readonly action?: ReactNode;
    readonly children?: ReactNode;
}) {
    const { t } = useTranslation();
    return (
        <Card testID={testID} padding="sm">
            <View className="flex-row flex-wrap items-start gap-snug">
                <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-sunken">
                    {done ? (
                        <Icon name="circleCheck" size="sm" className="text-success-strong" />
                    ) : (
                        <Text variant="label" tone="secondary">
                            {String(ordinal)}
                        </Text>
                    )}
                </View>
                <View className="min-w-0 flex-1 gap-1" style={{ flexBasis: 280 }}>
                    <Inline space="xs">
                        <Text variant="strong">{title}</Text>
                        <Badge
                            testID={`${testID}-state`}
                            tone={done ? 'success' : 'warning'}
                            label={done ? t('kitchen:wholesale.done') : t('kitchen:wholesale.todo')}
                        />
                    </Inline>
                    <Text testID={`${testID}-body`} tone="secondary">
                        {body}
                    </Text>
                    {error === undefined ? null : (
                        <Text testID={`${testID}-error`} tone="danger">
                            {error}
                        </Text>
                    )}
                    {children}
                </View>
                {action}
            </View>
        </Card>
    );
}
