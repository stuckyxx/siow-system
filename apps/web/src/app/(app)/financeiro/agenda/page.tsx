'use client';
import { TasksPanel } from '@/components/panels/tasks-panel';

export default function AgendaPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Agenda financeira</h1>
      <TasksPanel />
    </div>
  );
}
