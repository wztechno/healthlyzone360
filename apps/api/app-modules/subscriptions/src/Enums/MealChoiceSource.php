<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Enums;

/**
 * Who chose the meal on a Free Selection day.
 *
 * The approved semantics (§7) ship Free Selection as *choose-ahead-of-cutoff
 * with kitchen-default fallback*, which is three different provenances for what
 * looks like one row, and a customer complaining about what arrived is owed the
 * difference between them:
 *
 *  * `customer` — they picked it, before the cut-off.
 *  * `kitchen_default` — they did not pick, and the kitchen's default for the
 *    plan filled the slot.
 *  * `substituted` — something they or the kitchen chose was not available or
 *    not safe, and generation replaced it under the §6 rules.
 *
 * Collapsing these into a single "chosen" would make the substitution audit
 * unreadable, which is the one audit an allergy complaint needs most.
 */
enum MealChoiceSource: string
{
    case Customer = 'customer';
    case KitchenDefault = 'kitchen_default';
    case Substituted = 'substituted';
}
