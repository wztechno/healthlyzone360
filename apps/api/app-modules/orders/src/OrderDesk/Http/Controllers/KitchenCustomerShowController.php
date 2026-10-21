<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\OrderDesk\Presenters\KitchenCustomerPresenter;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * GET /api/v1/catalogue/customers/{account} — one customer in the kitchen's
 * book: contacts, every saved address, and for a corporate buyer the company
 * record and named contacts from its approved application.
 *
 * An account outside the browse rule is a `404`, never a `403`: a refusal that
 * confirmed the identifier exists would make this endpoint an oracle over every
 * account on the platform.
 *
 * Read-only. `isBrowsable()`, not `isInScope()` — the desk's write rule — so a
 * programme client is readable here without becoming writable at the desk.
 */
final class KitchenCustomerShowController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly KitchenCustomerPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $account): JsonResponse
    {
        $organisationId = $this->locator->sellerId();

        $customer = Str::isUuid($account)
            ? CustomerAccount::query()
                ->select('customer_accounts.*')
                ->selectRaw('(SELECT count(*) FROM orders o WHERE o.customer_account_id = customer_accounts.id AND o.organisation_id = ?) as order_count', [$organisationId])
                ->selectRaw('(SELECT max(o.placed_at) FROM orders o WHERE o.customer_account_id = customer_accounts.id AND o.organisation_id = ?) as last_ordered_at', [$organisationId])
                ->whereKey($account)
                ->first()
            : null;

        if (! $customer instanceof CustomerAccount || ! $this->directory->isBrowsable($organisationId, $customer)) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That customer account could not be read.');
        }

        $id = (string) $customer->getKey();

        return ApiResponse::data($this->presenter->detail(
            $customer,
            $this->directory->contactPointsFor([$customer])[$id] ?? [],
            $this->addresses($id),
            $this->company($customer),
        ));
    }

    /**
     * Every saved address, default first, with the area named in both
     * languages so the screen picks by locale.
     *
     * @return list<array<string, mixed>>
     */
    private function addresses(string $accountId): array
    {
        $rows = DB::table('customer_addresses as a')
            ->leftJoin('delivery_areas as d', 'd.id', '=', 'a.delivery_area_id')
            ->where('a.customer_account_id', $accountId)
            ->orderByDesc('a.is_default')
            ->orderBy('a.address_type')
            ->orderBy('a.created_at')
            ->get([
                'a.id', 'a.address_type', 'a.label', 'a.line_one', 'a.line_two', 'a.building', 'a.floor',
                'a.apartment', 'a.directions', 'a.postal_code', 'a.is_default',
                'd.name_en as area_name_en', 'd.name_ar as area_name_ar',
            ]);

        $addresses = [];

        foreach ($rows as $row) {
            $addresses[] = [
                'id' => (string) $row->id,
                'address_type' => (string) $row->address_type,
                'label' => $row->label,
                'line_one' => $row->line_one,
                'line_two' => $row->line_two,
                'building' => $row->building,
                'floor' => $row->floor,
                'apartment' => $row->apartment,
                'directions' => $row->directions,
                'postal_code' => $row->postal_code,
                'is_default' => (bool) $row->is_default,
                'area_name_en' => $row->area_name_en,
                'area_name_ar' => $row->area_name_ar,
            ];
        }

        return $addresses;
    }

    /**
     * The buying organisation and, when one was provisioned from it, the
     * approved application's company record and named contacts. Purged contacts
     * (offboarding) are left out.
     *
     * @return array<string, mixed>|null
     */
    private function company(CustomerAccount $account): ?array
    {
        if ($account->organisation_id === null) {
            return null;
        }

        $name = DB::table('organisations')->where('id', $account->organisation_id)->value('name');

        $application = DB::table('b2b_applications')
            ->where('customer_account_id', $account->getKey())
            ->first([
                'id', 'legal_name', 'legal_name_ar', 'trading_name', 'business_type',
                'commercial_registration_number', 'tax_registration_number',
                'signatory_name', 'signatory_title', 'signatory_email', 'signatory_phone',
            ]);

        $contacts = [];

        if ($application !== null) {
            $rows = DB::table('b2b_application_contacts')
                ->where('b2b_application_id', $application->id)
                ->whereNull('purged_at')
                ->orderBy('role')
                ->get(['role', 'name', 'title', 'email', 'phone']);

            foreach ($rows as $row) {
                $contacts[] = [
                    'role' => (string) $row->role,
                    'name' => (string) $row->name,
                    'title' => $row->title,
                    'email' => $row->email,
                    'phone' => $row->phone,
                ];
            }
        }

        return [
            'organisation_name' => $name === null ? null : (string) $name,
            'legal_name' => $application?->legal_name,
            'legal_name_ar' => $application?->legal_name_ar,
            'trading_name' => $application?->trading_name,
            'business_type' => $application?->business_type,
            'commercial_registration_number' => $application?->commercial_registration_number,
            'tax_registration_number' => $application?->tax_registration_number,
            'signatory_name' => $application?->signatory_name,
            'signatory_title' => $application?->signatory_title,
            'signatory_email' => $application?->signatory_email,
            'signatory_phone' => $application?->signatory_phone,
            'contacts' => $contacts,
        ];
    }
}
