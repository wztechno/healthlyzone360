import { Button } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

/**
 * The language switch, beside `ThemeToggle` in every shell's top bar.
 *
 * It names the *other* language in that language's own script — "English" while the page is
 * Arabic, "العربية" while it is English — because the person who needs it is the one who cannot
 * read the current one.
 */
export function LocaleToggle() {
    const { t } = useTranslation();
    const { locale, setLocale } = useLocale();
    const arabic = locale.startsWith('ar');

    return (
        <Button
            testID="locale-toggle"
            size="sm"
            variant="ghost"
            label={arabic ? 'English' : t('common:locale.arabic')}
            onPress={() => {
                void setLocale(arabic ? 'en' : 'ar');
            }}
        />
    );
}
