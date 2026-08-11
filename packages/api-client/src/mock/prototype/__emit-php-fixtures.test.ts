import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DURATION_DISCOUNT_PERCENT, PROTOTYPE_PLANS } from './fixtures/plans.ts';
import { PROTOTYPE_DELIVERY_ZONES, PROTOTYPE_KITCHENS } from './fixtures/kitchens.ts';
import { PROTOTYPE_MEALS } from './fixtures/meals.ts';

/**
 * One-shot emitter: projects the prototype kitchen and plan fixtures into the Laravel seeder
 * fixture format (`apps/api/database/seeders/fixtures/*.php`, base64-wrapped JSON), and adds
 * `kitchen_slug` to the already-ported meals fixture.
 *
 * This is the mechanical port the meals fixture's own docblock describes, run for the two
 * remaining entity families before the mock world is deleted. It is guarded behind
 * `EMIT_PHP_FIXTURES=1` so a normal test run never rewrites files under `apps/api`; the whole
 * file is deleted together with `src/mock/`.
 *
 *     EMIT_PHP_FIXTURES=1 pnpm --filter @healthy360/api-client exec vitest run src/mock/prototype/__emit-php-fixtures.test.ts
 */

const FIXTURES_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../..',
    'apps/api/database/seeders/fixtures',
);

/** The mock zone table's row keys, in `ZONE_ROWS` declaration order (the rows are not exported). */
const ZONE_KEYS = [
    'downtown',
    'marina',
    'jumeirah',
    'business_bay',
    'al_barsha',
    'deira',
    'industrial',
    'northern',
] as const;

/** Mock sales-channel switches that map onto an API `sales_channels.channel_kind`. */
const CHANNEL_KIND_FOR_SWITCH: Readonly<Record<string, { code: string; kind: string }>> = {
    b2c: { code: 'web-shop', kind: 'b2c_web' },
    marketplace: { code: 'marketplace', kind: 'marketplace' },
    b2b: { code: 'wholesale', kind: 'b2b' },
    pos: { code: 'counter', kind: 'pos' },
    corporate: { code: 'corporate', kind: 'corporate' },
    // `subscription`, `delivery` and `pickup` are fulfilment concepts, not sales channels —
    // the API models them elsewhere (plans, zones, branch operating) and they are dropped here.
};

const DURATION_ROWS = [
    { code: 'days-7', days: 7, mockDuration: '1w' },
    { code: 'days-14', days: 14, mockDuration: '2w' },
    { code: 'days-28', days: 28, mockDuration: '4w' },
    { code: 'days-84', days: 84, mockDuration: '12w' },
] as const;

function phpFixtureFile(
    fixtureName: string,
    docblockLines: readonly string[],
    rows: unknown,
): string {
    const json = JSON.stringify(rows);
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    const docblock = docblockLines.map((line) => (line === '' ? ' *' : ` * ${line}`)).join('\n');
    return [
        '<?php',
        '',
        'declare(strict_types=1);',
        '',
        '/**',
        docblock,
        ' *',
        ' * @return list<array<string, mixed>>',
        ' */',
        '$decoded = base64_decode(',
        `    '${encoded}',`,
        '    true,',
        ');',
        '',
        'if ($decoded === false) {',
        `    throw new RuntimeException('The ${fixtureName} fixture is not valid base64.');`,
        '}',
        '',
        'return json_decode($decoded, true, 512, JSON_THROW_ON_ERROR);',
        '',
    ].join('\n');
}

describe.runIf(process.env['EMIT_PHP_FIXTURES'] === '1')('php fixture emission', () => {
    const zoneCodeById = new Map(
        PROTOTYPE_DELIVERY_ZONES.map((zone, index) => [zone.id, ZONE_KEYS[index] ?? zone.name]),
    );
    const kitchenSlugById = new Map(
        PROTOTYPE_KITCHENS.map((kitchen) => [kitchen.id, kitchen.slug]),
    );

    it('emits prototype_marketplace_kitchens.php for the five non-Verdant kitchens', () => {
        const ported = PROTOTYPE_KITCHENS.filter((kitchen) => kitchen.slug !== 'verdant-kitchen');
        expect(ported.map((kitchen) => kitchen.slug).sort()).toEqual([
            'northwind-provisions',
            'olive-terrace-counter',
            'riverstone-meal-works',
            'saffron-and-sea',
            'the-daily-pot',
        ]);

        const rows = ported.map((kitchen) => {
            const zones = new Map<
                string,
                {
                    code: string;
                    name: string;
                    area_name: string;
                    fee_minor: number | null;
                    minimum_minor: number | null;
                    estimated_minutes: number | null;
                }
            >();
            for (const branch of kitchen.branches) {
                for (const zone of branch.deliveryZones) {
                    const code = zoneCodeById.get(zone.id) ?? zone.name;
                    zones.set(code, {
                        code,
                        name: zone.name,
                        area_name: zone.area,
                        fee_minor: zone.deliveryFee?.amount ?? null,
                        minimum_minor: zone.minimumOrder?.amount ?? null,
                        estimated_minutes: zone.estimatedMinutes,
                    });
                }
            }

            return {
                slug: kitchen.slug,
                name: kitchen.name,
                country_code: 'AE',
                currency_code: 'USD',
                channels: Object.entries(kitchen.channels)
                    .filter(([, enabled]) => enabled)
                    .map(([channelSwitch]) => CHANNEL_KIND_FOR_SWITCH[channelSwitch])
                    .filter(
                        (channel): channel is { code: string; kind: string } =>
                            channel !== undefined,
                    ),
                branches: kitchen.branches.map((branch) => {
                    const openDay = branch.openingHours.find((day) => day.opensAt !== null);
                    return {
                        name: branch.name,
                        city: branch.area,
                        timezone: branch.timeZone,
                        opens_at: openDay?.opensAt ?? '08:00',
                        closes_at: openDay?.closesAt ?? '22:00',
                        order_cut_off_at: openDay?.orderCutOffAt ?? '18:00',
                        closed_weekdays: branch.openingHours
                            .filter((day) => day.opensAt === null)
                            .map((day) => day.weekday),
                        zone_codes: branch.deliveryZones.map(
                            (zone) => zoneCodeById.get(zone.id) ?? zone.name,
                        ),
                    };
                }),
                zones: [...zones.values()],
                delivery_windows: kitchen.deliveryWindows.map((window, index) => ({
                    code: window.code,
                    name: window.label,
                    starts_at: window.startsAt,
                    ends_at: window.endsAt,
                    weekdays: window.weekdays,
                    display_order: index + 1,
                })),
            };
        });

        writeFileSync(
            join(FIXTURES_DIR, 'prototype_marketplace_kitchens.php'),
            phpFixtureFile(
                'prototype_marketplace_kitchens',
                [
                    'The five preview marketplace kitchens, mechanically ported from',
                    'packages/api-client/src/mock/prototype/fixtures/kitchens.ts.',
                    '',
                    "Verdant Kitchen is excluded: it is DemoTenantSeeder's organisation and its",
                    'branch set is pinned by tests. Slugs are the image contract — each must match',
                    'a bundled photo in apps/universal/assets/images/kitchens/. Money amounts are',
                    'USD minor units per D-030.',
                ],
                rows,
            ),
        );
    });

    it('emits prototype_marketplace_plans.php for the eight plans', () => {
        expect(PROTOTYPE_PLANS).toHaveLength(8);

        const rows = PROTOTYPE_PLANS.map((plan) => ({
            slug: plan.slug,
            kitchen_slug: kitchenSlugById.get(plan.kitchenId),
            name: plan.name,
            summary: plan.summary,
            description: plan.description,
            diets: plan.dietClassifications,
            variants: plan.variants.map((variant) => ({
                name: variant.name,
                energy_min: variant.energyRange.min,
                energy_max: variant.energyRange.max,
                meals_per_day: variant.mealsPerDay,
                snacks_per_day: variant.snacksPerDay,
                price_per_week_minor: variant.pricePerWeek.amount,
            })),
            durations: DURATION_ROWS.map(({ code, days, mockDuration }) => ({
                code,
                days,
                discount_percent: DURATION_DISCOUNT_PERCENT[mockDuration].toFixed(2),
            })),
        }));

        for (const row of rows) {
            expect(row.kitchen_slug).toBeDefined();
        }

        writeFileSync(
            join(FIXTURES_DIR, 'prototype_marketplace_plans.php'),
            phpFixtureFile(
                'prototype_marketplace_plans',
                [
                    'The eight preview subscription plans, mechanically ported from',
                    'packages/api-client/src/mock/prototype/fixtures/plans.ts.',
                    '',
                    'Slugs are the image contract — each must match a bundled photo in',
                    'apps/universal/assets/images/plans/. Prices are USD minor units per week',
                    '(D-030); duration discounts are whole percents off the weekly price.',
                ],
                rows,
            ),
        );
    });

    it('adds kitchen_slug to prototype_marketplace_meals.php', () => {
        const mealsPath = join(FIXTURES_DIR, 'prototype_marketplace_meals.php');
        const source = readFileSync(mealsPath, 'utf8');
        const encoded = /base64_decode\(\s*'([A-Za-z0-9+/=]+)'/.exec(source)?.[1];
        expect(encoded, 'base64 payload in prototype_marketplace_meals.php').toBeDefined();

        const decoded = JSON.parse(Buffer.from(encoded ?? '', 'base64').toString('utf8')) as {
            slug: string;
            [key: string]: unknown;
        }[];
        expect(decoded).toHaveLength(37);

        const kitchenSlugByMealSlug = new Map(
            PROTOTYPE_MEALS.map((meal) => [meal.slug, kitchenSlugById.get(meal.kitchenId)]),
        );

        const rows = decoded.map(({ slug, kitchen_slug: _dropped, ...rest }) => {
            const kitchenSlug = kitchenSlugByMealSlug.get(slug);
            expect(kitchenSlug, `owning kitchen for meal ${slug}`).toBeDefined();
            return { slug, kitchen_slug: kitchenSlug, ...rest };
        });

        writeFileSync(
            mealsPath,
            phpFixtureFile(
                'prototype_marketplace_meals',
                [
                    'The 37 remaining customer-preview meals, mechanically ported from',
                    'packages/api-client/src/mock/prototype/fixtures/meals.ts.',
                    '',
                    'Each row names its owning kitchen (`kitchen_slug`) so the preview seeders',
                    "can place it; the demo's three original API meals stay in DemoTenantSeeder.",
                    'Together these records make the 40-meal customer catalogue. Facts remain',
                    'clearly marked as synthetic preview data until a kitchen-provided source',
                    'replaces them.',
                ],
                rows,
            ),
        );
    });
});
