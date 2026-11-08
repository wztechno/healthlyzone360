import { Button, IconButton } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText } from 'react-native';

/**
 * The language switch, beside `ThemeToggle` in every shell's top bar.
 *
 * It names the *other* language in that language's own script — "English" while the page is
 * Arabic, "العربية" while it is English — because the person who needs it is the one who cannot
 * read the current one.
 *
 * `round` is the staff frame's look: a round button the size of the theme switch beside it,
 * carrying the other language's short mark — ع or EN — and its full name for a screen reader.
 */
export function LocaleToggle({ round = false }: { readonly round?: boolean } = {}) {
    const { t } = useTranslation();
    const { locale, setLocale } = useLocale();
    const arabic = locale.startsWith('ar');
    const toggle = () => {
        void setLocale(arabic ? 'en' : 'ar');
    };

    if (round) {
        return (
            <IconButton
                testID="locale-toggle"
                size="sm"
                variant="quiet"
                round
                className="transition duration-fast ease-standard active:scale-95"
                label={arabic ? t('common:locale.english') : t('common:locale.arabic')}
                icon={
                    <RNText className="text-base font-bold text-content-primary">
                        {arabic ? t('common:locale.englishShort') : t('common:locale.arabicShort')}
                    </RNText>
                }
                onPress={toggle}
            />
        );
    }

    return (
        <Button
            testID="locale-toggle"
            size="sm"
            variant="ghost"
            label={arabic ? 'English' : t('common:locale.arabic')}
            onPress={toggle}
        />
    );
}
