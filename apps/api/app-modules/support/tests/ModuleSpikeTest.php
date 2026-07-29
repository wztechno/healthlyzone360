<?php

declare(strict_types=1);

it('discovers the support module route', function () {
    $this->getJson('/support/ping')
        ->assertOk()
        ->assertJson(['data' => ['pong' => true]]);
});
