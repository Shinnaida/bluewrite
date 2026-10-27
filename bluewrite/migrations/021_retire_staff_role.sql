-- BlueWrite migration 021: retire the Staff role (owner request: Admin and Officer only).
--
-- Every account holding the Staff role becomes an Officer first, so nobody
-- loses access and no row is left pointing at a role that no longer exists.
-- Officers sign in with an emailed code, so a converted account without an
-- address cannot finish signing in until an Admin records one (the directory
-- flags exactly that state). The Staff role row is then removed.

UPDATE users u
JOIN roles r ON r.id = u.role_id
SET u.role_id = (SELECT id FROM roles WHERE name = 'Officer')
WHERE r.name = 'Staff';

DELETE FROM roles WHERE name = 'Staff';
