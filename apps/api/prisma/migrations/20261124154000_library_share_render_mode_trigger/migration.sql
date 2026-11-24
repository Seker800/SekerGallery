BEGIN;
-- Share render jobs are owner/mode scoped like the other library tables; raw SQL
-- must not move a row between libraries.
CREATE TRIGGER library_mode_immutable
BEFORE UPDATE OF "libraryMode" ON "LibraryShareRender"
FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
COMMIT;
