import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Web-only document shell (static export and dev server).
 *
 * The inline script below runs **before** any stylesheet or React code. It reads the persisted
 * `h360_locale` cookie and fixes `dir`/`lang` on `<html>` synchronously, so an Arabic visitor never
 * sees a frame of left-to-right layout before hydration corrects it, and the `html:lang(ar)` font
 * rule in `global.css` applies to the very first paint. It must stay dependency-free and tiny —
 * anything that throws here would block rendering entirely, hence the try/catch.
 */
const LOCALE_COOKIE = 'h360_locale';

const preHydrationDirectionScript = `
(function () {
  try {
    var match = document.cookie.match(/(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)/);
    var locale = match ? decodeURIComponent(match[1]) : null;
    if (!locale) {
      var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
      locale = nav;
    }
    var language = String(locale).split('-')[0].toLowerCase();
    var direction = language === 'ar' || locale === 'en-XA' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', direction);
  } catch (error) {
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('dir', 'ltr');
  }
})();
`;

export default function Root({ children }: PropsWithChildren) {
    return (
        <html lang="en" dir="ltr">
            <head>
                <meta charSet="utf-8" />
                <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
                />
                <meta name="color-scheme" content="light dark" />

                {/* Runs before styles and before hydration. */}
                <script dangerouslySetInnerHTML={{ __html: preHydrationDirectionScript }} />

                {/* Disables body scrolling on web so ScrollView components behave as they do on native. */}
                <ScrollViewStyleReset />
            </head>
            <body>{children}</body>
        </html>
    );
}
