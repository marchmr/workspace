import { randomUUID } from 'crypto';

export type UpdateTaskType = 'core' | 'plugin-install' | 'plugin-update' | 'plugin-remove';
export type UpdateTaskStatus = 'queued' | 'running' | 'success' | 'error';
export type UpdateTaskLogLevel = 'info' | 'success' | 'error';

export interface UpdateTaskLogEntry {
    at: string;
    level: UpdateTaskLogLevel;
    message: string;
}

export interface UpdateTask {
    id: string;
    type: UpdateTaskType;
    target: string;
    status: UpdateTaskStatus;
    progress: number;
    createdAt: string;
    updatedAt: string;
    version?: string;
    error?: string;
    logs: UpdateTaskLogEntry[];
}

interface MutableUpdateTask {
    id: string;
    type: UpdateTaskType;
    target: string;
    status: UpdateTaskStatus;
    progress: number;
    createdAt: Date;
    updatedAt: Date;
    version?: string;
    error?: string;
    logs: UpdateTaskLogEntry[];
}

interface UpdateTaskReporter {
    log: (message: string, progress?: number) => void;
    success: (message: string, version?: string) => void;
    fail: (message: string) => void;
}

const TASK_TTL_MS = 6 * 60 * 60 * 1000;
const TASK_MAX_LOGS = 200;
const tasks = new Map<string, MutableUpdateTask>();

function clampProgress(input: number): number {
    if (!Number.isFinite(input)) return 0;
    return Math.max(0, Math.min(100, Math.round(input)));
}

function toIso(date: Date): string {
    return date.toISOString();
}

function toPublicTask(task: MutableUpdateTask): UpdateTask {
    return {
        id: task.id,
        type: task.type,
        target: task.target,
        status: task.status,
        progress: task.progress,
        createdAt: toIso(task.createdAt),
        updatedAt: toIso(task.updatedAt),
        version: task.version,
        error: task.error,
        logs: task.logs.map((entry) => ({ ...entry })),
    };
}

function addLog(task: MutableUpdateTask, level: UpdateTaskLogLevel, message: string): void {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) return;
    task.logs.push({
        at: new Date().toISOString(),
        level,
        message: cleanMessage,
    });
    if (task.logs.length > TASK_MAX_LOGS) {
        task.logs.splice(0, task.logs.length - TASK_MAX_LOGS);
    }
}

function pruneTasks(): void {
    const now = Date.now();
    for (const [taskId, task] of tasks.entries()) {
        if (now - task.updatedAt.getTime() > TASK_TTL_MS) {
            tasks.delete(taskId);
        }
    }
}

export function createUpdateTask(type: UpdateTaskType, target: string): UpdateTask {
    pruneTasks();
    const now = new Date();
    const task: MutableUpdateTask = {
        id: randomUUID(),
        type,
        target,
        status: 'queued',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        logs: [],
    };
    addLog(task, 'info', 'Update-Auftrag erstellt');
    tasks.set(task.id, task);
    return toPublicTask(task);
}

export function getUpdateTask(taskId: string): UpdateTask | null {
    pruneTasks();
    const task = tasks.get(taskId);
    if (!task) return null;
    return toPublicTask(task);
}

export function runUpdateTask(
    taskId: string,
    worker: (reporter: UpdateTaskReporter) => Promise<void>,
): void {
    const task = tasks.get(taskId);
    if (!task) return;

    task.status = 'running';
    task.updatedAt = new Date();
    addLog(task, 'info', 'Update gestartet');

    const reporter: UpdateTaskReporter = {
        log: (message: string, progress?: number) => {
            const currentTask = tasks.get(taskId);
            if (!currentTask) return;
            currentTask.updatedAt = new Date();
            if (typeof progress === 'number') {
                currentTask.progress = clampProgress(progress);
            }
            addLog(currentTask, 'info', message);
        },
        success: (message: string, version?: string) => {
            const currentTask = tasks.get(taskId);
            if (!currentTask) return;
            currentTask.status = 'success';
            currentTask.progress = 100;
            currentTask.updatedAt = new Date();
            if (version) currentTask.version = version;
            currentTask.error = undefined;
            addLog(currentTask, 'success', message);
        },
        fail: (message: string) => {
            const currentTask = tasks.get(taskId);
            if (!currentTask) return;
            currentTask.status = 'error';
            currentTask.updatedAt = new Date();
            currentTask.error = message;
            addLog(currentTask, 'error', message);
        },
    };

    void (async () => {
        try {
            await worker(reporter);
            const currentTask = tasks.get(taskId);
            if (!currentTask) return;
            if (currentTask.status !== 'success' && currentTask.status !== 'error') {
                currentTask.status = 'success';
                currentTask.progress = 100;
                currentTask.updatedAt = new Date();
                addLog(currentTask, 'success', 'Update abgeschlossen');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            reporter.fail(message || 'Unbekannter Fehler');
        }
    })();
}
