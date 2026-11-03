<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\QualityControl\Models\CookingTemperature;
use Healthy360\QualityControl\Models\TemperatureReading;
use Healthy360\QualityControl\Models\TemperatureUnit;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The temperature log: one read of a month, and the writes that fill it.
 *
 * The branch's day and the person are the server's to say, so a reading cannot be
 * backdated and a log cannot be filled in on the morning of an inspection.
 * `recorded_by` and the timestamp are stamped here, never taken from the body.
 *
 * Batches are read from the tables, as {@see QualityCheckIndexController} reads
 * them: production is not this module's to import.
 */
final class TemperatureLogController
{
    public function __construct(private readonly TenantContext $context) {}

    public function log(Request $request): JsonResponse
    {
        /** @var array{month?: string|null} $validated */
        $validated = $request->validate(['month' => ['nullable', 'date_format:Y-m']]);

        $first = CarbonImmutable::parse(($validated['month'] ?? CarbonImmutable::now()->format('Y-m')).'-01');
        $last = $first->endOfMonth();
        $branchId = $this->context->branchId();

        $units = TemperatureUnit::query()->where('branch_id', $branchId)->orderBy('name')->get();
        $unitIds = $units->pluck('id')->all();

        $readings = TemperatureReading::query()
            ->whereIn('temperature_unit_id', $unitIds)
            ->whereBetween('reading_date', [$first->toDateString(), $last->toDateString()])
            ->orderByDesc('reading_date')
            ->orderByDesc('slot')
            ->get();

        $cooking = DB::table('cooking_temperatures as c')
            ->join('production_orders as o', 'o.id', '=', 'c.production_order_id')
            ->leftJoin('recipe_versions as v', 'v.id', '=', 'o.recipe_version_id')
            ->leftJoin('recipes as r', 'r.id', '=', 'v.recipe_id')
            ->where('o.branch_id', $branchId)
            ->whereBetween('c.created_at', [$first, $last])
            ->orderByDesc('c.created_at')
            ->get(['c.id', 'c.production_order_id', 'c.celsius', 'c.note', 'c.recorded_by', 'c.created_at', 'o.reference', 'o.lot_number', 'r.name_en as recipe']);

        $names = $this->names($readings->pluck('recorded_by')->merge($cooking->pluck('recorded_by')));
        $unitNames = $units->pluck('name', 'id');

        return ApiResponse::data([
            'units' => $units->map($this->unit(...))->values(),
            'readings' => $readings->map(fn (TemperatureReading $row): array => [
                'id' => (string) $row->getKey(),
                'temperature_unit_id' => $row->temperature_unit_id,
                'unit_name' => $unitNames[$row->temperature_unit_id] ?? '',
                'reading_date' => $row->reading_date->toDateString(),
                'slot' => $row->slot,
                'celsius' => (string) $row->celsius,
                'out_of_range' => $row->out_of_range,
                'note' => $row->note,
                'recorded_by_name' => $names[$row->recorded_by] ?? null,
                'recorded_at' => $row->created_at?->toIso8601String(),
            ])->values(),
            'cooking' => $cooking->map(static fn (object $row): array => [
                'id' => (string) $row->id,
                'production_order_id' => (string) $row->production_order_id,
                'batch_label' => $row->lot_number ?? $row->reference,
                'recipe' => $row->recipe,
                'celsius' => (string) $row->celsius,
                'note' => $row->note,
                'recorded_by_name' => $names[$row->recorded_by] ?? null,
                'recorded_at' => CarbonImmutable::parse($row->created_at)->toIso8601String(),
            ])->values(),
        ]);
    }

    public function storeUnit(Request $request): JsonResponse
    {
        $unit = new TemperatureUnit;
        $unit->organisation_id = (string) $this->context->organisationId();
        $unit->branch_id = (string) $this->context->branchId();
        $this->fillUnit($unit, $request);

        return ApiResponse::data(['unit' => $this->unit($unit)], status: 201);
    }

    /**
     * @throws ApiException
     */
    public function updateUnit(Request $request, string $unit): JsonResponse
    {
        $record = TemperatureUnit::query()->whereKey($unit)->first();

        if (! $record instanceof TemperatureUnit) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $this->fillUnit($record, $request);

        return ApiResponse::data(['unit' => $this->unit($record)]);
    }

    /**
     * @throws ApiException when this unit already has this slot's reading
     */
    public function storeReading(Request $request, StaffAlerts $alerts, AuditRecorder $audit): JsonResponse
    {
        /** @var array{temperature_unit_id: string, slot: string, celsius: int|float|string, note?: string|null} $validated */
        $validated = $request->validate([
            'temperature_unit_id' => ['required', 'uuid'],
            'slot' => ['required', Rule::in(['am', 'pm'])],
            'celsius' => ['required', 'numeric', 'between:-60,120'],
            'note' => ['nullable', 'string', 'max:200'],
        ]);

        $unit = TemperatureUnit::query()->whereKey($validated['temperature_unit_id'])->where('active', true)->first();

        if (! $unit instanceof TemperatureUnit) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $today = $this->branchToday((string) $unit->branch_id);

        $taken = TemperatureReading::query()
            ->where('temperature_unit_id', $unit->getKey())
            ->whereDate('reading_date', $today)
            ->where('slot', $validated['slot'])
            ->exists();

        if ($taken) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This reading has already been taken. A reading is written once.');
        }

        $celsius = number_format((float) $validated['celsius'], 1, '.', '');

        $reading = new TemperatureReading;
        $reading->organisation_id = (string) $unit->organisation_id;
        $reading->temperature_unit_id = (string) $unit->getKey();
        $reading->reading_date = CarbonImmutable::parse($today);
        $reading->slot = $validated['slot'];
        $reading->celsius = $celsius;
        $reading->out_of_range = bccomp($celsius, (string) $unit->min_c, 1) < 0 || bccomp($celsius, (string) $unit->max_c, 1) > 0;
        $reading->note = $validated['note'] ?? null;
        $reading->recorded_by = (string) auth()->id();
        $reading->save();

        $audit->record('temperature.reading_recorded', (string) auth()->id(), 'temperature_reading', (string) $reading->getKey(), [
            'temperature_unit_id' => (string) $unit->getKey(),
            'out_of_range' => $reading->out_of_range,
        ]);

        if ($reading->out_of_range) {
            $alerts->send(StaffAlertType::TemperatureOutOfRange, (string) $unit->organisation_id, (string) $reading->getKey(), [
                'order_number' => $unit->name.' · '.$celsius.'°C',
                'severe' => true,
            ]);
        }

        return ApiResponse::data(['reading' => [
            'id' => (string) $reading->getKey(),
            'out_of_range' => $reading->out_of_range,
        ]], status: 201);
    }

    /**
     * @throws ApiException when the batch is not this kitchen's
     */
    public function storeCooking(Request $request, AuditRecorder $audit): JsonResponse
    {
        /** @var array{production_order_id: string, celsius: int|float|string, note?: string|null} $validated */
        $validated = $request->validate([
            'production_order_id' => ['required', 'uuid'],
            'celsius' => ['required', 'numeric', 'between:-60,250'],
            'note' => ['nullable', 'string', 'max:200'],
        ]);

        $organisationId = (string) $this->context->organisationId();

        $known = DB::table('production_orders')
            ->where('organisation_id', $organisationId)
            ->where('id', $validated['production_order_id'])
            ->exists();

        if (! $known) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $record = new CookingTemperature;
        $record->organisation_id = $organisationId;
        $record->production_order_id = $validated['production_order_id'];
        $record->celsius = number_format((float) $validated['celsius'], 1, '.', '');
        $record->note = $validated['note'] ?? null;
        $record->recorded_by = (string) auth()->id();
        $record->save();

        $audit->record('temperature.cooking_recorded', (string) auth()->id(), 'cooking_temperature', (string) $record->getKey(), [
            'production_order_id' => $record->production_order_id,
        ]);

        return ApiResponse::data(['cooking' => ['id' => (string) $record->getKey()]], status: 201);
    }

    private function fillUnit(TemperatureUnit $unit, Request $request): void
    {
        /** @var array{name: string, kind: string, min_c: int|float|string, max_c: int|float|string, active?: bool} $validated */
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'kind' => ['required', Rule::in(['fridge', 'freezer'])],
            'min_c' => ['required', 'numeric', 'between:-60,60', 'lt:max_c'],
            'max_c' => ['required', 'numeric', 'between:-60,60'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $unit->name = $validated['name'];
        $unit->kind = $validated['kind'];
        $unit->min_c = (string) $validated['min_c'];
        $unit->max_c = (string) $validated['max_c'];
        $unit->active = $validated['active'] ?? true;
        $unit->save();
    }

    /**
     * @return array{id: string, name: string, kind: string, min_c: string, max_c: string, active: bool}
     */
    private function unit(TemperatureUnit $unit): array
    {
        return [
            'id' => (string) $unit->getKey(),
            'name' => $unit->name,
            'kind' => $unit->kind,
            'min_c' => (string) $unit->min_c,
            'max_c' => (string) $unit->max_c,
            'active' => $unit->active,
        ];
    }

    private function branchToday(string $branchId): string
    {
        $timezone = DB::table('organisation_branches')->where('id', $branchId)->value('timezone');

        return CarbonImmutable::now(is_string($timezone) ? $timezone : 'UTC')->toDateString();
    }

    /**
     * @param  Collection<int, mixed>  $ids
     * @return Collection<string, string|null>
     */
    private function names(Collection $ids): Collection
    {
        return DB::table('user_profiles')
            ->whereIn('user_id', $ids->filter()->unique()->values())
            ->selectRaw("user_id, nullif(trim(coalesce(given_name, '') || ' ' || coalesce(family_name, '')), '') as name")
            ->pluck('name', 'user_id');
    }
}
