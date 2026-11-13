import { FadeIn, Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, ScrollView, View } from 'react-native';

/**
 * What kind of question the pop-up asks, carried by its head: `brand` a plain choice, `warning` a
 * choice with a cost the person should see, `danger` something that cannot be taken back.
 */
export type ShopDialogTone = 'brand' | 'warning' | 'danger';

const HEAD: Readonly<
    Record<ShopDialogTone, { band: string; ink: string; tile: string; tileInk: string }>
> = {
    brand: {
        band: 'bg-surface-brand-subtle',
        ink: 'text-content-on-brand-subtle',
        tile: 'bg-surface-brand',
        tileInk: 'text-content-on-brand',
    },
    warning: {
        band: 'bg-warning-subtle',
        ink: 'text-warning-on-subtle',
        tile: 'bg-warning-strong',
        tileInk: 'text-warning-on-strong',
    },
    danger: {
        band: 'bg-danger-subtle',
        ink: 'text-danger-on-subtle',
        tile: 'bg-danger-strong',
        tileInk: 'text-danger-on-strong',
    },
};

export interface ShopDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly icon: IconName;
    readonly tone?: ShopDialogTone | undefined;
    /** One sentence under the head, when the subject card does not say it all. */
    readonly description?: string | undefined;
    readonly children?: ReactNode | undefined;
    /** `ShopDialogButton`s, secondary first. Side by side on a wide screen, stacked on a phone. */
    readonly actions?: ReactNode | undefined;
    readonly dismissOnBackdrop?: boolean | undefined;
    readonly testID?: string | undefined;
}

/**
 * The shop's pop-up — the accepted Allergen board's anatomy, given to every question the shop asks
 * (Shop · Subscription, Account, Basket + checkout and Menu boards): a tinted head with an icon tile,
 * the title and a close button, then the card showing the thing the question is about, what happens
 * next, and two buttons. Below `md` it is a bottom sheet with a grab handle, its buttons stacked with
 * the main one on top.
 *
 * The design system's `Dialog` stays the admin's: this is the shop's own look, not a variant of it.
 * Its semantics are the same — React Native's `Modal`, a labelled `role="dialog"`, Escape and the
 * backdrop close it, and the body scrolls so the buttons never leave the screen. The testIDs follow
 * `Dialog`'s (`-title`, `-description`, `-close`, `-backdrop`, `-actions`), so a screen moved over
 * keeps its tests.
 */
export function ShopDialog({
    open,
    onClose,
    title,
    icon,
    tone = 'brand',
    description,
    children,
    actions,
    dismissOnBackdrop = true,
    testID,
}: ShopDialogProps) {
    const { t } = useTranslation();
    const generated = useId();
    const { atLeast } = useBreakpoint();
    const sheet = !atLeast('md');
    const base = testID ?? `shop-dialog-${generated.replace(/:/g, '')}`;
    const titleId = `${base}-title`;
    const descriptionId = description === undefined ? undefined : `${base}-description`;
    const head = HEAD[tone];

    return (
        <Modal
            visible={open}
            transparent
            animationType="none"
            onRequestClose={onClose}
            {...({ 'aria-labelledby': titleId } as object)}
        >
            <View
                className={cx('flex-1', sheet ? 'justify-end' : 'items-center justify-center p-4')}
            >
                <Pressable
                    testID={`${base}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={dismissOnBackdrop ? onClose : undefined}
                    className="absolute inset-0 bg-surface-inverse/50"
                />
                <View className={cx('w-full', sheet ? null : 'max-w-[480px]')}>
                    <FadeIn>
                        <View
                            testID={base}
                            role="dialog"
                            aria-modal
                            aria-labelledby={titleId}
                            aria-describedby={descriptionId}
                            className={cx(
                                'max-h-[90vh] w-full min-h-0 shrink overflow-hidden bg-surface-raised shadow-elevation-4',
                                sheet ? 'rounded-t-[28px]' : 'rounded-[28px]',
                            )}
                        >
                            <View
                                className={cx(
                                    'relative overflow-hidden px-6 pb-5',
                                    sheet ? 'pt-[26px]' : 'pt-[22px]',
                                    head.band,
                                )}
                            >
                                <View
                                    aria-hidden
                                    className={cx(
                                        'absolute -end-[60px] -top-[70px] h-[210px] w-[210px] rounded-full opacity-10',
                                        head.tile,
                                    )}
                                />
                                {sheet ? (
                                    <View
                                        aria-hidden
                                        className={cx('absolute start-0 end-0 top-2 items-center')}
                                    >
                                        <View
                                            className={cx(
                                                'h-[5px] w-10 rounded-full opacity-25',
                                                head.tile,
                                            )}
                                        />
                                    </View>
                                ) : null}
                                <View
                                    aria-hidden
                                    className={cx(
                                        'h-[52px] w-[52px] items-center justify-center rounded-[17px] shadow-elevation-2',
                                        head.tile,
                                    )}
                                >
                                    <Icon name={icon} size="lg" className={head.tileInk} />
                                </View>
                                <RNText
                                    nativeID={titleId}
                                    testID={`${base}-title`}
                                    accessibilityRole="header"
                                    aria-level={2}
                                    className={cx(
                                        'mt-3.5 pe-10 font-display font-bold text-start',
                                        sheet ? 'text-xl leading-7' : 'text-2xl leading-[30px]',
                                        head.ink,
                                    )}
                                >
                                    {title}
                                </RNText>
                                <Pressable
                                    testID={`${base}-close`}
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common:action.close')}
                                    onPress={onClose}
                                    className="absolute end-3.5 top-3.5 h-10 w-10 items-center justify-center rounded-full bg-surface-raised/60 hover:bg-surface-raised"
                                >
                                    <Icon name="close" size="sm" className={head.ink} />
                                </Pressable>
                            </View>

                            <ScrollView
                                testID={`${base}-body`}
                                className="min-h-0 shrink"
                                contentContainerClassName={cx(
                                    'flex-col',
                                    sheet ? 'px-[18px] pb-7 pt-[18px]' : 'px-6 pb-6 pt-5',
                                )}
                            >
                                {description === undefined ? null : (
                                    <RNText
                                        nativeID={descriptionId}
                                        testID={`${base}-description`}
                                        className="mb-3.5 text-base leading-6 text-content-secondary text-start"
                                    >
                                        {description}
                                    </RNText>
                                )}
                                {children}
                                {actions === undefined ? null : (
                                    <View
                                        testID={`${base}-actions`}
                                        className={cx(
                                            'mt-5 gap-2',
                                            sheet ? 'flex-col-reverse' : 'flex-row',
                                        )}
                                    >
                                        {actions}
                                    </View>
                                )}
                            </ScrollView>
                        </View>
                    </FadeIn>
                </View>
            </View>
        </Modal>
    );
}

export type ShopDialogButtonKind = 'secondary' | 'brand' | 'danger' | 'ink';

const BUTTON: Readonly<Record<ShopDialogButtonKind, { box: string; ink: string }>> = {
    secondary: {
        box: 'border border-stroke bg-surface-raised hover:bg-surface-sunken',
        ink: 'text-content-primary',
    },
    brand: { box: 'bg-surface-brand hover:opacity-90', ink: 'text-content-on-brand' },
    danger: { box: 'bg-danger-strong hover:opacity-90', ink: 'text-danger-on-strong' },
    ink: { box: 'bg-surface-inverse hover:opacity-90', ink: 'text-content-inverse' },
};

export interface ShopDialogButtonProps {
    readonly label: string;
    readonly onPress: () => void;
    readonly kind?: ShopDialogButtonKind | undefined;
    readonly icon?: IconName | undefined;
    /** The icon after the label — an arrow onwards — rather than before it. */
    readonly iconAfter?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly busy?: boolean | undefined;
    readonly testID?: string | undefined;
}

/** A pop-up's button: 52px, the main one a little wider than its partner. */
export function ShopDialogButton({
    label,
    onPress,
    kind = 'secondary',
    icon,
    iconAfter = false,
    disabled = false,
    busy = false,
    testID,
}: ShopDialogButtonProps) {
    const style = BUTTON[kind];
    const off = disabled || busy;
    const glyph =
        icon === undefined ? null : (
            <Icon name={icon} size="md" className={off ? 'text-content-secondary' : style.ink} />
        );
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            aria-disabled={off}
            accessibilityState={{ disabled: off, busy }}
            disabled={off}
            onPress={onPress}
            className={cx(
                'min-h-[52px] flex-row items-center justify-center gap-2 rounded-2xl px-3.5',
                kind === 'secondary' ? 'flex-1' : 'flex-[1.35]',
                off && kind !== 'secondary' ? 'bg-stroke' : style.box,
            )}
        >
            {iconAfter ? null : glyph}
            <RNText
                className={cx(
                    'text-base font-bold text-center',
                    off && kind !== 'secondary' ? 'text-content-secondary' : style.ink,
                )}
            >
                {label}
            </RNText>
            {iconAfter ? glyph : null}
        </Pressable>
    );
}

export interface ShopDialogSubjectProps {
    /** The photo, icon tile or date tile at the start. */
    readonly lead: ReactNode;
    readonly name: string;
    readonly meta?: string | undefined;
    /** A small tag beside the name. */
    readonly tag?: ReactNode | undefined;
    /** A figure at the end — a price, a count. */
    readonly end?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

/** The card naming what the question is about: the dish, the plan, the address. */
export function ShopDialogSubject({ lead, name, meta, tag, end, testID }: ShopDialogSubjectProps) {
    return (
        <View
            testID={testID}
            className="flex-row items-center gap-3 rounded-[18px] bg-surface-base p-2.5"
        >
            {lead}
            <View className="min-w-0 flex-1">
                <View className="flex-row flex-wrap items-center gap-2">
                    <RNText className="shrink text-base font-bold text-content-primary text-start">
                        {name}
                    </RNText>
                    {tag}
                </View>
                {meta === undefined ? null : (
                    <RNText className="mt-0.5 text-sm text-content-secondary text-start">
                        {meta}
                    </RNText>
                )}
            </View>
            {end}
        </View>
    );
}

/** An icon tile for `ShopDialogSubject`'s lead. */
export function ShopDialogTile({ icon }: { readonly icon: IconName }) {
    return (
        <View className="h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-surface-brand-subtle">
            <Icon name={icon} size="lg" className="text-content-on-brand-subtle" />
        </View>
    );
}

/** A date tile for `ShopDialogSubject`'s lead: the weekday small over the day of the month. */
export function ShopDialogDateTile({
    weekday,
    day,
}: {
    readonly weekday: string;
    readonly day: string;
}) {
    return (
        <View className="h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-stroke bg-surface-raised">
            <RNText className="text-xs font-bold uppercase text-content-secondary">
                {weekday}
            </RNText>
            <RNText className="font-display text-xl font-bold leading-6 text-content-primary">
                {day}
            </RNText>
        </View>
    );
}

export interface ShopDialogTagProps {
    readonly label: string;
    readonly tone?: 'brand' | 'warning' | 'muted' | undefined;
}

export function ShopDialogTag({ label, tone = 'brand' }: ShopDialogTagProps) {
    return (
        <View
            className={cx(
                'h-[22px] justify-center rounded-full px-2',
                tone === 'brand'
                    ? 'bg-surface-brand'
                    : tone === 'warning'
                      ? 'bg-warning-subtle'
                      : 'bg-stroke',
            )}
        >
            <RNText
                className={cx(
                    'text-xs font-bold',
                    tone === 'brand'
                        ? 'text-content-on-brand'
                        : tone === 'warning'
                          ? 'text-warning-on-subtle'
                          : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </View>
    );
}

export interface ShopDialogConsequenceProps {
    readonly icon: IconName;
    readonly title: string;
    readonly body?: string | undefined;
    readonly testID?: string | undefined;
}

/** What follows the choice: a small icon tile, a bold line and the line under it. */
export function ShopDialogConsequence({ icon, title, body, testID }: ShopDialogConsequenceProps) {
    return (
        <View testID={testID} className="mt-3.5 flex-row gap-3 px-0.5">
            <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-surface-base">
                <Icon name={icon} size="md" className="text-content-primary" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="text-sm font-bold leading-5 text-content-primary text-start">
                    {title}
                </RNText>
                {body === undefined ? null : (
                    <RNText className="text-sm leading-5 text-content-secondary text-start">
                        {body}
                    </RNText>
                )}
            </View>
        </View>
    );
}
