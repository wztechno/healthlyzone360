import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSupplyCommitmentsQuery } from '../../../data/business-hooks.ts';
import type { SupplyCommitment } from '../../../data/business-hooks.ts';
import { isoWeekday } from '../../commerce/dates.ts';
import { weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { SUPPLY_HORIZON_DAYS, supplyDates } from '../format.ts';

/**
 * `/partner/schedule` — the supply days a supplier has to hit, by date.
 *
 * ## The dates come from the record, never from the clock
 *
 * Each committed line's window opens at its requested delivery date, or — when the buyer named none
 * — at the day the request was raised plus the line's own lead time. Those dates are then projected
 * onto the line's delivery weekdays (`../format.ts`). Anchoring on "today" instead would make this
 * screen show something different on every run, and would make the fixture week (Monday 27 July
 * 2026) impossible to assert against.
 *
 * ## Grouped by day, because that is how a kitchen plans
 *
 * A supplier does not read a list of contracts, they read a list of mornings. So the join is
 * inverted here relative to the commitments screen: one card per date, every line due on it, and the
 * quantity beside each. No prices — see the commitments screen for why that is a decision rather
 * than an omission.
 *
 * ## Unreachable while `partnerSupply` is unavailable
 *
 * Schedule is derived from commitments, and there is no partner commitments API. The whole
 * `partner` area is therefore hidden by `src/features/availability.ts` and `AreaShell` redirects out
 * of it, so this screen has no visitor to show a deferred empty state to — the branch that rendered
 * one is gone rather than left as a comparison that can only ever be false.
 */

/** How many supply days each line contributes. Four weeks of a five-day line is twenty. */
const DATES_PER_LINE = 8;

interface ScheduledDay {
    readonly date: string;
    readonly lines: readonly SupplyCommitment[];
}

export function PartnerScheduleScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const query = useSupplyCommitmentsQuery();

    const byDate = new Map<string, SupplyCommitment[]>();
    for (const commitment of query.data ?? []) {
        for (const date of supplyDates(commitment.quotation, commitment.item, DATES_PER_LINE)) {
            const existing = byDate.get(date) ?? [];
            existing.push(commitment);
            byDate.set(date, existing);
        }
    }

    const days: readonly ScheduledDay[] = [...byDate.entries()]
        .map(([date, lines]) => ({ date, lines }))
        .sort((left, right) => left.date.localeCompare(right.date));

    return (
        <Stack space="lg" testID="partner-schedule-screen">
            <Stack space="xs">
                <Heading level={1} testID="partner-schedule-title">
                    {t('business:schedule.title')}
                </Heading>
                <Text tone="secondary">{t('business:schedule.body')}</Text>
            </Stack>

            <Callout
                testID="partner-schedule-derivation"
                role="note"
                tone="info"
                icon="info"
                title={t('business:schedule.derivationTitle')}
                body={t('business:schedule.derivationBody', { days: SUPPLY_HORIZON_DAYS })}
            />

            <QueryStates
                query={query}
                isEmpty={days.length === 0}
                emptyTitle={t('business:schedule.emptyTitle')}
                emptyBody={t('business:schedule.emptyBody')}
                skeletonCount={3}
                testID="partner-schedule"
            >
                <Stack space="sm" testID="partner-schedule-days">
                    {days.map((day) => {
                        const weekday = isoWeekday(day.date);
                        return (
                            <Card
                                key={day.date}
                                testID={`partner-schedule-day-${day.date}`}
                                padding="md"
                            >
                                <Stack space="sm">
                                    <Inline space="sm" align="center" justify="between">
                                        <Text variant="bodyStrong">
                                            {formatter.formatDate(day.date, {
                                                dateStyle: 'full',
                                            })}
                                        </Text>
                                        <Badge
                                            tone="neutral"
                                            icon="dot"
                                            label={
                                                weekday === null ? day.date : t(weekdayKey(weekday))
                                            }
                                        />
                                    </Inline>

                                    <Stack space="xs">
                                        {day.lines.map((line) => (
                                            <Text
                                                key={line.key}
                                                testID={`partner-schedule-day-${day.date}-${line.key}`}
                                            >
                                                {t('business:schedule.line', {
                                                    name: line.item.name,
                                                    count: line.quantity,
                                                })}
                                            </Text>
                                        ))}
                                    </Stack>
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
            </QueryStates>

            <Inline space="sm" wrap>
                <Button
                    testID="partner-schedule-back"
                    variant="quiet"
                    label={t('business:schedule.back')}
                    onPress={() => {
                        router.push('/partner' as never);
                    }}
                />
            </Inline>
        </Stack>
    );
}
