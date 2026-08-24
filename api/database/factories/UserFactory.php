<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'telegram_id' => fake()->unique()->numberBetween(100000000, 999999999),
            'username' => fake()->userName(),
            'first_name' => fake()->firstName(),
            'coins' => 0,
            'level' => 0,
        ];
    }
}
