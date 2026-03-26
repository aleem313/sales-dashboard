-- Add password_hash column to agents table for credential-based login
ALTER TABLE agents ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Set agent emails and password hashes (PBKDF2-SHA256, 100k iterations)
UPDATE agents SET email = 'mubashir.ahmed@ikonicsolution.com', password_hash = '4ab1e9f80b51337a6b62aeef9f411374:b7ac01c9f6f51d88bc849f69171b2724e7e815bab32bb136e087a09db768a1723823d2c90891c0b24fd47426a0da7c912dabc6537cabbf29b2704add32737dc5' WHERE LOWER(name) = LOWER('Mubashir');
UPDATE agents SET email = 'shayanjaved@ikonicsolution.com', password_hash = 'ab010a8b39a052c7fe67a6e075f14629:7fb6ff5842c32e785f3aa6037374b48f341e2d5ba7904b74d4ced733cc60cf9ffe5646851d75442caffe2bd632739e069395c759b25ba0a37a4be50a93c74108' WHERE LOWER(name) = LOWER('Shayan');
UPDATE agents SET email = 'muqadass@ikonicsolution.com', password_hash = 'faca8fe3e956d792807ce28d0d147fef:a2d766eb9105822f2baedf9bceffdf16f6e2ed09b61a4f2a6f773a5cfe8499ca3a2f85faf3ae0ea82bb23704a1a1fd2ebdaeca2fec5646e89ebe5ba9f12ec7a6' WHERE LOWER(name) = LOWER('Muqadass');
UPDATE agents SET email = 'abubakarali@ikonicsolution.com', password_hash = '1657f4cb50df3d3e233fa2b8f6f7f9b2:e6bd33a20ca854826a64a8d3d596ebb15d336bd3d75ecb0b952da15e2168ab363a984a92ac187c01969b4df07aeeef4908d4a92fc8cde84ede3d50e05cd7ad7b' WHERE LOWER(name) = LOWER('Abu Bakher');
