import { Icon } from '../icons/icon.tsx';
import { useInlineIssues } from '../issues/issue-anchor.tsx';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * The publish checks in one control, for an editor whose issue tray is inline: a bar per check,
 * how many pass, and "Next fix" — the first open problem's own Fix, which takes the reader to its
 * field. Clear, it says so and does nothing. The problems themselves sit beside the titles of the
 * sections they are in (`IssueAnchor`), so nothing here lists them.
 *
 * Must sit inside the page's `IssueTrayFrame`: it reads what the frame merged.
 */
export function InlineChecksButton({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    // Every open card counts against the checks — a new recipe's are heads-ups, not blocks, but they
    // are still checks it does not pass yet. "Next fix" takes a blocking one first.
    const { items, blocking, passedCount, inline } = useInlineIssues();
    const total = passedCount + items.length;
    if (!inline || total === 0) return null;
    const bars = (
        <View aria-hidden className="flex-row gap-0.5">
            {Array.from({ length: total }, (_, index) => (
                <View
                    key={String(index)}
                    className={
                        index < passedCount
                            ? 'h-3 w-1.5 rounded-sm bg-surface-brand'
                            : 'h-3 w-1.5 rounded-sm bg-stroke'
                    }
                />
            ))}
        </View>
    );
    const first =
        blocking.find((item) => item.action !== undefined) ??
        items.find((item) => item.action !== undefined);
    if (items.length === 0) {
        return (
            <View
                testID={testID}
                className="h-10 flex-row items-center gap-2 rounded-full bg-surface-brand-subtle px-3"
            >
                {bars}
                <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                    {t('designSystem:checks.allPass')}
                </RNText>
            </View>
        );
    }
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={t('designSystem:checks.nextFixLabel', {
                done: passedCount,
                total,
                next: first?.label ?? '',
            })}
            disabled={first === undefined}
            onPress={() => {
                first?.action?.onPress();
            }}
            className="h-10 flex-row items-center gap-2 rounded-full border border-stroke bg-surface-raised px-3 web:hover:bg-surface-sunken"
        >
            {bars}
            <RNText className="text-sm font-semibold tabular-nums text-content-primary">
                {t('designSystem:checks.count', { done: passedCount, total })}
            </RNText>
            {first === undefined ? null : (
                <RNText className="text-sm font-bold text-warning-on-subtle">
                    {t('designSystem:checks.nextFix')}
                </RNText>
            )}
        </Pressable>
    );
}
