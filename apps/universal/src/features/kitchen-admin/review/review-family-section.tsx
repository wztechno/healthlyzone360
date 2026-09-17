import { Badge, Icon, IconButton, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { displayName, statusKey } from '../format.ts';
import { isBlocked, reviewFamilyKey, reviewReasonKey, reviewRowTestId } from '../review-queue.ts';
import type { ReviewSection, ReviewItem } from '../review-queue.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { WorkbenchSectionHeading } from '../workbench-parts.tsx';
import { ReviewReasonChip } from './review-reason-chip.tsx';

/**
 * One family in the review queue: heading, count, `N blocked`, and its rows (Workbench handoff §3.2).
 *
 * ```
 * ─────────────────────────────────────────────────────────────────────────────
 * INGREDIENTS  3 records  [ 1 BLOCKED ]
 * DESIGNATION                  WHY IT IS HERE           LAST CHANGED        ◉ ✎
 * Zaatar blend, house          ( Quarantined — … )      2 days ago by Rana  ◉ ✎
 * ```
 *
 * The column spec is identical for all six families, which is why one component covers them.
 *
 * ## The row body opens the window, the pen opens the editor
 *
 * The inverse of the Catalogue's list, on purpose: a queue is read far more than it is changed, so
 * the safe default is inspect-first. The handoff flags it as an open question (§6.2); if the kitchen
 * wants the two lists to agree, both change together.
 *
 * ## The second line is the record's status, not a reference
 *
 * The design draws a mono reference under the name. `ReviewItem` carries none — the queue is built
 * from six listings whose identifiers are UUIDs, and a UUID is not something a person reads down a
 * column. The status word is what the queue *does* know, and it is the fact a reader wants next to a
 * name in a review queue.
 */
export interface ReviewFamilySectionProps {
    readonly section: ReviewSection;
    readonly onView: (item: ReviewItem) => void;
    readonly onOpen: (item: ReviewItem) => void;
}

/** Stops a row action's click reaching the row's own press on the web. See `catalogue-list.tsx`. */
const SWALLOW_CLICK =
    Platform.OS === 'web'
        ? {
              onClick: (event: { stopPropagation: () => void }) => {
                  event.stopPropagation();
              },
          }
        : {};

export function ReviewFamilySection({ section, onView, onOpen }: ReviewFamilySectionProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const base = `kitchen-review-section-${section.familyKey}`;
    const blocked = section.items.filter(isBlocked).length;

    const columns: readonly ControlledColumn<ReviewItem, CatalogueColumn<ReviewItem>>[] = [
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
    const controls = useColumnControls(section.items, columns, `${base}-list`);

    return (
        <View testID={base} className="flex-col">
            <WorkbenchSectionHeading
                rule="above"
                title={t(reviewFamilyKey(section.familyKey))}
                testID={`${base}-title`}
                aside={
                    <>
                        <Text variant="caption" tone="secondary" testID={`${base}-count`}>
                            {t('kitchen:review.sectionCount', { count: section.items.length })}
                        </Text>
                        {blocked === 0 ? null : (
                            <Badge
                                tone="danger"
                                testID={`${base}-blocked`}
                                label={t('kitchen:review.blockedCount', { count: blocked })}
                            />
                        )}
                    </>
                }
            />
            <CatalogueList<ReviewItem>
                testID={`${base}-list`}
                label={t(reviewFamilyKey(section.familyKey))}
                columns={controls.columns}
                rows={controls.rows}
                rowKey={(item) => item.id}
                onRowPress={onView}
                rowActionsLabel={t('kitchen:list.rowActions')}
            />
        </View>
    );
}
