-- Fix profile-to-agent assignments to match n8n flow
-- n8n source of truth (from "Process Job" node PROFILES map):
--   Sana   → Mubashir
--   Laiba  → Muqadass
--   Khansa → Shayan
--   Saim   → Shayan
--   Shayan → Abu Bakher
--   Craig  → Mubashir

-- Fix Craig: should be assigned to Mubashir (not Abu Bakher)
UPDATE profiles
SET agent_id = (SELECT id FROM agents WHERE LOWER(name) = LOWER('Mubashir') LIMIT 1)
WHERE LOWER(profile_name) = LOWER('Craig');
