import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Separator } from '../primitives/separator.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * FormSection — a titled group of fields, and deliberately **not** a card.
 *
 * The forms this replaces wrap every group in a bordered, padded, shadowed panel. Six of those down
 * a page produces six competing rectangles and pushes the fields themselves into the middle third
 * of the screen; the outlines carry no information that the heading does not already carry. So §1.3
 * retires panel outlines in the Catalogue and a section is a title, a hairline and its content.
 *
 * The rule is the same one `Separator` states: one line, and it has to earn itself. Here it earns
 * itself by being the only thing separating two groups of fields that otherwise sit in one column.
 * The *first* section is drawn without it, because a rule directly under a page title is a rule
 * against nothing.
 */

export interface FormSectionProps {
    /** Renders on the `section` step — 13px, 600, uppercase. */
    readonly title: string;
    /** One line under the title. Long enough to explain a rule, short enough not to be read twice. */
    readonly description?: string | undefined;
    /**
     * Sits immediately after the title, on its baseline — a `From database` badge, or the one line
     * of eyebrow copy the Catalogue's Sale section carries.
     *
     * Distinct from {@link actions}, which the row pushes to the inline end. The pair is the same
     * one `CataloguePageHeader` already draws: something that qualifies the title belongs beside
     * it, and something you can press belongs at the far end where every other control on the page
     * is. Folding both into one slot put a status badge under the primary button's alignment, which
     * reads as an action nobody can press.
     */
    readonly aside?: ReactNode | undefined;
    /** Controls that belong to the section rather than to a field — an "Add line" button. */
    readonly actions?: ReactNode | undefined;
    /** Suppresses the leading hairline. Pass on the first section of a form. */
    readonly first?: boolean | undefined;
    readonly children: ReactNode;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function FormSection({
    title,
    description,
    aside,
    actions,
    first = false,
    children,
    className,
    testID,
}: FormSectionProps) {
    return (
        // `z-auto` for the reason `FormField` states: every React Native Web `View` is a stacking
        // context at z-0, and a section that is one traps a dropdown opened in its first field
        // under the section below it.
        <View testID={testID} className={cx('z-auto flex-col', className)}>
            {first ? null : <Separator className="mb-loose" />}

            <View className="mb-snug flex-col gap-hair">
                <View className="flex-row items-center justify-between gap-tight">
                    {/*
                     * The title and its aside are one group so `justify-between` separates *them*
                     * from the actions rather than separating the badge from the title it
                     * qualifies. `min-w-0` lets a long title truncate instead of shoving the
                     * actions off the row.
                     */}
                    <View className="min-w-0 flex-row items-baseline gap-tight">
                        <RNText
                            testID={testID === undefined ? undefined : `${testID}-title`}
                            accessibilityRole="header"
                            aria-level={3}
                            className="text-role-section font-admin uppercase text-content-primary text-start"
                        >
                            {title}
                        </RNText>
                        {aside}
                    </View>
                    {actions}
                </View>

                {description === undefined ? null : (
                    <RNText className="text-role-caption font-admin text-content-secondary text-start">
                        {description}
                    </RNText>
                )}
            </View>

            {children}
        </View>
    );
}
