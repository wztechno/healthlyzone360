import {
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    EmptyState,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { GroceryListItem, PantryItem } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroceryListQuery, usePantryQuery } from '../../../data/planner-hooks.ts';
import { PrototypeButton } from '../../../prototype/index.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { addDays, dateInstant, groupByAisle, isPlannerDate, mondayOf } from '../format.ts';

/**
 * `/customer/grocery/{monday}` — the week's shopping list.
 *
 * ## What is on it, and what is deliberately not
 *
 * The list is derived from the week's **home-prepared** entries only. A kitchen meal arrives cooked,
 * so it buys nothing; a leftover is a portion of an earlier entry's yield, so it buys nothing either
 * — shopping for it twice is precisely the defect the leftover flag exists to prevent, and the
 * screen states it rather than leaving the reader to notice an absence.
 *
 * ## Nothing is removed because it was "kept"
 *
 * Doc 10, PRS-04 records the reference product's documented side effect: locking a meal removes its
 * ingredients from the grocery list, and the vendor's own advice is to unlock everything before
 * shopping. Doc 17, PLN-03 rejects that outright — a list excludes only what has been *consumed*,
 * never what has merely been kept — and `buildGroceryList` in the fixture store honours it: it reads
 * `kind` and `isLeftover`, and never reads `locked`.
 *
 * ## The check-off state is local, and says so
 *
 * There is no contract operation for ticking an item off. `FoodRepository` publishes
 * `getGroceryList` and `getPantry` and nothing that writes to either. So the ticks live in this
 * component's state, they are lost on reload, and the screen says as much rather than implying a
 * list that syncs. A `PATCH /api/v1/grocery-lists/{week}/items/{item}` is the missing operation and
 * it is recorded in the wave report.
 */
export interface GroceryListScreenProps {
    readonly week: string | undefined;
}

/** A stable empty list, so the aisle grouping is not recomputed on every render before data. */
const NO_ITEMS: readonly GroceryListItem[] = [];

export function GroceryListScreen({ week }: GroceryListScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();

    const weekStart = isPlannerDate(week) ? mondayOf(week) : null;

    const grocery = useGroceryListQuery(weekStart);
    const pantry = usePantryQuery();

    // Local only. See the module note: no contract operation records a ticked item.
    const [ticked, setTicked] = useState<readonly string[]>([]);
    const [haveAlready, setHaveAlready] = useState<readonly string[]>([]);

    const items = grocery.data?.items ?? NO_ITEMS;
    const groups = useMemo(
        () => groupByAisle(items, t('planner:grocery.unsortedAisle')),
        [items, t],
    );

    if (weekStart === null) {
        return (
            <Stack space="lg" testID="grocery-screen">
                <EmptyState
                    testID="grocery-not-found"
                    title={t('planner:grocery.notFoundTitle')}
                    body={t('planner:grocery.notFoundBody')}
                    actions={
                        <Button
                            testID="grocery-not-found-planner"
                            label={t('planner:grocery.backToPlanner')}
                            onPress={() => {
                                router.replace('/customer/planner' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    const outstanding = items.filter(
        (item) => !item.inPantry && !haveAlready.includes(String(item.ingredientId)),
    );

    return (
        <Stack space="lg" testID="grocery-screen">
            <Stack space="xs">
                <Heading level={1} testID="grocery-title">
                    {t('planner:grocery.title')}
                </Heading>
                <Text testID="grocery-range" tone="secondary">
                    {t('planner:grocery.range', {
                        from: formatter.formatDate(dateInstant(weekStart), {
                            day: 'numeric',
                            month: 'long',
                        }),
                        to: formatter.formatDate(dateInstant(addDays(weekStart, 6)), {
                            day: 'numeric',
                            month: 'long',
                        }),
                    })}
                </Text>
            </Stack>

            <Inline space="sm" wrap>
                <Button
                    testID="grocery-back-to-week"
                    variant="secondary"
                    size="sm"
                    label={t('planner:grocery.backToWeek')}
                    onPress={() => {
                        router.push(`/customer/planner/week/${weekStart}` as never);
                    }}
                />
                <PrototypeButton
                    label={t('planner:grocery.print')}
                    contract="GET /api/v1/grocery-lists/{week}/export"
                    size="sm"
                />
            </Inline>

            <Callout
                testID="grocery-derivation"
                role="note"
                tone="info"
                icon="info"
                title={t('planner:grocery.derivationTitle')}
                body={t('planner:grocery.derivationBody')}
            />

            <QueryStates
                query={grocery}
                isEmpty={items.length === 0}
                emptyTitle={t('planner:grocery.emptyTitle')}
                emptyBody={t('planner:grocery.emptyBody')}
                emptyActions={
                    <Button
                        testID="grocery-empty-week"
                        variant="secondary"
                        label={t('planner:grocery.backToWeek')}
                        onPress={() => {
                            router.push(`/customer/planner/week/${weekStart}` as never);
                        }}
                    />
                }
                skeletonCount={3}
                testID="grocery"
            >
                <Stack space="lg">
                    <Card testID="grocery-total" padding="md" tone="sunken">
                        <Stack space="xs">
                            <Text variant="label">{t('planner:grocery.totalTitle')}</Text>
                            <Text testID="grocery-total-value" variant="bodyStrong">
                                {grocery.data?.estimatedTotal == null
                                    ? t('planner:cost.unknown')
                                    : formatMoney(formatter, grocery.data.estimatedTotal)}
                            </Text>
                            <Text testID="grocery-outstanding" variant="caption" tone="secondary">
                                {t('planner:grocery.outstanding', {
                                    items: outstanding.length,
                                    total: items.length,
                                })}
                            </Text>
                            <Text testID="grocery-local-note" variant="caption" tone="secondary">
                                {t('planner:grocery.localNote')}
                            </Text>
                        </Stack>
                    </Card>

                    {groups.map((group) => (
                        <Stack
                            key={group.aisle}
                            space="sm"
                            testID={`grocery-aisle-${group.aisle.replace(/\s+/gu, '-').toLowerCase()}`}
                        >
                            <Heading level={2}>{group.aisle}</Heading>
                            {group.items.map((item) => {
                                const id = String(item.ingredientId);
                                const covered = item.inPantry || haveAlready.includes(id);
                                return (
                                    <Card
                                        key={id}
                                        testID={`grocery-item-${id}`}
                                        padding="sm"
                                        tone="raised"
                                    >
                                        <Stack space="xs">
                                            <Checkbox
                                                testID={`grocery-item-${id}-tick`}
                                                label={item.name}
                                                description={t('planner:grocery.quantity', {
                                                    quantity: formatter.formatNumber(item.quantity),
                                                    unit: item.unit,
                                                })}
                                                checked={ticked.includes(id)}
                                                onChange={(next) => {
                                                    setTicked((current) =>
                                                        next
                                                            ? [...current, id]
                                                            : current.filter((key) => key !== id),
                                                    );
                                                }}
                                            />
                                            <Inline space="xs" wrap>
                                                {item.estimatedCost === null ? null : (
                                                    <Text variant="caption" tone="secondary">
                                                        {formatMoney(formatter, item.estimatedCost)}
                                                    </Text>
                                                )}
                                                {covered ? (
                                                    <Badge
                                                        testID={`grocery-item-${id}-in-pantry`}
                                                        tone="success"
                                                        icon="check"
                                                        label={t('planner:grocery.inPantry')}
                                                    />
                                                ) : null}
                                                <Text variant="caption" tone="secondary">
                                                    {t('planner:grocery.neededFor', {
                                                        items: item.neededForRecipeIds.length,
                                                    })}
                                                </Text>
                                            </Inline>
                                            {item.inPantry ? null : (
                                                <Checkbox
                                                    testID={`grocery-item-${id}-have`}
                                                    label={t('planner:grocery.haveAlready')}
                                                    checked={haveAlready.includes(id)}
                                                    onChange={(next) => {
                                                        setHaveAlready((current) =>
                                                            next
                                                                ? [...current, id]
                                                                : current.filter(
                                                                      (key) => key !== id,
                                                                  ),
                                                        );
                                                    }}
                                                />
                                            )}
                                        </Stack>
                                    </Card>
                                );
                            })}
                        </Stack>
                    ))}
                </Stack>
            </QueryStates>

            <Stack space="sm" testID="grocery-pantry">
                <Heading level={2}>{t('planner:grocery.pantryTitle')}</Heading>
                <Text variant="caption" tone="secondary">
                    {t('planner:grocery.pantryBody')}
                </Text>
                <QueryStates
                    query={pantry}
                    isEmpty={(pantry.data?.items.length ?? 0) === 0}
                    emptyTitle={t('planner:grocery.pantryEmptyTitle')}
                    emptyBody={t('planner:grocery.pantryEmptyBody')}
                    skeletonCount={2}
                    testID="grocery-pantry-states"
                >
                    <Stack space="xs">
                        {(pantry.data?.items ?? []).map((item: PantryItem) => (
                            <Card
                                key={String(item.ingredientId)}
                                testID={`grocery-pantry-${String(item.ingredientId)}`}
                                padding="sm"
                                tone="raised"
                            >
                                <Stack space="none">
                                    <Text variant="bodyStrong">{item.name}</Text>
                                    <Text variant="caption" tone="secondary">
                                        {t('planner:grocery.quantity', {
                                            quantity: formatter.formatNumber(item.quantity),
                                            unit: item.unit,
                                        })}
                                    </Text>
                                    {item.bestBefore === null ? null : (
                                        <Text variant="caption" tone="secondary">
                                            {t('planner:grocery.bestBefore', {
                                                date: formatter.formatDate(
                                                    dateInstant(item.bestBefore),
                                                    { dateStyle: 'medium' },
                                                ),
                                            })}
                                        </Text>
                                    )}
                                </Stack>
                            </Card>
                        ))}
                    </Stack>
                </QueryStates>
            </Stack>
        </Stack>
    );
}
