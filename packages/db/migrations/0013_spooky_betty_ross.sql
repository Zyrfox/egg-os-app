CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"template_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assigner_user_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('open','in_progress','done','rejected','verified','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigner_user_id_users_id_fk" FOREIGN KEY ("assigner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_company_outlet_status_idx" ON "tasks" USING btree ("company_id","outlet_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_at_partial_idx" ON "tasks" USING btree ("due_at") WHERE "tasks"."due_at" IS NOT NULL;