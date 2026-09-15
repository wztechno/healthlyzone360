import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, ScrollView, View } from 'react-native';
import { Button } from '../actions/button.tsx';
import { IconButton } from '../actions/icon-button.tsx';
import { Badge } from '../content/badge.tsx';
import type { BadgeTone } from '../content/badge.tsx';
import { Callout } from '../content/callout.tsx';
import { DerivedChipPanel } from '../content/derived-chip-panel.tsx';
import { Icon } from '../icons/icon.tsx';
import { FadeIn } from '../motion/fade-in.tsx';
import { Text } from '../primitives/text.tsx';
/**
 * RecordWindow — the centred, read-only view of one record (Workbench handoff §0, §3.1).
 *
 * ```
 * ┌──────────────────────────────────────────────────── 720 ┐
 * │ Zaatar blend, house  [ INGREDIENT ] [ BLOCKED ]       ✕ │  44
 * ├─────────────────────────────────────────────────────────┤
 * │ ⓘ Nothing is resolved from this window. …               │
 * │ REFERENCE              FAMILY                           │
 * │ ING-0412               Ingredients                      │  2 × 280, no stretch
 * │ ┌ WHY IT IS HERE [FROM DATABASE] ─────────────────────┐ │
 * ├─────────────────────────────────────────────────────────┤
 * │ foot note                         [ Close ] [ Primary ] │  48
 * └─────────────────────────────────────────────────────────┘
 * ```
 *
 * It retires the side drawer for every kitchen-admin "view a record" surface. `Drawer` keeps its
 * callers elsewhere; this is the answer only to *inspect one record*.
 *
 * ## The three rules it owns
 *
 * 1. **An inner press never reaches the closer.** The Catalogue's `Menu` learned that an
 *    outside-press closer listening on `pointerdown` unmounts the surface before its own footer
 *    button receives `click`. Here the backdrop is a *sibling* underneath the panel rather than its
 *    parent, so a press on the panel has no path to it at all — nothing to swallow, on either
 *    event, on either platform.
 * 2. **The record is cleared on navigation.** Not enforceable from inside: the caller holds the
 *    record, and must reset it in the same action that changes family, search or page.
 * 3. **One primary, and it leaves the window.** The window never writes. `primaryAction` is a single
 *    object rather than a slot so a second primary cannot be passed.
 *
 * Esc and the focus trap are `Modal`'s — react-native-web wires both, and restores focus to the
 * trigger on close. Reimplementing them is how focus escapes to the page behind.
 */
export interface RecordWindowField {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Already formatted. */
    readonly value: string;
    /** Every numeral — quantity, money, reference, date — is `mono`. */
    readonly mono?: boolean | undefined;
}
export interface RecordWindowProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    /** Translated kind — "Ingredient", "Month". Drawn as a small upper badge beside the title. */
    readonly kind: string;
    readonly status?: { readonly label: string; readonly tone: BadgeTone } | undefined;
    /** A status the caller already renders as a node — a list's own `StatusBadge`. Beside `status`. */
    readonly titleAside?: ReactNode | undefined;
    /** One info banner above the fields, saying what this window cannot do. */
    readonly note?: string | undefined;
    readonly fields: readonly RecordWindowField[];
    readonly chips?: readonly { readonly key: string; readonly label: string }[] | undefined;
    readonly chipsLabel?: string | undefined;
    readonly chipsCaption?: string | undefined;
    readonly chipsSourceBadge?: string | undefined;
    /** Anything the fields cannot hold — a line list. Rendered under the chips. */
    readonly lines?: ReactNode | undefined;
    /** One 11px line at the footer's start. */
    readonly footNote?: string | undefined;
    /** The window's one way out that is not Close. Omit and Close stands alone. */
    readonly primaryAction?:
        | {
              readonly label: string;
              readonly onPress: () => void;
              /** Overrides `{testID}-primary`, for a caller whose suite already names the action. */
              readonly testID?: string | undefined;
          }
        | undefined;
    readonly testID?: string | undefined;
}
/* The panel is capped at the design's `min(720px, 100%)` — `max-w-[720px]` on the entrance wrapper. */
export function RecordWindow({
    open,
    onClose,
    title,
    kind,
    status,
    titleAside,
    note,
    fields,
    chips,
    chipsLabel,
    chipsCaption,
    chipsSourceBadge,
    lines,
    footNote,
    primaryAction,
    testID,
}: RecordWindowProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = testID ?? `record-window-${generated.replace(/:/g, '')}`;
    const titleId = `${base}-title`;
    return (
        <Modal
            visible={open}
            transparent
            // 'none' for the reason `Dialog` states: react-native-web's animated modals never fire
            // `animationend`, which leaves the dialog role and focus trap inactive.
            animationType="none"
            onRequestClose={onClose}
            {...({ 'aria-labelledby': titleId } as object)}
        >
            <View className="flex-1 items-center justify-center p-8">
                <Pressable
                    testID={`${base}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="absolute inset-0 bg-overlay"
                />
                <FadeIn className="w-full max-w-[720px]">
                    <View
                        testID={base}
                        role="dialog"
                        aria-modal
                        aria-labelledby={titleId}
                        className="max-h-[90vh] min-h-0 w-full shrink flex-col overflow-hidden rounded border border-stroke bg-surface-raised shadow-elevation-4"
                    >
                        <View className="h-11 flex-row items-center gap-2.5 border-b border-stroke-subtle pe-2.5 ps-base">
                            <RNText
                                nativeID={titleId}
                                testID={`${base}-title`}
                                accessibilityRole="header"
                                aria-level={2}
                                numberOfLines={1}
                                className="min-w-0 shrink text-role-strong text-content-primary text-start"
                            >
                                {title}
                            </RNText>
                            <Badge tone="neutral" label={kind} testID={`${base}-kind`} />
                            {status === undefined ? null : (
                                <Badge
                                    tone={status.tone}
                                    label={status.label}
                                    testID={`${base}-status`}
                                />
                            )}
                            {titleAside}
                            <View className="flex-1" />
                            <IconButton
                                testID={`${base}-close-icon`}
                                variant="ghost"
                                size="sm"
                                label={t('common:action.close')}
                                icon={<Icon name="close" size="sm" />}
                                onPress={onClose}
                            />
                        </View>
                        <ScrollView
                            testID={`${base}-body`}
                            className="min-h-0 shrink"
                            contentContainerClassName="flex-col gap-base px-base pb-base pt-3.5"
                        >
                            {note === undefined ? null : (
                                <Callout
                                    testID={`${base}-note`}
                                    tone="info"
                                    role="note"
                                    title={note}
                                />
                            )}
                            <RecordWindowFieldGrid fields={fields} testID={`${base}-field`} />
                            {chips === undefined || chipsLabel === undefined ? null : (
                                <DerivedChipPanel
                                    testID={`${base}-chips`}
                                    label={chipsLabel}
                                    badge={chipsSourceBadge}
                                    chips={chips}
                                    caption={chipsCaption}
                                />
                            )}
                            {lines}
                        </ScrollView>
                        <View className="h-12 flex-row items-center gap-control-sm border-t border-stroke-subtle px-base">
                            <View className="min-w-0 flex-1">
                                {footNote === undefined ? null : (
                                    <Text variant="caption" tone="secondary" numberOfLines={2}>
                                        {footNote}
                                    </Text>
                                )}
                            </View>
                            <Button
                                testID={`${base}-close`}
                                variant="secondary"
                                size="sm"
                                label={t('common:action.close')}
                                onPress={onClose}
                            />
                            {primaryAction === undefined ? null : (
                                <Button
                                    testID={primaryAction.testID ?? `${base}-primary`}
                                    size="sm"
                                    label={primaryAction.label}
                                    onPress={primaryAction.onPress}
                                />
                            )}
                        </View>
                    </View>
                </FadeIn>
            </View>
        </Modal>
    );
}
/** One field track — the design's `minmax(0, 280px)`. */
const FIELD_TRACK = 280;
/**
 * The window's field grid, on its own so a form section can draw the same read-only pairs.
 *
 * Two 280px tracks that do not stretch: the design's `repeat(2, minmax(0, 280px)); justify-content:
 * start`. A wrapping row of fixed cells is that grid in flexbox — a narrow window drops to one column
 * rather than squeezing two.
 */
export function RecordWindowFieldGrid({
    fields,
    testID,
}: {
    readonly fields: readonly RecordWindowField[];
    readonly testID?: string | undefined;
}) {
    return (
        <View testID={testID} className="flex-row flex-wrap gap-x-base gap-y-snug">
            {fields.map((field) => (
                <View
                    key={field.key}
                    testID={testID === undefined ? undefined : `${testID}-${field.key}`}
                    className="min-w-0 flex-col gap-0.5"
                    style={{ width: FIELD_TRACK, maxWidth: '100%' }}
                >
                    <Text variant="micro" tone="secondary">
                        {field.label}
                    </Text>
                    <Text
                        variant={field.mono === true ? 'mono' : 'body'}
                        testID={testID === undefined ? undefined : `${testID}-${field.key}-value`}
                    >
                        {field.value}
                    </Text>
                </View>
            ))}
        </View>
    );
}
