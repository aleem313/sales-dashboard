<?php

namespace App\Http\Requests;

use App\Http\Requests\ApiFormRequest;

class CreateAgentRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:users,email'],
        ];
    }
}
