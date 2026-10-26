import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export interface BreadcrumbItem {
    readonly key: string;
    readonly label: string;
    /** Omit on the last item: an ancestor without a destination is the current page. */
    readonly onPress?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export const BREADCRUMB_TONES = ['default', 'canopy'] as const;
export type BreadcrumbTone = (typeof BREADCRUMB_TONES)[number];

export interface BreadcrumbsProps {
    readonly items: readonly BreadcrumbItem[];
    /** Landmark name. Defaults to the translated word for the trail. */
    readonly label?: string | undefined;
    /**
     * `canopy` for a trail sitting inside the hero band. It is a prop rather than a `className`
     * because the colours live on the *items*, and React Native text does not inherit colour
     * through a View — a class on the container would recolour nothing at all. Left as
     * `content-secondary`, the trail is 2.16:1 on the canopy.
     */
    readonly tone?: BreadcrumbTone | undefined;
    /**
     * One line that shortens itself — "Kitchen workspace › Ingred… › Vermicel…" — rather than
     * wrapping. For a trail in a bar it shares with other controls: there it is given what is left
     * over, and a trail that kept its full width drew its last crumb underneath them (the top bar's
     * Continue, 2026-10-26). Every crumb gives way; the current one keeps at least a few letters.
     */
    readonly truncate?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Breadcrumb trail.
 *
 * It is a `navigation` landmark with its own name, because a page that carries both a primary
 * navigation and a breadcrumb trail otherwise presents a screen reader user with two identically
 * announced landmarks.
 *
 * The last crumb is *not* a link — it is the page you are already on — and carries
 * `aria-current="page"`. The ancestors are links, underlined on the customer ladder; on the compact
 * one they are not — the admin draws its trail in the top bar, where a row of underlined words reads
 * as a rule under the bar's text — and take a hover tint instead. They stay muted against the
 * current crumb's weight, which is what says which words go somewhere. The separators are
 * direction-aware chevrons that resolve their glyph from
 * the active locale, so the trail points the right way in Arabic without a transform.
 */
export function Breadcrumbs({
    truncate = false,
    items,
    label,
    tone = 'default',
    className,
    testID,
}: BreadcrumbsProps) {
    const { t } = useTranslation();
    const density = useDensity();
    const lastIndex = items.length - 1;
    const onCanopy = tone === 'canopy';
    // 75 and 90 rather than the §1.3 floor of 62: a trail is small text and the current crumb is
    // the one word in it that says where you are.
    const mutedClass = onCanopy ? 'text-content-on-canopy-muted' : 'text-content-secondary';
    const currentClass = onCanopy
        ? 'font-semibold text-content-on-canopy-muted'
        : 'font-semibold text-content-primary';
    // 11px on the admin — the handoff's breadcrumb line. `caption` rather than `micro`: a trail
    // reads as prose, and `micro` is the column-label step, one weight heavier and two sizes down.
    const sizeClass = density === 'compact' ? 'text-sm' : 'text-base';

    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={label ?? t('designSystem:breadcrumbs.label')}
            accessibilityLabel={label ?? t('designSystem:breadcrumbs.label')}
            className={cx(
                truncate
                    ? // `shrink` as well as `min-w-0`: a react-native-web View does not shrink by
                      // default, so without it the trail kept its full width and was cut off.
                      'min-w-0 shrink flex-row flex-nowrap items-center overflow-hidden'
                    : 'flex-row flex-wrap items-center',
                density === 'compact' ? 'gap-control-xs' : 'gap-1',
                className,
            )}
        >
            {items.map((item, index) => {
                const isCurrent = index === lastIndex;
                return (
                    <View
                        key={item.key}
                        className={cx(
                            'flex-row items-center',
                            density === 'compact' ? 'gap-control-xs' : 'gap-1',
                            truncate ? (isCurrent ? 'min-w-16 shrink' : 'min-w-0 shrink') : null,
                        )}
                    >
                        {index === 0 ? null : (
                            <Icon
                                name="chevronEnd"
                                size="sm"
                                className={mutedClass}
                                testID={
                                    testID === undefined
                                        ? undefined
                                        : `${testID}-separator-${String(index)}`
                                }
                            />
                        )}

                        {isCurrent || item.onPress === undefined ? (
                            <RNText
                                testID={item.testID}
                                aria-current={isCurrent ? 'page' : undefined}
                                numberOfLines={1}
                                className={cx(
                                    sizeClass,
                                    'text-start',
                                    isCurrent ? currentClass : mutedClass,
                                    truncate ? 'min-w-0 shrink' : null,
                                )}
                            >
                                {item.label}
                            </RNText>
                        ) : (
                            <Pressable
                                testID={item.testID}
                                role="link"
                                accessibilityRole="link"
                                accessibilityLabel={item.label}
                                focusable
                                onPress={item.onPress}
                                className={cx(
                                    'justify-center',
                                    density === 'compact'
                                        ? 'h-control-xs rounded-sm px-control-xs hover:bg-surface-sunken'
                                        : 'min-h-touch px-1',
                                    truncate ? 'min-w-0 shrink' : null,
                                )}
                            >
                                <RNText
                                    numberOfLines={1}
                                    className={cx(
                                        sizeClass,
                                        density === 'compact' ? null : 'underline',
                                        'text-start',
                                        mutedClass,
                                    )}
                                >
                                    {item.label}
                                </RNText>
                            </Pressable>
                        )}
                    </View>
                );
            })}
        </View>
    );
}
