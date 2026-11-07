-- The canvas repository now writes `canvases.search_content` together with every
-- snapshot (see features/canvases/lib/search-content.ts). The triggers added in
-- 0049 re-parsed the whole snapshot with json_each/json_tree on every commit.
DROP TRIGGER IF EXISTS canvases_search_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS canvases_search_update;
