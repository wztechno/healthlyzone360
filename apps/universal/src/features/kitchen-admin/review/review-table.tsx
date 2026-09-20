import { Icon, IconButton, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { displayName, statusKey } from '../format.ts';
import { reviewFamilyKey, reviewReasonKey, reviewRowTestId } from '../review-queue.ts';
import type { ReviewItem } from '../review-queue.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { ReviewReasonChip } from './review-reason-chip.tsx';

/**
 * The review queue as one table, every family in it.
 *
 * ```
 * ID         DESIGNATION        WHY IT IS HERE         LAST CHANGED      ◉ ✎
 * ING-0142   Tahini paste       [Awaiting review]      2 days ago
 * RC-0007    Tabbouleh          [Figures out of date]  …
 * RSL-0031   Olive oil 1 l      [Data quality]         …
 * Meal       Chicken bowl       [Draft]                …
 * ```
 *
 * It used to be a section per family, each with its own heading and table. The ID column says which
 * family a row belongs to instead — the prefix is the family — so the queue reads top to bottom as
 * one list. A family with no reference series (meals, plans, price lists)
 * names itself in that cell, so no row is left without a way to tell what it is; the column's header
 * menu filters by family.
 *
 * A reference that carries its import source — `v6-recipes.json#bbq-sauce-dip` — is shown from the
 * `#` on: the file name is where the row came from, not what the kitchen calls it.
 *
 * Paged at 18 rows, the order desk's page, with the Catalogue's pager under the table.
 */

/** Rows per page — the same page the order desk's queue turns. */
export const REVIEW_PAGE_SIZE = 18;

/** Everything after the last `#`, or the whole reference when it has none. */
export function shortReference(reference: string): string {
    const hash = reference.lastIndexOf('#');
    return hash === -1 ? reference : reference.slice(hash + 1);
}

export interface ReviewTableProps {
    /** Already narrowed by the screen's search and scope, in the queue's own order. */
    readonly items: readonly ReviewItem[];
    readonly onView: (item: ReviewItem) => void;
    readonly onOpen: (item: ReviewItem) => void;
    readonly testID: string;
}

const SWALLOW_CLICK =
    Platform.OS === 'web'
        ? {
              onClick: (event: { stopPropagation: () => void }) => {
                  event.stopPropagation();
              },
          }
        : {};

export function ReviewTable({ items, onView, onOpen, testID }: ReviewTableProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const idText = (item: ReviewItem) =>
        item.reference === null
            ? t(reviewFamilyKey(item.familyKey))
            : shortReference(item.reference);

    const columns: readonly ControlledColumn<ReviewItem, CatalogueColumn<ReviewItem>>[] = [
        {
            key: 'reference',
            role: 'meta',
            label: t('kitchen:list.columnReference'),
            width: 104,
            min: 92,
            priority: 97,
            mono: true,
            value: idText,
            // Filters by family rather than sorting: a column does one or the other, and "show me
            // the recipes" is the question this column is asked.
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((item) => item.familyKey))].map((familyKey) => ({
                        key: familyKey,
                        label: t(reviewFamilyKey(familyKey)),
                    })),
                match: (item, value) => item.familyKey === value,
            },
            render: (item) => (
                <Text
                    testID={`${reviewRowTestId(item.familyKey, item.id)}-reference`}
                    variant={item.reference === null ? 'caption' : 'mono'}
                    tone={item.reference === null ? 'secondary' : 'primary'}
                    numberOfLines={1}
                >
                    {idText(item)}
                </Text>
            ),
        },
        {
            key: 'designation',
            role: 'title',
            value: (item) => displayName(item.name, locale).value,
            label: t('kitchen:review.columnDesignation'),
            width: 220,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(
                    displayName(left.name, locale).value,
                    displayName(right.name, locale).value,
                    direction,
                ),
            render: (item) => {
                const id = reviewRowTestId(item.familyKey, item.id);
                return (
                    <View testID={id} className="min-w-0 flex-col py-1.5">
                        <Text variant="strong" numberOfLines={1} testID={`${id}-name`}>
                            {displayName(item.name, locale).value}
                        </Text>
                        <Text variant="caption" tone="secondary" testID={`${id}-status`}>
                            {t(statusKey(item.status))}
                        </Text>
                    </View>
                );
            },
        },
        {
            key: 'reasons',
            role: 'status',
            label: t('kitchen:review.columnWhy'),
            width: 230,
            priority: 90,
            filter: {
                values: (loaded) =>
                    [
                        ...new Set(
                            loaded.flatMap((item) => item.reasons.map((reason) => reason.code)),
                        ),
                    ].map((code) => ({ key: code, label: t(reviewReasonKey(code), { count: 1 }) })),
                match: (item, value) => item.reasons.some((reason) => reason.code === value),
            },
            render: (item) => {
                const id = reviewRowTestId(item.familyKey, item.id);
                return (
                    <View testID={`${id}-reasons`} className="flex-col items-start gap-0.5 py-1.5">
                        {item.reasons.map((reason) => (
                            <ReviewReasonChip
                                key={reason.code}
                                reason={reason}
                                testID={`${id}-reason-${reason.code}`}
                            />
                        ))}
                    </View>
                );
            },
        },
        {
            key: 'updated',
            label: t('kitchen:review.columnUpdated'),
            width: 150,
            priority: 40,
            sort: (left, right, direction) =>
                compareText(left.updatedAt, right.updatedAt, direction),
            render: (item) => (
                <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={2}
                    testID={`${reviewRowTestId(item.familyKey, item.id)}-updated`}
                >
                    {item.updatedByName === null
                        ? t('kitchen:review.updatedBySeed', {
                              when: formatter.formatRelativeTime(item.updatedAt),
                          })
                        : t('kitchen:review.updatedBy', {
                              when: formatter.formatRelativeTime(item.updatedAt),
                              name: item.updatedByName,
                          })}
                </Text>
            ),
        },
        {
            key: 'actions',
            label: '',
            width: 96,
            priority: 95,
            align: 'end',
            grow: false,
            render: (item) => {
                const id = reviewRowTestId(item.familyKey, item.id);
                return (
                    <View className="flex-row items-center gap-hair" {...SWALLOW_CLICK}>
                        <IconButton
                            testID={`${id}-view`}
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:list.view')}
                            icon={<Icon name="eye" size="sm" />}
                            onPress={() => {
                                onView(item);
                            }}
                        />
                        <IconButton
                            testID={`${id}-open`}
                            variant="ghost"
                            size="sm"
                            label={t('kitchen:catalogue.edit')}
                            icon={<Icon name="pen" size="sm" />}
                            onPress={() => {
                                onOpen(item);
                            }}
                        />
                    </View>
                );
            },
        },
    ];
    const controls = useColumnControls(items, columns, `${testID}-list`);

    /**
     * The page, remembered against what it was chosen under — so a search, a scope or a header
     * filter lands on page one without an effect, and a shorter queue clamps rather than empties.
     */
    const pagingKey = useMemo(() => ({ items, controls: controls.key }), [items, controls.key]);
    const [paging, setPaging] = useState<{ readonly key: typeof pagingKey; readonly page: number }>(
        { key: pagingKey, page: 1 },
    );
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / REVIEW_PAGE_SIZE));
    const page = paging.key === pagingKey ? Math.min(paging.page, totalPages) : 1;
    const pageRows = controls.rows.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);

    return (
        <View className="flex-col gap-snug">
            <CatalogueList<ReviewItem>
                testID={`${testID}-list`}
                label={t('kitchen:review.title')}
                columns={controls.columns}
                rows={pageRows}
                // Keyed by family as well: identifiers are only unique within a family.
                rowKey={(item) => `${item.familyKey}-${item.id}`}
                onRowPress={onView}
                rowActionsLabel={t('kitchen:list.rowActions')}
            />
            <CataloguePager
                testID={`${testID}-pagination`}
                range={t('kitchen:toolbar.showing', {
                    shown: pageRows.length,
                    total: controls.rows.length,
                })}
                page={page}
                totalPages={totalPages}
                onPageChange={(next) => {
                    setPaging({ key: pagingKey, page: next });
                }}
                label={t('kitchen:catalogue.pagerLabel')}
            />
        </View>
    );
}
