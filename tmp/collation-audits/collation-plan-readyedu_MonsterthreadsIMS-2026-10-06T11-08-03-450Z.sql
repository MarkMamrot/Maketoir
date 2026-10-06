-- REVIEW ONLY: this file was generated read-only and has not been executed.
-- Schema: readyedu_MonsterthreadsIMS
-- Contract version: 3
-- Source metadata hash: 5119e21f9424e1e0c7cab8514850928207be5e3160e49d699990612f86084ce1
-- Plan hash: 8b4f32d392793b41c66b2f21bd9015ed1e570f8588cd75ee9699ff3b64d76651
ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_item_components` DROP FOREIGN KEY `ims_product_build_item_components_ibfk_2`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_items` DROP FOREIGN KEY `ims_product_build_items_ibfk_2`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipe_components` DROP FOREIGN KEY `ims_product_build_recipe_components_ibfk_2`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipes` DROP FOREIGN KEY `ims_product_build_recipes_ibfk_1`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_requirements` DROP FOREIGN KEY `ims_product_build_requirements_ibfk_4`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_variants` DROP FOREIGN KEY `ims_product_variants_ibfk_1`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_purchase_order_items` DROP FOREIGN KEY `ims_purchase_order_items_ibfk_2`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_cache` DROP FOREIGN KEY `fk_isc_variant`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stock` DROP FOREIGN KEY `ims_stock_ibfk_1`;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`_archived_ims_sales_order_refunds`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`gift_card_transactions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`gift_cards`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_backorder_merges`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_branch_transfer_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_branch_transfers`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_brands`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_bulk_product_presets`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_channel_customer_mappings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_channel_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_channel_product_mappings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_channel_product_selections`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_channel_sync_jobs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_channel_variant_mappings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_contact_channel_mappings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_contacts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_credit_note_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `variant_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_credit_notes`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_contact_merges`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_contact_tags`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_interactions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_lead_contact_points`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_lead_discoveries`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_lead_people`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_opportunities`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_pipeline_stages`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_segments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_tags`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_crm_tasks`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_draft_revisions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_drafts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_knowledge_documents`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_knowledge_versions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_learning_candidates`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_learning_evidence`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_messages`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_processing_runs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_settings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_cs_threads`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_customer_credit_settlements`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_early_payment_discount_applications`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_early_payment_discount_rules`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_fifo_cost_allocations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_fifo_cost_layers`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_inventory_cost_epochs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_inventory_cost_state`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_inventory_document_operations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_locations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_notifications`
  MODIFY COLUMN `business_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_addresses`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_checkout_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_checkouts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_customers`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_fulfilment_groups`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_payment_attempts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_payment_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_pickup_locations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_products`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_refunds`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_shipping_rules`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_stock_reservations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_online_shop_value_reservations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_order_amendment_lines`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_order_amendment_operations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_payment_methods`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_po_backorder_lines`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_po_files`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_po_landed_costs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_po_receive_operations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_po_shortfall_resolutions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_batches`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_item_components`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `component_variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `output_variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipe_components`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `component_variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipe_versions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipes`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `output_variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_requirements`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `output_variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_reversals`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_images`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_variants`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_products`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_purchase_order_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_purchase_order_payments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_purchase_order_presets`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_purchase_orders`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_cache`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_channel_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_channel_jobs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_channel_product_assignments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_channel_product_mappings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_channel_product_rules`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_channel_product_selections`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_history`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_order_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_order_payments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_orders`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_settings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_carrier_accounts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_channel_jobs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_labels`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_manifests`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_package_presets`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_parcel_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_parcels`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shipping_shipments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shopify_inventory_queue`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shopify_payout_lines`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shopify_payouts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_shopify_sync_log`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `channel_instance_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_so_backorder_lines`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_so_fulfilment_operations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_so_shipment_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_so_shipment_tracking`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_so_shipments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `channel_instance_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_so_shortfall_resolutions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stock`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stock_allocation_operations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stock_allocations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stock_movements`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stocktake_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stocktakes`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_supplier_credit_note_files`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_supplier_credit_note_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `variant_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_supplier_credit_notes`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_supplier_credit_settlements`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_website_content_attempts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `product_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_companies`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_company_locations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_company_members`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_favourites`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_member_locations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_saved_list_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_saved_lists`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_wholesale_team_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`loyalty_accounts`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`loyalty_membership_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`loyalty_redemptions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`loyalty_rewards`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`loyalty_transactions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_chat_attachments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_chat_messages`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_comments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_communication_attachments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_communication_reads`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_communication_targets`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_communications`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_content_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_import_runs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_product_guides`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_record_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_records`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_reference_categories`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_references`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_staff_identities`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_task_instances`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_task_signoffs`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_daybook_task_templates`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_eod_reconciliations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_payments`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_petty_cash_transactions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_register_sessions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_registers`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_sale_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  MODIFY COLUMN `variant_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_sales`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_training_sales`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`pos_users`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '';

ALTER TABLE `readyedu_MonsterthreadsIMS`.`store_credit_transactions`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`wholesale_draft_order_items`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `product_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY COLUMN `variant_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`wholesale_draft_orders`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN `business_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_item_components` ADD CONSTRAINT `ims_product_build_item_components_ibfk_2` FOREIGN KEY (`component_variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_items` ADD CONSTRAINT `ims_product_build_items_ibfk_2` FOREIGN KEY (`output_variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipe_components` ADD CONSTRAINT `ims_product_build_recipe_components_ibfk_2` FOREIGN KEY (`component_variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_recipes` ADD CONSTRAINT `ims_product_build_recipes_ibfk_1` FOREIGN KEY (`output_variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_build_requirements` ADD CONSTRAINT `ims_product_build_requirements_ibfk_4` FOREIGN KEY (`output_variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_product_variants` ADD CONSTRAINT `ims_product_variants_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_products` (`product_id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_purchase_order_items` ADD CONSTRAINT `ims_purchase_order_items_ibfk_2` FOREIGN KEY (`variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_sales_cache` ADD CONSTRAINT `fk_isc_variant` FOREIGN KEY (`variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `readyedu_MonsterthreadsIMS`.`ims_stock` ADD CONSTRAINT `ims_stock_ibfk_1` FOREIGN KEY (`variant_id`) REFERENCES `readyedu_MonsterthreadsIMS`.`ims_product_variants` (`variant_id`) ON DELETE CASCADE ON UPDATE NO ACTION;
