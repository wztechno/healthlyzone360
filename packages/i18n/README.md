# @healthy360/i18n

English and Arabic for the foundation, plus the machinery that keeps them honest. `createI18n()`
builds a configured i18next instance from the committed catalogues in `catalogues/{en,ar}/` (five
namespaces: `common`, `auth`, `access`, `errors`, `designSystem`); `src/keys.generated.ts` is a typed
key union generated from the English catalogue so a renamed key becomes a compile error. Direction is
handled per platform behind one interface — the web adapter sets `documentElement.dir`/`lang`, the
native adapter wraps `I18nManager` (**the only place in the codebase allowed to touch it**, enforced
by an ESLint rule) and returns a `needsReload` flag rather than pretending a native direction change
can happen silently. `createFormatter()` is a thin Intl façade for numbers, currency, dates and
relative time with a **configurable numbering system**: the default is Latin digits (`latn`), recorded
as a provisional product default rather than a permanent decision, because forcing Latin digits on
every Arabic user is a management choice and not a technical one (plan §20).

Three scripts guard the catalogues: `gen:keys` regenerates the typed key union, `gen:pseudo-locale`
produces `en-XA` (accented, 40 % longer, bracketed) for expansion and RTL stress testing, and
`i18n:check` fails when English and Arabic disagree on keys, on interpolation placeholders, or when a
locale is missing a CLDR plural category its language requires — Arabic needs six.
