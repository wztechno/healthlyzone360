import { Callout, Menu } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../../access/gate.tsx';
import {
    useKitchenServiceSettingsQuery,
    usePauseKitchenMutation,
    useResumeKitchenMutation,
} from '../../../data/staff-alerts-hooks.ts';
import { DropTrigger } from '../desk-kit/index.ts';
import { ORDER_SUPERVISE_PERMISSION } from '../entity-registry.ts';

import { DeskButton } from '../desk-kit/desk-button.tsx';
/**
 * The timed brake on the whole kitchen: customers are refused until it runs out, and the desk's
 * quote warns instead. It ends by the clock, so there is nothing to remember to undo; Start again
 * ends it early. Drawn for whoever may pull it, and everybody else hears it from the quote.
 */

/** A rush, a longer rush, a broken oven, a bad afternoon. */
const PAUSE_MINUTES = [15, 30, 60, 120] as const;

/** The server's word: it answers null once a pause has run out. */
function usePausedUntil(): string | null {
    const settings = useKitchenServiceSettingsQuery(useCan(ORDER_SUPERVISE_PERMISSION));
    return settings.data?.pausedUntil ?? null;
}

/**
 * The toolbar's button — the desk's dropdown pill (`DropTrigger`) opening the same rising card menu
 * as the calendar's Slot and Type, one row per length. Gone while a pause runs: the banner carries
 * the way out.
 */
export function KitchenPauseButton() {
    const { t } = useTranslation();
    const canPause = useCan(ORDER_SUPERVISE_PERMISSION);
    const pausedUntil = usePausedUntil();
    const pause = usePauseKitchenMutation();

    if (!canPause || pausedUntil !== null) return null;

    const button = t('kitchen:desk.pause.button');
    return (
        <Menu
            testID="kitchen-pause"
            label={button}
            look="card"
            closeOnSelect
            align="end"
            className="z-auto"
            sections={[
                {
                    label: t('kitchen:desk.pause.title'),
                    items: PAUSE_MINUTES.map((minutes) => ({
                        key: String(minutes),
                        label: t('kitchen:desk.pause.minutes', { count: minutes }),
                        disabled: pause.isPending,
                        testID: `kitchen-pause-${String(minutes)}`,
                        onSelect: () => {
                            pause.mutate(minutes);
                        },
                    })),
                },
            ]}
            trigger={({ triggerProps, toggle, open }) => (
                <DropTrigger
                    triggerProps={triggerProps}
                    onPress={toggle}
                    open={open}
                    filled={false}
                    value={button}
                    accessibilityLabel={button}
                    testID="kitchen-pause-trigger"
                />
            )}
        />
    );
}

/** Said above the queue for as long as customers are being turned away. */
export function KitchenPauseBanner() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const pausedUntil = usePausedUntil();
    const resume = useResumeKitchenMutation();

    if (pausedUntil === null) return null;

    return (
        <Callout
            testID="kitchen-pause-banner"
            tone="warning"
            icon="warning"
            role="status"
            title={t('kitchen:desk.pause.pausedUntil', {
                time: formatter.formatDate(pausedUntil, { timeStyle: 'short' }),
            })}
            body={t('kitchen:desk.pause.pausedBody')}
            actions={
                <DeskButton
                    testID="kitchen-pause-resume"
                    size="sm"
                    variant="secondary"
                    label={t('kitchen:desk.pause.resume')}
                    loading={resume.isPending}
                    onPress={() => {
                        resume.mutate();
                    }}
                />
            }
        />
    );
}
