import { query, execute } from '@/services/MySQLService';
import bcrypt from 'bcryptjs';

export interface UserRow {
  id:            number;
  name:          string | null;
  company:       string | null;
  email:         string;
  phone:         string | null;
  password_hash: string;
  business_id:   string | null;
  role:          'admin' | 'user';
  deleted_at:    string | null;
  registered_at: string | null;
  created_at:    string;
}

export const UsersRepository = {
  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await query<UserRow>(
      'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  },

  async findById(id: number): Promise<UserRow | null> {
    const rows = await query<UserRow>(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    return rows[0] ?? null;
  },

  async create(data: {
    email: string;
    password: string;   // plain-text — will be hashed
    name?: string;
    company?: string;
    phone?: string;
    businessId?: string;
    role?: 'admin' | 'user';
  }): Promise<number> {
    const hash = await bcrypt.hash(data.password, 12);
    const result = await execute(
      `INSERT INTO users (email, password_hash, name, company, phone, business_id, role, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [data.email.toLowerCase(), hash,
       data.name ?? null, data.company ?? null, data.phone ?? null,
       data.businessId ?? null, data.role ?? 'admin'],
    );
    return result.insertId;
  },

  async updateBusinessId(userId: number, businessId: string): Promise<void> {
    await execute(
      'UPDATE users SET business_id = ? WHERE id = ?',
      [businessId, userId],
    );
  },

  async verifyPassword(user: UserRow, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, user.password_hash);
  },
};
