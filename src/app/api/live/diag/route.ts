/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { diagnoseLiveSource } from '@/lib/live';

export const runtime = 'nodejs';

/**
 * 直播源诊断接口（仅管理员）。
 *
 * GET /api/live/diag?url=<URL编码后的直播源地址>[&ua=<自定义UA>]
 *
 * 服务端完整跑一遍“拉列表 -> 解析 -> 拉 EPG”，把每一步的状态码、耗时、体积、
 * 异常原样返回。用于在 Cloudflare 边缘判断到底是网络不通、被拦、还是解析/超限。
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  const username = authInfo?.username;
  if (username !== process.env.USERNAME) {
    const userInfo = await db.getUserInfoV2(username || '');
    if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');
  const ua = searchParams.get('ua') || undefined;

  if (!rawUrl) {
    return NextResponse.json(
      { error: '缺少 url 参数', usage: '/api/live/diag?url=<URL编码后的直播源地址>' },
      { status: 400 }
    );
  }

  let target = rawUrl;
  try {
    target = decodeURIComponent(rawUrl);
  } catch {
    // 未编码的地址直接用
  }

  if (!/^https?:\/\//i.test(target)) {
    return NextResponse.json(
      { error: 'url 必须是 http(s) 地址', url: target },
      { status: 400 }
    );
  }

  const result = await diagnoseLiveSource(target, ua);
  console.log('[live][diag]', JSON.stringify(result));
  return NextResponse.json(result, {
    headers: { 'cache-control': 'no-store' },
  });
}
