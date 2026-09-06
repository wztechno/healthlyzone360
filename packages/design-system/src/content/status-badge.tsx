import { Badge } from './badge.tsx';
import type { BadgeTone } from './badge.tsx';

/**
 * StatusBadge — one record status, rendered the same way everywhere it appears.
 *
 * A status appears in three places on any given entity — the list row, the detail drawer and the
 * editor's header — and in the system this replaces those three disagree: the list draws Draft
 * amber, the drawer draws it grey, and the editor writes the word with no badge at all. A person
 * comparing a row against the record it opens has to work out whether they are looking at the same
 * thing.
 *
 * So the mapping from status to tone lives here and nowhere else, and every surface that shows a
 * status shows this component.
 *
 * ## The tone map is the handoff's, verbatim
 *
 * Draft → warning, Review → info, Archived → neutral, Restricted → danger, Live → brand (§1.3's
 * badge table). None of it is a new colour: each is an existing `semantic*.subtle` / `onSubtle`
 * pair, which is why the contrast gate is satisfied by construction.
 *
 * `Badge` supplies each tone's icon, so the meaning survives greyscale — the standing rule that
 * meaning is never carried by colour alone. A status is exactly the case that rule exists for: the
 * difference between an archived ingredient and a live one is not a thing to signal in hue only.
 */

export const RECORD_STATUSES = [
    'draft',
    'review',
    'live',
    'archived',
    'restricted',
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/**
 * Status → badge tone.
 *
 * Exported because `format.ts`'s `statusTone()` is the app-side entry point the handoff names (§3)
 * and it needs something to map *onto*. Keeping the table here rather than there keeps the design
 * system's vocabulary — `BadgeTone` — out of a domain formatting module.
 */
export const STATUS_TONE: Readonly<Record<RecordStatus, BadgeTone>> = {
    draft: 'warning',
    review: 'info',
    live: 'brand',
    archived: 'neutral',
    restricted: 'danger',
};

export interface StatusBadgeProps {
    readonly status: RecordStatus;
    /**
     * The translated label. Required, and deliberately not derived from `status`: the catalogues
     * live in `packages/i18n` and a design-system component that reached into them would put the
     * product's copy inside the component library.
     */
    readonly label: string;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function StatusBadge({ status, label, className, testID }: StatusBadgeProps) {
    return (
        <Badge
            label={label}
            tone={STATUS_TONE[status]}
            {...(className === undefined ? {} : { className })}
            {...(testID === undefined ? {} : { testID })}
        />
    );
}
