-- Remove all cases for a patient by email (cascades to assignments, files, messages, analysis).
DELETE FROM cases
WHERE patient_id = (
  SELECT p.id
  FROM patients p
  JOIN users u ON u.id = p.user_id
  WHERE u.email = 'patient@example.com'
);
