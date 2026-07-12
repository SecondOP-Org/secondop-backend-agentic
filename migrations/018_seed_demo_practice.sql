INSERT INTO practices (name, slug)
VALUES ('SecondOp Demo Practice', 'secondop-demo')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO practice_members (practice_id, doctor_id, role)
SELECT p.id, d.id, 'attending'
FROM practices p
JOIN doctors d ON d.user_id = (SELECT id FROM users WHERE email = 'dr.smith@secondop.com' LIMIT 1)
WHERE p.slug = 'secondop-demo'
ON CONFLICT (practice_id, doctor_id) DO NOTHING;
