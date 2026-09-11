import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const TAG_TONES = ['neutral', 'brand', 'success', 'warning', 'danger', 'info'] as const;
export type TagTone = (typeof TAG_TONES)[number];

const TONE_CLASS: Readonly<Record<TagTone, string>> = {
    neutral: 'bg-surface-sunken',
    brand: 'bg-surface-brand-subtle',
    success: 'bg-success-subtle',
    warning: 'bg-warning-subtle',
    danger: 'bg-danger-subtle',
    info: 'bg-info-subtle',
};

const TONE_TEXT_CLASS: Readonly<Record<TagTone, string>> = {
    neutral: 'text-content-secondary',
    brand: 'text-content-on-brand-subtle',
    success: 'text-success-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
    info: 'text-info-on-subtle',
};

/**
 * Tag — a word about something, not a control.
 *
 * ## Why this exists beside `Chip` and `Badge`
 *
 * HealthZone draws exactly three pills, and we had components for two of them. `chip()` is the
 * filter control — bordered, `7px 13px`, inverting to the ink surface when it is lit — and that is
 * `FilterChip`. `badge()` is the status mark — bordered, tone-coloured, mono — and that is `Badge`.
 * The third is this one: `background:var(--surface3)`, **no border**, `3px 9px`, muted, worn by the
 * diets under a kitchen's name and the allergens under a meal's
 * (`HealthZone.dc.html:785`). It had no component, so every card bent an inert `Chip` into the
 * shape and each one bent it slightly differently.
 *
 * The distinction is not cosmetic. A tag **cannot be pressed**: there is no `onPress`, and so no
 * question about a 44 dp touch target, no `role`, and nothing in the accessibility tree pretending
 * to be actionable. When a pill needs to *do* something it is a `Chip`; when it needs to *say*
 * something it is a `Tag`. `Chip`'s inert branch renders one of these internally, so the ~50 places
 * that already write `<Chip>` as a label get the same pill and the two cannot drift apart.
 *
 * ## Tone carries no meaning here
 *
 * A tag's meaning is its word — "Vegan", "Contains nuts" — so the fill is a background, not a
 * signal, and no tone needs an icon to survive greyscale the way `Badge`'s do. That is also why
 * there is no border: HealthZone reserves the hairline for the two pills that *are* interactive or
 * semantic, and a row of bordered tags under a title reads as a row of small buttons.
 */
export interface TagProps {
    readonly label: string;
    readonly tone?: TagTone | undefined;
    /** A leading glyph. Decorative — the label is what carries the meaning. */
    readonly icon?: IconName | null | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Tag({ label, tone = 'neutral', icon, className, testID }: TagProps) {
    const density = useDensity();

    return (
        <View
            testID={testID}
            accessibilityRole="text"
            accessibilityLabel={label}
            className={cx(
                'flex-row items-center gap-1 self-start rounded-full px-2.5 py-1',
                TONE_CLASS[tone],
                className,
            )}
        >
            {icon === undefined || icon === null ? null : (
                <Icon
                    name={icon}
                    size="sm"
                    className={TONE_TEXT_CLASS[tone]}
                    testID={testID === undefined ? undefined : `${testID}-icon`}
                />
            )}
            <RNText
                numberOfLines={1}
                className={cx(
                    // Density-aware for the reason `Chip` is: a tag sits in a Catalogue row beside
                    // text on the Catalogue's own ramp, and a tag that does not ask which surface it is
                    // on renders the one word in the row that is still Inter.
                    density === 'compact' ? 'text-role-label' : 'text-xs font-medium',
                    TONE_TEXT_CLASS[tone],
                )}
            >
                {label}
            </RNText>
        </View>
    );
}

export interface TagRowItem {
    readonly key: string;
    readonly label: string;
    readonly tone?: TagTone | undefined;
    readonly icon?: IconName | null | undefined;
}

export interface TagRowProps {
    readonly items: readonly TagRowItem[];
    /**
     * How many to draw before the rest collapse into a `+N`. Omit to draw them all.
     *
     * A cap rather than a measured pack: measuring means a layout pass, a mirror render and two
     * constants kept in step with the classes by hand, and it buys a row that is exactly full
     * instead of one that is nearly full. A card whose tag count is known — three diets, four
     * allergens — needs the number, not the machinery.
     */
    readonly max?: number | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * A wrapping row of {@link Tag}s.
 *
 * The 6px gap is HealthZone's (`gap:6px` on the card's tag row), which is why this is not
 * `Inline space="xs"` — that step is 4px, and at tag size the difference is the row reading as one
 * band of words rather than as separate pills.
 *
 * The overflow tag names what it hides in its accessible label. A `+2` that only a sighted reader
 * can resolve is two facts removed from everybody else.
 */
export function TagRow({ items, max, className, testID }: TagRowProps) {
    const { t } = useTranslation();
    const density = useDensity();

    const shown = max === undefined ? items : items.slice(0, max);
    const hidden = items.slice(shown.length);

    if (items.length === 0) return null;

    return (
        <View testID={testID} className={cx('flex-row flex-wrap items-center gap-1.5', className)}>
            {shown.map((item) => (
                <Tag
                    key={item.key}
                    testID={testID === undefined ? undefined : `${testID}-${item.key}`}
                    label={item.label}
                    {...(item.tone === undefined ? {} : { tone: item.tone })}
                    {...(item.icon === undefined ? {} : { icon: item.icon })}
                />
            ))}

            {hidden.length === 0 ? null : (
                <View
                    testID={testID === undefined ? undefined : `${testID}-more`}
                    accessibilityRole="text"
                    accessibilityLabel={t('designSystem:tag.more', {
                        count: hidden.length,
                        labels: hidden.map((item) => item.label).join(t('designSystem:tag.join')),
                    })}
                    className="flex-row items-center self-start rounded-full bg-surface-sunken px-2.5 py-1"
                >
                    <RNText
                        className={cx(
                            density === 'compact' ? 'text-role-label' : 'text-xs font-medium',
                            'text-content-secondary',
                        )}
                    >
                        {t('designSystem:tag.overflow', { count: hidden.length })}
                    </RNText>
                </View>
            )}
        </View>
    );
}
