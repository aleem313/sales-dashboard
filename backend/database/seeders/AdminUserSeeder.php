<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $credentials = env('ADMIN_CREDENTIALS', '');

        if (empty($credentials)) {
            $this->command->warn('ADMIN_CREDENTIALS not set. Creating default admin.');
            $credentials = 'admin@risinglions.com:password';
        }

        $parts = explode(':', $credentials, 2);
        $email = $parts[0];
        $password = $parts[1] ?? 'password';

        User::updateOrCreate(
            ['email' => $email],
            [
                'name' => 'Admin',
                'password' => Hash::make($password),
                'role' => 'admin',
                'active' => true,
            ]
        );

        $this->command->info("Admin user seeded: {$email}");
    }
}
