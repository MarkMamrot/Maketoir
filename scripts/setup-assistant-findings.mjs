import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
});

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS assistant_workflow_findings (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      fingerprint CHAR(64) NOT NULL,
      category ENUM('logical_flow_error','workflow_gap','missing_capability','edge_case','documentation_gap') NOT NULL,
      impact ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
      confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
      status ENUM('new','triaging','confirmed_defect','confirmed_gap','intentional_design','planned','duplicate','declined','resolved') NOT NULL DEFAULT 'new',
      capability VARCHAR(100) NOT NULL,
      audiences_json JSON NOT NULL,
      title VARCHAR(255) NOT NULL,
      evidence_json JSON NOT NULL,
      first_seen_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
      affected_business_count INT UNSIGNED NOT NULL DEFAULT 1,
      model_version VARCHAR(100) NULL,
      prompt_version VARCHAR(100) NULL,
      index_version VARCHAR(100) NULL,
      tool_manifest_version VARCHAR(100) NULL,
      assigned_to INT NULL,
      resolution_notes TEXT NULL,
      alert_pending TINYINT(1) NOT NULL DEFAULT 0,
      last_alerted_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_assistant_workflow_finding_fingerprint (fingerprint),
      INDEX idx_assistant_workflow_finding_status_seen (status, last_seen_at),
      INDEX idx_assistant_workflow_finding_capability (capability, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS assistant_workflow_finding_businesses (
      finding_id BIGINT NOT NULL,
      business_id VARCHAR(100) NOT NULL,
      first_seen_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      PRIMARY KEY (finding_id, business_id),
      CONSTRAINT fk_assistant_finding_business_finding FOREIGN KEY (finding_id)
        REFERENCES assistant_workflow_findings(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS assistant_workflow_finding_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      finding_id BIGINT NOT NULL,
      event_type ENUM('observed','status_changed','assigned','note','evidence_added','documentation_requested') NOT NULL,
      business_id VARCHAR(100) NULL,
      message TEXT NULL,
      evidence_json JSON NULL,
      actor_id INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_assistant_finding_event (finding_id, created_at),
      CONSTRAINT fk_assistant_finding_event_finding FOREIGN KEY (finding_id)
        REFERENCES assistant_workflow_findings(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS assistant_escalations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      public_reference VARCHAR(20) NOT NULL,
      idempotency_key CHAR(64) NOT NULL,
      parent_kind ENUM('runtime_issue','workflow_finding') NOT NULL,
      runtime_issue_id BIGINT NULL,
      workflow_finding_id BIGINT NULL,
      business_id VARCHAR(100) NOT NULL,
      audience ENUM('ims','pos','wholesale') NOT NULL,
      actor_type ENUM('ims_user','pos_user','wholesale_member') NOT NULL,
      actor_id VARCHAR(191) NOT NULL,
      can_follow_up_directly TINYINT(1) NOT NULL DEFAULT 0,
      source_reference_type VARCHAR(64) NULL,
      source_reference_id VARCHAR(191) NULL,
      current_view VARCHAR(100) NULL,
      status ENUM('open','acknowledged','investigating','followed_up','closed') NOT NULL DEFAULT 'open',
      response_due_at DATETIME(3) NOT NULL,
      acknowledged_at DATETIME(3) NULL,
      followed_up_at DATETIME(3) NULL,
      assigned_to INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_assistant_escalation_public_reference (public_reference),
      UNIQUE KEY uq_assistant_escalation_idempotency (idempotency_key),
      INDEX idx_assistant_escalation_due (status, response_due_at),
      INDEX idx_assistant_escalation_business (business_id, created_at),
      CONSTRAINT fk_assistant_escalation_runtime_issue FOREIGN KEY (runtime_issue_id)
        REFERENCES runtime_issues(id) ON DELETE SET NULL,
      CONSTRAINT fk_assistant_escalation_workflow_finding FOREIGN KEY (workflow_finding_id)
        REFERENCES assistant_workflow_findings(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS assistant_escalation_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      escalation_id BIGINT NOT NULL,
      event_type ENUM('opened','acknowledged','assigned','note','followed_up','closed') NOT NULL,
      message TEXT NULL,
      actor_id INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_assistant_escalation_event (escalation_id, created_at),
      CONSTRAINT fk_assistant_escalation_event_escalation FOREIGN KEY (escalation_id)
        REFERENCES assistant_escalations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const expectedTables = [
    'assistant_workflow_findings',
    'assistant_workflow_finding_businesses',
    'assistant_workflow_finding_events',
    'assistant_escalations',
    'assistant_escalation_events',
  ];
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${expectedTables.map(() => '?').join(',')})`,
    expectedTables,
  );
  const existingTables = new Set(tableRows.map(row => row.TABLE_NAME));
  const missingTables = expectedTables.filter(table => !existingTables.has(table));
  if (missingTables.length > 0) throw new Error(`Assistant schema verification failed; missing tables: ${missingTables.join(', ')}`);

  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'assistant_workflow_findings' AND COLUMN_NAME IN ('fingerprint','status','evidence_json','alert_pending'))
          OR (TABLE_NAME = 'assistant_escalations' AND COLUMN_NAME IN ('public_reference','idempotency_key','response_due_at','parent_kind')))`,
  );
  const columns = new Set(columnRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const expectedColumns = [
    'assistant_workflow_findings.fingerprint', 'assistant_workflow_findings.status',
    'assistant_workflow_findings.evidence_json', 'assistant_workflow_findings.alert_pending',
    'assistant_escalations.public_reference', 'assistant_escalations.idempotency_key',
    'assistant_escalations.response_due_at', 'assistant_escalations.parent_kind',
  ];
  const missingColumns = expectedColumns.filter(column => !columns.has(column));
  if (missingColumns.length > 0) throw new Error(`Assistant schema verification failed; missing columns: ${missingColumns.join(', ')}`);
  console.log(`Assistant finding and escalation tables are ready in ${process.env.MYSQL_DATABASE}.`);
} finally {
  await connection.end();
}