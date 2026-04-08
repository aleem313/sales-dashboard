<?php

namespace App\Auth;

use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Hash;

class LegacyPasswordUserProvider extends EloquentUserProvider
{
    public function validateCredentials(Authenticatable $user, array $credentials): bool
    {
        $plain = $credentials['password'];

        // 1. Try bcrypt first (standard Laravel)
        if (Hash::check($plain, $user->getAuthPassword())) {
            return true;
        }

        // 2. Fallback: check PBKDF2 legacy hash
        $legacyHash = $user->legacy_password_hash;
        if ($legacyHash && $this->verifyPbkdf2($plain, $legacyHash)) {
            // Re-hash to bcrypt and clear legacy hash
            $user->password = Hash::make($plain);
            $user->legacy_password_hash = null;
            $user->save();

            return true;
        }

        return false;
    }

    private function verifyPbkdf2(string $password, string $storedHash): bool
    {
        $parts = explode(':', $storedHash, 2);
        if (count($parts) !== 2) {
            return false;
        }

        [$salt, $hash] = $parts;

        $derived = hash_pbkdf2('sha256', $password, hex2bin($salt), 100000, 64, true);

        return hash_equals($hash, bin2hex($derived));
    }
}
