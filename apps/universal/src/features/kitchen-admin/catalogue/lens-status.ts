import type { PublishableStatus } from '@healthy360/api-client/contracts';
import type { TFunction } from 'i18next';

import { statusKey } from '../format.ts';
import type { LensFigure, LensMixPart, LensToken } from './lens-bar.tsx';

/**
 * The status half of a catalogue page's Lens bar — the All · Published · Draft · Awaiting review
 * figures, the mix under them and the status token — built once for every list that has a
 * `PublishableStatus` lifecycle. A page adds its own figures (Missing Arabic, On sale) after these.
 */
export interface StatusLensSource {
    /** The page read's count for the filtered set. */
    readonly total: number | null;
    /** Every row in scope, the status aside. */
    readonly scopeCount: number;
    readonly statusCounts: Readonly<Record<PublishableStatus, number>>;
    readonly countsPending: boolean;
    readonly statuses: readonly PublishableStatus[];
    readonly setStatuses: (next: readonly PublishableStatus[]) => void;
}

export function statusLensFigures(
    source: StatusLensSource,
    t: TFunction,
    options: {
        readonly allLabel: string;
        /** Draw Awaiting review — a lifecycle in which the quarantine actually happens. */
        readonly review: boolean;
        readonly reviewAction?: string | undefined;
    },
): readonly LensFigure[] {
    const active = source.statuses.length === 1 ? source.statuses[0] : undefined;
    const counted = (status: PublishableStatus): number | null =>
        source.countsPending ? null : source.statusCounts[status];
    const pick = (status: PublishableStatus | null) => () => {
        source.setStatuses(status === null ? [] : [status]);
    };

    return [
        {
            key: 'all',
            label: options.allLabel,
            // With no status in force the page read already says it, ahead of the whole-set read.
            value:
                source.statuses.length === 0
                    ? source.total
                    : source.countsPending
                      ? null
                      : source.scopeCount,
            active: source.statuses.length === 0,
            onPress: pick(null),
            accessibilityLabel: t('kitchen:lens.allAction'),
        },
        {
            key: 'published',
            label: t(statusKey('published')),
            value: counted('published'),
            tone: 'success',
            separated: true,
            active: active === 'published',
            onPress: pick('published'),
            accessibilityLabel: t('kitchen:lens.publishedAction'),
        },
        {
            key: 'draft',
            label: t(statusKey('draft')),
            value: counted('draft'),
            tone: 'warning',
            active: active === 'draft',
            onPress: pick('draft'),
            accessibilityLabel: t('kitchen:list.statDraftAction'),
        },
        ...(options.review
            ? [
                  {
                      key: 'review',
                      label: t(statusKey('review_required')),
                      value: counted('review_required'),
                      tone: 'danger' as const,
                      // The one figure that blocks publication outright.
                      alarm: true,
                      active: active === 'review_required',
                      onPress: pick('review_required'),
                      accessibilityLabel: options.reviewAction,
                  },
              ]
            : []),
    ];
}

/** How the scope divides between its states, and the same in words. */
export function statusLensMix(
    source: StatusLensSource,
    t: TFunction,
): { readonly mix: readonly LensMixPart[]; readonly mixLabel: string } {
    const active = source.statuses.length === 1 ? source.statuses[0] : undefined;
    const part = (status: PublishableStatus, tone: LensMixPart['tone']): LensMixPart => ({
        key: status,
        value: source.countsPending ? 0 : source.statusCounts[status],
        tone,
        dimmed: active !== undefined && active !== status,
    });

    return {
        mix: [
            part('published', 'success'),
            part('draft', 'warning'),
            part('review_required', 'danger'),
            part('retired', 'neutral'),
        ],
        mixLabel: t('kitchen:lens.mix', {
            published: source.statusCounts.published,
            draft: source.statusCounts.draft,
            review: source.statusCounts.review_required,
        }),
    };
}

/** The status in force as a token — "Status: Draft ×". None for All. */
export function statusLensTokens(source: StatusLensSource, t: TFunction): readonly LensToken[] {
    return source.statuses.map((status) => {
        const label = t('kitchen:lens.token', {
            label: t('kitchen:toolbar.statusLabel'),
            value: t(statusKey(status)),
        });
        return {
            key: `status-${status}`,
            label,
            removeLabel: t('kitchen:toolbar.removeFilter', { filter: label }),
            onRemove: () => {
                source.setStatuses(source.statuses.filter((other) => other !== status));
            },
        };
    });
}
