<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/platform/b2b/seller-price-lists — the negotiated lists a
 * reviewer can put behind an agreement, across every kitchen.
 *
 * Requires `b2b_application.decide_platform`, the authority that writes the
 * terms. Read across tenancy on purpose: the reviewer belongs to the platform
 * operator, and the lists belong to the kitchens that sell.
 *
 * Archived lists are left out. Each row says which application's live
 * agreement already holds it, so the picker can show it as taken rather than
 * let the reviewer find out on save.
 */
final class PlatformSellerPriceListIndexController
{
    public function __invoke(Request $request): JsonResponse
    {
        $query = PriceList::withoutTenancy()
            ->where('customer_scope', CustomerScope::Agreement->value)
            ->where('status', '!=', PriceListStatus::Archived->value)
            ->orderBy('organisation_id')
            ->orderBy('name_en');

        $term = $request->query('query');

        if (is_string($term) && trim($term) !== '') {
            $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';
            $query->where(fn (Builder $scoped) => $scoped->whereRaw('lower(name_en) like ?', [$needle])->orWhereRaw('lower(code) like ?', [$needle]));
        }

        // ponytail: one unpaged read; page it when kitchens hold hundreds of negotiated lists.
        $lists = $query->limit(200)->get();

        $kitchens = Organisation::query()
            ->whereIn('id', $lists->pluck('organisation_id')->unique()->all())
            ->pluck('name', 'id');

        $holders = B2bAgreement::query()
            ->whereIn('price_list_id', $lists->modelKeys())
            ->where('status', '!=', AgreementStatus::Terminated->value)
            ->pluck('b2b_application_id', 'price_list_id');

        return ApiResponse::data($lists->map(static fn (PriceList $list): array => [
            'id' => (string) $list->getKey(),
            'organisation_id' => $list->organisation_id,
            'organisation_name' => (string) ($kitchens[$list->organisation_id] ?? ''),
            'code' => $list->code,
            'name_en' => $list->name_en,
            'name_ar' => $list->name_ar,
            'currency_code' => $list->currency_code,
            'status' => $list->status->value,
            'bound_to_application_id' => $holders[(string) $list->getKey()] ?? null,
        ])->values()->all());
    }
}
