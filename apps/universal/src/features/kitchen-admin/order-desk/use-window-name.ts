import { useLocale } from '@healthy360/i18n';

import { useOrderDeskDeliveryWindowsQuery } from '../../../data/order-desk-hooks.ts';
import { humaniseCode } from '../format.ts';

/**
 * A slot code as the kitchen named its window — "Lunch", the name the desk's picker offered —
 * rather than the code humanised ("Midday"), which made one order read two ways. The code itself
 * while the windows are loading or cannot be read.
 */
export function useWindowName(enabled = true): (code: string) => string {
    const { locale } = useLocale();
    const windows = useOrderDeskDeliveryWindowsQuery(enabled);

    return (code) => {
        const window = windows.data?.find((candidate) => candidate.code === code);
        if (window === undefined) return humaniseCode(code);
        return locale === 'ar' && window.nameAr !== '' ? window.nameAr : window.nameEn;
    };
}
