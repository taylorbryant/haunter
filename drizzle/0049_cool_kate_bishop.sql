ALTER TABLE `canvases` ADD `search_content` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
-- Index visible drawing text on every snapshot write, including older worker versions.
-- Geometry, asset URLs, metadata, and personal camera/selection state are never indexed.
CREATE TRIGGER canvases_search_insert AFTER INSERT ON canvases BEGIN
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
CREATE TRIGGER canvases_search_update AFTER UPDATE OF snapshot ON canvases BEGIN
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
-- Populate existing drawings without changing their snapshot or edit timestamp.
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
