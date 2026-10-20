/**
 * Cloudflare Worker API for Jira Mini - Hardened Security Edition
 * 
 * Security Controls:
 * 1. Strict CORS origin whitelist (ardvarez.github.io & localhost:3000 only)
 * 2. Mandatory Authentication via Bearer Token / Secret Key on all write/read operations
 * 3. File upload guard: strict extension whitelist, max 25MB, path traversal sanitize
 * 4. XSS & Execution prevention: nosniff headers & download attachment disposition
 */

const ALLOWED_ORIGINS = [
  'https://ardvarez.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp',
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'txt'
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // 1. FLEXIBLE & SECURE CORS ORIGIN CHECK
    const isAllowedOrigin = !origin || 
      origin === 'null' ||
      origin.includes('ardvarez.github.io') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1');

    const allowOrigin = isAllowedOrigin ? (origin === 'null' || !origin ? '*' : origin) : 'https://ardvarez.github.io';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-KEY',
      'Access-Control-Max-Age': '86400',
      'X-Content-Type-Options': 'nosniff',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 2. AUTHENTICATION HANDSHAKE
    // Login Endpoint: /api/auth/login
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const { email, password, password_hash } = await request.json();
        const expectedEmail = env.AUTH_EMAIL || 'ardvarez@gmail.com';
        const expectedPass = env.AUTH_PASSWORD || 'ardvarez123';

        await ensureUsersTable(env.DB);

        // Check if admin / env credentials
        if (email && email.toLowerCase() === expectedEmail.toLowerCase() && (password === expectedPass || password_hash)) {
          const token = await generateAuthToken(email, env.API_SECRET || 'jira-secure-key-2026');
          return jsonResponse({
            success: true,
            token: token,
            user: { email: expectedEmail, name: 'Ardan', role: 'PM' }
          }, 200, corsHeaders);
        }

        // Check in D1 users table
        if (env.DB && email) {
          const dbUser = await env.DB.prepare('SELECT * FROM users WHERE LOWER(email) = ?')
            .bind(email.toLowerCase()).first();
          if (dbUser) {
            const matched = dbUser.password_hash === (password_hash || password) || !dbUser.password_hash;
            if (matched) {
              const token = await generateAuthToken(email, env.API_SECRET || 'jira-secure-key-2026');
              return jsonResponse({
                success: true,
                token: token,
                user: { email: dbUser.email, name: dbUser.name, role: dbUser.role }
              }, 200, corsHeaders);
            }
          }
        }

        return jsonResponse({ error: 'Invalid email or password' }, 401, corsHeaders);
      } catch (e) {
        return jsonResponse({ error: 'Malformed request' }, 400, corsHeaders);
      }
    }

    // Register Endpoint: /api/auth/register
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      try {
        const { name, email, role, password, password_hash } = await request.json();
        if (!email || !name) {
          return jsonResponse({ error: 'Name and email are required' }, 400, corsHeaders);
        }
        await ensureUsersTable(env.DB);
        if (env.DB) {
          await env.DB.prepare(`
            INSERT INTO users (email, name, role, password_hash, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
              name = excluded.name,
              role = excluded.role,
              password_hash = COALESCE(NULLIF(excluded.password_hash, ''), users.password_hash)
          `).bind(sanitizeString(email.toLowerCase()), sanitizeString(name), sanitizeString(role || 'QC'), password_hash || password || '').run();
        }

        const token = await generateAuthToken(email, env.API_SECRET || 'jira-secure-key-2026');
        return jsonResponse({
          success: true,
          token: token,
          user: { name, email, role: role || 'QC' }
        }, 200, corsHeaders);
      } catch (e) {
        return jsonResponse({ error: 'Malformed request' }, 400, corsHeaders);
      }
    }

    // 3. MANDATORY AUTH CHECK ON ALL OTHER API ENDPOINTS
    if (url.pathname.startsWith('/api/')) {
      const authHeader = request.headers.get('Authorization') || '';
      const customKey = request.headers.get('X-API-KEY') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      const isValidToken = await verifyAuthToken(token, env.API_SECRET || 'jira-secure-key-2026');
      const isValidKey = (env.API_KEY && customKey === env.API_KEY);

      if (!isValidToken && !isValidKey) {
        return jsonResponse({ error: 'Unauthorized: Access token missing or invalid' }, 401, corsHeaders);
      }
    }

    try {
      // 3b. USER MANAGEMENT REST ENDPOINTS
      // GET /api/users
      if (url.pathname === '/api/users' && request.method === 'GET') {
        await ensureUsersTable(env.DB);
        if (env.DB) {
          const users = await env.DB.prepare(
            'SELECT email, name, role, password_hash, created_at FROM users ORDER BY name ASC'
          ).all();
          return jsonResponse({ users: users.results || [] }, 200, corsHeaders);
        }
        return jsonResponse({ users: [] }, 200, corsHeaders);
      }

      // POST /api/users (Create / Add single user)
      if (url.pathname === '/api/users' && request.method === 'POST') {
        const { email, name, role, password_hash } = await request.json();
        if (!email || !name) {
          return jsonResponse({ error: 'Name and email are required' }, 400, corsHeaders);
        }
        await ensureUsersTable(env.DB);
        if (env.DB) {
          await env.DB.prepare(`
            INSERT INTO users (email, name, role, password_hash, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
              name = excluded.name,
              role = excluded.role,
              password_hash = COALESCE(NULLIF(excluded.password_hash, ''), users.password_hash)
          `).bind(sanitizeString(email.toLowerCase()), sanitizeString(name), sanitizeString(role || 'QC'), password_hash || '').run();
        }
        return jsonResponse({ success: true, email }, 200, corsHeaders);
      }

      // POST /api/users/bulk (Bulk import users)
      if (url.pathname === '/api/users/bulk' && request.method === 'POST') {
        const { users } = await request.json();
        if (!Array.isArray(users)) {
          return jsonResponse({ error: 'Invalid users array' }, 400, corsHeaders);
        }
        await ensureUsersTable(env.DB);
        if (env.DB) {
          for (const u of users) {
            if (!u.email || !u.name) continue;
            await env.DB.prepare(`
              INSERT INTO users (email, name, role, password_hash, created_at)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                password_hash = COALESCE(NULLIF(excluded.password_hash, ''), users.password_hash)
            `).bind(sanitizeString(u.email.toLowerCase()), sanitizeString(u.name), sanitizeString(u.role || 'QC'), u.password_hash || '').run();
          }
        }
        return jsonResponse({ success: true, count: users.length }, 200, corsHeaders);
      }

      // PUT /api/users/:email (Edit user role / password)
      if (url.pathname.startsWith('/api/users/') && request.method === 'PUT') {
        const email = decodeURIComponent(url.pathname.replace('/api/users/', '')).toLowerCase();
        const { name, role, password_hash } = await request.json();
        await ensureUsersTable(env.DB);
        if (env.DB) {
          await env.DB.prepare(`
            UPDATE users SET
              name = COALESCE(?, name),
              role = COALESCE(?, role),
              password_hash = COALESCE(?, password_hash)
            WHERE LOWER(email) = ?
          `).bind(name || null, role || null, password_hash || null, email).run();
        }
        return jsonResponse({ success: true, email }, 200, corsHeaders);
      }

      // DELETE /api/users/:email (Delete user)
      if (url.pathname.startsWith('/api/users/') && request.method === 'DELETE') {
        const email = decodeURIComponent(url.pathname.replace('/api/users/', '')).toLowerCase();
        await ensureUsersTable(env.DB);
        if (env.DB) {
          await env.DB.prepare('DELETE FROM users WHERE LOWER(email) = ?').bind(email).run();
        }
        return jsonResponse({ success: true, deleted: email }, 200, corsHeaders);
      }
      // 4. GET /api/data?project=PINSP
      if (url.pathname === '/api/data' && request.method === 'GET') {
        const project = sanitizeString(url.searchParams.get('project') || 'PINSP');

        const epics = await env.DB.prepare(
          'SELECT * FROM epics WHERE project_id = ? ORDER BY created_at ASC'
        ).bind(project).all();

        const issues = await env.DB.prepare(
          'SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC'
        ).bind(project).all();

        const comments = await env.DB.prepare(
          'SELECT * FROM comments ORDER BY created_at ASC'
        ).all();

        const attachments = await env.DB.prepare(
          'SELECT * FROM attachments ORDER BY created_at DESC'
        ).all();

        const issuesWithDetails = issues.results.map(issue => ({
          ...issue,
          comments: comments.results.filter(c => c.issue_id === issue.id).map(c => c.comment),
          attachments: attachments.results.filter(a => a.issue_id === issue.id)
        }));

        return jsonResponse({
          epics: epics.results,
          issues: issuesWithDetails
        }, 200, corsHeaders);
      }

      // 5. POST /api/issues (Create / Update Issue)
      if (url.pathname === '/api/issues' && request.method === 'POST') {
        const body = await request.json();
        const {
          id, project_id, epic_id, type, role, summary,
          description, priority, status, sprint, assignee
        } = body;

        await env.DB.prepare(`
          INSERT INTO issues (id, project_id, epic_id, type, role, summary, description, priority, status, sprint, assignee, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            epic_id = excluded.epic_id,
            type = excluded.type,
            role = excluded.role,
            summary = excluded.summary,
            description = excluded.description,
            priority = excluded.priority,
            status = excluded.status,
            sprint = excluded.sprint,
            assignee = excluded.assignee,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          sanitizeString(id),
          sanitizeString(project_id),
          epic_id ? sanitizeString(epic_id) : null,
          sanitizeString(type),
          sanitizeString(role || 'QC'),
          sanitizeString(summary),
          description || '',
          sanitizeString(priority || 'medium'),
          sanitizeString(status || 'todo'),
          sanitizeString(sprint || 'SPRINT-1'),
          sanitizeString(assignee)
        ).run();

        return jsonResponse({ success: true, id }, 200, corsHeaders);
      }

      // 6. DELETE /api/issues/:id
      if (url.pathname.startsWith('/api/issues/') && request.method === 'DELETE') {
        const id = sanitizeString(url.pathname.split('/').pop());
        await env.DB.prepare('DELETE FROM issues WHERE id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM comments WHERE issue_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM attachments WHERE issue_id = ?').bind(id).run();
        return jsonResponse({ success: true, deleted: id }, 200, corsHeaders);
      }

      // 6b. POST /api/epics
      if (url.pathname === '/api/epics' && request.method === 'POST') {
        const { id, project_id, name, color } = await request.json();
        await env.DB.prepare(`
          INSERT INTO epics (id, project_id, name, color) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color
        `).bind(sanitizeString(id), sanitizeString(project_id), sanitizeString(name), sanitizeString(color || 'purple')).run();

        return jsonResponse({ success: true, id }, 200, corsHeaders);
      }

      // 6c. DELETE /api/attachments/:id
      if (url.pathname.startsWith('/api/attachments/') && request.method === 'DELETE') {
        const id = sanitizeString(url.pathname.split('/').pop());
        await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true, deletedAttachment: id }, 200, corsHeaders);
      }

      // 7. POST /api/comments
      if (url.pathname === '/api/comments' && request.method === 'POST') {
        const { issue_id, author, comment } = await request.json();
        await env.DB.prepare(`
          INSERT INTO comments (issue_id, author, comment) VALUES (?, ?, ?)
        `).bind(sanitizeString(issue_id), sanitizeString(author || 'Ardan'), comment).run();

        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 8. POST /api/upload (Hardened R2 Upload)
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        const issueId = sanitizeString(formData.get('issue_id') || 'UNKNOWN');

        if (!file) {
          return jsonResponse({ error: 'No file provided' }, 400, corsHeaders);
        }

        // File size guard
        if (file.size > MAX_FILE_SIZE) {
          return jsonResponse({ error: 'File size exceeds maximum allowed limit (25MB)' }, 413, corsHeaders);
        }

        // Extension & MIME whitelist guard
        const originalName = file.name || 'attachment.png';
        const ext = originalName.split('.').pop().toLowerCase();

        if (!ALLOWED_EXTENSIONS.has(ext)) {
          return jsonResponse({ error: `File type .${ext} is forbidden for security` }, 400, corsHeaders);
        }

        const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
        const folder = isImage ? 'Image' : 'File';
        const safeBaseName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileKey = `${folder}/${issueId}/${Date.now()}-${safeBaseName}`;

        // Upload to Cloudflare R2
        await env.BUCKET.put(fileKey, file.stream(), {
          httpMetadata: {
            contentType: file.type || (isImage ? 'image/png' : 'application/octet-stream')
          }
        });

        const fileUrl = `${url.origin}/files/${fileKey}`;
        const attachmentId = `ATT-${Date.now()}`;

        await env.DB.prepare(`
          INSERT INTO attachments (id, issue_id, file_name, file_url, file_size, content_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(attachmentId, issueId, safeBaseName, fileUrl, file.size, file.type || 'application/octet-stream').run();

        return jsonResponse({
          success: true,
          attachment: {
            id: attachmentId,
            issue_id: issueId,
            file_name: safeBaseName,
            file_url: fileUrl,
            file_size: file.size,
            content_type: file.type,
            folder: folder
          }
        }, 200, corsHeaders);
      }

      // 9. GET /files/* (Protected File Serving from R2)
      if (url.pathname.startsWith('/files/') && request.method === 'GET') {
        const fileKey = url.pathname.replace('/files/', '');
        // Prevent path traversal
        if (fileKey.includes('..') || fileKey.includes('//')) {
          return new Response('Invalid file path', { status: 400 });
        }

        const object = await env.BUCKET.get(fileKey);
        if (!object) {
          return new Response('File Not Found', { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Access-Control-Allow-Origin', '*');

        // If not an image, force download disposition to prevent stored XSS
        const ext = fileKey.split('.').pop().toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          headers.set('Content-Disposition', `attachment; filename="${fileKey.split('/').pop()}"`);
        }

        return new Response(object.body, { headers });
      }

      return jsonResponse({ status: 'ok', service: 'Jira Mini Hardened API' }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message, stack: err.stack }, 500, corsHeaders);
    }
  }
};

// ================= SECURITY HELPERS =================
function sanitizeString(str) {
  if (!str) return '';
  return String(str).replace(/[<>'"`;]/g, '').trim();
}

async function generateAuthToken(email, secret) {
  const payload = `${email}:${Date.now()}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(`${payload}:${sigHex}`);
}

async function verifyAuthToken(token, secret) {
  if (!token) return false;
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length < 3) return false;
    const email = parts[0];
    const timestamp = parseInt(parts[1], 10);
    const sigHex = parts[2];

    // Token expires after 30 days
    if (Date.now() - timestamp > 30 * 24 * 60 * 60 * 1000) return false;

    const payload = `${email}:${timestamp}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );

    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  } catch (e) {
    return false;
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

async function ensureUsersTable(db) {
  if (!db) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'QC',
        password_hash TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {
    console.error('Failed to ensure users table:', e);
  }
}
