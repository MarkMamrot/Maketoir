// Shared by fresh provisioning and the scoped all-tenant migration.
const changed = fields => fields.map(field => `NOT (OLD.\`${field}\` <=> NEW.\`${field}\`)`).join(' OR ');
const touch = select => `INSERT INTO pos_catalogue_changes (business_id, variant_id, generation)
  ${select} ON DUPLICATE KEY UPDATE generation = UUID();`;
const variant = row => `SELECT p.business_id, ${row}.variant_id, UUID() FROM ims_products p WHERE p.product_id = ${row}.product_id`;
const stockVariant = row => `SELECT p.business_id, v.variant_id, UUID() FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id WHERE v.variant_id = ${row}.variant_id`;
const children = row => `SELECT p.business_id, v.variant_id, UUID() FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id WHERE v.product_id = ${row}.product_id`;
const outputs = (row, expression = `${row}.variant_id`) => `SELECT DISTINCT r.business_id, r.output_variant_id, UUID()
  FROM ims_product_build_recipes r JOIN ims_product_build_recipe_components c ON c.recipe_version_id = r.active_version_id
  WHERE c.component_variant_id = ${expression}`;
const all = row => `SELECT p.business_id, v.variant_id, UUID() FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id WHERE p.business_id = ${row}.business_id`;

export const catalogueTriggers = [];
function add(table, event, body, timing = 'AFTER') {
  catalogueTriggers.push({ name: `trg_pos_cat_${table.replace('ims_', '')}_${event.toLowerCase()}`, table, event, timing, body: `BEGIN ${body} END` });
}
for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
  const row = event === 'DELETE' ? 'OLD' : 'NEW';
  const guard = (fields, sql) => event === 'UPDATE' ? `IF ${changed(fields)} THEN ${sql} END IF;` : sql;
  add('ims_product_variants', event, guard([
    'business_id', 'variant_id', 'product_id', 'sku', 'barcode', 'option1_value', 'option2_value', 'option3_value',
    'cost_aud', 'price_rrp', 'price_rrp_sale', 'discount_start_date', 'discount_end_date', 'is_active',
  ], touch(variant(row)) + touch(outputs(row))
    + (event === 'UPDATE' ? `IF ${changed(['business_id', 'variant_id', 'product_id'])} THEN ${touch(variant('OLD'))}${touch(outputs('OLD'))} END IF;` : '')),
    event === 'DELETE' ? 'BEFORE' : 'AFTER');
  const dependentChildren = `SELECT DISTINCT r.business_id, r.output_variant_id, UUID()
    FROM ims_product_build_recipes r JOIN ims_product_build_recipe_components c ON c.recipe_version_id = r.active_version_id
    JOIN ims_product_variants v ON v.variant_id = c.component_variant_id WHERE v.product_id = ${row}.product_id`;
  add('ims_products', event, guard(['business_id', 'product_id', 'name', 'brand', 'is_active'],
    touch(children(row)) + (event === 'DELETE' ? touch(dependentChildren) : '')
    + (event === 'UPDATE' ? `IF ${changed(['business_id', 'product_id'])} THEN ${touch(`SELECT OLD.business_id, variant_id, UUID()
      FROM ims_product_variants WHERE product_id = NEW.product_id`)} END IF;` : '')), event === 'DELETE' ? 'BEFORE' : 'AFTER');
  add('ims_stock', event, guard(['business_id', 'variant_id', 'location_id', 'qty_on_hand', 'qty_committed'],
    touch(stockVariant(row)) + touch(outputs(row))
    + (event === 'UPDATE' ? `IF ${changed(['business_id', 'variant_id'])} THEN ${touch(stockVariant('OLD'))}${touch(outputs('OLD'))} END IF;` : '')));
  add('ims_product_images', event, guard(['product_id', 'url', 'source', 'is_primary', 'sort_order'],
    touch(children(row)) + (event === 'UPDATE' ? `IF NOT (OLD.product_id <=> NEW.product_id) THEN ${touch(children('OLD'))} END IF;` : '')));
  add('ims_product_build_recipes', event, touch(`SELECT ${row}.business_id, ${row}.output_variant_id, UUID()`)
    + (event === 'UPDATE' ? touch('SELECT OLD.business_id, OLD.output_variant_id, UUID()') : ''));
  add('ims_product_build_recipe_components', event, touch(`SELECT r.business_id, r.output_variant_id, UUID()
    FROM ims_product_build_recipes r WHERE r.active_version_id = ${row}.recipe_version_id`)
    + (event === 'UPDATE' ? touch(`SELECT r.business_id, r.output_variant_id, UUID()
      FROM ims_product_build_recipes r WHERE r.active_version_id = OLD.recipe_version_id`) : ''));
  add('ims_settings', event, `IF ${row}.\`key\` IN ('builds_enabled', 'build_from_sale_enabled', 'business_timezone')
    OR ${row}.\`key\` LIKE 'build_from_sale_location:%' THEN ${touch(all(row))} END IF;`
    + (event === 'UPDATE' ? `IF OLD.\`key\` IN ('builds_enabled', 'build_from_sale_enabled', 'business_timezone')
      OR OLD.\`key\` LIKE 'build_from_sale_location:%' THEN ${touch(all('OLD'))} END IF;` : ''));
}

export async function installCatalogueTracking(connection) {
  const [installed] = await connection.query('SELECT TRIGGER_NAME, ACTION_STATEMENT, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()');
  const normalize = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  for (const trigger of catalogueTriggers) {
    const existing = installed.find(row => row.TRIGGER_NAME === trigger.name);
    if (existing && normalize(existing.ACTION_STATEMENT) === normalize(trigger.body)
      && existing.ACTION_TIMING === trigger.timing && existing.EVENT_MANIPULATION === trigger.event && existing.EVENT_OBJECT_TABLE === trigger.table) continue;
    // A trigger definition change invalidates all existing checkpoints.
    await connection.query('UPDATE pos_catalogue_control SET epoch = UUID(), ready = 0');
    await connection.query(`DROP TRIGGER IF EXISTS \`${trigger.name}\``);
    await connection.query(`CREATE TRIGGER \`${trigger.name}\` ${trigger.timing} ${trigger.event}
      ON \`${trigger.table}\` FOR EACH ROW ${trigger.body}`);
  }
  await connection.query(`INSERT IGNORE INTO pos_catalogue_control (business_id, epoch)
    SELECT DISTINCT business_id, UUID() FROM ims_products WHERE business_id <> ''`);
  await connection.query("INSERT IGNORE INTO pos_catalogue_control (business_id, epoch) VALUES ('', UUID())");
  await connection.query(`INSERT IGNORE INTO pos_catalogue_changes (business_id, variant_id, generation)
    SELECT p.business_id, v.variant_id, UUID() FROM ims_product_variants v
    JOIN ims_products p ON p.product_id = v.product_id WHERE p.business_id <> ''`);
  await connection.query('UPDATE pos_catalogue_control SET ready = 1');
}
