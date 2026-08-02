<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories;

use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<CustomerAddress>
 */
class CustomerAddressFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'customer_account_id' => CustomerAccount::factory(),
            'address_type' => CustomerAddressType::Delivery,
            'delivery_area_id' => fn (): string => $this->area(),
            'label' => 'Home',
            'line_one' => fake()->streetAddress(),
            'is_default' => false,
        ];
    }

    public function billing(): static
    {
        return $this->state(fn (): array => ['address_type' => CustomerAddressType::Billing]);
    }

    public function default(): static
    {
        return $this->state(fn (): array => ['is_default' => true]);
    }

    public function inArea(DeliveryArea $area): static
    {
        return $this->state(fn (): array => ['delivery_area_id' => $area->getKey()]);
    }

    /**
     * Any seeded area, or a synthetic one when the gazetteer has not been
     * seeded — a test asserting address behaviour should not have to load 125
     * Lebanese districts to do it.
     */
    private function area(): string
    {
        $existing = DeliveryArea::query()->value('id');

        if (is_string($existing)) {
            return $existing;
        }

        return (string) DeliveryArea::query()->create([
            'country_code' => 'LB',
            'code' => 'test-'.Str::lower(Str::random(8)),
            'name_en' => 'Test area',
            'name_ar' => 'منطقة اختبار',
            'display_order' => 0,
            'is_active' => true,
        ])->getKey();
    }
}
