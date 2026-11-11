import { useToast } from '@healthy360/design-system';
import type { ToastOptions } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { pathnameOf, withReturnTo } from '../../navigation/return-to.ts';
import type { ReturnTo } from '../../navigation/use-return-to.ts';
import { STOCK_GAPS_PATH } from './consumption-exceptions/stock-gap-fix.ts';

/**
 * The end of a detour: the job it was opened for is done, so the reader goes back to where they
 * came from — without being asked.
 *
 * A detour is a page opened from the middle of something else: a recipe from Stock gaps, a price
 * list from Wholesale setup, a product from Review. Its finishing action (Publish, Save on a page
 * whose save *is* the job) used to leave the reader on it with, at best, a toast offering the way
 * back — one more decision for something the system already knew. Now the finishing action goes
 * back itself (`ReturnTo.finish`), and the toast confirms it with the one optional step the other
 * way: "Published · **Open again**", which reopens the page just left — still carrying its way back.
 * That is the "stay" choice, offered without stopping anyone with a pop-up.
 *
 * Returning to Stock gaps also says `fixed=1`, which retries the gap on arrival.
 *
 * Opened directly — no `?returnTo=` — there is nowhere to go back to: the toast shows as it is and
 * the reader stays. A plain Save of a draft is not a finishing action and does not call this.
 *
 * Returns whether it went back, for callers with something else to do when it stayed.
 */
export function useFinishDetour(back: ReturnTo): (toast: ToastOptions) => boolean {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const toasts = useToast();
    const { returnTo, finish } = back;

    return useCallback(
        (toast: ToastOptions) => {
            if (returnTo === null) {
                toasts.show(toast);
                return false;
            }
            const reopen = withReturnTo(pathname, returnTo);
            finish(pathnameOf(returnTo) === STOCK_GAPS_PATH ? { fixed: '1' } : undefined);
            toasts.show({
                ...toast,
                action: {
                    label: t('kitchen:detour.openAgain'),
                    testID: `${toast.testID ?? 'kitchen-detour'}-reopen`,
                    onPress: () => {
                        router.push(reopen as never);
                    },
                },
            });
            return true;
        },
        [finish, pathname, returnTo, router, t, toasts],
    );
}
