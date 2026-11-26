import { Button, Icon, InRecordPopup, RecordPopupWindow } from '@healthy360/design-system';
import type {
    IconName,
    RecordPopupAction,
    RecordPopupWindowProps,
} from '@healthy360/design-system';
import type { ReactNode } from 'react';

import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';

/**
 * A kitchen-admin record, opened as a pop-up over the list it was picked from — the
 * `View as a pop-up` canvas (2026-11-07). The design system's `RecordPopupWindow` plus the two things
 * only the kitchen admin knows:
 *
 * - **The trail.** `useKitchenTrailLeaf` still names the record as the shell's last crumb, and the
 *   list's crumb closes it, so the breadcrumb says what is open while the list is dimmed behind.
 * - **Where two columns fit.** Tiles split against the window's inner width, not the page's
 *   (`useRecordSplit`).
 *
 * A caller renders its list as always and this beside it while it holds a record.
 *
 * **The desk frame (2026-11-11).** The window is the Orders pop-up's (`RecordPopupWindow`): a slim
 * header with the kind and the ✕, the record's own canopy and tiles as the scrolling body, and every
 * action as a `Button` pinned at the foot — the primary first and green, the rest outlined, a
 * destructive one at the far end. A button that is writing shows the desk's sweep. Each keeps the
 * id it had as a ⋯ entry (`{testID}-actions-menu-item-{key}` unless it names its own).
 */

export type RecordAction = RecordPopupAction;

/**
 * The design system's record window, named as the shell trail's last crumb while it is open — the
 * list's crumb closes it. Every kitchen record pop-up opens through this.
 */
export function TrailedRecordWindow(props: RecordPopupWindowProps) {
    useKitchenTrailLeaf(props.label, props.onClose);
    return <RecordPopupWindow {...props} />;
}

/**
 * The old canopy button, as the ⋯ menu's first entry. Kept so a screen moves across without
 * restating its Edit: `pen` by default, `null` for one that is not an edit.
 */
export interface RecordPrimaryAction {
    readonly label: string;
    readonly onPress: () => void;
    readonly icon?: IconName | null | undefined;
    /** Overrides `{testID}-primary`. */
    readonly testID?: string | undefined;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
}

export function primaryMenuAction(primary: RecordPrimaryAction, testID: string): RecordPopupAction {
    return {
        key: 'primary',
        label: primary.label,
        icon: primary.icon === null ? undefined : (primary.icon ?? 'pen'),
        onSelect: primary.onPress,
        tone: 'brand',
        loading: primary.loading,
        disabled: primary.disabled,
        testID: primary.testID ?? `${testID}-primary`,
    };
}

export interface RecordPopupProps {
    /** Translated record name. The window's accessible name and the trail's leaf. */
    readonly title: string;
    /** Translated kind, drawn as the window's upper label. */
    readonly kind: string;
    readonly onClose: () => void;
    readonly primaryAction?: RecordPrimaryAction | undefined;
    readonly actions?: readonly RecordAction[] | undefined;
    /** Before the kind label: the Back pill to the page that opened the record, when one did. */
    readonly leading?: ReactNode;
    readonly children: ReactNode;
    /** The record's own reference, as a chip beside the kind — the record sheet's. */
    readonly reference?: string | null | undefined;
    readonly referenceTestID?: string | undefined;
    /** The record sheet's larger window (option A of `Record pop-up — no canopy`). */
    readonly sheet?: boolean | undefined;
    readonly testID: string;
}

const ICON_INK = {
    primary: 'text-content-on-brand',
    secondary: 'text-content-primary',
    dangerOutline: 'text-danger-strong',
} as const;

export function RecordPopup({
    title,
    kind,
    onClose,
    primaryAction,
    actions = [],
    leading,
    children,
    reference,
    referenceTestID,
    sheet = false,
    testID,
}: RecordPopupProps) {
    const all =
        primaryAction === undefined
            ? actions
            : [primaryMenuAction(primaryAction, testID), ...actions];
    const button = (action: RecordPopupAction, index: number) => {
        const variant =
            action.tone === 'danger'
                ? 'dangerOutline'
                : action.tone === 'brand' && index === 0
                  ? 'primary'
                  : 'secondary';
        return (
            <Button
                key={action.key}
                testID={action.testID ?? `${testID}-actions-menu-item-${action.key}`}
                label={action.label}
                variant={variant}
                iconStart={
                    action.icon === undefined ? undefined : (
                        <Icon name={action.icon} size="sm" className={ICON_INK[variant]} />
                    )
                }
                loading={action.loading}
                disabled={action.disabled}
                onPress={action.onSelect}
            />
        );
    };
    // The record's primary leads the foot, wherever the caller listed it.
    const ahead = [
        ...all.filter((action) => action.tone === 'brand'),
        ...all.filter((action) => action.tone !== 'brand' && action.tone !== 'danger'),
    ];
    const danger = all.filter((action) => action.tone === 'danger');

    return (
        <TrailedRecordWindow
            label={title}
            kind={kind}
            leading={leading}
            onClose={onClose}
            testID={testID}
            windowTestID={`${testID}-window`}
            kindTestID={`${testID}-eyebrow`}
            reference={reference}
            referenceTestID={referenceTestID}
            roomy={sheet}
            main={<InRecordPopup.Provider value>{children}</InRecordPopup.Provider>}
            {...(ahead.length === 0 ? {} : { footer: ahead.map(button) })}
            {...(danger.length === 0
                ? {}
                : { footerEnd: danger.map((action) => button(action, -1)) })}
        />
    );
}
