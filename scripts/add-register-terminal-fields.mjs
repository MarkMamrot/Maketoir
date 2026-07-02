/**
 * Add card terminal fields to pos_registers.
 * Usage: node scripts/add-register-terminal-fields.mjs
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const columns = [
  { name: 'card_terminal_provider',  def: "VARCHAR(50)  NULL DEFAULT NULL AFTER is_active",         label: 'card_terminal_provider'  },
  { name: 'zeller_site_id',          def: "VARCHAR(255) NULL DEFAULT NULL AFTER card_terminal_provider", label: 'zeller_site_id'    },
  { name: 'zeller_terminal_id',      def: "VARCHAR(255) NULL DEFAULT NULL AFTER zeller_site_id",    label: 'zeller_terminal_id'      },
  { name: 'zeller_api_key',          def: "TEXT         NULL DEFAULT NULL AFTER zeller_terminal_id", label: 'zeller_api_key'          },
  { name: 'card_terminal_methods',   def: "TEXT         NULL DEFAULT NULL AFTER zeller_api_key",    label: 'card_terminal_methods'   },
];

try {
  for (const col of columns) {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'pos_registers' AND column_name = ?`,
      [col.name]
    );
    if (rows[0].cnt > 0) {
      console.log(`  ✓ ${col.label} already exists — skipped`);
    } else {
      await conn.execute(`ALTER TABLE pos_registers ADD COLUMN ${col.name} ${col.def}`);
      console.log(`  ✅ Added ${col.label}`);
    }
  }
  console.log('\nDone — pos_registers card terminal fields are ready.');
} finally {
  await conn.end();
}
