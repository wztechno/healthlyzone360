import type { ConsumptionException } from '@healthy360/api-client/contracts';
import { Button } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

/**
 * `Retry` and `Resolve` on one open exception (Workbench handoff §2.3, §3.5).
 *
 * The only two visible row actions in this pass, and the only two controls on the four Workbench
 * screens that write. Renders nothing for a resolved row — a settled exception has nothing left to
 * do, and a disabled pair would suggest it might again.
 *
 * Retry is the row's primary: it is the fix. Resolve is the concession, quiet beside it, and the
 * caller routes it through a confirmation because it accepts a permanent stock gap.
 */
export interface ExceptionRowActionsProps {
    readonly row: ConsumptionException;
    readonly onRetry: (row: ConsumptionException) => void;
    readonly onResolve: (row: ConsumptionException) => void;
    /** The row a write is in flight for — its Retry shows the spinner, every row's pair disables. */
    readonly pendingId: string | null;
}

export function ExceptionRowActions({ row, onRetry, onResolve, pendingId }: ExceptionRowActionsProps) {
    const { t } = useTranslation();
    if (row.resolved) return null;

    return (
        <View
            className="flex-row items-center gap-hair"
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
        </View>
    );
}
