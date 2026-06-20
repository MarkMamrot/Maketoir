'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  role: string;
  tier: string;
  created_at: string;
}

interface UserSession {
  tier?: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    name: '',
    company: '',
    tier: 'StandardUser',
  });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ tier: '', name: '' });
  const [message, setMessage] = useState('');

  // Fetch current user and check tier
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch('/api/user/me');
        if (!res.ok) {
          router.push('/login');
          return;
        }
        const userData = await res.json();
        setCurrentUser(userData);

        if (userData.tier !== 'SuperAdmin' && userData.tier !== 'Admin') {
          alert('This page is restricted to Admin users and above.');
          router.push('/dashboard');
          return;
        }

        // Fetch users
        await fetchUsers();
      } catch (err) {
        console.error('Error checking access:', err);
        router.push('/login');
      }
    };

    checkAccess();
  }, [router]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      } else {
        console.error('Failed to fetch users');
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createForm.email || !createForm.password) {
      alert('Email and password are required.');
      return;
    }

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      if (res.ok) {
        const data = await res.json();
        setMessage(`✓ ${data.message}`);
        setShowCreateModal(false);
        setCreateForm({ email: '', password: '', name: '', company: '', tier: 'StandardUser' });
        await fetchUsers();
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await res.json();
        alert(`Error: ${error.error}`);
      }
    } catch (err) {
      console.error('Error creating user:', err);
      alert('Failed to create user.');
    }
  };

  const handleUpdateUserTier = async (userId: number) => {
    if (!editForm.tier) {
      alert('Please select a tier.');
      return;
    }

    try {
      const res = await fetch(`/api/admin/users?userId=${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: editForm.tier, name: editForm.name }),
      });

      if (res.ok) {
        setMessage('✓ User updated successfully.');
        setEditingUser(null);
        await fetchUsers();
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await res.json();
        alert(`Error: ${error.error}`);
      }
    } catch (err) {
      console.error('Error updating user:', err);
      alert('Failed to update user.');
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;

    try {
      const res = await fetch(`/api/admin/users?userId=${userId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setMessage('✓ User deleted successfully.');
        await fetchUsers();
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await res.json();
        alert(`Error: ${error.error}`);
      }
    } catch (err) {
      console.error('Error deleting user:', err);
      alert('Failed to delete user.');
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-6"><p>Loading...</p></div>;
  }

  const tierColors: Record<string, string> = {
    SuperAdmin: '#ff6b6b',
    Admin: '#4ecdc4',
    StandardUser: '#45b7d1',
    PosUser: '#96ceb4',
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <style>{`
        .admin-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
        }
        .create-btn {
          background-color: #007bff;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 14px;
        }
        .create-btn:hover {
          background-color: #0056b3;
        }
        .users-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
        }
        .users-table thead {
          background-color: #f5f5f5;
          border-bottom: 2px solid #ddd;
        }
        .users-table th {
          padding: 12px;
          text-align: left;
          font-weight: 600;
        }
        .users-table td {
          padding: 12px;
          border-bottom: 1px solid #eee;
        }
        .tier-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          color: white;
          font-size: 12px;
          font-weight: 600;
        }
        .action-btns {
          display: flex;
          gap: 8px;
        }
        .edit-btn, .delete-btn {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        .edit-btn {
          background-color: #4ecdc4;
          color: white;
        }
        .delete-btn {
          background-color: #ff6b6b;
          color: white;
        }
        .modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        .modal-content {
          background: white;
          padding: 30px;
          border-radius: 8px;
          max-width: 500px;
          width: 90%;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }
        .modal-content h2 {
          margin-top: 0;
        }
        .form-group {
          margin-bottom: 15px;
        }
        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: 600;
        }
        .form-group input, .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        }
        .modal-buttons {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          margin-top: 20px;
        }
        .modal-buttons button {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        .save-btn {
          background-color: #28a745;
          color: white;
        }
        .cancel-btn {
          background-color: #6c757d;
          color: white;
        }
        .message {
          padding: 12px;
          margin-bottom: 20px;
          background-color: #d4edda;
          border: 1px solid #c3e6cb;
          border-radius: 4px;
          color: #155724;
        }
      `}</style>

      <div className="admin-header">
        <h1>User Management</h1>
        <button className="create-btn" onClick={() => setShowCreateModal(true)}>
          + Create User
        </button>
      </div>

      {message && <div className="message">{message}</div>}

      {users.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Tier</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name || '—'}</td>
                <td>{user.email}</td>
                <td>{user.company || '—'}</td>
                <td>
                  <span
                    className="tier-badge"
                    style={{ backgroundColor: tierColors[user.tier] || '#666' }}
                  >
                    {user.tier}
                  </span>
                </td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="action-btns">
                    <button
                      className="edit-btn"
                      onClick={() => {
                        setEditingUser(user);
                        setEditForm({ tier: user.tier, name: user.name || '' });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="delete-btn"
                      onClick={() => handleDeleteUser(user.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New User</h2>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Password *</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Company</label>
                <input
                  type="text"
                  value={createForm.company}
                  onChange={(e) => setCreateForm({ ...createForm, company: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Tier</label>
                <select
                  value={createForm.tier}
                  onChange={(e) => setCreateForm({ ...createForm, tier: e.target.value })}
                >
                  {currentUser?.tier === 'SuperAdmin' && (
                    <>
                      <option value="SuperAdmin">Super Admin</option>
                      <option value="Admin">Admin</option>
                    </>
                  )}
                  {(currentUser?.tier === 'SuperAdmin' || currentUser?.tier === 'Admin') && (
                    <option value="StandardUser">Standard User</option>
                  )}
                  <option value="PosUser">POS User</option>
                </select>
              </div>
              <div className="modal-buttons">
                <button type="button" className="cancel-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="save-btn">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="modal" onClick={() => setEditingUser(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Edit User: {editingUser.email}</h2>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Tier</label>
              <select
                value={editForm.tier}
                onChange={(e) => setEditForm({ ...editForm, tier: e.target.value })}
              >
                {currentUser?.tier === 'SuperAdmin' && (
                  <>
                    <option value="SuperAdmin">Super Admin</option>
                    <option value="Admin">Admin</option>
                  </>
                )}
                {(currentUser?.tier === 'SuperAdmin' || currentUser?.tier === 'Admin') && (
                  <option value="StandardUser">Standard User</option>
                )}
                <option value="PosUser">POS User</option>
              </select>
            </div>
            <div className="modal-buttons">
              <button className="cancel-btn" onClick={() => setEditingUser(null)}>
                Cancel
              </button>
              <button
                className="save-btn"
                onClick={() => handleUpdateUserTier(editingUser.id)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
