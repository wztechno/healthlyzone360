import type { ConsumptionException } from '@healthy360/api-client/contracts';
import { Button } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

/**
 * The gap's fix (`Fix in recipe`, `Add stock`, `Set unit price` …), `Retry` and `Accept gap` on one
 * open exception (Workbench handoff §2.3, §3.5).
 *
 * Renders nothing for a resolved row — a settled exception has nothing left to do, and a disabled
 * set would suggest it might again.
 *
 * ## The fix leads
 *
 * A gap with a page that fixes it (`stockGapFixAction`) says so first, as the row's one primary:
 * the person reading the queue is led to the place the problem is, rather than to a Retry that will
 * fail the same way until it is fixed. Where there is no such fix, Retry is the row's first
 * action. Accept gap is the concession, quiet at the end, and the caller routes it through a
 * confirmation because it accepts a permanent stock gap.
 *
 * Each action is offered only with its handler: `fix` for a gap with a page the reader may open,
 * `onRetry` and `onResolve` for a reader who can write stock.
 */
export interface ExceptionRowActionsProps {
    readonly row: ConsumptionException;
    /** Opens the page that fixes this gap. Absent when nothing fixes it, or it cannot be opened. */
    readonly fix?: { readonly label: string; readonly onPress: () => void } | undefined;
    readonly onRetry?: ((row: ConsumptionException) => void) | undefined;
    readonly onResolve?: ((row: ConsumptionException) => void) | undefined;
    /** The row a write is in flight for — its Retry shows the spinner, every row's writes disable. */
    readonly pendingId: string | null;
}

export function ExceptionRowActions({
    row,
    fix,
    onRetry,
    onResolve,
    pendingId,
}: ExceptionRowActionsProps) {
    const { t } = useTranslation();
    if (row.resolved) return null;
    if (fix === undefined && onRetry === undefined && onResolve === undefined) return null;

    return (
        <View
            className="flex-row flex-wrap items-center gap-hair"
            // The row body opens the view window; on the web a nested button's click would bubble
            // into it. Same stop, same reason, as `catalogue-list.tsx`.
            {...(Platform.OS === 'web'
                ? {
                      onClick: (event: { stopPropagation: () => void }) => {
                          event.stopPropagation();
                      },
                  }
                : {})}
        >
            {fix === undefined ? null : (
                <Button
                    testID={`kitchen-exception-${row.id}-fix`}
                    variant="primary"
                    size="sm"
                    label={fix.label}
                    disabled={pendingId !== null}
                    onPress={fix.onPress}
                />
            )}
            {onRetry === undefined ? null : (
                <Button
                    testID={`kitchen-exception-${row.id}-retry`}
                    variant="secondary"
                    size="sm"
                    label={t('kitchen:ops.exceptions.retry')}
                    loading={pendingId === row.id}
                    disabled={pendingId !== null}
                    onPress={() => {
                        onRetry(row);
                    }}
                />
            )}
            {onResolve === undefined ? null : (
                <Button
                    testID={`kitchen-exception-${row.id}-resolve`}
                    variant="quiet"
                    size="sm"
                    label={t('kitchen:ops.exceptions.resolve')}
                    disabled={pendingId !== null}
                    onPress={() => {
                        onResolve(row);
                    }}
                />
            )}
        </View>
    );
}
