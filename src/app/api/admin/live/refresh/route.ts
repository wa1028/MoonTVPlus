/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { refreshLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 权限检查 - 使用v2用户系统
    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username || '');
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 并发刷新所有启用的直播源
    // 每个源的结果都要回传：原来这里 catch 里既不记日志也不进响应，
    // 前端只能看到“刷新成功”，实际频道数被悄悄写成 0。
    const results: Array<{
      key: string;
      name: string;
      channels: number;
      error?: string;
    }> = [];

    const refreshPromises = (config.LiveConfig || [])
      .filter(liveInfo => !liveInfo.disabled)
      .map(async (liveInfo) => {
        const startedAt = Date.now();
        try {
          const nums = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = nums;
          results.push({
            key: liveInfo.key,
            name: liveInfo.name,
            channels: nums,
          });
          console.log(
            `[live] 刷新成功(${liveInfo.key}): ${nums} 频道，${Date.now() - startedAt}ms`
          );
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : String(error);
          liveInfo.channelNumber = 0;
          results.push({
            key: liveInfo.key,
            name: liveInfo.name,
            channels: 0,
            error: reason,
          });
          console.error(
            `[live] 刷新失败(${liveInfo.key}): ${reason}，${Date.now() - startedAt}ms`
          );
        }
      });

    // 等待所有刷新任务完成
    await Promise.all(refreshPromises);

    // 保存配置
    await db.saveAdminConfig(config);

    const warnings = results.filter((r) => r.error);

    return NextResponse.json({
      success: warnings.length === 0,
      message:
        warnings.length === 0
          ? '直播源刷新成功'
          : `有 ${warnings.length} 个直播源刷新失败`,
      results,
      warnings,
    });
  } catch (error) {
    console.error('直播源刷新失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500 }
    );
  }
}
