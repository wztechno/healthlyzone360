import { directionForLocale } from '@healthy360/domain-types';
import type { TextDirection } from '@healthy360/domain-types';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { normaliseLocale } from './config.ts';
import type { I18nInstance } from './config.ts';
import { applyLocaleDirection } from './direction';
import type { ApplyLocaleResult } from './direction';
import { createFormatter } from './format.ts';
import type { Formatter, FormatterOptions } from './format.ts';

/**
 * Switches locale and applies the platform's layout direction in one step.
 *
 * Returns the direction result so the caller can act on `needsReload`: on native a direction flip
 * only takes effect after a restart, and the user is told rather than left with a half-mirrored
 * screen (plan §20).
 */
export async function setLocale(i18n: I18nInstance, locale: string): Promise<ApplyLocaleResult> {
    const target = normaliseLocale(locale);
    await i18n.changeLanguage(target);
    return applyLocaleDirection(target);
}

export interface UseLocaleResult {
    readonly locale: string;
    readonly direction: TextDirection;
    readonly setLocale: (next: string) => Promise<ApplyLocaleResult>;
}

export function useLocale(): UseLocaleResult {
    const { i18n } = useTranslation();
    const locale = normaliseLocale(i18n.resolvedLanguage ?? i18n.language);

    const change = useCallback((next: string) => setLocale(i18n as I18nInstance, next), [i18n]);

    return useMemo(
        () => ({ locale, direction: directionForLocale(locale), setLocale: change }),
        [locale, change],
    );
}

/** The direction of the *active locale*, which is what layout should follow. */
export function useDirection(): TextDirection {
    return useLocale().direction;
}

export function useIsRtl(): boolean {
    return useDirection() === 'rtl';
}

/** A memoised Intl façade bound to the active locale. */
export function useFormatter(options: Omit<FormatterOptions, 'locale'> = {}): Formatter {
    const { locale } = useLocale();
    const { numberingSystem, timeZone, currency } = options;

    return useMemo(
        () => createFormatter({ locale, numberingSystem, timeZone, currency }),
        [locale, numberingSystem, timeZone, currency],
    );
}
