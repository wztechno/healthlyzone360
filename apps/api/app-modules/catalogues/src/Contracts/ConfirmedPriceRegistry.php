<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Contracts;

/**
 * Which of a catalogue item's variants somebody has actually put a number
 * against.
 *
 * **A port, for the same reason `IngredientUsageRegistry` is one.** The
 * dependency edge runs Pricing → Catalogues (module registry), so the catalogue
 * cannot ask the pricing module directly and the registry graph is
 * architecture-tested acyclic. So the catalogue declares the question and
 * pricing answers it. `NullConfirmedPriceRegistry` is the answer when nothing
 * prices anything, which is also what keeps the catalogue coherent on its own.
 *
 * The question is deliberately narrow: not "what does this cost" — that is
 * `PriceResolver`, which needs a channel, a quantity and a date — but "has a
 * human committed to a number for this variant at all". The publish gate is the
 * only caller, and it must not be able to learn an amount: the whole K1.5
 * permission split exists to keep prices behind `price_list.view_organisation`,
 * and a gate that returned figures would hand them to anybody who can attempt a
 * publication.
 *
 * **What counts** is stated once, here, and implemented once, in pricing: a
 * `confirmed` row that is still standing (`effective_to IS NULL`) on an
 * **active** price list belonging to the same organisation. A placeholder does
 * not count and neither does a market-priced row — that is the entire point of
 * the honest badge (decision OD-2, risk R9) — and neither does a confirmed row
 * on a draft tariff, because a draft tariff prices nothing.
 */
interface ConfirmedPriceRegistry
{
    /**
     * The subset of the given variants that carry at least one confirmed,
     * standing price row on an active list of the organisation.
     *
     * Returns identifiers rather than a boolean per variant so the publish gate
     * can name the gaps in one pass — a kitchen fixes every unpriced
     * configuration at once rather than discovering them one attempt at a time.
     *
     * @param  string  $organisationId  the owner of both the item and the tariff
     * @param  list<string>  $variantIds  the variants to ask about
     * @return list<string> those of `$variantIds` that are priced
     */
    public function pricedVariantIds(string $organisationId, array $variantIds): array;
}
