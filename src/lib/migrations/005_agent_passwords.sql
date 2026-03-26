-- Add password_hash column to agents table for credential-based login
ALTER TABLE agents ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Set agent emails and password hashes
UPDATE agents SET email = 'mubashir.ahmed@ikonicsolution.com', password_hash = '5fc425b675bbaafbf6e282d3cb4e2ce0:ccf89c54c884ff9bb9d53f221a1f518806f2447de169def63976e5c34134c4879bbe6e91fe3080d98bc5facf29dd4269bbdbb48d5882305a5bd83481199d5edb' WHERE LOWER(name) = LOWER('Mubashir');
UPDATE agents SET email = 'shayanjaved@ikonicsolution.com', password_hash = '7fee033b66f5613589ad552e35582fe2:184d5950359e4036bc989c601a27aa8a0b2d54da68d7719a1c983545949590399d8be196f9ef78585280ea57cd5c4c6428a8a8b5d6d368ae82dfda80f7e76915' WHERE LOWER(name) = LOWER('Shayan');
UPDATE agents SET email = 'muqadass@ikonicsolution.com', password_hash = '70893eae7a426d7a5fa7d6caab5607ec:f6156e303bc80a8e67efda6840d3917575f0b2ce86f4dff6c61ec1bff14ba5ab28d745a6b5cda7e7bf826e05d91c9f41b60b667caf3a006c6ec5f3d80e2a4c25' WHERE LOWER(name) = LOWER('Muqadass');
UPDATE agents SET email = 'abubakarali@ikonicsolution.com', password_hash = '2eb2a59b0311bbc5c214757eb0231186:28bc67ae28ba412d7cae33e2531a1bba8508836b2310c1b100996ca5c8708722232c3299749c6515a3f29cfdc27f8267c347188f8b08ba8e555c3293036c5a80' WHERE LOWER(name) = LOWER('Abu Bakher');
