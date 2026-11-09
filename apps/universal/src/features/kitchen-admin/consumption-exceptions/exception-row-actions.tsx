import type { ConsumptionException } from '@healthy360/api-client/contracts';
import type { MenuItem } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { RowActionsMenu } from '../catalogue/row-actions-menu.tsx';

/**
 * The gap's fix (`Fix in recipe`, `Add stock`, `Set unit price` …) and `Accept gap` on one open
 * exception (Workbench handoff §2.3, §3.5).
 *
 * Renders nothing for a resolved row — a settled exception has nothing left to do, and a disabled
 * set would suggest it might again.
 *
 * ## There is no Retry
 *
 * The deduction a gap blocked is re-run by the system: the moment stock rises on a shelf, and every
 * five minutes for any other fix (`RetryOpenConsumptionExceptions` in the API). A Retry button
 * asked a person to notice the fix had landed and come back to press it, which is the one part of
 * the job a person adds nothing to.
 *
 * ## The fix leads
 *
 * A gap with a page that fixes it (`stockGapFixAction`) lists it first in the row's `⋯`, as the
 * menu's one primary. Accept gap is the concession after it, and the caller routes it through a
 * confirmation because it accepts a permanent stock gap.
 *
 * Each action is offered only with its handler: `fix` for a gap with a page the reader may open,
 * `onResolve` for a reader who can write stock.
 */
export interface ExceptionRowActionsProps {
    readonly row: ConsumptionException;
    /** Opens the page that fixes this gap. Absent when nothing fixes it, or it cannot be opened. */
    readonly fix?: { readonly label: string; readonly onPress: () => void } | undefined;
    readonly onResolve?: ((row: ConsumptionException) => void) | undefined;
    /** The row a write is in flight for — every row's actions disable while it runs. */
    readonly pendingId: string | null;
}

export function ExceptionRowActions({ row, fix, onResolve, pendingId }: ExceptionRowActionsProps) {
    const { t } = useTranslation();
    if (row.resolved) return null;

    const actions: readonly MenuItem[] = [
        ...(fix === undefined
            ? []
            : [
                  {
                      key: 'fix',
                      label: fix.label,
                      primary: true,
                      disabled: pendingId !== null,
                      testID: `kitchen-exception-${row.id}-fix`,
                      onSelect: fix.onPress,
                  },
              ]),
        ...(onResolve === undefined
            ? []
            : [
                  {
                      key: 'resolve',
                      label: t('kitchen:ops.exceptions.resolve'),
                      disabled: pendingId !== null,
                      testID: `kitchen-exception-${row.id}-resolve`,
                      onSelect: () => {
                          onResolve(row);
                      },
                  },
              ]),
    ];

    return (
        <RowActionsMenu
            actions={actions}
            label={t('kitchen:list.rowActions')}
            testID={`kitchen-exception-${row.id}-actions`}
        />
    );
}
