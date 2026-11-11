import { Icon, SlideIn, Text, useBreakpoint } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { DeskIconButton } from '../desk-kit/desk-button.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';

/**
 * The compact pop-up — one record over its list, with the reading in front of the furniture
 * (Orders redesign, 2026-11-10; "Order pop-up · compact" on the Orders canvas). Built once so any
 * list can open its records in it.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────────────────────┐
 * │ [‹ 6 of 11 ›]  DELIVERY ORDER          (Confirmed)(Late)            Total  ✕     │
 * │                ORD-K7M2Q9XW4P                                       $16.00       │
 * │ 📅 Today, Tue 10 Nov · Lunch   👤 Rania   📱 +961…   📍 Achrafieh   💵 …  [Next] │
 * ├──────────────────────────────────────────────────────────────────────────────────┤
 * │ ITEMS                               │ DELIVERY                                   │
 * │ …                                   │ PAYMENT                                    │
 * │                                     │ HISTORY                                    │ ← scrolls, thin bar
 * ├──────────────────────────────────────────────────────────────────────────────────┤
 * │ [Print ticket] [Edit order] [Hand to courier]                       [Cancel order] │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * In place of the canopy's green band, a slim header: the title, its chips and the one figure
 * that matters, then one line of key facts with the record's next step beside them. Only the body
 * scrolls, on the thin bar (`-thin-scroll`, `global.css`); the actions stay pinned at the foot.
 * ‹ › step through the list it was opened from without closing. It rises into place as it opens
 * (the canvas's `up`), and holds still under reduced motion.
 */

/** As `RecordDialog`'s: the room kept round the window on a laptop and on a phone. */
const GUTTER = 28;
const PHONE_GUTTER = 12;
const PHONE_MAX = 640;
const POPUP_WIDTH = 960;
/**
 * Every record opens in a window of one size, whatever it holds — a two-line order and a twenty-line
 * one in the same frame, so stepping through a list with ‹ › never makes the window jump. A short
 * record leaves room under it; a long one scrolls its body.
 */
const POPUP_HEIGHT = 720;
/** Below this the two columns stack. */
const TWO_COLUMNS_MIN = 720;

export interface CompactFact {
    readonly key: string;
    readonly icon: IconName;
    readonly text: string;
    readonly tone?: 'warning' | 'success' | undefined;
    readonly testID?: string | undefined;
}

export interface CompactNav {
    /** "6 of 11". */
    readonly position: string;
    /** `undefined` on the first — the arrow is drawn, and off. */
    readonly onPrevious?: (() => void) | undefined;
    readonly onNext?: (() => void) | undefined;
}

export interface CompactRecordPopupProps {
    /** Translated. The window's accessible name and the trail's leaf. */
    readonly label: string;
    /** Translated, upper label over the title — "Delivery order". */
    readonly kind: string;
    readonly title: string;
    readonly chips?: ReactNode;
    /** The figure the header carries at its end — an order's total. */
    readonly figure?: { readonly label: string; readonly value: string } | undefined;
    readonly nav?: CompactNav | undefined;
    readonly facts?: readonly CompactFact[] | undefined;
    /** The record's next step, at the end of the facts line. */
    readonly primary?: ReactNode;
    /** Notes over the columns — an allergy, a refused write. */
    readonly banner?: ReactNode;
    readonly main: ReactNode;
    readonly side?: ReactNode;
    /** The pinned actions; `footerEnd` sits at the far end (Cancel order). */
    readonly footer?: ReactNode;
    readonly footerEnd?: ReactNode;
    readonly onClose: () => void;
    readonly testID: string;
}

export function CompactRecordPopup({
    label,
    kind,
    title,
    chips,
    figure,
    nav,
    facts = [],
    primary,
    banner,
    main,
    side,
    footer,
    footerEnd,
    onClose,
    testID,
}: CompactRecordPopupProps) {
    const { t } = useTranslation();
    const viewport = useWindowDimensions();
    const { atLeast } = useBreakpoint();
    useKitchenTrailLeaf(label, onClose);

    const gutter = viewport.width < PHONE_MAX ? PHONE_GUTTER : GUTTER;
    const width = Math.max(0, Math.min(POPUP_WIDTH, viewport.width - gutter * 2));
    const height = Math.max(0, Math.min(POPUP_HEIGHT, viewport.height - gutter * 2));
    const twoColumns = side !== undefined && width >= TWO_COLUMNS_MIN && atLeast('md');
    // The two columns share the window between them: each takes its part of the row.

    const mainColumn = twoColumns ? 'min-w-0 flex-1' : 'min-w-0';

    const sideColumn = twoColumns ? 'min-w-0 flex-1 flex-col gap-4' : 'flex-col gap-4';

    return (
        <Modal
            visible
            transparent
            animationType="none"
            onRequestClose={onClose}
            {...({ 'aria-label': label } as object)}
        >
            {/* eslint-disable-next-line no-restricted-syntax -- the modal's ground fills the screen. */}
            <View className="flex-1 items-center justify-center" style={{ padding: gutter }}>
                <Pressable
                    testID={`${testID}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="absolute inset-0 bg-overlay"
                />
                <SlideIn edge="bottom" distance="medium" duration="normal">
                    <View
                        testID={testID}
                        role="dialog"
                        aria-modal
                        aria-label={label}
                        style={{ width, height }}
                        className="min-h-0 flex-col overflow-hidden rounded-[20px] border border-stroke-subtle bg-surface-raised shadow-elevation-5"
                    >
                        {/* The header: never scrolls. */}
                        <View className="z-10 flex-col border-b border-stroke-subtle bg-surface-raised">
                            <View className="flex-row flex-wrap items-center gap-3 pb-2 pe-3 ps-3 pt-3">
                                {nav === undefined ? null : (
                                    <View
                                        testID={`${testID}-nav`}
                                        className="flex-row items-center gap-0.5 rounded-xl bg-surface-sunken p-[3px]"
                                    >
                                        <DeskIconButton
                                            testID={`${testID}-previous`}
                                            flat
                                            label={t('kitchen:compactPopup.previous')}
                                            icon={<Icon name="chevronBackward" size="md" />}
                                            disabled={nav.onPrevious === undefined}
                                            onPress={() => {
                                                nav.onPrevious?.();
                                            }}
                                        />
                                        <Text
                                            variant="caption"
                                            tone="secondary"
                                            className="min-w-12 text-center font-semibold tabular-nums"
                                            testID={`${testID}-position`}
                                        >
                                            {nav.position}
                                        </Text>
                                        <DeskIconButton
                                            testID={`${testID}-next`}
                                            flat
                                            label={t('kitchen:compactPopup.next')}
                                            icon={<Icon name="chevronForward" size="md" />}
                                            disabled={nav.onNext === undefined}
                                            onPress={() => {
                                                nav.onNext?.();
                                            }}
                                        />
                                    </View>
                                )}
                                <View className="min-w-0 shrink flex-col">
                                    <Text
                                        variant="micro"
                                        tone="secondary"
                                        className="font-bold uppercase tracking-wider"
                                        testID={`${testID}-kind`}
                                    >
                                        {kind}
                                    </Text>
                                    <Text
                                        variant="section"
                                        numberOfLines={1}
                                        className="font-display !text-xl !font-bold !leading-6"
                                        testID={`${testID}-title`}
                                        accessibilityRole="header"
                                    >
                                        {title}
                                    </Text>
                                </View>
                                {chips === undefined ? null : (
                                    <View className="flex-row flex-wrap items-center gap-1">
                                        {chips}
                                    </View>
                                )}
                                <View className="ms-auto flex-row items-center gap-2">
                                    {figure === undefined ? null : (
                                        <View className="flex-col items-end">
                                            <Text
                                                variant="caption"
                                                tone="secondary"
                                                className="font-semibold"
                                            >
                                                {figure.label}
                                            </Text>
                                            <Text
                                                variant="title"
                                                tone="brand"
                                                className="font-display !text-[22px] !font-bold !leading-[26px] tabular-nums"
                                                testID={`${testID}-figure`}
                                            >
                                                {figure.value}
                                            </Text>
                                        </View>
                                    )}
                                    <DeskIconButton
                                        testID={`${testID}-close`}
                                        label={t('common:action.close')}
                                        icon={<Icon name="close" size="md" />}
                                        onPress={onClose}
                                    />
                                </View>
                            </View>
                            {facts.length === 0 && primary === undefined ? null : (
                                <View
                                    testID={`${testID}-facts`}
                                    className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5 pb-3 pe-3 ps-3"
                                >
                                    {facts.map((fact) => (
                                        <View
                                            key={fact.key}
                                            testID={fact.testID}
                                            className="flex-row items-center gap-1.5"
                                        >
                                            <Icon
                                                name={fact.icon}
                                                size="md"
                                                className={
                                                    fact.tone === 'warning'
                                                        ? 'text-warning'
                                                        : fact.tone === 'success'
                                                          ? 'text-content-on-brand-subtle'
                                                          : 'text-content-secondary'
                                                }
                                            />
                                            <Text
                                                variant="label"
                                                className={`!text-[13px] tabular-nums ${
                                                    fact.tone === 'warning'
                                                        ? '!font-bold !text-warning-on-subtle'
                                                        : fact.tone === 'success'
                                                          ? '!font-semibold !text-content-on-brand-subtle'
                                                          : ''
                                                }`}
                                                {...(fact.tone === undefined
                                                    ? {}
                                                    : { tone: fact.tone })}
                                            >
                                                {fact.text}
                                            </Text>
                                        </View>
                                    ))}
                                    {primary === undefined ? null : (
                                        <View className="ms-auto">{primary}</View>
                                    )}
                                </View>
                            )}
                        </View>

                        {/* The body: the one part that scrolls, on the thin bar. */}
                        <ScrollView
                            testID={`${testID}-thin-scroll`}
                            // eslint-disable-next-line no-restricted-syntax -- the body takes the window's height the header and foot leave.
                            className="min-h-0 flex-1"
                            contentContainerClassName="flex-col gap-[14px] pb-[18px] pe-4 ps-4 pt-[14px]"
                        >
                            {banner}
                            <View
                                className={
                                    twoColumns ? 'flex-row items-start gap-5' : 'flex-col gap-4'
                                }
                            >
                                <View className={mainColumn}>{main}</View>
                                {side === undefined ? null : (
                                    <View className={sideColumn}>{side}</View>
                                )}
                            </View>
                        </ScrollView>

                        {footer === undefined && footerEnd === undefined ? null : (
                            <View
                                testID={`${testID}-footer`}
                                className="z-10 flex-row flex-wrap items-center gap-2 border-t border-stroke-subtle bg-surface-raised px-[14px] py-2.5"
                            >
                                {footer}
                                {footerEnd === undefined ? null : (
                                    <View className="ms-auto flex-row items-center gap-2">
                                        {footerEnd}
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
                </SlideIn>
            </View>
        </Modal>
    );
}

/** A section of the pop-up's body: an upper label and its content. */
export function CompactSection({
    title,
    children,
    testID,
}: {
    readonly title: string;
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}) {
    return (
        <View testID={testID} role="region" aria-label={title} className="min-w-0 flex-col">
            <Text
                variant="micro"
                tone="secondary"
                className="mb-1 !text-[11px] font-bold uppercase tracking-wider"
            >
                {title}
            </Text>
            {children}
        </View>
    );
}

/** The value of a field takes what the label leaves of its row. */

const FIELD_VALUE = 'min-w-0 flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-1';

/** One labelled fact of a section, on a hairline: label on the start, value and a link after. */
export function CompactField({
    label,
    children,
    action,
    testID,
}: {
    readonly label: string;
    readonly children: ReactNode;
    readonly action?: ReactNode;
    readonly testID?: string | undefined;
}) {
    return (
        <View className="min-h-8 flex-row items-center gap-2 border-b border-stroke-subtle py-1.5">
            <Text variant="label" tone="secondary" className="w-24 shrink-0 !text-[13px]">
                {label}
            </Text>
            <View testID={testID} className={FIELD_VALUE}>
                {children}
            </View>
            {action}
        </View>
    );
}
