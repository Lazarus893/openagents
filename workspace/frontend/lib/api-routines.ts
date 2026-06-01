export interface RoutineV2 {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  routineType: 'daily_summary' | 'todo_sync' | 'standup' | 'weekly_review' | 'custom';
  message: string;
  context: string | null;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDays: number[];
  scheduleIntervalMinutes: number | null;
  status: 'active' | 'paused' | 'cancelled';
  lastOutput: Record<string, unknown> | null;
  outputChannel: string | null;
  createdBy: string;
  lastFiredAt: string | null;
  nextFiresAt: string;
  createdAt: string;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  routineType: RoutineV2['routineType'];
  description: string;
  message: string;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDays: number[];
  icon: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'tpl-daily-summary',
    name: 'Daily Summary',
    routineType: 'daily_summary',
    description: 'Summarize all channel messages at end of day',
    message: 'Summarize today\'s messages across all active channels. Highlight key decisions, action items, and unresolved questions.',
    scheduleHour: 23,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    icon: '📋',
  },
  {
    id: 'tpl-todo-sync',
    name: 'Todo Sync',
    routineType: 'todo_sync',
    description: 'Sync pending items to task board every morning',
    message: 'Check all channels for pending action items and sync them to the task board. Flag overdue items.',
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    icon: '📌',
  },
  {
    id: 'tpl-standup',
    name: 'Standup Report',
    routineType: 'standup',
    description: 'Generate a standup report every weekday morning',
    message: 'Generate a standup report: what was done yesterday, what\'s planned today, and any blockers across all active threads.',
    scheduleHour: 9,
    scheduleMinute: 30,
    scheduleDays: [0, 1, 2, 3, 4],
    icon: '🎯',
  },
  {
    id: 'tpl-weekly-review',
    name: 'Weekly Review',
    routineType: 'weekly_review',
    description: 'Extract key decisions and learnings to Knowledge every Friday',
    message: 'Review this week\'s conversations. Extract key decisions, new learnings, and important context. Save to Knowledge base.',
    scheduleHour: 18,
    scheduleMinute: 0,
    scheduleDays: [4],
    icon: '📚',
  },
];

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const now = Date.now();
const oneHourAgo = new Date(now - 3600000).toISOString();
const threeHoursAgo = new Date(now - 3600000 * 3).toISOString();
const sixHoursAgo = new Date(now - 3600000 * 6).toISOString();

export const MOCK_ROUTINES_V2: RoutineV2[] = [
  {
    id: 'routine-v2-001',
    workspaceId: 'ws-demo',
    projectId: null,
    name: '每日设计审查',
    routineType: 'daily_summary',
    message: '审查 workspace 中最近的 UI 变更和对话，检查设计一致性和组件规范。重点关注：1) 色彩和间距是否符合设计系统 2) 组件复用情况 3) 响应式适配问题。生成简洁的设计审查报告，列出问题和建议。',
    context: '关注 #design-review, #frontend 频道中的 UI 相关讨论',
    scheduleHour: 10,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: '今日审查：发现 3 处色彩不一致（sidebar 使用了冷色调 zinc 而非暖色 stone），2 个组件未复用（重复实现了 Avatar），响应式在 <768px 下 channels 列表溢出。建议：统一使用 oklch 暖色 token，抽取 AgentAvatar 为公共组件。',
      issuesFound: 5,
      componentsReviewed: 12,
      duration: '3.2s',
      status: 'success',
    },
    outputChannel: 'routines:frontend-design',
    createdBy: 'openagents:frontend-design',
    lastFiredAt: oneHourAgo,
    nextFiresAt: new Date(now + 86400000).toISOString(),
    createdAt: new Date(now - 86400000 * 3).toISOString(),
  },
  {
    id: 'routine-v2-002',
    workspaceId: 'ws-demo',
    projectId: null,
    name: '每日知识整理',
    routineType: 'weekly_review',
    message: '整理今日 workspace 对话中提到的需求和决策。重点关注：1) 新的功能需求或变更 2) 技术架构决策 3) 用户反馈和痛点。提取关键信息，以结构化格式输出。',
    context: '覆盖所有活跃频道，重点关注产品和架构相关讨论',
    scheduleHour: 22,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: '今日提取 3 条决策：1) Workspace 创建支持本地模式无需 Firebase 认证 2) Channel 列表增加折叠功能 3) SkillHub 链接迁移至 skillhub.cn。待确认事项：routines 是否需要支持自定义 timezone。',
      decisionsExtracted: 3,
      pendingItems: 1,
      duration: '2.8s',
      status: 'success',
    },
    outputChannel: 'routines:prd-research',
    createdBy: 'openagents:prd-research',
    lastFiredAt: threeHoursAgo,
    nextFiresAt: new Date(now + 43200000).toISOString(),
    createdAt: new Date(now - 86400000 * 5).toISOString(),
  },
  {
    id: 'routine-v2-003',
    workspaceId: 'ws-demo',
    projectId: null,
    name: '每日信息汇总',
    routineType: 'standup',
    message: '汇总所有 channel 中待处理的问题和请求，生成每日待办摘要发送到 general channel。',
    context: '扫描所有频道，标记未回复的 @mentions 和待处理请求',
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: '今日待办汇总：3 条未回复 @mention（@frontend-design 关于配色方案、@prd-research 关于竞品分析、@info-agent 关于 API 文档）。2 条过期任务需要跟进。建议优先处理设计审查反馈。',
      unrepliedMentions: 3,
      overdueTasks: 2,
      channelsScanned: 6,
      duration: '1.5s',
      status: 'success',
    },
    outputChannel: 'routines:info-agent',
    createdBy: 'openagents:info-agent',
    lastFiredAt: sixHoursAgo,
    nextFiresAt: new Date(now + 82800000).toISOString(),
    createdAt: new Date(now - 86400000 * 7).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Type icon mapping
// ---------------------------------------------------------------------------

export const ROUTINE_TYPE_ICONS: Record<RoutineV2['routineType'], string> = {
  daily_summary: '📋',
  todo_sync: '📌',
  standup: '🎯',
  weekly_review: '📚',
  custom: '⚡',
};

export const ROUTINE_TYPE_LABELS: Record<RoutineV2['routineType'], string> = {
  daily_summary: 'Daily Summary',
  todo_sync: 'Todo Sync',
  standup: 'Standup',
  weekly_review: 'Weekly Review',
  custom: 'Custom',
};

// ---------------------------------------------------------------------------
// API helpers — wired to real backend (/v1/routines), with dev-only mock fallback
// ---------------------------------------------------------------------------

import { workspaceApi } from './api';

const isProd = process.env.NODE_ENV === 'production';

function mapRoutineToV2(
  r: {
    id: string;
    name: string;
    message: string;
    context: string | null;
    scheduleHour: number;
    scheduleMinute: number;
    scheduleDays: number[] | null;
    scheduleIntervalMinutes: number | null;
    nextFiresAt: string;
    lastFiredAt: string | null;
    status: string;
    createdBy: string;
    channelName: string;
    createdAt: string | null;
  },
  workspaceId: string,
): RoutineV2 {
  return {
    id: r.id,
    workspaceId,
    projectId: null,
    name: r.name,
    // backend doesn't carry a routineType column — default to 'custom'
    routineType: 'custom',
    message: r.message,
    context: r.context,
    scheduleHour: r.scheduleHour,
    scheduleMinute: r.scheduleMinute,
    scheduleDays: r.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6],
    scheduleIntervalMinutes: r.scheduleIntervalMinutes,
    status: (r.status === 'active' || r.status === 'paused' || r.status === 'cancelled')
      ? r.status
      : 'active',
    lastOutput: null,
    outputChannel: r.channelName || null,
    createdBy: r.createdBy,
    lastFiredAt: r.lastFiredAt,
    nextFiresAt: r.nextFiresAt,
    createdAt: r.createdAt ?? new Date().toISOString(),
  };
}

export async function fetchRoutinesV2(workspaceId: string): Promise<RoutineV2[]> {
  try {
    const { routines } = await workspaceApi.listRoutines();
    return routines.map((r) => mapRoutineToV2(r, workspaceId)).filter((r) => r.status === 'active');
  } catch (err) {
    if (isProd) throw err;
    console.warn('[fetchRoutinesV2] backend unreachable, returning mock data', err);
    return MOCK_ROUTINES_V2.filter((r) => r.status === 'active');
  }
}

export async function createRoutineFromTemplate(
  workspaceId: string,
  template: RoutineTemplate,
  createdBy: string,
): Promise<RoutineV2> {
  // Backend `source` must be a known agent name; strip the `openagents:` prefix.
  const source = createdBy.replace(/^openagents:/, '');
  try {
    const r = await workspaceApi.createRoutine({
      name: template.name,
      message: template.message,
      source,
      hour: template.scheduleHour,
      minute: template.scheduleMinute,
      days: template.scheduleDays,
    });
    return mapRoutineToV2(r, workspaceId);
  } catch (err) {
    if (isProd) throw err;
    console.warn('[createRoutineFromTemplate] backend unreachable, synthesising mock', err);
    const id = `routine-v2-${Date.now()}`;
    return {
      id,
      workspaceId,
      projectId: null,
      name: template.name,
      routineType: template.routineType,
      message: template.message,
      context: null,
      scheduleHour: template.scheduleHour,
      scheduleMinute: template.scheduleMinute,
      scheduleDays: template.scheduleDays,
      scheduleIntervalMinutes: null,
      status: 'active',
      lastOutput: null,
      outputChannel: null,
      createdBy,
      lastFiredAt: null,
      nextFiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
    };
  }
}
