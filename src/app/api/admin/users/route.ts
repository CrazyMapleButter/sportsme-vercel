import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.warn('ADMIN_TOKEN is not set. Admin delete API will reject all requests.');
}

async function deleteUserWithData(userId: string) {
  // Remove all data rows that reference this user so FK constraints don't fail
  // Order matters to respect foreign keys.
  await supabaseAdmin.from('poll_votes').delete().eq('user_id', userId);
  await supabaseAdmin.from('comments').delete().eq('author_id', userId);
  await supabaseAdmin.from('posts').delete().eq('author_id', userId);
  await supabaseAdmin.from('group_memberships').delete().eq('user_id', userId);
  await supabaseAdmin.from('groups').delete().eq('owner_id', userId);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

export async function POST(req: NextRequest) {
  if (!ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Admin API not configured' }, { status: 500 });
  }

  const headerToken = req.headers.get('x-admin-token');
  if (!headerToken || headerToken !== ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, deleteAll } = body || {};

  try {
    if (deleteAll) {
      // Delete all users (dangerous). You may want to filter or protect some accounts.
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;

      const users = data?.users || [];
      const results: { userId: string; ok: boolean; error?: string }[] = [];

      for (const u of users) {
        try {
          await deleteUserWithData(u.id);
          results.push({ userId: u.id, ok: true });
        } catch (e: any) {
          results.push({ userId: u.id, ok: false, error: e?.message || String(e) });
        }
      }

      return NextResponse.json({ success: true, results });
    }

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    try {
      await deleteUserWithData(userId);
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Admin delete error', e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
