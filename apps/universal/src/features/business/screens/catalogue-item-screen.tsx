import {
    Button,
    Cascade,
    EmptyState,
    ErrorState,
    RecordSkeleton,
    Text,
} from '@healthy360/design-system';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    toFailure,
    useCatalogueItemQuery,
    useCorporateProgrammesQuery,
} from '../../../data/business-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { RecordViewPage } from '../../kitchen-admin/catalogue/record-view-page.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { KIND_TONE, packText } from '../catalogue-columns.tsx';
import { CORPORATE_HOME_HREF, corporateCatalogueHref } from '../corporate-chrome.tsx';
import { PackStepper } from '../corporate-parts.tsx';
import { catalogueKindKey, contractPriceTestId } from '../format.ts';
import { CorporateCatalogueScreen, quotationBuilderHref } from './corporate-catalogue-screen.tsx';

/**
 * `/corporate/items/{item}` — one negotiated line, as the record sheet over its programme's
 * catalogue. From the corporate canvas's Catalogue line pop-up (redrawn without the green band,
 * 2026-11-22):
 *
 * - **The head:** the line's photo and name, its kind chip, and "programme · kitchen".
 * - **Two figures:** your rate and the pack it buys.
 * - **Details** (kind, programme, kitchen, the line's code), **Ask for a price** — how many packs,
 *   and what they come to at your rate — and the **Photo**.
 * - **Add to a quotation** at the foot, carrying the packs into a new quotation.
 *
 * There is no basket: a corporate buyer asks for a price. The board's shelf and minimum order are
 * not drawn — the API sends neither.
 *
 * Every price here carries the `contract-price-` marker (`../format.ts`).
 */

export interface CatalogueItemScreenProps {
    readonly itemId: string | undefined;
    /** The programme whose catalogue the line was opened from. */
    readonly programmeId?: string | undefined;
}

export function CatalogueItemScreen({ itemId, programmeId }: CatalogueItemScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const [packs, setPacks] = useState(1);

    const query = useCatalogueItemQuery(itemId ?? null);
    const programmes = useCorporateProgrammesQuery();
    const item = query.data;
    const failure = toFailure(query.error);

    // The programme behind the pop-up: the one the line was opened from, else the first.
    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);
    const programme =
        (programmes.data ?? []).find((candidate) => candidate.id === parsed) ??
        (programmes.data ?? [])[0];
    const kitchen = useKitchenQuery(programme?.kitchenIds[0] ?? null);

    if (query.isPending && query.fetchStatus !== 'idle') {
        return <RecordSkeleton testID="catalogue-item-loading" />;
    }

    if (failure !== null && item === undefined) {
        return (
            <ErrorState
                testID="catalogue-item-detail-error"
                title={t('business:item.notFoundTitle')}
                failure={failure}
                onRetry={() => {
                    void query.refetch();
                }}
                retrying={query.isFetching}
            />
        );
    }

    if (item === undefined) {
        return (
            <Cascade space="md" testID="catalogue-item-screen">
                <EmptyState
                    testID="catalogue-item-detail-empty"
                    title={t('business:item.notFoundTitle')}
                    body={t('business:item.notFoundBody')}
                    actions={
                        <Button
                            testID="catalogue-item-back"
                            size="sm"
                            variant="secondary"
                            label={t('business:catalogue.back')}
                            onPress={() => {
                                router.push(CORPORATE_HOME_HREF as never);
                            }}
                        />
                    }
                />
            </Cascade>
        );
    }

    const programmeKey = programme === undefined ? undefined : String(programme.id);
    const dash = t('kitchen:list.noValue');
    const pack = packText(t, formatter, item);
    const kindLabel = t(catalogueKindKey(item.kind));
    const rate = item.contractPrice === null ? null : formatMoney(formatter, item.contractPrice);
    const value =
        item.contractPrice === null
            ? null
            : formatMoney(formatter, {
                  amount: item.contractPrice.amount * packs,
                  currency: item.contractPrice.currency,
              });
    const where = [programme?.name, kitchen.data?.name].filter(
        (part): part is string => part !== undefined && part !== '',
    );

    // A pop-up over the programme's catalogue it was picked from (`View as a pop-up`).
    return (
        <>
            {programmeKey === undefined ? null : (
                <CorporateCatalogueScreen programmeId={programmeKey} />
            )}
            <RecordViewPage
                testID="catalogue-item-screen"
                eyebrow={t('business:item.kind')}
                title={item.name}
                kind={
                    pack === null
                        ? (programme?.name ?? kindLabel)
                        : t('business:item.packChip', { size: pack })
                }
                status={{ label: kindLabel, tone: KIND_TONE[item.kind] }}
                statusLines={where.length === 0 ? [] : [where.join(' · ')]}
                photo={{
                    assetId: item.imagePlaceholderId === '' ? undefined : item.imagePlaceholderId,
                    label: item.name,
                }}
                figureKeys={['rate', 'pack']}
                onBack={() => {
                    if (programmeKey === undefined) router.push(CORPORATE_HOME_HREF as never);
                    else router.push(corporateCatalogueHref(programmeKey) as never);
                }}
                fields={[
                    {
                        key: 'rate',
                        label: t('business:item.rate'),
                        value: rate ?? t('business:catalogue.unpricedShort'),
                    },
                    { key: 'pack', label: t('business:catalogue.columnPack'), value: pack ?? dash },
                    { key: 'kind', label: t('business:catalogue.kindLabel'), value: kindLabel },
                    {
                        key: 'programme',
                        label: t('business:quotations.columnProgramme'),
                        value: programme?.name ?? dash,
                    },
                    {
                        key: 'kitchen',
                        label: t('business:overview.kitchen'),
                        value: kitchen.data?.name ?? dash,
                    },
                    { key: 'code', label: t('business:item.code'), value: item.id },
                ]}
                sections={[
                    {
                        key: 'ask',
                        title: t('business:picked.ask'),
                        content: (
                            <View className="flex-row flex-wrap items-center gap-2.5">
                                <PackStepper
                                    testID="catalogue-item-packs"
                                    label={t('business:item.packsLabel', { name: item.name })}
                                    value={packs}
                                    onChange={setPacks}
                                />
                                {value === null ? null : (
                                    <Text
                                        tone="secondary"
                                        className="tabular-nums"
                                        testID={contractPriceTestId(`headline-${item.id}`)}
                                    >
                                        {t('business:item.atYourRate', { value })}
                                    </Text>
                                )}
                            </View>
                        ),
                    },
                ]}
                rail={
                    item.imagePlaceholderId === ''
                        ? []
                        : [
                              {
                                  key: 'photo',
                                  title: t('business:item.photo'),
                                  content: (
                                      <View className="overflow-hidden rounded-[14px]">
                                          <EntityImage
                                              testID="catalogue-item-photo-large"
                                              assetId={item.imagePlaceholderId}
                                              seed={item.id}
                                              label={item.name}
                                              aspect="card"
                                              flush
                                          />
                                      </View>
                                  ),
                              },
                          ]
                }
                primaryAction={{
                    testID: 'catalogue-item-quote',
                    label: t('business:catalogue.quote'),
                    icon: 'fileText',
                    onPress: () => {
                        router.push(
                            quotationBuilderHref(programmeKey ?? '', [item.id], packs) as never,
                        );
                    },
                }}
            />
        </>
    );
}
