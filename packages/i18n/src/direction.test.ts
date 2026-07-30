import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE, createI18n, normaliseLocale } from './config.ts';
import {
    LOCALE_COOKIE_NAME,
    applyLocaleDirection,
    directionAdapter,
    getDirection,
    readLocaleCookie,
    writeLocaleCookie,
} from './direction.ts';
import { setLocale } from './hooks.ts';

/** Minimal DOM stand-in — enough for the adapter, far less than jsdom. */
function stubDocument() {
    const attributes = new Map<string, string>();
    const fake = {
        documentElement: {
            getAttribute: (name: string) => attributes.get(name) ?? null,
            setAttribute: (name: string, value: string) => {
                attributes.set(name, value);
            },
        },
        cookie: '',
    };
    vi.stubGlobal('document', fake);
    return { fake, attributes };
}

describe('web direction adapter', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports the web platform', () => {
        expect(directionAdapter.platform).toBe('web');
    });

    it('degrades to ltr with no document (server render, Node scripts)', () => {
        vi.stubGlobal('document', undefined);
        expect(getDirection()).toBe('ltr');
        expect(applyLocaleDirection('ar')).toEqual({
            locale: 'ar',
            direction: 'rtl',
            changed: false,
            needsReload: false,
        });
    });

    it('sets dir and lang on the document element', () => {
        const { attributes } = stubDocument();

        expect(applyLocaleDirection('ar')).toEqual({
            locale: 'ar',
            direction: 'rtl',
            changed: true,
            needsReload: false,
        });
        expect(attributes.get('dir')).toBe('rtl');
        expect(attributes.get('lang')).toBe('ar');
        expect(getDirection()).toBe('rtl');
    });

    it('never asks the web to reload — direction applies immediately', () => {
        stubDocument();
        for (const locale of ['ar', 'en', 'ar-SA', 'en-XA']) {
            expect(applyLocaleDirection(locale).needsReload).toBe(false);
        }
    });

    it('reports changed: false when nothing moved', () => {
        stubDocument();
        applyLocaleDirection('en');
        expect(applyLocaleDirection('en').changed).toBe(false);
    });

    it('treats the pseudo-locale as right-to-left so RTL bugs surface in development', () => {
        stubDocument();
        expect(applyLocaleDirection('en-XA').direction).toBe('rtl');
    });
});

describe('locale cookie', () => {
    beforeEach(() => {
        stubDocument();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips through document.cookie', () => {
        writeLocaleCookie('ar');
        expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=ar`);
        expect(readLocaleCookie(document.cookie)).toBe('ar');
    });

    it('is written with a path, max-age and samesite so it survives navigation', () => {
        writeLocaleCookie('en');
        expect(document.cookie).toContain('path=/');
        expect(document.cookie).toContain('max-age=');
        expect(document.cookie).toContain('samesite=lax');
    });

    it('parses the cookie out of a crowded header', () => {
        expect(readLocaleCookie(`session=abc; ${LOCALE_COOKIE_NAME}=ar-SA; theme=dark`)).toBe(
            'ar-SA',
        );
        expect(readLocaleCookie('session=abc; theme=dark')).toBeNull();
        expect(readLocaleCookie('')).toBeNull();
    });

    it('applying a locale persists it for the pre-hydration script', () => {
        applyLocaleDirection('ar');
        expect(readLocaleCookie(document.cookie)).toBe('ar');
    });
});

describe('normaliseLocale', () => {
    it.each([
        ['en', 'en'],
        ['ar', 'ar'],
        ['ar-SA', 'ar'],
        ['en-GB', 'en'],
        ['EN-us', 'en'],
        ['en-XA', 'en-XA'],
        ['fr', DEFAULT_LOCALE],
        ['', DEFAULT_LOCALE],
        [null, DEFAULT_LOCALE],
        [undefined, DEFAULT_LOCALE],
    ])('%s -> %s', (input, expected) => {
        expect(normaliseLocale(input)).toBe(expected);
    });
});

describe('setLocale', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('changes the i18next language and applies the direction together', async () => {
        const { attributes } = stubDocument();
        const i18n = createI18n({ locale: 'en', react: false });

        const result = await setLocale(i18n, 'ar');

        expect(i18n.resolvedLanguage).toBe('ar');
        expect(result.direction).toBe('rtl');
        expect(attributes.get('dir')).toBe('rtl');
        expect(i18n.t('action.cancel')).toBe('إلغاء');
    });

    it('normalises regional tags before switching', async () => {
        stubDocument();
        const i18n = createI18n({ locale: 'en', react: false });
        await setLocale(i18n, 'ar-SA');
        expect(i18n.language).toBe('ar');
    });
});
