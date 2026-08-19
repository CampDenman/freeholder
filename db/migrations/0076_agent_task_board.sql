CREATE INDEX "agent_tasks_due_idx" ON "agent_tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks" USING btree ("status");
