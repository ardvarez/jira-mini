/**
 * Cloudflare Worker API for Jira Mini
 * Connects to:
 * - Cloudflare D1 (Database SQL): env.DB
 * - Cloudflare R2 (Object Storage): env.BUCKET
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-KEY',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Optional API key validation (set API_KEY in wrangler secret)
    const apiKey = request.headers.get('X-API-KEY');
    if (env.API_KEY && apiKey !== env.API_KEY) {
      return jsonResponse({ error: 'Unauthorized: Invalid API Key' }, 401, corsHeaders);
    }

    try {
      // 1. GET /api/data?project=PINSP
      if (url.pathname === '/api/data' && request.method === 'GET') {
        const project = url.searchParams.get('project') || 'PINSP';

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

        // Group comments and attachments by issue_id
        const issuesWithDetails = issues.results.map(issue => {
          return {
            ...issue,
            comments: comments.results.filter(c => c.issue_id === issue.id).map(c => c.comment),
            attachments: attachments.results.filter(a => a.issue_id === issue.id)
          };
        });

        return jsonResponse({
          epics: epics.results,
          issues: issuesWithDetails
        }, 200, corsHeaders);
      }

      // 2. POST /api/issues (Create or Update Issue)
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
          id, project_id, epic_id || null, type, role, summary,
          description || '', priority, status, sprint, assignee
        ).run();

        return jsonResponse({ success: true, id }, 200, corsHeaders);
      }

      // 3. DELETE /api/issues/:id
      if (url.pathname.startsWith('/api/issues/') && request.method === 'DELETE') {
        const id = url.pathname.split('/').pop();
        await env.DB.prepare('DELETE FROM issues WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true, deleted: id }, 200, corsHeaders);
      }

      // 4. POST /api/comments
      if (url.pathname === '/api/comments' && request.method === 'POST') {
        const { issue_id, author, comment } = await request.json();
        await env.DB.prepare(`
          INSERT INTO comments (issue_id, author, comment) VALUES (?, ?, ?)
        `).bind(issue_id, author || 'User', comment).run();

        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // 5. POST /api/upload (Upload Evidence to Cloudflare R2)
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        const issueId = formData.get('issue_id') || 'UNKNOWN';

        if (!file) {
          return jsonResponse({ error: 'No file uploaded' }, 400, corsHeaders);
        }

        const ext = file.name.split('.').pop() || 'png';
        const fileKey = `evidence/${issueId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

        // Upload directly to Cloudflare R2 Bucket
        await env.BUCKET.put(fileKey, file.stream(), {
          httpMetadata: { contentType: file.type || 'image/png' }
        });

        // Generate file URL (served via this worker endpoint /files/:key)
        const fileUrl = `${url.origin}/files/${fileKey}`;

        // Record attachment in D1 DB
        const attachmentId = `ATT-${Date.now()}`;
        await env.DB.prepare(`
          INSERT INTO attachments (id, issue_id, file_name, file_url, file_size, content_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(attachmentId, issueId, file.name, fileUrl, file.size, file.type).run();

        return jsonResponse({
          success: true,
          attachment: {
            id: attachmentId,
            issue_id: issueId,
            file_name: file.name,
            file_url: fileUrl,
            file_size: file.size,
            content_type: file.type
          }
        }, 200, corsHeaders);
      }

      // 6. GET /files/* (Public / Cached file server from R2)
      if (url.pathname.startsWith('/files/') && request.method === 'GET') {
        const fileKey = url.pathname.replace('/files/', '');
        const object = await env.BUCKET.get(fileKey);

        if (!object) {
          return new Response('File Not Found', { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');

        return new Response(object.body, { headers });
      }

      return jsonResponse({ message: 'Jira Mini Cloudflare API Ready' }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsHeaders);
    }
  }
};

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
