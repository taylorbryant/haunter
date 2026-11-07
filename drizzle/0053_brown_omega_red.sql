ALTER TABLE `canvases` ADD `search_projection_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Older workers do not advance search_projection_version. Keep their writes
-- indexed during rollout and rollback without re-projecting new worker writes.
-- Geometry, asset URLs, metadata, and personal camera/selection state are never indexed.
CREATE TRIGGER canvases_search_insert AFTER INSERT ON canvases
WHEN NEW.search_projection_version = 0 BEGIN
  UPDATE canvases SET search_content = (
  SELECT COALESCE(json_group_array(json_object('shapeId', shape_id, 'text', visible_text)), '[]')
  FROM (
    SELECT json_extract(shape.value, '$.id') AS shape_id,
      trim(CASE
        WHEN json_extract(shape.value, '$.type') = 'frame'
          THEN COALESCE(json_extract(shape.value, '$.props.name'), '')
        WHEN json_type(shape.value, '$.props.richText') = 'object' THEN (
          SELECT COALESCE(group_concat(fragment, ''), '') FROM (
            SELECT CASE
              WHEN node.key = 'text' AND node.type = 'text'
                AND json_extract(shape.value, node.path || '.type') = 'text'
                THEN node.atom
              WHEN node.key = 'type' AND node.atom IN ('paragraph', 'hardBreak') THEN ' '
              ELSE '' END fragment
            FROM json_tree(shape.value, '$.props.richText') node
            ORDER BY node.id
          )
        )
        ELSE COALESCE(json_extract(shape.value, '$.props.text'), '')
      END) AS visible_text
    FROM json_each(NEW.snapshot, '$.store') shape
    WHERE json_extract(shape.value, '$.typeName') = 'shape'
      AND json_extract(shape.value, '$.type') IN ('text', 'note', 'geo', 'arrow', 'frame')
  ) WHERE visible_text <> '' AND shape_id IS NOT NULL
) WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER canvases_search_update AFTER UPDATE OF snapshot ON canvases
WHEN NEW.search_projection_version = OLD.search_projection_version BEGIN
  UPDATE canvases SET search_content = (
  SELECT COALESCE(json_group_array(json_object('shapeId', shape_id, 'text', visible_text)), '[]')
  FROM (
    SELECT json_extract(shape.value, '$.id') AS shape_id,
      trim(CASE
        WHEN json_extract(shape.value, '$.type') = 'frame'
          THEN COALESCE(json_extract(shape.value, '$.props.name'), '')
        WHEN json_type(shape.value, '$.props.richText') = 'object' THEN (
          SELECT COALESCE(group_concat(fragment, ''), '') FROM (
            SELECT CASE
              WHEN node.key = 'text' AND node.type = 'text'
                AND json_extract(shape.value, node.path || '.type') = 'text'
                THEN node.atom
              WHEN node.key = 'type' AND node.atom IN ('paragraph', 'hardBreak') THEN ' '
              ELSE '' END fragment
            FROM json_tree(shape.value, '$.props.richText') node
            ORDER BY node.id
          )
        )
        ELSE COALESCE(json_extract(shape.value, '$.props.text'), '')
      END) AS visible_text
    FROM json_each(NEW.snapshot, '$.store') shape
    WHERE json_extract(shape.value, '$.typeName') = 'shape'
      AND json_extract(shape.value, '$.type') IN ('text', 'note', 'geo', 'arrow', 'frame')
  ) WHERE visible_text <> '' AND shape_id IS NOT NULL
) WHERE id = NEW.id;
END;
--> statement-breakpoint
-- Repair any index drift from workers that saved after migration 0052.
-- This backfill does not change snapshots or edit timestamps.
UPDATE canvases SET search_content = (
  SELECT COALESCE(json_group_array(json_object('shapeId', shape_id, 'text', visible_text)), '[]')
  FROM (
    SELECT json_extract(shape.value, '$.id') AS shape_id,
      trim(CASE
        WHEN json_extract(shape.value, '$.type') = 'frame'
          THEN COALESCE(json_extract(shape.value, '$.props.name'), '')
        WHEN json_type(shape.value, '$.props.richText') = 'object' THEN (
          SELECT COALESCE(group_concat(fragment, ''), '') FROM (
            SELECT CASE
              WHEN node.key = 'text' AND node.type = 'text'
                AND json_extract(shape.value, node.path || '.type') = 'text'
                THEN node.atom
              WHEN node.key = 'type' AND node.atom IN ('paragraph', 'hardBreak') THEN ' '
              ELSE '' END fragment
            FROM json_tree(shape.value, '$.props.richText') node
            ORDER BY node.id
          )
        )
        ELSE COALESCE(json_extract(shape.value, '$.props.text'), '')
      END) AS visible_text
    FROM json_each(canvases.snapshot, '$.store') shape
    WHERE json_extract(shape.value, '$.typeName') = 'shape'
      AND json_extract(shape.value, '$.type') IN ('text', 'note', 'geo', 'arrow', 'frame')
  ) WHERE visible_text <> '' AND shape_id IS NOT NULL
);
