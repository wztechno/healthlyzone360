import { Icon, IconButton, useTheme } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

/**
 * The appearance switch, beside the language switch in every shell's top bar.
 *
 * One component rather than three copies. The three shells (`area-shell`, `marketplace-shell`,
 * `consumer-shell`) each own a different trailing group — sign out, a basket, register/sign in —
 * but this control is identical in all of them, and a control that is the same in three places
 * should only be able to change in one.
 *
 * ## Why the glyph carries its own colour
 *
 * `IconButton` puts its variant's text colour on a wrapping `View`, and a React Native `Text` does
 * not inherit colour from a parent `View` the way an HTML element inherits from its parent. A ghost
 * icon button therefore drew its glyph in the platform default rather than in `content-primary` —
 * which on the dark theme is very nearly the background it sits on, and is why the sun was barely
 * visible. The colour is set on the `Icon` itself for that reason, not on the button.
 *
 * ## Why it has a ring, when no other control in the bar does
 *
 * `ghost` has no box at all, which is right for a control sitting in a dense row of other controls
 * and wrong for the only *unlabelled* one in the bar: a bare 20px glyph beside two bordered text
 * buttons reads as decoration rather than as something pressable. The ring is the smallest thing
 * that restores "this is a button" without promoting it to the visual weight of a filled one — the
 * language switch beside it is still the louder control, which is the correct order.
 */
export function ThemeToggle() {
    const { t } = useTranslation();
    const { isDark, toggleTheme } = useTheme();

    return (
        <IconButton
            testID="theme-toggle"
            size="sm"
            variant="ghost"
            className="rounded-full border-stroke"
            icon={
                <Icon name={isDark ? 'sun' : 'moon'} size="lg" className="text-content-primary" />
            }
            label={isDark ? t('common:theme.switchToLight') : t('common:theme.switchToDark')}
            onPress={toggleTheme}
        />
    );
}
