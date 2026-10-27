import type { PriceListId } from '@healthy360/domain-types';
import {
    Badge,
    Button,
    Card,
    Inline,
    Stack,
    Switch,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import {
    usePriceListChannelsQuery,
    useSalesChannelRowsQuery,
    useSetPriceListChannelsMutation,
} from '../../data/kitchen-wholesale-hooks.ts';
import { displayName } from './format.ts';

export interface PriceListChannelsCardProps {
    readonly priceListId: PriceListId;
    readonly canManage: boolean;
    readonly testID: string;
}

/**
 * Which of the kitchen's channel rows a price list applies on — one switch per channel, saved as one
 * replacement under the list's lock version. An inactive channel is listed only while assigned, so
 * it can still be taken off.
 */
export function PriceListChannelsCard({
    priceListId,
    canManage,
    testID,
}: PriceListChannelsCardProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const assignment = usePriceListChannelsQuery(priceListId);
    const channels = useSalesChannelRowsQuery();
    const save = useSetPriceListChannelsMutation();

    // `null` until the reader touches a switch: until then the server's set is the draft.
    const [draft, setDraft] = useState<readonly string[] | null>(null);
    const saved = assignment.data?.salesChannelIds ?? [];
    const selected = draft ?? saved;
    const changed =
        draft !== null &&
        (draft.length !== saved.length || draft.some((id) => !saved.includes(id)));

    const failure = toFailure(assignment.error) ?? toFailure(channels.error);
    const saveFailure = toFailure(save.error);
    const rows = (channels.data ?? []).filter((row) => row.isActive || saved.includes(row.id));

    return (
        <Card testID={testID} title={t('kitchen:priceLists.channelsTitle')}>
            <Stack space="sm">
                <Text tone="secondary">{t('kitchen:priceLists.channelsBody')}</Text>
                {failure !== null ? (
                    <Text testID={`${testID}-error`} tone="danger">
                        {t('kitchen:priceLists.channelsLoadError')}
                    </Text>
                ) : assignment.isPending || channels.isPending ? null : rows.length === 0 ? (
                    <Text testID={`${testID}-none`} tone="secondary">
                        {t('kitchen:priceLists.channelsNone')}
                    </Text>
                ) : (
                    rows.map((row) => (
                        <Inline key={row.id} space="sm" align="center">
                            <Switch
                                testID={`${testID}-${row.code}`}
                                label={displayName(row.name, locale).value}
                                checked={selected.includes(row.id)}
                                disabled={!canManage || save.isPending}
                                onChange={(on) => {
                                    setDraft(
                                        on
                                            ? [...selected, row.id]
                                            : selected.filter((id) => id !== row.id),
                                    );
                                }}
                            />
                            <Text variant="caption" tone="secondary">
                                {row.code}
                            </Text>
                            {row.isActive ? null : (
                                <Badge
                                    tone="neutral"
                                    label={t('kitchen:priceLists.channelInactive')}
                                />
                            )}
                        </Inline>
                    ))
                )}
                {saveFailure === null ? null : (
                    <Text testID={`${testID}-save-error`} tone="danger">
                        {saveFailure.message}
                    </Text>
                )}
                {canManage && changed && assignment.data !== undefined ? (
                    <Inline space="sm">
                        <Button
                            testID={`${testID}-save`}
                            label={t('kitchen:priceLists.channelsSave')}
                            loading={save.isPending}
                            onPress={() => {
                                save.mutate(
                                    {
                                        priceListId,
                                        request: {
                                            lockVersion: assignment.data.lockVersion,
                                            salesChannelIds: selected,
                                        },
                                    },
                                    {
                                        onSuccess: () => {
                                            setDraft(null);
                                            toast.show({
                                                testID: `${testID}-saved-toast`,
                                                tone: 'success',
                                                message: t('kitchen:priceLists.channelsSavedToast'),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </Inline>
                ) : null}
            </Stack>
        </Card>
    );
}
