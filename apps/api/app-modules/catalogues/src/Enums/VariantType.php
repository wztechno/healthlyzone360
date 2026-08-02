<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * Which kind of child a variant is: a pack of a product, or one configuration
 * of a subscription plan.
 *
 * The two share a table because they are the same shape from pricing's point
 * of view — a named child a price list quotes an amount against (appendix D,
 * "ONE pricing path"). The difference lives in which extension table carries
 * the detail: `catalogue_item_pack_variants` for a pack, and the plan-variant
 * profile K1.6 introduces for a configuration.
 */
enum VariantType: string
{
    case Pack = 'pack';
    case PlanConfiguration = 'plan_configuration';
}
