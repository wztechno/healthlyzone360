<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\Pricing\Contracts\BuyerAgreementLookup as BuyerAgreementLookupContract;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Models\PriceList;

/**
 * Resolves a corporate buyer's negotiated tariff against a seller kitchen.
 */
final readonly class BuyerAgreementLookup implements BuyerAgreementLookupContract
{
    public function activeAgreementFor(
        string $buyerOrganisationId,
        string $sellerOrganisationId,
        CarbonImmutable $on,
    ): ?array {
        $agreements = B2bAgreement::query()
            ->where('organisation_id', $buyerOrganisationId)
            ->where('status', AgreementStatus::Active->value)
            ->whereNotNull('price_list_id')
            ->orderByDesc('version')
            ->get();

        foreach ($agreements as $agreement) {
            if (! $this->inEffectOn($agreement, $on)) {
                continue;
            }

            $priceList = PriceList::withoutTenancy()
                ->whereKey($agreement->price_list_id)
                ->where('organisation_id', $sellerOrganisationId)
                ->where('customer_scope', CustomerScope::Agreement->value)
                ->first();

            if (! $priceList instanceof PriceList) {
                continue;
            }

            return [
                'agreement_id' => (string) $agreement->getKey(),
                'price_list_id' => (string) $priceList->getKey(),
                'minimum_order_minor' => $agreement->minimum_order_minor,
                'credit_limit_minor' => $agreement->credit_limit_minor,
                'currency_code' => $agreement->currency_code,
            ];
        }

        return null;
    }

    private function inEffectOn(B2bAgreement $agreement, CarbonImmutable $on): bool
    {
        if ($agreement->starts_on !== null && $on->lessThan($agreement->starts_on)) {
            return false;
        }

        if ($agreement->ends_on !== null && $on->greaterThan($agreement->ends_on)) {
            return false;
        }

        return true;
    }
}
